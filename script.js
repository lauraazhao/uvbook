// Click the right-hand page to turn it; click the left-hand page to turn it back.
const book = document.getElementById("book");
const leaf = document.getElementById("leaf");
let turning = false;

function turn(toFlipped) {
  if (turning || book.classList.contains("is-flipped") === toFlipped) return;
  turning = true;
  book.classList.add("is-turning");
  book.classList.toggle("is-flipped", toFlipped);
}

leaf.addEventListener("transitionend", (e) => {
  if (e.target !== leaf || e.propertyName !== "transform") return;
  turning = false;
  book.classList.remove("is-turning");
});

book.addEventListener("click", (e) => {
  const rect = book.getBoundingClientRect();
  const onRight = e.clientX > rect.left + rect.width / 2;
  turn(onRight);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === " ") turn(true);
  if (e.key === "ArrowLeft") turn(false);
});
