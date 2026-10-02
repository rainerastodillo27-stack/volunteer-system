/* Regression checks for the actual location resolver using memory-only
 * geocoder responses. No HTTP, credentials, map services, or storage accessed.
 * Run: node scripts/test_location_geocoding_isolated.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../utils/locationGeocoding.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const selection = { barangay: 'Banquerohan', city: 'City of Cadiz', province: 'Negros Occidental' };
const selectedAddress = 'Banquerohan, City of Cadiz, Negros Island Region (NIR)';
const cityCoordinates = { latitude: 10.9465, longitude: 123.2881 };
const barangayCoordinates = { latitude: 10.97, longitude: 123.30 }; // Synthetic fixture, not actual coordinates.

function googleResult(overrides = {}) {
  return {
    formatted_address: 'Banquerohan, Cadiz City, Negros Occidental, Philippines',
    address_components: [
      { long_name: 'Banquerohan', types: ['sublocality', 'political'] },
      { long_name: 'Cadiz City', types: ['locality', 'political'] },
      { long_name: 'Negros Occidental', types: ['administrative_area_level_2', 'political'] },
      { long_name: 'Philippines', short_name: 'PH', types: ['country', 'political'] },
    ],
    geometry: { location: { lat: () => barangayCoordinates.latitude, lng: () => barangayCoordinates.longitude } },
    ...overrides,
  };
}

function nominatimResult(overrides = {}) {
  return {
    name: 'Banquerohan',
    display_name: 'Banquerohan, Cadiz, Negros Occidental, Philippines',
    class: 'boundary',
    type: 'administrative',
    address: { village: 'Banquerohan', city: 'Cadiz', state: 'Negros Occidental', country_code: 'ph' },
    lat: String(barangayCoordinates.latitude), lon: String(barangayCoordinates.longitude),
    ...overrides,
  };
}

function fixture({ google = null, nominatim = [] } = {}) {
  const requests = [];
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: name => {
      assert.equal(name, './projectMap');
      return { inferCoordinatesFromPlace: () => cityCoordinates };
    },
    window: google === null ? {} : { google: { maps: { Geocoder: class {
      geocode(options, callback) {
        requests.push({ provider: 'google', options });
        callback(google, 'OK');
      }
    } } } },
    fetch: async url => {
      requests.push({ provider: 'nominatim', url });
      return { ok: true, json: async () => nominatim };
    },
    setTimeout, clearTimeout, AbortController,
  };
  vm.runInNewContext(compiled, context);
  return { resolve: module.exports.resolveLocationCoordinates, requests };
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

(async () => {
  await check('Google matches the selected barangay, city alias, province, and country', async () => {
    const { resolve } = fixture({ google: [googleResult()] });
    const result = await resolve(selectedAddress, selection);
    assert.equal(result.latitude, barangayCoordinates.latitude);
  });
  await check('Google considers a valid second candidate after rejecting the first', async () => {
    const { resolve } = fixture({ google: [googleResult({ partial_match: true }), googleResult()] });
    assert.ok(await resolve(selectedAddress, selection));
  });
  await check('A city result cannot stand in for the selected barangay', async () => {
    const result = googleResult({ formatted_address: 'Cadiz City, Negros Occidental, Philippines' });
    result.address_components = result.address_components.slice(1);
    const { resolve, requests } = fixture({ google: [result] });
    assert.equal(await resolve(selectedAddress, selection, { allowCityFallback: true }), null);
    assert.ok(requests.filter(item => item.provider === 'google').every(item => item.options.address.includes('Banquerohan')));
  });
  await check('A previous barangay cannot overwrite the selected barangay', async () => {
    const result = googleResult();
    result.formatted_address = result.formatted_address.replace('Banquerohan', 'Cabahug');
    result.address_components[0].long_name = 'Cabahug';
    const { resolve } = fixture({ google: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Google partial matches remain unresolved', async () => {
    const { resolve } = fixture({ google: [googleResult({ partial_match: true })] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Google route names do not satisfy the barangay component', async () => {
    const result = googleResult();
    result.address_components[0].types = ['route'];
    const { resolve } = fixture({ google: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Google rejects the same names in a different province', async () => {
    const result = googleResult();
    result.formatted_address = result.formatted_address.replace('Negros Occidental', 'Albay');
    result.address_components[2].long_name = 'Albay';
    const { resolve } = fixture({ google: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Google rejects a non-Philippine country', async () => {
    const result = googleResult();
    result.address_components[3] = { long_name: 'United States', short_name: 'US', types: ['country'] };
    const { resolve } = fixture({ google: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Google rejects non-finite and out-of-range coordinates', async () => {
    for (const latitude of [NaN, Infinity, 91]) {
      const result = googleResult({ geometry: { location: { lat: () => latitude, lng: () => 123 } } });
      const { resolve } = fixture({ google: [result] });
      assert.equal(await resolve(selectedAddress, selection), null);
    }
  });
  await check('A same-name Google city cannot satisfy both city and barangay', async () => {
    const matching = { barangay: 'San Jose', city: 'San Jose City', province: 'Nueva Ecija' };
    const result = googleResult({ formatted_address: 'San Jose City, Nueva Ecija, Philippines',
      address_components: [
        { long_name: 'San Jose City', short_name: 'San Jose', types: ['locality', 'political'] },
        { long_name: 'Nueva Ecija', types: ['administrative_area_level_2', 'political'] },
        { long_name: 'Philippines', short_name: 'PH', types: ['country', 'political'] },
      ] });
    const { resolve } = fixture({ google: [result] });
    assert.equal(await resolve('San Jose, San Jose City, Nueva Ecija', matching), null);
  });
  await check('Distinct Google barangay and city components can share the same name', async () => {
    const matching = { barangay: 'San Jose', city: 'San Jose City', province: 'Nueva Ecija' };
    const result = googleResult({ formatted_address: 'San Jose City, Nueva Ecija, Philippines',
      address_components: [
        { long_name: 'San Jose', types: ['sublocality', 'political'] },
        { long_name: 'San Jose City', types: ['locality', 'political'] },
        { long_name: 'Nueva Ecija', types: ['administrative_area_level_2', 'political'] },
        { long_name: 'Philippines', short_name: 'PH', types: ['country', 'political'] },
      ] });
    const { resolve } = fixture({ google: [result] });
    assert.ok(await resolve('San Jose, San Jose City, Nueva Ecija', matching));
  });
  await check('Separate Google formatted barangay and city segments can share the same name', async () => {
    const matching = { barangay: 'San Jose', city: 'San Jose City', province: 'Nueva Ecija' };
    const result = googleResult({ formatted_address: 'San Jose, San Jose City, Nueva Ecija, Philippines',
      address_components: [
        { long_name: 'San Jose City', types: ['locality', 'political'] },
        { long_name: 'Nueva Ecija', types: ['administrative_area_level_2', 'political'] },
        { long_name: 'Philippines', short_name: 'PH', types: ['country', 'political'] },
      ] });
    const { resolve } = fixture({ google: [result] });
    assert.ok(await resolve('San Jose, San Jose City, Nueva Ecija', matching));
  });
  await check('Nominatim searches several country-restricted candidates', async () => {
    const wrong = nominatimResult({ name: 'Cabahug', display_name: 'Cabahug, Cadiz, Negros Occidental, Philippines',
      address: { village: 'Cabahug', city: 'Cadiz', state: 'Negros Occidental', country_code: 'ph' } });
    const { resolve, requests } = fixture({ nominatim: [wrong, nominatimResult()] });
    assert.ok(await resolve(selectedAddress, selection));
    const params = new URL(requests[0].url).searchParams;
    assert.equal(params.get('countrycodes'), 'ph');
    assert.equal(params.get('addressdetails'), '1');
    assert.equal(params.get('limit'), '5');
  });
  await check('A Nominatim road with the same name cannot stand in for the barangay', async () => {
    const result = nominatimResult({ class: 'highway', type: 'residential',
      address: { road: 'Banquerohan', city: 'Cadiz', state: 'Negros Occidental', country_code: 'ph' } });
    const { resolve } = fixture({ nominatim: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('A Nominatim POI named after the barangay cannot override its actual barangay', async () => {
    const result = nominatimResult({ class: 'amenity', type: 'community_centre', addresstype: 'amenity',
      display_name: 'Banquerohan, Cabahug, Cadiz, Negros Occidental, Philippines',
      address: { amenity: 'Banquerohan', village: 'Cabahug', city: 'Cadiz', state: 'Negros Occidental', country_code: 'ph' } });
    const { resolve } = fixture({ nominatim: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('A same-name Nominatim city cannot satisfy both city and barangay', async () => {
    const matching = { barangay: 'San Jose', city: 'San Jose City', province: 'Nueva Ecija' };
    const result = nominatimResult({ name: 'San Jose', class: 'place', type: 'city',
      display_name: 'San Jose City, Nueva Ecija, Philippines',
      address: { city: 'San Jose City', state: 'Nueva Ecija', country_code: 'ph' } });
    const { resolve } = fixture({ nominatim: [result] });
    assert.equal(await resolve('San Jose, San Jose City, Nueva Ecija', matching), null);
  });
  await check('Nominatim requires a distinct barangay field for a city with the same name', async () => {
    const matching = { barangay: 'San Jose', city: 'San Jose City', province: 'Nueva Ecija' };
    const result = nominatimResult({ name: 'San Jose', class: 'place', type: 'village',
      display_name: 'San Jose, San Jose City, Nueva Ecija, Philippines',
      address: { village: 'San Jose', city: 'San Jose City', state: 'Nueva Ecija', country_code: 'ph' } });
    const { resolve } = fixture({ nominatim: [result] });
    assert.ok(await resolve('San Jose, San Jose City, Nueva Ecija', matching));
  });
  await check('Nominatim rejects a same-name locality in a different province', async () => {
    const result = nominatimResult({ display_name: 'Banquerohan, Cadiz, Albay, Philippines',
      address: { village: 'Banquerohan', city: 'Cadiz', state: 'Albay', country_code: 'ph' } });
    const { resolve } = fixture({ nominatim: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Nominatim requires a Philippine country code', async () => {
    const result = nominatimResult({ address: { village: 'Banquerohan', city: 'Cadiz', state: 'Negros Occidental' } });
    const { resolve } = fixture({ nominatim: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Nominatim rejects blank and invalid coordinates', async () => {
    for (const lat of ['', null, 'NaN', '91']) {
      const { resolve } = fixture({ nominatim: [nominatimResult({ lat })] });
      assert.equal(await resolve(selectedAddress, selection), null);
    }
  });
  await check('A barangay has no local city fallback after lookup failure', async () => {
    const { resolve } = fixture();
    assert.equal(await resolve(selectedAddress, selection, { allowCityFallback: true }), null);
  });
  await check('A selected city and province cannot use the ambiguous city fallback', async () => {
    const { resolve } = fixture();
    const citySelection = { city: selection.city, province: selection.province };
    assert.equal(await resolve('Cadiz City, Negros Occidental', citySelection), null);
    assert.equal(await resolve('Cadiz City, Negros Occidental', citySelection, { allowCityFallback: true }), null);
  });
  await check('An unstructured city fallback requires explicit opt-in', async () => {
    const { resolve } = fixture();
    assert.equal(await resolve('Cadiz City, Negros Occidental'), null);
    const result = await resolve('Cadiz City, Negros Occidental', {}, { allowCityFallback: true });
    assert.equal(result.latitude, cityCoordinates.latitude);
  });
  await check('Google searches a typed venue first while keeping barangay, city, and province', async () => {
    const { resolve, requests } = fixture({ google: [googleResult()] });
    assert.ok(await resolve(`${selectedAddress}, Community Hall`, selection));
    assert.equal(requests[0].options.address, 'Community Hall, Banquerohan, Cadiz, Negros Occidental, Philippines');
    const { resolve: unresolved, requests: rejectedRequests } = fixture({ google: [] });
    assert.equal(await unresolved(`${selectedAddress}, Community Hall`, selection), null);
    const googleQueries = rejectedRequests.filter(request => request.provider === 'google').map(request => request.options.address);
    assert.equal(googleQueries[1], 'Banquerohan, Cadiz, Negros Occidental, Philippines');
    assert.ok(googleQueries.every(query => ['Banquerohan', 'Cadiz', 'Negros Occidental'].every(name => query.includes(name))));
  });
  await check('Nominatim keeps a typed venue in its country-restricted query', async () => {
    const { resolve, requests } = fixture({ nominatim: [nominatimResult()] });
    assert.ok(await resolve('Community Hall, Brgy. Banquerohan, Cadiz City, Negros Occidental, Western Visayas, Philippines', selection));
    assert.equal(new URL(requests[0].url).searchParams.get('q'), 'Community Hall, Banquerohan, Cadiz, Negros Occidental, Philippines');
  });
  await check('Geocoder queries strip administrative decoration and retain the selected province', async () => {
    const decorated = { ...selection, province: 'Province of Negros Occidental' };
    const { resolve, requests } = fixture({ nominatim: [nominatimResult()] });
    assert.ok(await resolve('Banquerohan, Cadiz City, Negros Island Region (NIR)', decorated));
    assert.equal(new URL(requests[0].url).searchParams.get('q'), 'Banquerohan, Cadiz, Negros Occidental, Philippines');
  });
  await check('Empty addresses skip every provider', async () => {
    const { resolve, requests } = fixture();
    assert.equal(await resolve('', selection), null);
    assert.equal(requests.length, 0);
  });
  console.log(`${passed} location geocoding checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
