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
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const CORE_PROGRAM_MODULES = ['Livelihood', 'Education', 'Nutrition'] as const;

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

function formatDateRangeLabel(startDate?: string, endDate?: string): string {
  const formattedStartDate = formatLongDate(startDate);
  const formattedEndDate = formatLongDate(endDate);

  if (formattedStartDate === formattedEndDate) {
    return formattedStartDate;
  }

  if (formattedStartDate === 'To be announced') {
    return formattedEndDate;
  }

  if (formattedEndDate === 'To be announced') {
    return formattedStartDate;
  }

  return `${formattedStartDate} - ${formattedEndDate}`;
}

function getUpcomingProject(projects: Project[]): Project | null {
  const now = new Date();

  return (
    [...projects]
      .filter(project => {
        if (getProjectDisplayStatus(project) === 'Cancelled') {
          return false;
        }

        const endDate = new Date(project.endDate || project.startDate);
        return !Number.isNaN(endDate.getTime()) && endDate >= now;
      })
      .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime())[0] || null
  );
}

function isVolunteerOpportunityOpen(project: Project): boolean {
  const status = getProjectDisplayStatus(project);
  return status !== 'Completed' && status !== 'Cancelled';
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
        getProjectsScreenSnapshot(user, ['projects', 'volunteerProfile', 'timeLogs']),
        getDashboardTimelineSnapshot(),
        getMessagesForUser(user.id),
      ]);

      setProjects(projectSnapshot.projects);
      setVolunteerProfile(projectSnapshot.volunteerProfile);
      setTimeLogs(projectSnapshot.timeLogs);
      setPlanningCalendars(timelineSnapshot.planningCalendars);
      setPlanningItems(timelineSnapshot.planningItems);
      setUnreadMessages(messages.filter(message => !message.read && message.recipientId === user.id).length);
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
          'events',
          'volunteerProjectJoins',
          'volunteerMatches',
          'volunteerTimeLogs',
          'adminPlanningCalendars',
        ],
        () => {
          void loadDashboardData();
        }
      );
    }, [loadDashboardData])
  );

  const joinedEvents = useMemo(
    () =>
      projects.filter(
        project =>
          project.isEvent &&
          (
            (project.joinedUserIds || []).includes(user?.id || '') ||
            (volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => task.assignedVolunteerId === volunteerProfile.id) : false)
          )
      ),
    [projects, user?.id, volunteerProfile]
  );

  const assignedEvents = useMemo(
    () =>
      projects.filter(
        project =>
          project.isEvent &&
          Boolean(volunteerProfile) &&
          (project.internalTasks || []).some(task => task.assignedVolunteerId === volunteerProfile?.id)
      ),
    [projects, volunteerProfile]
  );

  const availableEvents = useMemo(
    () =>
      projects.filter(
        project =>
          project.isEvent &&
          isVolunteerOpportunityOpen(project) &&
          !(
            (project.joinedUserIds || []).includes(user?.id || '') ||
            (volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => task.assignedVolunteerId === volunteerProfile.id) : false)
          )
      ),
    [projects, user?.id, volunteerProfile]
  );

  const joinedProjects = useMemo(
    () =>
      projects.filter(
        project =>
          !project.isEvent &&
          (
            (project.joinedUserIds || []).includes(user?.id || '') ||
            (volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => task.assignedVolunteerId === volunteerProfile.id) : false)
          )
      ),
    [projects, user?.id, volunteerProfile]
  );

  const availableProjects = useMemo(
    () =>
      projects.filter(
        project =>
          !project.isEvent &&
          isVolunteerOpportunityOpen(project) &&
          !(
            (project.joinedUserIds || []).includes(user?.id || '') ||
            (volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => task.assignedVolunteerId === volunteerProfile.id) : false)
          )
      ),
    [projects, user?.id, volunteerProfile]
  );
  const programOverviewCards = useMemo(
    () =>
      CORE_PROGRAM_MODULES.map(module => {
        const moduleProjectCount = projects.filter(
          project =>
            !project.isEvent &&
            isVolunteerOpportunityOpen(project) &&
            (project.programModule || project.category) === module
        ).length;

        return {
          label: module,
          value: String(moduleProjectCount),
          meta: `${moduleProjectCount} project${moduleProjectCount === 1 ? '' : 's'} available`,
        };
      }),
    [projects]
  );

  const upcomingEvent = useMemo(() => getUpcomingProject(assignedEvents), [assignedEvents]);
  const suggestedEvent = useMemo(
    () => getUpcomingProject(projects.filter(project => project.isEvent)),
    [projects]
  );
  const featuredEvent = upcomingEvent || null;
  const volunteerTone = getVolunteerStatusTone(volunteerProfile?.registrationStatus);

  const totalHours = volunteerProfile?.totalHoursContributed || 0;
  const completedLogs = timeLogs.filter(log => Boolean(log.timeOut)).length;
  const featuredEventDateRange = featuredEvent
    ? formatDateRangeLabel(featuredEvent.startDate, featuredEvent.endDate)
    : 'To be announced';
  const featuredEventSummaryCards = featuredEvent
    ? [
        {
          label: 'Campaign',
          value: featuredEvent.programModule || featuredEvent.category,
          meta: 'Advocacy area',
        },
        {
          label: 'Schedule',
          value: featuredEventDateRange,
          meta: 'Planned event window',
        },
        {
          label: 'Venue',
          value: featuredEvent.location.address || 'Venue to be confirmed',
          meta: 'Where volunteers should report',
        },
        {
          label: 'Volunteer Slots',
          value: `${featuredEvent.volunteers.length}/${featuredEvent.volunteersNeeded}`,
          meta:
            featuredEvent.volunteers.length >= featuredEvent.volunteersNeeded
              ? 'Team capacity is currently full'
              : `${featuredEvent.volunteersNeeded - featuredEvent.volunteers.length} slot${
                  featuredEvent.volunteersNeeded - featuredEvent.volunteers.length === 1 ? '' : 's'
                } may still be open`,
        },
      ]
    : [];
  const assignedEventIds = assignedEvents.map(project => project.id);
  const volunteerDetailCards = [
    {
      label: 'Date of Birth',
      value: formatLongDate(volunteerProfile?.dateOfBirth),
      meta: 'Personal profile record',
    },
    {
      label: 'Gender',
      value: volunteerProfile?.gender || 'Not set',
      meta: 'Profile information',
    },
    {
      label: 'Phone',
      value: volunteerProfile?.phone || 'Not set',
      meta: 'Best contact number',
    },
    {
      label: 'Workplace / School',
      value: volunteerProfile?.workplaceOrSchool || 'Not set',
      meta: 'Current affiliation',
    },
    {
      label: 'Total Points',
      value: String(Math.round(totalHours * 10)),
      meta: 'Based on recorded service hours',
    },
    {
      label: 'Completed Logs',
      value: String(completedLogs),
      meta: 'Finished time-in and time-out entries',
    },
  ];

  const openProjects = React.useCallback(
    (projectId?: string) => {
      if (projectId) {
        navigateToAvailableRoute(navigation, 'Lifecycle', { projectId });
        return;
      }

      navigateToAvailableRoute(navigation, 'Projects');
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
          Follow your assigned event dates, admin schedule updates, and active participation from one place.
        </Text>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{joinedEvents.length}</Text>
            <Text style={styles.metricLabel}>joined events</Text>
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
            <TouchableOpacity onPress={() => openProjects(featuredEvent?.id)}>
              <Text style={styles.linkText}>{featuredEvent ? 'Open event' : 'View events'}</Text>
            </TouchableOpacity>
          </View>

          {featuredEvent ? (
            <>
              <View style={styles.detailHeroPanel}>
                <View style={styles.detailHeroChip}>
                  <MaterialIcons name="event-available" size={14} color="#166534" />
                  <Text style={styles.detailHeroChipText}>Your next assigned event</Text>
                </View>
                <Text style={styles.detailHeroTitle}>{featuredEvent.title}</Text>
                <Text style={styles.detailHeroText}>{featuredEvent.description}</Text>
              </View>

              <View style={styles.detailSummaryGrid}>
                {featuredEventSummaryCards.map(card => (
                  <View key={card.label} style={styles.detailSummaryCard}>
                    <Text style={styles.detailSummaryEyebrow}>{card.label}</Text>
                    <Text style={styles.detailSummaryValue}>{card.value}</Text>
                    <Text style={styles.detailSummaryMeta}>{card.meta}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.emptySectionText}>You do not have an assigned event yet. Ask the admin or field officer to assign you to a task.</Text>
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

          <View style={styles.detailSummaryGrid}>
            {volunteerDetailCards.map(card => (
              <View key={card.label} style={styles.detailSummaryCard}>
                <Text style={styles.detailSummaryEyebrow}>{card.label}</Text>
                <Text style={styles.detailSummaryValue}>{card.value}</Text>
                <Text style={styles.detailSummaryMeta}>{card.meta}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <ProjectTimelineCalendarCard
        title="Volunteer Event Calendar"
        subtitle={
          assignedEventIds.length
            ? 'Your assigned events are shown with the admin planning timeline below.'
            : 'Review the shared project schedule and upcoming admin timeline in one view.'
        }
        projects={projects}
        planningCalendars={planningCalendars}
        planningItems={planningItems}
        projectFilterIds={assignedEventIds.length ? assignedEventIds : undefined}
        accentColor="#166534"
        emptyText="No volunteer timeline items yet."
        onOpenProject={projectId => openProjects(projectId)}
      />

      <View style={styles.quickActionRow}>
        <TouchableOpacity style={styles.quickActionCard} onPress={() => openProjects()}>
          <MaterialIcons name="work-outline" size={22} color="#166534" />
          <Text style={styles.quickActionTitle}>Projects</Text>
          <Text style={styles.quickActionText}>Browse all projects and events</Text>
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

      {joinedEvents.length > 1 && (
        <View style={styles.detailCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Joined Events</Text>
            <TouchableOpacity onPress={() => openProjects()}>
              <Text style={styles.linkText}>View all</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.projectsList}>
            {joinedEvents.map(project => (
              <TouchableOpacity
                key={project.id}
                style={styles.projectItem}
                onPress={() => openProjects(project.id)}
              >
                <View style={styles.projectItemHeader}>
                  <Text style={styles.projectItemTitle}>{project.title}</Text>
                  <View style={styles.projectItemBadges}>
                    <View style={styles.projectItemBadge}>
                      <Text style={styles.projectItemBadgeText}>{project.category}</Text>
                    </View>
                    <View
                      style={[
                        styles.projectItemStatusBadge,
                        {
                          borderColor: getProjectStatusColor(project),
                          backgroundColor: `${getProjectStatusColor(project)}1F`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.projectItemStatusBadgeText,
                          { color: getProjectStatusColor(project) },
                        ]}
                      >
                        {getProjectDisplayStatus(project)}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.projectItemDescription}>{project.description}</Text>

                <View style={styles.projectItemMeta}>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="event" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {formatDateRangeLabel(project.startDate, project.endDate)}
                    </Text>
                  </View>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="location-on" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {project.location?.address || 'Location TBA'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {availableEvents.length > 0 && (
        <View style={styles.detailCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Available Events</Text>
            <TouchableOpacity onPress={() => openProjects()}>
              <Text style={styles.linkText}>View all</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionSubtitle}>Events you can join and contribute to</Text>

          <View style={styles.projectsList}>
            {availableEvents.map(project => (
              <TouchableOpacity
                key={project.id}
                style={styles.projectItem}
                onPress={() => openProjects(project.id)}
              >
                <View style={styles.projectItemHeader}>
                  <Text style={styles.projectItemTitle}>{project.title}</Text>
                  <View style={styles.projectItemBadges}>
                    <View style={styles.projectItemBadge}>
                      <Text style={styles.projectItemBadgeText}>{project.category}</Text>
                    </View>
                    <View
                      style={[
                        styles.projectItemStatusBadge,
                        {
                          borderColor: getProjectStatusColor(project),
                          backgroundColor: `${getProjectStatusColor(project)}1F`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.projectItemStatusBadgeText,
                          { color: getProjectStatusColor(project) },
                        ]}
                      >
                        {getProjectDisplayStatus(project)}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.projectItemDescription}>{project.description}</Text>

                <View style={styles.projectItemMeta}>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="event" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {formatDateRangeLabel(project.startDate, project.endDate)}
                    </Text>
                  </View>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="location-on" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {project.location?.address || 'Location TBA'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={styles.detailCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Programs</Text>
          <TouchableOpacity onPress={() => openProjects()}>
            <Text style={styles.linkText}>View all</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionSubtitle}>The three core program areas currently available in the system</Text>

        <View style={styles.detailSummaryGrid}>
          {programOverviewCards.map(card => (
            <View key={card.label} style={styles.detailSummaryCard}>
              <Text style={styles.detailSummaryEyebrow}>Program</Text>
              <Text style={styles.detailSummaryValue}>{card.label}</Text>
              <Text style={styles.detailSummaryMeta}>{card.meta}</Text>
            </View>
          ))}
        </View>
      </View>

      {joinedProjects.length > 0 && (
        <View style={styles.detailCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Joined Programs</Text>
            <TouchableOpacity onPress={() => openProjects()}>
              <Text style={styles.linkText}>View all</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.projectsList}>
            {joinedProjects.map(project => (
              <TouchableOpacity
                key={project.id}
                style={styles.projectItem}
                onPress={() => openProjects(project.id)}
              >
                <View style={styles.projectItemHeader}>
                  <Text style={styles.projectItemTitle}>{project.title}</Text>
                  <View style={styles.projectItemBadges}>
                    <View style={styles.projectItemBadge}>
                      <Text style={styles.projectItemBadgeText}>{project.category}</Text>
                    </View>
                    <View
                      style={[
                        styles.projectItemStatusBadge,
                        {
                          borderColor: getProjectStatusColor(project),
                          backgroundColor: `${getProjectStatusColor(project)}1F`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.projectItemStatusBadgeText,
                          { color: getProjectStatusColor(project) },
                        ]}
                      >
                        {getProjectDisplayStatus(project)}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.projectItemDescription}>{project.description}</Text>

                <View style={styles.projectItemMeta}>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="event" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {formatDateRangeLabel(project.startDate, project.endDate)}
                    </Text>
                  </View>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="location-on" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {project.location?.address || 'Location TBA'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {availableProjects.length > 0 && (
        <View style={styles.detailCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Available Projects</Text>
            <TouchableOpacity onPress={() => openProjects()}>
              <Text style={styles.linkText}>View all</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionSubtitle}>Projects you can join and contribute to</Text>

          <View style={styles.projectsList}>
            {availableProjects.map(project => (
              <TouchableOpacity
                key={project.id}
                style={styles.projectItem}
                onPress={() => openProjects(project.id)}
              >
                <View style={styles.projectItemHeader}>
                  <Text style={styles.projectItemTitle}>{project.title}</Text>
                  <View style={styles.projectItemBadges}>
                    <View style={styles.projectItemBadge}>
                      <Text style={styles.projectItemBadgeText}>{project.category}</Text>
                    </View>
                    <View
                      style={[
                        styles.projectItemStatusBadge,
                        {
                          borderColor: getProjectStatusColor(project),
                          backgroundColor: `${getProjectStatusColor(project)}1F`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.projectItemStatusBadgeText,
                          { color: getProjectStatusColor(project) },
                        ]}
                      >
                        {getProjectDisplayStatus(project)}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.projectItemDescription}>{project.description}</Text>

                <View style={styles.projectItemMeta}>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="event" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {formatDateRangeLabel(project.startDate, project.endDate)}
                    </Text>
                  </View>
                  <View style={styles.projectItemMetaItem}>
                    <MaterialIcons name="location-on" size={14} color="#64748b" />
                    <Text style={styles.projectItemMetaText}>
                      {project.location?.address || 'Location TBA'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
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
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },
  detailHeroPanel: {
    borderRadius: 20,
    backgroundColor: '#f6fbf7',
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    marginBottom: 14,
    gap: 10,
  },
  detailHeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  detailHeroChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  detailHeroTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailHeroText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  detailSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailSummaryCard: {
    minWidth: 150,
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  detailSummaryEyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailSummaryValue: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailSummaryMeta: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
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
  projectsList: {
    gap: 12,
  },
  projectItem: {
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 10,
  },
  projectItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  projectItemBadges: {
    alignItems: 'flex-end',
    gap: 6,
  },
  projectItemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectItemBadge: {
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  projectItemBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  projectItemStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  projectItemStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  projectItemDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  projectItemMeta: {
    gap: 8,
  },
  projectItemMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  projectItemMetaText: {
    fontSize: 11,
    color: '#64748b',
  },
});
