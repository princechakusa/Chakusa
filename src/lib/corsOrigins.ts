// Browser origins allowed to call the API with credentials. The customer web
// origin (PUBLIC_REVIEW_BASE_URL) serves the public share links (/b, /r, /q,
// /i, /team-invite) as a web build of the app, so it must always be allowed,
// whatever CORS_ALLOWED_ORIGINS lists. Returns null when nothing is configured
// so app.ts can apply its development default.
export function buildCorsAllowedOrigins(env: { CORS_ALLOWED_ORIGINS?: string; ADMIN_CONSOLE_ORIGIN?: string; PUBLIC_REVIEW_BASE_URL?: string }): string[] | null {
  const configured = env.CORS_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const origins = [...configured];
  if (env.ADMIN_CONSOLE_ORIGIN) origins.push(env.ADMIN_CONSOLE_ORIGIN);
  const publicOrigin = originOf(env.PUBLIC_REVIEW_BASE_URL);
  if (publicOrigin) origins.push(publicOrigin);
  return origins.length ? [...new Set(origins)] : null;
}

function originOf(url: string | undefined) {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}
