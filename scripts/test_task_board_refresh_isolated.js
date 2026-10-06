/* Task-board regression checks against extracted application functions.
 * Run: node scripts/test_task_board_refresh_isolated.js
 * Saves, joins, snapshots, and attendance use memory fixtures only. No API,
 * database, account, credential, browser, or application storage is accessed.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePaths = {
  web: 'screens/ProjectLifecycleScreen.tsx',
  apk: 'screens/VolunteerTasksScreen.tsx',
};
const trees = Object.fromEntries(Object.entries(sourcePaths).map(([key, relative]) => {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  return [key, ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)];
}));

function extracted(key, name) {
  const tree = trees[key];
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node.getText(tree).replace(/^export\s+(?:default\s+)?/, '');
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = `const ${node.getText(tree)};`;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `Actual ${sourcePaths[key]} function ${name} must exist`);
  return found;
}

function compile(source, filename = 'isolated-task-functions.ts') {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
}

function clone(value) {
  return structuredClone(value);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const fixedNow = '2026-10-02T01:10:00.000Z';
function fixtureClock() {
  let now = Date.parse(fixedNow);
  return {
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    advance() { now += 1000; },
  };
}
const documentFixture = { url: 'memory-document', type: 'document' };

function event(overrides = {}) {
  return {
    id: 'memory-disaster-event',
    title: 'Disaster Response Community Relief Event',
    description: 'Memory-only event',
    isEvent: true,
    status: 'In Progress',
    repeat: 'Daily',
    category: 'Disaster',
    startDate: '2026-09-19T00:00:00.000Z',
    endDate: '2026-11-30T07:30:00.000Z',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    volunteers: ['memory-volunteer'],
    joinedUserIds: ['memory-user'],
    volunteersNeeded: 50,
    internalTasks: [],
    ...overrides,
  };
}

function task(title = 'TEST', overrides = {}) {
  return {
    id: `memory-task-${title}`,
    title,
    description: 'Memory task for regression',
    category: 'General',
    status: 'Assigned',
    priority: 'Medium',
    assignedVolunteerId: 'memory-volunteer',
    assignedVolunteerIds: ['memory-volunteer'],
    assignedVolunteerName: 'Memory Joined Volunteer',
    assignedVolunteerNames: ['Memory Joined Volunteer'],
    skillsNeeded: ['Communication'],
    volunteersNeeded: 1,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides,
  };
}

function loadRefreshHelper() {
  const relative = 'utils/projectRecordRefresh.ts';
  const helperPath = path.join(root, relative);
  if (!fs.existsSync(helperPath)) return undefined;
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(helperPath, 'utf8'), relative), {
    module,
    exports: module.exports,
    require(name) { throw new Error(`Unexpected helper dependency: ${name}`); },
  }, { filename: relative, timeout: 1000 });
  return module.exports.mergeProjectRefresh;
}

function createHarness(initial = event()) {
  const volunteer = { id: 'memory-volunteer', userId: 'memory-user', name: 'Memory Joined Volunteer', skills: ['Communication'] };
  const join = { id: 'memory-join', projectId: initial.id, volunteerId: volunteer.id, userId: volunteer.userId, participationStatus: 'Active', joinedAt: '2026-10-02T01:00:00.000Z' };
  const db = new Map([[initial.id, clone(initial)]]);
  const writes = [];
  const alerts = [];
  const detailReads = [];
  const snapshotReads = [];
  const clock = fixtureClock();
  const c = {
    console: { warn() {}, error() {}, log() {} },
    Date: clock.Date,
    Map, Set, URL, URLSearchParams,
    user: { id: 'memory-admin', role: 'admin' },
    isAdmin: true,
    isPartnerUser: false,
    projects: [clone(initial)],
    selectedProject: clone(initial),
    volunteers: [volunteer],
    editingTaskId: null,
    taskDraft: { ...task(), status: 'Unassigned', volunteersNeeded: '1', isFieldOfficer: false },
    projectsLoadGenerationRef: { current: 0 },
    deletedProjectIdsRef: { current: new Set() },
    deletedProgramIdsRef: { current: new Set() },
    windowScrollOffsetRef: { current: 0 },
    shouldRestoreListScrollRef: { current: false },
    Platform: { OS: 'web' },
    Alert: { alert(...args) { alerts.push(args); } },
    fetch() { throw new Error('Network use is forbidden in the isolated regression'); },
    mergeProjectRefresh: loadRefreshHelper(),
    clearStorageCache() {},
    deriveProgramTracksFromProjects() { return []; },
    getRequestErrorTitle() { return 'Memory fixture failure'; },
    getRequestErrorMessage(error) { return error.message; },
    getAssignableVolunteerOptions(record) {
      return record.volunteers.includes(volunteer.id) || record.joinedUserIds.includes(volunteer.userId) ? [volunteer] : [];
    },
    notifyVolunteerAboutTaskUnassignment: async () => {},
    notifyVolunteerAboutTaskUpdate: async () => {},
    closeTaskModal() {},
    getAllProgramTracks: async () => [],
    async getProjectsScreenSnapshot() {
      const snapshot = { projects: [...db.values()].map(record => ({ ...clone(record), imageUrl: undefined, attachments: [] })), programTracks: [], volunteerJoinRecords: [clone(join)] };
      snapshotReads.push(clone(snapshot));
      return snapshot;
    },
    getProject(id) {
      const read = deferred();
      detailReads.push({ id, ...read });
      return read.promise;
    },
    loadStatusUpdates: async () => {},
    loadPartnerReportsForProject: async () => {},
    loadVolunteerJoinsForProject: async () => {},
    loadVolunteerMatchesForProject: async () => {},
    loadAllVolunteerMatches: async () => {},
  };
  for (const field of ['IsProjectsLoading', 'ProgramTracks', 'VolunteerJoinRecords', 'LoadError', 'ShowMoreDropdown', 'ShowProjectFullDetailsModal', 'EventWorkspaceTab', 'SelectedAttendanceVolunteerId', 'SelectedAttendancePhotoUri', 'SelectedAttendanceDateKey', 'IsTaskSaveSuccess', 'TaskSaveSuccessMessage', 'IsSavingTask']) {
    c[`set${field}`] = value => { c[field[0].toLowerCase() + field.slice(1)] = value; };
  }
  c.setProjects = value => { c.projects = typeof value === 'function' ? value(c.projects) : value; };
  c.setSelectedProject = value => { c.selectedProject = typeof value === 'function' ? value(c.selectedProject) : value; };
  for (const [name, requiredEvent] of [['saveEvent', true], ['saveProject', false]]) {
    c[name] = async record => {
      assert.equal(Boolean(record.isEvent), requiredEvent, 'Actual save dispatcher must choose the correct collection');
      db.set(record.id, clone(record));
      writes.push(clone(record));
    };
  }
  const names = ['getTaskAssignedVolunteerIds', 'getTaskVolunteerLimit', 'parseTaskVolunteerLimit', 'canCreateEventForProject', 'canManagePartnerEvent', 'canManageProjectTasks', 'saveProjectLikeRecord', 'loadProjects', 'handleSelectProject', 'getCurrentSelectedProject', '_executeSaveInternalTask'];
  const context = vm.createContext(c);
  vm.runInContext(compile(names.map(name => extracted('web', name)).join('\n') + `\nglobalThis.subject = { ${names.join(', ')} };`), context, { filename: sourcePaths.web, timeout: 1000 });
  return {
    context: c, db, writes, alerts, volunteer, join, detailReads, snapshotReads,
    subject: c.subject,
    async flush() {
      // Includes the actual void loadProjects fired after a successful task save.
      for (let turn = 0; turn < 12; turn++) await Promise.resolve();
      await new Promise(setImmediate);
      assert.equal(alerts.length, 0, `Save must not silently fail: ${JSON.stringify(alerts)}`);
    },
    async save(title = 'TEST') {
      const readsBeforeSave = snapshotReads.length;
      const loadsBeforeSave = c.projectsLoadGenerationRef.current;
      const writesBeforeSave = writes.length;
      clock.advance();
      c.taskDraft = { ...task(title), status: 'Unassigned', volunteersNeeded: '1', isFieldOfficer: false };
      c.editingTaskId = null;
      await c.subject._executeSaveInternalTask();
      await this.flush();
      assert.equal(writes.length, writesBeforeSave + 1, 'Task save must perform the actual event write');
      assert.ok(snapshotReads.length > readsBeforeSave, 'The lexical after-save snapshot request must actually run');
      assert.ok(c.projectsLoadGenerationRef.current > loadsBeforeSave, 'The actual after-save loadProjects function must run');
      const savedTasks = writes.at(-1).internalTasks;
      assert.equal(new Set(savedTasks.map(saved => saved.id)).size, savedTasks.length, 'Every saved task must have a unique ID');
      assert.ok(titles(c.projects.find(record => record.id === initial.id)).includes(title), 'The after-save snapshot must update the actual admin project list');
    },
  };
}

const apkNames = ['getTaskAssignedVolunteerIds', 'isVolunteerAssignedToTask', 'getTrackedTaskStatus', 'collectAssignedTasks'];
const apkContext = vm.createContext({
  Date: fixtureClock().Date, Map, Set,
  getAttendanceWindowKey: () => '2026-10-02',
  isEventOccurrenceToday: () => true,
  getNextEventOccurrenceDate: () => null,
  formatEventOccurrenceDate: () => '',
  getProjectDisplayStatus: project => project.status,
  hasEventEndedForToday: () => false,
  formatEventStartTime: () => '8:00 AM',
  fetch() { throw new Error('Network use is forbidden in the isolated regression'); },
});
vm.runInContext(compile(apkNames.map(name => extracted('apk', name)).join('\n') + '\nglobalThis.collect = collectAssignedTasks;'), apkContext, { filename: sourcePaths.apk, timeout: 1000 });

function titles(record) { return (record?.internalTasks || []).map(item => item.title); }
function apkTitles(h) {
  return apkContext.collect([...h.db.values()], h.volunteer, new Map([[h.join.projectId, h.join]]), []).map(item => item.title);
}
function expectTest(h) {
  assert.ok(titles(h.db.get('memory-disaster-event')).includes('TEST'), 'Persisted in-memory event must contain TEST');
  assert.ok(titles(h.subject.getCurrentSelectedProject()).includes('TEST'), 'Admin task board must contain TEST');
  assert.ok(apkTitles(h).includes('TEST'), 'Actual APK task collector must contain TEST');
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }

test('Saving TEST for a newly joined volunteer persists it in the admin board and APK task collector', async () => {
  const h = createHarness();
  await h.save();
  expectTest(h);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(Array.from(h.writes[0].internalTasks[0].assignedVolunteerIds), ['memory-volunteer']);
});

test('An old cover-bearing detail cannot hide TEST after its newer lightweight snapshot', async () => {
  const oldDetail = event({ imageUrl: 'memory-cover', attachments: [documentFixture] });
  const h = createHarness(oldDetail);
  await h.save();
  h.context.setSelectedProject(clone(oldDetail));
  expectTest(h);
  assert.equal(h.subject.getCurrentSelectedProject().imageUrl, 'memory-cover');
});

test('A late actual getProject detail response must preserve TEST added while it was loading', async () => {
  const oldDetail = event({ imageUrl: 'memory-cover' });
  const h = createHarness(oldDetail);
  await h.subject.handleSelectProject(clone(oldDetail));
  assert.equal(h.detailReads.length, 1);
  await h.save();
  h.detailReads[0].resolve(clone(oldDetail));
  await h.flush();
  expectTest(h);
  assert.ok(titles(h.context.selectedProject).includes('TEST'), 'Late detail must preserve the newer selected record too');
});

test('Creating FOLLOW-UP after stale image hydration must not delete existing TEST', async () => {
  const oldDetail = event({ imageUrl: 'memory-cover' });
  const h = createHarness(oldDetail);
  await h.save();
  const savedTestId = h.db.get('memory-disaster-event').internalTasks.find(saved => saved.title === 'TEST').id;
  h.context.setSelectedProject(clone(oldDetail));
  await h.save('FOLLOW-UP');
  expectTest(h);
  const savedTasks = h.db.get('memory-disaster-event').internalTasks;
  assert.ok(savedTasks.some(saved => saved.title === 'TEST' && saved.id === savedTestId), 'FOLLOW-UP must retain the original TEST ID');
  assert.ok(savedTasks.some(saved => saved.title === 'FOLLOW-UP' && saved.id !== savedTestId), 'FOLLOW-UP must be saved with its own distinct ID');
  assert.ok(new Date(h.writes[1].updatedAt) > new Date(h.writes[0].updatedAt), 'Independent saves must advance the event timestamp');
});

test('A fresher task deletion stays deleted even when selected detail still contains TEST and cover', async () => {
  const oldDetail = event({ internalTasks: [task()], imageUrl: 'memory-cover' });
  const h = createHarness(oldDetail);
  const deleted = event({ updatedAt: '2026-10-02T02:00:00.000Z' });
  h.db.set(deleted.id, clone(deleted));
  h.context.setProjects([clone(deleted)]);
  assert.ok(!titles(h.subject.getCurrentSelectedProject()).includes('TEST'), 'Admin selector must not resurrect a deleted TEST');
  assert.ok(!apkTitles(h).includes('TEST'));
});

test('Lightweight loadProjects refresh preserves existing cover and document while taking newer tasks', async () => {
  const oldDetail = event({ imageUrl: 'memory-cover', attachments: [documentFixture] });
  const h = createHarness(oldDetail);
  h.db.set(oldDetail.id, event({ internalTasks: [task()], updatedAt: fixedNow }));
  await h.subject.loadProjects(true);
  await h.flush();
  expectTest(h);
  assert.equal(h.context.selectedProject.imageUrl, 'memory-cover');
  assert.deepEqual(Array.from(h.context.selectedProject.attachments), [documentFixture]);
});

test('Late pre-save snapshot cannot roll the confirmed selected tasks back', async () => {
  const h = createHarness(event({ internalTasks: [task()], updatedAt: fixedNow }));
  const lateSnapshot = deferred();
  h.context.getProjectsScreenSnapshot = () => lateSnapshot.promise;
  const load = h.subject.loadProjects(true);
  lateSnapshot.resolve({ projects: [event()], programTracks: [], volunteerJoinRecords: [h.join] });
  await load;
  await h.flush();
  expectTest(h);
});

test('Late detail of a deleted task cannot restore it into selected state', async () => {
  const oldDetail = event({ imageUrl: 'memory-cover', internalTasks: [task()] });
  const h = createHarness(oldDetail);
  await h.subject.handleSelectProject(clone(oldDetail));
  const deleted = event({ updatedAt: '2026-10-02T02:00:00.000Z' });
  h.db.set(deleted.id, clone(deleted));
  h.context.setProjects([clone(deleted)]);
  h.context.setSelectedProject(clone(deleted));
  h.detailReads[0].resolve(clone(oldDetail));
  await h.flush();
  assert.ok(!titles(h.context.selectedProject).includes('TEST'), 'Late deleted-task detail must not overwrite selected state');
  assert.ok(!titles(h.subject.getCurrentSelectedProject()).includes('TEST'));
  assert.ok(!apkTitles(h).includes('TEST'));
});

test('A fresh full detail response applies deliberate cover and document removal', async () => {
  const h = createHarness(event({ imageUrl: 'memory-cover', attachments: [documentFixture] }));
  await h.subject.handleSelectProject(clone(h.context.selectedProject));
  const freshDetail = event({ internalTasks: [task()], updatedAt: fixedNow, imageUrl: undefined, attachments: [] });
  h.db.set(freshDetail.id, clone(freshDetail));
  h.detailReads[0].resolve(clone(freshDetail));
  await h.flush();
  expectTest(h);
  assert.equal(h.context.selectedProject.imageUrl, undefined, 'A full detail must be able to clear a cover');
  assert.equal(h.context.selectedProject.attachments.length, 0, 'A full detail must be able to clear documents');
});

test('A fresh hidden-cover snapshot does not restore an older cover into the admin board', async () => {
  const h = createHarness(event({ imageUrl: 'memory-cover', parentProjectImageUrl: 'memory-parent-cover' }));
  const hidden = event({ internalTasks: [task()], updatedAt: fixedNow, imageHidden: true });
  h.db.set(hidden.id, clone(hidden));
  h.context.setProjects([clone(hidden)]);
  expectTest(h);
  assert.equal(h.subject.getCurrentSelectedProject().imageUrl, undefined);
  assert.equal(h.subject.getCurrentSelectedProject().parentProjectImageUrl, undefined);
});

test('Switching events before an old detail returns cannot replace the new selection', async () => {
  const h = createHarness(event({ imageUrl: 'memory-cover' }));
  await h.subject.handleSelectProject(clone(h.context.selectedProject));
  const other = event({ id: 'memory-other-event', title: 'Other memory event', updatedAt: fixedNow });
  h.context.setSelectedProject(clone(other));
  h.detailReads[0].resolve(event({ imageUrl: 'memory-cover' }));
  await h.flush();
  assert.equal(h.context.selectedProject.id, other.id);
});

test('APK filtering keeps TEST for its assignee and excludes unrelated volunteers', async () => {
  const h = createHarness();
  await h.save();
  expectTest(h);
  const unrelated = { id: 'memory-unrelated-volunteer', userId: 'memory-unrelated-user' };
  assert.equal(apkContext.collect([...h.db.values()], unrelated, new Map(), []).length, 0);
});

(async () => {
  let passed = 0;
  for (const item of cases) {
    try {
      await item.run();
      passed++;
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}\n  ${error.message}`);
    }
  }
  console.log(`\n${passed}/${cases.length} task-board checks passed; all data stayed in memory.`);
  process.exitCode = passed === cases.length ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
