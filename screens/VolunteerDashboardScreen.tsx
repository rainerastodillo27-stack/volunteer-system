import React, { useEffect, useMemo, useState, useRef } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import ProjectTimelineCalendarCard from '../components/ProjectTimelineCalendarCard';
import { useAuth } from '../contexts/AuthContext';
import ModernTheme from '../utils/modernTheme';
import {
  getDashboardTimelineSnapshot,
  getMessagesForUser,
  getProjectsScreenSnapshot,
  reconcileApprovedVolunteerEventMemberships,
  subscribeToMessages,
  subscribeToStorageChanges,
} from '../models/storage';
import {
  syncProjectsToGoogleCalendar,
  validateGoogleToken,
  GOOGLE_CLIENT_ID,
} from '../utils/googleCalendarSync';

WebBrowser.maybeCompleteAuthSession();
import type {
  AdminPlanningCalendar,
  AdminPlanningItem,
  Project,
  ProgramTrack,
  Volunteer,
  VolunteerProjectJoinRecord,
  VolunteerProjectMatch,
  VolunteerTimeLog,
} from '../models/types';
import { navigateToAvailableRoute, debounce } from '../utils/navigation';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { formatProjectLocation } from '../utils/locationFormat';

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

// Normalizes text into searchable word tokens for skill matching
const normalizeWords = (value?: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

// Removes duplicate terms while preserving display order
const unique = (values: string[]) => Array.from(new Set(values));

// Category-specific keywords for better matching
const CATEGORY_KEYWORDS: Record<Project['category'], string[]> = {
  Nutrition: ['nutrition', 'food', 'feeding', 'meal', 'health', 'diet'],
  Education: ['education', 'school', 'teaching', 'learning', 'student', 'training'],
  Livelihood: ['livelihood', 'income', 'business', 'employment', 'skills', 'work'],
  Disaster: ['disaster', 'relief', 'emergency', 'response', 'rescue', 'recovery'],
};

// Checks if event matches volunteer skills
function checkEventSkillMatch(project: Project, volunteer: Volunteer | null): {
  hasMatch: boolean;
  matchedSkills: string[];
} {
  if (!volunteer || !project.isEvent) {
    return { hasMatch: false, matchedSkills: [] };
  }

  const skillTerms = unique([
    ...((volunteer.skills || []).flatMap(normalizeWords)),
    ...normalizeWords(volunteer.skillsDescription),
    ...normalizeWords(volunteer.specialSkills),
  ]);

  const projectTerms = unique([
    ...normalizeWords(project.title),
    ...normalizeWords(project.description),
    ...((project.skillsNeeded || []).flatMap(normalizeWords)),
    ...CATEGORY_KEYWORDS[project.category],
  ]);

  const matchedTerms = skillTerms.filter((term) => projectTerms.includes(term)).slice(0, 3);
  
  return {
    hasMatch: matchedTerms.length > 0,
    matchedSkills: matchedTerms,
  };
}

function inferProgramTrackFocus(track: ProgramTrack): Project['category'] | null {
  const text = `${track.id || ''} ${track.title || ''}`.toLowerCase();
  if (text.includes('education')) return 'Education';
  if (text.includes('livelihood')) return 'Livelihood';
  if (text.includes('nutrition')) return 'Nutrition';
  if (text.includes('disaster')) return 'Disaster';
  return null;
}

function getProjectProgramId(project: Project, programTracks: ProgramTrack[] = []): string {
  if (project.parentProjectId) {
    return project.parentProjectId;
  }

  const projectFocus = project.programModule || project.category;
  const matchingTrack = programTracks.find(track => inferProgramTrackFocus(track) === projectFocus);
  return matchingTrack?.id || projectFocus;
}

function isVolunteerProjectRecord(project: Project, programTracks: ProgramTrack[] = []): boolean {
  if (project.isEvent) {
    return false;
  }

  if (project.parentProjectId) {
    return true;
  }

  if (String(project.id || '').startsWith('project-proposal-')) {
    return true;
  }

  return false;
}

function isVolunteerAssignedToTask(
  task: { assignedVolunteerId?: string; assignedVolunteerIds?: string[] },
  volunteerId?: string | null
): boolean {
  if (!volunteerId) {
    return false;
  }

  const assignedVolunteerIds = Array.from(
    new Set(
      [
        ...(Array.isArray(task.assignedVolunteerIds) ? task.assignedVolunteerIds : []),
        task.assignedVolunteerId,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  );

  return assignedVolunteerIds.includes(volunteerId);
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

type DashboardPreviewField = {
  label: string;
  value: string;
};

type DashboardCardPreview = {
  id: string;
  kind: 'event' | 'project' | 'program';
  eyebrow: string;
  title: string;
  description: string;
  badgeLabel?: string;
  badgeColor?: string;
  details: DashboardPreviewField[];
  targetProjectId?: string;
  targetProgramId?: string;
  ctaLabel: string;
  skillMatch?: {
    hasMatch: boolean;
    matchedSkills: string[];
  };

};

type DashboardSectionPreview = {
  id: string;
  title: string;
  eyebrow?: string;
  subtitle: string;
  items: DashboardCardPreview[];
  emptyTitle: string;
  emptyText: string;
};

// Stable Google OAuth discovery document (outside component to avoid re-renders)
const GCAL_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

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
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [selectedDashboardSection, setSelectedDashboardSection] = useState<DashboardSectionPreview | null>(null);
  const [selectedDashboardCard, setSelectedDashboardCard] = useState<DashboardCardPreview | null>(null);

  // ── Google Calendar Sync ────────────────────────────────────────────────────
  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [gcalLastSynced, setGcalLastSynced] = useState<string | null>(null);
  const [gcalAccessToken, setGcalAccessToken] = useState<string | null>(null);
  const [gcalSyncSuccess, setGcalSyncSuccess] = useState<{ count: number; time: string } | null>(null);


  // Mobile: expo-auth-session hook (not used on web)
  const [gcalAuthRequest, gcalAuthResponse, promptGcalAuth] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      redirectUri: AuthSession.makeRedirectUri(),
      scopes: [
        'openid',
        'profile',
        'email',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      responseType: AuthSession.ResponseType.Token,
      usePKCE: false,
      extraParams: user?.email ? { login_hint: user.email } : {},
    },
    GCAL_DISCOVERY
  );

  useEffect(() => {
    if (Platform.OS === 'web') return; // web handled via URL hash above
    if (gcalAuthResponse?.type === 'success') {
      const token = gcalAuthResponse.params.access_token;
      if (token) {
        setGcalAccessToken(token);
        void handleGcalSync(token);
      }
    } else if (gcalAuthResponse?.type === 'error') {
      Alert.alert(
        'Google Sign-In Failed',
        gcalAuthResponse.error?.message ?? 'Could not sign in with Google. Please try again.'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcalAuthResponse]);

  const handleGcalConnectAndSync = async () => {
    if (gcalSyncing) return;

    // Reuse cached token if still valid
    if (gcalAccessToken) {
      const stillValid = await validateGoogleToken(gcalAccessToken);
      if (stillValid) {
        await handleGcalSync(gcalAccessToken);
        return;
      }
      setGcalAccessToken(null);
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Web: Use Google Identity Services (GIS) — the official modern Google OAuth API.
      // GIS manages the popup internally and returns the token directly via callback.
      // No redirect URI configuration needed — only requires the JS origin to be whitelisted.
      setGcalSyncing(true);

      const requestGisToken = () => {
        const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: [
            'https://www.googleapis.com/auth/calendar.events',
            'openid',
            'profile',
            'email',
          ].join(' '),
          callback: (response: any) => {
            if (response.error) {
              setGcalSyncing(false);
              Alert.alert(
                'Google Sign-In Failed',
                response.error_description || response.error || 'Could not sign in with Google.'
              );
              return;
            }
            const token = response.access_token as string;
            if (token) {
              setGcalAccessToken(token);
              void handleGcalSync(token);
            }
          },
          ...(user?.email ? { hint: user.email } : {}),
        });
        tokenClient.requestAccessToken();
      };

      // Load GIS script if not already loaded
      if ((window as any).google?.accounts?.oauth2) {
        requestGisToken();
      } else {
        const existing = document.getElementById('gis-script');
        if (existing) {
          existing.addEventListener('load', requestGisToken);
        } else {
          const script = document.createElement('script');
          script.id = 'gis-script';
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          script.onload = requestGisToken;
          script.onerror = () => {
            setGcalSyncing(false);
            Alert.alert('Error', 'Could not load Google Sign-In. Check your internet connection.');
          };
          document.head.appendChild(script);
        }
      }
    } else {
      // Mobile: use expo-auth-session
      await promptGcalAuth();
    }
  };


  const handleGcalSync = async (accessToken: string) => {
    setGcalSyncing(true);
    setGcalSyncSuccess(null);
    try {
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'volunteerProfile']);
      const allProjects = snapshot.projects ?? [];

      // First try: projects explicitly assigned to the volunteer
      let relevantProjects = allProjects.filter(p =>
        p.volunteers?.includes(user?.id ?? '') ||
        p.joinedUserIds?.includes(user?.id ?? '')
      );

      // Fallback: if no explicitly assigned projects, sync all active visible projects
      if (relevantProjects.length === 0) {
        relevantProjects = allProjects.filter(
          p => p.status !== 'Cancelled' && p.status !== 'Completed'
        );
      }

      if (relevantProjects.length === 0) {
        Alert.alert('Nothing to Sync', 'There are no active events or projects to sync to Google Calendar.');
        return;
      }

      const result = await syncProjectsToGoogleCalendar(accessToken, relevantProjects);
      const syncedAt = new Date().toLocaleString();
      setGcalLastSynced(syncedAt);

      if (result.synced > 0) {
        // Show in-screen success banner
        setGcalSyncSuccess({ count: result.synced, time: syncedAt });
        setTimeout(() => setGcalSyncSuccess(null), 10000);

        // Show prominent Alert so the user always sees confirmation
        Alert.alert(
          '✅ Calendar Sync Successful!',
          `${result.synced} event${result.synced !== 1 ? 's' : ''} added to your Google Calendar.\n\nA confirmation email has been sent to ${user?.email ?? 'your email'}.`
        );

        // Send confirmation email
        if (user?.email) {
          try {
            const { getApiBaseUrl } = await import('../models/storage');
            await fetch(`${getApiBaseUrl()}/notify/gcal-sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient_email: user.email,
                user_name: user.name || user.email,
                synced_count: result.synced,
                synced_at: syncedAt,
              }),
            });
          } catch {
            // Email failure is non-critical
          }
        }
      } else if (result.failed > 0) {
        Alert.alert(
          'Sync Failed',
          `Could not add events to Google Calendar.\n\nErrors:\n${result.errors.slice(0, 3).join('\n')}`
        );
      } else {
        Alert.alert('Nothing to Sync', 'No events were added. They may already be in your calendar.');
      }
    } catch (error) {
      Alert.alert('Sync Failed', 'Could not sync to Google Calendar. Please try again.');
    } finally {
      setGcalSyncing(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────

  const isMounted = useRef(true);
  const lastLoadAtRef = useRef(0);
  const activeLoadPromiseRef = useRef<Promise<void> | null>(null);
  const DASHBOARD_LOAD_COOLDOWN_MS = 1000;

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadDashboardData = React.useCallback(async (force = false) => {
    if (!user?.id || !isMounted.current) {
      return;
    }

    if (!force && activeLoadPromiseRef.current) {
      return activeLoadPromiseRef.current;
    }

    if (!force && Date.now() - lastLoadAtRef.current < DASHBOARD_LOAD_COOLDOWN_MS) {
      return;
    }

    const loadPromise = (async () => {
      try {
        await reconcileApprovedVolunteerEventMemberships();
        const [projectSnapshot, timelineSnapshot, messages] = await Promise.all([
          getProjectsScreenSnapshot(user, [
            'projects',
            'volunteerProfile',
            'volunteerMatches',
            'volunteerProjectJoins',
            'timeLogs',
            'programTracks',
          ]),
          getDashboardTimelineSnapshot(),
          getMessagesForUser(user.id),
        ]);

        setProjects(projectSnapshot.projects);
        setVolunteerProfile(projectSnapshot.volunteerProfile);
        setVolunteerMatches(projectSnapshot.volunteerMatches || []);
        setVolunteerJoinRecords(projectSnapshot.volunteerJoinRecords || []);
        setTimeLogs(projectSnapshot.timeLogs);
        setProgramTracks(projectSnapshot.programTracks || []);
        setPlanningCalendars(timelineSnapshot.planningCalendars);
        setPlanningItems(timelineSnapshot.planningItems);
        setUnreadMessages(messages.filter(message => !message.read && message.recipientId === user.id).length);
        setLoadError(null);
        lastLoadAtRef.current = Date.now();
      } catch (error) {
        setLoadError({
          title: getRequestErrorTitle(error),
          message: getRequestErrorMessage(error, 'Failed to load the volunteer dashboard.'),
        });
      } finally {
        setLoading(false);
        activeLoadPromiseRef.current = null;
      }
    })();

    activeLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }, [user]);

  const isLoaded = useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      if (!isLoaded.current) {
        void loadDashboardData(true);
        isLoaded.current = true;
      }

      return subscribeToStorageChanges(
        [
          'projects',
          'events',
          'programs',
          'volunteerProjectJoins',
          'volunteerMatches',
          'volunteerTimeLogs',
          'adminPlanningCalendars',
          'programTracks',
        ],
        debounce(() => {
          void loadDashboardData();
        }, 1000)
      );
    }, [loadDashboardData])
  );

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const refreshUnreadMessages = async () => {
      try {
        const messages = await getMessagesForUser(user.id);
        setUnreadMessages(messages.filter(message => !message.read && message.recipientId === user.id).length);
      } catch (error) {
        console.error('Failed to refresh volunteer unread messages:', error);
      }
    };

    return subscribeToMessages(user.id, event => {
      if (event.type === 'message.changed') {
        void refreshUnreadMessages();
      }
    });
  }, [user?.id]);

  const joinedEvents = useMemo(
    () =>
      projects.filter(
        project =>
          project.isEvent &&
          (
            (project.joinedUserIds || []).includes(user?.id || '') ||
            (volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false) ||
            (volunteerProfile
              ? volunteerMatches.some(
                match =>
                  match.projectId === project.id &&
                  match.volunteerId === volunteerProfile.id &&
                  (match.status === 'Matched' || match.status === 'Completed')
              )
              : false) ||
            (volunteerProfile
              ? volunteerJoinRecords.some(
                record =>
                  record.projectId === project.id &&
                  record.volunteerId === volunteerProfile.id &&
                  (record.participationStatus || 'Active') === 'Active'
              )
              : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => isVolunteerAssignedToTask(task, volunteerProfile.id)) : false)
          )
      ),
    [projects, user?.id, volunteerProfile, volunteerMatches, volunteerJoinRecords]
  );

  const assignedEvents = useMemo(
    () =>
      projects.filter(
        project =>
          project.isEvent &&
          Boolean(volunteerProfile) &&
          (project.internalTasks || []).some(task => isVolunteerAssignedToTask(task, volunteerProfile?.id))
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
            (volunteerProfile
              ? volunteerMatches.some(
                match =>
                  match.projectId === project.id &&
                  match.volunteerId === volunteerProfile.id &&
                  (match.status === 'Matched' || match.status === 'Completed' || match.status === 'Requested')
              )
              : false) ||
            (volunteerProfile
              ? volunteerJoinRecords.some(
                record =>
                  record.projectId === project.id &&
                  record.volunteerId === volunteerProfile.id &&
                  (record.participationStatus || 'Active') === 'Active'
              )
              : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => isVolunteerAssignedToTask(task, volunteerProfile.id)) : false)
          )
      ),
    [projects, user?.id, volunteerProfile, volunteerMatches, volunteerJoinRecords]
  );

  const joinedProjects = useMemo(
    () =>
      projects.filter(
        project =>
          isVolunteerProjectRecord(project, programTracks) &&
          (
            (project.joinedUserIds || []).includes(user?.id || '') ||
            (volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => isVolunteerAssignedToTask(task, volunteerProfile.id)) : false)
          )
      ),
    [programTracks, projects, user?.id, volunteerProfile]
  );

  const availableProjects = useMemo(
    () =>
      projects.filter(
        project =>
          isVolunteerProjectRecord(project, programTracks) &&
          isVolunteerOpportunityOpen(project) &&
          !(
            (project.joinedUserIds || []).includes(user?.id || '') ||
            (volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false) ||
            (volunteerProfile ? (project.internalTasks || []).some(task => isVolunteerAssignedToTask(task, volunteerProfile.id)) : false)
          )
      ),
    [programTracks, projects, user?.id, volunteerProfile]
  );
  const programOverviewCards = useMemo(
    () => {
      // Only show programs that exist in the database (no hardcoded defaults)
      const activeTracks = programTracks.filter(track => track.isActive !== false);

      return activeTracks.map(track => {
        // Count only actual projects that belong to this program.
        const moduleProjectCount = projects.filter(
          project =>
            isVolunteerProjectRecord(project, programTracks) &&
            getProjectProgramId(project, programTracks) === track.id &&
            isVolunteerOpportunityOpen(project)
        ).length;

        return {
          label: track.title,
          value: String(moduleProjectCount),
          meta: `${moduleProjectCount} project${moduleProjectCount === 1 ? '' : 's'} available`,
        };
      });
    },
    [projects, programTracks]
  );

  const upcomingEvent = useMemo(() => getUpcomingProject(assignedEvents), [assignedEvents]);
  const suggestedEvent = useMemo(
    () => getUpcomingProject(projects.filter(project => project.isEvent)),
    [projects]
  );
  const featuredEvent = upcomingEvent || suggestedEvent || null;
  const featuredEventIsAssigned = Boolean(upcomingEvent);
  const volunteerTone = getVolunteerStatusTone(volunteerProfile?.registrationStatus);

  const totalHours = volunteerProfile?.totalHoursContributed || 0;
  const completedLogs = timeLogs.filter(log => Boolean(log.timeOut)).length;
  const featuredEventDateRange = featuredEvent
    ? formatDateRangeLabel(featuredEvent.startDate, featuredEvent.endDate)
    : 'To be announced';
  const assignedEventIds = assignedEvents.map(project => project.id);

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

  const openDashboardSection = React.useCallback((section: DashboardSectionPreview) => {
    setSelectedDashboardSection(section);
  }, []);

  const navigateToCard = React.useCallback(
    (card: DashboardCardPreview) => {
      if (card.kind === 'program') {
        const handled = navigateToAvailableRoute(
          navigation,
          'Projects',
          card.targetProgramId ? { programId: card.targetProgramId } : undefined
        );

        if (!handled) {
          openProjects();
        }
        return;
      }

      if (card.targetProjectId) {
        const handled = navigateToAvailableRoute(
          navigation,
          'ProjectDetails',
          { projectId: card.targetProjectId }
        );

        if (!handled) {
          openProjects(card.targetProjectId);
        }
      }
    },
    [navigation, openProjects]
  );

  const openDashboardCardFromList = React.useCallback((card: DashboardCardPreview) => {
    setSelectedDashboardSection(null);
    navigateToCard(card);
  }, [navigateToCard]);

  const navigateFromDashboardCard = React.useCallback(
    (card: DashboardCardPreview) => {
      setSelectedDashboardCard(null);
      navigateToCard(card);
    },
    [navigateToCard]
  );

  const featuredEventCard = useMemo<DashboardCardPreview | null>(
    () =>
      featuredEvent
        ? {
          id: `featured-${featuredEvent.id}`,
          kind: 'event',
          eyebrow: featuredEventIsAssigned ? 'Your Next Event' : 'Suggested Event',
          title: featuredEvent.title,
          description: featuredEvent.description || 'View the event summary, schedule, and location.',
          badgeLabel: getProjectDisplayStatus(featuredEvent),
          badgeColor: getProjectStatusColor(featuredEvent),
          details: [
            { label: 'Campaign', value: featuredEvent.programModule || featuredEvent.category },
            { label: 'Schedule', value: featuredEventDateRange },
            { label: 'Venue', value: formatProjectLocation(featuredEvent) },
            {
              label: 'Volunteer Slots',
              value: `${featuredEvent.volunteers.length}/${featuredEvent.volunteersNeeded}`,
            },
          ],
          targetProjectId: featuredEvent.id,
          ctaLabel: 'Open Event Details',
        }
        : null,
    [featuredEvent, featuredEventDateRange, featuredEventIsAssigned]
  );

  const joinedEventCards = useMemo<DashboardCardPreview[]>(
    () =>
      joinedEvents.map(project => ({
        id: `joined-event-${project.id}`,
        kind: 'event',
        eyebrow: 'Joined Event',
        title: project.title,
        description: project.description || 'Open the full event details.',
        badgeLabel: getProjectDisplayStatus(project),
        badgeColor: getProjectStatusColor(project),
        details: [
          { label: 'Campaign', value: project.programModule || project.category },
          { label: 'Schedule', value: formatDateRangeLabel(project.startDate, project.endDate) },
          { label: 'Location', value: project.location?.address || 'Location TBA' },
        ],
        targetProjectId: project.id,
        ctaLabel: 'Open Event Details',
      })),
    [joinedEvents]
  );

  const availableEventCards = useMemo<DashboardCardPreview[]>(
    () =>
      availableEvents.map(project => {
        const skillMatch = checkEventSkillMatch(project, volunteerProfile);
        return {
          id: `available-event-${project.id}`,
          kind: 'event',
          eyebrow: 'Available Event',
          title: project.title,
          description: project.description || 'Open the full event details.',
          badgeLabel: getProjectDisplayStatus(project),
          badgeColor: getProjectStatusColor(project),
          details: [
            { label: 'Campaign', value: project.programModule || project.category },
            { label: 'Schedule', value: formatDateRangeLabel(project.startDate, project.endDate) },
            { label: 'Location', value: project.location?.address || 'Location TBA' },
          ],
          targetProjectId: project.id,
          ctaLabel: 'Open Event Details',
          skillMatch,
        };
      }),
    [availableEvents, volunteerProfile]
  );

  const joinedProjectCards = useMemo<DashboardCardPreview[]>(
    () =>
      joinedProjects.map(project => ({
        id: `joined-project-${project.id}`,
        kind: 'project',
        eyebrow: 'Joined Project',
        title: project.title,
        description: project.description || 'Open the full project details.',
        badgeLabel: getProjectDisplayStatus(project),
        badgeColor: getProjectStatusColor(project),
        details: [
          { label: 'Program', value: project.programModule || project.category },
          { label: 'Timeline', value: formatDateRangeLabel(project.startDate, project.endDate) },
          { label: 'Location', value: project.location?.address || 'Location TBA' },
        ],
        targetProjectId: project.id,
        ctaLabel: 'Open Project Details',
      })),
    [joinedProjects]
  );

  const availableProjectCards = useMemo<DashboardCardPreview[]>(
    () =>
      availableProjects.map(project => ({
        id: `available-project-${project.id}`,
        kind: 'project',
        eyebrow: 'Available Project',
        title: project.title,
        description: project.description || 'Open the full project details.',
        badgeLabel: getProjectDisplayStatus(project),
        badgeColor: getProjectStatusColor(project),
        details: [
          { label: 'Program', value: project.programModule || project.category },
          { label: 'Timeline', value: formatDateRangeLabel(project.startDate, project.endDate) },
          { label: 'Location', value: project.location?.address || 'Location TBA' },
        ],
        targetProjectId: project.id,
        ctaLabel: 'Open Project Details',
      })),
    [availableProjects]
  );

  const programCards = useMemo<DashboardCardPreview[]>(
    () =>
      programOverviewCards.map(card => ({
        id: `program-${card.label}`,
        kind: 'program',
        eyebrow: 'Program',
        title: card.label,
        description: card.meta,
        details: [
          { label: 'Available Projects', value: card.value },
          { label: 'Summary', value: card.meta },
        ],
        targetProgramId: card.label,
        ctaLabel: 'Browse Program',
      })),
    [programOverviewCards]
  );

  const renderSectionCard = React.useCallback(
    (section: DashboardSectionPreview) => {
      const firstItem = section.items[0];

      return (
        <TouchableOpacity
          key={section.id}
          style={styles.sectionSummaryCard}
          onPress={() => openDashboardSection(section)}
          activeOpacity={0.88}
        >
          <View style={styles.sectionSummaryHeader}>
            <View style={styles.sectionSummaryHeaderCopy}>
              {section.eyebrow ? <Text style={styles.sectionSummaryEyebrow}>{section.eyebrow}</Text> : null}
              <Text style={styles.sectionSummaryTitle}>{section.title}</Text>
            </View>
            <View style={styles.sectionSummaryCountBadge}>
              <Text style={styles.sectionSummaryCountText}>
                {section.items.length} item{section.items.length === 1 ? '' : 's'}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionSummarySubtitle}>
            {section.items.length > 0
              ? firstItem?.title
                ? `Tap to open the list. First item: ${firstItem.title}`
                : section.subtitle
              : section.emptyText}
          </Text>

          <View style={styles.sectionSummaryFooter}>
            <Text style={styles.sectionSummaryFooterText}>
              {section.items.length > 0 ? 'Tap to view list' : 'No items yet'}
            </Text>
            <MaterialIcons name="chevron-right" size={18} color="#166534" />
          </View>
        </TouchableOpacity>
      );
    },
    [openDashboardSection]
  );

  const featuredEventSection = useMemo<DashboardSectionPreview>(
    () => ({
      id: 'featured-event',
      title: 'Event Details',
      eyebrow: 'Next Priority',
      subtitle: 'Open the list to review your current featured event.',
      items: featuredEventCard ? [featuredEventCard] : [],
      emptyTitle: 'No event assigned yet',
      emptyText: 'Ask the admin or field officer to assign you to a task, or browse available events.',
    }),
    [featuredEventCard]
  );

  const joinedEventsSection = useMemo<DashboardSectionPreview>(
    () => ({
      id: 'joined-events',
      title: 'Your Joined Events',
      subtitle: 'Open the list to review all events you joined.',
      items: joinedEventCards,
      emptyTitle: 'No joined events yet',
      emptyText: 'Your joined events will appear here.',
    }),
    [joinedEventCards]
  );

  const availableEventsSection = useMemo<DashboardSectionPreview>(
    () => ({
      id: 'available-events',
      title: 'Available Events',
      subtitle: 'Open the list to browse events you can still join.',
      items: availableEventCards,
      emptyTitle: 'No available events',
      emptyText: 'No open events are available right now.',
    }),
    [availableEventCards]
  );

  const programsSection = useMemo<DashboardSectionPreview>(
    () => ({
      id: 'programs',
      title: 'Programs',
      subtitle: 'Open the list to browse current program areas.',
      items: programCards,
      emptyTitle: 'No programs available',
      emptyText: 'No program areas are available right now.',
    }),
    [programCards]
  );

  const joinedProjectsSection = useMemo<DashboardSectionPreview>(
    () => ({
      id: 'joined-projects',
      title: 'Your Joined Programs',
      subtitle: 'Open the list to review the programs you joined.',
      items: joinedProjectCards,
      emptyTitle: 'No joined programs yet',
      emptyText: 'Your joined programs will appear here.',
    }),
    [joinedProjectCards]
  );

  const availableProjectsSection = useMemo<DashboardSectionPreview>(
    () => ({
      id: 'available-projects',
      title: 'Available Projects',
      subtitle: 'Open the list to browse projects you can still join.',
      items: availableProjectCards,
      emptyTitle: 'No available projects',
      emptyText: 'No open projects are available right now.',
    }),
    [availableProjectCards]
  );

  const handleLogout = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Are you sure you want to logout?')) {
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
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'V'}</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.role}>Volunteer Workspace</Text>
            <Text style={styles.greeting}>Hello, {user?.name || 'Volunteer'}</Text>
            <Text style={styles.headerHint}>Track your service, schedule, tasks, and messages in one place.</Text>
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
            <TouchableOpacity onPress={() => void loadDashboardData(true)}>
              <Text style={styles.errorAction}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.heroCard}>
          <View style={styles.heroAccentCircle} />
          <View style={styles.heroAccentCircleSmall} />
          <View style={styles.heroTopRow}>
            <View style={styles.heroChip}>
              <MaterialIcons name="verified" size={14} color="#14532d" />
              <Text style={styles.heroChipText}>Account Status</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: volunteerTone.badge }]}>
              <Text style={[styles.statusBadgeText, { color: volunteerTone.text }]}>
                {volunteerProfile?.registrationStatus || 'Pending'}
              </Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>Your service dashboard is ready.</Text>
          <Text style={styles.heroSubtitle}>
            See what needs attention first, review your next event, and jump straight into projects, tasks, or messages.
          </Text>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <MaterialIcons name="event-available" size={16} color="#bbf7d0" />
              <Text style={styles.metricValue}>{joinedEvents.length}</Text>
              <Text style={styles.metricLabel}>Joined Events</Text>
            </View>
            <View style={styles.metricCard}>
              <MaterialIcons name="mark-email-unread" size={16} color="#bbf7d0" />
              <Text style={styles.metricValue}>{unreadMessages}</Text>
              <Text style={styles.metricLabel}>Unread Messages</Text>
            </View>
          </View>
        </View>

        <View style={styles.quickActionRow}>
          <TouchableOpacity style={[styles.quickActionCard, styles.quickActionPrimary]} onPress={() => openProjects()}>
            <View style={styles.quickActionIcon}>
              <MaterialIcons name="work-outline" size={20} color="#166534" />
            </View>
            <View style={styles.quickActionCopy}>
              <Text style={styles.quickActionTitle}>Find Projects</Text>
              <Text style={styles.quickActionText}>Browse events and service opportunities.</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#166534" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickActionCard} onPress={openTasks}>
            <View style={styles.quickActionIcon}>
              <MaterialIcons name="task-alt" size={20} color="#166534" />
            </View>
            <View style={styles.quickActionCopy}>
              <Text style={styles.quickActionTitle}>My Tasks</Text>
              <Text style={styles.quickActionText}>Check assignments and field responsibilities.</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickActionCard} onPress={openMessages}>
            <View style={styles.quickActionIcon}>
              <MaterialIcons name="chat-bubble-outline" size={20} color="#166534" />
            </View>
            <View style={styles.quickActionCopy}>
              <Text style={styles.quickActionTitle}>Messages</Text>
              <Text style={styles.quickActionText}>Read admin and project updates.</Text>
            </View>
            {unreadMessages > 0 ? (
              <View style={styles.messageCountBadge}>
                <Text style={styles.messageCountText}>{unreadMessages > 99 ? '99+' : unreadMessages}</Text>
              </View>
            ) : (
              <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={styles.detailCard}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>Next Priority</Text>
                <Text style={styles.sectionTitle}>Event Details</Text>
              </View>
              <TouchableOpacity onPress={() => openDashboardSection(featuredEventSection)}>
                <Text style={styles.linkText}>{featuredEventSection.items.length ? 'Open list' : 'View status'}</Text>
              </TouchableOpacity>
            </View>

            {renderSectionCard(featuredEventSection)}
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
          onSyncToCalendar={() => void handleGcalConnectAndSync()}
          gcalSyncing={gcalSyncing}
          gcalLastSynced={gcalLastSynced}
        />

        {joinedEvents.length > 0 && (
          <View style={styles.detailCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your Joined Events</Text>
              <TouchableOpacity onPress={() => openDashboardSection(joinedEventsSection)}>
                <Text style={styles.linkText}>Open list</Text>
              </TouchableOpacity>
            </View>

            {renderSectionCard(joinedEventsSection)}
          </View>
        )}

        {availableEvents.length > 0 && (
          <View style={styles.detailCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Available Events</Text>
              <TouchableOpacity onPress={() => openDashboardSection(availableEventsSection)}>
                <Text style={styles.linkText}>Open list</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionSubtitle}>Events you can join and contribute to</Text>

            {renderSectionCard(availableEventsSection)}
          </View>
        )}

        <View style={styles.detailCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Programs</Text>
            <TouchableOpacity onPress={() => openDashboardSection(programsSection)}>
              <Text style={styles.linkText}>Open list</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionSubtitle}>The three core program areas currently available in the system</Text>

          {renderSectionCard(programsSection)}
        </View>

        {joinedProjects.length > 0 && (
          <View style={styles.detailCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your Joined Programs</Text>
              <TouchableOpacity onPress={() => openDashboardSection(joinedProjectsSection)}>
                <Text style={styles.linkText}>Open list</Text>
              </TouchableOpacity>
            </View>

            {renderSectionCard(joinedProjectsSection)}
          </View>
        )}

        {availableProjects.length > 0 && (
          <View style={styles.detailCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Available Projects</Text>
              <TouchableOpacity onPress={() => openDashboardSection(availableProjectsSection)}>
                <Text style={styles.linkText}>Open list</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionSubtitle}>Projects you can join and contribute to</Text>

            {renderSectionCard(availableProjectsSection)}
          </View>
        )}
      </ScrollView>
      <Modal
        visible={Boolean(selectedDashboardSection)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedDashboardSection(null)}
      >
        <View style={styles.previewModalBackdrop}>
          <View style={styles.previewModalCard}>
            <View style={styles.previewModalHeader}>
              <View style={styles.previewModalHeaderCopy}>
                <Text style={styles.previewModalEyebrow}>{selectedDashboardSection?.eyebrow || 'Dashboard List'}</Text>
                <Text style={styles.previewModalTitle}>{selectedDashboardSection?.title || 'Items'}</Text>
              </View>
              <TouchableOpacity
                style={styles.previewModalClose}
                onPress={() => setSelectedDashboardSection(null)}
                activeOpacity={0.85}
              >
                <MaterialIcons name="close" size={20} color="#475569" />
              </TouchableOpacity>
            </View>

            <Text style={styles.previewModalDescription}>
              {selectedDashboardSection?.items.length
                ? selectedDashboardSection?.subtitle
                : selectedDashboardSection?.emptyText || 'No items available.'}
            </Text>

            <ScrollView style={styles.sectionListModalScroll} contentContainerStyle={styles.sectionListModalContent}>
              {selectedDashboardSection?.items.length ? (
                selectedDashboardSection.items.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.sectionListItem}
                    onPress={() => openDashboardCardFromList(item)}
                    activeOpacity={0.88}
                  >
                    <View style={styles.sectionListItemHeader}>
                      <View style={styles.sectionListItemHeaderCopy}>
                        <Text style={styles.sectionListItemEyebrow}>{item.eyebrow}</Text>
                        <Text style={styles.sectionListItemTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                        {item.skillMatch?.hasMatch && (
                          <View style={styles.skillMatchBadge}>
                            <MaterialIcons name="stars" size={14} color="#16a34a" />
                            <Text style={styles.skillMatchText}>
                              Skills Match: {item.skillMatch.matchedSkills.join(', ')}
                            </Text>
                          </View>
                        )}
                      </View>
                      {item.badgeLabel ? (
                        <View
                          style={[
                            styles.previewCardBadge,
                            item.badgeColor ? { backgroundColor: `${item.badgeColor}1F`, borderColor: item.badgeColor } : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.previewCardBadgeText,
                              item.badgeColor ? { color: item.badgeColor } : null,
                            ]}
                          >
                            {item.badgeLabel}
                          </Text>
                        </View>
                      ) : (
                        <MaterialIcons name="chevron-right" size={18} color="#94a3b8" />
                      )}
                    </View>

                    <Text style={styles.sectionListItemDescription} numberOfLines={2}>
                      {item.description}
                    </Text>

                    <View style={styles.sectionListItemFooter}>
                      <Text style={styles.sectionListItemFooterText}>Tap to open</Text>
                      <MaterialIcons name="north-east" size={16} color="#166534" />
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.emptyStateCard}>
                  <MaterialIcons name="inbox" size={28} color="#94a3b8" />
                  <Text style={styles.emptyStateTitle}>{selectedDashboardSection?.emptyTitle || 'Nothing here yet'}</Text>
                  <Text style={styles.emptySectionText}>{selectedDashboardSection?.emptyText || 'No items available.'}</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={Boolean(selectedDashboardCard)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedDashboardCard(null)}
      >
        <View style={styles.previewModalBackdrop}>
          <View style={styles.previewModalCard}>
            <View style={styles.previewModalHeader}>
              <View style={styles.previewModalHeaderCopy}>
                <Text style={styles.previewModalEyebrow}>{selectedDashboardCard?.eyebrow || 'Details'}</Text>
                <Text style={styles.previewModalTitle}>{selectedDashboardCard?.title || 'Details'}</Text>
              </View>
              <TouchableOpacity
                style={styles.previewModalClose}
                onPress={() => setSelectedDashboardCard(null)}
                activeOpacity={0.85}
              >
                <MaterialIcons name="close" size={20} color="#475569" />
              </TouchableOpacity>
            </View>

            {selectedDashboardCard?.description ? (
              <Text style={styles.previewModalDescription}>{selectedDashboardCard.description}</Text>
            ) : null}

            <View style={styles.previewModalDetails}>
              {(selectedDashboardCard?.details || []).map(detail => (
                <View key={`${selectedDashboardCard?.id}-${detail.label}`} style={styles.previewModalDetailRow}>
                  <Text style={styles.previewModalDetailLabel}>{detail.label}</Text>
                  <Text style={styles.previewModalDetailValue}>{detail.value}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.previewModalAction}
              onPress={() => {
                if (selectedDashboardCard) {
                  navigateFromDashboardCard(selectedDashboardCard);
                }
              }}
              activeOpacity={0.88}
            >
              <Text style={styles.previewModalActionText}>
                {selectedDashboardCard?.ctaLabel || 'Open Details'}
              </Text>
              <MaterialIcons name="north-east" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ModernTheme.colors.background.secondary,
  },
  content: {
    padding: ModernTheme.spacing[3.5],
    paddingBottom: ModernTheme.spacing[8],
    gap: ModernTheme.spacing[3.5],
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ModernTheme.colors.background.primary,
    padding: ModernTheme.spacing[6],
  },
  loadingCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: ModernTheme.borderRadius.xl,
    backgroundColor: ModernTheme.colors.background.card,
    alignItems: 'center',
    paddingHorizontal: ModernTheme.spacing[5],
    paddingVertical: ModernTheme.spacing[5.5],
    borderWidth: 0,
    borderColor: 'transparent',
    gap: ModernTheme.spacing[2.5],
    ...ModernTheme.shadows.lg,
  },
  loadingTitle: {
    fontSize: ModernTheme.typography.fontSize.lg,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
  },
  loadingText: {
    textAlign: 'center',
    fontSize: ModernTheme.typography.fontSize.sm,
    lineHeight: 18,
    color: ModernTheme.colors.text.secondary,
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[3],
    borderRadius: ModernTheme.borderRadius['2xl'],
    backgroundColor: ModernTheme.colors.background.card,
    paddingHorizontal: ModernTheme.spacing[3.5],
    paddingVertical: ModernTheme.spacing[3],
    borderWidth: 0,
    borderColor: 'transparent',
    ...ModernTheme.shadows.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.primary[900],
    alignItems: 'center',
    justifyContent: 'center',
    ...ModernTheme.shadows.sm,
  },
  avatarText: {
    color: ModernTheme.colors.text.inverse,
    fontSize: ModernTheme.typography.fontSize.lg,
    fontWeight: ModernTheme.typography.fontWeight.bold,
  },
  headerCopy: {
    flex: 1,
  },
  greeting: {
    marginTop: ModernTheme.spacing[0.5],
    fontSize: ModernTheme.typography.fontSize.xl,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
  },
  role: {
    fontSize: ModernTheme.typography.fontSize.xs,
    color: ModernTheme.colors.primary[700],
    fontWeight: ModernTheme.typography.fontWeight.bold,
    letterSpacing: ModernTheme.typography.letterSpacing.wide,
    textTransform: 'uppercase',
  },
  headerHint: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 12,
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
    fontSize: 11,
    lineHeight: 16,
    color: '#b91c1c',
  },
  errorAction: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991b1b',
  },
  heroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#14532d',
    padding: 18,
    shadowColor: '#14532d',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  heroAccentCircle: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(187,247,208,0.14)',
    right: -70,
    top: -56,
  },
  heroAccentCircleSmall: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(250,204,21,0.12)',
    right: 32,
    bottom: -42,
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
    backgroundColor: '#bbf7d0',
  },
  heroChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  heroTitle: {
    marginTop: 18,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#dcfce7',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  metricCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  metricValue: {
    marginTop: 6,
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
  },
  metricLabel: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 13,
    color: '#dcfce7',
  },
  section: {
    gap: 14,
  },
  detailCard: {
    borderRadius: 20,
    backgroundColor: '#ffffff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#dbe7df',
  },
  profileCard: {
    borderRadius: 20,
    backgroundColor: '#ffffff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#dbe7df',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  sectionEyebrow: {
    marginBottom: 3,
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  linkText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 10,
  },
  sectionSummaryCard: {
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 12,
    gap: 10,
  },
  sectionSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionSummaryHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionSummaryEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionSummaryTitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionSummaryCountBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  sectionSummaryCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  sectionSummarySubtitle: {
    fontSize: 11,
    lineHeight: 17,
    color: '#475569',
  },
  sectionSummaryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  sectionSummaryFooterText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  previewCardBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  previewCardBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  detailHeroPanel: {
    borderRadius: 18,
    backgroundColor: '#f4fbf6',
    borderWidth: 1,
    borderColor: '#cfe8d6',
    padding: 14,
    marginBottom: 12,
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
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  detailHeroTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailHeroText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  detailSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  detailSummaryCard: {
    minWidth: 132,
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 16,
    backgroundColor: '#fbfdfb',
    borderWidth: 1,
    borderColor: '#e4ede7',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  detailSummaryEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailSummaryValue: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailSummaryMeta: {
    marginTop: 6,
    fontSize: 10,
    lineHeight: 15,
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
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '700',
    color: '#64748b',
  },
  detailValue: {
    flex: 1,
    fontSize: 12,
    lineHeight: 20,
    color: '#0f172a',
    fontWeight: '600',
  },
  emptySectionText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  emptyStateCard: {
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    gap: 8,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  emptyStateButton: {
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  emptyStateButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  profileIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  profileAvatarLarge: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: '#e6f7cd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallEditButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#166534',
  },
  profileIdentityCopy: {
    flex: 1,
  },
  profileName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  profileMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
  },
  quickActionRow: {
    gap: 10,
  },
  quickActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#ffffff',
    padding: 12,
    borderWidth: 1,
    borderColor: '#d8e7dc',
    gap: 10,
  },
  quickActionPrimary: {
    backgroundColor: '#f7fee7',
    borderColor: '#bef264',
  },
  quickActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionCopy: {
    flex: 1,
  },
  quickActionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  quickActionText: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  messageCountBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageCountText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  projectsList: {
    gap: 10,
  },
  projectItem: {
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 9,
  },
  projectItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  projectItemBadges: {
    alignItems: 'flex-end',
    gap: 5,
  },
  projectItemTitle: {
    flex: 1,
    fontSize: 14,
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
    fontSize: 10,
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
    fontSize: 10,
    fontWeight: '700',
  },
  projectItemDescription: {
    fontSize: 11,
    lineHeight: 16,
    color: '#475569',
  },
  projectItemMeta: {
    gap: 6,
  },
  projectItemMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  projectItemMetaText: {
    fontSize: 10,
    color: '#64748b',
  },
  previewModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  previewModalCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 18,
    gap: 14,
  },
  previewModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  previewModalHeaderCopy: {
    flex: 1,
  },
  previewModalEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  previewModalTitle: {
    marginTop: 5,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  previewModalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewModalDescription: {
    fontSize: 12,
    lineHeight: 19,
    color: '#475569',
  },
  previewModalDetails: {
    gap: 10,
  },
  sectionListModalScroll: {
    maxHeight: 380,
  },
  sectionListModalContent: {
    gap: 10,
  },
  sectionListItem: {
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 12,
    gap: 10,
  },
  sectionListItemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionListItemHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionListItemEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionListItemTitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: '#0f172a',
  },
  skillMatchBadge: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    gap: 4,
    alignSelf: 'flex-start',
  },
  skillMatchText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#166534',
  },
  sectionListItemDescription: {
    fontSize: 11,
    lineHeight: 17,
    color: '#475569',
  },
  sectionListItemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  sectionListItemFooterText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  previewModalDetailRow: {
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  previewModalDetailLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewModalDetailValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  previewModalAction: {
    marginTop: 4,
    borderRadius: 16,
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  previewModalActionText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },

  // ── Google Calendar sync card ──────────────────────────────────────────────
  gcalSyncCard: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: '#f0fdf4',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  gcalSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  gcalSyncLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  gcalSyncIcon: {
    fontSize: 24,
  },
  gcalSyncTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#14532d',
  },
  gcalSyncSub: {
    fontSize: 11,
    color: '#166534',
    marginTop: 2,
  },
  gcalSyncBtn: {
    backgroundColor: '#1a73e8',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gcalSyncBtnBusy: {
    backgroundColor: '#93c5fd',
  },
  gcalSyncBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  gcalSuccessBanner: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    backgroundColor: '#dcfce7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gcalSuccessEmoji: {
    fontSize: 22,
  },
  gcalSuccessTextBlock: {
    flex: 1,
  },
  gcalSuccessTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#14532d',
  },
  gcalSuccessSub: {
    fontSize: 11,
    color: '#166534',
    marginTop: 2,
  },
  gcalSuccessDismiss: {
    fontSize: 14,
    color: '#166534',
    fontWeight: '700',
    paddingHorizontal: 4,
  },
});
