package main

import "fmt"

func square(n int) int {
	return n * n
}

func main() {
	total := 0
	for i := 1; i < 4; i++ {
		total += square(i)
	}
	fmt.Println(total)
}
