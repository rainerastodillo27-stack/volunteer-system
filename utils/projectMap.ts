import { ImageSourcePropType } from 'react-native';
import { Project } from '../models/types';
import { getProjectStatusColor } from './projectStatus';
import { isImageMediaUri } from './media';

const PROGRAM_IMAGE_BY_CATEGORY: Partial<Record<Project['category'], ImageSourcePropType>> = {
  Nutrition: require('../assets/programs/nutrition.jpg'),
  Education: require('../assets/programs/education.jpg'),
  Livelihood: require('../assets/programs/livelihood.jpg'),
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

type ProjectCoordinates = Pick<Project['location'], 'latitude' | 'longitude'>;

const KNOWN_PLACE_COORDINATES: Array<{
  keywords: string[];
  latitude: number;
  longitude: number;
}> = [
  {
    keywords: ['baybay talisay city', 'baybay talisay', 'talisay city'],
    latitude: 10.5447,
    longitude: 123.1885,
  },
  {
    keywords: ['kabankalan city', 'kabankalan'],
    latitude: 10.6711,
    longitude: 122.9534,
  },
  {
    keywords: ['bacolod city', 'bacolod'],
    latitude: 10.6765,
    longitude: 122.9509,
  },
  {
    keywords: ['bago city', 'bago'],
    latitude: 10.5333,
    longitude: 122.8333,
  },
  {
    keywords: ['silay city', 'silay'],
    latitude: 10.8002,
    longitude: 122.9726,
  },
  {
    keywords: ['victorias city', 'victorias'],
    latitude: 10.9013,
    longitude: 123.0707,
  },
  {
    keywords: ['cadiz city', 'cadiz'],
    latitude: 10.9465,
    longitude: 123.2881,
  },
  {
    keywords: ['san carlos city', 'san carlos'],
    latitude: 10.4812,
    longitude: 123.4184,
  },
  {
    keywords: ['himamaylan city', 'himamaylan'],
    latitude: 10.1048,
    longitude: 122.8703,
  },
  {
    keywords: ['murcia'],
    latitude: 10.6056,
    longitude: 123.0417,
  },
  {
    keywords: ['la carlota city', 'la carlota'],
    latitude: 10.4247,
    longitude: 122.9212,
  },
  {
    keywords: ['sipalay city', 'sipalay'],
    latitude: 9.7514,
    longitude: 122.4665,
  },
  {
    keywords: ['negros occidental'],
    latitude: 10.5,
    longitude: 123.0,
  },
  {
    keywords: ['philippines', 'philippine', 'pinas'],
    latitude: 12.8797,
    longitude: 121.7740,
  },
  {
    keywords: ['metro manila', 'manila', 'ncr', 'national capital region'],
    latitude: 14.5995,
    longitude: 120.9842,
  },
  {
    keywords: ['cebu city', 'cebu'],
    latitude: 10.3157,
    longitude: 123.8854,
  },
  {
    keywords: ['davao city', 'davao'],
    latitude: 7.1907,
    longitude: 125.4553,
  },
  {
    keywords: ['iloilo city', 'iloilo'],
    latitude: 10.7202,
    longitude: 122.5621,
  },
  {
    keywords: ['cagayan de oro', 'cdo'],
    latitude: 8.4542,
    longitude: 124.6319,
  },
  {
    keywords: ['zamboanga city', 'zamboanga'],
    latitude: 6.9214,
    longitude: 122.0790,
  },
];

const PHILIPPINES_PLACE_KEYWORDS = [
  'philippines',
  'philippine',
  'pinas',
  'metro manila',
  'manila',
  'ncr',
  'national capital region',
  'luzon',
  'visayas',
  'mindanao',
  'barangay',
  'brgy',
  'brgy.',
  'purok',
  'sitio',
  'poblacion',
  'barangay',
  'municipality',
  'mun',
  'mun.',
  'province',
  'city',
  'city.',
  'batangas',
  'cavite',
  'laguna',
  'rizal',
  'quezon',
  'pampanga',
  'bulacan',
  'pangasinan',
  'nova ecija',
  'tarlac',
  'zambales',
  'bataan',
  'albay',
  'camarines',
  'sorsogon',
  'naga',
  'cebu',
  'davao',
  'cagayan de oro',
  'zamboanga',
  'iligan',
  'general santos',
  'bukidnon',
  'surigao',
  'cotabato',
  'palawan',
  'siargao',
  'batangas',
  'biliran',
  'basilan',
  'batanes',
  'border',
  'dinagat',
  'guimaras',
  'ifugao',
  'kalinga',
  'mountain province',
  'occidental mindoro',
  'oriental mindoro',
  'marinduque',
  'romblon',
  'samar',
  'leyte',
  'biliran',
  'southern leyte',
  'northern samar',
  'western samar',
  'agusan',
  'sultan kudarat',
  'south cotabato',
  'north cotabato',
  'sarangani',
  'dinagat islands',
  'tawi tawi',
  'sulu',
  'lamitan',
  'marawi',
  'iriga',
];

function normalizePlaceValue(value: string | undefined | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasUsableCoordinates(location?: Partial<Project['location']> | null): location is ProjectCoordinates {
  return Boolean(
    location &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude) &&
      !(location.latitude === 0 && location.longitude === 0)
  );
}

function getProjectLocationAddress(project: Pick<Project, 'location'>): string {
  return project.location?.address?.trim() || '';
}

function inferCoordinatesFromRelatedProject(
  project: Project,
  projects: Project[]
): { coordinates: ProjectCoordinates; address?: string } | null {
  const otherProjects = projects.filter(candidate => candidate.id !== project.id);
  const normalizedTitle = normalizePlaceValue(project.title);

  if (normalizedTitle) {
    const sameTitleMatch = otherProjects.find(candidate =>
      normalizePlaceValue(candidate.title) === normalizedTitle && hasUsableCoordinates(candidate.location)
    );

    if (sameTitleMatch) {
      return {
        coordinates: {
          latitude: sameTitleMatch.location.latitude,
          longitude: sameTitleMatch.location.longitude,
        },
        address: getProjectLocationAddress(sameTitleMatch),
      };
    }
  }

  if (project.parentProjectId) {
    const parentMatch = otherProjects.find(candidate =>
      candidate.id === project.parentProjectId && hasUsableCoordinates(candidate.location)
    );

    if (parentMatch) {
      return {
        coordinates: {
          latitude: parentMatch.location.latitude,
          longitude: parentMatch.location.longitude,
        },
        address: getProjectLocationAddress(parentMatch),
      };
    }

    const siblingMatch = otherProjects.find(candidate =>
      candidate.parentProjectId === project.parentProjectId && hasUsableCoordinates(candidate.location)
    );

    if (siblingMatch) {
      return {
        coordinates: {
          latitude: siblingMatch.location.latitude,
          longitude: siblingMatch.location.longitude,
        },
        address: getProjectLocationAddress(siblingMatch),
      };
    }
  }

  const childMatch = otherProjects.find(candidate =>
    candidate.parentProjectId === project.id && hasUsableCoordinates(candidate.location)
  );

  if (childMatch) {
    return {
      coordinates: {
        latitude: childMatch.location.latitude,
        longitude: childMatch.location.longitude,
      },
      address: getProjectLocationAddress(childMatch),
    };
  }

  const inferredFromAddress = inferCoordinatesFromPlace(getProjectLocationAddress(project), otherProjects);
  if (inferredFromAddress) {
    return {
      coordinates: inferredFromAddress,
      address: getProjectLocationAddress(project),
    };
  }

  return null;
}

function resolveProjectMapPlacement(project: Project, projects: Project[]): Project {
  if (hasUsableCoordinates(project.location)) {
    return project;
  }

  const inferredPlacement = inferCoordinatesFromRelatedProject(project, projects);
  if (!inferredPlacement) {
    return project;
  }

  return {
    ...project,
    location: {
      address: getProjectLocationAddress(project) || inferredPlacement.address || 'Location to be finalized',
      latitude: inferredPlacement.coordinates.latitude,
      longitude: inferredPlacement.coordinates.longitude,
    },
  };
}

export function inferCoordinatesFromPlace(
  place: string,
  projects: Array<Pick<Project, 'location'>> = []
): ProjectCoordinates | null {
  const normalizedPlace = normalizePlaceValue(place);
  if (!normalizedPlace) {
    return null;
  }

  const exactProjectMatch = projects.find(project => {
    const normalizedAddress = normalizePlaceValue(project.location?.address);
    return normalizedAddress === normalizedPlace && hasUsableCoordinates(project.location);
  });

  if (exactProjectMatch) {
    return {
      latitude: exactProjectMatch.location.latitude,
      longitude: exactProjectMatch.location.longitude,
    };
  }

  const relatedProjectMatch = projects.find(project => {
    const normalizedAddress = normalizePlaceValue(project.location?.address);
    return (
      normalizedAddress &&
      (normalizedAddress.includes(normalizedPlace) ||
        normalizedPlace.includes(normalizedAddress)) &&
      hasUsableCoordinates(project.location)
    );
  });

  if (relatedProjectMatch) {
    return {
      latitude: relatedProjectMatch.location.latitude,
      longitude: relatedProjectMatch.location.longitude,
    };
  }

  const keywordMatch = KNOWN_PLACE_COORDINATES.find(entry =>
    entry.keywords.some(keyword => normalizedPlace.includes(keyword))
  );

  if (keywordMatch) {
    return {
      latitude: keywordMatch.latitude,
      longitude: keywordMatch.longitude,
    };
  }

  const isPhilippinePlace = PHILIPPINES_PLACE_KEYWORDS.some(keyword => normalizedPlace.includes(keyword));
  if (isPhilippinePlace) {
    return {
      latitude: 12.8797,
      longitude: 121.7740,
    };
  }

  return null;
}

// Shared map constants and helpers for project and event map screens.

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

export const NEGROS_REGION = {
  latitude: 10.4,
  longitude: 123.05,
  latitudeDelta: 0.85,
  longitudeDelta: 0.8,
};

// Returns the marker color for a project or event based only on lifecycle status.
export function getProjectMarkerColor(
  project: Pick<Project, 'isEvent' | 'status' | 'startDate' | 'endDate'>
) {
  return getProjectStatusColor(project);
}

export function getMappedProjects(projects: Project[]): Project[] {
  return projects
    .map(project => resolveProjectMapPlacement(project, projects))
    .filter(project => hasUsableCoordinates(project.location));
}

// Computes an initial map region that keeps all known projects in view.
export function getInitialProjectRegion(projects: Project[]) {
  const mappedProjects = getMappedProjects(projects);

  if (mappedProjects.length === 0) {
    return NEGROS_REGION;
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
