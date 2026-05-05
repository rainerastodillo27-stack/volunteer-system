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

const addressIndex = require('./philippineAddressIndex.json') as PhilippineAddressIndex;

const cleanLabel = (value: string | undefined | null) => (value ?? '').replace(/\s+/g, ' ').trim();

export const PHRegions: PHRegion[] = addressIndex.regions;

export const getCitiesByRegion = (regionCode: string): PHCityMunicipality[] => {
  if (!regionCode) {
    return [];
  }

  return addressIndex.citiesByRegion[regionCode] ?? [];
};

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

  if (!normalizedRegion || !normalizedCityMunicipality || !normalizedBarangay) {
    return '';
  }

  return [normalizedBarangay, normalizedCityMunicipality, normalizedRegion].join(', ');
};
