import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

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

// Opens the device photo picker and returns a persistable image URI/data URI.
export async function pickImageFromDevice(): Promise<string | null> {
  if (Platform.OS !== 'web') {
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
