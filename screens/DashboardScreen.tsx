import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  getAllVolunteerTimeLogs,
  getAllPartnerReports,
  getAllPublishedImpactReports,
  getDashboardSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import type { Project, Volunteer } from '../models/types';
import { useAuth } from '../contexts/AuthContext';
import { navigateToAvailableRoute } from '../utils/navigation';
import VolunteerImpactMap from '../components/VolunteerImpactMap';
import { getRequestErrorMessage } from '../utils/requestErrors';

function formatShortDate(value?: string) {
  if (!value) {
    return 'TBD';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'TBD';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getMonthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function getMonthGrid(date: Date): Array<number | null> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [];

  for (let i = 0; i < firstDay; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(day);
  }

  while (cells.length < 42) {
    cells.push(null);
  }

  return cells;
}

// Shows the latest dashboard metrics and shortcuts for the logged-in user.
export default function DashboardScreen({ navigation }: any) {
  const { user, isAdmin, logout } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' || width >= 1100;

  const [projectStats, setProjectStats] = useState({ total: 0, active: 0, completed: 0 });
  const [partnerStats, setPartnerStats] = useState({ total: 0, approved: 0, pending: 0 });
  const [userStats, setUserStats] = useState({ total: 0 });
  const [workflowStats, setWorkflowStats] = useState({
    inboundInquiries: 0,
    timeIns: 0,
    timeOuts: 0,
    pendingReports: 0,
    publishedReports: 0,
  });
  const [timeTrackingTarget, setTimeTrackingTarget] = useState({
    latestTimeInProjectId: undefined as string | undefined,
    latestTimeOutProjectId: undefined as string | undefined,
  });
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [projectsData, setProjectsData] = useState<Project[]>([]);
  const [volunteersData, setVolunteersData] = useState<Volunteer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Loads dashboard totals and recent status updates from storage.
  const loadDashboardData = React.useCallback(async () => {
    try {
      const [{ projects, partners, users, volunteers, statusUpdates }, volunteerTimeLogs, partnerReports, impactReports] =
        await Promise.all([
          getDashboardSnapshot(),
          getAllVolunteerTimeLogs(),
          getAllPartnerReports(),
          getAllPublishedImpactReports(),
        ]);

      setLoadError(null);
      setProjectsData(projects);
      setVolunteersData(volunteers);

      setProjectStats({
        total: projects.length,
        active: projects.filter(p => p.status === 'In Progress').length,
        completed: projects.filter(p => p.status === 'Completed').length,
      });

      setPartnerStats({
        total: partners.length,
        approved: partners.filter(p => p.status === 'Approved').length,
        pending: partners.filter(p => p.status === 'Pending').length,
      });

      setUserStats({
        total: users.length,
      });

      setWorkflowStats({
        inboundInquiries: partners.filter(p => p.status === 'Pending').length,
        timeIns: volunteerTimeLogs.length,
        timeOuts: volunteerTimeLogs.filter(log => Boolean(log.timeOut)).length,
        pendingReports: partnerReports.filter(report => report.status === 'Submitted').length,
        publishedReports: impactReports.filter(report => Boolean(report.publishedAt)).length,
      });

      const latestTimeInLog = volunteerTimeLogs[0];
      const latestTimeOutLog = volunteerTimeLogs.find(log => Boolean(log.timeOut)) || null;
      setTimeTrackingTarget({
        latestTimeInProjectId: latestTimeInLog?.projectId,
        latestTimeOutProjectId: latestTimeOutLog?.projectId,
      });

      const projectNamesById = new Map(projects.map(project => [project.id, project.title]));
      const allUpdates = statusUpdates
        .map(update => ({
          ...update,
          projectName: projectNamesById.get(update.projectId) || 'Unknown Project',
        }))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      setRecentUpdates(allUpdates.slice(0, 6));
    } catch (error) {
      const errorMessage = getRequestErrorMessage(
        error,
        'Database data is unavailable. Check the backend and Supabase connection.'
      );
      setLoadError(errorMessage);
      setRecentUpdates([]);
      setProjectsData([]);
      setVolunteersData([]);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void loadDashboardData();
      return subscribeToStorageChanges(
        [
          'users',
          'projects',
          'partners',
          'volunteers',
          'statusUpdates',
          'volunteerProjectJoins',
          'volunteerTimeLogs',
          'partnerReports',
          'publishedImpactReports',
        ],
        () => {
          void loadDashboardData();
        }
      );
    }, [loadDashboardData])
  );

  // Confirms logout before clearing the current authenticated session.
  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Are you sure you want to logout?') : true;
      if (confirmed) {
        await logout();
      }
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Logout',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  };

  const displayName = Platform.OS === 'web' && user?.role === 'admin' ? 'NVC Admin Account' : user?.name;
  const roleLabel =
    user?.role === 'admin'
      ? Platform.OS === 'web'
        ? 'NVC Admin Account'
        : 'Administrator'
      : 'Volunteer Account';

  const openProjects = React.useCallback(
    (projectId?: string) => {
      navigateToAvailableRoute(navigation, 'Projects', projectId ? { projectId } : undefined);
    },
    [navigation]
  );

  const openPartners = React.useCallback(() => {
    navigateToAvailableRoute(navigation, 'Partners', undefined, { routeName: 'Dashboard' });
  }, [navigation]);

  const openUsers = React.useCallback(() => {
    navigateToAvailableRoute(navigation, 'Users', undefined, { routeName: 'Dashboard' });
  }, [navigation]);

  const openLifecycle = React.useCallback(
    (projectId?: string) => {
      navigateToAvailableRoute(
        navigation,
        'Lifecycle',
        projectId ? { projectId } : undefined,
        {
          routeName: 'Projects',
          params: projectId ? { projectId } : undefined,
        }
      );
    },
    [navigation]
  );

  const openMessages = React.useCallback(
    (projectId?: string) => {
      navigateToAvailableRoute(navigation, 'Messages', projectId ? { projectId } : undefined, {
        routeName: 'Dashboard',
      });
    },
    [navigation]
  );

  const mapProjects = useMemo(
    () =>
      projectsData.filter(
        project =>
          Number.isFinite(project.location?.latitude) &&
          Number.isFinite(project.location?.longitude)
      ),
    [projectsData]
  );

  const upcomingPrograms = useMemo(() => {
    return [...projectsData]
      .filter(project => project.status === 'Planning' || project.status === 'In Progress')
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 4);
  }, [projectsData]);

  const activeVolunteers = useMemo(
    () =>
      [...volunteersData]
        .sort((a, b) => (b.totalHoursContributed || 0) - (a.totalHoursContributed || 0))
        .slice(0, 3),
    [volunteersData]
  );

  const calendarDate = useMemo(() => new Date(), []);
  const monthGrid = useMemo(() => getMonthGrid(calendarDate), [calendarDate]);
  const monthLabel = useMemo(() => getMonthLabel(calendarDate), [calendarDate]);
  const currentDay = calendarDate.getDate();

  const eventCountByDay = useMemo(() => {
    const map = new Map<number, number>();
    projectsData.forEach(project => {
      const startDate = new Date(project.startDate);
      if (Number.isNaN(startDate.getTime())) {
        return;
      }
      if (
        startDate.getMonth() !== calendarDate.getMonth() ||
        startDate.getFullYear() !== calendarDate.getFullYear()
      ) {
        return;
      }
      map.set(startDate.getDate(), (map.get(startDate.getDate()) || 0) + 1);
    });
    return map;
  }, [projectsData, calendarDate]);

  const messagesCount = workflowStats.timeIns + workflowStats.pendingReports;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName?.charAt(0) ?? 'N'}</Text>
          </View>
          <View style={styles.userCopy}>
            <Text style={styles.greeting}>Welcome, {displayName}</Text>
            <Text style={styles.role}>{roleLabel}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout}>
            <MaterialIcons name="logout" size={22} color="#335a42" />
          </TouchableOpacity>
        </View>
      </View>

      {loadError ? (
        <View style={styles.errorBanner}>
          <MaterialIcons name="error-outline" size={20} color="#8f2222" />
          <Text style={styles.errorBannerText}>{loadError}</Text>
          <TouchableOpacity onPress={loadDashboardData}>
            <Text style={styles.errorBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.topGrid, !isDesktop && styles.stackGrid]}>
        <View style={styles.trendCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Volunteer Applications</Text>
            <TouchableOpacity onPress={() => openProjects()}>
              <Text style={styles.cardMeta}>View all projects</Text>
            </TouchableOpacity>
          </View>

          {mapProjects.length ? (
            <VolunteerImpactMap projects={mapProjects} />
          ) : (
            <View style={styles.mapFallback}>
              <MaterialIcons name="map" size={28} color="#2f8f45" />
              <Text style={styles.mapFallbackText}>No mapped projects available yet.</Text>
            </View>
          )}
        </View>

        <View style={styles.calendarCard}>
          <View style={styles.upcomingPane}>
            <Text style={styles.upcomingTitle}>Upcoming Programs</Text>
            {upcomingPrograms.length ? (
              upcomingPrograms.map(program => (
                <TouchableOpacity
                  key={program.id}
                  style={styles.upcomingRow}
                  onPress={() => openProjects(program.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.upcomingName} numberOfLines={1}>{program.title}</Text>
                  <Text style={styles.upcomingDate}>{formatShortDate(program.startDate)}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.upcomingEmpty}>No upcoming programs yet.</Text>
            )}
          </View>

          <View style={styles.monthPane}>
            <View style={styles.monthTopRow}>
              <View>
                <Text style={styles.todayLabel}>{calendarDate.toLocaleDateString(undefined, { weekday: 'long' })}</Text>
                <Text style={styles.todayDate}>{calendarDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</Text>
              </View>
              <Text style={styles.yearLabel}>{calendarDate.getFullYear()}</Text>
            </View>

            <Text style={styles.monthHeading}>{monthLabel}</Text>

            <View style={styles.weekLabelRow}>
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                <Text key={day} style={styles.weekLabel}>{day}</Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {monthGrid.map((day, index) => {
                const hasEvent = typeof day === 'number' && eventCountByDay.has(day);
                const isToday = day === currentDay;

                return (
                  <TouchableOpacity
                    key={`${day || 'empty'}-${index}`}
                    style={[
                      styles.dayCell,
                      day === null && styles.dayCellEmpty,
                      hasEvent && styles.dayCellEvent,
                      isToday && styles.dayCellToday,
                    ]}
                    onPress={() => {
                      if (hasEvent) {
                        openLifecycle();
                      }
                    }}
                    activeOpacity={0.85}
                    disabled={day === null}
                  >
                    <Text style={[styles.dayText, day === null && styles.dayTextEmpty, hasEvent && styles.dayTextEvent]}>
                      {day ?? ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.bottomGrid, !isDesktop && styles.stackGrid]}>
        <View style={styles.cardBase}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Active Volunteers</Text>
            <TouchableOpacity onPress={openUsers}>
              <Text style={styles.cardMeta}>View users</Text>
            </TouchableOpacity>
          </View>

          {activeVolunteers.length ? (
            activeVolunteers.map(volunteer => {
              const progress = Math.min(100, Math.max(8, (volunteer.totalHoursContributed || 0) * 3));
              return (
                <View key={volunteer.id} style={styles.volunteerRow}>
                  <View style={styles.volunteerAvatar}>
                    <Text style={styles.volunteerAvatarText}>{String(volunteer.name || 'V').charAt(0)}</Text>
                  </View>
                  <View style={styles.volunteerBody}>
                    <Text style={styles.volunteerName} numberOfLines={1}>{volunteer.name}</Text>
                    <View style={styles.volunteerTrack}>
                      <View style={[styles.volunteerFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.volunteerMeta}>{(volunteer.pastProjects || []).length} programs joined</Text>
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={styles.newsEmpty}>No active volunteer records yet.</Text>
          )}
        </View>

        <TouchableOpacity style={styles.messagesCard} onPress={() => openMessages()} activeOpacity={0.85}>
          <MaterialIcons name="chat-bubble-outline" size={30} color="#f1fff4" />
          <Text style={styles.messagesValue}>{messagesCount}</Text>
          <Text style={styles.messagesTitle}>Messages</Text>
          <Text style={styles.messagesSub}>Posted by our users</Text>
        </TouchableOpacity>

        <View style={styles.statisticsCard}>
          <Text style={styles.statisticsTitle}>Statistics</Text>
          <View style={styles.statLine}><Text style={styles.statKey}>Total Users</Text><Text style={styles.statNumber}>{userStats.total}</Text></View>
          <View style={styles.statLine}><Text style={styles.statKey}>New Applicants</Text><Text style={styles.statNumber}>{partnerStats.pending}</Text></View>
          <View style={styles.statLine}><Text style={styles.statKey}>Upcoming Programs</Text><Text style={styles.statNumber}>{upcomingPrograms.length}</Text></View>
          <View style={[styles.statLine, styles.statLineLast]}><Text style={styles.statKey}>Total Programs</Text><Text style={styles.statNumber}>{projectStats.total}</Text></View>
        </View>

        <View style={styles.newsCard}>
          <Text style={styles.newsTitle}>News & Announcements</Text>
          {recentUpdates.length ? (
            recentUpdates.slice(0, 3).map((update, index) => (
              <TouchableOpacity
                key={update.id || index}
                style={[styles.newsRow, index === 2 && styles.newsRowLast]}
                onPress={() => openLifecycle(update.projectId)}
                activeOpacity={0.85}
              >
                <View style={styles.newsThumb}>
                  <MaterialIcons name={index === 0 ? 'event' : index === 1 ? 'campaign' : 'photo'} size={18} color="#e8ffe9" />
                </View>
                <View style={styles.newsCopy}>
                  <Text style={styles.newsDate}>{formatShortDate(update.updatedAt)}</Text>
                  <Text style={styles.newsProject} numberOfLines={1}>{update.projectName || 'Project update'}</Text>
                  <Text style={styles.newsBody} numberOfLines={2}>{update.description || 'Status update posted.'}</Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.newsEmpty}>No announcements yet.</Text>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>NVC CONNECT v1.0</Text>
      </View>
    </ScrollView>
  );
}

const green = {
  page: '#eef5ef',
  card: '#ffffff',
  cardBorder: '#d8e8db',
  ink: '#203a2a',
  muted: '#5e7b65',
  strong: '#2f8f45',
  strongDark: '#236d35',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: green.page,
  },
  content: {
    paddingBottom: 20,
  },
  header: {
    backgroundColor: green.card,
    borderBottomWidth: 1,
    borderBottomColor: green.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  userCopy: {
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: green.strong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
  },
  greeting: {
    fontSize: 15,
    fontWeight: '700',
    color: green.ink,
  },
  role: {
    marginTop: 2,
    fontSize: 12,
    color: green.muted,
  },
  errorBanner: {
    marginHorizontal: 14,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorBannerText: {
    flex: 1,
    color: '#8f2222',
    fontSize: 12,
    lineHeight: 18,
  },
  errorBannerAction: {
    color: '#8f2222',
    fontSize: 12,
    fontWeight: '700',
  },
  topGrid: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 14,
  },
  bottomGrid: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 14,
    alignItems: 'stretch',
  },
  stackGrid: {
    flexDirection: 'column',
  },
  trendCard: {
    flex: 1.45,
    backgroundColor: green.card,
    borderWidth: 1,
    borderColor: green.cardBorder,
    borderRadius: 14,
    padding: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: green.ink,
  },
  cardMeta: {
    fontSize: 11,
    color: green.muted,
    fontWeight: '600',
  },
  mapFallback: {
    minHeight: 220,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d9e7dc',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f8fcf8',
  },
  mapFallbackText: {
    color: green.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  calendarCard: {
    flex: 1.2,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#bde0c6',
    flexDirection: 'row',
    minHeight: 320,
  },
  upcomingPane: {
    width: '40%',
    backgroundColor: green.strong,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  upcomingTitle: {
    color: '#f1fff4',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  upcomingRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.25)',
  },
  upcomingName: {
    color: '#f7fff8',
    fontSize: 12,
    fontWeight: '600',
  },
  upcomingDate: {
    marginTop: 2,
    color: '#d6f8de',
    fontSize: 11,
    fontWeight: '700',
  },
  upcomingEmpty: {
    marginTop: 10,
    color: '#d9f7df',
    fontSize: 12,
  },
  monthPane: {
    flex: 1,
    backgroundColor: green.card,
    padding: 12,
  },
  monthTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  todayLabel: {
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '400',
    color: green.ink,
  },
  todayDate: {
    marginTop: 2,
    fontSize: 13,
    color: green.ink,
    fontWeight: '700',
  },
  yearLabel: {
    fontSize: 36,
    lineHeight: 38,
    fontWeight: '400',
    color: green.ink,
  },
  monthHeading: {
    marginTop: 8,
    marginBottom: 8,
    textAlign: 'center',
    color: green.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  weekLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  weekLabel: {
    width: '14.28%',
    textAlign: 'center',
    color: '#7a9181',
    fontSize: 10,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  dayCellEmpty: {
    backgroundColor: 'transparent',
  },
  dayCellEvent: {
    backgroundColor: '#3cae58',
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: green.strong,
  },
  dayText: {
    fontSize: 11,
    color: '#647f6c',
    fontWeight: '600',
  },
  dayTextEmpty: {
    color: 'transparent',
  },
  dayTextEvent: {
    color: '#f5fff7',
    fontWeight: '700',
  },
  cardBase: {
    flex: 1,
    backgroundColor: green.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: green.cardBorder,
    padding: 12,
    minHeight: 250,
  },
  volunteerRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  volunteerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#dff2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volunteerAvatarText: {
    color: green.strongDark,
    fontSize: 12,
    fontWeight: '700',
  },
  volunteerBody: {
    flex: 1,
  },
  volunteerName: {
    color: green.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  volunteerTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#dbe9df',
  },
  volunteerFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: green.strong,
  },
  volunteerMeta: {
    marginTop: 4,
    fontSize: 10,
    color: green.muted,
  },
  messagesCard: {
    flex: 0.75,
    backgroundColor: green.strong,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: green.strongDark,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 250,
    padding: 12,
  },
  messagesValue: {
    marginTop: 6,
    fontSize: 40,
    lineHeight: 44,
    color: '#effff2',
    fontWeight: '700',
  },
  messagesTitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#f1fff4',
    fontWeight: '700',
  },
  messagesSub: {
    marginTop: 2,
    color: '#d9f5df',
    fontSize: 11,
  },
  statisticsCard: {
    flex: 0.85,
    backgroundColor: '#dff3e3',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#b5dcbf',
    minHeight: 250,
    padding: 12,
  },
  statisticsTitle: {
    textAlign: 'center',
    fontSize: 21,
    fontWeight: '700',
    color: green.ink,
    marginBottom: 8,
  },
  statLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(32,58,42,0.12)',
    paddingVertical: 9,
  },
  statLineLast: {
    borderBottomWidth: 0,
  },
  statKey: {
    color: '#315844',
    fontSize: 12,
  },
  statNumber: {
    color: '#1f3f2d',
    fontSize: 12,
    fontWeight: '700',
  },
  newsCard: {
    flex: 1.4,
    backgroundColor: green.strong,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: green.strongDark,
    minHeight: 250,
    padding: 12,
  },
  newsTitle: {
    textAlign: 'center',
    color: '#f4fff6',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  newsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.24)',
  },
  newsRowLast: {
    borderBottomWidth: 0,
  },
  newsThumb: {
    width: 58,
    height: 38,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newsCopy: {
    flex: 1,
  },
  newsDate: {
    color: '#d7f2dd',
    fontSize: 10,
    fontWeight: '700',
  },
  newsProject: {
    marginTop: 1,
    color: '#f4fff6',
    fontSize: 13,
    fontWeight: '700',
  },
  newsBody: {
    marginTop: 2,
    color: '#e9f8eb',
    fontSize: 11,
    lineHeight: 15,
  },
  newsEmpty: {
    color: '#d7f2dd',
    fontSize: 12,
    marginTop: 8,
  },
  footer: {
    paddingTop: 18,
    paddingBottom: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#7f9987',
  },
});
