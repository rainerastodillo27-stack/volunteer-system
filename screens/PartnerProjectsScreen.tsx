import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllProjects,
  getAllVolunteerTimeLogs,
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { PartnerProjectApplication, Project, VolunteerTimeLog } from '../models/types';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

function countTrackedVolunteers(project: Project) {
  const joinedUserCount = new Set(project.joinedUserIds || []).size;
  const assignedVolunteerCount = new Set(project.volunteers || []).size;
  const taskedVolunteerCount = new Set(
    (project.internalTasks || [])
      .map(task => task.assignedVolunteerId)
      .filter((value): value is string => Boolean(value))
  ).size;

  return Math.max(joinedUserCount, assignedVolunteerCount, taskedVolunteerCount);
}

function formatDateRange(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Schedule to be announced';
  }

  const startLabel = start.toLocaleDateString();
  const endLabel = end.toLocaleDateString();
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

export default function PartnerProjectsScreen({ route }: any) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!user) {
      setProjects([]);
      setPartnerApplications([]);
      setLoading(false);
      return;
    }

    try {
      const [allProjects, snapshot, allVolunteerTimeLogs] = await Promise.all([
        getAllProjects(),
        getProjectsScreenSnapshot(user, ['partnerApplications']),
        getAllVolunteerTimeLogs(),
      ]);
      setProjects(allProjects || []);
      setPartnerApplications(snapshot.partnerApplications || []);
      setVolunteerTimeLogs(allVolunteerTimeLogs || []);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error, 'Unable to load projects'),
        message: getRequestErrorMessage(error, 'Failed to load your tracked partner projects.'),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return subscribeToStorageChanges(['projects', 'events', 'partnerProjectApplications'], () => {
        void loadData();
      });
    }, [loadData])
  );

  useFocusEffect(
    useCallback(() => {
      return subscribeToStorageChanges(['volunteerTimeLogs'], () => {
        void loadData();
      });
    }, [loadData])
  );

  const approvedProjectIds = useMemo(
    () =>
      new Set(
        partnerApplications
          .filter(
            application =>
              application.status === 'Approved' &&
              Boolean(application.projectId) &&
              !String(application.projectId).startsWith('program:')
          )
          .map(application => application.projectId)
      ),
    [partnerApplications]
  );

  const trackedProjects = useMemo(
    () =>
      projects
        .filter(project => !project.isEvent && approvedProjectIds.has(project.id))
        .sort(
          (left, right) =>
            new Date(right.updatedAt || right.createdAt).getTime() -
            new Date(left.updatedAt || left.createdAt).getTime()
        ),
    [approvedProjectIds, projects]
  );

  const projectMetrics = useMemo(
    () =>
      trackedProjects.map(project => {
        const linkedEvents = projects
          .filter(event => event.isEvent && event.parentProjectId === project.id)
          .sort(
            (left, right) =>
              new Date(left.startDate).getTime() - new Date(right.startDate).getTime()
          );
        const volunteerJoinCount = linkedEvents.reduce(
          (sum, event) => sum + countTrackedVolunteers(event),
          0
        );
        const verifiedAttendanceCount = linkedEvents.reduce(
          (sum, event) =>
            sum +
            volunteerTimeLogs.filter(
              log => log.projectId === event.id && Boolean(log.timeOut)
            ).length,
          0
        );
        const activeEventCount = linkedEvents.filter(event => {
          const status = getProjectDisplayStatus(event);
          return status !== 'Completed' && status !== 'Cancelled';
        }).length;

        return {
          project,
          linkedEvents,
          volunteerJoinCount,
          verifiedAttendanceCount,
          activeEventCount,
        };
      }),
    [projects, trackedProjects, volunteerTimeLogs]
  );

  const summary = useMemo(() => {
    const totalEvents = projectMetrics.reduce((sum, entry) => sum + entry.linkedEvents.length, 0);
    const totalVolunteerJoins = projectMetrics.reduce((sum, entry) => sum + entry.volunteerJoinCount, 0);
    const totalVerifiedAttendance = projectMetrics.reduce(
      (sum, entry) => sum + entry.verifiedAttendanceCount,
      0
    );
    const activeProjects = projectMetrics.filter(entry => {
      const status = getProjectDisplayStatus(entry.project);
      return status !== 'Completed' && status !== 'Cancelled';
    }).length;

    return {
      totalProjects: projectMetrics.length,
      totalEvents,
      totalVolunteerJoins,
      totalVerifiedAttendance,
      activeProjects,
    };
  }, [projectMetrics]);

  useEffect(() => {
    const targetProjectId = String(route?.params?.projectId || '').trim();
    if (!targetProjectId) {
      return;
    }

    if (projectMetrics.some(entry => entry.project.id === targetProjectId)) {
      setSelectedProjectId(targetProjectId);
    }
  }, [projectMetrics, route?.params?.projectId]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadData();
  }, [loadData]);

  const selectedProjectMetrics = useMemo(
    () =>
      selectedProjectId
        ? projectMetrics.find(entry => entry.project.id === selectedProjectId) || null
        : null,
    [projectMetrics, selectedProjectId]
  );

  if (loading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color="#166534" />
        <Text style={styles.centerStateText}>Loading your projects...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#166534" />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>Partner Tracking</Text>
            <Text style={styles.heroTitle}>My Projects</Text>
            <Text style={styles.heroSubtitle}>
              Tap a project box to open its events, volunteer joins, and current progress.
            </Text>
          </View>
          <View style={styles.heroIcon}>
            <MaterialIcons name="analytics" size={28} color="#d1fae5" />
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{summary.totalProjects}</Text>
            <Text style={styles.summaryLabel}>Projects</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{summary.totalEvents}</Text>
            <Text style={styles.summaryLabel}>Events</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{summary.totalVolunteerJoins}</Text>
            <Text style={styles.summaryLabel}>Joins</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{summary.totalVerifiedAttendance}</Text>
            <Text style={styles.summaryLabel}>Verified</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{summary.activeProjects}</Text>
            <Text style={styles.summaryLabel}>Active</Text>
          </View>
        </View>
      </View>

      {loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{loadError.title}</Text>
          <Text style={styles.errorText}>{loadError.message}</Text>
        </View>
      ) : null}

      {projectMetrics.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialIcons name="assignment" size={26} color="#64748b" />
          <Text style={styles.emptyTitle}>No approved projects yet</Text>
          <Text style={styles.emptyText}>
            Approved partner proposal projects will appear here once the admin accepts them.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.availableProgramHeader}>Available Program</Text>
          <View style={styles.boxList}>
            {projectMetrics.map(({ project, linkedEvents, volunteerJoinCount, verifiedAttendanceCount, activeEventCount }) => {
              const projectStatus = getProjectDisplayStatus(project);

              return (
                <TouchableOpacity
                  key={project.id}
                  style={styles.projectBox}
                  activeOpacity={0.9}
                  onPress={() => setSelectedProjectId(project.id)}
                >
                  <View style={styles.projectBoxTopRow}>
                    <View style={styles.projectBoxCopy}>
                      <Text style={styles.projectBoxTitle} numberOfLines={1}>
                        {project.title}
                      </Text>
                      <Text style={styles.projectBoxMeta} numberOfLines={1}>
                        {project.programModule || project.category}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusChip,
                        { backgroundColor: `${getProjectStatusColor(project)}20` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusChipText,
                          { color: getProjectStatusColor(project) },
                        ]}
                      >
                        {projectStatus}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.projectStatRow}>
                    <View style={styles.projectStatMini}>
                      <Text style={styles.projectStatValue}>{linkedEvents.length}</Text>
                      <Text style={styles.projectStatLabel}>Linked Events</Text>
                    </View>
                    <View style={styles.projectStatMini}>
                      <Text style={styles.projectStatValue}>{volunteerJoinCount}</Text>
                      <Text style={styles.projectStatLabel}>Volunteer Joins</Text>
                    </View>
                    <View style={styles.projectStatMini}>
                      <Text style={styles.projectStatValue}>{verifiedAttendanceCount}</Text>
                      <Text style={styles.projectStatLabel}>Verified Attendance</Text>
                    </View>
                    <View style={styles.projectStatMini}>
                      <Text style={styles.projectStatValue}>{activeEventCount}</Text>
                      <Text style={styles.projectStatLabel}>Active Events</Text>
                    </View>
                  </View>

                  <View style={styles.projectBoxFooter}>
                    <Text style={styles.projectBoxFooterText} numberOfLines={1}>
                      {project.location.address || 'Location to be announced'}
                    </Text>
                    <Text style={styles.projectTapHint}>
                      Tap to view details
                    </Text>
                    <MaterialIcons name="open-in-full" size={18} color="#166534" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Modal
        visible={Boolean(selectedProjectMetrics)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedProjectId(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropDismiss} onPress={() => setSelectedProjectId(null)} />
          <View style={styles.modalCard}>
            {selectedProjectMetrics ? (
              <>
                <View style={styles.modalHeader}>
                  <View style={styles.modalHeaderCopy}>
                    <Text style={styles.modalTitle}>{selectedProjectMetrics.project.title}</Text>
                    <Text style={styles.modalSubtitle}>
                      {selectedProjectMetrics.project.programModule || selectedProjectMetrics.project.category}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.modalCloseButton}
                    onPress={() => setSelectedProjectId(null)}
                    hitSlop={8}
                  >
                    <MaterialIcons name="close" size={20} color="#0f172a" />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.modalContentScroll}
                  contentContainerStyle={styles.modalContentScrollContent}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.modalMetricRow}>
                    <View style={styles.modalMetricCard}>
                      <Text style={styles.modalMetricValue}>{selectedProjectMetrics.linkedEvents.length}</Text>
                      <Text style={styles.modalMetricLabel}>Events</Text>
                    </View>
                    <View style={styles.modalMetricCard}>
                      <Text style={styles.modalMetricValue}>{selectedProjectMetrics.volunteerJoinCount}</Text>
                      <Text style={styles.modalMetricLabel}>Joins</Text>
                    </View>
                    <View style={styles.modalMetricCard}>
                      <Text style={styles.modalMetricValue}>{selectedProjectMetrics.verifiedAttendanceCount}</Text>
                      <Text style={styles.modalMetricLabel}>Verified</Text>
                    </View>
                    <View style={styles.modalMetricCard}>
                      <Text style={styles.modalMetricValue}>{selectedProjectMetrics.activeEventCount}</Text>
                      <Text style={styles.modalMetricLabel}>Active</Text>
                    </View>
                  </View>

                  <Text style={styles.projectDetailText}>
                    {selectedProjectMetrics.project.location.address || 'Location to be announced'}
                  </Text>
                  <Text style={styles.projectDetailText}>
                    {formatDateRange(
                      selectedProjectMetrics.project.startDate,
                      selectedProjectMetrics.project.endDate
                    )}
                  </Text>
                  <Text style={styles.projectDetailText}>
                    {selectedProjectMetrics.project.description || 'No project description yet.'}
                  </Text>

                  <Text style={styles.eventSectionTitle}>Inside This Project</Text>
                  {selectedProjectMetrics.linkedEvents.length === 0 ? (
                    <View style={styles.eventEmptyCard}>
                      <Text style={styles.eventEmptyText}>
                        No admin-created events have been attached to this project yet.
                      </Text>
                    </View>
                  ) : (
                    selectedProjectMetrics.linkedEvents.map(event => {
                      const eventStatus = getProjectDisplayStatus(event);
                      const eventVolunteerCount = countTrackedVolunteers(event);
                      const eventVerifiedAttendanceCount = volunteerTimeLogs.filter(
                        log => log.projectId === event.id && Boolean(log.timeOut)
                      ).length;

                      return (
                        <View key={event.id} style={styles.eventItem}>
                          <View style={styles.eventItemTopRow}>
                            <View style={styles.eventItemCopy}>
                              <Text style={styles.eventItemTitle}>{event.title}</Text>
                              <Text style={styles.eventItemMeta}>
                                {formatDateRange(event.startDate, event.endDate)}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.statusChip,
                                { backgroundColor: `${getProjectStatusColor(event)}20` },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusChipText,
                                  { color: getProjectStatusColor(event) },
                                ]}
                              >
                                {eventStatus}
                              </Text>
                            </View>
                          </View>

                          <Text style={styles.eventAddress}>
                            {event.location.address || 'Location to be announced'}
                          </Text>

                          <View style={styles.eventPillRow}>
                            <View style={styles.eventPill}>
                              <MaterialIcons name="groups" size={14} color="#475569" />
                              <Text style={styles.eventPillText}>
                                {eventVolunteerCount} volunteer
                                {eventVolunteerCount === 1 ? '' : 's'} joined
                              </Text>
                            </View>
                            <View style={styles.eventPill}>
                              <MaterialIcons name="people-outline" size={14} color="#475569" />
                              <Text style={styles.eventPillText}>
                                Need {event.volunteersNeeded}
                              </Text>
                            </View>
                            <View style={styles.eventPill}>
                              <MaterialIcons name="verified" size={14} color="#475569" />
                              <Text style={styles.eventPillText}>
                                {eventVerifiedAttendanceCount} verified attendance
                              </Text>
                            </View>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#edf6ee',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#edf6ee',
  },
  centerStateText: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  heroCard: {
    backgroundColor: '#14532d',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroCopy: {
    flex: 1,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#bbf7d0',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 19,
    color: '#dcfce7',
    fontWeight: '600',
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  summaryPill: {
    minWidth: '47%',
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    padding: 12,
  },
  summaryValue: {
    fontSize: 19,
    fontWeight: '900',
    color: '#ffffff',
  },
  summaryLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#d1fae5',
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991b1b',
  },
  errorText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#7f1d1d',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: '#dbe7dc',
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    color: '#64748b',
  },
  availableProgramHeader: {
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  boxList: {
    gap: 12,
  },
  projectBox: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe7dc',
    padding: 12,
  },
  projectBoxTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  projectBoxCopy: {
    flex: 1,
  },
  projectBoxTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    color: '#0f172a',
  },
  projectBoxMeta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  projectStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  projectStatMini: {
    width: '48%',
    borderRadius: 12,
    backgroundColor: '#f8fbf8',
    borderWidth: 1,
    borderColor: '#dbe7dc',
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  projectStatValue: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0f172a',
  },
  projectStatLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 13,
  },
  projectBoxFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  projectBoxFooterText: {
    flex: 1,
    fontSize: 10,
    color: '#64748b',
  },
  projectTapHint: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    justifyContent: 'center',
    padding: 18,
  },
  modalBackdropDismiss: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    maxHeight: '82%',
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbe7dc',
    overflow: 'hidden',
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  modalHeaderCopy: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  modalCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  modalMetricCard: {
    flex: 1,
    minWidth: '47%',
    borderRadius: 14,
    backgroundColor: '#f8fbf8',
    borderWidth: 1,
    borderColor: '#dbe7dc',
    padding: 10,
  },
  modalMetricValue: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  modalMetricLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  modalContentScroll: {
    marginTop: 6,
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  modalContentScrollContent: {
    paddingBottom: 16,
  },
  projectDetailPanel: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#dbe7dc',
    paddingTop: 12,
    gap: 8,
  },
  projectDetailText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#334155',
  },
  eventSectionTitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
  },
  eventEmptyCard: {
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
  eventEmptyText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  eventItem: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7dc',
    padding: 12,
    marginTop: 6,
  },
  eventItemTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  eventItemCopy: {
    flex: 1,
  },
  eventItemTitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
    color: '#0f172a',
  },
  eventItemMeta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  eventAddress: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 17,
    color: '#64748b',
  },
  eventPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  eventPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f8fbf8',
    borderWidth: 1,
    borderColor: '#dbe7dc',
  },
  eventPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
});
