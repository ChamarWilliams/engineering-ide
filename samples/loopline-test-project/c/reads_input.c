#include <stdio.h>

int main(void) {
    int n = -1;
    if (scanf("%d", &n) != 1) {
        n = 7;
    }
    printf("n = %d\n", n);
    return 0;
}
