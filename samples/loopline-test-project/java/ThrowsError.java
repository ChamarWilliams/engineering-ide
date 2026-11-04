public class ThrowsError {
    static int div(int a, int b) {
        return a / b;
    }

    public static void main(String[] args) {
        int x = 5;
        System.out.println(div(x, 0));
    }
}
