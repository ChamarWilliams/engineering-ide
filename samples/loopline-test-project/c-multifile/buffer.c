static int data[4];

void fill(int base) {
    for (int i = 0; i < 4; i++) {
        data[i] = base + i;
    }
}

int buffer_sum(void) {
    int sum = 0;
    for (int i = 0; i < 4; i++) {
        sum += data[i];
    }
    return sum;
}
