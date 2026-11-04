const cart = { items: [], total: 0 };

function addItem(name, price) {
  cart.items.push({ name, price });
  cart.total += price;
  return cart.total;
}

addItem("pen", 3);
addItem("book", 12);
console.log(cart);
