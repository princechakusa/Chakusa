# Chakusa website

The Chakusa marketing site. Astro, static output, fully isolated from
`/src` (backend) and `/mobile` (app), see `docs/WEBSITE_MASTER_PLAN.md`
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
once a real file exists, nothing here ever ships a placeholder or broken
image reference.

- **Industry hero photos**: drop a file at `public/images/industries/{id}.jpg`
  (ids: `beauty`, `professional`, `home-services`, `automotive`, see
  `src/data/industries.ts`). Its chip and hero background layer appear
  automatically on the next build. No code change needed.
- **Product screenshots**: drop files at `public/images/product/*.png`
  matching the names `PillarSection` checks for in `src/pages/product.astro`
  (`leads-list.png`, `reviews-list.png`, `comeback.png`, etc., see that
  file's `hasFile()` checks). A pillar section renders copy-only until its
  screenshot exists.

## Before every release

- `npm run check` must be 0/0/0 (errors/warnings/hints)
- Every claim on every page must still be true against the current
  `EXPO_PUBLIC_*` flag state in `mobile/PRODUCTION_ENVIRONMENT.md` and the
  entitlement values in `src/lib/entitlements.ts`, see the Handbook's
  Part 2 acceptance criteria per page.
- Canonical domain is set to the real `chakusarecovery.com` (purchased via
  Cloudflare 2026-09-01) in `astro.config.mjs`, `public/sitemap.xml`, and
  `public/robots.txt`. One placeholder still blocks launch: the support
  email in `src/pages/about.astro` (`CONTACT_EMAIL@chakusa.com`), marked
  with a `TODO(launch-blocker)` comment.

## Deploying to chakusarecovery.com

This is a static site (`output: "static"`), so any static host works, but
since the domain was bought through Cloudflare, Cloudflare Pages is the
natural fit and needs no origin server:

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
   Connect to Git**, pick this repo.
2. Build settings: root directory `website`, build command `npm run
   build`, output directory `dist`.
3. Once the Pages project deploys to its `*.pages.dev` URL, add
   `chakusarecovery.com` (and `www` if wanted) as a **Custom domain** on
   that Pages project — Cloudflare wires the DNS automatically since the
   domain already lives in the same account.
4. No secrets or environment variables are needed for this build; it's a
   pure static site with no backend calls.

This whole flow happens inside the Cloudflare dashboard the user already
has access to, and doesn't require sharing any account credentials with
an assistant.
