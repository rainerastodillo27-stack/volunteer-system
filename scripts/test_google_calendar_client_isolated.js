/* Calendar client checks using in-memory Google responses only.
 * Run: node scripts/test_google_calendar_client_isolated.js
 * No database, OAuth account, application storage, or HTTP request is used.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTypeScript(relativePath, imports, globals = {}) {
  const sourcePath = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: sourcePath,
  }).outputText;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(name) {
      if (!Object.prototype.hasOwnProperty.call(imports, name)) {
        throw new Error(`Unexpected dependency in isolated test: ${name}`);
      }
      return imports[name];
    },
    process: { env: {} },
    URL,
    URLSearchParams,
    Intl,
    Date,
    console,
    ...globals,
  };
  vm.runInNewContext(compiled, context, { filename: sourcePath });
  return module.exports;
}

function project(id, changes = {}) {
  return {
    id,
    title: `Fixture ${id}`,
    description: 'In-memory NVC fixture',
    partnerId: 'fixture-partner',
    isEvent: true,
    repeat: 'Does not repeat',
    category: 'Fixture category',
    status: 'In Progress',
    startDate: '2026-10-02',
    endDate: '2026-10-06',
    location: { latitude: 0, longitude: 0, address: 'Fixture venue' },
    volunteersNeeded: 2,
    volunteers: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    statusUpdates: [],
    ...changes,
  };
}

// Fixture IDs follow the existing export contract so the tests represent
// entries already stored by released app versions.
function legacyId(id) {
  let hash = 5381;
  for (const character of `nvc:${id}`) {
    hash = ((hash << 5) + hash + character.charCodeAt(0)) >>> 0;
  }
  return `nvc${hash.toString(16)}${id.length.toString(16)}`;
}

function legacyEvent(record, changes = {}) {
  return {
    id: legacyId(record.id),
    status: 'confirmed',
    summary: `[${record.isEvent ? 'Event' : 'Project'}] ${record.title}`,
    description: `${record.description}\n\n📂 Category: ${record.category}\n📌 Status: ${record.status}\n👥 Volunteers Needed: ${record.volunteersNeeded}`,
    start: { date: record.startDate },
    end: { date: '2026-10-07' },
    ...changes,
  };
}

function markedEvent(record, role, userId, changes = {}) {
  return legacyEvent(record, {
    extendedProperties: { private: {
      nvcManagedBy: 'nvc-connect',
      nvcSyncRole: role,
      nvcSyncUserId: userId,
      nvcProjectId: record.id,
    } },
    ...changes,
  });
}

class MemoryCalendar {
  constructor(events = [], options = {}) {
    this.events = new Map(events.map(event => [event.id, structuredClone(event)]));
    this.calls = [];
    this.pageSize = options.pageSize || 2500;
    this.failPage = options.failPage;
    this.listSnapshot = null;
  }

  response(status, body = {}) {
    return { status, ok: status >= 200 && status < 300, json: async () => structuredClone(body) };
  }

  async fetch(url, options = {}) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.googleapis.com', 'Only mocked Google requests are allowed');
    assert.equal(options.headers.Authorization, 'Bearer fixture-access-token');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    this.calls.push({ method, url: parsed.toString(), body, headers: { ...options.headers } });
    const resource = '/calendar/v3/calendars/primary/events';
    if (method === 'GET' && parsed.pathname === resource) {
      const page = Number(parsed.searchParams.get('pageToken') || '0');
      if (page === this.failPage) {
        return this.response(503, { error: { message: 'Injected incomplete listing' } });
      }
      if (this.listSnapshot === null) {
        this.listSnapshot = [...this.events.values()].filter(event => event.status !== 'cancelled');
      }
      const items = this.listSnapshot.slice(page * this.pageSize, (page + 1) * this.pageSize);
      const hasNext = (page + 1) * this.pageSize < this.listSnapshot.length;
      return this.response(200, { items, ...(hasNext ? { nextPageToken: String(page + 1) } : {}) });
    }
    if (method === 'POST' && parsed.pathname === resource) {
      if (this.events.has(body.id)) return this.response(409, { error: { message: 'Already exists' } });
      this.events.set(body.id, structuredClone(body));
      return this.response(200, body);
    }
    assert.ok(parsed.pathname.startsWith(`${resource}/`), 'Unexpected Google path');
    const eventId = decodeURIComponent(parsed.pathname.slice(resource.length + 1));
    if (method === 'PATCH') {
      const event = this.events.get(eventId);
      if (!event) return this.response(404);
      const updated = { ...event, ...body };
      this.events.set(eventId, updated);
      return this.response(200, updated);
    }
    if (method === 'DELETE') {
      const current = this.events.get(eventId);
      if (current && options.headers['If-Match'] && options.headers['If-Match'] !== current.etag) {
        return this.response(412, { error: { message: 'Calendar entry was edited after listing' } });
      }
      const existed = this.events.delete(eventId);
      return this.response(existed ? 204 : 404);
    }
    throw new Error(`Unexpected mocked method: ${method}`);
  }

  deletes() {
    return this.calls.filter(call => call.method === 'DELETE');
  }
}

const attendance = loadTypeScript('utils/attendanceSchedule.ts', {});
function client(calendar) {
  return loadTypeScript('utils/googleCalendarSync.ts', {
    'expo-auth-session': {},
    'expo-web-browser': { maybeCompleteAuthSession() {} },
    'react-native': { Platform: { OS: 'web' } },
    '../models/storage': {},
    './attendanceSchedule': attendance,
  }, { fetch: calendar.fetch.bind(calendar) });
}

function storageSnapshot(fetchBoundary) {
  const sourcePath = path.join(root, 'models/storage.ts');
  const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'getAdminCalendarSyncSnapshot');
  assert.ok(node, 'The real snapshot function must exist');
  const compiled = ts.transpileModule(node.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: sourcePath,
  }).outputText;
  const exports = {};
  const calls = [];
  const context = {
    exports,
    STORAGE_KEYS: { PROGRAMS: 'programs', PROJECTS: 'projects', EVENTS: 'events', ADMIN_PLANNING_CALENDARS: 'adminPlanningCalendars' },
    fetchRemoteStorageItemsUncached: async (keys, images) => {
      calls.push({ keys: Array.from(keys), images });
      return fetchBoundary();
    },
    // These transformations are independent of the validation under test;
    // storage and cached readers are deliberately absent from the context.
    mergeProjectAndEventRecords: (projects, events) => [...projects, ...events],
    collectPlanningItemsFromCalendars: calendars => calendars.flatMap(calendar => calendar.planningItems || []),
  };
  vm.runInNewContext(compiled, context, { filename: sourcePath });
  return { getSnapshot: exports.getAdminCalendarSyncSnapshot, calls };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('admin removes only stale legacy and owned entries across every page', async () => {
  const current = [project('current-event'), project('current-project', { isEvent: false }), project('current-program', { isEvent: false })];
  const unscheduled = project('retained-unscheduled', { startDate: '', endDate: '' });
  const removed = [project('deleted-marked'), project('deleted-legacy'), project('deleted-renamed')];
  const preserved = [
    legacyEvent(unscheduled),
    markedEvent(project('partner-owned'), 'partner', 'fixture-partner'),
    markedEvent(project('other-admin-owned'), 'admin', 'other-admin'),
    markedEvent(project('volunteer-owned'), 'volunteer', 'fixture-volunteer'),
    legacyEvent(project('instance'), { recurringEventId: 'fixture-series' }),
    { id: 'personal-entry', summary: 'Family gathering', description: 'Personal calendar entry' },
    { id: 'nvcface123', summary: '[Event] User-created item', description: 'Category: personal' },
  ];
  const calendar = new MemoryCalendar([
    ...current.map(record => legacyEvent(record)),
    markedEvent(removed[0], 'admin', 'fixture-admin'),
    legacyEvent(removed[1]),
    legacyEvent(removed[2], { summary: '[Event] Renamed in Google Calendar' }),
    ...preserved,
  ], { pageSize: 2 });
  const result = await client(calendar).syncProjectsToGoogleCalendar('fixture-access-token', current, {
    role: 'admin', userId: 'fixture-admin', planningItems: [],
    retainedProjectIds: [...current, unscheduled].map(record => record.id),
  });
  assert.equal(result.synced, 3);
  assert.equal(result.removed, 3);
  assert.equal(result.failed, 0);
  assert.equal(calendar.deletes().length, 3);
  for (const record of [...current, unscheduled]) assert.ok(calendar.events.has(legacyId(record.id)));
  for (const record of removed) assert.equal(calendar.events.has(legacyId(record.id)), false);
  for (const event of preserved) assert.ok(calendar.events.has(event.id), `Preserved ${event.id}`);
  assert.ok(calendar.calls.filter(call => call.method === 'GET').length > 1, 'Paged listing exercised');
});

test('admin cleans stale entries when all current records were deleted', async () => {
  const record = project('last-deleted-event');
  const calendar = new MemoryCalendar([legacyEvent(record)]);
  const result = await client(calendar).syncProjectsToGoogleCalendar('fixture-access-token', [], {
    role: 'admin', userId: 'fixture-admin', planningItems: [], retainedProjectIds: [],
  });
  assert.equal(result.synced, 0);
  assert.equal(result.removed, 1);
  assert.equal(result.failed, 0);
});

test('an incomplete calendar listing prevents every deletion', async () => {
  const records = [project('orphan-one'), project('orphan-two'), project('orphan-three')];
  const calendar = new MemoryCalendar(records.map(record => legacyEvent(record)), { pageSize: 1, failPage: 1 });
  const result = await client(calendar).syncProjectsToGoogleCalendar('fixture-access-token', [], {
    role: 'admin', userId: 'fixture-admin', planningItems: [], retainedProjectIds: [],
  });
  assert.equal(result.success, false);
  assert.ok(result.failed > 0);
  assert.equal(calendar.deletes().length, 0);
  assert.equal(calendar.events.size, 3);
});

test('a calendar edit during cleanup blocks deletion until a fresh scan', async () => {
  const record = project('deleted-but-concurrently-edited');
  const calendar = new MemoryCalendar([legacyEvent(record, { etag: '"fixture-old-etag"' })]);
  const originalFetch = calendar.fetch.bind(calendar);
  let concurrentEdit = true;
  calendar.fetch = async (url, options = {}) => {
    if (options.method === 'DELETE' && concurrentEdit) {
      concurrentEdit = false;
      calendar.events.get(legacyId(record.id)).etag = '"fixture-new-etag"';
    }
    return originalFetch(url, options);
  };
  const module = client(calendar);
  const options = { role: 'admin', userId: 'fixture-admin', planningItems: [], retainedProjectIds: [] };
  const blocked = await module.syncProjectsToGoogleCalendar('fixture-access-token', [], options);
  assert.equal(blocked.success, false);
  assert.equal(blocked.failed, 1);
  assert.equal(blocked.removed, 0);
  assert.ok(calendar.events.has(legacyId(record.id)), 'Concurrent edit preserves the entry on this attempt');
  assert.equal(calendar.deletes()[0].headers['If-Match'], '"fixture-old-etag"');

  calendar.listSnapshot = null;
  const retry = await module.syncProjectsToGoogleCalendar('fixture-access-token', [], options);
  assert.equal(retry.failed, 0);
  assert.equal(retry.removed, 1);
  assert.equal(calendar.deletes()[1].headers['If-Match'], '"fixture-new-etag"');
  assert.equal(calendar.events.has(legacyId(record.id)), false);
});

test('planning ranges export with inclusive final day and distinct stable identities', async () => {
  const record = project('linked-project', { title: 'Same title', isEvent: false });
  const planningItem = {
    id: 'same-title-plan', title: 'Same title', description: 'Fixture plan', calendarId: 'fixture-lane',
    linkedProjectId: record.id, startDate: '2026-10-02', endDate: '2026-10-06',
    location: 'Fixture location', participantsLabel: 'Fixture attendees', createdBy: 'fixture-admin',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
  const calendar = new MemoryCalendar();
  const module = client(calendar);
  const formatted = module.formatAdminPlanningItemAsGoogleEvent(planningItem);
  assert.equal(formatted.start.date, '2026-10-02');
  assert.equal(formatted.end.date, '2026-10-07');
  assert.equal(formatted.summary, '[Planning] Same title');
  const result = await module.syncProjectsToGoogleCalendar('fixture-access-token', [record], {
    role: 'admin', userId: 'fixture-admin', planningItems: [planningItem], retainedProjectIds: [record.id],
  });
  assert.equal(result.synced, 2);
  assert.equal(result.removed, 0);
  assert.equal(calendar.events.size, 2, 'Linked plan and project each have a distinct calendar entry');
  assert.ok(calendar.events.has(legacyId(record.id)));
  assert.ok(calendar.events.has(legacyId(`admin-planning:${planningItem.id}`)));

  calendar.listSnapshot = null;
  const afterDelete = await module.syncProjectsToGoogleCalendar('fixture-access-token', [record], {
    role: 'admin', userId: 'fixture-admin', planningItems: [], retainedProjectIds: [record.id],
  });
  assert.equal(afterDelete.removed, 1);
  assert.ok(calendar.events.has(legacyId(record.id)));
  assert.equal(calendar.events.has(legacyId(`admin-planning:${planningItem.id}`)), false);
});

test('volunteer cleanup preserves its current membership and other calendar owners', async () => {
  const joined = project('joined-event');
  const unjoined = project('unjoined-event');
  const removedOwned = project('removed-owned-event');
  const unknownLegacy = project('unknown-old-event');
  const partner = markedEvent(project('partner-event'), 'partner', 'fixture-partner');
  const calendar = new MemoryCalendar([
    legacyEvent(joined), legacyEvent(unjoined), legacyEvent(unknownLegacy), partner,
    markedEvent(removedOwned, 'volunteer', 'fixture-volunteer'),
  ]);
  const result = await client(calendar).syncProjectsToGoogleCalendar('fixture-access-token', [joined], {
    role: 'volunteer', userId: 'fixture-volunteer', unjoinedEventProjects: [unjoined],
  });
  assert.equal(result.synced, 1);
  assert.equal(result.removed, 2);
  assert.equal(result.failed, 0);
  assert.ok(calendar.events.has(legacyId(joined.id)));
  assert.ok(calendar.events.has(legacyId(unknownLegacy.id)), 'Unowned legacy entries require a known unjoined record');
  assert.ok(calendar.events.has(partner.id));
});

test('rejoining restores the existing cancelled calendar ID', async () => {
  const joined = project('rejoined-event');
  const calendar = new MemoryCalendar([markedEvent(joined, 'volunteer', 'fixture-volunteer', { status: 'cancelled' })]);
  const result = await client(calendar).syncProjectsToGoogleCalendar('fixture-access-token', [joined], {
    role: 'volunteer', userId: 'fixture-volunteer', unjoinedEventProjects: [],
  });
  assert.equal(result.synced, 1);
  assert.equal(result.failed, 0);
  assert.equal(calendar.events.get(legacyId(joined.id)).status, 'confirmed');
});

test('the admin snapshot requires all four authoritative server arrays', async () => {
  const valid = {
    programs: [project('snapshot-program')], projects: [project('snapshot-project')],
    events: [project('snapshot-event')], adminPlanningCalendars: [{ id: 'lane', planningItems: [{ id: 'snapshot-plan' }] }],
  };
  const snapshot = storageSnapshot(async () => valid);
  const result = await snapshot.getSnapshot();
  assert.deepEqual(Array.from(result.projects, item => item.id), ['snapshot-program', 'snapshot-project', 'snapshot-event']);
  assert.deepEqual(Array.from(result.planningItems, item => item.id), ['snapshot-plan']);
  assert.deepEqual(snapshot.calls, [{ keys: ['programs', 'projects', 'events', 'adminPlanningCalendars'], images: false }]);
  for (const key of Object.keys(valid)) {
    for (const badValue of [undefined, null, {}]) {
      const malformed = storageSnapshot(async () => ({ ...valid, [key]: badValue }));
      await assert.rejects(malformed.getSnapshot(), /could not be verified/);
    }
  }
  const empty = storageSnapshot(async () => ({ programs: [], projects: [], events: [], adminPlanningCalendars: [] }));
  assert.equal((await empty.getSnapshot()).projects.length, 0, 'Verified empty inventories permit final-record cleanup');
});

test('source fetch failure propagates without using cached or default data', async () => {
  const snapshot = storageSnapshot(async () => { throw new Error('Injected source fetch failure'); });
  await assert.rejects(snapshot.getSnapshot(), /Injected source fetch failure/);
  assert.equal(snapshot.calls.length, 1);
});

async function main() {
  let passed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
  console.log(`${passed} isolated client calendar checks passed; no real calendar data was accessed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
