import { APIRequestContext, expect, Page } from '@playwright/test';
import { spawnSync } from 'child_process';

export const API_URL = process.env.API_URL || 'http://127.0.0.1:8000';

export const E2E_USERS = {
  admin: {
    id: 'e2e-admin-1',
    email: 'e2e.admin@nvc.test',
    password: 'Admin123!',
    dashboardText: 'Admin',
  },
  volunteer: {
    id: 'e2e-volunteer-user-1',
    email: 'e2e.volunteer@nvc.test',
    password: 'Volunteer123!',
    dashboardText: 'Volunteer',
  },
  partner: {
    id: 'e2e-partner-user-1',
    email: 'e2e.partner@nvc.test',
    password: 'Partner123!',
    dashboardText: 'Partner',
  },
};

export const E2E_RECORDS = {
  volunteerId: 'e2e-volunteer-1',
  partnerId: 'e2e-partner-1',
  liveAttendanceEventId: 'e2e-live-event-attendance',
  liveReviewEventId: 'e2e-live-event-review',
  liveVolunteerMatchId: 'e2e-live-volunteer-match-requested',
};

export async function seedE2EData(): Promise<void> {
  if (process.env.SKIP_E2E_SEED === '1') {
    return;
  }

  let lastOutput = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm run e2e:seed']
      : ['run', 'e2e:seed'];
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf-8',
    });

    lastOutput = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n');
    if (result.status === 0) {
      return;
    }
  }

  throw new Error(['Failed to seed realistic E2E data after 3 attempts.', lastOutput].filter(Boolean).join('\n'));
}

export async function loginViaApi(request: APIRequestContext, identifier: string, password: string) {
  const response = await request.post(`${API_URL}/auth/login`, {
    data: { identifier, password },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.user.email).toBe(identifier);
  return body.user;
}

export async function loginThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder(/email/i).first().fill(email);
  await page.getByPlaceholder(/password/i).first().fill(password);
  await page.getByText(/log in|log in|log in/i).last().click();
}
