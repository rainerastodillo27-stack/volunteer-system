import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { compressImage } from './imageCompression';

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}

const IMAGE_FILE_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif)(\?.*)?$/i;
const VIDEO_FILE_PATTERN = /\.(mp4|m4v|mov|webm|ogv|avi|mkv)(\?.*)?$/i;

// Allowed MIME types and extensions for attendance photo uploads.
const ALLOWED_ATTENDANCE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
]);

const ALLOWED_ATTENDANCE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

// Returns a human-friendly error when the picked file is not a supported image type.
function buildUnsupportedFileError(fileNameOrMime: string): Error {
  return new Error(
    `Unsupported file type: "${fileNameOrMime}". ` +
    'Only image files are accepted for attendance photos (JPEG, PNG, GIF, WebP, BMP, HEIC/HEIF).'
  );
}
const DATA_URI_PATTERN = /^data:([^;,]+)(;base64)?,/i;

function normalizeBase64DataUri(value: string, mimeType?: string | null): string {
  if (value.trim().toLowerCase().startsWith('data:')) {
    return value.trim();
  }

  return `data:${mimeType || 'application/octet-stream'};base64,${value.trim()}`;
}

// Keep browser-selected images consistent with native uploads. Compression is
// best-effort so a picker still succeeds if the browser cannot use canvas.
async function compressPickedImageDataUri(dataUri: string): Promise<string> {
  try {
    return (await compressImage(dataUri)) || dataUri;
  } catch {
    return dataUri;
  }
}

// Returns true when the provided string can be rendered as an image preview.
export function isImageMediaUri(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.startsWith('data:')) {
    return normalizedValue.startsWith('data:image/');
  }

  if (/^(file:|content:|ph:|https?:)/i.test(normalizedValue)) {
    const pathWithoutQuery = normalizedValue.split(/[?#]/)[0] || normalizedValue;
    // URI schemes do not identify the media type by themselves. Preserve
    // extensionless image URLs, but do not render PDFs or other files as images.
    const hasFileExtension = /\.[a-z0-9]{1,8}$/i.test(pathWithoutQuery);
    return !hasFileExtension || IMAGE_FILE_PATTERN.test(pathWithoutQuery);
  }

  return IMAGE_FILE_PATTERN.test(normalizedValue);
}

// Returns true when the provided string identifies a browser/device-playable video.
export function isVideoMediaUri(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.startsWith('data:')) {
    return normalizedValue.toLowerCase().startsWith('data:video/');
  }

  const pathWithoutQuery = normalizedValue.split(/[?#]/)[0] || normalizedValue;
  return VIDEO_FILE_PATTERN.test(pathWithoutQuery);
}

// Flattens attachment values into a unique list of URIs.
export function getAttachmentUris(
  attachments?: Array<string | { url?: string | null }> | null
): string[] {
  if (!attachments?.length) {
    return [];
  }

  const uris = attachments
    .map(attachment =>
      typeof attachment === 'string' ? attachment : attachment?.url || ''
    )
    .map(value => value.trim())
    .filter(Boolean);

  return uris.filter((value, index) => uris.indexOf(value) === index);
}

// Builds a short admin-friendly attachment label from a URI or data URI.
export function getAttachmentLabel(value?: string | null): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue) {
    return 'Attachment';
  }

  const dataUriMatch = normalizedValue.match(DATA_URI_PATTERN);
  if (dataUriMatch?.[1]) {
    const mimeType = dataUriMatch[1].toLowerCase();
    const mimeSubtype = mimeType.split('/')[1] || 'file';
    return `${mimeSubtype.toUpperCase()} file`;
  }

  const sanitizedValue = normalizedValue.split('#')[0] || normalizedValue;
  const pathWithoutQuery = sanitizedValue.split('?')[0] || sanitizedValue;
  const segments = pathWithoutQuery.split('/');
  const lastSegment = segments[segments.length - 1] || pathWithoutQuery;

  try {
    return decodeURIComponent(lastSegment) || 'Attachment';
  } catch {
    return lastSegment || 'Attachment';
  }
}

// Opens local, remote, or data URI attachments in the most compatible way available.
export async function openAttachmentUri(uri: string): Promise<void> {
  const normalizedUri = typeof uri === 'string' ? uri.trim() : '';
  if (!normalizedUri) {
    throw new Error('Attachment URI is empty.');
  }

  if (getPlatformOS() === 'web' && typeof window !== 'undefined') {
    let objectUrl: string | null = null;
    let attachmentWindow: Window | null = null;

    try {
      // Open a blank tab during the click gesture first. This avoids popup blockers
      // when a data URI needs to be converted into a browser-friendly Blob URL.
      if (normalizedUri.startsWith('data:')) {
        attachmentWindow = window.open('about:blank', '_blank');

        if (typeof fetch === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          const response = await fetch(normalizedUri);
          if (!response.ok) {
            throw new Error('The document data could not be read.');
          }

          objectUrl = URL.createObjectURL(await response.blob());
        }
      }

      const targetUri = objectUrl || normalizedUri;
      if (attachmentWindow && !attachmentWindow.closed) {
        attachmentWindow.location.href = targetUri;
      } else {
        const newWindow = window.open(targetUri, '_blank', 'noopener,noreferrer');
        if (!newWindow && typeof document !== 'undefined') {
          const link = document.createElement('a');
          link.href = targetUri;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.click();
        }
      }

      if (objectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl as string), 60_000);
      }
    } catch (error) {
      if (attachmentWindow && !attachmentWindow.closed) {
        attachmentWindow.close();
      }

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }

      throw error instanceof Error ? error : new Error('Unable to open attachment.');
    }

    return;
  }

  await Linking.openURL(normalizedUri);
}

function sanitizeDownloadFilename(filename: string, uri: string): string {
  const fallbackName = getAttachmentLabel(uri) || 'attachment';
  const baseName = String(filename || fallbackName)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-') || 'attachment';

  if (baseName.includes('.')) {
    return baseName;
  }

  const mimeMatch = uri.match(/^data:([^;,]+)/i);
  const mimeExtension = mimeMatch?.[1]?.split('/')[1]?.split('+')[0];
  const uriExtension = uri.split('?')[0].split('#')[0].split('.').pop();
  const extension = mimeExtension || (uriExtension && uriExtension.length <= 5 ? uriExtension : 'bin');
  return `${baseName}.${extension}`;
}

function getMimeType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

// Downloads a photo/document from a message or proposal attachment. On web
// this uses the browser download flow; on native it saves to the app cache and
// opens the platform share/save sheet.
export async function downloadAttachmentUri(uri: string, filename?: string): Promise<void> {
  const normalizedUri = typeof uri === 'string' ? uri.trim() : '';
  if (!normalizedUri) {
    throw new Error('Attachment URI is empty.');
  }

  const safeFilename = sanitizeDownloadFilename(filename || '', normalizedUri);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    let downloadUri = normalizedUri;
    let objectUrl: string | null = null;

    try {
      if (typeof fetch === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const response = await fetch(normalizedUri);
        if (response.ok) {
          objectUrl = URL.createObjectURL(await response.blob());
          downloadUri = objectUrl;
        }
      }
    } catch {
      // Cross-origin files may block fetch; the anchor fallback below still
      // works for servers that expose a downloadable URL.
    }

    const link = document.createElement('a');
    link.href = downloadUri;
    link.download = safeFilename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (objectUrl) {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl as string), 60_000);
    }
    return;
  }

  let localUri = normalizedUri;
  const cacheDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!cacheDirectory) {
    throw new Error('The device storage directory is unavailable.');
  }

  if (normalizedUri.startsWith('data:')) {
    const separatorIndex = normalizedUri.indexOf(',');
    const header = separatorIndex >= 0 ? normalizedUri.slice(0, separatorIndex) : '';
    const payload = separatorIndex >= 0 ? normalizedUri.slice(separatorIndex + 1) : '';
    if (!header.includes(';base64')) {
      throw new Error('This attachment format cannot be saved on this device.');
    }
    localUri = `${cacheDirectory}${safeFilename}`;
    await FileSystem.writeAsStringAsync(localUri, payload, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else if (/^https?:\/\//i.test(normalizedUri)) {
    localUri = `${cacheDirectory}${safeFilename}`;
    const result = await FileSystem.downloadAsync(normalizedUri, localUri);
    localUri = result.uri;
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(localUri, {
      mimeType: getMimeType(safeFilename),
      dialogTitle: `Save ${safeFilename}`,
    });
    return;
  }

  await Linking.openURL(localUri);
}

export type PhotoBatchDownloadItem = {
  uri: string;
  filename: string;
};

const ZIP_LOCAL_FILE_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const ZIP_CENTRAL_FILE_SIGNATURE = [0x50, 0x4b, 0x01, 0x02];
const ZIP_END_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];

function createCrc32Table(): number[] {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  bytes.forEach(byte => {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  });
  return (value ^ 0xffffffff) >>> 0;
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

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function sanitizeZipFilename(filename: string, index: number): string {
  const safeName = String(filename || `attendance-photo-${index + 1}.jpg`)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName || `attendance-photo-${index + 1}.jpg`;
}

async function readPhotoBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Unable to download photo (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function buildStoredZip(files: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach(file => {
    const nameBytes = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const localHeader = concatBytes(
      new Uint8Array(ZIP_LOCAL_FILE_SIGNATURE),
      writeUint16(20), // version needed to extract
      writeUint16(0x800), // UTF-8 filenames
      writeUint16(0), // stored (no compression)
      writeUint16(0), // last modification time
      writeUint16(0), // last modification date
      writeUint32(checksum),
      writeUint32(file.bytes.length),
      writeUint32(file.bytes.length),
      writeUint16(nameBytes.length),
      writeUint16(0),
      nameBytes,
      file.bytes,
    );
    localParts.push(localHeader);

    centralParts.push(concatBytes(
      new Uint8Array(ZIP_CENTRAL_FILE_SIGNATURE),
      writeUint16(20), // version made by
      writeUint16(20), // version needed to extract
      writeUint16(0x800), // UTF-8 filenames
      writeUint16(0), // stored (no compression)
      writeUint16(0),
      writeUint16(0),
      writeUint32(checksum),
      writeUint32(file.bytes.length),
      writeUint32(file.bytes.length),
      writeUint16(nameBytes.length),
      writeUint16(0), // extra length
      writeUint16(0), // comment length
      writeUint16(0), // disk number
      writeUint16(0), // internal attributes
      writeUint32(0), // external attributes
      writeUint32(offset),
      nameBytes,
    ));

    offset += localHeader.length;
  });

  const centralDirectory = concatBytes(...centralParts);
  const endRecord = concatBytes(
    new Uint8Array(ZIP_END_SIGNATURE),
    writeUint16(0), // disk number
    writeUint16(0), // central directory disk
    writeUint16(files.length),
    writeUint16(files.length),
    writeUint32(centralDirectory.length),
    writeUint32(offset),
    writeUint16(0), // archive comment length
  );

  return concatBytes(...localParts, centralDirectory, endRecord);
}

/** Downloads attendance photos as one ZIP archive in the browser. */
export async function downloadPhotoBatch(
  items: PhotoBatchDownloadItem[],
  archiveFilename = 'attendance-photos.zip',
): Promise<void> {
  if (!items.length) {
    throw new Error('There are no photos available to download.');
  }

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const files = await Promise.all(
      items.map(async (item, index) => ({
        name: sanitizeZipFilename(item.filename, index),
        bytes: await readPhotoBytes(item.uri),
      }))
    );
    const zipBytes = buildStoredZip(files);
    const zipBuffer = new ArrayBuffer(zipBytes.byteLength);
    new Uint8Array(zipBuffer).set(zipBytes);
    const blob = new Blob([zipBuffer], { type: 'application/zip' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = archiveFilename.toLowerCase().endsWith('.zip')
      ? archiveFilename
      : `${archiveFilename}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  // Native screens do not have a browser archive download. Preserve the
  // existing share/save behavior for the first selected photo instead of
  // silently failing on platforms where this admin gallery is not hosted.
  await downloadAttachmentUri(items[0].uri, items[0].filename);
}

// Returns the best available image/media URI from a primary field plus attachments.
export function getPrimaryReportMediaUri(
  mediaFile?: string | null,
  attachments?: Array<string | { url?: string | null }> | null
): string | null {
  const candidates = [
    (mediaFile || '').trim(),
    ...getAttachmentUris(attachments),
  ].filter(Boolean);

  return candidates.find(isImageMediaUri) || candidates[0] || null;
}

// Opens the device photo picker and returns a persistable image URI/data URI.
export async function pickImageFromDevice(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = async (event: any) => {
          const imageDataUri = String(event.target?.result || '');
          if (!imageDataUri) {
            resolve(null);
            return;
          }

          resolve(await compressPickedImageDataUri(imageDataUri));
        };
        reader.onerror = () => {
          resolve(null);
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.4,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    if (asset.base64) {
      const imageDataUri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      const optimizedImage = await compressImage(imageDataUri);
      return optimizedImage || imageDataUri;
    }

    return asset.uri;
  } catch (error) {
    console.error('Error picking image:', error);
    return null;
  }
}

// Strict variant used for attendance photos: validates that the picked file is
// a supported image type and throws a user-friendly error if it is not.
export async function pickAttendancePhotoFromDevice(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      // Hint the OS file picker toward images, but we still validate the result.
      input.accept = 'image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/heic,image/heif';
      input.onchange = (e: any) => {
        const file: File | undefined = e.target.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        // Validate MIME type (primary check)
        const mimeType = (file.type || '').toLowerCase();
        const hasAllowedMime = ALLOWED_ATTENDANCE_MIME_TYPES.has(mimeType);

        // Validate extension as fallback (some browsers report empty MIME type)
        const hasAllowedExtension = ALLOWED_ATTENDANCE_EXTENSIONS.test(file.name);

        if (!hasAllowedMime && !hasAllowedExtension) {
          reject(buildUnsupportedFileError(file.type || file.name || 'unknown'));
          return;
        }

        const reader = new FileReader();
        reader.onload = async (event: any) => {
          const dataUri = String(event.target?.result || '');

          // Final safety check: the data URI prefix must be an image MIME type.
          if (!dataUri.startsWith('data:image/')) {
            reject(buildUnsupportedFileError(file.name));
            return;
          }

          resolve(await compressPickedImageDataUri(dataUri));
        };
        reader.onerror = () => {
          reject(new Error('Failed to read the selected file. Please try again.'));
        };
        reader.readAsDataURL(file);
      };

      // If the user closes the picker without selecting anything.
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  // Native path
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.25,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const mimeType = (asset.mimeType || '').toLowerCase();

    // On native, ImagePicker.MediaTypeOptions.Images should already filter,
    // but we double-check the reported MIME type.
    if (mimeType && !ALLOWED_ATTENDANCE_MIME_TYPES.has(mimeType)) {
      throw buildUnsupportedFileError(mimeType);
    }

    if (asset.base64) {
      const imageDataUri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      const optimizedImage = await compressImage(imageDataUri, 60);
      return optimizedImage || imageDataUri;
    }

    return asset.uri;
  } catch (error) {
    // Re-throw unsupported-file errors so callers can display the message.
    if (error instanceof Error && error.message.startsWith('Unsupported file type')) {
      throw error;
    }
    console.error('Error picking attendance photo:', error);
    return null;
  }
}

// Opens the device file picker for documents and returns a persistable file URI/data URI.
export async function pickDocumentFromDevice(): Promise<string | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      base64: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    // Normalize both web and native picker results to a data URI. This lets the
    // message attachment endpoint receive the file once and persist it outside
    // the message row, instead of storing the whole Base64 value in chat.
    if (asset.base64) {
      return normalizeBase64DataUri(asset.base64, asset.mimeType);
    }

    if (asset.uri && Platform.OS !== 'web') {
      try {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return normalizeBase64DataUri(base64, asset.mimeType);
      } catch {
        // Fall back to the picker URI for platforms that do not expose a
        // readable cache file. The caller will show a normal upload error.
      }
    }

    return asset.uri || null;
  } catch (error) {
    console.error('Error picking document:', error);
    throw error;
  }
}
