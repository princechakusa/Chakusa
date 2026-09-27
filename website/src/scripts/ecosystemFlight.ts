// Customer-mode -> Business-mode booking hand-off (UnifiedEcosystem.astro).
// A time is picked, "Book" is pressed, and the booking physically travels
// along an arc into the business schedule, where it springs into place.
// Loops only while visible; static final state under reduced motion.
import { animate, inView } from "motion";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

document.querySelectorAll<HTMLElement>("[data-eco]").forEach((root) => {
  const slot = root.querySelector<HTMLElement>(".eco__slot-pick")!;
  const book = root.querySelector<HTMLElement>(".eco__book")!;
  const row = root.querySelector<HTMLElement>(".eco__row--new")!;
  const token = root.querySelector<HTMLElement>(".eco__token")!;
  const path = root.querySelector<SVGPathElement>(".eco__path");

  if (reduced) { root.classList.add("is-picked", "is-landed"); return; }

  let visible = false;
  let running = false;

  const centre = (el: HTMLElement) => {
    const r = el.getBoundingClientRect(); const o = root.getBoundingClientRect();
    return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 };
  };

  async function cycle() {
    running = true;
    while (visible) {
      root.classList.remove("is-picked", "is-landed");
      animate(row, { opacity: 0, height: 0, marginBlock: 0, scale: 0.9 }, { duration: 0.3 });
      await wait(900);
      root.classList.add("is-picked");
      animate(slot, { scale: [1, 0.88, 1.08, 1] }, { duration: 0.5 });
      await wait(800);
      await animate(book, { scale: [1, 0.93, 1] }, { type: "spring", stiffness: 500, damping: 15 });

      const a = centre(book); const b = centre(row.parentElement!);
      const apex = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 110 };
      token.style.left = `${a.x}px`; token.style.top = `${a.y}px`;
      if (path) animate(path, { strokeDashoffset: [300, 0] }, { duration: 0.9, ease: "easeOut" });
      await animate(token,
        { x: [0, apex.x - a.x, b.x - a.x], y: [0, apex.y - a.y, b.y - a.y], scale: [0.4, 1.25, 0.8], opacity: [0, 1, 1], rotate: [0, -8, 0] },
        { duration: 1.05, ease: [0.45, 0, 0.2, 1] });
      animate(token, { opacity: 0, scale: 0.4 }, { duration: 0.2 });

      root.classList.add("is-landed");
      await animate(row, { opacity: 1, height: "auto", marginBlock: "0.4rem", scale: [0.85, 1] }, { type: "spring", stiffness: 380, damping: 18 });
      await wait(3200);
    }
    running = false;
  }

  inView(root, () => {
    visible = true;
    if (!running) cycle();
    return () => { visible = false; };
  }, { amount: 0.35 });
});
