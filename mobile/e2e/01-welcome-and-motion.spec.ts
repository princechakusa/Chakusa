import { expect, test } from '@playwright/test';
import { inlineOpacity, linger, openWelcome, trackErrors, transformOf } from './helpers';

// The first screen: what it says, where each choice goes, and proof that
// its motion really plays (and really stops for reduce-motion users).

test.describe('Welcome screen', () => {
  test('shows both ways into Chakusa with honest, real feature lists', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await openWelcome(page);
    await expect(page.getByRole('heading', { name: 'Welcome to Chakusa' })).toBeVisible();
    await expect(page.getByTestId('choose-customer')).toContainText('Find & book services');
    await expect(page.getByTestId('choose-business')).toContainText('Grow my business');
    for (const feature of ['Bookings', 'Rewards', 'Invoices', 'Calendar', 'Follow-ups', 'Reviews']) {
      await expect(page.getByText(feature, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Encrypted. Switch any time from your account.')).toBeVisible();
    await linger(page, 2500);
    expectClean();
  });

  test('entrance animation fades the cards in after the logo', async ({ page }) => {
    await page.goto('/');
    const card = page.getByTestId('choose-business');
    await card.waitFor({ state: 'attached' });
    // The card's Reveal wrapper is its parent; it starts transparent and lifted.
    const wrapper = card.locator('xpath=..');
    const early = await inlineOpacity(wrapper);
    await expect.poll(() => inlineOpacity(wrapper), { timeout: 5000 }).toBe(1);
    expect(early, 'card should start its entrance transparent').toBeLessThan(1);
    await linger(page, 1500);
  });

  test('tagline rotates through what each side of Chakusa does', async ({ page }) => {
    await openWelcome(page);
    const taglines = ['Book trusted local services.', 'Turn missed calls into customers.', 'Earn rewards on every visit.', 'Send invoices and get paid faster.'];
    const seen = new Set<string>();
    for (let sample = 0; sample < 12 && seen.size < 2; sample++) {
      for (const line of taglines) if (await page.getByText(line, { exact: true }).isVisible()) seen.add(line);
      await page.waitForTimeout(600);
    }
    expect(seen.size, `taglines seen: ${[...seen].join(' / ')}`).toBeGreaterThanOrEqual(2);
  });

  test('a card springs down under the finger', async ({ page }) => {
    await openWelcome(page);
    const card = page.getByTestId('choose-customer');
    await expect.poll(() => inlineOpacity(card.locator('xpath=..'))).toBe(1);
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const surface = card.locator('xpath=./*[1]');
    await expect.poll(async () => {
      const matrix = await transformOf(surface);
      const scale = matrix.startsWith('matrix(') ? Number(matrix.slice(7).split(',')[0]) : 1;
      return scale;
    }, { timeout: 3000 }).toBeLessThan(0.99);
    await linger(page, 600);
    // Move off before releasing so this test doesn't navigate.
    await page.mouse.move(2, 2);
    await page.mouse.up();
  });

  test('reduce-motion users get the final layout immediately, with no movement', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    const card = page.getByTestId('choose-business');
    await card.waitFor({ state: 'attached' });
    await expect.poll(() => inlineOpacity(card.locator('xpath=..')), { timeout: 3000 }).toBe(1);
    const first = await page.getByText(/^(Book trusted|Turn missed|Earn rewards|Send invoices)/).innerText();
    await page.waitForTimeout(4200);
    expect(await page.getByText(/^(Book trusted|Turn missed|Earn rewards|Send invoices)/).innerText()).toBe(first);
    await context.close();
  });

  test('each card opens its own sign-in, and back returns to welcome', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await openWelcome(page);
    await linger(page, 1500);
    await page.getByTestId('choose-customer').click();
    await expect(page.getByText('Sign in to your bookings, rewards and saved businesses.')).toBeVisible();
    await linger(page);
    await page.getByRole('button', { name: 'Back to the Chakusa welcome screen' }).click();
    await expect(page.getByTestId('choose-business')).toBeVisible();
    await linger(page, 1500);
    await page.getByTestId('choose-business').click();
    await expect(page.getByText('Sign in to your bookings, customers and reviews.')).toBeVisible();
    await linger(page);
    // The segmented switch hops straight to the other experience.
    await page.getByRole('button', { name: 'Switch to finding and booking services' }).click();
    await expect(page.getByText('Sign in to your bookings, rewards and saved businesses.')).toBeVisible();
    await linger(page);
    expectClean();
  });
});
