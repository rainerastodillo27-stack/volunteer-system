import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, Text, TouchableOpacity, Alert, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProjectsScreenSnapshot,
  getVolunteerProjectMatches,
  requestVolunteerProjectJoin,
  requestPartnerProjectJoin,
  startVolunteerTimeLog,
  endVolunteerTimeLog,
  subscribeToStorageChanges,
} from '../models/storage';
import { PartnerProjectApplication, Project, Volunteer, VolunteerProjectJoinRecord, VolunteerProjectMatch, VolunteerTimeLog } from '../models/types';
import { getProjectStatusColor } from '../utils/projectStatus';

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
      reasons: [project.category, 'Volunteer-ready'],
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

export default function ProjectsScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const projectListRef = useRef<FlatList<Project> | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  const applySnapshot = useCallback((snapshot: {
    projects: Project[];
    volunteerProfile: Volunteer | null;
    timeLogs: VolunteerTimeLog[];
    partnerApplications: PartnerProjectApplication[];
    volunteerJoinRecords: VolunteerProjectJoinRecord[];
  }) => {
    startTransition(() => {
      setProjects(snapshot.projects);
      setVolunteerProfile(snapshot.volunteerProfile);
      setTimeLogs(snapshot.timeLogs);
      setPartnerApplications(snapshot.partnerApplications);
      setVolunteerJoinRecords(snapshot.volunteerJoinRecords);
    });
  }, []);

  const loadProjectsData = useCallback(async () => {
    try {
      const snapshot = await getProjectsScreenSnapshot(user);
      applySnapshot(snapshot);
      if (snapshot.volunteerProfile?.id) {
        const matches = await getVolunteerProjectMatches(snapshot.volunteerProfile.id);
        setVolunteerMatches(matches);
      } else {
        setVolunteerMatches([]);
      }
    } catch (error: any) {
      startTransition(() => {
        setProjects([]);
        setVolunteerProfile(null);
        setTimeLogs([]);
        setPartnerApplications([]);
        setVolunteerJoinRecords([]);
        setVolunteerMatches([]);
      });
      Alert.alert('Database Unavailable', error?.message || 'Failed to load projects from Postgres.');
    }
  }, [applySnapshot, user]);

  useEffect(() => {
    void loadProjectsData();
  }, [loadProjectsData]);

  useFocusEffect(
    React.useCallback(() => {
      void loadProjectsData();
    }, [loadProjectsData])
  );

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'volunteers', 'volunteerProjectJoins', 'volunteerTimeLogs', 'partnerProjectApplications', 'volunteerMatches'],
      () => {
        void loadProjectsData();
      }
    );
  }, [loadProjectsData]);

  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projects.length === 0) {
      return;
    }

    const targetIndex = projects.findIndex(project => project.id === requestedProjectId);
    if (targetIndex === -1) {
      return;
    }

    setExpandedProjectId(requestedProjectId);
    requestAnimationFrame(() => {
      projectListRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.15,
      });
    });
    navigation.setParams({ projectId: undefined });
  }, [navigation, projects, route?.params?.projectId]);

  const handleJoinProject = async (projectId: string) => {
    if (!user?.id) return;
    try {
      setLoadingProjectId(projectId);
      if (user.role === 'partner') {
        const application = await requestPartnerProjectJoin(projectId, user);
        startTransition(() => {
          setPartnerApplications(prev => {
            const withoutCurrent = prev.filter(existing => existing.id !== application.id);
            return [application, ...withoutCurrent].sort(
              (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
            );
          });
        });
        Alert.alert('Submitted', 'Admin has been notified and your request is waiting for approval.');
        return;
      }

      const requestedMatch = await requestVolunteerProjectJoin(projectId, user.id);
      startTransition(() => {
        setVolunteerMatches(prev => {
          const withoutCurrent = prev.filter(match => match.projectId !== requestedMatch.projectId);
          return [requestedMatch, ...withoutCurrent].sort(
            (a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime()
          );
        });
      });
      Alert.alert(
        'Request Sent',
        'Your join request was sent to the admin. You will be notified once it is approved or rejected.'
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to request this program. Please try again.');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleTimeIn = async (projectId: string) => {
    if (!volunteerProfile) return;
    try {
      setLoadingProjectId(projectId);
      const createdLog = await startVolunteerTimeLog(volunteerProfile.id, projectId);
      startTransition(() => {
        setTimeLogs(prev =>
          [createdLog, ...prev.filter(log => log.id !== createdLog.id)].sort(
            (a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime()
          )
        );
      });
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
      const result = await endVolunteerTimeLog(volunteerProfile.id, projectId);
      if (!result.log) {
        Alert.alert('No active log', 'Please tap Time In before timing out.');
        return;
      }
      startTransition(() => {
        setTimeLogs(prev =>
          prev
            .map(log => (log.id === result.log?.id ? result.log : log))
            .sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime())
        );
        if (result.volunteerProfile) {
          setVolunteerProfile(result.volunteerProfile);
        }
      });
      Alert.alert('Time Out recorded', 'Hours added to your profile.');
    } catch (error: any) {
      Alert.alert('Unable to time out', error?.message || 'Please try again.');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleOpenGroupChat = (projectId: string) => {
    navigation.navigate('Messages', { projectId });
  };

  const partnerApplicationByProjectId = useMemo(
    () => new Map(partnerApplications.map(app => [app.projectId, app])),
    [partnerApplications]
  );

  const activeLogByProjectId = useMemo(
    () => new Map(timeLogs.filter(log => !log.timeOut).map(log => [log.projectId, log])),
    [timeLogs]
  );

  const latestLogByProjectId = useMemo(
    () => new Map(timeLogs.map(log => [log.projectId, log])),
    [timeLogs]
  );

  const volunteerJoinRecordByProjectId = useMemo(
    () => new Map(volunteerJoinRecords.map(record => [record.projectId, record])),
    [volunteerJoinRecords]
  );

  const volunteerMatchByProjectId = useMemo(
    () => new Map(volunteerMatches.map(match => [match.projectId, match])),
    [volunteerMatches]
  );

  const isJoined = useCallback((project: Project) => {
    const joinedUsers = project.joinedUserIds || [];
    const volunteerId = volunteerProfile?.id;
    return (
      (user?.id ? joinedUsers.includes(user.id) : false) ||
      (volunteerId ? project.volunteers.includes(volunteerId) : false)
    );
  }, [user?.id, volunteerProfile?.id]);

  const formatTimestamp = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--';
    return format(parsed, 'MMM d, HH:mm');
  };

  const renderProjectItem = useCallback(({ item }: { item: Project }) => {
          const suggestion = getProjectSuggestion(item, volunteerProfile);
          const joined = isJoined(item);
          const activeLog = activeLogByProjectId.get(item.id);
          const latestLog = latestLogByProjectId.get(item.id);
          const joinRecord = volunteerJoinRecordByProjectId.get(item.id);
          const volunteerMatch = volunteerMatchByProjectId.get(item.id);
          const completedParticipation = joinRecord?.participationStatus === 'Completed';
          const isExpanded = expandedProjectId === item.id;
          const partnerApplication = partnerApplicationByProjectId.get(item.id);
          const isPendingApproval = volunteerMatch?.status === 'Requested';
          const wasRejected = volunteerMatch?.status === 'Rejected';
          const joinButtonLabel = completedParticipation
            ? 'Completed'
            : joined
            ? 'Approved'
            : isPendingApproval
            ? 'Pending Approval'
            : wasRejected
            ? 'Request Again'
            : 'Request to Join';
          const joinButtonIcon = completedParticipation
            ? 'task-alt'
            : joined
            ? 'check-circle'
            : isPendingApproval
            ? 'hourglass-empty'
            : wasRejected
            ? 'refresh'
            : 'add-circle-outline';

          return (
            <View style={styles.card}>
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

              <Pressable
                style={styles.expandToggle}
                onPress={() =>
                  setExpandedProjectId((current) => (current === item.id ? null : item.id))
                }
              >
                <Text style={styles.expandToggleText}>
                  {isExpanded ? 'Hide details' : 'Show details'}
                </Text>
                <MaterialIcons
                  name={isExpanded ? 'expand-less' : 'expand-more'}
                  size={18}
                  color="#166534"
                />
              </Pressable>

              {isExpanded && (
                <View style={styles.expandedSection}>
                  <View style={styles.expandedRow}>
                    <MaterialIcons name="place" size={18} color="#f97316" />
                    <Text style={styles.expandedText}>{item.location.address}</Text>
                  </View>
                  <View style={styles.expandedRow}>
                    <MaterialIcons name="event" size={18} color="#2563eb" />
                    <Text style={styles.expandedText}>
                      {`Schedule: ${format(new Date(item.startDate), 'MMM d, yyyy')} - ${format(
                        new Date(item.endDate),
                        'MMM d, yyyy'
                      )}`}
                    </Text>
                  </View>
                  <View style={styles.expandedRow}>
                    <MaterialIcons name="info" size={18} color="#16a34a" />
                    <Text style={styles.expandedText}>
                      {`Suggested: ${suggestion.label} • ${suggestion.reasons.join(', ')}`}
                    </Text>
                  </View>
                </View>
              )}

              {user?.role === 'volunteer' && (
                <View style={styles.volunteerActions}>
                  <Text style={styles.matchReason}>
                    Suggestion based on: {suggestion.reasons.join(', ')}
                  </Text>

                  <View style={styles.joinRow}>
                    <TouchableOpacity
                      style={[
                        styles.joinButton,
                        completedParticipation
                          ? styles.joinButtonCompleted
                          : (joined || isPendingApproval) && styles.joinButtonJoined,
                        loadingProjectId === item.id && styles.joinButtonLoading,
                      ]}
                      disabled={joined || completedParticipation || isPendingApproval || loadingProjectId === item.id}
                      onPress={() => handleJoinProject(item.id)}
                    >
                      <MaterialIcons
                        name={joinButtonIcon}
                        size={18}
                        color={
                          completedParticipation
                            ? '#166534'
                            : joined || isPendingApproval
                            ? '#155724'
                            : '#fff'
                        }
                      />
                      <Text
                        style={[
                          styles.joinButtonText,
                          completedParticipation
                            ? styles.joinButtonTextCompleted
                            : (joined || isPendingApproval) && styles.joinButtonTextJoined,
                        ]}
                      >
                        {joinButtonLabel}
                      </Text>
                    </TouchableOpacity>

                    {joined && !completedParticipation && (
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

                  {(isPendingApproval || wasRejected) && !joined && (
                    <View style={styles.logMeta}>
                      <Text style={styles.logMetaLabel}>Request status</Text>
                      <Text style={styles.logMetaValue}>
                        {isPendingApproval
                          ? 'Waiting for admin approval'
                          : 'Rejected. You may submit a new request.'}
                      </Text>
                    </View>
                  )}

                  {joined && (
                    <>
                      <TouchableOpacity
                        style={styles.groupChatButton}
                        onPress={() => handleOpenGroupChat(item.id)}
                      >
                        <MaterialIcons name="groups" size={16} color="#166534" />
                        <Text style={styles.groupChatButtonText}>Open Group Chat</Text>
                      </TouchableOpacity>

                      <View style={styles.logMeta}>
                        <Text style={styles.logMetaLabel}>Participation status</Text>
                        <Text style={styles.logMetaValue}>
                          {completedParticipation
                            ? joinRecord?.completedAt
                              ? `Completed ${formatTimestamp(joinRecord.completedAt)}`
                              : 'Completed and saved to profile'
                            : isPendingApproval
                            ? 'Waiting for admin approval'
                            : wasRejected
                            ? 'Request rejected by admin'
                            : 'Joined'}
                        </Text>
                      </View>

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
                    </>
                  )}
                </View>
              )}

              {user?.role === 'partner' && (
                <View style={styles.partnerActions}>
                  <Text style={styles.matchReason}>
                    Partner orgs can join any program to coordinate with NVC.
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.joinButton,
                      (joined || partnerApplication) && styles.joinButtonJoined,
                      loadingProjectId === item.id && styles.joinButtonLoading,
                    ]}
                    disabled={joined || !!partnerApplication || loadingProjectId === item.id}
                    onPress={() => handleJoinProject(item.id)}
                  >
                    <MaterialIcons
                      name={joined ? 'check-circle' : partnerApplication ? 'hourglass-empty' : 'group-add'}
                      size={18}
                      color={joined || partnerApplication ? '#155724' : '#fff'}
                    />
                    <Text
                      style={[
                        styles.joinButtonText,
                        (joined || partnerApplication) && styles.joinButtonTextJoined,
                      ]}
                    >
                      {joined
                        ? 'Approved as Partner'
                        : partnerApplication?.status === 'Pending'
                        ? 'Waiting for Approval'
                        : partnerApplication?.status === 'Rejected'
                        ? 'Request Rejected'
                        : 'Join as Partner'}
                    </Text>
                  </TouchableOpacity>
                  {(joined || partnerApplication) && (
                    <Text style={styles.partnerNote}>
                      {joined
                        ? 'Your org is approved as a collaborator for this program.'
                        : partnerApplication?.status === 'Pending'
                        ? 'Your request is pending admin approval.'
                        : 'This request was rejected by the admin.'}
                    </Text>
                  )}
                </View>
              )}

              {user?.role === 'admin' && (
                <View style={styles.adminActions}>
                  <Text style={styles.matchReason}>
                    Open this program to review participants, update status, and manage completion.
                  </Text>
                  <TouchableOpacity
                    style={styles.openProgramButton}
                    onPress={() => navigation.navigate('Lifecycle', { projectId: item.id })}
                  >
                    <MaterialIcons name="folder-open" size={18} color="#fff" />
                    <Text style={styles.openProgramButtonText}>Open Program</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.footer}>
                <View style={styles.statusBadge}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getProjectStatusColor(item.status) },
                    ]}
                  />
                  <Text style={styles.status}>{item.status}</Text>
                </View>
                <Text style={styles.volunteers}>
                  {item.volunteers.length}/{item.volunteersNeeded} volunteers
                </Text>
              </View>
            </View>
          );
        }, [
          activeLogByProjectId,
          expandedProjectId,
          isJoined,
          latestLogByProjectId,
          loadingProjectId,
          partnerApplicationByProjectId,
          user,
          volunteerJoinRecordByProjectId,
          volunteerProfile,
        ]);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Programs and Projects</Text>
      <Text style={styles.subheading}>
        {user?.role === 'volunteer'
          ? 'Program recommendations are based on your saved skills and skills description.'
          : user?.role === 'partner'
          ? 'Partner organizations can express interest and collaborate on any listed program.'
          : 'Current program list and participation needs.'}
      </Text>

      <FlatList
        ref={projectListRef}
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={renderProjectItem}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
        onScrollToIndexFailed={({ index }) => {
          const safeIndex = Math.max(0, Math.min(index, projects.length - 1));
          projectListRef.current?.scrollToOffset({
            offset: safeIndex * 280,
            animated: true,
          });
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
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  expandToggleText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  expandedSection: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  expandedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expandedText: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
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
  partnerActions: {
    marginBottom: 4,
    gap: 8,
  },
  adminActions: {
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
  joinButtonCompleted: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#16a34a',
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
  joinButtonTextCompleted: {
    color: '#166534',
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
  groupChatButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  groupChatButtonText: {
    color: '#166534',
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
  partnerNote: {
    fontSize: 12,
    color: '#0f172a',
  },
  openProgramButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  openProgramButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
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
