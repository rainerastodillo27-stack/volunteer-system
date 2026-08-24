import type { Partner, PartnerProjectApplication, Project, User } from '../models/types';

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function addProjectAndChildEvents(projectIds: Set<string>, project: Project, projects: Project[]): void {
  projectIds.add(project.id);

  let changed = true;
  while (changed) {
    changed = false;
    projects.forEach(candidate => {
      if (!candidate.parentProjectId || projectIds.has(candidate.id)) {
        return;
      }

      if (projectIds.has(candidate.parentProjectId)) {
        projectIds.add(candidate.id);
        changed = true;
      }
    });
  }
}

function partnerMatchesApplication(partner: Partner, application: PartnerProjectApplication): boolean {
  const partnerOwnerId = normalizeKey(partner.ownerUserId);
  const applicationUserId = normalizeKey(application.partnerUserId);
  if (partnerOwnerId && partnerOwnerId === applicationUserId) {
    return true;
  }

  const partnerEmail = normalizeKey(partner.contactEmail);
  const applicationEmail = normalizeKey(application.partnerEmail);
  if (partnerEmail && partnerEmail === applicationEmail) {
    return true;
  }

  const partnerName = normalizeKey(partner.name);
  const applicationName = normalizeKey(application.partnerName);
  return Boolean(partnerName && applicationName && partnerName === applicationName);
}

function projectMatchesPartner(project: Project, partner: Partner): boolean {
  const projectPartnerId = normalizeKey(project.partnerId);
  if (!projectPartnerId) {
    return false;
  }

  return (
    projectPartnerId === normalizeKey(partner.id) ||
    projectPartnerId === normalizeKey(partner.ownerUserId) ||
    projectPartnerId === normalizeKey(partner.contactEmail) ||
    projectPartnerId === normalizeKey(partner.name)
  );
}

export function getPartnerForMappedProject(project: Project, partners: Partner[]): Partner | null {
  return partners.find(partner => projectMatchesPartner(project, partner)) || null;
}

export function getProjectIdsForPartner(
  partner: Partner,
  projects: Project[],
  applications: PartnerProjectApplication[]
): string[] {
  const projectById = new Map(projects.map(project => [project.id, project]));
  const projectIds = new Set<string>();

  // 1. Projects where partnerId matches this partner
  projects.forEach(project => {
    if (projectMatchesPartner(project, partner)) {
      addProjectAndChildEvents(projectIds, project, projects);
    }
  });

  // 2. Only approved applications belonging to this partner
  applications
    .filter(application => application.status === 'Approved' && partnerMatchesApplication(partner, application))
    .forEach(application => {
      const directProject = projectById.get(application.projectId);
      if (directProject) {
        addProjectAndChildEvents(projectIds, directProject, projects);
      } else {
        // Find proposal-created project by matching title or ID pattern
        const proposedTitle = normalizeKey(application.proposalDetails?.proposedTitle);
        if (proposedTitle) {
          const matchByTitle = projects.find(
            p => normalizeKey(p.title) === proposedTitle
          );
          if (matchByTitle) {
            addProjectAndChildEvents(projectIds, matchByTitle, projects);
          }
        }
      }
    });

  return Array.from(projectIds);
}

export function getProjectIdsForPartnerUser(
  user: User | null | undefined,
  partners: Partner[],
  projects: Project[],
  applications: PartnerProjectApplication[]
): string[] {
  if (!user) {
    return [];
  }

  const userId = normalizeKey(user.id);
  const userEmail = normalizeKey(user.email);
  const ownedPartners = partners.filter(partner => {
    if (normalizeKey(partner.ownerUserId) === userId) {
      return true;
    }
    return Boolean(userEmail && normalizeKey(partner.contactEmail) === userEmail);
  });

  const projectIds = new Set<string>();
  ownedPartners.forEach(partner => {
    getProjectIdsForPartner(partner, projects, applications).forEach(projectId => projectIds.add(projectId));
  });

  // If no owned partner record found, match directly against approved applications by user ID / email
  applications
    .filter(application => {
      if (application.status !== 'Approved') {
        return false;
      }
      if (normalizeKey(application.partnerUserId) === userId) {
        return true;
      }
      return Boolean(userEmail && normalizeKey(application.partnerEmail) === userEmail);
    })
    .forEach(application => {
      const project = projects.find(candidate => candidate.id === application.projectId);
      if (project) {
        addProjectAndChildEvents(projectIds, project, projects);
      } else {
        const proposedTitle = normalizeKey(application.proposalDetails?.proposedTitle);
        if (proposedTitle) {
          const matchByTitle = projects.find(
            p => normalizeKey(p.title) === proposedTitle
          );
          if (matchByTitle) {
            addProjectAndChildEvents(projectIds, matchByTitle, projects);
          }
        }
      }
    });

  projects.forEach(project => {
    if (normalizeKey(project.partnerId) === userId || (userEmail && normalizeKey(project.partnerId) === userEmail)) {
      addProjectAndChildEvents(projectIds, project, projects);
    }
  });

  return Array.from(projectIds);
}
