import { Project } from '../models/types';

// Maps project lifecycle states to the colors used across the UI.
export function getProjectStatusColor(status?: Project['status'] | string | null) {
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  switch (normalizedStatus) {
    case 'planning':
    case 'planned':
      return '#2563EB';
    case 'in progress':
    case 'ongoing':
    case 'active':
      return '#0F766E';
    case 'on hold':
      return '#D97706';
    case 'completed':
      return '#16A34A';
    case 'cancelled':
      return '#DC2626';
    default:
      return '#2563EB';
  }
}
