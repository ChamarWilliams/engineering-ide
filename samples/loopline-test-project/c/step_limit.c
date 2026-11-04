#include <stdio.h>

int main(void) {
    int n = 0;
    while (1) {
        n++;
        if (n > 100000) {
            n = 0;
        }
    }
    return 0;
}
