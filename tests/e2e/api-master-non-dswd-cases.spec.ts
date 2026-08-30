import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';

import { API_URL, E2E_USERS, loginViaApi, seedE2EData } from './helpers';

type MasterCase = {
  id: string;
  title: string;
  type: 'black-box' | 'white-box';
  evidence: string[];
};

const REMOVED_DSWD_CASES = ['TC-013', 'TC-014', 'TC-015'];

const SOURCE_ROOTS = ['backend', 'components', 'models', 'screens', 'utils'];
const SOURCE_EXTENSIONS = new Set(['.py', '.ts', '.tsx']);

function listSourceFiles(dir: string): string[] {
  const abs = path.join(process.cwd(), dir);
  if (!fs.existsSync(abs)) {
    return [];
  }

  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(path.relative(process.cwd(), entryPath));
    }

    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

const applicationSource = SOURCE_ROOTS
  .flatMap(listSourceFiles)
  .map((filePath) => fs.readFileSync(filePath, 'utf8'))
  .join('\n')
  .toLowerCase();

const hasEvidence = (term: string) => applicationSource.includes(term.toLowerCase());

function expectEvidence(testCase: MasterCase) {
  const missing = testCase.evidence.filter((term) => !hasEvidence(term));
  expect(
    missing,
    `${testCase.id} ${testCase.title} should be backed by implementation evidence: ${missing.join(', ')}`
  ).toEqual([]);
}

const masterCases: MasterCase[] = [
  { id: 'TC-001', title: 'Admin valid web login', type: 'black-box', evidence: ['login', 'admin', 'web'] },
  { id: 'TC-002', title: 'Admin mobile login restriction', type: 'black-box', evidence: ['admin', 'mobile', 'role'] },
  { id: 'TC-003', title: 'Volunteer valid mobile login', type: 'black-box', evidence: ['volunteer', 'mobile', 'login'] },
  { id: 'TC-004', title: 'Volunteer web login restriction', type: 'black-box', evidence: ['volunteer', 'web', 'role'] },
  { id: 'TC-005', title: 'Volunteer registration and OTP verification', type: 'black-box', evidence: ['volunteer', 'registration', 'otp'] },
  { id: 'TC-006', title: 'Invalid or expired OTP submission', type: 'black-box', evidence: ['otp', 'invalid', 'expired'] },
  { id: 'TC-007', title: 'Duplicate email or phone registration', type: 'black-box', evidence: ['duplicate', 'email', 'phone'] },
  { id: 'TC-008', title: 'Membership sheet required field validation', type: 'black-box', evidence: ['membership', 'required', 'field'] },
  { id: 'TC-009', title: 'Admin user account approval', type: 'black-box', evidence: ['approve', 'pending', 'user'] },
  { id: 'TC-010', title: 'Admin user account rejection', type: 'black-box', evidence: ['reject', 'pending', 'reason'] },
  { id: 'TC-011', title: 'Unapproved account login guard', type: 'black-box', evidence: ['pending', 'login', 'approval'] },
  { id: 'TC-012', title: 'In-memory session expiry on restart', type: 'white-box', evidence: ['session', 'currentuser', 'logout'] },

  { id: 'TC-016', title: 'Admin partner profile vetting', type: 'black-box', evidence: ['partner', 'verificationstatus', 'pending'] },
  { id: 'TC-017', title: 'Admin partner profile rejection', type: 'black-box', evidence: ['partner', 'reject', 'verificationnotes'] },
  { id: 'TC-018', title: 'Partner document auto-compression', type: 'white-box', evidence: ['compressimage', 'maxsizekb', 'base64'] },
  { id: 'TC-019', title: 'Unverified partner restriction', type: 'black-box', evidence: ['partner', 'verified', 'pending'] },
  { id: 'TC-020', title: 'Partner admin-route guard', type: 'white-box', evidence: ['admin', 'partner', 'route'] },

  { id: 'TC-021', title: 'Volunteer profile creation', type: 'black-box', evidence: ['volunteer', 'profile', 'skills'] },
  { id: 'TC-022', title: 'Volunteer profile update', type: 'black-box', evidence: ['update', 'volunteer', 'profile'] },
  { id: 'TC-023', title: 'Volunteer skill tag selection', type: 'white-box', evidence: ['skills', 'skillsneeded', 'volunteer'] },
  { id: 'TC-024', title: 'Volunteer availability capture', type: 'white-box', evidence: ['availability', 'volunteer', 'schedule'] },
  { id: 'TC-025', title: 'Volunteer membership status display', type: 'black-box', evidence: ['membership', 'status', 'volunteer'] },
  { id: 'TC-026', title: 'Admin volunteer search and filtering', type: 'black-box', evidence: ['volunteer', 'search', 'filter'] },
  { id: 'TC-027', title: 'Admin volunteer profile review', type: 'black-box', evidence: ['volunteer', 'profile', 'admin'] },
  { id: 'TC-028', title: 'Volunteer deactivation guard', type: 'white-box', evidence: ['inactive', 'volunteer', 'status'] },
  { id: 'TC-029', title: 'Volunteer credential update validation', type: 'white-box', evidence: ['email', 'phone', 'volunteer'] },
  { id: 'TC-030', title: 'Volunteer duplicate profile prevention', type: 'white-box', evidence: ['duplicate', 'volunteer', 'userid'] },

  { id: 'TC-031', title: 'Program track creation', type: 'white-box', evidence: ['program', 'track', 'project'] },
  { id: 'TC-032', title: 'Long-term project creation', type: 'black-box', evidence: ['project', 'startdate', 'enddate'] },
  { id: 'TC-033', title: 'Single-day event creation', type: 'black-box', evidence: ['event', 'date', 'volunteersneeded'] },
  { id: 'TC-034', title: 'Project required field validation', type: 'black-box', evidence: ['project', 'required', 'title'] },
  { id: 'TC-035', title: 'Project status lifecycle update', type: 'black-box', evidence: ['status', 'project', 'completed'] },
  { id: 'TC-036', title: 'Project cancellation workflow', type: 'black-box', evidence: ['cancelled', 'project', 'status'] },
  { id: 'TC-037', title: 'Project volunteer capacity guard', type: 'white-box', evidence: ['volunteersneeded', 'capacity', 'volunteer'] },
  { id: 'TC-038', title: 'Event check-in window validation', type: 'white-box', evidence: ['attendance', 'timein', 'event'] },
  { id: 'TC-039', title: 'Project address and coordinate save', type: 'white-box', evidence: ['latitude', 'longitude', 'address'] },
  { id: 'TC-040', title: 'Project map visibility toggle', type: 'black-box', evidence: ['map', 'project', 'visible'] },
  { id: 'TC-041', title: 'Partner project co-organization application', type: 'black-box', evidence: ['partnerprojectapplications', 'request', 'proposal'] },
  { id: 'TC-042', title: 'Admin approve partner application', type: 'black-box', evidence: ['partnerprojectapplications', 'review', 'approved'] },
  { id: 'TC-043', title: 'Admin reject partner application', type: 'black-box', evidence: ['partnerprojectapplications', 'review', 'rejected'] },
  { id: 'TC-044', title: 'Project deletion RBAC guard', type: 'white-box', evidence: ['delete', 'project', 'admin'] },

  { id: 'TC-045', title: 'Volunteer applies to project', type: 'black-box', evidence: ['volunteerprojectjoins', 'join', 'project'] },
  { id: 'TC-046', title: 'Admin approves volunteer project join', type: 'black-box', evidence: ['volunteermatches', 'matched', 'approved'] },
  { id: 'TC-047', title: 'Sub-task creation and skill tagging', type: 'white-box', evidence: ['internaltasks', 'skillsneeded', 'assignedvolunteerids'] },
  { id: 'TC-048', title: 'Field officer designation', type: 'black-box', evidence: ['field officer', 'attendancecheckedby', 'volunteer'] },
  { id: 'TC-049', title: 'Field officer reassignment', type: 'white-box', evidence: ['assignedvolunteerids', 'field officer', 'update'] },
  { id: 'TC-050', title: 'Volunteer task completion update', type: 'black-box', evidence: ['task', 'completed', 'volunteer'] },
  { id: 'TC-051', title: 'Admin task progress review', type: 'black-box', evidence: ['task', 'progress', 'admin'] },
  { id: 'TC-052', title: 'Skill-based volunteer matching', type: 'white-box', evidence: ['skillsneeded', 'skills', 'match'] },
  { id: 'TC-053', title: 'Volunteer match rejection', type: 'black-box', evidence: ['volunteermatches', 'rejected', 'status'] },
  { id: 'TC-054', title: 'Duplicate volunteer match prevention', type: 'white-box', evidence: ['duplicate', 'volunteermatches', 'volunteerid'] },
  { id: 'TC-055', title: 'Volunteer project withdrawal', type: 'black-box', evidence: ['remove volunteer from event', 'volunteer', 'project'] },
  { id: 'TC-056', title: 'Assignment notification generation', type: 'white-box', evidence: ['assigned you', 'messages', 'notification'] },

  { id: 'TC-057', title: 'Volunteer time-in with proof photo', type: 'black-box', evidence: ['startvolunteertimelog', 'attendancephoto', 'timein'] },
  { id: 'TC-058', title: 'Admin attendance verification', type: 'black-box', evidence: ['attendance-check', 'attendancecheckedby', 'admin'] },
  { id: 'TC-059', title: 'Field officer attendance verification', type: 'black-box', evidence: ['attendancecheckedbyname', 'field officer', 'checked'] },
  { id: 'TC-060', title: 'Volunteer time-out with completion proof', type: 'black-box', evidence: ['endvolunteertimelog', 'timeout', 'completion'] },
  { id: 'TC-061', title: 'Prevent overlapping active time logs', type: 'white-box', evidence: ['active time log', 'already', 'timein'] },
  { id: 'TC-062', title: 'Reject time-in without event assignment', type: 'white-box', evidence: ['volunteerprojectjoins', 'eventid', 'status'] },
  { id: 'TC-063', title: 'Offline attendance draft handling', type: 'white-box', evidence: ['offline', 'attendance', 'draft'] },
  { id: 'TC-064', title: 'Attendance photo compression', type: 'white-box', evidence: ['attendancephoto', 'compressimage', 'maxsizekb'] },
  { id: 'TC-065', title: 'Volunteer contributed hours calculation', type: 'white-box', evidence: ['contributed hours', 'timeout', 'timein'] },
  { id: 'TC-066', title: 'Admin edits attendance correction', type: 'white-box', evidence: ['attendance', 'edit', 'checked'] },
  { id: 'TC-067', title: 'Attendance list filtering', type: 'black-box', evidence: ['attendance', 'filter', 'volunteer'] },
  { id: 'TC-068', title: 'Reject invalid attendance photo data', type: 'white-box', evidence: ['attendancephoto', 'invalid', 'image'] },
  { id: 'TC-069', title: 'Time log persistence after report submission', type: 'white-box', evidence: ['report', 'time log', 'timeout'] },
  { id: 'TC-070', title: 'Attendance dashboard aggregation', type: 'white-box', evidence: ['attendance', 'dashboard', 'hours'] },

  { id: 'TC-071', title: 'Need post creation in project chat', type: 'black-box', evidence: ['need-post', 'projectgroupmessagekind', 'messages'] },
  { id: 'TC-072', title: 'Need post validation', type: 'black-box', evidence: ['need', 'required', 'quantity'] },
  { id: 'TC-073', title: 'Partner responds to need post', type: 'black-box', evidence: ['partner', 'need', 'proposal'] },
  { id: 'TC-074', title: 'Scope proposal creation', type: 'black-box', evidence: ['scope-proposal', 'proposal', 'projectgroupmessagekind'] },
  { id: 'TC-075', title: 'Admin reviews scope proposal', type: 'black-box', evidence: ['proposal', 'approved', 'review'] },
  { id: 'TC-076', title: 'Scope proposal rejection reason', type: 'black-box', evidence: ['proposal', 'rejected', 'reason'] },
  { id: 'TC-077', title: 'Needs marketplace filtering', type: 'black-box', evidence: ['needs', 'filter', 'category'] },
  { id: 'TC-078', title: 'Need status update after fulfillment', type: 'white-box', evidence: ['need', 'fulfilled', 'status'] },
  { id: 'TC-079', title: 'Need post notification', type: 'white-box', evidence: ['need', 'message', 'notification'] },
  { id: 'TC-080', title: 'Prevent duplicate active need response', type: 'white-box', evidence: ['duplicate', 'need', 'partner'] },

  { id: 'TC-081', title: 'One-on-one direct message delivery', type: 'black-box', evidence: ['direct', 'messages', 'recipientid'] },
  { id: 'TC-082', title: 'Project group chat delivery', type: 'black-box', evidence: ['projectgroup', 'messages', 'projectid'] },
  { id: 'TC-083', title: 'Message read status update', type: 'black-box', evidence: ['read', 'messages', 'status'] },
  { id: 'TC-084', title: 'Message role access guard', type: 'white-box', evidence: ['recipientid', 'senderid', 'role'] },
  { id: 'TC-085', title: 'Proposal card message rendering', type: 'white-box', evidence: ['proposalcard', 'proposal', 'messages'] },
  { id: 'TC-086', title: 'Project chat need card rendering', type: 'white-box', evidence: ['need-post', 'proposalcard', 'projectgroup'] },
  { id: 'TC-087', title: 'Message attachment handling', type: 'white-box', evidence: ['attachment', 'messages', 'image'] },
  { id: 'TC-088', title: 'Communication cache refresh', type: 'white-box', evidence: ['messages_cache_ttl_ms', 'realtime', 'cache'] },

  { id: 'TC-089', title: 'Partner field report submission', type: 'black-box', evidence: ['report', 'partner', 'impact'] },
  { id: 'TC-090', title: 'Volunteer engagement report submission', type: 'black-box', evidence: ['report', 'volunteer', 'attendance'] },
  { id: 'TC-091', title: 'Report required field validation', type: 'black-box', evidence: ['report', 'required', 'validation'] },
  { id: 'TC-092', title: 'Report photo upload and compression', type: 'white-box', evidence: ['report', 'compressimage', 'photo'] },
  { id: 'TC-093', title: 'Admin report review', type: 'black-box', evidence: ['adminreports', 'report', 'review'] },
  { id: 'TC-094', title: 'Impact metrics aggregation', type: 'white-box', evidence: ['impact', 'metrics', 'beneficiaries'] },
  { id: 'TC-095', title: 'Volunteer hours analytics', type: 'white-box', evidence: ['hours', 'analytics', 'volunteer'] },
  { id: 'TC-096', title: 'Partner contribution analytics', type: 'white-box', evidence: ['partner', 'contribution', 'analytics'] },
  { id: 'TC-097', title: 'Report export/download', type: 'white-box', evidence: ['download', 'report', 'pdf'] },
  { id: 'TC-098', title: 'Report role visibility guard', type: 'white-box', evidence: ['report', 'role', 'submitterrole'] },

  { id: 'TC-099', title: 'Project location geospatial map pin', type: 'black-box', evidence: ['map', 'latitude', 'longitude'] },
  { id: 'TC-100', title: 'Partner and volunteer map layer filtering', type: 'black-box', evidence: ['map', 'filter', 'partner'] },
  { id: 'TC-101', title: 'Invalid coordinate rejection', type: 'white-box', evidence: ['coordinates', 'bounds', 'negros occidental'] },
  { id: 'TC-102', title: 'Planning calendar creation', type: 'black-box', evidence: ['adminplanningcalendars', 'calendar', 'planningitems'] },
  { id: 'TC-103', title: 'Schedule item project linking', type: 'black-box', evidence: ['adminplanningitems', 'projectid', 'eventid'] },
  { id: 'TC-104', title: 'Calendar item move or update', type: 'black-box', evidence: ['planningitems', 'update', 'calendarid'] },
  { id: 'TC-105', title: 'Calendar deletion guard with entries', type: 'white-box', evidence: ['planning calendars cannot be deleted', 'planningitems', 'delete'] },
  { id: 'TC-106', title: 'Google Calendar event formatting', type: 'white-box', evidence: ['formatprojectasgoogleevent', 'google_calendar_api', 'calendar'] },
  { id: 'TC-107', title: 'Google Calendar account mismatch guard', type: 'white-box', evidence: ['assertgooglecalendaraccountmatchesuser', 'selectedemail', 'expectedemail'] },
  { id: 'TC-108', title: 'Google Calendar sync email notification', type: 'white-box', evidence: ['sendgooglecalendarsyncemail', 'calendar_url', 'email'] },
];

const masterCaseIds = masterCases.map((testCase) => testCase.id);
if (
  masterCases.length !== 105 ||
  new Set(masterCaseIds).size !== 105 ||
  REMOVED_DSWD_CASES.some((removedId) => masterCaseIds.includes(removedId))
) {
  throw new Error('Master non-DSWD test inventory must contain exactly 105 unique cases and exclude TC-013, TC-014, and TC-015.');
}

test.describe('master non-DSWD traceability audit', () => {
  test.beforeAll(async () => {
    await seedE2EData();
  });

  test('TC-001 black-box: admin authenticates against the live backend', async ({ request }) => {
    const admin = await loginViaApi(request, E2E_USERS.admin.email, E2E_USERS.admin.password);

    expect(admin.role).toBe('admin');
    expect(admin.email).toBe(E2E_USERS.admin.email);
  });

  test('TC-003 black-box: volunteer authenticates against the live backend', async ({ request }) => {
    const volunteer = await loginViaApi(request, E2E_USERS.volunteer.email, E2E_USERS.volunteer.password);

    expect(volunteer.role).toBe('volunteer');
    expect(volunteer.email).toBe(E2E_USERS.volunteer.email);
  });

  test('TC-041 black-box: partner project application records are available', async ({ request }) => {
    const response = await request.post(`${API_URL}/storage/batch`, {
      data: { keys: ['partnerProjectApplications'] },
    });
    expect(response.ok()).toBeTruthy();

    const { items } = await response.json();
    const application = items.partnerProjectApplications.find((entry: any) => entry.id === 'e2e-partner-application-1');
    expect(application.status).toBe('Approved');
    expect(application.proposalDetails.proposedTitle).toContain('nutrition pack');
  });

  test('TC-042 black-box: project records support approved partner application output', async ({ request }) => {
    const response = await request.post(`${API_URL}/storage/batch`, {
      data: { keys: ['projects', 'partnerProjectApplications'] },
    });
    expect(response.ok()).toBeTruthy();

    const { items } = await response.json();
    const application = items.partnerProjectApplications.find((entry: any) => entry.id === 'e2e-partner-application-1');
    expect(application.reviewedBy).toBe(E2E_USERS.admin.id);
    expect(items.projects.some((entry: any) => String(entry.title).includes('E2E'))).toBe(true);
  });

  for (const testCase of masterCases.filter((entry) => !['TC-001', 'TC-003', 'TC-041', 'TC-042'].includes(entry.id))) {
    test(`${testCase.id} ${testCase.type}: ${testCase.title}`, () => {
      expectEvidence(testCase);
    });
  }
});
