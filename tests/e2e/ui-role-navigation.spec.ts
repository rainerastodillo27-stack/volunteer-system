import { mkdirSync } from 'fs';
import { expect, test } from '@playwright/test';
import { E2E_USERS } from './helpers';

const screens = [
  'Dashboard', 'Programs', 'All Projects', 'Calendar', 'Volunteers', 'Partners',
  'Impact Map', 'Messages', 'Analytics', 'Reports', 'User Management', 'Profile', 'Settings',
];

test.beforeAll(() => mkdirSync('artifacts/screenshots/admin', { recursive: true }));

test('admin can open every sidebar function without a browser page crash', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.log(`  ! browser.pageerror ${error.message}`);
  });

  await test.step('Admin authenticates in the web application', async () => {
    await page.goto('/');
    await page.getByPlaceholder('Email, Username, or Phone').fill(E2E_USERS.admin.email);
    await page.getByPlaceholder('Password').fill(E2E_USERS.admin.password);
    await page.getByText('Log In').click();
    await expect(page.getByText(/admin/i).first()).toBeVisible();
  });

  for (const label of screens) {
    await test.step(`Admin opens ${label}`, async () => {
      const navigationItem = page.getByText(label, { exact: true }).first();
      await expect(navigationItem).toBeVisible();
      await navigationItem.click();
      await page.waitForTimeout(700);
      await expect(page.locator('body')).not.toBeEmpty();
      await page.screenshot({
        path: `artifacts/screenshots/admin/${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
        fullPage: true,
      });
    });
  }

  expect(pageErrors, 'Admin screens should not raise uncaught browser errors').toEqual([]);
});
