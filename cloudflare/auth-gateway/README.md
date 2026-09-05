# Chakusa web authentication gateway

This Worker is the browser-facing boundary for Chakusa sign-in. It verifies Turnstile on the server, forwards credentials to the existing API, and converts rotating refresh tokens into host-only, HttpOnly, Secure, SameSite cookies. Browser code receives no refresh token and stores no access token.

`TURNSTILE_SECRET` is a Cloudflare secret binding and must never be committed. The public `API_BASE_URL` is configured in `wrangler.jsonc`.
