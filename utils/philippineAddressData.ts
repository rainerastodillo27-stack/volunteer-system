import rawAddressIndex from './philippineAddressIndex.json';

// Precomputed Philippine address helpers backed by PSGC 2025-2Q data.
// Regenerate utils/philippineAddressIndex.json with:
//   node scripts/generate-address-index.js

export interface PHRegion {
  name: string;
  code: string;
}

export interface PHCityMunicipality {
  code: string;
  name: string;
  displayName: string;
  regionCode: string;
  provinceCode: string;
  provinceName: string;
}

export interface PHBarangay {
  code: string;
  name: string;
  displayName: string;
  cityCode: string;
}

type PhilippineAddressIndex = {
  regions: PHRegion[];
  citiesByRegion: Record<string, PHCityMunicipality[]>;
  barangaysByCity: Record<string, PHBarangay[]>;
};

const addressIndex = rawAddressIndex as PhilippineAddressIndex;

const cleanLabel = (value: string | undefined | null) => (value ?? '').replace(/\s+/g, ' ').trim();

export const PHRegions: PHRegion[] = addressIndex.regions;

export const getCitiesByRegion = (regionCode: string): PHCityMunicipality[] => {
  if (!regionCode) {
    return [];
  }

  return addressIndex.citiesByRegion[regionCode] ?? [];
};

export const getAllCities = (): PHCityMunicipality[] =>
  Object.values(addressIndex.citiesByRegion)
    .flat()
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

export const getBarangaysByCity = (cityCode: string): PHBarangay[] => {
  if (!cityCode) {
    return [];
  }

  return addressIndex.barangaysByCity[cityCode] ?? [];
};

export const composePhilippineAddress = (
  regionName: string,
  cityMunicipalityName: string,
  barangayName: string
) => {
  const normalizedRegion = cleanLabel(regionName);
  const normalizedCityMunicipality = cleanLabel(cityMunicipalityName);
  const normalizedBarangay = cleanLabel(barangayName);

  // Barangay is optional - only require region and city
  if (!normalizedRegion || !normalizedCityMunicipality) {
    return '';
  }

  // If barangay is provided, include it; otherwise just use city and region
  if (normalizedBarangay) {
    return [normalizedBarangay, normalizedCityMunicipality, normalizedRegion].join(', ');
  }
  
  return [normalizedCityMunicipality, normalizedRegion].join(', ');
};
