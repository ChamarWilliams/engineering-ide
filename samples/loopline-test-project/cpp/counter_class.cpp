#include <iostream>

class Counter {
public:
    int count = 0;
    void bump(int by) {
        count += by;
    }
};

int main() {
    Counter c;
    for (int i = 1; i <= 3; i++) {
        c.bump(i);
    }
    std::cout << c.count << std::endl;
    return 0;
}
