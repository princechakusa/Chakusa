// Physics-driven motion layer for marketing pages, built on Motion
// (motion.dev). Everything is opt-in through data attributes so any page
// can use it without new JS:
//
//   [data-split]        headline words rise in with a staggered spring
//                       (data-accent="5,6" gives those word indexes the accent style)
//   [data-rotate]       cycles "a|b|c" with a spring swap
//   [data-magnetic]     element is pulled toward the cursor, springs back
//   [data-tilt]         3D tilt + glare that follows the pointer
//   [data-stagger]      children spring in, staggered, when scrolled into view
//   [data-parallax=N]   element drifts N px against the scroll
//   [data-marquee]      infinite strip whose speed reacts to scroll velocity
//                       (data-marquee="reverse" runs the other way)
//   [data-spotlight]    soft light follows the cursor (sets --mx / --my)
//   [data-scrub-words]  words light up one by one with scroll position
//   [data-inview]       toggles .is-in while visible (replays CSS demos)
//   [data-scroll-progress] sets --progress (0-1) as the element scrolls through
//
// Under prefers-reduced-motion nothing moves; content is simply shown.
import { animate, inView, scroll, stagger } from "motion";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const springy = { type: "spring", stiffness: 260, damping: 22 } as const;
const soft = { type: "spring", stiffness: 150, damping: 18, mass: 0.6 } as const;

document.documentElement.classList.add(reduced ? "fx-static" : "fx-live");

function splitWords(el: HTMLElement) {
  const words = (el.textContent ?? "").trim().split(/\s+/);
  el.setAttribute("aria-label", words.join(" "));
  el.innerHTML = words.map((w) => `<span class="fx-word" aria-hidden="true"><span class="fx-word__in">${w}</span></span>`).join(" ");
  return [...el.querySelectorAll<HTMLElement>(".fx-word__in")];
}

// Headlines are split everywhere so accent words style consistently;
// the spring rise only runs when motion is allowed.
document.querySelectorAll<HTMLElement>("[data-split]").forEach((el) => {
  const words = splitWords(el);
  (el.dataset.accent ?? "").split(",").filter(Boolean).forEach((i) => words[Number(i)]?.classList.add("fx-accent"));
  if (reduced) return;
  inView(el, () => {
    animate(words, { y: ["110%", "0%"], rotate: [6, 0], opacity: [0, 1], filter: ["blur(6px)", "blur(0px)"] },
      { ...springy, delay: stagger(0.055) });
  }, { amount: 0.4 });
});
document.documentElement.classList.remove("fx-pending");

// Rotating word: spring out the top, spring in from below.
document.querySelectorAll<HTMLElement>("[data-rotate]").forEach((el) => {
  const items = (el.dataset.rotate ?? "").split("|");
  if (reduced || items.length < 2) return;
  el.setAttribute("aria-live", "off");
  let i = 0;
  setInterval(async () => {
    if (document.hidden) return;
    await animate(el, { y: [0, -18], opacity: [1, 0], filter: ["blur(0px)", "blur(4px)"] }, { duration: 0.22, ease: "easeIn" });
    i = (i + 1) % items.length;
    el.textContent = items[i];
    animate(el, { y: [22, 0], opacity: [0, 1], filter: ["blur(4px)", "blur(0px)"] }, { type: "spring", stiffness: 420, damping: 20 });
  }, 2200);
});

if (!reduced) {
  // Replaying in-view flag for CSS-driven micro-demos.
  document.querySelectorAll<HTMLElement>("[data-inview]").forEach((el) => {
    inView(el, () => {
      el.classList.add("is-in");
      return () => {
        el.classList.remove("is-in");
        el.classList.add("is-reset"); // restart CSS animations from frame 0
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("is-reset")));
      };
    }, { amount: 0.5 });
  });

  // Staggered children.
  document.querySelectorAll<HTMLElement>("[data-stagger]").forEach((group) => {
    const kids = [...group.children] as HTMLElement[];
    kids.forEach((k) => { k.style.opacity = "0"; });
    inView(group, () => {
      animate(kids, { opacity: [0, 1], y: [40, 0], scale: [0.96, 1] }, { ...soft, delay: stagger(0.07) });
    }, { amount: 0.15 });
  });

  // Scroll-linked parallax.
  document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
    const dist = Number(el.dataset.parallax) || 60;
    scroll(animate(el, { y: [0, -dist] }, { ease: "linear" }), { target: el, offset: ["start end", "end start"] });
  });

  // Copy that lights up word by word as it scrolls through the viewport.
  document.querySelectorAll<HTMLElement>("[data-scrub-words]").forEach((el) => {
    const words = (el.textContent ?? "").trim().split(/\s+/);
    el.setAttribute("aria-label", words.join(" "));
    el.style.setProperty("--n", String(words.length));
    el.innerHTML = words.map((w, i) => `<span class="fx-scrub" aria-hidden="true" style="--i:${i}">${w}</span>`).join(" ");
    scroll((p: number) => el.style.setProperty("--p", p.toFixed(4)), { target: el, offset: ["start 85%", "end 50%"] });
  });

  // Scroll progress as a CSS variable.
  document.querySelectorAll<HTMLElement>("[data-scroll-progress]").forEach((el) => {
    scroll((p: number) => el.style.setProperty("--progress", p.toFixed(4)), { target: el, offset: ["start 75%", "end 55%"] });
  });

  // Marquee: constant drift, boosted and reversed by scroll velocity.
  const marquees = [...document.querySelectorAll<HTMLElement>("[data-marquee]")];
  if (marquees.length) {
    let velocity = 0;
    scroll((_p: number, info: { y: { velocity: number } }) => { velocity = info.y.velocity; });
    marquees.forEach((m) => {
      const track = m.firstElementChild as HTMLElement;
      const base = m.dataset.marquee === "reverse" ? -1 : 1;
      let x = 0; let dir = -1; let boost = 0; let last = performance.now(); let hovering = false;
      m.addEventListener("pointerenter", () => { hovering = true; });
      m.addEventListener("pointerleave", () => { hovering = false; });
      const tick = (now: number) => {
        const dt = Math.min(50, now - last) / 1000; last = now;
        if (Math.abs(velocity) > 20) dir = velocity > 0 ? -1 : 1;
        const d = dir * base;
        boost += (Math.min(6, Math.abs(velocity) / 400) - boost) * 0.08;
        const speed = hovering ? 8 : 40 * (1 + boost);
        const half = track.scrollWidth / 2;
        x = (x + d * speed * dt) % half;
        if (x > 0) x -= half;
        track.style.transform = `translate3d(${x}px,0,0)`;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}

if (!reduced && finePointer) {
  // Magnetic elements.
  document.querySelectorAll<HTMLElement>("[data-magnetic], .story-hero__actions .ui-button, .story-cta .ui-button").forEach((el) => {
    const pull = Number(el.dataset.magnetic) || 0.35;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      animate(el, { x: (e.clientX - r.left - r.width / 2) * pull, y: (e.clientY - r.top - r.height / 2) * pull }, soft);
    });
    el.addEventListener("pointerleave", () => animate(el, { x: 0, y: 0 }, { type: "spring", stiffness: 300, damping: 12 }));
  });

  // 3D tilt with glare.
  document.querySelectorAll<HTMLElement>("[data-tilt]").forEach((el) => {
    const max = Number(el.dataset.tilt) || 8;
    el.classList.add("fx-tilt");
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width; const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--gx", `${px * 100}%`); el.style.setProperty("--gy", `${py * 100}%`);
      animate(el, { rotateY: (px - 0.5) * max * 2, rotateX: (0.5 - py) * max * 2, scale: 1.02, transformPerspective: 900 }, soft);
    });
    el.addEventListener("pointerleave", () => animate(el, { rotateX: 0, rotateY: 0, scale: 1 }, { type: "spring", stiffness: 200, damping: 14 }));
  });

  // Cursor spotlight.
  document.querySelectorAll<HTMLElement>("[data-spotlight]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`); el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
}
