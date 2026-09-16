import type {
  Project,
  Volunteer,
  VolunteerProjectJoinRecord,
  VolunteerProjectMatch,
  VolunteerTimeLog,
} from '../models/types';
import { getProjectDisplayStatus } from './projectStatus';

type VolunteerReference = Pick<Volunteer, 'id' | 'userId' | 'pastProjects'> | null | undefined;

export type VolunteerEventParticipationInput = {
  projects: Project[];
  volunteer: VolunteerReference;
  joinRecords?: VolunteerProjectJoinRecord[];
  matches?: VolunteerProjectMatch[];
  timeLogs?: VolunteerTimeLog[];
  now?: Date;
};

export type VolunteerEventParticipationSummary = {
  joinedEvents: Project[];
  completedEvents: Project[];
  availableEvents: Project[];
};

function normalizedId(value?: string | null): string {
  return String(value || '').trim();
}

function includesVolunteerId(values: Array<string | undefined> | undefined, ids: Set<string>): boolean {
  return (values || []).some(value => ids.has(normalizedId(value)));
}

function isEvent(project: Project): boolean {
  // Older imported records did not always preserve isEvent, but event ids use
  // this prefix throughout the backend and historical storage.
  return Boolean(project.isEvent || normalizedId(project.id).startsWith('event-'));
}

function hasVerifiedAttendance(log: VolunteerTimeLog): boolean {
  // A time-in/photo alone is not a verified attendance record. An admin
  // attendance check, a legacy confirmation, or a signed-out/completion record
  // is sufficient evidence that the volunteer participated.
  return Boolean(
    log.attendanceCheckedAt ||
      log.attendanceConfirmedAt ||
      log.timeOut ||
      log.completionPhoto ||
      log.completionReport
  );
}

/**
 * Returns the event ids that represent real membership for one volunteer.
 * Requests and matches are intentionally excluded: they are not joined
 * events until an Active or Completed join record exists. The participant
 * arrays are retained for older event records created before join records
 * were introduced.
 */
export function getVolunteerJoinedEventIds({
  projects,
  volunteer,
  volunteerUserId,
  joinRecords = [],
}: {
  projects: Project[];
  volunteer?: VolunteerReference;
  volunteerUserId?: string | null;
  joinRecords?: VolunteerProjectJoinRecord[];
}): Set<string> {
  const volunteerIds = new Set(
    [volunteer?.id, volunteer?.userId, volunteerUserId]
      .map(normalizedId)
      .filter(Boolean),
  );

  if (volunteerIds.size === 0) {
    return new Set();
  }

  const eventIds = new Set(projects.filter(isEvent).map(project => project.id));
  const joinedEventIds = new Set<string>(
    joinRecords
      .filter(record => {
        const status = String(record.participationStatus || 'Active').trim();
        return (
          (status === 'Active' || status === 'Completed') &&
          (volunteerIds.has(normalizedId(record.volunteerId)) ||
            volunteerIds.has(normalizedId(record.volunteerUserId)))
        );
      })
      .map(record => normalizedId(record.projectId))
      .filter(projectId => eventIds.has(projectId)),
  );

  // Legacy event records may contain the participant directly rather than a
  // normalized volunteerProjectJoins row.
  projects.filter(isEvent).forEach(project => {
    if (
      includesVolunteerId(project.volunteers, volunteerIds) ||
      includesVolunteerId(project.joinedUserIds, volunteerIds)
    ) {
      joinedEventIds.add(project.id);
    }
  });

  return new Set(Array.from(joinedEventIds).filter(projectId => eventIds.has(projectId)));
}

/**
 * Keeps volunteer event counters consistent across the admin and volunteer
 * views. A match request is not treated as a joined event; actual membership
 * comes from a join record, participant list, task assignment, time log, or
 * saved completed history. A completed event needs explicit admin completion
 * or a finished event with verified attendance.
 */
export function getVolunteerEventParticipationSummary({
  projects,
  volunteer,
  joinRecords = [],
  matches = [],
  timeLogs = [],
  now,
}: VolunteerEventParticipationInput): VolunteerEventParticipationSummary {
  const volunteerIds = new Set(
    [volunteer?.id, volunteer?.userId]
      .map(normalizedId)
      .filter(Boolean)
  );

  if (volunteerIds.size === 0) {
    return {
      joinedEvents: [],
      completedEvents: [],
      availableEvents: [],
    };
  }

  const recordMatchesVolunteer = (record: VolunteerProjectJoinRecord) =>
    volunteerIds.has(normalizedId(record.volunteerId)) ||
    volunteerIds.has(normalizedId(record.volunteerUserId));
  const matchMatchesVolunteer = (match: VolunteerProjectMatch) =>
    volunteerIds.has(normalizedId(match.volunteerId));
  const logMatchesVolunteer = (log: VolunteerTimeLog) =>
    volunteerIds.has(normalizedId(log.volunteerId));

  const joinedRecordProjectIds = new Set(
    joinRecords.filter(recordMatchesVolunteer).map(record => record.projectId)
  );
  const explicitCompletedProjectIds = new Set([
    ...(volunteer?.pastProjects || []),
    ...joinRecords
      .filter(record => recordMatchesVolunteer(record) && record.participationStatus === 'Completed')
      .map(record => record.projectId),
    ...matches
      .filter(match => matchMatchesVolunteer(match) && match.status === 'Completed')
      .map(match => match.projectId),
  ]);
  const loggedProjectIds = new Set(timeLogs.filter(logMatchesVolunteer).map(log => log.projectId));
  const verifiedAttendanceProjectIds = new Set(
    timeLogs
      .filter(log => logMatchesVolunteer(log) && hasVerifiedAttendance(log))
      .map(log => log.projectId)
  );
  const matchBlocksAvailabilityProjectIds = new Set(
    matches
      .filter(
        match =>
          matchMatchesVolunteer(match) &&
          (match.status === 'Requested' || match.status === 'Matched' || match.status === 'Completed')
      )
      .map(match => match.projectId)
  );

  const eventProjects = projects.filter(isEvent);
  const isParticipating = (project: Project) => {
    const hasTaskAssignment = (project.internalTasks || []).some(
      task =>
        volunteerIds.has(normalizedId(task.assignedVolunteerId)) ||
        includesVolunteerId(task.assignedVolunteerIds, volunteerIds)
    );

    return (
      joinedRecordProjectIds.has(project.id) ||
      includesVolunteerId(project.volunteers, volunteerIds) ||
      includesVolunteerId(project.joinedUserIds, volunteerIds) ||
      hasTaskAssignment ||
      loggedProjectIds.has(project.id) ||
      explicitCompletedProjectIds.has(project.id)
    );
  };

  const joinedEvents = eventProjects.filter(isParticipating);
  const completedEvents = joinedEvents.filter(project => {
    if (explicitCompletedProjectIds.has(project.id)) {
      return true;
    }

    return (
      getProjectDisplayStatus(project, now) === 'Completed' &&
      verifiedAttendanceProjectIds.has(project.id)
    );
  });
  const availableEvents = eventProjects.filter(
    project =>
      getProjectDisplayStatus(project, now) === 'In Progress' &&
      !isParticipating(project) &&
      !matchBlocksAvailabilityProjectIds.has(project.id)
  );

  return {
    joinedEvents,
    completedEvents,
    availableEvents,
  };
}
