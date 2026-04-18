import { Image, ImageSourcePropType } from 'react-native';

type WebMapMarkerOptions = {
  accentColor: string;
};

export function getMarkerInitials(value?: string, fallback = '?') {
  const normalized = (value || '').trim();
  if (!normalized) {
    return fallback;
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function resolveMarkerImageUri(source?: ImageSourcePropType | string | null) {
  if (!source) {
    return null;
  }

  if (typeof source === 'string') {
    return source.trim() || null;
  }

  const resolved = Image.resolveAssetSource(source);
  return resolved?.uri || null;
}

export function createWebMapMarkerIcon({
  accentColor,
}: WebMapMarkerOptions) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="76" viewBox="0 0 64 76">
      <path d="M32 74c-2.5 0-4.5-1.1-5.8-3.2L14.8 52.1C11 46.8 9 40.6 9 34.1 9 21 19.5 10 32 10s23 11 23 24.1c0 6.5-2 12.7-5.8 18L37.8 70.8C36.5 72.9 34.5 74 32 74z" fill="${escapeXml(accentColor)}"/>
      <circle cx="32" cy="30" r="22" fill="${escapeXml(accentColor)}"/>
      <circle cx="32" cy="30" r="7" fill="#ffffff"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
