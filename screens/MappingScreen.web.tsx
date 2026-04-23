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
import { getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { createGoogleMapsMarkerIcon, loadGoogleMaps } from '../utils/webGoogleMaps';

const MapHost = 'div' as any;

type MapStylePresetKey = 'admin-overview' | 'volunteer-view' | 'partner-view';

type MapStylePreset = {
  key: MapStylePresetKey;
  label: string;
  description: string;
  mapTypeId: 'roadmap' | 'terrain' | 'hybrid';
  accentColor: string;
  chipBg: string;
  chipBorder: string;
  shellBg: string;
  shellBorder: string;
  errorBg: string;
  errorBorder: string;
};

const MAP_STYLE_PRESETS: MapStylePreset[] = [
  {
    key: 'admin-overview',
    label: 'Admin overview',
    description: 'Neutral roadmap for command-center use.',
    mapTypeId: 'roadmap',
    accentColor: '#1d4ed8',
    chipBg: '#eff6ff',
    chipBorder: '#bfdbfe',
    shellBg: '#dbeafe',
    shellBorder: '#bfdbfe',
    errorBg: 'rgba(219, 234, 254, 0.92)',
    errorBorder: '#bfdbfe',
  },
  {
    key: 'volunteer-view',
    label: 'Volunteer view',
    description: 'Green terrain styling like the volunteer side.',
    mapTypeId: 'terrain',
    accentColor: '#166534',
    chipBg: '#f0fdf4',
    chipBorder: '#bbf7d0',
    shellBg: '#dcfce7',
    shellBorder: '#bbf7d0',
    errorBg: 'rgba(220, 252, 231, 0.92)',
    errorBorder: '#bbf7d0',
  },
  {
    key: 'partner-view',
    label: 'Partner view',
    description: 'Blue hybrid styling for partner planning.',
    mapTypeId: 'hybrid',
    accentColor: '#0f766e',
    chipBg: '#ecfeff',
    chipBorder: '#a5f3fc',
    shellBg: '#e0f2fe',
    shellBorder: '#bae6fd',
    errorBg: 'rgba(224, 242, 254, 0.92)',
    errorBorder: '#bae6fd',
  },
];

function getWebGoogleMapsApiKey() {
  const expoExtra = Constants.expoConfig?.extra as { webGoogleMapsApiKey?: string } | undefined;
  return expoExtra?.webGoogleMapsApiKey || process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || '';
}

function getCurrentWebOrigin() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return 'http://localhost:8081';
  }

  return window.location.origin;
}

function getGoogleMapsErrorMessage(error: unknown, apiKey: string) {
  const currentOrigin = getCurrentWebOrigin();

  if (!apiKey.trim()) {
    return 'Google Maps web key is missing. Add GOOGLE_MAPS_WEB_API_KEY to volunteer-system/.env and restart Expo.';
  }

  const message = error instanceof Error ? error.message : '';
  if (message) {
    return `Google Maps could not load on web. Allow ${currentOrigin} in your Google Maps web key referrers and make sure the Maps JavaScript API is enabled.`;
  }

  return `Google Maps could not load on web. Allow ${currentOrigin} in your Google Maps web key referrers, then check the browser console for more details.`;
}

// Displays the web version of the project map using the Google Maps JavaScript API.
export default function MappingScreen({ navigation }: any) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showMapStyleMenu, setShowMapStyleMenu] = useState(false);
  const [selectedMapStyleKey, setSelectedMapStyleKey] = useState<MapStylePresetKey>('admin-overview');
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRefs = useRef<Array<{ marker: any; listener: { remove: () => void } }>>([]);
  const webGoogleMapsApiKey = getWebGoogleMapsApiKey();
  const selectedMapStyle =
    MAP_STYLE_PRESETS.find(preset => preset.key === selectedMapStyleKey) || MAP_STYLE_PRESETS[0];

  useEffect(() => {
    void loadProjects();
  }, [user]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'events', 'partnerProjectApplications', 'volunteerProjectJoins'],
      () => {
        void loadProjects();
      }
    );
  }, [user]);

  const clearMarkers = () => {
    markerRefs.current.forEach(({ marker, listener }) => {
      listener.remove();
      marker.setMap(null);
    });
    markerRefs.current = [];
  };

  useEffect(() => {
    if (!mapElementRef.current) {
      return;
    }

    let cancelled = false;

    const renderMap = async () => {
      try {
        const googleMaps = await loadGoogleMaps(webGoogleMapsApiKey);
        if (cancelled || !mapElementRef.current) {
          return;
        }

        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new googleMaps.maps.Map(mapElementRef.current, {
            center: PHILIPPINES_WEB_CENTER,
            zoom: 6,
            minZoom: 5,
            mapTypeId: selectedMapStyle.mapTypeId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true,
            restriction: {
              latLngBounds: PHILIPPINES_BOUNDS,
              strictBounds: false,
            },
          });
        } else {
          mapInstanceRef.current.setOptions({ mapTypeId: selectedMapStyle.mapTypeId });
        }

        const map = mapInstanceRef.current;
        clearMarkers();
        setMapError(null);

        if (projects.length === 0) {
          map.setCenter(PHILIPPINES_WEB_CENTER);
          map.setZoom(6);
          return;
        }

        const bounds = new googleMaps.maps.LatLngBounds();

        projects.forEach(project => {
          const marker = new googleMaps.maps.Marker({
            position: {
              lat: project.location.latitude,
              lng: project.location.longitude,
            },
            map,
            title: project.title,
            icon: createGoogleMapsMarkerIcon(googleMaps, getProjectMarkerColor(project)),
          });

          const listener = marker.addListener('click', () => {
            setSelectedProject(project);
            setShowDetails(true);
          });

          markerRefs.current.push({ marker, listener });
          bounds.extend({
            lat: project.location.latitude,
            lng: project.location.longitude,
          });
        });

        map.fitBounds(bounds, 64);
      } catch (error) {
        if (!cancelled) {
          clearMarkers();
          setMapError(getGoogleMapsErrorMessage(error, webGoogleMapsApiKey));
        }
      }
    };

    void renderMap();

    return () => {
      cancelled = true;
      clearMarkers();
    };
  }, [projects, selectedMapStyle.mapTypeId, webGoogleMapsApiKey]);

  // Loads map projects and narrows visibility based on the active role.
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
              project => approvedPartnerProjectIds.has(project.id)
            )
          : user?.role === 'volunteer'
          ? snapshot.projects.filter(
              project =>
                project.isEvent &&
                (
                  (project.joinedUserIds || []).includes(user.id) ||
                joinedVolunteerProjectIds.has(project.id)
                )
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
        <View style={styles.headerTopRow}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerTitle}>Negros Programs and Events</Text>
            <Text style={styles.headerSubtitle}>
              {user?.role === 'admin'
                ? 'Google Maps view for Negros Occidental, Philippines'
                : user?.role === 'partner'
                ? 'Only approved partner proposals appear as pins'
                : 'Only events you joined appear as pins'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.mapStyleButton,
              {
                backgroundColor: selectedMapStyle.chipBg,
                borderColor: selectedMapStyle.chipBorder,
              },
            ]}
            onPress={() => setShowMapStyleMenu(true)}
          >
            <MaterialIcons name="tune" size={18} color={selectedMapStyle.accentColor} />
            <Text style={[styles.mapStyleButtonText, { color: selectedMapStyle.accentColor }]}>
              {selectedMapStyle.label}
            </Text>
            <MaterialIcons name="keyboard-arrow-down" size={22} color={selectedMapStyle.accentColor} />
          </TouchableOpacity>
        </View>
      </View>

      <View
        style={[
          styles.webMapContainer,
          {
            backgroundColor: selectedMapStyle.shellBg,
            borderBottomColor: selectedMapStyle.shellBorder,
          },
        ]}
      >
        <MapHost ref={mapElementRef} style={styles.webMapFrame} />
        {mapError ? (
          <View style={[styles.mapErrorOverlay, { backgroundColor: selectedMapStyle.errorBg }]}>
            <View style={[styles.mapErrorCard, { borderColor: selectedMapStyle.errorBorder }]}>
              <Text style={styles.mapErrorTitle}>Google Maps unavailable</Text>
              <Text style={styles.mapErrorText}>{mapError}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.projectListContainer}>
        <Text style={styles.projectListTitle}>Google Maps markers ({projects.length})</Text>
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
                    {user?.role === 'admin' ? 'Open Program Management Suite' : 'View Full Details'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={showMapStyleMenu}
        onRequestClose={() => setShowMapStyleMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setShowMapStyleMenu(false)}
        >
          <View style={styles.mapStyleMenu}>
            <Text style={styles.mapStyleMenuTitle}>Choose map style</Text>
            {MAP_STYLE_PRESETS.map(preset => {
              const isActive = preset.key === selectedMapStyleKey;

              return (
                <TouchableOpacity
                  key={preset.key}
                  style={[styles.mapStyleMenuItem, isActive && styles.mapStyleMenuItemActive]}
                  onPress={() => {
                    setSelectedMapStyleKey(preset.key);
                    setShowMapStyleMenu(false);
                  }}
                >
                  <View style={styles.mapStyleMenuItemTextWrap}>
                    <Text style={styles.mapStyleMenuItemTitle}>{preset.label}</Text>
                    <Text style={styles.mapStyleMenuItemDescription}>{preset.description}</Text>
                  </View>
                  {isActive ? <MaterialIcons name="check" size={20} color="#2563eb" /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
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
    backgroundColor: '#dbeafe',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e6e6',
    overflow: 'hidden',
  },
  webMapFrame: {
    width: '100%',
    height: '100%',
  },
  mapErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(219, 234, 254, 0.92)',
    paddingHorizontal: 24,
  },
  mapErrorCard: {
    maxWidth: 420,
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  mapErrorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#12243d',
    textAlign: 'center',
    marginBottom: 10,
  },
  mapErrorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
    textAlign: 'center',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
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
  mapStyleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  mapStyleButtonText: {
    fontSize: 12,
    fontWeight: '700',
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
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 78,
    paddingRight: 16,
  },
  mapStyleMenu: {
    width: 290,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  mapStyleMenuTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  mapStyleMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  mapStyleMenuItemActive: {
    backgroundColor: '#eff6ff',
  },
  mapStyleMenuItemTextWrap: {
    flex: 1,
  },
  mapStyleMenuItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  mapStyleMenuItemDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: '#64748b',
  },
});
