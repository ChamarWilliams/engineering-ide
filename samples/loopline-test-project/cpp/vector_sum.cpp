#include <iostream>
#include <vector>

int square(int n) {
    return n * n;
}

int main() {
    std::vector<int> values = {1, 2, 3, 4};
    int total = 0;
    for (int v : values) {
        total += square(v);
    }
    std::cout << "total " << total << std::endl;
    return 0;
}
