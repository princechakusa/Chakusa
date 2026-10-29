import { expect, test } from './fixtures';
import { confirmAge, openWelcome, PASSWORD, uniqueEmail } from './helpers';

// Standalone, on-demand check: sign up with email, sign out, sign back in.
// Run visibly:  npm run e2e:watch -- e2e/watch-email-login.spec.ts
test('email sign-up, sign-out, sign-in works end to end', async ({ page }) => {
  const email = uniqueEmail('watchme');

  await openWelcome(page);
  await page.getByTestId('choose-business').click();
  await page.getByText('Create an account', { exact: true }).click();
  await page.getByPlaceholder('Jane Doe').fill('Watch Me');
  await page.getByPlaceholder('Your business').fill('Watch Me Salon');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill(PASSWORD);
  await confirmAge(page);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByText('SETUP · 1 OF 8')).toBeVisible({ timeout: 30_000 });
  console.log(`✅ Registered with email: ${email}`);

  // A fresh device: the session stays signed in on this one (as it should),
  // so clear it, then sign back in with the same email/password.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.context().clearCookies();
  await page.goto('/');
  const back = page.getByRole('button', { name: 'Back to the Chakusa welcome screen' });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId('choose-business').click();
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Your password').fill(PASSWORD);
  await confirmAge(page);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByText(/SETUP|Dashboard/)).toBeVisible({ timeout: 30_000 });
  console.log(`✅ Signed back in with the same email/password`);
});
