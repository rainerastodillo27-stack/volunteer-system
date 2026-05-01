import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ImageSourcePropType,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProject,
  getVolunteerProjectMatches,
  requestVolunteerProjectJoin,
  getAllVolunteerTimeLogs,
  startVolunteerTimeLog,
  endVolunteerTimeLog,
  subscribeToStorageChanges,
} from '../models/storage';
import { Project, Volunteer, VolunteerProjectMatch, VolunteerTimeLog } from '../models/types';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage } from '../utils/requestErrors';

const PROGRAM_IMAGE_BY_CATEGORY: Record<Project['category'], ImageSourcePropType> = {
  Nutrition: require('../assets/programs/nutrition.jpg'),
  Education: require('../assets/programs/education.jpg'),
  Livelihood: require('../assets/programs/livelihood.jpg'),
  Disaster: require('../assets/programs/mingo-relief.jpg'),
};

function getProjectImageSource(project: Project): ImageSourcePropType {
  if (!project.imageHidden && project.imageUrl) {
    return { uri: project.imageUrl };
  }
  return PROGRAM_IMAGE_BY_CATEGORY[project.programModule || project.category];
}

export default function VolunteerProjectDetailsScreen({
  navigation,
  route,
}: {
  navigation: any;
  route: any;
}) {
  const { user } = useAuth();
  const projectId = route?.params?.projectId;

  const [project, setProject] = useState<Project | null>(null);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [activeTimeLog, setActiveTimeLog] = useState<VolunteerTimeLog | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!projectId || !user?.id) return;
    const shouldShowBlockingLoader = !hasLoadedOnceRef.current;

    try {
      if (shouldShowBlockingLoader) {
        setLoading(true);
      }
      const [projectData, matches, timeLogs] = await Promise.all([
        getProject(projectId),
        getVolunteerProjectMatches(user.id).catch(() => []),
        getAllVolunteerTimeLogs().catch(() => []),
      ]);

      setProject(projectData);
      setVolunteerMatches(matches);

      // Find any active time log for this project
      const projectTimeLogs = timeLogs.filter(
        (log) => log.projectId === projectId && log.volunteerId === user.id
      );
      setTimeLogs(projectTimeLogs);

      const active = projectTimeLogs.find((log) => !log.timeOut);
      setActiveTimeLog(active || null);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      console.error('Error loading project details:', error);
    } finally {
      if (shouldShowBlockingLoader) {
        setLoading(false);
      }
    }
  }, [projectId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      return subscribeToStorageChanges(
        ['projects', 'volunteerMatches', 'volunteerTimeLogs'],
        loadData
      );
    }, [loadData])
  );

  const handleJoinProject = async () => {
    if (!user?.id || !project) return;

    try {
      setLoadingAction('join');
      const match = await requestVolunteerProjectJoin(project.id, user.id);
      setVolunteerMatches((prev) => [
        match,
        ...prev.filter((m) => m.projectId !== project.id),
      ]);
      Alert.alert('Success', 'Join request sent!');
    } catch (error) {
      Alert.alert(
        'Error',
        getRequestErrorMessage(error, 'Unable to send join request.')
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleStartTimeLog = async () => {
    if (!user?.id || !project) return;

    try {
      setLoadingAction('startTime');
      const timeLog = await startVolunteerTimeLog(project.id, user.id);
      setActiveTimeLog(timeLog);
      setTimeLogs((prev) => [...prev, timeLog]);
      Alert.alert('Success', 'Time logging started');
    } catch (error) {
      Alert.alert(
        'Error',
        getRequestErrorMessage(error, 'Unable to start time log.')
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleEndTimeLog = async () => {
    if (!activeTimeLog || !user?.id || !project) return;

    try {
      setLoadingAction('endTime');
      const result = await endVolunteerTimeLog(user.id, project.id);
      if (result.log) {
        setTimeLogs((prev) =>
          prev.map((log) => (log.id === result.log!.id ? result.log! : log))
        );
      }
      setActiveTimeLog(null);
      Alert.alert('Success', 'Time logging stopped');
    } catch (error) {
      Alert.alert('Error', getRequestErrorMessage(error, 'Unable to end time log.'));
    } finally {
      setLoadingAction(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <MaterialIcons name="folder-open" size={48} color="#ccc" />
          <Text style={styles.errorText}>Project not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const currentMatch = volunteerMatches.find((m) => m.projectId === project.id);
  const isJoined = !!currentMatch;
  const isPending = currentMatch?.status === 'Requested';

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header with back button */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.headerButton}
          >
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Project Details</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Project Image */}
        <Image
          source={getProjectImageSource(project)}
          style={styles.projectImage}
        />

        {/* Project Info */}
        <View style={styles.content}>
          <Text style={styles.projectTitle}>{project.title}</Text>

          {/* Status Badge */}
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: getProjectStatusColor(project),
                },
              ]}
            >
              <Text style={styles.statusText}>
                {getProjectDisplayStatus(project)}
              </Text>
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.sectionText}>{project.description}</Text>
          </View>

          {/* Date & Location */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>

            <View style={styles.detailRow}>
              <MaterialIcons name="calendar-today" size={20} color="#4CAF50" />
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Date</Text>
                <Text style={styles.detailValue}>
                  {project.startDate && project.endDate
                    ? `${format(new Date(project.startDate), 'MMM d, yyyy')} - ${format(
                        new Date(project.endDate),
                        'MMM d, yyyy'
                      )}`
                    : 'Date to be announced'}
                </Text>
              </View>
            </View>

            {project.location?.address && (
              <View style={styles.detailRow}>
                <MaterialIcons name="location-on" size={20} color="#4CAF50" />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Location</Text>
                  <Text style={styles.detailValue}>{project.location.address}</Text>
                </View>
              </View>
            )}

            {project.volunteersNeeded && (
              <View style={styles.detailRow}>
                <MaterialIcons name="people" size={20} color="#4CAF50" />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Volunteers Needed</Text>
                  <Text style={styles.detailValue}>{project.volunteersNeeded}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Time Logging */}
          {isJoined && !isPending && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Time Logging</Text>

              {activeTimeLog ? (
                <View style={styles.timeLogActive}>
                  <MaterialIcons
                    name="access-time"
                    size={24}
                    color="#f59e0b"
                  />
                  <View style={styles.timeLogContent}>
                    <Text style={styles.timeLogStatus}>Time logging active</Text>
                    <Text style={styles.timeLogTime}>
                      Started at{' '}
                      {format(new Date(activeTimeLog.timeIn), 'h:mm a')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.timeLogButton}
                    onPress={handleEndTimeLog}
                    disabled={loadingAction === 'endTime'}
                  >
                    <Text style={styles.timeLogButtonText}>
                      {loadingAction === 'endTime' ? 'Stopping...' : 'Stop'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.timeLogStartButton}
                  onPress={handleStartTimeLog}
                  disabled={loadingAction === 'startTime'}
                >
                  <MaterialIcons name="play-arrow" size={20} color="#fff" />
                  <Text style={styles.timeLogStartButtonText}>
                    {loadingAction === 'startTime'
                      ? 'Starting...'
                      : 'Start Time Logging'}
                  </Text>
                </TouchableOpacity>
              )}

              {timeLogs.length > 0 && (
                <View style={styles.timeLogsHistory}>
                  <Text style={styles.timeLogsHistoryTitle}>
                    Logged time ({timeLogs.length} {timeLogs.length === 1 ? 'entry' : 'entries'})
                  </Text>
                  {timeLogs.map((log) => (
                    <View key={log.id} style={styles.timeLogEntry}>
                      <Text style={styles.timeLogEntryDate}>
                        {format(new Date(log.timeIn), 'MMM d, h:mm a')}
                      </Text>
                      {log.timeOut && (
                        <Text style={styles.timeLogEntryDuration}>
                          Duration: {Math.round(
                            (new Date(log.timeOut).getTime() -
                              new Date(log.timeIn).getTime()) /
                              (1000 * 60)
                          )}{' '}
                          minutes
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Action Button */}
          <TouchableOpacity
            style={[
              styles.actionButton,
              (isJoined || loadingAction === 'join') &&
                styles.actionButtonDisabled,
            ]}
            onPress={handleJoinProject}
            disabled={isJoined || loadingAction === 'join'}
          >
            <Text style={styles.actionButtonText}>
              {loadingAction === 'join'
                ? 'Sending Request...'
                : isPending
                  ? 'Request Pending'
                  : isJoined
                    ? 'Joined'
                    : 'Request to Join'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  headerSpacer: {
    width: 40,
  },
  projectImage: {
    width: '100%',
    height: 200,
  },
  content: {
    padding: 16,
  },
  projectTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  statusRow: {
    marginBottom: 20,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#666',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '600',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  timeLogActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  timeLogContent: {
    flex: 1,
  },
  timeLogStatus: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f59e0b',
  },
  timeLogTime: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  timeLogButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  timeLogButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  timeLogStartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  timeLogStartButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  timeLogsHistory: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
  },
  timeLogsHistoryTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
  },
  timeLogEntry: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  timeLogEntryDate: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  timeLogEntryDuration: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  actionButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  actionButtonDisabled: {
    backgroundColor: '#ccc',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  backButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
});
