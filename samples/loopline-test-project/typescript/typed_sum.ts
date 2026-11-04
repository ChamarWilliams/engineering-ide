interface Point {
  x: number;
  y: number;
}

function dist2(p: Point): number {
  return p.x * p.x + p.y * p.y;
}

const points: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
let total = 0;
for (const p of points) {
  total += dist2(p);
}
console.log(total);
