import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type PdfTableColumn = {
  key: string;
  label: string;
  /** Relative column width. Columns default to one unit each. */
  width?: number;
  /** Maximum wrapped lines per cell. Use a larger value for narratives. */
  maxLines?: number;
};

export type PdfTable = {
  title?: string;
  columns: PdfTableColumn[];
  rows: Array<Record<string, unknown>>;
  emptyMessage?: string;
};

export type PdfTablePdfOptions = {
  subtitle?: string;
  tables: PdfTable[];
  orientation?: 'portrait' | 'landscape';
};

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\\/:*?"<>|]+/g, '-');
}

function escapePdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) {
    return [line];
  }

  const words = line.split(' ');
  const wrapped: string[] = [];
  let current = '';

  words.forEach(word => {
    if (!current) {
      current = word;
      return;
    }

    if (`${current} ${word}`.length <= maxLength) {
      current = `${current} ${word}`;
      return;
    }

    wrapped.push(current);
    current = word;
  });

  if (current) {
    wrapped.push(current);
  }

  return wrapped.flatMap(part =>
    part.length <= maxLength
      ? [part]
      : part.match(new RegExp(`.{1,${maxLength}}`, 'g')) || [part]
  );
}

export function buildTextPdf(title: string, content: string): string {
  const lines = [
    title,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    ...content.split('\n').flatMap(line => wrapLine(line, 92)),
  ];
  const objects: string[] = [];
  const pageObjects: number[] = [];
  const rowsPerPage = 38;

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [] /Count 0 >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (let pageStart = 0; pageStart < lines.length; pageStart += rowsPerPage) {
    const pageLines = lines.slice(pageStart, pageStart + rowsPerPage);
    const stream = [
      'BT',
      '/F1 10 Tf',
      '40 800 Td',
      ...pageLines.flatMap((line, index) => [
        index === 0 ? '' : '0 -18 Td',
        `(${escapePdfText(line)}) Tj`,
      ]),
      'ET',
    ]
      .filter(Boolean)
      .join('\n');
    const contentObjectNumber = objects.length + 2;
    const pageObjectNumber = objects.length + 1;
    pageObjects.push(pageObjectNumber);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjects
    .map(objectNumber => `${objectNumber} 0 R`)
    .join(' ')}] /Count ${pageObjects.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

type PdfColor = readonly [number, number, number];

const PDF_COLORS = {
  ink: [0.12, 0.16, 0.22] as PdfColor,
  muted: [0.36, 0.42, 0.49] as PdfColor,
  grid: [0.78, 0.82, 0.8] as PdfColor,
  stripe: [0.96, 0.98, 0.97] as PdfColor,
  header: [0.08, 0.38, 0.2] as PdfColor,
  white: [1, 1, 1] as PdfColor,
};

function pdfRgb(color: PdfColor, stroke = false): string {
  return `${color.map(value => value.toFixed(3)).join(' ')} ${stroke ? 'RG' : 'rg'}`;
}

function formatPdfNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function getPdfCellValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  if (Array.isArray(value)) {
    return value.map(item => getPdfCellValue(item)).join(', ');
  }
  return String(value).replace(/\s+/g, ' ').trim() || '—';
}

function wrapPdfTableCell(value: unknown, maxCharacters: number, maxLines = 4): string[] {
  const normalized = getPdfCellValue(value);
  const safeMaxCharacters = Math.max(5, maxCharacters);
  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  const pushLongWord = (word: string) => {
    for (let index = 0; index < word.length; index += safeMaxCharacters) {
      lines.push(word.slice(index, index + safeMaxCharacters));
    }
  };

  words.forEach(word => {
    if (!word) {
      return;
    }
    if (word.length > safeMaxCharacters) {
      if (current) {
        lines.push(current);
        current = '';
      }
      pushLongWord(word);
      return;
    }
    if (!current) {
      current = word;
      return;
    }
    if (`${current} ${word}`.length <= safeMaxCharacters) {
      current = `${current} ${word}`;
      return;
    }
    lines.push(current);
    current = word;
  });

  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines.length ? lines : ['—'];
  }

  const clipped = lines.slice(0, maxLines);
  const lastIndex = clipped.length - 1;
  clipped[lastIndex] = `${clipped[lastIndex].slice(0, Math.max(1, safeMaxCharacters - 3))}...`;
  return clipped;
}

/**
 * Creates a lightweight, native PDF table that works on web and mobile without
 * a separate PDF dependency. Tables repeat their header after a page break so
 * batch report exports remain readable when printed or shared.
 */
export function buildTablePdf(title: string, options: PdfTablePdfOptions): string {
  const landscape = options.orientation !== 'portrait';
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;
  const margin = 30;
  const footerHeight = 24;
  const pageBottom = margin + footerHeight;
  const contentWidth = pageWidth - margin * 2;
  const pageStreams: string[] = [];
  const generatedAt = new Date().toLocaleString();
  let commands: string[] = [];
  let cursorY = 0;

  const drawText = (
    value: string,
    x: number,
    y: number,
    fontSize: number,
    color: PdfColor = PDF_COLORS.ink,
    bold = false,
  ) => {
    commands.push(pdfRgb(color));
    commands.push(
      `BT /${bold ? 'F2' : 'F1'} ${formatPdfNumber(fontSize)} Tf 1 0 0 1 ${formatPdfNumber(x)} ${formatPdfNumber(y)} Tm (${escapePdfText(value)}) Tj ET`
    );
  };

  const drawRect = (
    x: number,
    topY: number,
    width: number,
    height: number,
    fill?: PdfColor,
    stroke?: PdfColor,
  ) => {
    if (fill) {
      commands.push(pdfRgb(fill));
    }
    if (stroke) {
      commands.push(pdfRgb(stroke, true));
      commands.push('0.45 w');
    }
    const paintOperator = fill && stroke ? 'B' : fill ? 'f' : 'S';
    commands.push(
      `${formatPdfNumber(x)} ${formatPdfNumber(topY - height)} ${formatPdfNumber(width)} ${formatPdfNumber(height)} re ${paintOperator}`
    );
  };

  const startPage = () => {
    commands = ['q'];
    cursorY = pageHeight - margin;
    const titleLines = wrapPdfTableCell(title, 88, 2);
    titleLines.forEach((line, index) => {
      drawText(line, margin, cursorY - index * 17, 15, PDF_COLORS.ink, true);
    });
    cursorY -= titleLines.length * 17 + 3;
    const subtitle = options.subtitle || `Generated: ${generatedAt}`;
    wrapPdfTableCell(subtitle, 120, 2).forEach((line, index) => {
      drawText(line, margin, cursorY - index * 11, 8, PDF_COLORS.muted);
    });
    cursorY -= 28;
  };

  const finishPage = () => {
    drawText(`Page ${pageStreams.length + 1}`, pageWidth - margin - 42, 16, 7, PDF_COLORS.muted);
    commands.push('Q');
    pageStreams.push(commands.join('\n'));
  };

  const ensureSpace = (height: number) => {
    if (cursorY - height >= pageBottom) {
      return;
    }
    finishPage();
    startPage();
  };

  const drawTableHeading = (table: PdfTable, continuation = false) => {
    const titleHeight = table.title ? 16 : 0;
    ensureSpace(titleHeight + 22 + 18);
    if (table.title) {
      drawText(
        continuation ? `${table.title} (continued)` : table.title,
        margin,
        cursorY,
        10,
        PDF_COLORS.ink,
        true,
      );
      cursorY -= titleHeight;
    }

    const totalWeight = table.columns.reduce(
      (sum, column) => sum + Math.max(0.1, column.width ?? 1),
      0,
    );
    const widths = table.columns.map(
      column => (contentWidth * Math.max(0.1, column.width ?? 1)) / totalWeight,
    );
    const headerHeight = 20;
    let x = margin;
    table.columns.forEach((column, index) => {
      drawRect(x, cursorY, widths[index], headerHeight, PDF_COLORS.header, PDF_COLORS.grid);
      const maxCharacters = Math.max(5, Math.floor((widths[index] - 8) / 4.25));
      const label = wrapPdfTableCell(column.label, maxCharacters, 2)[0];
      drawText(label, x + 4, cursorY - 12, 7.2, PDF_COLORS.white, true);
      x += widths[index];
    });
    cursorY -= headerHeight;
    return widths;
  };

  startPage();

  options.tables.forEach(table => {
    if (!table.columns.length) {
      return;
    }

    let widths = drawTableHeading(table);
    if (!table.rows.length) {
      const emptyHeight = 22;
      ensureSpace(emptyHeight);
      drawRect(margin, cursorY, contentWidth, emptyHeight, PDF_COLORS.stripe, PDF_COLORS.grid);
      drawText(table.emptyMessage || 'No records available.', margin + 5, cursorY - 13, 8, PDF_COLORS.muted);
      cursorY -= emptyHeight + 12;
      return;
    }

    table.rows.forEach((row, rowIndex) => {
      const cells = table.columns.map((column, columnIndex) => {
        const maxCharacters = Math.max(5, Math.floor((widths[columnIndex] - 8) / 4.25));
        return wrapPdfTableCell(row[column.key], maxCharacters, column.maxLines ?? 4);
      });
      const rowHeight = Math.max(20, Math.max(...cells.map(cell => cell.length)) * 9 + 8);

      if (cursorY - rowHeight < pageBottom) {
        finishPage();
        startPage();
        widths = drawTableHeading(table, true);
      }

      let x = margin;
      table.columns.forEach((column, columnIndex) => {
        drawRect(
          x,
          cursorY,
          widths[columnIndex],
          rowHeight,
          rowIndex % 2 === 0 ? PDF_COLORS.white : PDF_COLORS.stripe,
          PDF_COLORS.grid,
        );
        cells[columnIndex].forEach((line, lineIndex) => {
          drawText(line, x + 4, cursorY - 11 - lineIndex * 9, 7.2, PDF_COLORS.ink);
        });
        x += widths[columnIndex];
      });
      cursorY -= rowHeight;
    });

    cursorY -= 12;
  });

  finishPage();

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [] /Count 0 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  const pageObjects: number[] = [];

  pageStreams.forEach(stream => {
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjects.push(pageObjectNumber);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjects
    .map(objectNumber => `${objectNumber} 0 R`)
    .join(' ')}] /Count ${pageObjects.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

export async function downloadPdfFile(
  filename: string,
  pdfContent: string,
  fallbackMessage = 'Unable to save this PDF on the phone.'
) {
  const safeFilename = sanitizeFilename(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const blob = new Blob([pdfContent], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    return;
  }

  try {
    if (Platform.OS === 'web') {
      const blob = new Blob([pdfContent], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } else {
      // Native: Write file to cache directory using expo-file-system and share
      const filePath = `${FileSystem.cacheDirectory}${safeFilename}`;
      await FileSystem.writeAsStringAsync(filePath, pdfContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/pdf',
          dialogTitle: safeFilename,
          UTI: 'com.adobe.pdf',
        });
      }
    }
  } catch (error) {
    console.error('Unable to save PDF:', error);
    Alert.alert('Download Failed', fallbackMessage);
  }
}
