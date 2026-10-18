import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

describe("admin client session races", () => {
  beforeEach(() => {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  });
  afterEach(() => vi.unstubAllGlobals());
  function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((done) => { resolve = done; });
    return { promise, resolve };
  }
  it("does not restore a refresh completing after logout", async () => {
    const pending = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(new Response(null, { status: 204 })));
    const api = await import("../admin/src/api.js");
    api.setAdminSession("old-token", "old-csrf");
    const refresh = api.refreshAdminSession();
    await api.logoutAdmin();
    pending.resolve(Response.json({ accessToken: "late-token", csrfToken: "late-csrf" }));
    expect(await refresh).toBe(false);
    expect(sessionStorage.getItem("chakusa_admin_csrf")).toBeNull();
  });
  it("does not overwrite a newly signed-in identity with an old refresh", async () => {
    const pending = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const api = await import("../admin/src/api.js");
    api.setAdminSession("old-token", "old-csrf");
    const refresh = api.refreshAdminSession();
    api.setAdminSession("new-token", "new-csrf");
    pending.resolve(Response.json({ accessToken: "late-token", csrfToken: "late-csrf" }));
    expect(await refresh).toBe(false);
    expect(sessionStorage.getItem("chakusa_admin_csrf")).toBe("new-csrf");
  });
  it("rejects malformed successful refresh data and clears the prior session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ accessToken: 42, csrfToken: null })));
    const api = await import("../admin/src/api.js");
    api.setAdminSession("old-token", "old-csrf");
    expect(await api.refreshAdminSession()).toBe(false);
    expect(sessionStorage.getItem("chakusa_admin_csrf")).toBeNull();
  });
  it("does not expose a response from an identity that was signed out", async () => {
    const pending = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const api = await import("../admin/src/api.js");
    api.setAdminSession("old-token", "old-csrf");
    const request = api.apiFetch("/admin/users");
    api.setAdminSession(null, null);
    pending.resolve(Response.json({ items: ["private old identity data"] }));
    await expect(request).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
  });
  it("does not clear a new identity when an old unauthorized request finishes refreshing", async () => {
    const pending = deferredResponse();
    const refreshStarted = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockImplementationOnce(() => { refreshStarted.resolve(new Response()); return pending.promise; }));
    const api = await import("../admin/src/api.js");
    api.setAdminSession("old-token", "old-csrf");
    const request = api.apiFetch("/admin/users");
    await refreshStarted.promise;
    api.setAdminSession("new-token", "new-csrf");
    pending.resolve(Response.json({ accessToken: "late-token", csrfToken: "late-csrf" }));
    await expect(request).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect(sessionStorage.getItem("chakusa_admin_csrf")).toBe("new-csrf");
  });
});
