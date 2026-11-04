function check(n) {
  if (n > 2) throw new Error("too big: " + n);
  return check(n + 1);
}

let start = 1;
check(start);
console.log("unreachable");
