import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { leafletHtml } from "../../mobile/src/components/map/leafletHtml";

test('motion text stays literal when headings contain HTML-shaped content', async ({ page }) => {
  const payload = '<svg/onload=window.securityMotionXss=true>';
  const escaped = payload.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('http://localhost:4321/', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/<main([^>]*)>/, `<main$1><h2 id="security-split" data-split>${escaped}</h2><p id="security-scrub" data-scrub-words>${escaped}</p>`);
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  await expect(page.locator('#security-split .fx-word__in')).toHaveText(payload);
  await expect(page.locator('#security-scrub .fx-scrub')).toHaveText(payload);
  await expect(page.locator('#security-split svg, #security-scrub svg')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { securityMotionXss?: boolean }).securityMotionXss)).toBeUndefined();
});

test("map tooltip renders a hostile business label as text", async ({ page }) => {
  const label = '<img src=x onerror="window.securityXss=true">';
  await page.setContent(leafletHtml({ id: "security-map", center: { latitude: 0, longitude: 0 }, markers: [{ latitude: 0, longitude: 0, kind: "business", label }] }));
  await expect(page.locator(".leaflet-marker-icon")).toBeVisible();
  await page.locator(".leaflet-marker-icon").hover();
  await expect(page.locator(".leaflet-tooltip")).toHaveText(label);
  await expect(page.locator(".leaflet-tooltip img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { securityXss?: boolean }).securityXss)).toBeUndefined();
});

for (const path of ["/", "/login", "/product"]) {
  test(`candidate HTTP CSP preserves ${path} and blocks inline injection`, async ({ page }) => {
    const rules = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
    const candidateHeaders = Object.fromEntries(rules.split(/\r?\n\r?\n/)[0].split(/\r?\n/)
      .map(line => line.trim()).filter(line => /^[A-Za-z][A-Za-z-]+:/.test(line))
      .map(line => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
    const violations: string[] = [];
    await page.exposeFunction("recordCspViolation", (directive: string) => violations.push(directive));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { recordCspViolation: (directive: string) => void }).recordCspViolation(event.violatedDirective);
    }));
    await page.route("http://localhost:4321/**", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers(), ...candidateHeaders };
      delete headers["access-control-allow-origin"];
      await route.fulfill({ response, headers });
    });
    await page.goto(path);
    await page.waitForTimeout(1200);
    expect(violations, "Existing page resources must remain usable under the candidate CSP").toEqual([]);
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.securityInlineExecuted=true";
      document.body.appendChild(script);
    });
    await expect.poll(() => violations).toContain("script-src-elem");
    expect(await page.evaluate(() => (window as unknown as { securityInlineExecuted?: boolean }).securityInlineExecuted)).toBeUndefined();
  });
}
