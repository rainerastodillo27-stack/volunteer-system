import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
  TextInput,
  Linking,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Circle, Rect, Path, G, Line, Defs, LinearGradient } from 'react-native-svg';
import {
  getDashboardSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import type {
  Partner,
  PartnerProjectApplication,
  Project,
  Volunteer,
  VolunteerProjectJoinRecord,
} from '../models/types';
import { useAuth } from '../contexts/AuthContext';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getMappedProjects } from '../utils/projectMap';
import { withImpactMapFallbackProjects } from '../utils/impactMapFallbacks';
import { getProjectIdsForPartner } from '../utils/mapProjectLinks';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage } from '../utils/requestErrors';

// Helper function to get parent or grandparent program name
function getProjectProgramLabel(project: Project, allProjects: Project[]): string {
  // Check parent project and return its title
  if (project.parentProjectId) {
    const parent = allProjects.find(p => p.id === project.parentProjectId);
    if (parent && parent.title) {
      return parent.title;
    }
  }

  // Check program_id field (alternative parent reference)
  const programId = (project as any).program_id;
  if (programId) {
    const programByProgramId = allProjects.find(p => p.id === programId);
    if (programByProgramId && programByProgramId.title) {
      return programByProgramId.title;
    }
  }

  // For standalone projects/events without parent, try to find matching program by category
  const category = String(project.category || project.programModule || '').trim();
  if (category) {
    // Look for a program that matches this category
    const matchingProgram = allProjects.find(p => {
      const pTitle = String(p.title || '').toLowerCase();
      const pCategory = String(p.category || p.programModule || '').toLowerCase();
      const catLower = category.toLowerCase();
      
      // Check if this is a program (not event, no parent)
      if (p.isEvent || p.parentProjectId) {
        return false;
      }
      
      // Match by category or title containing the category
      return pCategory === catLower || pTitle.includes(catLower);
    });
    
    if (matchingProgram && matchingProgram.title) {
      return matchingProgram.title;
    }
    
    // If no matching program found, return the category itself
    return category;
  }

  return 'General';
}

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

type CalendarFilter = 'All' | 'Scheduled' | 'Drafts';

/** Build a 6×7 grid starting from Monday. Returns dates including overflow from adjacent months. */
function getMonthGridMondayFirst(date: Date): Array<{ day: number; month: number; year: number; isCurrentMonth: boolean }> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // JS getDay(): 0=Sun … 6=Sat  →  shift so Mon=0
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number; month: number; year: number; isCurrentMonth: boolean }> = [];

  // Previous month overflow
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = startOffset - 1; i >= 0; i -= 1) {
    const d = prevMonthDays - i;
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    cells.push({ day: d, month: pm, year: py, isCurrentMonth: false });
  }

  // Current month
  for (let d = 1; d <= totalDays; d += 1) {
    cells.push({ day: d, month, year, isCurrentMonth: true });
  }

  // Next month overflow to fill 6 rows
  while (cells.length < 42) {
    const extra = cells.length - startOffset - totalDays + 1;
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    cells.push({ day: extra, month: nm, year: ny, isCurrentMonth: false });
  }

  return cells;
}

/** Returns projects whose date range overlaps a given calendar day. */
function getProjectsForDay(
  day: number,
  month: number,
  year: number,
  projects: Project[]
): Project[] {
  const target = new Date(year, month, day);
  target.setHours(0, 0, 0, 0);
  return projects.filter(project => {
    const start = new Date(project.startDate);
    if (Number.isNaN(start.getTime())) return false;
    start.setHours(0, 0, 0, 0);
    const end = project.endDate ? new Date(project.endDate) : new Date(start);
    if (Number.isNaN(end.getTime())) return false;
    end.setHours(23, 59, 59, 999);
    return target >= start && target <= end;
  });
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

function formatDateRangeDDMM(startDate?: string, endDate?: string): string {
  const fmt = (v?: string) => {
    if (!v) return '--/--';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '--/--';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  return `${fmt(startDate)}  -  ${fmt(endDate || startDate)}`;
}

type UpcomingGroup = { label: string; projects: Project[] };

function getUpcomingEventGroups(projects: Project[]): UpcomingGroup[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayProjects: Project[] = [];
  const tomorrowProjects: Project[] = [];

  const active = projects.filter(p => {
    if (!p.isEvent) {
      return false;
    }
    const status = getProjectDisplayStatus(p);
    return status === 'Planning' || status === 'In Progress';
  }).sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  for (const project of active) {
    const start = new Date(project.startDate);
    if (Number.isNaN(start.getTime())) continue;
    start.setHours(0, 0, 0, 0);
    const end = project.endDate ? new Date(project.endDate) : new Date(start);
    end.setHours(23, 59, 59, 999);

    if (now >= start && now <= end) {
      todayProjects.push(project);
    } else if (tomorrow >= start && tomorrow <= end) {
      tomorrowProjects.push(project);
    }
  }

  const groups: UpcomingGroup[] = [];
  if (todayProjects.length) groups.push({ label: 'Today', projects: todayProjects });
  if (tomorrowProjects.length) groups.push({ label: 'Tomorrow', projects: tomorrowProjects });

  // If neither today nor tomorrow has events, show the next few upcoming
  if (groups.length === 0 && active.length > 0) {
    groups.push({ label: 'Upcoming', projects: active.slice(0, 4) });
  }

  return groups;
}

// Custom hook to memoize projects by content, not reference, preventing re-renders when projects data is the same
function useStableProjects(projects: Project[]): Project[] {
  const prevProjectsRef = useRef<Project[]>([]);
  const prevHashRef = useRef<string>('');

  const currentHash = JSON.stringify(
    projects.map(p => [p.id, p.location?.latitude, p.location?.longitude])
  );

  if (prevHashRef.current !== currentHash) {
    prevHashRef.current = currentHash;
    prevProjectsRef.current = projects;
  }

  return prevProjectsRef.current;
}

function getVolunteerJoinedProjectIds(
  volunteer: Volunteer,
  projects: Project[],
  joinRecords: VolunteerProjectJoinRecord[]
): string[] {
  const joinedProjectIds = new Set<string>(volunteer.pastProjects || []);

  joinRecords
    .filter(
      record =>
        record.volunteerId === volunteer.id ||
        record.volunteerUserId === volunteer.userId
    )
    .forEach(record => {
      if (record.projectId) {
        joinedProjectIds.add(record.projectId);
      }
    });

  projects.forEach(project => {
    const isJoined =
      (project.volunteers || []).includes(volunteer.id) ||
      (project.joinedUserIds || []).includes(volunteer.userId) ||
      (project.internalTasks || []).some(
        task =>
          task.assignedVolunteerId === volunteer.id ||
          (task.assignedVolunteerIds || []).includes(volunteer.id)
      );

    if (isJoined) {
      joinedProjectIds.add(project.id);
    }
  });

  return Array.from(joinedProjectIds);
}

function formatJoinedCountLabel(count: number): string {
  return `${count} event${count === 1 ? '' : 's'} joined`;
}

// Shows the latest dashboard metrics and shortcuts for the logged-in user.
export default function DashboardScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const { width } = useWindowDimensions();
  const isCompact = width < 420;
  const isDesktop = Platform.OS === 'web' || width >= 1100;
  const perfNow = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const [dashboardProjectCounts, setDashboardProjectCounts] = useState({
    allProjects: 0,
    programs: 0,
    events: 0,
  });
  const [partnerStats, setPartnerStats] = useState({ total: 0, approved: 0, pending: 0 });
  const [userStats, setUserStats] = useState({ total: 0 });
  const [workflowStats, setWorkflowStats] = useState({
    inboundInquiries: 0,
    timeIns: 0,
    timeOuts: 0,
    pendingReports: 0,
  });
  const [pendingVolunteerJoinRequests, setPendingVolunteerJoinRequests] = useState(0);
  const [timeTrackingTarget, setTimeTrackingTarget] = useState({
    latestTimeInProjectId: undefined as string | undefined,
    latestTimeOutProjectId: undefined as string | undefined,
  });
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [projectsData, setProjectsData] = useState<Project[]>([]);
  const [partnersData, setPartnersData] = useState<Partner[]>([]);
  const [partnerApplicationsData, setPartnerApplicationsData] = useState<PartnerProjectApplication[]>([]);
  const [volunteersData, setVolunteersData] = useState<Volunteer[]>([]);
  const [volunteerJoinRecordsData, setVolunteerJoinRecordsData] = useState<
    VolunteerProjectJoinRecord[]
  >([]);
  const [volunteerCompletedProjectIdsByVolunteerId, setVolunteerCompletedProjectIdsByVolunteerId] =
    useState<Record<string, string[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const dashboardLoadInFlightRef = useRef<Promise<void> | null>(null);
  const dashboardReloadQueuedRef = useRef(false);

  // Loads dashboard totals and recent status updates from storage.
  const loadDashboardData = React.useCallback(async () => {
    const startedAt = perfNow();
    try {
      console.log('[DASHBOARD] Loading dashboard snapshot...');
      // Single batch load — getDashboardSnapshot fetches all keys in one request.
      const {
        projects,
        partners,
        users,
        volunteers,
        statusUpdates,
        partnerProjectApplications,
        volunteerTimeLogs,
        volunteerMatches,
        volunteerProjectJoins,
        partnerReports,
        programs,
        programTracks,
        events,
      } = await getDashboardSnapshot();

      console.log('[DASHBOARD] Snapshot loaded:', {
        projects: projects.length,
        programs: programs.length,
        events: events.length,
        programTracks: programTracks.length
      });

      setLoadError(null);
      setProjectsData(projects);
      console.log('[DASHBOARD] Set projectsData to:', projects.length, 'projects');
      setPartnersData(partners);
      setPartnerApplicationsData(partnerProjectApplications || []);
      setVolunteersData(volunteers);
      setVolunteerJoinRecordsData(volunteerProjectJoins || []);

      setDashboardProjectCounts({
        allProjects: projects.filter(
          project => !(programs || []).some(program => program.id === project.id)
        ).length,
        programs: (programTracks || []).length > 0
          ? (programTracks || []).filter(track => track.isActive !== false).length
          : (programs || []).filter(p => !p.parentProjectId && !p.isEvent).length,
        events: (events || []).length || projects.filter(project => project.isEvent).length,
      });

      setPartnerStats({
        total: partners.length,
        approved: partners.filter(p => p.status === 'Approved').length,
        pending: partners.filter(p => p.status === 'Pending').length,
      });

      setUserStats({ total: users.length });

      const projectNamesById = new Map(projects.map(project => [project.id, project.title]));
      const allUpdates = statusUpdates
        .map(update => ({
          ...update,
          projectName: projectNamesById.get(update.projectId) || 'Unknown Project',
        }))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      setRecentUpdates(allUpdates.slice(0, 6));

      // Compute workflow stats from already-loaded data — no extra network calls needed.
      const sortedTimeLogs = [...(volunteerTimeLogs || [])].sort(
        (a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime()
      );
      setWorkflowStats({
        inboundInquiries: partners.filter(p => p.status === 'Pending').length,
        timeIns: sortedTimeLogs.length,
        timeOuts: sortedTimeLogs.filter(log => Boolean(log.timeOut)).length,
        pendingReports: (partnerReports || []).filter(report => report.status === 'Submitted').length,
      });

      setPendingVolunteerJoinRequests(
        (volunteerMatches || []).filter(match => match.status === 'Requested').length
      );

      const latestTimeInLog = sortedTimeLogs[0];
      const latestTimeOutLog = sortedTimeLogs.find(log => Boolean(log.timeOut)) || null;
      setTimeTrackingTarget({
        latestTimeInProjectId: latestTimeInLog?.projectId,
        latestTimeOutProjectId: latestTimeOutLog?.projectId,
      });

      // Count joined work per volunteer from joins, event rosters, task assignments,
      // and older profile history without adding per-volunteer API calls.
      const joinRecords = volunteerProjectJoins || [];
      const completedByVolunteerId: Record<string, string[]> = {};
      for (const volunteer of volunteers) {
        completedByVolunteerId[volunteer.id] = getVolunteerJoinedProjectIds(
          volunteer,
          projects,
          joinRecords
        );
      }
      setVolunteerCompletedProjectIdsByVolunteerId(completedByVolunteerId);

      const elapsedMs = perfNow() - startedAt;
      console.log(`[perf] DashboardScreen data ready in ${Math.round(elapsedMs)}ms`);
    } catch (error) {
      const errorMessage = getRequestErrorMessage(
        error,
        'Database data is unavailable. Check the backend and Supabase connection.'
      );
      setLoadError(errorMessage);
      setRecentUpdates([]);
      setProjectsData([]);
      setPartnersData([]);
      setVolunteersData([]);
      setVolunteerJoinRecordsData([]);
      setVolunteerCompletedProjectIdsByVolunteerId({});
      setDashboardProjectCounts({
        allProjects: 0,
        programs: 0,
        events: 0,
      });
    }
  }, []);

  const loadDashboardDataCoalesced = React.useCallback(async () => {
    if (dashboardLoadInFlightRef.current) {
      dashboardReloadQueuedRef.current = true;
      return;
    }

    do {
      dashboardReloadQueuedRef.current = false;
      const task = loadDashboardData();
      dashboardLoadInFlightRef.current = task;
      try {
        await task;
      } finally {
        dashboardLoadInFlightRef.current = null;
      }
    } while (dashboardReloadQueuedRef.current);
  }, [loadDashboardData]);

  useFocusEffect(
    React.useCallback(() => {
      void loadDashboardDataCoalesced();
      return subscribeToStorageChanges(
        [
          'users',
          'projects',
          'programs',
          'events',
          'programTracks',
          'partners',
          'partnerProjectApplications',
          'volunteers',
          'statusUpdates',
          'volunteerProjectJoins',
          'volunteerMatches',
          'volunteerTimeLogs',
          'partnerReports',
        ],
        async () => {
          await loadDashboardDataCoalesced();
        }
      );
    }, [loadDashboardDataCoalesced])
  );
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

  const impactMapSourceProjects = useMemo(
    () =>
      withImpactMapFallbackProjects(
        projectsData,
        partnerApplicationsData,
        volunteerJoinRecordsData
      ),
    [partnerApplicationsData, projectsData, volunteerJoinRecordsData]
  );

  const mapProjects = useMemo(
    () => getMappedProjects(impactMapSourceProjects),
    [impactMapSourceProjects]
  );

  // Memoize mapProjects by content to prevent unnecessary map re-renders from WebSocket updates
  const stableMapProjects = useStableProjects(mapProjects);

  const volunteerMapAccounts = useMemo(
    () =>
      [...volunteersData]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(volunteer => {
          const joinedProjectIds = new Set([
            ...(volunteer.pastProjects || []),
            ...volunteerJoinRecordsData
              .filter(
                record =>
                  record.volunteerId === volunteer.id ||
                  record.volunteerUserId === volunteer.userId
              )
              .map(record => record.projectId),
          ]);
          const joinedEventProjectIds = impactMapSourceProjects
            .filter(
              project =>
                project.isEvent &&
                (
                  joinedProjectIds.has(project.id) ||
                  (project.joinedUserIds || []).includes(volunteer.userId) ||
                  (project.volunteers || []).includes(volunteer.id) ||
                  (project.internalTasks || []).some(
                    task =>
                      task.assignedVolunteerId === volunteer.id ||
                      (task.assignedVolunteerIds || []).includes(volunteer.id)
                  )
                )
            )
            .map(project => project.id);

          return {
            id: volunteer.id,
            label: volunteer.name,
            projectIds: joinedEventProjectIds,
          };
        }),
    [impactMapSourceProjects, volunteerJoinRecordsData, volunteersData]
  );

  const partnerMapAccounts = useMemo(
    () => {
      const accounts = [...partnersData]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(partner => {
          const projectIds = getProjectIdsForPartner(
            partner,
            impactMapSourceProjects,
            partnerApplicationsData
          );

          return {
            id: partner.id,
            label: partner.name,
            projectIds,
          };
        });

      const assignedProjectIds = new Set(
        accounts.flatMap(account => account.projectIds)
      );
      const knownPartnerKeys = new Set(
        partnersData.flatMap(partner =>
          [partner.id, partner.ownerUserId, partner.contactEmail, partner.name]
            .map(value => String(value || '').trim().toLowerCase())
            .filter(Boolean)
        )
      );
      const approvedApplicationProjectIds = partnerApplicationsData
        .filter(application => application.status === 'Approved')
        .map(application => application.projectId)
        .filter(Boolean);
      const unassignedProjectIds = Array.from(
        new Set([
          ...projectsData
            .filter(project => {
              const partnerKey = String(project.partnerId || '').trim().toLowerCase();
              return Boolean(partnerKey) && !knownPartnerKeys.has(partnerKey);
            })
            .map(project => project.id),
          ...approvedApplicationProjectIds,
        ])
      ).filter(projectId => !assignedProjectIds.has(projectId));

      if (unassignedProjectIds.length > 0) {
        accounts.push({
          id: 'partner-unassigned',
          label: 'N/A Partner Account',
          projectIds: unassignedProjectIds,
        });
      }

      return accounts;
    },
    [impactMapSourceProjects, partnerApplicationsData, partnersData, projectsData]
  );

  const activeVolunteers = useMemo(
    () =>
      [...volunteersData]
        .sort((a, b) => (b.totalHoursContributed || 0) - (a.totalHoursContributed || 0))
        .slice(0, 3),
    [volunteersData]
  );

  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('All');

  const calMonthLabel = useMemo(
    () => calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [calendarMonth]
  );
  const calGridCells = useMemo(() => getMonthGridMondayFirst(calendarMonth), [calendarMonth]);

  // Google Calendar Integration states
  const [calendarSettings, setCalendarSettings] = useState({
    calendarId: 'en.philippines#holiday@group.v.calendar.google.com',
    apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || '',
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempCalendarId, setTempCalendarId] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');

  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [selectedDayEvents, setSelectedDayEvents] = useState<any[]>([]);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Load calendar settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const storedId = await AsyncStorage.getItem('gcal_id');
        const storedKey = await AsyncStorage.getItem('gcal_key');
        if (storedId || storedKey) {
          setCalendarSettings({
            calendarId: storedId || 'en.philippines#holiday@group.v.calendar.google.com',
          apiKey: storedKey || process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || '',
          });
        }
      } catch (err) {
        console.error('Failed to load Google Calendar settings:', err);
      }
    };
    loadSettings();
  }, []);

  // Fetch events when month, calendarId, or apiKey change
  useEffect(() => {
    let active = true;
    const fetchGCalEvents = async () => {
      setIsLoadingEvents(true);
      setCalendarError(null);
      
      const year = calendarMonth.getFullYear();
      const month = calendarMonth.getMonth();
      const timeMin = new Date(year, month - 1, 20).toISOString();
      const timeMax = new Date(year, month + 1, 10).toISOString();

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarSettings.calendarId)}/events?key=${calendarSettings.apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (active) {
          setGoogleEvents(data.items || []);
        }
      } catch (err: any) {
        console.warn('Google Calendar fetch error:', err);
        if (active) {
          setCalendarError(err.message || 'Failed to fetch events');
          setGoogleEvents([]);
        }
      } finally {
        if (active) {
          setIsLoadingEvents(false);
        }
      }
    };

    fetchGCalEvents();
    return () => {
      active = false;
    };
  }, [calendarMonth, calendarSettings]);

  // Auto-select today or first day with events on initial fetch
  useEffect(() => {
    if (googleEvents.length > 0) {
      const today = new Date();
      const todayEvents = getGoogleEventsForDay(today.getDate(), today.getMonth(), today.getFullYear(), googleEvents);
      const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      setSelectedDateKey(dateKey);
      setSelectedDayEvents(todayEvents);
    } else {
      setSelectedDateKey(null);
      setSelectedDayEvents([]);
    }
  }, [googleEvents]);

  const selectedDateLabel = useMemo(() => {
    if (!selectedDateKey) return 'Select a day';
    const parts = selectedDateKey.split('-');
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }, [selectedDateKey]);

  const handleSaveSettings = async () => {
    try {
      await AsyncStorage.setItem('gcal_id', tempCalendarId.trim());
      await AsyncStorage.setItem('gcal_key', tempApiKey.trim());
      setCalendarSettings({
        calendarId: tempCalendarId.trim(),
        apiKey: tempApiKey.trim(),
      });
      setIsSettingsOpen(false);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const handleOpenSettings = () => {
    setTempCalendarId(calendarSettings.calendarId);
    setTempApiKey(calendarSettings.apiKey);
    setIsSettingsOpen(true);
  };

  const handleOpenEventLink = (link?: string) => {
    if (link) {
      Linking.openURL(link).catch(err => {
        console.error('Failed to open link:', err);
      });
    }
  };

  const filteredCalendarProjects = useMemo(() => {
    if (calendarFilter === 'All') return projectsData;
    if (calendarFilter === 'Scheduled') {
      return projectsData.filter(p => {
        const s = getProjectDisplayStatus(p);
        return s === 'Planning' || s === 'In Progress';
      });
    }
    return projectsData.filter(p => !p.startDate || Number.isNaN(new Date(p.startDate).getTime()));
  }, [projectsData, calendarFilter]);

  const upcomingEventGroups = useMemo(
    () => getUpcomingEventGroups(projectsData),
    [projectsData]
  );

  const todayDate = useMemo(() => new Date(), []);

  const goToPrevMonth = useCallback(() => {
    setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);
  const goToNextMonth = useCallback(() => {
    setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);
  const goToToday = useCallback(() => {
    setCalendarMonth(new Date());
  }, []);

  const messagesCount = workflowStats.timeIns + workflowStats.pendingReports;

  // 1. Volunteer Engagement calculations for Donut
  const totalVolunteers = volunteersData.length || 1;
  const openVolunteersCount = volunteersData.filter(v => v.engagementStatus === 'Open to Volunteer').length;
  const busyVolunteersCount = volunteersData.filter(v => v.engagementStatus === 'Busy').length;
  const pendingVolunteersCount = volunteersData.filter(v => v.registrationStatus === 'Pending').length;
  
  // 2. Project Category count calculations
  const educationCount = projectsData.filter(p => p.category === 'Education').length;
  const livelihoodCount = projectsData.filter(p => p.category === 'Livelihood').length;
  const nutritionCount = projectsData.filter(p => p.category === 'Nutrition').length;
  const disasterCount = projectsData.filter(p => p.category === 'Disaster').length;
  const totalProjectsCategory = educationCount + livelihoodCount + nutritionCount + disasterCount || 1;

  // 3. Partner Sector count calculations
  const ngoCount = partnersData.filter(p => p.sectorType === 'NGO').length;
  const hospitalCount = partnersData.filter(p => p.sectorType === 'Hospital').length;
  const privateCount = partnersData.filter(p => p.sectorType === 'Private').length;
  const institutionCount = partnersData.filter(p => p.sectorType === 'Institution').length;
  const totalPartnersSector = ngoCount + hospitalCount + privateCount + institutionCount || 1;

  // 4. Project Status count calculations
  const planningCount = projectsData.filter(p => p.status === 'Planning').length;
  const inProgressCount = projectsData.filter(p => p.status === 'In Progress').length;
  const completedCount = projectsData.filter(p => p.status === 'Completed').length;
  const onHoldCount = projectsData.filter(p => p.status === 'On Hold').length;

  // 5. System Aligned Analytics Calculations:
  // a) Skills Contributed (exact counts of normalization/top skills)
  const dashboardSkillCounts = new Map<string, number>();
  volunteersData.forEach(volunteer => {
    (volunteer.skills || []).forEach(skill => {
      const norm = skill.trim().toLowerCase();
      if (norm) {
        dashboardSkillCounts.set(norm, (dashboardSkillCounts.get(norm) || 0) + 1);
      }
    });
  });
  const sortedDashboardSkills = Array.from(dashboardSkillCounts.entries()).sort((a, b) => b[1] - a[1]);
  const top4Skills = sortedDashboardSkills.slice(0, 4);
  const totalTop4SkillsCount = top4Skills.reduce((sum, [, val]) => sum + val, 0) || 1;

  // b) Cumulative Growth points (last 6 months)
  const dashboardNow = new Date();
  const volunteerGrowthPoints = Array.from({ length: 6 }).map((_, index) => {
    const d = new Date(dashboardNow.getFullYear(), dashboardNow.getMonth() - (5 - index), 1);
    const label = d.toLocaleDateString(undefined, { month: 'short' });
    const endOfMonthDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    
    const count = volunteersData.filter(v => {
      const cDate = v.createdAt ? new Date(v.createdAt) : null;
      return cDate && cDate < endOfMonthDate;
    }).length;
    
    return { label, count };
  });

  const maxGrowthVal = Math.max(...volunteerGrowthPoints.map(p => p.count), 1);
  const linePoints = volunteerGrowthPoints.map((point, index) => {
    const x = 5 + index * 10;
    const y = 45 - (point.count / maxGrowthVal) * 35;
    return { x, y };
  });
  const pathD = `M ${linePoints.map(p => `${p.x} ${p.y}`).join(' L ')}`;
  const areaD = `${pathD} L 55 55 L 5 55 Z`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {loadError ? (
        <View style={styles.errorBanner}>
          <MaterialIcons name="error-outline" size={20} color="#8f2222" />
          <Text style={styles.errorBannerText}>{loadError}</Text>
          <TouchableOpacity onPress={loadDashboardData}>
            <Text style={styles.errorBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Welcome Header */}
      <View style={styles.welcomeRow}>
        <View style={styles.welcomeLeft}>
          <Text style={styles.welcomeTitle}>Welcome back, Admin! 👋</Text>
          <Text style={styles.welcomeSubtitle}>Here's what's happening with your community impact today.</Text>
        </View>
        <TouchableOpacity style={styles.addProjectBtn} onPress={() => openProjects()} activeOpacity={0.85}>
          <MaterialIcons name="add" size={18} color="#ffffff" />
          <Text style={styles.addProjectBtnText}>Add Project</Text>
        </TouchableOpacity>
      </View>


      {/* Calendar Row */}
      <View style={[styles.middleGrid, !isDesktop && styles.stackGrid]}>
        {isSettingsOpen ? (
          <View style={styles.calendarCardContainer}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardTitleRow}>
                <View style={styles.cardTitleIcon}>
                  <MaterialIcons name="settings" size={20} color="#16a34a" />
                </View>
                <View>
                  <Text style={styles.cardTitle}>Calendar Settings</Text>
                  <Text style={styles.cardSubtitleText}>Configure Google Calendar API.</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setIsSettingsOpen(false)} style={styles.calNavArrow}>
                <MaterialIcons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>

            <View style={styles.settingsForm}>
              <Text style={styles.settingsLabel}>Google Calendar ID</Text>
              <TextInput
                style={styles.settingsInput}
                value={tempCalendarId}
                onChangeText={setTempCalendarId}
                placeholder="e.g. primary or holiday calendar email"
                autoCapitalize="none"
              />
              
              <Text style={styles.settingsLabel}>Google API Key (Optional)</Text>
              <TextInput
                style={styles.settingsInput}
                value={tempApiKey}
                onChangeText={setTempApiKey}
                placeholder="Defaults to system API Key"
                autoCapitalize="none"
                secureTextEntry
              />
              
              <View style={styles.settingsActions}>
                <TouchableOpacity
                  style={[styles.settingsButton, styles.settingsButtonCancel]}
                  onPress={() => setIsSettingsOpen(false)}
                >
                  <Text style={styles.settingsButtonTextCancel}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.settingsButton, styles.settingsButtonSave]}
                  onPress={handleSaveSettings}
                >
                  <Text style={styles.settingsButtonTextSave}>Save Configuration</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.calendarCardContainer}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardTitleRow}>
                <View style={styles.cardTitleIcon}>
                  <MaterialIcons name="event" size={20} color="#16a34a" />
                </View>
                <View>
                  <Text style={styles.cardTitle}>Google Calendar</Text>
                  <Text style={styles.cardSubtitleText}>Synced events and schedule.</Text>
                </View>
              </View>
              <View style={styles.calNavButtons}>
                {isLoadingEvents && (
                  <ActivityIndicator size="small" color="#16a34a" style={{ marginRight: 4 }} />
                )}
                <TouchableOpacity onPress={handleOpenSettings} style={[styles.calNavArrow, { marginRight: 4 }]} activeOpacity={0.7}>
                  <MaterialIcons name="settings" size={16} color="#475569" />
                </TouchableOpacity>
                <TouchableOpacity onPress={goToPrevMonth} style={styles.calNavArrow} activeOpacity={0.7}>
                  <MaterialIcons name="chevron-left" size={18} color="#475569" />
                </TouchableOpacity>
                <Text style={styles.calMonthYearLabel}>{calMonthLabel}</Text>
                <TouchableOpacity onPress={goToNextMonth} style={styles.calNavArrow} activeOpacity={0.7}>
                  <MaterialIcons name="chevron-right" size={18} color="#475569" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Calendar Error/Warning */}
            {calendarError ? (
              <View style={styles.calendarErrorBanner}>
                <MaterialIcons name="warning" size={14} color="#d97706" style={{ marginTop: 1 }} />
                <Text style={styles.calendarErrorText} numberOfLines={1}>
                  {calendarError}
                </Text>
              </View>
            ) : null}

            {/* Week Header */}
            <View style={styles.calWeekRow}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <View key={d} style={styles.calWeekCell}>
                  <Text style={styles.calWeekText}>{d}</Text>
                </View>
              ))}
            </View>

            {/* Day Grid */}
            <View style={styles.calGridBody}>
              {Array.from({ length: 6 }).map((_, rowIdx) => (
                <View key={rowIdx} style={styles.calDayRow}>
                  {calGridCells.slice(rowIdx * 7, rowIdx * 7 + 7).map((cell, colIdx) => {
                    const cellEvents = getGoogleEventsForDay(cell.day, cell.month, cell.year, googleEvents);
                    const isToday =
                      cell.isCurrentMonth &&
                      cell.day === todayDate.getDate() &&
                      cell.month === todayDate.getMonth() &&
                      cell.year === todayDate.getFullYear();
                    const dateKey = `${cell.year}-${String(cell.month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
                    const isSelected = selectedDateKey === dateKey;
                    const hasEvents = cellEvents.length > 0;

                    return (
                      <TouchableOpacity
                        key={`${rowIdx}-${colIdx}`}
                        style={[
                          styles.calDayCell,
                          !cell.isCurrentMonth && styles.calDayCellMuted,
                          isToday && styles.calDayCellToday,
                          isSelected && { borderColor: '#10b981', borderWidth: 2 },
                        ]}
                        onPress={() => {
                          setSelectedDateKey(dateKey);
                          setSelectedDayEvents(cellEvents);
                        }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            styles.calDayNum,
                            !cell.isCurrentMonth && styles.calDayNumMuted,
                            isToday && styles.calDayNumToday,
                            isSelected && { color: '#10b981', fontWeight: '800' },
                          ]}
                        >
                          {cell.day}
                        </Text>
                        {hasEvents ? (
                          <View style={styles.calIndicatorRow}>
                            <View style={[styles.calIndicatorDot, { backgroundColor: '#10b981' }]} />
                            {cellEvents.length > 1 && (
                              <Text style={[styles.calIndicatorCount, { color: '#10b981' }]}>{cellEvents.length}</Text>
                            )}
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Selected Day Events Details Card */}
        <View style={styles.gcalDetailsCard}>
          <View style={styles.gcalDetailsTitleRow}>
            <MaterialIcons name="event-note" size={20} color="#10b981" />
            <Text style={styles.gcalDetailsTitle}>
              Events for {selectedDateLabel}
            </Text>
          </View>
          <ScrollView style={styles.gcalDetailsScroll} showsVerticalScrollIndicator={false}>
            {selectedDayEvents.length > 0 ? (
              selectedDayEvents.map((event, idx) => (
                <View key={event.id || idx} style={styles.gcalEventItem}>
                  <View style={styles.gcalEventHeader}>
                    <Text style={styles.gcalEventTitle}>{event.summary || 'No Title'}</Text>
                    <Text style={styles.gcalEventTimeTag}>{formatGoogleEventTime(event)}</Text>
                  </View>
                  {event.description ? (
                    <Text style={styles.gcalEventDescription}>{event.description}</Text>
                  ) : null}
                  {event.location ? (
                    <View style={styles.gcalEventLocationRow}>
                      <MaterialIcons name="place" size={12} color="#64748b" />
                      <Text style={styles.gcalEventLocationText}>{event.location}</Text>
                    </View>
                  ) : null}
                  {event.htmlLink ? (
                    <TouchableOpacity
                      style={styles.gcalViewButton}
                      onPress={() => handleOpenEventLink(event.htmlLink)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="open-in-new" size={12} color="#475569" />
                      <Text style={styles.gcalViewButtonText}>View in Google Calendar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 40 }}>
                <MaterialIcons name="event-busy" size={32} color="#94a3b8" />
                <Text style={[styles.emptyCardText, { marginTop: 10 }]}>No events scheduled</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>

      {/* Row 3: Upcoming Events, Recent Activity, Volunteer Overview */}
      <View style={[styles.row3Grid, !isDesktop && styles.stackGrid]}>
        {/* Upcoming Events */}
        <View style={styles.row3Card}>
          <View style={styles.row3Header}>
            <Text style={styles.row3Title}>Upcoming Events</Text>
            <MaterialIcons name="info-outline" size={16} color="#64748b" />
          </View>
          <ScrollView style={styles.row3Scroll} showsVerticalScrollIndicator={false}>
            {upcomingEventGroups.length > 0 ? (
              upcomingEventGroups.flatMap(g => g.projects).slice(0, 4).map((project, idx) => {
                const partnerName = partnersData.find(p => p.id === project.partnerId)?.name || 'NVC Partner';
                return (
                  <View key={project.id + idx} style={styles.upcomingEventItem}>
                    <View style={styles.timelineCol}>
                      <View style={styles.timelineDot} />
                      {idx < 3 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.upcomingEventContent}>
                      <Text style={styles.upcomingEventTitle} numberOfLines={1}>{project.title}</Text>
                      <Text style={styles.upcomingEventMeta} numberOfLines={1}>
                        {formatDateRangeDDMM(project.startDate, project.endDate)} • {partnerName}
                      </Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyCardText}>No upcoming events</Text>
            )}
          </ScrollView>
        </View>

        {/* Recent Activity */}
        <View style={styles.row3Card}>
          <View style={styles.row3Header}>
            <Text style={styles.row3Title}>Recent Activity</Text>
            <MaterialIcons name="info-outline" size={16} color="#64748b" />
          </View>
          <ScrollView style={styles.row3Scroll} showsVerticalScrollIndicator={false}>
            {recentUpdates.length > 0 ? (
              recentUpdates.slice(0, 4).map((update, index) => (
                <View key={update.id || index} style={styles.activityItem}>
                  <View style={styles.activityIcon}>
                    <MaterialIcons name="update" size={16} color="#64748b" />
                  </View>
                  <View style={styles.activityCopy}>
                    <Text style={styles.activityText} numberOfLines={2}>
                      <Text style={styles.activityProject}>{update.projectName || 'Project'}: </Text>
                      {update.description || 'Status updated'}
                    </Text>
                    <Text style={styles.activityTime}>{formatShortDate(update.updatedAt)}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.emptyCardText}>No recent activity</Text>
            )}
          </ScrollView>
        </View>

        {/* Volunteer Overview (Donut Chart) */}
        <View style={styles.row3Card}>
          <View style={styles.row3Header}>
            <Text style={styles.row3Title}>Volunteer Overview</Text>
            <MaterialIcons name="info-outline" size={16} color="#64748b" />
          </View>
          <View style={styles.donutContainer}>
            <View style={styles.donutChartWrapper}>
              {(() => {
                const radius = 35;
                const strokeWidth = 10;
                const circumference = 2 * Math.PI * radius;
                const total = totalVolunteers;
                const openPct = openVolunteersCount / total;
                const busyPct = busyVolunteersCount / total;
                const pendingPct = pendingVolunteersCount / total;
                
                const openDash = openPct * circumference;
                const busyDash = busyPct * circumference;
                const pendingDash = pendingPct * circumference;
                return (
                  <Svg width={110} height={110} viewBox="0 0 100 100">
                    <G transform="rotate(-90 50 50)">
                      <Circle cx="50" cy="50" r={radius} stroke="#f1f5f9" strokeWidth={strokeWidth} fill="transparent" />
                      {pendingDash > 0 && (
                        <Circle
                          cx="50"
                          cy="50"
                          r={radius}
                          stroke="#94a3b8"
                          strokeWidth={strokeWidth}
                          fill="transparent"
                          strokeDasharray={`${pendingDash} ${circumference}`}
                          strokeDashoffset={0}
                        />
                      )}
                      {busyDash > 0 && (
                        <Circle
                          cx="50"
                          cy="50"
                          r={radius}
                          stroke="#fb923c"
                          strokeWidth={strokeWidth}
                          fill="transparent"
                          strokeDasharray={`${busyDash} ${circumference}`}
                          strokeDashoffset={-pendingDash}
                        />
                      )}
                      {openDash > 0 && (
                        <Circle
                          cx="50"
                          cy="50"
                          r={radius}
                          stroke="#10b981"
                          strokeWidth={strokeWidth}
                          fill="transparent"
                          strokeDasharray={`${openDash} ${circumference}`}
                          strokeDashoffset={-(pendingDash + busyDash)}
                        />
                      )}
                    </G>
                  </Svg>
                );
              })()}
              <View style={styles.donutCenterLabel}>
                <Text style={styles.donutCenterValue}>{volunteersData.length}</Text>
                <Text style={styles.donutCenterSub}>Total</Text>
              </View>
            </View>
            <View style={styles.donutLegend}>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                <Text style={styles.legendLabel}>Open ({openVolunteersCount})</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#fb923c' }]} />
                <Text style={styles.legendLabel}>Busy ({busyVolunteersCount})</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#94a3b8' }]} />
                <Text style={styles.legendLabel}>Pending ({pendingVolunteersCount})</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Row 4: Analytics Overview and News & Announcements */}
      <View style={[styles.row4Grid, !isDesktop && styles.stackGrid]}>
        {/* Analytics Overview */}
        <View style={styles.analyticsCard}>
          <View style={styles.row3Header}>
            <Text style={styles.row3Title}>Analytics Overview</Text>
            <MaterialIcons name="info-outline" size={16} color="#64748b" />
          </View>
          <View style={styles.analyticsChartsRow}>
            {/* Chart 1: Skills Contributed Donut */}
            <View style={styles.miniChartItem}>
              {(() => {
                const radius = 22;
                const strokeWidth = 6;
                const circumference = 2 * Math.PI * radius;
                const total = totalTop4SkillsCount;
                const s1Pct = (top4Skills[0]?.[1] || 0) / total;
                const s2Pct = (top4Skills[1]?.[1] || 0) / total;
                const s3Pct = (top4Skills[2]?.[1] || 0) / total;
                const s4Pct = (top4Skills[3]?.[1] || 0) / total;

                const s1Dash = s1Pct * circumference;
                const s2Dash = s2Pct * circumference;
                const s3Dash = s3Pct * circumference;
                const s4Dash = s4Pct * circumference;

                return (
                  <Svg width={66} height={66} viewBox="0 0 60 60">
                    <G transform="rotate(-90 30 30)">
                      <Circle cx="30" cy="30" r={radius} stroke="#f1f5f9" strokeWidth={strokeWidth} fill="transparent" />
                      {s4Dash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#8db653" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${s4Dash} ${circumference}`} strokeDashoffset={0} />
                      )}
                      {s3Dash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#6f9a38" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${s3Dash} ${circumference}`} strokeDashoffset={-s4Dash} />
                      )}
                      {s2Dash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#477f39" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${s2Dash} ${circumference}`} strokeDashoffset={-(s4Dash + s3Dash)} />
                      )}
                      {s1Dash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#243f1f" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${s1Dash} ${circumference}`} strokeDashoffset={-(s4Dash + s3Dash + s2Dash)} />
                      )}
                    </G>
                  </Svg>
                );
              })()}
              <Text style={styles.miniChartLabel}>Skills Contributed</Text>
            </View>

            {/* Chart 2: Volunteers Growth Line */}
            <View style={styles.miniChartItem}>
              <Svg width={66} height={66} viewBox="0 0 60 60">
                <Path d={pathD} stroke="#10b981" strokeWidth="2.5" fill="none" />
                <Path d={areaD} fill="#10b98115" />
                <Circle cx={linePoints[5].x} cy={linePoints[5].y} r="3" fill="#10b981" />
              </Svg>
              <Text style={styles.miniChartLabel}>Volunteers Growth</Text>
            </View>

            {/* Chart 3: Partner Sectors Donut */}
            <View style={styles.miniChartItem}>
              {(() => {
                const radius = 22;
                const strokeWidth = 6;
                const circumference = 2 * Math.PI * radius;
                const total = totalPartnersSector;
                const ngoPct = ngoCount / total;
                const hospPct = hospitalCount / total;
                const privPct = privateCount / total;
                const instPct = institutionCount / total;
                
                const ngoDash = ngoPct * circumference;
                const hospDash = hospPct * circumference;
                const privDash = privPct * circumference;
                const instDash = instPct * circumference;
                return (
                  <Svg width={66} height={66} viewBox="0 0 60 60">
                    <G transform="rotate(-90 30 30)">
                      <Circle cx="30" cy="30" r={radius} stroke="#f1f5f9" strokeWidth={strokeWidth} fill="transparent" />
                      {instDash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#94a3b8" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${instDash} ${circumference}`} strokeDashoffset={0} />
                      )}
                      {privDash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#06b6d4" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${privDash} ${circumference}`} strokeDashoffset={-instDash} />
                      )}
                      {hospDash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#ec4899" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${hospDash} ${circumference}`} strokeDashoffset={-(instDash + privDash)} />
                      )}
                      {ngoDash > 0 && (
                        <Circle cx="30" cy="30" r={radius} stroke="#8b5cf6" strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${ngoDash} ${circumference}`} strokeDashoffset={-(instDash + privDash + hospDash)} />
                      )}
                    </G>
                  </Svg>
                );
              })()}
              <Text style={styles.miniChartLabel}>Sectors</Text>
            </View>

            {/* Chart 4: Project Status Bar Chart */}
            <View style={styles.miniChartItem}>
              {(() => {
                const maxVal = Math.max(planningCount, inProgressCount, completedCount, onHoldCount, 1);
                const h1 = Math.max(8, (planningCount / maxVal) * 40);
                const h2 = Math.max(8, (inProgressCount / maxVal) * 40);
                const h3 = Math.max(8, (completedCount / maxVal) * 40);
                const h4 = Math.max(8, (onHoldCount / maxVal) * 40);
                return (
                  <Svg width={66} height={66} viewBox="0 0 60 60">
                    <Rect x="8" y={50 - h1} width="7" height={h1} rx="1.5" fill="#3b82f6" />
                    <Rect x="20" y={50 - h2} width="7" height={h2} rx="1.5" fill="#fb923c" />
                    <Rect x="32" y={50 - h3} width="7" height={h3} rx="1.5" fill="#10b981" />
                    <Rect x="44" y={50 - h4} width="7" height={h4} rx="1.5" fill="#94a3b8" />
                    <Line x1="4" y1="50" x2="56" y2="50" stroke="#cbd5e1" strokeWidth="1" />
                  </Svg>
                );
              })()}
              <Text style={styles.miniChartLabel}>Project Status</Text>
              </View>
            </View>
          </View>
        </View>

      {/* Footer */}
      <View style={styles.footerContainer}>
        <Text style={styles.footerText}>© 2026 NVC. All rights reserved.    NVC v2.0    Privacy Policy    Terms of Service</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  welcomeLeft: {
    flex: 1,
    marginRight: 16,
  },
  welcomeTitle: {
    fontFamily: 'DM Sans', fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  addProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16a34a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  addProjectBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 20,
  },
  metricCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricCardBody: {
    flex: 1,
  },
  metricCardValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  metricCardLabel: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  middleGrid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  stackGrid: {
    flexDirection: 'column',
  },
  mapCard: {
    flex: 1.5,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 20,
    minHeight: 400,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitleIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardSubtitleText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  textLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardLinkText: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '700',
  },
  mapFallback: {
    flex: 1,
    minHeight: 300,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f8fafc',
  },
  mapFallbackText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
  },
  calendarCardContainer: {
    flex: 1.2,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 20,
    minHeight: 400,
  },
  gcalDetailsCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 20,
    minHeight: 400,
  },
  gcalDetailsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
    marginBottom: 12,
  },
  gcalDetailsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  gcalDetailsScroll: {
    flex: 1,
  },
  gcalEventItem: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
    marginBottom: 10,
  },
  gcalEventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  gcalEventTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    flex: 1,
  },
  gcalEventTimeTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10b981',
    backgroundColor: '#e6fbf3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gcalEventDescription: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 6,
    lineHeight: 15,
  },
  gcalEventLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  gcalEventLocationText: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
  },
  gcalViewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingVertical: 6,
    marginTop: 8,
  },
  gcalViewButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  calendarErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  calendarErrorText: {
    fontSize: 11,
    color: '#b45309',
    fontWeight: '600',
    flex: 1,
  },
  settingsForm: {
    flex: 1,
    marginTop: 10,
    gap: 12,
  },
  settingsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  settingsInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  settingsActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  settingsButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsButtonCancel: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  settingsButtonSave: {
    backgroundColor: '#16a34a',
  },
  settingsButtonTextCancel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  settingsButtonTextSave: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  calNavButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calNavArrow: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calMonthYearLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    minWidth: 90,
    textAlign: 'center',
  },
  calWeekRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 6,
    marginBottom: 8,
  },
  calWeekCell: {
    flex: 1,
    alignItems: 'center',
  },
  calWeekText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  calGridBody: {
    flex: 1,
    gap: 4,
  },
  calDayRow: {
    flexDirection: 'row',
    flex: 1,
    gap: 4,
  },
  calDayCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: '#ffffff',
  },
  calDayCellMuted: {
    backgroundColor: '#f8fafc',
  },
  calDayCellToday: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  calDayNum: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  calDayNumMuted: {
    color: '#cbd5e1',
  },
  calDayNumToday: {
    color: '#16a34a',
    fontWeight: '800',
  },
  calIndicatorRow: {
    position: 'absolute',
    bottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  calIndicatorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#16a34a',
  },
  calIndicatorCount: {
    fontSize: 8,
    fontWeight: '700',
    color: '#16a34a',
  },
  row3Grid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  row3Card: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 20,
    height: 280,
  },
  row3Header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  row3Title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  row3Scroll: {
    flex: 1,
  },
  upcomingEventItem: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  timelineCol: {
    alignItems: 'center',
    width: 10,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16a34a',
    marginTop: 4,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: '#cbd5e1',
    marginTop: 4,
    marginBottom: -12,
  },
  upcomingEventContent: {
    flex: 1,
  },
  upcomingEventTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  upcomingEventMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  activityItem: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  activityIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityCopy: {
    flex: 1,
  },
  activityText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 16,
  },
  activityProject: {
    fontWeight: '700',
    color: '#0f172a',
  },
  activityTime: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
  },
  donutContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  donutChartWrapper: {
    position: 'relative',
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenterLabel: {
    position: 'absolute',
    alignItems: 'center',
  },
  donutCenterValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  donutCenterSub: {
    fontSize: 10,
    color: '#64748b',
  },
  donutLegend: {
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  row4Grid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  analyticsCard: {
    flex: 1.5,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 20,
    height: 180,
  },
  analyticsChartsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    flex: 1,
  },
  miniChartItem: {
    alignItems: 'center',
    gap: 6,
  },
  miniChartLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  errorBanner: {
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorBannerText: {
    flex: 1,
    color: '#991b1b',
    fontSize: 12,
    lineHeight: 18,
  },
  errorBannerAction: {
    color: '#991b1b',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCardText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 40,
    fontWeight: '600',
  },
  footerContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginTop: 12,
  },
  footerText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
});












