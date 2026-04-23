import React, { useState, useEffect } from 'react';
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
import { useAuth } from '../contexts/AuthContext';
import InlineLoadError from '../components/InlineLoadError';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

// Lets admins inspect volunteers, update availability, and assign projects.
export default function VolunteerManagementScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [selectedVolunteerCompletedProjectIds, setSelectedVolunteerCompletedProjectIds] = useState<string[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [daysPerWeek, setDaysPerWeek] = useState('3');
  const [hoursPerWeek, setHoursPerWeek] = useState('12');
  const [availableDays, setAvailableDays] = useState<string[]>(['Monday', 'Wednesday', 'Saturday']);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void loadVolunteers();
    void loadProjects();
    void loadTimeLogs();
  }, [isAdmin]);

  useEffect(() => {
    const volunteerId = route?.params?.volunteerId;
    if (!isAdmin || !volunteerId || volunteers.length === 0) {
      return;
    }

    const targetVolunteer = volunteers.find(volunteer => volunteer.id === volunteerId);
    if (!targetVolunteer) {
      return;
    }

    void handleSelectVolunteer(targetVolunteer);
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
        void loadTimeLogs();
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
    const [matches, completedProjectIds] = await Promise.all([
      getVolunteerProjectMatches(volunteerId),
      getVolunteerCompletedProjectIds(volunteerId),
    ]);
    setVolunteerMatches(matches);
    setSelectedVolunteerCompletedProjectIds(completedProjectIds);
  };

  // Opens the detail view for the chosen volunteer.
  const handleSelectVolunteer = async (volunteer: Volunteer) => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage volunteers.');
      return;
    }

    setSelectedVolunteer(volunteer);
    await loadSelectedVolunteerDetails(volunteer.id);
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

    try {
      await assignVolunteerToProject(projectId, selectedVolunteer.id, user?.id || '');
      Alert.alert('Success', 'Volunteer assigned to event and notified.');

      const matches = await getVolunteerProjectMatches(selectedVolunteer.id);
      setVolunteerMatches(matches);
    } catch (error) {
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

    try {
      const updated = {
        ...selectedVolunteer,
        availability: {
          daysPerWeek: parseInt(daysPerWeek, 10),
          hoursPerWeek: parseFloat(hoursPerWeek),
          availableDays,
        },
      };

      await saveVolunteer(updated);
      Alert.alert('Success', 'Availability updated');
      closeAvailabilityModal();
      setSelectedVolunteer(updated);
      loadVolunteers();
    } catch (error) {
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
      p.status === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Matched')
    );
  };

  // Returns in-progress projects still waiting for match approval.
  const getPendingProjects = () => {
    return projects.filter(p =>
      p.isEvent &&
      p.status === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Requested')
    );
  };

  // Returns in-progress projects that can still accept this volunteer.
  const getAvailableProjects = () => {
    return projects.filter(
      p =>
        p.isEvent &&
        p.status === 'In Progress' &&
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
    const completedProjects = selectedVolunteerCompletedProjectIds.map(projectId => {
      const project = projects.find(projectEntry => projectEntry.id === projectId);
      return {
        id: projectId,
        title: project?.title || projectId,
        category: project?.category,
      };
    });

    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('list')}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Volunteer Profile</Text>
          <View style={{ width: 24 }} />
        </View>

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
              <MaterialIcons name="schedule" size={24} color="#2196F3" />
              <Text style={styles.statValue}>{selectedVolunteer.totalHoursContributed}</Text>
              <Text style={styles.statLabel}>Hours</Text>
            </View>
            <View style={styles.stat}>
              <MaterialIcons name="star" size={24} color="#FFA500" />
              <Text style={styles.statValue}>{selectedVolunteer.rating}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.stat}>
              <MaterialIcons name="task-alt" size={24} color="#4CAF50" />
              <Text style={styles.statValue}>{selectedVolunteerCompletedProjectIds.length}</Text>
              <Text style={styles.statLabel}>Projects</Text>
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
              <Text style={styles.infoLabel}>Days per week:</Text>
              <Text style={styles.infoValue}>{selectedVolunteer.availability.daysPerWeek}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Hours per week:</Text>
              <Text style={styles.infoValue}>{selectedVolunteer.availability.hoursPerWeek}</Text>
            </View>
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
          <Text style={styles.sectionTitle}>Completed Projects</Text>
          {completedProjects.length === 0 ? (
            <Text style={styles.emptyText}>No completed projects yet</Text>
          ) : (
            completedProjects.map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>
                    {project.category || 'Completed program'}
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
              Available Projects ({availableProjects.length})
            </Text>
          </View>

          {availableProjects.length === 0 ? (
            <Text style={styles.emptyText}>No available projects</Text>
          ) : (
            availableProjects.map(project => (
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
    paddingHorizontal: 16,
    paddingVertical: 8,
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 16,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 24,
  },
  volunteerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  volunteerEmail: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
  },
  statusOpen: {
    backgroundColor: '#dcfce7',
  },
  statusBusy: {
    backgroundColor: '#fee2e2',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1f2937',
  },
  registrationBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
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
    fontSize: 11,
    fontWeight: '700',
    color: '#1f2937',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  stat: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  sectionSummary: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  editButton: {
    padding: 8,
  },
  reviewActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  reviewActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
  },
  reviewApproveButton: {
    backgroundColor: '#16a34a',
  },
  reviewRejectButton: {
    backgroundColor: '#dc2626',
  },
  reviewActionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  availabilityInfo: {
    gap: 12,
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
    marginTop: 8,
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
    gap: 8,
  },
  skillTag: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  skillTagText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  timeLogCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timeLogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  timeLogStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  timeLogStatusActive: {
    backgroundColor: '#fef3c7',
  },
  timeLogStatusCompleted: {
    backgroundColor: '#dcfce7',
  },
  timeLogStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1f2937',
  },
  timeLogMeta: {
    fontSize: 12,
    color: '#334155',
    marginTop: 4,
  },
  timeLogNote: {
    fontSize: 12,
    color: '#475569',
    marginTop: 6,
    fontStyle: 'italic',
  },
  timeLogProofText: {
    fontSize: 12,
    color: '#334155',
    marginTop: 6,
    lineHeight: 18,
  },
  projectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 13,
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
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pendingRequestBadgeText: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '700',
  },
  matchRecordCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  matchRecordHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
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
    padding: 12,
    marginVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  volunteerCardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCardAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  volunteerCardName: {
    fontSize: 14,
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
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
  },
  listRegistrationBadge: {
    marginTop: 8,
  },
  inlineReviewActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  inlineReviewButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
