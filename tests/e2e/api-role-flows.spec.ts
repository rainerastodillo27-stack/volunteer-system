import { expect, test } from '@playwright/test';
import { API_URL, E2E_USERS, loginViaApi, seedE2EData } from './helpers';

test.beforeAll(async () => {
  await seedE2EData();
});

test('backend health and role logins are available', async ({ request }) => {
  const health = await request.get(`${API_URL}/health`);
  expect(health.ok()).toBeTruthy();
  await expect.poll(async () => (await health.json()).status).toBe('ok');

  await loginViaApi(request, E2E_USERS.admin.email, E2E_USERS.admin.password);
  await loginViaApi(request, E2E_USERS.volunteer.email, E2E_USERS.volunteer.password);
  await loginViaApi(request, E2E_USERS.partner.email, E2E_USERS.partner.password);
});

test('admin to volunteer and volunteer to admin data flow exists', async ({ request }) => {
  const snapshot = await request.post(`${API_URL}/storage/batch`, {
    data: {
      keys: [
        'users',
        'volunteers',
        'projects',
        'events',
        'volunteerMatches',
        'volunteerProjectJoins',
        'volunteerTimeLogs',
        'partnerReports',
      ],
    },
  });
  expect(snapshot.ok()).toBeTruthy();
  const { items } = await snapshot.json();

  const event = items.events.find((item: any) => item.id === 'e2e-event-nutrition-1');
  expect(event.title).toContain('Nutrition Pack Distribution');
  expect(event.volunteers).toContain('e2e-volunteer-1');
  expect(event.internalTasks[0].assignedVolunteerIds).toContain('e2e-volunteer-1');

  const approvedJoin = items.volunteerProjectJoins.find((item: any) => item.id === 'e2e-volunteer-join-1');
  expect(approvedJoin.participationStatus).toBe('Active');

  const matched = items.volunteerMatches.find((item: any) => item.id === 'e2e-volunteer-match-1');
  expect(matched.status).toBe('Matched');
  expect(matched.reviewedBy).toBe(E2E_USERS.admin.id);

  const volunteerLog = items.volunteerTimeLogs.find((item: any) => item.id === 'e2e-time-log-1');
  expect(volunteerLog.attendanceCheckedBy).toBe(E2E_USERS.admin.id);

  const volunteerReport = items.partnerReports.find((item: any) => item.id === 'e2e-volunteer-report-1');
  expect(volunteerReport.submitterRole).toBe('volunteer');
  expect(volunteerReport.projectId).toBe('e2e-event-nutrition-1');
});

test('admin can approve pending volunteer and pending partner accounts', async ({ request }) => {
  const pendingBefore = await request.get(`${API_URL}/auth/users/pending`);
  expect(pendingBefore.ok()).toBeTruthy();
  const pendingBeforeBody = await pendingBefore.json();
  expect(pendingBeforeBody.pendingUsers.map((user: any) => user.id)).toEqual(
    expect.arrayContaining(['e2e-volunteer-user-pending', 'e2e-partner-user-pending'])
  );

  const volunteerApproval = await request.post(
    `${API_URL}/auth/users/e2e-volunteer-user-pending/approve?admin_id=${E2E_USERS.admin.id}`,
    { data: { status: 'approved' } }
  );
  expect(volunteerApproval.ok()).toBeTruthy();
  expect((await volunteerApproval.json()).user.approvalStatus).toBe('approved');

  const partnerApproval = await request.post(
    `${API_URL}/auth/users/e2e-partner-user-pending/approve?admin_id=${E2E_USERS.admin.id}`,
    { data: { status: 'approved' } }
  );
  expect(partnerApproval.ok()).toBeTruthy();
  expect((await partnerApproval.json()).user.approvalStatus).toBe('approved');

  const collections = await request.post(`${API_URL}/storage/batch`, {
    data: { keys: ['volunteers', 'partners'] },
  });
  const { items } = await collections.json();
  expect(items.volunteers.find((item: any) => item.id === 'e2e-volunteer-pending').registrationStatus).toBe('Approved');
  expect(items.partners.find((item: any) => item.id === 'e2e-partner-pending').status).toBe('Approved');
});

test('admin to partner and partner to admin proposal/report flow exists', async ({ request }) => {
  const snapshot = await request.post(`${API_URL}/storage/batch`, {
    data: {
      keys: ['partners', 'projects', 'partnerProjectApplications', 'partnerReports'],
    },
  });
  expect(snapshot.ok()).toBeTruthy();
  const { items } = await snapshot.json();

  const partner = items.partners.find((item: any) => item.id === 'e2e-partner-1');
  expect(partner.status).toBe('Approved');
  expect(partner.ownerUserId).toBe(E2E_USERS.partner.id);

  const application = items.partnerProjectApplications.find((item: any) => item.id === 'e2e-partner-application-1');
  expect(application.status).toBe('Approved');
  expect(application.reviewedBy).toBe(E2E_USERS.admin.id);
  expect(application.proposalDetails.proposedTitle).toContain('nutrition pack');

  const report = items.partnerReports.find((item: any) => item.id === 'e2e-partner-report-1');
  expect(report.submitterRole).toBe('partner');
  expect(report.partnerUserId).toBe(E2E_USERS.partner.id);
  expect(report.impactCount).toBeGreaterThan(0);
});
