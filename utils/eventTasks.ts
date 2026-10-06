import type { Project } from '../models/types';

/** Keep the default event task stable across creation, saves, and refreshes. */
export function ensureFieldOfficerTaskForEvent(
  event: Project,
  now: string = new Date().toISOString(),
): Project {
  if (!event.isEvent || (event.internalTasks || []).some(task => task.isFieldOfficer)) {
    return event;
  }

  return {
    ...event,
    internalTasks: [
      ...(event.internalTasks || []),
      {
        id: `${event.id}-field-officer`,
        title: 'Field Officer',
        description: 'Manage attendance tracking and volunteer coordination for this event.',
        category: 'Field Coordination',
        priority: 'High',
        status: 'Unassigned',
        volunteersNeeded: 1,
        assignedVolunteerIds: [],
        isFieldOfficer: true,
        skillsNeeded: ['Leadership', 'Communication'],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}
