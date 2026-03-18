pimport { Project } from '../models/types';
import { getProjectStatusColor } from './projectStatus';

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

export function getProjectMarkerColor(project: Pick<Project, 'isEvent' | 'status'>) {
  return project.isEvent ? EVENT_MARKER_COLOR : getProjectStatusColor(project.status);
}

export function getInitialProjectRegion(projects: Project[]) {
  if (projects.length === 0) {
    return PHILIPPINES_REGION;
  }

  const latitudes = projects.map(project => project.location.latitude);
  const longitudes = projects.map(project => project.location.longitude);
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
