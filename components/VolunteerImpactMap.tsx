import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import MapView, { Callout, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}
import PhotoMapMarker from './PhotoMapMarker';
import { Project } from '../models/types';
import {
  PHILIPPINES_REGION,
  getInitialProjectRegion,
  getProjectMarkerColor,
} from '../utils/projectMap';

type AccountOption = {
  id: string;
  label: string;
  projectIds: string[];
};

type MapMarkerProps = {
  project: Project;
  onPress: (project: Project) => void;
  partnerAccounts?: AccountOption[];
  volunteerAccounts?: AccountOption[];
  onPartnerPress?: (partnerId: string) => void;
  onVolunteerPress?: (volunteerId: string) => void;
};

type MapContentProps = {
  displayProjects: Project[];
  mapRegion: Region;
  nativeMapType: any;
  onSelectProject: (project: Project) => void;
  partnerAccounts?: AccountOption[];
  volunteerAccounts?: AccountOption[];
  onPartnerPress?: (partnerId: string) => void;
  onVolunteerPress?: (volunteerId: string) => void;
};

const MapContent = React.memo<MapContentProps>(
  ({ displayProjects, mapRegion, nativeMapType, onSelectProject, partnerAccounts, volunteerAccounts, onPartnerPress, onVolunteerPress }) => (
    <MapView
      style={styles.map}
      initialRegion={displayProjects.length ? mapRegion : PHILIPPINES_REGION}
      provider={getPlatformOS() === 'android' ? PROVIDER_GOOGLE : undefined}
      showsCompass
      scrollEnabled
      zoomEnabled
      rotateEnabled={false}
      mapType={nativeMapType}
    >
      {displayProjects.map(project => (
        <MapMarker
          key={project.id}
          project={project}
          onPress={onSelectProject}
          partnerAccounts={partnerAccounts}
          volunteerAccounts={volunteerAccounts}
          onPartnerPress={onPartnerPress}
          onVolunteerPress={onVolunteerPress}
        />
      ))}
    </MapView>
  ),
  (prevProps, nextProps) => {
    // Deep equality check for memoization
    if (prevProps.displayProjects.length !== nextProps.displayProjects.length) return false;
    if (prevProps.displayProjects.some((p, i) => p.id !== nextProps.displayProjects[i]?.id)) return false;
    if (prevProps.nativeMapType !== nextProps.nativeMapType) return false;
    if (prevProps.mapRegion.latitude !== nextProps.mapRegion.latitude) return false;
    if (prevProps.mapRegion.longitude !== nextProps.mapRegion.longitude) return false;
    if (prevProps.mapRegion.latitudeDelta !== nextProps.mapRegion.latitudeDelta) return false;
    if (prevProps.mapRegion.longitudeDelta !== nextProps.mapRegion.longitudeDelta) return false;
    return true;
  }
);

MapContent.displayName = 'MapContent';

const MapMarker = React.memo<MapMarkerProps>(
  ({
    project,
    onPress,
    partnerAccounts,
    volunteerAccounts,
    onPartnerPress,
    onVolunteerPress,
  }) => {
    const partnerHit = useMemo(() => 
      (partnerAccounts || []).find(account => (account.projectIds || []).includes(project.id)),
      [partnerAccounts, project.id]
    );

    const volunteerHits = useMemo(() => 
      (volunteerAccounts || [])
        .filter(account => (account.projectIds || []).includes(project.id))
        .sort((a, b) => a.label.localeCompare(b.label)),
      [volunteerAccounts, project.id]
    );

  return (
    <Marker
      coordinate={{
        latitude: project.location.latitude,
        longitude: project.location.longitude,
      }}
      anchor={{ x: 0.5, y: 1 }}
      title={project.title}
      description={project.location.address}
      onPress={() => onPress(project)}
    >
      <PhotoMapMarker accentColor={getProjectMarkerColor(project)} />
      <Callout tooltip>
        <View style={styles.calloutCard}>
          <Text style={styles.calloutTitle} numberOfLines={2}>
            {project.title}
          </Text>

          {partnerHit && (
            <TouchableOpacity
              disabled={!onPartnerPress}
              onPress={() => onPartnerPress?.(partnerHit.id)}
              style={styles.calloutRow}
            >
              <MaterialIcons name="business" size={16} color="#0f766e" />
              <Text style={styles.calloutRowText} numberOfLines={1}>
                {partnerHit.label}
              </Text>
            </TouchableOpacity>
          )}

          <Text style={styles.calloutSectionLabel}>
            Volunteers
          </Text>
          {volunteerHits.length === 0 ? (
            <Text style={styles.calloutEmpty}>
              No volunteers joined yet.
            </Text>
          ) : (
            volunteerHits.slice(0, 6).map(volunteer => (
              <TouchableOpacity
                key={volunteer.id}
                disabled={!onVolunteerPress}
                onPress={() => onVolunteerPress?.(volunteer.id)}
                style={styles.calloutRow}
              >
                <MaterialIcons name="person-outline" size={16} color="#166534" />
                <Text style={styles.calloutRowText} numberOfLines={1}>
                  {volunteer.label}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </Callout>
    </Marker>
  );
}, (prevProps, nextProps) => {
  // Custom equality check for memo - return true if props are equal (skip re-render)
  // Only compare project data - this is what matters for rendering the marker
  if (prevProps.project.id !== nextProps.project.id) return false;
  if (prevProps.project.location.latitude !== nextProps.project.location.latitude) return false;
  if (prevProps.project.location.longitude !== nextProps.project.location.longitude) return false;
  if (prevProps.project.title !== nextProps.project.title) return false;
  if (prevProps.project.description !== nextProps.project.description) return false;
  if (prevProps.project.location.address !== nextProps.project.location.address) return false;
  
  return true; // Project data hasn't changed, skip re-render
});


type MapStylePresetKey = 'admin-overview' | 'volunteer-view' | 'partner-view';

type MapStylePreset = {
  key: MapStylePresetKey;
  label: string;
  description: string;
  mapType: 'standard' | 'terrain' | 'hybrid';
  accentColor: string;
  chipBg: string;
  chipBorder: string;
  shellBg: string;
  shellBorder: string;
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
    description: 'Shows all mapped projects across the system.',
    mapType: 'standard',
    accentColor: '#1d4ed8',
    chipBg: '#eff6ff',
    chipBorder: '#bfdbfe',
    shellBg: '#dbeafe',
    shellBorder: '#bfdbfe',
  },
  {
    key: 'volunteer-view',
    label: 'Volunteer view',
    description: 'Choose a volunteer and inspect their mapped completed work.',
    mapType: 'standard',
    accentColor: '#1d4ed8',
    chipBg: '#eff6ff',
    chipBorder: '#bfdbfe',
    shellBg: '#dbeafe',
    shellBorder: '#bfdbfe',
  },
  {
    key: 'partner-view',
    label: 'Partner view',
    description: 'Choose a partner and inspect their mapped project footprint.',
    mapType: 'hybrid',
    accentColor: '#0f766e',
    chipBg: '#ecfeff',
    chipBorder: '#a5f3fc',
    shellBg: '#e0f2fe',
    shellBorder: '#bae6fd',
  },
];

type VolunteerImpactMapProps = {
  projects: Project[];
  title?: string;
  subtitle?: string;
  initialMapStyleKey?: MapStylePresetKey;
  volunteerAccounts?: MapAccountOption[];
  partnerAccounts?: MapAccountOption[];
  onVolunteerPress?: (volunteerId: string) => void;
  onPartnerPress?: (partnerId: string) => void;
};

function getMappedProjects(projects: Project[]) {
  return projects.filter(
    project =>
      Number.isFinite(project.location?.latitude) &&
      Number.isFinite(project.location?.longitude)
  );
}

function buildAvailableAccountOptions(
  accounts: MapAccountOption[],
  mappedProjects: Project[]
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
    .filter(account => account.projectCount > 0)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function getMapEmptyStateMessage(
  selectedMapStyleKey: MapStylePresetKey,
  currentAccountOptions: AvailableMapAccountOption[],
  selectedAccountOption: AvailableMapAccountOption | null
) {
  if (selectedMapStyleKey === 'admin-overview') {
    return 'No mapped projects are available yet.';
  }

  const targetLabel = selectedMapStyleKey === 'volunteer-view' ? 'volunteer' : 'partner';

  if (currentAccountOptions.length === 0) {
    return `No ${targetLabel} accounts with mapped projects are available yet.`;
  }

  if (!selectedAccountOption) {
    return `Pick a ${targetLabel} account to load its map.`;
  }

  return `No mapped projects were found for ${selectedAccountOption.label}.`;
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

function getNativeMapType(selectedMapStyle: MapStylePreset) {
  if (getPlatformOS() === 'ios' && selectedMapStyle.mapType === 'terrain') {
    return 'standard';
  }

  return selectedMapStyle.mapType;
}

// Displays a native map of projects and supports admin, volunteer, and partner views.
export default function VolunteerImpactMap({
  projects,
  title = 'Personal Impact Map',
  subtitle = 'Pinned places where you completed volunteer work.',
  initialMapStyleKey = 'volunteer-view',
  volunteerAccounts,
  partnerAccounts,
  onVolunteerPress,
  onPartnerPress,
}: VolunteerImpactMapProps) {
  const mappedProjects = useMemo(() => getMappedProjects(projects), [projects]);
  const hasVolunteerScope = Array.isArray(volunteerAccounts);
  const hasPartnerScope = Array.isArray(partnerAccounts);
  const volunteerOptions = useMemo(
    () => buildAvailableAccountOptions(volunteerAccounts || [], mappedProjects),
    [volunteerAccounts, mappedProjects]
  );
  const partnerOptions = useMemo(
    () => buildAvailableAccountOptions(partnerAccounts || [], mappedProjects),
    [partnerAccounts, mappedProjects]
  );
  const [selectedProject, setSelectedProject] = useState<Project | null>(mappedProjects[0] || null);
  const [showMapStyleMenu, setShowMapStyleMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [selectedMapStyleKey, setSelectedMapStyleKey] =
    useState<MapStylePresetKey>(initialMapStyleKey);
  const [selectedVolunteerId, setSelectedVolunteerId] = useState<string | null>(
    volunteerOptions[0]?.id || null
  );
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    partnerOptions[0]?.id || null
  );

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

  const selectedMapStyle =
    MAP_STYLE_PRESETS.find(preset => preset.key === selectedMapStyleKey) || MAP_STYLE_PRESETS[1];
  const currentAccountOptions =
    selectedMapStyleKey === 'volunteer-view'
      ? volunteerOptions
      : selectedMapStyleKey === 'partner-view'
      ? partnerOptions
      : [];
  const selectedAccountOption = useMemo(() =>
    selectedMapStyleKey === 'volunteer-view'
      ? volunteerOptions.find(option => option.id === selectedVolunteerId) || volunteerOptions[0] || null
      : selectedMapStyleKey === 'partner-view'
      ? partnerOptions.find(option => option.id === selectedPartnerId) || partnerOptions[0] || null
      : null,
    [selectedMapStyleKey, selectedVolunteerId, selectedPartnerId, volunteerOptions, partnerOptions]
  );
  const displayProjects = useMemo(() => {
    if (selectedMapStyleKey === 'admin-overview') {
      return mappedProjects;
    }

    if (selectedMapStyleKey === 'volunteer-view') {
      if (hasVolunteerScope) {
        const selectedVolunteer = volunteerOptions.find(option => option.id === selectedVolunteerId);
        return selectedVolunteer?.mappedProjects || [];
      }
      return mappedProjects;
    }

    if (selectedMapStyleKey === 'partner-view') {
      if (hasPartnerScope) {
        const selectedPartner = partnerOptions.find(option => option.id === selectedPartnerId);
        return selectedPartner?.mappedProjects || [];
      }
      return mappedProjects;
    }

    return mappedProjects;
  }, [selectedMapStyleKey, hasVolunteerScope, hasPartnerScope, selectedVolunteerId, selectedPartnerId, volunteerOptions, partnerOptions, mappedProjects]);
  const hasAnyMapData =
    mappedProjects.length > 0 || volunteerOptions.length > 0 || partnerOptions.length > 0;

  useEffect(() => {
    setSelectedProject(displayProjects[0] || null);
  }, [displayProjects]);

  // Memoize callbacks to prevent unnecessary re-renders of child components
  const handleSelectProject = useCallback((project: Project) => {
    setSelectedProject(project);
  }, []);

  const handlePartnerPress = useCallback((partnerId: string) => {
    onPartnerPress?.(partnerId);
  }, [onPartnerPress]);

  const handleVolunteerPress = useCallback((volunteerId: string) => {
    onVolunteerPress?.(volunteerId);
  }, [onVolunteerPress]);

  if (!hasAnyMapData) {
    return null;
  }

  const showAccountPicker = selectedMapStyleKey !== 'admin-overview' && currentAccountOptions.length > 0;
  const selectedAccountLabel = getAccountPickerLabel(selectedMapStyleKey, selectedAccountOption);
  const accountPickerTitle = getAccountPickerTitle(selectedMapStyleKey);
  const accountIconName = getAccountIconName(selectedMapStyleKey);
  const emptyStateMessage = getMapEmptyStateMessage(
    selectedMapStyleKey,
    currentAccountOptions,
    selectedAccountOption
  );
  const nativeMapType = getNativeMapType(selectedMapStyle);
  const mapRegion = useMemo(() => getInitialProjectRegion(displayProjects) as Region, [displayProjects]);

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.headerIdentity}>
          <View style={styles.headerIcon}>
            <MaterialIcons name="place" size={18} color={selectedMapStyle.accentColor} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          {showAccountPicker ? (
            <TouchableOpacity
              style={[
                styles.controlButton,
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
                style={[styles.controlButtonText, styles.accountPickerText, { color: selectedMapStyle.accentColor }]}
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
              styles.controlButton,
              {
                backgroundColor: selectedMapStyle.chipBg,
                borderColor: selectedMapStyle.chipBorder,
              },
            ]}
            onPress={() => setShowMapStyleMenu(true)}
          >
            <MaterialIcons name="tune" size={18} color={selectedMapStyle.accentColor} />
            <Text style={[styles.controlButtonText, { color: selectedMapStyle.accentColor }]}>
              {selectedMapStyle.label}
            </Text>
            <MaterialIcons name="keyboard-arrow-down" size={22} color={selectedMapStyle.accentColor} />
          </TouchableOpacity>
        </View>
      </View>

      <View
        style={[
          styles.mapShell,
          {
            backgroundColor: selectedMapStyle.shellBg,
            borderColor: selectedMapStyle.shellBorder,
          },
        ]}
      >
        <MapContent
          displayProjects={displayProjects}
          mapRegion={mapRegion}
          nativeMapType={nativeMapType}
          onSelectProject={handleSelectProject}
          partnerAccounts={partnerAccounts}
          volunteerAccounts={volunteerAccounts}
          onPartnerPress={handlePartnerPress}
          onVolunteerPress={handleVolunteerPress}
        />

        {displayProjects.length === 0 ? (
          <View style={styles.emptyOverlay}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No map data to show</Text>
              <Text style={styles.emptyText}>{emptyStateMessage}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {selectedAccountOption ? (
        <View style={styles.selectionSummary}>
          <Text style={styles.selectionSummaryTitle}>{selectedAccountOption.label}</Text>
          <Text style={styles.selectionSummaryText}>
            {selectedAccountOption.projectCount} mapped
            {selectedAccountOption.projectCount === 1 ? ' project' : ' projects'}
          </Text>
        </View>
      ) : null}

      {selectedProject ? (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedProject.title}</Text>
          <Text style={styles.detailMeta}>
            {`${selectedProject.isEvent ? 'Event' : 'Program'} | ${selectedProject.category}`}
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
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>Choose map mode</Text>
            <ScrollView style={styles.menuList} showsVerticalScrollIndicator={false}>
              {MAP_STYLE_PRESETS.map(preset => {
                const isActive = preset.key === selectedMapStyleKey;

                return (
                  <TouchableOpacity
                    key={preset.key}
                    style={[styles.menuItem, isActive && styles.menuItemActive]}
                    onPress={() => {
                      setSelectedMapStyleKey(preset.key);
                      setShowMapStyleMenu(false);
                    }}
                  >
                    <View style={styles.menuItemTextWrap}>
                      <Text style={styles.menuItemTitle}>{preset.label}</Text>
                      <Text style={styles.menuItemDescription}>{preset.description}</Text>
                    </View>
                    {isActive ? <MaterialIcons name="check" size={20} color="#2563eb" /> : null}
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
        visible={showAccountMenu}
        onRequestClose={() => setShowAccountMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setShowAccountMenu(false)}
        >
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>{accountPickerTitle}</Text>
            <ScrollView style={styles.menuList} showsVerticalScrollIndicator={false}>
              {currentAccountOptions.map(option => {
                const isActive = option.id === selectedAccountOption?.id;

                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[styles.menuItem, isActive && styles.menuItemActive]}
                    onPress={() => {
                      if (selectedMapStyleKey === 'volunteer-view') {
                        setSelectedVolunteerId(option.id);
                      } else {
                        setSelectedPartnerId(option.id);
                      }
                      setShowAccountMenu(false);
                    }}
                  >
                    <View style={styles.menuItemTextWrap}>
                      <Text style={styles.menuItemTitle}>{option.label}</Text>
                      <Text style={styles.menuItemDescription}>
                        {option.projectCount} mapped
                        {option.projectCount === 1 ? ' project' : ' projects'}
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
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    maxWidth: '52%',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  controlButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  accountPickerButton: {
    maxWidth: 220,
  },
  accountPickerText: {
    flexShrink: 1,
  },
  mapShell: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#e0f2fe',
    position: 'relative',
  },
  calloutCard: {
    width: 240,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  calloutTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  calloutSectionLabel: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  calloutRowText: {
    flex: 1,
    fontSize: 12,
    color: '#0f172a',
  },
  calloutEmpty: {
    fontSize: 12,
    color: '#64748b',
    paddingVertical: 4,
  },
  map: {
    height: 280,
    width: '100%',
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(248, 250, 252, 0.72)',
  },
  emptyCard: {
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
    textAlign: 'center',
  },
  selectionSummary: {
    marginTop: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  selectionSummaryTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  selectionSummaryText: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  detailCard: {
    marginTop: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  detailTitle: {
    fontSize: 14,
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
    color: '#475569',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  menuCard: {
    maxHeight: '72%',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  menuList: {
    maxHeight: 340,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  menuItemActive: {
    backgroundColor: '#eff6ff',
  },
  menuItemTextWrap: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  menuItemDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: '#64748b',
  },
});
