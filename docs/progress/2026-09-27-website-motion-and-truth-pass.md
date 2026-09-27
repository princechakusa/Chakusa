# Website motion, length, and product-truth pass

**Date:** 2026-09-27
**Scope:** `website/` only (public Astro marketing site). No backend, mobile, or schema changes.
**Status:** Complete for this pass. Physical-device review of the animations remains part of the release QA gate.

## Owner direction

The owner asked for real, physics-based marketing animation (motion.dev style), shorter pages across the whole site, and a crawl-and-improve pass, acting as the product owner. This supersedes the "no ambient loops" rule in `WEBSITE_CREATIVE_DIRECTION.md` Part 4 (see the amendment note there). The honesty rules are unchanged and were tightened. See "Product-truth fixes" below.

## Baseline inspected

- Astro 5 static site, shared `MarketingLayout`, per-page CSS, CSS scroll-timeline reveals only.
- Homepage hero was a centred text block with a small illustration; the product was never shown in use.
- Page lengths at 1440px: home 6.9k, enquiries 10.2k (with horizontal overflow), industry pages 5.0–6.0k, product 5.9k, about 5.5k, how-it-works 5.2k, pricing 4.7k.

## Architecture reused / added

- **Motion** (`motion` npm package, motion.dev vanilla API). It is the only new dependency.
- `src/scripts/motionFx.ts`: an opt-in physics layer driven by data attributes, loaded by `MarketingLayout`. It handles spring word reveals (automatic on plain-text `main h1/h2`), magnetic CTAs, 3D tilt cards, parallax, scroll-velocity marquees, cursor spotlight, scroll-scrubbed copy, replaying in-view demos, and a scroll-progress CSS variable.
- `components/homepage/HeroLoopDemo.astro` + `scripts/heroLoop.ts`: the looping demo of the real business app. It walks one customer through the loop: missed call → lead → template reply sent by a person → booking → review request → due back.
- `components/motion/ScrollStory.astro` + `scripts/scrollStory.ts`: a pinned phone whose screen swaps as steps scroll past (on mobile, each step gets an inline preview). The screens use `styles/app-mock.css`, whose tokens mirror `mobile/src/experience/businessTheme.ts`.
- `components/motion/TradeCycler.astro`: trade/case-study tabs over one springing panel. It replaces six-card grids.
- `components/motion/TradeMarquee.astro`: two counter-scrolling rows of trade links.
- `components/how-it-works/HowStitchJourney.astro`: a synchronized customer/business stepper.

Every animation pauses off-screen and in background tabs. Autoplaying demos have visible pause control or hand over to the visitor on interaction. Under `prefers-reduced-motion`, nothing moves and the static frames stay readable.

## Product-truth fixes (important)

Live pages contained fabricated content presented as fact. It is now removed:

- `/business`: a named testimonial ("Sarah Jenkins", city, stock photo, quotes, "+38% Repeat Clients"); invented metrics ("4.98 ★ / 342 Verified", "86.4% Retention Health"); named fake customer reviews; an AI described as replying with pricing within 30 seconds and capturing Stripe deposits.
- `/client`: fabricated ratings, reviews, and loyalty figures.
- `/how-it-works`: "94% Conversion", "+28% Bookings", "3.4x Higher LTV", "76% fewer no-shows", "99.99% uptime", "Guild points", wallet passes, "cryptographically tied" reviews, Outlook sync, automatic missed-call texting, and autonomous retention.
- `/contact`: "cryptographic deletion audits".

The replacement copy is checked against the existing ledgers (`data/how-it-works.ts`, `data/enquiries.ts`) and the code:

- Automation is off in shipped builds.
- Lead replies are prepared from templates and sent by a person (Copy / Open SMS / Open WhatsApp).
- Missed-call capture is Android-only.
- Confirmation and reminder SMS are real (`appointmentReminders.ts`).
- Review requests are ungated.
- Customer-mode features come from `mobile/src/customer/screens`.

The old Stitch business/client components, their data files, and the stock photo are deleted, so they can't be reused by accident.

## Pages rebuilt / shortened (desktop px)

| Page | Before | After |
|---|---|---|
| Home | 6,861 | 5,024 |
| Features / Enquiries | 10,201 | 5,277 |
| Industry pages (13) | 5,000–6,000 | 4,100–4,950 |
| Product | 5,871 | 4,613 |
| About | 5,489 | 4,190 |
| How it works | 5,188 | 3,750 |
| Pricing | 4,714 | 3,254 |

The whole site also got tighter section spacing, two-column FAQs on desktop, and `overflow-x: clip` on `main`.

## Authorization / tenant / security

The site is static. It has no auth, no tenant data, and no new network calls. Motion is bundled locally with no third-party runtime origin. All demo names are fictional and labelled as demo data.

## Tests / checks

- `astro check`: 0 errors, 0 warnings.
- Playwright crawl from `/` across 52 pages: 0 non-200 links, 0 JavaScript errors, no horizontal overflow at 1440px or 390px, exactly one H1 per page.
- Reduced-motion run: nothing autoplays, and no visible content is hidden.
- The scroll story's step tracking and the stepper/cycler auto-advance were each verified in the browser.

## Unresolved / follow-ups

- The Stitch image API was not used. The product is shown with live HTML/CSS mocks of the real app instead of generated images, which is sharper, animatable, and cannot drift from the product. **The API key shared in the session should be revoked.**
- Other Stitch-era copy uses marketing phrasing ("masters of their craft") that is not factually wrong but could be tightened in a later copy pass.
- Visual QA on a physical iPhone and Android device (release gate).

## Follow-up pass (same day)

- `/contact` rebuilt (3.4k → 1.7k px). Removed promises nobody had established: "< 2h" response SLA, "90-second dispatch", live operator hours, "tier-1 engineering", "zero-knowledge tokenization", and free data migration. Also removed the stock "support specialist" photo and an unrelated Google Maps location panel. The mailto form stays. The FAQs are verified against the business data export and the booking-link cancel/reschedule flow (`cancelPublicBooking`, notice window).
- "No credit card required" removed from 8 CTAs. Trials are App Store / Google Play subscription trials (`subscriptionReconciliation.ts`), and the stores normally require a payment method.
- Verified and kept: "No account required to book" (public, rate-limited `POST /:slug/book` plus token-based manage links).
- `astro build` succeeds. Motion ships as one shared chunk of about 54 KB raw.

## Commits

`df54cba`, `5b82946`, `3f37a52`, `d0d3567`, `083e67b`, `f2cd8e8`.

## Next

Continue the master roadmap. Website follow-ups: a copy pass on the remaining Stitch-era phrasing, and a Lighthouse run against the deployed build.
