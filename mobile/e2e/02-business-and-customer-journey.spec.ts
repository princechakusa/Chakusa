import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { AVONDALE, HARARE_CENTRE, PASSWORD, backToTabs, button, expectMapRendered, goBack, linger, makeTestPhoto, openWelcome, trackErrors, unnamedButtons, uniqueEmail, visibleText } from './helpers';

// The whole product, driven like a person would: one business account and
// one customer account, created fresh, then every main surface of each.
// Runs in order - later steps use what earlier ones created.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36).slice(-5);
const business = { email: uniqueEmail('owner'), name: `Ada Hair Studio ${stamp}`, owner: 'Ada Owner' };
const customer = { email: uniqueEmail('customer'), name: 'Chipo Moyo' };
const client = { name: `Tendai Client ${stamp}`, email: `tendai-${stamp}@chakusa.test` };
const lead = { name: `Rudo Lead ${stamp}` };
const a11yFindings = new Map<string, string[]>();
// Filled in by the customer's booking, checked from the business side.
const booked = { weekday: '', day: '' };

const tomorrow = () => { const d = new Date(Date.now() + 24 * 3600 * 1000); return d.toISOString().slice(0, 10); };

async function recordA11y(page: Page, screen: string) {
  const unnamed = await unnamedButtons(page);
  if (unnamed.length) a11yFindings.set(screen, unnamed);
}

async function acceptBusinessLegal(page: Page) {
  const tab = page.getByRole('tab', { name: 'Dashboard tab' });
  for (let i = 0; i < 6 && !(await tab.isVisible().catch(() => false)); i++) {
    const agree = button(page, 'I have read and agree');
    if (await agree.isVisible().catch(() => false)) { await linger(page, 600); await agree.click(); }
    await page.waitForTimeout(700);
  }
  await expect(tab).toBeVisible();
}

async function signInBusiness(page: Page) {
  await openWelcome(page);
  await page.getByTestId('choose-business').click();
  await page.getByPlaceholder('Email address').fill(business.email);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await acceptBusinessLegal(page);
}

async function signInCustomer(page: Page) {
  await openWelcome(page);
  await page.getByTestId('choose-customer').click();
  await page.getByPlaceholder('Email address').fill(customer.email);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByRole('tab', { name: 'Home tab' })).toBeVisible();
}

async function openMoreItem(page: Page, label: string) {
  await page.getByRole('tab', { name: 'More tab' }).click();
  await button(page, new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).click();
}

test.describe('Business and customer, end to end', () => {
  test('business signs up, completes the 8-step setup and accepts the legal documents', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await openWelcome(page);
    await linger(page, 2500);
    await page.getByTestId('choose-business').click();
    await page.getByText('Create one').click();
    await page.getByPlaceholder('Your name').fill(business.owner);
    await page.getByPlaceholder('Business name').fill(business.name);
    await page.getByPlaceholder('Email address').fill(business.email);
    await page.getByPlaceholder('Create a password').fill(PASSWORD);
    await linger(page);
    await page.getByTestId('auth-submit').click();

    const cont = () => button(page, 'Continue').click();
    await expect(page.getByText('SETUP · 1 OF 8')).toBeVisible();
    await page.getByText('Hair salon', { exact: true }).click(); await cont();
    await expect(page.getByText('SETUP · 2 OF 8')).toBeVisible(); await cont();
    await expect(page.getByText('SETUP · 3 OF 8')).toBeVisible();
    await page.getByLabel('Business phone').fill('771234567'); await cont();
    await expect(page.getByText('SETUP · 4 OF 8')).toBeVisible(); await linger(page); await cont();
    await expect(page.getByText('SETUP · 5 OF 8')).toBeVisible();
    await page.getByText('Haircut', { exact: true }).click(); await cont();
    await expect(page.getByText('SETUP · 6 OF 8')).toBeVisible();
    await page.getByText('Recover missed calls', { exact: true }).click(); await cont();
    await expect(page.getByText('SETUP · 7 OF 8')).toBeVisible();
    await button(page, 'Skip for now').click();
    await expect(page.getByText('SETUP · 8 OF 8')).toBeVisible(); await cont();
    await expect(page.getByText('Your business is ready.')).toBeVisible();
    await linger(page);
    await button(page, 'Go to dashboard').click();
    await acceptBusinessLegal(page);
    await expect(visibleText(page, business.name)).toBeVisible();
    await linger(page, 1500);
    expectClean();
  });

  test('business: every main tab opens and shows its content', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await signInBusiness(page);
    await expect(visibleText(page, "Today's Schedule")).toBeVisible();
    await recordA11y(page, 'Dashboard');
    const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const checks: Array<[string, () => Promise<void>]> = [
      ['Calendar', async () => { await expect(visibleText(page, month)).toBeVisible(); }],
      ['Leads', async () => { await expect(button(page, /Add Lead/)).toBeVisible(); }],
      ['Clients', async () => { await expect(button(page, 'Add client')).toBeVisible(); }],
      ['More', async () => { await expect(button(page, /^Business profile/)).toBeVisible(); }],
      ['Dashboard', async () => { await expect(visibleText(page, "Today's Schedule")).toBeVisible(); }],
    ];
    for (const [tab, check] of checks) {
      await page.getByRole('tab', { name: `${tab} tab` }).click();
      await check();
      await recordA11y(page, tab);
      await linger(page, 900);
    }
    expectClean();
  });

  test('business pins its location with the device GPS and a map pin (Expo Location + Nominatim + Leaflet/OSM)', async ({ page, context }) => {
    const { expectClean } = trackErrors(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(AVONDALE);
    await signInBusiness(page);
    await openMoreItem(page, 'Business profile');
    const card = page.getByTestId('business-location-card');
    await card.scrollIntoViewIfNeeded();
    await button(card, 'Set business location').click();
    await card.getByTestId('location-use-device').click();
    // Nominatim names the GPS fix.
    await expect(card.getByTestId('location-selected')).toContainText('Harare', { timeout: 20_000 });
    await expect(card.getByTestId('location-selected')).not.toContainText('Looking up', { timeout: 20_000 });
    const frame = card.locator('iframe[data-testid=leaflet-map]');
    await expectMapRendered(page, frame);
    await linger(page, 1500);
    // Drop a pin a little north-east of the fix; the label re-resolves.
    const before = await card.getByTestId('location-selected').innerText();
    await frame.scrollIntoViewIfNeeded();
    const box = (await frame.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.88, box.y + box.height * 0.18);
    // The pin is named by Nominatim; Save waits until that lookup settles.
    await expect(card.getByTestId('location-selected')).not.toContainText('Dropped pin', { timeout: 20_000 });
    await expect(card.getByTestId('location-selected')).not.toContainText('Looking up', { timeout: 20_000 });
    await expect.poll(() => card.getByTestId('location-selected').innerText(), { timeout: 20_000 }).not.toBe(before);
    await expect(button(card, 'Save location')).toBeEnabled();
    await linger(page, 1500);
    await button(card, 'Save location').click();
    await expect(card.getByText('Location saved. Customers nearby can now find you.')).toBeVisible();
    await expect(card.getByTestId('business-location-label')).toContainText('Harare');
    await linger(page, 1500);
    expectClean();
  });

  test('business creates a client, a lead, an appointment and a quote', async ({ page }) => {
    const { errors } = trackErrors(page);
    await signInBusiness(page);

    await page.getByRole('tab', { name: 'Clients tab' }).click();
    await button(page, 'Add client').click();
    await page.getByLabel('Name', { exact: true }).fill(client.name);
    await page.getByLabel('Email', { exact: true }).fill(client.email);
    await linger(page);
    await button(page, 'Create client').click();
    // A new client opens straight into their profile.
    await expect(visibleText(page, client.name)).toBeVisible();
    await expect(visibleText(page, client.email)).toBeVisible();
    await recordA11y(page, 'Client profile');
    await linger(page);
    await goBack(page);
    await expect(visibleText(page, client.name)).toBeVisible();

    await page.getByRole('tab', { name: 'Leads tab' }).click();
    await button(page, /Add Lead/).click();
    // With clients on file the form starts on "Existing customer"; this lead is a new caller.
    await expect(button(page, 'Existing customer')).toBeVisible();
    await button(page, 'New caller').click();
    await page.getByLabel('Caller name').fill(lead.name);
    await page.getByLabel('Caller phone').fill('772345678');
    await page.getByLabel('Service requested').fill('Haircut');
    await linger(page);
    await button(page, 'Create lead').click();
    await expect(visibleText(page, lead.name)).toBeVisible();
    await linger(page);
    await backToTabs(page);

    await page.getByRole('tab', { name: 'Dashboard tab' }).click();
    await button(page, /New Booking/).click();
    await expect(visibleText(page, 'Add appointment')).toBeVisible();
    await page.getByLabel('Date (YYYY-MM-DD)').fill(tomorrow());
    await page.getByLabel('Start (HH:MM)').fill('10:00');
    await page.getByLabel('End (HH:MM)').fill('11:00');
    await recordA11y(page, 'Appointment editor');
    await linger(page);
    await button(page, 'Create appointment').click();
    await expect(visibleText(page, 'Add appointment')).toBeHidden({ timeout: 20_000 });
    await linger(page);
    await backToTabs(page);

    await page.getByRole('tab', { name: 'Dashboard tab' }).click();
    await button(page, /Estimate/).click();
    // Saving without a description is refused, as it should be.
    await page.getByLabel('Unit price').first().fill('25');
    await button(page, 'Save draft').click();
    await expect(visibleText(page, 'Description is required')).toBeVisible();
    await page.getByLabel('Item description').first().fill('Haircut and styling');
    await recordA11y(page, 'Quote editor');
    await linger(page);
    await button(page, 'Save draft').click();
    // Quotes are a Pro capability: a Free business gets the upgrade gate (server-enforced), not a saved quote.
    await expect(visibleText(page, 'This is a Pro feature')).toBeVisible();
    await linger(page, 1500);
    await button(page, 'Not now').click();
    await expect(visibleText(page, 'This is a Pro feature')).toBeHidden();
    // The server's refusal is logged by the browser as a 402/403; nothing else may fail.
    expect(errors.filter((error) => !/\b(402|403)\b/.test(error))).toEqual([]);
  });

  test('business: every More destination opens cleanly', async ({ page }) => {
    const { errors } = trackErrors(page);
    await signInBusiness(page);
    const destinations = [
      'Messages', 'Reviews & ratings', 'Business profile', 'Team members', 'Commissions', 'Notifications', 'Message templates',
      'Services', 'Quotes & estimates', 'Invoices', 'Loyalty & rewards', 'Redeem a reward', 'Booking availability', 'Dispatch',
      'Inventory', 'AI receptionist', 'Import appointments', 'External calendar', 'Automation', 'Business insights',
      'Subscription and billing', 'Security and sign-in', 'Help and support', 'Data & legal',
    ];
    const failures: string[] = [];
    const proGated: string[] = [];
    for (const destination of destinations) {
      const errorsBefore = errors.length;
      await openMoreItem(page, destination);
      await page.waitForTimeout(1200);
      await recordA11y(page, `More › ${destination}`);
      await linger(page, 700);
      // Pro capabilities show the upgrade sheet to a Free business; that is the expected outcome.
      const gate = button(page, 'Not now');
      if (await gate.isVisible().catch(() => false)) { proGated.push(destination); await gate.click(); }
      const newErrors = errors.slice(errorsBefore).filter((error) => !/\b(402|403)\b/.test(error));
      if (newErrors.length) failures.push(`${destination}: ${newErrors.join('; ')}`);
      await goBack(page);
      await expect(page.getByRole('tab', { name: 'More tab' })).toBeVisible();
    }
    expect(failures, 'screens that raised errors').toEqual([]);
    console.log(`Pro-gated for a Free business: ${proGated.join(', ') || 'none'}`);
  });

  test('business sign-in rejects a wrong password, then signs out and back in', async ({ page }) => {
    const { errors } = trackErrors(page);
    await openWelcome(page);
    await page.getByTestId('choose-business').click();
    await page.getByPlaceholder('Email address').fill(business.email);
    await page.getByPlaceholder('Password').fill('not-the-password');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toBeVisible();
    await linger(page, 1500);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await acceptBusinessLegal(page);
    await page.getByRole('tab', { name: 'More tab' }).click();
    // The confirmation is a real browser dialog on web (native alert on phones).
    page.once('dialog', (dialog) => { expect(dialog.message()).toContain('Sign out of this device?'); void dialog.accept(); });
    await button(page, /^Sign out of this device/).click();
    await expect(page.getByTestId('auth-submit').or(page.getByTestId('choose-business'))).toBeVisible();
    await linger(page);
    await signInBusiness(page);
    // The browser logs the rejected password's 401; nothing else may fail.
    expect(errors.filter((error) => !/401|Unauthorized/i.test(error))).toEqual([]);
  });

  test('customer signs up and accepts the legal documents', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await openWelcome(page);
    await linger(page, 2000);
    await page.getByTestId('choose-customer').click();
    await page.getByText('Create an account').click();
    await page.getByPlaceholder('Full name').fill(customer.name);
    await page.getByPlaceholder('Email address').fill(customer.email);
    await page.getByPlaceholder('Create a password').fill(PASSWORD);
    await linger(page);
    await page.getByTestId('auth-submit').click();
    await expect(page.getByText('Review & accept')).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await linger(page, 500);
      await button(page, 'Accept').click();
      await page.waitForTimeout(600);
    }
    await expect(page.getByRole('tab', { name: 'Home tab' })).toBeVisible();
    await expect(visibleText(page, /Good (morning|afternoon|evening), Chipo/)).toBeVisible();
    await linger(page, 1500);
    expectClean();
  });

  test('customer finds the business near them: distance, radius, map, and a searched place', async ({ page, context }) => {
    const { expectClean } = trackErrors(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HARARE_CENTRE);
    await signInCustomer(page);
    await page.getByRole('tab', { name: 'Explore tab' }).click();
    await recordA11y(page, 'Customer Explore');
    await page.getByTestId('near-me').click();
    await expect(page.getByTestId('near-me-label')).toContainText('Harare', { timeout: 20_000 });
    const card = button(page, new RegExp(business.name));
    await expect(card).toBeVisible();
    await expect(card).toContainText(/\d(\.\d)? km away/);
    await linger(page, 1500);

    // Radius: 5 km still includes a business ~3.5 km away.
    await button(page, 'Within 5 km').click();
    await expect(card).toBeVisible();
    await button(page, 'Within 15 km').click();

    // Map view: you + the business on OpenStreetMap.
    await button(page, 'Show on map').click();
    await expectMapRendered(page, page.locator('iframe[data-testid=leaflet-map]').filter({ visible: true }).first());
    await linger(page, 2500);
    await button(page, 'Show as list').click();

    // Search near a named place instead of GPS (Nominatim search).
    await button(page, 'Change location').click();
    await page.getByLabel('Search for a place').fill('Avondale Harare');
    const result = page.getByRole('button', { name: /Avondale/ }).filter({ visible: true }).first();
    await expect(result).toBeVisible({ timeout: 20_000 });
    await linger(page);
    await result.click();
    await button(page, 'Search here').click();
    await expect(page.getByTestId('near-me-label')).toContainText('Avondale');
    await expect(button(page, new RegExp(business.name))).toBeVisible();
    await linger(page, 1500);
    expectClean();
  });

  test('customer opens the business, sees it on the map, and books a Haircut', async ({ page, context }) => {
    const { expectClean } = trackErrors(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HARARE_CENTRE);
    await signInCustomer(page);
    await page.getByRole('tab', { name: 'Explore tab' }).click();
    await page.getByTestId('near-me').click();
    await button(page, new RegExp(business.name)).click();
    await expect(page.getByRole('link', { name: 'Get directions' }).filter({ visible: true })).toBeVisible();
    await expectMapRendered(page, page.getByTestId('business-map').filter({ visible: true }).locator('iframe'));
    await recordA11y(page, 'Business profile (customer view)');
    await linger(page, 2000);

    await button(page, 'Book an appointment').click();
    await button(page, 'Haircut. 60 min').click();
    const dates = page.getByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d+$/ }).filter({ visible: true });
    await expect(dates.first()).toBeVisible();
    const dateLabel = (await dates.nth(1).getAttribute('aria-label')) ?? (await dates.nth(1).innerText());
    const [, weekday = '', day = ''] = /^(\w{3}), \w{3} (\d+)$/.exec(dateLabel.trim()) ?? [];
    Object.assign(booked, { weekday, day });
    await dates.nth(1).click();
    const times = page.getByRole('button', { name: /\d{1,2}:\d{2}/ }).filter({ visible: true });
    await expect(times.first()).toBeVisible({ timeout: 20_000 });
    await recordA11y(page, 'Booking flow');
    await linger(page);
    await times.first().click();
    const confirm = page.getByRole('button', { name: /^(Confirm|Book|Request)/ }).filter({ visible: true }).last();
    await expect(confirm).toBeEnabled();
    await linger(page);
    await confirm.click();
    // The new booking opens straight into its detail screen.
    await expect(visibleText(page, 'SCHEDULED')).toBeVisible({ timeout: 20_000 });
    await expect(visibleText(page, business.name)).toBeVisible();
    await expect(button(page, /Reschedule/)).toBeVisible();
    await recordA11y(page, 'Booking detail');
    await linger(page, 2000);
    expectClean();
  });

  test('customer sees the booking and every account screen', async ({ page }) => {
    const { errors, expectClean } = trackErrors(page);
    await signInCustomer(page);
    await page.getByRole('tab', { name: 'Bookings tab' }).click();
    await expect(button(page, new RegExp(business.name))).toBeVisible();
    await recordA11y(page, 'Customer Bookings');
    await button(page, new RegExp(business.name)).click();
    await expect(visibleText(page, business.name)).toBeVisible();
    await linger(page, 1500);
    await goBack(page);

    await page.getByRole('tab', { name: 'Home tab' }).click();
    await expect(visibleText(page, business.name)).toBeVisible();
    const failures: string[] = [];
    for (const row of ['Edit profile', 'Notifications', 'Invoices', 'My Rewards', 'Invite friends', 'Terms of Service', 'Privacy Policy']) {
      const before = errors.length;
      await page.getByRole('tab', { name: 'Account tab' }).click();
      await button(page, row).click();
      await page.waitForTimeout(1200);
      await recordA11y(page, `Customer Account › ${row}`);
      await linger(page, 700);
      if (errors.length > before) failures.push(`${row}: ${errors.slice(before).join('; ')}`);
      await goBack(page);
    }
    expect(failures).toEqual([]);

    await page.getByRole('tab', { name: 'Account tab' }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await button(page, 'Sign out').click();
    await expect(page.getByTestId('auth-submit').or(page.getByTestId('choose-customer'))).toBeVisible();
    await signInCustomer(page);
    expectClean();
  });

  test('business sees the customer booking on its calendar', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    expect(booked.day, 'the customer booking step recorded its date').not.toBe('');
    await signInBusiness(page);
    await page.getByRole('tab', { name: 'Calendar tab' }).click();
    // Tap the day the customer booked on the week strip (e.g. "MON 28").
    const dayButton = page.getByRole('button', { name: new RegExp(`^${booked.weekday}\\s*${booked.day}$`, 'i') }).filter({ visible: true }).first();
    await dayButton.click();
    await expect(page.getByText(customer.name).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Haircut').filter({ visible: true }).first()).toBeVisible();
    await recordA11y(page, 'Calendar with a booking');
    await linger(page, 2500);
    expectClean();
  });

  test('customer reschedules the booking to another time', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await signInCustomer(page);
    await page.getByRole('tab', { name: 'Bookings tab' }).click();
    await button(page, new RegExp(business.name)).click();
    await expect(visibleText(page, 'SCHEDULED')).toBeVisible();
    const before = await page.getByText('When', { exact: true }).filter({ visible: true }).locator('xpath=..').innerText();
    await button(page, /Reschedule/).click();
    await expect(visibleText(page, 'Pick a new time')).toBeVisible();
    // Take a time on a later day than the current booking so the change is unmistakable.
    const dayLabels = page.getByText(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]{2} \d+$/).filter({ visible: true });
    await expect(dayLabels.first()).toBeVisible();
    const dayCount = await dayLabels.count();
    const target = dayLabels.nth(Math.min(2, dayCount - 1));
    const [, weekday = '', day = ''] = /^(\w{3})\w*, \w{3} (\d+)$/.exec((await target.innerText()).trim()) ?? [];
    await target.locator('xpath=..').getByRole('button').first().click();
    await expect(visibleText(page, 'Pick a new time')).toBeHidden();
    const after = await page.getByText('When', { exact: true }).filter({ visible: true }).locator('xpath=..').innerText();
    expect(after, 'the booking time changed').not.toBe(before);
    Object.assign(booked, { weekday, day });
    await linger(page, 1500);
    expectClean();
  });

  test('business confirms the booking and shares live location; the customer sees it on a map', async ({ browser }) => {
    const bizContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: AVONDALE });
    const custContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const biz = await bizContext.newPage();
    const cust = await custContext.newPage();
    const bizErrors = trackErrors(biz);
    const custErrors = trackErrors(cust);

    await signInBusiness(biz);
    await biz.getByRole('tab', { name: 'Calendar tab' }).click();
    await biz.getByRole('button', { name: new RegExp(`^${booked.weekday}\\s*${booked.day}$`, 'i') }).filter({ visible: true }).first().click();
    await biz.getByText(customer.name).filter({ visible: true }).first().click();
    await button(biz, 'Confirm appointment').click();
    await expect(button(biz, 'Mark completed')).toBeVisible();
    await button(biz, 'On my way').click();
    await button(biz, 'Share live location with customer').click();
    await expect(biz.getByText('Sharing your live location with the customer').filter({ visible: true })).toBeVisible();
    await linger(biz, 1200);

    // Meanwhile, on the customer's phone.
    await signInCustomer(cust);
    await cust.getByRole('tab', { name: 'Bookings tab' }).click();
    await button(cust, new RegExp(business.name)).click();
    await expect(visibleText(cust, 'CONFIRMED')).toBeVisible();
    await expect(visibleText(cust, 'Your provider is on the way')).toBeVisible({ timeout: 30_000 });
    await expectMapRendered(cust, cust.locator('iframe[data-testid=leaflet-map]').filter({ visible: true }).first());
    await linger(cust, 2500);

    // Business arrives, stops sharing and completes the job; the customer's map disappears.
    await button(biz, 'Stop sharing').click();
    await expect(biz.getByText('Sharing your live location with the customer').filter({ visible: true })).toBeHidden();
    await button(biz, 'Mark completed').click();
    await expect(button(biz, 'Mark completed')).toBeHidden();
    await cust.reload();
    await expect(visibleText(cust, 'COMPLETED')).toBeVisible({ timeout: 30_000 });
    await expect(cust.getByText('Your provider is on the way')).toHaveCount(0);
    await linger(cust, 1500);

    bizErrors.expectClean();
    custErrors.expectClean();
    await bizContext.close();
    await custContext.close();
  });

  test('customer books again and cancels that booking', async ({ page, context }) => {
    const { expectClean } = trackErrors(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HARARE_CENTRE);
    await signInCustomer(page);
    await page.getByRole('tab', { name: 'Explore tab' }).click();
    await page.getByTestId('near-me').click();
    await button(page, new RegExp(business.name)).click();
    await button(page, 'Book an appointment').click();
    await button(page, 'Haircut. 60 min').click();
    const dates = page.getByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d+$/ }).filter({ visible: true });
    await dates.nth(3).click();
    await page.getByRole('button', { name: /\d{1,2}:\d{2}/ }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: /^(Confirm|Book|Request)/ }).filter({ visible: true }).last().click();
    await expect(visibleText(page, 'SCHEDULED')).toBeVisible({ timeout: 20_000 });
    await linger(page);
    page.once('dialog', (dialog) => { expect(dialog.message()).toContain('Cancel this booking?'); void dialog.accept(); });
    await button(page, 'Cancel booking').click();
    await expect(visibleText(page, /^CANCELL?ED$/)).toBeVisible({ timeout: 20_000 });
    await expect(visibleText(page, 'This booking is closed.')).toBeVisible();
    await expect(button(page, 'Cancel booking')).toBeHidden();
    await linger(page, 1500);
    expectClean();
  });

  test('business adds a service, and the customer can see it on the business profile', async ({ browser }) => {
    const bizContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const biz = await bizContext.newPage();
    const bizErrors = trackErrors(biz);
    await signInBusiness(biz);
    await openMoreItem(biz, 'Services');
    await button(biz, 'Add service').click();
    await biz.getByLabel('Service name', { exact: true }).fill(`Beard trim ${stamp}`);
    await biz.getByLabel('Duration (min)', { exact: true }).fill('30');
    // Not exact-only: the leftover "More" menu (React web keeps inactive
    // tabs mounted) has a button whose label contains "priced quotes".
    await biz.getByLabel('Price', { exact: true }).filter({ visible: true }).fill('15');
    await linger(biz);
    await button(biz, 'Save service').click();
    await expect(biz.getByText(`Beard trim ${stamp}`).filter({ visible: true }).first()).toBeVisible();
    await expect(biz.getByText('30 min · $15').filter({ visible: true }).first()).toBeVisible();
    await linger(biz, 1200);
    bizErrors.expectClean();
    await bizContext.close();

    const custContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: HARARE_CENTRE });
    const cust = await custContext.newPage();
    const custErrors = trackErrors(cust);
    await signInCustomer(cust);
    await cust.getByRole('tab', { name: 'Explore tab' }).click();
    await cust.getByTestId('near-me').click();
    await button(cust, new RegExp(business.name)).click();
    await expect(button(cust, new RegExp(`Beard trim ${stamp}`))).toBeVisible();
    await linger(cust, 1500);
    custErrors.expectClean();
    await custContext.close();
  });

  test('business blocks time off and removes the block', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await signInBusiness(page);
    await openMoreItem(page, 'Booking availability');
    await button(page, 'Block unavailable time').click();
    const inTenDays = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await page.getByLabel('Date (YYYY-MM-DD)').fill(inTenDays);
    await page.getByLabel('Start', { exact: true }).fill('13:00');
    await page.getByLabel('End', { exact: true }).fill('14:00');
    await page.getByLabel('Reason (optional)').fill('Staff training');
    await linger(page);
    await button(page, 'Block time').click();
    await expect(visibleText(page, /Staff training/)).toBeVisible();
    await linger(page, 1200);
    page.once('dialog', (dialog) => void dialog.accept());
    await button(page, 'Remove').click();
    await expect(page.getByText(/Staff training/).filter({ visible: true })).toHaveCount(0);
    expectClean();
  });

  test('customer edits their display name', async ({ page }) => {
    const { expectClean } = trackErrors(page);
    await signInCustomer(page);
    await page.getByRole('tab', { name: 'Account tab' }).click();
    await button(page, 'Edit profile').click();
    await page.getByLabel('Display name').fill(`Chipo M ${stamp}`);
    await linger(page);
    await button(page, 'Save changes').click();
    await backToTabs(page, 'Account tab');
    await expect(visibleText(page, `Chipo M ${stamp}`)).toBeVisible();
    await linger(page, 1500);
    expectClean();
  });

  test('business adds its photo, and customers see it on Explore and the business profile', async ({ browser }, testInfo) => {
    const photo = await makeTestPhoto(browser, testInfo.outputPath('business-photo.png'), '#EE5D43', 'AH');
    const bizContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const biz = await bizContext.newPage();
    const bizErrors = trackErrors(biz);
    await signInBusiness(biz);
    await openMoreItem(biz, 'Business profile');
    const chooser = biz.waitForEvent('filechooser');
    await button(biz, 'Add photo').click();
    await (await chooser).setFiles(photo);
    await expect(visibleText(biz, 'Tap Save business setup to keep this photo.')).toBeVisible();
    await linger(biz);
    await button(biz, /Save business setup/).click();
    await expect(visibleText(biz, 'Tap Save business setup to keep this photo.')).toBeHidden({ timeout: 20_000 });
    await expect(button(biz, 'Change photo')).toBeVisible();
    bizErrors.expectClean();
    await bizContext.close();

    const custContext = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: HARARE_CENTRE });
    const cust = await custContext.newPage();
    const custErrors = trackErrors(cust);
    const photoLoads = () => cust.waitForResponse((response) => /\/public\/business\/[^/]+\/photo/.test(response.url()) && response.status() === 200, { timeout: 30_000 });
    await signInCustomer(cust);
    const onCard = photoLoads();
    await cust.getByRole('tab', { name: 'Explore tab' }).click();
    await cust.getByTestId('near-me').click();
    const card = button(cust, new RegExp(business.name));
    await expect(card.getByLabel(`${business.name} photo`)).toBeVisible();
    expect((await onCard).headers()['content-type']).toMatch(/^image\//);
    await card.click();
    await expect(cust.getByTestId('business-photo').filter({ visible: true })).toBeVisible();
    await linger(cust, 2000);
    custErrors.expectClean();
    await custContext.close();
  });

  test('customer adds a profile picture and sees it on their account', async ({ page, browser }, testInfo) => {
    const { expectClean } = trackErrors(page);
    const photo = await makeTestPhoto(browser, testInfo.outputPath('customer-photo.png'), '#2F6BFF', 'CM');
    await signInCustomer(page);
    await page.getByRole('tab', { name: 'Account tab' }).click();
    await expect(page.getByTestId('account-photo').filter({ visible: true })).toHaveAttribute('aria-label', /initials$/);
    await button(page, 'Edit profile').click();
    const chooser = page.waitForEvent('filechooser');
    await button(page, 'Add photo').click();
    await (await chooser).setFiles(photo);
    await expect(visibleText(page, 'Tap Save changes to keep your new photo.')).toBeVisible();
    await expect(page.getByTestId('profile-photo').filter({ visible: true })).toHaveAttribute('aria-label', / photo$/);
    await linger(page);
    await button(page, 'Save changes').click();
    await backToTabs(page, 'Account tab');
    await expect(page.getByTestId('account-photo').filter({ visible: true })).toHaveAttribute('aria-label', / photo$/);
    await linger(page, 2000);
    expectClean();
  });

  test.afterAll(() => {
    if (!a11yFindings.size) return;
    console.log('\nButtons without an accessible name:');
    for (const [screen, list] of a11yFindings) console.log(`  ${screen}: ${list.length}\n    ${list.slice(0, 3).join('\n    ')}`);
  });
});
