#include <stdio.h>
#include "mathops.h"
#include "buffer.h"

int main(void) {
    int total = add(2, 3);
    total = scale(total, 4);
    fill(total);
    printf("total = %d, buffer sum = %d\n", total, buffer_sum());
    return 0;
}
