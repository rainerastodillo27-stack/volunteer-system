import React, { useEffect, useState } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
  type ImageStyle,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import MapView, { Callout, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import InlineLoadError from '../components/InlineLoadError';
import PhotoMapMarker from '../components/PhotoMapMarker';
import { useAuth } from '../contexts/AuthContext';
import { Partner, PartnerReport, Project, Volunteer, VolunteerProjectJoinRecord } from '../models/types';
import {
  getAllPartners,
  getAllPartnerReports,
  getAllVolunteers,
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { getPrimaryReportMediaUri } from '../utils/media';
import { navigateToAvailableRoute } from '../utils/navigation';
import { withImpactMapFallbackProjects } from '../utils/impactMapFallbacks';
import {
  getInitialProjectRegion,
  getMappedProjects,
  getUnmappedProjects,
  getPrimaryProjectImageSource,
  getProjectMarkerColor,
} from '../utils/projectMap';
import { getPartnerForMappedProject, getProjectIdsForPartnerUser } from '../utils/mapProjectLinks';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { getProjectVolunteerMapEntries } from '../utils/projectVolunteers';

// Displays the native project map with a detail sheet for the selected marker.
export default function MappingScreen({ navigation }: any) {
  const { user } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerReports, setPartnerReports] = useState<PartnerReport[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const mapRef = React.useRef<MapView | null>(null);
  const mappedProjects = React.useMemo(() => getMappedProjects(projects), [projects]);
  const unmappedProjects = React.useMemo(() => getUnmappedProjects(projects), [projects]);
  const isVolunteerView = user?.role === 'volunteer';
  const initialRegion = React.useMemo(
    () => getInitialProjectRegion(mappedProjects) as Region,
    [mappedProjects]
  );

  useEffect(() => {
    void loadProjects();
  }, [user]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'events', 'volunteers', 'partnerReports', 'partnerProjectApplications', 'volunteerProjectJoins'],
      () => {
        void loadProjects();
      }
    );
  }, [user]);



  // Loads map data and narrows project visibility based on the active role.
  const loadProjects = async () => {
    try {
      // Load snapshot first to render map quickly, defer large collections
      const snapshot = await getProjectsScreenSnapshot(user, [
        'projects',
        'partnerProjectApplications',
        'volunteerJoinRecords',
        'volunteerProfile',
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
      const joinedVolunteerProjectIds = new Set(
        snapshot.volunteerJoinRecords.map(record => record.projectId)
      );


      const visibleProjects =
        user?.role === 'partner'
          ? // Partner: only projects from APPROVED proposals
            mapSourceProjects.filter(project => partnerProjectIds.has(project.id))
          : user?.role === 'volunteer'
          ? // Volunteer: only EVENTS (isEvent=true) that the volunteer has joined
            mapSourceProjects.filter(
              project =>
                project.isEvent &&
                (
                  joinedVolunteerProjectIds.has(project.id) ||
                  (snapshot.volunteerProfile && (project.joinedUserIds || []).includes(snapshot.volunteerProfile.userId)) ||
                  (snapshot.volunteerProfile && (project.volunteers || []).includes(snapshot.volunteerProfile.id))
                )
            )
          : mapSourceProjects;


      const visibleProjectIds = new Set(visibleProjects.map(project => project.id));

      setProjects(visibleProjects);
      setVolunteerJoinRecords(snapshot.volunteerJoinRecords || []);
      setPartners(allPartners);
      
      // Load secondary data immediately without the artificial delay
      try {
        const [allReports, allVolunteers] = await Promise.all([
          getAllPartnerReports(),
          getAllVolunteers(),
        ]);
        setPartnerReports(allReports.filter(report => visibleProjectIds.has(report.projectId)));
        setVolunteers(allVolunteers);
      } catch (err) {
        // ignore — keep map responsive
      }
      
      setLoadError(null);
      setLoading(false);
    } catch (error) {
      console.error('Error loading projects for map:', error);
      setProjects([]);
      setPartnerReports([]);
      setVolunteers([]);
      setPartners([]);
      setLoadError({
        title: getRequestErrorTitle(error, 'Database Unavailable'),
        message: getRequestErrorMessage(error, 'Failed to load projects from Postgres.'),
      });
      setLoading(false);
    }
  };

  // Opens the details modal for the tapped map marker.
  const handleProjectSelection = (projectId: string) => {
    const project = projects.find(projectEntry => projectEntry.id === projectId);
    if (!project) {
      return;
    }

    setSelectedProject(project);
    if (isVolunteerView) {
      mapRef.current?.animateToRegion(
        {
          latitude: project.location.latitude,
          longitude: project.location.longitude,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        },
        250
      );
      return;
    }

    setShowDetails(true);
  };

  // Redirects to the lifecycle screen or projects screen based on the active user role.
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
      {!isVolunteerView ? (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Live Command Center</Text>
          <Text style={styles.headerSubtitle}>
            {user?.role === 'admin'
              ? 'Projects and field uploads in Negros Occidental'
              : 'Pins are limited to projects with approved partner proposals'}
          </Text>
        </View>
      ) : null}

      <View style={styles.mapContainer}>
        {loadError ? (
          <View style={isVolunteerView ? styles.volunteerInlineErrorWrap : styles.inlineErrorWrap}>
            <InlineLoadError
              title={loadError.title}
              message={loadError.message}
              onRetry={() => void loadProjects()}
            />
          </View>
        ) : null}

        <MapView
          ref={map => {
            mapRef.current = map;
          }}
          style={styles.mapView}
          initialRegion={initialRegion}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          showsCompass
          showsScale
          toolbarEnabled
          mapType="standard"
        >
          {mappedProjects.map((project, index) => (
            <Marker
              key={project.id}
              coordinate={{
                latitude: project.location.latitude,
                longitude: project.location.longitude,
              }}
              title={`${index + 1}. ${project.title}`}
              description={`${project.isEvent ? 'Event' : 'Project'} | ${getProjectDisplayStatus(project)}`}
              onPress={() => handleProjectSelection(project.id)}
            >
              <PhotoMapMarker
                accentColor={getProjectMarkerColor(project)}
                count={getProjectVolunteerMapEntries(project, volunteers, volunteerJoinRecords).length}
              />
              <Callout tooltip>
                <View style={styles.calloutCard}>
                  <Text style={styles.calloutTitle} numberOfLines={2}>
                    {project.title}
                  </Text>
                  <Text style={styles.calloutMetaLabel}>
                    {project.isEvent ? 'Event' : 'Project'}
                  </Text>

                  {(() => {
                    const addr = project.location?.address || '';
                    const isPlaceholder =
                      !addr ||
                      addr === 'Location to be finalized' ||
                      addr === 'Program location to be finalized';
                    if (!isPlaceholder) return null;
                    return (
                      <View style={styles.calloutLocationPending}>
                        <MaterialIcons name="location-off" size={13} color="#b45309" />
                        <Text style={styles.calloutLocationPendingText}>
                          Location pending — shown at region center
                        </Text>
                      </View>
                    );
                  })()}

                  {(() => {
                    const partner = getPartnerForMappedProject(project, partners);
                    if (!partner) {
                      return null;
                    }
                    return (
                      <TouchableOpacity
                        activeOpacity={0.6}
                        onPress={() => {
                          navigateToAvailableRoute(
                            navigation,
                            'Partners',
                            { partnerId: partner.id },
                            { routeName: 'Map' }
                          );
                        }}
                        style={styles.calloutProfileRow}
                      >
                        <MaterialIcons name="business" size={18} color="#0f766e" />
                        <Text style={styles.calloutProfileText} numberOfLines={1}>
                          {partner.name}
                        </Text>
                        <MaterialIcons name="chevron-right" size={18} color="#cbd5e1" />
                      </TouchableOpacity>
                    );
                  })()}

                  <Text style={styles.calloutSectionLabel}>Volunteers</Text>
                  {(() => {
                    const mergedVolunteers = getProjectVolunteerMapEntries(
                      project,
                      volunteers,
                      volunteerJoinRecords
                    ).slice(0, 6);

                    if (mergedVolunteers.length === 0) {
                      return <Text style={styles.calloutEmpty}>No volunteers joined yet.</Text>;
                    }

                    return mergedVolunteers.map(volunteer => {
                      const volunteerRecord = volunteers.find(
                        v => v.id === volunteer.volunteerId || v.userId === volunteer.volunteerUserId
                      );

                      return volunteerRecord ? (
                        <TouchableOpacity
                          key={volunteerRecord.id}
                          activeOpacity={0.6}
                          onPress={() => {
                            navigateToAvailableRoute(
                              navigation,
                              'Volunteers',
                              { volunteerId: volunteerRecord.id },
                              { routeName: 'Map' }
                            );
                          }}
                          style={styles.calloutProfileRow}
                        >
                          <MaterialIcons name="person-outline" size={18} color="#166534" />
                          <Text style={styles.calloutProfileText} numberOfLines={1}>
                            {volunteerRecord.name}
                          </Text>
                          <MaterialIcons name="chevron-right" size={18} color="#cbd5e1" />
                        </TouchableOpacity>
                      ) : (
                        <View key={volunteer.id} style={styles.calloutProfileRow}>
                          <MaterialIcons name="person-outline" size={18} color="#166534" />
                          <Text style={styles.calloutProfileText} numberOfLines={1}>
                            {volunteer.label}
                          </Text>
                        </View>
                      );
                    });
                  })()}
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>

        {isVolunteerView ? (
          <>
            <View style={styles.volunteerTopOverlay}>
              <View style={styles.volunteerHeroCard}>
                <View style={styles.volunteerHeroText}>
                  <Text style={styles.volunteerHeroTitle}>My Joined Events</Text>
                  <Text style={styles.volunteerHeroSubtitle}>
                    Tap a pin to view the event and open details.
                  </Text>
                </View>
                <View style={styles.volunteerCountBadge}>
                  <Text style={styles.volunteerCountValue}>{mappedProjects.length}</Text>
                  <Text style={styles.volunteerCountLabel}>pins</Text>
                </View>
              </View>
            </View>

            <View style={styles.volunteerFooterOverlay}>
              {selectedProject ? (
                <View style={styles.volunteerEventCard}>
                  <View style={styles.volunteerEventHeader}>
                    <View style={styles.volunteerEventTitleBlock}>
                      <Text style={styles.volunteerEventEyebrow}>Selected event</Text>
                      <Text style={styles.volunteerEventTitle} numberOfLines={1}>
                        {selectedProject.title}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedProject(null)}>
                      <MaterialIcons name="close" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.volunteerEventMeta} numberOfLines={2}>
                    {selectedProject.location.address || selectedProject.description}
                  </Text>
                  <View style={styles.volunteerMetaRow}>
                    <Text style={styles.volunteerMetaChip}>{getProjectDisplayStatus(selectedProject)}</Text>
                    <Text style={styles.volunteerMetaChip}>
                      {new Date(selectedProject.startDate).toLocaleDateString()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.volunteerPrimaryButton}
                    onPress={() => setShowDetails(true)}
                  >
                    <Text style={styles.volunteerPrimaryButtonText}>Open Event Info</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.volunteerHintCard}>
                  <MaterialIcons name="place" size={18} color="#166534" />
                  <Text style={styles.volunteerHintText}>
                    Pick an event pin to preview it here.
                  </Text>
                </View>
              )}
            </View>
          </>
        ) : null}
      </View>

      {!isVolunteerView ? (
        <View style={styles.projectListContainer}>
          <Text style={styles.projectListTitle}>
            {`Projects ${mappedProjects.length} mapped | Uploaded Impact ${partnerReports.reduce((sum, report) => sum + report.impactCount, 0)}`}
          </Text>
          {unmappedProjects.length > 0 ? (
            <Text style={styles.projectListWarning}>
              {`${unmappedProjects.length} ${unmappedProjects.length === 1 ? 'item is' : 'items are'} missing a map placement and shown at the region center.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Modal
        animationType="slide"
        transparent
        visible={showDetails}
        onRequestClose={() => setShowDetails(false)}
      >
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
                      style={styles.projectPhoto as ImageStyle}
                      resizeMode="cover"
                    />
                  );
                })()}

                <View style={styles.statusBadge}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getProjectStatusColor(selectedProject) },
                    ]}
                  />
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

                <View style={styles.datesGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Start Date</Text>
                    <Text style={styles.infoValue}>
                      {new Date(selectedProject.startDate).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>End Date</Text>
                    <Text style={styles.infoValue}>
                      {new Date(selectedProject.endDate).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Impact Uploads</Text>
                    <Text style={styles.infoValue}>
                      {partnerReports
                        .filter(report => report.projectId === selectedProject.id)
                        .reduce((sum, report) => sum + report.impactCount, 0)}
                    </Text>
                  </View>
                </View>

                {(() => {
                  const matchedPhotoReport = partnerReports.find(
                    report =>
                      report.projectId === selectedProject.id &&
                      Boolean(getPrimaryReportMediaUri(report.mediaFile, report.attachments))
                  );
                  const reportMediaUri = getPrimaryReportMediaUri(
                    matchedPhotoReport?.mediaFile,
                    matchedPhotoReport?.attachments
                  );
                  if (!reportMediaUri) {
                    return null;
                  }
                  return (
                    <Image
                      source={{ uri: reportMediaUri }}
                      style={styles.reportPhoto as ImageStyle}
                      resizeMode="cover"
                    />
                  );
                })()}

                <TouchableOpacity style={styles.viewDetailsButton} onPress={handleOpenProjectDetails}>
                  <Text style={styles.viewDetailsButtonText}>
                    {user?.role === 'admin' ? 'Open Program Management Suite' : 'View Full Details'}
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
    backgroundColor: ModernTheme.colors.background.secondary,
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
  header: {
    backgroundColor: ModernTheme.colors.background.card,
    paddingHorizontal: ModernTheme.spacing[4],
    paddingVertical: ModernTheme.spacing[3],
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    ...ModernTheme.shadows.sm,
  },
  inlineErrorWrap: {
    paddingHorizontal: ModernTheme.spacing[4],
    paddingTop: ModernTheme.spacing[3],
  },
  headerTitle: {
    fontSize: ModernTheme.typography.fontSize.xl,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
  },
  headerSubtitle: {
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.tertiary,
    marginTop: ModernTheme.spacing[1],
  },
  mapContainer: {
    flex: 1,
    backgroundColor: ModernTheme.colors.background.card,
    position: 'relative',
  },
  mapView: {
    flex: 1,
  },
  calloutCard: {
    width: 240,
    backgroundColor: ModernTheme.colors.background.card,
    borderRadius: ModernTheme.borderRadius.lg,
    padding: ModernTheme.spacing[3],
    borderWidth: 0,
    borderColor: 'transparent',
    ...ModernTheme.shadows.md,
  },
  calloutTitle: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
    marginBottom: ModernTheme.spacing[1],
  },
  calloutMetaLabel: {
    fontSize: ModernTheme.typography.fontSize.xs,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.secondary,
    marginBottom: ModernTheme.spacing[2],
  },
  calloutSectionLabel: {
    marginTop: ModernTheme.spacing[2],
    marginBottom: ModernTheme.spacing[1],
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.primary[700],
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[2],
    paddingVertical: ModernTheme.spacing[1],
  },
  calloutRowText: {
    flex: 1,
    fontSize: 12,
    color: '#0f172a',
  },
  calloutProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    marginVertical: 4,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    minHeight: 40,
  },
  calloutProfileText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#0f172a',
  },
  calloutEmpty: {
    fontSize: 12,
    color: '#64748b',
    paddingVertical: 4,
  },
  calloutLocationPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginBottom: 6,
  },
  calloutLocationPendingText: {
    fontSize: 10,
    color: '#b45309',
    fontWeight: '600',
    flexShrink: 1,
  },
  volunteerInlineErrorWrap: {
    position: 'absolute',
    top: 18,
    left: 16,
    right: 16,
    zIndex: 3,
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
  projectListWarning: {
    marginTop: 6,
    fontSize: 12,
    color: '#b45309',
  },
  volunteerTopOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 72,
    zIndex: 2,
  },
  volunteerHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  volunteerHeroText: {
    flex: 1,
  },
  volunteerHeroTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  volunteerHeroSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
  },
  volunteerCountBadge: {
    minWidth: 56,
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#ecfdf3',
  },
  volunteerCountValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#166534',
  },
  volunteerCountLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
  },
  recenterButton: {
    position: 'absolute',
    top: 24,
    right: 16,
    zIndex: 2,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  volunteerFooterOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    zIndex: 2,
  },
  volunteerEventCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  volunteerEventHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  volunteerEventTitleBlock: {
    flex: 1,
  },
  volunteerEventEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16a34a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  volunteerEventTitle: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  volunteerEventMeta: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 19,
    color: '#475569',
  },
  volunteerMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  volunteerMetaChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  volunteerPrimaryButton: {
    marginTop: 14,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#166534',
  },
  volunteerPrimaryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  volunteerHintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  volunteerHintText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#475569',
    fontWeight: '600',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    backgroundColor: '#fff',
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  projectPhoto: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    marginBottom: 20,
    backgroundColor: '#e5e7eb',
  },
  reportPhoto: {
    width: '100%',
    height: 220,
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
  datesGrid: {
    flexDirection: 'row',
    marginBottom: 24,
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
