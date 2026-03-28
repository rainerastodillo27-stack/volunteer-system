import { Project } from '../models/types';

// Maps project lifecycle states to the colors used across the UI.
export function getProjectStatusColor(status: Project['status']) {
  switch (status) {
    case 'Planning':
      return '#2196F3';
    case 'In Progress':
      return '#FFA500';
    case 'On Hold':
      return '#FF9800';
    case 'Completed':
      return '#4CAF50';
    case 'Cancelled':
      return '#f44336';
    default:
      return '#999';
  }
}
