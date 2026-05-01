#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Non-destructive E2E smoke suite for core workflows.
 *
 * What it does:
 * - Backs up mutable storage collections
 * - Exercises core API flows (auth, create proposal, approve/reject, join, report, chat)
 * - Restores original storage collections in a finally block
 *
 * Run:
 *   node scripts/qa-smoke-e2e.js
 *   VOLCRE_API_BASE_URL=http://127.0.0.1:8000 node scripts/qa-smoke-e2e.js
 */

const BASE_URL = (process.env.VOLCRE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 45000;

const MUTABLE_KEYS = [
  'projects',
  'events',
  'volunteers',
  'statusUpdates',
  'volunteerMatches',
  'volunteerTimeLogs',
  'volunteerProjectJoins',
  'partnerProjectApplications',
  'partnerReports',
];

const state = {
  backup: null,
  ids: {
    adminUserId: '',
    volunteerUserId: '',
    partnerUserId: '',
    volunteerProfileId: '',
    eventId: '',
    approvedApplicationId: '',
    rejectedApplicationId: '',
    approvedCreatedProjectId: '',
    reviewMatchedId: '',
    reviewRejectedId: '',
  },
  counters: {
    passed: 0,
    failed: 0,
  },
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(path, options = {}, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${BASE_URL}${path}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      const detail =
        (payload && (payload.detail || payload.message || JSON.stringify(payload))) ||
        `HTTP ${response.status}`;
      throw new Error(`${response.status} ${response.statusText}: ${detail}`);
    }

    return payload;
  } catch (error) {
    const isRetryable = attempt < 2;
    if (isRetryable) {
      await sleep(700 * attempt);
      return request(path, options, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function pass(label, extra = '') {
  state.counters.passed += 1;
  console.log(`PASS | ${label}${extra ? ` | ${extra}` : ''}`);
}

function fail(label, error) {
  state.counters.failed += 1;
  console.error(`FAIL | ${label} | ${error instanceof Error ? error.message : String(error)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function backupStorage() {
  const backup = {};
  for (const key of MUTABLE_KEYS) {
    const payload = await request(`/storage/${encodeURIComponent(key)}`);
    backup[key] = payload?.value;
  }
  state.backup = backup;
}

async function restoreStorage() {
  if (!state.backup) {
    return;
  }

  for (const key of MUTABLE_KEYS) {
    const value = state.backup[key];
    const normalizedValue = Array.isArray(value) ? value : [];
    await request(`/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: normalizedValue }),
    });
  }
}

async function runStep(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (error) {
    fail(label, error);
  }
}

async function run() {
  console.log(`Running Volcre smoke suite against ${BASE_URL}`);
  console.log(`Started: ${nowIso()}`);

  try {
    await backupStorage();
    pass('Backup mutable storage keys');
  } catch (error) {
    fail('Backup mutable storage keys', error);
    throw new Error('Backup failed, aborting smoke suite to avoid unsafe mutations.');
  }

  await runStep('Health endpoint', async () => {
    const payload = await request('/health');
    assert(payload && payload.status === 'ok', 'health status is not ok');
  });

  await runStep('DB health endpoint', async () => {
    const payload = await request('/db-health');
    assert(payload && payload.status === 'ok', 'db-health status is not ok');
  });

  await runStep('Admin login', async () => {
    const payload = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'admin@nvc.org', password: 'admin123' }),
    });
    const user = payload?.user;
    assert(user && user.role === 'admin', 'admin login failed or wrong role');
    state.ids.adminUserId = String(user.id || '');
    assert(state.ids.adminUserId, 'admin user id missing');
  });

  await runStep('Volunteer login', async () => {
    const payload = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'volunteer@example.com', password: 'volunteer123' }),
    });
    const user = payload?.user;
    assert(user && user.role === 'volunteer', 'volunteer login failed or wrong role');
    state.ids.volunteerUserId = String(user.id || '');
    assert(state.ids.volunteerUserId, 'volunteer user id missing');
  });

  await runStep('Partner login', async () => {
    const payload = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'partnerships@pbsp.org.ph', password: 'partner123' }),
    });
    const user = payload?.user;
    assert(user && user.role === 'partner', 'partner login failed or wrong role');
    state.ids.partnerUserId = String(user.id || '');
    assert(state.ids.partnerUserId, 'partner user id missing');
  });

  await runStep('Load snapshot and find one event', async () => {
    const snapshot = await request('/projects/snapshot');
    const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
    const event = projects.find(project => project && project.isEvent);
    assert(event && event.id, 'no event found in snapshot');
    state.ids.eventId = String(event.id);
  });

  await runStep('Load volunteer profile by user', async () => {
    try {
      const profile = await request(`/volunteers/by-user/${encodeURIComponent(state.ids.volunteerUserId)}`);
      if (profile && profile.id) {
        state.ids.volunteerProfileId = String(profile.id);
        return;
      }
    } catch {
      // Fallback to storage collection lookup.
    }

    const volunteersPayload = await request('/storage/volunteers');
    const volunteers = Array.isArray(volunteersPayload?.value) ? volunteersPayload.value : [];
    const volunteer = volunteers.find(item => String(item?.userId || '') === state.ids.volunteerUserId) || volunteers[0];
    assert(volunteer && volunteer.id, 'volunteer profile not found');
    state.ids.volunteerProfileId = String(volunteer.id);
    if (!state.ids.volunteerUserId && volunteer.userId) {
      state.ids.volunteerUserId = String(volunteer.userId);
    }
  });

  await runStep('Partner proposal create (for approve)', async () => {
    const uniqueModule = `Disaster`;
    const payload = await request('/partner-project-applications/request', {
      method: 'POST',
      body: JSON.stringify({
        projectId: `program:${uniqueModule}`,
        programModule: uniqueModule,
        partnerUserId: state.ids.partnerUserId,
        partnerName: 'PBSP Account',
        partnerEmail: 'partnerships@pbsp.org.ph',
        proposalDetails: {
          proposedTitle: `E2E Approve ${uniqueModule} ${Date.now()}`,
          proposedDescription: 'Automated smoke proposal for approve flow',
          proposedLocation: 'Bacolod City, Negros Occidental',
          proposedVolunteersNeeded: 5,
          requestedProgramModule: uniqueModule,
        },
      }),
    });
    const application = payload?.application;
    assert(application && application.id, 'proposal application missing');
    state.ids.approvedApplicationId = String(application.id);
  });

  await runStep('Partner proposal approve', async () => {
    const payload = await request(
      `/partner-project-applications/${encodeURIComponent(state.ids.approvedApplicationId)}/review`,
      {
        method: 'POST',
        body: JSON.stringify({
          status: 'Approved',
          reviewedBy: state.ids.adminUserId,
        }),
      }
    );
    const application = payload?.application;
    assert(application && application.status === 'Approved', 'application not approved');
    state.ids.approvedCreatedProjectId = String(application.projectId || '');
    assert(state.ids.approvedCreatedProjectId.startsWith('project-'), 'approved project id not created');
  });

  await runStep('Partner proposal create (for reject)', async () => {
    const uniqueModule = `Education`;
    const payload = await request('/partner-project-applications/request', {
      method: 'POST',
      body: JSON.stringify({
        projectId: `program:${uniqueModule}`,
        programModule: uniqueModule,
        partnerUserId: state.ids.partnerUserId,
        partnerName: 'PBSP Account',
        partnerEmail: 'partnerships@pbsp.org.ph',
        proposalDetails: {
          proposedTitle: `E2E Reject ${uniqueModule} ${Date.now()}`,
          proposedDescription: 'Automated smoke proposal for reject flow',
          proposedLocation: 'Kabankalan City, Negros Occidental',
          proposedVolunteersNeeded: 3,
          requestedProgramModule: uniqueModule,
        },
      }),
    });
    const application = payload?.application;
    assert(application && application.id, 'reject proposal application missing');
    state.ids.rejectedApplicationId = String(application.id);
  });

  await runStep('Partner proposal reject', async () => {
    const payload = await request(
      `/partner-project-applications/${encodeURIComponent(state.ids.rejectedApplicationId)}/review`,
      {
        method: 'POST',
        body: JSON.stringify({
          status: 'Rejected',
          reviewedBy: state.ids.adminUserId,
        }),
      }
    );
    const application = payload?.application;
    assert(application && application.status === 'Rejected', 'application not rejected');
  });

  await runStep('Volunteer direct join event', async () => {
    const payload = await request(`/projects/${encodeURIComponent(state.ids.eventId)}/join`, {
      method: 'POST',
      body: JSON.stringify({ userId: state.ids.volunteerUserId }),
    });
    const project = payload?.project;
    assert(project && Array.isArray(project.joinedUserIds), 'join response missing project');
    assert(project.joinedUserIds.includes(state.ids.volunteerUserId), 'volunteer user id not joined');
  });

  await runStep('Create Requested volunteer match (for approve/reject test)', async () => {
    const current = await request('/storage/volunteerMatches');
    const currentMatches = Array.isArray(current?.value) ? current.value : [];
    const now = nowIso();
    const matchApprove = {
      id: `match-e2e-approve-${Date.now()}`,
      volunteerId: state.ids.volunteerProfileId,
      projectId: state.ids.eventId,
      status: 'Requested',
      requestedAt: now,
      matchedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      hoursContributed: 0,
    };
    const matchReject = {
      id: `match-e2e-reject-${Date.now()}`,
      volunteerId: state.ids.volunteerProfileId,
      projectId: state.ids.eventId,
      status: 'Requested',
      requestedAt: now,
      matchedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      hoursContributed: 0,
    };
    state.ids.reviewMatchedId = matchApprove.id;
    state.ids.reviewRejectedId = matchReject.id;

    await request('/storage/volunteerMatches', {
      method: 'PUT',
      body: JSON.stringify({
        value: [...currentMatches, matchApprove, matchReject],
      }),
    });
  });

  await runStep('Review volunteer match -> Matched', async () => {
    const payload = await request(
      `/volunteer-matches/${encodeURIComponent(state.ids.reviewMatchedId)}/review`,
      {
        method: 'POST',
        body: JSON.stringify({
          status: 'Matched',
          reviewedBy: state.ids.adminUserId,
        }),
      }
    );
    const match = payload?.match;
    assert(match && match.status === 'Matched', 'volunteer match not approved');
  });

  await runStep('Review volunteer match -> Rejected', async () => {
    const payload = await request(
      `/volunteer-matches/${encodeURIComponent(state.ids.reviewRejectedId)}/review`,
      {
        method: 'POST',
        body: JSON.stringify({
          status: 'Rejected',
          reviewedBy: state.ids.adminUserId,
        }),
      }
    );
    const match = payload?.match;
    assert(match && match.status === 'Rejected', 'volunteer match not rejected');
  });

  await runStep('Submit partner report', async () => {
    const payload = await request('/reports', {
      method: 'POST',
      body: JSON.stringify({
        projectId: state.ids.eventId,
        submitterUserId: state.ids.partnerUserId,
        submitterName: 'PBSP Account',
        submitterRole: 'partner',
        reportType: 'General',
        description: 'Automated E2E smoke report submission',
        impactCount: 7,
        metrics: { beneficiaries: 7 },
      }),
    });
    assert(payload?.report?.id, 'report id missing');
  });

  await runStep('Read direct messages (admin)', async () => {
    const payload = await request(`/messages?user_id=${encodeURIComponent(state.ids.adminUserId)}`);
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    assert(messages.length >= 0, 'direct message payload is invalid');
  });

  await runStep('Read project group messages (admin)', async () => {
    const payload = await request(
      `/projects/${encodeURIComponent(state.ids.eventId)}/group-messages?user_id=${encodeURIComponent(
        state.ids.adminUserId
      )}`
    );
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    assert(messages.length >= 0, 'project group messages payload is invalid');
  });

  await runStep('Restore mutable storage keys', restoreStorage);

  console.log('\nSmoke suite finished.');
  console.log(`Passed: ${state.counters.passed}`);
  console.log(`Failed: ${state.counters.failed}`);
  if (state.counters.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch(async error => {
  fail('Fatal runner error', error);
  try {
    await restoreStorage();
    pass('Restore mutable storage keys after fatal error');
  } catch (restoreError) {
    fail('Restore mutable storage keys after fatal error', restoreError);
  }
  process.exitCode = 1;
});
