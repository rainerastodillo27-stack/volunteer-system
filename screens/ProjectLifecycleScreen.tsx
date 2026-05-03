import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { MaterialIcons } from '@expo/vector-icons';
import CalendarDatePicker from '../components/CalendarDatePicker';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { TASK_SKILL_OPTIONS } from '../utils/skills';
import {
  AdvocacyFocus,
  Partner,
  PartnerProjectApplication,
  PartnerReport,
  Project,
  ProjectInternalTask,
  StatusUpdate,
  VolunteerTimeLog,
  ProgramTrack,
} from '../models/types';
import {
  buildProgramProposalProjectId,
  completeVolunteerProjectParticipation,
  deleteEvent,
  deleteProject,
  getAllPartnerProjectApplications,
  getAllVolunteerProjectMatches,
  getAllVolunteerTimeLogs,
  getAllPartners,
  getAllProjects,
  getAllProgramTracks,
  getAllVolunteers,
  getPartnerReportsByProject,
  getPartnerProjectApplications,
  getProjectMatches,
  getProjectsScreenSnapshot,
  getStatusUpdatesByProject,
  getVolunteerProjectJoinRecords,
  reviewPartnerReport,
  reviewPartnerProjectApplication,
  reviewVolunteerProjectMatch,
  deleteProgram,
  saveEvent,
  saveProgram,
  saveProject,
  saveStatusUpdate,
  subscribeToStorageChanges,
} from '../models/storage';
import { Volunteer, VolunteerProjectJoinRecord, VolunteerProjectMatch } from '../models/types';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { navigateToAvailableRoute } from '../utils/navigation';
import {
  getPrimaryProjectImageSource,
  inferCoordinatesFromPlace,
  PHILIPPINES_REGION,
} from '../utils/projectMap';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getPrimaryReportMediaUri, isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import {
  composePhilippineAddress,
  getBarangaysByCity,
  getCitiesByRegion,
  PHBarangay,
  PHCityMunicipality,
  PHRegions,
} from '../utils/philippineAddressData';

// Safe Platform accessor for web environments (kept local to this screen)
function getPlatformOS(): string {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}

const statuses = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const lifecycleStatusModes = ['System', 'Manual'] as const;
type LifecycleStatusMode = (typeof lifecycleStatusModes)[number];
const projectModules: AdvocacyFocus[] = ['Nutrition', 'Education', 'Livelihood', 'Disaster'];
type ProgramSuiteModule = string;

function normalizeProgramTrackIcon(icon?: string): keyof typeof MaterialIcons.glyphMap {
  if (!icon) {
    return 'category';
  }
  return icon in MaterialIcons.glyphMap ? (icon as keyof typeof MaterialIcons.glyphMap) : 'category';
}

function normalizeProgramTrackColor(color?: string): string {
  const trimmed = String(color || '').trim();
  if (!trimmed) {
    return '#2563eb';
  }
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed : '#2563eb';
}

function getProjectProgramId(project: Project): string {
  return String((project as any).program_id || project.programModule || project.category || '').trim();
}

function getProgramSuiteModuleForProject(project: Project, activeProgramTrackIds: Set<string>): string | null {
  const programId = getProjectProgramId(project);
  return activeProgramTrackIds.has(programId) ? programId : null;
}

type ProjectDraft = {
  id?: string;
  title: string;
  description: string;
  programModule: AdvocacyFocus;
  program_id?: string;
  parentProjectId?: string;
  status: Project['status'];
  partnerId: string;
  imageUrl: string;
  imageHidden: boolean;
  startDate: string;
  endDate: string;
  address: string;
  latitude: string;
  longitude: string;
  volunteersNeeded: string;
  skillsNeeded: string[];
  isEvent: boolean;
};

type ProjectVolunteerEntry = {
  id: string;
  name: string;
  email: string;
  joinedAt: string | undefined;
  source: VolunteerProjectJoinRecord['source'] | undefined;
  participationStatus: VolunteerProjectJoinRecord['participationStatus'];
  completedAt: string | undefined;
  status: Volunteer['engagementStatus'] | undefined;
};

type ProjectVolunteerRequestEntry = {
  id: string;
  volunteerId: string;
  volunteerUserId: string;
  volunteerName: string;
  volunteerEmail: string;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  status: VolunteerProjectMatch['status'];
};

type ProjectTaskDraft = {
  id?: string;
  title: string;
  description: string;
  category: string;
  priority: ProjectInternalTask['priority'];
  status: ProjectInternalTask['status'];
  assignedVolunteerId: string;
  isFieldOfficer: boolean;
  skillsNeeded: string[];
};

type ProjectTimeLogEntry = VolunteerTimeLog & {
  volunteerName: string;
  volunteerEmail: string;
};

function getStartOfWeekMonday(sourceDate: Date): Date {
  const date = new Date(sourceDate);
  const dayIndex = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayIndex);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getStartOfWeekSunday(sourceDate: Date): Date {
  const date = new Date(sourceDate);
  date.setDate(date.getDate() - date.getDay());
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getMonthCalendarDays(sourceDate: Date): Date[] {
  const monthStart = new Date(sourceDate.getFullYear(), sourceDate.getMonth(), 1);
  const gridStart = getStartOfWeekSunday(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function getCalendarDayDifference(start: Date, end: Date): number {
  const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((utcEnd - utcStart) / (1000 * 60 * 60 * 24));
}

function isDateOverlappingRange(target: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return target.getTime() >= rangeStart.getTime() && target.getTime() <= rangeEnd.getTime();
}

function addDays(sourceDate: Date, days: number): Date {
  const date = new Date(sourceDate);
  date.setDate(date.getDate() + days);
  return date;
}

function getDateKey(sourceDate: Date): string {
  return sourceDate.toISOString().slice(0, 10);
}

const CALENDAR_STATUS_VISIBILITY_ORDER: Record<Project['status'], number> = {
  Planning: 0,
  'In Progress': 1,
  'On Hold': 2,
  Completed: 3,
  Cancelled: 4,
};

function compareProjectsForCalendarVisibility(left: Project, right: Project): number {
  const statusDifference =
    CALENDAR_STATUS_VISIBILITY_ORDER[getProjectDisplayStatus(left)] -
    CALENDAR_STATUS_VISIBILITY_ORDER[getProjectDisplayStatus(right)];
  if (statusDifference !== 0) {
    return statusDifference;
  }

  return (
    new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
    left.title.localeCompare(right.title)
  );
}

function getVisibleCalendarProjects(projects: Project[], maxCount: number): Project[] {
  const sortedProjects = [...projects].sort(compareProjectsForCalendarVisibility);
  const selectedProjects: Project[] = [];

  statuses.forEach(status => {
    if (selectedProjects.length >= maxCount) {
      return;
    }

    const nextProject = sortedProjects.find(
      project =>
        getProjectDisplayStatus(project) === status &&
        !selectedProjects.some(selectedProject => selectedProject.id === project.id)
    );

    if (nextProject) {
      selectedProjects.push(nextProject);
    }
  });

  sortedProjects.forEach(project => {
    if (
      selectedProjects.length < maxCount &&
      !selectedProjects.some(selectedProject => selectedProject.id === project.id)
    ) {
      selectedProjects.push(project);
    }
  });

  return selectedProjects;
}

function formatCalendarItemDateRange(startValue?: string, endValue?: string): string {
  if (!startValue) {
    return 'Date pending';
  }

  const startDate = new Date(startValue);
  const endDate = endValue ? new Date(endValue) : startDate;

  if (Number.isNaN(startDate.getTime())) {
    return 'Date pending';
  }

  if (Number.isNaN(endDate.getTime())) {
    return format(startDate, 'MMM d, h:mm a');
  }

  const startLabel = format(startDate, 'MMM d, h:mm a');
  const endLabel = format(endDate, 'MMM d, h:mm a');
  return startLabel === endLabel ? endLabel : `${startLabel} - ${endLabel}`;
}

// Returns the default project form used for create and edit flows.
const createEmptyProjectDraft = (
  partnerId = '',
  programModule: AdvocacyFocus = 'Education',
  isEvent = false,
  title = '',
  description = '',
  parentProjectId?: string
): ProjectDraft => ({
  title,
  description,
  programModule,
  program_id: programModule,
  parentProjectId,
  status: 'Planning',
  partnerId,
  imageUrl: '',
  imageHidden: false,
  startDate: '',
  endDate: '',
  address: '',
  latitude: '',
  longitude: '',
  volunteersNeeded: '1',
  skillsNeeded: [],
  isEvent,
});

const createEmptyProjectTaskDraft = (): ProjectTaskDraft => ({
  title: '',
  description: '',
  category: 'General',
  priority: 'Medium',
  status: 'Unassigned',
  assignedVolunteerId: '',
  isFieldOfficer: false,
  skillsNeeded: [],
});

function getProjectCategoryFromModule(module: AdvocacyFocus): Project['category'] {
  switch (module) {
    case 'Education':
      return 'Education';
    case 'Livelihood':
      return 'Livelihood';
    case 'Nutrition':
      return 'Nutrition';
    case 'Disaster':
      return 'Disaster';
    default:
      return 'Disaster';
  }
}

function getProjectDraftModule(project: Project): AdvocacyFocus {
  if (project.programModule) {
    return project.programModule;
  }

  return (project.category as string) === 'Other'
    ? 'Disaster'
    : (project.category as AdvocacyFocus);
}

function getProgramSuiteChevron(isExpanded: boolean): keyof typeof MaterialIcons.glyphMap {
  return isExpanded ? 'expand-less' : 'expand-more';
}

function formatProposalDateValue(value?: string): string {
  if (!value) {
    return 'Not provided';
  }

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    return value;
  }

  return format(parsedValue, 'PPP');
}

function formatProjectDateLabel(value?: string): string {
  if (!value) {
    return 'To be announced';
  }

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    return 'To be announced';
  }

  return format(parsedValue, 'PPP');
}

function formatProjectDateRangeLabel(startDate?: string, endDate?: string): string {
  const formattedStartDate = formatProjectDateLabel(startDate);
  const formattedEndDate = formatProjectDateLabel(endDate);

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

function normalizeAddressToken(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function parsePhilippineAddressSelection(address: string): {
  regionCode: string;
  cityCode: string;
  barangayCode: string;
} {
  const tokens = address
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);

  if (tokens.length < 3) {
    return { regionCode: '', cityCode: '', barangayCode: '' };
  }

  const regionToken = normalizeAddressToken(tokens[tokens.length - 1]);
  const cityToken = normalizeAddressToken(tokens[tokens.length - 2]);
  const barangayToken = normalizeAddressToken(tokens[tokens.length - 3]);

  const region = PHRegions.find(
    item => normalizeAddressToken(item.name) === regionToken
  );
  if (!region) {
    return { regionCode: '', cityCode: '', barangayCode: '' };
  }

  const cities = getCitiesByRegion(region.code);
  const city = cities.find(
    item =>
      normalizeAddressToken(item.displayName) === cityToken ||
      normalizeAddressToken(item.name) === cityToken
  );
  if (!city) {
    return { regionCode: region.code, cityCode: '', barangayCode: '' };
  }

  const barangays = getBarangaysByCity(city.code);
  const barangay = barangays.find(
    item =>
      normalizeAddressToken(item.name) === barangayToken ||
      normalizeAddressToken(item.displayName) === barangayToken
  );

  return {
    regionCode: region.code,
    cityCode: city.code,
    barangayCode: barangay?.code || '',
  };
}

// Gives admins a unified project operations workspace for planning, delivery, and approvals.
export default function ProjectLifecycleScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = getPlatformOS() === 'web' || width >= 1100;
  const listScrollViewRef = React.useRef<ScrollView | null>(null);
  const listScrollOffsetRef = React.useRef(0);
  const windowScrollOffsetRef = React.useRef(0);
  const shouldRestoreListScrollRef = React.useRef(false);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [allPartnerApplications, setAllPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [partnerReports, setPartnerReports] = useState<PartnerReport[]>([]);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [allVolunteerMatches, setAllVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectEditorMode, setProjectEditorMode] = useState<'project' | 'event' | null>(null);
  const [isProjectSaveSuccess, setIsProjectSaveSuccess] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [showAssignmentDropdown, setShowAssignmentDropdown] = useState(false);
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);
  const [showProgramProposalModal, setShowProgramProposalModal] = useState(false);
  const [showAddProgramModal, setShowAddProgramModal] = useState(false);
  const [newProgramName, setNewProgramName] = useState('');
  const [isAddProgramSuccess, setIsAddProgramSuccess] = useState(false);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [programDraft, setProgramDraft] = useState({ title: '', description: '', icon: 'folder', color: '#6366f1', imageUrl: '' });
  const [showProgramCrudModal, setShowProgramCrudModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [selectedProgramProposalModule, setSelectedProgramProposalModule] = useState<ProgramSuiteModule | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'startDate' | 'endDate'>('startDate');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSchedulerYear, setSelectedSchedulerYear] = useState(new Date().getFullYear());
  const [selectedSchedulerMonth, setSelectedSchedulerMonth] = useState(new Date().getMonth());
  const [isSchedulerMonthHovered, setIsSchedulerMonthHovered] = useState(false);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [statusUpdateMode, setStatusUpdateMode] = useState<LifecycleStatusMode>('System');
  const [newStatus, setNewStatus] = useState<Project['status']>('Planning');
  const [updateDescription, setUpdateDescription] = useState('');
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(() => {
    const initialModule = (route.params?.programModule as AdvocacyFocus) || 'Education';
    return createEmptyProjectDraft('', initialModule);
  });
  const [projectRegionCode, setProjectRegionCode] = useState('');
  const [projectCityCode, setProjectCityCode] = useState('');
  const [projectBarangayCode, setProjectBarangayCode] = useState('');
  const [projectLocationCities, setProjectLocationCities] = useState<PHCityMunicipality[]>([]);
  const [projectLocationBarangays, setProjectLocationBarangays] = useState<PHBarangay[]>([]);
  const [taskDraft, setTaskDraft] = useState<ProjectTaskDraft>(createEmptyProjectTaskDraft());
  const [customTaskSkill, setCustomTaskSkill] = useState('');
  const [customProjectSkill, setCustomProjectSkill] = useState('');
  const [expandedProgramModules, setExpandedProgramModules] = useState<Set<any>>(
    () => new Set()
  );
  const programSectionAnimations = React.useRef<Record<string, Animated.Value>>({});
  const getProgramSectionAnimation = (module: string) => {
    if (!programSectionAnimations.current[module]) {
      programSectionAnimations.current[module] = new Animated.Value(0);
    }
    return programSectionAnimations.current[module];
  };
  const projectDraftParentProject = useMemo(
    () =>
      projectDraft.isEvent && projectDraft.parentProjectId
        ? projects.find(project => !project.isEvent && project.id === projectDraft.parentProjectId) || null
        : null,
    [projectDraft.isEvent, projectDraft.parentProjectId, projects]
  );
  const resetProjectLocationSelection = () => {
    setProjectRegionCode('');
    setProjectCityCode('');
    setProjectBarangayCode('');
    setProjectLocationCities([]);
    setProjectLocationBarangays([]);
  };

  const applyProjectLocationSelectionFromAddress = (address: string) => {
    const parsedSelection = parsePhilippineAddressSelection(address);
    setProjectRegionCode(parsedSelection.regionCode);

    const cities = parsedSelection.regionCode
      ? getCitiesByRegion(parsedSelection.regionCode)
      : [];
    setProjectLocationCities(cities);
    setProjectCityCode(parsedSelection.cityCode);

    const barangays = parsedSelection.cityCode
      ? getBarangaysByCity(parsedSelection.cityCode)
      : [];
    setProjectLocationBarangays(barangays);
    setProjectBarangayCode(parsedSelection.barangayCode);
  };

  const shiftSchedulerMonth = (delta: number) => {
    setSelectedSchedulerMonth(currentMonth => {
      const nextMonth = currentMonth + delta;

      if (nextMonth > 11) {
        setSelectedSchedulerYear(currentYear => currentYear + 1);
        return 0;
      }

      if (nextMonth < 0) {
        setSelectedSchedulerYear(currentYear => currentYear - 1);
        return 11;
      }

      return nextMonth;
    });
  };

  useEffect(() => {
    const refreshCurrentDate = () => {
      setCurrentDate(new Date());
    };

    refreshCurrentDate();
    const timer = setInterval(refreshCurrentDate, 60000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      // Split refresh into a lightweight immediate load and deferred heavy loads
      const refreshLight = async () => {
        // Essential UI data loaded first to render the screen quickly
        await Promise.all([loadProjects(), loadPartners()]);

        // Load selected-project details synchronously so selection works immediately
        if (selectedProject?.id) {
          await Promise.all([
            loadStatusUpdates(selectedProject.id),
            loadPartnerReportsForProject(selectedProject.id),
            loadVolunteerJoinsForProject(selectedProject.id),
            loadVolunteerMatchesForProject(selectedProject.id),
          ]);
        }
      };

      const refreshDeferred = async () => {
        // Defer heavier collections so UI can mount. Failures are non-fatal.
        void loadVolunteers();
        void loadAllVolunteerMatches();
        void loadVolunteerTimeLogs();
        void loadAllPartnerApplications();
        void loadProgramTracks();
      };

      const refresh = async () => {
        await refreshLight();
        // schedule deferred loads without blocking render
        setTimeout(() => {
          void refreshDeferred();
        }, 50);
      };

      void refresh();

      const unsubscribe = subscribeToStorageChanges(
        // Keep subscriptions focused on keys that affect the visible UI first.
        ['projects', 'events', 'partners', 'statusUpdates', 'partnerReports', 'volunteerProjectJoins', 'volunteerMatches', 'programTracks'],
        () => {
          // For storage updates, update light data immediately and defer heavy refreshes
          void refreshLight();
          setTimeout(() => {
            void refreshDeferred();
          }, 200);
        }
      );

      return () => {
        unsubscribe();
      };
    }, [selectedProject?.id])
  );

  // Loads all projects and refreshes the currently selected project reference.
  const loadProjects = async () => {
    try {
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'programTracks']);
      const allProjects = snapshot.projects || [];
      setProjects(allProjects);
      setProgramTracks(snapshot.programTracks || []);
      setLoadError(null);
      setSelectedProject(currentSelectedProject => {
        if (!currentSelectedProject) {
          return currentSelectedProject;
        }

        return allProjects.find(project => project.id === currentSelectedProject.id) || null;
      });
      return allProjects;
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load projects.'),
      });
      return [];
    }
  };

  // Loads approved partner organizations used for partnered-org display.
  const loadPartners = async () => {
    try {
      const allPartners = await getAllPartners();
      setPartners(allPartners);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load partners.'),
      });
    }
  };

  // Loads volunteers shown in project assignment and completion sections.
  const loadVolunteers = async () => {
    try {
      const allVolunteers = await getAllVolunteers();
      setVolunteers(allVolunteers);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteers.'),
      });
    }
  };

  // Loads custom program tracks for dynamic program sections.
  const loadProgramTracks = async () => {
    try {
      const tracks = await getAllProgramTracks();
      setProgramTracks(tracks);
    } catch (error) {
      // Non-fatal - custom programs are optional
      console.error('Failed to load program tracks:', error);
    }
  };

  // Loads lifecycle updates for the selected project.
  const loadStatusUpdates = async (projectId: string) => {
    try {
      const updates = await getStatusUpdatesByProject(projectId);
      const targetProject = projects.find(project => project.id === projectId);
      if (!targetProject) {
        setStatusUpdates(updates);
        return;
      }

      const derivedSystemStatus = getSystemDerivedProjectStatus(targetProject);
      const syntheticSystemUpdate: StatusUpdate = {
        id: `system-status-${projectId}`,
        projectId,
        status: derivedSystemStatus,
        description: 'System-derived lifecycle status based on start and end dates.',
        source: 'System',
        updatedBy: 'system',
        updatedAt: targetProject.updatedAt || targetProject.startDate || new Date().toISOString(),
      };

      setStatusUpdates([syntheticSystemUpdate, ...updates.filter(update => update.id !== syntheticSystemUpdate.id)]);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load status updates.'),
      });
    }
  };

  // Loads all partner project proposals for the program cards and proposal popup.
  const loadAllPartnerApplications = async () => {
    try {
      const applications = await getAllPartnerProjectApplications();
      setAllPartnerApplications(applications);
      return applications;
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load project proposals.'),
      });
      return [];
    }
  };

  // Loads partner-uploaded reports for the selected project.
  const loadPartnerReportsForProject = async (projectId: string) => {
    try {
      const reports = await getPartnerReportsByProject(projectId);
      setPartnerReports(reports);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load partner reports.'),
      });
    }
  };

  // Loads volunteers who have already joined the selected project.
  const loadVolunteerJoinsForProject = async (projectId: string) => {
    try {
      const records = await getVolunteerProjectJoinRecords(projectId);
      setVolunteerJoinRecords(records);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load joined volunteers.'),
      });
    }
  };

  // Loads volunteer join requests tied to the selected project.
  const loadVolunteerMatchesForProject = async (projectId: string) => {
    try {
      const matches = await getProjectMatches(projectId);
      setVolunteerMatches(matches);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteer requests.'),
      });
    }
  };

  // Loads all volunteer match requests for dashboard-level notifications.
  const loadAllVolunteerMatches = async () => {
    try {
      const matches = await getAllVolunteerProjectMatches();
      setAllVolunteerMatches(matches);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteer request notifications.'),
      });
    }
  };

  // Saves a new program (folder) and refreshes the snapshot.
  const handleAddProgram = async () => {
    if (!newProgramName.trim()) {
      Alert.alert('Error', 'Please enter a program name.');
      return;
    }

    setActionLoadingKey('addProgram');
    try {
      const newProgram: ProgramTrack = {
        id: newProgramName.trim(),
        title: newProgramName.trim(),
        description: `Folder for ${newProgramName.trim()} projects.`,
        icon: 'folder',
        color: '#6366f1', // Default indigo
        imageUrl: 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1470&auto=format&fit=crop',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveProgram(newProgram);
      setIsAddProgramSuccess(true);

      // Delay closing to show success checkmark
      setTimeout(async () => {
        await loadProgramTracks();
        setIsAddProgramSuccess(false);
        setNewProgramName('');
        setShowAddProgramModal(false);
        Alert.alert('✅ Program Added', `"${newProgram.title}" has been added to the dashboard.`);
      }, 1800);
    } catch (error) {
      Alert.alert('Error', getRequestErrorMessage(error, 'Failed to create program.'));
    } finally {
      setActionLoadingKey(null);
    }
  };

  const openCreateProgramModal = () => {
    setEditingProgramId(null);
    setProgramDraft({ title: '', description: '', icon: 'folder', color: '#6366f1', imageUrl: '' });
    setShowProgramCrudModal(true);
  };

  const openEditProgramModal = (track: ProgramTrack) => {
    setEditingProgramId(track.id);
    setProgramDraft({
      title: track.title,
      description: track.description || '',
      icon: track.icon || 'folder',
      color: track.color || '#6366f1',
      imageUrl: track.imageUrl || '',
    });
    setShowProgramCrudModal(true);
  };

  const handleSaveProgramCrud = async () => {
    if (!programDraft.title.trim()) {
      Alert.alert('Error', 'Program name is required.');
      return;
    }
    setActionLoadingKey('saveProgramCrud');
    try {
      const now = new Date().toISOString();
      const id = editingProgramId || programDraft.title.trim();
      const program: ProgramTrack = {
        id,
        title: programDraft.title.trim(),
        description: programDraft.description.trim() || `Folder for ${programDraft.title.trim()} projects.`,
        icon: programDraft.icon || 'folder',
        color: programDraft.color || '#6366f1',
        imageUrl: programDraft.imageUrl.trim() || undefined,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      // Optimistic update: show card immediately before server confirms
      setProgramTracks(current => {
        const existing = current.findIndex(t => t.id === id);
        if (existing >= 0) {
          const updated = [...current];
          updated[existing] = program;
          return updated;
        }
        return [...current, program];
      });

      // Persist to backend (program_tracks table)
      await saveProgram(program);

      // Show success then close modal
      setIsAddProgramSuccess(true);
      setTimeout(async () => {
        // Sync the local program list so the new card stays visible immediately.
        await loadProgramTracks();
        setIsAddProgramSuccess(false);
        setShowProgramCrudModal(false);
        // System notification after modal closes
        Alert.alert(
          editingProgramId ? '✅ Program Updated' : '✅ Program Created',
          editingProgramId
            ? `"${program.title}" has been updated and saved to the database.`
            : `"${program.title}" is now live in the dashboard and saved to program_tracks.`
        );
      }, 1200);
    } catch (error) {
      // Rollback optimistic update on error
      await loadProjects();
      Alert.alert('Error', getRequestErrorMessage(error, 'Failed to save program. Please try again.'));
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleDeleteProgram = (trackId: string, trackTitle: string) => {
    const doDelete = async () => {
      setActionLoadingKey(`deleteProgram-${trackId}`);
      try {
        setProgramTracks(current => current.filter(track => track.id !== trackId));
        await deleteProgram(trackId);
        await loadProgramTracks();
        Alert.alert('✅ Program Deleted', `"${trackTitle}" has been removed from the dashboard.`);
      } catch (error) {
        await loadProgramTracks();
        Alert.alert('Error', getRequestErrorMessage(error, 'Failed to delete program.'));
      } finally {
        setActionLoadingKey(null);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(`Delete program "${trackTitle}"? This cannot be undone.`)) {
        void doDelete();
      }
      return;
    }

    Alert.alert(
      'Delete Program',
      `Delete "${trackTitle}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
      ]
    );
  };

  // Loads all volunteer time-in and time-out records for project monitoring.
  const loadVolunteerTimeLogs = async () => {
    try {
      const logs = await getAllVolunteerTimeLogs();
      setVolunteerTimeLogs(logs);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteer time logs.'),
      });
    }
  };

  // Selects a project and loads all related lifecycle details.
  const handleSelectProject = async (project: Project) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      windowScrollOffsetRef.current = window.scrollY || window.pageYOffset || 0;
    }
    shouldRestoreListScrollRef.current = true;
    setSelectedProject(project);
    await Promise.all([
      loadStatusUpdates(project.id),
      loadPartnerReportsForProject(project.id),
      loadVolunteerJoinsForProject(project.id),
      loadVolunteerMatchesForProject(project.id),
    ]);
  };

  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projects.length === 0) {
      return;
    }

    const nextProject = projects.find(project => project.id === requestedProjectId);
    if (!nextProject) {
      return;
    }

    void handleSelectProject(nextProject);
    navigation.setParams({ projectId: undefined });
  }, [navigation, projects, route?.params?.projectId]);

  // Opens the project modal in create mode with a blank draft.
  const openCreateProjectModal = () => {
    setEditingProjectId(null);
    setProjectDraft(createEmptyProjectDraft());
    setProjectEditorMode('project');
    resetProjectLocationSelection();
    setProjectSaveError(null);
    setShowProjectModal(true);
  };

  // Opens the project editor pre-wired to a specific program track.
  const openCreateProjectInProgramModal = (trackId: string, trackTitle: string) => {
    setEditingProjectId(null);
    setProjectEditorMode('project');
    // Map trackId to an AdvocacyFocus if possible, else use the trackId itself
    const knownModules: AdvocacyFocus[] = ['Education', 'Livelihood', 'Nutrition', 'Disaster'];
    const module: AdvocacyFocus = knownModules.includes(trackId as AdvocacyFocus)
      ? (trackId as AdvocacyFocus)
      : 'Education';
    const draft = createEmptyProjectDraft('', module, false, '', '', undefined);
    // Override program_id so the project shows inside the correct program section
    draft.program_id = trackId;
    draft.programModule = trackId as AdvocacyFocus;
    setProjectDraft(draft);
    resetProjectLocationSelection();
    setProjectSaveError(null);
    setShowProjectModal(true);
  };

  // Opens the project modal in create-event mode with the selected program prefilled.
  const openCreateEventModal = (parentProject: Project) => {
    setEditingProjectId(null);
    setProjectEditorMode('event');
    const nextDraft = createEmptyProjectDraft(
      parentProject.partnerId,
      getProjectDraftModule(parentProject) as AdvocacyFocus,
      true,
      'Quarterly Assessment',
      'Quarterly Assessment event for program coordination, announcements, and assigning tasks to the event team.',
      parentProject.id
    );
    nextDraft.imageUrl = parentProject.imageUrl || '';
    nextDraft.imageHidden = Boolean(parentProject.imageHidden);
    nextDraft.address = parentProject.location.address || '';
    nextDraft.latitude = String(parentProject.location.latitude || '');
    nextDraft.longitude = String(parentProject.location.longitude || '');
    nextDraft.skillsNeeded = Array.isArray(parentProject.skillsNeeded)
      ? parentProject.skillsNeeded
      : [];
    setProjectDraft(nextDraft);
    resetProjectLocationSelection();
    applyProjectLocationSelectionFromAddress(parentProject.location.address || '');
    setProjectSaveError(null);
    setShowProjectModal(true);
  };

  // Closes the project editor and clears edit mode so the main screen is shown again.
  const closeProjectModal = () => {
    setShowProjectModal(false);
    setEditingProjectId(null);
    setProjectEditorMode(null);
    setIsProjectSaveSuccess(false);
    setProjectSaveError(null);
  };

  // Opens the project modal in edit mode using the selected project values.
  const openEditProjectModal = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectEditorMode(project.isEvent ? 'event' : 'project');
    setProjectDraft({
      id: project.id,
      title: project.title,
      description: project.description,
      programModule: getProjectDraftModule(project),
      parentProjectId: project.parentProjectId,
      status: project.status,
      partnerId: project.partnerId,
      imageUrl: project.imageUrl || '',
      imageHidden: Boolean(project.imageHidden),
      startDate: project.startDate.slice(0, 10),
      endDate: project.endDate.slice(0, 10),
      address: project.location.address,
      latitude: String(project.location.latitude),
      longitude: String(project.location.longitude),
      volunteersNeeded: String(project.volunteersNeeded),
      skillsNeeded: Array.isArray(project.skillsNeeded) ? project.skillsNeeded : [],
      isEvent: !!project.isEvent,
    });
    applyProjectLocationSelectionFromAddress(project.location.address);
    setProjectSaveError(null);
    setShowProjectModal(true);
  };

  const saveProjectLikeRecord = async (project: Project) => {
    if (project.isEvent) {
      await saveEvent(project);
      return;
    }

    await saveProject(project);
  };

  const deleteProjectLikeRecord = async (project: Project) => {
    if (project.isEvent) {
      await deleteEvent(project.id);
      return;
    }

    await deleteProject(project.id);
  };

  const handleDeleteEventRecord = (event: Project) => {
    if (!isAdmin || !event.isEvent) {
      return;
    }

    const doDelete = async () => {
      setActionLoadingKey(`deleteEvent-${event.id}`);
      try {
        await deleteProjectLikeRecord(event);
        setProjects(currentProjects => currentProjects.filter(project => project.id !== event.id));
        setSelectedProject(currentProject =>
          currentProject?.id === event.id ? null : currentProject
        );
        await loadProjects();
        Alert.alert('Deleted', `Event "${event.title}" has been deleted.`);
      } catch (error) {
        Alert.alert(
          getRequestErrorTitle(error),
          getRequestErrorMessage(error, 'Failed to delete event.')
        );
      } finally {
        setActionLoadingKey(null);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(`Delete event "${event.title}"? This cannot be undone.`)) {
        void doDelete();
      }
      return;
    }

    Alert.alert(
      'Delete Event',
      `Delete "${event.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
      ]
    );
  };

  // Updates a single project draft field without replacing the entire object.
  const handleProjectDraftChange = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => {
    setProjectDraft(current => ({ ...current, [key]: value }));
  };

  const toggleProjectSkill = (skill: string) => {
    setProjectDraft(current => {
      const nextSkills = current.skillsNeeded.includes(skill)
        ? current.skillsNeeded.filter(existingSkill => existingSkill !== skill)
        : [...current.skillsNeeded, skill];
      return { ...current, skillsNeeded: nextSkills };
    });
  };

  const handleAddCustomProjectSkill = () => {
    const nextSkill = customProjectSkill.trim();
    if (!nextSkill) {
      return;
    }

    setProjectDraft(current => {
      const normalizedSkill = nextSkill;
      if (current.skillsNeeded.includes(normalizedSkill)) {
        return current;
      }

      return {
        ...current,
        skillsNeeded: [...current.skillsNeeded, normalizedSkill],
      };
    });
    setCustomProjectSkill('');
  };

  const removeProjectSkill = (skill: string) => {
    setProjectDraft(current => ({
      ...current,
      skillsNeeded: current.skillsNeeded.filter(existingSkill => existingSkill !== skill),
    }));
  };

  const handleProjectRegionChange = (regionCode: string) => {
    setProjectRegionCode(regionCode);
    setProjectCityCode('');
    setProjectBarangayCode('');
    setProjectLocationBarangays([]);
    setProjectLocationCities(regionCode ? getCitiesByRegion(regionCode) : []);
    handleProjectDraftChange('address', '');
  };

  const handleProjectCityChange = (cityCode: string) => {
    setProjectCityCode(cityCode);
    setProjectBarangayCode('');
    setProjectLocationBarangays(cityCode ? getBarangaysByCity(cityCode) : []);
    handleProjectDraftChange('address', '');
  };

  const handleProjectBarangayChange = (barangayCode: string) => {
    setProjectBarangayCode(barangayCode);

    if (!projectRegionCode || !projectCityCode || !barangayCode) {
      handleProjectDraftChange('address', '');
      return;
    }

    const selectedRegion = PHRegions.find(region => region.code === projectRegionCode);
    const selectedCity = projectLocationCities.find(city => city.code === projectCityCode);
    const selectedBarangay = projectLocationBarangays.find(
      barangay => barangay.code === barangayCode
    );

    handleProjectDraftChange(
      'address',
      composePhilippineAddress(
        selectedRegion?.name || '',
        selectedCity?.displayName || '',
        selectedBarangay?.name || ''
      )
    );
  };

  const handleTaskDraftChange = <K extends keyof ProjectTaskDraft>(
    key: K,
    value: ProjectTaskDraft[K]
  ) => {
    setTaskDraft(current => ({ ...current, [key]: value }));
  };

  const handlePickProjectImage = async () => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }

      handleProjectDraftChange('imageHidden', false);
      handleProjectDraftChange('imageUrl', pickedImage);
    } catch (error: any) {
      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');
    }
  };

  const handleRemoveProjectImage = () => {
    handleProjectDraftChange('imageHidden', true);
    handleProjectDraftChange('imageUrl', '');
  };

  const openCreateTaskModal = () => {
    setEditingTaskId(null);
    setTaskDraft(createEmptyProjectTaskDraft());
    setCustomTaskSkill('');
    setShowAssignmentDropdown(false);
    setShowTaskModal(true);
  };

  const openEditTaskModal = (task: ProjectInternalTask) => {
    setEditingTaskId(task.id);
    setTaskDraft({
      id: task.id,
      title: task.title,
      description: task.description,
      category: task.category,
      priority: task.priority,
      status: task.status,
      assignedVolunteerId: task.assignedVolunteerId || '',
      isFieldOfficer: Boolean(task.isFieldOfficer),
      skillsNeeded: task.skillsNeeded || [],
    });
    setCustomTaskSkill('');
    setShowAssignmentDropdown(false);
    setShowTaskModal(true);
  };

  const closeTaskModal = () => {
    setShowTaskModal(false);
    setEditingTaskId(null);
    setTaskDraft(createEmptyProjectTaskDraft());
    setCustomTaskSkill('');
    setShowAssignmentDropdown(false);
  };

  const toggleTaskSkill = (skillName: string) => {
    const normalizedSkill = skillName.trim();
    if (!normalizedSkill) {
      return;
    }

    setTaskDraft(current => {
      const hasSkill = current.skillsNeeded.includes(normalizedSkill);
      const nextSkills = hasSkill
        ? current.skillsNeeded.filter(skill => skill !== normalizedSkill)
        : [...current.skillsNeeded, normalizedSkill];

      return {
        ...current,
        skillsNeeded: nextSkills,
      };
    });
  };

  const handleAddCustomTaskSkill = () => {
    const normalizedSkill = customTaskSkill.trim();
    if (!normalizedSkill) {
      return;
    }

    setTaskDraft(current => {
      if (current.skillsNeeded.includes(normalizedSkill)) {
        return current;
      }

      return {
        ...current,
        skillsNeeded: [...current.skillsNeeded, normalizedSkill],
      };
    });
    setCustomTaskSkill('');
  };

  const openProgramProposalModal = (module: ProgramSuiteModule) => {
    setSelectedProgramProposalModule(module);
    setShowProgramProposalModal(true);
  };

  const closeProgramProposalModal = () => {
    setShowProgramProposalModal(false);
    setSelectedProgramProposalModule(null);
  };

  const handleReturnToProjectList = () => {
    shouldRestoreListScrollRef.current = true;
    setSelectedProject(null);
  };

  const getCurrentSelectedProject = (): Project | null => {
    if (!selectedProject) {
      return null;
    }

    return projects.find(project => project.id === selectedProject.id) || selectedProject;
  };

  const getSystemDerivedProjectStatus = (project: Project): Project['status'] =>
    getProjectDisplayStatus({
      ...project,
      statusMode: 'System',
      manualStatus: undefined,
    });

  const openStatusUpdateModal = () => {
    const currentSelectedProject = getCurrentSelectedProject();
    const nextMode: LifecycleStatusMode = currentSelectedProject?.statusMode === 'Manual' ? 'Manual' : 'System';
    const derivedSystemStatus = currentSelectedProject
      ? getSystemDerivedProjectStatus(currentSelectedProject)
      : 'Planning';

    setStatusUpdateMode(nextMode);
    setNewStatus(
      nextMode === 'Manual'
        ? (currentSelectedProject?.manualStatus || currentSelectedProject?.status || 'Planning')
        : derivedSystemStatus
    );
    setUpdateDescription('');
    setShowStatusModal(true);
  };

  // Opens the volunteer management route for one volunteer when available.
  const openVolunteerProfile = (volunteerId: string) => {
    navigateToAvailableRoute(navigation, 'Volunteers', { volunteerId }, {
      routeName: 'Dashboard',
    });
  };

  // Creates or updates a project record from the modal form.
  const handleSaveProjectRecord = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage projects.');
      return;
    }

    const parsedLatitude = Number(projectDraft.latitude);
    const parsedLongitude = Number(projectDraft.longitude);
    const volunteersNeeded = Number(projectDraft.volunteersNeeded);
    const startDateValue = new Date(projectDraft.startDate);
    const endDateValue = new Date(projectDraft.endDate);
    const existingProject = editingProjectId
      ? projects.find(project => project.id === editingProjectId) || null
      : null;
    if (
      !projectDraft.title.trim() ||
      !projectDraft.description.trim() ||
      !projectDraft.startDate.trim() ||
      !projectDraft.endDate.trim() ||
      !projectDraft.address.trim()
    ) {
      setProjectSaveError('Fill in all required fields: title, description, start date, end date, and location.');
      return;
    }

    if (projectDraft.isEvent && !projectDraft.parentProjectId?.trim()) {
      setProjectSaveError('Select a parent project before saving this event.');
      return;
    }

    if (projectDraft.startDate > projectDraft.endDate) {
      setProjectSaveError('End date must be on or after the start date.');
      return;
    }

    if (projectDraft.isEvent) {
      const parentProject =
        projects.find(project => !project.isEvent && project.id === projectDraft.parentProjectId) || null;

      if (!parentProject) {
        setProjectSaveError('Choose a valid parent project for this event.');
        return;
      }

      const parentStartDate = parentProject.startDate.slice(0, 10);
      const parentEndDate = parentProject.endDate.slice(0, 10);
      const matchesParentSchedule =
        projectDraft.startDate === parentStartDate && projectDraft.endDate === parentEndDate;
      const isOutsideParentSchedule =
        projectDraft.startDate < parentStartDate || projectDraft.endDate > parentEndDate;

      if (matchesParentSchedule) {
        setProjectSaveError('Event dates must be different from the parent project schedule. Choose a smaller window for the event.');
        return;
      }

      if (isOutsideParentSchedule) {
        setProjectSaveError(`Event dates must stay within the parent project schedule (${parentStartDate} to ${parentEndDate}).`);
        return;
      }
    }

    const hasManualCoordinates =
      Boolean(projectDraft.latitude.trim()) &&
      Boolean(projectDraft.longitude.trim()) &&
      Number.isFinite(parsedLatitude) &&
      Number.isFinite(parsedLongitude);
    const hasStructuredPhilippineAddress =
      Boolean(projectRegionCode) && Boolean(projectCityCode) && Boolean(projectBarangayCode);

    const resolvedCoordinates =
      (hasManualCoordinates
        ? { latitude: parsedLatitude, longitude: parsedLongitude }
        : null) ||
      inferCoordinatesFromPlace(projectDraft.address, projects) ||
      (hasStructuredPhilippineAddress
        ? {
          latitude: PHILIPPINES_REGION.latitude,
          longitude: PHILIPPINES_REGION.longitude,
        }
        : null) ||
      (existingProject
        ? {
          latitude: existingProject.location.latitude,
          longitude: existingProject.location.longitude,
        }
        : null);

    if (!resolvedCoordinates) {
      setProjectSaveError('Enter a recognizable barangay, city, municipality, or venue so the map can place this program.');
      return;
    }

    const now = new Date().toISOString();
    const inheritedStatusMode: Project['statusMode'] =
      existingProject?.statusMode === 'Manual' ? 'Manual' : 'System';
    const inheritedManualStatus: Project['manualStatus'] =
      inheritedStatusMode === 'Manual'
        ? (existingProject?.manualStatus || existingProject?.status || 'Planning')
        : undefined;

    const draftBaseProject: Project = {
      id:
        existingProject?.id || `${projectDraft.isEvent ? 'event' : 'project'}-${Date.now()}`,
      title: projectDraft.title.trim(),
      description: projectDraft.description.trim(),
      partnerId: projectDraft.partnerId.trim(),
      imageUrl: projectDraft.imageUrl.trim() || undefined,
      imageHidden: projectDraft.imageUrl.trim() ? false : Boolean(projectDraft.imageHidden),
      programModule: projectDraft.programModule,
      isEvent: projectDraft.isEvent,
      parentProjectId: projectDraft.isEvent ? projectDraft.parentProjectId : undefined,
      statusMode: inheritedStatusMode,
      manualStatus: inheritedManualStatus,
      status: projectDraft.status,
      category: getProjectCategoryFromModule(projectDraft.programModule),
      startDate: startDateValue.toISOString(),
      endDate: endDateValue.toISOString(),
      location: {
        latitude: resolvedCoordinates.latitude,
        longitude: resolvedCoordinates.longitude,
        address: projectDraft.address.trim(),
      },
      volunteersNeeded,
      volunteers: existingProject?.volunteers || [],
      joinedUserIds: existingProject?.joinedUserIds || [],
      skillsNeeded: projectDraft.skillsNeeded || [],
      createdAt: existingProject?.createdAt || now,
      updatedAt: now,
      statusUpdates: existingProject?.statusUpdates || [],
      internalTasks: Array.isArray(existingProject?.internalTasks) ? existingProject?.internalTasks : [],
    };

    const resolvedLifecycleStatus =
      draftBaseProject.statusMode === 'Manual'
        ? (draftBaseProject.manualStatus || draftBaseProject.status)
        : getSystemDerivedProjectStatus(draftBaseProject);

    const savedProject: Project = {
      ...draftBaseProject,
      status: resolvedLifecycleStatus,
    };

    try {
      await saveProjectLikeRecord(savedProject);
      await loadProjects();
      setActionLoadingKey(null);
      setIsProjectSaveSuccess(true);
      const successTitle = editingProjectId ? '✅ Project Updated' : '✅ Project Created';
      const successMessage = editingProjectId
        ? savedProject.isEvent
          ? 'Event updated successfully and saved to the database.'
          : 'Project updated successfully and saved to the database.'
        : savedProject.isEvent
          ? 'Event created successfully and saved to the database.'
          : 'Project created successfully and saved to the database.';

      Alert.alert(successTitle, successMessage);

      // For new events, keep the modal open and reset the form for adding another event
      if (savedProject.isEvent && !editingProjectId) {
        setTimeout(() => {
          setIsProjectSaveSuccess(false);
          setProjectSaveError(null);
          // Reset the form to create another event with the same parent project
          const parentProject = projects.find(p => p.id === savedProject.parentProjectId && !p.isEvent);
          if (parentProject) {
            const nextDraft = createEmptyProjectDraft(
              parentProject.partnerId,
              getProjectDraftModule(parentProject) as AdvocacyFocus,
              true,
              'Quarterly Assessment',
              'Quarterly Assessment event for program coordination, announcements, and assigning tasks to the event team.',
              parentProject.id
            );
            nextDraft.imageUrl = parentProject.imageUrl || '';
            nextDraft.imageHidden = Boolean(parentProject.imageHidden);
            nextDraft.address = parentProject.location.address || '';
            nextDraft.latitude = String(parentProject.location.latitude || '');
            nextDraft.longitude = String(parentProject.location.longitude || '');
            nextDraft.skillsNeeded = Array.isArray(parentProject.skillsNeeded)
              ? parentProject.skillsNeeded
              : [];
            setProjectDraft(nextDraft);
            resetProjectLocationSelection();
            applyProjectLocationSelectionFromAddress(parentProject.location.address || '');
          }
        }, 1200);
      } else {
        // For projects and event edits, close the modal as before
        setTimeout(() => {
          setIsProjectSaveSuccess(false);
          handleReturnToProjectList();
          closeProjectModal();
          void loadAllPartnerApplications();
        }, 1200);
      }
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to save project.')
      );
    }
  };

  // Confirms and deletes the currently edited project record.
  const handleDeleteProjectRecord = () => {
    if (!selectedProject || !isAdmin) {
      return;
    }

    const selectedRecordType = selectedProject.isEvent ? 'Event' : 'Program';

    Alert.alert(
      `Delete ${selectedRecordType}`,
      `Delete ${selectedProject.title}? This will remove its related join records, applications, and logs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProjectLikeRecord(selectedProject);
              handleReturnToProjectList();
              setStatusUpdates([]);
              setAllPartnerApplications([]);
              setPartnerReports([]);
              setVolunteerJoinRecords([]);
              await loadProjects();
              Alert.alert('Deleted', selectedProject.isEvent ? 'Event removed.' : 'Program removed.');
            } catch (error) {
              Alert.alert(
                getRequestErrorTitle(error),
                getRequestErrorMessage(error, `Failed to delete ${selectedRecordType.toLowerCase()}.`)
              );
            }
          },
        },
      ]
    );
  };

  // Adds a new lifecycle status update to the selected project.
  const handleAddStatusUpdate = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can add project status updates.');
      return;
    }

    const currentSelectedProject = getCurrentSelectedProject();
    const trimmedDescription = updateDescription.trim();
    if (!currentSelectedProject) {
      Alert.alert('Error', 'Please select a project first.');
      return;
    }
    if (statusUpdateMode === 'Manual' && !trimmedDescription) {
      Alert.alert('Error', 'Please enter a description for manual overrides.');
      return;
    }

    try {
      const now = new Date().toISOString();
      const derivedSystemStatus = getSystemDerivedProjectStatus(currentSelectedProject);
      const resolvedStatus =
        statusUpdateMode === 'Manual'
          ? newStatus
          : derivedSystemStatus;
      const resolvedDescription =
        trimmedDescription ||
        (statusUpdateMode === 'System'
          ? 'System-derived lifecycle status based on start and end dates.'
          : '');
      const updatedProject = {
        ...currentSelectedProject,
        statusMode: statusUpdateMode,
        manualStatus: statusUpdateMode === 'Manual' ? newStatus : undefined,
        status: resolvedStatus,
        updatedAt: now,
      };

      const statusUpdate: StatusUpdate = {
        id: `status-${Date.now()}`,
        projectId: currentSelectedProject.id,
        status: resolvedStatus,
        description: resolvedDescription,
        source: statusUpdateMode,
        updatedBy: user?.id || '',
        updatedAt: now,
      };

      await saveProjectLikeRecord(updatedProject);
      await saveStatusUpdate(statusUpdate);

      setShowStatusModal(false);
      setUpdateDescription('');
      setStatusUpdateMode('System');
      setNewStatus('Planning');
      setSelectedProject(updatedProject);
      Alert.alert('Success', 'Status update added');
      await Promise.all([
        loadStatusUpdates(currentSelectedProject.id),
        loadProjects(),
      ]);
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to add status update.')
      );
    }
  };

  const handleReviewPartnerApplication = async (
    applicationId: string,
    nextStatus: 'Approved' | 'Rejected'
  ) => {
    if (!isAdmin || !user?.id) return;

    try {
      await reviewPartnerProjectApplication(applicationId, nextStatus, user.id);
      await Promise.all([
        loadAllPartnerApplications(),
        loadProjects(),
      ]);
      if (selectedProject) {
        const refreshedProject = await getAllProjects();
        const nextSelectedProject =
          refreshedProject.find(project => project.id === selectedProject.id) || null;
        setSelectedProject(nextSelectedProject);
      }
      Alert.alert('Success', `Project proposal ${nextStatus.toLowerCase()}. The partner has been notified.`);
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review partner application.')
      );
    }
  };

  const handleReviewPartnerReport = async (reportId: string) => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    try {
      await reviewPartnerReport(reportId, user.id);
      await loadPartnerReportsForProject(selectedProject.id);
      Alert.alert('Reviewed', 'Partner report marked as reviewed.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review the partner report.')
      );
    }
  };

  const handleRefreshProjectDetails = async () => {
    const currentSelectedProject = getCurrentSelectedProject();
    if (!currentSelectedProject) {
      return;
    }

    try {
      setActionLoadingKey('refresh-project');
      await handleSelectProject(currentSelectedProject);
    } finally {
      setActionLoadingKey(null);
    }
  };

  useEffect(() => {
    if (selectedProject || !shouldRestoreListScrollRef.current) {
      return;
    }

    const restoreOffset = listScrollOffsetRef.current;
    const restoreWindowOffset = windowScrollOffsetRef.current;
    const restoreTimer = setTimeout(() => {
      listScrollViewRef.current?.scrollTo({ y: restoreOffset, animated: false });

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: restoreWindowOffset, left: 0, behavior: 'auto' });
            shouldRestoreListScrollRef.current = false;
          });
        });
        return;
      }

      shouldRestoreListScrollRef.current = false;
    }, 0);

    return () => clearTimeout(restoreTimer);
  }, [selectedProject, projects.length]);

  const handleUpdateSelectedProjectImage = async (removeImage = false) => {
    const currentSelectedProject = getCurrentSelectedProject();
    if (!isAdmin || !currentSelectedProject) {
      return;
    }

    try {
      setActionLoadingKey(removeImage ? 'remove-project-image' : 'update-project-image');
      const nextImageUrl = removeImage ? '' : await pickImageFromDevice();
      if (!removeImage && !nextImageUrl) {
        return;
      }

      const updatedProject: Project = {
        ...currentSelectedProject,
        imageUrl: removeImage ? undefined : nextImageUrl || undefined,
        imageHidden: removeImage ? true : false,
        updatedAt: new Date().toISOString(),
      };

      await saveProjectLikeRecord(updatedProject);
      await loadProjects();
      setSelectedProject(updatedProject);
      Alert.alert(
        'Saved',
        removeImage
          ? `${updatedProject.isEvent ? 'Event' : 'Program'} picture removed.`
          : `${updatedProject.isEvent ? 'Event' : 'Program'} picture updated.`
      );
    } catch (error: any) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update the project picture.')
      );
    } finally {
      setActionLoadingKey(null);
    }
  };

  // Marks a volunteer's participation in the selected project as completed.
  const handleCompleteVolunteerParticipation = async (volunteerId: string) => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    try {
      await completeVolunteerProjectParticipation(selectedProject.id, volunteerId, user.id);
      await Promise.all([
        loadVolunteerJoinsForProject(selectedProject.id),
        loadVolunteers(),
        loadVolunteerMatchesForProject(selectedProject.id),
      ]);
      Alert.alert('Success', 'Volunteer marked as completed for this program.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to complete volunteer participation.')
      );
    }
  };

  const handleReviewVolunteerRequest = async (
    matchId: string,
    nextStatus: 'Matched' | 'Rejected'
  ) => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    try {
      await reviewVolunteerProjectMatch(matchId, nextStatus, user.id);
      await Promise.all([
        loadAllVolunteerMatches(),
        loadVolunteerMatchesForProject(selectedProject.id),
        loadVolunteerJoinsForProject(selectedProject.id),
        loadVolunteers(),
        loadProjects(),
      ]);
      Alert.alert(
        'Success',
        nextStatus === 'Matched'
          ? 'Volunteer approved and notified.'
          : 'Volunteer request rejected and volunteer notified.'
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review volunteer request.')
      );
    }
  };

  const confirmReviewVolunteerRequest = (
    requestEntry: ProjectVolunteerRequestEntry,
    nextStatus: 'Matched' | 'Rejected'
  ) => {
    const actionLabel = nextStatus === 'Matched' ? 'Approve' : 'Reject';
    const message =
      nextStatus === 'Matched'
        ? `Allow ${requestEntry.volunteerName} to join this program? The volunteer will be notified.`
        : `Reject ${requestEntry.volunteerName}'s join request? The volunteer will be notified.`;

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(message)) {
        void handleReviewVolunteerRequest(requestEntry.id, nextStatus);
      }
      return;
    }

    Alert.alert(
      `${actionLabel} Volunteer Request`,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: actionLabel,
          style: nextStatus === 'Rejected' ? 'destructive' : 'default',
          onPress: () => {
            void handleReviewVolunteerRequest(requestEntry.id, nextStatus);
          },
        },
      ]
    );
  };

  // Counts pending volunteer requests per project for list badges.
  const pendingVolunteerRequestCountByProjectId = useMemo(() => {
    const counts = new Map<string, number>();

    allVolunteerMatches.forEach(match => {
      if (match.status !== 'Requested') {
        return;
      }

      counts.set(match.projectId, (counts.get(match.projectId) || 0) + 1);
    });

    return counts;
  }, [allVolunteerMatches]);

  // Builds the volunteer list displayed for a specific project.
  const getProjectVolunteerEntries = (project: Project) => {
    const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
    const joinRecordByVolunteerId = new Map(
      volunteerJoinRecords.map(record => [record.volunteerId, record])
    );
    const volunteerIds = Array.from(
      new Set([
        ...project.volunteers,
        ...volunteerJoinRecords.map(record => record.volunteerId),
      ])
    );

    return volunteerIds
      .map<ProjectVolunteerEntry | null>(volunteerId => {
        const volunteer = volunteerById.get(volunteerId);
        const joinRecord = joinRecordByVolunteerId.get(volunteerId);
        if (!volunteer && !joinRecord) {
          return null;
        }

        return {
          id: volunteerId,
          name: joinRecord?.volunteerName || volunteer?.name || 'Volunteer',
          email: joinRecord?.volunteerEmail || volunteer?.email || 'No email provided',
          joinedAt: joinRecord?.joinedAt,
          source: joinRecord?.source,
          participationStatus: joinRecord?.participationStatus || 'Active',
          completedAt: joinRecord?.completedAt,
          status: volunteer?.engagementStatus,
        };
      })
      .filter((entry): entry is ProjectVolunteerEntry => entry !== null)
      .sort((a, b) => {
        const left = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
        const right = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
        return right - left;
      });
  };

  const getAssignableVolunteerOptions = (project: Project) => {
    return getProjectVolunteerEntries(project)
      .filter(entry => entry.participationStatus === 'Active')
      .map(entry => ({
        id: entry.id,
        name: entry.name,
        participationStatus: entry.participationStatus,
      }));
  };

  // Builds the volunteer-request list for the selected project.
  const getProjectVolunteerRequestEntries = () => {
    const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));

    return volunteerMatches
      .filter(match => match.status === 'Requested' || match.status === 'Rejected')
      .map<ProjectVolunteerRequestEntry | null>(match => {
        const volunteer = volunteerById.get(match.volunteerId);
        if (!volunteer) {
          return null;
        }

        return {
          id: match.id,
          volunteerId: volunteer.id,
          volunteerUserId: volunteer.userId,
          volunteerName: volunteer.name,
          volunteerEmail: volunteer.email,
          requestedAt: match.requestedAt || match.matchedAt,
          reviewedAt: match.reviewedAt,
          reviewedBy: match.reviewedBy,
          status: match.status,
        };
      })
      .filter((entry): entry is ProjectVolunteerRequestEntry => entry !== null)
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  };

  const handleSaveInternalTask = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage internal project tasks.');
      return;
    }

    const currentSelectedProject = getCurrentSelectedProject();
    if (!currentSelectedProject) {
      return;
    }

    if (!taskDraft.title.trim() || !taskDraft.description.trim() || !taskDraft.category.trim()) {
      Alert.alert('Validation Error', 'Add a task title, category, and description.');
      return;
    }

    const assignableVolunteers = getAssignableVolunteerOptions(currentSelectedProject);
    const assignedVolunteer = assignableVolunteers.find(
      volunteer => volunteer.id === taskDraft.assignedVolunteerId
    );
    if (taskDraft.assignedVolunteerId && !assignedVolunteer) {
      Alert.alert(
        'Validation Error',
        'A volunteer must already be joined to this project before they can be assigned a task.'
      );
      return;
    }
    const now = new Date().toISOString();
    const taskStatus =
      taskDraft.assignedVolunteerId && taskDraft.status === 'Unassigned'
        ? 'Assigned'
        : taskDraft.status;
    const normalizedSkills = Array.from(
      new Set(taskDraft.skillsNeeded.map(skill => skill.trim()).filter(Boolean))
    );

    if (normalizedSkills.length === 0) {
      Alert.alert('Validation Error', 'Select at least one skill for this task.');
      return;
    }

    const nextTask: ProjectInternalTask = {
      id: editingTaskId || `${currentSelectedProject.id}-task-${Date.now()}`,
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      category: taskDraft.category.trim(),
      priority: taskDraft.priority,
      status: taskStatus,
      assignedVolunteerId: taskDraft.assignedVolunteerId || undefined,
      assignedVolunteerName: assignedVolunteer?.name,
      isFieldOfficer: taskDraft.isFieldOfficer,
      skillsNeeded: normalizedSkills,
      createdAt:
        (Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : []).find(task => task.id === editingTaskId)?.createdAt || now,
      updatedAt: now,
    };

    const nextInternalTasks = editingTaskId
      ? (Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : []).map(task =>
        task.id === editingTaskId ? nextTask : task
      )
      : [...(Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : []), nextTask];

    const updatedProject: Project = {
      ...currentSelectedProject,
      internalTasks: nextInternalTasks,
      updatedAt: now,
    };

    try {
      await saveProjectLikeRecord(updatedProject);
      await loadProjects();
      setSelectedProject(updatedProject);
      closeTaskModal();
      Alert.alert(
        'Saved',
        editingTaskId
          ? 'Internal task updated and saved to the database.'
          : 'Internal task added and saved to the database.'
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to save the internal task.')
      );
    }
  };

  const handleDeleteInternalTask = (taskId: string) => {
    const currentSelectedProject = getCurrentSelectedProject();
    if (!isAdmin || !currentSelectedProject) {
      return;
    }

    Alert.alert(
      'Delete Task',
      'Remove this internal task from the project?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updatedProject: Project = {
              ...currentSelectedProject,
              internalTasks: (Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : []).filter(task => task.id !== taskId),
              updatedAt: new Date().toISOString(),
            };

            try {
              await saveProjectLikeRecord(updatedProject);
              setSelectedProject(updatedProject);
              if (editingTaskId === taskId) {
                closeTaskModal();
              }
              Alert.alert('Deleted', 'Internal task removed.');
            } catch (error) {
              Alert.alert(
                getRequestErrorTitle(error),
                getRequestErrorMessage(error, 'Failed to delete the internal task.')
              );
            }
          },
        },
      ]
    );
  };

  // Renders one project card in the lifecycle list.
  const renderProjectCard = (project: Project) => {
    const pendingRequestCount = pendingVolunteerRequestCountByProjectId.get(project.id) || 0;
    const projectImageSource = getPrimaryProjectImageSource(project);
    const projectCategoryLabel = `${project.isEvent ? 'Event' : 'Program'} | ${project.programModule || project.category}`;
    const linkedEvents = projects
      .filter(entry => entry.isEvent && entry.parentProjectId === project.id)
      .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());
    const projectDateLabel = `${format(new Date(project.startDate), 'EEE, dd MMM yyyy')} - ${format(
      new Date(project.endDate),
      'EEE, dd MMM yyyy'
    )}`;

    return (
      <View
        key={project.id}
        style={[styles.card, isDesktop ? styles.cardDesktop : styles.cardMobile]}
      >
        <TouchableOpacity onPress={() => handleSelectProject(project)} activeOpacity={0.9}>
          {projectImageSource ? (
            <Image
              source={projectImageSource}
              style={styles.cardImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.cardImage} />
          )}

          <View style={styles.cardBody}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>{project.title}</Text>
                <Text style={styles.cardSubtitle}>{projectCategoryLabel}</Text>
              </View>
              <View style={styles.cardHeaderBadges}>
                {project.isEvent ? (
                  <View style={styles.eventBadge}>
                    <MaterialIcons name="event" size={14} color="#0f766e" />
                    <Text style={styles.eventBadgeText}>Event</Text>
                  </View>
                ) : null}
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getProjectStatusColor(project) },
                  ]}
                >
                  <Text style={styles.statusText}>{getProjectDisplayStatus(project)}</Text>
                </View>
                <View style={styles.pointsBadge}>
                  <MaterialIcons name="groups" size={15} color="#f59e0b" />
                  <Text style={styles.pointsBadgeText}>
                    {project.volunteers.length}/{project.volunteersNeeded}
                  </Text>
                </View>
              </View>
            </View>

            {pendingRequestCount > 0 && (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                alignSelf: 'flex-start',
                gap: 6,
                marginBottom: 10,
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
                backgroundColor: '#fffbeb',
                borderWidth: 1,
                borderColor: '#fcd34d',
              }}>
                <MaterialIcons name="notifications-active" size={14} color="#b45309" />
                <Text style={{ color: '#92400e', fontSize: 12, fontWeight: '700' }}>
                  {pendingRequestCount} pending request{pendingRequestCount === 1 ? '' : 's'}
                </Text>
              </View>
            )}

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <View style={styles.infoRowLeading}>
                  <View style={styles.infoIconWrap}>
                    <MaterialIcons name="calendar-today" size={16} color="#ef4444" />
                  </View>
                  <View style={styles.infoRowCopy}>
                    <Text style={styles.infoRowTitle}>{projectDateLabel}</Text>
                    <Text style={styles.infoRowSubtitle}>{project.location.address}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.description}>
                {project.description}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {!project.isEvent ? (
          <View style={styles.projectEventPanel}>
            <View style={styles.projectEventPanelHeader}>
              <View style={styles.projectEventPanelCopy}>
                <Text style={styles.projectEventPanelTitle}>Events</Text>
              </View>
              <TouchableOpacity
                style={styles.projectEventPanelButton}
                onPress={() => openCreateEventModal(project)}
                activeOpacity={0.85}
              >
                <MaterialIcons name="event" size={16} color="#0f766e" />
                <Text style={styles.projectEventPanelButtonText}>Add Event</Text>
              </TouchableOpacity>
            </View>

            {linkedEvents.length === 0 ? (
              <View style={styles.projectEventEmptyState}>
                <Text style={styles.projectEventEmptyTitle}>No events yet</Text>
                <Text style={styles.projectEventEmptyMeta}>
                  Add an event to this project to open its event dashboard and task board.
                </Text>
              </View>
            ) : (
              linkedEvents.map(event => (
                <View key={event.id} style={{ position: 'relative' }}>
                  <TouchableOpacity
                    style={styles.projectEventListItem}
                    onPress={() => handleSelectProject(event)}
                    activeOpacity={0.88}
                  >
                    <View style={styles.projectEventListItemCopy}>
                      <Text style={styles.projectEventListItemTitle}>{event.title}</Text>
                      <Text style={styles.projectEventListItemMeta}>
                        {format(new Date(event.startDate), 'PPP')} | {event.location.address}
                      </Text>
                      <Text style={styles.projectEventListItemSummary} numberOfLines={2}>
                        {event.description}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', pointerEvents: 'box-none' }}>
                      {isAdmin && (
                        <>
                          <TouchableOpacity
                            style={{ backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 6, padding: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 }}
                            onPress={() => handleSelectProject(event)}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="edit" size={16} color="#6366f1" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 6, padding: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 }}
                            onPress={() => handleDeleteEventRecord(event)}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="delete" size={16} color="#ef4444" />
                          </TouchableOpacity>
                        </>
                      )}
                      <MaterialIcons name="chevron-right" size={22} color="#94a3b8" />
                    </View>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const toggleProgramSection = (module: any) => {
    setExpandedProgramModules(current => {
      const next = new Set(current);
      if (next.has(module)) {
        next.delete(module);
      } else {
        next.add(module);
      }
      return next;
    });
  };

  const renderProgramSection = (
    section: (typeof programSections)[number]
  ) => {
    const sectionProjects = section.projects.filter(project => !project.isEvent);

    return (
      <View key={section.module} style={styles.programSuiteSection}>
        <Animated.View
          style={[
            styles.programSuiteProjectsAnimatedWrap,
            {
              opacity: getProgramSectionAnimation(section.module),
              maxHeight: getProgramSectionAnimation(section.module).interpolate({
                inputRange: [0, 1],
                outputRange: [0, 5000],
              }),
              transform: [
                {
                  translateY: getProgramSectionAnimation(section.module).interpolate({
                    inputRange: [0, 1],
                    outputRange: [-14, 0],
                  }),
                },

              ],
            },
          ]}
          pointerEvents={expandedProgramModules.has(section.module) ? 'auto' : 'none'}
        >
          <View style={styles.programSuiteProjectsBlock}>
            {/* Section header with Create Project button */}
            <View style={[styles.programSuiteProjectsHeader, { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.programSuiteProjectsTitle}>{section.title} Projects</Text>
                <Text style={styles.programSuiteProjectsMeta}>
                  Open a project to see the events that belong to it, plus its event dashboard and task board.
                </Text>
              </View>
              {isAdmin && (
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: section.accent,
                    borderRadius: 8,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    marginLeft: 12,
                    shadowColor: section.accent,
                    shadowOpacity: 0.25,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 3,
                  }}
                  onPress={() => openCreateProjectInProgramModal(section.module, section.title)}
                  activeOpacity={0.82}
                >
                  <MaterialIcons name="add" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Create Project</Text>
                </TouchableOpacity>
              )}
            </View>

            {sectionProjects.length === 0 ? (
              <View style={[styles.programSuiteEmptyState, { paddingBottom: 8 }]}>
                <MaterialIcons name="inventory-2" size={28} color="#94a3b8" />
                <Text style={styles.programSuiteEmptyTitle}>No {section.title.toLowerCase()} projects yet</Text>
                <Text style={styles.programSuiteEmptyMeta}>
                  Tap "Create Project" to add the first project to this program.
                </Text>
                {isAdmin && (
                  <TouchableOpacity
                    style={{
                      marginTop: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      backgroundColor: section.accent,
                      borderRadius: 10,
                      paddingVertical: 12,
                      paddingHorizontal: 24,
                    }}
                    onPress={() => openCreateProjectInProgramModal(section.module, section.title)}
                    activeOpacity={0.82}
                  >
                    <MaterialIcons name="add-circle-outline" size={20} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Create First Project</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View>
                <View style={styles.list}>
                  {sectionProjects.map(project => (
                    <View key={project.id} style={{ position: 'relative' }}>
                      {renderProjectCard(project)}
                      {isAdmin && (
                        <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 6 }}>
                          <TouchableOpacity
                            style={{ backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 6, padding: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 }}
                            onPress={() => openEditProjectModal(project)}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="edit" size={16} color="#6366f1" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 6, padding: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 }}
                            onPress={() => {
                              const doDelete = async () => {
                                try {
                                  await deleteProjectLikeRecord(project);
                                  await loadProjects();
                                } catch (e) {
                                  Alert.alert('Error', 'Failed to delete project.');
                                }
                              };
                              Alert.alert(
                                'Delete Project',
                                `Delete "${project.title}"? This cannot be undone.`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
                                ]
                              );
                            }}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="delete" size={16} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
                {isAdmin && (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      marginTop: 12,
                      marginBottom: 4,
                      paddingVertical: 14,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderStyle: 'dashed',
                      borderColor: section.accent,
                      backgroundColor: section.surface,
                    }}
                    onPress={() => openCreateProjectInProgramModal(section.module, section.title)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="add" size={20} color={section.accent} />
                    <Text style={{ color: section.accent, fontWeight: '700', fontSize: 14 }}>Add Another Project</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

          </View>
        </Animated.View>
      </View>
    );
  };


  const renderAddProgramModal = () => null;

  const PROGRAM_ICON_OPTIONS: Array<keyof typeof MaterialIcons.glyphMap> = [
    'folder', 'school', 'local-hospital', 'restaurant', 'volunteer-activism',
    'nature-people', 'home', 'groups', 'eco', 'star', 'favorite', 'work',
  ];
  const PROGRAM_COLOR_OPTIONS = [
    '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
  ];

  const renderProgramCrudModal = () => (
    <Modal
      visible={showProgramCrudModal}
      animationType="fade"
      transparent
      onRequestClose={() => setShowProgramCrudModal(false)}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        {isAddProgramSuccess ? (
          <View style={{ backgroundColor: '#fff', width: '100%', maxWidth: 460, borderRadius: 16, padding: 32, alignItems: 'center' }}>
            <MaterialIcons name="check-circle" size={80} color="#10b981" />
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#1e293b', marginTop: 16 }}>
              {editingProgramId ? 'Program Updated!' : 'Program Created!'}
            </Text>
            <Text style={{ fontSize: 14, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
              Changes saved to program_tracks successfully.
            </Text>
          </View>
        ) : (
          <View style={{ backgroundColor: '#fff', width: '100%', maxWidth: 460, borderRadius: 16, padding: 24 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1e293b' }}>
                {editingProgramId ? 'Edit Program' : 'Create Program'}
              </Text>
              <TouchableOpacity onPress={() => setShowProgramCrudModal(false)}>
                <MaterialIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
              {/* Name */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Program Name *</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 15, color: '#1e293b', marginBottom: 16 }}
                placeholder="e.g. Community Health 2026"
                value={programDraft.title}
                onChangeText={v => setProgramDraft(d => ({ ...d, title: v }))}
                autoFocus={!editingProgramId}
              />

              {/* Description */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Description</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 14, color: '#1e293b', marginBottom: 16, minHeight: 72, textAlignVertical: 'top' }}
                placeholder="Brief description of this program..."
                value={programDraft.description}
                onChangeText={v => setProgramDraft(d => ({ ...d, description: v }))}
                multiline
              />

              {/* Color */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 }}>Accent Color</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                  {PROGRAM_COLOR_OPTIONS.map(color => (
                    <TouchableOpacity
                      key={color}
                      onPress={() => setProgramDraft(d => ({ ...d, color }))}
                      style={{
                        width: 32, height: 32, borderRadius: 16,
                        backgroundColor: color,
                        borderWidth: programDraft.color === color ? 3 : 0,
                        borderColor: '#1e293b',
                      }}
                    />
                  ))}
                </View>
              </ScrollView>

              {/* Icon */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 }}>Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                  {PROGRAM_ICON_OPTIONS.map(icon => (
                    <TouchableOpacity
                      key={icon}
                      onPress={() => setProgramDraft(d => ({ ...d, icon }))}
                      style={{
                        width: 44, height: 44, borderRadius: 10,
                        backgroundColor: programDraft.icon === icon ? programDraft.color : '#f1f5f9',
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: programDraft.icon === icon ? 2 : 1,
                        borderColor: programDraft.icon === icon ? programDraft.color : '#e2e8f0',
                      }}
                    >
                      <MaterialIcons name={icon} size={22} color={programDraft.icon === icon ? '#fff' : '#475569'} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* Image URL */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Background Image URL (optional)</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 13, color: '#1e293b', marginBottom: 4 }}
                placeholder="https://..."
                value={programDraft.imageUrl}
                onChangeText={v => setProgramDraft(d => ({ ...d, imageUrl: v }))}
                autoCapitalize="none"
                keyboardType="url"
              />
              <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 20 }}>Used as a subtle card background texture.</Text>
            </ScrollView>

            {/* Actions */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={{ paddingVertical: 11, paddingHorizontal: 18, borderRadius: 8, backgroundColor: '#f1f5f9' }}
                onPress={() => setShowProgramCrudModal(false)}
              >
                <Text style={{ color: '#475569', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ paddingVertical: 11, paddingHorizontal: 20, borderRadius: 8, backgroundColor: programDraft.color || '#6366f1', opacity: actionLoadingKey === 'saveProgramCrud' ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                onPress={handleSaveProgramCrud}
                disabled={actionLoadingKey === 'saveProgramCrud'}
              >
                {actionLoadingKey === 'saveProgramCrud'
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <MaterialIcons name={editingProgramId ? 'save' : 'add'} size={16} color="#fff" />}
                <Text style={{ color: '#fff', fontWeight: '700' }}>{editingProgramId ? 'Save Changes' : 'Create Program'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );

  const renderProjectEditorModal = () => (
    <Modal
      visible={showProjectModal}
      animationType="slide"
      onRequestClose={closeProjectModal}
    >
      <View style={styles.modalContainer}>
        {isProjectSaveSuccess ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#fff', width: '100%', maxWidth: 520, borderRadius: 18, padding: 32, alignItems: 'center' }}>
              <MaterialIcons name="check-circle" size={84} color="#10b981" />
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#1e293b', marginTop: 18, textAlign: 'center' }}>
                {editingProjectId
                  ? projectDraft.isEvent
                    ? 'Event Saved!'
                    : 'Project Saved!'
                  : projectDraft.isEvent
                    ? 'Event Created!'
                    : 'Project Created!'}
              </Text>
              <Text style={{ fontSize: 14, color: '#64748b', marginTop: 10, textAlign: 'center', lineHeight: 20 }}>
                {editingProjectId
                  ? projectDraft.isEvent
                    ? 'Your event updates were saved to the database successfully.'
                    : 'Your project changes were saved to the database successfully.'
                  : projectDraft.isEvent
                    ? 'Your event was created and saved to the database successfully.'
                    : 'Your project was created and saved to the database successfully.'}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeProjectModal}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingProjectId
                  ? projectDraft.isEvent
                    ? 'Edit Event'
                    : 'Edit Project'
                  : projectDraft.isEvent
                    ? 'Create Event'
                    : 'Create Project'}
              </Text>
              <TouchableOpacity onPress={handleSaveProjectRecord}>
                <Text style={styles.projectModalSave}>Save</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {projectSaveError ? (
                <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                  <Text style={{ color: '#b91c1c', fontSize: 13, fontWeight: '600' }}>{projectSaveError}</Text>
                </View>
              ) : null}

              <View style={[styles.formRow, styles.formRowReverse]}>
                <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="Project title"
              placeholderTextColor="#999"
              value={projectDraft.title}
              onChangeText={value => handleProjectDraftChange('title', value)}
            />
            <Text style={styles.labelRight}>Title</Text>
          </View>

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel]}
              placeholder="Project description"
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              value={projectDraft.description}
              onChangeText={value => handleProjectDraftChange('description', value)}
            />
            <Text style={[styles.labelRight, styles.labelTop]}>Description</Text>
          </View>

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <View style={[styles.statusOptions, styles.statusOptionsCard]}>
              {projectModules.map(category => (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.statusOption,
                    projectDraft.programModule === category && styles.statusOptionSelected,
                  ]}
                  onPress={() => handleProjectDraftChange('programModule', category)}
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      projectDraft.programModule === category && styles.statusOptionTextSelected,
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.labelRight, styles.labelTop]}>Program Module</Text>
          </View>

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <View style={[styles.statusOptions, styles.statusOptionsCard]}>
              {statuses.map(status => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.statusOption,
                    projectDraft.status === status && styles.statusOptionSelected,
                  ]}
                  onPress={() => handleProjectDraftChange('status', status as Project['status'])}
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      projectDraft.status === status && styles.statusOptionTextSelected,
                    ]}
                  >
                    {status}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.labelRight, styles.labelTop]}>Status</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <View style={[styles.statusOptions, styles.statusOptionsCard]}>
              {projectEditorMode === 'event' || projectDraft.isEvent ? (
                <TouchableOpacity
                  style={[styles.statusOption, styles.statusOptionSelected]}
                  disabled
                >
                  <Text style={[styles.statusOptionText, styles.statusOptionTextSelected]}>
                    Event
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.statusOption, styles.statusOptionSelected]}
                  onPress={() => handleProjectDraftChange('isEvent', false)}
                >
                  <Text style={[styles.statusOptionText, styles.statusOptionTextSelected]}>
                    Project
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.labelRight}>Type</Text>
          </View>

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <View style={[styles.statusOptionsCard, styles.projectImageEditorCard]}>
              <View style={styles.projectImageEditorHeader}>
                <Text style={styles.projectImageEditorTitle}>Project Picture</Text>
                <Text style={styles.projectImageEditorMeta}>
                  Upload or replace the picture shown in the project panels, project list, and map preview.
                </Text>
              </View>

              <View style={styles.projectImageEditorActions}>
                <TouchableOpacity style={styles.projectImagePickerButton} onPress={handlePickProjectImage}>
                  <MaterialIcons name="photo-library" size={18} color="#166534" />
                  <Text style={styles.projectImagePickerButtonText}>
                    {projectDraft.imageUrl ? 'Replace Picture' : 'Upload Picture'}
                  </Text>
                </TouchableOpacity>

                {projectDraft.imageUrl ? (
                  <TouchableOpacity style={styles.projectImageRemoveButton} onPress={handleRemoveProjectImage}>
                    <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                    <Text style={styles.projectImageRemoveButtonText}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {projectDraft.imageUrl ? (
                <View style={styles.projectImagePreviewCard}>
                  {isImageMediaUri(projectDraft.imageUrl) ? (
                    <Image
                      source={{ uri: projectDraft.imageUrl }}
                      style={styles.projectImagePreview}
                      resizeMode="cover"
                    />
                  ) : null}
                  <Text style={styles.projectImagePreviewMeta}>Custom project image ready</Text>
                </View>
              ) : (
                <View style={styles.projectImageEmptyState}>
                  <MaterialIcons name="image" size={22} color="#94a3b8" />
                  <Text style={styles.projectImageEmptyStateText}>
                      No custom picture uploaded yet. The app will use the default project image.
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.labelRight, styles.labelTop]}>Picture</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TouchableOpacity
              style={[styles.datePickerButton, styles.inputWithLabel]}
              onPress={() => {
                setDatePickerMode('startDate');
                setSelectedDate(projectDraft.startDate ? new Date(projectDraft.startDate) : new Date());
                setShowDatePicker(true);
              }}
            >
              <MaterialIcons name="calendar-today" size={20} color="#4CAF50" />
              <Text style={styles.datePickerButtonText}>
                {projectDraft.startDate
                  ? new Date(projectDraft.startDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                  : 'Select start date'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.labelRight}>Start Date</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TouchableOpacity
              style={[styles.datePickerButton, styles.inputWithLabel]}
              onPress={() => {
                setDatePickerMode('endDate');
                setSelectedDate(projectDraft.endDate ? new Date(projectDraft.endDate) : new Date());
                setShowDatePicker(true);
              }}
            >
              <MaterialIcons name="calendar-today" size={20} color="#4CAF50" />
              <Text style={styles.datePickerButtonText}>
                {projectDraft.endDate
                  ? new Date(projectDraft.endDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                  : 'Select end date'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.labelRight}>End Date</Text>
          </View>

          {projectDraft.isEvent && projectDraftParentProject ? (
            <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
              <View style={[styles.statusOptionsCard, styles.helperPanel]}>
                <Text style={styles.helperPanelTitle}>Event schedule must differ from the parent project</Text>
                <Text style={styles.helperPanelText}>
                  Parent project window: {projectDraftParentProject.startDate.slice(0, 10)} to{' '}
                  {projectDraftParentProject.endDate.slice(0, 10)}. Set an event-specific start and end date inside
                  that range.
                </Text>
              </View>
              <Text style={[styles.labelRight, styles.labelTop]}>Date Rule</Text>
            </View>
          ) : null}

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <View style={[styles.statusOptionsCard, styles.inputWithLabel]}>
              <Text style={styles.locationPickerLabel}>Region</Text>
              <View style={styles.locationPickerContainer}>
                <Picker
                  selectedValue={projectRegionCode}
                  onValueChange={(itemValue: string) => handleProjectRegionChange(itemValue)}
                  style={styles.locationPicker}
                >
                  <Picker.Item label="Select Region..." value="" />
                  {PHRegions.map(region => (
                    <Picker.Item key={region.code} label={region.name} value={region.code} />
                  ))}
                </Picker>
              </View>

              <Text style={styles.locationPickerLabel}>City / Municipality</Text>
              <View style={styles.locationPickerContainer}>
                <Picker
                  selectedValue={projectCityCode}
                  onValueChange={(itemValue: string) => handleProjectCityChange(itemValue)}
                  enabled={projectRegionCode !== ''}
                  style={styles.locationPicker}
                >
                  <Picker.Item label="Select City/Municipality..." value="" />
                  {projectLocationCities.map(city => (
                    <Picker.Item key={city.code} label={city.displayName} value={city.code} />
                  ))}
                </Picker>
              </View>

              <Text style={styles.locationPickerLabel}>Barangay</Text>
              <View style={styles.locationPickerContainer}>
                <Picker
                  selectedValue={projectBarangayCode}
                  onValueChange={(itemValue: string) => handleProjectBarangayChange(itemValue)}
                  enabled={projectCityCode !== ''}
                  style={styles.locationPicker}
                >
                  <Picker.Item label="Select Barangay..." value="" />
                  {projectLocationBarangays.map(barangay => (
                    <Picker.Item
                      key={barangay.code}
                      label={barangay.displayName}
                      value={barangay.code}
                    />
                  ))}
                </Picker>
              </View>

              <Text style={styles.locationPickerHelperText}>
                {projectDraft.address || 'Choose region, city/municipality, and barangay to set the place.'}
              </Text>
            </View>
            <Text style={[styles.labelRight, styles.labelTop]}>Place</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="Volunteer slots"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              value={projectDraft.volunteersNeeded}
              onChangeText={value => handleProjectDraftChange('volunteersNeeded', value)}
            />
            <Text style={styles.labelRight}>Volunteer Slots</Text>
          </View>

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <View style={[styles.statusOptionsCard, styles.skillSelectionCard]}>
              <Text style={styles.helperPanelTitle}>Skills Needed</Text>
              <Text style={styles.helperPanelText}>
                Select skills needed for this project or event. You can also add a custom skill.
              </Text>

              <View style={styles.skillOptionGrid}>
                {TASK_SKILL_OPTIONS.map(skill => {
                  const selected = projectDraft.skillsNeeded.includes(skill);
                  return (
                    <TouchableOpacity
                      key={skill}
                      style={[
                        styles.skillOptionRow,
                        selected && styles.dropdownOptionSelected,
                      ]}
                      onPress={() => toggleProjectSkill(skill)}
                    >
                      <Text
                        style={[
                          styles.skillOptionText,
                          selected && styles.skillOptionTextSelected,
                        ]}
                      >
                        {skill}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.customSkillRow}>
                <TextInput
                  style={styles.customSkillInput}
                  placeholder="Add new skill"
                  placeholderTextColor="#999"
                  value={customProjectSkill}
                  onChangeText={setCustomProjectSkill}
                />
                <TouchableOpacity
                  style={styles.customSkillAddButton}
                  onPress={handleAddCustomProjectSkill}
                >
                  <Text style={styles.customSkillAddButtonText}>Add</Text>
                </TouchableOpacity>
              </View>

              {projectDraft.skillsNeeded.length > 0 ? (
                <View style={styles.selectedSkillChips}>
                  {projectDraft.skillsNeeded.map(skill => (
                    <TouchableOpacity
                      key={skill}
                      style={styles.selectedSkillChip}
                      onPress={() => removeProjectSkill(skill)}
                    >
                      <Text style={styles.selectedSkillChipText}>{skill}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
            <Text style={[styles.labelRight, styles.labelTop]}>Skills</Text>
          </View>

          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSaveProjectRecord}
          >
            <Text style={styles.submitButtonText}>
              {editingProjectId
                ? projectDraft.isEvent
                  ? 'Update Event'
                  : 'Update Project'
                : projectDraft.isEvent
                  ? 'Create Event'
                  : 'Create Project'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
          </>
        )}
      </View>

      {/* Date Picker Modal */}
      <Modal
        visible={showDatePicker}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.datePickerOverlay}>
          <CalendarDatePicker
            selectedDate={selectedDate}
            onDateSelect={(date) => {
              setSelectedDate(date);
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const dateString = `${year}-${month}-${day}`;
              handleProjectDraftChange(datePickerMode, dateString);
              setShowDatePicker(false);
            }}
            onClose={() => setShowDatePicker(false)}
          />
        </View>
      </Modal>
    </Modal>
  );

  const renderProgramProposalModal = () => {
    const module = selectedProgramProposalModule;
    const proposalProjectId = module ? buildProgramProposalProjectId(module) : '';
    const pendingProposal =
      module && showProgramProposalModal
        ? allPartnerApplications.find(
          application =>
            application.projectId === proposalProjectId && application.status === 'Pending'
        ) || null
        : null;

    return (
      <Modal
        visible={showProgramProposalModal}
        transparent
        animationType="fade"
        onRequestClose={closeProgramProposalModal}
      >
        <View style={styles.proposalModalBackdrop}>
          <View style={styles.proposalModalCard}>
            <View style={styles.proposalModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.proposalModalTitle}>Pending Proposal</Text>
                <Text style={styles.proposalModalSubtitle}>
                  {module ? `${module} program` : 'Program proposal'}
                </Text>
              </View>
              <TouchableOpacity onPress={closeProgramProposalModal} style={styles.proposalModalClose}>
                <MaterialIcons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.proposalModalScroll}
              contentContainerStyle={styles.proposalModalScrollContent}
              showsVerticalScrollIndicator={Platform.OS === 'web'}
            >
              {pendingProposal ? (
                <View style={styles.applicationCard}>
                  <View style={styles.applicationHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.applicationName}>{pendingProposal.partnerName}</Text>
                      <Text style={styles.applicationMeta}>{pendingProposal.partnerEmail}</Text>
                      <Text style={styles.applicationMeta}>
                        Requested {format(new Date(pendingProposal.requestedAt), 'PPpp')}
                      </Text>
                    </View>
                    <View style={[styles.applicationStatusBadge, styles.applicationStatusPending]}>
                      <Text style={styles.applicationStatusText}>{pendingProposal.status}</Text>
                    </View>
                  </View>

                  <View style={styles.proposalDetailSection}>
                    <Text style={styles.proposalDetailSectionTitle}>Proposal Overview</Text>
                    <View style={styles.proposalHighlightCard}>
                      <Text style={styles.proposalHighlightLabel}>Based on existing program</Text>
                      <Text style={styles.proposalHighlightTitle}>
                        {pendingProposal.proposalDetails?.targetProjectTitle || 'Not specified'}
                      </Text>
                      <Text style={styles.proposalHighlightMeta}>
                        {pendingProposal.proposalDetails?.requestedProgramModule || module || 'Program module'}
                      </Text>
                      {pendingProposal.proposalDetails?.targetProjectDescription ? (
                        <Text style={styles.proposalHighlightBody}>
                          {pendingProposal.proposalDetails.targetProjectDescription}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.proposalInfoGrid}>
                      <View style={styles.proposalInfoCard}>
                        <Text style={styles.proposalInfoLabel}>Proposal Title</Text>
                        <Text style={styles.proposalInfoValue}>
                          {pendingProposal.proposalDetails?.proposedTitle || 'Not provided'}
                        </Text>
                      </View>

                      <View style={styles.proposalInfoCard}>
                        <Text style={styles.proposalInfoLabel}>Volunteers Needed</Text>
                        <Text style={styles.proposalInfoValue}>
                          {pendingProposal.proposalDetails?.proposedVolunteersNeeded ?? 'Not provided'}
                        </Text>
                      </View>

                      <View style={styles.proposalInfoCard}>
                        <Text style={styles.proposalInfoLabel}>Skills Needed</Text>
                        <Text style={styles.proposalInfoValue}>
                          {pendingProposal.proposalDetails?.skillsNeeded?.length
                            ? pendingProposal.proposalDetails.skillsNeeded.join(', ')
                            : 'Not specified'}
                        </Text>
                      </View>

                      <View style={styles.proposalInfoCard}>
                        <Text style={styles.proposalInfoLabel}>Start Date</Text>
                        <Text style={styles.proposalInfoValue}>
                          {formatProposalDateValue(pendingProposal.proposalDetails?.proposedStartDate)}
                        </Text>
                      </View>

                      <View style={styles.proposalInfoCard}>
                        <Text style={styles.proposalInfoLabel}>End Date</Text>
                        <Text style={styles.proposalInfoValue}>
                          {formatProposalDateValue(pendingProposal.proposalDetails?.proposedEndDate)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.proposalNarrativeCard}>
                      <Text style={styles.proposalInfoLabel}>Proposed Description</Text>
                      <Text style={styles.proposalNarrativeText}>
                        {pendingProposal.proposalDetails?.proposedDescription || 'Not provided'}
                      </Text>
                    </View>

                    <View style={styles.proposalNarrativeCard}>
                      <Text style={styles.proposalInfoLabel}>Proposed Location</Text>
                      <Text style={styles.proposalNarrativeText}>
                        {pendingProposal.proposalDetails?.proposedLocation || 'Not provided'}
                      </Text>
                    </View>

                    <View style={styles.proposalNarrativeCard}>
                      <Text style={styles.proposalInfoLabel}>Community Need</Text>
                      <Text style={styles.proposalNarrativeText}>
                        {pendingProposal.proposalDetails?.communityNeed || 'Not provided'}
                      </Text>
                    </View>

                    <View style={styles.proposalNarrativeCard}>
                      <Text style={styles.proposalInfoLabel}>Expected Deliverables</Text>
                      <Text style={styles.proposalNarrativeText}>
                        {pendingProposal.proposalDetails?.expectedDeliverables || 'Not provided'}
                      </Text>
                    </View>
                  </View>

                  {isAdmin && (
                    <View style={styles.applicationActions}>
                      <TouchableOpacity
                        style={[styles.applicationButton, styles.approveButton]}
                        onPress={async () => {
                          closeProgramProposalModal();
                          await handleReviewPartnerApplication(pendingProposal.id, 'Approved');
                        }}
                      >
                        <Text style={styles.applicationButtonText}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.applicationButton, styles.rejectButton]}
                        onPress={async () => {
                          closeProgramProposalModal();
                          await handleReviewPartnerApplication(pendingProposal.id, 'Rejected');
                        }}
                      >
                        <Text style={styles.applicationButtonText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.proposalModalEmpty}>
                  <Text style={styles.proposalModalEmptyTitle}>No pending proposal</Text>
                  <Text style={styles.proposalModalEmptyMeta}>
                    This program has no pending proposal right now.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const schedulerAnchorDate = useMemo(() => {
    const requestedProjectId = route?.params?.projectId;
    const requestedProject = requestedProjectId
      ? projects.find(project => project.id === requestedProjectId)
      : null;
    const defaultDate = new Date(selectedSchedulerYear, selectedSchedulerMonth, 1);
    const candidateDate = selectedProject?.startDate || requestedProject?.startDate;
    const parsedDate = candidateDate ? new Date(candidateDate) : defaultDate;
    const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    if (
      safeDate.getFullYear() === selectedSchedulerYear &&
      safeDate.getMonth() === selectedSchedulerMonth
    ) {
      return safeDate;
    }

    return new Date(selectedSchedulerYear, selectedSchedulerMonth, 1);
  }, [
    projects,
    route?.params?.projectId,
    selectedProject?.startDate,
    selectedSchedulerMonth,
    selectedSchedulerYear,
  ]);

  const schedulerCalendarDays = useMemo(() => {
    return getMonthCalendarDays(schedulerAnchorDate);
  }, [schedulerAnchorDate]);

  const schedulerCalendarWeeks = useMemo(
    () => [0, 1, 2, 3, 4, 5].map(weekIndex => schedulerCalendarDays.slice(weekIndex * 7, weekIndex * 7 + 7)),
    [schedulerCalendarDays]
  );

  const schedulerCalendarWindow = useMemo(() => {
    const start = schedulerCalendarDays[0] || getStartOfWeekSunday(new Date());
    const end = schedulerCalendarDays[41] || start;
    return { start, end };
  }, [schedulerCalendarDays]);

  const schedulerRangeLabel = useMemo(() => {
    const rangeStart = schedulerCalendarDays[0] || schedulerAnchorDate;
    const rangeEnd = schedulerCalendarDays[schedulerCalendarDays.length - 1] || schedulerAnchorDate;
    return `${format(rangeStart, 'MMM d')} - ${format(rangeEnd, 'MMM d, yyyy')}`;
  }, [schedulerAnchorDate, schedulerCalendarDays]);

  const activeProgramTracks = useMemo(
    () =>
      programTracks
        .filter(track => track.isActive !== false)
        .sort(
          (left, right) =>
            (Number(left.sortOrder || 0) - Number(right.sortOrder || 0)) ||
            String(left.id).localeCompare(String(right.id))
        ),
    [programTracks]
  );

  const activeProgramTrackIds = useMemo(
    () => new Set(activeProgramTracks.map(track => String(track.id).trim())),
    [activeProgramTracks]
  );

  const availableProgramCount = activeProgramTracks.length;

  const suiteScheduledProjects = useMemo(
    () =>
      projects
        .filter(project => {
          const module = getProgramSuiteModuleForProject(project, activeProgramTrackIds);
          if (!module) {
            return false;
          }

          const startDate = new Date(project.startDate);
          const endDate = new Date(project.endDate);

          if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return false;
          }

          return (
            isDateOverlappingRange(schedulerCalendarWindow.start, startDate, endDate) ||
            isDateOverlappingRange(schedulerCalendarWindow.end, startDate, endDate) ||
            isDateOverlappingRange(startDate, schedulerCalendarWindow.start, schedulerCalendarWindow.end)
          );
        })
        .sort(compareProjectsForCalendarVisibility),
    [projects, schedulerCalendarWindow.end, schedulerCalendarWindow.start]
  );

  const monthProjectCalendarProjects = useMemo(
    () =>
      [...projects].sort(
        (left, right) =>
          new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
          left.title.localeCompare(right.title)
      ).filter(project => !project.isEvent),
    [projects]
  );

  const schedulerProjectsByDate = useMemo(() => {
    const nextEventsByDate = new Map<string, Project[]>();

    schedulerCalendarDays.forEach(day => {
      const dayProjects = projects.filter(project => {
        if (project.isEvent) {
          return false;
        }

        const startDate = new Date(project.startDate);
        return isSameCalendarDay(day, startDate);
      });

      nextEventsByDate.set(getDateKey(day), dayProjects);
    });

    return nextEventsByDate;
  }, [projects, schedulerCalendarDays]);

  const schedulerFeaturedProjects = useMemo(
    () =>
      [...projects]
        .filter(project => !project.isEvent)
        .sort(
          (left, right) =>
            new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
            left.title.localeCompare(right.title)
        ),
    [projects]
  );

  const programSections = useMemo(
    () =>
      activeProgramTracks.map(track => {
        const module = String(track.id).trim();
        const proposalProjectId = buildProgramProposalProjectId(module);
        const pendingProposalApplication =
          allPartnerApplications.find(
            application =>
              application.projectId === proposalProjectId && application.status === 'Pending'
          ) || null;
        const sectionProjects = projects
          .filter(project => getProgramSuiteModuleForProject(project, activeProgramTrackIds) === module)
          .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());

        return {
          module,
          title: track.title || module,
          description: track.description || '',
          icon: normalizeProgramTrackIcon(track.icon),
          accent: normalizeProgramTrackColor(track.color),
          surface: '#f5f3ff',
          border: '#ddd6fe',
          imageUrl: track.imageUrl,
          projects: sectionProjects,
          totalPrograms: sectionProjects.filter(project => !project.isEvent).length,
          inProgressCount: sectionProjects.filter(project => getProjectDisplayStatus(project) === 'In Progress').length,
          planningCount: sectionProjects.filter(project => getProjectDisplayStatus(project) === 'Planning').length,
          eventCount: sectionProjects.filter(project => project.isEvent).length,
          pendingProposalCount: pendingProposalApplication ? 1 : 0,
        };
      }),
    [activeProgramTracks, allPartnerApplications, projects]
  );

  const programMutationInProgress =
    actionLoadingKey === 'saveProgramCrud' ||
    actionLoadingKey === 'addProgram' ||
    String(actionLoadingKey || '').startsWith('deleteProgram-');

  useEffect(() => {
    programSections.forEach(section => {
      Animated.timing(getProgramSectionAnimation(section.module), {
        toValue: expandedProgramModules.has(section.module) ? 1 : 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    });
  }, [expandedProgramModules, programSections]);

  const activeSelectedProject = getCurrentSelectedProject();

  if (activeSelectedProject) {
    const volunteerEntries = getProjectVolunteerEntries(activeSelectedProject);
    const assignableVolunteerOptions = getAssignableVolunteerOptions(activeSelectedProject);
    const volunteerRequestEntries = getProjectVolunteerRequestEntries();
    const pendingVolunteerRequestEntries = volunteerRequestEntries.filter(
      requestEntry => requestEntry.status === 'Requested',
    );
    const rejectedVolunteerRequestEntries = volunteerRequestEntries.filter(
      requestEntry => requestEntry.status === 'Rejected',
    );
    const projectTimeLogEntries: ProjectTimeLogEntry[] = volunteerTimeLogs
      .filter(log => log.projectId === activeSelectedProject.id)
      .map(log => {
        const volunteer = volunteers.find(entry => entry.id === log.volunteerId);
        return {
          ...log,
          volunteerName: volunteer?.name || 'Volunteer',
          volunteerEmail: volunteer?.email || 'No email on file',
        };
      });
    const projectTimeInCount = projectTimeLogEntries.length;
    const projectTimeOutCount = projectTimeLogEntries.filter(log => Boolean(log.timeOut)).length;
    const selectedPartnerName =
      partners.find(partner => partner.id === activeSelectedProject.partnerId)?.name ||
      activeSelectedProject.partnerId ||
      '';
    const hasPartneredOrg = Boolean(selectedPartnerName);
    const activeProjectImageSource = getPrimaryProjectImageSource(activeSelectedProject);
    const hasCustomProjectImage = Boolean(activeSelectedProject.imageUrl && isImageMediaUri(activeSelectedProject.imageUrl));
    const hasVisibleProjectImage = Boolean(activeProjectImageSource);
    const internalTasks = Array.isArray(activeSelectedProject.internalTasks) ? activeSelectedProject.internalTasks : [];
    const parentProject =
      activeSelectedProject.parentProjectId
        ? projects.find(project => project.id === activeSelectedProject.parentProjectId) || null
        : null;
    const detailEntityLabel = activeSelectedProject.isEvent ? 'Event' : 'Program';
    const detailWorkspaceLabel = activeSelectedProject.isEvent ? 'Event Workspace' : 'Program Workspace';
    const detailModuleLabel = activeSelectedProject.programModule || activeSelectedProject.category;
    const formattedStartDate = formatProjectDateLabel(activeSelectedProject.startDate);
    const formattedEndDate = formatProjectDateLabel(activeSelectedProject.endDate);
    const formattedScheduleRange = formatProjectDateRangeLabel(
      activeSelectedProject.startDate,
      activeSelectedProject.endDate
    );
    const volunteerSlotsFilled = activeSelectedProject.volunteers.length;
    const volunteerSlotsNeeded = activeSelectedProject.volunteersNeeded;
    const remainingVolunteerSlots = Math.max(volunteerSlotsNeeded - volunteerSlotsFilled, 0);
    const pendingVolunteerRequestCount = pendingVolunteerRequestEntries.length;
    const latestTimeActivityLabel = projectTimeLogEntries[0]
      ? projectTimeLogEntries[0].timeOut
        ? `Time out ${format(new Date(projectTimeLogEntries[0].timeOut), 'PPpp')}`
        : `Time in ${format(new Date(projectTimeLogEntries[0].timeIn), 'PPpp')}`
      : 'No time logs yet';
    const overviewCards = [
      {
        label: activeSelectedProject.isEvent ? 'Campaign' : 'Program Module',
        value: detailModuleLabel,
        meta: activeSelectedProject.isEvent ? 'Linked advocacy focus' : 'Primary focus area',
      },
      ...(hasPartneredOrg
        ? [
          {
            label: 'Partner',
            value: selectedPartnerName,
            meta: 'Coordinating organization',
          },
        ]
        : []),
      {
        label: 'Schedule',
        value: formattedScheduleRange,
        meta: activeSelectedProject.isEvent ? 'Event window' : 'Project timeline',
      },
      {
        label: 'Volunteer Slots',
        value: `${volunteerSlotsFilled}/${volunteerSlotsNeeded}`,
        meta:
          remainingVolunteerSlots > 0
            ? `${remainingVolunteerSlots} slot${remainingVolunteerSlots === 1 ? '' : 's'} still open`
            : 'All volunteer slots are filled',
      },
      {
        label: 'Location',
        value: activeSelectedProject.location.address || 'Location not set',
        meta: activeSelectedProject.isEvent ? 'Venue and meetup point' : 'Primary project site',
      },
    ];
    const setupDetails = [
      {
        label: 'Project Type',
        value: detailEntityLabel,
        meta: activeSelectedProject.isEvent
          ? 'Use this record for event execution and staffing.'
          : 'Use this record for long-running program coordination.',
      },
      {
        label: activeSelectedProject.isEvent ? 'Parent Program' : 'Program Module',
        value: activeSelectedProject.isEvent
          ? parentProject?.title || detailModuleLabel
          : detailModuleLabel,
        meta: activeSelectedProject.isEvent
          ? 'This event inherits its parent program context.'
          : 'Main advocacy area for planning and reporting.',
      },
      ...(hasPartneredOrg
        ? [
          {
            label: 'Partnered Organization',
            value: selectedPartnerName,
            meta: 'Primary delivery partner for this work.',
          },
        ]
        : []),
    ];
    const logisticsDetails = [
      {
        label: 'Start Date',
        value: formattedStartDate,
        meta: 'Planned kickoff date',
      },
      {
        label: 'End Date',
        value: formattedEndDate,
        meta: 'Expected wrap-up date',
      },
      {
        label: 'Location',
        value: activeSelectedProject.location.address || 'Location not set',
        meta: 'Address used in project and event views',
      },
      {
        label: 'Volunteer Capacity',
        value: `${volunteerSlotsFilled}/${volunteerSlotsNeeded}`,
        meta:
          remainingVolunteerSlots > 0
            ? `${remainingVolunteerSlots} more volunteer${remainingVolunteerSlots === 1 ? '' : 's'} can join`
            : 'Capacity reached',
      },
    ];
    const eventOperationsDetails = activeSelectedProject.isEvent
      ? [
        {
          label: 'Start Date',
          value: formattedStartDate,
          meta: 'Admins can customize this in Edit Event',
        },
        {
          label: 'End Date',
          value: formattedEndDate,
          meta: 'Admins can customize this in Edit Event',
        },
        {
          label: 'Event Name',
          value: activeSelectedProject.title,
          meta: 'Displayed across volunteer and admin views',
        },
        {
          label: 'Parent Program',
          value: parentProject?.title || detailModuleLabel,
          meta: 'Used for context and reporting',
        },
        {
          label: 'Skills Needed',
          value: (activeSelectedProject.skillsNeeded || []).length > 0
            ? (activeSelectedProject.skillsNeeded || []).join(', ')
            : 'No skills tagged',
          meta: 'Aggregated from this event’s task skills and event skill tags',
        },
        {
          label: 'Task Board',
          value: `${internalTasks.length} task${internalTasks.length === 1 ? '' : 's'}`,
          meta: internalTasks.length ? 'Assignments are ready to review' : 'No tasks created yet',
        },
        {
          label: 'Join Requests',
          value: `${pendingVolunteerRequestCount}`,
          meta:
            pendingVolunteerRequestCount > 0
              ? 'Requests are waiting for review'
              : 'No requests currently pending',
        },
      ]
      : [];

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.detailsScreenContent}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleReturnToProjectList}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>{activeSelectedProject.isEvent ? 'Event Details' : 'Project Details'}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailsHero}>
            <View style={styles.detailsHeroHeader}>
              <View style={styles.detailsHeroCopy}>
                <Text style={styles.detailsEyebrow}>{detailWorkspaceLabel}</Text>
                <Text style={styles.detailsTitle}>{activeSelectedProject.title}</Text>
                <Text style={styles.detailsSubtitle}>{activeSelectedProject.description}</Text>
              </View>
              <View
                style={[
                  styles.detailsHeroStatus,
                  { backgroundColor: getProjectStatusColor(activeSelectedProject) },
                ]}
              >
                <Text style={styles.statusText}>{getProjectDisplayStatus(activeSelectedProject)}</Text>
              </View>
            </View>

            <View style={styles.detailsMediaPanel}>
              <View style={styles.detailsMediaPreviewWrap}>
                {activeProjectImageSource ? (
                  <Image
                    source={activeProjectImageSource}
                    style={styles.detailsMediaPreview}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.detailsMediaEmptyState}>
                    <MaterialIcons name="image" size={30} color="#94a3b8" />
                    <Text style={styles.detailsMediaEmptyText}>No picture available</Text>
                  </View>
                )}
              </View>

              <View style={styles.detailsMediaCopy}>
                <Text style={styles.detailsMediaTitle}>{detailEntityLabel} Picture</Text>
                <Text style={styles.detailsMediaMeta}>
                  This image appears in cards, previews, and supporting screens so volunteers and admins can recognize this record quickly.
                </Text>
                <Text style={styles.detailsMediaStatus}>
                  {hasCustomProjectImage
                    ? 'Custom image saved for this project.'
                    : hasVisibleProjectImage
                      ? 'Using the default fallback image for this program.'
                      : 'No image will be shown for this project right now.'}
                </Text>

                {isAdmin ? (
                  <View style={styles.detailsMediaActions}>
                    <TouchableOpacity
                      style={[
                        styles.detailsMediaButton,
                        Boolean(actionLoadingKey) && styles.detailsActionButtonDisabled,
                      ]}
                      onPress={() => {
                        void handleUpdateSelectedProjectImage(false);
                      }}
                      disabled={Boolean(actionLoadingKey)}
                    >
                      {actionLoadingKey === 'update-project-image' ? (
                        <ActivityIndicator size="small" color="#166534" />
                      ) : (
                        <MaterialIcons name="photo-library" size={18} color="#166534" />
                      )}
                      <Text style={styles.detailsMediaButtonText}>
                        {hasVisibleProjectImage ? 'Change Picture' : 'Add Picture'}
                      </Text>
                    </TouchableOpacity>

                    {hasVisibleProjectImage ? (
                      <TouchableOpacity
                        style={[
                          styles.detailsMediaRemoveButton,
                          Boolean(actionLoadingKey) && styles.detailsActionButtonDisabled,
                        ]}
                        onPress={() => {
                          void handleUpdateSelectedProjectImage(true);
                        }}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        {actionLoadingKey === 'remove-project-image' ? (
                          <ActivityIndicator size="small" color="#b91c1c" />
                        ) : (
                          <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                        )}
                        <Text style={styles.detailsMediaRemoveButtonText}>Remove</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.detailsQuickGrid}>
              {overviewCards.map(card => (
                <View key={card.label} style={styles.detailsQuickCard}>
                  <Text style={styles.detailsQuickLabel}>{card.label}</Text>
                  <Text style={styles.detailsQuickValue}>{card.value}</Text>
                  <Text style={styles.detailsQuickMeta}>{card.meta}</Text>
                </View>
              ))}
            </View>
          </View>

          {activeSelectedProject.isEvent ? (
            <View style={[styles.detailsSection, styles.detailsSectionCard]}>
              <Text style={styles.sectionTitle}>Event Operations</Text>
              <Text style={styles.sectionHint}>
                Review the parent program, staffing, and assignments from one event workspace.
              </Text>
              <View style={styles.detailFieldGrid}>
                {eventOperationsDetails.map(field => (
                  <View key={field.label} style={styles.detailField}>
                    <Text style={styles.detailFieldLabel}>{field.label}</Text>
                    <Text style={styles.detailFieldValue}>{field.value}</Text>
                    <Text style={styles.detailFieldMeta}>{field.meta}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {isAdmin && (
            <View style={styles.detailsActionRow}>
              <TouchableOpacity
                style={[styles.detailsActionButton, Boolean(actionLoadingKey) && styles.detailsActionButtonDisabled]}
                onPress={() => openEditProjectModal(activeSelectedProject)}
                disabled={Boolean(actionLoadingKey)}
              >
                <MaterialIcons name="edit" size={18} color="#166534" />
                <Text style={styles.detailsActionButtonText}>Edit {detailEntityLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.detailsActionButton, Boolean(actionLoadingKey) && styles.detailsActionButtonDisabled]}
                onPress={handleRefreshProjectDetails}
                disabled={Boolean(actionLoadingKey)}
              >
                {actionLoadingKey === 'refresh-project' ? (
                  <ActivityIndicator size="small" color="#166534" />
                ) : (
                  <MaterialIcons name="refresh" size={18} color="#166534" />
                )}
                <Text style={styles.detailsActionButtonText}>Refresh</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.detailsActionButton,
                  styles.detailsDeleteButton,
                  Boolean(actionLoadingKey) && styles.detailsActionButtonDisabled,
                ]}
                onPress={handleDeleteProjectRecord}
                disabled={Boolean(actionLoadingKey)}
              >
                <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                <Text style={styles.detailsDeleteButtonText}>Delete {detailEntityLabel}</Text>
              </TouchableOpacity>
            </View>
          )}

          {volunteerRequestEntries.some(entry => entry.status === 'Requested') && (
            <View style={styles.requestNotificationPanel}>
              <MaterialIcons name="campaign" size={18} color="#92400e" />
              <Text style={styles.requestNotificationPanelText}>
                {volunteerRequestEntries.filter(entry => entry.status === 'Requested').length} volunteer request
                {volunteerRequestEntries.filter(entry => entry.status === 'Requested').length === 1 ? '' : 's'} waiting for approval.
              </Text>
            </View>
          )}

          <View style={[styles.detailsSection, styles.detailsSectionCard]}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Text style={styles.sectionHint}>The core context your team needs before taking action.</Text>
            <View style={styles.detailFieldGrid}>
              {setupDetails.map(field => (
                <View key={field.label} style={styles.detailField}>
                  <Text style={styles.detailFieldLabel}>{field.label}</Text>
                  <Text style={styles.detailFieldValue}>{field.value}</Text>
                  <Text style={styles.detailFieldMeta}>{field.meta}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.detailsSection, styles.detailsSectionCard]}>
            <Text style={styles.sectionTitle}>Schedule and Capacity</Text>
            <Text style={styles.sectionHint}>Dates, location, and staffing are grouped here for easier review.</Text>
            <View style={styles.detailFieldGrid}>
              {logisticsDetails.map(field => (
                <View key={field.label} style={styles.detailField}>
                  <Text style={styles.detailFieldLabel}>{field.label}</Text>
                  <Text style={styles.detailFieldValue}>{field.value}</Text>
                  <Text style={styles.detailFieldMeta}>{field.meta}</Text>
                </View>
              ))}
            </View>
          </View>

          <View
            style={[
              styles.detailsSection,
              styles.detailsSectionCard,
              !activeSelectedProject.isEvent && { display: 'none' },
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Event Task Board</Text>
              {isAdmin && (
                <TouchableOpacity style={styles.addButton} onPress={openCreateTaskModal}>
                  <MaterialIcons name="add-task" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.sectionHint}>
              Assign event tasks to joined volunteers so the day stays organized and easy to follow.
            </Text>

            {internalTasks.length === 0 ? (
              <Text style={styles.emptyText}>No event tasks added yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {internalTasks.map(task => (
                  <View key={task.id} style={styles.taskCard}>
                    <View style={styles.taskCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.taskTitle}>{task.title}</Text>
                        <Text style={styles.taskMeta}>
                          {task.category} - {task.priority} Priority
                        </Text>
                        {task.isFieldOfficer ? (
                          <Text style={styles.taskAssignmentText}>
                            Field Officer permissions enabled for this event
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={[
                          styles.taskStatusBadge,
                          task.status === 'Completed'
                            ? styles.taskStatusCompleted
                            : task.status === 'In Progress'
                              ? styles.taskStatusInProgress
                              : task.status === 'Assigned'
                                ? styles.taskStatusAssigned
                                : styles.taskStatusUnassigned,
                        ]}
                      >
                        <Text style={styles.taskStatusText}>{task.status}</Text>
                      </View>
                    </View>

                    <Text style={styles.taskDescription}>{task.description}</Text>
                    {task.skillsNeeded && task.skillsNeeded.length > 0 && (
                      <Text style={styles.taskSkillsText}>
                        Skills needed: {task.skillsNeeded.join(', ')}
                      </Text>
                    )}
                    <Text style={styles.taskAssignmentText}>
                      Assigned to: {task.assignedVolunteerName || 'Unassigned'}
                    </Text>
                    <Text style={styles.taskUpdatedText}>
                      Last updated: {format(new Date(task.updatedAt), 'PPp')}
                    </Text>

                    {isAdmin && (
                      <View style={styles.taskActionRow}>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.approveButton]}
                          onPress={() => openEditTaskModal(task)}
                        >
                          <Text style={styles.applicationButtonText}>Edit / Assign</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.rejectButton]}
                          onPress={() => handleDeleteInternalTask(task.id)}
                        >
                          <Text style={styles.applicationButtonText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          {activeSelectedProject.isEvent ? (
            <>
              <View style={[styles.detailsSection, styles.detailsSectionCard]}>
                <Text style={styles.sectionTitle}>Event Time Tracking</Text>
                <Text style={styles.sectionHint}>
                  Attendance activity is summarized first, then listed per volunteer below.
                </Text>
                <View style={styles.detailsQuickGrid}>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Time Ins</Text>
                    <Text style={styles.detailsQuickValue}>{projectTimeInCount}</Text>
                    <Text style={styles.detailsQuickMeta}>Recorded arrivals</Text>
                  </View>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Time Outs</Text>
                    <Text style={styles.detailsQuickValue}>{projectTimeOutCount}</Text>
                    <Text style={styles.detailsQuickMeta}>Completed sign-outs</Text>
                  </View>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Latest Activity</Text>
                    <Text style={styles.detailsQuickValue}>{latestTimeActivityLabel}</Text>
                    <Text style={styles.detailsQuickMeta}>Most recent attendance update</Text>
                  </View>
                </View>

                <Text style={styles.sectionSubheading}>Volunteer Time Logs</Text>
                {projectTimeLogEntries.length === 0 ? (
                  <Text style={styles.emptyText}>No time in or time out records yet</Text>
                ) : (
                  <View style={styles.updatesList}>
                    {projectTimeLogEntries.map(log => (
                      <View key={log.id} style={styles.applicationCard}>
                        <View style={styles.applicationHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.applicationName}>{log.volunteerName}</Text>
                            <Text style={styles.applicationMeta}>{log.volunteerEmail}</Text>
                            <Text style={styles.applicationMeta}>
                              Time In {format(new Date(log.timeIn), 'PPpp')}
                            </Text>
                            <Text style={styles.applicationMeta}>
                              {log.timeOut
                                ? `Time Out ${format(new Date(log.timeOut), 'PPpp')}`
                                : 'Time Out still pending'}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.applicationStatusBadge,
                              log.timeOut
                                ? styles.applicationStatusApproved
                                : styles.applicationStatusPending,
                            ]}
                          >
                            <Text style={styles.applicationStatusText}>
                              {log.timeOut ? 'Timed Out' : 'Timed In'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={[styles.detailsSection, styles.detailsSectionCard]}>
                <Text style={styles.sectionTitle}>
                  Pending Event Join Requests ({pendingVolunteerRequestEntries.length})
                </Text>
                <Text style={styles.sectionHint}>
                  Review incoming volunteer requests here before they appear in the active event team.
                </Text>

                {pendingVolunteerRequestEntries.length === 0 ? (
                  <Text style={styles.emptyText}>No pending event join requests</Text>
                ) : (
                  <View style={styles.updatesList}>
                    {pendingVolunteerRequestEntries.map(requestEntry => (
                      <View key={requestEntry.id} style={styles.applicationCard}>
                        <View style={styles.applicationHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.applicationName}>{requestEntry.volunteerName}</Text>
                            <Text style={styles.applicationMeta}>{requestEntry.volunteerEmail}</Text>
                            <Text style={styles.applicationMeta}>
                              Requested {format(new Date(requestEntry.requestedAt), 'PPpp')}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.applicationStatusBadge,
                              styles.applicationStatusPending,
                            ]}
                          >
                            <Text style={styles.applicationStatusText}>{requestEntry.status}</Text>
                          </View>
                        </View>

                        {isAdmin && (
                          <View style={styles.applicationActions}>
                            <TouchableOpacity
                              style={[styles.applicationButton, styles.approveButton]}
                              onPress={() => confirmReviewVolunteerRequest(requestEntry, 'Matched')}
                            >
                              <Text style={styles.applicationButtonText}>Approve</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.applicationButton, styles.rejectButton]}
                              onPress={() => confirmReviewVolunteerRequest(requestEntry, 'Rejected')}
                            >
                              <Text style={styles.applicationButtonText}>Reject</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <TouchableOpacity
                          style={styles.viewVolunteerProfileButton}
                          onPress={() => openVolunteerProfile(requestEntry.volunteerId)}
                        >
                          <MaterialIcons name="person-search" size={16} color="#2563eb" />
                          <Text style={styles.viewVolunteerProfileText}>Open Volunteer Profile</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={[styles.detailsSection, styles.detailsSectionCard]}>
                <Text style={styles.sectionTitle}>
                  Rejected Event Join Requests ({rejectedVolunteerRequestEntries.length})
                </Text>
                <Text style={styles.sectionHint}>
                  Keep a readable record of declined requests and who reviewed them.
                </Text>

                {rejectedVolunteerRequestEntries.length === 0 ? (
                  <Text style={styles.emptyText}>No rejected event join requests</Text>
                ) : (
                  <View style={styles.updatesList}>
                    {rejectedVolunteerRequestEntries.map(requestEntry => (
                      <View key={requestEntry.id} style={styles.applicationCard}>
                        <View style={styles.applicationHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.applicationName}>{requestEntry.volunteerName}</Text>
                            <Text style={styles.applicationMeta}>{requestEntry.volunteerEmail}</Text>
                            <Text style={styles.applicationMeta}>
                              Requested {format(new Date(requestEntry.requestedAt), 'PPpp')}
                            </Text>
                            {requestEntry.reviewedAt ? (
                              <Text style={styles.applicationMeta}>
                                Rejected {format(new Date(requestEntry.reviewedAt), 'PPpp')}
                              </Text>
                            ) : null}
                            {requestEntry.reviewedBy ? (
                              <Text style={styles.applicationMeta}>
                                Reviewed by {requestEntry.reviewedBy}
                              </Text>
                            ) : null}
                          </View>
                          <View
                            style={[
                              styles.applicationStatusBadge,
                              styles.applicationStatusRejected,
                            ]}
                          >
                            <Text style={styles.applicationStatusText}>Rejected</Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={styles.viewVolunteerProfileButton}
                          onPress={() => openVolunteerProfile(requestEntry.volunteerId)}
                        >
                          <MaterialIcons name="person-search" size={16} color="#2563eb" />
                          <Text style={styles.viewVolunteerProfileText}>Open Volunteer Profile</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={[styles.detailsSection, styles.detailsSectionCard]}>
                <Text style={styles.sectionTitle}>
                  Event Participants ({volunteerEntries.length})
                </Text>
                <Text style={styles.sectionHint}>
                  Active and completed participants are listed together with their join history.
                </Text>

                {volunteerEntries.length === 0 ? (
                  <Text style={styles.emptyText}>No volunteers have joined this event yet</Text>
                ) : (
                  <View style={styles.updatesList}>
                    {volunteerEntries.map(volunteerEntry => (
                      <View key={volunteerEntry.id} style={styles.volunteerCard}>
                        <View style={styles.volunteerCardHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.volunteerName}>{volunteerEntry.name}</Text>
                            <Text style={styles.volunteerMeta}>{volunteerEntry.email}</Text>
                            <Text style={styles.volunteerMeta}>
                              {volunteerEntry.joinedAt
                                ? `Joined ${format(new Date(volunteerEntry.joinedAt), 'PPpp')}`
                                : 'Joined before tracking was enabled'}
                            </Text>
                            <Text style={styles.volunteerMeta}>
                              {volunteerEntry.participationStatus === 'Completed' && volunteerEntry.completedAt
                                ? `Completed ${format(new Date(volunteerEntry.completedAt), 'PPpp')}`
                                : 'Participation active'}
                            </Text>
                          </View>
                          <View style={styles.volunteerBadges}>
                            {volunteerEntry.source && (
                              <View style={styles.volunteerSourceBadge}>
                                <Text style={styles.volunteerSourceBadgeText}>
                                  {volunteerEntry.source === 'VolunteerJoin'
                                    ? 'Volunteer Join'
                                    : 'Admin Match'}
                                </Text>
                              </View>
                            )}
                            <View
                              style={[
                                styles.volunteerParticipationBadge,
                                volunteerEntry.participationStatus === 'Completed'
                                  ? styles.volunteerParticipationCompletedBadge
                                  : styles.volunteerParticipationActiveBadge,
                              ]}
                            >
                              <Text style={styles.volunteerParticipationBadgeText}>
                                {volunteerEntry.participationStatus}
                              </Text>
                            </View>
                            {volunteerEntry.status && (
                              <View style={styles.volunteerStatusBadge}>
                                <Text style={styles.volunteerStatusBadgeText}>
                                  {volunteerEntry.status}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                        {isAdmin && volunteerEntry.participationStatus !== 'Completed' && (
                          <TouchableOpacity
                            style={styles.completeVolunteerButton}
                            onPress={() => handleCompleteVolunteerParticipation(volunteerEntry.id)}
                          >
                            <MaterialIcons name="task-alt" size={16} color="#fff" />
                            <Text style={styles.completeVolunteerButtonText}>Mark Complete</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.viewVolunteerProfileButton}
                          onPress={() => openVolunteerProfile(volunteerEntry.id)}
                        >
                          <MaterialIcons name="person-search" size={16} color="#2563eb" />
                          <Text style={styles.viewVolunteerProfileText}>Open Volunteer Profile</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          ) : null}

          <View style={[styles.detailsSection, { display: 'none' }]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Impact Hub</Text>
            </View>

            <Text style={styles.timelineLabel}>Submitted Reports</Text>
            {partnerReports.length === 0 ? (
              <Text style={styles.emptyText}>No impact hub reports uploaded yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {partnerReports.map(report => (
                  <View key={report.id} style={styles.applicationCard}>
                    <View style={styles.applicationHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicationName}>
                          {report.title || report.submitterName || report.partnerName || 'Report'}
                        </Text>
                        <Text style={styles.applicationMeta}>
                          {report.reportType} - Impact {report.impactCount}
                        </Text>
                        <Text style={styles.applicationMeta}>
                          Submitted by {report.submitterName || report.partnerName || 'User'}
                        </Text>
                        <Text style={styles.applicationMeta}>{report.description}</Text>
                        <Text style={styles.applicationMeta}>
                          Uploaded {format(new Date(report.createdAt), 'PPpp')}
                        </Text>
                        {getPrimaryReportMediaUri(report.mediaFile, report.attachments) ? (
                          isImageMediaUri(getPrimaryReportMediaUri(report.mediaFile, report.attachments)) ? (
                            <Image
                              source={{ uri: getPrimaryReportMediaUri(report.mediaFile, report.attachments) || '' }}
                              style={styles.reportImagePreview}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={styles.applicationMeta}>
                              Media: {getPrimaryReportMediaUri(report.mediaFile, report.attachments)}
                            </Text>
                          )
                        ) : null}
                      </View>
                      <View
                        style={[
                          styles.applicationStatusBadge,
                          styles.applicationStatusPending,
                        ]}
                      >
                        <Text style={styles.applicationStatusText}>Submitted</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={[styles.detailsSection, styles.detailsSectionCard]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Status Updates</Text>
              {isAdmin && (
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={openStatusUpdateModal}
                >
                  <MaterialIcons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.sectionHint}>
              Short timeline entries help the team understand what changed and when.
            </Text>

            {statusUpdates.length === 0 ? (
              <Text style={styles.emptyText}>No status updates yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {statusUpdates.map(update => (
                  <View key={update.id} style={styles.updateItem}>
                    <View
                      style={[
                        styles.updateStatusDot,
                        { backgroundColor: getProjectStatusColor(update.status) },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.updateStatus}>
                        {update.status}
                        {update.source ? ` (${update.source})` : ''}
                      </Text>
                      <Text style={styles.updateDescription}>{update.description}</Text>
                      <Text style={styles.updateDate}>
                        {format(new Date(update.updatedAt), 'PPpp')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        <Modal
          visible={showTaskModal}
          animationType="slide"
          onRequestClose={closeTaskModal}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeTaskModal}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingTaskId ? 'Edit Internal Task' : 'Add Internal Task'}
              </Text>
              <TouchableOpacity onPress={handleSaveInternalTask}>
                <Text style={styles.projectModalSave}>Save</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              <View style={[styles.formRow, styles.formRowReverse]}>
                <TextInput
                  style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                  placeholder="Task title"
                  placeholderTextColor="#999"
                  value={taskDraft.title}
                  onChangeText={value => handleTaskDraftChange('title', value)}
                />
                <Text style={styles.labelRight}>Title</Text>
              </View>

              <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                <TextInput
                  style={[styles.textArea, styles.inputWithLabel]}
                  placeholder="Describe what needs to be done"
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={4}
                  value={taskDraft.description}
                  onChangeText={value => handleTaskDraftChange('description', value)}
                />
                <Text style={[styles.labelRight, styles.labelTop]}>Description</Text>
              </View>

              <View style={[styles.formRow, styles.formRowReverse]}>
                <TextInput
                  style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                  placeholder="Task category"
                  placeholderTextColor="#999"
                  value={taskDraft.category}
                  onChangeText={value => handleTaskDraftChange('category', value)}
                />
                <Text style={styles.labelRight}>Category</Text>
              </View>

              <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                  {(['High', 'Medium', 'Low'] as const).map(priority => (
                    <TouchableOpacity
                      key={priority}
                      style={[
                        styles.statusOption,
                        taskDraft.priority === priority && styles.statusOptionSelected,
                      ]}
                      onPress={() => handleTaskDraftChange('priority', priority)}
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          taskDraft.priority === priority && styles.statusOptionTextSelected,
                        ]}
                      >
                        {priority}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.labelRight, styles.labelTop]}>Priority</Text>
              </View>

              <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                  {([
                    { label: 'Standard Task', value: false },
                    { label: 'Field Officer', value: true },
                  ] as const).map(option => (
                    <TouchableOpacity
                      key={option.label}
                      style={[
                        styles.statusOption,
                        taskDraft.isFieldOfficer === option.value && styles.statusOptionSelected,
                      ]}
                      onPress={() => handleTaskDraftChange('isFieldOfficer', option.value)}
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          taskDraft.isFieldOfficer === option.value &&
                          styles.statusOptionTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.labelRight, styles.labelTop]}>Task Type</Text>
              </View>

              <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                  {(['Unassigned', 'Assigned', 'In Progress', 'Completed'] as const).map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.statusOption,
                        taskDraft.status === status && styles.statusOptionSelected,
                      ]}
                      onPress={() => handleTaskDraftChange('status', status)}
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          taskDraft.status === status && styles.statusOptionTextSelected,
                        ]}
                      >
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.labelRight, styles.labelTop]}>Status</Text>
              </View>

              <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                <View style={styles.dropdownWrapper}>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setShowSkillsDropdown(!showSkillsDropdown)}
                  >
                    <Text style={styles.dropdownButtonText}>
                      {taskDraft.skillsNeeded.length > 0
                        ? `${taskDraft.skillsNeeded.length} skill(s) selected`
                        : 'Select Skills'}
                    </Text>
                    <MaterialIcons
                      name={showSkillsDropdown ? 'expand-less' : 'expand-more'}
                      size={24}
                      color="#666"
                    />
                  </TouchableOpacity>

                  {showSkillsDropdown && (
                    <View style={styles.dropdownContent}>
                      <ScrollView style={{ maxHeight: 200 }}>
                        {TASK_SKILL_OPTIONS.map(skill => {
                          const isSelected = taskDraft.skillsNeeded.includes(skill);
                          return (
                            <TouchableOpacity
                              key={skill}
                              style={[styles.dropdownOption, isSelected && styles.dropdownOptionSelected]}
                              onPress={() => toggleTaskSkill(skill)}
                            >
                              <MaterialIcons
                                name={isSelected ? 'check-box' : 'check-box-outline-blank'}
                                size={20}
                                color={isSelected ? '#0F766E' : '#ccc'}
                              />
                              <Text style={styles.dropdownOptionText}>{skill}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                      <View style={[styles.customSkillRow, { padding: 8, borderTopWidth: 1, borderColor: '#f3f4f6' }]}>
                        <TextInput
                          style={styles.customSkillInput}
                          placeholder="Add custom skill"
                          placeholderTextColor="#9ca3af"
                          value={customTaskSkill}
                          onChangeText={setCustomTaskSkill}
                          onSubmitEditing={handleAddCustomTaskSkill}
                          returnKeyType="done"
                        />
                        <TouchableOpacity style={styles.customSkillAddButton} onPress={handleAddCustomTaskSkill}>
                          <MaterialIcons name="add" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {taskDraft.skillsNeeded.length > 0 ? (
                    <View style={styles.selectedSkillChips}>
                      {taskDraft.skillsNeeded.map(skill => (
                        <TouchableOpacity
                          key={skill}
                          style={styles.selectedSkillChip}
                          onPress={() => toggleTaskSkill(skill)}
                        >
                          <Text style={styles.selectedSkillChipText}>{skill}</Text>
                          <MaterialIcons name="close" size={14} color="#0F766E" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.labelRight, styles.labelTop]}>Skills</Text>
              </View>

              <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                <View style={styles.dropdownWrapper}>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setShowAssignmentDropdown(!showAssignmentDropdown)}
                  >
                    <Text style={styles.dropdownButtonText}>
                      {taskDraft.assignedVolunteerId === '' ?
                        'Unassigned' :
                        assignableVolunteerOptions.find(v => v.id === taskDraft.assignedVolunteerId)?.name ||
                        'Select Volunteer'}
                    </Text>
                    <MaterialIcons
                      name={showAssignmentDropdown ? 'expand-less' : 'expand-more'}
                      size={24}
                      color="#666"
                    />
                  </TouchableOpacity>

                  {showAssignmentDropdown && (
                    <View style={styles.dropdownContent}>
                      <TouchableOpacity
                        style={[
                          styles.dropdownOption,
                          taskDraft.assignedVolunteerId === '' && styles.dropdownOptionSelected,
                        ]}
                        onPress={() => {
                          handleTaskDraftChange('assignedVolunteerId', '');
                          setShowAssignmentDropdown(false);
                        }}
                      >
                        <MaterialIcons
                          name={taskDraft.assignedVolunteerId === '' ? 'radio-button-checked' : 'radio-button-unchecked'}
                          size={20}
                          color={taskDraft.assignedVolunteerId === '' ? '#0F766E' : '#ccc'}
                        />
                        <Text style={styles.dropdownOptionText}>Unassigned</Text>
                      </TouchableOpacity>

                      {assignableVolunteerOptions.map(volunteerOption => (
                        <TouchableOpacity
                          key={volunteerOption.id}
                          style={[
                            styles.dropdownOption,
                            taskDraft.assignedVolunteerId === volunteerOption.id && styles.dropdownOptionSelected,
                          ]}
                          onPress={() => {
                            handleTaskDraftChange('assignedVolunteerId', volunteerOption.id);
                            setShowAssignmentDropdown(false);
                          }}
                        >
                          <MaterialIcons
                            name={taskDraft.assignedVolunteerId === volunteerOption.id ? 'radio-button-checked' : 'radio-button-unchecked'}
                            size={20}
                            color={taskDraft.assignedVolunteerId === volunteerOption.id ? '#0F766E' : '#ccc'}
                          />
                          <Text style={styles.dropdownOptionText}>{volunteerOption.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
                <Text style={[styles.labelRight, styles.labelTop]}>Assign To</Text>
              </View>

              {assignableVolunteerOptions.length === 0 ? (
                <Text style={styles.helperText}>
                  No joined volunteers are available for this project yet. Volunteers must join first before task assignment.
                </Text>
              ) : taskDraft.isFieldOfficer ? (
                <Text style={styles.helperText}>
                  The volunteer assigned to this field officer task can reassign other volunteers inside the same event.
                </Text>
              ) : null}

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSaveInternalTask}
              >
                <Text style={styles.submitButtonText}>
                  {editingTaskId ? 'Update Task' : 'Add Task'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>

        <Modal
          visible={showStatusModal}
          animationType="slide"
          onRequestClose={() => setShowStatusModal(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowStatusModal(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Update Lifecycle Status</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <View style={[styles.formRow, styles.formRowTop]}>
                <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                  {lifecycleStatusModes.map(mode => (
                    <TouchableOpacity
                      key={mode}
                      style={[
                        styles.statusOption,
                        statusUpdateMode === mode && styles.statusOptionSelected,
                      ]}
                      onPress={() => {
                        setStatusUpdateMode(mode);
                        if (mode === 'System') {
                          const currentSelectedProject = getCurrentSelectedProject();
                          if (currentSelectedProject) {
                            setNewStatus(getSystemDerivedProjectStatus(currentSelectedProject));
                          }
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          statusUpdateMode === mode && styles.statusOptionTextSelected,
                        ]}
                      >
                        {mode}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.label, styles.labelRight, styles.labelTop]}>Mode</Text>
              </View>

              {statusUpdateMode === 'System' && (
                <View style={[styles.formRow, styles.formRowTop]}>
                  <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                    <Text style={styles.helperText}>
                      Status is computed automatically from schedule progress (Planning, In Progress, Completed).
                    </Text>
                  </View>
                  <Text style={[styles.label, styles.labelRight, styles.labelTop]}>System Rule</Text>
                </View>
              )}

              {statusUpdateMode === 'Manual' && (
                <View style={[styles.formRow, styles.formRowTop]}>
                  <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                    {statuses.map(status => (
                      <TouchableOpacity
                        key={status}
                        style={[
                          styles.statusOption,
                          newStatus === status && styles.statusOptionSelected,
                        ]}
                        onPress={() => setNewStatus(status as Project['status'])}
                      >
                        <Text
                          style={[
                            styles.statusOptionText,
                            newStatus === status && styles.statusOptionTextSelected,
                          ]}
                        >
                          {status}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.label, styles.labelRight, styles.labelTop]}>New Status</Text>
                </View>
              )}

              <View style={[styles.formRow, styles.formRowTop]}>
                <TextInput
                  style={[styles.textArea, styles.inputWithLabel]}
                  placeholder={
                    statusUpdateMode === 'Manual'
                      ? 'Describe why this manual override is needed...'
                      : 'Optional note for this system update...'
                  }
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={4}
                  value={updateDescription}
                  onChangeText={setUpdateDescription}
                />
                <Text style={[styles.label, styles.labelRight, styles.labelTop]}>Description</Text>
              </View>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleAddStatusUpdate}
              >
                <Text style={styles.submitButtonText}>Add Update</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
        {renderProgramProposalModal()}
        {renderProjectEditorModal()}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      ref={listScrollViewRef}
      style={styles.container}
      onScroll={event => {
        listScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
    >
      <View style={styles.lifecycleHero}>
        <View style={styles.lifecycleHeroCopy}>
          <Text style={styles.lifecycleEyebrow}>Lifecycle workspace</Text>
          <Text style={styles.title}>Program Management Suite</Text>
          <Text style={styles.listSubtitle}>
            Open the active programs below and manage each scheduler, project list, volunteers, and approvals in one place.
          </Text>
        </View>
        {isAdmin && (
          <TouchableOpacity style={styles.createProjectButton} onPress={openCreateProjectModal}>
            <MaterialIcons name="add" size={18} color="#fff" />
            <Text style={styles.createProjectButtonText}>New Initiative</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.lifecycleStatsRow}>
        <View style={styles.lifecycleStatPill}>
          <Text style={styles.lifecycleStatValue}>{projects.filter(project => !project.isEvent).length}</Text>
          <Text style={styles.lifecycleStatLabel}>Projects</Text>
        </View>
        <View style={styles.lifecycleStatPill}>
          <Text style={styles.lifecycleStatValue}>{availableProgramCount}</Text>
          <Text style={styles.lifecycleStatLabel}>Programs</Text>
        </View>
        <View style={styles.lifecycleStatPill}>
          <Text style={styles.lifecycleStatValue}>
            {projects.filter(project => getProjectDisplayStatus(project) === 'In Progress').length}
          </Text>
          <Text style={styles.lifecycleStatLabel}>In progress</Text>
        </View>
        <View style={styles.lifecycleStatPill}>
          <Text style={styles.lifecycleStatValue}>
            {projects.filter(project => getProjectDisplayStatus(project) === 'Planning').length}
          </Text>
          <Text style={styles.lifecycleStatLabel}>Planning</Text>
        </View>
        <View style={styles.lifecycleStatPill}>
          <Text style={styles.lifecycleStatValue}>{projects.filter(project => project.isEvent).length}</Text>
          <Text style={styles.lifecycleStatLabel}>Events</Text>
        </View>
      </View>

      {loadError ? (
        <View style={styles.inlineErrorWrap}>
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => {
              void loadProjects();
              void loadPartners();
              void loadVolunteers();
              void loadAllVolunteerMatches();
              void loadVolunteerTimeLogs();
            }}
          />
        </View>
      ) : null}
      {!loadError ? (
        <>
          <View style={{ marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#1e293b' }}>Programs</Text>
              {programMutationInProgress && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color="#6366f1" />
                  <Text style={{ fontSize: 12, color: '#6366f1', fontWeight: '600' }}>Updating programs...</Text>
                </View>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingRight: 20 }}>
              {programSections.map(section => {
                const track = activeProgramTracks.find(t => t.id === section.module);
                return (
                  <View key={section.module} style={{ position: 'relative' }}>
                    <TouchableOpacity
                      style={[
                        styles.programSuiteHeaderCard,
                        {
                          backgroundColor: section.surface,
                          borderColor: expandedProgramModules.has(section.module) ? section.accent : section.border,
                          width: 260,
                          height: 140,
                          justifyContent: 'space-between',
                        },
                      ]}
                      onPress={() => toggleProgramSection(section.module)}
                      activeOpacity={0.88}
                    >
                      {section.imageUrl && (
                        <Image
                          source={{ uri: section.imageUrl }}
                          style={[StyleSheet.absoluteFill, { borderRadius: 8, opacity: 0.12 }]}
                          resizeMode="cover"
                        />
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
                        <View style={[styles.programSuiteIconWrap, { backgroundColor: '#ffffff', borderColor: section.border }]}>
                          <MaterialIcons name={section.icon} size={26} color={section.accent} />
                        </View>
                        <MaterialIcons
                          name={getProgramSuiteChevron(expandedProgramModules.has(section.module))}
                          size={24}
                          color={section.accent}
                          style={{ opacity: 0.6 }}
                        />
                      </View>
                      <View>
                        <Text style={[styles.programSuiteTitle, { fontSize: 16, marginBottom: 4 }]}>{section.title}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: section.accent }}>{section.totalPrograms} Projects</Text>
                          <Text style={{ fontSize: 13, color: '#64748b' }}>•</Text>
                          <Text style={{ fontSize: 13, color: '#64748b' }}>{section.inProgressCount} Active</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                    {isAdmin && track && (
                      <View style={{ position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4 }}>
                        <TouchableOpacity
                          style={{ backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: 4 }}
                          onPress={() => openEditProgramModal(track)}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="edit" size={16} color="#6366f1" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: 4, opacity: actionLoadingKey === `deleteProgram-${track.id}` ? 0.5 : 1 }}
                          onPress={() => handleDeleteProgram(track.id, track.title)}
                          disabled={actionLoadingKey === `deleteProgram-${track.id}`}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="delete" size={16} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}

              {isAdmin && (
                <TouchableOpacity
                  style={{
                    width: 200,
                    height: 140,
                    borderWidth: 2,
                    borderColor: '#cbd5e1',
                    borderStyle: 'dashed',
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f8fafc',
                  }}
                  onPress={openCreateProgramModal}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="add" size={32} color="#64748b" />
                  <Text style={{ color: '#64748b', fontWeight: '600', marginTop: 8 }}>Add program +</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          <View style={styles.programSuiteStack}>
            {programSections.map(renderProgramSection)}
          </View>

          <View
            style={[
              styles.programSuiteSchedulerCard,
              !isDesktop && styles.programSuiteSchedulerCardStacked,
            ]}
          >
            <View
              style={[
                styles.programSuiteSchedulerAgendaPane,
                !isDesktop && styles.programSuiteSchedulerAgendaPaneStacked,
              ]}
            >
              <Text style={styles.programSuiteSchedulerAgendaTitle}>Projects</Text>
              <Text style={styles.programSuiteSchedulerAgendaMeta}>
                One shared list for all projects in the system.
              </Text>

              <View style={styles.programSuiteSchedulerControls}>
                <Text style={styles.programSuiteSchedulerRange}>{schedulerRangeLabel}</Text>
              </View>

              {schedulerFeaturedProjects.length ? (
                schedulerFeaturedProjects.map(project => (
                  <TouchableOpacity
                    key={`featured-${project.id}`}
                    style={styles.programSuiteSchedulerAgendaRow}
                    onPress={() => {
                      void handleSelectProject(project);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.programSuiteSchedulerAgendaName} numberOfLines={1}>
                      {project.title}
                    </Text>
                    <Text style={styles.programSuiteSchedulerAgendaDate}>
                      {formatCalendarItemDateRange(project.startDate, project.endDate)}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.programSuiteSchedulerAgendaEmpty}>No projects yet.</Text>
              )}
            </View>

            <View
              style={[
                styles.programSuiteSchedulerMonthPane,
                !isDesktop && styles.programSuiteSchedulerMonthPaneStacked,
              ]}
            >
              <View style={styles.programSuiteSchedulerMonthTopRow}>
                <View>
                  <Text style={styles.programSuiteSchedulerTodayLabel}>
                    Today
                  </Text>
                  <Text style={styles.programSuiteSchedulerTodayDate}>
                    {format(currentDate, 'EEEE, MMMM d')}
                  </Text>
                </View>
                <View style={styles.programSuiteSchedulerHeaderControls}>
                  <View style={styles.programSuiteSchedulerMonthSwitcher}>
                    <TouchableOpacity
                      style={styles.programSuiteSchedulerMonthButton}
                      onPress={() => shiftSchedulerMonth(-1)}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons name="chevron-left" size={18} color="#236d35" />
                    </TouchableOpacity>
                    <Text style={styles.programSuiteSchedulerMonthText}>
                      {format(new Date(selectedSchedulerYear, selectedSchedulerMonth, 1), 'MMMM yyyy')}
                    </Text>
                    <TouchableOpacity
                      style={styles.programSuiteSchedulerMonthButton}
                      onPress={() => shiftSchedulerMonth(1)}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons name="chevron-right" size={18} color="#236d35" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <Pressable
                style={[
                  styles.programSuiteSchedulerMonthHeadingWrap,
                  isSchedulerMonthHovered && styles.programSuiteSchedulerMonthHeadingWrapHovered,
                ]}
                onHoverIn={() => setIsSchedulerMonthHovered(true)}
                onHoverOut={() => setIsSchedulerMonthHovered(false)}
              >
                <Text
                  style={[
                    styles.programSuiteSchedulerMonthHeading,
                    isSchedulerMonthHovered && styles.programSuiteSchedulerMonthHeadingHovered,
                  ]}
                >
                  {format(schedulerAnchorDate, 'MMMM yyyy')}
                </Text>
              </Pressable>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.schedulerCalendarWrap}>
                  <View style={styles.schedulerCalendarHeaderRow}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(dayLabel => (
                      <Text key={`suite-${dayLabel}`} style={styles.schedulerCalendarHeaderCell}>
                        {dayLabel}
                      </Text>
                    ))}
                  </View>

                  {schedulerCalendarWeeks.map((week, weekIndex) => (
                    <View key={`suite-week-${weekIndex}`} style={styles.schedulerCalendarWeekRow}>
                      {week.map(day => {
                        const isCurrentMonth = day.getMonth() === schedulerAnchorDate.getMonth();
                        const isToday = isSameCalendarDay(day, currentDate);
                        const dayProjects = schedulerProjectsByDate.get(getDateKey(day)) || [];
                        return (
                          <View
                            key={`suite-${day.toISOString()}`}
                            style={[
                              styles.schedulerCalendarDayCell,
                              !isCurrentMonth && styles.schedulerCalendarDayCellMuted,
                              isToday && styles.schedulerCalendarDayCellToday,
                            ]}
                          >
                            <View style={styles.schedulerCalendarDayHeader}>
                              <Text
                                style={[
                                  styles.schedulerCalendarDayDate,
                                  !isCurrentMonth && styles.schedulerCalendarDayDateMuted,
                                  isToday && styles.schedulerCalendarDayDateToday,
                                ]}
                              >
                                {format(day, 'd')}
                              </Text>
                              {isToday ? <Text style={styles.schedulerCalendarTodayTag}>Today</Text> : null}
                            </View>

                            {dayProjects.length ? (
                              dayProjects.map(project => (
                                <View key={`calendar-project-${project.id}`} style={styles.schedulerCalendarProjectPill}>
                                  <Text style={styles.schedulerCalendarProjectTitle} numberOfLines={2}>
                                    {project.title}
                                  </Text>
                                </View>
                              ))
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>

              <View style={styles.schedulerProjectCalendarSection}>
                <View style={styles.schedulerProjectCalendarHeader}>
                  <View>
                    <Text style={styles.schedulerProjectCalendarTitle}>Project Calendar</Text>
                    <Text style={styles.schedulerProjectCalendarMeta}>
                      All project cards in the system
                    </Text>
                  </View>
                  <Text style={styles.schedulerProjectCalendarCount}>
                    {monthProjectCalendarProjects.length} project{monthProjectCalendarProjects.length === 1 ? '' : 's'}
                  </Text>
                </View>

                {monthProjectCalendarProjects.length ? (
                  <View style={styles.schedulerProjectCalendarGrid}>
                    {monthProjectCalendarProjects.map(project => (
                      <TouchableOpacity
                        key={`month-project-${project.id}`}
                        style={styles.schedulerProjectCalendarCard}
                        onPress={() => {
                          void handleSelectProject(project);
                        }}
                        activeOpacity={0.85}
                      >
                        <View style={styles.schedulerProjectCalendarCardTopRow}>
                          <Text style={styles.schedulerProjectCalendarCardTitle} numberOfLines={1}>
                            {project.title}
                          </Text>
                          <View
                            style={[
                              styles.schedulerProjectCalendarStatusDot,
                              { backgroundColor: getProjectStatusColor(project) },
                            ]}
                          />
                        </View>
                        <Text style={styles.schedulerProjectCalendarCardDate} numberOfLines={2}>
                          {formatCalendarItemDateRange(project.startDate, project.endDate)}
                        </Text>
                        <Text style={styles.schedulerProjectCalendarCardMeta} numberOfLines={1}>
                          {getProgramSuiteModuleForProject(project, activeProgramTrackIds) || project.category}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <View style={styles.schedulerProjectCalendarEmptyState}>
                    <Text style={styles.schedulerProjectCalendarEmptyTitle}>No projects this month</Text>
                    <Text style={styles.schedulerProjectCalendarEmptyMeta}>
                      Move to another month to see its project boxes.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </>
      ) : null}
      {!loadError && projects.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="folder-open" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No initiatives found</Text>
        </View>
      ) : null}

      {renderProgramProposalModal()}
      {renderProgramCrudModal()}
      {renderProjectEditorModal()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  detailsScreenContent: {
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerSpacer: {
    width: 24,
    height: 24,
  }, lifecycleHero: {
    marginBottom: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  lifecycleHeroCopy: {
    flex: 1,
    gap: 6,
  },
  lifecycleEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  lifecycleStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  lifecycleStatPill: {
    minWidth: 102,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  lifecycleStatValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    color: '#14532d',
  },
  lifecycleStatLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#166534',
    fontWeight: '700',
  },
  inlineErrorWrap: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  listSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  createProjectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  createProjectButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  programSuiteStack: {
    gap: 20,
    marginBottom: 20,
  },
  programSuiteSection: {
    gap: 0,
  },
  programSuiteHeaderCard: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  programSuiteHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  programSuiteHeaderCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  programSuiteHeaderActions: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  programSuiteIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  programSuiteTitleWrap: {
    flex: 1,
    gap: 6,
  },
  programSuiteTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  programSuiteDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: '#475569',
  },
  programSuiteMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  programSuiteMetricPill: {
    minWidth: 108,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  programSuiteMetricValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  programSuiteMetricLabel: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  programSuiteTapHint: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  programSuiteAddEventButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
  },
  programSuiteAddEventText: {
    fontSize: 12,
    fontWeight: '800',
  },
  programSuiteSchedulerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bde0c6',
    marginBottom: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  programSuiteSchedulerCardStacked: {
    flexDirection: 'column',
  },
  programSuiteSchedulerAgendaPane: {
    width: '35%',
    minWidth: 260,
    backgroundColor: '#2f8f45',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  programSuiteSchedulerAgendaPaneStacked: {
    width: '100%',
    minWidth: 0,
  },
  programSuiteSchedulerAgendaTitle: {
    color: '#f1fff4',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  programSuiteSchedulerAgendaMeta: {
    color: '#d6f8de',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  programSuiteSchedulerControls: {
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    marginBottom: 10,
  },
  programSuiteSchedulerMonthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#c7e8cd',
    borderRadius: 999,
    backgroundColor: '#f0faf2',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  programSuiteSchedulerMonthButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  programSuiteSchedulerMonthText: {
    minWidth: 64,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: '#236d35',
  },
  programSuiteSchedulerYearSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  programSuiteSchedulerYearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  programSuiteSchedulerYearText: {
    minWidth: 52,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
    color: '#f7fff8',
  },
  programSuiteSchedulerRange: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d9f7df',
  },
  programSuiteSchedulerAgendaRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.25)',
  },
  programSuiteSchedulerAgendaName: {
    color: '#f7fff8',
    fontSize: 12,
    fontWeight: '600',
  },
  programSuiteSchedulerAgendaDate: {
    marginTop: 2,
    color: '#d6f8de',
    fontSize: 11,
    fontWeight: '700',
  },
  programSuiteSchedulerAgendaEmpty: {
    marginTop: 10,
    color: '#d9f7df',
    fontSize: 12,
  },
  programSuiteSchedulerMonthPane: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 12,
  },
  programSuiteSchedulerMonthPaneStacked: {
    width: '100%',
  },
  programSuiteSchedulerMonthTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  programSuiteSchedulerHeaderControls: {
    alignItems: 'flex-end',
  },
  programSuiteSchedulerTodayLabel: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '400',
    color: '#203a2a',
  },
  programSuiteSchedulerTodayDate: {
    marginTop: 2,
    fontSize: 11,
    color: '#203a2a',
    fontWeight: '700',
  },
  programSuiteSchedulerYearHero: {
    fontSize: 36,
    lineHeight: 38,
    fontWeight: '400',
    color: '#203a2a',
  },
  programSuiteSchedulerMonthHeading: {
    marginTop: 6,
    marginBottom: 6,
    textAlign: 'center',
    color: '#5e7b65',
    fontSize: 10,
    fontWeight: '700',
  },
  programSuiteSchedulerMonthHeadingWrap: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  programSuiteSchedulerMonthHeadingWrapHovered: {
    backgroundColor: '#ecfdf5',
  },
  programSuiteSchedulerMonthHeadingHovered: {
    color: '#166534',
    textDecorationLine: 'underline',
  },
  programSuiteProjectsAnimatedWrap: {
    overflow: 'hidden',
    paddingTop: 12,
  },
  programSuiteProjectsBlock: {
    gap: 12,
  },
  programSuiteProjectsHeader: {
    gap: 4,
  },
  programSuiteProjectsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  programSuiteProjectsTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  programSuiteProjectsMeta: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
  },
  programSuiteEmptyState: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 18,
    gap: 8,
  },
  programSuiteEmptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  programSuiteEmptyMeta: {
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
    overflow: 'hidden',
  },
  cardDesktop: {
    width: '100%',
    maxWidth: 960,
    flexShrink: 0,
    height: 620,
  },
  cardMobile: {
    width: '48%',
    maxWidth: '48%',
    flexShrink: 0,
    height: 300,
  },
  cardImage: {
    width: '100%',
    height: 80,
    backgroundColor: '#dbe4ea',
  },
  cardBody: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
  },
  cardHeaderCopy: {
    flex: 1,
  },
  cardHeaderBadges: {
    alignItems: 'flex-end',
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: '#1f2544',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '600',
  },
  description: {
    color: '#5b647f',
    fontSize: 13,
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 4,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  infoRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  infoRowLeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRowCopy: {
    flex: 1,
  },
  infoRowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2b2f42',
    lineHeight: 21,
  },
  infoRowSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: '#7b859f',
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#eef2f7',
    marginHorizontal: 14,
  },
  aboutSection: {
    marginBottom: 2,
  },
  aboutLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1f2544',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  projectEventPanel: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 12,
  },
  projectEventPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  projectEventPanelCopy: {
    flex: 1,
    gap: 4,
  },
  projectEventPanelTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectEventPanelMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  projectEventPanelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfeff',
    borderWidth: 1,
    borderColor: '#99f6e4',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  projectEventPanelButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f766e',
  },
  projectEventEmptyState: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  projectEventEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectEventEmptyMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  projectEventListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  projectEventListItemCopy: {
    flex: 1,
    gap: 4,
  },
  projectEventListItemTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectEventListItemMeta: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  projectEventListItemSummary: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff7ed',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pointsBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#f59e0b',
  },
  eventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ecfeff',
    borderColor: '#99f6e4',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  eventBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0f766e',
  },
  requestNotificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  requestNotificationBadgeText: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 4,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  list: {
    marginBottom: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#999',
    fontSize: 16,
    marginTop: 8,
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 4,
  },
  detailsHero: {
    backgroundColor: '#f7fff9',
    borderWidth: 1,
    borderColor: '#d1fae5',
    borderRadius: 22,
    padding: 20,
    marginBottom: 24,
  },
  detailsHeroHeader: {
    gap: 12,
    marginBottom: 20,
  },
  detailsHeroCopy: {
    gap: 8,
  },
  detailsMediaPanel: {
    marginBottom: 20,
    gap: 16,
  },
  detailsMediaPreviewWrap: {
    width: '100%',
  },
  detailsMediaPreview: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    backgroundColor: '#dbeafe',
  },
  detailsMediaEmptyState: {
    height: 180,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detailsMediaEmptyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  detailsMediaCopy: {
    gap: 8,
  },
  detailsMediaTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailsMediaMeta: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  detailsMediaStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  detailsMediaActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  detailsMediaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  detailsMediaButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  detailsMediaRemoveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  detailsMediaRemoveButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#b91c1c',
  },
  detailsEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  detailsTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 34,
  },
  detailsSubtitle: {
    fontSize: 15,
    color: '#475569',
    lineHeight: 24,
  },
  detailsHeroStatus: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  detailsQuickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  detailsQuickCard: {
    minWidth: 190,
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 14,
    paddingVertical: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  detailsQuickLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  detailsQuickValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 23,
  },
  detailsQuickMeta: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  detailsActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 22,
  },
  detailsActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  detailsActionButtonDisabled: {
    opacity: 0.7,
  },
  detailsActionButtonText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  detailsDeleteButton: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  detailsDeleteButtonText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '700',
  },
  requestNotificationPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 20,
  },
  requestNotificationPanelText: {
    flex: 1,
    color: '#78350f',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  detailsSection: {
    marginVertical: 12,
  },
  detailsSectionCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 22,
    padding: 18,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
    marginBottom: 16,
  },
  sectionSubheading: {
    marginTop: 18,
    marginBottom: 12,
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detailFieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailField: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 14,
    minWidth: 220,
    flexGrow: 1,
    flexShrink: 1,
  },
  detailFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  detailFieldValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 22,
  },
  detailFieldMeta: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  timelineDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timelineLabel: {
    color: '#666',
    fontSize: 12,
  },
  timelineValue: {
    color: '#333',
    fontWeight: '600',
    fontSize: 12,
  },
  currentStatusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  projectTaskRedirectCard: {
    alignItems: 'center',
    gap: 8,
  },
  projectTaskRedirectTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  projectTaskRedirectMeta: {
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
    textAlign: 'center',
  },
  updatesList: {
    marginTop: 14,
  },
  updateItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  updateStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  updateStatus: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  updateDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
    lineHeight: 18,
  },
  updateDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  applicationCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 14,
    marginBottom: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  applicationHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  applicationName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  applicationMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  reportImagePreview: {
    width: '100%',
    height: 180,
    borderRadius: 6,
    marginTop: 10,
    backgroundColor: '#e2e8f0',
  },
  applicationStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  applicationStatusPending: {
    backgroundColor: '#fef3c7',
  },
  applicationStatusApproved: {
    backgroundColor: '#dcfce7',
  },
  applicationStatusRejected: {
    backgroundColor: '#fee2e2',
  },
  applicationStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  applicationActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  proposalDetailSection: {
    marginTop: 14,
    gap: 12,
  },
  proposalDetailSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalHighlightCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fbff',
    padding: 14,
  },
  proposalHighlightLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  proposalHighlightTitle: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalHighlightMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  proposalHighlightBody: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  proposalInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  proposalInfoCard: {
    flexGrow: 1,
    minWidth: 150,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    padding: 12,
  },
  proposalInfoLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#64748b',
    marginBottom: 6,
  },
  proposalInfoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  proposalNarrativeCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    padding: 12,
  },
  proposalNarrativeText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
  },
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 14,
    marginBottom: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  taskCardHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  taskMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  taskDescription: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
    marginTop: 10,
  },
  taskSkillsText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
    marginTop: 8,
  },
  taskAssignmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 10,
  },
  taskUpdatedText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 6,
  },
  taskActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  taskStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  taskStatusUnassigned: {
    backgroundColor: '#e5e7eb',
  },
  taskStatusAssigned: {
    backgroundColor: '#dbeafe',
  },
  taskStatusInProgress: {
    backgroundColor: '#fef3c7',
  },
  taskStatusCompleted: {
    backgroundColor: '#dcfce7',
  },
  taskStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  volunteerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 12,
    marginBottom: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  volunteerCardHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  volunteerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  volunteerMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  volunteerBadges: {
    alignItems: 'flex-end',
    gap: 8,
  },
  volunteerParticipationBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  volunteerParticipationActiveBadge: {
    backgroundColor: '#dbeafe',
  },
  volunteerParticipationCompletedBadge: {
    backgroundColor: '#dcfce7',
  },
  volunteerParticipationBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  volunteerSourceBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  volunteerSourceBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  volunteerStatusBadge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  volunteerStatusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  completeVolunteerButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
  },
  completeVolunteerButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  viewVolunteerProfileText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  viewVolunteerProfileButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  applicationButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  applicationButtonDisabled: {
    opacity: 0.75,
  },
  applicationButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  approveButton: {
    backgroundColor: '#16a34a',
  },
  rejectButton: {
    backgroundColor: '#dc2626',
  },
  lifecycleBoardCard: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  lifecycleBoardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  lifecycleBoardTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1e3a8a',
  },
  lifecycleBoardMeta: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  lifecycleBoardTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  lifecycleBoardTab: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#f8fafc',
  },
  lifecycleBoardTabActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  lifecycleBoardTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  lifecycleBoardTabTextActive: {
    color: '#ffffff',
  },
  schedulerCalendarWrap: {
    minWidth: 860,
  },
  schedulerCalendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 5,
  },
  schedulerCalendarHeaderCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '700',
    color: '#7a9181',
  },
  schedulerCalendarWeekRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 5,
  },
  schedulerCalendarDayCell: {
    flex: 1,
    minHeight: 104,
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 4,
    backgroundColor: '#f8fcf8',
    borderWidth: 1,
    borderColor: '#d9e7dc',
    borderRadius: 9,
  },
  schedulerCalendarDayCellMuted: {
    opacity: 0.55,
  },
  schedulerCalendarDayCellToday: {
    borderColor: '#16a34a',
    backgroundColor: '#effaf1',
    shadowColor: '#14532d',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
  },
  schedulerCalendarDayHeader: {
    alignItems: 'center',
    marginBottom: 5,
    gap: 2,
  },
  schedulerCalendarDayDate: {
    fontSize: 11,
    fontWeight: '700',
    color: '#647f6c',
    textAlign: 'center',
  },
  schedulerCalendarDayDateMuted: {
    color: '#9aa9a1',
  },
  schedulerCalendarDayDateToday: {
    color: '#166534',
    fontSize: 12,
  },
  schedulerCalendarTodayTag: {
    fontSize: 8,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  schedulerCalendarProjectPill: {
    borderRadius: 8,
    backgroundColor: '#e8f3ff',
    borderWidth: 1,
    borderColor: '#c7ddff',
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginBottom: 4,
  },
  schedulerCalendarProjectTitle: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#1e3a8a',
  },
  schedulerProjectCalendarSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#d9e7dc',
    paddingTop: 14,
  },
  schedulerProjectCalendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  schedulerProjectCalendarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  schedulerProjectCalendarMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  schedulerProjectCalendarCount: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  schedulerProjectCalendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  schedulerProjectCalendarCard: {
    width: 220,
    minHeight: 96,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e7dc',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  schedulerProjectCalendarCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  schedulerProjectCalendarCardTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  schedulerProjectCalendarCardDate: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    lineHeight: 17,
  },
  schedulerProjectCalendarCardMeta: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  schedulerProjectCalendarStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  schedulerProjectCalendarEmptyState: {
    backgroundColor: '#f8fcf8',
    borderWidth: 1,
    borderColor: '#d9e7dc',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  schedulerProjectCalendarEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  schedulerProjectCalendarEmptyMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
  },
  schedulerWeekRow: {
    flexDirection: 'row',
    gap: 10,
  },
  schedulerDayColumn: {
    width: 170,
    minHeight: 220,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#f8fafc',
  },
  schedulerDayName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  schedulerDayDate: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  schedulerEventPill: {
    borderLeftWidth: 4,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginBottom: 8,
  },
  schedulerEventTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  schedulerEventMeta: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  schedulerEmptyText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 6,
  },
  timelineBoard: {
    minWidth: 880,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  timelineHeaderProject: {
    width: 220,
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
  },
  timelineHeaderDays: {
    flexDirection: 'row',
    width: 448,
    justifyContent: 'space-between',
  },
  timelineHeaderDay: {
    width: 64,
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    fontWeight: '700',
  },
  timelineProjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  timelineProjectName: {
    width: 220,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    paddingRight: 10,
  },
  timelineTrack: {
    width: 448,
    height: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    position: 'relative',
    justifyContent: 'center',
  },
  timelineBar: {
    position: 'absolute',
    top: 5,
    height: 24,
    borderRadius: 6,
  },
  timelineDateRange: {
    paddingLeft: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
  },
  addButton: {
    backgroundColor: '#4CAF50',
    width: 36,
    height: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.75,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  projectModalSave: {
    color: '#166534',
    fontSize: 15,
    fontWeight: '700',
  },
  modalContent: {
    flex: 1,
    padding: 16,
    overflow: 'visible',
  },
  proposalModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  proposalModalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
    gap: 14,
  },
  proposalModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  proposalModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proposalModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalModalSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748b',
  },
  proposalModalScroll: {
    maxHeight: Platform.select({ web: 560, default: 520 }),
  },
  proposalModalScrollContent: {
    paddingBottom: 4,
  },
  proposalModalEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  proposalModalEmptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  proposalModalEmptyMeta: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  labelRight: {
    marginBottom: 0,
    minWidth: 140,
    flexShrink: 1,
    textAlign: 'right',
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  labelTop: {
    marginTop: 4,
  },
  formRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  formRowTop: {
    alignItems: 'flex-start',
  },
  formRowReverse: {
    flexDirection: 'row-reverse',
  },
  statusOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 0,
  },
  statusOptionsCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'visible',
  },
  helperPanel: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  helperPanelTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  helperPanelText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  projectImageEditorCard: {
    gap: 12,
  },
  projectImageEditorHeader: {
    gap: 4,
  },
  projectImageEditorTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectImageEditorMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  projectImageEditorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  projectImagePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  projectImagePickerButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  dropdownWrapper: {
    flex: 1,
    position: 'relative',
    zIndex: 1000,
    overflow: 'visible',
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  dropdownButtonText: {
    fontSize: 15,
    color: '#374151',
    flex: 1,
  },
  dropdownContent: {
    position: 'relative',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    backgroundColor: '#fff',
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 10,
    maxHeight: 240,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  dropdownOptionSelected: {
    backgroundColor: '#f0fdf4',
  },
  dropdownOptionText: {
    fontSize: 14,
    color: '#374151',
    marginLeft: 10,
    flex: 1,
  },
  skillSelectionCard: {
    gap: 10,
  },
  skillOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  skillOptionRow: {
    minWidth: 170,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  skillOptionText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '600',
  },
  skillOptionTextSelected: {
    color: '#0F766E',
  },
  customSkillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  customSkillInput: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  customSkillAddButton: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#0F766E',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  customSkillAddButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  selectedSkillChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  selectedSkillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfeff',
    borderWidth: 1,
    borderColor: '#99f6e4',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectedSkillChipText: {
    color: '#0F766E',
    fontSize: 12,
    fontWeight: '700',
  },
  projectImageRemoveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  projectImageRemoveButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#b91c1c',
  },
  projectImagePreviewCard: {
    gap: 8,
  },
  projectImagePreview: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  projectImagePreviewMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  projectImageEmptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  projectImageEmptyStateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  statusOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  statusOptionSelected: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  statusOptionText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  statusOptionTextSelected: {
    color: '#fff',
  },
  textArea: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
    color: '#333',
    textAlignVertical: 'top',
    marginBottom: 0,
  },
  singleLineInput: {
    minHeight: 48,
    textAlignVertical: 'center',
  },
  inputWithLabel: {
    flex: 1,
    marginBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  helperText: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 16,
  },
  locationPickerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  locationPickerContainer: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: '#f8fafc',
  },
  locationPicker: {
    height: 50,
    color: '#334155',
  },
  locationPickerHelperText: {
    marginTop: 2,
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  datePickerButton: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  datePickerButtonText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  iosDatePickerActions: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  iosDatePickerButton: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
  },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});






