import { inferCoordinatesFromPlace } from './projectMap';

export type LocationSelection = {
  barangay?: string;
  city?: string;
  province?: string;
};

export type GeocodedLocation = {
  latitude: number;
  longitude: number;
  address: string;
};

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodingResult = {
  partial_match?: boolean;
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: {
    location?: { lat: (() => number) | number; lng: (() => number) | number };
  };
};

type NominatimResult = {
  lat?: string | number;
  lon?: string | number;
  name?: string;
  display_name?: string;
  class?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string | undefined>;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
};

const REQUEST_TIMEOUT_MS = 8000;
const POLITICAL_COMPONENT_TYPES = /^(?:political|country|locality|postal_town|neighborhood|sublocality(?:_level_\d+)?|administrative_area_level_\d+)$/;
const NOMINATIM_PLACE_FIELDS = new Set([
  'barangay', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood',
  'neighborhood', 'city_district', 'district', 'city', 'town', 'municipality',
  'county', 'state_district', 'state', 'province', 'region', 'country',
]);

// Match complete administrative names. A road containing a barangay's name
// is not evidence that the returned point is in the selected barangay.
function normalizePlaceName(value: string | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^(?:barangay|brgy\.?|bgy\.?)\s+/i, '')
    .replace(/^(?:city|municipality|province)\s+of\s+/i, '')
    .replace(/\s+(?:city|municipality|province)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesSelection(names: string[], selection: LocationSelection): boolean {
  const normalizedNames = new Set(names.map(normalizePlaceName).filter(Boolean));
  return [selection.barangay, selection.city, selection.province]
    .filter((value): value is string => Boolean(value?.trim()))
    .every(value => normalizedNames.has(normalizePlaceName(value)));
}

function hasValidCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
    !(latitude === 0 && longitude === 0);
}

function readGoogleResult(
  result: GoogleGeocodingResult,
  selection: LocationSelection,
  address: string,
): GeocodedLocation | null {
  if (result.partial_match) return null;
  const components = result.address_components || [];
  const country = components.find(component => component.types?.includes('country'));
  if (country?.short_name?.toUpperCase() !== 'PH' &&
      normalizePlaceName(country?.long_name) !== 'philippines') return null;

  const politicalNames = components
    .filter(component => component.types?.some(type => POLITICAL_COMPONENT_TYPES.test(type)))
    .flatMap(component => [component.long_name || '', component.short_name || '']);
  const nonPoliticalNames = new Set(components
    .filter(component => !component.types?.some(type => POLITICAL_COMPONENT_TYPES.test(type)))
    .flatMap(component => [component.long_name, component.short_name])
    .map(normalizePlaceName)
    .filter(Boolean));
  const segments = (result.formatted_address || '').split(',')
    .map(segment => segment.trim())
    .filter(segment => !nonPoliticalNames.has(normalizePlaceName(segment)));
  if (!matchesSelection([...politicalNames, ...segments], selection)) return null;
  const barangayName = normalizePlaceName(selection.barangay);
  if (barangayName && barangayName === normalizePlaceName(selection.city)) {
    // One locality component's long and short names must not count twice when
    // the barangay and city share a name, such as San Jose.
    const distinctMatchingComponents = new Set(components
      .filter(component => component.types?.some(type => POLITICAL_COMPONENT_TYPES.test(type)) &&
        [component.long_name, component.short_name].some(name => normalizePlaceName(name) === barangayName))
      .map(component => JSON.stringify([
        [...(component.types || [])].sort(),
        normalizePlaceName(component.long_name), normalizePlaceName(component.short_name),
      ])));
    const matchingSegments = segments.filter(segment => normalizePlaceName(segment) === barangayName);
    if (distinctMatchingComponents.size < 2 && matchingSegments.length < 2) return null;
  }

  const location = result.geometry?.location;
  if (!location) return null;
  const latitude = typeof location.lat === 'function' ? location.lat() : location.lat;
  const longitude = typeof location.lng === 'function' ? location.lng() : location.lng;
  if (!hasValidCoordinates(latitude, longitude)) return null;
  return { latitude, longitude, address: result.formatted_address || address };
}

function readNominatimResult(
  result: NominatimResult,
  selection: LocationSelection,
  address: string,
): GeocodedLocation | null {
  const details = result.address || {};
  if (details.country_code?.toLowerCase() !== 'ph') return null;
  const politicalNames = Object.entries(details)
    .filter(([key]) => NOMINATIM_PLACE_FIELDS.has(key))
    .map(([, value]) => value || '');
  const nonPoliticalNames = new Set(Object.entries(details)
    .filter(([key]) => !NOMINATIM_PLACE_FIELDS.has(key))
    .map(([, value]) => normalizePlaceName(value))
    .filter(Boolean));
  const isRoad = result.class === 'highway' || result.category === 'highway' ||
    /^(?:road|street|route|residential|unclassified|footway|path)$/.test(result.addresstype || result.type || '');
  const category = result.category || result.class;
  const nameIsPolitical = !isRoad && (category === 'place' ||
    (category === 'boundary' && result.type === 'administrative') ||
    (Boolean(result.addresstype) && NOMINATIM_PLACE_FIELDS.has(result.addresstype || '')));
  // A school, hall, business, or other POI named after a barangay is not
  // evidence that the point belongs to that barangay.
  if (!nameIsPolitical && result.name) nonPoliticalNames.add(normalizePlaceName(result.name));
  const segments = (result.display_name || '').split(',')
    .map(segment => segment.trim())
    .filter(segment => !nonPoliticalNames.has(normalizePlaceName(segment)));
  const names = [...politicalNames, ...segments, ...(nameIsPolitical && result.name ? [result.name] : [])];
  if (!matchesSelection(names, selection)) return null;
  const barangayName = normalizePlaceName(selection.barangay);
  if (barangayName && barangayName === normalizePlaceName(selection.city) &&
      !['barangay', 'village', 'suburb', 'quarter', 'neighbourhood', 'neighborhood',
        'hamlet', 'city_district', 'district']
        .some(field => normalizePlaceName(details[field]) === barangayName)) return null;

  const latitude = typeof result.lat === 'number' ? result.lat :
    typeof result.lat === 'string' && result.lat.trim() ? Number(result.lat) : Number.NaN;
  const longitude = typeof result.lon === 'number' ? result.lon :
    typeof result.lon === 'string' && result.lon.trim() ? Number(result.lon) : Number.NaN;
  if (!hasValidCoordinates(latitude, longitude)) return null;
  return { latitude, longitude, address: result.display_name || address };
}

function readPhotonResult(
  feature: PhotonFeature,
  selection: LocationSelection,
  address: string,
): GeocodedLocation | null {
  const properties = feature.properties || {};
  const [longitude, latitude] = feature.geometry?.coordinates || [];
  const placeName = typeof properties.name === 'string' ? properties.name : '';
  const displayAddress = [
    placeName,
    properties.district,
    properties.city,
    properties.state,
    properties.country,
  ].filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .filter((part, index, parts) => parts.findIndex(value => normalizePlaceName(value) === normalizePlaceName(part)) === index)
    .join(', ');
  const result: NominatimResult = {
    lat: latitude,
    lon: longitude,
    name: placeName,
    display_name: displayAddress,
    class: typeof properties.osm_key === 'string' ? properties.osm_key : undefined,
    category: typeof properties.osm_key === 'string' ? properties.osm_key : undefined,
    type: typeof properties.osm_value === 'string' ? properties.osm_value : undefined,
    addresstype: typeof properties.type === 'string' ? properties.type : undefined,
    address: {
      ...Object.fromEntries(Object.entries(properties).map(([key, value]) => [
        key === 'countrycode' ? 'country_code' : key,
        typeof value === 'string' ? value : undefined,
      ])),
      country_code: typeof properties.countrycode === 'string'
        ? properties.countrycode.toLowerCase()
        : undefined,
    },
  };
  return readNominatimResult(result, selection, address);
}

function cleanAddress(value: string): string {
  return value.replace(/\s*\([^)]{1,12}\)/g, '').replace(/,\s*Philippines\s*$/i, '').trim();
}

function administrativeQueryName(value: string | undefined): string {
  return (value || '').trim()
    .replace(/^(?:city|municipality|province)\s+of\s+/i, '')
    .replace(/\s+(?:city|municipality|province)$/i, '')
    .trim();
}

function isRegionLabel(value: string): boolean {
  const normalized = normalizePlaceName(value);
  return /\bregion\b/.test(normalized) || new Set([
    'ncr', 'nir', 'car', 'barmm', 'mimaropa', 'calabarzon', 'caraga',
    'national capital', 'cordillera administrative', 'negros island',
    'western visayas', 'central visayas', 'eastern visayas', 'bicol',
    'cagayan valley', 'ilocos', 'central luzon', 'zamboanga peninsula',
    'northern mindanao', 'davao', 'soccsksargen',
  ]).has(normalized);
}

/**
 * Resolve a Philippine location without substituting a city center for an
 * unresolved barangay. Consumers discard outdated requests before applying
 * this result to their draft or marker.
 */
export async function resolveLocationCoordinates(
  address: string,
  selection: LocationSelection = {},
  options: { allowCityFallback?: boolean } = {},
): Promise<GeocodedLocation | null> {
  const cleanedAddress = cleanAddress(address);
  if (!cleanedAddress) return null;
  // PSGC labels include administrative decoration such as "City of Cadiz".
  // Geocoders search more reliably for the place name while validation below
  // still uses the original selected metadata.
  const selectedAddress = [selection.barangay,
    administrativeQueryName(selection.city), administrativeQueryName(selection.province)]
    .map(value => value?.trim()).filter(Boolean).join(', ');
  const specificQuery = selectedAddress ? `${selectedAddress}, Philippines` : `${cleanedAddress}, Philippines`;
  const selectedNames = new Set([
    selection.barangay, selection.city, selection.province, 'Philippines', 'PH',
  ].map(normalizePlaceName).filter(Boolean));
  const extraAddressParts = cleanedAddress.split(',').map(part => part.trim())
    .filter(part => part && !selectedNames.has(normalizePlaceName(part)) && !isRegionLabel(part));
  // Preserve a venue typed into Search while retaining every selected locality
  // as context. A broad raw query must not bypass the selected barangay.
  const contextualAddress = [...extraAddressParts, selectedAddress].filter(Boolean).join(', ');
  const contextualQuery = contextualAddress ? `${contextualAddress}, Philippines` : specificQuery;
  const queries = Array.from(new Set([
    contextualQuery,
    specificQuery,
    ...(selection.barangay && selection.city ? [
      `Barangay ${selectedAddress}, Philippines`,
    ] : []),
  ]));

  const googleMaps = typeof window !== 'undefined' ? (window as any).google?.maps : undefined;
  if (googleMaps?.Geocoder) {
    const geocoder = new googleMaps.Geocoder();
    for (const query of queries) {
      try {
        const results = await new Promise<GoogleGeocodingResult[]>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Geocoding timed out')), REQUEST_TIMEOUT_MS);
          geocoder.geocode({ address: query, componentRestrictions: { country: 'PH' }, region: 'ph' },
            (results: GoogleGeocodingResult[] | null, status: string) => {
              clearTimeout(timeout);
              if (status === 'OK') resolve(results || []);
              else reject(new Error(status));
            });
        });
        for (const result of results) {
          const location = readGoogleResult(result, selection, cleanedAddress);
          if (location) return location;
        }
      } catch (error) {
        // A disabled/quota-limited Google service cannot resolve later queries.
        if (error instanceof Error && /REQUEST_DENIED|OVER_QUERY_LIMIT/.test(error.message)) break;
      }
    }
  }

  // Photon provides OSM-backed forward search without requiring a browser
  // caller to set the User-Agent header that Nominatim requires. Try the
  // selected-locality query variants and still validate each result against
  // the selected barangay, city, and province before placing the marker.
  for (const query of queries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=en&limit=5`,
        { signal: controller.signal },
      );
      if (!response.ok) continue;
      const payload: unknown = await response.json();
      const features = payload && typeof payload === 'object' &&
        Array.isArray((payload as { features?: unknown }).features)
        ? (payload as { features: unknown[] }).features
        : [];
      for (const feature of features) {
        if (!feature || typeof feature !== 'object') continue;
        const location = readPhotonResult(feature as PhotonFeature, selection, cleanedAddress);
        if (location) return location;
      }
    } catch {
      // An unavailable service will not be helped by retrying query variants.
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  // The legacy city table has no province metadata. It is only an explicitly
  // requested aid for unstructured searches, never a verified selection.
  const hasSelection = [selection.barangay, selection.city, selection.province]
    .some(value => Boolean(value?.trim()));
  if (!hasSelection && options.allowCityFallback) {
    const coordinates = inferCoordinatesFromPlace(cleanedAddress, [], false);
    if (coordinates && hasValidCoordinates(coordinates.latitude, coordinates.longitude)) {
      return { ...coordinates, address: cleanedAddress };
    }
  }
  return null;
}
