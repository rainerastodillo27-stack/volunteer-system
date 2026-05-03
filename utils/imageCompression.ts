/**
 * Image compression utility for the frontend
 * Compresses images before upload to prevent bloated base64 strings
 */

const MAX_IMAGE_SIZE_KB = 150; // Target ~150KB base64 (~110KB actual)
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 1280;

export async function compressImage(
  imageUri: string,
  maxSizeKB: number = MAX_IMAGE_SIZE_KB
): Promise<string | null> {
  try {
    // For web platform, use canvas compression
    if (imageUri.startsWith('data:')) {
      return await compressBase64Image(imageUri, maxSizeKB);
    }
    
    // For native platforms, this would use native image libraries
    console.warn('compressImage: Non-base64 URIs not supported on web');
    return imageUri;
  } catch (error) {
    console.error('Image compression failed:', error);
    return null;
  }
}

async function compressBase64Image(
  dataUrl: string,
  maxSizeKB: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Scale down if too large
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width = Math.floor(width * scale);
        height = Math.floor(height * scale);
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Compress iteratively
      let quality = 0.9;
      let result = dataUrl;

      const tryCompress = () => {
        try {
          const compressed = canvas.toDataURL('image/jpeg', quality);
          const sizeKB = (compressed.length * 3) / 4 / 1024; // Estimate base64 size

          if (sizeKB <= maxSizeKB || quality <= 0.3) {
            resolve(compressed);
          } else {
            quality -= 0.1;
            tryCompress();
          }
        } catch (e) {
          resolve(result);
        }
      };

      tryCompress();
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export function getImageSizeKB(dataUrl: string): number {
  try {
    // Base64 size estimation: remove "data:image/...;base64," prefix and calculate
    const base64Part = dataUrl.split(',')[1];
    if (!base64Part) return 0;
    // Base64 encoded size is roughly (string length * 3) / 4
    return (base64Part.length * 3) / 4 / 1024;
  } catch {
    return 0;
  }
}
