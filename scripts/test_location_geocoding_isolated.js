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

function photonResult({ properties = {}, geometry, ...overrides } = {}) {
  return {
    type: 'Feature',
    geometry: geometry || { type: 'Point', coordinates: [barangayCoordinates.longitude, barangayCoordinates.latitude] },
    properties: {
      name: 'Banquerohan',
      osm_key: 'place',
      osm_value: 'village',
      city: 'Cadiz',
      state: 'Negros Occidental',
      country: 'Philippines',
      countrycode: 'PH',
      ...properties,
    },
    ...overrides,
  };
}

function fixture({ google = null, photon = [] } = {}) {
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
      requests.push({ provider: 'photon', url });
      return { ok: true, json: async () => ({ type: 'FeatureCollection', features: photon }) };
    },
    setTimeout, clearTimeout, AbortController,
  };
  vm.runInNewContext(compiled, context);
  return { resolve: module.exports.resolveLocationCoordinates, requests, context };
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
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
  await check('Photon considers several GeoJSON candidates and sends the selected locality query', async () => {
    const wrong = photonResult({ properties: { name: 'Cabahug' } });
    const { resolve, requests } = fixture({ photon: [wrong, photonResult()] });
    assert.ok(await resolve(selectedAddress, selection));
    const url = new URL(requests[0].url);
    assert.equal(url.origin, 'https://photon.komoot.io');
    assert.equal(url.pathname, '/api/');
    const params = url.searchParams;
    assert.equal(params.get('q'), 'Banquerohan, Cadiz, Negros Occidental, Philippines');
    assert.equal(params.get('lang'), 'en');
    assert.equal(params.get('limit'), '5');
  });
  await check('A Photon city result cannot stand in for the selected barangay', async () => {
    const result = photonResult({ properties: { name: 'Cadiz', osm_value: 'city' } });
    const { resolve } = fixture({ photon: [result] });
    assert.equal(await resolve(selectedAddress, selection, { allowCityFallback: true }), null);
  });
  await check('A Photon road with the same name cannot stand in for the barangay', async () => {
    const result = photonResult({ properties: { osm_key: 'highway', osm_value: 'residential', street: 'Banquerohan' } });
    const { resolve } = fixture({ photon: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('A Photon POI named after the barangay cannot override its actual barangay', async () => {
    const result = photonResult({ properties: { osm_key: 'amenity', osm_value: 'community_centre',
      type: 'amenity', district: 'Cabahug' } });
    const { resolve } = fixture({ photon: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('A same-name Photon city cannot satisfy both city and barangay', async () => {
    const matching = { barangay: 'San Jose', city: 'San Jose City', province: 'Nueva Ecija' };
    const result = photonResult({ properties: { name: 'San Jose', osm_value: 'city',
      city: 'San Jose City', state: 'Nueva Ecija' } });
    const { resolve } = fixture({ photon: [result] });
    assert.equal(await resolve('San Jose, San Jose City, Nueva Ecija', matching), null);
  });
  await check('Photon accepts a distinct barangay field for a city with the same name', async () => {
    const matching = { barangay: 'San Jose', city: 'San Jose City', province: 'Nueva Ecija' };
    const result = photonResult({ properties: { name: 'San Jose', district: 'San Jose',
      city: 'San Jose City', state: 'Nueva Ecija' } });
    const { resolve } = fixture({ photon: [result] });
    assert.ok(await resolve('San Jose, San Jose City, Nueva Ecija', matching));
  });
  await check('Photon rejects a same-name locality in a different province', async () => {
    const result = photonResult({ properties: { state: 'Albay' } });
    const { resolve } = fixture({ photon: [result] });
    assert.equal(await resolve(selectedAddress, selection), null);
  });
  await check('Photon requires a Philippine country code', async () => {
    for (const countrycode of [undefined, 'US']) {
      const result = photonResult({ properties: { countrycode } });
      const { resolve } = fixture({ photon: [result] });
      assert.equal(await resolve(selectedAddress, selection), null);
    }
  });
  await check('Photon reads GeoJSON longitude before latitude', async () => {
    const { resolve } = fixture({ photon: [photonResult()] });
    const result = await resolve(selectedAddress, selection);
    assert.equal(result.latitude, barangayCoordinates.latitude);
    assert.equal(result.longitude, barangayCoordinates.longitude);
  });
  await check('Photon rejects blank and invalid coordinates', async () => {
    for (const latitude of ['', null, 'NaN', NaN, Infinity, 91]) {
      const result = photonResult({ geometry: { type: 'Point', coordinates: [123, latitude] } });
      const { resolve } = fixture({ photon: [result] });
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
  await check('Photon keeps a typed venue and locality context in its query', async () => {
    const { resolve, requests } = fixture({ photon: [photonResult()] });
    assert.ok(await resolve('Community Hall, Brgy. Banquerohan, Cadiz City, Negros Occidental, Western Visayas, Philippines', selection));
    assert.equal(new URL(requests[0].url).searchParams.get('q'), 'Community Hall, Banquerohan, Cadiz, Negros Occidental, Philippines');
  });
  await check('Geocoder queries strip administrative decoration and retain the selected province', async () => {
    const decorated = { ...selection, province: 'Province of Negros Occidental' };
    const { resolve, requests } = fixture({ photon: [photonResult()] });
    assert.ok(await resolve('Banquerohan, Cadiz City, Negros Island Region (NIR)', decorated));
    assert.equal(new URL(requests[0].url).searchParams.get('q'), 'Banquerohan, Cadiz, Negros Occidental, Philippines');
  });
  await check('Photon query variants retain barangay, city, province, and country after lookup failure', async () => {
    const { resolve, requests } = fixture();
    assert.equal(await resolve(`${selectedAddress}, Community Hall`, selection), null);
    const queries = requests.filter(request => request.provider === 'photon')
      .map(request => new URL(request.url).searchParams.get('q'));
    assert.deepEqual(queries, [
      'Community Hall, Banquerohan, Cadiz, Negros Occidental, Philippines',
      'Banquerohan, Cadiz, Negros Occidental, Philippines',
      'Barangay Banquerohan, Cadiz, Negros Occidental, Philippines',
    ]);
  });
  const missingCitySelection = { barangay: 'Nagcasunog', city: 'Bindoy', province: 'Negros Oriental' };
  const missingCityAddress = 'Nagcasunog, Bindoy, Negros Oriental';
  const missingCityGoogle = () => googleResult({
    formatted_address: 'Nagcasunog, Negros Oriental, Philippines',
    address_components: [
      { long_name: 'Nagcasunog', types: ['sublocality', 'political'] },
      { long_name: 'Negros Oriental', types: ['administrative_area_level_2', 'political'] },
      { long_name: 'Philippines', short_name: 'PH', types: ['country', 'political'] },
    ],
  });
  const missingCityPhoton = () => photonResult({ properties: {
    name: 'Nagcasunog', city: undefined, state: 'Negros Oriental',
  } });
  await check('Google accepts an exact barangay with correct province when city metadata is absent', async () => {
    const { resolve, requests } = fixture({ google: [missingCityGoogle()] });
    const result = await resolve(missingCityAddress, missingCitySelection);
    assert.ok(result);
    assert.equal(result.address, `${missingCityAddress}, Philippines`);
    assert.equal(requests[0].options.address, `${missingCityAddress}, Philippines`);
  });
  await check('Photon accepts an exact barangay with correct province when city metadata is absent', async () => {
    const { resolve, requests } = fixture({ photon: [missingCityPhoton()] });
    const result = await resolve(missingCityAddress, missingCitySelection);
    assert.ok(result);
    assert.equal(result.address, `${missingCityAddress}, Philippines`);
    assert.equal(new URL(requests[0].url).searchParams.get('q'), `${missingCityAddress}, Philippines`);
  });
  await check('Google rejects an exact barangay in a known different city', async () => {
    for (const type of ['locality', 'postal_town', 'administrative_area_level_3']) {
      const result = missingCityGoogle();
      result.formatted_address = 'Nagcasunog, Tanjay, Negros Oriental, Philippines';
      result.address_components.splice(1, 0, { long_name: 'Tanjay', types: [type, 'political'] });
      const { resolve } = fixture({ google: [result] });
      assert.equal(await resolve(missingCityAddress, missingCitySelection), null);
    }
  });
  await check('Google rejects a conflicting municipality even when formatted text names the selected city', async () => {
    for (const type of ['locality', 'postal_town', 'administrative_area_level_3']) {
      const result = missingCityGoogle();
      result.formatted_address = `${missingCityAddress}, Philippines`;
      result.address_components.splice(1, 0, { long_name: 'Tanjay', types: [type, 'political'] });
      const { resolve } = fixture({ google: [result] });
      assert.equal(await resolve(missingCityAddress, missingCitySelection), null);
    }
  });
  await check('Google accepts a matching municipality alias alongside an abbreviated short name', async () => {
    const result = missingCityGoogle();
    result.formatted_address = `${missingCityAddress}, Philippines`;
    result.address_components.splice(1, 0, {
      long_name: 'Municipality of Bindoy', short_name: 'BDY', types: ['locality', 'political'],
    });
    const { resolve } = fixture({ google: [result] });
    assert.ok(await resolve(missingCityAddress, missingCitySelection));
  });
  await check('Google can classify an exact barangay as a locality when municipality metadata is absent', async () => {
    const result = missingCityGoogle();
    result.address_components[0].types = ['locality', 'political'];
    const { resolve } = fixture({ google: [result] });
    assert.ok(await resolve(missingCityAddress, missingCitySelection));
  });
  await check('Photon rejects an exact barangay in a known different city', async () => {
    for (const field of ['city', 'town', 'municipality', 'county']) {
      const result = missingCityPhoton();
      result.properties[field] = 'Tanjay';
      const { resolve } = fixture({ photon: [result] });
      assert.equal(await resolve(missingCityAddress, missingCitySelection), null);
    }
  });
  await check('Google missing-city exception still requires the selected province', async () => {
    const result = missingCityGoogle();
    result.formatted_address = 'Nagcasunog, Negros Occidental, Philippines';
    result.address_components[1].long_name = 'Negros Occidental';
    const { resolve } = fixture({ google: [result] });
    assert.equal(await resolve(missingCityAddress, missingCitySelection), null);
  });
  await check('Photon missing-city exception still requires the selected province', async () => {
    const result = missingCityPhoton();
    result.properties.state = 'Negros Occidental';
    const { resolve } = fixture({ photon: [result] });
    assert.equal(await resolve(missingCityAddress, missingCitySelection), null);
  });
  await check('Missing-city exception is disabled without a selected province', async () => {
    const incompleteSelection = { barangay: 'Nagcasunog', city: 'Bindoy' };
    for (const provider of ['google', 'photon']) {
      const { resolve } = fixture(provider === 'google'
        ? { google: [missingCityGoogle()] }
        : { photon: [missingCityPhoton()] });
      assert.equal(await resolve(missingCityAddress, incompleteSelection), null);
    }
  });
  await check('Admin Batangan venue search resolves the Photon barangay shape without city metadata', async () => {
    const adminSelection = { barangay: 'Batangan', city: 'Bindoy', province: 'Negros Oriental' };
    // Shape from the public Photon Batangan result: village and province are
    // present, while the municipality property is absent.
    const batangan = photonResult({
      geometry: { type: 'Point', coordinates: [123.1308031, 9.7315827] },
      properties: { name: 'Batangan', city: undefined, state: 'Negros Oriental' },
    });
    const { resolve, requests } = fixture({ photon: [batangan] });
    const result = await resolve('Batangan, Bindoy, Negros Island Region (NIR), barangayhall', adminSelection);
    assert.equal(result.latitude, 9.7315827);
    assert.equal(result.longitude, 123.1308031);
    assert.equal(result.address, 'Batangan, Bindoy, Negros Oriental, Philippines');
    assert.equal(new URL(requests[0].url).searchParams.get('q'),
      'barangayhall, Batangan, Bindoy, Negros Oriental, Philippines');
  });
  await check('A barangay search waits for the existing Google Maps startup promise', async () => {
    const { resolve, requests, context } = fixture({ google: [missingCityGoogle()] });
    const loadedGoogle = context.window.google;
    delete context.window.google;
    let finishLoading;
    context.window.__googleMapsAssetsPromise = new Promise(done => { finishLoading = done; });
    const pending = resolve(missingCityAddress, missingCitySelection);
    await Promise.resolve();
    assert.equal(requests.length, 0, 'The lookup must not skip the Google script already loading');
    context.window.google = loadedGoogle;
    finishLoading(loadedGoogle);
    assert.ok(await pending);
    assert.equal(requests[0].provider, 'google');
    assert.equal(requests.filter(request => request.provider === 'photon').length, 0);
  });
  await check('A failed Google Maps startup still resolves through Photon', async () => {
    const { resolve, requests, context } = fixture({ photon: [missingCityPhoton()] });
    context.window.__googleMapsAssetsPromise = Promise.reject(new Error('Synthetic script load failure'));
    assert.ok(await resolve(missingCityAddress, missingCitySelection));
    assert.equal(requests[0].provider, 'photon');
  });
  await check('A Google Maps startup promise cannot block the barangay search indefinitely', async () => {
    const { resolve, requests, context } = fixture({ photon: [missingCityPhoton()] });
    context.window.__googleMapsAssetsPromise = new Promise(() => {});
    const timeoutDelays = [];
    context.setTimeout = (callback, delay) => {
      timeoutDelays.push(delay);
      return setTimeout(callback, 0);
    };
    assert.ok(await resolve(missingCityAddress, missingCitySelection));
    assert.equal(timeoutDelays[0], 8000);
    assert.equal(requests[0].provider, 'photon');
  });
  await check('Empty addresses skip every provider', async () => {
    const { resolve, requests } = fixture();
    assert.equal(await resolve('', selection), null);
    assert.equal(requests.length, 0);
  });
  console.log(`${passed} location geocoding checks passed${failed ? `; ${failed} failed` : ''}.`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
