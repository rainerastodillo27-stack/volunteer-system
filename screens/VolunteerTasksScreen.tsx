import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllVolunteers,
  getAllProjects,
  getAllVolunteerTimeLogs,
  getVolunteerByUserId,
  getVolunteerProjectJoinRecords,
  getVolunteerTimeLogs,
  subscribeToStorageChanges,
  saveEvent,
  startVolunteerTimeLog,
  notifyVolunteerAboutTaskUnassignment,
  notifyVolunteerAboutTaskUpdate,
} from '../models/storage';
import {
  Project,
  ProjectInternalTask,
  Volunteer,
  VolunteerProjectJoinRecord,
  VolunteerTimeLog,
} from '../models/types';
import { getProjectDisplayStatus } from '../utils/projectStatus';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

type AssignedTask = ProjectInternalTask & {
  projectId: string;
  projectTitle: string;
  projectStartDate: string;
  projectEndDate: string;
  statusTrackingNote: string;
};
type FieldOfficerFilter = 'All' | 'Active' | 'Upcoming' | 'Completed';
type TaskScreenTab = 'My Tasks' | 'Manage Assignments';

type TaskEventAttendanceState = {
  activeLog: VolunteerTimeLog | null;
  latestLog: VolunteerTimeLog | null;
  canTimeIn: boolean;
  canTimeOut: boolean;
  eventHasNotStarted: boolean;
  eventHasEnded: boolean;
  hasLoggedToday: boolean;
  helperText: string;
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

function hasEventStartedForToday(startValue?: string, now: Date = new Date()): boolean {
  if (!startValue) {
    return true;
  }

  const startDate = new Date(startValue);
  if (Number.isNaN(startDate.getTime())) {
    return true;
  }

  const startDay = new Date(startDate);
  startDay.setHours(0, 0, 0, 0);
  return now >= startDay;
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

function getTrackedTaskStatus(
  task: ProjectInternalTask,
  project: Project,
  joinRecord: VolunteerProjectJoinRecord | undefined,
  timeLogs: VolunteerTimeLog[]
): Pick<AssignedTask, 'status' | 'updatedAt' | 'statusTrackingNote'> {
  if (!task.assignedVolunteerId) {
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
    log => !log.timeOut && getLocalDateKey(log.timeIn) === todayKey
  );
  if (activeLog) {
    return {
      status: 'In Progress',
      updatedAt: activeLog.timeIn,
      statusTrackingNote: 'In progress while you have an active time-in for this event.',
    };
  }

  const latestCompletedLog = timeLogs
    .filter(log => Boolean(log.timeOut))
    .sort(
      (left, right) =>
        new Date(right.timeOut || right.timeIn).getTime() -
        new Date(left.timeOut || left.timeIn).getTime()
    )[0];
  if (latestCompletedLog?.timeOut) {
    const projectEnded = hasEventEndedForToday(project.endDate || project.startDate);
    if (!projectEnded && !['Completed', 'Cancelled'].includes(getProjectDisplayStatus(project))) {
      return {
        status: 'Assigned',
        updatedAt: latestCompletedLog.timeOut,
        statusTrackingNote: 'Attendance was saved for today. You can time in again on the next event day.',
      };
    }

    return {
      status: 'Completed',
      updatedAt: latestCompletedLog.timeOut,
      statusTrackingNote: 'Completed automatically after your latest timed-out attendance log.',
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
  const activeLog =
    sortedLogs.find(log => !log.timeOut && getLocalDateKey(log.timeIn) === todayKey) || null;
  const latestLog = sortedLogs[0] || null;
  const hasLoggedToday = sortedLogs.some(log => getLocalDateKey(log.timeIn) === todayKey);
  const eventHasNotStarted = !hasEventStartedForToday(project.startDate);
  const lifecycleStatus = getProjectDisplayStatus(project);
  const eventHasEnded =
    hasEventEndedForToday(project.endDate || project.startDate) ||
    lifecycleStatus === 'Completed' ||
    lifecycleStatus === 'Cancelled';
  const canTimeIn = isAssigned && !activeLog && !hasLoggedToday && !eventHasNotStarted && !eventHasEnded;
  const canTimeOut = Boolean(activeLog);

  let helperText = 'Attendance is ready for today.';
  if (!isAssigned) {
    helperText = 'You need an assigned task before attendance opens for this event.';
  } else if (activeLog) {
    helperText = 'You are timed in for today. Submit your My Event Report to finish time out.';
  } else if (eventHasNotStarted) {
    helperText = 'Time in unlocks on the event start date.';
  } else if (eventHasEnded) {
    helperText = 'Attendance is closed because the event timeline already ended.';
  } else if (hasLoggedToday) {
    helperText = 'Today is already recorded. Attendance will refresh on the next event day.';
  }

  return {
    activeLog,
    latestLog,
    canTimeIn,
    canTimeOut,
    eventHasNotStarted,
    eventHasEnded,
    hasLoggedToday,
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
    if (!project.internalTasks || !Array.isArray(project.internalTasks)) {
      return;
    }

    project.internalTasks.forEach(task => {
      if (task.assignedVolunteerId === volunteerProfile.id) {
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
  const [filterStatus, setFilterStatus] = useState<'All' | 'Assigned' | 'In Progress' | 'Completed'>('All');
  const [fieldOfficerFilter, setFieldOfficerFilter] = useState<FieldOfficerFilter>('All');
  const [showAllFieldOfficerEvents, setShowAllFieldOfficerEvents] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskScreenTab>('My Tasks');

  const tasksLoadInFlightRef = useRef<Promise<void> | null>(null);
  const tasksReloadQueuedRef = useRef(false);

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

      // Load projects and current volunteer quickly; defer full volunteer list
      const [projects, currentVolunteerProfile] = await Promise.all([
        getAllProjects(),
        getVolunteerByUserId(user.id),
      ]);
      setAllProjects(projects);
      setVolunteerProfile(currentVolunteerProfile || null);

      // defer loading full volunteers list
      setAllVolunteers([]);
      setTimeout(async () => {
        try {
          const volunteers = await getAllVolunteers();
          setAllVolunteers(volunteers);
        } catch {}
      }, 50);

      let nextVolunteerTimeLogs: VolunteerTimeLog[] = [];
      let nextAllVolunteerTimeLogs: VolunteerTimeLog[] = [];
      let nextVolunteerJoinRecords: VolunteerProjectJoinRecord[] = [];

      if (currentVolunteerProfile) {
        const assignedProjectIds = Array.from(
          new Set(
            projects
              .filter(project =>
                (project.internalTasks || []).some(
                  task => task.assignedVolunteerId === currentVolunteerProfile.id
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

  const handleTimeInForProject = async (projectId: string) => {
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

    if (!attendanceState.canTimeIn) {
      Alert.alert('Attendance Unavailable', attendanceState.helperText);
      return;
    }

    try {
      await startVolunteerTimeLog(volunteerProfile.id, projectId);
      await loadVolunteerTasksCoalesced();
      Alert.alert('Time In recorded', 'Your attendance for today is now active.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, 'Unable to time in'),
        getRequestErrorMessage(error, 'Please try again.')
      );
    }
  };

  const handleOpenTimeOutReport = (projectId: string) => {
    const todayKey = getLocalDateKey();
    const activeLog = volunteerTimeLogs.find(
      log =>
        log.projectId === projectId &&
        !log.timeOut &&
        getLocalDateKey(log.timeIn) === todayKey
    );
    if (!activeLog) {
      Alert.alert('No active attendance', 'Time in first before opening the time out report.');
      return;
    }

    navigateToAvailableRoute(navigation, 'Reports', {
      projectId,
      autoOpenUpload: true,
      completionReport: activeLog.completionReport,
      completionPhoto: activeLog.completionPhoto,
    });
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
            task => task.isFieldOfficer && task.assignedVolunteerId === volunteerProfile.id
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
      task => task.isFieldOfficer && task.assignedVolunteerId === volunteerProfile.id
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

  const handleAssignEventTask = async (
    eventProject: Project | null,
    taskId: string,
    volunteerId?: string
  ) => {
    if (!eventProject || !volunteerProfile) {
      return;
    }

    try {
      const isFieldOfficerForEvent = (eventProject.internalTasks || []).some(
        task => task.isFieldOfficer && task.assignedVolunteerId === volunteerProfile.id
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
      const previouslyAssignedVolunteer =
        currentTask?.assignedVolunteerId && currentTask.assignedVolunteerId !== volunteerId
          ? assignableVolunteers.find(volunteer => volunteer.id === currentTask.assignedVolunteerId) || null
          : null;
      const shouldNotifyAssignedVolunteer = Boolean(
        assignedVolunteer &&
        currentTask &&
        currentTask.assignedVolunteerId !== assignedVolunteer.id
      );

      const updatedTasks = (eventProject.internalTasks || []).map(task => {
        if (task.id !== taskId) {
          return task;
        }

        if (task.isFieldOfficer) {
          return task;
        }

        const nextStatus =
          volunteerId && task.status === 'Unassigned'
            ? 'Assigned'
            : !volunteerId
            ? 'Unassigned'
            : task.status;

        return {
          ...task,
          assignedVolunteerId: volunteerId || undefined,
          assignedVolunteerName: assignedVolunteer?.name || undefined,
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
      if (currentTask && previouslyAssignedVolunteer) {
        notificationTasks.push(notifyVolunteerAboutTaskUnassignment({
          event: eventProject,
          task: currentTask,
          volunteer: previouslyAssignedVolunteer,
          actorUserId: user?.id,
        }));
      }
      if (currentTask && assignedVolunteer && shouldNotifyAssignedVolunteer) {
        notificationTasks.push(notifyVolunteerAboutTaskUpdate({
          event: eventProject,
          task: {
            ...currentTask,
            status:
              volunteerId && currentTask.status === 'Unassigned'
                ? 'Assigned'
                : currentTask.status,
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
      void loadVolunteerTasks();
      const actionLabel = volunteerId ? 'assigned' : 'unassigned';
      setShowFieldOfficerBoard(false);
      setShowDetails(false);
      Alert.alert('Saved', `Event task ${actionLabel}.`);
    } catch (error) {
      console.error('Error assigning event task:', error);
      Alert.alert('Error', 'Failed to update the event task assignment.');
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
  const filterOptionLabels: Record<'All' | 'Assigned' | 'In Progress' | 'Completed', string> = {
    All: 'All',
    Assigned: 'Assigned',
    'In Progress': 'In Progress',
    Completed: 'Completed',
  };
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
  const visibleFieldOfficerEvents = useMemo(
    () => (showAllFieldOfficerEvents ? filteredFieldOfficerEvents : filteredFieldOfficerEvents.slice(0, 3)),
    [filteredFieldOfficerEvents, showAllFieldOfficerEvents]
  );
  const hiddenFieldOfficerEventCount = Math.max(
    filteredFieldOfficerEvents.length - visibleFieldOfficerEvents.length,
    0
  );
  const assignedCount = tasks.filter(task => task.status === 'Assigned').length;
  const inProgressCount = tasks.filter(task => task.status === 'In Progress').length;
  const completedCount = tasks.filter(task => task.status === 'Completed').length;
  const groupedFilteredTasks = useMemo(() => {
    const groups = new Map<string, { projectId: string; projectTitle: string; tasks: AssignedTask[] }>();

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

  const handleBackToTaskGroupDetails = () => {
    setShowDetails(false);
    if (selectedTaskGroupProjectId) {
      setShowTaskGroupDetails(true);
    }
  };

  useEffect(() => {
    setShowAllFieldOfficerEvents(false);
  }, [fieldOfficerFilter, fieldOfficerEvents.length]);

  useEffect(() => {
    if (!hasFieldOfficerAccess && activeTab === 'Manage Assignments') {
      setActiveTab('My Tasks');
    }
  }, [activeTab, hasFieldOfficerAccess]);

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

          <Text style={styles.fieldOfficerSectionSummary}>
            Showing {visibleFieldOfficerEvents.length} of {filteredFieldOfficerEvents.length} event
            {filteredFieldOfficerEvents.length === 1 ? '' : 's'} in this view.
          </Text>

          {visibleFieldOfficerEvents.map(eventProject => {
            const eventTasks = eventProject.internalTasks || [];
            const assignableTasks = eventTasks.filter(task => !task.isFieldOfficer);
            const assignedTaskCount = assignableTasks.filter(task => task.assignedVolunteerId).length;
            const unassignedTaskCount = assignableTasks.length - assignedTaskCount;
            const parentProgramTitle = eventProject.parentProjectId
              ? parentProjectTitleById.get(eventProject.parentProjectId)
              : null;
            const eventBucket = getFieldOfficerEventBucket(eventProject);

            return (
              <TouchableOpacity
                key={eventProject.id}
                style={styles.fieldOfficerEventCard}
                onPress={() => {
                  setSelectedManagedEventId(eventProject.id);
                  setShowFieldOfficerBoard(true);
                }}
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
          })}

          {filteredFieldOfficerEvents.length === 0 ? (
            <View style={styles.fieldOfficerEmptyState}>
              <Text style={styles.fieldOfficerEmptyTitle}>No events in this filter</Text>
              <Text style={styles.fieldOfficerEmptyText}>
                Try another filter to review the rest of your field officer events.
              </Text>
            </View>
          ) : null}

          {hiddenFieldOfficerEventCount > 0 ? (
            <TouchableOpacity
              style={styles.fieldOfficerToggleButton}
              onPress={() => setShowAllFieldOfficerEvents(true)}
            >
              <Text style={styles.fieldOfficerToggleButtonText}>
                Show {hiddenFieldOfficerEventCount} more event
                {hiddenFieldOfficerEventCount === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {showAllFieldOfficerEvents && filteredFieldOfficerEvents.length > 3 ? (
            <TouchableOpacity
              style={styles.fieldOfficerToggleButton}
              onPress={() => setShowAllFieldOfficerEvents(false)}
            >
              <Text style={styles.fieldOfficerToggleButtonText}>Show fewer events</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {activeTab === 'My Tasks' ? (
      <>
      <View style={styles.taskSummaryRow}>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="assignment" size={16} color="#166534" />
          </View>
          <Text style={styles.taskSummaryValue}>{tasks.length}</Text>
          <Text style={styles.taskSummaryLabel}>Total</Text>
        </View>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="bookmark-added" size={16} color="#166534" />
          </View>
          <Text style={styles.taskSummaryValue}>{assignedCount}</Text>
          <Text style={styles.taskSummaryLabel}>Assigned</Text>
        </View>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="pending-actions" size={16} color="#166534" />
          </View>
          <Text style={styles.taskSummaryValue}>{inProgressCount}</Text>
          <Text style={styles.taskSummaryLabel}>In Progress</Text>
        </View>
        <View style={styles.taskSummaryCard}>
          <View style={styles.taskSummaryIconWrap}>
            <MaterialIcons name="task-alt" size={16} color="#166534" />
          </View>
          <Text style={styles.taskSummaryValue}>{completedCount}</Text>
          <Text style={styles.taskSummaryLabel}>Completed</Text>
        </View>
      </View>

      {tasks.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="check-circle-outline" size={64} color="#ccc" />
          <Text style={styles.emptyTitle}>No tasks assigned yet</Text>
          <Text style={styles.emptySubtitle}>
            {hasFieldOfficerAccess
              ? 'You can still manage assignments in your field officer events above.'
              : 'Tasks will appear here when admins or field officers assign work to you inside an event'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.filterContainer}>
            {(['All', 'Assigned', 'In Progress', 'Completed'] as const).map(status => (
              <TouchableOpacity
                key={status}
                style={[styles.filterButton, filterStatus === status && styles.filterButtonActive]}
                onPress={() => setFilterStatus(status as any)}
              >
                <Text
                  style={[
                    styles.filterButtonText,
                    filterStatus === status && styles.filterButtonTextActive,
                  ]}
                >
                  {filterOptionLabels[status]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.taskListContent}>
            {groupedFilteredTasks.map(group => {
              const project = allProjects.find(entry => entry.id === group.projectId) || null;
              const assignedTaskCount = group.tasks.filter(task => task.status === 'Assigned').length;
              const joinedVolunteerCount = project?.volunteers?.length || 0;
              const eventAddress = project?.location.address || 'Event details available inside';
              const eventLogs = allVolunteerTimeLogs.filter(log => log.projectId === group.projectId);
              const attendanceCount = eventLogs.filter(log => Boolean(log.timeOut)).length;
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
                  onPress={() => {
                    setSelectedTaskGroupProjectId(group.projectId);
                    setShowTaskGroupDetails(true);
                  }}
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
                        minimumFontScale={0.7}
                      >
                        {formatVolunteerTime(totalVolunteerMinutes)}
                      </Text>
                      <Text style={styles.taskGroupStatLabel}>Volunteer Time</Text>
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
            })}
          </View>
        </>
      )}
      </>
      ) : null}
      </ScrollView>

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
                              attendanceState.canTimeOut
                                ? styles.attendanceStatusBadgeActive
                                : attendanceState.hasLoggedToday
                                ? styles.attendanceStatusBadgeDone
                                : styles.attendanceStatusBadgeIdle,
                            ]}
                          >
                            <Text style={styles.attendanceStatusText}>
                              {attendanceState.canTimeOut
                                ? 'Timed In'
                                : attendanceState.hasLoggedToday
                                ? 'Done Today'
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
                                ? attendanceState.latestLog.timeOut
                                  ? `Time out ${formatTimestamp(attendanceState.latestLog.timeOut)}`
                                  : `Time in ${formatTimestamp(attendanceState.latestLog.timeIn)}`
                                : 'No attendance yet'}
                            </Text>
                          </View>
                          <View style={styles.attendanceLogItem}>
                            <Text style={styles.attendanceLogLabel}>Today</Text>
                            <Text style={styles.attendanceLogValue}>
                              {attendanceState.activeLog
                                ? `Active since ${formatTimestamp(attendanceState.activeLog.timeIn)}`
                                : attendanceState.hasLoggedToday
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
                              !attendanceState.canTimeIn && styles.attendanceButtonDisabled,
                            ]}
                            onPress={() => void handleTimeInForProject(selectedTaskGroup.projectId)}
                            disabled={!attendanceState.canTimeIn}
                          >
                            <MaterialIcons name="login" size={18} color="#fff" />
                            <Text style={styles.attendanceButtonText}>
                              {attendanceState.eventHasNotStarted
                                ? 'Await Start'
                                : attendanceState.hasLoggedToday
                                ? 'Done Today'
                                : attendanceState.eventHasEnded
                                ? 'Closed'
                                : 'Time In'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.attendanceButton,
                              styles.timeOutButton,
                              !attendanceState.canTimeOut && styles.attendanceButtonDisabled,
                            ]}
                            onPress={() => handleOpenTimeOutReport(selectedTaskGroup.projectId)}
                            disabled={!attendanceState.canTimeOut}
                          >
                            <MaterialIcons name="logout" size={18} color="#fff" />
                            <Text style={styles.attendanceButtonText}>
                              {attendanceState.canTimeOut ? 'Time Out' : 'Report First'}
                            </Text>
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
                  <Text style={styles.infoLabel}>Volunteer Task Assignments</Text>
                  <Text style={styles.descriptionText}>
                    You can assign joined volunteers to event tasks from your mobile side. Field officer role tasks stay locked for admin control.
                  </Text>

                  {(selectedManagedEvent.internalTasks || []).map(eventTask => (
                    <View key={eventTask.id} style={styles.assignmentCard}>
                      <View style={styles.assignmentHeader}>
                        <View style={styles.assignmentCopy}>
                          <Text style={styles.assignmentTitle}>{eventTask.title}</Text>
                          <Text style={styles.assignmentMeta}>
                            {eventTask.assignedVolunteerName || 'Unassigned'}
                          </Text>
                          <Text style={styles.assignmentMeta}>{eventTask.status}</Text>
                        </View>
                        {eventTask.isFieldOfficer ? (
                          <View style={styles.assignmentLockBadge}>
                            <MaterialIcons name="lock" size={14} color="#92400e" />
                            <Text style={styles.assignmentLockText}>Admin controlled</Text>
                          </View>
                        ) : null}
                      </View>

                      {eventTask.isFieldOfficer ? (
                        <Text style={styles.fieldOfficerHintText}>
                          This task marks the volunteer who manages the event team.
                        </Text>
                      ) : (
                        <View style={styles.assignmentButtonGroup}>
                          <TouchableOpacity
                            style={styles.assignmentButton}
                            onPress={() => void handleAssignEventTask(selectedManagedEvent, eventTask.id)}
                          >
                            <Text style={styles.assignmentButtonText}>Unassign</Text>
                          </TouchableOpacity>
                          {managedEventVolunteerOptions.map(volunteer => (
                            <TouchableOpacity
                              key={`${eventTask.id}-${volunteer.id}`}
                              style={[
                                styles.assignmentButton,
                                eventTask.assignedVolunteerId === volunteer.id &&
                                  styles.assignmentButtonActive,
                              ]}
                              onPress={() =>
                                void handleAssignEventTask(selectedManagedEvent, eventTask.id, volunteer.id)
                              }
                            >
                              <Text
                                style={[
                                  styles.assignmentButtonText,
                                  eventTask.assignedVolunteerId === volunteer.id &&
                                    styles.assignmentButtonTextActive,
                                ]}
                              >
                                {volunteer.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
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
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#666',
  },
  topTabBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
  },
  topTabButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  fieldOfficerSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  fieldOfficerSectionTitleWrap: {
    flex: 1,
  },
  fieldOfficerSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldOfficerSectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
  },
  fieldOfficerSectionBadge: {
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  fieldOfficerSectionBadgeText: {
    fontSize: 11,
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    gap: 12,
  },
  fieldOfficerEventTopRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  fieldOfficerEventCopy: {
    flex: 1,
    gap: 4,
  },
  fieldOfficerEventTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  fieldOfficerEventTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldOfficerEventStatusBadge: {
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  fieldOfficerEventStatusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  fieldOfficerEventProgram: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  fieldOfficerEventMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  fieldOfficerMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  fieldOfficerMetricCard: {
    minWidth: 92,
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  fieldOfficerMetricValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#166534',
  },
  fieldOfficerMetricLabel: {
    marginTop: 2,
    fontSize: 10,
    color: '#64748b',
  },
  fieldOfficerOpenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
  },
  fieldOfficerOpenText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  fieldOfficerEmptyState: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 4,
  },
  fieldOfficerEmptyTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldOfficerEmptyText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  fieldOfficerToggleButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  fieldOfficerToggleButtonText: {
    fontSize: 11,
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
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    marginBottom: 8,
  },
  taskSummaryValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#166534',
    textAlign: 'center',
  },
  taskSummaryLabel: {
    marginTop: 3,
    fontSize: 8,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    lineHeight: 11,
    textAlign: 'center',
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
  taskGroupCard: {
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe5ef',
    padding: 14,
    gap: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  taskGroupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  taskGroupIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 6,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d9f99d',
    backgroundColor: '#f7fee7',
    padding: 14,
    gap: 12,
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
    gap: 10,
  },
  attendanceButton: {
    minHeight: 46,
    minWidth: 140,
    flexGrow: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
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
});
