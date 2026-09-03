import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Image,
  Pressable,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import Svg, { Circle, Path, G } from 'react-native-svg';

function EmptyTasksIllustration() {
  return (
    <Svg width={180} height={140} viewBox="0 0 180 140" fill="none">
      <Circle cx={90} cy={75} r={40} fill="#E4EEE7" opacity={0.5} />
      <G opacity={0.65}>
        <Path d="M45,82 C48,70 58,68 62,65 C63,71 58,82 45,82 Z" fill="#6B8F71" />
        <Path d="M52,65 C54,55 62,53 66,51 C67,56 63,65 52,65 Z" fill="#6B8F71" />
        <Path d="M58,95 C62,88 70,88 74,86 C74,91 69,96 58,95 Z" fill="#6B8F71" />
        <Path d="M38,78 L65,85" stroke="#6B8F71" strokeWidth={1.5} strokeLinecap="round" />
      </G>
      <G opacity={0.65}>
        <Path d="M135,82 C132,70 122,68 118,65 C117,71 122,82 135,82 Z" fill="#6B8F71" />
        <Path d="M128,65 C126,55 118,53 114,51 C113,56 117,65 128,65 Z" fill="#6B8F71" />
        <Path d="M122,95 C118,88 110,88 106,86 C106,91 111,96 122,95 Z" fill="#6B8F71" />
        <Path d="M142,78 L115,85" stroke="#6B8F71" strokeWidth={1.5} strokeLinecap="round" />
      </G>
      <Path
        d="M72,40 L108,40 C112,40 115,43 115,47 L115,108 C115,112 112,115 108,115 L72,115 C68,115 65,112 65,108 L65,47 C65,43 68,40 72,40 Z"
        fill="#ffffff"
        stroke="#6B8F71"
        strokeWidth={3}
      />
      <Path
        d="M82,40 L82,34 C82,31 84,29 87,29 L93,29 C96,29 98,31 98,34 L98,40 Z"
        fill="#6B8F71"
      />
      <Circle cx={90} cy={77} r={18} fill="#E4EEE7" />
      <Path
        d="M84,77 L88,81 L96,73"
        stroke="#3F7A54"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M75,100 L95,100" stroke="#E4EEE7" strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M75,106 L87,106" stroke="#E4EEE7" strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}
import {
  getAllVolunteers,
  getAllProjects,
  getAllVolunteerTimeLogs,
  getVolunteerByUserId,
  getVolunteerProjectJoinRecords,
  getVolunteerTimeLogs,
  subscribeToStorageChanges,
  clearStorageCache,
  saveEvent,
  startVolunteerTimeLog,
  notifyVolunteerAboutTaskUnassignment,
  notifyVolunteerAboutTaskUpdate,
  setVolunteerAttendanceChecked,
} from '../models/storage';
import {
  Project,
  ProjectInternalTask,
  Volunteer,
  VolunteerProjectJoinRecord,
  VolunteerTimeLog,
} from '../models/types';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { isImageMediaUri, pickImageFromDevice, pickAttendancePhotoFromDevice } from '../utils/media';

type AssignedTask = ProjectInternalTask & {
  projectId: string;
  projectTitle: string;
  projectStartDate: string;
  projectEndDate: string;
  statusTrackingNote: string;
};
type AssignedTaskGroup = {
  projectId: string;
  projectTitle: string;
  tasks: AssignedTask[];
};
type FieldOfficerFilter = 'All' | 'Active' | 'Upcoming' | 'Completed';
type TaskScreenTab = 'My Tasks' | 'Manage Assignments';
type TaskSectionId = 'assigned-events' | 'field-officer-events';
type TaskSectionItemKind = 'task-group' | 'field-officer-event';

type TaskSectionPreviewItem = {
  id: string;
  kind: TaskSectionItemKind;
  projectId: string;
  title: string;
  description: string;
  badgeLabel?: string;
  badgeColor?: string;
};

type TaskSectionPreview = {
  id: TaskSectionId;
  title: string;
  eyebrow?: string;
  subtitle: string;
  items: TaskSectionPreviewItem[];
  emptyTitle: string;
  emptyText: string;
};

type TaskEventAttendanceState = {
  todayLog: VolunteerTimeLog | null;
  latestLog: VolunteerTimeLog | null;
  canConfirmAttendance: boolean;
  eventHasNotStarted: boolean;
  eventHasEnded: boolean;
  hasConfirmedToday: boolean;
  helperText: string;
};

const FILTER_OPTION_LABELS: Record<'All' | 'Assigned' | 'In Progress' | 'Completed', string> = {
  All: 'All',
  Assigned: 'Assigned',
  'In Progress': 'In Progress',
  Completed: 'Completed',
};

function formatEventDateLabel(startDate?: string, endDate?: string): string {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  if (!start || Number.isNaN(start.getTime())) {
    return 'Schedule to be announced';
  }

  const startLabel = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (!end || Number.isNaN(end.getTime())) {
    return startLabel;
  }

  const endLabel = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function getLocalDateKey(value?: string, now: Date = new Date()): string {
  const date = value ? new Date(value) : now;
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function getDateRangeKeys(startDate?: string, endDate?: string): string[] {
  if (!startDate) {
    return [];
  }

  const start = new Date(startDate);
  const end = new Date(endDate || startDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }

  const current = new Date(start);
  const finalDate = new Date(end);
  current.setHours(0, 0, 0, 0);
  finalDate.setHours(0, 0, 0, 0);

  const keys: string[] = [];
  let guard = 0;
  while (current <= finalDate && guard < 90) {
    keys.push(getLocalDateKey(current.toISOString()));
    current.setDate(current.getDate() + 1);
    guard += 1;
  }

  return keys;
}

function hasEventStartedForToday(startValue?: string, now: Date = new Date()): boolean {
  if (!startValue) {
    return true;
  }

  const startDate = new Date(startValue);
  if (Number.isNaN(startDate.getTime())) {
    return true;
  }

  const attendanceStart = new Date(startDate);
  attendanceStart.setHours(9, 0, 0, 0);
  return now >= attendanceStart;
}

function hasEventEndedForToday(endValue?: string, now: Date = new Date()): boolean {
  if (!endValue) {
    return false;
  }

  const endDate = new Date(endValue);
  if (Number.isNaN(endDate.getTime())) {
    return false;
  }

  const endOfDay = new Date(endDate);
  endOfDay.setHours(23, 59, 59, 999);
  return now > endOfDay;
}

function getFieldOfficerEventBucket(project: Project): Exclude<FieldOfficerFilter, 'All'> {
  switch (getProjectDisplayStatus(project)) {
    case 'In Progress':
    case 'On Hold':
      return 'Active';
    case 'Completed':
    case 'Cancelled':
      return 'Completed';
    default:
      return 'Upcoming';
  }
}

function getCompletedLogMinutes(log: VolunteerTimeLog): number {
  if (!log.timeOut) {
    return 0;
  }

  const start = new Date(log.timeIn).getTime();
  const end = new Date(log.timeOut).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }

  return Math.round((end - start) / (1000 * 60));
}

function formatVolunteerTime(totalMinutes: number): string {
  if (totalMinutes <= 0) {
    return '0h';
  }

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = totalMinutes / 60;
  const roundedHours = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${roundedHours}h`;
}

function getTaskAssignedVolunteerIds(task: ProjectInternalTask): string[] {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(task.assignedVolunteerIds) ? task.assignedVolunteerIds : []),
        task.assignedVolunteerId,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function getTaskAssignedVolunteerNames(task: ProjectInternalTask): string[] {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(task.assignedVolunteerNames) ? task.assignedVolunteerNames : []),
        task.assignedVolunteerName,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function getTaskVolunteerLimit(task: Pick<ProjectInternalTask, 'volunteersNeeded'>): number {
  const parsedLimit = Number(task.volunteersNeeded);
  return Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 1;
}

function isVolunteerAssignedToTask(
  task: ProjectInternalTask,
  volunteerId?: string | null,
  userId?: string | null
): boolean {
  const assignedIds = getTaskAssignedVolunteerIds(task);
  if (volunteerId && assignedIds.includes(volunteerId)) {
    return true;
  }
  if (userId && assignedIds.includes(userId)) {
    return true;
  }
  return false;
}

function getTrackedTaskStatus(
  task: ProjectInternalTask,
  project: Project,
  joinRecord: VolunteerProjectJoinRecord | undefined,
  timeLogs: VolunteerTimeLog[]
): Pick<AssignedTask, 'status' | 'updatedAt' | 'statusTrackingNote'> {
  if (getTaskAssignedVolunteerIds(task).length === 0) {
    return {
      status: 'Unassigned',
      updatedAt: task.updatedAt,
      statusTrackingNote: 'This task is waiting for an admin or field officer assignment.',
    };
  }

  if (joinRecord?.participationStatus === 'Completed') {
    return {
      status: 'Completed',
      updatedAt: joinRecord.completedAt || task.updatedAt,
      statusTrackingNote: 'Completed automatically from your event participation record.',
    };
  }

  const todayKey = getLocalDateKey();
  const activeLog = timeLogs.find(
    log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === todayKey
  );
  if (activeLog) {
    return {
      status: 'In Progress',
      updatedAt: activeLog.attendanceConfirmedAt || activeLog.timeIn,
      statusTrackingNote: 'In progress after your attendance has been confirmed for today.',
    };
  }

  const latestCompletedLog = timeLogs
    .sort(
      (left, right) =>
        new Date(right.attendanceConfirmedAt || right.timeOut || right.timeIn).getTime() -
        new Date(left.attendanceConfirmedAt || left.timeOut || left.timeIn).getTime()
    )[0];
  if (latestCompletedLog) {
    const projectEnded = hasEventEndedForToday(project.endDate || project.startDate);
    if (!projectEnded && !['Completed', 'Cancelled'].includes(getProjectDisplayStatus(project))) {
      return {
        status: 'Assigned',
        updatedAt: latestCompletedLog.attendanceConfirmedAt || latestCompletedLog.timeIn,
        statusTrackingNote: 'Attendance is already confirmed for the latest event day. It will refresh on the next event day.',
      };
    }

    return {
      status: 'Completed',
      updatedAt: latestCompletedLog.attendanceConfirmedAt || latestCompletedLog.timeIn,
      statusTrackingNote: 'Completed automatically after your latest attendance confirmation.',
    };
  }

  if (getProjectDisplayStatus(project) === 'Completed' && task.title !== 'Volunteer Orientation Desk') {
    return {
      status: 'Completed',
      updatedAt: project.updatedAt,
      statusTrackingNote: 'Completed automatically because this event is already marked completed.',
    };
  }

  return {
    status: 'Assigned',
    updatedAt: task.updatedAt,
    statusTrackingNote: 'Assigned automatically when an admin or field officer gives you this task.',
  };
}

function getTaskEventAttendanceState(
  project: Project,
  isAssigned: boolean,
  timeLogs: VolunteerTimeLog[]
): TaskEventAttendanceState {
  const sortedLogs = [...timeLogs].sort(
    (left, right) =>
      new Date(right.timeOut || right.timeIn).getTime() -
      new Date(left.timeOut || left.timeIn).getTime()
  );
  const todayKey = getLocalDateKey();
  const todayLog =
    sortedLogs.find(log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === todayKey) || null;
  const latestLog = sortedLogs[0] || null;
  const hasConfirmedToday = sortedLogs.some(
    log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === todayKey
  );
  const eventHasNotStarted = !hasEventStartedForToday(project.startDate);
  const lifecycleStatus = getProjectDisplayStatus(project);
  const eventHasEnded =
    hasEventEndedForToday(project.endDate || project.startDate) ||
    lifecycleStatus === 'Completed' ||
    lifecycleStatus === 'Cancelled';
  const canConfirmAttendance =
    isAssigned && !hasConfirmedToday && !eventHasNotStarted && !eventHasEnded;

  let helperText = 'Attendance confirmation is ready for today.';
  if (!isAssigned) {
    helperText = 'You need an assigned task before attendance opens for this event.';
  } else if (eventHasNotStarted) {
    helperText = 'Attendance confirmation unlocks at 9:00 AM on the event start date.';
  } else if (eventHasEnded) {
    helperText = 'Attendance is closed because the event timeline already ended.';
  } else if (hasConfirmedToday) {
    helperText = 'Attendance is already confirmed for today. It will reset on the next event day.';
  }

  return {
    todayLog,
    latestLog,
    canConfirmAttendance,
    eventHasNotStarted,
    eventHasEnded,
    hasConfirmedToday,
    helperText,
  };
}

function collectAssignedTasks(
  projects: Project[],
  volunteerProfile: Volunteer | null,
  joinRecordByProjectId: Map<string, VolunteerProjectJoinRecord>,
  volunteerTimeLogs: VolunteerTimeLog[]
): AssignedTask[] {
  if (!volunteerProfile) {
    return [];
  }

  const assignedTasks: AssignedTask[] = [];

  projects.forEach(project => {
    (project.internalTasks || []).forEach(task => {
      if (isVolunteerAssignedToTask(task, volunteerProfile.id, volunteerProfile.userId)) {
        const trackedStatus = getTrackedTaskStatus(
          task,
          project,
          joinRecordByProjectId.get(project.id),
          volunteerTimeLogs.filter(log => log.projectId === project.id)
        );
        assignedTasks.push({
          ...task,
          ...trackedStatus,
          projectId: project.id,
          projectTitle: project.title,
          projectStartDate: project.startDate,
          projectEndDate: project.endDate,
        });
      }
    });
  });

  return assignedTasks.sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

// Displays volunteer's assigned tasks from projects.
export default function VolunteerTasksScreen({ navigation }: any) {
  const { user } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allVolunteers, setAllVolunteers] = useState<Volunteer[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [allVolunteerTimeLogs, setAllVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<AssignedTask | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedTaskGroupProjectId, setSelectedTaskGroupProjectId] = useState<string | null>(null);
  const [showTaskGroupDetails, setShowTaskGroupDetails] = useState(false);
  const [selectedManagedEventId, setSelectedManagedEventId] = useState<string | null>(null);
  const [showFieldOfficerBoard, setShowFieldOfficerBoard] = useState(false);
  const [showManagedAttendanceDateDropdown, setShowManagedAttendanceDateDropdown] = useState(false);
  const [selectedManagedAttendanceDateKey, setSelectedManagedAttendanceDateKey] = useState<string | null>(null);
  const [expandedAttendancePhotos, setExpandedAttendancePhotos] = useState<Set<string>>(new Set());
  const [expandedManagedTaskId, setExpandedManagedTaskId] = useState<string | null>(null);
  const [showManagedTaskAssignments, setShowManagedTaskAssignments] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'All' | 'Assigned' | 'In Progress' | 'Completed'>('All');
  const [fieldOfficerFilter, setFieldOfficerFilter] = useState<FieldOfficerFilter>('All');
  const [activeTab, setActiveTab] = useState<TaskScreenTab>('My Tasks');
  const [selectedTaskSection, setSelectedTaskSection] = useState<TaskSectionPreview | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [attendanceNotice, setAttendanceNotice] = useState<string | null>(null);

  const tasksLoadInFlightRef = useRef<Promise<void> | null>(null);
  const tasksReloadQueuedRef = useRef(false);
  const attendanceNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const volunteerJoinRecordByProjectId = useMemo(
    () => new Map(volunteerJoinRecords.map(record => [record.projectId, record] as const)),
    [volunteerJoinRecords]
  );

  const loadVolunteerTasks = async () => {
    try {
      if (!user?.id) {
        setTasks([]);
        setAllProjects([]);
        setAllVolunteers([]);
        setVolunteerProfile(null);
        setVolunteerTimeLogs([]);
        setAllVolunteerTimeLogs([]);
        setVolunteerJoinRecords([]);
        setLoading(false);
        return;
      }

      clearStorageCache(['projects', 'events', 'volunteers', 'volunteerTimeLogs', 'volunteerProjectJoins']);

      const [projects, currentVolunteerProfile, volunteers] = await Promise.all([
        getAllProjects(),
        getVolunteerByUserId(user.id),
        getAllVolunteers(),
      ]);
      setAllProjects(projects);
      setVolunteerProfile(currentVolunteerProfile || null);
      setAllVolunteers(volunteers);

      let nextVolunteerTimeLogs: VolunteerTimeLog[] = [];
      let nextAllVolunteerTimeLogs: VolunteerTimeLog[] = [];
      let nextVolunteerJoinRecords: VolunteerProjectJoinRecord[] = [];

      if (currentVolunteerProfile) {
        const assignedProjectIds = Array.from(
          new Set(
            projects
              .filter(project =>
                (project.internalTasks || []).some(
                  task => isVolunteerAssignedToTask(task, currentVolunteerProfile.id, currentVolunteerProfile.userId)
                )
              )
              .map(project => project.id)
          )
        );

        nextVolunteerTimeLogs = await getVolunteerTimeLogs(currentVolunteerProfile.id).catch(error => {
          console.error('Error loading volunteer time logs for task tracking:', error);
          return [];
        });
        nextAllVolunteerTimeLogs = await getAllVolunteerTimeLogs().catch(error => {
          console.error('Error loading all volunteer time logs for task tracking:', error);
          return [];
        });

        nextVolunteerJoinRecords = (
          await Promise.all(
            assignedProjectIds.map(async projectId => {
              try {
                const records = await getVolunteerProjectJoinRecords(projectId);
                return records.find(record => record.volunteerId === currentVolunteerProfile.id) || null;
              } catch (error) {
                console.error(`Error loading join record for project ${projectId}:`, error);
                return null;
              }
            })
          )
        ).filter((record): record is VolunteerProjectJoinRecord => record !== null);
      }

      const nextJoinRecordByProjectId = new Map(
        nextVolunteerJoinRecords.map(record => [record.projectId, record] as const)
      );
      const nextTasks = collectAssignedTasks(
        projects,
        currentVolunteerProfile,
        nextJoinRecordByProjectId,
        nextVolunteerTimeLogs
      );

      setAllProjects(projects);
      setVolunteerProfile(currentVolunteerProfile);
      setVolunteerTimeLogs(nextVolunteerTimeLogs);
      setAllVolunteerTimeLogs(nextAllVolunteerTimeLogs);
      setVolunteerJoinRecords(nextVolunteerJoinRecords);
      setTasks(nextTasks);
      setSelectedTask(current =>
        current
          ? nextTasks.find(task => task.id === current.id && task.projectId === current.projectId) || null
          : current
      );
      setLoadError(null);
      setLoading(false);
    } catch (error) {
      console.error('Error loading volunteer tasks:', error);
      setTasks([]);
      setAllProjects([]);
      setAllVolunteers([]);
      setVolunteerProfile(null);
      setVolunteerTimeLogs([]);
      setAllVolunteerTimeLogs([]);
      setVolunteerJoinRecords([]);
      setLoadError({
        title: getRequestErrorTitle(error, 'Database Unavailable'),
        message: getRequestErrorMessage(error, 'Failed to load your assigned tasks.'),
      });
      setLoading(false);
    }
  };

  const loadVolunteerTasksCoalesced = React.useCallback(async () => {
    if (tasksLoadInFlightRef.current) {
      tasksReloadQueuedRef.current = true;
      return;
    }

    do {
      tasksReloadQueuedRef.current = false;
      const task = loadVolunteerTasks();
      tasksLoadInFlightRef.current = task;
      try {
        await task;
      } finally {
        tasksLoadInFlightRef.current = null;
      }
    } while (tasksReloadQueuedRef.current);
  }, [user]);

  useFocusEffect(
    React.useCallback(() => {
      void loadVolunteerTasksCoalesced();
    }, [loadVolunteerTasksCoalesced])
  );

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'events', 'volunteers', 'volunteerTimeLogs', 'volunteerProjectJoins'],
      async () => {
        await loadVolunteerTasksCoalesced();
      }
    );
  }, [loadVolunteerTasksCoalesced]);

  useEffect(() => {
    return () => {
      if (attendanceNoticeTimerRef.current) {
        clearTimeout(attendanceNoticeTimerRef.current);
        attendanceNoticeTimerRef.current = null;
      }
    };
  }, []);

  const showAttendanceNotice = (message: string, durationMs = 1000) => {
    if (attendanceNoticeTimerRef.current) {
      clearTimeout(attendanceNoticeTimerRef.current);
      attendanceNoticeTimerRef.current = null;
    }

    setAttendanceNotice(message);
    attendanceNoticeTimerRef.current = setTimeout(() => {
      setAttendanceNotice(null);
      attendanceNoticeTimerRef.current = null;
    }, durationMs);
  };

  const formatTimestamp = (value?: string) => {
    if (!value) {
      return '--';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '--';
    }

    return parsed.toLocaleString();
  };

  const handleConfirmAttendanceForProject = async (projectId: string) => {
    if (!volunteerProfile) {
      return;
    }

    const project = allProjects.find(entry => entry.id === projectId) || null;
    if (!project) {
      Alert.alert('Event not found', 'Please reload your assigned tasks and try again.');
      return;
    }

    const projectLogs = volunteerTimeLogs.filter(log => log.projectId === projectId);
    const isAssigned = tasks.some(task => task.projectId === projectId);
    const attendanceState = getTaskEventAttendanceState(project, isAssigned, projectLogs);

    if (!attendanceState.canConfirmAttendance && !attendanceState.eventHasNotStarted) {
      Alert.alert('Attendance Unavailable', attendanceState.helperText);
      return;
    }

    try {
      const attendancePhoto = await pickAttendancePhotoFromDevice();
      if (!attendancePhoto) {
        return;
      }

      setActionLoadingKey(`attendance-${projectId}`);
      const createdLog = await startVolunteerTimeLog(
        volunteerProfile.id,
        projectId,
        undefined,
        attendancePhoto
      );
      const nextVolunteerTimeLogs = [createdLog, ...volunteerTimeLogs.filter(log => log.id !== createdLog.id)].sort(
        (left, right) => new Date(right.timeIn).getTime() - new Date(left.timeIn).getTime()
      );
      const nextAllVolunteerTimeLogs = [
        createdLog,
        ...allVolunteerTimeLogs.filter(log => log.id !== createdLog.id),
      ].sort((left, right) => new Date(right.timeIn).getTime() - new Date(left.timeIn).getTime());
      const nextTasks = collectAssignedTasks(
        allProjects,
        volunteerProfile,
        volunteerJoinRecordByProjectId,
        nextVolunteerTimeLogs
      );

      setVolunteerTimeLogs(nextVolunteerTimeLogs);
      setAllVolunteerTimeLogs(nextAllVolunteerTimeLogs);
      setTasks(nextTasks);
      setSelectedTask(current =>
        current
          ? nextTasks.find(task => task.id === current.id && task.projectId === current.projectId) || null
          : current
      );
      showAttendanceNotice('Attendance confirmed for today.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, 'Unable to confirm attendance'),
        getRequestErrorMessage(error, 'Please try again.')
      );
    } finally {
      setActionLoadingKey(null);
    }
  };

  const selectedEventProject = useMemo(
    () => allProjects.find(project => project.id === selectedTask?.projectId && project.isEvent) || null,
    [allProjects, selectedTask?.projectId]
  );

  const fieldOfficerEvents = useMemo(() => {
    if (!volunteerProfile) {
      return [];
    }

    return allProjects
      .filter(
        project =>
          project.isEvent &&
          (project.internalTasks || []).some(
            task => task.isFieldOfficer && isVolunteerAssignedToTask(task, volunteerProfile.id)
          )
      )
      .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());
  }, [allProjects, volunteerProfile]);

  const parentProjectTitleById = useMemo(
    () =>
      new Map(
        allProjects
          .filter(project => !project.isEvent)
          .map(project => [project.id, project.title] as const)
      ),
    [allProjects]
  );

  const selectedManagedEvent = useMemo(
    () => fieldOfficerEvents.find(project => project.id === selectedManagedEventId) || null,
    [fieldOfficerEvents, selectedManagedEventId]
  );

  const isFieldOfficerForSelectedEvent = useMemo(() => {
    if (!selectedEventProject || !volunteerProfile) {
      return false;
    }

    return (selectedEventProject.internalTasks || []).some(
      task => task.isFieldOfficer && isVolunteerAssignedToTask(task, volunteerProfile.id)
    );
  }, [selectedEventProject, volunteerProfile]);

  const joinedVolunteerOptions = useMemo(() => {
    if (!selectedEventProject) {
      return [];
    }

    return selectedEventProject.volunteers
      .map(volunteerId => allVolunteers.find(volunteer => volunteer.id === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [allVolunteers, selectedEventProject]);

  const managedEventVolunteerOptions = useMemo(() => {
    if (!selectedManagedEvent) {
      return [];
    }

    return selectedManagedEvent.volunteers
      .map(volunteerId => allVolunteers.find(volunteer => volunteer.id === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [allVolunteers, selectedManagedEvent]);

  const managedEventAttendanceDateKeys = useMemo(() => {
    if (!selectedManagedEvent) {
      return [];
    }

    const eventDateKeys = getDateRangeKeys(selectedManagedEvent.startDate, selectedManagedEvent.endDate);
    const fallbackDateKeys = Array.from(
      new Set(
        allVolunteerTimeLogs
          .filter(log => log.projectId === selectedManagedEvent.id)
          .map(log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn))
          .filter(Boolean)
      )
    ).sort((left, right) => new Date(left).getTime() - new Date(right).getTime());

    return eventDateKeys.length ? eventDateKeys : fallbackDateKeys;
  }, [allVolunteerTimeLogs, selectedManagedEvent]);

  useEffect(() => {
    if (!selectedManagedEvent) {
      setSelectedManagedAttendanceDateKey(null);
      setExpandedManagedTaskId(null);
      setShowManagedTaskAssignments(false);
      return;
    }

    const todayKey = getLocalDateKey();
    setSelectedManagedAttendanceDateKey(current => {
      if (current && managedEventAttendanceDateKeys.includes(current)) {
        return current;
      }

      if (managedEventAttendanceDateKeys.includes(todayKey)) {
        return todayKey;
      }

      return managedEventAttendanceDateKeys[0] || todayKey;
    });
  }, [managedEventAttendanceDateKeys, selectedManagedEvent]);

  const resolvedManagedAttendanceDateKey =
    selectedManagedAttendanceDateKey && managedEventAttendanceDateKeys.includes(selectedManagedAttendanceDateKey)
      ? selectedManagedAttendanceDateKey
      : managedEventAttendanceDateKeys.includes(getLocalDateKey())
      ? getLocalDateKey()
      : managedEventAttendanceDateKeys[0] || getLocalDateKey();

  const managedEventAttendanceEntries = useMemo(() => {
    if (!selectedManagedEvent) {
      return [];
    }

    return managedEventVolunteerOptions
      .map(volunteer => {
        const logs = allVolunteerTimeLogs
          .filter(log => log.projectId === selectedManagedEvent.id && log.volunteerId === volunteer.id)
          .filter(
            log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === resolvedManagedAttendanceDateKey
          )
          .sort(
            (left, right) =>
              new Date(right.attendanceConfirmedAt || right.timeIn).getTime() -
              new Date(left.attendanceConfirmedAt || left.timeIn).getTime()
          );

        return {
          volunteer,
          logs,
          checkedAttendanceDays: new Set(
            logs
              .filter(log => Boolean(log.attendanceCheckedAt))
              .map(log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn))
              .filter(Boolean)
          ).size,
        };
      })
      .sort((left, right) => left.volunteer.name.localeCompare(right.volunteer.name));
  }, [
    allVolunteerTimeLogs,
    managedEventVolunteerOptions,
    resolvedManagedAttendanceDateKey,
    selectedManagedEvent,
  ]);

  const managedEventSelectedDateUploadCount = managedEventAttendanceEntries.filter(
    entry => entry.logs.length > 0
  ).length;
  const managedEventSelectedDateCheckedCount = managedEventAttendanceEntries.filter(
    entry => entry.logs.some(log => Boolean(log.attendanceCheckedAt))
  ).length;

  const handleAssignEventTask = async (
    eventProject: Project | null,
    taskId: string,
    volunteerId?: string,
    mode: 'assign' | 'remove' = 'assign'
  ) => {
    if (!eventProject || !volunteerProfile) {
      return;
    }

    try {
      const isFieldOfficerForEvent = (eventProject.internalTasks || []).some(
        task => task.isFieldOfficer && isVolunteerAssignedToTask(task, volunteerProfile.id)
      );

      if (!isFieldOfficerForEvent) {
        Alert.alert('Access Restricted', 'Only the assigned field officer for this event can manage volunteer task assignments.');
        return;
      }

      const assignableVolunteers = eventProject.volunteers
        .map(joinedVolunteerId => allVolunteers.find(volunteer => volunteer.id === joinedVolunteerId) || null)
        .filter((volunteer): volunteer is Volunteer => volunteer !== null);
      const assignedVolunteer = volunteerId
        ? assignableVolunteers.find(volunteer => volunteer.id === volunteerId) || null
        : null;
      const currentTask = (eventProject.internalTasks || []).find(task => task.id === taskId) || null;
      const currentAssignedVolunteerIds = currentTask ? getTaskAssignedVolunteerIds(currentTask) : [];
      const isAlreadyAssigned = Boolean(
        volunteerId && currentTask && currentAssignedVolunteerIds.includes(volunteerId)
      );

      if (
        mode === 'assign' &&
        currentTask &&
        !isAlreadyAssigned &&
        currentAssignedVolunteerIds.length >= getTaskVolunteerLimit(currentTask)
      ) {
        const taskVolunteerLimit = getTaskVolunteerLimit(currentTask);
        Alert.alert(
          'Assignment Limit Reached',
          `This task can have at most ${taskVolunteerLimit} volunteer${taskVolunteerLimit === 1 ? '' : 's'} assigned.`
        );
        return;
      }

      const nextAssignedVolunteerIds = !volunteerId
        ? []
        : mode === 'remove'
        ? currentAssignedVolunteerIds.filter(id => id !== volunteerId)
        : isAlreadyAssigned
        ? currentAssignedVolunteerIds
        : [...currentAssignedVolunteerIds, volunteerId];
      const nextAssignedVolunteers = nextAssignedVolunteerIds
        .map(id => assignableVolunteers.find(volunteer => volunteer.id === id) || null)
        .filter((volunteer): volunteer is Volunteer => volunteer !== null);
      const nextAssignedVolunteerNames = nextAssignedVolunteers.map(volunteer => volunteer.name);
      const removedVolunteer =
        mode === 'remove' && volunteerId
          ? assignableVolunteers.find(volunteer => volunteer.id === volunteerId) || null
          : null;
      const shouldNotifyAssignedVolunteer = Boolean(
        assignedVolunteer && volunteerId && mode === 'assign' && !currentAssignedVolunteerIds.includes(volunteerId)
      );

      const updatedTasks = (eventProject.internalTasks || []).map(task => {
        if (task.id !== taskId) {
          return task;
        }

        if (task.isFieldOfficer) {
          return task;
        }

        const nextStatus: ProjectInternalTask['status'] =
          nextAssignedVolunteerIds.length === 0
            ? 'Unassigned'
            : task.status === 'Unassigned'
            ? 'Assigned'
            : task.status;

        return {
          ...task,
          assignedVolunteerId: nextAssignedVolunteerIds[0] || undefined,
          assignedVolunteerName: nextAssignedVolunteerNames[0] || undefined,
          assignedVolunteerIds: nextAssignedVolunteerIds.length ? nextAssignedVolunteerIds : undefined,
          assignedVolunteerNames: nextAssignedVolunteerNames.length ? nextAssignedVolunteerNames : undefined,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        };
      });

      await saveEvent({
        ...eventProject,
        internalTasks: updatedTasks,
        updatedAt: new Date().toISOString(),
      });
      const notificationTasks: Promise<void>[] = [];
      if (currentTask && removedVolunteer) {
        notificationTasks.push(notifyVolunteerAboutTaskUnassignment({
          event: eventProject,
          task: currentTask,
          volunteer: removedVolunteer,
          actorUserId: user?.id,
        }));
      }
      if (currentTask && assignedVolunteer && shouldNotifyAssignedVolunteer) {
        notificationTasks.push(notifyVolunteerAboutTaskUpdate({
          event: eventProject,
          task: {
            ...currentTask,
            status: nextAssignedVolunteerIds.length ? 'Assigned' : currentTask.status,
          },
          volunteer: assignedVolunteer,
          actorUserId: user?.id,
          action: 'assigned',
        }));
      }
      if (notificationTasks.length > 0) {
        await Promise.all(notificationTasks);
      }
      const updatedProject: Project = {
        ...eventProject,
        internalTasks: updatedTasks,
        updatedAt: new Date().toISOString(),
      };
      const nextProjects = allProjects.map(project =>
        project.id === updatedProject.id ? updatedProject : project
      );
      clearStorageCache(['projects', 'events']);
      const nextTasks = collectAssignedTasks(
        nextProjects,
        volunteerProfile,
        volunteerJoinRecordByProjectId,
        volunteerTimeLogs
      );
      setAllProjects(nextProjects);
      setTasks(nextTasks);
      setSelectedTask(current => {
        if (!current) {
          return current;
        }

        return nextTasks.find(task => task.id === current.id && task.projectId === current.projectId) || null;
      });
      void loadVolunteerTasksCoalesced();
      const actionLabel =
        !volunteerId
          ? 'cleared'
          : mode === 'remove'
          ? 'updated'
          : isAlreadyAssigned
          ? 'kept'
          : 'assigned';
      Alert.alert(
        'Saved',
        actionLabel === 'updated'
          ? 'Volunteer removed from this task.'
          : actionLabel === 'kept'
          ? 'Volunteer is already assigned to this task.'
          : actionLabel === 'cleared'
          ? 'Task assignments cleared.'
          : 'Volunteer assigned to this task.'
      );
    } catch (error) {
      console.error('Error assigning event task:', error);
      Alert.alert('Error', 'Failed to update the event task assignment.');
    }
  };

  const handleTaskVolunteerChipPress = (eventTask: ProjectInternalTask, volunteer: Volunteer) => {
    if (!selectedManagedEvent) {
      return;
    }

    const isAssigned = isVolunteerAssignedToTask(eventTask, volunteer.id);

    if (isAssigned) {
      void handleAssignEventTask(selectedManagedEvent, eventTask.id, volunteer.id, 'remove');
      return;
    }

    void handleAssignEventTask(selectedManagedEvent, eventTask.id, volunteer.id, 'assign');
  };

  const handleToggleAttendanceCheck = async (log: VolunteerTimeLog, checked: boolean) => {
    if (!user?.id) {
      return;
    }

    const loadingKey = `attendance-check-${log.id}`;
    const optimisticLog: VolunteerTimeLog = {
      ...log,
      attendanceCheckedAt: checked ? new Date().toISOString() : undefined,
      attendanceCheckedBy: checked ? user.id : undefined,
      attendanceCheckedByName: checked ? user.name || 'Field Officer' : undefined,
    };
    try {
      setActionLoadingKey(loadingKey);
      setAllVolunteerTimeLogs(current =>
        current.map(entry => (entry.id === optimisticLog.id ? optimisticLog : entry))
      );
      setVolunteerTimeLogs(current =>
        current.map(entry => (entry.id === optimisticLog.id ? optimisticLog : entry))
      );
      const updatedLog = await setVolunteerAttendanceChecked(log.id, checked, user.id);
      setAllVolunteerTimeLogs(current =>
        current.map(entry => (entry.id === updatedLog.id ? updatedLog : entry))
      );
      setVolunteerTimeLogs(current =>
        current.map(entry => (entry.id === updatedLog.id ? updatedLog : entry))
      );
      showAttendanceNotice(checked ? 'Attendance marked.' : 'Attendance mark removed.');
    } catch (error) {
      setAllVolunteerTimeLogs(current =>
        current.map(entry => (entry.id === log.id ? log : entry))
      );
      setVolunteerTimeLogs(current =>
        current.map(entry => (entry.id === log.id ? log : entry))
      );
      Alert.alert(
        getRequestErrorTitle(error, 'Unable to mark attendance'),
        getRequestErrorMessage(
          error,
          'Only the assigned field officer for this event can mark attendance.'
        )
      );
    } finally {
      setActionLoadingKey(current => (current === loadingKey ? null : current));
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High':
        return '#dc2626';
      case 'Medium':
        return '#f59e0b';
      case 'Low':
        return '#10b981';
      default:
        return '#6b7280';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return '#10b981';
      case 'In Progress':
        return '#3b82f6';
      case 'Assigned':
        return '#f59e0b';
      case 'Unassigned':
        return '#6b7280';
      default:
        return '#6b7280';
    }
  };

  const filteredTasks = filterStatus === 'All' ? tasks : tasks.filter(t => t.status === filterStatus);
  const hasFieldOfficerAccess = fieldOfficerEvents.length > 0;
  const fieldOfficerEventCounts = useMemo(
    () => ({
      All: fieldOfficerEvents.length,
      Active: fieldOfficerEvents.filter(event => getFieldOfficerEventBucket(event) === 'Active').length,
      Upcoming: fieldOfficerEvents.filter(event => getFieldOfficerEventBucket(event) === 'Upcoming').length,
      Completed: fieldOfficerEvents.filter(event => getFieldOfficerEventBucket(event) === 'Completed').length,
    }),
    [fieldOfficerEvents]
  );
  const filteredFieldOfficerEvents = useMemo(() => {
    const statusRank: Record<Exclude<FieldOfficerFilter, 'All'>, number> = {
      Active: 0,
      Upcoming: 1,
      Completed: 2,
    };

    return fieldOfficerEvents
      .filter(event => fieldOfficerFilter === 'All' || getFieldOfficerEventBucket(event) === fieldOfficerFilter)
      .sort((left, right) => {
        const bucketDelta =
          statusRank[getFieldOfficerEventBucket(left)] - statusRank[getFieldOfficerEventBucket(right)];

        if (bucketDelta !== 0) {
          return bucketDelta;
        }

        return new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
      });
  }, [fieldOfficerEvents, fieldOfficerFilter]);
  const assignedCount = tasks.filter(task => task.status === 'Assigned').length;
  const inProgressCount = tasks.filter(task => task.status === 'In Progress').length;
  const completedCount = tasks.filter(task => task.status === 'Completed').length;
  const groupedFilteredTasks = useMemo(() => {
    const groups = new Map<string, AssignedTaskGroup>();

    filteredTasks.forEach(task => {
      const existingGroup = groups.get(task.projectId);
      if (existingGroup) {
        existingGroup.tasks.push(task);
        return;
      }

      groups.set(task.projectId, {
        projectId: task.projectId,
        projectTitle: task.projectTitle,
        tasks: [task],
      });
    });

    return Array.from(groups.values()).sort((left, right) => left.projectTitle.localeCompare(right.projectTitle));
  }, [filteredTasks]);
  const selectedTaskGroup = useMemo(
    () => groupedFilteredTasks.find(group => group.projectId === selectedTaskGroupProjectId) || null,
    [groupedFilteredTasks, selectedTaskGroupProjectId]
  );
  const selectedTaskGroupProject = useMemo(
    () =>
      allProjects.find(
        project => project.id === selectedTaskGroupProjectId && project.isEvent
      ) || null,
    [allProjects, selectedTaskGroupProjectId]
  );

  const taskGroupSectionItems = useMemo<TaskSectionPreviewItem[]>(
    () =>
      groupedFilteredTasks.map(group => {
        const project = allProjects.find(entry => entry.id === group.projectId) || null;
        const eventStatus = project ? getProjectDisplayStatus(project) : 'Planning';

        return {
          id: `task-group-${group.projectId}`,
          kind: 'task-group',
          projectId: group.projectId,
          title: group.projectTitle,
          description: project
            ? `${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'} • ${formatEventDateLabel(
                project.startDate,
                project.endDate
              )}`
            : `${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'} ready to review`,
          badgeLabel: eventStatus,
          badgeColor: project ? getProjectStatusColor(project) : '#64748b',
        };
      }),
    [allProjects, groupedFilteredTasks]
  );

  const fieldOfficerSectionItems = useMemo<TaskSectionPreviewItem[]>(
    () =>
      filteredFieldOfficerEvents.map(eventProject => ({
        id: `field-officer-${eventProject.id}`,
        kind: 'field-officer-event',
        projectId: eventProject.id,
        title: eventProject.title,
        description: `${formatEventDateLabel(eventProject.startDate, eventProject.endDate)} • ${
          eventProject.volunteers.length
        } volunteer${eventProject.volunteers.length === 1 ? '' : 's'}`,
        badgeLabel: getFieldOfficerEventBucket(eventProject),
        badgeColor: getProjectStatusColor(eventProject),
      })),
    [filteredFieldOfficerEvents]
  );

  const taskGroupsSection = useMemo<TaskSectionPreview>(
    () => ({
      id: 'assigned-events',
      title: 'Assigned Event Pages',
      eyebrow: 'My Tasks',
      subtitle: groupedFilteredTasks.length
        ? `Open the list to review ${groupedFilteredTasks.length} assigned event page${
            groupedFilteredTasks.length === 1 ? '' : 's'
          } in the ${FILTER_OPTION_LABELS[filterStatus]} view.`
        : `No assigned event pages are available in the ${FILTER_OPTION_LABELS[filterStatus]} view.`,
      items: taskGroupSectionItems,
      emptyTitle: 'No event pages in this filter',
      emptyText: 'Try another task status filter or wait for a new assignment.',
    }),
    [filterStatus, groupedFilteredTasks.length, taskGroupSectionItems]
  );

  const fieldOfficerEventsSection = useMemo<TaskSectionPreview>(
    () => ({
      id: 'field-officer-events',
      title: 'Field Officer Events',
      eyebrow: 'Manage Assignments',
      subtitle: filteredFieldOfficerEvents.length
        ? `Open the list to manage ${filteredFieldOfficerEvents.length} supervised event${
            filteredFieldOfficerEvents.length === 1 ? '' : 's'
          } in the ${fieldOfficerFilter} view.`
        : `No field officer events are available in the ${fieldOfficerFilter} view.`,
      items: fieldOfficerSectionItems,
      emptyTitle: 'No events in this filter',
      emptyText: 'Try another filter to review the rest of your field officer events.',
    }),
    [fieldOfficerFilter, fieldOfficerSectionItems, filteredFieldOfficerEvents.length]
  );

  const handleBackToTaskGroupDetails = () => {
    setShowDetails(false);
    if (selectedTaskGroupProjectId) {
      setShowTaskGroupDetails(true);
    }
  };

  useEffect(() => {
    if (!hasFieldOfficerAccess && activeTab === 'Manage Assignments') {
      setActiveTab('My Tasks');
    }
  }, [activeTab, hasFieldOfficerAccess]);

  const openTaskSection = (section: TaskSectionPreview) => {
    setSelectedTaskSection(section);
  };

  const handleOpenTaskSectionItem = (item: TaskSectionPreviewItem) => {
    setSelectedTaskSection(null);

    if (item.kind === 'field-officer-event') {
      setSelectedManagedEventId(item.projectId);
      setShowFieldOfficerBoard(true);
      return;
    }

    setSelectedTaskGroupProjectId(item.projectId);
    setShowTaskGroupDetails(true);
  };

  const renderTaskSectionCard = (section: TaskSectionPreview) => {
    const firstItem = section.items[0];

    return (
      <TouchableOpacity
        key={section.id}
        style={styles.sectionSummaryCard}
        onPress={() => openTaskSection(section)}
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
          {section.items.length > 0 && firstItem
            ? `Tap to open the list. First item: ${firstItem.title}`
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
  };

  const renderFieldOfficerEventCard = (eventProject: Project) => {
    const eventTasks = eventProject.internalTasks || [];
    const assignableTasks = eventTasks.filter(task => !task.isFieldOfficer);
    const assignedTaskCount = assignableTasks.filter(task => getTaskAssignedVolunteerIds(task).length > 0).length;
    const unassignedTaskCount = assignableTasks.length - assignedTaskCount;
    const parentProgramTitle = eventProject.parentProjectId
      ? parentProjectTitleById.get(eventProject.parentProjectId)
      : null;
    const eventBucket = getFieldOfficerEventBucket(eventProject);

    return (
      <TouchableOpacity
        key={eventProject.id}
        style={styles.fieldOfficerEventCard}
        onPress={() =>
          handleOpenTaskSectionItem({
            id: `field-officer-${eventProject.id}`,
            kind: 'field-officer-event',
            projectId: eventProject.id,
            title: eventProject.title,
            description: eventProject.description || '',
          })
        }
      >
        <View style={styles.fieldOfficerEventTopRow}>
          <View style={styles.fieldOfficerEventCopy}>
            <View style={styles.fieldOfficerEventTitleRow}>
              <Text style={styles.fieldOfficerEventTitle}>{eventProject.title}</Text>
              <View style={styles.fieldOfficerEventStatusBadge}>
                <Text style={styles.fieldOfficerEventStatusText}>{eventBucket}</Text>
              </View>
            </View>
            {parentProgramTitle ? (
              <Text style={styles.fieldOfficerEventProgram} numberOfLines={1}>
                Program: {parentProgramTitle}
              </Text>
            ) : null}
            <Text style={styles.fieldOfficerEventMeta}>
              {formatEventDateLabel(eventProject.startDate, eventProject.endDate)}
            </Text>
            <Text style={styles.fieldOfficerEventMeta} numberOfLines={1}>
              {eventProject.location.address}
            </Text>
          </View>
          <MaterialIcons name="supervisor-account" size={22} color="#166534" />
        </View>

        <View style={styles.fieldOfficerMetricsRow}>
          <View style={styles.fieldOfficerMetricCard}>
            <Text style={styles.fieldOfficerMetricValue}>{eventProject.volunteers.length}</Text>
            <Text style={styles.fieldOfficerMetricLabel}>joined volunteers</Text>
          </View>
          <View style={styles.fieldOfficerMetricCard}>
            <Text style={styles.fieldOfficerMetricValue}>{assignedTaskCount}</Text>
            <Text style={styles.fieldOfficerMetricLabel}>assigned tasks</Text>
          </View>
          <View style={styles.fieldOfficerMetricCard}>
            <Text style={styles.fieldOfficerMetricValue}>{unassignedTaskCount}</Text>
            <Text style={styles.fieldOfficerMetricLabel}>open tasks</Text>
          </View>
        </View>

        <View style={styles.fieldOfficerOpenRow}>
          <Text style={styles.fieldOfficerOpenText}>Open assignment board</Text>
          <MaterialIcons name="chevron-right" size={20} color="#166534" />
        </View>
      </TouchableOpacity>
    );
  };

  const renderTaskGroupCard = (group: AssignedTaskGroup) => {
    const project = allProjects.find(entry => entry.id === group.projectId) || null;
    const joinedVolunteerCount = project?.volunteers?.length || 0;
    const eventAddress = project?.location.address || 'Event details available inside';
    const eventLogs = allVolunteerTimeLogs.filter(log => log.projectId === group.projectId);
    const attendanceCount = eventLogs.filter(log => Boolean(log.timeOut || log.attendanceConfirmedAt)).length;
    const totalVolunteerMinutes = eventLogs.reduce(
      (sum, log) => sum + getCompletedLogMinutes(log),
      0
    );
    const eventStatus = project ? getProjectDisplayStatus(project) : 'Planning';

    return (
      <TouchableOpacity
        key={group.projectId}
        style={styles.taskGroupCard}
        activeOpacity={0.88}
        onPress={() =>
          handleOpenTaskSectionItem({
            id: `task-group-${group.projectId}`,
            kind: 'task-group',
            projectId: group.projectId,
            title: group.projectTitle,
            description: project?.description || '',
          })
        }
      >
        <View style={styles.taskGroupHeader}>
          <View style={styles.taskGroupCopy}>
            <Text style={styles.taskGroupTitle} numberOfLines={2}>{group.projectTitle}</Text>
            <Text style={styles.taskGroupMeta} numberOfLines={1}>
              {group.tasks.length} task{group.tasks.length === 1 ? '' : 's'} in this event
            </Text>
          </View>
          <View style={styles.taskGroupBadge}>
            <Text style={styles.taskGroupBadgeText}>Open</Text>
          </View>
        </View>

        <View style={styles.taskGroupMetaRow}>
          <View style={styles.taskGroupMetaChip}>
            <MaterialIcons name="calendar-month" size={14} color="#166534" />
            <Text style={styles.taskGroupMetaChipText} numberOfLines={1}>
              {project
                ? formatEventDateLabel(project.startDate, project.endDate)
                : 'Schedule pending'}
            </Text>
          </View>
          <View style={styles.taskGroupMetaChip}>
            <MaterialIcons name="groups" size={14} color="#166534" />
            <Text style={styles.taskGroupMetaChipText} numberOfLines={1}>
              {joinedVolunteerCount} volunteer{joinedVolunteerCount === 1 ? '' : 's'}
            </Text>
          </View>
          <View style={styles.taskGroupMetaChip}>
            <MaterialIcons name="location-on" size={14} color="#166534" />
            <Text style={styles.taskGroupMetaChipText} numberOfLines={1}>
              {eventAddress}
            </Text>
          </View>
        </View>

        <View style={styles.taskGroupStatRow}>
          <View style={styles.taskGroupStatCard}>
            <Text
              style={styles.taskGroupStatValue}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {attendanceCount}
            </Text>
            <Text style={styles.taskGroupStatLabel}>Attendance</Text>
          </View>

          <View style={styles.taskGroupStatCard}>
            <Text
              style={styles.taskGroupStatValue}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              {eventStatus}
            </Text>
            <Text style={styles.taskGroupStatLabel}>Event Status</Text>
          </View>
        </View>

        <View style={styles.taskGroupFooter}>
          <Text style={styles.taskGroupFooterText}>Tap to view this event page</Text>
          <MaterialIcons name="chevron-right" size={18} color="#166534" />
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading your tasks...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {attendanceNotice ? (
        <View pointerEvents="none" style={styles.attendanceNoticeOverlay}>
          <View style={styles.attendanceNoticeCard}>
            <MaterialIcons name="check-circle" size={18} color="#166534" />
            <Text style={styles.attendanceNoticeText}>{attendanceNotice}</Text>
          </View>
        </View>
      ) : null}
      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContentContainer} showsVerticalScrollIndicator={true}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Assigned Tasks</Text>
          <Text style={styles.headerSubtitle}>
            {hasFieldOfficerAccess
              ? 'Review your tasks and manage volunteer assignments in the events you supervise.'
              : 'Tasks assigned to you inside joined events'}
          </Text>
        </View>

        {hasFieldOfficerAccess ? (
          <View style={styles.topTabBar}>
            {(['My Tasks', 'Manage Assignments'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[styles.topTabButton, activeTab === tab && styles.topTabButtonActive]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.85}
              >
                <MaterialIcons
                  name={tab === 'My Tasks' ? 'assignment' : 'supervisor-account'}
                  size={18}
                  color={activeTab === tab ? '#ffffff' : '#166534'}
                />
                <Text style={[styles.topTabButtonText, activeTab === tab && styles.topTabButtonTextActive]}>
                  {tab}
                </Text>
                <View style={[styles.topTabBadge, activeTab === tab && styles.topTabBadgeActive]}>
                  <Text style={[styles.topTabBadgeText, activeTab === tab && styles.topTabBadgeTextActive]}>
                    {tab === 'My Tasks' ? tasks.length : fieldOfficerEvents.length}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

      {loadError && (
        <View style={styles.inlineErrorWrap}>
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => void loadVolunteerTasks()}
          />
        </View>
      )}

      {hasFieldOfficerAccess && activeTab === 'Manage Assignments' ? (
        <View style={styles.fieldOfficerSection}>
          <View style={styles.fieldOfficerSectionHeader}>
            <View style={styles.fieldOfficerSectionTitleWrap}>
              <Text style={styles.fieldOfficerSectionTitle}>Field Officer Events</Text>
              <Text style={styles.fieldOfficerSectionSubtitle}>
                Admin assigned you as field officer for these event teams.
              </Text>
            </View>
            <View style={styles.fieldOfficerSectionBadge}>
              <Text style={styles.fieldOfficerSectionBadgeText}>
                {fieldOfficerEvents.length} event{fieldOfficerEvents.length === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          <Text style={styles.fieldOfficerSectionSummary}>
            Filter: {fieldOfficerFilter} ({fieldOfficerEventCounts[fieldOfficerFilter] || 0})
          </Text>

          {renderTaskSectionCard(fieldOfficerEventsSection)}
        </View>
      ) : null}

      {activeTab === 'My Tasks' ? (
      <>
      <View style={styles.taskSummaryRow}>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="assignment" size={18} color="#3F7A54" />
          </View>
          <Text style={styles.taskSummaryValue}>{tasks.length}</Text>
          <Text style={styles.taskSummaryLabel}>Total</Text>
        </View>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="bookmark" size={18} color="#3F7A54" />
          </View>
          <Text style={styles.taskSummaryValue}>{assignedCount}</Text>
          <Text style={styles.taskSummaryLabel}>Assigned</Text>
        </View>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="pending-actions" size={18} color="#3F7A54" />
          </View>
          <Text style={styles.taskSummaryValue}>{inProgressCount}</Text>
          <Text style={styles.taskSummaryLabel}>In Progress</Text>
        </View>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="task-alt" size={18} color="#3F7A54" />
          </View>
          <Text style={styles.taskSummaryValue}>{completedCount}</Text>
          <Text style={styles.taskSummaryLabel}>Completed</Text>
        </View>
      </View>

      {tasks.length === 0 ? (
        <View style={styles.emptyCardContainer}>
          <View style={styles.emptyStateCard}>
            <View style={styles.emptyIllustrationWrap}>
              <EmptyTasksIllustration />
            </View>
            <Text style={styles.emptyStateTitle}>No tasks assigned yet</Text>
            <Text style={styles.emptyStateSubtitle}>
              Tasks will appear here when admins or field officers assign work to you inside an event.
            </Text>
            <TouchableOpacity
              style={styles.emptyStateBtn}
              onPress={() => navigation.navigate('Events' as any)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="event" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.emptyStateBtnText}>View My Events</Text>
            </TouchableOpacity>
          </View>

          {/* Tip Card */}
          <View style={styles.tipCard}>
            <View style={styles.tipIconWrap}>
              <MaterialIcons name="lightbulb-outline" size={18} color="#fff" />
            </View>
            <View style={styles.tipContent}>
              <Text style={styles.tipTitle}>Tip</Text>
              <Text style={styles.tipDesc}>
                Keep an eye on your tasks and stay updated with your events.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.tipBtn}
              onPress={() => navigation.navigate('Events' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.tipBtnText}>Go to Events</Text>
              <MaterialIcons name="chevron-right" size={16} color="#3F7A54" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.taskFilterSummaryCard}>
            <Text style={styles.taskFilterSummaryTitle}>Current Task Filter</Text>
            <Text style={styles.taskFilterSummaryText}>
              {FILTER_OPTION_LABELS[filterStatus]} ({groupedFilteredTasks.length})
            </Text>
          </View>

          <View style={styles.taskListContent}>
            {renderTaskSectionCard(taskGroupsSection)}
          </View>
        </>
      )}
      </>
      ) : null}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={Boolean(selectedTaskSection)}
        onRequestClose={() => setSelectedTaskSection(null)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setSelectedTaskSection(null)}
            >
              <MaterialIcons name="close" size={28} color="#333" />
            </TouchableOpacity>

            <ScrollView style={styles.modalContent} contentContainerStyle={styles.sectionModalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalEyebrow}>
                  {selectedTaskSection?.eyebrow || 'Task List'}
                </Text>
                <Text style={styles.modalTitle}>{selectedTaskSection?.title || 'Items'}</Text>
                <Text style={styles.taskSectionModalDescription}>
                  {selectedTaskSection?.items.length
                    ? selectedTaskSection.subtitle
                    : selectedTaskSection?.emptyText || 'No items available.'}
                </Text>
              </View>

              {selectedTaskSection?.id === 'assigned-events' ? (
                <View style={styles.filterContainer}>
                  {(['All', 'Assigned', 'In Progress', 'Completed'] as const).map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[styles.filterButton, filterStatus === status && styles.filterButtonActive]}
                      onPress={() => setFilterStatus(status)}
                    >
                      <Text
                        style={[
                          styles.filterButtonText,
                          filterStatus === status && styles.filterButtonTextActive,
                        ]}
                      >
                        {FILTER_OPTION_LABELS[status]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {selectedTaskSection?.id === 'field-officer-events' ? (
                <View style={styles.fieldOfficerFilterRow}>
                  {(['All', 'Active', 'Upcoming', 'Completed'] as const).map(option => (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.fieldOfficerFilterButton,
                        fieldOfficerFilter === option && styles.fieldOfficerFilterButtonActive,
                      ]}
                      onPress={() => setFieldOfficerFilter(option)}
                    >
                      <Text
                        style={[
                          styles.fieldOfficerFilterButtonText,
                          fieldOfficerFilter === option && styles.fieldOfficerFilterButtonTextActive,
                        ]}
                      >
                        {option} ({fieldOfficerEventCounts[option]})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {selectedTaskSection?.id === 'assigned-events' ? (
                groupedFilteredTasks.length ? (
                  <View style={styles.taskListContent}>
                    {groupedFilteredTasks.map(group => renderTaskGroupCard(group))}
                  </View>
                ) : (
                  <View style={styles.fieldOfficerEmptyState}>
                    <Text style={styles.fieldOfficerEmptyTitle}>
                      {selectedTaskSection.emptyTitle}
                    </Text>
                    <Text style={styles.fieldOfficerEmptyText}>
                      {selectedTaskSection.emptyText}
                    </Text>
                  </View>
                )
              ) : null}

              {selectedTaskSection?.id === 'field-officer-events' ? (
                filteredFieldOfficerEvents.length ? (
                  <View style={styles.taskListContent}>
                    {filteredFieldOfficerEvents.map(eventProject => renderFieldOfficerEventCard(eventProject))}
                  </View>
                ) : (
                  <View style={styles.fieldOfficerEmptyState}>
                    <Text style={styles.fieldOfficerEmptyTitle}>
                      {selectedTaskSection.emptyTitle}
                    </Text>
                    <Text style={styles.fieldOfficerEmptyText}>
                      {selectedTaskSection.emptyText}
                    </Text>
                  </View>
                )
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={showTaskGroupDetails}
        onRequestClose={() => setShowTaskGroupDetails(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowTaskGroupDetails(false)}
            >
              <MaterialIcons name="close" size={28} color="#333" />
            </TouchableOpacity>

            {selectedTaskGroup ? (
              <ScrollView style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalEyebrow}>Event Task Page</Text>
                  <Text style={styles.modalTitle}>{selectedTaskGroup.projectTitle}</Text>
                  <Text style={styles.projectNameModal}>
                    {selectedTaskGroup.tasks.length} task{selectedTaskGroup.tasks.length === 1 ? '' : 's'} assigned in this event
                  </Text>
                </View>

                {selectedTaskGroupProject ? (
                  (() => {
                    const projectLogs = volunteerTimeLogs.filter(
                      log => log.projectId === selectedTaskGroup.projectId
                    );
                    const attendanceState = getTaskEventAttendanceState(
                      selectedTaskGroupProject,
                      true,
                      projectLogs
                    );

                    return (
                      <View style={styles.attendanceCard}>
                        <View style={styles.attendanceCardHeader}>
                          <View style={styles.attendanceCardCopy}>
                            <Text style={styles.attendanceCardTitle}>Daily Attendance</Text>
                            <Text style={styles.attendanceCardMeta}>
                              {formatEventDateLabel(
                                selectedTaskGroupProject.startDate,
                                selectedTaskGroupProject.endDate
                              )}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.attendanceStatusBadge,
                              attendanceState.hasConfirmedToday
                                ? styles.attendanceStatusBadgeActive
                                : styles.attendanceStatusBadgeIdle,
                            ]}
                          >
                            <Text style={styles.attendanceStatusText}>
                              {attendanceState.hasConfirmedToday
                                ? 'Confirmed'
                                : attendanceState.eventHasEnded
                                ? 'Closed'
                                : 'Ready'}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.attendanceHelperText}>
                          {attendanceState.helperText || 'Attendance is unavailable for this event.'}
                        </Text>

                        <View style={styles.attendanceLogRow}>
                          <View style={styles.attendanceLogItem}>
                            <Text style={styles.attendanceLogLabel}>Latest activity</Text>
                            <Text style={styles.attendanceLogValue}>
                              {attendanceState.latestLog
                                ? `Confirmed ${formatTimestamp(
                                    attendanceState.latestLog.attendanceConfirmedAt ||
                                      attendanceState.latestLog.timeIn
                                  )}`
                                : 'No attendance yet'}
                            </Text>
                          </View>
                          <View style={styles.attendanceLogItem}>
                            <Text style={styles.attendanceLogLabel}>Today</Text>
                            <Text style={styles.attendanceLogValue}>
                              {attendanceState.todayLog
                                ? `Confirmed ${formatTimestamp(
                                    attendanceState.todayLog.attendanceConfirmedAt ||
                                      attendanceState.todayLog.timeIn
                                  )}`
                                : attendanceState.hasConfirmedToday
                                ? 'Completed for today'
                                : 'Not started'}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.attendanceActionRow}>
                          <TouchableOpacity
                            style={[
                              styles.attendanceButton,
                              styles.timeInButton,
                              ((!attendanceState.canConfirmAttendance && !attendanceState.eventHasNotStarted) ||
                                actionLoadingKey === `attendance-${selectedTaskGroup.projectId}`) &&
                                styles.attendanceButtonDisabled,
                            ]}
                            onPress={() => void handleConfirmAttendanceForProject(selectedTaskGroup.projectId)}
                            disabled={
                              (!attendanceState.canConfirmAttendance && !attendanceState.eventHasNotStarted) ||
                              actionLoadingKey === `attendance-${selectedTaskGroup.projectId}`
                            }
                          >
                            {actionLoadingKey === `attendance-${selectedTaskGroup.projectId}` ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <ActivityIndicator size="small" color="#fff" />
                                <Text style={styles.attendanceButtonText}>Confirming Attendance...</Text>
                              </View>
                            ) : (
                              <>
                                <MaterialIcons name={attendanceState.eventHasNotStarted ? "photo-camera" : "verified-user"} size={18} color="#fff" />
                                <Text style={styles.attendanceButtonText}>
                                  {attendanceState.eventHasNotStarted
                                    ? 'Submit Photo'
                                    : attendanceState.hasConfirmedToday
                                    ? 'Done Today'
                                    : attendanceState.eventHasEnded
                                    ? 'Closed'
                                    : 'Confirm Attendance'}
                                </Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })()
                ) : null}

                <View style={styles.taskCardGrid}>
                  {selectedTaskGroup.tasks.map(item => (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.taskCard}
                      onPress={() => {
                        setSelectedTask(item);
                        setShowTaskGroupDetails(false);
                        setShowDetails(true);
                      }}
                    >
                      <View style={styles.taskCardHeader}>
                        <Text style={styles.taskTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                        <MaterialIcons name="open-in-full" size={16} color="#64748b" />
                      </View>

                      <Text style={styles.taskCardMetaLine} numberOfLines={1}>
                        {item.category}
                      </Text>

                      <View style={styles.taskCardBadgeRow}>
                        <View
                          style={[
                            styles.priorityBadge,
                            { backgroundColor: getPriorityColor(item.priority) },
                          ]}
                        >
                          <Text style={styles.priorityText}>{item.priority}</Text>
                        </View>
                        <View
                          style={[
                            styles.statusBadge,
                            styles.statusBadgeCompact,
                            { backgroundColor: getStatusColor(item.status) },
                          ]}
                        >
                          <Text style={styles.statusText}>{item.status}</Text>
                        </View>
                      </View>

                      <Text style={styles.taskCardSchedule} numberOfLines={2}>
                        {formatEventDateLabel(item.projectStartDate, item.projectEndDate)}
                      </Text>

                      <View style={styles.taskCardFooter}>
                        <Text style={styles.taskTapHintText}>Tap to open</Text>
                        <MaterialIcons name="chevron-right" size={16} color="#166534" />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={showDetails}
        onRequestClose={() => setShowDetails(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <View style={styles.modalTopBar}>
              <TouchableOpacity
                style={styles.modalNavButton}
                onPress={handleBackToTaskGroupDetails}
              >
                <MaterialIcons name="arrow-back" size={24} color="#333" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalNavButton}
                onPress={() => setShowDetails(false)}
              >
                <MaterialIcons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>

            {selectedTask && (
              <ScrollView style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalEyebrow}>Task Details</Text>
                  <Text style={styles.modalTitle}>{selectedTask.title}</Text>
                  <View style={styles.modalHeaderBadges}>
                    <View
                      style={[
                        styles.priorityBadgeLarge,
                        { backgroundColor: getPriorityColor(selectedTask.priority) },
                      ]}
                    >
                      <Text style={styles.priorityText}>{selectedTask.priority}</Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        styles.statusReadOnlyBadge,
                        styles.modalStatusBadge,
                        { backgroundColor: getStatusColor(selectedTask.status) },
                      ]}
                    >
                      <Text style={styles.statusText}>{selectedTask.status}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.detailOverviewGrid}>
                  <View style={styles.detailOverviewCard}>
                    <Text style={styles.detailOverviewLabel}>Event</Text>
                    <Text style={styles.detailOverviewValue}>{selectedTask.projectTitle}</Text>
                  </View>
                  <View style={styles.detailOverviewCard}>
                    <Text style={styles.detailOverviewLabel}>Schedule</Text>
                    <Text style={styles.detailOverviewValue}>
                      {formatEventDateLabel(selectedTask.projectStartDate, selectedTask.projectEndDate)}
                    </Text>
                  </View>
                  <View style={styles.detailOverviewCard}>
                    <Text style={styles.detailOverviewLabel}>Category</Text>
                    <Text style={styles.detailOverviewValue}>{selectedTask.category}</Text>
                  </View>
                  <View style={styles.detailOverviewCard}>
                    <Text style={styles.detailOverviewLabel}>Updated</Text>
                    <Text style={styles.detailOverviewValue}>
                      {new Date(selectedTask.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Event Name</Text>
                  <Text style={styles.infoValue}>{selectedTask.projectTitle}</Text>
                </View>

                {selectedTask.isFieldOfficer ? (
                  <View style={styles.fieldOfficerBadge}>
                    <MaterialIcons name="supervisor-account" size={16} color="#166534" />
                    <Text style={styles.fieldOfficerBadgeText}>Field Officer task</Text>
                  </View>
                ) : null}

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Task Category</Text>
                  <Text style={styles.infoValue}>{selectedTask.category}</Text>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Task Description</Text>
                  <Text style={styles.descriptionText}>{selectedTask.description}</Text>
                </View>

                {selectedTask.skillsNeeded && selectedTask.skillsNeeded.length > 0 && (
                  <View style={styles.infoSection}>
                    <Text style={styles.infoLabel}>Skills Needed</Text>
                    <Text style={styles.skillsText}>{selectedTask.skillsNeeded.join(', ')}</Text>
                  </View>
                )}

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Status Tracking</Text>
                  <Text style={styles.statusReadOnlyHint}>
                    System generated from assignment tracking and attendance logs. Volunteers cannot edit this status. Event status is also automatically updated based on event dates.
                  </Text>
                  <Text style={styles.descriptionText}>{selectedTask.statusTrackingNote}</Text>
                </View>

                <View style={styles.dateSection}>
                  <View style={styles.dateItem}>
                    <Text style={styles.dateLabel}>Created</Text>
                    <Text style={styles.dateValue}>
                      {new Date(selectedTask.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.dateItem}>
                    <Text style={styles.dateLabel}>Last Updated</Text>
                    <Text style={styles.dateValue}>
                      {new Date(selectedTask.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                {isFieldOfficerForSelectedEvent && selectedEventProject ? (
                  <View style={styles.infoSection}>
                    <Text style={styles.infoLabel}>Field Officer Controls</Text>
                    <Text style={styles.descriptionText}>
                      You can assign volunteers to tasks inside {selectedEventProject.title}.
                    </Text>
                    <TouchableOpacity
                      style={styles.manageBoardButton}
                      onPress={() => {
                        setSelectedManagedEventId(selectedEventProject.id);
                        setShowFieldOfficerBoard(true);
                      }}
                    >
                      <MaterialIcons name="assignment-ind" size={18} color="#fff" />
                      <Text style={styles.manageBoardButtonText}>Open Event Assignment Board</Text>
                    </TouchableOpacity>

                    <Text style={styles.fieldOfficerHintText}>
                      Joined volunteers: {joinedVolunteerOptions.length}. Open the board to assign or unassign event tasks.
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={showFieldOfficerBoard}
        onRequestClose={() => setShowFieldOfficerBoard(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowFieldOfficerBoard(false)}
            >
              <MaterialIcons name="close" size={28} color="#333" />
            </TouchableOpacity>

            {selectedManagedEvent ? (
              <ScrollView style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{selectedManagedEvent.title}</Text>
                  <View style={styles.fieldOfficerBadge}>
                    <MaterialIcons name="supervisor-account" size={16} color="#166534" />
                    <Text style={styles.fieldOfficerBadgeText}>Field Officer Assignment Board</Text>
                  </View>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Event Schedule</Text>
                  <Text style={styles.infoValue}>
                    {formatEventDateLabel(selectedManagedEvent.startDate, selectedManagedEvent.endDate)}
                  </Text>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Location</Text>
                  <Text style={styles.descriptionText}>{selectedManagedEvent.location.address}</Text>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Joined Volunteers</Text>
                  <View style={styles.assignmentButtonGroup}>
                    {managedEventVolunteerOptions.length ? (
                      managedEventVolunteerOptions.map(volunteer => (
                        <View key={`joined-${volunteer.id}`} style={styles.joinedVolunteerChip}>
                          <MaterialIcons name="person" size={14} color="#166534" />
                          <Text style={styles.joinedVolunteerChipText}>{volunteer.name}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.descriptionText}>
                        No volunteers have joined this event yet.
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Attendance Checker</Text>
                  <Text style={styles.descriptionText}>
                    Review attendance uploads for this event here. Only the assigned field officer can mark each record.
                  </Text>

                  <TouchableOpacity
                    style={styles.attendanceDateDropdownTrigger}
                    onPress={() => setShowManagedAttendanceDateDropdown(true)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.attendanceDateDropdownText}>
                      {new Date(`${resolvedManagedAttendanceDateKey}T00:00:00`).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                    <MaterialIcons name="arrow-drop-down" size={20} color="#166534" />
                  </TouchableOpacity>

                  <Modal
                    visible={showManagedAttendanceDateDropdown}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setShowManagedAttendanceDateDropdown(false)}
                  >
                    <Pressable style={styles.dropdownBackdrop} onPress={() => setShowManagedAttendanceDateDropdown(false)}>
                      <View style={styles.dropdownCard}>
                        <ScrollView>
                          {managedEventAttendanceDateKeys.map(dateKey => (
                            <TouchableOpacity
                              key={`managed-attendance-date-${dateKey}`}
                              style={[
                                styles.dropdownItem,
                                resolvedManagedAttendanceDateKey === dateKey && styles.dropdownItemActive,
                              ]}
                              onPress={() => {
                                setSelectedManagedAttendanceDateKey(dateKey);
                                setShowManagedAttendanceDateDropdown(false);
                              }}
                              activeOpacity={0.85}
                            >
                              <Text
                                style={[
                                  styles.dropdownItemText,
                                  resolvedManagedAttendanceDateKey === dateKey && styles.dropdownItemTextActive,
                                ]}
                              >
                                {new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </Pressable>
                  </Modal>

                  <View style={styles.attendanceBoardSummaryRow}>
                    <View style={styles.attendanceBoardSummaryCard}>
                      <Text style={styles.attendanceBoardSummaryLabel}>Selected Day</Text>
                      <Text style={styles.attendanceBoardSummaryValue}>
                        {new Date(`${resolvedManagedAttendanceDateKey}T00:00:00`).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View style={styles.attendanceBoardSummaryCard}>
                      <Text style={styles.attendanceBoardSummaryLabel}>Uploads</Text>
                      <Text style={styles.attendanceBoardSummaryValue}>{managedEventSelectedDateUploadCount}</Text>
                    </View>
                    <View style={styles.attendanceBoardSummaryCard}>
                      <Text style={styles.attendanceBoardSummaryLabel}>Marked</Text>
                      <Text style={styles.attendanceBoardSummaryValue}>{managedEventSelectedDateCheckedCount}</Text>
                    </View>
                  </View>

                  {managedEventAttendanceEntries.length ? (
                    managedEventAttendanceEntries.map(entry => {
                      const isExpanded = expandedAttendancePhotos.has(entry.volunteer.id);
                      
                      return (
                        <View key={`attendance-${entry.volunteer.id}`} style={styles.attendanceReviewCard}>
                          <TouchableOpacity
                            style={styles.assignmentHeader}
                            onPress={() => {
                              setExpandedAttendancePhotos(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(entry.volunteer.id)) {
                                  newSet.delete(entry.volunteer.id);
                                } else {
                                  newSet.add(entry.volunteer.id);
                                }
                                return newSet;
                              });
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={styles.assignmentCopy}>
                              <Text style={styles.assignmentTitle}>{entry.volunteer.name}</Text>
                              <Text style={styles.assignmentMeta}>
                                {entry.volunteer.email || 'No email on file'}
                              </Text>
                              <Text style={styles.assignmentMeta}>
                                Selected day records: {entry.logs.length}
                              </Text>
                            </View>
                            <View style={styles.attendanceReviewStatusBadge}>
                              <MaterialIcons name="verified-user" size={16} color="#166534" />
                              <Text style={styles.attendanceReviewStatusBadgeText}>
                                {entry.logs.some(log => Boolean(log.attendanceCheckedAt))
                                  ? 'Marked'
                                  : entry.logs.length
                                  ? 'Needs Review'
                                  : 'No Upload'}
                              </Text>
                            </View>
                            <MaterialIcons 
                              name={isExpanded ? "keyboard-arrow-up" : "keyboard-arrow-down"} 
                              size={24} 
                              color="#64748b" 
                            />
                          </TouchableOpacity>

                          {entry.logs.length ? (
                            entry.logs.map(log => (
                              <View key={log.id} style={styles.attendanceReviewLogCard}>
                                <Text style={styles.attendanceReviewLabel}>Confirmed At</Text>
                                <Text style={styles.attendanceReviewValue}>
                                  {formatTimestamp(log.attendanceConfirmedAt || log.timeIn)}
                                </Text>
                                <Text style={styles.attendanceReviewLabel}>Marked Status</Text>
                                <Text style={styles.attendanceReviewValue}>
                                  {log.attendanceCheckedAt
                                    ? `Marked by ${log.attendanceCheckedByName || 'Field Officer'} on ${formatTimestamp(
                                        log.attendanceCheckedAt
                                      )}`
                                    : 'Not marked yet'}
                                </Text>

                                {isExpanded && (
                                  <>
                                    {(log.attendancePhoto || log.completionPhoto) &&
                                    isImageMediaUri(log.attendancePhoto || log.completionPhoto) ? (
                                      <Image
                                        source={{ uri: log.attendancePhoto || log.completionPhoto || '' }}
                                        style={styles.attendanceReviewImage}
                                        resizeMode="cover"
                                      />
                                    ) : (
                                      <Text style={styles.attendanceReviewEmptyPhoto}>No photo available</Text>
                                    )}
                                  </>
                                )}

                                <TouchableOpacity
                                  style={[
                                    styles.attendanceReviewButton,
                                    log.attendanceCheckedAt && styles.attendanceReviewButtonActive,
                                  ]}
                                  onPress={() =>
                                    void handleToggleAttendanceCheck(log, !Boolean(log.attendanceCheckedAt))
                                  }
                                  activeOpacity={0.85}
                                >
                                  {actionLoadingKey === `attendance-check-${log.id}` ? (
                                    <ActivityIndicator size="small" color="#ffffff" />
                                  ) : (
                                    <Text style={styles.attendanceReviewButtonText}>
                                      {log.attendanceCheckedAt ? 'Remove Mark' : 'Mark Attendance'}
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              </View>
                            ))
                          ) : (
                            <Text style={styles.fieldOfficerHintText}>
                              No attendance upload yet for this volunteer.
                            </Text>
                          )}
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.fieldOfficerHintText}>
                      No joined volunteers are available for attendance marking yet.
                    </Text>
                  )}
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Volunteer Task Assignments</Text>
                  <Text style={styles.descriptionText}>
                    Open one task card at a time to manage assignments. Single tap a volunteer to assign. Tap an assigned volunteer again to remove.
                  </Text>
                  <TouchableOpacity
                    style={styles.sectionSummaryCard}
                    activeOpacity={0.88}
                    onPress={() => setShowManagedTaskAssignments(current => !current)}
                  >
                    <View style={styles.sectionSummaryHeader}>
                      <View style={styles.sectionSummaryHeaderCopy}>
                        <Text style={styles.sectionSummaryEyebrow}>Assignments</Text>
                        <Text style={styles.sectionSummaryTitle}>Volunteer Task Assignments</Text>
                      </View>
                      <View style={styles.sectionSummaryCountBadge}>
                        <Text style={styles.sectionSummaryCountText}>
                          {(selectedManagedEvent.internalTasks || []).length} task{(selectedManagedEvent.internalTasks || []).length === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.sectionSummarySubtitle}>
                      Tap to {showManagedTaskAssignments ? 'hide' : 'open'} the task assignment details for this event.
                    </Text>

                    <View style={styles.sectionSummaryFooter}>
                      <Text style={styles.sectionSummaryFooterText}>
                        {showManagedTaskAssignments ? 'Tap to collapse details' : 'Tap to view details'}
                      </Text>
                      <MaterialIcons
                        name={showManagedTaskAssignments ? 'expand-less' : 'chevron-right'}
                        size={18}
                        color="#166534"
                      />
                    </View>
                  </TouchableOpacity>

                  {showManagedTaskAssignments ? (
                    (selectedManagedEvent.internalTasks || []).map(eventTask => (
                      <TouchableOpacity
                        key={eventTask.id}
                        style={styles.assignmentCard}
                        activeOpacity={0.88}
                        onPress={() =>
                          setExpandedManagedTaskId(current => (current === eventTask.id ? null : eventTask.id))
                        }
                      >
                        <View style={styles.assignmentHeader}>
                          <View style={styles.assignmentCopy}>
                            <Text style={styles.assignmentTitle}>{eventTask.title}</Text>
                            <Text style={styles.assignmentMeta}>
                              {getTaskAssignedVolunteerNames(eventTask).length
                                ? getTaskAssignedVolunteerNames(eventTask).join(', ')
                                : 'Unassigned'}
                            </Text>
                            <Text style={styles.assignmentMeta}>{eventTask.status}</Text>
                          </View>
                          <View style={styles.assignmentHeaderActions}>
                            {eventTask.isFieldOfficer ? (
                              <View style={styles.assignmentLockBadge}>
                                <MaterialIcons name="lock" size={14} color="#92400e" />
                                <Text style={styles.assignmentLockText}>Admin controlled</Text>
                              </View>
                            ) : (
                              <View style={styles.assignmentCountBadge}>
                                <Text style={styles.assignmentCountBadgeText}>
                                  {getTaskAssignedVolunteerIds(eventTask).length} assigned
                                </Text>
                              </View>
                            )}
                            <MaterialIcons
                              name={expandedManagedTaskId === eventTask.id ? 'expand-less' : 'expand-more'}
                              size={20}
                              color="#166534"
                            />
                          </View>
                        </View>

                        {expandedManagedTaskId === eventTask.id ? (
                          eventTask.isFieldOfficer ? (
                            <Text style={styles.fieldOfficerHintText}>
                              This task marks the volunteer who manages the event team.
                            </Text>
                          ) : (
                            <View style={styles.assignmentDetailsPanel}>
                              <Text style={styles.assignmentDetailLabel}>Task Description</Text>
                              <Text style={styles.descriptionText}>
                                {eventTask.description || 'No task description provided.'}
                              </Text>
                              <Text style={styles.assignmentDetailLabel}>Assigned Volunteers</Text>
                              <Text style={styles.assignmentMeta}>
                                {getTaskAssignedVolunteerNames(eventTask).length
                                  ? getTaskAssignedVolunteerNames(eventTask).join(', ')
                                  : 'No volunteers assigned yet.'}
                              </Text>
                              <View style={styles.assignmentButtonGroup}>
                                {managedEventVolunteerOptions.map(volunteer => {
                                  const isAssigned = isVolunteerAssignedToTask(eventTask, volunteer.id);
                                  return (
                                    <TouchableOpacity
                                      key={`${eventTask.id}-${volunteer.id}`}
                                      style={[
                                        styles.assignmentButton,
                                        isAssigned && styles.assignmentButtonActive,
                                      ]}
                                      onPress={() => handleTaskVolunteerChipPress(eventTask, volunteer)}
                                    >
                                      <Text
                                        style={[
                                          styles.assignmentButtonText,
                                          isAssigned && styles.assignmentButtonTextActive,
                                        ]}
                                      >
                                        {volunteer.name}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                              <Text style={styles.fieldOfficerHintText}>
                                Single tap adds the volunteer. Tap an assigned volunteer chip again to remove that volunteer from this task.
                              </Text>
                            </View>
                          )
                        ) : (
                          <View style={styles.assignmentCardFooter}>
                            <Text style={styles.fieldOfficerHintText}>Tap to open assignment details</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))
                  ) : null}
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF5E9',
  },
  attendanceNoticeOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 40,
    alignItems: 'center',
  },
  attendanceNoticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  attendanceNoticeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'transparent',
  },
  headerTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 23,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    color: '#5B564C',
    lineHeight: 18,
  },
  topTabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  topTabButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  topTabButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  topTabButtonText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  topTabButtonTextActive: {
    color: '#ffffff',
  },
  topTabBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTabBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  topTabBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  topTabBadgeTextActive: {
    color: '#ffffff',
  },
  fieldOfficerSection: {
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  fieldOfficerSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  fieldOfficerSectionTitleWrap: {
    flex: 1,
  },
  fieldOfficerSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldOfficerSectionSubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  fieldOfficerSectionBadge: {
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  fieldOfficerSectionBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  fieldOfficerFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fieldOfficerFilterButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fieldOfficerFilterButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  fieldOfficerFilterButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  fieldOfficerFilterButtonTextActive: {
    color: '#ffffff',
  },
  fieldOfficerSectionSummary: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  fieldOfficerEventCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 10,
    gap: 8,
  },
  fieldOfficerEventTopRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  fieldOfficerEventCopy: {
    flex: 1,
    gap: 3,
  },
  fieldOfficerEventTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  fieldOfficerEventTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldOfficerEventStatusBadge: {
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fieldOfficerEventStatusText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#166534',
  },
  fieldOfficerEventProgram: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  fieldOfficerEventMeta: {
    fontSize: 10,
    lineHeight: 14,
    color: '#64748b',
  },
  fieldOfficerMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  fieldOfficerMetricCard: {
    minWidth: 80,
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  fieldOfficerMetricValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  fieldOfficerMetricLabel: {
    marginTop: 1,
    fontSize: 9,
    color: '#64748b',
  },
  fieldOfficerOpenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
  },
  fieldOfficerOpenText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  fieldOfficerEmptyState: {
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  fieldOfficerEmptyTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldOfficerEmptyText: {
    fontSize: 10,
    lineHeight: 14,
    color: '#64748b',
  },
  fieldOfficerToggleButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  fieldOfficerToggleButtonText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  taskSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 2,
  },
  taskSummaryCard: {
    width: '23%',
    flexGrow: 0,
    flexShrink: 1,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7e3dc',
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  taskSummaryIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    marginBottom: 5,
  },
  taskSummaryValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#166534',
    textAlign: 'center',
  },
  taskSummaryLabel: {
    marginTop: 2,
    fontSize: 7,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    lineHeight: 9,
    textAlign: 'center',
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  inlineErrorWrap: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  filterContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe5ef',
  },
  filterButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  filterButtonText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: '#666',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  taskList: {
    minHeight: 200,
  },
  taskListContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  taskFilterSummaryCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7e3dc',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  taskFilterSummaryTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  taskFilterSummaryText: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  taskGroupCard: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe5ef',
    padding: 10,
    gap: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  taskGroupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  taskGroupIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  taskGroupCopy: {
    flex: 1,
  },
  taskGroupEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
    marginBottom: 4,
  },
  taskGroupTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  taskGroupMeta: {
    marginTop: 4,
    fontSize: 10,
    color: '#64748b',
  },
  taskGroupBadge: {
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe5ef',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  taskGroupBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#334155',
  },
  taskGroupMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  taskGroupMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  taskGroupMetaChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#334155',
  },
  taskGroupStatRow: {
    flexDirection: 'row',
    gap: 6,
  },
  taskGroupStatCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    minHeight: 48,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskGroupStatValue: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800',
    color: '#166534',
    textAlign: 'center',
  },
  taskGroupStatLabel: {
    marginTop: 2,
    fontSize: 8,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.12,
    lineHeight: 10,
    textAlign: 'center',
  },
  taskGroupFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 2,
    paddingTop: 2,
  },
  taskGroupFooterText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  attendanceCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d9f99d',
    backgroundColor: '#f7fee7',
    padding: 10,
    gap: 8,
  },
  attendanceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  attendanceCardCopy: {
    flex: 1,
  },
  attendanceCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#14532d',
  },
  attendanceCardMeta: {
    marginTop: 3,
    fontSize: 11,
    color: '#4b5563',
  },
  attendanceStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attendanceStatusBadgeActive: {
    backgroundColor: '#166534',
  },
  attendanceStatusBadgeDone: {
    backgroundColor: '#15803d',
  },
  attendanceStatusBadgeIdle: {
    backgroundColor: '#65a30d',
  },
  attendanceStatusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ffffff',
  },
  attendanceHelperText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#475569',
  },
  attendanceLogRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  attendanceLogItem: {
    flex: 1,
    minWidth: 150,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9f99d',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attendanceLogLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  attendanceLogValue: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
    color: '#0f172a',
  },
  attendanceActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attendanceButton: {
    minHeight: 38,
    minWidth: 120,
    flexGrow: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  timeInButton: {
    backgroundColor: '#166534',
  },
  timeOutButton: {
    backgroundColor: '#0f766e',
  },
  attendanceButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  attendanceButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  taskCard: {
    backgroundColor: '#ffffff',
    width: '100%',
    minHeight: 132,
    borderRadius: 16,
    padding: 11,
    borderWidth: 1,
    borderColor: '#dbe5ef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  taskCardGrid: {
    gap: 10,
  },
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
    gap: 6,
  },
  taskTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  taskCardMetaLine: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
  },
  priorityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  projectName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4CAF50',
    marginBottom: 4,
  },
  taskMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  taskCardBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  taskMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  taskMetaChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  taskCategory: {
    fontSize: 12,
    color: '#999',
    marginBottom: 12,
  },
  taskCardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: 'auto',
  },
  taskCardSchedule: {
    fontSize: 10,
    lineHeight: 14,
    color: '#475569',
    marginBottom: 8,
  },
  taskUpdatedText: {
    flex: 1,
    fontSize: 11,
    color: '#64748b',
  },
  taskTapHintText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusBadgeCompact: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
  },
  statusReadOnlyBadge: {
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingVertical: 20,
    minHeight: '70%',
    maxHeight: '90%',
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  modalNavButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  modalContent: {
    paddingHorizontal: 20,
  },
  sectionModalContent: {
    paddingBottom: 18,
  },
  modalHeader: {
    marginBottom: 16,
  },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 12,
  },
  taskSectionModalDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  modalHeaderBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityBadgeLarge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  modalStatusBadge: {
    marginBottom: 0,
  },
  projectNameModal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4CAF50',
    marginBottom: 20,
  },
  detailOverviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  detailOverviewCard: {
    width: '47.8%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbe5ef',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  detailOverviewLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  detailOverviewValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 16,
  },
  fieldOfficerBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 20,
  },
  fieldOfficerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  infoSection: {
    marginBottom: 20,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    marginBottom: 6,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  descriptionText: {
    fontSize: 13,
    color: '#333',
    lineHeight: 20,
  },
  statusReadOnlyHint: {
    marginBottom: 6,
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  skillsText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
  },
  manageBoardButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  manageBoardButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  fieldOfficerHintText: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  attendanceDatePickerRow: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 4,
    paddingRight: 8,
  },
  attendanceDateChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#9fb4a6',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  attendanceDateChipActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  attendanceDateChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  attendanceDateChipTextActive: {
    color: '#ffffff',
  },
  attendanceDateDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe5ef',
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  attendanceDateDropdownText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dropdownCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: '60%',
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e6eef0',
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownItemActive: {
    backgroundColor: '#ecfdf5',
  },
  dropdownItemText: {
    fontSize: 13,
    color: '#0f172a',
  },
  dropdownItemTextActive: {
    color: '#166534',
    fontWeight: '800',
  },
  attendanceBoardSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  attendanceBoardSummaryCard: {
    minWidth: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe5ef',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attendanceBoardSummaryLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
    marginBottom: 4,
  },
  attendanceBoardSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  statusButtonGroup: {
    flexDirection: 'row',
    gap: 10,
  },
  statusButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: '#f9f9f9',
    alignItems: 'center',
  },
  statusButtonActive: {
    backgroundColor: '#e8f5e9',
  },
  statusButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  statusButtonTextActive: {
    color: '#10b981',
  },
  dateSection: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  dateItem: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  assignmentCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#dbe7df',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#f8fafc',
  },
  attendanceReviewCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#b8cabc',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#f8fafc',
  },
  attendanceReviewStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attendanceReviewStatusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  attendanceReviewLogCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#dbe5ef',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#ffffff',
  },
  attendanceReviewLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
    marginBottom: 4,
  },
  attendanceReviewValue: {
    fontSize: 12,
    lineHeight: 18,
    color: '#0f172a',
    marginBottom: 10,
  },
  attendanceReviewImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    marginBottom: 12,
  },
  attendanceReviewEmptyPhoto: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },
  attendanceReviewButton: {
    borderRadius: 12,
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceReviewButtonActive: {
    backgroundColor: '#0f766e',
  },
  attendanceReviewButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  assignmentTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  assignmentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  assignmentHeaderActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  assignmentCopy: {
    flex: 1,
  },
  assignmentMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
  },
  assignmentLockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assignmentLockText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  assignmentCountBadge: {
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assignmentCountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  assignmentDetailsPanel: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#dbe7df',
    paddingTop: 12,
  },
  assignmentDetailLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
    marginBottom: 4,
  },
  assignmentCardFooter: {
    marginTop: 6,
  },
  assignmentButtonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  assignmentButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  assignmentButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  assignmentButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  assignmentButtonTextActive: {
    color: '#fff',
  },
  joinedVolunteerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  joinedVolunteerChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  emptyCardContainer: {
    marginHorizontal: 16,
    marginTop: 18,
    gap: 16,
    paddingBottom: 24,
  },
  emptyStateCard: {
    backgroundColor: 'rgba(63,122,84,0.03)',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  emptyIllustrationWrap: {
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 20,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    color: '#5B564C',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  emptyStateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3F7A54',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 100,
  },
  emptyStateBtnText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13.5,
  },
  tipCard: {
    backgroundColor: '#F2E9D8',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tipIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#6B8F71',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipContent: {
    flex: 1,
  },
  tipTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 2,
  },
  tipDesc: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 11.5,
    color: '#5B564C',
    lineHeight: 15,
  },
  tipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 100,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#DED2B4',
  },
  tipBtnText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#3F7A54',
    fontWeight: '700',
    fontSize: 11.5,
    marginRight: 2,
  },
});
