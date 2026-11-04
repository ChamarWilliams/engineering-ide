const Examples = (() => {
  const LIST = [
    {
      label: 'C: pointer into an array', language: 'c', name: 'pointer_array',
      code: `#include <stdio.h>

int main(void) {
    int nums[5] = {0, 1, 2, 3, 4};
    int *nPtr = nums;
    printf("%d\\n", *nPtr);

    nPtr = &nums[3];
    printf("%d\\n", *nPtr);

    nPtr++;
    *nPtr = 40;
    printf("%d\\n", nums[4]);
    return 0;
}
`,
    },
    {
      label: 'C: linked list', language: 'c', name: 'linked_list',
      code: `#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node *next;
};

struct Node *push(struct Node *head, int value) {
    struct Node *node = malloc(sizeof(struct Node));
    node->value = value;
    node->next = head;
    return node;
}

int main(void) {
    struct Node *head = NULL;
    for (int i = 1; i <= 3; i++) {
        head = push(head, i * 10);
    }
    int total = 0;
    for (struct Node *cur = head; cur != NULL; cur = cur->next) {
        total += cur->value;
    }
    printf("%d\\n", total);
    return 0;
}
`,
    },
    {
      label: 'Python: linked list', language: 'python', name: 'linked_list',
      code: `class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next


head = None
for i in range(3):
    head = Node(i * 10, head)

cur = head
total = 0
while cur:
    total += cur.value
    cur = cur.next
print(total)
`,
    },
    {
      label: 'Python: recursion', language: 'python', name: 'recursion',
      code: `def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)


print(fact(5))
`,
    },
    {
      label: 'Python: bubble sort', language: 'python', name: 'bubble_sort',
      code: `nums = [5, 2, 4, 1, 3]
for i in range(len(nums)):
    for j in range(len(nums) - 1 - i):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]
print(nums)
`,
    },
    {
      label: 'Java: objects and recursion', language: 'java', name: 'Main',
      code: `public class Main {
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
        Node head = null;
        for (int i = 1; i <= 3; i++) {
            head = new Node(fact(i), head);
        }
        System.out.println(head.value);
    }
}
`,
    },
    {
      label: 'JavaScript: recursion', language: 'javascript', name: 'fib',
      code: `function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

console.log(fib(5));
`,
    },
  ];

  function render(host, onPick) {
    host.replaceChildren(...LIST.map((ex, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mesh-btn';
      btn.textContent = ex.label;
      btn.addEventListener('click', () => onPick(LIST[i]));
      return btn;
    }));
  }

  return { list: LIST, render };
})();
