import { expect, test } from '@playwright/test';
import { API_URL, E2E_RECORDS, E2E_USERS, loginViaApi, seedE2EData } from './helpers';

test.beforeAll(async () => {
  await seedE2EData();
});

test('real cross-platform workflow: admin, volunteer, and partner interact through live actions', async ({ request }) => {
  await loginViaApi(request, E2E_USERS.admin.email, E2E_USERS.admin.password);
  await loginViaApi(request, E2E_USERS.volunteer.email, E2E_USERS.volunteer.password);
  await loginViaApi(request, E2E_USERS.partner.email, E2E_USERS.partner.password);

  const adminMessageId = 'e2e-live-admin-volunteer-message';
  const adminMessage = await request.post(`${API_URL}/messages`, {
    data: {
      id: adminMessageId,
      senderId: E2E_USERS.admin.id,
      recipientId: E2E_USERS.volunteer.id,
      projectId: E2E_RECORDS.liveReviewEventId,
      content: 'Please confirm your availability for the E2E live volunteer review event.',
      timestamp: new Date().toISOString(),
      read: false,
      attachments: [],
    },
  });
  expect(adminMessage.ok()).toBeTruthy();

  const volunteerMessages = await request.get(`${API_URL}/messages?user_id=${E2E_USERS.volunteer.id}`);
  expect(volunteerMessages.ok()).toBeTruthy();
  expect((await volunteerMessages.json()).messages.some((message: any) => message.id === adminMessageId)).toBe(true);

  const reviewedMatch = await request.post(
    `${API_URL}/volunteer-matches/${E2E_RECORDS.liveVolunteerMatchId}/review`,
    {
      data: {
        status: 'Matched',
        reviewedBy: E2E_USERS.admin.id,
      },
    }
  );
  expect(reviewedMatch.ok()).toBeTruthy();
  expect((await reviewedMatch.json()).match.status).toBe('Matched');

  const joinedEventSnapshot = await request.get(`${API_URL}/storage/events`);
  expect(joinedEventSnapshot.ok()).toBeTruthy();
  const joinedEvent = (await joinedEventSnapshot.json()).value.find(
    (event: any) => event.id === E2E_RECORDS.liveReviewEventId
  );
  expect(joinedEvent.volunteers).toContain(E2E_RECORDS.volunteerId);
  expect(joinedEvent.joinedUserIds).toContain(E2E_USERS.volunteer.id);

  const timeIn = await request.post(`${API_URL}/volunteers/${E2E_RECORDS.volunteerId}/time-logs/start`, {
    data: {
      projectId: E2E_RECORDS.liveAttendanceEventId,
      note: 'E2E live workflow time-in from mobile volunteer side.',
      attendancePhoto: 'data:image/png;base64,iVBORw0KGgo=',
    },
  });
  expect(timeIn.ok()).toBeTruthy();
  const timeInLog = (await timeIn.json()).log;
  expect(timeInLog.projectId).toBe(E2E_RECORDS.liveAttendanceEventId);
  expect(timeInLog.attendancePhoto).toContain('data:image/png');

  const attendanceCheck = await request.post(`${API_URL}/volunteer-time-logs/${timeInLog.id}/attendance-check`, {
    data: {
      checked: true,
      checkedByUserId: E2E_USERS.volunteer.id,
    },
  });
  expect(attendanceCheck.ok()).toBeTruthy();
  expect((await attendanceCheck.json()).log.attendanceCheckedBy).toBe(E2E_USERS.volunteer.id);

  const volunteerReport = await request.post(`${API_URL}/reports`, {
    data: {
      id: 'e2e-live-volunteer-field-report',
      projectId: E2E_RECORDS.liveAttendanceEventId,
      partnerId: E2E_RECORDS.partnerId,
      partnerUserId: E2E_USERS.partner.id,
      partnerName: 'E2E Barangay Nutrition Council',
      submitterUserId: E2E_USERS.volunteer.id,
      submitterName: 'E2E Volunteer Maria Santos',
      submitterRole: 'volunteer',
      title: 'E2E Live Volunteer Field Report',
      reportType: 'field_report',
      description: 'Volunteer completed the live kitchen shift and submitted a field report.',
      impactCount: 24,
      metrics: {
        beneficiariesAssisted: 24,
        volunteerHours: 2,
      },
      attachments: [],
      status: 'Submitted',
    },
  });
  expect(volunteerReport.ok()).toBeTruthy();
  expect((await volunteerReport.json()).report.submitterRole).toBe('volunteer');

  const partnerProposal = await request.post(`${API_URL}/partner-project-applications/request`, {
    data: {
      projectId: 'new',
      programModule: 'Education',
      partnerUserId: E2E_USERS.partner.id,
      partnerName: 'E2E Barangay Nutrition Council',
      partnerEmail: E2E_USERS.partner.email,
      proposalDetails: {
        requestedProgramModule: 'Education',
        proposedTitle: 'E2E Live Partner Education Outreach',
        proposedDescription: 'Partner proposes a real workflow education activity for learner support.',
        proposedStartDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        proposedEndDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        proposedLocation: 'Bacolod Community Learning Center',
        proposedVolunteersNeeded: 6,
        skillsNeeded: ['Tutoring', 'Documentation'],
        communityNeed: 'Learners need reading support and school kit preparation.',
        expectedDeliverables: 'Approved outreach project, volunteer roster, and partner report.',
        attachments: [],
      },
    },
  });
  expect(partnerProposal.ok()).toBeTruthy();
  const application = (await partnerProposal.json()).application;
  expect(application.status).toBe('Pending');

  const reviewedPartnerProposal = await request.post(
    `${API_URL}/partner-project-applications/${application.id}/review`,
    {
      data: {
        status: 'Approved',
        reviewedBy: E2E_USERS.admin.id,
        reviewNotes: 'Approved during E2E live workflow test.',
      },
    }
  );
  expect(reviewedPartnerProposal.ok()).toBeTruthy();
  const reviewedPartnerBody = await reviewedPartnerProposal.json();
  expect(reviewedPartnerBody.application.status).toBe('Approved');
  expect(reviewedPartnerBody.project.title).toBe('E2E Live Partner Education Outreach');

  // Verify the approval survived a fresh API read.  This catches persistence
  // regressions that a response-body assertion alone would miss.
  const persistedPartnerApplications = await request.get(
    `${API_URL}/partner-project-applications/by-user/${E2E_USERS.partner.id}`
  );
  expect(persistedPartnerApplications.ok()).toBeTruthy();
  const persistedApplication = (await persistedPartnerApplications.json()).applications.find(
    (item: any) => item.id === application.id
  );
  expect(persistedApplication?.status).toBe('Approved');

  const partnerReport = await request.post(`${API_URL}/reports`, {
    data: {
      id: 'e2e-live-partner-impact-report',
      projectId: reviewedPartnerBody.project.id,
      partnerId: E2E_RECORDS.partnerId,
      partnerUserId: E2E_USERS.partner.id,
      partnerName: 'E2E Barangay Nutrition Council',
      submitterUserId: E2E_USERS.partner.id,
      submitterName: 'E2E Partner Coordinator',
      submitterRole: 'partner',
      title: 'E2E Live Partner Impact Report',
      reportType: 'program_impact',
      description: 'Partner submitted the first impact report for the approved education outreach.',
      impactCount: 36,
      metrics: {
        learnersSupported: 36,
        kitsPrepared: 36,
      },
      attachments: [],
      status: 'Submitted',
    },
  });
  expect(partnerReport.ok()).toBeTruthy();
  expect((await partnerReport.json()).report.partnerUserId).toBe(E2E_USERS.partner.id);

  const finalSnapshot = await request.post(`${API_URL}/storage/batch`, {
    data: {
      keys: ['projects', 'events', 'volunteerProjectJoins', 'volunteerTimeLogs', 'partnerProjectApplications', 'partnerReports'],
    },
  });
  expect(finalSnapshot.ok()).toBeTruthy();
  const { items } = await finalSnapshot.json();
  expect(items.volunteerProjectJoins.some((join: any) => join.projectId === E2E_RECORDS.liveReviewEventId)).toBe(true);
  expect(items.volunteerTimeLogs.some((log: any) => log.projectId === E2E_RECORDS.liveAttendanceEventId && log.timeOut)).toBe(true);
  expect(items.partnerProjectApplications.some((item: any) => item.id === application.id && item.status === 'Approved')).toBe(true);
  expect(items.partnerReports.some((report: any) => report.id === 'e2e-live-volunteer-field-report')).toBe(true);
  expect(items.partnerReports.some((report: any) => report.id === 'e2e-live-partner-impact-report')).toBe(true);
});
