# Chakusa web authentication gateway

This Worker is the browser-facing boundary for Chakusa registration, sign-in, business setup, and dashboard reads. It verifies Turnstile on the server, forwards requests through a strict route allowlist, and converts both access and rotating refresh tokens into host-only, HttpOnly, Secure, SameSite cookies. Browser code receives or stores no authentication token.

The Worker enforces the exact production website origin and same-site browser context. It keeps client and business realms separate, retries one protected request after safe refresh-token rotation, applies no-store and browser security headers, and clears both cookies on session failure or sign-out.

`TURNSTILE_SECRET` is a Cloudflare secret binding and must never be committed. The public `API_BASE_URL` is configured in `wrangler.jsonc`.
