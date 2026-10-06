/* Location-selection regressions against AST-extracted application handlers.
 * Run: node scripts/test_location_selection_isolated.js
 * Uses memory-only React state, geographic fixtures, and controlled promises.
 * Never accesses an API, database, account, environment, or browser storage.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const relative = 'screens/ProjectLifecycleScreen.tsx';
const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function variable(name) {
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      matches.push(`const ${node.getText(tree)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1, `Expected one actual application declaration for ${name}`);
  return matches[0];
}

function saveCondition(condition) {
  const matches = [];
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(tree).replace(/\s+/g, '') === condition) {
      matches.push(node.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1, `Expected one actual save validation for ${condition}`);
  return matches[0];
}

function compiled(code) {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const handlerNames = [
  'handleProjectDraftChange',
  'updateLocationCoordinatesFromAddress',
  'handleProjectRegionChange',
  'handleProjectCityChange',
  'handleProjectBarangayChange',
];
const handlerCode = compiled([
  ...handlerNames.map(variable),
  `globalThis.handlers = { ${handlerNames.join(', ')} };`,
].join('\n'));
const saveCode = compiled([
  'globalThis.evaluateCoordinates = () => {',
  variable('hasManualCoordinates'),
  saveCondition('projectDraft.isEvent&&projectLocationResolving'),
  variable('resolvedCoordinates'),
  saveCondition('!resolvedCoordinates'),
  'return { hasManualCoordinates, coordinates: resolvedCoordinates };',
  '};',
].join('\n'));

const cities = [
  { code: 'city-bacolod', name: 'Bacolod City', displayName: 'Bacolod City', provinceName: 'Negros Occidental' },
  { code: 'city-bago', name: 'Bago City', displayName: 'Bago City', provinceName: 'Negros Occidental' },
];
const barangays = [
  { code: 'barangay-old', name: 'Alijis' },
  { code: 'barangay-new', name: 'Punta Taytay' },
  { code: 'barangay-latest', name: 'Banago' },
];

function harness() {
  const lookups = [];
  const state = {
    draft: { isEvent: true, address: 'Old saved location', latitude: '10.123', longitude: '122.123' },
    regionCode: 'region-western',
    cityCode: 'city-bacolod',
    barangayCode: 'barangay-old',
    cities: structuredClone(cities),
    barangays: structuredClone(barangays),
    resolving: false,
    error: null,
  };
  const context = {
    console: { warn() {} },
    projectRegionCode: state.regionCode,
    projectCityCode: state.cityCode,
    projectBarangayCode: state.barangayCode,
    projectLocationCities: structuredClone(cities),
    projectLocationBarangays: structuredClone(barangays),
    projectPlaceVenue: 'Community Hall',
    projectMapLocationSelection: {
      city: 'Bacolod City', province: 'Negros Occidental', barangay: 'Alijis',
    },
    projectLocationLookupGenerationRef: { current: 0 },
    PHRegions: [
      { code: 'region-western', name: 'Western Visayas' },
      { code: 'region-other', name: 'Other Region' },
    ],
    composePhilippineAddress(region, city, barangay) {
      return [barangay, city, region].filter(Boolean).join(', ');
    },
    getCitiesByRegion(code) {
      return code === 'region-western' ? structuredClone(cities) : [];
    },
    getBarangaysByCity(code) {
      return code === 'city-bacolod' ? structuredClone(barangays) : [];
    },
    setProjectDraft(update) {
      state.draft = typeof update === 'function' ? update(state.draft) : update;
    },
    setProjectRegionCode(value) { state.regionCode = value; },
    setProjectCityCode(value) { state.cityCode = value; },
    setProjectBarangayCode(value) { state.barangayCode = value; },
    setProjectLocationCities(value) { state.cities = value; },
    setProjectLocationBarangays(value) { state.barangays = value; },
    setProjectLocationResolving(value) { state.resolving = value; },
    setProjectLocationError(value) { state.error = value; },
    resolveLocationCoordinates(address, selection, options) {
      const pending = deferred();
      lookups.push({ address, selection: structuredClone(selection), options: structuredClone(options), ...pending });
      return pending.promise;
    },
    fetch() { throw new Error('Network use is forbidden in this regression'); },
  };
  vm.runInNewContext(handlerCode, context, { filename: 'actual-location-handlers.js', timeout: 1000 });
  return { state, lookups, context, ...context.handlers };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function assertCoordinates(state, latitude, longitude) {
  assert.equal(state.draft.latitude, String(latitude));
  assert.equal(state.draft.longitude, String(longitude));
}

function saveCoordinates(draft, resolving = false, fallback = { latitude: 10.9, longitude: 122.9 }) {
  const failures = [];
  const inferred = [];
  const context = {
    projectDraft: draft,
    parsedLatitude: Number(draft.latitude),
    parsedLongitude: Number(draft.longitude),
    projectLocationResolving: resolving,
    resolvedAddress: 'Punta Taytay, Bacolod City',
    projects: [{ id: 'memory-city-project', location: fallback }],
    existingProject: { id: 'memory-old-event', location: fallback },
    inferCoordinatesFromPlace(...args) { inferred.push(args); return fallback; },
    failProjectSaveValidation(message) { failures.push(message); },
  };
  vm.runInNewContext(saveCode, context, { filename: 'actual-save-coordinate-validation.js', timeout: 1000 });
  return { value: context.evaluateCoordinates(), failures, inferred };
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }

test('barangay change passes the new selection despite stale React closure', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  assert.equal(h.state.barangayCode, 'barangay-new');
  assert.equal(h.context.projectBarangayCode, 'barangay-old', 'Setter must not update the captured render value');
  assert.equal(h.context.projectMapLocationSelection.barangay, 'Alijis');
  assert.equal(h.lookups.length, 1);
  assert.equal(h.lookups[0].selection.barangay, 'Punta Taytay');
  assert.equal(h.lookups[0].selection.city, 'Bacolod City');
  assert.equal(h.lookups[0].selection.province, 'Negros Occidental');
  assert.equal(h.lookups[0].options.allowCityFallback, false);
  assert.match(h.lookups[0].address, /Punta Taytay.*Community Hall/);
  assertCoordinates(h.state, '', '');
  assert.equal(h.state.resolving, true);
  h.lookups[0].resolve({ latitude: 10.59, longitude: 122.89 });
  await settle();
  assertCoordinates(h.state, 10.59, 122.89);
  assert.equal(h.state.resolving, false);
  assert.equal(h.state.error, null);
});

test('admin event barangay change searches Batangan with inherited Bindoy province and its venue', async () => {
  const h = harness();
  h.context.projectRegionCode = 'region-nir';
  h.context.projectCityCode = 'city-bindoy';
  h.context.projectLocationCities = [{
    code: 'city-bindoy', name: 'Bindoy', displayName: 'Bindoy', provinceName: 'Negros Oriental',
  }];
  h.context.projectLocationBarangays = [{ code: 'barangay-batangan', name: 'Batangan' }];
  h.context.PHRegions.push({ code: 'region-nir', name: 'Negros Island Region (NIR)' });
  h.context.projectPlaceVenue = 'barangayhall';
  // The callback explicitly supplies this new selection; the previous
  // rendered map selection in the harness remains Bacolod/Alijis.
  h.handleProjectBarangayChange('barangay-batangan');
  assert.equal(h.state.barangayCode, 'barangay-batangan');
  assert.equal(h.lookups.length, 1);
  assert.deepEqual(h.lookups[0].selection, {
    city: 'Bindoy', province: 'Negros Oriental', barangay: 'Batangan',
  });
  assert.equal(h.lookups[0].address, 'Batangan, Bindoy, Negros Island Region (NIR), barangayhall');
  assert.equal(h.lookups[0].options.allowCityFallback, false);
  assertCoordinates(h.state, '', '');
  h.lookups[0].resolve({ latitude: 9.7315827, longitude: 123.1308031 });
  await settle();
  assertCoordinates(h.state, 9.7315827, 123.1308031);
  assert.equal(h.state.resolving, false);
  assert.equal(h.state.error, null);
});

test('city change passes the new city and discards the old barangay context', async () => {
  const h = harness();
  h.handleProjectCityChange('city-bago');
  assert.equal(h.state.cityCode, 'city-bago');
  assert.equal(h.state.barangayCode, '');
  assert.equal(h.context.projectCityCode, 'city-bacolod');
  assert.equal(h.lookups[0].selection.city, 'Bago City');
  assert.equal(h.lookups[0].selection.barangay, undefined);
  assert.equal(h.lookups[0].options.allowCityFallback, true);
  h.lookups[0].resolve({ latitude: 10.54, longitude: 122.84 });
  await settle();
  assertCoordinates(h.state, 10.54, 122.84);
});

test('a late older lookup cannot move the latest selected barangay pin', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  h.handleProjectBarangayChange('barangay-latest');
  h.lookups[1].resolve({ latitude: 10.71, longitude: 122.95 });
  await settle();
  h.lookups[0].resolve({ latitude: 10.59, longitude: 122.89 });
  await settle();
  assertCoordinates(h.state, 10.71, 122.95);
  assert.match(h.state.draft.address, /Banago/);
  assert.equal(h.state.error, null);
});

test('an older result cannot clear loading while the latest lookup is pending', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  h.handleProjectBarangayChange('barangay-latest');
  h.lookups[0].resolve({ latitude: 10.59, longitude: 122.89 });
  await settle();
  assertCoordinates(h.state, '', '');
  assert.equal(h.state.resolving, true);
  h.lookups[1].resolve({ latitude: 10.71, longitude: 122.95 });
  await settle();
  assertCoordinates(h.state, 10.71, 122.95);
  assert.equal(h.state.resolving, false);
});

test('manual pin placement cancels an earlier automatic lookup', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  h.handleProjectDraftChange('latitude', '10.601');
  h.handleProjectDraftChange('longitude', '122.901');
  assert.equal(h.state.resolving, false);
  h.lookups[0].resolve({ latitude: 10.59, longitude: 122.89 });
  await settle();
  assertCoordinates(h.state, 10.601, 122.901);
  assert.equal(h.state.error, null);
});

test('clearing the region cancels lookup and prevents an old pin returning', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  h.handleProjectRegionChange('');
  assert.equal(h.state.regionCode, '');
  assert.equal(h.state.cityCode, '');
  assert.equal(h.state.barangayCode, '');
  assert.equal(h.state.cities.length, 0);
  assert.equal(h.state.barangays.length, 0);
  assert.equal(h.state.draft.address, '');
  assertCoordinates(h.state, '', '');
  assert.equal(h.state.resolving, false);
  h.lookups[0].resolve({ latitude: 10.59, longitude: 122.89 });
  await settle();
  assertCoordinates(h.state, '', '');
  assert.equal(h.state.draft.address, '');
});

test('clearing the city cancels an earlier barangay lookup', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  h.handleProjectCityChange('');
  h.lookups[0].resolve({ latitude: 10.59, longitude: 122.89 });
  await settle();
  assert.equal(h.state.cityCode, '');
  assert.equal(h.state.barangayCode, '');
  assert.equal(h.state.draft.address, '');
  assertCoordinates(h.state, '', '');
});

test('an unresolved barangay keeps coordinates empty and exposes the selected name', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  h.lookups[0].resolve(null);
  await settle();
  assertCoordinates(h.state, '', '');
  assert.equal(h.state.resolving, false);
  assert.match(h.state.error, /Punta Taytay/);
  assert.equal(h.lookups[0].options.allowCityFallback, false);
  const save = saveCoordinates(h.state.draft);
  assert.equal(save.value, undefined);
  assert.equal(save.inferred.length, 0, 'Event save must not infer a city fallback');
  assert.match(save.failures[0], /verified location/);
});

test('lookup failure leaves no stale coordinates and allows an explicit pin retry', async () => {
  const h = harness();
  h.handleProjectBarangayChange('barangay-new');
  h.lookups[0].reject(new Error('Memory-only geocoder failure'));
  await settle();
  assertCoordinates(h.state, '', '');
  assert.match(h.state.error, /unavailable/);
  assert.equal(h.state.resolving, false);
  h.handleProjectDraftChange('latitude', '10.601');
  h.handleProjectDraftChange('longitude', '122.901');
  assert.equal(h.state.error, null);
  const save = saveCoordinates(h.state.draft);
  assert.equal(save.value.coordinates.latitude, 10.601);
  assert.equal(save.value.coordinates.longitude, 122.901);
  assert.equal(save.inferred.length, 0);
});

test('event save refuses an old event pin or inferred city when draft coordinates are empty', () => {
  const save = saveCoordinates({ isEvent: true, latitude: '', longitude: '' });
  assert.equal(save.value, undefined);
  assert.equal(save.inferred.length, 0);
  assert.equal(save.failures.length, 1);
  assert.match(save.failures[0], /verified location/);
});

test('event save rejects a pending lookup and out-of-range coordinates', () => {
  const pending = saveCoordinates({ isEvent: true, latitude: '', longitude: '' }, true);
  assert.equal(pending.value, undefined);
  assert.match(pending.failures[0], /finish loading/);
  assert.equal(pending.inferred.length, 0);
  const invalid = saveCoordinates({ isEvent: true, latitude: '100', longitude: '122.9' });
  assert.equal(invalid.value, undefined);
  assert.equal(invalid.inferred.length, 0);
  assert.match(invalid.failures[0], /verified location/);
});

test('non-event project coordinate inference remains supported', () => {
  const save = saveCoordinates({ isEvent: false, latitude: '', longitude: '' });
  assert.equal(save.value.coordinates.latitude, 10.9);
  assert.equal(save.value.coordinates.longitude, 122.9);
  assert.equal(save.inferred.length, 1);
  assert.equal(save.failures.length, 0);
});

(async () => {
  for (const entry of cases) {
    await entry.run();
    console.log(`PASS ${entry.name}`);
  }
  console.log(`Passed ${cases.length} isolated location-selection regressions.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
