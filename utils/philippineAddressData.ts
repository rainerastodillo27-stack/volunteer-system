// Philippine address helpers backed by PSGC 2025-2Q data.
// Source package: @jobuntux/psgc

type PSGCRegionRecord = {
  regCode: string;
  regionName: string;
};

type PSGCProvinceRecord = {
  regCode: string;
  provCode: string;
  provName: string;
  cityClass?: 'HUC' | 'ICC' | 'CC' | null;
};

type PSGCMunCityRecord = {
  regCode: string;
  provCode: string;
  munCityCode: string;
  munCityName: string;
  munCityOldName?: string;
};

type PSGCBarangayRecord = {
  munCityCode: string;
  brgyCode: string;
  brgyName: string;
  brgyOldName?: string;
};

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

const regionRecords = require('@jobuntux/psgc/data/2025-2Q/regions.json') as PSGCRegionRecord[];
const provinceRecords = require('@jobuntux/psgc/data/2025-2Q/provinces.json') as PSGCProvinceRecord[];
const munCityRecords = require('@jobuntux/psgc/data/2025-2Q/muncities.json') as PSGCMunCityRecord[];
const barangayRecords = require('@jobuntux/psgc/data/2025-2Q/barangays.json') as PSGCBarangayRecord[];

const cleanLabel = (value: string | undefined | null) => (value ?? '').replace(/\s+/g, ' ').trim();
const makeLookupKey = (value: string) => cleanLabel(value).toLocaleLowerCase();

const provinceByCode = new Map(
  provinceRecords.map(record => [record.provCode, record] as const)
);

const syntheticCityProvinceCodes = new Set(
  munCityRecords
    .filter(record => record.munCityCode.endsWith('00'))
    .map(record => record.provCode)
);

export const PHRegions: PHRegion[] = [...regionRecords]
  .map(region => ({
    code: region.regCode,
    name: cleanLabel(region.regionName),
  }))
  .sort((left, right) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
  );

const PHCitiesMunicipalitiesByRegion = new Map<string, PHCityMunicipality[]>();

for (const region of PHRegions) {
  const regionEntries = munCityRecords
    .filter(record => {
      if (record.regCode !== region.code) {
        return false;
      }

      const province = provinceByCode.get(record.provCode);
      const shouldCollapseToSingleCity =
        province?.cityClass && syntheticCityProvinceCodes.has(record.provCode);

      if (!shouldCollapseToSingleCity) {
        return true;
      }

      return record.munCityCode.endsWith('00');
    })
    .map(record => {
      const province = provinceByCode.get(record.provCode);
      return {
        code: record.munCityCode,
        name: cleanLabel(record.munCityName),
        displayName: cleanLabel(record.munCityName),
        regionCode: record.regCode,
        provinceCode: record.provCode,
        provinceName: cleanLabel(province?.provName),
      };
    });

  const duplicateNameCounts = new Map<string, number>();
  for (const entry of regionEntries) {
    const key = makeLookupKey(entry.name);
    duplicateNameCounts.set(key, (duplicateNameCounts.get(key) ?? 0) + 1);
  }

  const normalizedEntries = regionEntries
    .map(entry => {
      const duplicateCount = duplicateNameCounts.get(makeLookupKey(entry.name)) ?? 0;
      return {
        ...entry,
        displayName:
          duplicateCount > 1 && entry.provinceName
            ? `${entry.name} (${entry.provinceName})`
            : entry.name,
      };
    })
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, 'en', { sensitivity: 'base' })
    );

  PHCitiesMunicipalitiesByRegion.set(region.code, normalizedEntries);
}

const PHBarangaysByCity = new Map<string, PHBarangay[]>();

for (const record of barangayRecords) {
  const cityBarangays = PHBarangaysByCity.get(record.munCityCode) ?? [];
  cityBarangays.push({
    code: record.brgyCode,
    name: cleanLabel(record.brgyName),
    displayName: record.brgyOldName
      ? `${cleanLabel(record.brgyName)} (${cleanLabel(record.brgyOldName)})`
      : cleanLabel(record.brgyName),
    cityCode: record.munCityCode,
  });
  PHBarangaysByCity.set(record.munCityCode, cityBarangays);
}

for (const [cityCode, cityBarangays] of PHBarangaysByCity.entries()) {
  cityBarangays.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'en', { sensitivity: 'base' })
  );
  PHBarangaysByCity.set(cityCode, cityBarangays);
}

export const getCitiesByRegion = (regionCode: string): PHCityMunicipality[] => {
  if (!regionCode) {
    return [];
  }

  return PHCitiesMunicipalitiesByRegion.get(regionCode) ?? [];
};

export const getBarangaysByCity = (cityCode: string): PHBarangay[] => {
  if (!cityCode) {
    return [];
  }

  return PHBarangaysByCity.get(cityCode) ?? [];
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
