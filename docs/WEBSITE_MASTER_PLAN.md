# Chakusa Website Master Plan

*Stage 8 of the Chakusa website strategy work. Planning only — no site code, no pages built. This document is the single source of truth for building the Chakusa marketing site, split into what ships now (**V1**) versus what the site grows into once the product and proof catch up (**Vision**).*

---

## 1. Reconciling the brief

The request behind this document asked for invented testimonials, statistics, and case studies, plus a 25+ page sitemap (API docs, Changelog, Affiliate, Careers, Status). That's in direct tension with two rules already locked earlier in this engagement:

- **No fabricated proof, ever** (Stage 1, §15/§20; reaffirmed in Stage 7's homepage audit) — no invented testimonials, customer counts, logos, or statistics.
- **The smallest sitemap that can scale** (Stage 3, §3) — not a 25-page architecture built before there's content or proof to fill it.

Both rules stand. This document resolves the tension by tagging every page, route, and asset **V1** or **Vision**:

| Tier | Meaning | Purpose |
|---|---|---|
| **V1** | Matches what the product can prove today. No fabricated content anywhere. | What actually gets built next. |
| **Vision** | The full-scale site Chakusa grows into — structurally planned now so nothing gets rebuilt later. | North star. Each Vision item names the real-world trigger that unlocks it (first paying customer, automation flag going live, a real security review existing) — never a date. |

Chakusa has zero real customers today. No testimonials, reviews, logos, or usage statistics exist to draw on. Testimonials and statistics appear below as **structural templates** — the exact shape they'll take once real — never as invented quotes or numbers (see §8).

---

## 2. Competitor research synthesis

Extends Stage 1's competitor matrix with UX, motion, and photography specifics.

| Vendor | Does well | Does badly | Feels dated / generic |
|---|---|---|---|
| **Podium** | Confident hero type; real screenshots in browser chrome | Demo-gated everything; logo wall overload | Stock "diverse team high-fiving" photography |
| **Birdeye** | Dense proof (award badges, G2 scores) | 40+ link mega-menu; pricing fully hidden | Generic blue-gradient hero |
| **NiceJob** | Fastest-to-understand hero in the set; one number, one CTA | Thin product depth past the pitch | — |
| **Broadly** | Warm, plain-spoken copy | Visually flat, low craft | Icon-plus-headline grid, repeated 6x |
| **GlossGenius** | Best photography of the set — real stylists, natural light | Pricing requires a click-through | — |
| **Booksy** | Strong two-sided (pro vs. client) storytelling | 3 competing CTAs per screen | Emoji as section markers |
| **Jobber** | Best industry-page execution — tailored photo + copy per trade | Homepage assumes crew/dispatch, alienates solo operators | — |
| **Housecall Pro** | "How it works" is a genuine, correctly-used sequence | Feature-count arms race in the nav | Purple-blue gradient hero |
| **GoHighLevel** | Strong self-serve trial funnel; education flywheel | Tries to sell 6 products at once, no single thesis | Badge/gradient saturation everywhere |

**Customer complaints (pattern across the category):** price surprises after a "book a demo" call, sales-rep-gated onboarding, feature bloat, "built for franchises, not for me."

**Adopt:** Jobber's per-trade photography; NiceJob's single-thesis hero; Housecall Pro's genuine step-sequence; GlossGenius's native-feeling phone mockups over staged dashboards.

**Reject:** demo-gated pricing; mega-menu navigation; multi-product homepages with no thesis; the generic gradient-hero-plus-stock-photo formula shared by half the category.

---

## 3. "The Apple of local business software"

Not a visual reference — a discipline reference. Three rules:

1. **One thesis per page.** The homepage proves the loop exists; pricing proves it's affordable. No page tries to prove everything at once.
2. **Show, minimally.** The product is the hero image — real screens, not illustration. One screenshot said well beats five said quickly.
3. **Say the true thing plainly.** No overselling what a feature does — every page below carries its own product-truth ledger.

---

## 4. Complete sitemap

```
V1 — ships now, unchanged from Stage 3's lock
  /                     home
  /product              Recover · Review · Retain
  /pricing              Free / Pro / Business
  /industries           Beauty · Home services · Automotive · Professional
  /about                trust, story, product-status honesty
  /login, /get-started  utility
  /privacy, /terms      legal

Vision — route reserved only, no page/copy/asset implied to exist yet
  /industries/barber, /industries/dentist, ...   unlock: /industries validates search demand
  /recover /review /retain (standalone)          unlock: pillars need independent SEO depth
  /vs/podium /vs/nicejob ...                     unlock: feature parity honest enough to compare
  /customers, /case-studies/[slug]               unlock: first real, consenting customer story
  /resources, /blog                              unlock: real editorial cadence + writer
  /help                                          unlock: support volume justifies a public KB
  /changelog                                     unlock: automation/billing flags flip
  /status                                        unlock: a public uptime SLA is actually offered
  /security                                      unlock: a real security review/cert exists
  /api                                           unlock: a public API is actually built (none today)
  /careers                                       unlock: hiring, with real open roles
  /partners, /affiliate                          unlock: a real partner/affiliate program operates
  /contact                                       deliberately folded into /about + footer at V1
```

---

## 5. Page-by-page blueprints — V1

### Home (`/`)
- **Purpose:** prove the recover → review → retain loop exists, in under 30 seconds.
- **Target visitor:** cold, a solo/small local-service owner who just felt the problem.
- **Conversion goal:** Start Free (routes to app download until web signup/billing is live).
- **Product-truth ledger:** per Stage 7's audit — no automation claim, no WhatsApp, no Google-sync, no CRM language. Two open fixes: genericize the dashboard screenshot's alt text (drop the named business), add `og:image`.
- **Sections:** Hero (problem-first headline + phone mockup) → Problem (three plain sentences, no fabricated stats) → The journey (locked positioning line, scroll-linked step highlight) → Recover/Review/Retain proof (one real screen each) → Industries strip → Proof (Vision-gated, omitted at V1 rather than shown empty) → Pricing preview → FAQ → Final CTA + footer.

### Product (`/product`)
- **Purpose:** prove each pillar in outcome terms, not schema terms.
- **Product-truth ledger:** describe missed-call follow-up as automatic only once `EXPO_PUBLIC_AUTOMATION_ENABLED=true` in production — until then, "trackable," not "automatic." Lead with the private-feedback-before-public-review flow — genuinely differentiating. No automated retention trigger exists yet — describe reminders as owner-reviewed, not self-firing.
- **Sections:** Recover (Leads + rendered SMS) → Review (Review Requests + public feedback page) → Retain (Comeback screen) → journey recap + CTA.

### Pricing (`/pricing`)
- **Purpose:** remove pricing anxiety with real, visible numbers.
- **Product-truth ledger:** Free-tier caps sourced live from `entitlements.ts`, never hardcoded stale. Pro price marked store-authoritative. Business price is never invented — "Contact us."
- **Sections:** three-card comparison → detail table → billing FAQ.

### Industries (`/industries`)
- **Product-truth ledger:** four categories must match onboarding exactly. Lean on barber/dentist/restaurant — the only three with real template depth in `defaultTemplates.ts`.
- **Sections:** four category sections with stable anchor IDs (`#beauty`, etc.) so Vision-tier standalone pages can link back without breaking URLs.

### About (`/about`)
- **Purpose:** carry the trust weight the homepage's Proof section can't yet carry.
- **Product-truth ledger:** no team photos/press/awards unless genuinely real; no customer counts.
- **Sections:** founder/story → "what Chakusa does today" → security & privacy principles (real specifics, not "bank-level security").

---

## 6. Image system

**Build now (V1):** real phone-frame mockup (already built in `Hero.astro`) · soft ambient gradient blobs at low opacity, brand coral + teal · true device shadow, no glass panels · one real screenshot per hero, never a composite of fake screens.

**Hold until real (Vision):** floating "automation" notification cards (implies live automation — hold until the flag ships) · revenue widgets beyond the app's own real `recoveredRevenue` figure · animated multi-screen sequences.

**Photography brief (Vision, once commissioned):** real trade owners across the four supported verticals, mixed gender/age, mid-task and unposed, real work attire, the real workplace (barber chair, van, treatment room), natural/practical light, 35–50mm equivalent, shallow depth of field. No stock photography, no generic office/coffee-shop settings. Gate: no photography ships at V1 — the dashboard screenshot carries the full visual load, correctly per Stage 7.

**Illustration & icons:** no illustration at V1. If ever introduced, simple two-tone line style in coral/ink — never a "flat SaaS character" illustration. One functional line-icon set, used only where interactive (FAQ chevrons, nav) — never decorative icon-per-heading rows.

---

## 7. Motion system

| Moment | Motion | Duration / easing | Purpose |
|---|---|---|---|
| Hero load | Copy + phone mockup fade/slide up, 12px, staggered 60ms | 320ms ease-out | Orient attention without a splash effect |
| Scroll reveal | Fade + 16px translate, once per element | 260ms ease-out | Paces reading, never loops |
| Journey step highlight | Active step gains weight + coral underline on scroll | 180ms ease-in-out | Ties narrative to scroll position |
| Message bubble (Recover proof) | SMS bubble appears once, on scroll-into-view | 240ms ease-out | Demonstrates follow-up without implying live automation |
| Buttons / nav CTA | 1px lift + background shift on hover, 1px depress on active | 140ms ease-out (already built) | Tactile confirmation — carry forward exactly |
| FAQ accordion | Height + opacity expand/collapse | 200ms ease-in-out | Standard, expected behavior |

**Global rule:** every animation above must no-op under `prefers-reduced-motion: reduce` — already correctly implemented site-wide per Stage 7. No animation library needed; CSS transitions + one IntersectionObserver covers all of it.

---

## 8. Testimonial & statistic framework

**Testimonial slot (Vision).** Fields: quote, name, business name, city, vertical, photo (with consent), one real metric if the owner shares one. Trigger: first real, consenting customer. Rule: a slot with zero entries stays empty or hidden — never filled with a placeholder that reads as real.

**Statistic slot (Vision).** Only two kinds of number are ever eligible: figures the product itself computes live (like `recoveredRevenue`), surfaced in aggregate with real user consent; or an independently citable, sourced, linked third-party industry statistic. Rule: no "X% more reviews" / "Y hours saved" claim without a measured study behind it.

---

## 9. Design system

Extends the tokens already live in `website/src/styles/global.css` — this documents and completes the built brand, it doesn't replace it.

**Color:** `#ff5c5c` coral (accent, sparing use) · `#20242b` ink (text) · `#686e79` ink-soft (secondary) · `#35d0ba` success/teal (reserved for the Retain pillar and positive states — never a second general accent) · `#f5b942` attention · `#f8f9fb` paper (background) · `#e8eaf0` border.

**Type:** single system font stack (`Inter, ui-sans-serif, system-ui...`) — already correct: zero webfont fetch, zero font-swap layout shift. H1 at weight 800, tracking `-0.045em`; body at `1.0625rem`/1.55 line-height; eyebrows uppercase, weight 800, tracking `.12em`.

**Spacing/grid/components:** content width `min(100% - 5rem, 81rem)` (`.content-shell`, already built) · control radius `.75rem` · pill radius `999px` · phone-mockup shadow reserved for device mockups only, never applied to ordinary cards · one filled primary button (coral) + one bordered secondary — no third button style, ever.

---

## 10. Execution plan

Ordered by priority. **Claude** = product-truth-sensitive work (copy, fact verification, content structure). **Codex** = implementation-heavy work (components, build tooling). **Both** = paired review required before merge.

| # | Task | Owner | Depends on |
|---|---|---|---|
| 1 | Lock final copy for Product, Pricing, Industries, About against §5's product-truth ledgers | Claude | — |
| 2 | Fix Stage 7's two open items on Home (alt text, `og:image`) | Both | — |
| 3 | Capture required product screenshots with seeded demo data | Claude | — |
| 4 | Build `Product.astro` + three pillar components | Codex | 1, 3 |
| 5 | Build `Pricing.astro`, sourcing tier caps live from `entitlements.ts` shape | Codex | 1 |
| 6 | Build `Industries.astro` with the four anchor sections | Codex | 1, 3 |
| 7 | Build `About.astro` | Codex | 1 |
| 8 | Implement motion system (§7) as a shared scroll-reveal utility | Codex | 4, 5, 6 |
| 9 | Product-truth QA pass: every sentence checked against live `EXPO_PUBLIC_*` flag state at merge time | Claude | 4–8 |
| 10 | Accessibility + performance pass (contrast, Lighthouse, reduced-motion) | Both | 4–8 |
| 11 | Replace `astro.config.mjs` placeholder domain once production domain is confirmed | Codex | external: domain purchased |
| 12 | Wire real CTA destinations once app store links exist, replacing the disclosed provisional anchors | Codex | external: store listings live |
| 13 | Launch V1 | Both | 1–12 |

**Vision tier — each gated by its §4 trigger, not scheduled here:**

| Task | Owner | Trigger |
|---|---|---|
| Build first real testimonial slot on Home's Proof section | Claude | first consenting customer |
| Stand up `/industries/[trade]` pages from existing anchor content | Codex | `/industries` search demand validated |
| Update Product copy to claim live automation | Claude | `EXPO_PUBLIC_AUTOMATION_ENABLED=true` in prod |

---

*Chakusa Website Master Plan · Stage 8 · Planning document only — no site code written, no pages built.*
