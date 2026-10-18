if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.classList.add("fx-pending");
  setTimeout(function () { document.documentElement.classList.remove("fx-pending"); }, 2500);
}
