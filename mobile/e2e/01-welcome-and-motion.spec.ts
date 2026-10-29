import { expect, test } from './fixtures';
import { inlineOpacity, linger, openWelcome, trackErrors, transformOf } from './helpers';

// The first screen: what it says, where each choice goes, that both choices
// have real accessible names, and that a press gives visible feedback.

test.describe('Welcome screen', () => {
  test('shows the welcome and both ways into Chakusa', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await openWelcome(page);
    await expect(page.getByTestId('welcome-title')).toHaveText(/Welcome to\s*Chakusa\./);
    await expect(page.getByTestId('choose-customer')).toContainText('Discover & book');
    await expect(page.getByTestId('choose-customer')).toContainText('Explore as a customer');
    await expect(page.getByTestId('choose-business')).toContainText('Build & grow');
    await expect(page.getByTestId('choose-business')).toContainText('Continue as a business');
    await expect(page.getByText('Two ways in. Switch whenever you like.')).toBeVisible();
    await linger(page, 2500);
    expectClean();
  });

  test('each choice is a button named by what it does, with no icon glyphs in the name', async ({ page }) => {
    await openWelcome(page);
    await expect(page.getByRole('button', { name: 'Explore as a customer. Find local services worth coming back for.', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue as a business. Your bookings, customers and next chapter.', exact: true })).toBeVisible();
  });

  test('a card dims and shrinks slightly under the finger', async ({ page }) => {
    await openWelcome(page);
    const card = page.getByTestId('choose-customer');
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(async () => {
      const matrix = await transformOf(card);
      return matrix.startsWith('matrix(') ? Number(matrix.slice(7).split(',')[0]) : 1;
    }, { timeout: 3000 }).toBeLessThan(1);
    expect(await inlineOpacity(card)).toBeLessThan(1);
    await linger(page, 600);
    // Move off before releasing so this test doesn't navigate.
    await page.mouse.move(2, 2);
    await page.mouse.up();
  });

  test('reduce-motion users get the final layout immediately', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    const card = page.getByTestId('choose-business');
    await expect(card).toBeVisible({ timeout: 60_000 });
    expect(await inlineOpacity(card)).toBe(1);
    expect(await transformOf(card)).toBe('none');
    await context.close();
  });

  test('the app still opens (with system fonts) when the brand fonts cannot load', async ({ page }) => {
    await page.route(/\.ttf(\?|$)/, (route) => route.abort());
    await page.goto('/');
    // Previously a failed font load left the app on a blank screen forever.
    await expect(page.getByTestId('choose-business')).toBeVisible({ timeout: 15_000 });
    await linger(page, 1500);
  });

  test('each card opens its own sign-in, and back returns to welcome', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await openWelcome(page);
    await linger(page, 1500);
    await page.getByTestId('choose-customer').click();
    await expect(page.getByText(/Your plans, favourite places and little rewards\./)).toBeVisible();
    await expect(page.getByText('PERSONAL', { exact: true })).toBeVisible();
    await linger(page);
    await page.getByRole('button', { name: 'Back to the Chakusa welcome screen' }).click();
    await expect(page.getByTestId('choose-business')).toBeVisible();
    await linger(page, 1500);
    await page.getByTestId('choose-business').click();
    await expect(page.getByText(/Less admin\. More momentum\./)).toBeVisible();
    await expect(page.getByText('BUSINESS', { exact: true })).toBeVisible();
    await linger(page);
    // The segmented switch hops straight to the other experience.
    await page.getByRole('button', { name: 'Switch to finding and booking services' }).click();
    await expect(page.getByText(/Your plans, favourite places and little rewards\./)).toBeVisible();
    await linger(page);
    expectClean();
  });
});
