import { expect, test } from './fixtures';
import { openWelcome, PASSWORD, uniqueEmail } from './helpers';

// Standalone, on-demand check: sign up with email, sign out, sign back in.
// Run visibly:  npm run e2e:watch -- e2e/watch-email-login.spec.ts
test('email sign-up, sign-out, sign-in works end to end', async ({ page }) => {
  const email = uniqueEmail('watchme');

  await openWelcome(page);
  await page.getByTestId('choose-business').click();
  await page.getByText('Create one').click();
  await page.getByPlaceholder('Your name').fill('Watch Me');
  await page.getByPlaceholder('Business name').fill('Watch Me Salon');
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Create a password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByText('SETUP · 1 OF 8')).toBeVisible({ timeout: 30_000 });
  console.log(`✅ Registered with email: ${email}`);

  // Back to welcome, sign back in with the same email/password.
  await page.goto('/');
  const back = page.getByRole('button', { name: 'Back to the Chakusa welcome screen' });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId('choose-business').click();
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByText(/SETUP|Dashboard/)).toBeVisible({ timeout: 30_000 });
  console.log(`✅ Signed back in with the same email/password`);
});
