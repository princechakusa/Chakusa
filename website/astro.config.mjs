import { defineConfig } from "astro/config";
// Real production domain, purchased via Cloudflare 2026-09-01. Using the
// apex, not www, since no www CNAME/redirect has been confirmed in
// Cloudflare DNS yet. Revisit if www is set up as the canonical host.
//
// Scripts and stylesheets are always emitted as files, never inlined, so the
// dashboard's Content-Security-Policy (DashboardLayout.astro) can allow
// 'self' only, with no 'unsafe-inline'.
export default defineConfig({
  output: "static",
  site: "https://chakusarecovery.com",
  build: { inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
});
