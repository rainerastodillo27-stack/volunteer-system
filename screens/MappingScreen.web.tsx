import React, { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import ModernTheme from '../utils/modernTheme';
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
import { useAuth } from '../contexts/AuthContext';
import { AdvocacyFocus, Partner, PartnerProjectApplication, Project, ProgramTrack, Volunteer, VolunteerProjectJoinRecord } from '../models/types';
import {
  getAllPartners,
  getAllVolunteers,
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { navigateToAvailableRoute } from '../utils/navigation';
import { withImpactMapFallbackProjects } from '../utils/impactMapFallbacks';
import {
  PHILIPPINES_BOUNDS,
  PHILIPPINES_WEB_CENTER,
  getMappedProjects,
  getProjectMarkerColor,
  getPrimaryProjectImageSource,
} from '../utils/projectMap';
import { getPartnerForMappedProject, getProjectIdsForPartner, getProjectIdsForPartnerUser } from '../utils/mapProjectLinks';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { createGoogleMapsMarkerIcon, loadGoogleMaps } from '../utils/webGoogleMaps';
import { getProjectVolunteerMapEntries, getProjectVolunteersNeeded } from '../utils/projectVolunteers';

const MapHost = 'div' as any;
const MAP_FIT_PADDING_PX = 64;
const MAP_MAX_FIT_ZOOM = 12;
const MAP_SINGLE_MARKER_ZOOM = 10;

type MapStylePresetKey = 'admin-overview' | 'projects-view' | 'events-view' | 'volunteer-view' | 'partner-view';

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
  mappedProjectCount?: number;
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
    description: 'Neutral roadmap showing all projects and events.',
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
    key: 'projects-view',
    label: 'Projects',
    description: 'Show only parent projects across programs.',
    mapTypeId: 'roadmap',
    accentColor: '#0284c7',
    chipBg: '#f0f9ff',
    chipBorder: '#bae6fd',
    shellBg: '#e0f2fe',
    shellBorder: '#bae6fd',
    errorBg: 'rgba(224, 242, 254, 0.92)',
    errorBorder: '#bae6fd',
  },
  {
    key: 'events-view',
    label: 'Events',
    description: 'Show only scheduled events and field activities.',
    mapTypeId: 'roadmap',
    accentColor: '#ea580c',
    chipBg: '#fff7ed',
    chipBorder: '#fed7aa',
    shellBg: '#ffedd5',
    shellBorder: '#fed7aa',
    errorBg: 'rgba(255, 237, 213, 0.92)',
    errorBorder: '#fed7aa',
  },
  {
    key: 'volunteer-view',
    label: 'Volunteer view',
    description: 'Green roadmap styling like the volunteer side.',
    mapTypeId: 'roadmap',
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
    description: 'Blue roadmap styling for partner planning.',
    mapTypeId: 'roadmap',
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
  return (
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ||
    expoExtra?.webGoogleMapsApiKey ||
    process.env.GOOGLE_MAPS_WEB_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ||
    ''
  );
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
    return 'Google Maps web key is missing. Add EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY to .env and restart the web app.';
  }

  const message = error instanceof Error ? error.message : '';
  
  if (message.includes('did not initialize')) {
    return `Google Maps failed to initialize.\n\nTroubleshooting:\n• Verify "Maps JavaScript API" is ENABLED in Google Cloud Console\n• Check your API key is valid\n• Current URL: ${currentOrigin}\n• Clear browser cache and try again`;
  }

  return `Google Maps could not load: ${message || 'Unknown error. Check browser console for details.'}`;
}

function getMapLegendTitle(selectedMapStyleKey: MapStylePresetKey) {
  return selectedMapStyleKey === 'volunteer-view' || selectedMapStyleKey === 'events-view'
    ? 'Event Status'
    : 'Project Status';
}

function getMapLegendTotalLabel(selectedMapStyleKey: MapStylePresetKey, count: number) {
  if (selectedMapStyleKey === 'volunteer-view' || selectedMapStyleKey === 'events-view') {
    return `Total ${count === 1 ? 'Event' : 'Events'}`;
  }

  return `Total ${count === 1 ? 'Project' : 'Projects'}`;
}

function getMapLegendFootnote(selectedMapStyleKey: MapStylePresetKey) {
  if (selectedMapStyleKey === 'volunteer-view') {
    return 'Volunteer events';
  }
  if (selectedMapStyleKey === 'events-view') {
    return 'All scheduled events';
  }
  if (selectedMapStyleKey === 'projects-view') {
    return 'All active projects';
  }
  return 'Across Philippines';
}

// Displays the web version of the project map using the Google Maps JavaScript API.
export default function MappingScreen({ navigation }: any) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showMapStyleMenu, setShowMapStyleMenu] = useState(false);
  const [showVolunteerMenu, setShowVolunteerMenu] = useState(false);
  const defaultMapStyleKey: MapStylePresetKey =
    user?.role === 'volunteer'
      ? 'volunteer-view'
      : user?.role === 'partner'
      ? 'partner-view'
      : 'admin-overview';

  const [showPartnerMenu, setShowPartnerMenu] = useState(false);
  const [selectedMapStyleKey, setSelectedMapStyleKey] = useState<MapStylePresetKey>(defaultMapStyleKey);
  const [selectedVolunteerId, setSelectedVolunteerId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  // Admin event filters
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterProgram, setFilterProgram] = useState<AdvocacyFocus | ''>('');
  const [locationPromptProject, setLocationPromptProject] = useState<Project | null>(null);
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
          const explicitJoinedEventIds = new Set(
            volunteerJoinRecords
              .filter(
                record =>
                  record.volunteerId === volunteer.id ||
                  record.volunteerUserId === volunteer.userId
              )
              .map(record => record.projectId)
          );

          const joinedEventProjectIds = projects
            .filter(
              project =>
                project.isEvent &&
                (
                  explicitJoinedEventIds.has(project.id) ||
                  (project.joinedUserIds || []).includes(volunteer.userId) ||
                  (project.volunteers || []).includes(volunteer.id) ||
                  (project.internalTasks || []).some(task =>
                    task.assignedVolunteerId === volunteer.id ||
                    (task.assignedVolunteerIds || []).includes(volunteer.id)
                  )
                )
            )
            .map(project => project.id);

          return {
            id: volunteer.id,
            label: volunteer.name,
            projectIds: joinedEventProjectIds,
          };
        }),
    [projects, volunteers, volunteerJoinRecords]
  );

  const partnerMapAccounts: VolunteerMapAccountOption[] = React.useMemo(
    () =>
      [...partners]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(partner => {
          // Only show projects linked to APPROVED proposals for this partner
          const approvedProjectIds = getProjectIdsForPartner(
            partner,
            projects,
            partnerApplications
          );

          return {
            id: partner.id,
            label: partner.name,
            projectIds: approvedProjectIds,
          };
        }),
    [projects, partners, partnerApplications]
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

  const availablePartnerMapAccounts = React.useMemo(() => {
    const mappedIds = new Set(getMappedProjects(projects).map(project => project.id));
    return partnerMapAccounts
      .map(account => ({
        ...account,
        projectIds: Array.from(new Set((account.projectIds || []).filter(id => mappedIds.has(id)))),
      }))
      .filter(account => account.projectIds.length > 0);
  }, [projects, partnerMapAccounts]);

  useEffect(() => {
    setSelectedVolunteerId(current =>
      current && availableVolunteerMapAccounts.some(account => account.id === current)
        ? current
        : availableVolunteerMapAccounts[0]?.id || null
    );
  }, [availableVolunteerMapAccounts]);

  useEffect(() => {
    setSelectedPartnerId(current =>
      current && availablePartnerMapAccounts.some(account => account.id === current)
        ? current
        : availablePartnerMapAccounts[0]?.id || null
    );
  }, [availablePartnerMapAccounts]);

  const selectedVolunteerAccount =
    selectedVolunteerId
      ? availableVolunteerMapAccounts.find(account => account.id === selectedVolunteerId) || null
      : availableVolunteerMapAccounts[0] || null;

  const selectedPartnerAccount =
    selectedPartnerId
      ? availablePartnerMapAccounts.find(account => account.id === selectedPartnerId) || null
      : availablePartnerMapAccounts[0] || null;

  const displayProjects = React.useMemo(() => {
    if (user?.role === 'volunteer') {
      return projects;
    }

    if (user?.role === 'partner') {
      return projects;
    }

    let baseProjects = projects;

    if (selectedMapStyleKey === 'volunteer-view') {
      if (!selectedVolunteerAccount) {
        return [];
      }
      const allowedProjectIds = new Set(selectedVolunteerAccount.projectIds);
      baseProjects = projects.filter(project => allowedProjectIds.has(project.id));
    } else if (selectedMapStyleKey === 'partner-view') {
      if (!selectedPartnerAccount) {
        return [];
      }
      const allowedProjectIds = new Set(selectedPartnerAccount.projectIds);
      baseProjects = projects.filter(project => allowedProjectIds.has(project.id));
    } else if (selectedMapStyleKey === 'projects-view') {
      baseProjects = projects.filter(project => !project.isEvent);
    } else if (selectedMapStyleKey === 'events-view') {
      baseProjects = projects.filter(project => Boolean(project.isEvent));
    }

    // Apply Admin Filters (Date & Program) across admin overview, projects, and events views
    if (user?.role === 'admin') {
      if (filterDate) {
        const selected = new Date(filterDate);
        selected.setHours(0, 0, 0, 0);
        baseProjects = baseProjects.filter(project => {
          if (project.isEvent) {
            const start = project.startDate ? new Date(project.startDate) : null;
            const end = project.endDate ? new Date(project.endDate) : null;
            if (!start) return false;
            start.setHours(0, 0, 0, 0);
            if (end) {
              end.setHours(23, 59, 59, 999);
              return selected >= start && selected <= end;
            }
            return selected.toDateString() === start.toDateString();
          }
          // For parent projects, check if ANY child event matches date
          const childEvents = projects.filter(
            c => c.isEvent && (c.parentProjectId === project.id || c.parentProjectId === project.title)
          );
          if (childEvents.length > 0) {
            return childEvents.some(child => {
              const start = child.startDate ? new Date(child.startDate) : null;
              const end = child.endDate ? new Date(child.endDate) : null;
              if (!start) return false;
              start.setHours(0, 0, 0, 0);
              if (end) {
                end.setHours(23, 59, 59, 999);
                return selected >= start && selected <= end;
              }
              return selected.toDateString() === start.toDateString();
            });
          }
          const start = project.startDate ? new Date(project.startDate) : null;
          const end = project.endDate ? new Date(project.endDate) : null;
          if (!start) return false;
          start.setHours(0, 0, 0, 0);
          if (end) {
            end.setHours(23, 59, 59, 999);
            return selected >= start && selected <= end;
          }
          return selected.toDateString() === start.toDateString();
        });
      }

      if (filterProgram) {
        baseProjects = baseProjects.filter(project => {
          const prog = project.programModule || project.category;
          return prog === filterProgram;
        });
      }
    }

    return baseProjects;
  }, [projects, selectedMapStyleKey, selectedVolunteerAccount, selectedPartnerAccount, user?.role, filterDate, filterProgram]);

  const mappedProjects = React.useMemo(() => {
    const result = getMappedProjects(displayProjects);
    console.log('[MAP DEBUG] Total displayProjects:', displayProjects.length);
    console.log('[MAP DEBUG] displayProjects:', displayProjects.map(p => ({
      id: p.id,
      title: p.title,
      parentProjectId: p.parentProjectId,
      isEvent: p.isEvent,
      lat: p.location?.latitude,
      lng: p.location?.longitude
    })));
    console.log('[MAP DEBUG] Filtered mappedProjects:', result.length);
    console.log('[MAP DEBUG] mappedProjects:', result.map(p => ({
      id: p.id,
      title: p.title,
      parentProjectId: p.parentProjectId,
      lat: p.location.latitude,
      lng: p.location.longitude
    })));
    return result;
  }, [displayProjects]);
  const markerVolunteerEntriesByProjectId = React.useMemo(
    () =>
      new Map(
        mappedProjects.map(project => [
          project.id,
          getProjectVolunteerMapEntries(project, volunteers, volunteerJoinRecords, projects),
        ])
      ),
    [mappedProjects, volunteers, volunteerJoinRecords, projects]
  );
  const selectedMapStyle =
    MAP_STYLE_PRESETS.find(preset => preset.key === selectedMapStyleKey) || MAP_STYLE_PRESETS[0];
  const featuredProject = mappedProjects[0] || null;
  const statusLegend = [
    { label: 'In Progress', color: '#5B9B57' },
    { label: 'Planned', color: '#5F8FDC' },
    { label: 'Completed', color: '#8E58D6' },
    { label: 'On Hold', color: '#E7A23D' },
    { label: 'Cancelled', color: '#B95258' },
  ];

  useEffect(() => {
    void loadProjects();
  }, [user]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'events', 'volunteers', 'partnerProjectApplications', 'volunteerProjectJoins'],
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
          console.log('[MAP DEBUG] No mapped projects - showing default view');
          map.setCenter(PHILIPPINES_WEB_CENTER);
          map.setZoom(6);
          return;
        }

        console.log('[MAP DEBUG] Creating markers for', mappedProjects.length, 'projects');
        const bounds = new googleMaps.maps.LatLngBounds();

        mappedProjects.forEach(project => {
          console.log('[MAP DEBUG] Creating marker for:', project.title, 'at', project.location.latitude, project.location.longitude);
          const marker = new googleMaps.maps.Marker({
            position: {
              lat: project.location.latitude,
              lng: project.location.longitude,
            },
            map,
            title: project.title,
            icon: createGoogleMapsMarkerIcon(
              googleMaps,
              getProjectMarkerColor(project),
              markerVolunteerEntriesByProjectId.get(project.id)?.length || 0
            ),
          });

          const listener = marker.addListener('click', () => {
            setSelectedProject(project);
            setShowDetails(true);
          });

          const buildHoverContent = () => {
            const projectVolunteerEntries =
              markerVolunteerEntriesByProjectId.get(project.id) ||
              getProjectVolunteerMapEntries(project, volunteers, volunteerJoinRecords);

            const partner = getPartnerForMappedProject(project, partners);

            const container = document.createElement('div');
            container.style.minWidth = '220px';
            container.style.maxWidth = '280px';
            container.style.fontFamily = 'DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
            container.style.fontSize = '12px';
            container.style.lineHeight = '16px';

            const header = document.createElement('div');
            header.innerHTML = `<div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${escapeHtml(project.title)}</div><div style="font-weight:700;color:#475569;margin-bottom:6px;">${project.isEvent ? 'Event' : 'Project'}</div>`;
            container.appendChild(header);

            if (partner && !project.isEvent) {
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
            volunteerHeader.textContent = `Volunteers (${projectVolunteerEntries.length})`;
            container.appendChild(volunteerHeader);

            if (projectVolunteerEntries.length === 0) {
              const empty = document.createElement('div');
              empty.style.color = '#64748b';
              empty.style.paddingTop = '4px';
              empty.textContent = 'No volunteers joined yet.';
              container.appendChild(empty);
            } else {
              projectVolunteerEntries.slice(0, 8).forEach(item => {
                const row = document.createElement('button');
                row.type = 'button';
                row.dataset.kind = 'volunteer';
                row.dataset.id = item.volunteerId || item.id;
                row.style.display = 'block';
                row.style.width = '100%';
                row.style.textAlign = 'left';
                row.style.border = '0';
                row.style.background = 'transparent';
                row.style.padding = '5px 0';
                row.style.cursor = 'pointer';
                row.style.color = '#0f172a';
                row.style.textDecoration = 'underline';
                row.textContent = item.label;
                container.appendChild(row);
              });
              if (projectVolunteerEntries.length > 8) {
                const more = document.createElement('div');
                more.style.color = '#64748b';
                more.style.paddingTop = '4px';
                more.textContent = `+${projectVolunteerEntries.length - 8} more`;
                container.appendChild(more);
              }
              const directionsBtn = document.createElement('button');
              directionsBtn.type = 'button';
              directionsBtn.dataset.kind = 'directions';
              directionsBtn.dataset.id = project.id;
              directionsBtn.style.display = 'flex';
              directionsBtn.style.alignItems = 'center';
              directionsBtn.style.justifyContent = 'center';
              directionsBtn.style.gap = '6px';
              directionsBtn.style.marginTop = '10px';
              directionsBtn.style.width = '100%';
              directionsBtn.style.padding = '7px 12px';
              directionsBtn.style.backgroundColor = '#16a34a';
              directionsBtn.style.color = '#ffffff';
              directionsBtn.style.border = 'none';
              directionsBtn.style.borderRadius = '6px';
              directionsBtn.style.cursor = 'pointer';
              directionsBtn.style.fontSize = '12px';
              directionsBtn.style.fontWeight = '700';
              directionsBtn.textContent = '🧭 Get Directions';
              container.appendChild(directionsBtn);
            }

            container.addEventListener('click', (event) => {
              const target = event.target as HTMLElement | null;
              const button = target?.closest?.('button') as HTMLButtonElement | null;
              const kind = button?.dataset?.kind;
              const id = button?.dataset?.id;
              if (!kind || !id) {
                return;
              }
              if (kind === 'directions') {
                handleGetDirections(project);
              } else if (kind === 'volunteer') {
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
          console.log('[MAP DEBUG] Single project - zooming to:', onlyProject.title, 'at zoom', MAP_SINGLE_MARKER_ZOOM);
          map.setCenter({
            lat: onlyProject.location.latitude,
            lng: onlyProject.location.longitude,
          });
          map.setZoom(MAP_SINGLE_MARKER_ZOOM);
          console.log('[MAP DEBUG] Zoom set to:', MAP_SINGLE_MARKER_ZOOM);
          return;
        }

        console.log('[MAP DEBUG] Multiple projects - fitting bounds');
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
  }, [
    mappedProjects,
    selectedMapStyle.mapTypeId,
    webGoogleMapsApiKey,
    markerVolunteerEntriesByProjectId,
    partners,
    navigation,
  ]);

  // Loads map projects and narrows visibility based on the active role.
  const loadProjects = async () => {
    try {
      const snapshot = await getProjectsScreenSnapshot(user, [
        'projects',
        'partnerProjectApplications',
        'volunteerJoinRecords',
        'volunteerProfile',
        'volunteerMatches',
        'programTracks',
      ]);
      const allPartners = await getAllPartners();
      const mapSourceProjects = withImpactMapFallbackProjects(
        snapshot.projects,
        snapshot.partnerApplications,
        snapshot.volunteerJoinRecords
      );
      const partnerProjectIds = new Set(
        user?.role === 'partner'
          ? getProjectIdsForPartnerUser(
              user,
              allPartners,
              mapSourceProjects,
              snapshot.partnerApplications
            )
          : []
      );
      const joinedVolunteerProjectIds = new Set([
        ...snapshot.volunteerJoinRecords.map(record => record.projectId),
        ...(snapshot.volunteerMatches || [])
          .filter(match => match.status === 'Matched' || match.status === 'Requested')
          .map(match => match.projectId),
      ]);

      const visibleProjects =
        user?.role === 'partner'
          ? // Partner: only projects from APPROVED proposals
            mapSourceProjects.filter(project => partnerProjectIds.has(project.id))
          : user?.role === 'volunteer'
          ? // Volunteer: only EVENTS (isEvent=true) that the volunteer has joined or requested/matched
            mapSourceProjects.filter(
              project =>
                project.isEvent &&
                (
                  joinedVolunteerProjectIds.has(project.id) ||
                  (snapshot.volunteerProfile && (project.joinedUserIds || []).includes(snapshot.volunteerProfile.userId)) ||
                  (snapshot.volunteerProfile && (project.volunteers || []).includes(snapshot.volunteerProfile.id)) ||
                  (user?.id && (project.joinedUserIds || []).includes(user.id)) ||
                  (project.internalTasks || []).some(task =>
                    snapshot.volunteerProfile &&
                    (task.assignedVolunteerId === snapshot.volunteerProfile.id ||
                      (task.assignedVolunteerIds || []).includes(snapshot.volunteerProfile.id))
                  )
                )
            )
          : mapSourceProjects;

      console.log('[MAP DEBUG] loadProjects - snapshot.projects:', snapshot.projects.length);
      console.log('[MAP DEBUG] loadProjects - mapSourceProjects:', mapSourceProjects.length);
      console.log('[MAP DEBUG] loadProjects - visibleProjects:', visibleProjects.length);
      console.log('[MAP DEBUG] loadProjects - visibleProjects details:', visibleProjects.map(p => ({
        id: p.id,
        title: p.title,
        parentProjectId: p.parentProjectId,
        isEvent: p.isEvent
      })));
      setProjects(visibleProjects);
      setVolunteerJoinRecords(snapshot.volunteerJoinRecords || []);
      setPartnerApplications(snapshot.partnerApplications || []);
      setPartners(allPartners);
      setProgramTracks((snapshot.programTracks || []).filter(t => t.isActive !== false));
      const allVolunteers = await getAllVolunteers();
      setVolunteers(allVolunteers);
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

  // Handles opening directions with geolocation permission prompt or text list fallback
  const handleGetDirections = (targetProject: Project | null) => {
    if (!targetProject) return;

    if (!targetProject?.location?.latitude || !targetProject?.location?.longitude) {
      setLocationPromptProject(targetProject);
      return;
    }

    const destLat = targetProject.location.latitude;
    const destLng = targetProject.location.longitude;

    if (typeof navigator !== 'undefined' && navigator?.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          const userLat = position.coords.latitude;
          const userLng = position.coords.longitude;
          const url = `https://www.google.com/maps/dir/?api=1&origin=${userLat},${userLng}&destination=${destLat},${destLng}&travelmode=driving`;
          window.open(url, '_blank');
        },
        error => {
          console.warn('[MAP] Geolocation access denied or unavailable:', error);
          // Show location details text list modal with direct destination navigation
          setLocationPromptProject(targetProject);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      setLocationPromptProject(targetProject);
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator
    >
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.mapTitleGroup}>
            <View style={styles.titleIconShell}>
              <MaterialIcons name="location-on" size={30} color="#5A8F52" />
            </View>
            <View style={styles.headerTextBlock}>
              <Text style={styles.headerTitle}>Community Impact Map</Text>
              <Text style={styles.headerSubtitle}>Switch between admin, volunteer, and partner{`\n`}views to inspect mapped project activity.</Text>
            </View>
          </View>
          {selectedMapStyleKey === 'partner-view' ? (
            <TouchableOpacity style={styles.workspaceButton} onPress={() => setShowPartnerMenu(true)}>
              <MaterialIcons name="business" size={22} color="#5A8F52" />
              <Text style={styles.workspaceButtonText} numberOfLines={1}>
                {selectedPartnerAccount?.label || 'Choose partner'}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={24} color="#334155" />
            </TouchableOpacity>
          ) : selectedMapStyleKey === 'volunteer-view' ? (
            <TouchableOpacity style={styles.workspaceButton} onPress={() => setShowVolunteerMenu(true)}>
              <MaterialIcons name="person-outline" size={22} color="#166534" />
              <Text style={[styles.workspaceButtonText, { color: '#166534' }]} numberOfLines={1}>
                {selectedVolunteerAccount?.label || 'Choose volunteer'}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={24} color="#166534" />
            </TouchableOpacity>
          ) : selectedMapStyleKey === 'projects-view' ? (
            <View style={[styles.workspaceButton, { opacity: 0.85 }]}>
              <MaterialIcons name="folder" size={22} color="#0284c7" />
              <Text style={[styles.workspaceButtonText, { color: '#0284c7' }]}>All Projects</Text>
            </View>
          ) : selectedMapStyleKey === 'events-view' ? (
            <View style={[styles.workspaceButton, { opacity: 0.85 }]}>
              <MaterialIcons name="event" size={22} color="#ea580c" />
              <Text style={[styles.workspaceButtonText, { color: '#ea580c' }]}>All Events</Text>
            </View>
          ) : (
            <View style={[styles.workspaceButton, { opacity: 0.85 }]}>
              <MaterialIcons name="public" size={22} color="#1d4ed8" />
              <Text style={[styles.workspaceButtonText, { color: '#1d4ed8' }]}>All Projects & Events</Text>
            </View>
          )}
          <TouchableOpacity style={styles.viewButton} onPress={() => setShowMapStyleMenu(true)}>
            <MaterialIcons name="tune" size={27} color="#5A8F52" />
            <Text style={styles.viewButtonText}>{selectedMapStyle.label}</Text>
            <MaterialIcons name="keyboard-arrow-down" size={24} color="#334155" />
          </TouchableOpacity>
        </View>

        {/* Admin filters – date and program (active for Admin) */}
        {user?.role === 'admin' ? (
          <View style={styles.adminFiltersRow}>
            <View style={styles.adminFilterItem}>
              <MaterialIcons name="calendar-today" size={15} color="#ea580c" style={{ marginRight: 5 }} />
              <Text style={styles.adminFilterLabel}>Date</Text>
              <input
                type="date"
                value={filterDate}
                onChange={(e: any) => setFilterDate(e.target.value)}
                style={{
                  border: '1px solid #fed7aa',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  outline: 'none',
                  background: '#ffffff',
                  fontSize: 13,
                  color: '#1e293b',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  minWidth: 130,
                }}
              />
              {filterDate ? (
                <TouchableOpacity onPress={() => setFilterDate('')} style={styles.filterClearBtn}>
                  <MaterialIcons name="close" size={14} color="#64748b" />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.adminFilterDivider} />

            <View style={styles.adminFilterItem}>
              <MaterialIcons name="category" size={15} color="#ea580c" style={{ marginRight: 5 }} />
              <Text style={styles.adminFilterLabel}>Program</Text>
              <View style={styles.programChipsRow}>
                <TouchableOpacity
                  style={[
                    styles.programChip,
                    !filterProgram && styles.programChipActive,
                  ]}
                  onPress={() => setFilterProgram('')}
                >
                  <Text style={[
                    styles.programChipText,
                    !filterProgram && styles.programChipTextActive,
                  ]}>All</Text>
                </TouchableOpacity>
                {programTracks.length > 0
                  ? programTracks.map(track => {
                      // Infer the AdvocacyFocus from the track title/id
                      const text = `${track.id || ''} ${track.title || ''}`.toLowerCase();
                      let prog: AdvocacyFocus = 'Disaster';
                      if (text.includes('nutrition')) prog = 'Nutrition';
                      else if (text.includes('education')) prog = 'Education';
                      else if (text.includes('livelihood')) prog = 'Livelihood';
                      return (
                        <TouchableOpacity
                          key={track.id}
                          style={[
                            styles.programChip,
                            filterProgram === prog && styles.programChipActive,
                          ]}
                          onPress={() => setFilterProgram(current => current === prog ? '' : prog)}
                        >
                          <Text style={[
                            styles.programChipText,
                            filterProgram === prog && styles.programChipTextActive,
                          ]}>{track.title}</Text>
                        </TouchableOpacity>
                      );
                    })
                  : (['Education', 'Nutrition', 'Livelihood', 'Disaster'] as AdvocacyFocus[]).map(prog => (
                    <TouchableOpacity
                      key={prog}
                      style={[
                        styles.programChip,
                        filterProgram === prog && styles.programChipActive,
                      ]}
                      onPress={() => setFilterProgram(current => current === prog ? '' : prog)}
                    >
                      <Text style={[
                        styles.programChipText,
                        filterProgram === prog && styles.programChipTextActive,
                      ]}>{prog}</Text>
                    </TouchableOpacity>
                  ))
                }
              </View>
            </View>

            {(filterDate || filterProgram) ? (
              <TouchableOpacity
                style={styles.clearAllFiltersBtn}
                onPress={() => { setFilterDate(''); setFilterProgram(''); }}
              >
                <MaterialIcons name="filter-alt-off" size={15} color="#ef4444" />
                <Text style={styles.clearAllFiltersText}>Clear filters</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
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
        <View style={styles.mapLegend}>
          <Text style={styles.legendTitle}>{getMapLegendTitle(selectedMapStyleKey)}</Text>
          {statusLegend.map(status => (
            <View key={status.label} style={styles.legendRow}>
              <MaterialIcons name="location-on" size={16} color={status.color} />
              <Text style={styles.legendText}>{status.label}</Text>
            </View>
          ))}
          <View style={styles.legendDivider} />
          <Text style={styles.legendTotalLabel}>
            {getMapLegendTotalLabel(selectedMapStyleKey, mappedProjects.length)}
          </Text>
          <Text style={styles.legendTotal}>{mappedProjects.length}</Text>
          <Text style={styles.legendFootnote}>{getMapLegendFootnote(selectedMapStyleKey)}</Text>
        </View>
        {mapError ? (
          <View style={[styles.mapErrorOverlay, { backgroundColor: selectedMapStyle.errorBg }]}>
            <View style={[styles.mapErrorCard, { borderColor: selectedMapStyle.errorBorder }]}>
              <Text style={styles.mapErrorTitle}>Google Maps unavailable</Text>
              <Text style={styles.mapErrorText}>{mapError}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {featuredProject ? (
        <TouchableOpacity style={styles.featuredProjectCard} activeOpacity={0.88} onPress={() => { setSelectedProject(featuredProject); setShowDetails(true); }}>
          <View style={styles.featuredIconShell}><MaterialIcons name="school" size={45} color="#4C8249" /></View>
          <View style={styles.featuredCopy}>
            <Text style={styles.featuredTitle} numberOfLines={1}>{featuredProject.title}</Text>
            <View style={styles.featuredBadges}>
              <View style={styles.categoryBadge}><Text style={styles.categoryBadgeText}>{featuredProject.category}</Text></View>
              <View style={styles.progressBadge}><View style={styles.progressDot} /><Text style={styles.progressBadgeText}>{getProjectDisplayStatus(featuredProject)}</Text></View>
            </View>
            <View style={styles.featuredMeta}>
              <View style={styles.metaItem}><MaterialIcons name="location-on" size={23} color="#5B6470" /><Text style={styles.metaText} numberOfLines={1}>{featuredProject.location.address || 'Philippines'}</Text></View>
              <View style={styles.metaItem}><MaterialIcons name="calendar-today" size={20} color="#5B6470" /><Text style={styles.metaText}>{new Date(featuredProject.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text></View>
            </View>
          </View>
          <View style={styles.volunteerSummary}><MaterialIcons name="groups-2" size={40} color="#5B6470" /><View><Text style={styles.volunteerNumber}>{(markerVolunteerEntriesByProjectId.get(featuredProject.id) || []).length} / {getProjectVolunteersNeeded(featuredProject, projects)}</Text><Text style={styles.volunteerLabel}>Volunteers</Text></View></View>
          <View style={styles.cardDivider} />
          <TouchableOpacity
            style={styles.featuredDirectionsBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              handleGetDirections(featuredProject);
            }}
          >
            <MaterialIcons name="directions" size={20} color="#16a34a" />
            <Text style={styles.featuredDirectionsText}>Directions</Text>
          </TouchableOpacity>
          <View style={styles.detailsButton}><Text style={styles.detailsButtonText}>View Details</Text><MaterialIcons name="arrow-forward" size={24} color="#4C8249" /></View>
        </TouchableOpacity>
      ) : null}

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
                    <Text style={styles.infoLabel}>Type</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.isEvent ? 'Event' : 'Project'}
                    </Text>
                  </View>
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

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    style={styles.modalDirectionsButton}
                    onPress={() => handleGetDirections(selectedProject)}
                  >
                    <MaterialIcons name="directions" size={18} color="#ffffff" />
                    <Text style={styles.modalDirectionsButtonText}>Get Directions</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.viewDetailsButton, { flex: 1, marginTop: 0 }]}
                    onPress={handleOpenProjectDetails}
                  >
                    <Text style={styles.viewDetailsButtonText}>
                      {user?.role === 'admin' ? 'Open Management Suite' : 'View Full Details'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Location Details & Directions Text List Fallback Modal */}
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(locationPromptProject)}
        onRequestClose={() => setLocationPromptProject(null)}
      >
        <View style={styles.centeredView}>
          <View style={[styles.modalView, { maxWidth: 520 }]}>
            <TouchableOpacity style={styles.closeButton} onPress={() => setLocationPromptProject(null)}>
              <MaterialIcons name="close" size={26} color="#333" />
            </TouchableOpacity>

            {locationPromptProject && (
              <ScrollView style={styles.modalContent}>
                <View style={styles.locationModalHeader}>
                  <View style={styles.locationModalIconShell}>
                    <MaterialIcons name="place" size={32} color="#16a34a" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.locationModalTitle}>Location & Directions</Text>
                    <Text style={styles.locationModalSubtitle}>
                      Location details and direct navigation link for this event.
                    </Text>
                  </View>
                </View>

                <View style={styles.locationCard}>
                  <View style={styles.locationRow}>
                    <MaterialIcons name="event" size={18} color="#0f766e" />
                    <View style={styles.locationTextGroup}>
                      <Text style={styles.locationFieldLabel}>Event / Project</Text>
                      <Text style={styles.locationFieldValue}>{locationPromptProject.title}</Text>
                    </View>
                  </View>

                  <View style={styles.locationDivider} />

                  <View style={styles.locationRow}>
                    <MaterialIcons name="location-on" size={18} color="#dc2626" />
                    <View style={styles.locationTextGroup}>
                      <Text style={styles.locationFieldLabel}>Address / Barangay</Text>
                      <Text style={styles.locationFieldValue}>
                        {locationPromptProject.location?.address || 'Negros Island Region, Philippines'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.locationDivider} />

                  <View style={styles.locationRow}>
                    <MaterialIcons name="my-location" size={18} color="#2563eb" />
                    <View style={styles.locationTextGroup}>
                      <Text style={styles.locationFieldLabel}>GPS Coordinates</Text>
                      <Text style={styles.locationFieldValue}>
                        {locationPromptProject.location?.latitude && locationPromptProject.location?.longitude
                          ? `${locationPromptProject.location.latitude.toFixed(5)}, ${locationPromptProject.location.longitude.toFixed(5)}`
                          : 'Coordinates to be updated'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.locationDivider} />

                  <View style={styles.locationRow}>
                    <MaterialIcons name="calendar-today" size={18} color="#ea580c" />
                    <View style={styles.locationTextGroup}>
                      <Text style={styles.locationFieldLabel}>Schedule</Text>
                      <Text style={styles.locationFieldValue}>
                        {locationPromptProject.startDate
                          ? new Date(locationPromptProject.startDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : 'Date TBD'}
                        {locationPromptProject.endDate
                          ? ` - ${new Date(locationPromptProject.endDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}`
                          : ''}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.locationDivider} />

                  <View style={styles.locationRow}>
                    <MaterialIcons name="category" size={18} color="#7c3aed" />
                    <View style={styles.locationTextGroup}>
                      <Text style={styles.locationFieldLabel}>Program Focus</Text>
                      <Text style={styles.locationFieldValue}>
                        {locationPromptProject.programModule || locationPromptProject.category || 'General Advocacy'}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                  <TouchableOpacity
                    style={styles.openInMapsButton}
                    onPress={() => {
                      const lat = locationPromptProject.location?.latitude;
                      const lng = locationPromptProject.location?.longitude;
                      const query = (lat && lng)
                        ? `${lat},${lng}`
                        : encodeURIComponent(locationPromptProject.location?.address || locationPromptProject.title);
                      const url = `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=driving`;
                      window.open(url, '_blank');
                    }}
                  >
                    <MaterialIcons name="open-in-new" size={18} color="#ffffff" />
                    <Text style={styles.openInMapsButtonText}>Open in Google Maps</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.closeLocationModalBtn}
                    onPress={() => setLocationPromptProject(null)}
                  >
                    <Text style={styles.closeLocationModalBtnText}>Close</Text>
                  </TouchableOpacity>
                </View>
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

      <Modal
        animationType="fade"
        transparent
        visible={showPartnerMenu}
        onRequestClose={() => setShowPartnerMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setShowPartnerMenu(false)}
        >
          <View style={styles.mapStyleMenu}>
            <Text style={styles.mapStyleMenuTitle}>Choose partner</Text>
            <ScrollView style={styles.accountList} showsVerticalScrollIndicator={false}>
              {availablePartnerMapAccounts.map(account => {
                const isActive = account.id === selectedPartnerAccount?.id;
                return (
                  <TouchableOpacity
                    key={account.id}
                    style={[styles.mapStyleMenuItem, isActive && styles.mapStyleMenuItemActive]}
                    onPress={() => {
                      setSelectedPartnerId(account.id);
                      setShowPartnerMenu(false);
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  pageContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: ModernTheme.colors.background.secondary,
  },
  loadingText: {
    marginTop: ModernTheme.spacing[4],
    fontSize: ModernTheme.typography.fontSize.lg,
    color: ModernTheme.colors.text.secondary,
  },
  webMapContainer: {
    position: 'relative',
    height: 490,
    marginHorizontal: 31,
    borderRadius: 20,
    backgroundColor: ModernTheme.colors.neutral[200],
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
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
    paddingHorizontal: ModernTheme.spacing[6],
  },
  mapErrorCard: {
    maxWidth: 420,
    paddingHorizontal: ModernTheme.spacing[5],
    paddingVertical: ModernTheme.spacing[6],
    backgroundColor: ModernTheme.colors.background.card,
    borderRadius: ModernTheme.borderRadius.xl,
    borderWidth: 0,
    borderColor: 'transparent',
    ...ModernTheme.shadows.lg,
  },
  mapErrorTitle: {
    fontSize: ModernTheme.typography.fontSize.lg,
    fontWeight: '700' as const,
    color: ModernTheme.colors.text.primary,
    textAlign: 'center',
    marginBottom: ModernTheme.spacing[2.5],
  },
  mapErrorText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    lineHeight: 20,
    color: ModernTheme.colors.text.secondary,
    textAlign: 'center',
  },
  header: {
    backgroundColor: ModernTheme.colors.background.card,
    paddingHorizontal: 31,
    paddingTop: 15,
    paddingBottom: 32,
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    ...ModernTheme.shadows.sm,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 22,
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 25,
    fontWeight: '700' as const,
    color: ModernTheme.colors.text.primary,
  },
  headerSubtitle: {
    fontSize: 17,
    lineHeight: 25,
    color: '#68758A',
    marginTop: 3,
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
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    maxHeight: 180,
  },
  projectListTitle: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
  },
  markerList: {
    marginTop: 8,
  },
  markerListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  markerListPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerListPinText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  markerListCopy: {
    flex: 1,
    minWidth: 0,
  },
  markerListName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  markerListMeta: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  mapTitleGroup: {
    flex: 1,
    minWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  titleIconShell: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F8F1',
  },
  workspaceButton: {
    width: 460,
    height: 70,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 23,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  workspaceButtonText: {
    flex: 1,
    color: '#263244',
    fontSize: 17,
    fontWeight: '800',
  },
  viewButton: {
    width: 296,
    height: 70,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  viewButtonText: {
    flex: 1,
    color: '#263244',
    fontSize: 17,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  mapLegend: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 136,
    borderRadius: 12,
    paddingTop: 10,
    paddingBottom: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#334155',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  legendTitle: {
    marginHorizontal: 12,
    marginBottom: 6,
    color: '#263244',
    fontSize: 12,
    fontWeight: '800',
  },
  legendRow: {
    height: 22,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendText: { color: '#596579', fontSize: 11, fontWeight: '600' },
  legendDivider: { height: 1, backgroundColor: '#E1E7ED', marginTop: 6 },
  legendTotalLabel: { marginHorizontal: 12, marginTop: 6, color: '#39465A', fontSize: 11, fontWeight: '800' },
  legendTotal: { marginHorizontal: 12, marginTop: 2, color: '#4D894B', fontSize: 20, fontWeight: '800' },
  legendFootnote: { marginHorizontal: 12, marginBottom: 4, marginTop: 2, color: '#6B778B', fontSize: 10, fontWeight: '600' },
  featuredProjectCard: {
    minHeight: 160,
    marginHorizontal: 31,
    marginTop: 30,
    paddingHorizontal: 28,
    paddingVertical: 27,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E4E9EE',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 25,
    shadowColor: '#334155',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 9,
    elevation: 2,
  },
  featuredIconShell: { width: 90, height: 104, borderRadius: 17, backgroundColor: '#F0F8EF', alignItems: 'center', justifyContent: 'center' },
  featuredCopy: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', minWidth: 280 },
  featuredTitle: { color: '#172238', fontSize: 25, fontWeight: '800' },
  featuredBadges: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryBadge: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#F0F8EF' },
  categoryBadgeText: { color: '#4B8649', fontSize: 15, fontWeight: '800' },
  progressBadge: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#F0F8EF', flexDirection: 'row', alignItems: 'center', gap: 7 },
  progressDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#5A9855' },
  progressBadgeText: { color: '#4B8649', fontSize: 15, fontWeight: '800' },
  featuredMeta: { marginTop: 17, flexDirection: 'row', alignItems: 'center', gap: 24 },
  metaItem: { maxWidth: 300, flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { color: '#485569', fontSize: 16, fontWeight: '600' },
  volunteerSummary: { width: 250, paddingLeft: 24, borderLeftWidth: 1, borderLeftColor: '#E4E9EE', flexDirection: 'row', alignItems: 'center', gap: 17 },
  volunteerNumber: { color: '#263244', fontSize: 17, fontWeight: '800' },
  volunteerLabel: { marginTop: 2, color: '#536074', fontSize: 15, fontWeight: '600' },
  cardDivider: { width: 1, height: 57, backgroundColor: '#E4E9EE' },
  detailsButton: { width: 186, height: 54, borderWidth: 2, borderColor: '#78A974', borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  detailsButtonText: { color: '#4C8249', fontSize: 16, fontWeight: '800' },  centeredView: {
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
  // Admin event filter bar
  adminFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
    paddingHorizontal: 4,
    paddingVertical: 10,
    backgroundColor: '#fff7ed',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  adminFilterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  adminFilterLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7c3aed',
    marginRight: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  adminFilterDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#fed7aa',
    marginHorizontal: 4,
  },
  filterClearBtn: {
    padding: 2,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    marginLeft: 2,
  },
  programChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  programChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  programChipActive: {
    backgroundColor: '#ea580c',
    borderColor: '#ea580c',
  },
  programChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  programChipTextActive: {
    color: '#ffffff',
  },
  clearAllFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    marginLeft: 'auto',
  },
  clearAllFiltersText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ef4444',
  },
  // Featured directions button
  featuredDirectionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 11,
    backgroundColor: '#f0fdf4',
    borderWidth: 1.5,
    borderColor: '#86efac',
  },
  featuredDirectionsText: {
    color: '#16a34a',
    fontSize: 15,
    fontWeight: '700',
  },
  // Modal directions button
  modalDirectionsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  modalDirectionsButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  // Location Fallback Modal Styles
  locationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  locationModalIconShell: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  locationModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  locationModalSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  locationCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  locationTextGroup: {
    flex: 1,
  },
  locationFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  locationFieldValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginTop: 2,
  },
  locationDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  openInMapsButton: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 10,
  },
  openInMapsButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  closeLocationModalBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  closeLocationModalBtnText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
});
