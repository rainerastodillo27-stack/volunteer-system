import { Project } from '../models/types';

type StatusProjectLike = Pick<Project, 'status' | 'startDate' | 'endDate'>;

function normalizeProjectStatusValue(status?: Project['status'] | string | null): Project['status'] {
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  switch (normalizedStatus) {
    case 'planning':
    case 'planned':
      return 'Planning';
    case 'in progress':
    case 'ongoing':
    case 'active':
      return 'In Progress';
    case 'on hold':
      return 'On Hold';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Planning';
  }
}

function getComparableDate(value?: string, endOfDay = false): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
}

export function getProjectDisplayStatus(
  projectOrStatus?: StatusProjectLike | Project['status'] | string | null,
  now: Date = new Date()
): Project['status'] {
  if (!projectOrStatus || typeof projectOrStatus === 'string') {
    return normalizeProjectStatusValue(projectOrStatus);
  }

  const manualStatus = normalizeProjectStatusValue(projectOrStatus.status);
  if (manualStatus === 'Cancelled' || manualStatus === 'On Hold') {
    return manualStatus;
  }

  const startDate = getComparableDate(projectOrStatus.startDate);
  const endDate = getComparableDate(projectOrStatus.endDate || projectOrStatus.startDate, true);

  if (!startDate || !endDate) {
    return manualStatus;
  }

  if (now < startDate) {
    return 'Planning';
  }

  if (now > endDate) {
    return 'Completed';
  }

  return 'In Progress';
}

// Maps project lifecycle states to the colors used across the UI.
export function getProjectStatusColor(
  projectOrStatus?: StatusProjectLike | Project['status'] | string | null
) {
  const normalizedStatus = getProjectDisplayStatus(projectOrStatus);

  switch (normalizedStatus) {
    case 'Planning':
      return '#2563EB';
    case 'In Progress':
      return '#0F766E';
    case 'On Hold':
      return '#D97706';
    case 'Completed':
      return '#16A34A';
    case 'Cancelled':
      return '#DC2626';
    default:
      return '#2563EB';
  }
}
