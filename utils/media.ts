import * as ImagePicker from 'expo-image-picker';

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
  if (getPlatformOS() !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Photo library access is required to upload an image.');
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.5,
    base64: true,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];
  if (asset.base64) {
    return `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
  }

  return asset.uri;
}

// Opens the device file picker for documents and returns a persistable file URI/data URI.
export async function pickDocumentFromDevice(): Promise<string | null> {
  try {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error('File library access is required. Please enable photo library permissions in settings.');
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      base64: true,
      allowsMultiple: false,
    });

    if (result.canceled || !result.assets?.length) {
      return null;
    }

    const asset = result.assets[0];
    if (asset.base64) {
      return `data:${asset.mimeType || 'application/octet-stream'};base64,${asset.base64}`;
    }

    return asset.uri;
  } catch (error: any) {
    // Re-throw with better error message
    throw error;
  }
}
