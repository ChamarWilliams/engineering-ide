#include <stdio.h>

int main(void) {
    int a[5] = {5, 2, 4, 1, 3};
    for (int i = 0; i < 5; i++) {
        for (int j = 0; j < 4 - i; j++) {
            if (a[j] > a[j + 1]) {
                int tmp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = tmp;
            }
        }
    }
    for (int k = 0; k < 5; k++) {
        printf("%d ", a[k]);
    }
    printf("\n");
    return 0;
}
