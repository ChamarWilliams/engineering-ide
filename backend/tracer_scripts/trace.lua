local MAX_STEPS, MAX_ITEMS, MAX_OUT, MAX_EVENTS = 1500, 40, 65536, 4000
local deadline = os.clock() + 3.5
local steps, events, depth, cut = {}, {}, 0, nil
local out, outlen = {}, 0
local SOURCE = "@main.lua"

local real_print, real_write = print, io.write
local function emit(s)
  local room = MAX_OUT - outlen
  if room > 0 then
    out[#out + 1] = s:sub(1, room)
    outlen = outlen + math.min(#s, room)
  end
end
print = function(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
  emit(table.concat(parts, "\t") .. "\n")
end
io.write = function(...)
  for i = 1, select("#", ...) do emit(tostring((select(i, ...)))) end
  return io.stdout
end

local function esc(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == "\\" then return "\\\\" elseif c == "\n" then return "\\n" end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function is_seq(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n == #t, n
end

local function enc(v, d)
  local t = type(v)
  if t == "nil" then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return '{"r":' .. esc(tostring(v)) .. "}" end
    if math.type(v) == "integer" then return tostring(v) end
    return string.format("%.14g", v)
  end
  if t == "string" then return '{"s":' .. esc(v:sub(1, 60)) .. "}" end
  if t == "table" then
    if d >= 2 then return '{"r":' .. esc(tostring(v)) .. "}" end
    local seq, n = is_seq(v)
    local parts = {}
    if seq then
      for i = 1, math.min(#v, MAX_ITEMS) do parts[#parts + 1] = enc(v[i], d + 1) end
      return '{"l":[' .. table.concat(parts, ",") .. '],"n":' .. n .. ',"k":"table"}'
    end
    local count = 0
    for k, x in pairs(v) do
      if type(x) ~= "function" then
        count = count + 1
        if count <= MAX_ITEMS then parts[#parts + 1] = "[" .. esc(tostring(k):sub(1, 30)) .. "," .. enc(x, d + 1) .. "]" end
      end
    end
    return '{"d":[' .. table.concat(parts, ",") .. '],"n":' .. n .. "}"
  end
  return '{"r":' .. esc(tostring(v):sub(1, 60)) .. "}"
end

local base_globals = {}
for k in pairs(_G) do base_globals[k] = true end
base_globals.print, base_globals.io = true, true

local function snap(level, is_main)
  local items = {}
  local i = 1
  while true do
    local name, val = debug.getlocal(level, i)
    if not name then break end
    if name:sub(1, 1) ~= "(" and type(val) ~= "function" then items[#items + 1] = esc(name) .. ":" .. enc(val, 0) end
    i = i + 1
  end
  if is_main then
    local keys = {}
    for k, v in pairs(_G) do
      if not base_globals[k] and type(k) == "string" and type(v) ~= "function" then keys[#keys + 1] = k end
    end
    table.sort(keys)
    for _, k in ipairs(keys) do items[#items + 1] = esc(k) .. ":" .. enc(_G[k], 0) end
  end
  return "{" .. table.concat(items, ",") .. "}"
end

local function name_of(info)
  if info.what == "main" then return "<module>" end
  return info.name or ("fn@" .. info.linedefined)
end

local pending_ret = {}

local function hook(event, line)
  local info = debug.getinfo(2, "nSlur")
  if not info or info.source ~= SOURCE then return end
  if event == "line" then
    if #steps >= MAX_STEPS then cut = "steps"; error("__eide_stop", 0) end
    if os.clock() > deadline then cut = "time"; error("__eide_stop", 0) end
    local is_main = info.what == "main"
    steps[#steps + 1] = '{"line":' .. line .. ',"fn":' .. esc(name_of(info)) .. ',"d":' .. depth .. ',"vars":' .. snap(3, is_main) .. ',"out":' .. outlen .. "}"
  elseif event == "call" or event == "tail call" then
    if #events < MAX_EVENTS then
      local caller = debug.getinfo(3, "nSl")
      local c = (caller and caller.source == SOURCE) and ('{"fn":' .. esc(name_of(caller)) .. ',"line":' .. caller.currentline .. "}") or "null"
      local args, i = {}, 1
      while true do
        local n, v = debug.getlocal(2, i)
        if not n or i > info.nparams then break end
        args[#args + 1] = esc(n) .. ":" .. enc(v, 0)
        i = i + 1
      end
      events[#events + 1] = '{"e":"call","fn":' .. esc(name_of(info)) .. ',"q":' .. esc(name_of(info)) .. ',"caller":' .. c .. ',"line":' .. info.linedefined .. ',"d":' .. depth .. ',"vars":{' .. table.concat(args, ",") .. '},"at":' .. #steps .. "}"
    end
    depth = depth + 1
  elseif event == "return" then
    depth = math.max(depth - 1, 0)
    if #events < MAX_EVENTS then
      local value = "null"
      if info.ntransfer and info.ntransfer > 0 then
        local _, v = debug.getlocal(2, info.ftransfer)
        value = enc(v, 0)
      end
      events[#events + 1] = '{"e":"ret","fn":' .. esc(name_of(info)) .. ',"q":' .. esc(name_of(info)) .. ',"d":' .. depth .. ',"value":' .. value .. ',"vars":' .. snap(3, false) .. ',"at":' .. #steps .. "}"
    end
  end
end

local chunk, err = loadfile("main.lua")
local status = 0
if not chunk then
  io.stderr:write(err .. "\n")
  status = 1
else
  debug.sethook(hook, "crl")
  local ok, e = xpcall(chunk, function(m) return m end)
  debug.sethook()
  if not ok and e ~= "__eide_stop" then
    io.stderr:write(tostring(e) .. "\n")
    status = 1
  end
end

local f = io.open(".trace.json", "w")
f:write('{"steps":[' .. table.concat(steps, ",") .. '],"events":[' .. table.concat(events, ",") .. '],"stdout":' .. esc(table.concat(out)) .. ',"cut":' .. (cut and esc(cut) or "null") .. "}")
f:close()
os.exit(status)
