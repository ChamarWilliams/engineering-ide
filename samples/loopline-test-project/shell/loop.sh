#!/usr/bin/env bash
add() {
  echo $(( $1 + $2 ))
}

total=0
for i in 1 2 3; do
  total=$(add "$total" "$i")
done
echo "total=$total"
