import { expect, test } from '@playwright/test';
import { E2E_USERS, seedE2EData } from './helpers';

test.beforeAll(async () => {
  await seedE2EData();
});

test('admin can log in on the web app', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Email, Username, or Phone').fill(E2E_USERS.admin.email);
  await page.getByPlaceholder('Password').fill(E2E_USERS.admin.password);
  await page.getByText('Log In').click();

  await expect(page.getByText(/admin/i).first()).toBeVisible();
});
