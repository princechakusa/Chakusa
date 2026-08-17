# Chakusa website

The Chakusa marketing site. Astro, static output, fully isolated from
`/src` (backend) and `/mobile` (app) — see `docs/WEBSITE_MASTER_PLAN.md`
at the repo root for the full strategy, `docs/WEBSITE_CREATIVE_DIRECTION.md`
for the visual/tone rules, and `docs/WEBSITE_IMPLEMENTATION_HANDBOOK.md`
for the build plan this was built against.

## Commands

```bash
npm install       # from inside website/, not the repo root
npm run dev        # local dev server
npm run check       # type + accessibility diagnostics (0 errors/warnings before merge)
npm run build       # static build to dist/
npm run preview     # serve the built dist/ locally
```

## Adding real assets (photos, screenshots)

Several components check the filesystem **at build time** and only render
once a real file exists — nothing here ever ships a placeholder or broken
image reference.

- **Industry hero photos**: drop a file at `public/images/industries/{id}.jpg`
  (ids: `beauty`, `professional`, `home-services`, `automotive` — see
  `src/data/industries.ts`). Its chip and hero background layer appear
  automatically on the next build. No code change needed.
- **Product screenshots**: drop files at `public/images/product/*.png`
  matching the names `PillarSection` checks for in `src/pages/product.astro`
  (`leads-list.png`, `reviews-list.png`, `comeback.png`, etc. — see that
  file's `hasFile()` checks). A pillar section renders copy-only until its
  screenshot exists.

## Before every release

- `npm run check` must be 0/0/0 (errors/warnings/hints)
- Every claim on every page must still be true against the current
  `EXPO_PUBLIC_*` flag state in `mobile/PRODUCTION_ENVIRONMENT.md` and the
  entitlement values in `src/lib/entitlements.ts` — see the Handbook's
  Part 2 acceptance criteria per page.
- Two known placeholders block launch until replaced: the canonical domain
  in `astro.config.mjs` (`chakusa.example`) and the support email in
  `src/pages/about.astro` (`CONTACT_EMAIL@chakusa.com`) — both are marked
  with `TODO(launch-blocker)` comments.
