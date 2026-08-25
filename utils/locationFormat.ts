import { Project } from '../models/types';

function cleanLocationPart(value?: string): string {
  const normalized = String(value || '').trim();
  const normalizedKey = normalized.toLowerCase();

  if (
    !normalized ||
    normalizedKey === 'n/a' ||
    normalizedKey === 'program location' ||
    normalizedKey === 'program location to be finalized'
  ) {
    return '';
  }

  return normalized;
}

function uniqueLocationParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  parts.forEach(part => {
    const cleaned = cleanLocationPart(part);
    const key = cleaned.toLowerCase();

    if (!cleaned || seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(cleaned);
  });

  return result;
}

function getCleanFallbackAddress(project: Project): string {
  const addressParts = uniqueLocationParts((project.location?.address || '').split(','));
  return addressParts.join(', ');
}

function getDistinctVenue(project: Project): string {
  const venue = cleanLocationPart(project.locationVenue);
  if (!venue) {
    return '';
  }

  const venueKey = venue.toLowerCase();
  const structuredParts = [
    project.locationBarangay,
    project.locationCity,
    project.locationRegion,
  ]
    .map(cleanLocationPart)
    .filter(Boolean);

  const duplicatesStructuredLocation = structuredParts.some(part =>
    venueKey.includes(part.toLowerCase())
  );

  return duplicatesStructuredLocation ? '' : venue;
}

/**
 * Formats project/event location for display using the new simplified location structure.
 * 
 * For events: Shows "Barangay, City, Region" if barangay is available
 * For projects: Shows "City, Region"
 * Falls back to old location.address format if new fields not available
 */
export function formatProjectLocation(project: Project): string {
  // For events with barangay
  if (project.isEvent && (project.locationVenue || project.locationBarangay)) {
    const parts = uniqueLocationParts([
      getDistinctVenue(project),
      project.locationBarangay,
      project.locationCity,
      project.locationRegion,
    ]);

    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  if (project.locationCity || project.locationRegion) {
    const parts = uniqueLocationParts([
      project.locationCity,
      project.locationRegion,
    ]);

    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  const fallbackAddress = getCleanFallbackAddress(project);
  if (fallbackAddress) {
    return fallbackAddress;
  }

  return 'Location not set';
}

/**
 * Formats location for short display (used in cards and lists)
 * 
 * For events: Shows "Barangay, City"
 * For projects: Shows "City"
 */
export function formatProjectLocationShort(project: Project): string {
  if (project.isEvent && (project.locationVenue || project.locationBarangay || project.locationCity)) {
    const parts = uniqueLocationParts([
      getDistinctVenue(project),
      project.locationBarangay,
      project.locationCity,
    ]);

    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  if (project.locationCity) {
    return project.locationCity;
  }

  const fallbackAddress = getCleanFallbackAddress(project);
  if (fallbackAddress) {
    return fallbackAddress;
  }

  return 'Location not set';
}

export function formatProjectLocationArea(project: Project): string {
  if (project.isEvent && project.locationBarangay) {
    const parts = uniqueLocationParts([
      project.locationBarangay,
      project.locationCity,
      project.locationRegion,
    ]);
    return parts.join(', ');
  }
  
  // For projects or events without barangay
  if (project.locationCity && project.locationRegion) {
    return `${project.locationCity}, ${project.locationRegion}`;
  }
  
  // Fallback to old format
  return getCleanFallbackAddress(project) || 'Location not set';
}
