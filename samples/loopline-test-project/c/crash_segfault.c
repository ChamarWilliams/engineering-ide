#include <stdio.h>

int main(void) {
    int *p = NULL;
    printf("about to crash\n");
    *p = 7;
    printf("unreachable\n");
    return 0;
}
