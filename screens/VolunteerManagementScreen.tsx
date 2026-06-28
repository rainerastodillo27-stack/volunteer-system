import React, { useState, useEffect } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  FlatList,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Volunteer, Project, VolunteerProjectMatch, VolunteerTimeLog } from '../models/types';
import {
  assignVolunteerToProject,
  getAllVolunteers,
  getAllProjects,
  getVolunteerCompletedProjectIds,
  getAllVolunteerTimeLogs,
  getVolunteerProjectMatches,
  saveVolunteer,
  subscribeToStorageChanges,
} from '../models/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import InlineLoadError from '../components/InlineLoadError';
import { getProjectDisplayStatus } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

// Lets admins inspect volunteers, update availability, and assign projects.
export default function VolunteerManagementScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const insets = useSafeAreaInsets();

  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const hasInitialVolunteerId = Boolean(route?.params?.volunteerId);
  const [view, setView] = useState<'list' | 'detail'>(hasInitialVolunteerId ? 'detail' : 'list');
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [selectedVolunteerCompletedProjectIds, setSelectedVolunteerCompletedProjectIds] = useState<string[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [daysPerWeek, setDaysPerWeek] = useState('3');
  const [hoursPerWeek, setHoursPerWeek] = useState('12');
  const [availableDays, setAvailableDays] = useState<string[]>(['Monday', 'Wednesday', 'Saturday']);

  useEffect(() => {
    if (navigation) {
      const showHeader = view === 'list';
      navigation.setOptions({ headerShown: showHeader });
    }
  }, [view, navigation]);

  useEffect(() => {
    if (!actionNotice) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setActionNotice(null);
    }, 1000);

    return () => clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    // Load volunteers and projects quickly; defer heavy time-log audit
    void loadVolunteers();
    void loadProjects();
    setTimeout(() => {
      void loadTimeLogs();
    }, 50);
  }, [isAdmin]);

  useEffect(() => {
    const volunteerId = route?.params?.volunteerId;
    if (!isAdmin || !volunteerId) {
      return;
    }

    // If volunteers haven't loaded yet, wait for them
    if (volunteers.length === 0) {
      return;
    }

    const targetVolunteer = volunteers.find(volunteer => volunteer.id === volunteerId);
    if (!targetVolunteer) {
      return;
    }

    // Select the volunteer and load their details
    setSelectedVolunteer(targetVolunteer);
    void loadSelectedVolunteerDetails(targetVolunteer.id);
    setView('detail');
    // Clear the param after processing
    navigation.setParams({ volunteerId: undefined });
  }, [isAdmin, navigation, route?.params?.volunteerId, volunteers]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return subscribeToStorageChanges(
      ['volunteers', 'projects', 'volunteerMatches', 'volunteerProjectJoins', 'volunteerTimeLogs'],
      () => {
        void loadVolunteers();
        void loadProjects();
        setTimeout(() => {
          void loadTimeLogs();
        }, 100);
        if (selectedVolunteer) {
          void loadSelectedVolunteerDetails(selectedVolunteer.id);
        }
      }
    );
  }, [isAdmin, selectedVolunteer?.id]);

  // Loads all volunteer profiles and keeps the selected volunteer in sync.
  const loadVolunteers = async () => {
    try {
      const allVolunteers = await getAllVolunteers();
      setVolunteers(allVolunteers);
      setLoadError(null);
      setSelectedVolunteer(currentSelectedVolunteer => {
        if (!currentSelectedVolunteer) {
          return currentSelectedVolunteer;
        }

        return (
          allVolunteers.find(volunteer => volunteer.id === currentSelectedVolunteer.id) ||
          currentSelectedVolunteer
        );
      });
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteers.'),
      });
    }
  };

  // Loads available projects for matching and detail display.
  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load projects.'),
      });
    }
  };

  // Loads every volunteer time log so admins can audit time-in/time-out activity.
  const loadTimeLogs = async () => {
    try {
      const logs = await getAllVolunteerTimeLogs();
      setVolunteerTimeLogs(logs);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteer time logs.'),
      });
    }
  };

  // Loads match history and completed projects for the selected volunteer.
  const loadSelectedVolunteerDetails = async (volunteerId: string) => {
    // Load matches first for immediate UI; fetch completed project ids deferred
    try {
      const matches = await getVolunteerProjectMatches(volunteerId);
      setVolunteerMatches(matches);
    } catch (err) {
      setVolunteerMatches([]);
    }

    setSelectedVolunteerCompletedProjectIds([]);
    setTimeout(async () => {
      try {
        const completedProjectIds = await getVolunteerCompletedProjectIds(volunteerId);
        setSelectedVolunteerCompletedProjectIds(completedProjectIds);
      } catch {}
    }, 50);
  };

  // Opens the detail view for the chosen volunteer.
  const handleSelectVolunteer = (volunteer: Volunteer) => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage volunteers.');
      return;
    }

    setSelectedVolunteer(volunteer);
    void loadSelectedVolunteerDetails(volunteer.id);
    setView('detail');
  };

  // Closes the availability editor after save or cancel.
  const closeAvailabilityModal = () => {
    setShowAvailabilityModal(false);
  };

  // Assigns the selected volunteer to an in-progress event.
  const handleMatchVolunteer = async (projectId: string) => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can match volunteers to events.');
      return;
    }

    if (!selectedVolunteer) return;

    const previousVolunteerMatches = volunteerMatches;
    const now = new Date().toISOString();
    const optimisticMatch: VolunteerProjectMatch = {
      id: `match-${Date.now()}`,
      volunteerId: selectedVolunteer.id,
      projectId,
      status: 'Matched',
      requestedAt: undefined,
      matchedAt: now,
      reviewedAt: now,
      reviewedBy: user?.id || '',
      hoursContributed: 0,
    };
    setVolunteerMatches(currentMatches => [...currentMatches, optimisticMatch]);
    setActionNotice('Volunteer assigned to event and notified.');

    try {
      const savedMatch = await assignVolunteerToProject(projectId, selectedVolunteer.id, user?.id || '');
      setVolunteerMatches(currentMatches =>
        currentMatches.map(match => (match.id === optimisticMatch.id ? savedMatch : match))
      );
      void loadSelectedVolunteerDetails(selectedVolunteer.id);
    } catch (error) {
      setVolunteerMatches(previousVolunteerMatches);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to match volunteer.')
      );
    }
  };

  // Saves availability changes for the selected volunteer profile.
  const handleUpdateAvailability = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can update volunteer availability.');
      return;
    }

    if (!selectedVolunteer) return;

    const previousVolunteers = volunteers;
    const previousSelectedVolunteer = selectedVolunteer;

    try {
      const updated = {
        ...selectedVolunteer,
        availability: {
          daysPerWeek: parseInt(daysPerWeek, 10),
          hoursPerWeek: parseFloat(hoursPerWeek),
          availableDays,
        },
      };

      setVolunteers(currentVolunteers =>
        currentVolunteers.map(volunteer => (volunteer.id === updated.id ? updated : volunteer))
      );
      setSelectedVolunteer(updated);
      closeAvailabilityModal();
      setActionNotice('Availability updated.');

      await saveVolunteer(updated);
      void loadVolunteers();
    } catch (error) {
      setVolunteers(previousVolunteers);
      setSelectedVolunteer(previousSelectedVolunteer);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update availability.')
      );
    }
  };

  // Adds or removes one selected day from the volunteer availability draft.
  const toggleAvailableDay = (day: string) => {
    setAvailableDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Returns one formatted timestamp for the time-log cards.
  const formatTimestamp = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--';
    return format(parsed, 'PPpp');
  };

  // Returns the logged duration in hours for one completed volunteer time log.
  const getLogDurationHours = (log: VolunteerTimeLog) => {
    if (!log.timeOut) {
      return 0;
    }

    return Math.max(
      0,
      (new Date(log.timeOut).getTime() - new Date(log.timeIn).getTime()) / 3_600_000
    );
  };

  // Downloads a CSV report with total hours per volunteer for admin review.
  const handleDownloadVolunteerHoursReport = () => {
    const rows = volunteers
      .slice()
      .sort((left, right) => right.totalHoursContributed - left.totalHoursContributed)
      .map(volunteer => {
        const logsForVolunteer = volunteerTimeLogs.filter(log => log.volunteerId === volunteer.id);
        const completedLogs = logsForVolunteer.filter(log => Boolean(log.timeOut)).length;
        const activeLogs = logsForVolunteer.length - completedLogs;

        return [
          volunteer.name,
          volunteer.email,
          volunteer.totalHoursContributed.toFixed(1),
          String(completedLogs),
          String(activeLogs),
        ];
      });

    const csv = [
      ['Volunteer Name', 'Email', 'Total Hours', 'Completed Logs', 'Active Logs'],
      ...rows,
    ]
      .map(columns =>
        columns
          .map(value => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');

    if (typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `volunteer-hours-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      return;
    }

    Alert.alert(
      'Report Ready',
      'CSV download is currently available on the admin web view.'
    );
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Volunteer Management</Text>
        <View style={styles.emptyState}>
          <MaterialIcons name="lock" size={48} color="#ccc" />
          <Text style={styles.emptyText}>Volunteer management is available only in the admin web account.</Text>
        </View>
      </View>
    );
  }

  // Returns in-progress projects already matched to the selected volunteer.
  const getMatchedProjects = () => {
    return projects.filter(p =>
      p.isEvent &&
      getProjectDisplayStatus(p) === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Matched')
    );
  };

  // Returns in-progress projects still waiting for match approval.
  const getPendingProjects = () => {
    return projects.filter(p =>
      p.isEvent &&
      getProjectDisplayStatus(p) === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Requested')
    );
  };

  // Returns in-progress projects that can still accept this volunteer.
  const getAvailableProjects = () => {
    return projects.filter(
      p =>
        p.isEvent &&
        getProjectDisplayStatus(p) === 'In Progress' &&
        !volunteerMatches.find(
          m =>
            m.projectId === p.id &&
            (m.status === 'Matched' || m.status === 'Requested' || m.status === 'Completed')
        )
    );
  };

  if (view === 'detail' && selectedVolunteer) {
    const matchedProjects = getMatchedProjects();
    const pendingProjects = getPendingProjects();
    const availableProjects = getAvailableProjects();
    const matchRecords = volunteerMatches.map(match => {
      const project = projects.find(projectEntry => projectEntry.id === match.projectId);
      return {
        ...match,
        projectTitle: project?.title || 'Project',
        projectCategory: project?.category || 'Volunteer activity',
      };
    });
    const selectedVolunteerTimeLogs = volunteerTimeLogs
      .filter(log => log.volunteerId === selectedVolunteer.id)
      .sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime());
    
    // Count unique events joined from time logs, join records, and matches
    const eventsFromTimeLogs = new Set(selectedVolunteerTimeLogs.map(log => log.projectId));
    const eventsFromMatches = new Set(
      volunteerMatches
        .filter(match => match.status === 'Matched' || match.status === 'Completed')
        .map(match => match.projectId)
    );
    const joinedProjects = projects.filter(p => p.isEvent && (p.joinedUserIds || []).includes(selectedVolunteer.userId));
    const eventsFromJoined = new Set(joinedProjects.map(p => p.id));
    const allUniqueEvents = new Set([...eventsFromTimeLogs, ...eventsFromMatches, ...eventsFromJoined]);
    const eventsJoinedCount = allUniqueEvents.size;
    
    const completedProjects = selectedVolunteerCompletedProjectIds.map(projectId => {
      const project = projects.find(projectEntry => projectEntry.id === projectId);
      return {
        id: projectId,
        title: project?.title || projectId,
        category: project?.category,
        isEvent: project?.isEvent,
      };
    });

    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top, height: 56 + insets.top }]}>
          <TouchableOpacity onPress={() => setView('list')}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Volunteer Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={{ flex: 1 }}>

        {actionNotice ? (
          <View style={styles.noticeBanner}>
            <MaterialIcons name="check-circle" size={18} color="#166534" />
            <Text style={styles.noticeBannerText}>{actionNotice}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{selectedVolunteer.name.charAt(0)}</Text>
            </View>
            <View>
              <Text style={styles.volunteerName}>{selectedVolunteer.name}</Text>
              <Text style={styles.volunteerEmail}>{selectedVolunteer.email}</Text>
              <View
                style={[
                  styles.statusBadge,
                  selectedVolunteer.engagementStatus === 'Busy'
                    ? styles.statusBusy
                    : styles.statusOpen,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {selectedVolunteer.engagementStatus}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.stat}>
              <MaterialIcons name="event" size={24} color="#4CAF50" />
              <Text style={styles.statValue}>{eventsJoinedCount}</Text>
              <Text style={styles.statLabel}>Events Joined</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Availability</Text>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => {
                setDaysPerWeek(selectedVolunteer.availability.daysPerWeek.toString());
                setHoursPerWeek(selectedVolunteer.availability.hoursPerWeek.toString());
                setAvailableDays([...selectedVolunteer.availability.availableDays]);
                setShowAvailabilityModal(true);
              }}
            >
              <MaterialIcons name="edit" size={16} color="#4CAF50" />
            </TouchableOpacity>
          </View>

          <View style={styles.availabilityInfo}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Volunteer status:</Text>
              <Text style={styles.infoValue}>{selectedVolunteer.engagementStatus}</Text>
            </View>
            <Text style={styles.availableDaysLabel}>Available on:</Text>
            <View style={styles.daysContainer}>
              {selectedVolunteer.availability.availableDays.map(day => (
                <View key={day} style={styles.dayBadge}>
                  <Text style={styles.dayBadgeText}>{day.substring(0, 3)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skills</Text>
          <View style={styles.skillsContainer}>
            {selectedVolunteer.skills.map(skill => (
              <View key={skill} style={styles.skillTag}>
                <Text style={styles.skillTagText}>{skill}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Time Log History</Text>
            <Text style={styles.sectionSummary}>
              {selectedVolunteerTimeLogs.length} total record{selectedVolunteerTimeLogs.length === 1 ? '' : 's'}
            </Text>
          </View>

          {selectedVolunteerTimeLogs.length === 0 ? (
            <Text style={styles.emptyText}>No time in or time out records yet</Text>
          ) : (
            selectedVolunteerTimeLogs.map(log => {
              const linkedProject = projects.find(project => project.id === log.projectId);
              const durationHours = getLogDurationHours(log);

              return (
                <View key={log.id} style={styles.timeLogCard}>
                  <View style={styles.timeLogHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.projectName}>
                        {linkedProject?.title || 'Project'}
                      </Text>
                      <Text style={styles.projectCategory}>
                        {linkedProject?.category || 'Volunteer activity'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.timeLogStatusBadge,
                        log.timeOut ? styles.timeLogStatusCompleted : styles.timeLogStatusActive,
                      ]}
                    >
                      <Text style={styles.timeLogStatusText}>
                        {log.timeOut ? 'Timed Out' : 'Timed In'}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.timeLogMeta}>Time In: {formatTimestamp(log.timeIn)}</Text>
                  <Text style={styles.timeLogMeta}>
                    {log.timeOut
                      ? `Time Out: ${formatTimestamp(log.timeOut)}`
                      : 'Time Out still pending'}
                  </Text>
                  <Text style={styles.timeLogMeta}>
                    Hours Logged: {log.timeOut ? durationHours.toFixed(1) : '--'}
                  </Text>
                  {log.note ? (
                    <Text style={styles.timeLogNote}>Note: {log.note}</Text>
                  ) : null}
                  {log.completionPhoto || log.completionReport ? (
                    <>
                      <Text style={styles.timeLogMeta}>
                        Completion Proof: {log.completionPhoto ? 'Photo uploaded' : ''}
                        {log.completionPhoto && log.completionReport ? ' and ' : ''}
                        {log.completionReport ? 'Report submitted' : ''}
                      </Text>
                      {log.completionReport ? (
                        <Text style={styles.timeLogProofText}>
                          Report: {log.completionReport}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {matchedProjects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Assigned Projects</Text>
            {matchedProjects.map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>{project.category}</Text>
                </View>
                <MaterialIcons name="check-circle" size={20} color="#4CAF50" />
              </View>
            ))}
          </View>
        )}

        {pendingProjects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Join Requests</Text>
            {pendingProjects.map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>{project.category}</Text>
                </View>
                <View style={styles.pendingRequestBadge}>
                  <Text style={styles.pendingRequestBadgeText}>Pending</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Match Records</Text>
            <Text style={styles.sectionSummary}>
              {matchRecords.length} total record{matchRecords.length === 1 ? '' : 's'}
            </Text>
          </View>

          {matchRecords.length === 0 ? (
            <Text style={styles.emptyText}>No match records yet</Text>
          ) : (
            matchRecords.map(match => {
              const statusStyle =
                match.status === 'Matched'
                  ? styles.matchRecordStatusMatched
                  : match.status === 'Requested'
                  ? styles.matchRecordStatusRequested
                  : match.status === 'Completed'
                  ? styles.matchRecordStatusCompleted
                  : styles.matchRecordStatusInactive;

              return (
                <View key={match.id} style={styles.matchRecordCard}>
                  <View style={styles.matchRecordHeader}>
                    <View style={styles.projectInfo}>
                      <Text style={styles.projectName}>{match.projectTitle}</Text>
                      <Text style={styles.projectCategory}>{match.projectCategory}</Text>
                    </View>
                    <View style={[styles.matchRecordStatusBadge, statusStyle]}>
                      <Text style={styles.matchRecordStatusText}>{match.status}</Text>
                    </View>
                  </View>

                  <Text style={styles.matchRecordMeta}>
                    Updated: {format(new Date(match.matchedAt), 'PPpp')}
                  </Text>
                  <Text style={styles.matchRecordMeta}>
                    Hours Contributed: {match.hoursContributed.toFixed(1)}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Completed Events</Text>
          {completedProjects.filter(p => p.isEvent).length === 0 ? (
            <Text style={styles.emptyText}>No completed events yet</Text>
          ) : (
            completedProjects.filter(p => p.isEvent).map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>
                    {project.category || 'Completed event'}
                  </Text>
                </View>
                <MaterialIcons name="task-alt" size={20} color="#16a34a" />
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Available Events ({availableProjects.filter(p => p.isEvent).length})
            </Text>
          </View>

          {availableProjects.filter(p => p.isEvent).length === 0 ? (
            <Text style={styles.emptyText}>No available events</Text>
          ) : (
            availableProjects.filter(p => p.isEvent).map(project => (
              <View key={project.id} style={styles.matchCard}>
                <View style={styles.matchContent}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>{project.category}</Text>
                  <Text style={styles.matchDetails}>
                    Volunteers: {project.volunteers.length}/{project.volunteersNeeded}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.matchButton}
                  onPress={() => handleMatchVolunteer(project.id)}
                >
                  <MaterialIcons name="add-circle" size={24} color="#4CAF50" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <Modal
          visible={showAvailabilityModal}
          animationType="slide"
          onRequestClose={closeAvailabilityModal}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeAvailabilityModal}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Update Availability</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <View style={styles.formRow}>
                <TextInput
                  style={[styles.input, styles.inputWithLabel]}
                  placeholder="Number of days"
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                  value={daysPerWeek}
                  onChangeText={setDaysPerWeek}
                />
                <Text style={[styles.label, styles.labelRight]}>Days per week</Text>
              </View>

              <View style={styles.formRow}>
                <TextInput
                  style={[styles.input, styles.inputWithLabel]}
                  placeholder="Total hours"
                  placeholderTextColor="#999"
                  keyboardType="decimal-pad"
                  value={hoursPerWeek}
                  onChangeText={setHoursPerWeek}
                />
                <Text style={[styles.label, styles.labelRight]}>Hours per week</Text>
              </View>

              <View style={[styles.formRow, styles.formRowTop]}>
                <View style={[styles.daysGrid, styles.daysGridCard]}>
                  {daysOfWeek.map(day => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayButton,
                        availableDays.includes(day) && styles.dayButtonSelected,
                      ]}
                      onPress={() => toggleAvailableDay(day)}
                    >
                      <Text
                        style={[
                          styles.dayButtonText,
                          availableDays.includes(day) && styles.dayButtonTextSelected,
                        ]}
                      >
                        {day.substring(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.label, styles.labelRight, styles.labelTop]}>
                  Available days
                </Text>
              </View>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleUpdateAvailability}
              >
                <Text style={styles.submitButtonText}>Update Availability</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
      </ScrollView>
    </View>
    );
  }

  const sortedVolunteers = [...volunteers].sort((left, right) => left.name.localeCompare(right.name));

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Volunteer Management</Text>
        <TouchableOpacity
          style={styles.reportButton}
          onPress={handleDownloadVolunteerHoursReport}
        >
          <MaterialIcons
            name={Platform.OS === 'web' ? 'download' : 'summarize'}
            size={16}
            color="#fff"
          />
          <Text style={styles.reportButtonText}>Download Hours Report</Text>
        </TouchableOpacity>
      </View>
      {actionNotice ? (
        <View style={styles.noticeBanner}>
          <MaterialIcons name="check-circle" size={18} color="#166534" />
          <Text style={styles.noticeBannerText}>{actionNotice}</Text>
        </View>
      ) : null}
      <View style={styles.listContent}>
        {loadError ? (
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => {
              void loadVolunteers();
              void loadProjects();
              void loadTimeLogs();
            }}
          />
        ) : null}
      </View>
      <FlatList
        data={sortedVolunteers}
        keyExtractor={vol => vol.id}
        renderItem={({ item: volunteer }) => (
          <TouchableOpacity
            style={styles.volunteerCard}
            onPress={() => handleSelectVolunteer(volunteer)}
          >
            <View style={styles.volunteerCardAvatar}>
              <Text style={styles.volunteerCardAvatarText}>
                {volunteer.name.charAt(0)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.volunteerCardName}>{volunteer.name}</Text>
              <View style={styles.volunteerCardMeta}>
                <MaterialIcons name="schedule" size={12} color="#666" />
                <Text style={styles.volunteerCardMetaText}>
                  {volunteer.availability.hoursPerWeek}h/week
                </Text>
                <MaterialIcons name="star" size={12} color="#FFA500" />
                <Text style={styles.volunteerCardMetaText}>
                  {volunteer.rating}
                </Text>
              </View>
              <Text
                style={[
                  styles.volunteerCardStatus,
                  volunteer.engagementStatus === 'Busy'
                    ? styles.volunteerCardStatusBusy
                    : styles.volunteerCardStatusOpen,
                ]}
              >
                {volunteer.engagementStatus}
              </Text>
            </View>
            <MaterialIcons name="arrow-forward" size={20} color="#999" />
          </TouchableOpacity>
        )}
        scrollEnabled={true}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  titleRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 12,
  },
  reportButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  reportButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#dcfce7',
  },
  noticeBannerText: {
    flex: 1,
    color: '#14532d',
    fontSize: 13,
    fontWeight: '700',
  },
  registrationSummaryCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  registrationSummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9a3412',
  },
  registrationSummaryText: {
    marginTop: 4,
    fontSize: 12,
    color: '#7c2d12',
    lineHeight: 18,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    margin: 6,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  volunteerName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
  },
  volunteerEmail: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  statusOpen: {
    backgroundColor: '#dcfce7',
  },
  statusBusy: {
    backgroundColor: '#fee2e2',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1f2937',
  },
  registrationBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  registrationBadgePending: {
    backgroundColor: '#fef3c7',
  },
  registrationBadgeApproved: {
    backgroundColor: '#dcfce7',
  },
  registrationBadgeRejected: {
    backgroundColor: '#fee2e2',
  },
  registrationBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1f2937',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  stat: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 6,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 2,
  },
  statLabel: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    margin: 6,
    marginBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
  },
  sectionSummary: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  editButton: {
    padding: 8,
  },
  reviewActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  reviewActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    paddingVertical: 10,
  },
  reviewApproveButton: {
    backgroundColor: '#16a34a',
  },
  reviewRejectButton: {
    backgroundColor: '#dc2626',
  },
  reviewActionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  availabilityInfo: {
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  availableDaysLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    marginTop: 6,
  },
  daysContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayBadge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  dayBadgeText: {
    color: '#1976d2',
    fontSize: 11,
    fontWeight: '600',
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  skillTag: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  skillTagText: {
    fontSize: 11,
    color: '#333',
    fontWeight: '500',
  },
  timeLogCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timeLogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  timeLogStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  timeLogStatusActive: {
    backgroundColor: '#fef3c7',
  },
  timeLogStatusCompleted: {
    backgroundColor: '#dcfce7',
  },
  timeLogStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1f2937',
  },
  timeLogMeta: {
    fontSize: 11,
    color: '#334155',
    marginTop: 2,
  },
  timeLogNote: {
    fontSize: 11,
    color: '#475569',
    marginTop: 4,
    fontStyle: 'italic',
  },
  timeLogProofText: {
    fontSize: 11,
    color: '#334155',
    marginTop: 4,
    lineHeight: 16,
  },
  projectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  projectCategory: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  pendingRequestBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pendingRequestBadgeText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '700',
  },
  matchRecordCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  matchRecordHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  matchRecordStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  matchRecordStatusMatched: {
    backgroundColor: '#dcfce7',
  },
  matchRecordStatusRequested: {
    backgroundColor: '#fef3c7',
  },
  matchRecordStatusCompleted: {
    backgroundColor: '#dbeafe',
  },
  matchRecordStatusInactive: {
    backgroundColor: '#e5e7eb',
  },
  matchRecordStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1f2937',
  },
  matchRecordMeta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 6,
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  matchCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchContent: {
    flex: 1,
  },
  matchDetails: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  matchButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  volunteerCardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCardAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  volunteerCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  volunteerCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  volunteerCardMetaText: {
    fontSize: 11,
    color: '#666',
    marginRight: 8,
  },
  volunteerCardStatus: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  listRegistrationBadge: {
    marginTop: 6,
  },
  inlineReviewActions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  inlineReviewButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  inlineReviewButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  volunteerCardStatusOpen: {
    color: '#15803d',
  },
  volunteerCardStatusBusy: {
    color: '#b91c1c',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  labelRight: {
    marginBottom: 0,
    minWidth: 140,
    textAlign: 'right',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#14532d',
  },
  labelTop: {
    marginTop: 4,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  formRowTop: {
    alignItems: 'flex-start',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
    color: '#333',
    marginBottom: 20,
  },
  inputWithLabel: {
    flex: 1,
    marginBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 0,
  },
  daysGridCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  dayButton: {
    flex: 0.3,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  dayButtonSelected: {
    backgroundColor: '#4CAF50',
  },
  dayButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  dayButtonTextSelected: {
    color: '#fff',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
