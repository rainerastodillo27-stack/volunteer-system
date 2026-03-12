import React, { useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import {
  getNegrosProjects,
  getVolunteerByUserId,
  NEGROS_SAMPLE_PROJECTS,
  joinProjectEvent,
  getVolunteerTimeLogs,
  startVolunteerTimeLog,
  endVolunteerTimeLog,
} from '../models/storage';
import { Project, Volunteer, VolunteerTimeLog } from '../models/types';

const CATEGORY_KEYWORDS: Record<Project['category'], string[]> = {
  Education: ['teaching', 'mentoring', 'reading', 'library', 'school', 'student', 'tutor'],
  Livelihood: ['livelihood', 'training', 'skills', 'sewing', 'enterprise', 'food', 'workshop'],
  Nutrition: ['nutrition', 'feeding', 'meal', 'health', 'wellness', 'food'],
  Other: ['community', 'cleanup', 'outreach', 'event', 'logistics', 'coordination'],
};

type Recommendation = {
  label: 'Good Skill Fit' | 'Suggested for You' | 'Open Program';
  reasons: string[];
};

const normalizeWords = (value?: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

const unique = (values: string[]) => Array.from(new Set(values));

function getProjectSuggestion(project: Project, volunteer: Volunteer | null): Recommendation {
  if (!volunteer) {
    return {
      label: 'Open Program',
      reasons: [project.category, 'Negros location'],
    };
  }

  const skillTerms = unique([
    ...((volunteer.skills || []).flatMap(normalizeWords)),
    ...normalizeWords(volunteer.skillsDescription),
  ]);

  const projectTerms = unique([
    ...normalizeWords(project.title),
    ...normalizeWords(project.description),
    ...normalizeWords(project.location.address),
    ...CATEGORY_KEYWORDS[project.category],
  ]);

  const matchedTerms = skillTerms.filter((term) => projectTerms.includes(term)).slice(0, 3);
  const reasons = matchedTerms.length > 0 ? [...matchedTerms] : [];
  const isLocalProgram = project.location.address.toLowerCase().includes('negros');

  if (isLocalProgram) {
    reasons.push('Negros location');
  }

  return {
    label:
      matchedTerms.length >= 2 ? 'Good Skill Fit' : reasons.length > 0 ? 'Suggested for You' : 'Open Program',
    reasons: reasons.length > 0 ? reasons : ['Open for volunteers'],
  };
}

function getStatusColor(status: Project['status']) {
  switch (status) {
    case 'In Progress':
      return '#f59e0b';
    case 'Completed':
      return '#16a34a';
    case 'Planning':
      return '#2563eb';
    case 'On Hold':
      return '#ea580c';
    case 'Cancelled':
      return '#dc2626';
    default:
      return '#64748b';
  }
}

export default function ProjectsScreen() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);

  const loadProjects = async () => {
    const negrosProjects = await getNegrosProjects();
    setProjects(negrosProjects.length > 0 ? negrosProjects : NEGROS_SAMPLE_PROJECTS);
  };

  const loadTimeLogs = async (volunteerId: string) => {
    const logs = await getVolunteerTimeLogs(volunteerId);
    setTimeLogs(logs);
  };

  useEffect(() => {
    const loadVolunteer = async () => {
      if (user?.role !== 'volunteer' || !user.id) return;
      const volunteer = await getVolunteerByUserId(user.id);
      setVolunteerProfile(volunteer);
      if (volunteer) {
        await loadTimeLogs(volunteer.id);
      }
    };

    loadProjects();
    loadVolunteer();
  }, [user]);

  const handleJoinProject = async (projectId: string) => {
    if (!user?.id) return;
    try {
      setLoadingProjectId(projectId);
      await joinProjectEvent(projectId, user.id);
      await loadProjects();
      if (volunteerProfile) {
        await loadTimeLogs(volunteerProfile.id);
      }
      Alert.alert('Joined', 'You have joined this program. Thank you!');
    } catch (error) {
      Alert.alert('Error', 'Failed to join this program. Please try again.');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleTimeIn = async (projectId: string) => {
    if (!volunteerProfile) return;
    try {
      setLoadingProjectId(projectId);
      await startVolunteerTimeLog(volunteerProfile.id, projectId);
      await loadTimeLogs(volunteerProfile.id);
      Alert.alert('Time In recorded', 'Remember to time out when you finish.');
    } catch (error: any) {
      Alert.alert('Unable to time in', error?.message || 'Please try again.');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleTimeOut = async (projectId: string) => {
    if (!volunteerProfile) return;
    try {
      setLoadingProjectId(projectId);
      const ended = await endVolunteerTimeLog(volunteerProfile.id, projectId);
      if (!ended) {
        Alert.alert('No active log', 'Please tap Time In before timing out.');
        return;
      }
      await loadTimeLogs(volunteerProfile.id);
      Alert.alert('Time Out recorded', 'Hours added to your profile.');
    } catch (error) {
      Alert.alert('Unable to time out', 'Please try again.');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const isJoined = (project: Project) => {
    const joinedUsers = project.joinedUserIds || [];
    const volunteerId = volunteerProfile?.id;
    return (
      (user?.id ? joinedUsers.includes(user.id) : false) ||
      (volunteerId ? project.volunteers.includes(volunteerId) : false)
    );
  };

  const getActiveLogForProject = (projectId: string) =>
    timeLogs.find(log => log.projectId === projectId && !log.timeOut);

  const getLatestLogForProject = (projectId: string) =>
    timeLogs.find(log => log.projectId === projectId);

  const formatTimestamp = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--';
    return format(parsed, 'MMM d, HH:mm');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Programs and Projects</Text>
      <Text style={styles.subheading}>
        {user?.role === 'volunteer'
          ? 'Negros-based recommendations are based on your saved skills and skills description.'
          : 'Current Negros-based program list and participation needs.'}
      </Text>

      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const suggestion = getProjectSuggestion(item, volunteerProfile);
          const joined = isJoined(item);
          const activeLog = getActiveLogForProject(item.id);
          const latestLog = getLatestLogForProject(item.id);

          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                Alert.alert(
                  item.title,
                  user?.role === 'volunteer'
                    ? `${item.description}\n\nSuggestion: ${suggestion.label}\nReason: ${suggestion.reasons.join(', ')}`
                    : item.description
                )
              }
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{item.title}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.category}>{item.category}</Text>
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>
                        {item.isEvent ? 'Event' : 'Program'}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.recommendationBadge}>
                  <Text style={styles.recommendationLabel}>{suggestion.label}</Text>
                </View>
              </View>

              <Text style={styles.description}>{item.description}</Text>

              {user?.role === 'volunteer' && (
                <View style={styles.volunteerActions}>
                  <Text style={styles.matchReason}>
                    Suggestion based on: {suggestion.reasons.join(', ')}
                  </Text>

                  <View style={styles.joinRow}>
                    <TouchableOpacity
                      style={[
                        styles.joinButton,
                        joined && styles.joinButtonJoined,
                        loadingProjectId === item.id && styles.joinButtonLoading,
                      ]}
                      disabled={joined || loadingProjectId === item.id}
                      onPress={() => handleJoinProject(item.id)}
                    >
                      <MaterialIcons
                        name={joined ? 'check-circle' : 'add-circle-outline'}
                        size={18}
                        color={joined ? '#155724' : '#fff'}
                      />
                      <Text
                        style={[
                          styles.joinButtonText,
                          joined && styles.joinButtonTextJoined,
                        ]}
                      >
                        {joined ? 'Joined' : 'Join Program'}
                      </Text>
                    </TouchableOpacity>

                    {joined && (
                      <TouchableOpacity
                        style={[
                          styles.timeButton,
                          activeLog ? styles.timeOutButton : styles.timeInButton,
                        ]}
                        onPress={() =>
                          activeLog ? handleTimeOut(item.id) : handleTimeIn(item.id)
                        }
                        disabled={loadingProjectId === item.id}
                      >
                        <MaterialIcons
                          name={activeLog ? 'logout' : 'login'}
                          size={16}
                          color="#fff"
                        />
                        <Text style={styles.timeButtonText}>
                          {activeLog ? 'Time Out' : 'Time In'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {joined && (
                    <View style={styles.logMeta}>
                      <Text style={styles.logMetaLabel}>
                        {activeLog ? 'Active since' : 'Last log'}
                      </Text>
                      <Text style={styles.logMetaValue}>
                        {activeLog
                          ? formatTimestamp(activeLog.timeIn)
                          : latestLog
                          ? `${formatTimestamp(latestLog.timeIn)} -> ${formatTimestamp(latestLog.timeOut)}`
                          : 'No logs yet'}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.footer}>
                <View style={styles.statusBadge}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getStatusColor(item.status) },
                    ]}
                  />
                  <Text style={styles.status}>{item.status}</Text>
                </View>
                <Text style={styles.volunteers}>
                  {item.volunteers.length}/{item.volunteersNeeded} volunteers
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 15,
    backgroundColor: '#f5f5f5',
  },
  heading: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#333',
  },
  subheading: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 15,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 15,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  category: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4CAF50',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
  },
  recommendationBadge: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recommendationLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
    lineHeight: 20,
  },
  matchReason: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: '600',
    marginBottom: 10,
  },
  volunteerActions: {
    marginBottom: 4,
    gap: 8,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  joinButtonJoined: {
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  joinButtonLoading: {
    opacity: 0.7,
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  joinButtonTextJoined: {
    color: '#155724',
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  timeInButton: {
    backgroundColor: '#2563eb',
  },
  timeOutButton: {
    backgroundColor: '#dc2626',
  },
  timeButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  logMeta: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
  },
  logMetaLabel: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
    fontWeight: '600',
  },
  logMetaValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  volunteers: {
    fontSize: 12,
    color: '#999',
  },
});
