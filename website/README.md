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

Hosted on **GitHub Pages**, not Cloudflare — Cloudflare's only job here is
DNS for the domain, which was bought through Cloudflare but doesn't need
to host anything. `.github/workflows/deploy-website.yml` builds `/website`
and deploys it to GitHub Pages on every push to `master` that touches
`website/`. No API tokens or secrets required — GitHub Pages deploys
authorize themselves via the repo's own built-in permissions.

One-time setup (two manual steps, one per platform):

1. **GitHub** — repo **Settings → Pages → Build and deployment → Source**,
   select **GitHub Actions** (not a branch). This is required once before
   the workflow can successfully deploy.
2. **Cloudflare (DNS only)** — in the DNS tab for `chakusarecovery.com`,
   add:
   - Four `A` records at the apex (`@`) pointing to GitHub Pages' IPs:
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
     `185.199.111.153`
   - (Optional, for IPv6) four `AAAA` records at `@`: `2606:50c0:8000::153`,
     `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - If `www` should also work, a `CNAME` record for `www` pointing to
     `princechakusa.github.io`
   - Set these records to **DNS only** (grey cloud, not proxied) at first,
     so GitHub can issue its own HTTPS certificate for the domain. Once
     "Enforce HTTPS" shows working in GitHub's Pages settings, proxying
     (orange cloud) can be turned on if wanted.
3. Back in GitHub's Pages settings, add `chakusarecovery.com` as the
   custom domain (this reads the `public/CNAME` file already committed in
   this repo, which contains just `chakusarecovery.com`) and wait for the
   DNS check to go green.

This whole flow happens in the GitHub and Cloudflare dashboards the user
already has access to, and needs no account credentials shared with an
assistant.
