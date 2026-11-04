fn square(n: i32) -> i32 {
    n * n
}

fn main() {
    let mut total = 0;
    for i in 1..4 {
        total += square(i);
    }
    println!("{}", total);
}
