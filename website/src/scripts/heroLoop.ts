// Timeline engine for the homepage hero demo (HeroLoopDemo.astro).
//
// State lives in the DOM: `data-scene` on the root picks the visible app
// screen, and `f-*` classes on the root switch individual beats on. CSS
// owns every transition, so jumping to any point is just "reset, then
// replay all earlier beats instantly". Progress-driven tracks (typing,
// bars) render from the clock each frame, so pausing freezes them too.
//
// The demo pauses while off-screen or in a background tab, has a visible
// pause control (WCAG 2.2.2), and never autoplays under reduced motion.
import { inView } from "motion";

type Beat = { t: number; run: () => void };
type Track = { t: number; d: number; render: (p: number) => void };

const SCENES = [
  { id: "capture", tab: "leads", start: 0 },
  { id: "reply", tab: "leads", start: 3600 },
  { id: "book", tab: "cal", start: 8600 },
  { id: "review", tab: "more", start: 12400 },
  { id: "return", tab: "clients", start: 16400 },
];
const TOTAL = 21000;

function setup(root: HTMLElement) {
  const baseClass = root.className;
  const q = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const stepButtons = [...root.querySelectorAll<HTMLButtonElement>(".loop__step")];
  const toggle = q<HTMLButtonElement>("[data-loop-toggle]");
  const typed = q(".bubble__text");
  const fullText = typed.dataset.type ?? "";

  const beats: Beat[] = [];
  const tracks: Track[] = [];
  const at = (t: number, run: () => void) => beats.push({ t, run });
  const on = (t: number, ...flags: string[]) => at(t, () => flags.forEach((f) => root.classList.add(`f-${f}`)));
  const off = (t: number, ...flags: string[]) => at(t, () => flags.forEach((f) => root.classList.remove(`f-${f}`)));
  const tap = (t: number, where: string) => { at(t, () => (root.dataset.tap = where)); at(t + 650, () => delete root.dataset.tap); };
  const scene = (i: number) => at(SCENES[i].start, () => { root.dataset.scene = SCENES[i].id; root.dataset.tab = SCENES[i].tab; });

  // 1. Capture: a missed call lands as a lead.
  scene(0);
  on(500, "push");
  on(1500, "newlead", "feed1");
  off(2700, "push");
  tap(2500, "lead");
  // 2. Reply: drafted from the template, a person sends it.
  scene(1);
  on(4000, "drafting");
  off(4900, "drafting");
  on(4900, "typing");
  tracks.push({ t: 4900, d: 1700, render: (p) => { typed.textContent = fullText.slice(0, Math.round(fullText.length * p)); } });
  tap(6900, "send");
  on(7300, "sent", "feed2", "cust1");
  on(8000, "replied", "cust2");
  // 3. Book: the slot fills and a reminder is scheduled.
  scene(2);
  on(9200, "booked", "cust3");
  on(10200, "booktoast", "feed3");
  off(12000, "booktoast");
  // 4. Review: request after every visit; stars arrive one by one.
  scene(3);
  on(12900, "reqsent", "cust4");
  [0, 1, 2, 3, 4].forEach((i) => on(13700 + i * 170, `s${i + 1}`));
  on(14800, "revtext", "feed4");
  // 5. Return: four weeks later they're flagged as due back.
  scene(4);
  tracks.push({ t: 16900, d: 1300, render: (p) => root.style.setProperty("--due", String(p)) });
  on(18200, "due", "feed5");
  tap(18900, "remind");
  on(19300, "remindtoast", "cust5");
  beats.sort((a, b) => a.t - b.t);

  let elapsed = 0;
  let next = 0;
  let last = 0;
  let visible = false;
  let userPaused = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const sceneIndex = () => SCENES.reduce((acc, s, i) => (elapsed >= s.start ? i : acc), 0);

  function reset() {
    root.className = baseClass;
    root.classList.toggle("is-paused", userPaused);
    delete root.dataset.tap;
    root.style.setProperty("--due", "0");
    typed.textContent = "";
    next = 0;
    elapsed = 0;
  }

  function apply() {
    while (next < beats.length && beats[next].t <= elapsed) beats[next++].run();
    for (const tr of tracks) tr.render(Math.min(1, Math.max(0, (elapsed - tr.t) / tr.d)));
    const idx = sceneIndex();
    stepButtons.forEach((btn, i) => {
      const s = SCENES[i];
      const end = SCENES[i + 1]?.start ?? TOTAL;
      const p = i < idx ? 1 : i > idx ? 0 : (elapsed - s.start) / (end - s.start);
      btn.style.setProperty("--p", String(Math.min(1, p)));
      btn.toggleAttribute("aria-current", i === idx);
    });
  }

  // Jump without transitions, then re-enable them on the next frame.
  function jump(to: number) {
    reset();
    root.classList.add("is-instant");
    elapsed = to;
    apply();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("is-instant")));
  }

  function frame(now: number) {
    const dt = Math.min(64, now - (last || now));
    last = now;
    if (visible && !userPaused && !document.hidden) {
      elapsed += dt;
      if (elapsed >= TOTAL) jump(0);
      else apply();
    }
    requestAnimationFrame(frame);
  }

  function setPaused(p: boolean) {
    userPaused = p;
    root.classList.toggle("is-paused", p);
    toggle.setAttribute("aria-pressed", String(p));
    toggle.setAttribute("aria-label", p ? "Play demo" : "Pause demo");
  }

  toggle.addEventListener("click", () => setPaused(!userPaused));
  stepButtons.forEach((btn, i) => btn.addEventListener("click", () => {
    // Under reduced motion (or when paused) show the finished state of the
    // step, otherwise play it from its start.
    const end = (SCENES[i + 1]?.start ?? TOTAL) - 1;
    jump(userPaused ? end : SCENES[i].start);
  }));

  inView(root, () => { visible = true; return () => { visible = false; }; }, { amount: 0.25 });

  if (reduced.matches) {
    setPaused(true);
    jump(SCENES[2].start - 1); // a complete, readable reply thread
  } else {
    jump(0);
  }
  requestAnimationFrame(frame);
}

document.querySelectorAll<HTMLElement>("[data-loop]").forEach(setup);
