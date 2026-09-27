// Drives components/motion/ScrollStory.astro.
// Desktop: the step nearest the viewport centre becomes active; the pinned
// phone swaps to its screen with a Motion spring. Mobile: each step gets its
// own inline copy of its screen, animated in as it scrolls into view.
import { animate, inView } from "motion";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = window.matchMedia("(min-width: 60rem)");

document.querySelectorAll<HTMLElement>("[data-sstory]").forEach((root) => {
  const steps = [...root.querySelectorAll<HTMLElement>(".sstory__step")];
  const screens = [...root.querySelectorAll<HTMLElement>(".sstory__screen")];
  const dots = [...root.querySelectorAll<HTMLElement>("[data-dot]")];
  let current = -1;

  function setActive(i: number) {
    if (i === current) return;
    const prev = screens[current];
    current = i;
    steps.forEach((s, k) => s.classList.toggle("is-active", k === i));
    dots.forEach((d, k) => d.classList.toggle("is-on", k === i));
    screens.forEach((s, k) => s.classList.toggle("is-active", k === i));
    if (reduced) return;
    if (prev) animate(prev, { opacity: [1, 0], y: [0, -16] }, { duration: 0.2 });
    animate(screens[i], { opacity: [0, 1], y: [28, 0], scale: [0.97, 1] }, { type: "spring", stiffness: 260, damping: 24 });
  }

  // Desktop: the step whose centre is closest to the viewport centre wins.
  // Computed from geometry on every scroll frame, so fast jumps and
  // out-of-order observer events can't leave the wrong step active.
  let queued = false;
  const pick = () => {
    queued = false;
    if (!desktop.matches) return;
    const mid = window.innerHeight / 2;
    let best = 0; let bestDist = Infinity;
    steps.forEach((step, i) => {
      const r = step.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setActive(best);
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(pick); } };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  setActive(0);
  pick();

  // Mobile: inline preview per step.
  const phone = root.querySelector<HTMLElement>(".am-phone");
  if (!phone) return;
  steps.forEach((step, i) => {
    const mini = document.createElement("div");
    mini.className = "sstory__mini";
    mini.setAttribute("aria-hidden", "true");
    const clone = phone.cloneNode(true) as HTMLElement;
    clone.querySelectorAll<HTMLElement>(".sstory__screen").forEach((s, k) => { if (k !== i) s.remove(); else s.removeAttribute("style"); });
    mini.append(clone);
    step.append(mini);
    const screen = clone.querySelector<HTMLElement>(".sstory__screen")!;
    screen.classList.remove("is-active");
    if (reduced) { screen.classList.add("is-active"); return; }
    inView(mini, () => {
      if (desktop.matches) return;
      screen.classList.add("is-active");
      animate(clone, { y: [30, 0], opacity: [0, 1] }, { type: "spring", stiffness: 200, damping: 22 });
    }, { amount: 0.3 });
  });
});
