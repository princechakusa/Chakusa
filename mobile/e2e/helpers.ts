import { expect, type Browser, type Locator, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-password-123456';
export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@chakusa.test`;

// Fixed test positions in Harare. The business pins itself in Avondale;
// the customer searches from the city centre, ~3.5 km away.
export const AVONDALE = { latitude: -17.8, longitude: 31.04 };
export const HARARE_CENTRE = { latitude: -17.8292, longitude: 31.0522 };

/** Collects uncaught page errors, console errors and blocked map tiles so every test can assert a clean run. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`); });
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`server ${response.status()}: ${response.request().method()} ${new URL(response.url()).pathname}`);
    if (/tile\.openstreetmap\.org|nominatim\.openstreetmap\.org|unpkg\.com\/leaflet/.test(response.url()) && response.status() >= 400) {
      errors.push(`map service ${response.status()}: ${response.url().slice(0, 120)}`);
    }
  });
  return {
    errors,
    expectClean: () => expect(errors, 'uncaught errors, console errors or blocked map requests during the test').toEqual([]),
  };
}

/** Lets a person watching (E2E_WATCH=1) actually see a screen; free in headless runs. */
export async function linger(page: Page, ms = 1200) {
  // Watch mode pauses on each screen so a person can read it.
  if (process.env.E2E_WATCH === '1') await page.waitForTimeout(ms);
}

/**
 * Opens the welcome screen. A device that was used before remembers its last
 * experience and reopens that sign-in screen, so step back to welcome from there.
 */
export async function openWelcome(page: Page) {
  await page.goto('/');
  const welcome = page.getByTestId('choose-business');
  const back = page.getByRole('button', { name: 'Back to the Chakusa welcome screen' });
  // First paint of the dev bundle can be slow on a busy machine.
  await expect(welcome.or(back)).toBeVisible({ timeout: 60_000 });
  if (!(await welcome.isVisible())) await back.click();
  await expect(welcome).toBeVisible();
}

export async function inlineOpacity(locator: Locator) {
  return locator.evaluate((element) => Number(getComputedStyle(element).opacity));
}

export async function transformOf(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).transform);
}

/** The visible button with this accessible name (web keeps inactive tabs mounted, so filter to what is on screen). */
export const button = (page: Page | Locator, name: string | RegExp) =>
  page.getByRole('button', { name, exact: typeof name === 'string' ? true : undefined }).filter({ visible: true }).first();

export const visibleText = (page: Page, text: string | RegExp) => page.getByText(text, { exact: typeof text === 'string' ? true : undefined }).filter({ visible: true }).first();

/** Back out of a pushed screen: the app's own Back button, React Navigation's header back, or browser history. */
export async function goBack(page: Page) {
  const candidates = [
    button(page, 'Back'),
    button(page, /go back/i),
    // React Navigation renders its header back as a link on web.
    page.getByRole('link', { name: /go back/i }).filter({ visible: true }).first(),
  ];
  for (const target of candidates) {
    if (await target.isVisible().catch(() => false)) { await target.click(); return; }
  }
  await page.goBack();
}

/** Buttons on screen that a screen reader could not name. */
export async function unnamedButtons(page: Page) {
  return page.locator('[role=button]:visible, button:visible').evaluateAll((elements) => elements
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      // Icon fonts render glyphs as private-use characters; they are not a name.
      const strip = (value: string | null) => (value ?? '').replace(/[-]/g, '').trim();
      const name = strip(element.getAttribute('aria-label')) || strip((element as HTMLElement).innerText) || strip(element.getAttribute('title'));
      return !name;
    })
    .map((element) => (element as HTMLElement).outerHTML.slice(0, 160)));
}

/** Map sanity: Leaflet mounted inside the frame and at least one OpenStreetMap tile rendered. */
export async function expectMapRendered(page: Page, frame: Locator) {
  await expect(frame).toBeVisible();
  const map = page.frameLocator('iframe[data-testid=leaflet-map] >> visible=true').first();
  await expect(map.locator('.leaflet-container')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => map.locator('img.leaflet-tile-loaded').count(), { timeout: 20_000 }).toBeGreaterThan(0);
}

/** Back out of any pushed screens until the bottom tab bar is showing again. */
export async function backToTabs(page: Page, tab = 'Dashboard tab') {
  const bar = page.getByRole('tab', { name: tab });
  // A pushed screen can cover a still-visible tab bar, and a screen may still be
  // animating away, so retry the real click rather than trusting one probe.
  for (let i = 0; i < 6; i++) {
    if (await bar.click({ timeout: 3000 }).then(() => true, () => false)) return;
    await goBack(page);
    await page.waitForTimeout(600);
  }
  await bar.click();
}

/** Renders a real 800x800 PNG (a coloured square with initials) to use as an uploaded photo. */
export async function makeTestPhoto(browser: Browser, path: string, color: string, text: string) {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.setContent(`<body style="margin:0"><div style="width:800px;height:800px;background:${color};display:flex;align-items:center;justify-content:center;font:bold 260px sans-serif;color:#fff">${text}</div></body>`);
  await page.screenshot({ path });
  await page.close();
  return path;
}
