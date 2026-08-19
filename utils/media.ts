import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Linking, Platform } from 'react-native';
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
const DATA_URI_PATTERN = /^data:([^;,]+)(;base64)?,/i;

// Returns true when the provided string can be rendered as an image preview.
export function isImageMediaUri(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  return (
    value.startsWith('data:image/') ||
    value.startsWith('file:') ||
    value.startsWith('content:') ||
    value.startsWith('ph:') ||
    IMAGE_FILE_PATTERN.test(value) ||
    value.startsWith('https://') ||
    value.startsWith('http://')
  );
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
  const normalizedValue = (value || '').trim();
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
  const normalizedUri = uri.trim();
  if (!normalizedUri) {
    throw new Error('Attachment URI is empty.');
  }

  if (getPlatformOS() === 'web' && typeof window !== 'undefined') {
    const newWindow = window.open(normalizedUri, '_blank', 'noopener,noreferrer');
    if (!newWindow && typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = normalizedUri;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    }
    return;
  }

  await Linking.openURL(normalizedUri);
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
        reader.onload = (event: any) => {
          resolve(event.target.result);
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

// Opens the device file picker for documents and returns a persistable file URI/data URI.
export async function pickDocumentFromDevice(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '*/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = (event: any) => {
          resolve(event.target.result);
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
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    return result.assets[0].uri;
  } catch (error) {
    console.error('Error picking document:', error);
    return null;
  }
}
