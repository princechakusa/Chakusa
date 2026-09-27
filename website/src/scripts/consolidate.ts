// Scroll-scrubbed "five tools -> one app" visual (IndependentStory.astro).
// Each tool starts at its own scattered position and is pulled into the
// Chakusa icon as the section scrolls to centre; the icon swells as the
// last one arrives. Fully reversible: scroll back up and they scatter.
import { animate, scroll } from "motion";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const spots = [
  { x: -150, y: -110, r: -12 },
  { x: 140, y: -120, r: 10 },
  { x: -170, y: 40, r: 8 },
  { x: 160, y: 60, r: -9 },
  { x: -10, y: 150, r: 5 },
];

document.querySelectorAll<HTMLElement>("[data-consolidate]").forEach((root) => {
  const tools = [...root.querySelectorAll<HTMLElement>(".consol__tool")];
  const hub = root.querySelector<HTMLElement>(".consol__hub")!;
  const caption = root.querySelector<HTMLElement>(".consol__caption")!;
  const scale = () => Math.min(1, root.querySelector<HTMLElement>(".consol__visual")!.offsetWidth / 440);

  if (reduced) { root.classList.add("is-merged"); return; }

  const opts: Parameters<typeof scroll>[1] = { target: root, offset: ["start end", "center 55%"] };
  tools.forEach((t, i) => {
    const s = spots[i]; const k = scale();
    // Stagger arrivals by giving each tool its own slice of the scroll.
    const start = i * 0.08; const end = 0.62 + i * 0.07;
    scroll(animate(t, {
      x: [s.x * k, s.x * k, 0], y: [s.y * k, s.y * k, 0], rotate: [s.r, s.r, 0],
      scale: [1, 1, 0.2], opacity: [1, 1, 0],
    }, { ease: "linear", times: [0, start, end] }), opts);
  });
  scroll(animate(hub, { scale: [0.7, 0.8, 1.15], rotate: [-10, -10, 0] }, { ease: "linear", times: [0, 0.55, 1] }), opts);
  scroll(animate(caption, { opacity: [0, 0, 1], y: [10, 10, 0] }, { ease: "linear", times: [0, 0.85, 1] }), opts);
});
