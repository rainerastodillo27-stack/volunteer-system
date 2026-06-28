import React, { useEffect, useMemo, useState } from 'react';
import ModernTheme from '../utils/modernTheme';
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
  getProgramModuleFromProposalProjectId,
  getAllPartnerProjectApplications,
  getAllPartnerReports,
  getAllVolunteerProjectMatches,
  getAllVolunteerTimeLogs,
  getAllPartners,
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
  reconcileApprovedVolunteerEventMemberships,
  deleteProgram,
  notifyVolunteerAboutTaskUnassignment,
  notifyVolunteerAboutTaskUpdate,
  saveEvent,
  saveProgram,
  saveProject,
  saveStatusUpdate,
  subscribeToStorageChanges,
  clearStorageCache,
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
import { getPrimaryReportMediaUri, isImageMediaUri, pickDocumentFromDevice, pickImageFromDevice } from '../utils/media';
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
type ProgramSuiteModule = string;
type ProgramSuiteView = 'programs' | 'projects' | 'events';

function isProgramSuiteView(value: unknown): value is ProgramSuiteView {
  return value === 'programs' || value === 'projects' || value === 'events';
}

function getProgramSuiteViewFromRoute(route?: { name?: string; params?: { programSuiteView?: unknown } }): ProgramSuiteView {
  if (isProgramSuiteView(route?.params?.programSuiteView)) {
    return route.params.programSuiteView;
  }

  if (route?.name === 'Programs') {
    return 'programs';
  }

  if (route?.name === 'Events') {
    return 'events';
  }

  return 'projects';
}

function getProgramSuiteRouteName(view: ProgramSuiteView): 'Programs' | 'Projects' | 'Events' {
  if (view === 'programs') {
    return 'Programs';
  }

  if (view === 'events') {
    return 'Events';
  }

  return 'Projects';
}

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
  // First check if project has a parentProjectId (for projects created under programs)
  if (project.parentProjectId) {
    return String(project.parentProjectId).trim();
  }
  // Fall back to program_id, then programModule, then category
  return String((project as any).program_id || project.programModule || project.category || '').trim();
}

function inferProgramTrackFocus(track: ProgramTrack): AdvocacyFocus | null {
  const text = `${track.id || ''} ${track.title || ''}`.toLowerCase();
  if (text.includes('education')) return 'Education';
  if (text.includes('livelihood')) return 'Livelihood';
  if (text.includes('nutrition')) return 'Nutrition';
  if (text.includes('disaster')) return 'Disaster';
  return null;
}

function getProgramSuiteModuleForProject(project: Project, activeProgramTracks: ProgramTrack[]): string | null {
  const activeProgramTrackIds = new Set(activeProgramTracks.map(track => String(track.id).trim()));
  // For child projects (those with parentProjectId), use that as the grouping
  if (project.parentProjectId) {
    const programId = String(project.parentProjectId).trim();
    return activeProgramTrackIds.has(programId) ? programId : null;
  }
  // For legacy projects without parentProjectId, check if programModule matches an active program ID
  const programModule = String(project.programModule || '').trim();
  if (activeProgramTrackIds.has(programModule)) {
    return programModule;
  }
  // Also check category as fallback
  const category = String(project.category || '').trim();
  if (activeProgramTrackIds.has(category)) {
    return category;
  }

  const projectFocus = (project.programModule || project.category || '') as AdvocacyFocus;
  const matchingTrack = activeProgramTracks.find(track => inferProgramTrackFocus(track) === projectFocus);
  if (matchingTrack) {
    return String(matchingTrack.id).trim();
  }

  return null;
}

function isProgramSuiteProjectRecord(project: Project): boolean {
  return Boolean(
    !project.isEvent &&
    (
      project.parentProjectId ||
      String(project.id || '').startsWith('project-proposal-')
    )
  );
}

function isTopLevelProgramRecord(project: Project, activeProgramTracks: ProgramTrack[]): boolean {
  const projectId = String(project.id || '').trim().toLowerCase();
  const projectTitle = String(project.title || '').trim().toLowerCase();
  return activeProgramTracks.some(track => {
    const trackId = String(track.id || '').trim().toLowerCase();
    const trackTitle = String(track.title || '').trim().toLowerCase();
    return Boolean(
      (trackId && projectId === trackId) ||
      (trackTitle && projectTitle === trackTitle)
    );
  });
}

function isApprovedProposalLikeProject(
  project: Project,
  module: string,
  activeProgramTracks: ProgramTrack[],
  approvedProposalModules: Set<string>
): boolean {
  if (project.isEvent || project.parentProjectId || isTopLevelProgramRecord(project, activeProgramTracks)) {
    return false;
  }

  return approvedProposalModules.has(module);
}

function getProgramTrackIdForFocus(focus: string, activeProgramTracks: ProgramTrack[]): string | null {
  const normalizedFocus = String(focus || '').trim();
  if (!normalizedFocus) {
    return null;
  }

  return (
    activeProgramTracks.find(track =>
      String(track.id || '').trim() === normalizedFocus ||
      inferProgramTrackFocus(track) === normalizedFocus
    )?.id || null
  );
}

function getApplicationProgramModuleForProject(
  project: Project,
  application: PartnerProjectApplication | undefined,
  activeProgramTracks: ProgramTrack[]
): string | null {
  if (!application || application.status !== 'Approved') {
    return null;
  }

  const targetProjectId = String(application.proposalDetails?.targetProjectId || '').trim();
  if (targetProjectId) {
    const matchingTrack = activeProgramTracks.find(track => String(track.id || '').trim() === targetProjectId);
    if (matchingTrack) {
      return matchingTrack.id;
    }
  }

  const requestedModule = String(
    application.proposalDetails?.requestedProgramModule ||
    getProgramModuleFromProposalProjectId(application.projectId) ||
    ''
  ).trim();
  if (!requestedModule) {
    return null;
  }

  return getProgramTrackIdForFocus(requestedModule, activeProgramTracks);
}

function findApprovedProposalApplicationForProject(
  project: Project,
  applications: PartnerProjectApplication[]
): PartnerProjectApplication | undefined {
  const projectId = String(project.id || '').trim();
  const projectTitle = String(project.title || '').trim().toLowerCase();

  return applications.find(application => {
    if (application.status !== 'Approved') {
      return false;
    }

    if (String(application.projectId || '').trim() === projectId) {
      return true;
    }

    const approvedProjectId = String((application.proposalDetails as any)?.approvedProjectId || '').trim();
    if (approvedProjectId && approvedProjectId === projectId) {
      return true;
    }

    const proposedTitle = String(application.proposalDetails?.proposedTitle || '').trim().toLowerCase();
    return Boolean(projectTitle && proposedTitle && projectTitle === proposedTitle);
  });
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
  communityNeed: string;
  expectedDeliverables: string;
  attachmentUrl: string;
  isEvent: boolean;
  locationVenue: string;
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
  assignedVolunteerIds: string[];
  isFieldOfficer: boolean;
  skillsNeeded: string[];
};

type ProjectTimeLogEntry = VolunteerTimeLog & {
  volunteerName: string;
  volunteerEmail: string;
};

type ProjectVolunteerAttendanceCard = {
  volunteerId: string;
  volunteerName: string;
  volunteerEmail: string;
  logs: ProjectTimeLogEntry[];
  timeInCount: number;
  timeOutCount: number;
  attendanceDays: number;
  checkedAttendanceDays: number;
  latestActivityLabel: string;
  activeLog: ProjectTimeLogEntry | null;
};

function getLocalDateKey(value?: string): string {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
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

function getReportBeneficiariesServed(report: PartnerReport): number {
  const beneficiariesServed = Number(report.metrics?.beneficiariesServed);
  if (Number.isFinite(beneficiariesServed) && beneficiariesServed > 0) {
    return beneficiariesServed;
  }

  const impactCount = Number(report.impactCount);
  return Number.isFinite(impactCount) && impactCount > 0 ? impactCount : 0;
}

function formatImpactCount(value: number): string {
  return value.toLocaleString('en-US');
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
  communityNeed: '',
  expectedDeliverables: '',
  attachmentUrl: '',
  isEvent,
  locationVenue: '',
});

const createEmptyProjectTaskDraft = (): ProjectTaskDraft => ({
  title: '',
  description: '',
  category: 'General',
  priority: 'Medium',
  status: 'Unassigned',
  assignedVolunteerIds: [],
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

function getProgramWebOverview(program: {
  title: string;
  description?: string;
  context?: string;
  projects: Project[];
  events: Project[];
}): {
  about: string;
  highlights: { title: string; description: string }[];
} {
  const savedAbout =
    program.description?.trim() ||
    program.context?.trim() ||
    program.projects.find(project => project.description?.trim())?.description.trim() ||
    program.events.find(event => event.description?.trim())?.description.trim();

  const highlights = [...program.projects, ...program.events]
    .filter(item => item.title?.trim() || item.description?.trim())
    .map(item => ({
      title: item.title?.trim() || (item.isEvent ? 'Scheduled event' : 'Project'),
      description:
        item.description?.trim() ||
        item.communityNeed?.trim() ||
        item.expectedDeliverables?.trim() ||
        formatProjectDateRangeLabel(item.startDate, item.endDate),
    }))
    .filter(item => item.description.trim());

  return {
    about: savedAbout || `${program.title} has no saved overview yet.`,
    highlights,
  };
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

function getDateOnlyBoundary(value?: string, endOfDay = false): Date | undefined {
  const parsedDate = new Date(value || '');
  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }
  parsedDate.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return parsedDate;
}

function normalizeDateOnlyValue(value: Date): Date {
  const normalized = new Date(value);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function isDateWithinBounds(value: Date, minDate?: Date, maxDate?: Date): boolean {
  const date = normalizeDateOnlyValue(value);
  if (minDate && date < minDate) {
    return false;
  }
  if (maxDate && date > maxDate) {
    return false;
  }
  return true;
}

function clampDateToBounds(value: Date, minDate?: Date, maxDate?: Date): Date {
  const date = normalizeDateOnlyValue(value);
  if (minDate && date < minDate) {
    return new Date(minDate);
  }
  if (maxDate && date > maxDate) {
    return new Date(maxDate);
  }
  return date;
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

  if (tokens.length < 2) {
    return { regionCode: '', cityCode: '', barangayCode: '' };
  }

  const regionToken = normalizeAddressToken(tokens[tokens.length - 1]);
  const cityToken = normalizeAddressToken(tokens[tokens.length - 2]);
  const barangayToken = tokens.length >= 3
    ? normalizeAddressToken(tokens[tokens.length - 3])
    : '';

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

  const barangays = barangayToken ? getBarangaysByCity(city.code) : [];
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

function getProjectLocationSelection(project: Project | null | undefined): {
  regionCode: string;
  cityCode: string;
} {
  if (!project) {
    return { regionCode: '', cityCode: '' };
  }

  const parsedSelection = parsePhilippineAddressSelection(project.location?.address || '');
  if (parsedSelection.regionCode && parsedSelection.cityCode) {
    return {
      regionCode: parsedSelection.regionCode,
      cityCode: parsedSelection.cityCode,
    };
  }

  const regionName = normalizeAddressToken(
    project.location?.region || project.locationRegion || ''
  );
  const region = PHRegions.find(item => normalizeAddressToken(item.name) === regionName);
  if (!region) {
    return {
      regionCode: parsedSelection.regionCode,
      cityCode: parsedSelection.cityCode,
    };
  }

  const cityName = normalizeAddressToken(
    project.location?.city || project.locationCity || ''
  );
  const city = getCitiesByRegion(region.code).find(
    item =>
      normalizeAddressToken(item.displayName) === cityName ||
      normalizeAddressToken(item.name) === cityName
  );

  return {
    regionCode: region.code,
    cityCode: city?.code || parsedSelection.cityCode,
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
  const [allPartnerReports, setAllPartnerReports] = useState<PartnerReport[]>([]);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [allVolunteerMatches, setAllVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [selectedAttendanceVolunteerId, setSelectedAttendanceVolunteerId] = useState<string | null>(null);
  const [selectedAttendancePhotoUri, setSelectedAttendancePhotoUri] = useState<string | null>(null);
  const [selectedAttendanceDateKey, setSelectedAttendanceDateKey] = useState<string | null>(null);
  const [attendancePickerVisible, setAttendancePickerVisible] = useState(false);
  const [taskBoardModalVisible, setTaskBoardModalVisible] = useState(false);
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectEditorMode, setProjectEditorMode] = useState<'project' | 'event' | null>(null);
  const [isProjectSaveSuccess, setIsProjectSaveSuccess] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showParticipantsSection, setShowParticipantsSection] = useState(false);
  const [isTaskSaveSuccess, setIsTaskSaveSuccess] = useState(false);
  const [taskSaveSuccessMessage, setTaskSaveSuccessMessage] = useState('');
  const [taskSaveNotice, setTaskSaveNotice] = useState<string | null>(null);
  const taskSaveNoticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [showAssignmentDropdown, setShowAssignmentDropdown] = useState(false);
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);
  const [showTaskList, setShowTaskList] = useState(false);
  const [showProgramProposalModal, setShowProgramProposalModal] = useState(false);
  const [showAddProgramModal, setShowAddProgramModal] = useState(false);
  const [newProgramName, setNewProgramName] = useState('');
  const [isAddProgramSuccess, setIsAddProgramSuccess] = useState(false);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [programDraft, setProgramDraft] = useState({ title: '', description: '', context: '', icon: 'folder', color: '#6366f1', imageUrl: '' });
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
  const [selectedProgramWebModule, setSelectedProgramWebModule] = useState<ProgramSuiteModule | null>(null);
  const [programSuiteView, setProgramSuiteView] = useState<ProgramSuiteView>(
    () => getProgramSuiteViewFromRoute(route)
  );
  // Status filter for the projects view — null means show all
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
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
  const [expandedVolunteerRequestIds, setExpandedVolunteerRequestIds] = useState<Set<string>>(
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

  useEffect(() => {
    setSelectedAttendanceVolunteerId(null);
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject?.isEvent) {
      setSelectedAttendanceDateKey(null);
      return;
    }

    const eventDateKeys = getDateRangeKeys(selectedProject.startDate, selectedProject.endDate);
    const todayKey = getLocalDateKey(currentDate.toISOString());
    setSelectedAttendanceDateKey(
      eventDateKeys.includes(todayKey)
        ? todayKey
        : eventDateKeys[0] || todayKey
    );
  }, [currentDate, selectedProject?.endDate, selectedProject?.id, selectedProject?.isEvent, selectedProject?.startDate]);

  useEffect(() => {
    setProgramSuiteView(getProgramSuiteViewFromRoute(route));
    if (route?.params?.programSuiteNavKey) {
      setSelectedProject(null);
      setSelectedProgramWebModule(null);
    }
  }, [route?.name, route?.params?.programSuiteNavKey, route?.params?.programSuiteView]);

  const switchProgramSuiteView = (nextView: ProgramSuiteView) => {
    setProgramSuiteView(nextView);

    const routeName = getProgramSuiteRouteName(nextView);
    const navigated = navigateToAvailableRoute(navigation, routeName, { programSuiteView: nextView });
    if (!navigated) {
      navigation?.setParams?.({ programSuiteView: nextView });
    }
  };

  const openVolunteerAttendanceDetails = (volunteerId: string) => {
    setSelectedAttendanceVolunteerId(volunteerId);
  };

  const closeVolunteerAttendanceDetails = () => {
    setSelectedAttendanceVolunteerId(null);
    setSelectedAttendancePhotoUri(null);
  };

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

  useEffect(() => {
    if (!showProjectModal || !projectDraft.isEvent || !projectDraftParentProject) {
      return;
    }

    const parentSelection = getProjectLocationSelection(projectDraftParentProject);
    if (!parentSelection.regionCode || !parentSelection.cityCode) {
      return;
    }

    const cities = getCitiesByRegion(parentSelection.regionCode);
    const barangays = getBarangaysByCity(parentSelection.cityCode);
    setProjectRegionCode(parentSelection.regionCode);
    setProjectLocationCities(cities);
    setProjectCityCode(parentSelection.cityCode);
    setProjectLocationBarangays(barangays);
    setProjectBarangayCode(current =>
      barangays.some(barangay => barangay.code === current) ? current : ''
    );
  }, [
    showProjectModal,
    projectDraft.isEvent,
    projectDraft.parentProjectId,
    projectDraftParentProject,
  ]);

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
        void loadAllPartnerReports();
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
        ['programs', 'projects', 'events', 'partners', 'statusUpdates', 'partnerProjectApplications', 'partnerReports', 'volunteerProjectJoins', 'volunteerMatches', 'volunteerTimeLogs', 'programTracks'],
        event => {
          // For storage updates, update light data immediately and defer heavy refreshes
          void refreshLight();
          if (event.keys.includes('volunteerTimeLogs')) {
            void loadVolunteerTimeLogs();
          }
          if (event.keys.includes('partnerReports')) {
            void loadAllPartnerReports();
          }
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
      await reconcileApprovedVolunteerEventMemberships();
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
        icon: 'folder',
        color: '#6366f1', // Default indigo
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
      }, 1000);
    } catch (error) {
      Alert.alert('Error', getRequestErrorMessage(error, 'Failed to create program.'));
    } finally {
      setActionLoadingKey(null);
    }
  };

  const openCreateProgramModal = () => {
    setEditingProgramId(null);
    setProgramDraft({ title: '', description: '', context: '', icon: 'folder', color: '#6366f1', imageUrl: '' });
    setShowProgramCrudModal(true);
  };

  const openEditProgramModal = (track: ProgramTrack) => {
    setEditingProgramId(track.id);
    setProgramDraft({
      title: track.title,
      description: track.description || '',
      context: track.context || '',
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
        description: programDraft.description.trim() || undefined,
        context: programDraft.context.trim() || undefined,
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
      }, 1000);
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
        // Optimistically remove from UI
        setProgramTracks(current => current.filter(track => track.id !== trackId));
        
        // Delete from backend
        await deleteProgram(trackId);
        
        // Force clear cache to ensure fresh data
        clearStorageCache(['programs', 'programTracks', 'projects', 'events']);
        
        // Wait a bit to ensure backend deletion propagates
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Reload fresh data
        await loadProgramTracks();
        
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(`✅ Program Deleted\n\n"${trackTitle}" has been removed from the dashboard.`);
        } else {
          Alert.alert('✅ Program Deleted', `"${trackTitle}" has been removed from the dashboard.`);
        }
      } catch (error) {
        // On error, reload to restore correct state
        await loadProgramTracks();
        const errorMsg = getRequestErrorMessage(error, 'Failed to delete program.');
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(`Error\n\n${errorMsg}`);
        } else {
          Alert.alert('Error', errorMsg);
        }
      } finally {
        setActionLoadingKey(null);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Delete "${trackTitle}"? This cannot be undone. Projects and events under this program will also be deleted.`)) {
        void doDelete();
      }
      return;
    }

    Alert.alert(
      'Delete Program',
      `Delete "${trackTitle}"? This cannot be undone. Projects and events under this program will also be deleted.`,
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

  // Opens the project editor pre-wired to a specific program track.
  const openCreateProjectInProgramModal = (trackId: string, trackTitle: string) => {
    setEditingProjectId(null);
    setProjectEditorMode('project');
    // Determine advocacy focus from the track ID if it's a known module, else default to Education
    const knownModules: AdvocacyFocus[] = ['Education', 'Livelihood', 'Nutrition', 'Disaster'];
    const advocacyFocus: AdvocacyFocus = knownModules.includes(trackId as AdvocacyFocus)
      ? (trackId as AdvocacyFocus)
      : 'Education';
    // Create draft with parentProjectId set to the program ID for correct grouping on mobile
    const draft = createEmptyProjectDraft('', advocacyFocus, false, '', '', trackId);
    // Ensure both program_id and parentProjectId point to the program
    draft.program_id = trackId;
    draft.parentProjectId = trackId;
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
    nextDraft.communityNeed = parentProject.communityNeed || '';
    nextDraft.expectedDeliverables = parentProject.expectedDeliverables || '';
    nextDraft.attachmentUrl =
      (parentProject.attachments || []).find(attachment => attachment.type === 'document')?.url || '';
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
      communityNeed: project.communityNeed || '',
      expectedDeliverables: project.expectedDeliverables || '',
      attachmentUrl:
        (project.attachments || []).find(attachment => attachment.type === 'document')?.url || '',
      isEvent: !!project.isEvent,
      locationVenue: project.locationVenue || '',
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
    const deletePrimary = async () => {
      if (project.isEvent) {
        await deleteEvent(project.id);
        return;
      }
      await deleteProject(project.id);
    };

    const deleteFallback = async () => {
      if (project.isEvent) {
        await deleteProject(project.id);
        return;
      }
      await deleteEvent(project.id);
    };

    try {
      await deletePrimary();
    } catch {
      await deleteFallback();
    }
  };

  // Loads every impact report used by program-level beneficiary totals.
  const loadAllPartnerReports = async () => {
    try {
      const reports = await getAllPartnerReports();
      setAllPartnerReports(reports);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load system reports.'),
      });
    }
  };

  const handleDeleteEventRecord = (event: Project) => {
    if (!isAdmin || !event.isEvent) {
      return;
    }

    const doDelete = async () => {
      const previousSelectedProject = selectedProject;
      const previousProjects = projects;
      setActionLoadingKey(`deleteEvent-${event.id}`);
      setProjects(currentProjects => currentProjects.filter(project => project.id !== event.id));
      setSelectedProject(currentProject =>
        currentProject?.id === event.id ? null : currentProject
      );

      try {
        // Delete from backend
        await deleteProjectLikeRecord(event);
        
        // Force clear cache to ensure fresh data
        clearStorageCache(['events', 'projects', 'statusUpdates', 'volunteerProjectJoins', 'volunteerMatches', 'volunteerTimeLogs']);
        
        // Wait a bit to ensure backend deletion propagates
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Reload fresh data
        await loadProjects();
        
        showTaskSaveNotice(`Event "${event.title}" was deleted successfully.`, 1200);
      } catch (error) {
        setProjects(previousProjects);
        setSelectedProject(previousSelectedProject);
        const errorMsg = getRequestErrorMessage(error, 'Failed to delete event.');
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(`${getRequestErrorTitle(error)}\n\n${errorMsg}`);
        } else {
          Alert.alert(getRequestErrorTitle(error), errorMsg);
        }
      } finally {
        setActionLoadingKey(null);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Delete "${event.title}"? This cannot be undone.`)) {
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

  // Helper: Auto-updates latitude/longitude when address is set from location selection
  const updateLocationCoordinatesFromAddress = async (address: string) => {
    if (!address) {
      handleProjectDraftChange('latitude', '');
      handleProjectDraftChange('longitude', '');
      return;
    }

    // 1. First try synchronous city-level local lookup (no province fallback yet)
    const coordinates = inferCoordinatesFromPlace(address, [], false);
    if (coordinates) {
      handleProjectDraftChange('latitude', String(coordinates.latitude));
      handleProjectDraftChange('longitude', String(coordinates.longitude));
      return;
    }

    // 2. If city is not found locally, fetch accurate coordinates using live geocoding API
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
        {
          headers: {
            'User-Agent': 'NVC-Connect-Volunteer-System/1.0',
          },
        }
      );
      const data = await response.json();
      if (data && data.length > 0) {
        handleProjectDraftChange('latitude', String(data[0].lat));
        handleProjectDraftChange('longitude', String(data[0].lon));
        return;
      }

      // Try geocoding with a slightly shorter query (e.g. drop barangay if present) if full address fails
      const parts = address.split(',').map(p => p.trim());
      if (parts.length > 2) {
        const shorterQuery = parts.slice(1).join(', '); // drop barangay, keep city + region
        const fallbackResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(shorterQuery)}&format=json&limit=1`,
          {
            headers: {
              'User-Agent': 'NVC-Connect-Volunteer-System/1.0',
            },
          }
        );
        const fallbackData = await fallbackResponse.json();
        if (fallbackData && fallbackData.length > 0) {
          handleProjectDraftChange('latitude', String(fallbackData[0].lat));
          handleProjectDraftChange('longitude', String(fallbackData[0].lon));
          return;
        }
      }
    } catch (error) {
      console.warn('[Geocoder] Live geocoding request failed, falling back to local database:', error);
    }

    // 3. Last resort: fall back to local province center coordinates
    const provinceCoords = inferCoordinatesFromPlace(address, [], true);
    if (provinceCoords) {
      handleProjectDraftChange('latitude', String(provinceCoords.latitude));
      handleProjectDraftChange('longitude', String(provinceCoords.longitude));
    }
  };

  const handleProjectRegionChange = (regionCode: string) => {
    setProjectRegionCode(regionCode);
    setProjectCityCode('');
    setProjectBarangayCode('');
    setProjectLocationBarangays([]);
    setProjectLocationCities(regionCode ? getCitiesByRegion(regionCode) : []);
    handleProjectDraftChange('address', '');
    updateLocationCoordinatesFromAddress('');
  };

  const handleProjectCityChange = (cityCode: string) => {
    setProjectCityCode(cityCode);
    setProjectBarangayCode('');
    setProjectLocationBarangays(cityCode ? getBarangaysByCity(cityCode) : []);
    
    if (!projectRegionCode || !cityCode) {
      handleProjectDraftChange('address', '');
      updateLocationCoordinatesFromAddress('');
      return;
    }

    const selectedRegion = PHRegions.find(region => region.code === projectRegionCode);
    const selectedCity = projectLocationCities.find(city => city.code === cityCode);

    const newAddress = composePhilippineAddress(
      selectedRegion?.name || '',
      selectedCity?.displayName || '',
      ''
    );
    handleProjectDraftChange('address', newAddress);
    updateLocationCoordinatesFromAddress(newAddress);
  };

  const handleProjectBarangayChange = (barangayCode: string) => {
    setProjectBarangayCode(barangayCode);

    if (!projectRegionCode || !projectCityCode) {
      handleProjectDraftChange('address', '');
      updateLocationCoordinatesFromAddress('');
      return;
    }

    const selectedRegion = PHRegions.find(region => region.code === projectRegionCode);
    const selectedCity = projectLocationCities.find(city => city.code === projectCityCode);
    const selectedBarangay = projectLocationBarangays.find(
      barangay => barangay.code === barangayCode
    );

    if (!barangayCode) {
      const newAddress = composePhilippineAddress(
        selectedRegion?.name || '',
        selectedCity?.displayName || '',
        ''
      );
      handleProjectDraftChange('address', newAddress);
      updateLocationCoordinatesFromAddress(newAddress);
      return;
    }

    const newAddress = composePhilippineAddress(
      selectedRegion?.name || '',
      selectedCity?.displayName || '',
      selectedBarangay?.name || ''
    );
    handleProjectDraftChange('address', newAddress);
    updateLocationCoordinatesFromAddress(newAddress);
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

  const handlePickProjectDocument = async () => {
    try {
      const pickedDocument = await pickDocumentFromDevice();
      if (!pickedDocument) {
        return;
      }

      handleProjectDraftChange('attachmentUrl', pickedDocument);
    } catch (error: any) {
      Alert.alert('Document Access Needed', error?.message || 'Unable to open your file library.');
    }
  };

  const handleRemoveProjectDocument = () => {
    handleProjectDraftChange('attachmentUrl', '');
  };

  const openCreateTaskModal = () => {
    setEditingTaskId(null);
    setTaskDraft(createEmptyProjectTaskDraft());
    setCustomTaskSkill('');
    setShowAssignmentDropdown(false);
    setIsTaskSaveSuccess(false);
    setTaskSaveSuccessMessage('');
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
      assignedVolunteerIds: getTaskAssignedVolunteerIds(task),
      isFieldOfficer: Boolean(task.isFieldOfficer),
      skillsNeeded: task.skillsNeeded || [],
    });
    setCustomTaskSkill('');
    setShowAssignmentDropdown(false);
    setIsTaskSaveSuccess(false);
    setTaskSaveSuccessMessage('');
    setShowTaskModal(true);
  };

  const closeTaskModal = () => {
    setShowTaskModal(false);
    setIsTaskSaveSuccess(false);
    setTaskSaveSuccessMessage('');
    setEditingTaskId(null);
    setTaskDraft(createEmptyProjectTaskDraft());
    setCustomTaskSkill('');
    setShowAssignmentDropdown(false);
  };

  useEffect(() => {
    return () => {
      if (taskSaveNoticeTimerRef.current) {
        clearTimeout(taskSaveNoticeTimerRef.current);
      }
    };
  }, []);

  const showTaskSaveNotice = (message: string, durationMs?: number) => {
    if (taskSaveNoticeTimerRef.current) {
      clearTimeout(taskSaveNoticeTimerRef.current);
      taskSaveNoticeTimerRef.current = null;
    }

    setTaskSaveNotice(message);

    if (typeof durationMs === 'number' && durationMs > 0) {
      taskSaveNoticeTimerRef.current = setTimeout(() => {
        setTaskSaveNotice(null);
        taskSaveNoticeTimerRef.current = null;
      }, durationMs);
    }
  };

  const renderTaskSaveToast = () =>
    taskSaveNotice ? (
      <View pointerEvents="box-none" style={styles.taskSaveToastOverlay}>
        <View style={styles.taskSaveNotice}>
          <MaterialIcons name="check-circle" size={20} color="#166534" />
          <Text style={styles.taskSaveNoticeText}>{taskSaveNotice}</Text>
          <TouchableOpacity style={styles.taskSaveNoticeButton} onPress={() => setTaskSaveNotice(null)}>
            <Text style={styles.taskSaveNoticeButtonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    ) : null;

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

    const listedProject = projects.find(project => project.id === selectedProject.id) || null;
    if (!listedProject) {
      return selectedProject;
    }

    const selectedUpdatedAt = new Date(selectedProject.updatedAt || '').getTime();
    const listedUpdatedAt = new Date(listedProject.updatedAt || '').getTime();
    if (!Number.isNaN(selectedUpdatedAt) && !Number.isNaN(listedUpdatedAt) && selectedUpdatedAt > listedUpdatedAt) {
      return selectedProject;
    }

    return listedProject;
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

    setActionLoadingKey('saveProjectRecord');

    const failProjectSaveValidation = (message: string) => {
      setActionLoadingKey(null);
      setProjectSaveError(message);
      Alert.alert('Update Blocked', message);
    };

    const parsedLatitude = Number(projectDraft.latitude);
    const parsedLongitude = Number(projectDraft.longitude);
    // For events, use the user-provided value; for projects, set to 0
    const volunteersNeeded = projectDraft.isEvent ? Number(projectDraft.volunteersNeeded) : 0;
    const startDateValue = new Date(projectDraft.startDate);
    const endDateValue = new Date(projectDraft.endDate);
    const existingProject = editingProjectId
      ? projects.find(project => project.id === editingProjectId) || null
      : null;
    const resolvedEventParentProjectId =
      projectDraft.isEvent
        ? (
          projectDraft.parentProjectId?.trim()
          || (!selectedProject?.isEvent ? selectedProject?.id : '')
        )
        : '';
    const resolvedEventParentProject =
      projectDraft.isEvent && resolvedEventParentProjectId
        ? projects.find(project => !project.isEvent && project.id === resolvedEventParentProjectId) || null
        : null;
    const parentLocationSelection = getProjectLocationSelection(resolvedEventParentProject);
    const effectiveProjectRegionCode =
      projectDraft.isEvent
        ? (parentLocationSelection.regionCode || projectRegionCode)
        : projectRegionCode;
    const effectiveProjectCityCode =
      projectDraft.isEvent
        ? (parentLocationSelection.cityCode || projectCityCode)
        : projectCityCode;

    if (
      !projectDraft.title.trim() ||
      !projectDraft.description.trim() ||
      !projectDraft.startDate.trim() ||
      !projectDraft.endDate.trim() ||
      !effectiveProjectRegionCode ||
      !effectiveProjectCityCode ||
      (projectDraft.isEvent && !projectBarangayCode)
    ) {
      failProjectSaveValidation(
        projectDraft.isEvent
          ? 'Fill in all required fields: title, description, start date, end date, region, city, and barangay.'
          : 'Fill in all required fields: title, description, start date, end date, region, and city.'
      );
      return;
    }

    // For projects (non-events), preserve parentProjectId if it was set (for grouping in programs)
    const resolvedProjectParentId = !projectDraft.isEvent ? (projectDraft.parentProjectId?.trim() || undefined) : undefined;

    if (projectDraft.isEvent && !resolvedEventParentProjectId) {
      failProjectSaveValidation('Select a parent project before saving this event.');
      return;
    }

    if (projectDraft.startDate > projectDraft.endDate) {
      failProjectSaveValidation('End date must be on or after the start date.');
      return;
    }

    if (projectDraft.isEvent) {
      if (!resolvedEventParentProject) {
        failProjectSaveValidation('Choose a valid parent project for this event.');
        return;
      }

      const parentStartDate = getDateOnlyBoundary(resolvedEventParentProject.startDate);
      const parentEndDate = getDateOnlyBoundary(resolvedEventParentProject.endDate, true);
      if (
        !isDateWithinBounds(startDateValue, parentStartDate, parentEndDate) ||
        !isDateWithinBounds(endDateValue, parentStartDate, parentEndDate)
      ) {
        failProjectSaveValidation('Event dates must be within the parent project start and end dates.');
        return;
      }
    }

    const hasManualCoordinates =
      Boolean(projectDraft.latitude.trim()) &&
      Boolean(projectDraft.longitude.trim()) &&
      Number.isFinite(parsedLatitude) &&
      Number.isFinite(parsedLongitude);
    const selectedLocationRegion = PHRegions.find(region => region.code === effectiveProjectRegionCode);
    const effectiveLocationCities = effectiveProjectRegionCode === projectRegionCode
      ? projectLocationCities
      : getCitiesByRegion(effectiveProjectRegionCode);
    const selectedLocationCity = effectiveLocationCities.find(city => city.code === effectiveProjectCityCode);
    const effectiveLocationBarangays = effectiveProjectCityCode === projectCityCode
      ? projectLocationBarangays
      : getBarangaysByCity(effectiveProjectCityCode);
    const selectedLocationBarangay = effectiveLocationBarangays.find(barangay => barangay.code === projectBarangayCode);
    const structuredAddress = composePhilippineAddress(
      selectedLocationRegion?.name || '',
      selectedLocationCity?.displayName || '',
      projectDraft.isEvent ? selectedLocationBarangay?.name || '' : ''
    );
    const resolvedAddress = structuredAddress || projectDraft.address.trim();
    const hasStructuredPhilippineAddress =
      Boolean(effectiveProjectRegionCode) &&
      Boolean(effectiveProjectCityCode) &&
      (!projectDraft.isEvent || Boolean(projectBarangayCode));

    const resolvedCoordinates =
      (hasManualCoordinates
        ? { latitude: parsedLatitude, longitude: parsedLongitude }
        : null) ||
      inferCoordinatesFromPlace(resolvedAddress, projects) ||
      (existingProject
        ? {
          latitude: existingProject.location.latitude,
          longitude: existingProject.location.longitude,
        }
        : null);

    if (!resolvedCoordinates) {
      failProjectSaveValidation('Enter a recognizable barangay, city, municipality, or venue so the map can place this program.');
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
      parentProjectId: projectDraft.isEvent ? resolvedEventParentProjectId : resolvedProjectParentId,
      statusMode: inheritedStatusMode,
      manualStatus: inheritedManualStatus,
      status: projectDraft.status,
      category: getProjectCategoryFromModule(projectDraft.programModule),
      startDate: startDateValue.toISOString(),
      endDate: endDateValue.toISOString(),
      location: {
        latitude: resolvedCoordinates.latitude,
        longitude: resolvedCoordinates.longitude,
        address: resolvedAddress,
        region: selectedLocationRegion?.name,
        city: selectedLocationCity?.displayName,
        barangay: projectDraft.isEvent ? selectedLocationBarangay?.name : undefined,
      },
      locationRegion: selectedLocationRegion?.name,
      locationCity: selectedLocationCity?.displayName,
      locationBarangay: projectDraft.isEvent ? selectedLocationBarangay?.name : undefined,
      locationVenue: projectDraft.isEvent ? projectDraft.locationVenue.trim() : undefined,
      volunteersNeeded,
      volunteers: existingProject?.volunteers || [],
      joinedUserIds: existingProject?.joinedUserIds || [],
      skillsNeeded: projectDraft.skillsNeeded || [],
      communityNeed: projectDraft.communityNeed.trim(),
      expectedDeliverables: projectDraft.expectedDeliverables.trim(),
      attachments: [
        ...(projectDraft.imageUrl.trim()
          ? [{ url: projectDraft.imageUrl.trim(), type: 'image' as const }]
          : []),
        ...(projectDraft.attachmentUrl.trim()
          ? [{ url: projectDraft.attachmentUrl.trim(), type: 'document' as const }]
          : []),
      ],
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

    const shouldAutoCreateFieldOfficerTask = (project: Project): boolean => {
      if (!project.isEvent) {
        return false;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const eventEndDate = new Date(project.endDate);
      if (!Number.isNaN(eventEndDate.getTime())) {
        return eventEndDate >= today;
      }

      const eventStartDate = new Date(project.startDate);
      return !Number.isNaN(eventStartDate.getTime()) && eventStartDate >= today;
    };

    const projectToSave: Project =
      shouldAutoCreateFieldOfficerTask(savedProject) &&
      !(savedProject.internalTasks || []).some(task => task.isFieldOfficer)
        ? {
            ...savedProject,
            internalTasks: [
              ...(savedProject.internalTasks || []),
              {
                id: `${savedProject.id}-field-officer-${Date.now()}`,
                title: 'Field Officer',
                description: 'Manage attendance tracking and volunteer coordination for this event.',
                category: 'Field Coordination',
                priority: 'High',
                status: 'Assigned',
                isFieldOfficer: true,
                skillsNeeded: ['Leadership', 'Communication'],
                createdAt: now,
                updatedAt: now,
              } as ProjectInternalTask,
            ],
            updatedAt: now,
          }
        : savedProject;

    const isEditingExistingRecord = Boolean(editingProjectId);

    try {
      await saveProjectLikeRecord(projectToSave);
      await loadProjects();
      const successTitle = isEditingExistingRecord
        ? savedProject.isEvent
          ? 'Event Edit Completed'
          : 'Project Edit Completed'
        : savedProject.isEvent
          ? 'Event Created'
          : 'Project Created';
      const successMessage = isEditingExistingRecord
        ? savedProject.isEvent
          ? 'Event details were updated and saved successfully.'
          : 'Project details were updated and saved successfully.'
        : savedProject.isEvent
          ? 'Event was created and saved successfully.'
          : 'Project was created and saved successfully.';

      if (isEditingExistingRecord) {
        closeProjectModal();
        showTaskSaveNotice(
          savedProject.isEvent
            ? 'Event edit completed. The event details were updated and saved successfully.'
            : 'Project edit completed. The project details were updated and saved successfully.'
        );
        Alert.alert(successTitle, successMessage);
      } else if (savedProject.isEvent) {
        closeProjectModal();
        showTaskSaveNotice('Event created. The new event was saved and is now visible in the live project flow.');
        Alert.alert('Event Created', 'Event was created and saved successfully.', [
          { text: 'OK' },
        ]);
      } else {
        closeProjectModal();
        showTaskSaveNotice('Project created. The new project was saved successfully.', 1400);
        Alert.alert('Project Created', 'Project was created and saved successfully.', [
          { text: 'OK' },
        ]);
        void loadAllPartnerApplications();
      }
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to save project.')
      );
    } finally {
      setActionLoadingKey(null);
    }
  };

  // Confirms and deletes the currently edited project record.
  const handleDeleteProjectRecord = () => {
    if (!selectedProject || !isAdmin) {
      return;
    }

    const selectedRecordType = selectedProject.isEvent ? 'Event' : 'Project';
    const projectToDelete = selectedProject;
    const doDelete = async () => {
      setActionLoadingKey(`deleteProject-${projectToDelete.id}`);
      try {
        // Optimistically remove from UI
        setProjects(currentProjects => currentProjects.filter(project => project.id !== projectToDelete.id));
        
        // Delete from backend
        await deleteProjectLikeRecord(projectToDelete);
        
        // Force clear cache to ensure fresh data
        clearStorageCache(['projects', 'events', 'statusUpdates', 'volunteerProjectJoins', 'volunteerMatches', 'volunteerTimeLogs', 'partnerProjectApplications', 'partnerReports']);
        
        // Wait a bit to ensure backend deletion propagates
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Navigate back and clear related state
        handleReturnToProjectList();
        setStatusUpdates([]);
        setAllPartnerApplications([]);
        setPartnerReports([]);
        setVolunteerJoinRecords([]);
        
        // Reload fresh data
        await loadProjects();
        
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(`Deleted\n\n${projectToDelete.isEvent ? 'Event removed.' : 'Project removed.'}`);
        } else {
          Alert.alert('Deleted', projectToDelete.isEvent ? 'Event removed.' : 'Project removed.');
        }
      } catch (error) {
        // On error, reload to restore correct state
        await loadProjects();
        const errorMsg = getRequestErrorMessage(error, `Failed to delete ${selectedRecordType.toLowerCase()}.`);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(`${getRequestErrorTitle(error)}\n\n${errorMsg}`);
        } else {
          Alert.alert(getRequestErrorTitle(error), errorMsg);
        }
      } finally {
        setActionLoadingKey(null);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Delete "${projectToDelete.title}"? This will remove its related join records, applications, and logs.`)) {
        void doDelete();
      }
      return;
    }

    Alert.alert(
      `Delete ${selectedRecordType}`,
      `Delete ${projectToDelete.title}? This will remove its related join records, applications, and logs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void doDelete(),
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

    setActionLoadingKey('saveStatusUpdate');
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
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleReviewPartnerApplication = async (
    applicationId: string,
    nextStatus: 'Approved' | 'Rejected'
  ) => {
    if (!isAdmin || !user?.id) return;

    setActionLoadingKey(`reviewProposal-${applicationId}`);
    const previousApplications = allPartnerApplications;
    const now = new Date().toISOString();
    setAllPartnerApplications(currentApplications =>
      currentApplications.map(application =>
        application.id === applicationId
          ? {
            ...application,
            status: nextStatus,
            reviewedAt: now,
            reviewedBy: user.id,
          }
          : application
      )
    );
    showTaskSaveNotice(
      `Project proposal ${nextStatus === 'Approved' ? 'approved' : 'rejected'}.`,
      1200
    );

    try {
      await reviewPartnerProjectApplication(applicationId, nextStatus, user.id);
      void loadAllPartnerApplications();
      void loadProjects();
      closeProgramProposalModal();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`Proposal Reviewed\n\nProject proposal ${nextStatus === 'Approved' ? 'approved' : 'rejected'}.`);
      } else {
        Alert.alert('Proposal Reviewed', `Project proposal ${nextStatus === 'Approved' ? 'approved' : 'rejected'}.`);
      }
    } catch (error) {
      setAllPartnerApplications(previousApplications);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review partner application.')
      );
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleReviewPartnerReport = async (reportId: string) => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    setActionLoadingKey(`reviewReport-${reportId}`);
    const previousReports = partnerReports;
    const now = new Date().toISOString();
    setPartnerReports(currentReports =>
      currentReports.map(report =>
        report.id === reportId
          ? {
            ...report,
            status: 'Reviewed',
            reviewedAt: now,
            reviewedBy: user.id,
          }
          : report
      )
    );
    showTaskSaveNotice('Partner report marked as reviewed.', 1200);

    try {
      await reviewPartnerReport(reportId, user.id);
      void loadPartnerReportsForProject(selectedProject.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Report Reviewed\n\nPartner report marked as reviewed.');
      } else {
        Alert.alert('Report Reviewed', 'Partner report marked as reviewed.');
      }
    } catch (error) {
      setPartnerReports(previousReports);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review the partner report.')
      );
    } finally {
      setActionLoadingKey(null);
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
          ? `${updatedProject.isEvent ? 'Event' : 'Project'} picture removed.`
          : `${updatedProject.isEvent ? 'Event' : 'Project'} picture updated.`
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

    const previousJoinRecords = volunteerJoinRecords;
    const previousVolunteerMatches = volunteerMatches;
    const previousAllVolunteerMatches = allVolunteerMatches;
    const now = new Date().toISOString();
    setVolunteerJoinRecords(currentRecords =>
      currentRecords.map(record =>
        record.projectId === selectedProject.id && record.volunteerId === volunteerId
          ? {
            ...record,
            participationStatus: 'Completed',
            completedAt: now,
            completedBy: user.id,
          }
          : record
      )
    );
    setVolunteerMatches(currentMatches =>
      currentMatches.map(match =>
        match.projectId === selectedProject.id && match.volunteerId === volunteerId
          ? { ...match, status: 'Completed' }
          : match
      )
    );
    setAllVolunteerMatches(currentMatches =>
      currentMatches.map(match =>
        match.projectId === selectedProject.id && match.volunteerId === volunteerId
          ? { ...match, status: 'Completed' }
          : match
      )
    );
    showTaskSaveNotice('Volunteer marked as completed for this program.', 1200);

    try {
      await completeVolunteerProjectParticipation(selectedProject.id, volunteerId, user.id);
      void loadVolunteerJoinsForProject(selectedProject.id);
      void loadVolunteers();
      void loadVolunteerMatchesForProject(selectedProject.id);
      void loadAllVolunteerMatches();
    } catch (error) {
      setVolunteerJoinRecords(previousJoinRecords);
      setVolunteerMatches(previousVolunteerMatches);
      setAllVolunteerMatches(previousAllVolunteerMatches);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to complete volunteer participation.')
      );
    }
  };

  const handleReviewVolunteerRequest = async (
    requestEntry: ProjectVolunteerRequestEntry,
    nextStatus: 'Matched' | 'Rejected'
  ) => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    setActionLoadingKey(`reviewMatch-${requestEntry.id}`);
    const previousVolunteerMatches = volunteerMatches;
    const previousAllVolunteerMatches = allVolunteerMatches;
    const previousJoinRecords = volunteerJoinRecords;
    const now = new Date().toISOString();
    const optimisticMatchUpdater = (match: VolunteerProjectMatch) =>
      match.id === requestEntry.id
        ? {
          ...match,
          status: nextStatus,
          reviewedAt: now,
          reviewedBy: user.id,
        }
        : match;
    setVolunteerMatches(currentMatches => currentMatches.map(optimisticMatchUpdater));
    setAllVolunteerMatches(currentMatches => currentMatches.map(optimisticMatchUpdater));

    if (nextStatus === 'Matched') {
      const optimisticJoinRecord: VolunteerProjectJoinRecord = {
        id: `volunteer-join-${selectedProject.id}-${requestEntry.volunteerId}`,
        projectId: selectedProject.id,
        volunteerId: requestEntry.volunteerId,
        volunteerUserId: requestEntry.volunteerUserId,
        volunteerName: requestEntry.volunteerName,
        volunteerEmail: requestEntry.volunteerEmail,
        joinedAt: now,
        source: 'AdminMatch',
        participationStatus: 'Active',
      };

      setVolunteerJoinRecords(currentRecords => {
        const existingIndex = currentRecords.findIndex(
          record =>
            record.projectId === selectedProject.id &&
            record.volunteerId === requestEntry.volunteerId
        );
        if (existingIndex >= 0) {
          const nextRecords = [...currentRecords];
          nextRecords[existingIndex] = {
            ...nextRecords[existingIndex],
            volunteerUserId: optimisticJoinRecord.volunteerUserId,
            volunteerName: optimisticJoinRecord.volunteerName,
            volunteerEmail: optimisticJoinRecord.volunteerEmail,
            source: optimisticJoinRecord.source,
            participationStatus: nextRecords[existingIndex].participationStatus || 'Active',
          };
          return nextRecords;
        }

        return [...currentRecords, optimisticJoinRecord];
      });
    }

    showTaskSaveNotice(
      nextStatus === 'Matched'
        ? 'Volunteer approved and notified.'
        : 'Volunteer request rejected and volunteer notified.',
      1200
    );

    try {
      await reviewVolunteerProjectMatch(requestEntry.id, nextStatus, user.id);
      void loadAllVolunteerMatches();
      void loadVolunteerMatchesForProject(selectedProject.id);
      void loadVolunteerJoinsForProject(selectedProject.id);
      void loadVolunteers();
      void loadProjects();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(
          `Request Reviewed\n\n${
            nextStatus === 'Matched'
              ? 'Volunteer approved and notified.'
              : 'Volunteer request rejected and volunteer notified.'
          }`
        );
      } else {
        Alert.alert(
          'Request Reviewed',
          nextStatus === 'Matched'
            ? 'Volunteer approved and notified.'
            : 'Volunteer request rejected and volunteer notified.'
        );
      }
    } catch (error) {
      setVolunteerMatches(previousVolunteerMatches);
      setAllVolunteerMatches(previousAllVolunteerMatches);
      setVolunteerJoinRecords(previousJoinRecords);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review volunteer request.')
      );
    } finally {
      setActionLoadingKey(null);
    }
  };

  const confirmReviewVolunteerRequest = (
    requestEntry: ProjectVolunteerRequestEntry,
    nextStatus: 'Matched' | 'Rejected'
  ) => {
    void handleReviewVolunteerRequest(requestEntry, nextStatus);
  };

  const handleDeleteProjectFromCard = (project: Project) => {
    if (project.isEvent) {
      handleDeleteEventRecord(project);
      return;
    }

    const doDelete = async () => {
      const previousProjects = projects;
      try {
        setProjects(currentProjects => currentProjects.filter(item => item.id !== project.id));
        await deleteProjectLikeRecord(project);
        if (selectedProject?.id === project.id) {
          handleReturnToProjectList();
          setStatusUpdates([]);
          setAllPartnerApplications([]);
          setPartnerReports([]);
          setVolunteerJoinRecords([]);
        }
        await loadProjects();
        Alert.alert('Deleted', project.isEvent ? 'Event removed.' : 'Project removed.');
      } catch (error) {
        setProjects(previousProjects);
        await loadProjects();
        Alert.alert(
          getRequestErrorTitle(error),
          getRequestErrorMessage(error, 'Failed to delete project.')
        );
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Delete "${project.title}"? This cannot be undone.`)) {
        void doDelete();
      }
      return;
    }

    Alert.alert(
      'Delete Project',
      `Delete "${project.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
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
    const projectJoinRecords = volunteerJoinRecords.filter(record => record.projectId === project.id);
    const joinRecordByVolunteerId = new Map(
      projectJoinRecords.map(record => [record.volunteerId, record])
    );
    const matchedVolunteerIds = volunteerMatches
      .filter(match => match.projectId === project.id && match.status === 'Matched')
      .map(match => match.volunteerId);
    const volunteerIds = Array.from(
      new Set([
        ...project.volunteers,
        ...projectJoinRecords.map(record => record.volunteerId),
        ...matchedVolunteerIds,
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
  const getProjectVolunteerRequestEntries = (projectId: string) => {
    const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));

    return volunteerMatches
      .filter(match => match.projectId === projectId && match.status === 'Requested')
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
    const normalizedAssignedVolunteerIds = Array.from(
      new Set(taskDraft.assignedVolunteerIds.map(id => id.trim()).filter(Boolean))
    );
    const assignedVolunteers = normalizedAssignedVolunteerIds
      .map(volunteerId => assignableVolunteers.find(volunteer => volunteer.id === volunteerId) || null)
      .filter((volunteer): volunteer is (typeof assignableVolunteers)[number] => volunteer !== null);
    if (
      normalizedAssignedVolunteerIds.length > 0 &&
      assignedVolunteers.length !== normalizedAssignedVolunteerIds.length
    ) {
      Alert.alert(
        'Validation Error',
        'All assigned volunteers must already be joined to this project before they can be assigned a task.'
      );
      return;
    }
    const now = new Date().toISOString();
    const taskStatus =
      normalizedAssignedVolunteerIds.length > 0 && taskDraft.status === 'Unassigned'
        ? 'Assigned'
        : taskDraft.status;
    const normalizedSkills = Array.from(
      new Set(taskDraft.skillsNeeded.map(skill => skill.trim()).filter(Boolean))
    );

    if (normalizedSkills.length === 0) {
      Alert.alert('Validation Error', 'Select at least one skill for this task.');
      return;
    }

    const previousTask = editingTaskId
      ? (Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : []).find(task => task.id === editingTaskId) || null
      : null;
    const previousAssignedVolunteerIds = previousTask ? getTaskAssignedVolunteerIds(previousTask) : [];
    const addedVolunteerIds = normalizedAssignedVolunteerIds.filter(
      volunteerId => !previousAssignedVolunteerIds.includes(volunteerId)
    );
    const removedVolunteerIds = previousAssignedVolunteerIds.filter(
      volunteerId => !normalizedAssignedVolunteerIds.includes(volunteerId)
    );
    const notificationAssignedVolunteers = addedVolunteerIds
      .map(volunteerId => volunteers.find(volunteer => volunteer.id === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null);
    const notificationPreviousVolunteers = removedVolunteerIds
      .map(volunteerId => volunteers.find(volunteer => volunteer.id === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null);
    const shouldNotifyAssignedVolunteer =
      notificationAssignedVolunteers.length > 0 ||
      Boolean(
        previousTask &&
        (
          previousTask.title !== taskDraft.title.trim() ||
          previousTask.description !== taskDraft.description.trim() ||
          previousTask.category !== taskDraft.category.trim() ||
          previousTask.priority !== taskDraft.priority ||
          previousTask.status !== taskStatus ||
          previousTask.isFieldOfficer !== taskDraft.isFieldOfficer ||
          (previousTask.skillsNeeded || []).join('|') !== normalizedSkills.join('|')
        )
      );

    const nextTask: ProjectInternalTask = {
      id: editingTaskId || `${currentSelectedProject.id}-task-${Date.now()}`,
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      category: taskDraft.category.trim(),
      priority: taskDraft.priority,
      status: taskStatus,
      assignedVolunteerId: normalizedAssignedVolunteerIds[0] || undefined,
      assignedVolunteerName: assignedVolunteers[0]?.name,
      assignedVolunteerIds: normalizedAssignedVolunteerIds.length ? normalizedAssignedVolunteerIds : undefined,
      assignedVolunteerNames: assignedVolunteers.length ? assignedVolunteers.map(volunteer => volunteer.name) : undefined,
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
      clearStorageCache(['projects', 'events']);
      const notificationTasks: Promise<void>[] = [];
      for (const previousVolunteer of notificationPreviousVolunteers) {
        if (previousTask) {
          notificationTasks.push(notifyVolunteerAboutTaskUnassignment({
            event: currentSelectedProject,
            task: previousTask,
            volunteer: previousVolunteer,
            actorUserId: user?.id,
          }));
        }
      }
      for (const assignedVolunteer of notificationAssignedVolunteers) {
        notificationTasks.push(notifyVolunteerAboutTaskUpdate({
          event: updatedProject,
          task: nextTask,
          volunteer: assignedVolunteer,
          actorUserId: user?.id,
          action: 'assigned',
        }));
      }
      if (notificationTasks.length > 0) {
        await Promise.all(notificationTasks);
      }
      await loadProjects();
      setProjects(currentProjects =>
        currentProjects.map(project =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );
      setSelectedProject(updatedProject);
      setIsTaskSaveSuccess(true);
      setTaskSaveSuccessMessage(
        editingTaskId
          ? 'Event task update complete. Assignment changes were saved and volunteer notifications were sent when needed.'
          : 'Event task added. Assignment changes were saved and volunteer notifications were sent when needed.'
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

    const confirmDelete = () => {
      const executeDelete = async () => {
        const updatedProject: Project = {
          ...currentSelectedProject,
          internalTasks: (Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : []).filter(task => task.id !== taskId),
          updatedAt: new Date().toISOString(),
        };

        try {
          await saveProjectLikeRecord(updatedProject);
          clearStorageCache(['projects', 'events']);
          setProjects(currentProjects =>
            currentProjects.map(project =>
              project.id === updatedProject.id ? updatedProject : project
            )
          );
          setSelectedProject(updatedProject);
          if (editingTaskId === taskId) {
            closeTaskModal();
          }
          
          if (Platform.OS === 'web') {
            window.alert('Task deleted successfully');
          } else {
            Alert.alert('Deleted', 'Internal task removed.');
          }
        } catch (error) {
          if (Platform.OS === 'web') {
            window.alert(getRequestErrorMessage(error, 'Failed to delete the internal task.'));
          } else {
            Alert.alert(
              getRequestErrorTitle(error),
              getRequestErrorMessage(error, 'Failed to delete the internal task.')
            );
          }
        }
      };
      
      executeDelete();
    };

    // Platform-specific confirmation
    if (Platform.OS === 'web') {
      if (window.confirm('Remove this internal task from the project?')) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'Delete Task',
        'Remove this internal task from the project?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: confirmDelete,
          },
        ]
      );
    }
  };

  // Renders one project card in the lifecycle list.
  const renderProjectCard = (project: Project) => {
    const pendingRequestCount = pendingVolunteerRequestCountByProjectId.get(project.id) || 0;
    const projectImageSource = getPrimaryProjectImageSource(project);
    const projectCategoryLabel = `${project.isEvent ? 'Event' : 'Project'} | ${project.programModule || project.category}`;
    const projectDateLabel = `${format(new Date(project.startDate), 'EEE, dd MMM yyyy')} - ${format(
      new Date(project.endDate),
      'EEE, dd MMM yyyy'
    )}`;
    
    const projectAuthor = partnerApplicationByProjectId.get(project.id);
    const projectStatus = getProjectDisplayStatus(project);
    const isEnded = projectStatus === 'Completed' || projectStatus === 'Cancelled';

    return (
      <View
        key={project.id}
        style={[
          styles.card, 
          isDesktop ? styles.cardDesktop : styles.cardMobile,
          isEnded && styles.cardEnded
        ]}
      >
        <TouchableOpacity onPress={() => handleSelectProject(project)} activeOpacity={0.9}>
          {projectImageSource ? (
            <Image
              source={projectImageSource}
              style={[styles.cardImage, isEnded && styles.cardImageEnded]}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.cardImage, isEnded && styles.cardImageEnded]} />
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
              {projectAuthor ? (
                <View style={styles.infoRow}>
                  <View style={styles.infoRowLeading}>
                    <View style={styles.infoIconWrap}>
                      <MaterialIcons name="person" size={16} color="#475569" />
                    </View>
                    <View style={styles.infoRowCopy}>
                      <Text style={styles.infoRowTitle}>Submitted by {projectAuthor.partnerName}</Text>
                      {projectAuthor.partnerEmail ? (
                        <Text style={styles.infoRowSubtitle}>{projectAuthor.partnerEmail}</Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : null}
              <Text style={styles.description}>
                {project.description}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

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
    const sectionProjects = statusFilter
      ? section.projects.filter(project => getProjectDisplayStatus(project) === statusFilter)
      : section.projects;

    // When a status filter is active and this section has no matching projects, hide it
    if (statusFilter && sectionProjects.length === 0) {
      return null;
    }

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
          <View style={[styles.programSuiteProjectsBlock, styles.programProjectBox, { borderColor: section.border }]}>
            {/* Section header with Create Project button */}
            <View style={[styles.programSuiteProjectsHeader, { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }]}>
              <View style={styles.eventProjectBoxHeaderCopy}>
                <View style={[styles.eventProjectBoxIcon, { backgroundColor: section.surface, borderColor: section.border }]}>
                  <MaterialIcons name={section.icon} size={20} color={section.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.programSuiteProjectsTitle}>{section.title} Projects</Text>
                  {section.context ? (
                    <Text style={[styles.programSuiteProjectsMeta, { marginBottom: 4 }]}>
                      {section.context}
                    </Text>
                  ) : null}
                  <Text style={styles.programSuiteProjectsMeta}>
                    {sectionProjects.length} project{sectionProjects.length === 1 ? '' : 's'} in this program.
                  </Text>
                </View>
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

            <View style={[styles.eventProjectDivider, { backgroundColor: section.border }]} />

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
                <View style={styles.projectBoxGrid}>
                  {sectionProjects.map(project => {
                    const projectStatus = getProjectDisplayStatus(project);
                    const isEnded = projectStatus === 'Completed' || projectStatus === 'Cancelled';
                    
                    return (
                    <TouchableOpacity
                      key={project.id}
                      style={[styles.projectBox, isEnded && styles.projectBoxEnded]}
                      onPress={() => {
                        void handleSelectProject(project);
                      }}
                      activeOpacity={0.86}
                    >
                      <View style={styles.eventBoxTopRow}>
                        <View style={[styles.eventBoxIcon, { backgroundColor: section.surface }]}>
                          <MaterialIcons name="folder" size={18} color={section.accent} />
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.eventBoxStatusPill,
                            { backgroundColor: getProjectStatusColor(project) },
                          ]}
                          onPress={() => {
                            void handleSelectProject(project);
                          }}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.eventBoxStatusPillText}>
                            {getProjectDisplayStatus(project)}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.eventBoxTitle} numberOfLines={2}>
                        {project.title}
                      </Text>
                      <Text style={styles.eventBoxDate} numberOfLines={2}>
                        {formatCalendarItemDateRange(project.startDate, project.endDate)}
                      </Text>
                      <Text style={styles.eventBoxMeta} numberOfLines={1}>
                        {(project.volunteers || []).length}/{project.volunteersNeeded} volunteers
                      </Text>

                      {isAdmin && getProjectDisplayStatus(project) !== 'Completed' && getProjectDisplayStatus(project) !== 'Cancelled' && (
                        <View style={styles.eventBoxActions} pointerEvents="box-none">
                          <Pressable
                            style={styles.eventBoxActionButton}
                            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                            onPressIn={event => {
                              (event as any)?.stopPropagation?.();
                              (event as any)?.nativeEvent?.stopPropagation?.();
                            }}
                            onPress={event => {
                              (event as any)?.stopPropagation?.();
                              (event as any)?.nativeEvent?.stopPropagation?.();
                              openEditProjectModal(project);
                            }}
                          >
                            <MaterialIcons name="edit" size={16} color="#6366f1" />
                          </Pressable>
                          <Pressable
                            style={styles.eventBoxActionButton}
                            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                            onPressIn={event => {
                              (event as any)?.stopPropagation?.();
                              (event as any)?.nativeEvent?.stopPropagation?.();
                            }}
                            onPress={event => {
                              (event as any)?.stopPropagation?.();
                              (event as any)?.nativeEvent?.stopPropagation?.();
                              handleDeleteProjectFromCard(project);
                            }}
                          >
                            <MaterialIcons name="delete" size={16} color="#ef4444" />
                          </Pressable>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                  })}
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

  const renderEventProjectSection = (
    section: (typeof eventProjectSections)[number]
  ) => {
    const { project, programTitle } = section;
    // Apply status filter to events
    const events = statusFilter
      ? section.events.filter(event => getProjectDisplayStatus(event) === statusFilter)
      : section.events;

    // Hide section entirely when filter is active and no events match
    if (statusFilter && events.length === 0) {
      return null;
    }

    return (
      <View key={`events-${project.id}`} style={[styles.programSuiteProjectsBlock, styles.eventProjectBox]}>
        <View style={[styles.programSuiteProjectsHeader, { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }]}>
          <View style={styles.eventProjectBoxHeaderCopy}>
            <View style={styles.eventProjectBoxIcon}>
              <MaterialIcons name="folder" size={20} color="#166534" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.programSuiteProjectsTitle}>{project.title}</Text>
              <Text style={styles.programSuiteProjectsMeta}>
                {programTitle} project | {events.length} event{events.length === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          {isAdmin && (
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: '#0f766e',
                borderRadius: 8,
                paddingVertical: 8,
                paddingHorizontal: 14,
                marginLeft: 12,
              }}
              onPress={() => openCreateEventModal(project)}
              activeOpacity={0.82}
            >
              <MaterialIcons name="add" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Create Event</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.eventProjectDivider} />

        {events.length ? (
          <View style={styles.eventBoxGrid}>
            {events.map(event => {
              const eventStatus = getProjectDisplayStatus(event);
              const isEnded = eventStatus === 'Completed' || eventStatus === 'Cancelled';
              
              return (
              <TouchableOpacity
                key={event.id}
                style={[styles.eventBox, isEnded && styles.eventBoxEnded]}
                onPress={() => {
                  void handleSelectProject(event);
                }}
                activeOpacity={0.86}
              >
                <View style={styles.eventBoxTopRow}>
                  <View style={styles.eventBoxIcon}>
                    <MaterialIcons name="event" size={18} color="#0f766e" />
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.eventBoxStatusPill,
                      { backgroundColor: getProjectStatusColor(event) },
                    ]}
                    onPress={() => {
                      void handleSelectProject(event);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.eventBoxStatusPillText}>
                      {getProjectDisplayStatus(event)}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.eventBoxTitle} numberOfLines={2}>
                  {event.title}
                </Text>
                <Text style={styles.eventBoxDate} numberOfLines={2}>
                  {formatCalendarItemDateRange(event.startDate, event.endDate)}
                </Text>
                <Text style={styles.eventBoxMeta} numberOfLines={1}>
                  {event.volunteers.length}/{event.volunteersNeeded} volunteers
                </Text>

                {isAdmin && getProjectDisplayStatus(event) !== 'Completed' && getProjectDisplayStatus(event) !== 'Cancelled' && (
                  <View style={styles.eventBoxActions} pointerEvents="box-none">
                    <Pressable
                      style={styles.eventBoxActionButton}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      onPressIn={eventPress => {
                        (eventPress as any)?.stopPropagation?.();
                        (eventPress as any)?.nativeEvent?.stopPropagation?.();
                      }}
                      onPress={eventPress => {
                        (eventPress as any)?.stopPropagation?.();
                        (eventPress as any)?.nativeEvent?.stopPropagation?.();
                        openEditProjectModal(event);
                      }}
                    >
                      <MaterialIcons name="edit" size={16} color="#6366f1" />
                    </Pressable>
                    <Pressable
                      style={styles.eventBoxActionButton}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      onPressIn={eventPress => {
                        (eventPress as any)?.stopPropagation?.();
                        (eventPress as any)?.nativeEvent?.stopPropagation?.();
                      }}
                      onPress={eventPress => {
                        (eventPress as any)?.stopPropagation?.();
                        (eventPress as any)?.nativeEvent?.stopPropagation?.();
                        handleDeleteProjectFromCard(event);
                      }}
                    >
                      <MaterialIcons name="delete" size={16} color="#ef4444" />
                    </Pressable>
                  </View>
                )}
              </TouchableOpacity>
            );
            })}
          </View>
        ) : (
          <View style={[styles.programSuiteEmptyState, { paddingBottom: 8 }]}>
            <MaterialIcons name="event-busy" size={28} color="#94a3b8" />
            <Text style={styles.programSuiteEmptyTitle}>No events yet</Text>
            <Text style={styles.programSuiteProjectsMeta}>
              Create an event here and it will be attached to this project.
            </Text>
            {isAdmin && (
              <TouchableOpacity
                style={{
                  marginTop: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: '#0f766e',
                  borderRadius: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 24,
                }}
                onPress={() => openCreateEventModal(project)}
                activeOpacity={0.82}
              >
                <MaterialIcons name="add-circle-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Create First Event</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
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
                placeholder="e.g. Community Health Outreach"
                value={programDraft.title}
                onChangeText={v => setProgramDraft(d => ({ ...d, title: v }))}
                autoFocus={!editingProgramId}
              />

              {/* Description */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Description</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 14, color: '#1e293b', marginBottom: 16, minHeight: 72, textAlignVertical: 'top' }}
                placeholder="e.g. Health missions, wellness drives, and barangay-based care projects."
                value={programDraft.description}
                onChangeText={v => setProgramDraft(d => ({ ...d, description: v }))}
                multiline
              />

              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Program Context</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, fontSize: 14, color: '#1e293b', marginBottom: 16 }}
                placeholder="e.g. Low-income families in coastal barangays"
                value={programDraft.context}
                onChangeText={v => setProgramDraft(d => ({ ...d, context: v }))}
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

  const renderProjectEditorModal = () => {
    const isWeb = getPlatformOS() === 'web';
    const eventDateMin = projectDraft.isEvent && projectDraftParentProject
      ? getDateOnlyBoundary(projectDraftParentProject.startDate)
      : undefined;
    const eventDateMax = projectDraft.isEvent && projectDraftParentProject
      ? getDateOnlyBoundary(projectDraftParentProject.endDate, true)
      : undefined;

    const formContent = (
      <View style={styles.modalContainer}>
        {isProjectSaveSuccess ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#fff', width: '100%', maxWidth: 520, borderRadius: 18, padding: 32, alignItems: 'center' }}>
              <MaterialIcons name="check-circle" size={84} color="#10b981" />
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#1e293b', marginTop: 18, textAlign: 'center' }}>
                {editingProjectId
                  ? projectDraft.isEvent
                    ? 'Event Edit Completed'
                    : 'Project Edit Completed'
                  : projectDraft.isEvent
                    ? 'Event Created'
                    : 'Project Created'}
              </Text>
              <Text style={{ fontSize: 14, color: '#64748b', marginTop: 10, textAlign: 'center', lineHeight: 20 }}>
                {editingProjectId
                  ? projectDraft.isEvent
                    ? 'The event details edit was done and completed successfully.'
                    : 'The project details edit was done and completed successfully.'
                  : projectDraft.isEvent
                    ? 'The event was created and saved successfully.'
                    : 'The project was created and saved successfully.'}
              </Text>
              <TouchableOpacity
                style={{ marginTop: 24, backgroundColor: '#166534', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 34 }}
                onPress={() => {
                  setIsProjectSaveSuccess(false);
                  handleReturnToProjectList();
                  closeProjectModal();
                }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '900' }}>OK</Text>
              </TouchableOpacity>
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
              <TouchableOpacity 
                onPress={handleSaveProjectRecord}
                disabled={actionLoadingKey === 'saveProjectRecord'}
              >
                {actionLoadingKey === 'saveProjectRecord' ? (
                  <ActivityIndicator size="small" color="#15803d" />
                ) : (
                  <Text style={styles.projectModalSave}>Save</Text>
                )}
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
                setSelectedDate(
                  clampDateToBounds(
                    projectDraft.startDate ? new Date(projectDraft.startDate) : new Date(),
                    eventDateMin,
                    eventDateMax
                  )
                );
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
                setSelectedDate(
                  clampDateToBounds(
                    projectDraft.endDate ? new Date(projectDraft.endDate) : new Date(),
                    eventDateMin,
                    eventDateMax
                  )
                );
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
                <Text style={styles.helperPanelTitle}>Event dates follow the parent project window</Text>
                <Text style={styles.helperPanelText}>
                  Parent project window: {projectDraftParentProject.startDate.slice(0, 10)} to{' '}
                  {projectDraftParentProject.endDate.slice(0, 10)}. Select event dates only within this range.
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

              {projectDraft.isEvent ? (
                <>
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

                  <Text style={styles.locationPickerLabel}>Specific Venue</Text>
                  <TextInput
                    style={styles.locationVenueInput}
                    placeholder="e.g. Barangay Hall, Community Gym, school name"
                    placeholderTextColor="#999"
                    value={projectDraft.locationVenue}
                    onChangeText={value => handleProjectDraftChange('locationVenue', value)}
                  />
                </>
              ) : null}

              <Text style={styles.locationPickerHelperText}>
                {projectDraft.address || (
                  projectDraft.isEvent
                    ? 'Choose region, city/municipality, and barangay to set the event place.'
                    : 'Choose region and city/municipality to set the place.'
                )}
              </Text>
            </View>
            <Text style={[styles.labelRight, styles.labelTop]}>Place</Text>
          </View>

          {/* Show Volunteer Slots field only for events, not projects */}
          {projectDraft.isEvent && (
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
          )}

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

          {!projectDraft.isEvent ? (
            <>


              <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
                <View style={[styles.statusOptionsCard, styles.inputWithLabel]}>
                  <Text style={styles.helperPanelTitle}>Document Attachment</Text>
                  <Text style={styles.helperPanelText}>
                    Keep the project document aligned with the approved proposal file.
                  </Text>
                  {projectDraft.attachmentUrl ? (
                    <View style={styles.projectDocumentCard}>
                      <View style={styles.projectDocumentMeta}>
                        <MaterialIcons name="description" size={20} color="#166534" />
                        <Text style={styles.projectDocumentName} numberOfLines={1}>
                          {projectDraft.attachmentUrl.split('/').pop() || 'Attached document'}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={handleRemoveProjectDocument}>
                        <Text style={styles.projectDocumentRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.projectDocumentButton} onPress={handlePickProjectDocument}>
                      <MaterialIcons name="attach-file" size={18} color="#166534" />
                      <Text style={styles.projectDocumentButtonText}>Upload Document</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={[styles.labelRight, styles.labelTop]}>Document</Text>
              </View>
            </>
          ) : null}

          <TouchableOpacity
            style={[
              styles.submitButton,
              actionLoadingKey === 'saveProjectRecord' && { opacity: 0.7 }
            ]}
            onPress={handleSaveProjectRecord}
            disabled={actionLoadingKey === 'saveProjectRecord'}
          >
            {actionLoadingKey === 'saveProjectRecord' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>
                {editingProjectId
                  ? projectDraft.isEvent
                    ? 'Update Event'
                    : 'Update Project'
                  : projectDraft.isEvent
                    ? 'Create Event'
                    : 'Create Project'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
          </>
        )}

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
            minDate={eventDateMin}
            maxDate={eventDateMax}
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
      </View>
    );

    if (!showProjectModal) return null;

    if (isWeb) {
      return (
        <View style={projectEditorStyles.webOverlay}>
          <TouchableOpacity style={projectEditorStyles.overlayDismiss} activeOpacity={1} onPress={closeProjectModal} />
          <View style={projectEditorStyles.drawer}>{formContent}</View>
        </View>
      );
    }

    return (
      <Modal visible animationType="slide" onRequestClose={closeProjectModal}>
        {formContent}
      </Modal>
    );
  };

  const renderProgramProposalModal = () => {
    const module = selectedProgramProposalModule;
    const pendingProposal =
      module && showProgramProposalModal
        ? allPartnerApplications.find(
            application =>
              application.status === 'Pending' &&
              getProgramModuleFromProposalProjectId(application.projectId) === module
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
                        style={[
                          styles.applicationButton, 
                          styles.approveButton,
                          actionLoadingKey === `reviewProposal-${pendingProposal.id}` && { opacity: 0.7 }
                        ]}
                        onPress={async () => {
                          await handleReviewPartnerApplication(pendingProposal.id, 'Approved');
                        }}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        {actionLoadingKey === `reviewProposal-${pendingProposal.id}` ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.applicationButtonText}>Approve</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.applicationButton, 
                          styles.rejectButton,
                          actionLoadingKey === `reviewProposal-${pendingProposal.id}` && { opacity: 0.7 }
                        ]}
                        onPress={async () => {
                          await handleReviewPartnerApplication(pendingProposal.id, 'Rejected');
                        }}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        {actionLoadingKey === `reviewProposal-${pendingProposal.id}` ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.applicationButtonText}>Reject</Text>
                        )}
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

  const renderProgramWebDetailsModal = () => {
    if (!selectedProgramWebSection) {
      return null;
    }

    const overview = getProgramWebOverview(selectedProgramWebSection);
    const linkedProjects = selectedProgramWebSection.projects;
    const linkedEvents = selectedProgramWebSection.events;
    const linkedProjectIds = new Set([
      ...linkedProjects.map(project => project.id),
      ...linkedEvents.map(event => event.id),
    ]);
    const beneficiariesServed = allPartnerReports
      .filter(report => linkedProjectIds.has(report.projectId))
      .reduce((sum, report) => sum + getReportBeneficiariesServed(report), 0);
    const systemStats = [
      { value: String(linkedProjects.length), label: 'Projects', icon: 'folder' as const },
      { value: String(linkedEvents.length), label: 'Events', icon: 'event' as const },
      { value: String(selectedProgramWebSection.inProgressCount), label: 'Active', icon: 'trending-up' as const },
    ];
    const workflowSteps = [
      {
        title: 'Assess community need',
        description: 'Define the target beneficiaries, local partners, location, and service gap for this program.',
      },
      {
        title: 'Build the project plan',
        description: 'Create projects, schedule events, set volunteer roles, and prepare resources for field work.',
      },
      {
        title: 'Deliver and monitor',
        description: 'Track event participation, progress, attendance, reports, and completion evidence in the system.',
      },
    ];
    const accent = selectedProgramWebSection.accent;
    const surface = selectedProgramWebSection.surface;

    return (
      <Modal
        visible={Boolean(selectedProgramWebModule)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedProgramWebModule(null)}
      >
        <View style={[programWebStyles.backdrop, isDesktop && programWebStyles.backdropDesktop]}>
          <View style={programWebStyles.window}>

            {/* Browser chrome bar */}
            <View style={programWebStyles.browserBar}>
              <View style={programWebStyles.browserDots}>
                <TouchableOpacity
                  style={[programWebStyles.browserDot, { backgroundColor: '#ef4444' }]}
                  onPress={() => setSelectedProgramWebModule(null)}
                />
                <View style={[programWebStyles.browserDot, { backgroundColor: '#f59e0b' }]} />
                <View style={[programWebStyles.browserDot, { backgroundColor: '#22c55e' }]} />
              </View>
              <View style={programWebStyles.browserAddressBar}>
                <MaterialIcons name="lock" size={12} color="#64748b" />
                <Text style={programWebStyles.browserUrl} numberOfLines={1}>
                  nvcconnect.local/{selectedProgramWebSection.title.toLowerCase().replace(/\s+/g, '-')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedProgramWebModule(null)} style={programWebStyles.browserClose}>
                <MaterialIcons name="close" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Website content */}
            <ScrollView style={programWebStyles.pageScroll} showsVerticalScrollIndicator={false}>

              {/* Nav bar */}
              <View style={[programWebStyles.navbar, { backgroundColor: accent }]}>
                <View style={programWebStyles.navBrand}>
                  <View style={programWebStyles.navLogo}>
                    <MaterialIcons name={selectedProgramWebSection.icon} size={18} color={accent} />
                  </View>
                  <Text style={programWebStyles.navBrandText}>NVC</Text>
                  <Text style={programWebStyles.navBrandSep}>|</Text>
                  <Text style={programWebStyles.navBrandSub}>{selectedProgramWebSection.title}</Text>
                </View>
                <View style={programWebStyles.navLinks}>
                  {['Overview', 'Services', 'Workflow', 'Projects'].map(item => (
                    <Text key={item} style={programWebStyles.navLink}>{item}</Text>
                  ))}
                </View>
                <TouchableOpacity
                  style={programWebStyles.navCta}
                  onPress={() => {
                    setExpandedProgramModules(current => new Set(current).add(selectedProgramWebSection.module));
                    setSelectedProgramWebModule(null);
                    switchProgramSuiteView('projects');
                  }}
                >
                  <Text style={[programWebStyles.navCtaText, { color: accent }]}>View projects →</Text>
                </TouchableOpacity>
              </View>

              {/* Hero section */}
              <View style={[programWebStyles.hero, { backgroundColor: accent }]}>
                <View style={programWebStyles.heroContent}>
                  <Text style={programWebStyles.heroEyebrow}>Program Pillar</Text>
                  <Text style={programWebStyles.heroTitle}>{selectedProgramWebSection.title}</Text>
                  <Text style={programWebStyles.heroBody}>{overview.about}</Text>
                  <View style={programWebStyles.heroStats}>
                    {systemStats.map(stat => (
                      <View key={stat.label} style={programWebStyles.heroStat}>
                        <MaterialIcons name={stat.icon} size={16} color="rgba(255,255,255,0.8)" />
                        <Text style={programWebStyles.heroStatValue}>{stat.value}</Text>
                        <Text style={programWebStyles.heroStatLabel}>{stat.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={[programWebStyles.heroIconWrap, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                  <MaterialIcons name={selectedProgramWebSection.icon} size={64} color="rgba(255,255,255,0.9)" />
                </View>
              </View>

              {/* Workflow */}
              <View style={programWebStyles.section}>
                <Text style={programWebStyles.sectionEyebrow}>Delivery workflow</Text>
                <Text style={programWebStyles.sectionTitle}>How we plan and execute</Text>
                <View style={programWebStyles.workflowList}>
                  {workflowSteps.map((step, i) => (
                    <View key={step.title} style={programWebStyles.workflowRow}>
                      <View style={[programWebStyles.workflowNum, { backgroundColor: accent }]}>
                        <Text style={programWebStyles.workflowNumText}>{i + 1}</Text>
                      </View>
                      <View style={programWebStyles.workflowCopy}>
                        <Text style={programWebStyles.workflowTitle}>{step.title}</Text>
                        <Text style={programWebStyles.workflowText}>{step.description}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              {/* Impact stats */}
              <View style={[programWebStyles.section, { backgroundColor: accent }]}>
                <Text style={[programWebStyles.sectionEyebrow, { color: 'rgba(255,255,255,0.75)' }]}>Impact and activity</Text>
                <Text style={[programWebStyles.sectionTitle, { color: '#ffffff' }]}>Numbers from the system</Text>
                <View style={programWebStyles.impactGrid}>
                  {[
                    { value: formatImpactCount(beneficiariesServed), label: 'Beneficiaries served' },
                    { value: String(linkedProjects.length), label: 'Projects in system' },
                    { value: String(linkedEvents.length), label: 'Events in system' },
                    { value: String(selectedProgramWebSection.inProgressCount), label: 'Active projects' },
                  ].map(stat => (
                    <View key={stat.label} style={programWebStyles.impactCard}>
                      <Text style={[programWebStyles.impactValue, { color: accent }]}>{stat.value}</Text>
                      <Text style={programWebStyles.impactLabel}>{stat.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Projects list */}
              <View style={programWebStyles.section}>
                <Text style={programWebStyles.sectionEyebrow}>System projects</Text>
                <Text style={programWebStyles.sectionTitle}>Active and planned projects</Text>
                {linkedProjects.length ? (
                  linkedProjects.map(project => (
                    <View key={project.id} style={programWebStyles.projectRow}>
                      <View style={[programWebStyles.projectRowIcon, { backgroundColor: surface }]}>
                        <MaterialIcons name="folder" size={18} color={accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={programWebStyles.projectRowTitle}>{project.title}</Text>
                        <Text style={programWebStyles.projectRowMeta}>
                          {getProjectDisplayStatus(project)} · {formatProjectDateRangeLabel(project.startDate, project.endDate)}
                        </Text>
                      </View>
                      <View style={[programWebStyles.projectRowBadge, { backgroundColor: getProjectStatusColor(project) + '22' }]}>
                        <Text style={[programWebStyles.projectRowBadgeText, { color: getProjectStatusColor(project) }]}>
                          {getProjectDisplayStatus(project)}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={programWebStyles.emptyPanel}>
                    <MaterialIcons name="folder-open" size={28} color="#94a3b8" />
                    <Text style={programWebStyles.emptyTitle}>No projects yet</Text>
                    <Text style={programWebStyles.emptyText}>Create a project under this program to start tracking events, volunteers, and reports.</Text>
                  </View>
                )}
              </View>

              {/* Footer */}
              <View style={[programWebStyles.footer, { backgroundColor: accent }]}>
                <Text style={programWebStyles.footerText}>NVC · {selectedProgramWebSection.title} Program</Text>
                <View style={programWebStyles.footerActions}>
                  <TouchableOpacity
                    style={programWebStyles.footerSecondary}
                    onPress={() => setSelectedProgramWebModule(null)}
                  >
                    <Text style={programWebStyles.footerSecondaryText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[programWebStyles.footerPrimary, { backgroundColor: '#ffffff' }]}
                    onPress={() => {
                      setExpandedProgramModules(current => new Set(current).add(selectedProgramWebSection.module));
                      setSelectedProgramWebModule(null);
                      switchProgramSuiteView('projects');
                    }}
                  >
                    <Text style={[programWebStyles.footerPrimaryText, { color: accent }]}>View projects →</Text>
                  </TouchableOpacity>
                </View>
              </View>

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

  useEffect(() => {
    if (programSuiteView !== 'projects') {
      return;
    }

    setExpandedProgramModules(new Set(activeProgramTracks.map(track => String(track.id).trim())));
  }, [activeProgramTracks, programSuiteView]);

  const availableProgramCount = activeProgramTracks.length;

  const suiteScheduledProjects = useMemo(
    () =>
      projects
        .filter(project => {
          const module = getProgramSuiteModuleForProject(project, activeProgramTracks);
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
    [activeProgramTracks, projects, schedulerCalendarWindow.end, schedulerCalendarWindow.start]
  );

  const monthProjectCalendarProjects = useMemo(
    () =>
      [...projects].sort(
        (left, right) =>
          new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
          left.title.localeCompare(right.title)
      ).filter(isProgramSuiteProjectRecord),
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

  const schedulerEventsByDate = useMemo(() => {
    const nextEventsByDate = new Map<string, Project[]>();

    schedulerCalendarDays.forEach(day => {
      const dayEvents = projects.filter(project => {
        if (!project.isEvent) {
          return false;
        }

        const startDate = new Date(project.startDate);
        return isSameCalendarDay(day, startDate);
      });

      nextEventsByDate.set(getDateKey(day), dayEvents);
    });

    return nextEventsByDate;
  }, [projects, schedulerCalendarDays]);

  const schedulerFeaturedProjects = useMemo(
    () =>
      [...projects]
        .filter(isProgramSuiteProjectRecord)
        .sort(
          (left, right) =>
            new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
            left.title.localeCompare(right.title)
        ),
    [projects]
  );

  const schedulerFeaturedEvents = useMemo(
    () =>
      [...projects]
        .filter(project => project.isEvent)
        .sort(
          (left, right) =>
            new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
            left.title.localeCompare(right.title)
        ),
    [projects]
  );

  const partnerApplicationByProjectId = useMemo(() => {
    const map = new Map<string, PartnerProjectApplication>();
    allPartnerApplications.forEach(application => {
      const existing = map.get(application.projectId);
      if (
        !existing ||
        new Date(application.requestedAt).getTime() > new Date(existing.requestedAt).getTime()
      ) {
        map.set(application.projectId, application);
      }
    });
    return map;
  }, [allPartnerApplications]);

  const programSections = useMemo(
    () =>
      activeProgramTracks.map(track => {
        const module = String(track.id).trim();
        const pendingProposalApplication =
          allPartnerApplications.find(
            application =>
              application.status === 'Pending' &&
              getProgramModuleFromProposalProjectId(application.projectId) === module
          ) || null;
        const approvedProposalModules = new Set(
          allPartnerApplications
            .filter(application => application.status === 'Approved')
            .map(application =>
              String(
                application.proposalDetails?.requestedProgramModule ||
                getProgramModuleFromProposalProjectId(application.projectId) ||
                ''
              ).trim()
            )
            .filter(Boolean)
        );
        const sectionItems = projects
          .filter(project => {
            const applicationModule = getApplicationProgramModuleForProject(
              project,
              partnerApplicationByProjectId.get(project.id) ||
                findApprovedProposalApplicationForProject(project, allPartnerApplications),
              activeProgramTracks
            );
            const result = applicationModule || getProgramSuiteModuleForProject(project, activeProgramTracks);
            if (!result && projects.length < 20) {
              console.log(`[DEBUG] Project filtered out: ${project.title} (id=${project.id}) module=${getProjectProgramId(project)} looking for=${module}`);
            }
            return result === module;
          })
          .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());
        const sectionProjects = sectionItems.filter(project =>
          isProgramSuiteProjectRecord(project) ||
          isApprovedProposalLikeProject(project, module, activeProgramTracks, approvedProposalModules)
        );
        const sectionEvents = sectionItems.filter(project => project.isEvent);
        
        // Also include events from child projects (events where parentProjectId points to a project in this program)
        const sectionProjectIds = new Set(sectionProjects.map(p => p.id));
        const eventsFromChildProjects = projects.filter(
          project => project.isEvent && project.parentProjectId && sectionProjectIds.has(project.parentProjectId)
        );
        const allSectionEvents = [...sectionEvents, ...eventsFromChildProjects]
          .filter((event, index, array) => array.findIndex(e => e.id === event.id) === index) // Remove duplicates
          .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());


        return {
          module,
          title: track.title || module,
          description: track.description || '',
          context: track.context || '',
          icon: normalizeProgramTrackIcon(track.icon),
          accent: normalizeProgramTrackColor(track.color),
          surface: '#f5f3ff',
          border: '#ddd6fe',
          imageUrl: track.imageUrl,
          projects: sectionProjects,
          events: allSectionEvents,
          totalPrograms: sectionProjects.length,
          inProgressCount: sectionProjects.filter(project => getProjectDisplayStatus(project) === 'In Progress').length,
          planningCount: sectionProjects.filter(project => getProjectDisplayStatus(project) === 'Planning').length,
          completedCount: sectionProjects.filter(project => getProjectDisplayStatus(project) === 'Completed').length,
          cancelledCount: sectionProjects.filter(project => getProjectDisplayStatus(project) === 'Cancelled').length,
          eventCount: allSectionEvents.length,
          eventInProgressCount: allSectionEvents.filter(event => getProjectDisplayStatus(event) === 'In Progress').length,
          eventPlanningCount: allSectionEvents.filter(event => getProjectDisplayStatus(event) === 'Planning').length,
          eventCompletedCount: allSectionEvents.filter(event => getProjectDisplayStatus(event) === 'Completed').length,
          eventCancelledCount: allSectionEvents.filter(event => getProjectDisplayStatus(event) === 'Cancelled').length,
          pendingProposalCount: pendingProposalApplication ? 1 : 0,
        };
      }),
    [activeProgramTracks, allPartnerApplications, projects]
  );

  const selectedProgramWebSection = useMemo(
    () => programSections.find(section => section.module === selectedProgramWebModule) || null,
    [programSections, selectedProgramWebModule]
  );

  const eventProjectSections = useMemo(
    () =>
      projects
        .filter(isProgramSuiteProjectRecord)
        .sort((left, right) => {
          const leftProgram = getProgramSuiteModuleForProject(left, activeProgramTracks) || left.programModule || left.category || '';
          const rightProgram = getProgramSuiteModuleForProject(right, activeProgramTracks) || right.programModule || right.category || '';
          return (
            String(leftProgram).localeCompare(String(rightProgram)) ||
            left.title.localeCompare(right.title)
          );
        })
        .map(project => ({
          project,
          programTitle:
            activeProgramTracks.find(track => String(track.id).trim() === getProjectProgramId(project))?.title ||
            project.programModule ||
            project.category,
          events: projects
            .filter(event => event.isEvent && event.parentProjectId === project.id)
            .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime()),
        }))
        .filter(section => section.events.length > 0),
    [activeProgramTracks, projects]
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
  const isProjectReadOnly = activeSelectedProject 
    ? (getProjectDisplayStatus(activeSelectedProject) === 'Completed' || getProjectDisplayStatus(activeSelectedProject) === 'Cancelled')
    : false;

  if (activeSelectedProject) {
    const volunteerEntries = getProjectVolunteerEntries(activeSelectedProject);
    const assignableVolunteerOptions = getAssignableVolunteerOptions(activeSelectedProject);
    const volunteerRequestEntries = getProjectVolunteerRequestEntries(activeSelectedProject.id);
    const pendingVolunteerRequestEntries = volunteerRequestEntries.filter(
      requestEntry => requestEntry.status === 'Requested',
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
      })
      .sort(
        (left, right) =>
          new Date(right.attendanceConfirmedAt || right.timeOut || right.timeIn).getTime() -
          new Date(left.attendanceConfirmedAt || left.timeOut || left.timeIn).getTime()
      );
    const projectAttendanceDateKeys = getDateRangeKeys(
      activeSelectedProject.startDate,
      activeSelectedProject.endDate
    );
    const fallbackAttendanceDateKeys = Array.from(
      new Set(
        projectTimeLogEntries
          .map(log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn))
          .filter(Boolean)
      )
    ).sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
    const availableAttendanceDateKeys = projectAttendanceDateKeys.length
      ? projectAttendanceDateKeys
      : fallbackAttendanceDateKeys;
    const resolvedAttendanceDateKey =
      selectedAttendanceDateKey && availableAttendanceDateKeys.includes(selectedAttendanceDateKey)
        ? selectedAttendanceDateKey
        : availableAttendanceDateKeys.includes(getLocalDateKey(currentDate.toISOString()))
        ? getLocalDateKey(currentDate.toISOString())
        : availableAttendanceDateKeys[availableAttendanceDateKeys.length - 1] || getLocalDateKey(currentDate.toISOString());
    const projectVolunteerAttendanceCards: ProjectVolunteerAttendanceCard[] = volunteerEntries
      .map(volunteerEntry => {
        const volunteerLogs = projectTimeLogEntries.filter(log => log.volunteerId === volunteerEntry.id);
        const selectedDateLogs = volunteerLogs
          .filter(
            log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === resolvedAttendanceDateKey
          )
          .sort(
            (left, right) =>
              new Date(right.attendanceConfirmedAt || right.timeOut || right.timeIn).getTime() -
              new Date(left.attendanceConfirmedAt || left.timeOut || left.timeIn).getTime()
          );
        const latestLog = selectedDateLogs[0] || null;

        return {
          volunteerId: volunteerEntry.id,
          volunteerName: volunteerEntry.name || 'Volunteer',
          volunteerEmail: volunteerEntry.email || 'No email on file',
          logs: selectedDateLogs,
          timeInCount: selectedDateLogs.length,
          timeOutCount: selectedDateLogs.filter(
            log => Boolean((log.attendancePhoto || log.completionPhoto || '').trim())
          ).length,
          attendanceDays: latestLog ? 1 : 0,
          checkedAttendanceDays: selectedDateLogs.filter(log => Boolean(log.attendanceCheckedAt)).length,
          latestActivityLabel: latestLog
            ? `Confirmed ${format(new Date(latestLog.attendanceConfirmedAt || latestLog.timeIn), 'PPpp')}`
            : 'No attendance upload for this selected date yet.',
          activeLog: latestLog,
        };
      })
      .sort((left, right) => left.volunteerName.localeCompare(right.volunteerName));
    const selectedAttendanceCard = selectedAttendanceVolunteerId
      ? projectVolunteerAttendanceCards.find(card => card.volunteerId === selectedAttendanceVolunteerId) || null
      : null;
    const projectTimeInCount = projectTimeLogEntries.length;
    const projectTimeOutCount = projectTimeLogEntries.filter(
      log => Boolean((log.attendancePhoto || log.completionPhoto || '').trim())
    ).length;
    const projectCheckedAttendanceCount = projectTimeLogEntries.filter(log => Boolean(log.attendanceCheckedAt)).length;
    const selectedDateAttendanceEntries = projectVolunteerAttendanceCards.filter(card => card.timeInCount > 0);
    const selectedDateCheckedCount = projectVolunteerAttendanceCards.filter(
      card => card.checkedAttendanceDays > 0
    ).length;
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
    const detailEntityLabel = activeSelectedProject.isEvent ? 'Event' : 'Project';
    const detailWorkspaceLabel = activeSelectedProject.isEvent ? 'Event Workspace' : 'Project Workspace';
    const detailModuleLabel = activeSelectedProject.programModule || activeSelectedProject.category;
    const formattedStartDate = formatProjectDateLabel(activeSelectedProject.startDate);
    const formattedEndDate = formatProjectDateLabel(activeSelectedProject.endDate);
    const formattedScheduleRange = formatProjectDateRangeLabel(
      activeSelectedProject.startDate,
      activeSelectedProject.endDate
    );
    const volunteerSlotsFilled = volunteerEntries.length;
    const volunteerSlotsNeeded = activeSelectedProject.volunteersNeeded;
    const remainingVolunteerSlots = Math.max(volunteerSlotsNeeded - volunteerSlotsFilled, 0);
    const pendingVolunteerRequestCount = pendingVolunteerRequestEntries.length;
    const latestTimeActivityLabel = projectTimeLogEntries[0]
      ? `Confirmed ${format(new Date(projectTimeLogEntries[0].attendanceConfirmedAt || projectTimeLogEntries[0].timeIn), 'PPpp')}`
      : 'No attendance yet';
    const detailsDescription = activeSelectedProject.description?.trim()
      || (activeSelectedProject.isEvent
        ? 'This event is ready for staffing, scheduling, and day-of coordination.'
        : 'This program record keeps planning, staffing, and delivery details in one place.');
    const detailWorkspaceCaption = activeSelectedProject.isEvent
      ? 'Track staffing, schedule, and delivery activity from a single event workspace.'
      : 'Review program setup and delivery details in one place.';
    const linkedEvents = activeSelectedProject.isEvent
      ? []
      : projects
        .filter(entry => entry.isEvent && entry.parentProjectId === activeSelectedProject.id)
        .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());
    const heroHighlights = [
      {
        icon: 'calendar-month' as const,
        label: 'Schedule',
        value: formattedScheduleRange,
      },
      // Show volunteer coverage only for events, not projects
      ...(activeSelectedProject.isEvent
        ? [{
          icon: 'groups' as const,
          label: 'Confirmed Team',
          value: `${volunteerSlotsFilled}/${volunteerSlotsNeeded}`,
        }]
        : []),
      {
        icon: 'location-on' as const,
        label: 'Location',
        value: activeSelectedProject.location.address || 'Location not set',
      },
      ...(hasPartneredOrg
        ? [{
          icon: 'business' as const,
          label: 'Partner',
          value: selectedPartnerName,
        }]
        : []),
      ...(activeSelectedProject.isEvent
        ? [{
          icon: 'pending-actions' as const,
          label: 'Pending Requests',
          value: `${pendingVolunteerRequestCount}`,
        }]
        : []),
    ];
    const setupDetails = [
      ...(!activeSelectedProject.isEvent ? [{
        label: 'Program Module',
        value: detailModuleLabel,
        meta: 'Main advocacy area for planning and reporting.',
      }] : []),
      ...(hasPartneredOrg && !activeSelectedProject.isEvent
        ? [
          {
            label: 'Partnered Organization',
            value: selectedPartnerName,
            meta: 'Primary delivery partner for this work.',
          },
        ]
        : []),
    ];
    const eventOperationsDetails = activeSelectedProject.isEvent
      ? [
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
      ]
      : [];

    return (
      <View style={styles.screenShell}>
        {renderTaskSaveToast()}
        <ScrollView style={styles.container} contentContainerStyle={styles.detailsScreenContent}>
        <View style={styles.detailsHeaderBar}>
          <TouchableOpacity style={styles.detailsBackButton} onPress={handleReturnToProjectList}>
            <MaterialIcons name="arrow-back" size={18} color="#0f172a" />
            <Text style={styles.detailsBackButtonText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.detailsHeaderCopy}>
            <Text style={styles.detailsHeaderEyebrow}>{detailWorkspaceLabel}</Text>
            <Text style={styles.detailsHeaderTitle}>
              {activeSelectedProject.isEvent ? 'Event Details' : 'Project Details'}
            </Text>
            <Text style={styles.detailsHeaderMeta}>{detailWorkspaceCaption}</Text>
          </View>
          <View
            style={[
              styles.detailsHeaderStatusPill,
              { backgroundColor: getProjectStatusColor(activeSelectedProject) },
            ]}
          >
            <Text style={styles.detailsHeaderStatusText}>{getProjectDisplayStatus(activeSelectedProject)}</Text>
          </View>
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailsHero}>
            <View style={styles.detailsHeroHeader}>
              <View style={styles.detailsHeroCopy}>
                <Text style={styles.detailsEyebrow}>{detailWorkspaceLabel}</Text>
                <Text style={styles.detailsTitle}>{activeSelectedProject.title}</Text>
                <Text style={styles.detailsSubtitle}>{detailsDescription}</Text>
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

            <View style={styles.detailsHeroHighlights}>
              {heroHighlights.map(highlight => (
                <View key={highlight.label} style={styles.detailsHeroHighlight}>
                  <View style={styles.detailsHeroHighlightIcon}>
                    <MaterialIcons name={highlight.icon} size={18} color="#166534" />
                  </View>
                  <View style={styles.detailsHeroHighlightCopy}>
                    <Text style={styles.detailsHeroHighlightLabel}>{highlight.label}</Text>
                    <Text style={styles.detailsHeroHighlightValue} numberOfLines={2}>
                      {highlight.value}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={[styles.detailsMediaPanel, isDesktop && styles.detailsMediaPanelDesktop]}>
              <View
                style={[
                  styles.detailsMediaPreviewWrap,
                  isDesktop && styles.detailsMediaPreviewWrapDesktop,
                ]}
              >
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

              <View style={[styles.detailsMediaCopy, isDesktop && styles.detailsMediaCopyDesktop]}>
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

          </View>

          {activeSelectedProject.isEvent ? (
            <View style={[styles.detailsSection, styles.detailsSectionCard]}>
              <Text style={styles.sectionTitle}>Operations Snapshot</Text>
              <Text style={styles.sectionHint}>
                Review staffing, parent-program context, and readiness signals before event day.
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
                {actionLoadingKey === `deleteProject-${activeSelectedProject?.id}` ? (
                  <ActivityIndicator size="small" color="#b91c1c" />
                ) : (
                  <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                )}
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

          {!activeSelectedProject.isEvent && (
            <View style={[styles.detailsSection, styles.detailsSectionCard]}>
              <Text style={styles.sectionTitle}>Core Setup</Text>
              <Text style={styles.sectionHint}>The foundational record details your team refers to most often.</Text>
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
          )}

          {!activeSelectedProject.isEvent ? (
            <View style={[styles.detailsSection, styles.detailsSectionCard]}>
              <View style={styles.projectEventPanelHeader}>
                <View style={styles.projectEventPanelCopy}>
                  <Text style={styles.projectEventPanelTitle}>Events</Text>
                </View>
                {!isProjectReadOnly && (
                  <TouchableOpacity
                    style={styles.projectEventPanelButton}
                    onPress={() => openCreateEventModal(activeSelectedProject)}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="event" size={16} color="#0f766e" />
                    <Text style={styles.projectEventPanelButtonText}>Add Event</Text>
                  </TouchableOpacity>
                )}
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

          {!activeSelectedProject.isEvent && (
            <View style={[styles.detailsSection, styles.detailsSectionCard]}>
              <Text style={styles.sectionTitle}>Document Attachments</Text>
              <Text style={styles.sectionHint}>Proposal or supporting documents from partner organization.</Text>
              
              {(activeSelectedProject.attachments || []).filter(attachment => attachment.type === 'document').length === 0 ? (
                <View style={styles.projectEventEmptyState}>
                  <Text style={styles.projectEventEmptyTitle}>No attachments yet</Text>
                  <Text style={styles.projectEventEmptyMeta}>
                    Documents from partner proposals will appear here.
                  </Text>
                </View>
              ) : (
                <View style={styles.detailFieldGrid}>
                  {(activeSelectedProject.attachments || [])
                    .filter(attachment => attachment.type === 'document')
                    .map((attachment, index) => (
                      <View key={index} style={styles.detailField}>
                        <Text style={styles.detailFieldLabel}>Document {index + 1}</Text>
                        <Text style={styles.detailFieldValue}>
                          {attachment.url.split('/').pop() || 'Attached document'}
                        </Text>
                        <Text style={styles.detailFieldMeta}>From project proposal</Text>
                      </View>
                    ))}
                </View>
              )}
            </View>
          )}

          <View
            style={[
              styles.detailsSection,
              styles.detailsSectionCard,
              !activeSelectedProject.isEvent && { display: 'none' },
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Event Task Board</Text>
              {isAdmin && !isProjectReadOnly && (
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
                {/* Main Collapsed Task Card */}
                <TouchableOpacity
                  style={styles.taskCard}
                  onPress={() => setShowTaskList(true)}
                  activeOpacity={0.85}
                >
                  <View style={styles.taskCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.taskTitle}>Task Assignments</Text>
                      <Text style={styles.taskMeta}>
                        {internalTasks.length} total task{internalTasks.length !== 1 ? 's' : ''} • {internalTasks.filter(t => getTaskAssignedVolunteerIds(t).length > 0).length} assigned
                      </Text>
                    </View>
                    <MaterialIcons
                      name="chevron-right"
                      size={28}
                      color="#0F766E"
                    />
                  </View>
                </TouchableOpacity>

                {/* Task List Modal Popup */}
                <Modal
                  visible={showTaskList}
                  animationType="slide"
                  onRequestClose={() => setShowTaskList(false)}
                >
                  <View style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                      <TouchableOpacity onPress={() => setShowTaskList(false)}>
                        <MaterialIcons name="close" size={24} color="#333" />
                      </TouchableOpacity>
                      <Text style={styles.modalTitle}>Task Assignments</Text>
                      <View style={{ width: 24 }} />
                    </View>

                    <ScrollView style={styles.modalContent} contentContainerStyle={{ paddingBottom: 40 }}>
                      <View style={{ padding: 16 }}>
                        <Text style={[styles.sectionHint, { marginBottom: 16 }]}>
                          Assign event tasks to joined volunteers so the day stays organized and easy to follow.
                        </Text>
                        
                        <View style={styles.expandedTaskList}>
                          {internalTasks.map((task, index) => (
                            <View key={task.id} style={[styles.taskListItem, index !== internalTasks.length - 1 && styles.taskListItemDivider]}>
                              <View style={styles.taskListItemHeader}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.taskListItemTitle}>{task.title}</Text>
                                  <Text style={styles.taskListItemMeta}>
                                    {task.category} - {task.priority} Priority
                                  </Text>
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

                              <Text style={styles.taskListItemDescription}>{task.description}</Text>

                              {task.skillsNeeded && task.skillsNeeded.length > 0 && (
                                <Text style={styles.taskSkillsText}>
                                  Skills needed: {task.skillsNeeded.join(', ')}
                                </Text>
                              )}

                              <View style={styles.taskListItemAssignment}>
                                <Text style={styles.taskListItemAssignmentLabel}>
                                  Assigned to:
                                </Text>
                                {getTaskAssignedVolunteerNames(task).length > 0 ? (
                                  <View style={styles.assignedVolunteersList}>
                                    {getTaskAssignedVolunteerNames(task).map((volunteerName, idx) => (
                                      <View key={`${task.id}-volunteer-${idx}`} style={styles.assignedVolunteerChip}>
                                        <Text style={styles.assignedVolunteerChipText}>{volunteerName}</Text>
                                      </View>
                                    ))}
                                  </View>
                                ) : (
                                  <Text style={styles.unassignedText}>Unassigned</Text>
                                )}
                              </View>

                              {task.isFieldOfficer && (
                                <Text style={styles.taskFieldOfficerNote}>
                                  ⚡ Field Officer permissions enabled for this event
                                </Text>
                              )}

                              {isAdmin && (
                                <View style={styles.taskActionRow}>
                                  {!isProjectReadOnly && (
                                    <>
                                  <TouchableOpacity
                                    style={[styles.applicationButton, styles.approveButton]}
                                    onPress={() => {
                                      setShowTaskList(false);
                                      openEditTaskModal(task);
                                    }}
                                  >
                                    <Text style={styles.applicationButtonText}>Assign</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.applicationButton, styles.rejectButton]}
                                    onPress={() => handleDeleteInternalTask(task.id)}
                                  >
                                    <Text style={styles.applicationButtonText}>Delete</Text>
                                  </TouchableOpacity>
                                    </>
                                  )}
                                </View>
                              )}
                            </View>
                          ))}
                        </View>
                      </View>
                    </ScrollView>
                  </View>
                </Modal>
              </View>
            )}
          </View>

          {activeSelectedProject.isEvent ? (
            <>
              <View style={[styles.detailsSection, styles.detailsSectionCard]}>
                <Text style={styles.sectionTitle}>Event Time Tracking</Text>
                <Text style={styles.sectionHint}>
                  Attendance activity is summarized first, then grouped into one card per volunteer account below.
                </Text>
                <View style={styles.detailsQuickGrid}>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Confirmations</Text>
                    <Text style={styles.detailsQuickValue}>{projectTimeInCount}</Text>
                    <Text style={styles.detailsQuickMeta}>Recorded attendance uploads</Text>
                  </View>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Marked</Text>
                    <Text style={styles.detailsQuickValue}>{projectCheckedAttendanceCount}</Text>
                    <Text style={styles.detailsQuickMeta}>Field officer-marked attendance records</Text>
                  </View>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Latest Attendance</Text>
                    <Text style={styles.detailsQuickValue}>{latestTimeActivityLabel}</Text>
                    <Text style={styles.detailsQuickMeta}>Most recent attendance update</Text>
                  </View>
                </View>

                <Text style={styles.sectionSubheading}>Daily Attendance Checker</Text>
                <Text style={styles.sectionHint}>
                  Choose an event day, review the uploaded photo, then see which volunteers were marked as attended for that date.
                </Text>

                <View style={styles.attendanceDatePickerContainer}>
                  <Text style={styles.attendanceDatePickerLabel}>Attendance day</Text>
                  <View style={styles.attendanceDatePickerWrapper}>
                    {isDesktop ? (
                      <Picker
                        selectedValue={resolvedAttendanceDateKey}
                        onValueChange={(value) => setSelectedAttendanceDateKey(value)}
                        style={styles.attendanceDatePicker}
                        dropdownIconColor="#64748b"
                      >
                        {availableAttendanceDateKeys.length > 0 ? (
                          availableAttendanceDateKeys.map(dateKey => (
                            <Picker.Item
                              key={dateKey}
                              label={format(new Date(`${dateKey}T00:00:00`), 'EEE, MMM d')}
                              value={dateKey}
                            />
                          ))
                        ) : (
                          <Picker.Item label="No dates available" value="" />
                        )}
                      </Picker>
                    ) : (
                      <TouchableOpacity
                        style={styles.attendanceDateDropdownMobile}
                        onPress={() => setAttendancePickerVisible(true)}
                      >
                        <Text style={styles.attendanceDateDropdownText} numberOfLines={1}>
                          {availableAttendanceDateKeys.length > 0
                            ? format(new Date(`${resolvedAttendanceDateKey}T00:00:00`), 'EEE, MMM d')
                            : 'No dates available'}
                        </Text>
                        <MaterialIcons name="arrow-drop-down" size={24} color="#64748b" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.detailsQuickGrid}>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Selected Day</Text>
                    <Text style={styles.detailsQuickValue}>
                      {format(new Date(`${resolvedAttendanceDateKey}T00:00:00`), 'MMM d')}
                    </Text>
                    <Text style={styles.detailsQuickMeta}>Current day under review</Text>
                  </View>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Uploads</Text>
                    <Text style={styles.detailsQuickValue}>{selectedDateAttendanceEntries.length}</Text>
                    <Text style={styles.detailsQuickMeta}>Volunteers with attendance photo</Text>
                  </View>
                  <View style={styles.detailsQuickCard}>
                    <Text style={styles.detailsQuickLabel}>Marked</Text>
                    <Text style={styles.detailsQuickValue}>{selectedDateCheckedCount}</Text>
                    <Text style={styles.detailsQuickMeta}>Volunteers marked attended</Text>
                  </View>
                </View>

                <Text style={styles.sectionSubheading}>Volunteer Account Cards</Text>
                {projectVolunteerAttendanceCards.length === 0 ? (
                  <Text style={styles.emptyText}>No attendance confirmations yet</Text>
                ) : (
                  <View style={styles.attendanceCardGrid}>
                    {projectVolunteerAttendanceCards.map(card => (
                      <TouchableOpacity
                        key={`${card.volunteerId}-${resolvedAttendanceDateKey}`}
                        activeOpacity={0.88}
                        onPress={() => openVolunteerAttendanceDetails(card.volunteerId)}
                        style={[
                          styles.attendanceCardCompact,
                          isDesktop ? styles.attendanceCardCompactDesktop : styles.attendanceCardCompactMobile,
                        ]}
                      >
                        <View style={styles.attendanceCardCompactTopRow}>
                          <Text style={styles.applicationName} numberOfLines={1}>
                            {card.volunteerName}
                          </Text>
                          <View
                            style={[
                              styles.applicationStatusBadge,
                              card.checkedAttendanceDays > 0
                                ? styles.applicationStatusApproved
                                : card.timeInCount > 0
                                ? styles.applicationStatusPending
                                : styles.applicationStatusRejected,
                            ]}
                          >
                            <Text style={styles.applicationStatusText}>
                              {card.checkedAttendanceDays > 0
                                ? 'Marked'
                                : card.timeInCount > 0
                                ? 'Needs Review'
                                : 'No Upload'}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.applicationMeta} numberOfLines={1}>
                          {card.volunteerEmail}
                        </Text>
                          <Text style={styles.applicationMeta} numberOfLines={2}>
                          {card.latestActivityLabel}
                        </Text>
                        <View style={styles.attendanceMetricsRow}>
                          <View style={styles.attendanceMetricChip}>
                            <Text style={styles.attendanceMetricValue}>{card.timeInCount}</Text>
                            <Text style={styles.attendanceMetricLabel}>records</Text>
                          </View>
                          <View style={styles.attendanceMetricChip}>
                            <Text style={styles.attendanceMetricValue}>{card.checkedAttendanceDays}</Text>
                            <Text style={styles.attendanceMetricLabel}>checked</Text>
                          </View>
                          <View style={styles.attendanceMetricChip}>
                            <Text style={styles.attendanceMetricValue}>{card.attendanceDays}</Text>
                            <Text style={styles.attendanceMetricLabel}>days</Text>
                          </View>
                        </View>
                        <View style={styles.attendanceCardCompactFooter}>
                          <Text style={styles.attendanceCardCompactHint}>Tap to view selected day record</Text>
                          <MaterialIcons name="chevron-right" size={18} color="#1d4ed8" />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View style={[styles.detailsSection, styles.detailsSectionCard]}>
                <Text style={styles.sectionTitle}>
                  Pending Event Join Requests ({pendingVolunteerRequestEntries.length})
                </Text>
                <Text style={styles.sectionHint}>
                  Review incoming join requests here before volunteers are added to the confirmed event team.
                </Text>

                {pendingVolunteerRequestEntries.length === 0 ? (
                  <Text style={styles.emptyText}>No pending event join requests</Text>
                ) : (
                  <View style={styles.updatesList}>
                    {pendingVolunteerRequestEntries.map(requestEntry => (
                      <View key={requestEntry.id} style={styles.applicationCard}>
                        <TouchableOpacity
                          style={styles.applicationHeaderToggle}
                          onPress={() => {
                            setExpandedVolunteerRequestIds(current => {
                              const next = new Set(current);
                              if (next.has(requestEntry.id)) {
                                next.delete(requestEntry.id);
                              } else {
                                next.add(requestEntry.id);
                              }
                              return next;
                            });
                          }}
                        >
                          <View style={styles.applicationHeader}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.applicationName}>{requestEntry.volunteerName}</Text>
                              {expandedVolunteerRequestIds.has(requestEntry.id) && (
                                <>
                                  <Text style={styles.applicationMeta}>{requestEntry.volunteerEmail}</Text>
                                  <Text style={styles.applicationMeta}>
                                    Requested {format(new Date(requestEntry.requestedAt), 'PPpp')}
                                  </Text>
                                </>
                              )}
                            </View>
                            <View style={styles.applicationHeaderRight}>
                              <View
                                style={[
                                  styles.applicationStatusBadge,
                                  styles.applicationStatusPending,
                                ]}
                              >
                                <Text style={styles.applicationStatusText}>{requestEntry.status}</Text>
                              </View>
                              <MaterialIcons
                                name={expandedVolunteerRequestIds.has(requestEntry.id) ? 'expand-less' : 'expand-more'}
                                size={20}
                                color="#64748b"
                              />
                            </View>
                          </View>
                        </TouchableOpacity>

                        {expandedVolunteerRequestIds.has(requestEntry.id) && (
                          <>
                            {isAdmin && (
                              <View style={styles.applicationActions}>
                                {!isProjectReadOnly && (
                                  <>
                                <TouchableOpacity
                                  style={[
                                    styles.applicationButton, 
                                    styles.approveButton,
                                    actionLoadingKey === `reviewMatch-${requestEntry.id}` && { opacity: 0.7 }
                                  ]}
                                  onPress={() => confirmReviewVolunteerRequest(requestEntry, 'Matched')}
                                  disabled={Boolean(actionLoadingKey)}
                                >
                                  {actionLoadingKey === `reviewMatch-${requestEntry.id}` ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                  ) : (
                                    <Text style={styles.applicationButtonText}>Approve</Text>
                                  )}
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.applicationButton, 
                                    styles.rejectButton,
                                    actionLoadingKey === `reviewMatch-${requestEntry.id}` && { opacity: 0.7 }
                                  ]}
                                  onPress={() => confirmReviewVolunteerRequest(requestEntry, 'Rejected')}
                                  disabled={Boolean(actionLoadingKey)}
                                >
                                  {actionLoadingKey === `reviewMatch-${requestEntry.id}` ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                  ) : (
                                    <Text style={styles.applicationButtonText}>Reject</Text>
                                  )}
                                </TouchableOpacity>
                                  </>
                                )}
                              </View>
                            )}

                            <TouchableOpacity
                              style={styles.viewVolunteerProfileButton}
                              onPress={() => openVolunteerProfile(requestEntry.volunteerId)}
                            >
                              <MaterialIcons name="person-search" size={16} color="#2563eb" />
                              <Text style={styles.viewVolunteerProfileText}>Open Volunteer Profile</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={[styles.detailsSection, styles.detailsSectionCard]}>
                <TouchableOpacity
                  style={styles.sectionHeaderClickable}
                  onPress={() => setShowParticipantsSection(!showParticipantsSection)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionTitle}>
                      Event Participants ({volunteerEntries.length})
                    </Text>
                    <Text style={styles.sectionHint}>
                      Confirmed volunteers are listed here with their participation history and current status.
                    </Text>
                  </View>
                  <MaterialIcons 
                    name={showParticipantsSection ? "expand-less" : "expand-more"} 
                    size={24} 
                    color="#64748b" 
                  />
                </TouchableOpacity>

                {showParticipantsSection && (
                  <>
                    {volunteerEntries.length === 0 ? (
                      <Text style={styles.emptyText}>No volunteers have joined this event yet</Text>
                    ) : (
                      <View style={styles.volunteersGrid}>
                        {volunteerEntries.map(volunteerEntry => (
                          <View key={volunteerEntry.id} style={styles.volunteerCompactCard}>
                            <View style={styles.volunteerCompactHeader}>
                              <Text style={styles.volunteerName}>{volunteerEntry.name}</Text>
                              <View style={styles.volunteerBadgesCompact}>
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
                              </View>
                            </View>
                            <Text style={styles.volunteerMetaSmall}>{volunteerEntry.email}</Text>
                            {isAdmin && volunteerEntry.participationStatus !== 'Completed' && (
                              <TouchableOpacity
                                style={styles.completeVolunteerButtonSmall}
                                onPress={() => handleCompleteVolunteerParticipation(volunteerEntry.id)}
                              >
                                <MaterialIcons name="task-alt" size={14} color="#fff" />
                                <Text style={styles.completeVolunteerButtonTextSmall}>Complete</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={styles.viewVolunteerProfileButtonSmall}
                              onPress={() => openVolunteerProfile(volunteerEntry.id)}
                            >
                              <MaterialIcons name="person-search" size={14} color="#2563eb" />
                              <Text style={styles.viewVolunteerProfileTextSmall}>View Profile</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
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
            {isTaskSaveSuccess ? (
              <View style={styles.taskSuccessContainer}>
                <View style={styles.taskSuccessCard}>
                  <MaterialIcons name="check-circle" size={86} color="#16a34a" />
                  <Text style={styles.taskSuccessTitle}>
                    {editingTaskId ? 'Task Update Complete' : 'Task Added'}
                  </Text>
                  <Text style={styles.taskSuccessMessage}>{taskSaveSuccessMessage}</Text>
                  <TouchableOpacity
                    style={styles.taskSuccessButton}
                    onPress={closeTaskModal}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.taskSuccessButtonText}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={closeTaskModal}>
                    <MaterialIcons name="close" size={24} color="#333" />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>
                    {editingTaskId ? 'Assign Task' : 'Add Internal Task'}
                  </Text>
                  <TouchableOpacity onPress={handleSaveInternalTask}>
                    <Text style={styles.projectModalSave}>Save</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalContent}>
              {editingTaskId ? (
                // Simplified assignment-only view when editing
                <>
                  <View style={[styles.formRow, styles.formRowReverse]}>
                    <View style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput, { justifyContent: 'center', paddingVertical: 12 }]}>
                      <Text style={{ fontSize: 16, color: '#333', fontWeight: '500' }}>{taskDraft.title}</Text>
                    </View>
                    <Text style={styles.labelRight}>Task Name</Text>
                  </View>

                  <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                    <View style={[styles.textArea, styles.inputWithLabel, { justifyContent: 'center', paddingVertical: 12 }]}>
                      <Text style={{ fontSize: 14, color: '#666' }}>{taskDraft.description || 'No description'}</Text>
                    </View>
                    <Text style={[styles.labelRight, styles.labelTop]}>Description</Text>
                  </View>
                </>
              ) : (
                // Full form view when creating new task
                <>
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
                </>
              )}

              <View style={[styles.formRow, styles.formRowReverse, styles.formRowTop]}>
                <View style={styles.dropdownWrapper}>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setShowAssignmentDropdown(!showAssignmentDropdown)}
                  >
                    <Text style={styles.dropdownButtonText}>
                      {taskDraft.assignedVolunteerIds.length === 0
                        ? 'Unassigned'
                        : `${taskDraft.assignedVolunteerIds.length} volunteer${
                            taskDraft.assignedVolunteerIds.length === 1 ? '' : 's'
                          } selected`}
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
                          taskDraft.assignedVolunteerIds.length === 0 && styles.dropdownOptionSelected,
                        ]}
                        onPress={() => {
                          handleTaskDraftChange('assignedVolunteerIds', []);
                        }}
                      >
                        <MaterialIcons
                          name={taskDraft.assignedVolunteerIds.length === 0 ? 'check-box' : 'check-box-outline-blank'}
                          size={20}
                          color={taskDraft.assignedVolunteerIds.length === 0 ? '#0F766E' : '#ccc'}
                        />
                        <Text style={styles.dropdownOptionText}>Clear all assignments</Text>
                      </TouchableOpacity>

                      {assignableVolunteerOptions.map(volunteerOption => (
                        <TouchableOpacity
                          key={volunteerOption.id}
                          style={[
                            styles.dropdownOption,
                            taskDraft.assignedVolunteerIds.includes(volunteerOption.id) && styles.dropdownOptionSelected,
                          ]}
                          onPress={() => {
                            const nextAssignedVolunteerIds = taskDraft.assignedVolunteerIds.includes(volunteerOption.id)
                              ? taskDraft.assignedVolunteerIds.filter(id => id !== volunteerOption.id)
                              : [...taskDraft.assignedVolunteerIds, volunteerOption.id];
                            handleTaskDraftChange('assignedVolunteerIds', nextAssignedVolunteerIds);
                          }}
                        >
                          <MaterialIcons
                            name={taskDraft.assignedVolunteerIds.includes(volunteerOption.id) ? 'check-box' : 'check-box-outline-blank'}
                            size={20}
                            color={taskDraft.assignedVolunteerIds.includes(volunteerOption.id) ? '#0F766E' : '#ccc'}
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
              ) : taskDraft.assignedVolunteerIds.length > 0 ? (
                <View style={styles.selectedSkillChips}>
                  {taskDraft.assignedVolunteerIds.map(volunteerId => {
                    const volunteerName =
                      assignableVolunteerOptions.find(volunteer => volunteer.id === volunteerId)?.name || volunteerId;
                    return (
                      <TouchableOpacity
                        key={`assigned-volunteer-${volunteerId}`}
                        style={styles.selectedSkillChip}
                        onPress={() =>
                          handleTaskDraftChange(
                            'assignedVolunteerIds',
                            taskDraft.assignedVolunteerIds.filter(id => id !== volunteerId)
                          )
                        }
                      >
                        <Text style={styles.selectedSkillChipText}>{volunteerName}</Text>
                        <MaterialIcons name="close" size={14} color="#0F766E" />
                      </TouchableOpacity>
                    );
                  })}
                </View>
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
              </>
            )}
          </View>
        </Modal>
        <Modal
          visible={attendancePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAttendancePickerVisible(false)}
        >
          <View style={styles.proposalModalBackdrop}>
            <View style={styles.attendancePickerModalCard}>
              <View style={styles.proposalModalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.proposalModalTitle}>Select Attendance Day</Text>
                  <Text style={styles.proposalModalSubtitle}>Choose a date to review</Text>
                </View>
                <TouchableOpacity onPress={() => setAttendancePickerVisible(false)} style={styles.proposalModalClose}>
                  <MaterialIcons name="close" size={18} color="#0f172a" />
                </TouchableOpacity>
              </View>

              <View style={styles.attendancePickerModalBody}>
                <Picker
                  selectedValue={resolvedAttendanceDateKey}
                  onValueChange={(value) => setSelectedAttendanceDateKey(value)}
                  style={styles.attendanceDatePicker}
                >
                  {availableAttendanceDateKeys.length > 0 ? (
                    availableAttendanceDateKeys.map(dateKey => (
                      <Picker.Item
                        key={dateKey}
                        label={format(new Date(`${dateKey}T00:00:00`), 'EEE, MMM d')}
                        value={dateKey}
                      />
                    ))
                  ) : (
                    <Picker.Item label="No dates available" value="" />
                  )}
                </Picker>
                <TouchableOpacity style={styles.modalPrimaryButton} onPress={() => setAttendancePickerVisible(false)}>
                  <Text style={styles.modalPrimaryButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
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
                style={[
                  styles.submitButton,
                  actionLoadingKey === 'saveStatusUpdate' && { opacity: 0.7 }
                ]}
                onPress={handleAddStatusUpdate}
                disabled={actionLoadingKey === 'saveStatusUpdate'}
              >
                {actionLoadingKey === 'saveStatusUpdate' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Add Update</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
        <Modal
          visible={Boolean(selectedAttendanceCard)}
          transparent
          animationType="fade"
          onRequestClose={closeVolunteerAttendanceDetails}
        >
          <View style={styles.proposalModalBackdrop}>
            <View style={styles.attendanceModalCard}>
              <View style={styles.proposalModalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.proposalModalTitle}>
                    {selectedAttendanceCard?.volunteerName || 'Volunteer Record'}
                  </Text>
                  <Text style={styles.proposalModalSubtitle}>
                    {selectedAttendanceCard?.volunteerEmail || 'No email on file'}
                  </Text>
                  <Text style={styles.attendanceModalLiveNote}>
                    Each daily attendance record can be reviewed here. Attendance checking is handled in the field officer Manage Assignments board.
                  </Text>
                </View>
                <TouchableOpacity onPress={closeVolunteerAttendanceDetails} style={styles.proposalModalClose}>
                  <MaterialIcons name="close" size={18} color="#0f172a" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.attendanceModalScroll}
                contentContainerStyle={styles.attendanceModalScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.attendanceModalStatsRow}>
                  <View style={styles.attendanceModalStatCard}>
                    <Text style={styles.attendanceModalStatValue}>{selectedAttendanceCard?.timeInCount || 0}</Text>
                    <Text style={styles.attendanceModalStatLabel}>Records</Text>
                  </View>
                  <View style={styles.attendanceModalStatCard}>
                    <Text style={styles.attendanceModalStatValue}>{selectedAttendanceCard?.checkedAttendanceDays || 0}</Text>
                    <Text style={styles.attendanceModalStatLabel}>Marked</Text>
                  </View>
                  <View style={styles.attendanceModalStatCard}>
                    <Text style={styles.attendanceModalStatValue}>{selectedAttendanceCard?.attendanceDays || 0}</Text>
                    <Text style={styles.attendanceModalStatLabel}>Days</Text>
                  </View>
                </View>

                <Text style={styles.attendanceModalSectionTitle}>Attendance Records</Text>
                {selectedAttendanceCard?.logs.length ? (
                  selectedAttendanceCard.logs.map(log => (
                    <View key={log.id} style={styles.attendanceRecordRow}>
                      <View style={styles.attendanceRecordTimeline}>
                        <Text style={styles.attendanceRecordLabel}>Confirmed at</Text>
                        <Text style={styles.attendanceRecordValue}>
                          {format(new Date(log.attendanceConfirmedAt || log.timeIn), 'PPpp')}
                        </Text>
                        <Text style={styles.attendanceRecordLabel}>Marked status</Text>
                        <Text style={styles.attendanceRecordValue}>
                          {log.attendanceCheckedAt
                            ? `Marked by ${log.attendanceCheckedByName || 'Field Officer'} on ${format(
                                new Date(log.attendanceCheckedAt),
                                'PPpp'
                              )}`
                            : 'Not marked yet'}
                        </Text>
                      </View>
                      {(log.attendancePhoto || log.completionPhoto) && isImageMediaUri(log.attendancePhoto || log.completionPhoto) ? (
                        <TouchableOpacity
                          style={styles.attendanceRecordPhotoButton}
                          onPress={() => setSelectedAttendancePhotoUri(log.attendancePhoto || log.completionPhoto || '')}
                        >
                          <MaterialIcons name="photo" size={18} color="#166534" />
                          <Text style={styles.attendanceRecordPhotoButtonText}>View uploaded photo</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.attendanceRecordTimeline}>
                          <Text style={styles.attendanceRecordLabel}>Photo</Text>
                          <Text style={styles.attendanceRecordValue}>No photo available</Text>
                        </View>
                      )}
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No attendance upload for this selected day yet.</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal
          visible={Boolean(selectedAttendancePhotoUri)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedAttendancePhotoUri(null)}
        >
          <View style={styles.attendanceImagePreviewBackdrop}>
            <View style={styles.attendanceImagePreviewCard}>
              <View style={styles.attendanceImagePreviewHeader}>
                <Text style={styles.proposalModalTitle}>Attendance Photo</Text>
                <TouchableOpacity onPress={() => setSelectedAttendancePhotoUri(null)} style={styles.attendanceImagePreviewClose}>
                  <MaterialIcons name="close" size={20} color="#0f172a" />
                </TouchableOpacity>
              </View>
              <Image
                source={{ uri: selectedAttendancePhotoUri || '' }}
                style={styles.attendanceImagePreview}
                resizeMode="contain"
              />
            </View>
          </View>
        </Modal>
        {renderProgramProposalModal()}
      </ScrollView>
      {renderProjectEditorModal()}
      </View>
    );
  }

  return (
    <View style={styles.screenShell}>
      {renderTaskSaveToast()}

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
      </View>

      {/* Project status count pills - clickable to filter - only show in projects view */}
      {programSuiteView === 'projects' && (
      <View style={{ paddingHorizontal: 12, marginTop: 12, marginBottom: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#64748b', marginBottom: 12 }}>Projects</Text>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-start', backgroundColor: '#f8fafc', padding: 14, borderRadius: 8 }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'In Progress' ? '#0369a1' : '#dbeafe', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'In Progress' ? null : 'In Progress')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'In Progress' ? '#fff' : '#0369a1' }}>{projects.filter(p => !p.isEvent && getProjectDisplayStatus(p) === 'In Progress').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'In Progress' ? '#fff' : '#0369a1' }}>In Progress</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'Planning' ? '#92400e' : '#fef3c7', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'Planning' ? null : 'Planning')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'Planning' ? '#fff' : '#92400e' }}>{projects.filter(p => !p.isEvent && getProjectDisplayStatus(p) === 'Planning').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'Planning' ? '#fff' : '#92400e' }}>Planning</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'Completed' ? '#166534' : '#dcfce7', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'Completed' ? null : 'Completed')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'Completed' ? '#fff' : '#166534' }}>{projects.filter(p => !p.isEvent && getProjectDisplayStatus(p) === 'Completed').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'Completed' ? '#fff' : '#166534' }}>Completed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'Cancelled' ? '#991b1b' : '#fee2e2', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'Cancelled' ? null : 'Cancelled')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'Cancelled' ? '#fff' : '#991b1b' }}>{projects.filter(p => !p.isEvent && getProjectDisplayStatus(p) === 'Cancelled').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'Cancelled' ? '#fff' : '#991b1b' }}>Cancelled</Text>
          </TouchableOpacity>
        </View>
      </View>
      )}

      {/* Event status count pills - clickable to filter - only show in events view */}
      {programSuiteView === 'events' && (
      <View style={{ paddingHorizontal: 12, marginBottom: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#64748b', marginBottom: 12 }}>Events</Text>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-start', backgroundColor: '#f0fdf4', padding: 14, borderRadius: 8 }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'In Progress' ? '#0369a1' : '#dbeafe', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'In Progress' ? null : 'In Progress')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'In Progress' ? '#fff' : '#0369a1' }}>{projects.filter(p => p.isEvent && getProjectDisplayStatus(p) === 'In Progress').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'In Progress' ? '#fff' : '#0369a1' }}>In Progress</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'Planning' ? '#92400e' : '#fef3c7', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'Planning' ? null : 'Planning')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'Planning' ? '#fff' : '#92400e' }}>{projects.filter(p => p.isEvent && getProjectDisplayStatus(p) === 'Planning').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'Planning' ? '#fff' : '#92400e' }}>Planning</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'Completed' ? '#166534' : '#dcfce7', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'Completed' ? null : 'Completed')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'Completed' ? '#fff' : '#166534' }}>{projects.filter(p => p.isEvent && getProjectDisplayStatus(p) === 'Completed').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'Completed' ? '#fff' : '#166534' }}>Completed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: statusFilter === 'Cancelled' ? '#991b1b' : '#fee2e2', borderRadius: 8 }}
            onPress={() => setStatusFilter(statusFilter === 'Cancelled' ? null : 'Cancelled')}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: statusFilter === 'Cancelled' ? '#fff' : '#991b1b' }}>{projects.filter(p => p.isEvent && getProjectDisplayStatus(p) === 'Cancelled').length}</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: statusFilter === 'Cancelled' ? '#fff' : '#991b1b' }}>Cancelled</Text>
          </TouchableOpacity>
        </View>
      </View>
      )}

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
          {programSuiteView === 'programs' ? (
            <>
          {statusFilter ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 4, paddingVertical: 8, backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#bbf7d0' }}>
              <MaterialIcons name="filter-list" size={16} color="#166534" />
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: '#166534' }}>
                Status filter active:{' '}
                <Text style={{
                  color: statusFilter === 'In Progress' ? '#1d4ed8'
                    : statusFilter === 'Planning' ? '#b45309'
                    : statusFilter === 'Completed' ? '#15803d'
                    : '#be123c'
                }}>{statusFilter}</Text>
                {' '}— switch to Projects or Events to see filtered results.
              </Text>
              <TouchableOpacity
                onPress={() => setStatusFilter(null)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#dcfce7' }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="close" size={14} color="#166534" />
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#166534' }}>Clear</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
              {programSections.map(section => {
                const track = activeProgramTracks.find(t => t.id === section.module);
                const overview = getProgramWebOverview(section);
                return (
                  <View key={section.module} style={{ position: 'relative', flexBasis: 260, flexGrow: 1, maxWidth: 340 }}>
                    <TouchableOpacity
                      style={[
                        styles.programSuiteHeaderCard,
                        {
                          backgroundColor: section.surface,
                          borderColor: expandedProgramModules.has(section.module) ? section.accent : section.border,
                          width: '100%',
                          minHeight: 300,
                          justifyContent: 'flex-start',
                        },
                      ]}
                      onPress={() => setSelectedProgramWebModule(section.module)}
                      activeOpacity={0.88}
                    >
                      {section.imageUrl && (
                        <Image
                          source={{ uri: section.imageUrl }}
                          style={[StyleSheet.absoluteFill, { borderRadius: 8, opacity: 0.12 }]}
                          resizeMode="cover"
                        />
                      )}
                      <View style={styles.programWebsiteCardChrome}>
                        <View style={[styles.programWebsiteCardDot, { backgroundColor: section.accent }]} />
                        <View style={styles.programWebsiteCardDot} />
                        <View style={styles.programWebsiteCardDot} />
                        <Text style={styles.programWebsiteCardUrl} numberOfLines={1}>
                          nvcconnect.local/{section.title.toLowerCase()}
                        </Text>
                      </View>

                      <View style={styles.programWebsiteCardHero}>
                        <View style={[styles.programWebsiteCardIcon, { backgroundColor: section.accent }]}>
                          <MaterialIcons name={section.icon} size={24} color="#ffffff" />
                        </View>
                        <View style={styles.programWebsiteCardHeroCopy}>
                          <Text style={styles.programWebsiteCardKicker}>Program Pillar</Text>
                          <Text style={styles.programWebsiteCardTitle}>{section.title}</Text>
                          <Text style={styles.programWebsiteCardLead} numberOfLines={3}>
                            {overview.about}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.programWebsiteCardMetrics}>
                        <View style={styles.programWebsiteCardMetric}>
                          <Text style={[styles.programWebsiteCardMetricValue, { color: section.accent }]}>
                            {section.totalPrograms}
                          </Text>
                          <Text style={styles.programWebsiteCardMetricLabel}>Projects</Text>
                        </View>
                        <View style={styles.programWebsiteCardMetric}>
                          <Text style={[styles.programWebsiteCardMetricValue, { color: section.accent }]}>
                            {section.eventCount}
                          </Text>
                          <Text style={styles.programWebsiteCardMetricLabel}>Events</Text>
                        </View>
                        <View style={styles.programWebsiteCardMetric}>
                          <Text style={[styles.programWebsiteCardMetricValue, { color: section.accent }]}>
                            {section.inProgressCount}
                          </Text>
                          <Text style={styles.programWebsiteCardMetricLabel}>Active</Text>
                        </View>
                      </View>

                      <View style={styles.programWebsiteCardFeatureGrid}>
                        {overview.highlights.slice(0, 2).map(highlight => (
                          <View key={`${section.module}-${highlight.title}`} style={styles.programWebsiteCardFeature}>
                            <Text style={styles.programWebsiteCardFeatureTitle} numberOfLines={1}>{highlight.title}</Text>
                            <Text style={styles.programWebsiteCardFeatureText} numberOfLines={2}>{highlight.description}</Text>
                          </View>
                        ))}
                      </View>

                      <View style={styles.programWebsiteCardFooter}>
                        <Text style={[styles.programWebsiteCardFooterText, { color: section.accent }]}>View program details</Text>
                        <MaterialIcons name="arrow-forward" size={18} color={section.accent} />
                      </View>

                      <View style={{ display: 'none', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
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
                      <View style={{ display: 'none' }}>
                        <Text style={[styles.programSuiteTitle, { fontSize: 20, marginBottom: 4 }]}>{section.title}</Text>
                        <Text style={styles.programWebEyebrow}>Program Overview</Text>
                        <Text style={styles.programWebAbout}>{overview.about}</Text>
                        <View style={styles.programWebHighlightRow}>
                          {overview.highlights.slice(0, 3).map(highlight => (
                            <View key={`${section.module}-${highlight.title}`} style={styles.programWebHighlightChip}>
                              <Text style={styles.programWebHighlightText}>{highlight.title}</Text>
                            </View>
                          ))}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: section.accent }}>{section.totalPrograms} Projects</Text>
                          <Text style={{ fontSize: 13, color: '#64748b' }}>•</Text>
                          <Text style={{ fontSize: 13, color: '#64748b' }}>{section.inProgressCount} Active</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                    {isAdmin && track && (
                      <View style={{ position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4, zIndex: 10 }} pointerEvents="box-none">
                        <Pressable
                          style={{ backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: 4 }}
                          onPress={() => openEditProgramModal(track)}
                        >
                          <MaterialIcons name="edit" size={16} color="#6366f1" />
                        </Pressable>
                        <Pressable
                          style={{ backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: 4, opacity: actionLoadingKey === `deleteProgram-${track.id}` ? 0.5 : 1 }}
                          onPress={(event) => {
                            event.stopPropagation?.();
                            handleDeleteProgram(track.id, track.title);
                          }}
                          disabled={actionLoadingKey === `deleteProgram-${track.id}`}
                        >
                          <MaterialIcons name="delete" size={16} color="#ef4444" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}

              {isAdmin && (
                <TouchableOpacity
                  style={{
                    flexBasis: 260,
                    flexGrow: 1,
                    maxWidth: 340,
                    minHeight: 300,
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
            </View>
          </View>
            </>
          ) : programSuiteView === 'projects' ? (
            <>

          {/* Status filter active banner */}
          {statusFilter ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 4, paddingVertical: 8, backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#bbf7d0' }}>
              <MaterialIcons name="filter-list" size={16} color="#166534" />
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: '#166534' }}>
                Showing:{' '}
                <Text style={{
                  color: statusFilter === 'In Progress' ? '#1d4ed8'
                    : statusFilter === 'Planning' ? '#b45309'
                    : statusFilter === 'Completed' ? '#15803d'
                    : '#be123c'
                }}>{statusFilter}</Text>
                {' '}projects only
              </Text>
              <TouchableOpacity
                onPress={() => setStatusFilter(null)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#dcfce7' }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="close" size={14} color="#166534" />
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#166534' }}>Clear</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.programSuiteStack}>
            {programSections.map(renderProgramSection)}
            {statusFilter && programSections.every(section =>
              section.projects.filter(p => isProgramSuiteProjectRecord(p) && getProjectDisplayStatus(p) === statusFilter).length === 0
            ) ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <MaterialIcons name="search-off" size={36} color="#94a3b8" />
                <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '700', color: '#64748b' }}>
                  No {statusFilter} projects
                </Text>
                <Text style={{ marginTop: 4, fontSize: 13, color: '#94a3b8' }}>
                  No projects match this status filter.
                </Text>
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.programSuiteSchedulerCard,
              styles.compactCalendarCard,
              !isDesktop && styles.programSuiteSchedulerCardStacked,
            ]}
          >
            <View
              style={[
                styles.programSuiteSchedulerAgendaPane,
                styles.compactCalendarAgendaPane,
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
                styles.compactCalendarMonthPane,
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
                <View style={[styles.schedulerCalendarWrap, styles.compactSchedulerCalendarWrap]}>
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
                              styles.compactSchedulerCalendarDayCell,
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
                          {getProgramSuiteModuleForProject(project, activeProgramTracks) || project.category}
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
          ) : (
            <View style={styles.programSuiteStack}>
              <View style={styles.programSuiteProjectsBlock}>
                <View style={styles.programSuiteProjectsHeader}>
                  <Text style={styles.programSuiteProjectsTitle}>Events by Project</Text>
                  <Text style={styles.programSuiteProjectsMeta}>
                    Events are grouped under the project that created them. Use each project row to add a new event.
                  </Text>
                </View>
              </View>
              {eventProjectSections.length ? (
                <>
                  {statusFilter ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 4, paddingVertical: 8, backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#bbf7d0' }}>
                      <MaterialIcons name="filter-list" size={16} color="#166534" />
                      <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: '#166534' }}>
                        Showing:{' '}
                        <Text style={{
                          color: statusFilter === 'In Progress' ? '#1d4ed8'
                            : statusFilter === 'Planning' ? '#b45309'
                            : statusFilter === 'Completed' ? '#15803d'
                            : '#be123c'
                        }}>{statusFilter}</Text>
                        {' '}events only
                      </Text>
                      <TouchableOpacity
                        onPress={() => setStatusFilter(null)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#dcfce7' }}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="close" size={14} color="#166534" />
                        <Text style={{ fontSize: 12, fontWeight: '800', color: '#166534' }}>Clear</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {eventProjectSections.map(renderEventProjectSection)}
                  {statusFilter && eventProjectSections.every(s =>
                    s.events.filter(e => getProjectDisplayStatus(e) === statusFilter).length === 0
                  ) ? (
                    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                      <MaterialIcons name="search-off" size={36} color="#94a3b8" />
                      <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '700', color: '#64748b' }}>No {statusFilter} events</Text>
                      <Text style={{ marginTop: 4, fontSize: 13, color: '#94a3b8' }}>No events match this status filter.</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <View style={styles.programSuiteEmptyState}>
                  <MaterialIcons name="event-busy" size={32} color="#94a3b8" />
                  <Text style={styles.programSuiteEmptyTitle}>No events yet</Text>
                  <Text style={styles.programSuiteEmptyMeta}>
                    Create an event from a project and it will appear here.
                  </Text>
                </View>
              )}

              <View
                style={[
                  styles.programSuiteSchedulerCard,
                  styles.compactCalendarCard,
                  !isDesktop && styles.programSuiteSchedulerCardStacked,
                ]}
              >
                <View
                  style={[
                    styles.programSuiteSchedulerAgendaPane,
                    styles.compactCalendarAgendaPane,
                    !isDesktop && styles.programSuiteSchedulerAgendaPaneStacked,
                  ]}
                >
                  <Text style={styles.programSuiteSchedulerAgendaTitle}>Events</Text>
                  <Text style={styles.programSuiteSchedulerAgendaMeta}>
                    Calendar based on each event start date.
                  </Text>

                  <View style={styles.programSuiteSchedulerControls}>
                    <Text style={styles.programSuiteSchedulerRange}>{schedulerRangeLabel}</Text>
                  </View>

                  {schedulerFeaturedEvents.length ? (
                    schedulerFeaturedEvents.slice(0, 8).map(event => (
                      <TouchableOpacity
                        key={`featured-event-${event.id}`}
                        style={styles.programSuiteSchedulerAgendaRow}
                        onPress={() => {
                          void handleSelectProject(event);
                        }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.programSuiteSchedulerAgendaName} numberOfLines={1}>
                          {event.title}
                        </Text>
                        <Text style={styles.programSuiteSchedulerAgendaDate}>
                          {formatCalendarItemDateRange(event.startDate, event.endDate)}
                        </Text>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={styles.programSuiteSchedulerAgendaEmpty}>No events yet.</Text>
                  )}
                </View>

                <View
                  style={[
                    styles.programSuiteSchedulerMonthPane,
                    styles.compactCalendarMonthPane,
                    !isDesktop && styles.programSuiteSchedulerMonthPaneStacked,
                  ]}
                >
                  <View style={styles.programSuiteSchedulerMonthTopRow}>
                    <View>
                      <Text style={styles.programSuiteSchedulerTodayLabel}>Event Calendar</Text>
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

                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={[styles.schedulerCalendarWrap, styles.compactSchedulerCalendarWrap]}>
                      <View style={styles.schedulerCalendarHeaderRow}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(dayLabel => (
                          <Text key={`event-${dayLabel}`} style={styles.schedulerCalendarHeaderCell}>
                            {dayLabel}
                          </Text>
                        ))}
                      </View>

                      {schedulerCalendarWeeks.map((week, weekIndex) => (
                        <View key={`event-week-${weekIndex}`} style={styles.schedulerCalendarWeekRow}>
                          {week.map(day => {
                            const isCurrentMonth = day.getMonth() === schedulerAnchorDate.getMonth();
                            const isToday = isSameCalendarDay(day, currentDate);
                            const dayEvents = schedulerEventsByDate.get(getDateKey(day)) || [];
                            return (
                              <View
                                key={`event-${day.toISOString()}`}
                                style={[
                                  styles.schedulerCalendarDayCell,
                                  styles.compactSchedulerCalendarDayCell,
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
                                </View>

                                {dayEvents.length ? (
                                  dayEvents.slice(0, 2).map(event => (
                                    <TouchableOpacity
                                      key={`calendar-event-${event.id}`}
                                      style={[styles.schedulerCalendarProjectPill, styles.schedulerCalendarEventPill]}
                                      onPress={() => {
                                        void handleSelectProject(event);
                                      }}
                                      activeOpacity={0.85}
                                    >
                                      <Text style={[styles.schedulerCalendarProjectTitle, styles.schedulerCalendarEventTitle]} numberOfLines={1}>
                                        {event.title}
                                      </Text>
                                    </TouchableOpacity>
                                  ))
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>

            </View>
          )}
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
      {renderProgramWebDetailsModal()}
    </ScrollView>
    {renderProjectEditorModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eef4f1',
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
  },
  detailsHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbe7df',
    backgroundColor: '#f8fcfa',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  detailsBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d6e4db',
    backgroundColor: '#ffffff',
  },
  detailsBackButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  detailsHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  detailsHeaderEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  detailsHeaderTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailsHeaderMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: '#475569',
  },
  detailsHeaderStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  detailsHeaderStatusText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  lifecycleHero: {
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
    minWidth: 84,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  lifecycleStatPillActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  lifecycleStatPillInProgress: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  lifecycleStatPillActiveInProgress: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  lifecycleStatPillPlanning: {
    backgroundColor: '#fefce8',
    borderColor: '#fde68a',
  },
  lifecycleStatPillActivePlanning: {
    backgroundColor: '#b45309',
    borderColor: '#b45309',
  },
  lifecycleStatPillEvents: {
    backgroundColor: '#fdf4ff',
    borderColor: '#e9d5ff',
  },
  lifecycleStatPillActiveEvents: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  lifecycleStatPillCompleted: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  lifecycleStatPillActiveCompleted: {
    backgroundColor: '#15803d',
    borderColor: '#15803d',
  },
  lifecycleStatPillCancelled: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  lifecycleStatPillActiveCancelled: {
    backgroundColor: '#be123c',
    borderColor: '#be123c',
  },
  lifecycleStatValue: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    color: '#14532d',
  },
  lifecycleStatValueActive: { color: '#ffffff' },
  lifecycleStatValueInProgress: { color: '#1d4ed8' },
  lifecycleStatValueActiveInProgress: { color: '#ffffff' },
  lifecycleStatValuePlanning: { color: '#b45309' },
  lifecycleStatValueActivePlanning: { color: '#ffffff' },
  lifecycleStatValueEvents: { color: '#7c3aed' },
  lifecycleStatValueActiveEvents: { color: '#ffffff' },
  lifecycleStatValueCompleted: { color: '#15803d' },
  lifecycleStatValueActiveCompleted: { color: '#ffffff' },
  lifecycleStatValueCancelled: { color: '#be123c' },
  lifecycleStatValueActiveCancelled: { color: '#ffffff' },
  lifecycleStatLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#166534',
    fontWeight: '700',
  },
  lifecycleStatLabelActive: { color: '#bbf7d0' },
  lifecycleStatLabelInProgress: { color: '#1d4ed8' },
  lifecycleStatLabelActiveInProgress: { color: '#bfdbfe' },
  lifecycleStatLabelPlanning: { color: '#b45309' },
  lifecycleStatLabelActivePlanning: { color: '#fde68a' },
  lifecycleStatLabelEvents: { color: '#7c3aed' },
  lifecycleStatLabelActiveEvents: { color: '#e9d5ff' },
  lifecycleStatLabelCompleted: { color: '#15803d' },
  lifecycleStatLabelActiveCompleted: { color: '#bbf7d0' },
  lifecycleStatLabelCancelled: { color: '#be123c' },
  lifecycleStatLabelActiveCancelled: { color: '#fecdd3' },
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
  programSuiteStack: {
    gap: 20,
    marginBottom: 20,
  },
  programSuiteSection: {
    gap: 0,
  },
  programSuiteHeaderCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    overflow: 'hidden',
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
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  programSuiteTitleWrap: {
    flex: 1,
    gap: 4,
  },
  programSuiteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  programWebEyebrow: {
    marginTop: 4,
    marginBottom: 6,
    fontSize: 11,
    fontWeight: '900',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  programWebAbout: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
    fontWeight: '600',
  },
  programWebHighlightRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    marginBottom: 10,
  },
  programWebHighlightChip: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  programWebHighlightText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  programWebSourceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  programWebSourceText: {
    fontSize: 12,
    fontWeight: '900',
  },
  programWebsiteCardChrome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(203,213,225,0.7)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  programWebsiteCardDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#cbd5e1',
  },
  programWebsiteCardUrl: {
    flex: 1,
    marginLeft: 4,
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
  },
  programWebsiteCardHero: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  programWebsiteCardIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  programWebsiteCardHeroCopy: {
    flex: 1,
  },
  programWebsiteCardKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#64748b',
    marginBottom: 3,
  },
  programWebsiteCardTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 4,
  },
  programWebsiteCardLead: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#334155',
  },
  programWebsiteCardMetrics: {
    flexDirection: 'row',
    gap: 8,
  },
  programWebsiteCardMetric: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(203,213,225,0.68)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  programWebsiteCardMetricValue: {
    fontSize: 14,
    fontWeight: '900',
  },
  programWebsiteCardMetricLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
  },
  programWebsiteCardFeatureGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  programWebsiteCardFeature: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(203,213,225,0.68)',
    borderRadius: 12,
    padding: 10,
    minHeight: 78,
  },
  programWebsiteCardFeatureTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 4,
  },
  programWebsiteCardFeatureText: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
    color: '#64748b',
  },
  programWebsiteCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(203,213,225,0.68)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  programWebsiteCardFooterText: {
    fontSize: 12,
    fontWeight: '900',
  },
  programWebModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
    justifyContent: 'center',
    padding: Platform.select({ web: 24, default: 14 }),
  },
  programWebInlineCard: {
    marginTop: 18,
    marginBottom: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 4,
  },
  programWebInlineBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  programWebInlineBackText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  programWebModalCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 900,
    maxHeight: '92%',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 10,
  },
  programWebModalHero: {
    padding: Platform.select({ web: 28, default: 20 }),
  },
  programWebModalHeroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  programWebModalBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  programWebModalBrandText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  programWebModalBrandSubtext: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  programWebModalIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  programWebModalClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  programWebModalEyebrow: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  programWebModalNav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  programWebModalNavItem: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    overflow: 'hidden',
  },
  programWebModalTitle: {
    color: '#ffffff',
    fontSize: Platform.select({ web: 38, default: 28 }),
    lineHeight: Platform.select({ web: 44, default: 34 }),
    fontWeight: '900',
    marginBottom: 10,
  },
  programWebModalHeroText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
  },
  programWebModalHeroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 20,
  },
  programWebModalHeroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  programWebModalHeroStatValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  programWebModalHeroStatLabel: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '800',
  },
  programWebModalScroll: {
    maxHeight: Platform.select({ web: 500, default: 420 }),
  },
  programWebModalContent: {
    padding: Platform.select({ web: 24, default: 16 }),
    gap: 18,
  },
  programWebModalSection: {
    gap: 10,
  },
  programWebModalIntroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  programWebModalIntroMain: {
    flex: 2,
    minWidth: 260,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  programWebModalIntroTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    color: '#0f172a',
  },
  programWebModalAsideCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  programWebModalAsideLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  programWebModalAsideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  programWebModalAsideDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  programWebModalAsideText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  programWebModalSectionLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  programWebModalBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#334155',
    fontWeight: '600',
  },
  programWebModalStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  programWebModalStatCard: {
    flexGrow: 1,
    flexBasis: Platform.select({ web: '30%', default: '45%' }) as any,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 14,
  },
  programWebModalStatValue: {
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 4,
  },
  programWebModalStatLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    color: '#64748b',
  },
  programWebModalChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  programWebModalChip: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  programWebModalChipText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#334155',
  },
  programWebModalDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  programWebModalDetailCard: {
    flexGrow: 1,
    flexBasis: Platform.select({ web: '45%', default: '100%' }) as any,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 14,
  },
  programWebModalDetailIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  programWebModalDetailTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 5,
  },
  programWebModalDetailText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
    fontWeight: '600',
  },
  programWebModalWorkflow: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  programWebModalWorkflowRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  programWebModalWorkflowNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  programWebModalWorkflowNumberText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  programWebModalWorkflowCopy: {
    flex: 1,
  },
  programWebModalWorkflowTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
  },
  programWebModalWorkflowText: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: '#64748b',
  },
  programWebModalLinkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 11,
  },
  programWebModalLinkedIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  programWebModalLinkedTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
  },
  programWebModalLinkedMeta: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
    marginTop: 2,
  },
  programWebModalEmptyPanel: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 16,
  },
  programWebModalEmptyTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 4,
  },
  programWebModalEmptyText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
    fontWeight: '600',
  },
  programWebModalActions: {
    flexDirection: 'row',
    gap: 10,
    padding: Platform.select({ web: 18, default: 14 }),
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  programWebModalSecondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  programWebModalSecondaryText: {
    color: '#166534',
    fontWeight: '900',
    fontSize: 12,
  },
  programWebModalPrimaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  programWebModalPrimaryText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 12,
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
    minWidth: 90,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  programSuiteMetricValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  programSuiteMetricLabel: {
    marginTop: 2,
    fontSize: 10,
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
  screenShell: {
    flex: 1,
    position: 'relative',
  },
  taskSaveToastOverlay: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    zIndex: 50,
    elevation: 12,
  },
  taskSaveNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  taskSaveNoticeText: {
    flex: 1,
    color: '#14532d',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  taskSaveNoticeButton: {
    backgroundColor: '#166534',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  taskSaveNoticeButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
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
  compactCalendarCard: {
    maxWidth: 980,
    alignSelf: 'stretch',
  },
  programSuiteSchedulerCardStacked: {
    flexDirection: 'column',
  },
  programSuiteSchedulerAgendaPane: {
    width: '35%',
    minWidth: 260,
    backgroundColor: '#2f8f45',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  compactCalendarAgendaPane: {
    width: '30%',
    minWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  programSuiteSchedulerAgendaPaneStacked: {
    width: '100%',
    minWidth: 0,
  },
  programSuiteSchedulerAgendaTitle: {
    color: '#f1fff4',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 5,
  },
  programSuiteSchedulerAgendaMeta: {
    color: '#d6f8de',
    fontSize: 11,
    lineHeight: 16,
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
  compactCalendarMonthPane: {
    padding: 10,
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
  eventProjectBox: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  programProjectBox: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  eventProjectBoxHeaderCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventProjectBoxIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventProjectDivider: {
    height: 1,
    backgroundColor: '#dcfce7',
  },
  eventBoxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  projectBoxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  projectBox: {
    width: 200,
    minHeight: 130,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    padding: 10,
    gap: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  projectBoxEnded: {
    opacity: 0.5,
  },
  eventBox: {
    width: 200,
    minHeight: 130,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: '#ffffff',
    padding: 10,
    gap: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  eventBoxEnded: {
    opacity: 0.5,
  },
  eventBoxTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventBoxIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#ccfbf1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventBoxStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  eventBoxStatusPill: {
    minWidth: 82,
    maxWidth: 112,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventBoxStatusPillText: {
    color: '#ffffff',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '900',
  },
  eventBoxTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  eventBoxDate: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: '#0f766e',
  },
  eventBoxMeta: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '700',
  },
  eventBoxActions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 'auto',
  },
  eventBoxActionButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 250,
  },
  cardMobile: {
    width: '48%',
    maxWidth: '48%',
    flexShrink: 0,
    minHeight: 240,
  },
  cardImage: {
    width: '100%',
    height: 80,
    backgroundColor: '#dbe4ea',
  },
  cardEnded: {
    opacity: 0.6,
  },
  cardImageEnded: {
    opacity: 0.4,
  },
  cardBody: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 8,
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
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  infoRowLeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRowCopy: {
    flex: 1,
  },
  infoRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2b2f42',
    lineHeight: 18,
  },
  infoRowSubtitle: {
    marginTop: 2,
    fontSize: 11,
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
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  projectEventPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  projectEventPanelCopy: {
    flex: 1,
    gap: 2,
  },
  projectEventPanelTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectEventPanelMeta: {
    fontSize: 11,
    lineHeight: 16,
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
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#97a8b8',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  projectEventListItemCopy: {
    flex: 1,
    gap: 2,
  },
  projectEventListItemTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectEventListItemMeta: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 15,
  },
  projectEventListItemSummary: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 15,
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
    gap: 18,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  projectCardWrap: {
    position: 'relative',
    flexShrink: 0,
  },
  projectCardWrapDesktop: {
    width: '48.8%',
  },
  projectCardWrapMobile: {
    width: '48%',
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
    backgroundColor: '#fcfdfc',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#9fb4a6',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  detailsHero: {
    backgroundColor: '#f4fbf6',
    borderWidth: 1,
    borderColor: '#98b5a3',
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
  },
  detailsHeroHeader: {
    gap: 10,
    marginBottom: 12,
  },
  detailsHeroCopy: {
    gap: 6,
  },
  detailsHeroHighlights: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  detailsHeroHighlight: {
    minWidth: 160,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#9fb4a6',
    backgroundColor: '#ffffff',
  },
  detailsHeroHighlightIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
  },
  detailsHeroHighlightCopy: {
    flex: 1,
    gap: 2,
  },
  detailsHeroHighlightLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailsHeroHighlightValue: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    color: '#0f172a',
  },
  detailsMediaPanel: {
    marginBottom: 20,
    gap: 16,
  },
  detailsMediaPanelDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  detailsMediaPreviewWrap: {
    width: '100%',
  },
  detailsMediaPreviewWrapDesktop: {
    flex: 1.1,
  },
  detailsMediaPreview: {
    width: '100%',
    height: 260,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#93a8bd',
    backgroundColor: '#dbeafe',
  },
  detailsMediaEmptyState: {
    height: 220,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#8eabc8',
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
  detailsMediaCopyDesktop: {
    flex: 0.9,
    justifyContent: 'center',
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
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  detailsTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 28,
  },
  detailsSubtitle: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
  },
  detailsHeroStatus: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#9fb4a6',
    paddingHorizontal: 16,
    paddingVertical: 16,
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
    backgroundColor: '#f8fbf9',
    borderWidth: 1,
    borderColor: '#9fb4a6',
    borderRadius: 24,
    padding: 20,
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
    fontSize: 19,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  sectionHeaderClickable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  sectionHint: {
    fontSize: 13,
    color: '#5b6b7f',
    lineHeight: 20,
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#a5b7ad',
    paddingHorizontal: 15,
    paddingVertical: 15,
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
  attendanceCardGrid: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  attendanceDatePickerRow: {
    gap: 8,
    paddingBottom: 4,
    paddingRight: 8,
  },
  attendanceDatePickerContainer: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    padding: 12,
  },
  attendanceDatePickerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  attendanceDatePickerWrapper: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  attendanceDatePicker: {
    color: '#0f172a',
    fontSize: 14,
    paddingHorizontal: 10,
    minHeight: 44,
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
  attendanceCheckerList: {
    gap: 12,
    marginTop: 14,
  },
  attendanceCheckerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#b8cabc',
    padding: 14,
    gap: 10,
  },
  attendanceCheckerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  attendanceCheckerCopy: {
    flex: 1,
  },
  attendanceCheckerMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  attendanceCheckerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  attendanceCheckerSecondaryButton: {
    minWidth: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceCheckerSecondaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  attendanceCheckerPrimaryButton: {
    minWidth: 150,
    borderRadius: 12,
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceCheckerPrimaryButtonChecked: {
    backgroundColor: '#0f766e',
  },
  attendanceCheckerPrimaryButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  attendanceCheckerPrimaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  attendanceCardCompact: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 14,
    minHeight: 180,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  attendanceCardCompactDesktop: {
    width: 260,
    flexGrow: 0,
    flexShrink: 0,
  },
  attendanceCardCompactMobile: {
    width: '100%',
  },
  attendanceCardCompactTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
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
  attendanceMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    marginBottom: 6,
  },
  attendanceMetricChip: {
    minWidth: 82,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attendanceMetricValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  attendanceMetricLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  attendanceCardCompactFooter: {
    marginTop: 'auto',
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attendanceCardCompactHint: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
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
  expandedTaskList: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 2,
  },
  taskListItem: {
    padding: 14,
    backgroundColor: '#ffffff',
  },
  taskListItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  taskListItemHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  taskListItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  taskListItemMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  taskListItemDescription: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 10,
  },
  taskListItemAssignment: {
    marginTop: 10,
    marginBottom: 10,
  },
  taskListItemAssignmentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 8,
  },
  assignedVolunteersList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  assignedVolunteerChip: {
    backgroundColor: '#dbeafe',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#0284c7',
  },
  assignedVolunteerChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0c4a6e',
  },
  unassignedText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  taskFieldOfficerNote: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ea580c',
    marginTop: 8,
    marginBottom: 8,
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
  volunteersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  volunteerCompactCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 10,
    minWidth: 200,
    flex: 1,
    maxWidth: '48%',
  },
  volunteerCompactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  volunteerBadgesCompact: {
    flexDirection: 'row',
    gap: 4,
  },
  volunteerMetaSmall: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
  },
  completeVolunteerButtonSmall: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#166534',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  completeVolunteerButtonTextSmall: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  viewVolunteerProfileButtonSmall: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  viewVolunteerProfileTextSmall: {
    color: '#2563eb',
    fontSize: 11,
    fontWeight: '600',
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
  applicationHeaderToggle: {
    paddingVertical: 8,
  },
  applicationHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  compactSchedulerCalendarWrap: {
    minWidth: 620,
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
  compactSchedulerCalendarDayCell: {
    minHeight: 66,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 3,
    borderRadius: 7,
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
  schedulerCalendarEventPill: {
    backgroundColor: '#ccfbf1',
    borderColor: '#99f6e4',
  },
  schedulerCalendarEventTitle: {
    color: '#0f766e',
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
  taskSuccessContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  taskSuccessCard: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 34,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  taskSuccessTitle: {
    marginTop: 18,
    fontSize: 24,
    fontWeight: '900',
    color: '#102118',
    textAlign: 'center',
  },
  taskSuccessMessage: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'center',
  },
  taskSuccessButton: {
    marginTop: 26,
    backgroundColor: '#166534',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 42,
  },
  taskSuccessButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
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
  attendanceModalCard: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
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
    overflow: 'hidden',
  },
  attendanceModalLiveNote: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  attendanceModalScroll: {
    maxHeight: Platform.select({ web: 520, default: 480 }),
    overflow: 'hidden',
  },
  attendanceModalScrollContent: {
    paddingBottom: 4,
  },
  attendanceModalStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  attendanceModalStatCard: {
    flex: 1,
    minWidth: 140,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  attendanceDateDropdownMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attendanceDateDropdownText: {
    fontSize: 14,
    color: '#0f172a',
    flex: 1,
    marginRight: 8,
  },
  attendancePickerModalCard: {
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
  attendancePickerModalBody: {
    gap: 12,
    paddingTop: 6,
  },
  taskBoardModalCard: {
    width: '100%',
    maxWidth: 820,
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
  taskBoardModalScroll: {
    maxHeight: Platform.select({ web: 680, default: 520 }),
  },
  taskBoardModalScrollContent: {
    paddingBottom: 12,
  },
  modalPrimaryButton: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#166534',
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalPrimaryButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  attendanceModalStatValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  attendanceModalStatLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  attendanceModalSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  attendanceRecordRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  attendanceRecordTimeline: {
    gap: 4,
  },
  attendanceRecordLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  attendanceRecordValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 20,
  },
  attendanceRecordPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eff6ff',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  attendanceRecordPhotoButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#164e63',
  },
  attendanceImagePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  attendanceImagePreviewCard: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
  },
  attendanceImagePreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  attendanceImagePreviewClose: {
    padding: 8,
  },
  attendanceImagePreview: {
    width: '100%',
    height: 420,
    backgroundColor: '#f8fafc',
  },
  attendanceRecordPhoto: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },
  attendanceRecordCheckButton: {
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceRecordCheckButtonActive: {
    backgroundColor: '#0f766e',
  },
  attendanceRecordCheckButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
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
  projectDocumentButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  projectDocumentButtonText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '800',
  },
  projectDocumentCard: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  projectDocumentMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectDocumentName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  projectDocumentRemoveText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '800',
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
  locationVenueInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#fff',
    marginBottom: 10,
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







const programWebStyles = StyleSheet.create({
  // Modal backdrop
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 12,
  },
  backdropDesktop: {
    paddingTop: 28,
    paddingRight: 32,
    paddingBottom: 28,
    paddingLeft: 232,
  },
  window: {
    width: '100%',
    height: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 16,
  },
  // Browser chrome
  browserBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  browserDots: {
    flexDirection: 'row',
    gap: 6,
  },
  browserDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  browserAddressBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  browserUrl: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    fontFamily: 'monospace',
  },
  browserClose: {
    padding: 4,
  },
  // Page scroll
  pageScroll: {
    flex: 1,
  },
  // Navbar
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  navLogo: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBrandText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  navBrandSep: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  navBrandSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  navLinks: {
    flexDirection: 'row',
    gap: 18,
  },
  navLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  navCta: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  navCtaText: {
    fontSize: 12,
    fontWeight: '800',
  },
  // Hero
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
    gap: 24,
  },
  heroContent: {
    flex: 1,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: '#ffffff',
    marginBottom: 12,
    lineHeight: 42,
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 24,
  },
  heroStats: {
    flexDirection: 'row',
    gap: 20,
  },
  heroStat: {
    alignItems: 'center',
    gap: 4,
  },
  heroStatValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
  },
  heroStatLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },
  heroIconWrap: {
    width: 120,
    height: 120,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sections
  section: {
    paddingHorizontal: 32,
    paddingVertical: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 20,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  // Intro grid
  introGrid: {
    flexDirection: 'row',
    gap: 24,
    flexWrap: 'wrap',
  },
  introMain: {
    flex: 2,
    minWidth: 240,
    gap: 12,
  },
  introTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 28,
    marginBottom: 8,
  },
  asideCard: {
    flex: 1,
    minWidth: 180,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  asideLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  asideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  asideDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  asideText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  // Services
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  serviceCard: {
    flexBasis: 200,
    flexGrow: 1,
    borderTopWidth: 3,
    borderRadius: 10,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  serviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  serviceTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  serviceText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  // Workflow
  workflowList: {
    gap: 16,
  },
  workflowRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  workflowNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  workflowNumText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
  },
  workflowCopy: {
    flex: 1,
    paddingTop: 4,
  },
  workflowTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  workflowText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  // Impact
  impactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  impactCard: {
    flexBasis: 160,
    flexGrow: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  impactValue: {
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 4,
  },
  impactLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    textAlign: 'center',
  },
  // Projects list
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  projectRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  projectRowMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  projectRowBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  projectRowBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  // Empty state
  emptyPanel: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    maxWidth: 320,
  },
  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 20,
    gap: 12,
  },
  footerText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  footerSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  footerSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  footerPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  footerPrimaryText: {
    fontSize: 13,
    fontWeight: '800',
  },
});

const projectEditorStyles = StyleSheet.create({
  // Web: keep the editor inside the content area so the left navigation remains usable.
  webOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 100,
  },
  // Mobile: full-screen overlay via Modal
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  overlayDismiss: {
    flex: 1,
  },
  drawer: {
    width: '55%',
    minWidth: 680,
    maxWidth: 960,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
});
