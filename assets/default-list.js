/* The list every first-time visitor sees. Deliberately generic — a plain
   weekly shop. Personal lists live in localStorage or an imported file. */
window.DEFAULT_LIST = {
  format: "lifelist",
  version: 1,
  title: "Grocery List",
  subtitle: "Nothing goes in the cart without a receipt.",
  labels: {
    done: "In cart",
    todo: "Still to get",
    group: "Aisle",
    groups: "Aisles"
  },
  categories: [
    { name: "Produce", items: [
      "Bananas", "Apples", "Spinach", "Tomatoes", "Onions", "Garlic",
      "Carrots", "Lemons", "Avocados", "Potatoes"
    ] },
    { name: "Bakery", items: [
      "Sourdough loaf", "Tortillas", "Bagels", "Burger buns"
    ] },
    { name: "Dairy & eggs", items: [
      "Milk", "Eggs", "Butter", "Greek yogurt", "Parmesan", "Cheddar"
    ] },
    { name: "Meat & fish", items: [
      "Chicken thighs", "Ground beef", "Bacon", "Salmon fillets"
    ] },
    { name: "Pantry", items: [
      "Olive oil", "Rice", "Pasta", "Canned tomatoes", "Black beans",
      "Peanut butter", "Coffee", "Flour", "Sugar", "Salt"
    ] },
    { name: "Frozen", items: [
      "Peas", "Berries", "Ice cream", "Pizza"
    ] },
    { name: "Snacks", items: [
      "Tortilla chips", "Dark chocolate", "Almonds", "Crackers"
    ] },
    { name: "Drinks", items: [
      "Sparkling water", "Orange juice", "Tea", "Beer"
    ] },
    { name: "Household", items: [
      "Paper towels", "Dish soap", "Trash bags", "Laundry detergent", "Sponges"
    ] },
    { name: "Personal care", items: [
      "Toothpaste", "Shampoo", "Deodorant", "Sunscreen"
    ] }
  ]
};
