import { Alert } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

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
    const sharingAvailable = await Sharing.isAvailableAsync();
    if (!sharingAvailable) {
      Alert.alert('Download Unavailable', fallbackMessage);
      return;
    }

    const file = new File(Paths.cache, safeFilename);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(pdfContent);

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: safeFilename,
      UTI: 'com.adobe.pdf',
    });
  } catch (error) {
    console.error('Unable to save PDF:', error);
    Alert.alert('Download Failed', fallbackMessage);
  }
}
