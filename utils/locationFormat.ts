import { Project } from '../models/types';

/**
 * Formats project/event location for display using the new simplified location structure.
 * 
 * For events: Shows "Barangay, City, Region" if barangay is available
 * For projects: Shows "City, Region"
 * Falls back to old location.address format if new fields not available
 */
export function formatProjectLocation(project: Project): string {
  // For events with barangay
  if (project.isEvent && project.locationBarangay) {
    const parts = [
      project.locationVenue,
      project.locationBarangay,
      project.locationCity,
      project.locationRegion,
    ].filter(Boolean);
    return parts.join(', ');
  }
  
  // For projects or events without barangay
  if (project.locationCity && project.locationRegion) {
    return `${project.locationCity}, ${project.locationRegion}`;
  }
  
  // Fallback to old format
  return project.location?.address || 'Location not set';
}

/**
 * Formats location for short display (used in cards and lists)
 * 
 * For events: Shows "Barangay, City"
 * For projects: Shows "City"
 */
export function formatProjectLocationShort(project: Project): string {
  // For events with barangay
  if (project.isEvent && project.locationBarangay && project.locationCity) {
    const venuePrefix = project.locationVenue ? `${project.locationVenue}, ` : '';
    return `${venuePrefix}${project.locationBarangay}, ${project.locationCity}`;
  }
  
  // For projects or events without barangay
  if (project.locationCity) {
    return project.locationCity;
  }
  
  // Fallback to old format
  return project.location?.address || 'Location not set';
}
