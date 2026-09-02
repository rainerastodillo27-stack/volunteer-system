import type { PartnerProjectApplication, Project, VolunteerProjectJoinRecord } from '../models/types';

const CATEGORY_VALUES: Project['category'][] = [];
const USELESS_TITLES = new Set([
  '',
  'n/a',
  'na',
  'none',
  'untitled',
  'untitled proposal',
  'project proposal',
  'nutrition project proposal',
  'education project proposal',
  'livelihood project proposal',
  'disaster project proposal',
]);

const LEGACY_SAMPLE_PROJECTS: Record<
  string,
  Partial<Project> & {
    title: string;
    description: string;
    category: Project['category'];
    location: Project['location'];
  }
> = {
  'project-sample-nutrition-event-1': {
    title: 'Quarterly Assessment',
    description:
      'Quarterly Assessment event for Mingo nutrition coordination, announcements, and assigning tasks to the event team.',
    partnerId: '',
    programModule: 'Nutrition',
    program_id: 'Nutrition',
    isEvent: true,
    parentProjectId: 'project-sample-nutrition-program',
    status: 'In Progress',
    category: 'Nutrition',
    startDate: '2026-05-14T08:00:00.000Z',
    endDate: '2026-05-14T12:00:00.000Z',
    location: {
      latitude: 10.7373,
      longitude: 122.9673,
      address: 'Baybay, Talisay City, Negros Occidental',
    },
    volunteersNeeded: 8,
  },
  'project-sample-livelihood-event-1': {
    title: 'Livelihood Kickoff Workshop',
    description:
      'Kickoff event for the approved livelihood initiative with partner coordination, volunteer orientation, and starter kit planning.',
    partnerId: 'partner-partner-user-2',
    programModule: 'Livelihood',
    program_id: 'Livelihood',
    isEvent: true,
    parentProjectId: 'project-sample-livelihood-program',
    status: 'Planning',
    category: 'Livelihood',
    startDate: '2026-06-05T08:00:00.000Z',
    endDate: '2026-06-05T12:00:00.000Z',
    location: {
      latitude: 9.9867,
      longitude: 122.8073,
      address: 'Kabankalan City, Negros Occidental',
    },
    volunteersNeeded: 10,
  },
  'project-sample-education-event-1': {
    title: 'Education Workshop - Morning Session',
    description: 'Morning education workshop for volunteer time-in testing - event starts today.',
    partnerId: '',
    programModule: 'Education',
    program_id: 'Education',
    isEvent: true,
    parentProjectId: 'project-sample-education-program',
    status: 'In Progress',
    category: 'Education',
    startDate: '2026-04-25T16:00:00.000Z',
    endDate: '2026-04-26T15:59:59.000Z',
    location: {
      latitude: 10.6765,
      longitude: 122.9509,
      address: 'Bacolod City, Negros Occidental',
    },
    volunteersNeeded: 5,
  },
  'project-sample-education-event-2': {
    title: 'Education Workshop - Afternoon Session',
    description: 'Afternoon education workshop for volunteer time-in testing - event starts today.',
    partnerId: '',
    programModule: 'Education',
    program_id: 'Education',
    isEvent: true,
    parentProjectId: 'project-sample-education-program',
    status: 'In Progress',
    category: 'Education',
    startDate: '2026-04-25T16:00:00.000Z',
    endDate: '2026-04-26T15:59:59.000Z',
    location: {
      latitude: 10.6765,
      longitude: 122.9509,
      address: 'Bacolod City, Negros Occidental',
    },
    volunteersNeeded: 5,
  },
};

function inferCategory(...values: Array<unknown>): Project['category'] {
  const text = values.map(value => String(value || '')).join(' ').toLowerCase();
  const match = CATEGORY_VALUES.find(category => text.includes(category.toLowerCase()));
  return match || '';
}

function formatTitleFromId(projectId: string, fallback: string): string {
  const normalized = projectId
    .replace(/^project-sample-/i, '')
    .replace(/^project-proposal-/i, 'proposal ')
    .replace(/^event-/i, 'event ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .trim();

  return normalized || fallback;
}

function isDeletedEventId(projectId: string): boolean {
  return /^event-\d+$/i.test(projectId);
}

function hasUsefulTitle(value: unknown): value is string {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized && !USELESS_TITLES.has(normalized));
}

function getProposalTitle(application: PartnerProjectApplication): string {
  const proposalDetails = application.proposalDetails;
  const titleCandidates = [
    proposalDetails?.proposedTitle,
    proposalDetails?.targetProjectTitle,
  ];
  const usefulTitle = titleCandidates.find(hasUsefulTitle);
  if (usefulTitle) {
    return usefulTitle.trim();
  }

  const module = String(proposalDetails?.requestedProgramModule || '').trim();
  const partnerName = String(application.partnerName || '').trim();
  if (module && partnerName) {
    return `${module} proposal by ${partnerName}`;
  }
  if (module) {
    return `${module} partner proposal`;
  }
  if (partnerName) {
    return `${partnerName} approved proposal`;
  }
  return 'Approved partner proposal';
}

function makeBaseMapProject(input: {
  id: string;
  title: string;
  description: string;
  category: Project['category'];
  partnerId?: string;
  isEvent?: boolean;
  startDate?: string;
  endDate?: string;
  address?: string;
  volunteersNeeded?: number;
  volunteerId?: string;
  volunteerUserId?: string;
}): Project {
  const createdAt = input.startDate || new Date().toISOString();

  return {
    id: input.id,
    title: input.title,
    description: input.description,
    partnerId: input.partnerId || '',
    programModule: input.category,
    program_id: input.category,
    isEvent: Boolean(input.isEvent),
    status: 'Planning',
    category: input.category,
    startDate: input.startDate || createdAt,
    endDate: input.endDate || input.startDate || createdAt,
    location: {
      latitude: 0,
      longitude: 0,
      address: input.address || 'Location to be finalized',
    },
    volunteersNeeded: input.volunteersNeeded || 0,
    volunteers: input.volunteerId ? [input.volunteerId] : [],
    joinedUserIds: input.volunteerUserId ? [input.volunteerUserId] : [],
    skillsNeeded: [],
    createdAt,
    updatedAt: createdAt,
    statusUpdates: [],
    internalTasks: [],
  };
}

function makeLegacySampleProject(projectId: string, record: VolunteerProjectJoinRecord): Project | null {
  const legacy = LEGACY_SAMPLE_PROJECTS[projectId];
  if (!legacy) {
    return null;
  }

  return addVolunteerToSyntheticProject(
    {
      ...makeBaseMapProject({
        id: projectId,
        title: legacy.title,
        description: legacy.description,
        category: legacy.category,
        partnerId: String(legacy.partnerId || ''),
        isEvent: legacy.isEvent,
        startDate: legacy.startDate,
        endDate: legacy.endDate,
        address: legacy.location.address,
        volunteersNeeded: legacy.volunteersNeeded,
      }),
      ...legacy,
      id: projectId,
      volunteers: [],
      joinedUserIds: [],
      statusUpdates: legacy.statusUpdates || [],
      internalTasks: legacy.internalTasks || [],
      createdAt: legacy.createdAt || legacy.startDate || record.joinedAt,
      updatedAt: legacy.updatedAt || legacy.startDate || record.joinedAt,
    } as Project,
    record
  );
}

function addVolunteerToSyntheticProject(
  project: Project,
  record: VolunteerProjectJoinRecord
): Project {
  return {
    ...project,
    volunteers: Array.from(new Set([...(project.volunteers || []), record.volunteerId].filter(Boolean))),
    joinedUserIds: Array.from(
      new Set([...(project.joinedUserIds || []), record.volunteerUserId].filter(Boolean))
    ),
  };
}

export function withImpactMapFallbackProjects(
  projects: Project[],
  applications: PartnerProjectApplication[] = [],
  joinRecords: VolunteerProjectJoinRecord[] = []
): Project[] {
  const byId = new Map(projects.map(project => [project.id, project]));
  const syntheticIds = new Set<string>();

  applications
    .filter(application => application.status === 'Approved')
    .forEach(application => {
      const proposalDetails = application.proposalDetails;
      const projectId = String(
        application.projectId || proposalDetails?.targetProjectId || `partner-application-${application.id}`
      ).trim();

      if (!projectId || byId.has(projectId)) {
        return;
      }

      const category = inferCategory(
        proposalDetails?.requestedProgramModule,
        projectId,
        proposalDetails?.proposedTitle
      );
      byId.set(
        projectId,
        makeBaseMapProject({
          id: projectId,
          title: getProposalTitle(application),
          description:
            proposalDetails?.proposedDescription ||
            proposalDetails?.targetProjectDescription ||
            `${application.partnerName || 'Partner'} approved proposal`,
          category,
          partnerId: application.partnerUserId || application.partnerEmail,
          startDate: proposalDetails?.proposedStartDate || application.reviewedAt || application.requestedAt,
          endDate: proposalDetails?.proposedEndDate || proposalDetails?.proposedStartDate || application.requestedAt,
          address:
            proposalDetails?.proposedLocation ||
            proposalDetails?.targetProjectAddress ||
            'Location to be finalized',
          volunteersNeeded: proposalDetails?.proposedVolunteersNeeded || 0,
        })
      );
      syntheticIds.add(projectId);
    });

  joinRecords.forEach(record => {
    const projectId = String(record.projectId || '').trim();
    if (!projectId) {
      return;
    }

    const existing = byId.get(projectId);
    if (existing) {
      if (syntheticIds.has(projectId)) {
        byId.set(projectId, addVolunteerToSyntheticProject(existing, record));
      }
      return;
    }

    const category = inferCategory(projectId);
    const legacyProject = makeLegacySampleProject(projectId, record);
    if (!legacyProject && isDeletedEventId(projectId)) {
      return;
    }

    byId.set(
      projectId,
      legacyProject ||
        makeBaseMapProject({
          id: projectId,
          title: formatTitleFromId(projectId, `${category} Event`),
          description: `The original event details are missing. This pin is kept because ${record.volunteerName || 'a volunteer account'} still has a join record for it.`,
          category,
          isEvent: true,
          startDate: record.joinedAt,
          endDate: record.joinedAt,
          volunteerId: record.volunteerId,
          volunteerUserId: record.volunteerUserId,
        })
    );
    syntheticIds.add(projectId);
  });

  return Array.from(byId.values());
}
