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
import { Partner, Project, Volunteer } from '../models/types';
import {
  getAllPartners,
  getAllVolunteers,
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { navigateToAvailableRoute } from '../utils/navigation';
import {
  PHILIPPINES_BOUNDS,
  PHILIPPINES_WEB_CENTER,
  getMappedProjects,
  getProjectMarkerColor,
  getPrimaryProjectImageSource,
} from '../utils/projectMap';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { createGoogleMapsMarkerIcon, loadGoogleMaps } from '../utils/webGoogleMaps';

const MapHost = 'div' as any;
const MAP_FIT_PADDING_PX = 64;
const MAP_MAX_FIT_ZOOM = 12;
const MAP_SINGLE_MARKER_ZOOM = 10;

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

type VolunteerMapAccountOption = {
  id: string;
  label: string;
  projectIds: string[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
    return 'http://localhost';
  }

  return window.location.origin;
}

function getGoogleMapsErrorMessage(error: unknown, apiKey: string) {
  const currentOrigin = getCurrentWebOrigin();

  if (!apiKey.trim()) {
    return 'Google Maps web key is missing. Add GOOGLE_MAPS_WEB_API_KEY to .env and restart Expo.';
  }

  const message = error instanceof Error ? error.message : '';
  
  if (message.includes('did not initialize')) {
    return `Google Maps failed to initialize.\n\nTroubleshooting:\n• Verify "Maps JavaScript API" is ENABLED in Google Cloud Console\n• Check your API key is valid\n• Current URL: ${currentOrigin}\n• Clear browser cache and try again`;
  }

  return `Google Maps could not load: ${message || 'Unknown error. Check browser console for details.'}`;
}

// Displays the web version of the project map using the Google Maps JavaScript API.
export default function MappingScreen({ navigation }: any) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showMapStyleMenu, setShowMapStyleMenu] = useState(false);
  const [showVolunteerMenu, setShowVolunteerMenu] = useState(false);
  const [selectedMapStyleKey, setSelectedMapStyleKey] = useState<MapStylePresetKey>('admin-overview');
  const [selectedVolunteerId, setSelectedVolunteerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRefs = useRef<Array<{ marker: any; listener: { remove: () => void } }>>([]);
  const infoWindowRef = useRef<any>(null);
  const infoWindowCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoWindowHoveringRef = useRef(false);
  const markerHoveringRef = useRef(false);
  const openInfoWindowProjectIdRef = useRef<string | null>(null);
  const webGoogleMapsApiKey = getWebGoogleMapsApiKey();
  const volunteerMapAccounts: VolunteerMapAccountOption[] = React.useMemo(
    () =>
      [...volunteers]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(volunteer => {
          const joinedEventProjectIds = projects
            .filter(
              project =>
                project.isEvent &&
                (
                  (project.joinedUserIds || []).includes(volunteer.userId) ||
                  (project.volunteers || []).includes(volunteer.id) ||
                  (project.internalTasks || []).some(task => task.assignedVolunteerId === volunteer.id)
                )
            )
            .map(project => project.id);

          return {
            id: volunteer.id,
            label: volunteer.name,
            projectIds: joinedEventProjectIds,
          };
        }),
    [projects, volunteers]
  );

  const availableVolunteerMapAccounts = React.useMemo(() => {
    const mappedIds = new Set(getMappedProjects(projects).map(project => project.id));
    return volunteerMapAccounts
      .map(account => ({
        ...account,
        projectIds: Array.from(new Set((account.projectIds || []).filter(id => mappedIds.has(id)))),
      }))
      .filter(account => account.projectIds.length > 0);
  }, [projects, volunteerMapAccounts]);

  useEffect(() => {
    setSelectedVolunteerId(current =>
      current && availableVolunteerMapAccounts.some(account => account.id === current)
        ? current
        : availableVolunteerMapAccounts[0]?.id || null
    );
  }, [availableVolunteerMapAccounts]);

  const selectedVolunteerAccount =
    selectedVolunteerId
      ? availableVolunteerMapAccounts.find(account => account.id === selectedVolunteerId) || null
      : availableVolunteerMapAccounts[0] || null;

  const displayProjects = React.useMemo(() => {
    if (selectedMapStyleKey !== 'volunteer-view') {
      return projects;
    }
    if (!selectedVolunteerAccount) {
      return [];
    }
    const allowedProjectIds = new Set(selectedVolunteerAccount.projectIds);
    return projects.filter(project => allowedProjectIds.has(project.id));
  }, [projects, selectedMapStyleKey, selectedVolunteerAccount]);

  const mappedProjects = React.useMemo(() => getMappedProjects(displayProjects), [displayProjects]);
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
    if (infoWindowRef.current) {
      try {
        infoWindowRef.current.close();
      } catch {
        // ignore
      }
    }
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
        if (!infoWindowRef.current) {
          infoWindowRef.current = new googleMaps.maps.InfoWindow();
        }

        if (mappedProjects.length === 0) {
          map.setCenter(PHILIPPINES_WEB_CENTER);
          map.setZoom(6);
          return;
        }

        const bounds = new googleMaps.maps.LatLngBounds();

        mappedProjects.forEach(project => {
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

          const buildHoverContent = () => {
            const projectVolunteerNames = volunteers
              .filter(volunteer =>
                (project.joinedUserIds || []).includes(volunteer.userId) ||
                (project.volunteers || []).includes(volunteer.id) ||
                (project.internalTasks || []).some(task => task.assignedVolunteerId === volunteer.id)
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(volunteer => ({
                id: volunteer.id,
                name: volunteer.name,
              }));

            const partner = project.partnerId
              ? partners.find(entry => entry.id === project.partnerId) || null
              : null;

            const container = document.createElement('div');
            container.style.minWidth = '220px';
            container.style.maxWidth = '280px';
            container.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
            container.style.fontSize = '12px';
            container.style.lineHeight = '16px';

            const header = document.createElement('div');
            header.innerHTML = `<div style="font-weight:700;color:#0f172a;margin-bottom:6px;">${escapeHtml(project.title)}</div>`;
            container.appendChild(header);

            if (partner) {
              const partnerRow = document.createElement('button');
              partnerRow.type = 'button';
              partnerRow.dataset.kind = 'partner';
              partnerRow.dataset.id = partner.id;
              partnerRow.style.display = 'block';
              partnerRow.style.width = '100%';
              partnerRow.style.textAlign = 'left';
              partnerRow.style.border = '0';
              partnerRow.style.background = 'transparent';
              partnerRow.style.padding = '6px 0';
              partnerRow.style.cursor = 'pointer';
              partnerRow.innerHTML = `<span style="font-weight:600;color:#0f766e;">Partner:</span> <span style="color:#0f172a;text-decoration:underline;">${escapeHtml(partner.name)}</span>`;
              container.appendChild(partnerRow);
            }

            const volunteerHeader = document.createElement('div');
            volunteerHeader.style.marginTop = partner ? '6px' : '0';
            volunteerHeader.style.fontWeight = '600';
            volunteerHeader.style.color = '#166534';
            volunteerHeader.textContent = `Volunteers (${projectVolunteerNames.length})`;
            container.appendChild(volunteerHeader);

            if (projectVolunteerNames.length === 0) {
              const empty = document.createElement('div');
              empty.style.color = '#64748b';
              empty.style.paddingTop = '4px';
              empty.textContent = 'No volunteers joined yet.';
              container.appendChild(empty);
            } else {
              projectVolunteerNames.slice(0, 8).forEach(item => {
                const row = document.createElement('button');
                row.type = 'button';
                row.dataset.kind = 'volunteer';
                row.dataset.id = item.id;
                row.style.display = 'block';
                row.style.width = '100%';
                row.style.textAlign = 'left';
                row.style.border = '0';
                row.style.background = 'transparent';
                row.style.padding = '5px 0';
                row.style.cursor = 'pointer';
                row.style.color = '#0f172a';
                row.style.textDecoration = 'underline';
                row.textContent = item.name;
                container.appendChild(row);
              });
              if (projectVolunteerNames.length > 8) {
                const more = document.createElement('div');
                more.style.color = '#64748b';
                more.style.paddingTop = '4px';
                more.textContent = `+${projectVolunteerNames.length - 8} more`;
                container.appendChild(more);
              }
            }

            container.addEventListener('click', (event) => {
              const target = event.target as HTMLElement | null;
              const button = target?.closest?.('button') as HTMLButtonElement | null;
              const kind = button?.dataset?.kind;
              const id = button?.dataset?.id;
              if (!kind || !id) {
                return;
              }
              if (kind === 'volunteer') {
                navigateToAvailableRoute(navigation, 'Volunteers', { volunteerId: id }, { routeName: 'Map' });
              } else if (kind === 'partner') {
                navigateToAvailableRoute(navigation, 'Partners', { partnerId: id }, { routeName: 'Map' });
              }
              try {
                infoWindowRef.current?.close?.();
              } catch {
                // ignore
              }
            });

            // Keep the popup open when hovering it.
            container.addEventListener('mouseenter', () => {
              infoWindowHoveringRef.current = true;
              if (infoWindowCloseTimerRef.current) {
                clearTimeout(infoWindowCloseTimerRef.current);
                infoWindowCloseTimerRef.current = null;
              }
            });
            container.addEventListener('mouseleave', () => {
              infoWindowHoveringRef.current = false;
              if (infoWindowCloseTimerRef.current) {
                clearTimeout(infoWindowCloseTimerRef.current);
              }
              infoWindowCloseTimerRef.current = setTimeout(() => {
                if (markerHoveringRef.current) {
                  return;
                }
                try {
                  infoWindowRef.current?.close?.();
                  openInfoWindowProjectIdRef.current = null;
                } catch {
                  // ignore
                }
              }, 200);
            });

            return container;
          };

          const hoverOpenListener = marker.addListener('mouseover', () => {
            if (!infoWindowRef.current) {
              return;
            }
            markerHoveringRef.current = true;
            if (infoWindowCloseTimerRef.current) {
              clearTimeout(infoWindowCloseTimerRef.current);
              infoWindowCloseTimerRef.current = null;
            }
            if (openInfoWindowProjectIdRef.current === project.id) {
              return;
            }
            const content = buildHoverContent();
            infoWindowRef.current.setContent(content);
            infoWindowRef.current.open({ map, anchor: marker });
            openInfoWindowProjectIdRef.current = project.id;
          });

          const hoverCloseListener = marker.addListener('mouseout', () => {
            markerHoveringRef.current = false;
            if (infoWindowCloseTimerRef.current) {
              clearTimeout(infoWindowCloseTimerRef.current);
            }
            infoWindowCloseTimerRef.current = setTimeout(() => {
              if (infoWindowHoveringRef.current || markerHoveringRef.current) {
                return;
              }
              try {
                infoWindowRef.current?.close?.();
                openInfoWindowProjectIdRef.current = null;
              } catch {
                // ignore
              }
            }, 150);
          });

          markerRefs.current.push({ marker, listener });
          markerRefs.current.push({ marker, listener: hoverOpenListener });
          markerRefs.current.push({ marker, listener: hoverCloseListener });
          bounds.extend({
            lat: project.location.latitude,
            lng: project.location.longitude,
          });
        });

        if (mappedProjects.length === 1) {
          const onlyProject = mappedProjects[0];
          map.setCenter({
            lat: onlyProject.location.latitude,
            lng: onlyProject.location.longitude,
          });
          map.setZoom(MAP_SINGLE_MARKER_ZOOM);
          return;
        }

        map.fitBounds(bounds, MAP_FIT_PADDING_PX);
        setTimeout(() => {
          const zoom = map.getZoom?.();
          if (typeof zoom === 'number' && zoom > MAP_MAX_FIT_ZOOM) {
            map.setZoom(MAP_MAX_FIT_ZOOM);
          }
        }, 0);
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
  }, [mappedProjects, selectedMapStyle.mapTypeId, webGoogleMapsApiKey]);

  // Loads map projects and narrows visibility based on the active role.
  const loadProjects = async () => {
    try {
      const [snapshot, allVolunteers, allPartners] = await Promise.all([
        getProjectsScreenSnapshot(user, ['projects', 'partnerProjectApplications', 'volunteerJoinRecords']),
        getAllVolunteers(),
        getAllPartners(),
      ]);
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
                  joinedVolunteerProjectIds.has(project.id) ||
                  (snapshot.volunteerProfile && (project.volunteers || []).includes(snapshot.volunteerProfile.id)) ||
                  (snapshot.volunteerProfile && (project.internalTasks || []).some(task => task.assignedVolunteerId === snapshot.volunteerProfile?.id))
                )
            )
          : snapshot.projects;

      setProjects(visibleProjects);
      setVolunteers(allVolunteers);
      setPartners(allPartners);
      setLoading(false);
    } catch (error) {
      console.error('Error loading projects for map:', error);
      setProjects([]);
      setVolunteers([]);
      setPartners([]);
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

      {selectedMapStyleKey === 'volunteer-view' && availableVolunteerMapAccounts.length > 0 ? (
        <View style={styles.volunteerPickerRow}>
          <TouchableOpacity
            style={[
              styles.mapStyleButton,
              styles.volunteerPickerButton,
              {
                backgroundColor: selectedMapStyle.chipBg,
                borderColor: selectedMapStyle.chipBorder,
              },
            ]}
            onPress={() => setShowVolunteerMenu(true)}
          >
            <MaterialIcons name="person-outline" size={18} color={selectedMapStyle.accentColor} />
            <Text
              style={[styles.mapStyleButtonText, styles.volunteerPickerText, { color: selectedMapStyle.accentColor }]}
              numberOfLines={1}
            >
              {selectedVolunteerAccount?.label || 'Choose volunteer'}
            </Text>
            <MaterialIcons
              name="keyboard-arrow-down"
              size={22}
              color={selectedMapStyle.accentColor}
            />
          </TouchableOpacity>
        </View>
      ) : null}

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
        <Text style={styles.projectListTitle}>Google Maps markers ({mappedProjects.length})</Text>
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
                  <View style={[styles.statusDot, { backgroundColor: getProjectStatusColor(selectedProject) }]} />
                  <Text style={styles.statusText}>{getProjectDisplayStatus(selectedProject)}</Text>
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
                    <Text style={styles.infoLabel}>Place</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.location.address || 'Place to be announced'}
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

      <Modal
        animationType="fade"
        transparent
        visible={showVolunteerMenu}
        onRequestClose={() => setShowVolunteerMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setShowVolunteerMenu(false)}
        >
          <View style={styles.mapStyleMenu}>
            <Text style={styles.mapStyleMenuTitle}>Choose volunteer</Text>
            <ScrollView style={styles.accountList} showsVerticalScrollIndicator={false}>
              {availableVolunteerMapAccounts.map(account => {
                const isActive = account.id === selectedVolunteerAccount?.id;
                return (
                  <TouchableOpacity
                    key={account.id}
                    style={[styles.mapStyleMenuItem, isActive && styles.mapStyleMenuItemActive]}
                    onPress={() => {
                      setSelectedVolunteerId(account.id);
                      setShowVolunteerMenu(false);
                    }}
                  >
                    <View style={styles.mapStyleMenuItemTextWrap}>
                      <Text style={styles.mapStyleMenuItemTitle}>{account.label}</Text>
                      <Text style={styles.mapStyleMenuItemDescription}>
                        {account.projectIds.length} mapped
                        {account.projectIds.length === 1 ? ' project' : ' projects'}
                      </Text>
                    </View>
                    {isActive ? <MaterialIcons name="check" size={20} color={selectedMapStyle.accentColor} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
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
  volunteerPickerRow: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    alignItems: 'flex-end',
  },
  volunteerPickerButton: {
    maxWidth: 320,
  },
  volunteerPickerText: {
    flex: 1,
  },
  accountList: {
    maxHeight: 340,
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
