import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class Trace {
    static final int MAX_STEPS = 1500, MAX_ITEMS = 40, MAX_OUT = 65536, MAX_EVENTS = 4000, MAX_HEAP = 24;
    static final long BUDGET_MS = 3500;
    static final String[] EXCLUDE = {"java.*", "javax.*", "jdk.*", "sun.*", "com.sun.*"};

    static final List<String> steps = new ArrayList<>();
    static final List<String> events = new ArrayList<>();
    static final StringBuilder out = new StringBuilder();
    static final StringBuilder err = new StringBuilder();
    static final Map<String, String> heap = new LinkedHashMap<>();
    static final ArrayDeque<ObjectReference> pending = new ArrayDeque<>();
    static final ArrayDeque<String> stack = new ArrayDeque<>();
    static String cut = null;
    static InputStream procOut, procErr;
    static ThreadReference mainThread;
    static ReferenceType mainType;

    static String esc(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"') b.append("\\\"");
            else if (c == '\\') b.append("\\\\");
            else if (c == '\n') b.append("\\n");
            else if (c < 32) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static void drain() {
        try {
            byte[] buf = new byte[4096];
            while (procOut != null && procOut.available() > 0) {
                int n = procOut.read(buf);
                if (n <= 0) break;
                if (out.length() < MAX_OUT) out.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
            while (procErr != null && procErr.available() > 0) {
                int n = procErr.read(buf);
                if (n <= 0) break;
                err.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
        } catch (IOException e) { }
    }

    static String enc(Value v, int depth) {
        if (v == null) return "null";
        if (v instanceof BooleanValue) return String.valueOf(((BooleanValue) v).value());
        if (v instanceof CharValue) {
            char c = ((CharValue) v).value();
            return "{\"r\":" + esc("'" + c + "' (" + (int) c + ")") + ",\"v\":" + (int) c + "}";
        }
        if (v instanceof ByteValue || v instanceof ShortValue || v instanceof IntegerValue || v instanceof LongValue) {
            return String.valueOf(((PrimitiveValue) v).longValue());
        }
        if (v instanceof FloatValue || v instanceof DoubleValue) {
            double d = ((PrimitiveValue) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) return "{\"r\":" + esc(String.valueOf(d)) + "}";
            return String.valueOf(d);
        }
        if (v instanceof StringReference) {
            String s = ((StringReference) v).value();
            return "{\"s\":" + esc(s.length() > 60 ? s.substring(0, 60) : s) + "}";
        }
        if (v instanceof ArrayReference) {
            ArrayReference a = (ArrayReference) v;
            if (depth >= 2) return "{\"r\":" + esc(a.type().name()) + "}";
            int n = a.length();
            StringBuilder b = new StringBuilder("{\"l\":[");
            for (int i = 0; i < Math.min(n, MAX_ITEMS); i++) {
                if (i > 0) b.append(',');
                b.append(enc(a.getValue(i), depth + 1));
            }
            String et = a.type().name();
            return b.append("],\"n\":").append(n).append(",\"k\":\"array\",\"et\":").append(esc(et.endsWith("[]") ? et.substring(0, et.length() - 2) : et)).append('}').toString();
        }
        if (v instanceof ObjectReference) {
            ObjectReference o = (ObjectReference) v;
            String cn = o.referenceType().name();
            if (cn.equals("java.lang.Integer") || cn.equals("java.lang.Long") || cn.equals("java.lang.Double") || cn.equals("java.lang.Boolean")
                    || cn.equals("java.lang.Short") || cn.equals("java.lang.Byte") || cn.equals("java.lang.Float") || cn.equals("java.lang.Character")) {
                return enc(o.getValue(o.referenceType().fieldByName("value")), depth);
            }
            if (cn.startsWith("java.") || cn.startsWith("javax.") || cn.startsWith("jdk.")) {
                if (cn.equals("java.util.ArrayList") && depth < 2) {
                    Field data = o.referenceType().fieldByName("elementData"), size = o.referenceType().fieldByName("size");
                    if (data != null && size != null) {
                        int n = ((IntegerValue) o.getValue(size)).value();
                        ArrayReference arr = (ArrayReference) o.getValue(data);
                        StringBuilder b = new StringBuilder("{\"l\":[");
                        for (int i = 0; i < Math.min(n, MAX_ITEMS); i++) {
                            if (i > 0) b.append(',');
                            b.append(enc(arr.getValue(i), depth + 1));
                        }
                        return b.append("],\"n\":").append(n).append(",\"k\":\"ArrayList\"}").toString();
                    }
                }
                return "{\"r\":" + esc(cn.substring(cn.lastIndexOf('.') + 1)) + "}";
            }
            String key = "@" + Long.toHexString(o.uniqueID());
            if (!heap.containsKey(key) && heap.size() < MAX_HEAP) {
                heap.put(key, null);
                pending.add(o);
            }
            return "{\"p\":{\"h\":" + esc(key) + "},\"t\":" + esc(cn) + ",\"r\":" + esc(key) + "}";
        }
        return "null";
    }

    static void drainHeap() {
        while (!pending.isEmpty()) {
            ObjectReference o = pending.poll();
            StringBuilder b = new StringBuilder("{\"d\":[");
            int n = 0;
            for (Field f : o.referenceType().visibleFields()) {
                if (f.isStatic() || f.isSynthetic()) continue;
                if (n++ > 0) b.append(',');
                b.append('[').append(esc(f.name())).append(',').append(enc(o.getValue(f), 1)).append(']');
            }
            b.append("],\"n\":").append(n).append(",\"k\":").append(esc(o.referenceType().name())).append('}');
            heap.put("@" + Long.toHexString(o.uniqueID()), b.toString());
        }
    }

    static String name(Method m, boolean top) {
        if (top) return "<module>";
        if (m.isConstructor()) return m.declaringType().name();
        return m.name();
    }

    static String snapVars(StackFrame f, boolean top) throws Exception {
        StringBuilder b = new StringBuilder("{");
        int n = 0;
        try {
            for (LocalVariable lv : f.visibleVariables()) {
                if (n++ > 0) b.append(',');
                b.append(esc(lv.name())).append(':').append(enc(f.getValue(lv), 0));
            }
        } catch (AbsentInformationException e) { }
        if (top && mainType != null) {
            for (Field fld : mainType.fields()) {
                if (!fld.isStatic() || fld.isSynthetic()) continue;
                if (n++ > 0) b.append(',');
                b.append(esc(fld.name())).append(':').append(enc(mainType.getValue(fld), 0));
            }
        }
        return b.append('}').toString();
    }

    static void checkpoint(String cutNote) {
        StringBuilder b = new StringBuilder("{\"steps\":[");
        b.append(String.join(",", steps)).append("],\"events\":[").append(String.join(",", events));
        b.append("],\"stdout\":").append(esc(out.length() > MAX_OUT ? out.substring(0, MAX_OUT) : out.toString()));
        b.append(",\"cut\":").append(cutNote == null ? "null" : esc(cutNote)).append('}');
        try { Files.writeString(Paths.get(".trace.json"), b.toString()); } catch (IOException e) { }
    }

    public static void main(String[] args) throws Exception {
        VirtualMachineManager vmm = Bootstrap.virtualMachineManager();
        LaunchingConnector lc = vmm.defaultConnector();
        Map<String, Connector.Argument> a = lc.defaultArguments();
        a.get("main").setValue("Main");
        a.get("options").setValue("-cp . -Xss512k");
        VirtualMachine vm = lc.launch(a);
        procOut = vm.process().getInputStream();
        procErr = vm.process().getErrorStream();
        long started = System.currentTimeMillis();

        EventRequestManager erm = vm.eventRequestManager();
        ClassPrepareRequest cpr = erm.createClassPrepareRequest();
        cpr.addClassFilter("Main");
        cpr.enable();

        boolean running = true;
        boolean stepping = false;
        int lastDepth = 0;
        while (running) {
            EventSet set = vm.eventQueue().remove();
            for (Event ev : set) {
                try {
                    if (ev instanceof ClassPrepareEvent) {
                        mainType = ((ClassPrepareEvent) ev).referenceType();
                        MethodEntryRequest me = erm.createMethodEntryRequest();
                        MethodExitRequest mx = erm.createMethodExitRequest();
                        for (String ex : EXCLUDE) { me.addClassExclusionFilter(ex); mx.addClassExclusionFilter(ex); }
                        me.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                        mx.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                        me.enable();
                        mx.enable();
                        cpr.disable();
                    } else if (ev instanceof MethodEntryEvent) {
                        MethodEntryEvent e = (MethodEntryEvent) ev;
                        mainThread = e.thread();
                        if (!stepping && e.method().name().equals("main")) {
                            StepRequest sr = erm.createStepRequest(e.thread(), StepRequest.STEP_LINE, StepRequest.STEP_INTO);
                            for (String ex : EXCLUDE) sr.addClassExclusionFilter(ex);
                            sr.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                            sr.enable();
                            stepping = true;
                        }
                        if (!e.method().isSynthetic() && !e.method().name().equals("<clinit>") && events.size() < MAX_EVENTS) {
                            int depth = e.thread().frameCount() - 1;
                            boolean top = depth == 0;
                            StackFrame f = e.thread().frame(0);
                            String fn = name(e.method(), top);
                            String caller = "null";
                            if (!top) {
                                StackFrame cf = e.thread().frame(1);
                                caller = "{\"fn\":" + esc(name(cf.location().method(), depth == 1)) + ",\"line\":" + cf.location().lineNumber() + "}";
                            }
                            heap.clear();
                            events.add("{\"e\":\"call\",\"fn\":" + esc(fn) + ",\"q\":" + esc(fn) + ",\"caller\":" + caller + ",\"line\":" + e.method().location().lineNumber()
                                    + ",\"d\":" + depth + ",\"vars\":" + snapVars(f, top) + ",\"at\":" + steps.size() + "}");
                            heap.clear();
                            pending.clear();
                            stack.push(fn);
                        }
                    } else if (ev instanceof MethodExitEvent) {
                        MethodExitEvent e = (MethodExitEvent) ev;
                        if (!e.method().isSynthetic() && !e.method().name().equals("<clinit>") && !stack.isEmpty() && events.size() < MAX_EVENTS) {
                            int depth = e.thread().frameCount() - 1;
                            heap.clear();
                            String fn = stack.pop();
                            String value = e.method().returnTypeName().equals("void") ? "null" : enc(e.returnValue(), 0);
                            events.add("{\"e\":\"ret\",\"fn\":" + esc(fn) + ",\"q\":" + esc(fn) + ",\"d\":" + depth + ",\"value\":" + value
                                    + ",\"vars\":" + snapVars(e.thread().frame(0), depth == 0) + ",\"at\":" + steps.size() + "}");
                            heap.clear();
                            pending.clear();
                        }
                    } else if (ev instanceof StepEvent) {
                        StepEvent e = (StepEvent) ev;
                        drain();
                        heap.clear();
                        pending.clear();
                        int depth = e.thread().frameCount() - 1;
                        StackFrame f = e.thread().frame(0);
                        String vars = snapVars(f, depth == 0);
                        drainHeap();
                        StringBuilder st = new StringBuilder("{\"line\":").append(e.location().lineNumber())
                                .append(",\"fn\":").append(esc(name(e.location().method(), depth == 0)))
                                .append(",\"d\":").append(depth).append(",\"vars\":").append(vars).append(",\"out\":").append(Math.min(out.length(), MAX_OUT));
                        if (!heap.isEmpty()) {
                            st.append(",\"heap\":{");
                            int n = 0;
                            for (Map.Entry<String, String> h : heap.entrySet()) {
                                if (n++ > 0) st.append(',');
                                st.append(esc(h.getKey())).append(':').append(h.getValue() == null ? "null" : h.getValue());
                            }
                            st.append('}');
                        }
                        steps.add(st.append('}').toString());
                        if (steps.size() <= 25 || steps.size() % 25 == 0) checkpoint("time");
                        if (steps.size() >= MAX_STEPS) { cut = "steps"; running = false; }
                        else if (System.currentTimeMillis() - started > BUDGET_MS) { cut = "time"; running = false; }
                    } else if (ev instanceof VMDeathEvent || ev instanceof VMDisconnectEvent) {
                        running = false;
                    }
                } catch (VMDisconnectedException e) {
                    running = false;
                } catch (Exception e) {
                    err.append("tracer: ").append(e).append('\n');
                }
            }
            if (!running) break;
            try { set.resume(); } catch (VMDisconnectedException e) { running = false; }
        }
        drain();
        checkpoint(cut);
        if (err.length() > 0) System.err.print(err);
        try { vm.exit(0); } catch (Exception e) { }
        System.exit(err.length() > 0 ? 1 : 0);
    }
}
