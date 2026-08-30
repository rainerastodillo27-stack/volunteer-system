import { expect, test } from '@playwright/test';
import { E2E_USERS, seedE2EData } from './helpers';

test.beforeAll(async () => {
  await seedE2EData();
});

test('volunteer and partner accounts can authenticate through mobile-mode web', async ({ browser }) => {
  for (const account of [E2E_USERS.volunteer, E2E_USERS.partner]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/?mode=mobile');
    await page
      .getByText(account.id === E2E_USERS.volunteer.id ? 'Continue as Volunteer' : 'Continue as Partner Organization')
      .click();
    const textboxes = page.getByRole('textbox');
    await textboxes.nth(0).fill(account.email);
    await textboxes.nth(1).fill(account.password);
    await page.getByText(/log in/i).last().click();

    await expect(page.getByText(new RegExp(account.dashboardText, 'i')).first()).toBeVisible();
    await context.close();
  }
});
