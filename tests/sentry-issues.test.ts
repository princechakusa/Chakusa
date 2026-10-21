import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const overrides: Record<string, string | undefined> = {};
vi.mock("../src/lib/platformProviderSecrets.js", () => ({ loadPlatformProviderSecretOverrides: async () => overrides }));

const { getSentryIssue, listSentryIssues, setSentryIssueStatus, SentryUnavailableError } = await import("../src/lib/sentryIssues.js");

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function sentry(routes: Record<string, { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body });
    // Most specific route wins, like a real router.
    const key = Object.keys(routes).filter((path) => url.includes(path)).sort((x, y) => y.length - x.length)[0];
    const route = (key ? routes[key] : undefined) ?? { status: 404, json: {} };
    const status = route.status ?? 200;
    return { ok: status < 300, status, json: async () => route.json };
  };
  return { calls, fetchImpl };
}

const ORG = { "https://sentry.io/api/0/organizations/": { json: [{ slug: "chakusa", links: { regionUrl: "https://de.sentry.io" } }] } };

describe("Sentry issues for the admin console", () => {
  beforeEach(() => { for (const key of Object.keys(overrides)) delete overrides[key]; });

  it("reports not configured without calling Sentry", async () => {
    const { calls, fetchImpl } = sentry({});
    expect(await listSentryIssues({ status: "unresolved", period: "14d" }, fetchImpl)).toEqual({ configured: false, projects: [], items: [] });
    expect(calls).toHaveLength(0);
  });

  it("lists issues from the org's region, filtered to one project", async () => {
    overrides.SENTRY_AUTH_TOKEN = "sntrys_secret";
    const { calls, fetchImpl } = sentry({
      ...ORG,
      "/organizations/chakusa/projects/": { json: [{ id: "11", slug: "mobile", name: "Mobile" }, { id: "22", slug: "api", name: "API" }] },
      "/organizations/chakusa/issues/?": { json: [{ id: "900", shortId: "MOBILE-1", title: "TypeError: x is undefined", culprit: "CustomerHomeScreen", level: "error", status: "unresolved", count: "42", userCount: 7, firstSeen: "2026-10-20T00:00:00Z", lastSeen: "2026-10-21T00:00:00Z", permalink: "https://chakusa.sentry.io/issues/900/", project: { slug: "mobile" } }] },
    });
    const result = await listSentryIssues({ status: "unresolved", period: "24h", project: "mobile", search: "TypeError" }, fetchImpl);
    expect(result.items).toEqual([expect.objectContaining({ id: "900", shortId: "MOBILE-1", events: 42, users: 7, project: "mobile" })]);
    expect(result.projects.map((p) => p.slug)).toEqual(["mobile", "api"]);
    const issuesCall = calls.find((call) => call.url.includes("/issues/?"))!;
    expect(issuesCall.url.startsWith("https://de.sentry.io/")).toBe(true);
    const params = new URL(issuesCall.url).searchParams;
    expect(params.get("query")).toBe("is:unresolved TypeError");
    expect(params.get("statsPeriod")).toBe("24h");
    expect(params.get("project")).toBe("11");
    expect(issuesCall.headers.authorization).toBe("Bearer sntrys_secret");
  });

  it("shows the crash with the newest frame first and no personal data", async () => {
    overrides.SENTRY_AUTH_TOKEN = "t";
    const { fetchImpl } = sentry({
      ...ORG,
      "/issues/900/events/latest/": { json: {
        dateCreated: "2026-10-21T10:00:00Z",
        release: { version: "1.0.0+8" },
        tags: [{ key: "environment", value: "production" }, { key: "os", value: "Android 14" }, { key: "user", value: "email:jane@example.com" }, { key: "user.ip", value: "10.0.0.1" }],
        entries: [{ type: "exception", data: { values: [{ type: "TypeError", value: "x is undefined", stacktrace: { frames: [{ filename: "index.js", function: "outer", lineNo: 1 }, { filename: "Home.tsx", function: "render", lineNo: 88, inApp: true }] } }] } }],
      } },
      "/issues/900/": { json: { id: "900", title: "TypeError", project: { slug: "mobile" } } },
    });
    const detail = await getSentryIssue("900", fetchImpl);
    expect(detail.exception[0]?.frames[0]).toEqual({ file: "Home.tsx", fn: "render", line: 88, inApp: true });
    expect(detail.release).toBe("1.0.0+8");
    expect(detail.environment).toBe("production");
    expect(detail.tags.map((tag) => tag.key)).toEqual(["environment", "os"]);
    expect(JSON.stringify(detail)).not.toMatch(/jane@example\.com|10\.0\.0\.1/);
  });

  it("changes an issue's status with a PUT", async () => {
    overrides.SENTRY_AUTH_TOKEN = "t";
    const { calls, fetchImpl } = sentry({ ...ORG, "/organizations/chakusa/issues/?id=900": { json: {} } });
    await setSentryIssueStatus("900", "resolved", fetchImpl);
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toBe("https://de.sentry.io/api/0/organizations/chakusa/issues/?id=900");
    expect(JSON.parse(put.body!)).toEqual({ status: "resolved" });
  });

  it("explains a rejected token without echoing it", async () => {
    overrides.SENTRY_AUTH_TOKEN = "sntrys_leak_me";
    const { fetchImpl } = sentry({ "sentry.io/api/0/organizations/": { status: 401, json: { detail: "Invalid token sntrys_leak_me" } } });
    const error = await listSentryIssues({ status: "unresolved", period: "14d" }, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(SentryUnavailableError);
    expect(error.message).toContain("rejected the token");
    expect(error.message).not.toContain("sntrys_leak_me");
  });
});
