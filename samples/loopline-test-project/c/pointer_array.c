#include <stdio.h>

int main(void) {
    int nums[5] = {0, 1, 2, 3, 4};
    int *nPtr = nums;
    printf("%d\n", *nPtr);

    nPtr = &nums[3];
    printf("%d\n", *nPtr);

    nPtr++;
    *nPtr = 40;
    printf("%d\n", nums[4]);
    return 0;
}
