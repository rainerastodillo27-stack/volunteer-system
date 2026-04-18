import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import PhotoMapMarker from '../components/PhotoMapMarker';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import { PartnerEventCheckIn, PartnerReport, Project } from '../models/types';
import {
  getAllPartnerEventCheckIns,
  getAllPartnerReports,
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { isImageMediaUri } from '../utils/media';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getInitialProjectRegion, getProjectMarkerColor, getPrimaryProjectImageSource } from '../utils/projectMap';
import { getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

// Displays the native project map with a detail sheet for the selected marker.
export default function MappingScreen({ navigation }: any) {
  const { user } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerCheckIns, setPartnerCheckIns] = useState<PartnerEventCheckIn[]>([]);
  const [partnerReports, setPartnerReports] = useState<PartnerReport[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const androidGoogleMapsApiKey = Constants.expoConfig?.extra?.androidGoogleMapsApiKey as string | undefined;

  useEffect(() => {
    void loadProjects();
  }, [user]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'partnerEventCheckIns', 'partnerReports', 'partnerProjectApplications', 'volunteerProjectJoins'],
      () => {
        void loadProjects();
      }
    );
  }, [user]);

  // Loads map data and narrows project visibility to records the current user joined.
  const loadProjects = async () => {
    try {
      const [snapshot, allCheckIns, allReports] = await Promise.all([
        getProjectsScreenSnapshot(user),
        getAllPartnerEventCheckIns(),
        getAllPartnerReports(),
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

      const visibleProjectIds = new Set(visibleProjects.map(project => project.id));

      setProjects(visibleProjects);
      setPartnerCheckIns(allCheckIns.filter(checkIn => visibleProjectIds.has(checkIn.projectId)));
      setPartnerReports(allReports.filter(report => visibleProjectIds.has(report.projectId)));
      setLoadError(null);
      setLoading(false);
    } catch (error) {
      console.error('Error loading projects for map:', error);
      setProjects([]);
      setPartnerCheckIns([]);
      setPartnerReports([]);
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Command Center</Text>
        <Text style={styles.headerSubtitle}>
          {user?.role === 'admin'
            ? 'Projects, partner GPS check-ins, and field uploads in Negros Occidental'
            : 'Pins are limited to projects you joined in Negros Occidental'}
        </Text>
      </View>

      {loadError ? (
        <View style={styles.inlineErrorWrap}>
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => void loadProjects()}
          />
        </View>
      ) : null}

      <View style={styles.mapContainer}>
        <MapView
          style={styles.mapView}
          initialRegion={getInitialProjectRegion(projects) as Region}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          showsCompass
          showsScale
          toolbarEnabled
        >
          {projects.map((project, index) => (
            <Marker
              key={project.id}
              coordinate={{
                latitude: project.location.latitude,
                longitude: project.location.longitude,
              }}
              anchor={{ x: 0.5, y: 1 }}
              title={`${index + 1}. ${project.title}`}
              description={`${project.isEvent ? 'Event' : 'Program'} | ${project.status}`}
              onPress={() => handleProjectSelection(project.id)}
            >
              <PhotoMapMarker accentColor={getProjectMarkerColor(project)} />
            </Marker>
          ))}
          {partnerCheckIns.map(checkIn => (
            <Marker
              key={checkIn.id}
              coordinate={{
                latitude: checkIn.gpsCoordinates.latitude,
                longitude: checkIn.gpsCoordinates.longitude,
              }}
              anchor={{ x: 0.5, y: 1 }}
              title={`Partner Check-In: ${checkIn.projectId}`}
              description={new Date(checkIn.checkInTime).toLocaleString()}
            >
              <PhotoMapMarker accentColor="#2563eb" />
            </Marker>
          ))}
        </MapView>
      </View>

      <View style={styles.projectListContainer}>
        <Text style={styles.projectListTitle}>
          {`Projects ${projects.length} | Check-Ins ${partnerCheckIns.length} | Uploaded Impact ${partnerReports.reduce((sum, report) => sum + report.impactCount, 0)}`}
        </Text>
        {Platform.OS === 'android' && !androidGoogleMapsApiKey ? (
          <Text style={styles.projectListWarning}>
            Android Google Maps key is missing. Add `GOOGLE_MAPS_ANDROID_API_KEY` to `.env`.
          </Text>
        ) : null}
      </View>

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
                      style={styles.projectPhoto}
                      resizeMode="cover"
                    />
                  );
                })()}

                <View style={styles.statusBadge}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getProjectStatusColor(selectedProject.status) },
                    ]}
                  />
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
                    <Text style={styles.infoLabel}>Check-Ins</Text>
                    <Text style={styles.infoValue}>
                      {partnerCheckIns.filter(checkIn => checkIn.projectId === selectedProject.id).length}
                    </Text>
                  </View>
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
                    report => report.projectId === selectedProject.id && report.mediaFile && isImageMediaUri(report.mediaFile)
                  );
                  if (!matchedPhotoReport?.mediaFile) {
                    return null;
                  }
                  return (
                    <Image
                      source={{ uri: matchedPhotoReport.mediaFile }}
                      style={styles.reportPhoto}
                      resizeMode="cover"
                    />
                  );
                })()}

                <TouchableOpacity style={styles.viewDetailsButton} onPress={handleOpenProjectDetails}>
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
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  inlineErrorWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
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
  mapContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  mapView: {
    flex: 1,
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
    fontSize: 24,
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
