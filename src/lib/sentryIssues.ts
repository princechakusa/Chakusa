import { loadPlatformProviderSecretOverrides } from "./platformProviderSecrets.js";

// Reads Sentry issues for the admin Issues page through Sentry's web API.
// Sentry stays the source of truth (nothing is copied into our database).
// The auth token is stored encrypted (SENTRY_AUTH_TOKEN provider secret) and
// never leaves the server. User identity (email, IP, username) is stripped
// from everything returned: the page needs what broke, not who it broke for.

type Fetch = (url: string, init: { method?: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const SENTRY_ISSUE_STATUSES = ["unresolved", "resolved", "ignored"] as const;
export const SENTRY_PERIODS = ["24h", "14d", "90d"] as const;
export type SentryIssueStatus = (typeof SENTRY_ISSUE_STATUSES)[number];
export type SentryPeriod = (typeof SENTRY_PERIODS)[number];

export interface SentryIssueSummary {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: string;
  status: string;
  project: string;
  events: number;
  users: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
}

export interface SentryFrame { file: string; fn: string; line: number | null; inApp: boolean }
export interface SentryIssueDetail extends SentryIssueSummary {
  exception: Array<{ type: string; value: string; frames: SentryFrame[] }>;
  tags: Array<{ key: string; value: string }>;
  release: string | null;
  environment: string | null;
  latestEventAt: string | null;
}

export class SentryUnavailableError extends Error {}

const SENTRY_URL = "https://sentry.io";
// Tags that identify a person; never shown in the console.
const PERSONAL_TAGS = new Set(["user", "user.email", "user.ip", "user.username", "user.id", "ip", "email"]);

interface Connection { token: string; org: string; base: string }

async function connect(fetchImpl: Fetch): Promise<Connection | null> {
  const token = (await loadPlatformProviderSecretOverrides()).SENTRY_AUTH_TOKEN;
  if (!token) return null;
  const orgs = await call<Array<{ slug: string; links?: { regionUrl?: string } }>>(fetchImpl, token, `${SENTRY_URL}/api/0/organizations/`);
  const org = orgs[0];
  if (!org) throw new SentryUnavailableError("The Sentry token has no organization.");
  return { token, org: org.slug, base: (org.links?.regionUrl ?? SENTRY_URL).replace(/\/$/, "") };
}

async function call<T>(fetchImpl: Fetch, token: string, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response;
  try {
    response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SentryUnavailableError("Could not reach Sentry.");
  }
  if (response.status === 401) throw new SentryUnavailableError("Sentry rejected the token. Replace SENTRY_AUTH_TOKEN in Settings.");
  if (response.status === 403) throw new SentryUnavailableError("The Sentry token is missing a permission (needs org:read, project:read, event:read; event:write to resolve).");
  if (!response.ok) throw new SentryUnavailableError(`Sentry answered HTTP ${response.status}.`);
  return (await response.json()) as T;
}

type RawIssue = { id: string; shortId?: string; title?: string; culprit?: string; level?: string; status?: string; count?: string | number; userCount?: number; firstSeen?: string; lastSeen?: string; permalink?: string; project?: { slug?: string } };

function summarize(raw: RawIssue): SentryIssueSummary {
  return {
    id: String(raw.id),
    shortId: raw.shortId ?? "",
    title: raw.title ?? "(no title)",
    culprit: raw.culprit ?? "",
    level: raw.level ?? "error",
    status: raw.status ?? "unresolved",
    project: raw.project?.slug ?? "",
    events: Number(raw.count ?? 0),
    users: Number(raw.userCount ?? 0),
    firstSeen: raw.firstSeen ?? "",
    lastSeen: raw.lastSeen ?? "",
    permalink: raw.permalink ?? "",
  };
}

export async function listSentryIssues(
  filters: { status: SentryIssueStatus; period: SentryPeriod; project?: string; search?: string },
  fetchImpl: Fetch = fetch as unknown as Fetch,
): Promise<{ configured: boolean; org?: string; projects: Array<{ id: string; slug: string; name: string }>; items: SentryIssueSummary[] }> {
  const conn = await connect(fetchImpl);
  if (!conn) return { configured: false, projects: [], items: [] };
  const projects = (await call<Array<{ id: string; slug: string; name: string }>>(fetchImpl, conn.token, `${conn.base}/api/0/organizations/${conn.org}/projects/`))
    .map((p) => ({ id: String(p.id), slug: p.slug, name: p.name }));
  const params = new URLSearchParams({ query: [`is:${filters.status}`, filters.search?.trim()].filter(Boolean).join(" "), statsPeriod: filters.period, sort: "date", limit: "100" });
  const project = filters.project ? projects.find((p) => p.slug === filters.project) : undefined;
  if (project) params.set("project", project.id);
  const issues = await call<RawIssue[]>(fetchImpl, conn.token, `${conn.base}/api/0/organizations/${conn.org}/issues/?${params}`);
  return { configured: true, org: conn.org, projects, items: issues.map(summarize) };
}

type RawEvent = {
  dateCreated?: string;
  release?: { version?: string } | string | null;
  tags?: Array<{ key: string; value: string }>;
  entries?: Array<{ type: string; data?: { values?: Array<{ type?: string; value?: string; stacktrace?: { frames?: Array<{ filename?: string; absPath?: string; function?: string; lineNo?: number; inApp?: boolean }> } }> } }>;
};

export async function getSentryIssue(id: string, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<SentryIssueDetail> {
  const conn = await connect(fetchImpl);
  if (!conn) throw new SentryUnavailableError("Sentry is not connected. Add SENTRY_AUTH_TOKEN in Settings.");
  const issueId = encodeURIComponent(id);
  const issue = await call<RawIssue>(fetchImpl, conn.token, `${conn.base}/api/0/organizations/${conn.org}/issues/${issueId}/`);
  const event = await call<RawEvent>(fetchImpl, conn.token, `${conn.base}/api/0/organizations/${conn.org}/issues/${issueId}/events/latest/`).catch(() => ({}) as RawEvent);
  const exception = (event.entries ?? [])
    .filter((entry) => entry.type === "exception")
    .flatMap((entry) => entry.data?.values ?? [])
    .map((value) => ({
      type: value.type ?? "Error",
      value: value.value ?? "",
      // Sentry lists frames oldest-first; show the crashing frame first.
      frames: (value.stacktrace?.frames ?? []).slice().reverse().slice(0, 40).map((frame) => ({ file: frame.filename ?? frame.absPath ?? "?", fn: frame.function ?? "?", line: frame.lineNo ?? null, inApp: Boolean(frame.inApp) })),
    }));
  const tags = (event.tags ?? []).filter((tag) => !PERSONAL_TAGS.has(tag.key));
  const release = typeof event.release === "string" ? event.release : event.release?.version ?? null;
  return {
    ...summarize(issue),
    exception,
    tags,
    release,
    environment: tags.find((tag) => tag.key === "environment")?.value ?? null,
    latestEventAt: event.dateCreated ?? null,
  };
}

export async function setSentryIssueStatus(id: string, status: SentryIssueStatus, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<void> {
  const conn = await connect(fetchImpl);
  if (!conn) throw new SentryUnavailableError("Sentry is not connected. Add SENTRY_AUTH_TOKEN in Settings.");
  await call(fetchImpl, conn.token, `${conn.base}/api/0/organizations/${conn.org}/issues/?id=${encodeURIComponent(id)}`, { method: "PUT", body: { status } });
}
