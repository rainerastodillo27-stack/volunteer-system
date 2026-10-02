import type { Project } from '../models/types';

function recordUpdatedAt(project: Project): number {
  const updatedAt = Date.parse(project.updatedAt || '');
  return Number.isFinite(updatedAt) ? updatedAt : Date.parse(project.createdAt || '');
}

// A lightweight list omits media. Preserve only those media fields when it
// refreshes a detail view; never let an older detail replace newer task data.
export function mergeProjectRefresh(
  current: Project | null,
  incoming: Project,
  incomingIncludesMedia = false,
): Project {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }

  const currentUpdatedAt = recordUpdatedAt(current);
  const incomingUpdatedAt = recordUpdatedAt(incoming);
  if (
    Number.isFinite(currentUpdatedAt) &&
    (!Number.isFinite(incomingUpdatedAt) || currentUpdatedAt > incomingUpdatedAt)
  ) {
    return current;
  }

  if (incomingIncludesMedia) {
    return incoming;
  }

  return {
    ...incoming,
    imageUrl: incoming.imageHidden ? undefined : incoming.imageUrl || current.imageUrl,
    parentProjectImageUrl: incoming.imageHidden
      ? undefined
      : incoming.parentProjectImageUrl || current.parentProjectImageUrl,
    attachments: incoming.attachments?.length ? incoming.attachments : current.attachments,
  };
}
