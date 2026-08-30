import { Project, Volunteer, VolunteerProjectJoinRecord } from '../models/types';

export type ProjectVolunteerMapEntry = {
  id: string;
  label: string;
  volunteerId?: string;
  volunteerUserId?: string;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function getTaskAssignedVolunteerIds(project: Project): string[] {
  return (project.internalTasks || []).flatMap(task => [
    normalizeText(task.assignedVolunteerId),
    ...(Array.isArray(task.assignedVolunteerIds)
      ? task.assignedVolunteerIds.map(normalizeText)
      : []),
  ]);
}

function getTaskAssignedVolunteerNames(project: Project): string[] {
  return (project.internalTasks || []).flatMap(task => [
    normalizeText(task.assignedVolunteerName),
    ...(Array.isArray(task.assignedVolunteerNames)
      ? task.assignedVolunteerNames.map(normalizeText)
      : []),
  ]);
}

export function getProjectVolunteerMapEntries(
  project: Project,
  volunteers: Volunteer[] = [],
  joinRecords: VolunteerProjectJoinRecord[] = [],
  allProjects: Project[] = []
): ProjectVolunteerMapEntry[] {
  const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
  const volunteerByUserId = new Map(
    volunteers
      .filter(volunteer => Boolean(normalizeText(volunteer.userId)))
      .map(volunteer => [volunteer.userId, volunteer])
  );
  const entriesByKey = new Map<string, ProjectVolunteerMapEntry>();

  const addVolunteer = (volunteer: Volunteer, fallbackKey?: string) => {
    const key = volunteer.id || volunteer.userId || fallbackKey;
    if (!key || entriesByKey.has(key)) {
      return;
    }
    entriesByKey.set(key, {
      id: key,
      label: volunteer.name || volunteer.email || 'Volunteer',
      volunteerId: volunteer.id,
      volunteerUserId: volunteer.userId,
    });
  };

  const addFallback = (key: string, label?: string) => {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey || entriesByKey.has(normalizedKey)) {
      return;
    }

    const volunteer = volunteerById.get(normalizedKey) || volunteerByUserId.get(normalizedKey);
    if (volunteer) {
      addVolunteer(volunteer, normalizedKey);
      return;
    }

    entriesByKey.set(normalizedKey, {
      id: normalizedKey,
      label: normalizeText(label) || 'Volunteer',
    });
  };

  const targetProjects: Project[] = [project];
  if (!project.isEvent && allProjects.length > 0) {
    const childEvents = allProjects.filter(
      p => p.isEvent && (normalizeText(p.parentProjectId) === normalizeText(project.id) || normalizeText(p.parentProjectId) === normalizeText(project.title))
    );
    targetProjects.push(...childEvents);
  }

  const targetProjectIds = new Set(targetProjects.map(p => normalizeText(p.id)));

  targetProjects.forEach(targetProj => {
    (targetProj.volunteers || []).forEach(volunteerId => addFallback(volunteerId, volunteerId));
    (targetProj.joinedUserIds || []).forEach(userId => addFallback(userId, userId));

    const assignedIds = getTaskAssignedVolunteerIds(targetProj).filter(Boolean);
    const assignedNames = getTaskAssignedVolunteerNames(targetProj).filter(Boolean);
    assignedIds.forEach((volunteerId, index) => addFallback(volunteerId, assignedNames[index] || volunteerId));
  });

  joinRecords
    .filter(record => targetProjectIds.has(normalizeText(record.projectId)))
    .forEach(record => {
      const volunteer = volunteerById.get(record.volunteerId) || volunteerByUserId.get(record.volunteerUserId);
      if (volunteer) {
        addVolunteer(volunteer, record.id);
        return;
      }

      addFallback(
        record.volunteerId || record.volunteerUserId || record.id,
        record.volunteerName || record.volunteerEmail || 'Volunteer'
      );
    });

  return Array.from(entriesByKey.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

export function getProjectVolunteerMapCount(
  project: Project,
  volunteers: Volunteer[] = [],
  joinRecords: VolunteerProjectJoinRecord[] = [],
  allProjects: Project[] = []
): number {
  return getProjectVolunteerMapEntries(project, volunteers, joinRecords, allProjects).length;
}

export function getProjectVolunteersNeeded(
  project: Project,
  projects: Project[] = []
): number {
  if (project.isEvent) {
    return Math.max(0, Number(project.volunteersNeeded || 0));
  }
  const childEvents = projects.filter(
    candidate =>
      candidate.isEvent &&
      (normalizeText(candidate.parentProjectId) === normalizeText(project.id) ||
       normalizeText(candidate.parentProjectId) === normalizeText(project.title))
  );
  if (childEvents.length === 0) {
    return Math.max(0, Number(project.volunteersNeeded || 0));
  }
  return childEvents.reduce(
    (total, child) => total + Math.max(0, Number(child.volunteersNeeded || 0)),
    Math.max(0, Number(project.volunteersNeeded || 0))
  );
}

export function getActiveProjectJoinCount(
  project: Project,
  joinRecords: VolunteerProjectJoinRecord[] = []
): number {
  const projectId = normalizeText(project.id);
  if (!projectId) {
    return 0;
  }

  const activeVolunteerKeys = new Set<string>();
  joinRecords
    .filter(record => normalizeText(record.projectId) === projectId)
    .filter(record => (record.participationStatus || 'Active') === 'Active')
    .forEach(record => {
      const key =
        normalizeText(record.volunteerUserId) ||
        normalizeText(record.volunteerId) ||
        normalizeText(record.id);
      if (key) {
        activeVolunteerKeys.add(key);
      }
    });

  return activeVolunteerKeys.size;
}

export function getActiveProjectGroupJoinCount(
  project: Project,
  projects: Project[] = [],
  joinRecords: VolunteerProjectJoinRecord[] = []
): number {
  const projectId = normalizeText(project.id);
  if (!projectId) {
    return 0;
  }

  const relatedProjects = project.isEvent
    ? [project]
    : [
        project,
        ...projects.filter(
          candidate =>
            candidate.isEvent &&
            (normalizeText(candidate.parentProjectId) === projectId ||
             normalizeText(candidate.parentProjectId) === normalizeText(project.title))
        ),
      ];

  const relatedProjectIds = new Set<string>(
    relatedProjects.map(candidate => normalizeText(candidate.id))
  );

  // Count unique volunteers (deduplicate across parent + child events)
  const uniqueVolunteerKeys = new Set<string>();

  // 1. From joinRecords
  joinRecords
    .filter(record => relatedProjectIds.has(normalizeText(record.projectId)))
    .filter(record => (record.participationStatus || 'Active') === 'Active')
    .forEach(record => {
      const key =
        normalizeText(record.volunteerUserId) ||
        normalizeText(record.volunteerId) ||
        normalizeText(record.id);
      if (key) {
        uniqueVolunteerKeys.add(key);
      }
    });

  // 2. Fallback: also check direct volunteer / user IDs attached on projects / events
  relatedProjects.forEach(p => {
    (p.volunteers || []).forEach(vId => {
      const k = normalizeText(vId);
      if (k) uniqueVolunteerKeys.add(k);
    });
    (p.joinedUserIds || []).forEach(uId => {
      const k = normalizeText(uId);
      if (k) uniqueVolunteerKeys.add(k);
    });
  });

  return uniqueVolunteerKeys.size;
}
