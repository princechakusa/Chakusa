# Chakusa Website Experience & Creative Direction

*Complements `WEBSITE_MASTER_PLAN.md`. The Master Plan is locked and unchanged here — same sitemap, same page set, same execution order, same architecture. This document defines HOW the five V1 pages (`/`, `/product`, `/pricing`, `/industries`, `/about`) should feel, look, move, and read. It is the creative brief Codex builds against, not a spec change.*

*One constraint carries over from the Master Plan and shapes everything below: nothing here manufactures a feeling the product hasn't earned. Premium and honest are the same requirement, not a tradeoff — see Part 9's closing note on "urgency."*

---

## PART 1 — The Visitor Emotional Journey

**The arc, revised from the brief's example.** The brief's stock arc ends in "Urgency" — but Chakusa has no scarcity to point to (no limited spots, no expiring discount), and inventing one would break the honesty discipline this whole project has held to. The real arc a truthful, premium product can earn:

```
Arrival → Recognition → Relief → Trust → Confidence → Motivation → Action
```

| Stage | What the visitor feels | What creates it |
|---|---|---|
| **Arrival** | "This looks considered." A snap first impression, formed in under a second, from whitespace and type quality alone — before a single word is read. | Generous top padding, restrained color use, no clutter competing with the hero. |
| **Recognition** | "That's exactly my problem." | The Problem section names the visitor's specific pain in their own language, not SaaS-speak. |
| **Relief** | "Oh — someone already solved this." | The journey section resolves the problem in one clean beat, immediately after it's raised — no lingering in the pain. |
| **Trust** | "This is real, not vaporware." | Real screenshots, not illustration; honest zero-states shown without embarrassment (the recovered-revenue screenshot showing $0 is a trust asset, not a weakness — it proves the number is live, not staged). |
| **Confidence** | "This would work for a business like mine." | The Industries strip and per-pillar proof sections show the visitor's own trade, not a generic dashboard. |
| **Motivation** | "I want this before my next missed call." | Pricing is visible and fair, removing the last excuse to leave and "think about it." |
| **Action** | Click. | A CTA that says what happens next in plain words, with zero perceived risk (Free tier, no card). |

### Per-page emotional target

- **Home:** the entire arc above, compressed into one scroll. This is the only page that must complete the full journey unassisted.
- **Product:** re-enters at *Confidence* — visitor already trusts the premise from Home; this page's job is proving depth, not re-selling the idea.
- **Pricing:** re-enters at *Motivation*, resolves at *Action*. The shortest emotional distance of any page — visitor arrives already convinced, pricing just needs to not introduce doubt.
- **Industries:** re-enters at *Recognition* for a visitor who skipped Home's problem framing and searched their trade directly (e.g. "review request app for barbers"). Must independently earn *Relief* and *Confidence* for a cold arrival.
- **About:** the only page whose job is pure *Trust* — no urgency, no CTA pressure. A visitor here is diligencing the company, not evaluating the loop.

---

## PART 2 — Visual Storytelling

### Home (built — creative target for the two open Stage 7 items and future iteration)
- **Visual objective:** prove the loop is real in one glance.
- **Hero composition:** left-aligned copy column, right-aligned phone mockup on desktop (already built); the phone tilted 1°, never perfectly square — a straight-on mockup reads as a template, a 1° rotation reads as a photographed object.
- **Photography:** none — the product screenshot is the only image, correctly.
- **Phone mockup:** single bezel component reused everywhere (already built), consistent radius, consistent shadow depth — never re-skinned per page.
- **Background:** two soft radial gradient orbits (coral, teal) at low opacity, already built — read as depth without competing with the screenshot.
- **Lighting/mood:** flat, bright, paper-white ground (`#f8f9fb`) — daylight, not moody. This is a tool used at 8am between clients, not a nighttime cinematic pitch.
- **Composition/depth:** three visible depth planes — background orbits (furthest), copy (mid), phone mockup with its own cast shadow (nearest). No fourth plane; more layering reads as busy.
- **White space:** hero padding is already generous (`--space-18` bottom); preserve that ratio into every new section — cramped spacing is the single fastest way to read as a template site.
- **Section transitions:** alternate paper/white backgrounds only where a section genuinely needs separation (Problem, Pricing preview) — not every section, or the rhythm becomes noisy.

### Product
- **Visual objective:** prove each pillar is a real, distinct capability — not three re-skins of the same screenshot.
- **Hero composition:** no separate hero — the page opens directly into the first pillar (Recover), keeping momentum from clicking in off Home.
- **Phone mockups:** three, one per pillar, each showing a genuinely different screen state (a lead mid-pipeline, a review request sent, a reminder due) — never the same screenshot re-cropped.
- **Composition:** alternate mockup side (left/right) per pillar section so the page has visual rhythm scrolling down, not three identical layouts stacked.
- **Color mood:** each pillar gets a restrained accent touch from its assigned token — Recover: coral (already the brand accent), Review: coral (reviews are still the brand's core motion, no second accent needed here), Retain: teal (already reserved for this pillar in the design system) — used only as a thin underline or small icon tint, never a full-section background wash.
- **White space:** wider vertical rhythm between the three pillars than within Home's tighter proof sections — this page rewards a slower read.

### Pricing
- **Visual objective:** make three numbers feel simple, not clinical.
- **Composition:** three cards, equal visual weight except the middle (Pro) card gets a subtle lift — 2px border in coral instead of the default border, not a "MOST POPULAR" ribbon (ribbons read as pressure tactics, at odds with the honesty discipline).
- **Depth:** cards sit on the paper background with the same restrained single-layer shadow as every other card in the system — no extra elevation just because it's the pricing page.
- **Color mood:** calm, not persuasive — pricing pages that over-design (gradients, badges, countdown-style urgency) read as compensating for a weak offer. Chakusa's offer (real free tier, visible numbers) doesn't need that compensation.

### Industries
- **Visual objective:** a barber, dentist, or cleaner reading this page recognizes their own trade within 3 seconds.
- **Composition:** four sections, each anchored, each opening with the trade name as a real heading (not a generic icon grid) followed by 1–2 concrete lines using that trade's actual template language (barber, dentist — the two verticals with real template depth per the Master Plan).
- **Photography (Vision-gated, per Master Plan §6):** until commissioned, use no imagery here at all rather than generic stock icons — plain, confident typography carries this page at V1.

### About
- **Visual objective:** feel like a person wrote it, not a legal team.
- **Composition:** narrow single column, generous line-height, no cards, no grid — the visual opposite of every other page, deliberately. A trust page shouldn't look like a sales page.
- **Color mood:** mostly ink-on-paper, coral used once at most (a single CTA-adjacent accent) — restraint here signals "we're not selling you on this page," which paradoxically sells harder.

---

## PART 3 — Image Production Plan

Every asset required for V1, by page. `Priority` marks build order; nothing outside this table ships at V1.

| Asset | Type | Page / section | Spec | Priority |
|---|---|---|---|---|
| Dashboard hero screenshot | Product screenshot | Home / Hero | 1170×2532, seeded demo data, generic business name (Part 9 fix) | P0 — exists, needs alt-text fix |
| Leads list + detail | Product screenshot ×2 | Home §4, Product / Recover | Same phone-frame component, one "new" lead visible | P0 |
| Rendered SMS bubble | UI snippet, not a screenshot | Home §4, Product / Recover | Small inline component showing one rendered follow-up message | P0 |
| Review Requests list + detail | Product screenshot ×2 | Home §5, Product / Review | Mixed statuses visible (pending/sent/reviewed) | P0 |
| Public feedback page | Screenshot, browser-frame not phone-frame | Product / Review | The unauthenticated customer-facing screen — frame it in a browser chrome to signal "this is what your customer sees," distinct from the owner's phone screens | P0 |
| Comeback / Reminder screen | Product screenshot | Home §6, Product / Retain | At least one "due" reminder with a demo customer name | P0 |
| Favicon | SVG | global | Already exists (`favicon.svg`) | done |
| og:image | Static image, 1200×630 | global meta | Dashboard screenshot on paper background with wordmark — the Stage 7 open item | P0 |
| Section background orbits | CSS gradients, not image files | Home hero only | Already built inline in CSS — no asset needed | done |
| Industry section imagery | none at V1 | Industries | Deliberately typography-only per Part 2 | — |
| Illustration set | none at V1 | — | No illustrations ship at V1 (Master Plan §6) | Vision |
| Empty states (in-app, not website) | out of scope | — | Empty states are product UI, not website assets — not this document's concern | n/a |
| Loading states (website) | none needed | — | Static site, no client data fetching, so no loading states exist to design (Part 4 covers page-load animation instead) | n/a |
| Comparison graphic | none at V1 | — | No `/vs/*` pages exist yet per Master Plan | Vision |
| Testimonial layout (structural template, no content) | Component spec only | Home §8, held/hidden | Card shape reserved: photo, quote, name, business, city, vertical — populated only once real (Master Plan §8) | Vision |
| CTA graphic | none — text + button only | all pages | No decorative CTA graphics; the phone mockups already carry the visual weight | — |

---

## PART 4 — Animation System

Builds on the Master Plan's motion table with per-interaction detail. Every row must degrade to a hard cut (no transition) under `prefers-reduced-motion: reduce`.

| Section / element | Entry | Scroll | Hover | Purpose | Timing | Intensity |
|---|---|---|---|---|---|---|
| Hero (Home) | Copy + phone fade/slide 12px, staggered 60ms | — | — | Orient top-to-bottom on load | 320ms ease-out | Low |
| Problem section | — | Fade + 16px translate, once | — | Pace the reveal of the pain point | 260ms ease-out | Low |
| Journey chips | — | Active step gains weight + underline as it centers in viewport | — | Ties narrative to scroll position — the one functional scroll-linked interaction on the site | 180ms ease-in-out | Low |
| Recover/Review/Retain proof screens | Fade + translate on first view | Message bubble (Recover only) appears once, on view | Phone mockup lifts 2px on hover (desktop only) | Demonstrates without implying live automation | 240ms ease-out | Low |
| Industries strip chips | — | Fade in as a group, once | Underline slides in on hover | Signal these are links, not decoration | 140ms ease-out | Low |
| Pricing cards | Fade in as a group on view | — | Card lifts 2px, border sharpens from `--color-border` to coral on the Pro card only | Reward inspection without a persuasive "pulse" | 160ms ease-out | Low |
| FAQ accordion | — | — | Chevron rotates 180° | Standard, expected | 200ms ease-in-out | Low |
| Primary/secondary buttons | — | — | 1px lift + background shift (built) | Tactile confirmation | 140ms ease-out | Low (already correct — carry forward) |
| Nav on scroll | Header background solidifies past hero | — | — | Legibility once hero background is scrolled past | 200ms ease-out | Low |

**Rule that governs all of it:** every animation on this list earns its place by communicating something (state change, hierarchy, causality). None are ambient/decorative loops — no floating particles, no infinite pulse, no auto-playing carousels. A premium feel comes from *restraint executed precisely*, not from more motion.

---

## PART 5 — Copy Psychology

### Home
- **Hero headline** ("Stop losing customers you never even see leave.") — keeps reading because it's a loss already happening to them, not a future benefit; loss framing outperforms gain framing for a visitor who hasn't yet admitted the problem exists.
- **Subhead** — scrolls because it answers "ok, how?" in one breath, in three verbs (follow up, request, keep coming back) instead of a feature list.
- **Problem section** — trusts Chakusa here because the section doesn't oversell with invented statistics; three plain, checkable truths read as more credible than one dramatic fake number would.
- **Proof sections (Recover/Review/Retain)** — clicks through because each one shows, not tells — a real screen answers "does this actually work" better than another paragraph of copy could.
- **Pricing preview** — moves toward Action because seeing a real, low number removes the single biggest objection ("this is probably expensive/enterprise") before it fully forms.
- **Weak point to fix:** "one simple app" in the meta description is the flattest line on the page — it's true but does no persuasive work. Stronger candidate: **"Everything a missed call, a happy customer, and a lapsed one need — in one app."** Names the three real pillars instead of asserting simplicity abstractly.

### Product
- Keeps reading because each pillar opens with the *outcome* ("Catch the customer before they call someone else") before the mechanism — visitors buy outcomes, not features.
- **Weak point to fix if drafted generically:** avoid any pillar heading that's just the pillar name ("Recover" as a standalone headline) — always pair it with the outcome line, per the Master Plan's own blueprint. A bare feature-name headline is the single most common way this page could drift toward "average SaaS."

### Pricing
- Trusts Chakusa here specifically *because* Business tier says "Contact us" instead of a guessed number — an honest gap reads as more trustworthy than a suspiciously round invented price would.
- Clicks Free because the card can say, plainly, **"No card required."** — three words that remove the last hesitation.

### Industries
- Scrolls to their own section because the page structure (four named categories) makes scanning trivial — a visitor should never have to read copy to find their trade.
- **Weak point to avoid:** don't write generic "built for every business" framing anywhere on this page — the entire point of the page is specificity; generic language here directly undercuts its purpose.

### About
- Trusts Chakusa because the page volunteers what *doesn't* work yet (per the Master Plan's honesty ledger) before being asked — pre-empting the skeptical question is more persuasive than waiting for it.

---

## PART 6 — Conversion Optimization Review

| Page | Friction / gap found | Recommendation |
|---|---|---|
| Home | Both CTAs currently self-reference (`#start-free`) — correctly disclosed as provisional per Stage 7, but this is real friction the moment it's clicked | Wire to app store links as soon as they exist (Master Plan execution plan, task 12) — no design change needed, just the swap |
| Home | Proof section is absent (correctly, per Master Plan §8) — but an absent section can read as an oversight rather than a deliberate choice if there's no transition cue | Let the Pricing preview section immediately follow Industries with no visible gap — the page should feel complete without Proof, not like something is missing |
| Product | Risk of three pillars reading as a repeated template if not visually varied | Alternate mockup side per pillar (Part 2) and vary the outcome-line structure — avoid three sections with identical sentence rhythm |
| Pricing | Business tier's "Contact us" could read as a dead end with no next step | Give it a real, low-friction next step — a `mailto:` or simple form, not a sales-call CTA (matches the "no Book a Demo" rule already locked in the Master Plan) |
| Industries | Four categories with no differentiation in visual weight risks the visitor's trade feeling like an afterthought if it's third or fourth in the list | Order categories by which has the deepest real template support first (Beauty, given barber has the deepest template coverage) rather than an arbitrary order |
| About | Risk of reading as filler if it's too short | Keep it substantive rather than a two-paragraph stub — a thin About page undercuts the trust job it exists to do |
| All pages | No consistent secondary CTA in the footer for a visitor who scrolled the whole page and still isn't ready | Footer should repeat "Start Free" once, plainly, not add a second competing offer (avoids Booksy's multi-CTA clutter noted in Part 2/§2 research) |

**Nothing above adds, removes, or reorders a page or section from the Master Plan** — these are execution-level fixes within the locked architecture.

---

## PART 7 — Mobile Experience

Not "the desktop layout, narrower" — deliberate mobile-specific decisions per page.

- **Home:** hero stacks copy above the phone mockup (already built); journey chips hidden below the `56.25rem` breakpoint in the current build (`display:none` on `.journey`) — **this should be revisited**: on mobile, the journey line is the fastest way to convey the three-pillar structure without scrolling through all three proof sections, so it deserves a compact horizontal chip row on mobile too, not a full removal. Proof sections stack one full-viewport-height section at a time — no side-by-side mockup+copy on mobile, ever.
- **Product:** pillars stack in the same order as desktop; mockup appears above its outcome copy on mobile (reversing desktop's alternating left/right pattern, which has no mobile equivalent) so the visual proof is seen before the reading commitment.
- **Pricing:** three cards stack vertically, Free card first (matches the desktop card order) — never a horizontal-scroll card carousel, which hides cards from a visitor who doesn't know to swipe.
- **Industries:** four categories stack full-width; consider a jump-to-your-trade chip row pinned near the top on mobile, since scrolling past three irrelevant categories to reach the fourth is real friction on a small screen.
- **About:** narrow column already suits mobile natively — minimal adaptation needed.
- **CTAs, all pages:** full-width, thumb-reachable in the lower two-thirds of the viewport — never a CTA requiring a reach to the top corner.
- **Animation on mobile:** all Part 4 animations carry over unchanged in kind, but scroll-triggered reveals should trigger slightly earlier (higher in the viewport) on mobile, where scroll velocity is typically faster and a late-triggering reveal reads as lag.

---

## PART 8 — Premium Design Details

The details that separate an average SaaS site from a considered one, specific to what's already built and what's planned:

- **Spacing rhythm:** the built site already uses a deliberate scale (`--space-2` through `--space-18`) — the discipline to preserve is that *every* new section reuses these exact tokens, never a one-off pixel value invented for a single section.
- **Typography rhythm:** one type scale, already established (H1 clamp `2.5rem→3.8125rem`, body `1.0625rem→1.25rem`) — new pages must extend this scale, not introduce new sizes.
- **Card hierarchy:** exactly one card treatment (border + optional single-layer shadow) reused everywhere — pricing cards, proof cards, FAQ items. A premium site has *fewer* component variants, not more.
- **Depth:** two depth languages only — the phone-mockup shadow (`--shadow-phone`, reserved for device mockups) and the flat card border (everything else). No glassmorphism, no frosted panels — those read as a dated 2021 SaaS trend, not premium, and nothing in Chakusa's built brand uses them.
- **Buttons:** exactly two styles, already built (filled primary, bordered secondary) — the discipline is resisting a third "ghost" or "link" button style creeping in as the site grows.
- **Navigation:** stays at 4 links + 2 CTAs (Master Plan-locked) — the premium signal here is precisely *not* adding a dropdown as new pages arrive; Vision-tier pages get footer links, not nav bloat.
- **Footer:** four columns as locked — restraint here matters as much as the hero; a footer that tries to list every possible link (as GoHighLevel's does, per Part 2 research) is one of the fastest tells of an unconsidered site.
- **Micro-interactions:** focus-visible rings already correctly implemented (`--focus-ring`); the standard to hold going forward is that *every* new interactive element gets one — no exceptions, since a missing focus state is invisible to a mouse user and a hard failure for a keyboard user.
- **Transitions between pages:** none needed or recommended — a static site with instant page loads is itself the premium signal; a page-transition animation would only add perceived latency for no benefit.

---

## PART 9 — Final Creative Review

**Scope note:** this section reviews *creative execution quality* — visual, emotional, and copy craft — against the Master Plan's locked architecture. It does not propose adding, removing, reordering, or restructuring any page or section; the sitemap, page set, and execution order remain exactly as locked.

- **Home** is the strongest page in the plan as specified — problem-first hero, honest zero-state screenshot, no fabricated proof. The one place it currently risks reading as "average SaaS" is the meta description's flat "one simple app" line (see Part 5's suggested rewrite) — the rest of the page already clears the bar.
- **Product** is the page most at risk of feeling templated, specifically because three parallel pillar sections are structurally the easiest layout to build lazily (same mockup position, same sentence shape, repeated three times). Part 2 and Part 5's alternating-layout and varied-sentence-rhythm guidance exist specifically to prevent that outcome — Codex should treat this as a hard requirement, not a nice-to-have.
- **Pricing** currently risks the industry-standard trap of over-decorating the "recommended" tier with a ribbon or badge to manufacture urgency. Reject that instinct — a subtle border treatment (Part 2) does the same signaling job without the pressure-tactic feel that undermines the trust this whole site is built on.
- **Industries** is the page with the least creative direction to draw on (no photography, no product screenshots), which is correct for V1 but means its entire premium feel has to come from typography and spacing discipline alone — this is the page where Part 8's restraint principles matter most, because there's nothing else to lean on.
- **About** should resist the temptation, once written, to pad itself with a team grid or press-logo row that doesn't exist yet — a short, honest About page reads as more premium than a padded one trying to look bigger than it is.
- **On "the website every competitor wishes they had":** the honest answer, given the research in Part 2 and Stage 1's competitor audit, is that no competitor in this category is willing to ship a homepage this narrow, this free of manufactured urgency, or this comfortable showing a real $0 screenshot. That restraint — not a bigger feature list, not flashier motion — is the actual competitive advantage available here, and it's the one thing worth protecting through implementation above everything else in this document.

---

*Chakusa Website Experience & Creative Direction · Companion to `WEBSITE_MASTER_PLAN.md` · Planning document only — no site code written, no pages built, no files in the repository modified beyond this document.*
