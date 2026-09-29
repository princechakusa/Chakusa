import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "@playwright/test";

// Every page in the built site (run `npm run build` first) is loaded from the
// live production domain, signed out.
function routes(dir = join(process.cwd(), "dist")): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { if (entry !== "_astro") found.push(...routes(path)); continue; }
    if (entry !== "index.html") continue;
    const route = `/${relative(join(process.cwd(), "dist"), dir).split(sep).join("/")}`;
    found.push(route === "/" ? "/" : `${route.replace(/\/$/, "")}/`);
  }
  return found.sort();
}

const ALL = routes();

test("the built site has pages to test", () => {
  expect(ALL.length).toBeGreaterThan(50);
});

for (const route of ALL) {
  test(`live ${route}`, async ({ page }) => {
    const uncaught: string[] = [];
    const cspViolations: string[] = [];
    const brokenAssets: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    page.on("console", (message) => { if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(message.text())) cspViolations.push(message.text()); });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.hostname === "chakusarecovery.com" && response.status() >= 400) brokenAssets.push(`${response.status()} ${url.pathname}`);
    });

    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), "page status").toBeLessThan(400);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

    if (route.startsWith("/dashboard/")) {
      // Signed out: every dashboard page must end on a sign-in prompt or its
      // own error state, never on a blank page or leaked content.
      await expect(page.locator("[data-page-auth], [data-module-auth], [data-auth], [data-auth-required], [data-doc-auth], [data-page-error], [data-doc-error]").filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("[data-page-content], [data-module], [data-content], [data-dashboard-content], [data-doc]").filter({ visible: true })).toHaveCount(0);
      const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src https://auth.chakusarecovery.com");
    }

    expect(uncaught, "uncaught page errors").toEqual([]);
    expect(cspViolations, "CSP violations").toEqual([]);
    expect(brokenAssets, "broken same-origin requests").toEqual([]);
  });
}
