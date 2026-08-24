# Chakusa Administration Console

Internal, role-gated administration client for the existing Chakusa API. It does not contain product business logic or connect directly to the database.

## Local development

From the repository root, run the guarded local API and the admin client in separate terminals:

```sh
npm run dev:test
npm run admin:dev
```

Supply backend configuration through the shell or an approved secret manager before starting. Repository `.env` files and templates are intentionally forbidden.

The client is available at `http://localhost:5173` and expects the API at `http://localhost:4000`. Override the API origin with `VITE_API_URL`.

## Production build

```sh
npm run admin:build
```

The static output is written to `admin/dist`. `_redirects` and `_headers` are included for Cloudflare static-assets compatibility. `wrangler.jsonc` deploys the output as a single-page application and contains no secrets.

For the connected Cloudflare Worker, set the root directory to `admin`, the build command to `npm run build`, and the deploy command to `npm run deploy`. Add `VITE_API_URL=https://chakusa-api.onrender.com` as a build variable. The production API must set `ADMIN_CONSOLE_ENABLED=true` and `ADMIN_CONSOLE_ORIGIN` to the exact HTTPS console origin.

## Security model

- Access tokens are kept in memory only.
- Refresh credentials use an HttpOnly, SameSite=Strict cookie.
- Refresh and logout require a session-bound CSRF token.
- Navigation visibility and every API route independently enforce RBAC.
- Guarded controls are limited to canonical, reversible actions: onboarding reset and session revocation.
- Every control requires RBAC, session-bound CSRF, and exact-value confirmation.
- Admin audit records are append-only at the database layer.
