public class Main {
    static class Node {
        int value;
        Node next;
        Node(int value, Node next) { this.value = value; this.next = next; }
    }

    static int fact(int n) {
        if (n <= 1) return 1;
        return n * fact(n - 1);
    }

    public static void main(String[] args) {
        int[] nums = {3, 1, 2};
        int total = 0;
        for (int i = 0; i < nums.length; i++) {
            total += fact(nums[i]);
        }
        Node head = null;
        for (int i = 1; i <= 3; i++) {
            head = new Node(i * 10, head);
        }
        System.out.println("total " + total + ", head " + head.value);
    }
}
