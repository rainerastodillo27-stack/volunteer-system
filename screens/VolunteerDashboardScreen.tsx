import React, { useMemo, useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ProjectTimelineCalendarCard from '../components/ProjectTimelineCalendarCard';
import { useAuth } from '../contexts/AuthContext';
import {
  getDashboardTimelineSnapshot,
  getMessagesForUser,
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import type { AdminPlanningCalendar, AdminPlanningItem, Project, Volunteer, VolunteerTimeLog } from '../models/types';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

function formatLongDate(value?: string): string {
  if (!value) {
    return 'To be announced';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'To be announced';
  }

  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function getUpcomingProject(projects: Project[]): Project | null {
  const now = new Date();

  return (
    [...projects]
      .filter(project => {
        if (project.status === 'Cancelled') {
          return false;
        }

        const endDate = new Date(project.endDate || project.startDate);
        return !Number.isNaN(endDate.getTime()) && endDate >= now;
      })
      .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime())[0] || null
  );
}

function getVolunteerStatusTone(status?: Volunteer['registrationStatus']) {
  switch (status) {
    case 'Approved':
      return {
        badge: '#dcfce7',
        text: '#166534',
      };
    case 'Rejected':
      return {
        badge: '#fee2e2',
        text: '#b91c1c',
      };
    default:
      return {
        badge: '#fef3c7',
        text: '#b45309',
      };
  }
}

// Shows a streamlined volunteer dashboard with project details and admin-synced scheduling.
export default function VolunteerDashboardScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);
  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);

  const loadDashboardData = React.useCallback(async () => {
    if (!user?.id) {
      return;
    }

    try {
      const [projectSnapshot, timelineSnapshot, messages] = await Promise.all([
        getProjectsScreenSnapshot(user),
        getDashboardTimelineSnapshot(),
        getMessagesForUser(user.id),
      ]);

      setProjects(projectSnapshot.projects);
      setVolunteerProfile(projectSnapshot.volunteerProfile);
      setTimeLogs(projectSnapshot.timeLogs);
      setUnreadMessages(messages.filter(message => !message.read && message.recipientId === user.id).length);
      setPlanningCalendars(timelineSnapshot.planningCalendars);
      setPlanningItems(timelineSnapshot.planningItems);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load the volunteer dashboard.'),
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    React.useCallback(() => {
      void loadDashboardData();

      return subscribeToStorageChanges(
        [
          'projects',
          'volunteerProjectJoins',
          'volunteerMatches',
          'volunteerTimeLogs',
          'adminPlanningCalendars',
          'adminPlanningItems',
        ],
        () => {
          void loadDashboardData();
        }
      );
    }, [loadDashboardData])
  );

  const joinedProjects = useMemo(
    () => projects.filter(project => (project.joinedUserIds || []).includes(user?.id || '')),
    [projects, user?.id]
  );

  const upcomingProject = useMemo(() => getUpcomingProject(joinedProjects), [joinedProjects]);
  const suggestedProject = useMemo(() => getUpcomingProject(projects), [projects]);
  const featuredProject = upcomingProject || suggestedProject;
  const volunteerTone = getVolunteerStatusTone(volunteerProfile?.registrationStatus);

  const totalHours = volunteerProfile?.totalHoursContributed || 0;
  const completedLogs = timeLogs.filter(log => Boolean(log.timeOut)).length;
  const joinedProjectIds = joinedProjects.map(project => project.id);

  const openProjects = React.useCallback(
    (projectId?: string) => {
      navigateToAvailableRoute(navigation, 'Projects', projectId ? { projectId } : undefined);
    },
    [navigation]
  );

  const openTasks = React.useCallback(() => {
    navigateToAvailableRoute(navigation, 'Tasks');
  }, [navigation]);

  const openMessages = React.useCallback(() => {
    navigateToAvailableRoute(navigation, 'Messages');
  }, [navigation]);

  const openProfile = React.useCallback(() => {
    navigateToAvailableRoute(navigation, 'Profile');
  }, [navigation]);

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Are you sure you want to logout?') : true;
      if (confirmed) {
        await logout();
      }
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel' },
      { text: 'Logout', onPress: async () => await logout() },
    ]);
  };

  if (loading && !volunteerProfile && projects.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingCard}>
          <MaterialIcons name="calendar-month" size={34} color="#166534" />
          <Text style={styles.loadingTitle}>Preparing your dashboard</Text>
          <Text style={styles.loadingText}>Loading your projects, tasks, and timeline.</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'V'}</Text>
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.greeting}>Welcome, {user?.name}</Text>
          <Text style={styles.role}>Volunteer Dashboard</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.iconButton}>
          <MaterialIcons name="logout" size={22} color="#166534" />
        </TouchableOpacity>
      </View>

      {loadError ? (
        <View style={styles.errorCard}>
          <MaterialIcons name="error-outline" size={20} color="#b91c1c" />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>{loadError.title}</Text>
            <Text style={styles.errorText}>{loadError.message}</Text>
          </View>
          <TouchableOpacity onPress={() => void loadDashboardData()}>
            <Text style={styles.errorAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroChip}>
            <MaterialIcons name="favorite" size={14} color="#166534" />
            <Text style={styles.heroChipText}>Volunteer overview</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: volunteerTone.badge }]}>
            <Text style={[styles.statusBadgeText, { color: volunteerTone.text }]}>
              {volunteerProfile?.registrationStatus || 'Pending'}
            </Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>Your next service opportunity is already on the timeline.</Text>
        <Text style={styles.heroSubtitle}>
          Follow project dates, admin schedule updates, and your active participation from one place.
        </Text>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{joinedProjects.length}</Text>
            <Text style={styles.metricLabel}>joined projects</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{totalHours.toFixed(1)}</Text>
            <Text style={styles.metricLabel}>hours served</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{unreadMessages}</Text>
            <Text style={styles.metricLabel}>unread messages</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.detailCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Event Details</Text>
            <TouchableOpacity onPress={() => openProjects(featuredProject?.id)}>
              <Text style={styles.linkText}>{featuredProject ? 'Open project' : 'View projects'}</Text>
            </TouchableOpacity>
          </View>

          {featuredProject ? (
            <View style={styles.detailGrid}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Event Name</Text>
                <Text style={styles.detailValue}>{featuredProject.title}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Campaign</Text>
                <Text style={styles.detailValue}>{featuredProject.programModule || featuredProject.category}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Description</Text>
                <Text style={styles.detailValue}>{featuredProject.description}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Venue Address</Text>
                <Text style={styles.detailValue}>{featuredProject.location.address}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Starting Date</Text>
                <Text style={styles.detailValue}>{formatLongDate(featuredProject.startDate)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Until Date</Text>
                <Text style={styles.detailValue}>{formatLongDate(featuredProject.endDate)}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.emptySectionText}>You do not have a featured project yet. Explore available projects to get started.</Text>
          )}
        </View>

        <View style={styles.profileCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Volunteer Details</Text>
            <TouchableOpacity onPress={openProfile}>
              <MaterialIcons name="edit" size={18} color="#166534" />
            </TouchableOpacity>
          </View>

          <View style={styles.profileIdentity}>
            <View style={styles.profileAvatarLarge}>
              <Text style={styles.profileAvatarText}>{user?.name?.charAt(0) || 'V'}</Text>
            </View>
            <View style={styles.profileIdentityCopy}>
              <Text style={styles.profileName}>{volunteerProfile?.name || user?.name}</Text>
              <Text style={styles.profileMeta}>{user?.email || volunteerProfile?.email || 'No email added yet'}</Text>
            </View>
          </View>

          <View style={styles.detailGrid}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date Of Birth</Text>
              <Text style={styles.detailValue}>{formatLongDate(volunteerProfile?.dateOfBirth)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Gender</Text>
              <Text style={styles.detailValue}>{volunteerProfile?.gender || 'Not set'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Phone</Text>
              <Text style={styles.detailValue}>{volunteerProfile?.phone || 'Not set'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Workplace / School</Text>
              <Text style={styles.detailValue}>{volunteerProfile?.workplaceOrSchool || 'Not set'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Total Points Earned</Text>
              <Text style={styles.detailValue}>{Math.round(totalHours * 10)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Completed Time Logs</Text>
              <Text style={styles.detailValue}>{completedLogs}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.quickActionRow}>
        <TouchableOpacity style={styles.quickActionCard} onPress={() => openProjects()}>
          <MaterialIcons name="work-outline" size={22} color="#166534" />
          <Text style={styles.quickActionTitle}>Projects</Text>
          <Text style={styles.quickActionText}>Browse all programs and events</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.quickActionCard} onPress={openTasks}>
          <MaterialIcons name="task-alt" size={22} color="#166534" />
          <Text style={styles.quickActionTitle}>Tasks</Text>
          <Text style={styles.quickActionText}>Check your assigned responsibilities</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.quickActionCard} onPress={openMessages}>
          <MaterialIcons name="chat-bubble-outline" size={22} color="#166534" />
          <Text style={styles.quickActionTitle}>Messages</Text>
          <Text style={styles.quickActionText}>Follow admin and project updates</Text>
        </TouchableOpacity>
      </View>

      <ProjectTimelineCalendarCard
        title="Volunteer Project Calendar"
        subtitle={
          joinedProjectIds.length
            ? 'Your joined projects are shown together with admin planning updates.'
            : 'Browse the shared admin schedule to discover project and event dates.'
        }
        projects={projects}
        planningCalendars={planningCalendars}
        planningItems={planningItems}
        projectFilterIds={joinedProjectIds.length ? joinedProjectIds : undefined}
        accentColor="#166534"
        emptyText="No volunteer timeline items yet."
        onOpenProject={projectId => openProjects(projectId)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f7f2',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f7f2',
    padding: 24,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: '#dbe7df',
    gap: 10,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  loadingText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#dbe7df',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  headerCopy: {
    flex: 1,
  },
  greeting: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  role: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 14,
  },
  errorCopy: {
    flex: 1,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991b1b',
  },
  errorText: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 18,
    color: '#b91c1c',
  },
  errorAction: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991b1b',
  },
  heroCard: {
    borderRadius: 28,
    backgroundColor: '#166534',
    padding: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#dcfce7',
  },
  heroChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  heroTitle: {
    marginTop: 16,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    color: '#dcfce7',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  metricCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  metricLabel: {
    marginTop: 3,
    fontSize: 11,
    color: '#dcfce7',
  },
  section: {
    gap: 16,
  },
  detailCard: {
    borderRadius: 24,
    backgroundColor: '#ffffff',
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
  },
  profileCard: {
    borderRadius: 24,
    backgroundColor: '#ffffff',
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  detailGrid: {
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  detailLabel: {
    width: 112,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#64748b',
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: '#0f172a',
    fontWeight: '600',
  },
  emptySectionText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
  },
  profileIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  profileAvatarLarge: {
    width: 74,
    height: 74,
    borderRadius: 20,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#166534',
  },
  profileIdentityCopy: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  profileMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  quickActionRow: {
    gap: 12,
  },
  quickActionCard: {
    borderRadius: 22,
    backgroundColor: '#ffffff',
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbe7df',
    gap: 8,
  },
  quickActionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  quickActionText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
});
