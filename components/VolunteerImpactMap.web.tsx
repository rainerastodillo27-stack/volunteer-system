import React, { useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Project } from '../models/types';
import {
  PHILIPPINES_BOUNDS,
  PHILIPPINES_WEB_CENTER,
  getMappedProjects,
  getProjectMarkerColor,
} from '../utils/projectMap';
import { getProjectDisplayStatus } from '../utils/projectStatus';
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

type MapAccountOption = {
  id: string;
  label: string;
  projectIds: string[];
};

type AvailableMapAccountOption = MapAccountOption & {
  mappedProjects: Project[];
  projectCount: number;
};

const MAP_STYLE_PRESETS: MapStylePreset[] = [
  {
    key: 'admin-overview',
    label: 'Admin overview',
    description: 'Shows all mapped projects and events across the system.',
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
    description: 'Choose a volunteer and inspect their mapped events.',
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
    key: 'partner-view',
    label: 'Partner view',
    description: 'Choose a partner and inspect their mapped project footprint.',
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

type VolunteerImpactMapProps = {
  projects: Project[];
  title?: string;
  subtitle?: string;
  initialMapStyleKey?: MapStylePresetKey;
  dashboardVariant?: boolean;
  volunteerAccounts?: MapAccountOption[];
  partnerAccounts?: MapAccountOption[];
  onVolunteerPress?: (volunteerId: string) => void;
  onPartnerPress?: (partnerId: string) => void;
};

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

function getGoogleMapsErrorMessage(apiKey: string) {
  const currentOrigin = getCurrentWebOrigin();

  if (!apiKey.trim()) {
    return 'Google Maps web key is missing. Add EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY to .env and restart the web app.';
  }

  return `Google Maps could not load for the impact map. Allow ${currentOrigin} in your Google Maps web key referrers and make sure the Maps JavaScript API is enabled.`;
}

function buildAvailableAccountOptions(
  accounts: MapAccountOption[],
  mappedProjects: Project[],
  includeEmptyAccounts = false
): AvailableMapAccountOption[] {
  const projectById = new Map(mappedProjects.map(project => [project.id, project]));

  return accounts
    .map(account => {
      const uniqueProjectIds = Array.from(new Set((account.projectIds || []).filter(Boolean)));
      const accountProjects = uniqueProjectIds
        .map(projectId => projectById.get(projectId))
        .filter((project): project is Project => Boolean(project));

      return {
        ...account,
        mappedProjects: accountProjects,
        projectCount: accountProjects.length,
      };
    })
    .filter(account => includeEmptyAccounts || account.projectCount > 0)
    .sort((left, right) => {
      const countRank = right.projectCount - left.projectCount;
      return countRank !== 0 ? countRank : left.label.localeCompare(right.label);
    });
}

function getMapEmptyStateMessage(
  selectedMapStyleKey: MapStylePresetKey,
  currentAccountOptions: AvailableMapAccountOption[],
  selectedAccountOption: AvailableMapAccountOption | null
) {
  if (selectedMapStyleKey === 'admin-overview') {
    return 'No mapped projects or events are available yet.';
  }

  const targetLabel = selectedMapStyleKey === 'volunteer-view' ? 'volunteer' : 'partner';
  const itemLabel = selectedMapStyleKey === 'volunteer-view' ? 'events' : 'projects';

  if (currentAccountOptions.length === 0) {
    return `No ${targetLabel} accounts with mapped ${itemLabel} are available yet.`;
  }

  if (!selectedAccountOption) {
    return `Pick a ${targetLabel} account to load its map.`;
  }

  return `No mapped ${itemLabel} were found for ${selectedAccountOption.label}.`;
}

function getAccountPickerLabel(
  selectedMapStyleKey: MapStylePresetKey,
  selectedAccountOption: AvailableMapAccountOption | null
) {
  if (selectedAccountOption) {
    return selectedAccountOption.label;
  }

  return selectedMapStyleKey === 'volunteer-view' ? 'Choose volunteer' : 'Choose partner';
}

function getAccountPickerTitle(selectedMapStyleKey: MapStylePresetKey) {
  return selectedMapStyleKey === 'volunteer-view' ? 'Choose volunteer' : 'Choose partner';
}

function getAccountIconName(selectedMapStyleKey: MapStylePresetKey): 'person-outline' | 'business' {
  return selectedMapStyleKey === 'volunteer-view' ? 'person-outline' : 'business';
}

function getMappedCountLabel(selectedMapStyleKey: MapStylePresetKey, count: number) {
  if (selectedMapStyleKey === 'volunteer-view') {
    return `${count} mapped ${count === 1 ? 'event' : 'events'}`;
  }

  return `${count} mapped ${count === 1 ? 'project' : 'projects'}`;
}

function getMapLegendTitle(selectedMapStyleKey: MapStylePresetKey) {
  return selectedMapStyleKey === 'volunteer-view' ? 'Event Status' : 'Project Status';
}

function getMapLegendTotalLabel(selectedMapStyleKey: MapStylePresetKey, count: number) {
  if (selectedMapStyleKey === 'volunteer-view') {
    return `Total ${count === 1 ? 'Event' : 'Events'}`;
  }

  return `Total ${count === 1 ? 'Project' : 'Projects'}`;
}

function getMapLegendFootnote(selectedMapStyleKey: MapStylePresetKey, selectedStatus: string | null) {
  if (selectedStatus) {
    return 'Clear filter';
  }

  return selectedMapStyleKey === 'volunteer-view' ? 'Volunteer events' : 'Across Philippines';
}

// Displays the project impact map using the Google Maps JavaScript API on web.
export default function VolunteerImpactMap({
  projects,
  title = 'Personal Impact Map',
  subtitle = 'Pinned places where you completed volunteer work.',
  initialMapStyleKey = 'volunteer-view',
  dashboardVariant = false,
  volunteerAccounts,
  partnerAccounts,
  onVolunteerPress,
  onPartnerPress,
}: VolunteerImpactMapProps) {
  const mappedProjects = useMemo(() => getMappedProjects(projects), [projects]);
  const mappedEvents = useMemo(
    () => mappedProjects.filter(project => project.isEvent),
    [mappedProjects]
  );
  const hasVolunteerScope = Array.isArray(volunteerAccounts);
  const hasPartnerScope = Array.isArray(partnerAccounts);
  const volunteerOptions = useMemo(
    () => buildAvailableAccountOptions(volunteerAccounts || [], mappedEvents, true),
    [volunteerAccounts, mappedEvents]
  );
  const partnerOptions = useMemo(
    () => buildAvailableAccountOptions(partnerAccounts || [], mappedProjects, true),
    [partnerAccounts, mappedProjects]
  );
  const [selectedProject, setSelectedProject] = useState<Project | null>(mappedProjects[0] || null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [showMapStyleMenu, setShowMapStyleMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedMapStyleKey, setSelectedMapStyleKey] =
    useState<MapStylePresetKey>(initialMapStyleKey);
  const [selectedVolunteerId, setSelectedVolunteerId] = useState<string | null>(
    volunteerOptions[0]?.id || null
  );
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    partnerOptions[0]?.id || null
  );
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRefs = useRef<Array<{ marker: any; listener: { remove: () => void } }>>([]);
  const infoWindowCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoWindowHoveringRef = useRef(false);
  const markerHoveringRef = useRef(false);
  const openInfoWindowProjectIdRef = useRef<string | null>(null);
  const webGoogleMapsApiKey = getWebGoogleMapsApiKey();
  const selectedMapStyle =
    MAP_STYLE_PRESETS.find(preset => preset.key === selectedMapStyleKey) || MAP_STYLE_PRESETS[1];

  useEffect(() => {
    setSelectedMapStyleKey(initialMapStyleKey);
  }, [initialMapStyleKey]);

  useEffect(() => {
    setSelectedVolunteerId(current =>
      current && volunteerOptions.some(option => option.id === current)
        ? current
        : volunteerOptions[0]?.id || null
    );
  }, [volunteerOptions]);

  useEffect(() => {
    setSelectedPartnerId(current =>
      current && partnerOptions.some(option => option.id === current)
        ? current
        : partnerOptions[0]?.id || null
    );
  }, [partnerOptions]);

  const currentAccountOptions =
    selectedMapStyleKey === 'volunteer-view'
      ? volunteerOptions
      : selectedMapStyleKey === 'partner-view'
      ? partnerOptions
      : [];

  const selectedAccountOption =
    selectedMapStyleKey === 'volunteer-view'
      ? volunteerOptions.find(option => option.id === selectedVolunteerId) || volunteerOptions[0] || null
      : selectedMapStyleKey === 'partner-view'
      ? partnerOptions.find(option => option.id === selectedPartnerId) || partnerOptions[0] || null
      : null;

  const scopedProjects =
    selectedMapStyleKey === 'admin-overview'
      ? mappedProjects
      : selectedMapStyleKey === 'volunteer-view'
      ? hasVolunteerScope
        ? selectedAccountOption?.mappedProjects || []
        : mappedEvents
      : hasPartnerScope
      ? selectedAccountOption?.mappedProjects || []
      : mappedProjects;
  const displayProjects = selectedStatus
    ? scopedProjects.filter(project => {
        const status = getProjectDisplayStatus(project);
        return selectedStatus === 'Planned' ? status === 'Planning' : status === selectedStatus;
      })
    : scopedProjects;

  useEffect(() => {
    setSelectedProject(displayProjects[0] || null);
  }, [displayProjects]);

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

        if (displayProjects.length === 0) {
          map.setCenter(PHILIPPINES_WEB_CENTER);
          map.setZoom(6);
          return;
        }

        const bounds = new googleMaps.maps.LatLngBounds();
        const infoWindow = new googleMaps.maps.InfoWindow();

        displayProjects.forEach(project => {
          const markerVolunteerHits = (volunteerAccounts || [])
            .filter(account => (account.projectIds || []).includes(project.id));
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
              markerVolunteerHits.length
            ),
          });

          const listener = marker.addListener('click', () => {
            setSelectedProject(project);
          });

          const hoverOpenListener = marker.addListener('mouseover', () => {
            if (infoWindowCloseTimerRef.current) {
              clearTimeout(infoWindowCloseTimerRef.current);
              infoWindowCloseTimerRef.current = null;
            }
            markerHoveringRef.current = true;
            if (openInfoWindowProjectIdRef.current === project.id) {
              return;
            }
            const volunteerHits = (volunteerAccounts || [])
              .filter(account => (account.projectIds || []).includes(project.id))
              .sort((a, b) => a.label.localeCompare(b.label));
            const partnerHits = (partnerAccounts || [])
              .filter(account => (account.projectIds || []).includes(project.id))
              .filter(account => account.id !== 'partner-unassigned')
              .sort((a, b) => a.label.localeCompare(b.label));

            const container = document.createElement('div');
            container.style.minWidth = '220px';
            container.style.maxWidth = '280px';
            container.style.fontFamily = 'DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
            container.style.fontSize = '12px';
            container.style.lineHeight = '16px';

            const titleDiv = document.createElement('div');
            titleDiv.style.fontWeight = '700';
            titleDiv.style.color = '#0f172a';
            titleDiv.style.marginBottom = '4px';
            titleDiv.textContent = project.title;
            container.appendChild(titleDiv);

            const typeDiv = document.createElement('div');
            typeDiv.style.fontWeight = '700';
            typeDiv.style.color = '#475569';
            typeDiv.style.marginBottom = '6px';
            typeDiv.textContent = project.isEvent ? 'Event' : 'Project';
            container.appendChild(typeDiv);

            if (partnerHits.length > 0) {
              const partner = partnerHits[0];
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
              partnerRow.style.cursor = onPartnerPress ? 'pointer' : 'default';
              partnerRow.innerHTML = `<span style="font-weight:600;color:#0f766e;">Partner:</span> <span style="color:#0f172a;text-decoration:${onPartnerPress ? 'underline' : 'none'};">${partner.label}</span>`;
              container.appendChild(partnerRow);
            }

            const volunteerHeader = document.createElement('div');
            volunteerHeader.style.marginTop = partnerHits.length ? '6px' : '0';
            volunteerHeader.style.fontWeight = '600';
            volunteerHeader.style.color = '#166534';
            volunteerHeader.textContent = `Volunteers (${volunteerHits.length})`;
            container.appendChild(volunteerHeader);

            if (volunteerHits.length === 0) {
              const empty = document.createElement('div');
              empty.style.color = '#64748b';
              empty.style.paddingTop = '4px';
              empty.textContent = 'No volunteers joined yet.';
              container.appendChild(empty);
            } else {
              volunteerHits.slice(0, 8).forEach(volunteer => {
                const row = document.createElement('button');
                row.type = 'button';
                row.dataset.kind = 'volunteer';
                row.dataset.id = volunteer.id;
                row.style.display = 'block';
                row.style.width = '100%';
                row.style.textAlign = 'left';
                row.style.border = '0';
                row.style.background = 'transparent';
                row.style.padding = '5px 0';
                row.style.cursor = onVolunteerPress ? 'pointer' : 'default';
                row.style.color = '#0f172a';
                row.style.textDecoration = onVolunteerPress ? 'underline' : 'none';
                row.textContent = volunteer.label;
                container.appendChild(row);
              });
              if (volunteerHits.length > 8) {
                const more = document.createElement('div');
                more.style.color = '#64748b';
                more.style.paddingTop = '4px';
                more.textContent = `+${volunteerHits.length - 8} more`;
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
                onVolunteerPress?.(id);
              } else if (kind === 'partner') {
                onPartnerPress?.(id);
              }
              infoWindow.close();
            });

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
                infoWindow.close();
                openInfoWindowProjectIdRef.current = null;
              }, 200);
            });

            infoWindow.setContent(container);
            infoWindow.open({ map, anchor: marker });
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
              infoWindow.close();
              openInfoWindowProjectIdRef.current = null;
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

        if (displayProjects.length === 1) {
          map.setCenter({
            lat: displayProjects[0].location.latitude,
            lng: displayProjects[0].location.longitude,
          });
          map.setZoom(6);
          return;
        }

        map.fitBounds(bounds, 56);
        const currentZoom = map.getZoom();
        if (typeof currentZoom === 'number' && currentZoom > 7) {
          map.setZoom(7);
        }
      } catch {
        if (!cancelled) {
          clearMarkers();
          setMapError(getGoogleMapsErrorMessage(webGoogleMapsApiKey));
        }
      }
    };

    void renderMap();

    return () => {
      cancelled = true;
      clearMarkers();
    };
  }, [
    displayProjects,
    selectedMapStyle.mapTypeId,
    webGoogleMapsApiKey,
    volunteerAccounts,
    partnerAccounts,
    onVolunteerPress,
    onPartnerPress,
  ]);

  const hasAnyMapData =
    mappedProjects.length > 0 || volunteerOptions.length > 0 || partnerOptions.length > 0;

  if (!hasAnyMapData) {
    return null;
  }

  const emptyStateMessage = getMapEmptyStateMessage(
    selectedMapStyleKey,
    currentAccountOptions,
    selectedAccountOption
  );
  const showAccountPicker = selectedMapStyleKey !== 'admin-overview' && currentAccountOptions.length > 0;
  const selectedAccountLabel = getAccountPickerLabel(selectedMapStyleKey, selectedAccountOption);
  const accountPickerTitle = getAccountPickerTitle(selectedMapStyleKey);
  const accountIconName = getAccountIconName(selectedMapStyleKey);

  const statusLegend = [
    { label: 'In Progress', color: '#5b9b57' }, { label: 'Planned', color: '#5f8fdc' },
    { label: 'Completed', color: '#8e58d6' }, { label: 'On Hold', color: '#e7a23d' },
    { label: 'Cancelled', color: '#b95258' },
  ];

  return (
    <View style={styles.section}>
      {dashboardVariant ? (
        <View style={styles.dashboardTabs}>
          <TouchableOpacity
            style={[
              styles.dashboardTab,
              selectedMapStyleKey === 'partner-view' && styles.dashboardTabActive,
            ]}
            onPress={() => setSelectedMapStyleKey('partner-view')}
          >
            <MaterialIcons
              name="handshake"
              size={27}
              color={selectedMapStyleKey === 'partner-view' ? '#5a8f52' : '#64748b'}
            />
            <Text
              style={[
                styles.dashboardTabText,
                selectedMapStyleKey === 'partner-view' && styles.dashboardTabTextActive,
              ]}
            >
              Partner
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.dashboardTab,
              selectedMapStyleKey === 'volunteer-view' && styles.dashboardTabActive,
            ]}
            onPress={() => setSelectedMapStyleKey('volunteer-view')}
          >
            <MaterialIcons
              name="group"
              size={27}
              color={selectedMapStyleKey === 'volunteer-view' ? '#5a8f52' : '#64748b'}
            />
            <Text
              style={[
                styles.dashboardTabText,
                selectedMapStyleKey === 'volunteer-view' && styles.dashboardTabTextActive,
              ]}
            >
              Volunteer
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.dashboardTab,
              selectedMapStyleKey === 'admin-overview' && styles.dashboardTabActive,
            ]}
            onPress={() => setSelectedMapStyleKey('admin-overview')}
          >
            <MaterialIcons
              name="event"
              size={27}
              color={selectedMapStyleKey === 'admin-overview' ? '#5a8f52' : '#64748b'}
            />
            <Text
              style={[
                styles.dashboardTabText,
                selectedMapStyleKey === 'admin-overview' && styles.dashboardTabTextActive,
              ]}
            >
              Events
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={[styles.headerRow, dashboardVariant && styles.dashboardHeaderRow]}>
        <View style={[styles.headerIdentity, dashboardVariant && styles.dashboardHeaderIdentity]}>
          <View
            style={[
              styles.headerIcon,
              dashboardVariant && styles.dashboardHeaderIcon,
              {
                backgroundColor: dashboardVariant ? '#f2f8f1' : selectedMapStyle.chipBg,
                borderColor: dashboardVariant ? '#f2f8f1' : selectedMapStyle.chipBorder,
              },
            ]}
          >
            <MaterialIcons name="place" size={dashboardVariant ? 30 : 18} color={dashboardVariant ? '#5a8f52' : selectedMapStyle.accentColor} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, dashboardVariant && styles.dashboardTitle]}>{title}</Text>
            <Text style={[styles.subtitle, dashboardVariant && styles.dashboardSubtitle]}>{subtitle}</Text>
          </View>
        </View>

        <View style={[styles.headerActions, dashboardVariant && styles.dashboardHeaderActions]}>
          {!dashboardVariant && showAccountPicker ? (
            <TouchableOpacity
              style={[
                styles.mapStyleButton,
                styles.accountPickerButton,
                {
                  backgroundColor: selectedMapStyle.chipBg,
                  borderColor: selectedMapStyle.chipBorder,
                },
              ]}
              onPress={() => setShowAccountMenu(true)}
            >
              <MaterialIcons name={accountIconName} size={18} color={selectedMapStyle.accentColor} />
              <Text
                style={[styles.mapStyleButtonText, styles.accountPickerText, { color: selectedMapStyle.accentColor }]}
                numberOfLines={1}
              >
                {selectedAccountLabel}
              </Text>
              <MaterialIcons
                name="keyboard-arrow-down"
                size={22}
                color={selectedMapStyle.accentColor}
              />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[
              styles.mapStyleButton,
              dashboardVariant && styles.dashboardViewButton,
              {
                backgroundColor: dashboardVariant ? '#ffffff' : selectedMapStyle.chipBg,
                borderColor: dashboardVariant ? '#e2e8f0' : selectedMapStyle.chipBorder,
              },
            ]}
            onPress={() => setShowMapStyleMenu(true)}
          >
            <MaterialIcons name="tune" size={dashboardVariant ? 27 : 18} color={dashboardVariant ? '#5a8f52' : selectedMapStyle.accentColor} />
            <Text style={[styles.mapStyleButtonText, dashboardVariant && styles.dashboardViewButtonText, { color: dashboardVariant ? '#334155' : selectedMapStyle.accentColor }]}>
              {selectedMapStyle.label}
            </Text>
            <MaterialIcons name="keyboard-arrow-down" size={22} color={dashboardVariant ? '#334155' : selectedMapStyle.accentColor} />
          </TouchableOpacity>
        </View>
      </View>

      <View
        style={[
          styles.mapShell,
          dashboardVariant && styles.dashboardMapShell,
          {
            backgroundColor: selectedMapStyle.shellBg,
            borderColor: selectedMapStyle.shellBorder,
          },
        ]}
      >
        <MapHost ref={mapElementRef} style={styles.mapHost} />
        {dashboardVariant ? (
          <View style={styles.mapLegend}>
            <Text style={styles.legendTitle}>{getMapLegendTitle(selectedMapStyleKey)}</Text>
            {statusLegend.map(status => <TouchableOpacity key={status.label} style={[styles.legendRow, selectedStatus === status.label && styles.legendRowActive]} onPress={() => setSelectedStatus(current => current === status.label ? null : status.label)}>
              <MaterialIcons name="location-on" size={16} color={status.color} />
              <Text style={styles.legendLabel}>{status.label}</Text>
              {selectedStatus === status.label ? <MaterialIcons name="check" size={14} color={status.color} /> : null}
            </TouchableOpacity>)}
            <View style={styles.legendDivider} />
            <Text style={styles.legendTotalLabel}>
              {getMapLegendTotalLabel(selectedMapStyleKey, displayProjects.length)}
            </Text>
            <Text style={styles.legendTotal}>{displayProjects.length}</Text>
            <TouchableOpacity onPress={() => setSelectedStatus(null)}>
              <Text style={styles.legendFootnote}>
                {getMapLegendFootnote(selectedMapStyleKey, selectedStatus)}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {mapError ? (
          <View style={[styles.errorOverlay, { backgroundColor: selectedMapStyle.errorBg }]}>
            <View style={[styles.errorCard, { borderColor: selectedMapStyle.errorBorder }]}>
              <Text style={styles.errorTitle}>Google Maps unavailable</Text>
              <Text style={styles.errorText}>{mapError}</Text>
            </View>
          </View>
        ) : null}
        {!mapError && displayProjects.length === 0 ? (
          <View style={[styles.errorOverlay, { backgroundColor: selectedMapStyle.errorBg }]}>
            <View style={[styles.errorCard, { borderColor: selectedMapStyle.errorBorder }]}>
              <Text style={styles.errorTitle}>No map data to show</Text>
              <Text style={styles.errorText}>{emptyStateMessage}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {selectedProject ? (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedProject.title}</Text>
          <Text style={styles.detailMeta}>
            {`${selectedProject.isEvent ? 'Event' : 'Project'} | ${selectedProject.category} | ${getProjectDisplayStatus(selectedProject)}`}
          </Text>
          <Text style={styles.detailAddress}>{selectedProject.location.address}</Text>
        </View>
      ) : null}

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
            <Text style={styles.mapStyleMenuTitle}>Choose map mode</Text>
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
        visible={showAccountMenu}
        onRequestClose={() => setShowAccountMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setShowAccountMenu(false)}
        >
          <View style={styles.mapStyleMenu}>
            <Text style={styles.mapStyleMenuTitle}>{accountPickerTitle}</Text>
            <ScrollView style={styles.accountList} showsVerticalScrollIndicator={false}>
              {currentAccountOptions.map(option => {
                const isActive = option.id === selectedAccountOption?.id;

                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[styles.mapStyleMenuItem, isActive && styles.mapStyleMenuItemActive]}
                    onPress={() => {
                      if (selectedMapStyleKey === 'volunteer-view') {
                        setSelectedVolunteerId(option.id);
                      } else {
                        setSelectedPartnerId(option.id);
                      }
                      setShowAccountMenu(false);
                    }}
                  >
                    <View style={styles.mapStyleMenuItemTextWrap}>
                      <Text style={styles.mapStyleMenuItemTitle}>{option.label}</Text>
                      <Text style={styles.mapStyleMenuItemDescription}>
                        {getMappedCountLabel(selectedMapStyleKey, option.projectCount)}
                      </Text>
                    </View>
                    {isActive ? <MaterialIcons name="check" size={20} color="#2563eb" /> : null}
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
  section: {
    width: '100%',
    marginBottom: 20,
  },
  dashboardMapShell: {
    height: 490,
    borderWidth: 0,
    borderRadius: 20,
  },
  dashboardTabs: { flexDirection: 'row', height: 68, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 15, overflow: 'hidden' },
  dashboardTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 13, backgroundColor: '#ffffff', borderRightWidth: 1, borderRightColor: '#e2e8f0' },
  dashboardTabActive: { backgroundColor: '#f5faf4', borderBottomWidth: 3, borderBottomColor: '#5a8f52' },
  dashboardTabText: { fontSize: 17, fontWeight: '800', color: '#1e293b' },
  dashboardTabTextActive: { color: '#5a8f52' },
  dashboardHeaderRow: { display: 'none' },
  dashboardHeaderIdentity: { display: 'none' },
  dashboardHeaderActions: { maxWidth: '100%', justifyContent: 'flex-start', gap: 20 },
  workspaceButton: { flexDirection: 'row', alignItems: 'center', gap: 17, paddingHorizontal: 24, paddingVertical: 17, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, backgroundColor: '#ffffff' },
  workspaceButtonText: { fontSize: 17, fontWeight: '700', color: '#1e293b' },
  dashboardViewButton: { borderRadius: 14, paddingHorizontal: 22, paddingVertical: 17 },
  dashboardViewButtonText: { fontSize: 17, fontWeight: '700' },
  dashboardHeaderIcon: { width: 76, height: 76, borderRadius: 38 },
  dashboardTitle: { fontSize: 25 },
  dashboardSubtitle: { fontSize: 17 },
  mapLegend: {
    position: 'absolute', top: 12, left: 12, width: 136, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.97)', shadowColor: '#0f172a',
    shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  legendTitle: { fontSize: 12, fontWeight: '800', color: '#1e293b', marginBottom: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  legendRowActive: { backgroundColor: '#f0f8ef', borderRadius: 6, paddingHorizontal: 4 },
  legendLabel: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  legendDivider: { height: 1, backgroundColor: '#e2e8f0', marginHorizontal: -12, marginTop: 4, marginBottom: 6 },
  legendTotalLabel: { fontSize: 11, fontWeight: '800', color: '#334155' },
  legendTotal: { color: '#5a8f52', fontSize: 20, fontWeight: '800', marginTop: 2 },
  legendFootnote: { fontSize: 10, color: '#64748b', fontWeight: '600', marginTop: 2 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  headerIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
    maxWidth: '58%',
  },
  mapStyleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  accountPickerButton: {
    maxWidth: 220,
  },
  accountPickerText: {
    flexShrink: 1,
  },
  mapStyleButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 3,
  },
  mapShell: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d8e8db',
    backgroundColor: '#ffffff',
    height: 300,
  },
  mapHost: {
    width: '100%',
    height: '100%',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 246, 255, 0.92)',
    paddingHorizontal: 24,
  },
  errorCard: {
    maxWidth: 380,
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#12243d',
    textAlign: 'center',
    marginBottom: 10,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
    textAlign: 'center',
  },
  detailCard: {
    marginTop: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d8e8db',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  detailTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  detailAddress: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
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
    width: 310,
    maxHeight: 420,
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
  accountList: {
    maxHeight: 320,
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
