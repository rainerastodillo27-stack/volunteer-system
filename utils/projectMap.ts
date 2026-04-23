import { ImageSourcePropType } from 'react-native';
import { Project } from '../models/types';
import { getProjectStatusColor } from './projectStatus';
import { isImageMediaUri } from './media';

const PROGRAM_IMAGE_BY_CATEGORY: Partial<Record<Project['category'], ImageSourcePropType>> = {
  Nutrition: require('../assets/programs/nutrition.jpg'),
  Education: require('../assets/programs/education.jpg'),
  Livelihood: require('../assets/programs/livelihood.jpg'),
  Disaster: require('../assets/programs/mingo-relief.jpg'),
};

const PROGRAM_PHOTO_BY_TITLE: Record<string, ImageSourcePropType> = {
  'Farm to Fork Program': require('../assets/programs/farm-to-fork.jpg'),
  'Mingo for Nutritional Support': require('../assets/programs/nutrition.jpg'),
  'Mingo for Emergency Relief': require('../assets/programs/mingo-relief.jpg'),
  LoveBags: require('../assets/programs/lovebags.jpg'),
  'School Support': require('../assets/programs/school-support.jpg'),
  'Artisans of Hope': require('../assets/programs/artisans-of-hope.jpg'),
  'Project Joseph': require('../assets/programs/project-joseph.jpg'),
  'Growing Hope': require('../assets/programs/growing-hope.jpg'),
  'Peter Project': require('../assets/programs/peter-project.jpg'),
};

const PROGRAM_PHOTO_MATCHERS: Array<{
  matches: (project: Project, normalizedTitle: string) => boolean;
  source: ImageSourcePropType;
}> = [
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('farm to fork'),
    source: require('../assets/programs/farm-to-fork.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('emergency') || normalizedTitle.includes('relief'),
    source: require('../assets/programs/mingo-relief.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('lovebag') || normalizedTitle.includes('school bag'),
    source: require('../assets/programs/lovebags.jpg'),
  },
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('school'),
    source: require('../assets/programs/school-support.jpg'),
  },
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('artisans'),
    source: require('../assets/programs/artisans-of-hope.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('joseph') || normalizedTitle.includes('sewing'),
    source: require('../assets/programs/project-joseph.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('growing hope') || normalizedTitle.includes('garden'),
    source: require('../assets/programs/growing-hope.jpg'),
  },
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('peter'),
    source: require('../assets/programs/peter-project.jpg'),
  },
  {
    matches: (project, normalizedTitle) =>
      normalizedTitle.includes('mingo') || normalizedTitle.includes('masiglang') || project.category === 'Nutrition',
    source: require('../assets/programs/nutrition.jpg'),
  },
];

function getProgramPhotoSource(project: Project): ImageSourcePropType | undefined {
  if (PROGRAM_PHOTO_BY_TITLE[project.title]) {
    return PROGRAM_PHOTO_BY_TITLE[project.title];
  }

  const normalizedTitle = project.title.trim().toLowerCase();
  return PROGRAM_PHOTO_MATCHERS.find((entry) => entry.matches(project, normalizedTitle))?.source;
}

function getProjectImageSources(project: Project): ImageSourcePropType[] {
  if (project.imageHidden) {
    return [];
  }

  const imageSources: ImageSourcePropType[] = [];
  if (isImageMediaUri(project.imageUrl)) {
    imageSources.push({ uri: project.imageUrl });
  }
  const programPhotoSource = getProgramPhotoSource(project);

  if (programPhotoSource) {
    imageSources.push(programPhotoSource);
  }

  if (project.programModule && project.programModule in PROGRAM_IMAGE_BY_CATEGORY) {
    imageSources.push(
      PROGRAM_IMAGE_BY_CATEGORY[project.programModule as Project['category']] as ImageSourcePropType
    );
  }

  const categoryImageSource = PROGRAM_IMAGE_BY_CATEGORY[project.category];
  if (categoryImageSource && !imageSources.includes(categoryImageSource)) {
    imageSources.push(categoryImageSource);
  }

  return imageSources;
}

export function getPrimaryProjectImageSource(project: Project): ImageSourcePropType | undefined {
  return getProjectImageSources(project)[0];
}

// Shared map constants and helpers for project and event map screens.
export const EVENT_MARKER_COLOR = '#9C27B0';

export const PHILIPPINES_REGION = {
  latitude: 12.8797,
  longitude: 121.774,
  latitudeDelta: 8.5,
  longitudeDelta: 8.5,
};

export const PHILIPPINES_WEB_CENTER = {
  lat: PHILIPPINES_REGION.latitude,
  lng: PHILIPPINES_REGION.longitude,
};

export const PHILIPPINES_BOUNDS = {
  south: 4.5,
  west: 116.5,
  north: 21.5,
  east: 127.5,
};

// Returns the marker color for a project, with events using a separate accent.
export function getProjectMarkerColor(project: Pick<Project, 'isEvent' | 'status'>) {
  return project.isEvent ? EVENT_MARKER_COLOR : getProjectStatusColor(project.status);
}

// Returns only projects that have usable coordinates for native and web maps.
export function getMappedProjects<T extends Pick<Project, 'location'>>(projects: T[]): T[] {
  return projects.filter(
    project =>
      Number.isFinite(project.location?.latitude) &&
      Number.isFinite(project.location?.longitude)
  );
}

// Computes an initial map region that keeps all known projects in view.
export function getInitialProjectRegion(projects: Project[]) {
  const mappedProjects = getMappedProjects(projects);

  if (mappedProjects.length === 0) {
    return PHILIPPINES_REGION;
  }

  const latitudes = mappedProjects.map(project => project.location.latitude);
  const longitudes = mappedProjects.map(project => project.location.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.8, 0.35),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.8, 0.35),
  };
}
