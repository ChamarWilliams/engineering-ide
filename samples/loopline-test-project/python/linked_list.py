class Node:
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
