type XlsxValue = string | number | boolean | null | undefined;

type XlsxColumn = {
  key: string;
  label: string;
};

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function buildWorksheetXml(columns: XlsxColumn[], rows: Record<string, XlsxValue>[]): string {
  const allRows = [
    columns.reduce<Record<string, XlsxValue>>((result, column) => {
      result[column.key] = column.label;
      return result;
    }, {}),
    ...rows,
  ];

  const worksheetRows = allRows.map((row, rowIndex) => {
    const cells = columns.map((column, columnIndex) => {
      const value = row[column.key];
      const cellRef = `${columnName(columnIndex)}${rowIndex + 1}`;
      const numeric = typeof value === 'number' && Number.isFinite(value);
      const text = value === null || value === undefined ? '' : String(value);
      return numeric
        ? `<c r="${cellRef}"><v>${value}</v></c>`
        : `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${worksheetRows}</sheetData></worksheet>`;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function writeUint32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function buildZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach(file => {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);
    const localHeader = joinBytes([
      writeUint32(0x04034b50),
      writeUint16(20),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint32(checksum),
      writeUint32(data.length),
      writeUint32(data.length),
      writeUint16(name.length),
      writeUint16(0),
      name,
      data,
    ]);
    localParts.push(localHeader);

    centralParts.push(joinBytes([
      writeUint32(0x02014b50),
      writeUint16(20),
      writeUint16(20),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint32(checksum),
      writeUint32(data.length),
      writeUint32(data.length),
      writeUint16(name.length),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint16(0),
      writeUint32(0),
      writeUint32(offset),
      name,
    ]));
    offset += localHeader.length;
  });

  const localData = joinBytes(localParts);
  const centralData = joinBytes(centralParts);
  return joinBytes([
    localData,
    centralData,
    joinBytes([
      writeUint32(0x06054b50),
      writeUint16(0),
      writeUint16(0),
      writeUint16(files.length),
      writeUint16(files.length),
      writeUint32(centralData.length),
      writeUint32(localData.length),
      writeUint16(0),
    ]),
  ]);
}

/** Downloads a standards-compliant .xlsx workbook in browser environments. */
export function downloadXlsxFile(
  filename: string,
  sheetName: string,
  columns: XlsxColumn[],
  rows: Array<Record<string, XlsxValue>>,
): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return false;
  }

  const safeSheetName = sheetName.replace(/[\\/:*?\[\]]/g, ' ').slice(0, 31) || 'Report';
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const zip = buildZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', content: buildWorksheetXml(columns, rows) },
  ]);
  const blobBytes = new ArrayBuffer(zip.byteLength);
  new Uint8Array(blobBytes).set(zip);
  const blob = new Blob([blobBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
  return true;
}
