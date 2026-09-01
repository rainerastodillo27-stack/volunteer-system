import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { E2E_USERS, seedE2EData } from './helpers';

const roleCases = [
  {
    role: 'volunteer',
    account: E2E_USERS.volunteer,
    choice: 'Continue as Volunteer',
    tabs: [
      ['Home', 'Home'], ['Volunteer Dashboard', 'Dashboard'], ['Program Management', 'Programs'],
      ['Events', 'Events'], ['My Tasks', 'Tasks'], ['Impact Map', 'Map'], ['Messages', 'Messages'],
      ['My Reports', 'Reports'], ['My Profile', 'Profile'],
    ],
  },
  {
    role: 'partner',
    account: E2E_USERS.partner,
    choice: 'Continue as Partner Organization',
    tabs: [
      ['Home', 'Home'], ['Partner Dashboard', 'Dashboard'], ['Program Management', 'Programs'],
      ['Projects', 'Projects'], ['Impact Map', 'Map'], ['Messages', 'Messages'],
      ['Reports', 'Reports'], ['Partner Profile', 'Profile'],
    ],
  },
] as const;

test.beforeAll(() => mkdirSync('artifacts/screenshots/mobile', { recursive: true }));
test.beforeAll(async () => {
  await seedE2EData();
});

for (const roleCase of roleCases) {
  test(`${roleCase.role} can open every mobile navigation function without a browser page crash`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
      console.log(`  ! browser.pageerror ${error.message}`);
    });

    await test.step(`${roleCase.role} authenticates in mobile mode`, async () => {
      await page.goto('/?mode=mobile');
      await page.getByText(roleCase.choice).click();
      await page.getByRole('textbox').nth(0).fill(roleCase.account.email);
      await page.getByRole('textbox').nth(1).fill(roleCase.account.password);
      await page.getByText(/log in/i).last().click();
      await expect(page.getByText(new RegExp(roleCase.account.dashboardText, 'i')).first()).toBeVisible();
    });

    for (const [label, route] of roleCase.tabs) {
      await test.step(`${roleCase.role} opens ${label}`, async () => {
        const navigationItem = page.locator(`a[href="/Main/${route}"]`).last();
        await expect(navigationItem).toBeVisible();
        await navigationItem.click();
        await page.waitForTimeout(500);
        await expect(page.locator('body')).not.toBeEmpty();
        await page.screenshot({
          path: `artifacts/screenshots/mobile/${roleCase.role}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
          fullPage: true,
        });
      });
    }

    expect(pageErrors, `${roleCase.role} screens should not raise uncaught browser errors`).toEqual([]);
    await context.close();
  });
}
