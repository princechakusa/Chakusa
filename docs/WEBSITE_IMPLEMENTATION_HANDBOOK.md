# Chakusa Website Implementation Handbook

*Converts the frozen `WEBSITE_MASTER_PLAN.md` (WHAT) and `WEBSITE_CREATIVE_DIRECTION.md` (HOW) into buildable instructions for Codex. Nothing here introduces a new page, section, sitemap change, or creative decision — every item traces back to one of those two documents. Where a line references its source, it's marked `[MP §x]` or `[CD Part x]`.*

---

## PART 1 — Website Build Order

Sequential. Each step is a merge-able unit; later steps assume earlier ones are done.

| Order | Step | Why this position |
|---|---|---|
| 1 | Fix Home's two open items — alt text, `og:image` | Home already exists; smallest, highest-leverage fix before anything else builds on top of it `[MP §10 task 2]` |
| 2 | Lock final page copy for Product, Pricing, Industries, About | Copy must exist before components are built against it — building components against placeholder copy causes rework `[MP §10 task 1]` |
| 3 | Capture/produce all required screenshots and assets | Every subsequent page build blocks on real assets — no placeholder imagery ships, per the no-fabrication rule `[MP §10 task 3]` |
| 4 | Build shared component library (Part 3 below) | Product, Pricing, Industries, About all draw from the same components — building it once first prevents four divergent implementations |
| 5 | Build `/product` | First new page — highest content-reuse risk (three pillars), per `[CD Part 9]`, so it goes first while creative direction is freshest |
| 6 | Build `/pricing` | Shortest page, lowest risk, good to sequence right after the hardest page |
| 7 | Build `/industries` | Depends on the same component patterns as 5–6 |
| 8 | Build `/about` | Simplest page, deliberately last among content pages — lowest risk of drift from spec |
| 9 | Implement shared motion/scroll-reveal utility across all pages | Motion is consistent only if implemented once, after all pages exist, not per-page ad hoc `[MP §10 task 8]` |
| 10 | Product-truth QA pass across every page | Must run after all copy/pages exist `[MP §10 task 9]` |
| 11 | Accessibility + performance pass | Runs against the finished set, not page-by-page `[MP §10 task 10]` |
| 12 | Replace placeholder domain in `astro.config.mjs` | Blocked externally on domain purchase `[MP §10 task 11]` |
| 13 | Wire real CTA destinations (app store links) | Blocked externally on store listings `[MP §10 task 12]` |
| 14 | Launch | See Part 7 |

---

## PART 2 — Page Specifications

### Home (`/`) — already built, two fixes required

- **Objective:** prove the recover→review→retain loop in one scroll `[MP §5]`.
- **Required assets:** existing dashboard screenshot; **new:** genericized alt text (remove named business), **new:** `og:image` (1200×630, dashboard screenshot + wordmark on paper background) `[CD Part 3]`.
- **Required screenshots:** already in place — Leads, Review Requests, Comeback (verify all three exist in the built page; if any proof section is still text-only, block on Part 4 asset capture).
- **Illustrations:** none `[MP §6]`.
- **Icons:** none beyond what's already built (wordmark mark, arrow glyph).
- **Animations:** hero entry fade/slide, scroll-reveal on Problem/proof sections, journey chip scroll-highlight, message-bubble reveal `[CD Part 4]`. Mobile: journey chips should NOT be `display:none` below the breakpoint — build a compact horizontal chip row instead `[CD Part 7]`.
- **SEO:** title/description already correct; add `og:image` + `twitter:card=summary_large_image` `[stage-7 audit, CD Part 3]`.
- **Accessibility:** already passing (Stage 7 audit) — maintain single H1, focus-visible rings, reduced-motion guards.
- **Acceptance criteria:** alt text contains no named business; `<meta property="og:image">` resolves to a real file; Lighthouse a11y ≥ 95; no automation/WhatsApp/Google-sync/CRM language present anywhere on the page.
- **Definition of done:** both Stage 7 open items closed, page re-audited and re-passed.

### Product (`/product`)

- **Objective:** prove each pillar in outcome terms `[MP §5]`.
- **Required assets:** three phone-mockup screenshots (Leads+message, Review Requests+public link, Comeback), one browser-frame screenshot (public feedback page) `[CD Part 3]`.
- **Illustrations:** none.
- **Icons:** none beyond nav/FAQ chevrons if reused.
- **Animations:** fade/translate entry per pillar section on scroll; message bubble reveal on Recover only `[CD Part 4]`. Alternate mockup side (left/right) per pillar; mobile always shows mockup above copy `[CD Parts 2 & 7]`.
- **SEO:** title/description targeting "review request app," "customer follow-up tool," "comeback reminder app" `[MP §10 task 1 output]`.
- **Accessibility:** one H1 for the page, H2 per pillar, alt text describing each real screen state (no named demo business here either).
- **Acceptance criteria:** three pillars visually distinct (varied mockup position + sentence rhythm — verified against `[CD Part 9]`'s "no templated repetition" requirement); no automation-as-live claim unless `EXPO_PUBLIC_AUTOMATION_ENABLED=true` in prod at merge time `[MP §5]`.
- **Definition of done:** product-truth QA pass (Part 1, step 10) signs off on every claim.

### Pricing (`/pricing`)

- **Objective:** remove pricing anxiety with real numbers `[MP §5]`.
- **Required assets:** none beyond the three-card layout — no photography, no illustration.
- **Animations:** card group fade-in on view; Pro card border sharpens on hover, no ribbon/badge `[CD Parts 4 & 9]`.
- **SEO:** targeting "[category] pricing" `[MP §10]`.
- **Accessibility:** pricing table must be a real `<table>` or equivalent semantic structure for screen readers, not divs-as-table.
- **Acceptance criteria:** Free-tier caps match `entitlements.ts` at merge time, not a hardcoded snapshot; Business tier shows "Contact us," never a number; Free card states "No card required" `[CD Part 5]`.
- **Definition of done:** entitlement values verified against source at merge, not just at spec-writing time.

### Industries (`/industries`)

- **Objective:** trade-specific relevance in 3 seconds `[MP §5]`.
- **Required assets:** none — typography-only at V1 `[CD Part 2]`.
- **Animations:** minimal — group fade-in only.
- **SEO:** four `<h2>`s matching the onboarding category names exactly, targeting industry+category long-tail keywords `[MP §10]`.
- **Accessibility:** each category section gets a stable anchor ID (`#beauty`, `#home-services`, `#automotive`, `#professional`) `[MP §5]`.
- **Acceptance criteria:** category order leads with the vertical with the deepest real template support (Beauty/barber) `[CD Part 6]`; four categories match onboarding's list exactly, no fifth invented category.
- **Definition of done:** anchors verified reachable and stable (future `/industries/[trade]` pages can link to them without breaking).

### About (`/about`)

- **Objective:** carry the trust weight the homepage's Proof section can't `[MP §5]`.
- **Required assets:** none.
- **Animations:** none — plain, single-column, no motion `[CD Part 2]`.
- **SEO:** brand-query targeting.
- **Accessibility:** simplest page in the set — verify heading order only.
- **Acceptance criteria:** no team photos, press logos, or customer counts unless genuinely real `[MP §5]`; page is substantive, not a two-paragraph stub `[CD Part 6]`.
- **Definition of done:** content reviewed against the "what Chakusa does today" honesty requirement.

---

## PART 3 — Component Library

Every reusable component required for V1. Build once in Part 1 step 4; every page consumes from this set only.

| Component | Used on | Notes |
|---|---|---|
| `SiteHeader` | all pages | Already built — 4 nav links + Start Free CTA, no dropdown `[MP §5, CD Part 8]` |
| `SiteFooter` | all pages | **New** — four columns (Product, Company, Legal, Get the app) `[MP §5]` |
| `Hero` | Home only | Already built — page-specific, not reused elsewhere |
| `PhoneMockup` | Home, Product | **Extract from `Hero.astro` into a standalone component** — single bezel, consistent radius/shadow, accepts any screenshot `[CD Part 8]` |
| `BrowserFrame` | Product (public feedback screenshot) | **New** — distinct from `PhoneMockup`, signals "this is the customer's view" `[CD Part 3]` |
| `Button` | all pages | **Formalize existing `.button-primary`/`.button-secondary` CSS classes into a component** — exactly two variants, no third `[CD Part 8]` |
| `PillarSection` | Product | **New** — accepts headline, outcome copy, mockup side (left/right), used 3x |
| `PricingCard` | Pricing (+ Home preview) | **New** — accepts tier name, price, feature list, CTA; Pro variant gets the sharpened-border treatment |
| `PricingTable` | Pricing | **New** — detail comparison table, semantic markup |
| `IndustryCard` | Industries (+ Home strip) | **New** — accepts trade name, one-line copy, anchor target |
| `FAQAccordion` | Home, Pricing | **New** — single reusable accordion item + group |
| `JourneyChips` | Home | **New, extracted from inline hero markup** — Recover/Review/Retain chip row, scroll-highlight behavior, must render (not hide) on mobile `[CD Part 7]` |
| `ScrollReveal` (utility, not visual component) | all pages | **New** — shared IntersectionObserver-based fade/translate utility, `prefers-reduced-motion`-aware, used by every section-entry animation in Part 4 of the Creative Direction |
| `TestimonialCard` | none at V1 | **Structural spec only, do not populate** — build the component shape (photo, quote, name, business, city, vertical) but do not wire it into any page until Master Plan §8's trigger fires |
| `CTASection` | Home (final CTA) | **New** — repeats Start Free + app store badges |

---

## PART 4 — Asset Production

Everything that must exist before the corresponding component/page can be built. Matches Creative Direction Part 3 exactly — no new assets invented here.

| Asset | For | Status | Blocks |
|---|---|---|---|
| Dashboard hero screenshot | Home | Exists — alt text needs fix | Build order step 1 |
| `og:image` (1200×630) | Home, sitewide fallback | **Missing — produce first** | Build order step 1 |
| Leads list + detail screenshots | Home, Product | Verify exist / capture with seeded demo data | Build order step 3 |
| Rendered SMS bubble snippet | Home, Product | Verify exist / build as inline component, not an image | Build order step 3 |
| Review Requests list + detail screenshots | Home, Product | Verify exist / capture | Build order step 3 |
| Public feedback page screenshot | Product | **Capture new — needs browser-frame treatment** | Build order step 3, blocks `BrowserFrame` use |
| Comeback/Reminder screenshot | Home, Product | Verify exist / capture | Build order step 3 |
| Favicon | sitewide | Exists (`favicon.svg`) | none |
| Industry imagery | Industries | **None required — typography-only at V1** `[CD Part 2]` | n/a |
| Illustrations | any | **None at V1** `[MP §6]` | n/a |
| Icons | nav, FAQ | Reuse existing minimal line style; no new icon set needed | none |
| Background patterns | any | **None** — CSS gradient orbits only, already inline, no image asset | n/a |
| Testimonial photography | Home (Vision) | **Do not produce** until Master Plan §8's trigger fires | Vision-gated |

All screenshots must use seeded/demo data, never real customer records (repeats Stage 3's data-seeding note).

---

## PART 5 — Codex Implementation Order

| ID | Description | Depends on | Acceptance criteria | Effort |
|---|---|---|---|---|
| T1 | Fix Home `og:image` + alt text | — | Meta tag resolves; alt text has no named business | S |
| T2 | Extract `PhoneMockup` from `Hero.astro` into standalone component | — | Home renders identically after refactor | S |
| T3 | Build `Button` component from existing CSS classes | — | Home's buttons render identically after refactor | S |
| T4 | Build `SiteFooter` | — | Four columns, links resolve (internal anchors/pages only — no dead links) | S |
| T5 | Build `ScrollReveal` utility | — | Works on Home's existing scroll sections without visual regression; respects `prefers-reduced-motion` | M |
| T6 | Extract `JourneyChips`, fix mobile visibility | T5 | Renders on mobile as a compact row, not hidden | S |
| T7 | Capture/verify all Part 4 screenshots | — | Every asset in Part 4's table exists at the specified spec | M |
| T8 | Build `PillarSection` component | T2, T3 | Accepts left/right mockup position prop | M |
| T9 | Build `BrowserFrame` component | — | Distinct visual treatment from `PhoneMockup` | S |
| T10 | Build `/product` page | T7, T8, T9 | Three pillars visually distinct per `[CD Part 9]`; product-truth ledger satisfied | M |
| T11 | Build `PricingCard` + `PricingTable` | T3 | Free/Pro/Business render with live entitlement values | M |
| T12 | Build `/pricing` page | T11 | Business tier shows "Contact us"; Free shows "No card required" | S |
| T13 | Build `IndustryCard` | — | Accepts anchor target | S |
| T14 | Build `/industries` page | T13 | Four sections match onboarding categories exactly, ordered by template depth | S |
| T15 | Build `FAQAccordion` | — | Keyboard-operable, `aria-expanded` state | S |
| T16 | Wire FAQ into Home + Pricing | T15 | Both pages' FAQs use the shared component | S |
| T17 | Build `/about` page | — | No team/press/count claims unless real | S |
| T18 | Build `CTASection`, wire into Home | T3 | Repeats Start Free + app store badges | S |
| T19 | Apply `ScrollReveal` across Product/Pricing/Industries | T5, T10, T12, T14 | Consistent entry animation sitewide | S |
| T20 | Product-truth QA pass, all pages | T10, T12, T14, T17 | Zero claims outside Master Plan §5's ledgers | M |
| T21 | Accessibility pass (contrast, focus, heading order, reduced motion) | T20 | Lighthouse a11y ≥ 95 all pages | M |
| T22 | Performance pass (image formats, dimensions, CLS) | T20 | Lighthouse perf ≥ 95 all pages | M |
| T23 | Replace placeholder domain in `astro.config.mjs` | external: domain purchased | Canonical URLs resolve to real domain | S |
| T24 | Wire real CTA destinations | external: store listings live | No `#start-free` self-references remain | S |

*Effort scale: S = under half a day, M = up to 2 days. No task in this plan is sized L — the V1 scope is intentionally small (Master Plan §1).*

---

## PART 6 — Quality Checklist

**Desktop (≥1200px)**
- [ ] All five pages render at 1440px and 1920px without horizontal scroll
- [ ] Hero two-column grid engages correctly at the `56.25rem` breakpoint
- [ ] Nav stays 4 links + CTA, no wrap/overflow

**Tablet (~768–1024px)**
- [ ] No component breaks between the mobile and desktop breakpoints (check the gap explicitly, not just the two endpoints)
- [ ] Pricing cards remain legible in a 2-up or stacked layout, never cramped 3-up

**Mobile (≤480px)**
- [ ] All CTAs full-width, thumb-reachable in lower two-thirds `[CD Part 7]`
- [ ] Journey chips render as a compact row, not hidden `[CD Part 7]`
- [ ] No horizontal overflow on any page
- [ ] Phone-mockup images scale without distortion

**Accessibility**
- [ ] Single H1 per page, no skipped heading levels
- [ ] All interactive elements keyboard-reachable with visible focus state
- [ ] All images have accurate, non-fabricated alt text
- [ ] `prefers-reduced-motion` disables every animation in Part 4, not just slows it
- [ ] Color contrast meets WCAG AA for all text/background pairs, both themes if dark mode is added

**SEO**
- [ ] Unique title + description per page
- [ ] `og:image` present sitewide
- [ ] Canonical URL resolves to the real domain (post-T23)
- [ ] FAQ schema markup on Home/Pricing FAQ sections (structured data — verified against real content only, per Master Plan §4's "no schema until facts are verified" rule)

**Performance**
- [ ] LCP < 2.0s, CLS < 0.1, INP < 200ms on every page `[MP §12]`
- [ ] All images AVIF/WebP with explicit dimensions
- [ ] Zero client JS beyond `ScrollReveal`'s IntersectionObserver and the FAQ accordion's toggle

**Lighthouse**
- [ ] Performance ≥ 95, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95 on all five pages

**Browser compatibility**
- [ ] Latest Chrome, Safari, Firefox, Edge — desktop and mobile
- [ ] iOS Safari specifically checked (largest share of the target visitor's likely device, given the product is a mobile app)

---

## PART 7 — Launch Checklist

- [ ] All five V1 pages built and passing Part 6 in full
- [ ] Product-truth QA pass (T20) signed off — every claim traced to a real, currently-live capability
- [ ] Real production domain confirmed and wired (T23) — placeholder `.example` domain fully removed
- [ ] Real app store links wired into every CTA (T24) — no remaining self-referencing anchors
- [ ] `robots.txt` and `sitemap.xml` present and correct for the five live routes
- [ ] A real 404 page exists (not specified in the Master Plan's sitemap since it isn't a navigable page, but required for any live static site)
- [ ] Static hosting/CDN target selected and deployed per `WEBSITE_MASTER_PLAN`'s Stage-1 hosting decision (independent of the backend's Render deployment)
- [ ] No references anywhere in `/website` to `/src`, `/mobile`, or `/prisma` — isolation re-verified at launch, not just at Stage 1
- [ ] No analytics/tracking scripts added without a documented reason (none were planned; if one is added later, it needs its own privacy-policy update)
- [ ] Privacy and Terms pages exist and are linked from the footer (content sourced from legal review, not invented — per Master Plan §10 task list note)
- [ ] Final full read-through of every page's copy against Master Plan §5's product-truth ledgers, dated at the actual moment of launch, not against this handbook's writing date — flag-state (`EXPO_PUBLIC_AUTOMATION_ENABLED`, `EXPO_PUBLIC_BILLING_ENABLED`) rechecked one last time before copy goes live

---

*Chakusa Website Implementation Handbook · Companion to `WEBSITE_MASTER_PLAN.md` and `WEBSITE_CREATIVE_DIRECTION.md`, both frozen and unchanged. Planning document only — no site code written, no components built, no files in the repository modified beyond this document.*
