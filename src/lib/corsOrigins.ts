// Browser origins allowed to call the API with credentials. Returns null when
// nothing is configured so app.ts can apply its development default.
export function buildCorsAllowedOrigins(env: { CORS_ALLOWED_ORIGINS?: string; ADMIN_CONSOLE_ORIGIN?: string; PUBLIC_REVIEW_BASE_URL?: string }): string[] | null {
  const configured = env.CORS_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const origins = [...configured];
  if (env.ADMIN_CONSOLE_ORIGIN) origins.push(env.ADMIN_CONSOLE_ORIGIN);
  const publicOrigin = originOf(env.PUBLIC_REVIEW_BASE_URL);
  if (publicOrigin) origins.push(publicOrigin);
  return origins.length ? [...new Set(origins)] : null;
}

// The public web origin (the admin "Website" setting, see publicWebOrigin.ts)
// serves every share link (/b, /r, /q, /i, /team-invite) as a web build of the
// app, so it is always allowed alongside the static list, even after an admin
// changes it. Requests without an Origin header are not cross-origin.
export function isCorsOriginAllowed(origin: string | undefined, input: { allowed: string[] | null; publicWebOrigin: string | undefined; production: boolean }): boolean {
  if (!origin) return true;
  if (input.allowed?.includes(origin)) return true;
  if (origin === originOf(input.publicWebOrigin)) return true;
  return !input.production && input.allowed === null;
}

function originOf(url: string | undefined) {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}
