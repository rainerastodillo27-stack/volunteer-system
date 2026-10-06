/* Field Officer lifecycle checks against actual application functions.
 * Run: node scripts/test_event_field_officer_isolated.js
 * TypeScript is compiled in memory. No API, database, network, or app storage.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const fixedNow = '2026-10-06T08:00:00.000Z';

function sourceTree(relative) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  return ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true,
    relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function compile(text, fileName) {
  return ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName,
  }).outputText;
}

function loadModule(relative) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, relative), 'utf8'), relative), {
    module,
    exports: module.exports,
    require(name) { throw new Error(`Unexpected dependency in isolated helper: ${name}`); },
  }, { filename: relative, timeout: 1000 });
  return module.exports;
}

function extractFunction(tree, name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      assert.equal(found, undefined, `${name} must have one definition`);
      found = node.getText(tree).replace(/^export\s+(?:default\s+)?/, '');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `Actual ${tree.fileName} function ${name} must exist`);
  return found;
}

function event(overrides = {}) {
  return {
    id: 'memory-event',
    isEvent: true,
    parentProjectId: 'memory-project',
    title: 'Community service',
    startDate: '2026-10-06T08:00:00+08:00',
    endDate: '2026-10-06T10:00:00+08:00',
    repeat: 'Does not repeat',
    volunteersNeeded: 5,
    skillsNeeded: [],
    internalTasks: [],
    ...overrides,
  };
}

function officers(record) {
  return (record.internalTasks || []).filter(task => task.isFieldOfficer);
}

const helper = loadModule('utils/eventTasks.ts').ensureFieldOfficerTaskForEvent;
assert.equal(typeof helper, 'function', 'Shared helper must be exported');
const storageTree = sourceTree('models/storage.ts');
const screenTree = sourceTree('screens/ProjectLifecycleScreen.tsx');

function storageHarness() {
  const persisted = [];
  const cache = [];
  const notifications = [];
  let cacheClears = 0;
  const moduleContext = {
    ensureFieldOfficerTaskForEvent: helper,
    getEventRepeatRule: loadModule('utils/attendanceSchedule.ts').getEventRepeatRule,
    STORAGE_KEYS: { EVENTS: 'events', PROJECTS: 'projects' },
    async saveRemoteStorageRecord(collection, record) {
      persisted.push({ collection, record: structuredClone(record), route: 'storage' });
      return structuredClone(record);
    },
    async requestApiJson(route, options) {
      assert.equal(options.method, 'PUT');
      const record = JSON.parse(options.body);
      persisted.push({ collection: 'events', record, route });
      return { event: structuredClone(record) };
    },
    upsertCachedStorageRecord(collection, record) {
      cache.push({ collection, record: structuredClone(record) });
    },
    projectsSnapshotCache: { clear() { cacheClears += 1; } },
    notifyStorageChanged(collections) { notifications.push(Array.from(collections)); },
    fetch() { throw new Error('Network access is forbidden in isolated tests'); },
  };
  const names = [
    'normalizeProjectInternalTask', 'normalizeProjectSkillsNeeded', 'normalizeProjectRecord',
    'normalizeEventRecord', 'saveEvent', 'savePartnerEvent', 'saveProject',
  ];
  const context = vm.createContext(moduleContext);
  vm.runInContext(compile(names.map(name => extractFunction(storageTree, name)).join('\n')
    + `\nglobalThis.subject = { ${names.join(', ')} };`, storageTree.fileName), context,
  { filename: storageTree.fileName, timeout: 1000 });
  return { subject: moduleContext.subject, persisted, cache, notifications, get cacheClears() { return cacheClears; } };
}

function assertSharedImport(tree) {
  const imported = tree.statements.some(node => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text.endsWith('/eventTasks')
    && node.importClause?.namedBindings
    && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some(item => item.name.text === 'ensureFieldOfficerTaskForEvent'));
  assert.ok(imported, `${tree.fileName} must import the shared Field Officer helper`);
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }

test('Creating an event seeds one unassigned Field Officer task with one volunteer slot', () => {
  const saved = helper(event(), fixedNow);
  const [officer] = officers(saved);
  assert.equal(officers(saved).length, 1);
  assert.equal(officer.id, 'memory-event-field-officer');
  assert.equal(officer.title, 'Field Officer');
  assert.equal(officer.description, 'Manage attendance tracking and volunteer coordination for this event.');
  assert.equal(officer.category, 'Field Coordination');
  assert.equal(officer.priority, 'High');
  assert.equal(officer.status, 'Unassigned');
  assert.equal(officer.volunteersNeeded, 1);
  assert.equal(officer.assignedVolunteerId, undefined);
  assert.equal(officer.assignedVolunteerIds.length, 0);
  assert.deepEqual(Array.from(officer.skillsNeeded), ['Leadership', 'Communication']);
  assert.equal(officer.createdAt, fixedNow);
  assert.equal(officer.updatedAt, fixedNow);
});

test('Every event gets a Field Officer regardless of past, current, or future dates', () => {
  for (const date of ['2000-01-01', '2026-10-06', '2099-12-31']) {
    const saved = helper(event({ startDate: date, endDate: date }), fixedNow);
    assert.equal(officers(saved).length, 1, `${date} event must get a Field Officer`);
  }
});

test('Adding the default officer preserves ordinary tasks and does not mutate the input', () => {
  const ordinary = { id: 'memory-operational-task', title: 'Registration', isFieldOfficer: false };
  const original = event({ internalTasks: [ordinary] });
  const before = structuredClone(original);
  const saved = helper(original, fixedNow);
  assert.notEqual(saved, original);
  assert.deepEqual(original, before);
  assert.equal(saved.internalTasks[0], ordinary);
  assert.equal(saved.internalTasks.length, 2);
});

test('Existing assigned Field Officer data is preserved without adding another task', () => {
  const officer = {
    id: 'memory-admin-officer', title: 'Official Field Officer', isFieldOfficer: true,
    status: 'Assigned', assignedVolunteerId: 'memory-volunteer', assignedVolunteerIds: ['memory-volunteer'],
    createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z',
  };
  const original = event({ internalTasks: [officer] });
  assert.equal(helper(original, fixedNow), original);
  assert.equal(original.internalTasks[0], officer);
  assert.equal(officers(original).length, 1);
});

test('Repeated normalization keeps one stable Field Officer task', () => {
  const first = helper(event(), fixedNow);
  const second = helper(first, '2026-10-07T08:00:00.000Z');
  assert.equal(second, first);
  assert.equal(officers(second).length, 1);
  assert.equal(officers(second)[0].createdAt, fixedNow);
  assert.equal(helper(event(), '2026-10-07T08:00:00.000Z').internalTasks[0].id, first.internalTasks[0].id);
});

test('Projects remain unchanged and do not receive an event Field Officer', () => {
  for (const isEvent of [false, undefined]) {
    const project = event({ isEvent });
    assert.equal(helper(project, fixedNow), project);
    assert.equal(project.internalTasks.length, 0);
  }
});

test('Admin saveEvent persists the Field Officer before any cache refresh', async () => {
  const h = storageHarness();
  await h.subject.saveEvent(event({ startDate: '2000-01-01', endDate: '2000-01-01' }));
  assert.equal(h.persisted.length, 1);
  assert.equal(h.persisted[0].collection, 'events');
  assert.equal(officers(h.persisted[0].record).length, 1);
  assert.equal(officers(h.persisted[0].record)[0].status, 'Unassigned');
  assert.equal(officers(h.persisted[0].record)[0].id, 'memory-event-field-officer');
  assert.equal(officers(h.cache[0].record).length, 1);
  assert.deepEqual(h.notifications, [['events']]);
  assert.equal(h.cacheClears, 1);
});

test('Partner savePartnerEvent sends the default officer in its persisted request', async () => {
  const h = storageHarness();
  await h.subject.savePartnerEvent(event());
  assert.equal(h.persisted.length, 1);
  assert.equal(h.persisted[0].route, '/partner/events/memory-event');
  assert.equal(officers(h.persisted[0].record).length, 1);
  assert.equal(officers(h.persisted[0].record)[0].status, 'Unassigned');
  assert.equal(officers(h.persisted[0].record)[0].volunteersNeeded, 1);
  assert.equal(officers(h.cache[0].record).length, 1);
});

test('Saving an existing admin or partner event does not duplicate its officer', async () => {
  for (const save of ['saveEvent', 'savePartnerEvent']) {
    const h = storageHarness();
    await h.subject[save](helper(event(), fixedNow));
    await h.subject[save](h.cache[0].record);
    assert.equal(h.persisted.length, 2);
    for (const write of h.persisted) {
      assert.equal(officers(write.record).length, 1);
      assert.equal(officers(write.record)[0].id, 'memory-event-field-officer');
      assert.equal(officers(write.record)[0].createdAt, fixedNow);
    }
  }
});

test('Saving a project through storage does not seed a Field Officer', async () => {
  const h = storageHarness();
  await h.subject.saveProject(event({ isEvent: false }));
  assert.equal(h.persisted[0].collection, 'projects');
  assert.equal(officers(h.persisted[0].record).length, 0);
});

test('Storage and event creation screen share the helper without a duplicated date gate', () => {
  assertSharedImport(storageTree);
  assertSharedImport(screenTree);
  const initializerNames = [];
  let projectToSave;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      initializerNames.push(node.name.text);
      if (node.name.text === 'projectToSave') projectToSave = node.initializer;
    }
    if (ts.isFunctionDeclaration(node) && node.name) initializerNames.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(screenTree);
  assert.ok(projectToSave && ts.isCallExpression(projectToSave));
  assert.equal(projectToSave.expression.getText(screenTree), 'ensureFieldOfficerTaskForEvent');
  assert.equal(projectToSave.arguments[0].getText(screenTree), 'savedProject');
  assert.ok(!initializerNames.includes('shouldAutoCreateFieldOfficerTask'), 'Screen must use the shared event rule');
  assert.ok(!storageTree.text.includes('function isCurrentOrFutureEvent('), 'Storage must not exclude past event creation');
  assert.ok(!storageTree.text.includes('function ensureFieldOfficerTaskForEvent('), 'Storage must use the shared helper');
});

(async () => {
  let passed = 0;
  for (const item of cases) {
    try {
      await item.run();
      passed += 1;
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}\n  ${error.message}`);
    }
  }
  console.log(`\n${passed}/${cases.length} Field Officer checks passed; all data stayed in memory.`);
  process.exitCode = passed === cases.length ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
