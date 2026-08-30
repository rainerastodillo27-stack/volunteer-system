import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:8081';
const apiURL = process.env.API_URL || 'http://127.0.0.1:8000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.QASE_MODE
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/playwright-junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    extraHTTPHeaders: {
      'x-e2e-api-url': apiURL,
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'api-role-flows',
      testMatch: /api-.*\.spec\.ts/,
    },
    {
      name: 'admin-web',
      testMatch: /ui-login\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'mobile-mode-web',
      testMatch: /mobile-mode-login\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: `${baseURL.replace(/\/$/, '')}/?mode=mobile`,
      },
    },
  ],
});
