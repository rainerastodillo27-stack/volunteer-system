import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useAuth } from '../contexts/AuthContext';
import { Project } from '../models/types';
import { getProjectsScreenSnapshot, subscribeToStorageChanges } from '../models/storage';
import { navigateToAvailableRoute } from '../utils/navigation';
import {
  PHILIPPINES_BOUNDS,
  PHILIPPINES_WEB_CENTER,
  getPrimaryProjectImageSource,
  getProjectMarkerColor,
} from '../utils/projectMap';
import { createWebMapMarkerIcon, resolveMarkerImageUri } from '../utils/mapMarkerVisuals';
import { getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const MapHost = 'div' as any;

type WebFallbackBounds = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
};

// Resolves the Google Maps web API key from Expo config or environment variables.
function getWebGoogleMapsApiKey(): string | undefined {
  const constantsAny = Constants as typeof Constants & {
    manifest?: { extra?: Record<string, unknown> };
    manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
  };

  const fromExpoConfig = Constants.expoConfig?.extra?.webGoogleMapsApiKey;
  const fromManifest = constantsAny.manifest?.extra?.webGoogleMapsApiKey;
  const fromManifest2 = constantsAny.manifest2?.extra?.expoClient?.extra?.webGoogleMapsApiKey;
  const fromPublicEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY;

  const resolvedKey =
    fromExpoConfig ??
    fromManifest ??
    fromManifest2 ??
    fromPublicEnv;

  return typeof resolvedKey === 'string' && resolvedKey.trim().length > 0
    ? resolvedKey.trim()
    : undefined;
}

// Loads the Google Maps browser script once and reuses the same promise.
function loadGoogleMapsScript(apiKey: string) {
  const browserWindow = window as Window & {
    google?: any;
    __googleMapsScriptPromise?: Promise<void>;
  };

  if (browserWindow.google?.maps) {
    return Promise.resolve();
  }

  if (browserWindow.__googleMapsScriptPromise) {
    return browserWindow.__googleMapsScriptPromise;
  }

  browserWindow.__googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById('google-maps-js-api') as HTMLScriptElement | null;

    const handleLoad = () => {
      if (browserWindow.google?.maps) {
        resolve();
        return;
      }

      reject(new Error('Google Maps JavaScript API did not initialize.'));
    };

    const handleError = () => reject(new Error('Failed to load Google Maps JavaScript API.'));

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad, { once: true });
      existingScript.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-js-api';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return browserWindow.__googleMapsScriptPromise;
}

// Escapes dynamic strings before they are injected into Google Maps HTML content.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getWebFallbackBounds(projects: Project[]): WebFallbackBounds {
  if (projects.length === 0) {
    return {
      minLatitude: PHILIPPINES_BOUNDS.south,
      maxLatitude: PHILIPPINES_BOUNDS.north,
      minLongitude: PHILIPPINES_BOUNDS.west,
      maxLongitude: PHILIPPINES_BOUNDS.east,
    };
  }

  const latitudes = projects.map(project => project.location.latitude);
  const longitudes = projects.map(project => project.location.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudePadding = Math.max((maxLatitude - minLatitude) * 0.18, 0.18);
  const longitudePadding = Math.max((maxLongitude - minLongitude) * 0.18, 0.18);

  return {
    minLatitude: clamp(minLatitude - latitudePadding, PHILIPPINES_BOUNDS.south, PHILIPPINES_BOUNDS.north),
    maxLatitude: clamp(maxLatitude + latitudePadding, PHILIPPINES_BOUNDS.south, PHILIPPINES_BOUNDS.north),
    minLongitude: clamp(minLongitude - longitudePadding, PHILIPPINES_BOUNDS.west, PHILIPPINES_BOUNDS.east),
    maxLongitude: clamp(maxLongitude + longitudePadding, PHILIPPINES_BOUNDS.west, PHILIPPINES_BOUNDS.east),
  };
}

function getFallbackMarkerPosition(project: Project, bounds: WebFallbackBounds) {
  const latitudeRange = Math.max(bounds.maxLatitude - bounds.minLatitude, 0.0001);
  const longitudeRange = Math.max(bounds.maxLongitude - bounds.minLongitude, 0.0001);
  const horizontalProgress = (project.location.longitude - bounds.minLongitude) / longitudeRange;
  const verticalProgress = (bounds.maxLatitude - project.location.latitude) / latitudeRange;

  return {
    left: `${clamp(8 + horizontalProgress * 84, 8, 92)}%`,
    top: `${clamp(12 + verticalProgress * 68, 12, 80)}%`,
  };
}

// Displays the web version of the project map using Google Maps JavaScript API.
export default function MappingScreen({ navigation }: any) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const googleMapsApiKey = getWebGoogleMapsApiKey();
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const fallbackBounds = getWebFallbackBounds(projects);
  const usingFallbackMap = !googleMapsApiKey || Boolean(mapError);

  useEffect(() => {
    void loadProjects();
  }, [user]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'partnerProjectApplications', 'volunteerProjectJoins'],
      () => {
        void loadProjects();
      }
    );
  }, [user]);

  useEffect(() => {
    if (!googleMapsApiKey) {
      setMapError('Google Maps web key is missing. Add GOOGLE_MAPS_WEB_API_KEY to .env.');
      return;
    }

    if (!mapElementRef.current) {
      return;
    }

    let cancelled = false;
    const browserWindow = window as Window & {
      google?: any;
      gm_authFailure?: () => void;
    };

    browserWindow.gm_authFailure = () => {
      if (!cancelled) {
        setMapError('Google Maps rejected the web key. Check Maps JavaScript API and localhost referrer restrictions.');
      }
    };

    const renderMap = async () => {
      try {
        await loadGoogleMapsScript(googleMapsApiKey);
        if (cancelled || !mapElementRef.current || !browserWindow.google?.maps) {
          return;
        }

        setMapError(null);

        const map = new browserWindow.google.maps.Map(mapElementRef.current, {
          center: PHILIPPINES_WEB_CENTER,
          zoom: 6,
          minZoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          restriction: {
            latLngBounds: PHILIPPINES_BOUNDS,
            strictBounds: false,
          },
        });

        const bounds = new browserWindow.google.maps.LatLngBounds();
        const infoWindow = new browserWindow.google.maps.InfoWindow();

        projects.forEach((project, index) => {
          const projectImageUri = resolveMarkerImageUri(getPrimaryProjectImageSource(project));
          const marker = new browserWindow.google.maps.Marker({
            map,
            position: {
              lat: project.location.latitude,
              lng: project.location.longitude,
            },
            title: project.title,
            icon: {
              url: createWebMapMarkerIcon({
                accentColor: getProjectMarkerColor(project),
              }),
              scaledSize: new browserWindow.google.maps.Size(48, 57),
              anchor: new browserWindow.google.maps.Point(24, 54),
            },
          });

          bounds.extend(marker.getPosition());

          marker.addListener('click', () => {
            const projectImageHtml = projectImageUri
              ? `<img src="${escapeHtml(projectImageUri)}" alt="${escapeHtml(project.title)}" style="width:100%;height:110px;object-fit:cover;border-radius:12px;margin-bottom:10px;" />`
              : '';
            infoWindow.setContent(`
              <div style="width:220px;padding:14px;font-family:Arial,sans-serif;">
                ${projectImageHtml}
                <div style="margin-bottom:8px;font-size:16px;font-weight:700;color:#111827;">
                  ${escapeHtml(project.title)}
                </div>
                <div style="display:inline-block;margin-bottom:10px;padding:4px 10px;border-radius:999px;color:#fff;font-size:11px;font-weight:700;background:${getProjectMarkerColor(project)};">
                  ${escapeHtml(project.isEvent ? 'Event' : 'Program')}
                </div>
                <div style="margin-bottom:6px;font-size:12px;color:#4b5563;"><strong>Status:</strong> ${escapeHtml(project.status)}</div>
                <div style="margin-bottom:6px;font-size:12px;color:#4b5563;"><strong>Location:</strong> ${project.location.latitude.toFixed(4)}, ${project.location.longitude.toFixed(4)}</div>
                <div style="font-size:12px;color:#4b5563;"><strong>Volunteers Needed:</strong> ${project.volunteersNeeded}</div>
              </div>
            `);
            infoWindow.open({ anchor: marker, map });
            setSelectedProject(project);
            setShowDetails(true);
          });
        });

        if (projects.length > 0) {
          map.fitBounds(bounds, 48);
        }
      } catch (error) {
        if (!cancelled) {
          setMapError('Google Maps could not load. Check that Maps JavaScript API is enabled for the web key.');
        }
      }
    };

    void renderMap();

    return () => {
      cancelled = true;
      if (browserWindow.gm_authFailure) {
        delete browserWindow.gm_authFailure;
      }
    };
  }, [googleMapsApiKey, projects]);

  // Loads map projects and narrows visibility to projects the current user joined.
  const loadProjects = async () => {
    try {
      const snapshot = await getProjectsScreenSnapshot(user);
      const approvedPartnerProjectIds = new Set(
        snapshot.partnerApplications
          .filter(application => application.status === 'Approved')
          .map(application => application.projectId)
      );
      const joinedVolunteerProjectIds = new Set(
        snapshot.volunteerJoinRecords.map(record => record.projectId)
      );

      const visibleProjects =
        user?.role === 'partner'
          ? snapshot.projects.filter(
              project =>
                (project.joinedUserIds || []).includes(user.id) ||
                approvedPartnerProjectIds.has(project.id)
            )
          : user?.role === 'volunteer'
          ? snapshot.projects.filter(
              project =>
                (project.joinedUserIds || []).includes(user.id) ||
                joinedVolunteerProjectIds.has(project.id)
            )
          : snapshot.projects;

      setProjects(visibleProjects);
      setLoading(false);
    } catch (error) {
      console.error('Error loading projects for map:', error);
      setProjects([]);
      Alert.alert(
        getRequestErrorTitle(error, 'Database Unavailable'),
        getRequestErrorMessage(error, 'Failed to load projects from Postgres.')
      );
      setLoading(false);
    }
  };

  // Redirects to the correct details screen for the currently selected project.
  const handleOpenProjectDetails = () => {
    if (!selectedProject) {
      return;
    }

    setShowDetails(false);
    if (user?.role === 'admin') {
      navigateToAvailableRoute(navigation, 'Lifecycle', { projectId: selectedProject.id }, {
        routeName: 'Projects',
        params: { projectId: selectedProject.id },
      });
      return;
    }

    navigateToAvailableRoute(navigation, 'Projects', { projectId: selectedProject.id });
  };

  const handleProjectSelection = (project: Project) => {
    setSelectedProject(project);
    setShowDetails(true);
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Negros Programs and Events</Text>
        <Text style={styles.headerSubtitle}>
          {user?.role === 'admin'
            ? 'Marker map for Negros Occidental, Philippines'
            : 'Only projects you joined appear as pins'}
        </Text>
      </View>

      <View style={styles.webMapContainer}>
        {usingFallbackMap ? (
          <View style={styles.fallbackMapFrame}>
            <View style={styles.fallbackMapBackdrop} />
            <View style={styles.fallbackMapGrid} pointerEvents="none" />
            <View style={styles.fallbackMapLabels} pointerEvents="none">
              <Text style={[styles.mapLabel, styles.mapLabelNorth]}>North</Text>
              <Text style={[styles.mapLabel, styles.mapLabelWest]}>West</Text>
              <Text style={[styles.mapLabel, styles.mapLabelEast]}>East</Text>
              <Text style={[styles.mapLabel, styles.mapLabelSouth]}>South</Text>
            </View>

            {projects.map((project, index) => {
              const markerPosition = getFallbackMarkerPosition(project, fallbackBounds);

              return (
                <TouchableOpacity
                  key={project.id}
                  style={[
                    styles.fallbackMarkerWrap,
                    {
                      left: markerPosition.left as any,
                      top: markerPosition.top as any,
                    },
                  ]}
                  activeOpacity={0.9}
                  onPress={() => handleProjectSelection(project)}
                >
                  <View
                    style={[
                      styles.fallbackMarkerPin,
                      { backgroundColor: getProjectMarkerColor(project) },
                    ]}
                  >
                    <View style={styles.fallbackMarkerInner} />
                  </View>
                </TouchableOpacity>
              );
            })}

            <View style={styles.fallbackLegend}>
              <Text style={styles.fallbackLegendTitle}>Interactive project map</Text>
              <Text style={styles.fallbackLegendText}>
                {mapError || 'Web fallback mode is active because a browser Google Maps key is not configured.'}
              </Text>
            </View>
          </View>
        ) : (
          <MapHost ref={mapElementRef} style={styles.webMapFrame} />
        )}
      </View>

      <View style={styles.projectListContainer}>
        <Text style={styles.projectListTitle}>Negros markers ({projects.length})</Text>
      </View>

      <Modal animationType="slide" transparent visible={showDetails} onRequestClose={() => setShowDetails(false)}>
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowDetails(false)}>
              <MaterialIcons name="close" size={28} color="#333" />
            </TouchableOpacity>

            {selectedProject && (
              <ScrollView style={styles.modalContent}>
                {(() => {
                  const projectImageSource = getPrimaryProjectImageSource(selectedProject);
                  if (!projectImageSource) {
                    return null;
                  }

                  return (
                    <Image
                      source={projectImageSource}
                      style={styles.projectPhoto}
                      resizeMode="cover"
                    />
                  );
                })()}

                <View style={styles.statusBadge}>
                  <View style={[styles.statusDot, { backgroundColor: getProjectStatusColor(selectedProject.status) }]} />
                  <Text style={styles.statusText}>{selectedProject.status}</Text>
                </View>

                <Text style={styles.projectTitle}>{selectedProject.title}</Text>
                <Text style={styles.description}>{selectedProject.description}</Text>

                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Category</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.programModule || selectedProject.category}
                    </Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Volunteers Needed</Text>
                    <Text style={styles.infoValue}>{selectedProject.volunteersNeeded}</Text>
                  </View>
                </View>

                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Latitude</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.location.latitude.toFixed(4)}
                    </Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Longitude</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.location.longitude.toFixed(4)}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.viewDetailsButton}
                  onPress={handleOpenProjectDetails}
                >
                  <Text style={styles.viewDetailsButtonText}>
                    {user?.role === 'admin' ? 'Open Project Suite' : 'View Full Details'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  webMapContainer: {
    position: 'relative',
    height: 420,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e6e6',
    overflow: 'hidden',
  },
  webMapFrame: {
    width: '100%',
    height: '100%',
  },
  fallbackMapFrame: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  fallbackMapBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#dff2ea',
  },
  fallbackMapGrid: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(20, 83, 45, 0.08)',
    backgroundColor: 'transparent',
  },
  fallbackMapLabels: {
    ...StyleSheet.absoluteFillObject,
  },
  mapLabel: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(18, 36, 61, 0.42)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  mapLabelNorth: {
    top: 18,
    alignSelf: 'center',
  },
  mapLabelWest: {
    left: 18,
    top: '50%',
  },
  mapLabelEast: {
    right: 18,
    top: '50%',
  },
  mapLabelSouth: {
    bottom: 18,
    alignSelf: 'center',
  },
  fallbackMarkerWrap: {
    position: 'absolute',
    alignItems: 'center',
    transform: [{ translateX: -18 }, { translateY: -18 }],
    maxWidth: 110,
  },
  fallbackMarkerPin: {
    minWidth: 36,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 8,
  },
  fallbackMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
  },
  fallbackLegend: {
    position: 'absolute',
    left: 18,
    bottom: 18,
    maxWidth: 360,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 10,
    },
    elevation: 6,
  },
  fallbackLegendTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#12243d',
    marginBottom: 6,
  },
  fallbackLegendText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#486581',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  projectListContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  projectListTitle: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingVertical: 20,
    minHeight: '70%',
  },
  closeButton: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  modalContent: {
    paddingHorizontal: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  projectTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  projectPhoto: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    marginBottom: 20,
    backgroundColor: '#e5e7eb',
  },
  description: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 20,
  },
  infoGrid: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 16,
  },
  infoItem: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '600',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  viewDetailsButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  viewDetailsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
