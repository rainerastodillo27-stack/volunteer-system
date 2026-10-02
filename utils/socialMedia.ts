import type { SocialMediaInfo } from '../models/types';

const SOCIAL_MEDIA_PLATFORMS: Array<{ key: keyof SocialMediaInfo; label: string }> = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'linkedin', label: 'LinkedIn' },
];

/** Combines profile and account values, keeping the first non-empty value per platform. */
export function mergeSocialMediaInfo(
  ...sources: Array<SocialMediaInfo | null | undefined>
): SocialMediaInfo {
  const merged: SocialMediaInfo = {};

  for (const source of sources) {
    for (const { key } of SOCIAL_MEDIA_PLATFORMS) {
      const value = source?.[key]?.trim();
      if (value && !merged[key]) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

export function formatSocialMediaInfo(socialMedia?: SocialMediaInfo): string {
  return SOCIAL_MEDIA_PLATFORMS
    .map(({ key, label }) => {
      const value = socialMedia?.[key]?.trim();
      return value ? `${label}: ${value}` : '';
    })
    .filter(Boolean)
    .join(' | ');
}
