import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { VolunteerTabParamList } from '../navigation/VolunteerNavigator';
import {
  getProjectsScreenSnapshot,
  getDashboardTimelineSnapshot,
  getMessagesForUser,
  reconcileApprovedVolunteerEventMemberships,
  subscribeToStorageChanges,
  subscribeToMessages,
  requestVolunteerProjectJoin,
} from '../models/storage';
import type { Project, Volunteer, VolunteerTimeLog, AdminPlanningItem, ProgramTrack, VolunteerProjectMatch } from '../models/types';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage } from '../utils/requestErrors';
import { debounce } from '../utils/navigation';
import { openAddGoogleCalendarEvent, fetchGoogleCalendarEvents, getStoredCalendarConfig } from '../utils/calendarSync';
import {
  GOOGLE_CALENDAR_WEB_URL,
  assertGoogleCalendarAccountMatchesUser,
  getGoogleAuthConfig,
  sendGoogleCalendarSyncEmail,
  syncProjectsToGoogleCalendar,
} from '../utils/googleCalendarSync';

type VolunteerNavProp = BottomTabNavigationProp<VolunteerTabParamList>;

function isVolunteerOpportunityOpen(project: Project): boolean {
  const status = getProjectDisplayStatus(project);
  return status !== 'Completed' && status !== 'Cancelled';
}

function getGoogleEventsForDay(
  day: number,
  month: number,
  year: number,
  events: any[]
): any[] {
  const targetStart = new Date(year, month, day, 0, 0, 0, 0).getTime();
  const targetEnd = new Date(year, month, day, 23, 59, 59, 999).getTime();

  return events.filter(event => {
    let startStr = event.start?.dateTime || event.start?.date;
    let endStr = event.end?.dateTime || event.end?.date;
    if (!startStr) return false;
    
    let startMs = new Date(startStr).getTime();
    let endMs = endStr ? new Date(endStr).getTime() : startMs;

    if (event.start?.date && event.end?.date) {
      endMs = endMs - 1000;
    }

    return (startMs <= targetEnd && endMs >= targetStart);
  });
}

function formatGoogleEventTime(event: any): string {
  if (event.start?.date) {
    return 'All Day';
  }
  
  const startStr = event.start?.dateTime;
  const endStr = event.end?.dateTime;
  if (!startStr) return 'TBD';

  const start = new Date(startStr);
  const end = endStr ? new Date(endStr) : null;

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (end) {
    return `${formatTime(start)} - ${formatTime(end)}`;
  }
  return formatTime(start);
}


function normalizeWords(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Nutrition: ['nutrition', 'food', 'feeding', 'meal', 'health', 'diet'],
  Education: ['education', 'school', 'teaching', 'learning', 'student', 'training'],
  Livelihood: ['livelihood', 'income', 'business', 'employment', 'skills', 'work'],
  Disaster: ['disaster', 'relief', 'emergency', 'response', 'rescue', 'recovery'],
};

function checkEventSkillMatch(
  project: Project,
  volunteer: Volunteer | null
): {
  hasMatch: boolean;
  matchedSkills: string[];
} {
  if (!volunteer) {
    return { hasMatch: false, matchedSkills: [] };
  }

  const volunteerTerms = unique([
    ...(volunteer.skills || []).flatMap(s => normalizeWords(s)),
    ...normalizeWords(volunteer.skillsDescription || ''),
    ...normalizeWords(volunteer.specialSkills || ''),
  ]);

  if (volunteerTerms.length === 0) {
    return { hasMatch: false, matchedSkills: [] };
  }

  const categoryTerms = (project.category && CATEGORY_KEYWORDS[project.category]) || [];
  const eventTerms = unique([
    ...normalizeWords(project.title || ''),
    ...normalizeWords(project.description || ''),
    ...(project.skillsNeeded || []).flatMap(s => normalizeWords(s)),
    ...categoryTerms,
  ]);

  const matched = volunteerTerms.filter(term => eventTerms.includes(term));
  const matchedSkills = unique(matched).slice(0, 3);

  return {
    hasMatch: matchedSkills.length > 0,
    matchedSkills,
  };
}

export default function VolunteerDashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<VolunteerNavProp>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);

  const [currentDate, setCurrentDate] = useState(new Date(2026, 6, 27));

  // Google Calendar Integration states
  const [calendarSettings, setCalendarSettings] = useState({
    calendarId: 'en.philippines#holiday@group.v.calendar.google.com',
    apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || '',
  });
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const googleAuthConfig = useMemo(() => getGoogleAuthConfig(user?.email), [user?.email]);
  const [googleAuthRequest, , promptGoogleAuth] = AuthSession.useAuthRequest(
    googleAuthConfig.request,
    googleAuthConfig.discovery
  );

  // Load calendar settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      const config = await getStoredCalendarConfig();
      setCalendarSettings(config);
    };
    loadSettings();
  }, []);

  // Fetch events when currentDate or calendarSettings change
  useEffect(() => {
    let active = true;
    const fetchGCalEvents = async () => {
      setCalendarError(null);
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const timeMin = new Date(year, month - 1, 20).toISOString();
      const timeMax = new Date(year, month + 1, 10).toISOString();

      const { items, error } = await fetchGoogleCalendarEvents(
        calendarSettings.calendarId,
        calendarSettings.apiKey,
        timeMin,
        timeMax
      );

      if (active) {
        if (error) {
          // If Google Calendar API key is restricted or blocked, show a friendly status instead of breaking
          setCalendarError(
            error.includes('blocked') || error.includes('not configured') || error.includes('403')
              ? 'Using system schedule (Google Calendar API key not configured in Settings)'
              : error
          );
          setGoogleEvents([]);
        } else {
          setGoogleEvents(items);
        }
      }
    };

    fetchGCalEvents();
    return () => {
      active = false;
    };
  }, [currentDate, calendarSettings]);

  const handleSyncCalendar = async () => {
    if (syncing) {
      return;
    }

    if (!user?.id) {
      Alert.alert('Login Required', 'Please sign in before syncing your calendar.');
      setSyncStatus({ type: 'error', message: 'Sign in before syncing your calendar.' });
      return;
    }

    const volunteerId = volunteerProfile?.id || '';
    const matchedProjectIds = new Set(
      volunteerMatches
        .filter(m => m.status === 'Matched' || m.status === 'Requested')
        .map(m => m.projectId)
    );
    const joinedEvents = projects.filter(project => {
      if (!project.isEvent) {
        return false;
      }

      return (
        matchedProjectIds.has(project.id) ||
        (project.joinedUserIds || []).includes(user.id) ||
        (volunteerId ? (project.volunteers || []).includes(volunteerId) : false) ||
        (volunteerProfile?.pastProjects || []).includes(project.id)
      );
    });

    if (joinedEvents.length === 0) {
      Alert.alert(
        'No Joined Events',
        'Only events joined by your volunteer account can be synced. Join an event first, then sync again.'
      );
      setSyncStatus({ type: 'error', message: 'No joined events were found to sync.' });
      return;
    }

    setSyncing(true);
    setSyncStatus(null);
    try {
      if (!googleAuthRequest) {
        throw new Error('Google sign-in is still initializing. Try again in a moment.');
      }

      const authResult = await promptGoogleAuth();
      const accessToken = authResult.type === 'success' ? authResult.authentication?.accessToken : undefined;
      if (!accessToken) {
        throw new Error('Google Calendar permission was not granted.');
      }

      await assertGoogleCalendarAccountMatchesUser(accessToken, user.email);

      const result = await syncProjectsToGoogleCalendar(accessToken, joinedEvents);
      if (!result.success && result.synced === 0) {
        throw new Error(result.errors[0] || 'Google Calendar sync failed.');
      }

      await sendGoogleCalendarSyncEmail({
        recipientEmail: user.email,
        userName: user.name,
        syncedCount: result.synced,
        role: 'volunteer',
        calendarUrl: GOOGLE_CALENDAR_WEB_URL,
      });

      if (!result.success) {
        const message = `${result.synced} joined event${result.synced === 1 ? '' : 's'} synced, ${result.failed} failed.`;
        setSyncStatus({ type: 'error', message });
        Alert.alert('Calendar Partially Synced', `${message}\n\n${result.errors.slice(0, 2).join('\n')}`);
        return;
      }

      const successMessage = `${result.synced} joined event${result.synced === 1 ? '' : 's'} added or updated in your Google Calendar.`;
      setSyncStatus({ type: 'success', message: successMessage });
      Alert.alert(
        'Calendar Synced',
        successMessage
      );
    } catch (err) {
      console.error('Failed to sync calendar:', err);
      const message = getRequestErrorMessage(err, 'Unable to sync your Google Calendar.');
      setSyncStatus({ type: 'error', message });
      Alert.alert('Sync Failed', message);
    } finally {
      setSyncing(false);
    }
  };

  const loadDashboardData = React.useCallback(async (force = false) => {
    if (!user?.id) return;
    try {
      await reconcileApprovedVolunteerEventMemberships();
      const [projectSnapshot, timelineSnapshot, messages] = await Promise.all([
        getProjectsScreenSnapshot(
          user,
          [
            'projects',
            'events',
            'programs',
            'volunteerProfile',
            'volunteerMatches',
            'volunteerJoinRecords',
            'timeLogs',
            'programTracks',
          ],
          force
        ),
        getDashboardTimelineSnapshot(),
        getMessagesForUser(user.id),
      ]);

      setProjects(projectSnapshot.projects || []);
      setVolunteerProfile(projectSnapshot.volunteerProfile);
      setVolunteerMatches(projectSnapshot.volunteerMatches || []);
      setTimeLogs(projectSnapshot.timeLogs || []);

      // Gather ONLY real programs from database
      const rawProgramTracks = projectSnapshot.programTracks || [];
      const rawPrograms = projectSnapshot.programs || [];
      const rawParentProjects = (projectSnapshot.projects || []).filter(p => !p.isEvent);

      const seenIds = new Set<string>();
      const combinedPrograms: any[] = [];

      for (const pt of rawProgramTracks) {
        if (pt.id && !seenIds.has(pt.id)) {
          seenIds.add(pt.id);
          combinedPrograms.push(pt);
        }
      }
      for (const pr of rawPrograms) {
        if (pr.id && !seenIds.has(pr.id) && !seenIds.has(pr.title)) {
          seenIds.add(pr.id);
          combinedPrograms.push(pr);
        }
      }
      for (const proj of rawParentProjects) {
        if (proj.id && !seenIds.has(proj.id) && !seenIds.has(proj.title)) {
          seenIds.add(proj.id);
          combinedPrograms.push(proj);
        }
      }

      const resolvedTracks: ProgramTrack[] = combinedPrograms.map((p, idx) => ({
        id: p.id,
        title: p.title || 'Program',
        description: p.description || `${p.category || 'NVC'} program initiative.`,
        icon: p.icon || (idx % 3 === 0 ? 'restaurant' : idx % 3 === 1 ? 'school' : 'work'),
        color: p.color || (idx % 3 === 0 ? '#b45309' : idx % 3 === 1 ? '#166534' : '#991b1b'),
        imageUrl: p.imageUrl,
        sortOrder: idx,
        isActive: true,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      setProgramTracks(resolvedTracks);
      setPlanningItems(timelineSnapshot.planningItems || []);
      setUnreadMessages(messages.filter(msg => !msg.read && msg.recipientId === user.id).length);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    React.useCallback(() => {
      void loadDashboardData(true);

      return subscribeToStorageChanges(
        [
          'projects',
          'events',
          'programs',
          'volunteers',
          'volunteerMatches',
          'volunteerProjectJoins',
          'volunteerTimeLogs',
          'adminPlanningCalendars',
          'adminPlanningItems',
          'programTracks',
        ],
        debounce(() => {
          void loadDashboardData();
        }, 1000)
      );
    }, [loadDashboardData])
  );

  useEffect(() => {
    if (!user?.id) return;
    return subscribeToMessages(user.id, () => {
      void loadDashboardData();
    });
  }, [user?.id, loadDashboardData]);

  // Joined Events calculation
  const joinedEventsCount = useMemo(() => {
    console.log('[DASHBOARD] Calculating joined events count...');
    console.log('[DASHBOARD] volunteerMatches:', volunteerMatches);
    console.log('[DASHBOARD] projects:', projects.length);
    console.log('[DASHBOARD] volunteerProfile:', volunteerProfile?.id);
    console.log('[DASHBOARD] user:', user?.id);
    
    const matchedProjectIds = new Set(
      volunteerMatches
        .filter(m => m.status === 'Matched' || m.status === 'Requested')
        .map(m => m.projectId)
    );
    console.log('[DASHBOARD] matchedProjectIds:', Array.from(matchedProjectIds));
    
    const volunteerId = volunteerProfile?.id || '';
    const userId = user?.id || '';

    const joinedEvents = projects.filter(project => {
      const isEvt = Boolean(project.isEvent || (project.id && project.id.startsWith('event-')));
      if (!isEvt) return false;

      const isMatched =
        matchedProjectIds.has(project.id) ||
        matchedProjectIds.has(project.id.replace('event-', ''));
      const isJoinedByUser = Boolean(userId && project.joinedUserIds?.includes(userId));
      const isJoinedByVol = Boolean(volunteerId && project.volunteers?.includes(volunteerId));
      const isPastProj = Boolean(volunteerProfile?.pastProjects?.includes(project.id));

      console.log(`[DASHBOARD] Event ${project.title}:`, { isMatched, isJoinedByUser, isJoinedByVol, isPastProj });

      return isMatched || isJoinedByUser || isJoinedByVol || isPastProj;
    });
    
    console.log('[DASHBOARD] Joined events count:', joinedEvents.length);
    return joinedEvents.length;
  }, [projects, user?.id, volunteerProfile, volunteerMatches]);

  // Calendar setup
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarCells = useMemo(() => {
    const cells = [];
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({ day: '', isBlank: true });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ day: i, isBlank: false });
    }
    return cells;
  }, [firstDayIndex, daysInMonth]);

  const getDayStatus = (dayNum: number) => {
    const isToday = year === 2026 && month === 6 && dayNum === 27; // Mock today as Jul 27
    
    // Check if day has a project or timeline planning item
    const hasTimeline = planningItems.some(item => {
      if (!item.startDate) return false;
      const itemDate = new Date(item.startDate);
      return (
        itemDate.getFullYear() === year &&
        itemDate.getMonth() === month &&
        itemDate.getDate() === dayNum
      );
    });

    const hasProject = projects.some(proj => {
      if (!proj.startDate) return false;
      const projDate = new Date(proj.startDate);
      return (
        projDate.getFullYear() === year &&
        projDate.getMonth() === month &&
        projDate.getDate() === dayNum
      );
    });

    const hasGoogleEvent = getGoogleEventsForDay(dayNum, month, year, googleEvents).length > 0;

    return {
      isToday,
      isMarked: hasTimeline || hasProject || hasGoogleEvent,
    };
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // Timeline list merging database planning items, projects/events, and synced google events (NO HARDCODED MOCK)
  const displayTimeline = useMemo(() => {
    const realPlanning = (planningItems || [])
      .filter(item => Boolean(item.startDate))
      .map(item => ({
        id: item.id,
        startDate: item.startDate,
        title: item.title,
        htmlLink: undefined,
      }));

    const realProjectEvents = (projects || [])
      .filter(p => Boolean(p.startDate))
      .map(p => ({
        id: p.id,
        startDate: p.startDate,
        title: p.title,
        htmlLink: undefined,
      }));

    const googleTimeline = (googleEvents || []).map(event => ({
      id: `google-${event.id}`,
      startDate: event.start?.dateTime || event.start?.date || '',
      title: event.summary || 'Google Calendar Event',
      htmlLink: event.htmlLink,
    }));

    const combined = [...realPlanning, ...realProjectEvents, ...googleTimeline]
      .filter(item => Boolean(item.startDate))
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 5);

    return combined;
  }, [planningItems, projects, googleEvents]);

  const formatTimelineDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  };

  // Projects list from database
  const displayProjects = useMemo(() => {
    return projects
      .filter(p => Boolean(p.isEvent || (p.id && p.id.startsWith('event-'))))
      .slice(0, 5);
  }, [projects]);

  const isProjectJoined = (project: Project) => {
    const matchedProjectIds = new Set(
      volunteerMatches
        .filter(m => m.status === 'Matched' || m.status === 'Requested')
        .map(m => m.projectId)
    );
    const volunteerId = volunteerProfile?.id || '';
    const userId = user?.id || '';

    const isMatched =
      matchedProjectIds.has(project.id) ||
      matchedProjectIds.has(project.id.replace('event-', ''));
    const isJoinedByUser = Boolean(userId && project.joinedUserIds?.includes(userId));
    const isJoinedByVol = Boolean(volunteerId && project.volunteers?.includes(volunteerId));
    const isPastProj = Boolean(volunteerProfile?.pastProjects?.includes(project.id));

    return isMatched || isJoinedByUser || isJoinedByVol || isPastProj;
  };

  const handleJoinProject = async (project: Project) => {
    if (!user?.id) {
      Alert.alert('Notice', 'Please sign in before joining.');
      return;
    }
    try {
      setLoading(true);
      await requestVolunteerProjectJoin(project.id, user.id);
      Alert.alert('Success', `Successfully requested to join "${project.title}"!`);
      await loadDashboardData(true);
    } catch (err) {
      Alert.alert('Error', getRequestErrorMessage(err, 'Failed to join project'));
    } finally {
      setLoading(false);
    }
  };

  const getProjectIcon = (category: string) => {
    switch (category) {
      case 'Nutrition':
        return (
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path d="M12 2C9 6 5 9 5 14a7 7 0 0 0 14 0c0-5-4-8-7-12Z" stroke="#C97F1F" strokeWidth={2} />
          </Svg>
        );
      case 'Education':
        return (
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path d="M4 6l8-3 8 3-8 3-8-3Z" stroke="#1F3A2E" strokeWidth={2} />
            <Path d="M4 6v7l8 3 8-3V6" stroke="#1F3A2E" strokeWidth={2} />
          </Svg>
        );
      case 'Livelihood':
        return (
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Rect x="4" y="10" width="16" height="9" rx="1.5" stroke="#B0432B" strokeWidth={2} />
            <Path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#B0432B" strokeWidth={2} />
          </Svg>
        );
      default:
        return <MaterialIcons name="help-outline" size={16} color="#5B564C" />;
    }
  };

  if (loading && projects.length === 0) {
    return (
      <View style={styles.loadingWrapper}>
        <ActivityIndicator size="large" color="#1F3A2E" />
      </View>
    );
  }

  return (
    <View style={[styles.rootContainer, { paddingTop: Math.max(insets.top, 12) }]}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.greetingLabel}>Volunteer Workspace</Text>
              <Text style={styles.greetingName}>Hello, {user?.name || 'Volunteer'}</Text>
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'V'}</Text>
            </View>
          </View>
          <Text style={styles.headerSub}>Track your service, schedule, tasks, and messages in one place.</Text>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <View style={styles.statusText}>
              <Text style={styles.statusTitle}>
                Account status: {volunteerProfile?.registrationStatus || 'Approved'}
              </Text>
              <Text style={styles.statusDesc}>Your service dashboard is ready.</Text>
            </View>
          </View>
        </View>

        {/* STATS */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{joinedEventsCount}</Text>
            <Text style={styles.statLabel}>Joined events</Text>
          </View>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => navigation.navigate('Messages')}
            activeOpacity={0.7}
          >
            <Text style={styles.statNum}>{unreadMessages}</Text>
            <Text style={styles.statLabel}>Unread messages</Text>
          </TouchableOpacity>
        </View>

        {/* PRIORITY */}
        <View style={styles.priorityCard}>
          <View style={styles.priorityIcon}>
            <MaterialIcons name="access-time" size={18} color="#22201B" />
          </View>
          <View style={styles.priorityCopy}>
            <Text style={styles.priorityTitle}>Next priority: Event details</Text>
            <Text style={styles.priorityDesc}>See what needs attention first, then review your next event.</Text>
          </View>
        </View>

        {/* CALENDAR */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={styles.sectionTitle}>Volunteer calendar</Text>
              <Text style={styles.sectionSub}>Shared project schedule and admin timeline</Text>
            </View>
            <TouchableOpacity
              onPress={handleSyncCalendar}
              disabled={syncing}
              style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
            >
              {syncing ? (
                <ActivityIndicator size={12} color="#16a34a" />
              ) : (
                <MaterialIcons name="sync" size={14} color="#16a34a" />
              )}
              <Text style={styles.syncButtonText}>{syncing ? 'Syncing...' : 'Sync Calendar'}</Text>
            </TouchableOpacity>
          </View>
          {syncStatus ? (
            <View
              style={[
                styles.syncStatus,
                syncStatus.type === 'success' ? styles.syncStatusSuccess : styles.syncStatusError,
              ]}
            >
              <MaterialIcons
                name={syncStatus.type === 'success' ? 'check-circle-outline' : 'error-outline'}
                size={14}
                color={syncStatus.type === 'success' ? '#166534' : '#b91c1c'}
              />
              <Text
                style={[
                  styles.syncStatusText,
                  syncStatus.type === 'success' ? styles.syncStatusSuccessText : styles.syncStatusErrorText,
                ]}
              >
                {syncStatus.message}
              </Text>
            </View>
          ) : null}
          
          <View style={styles.calCard}>
            <View style={styles.calBadge}>
              <MaterialIcons name="done" size={10} color="#2C4C3B" style={{ marginRight: 4 }} />
              <Text style={styles.calBadgeText}>Admin calendar synced</Text>
            </View>
            <View style={styles.calHeader}>
              <Text style={styles.calMonth}>{monthLabel}</Text>
              <View style={styles.calNav}>
                <TouchableOpacity onPress={handlePrevMonth} style={styles.calNavButton}>
                  <Text style={styles.calNavButtonText}>‹</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleNextMonth} style={styles.calNavButton}>
                  <Text style={styles.calNavButtonText}>›</Text>
                </TouchableOpacity>
              </View>
            </View>


            {/* Calendar Grid */}
            <View style={styles.calGrid}>
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(dow => (
                <Text key={dow} style={styles.calDow}>{dow}</Text>
              ))}
              {calendarCells.map((cell, idx) => {
                if (cell.isBlank) {
                  return <View key={`blank-${idx}`} style={styles.calDayBlank} />;
                }
                const { isToday, isMarked } = getDayStatus(cell.day as number);
                return (
                  <View
                    key={`day-${cell.day}`}
                    style={[
                      styles.calDayCell,
                      isToday && styles.calDayToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.calDayText,
                        isToday && styles.calDayTodayText,
                        isMarked && !isToday && styles.calDayMarkedText,
                      ]}
                    >
                      {cell.day}
                    </Text>
                    {isMarked && (
                      <View style={[styles.calDotMarker, isToday && styles.calDotMarkerToday]} />
                    )}
                  </View>
                );
              })}
            </View>

            <View style={styles.calFoot}>
              <View style={styles.calMetric}>
                <Text style={styles.calMetricNum}>{displayTimeline.length}</Text>
                <Text style={styles.calMetricLabel}>Timeline items</Text>
              </View>
              <View style={styles.calMetric}>
                <Text style={styles.calMetricNum}>
                  {projects.filter(p => p.isEvent).length}
                </Text>
                <Text style={styles.calMetricLabel}>Project dates</Text>
              </View>
            </View>
          </View>
        </View>

        {/* TIMELINE */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={styles.sectionTitle}>Upcoming timeline</Text>
              <Text style={styles.sectionSub}>Projects and admin plans</Text>
            </View>
          </View>
          <View style={[styles.calCard, { paddingVertical: 14, paddingHorizontal: 16 }]}>
            {displayTimeline.length > 0 ? (
              displayTimeline.map((item, idx) => {
                const content = (
                  <View style={styles.timelineItem}>
                    <View style={styles.timelineDotWrap}>
                      <View style={[styles.timelineDot, item.htmlLink && { backgroundColor: '#10b981' }]} />
                      {idx < displayTimeline.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineDate}>{formatTimelineDate(item.startDate)}</Text>
                      <Text style={[styles.timelineTitle, item.htmlLink && { color: '#047857' }]}>
                        {item.title} {item.htmlLink && '(Google Cal)'}
                      </Text>
                    </View>
                  </View>
                );

                if (item.htmlLink) {
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => {
                        Linking.openURL(item.htmlLink).catch(err => {
                          console.error('Failed to open link:', err);
                        });
                      }}
                      activeOpacity={0.8}
                    >
                      {content}
                    </TouchableOpacity>
                  );
                }

                return <View key={item.id}>{content}</View>;
              })
            ) : (
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#78716C', fontStyle: 'italic' }}>
                  No upcoming timeline items scheduled.
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* PROGRAMS */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={styles.sectionTitle}>Programs</Text>
              <Text style={styles.sectionSub}>Active programs in the system</Text>
            </View>
          </View>
          {programTracks && programTracks.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.programsContainer}>
              {programTracks.map((track, idx) => {
                const cardStyle = idx % 3 === 0 ? styles.programCardN : idx % 3 === 1 ? styles.programCardE : styles.programCardL;
                return (
                  <TouchableOpacity
                    key={track.id}
                    style={[styles.programCard, cardStyle]}
                    activeOpacity={0.8}
                    onPress={() => navigation.navigate('Events')}
                  >
                    <Text style={styles.programTitle}>{track.title}</Text>
                    <Text style={styles.programDesc} numberOfLines={2}>{track.description || 'Community program initiative.'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={[styles.calCard, { paddingVertical: 14, alignItems: 'center' }]}>
              <Text style={{ fontSize: 13, color: '#78716C', fontStyle: 'italic' }}>
                No active programs scheduled.
              </Text>
            </View>
          )}
        </View>

        {/* PROJECTS */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={styles.sectionTitle}>Available events</Text>
              <Text style={styles.sectionSub}>Events you can join and contribute to</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Events')}>
              <Text style={styles.sectionLink}>See all</Text>
            </TouchableOpacity>
          </View>

          {displayProjects.length > 0 ? (
            displayProjects.map(project => {
              const skillMatch = checkEventSkillMatch(project, volunteerProfile);
              const isJoined = isProjectJoined(project);
              return (
                <View key={project.id} style={styles.projectRow}>
                  <View style={styles.projectIcon}>
                    {getProjectIcon(project.category)}
                  </View>
                  <View style={styles.projectInfo}>
                    <Text style={styles.projectTitleText}>{project.title}</Text>
                    {skillMatch.hasMatch && (
                      <View style={styles.skillMatchBadge}>
                        <MaterialIcons name="stars" size={14} color="#16a34a" />
                        <Text style={styles.skillMatchText}>
                          Skills Match: {skillMatch.matchedSkills.join(', ')}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.projectMeta}>
                      {project.location?.address || 'Bacolod City'} · {project.volunteersNeeded || 4} volunteers needed
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.projectJoin, isJoined && styles.projectJoined]}
                    onPress={() => !isJoined && handleJoinProject(project)}
                    disabled={isJoined}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.projectJoinText, isJoined && styles.projectJoinedText]}>
                      {isJoined ? 'Joined' : 'Join'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          ) : (
            <View style={[styles.calCard, { paddingVertical: 14, alignItems: 'center' }]}>
              <Text style={{ fontSize: 13, color: '#78716C', fontStyle: 'italic' }}>
                No available events scheduled.
              </Text>
            </View>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#FAF5E9',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 90,
  },
  loadingWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5E9',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 22,
    backgroundColor: '#1F3A2E',
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  greetingLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E8A33D',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  greetingName: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 20,
    color: '#ffffff',
    marginTop: 4,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8A33D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    color: '#22201B',
    fontSize: 15,
  },
  headerSub: {
    fontSize: 12.5,
    color: '#CBD6CF',
    lineHeight: 18,
    marginBottom: 16,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#6FCF8F',
    marginRight: 10,
  },
  statusText: {
    flex: 1,
  },
  statusTitle: {
    fontWeight: '700',
    fontSize: 13,
    color: '#ffffff',
  },
  statusDesc: {
    fontSize: 11.5,
    color: '#CBD6CF',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 16,
    padding: 14,
  },
  statNum: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 26,
    color: '#1F3A2E',
  },
  statLabel: {
    fontSize: 11.5,
    color: '#5B564C',
    marginTop: 2,
  },
  priorityCard: {
    marginHorizontal: 20,
    marginTop: 18,
    backgroundColor: '#F2E9D8',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C97F1F',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E8A33D',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  priorityCopy: {
    flex: 1,
  },
  priorityTitle: {
    fontWeight: '700',
    fontSize: 12.5,
    color: '#22201B',
  },
  priorityDesc: {
    fontSize: 11.5,
    color: '#5B564C',
    marginTop: 2,
  },
  section: {
    marginHorizontal: 20,
    marginTop: 26,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  syncButtonDisabled: {
    opacity: 0.65,
  },
  syncButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#16a34a',
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  syncStatusSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  syncStatusError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  syncStatusText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: '600',
  },
  syncStatusSuccessText: {
    color: '#166534',
  },
  syncStatusErrorText: {
    color: '#b91c1c',
  },

  sectionTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 18,
    color: '#22201B',
  },
  sectionSub: {
    fontSize: 11.5,
    color: '#5B564C',
    marginTop: 2,
  },
  sectionLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B0432B',
  },
  calCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 18,
    padding: 16,
  },
  calBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E4EEE7',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 100,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  calBadgeText: {
    color: '#2C4C3B',
    fontSize: 10.5,
    fontWeight: '700',
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calMonth: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 14.5,
    color: '#22201B',
  },
  calNav: {
    flexDirection: 'row',
    gap: 8,
  },
  calNavButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F2E9D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calNavButtonText: {
    fontSize: 11,
    color: '#5B564C',
    fontWeight: '700',
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calDow: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: '#5B564C',
    paddingBottom: 6,
  },
  calDayBlank: {
    width: '14.28%',
    height: 30,
  },
  calDayCell: {
    width: '14.28%',
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    position: 'relative',
    marginVertical: 2,
  },
  calDayText: {
    fontSize: 11.5,
    color: '#22201B',
  },
  calDayToday: {
    backgroundColor: '#1F3A2E',
  },
  calDayTodayText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  calDayMarkedText: {
    fontWeight: '700',
    color: '#B0432B',
  },
  calDotMarker: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#B0432B',
  },
  calDotMarkerToday: {
    backgroundColor: '#ffffff',
  },
  calFoot: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#DED2B4',
  },
  calMetric: {
    flex: 1,
  },
  calMetricNum: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 17,
    color: '#1F3A2E',
  },
  calMetricLabel: {
    fontSize: 10.5,
    color: '#5B564C',
    marginTop: 2,
  },
  timelineItem: {
    flexDirection: 'row',
    paddingVertical: 12,
  },
  timelineDotWrap: {
    alignItems: 'center',
    width: 16,
    marginRight: 10,
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#C97F1F',
    marginTop: 4,
  },
  timelineLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: '#DED2B4',
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
  },
  timelineDate: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#5B564C',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#22201B',
    marginTop: 2,
  },
  programsContainer: {
    paddingRight: 20,
  },
  programCard: {
    width: 150,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginRight: 12,
  },
  programCardN: {
    backgroundColor: '#C97F1F',
  },
  programCardE: {
    backgroundColor: '#1F3A2E',
  },
  programCardL: {
    backgroundColor: '#B0432B',
  },
  programTitle: {
    fontWeight: '700',
    fontSize: 13.5,
    color: '#ffffff',
    marginBottom: 6,
  },
  programDesc: {
    fontSize: 11,
    lineHeight: 14,
    color: '#ffffff',
    opacity: 0.9,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  projectIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F2E9D8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  projectInfo: {
    flex: 1,
  },
  projectTitleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#22201B',
  },
  projectMeta: {
    fontSize: 11,
    color: '#5B564C',
    marginTop: 2,
  },
  projectJoin: {
    backgroundColor: '#F2E9D8',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 100,
  },
  projectJoinText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1F3A2E',
  },
  projectJoined: {
    backgroundColor: '#3F7A54',
  },
  projectJoinedText: {
    color: '#ffffff',
  },
  skillMatchBadge: {
    marginTop: 4,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    gap: 4,
    alignSelf: 'flex-start',
  },
  skillMatchText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#166534',
  },
});
