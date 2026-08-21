export type PublicPage = 'privacy' | 'terms' | 'support' | 'delete-account';
export type PublicRoute = { kind: 'document'; page: PublicPage } | { kind: 'feedback'; token: string | null } | { kind: 'team-invite'; token: string | null } | { kind: 'business-profile'; slug: string | null } | null;

const pages: Record<string, PublicPage> = { '/privacy': 'privacy', '/terms': 'terms', '/support': 'support', '/delete-account': 'delete-account' };

export function publicRouteFromPath(pathname: string): PublicRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const page = pages[normalized];
  if (page) return { kind: 'document', page };
  if (/^\/r(?:\/|$)/.test(pathname)) {
    const match = pathname.match(/^\/r\/([^/]+)\/?$/);
    if (!match) return { kind: 'feedback', token: null };
    try { return { kind: 'feedback', token: decodeURIComponent(match[1]) }; } catch { return { kind: 'feedback', token: null }; }
  }
  if (/^\/team-invite(?:\/|$)/.test(pathname)) {
    const match = pathname.match(/^\/team-invite\/([^/]+)\/?$/);
    if (!match) return { kind: 'team-invite', token: null };
    try { return { kind: 'team-invite', token: decodeURIComponent(match[1]) }; } catch { return { kind: 'team-invite', token: null }; }
  }
  if (/^\/b(?:\/|$)/.test(pathname)) {
    const match = pathname.match(/^\/b\/([^/]+)\/?$/);
    if (!match) return { kind: 'business-profile', slug: null };
    try { return { kind: 'business-profile', slug: decodeURIComponent(match[1]) }; } catch { return { kind: 'business-profile', slug: null }; }
  }
  return null;
}

export function publicPageTitle(page: PublicPage) {
  return ({ privacy: 'Chakusa Privacy Policy', terms: 'Chakusa Terms of Use', support: 'Chakusa Support', 'delete-account': 'Delete Your Chakusa Account' } as const)[page];
}
