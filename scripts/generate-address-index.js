const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'node_modules', '@jobuntux', 'psgc', 'data', '2025-2Q');
const outputPath = path.join(__dirname, '..', 'utils', 'philippineAddressIndex.json');

const regionRecords = require(path.join(dataDir, 'regions.json'));
const provinceRecords = require(path.join(dataDir, 'provinces.json'));
const munCityRecords = require(path.join(dataDir, 'muncities.json'));
const barangayRecords = require(path.join(dataDir, 'barangays.json'));

const cleanLabel = value => (value ?? '').replace(/\s+/g, ' ').trim();
const makeLookupKey = value => cleanLabel(value).toLocaleLowerCase();

const provinceByCode = new Map(
  provinceRecords.map(record => [record.provCode, record])
);

const syntheticCityProvinceCodes = new Set(
  munCityRecords
    .filter(record => record.munCityCode.endsWith('00'))
    .map(record => record.provCode)
);

const regions = [...regionRecords]
  .map(region => ({
    code: region.regCode,
    name: cleanLabel(region.regionName),
  }))
  .sort((left, right) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
  );

const citiesByRegion = {};

for (const region of regions) {
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

  const duplicateNameCounts = new Map();
  for (const entry of regionEntries) {
    const key = makeLookupKey(entry.name);
    duplicateNameCounts.set(key, (duplicateNameCounts.get(key) ?? 0) + 1);
  }

  citiesByRegion[region.code] = regionEntries
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
}

const barangaysByCity = {};

for (const record of barangayRecords) {
  const cityBarangays = barangaysByCity[record.munCityCode] ?? [];
  cityBarangays.push({
    code: record.brgyCode,
    name: cleanLabel(record.brgyName),
    displayName: record.brgyOldName
      ? `${cleanLabel(record.brgyName)} (${cleanLabel(record.brgyOldName)})`
      : cleanLabel(record.brgyName),
    cityCode: record.munCityCode,
  });
  barangaysByCity[record.munCityCode] = cityBarangays;
}

for (const cityCode of Object.keys(barangaysByCity)) {
  barangaysByCity[cityCode].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'en', { sensitivity: 'base' })
  );
}

const output = {
  generatedFrom: '@jobuntux/psgc/data/2025-2Q',
  regions,
  citiesByRegion,
  barangaysByCity,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
console.log(`Generated ${path.relative(process.cwd(), outputPath)}`);
