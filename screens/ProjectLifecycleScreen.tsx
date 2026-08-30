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

  ImageBackground,

  ActivityIndicator,

  Platform,

  useWindowDimensions,

  Linking,

} from 'react-native';

import { Picker } from '@react-native-picker/picker';

import { MaterialIcons } from '@expo/vector-icons';

import Svg, { Path, Circle } from 'react-native-svg';

import CalendarDatePicker from '../components/CalendarDatePicker';

import { loadGoogleMaps } from '../utils/webGoogleMaps';

import ProjectTimelineCalendarCard from '../components/ProjectTimelineCalendarCard';

import { useFocusEffect } from '@react-navigation/native';

import InlineLoadError from '../components/InlineLoadError';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { TASK_SKILL_OPTIONS } from '../utils/skills';
import { getActiveProjectGroupJoinCount } from '../utils/projectVolunteers';

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

  AdminPlanningCalendar,

  AdminPlanningItem,

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

  saveVolunteerProjectMatch,

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

  getAllAdminPlanningCalendars,

  getAllAdminPlanningItems,

  getStorageItem,

  setStorageItem,

  setVolunteerAttendanceChecked,

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

import { getAttachmentLabel, getPrimaryReportMediaUri, isImageMediaUri, openAttachmentUri, pickDocumentFromDevice, pickImageFromDevice } from '../utils/media';

import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { formatProjectLocation } from '../utils/locationFormat';

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



const statuses: Project['status'][] = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];

const lifecycleStatusModes = ['System', 'Manual'] as const;

type LifecycleStatusMode = (typeof lifecycleStatusModes)[number];

type ProgramSuiteModule = string;

type ProgramSuiteView = 'programs' | 'projects' | 'events';

type ProjectsSortKey = 'recentlyUpdated' | 'projectName' | 'newestSchedule' | 'oldestSchedule';

type EventNotificationSetting = {
  type: 'Notification' | 'Email';
  value: string;
  unit: 'minutes' | 'hours' | 'days';
};

const PROJECTS_SORT_OPTIONS: Array<{ key: ProjectsSortKey; label: string }> = [
  { key: 'recentlyUpdated', label: 'Recently Updated' },
  { key: 'projectName', label: 'Project Name' },
  { key: 'newestSchedule', label: 'Newest Schedule' },
  { key: 'oldestSchedule', label: 'Oldest Schedule' },
];



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

    if (activeProgramTrackIds.has(programId)) {

      return programId;

    }

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

  if (project.parentProjectId && activeProgramTracks.length === 1) {

    return String(activeProgramTracks[0].id).trim();

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

  volunteerRequirements: string[];

  communityNeed: string;

  expectedDeliverables: string;

  attachmentUrl: string;

  isEvent: boolean;

};



type ProjectVolunteerEntry = {

  id: string;

  userId?: string;

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

  volunteersNeeded: string;

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



function getTaskAssignedVolunteerIds(task: ProjectInternalTask, volunteersList?: Volunteer[]): string[] {
  const rawIds = Array.from(
    new Set(
      [
        ...(Array.isArray(task.assignedVolunteerIds) ? task.assignedVolunteerIds : []),
        task.assignedVolunteerId,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  );

  if (!volunteersList || volunteersList.length === 0) {
    return rawIds;
  }

  const idMap = new Map<string, string>();
  volunteersList.forEach(v => {
    const canonical = v.userId || v.id;
    if (canonical) {
      if (v.id) idMap.set(v.id, canonical);
      if (v.userId) idMap.set(v.userId, canonical);
    }
  });

  const canonicalSet = new Set<string>();
  rawIds.forEach(id => {
    canonicalSet.add(idMap.get(id) || id);
  });

  return Array.from(canonicalSet);
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



function getMonthCalendarDaysMonday(sourceDate: Date): Date[] {

  const monthStart = new Date(sourceDate.getFullYear(), sourceDate.getMonth(), 1);

  const gridStart = getStartOfWeekMonday(monthStart);

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

  volunteerRequirements: [],

  communityNeed: '',

  expectedDeliverables: '',

  attachmentUrl: '',

  isEvent,

});



const createEmptyProjectTaskDraft = (): ProjectTaskDraft => ({

  title: '',

  description: '',

  category: 'General',

  volunteersNeeded: '1',

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



function getProgramWebOverview(programTitle: string): {

  about: string;

  highlights: { title: string; description: string }[];

} {

  const key = programTitle.trim().toLowerCase();



  if (key.includes('education')) {

    return {

      about:

        'NVC education programs improve schooling for children from poor communities through school supplies, learning infrastructure, teacher support, and classroom resources.',

      highlights: [

        {

          title: 'LoveBags',

          description: 'School bags and supplies prepared for children who need support to start or continue school.',

        },

        {

          title: 'School Support',

          description: 'Classroom resources, learning infrastructure, and practical help for public schools and teachers.',

        },

        {

          title: 'School supplies and tools',

          description: 'Education materials that help students participate in daily lessons with fewer barriers.',

        },

      ],

    };

  }



  if (key.includes('nutrition')) {

    return {

      about:

        'NVC nutrition programs source from local farmers and produce nutritious food, including Mingo meals, to support undernourished children and emergency feeding needs.',

      highlights: [

        {

          title: 'Mingo for Nutritional Support',

          description: 'Mingo meals made from rice, mung bean, and moringa help support undernourished children.',

        },

        {

          title: 'Farm to Fork Program',

          description: 'Local farmers supply produce used for nutrition work, connecting food security with farmer income.',

        },

        {

          title: 'Emergency Relief',

          description: 'Convenient nutritious food support for disaster response and urgent feeding operations.',

        },

        {

          title: 'Mingo Parties',

          description: 'Community giving activities that turn shared meals into nutrition support for children.',

        },

      ],

    };

  }



  if (key.includes('livelihood')) {

    return {

      about:

        'NVC livelihood programs help families improve income by creating earning opportunities for artisans, skilled workers, growers, and fisherfolk.',

      highlights: [

        {

          title: 'Artisans of Hope',

          description: 'Handmade products and production opportunities that provide artisans with income.',

        },

        {

          title: 'Project Joseph',

          description: 'Tools and practical support that help skilled workers earn from their trade.',

        },

        {

          title: 'Growing Hope',

          description: 'Community gardens that support food security and create income from excess harvests.',

        },

        {

          title: 'Peter Project',

          description: 'Support for fisherfolk, including boats and market pathways for their catch.',

        },

      ],

    };

  }



  if (key.includes('disaster')) {

    return {

      about:

        'Disaster response programs coordinate relief, recovery, and volunteer support for communities affected by emergencies and severe weather events.',

      highlights: [

        {

          title: 'Relief operations',

          description: 'Organized support for communities affected by severe weather, emergencies, or urgent needs.',

        },

        {

          title: 'Volunteer mobilization',

          description: 'Rapid coordination of volunteers, field assignments, and operational support.',

        },

        {

          title: 'Community recovery',

          description: 'Follow-through assistance for communities after the immediate emergency response.',

        },

      ],

    };

  }



  return {

    about: '',

    highlights: [],

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



function getProjectSortTimestamp(value?: string): number {

  const timestamp = new Date(value || '').getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;

}



function compareProjectsForSort(left: Project, right: Project, sortKey: ProjectsSortKey): number {

  switch (sortKey) {

    case 'projectName':

      return left.title.localeCompare(right.title) || getProjectSortTimestamp(right.updatedAt) - getProjectSortTimestamp(left.updatedAt);

    case 'newestSchedule':

      return getProjectSortTimestamp(right.startDate) - getProjectSortTimestamp(left.startDate) || left.title.localeCompare(right.title);

    case 'oldestSchedule':

      return getProjectSortTimestamp(left.startDate) - getProjectSortTimestamp(right.startDate) || left.title.localeCompare(right.title);

    case 'recentlyUpdated':

    default:

      return getProjectSortTimestamp(right.updatedAt || right.createdAt || right.startDate) -

        getProjectSortTimestamp(left.updatedAt || left.createdAt || left.startDate) ||

        left.title.localeCompare(right.title);

  }

}



function normalizeExternalUrl(value: string): string {

  const trimmedValue = value.trim();

  if (!trimmedValue) {

    return '';

  }

  if (/^https?:\/\//i.test(trimmedValue)) {

    return trimmedValue;

  }

  return `https://${trimmedValue}`;

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

  barangayCode: string;

} {

  if (!project) {

    return { regionCode: '', cityCode: '', barangayCode: '' };

  }



  const parsedSelection = parsePhilippineAddressSelection(project.location?.address || '');

  if (parsedSelection.regionCode && parsedSelection.cityCode) {

    return {

      regionCode: parsedSelection.regionCode,

      cityCode: parsedSelection.cityCode,

      barangayCode: parsedSelection.barangayCode,

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

      barangayCode: parsedSelection.barangayCode,

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

    barangayCode: parsedSelection.barangayCode,

  };

}





interface CustomToggleProps {

  value: boolean;

  onValueChange: (val: boolean) => void;

  label: string;

}



const CustomToggle = ({ value, onValueChange, label }: CustomToggleProps) => {

  return (

    <TouchableOpacity

      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 }}

      onPress={() => onValueChange(!value)}

      activeOpacity={0.8}

    >

      <View style={{

        width: 44,

        height: 24,

        borderRadius: 12,

        backgroundColor: value ? '#166534' : '#cbd5e1',

        padding: 2,

        justifyContent: 'center',

        alignItems: value ? 'flex-end' : 'flex-start',

      }}>

        <View style={{

          width: 20,

          height: 20,

          borderRadius: 10,

          backgroundColor: '#fff',

          shadowColor: '#000',

          shadowOffset: { width: 0, height: 1 },

          shadowOpacity: 0.2,

          shadowRadius: 1.5,

          elevation: 2,

        }} />

      </View>

      <Text style={{ fontSize: 13, fontWeight: '600', color: '#475569' }}>{label}</Text>

    </TouchableOpacity>

  );

};



interface FieldRowProps {

  children: React.ReactNode;

  isDesktop: boolean;

}



const FieldRow = ({ children, isDesktop }: FieldRowProps) => (

  <View style={{

    flexDirection: isDesktop ? 'row' : 'column',

    gap: 16,

    marginBottom: 12,

  }}>

    {children}

  </View>

);



interface FieldContainerProps {

  label: string;

  required?: boolean;

  children: React.ReactNode;

  flex?: number;

}



const FieldContainer = ({ label, required, children, flex = 1 }: FieldContainerProps) => (

  <View style={{ flex, gap: 6 }}>

    <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>

      {label} {required && <Text style={{ color: '#b91c1c' }}>*</Text>}

    </Text>

    {children}

  </View>

);



interface InlineProjectFormProps {

  projectDraft: any;

  handleProjectDraftChange: (key: any, value: any) => void;

  projectRegionCode: string;

  handleProjectRegionChange: (val: string) => void;

  projectCityCode: string;

  handleProjectCityChange: (val: string) => void;

  projectBarangayCode: string;

  handleProjectBarangayChange: (val: string) => void;

  projectPlaceVenue: string;

  setProjectPlaceVenue: (val: string) => void;

  PHRegions: any[];

  projectLocationCities: any[];

  projectLocationBarangays: any[];

  handlePickProjectImage: () => void;

  handleRemoveProjectImage: () => void;

  handlePickProjectDocument: () => void;

  applyProjectLocationSelectionFromAddress: (addr: string) => void;

  setDatePickerMode: (mode: 'startDate' | 'endDate' | 'applicationDeadline') => void;

  setSelectedDate: (d: Date) => void;

  setShowDatePicker: (show: boolean) => void;

  handleSaveProjectRecord: () => void;

  closeProjectModal: () => void;

  editingProjectId: string | null;

  projectSaveError: string | null;

  isDesktop: boolean;

  programSections: any[];

  format: any;

  handleSearchMapLocation: (query: string) => void;

  handleMarkerPositionChange: (lat: number, lng: number) => void;

}



const InlineProjectForm = React.memo(({

  projectDraft,

  handleProjectDraftChange,

  projectRegionCode,

  handleProjectRegionChange,

  projectCityCode,

  handleProjectCityChange,

  projectBarangayCode,

  handleProjectBarangayChange,

  projectPlaceVenue,

  setProjectPlaceVenue,

  PHRegions,

  projectLocationCities,

  projectLocationBarangays,

  handlePickProjectImage,

  handleRemoveProjectImage,

  handlePickProjectDocument,

  applyProjectLocationSelectionFromAddress,

  setDatePickerMode,

  setSelectedDate,

  setShowDatePicker,

  handleSaveProjectRecord,

  closeProjectModal,

  editingProjectId,

  projectSaveError,

  isDesktop,

  programSections,

  format,

  handleSearchMapLocation,

  handleMarkerPositionChange,

}: InlineProjectFormProps) => {

  const selectedLocationRegion = PHRegions.find(r => r.code === projectRegionCode);

  const selectedLocationCity = projectLocationCities.find(c => c.code === projectCityCode);

  const selectedLocationBarangay = projectLocationBarangays.find(b => b.code === projectBarangayCode);



  const mapPickerRef = React.useRef<HTMLDivElement | null>(null);

  const mapInstanceRef = React.useRef<any>(null);

  const markerRef = React.useRef<any>(null);



  React.useEffect(() => {

    if (Platform.OS !== 'web' || !mapPickerRef.current) return;



    let cancelled = false;



    const initMapPicker = async () => {

      try {

        const apiKey = process.env.GOOGLE_MAPS_WEB_API_KEY || process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || '';

        const googleMaps = await loadGoogleMaps(apiKey);

        if (cancelled || !mapPickerRef.current) return;



        const defaultLat = parseFloat(projectDraft.latitude) || 12.8797;

        const defaultLng = parseFloat(projectDraft.longitude) || 121.7740;



        const centerPos = { lat: defaultLat, lng: defaultLng };



        if (!mapInstanceRef.current) {

          mapInstanceRef.current = new googleMaps.maps.Map(mapPickerRef.current, {

            center: centerPos,

            zoom: projectDraft.latitude ? 15 : 6,

            mapTypeControl: false,

            streetViewControl: false,

            fullscreenControl: false,

            zoomControl: true,

          });



          markerRef.current = new googleMaps.maps.Marker({

            position: centerPos,

            map: mapInstanceRef.current,

            draggable: true,

            title: 'Drag to adjust project location',

          } as any);



          mapInstanceRef.current.addListener('click', (e: any) => {

            const clickedPos = e.latLng;

            markerRef.current.setPosition(clickedPos);

            handleMarkerPositionChange(clickedPos.lat(), clickedPos.lng());

          });



          markerRef.current.addListener('dragend', () => {

            const newPos = markerRef.current.getPosition();

            handleMarkerPositionChange(newPos.lat(), newPos.lng());

          });

        } else {

          const currentMarkerPos = markerRef.current.getPosition();

          if (Math.abs(currentMarkerPos.lat() - defaultLat) > 0.0001 || Math.abs(currentMarkerPos.lng() - defaultLng) > 0.0001) {

            const newPos = { lat: defaultLat, lng: defaultLng };

            markerRef.current.setPosition(newPos);

            mapInstanceRef.current.setCenter(newPos);

            if (projectDraft.latitude) {

              mapInstanceRef.current.setZoom(15);

            }

          }

        }

      } catch (err) {

        console.warn('Failed to load Google Maps for picker:', err);

      }

    };



    initMapPicker();



    return () => {

      cancelled = true;

    };

  }, [projectDraft.latitude, projectDraft.longitude]);



  const renderSectionHeader = (number: number, title: string, subtitle: string) => (

    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 16 }}>

      <View style={{

        width: 28,

        height: 28,

        borderRadius: 14,

        backgroundColor: '#166534',

        alignItems: 'center',

        justifyContent: 'center',

      }}>

        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{number}</Text>

      </View>

      <View style={{ flex: 1 }}>

        <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a' }}>{title}</Text>

        <Text style={{ fontSize: 12, color: '#64748b' }}>{subtitle}</Text>

      </View>

    </View>

  );



  const renderCoverImageUpload = () => {

    const hasImage = Boolean(projectDraft.imageUrl);

    return (

      <View style={{ gap: 6, marginVertical: 8 }}>

        <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Project Cover Image (Optional)</Text>

        {hasImage ? (

          <View style={{

            height: 140,

            borderRadius: 10,

            borderWidth: 1,

            borderColor: '#cbd5e1',

            overflow: 'hidden',

            position: 'relative',

          }}>

            <Image source={{ uri: projectDraft.imageUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />

            <TouchableOpacity

              onPress={handleRemoveProjectImage}

              style={{

                position: 'absolute',

                top: 8,

                right: 8,

                backgroundColor: '#b91c1c',

                borderRadius: 6,

                paddingVertical: 4,

                paddingHorizontal: 8,

              }}

            >

              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Remove</Text>

            </TouchableOpacity>

          </View>

        ) : (

          <TouchableOpacity

            onPress={handlePickProjectImage}

            style={{

              height: 100,

              borderRadius: 10,

              borderWidth: 1.5,

              borderColor: '#cbd5e1',

              borderStyle: 'dashed',

              backgroundColor: '#f8fafc',

              alignItems: 'center',

              justifyContent: 'center',

              gap: 6,

            }}

          >

            <MaterialIcons name="image" size={24} color="#64748b" />

            <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>Click or drag image to upload</Text>

            <Text style={{ fontSize: 11, color: '#94a3b8' }}>Recommended size: 1200 x 600px (JPG, PNG)</Text>

          </TouchableOpacity>

        )}

      </View>

    );

  };



  const inputStyle = {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingVertical: 8,

    paddingHorizontal: 12,

    fontSize: 14,

    color: '#1e293b',

    backgroundColor: '#fff',

    height: 42,

  };



  const pickerContainerStyle = {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    backgroundColor: '#fff',

    height: 42,

    justifyContent: 'center' as const,

  };



  const pickerStyle = {

    height: 40,

    color: '#1e293b',

  };



  const datePickerTriggerStyle = {

    flexDirection: 'row' as const,

    justifyContent: 'space-between' as const,

    alignItems: 'center' as const,

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingHorizontal: 12,

    backgroundColor: '#fff',

    height: 42,

  };



  const previewLocationText = [

    projectPlaceVenue,

    selectedLocationBarangay?.name,

    selectedLocationCity?.displayName,

    selectedLocationRegion?.name,

  ].filter(Boolean).join(', ') || '--';



  return (

    <View style={{

      backgroundColor: '#f8fafc',

      borderWidth: 1,

      borderColor: '#e2e8f0',

      borderRadius: 16,

      padding: 24,

      marginTop: 16,

      shadowColor: '#0f172a',

      shadowOffset: { width: 0, height: 4 },

      shadowOpacity: 0.05,

      shadowRadius: 12,

      elevation: 3,

    }}>

      {projectSaveError ? (

        <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, padding: 12, marginBottom: 16 }}>

          <Text style={{ color: '#b91c1c', fontSize: 13, fontWeight: '600' }}>{projectSaveError}</Text>

        </View>

      ) : null}



      <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: 32 }}>

        {/* Left Column: Input Form */}

        <View style={{ flex: 2.2, gap: 12 }}>

          {/* Section 1 */}

          {renderSectionHeader(1, '1. PROJECT INFORMATION', 'Basic information about your project.')}

          <FieldRow isDesktop={isDesktop}>

            <FieldContainer label="Project Name" required>

              <TextInput

                style={inputStyle}

                placeholder="e.g., Mingo Meals Program, Brgy. Alangilan"

                placeholderTextColor="#94a3b8"

                value={projectDraft.title}

                onChangeText={value => handleProjectDraftChange('title', value)}

              />

            </FieldContainer>

            <FieldContainer label="Program" required>

              <View style={pickerContainerStyle}>

                <Picker

                  selectedValue={projectDraft.program_id}

                  onValueChange={(itemValue: string) => {

                    handleProjectDraftChange('program_id', itemValue);

                    const matchedSection = programSections.find(s => s.module === itemValue);

                    const matchedTitle = matchedSection?.title || '';

                    const knownModules: AdvocacyFocus[] = ['Education', 'Livelihood', 'Nutrition', 'Disaster'];

                    let advocacyFocus: AdvocacyFocus = 'Education';

                    for (const module of knownModules) {

                      if (matchedTitle.toLowerCase().includes(module.toLowerCase()) || itemValue.toLowerCase().includes(module.toLowerCase())) {

                        advocacyFocus = module;

                        break;

                      }

                    }

                    handleProjectDraftChange('programModule', advocacyFocus);

                  }}

                  style={pickerStyle}

                >

                  {programSections.map(s => (

                    <Picker.Item key={s.module} label={s.title} value={s.module} />

                  ))}

                </Picker>

              </View>

            </FieldContainer>

          </FieldRow>



          <FieldRow isDesktop={isDesktop}>

            <FieldContainer label="Short Description" required>

              <TextInput

                style={[inputStyle, { minHeight: 80, height: 'auto', textAlignVertical: 'top', paddingVertical: 10 }]}

                placeholder="Briefly describe the project and its goals."

                placeholderTextColor="#94a3b8"

                multiline

                numberOfLines={3}

                value={projectDraft.description}

                onChangeText={value => handleProjectDraftChange('description', value)}

              />

            </FieldContainer>

          </FieldRow>



          {renderCoverImageUpload()}



          <FieldRow isDesktop={isDesktop}>

            <FieldContainer label="Start Date" required>

              {Platform.OS === 'web' ? (

                <input

                  type="date"

                  value={projectDraft.startDate || ''}

                  onChange={e => handleProjectDraftChange('startDate', e.target.value)}

                  style={{

                    borderWidth: 1,

                    borderColor: '#cbd5e1',

                    borderRadius: 8,

                    paddingVertical: 8,

                    paddingHorizontal: 12,

                    fontSize: 14,

                    color: '#1e293b',

                    backgroundColor: '#fff',

                    height: 42,

                    width: '100%',

                    boxSizing: 'border-box',

                    fontFamily: 'inherit',

                  } as any}

                />

              ) : (

                <TouchableOpacity

                  style={datePickerTriggerStyle}

                  onPress={() => {

                    setDatePickerMode('startDate');

                    setSelectedDate(projectDraft.startDate ? new Date(projectDraft.startDate) : new Date());

                    setShowDatePicker(true);

                  }}

                >

                  <Text style={{ fontSize: 13, color: projectDraft.startDate ? '#1e293b' : '#94a3b8', flex: 1 }}>

                    {projectDraft.startDate || 'Select start date'}

                  </Text>

                  <MaterialIcons name="calendar-today" size={16} color="#64748b" />

                </TouchableOpacity>

              )}

            </FieldContainer>

            <FieldContainer label="End Date" required>

              {Platform.OS === 'web' ? (

                <input

                  type="date"

                  value={projectDraft.endDate || ''}

                  onChange={e => handleProjectDraftChange('endDate', e.target.value)}

                  style={{

                    borderWidth: 1,

                    borderColor: '#cbd5e1',

                    borderRadius: 8,

                    paddingVertical: 8,

                    paddingHorizontal: 12,

                    fontSize: 14,

                    color: '#1e293b',

                    backgroundColor: '#fff',

                    height: 42,

                    width: '100%',

                    boxSizing: 'border-box',

                    fontFamily: 'inherit',

                  } as any}

                />

              ) : (

                <TouchableOpacity

                  style={datePickerTriggerStyle}

                  onPress={() => {

                    setDatePickerMode('endDate');

                    setSelectedDate(projectDraft.endDate ? new Date(projectDraft.endDate) : new Date());

                    setShowDatePicker(true);

                  }}

                >

                  <Text style={{ fontSize: 13, color: projectDraft.endDate ? '#1e293b' : '#94a3b8', flex: 1 }}>

                    {projectDraft.endDate || 'Select end date'}

                  </Text>

                  <MaterialIcons name="calendar-today" size={16} color="#64748b" />

                </TouchableOpacity>

              )}

            </FieldContainer>

          </FieldRow>



          {/* Section 2 */}

          {renderSectionHeader(2, '2. PROJECT LOCATION', 'Where will this project take place?')}

          <FieldRow isDesktop={isDesktop}>

            <FieldContainer label="Region" required>

              <View style={pickerContainerStyle}>

                <Picker

                  selectedValue={projectRegionCode}

                  onValueChange={(itemValue: string) => handleProjectRegionChange(itemValue)}

                  style={pickerStyle}

                >

                  <Picker.Item label="Select region" value="" />

                  {PHRegions.map(region => (

                    <Picker.Item key={region.code} label={region.name} value={region.code} />

                  ))}

                </Picker>

              </View>

            </FieldContainer>

            <FieldContainer label="City / Municipality" required>

              <View style={pickerContainerStyle}>

                <Picker

                  selectedValue={projectCityCode}

                  onValueChange={(itemValue: string) => handleProjectCityChange(itemValue)}

                  enabled={projectRegionCode !== ''}

                  style={pickerStyle}

                >

                  <Picker.Item label="Select city / municipality" value="" />

                  {projectLocationCities.map(city => (

                    <Picker.Item key={city.code} label={city.displayName} value={city.code} />

                  ))}

                </Picker>

              </View>

            </FieldContainer>

          </FieldRow>



          <FieldRow isDesktop={isDesktop}>

            <FieldContainer label="Barangay" required>

              <View style={pickerContainerStyle}>

                <Picker

                  selectedValue={projectBarangayCode}

                  onValueChange={(itemValue: string) => handleProjectBarangayChange(itemValue)}

                  enabled={projectCityCode !== ''}

                  style={pickerStyle}

                >

                  <Picker.Item label="Select barangay" value="" />

                  {projectLocationBarangays.map(barangay => (

                    <Picker.Item key={barangay.code} label={barangay.name} value={barangay.code} />

                  ))}

                </Picker>

              </View>

            </FieldContainer>

            <FieldContainer label="Venue / Exact Address" required>

              <TextInput

                style={inputStyle}

                placeholder="e.g., Barangay Hall, Purok 3"

                placeholderTextColor="#94a3b8"

                value={projectPlaceVenue}

                onChangeText={setProjectPlaceVenue}

              />

            </FieldContainer>

          </FieldRow>



          <FieldRow isDesktop={isDesktop}>

            <FieldContainer label="Google Maps Location (Optional)">

              <View style={{ flexDirection: 'row', gap: 8 }}>

                <TextInput

                  style={[inputStyle, { flex: 1 }]}

                  placeholder="Search location on map"

                  placeholderTextColor="#94a3b8"

                  value={projectDraft.address}

                  onChangeText={value => handleProjectDraftChange('address', value)}

                />

                <TouchableOpacity

                  onPress={() => {

                    if (projectDraft.address) {

                      handleSearchMapLocation(projectDraft.address);

                    } else {

                      Alert.alert('Address Required', 'Please enter a search query in the field first.');

                    }

                  }}

                  style={{

                    flexDirection: 'row',

                    alignItems: 'center',

                    backgroundColor: '#f1f5f9',

                    borderWidth: 1,

                    borderColor: '#cbd5e1',

                    borderRadius: 8,

                    paddingHorizontal: 12,

                    gap: 4,

                    height: 42,

                  }}

                >

                  <MaterialIcons name="search" size={14} color="#475569" />

                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Search</Text>

                </TouchableOpacity>

              </View>

            </FieldContainer>

          </FieldRow>



          {Platform.OS === 'web' && (

            <View style={{ height: 260, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', overflow: 'hidden', marginBottom: 12 }}>

              <div ref={mapPickerRef} style={{ width: '100%', height: '100%' }} />

            </View>

          )}



        </View>



        {/* Right Column: Preview & Quick Actions */}

        <View style={{ flex: 1, gap: 16 }}>

          {/* Project Summary Preview Box */}

          <View style={{

            backgroundColor: '#fff',

            borderWidth: 1,

            borderColor: '#e2e8f0',

            borderRadius: 12,

            padding: 16,

            shadowColor: '#0f172a',

            shadowOffset: { width: 0, height: 2 },

            shadowOpacity: 0.02,

            shadowRadius: 8,

            elevation: 1,

          }}>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>

              <MaterialIcons name="visibility" size={16} color="#166534" />

              <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>

                {projectDraft.isEvent ? 'Event Summary' : 'Project Summary'}

              </Text>

            </View>



            {!projectDraft.title && !projectDraft.description ? (

              <Text style={{ fontSize: 13, color: '#64748b', lineHeight: 18 }}>

                Once you create this project, a summary will appear here.

              </Text>

            ) : (

              <View style={{ gap: 12 }}>

                <View style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 8 }}>

                  <Text style={{ fontSize: 12, color: '#64748b' }}>Status</Text>

                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#b45309' }}>Planning</Text>

                </View>



                <View style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 8 }}>

                  <Text style={{ fontSize: 12, color: '#64748b' }}>Program</Text>

                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>

                    {programSections.find(s => s.module === projectDraft.program_id)?.title || projectDraft.program_id}

                  </Text>

                </View>



                <View style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 8 }}>

                  <Text style={{ fontSize: 12, color: '#64748b' }}>Duration</Text>

                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>

                    {projectDraft.startDate ? format(new Date(projectDraft.startDate), 'MMM d, yyyy') : '--'} -{' '}

                    {projectDraft.endDate ? format(new Date(projectDraft.endDate), 'MMM d, yyyy') : '--'}

                  </Text>

                </View>



                {projectDraft.isEvent && (

                  <View style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 8 }}>

                    <Text style={{ fontSize: 12, color: '#64748b' }}>Volunteer Slots</Text>

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>

                      {projectDraft.volunteersNeeded} slots

                    </Text>

                  </View>

                )}





                <View>

                  <Text style={{ fontSize: 12, color: '#64748b' }}>Location</Text>

                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }} numberOfLines={2}>

                    {previewLocationText}

                  </Text>

                </View>



                <TouchableOpacity

                  onPress={handlePickProjectDocument}

                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 }}

                >

                  <MaterialIcons name="upload-file" size={18} color="#2563eb" />

                  <View style={{ flex: 1 }}>

                    <Text style={{ fontSize: 12, color: '#64748b' }}>Document Attachment</Text>

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#2563eb' }} numberOfLines={1}>

                      {projectDraft.attachmentUrl

                        ? projectDraft.attachmentUrl.split('/').pop() || 'Attached document'

                        : 'Upload document'}

                    </Text>

                  </View>

                </TouchableOpacity>

              </View>

            )}

          </View>



          {/* Quick Actions Panel */}

          <View style={{

            backgroundColor: '#fff',

            borderWidth: 1,

            borderColor: '#e2e8f0',

            borderRadius: 12,

            padding: 16,

            gap: 10,

          }}>

            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 4 }}>Quick Actions</Text>



            <TouchableOpacity

              style={{

                backgroundColor: '#166534',

                borderRadius: 8,

                height: 40,

                alignItems: 'center',

                justifyContent: 'center',

                flexDirection: 'row',

                gap: 6,

              }}

              onPress={handleSaveProjectRecord}

            >

              <MaterialIcons name="add-circle-outline" size={16} color="#fff" />

              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>

                {editingProjectId ? 'Update Project' : 'Create Project'}

              </Text>

            </TouchableOpacity>



            <TouchableOpacity

              style={{

                borderWidth: 1.5,

                borderColor: '#166534',

                borderRadius: 8,

                height: 40,

                alignItems: 'center',

                justifyContent: 'center',

                flexDirection: 'row',

                gap: 6,

                backgroundColor: '#fff',

              }}

              onPress={() => {

                handleProjectDraftChange('status', 'Planning');

                handleSaveProjectRecord();

              }}

            >

              <MaterialIcons name="save" size={16} color="#166534" />

              <Text style={{ color: '#166534', fontWeight: '700', fontSize: 13 }}>Save as Draft</Text>

            </TouchableOpacity>



            <TouchableOpacity

              style={{

                borderWidth: 1.5,

                borderColor: '#cbd5e1',

                borderRadius: 8,

                height: 40,

                alignItems: 'center',

                justifyContent: 'center',

                backgroundColor: '#fff',

              }}

              onPress={closeProjectModal}

            >

              <Text style={{ color: '#64748b', fontWeight: '700', fontSize: 13 }}>Cancel</Text>

            </TouchableOpacity>

          </View>



          {/* Need Help Card */}

          <View style={{

            backgroundColor: '#f1f5f9',

            borderRadius: 12,

            padding: 16,

            gap: 8,

          }}>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>

              <MaterialIcons name="help-outline" size={18} color="#475569" />

              <Text style={{ fontSize: 13, fontWeight: '800', color: '#1e293b' }}>Need help?</Text>

            </View>

            <Text style={{ fontSize: 12, color: '#475569', lineHeight: 16 }}>

              Learn how to create and manage projects.

            </Text>

            <TouchableOpacity

              onPress={() => Linking.openURL('https://www.google.com')}

              style={{

                flexDirection: 'row',

                alignItems: 'center',

                justifyContent: 'center',

                backgroundColor: '#fff',

                borderWidth: 1,

                borderColor: '#cbd5e1',

                borderRadius: 8,

                height: 36,

                gap: 4,

                marginTop: 4,

              }}

            >

              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>View Guide</Text>

              <MaterialIcons name="launch" size={12} color="#475569" />

            </TouchableOpacity>

          </View>

        </View>

      </View>

    </View>

  );

});



// Gives admins a unified project operations workspace for planning, delivery, and approvals.

export default function ProjectLifecycleScreen({ navigation, route }: any) {

  const { user, isAdmin } = useAuth();

  const { width } = useWindowDimensions();

  const isDesktop = getPlatformOS() === 'web' || width >= 1100;

  // Confirmation dialog hook
  const { dialogState, showConfirm, handleConfirm, handleCancel } = useConfirmDialog();

  const listScrollViewRef = React.useRef<ScrollView | null>(null);

  const listScrollOffsetRef = React.useRef(0);

  const windowScrollOffsetRef = React.useRef(0);

  const shouldRestoreListScrollRef = React.useRef(false);
  const lastProgramSuiteNavKeyRef = React.useRef(route?.params?.programSuiteNavKey);
  const lastRouteNavTimestampRef = React.useRef((route?.params as any)?.navTimestamp);

  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);

  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);

  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);

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

  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  const [previewImageModalVisible, setPreviewImageModalVisible] = useState(false);

  const [previewAttendanceLog, setPreviewAttendanceLog] = useState<VolunteerTimeLog | null>(null);

  const [attendanceCheckInFlightLogId, setAttendanceCheckInFlightLogId] = useState<string | null>(null);

  const [taskBoardModalVisible, setTaskBoardModalVisible] = useState(false);

  const [showAttendanceTasks, setShowAttendanceTasks] = useState(false);

  const [attendanceSearchQuery, setAttendanceSearchQuery] = useState('');

  const [attendanceFilter, setAttendanceFilter] = useState<'All' | 'Present' | 'Absent' | 'Late'>('All');
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [isDeletingTaskId, setIsDeletingTaskId] = useState<string | null>(null);
  const [removeVolunteerPickerTaskId, setRemoveVolunteerPickerTaskId] = useState<string | null>(null);
  const [isRemovingVolunteerId, setIsRemovingVolunteerId] = useState<string | null>(null);

  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);

  const [showStatusModal, setShowStatusModal] = useState(false);

  const [showProjectModal, setShowProjectModal] = useState(false);

  const [activeInlineCreateProjectProgramId, setActiveInlineCreateProjectProgramId] = useState<string | null>(null);

  const [activeInlineCreateEventProjectId, setActiveInlineCreateEventProjectId] = useState<string | null>(null);



  const startInlineProjectCreation = (trackId: string, trackTitle: string, proposal?: any) => {

    setEditingProjectId(null);

    setProjectEditorMode('project');

    const knownModules: AdvocacyFocus[] = ['Education', 'Livelihood', 'Nutrition', 'Disaster'];

    const advocacyFocus: AdvocacyFocus = knownModules.includes(trackId as AdvocacyFocus)

      ? (trackId as AdvocacyFocus)

      : 'Education';



    const proposalDetails = proposal?.proposalDetails || {};

    const title = proposalDetails.proposedTitle || '';

    const description = proposalDetails.proposedDescription || '';

    const partnerId = proposal?.partnerId || proposal?.partnerUserId || '';

    const startDate = proposalDetails.proposedStartDate || '';

    const endDate = proposalDetails.proposedEndDate || startDate;

    const address = proposalDetails.proposedLocation || '';

    const communityNeed = proposalDetails.communityNeed || proposal?.communityNeed || '';

    const expectedDeliverables = proposalDetails.expectedDeliverables || proposal?.expectedDeliverables || '';



    const draft = createEmptyProjectDraft(partnerId, advocacyFocus, false, title, description, trackId);

    draft.program_id = trackId;

    draft.parentProjectId = trackId;

    (draft as any).acceptVolunteers = true;

    (draft as any).applicationRequired = true;

    (draft as any).reviewRequired = true;

    (draft as any).applicationDeadline = '';



    if (startDate) draft.startDate = startDate.split('T')[0];

    if (endDate) draft.endDate = endDate.split('T')[0];

    if (address) draft.address = address;

    if (communityNeed) draft.communityNeed = communityNeed;

    if (expectedDeliverables) draft.expectedDeliverables = expectedDeliverables;



    setProjectDraft(draft);

    setProjectPlaceVenue(address);

    resetProjectLocationSelection();

    if (address) {

      applyProjectLocationSelectionFromAddress(address);

    }

    setProjectSaveError(null);

    setActiveInlineCreateProjectProgramId(trackId);

    setActiveInlineCreateEventProjectId(null);

  };



  const startInlineEventCreation = (parentProject: Project) => {

    setEditingProjectId(null);

    setProjectEditorMode('event');

    const eventTitle = parentProject.title ? `${parentProject.title} Event` : 'New Event';

    const eventDescription = parentProject.description || '';

    const nextDraft = createEmptyProjectDraft(

      parentProject.partnerId,

      getProjectDraftModule(parentProject) as AdvocacyFocus,

      true,

      eventTitle,

      eventDescription,

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



    // Set default dates to parent's dates

    nextDraft.startDate = parentProject.startDate || new Date().toISOString().split('T')[0];

    nextDraft.endDate = parentProject.endDate || nextDraft.startDate;



    setProjectDraft(nextDraft);

    setProjectPlaceVenue('');

    resetProjectLocationSelection();

    applyProjectLocationSelectionFromAddress(parentProject.location.address || '');

    setProjectSaveError(null);



    // Reset Google Calendar specific states

    setEventTimeStart('12:30 PM');

    setEventTimeEnd('1:30 PM');

    setEventAllDay(false);

    setEventRepeat('Does not repeat');

    setEventZoomLink('');

    setEventOwner('THEA SALINAS');

    setEventOwnerColor('#166534');

    setEventBusyFree('Busy');

    setEventVisibility('Default visibility');

    setEventGuests('');

    setEventGuestsModify(false);

    setEventGuestsInvite(true);

    setEventGuestsSeeList(true);

    setEventNotifications([{ type: 'Notification', value: '30', unit: 'minutes' }]);



    setActiveInlineCreateEventProjectId(parentProject.id);

    setActiveInlineCreateProjectProgramId(null);

  };



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

  const [activeActionTaskId, setActiveActionTaskId] = useState<string | null>(null);

  const [unassignedTaskSelections, setUnassignedTaskSelections] = useState<Record<string, string>>({});

  const [selectedProgramProposalModule, setSelectedProgramProposalModule] = useState<ProgramSuiteModule | null>(null);

  const [showDatePicker, setShowDatePicker] = useState(false);

  const [datePickerMode, setDatePickerMode] = useState<'startDate' | 'endDate' | 'applicationDeadline'>('startDate');

  const [selectedDate, setSelectedDate] = useState(new Date());

  const [selectedSchedulerYear, setSelectedSchedulerYear] = useState(new Date().getFullYear());

  const [selectedSchedulerMonth, setSelectedSchedulerMonth] = useState(new Date().getMonth());

  const [isSchedulerMonthHovered, setIsSchedulerMonthHovered] = useState(false);

  const [selectedProgramWebModule, setSelectedProgramWebModule] = useState<ProgramSuiteModule | null>(null);

  const [workspaceLayoutMode, setWorkspaceLayoutMode] = useState<'card' | 'compact'>('card');

  const [programSuiteView, setProgramSuiteView] = useState<ProgramSuiteView>(

    () => getProgramSuiteViewFromRoute(route)

  );

  // Status filter for the projects view ΓÇö null means show all

  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const [calendarTabFilter, setCalendarTabFilter] = useState<'All' | 'Scheduled' | 'Drafts'>('All');

  const [projectSearchQuery, setProjectSearchQuery] = useState('');

  const [projectProgramFilter, setProjectProgramFilter] = useState<string | null>(null);

  const [projectTypeFilter, setProjectTypeFilter] = useState<'Projects' | 'Events' | null>(null);

  const [projectsSortKey, setProjectsSortKey] = useState<ProjectsSortKey>('recentlyUpdated');

  const [activeProjectsFilterMenu, setActiveProjectsFilterMenu] = useState<'program' | 'type' | 'status' | 'sort' | null>(null);

  const [projectPlaceVenue, setProjectPlaceVenue] = useState('');

  const [currentDate, setCurrentDate] = useState(() => new Date());

  const [statusUpdateMode, setStatusUpdateMode] = useState<LifecycleStatusMode>('System');

  const [newStatus, setNewStatus] = useState<Project['status']>('Planning');

  const [updateDescription, setUpdateDescription] = useState('');

  const [customRequirementText, setCustomRequirementText] = useState('');

  const [showVolunteerApplicationsModal, setShowVolunteerApplicationsModal] = useState(false);

  const [eventWorkspaceTab, setEventWorkspaceTab] = useState<'Attendance' | 'Tasks'>('Attendance');

  const [selectedEventMatches, setSelectedEventMatches] = useState<VolunteerProjectMatch[]>([]);

  const [reviewActionLoadingId, setReviewActionLoadingId] = useState<string | null>(null);

  const [applicantSearchQuery, setApplicantSearchQuery] = useState('');

  const [applicantFilter, setApplicantFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');

  const [applicantSort, setApplicantSort] = useState<'Newest' | 'Oldest'>('Newest');

  const [selectedMatch, setSelectedMatch] = useState<VolunteerProjectMatch | null>(null);

  const [reviewerNotes, setReviewerNotes] = useState('');

  const [showMoreDropdown, setShowMoreDropdown] = useState(false);
  const [activeProjectRowActionId, setActiveProjectRowActionId] = useState<string | null>(null);

  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(() => {

    const initialModule = (route.params?.programModule as AdvocacyFocus) || 'Education';

    return createEmptyProjectDraft('', initialModule);

  });



  // Google Calendar layout states

  const [eventTimeStart, setEventTimeStart] = useState('12:30 PM');

  const [eventTimeEnd, setEventTimeEnd] = useState('1:30 PM');

  const [eventAllDay, setEventAllDay] = useState(false);

  const [eventRepeat, setEventRepeat] = useState('Does not repeat');

  const [eventZoomLink, setEventZoomLink] = useState('');

  const [eventOwner, setEventOwner] = useState('THEA SALINAS');

  const [eventOwnerColor, setEventOwnerColor] = useState('#166534');

  const [eventBusyFree, setEventBusyFree] = useState('Busy');

  const [eventVisibility, setEventVisibility] = useState('Default visibility');

  const [eventGuests, setEventGuests] = useState('');

  const [eventGuestsModify, setEventGuestsModify] = useState(false);

  const [eventGuestsInvite, setEventGuestsInvite] = useState(true);

  const [eventGuestsSeeList, setEventGuestsSeeList] = useState(true);

  const [eventNotifications, setEventNotifications] = useState<EventNotificationSetting[]>([

    { type: 'Notification', value: '30', unit: 'minutes' }

  ]);

  const updateEventNotification = (

    index: number,

    changes: Partial<EventNotificationSetting>

  ) => {

    setEventNotifications(current =>

      current.map((notification, notificationIndex) =>

        notificationIndex === index

          ? { ...notification, ...changes }

          : notification

      )

    );

  };

  const removeEventNotification = (index: number) => {

    setEventNotifications(current => current.filter((_, notificationIndex) => notificationIndex !== index));

  };

  const addEventNotification = () => {

    setEventNotifications(current => [

      ...current,

      { type: 'Notification', value: '30', unit: 'minutes' },

    ]);

  };

  const [isSavingEvent, setIsSavingEvent] = useState(false);

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

    setShowAttendanceTasks(false);

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
    const nextView = getProgramSuiteViewFromRoute(route);
    setProgramSuiteView(nextView);

    const routeProgramSuiteNavKey = route?.params?.programSuiteNavKey;
    const routeNavTimestamp = (route?.params as any)?.navTimestamp;
    const programSuiteNavKeyChanged =
      Boolean(routeProgramSuiteNavKey) &&
      routeProgramSuiteNavKey !== lastProgramSuiteNavKeyRef.current;
    const routeNavTimestampChanged =
      Boolean(routeNavTimestamp) &&
      routeNavTimestamp !== lastRouteNavTimestampRef.current;
    const isNavigationTrigger = programSuiteNavKeyChanged || routeNavTimestampChanged;

    if (isNavigationTrigger) {
      lastProgramSuiteNavKeyRef.current = routeProgramSuiteNavKey;
      lastRouteNavTimestampRef.current = routeNavTimestamp;
      if (!route?.params?.projectId) {
        setSelectedProject(null);
        setSelectedProgramWebModule(null);
        setShowVolunteerApplicationsModal(false);
        setShowAttendanceTasks(false);
        setShowProjectModal(false);
        setProjectEditorMode(null);
      }
    }

    if (route?.params?.projectId && projects.length > 0) {
      const targetId = route.params.projectId;
      const targetProject = projects.find(p => p.id === targetId);
      if (targetProject && selectedProject?.id !== targetProject.id) {
        setSelectedProject(targetProject);
        // Clear the param so it doesn't get stuck if they close the modal
        navigation?.setParams?.({ projectId: undefined });
      }
    }
  }, [route?.name, (route?.params as any)?.navTimestamp, route?.params?.programSuiteNavKey, route?.params?.programSuiteView, route?.params?.projectId, projects]);



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



  const handleDeleteProject = (project: Project) => {

    Alert.alert(

      'Delete Project',

      `Are you sure you want to delete "${project.title}"?`,

      [

        { text: 'Cancel', style: 'cancel' as const },

        {

          text: 'Delete',

          style: 'destructive' as const,

          onPress: async () => {

            try {

              if (project.isEvent) {

                await deleteEvent(project.id);

              } else {

                await deleteProject(project.id);

              }

              void loadProjects();

            } catch (err) {

              Alert.alert('Error', 'Failed to delete project.');

            }

          }

        }

      ]

    );

  };



  const handleCreateProjectFromCalendar = () => {

    if (programSections.length > 0) {

      Alert.alert(

        'Select Program',

        'Choose the program track for the new project:',

        programSections.map(s => ({

          text: s.title,

          onPress: () => openCreateProjectInProgramModal(s.module, s.title)

        }))

      );

    } else {

      Alert.alert('Error', 'No program tracks found to add a project.');

    }

  };



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

        void loadPlanningData();

      };



      const refresh = async () => {

        await refreshLight();

        // schedule deferred loads without blocking render - increased timeout for better UX

        setTimeout(() => {

          void refreshDeferred();

        }, 150);

      };



      void refresh();



      const unsubscribe = subscribeToStorageChanges(

        // Keep subscriptions focused on keys that affect the visible UI first.

        ['programs', 'projects', 'events', 'partners', 'statusUpdates', 'partnerProjectApplications', 'partnerReports', 'volunteerProjectJoins', 'volunteerMatches', 'volunteerTimeLogs', 'programTracks', 'adminPlanningCalendars', 'adminPlanningItems'],

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

      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'programTracks', 'volunteerJoinRecords']);

      const allProjects = snapshot.projects || [];

      setProjects(allProjects);

      setProgramTracks(snapshot.programTracks || []);

      if (Array.isArray(snapshot.volunteerJoinRecords)) {

        setVolunteerJoinRecords(snapshot.volunteerJoinRecords);

      }

      setLoadError(null);

      setSelectedProject(currentSelectedProject => {

        if (!currentSelectedProject) {

          return currentSelectedProject;

        }



        return allProjects.find(project => project.id === currentSelectedProject.id) || currentSelectedProject;

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



  const loadPlanningData = async () => {

    try {

      const [calendars, items] = await Promise.all([

        getAllAdminPlanningCalendars(),

        getAllAdminPlanningItems(),

      ]);

      setPlanningCalendars(calendars);

      setPlanningItems(items);

    } catch (err) {

      console.error('Failed to load planning data:', err);

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

      setVolunteerJoinRecords(current => {

        const otherRecords = current.filter(r => r.projectId !== projectId);

        return [...otherRecords, ...records];

      });

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

        Alert.alert('Γ£à Program Added', `"${newProgram.title}" has been added to the dashboard.`);

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



  const handlePickProgramImage = async () => {

    try {

      const pickedImage = await pickImageFromDevice();

      if (!pickedImage) {

        return;

      }

      setProgramDraft(d => ({ ...d, imageUrl: pickedImage }));

    } catch (error: any) {

      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');

    }

  };



  const handleRemoveProgramImage = () => {

    setProgramDraft(d => ({ ...d, imageUrl: '' }));

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

          editingProgramId ? 'Γ£à Program Updated' : 'Γ£à Program Created',

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

        // Delete from backend FIRST - don't do optimistic update
        await deleteProgram(trackId);

        // Force clear cache to ensure fresh data
        clearStorageCache(['programs', 'programTracks', 'projects', 'events']);

        // Wait for backend to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Only after success, reload the data
        await loadProgramTracks();

        // Show success message
        showTaskSaveNotice(`Program "${trackTitle}" was deleted successfully.`, 1500);

      } catch (error) {

        // On error, reload to ensure correct state and show error
        await loadProgramTracks();

        const errorMsg = getRequestErrorMessage(error, 'Failed to delete program.');

        showConfirm({
          title: 'Error',
          message: errorMsg,
          confirmText: 'OK',
          cancelText: '',
          confirmColor: '#166534',
          icon: 'error-outline',
          iconColor: '#DC2626',
          onConfirm: () => {},
        });

      } finally {

        setActionLoadingKey(null);

      }

    };



    showConfirm({
      title: 'Delete Program',
      message: `Delete "${trackTitle}"? This cannot be undone. Projects and events under this program will also be deleted.`,
      confirmText: 'Delete',
      loadingText: 'Deleting...',
      cancelText: 'Cancel',
      icon: 'delete-outline',
      iconColor: '#DC2626',
      confirmColor: '#DC2626',
      onConfirm: doDelete,
    });

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

      loadAllVolunteerMatches(),

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

  const openCreateProjectInProgramModal = (trackId: string, trackTitle: string, proposal?: any) => {

    setEditingProjectId(null);

    setProjectEditorMode('project');

    // Determine advocacy focus from the track ID if it's a known module, else default to Education

    const knownModules: AdvocacyFocus[] = ['Education', 'Livelihood', 'Nutrition', 'Disaster'];

    const advocacyFocus: AdvocacyFocus = knownModules.includes(trackId as AdvocacyFocus)

      ? (trackId as AdvocacyFocus)

      : 'Education';



    // Prefill with proposal details if available

    const proposalDetails = proposal?.proposalDetails || {};

    const title = proposalDetails.proposedTitle || '';

    const description = proposalDetails.proposedDescription || '';

    const partnerId = proposal?.partnerId || proposal?.partnerUserId || '';

    const startDate = proposalDetails.proposedStartDate || '';

    const endDate = proposalDetails.proposedEndDate || startDate;

    const address = proposalDetails.proposedLocation || '';

    const communityNeed = proposalDetails.communityNeed || proposal?.communityNeed || '';

    const expectedDeliverables = proposalDetails.expectedDeliverables || proposal?.expectedDeliverables || '';



    // Create draft with parentProjectId set to the program ID for correct grouping on mobile

    const draft = createEmptyProjectDraft(partnerId, advocacyFocus, false, title, description, trackId);

    // Ensure both program_id and parentProjectId point to the program

    draft.program_id = trackId;

    draft.parentProjectId = trackId;



    if (startDate) draft.startDate = startDate.split('T')[0];

    if (endDate) draft.endDate = endDate.split('T')[0];

    if (address) draft.address = address;

    if (communityNeed) draft.communityNeed = communityNeed;

    if (expectedDeliverables) draft.expectedDeliverables = expectedDeliverables;



    setProjectDraft(draft);

    setProjectPlaceVenue(address);

    resetProjectLocationSelection();

    if (address) {

      applyProjectLocationSelectionFromAddress(address);

    }

    setProjectSaveError(null);

    setShowProjectModal(true);

  };



  const openCreateEventInProgramModal = (trackId: string, trackTitle: string) => {

    const parentProjects = projects.filter(

      project => !project.isEvent && (project.program_id === trackId || project.parentProjectId === trackId)

    );



    if (parentProjects.length === 0) {

      Alert.alert('No Project Available', `Create a project in ${trackTitle} before adding an event.`);

      return;

    }



    if (parentProjects.length === 1) {

      openCreateEventModal(parentProjects[0]);

      return;

    }



    Alert.alert(

      'Select Parent Project',

      'Choose the project this event belongs to:',

      parentProjects.map(project => ({

        text: project.title,

        onPress: () => openCreateEventModal(project),

      }))

    );

  };



  const handleAddEventFromCalendar = (date: Date) => {

    const defaultTrack = (programSections && programSections.length > 0)

      ? programSections[0]

      : { module: 'Education' as const, title: 'Education' };

    openCreateEventInProgramModal(defaultTrack.module, defaultTrack.title);

    const dateStr = date.toISOString().split('T')[0];

    setProjectDraft(prev => {

      if (!prev) return prev;

      return {

        ...prev,

        startDate: dateStr,

        endDate: dateStr,

      };

    });

  };



  // Opens the project modal in create-event mode with the selected program prefilled.

  const openCreateEventModal = (parentProject: Project) => {

    setEditingProjectId(null);

    setProjectEditorMode('event');

    const eventTitle = parentProject.title ? `${parentProject.title} Event` : 'New Event';

    const eventDescription = parentProject.description || '';

    const nextDraft = createEmptyProjectDraft(

      parentProject.partnerId,

      getProjectDraftModule(parentProject) as AdvocacyFocus,

      true,

      eventTitle,

      eventDescription,

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



    // Set default dates to parent's dates

    nextDraft.startDate = parentProject.startDate || new Date().toISOString().split('T')[0];

    nextDraft.endDate = parentProject.endDate || nextDraft.startDate;



    setProjectDraft(nextDraft);

    setProjectPlaceVenue('');

    resetProjectLocationSelection();

    applyProjectLocationSelectionFromAddress(parentProject.location.address || '');

    setProjectSaveError(null);



    // Reset Google Calendar specific states

    setEventTimeStart('12:30 PM');

    setEventTimeEnd('1:30 PM');

    setEventAllDay(false);

    setEventRepeat('Does not repeat');

    setEventZoomLink('');

    setEventOwner('THEA SALINAS');

    setEventOwnerColor('#166534');

    setEventBusyFree('Busy');

    setEventVisibility('Default visibility');

    setEventGuests('');

    setEventGuestsModify(false);

    setEventGuestsInvite(true);

    setEventGuestsSeeList(true);

    setEventNotifications([{ type: 'Notification', value: '30', unit: 'minutes' }]);



    setShowProjectModal(true);

  };



  const closeProjectModal = () => {

    setShowProjectModal(false);

    setEditingProjectId(null);

    setProjectEditorMode(null);

    setIsProjectSaveSuccess(false);

    setProjectSaveError(null);

    setActiveInlineCreateProjectProgramId(null);

    setActiveInlineCreateEventProjectId(null);

  };



  // Opens the project modal in edit mode using the selected project values.

  const openEditProjectModal = (project: Project) => {

    setEditingProjectId(project.id);

    setProjectEditorMode(project.isEvent ? 'event' : 'project');

    // For events, use the dedicated locationVenue field if available

    if (project.isEvent && project.locationVenue) {

      setProjectPlaceVenue(project.locationVenue);

    } else {

      // Fallback: parse venue from address string

      const addressTokens = (project.location.address || '').split(',').map(t => t.trim()).filter(Boolean);

      const placeCount = addressTokens.length - (project.isEvent ? 3 : 2);

      if (placeCount > 0) {

        setProjectPlaceVenue(addressTokens.slice(0, placeCount).join(', '));

      } else {

        setProjectPlaceVenue('');

      }

    }

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

      volunteerRequirements: Array.isArray(project.volunteerRequirements) ? project.volunteerRequirements : [],

      communityNeed: project.communityNeed || '',

      expectedDeliverables: project.expectedDeliverables || '',

      attachmentUrl:

        (project.attachments || []).find(attachment => attachment.type === 'document')?.url || '',

      isEvent: !!project.isEvent,

      // Load volunteer settings from existing project

      acceptVolunteers: project.acceptVolunteers !== false,

      applicationRequired: project.applicationRequired !== false,

      reviewRequired: project.reviewRequired !== false,

      applicationDeadline: project.applicationDeadline || '',

    } as any);

    if (project.isEvent) {

      // Extract time from ISO datetime string

      const extractTimeIn12HourFormat = (isoString: string): string => {

        try {

          const date = new Date(isoString);

          let hours = date.getHours();

          const minutes = date.getMinutes();

          const ampm = hours >= 12 ? 'PM' : 'AM';

          hours = hours % 12;

          hours = hours ? hours : 12; // the hour '0' should be '12'

          const minutesStr = String(minutes).padStart(2, '0');

          return `${hours}:${minutesStr} ${ampm}`;

        } catch {

          return '12:00 PM';

        }

      };



      setEventTimeStart(extractTimeIn12HourFormat(project.startDate));

      setEventTimeEnd(extractTimeIn12HourFormat(project.endDate));

      setEventAllDay(false);

      setEventZoomLink(project.googleMeetUrl || (project as any).meetUrl || (project as any).zoomLink || '');

      setEventNotifications(

        Array.isArray(project.notificationSettings) && project.notificationSettings.length > 0

          ? project.notificationSettings.map(notification => ({

              type: notification.type === 'Email' ? 'Email' as 'Email' : 'Notification' as 'Notification',

              value: String(notification.value ?? 30),

              unit: (notification.unit === 'hours' || notification.unit === 'days') ? notification.unit : 'minutes' as 'minutes',

            }))

          : [{ type: 'Notification' as 'Notification', value: '30', unit: 'minutes' as 'minutes' }]

      );

    }

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



  const handleAssignEventTask = async (eventProject: Project, taskId: string, volunteerId?: string) => {
    const targetVolunteer = volunteerId
      ? volunteers.find(volunteer => volunteer.id === volunteerId || volunteer.userId === volunteerId) || null
      : null;

    const updatedTasks = (eventProject.internalTasks || []).map(task => {
      if (task.id !== taskId) {
        return task;
      }

      return {
        ...task,
        assignedVolunteerId: volunteerId || undefined,
        assignedVolunteerName: targetVolunteer?.name || undefined,
        assignedVolunteerIds: volunteerId ? [volunteerId] : undefined,
        assignedVolunteerNames: targetVolunteer?.name ? [targetVolunteer.name] : undefined,
        status: volunteerId ? 'Assigned' : 'Unassigned',
        updatedAt: new Date().toISOString(),
      } as ProjectInternalTask;
    });

    await saveEvent({
      ...eventProject,
      internalTasks: updatedTasks,
      updatedAt: new Date().toISOString(),
    });

    if (targetVolunteer && volunteerId) {
      const assignedTask = updatedTasks.find(t => t.id === taskId);
      if (assignedTask) {
        try {
          await notifyVolunteerAboutTaskUpdate({
            event: eventProject,
            task: assignedTask,
            volunteer: targetVolunteer,
            actorUserId: user?.id,
            action: 'assigned',
          });
        } catch (notifErr) {
          console.warn('[TASK] Failed to notify volunteer about task assignment:', notifErr);
        }
      }
    }
  };

  const handleRemoveVolunteerFromEventTask = async (eventProject: Project, taskId: string, volunteerId: string) => {
    const targetVolunteer = volunteers.find(volunteer => volunteer.id === volunteerId || volunteer.userId === volunteerId) || null;
    const originalTask = (eventProject.internalTasks || []).find(t => t.id === taskId);

    const updatedTasks = (eventProject.internalTasks || []).map(task => {
      if (task.id !== taskId) return task;

      const nextAssignedIds = getTaskAssignedVolunteerIds(task).filter(id => id !== volunteerId);

      return {
        ...task,
        assignedVolunteerId: nextAssignedIds[0] || undefined,
        assignedVolunteerName: nextAssignedIds[0]
          ? volunteers.find(volunteer => volunteer.id === nextAssignedIds[0] || volunteer.userId === nextAssignedIds[0])?.name
          : undefined,
        assignedVolunteerIds: nextAssignedIds.length ? nextAssignedIds : undefined,
        assignedVolunteerNames: nextAssignedIds.map(id => volunteers.find(volunteer => volunteer.id === id || volunteer.userId === id)?.name).filter(Boolean) as string[],
        status: nextAssignedIds.length ? task.status : 'Unassigned',
        updatedAt: new Date().toISOString(),
      } as ProjectInternalTask;
    });

    await saveEvent({
      ...eventProject,
      internalTasks: updatedTasks,
      updatedAt: new Date().toISOString(),
    });

    if (targetVolunteer && originalTask) {
      try {
        await notifyVolunteerAboutTaskUnassignment({
          event: eventProject,
          task: originalTask,
          volunteer: targetVolunteer,
          actorUserId: user?.id,
        });
      } catch (notifErr) {
        console.warn('[TASK] Failed to notify volunteer about task unassignment:', notifErr);
      }
    }
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
        Alert.alert('Deleted', `Event "${event.title}" was deleted successfully.`);

      } catch (error) {

        setProjects(previousProjects);

        setSelectedProject(previousSelectedProject);

        const errorMsg = getRequestErrorMessage(error, 'Failed to delete event.');

        showConfirm({
          title: getRequestErrorTitle(error),
          message: errorMsg,
          confirmText: 'OK',
          cancelText: '',
          confirmColor: '#166534',
          icon: 'error-outline',
          iconColor: '#DC2626',
          onConfirm: () => {},
        });

      } finally {

        setActionLoadingKey(null);

      }

    };



    showConfirm({
      title: 'Delete Event',
      message: `Delete "${event.title}"? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      icon: 'delete-outline',
      iconColor: '#DC2626',
      confirmColor: '#DC2626',
      loadingText: 'Deleting...',
      onConfirm: doDelete,
    });

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



  const handleSearchMapLocation = async (query: string) => {

    if (!query) {

      Alert.alert('Address Required', 'Please enter a search query in the field first.');

      return;

    }

    try {

      const response = await fetch(

        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,

        {

          headers: {

            'User-Agent': 'NVC-Connect-Volunteer-System/1.0',

          },

        }

      );

      const data = await response.json();

      if (data && data.length > 0) {

        const resolvedAddress = data[0].display_name;

        handleProjectDraftChange('address', resolvedAddress);

        handleProjectDraftChange('latitude', String(data[0].lat));

        handleProjectDraftChange('longitude', String(data[0].lon));



        const parsed = parsePhilippineAddressSelection(resolvedAddress);

        if (parsed.regionCode) {

          setProjectRegionCode(parsed.regionCode);

          const cities = getCitiesByRegion(parsed.regionCode);

          setProjectLocationCities(cities);

          if (parsed.cityCode) {

            setProjectCityCode(parsed.cityCode);

            const barangays = getBarangaysByCity(parsed.cityCode);

            setProjectLocationBarangays(barangays);

            if (parsed.barangayCode) {

              setProjectBarangayCode(parsed.barangayCode);

            }

          }

        }

      } else {

        Alert.alert('Location Not Found', 'Could not locate this place on map. Please try a different query.');

      }

    } catch (error) {

      Alert.alert('Search Error', 'Unable to reach the mapping service.');

    }

  };



  const handleMarkerPositionChange = async (lat: number, lng: number) => {

    handleProjectDraftChange('latitude', String(lat));

    handleProjectDraftChange('longitude', String(lng));



    try {

      const response = await fetch(

        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,

        {

          headers: {

            'User-Agent': 'NVC-Connect-Volunteer-System/1.0',

          },

        }

      );

      const data = await response.json();

      if (data && data.display_name) {

        const resolvedAddress = data.display_name;

        handleProjectDraftChange('address', resolvedAddress);



        const parsed = parsePhilippineAddressSelection(resolvedAddress);

        if (parsed.regionCode) {

          setProjectRegionCode(parsed.regionCode);

          const cities = getCitiesByRegion(parsed.regionCode);

          setProjectLocationCities(cities);

          if (parsed.cityCode) {

            setProjectCityCode(parsed.cityCode);

            const barangays = getBarangaysByCity(parsed.cityCode);

            setProjectLocationBarangays(barangays);

            if (parsed.barangayCode) {

              setProjectBarangayCode(parsed.barangayCode);

            }

          }

        }

      }

    } catch (error) {

      console.warn('[ReverseGeocoder] Failed:', error);

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

      volunteersNeeded: String((task as any).volunteersNeeded || getTaskAssignedVolunteerIds(task).length || 1),

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



  const getGoogleCalendarEventUrl = (event: Project): string => {

    const base = 'https://calendar.google.com/calendar/u/0/r/eventedit';

    const start = new Date(event.startDate);

    const end = new Date(event.endDate);



    let datePart = '';

    if (eventAllDay) {

      const startStr = start.toISOString().split('T')[0].replace(/-/g, '');

      const nextDay = new Date(end);

      nextDay.setDate(nextDay.getDate() + 1);

      const endStr = nextDay.toISOString().split('T')[0].replace(/-/g, '');

      datePart = `${startStr}/${endStr}`;

    } else {

      const startStr = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

      const endStr = end.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

      datePart = `${startStr}/${endStr}`;

    }



    const params = [

      `text=${encodeURIComponent(event.title)}`,

      `dates=${datePart}`,

      `details=${encodeURIComponent(

        (event.description || '') +

        '\n\nVolunteer slots: ' + (event.volunteersNeeded || '0') +

        (event.googleMeetUrl ? '\n\nGoogle Meet: ' + event.googleMeetUrl : '')

      )}`,

      `location=${encodeURIComponent(event.location.address || '')}`,

    ];



    if (eventGuests && eventGuests.trim()) {

      params.push(`add=${encodeURIComponent(eventGuests.trim())}`);

    }



    return `${base}?${params.join('&')}`;

  };



  // Creates or updates a project record from the modal form.

  const handleSaveProjectRecord = async () => {

    if (!isAdmin) {

      Alert.alert('Access Restricted', 'Only admin accounts can manage projects.');

      return;

    }



    const failProjectSaveValidation = (message: string) => {

      setActionLoadingKey(null);

      setIsSavingEvent(false);

      setProjectSaveError(message);

      showConfirm({
        title: 'Validation Error',
        message: message,
        confirmText: 'OK',
        cancelText: '',
        confirmColor: '#166534',
        icon: 'error-outline',
        iconColor: '#DC2626',
        onConfirm: () => {},
      });

    };



    const parsedLatitude = Number(projectDraft.latitude);

    const parsedLongitude = Number(projectDraft.longitude);

    // For events, use the user-provided value; for projects, set to 0

    const volunteersNeeded = projectDraft.isEvent ? Number(projectDraft.volunteersNeeded) : 0;

    let startDateValue = new Date(projectDraft.startDate);

    let endDateValue = new Date(projectDraft.endDate);



    if (projectDraft.isEvent && !eventAllDay) {

      const parseTimeTo24h = (timeStr: string): string => {

        const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i);

        if (!match) return '00:00:00';

        let hours = parseInt(match[1], 10);

        const minutes = match[2];

        const ampm = match[3].toUpperCase();

        if (ampm === 'PM' && hours < 12) hours += 12;

        if (ampm === 'AM' && hours === 12) hours = 0;

        const hoursStr = String(hours).padStart(2, '0');

        return `${hoursStr}:${minutes}:00`;

      };



      const startDatePart = projectDraft.startDate.split('T')[0];

      const endDatePart = projectDraft.endDate.split('T')[0];



      startDateValue = new Date(`${startDatePart}T${parseTimeTo24h(eventTimeStart)}`);

      endDateValue = new Date(`${endDatePart}T${parseTimeTo24h(eventTimeEnd)}`);

    }

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

    const effectiveProjectBarangayCode =

      projectDraft.isEvent

        ? (projectBarangayCode || parentLocationSelection.barangayCode)

        : projectBarangayCode;

    const missingRequiredFields = [

      !projectDraft.title.trim() ? 'title' : '',

      !projectDraft.description.trim() ? 'description' : '',

      !projectDraft.startDate.trim() ? 'start date' : '',

      !projectDraft.endDate.trim() ? 'end date' : '',

      !effectiveProjectRegionCode ? 'region' : '',

      !effectiveProjectCityCode ? 'city' : '',

      projectDraft.isEvent && !effectiveProjectBarangayCode ? 'barangay' : '',

      !projectPlaceVenue.trim() ? 'place' : '',

    ].filter(Boolean);



    if (missingRequiredFields.length > 0) {

      failProjectSaveValidation(

        `Fill in the required field${missingRequiredFields.length === 1 ? '' : 's'}: ${missingRequiredFields.join(', ')}.`

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

    const selectedLocationBarangay = effectiveLocationBarangays.find(barangay => barangay.code === effectiveProjectBarangayCode);

    const structuredAddress = composePhilippineAddress(

      selectedLocationRegion?.name || '',

      selectedLocationCity?.displayName || '',

      projectDraft.isEvent ? selectedLocationBarangay?.name || '' : ''

    );

    const resolvedAddress = projectPlaceVenue.trim()

      ? [projectPlaceVenue.trim(), structuredAddress].filter(Boolean).join(', ')

      : (structuredAddress || projectDraft.address.trim());

    const hasStructuredPhilippineAddress =

      Boolean(effectiveProjectRegionCode) &&

      Boolean(effectiveProjectCityCode) &&

      (!projectDraft.isEvent || Boolean(effectiveProjectBarangayCode));



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

      projectDraft.isEvent

        ? 'Manual'

        : existingProject?.statusMode === 'Manual' ? 'Manual' : 'System';

    const inheritedManualStatus: Project['manualStatus'] =

      inheritedStatusMode === 'Manual'

        ? (projectDraft.status || existingProject?.manualStatus || existingProject?.status || 'Planning')

        : undefined;

    const sanitizedEventNotifications = eventNotifications

      .map(notification => ({

        type: notification.type === 'Email' ? 'Email' as const : 'Notification' as const,

        value: String(notification.value || '').trim() || '30',

        unit: notification.unit === 'hours' || notification.unit === 'days' ? notification.unit as 'hours' | 'days' : 'minutes' as const,

      }))

      .filter(notification => Number(notification.value) > 0);

    const normalizedGoogleMeetUrl = normalizeExternalUrl(eventZoomLink);



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

        barangay: selectedLocationBarangay?.name,

      },

      locationRegion: selectedLocationRegion?.name,

      locationCity: selectedLocationCity?.displayName,

      locationBarangay: selectedLocationBarangay?.name,

      locationVenue: projectDraft.isEvent ? projectPlaceVenue.trim() : undefined,

      googleMeetUrl: projectDraft.isEvent ? normalizedGoogleMeetUrl || undefined : undefined,

      notificationSettings: projectDraft.isEvent ? sanitizedEventNotifications : undefined,

      acceptVolunteers: (projectDraft as any).acceptVolunteers !== false,

      applicationRequired: (projectDraft as any).applicationRequired !== false,

      reviewRequired: (projectDraft as any).reviewRequired !== false,

      applicationDeadline: (projectDraft as any).applicationDeadline || undefined,

      volunteersNeeded,

      volunteers: existingProject?.volunteers || [],

      joinedUserIds: existingProject?.joinedUserIds || [],

      skillsNeeded: projectDraft.skillsNeeded || [],

      volunteerRequirements: projectDraft.volunteerRequirements || [],

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

    } as any as Project;



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



    setIsSavingEvent(true);

    try {

      await saveProjectLikeRecord(projectToSave);

      await loadProjects();

      setIsSavingEvent(false);

      setActionLoadingKey(null);

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

        if (savedProject.isEvent) {

          const googleUrl = getGoogleCalendarEventUrl(projectToSave);

          Linking.openURL(googleUrl).catch(err => {

            console.error('Failed to open Google Calendar link:', err);

          });

        }

        Alert.alert(successTitle, successMessage);

      } else if (savedProject.isEvent) {

        closeProjectModal();

        showTaskSaveNotice('Event created. The new event was saved and is now visible in the live project flow.');

        const googleUrl = getGoogleCalendarEventUrl(projectToSave);

        Linking.openURL(googleUrl).catch(err => {

          console.error('Failed to open Google Calendar link:', err);

        });

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

      setIsSavingEvent(false);

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



    const selectedRecordType = selectedProject.isEvent ? 'Event' : 'Project';

    const projectToDelete = selectedProject;

    const doDelete = async () => {

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



        showTaskSaveNotice(`${projectToDelete.isEvent ? 'Event' : 'Project'} "${projectToDelete.title}" removed successfully.`, 1500);

      } catch (error) {

        // On error, reload to restore correct state

        await loadProjects();

        const errorMsg = getRequestErrorMessage(error, `Failed to delete ${selectedRecordType.toLowerCase()}.`);

        showConfirm({
          title: getRequestErrorTitle(error),
          message: errorMsg,
          confirmText: 'OK',
          cancelText: '',
          confirmColor: '#166534',
          icon: 'error-outline',
          iconColor: '#DC2626',
          onConfirm: () => {},
        });

      }

    };



    showConfirm({
      title: `Delete ${selectedRecordType}`,
      message: `Delete "${projectToDelete.title}"? This will remove its related join records, applications, and logs.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      icon: 'delete-outline',
      iconColor: '#DC2626',
      confirmColor: '#DC2626',
      loadingText: 'Deleting...',
      onConfirm: doDelete,
    });

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

    } catch (error) {

      setAllPartnerApplications(previousApplications);

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

    } catch (error) {

      setPartnerReports(previousReports);

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

    } catch (error) {

      setVolunteerMatches(previousVolunteerMatches);

      setAllVolunteerMatches(previousAllVolunteerMatches);

      setVolunteerJoinRecords(previousJoinRecords);

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



    showConfirm({
      title: 'Delete Project',
      message: `Delete "${project.title}"? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      icon: 'delete-outline',
      iconColor: '#DC2626',
      confirmColor: '#DC2626',
      loadingText: 'Deleting...',
      onConfirm: doDelete,
    });

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



  const getPendingVolunteerRequestCountForProject = (projectId: string) =>

    volunteerMatches.filter(match => match.projectId === projectId && match.status === 'Requested').length;



  // Builds the volunteer list displayed for a specific project.

  const getProjectVolunteerEntries = (project: Project) => {

    const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));

    const volunteerByUserId = new Map(

      volunteers

        .map(volunteer => [String(volunteer.userId || '').trim(), volunteer] as const)

        .filter(([userId]) => Boolean(userId))

    );

    const projectJoinRecords = volunteerJoinRecords.filter(record => record.projectId === project.id);

    const joinRecordByVolunteerId = new Map(

      projectJoinRecords.map(record => [record.volunteerId, record])

    );

    const joinRecordByVolunteerUserId = new Map(

      projectJoinRecords

        .filter(record => Boolean(record.volunteerUserId))

        .map(record => [record.volunteerUserId, record])

    );

    

    const relatedProjectIds = new Set<string>([

      String(project.id || '').trim(),

      String(project.parentProjectId || '').trim(),

    ].filter(Boolean));

    projects.forEach(candidate => {
      // Include child events (events where parentProjectId matches this project)
      if (candidate.isEvent && candidate.parentProjectId === project.id) {
        relatedProjectIds.add(String(candidate.id || '').trim());
      }


      const candidateTitle = String(candidate.title || '').trim().toLowerCase();

      if (candidateTitle && candidateTitle === String(project.title || '').trim().toLowerCase()) {

        relatedProjectIds.add(String(candidate.id || '').trim());

        if (candidate.parentProjectId) {

          relatedProjectIds.add(String(candidate.parentProjectId).trim());

        }

      }

    });



    const matchedVolunteerIds = allVolunteerMatches

      .filter(match => relatedProjectIds.has(String(match.projectId || '').trim()) && match.status === 'Matched')

      .map(match => match.volunteerId);

    const volunteerIds = Array.from(

      new Set([

        ...project.volunteers,

        ...((project.joinedUserIds || []) as string[]),

        ...projectJoinRecords.map(record => record.volunteerId),

        ...projectJoinRecords.map(record => record.volunteerUserId || '').filter(Boolean),

        ...matchedVolunteerIds,

      ])

    );



    return volunteerIds

      .map<ProjectVolunteerEntry | null>(volunteerId => {

        const volunteer = volunteerById.get(volunteerId) || volunteerByUserId.get(volunteerId) || null;

        const joinRecord = joinRecordByVolunteerId.get(volunteerId);

        const joinRecordByUserId = joinRecordByVolunteerUserId.get(volunteerId);

        const resolvedJoinRecord = joinRecord || joinRecordByUserId || null;

        if (!volunteer && !resolvedJoinRecord) {

          return null;

        }



        return {

          id: volunteer?.id || volunteerId,

          userId: volunteer?.userId || undefined,

          name: resolvedJoinRecord?.volunteerName || volunteer?.name || 'Volunteer',

          email: resolvedJoinRecord?.volunteerEmail || volunteer?.email || 'No email provided',

          joinedAt: resolvedJoinRecord?.joinedAt,

          source: resolvedJoinRecord?.source,

          participationStatus: resolvedJoinRecord?.participationStatus || 'Active',

          completedAt: resolvedJoinRecord?.completedAt,

          status: volunteer?.engagementStatus,

        };

      })

      .filter((entry): entry is ProjectVolunteerEntry => entry !== null)

      .filter((entry, index, self) => index === self.findIndex(e => e.id === entry.id))

      .sort((a, b) => {

        const left = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;

        const right = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;

        return right - left;

      });

  };

  const getProjectVolunteerSummary = (project: Project) => {
    const relatedProjects = project.isEvent
      ? [project]
      : projects.filter(candidate =>
          candidate.id === project.id ||
          (candidate.isEvent && candidate.parentProjectId === project.id)
        );
    const needed = relatedProjects.reduce(
      (total, candidate) => total + Math.max(0, Number(candidate.volunteersNeeded || 0)),
      0
    );

    return {
      count: getActiveProjectGroupJoinCount(project, projects, volunteerJoinRecords),
      needed,
    };
  };



  const getVolunteerProfileForMatch = (volunteerId: string) => {

    const matchById = volunteers.find(v => v.id === volunteerId) || null;

    if (matchById) return matchById;

    return volunteers.find(v => String(v.userId || '').trim() === String(volunteerId || '').trim()) || null;

  };



  const getVolunteerDisplayNameForMatch = (match: VolunteerProjectMatch) => {

    const volunteer = getVolunteerProfileForMatch(match.volunteerId);

    if (volunteer?.name) return volunteer.name;

    const rawId = String(match.volunteerId || '').trim();

    if (!rawId) return 'Unknown Volunteer';

    return rawId === 'volunteer-1' ? 'Volunteer 1' : `Volunteer ${rawId.slice(-4).toUpperCase()}`;

  };



  const getRelatedVolunteerApplicationMatches = (project: Project | null) => {

    if (!project) return [];



    const targetTitle = String(project.title || '').trim().toLowerCase();

    const relatedProjectIds = new Set<string>([

      String(project.id || '').trim(),

      String(project.parentProjectId || '').trim(),

    ].filter(Boolean));



    projects.forEach(candidate => {
      // Include child events (events where parentProjectId matches this project)
      if (candidate.isEvent && candidate.parentProjectId === project.id) {
        relatedProjectIds.add(String(candidate.id || '').trim());
      }


      const candidateTitle = String(candidate.title || '').trim().toLowerCase();

      if (candidateTitle && candidateTitle === targetTitle) {

        relatedProjectIds.add(String(candidate.id || '').trim());

        if (candidate.parentProjectId) {

          relatedProjectIds.add(String(candidate.parentProjectId).trim());

        }

      }

    });



    return selectedEventMatches.filter(match => relatedProjectIds.has(String(match.projectId || '').trim()));

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

      .map<ProjectVolunteerRequestEntry>(match => {

        const volunteer = volunteerById.get(match.volunteerId);



        return {

          id: match.id,

          volunteerId: volunteer?.id || match.volunteerId,

          volunteerUserId: volunteer?.userId || '',

          volunteerName: volunteer?.name || 'Volunteer',

          volunteerEmail: volunteer?.email || 'No email provided',

          requestedAt: match.requestedAt || match.matchedAt,

          reviewedAt: match.reviewedAt,

          reviewedBy: match.reviewedBy,

          status: match.status,

        };

      })

      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

  };



  const _executeSaveInternalTask = async () => {

    if (!isAdmin) {

      Alert.alert('Access Restricted', 'Only admin accounts can manage internal project tasks.');

      return;

    }



    const currentSelectedProject = getCurrentSelectedProject();

    if (!currentSelectedProject) {

      return;

    }



    if (!taskDraft.title.trim() || !taskDraft.description.trim()) {

      Alert.alert('Validation Error', 'Add a task title and description.');

      return;

    }



    const taskCategory = taskDraft.category.trim() || 'General';



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

    const previousAssignedIds = previousTask ? getTaskAssignedVolunteerIds(previousTask) : [];
    const newlyAssignedIds = normalizedAssignedVolunteerIds.filter(id => !previousAssignedIds.includes(id));
    const unassignedIds = previousAssignedIds.filter(id => !normalizedAssignedVolunteerIds.includes(id));

    const notificationAssignedVolunteers = newlyAssignedIds
      .map(volunteerId => volunteers.find(volunteer => volunteer.id === volunteerId || volunteer.userId === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null);

    const notificationPreviousVolunteers = unassignedIds
      .map(volunteerId => volunteers.find(volunteer => volunteer.id === volunteerId || volunteer.userId === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null);



    const nextTask: ProjectInternalTask = {

      id: editingTaskId || `${currentSelectedProject.id}-task-${Date.now()}`,

      title: taskDraft.title.trim(),

      description: taskDraft.description.trim(),

      category: taskCategory,

      priority: taskDraft.priority,

      status: taskStatus,

      assignedVolunteerId: normalizedAssignedVolunteerIds[0] || undefined,

      assignedVolunteerName: assignedVolunteers[0]?.name,

      assignedVolunteerIds: normalizedAssignedVolunteerIds.length ? normalizedAssignedVolunteerIds : undefined,

      assignedVolunteerNames: assignedVolunteers.length ? assignedVolunteers.map(volunteer => volunteer.name) : undefined,

      isFieldOfficer: taskDraft.isFieldOfficer,

      skillsNeeded: normalizedSkills,

      volunteersNeeded: Number(taskDraft.volunteersNeeded || normalizedAssignedVolunteerIds.length || 1),

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

          ? 'Event task update complete. Assignment changes were saved and volunteer notifications were sent.'

          : 'Event task added. Assignment changes were saved and volunteer notifications were sent.'

      );

      closeTaskModal();

    } catch (error) {

      Alert.alert(

        getRequestErrorTitle(error),

        getRequestErrorMessage(error, 'Failed to save the internal task.')

      );

    } finally {

      setIsSavingTask(false);
    }
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

    if (!taskDraft.title.trim() || !taskDraft.description.trim()) {
      Alert.alert('Validation Error', 'Add a task title and description.');
      return;
    }

    const normalizedSkills = Array.from(
      new Set(taskDraft.skillsNeeded.map(skill => skill.trim()).filter(Boolean))
    );

    if (normalizedSkills.length === 0) {
      Alert.alert('Validation Error', 'Select at least one skill for this task.');
      return;
    }

    const isEdit = Boolean(editingTaskId);
    showConfirm({
      title: isEdit ? 'Update Task' : 'Save Task',
      message: isEdit
        ? `Are you sure you want to save changes to "${taskDraft.title.trim()}"?`
        : `Are you sure you want to create and assign the task "${taskDraft.title.trim()}"?`,
      confirmText: isEdit ? 'Update Task' : 'Save Task',
      loadingText: 'Saving Task...',
      cancelText: 'Cancel',
      confirmColor: '#166534',
      icon: 'assignment' as any,
      iconColor: '#166534',
      onConfirm: async () => {
        setIsSavingTask(true);
        await _executeSaveInternalTask();
      },
    });
  };

  const handleRemoveSpecificVolunteerFromTask = (task: ProjectInternalTask, volunteerId: string, volunteerName?: string) => {
    const currentSelectedProject = getCurrentSelectedProject() || selectedProject;
    if (!currentSelectedProject) return;

    showConfirm({
      title: 'Remove Volunteer Assignment',
      message: `Are you sure you want to unassign ${volunteerName || 'this volunteer'} from the task "${task.title}"?`,
      confirmText: 'Remove',
      loadingText: 'Removing...',
      cancelText: 'Cancel',
      confirmColor: '#dc2626',
      icon: 'person-remove' as any,
      iconColor: '#dc2626',
      onConfirm: async () => {
        setIsRemovingVolunteerId(volunteerId);
        try {
          const existingIds = getTaskAssignedVolunteerIds(task);
          const nextIds = existingIds.filter(id => id !== volunteerId);
          const assignable = getAssignableVolunteerOptions(currentSelectedProject);
          const nextVolunteers = assignable.filter(v => nextIds.includes(v.id));

          const updatedTask: ProjectInternalTask = {
            ...task,
            assignedVolunteerId: nextIds[0] || undefined,
            assignedVolunteerName: nextVolunteers[0]?.name || undefined,
            assignedVolunteerIds: nextIds.length > 0 ? nextIds : undefined,
            assignedVolunteerNames: nextVolunteers.length > 0 ? nextVolunteers.map(v => v.name) : undefined,
            status: nextIds.length > 0 ? 'Assigned' : 'Unassigned',
          };

          const taskCards = Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : [];
          const updatedTasks = taskCards.map(t => t.id === task.id ? updatedTask : t);

          await saveProjectLikeRecord({ ...currentSelectedProject, internalTasks: updatedTasks });
          clearStorageCache(['projects', 'events']);
          setProjects(currentProjects =>
            currentProjects.map(p =>
              p.id === currentSelectedProject.id ? { ...currentSelectedProject, internalTasks: updatedTasks } : p
            )
          );
          setSelectedProject({ ...currentSelectedProject, internalTasks: updatedTasks });

          const targetVol = volunteers.find(v => v.id === volunteerId || v.userId === volunteerId);
          if (targetVol) {
            try {
              await notifyVolunteerAboutTaskUnassignment({
                event: currentSelectedProject,
                task,
                volunteer: targetVol,
                actorUserId: user?.id,
              });
            } catch (err) {
              console.warn('[TASK] Failed to notify volunteer about unassignment:', err);
            }
          }

          if (nextIds.length === 0) {
            setRemoveVolunteerPickerTaskId(null);
          }
        } catch (error) {
          Alert.alert(
            getRequestErrorTitle(error),
            getRequestErrorMessage(error, 'Failed to unassign volunteer from task.')
          );
        } finally {
          setIsRemovingVolunteerId(null);
        }
      },
    });
  };

  const handleRemoveAllVolunteersFromTask = (task: ProjectInternalTask) => {
    const currentSelectedProject = getCurrentSelectedProject() || selectedProject;
    if (!currentSelectedProject) return;
    const existingIds = getTaskAssignedVolunteerIds(task);
    if (existingIds.length === 0) return;

    showConfirm({
      title: 'Remove All Assigned Volunteers',
      message: `Are you sure you want to unassign all ${existingIds.length} volunteer(s) from "${task.title}"?`,
      confirmText: 'Remove All',
      loadingText: 'Removing...',
      cancelText: 'Cancel',
      confirmColor: '#dc2626',
      icon: 'person-remove' as any,
      iconColor: '#dc2626',
      onConfirm: async () => {
        setIsRemovingVolunteerId('ALL');
        try {
          const updatedTask: ProjectInternalTask = {
            ...task,
            assignedVolunteerId: undefined,
            assignedVolunteerName: undefined,
            assignedVolunteerIds: undefined,
            assignedVolunteerNames: undefined,
            status: 'Unassigned',
          };

          const taskCards = Array.isArray(currentSelectedProject.internalTasks) ? currentSelectedProject.internalTasks : [];
          const updatedTasks = taskCards.map(t => t.id === task.id ? updatedTask : t);

          await saveProjectLikeRecord({ ...currentSelectedProject, internalTasks: updatedTasks });
          clearStorageCache(['projects', 'events']);
          setProjects(currentProjects =>
            currentProjects.map(p =>
              p.id === currentSelectedProject.id ? { ...currentSelectedProject, internalTasks: updatedTasks } : p
            )
          );
          setSelectedProject({ ...currentSelectedProject, internalTasks: updatedTasks });

          for (const vid of existingIds) {
            const targetVol = volunteers.find(v => v.id === vid || v.userId === vid);
            if (targetVol) {
              try {
                await notifyVolunteerAboutTaskUnassignment({
                  event: currentSelectedProject,
                  task,
                  volunteer: targetVol,
                  actorUserId: user?.id,
                });
              } catch (err) {
                console.warn('[TASK] Failed to notify volunteer about unassignment:', err);
              }
            }
          }

          setRemoveVolunteerPickerTaskId(null);
        } catch (error) {
          Alert.alert(
            getRequestErrorTitle(error),
            getRequestErrorMessage(error, 'Failed to unassign all volunteers from task.')
          );
        } finally {
          setIsRemovingVolunteerId(null);
        }
      },
    });
  };



  const handleDeleteInternalTask = (taskId: string) => {

    const currentSelectedProject = getCurrentSelectedProject() || selectedProject;

    if (!isAdmin || !currentSelectedProject) {

      return;

    }



    const executeDelete = async () => {

      setIsDeletingTaskId(taskId);

      const current = getCurrentSelectedProject() || selectedProject;

      if (!current) return;

      const updatedProject: Project = {

        ...current,

        internalTasks: (Array.isArray(current.internalTasks) ? current.internalTasks : []).filter(task => task.id !== taskId),

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

        showTaskSaveNotice('Internal task removed successfully.', 1500);

      } catch (error) {

        showConfirm({

          title: getRequestErrorTitle(error),

          message: getRequestErrorMessage(error, 'Failed to delete the internal task.'),

          confirmText: 'OK',

          cancelText: '',

          confirmColor: '#166534',

          icon: 'error-outline',

          iconColor: '#DC2626',

          onConfirm: () => {},

        });

      } finally {

        setIsDeletingTaskId(null);

      }

    };



    showConfirm({

      title: 'Delete Task',

      message: 'Are you sure you want to delete this task? This action cannot be undone.',

      confirmText: 'Delete',

      cancelText: 'Cancel',

      icon: 'delete-outline',

      iconColor: '#DC2626',

      confirmColor: '#DC2626',

      loadingText: 'Deleting...',

      onConfirm: executeDelete,

    });

  };



  // Renders one project card in the lifecycle list.

  const renderProjectCard = (project: Project) => {

    const pendingRequestCount = getPendingVolunteerRequestCountForProject(project.id);

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



  const renderInlineProjectForm = (section: any) => {

    return (

      <InlineProjectForm

        projectDraft={projectDraft}

        handleProjectDraftChange={handleProjectDraftChange}

        projectRegionCode={projectRegionCode}

        handleProjectRegionChange={handleProjectRegionChange}

        projectCityCode={projectCityCode}

        handleProjectCityChange={handleProjectCityChange}

        projectBarangayCode={projectBarangayCode}

        handleProjectBarangayChange={handleProjectBarangayChange}

        projectPlaceVenue={projectPlaceVenue}

        setProjectPlaceVenue={setProjectPlaceVenue}

        PHRegions={PHRegions}

        projectLocationCities={projectLocationCities}

        projectLocationBarangays={projectLocationBarangays}

        handlePickProjectImage={handlePickProjectImage}

        handleRemoveProjectImage={handleRemoveProjectImage}

        handlePickProjectDocument={handlePickProjectDocument}

        applyProjectLocationSelectionFromAddress={applyProjectLocationSelectionFromAddress}

        setDatePickerMode={setDatePickerMode}

        setSelectedDate={setSelectedDate}

        setShowDatePicker={setShowDatePicker}

        handleSaveProjectRecord={handleSaveProjectRecord}

        closeProjectModal={closeProjectModal}

        editingProjectId={editingProjectId}

        projectSaveError={projectSaveError}

        isDesktop={isDesktop}

        programSections={programSections}

        format={format}

        handleSearchMapLocation={handleSearchMapLocation}

        handleMarkerPositionChange={handleMarkerPositionChange}

      />

    );

  };



  const renderInlineEventForm = (project: Project, section: any) => {

    return (

      <View style={{

        backgroundColor: '#fff',

        borderWidth: 1.5,

        borderColor: '#0f766e',

        borderRadius: 12,

        padding: 12,

        gap: 10,

        width: '100%',

      }}>

        <Text style={{ fontSize: 13, fontWeight: '800', color: '#0f766e', marginBottom: 2 }}>

          New Event for {project.title}

        </Text>



        {projectSaveError ? (

          <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 6, padding: 8 }}>

            <Text style={{ color: '#b91c1c', fontSize: 11, fontWeight: '600' }}>{projectSaveError}</Text>

          </View>

        ) : null}



        {/* Title */}

        <View style={{ gap: 2 }}>

          <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Event Title *</Text>

          <TextInput

            style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8, fontSize: 13, color: '#1e293b' }}

            placeholder="Enter event title"

            placeholderTextColor="#94a3b8"

            value={projectDraft.title}

            onChangeText={value => handleProjectDraftChange('title', value)}

          />

        </View>



        {/* Description */}

        <View style={{ gap: 2 }}>

          <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Description *</Text>

          <TextInput

            style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8, fontSize: 13, color: '#1e293b', minHeight: 50 }}

            placeholder="Describe the event..."

            placeholderTextColor="#94a3b8"

            multiline

            numberOfLines={2}

            value={projectDraft.description}

            onChangeText={value => handleProjectDraftChange('description', value)}

          />

        </View>



        {/* Dates */}

        <View style={{ flexDirection: 'row', gap: 8 }}>

          <View style={{ flex: 1, gap: 2 }}>

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Start Date *</Text>

            <TouchableOpacity

              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8 }}

              onPress={() => {

                setDatePickerMode('startDate');

                setSelectedDate(projectDraft.startDate ? new Date(projectDraft.startDate) : new Date());

                setShowDatePicker(true);

              }}

            >

              <Text style={{ fontSize: 12, color: projectDraft.startDate ? '#1e293b' : '#94a3b8', flex: 1 }}>

                {projectDraft.startDate || 'Select'}

              </Text>

              <MaterialIcons name="calendar-today" size={12} color="#64748b" />

            </TouchableOpacity>

          </View>



          <View style={{ flex: 1, gap: 2 }}>

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>End Date *</Text>

            <TouchableOpacity

              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8 }}

              onPress={() => {

                setDatePickerMode('endDate');

                setSelectedDate(projectDraft.endDate ? new Date(projectDraft.endDate) : new Date());

                setShowDatePicker(true);

              }}

            >

              <Text style={{ fontSize: 12, color: projectDraft.endDate ? '#1e293b' : '#94a3b8', flex: 1 }}>

                {projectDraft.endDate || 'Select'}

              </Text>

              <MaterialIcons name="calendar-today" size={12} color="#64748b" />

            </TouchableOpacity>

          </View>

        </View>



        {/* Barangay & Volunteer Slots */}

        <View style={{ flexDirection: 'row', gap: 8 }}>

          <View style={{ flex: 1, gap: 2 }}>

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Barangay *</Text>

            <View style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6 }}>

              <Picker

                selectedValue={projectBarangayCode}

                onValueChange={(itemValue: string) => handleProjectBarangayChange(itemValue)}

                enabled={projectCityCode !== ''}

                style={{ height: 36, color: '#1e293b' }}

              >

                <Picker.Item label="Select..." value="" />

                {projectLocationBarangays.map(barangay => (

                  <Picker.Item key={barangay.code} label={barangay.displayName} value={barangay.code} />

                ))}

              </Picker>

            </View>

          </View>



          <View style={{ flex: 1, gap: 2 }}>

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Slots *</Text>

            <TextInput

              style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8, fontSize: 12, color: '#1e293b' }}

              placeholder="Slots"

              placeholderTextColor="#94a3b8"

              keyboardType="number-pad"

              value={projectDraft.volunteersNeeded}

              onChangeText={value => handleProjectDraftChange('volunteersNeeded', value)}

            />

          </View>

        </View>



        {/* Volunteer Requirements (Quick Form) */}

        <View style={{ gap: 2, marginTop: 4 }}>

          <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Volunteer Requirements</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>

            {[

              '18 years old or above',

              'Must be physically fit for field activities',

              'Attend volunteer orientation',

              'Prior volunteer experience',

              'Wear appropriate clothing',

              'Complete required training',

              'Bring valid ID',

              'Submit required documents',

              'Attend event briefing'

            ].map(req => {

              const isChecked = (projectDraft.volunteerRequirements || []).includes(req);

              return (

                <TouchableOpacity

                  key={req}

                  onPress={() => {

                    const currentReqs = projectDraft.volunteerRequirements || [];

                    const nextReqs = currentReqs.includes(req)

                      ? currentReqs.filter(r => r !== req)

                      : [...currentReqs, req];

                    handleProjectDraftChange('volunteerRequirements', nextReqs);

                  }}

                  activeOpacity={0.8}

                  style={{

                    flexDirection: 'row',

                    alignItems: 'center',

                    width: '48%',

                    marginBottom: 4,

                    gap: 6

                  }}

                >

                  <MaterialIcons

                    name={isChecked ? 'check-box' : 'check-box-outline-blank'}

                    size={16}

                    color={isChecked ? '#166534' : '#64748b'}

                  />

                  <Text style={{ fontSize: 11, color: '#334155', flex: 1 }} numberOfLines={1}>{req}</Text>

                </TouchableOpacity>

              );

            })}

          </View>

        </View>



        {/* Actions */}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>

          <TouchableOpacity

            style={{ flex: 1, backgroundColor: '#f1f5f9', borderRadius: 6, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' }}

            onPress={closeProjectModal}

          >

            <Text style={{ color: '#475569', fontWeight: '700', fontSize: 12 }}>Cancel</Text>

          </TouchableOpacity>



          <TouchableOpacity

            style={{ flex: 1, backgroundColor: '#0f766e', borderRadius: 6, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' }}

            onPress={handleSaveProjectRecord}

          >

            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Create Event</Text>

          </TouchableOpacity>

        </View>

      </View>

    );

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

                  onPress={() => startInlineProjectCreation(section.module, section.title)}

                  activeOpacity={0.82}

                >

                  <MaterialIcons name="add" size={16} color="#fff" />

                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Create Project</Text>

                </TouchableOpacity>

              )}

            </View>



            <View style={[styles.eventProjectDivider, { backgroundColor: section.border }]} />



            {sectionProjects.length === 0 ? (

              activeInlineCreateProjectProgramId === section.module ? (

                renderInlineProjectForm(section)

              ) : (

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

                      onPress={() => startInlineProjectCreation(section.module, section.title)}

                      activeOpacity={0.82}

                    >

                      <MaterialIcons name="add-circle-outline" size={20} color="#fff" />

                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Create First Project</Text>

                    </TouchableOpacity>

                  )}

                </View>

              )

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

                          <View style={{ width: '100%' }}>

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



                            {activeInlineCreateEventProjectId === project.id ? (

                              <Pressable style={{ marginTop: 8, width: '100%' }} onPress={event => event.stopPropagation()}>

                                {renderInlineEventForm(project, section)}

                              </Pressable>

                            ) : (

                              <TouchableOpacity

                                style={{

                                  marginTop: 8,

                                  flexDirection: 'row',

                                  alignItems: 'center',

                                  justifyContent: 'center',

                                  gap: 4,

                                  paddingVertical: 8,

                                  borderRadius: 8,

                                  borderWidth: 1,

                                  borderStyle: 'dashed',

                                  borderColor: '#0f766e',

                                  backgroundColor: '#f0fdfa',

                                  width: '100%',

                                }}

                                onPress={(eventPress) => {

                                  eventPress.stopPropagation();

                                  startInlineEventCreation(project);

                                }}

                                activeOpacity={0.8}

                              >

                                <MaterialIcons name="event" size={14} color="#0f766e" />

                                <Text style={{ color: '#0f766e', fontWeight: '700', fontSize: 11 }}>+ Create Event</Text>

                              </TouchableOpacity>

                            )}

                          </View>

                        )}

                      </TouchableOpacity>

                    );

                  })}

                </View>

                {activeInlineCreateProjectProgramId === section.module ? (

                  renderInlineProjectForm(section)

                ) : (

                  isAdmin && (

                    <View style={{ marginTop: 12, marginBottom: 4 }}>

                      <TouchableOpacity

                        style={{

                          flexDirection: 'row',

                          alignItems: 'center',

                          justifyContent: 'center',

                          gap: 8,

                          paddingVertical: 14,

                          borderRadius: 10,

                          borderWidth: 2,

                          borderStyle: 'dashed',

                          borderColor: section.accent,

                          backgroundColor: section.surface,

                        }}

                        onPress={() => startInlineProjectCreation(section.module, section.title)}

                        activeOpacity={0.8}

                      >

                        <MaterialIcons name="add" size={20} color={section.accent} />

                        <Text style={{ color: section.accent, fontWeight: '700', fontSize: 14 }}>Create Project</Text>

                      </TouchableOpacity>

                    </View>

                  )

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



              {/* Background Image Upload */}

              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Background Image (optional)</Text>

              <View style={{

                borderWidth: 1,

                borderColor: '#cbd5e1',

                borderStyle: 'dashed',

                borderRadius: 8,

                padding: 16,

                alignItems: 'center',

                backgroundColor: '#f8fafc',

                marginBottom: 20

              }}>

                {programDraft.imageUrl ? (

                  <View style={{ alignItems: 'center', marginBottom: 12 }}>

                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#166534', marginBottom: 8 }}>

                      Image uploaded successfully

                    </Text>

                    {isImageMediaUri(programDraft.imageUrl) ? (

                      <Image

                        source={{ uri: programDraft.imageUrl }}

                        style={{ width: 120, height: 80, borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0' }}

                        resizeMode="cover"

                      />

                    ) : null}

                  </View>

                ) : (

                  <View style={{ alignItems: 'center', marginBottom: 12 }}>

                    <MaterialIcons name="image" size={24} color="#94a3b8" style={{ marginBottom: 4 }} />

                    <Text style={{ fontSize: 12, color: '#64748b' }}>No image uploaded yet</Text>

                  </View>

                )}



                <View style={{ flexDirection: 'row', gap: 10 }}>

                  <TouchableOpacity

                    style={styles.uploadButtonGreenOutline}

                    onPress={handlePickProgramImage}

                  >

                    <MaterialIcons name="cloud-upload" size={14} color="#166534" style={{ marginRight: 4 }} />

                    <Text style={styles.uploadButtonGreenOutlineText}>

                      {programDraft.imageUrl ? 'Replace Image' : 'Upload Image'}

                    </Text>

                  </TouchableOpacity>



                  {programDraft.imageUrl ? (

                    <TouchableOpacity

                      style={styles.uploadRemoveButtonRedOutline}

                      onPress={handleRemoveProgramImage}

                    >

                      <MaterialIcons name="delete-outline" size={14} color="#ef4444" style={{ marginRight: 4 }} />

                      <Text style={styles.uploadRemoveButtonRedOutlineText}>Remove</Text>

                    </TouchableOpacity>

                  ) : null}

                </View>

              </View>

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



  const renderDatePickerModal = () => {

    const eventDateMin = projectDraft.isEvent && projectDraftParentProject

      ? getDateOnlyBoundary(projectDraftParentProject.startDate)

      : undefined;

    const eventDateMax = projectDraft.isEvent && projectDraftParentProject

      ? getDateOnlyBoundary(projectDraftParentProject.endDate, true)

      : undefined;



    return (

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

              const dateString = year + '-' + month + '-' + day;

              handleProjectDraftChange(datePickerMode as any, dateString);

              setShowDatePicker(false);

            }}

            onClose={() => setShowDatePicker(false)}

          />

        </View>

      </Modal>

    );

  };



  const handleOpenVolunteerApplications = async (projectId: string) => {

    try {

      setEventWorkspaceTab('Attendance');

      const selected = projects.find(project => project.id === projectId) || null;

      const projectIds = new Set<string>([projectId]);

      if (selected?.parentProjectId) {

        projectIds.add(String(selected.parentProjectId).trim());

      }

      const targetTitle = String(selected?.title || '').trim().toLowerCase();

      projects.forEach(project => {

        if (String(project.title || '').trim().toLowerCase() === targetTitle) {

          projectIds.add(String(project.id || '').trim());

          if (project.parentProjectId) {

            projectIds.add(String(project.parentProjectId).trim());

          }

        }

      });

      const matches = (await getAllVolunteerProjectMatches()).filter(match =>

        projectIds.has(String(match.projectId || '').trim())

      );

      setSelectedEventMatches(matches || []);

      

      // Default to first match if available

      if (matches && matches.length > 0) {

        setSelectedMatch(matches[0]);

      } else {

        setSelectedMatch(null);

      }

      

      setShowVolunteerApplicationsModal(true);

    } catch (error) {

      Alert.alert('Error', getRequestErrorMessage(error, 'Failed to load volunteer matches.'));

    }

  };



  const handleReviewApplication = async (matchId: string, status: 'Matched' | 'Rejected') => {
    if (!user?.id) return;
    try {
      setReviewActionLoadingId(`${matchId}-${status}`);
      const currentMatch =
        selectedEventMatches.find(match => match.id === matchId) ||
        (selectedMatch?.id === matchId ? selectedMatch : null);
      if (!currentMatch) {
        throw new Error('Volunteer application was not found. Refresh the event and try again.');
      }

      const reviewTargetMatch =
        activeSelectedProject?.isEvent &&
        currentMatch.projectId !== activeSelectedProject.id
          ? { ...currentMatch, projectId: activeSelectedProject.id }
          : currentMatch;

      if (reviewTargetMatch.projectId !== currentMatch.projectId) {
        await saveVolunteerProjectMatch(reviewTargetMatch);
        setSelectedEventMatches(prev =>
          prev.map(m => m.id === matchId ? reviewTargetMatch : m)
        );
        setSelectedMatch(prev =>
          prev && prev.id === matchId ? reviewTargetMatch : prev
        );
      }

      const updatedMatchRecord = await reviewVolunteerProjectMatch(matchId, status, user.id);

      // 1. Immediately update local selectedEventMatches and selectedMatch state
      setSelectedEventMatches(prev =>
        prev.map(m => m.id === matchId ? { ...m, ...updatedMatchRecord, status } : m)
      );
      setSelectedMatch(prev =>
        prev && prev.id === matchId ? { ...prev, ...updatedMatchRecord, status } : prev
      );

      // 2. Fetch fresh matches from storage to ensure total synchronization
      const allMatches = await getAllVolunteerProjectMatches();
      if (activeSelectedProject) {
        const targetTitle = String(activeSelectedProject.title || '').trim().toLowerCase();
        const projectIds = new Set<string>([
          String(activeSelectedProject.id || '').trim(),
          String(activeSelectedProject.parentProjectId || '').trim(),
        ].filter(Boolean));
        projects.forEach(candidate => {
          const candidateTitle = String(candidate.title || '').trim().toLowerCase();
          if (candidateTitle && candidateTitle === targetTitle) {
            projectIds.add(String(candidate.id || '').trim());
            if (candidate.parentProjectId) {
              projectIds.add(String(candidate.parentProjectId).trim());
            }
          }
        });
        const freshMatches = allMatches.filter(m => projectIds.has(String(m.projectId || '').trim()));
        setSelectedEventMatches(freshMatches);
        const refetchedMatch = freshMatches.find(m => m.id === matchId);
        if (refetchedMatch) {
          setSelectedMatch(refetchedMatch);
        }
      }

      // 3. Trigger project & volunteer reloads across the screen
      void loadAllVolunteerMatches();
      if (activeSelectedProject) {
        void loadVolunteerMatchesForProject(activeSelectedProject.id);
        void loadVolunteerJoinsForProject(activeSelectedProject.id);
      }
      void loadVolunteers();
      void loadProjects();
      await handleRefreshProjectDetails();
      setReviewerNotes('');

      Alert.alert('Success', `Application successfully ${status === 'Matched' ? 'approved' : 'declined'}!`);
    } catch (error) {
      console.error('Failed to review application:', error);
      Alert.alert('Error', getRequestErrorMessage(error, `Failed to review application.`));
    } finally {
      setReviewActionLoadingId(null);
    }
  };



  const renderVolunteerApplicationsModal = () => {

    // 1. Calculate statistics

    const totalSlots = activeSelectedProject?.volunteersNeeded || 0;

    const applicationMatches = getRelatedVolunteerApplicationMatches(activeSelectedProject);

    const totalApplicationsCount = applicationMatches.length;

    const approvedCount = applicationMatches.filter(m => m.status === 'Matched').length;

    const pendingCount = applicationMatches.filter(m => m.status === 'Requested').length;

    const declinedCount = applicationMatches.filter(m => m.status === 'Rejected').length;



    // 2. Filter matches

    const filteredMatches = applicationMatches.filter(m => {

      if (applicantFilter === 'Pending' && m.status !== 'Requested') return false;

      if (applicantFilter === 'Approved' && m.status !== 'Matched') return false;

      if (applicantFilter === 'Rejected' && m.status !== 'Rejected') return false;



      if (applicantSearchQuery.trim()) {

        const query = applicantSearchQuery.toLowerCase();

        const volunteer = getVolunteerProfileForMatch(m.volunteerId);

        const fallbackName = (m as any).volunteerName || '';

        const fallbackEmail = (m as any).volunteerEmail || '';

        return (

          (volunteer?.name || fallbackName).toLowerCase().includes(query) ||

          (volunteer?.email || fallbackEmail).toLowerCase().includes(query)

        );

      }



      return true;

    });



    // 3. Sort matches

    filteredMatches.sort((a, b) => {

      const dateA = new Date(a.requestedAt || a.matchedAt || 0).getTime();

      const dateB = new Date(b.requestedAt || b.matchedAt || 0).getTime();

      return applicantSort === 'Newest' ? dateB - dateA : dateA - dateB;

    });



    const pendingReviewMatches = filteredMatches.filter(m => m.status === 'Requested');

    const approvedMatches = filteredMatches.filter(m => m.status === 'Matched');

    const rejectedMatches = filteredMatches.filter(m => m.status === 'Rejected');



    // Helper functions for details panel

    const selectedVolunteer = selectedMatch

      ? getVolunteerProfileForMatch(selectedMatch.volunteerId)

      : null;

    const selectedVolunteerName = selectedMatch ? getVolunteerDisplayNameForMatch(selectedMatch) : 'Volunteer';



    const renderRequirementsChecklist = (volunteer: Volunteer) => {

      const requirements = activeSelectedProject?.volunteerRequirements || [

        '18 years old or above',

        'Attend volunteer orientation',

        'Wear appropriate clothing',

        'Bring valid ID',

        'Prior volunteer experience',

      ];



      return requirements.map((req, idx) => {

        let isChecked = false;

        const lowerReq = req.toLowerCase();

        if (lowerReq.includes('18')) {

          isChecked = true;

        } else if (lowerReq.includes('orientation') || lowerReq.includes('clothing') || lowerReq.includes('id')) {

          isChecked = true;

        } else if (lowerReq.includes('skill')) {

          const skillName = req.replace(/skill/gi, '').trim().toLowerCase();

          isChecked = volunteer.skills.some(s => s.toLowerCase().includes(skillName));

        } else if (volunteer.skills.some(s => lowerReq.includes(s.toLowerCase()))) {

          isChecked = true;

        }



        return (

          <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }} {...({} as any)}>

            <MaterialIcons

              name={isChecked ? 'check-circle' : 'radio-button-unchecked'}

              size={18}

              color={isChecked ? '#166534' : '#94a3b8'}

              style={{ marginRight: 8 }}

            />

            <Text style={{ fontSize: 13, color: '#334155' }}>

              {req}

            </Text>

          </View>

        );

      });

    };



    const renderAvatar = (name: string, size = 40) => {

      const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

      const colors = ['#0284c7', '#166534', '#b45309', '#be185d', '#6d28d9', '#4d7c0f'];

      const charCodeSum = initials.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);

      const bgColor = colors[charCodeSum % colors.length];



      return (

        <View style={{

          width: size,

          height: size,

          borderRadius: size / 2,

          backgroundColor: bgColor,

          justifyContent: 'center',

          alignItems: 'center',

          marginRight: 12

        }} {...({} as any)}>

          <Text style={{ fontSize: size * 0.4, fontWeight: '700', color: '#ffffff' }}>

            {initials}

          </Text>

        </View>

      );

    };



    const formatAppliedTime = (dateStr?: string) => {

      if (!dateStr) return 'Applied recently';

      const date = new Date(dateStr);

      const dayLabel = format(date, 'MMM d, yyyy');

      const diffTime = Math.abs(new Date().getTime() - date.getTime());

      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) return `Applied today`;

      if (diffDays === 1) return `Applied yesterday`;

      return `Applied ${dayLabel} (${diffDays} days ago)`;

    };



    const isWeb = getPlatformOS() === 'web';

    const isLayoutSplit = isDesktop && isWeb;



    if (!showVolunteerApplicationsModal) return null;



    const modalContent = (

      <View style={{

        flex: 1,

        backgroundColor: '#ffffff',

        overflow: 'hidden'

      }} {...({} as any)}>

            

            {/* 1. Header Row */}

            <View style={{

              flexDirection: 'row',

              justifyContent: 'space-between',

              alignItems: 'center',

              paddingHorizontal: 24,

              paddingVertical: 18,

              borderBottomWidth: 1,

              borderBottomColor: '#f1f5f9'

            }} {...({} as any)}>

              <View style={{ flexDirection: 'row', alignItems: 'center' }}>

                <View style={{

                  width: 42,

                  height: 42,

                  borderRadius: 21,

                  backgroundColor: '#f0fdf4',

                  justifyContent: 'center',

                  alignItems: 'center',

                  marginRight: 12

                }} {...({} as any)}>

                  <MaterialIcons name="people" size={24} color="#166534" />

                </View>

                <View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>

                    <Text style={{ fontSize: 20, fontWeight: '800', color: '#0f172a' }}>

                      Volunteer Applications

                    </Text>

                    <View style={{

                      paddingHorizontal: 8,

                      paddingVertical: 2,

                      borderRadius: 12,

                      backgroundColor: '#e6f4ea'

                    }} {...({} as any)}>

                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#137333' }}>Open</Text>

                    </View>

                  </View>

                  <Text style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>

                    {activeSelectedProject?.title || 'Event Details'}

                  </Text>

                </View>

              </View>

              <TouchableOpacity

                onPress={() => setShowVolunteerApplicationsModal(false)}

                style={{ padding: 6, borderRadius: 8, backgroundColor: '#f1f5f9' }}

              >

                <MaterialIcons name="close" size={20} color="#64748b" />

              </TouchableOpacity>

            </View>



            {/* Main content split view */}

            <View style={{ flex: 1, flexDirection: 'row' }}>

              

              {/* Left Column (List & Stats) */}

              <View style={{

                flex: isLayoutSplit && selectedVolunteer ? 1.4 : 1,

                borderRightWidth: isLayoutSplit && selectedVolunteer ? 1 : 0,

                borderRightColor: '#e2e8f0',

                backgroundColor: '#ffffff'

              }}>

                

                {/* Scrollable List Container */}

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={true}>

                  

                  {/* 2. Stat Cards Grid */}

                  <View style={{

                    flexDirection: 'row',

                    flexWrap: 'wrap',

                    gap: 12,

                    marginBottom: 24

                  }} {...({} as any)}>

                    {[

                      { label: 'Volunteer Slots', val: totalSlots, sub: 'Total slots', color: '#0f172a' },

                      { label: 'Applications', val: totalApplicationsCount, sub: 'All time', color: '#0284c7' },

                      { label: 'Approved', val: approvedCount, sub: 'Confirmed', color: '#166534' },

                      { label: 'Pending Review', val: pendingCount, sub: 'To review', color: '#b45309' },

                      { label: 'Declined', val: declinedCount, sub: 'Not selected', color: '#be185d' }

                    ].map((stat, idx) => (

                      <View

                        key={idx}

                        style={{

                          flex: 1,

                          minWidth: 100,

                          backgroundColor: '#f8fafc',

                          borderRadius: 12,

                          borderWidth: 1,

                          borderColor: '#e2e8f0',

                          padding: 14,

                          alignItems: 'center'

                        }}

                        {...({} as any)}

                      >

                        <Text style={{ fontSize: 24, fontWeight: '800', color: stat.color, marginBottom: 2 }}>{stat.val}</Text>

                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155', textAlign: 'center', marginBottom: 2 }}>{stat.label}</Text>

                        <Text style={{ fontSize: 10, color: '#64748b' }}>{stat.sub}</Text>

                      </View>

                    ))}

                  </View>



                  {/* 3. Control Filter Bar */}

                  <View style={{

                    flexDirection: 'row',

                    flexWrap: 'wrap',

                    justifyContent: 'space-between',

                    alignItems: 'center',

                    gap: 12,

                    marginBottom: 24

                  }} {...({} as any)}>

                    {/* Search bar */}

                    <View style={{

                      flexDirection: 'row',

                      alignItems: 'center',

                      backgroundColor: '#f1f5f9',

                      borderRadius: 10,

                      paddingHorizontal: 12,

                      paddingVertical: 8,

                      flex: 1,

                      minWidth: 200

                    }} {...({} as any)}>

                      <MaterialIcons name="search" size={18} color="#64748b" style={{ marginRight: 8 }} />

                      <TextInput

                        placeholder="Search applicants..."

                        value={applicantSearchQuery}

                        onChangeText={setApplicantSearchQuery}

                        style={{ flex: 1, fontSize: 13, color: '#0f172a', padding: 0 }}

                      />

                    </View>



                    {/* Filter buttons */}

                    <View style={{ flexDirection: 'row', gap: 8 }}>

                      {(['All', 'Pending', 'Approved', 'Rejected'] as const).map((filterOpt) => (

                        <TouchableOpacity

                          key={filterOpt}

                          onPress={() => setApplicantFilter(filterOpt)}

                          style={{

                            paddingHorizontal: 12,

                            paddingVertical: 8,

                            borderRadius: 8,

                            backgroundColor: applicantFilter === filterOpt ? '#166534' : '#f1f5f9',

                            borderWidth: 1,

                            borderColor: applicantFilter === filterOpt ? '#166534' : '#e2e8f0'

                          }}

                        >

                          <Text style={{

                            fontSize: 12,

                            fontWeight: '700',

                            color: applicantFilter === filterOpt ? '#ffffff' : '#475569'

                          }}>

                            {filterOpt}

                          </Text>

                        </TouchableOpacity>

                      ))}

                    </View>

                  </View>



                  {/* 4. Pending Review List Section */}

                  {pendingReviewMatches.length > 0 && (

                    <View style={{ marginBottom: 24 }} {...({} as any)}>

                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>

                        Pending Review ({pendingReviewMatches.length})

                      </Text>

                      {pendingReviewMatches.map((match) => {

                        const name = getVolunteerDisplayNameForMatch(match);

                        const skillCategory = 'Joined Volunteer';



                        return (

                          <TouchableOpacity

                            key={match.id}

                            onPress={() => setSelectedMatch(match)}

                            style={{

                              flexDirection: 'row',

                              justifyContent: 'space-between',

                              alignItems: 'center',

                              padding: 16,

                              backgroundColor: selectedMatch?.id === match.id ? '#f0fdf4' : '#ffffff',

                              borderRadius: 12,

                              borderWidth: 1,

                              borderColor: selectedMatch?.id === match.id ? '#166534' : '#e2e8f0',

                              marginBottom: 12

                            }}

                            {...({} as any)}

                          >

                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>

                              <View style={{ width: 20, height: 20, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 4, marginRight: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: selectedMatch?.id === match.id ? '#166534' : '#ffffff' }} {...({} as any)}>

                                {selectedMatch?.id === match.id && <MaterialIcons name="check" size={14} color="#ffffff" />}

                              </View>

                              {renderAvatar(name, 40)}

                              <View style={{ flex: 1 }}>

                                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{name}</Text>

                                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{skillCategory}</Text>

                                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{formatAppliedTime(match.requestedAt)}</Text>

                              </View>

                            </View>



                            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>

                              <TouchableOpacity style={{ padding: 4 }} onPress={() => setSelectedMatch(match)}>

                                <MaterialIcons name="description" size={16} color="#64748b" />

                              </TouchableOpacity>

                              <TouchableOpacity style={{ padding: 4 }} onPress={() => setSelectedMatch(match)}>

                                <MaterialIcons name="chat" size={16} color="#64748b" />

                              </TouchableOpacity>

                              

                              <TouchableOpacity

                                onPress={() => setSelectedMatch(match)}

                                style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f1f5f9', borderRadius: 6, marginLeft: 8 }}

                              >

                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>View</Text>

                              </TouchableOpacity>

                            </View>

                          </TouchableOpacity>

                        );

                      })}

                    </View>

                  )}



                  {/* 5. Approved List Section */}

                  {approvedMatches.length > 0 && (

                    <View style={{ marginBottom: 24 }} {...({} as any)}>

                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>

                        Approved ({approvedMatches.length})

                      </Text>

                      {approvedMatches.map((match) => {

                        const name = getVolunteerDisplayNameForMatch(match);

                        const skillCategory = 'Joined Volunteer';



                        return (

                          <TouchableOpacity

                            key={match.id}

                            onPress={() => setSelectedMatch(match)}

                            style={{

                              flexDirection: 'row',

                              justifyContent: 'space-between',

                              alignItems: 'center',

                              padding: 16,

                              backgroundColor: selectedMatch?.id === match.id ? '#f0fdf4' : '#ffffff',

                              borderRadius: 12,

                              borderWidth: 1,

                              borderColor: selectedMatch?.id === match.id ? '#166534' : '#e2e8f0',

                              marginBottom: 12

                            }}

                            {...({} as any)}

                          >

                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>

                              <View style={{ width: 20, height: 20, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 4, marginRight: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: selectedMatch?.id === match.id ? '#166534' : '#ffffff' }} {...({} as any)}>

                                {selectedMatch?.id === match.id && <MaterialIcons name="check" size={14} color="#ffffff" />}

                              </View>

                              {renderAvatar(name, 40)}

                              <View style={{ flex: 1 }}>

                                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{name}</Text>

                                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{skillCategory}</Text>

                                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Approved {match.matchedAt ? format(new Date(match.matchedAt), 'MMM d, yyyy') : ''}</Text>

                              </View>

                            </View>



                            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>

                              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#e6f4ea' }} {...({} as any)}>

                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#137333' }}>APPROVED</Text>

                              </View>

                              <TouchableOpacity

                                onPress={() => setSelectedMatch(match)}

                                style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f1f5f9', borderRadius: 6 }}

                              >

                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>View</Text>

                              </TouchableOpacity>

                              <TouchableOpacity style={{ padding: 4 }}>

                                <MaterialIcons name="more-vert" size={18} color="#64748b" />

                              </TouchableOpacity>

                            </View>

                          </TouchableOpacity>

                        );

                      })}

                    </View>

                  )}



                  {/* 6. Rejected List Section */}

                  {rejectedMatches.length > 0 && (

                    <View style={{ marginBottom: 24 }} {...({} as any)}>

                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>

                        Declined ({rejectedMatches.length})

                      </Text>

                      {rejectedMatches.map((match) => {

                        const name = getVolunteerDisplayNameForMatch(match);

                        const skillCategory = 'Joined Volunteer';



                        return (

                          <TouchableOpacity

                            key={match.id}

                            onPress={() => setSelectedMatch(match)}

                            style={{

                              flexDirection: 'row',

                              justifyContent: 'space-between',

                              alignItems: 'center',

                              padding: 16,

                              backgroundColor: selectedMatch?.id === match.id ? '#fef2f2' : '#ffffff',

                              borderRadius: 12,

                              borderWidth: 1,

                              borderColor: selectedMatch?.id === match.id ? '#ef4444' : '#e2e8f0',

                              marginBottom: 12

                            }}

                            {...({} as any)}

                          >

                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>

                              {renderAvatar(name, 40)}

                              <View style={{ flex: 1 }}>

                                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{name}</Text>

                                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{skillCategory}</Text>

                              </View>

                            </View>



                            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>

                              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#fce8e6' }} {...({} as any)}>

                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#c5221f' }}>DECLINED</Text>

                              </View>

                              <TouchableOpacity

                                onPress={() => setSelectedMatch(match)}

                                style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f1f5f9', borderRadius: 6 }}

                              >

                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>View</Text>

                              </TouchableOpacity>

                            </View>

                          </TouchableOpacity>

                        );

                      })}

                    </View>

                  )}



                  {filteredMatches.length === 0 && (

                    <View style={{ paddingVertical: 40, alignItems: 'center' }} {...({} as any)}>

                      <Text style={{ fontSize: 14, color: '#64748b' }}>No matches fit the selected filters.</Text>

                    </View>

                  )}



                </ScrollView>

              </View>



              {/* Right Column (Applicant Details Panel) */}

              {(isLayoutSplit || !isLayoutSplit && selectedMatch) && (

                <View style={{

                  flex: 1,

                  backgroundColor: '#ffffff',

                  display: !isLayoutSplit && !selectedMatch ? 'none' : 'flex'

                }}>

                  {selectedMatch ? (

                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={true}>

                      

                      {/* Back button on mobile */}

                      {!isLayoutSplit && (

                        <TouchableOpacity

                          onPress={() => setSelectedMatch(null)}

                          style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}

                        >

                          <MaterialIcons name="arrow-back" size={20} color="#166534" />

                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#166534', marginLeft: 6 }}>

                            Back to applicants

                          </Text>

                        </TouchableOpacity>

                      )}



                      {/* Header Card */}

                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }} {...({} as any)}>

                        {renderAvatar(selectedVolunteerName, 56)}

                        <View style={{ flex: 1 }}>

                          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>

                            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>

                              {selectedVolunteerName}

                            </Text>

                            <View style={{

                              paddingHorizontal: 8,

                              paddingVertical: 2,

                              borderRadius: 6,

                              backgroundColor: selectedMatch.status === 'Matched' ? '#e6f4ea' : selectedMatch.status === 'Rejected' ? '#fce8e6' : '#fef7e0'

                            }} {...({} as any)}>

                              <Text style={{

                                fontSize: 10,

                                fontWeight: '800',

                                color: selectedMatch.status === 'Matched' ? '#137333' : selectedMatch.status === 'Rejected' ? '#c5221f' : '#b06000'

                              }}>

                                {selectedMatch.status === 'Matched' ? 'APPROVED' : selectedMatch.status === 'Rejected' ? 'DECLINED' : 'PENDING'}

                              </Text>

                            </View>

                          </View>

                          <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>

                            Application ID: VOL-2026-{(selectedMatch.id || '').substring(0, 4).toUpperCase()}

                          </Text>

                          <View style={{ flexDirection: 'row', marginTop: 6 }}>

                            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: '#f0fdf4' }} {...({} as any)}>

                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#166534' }}>

                                {selectedVolunteer?.skills?.[0] || 'Community Outreach'}

                              </Text>

                            </View>

                          </View>

                        </View>

                      </View>



                      {/* Contact Info */}

                      <View style={{ marginBottom: 24 }} {...({} as any)}>

                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>

                          Contact Information

                        </Text>

                        <View style={{ gap: 8 }}>

                          <View style={{ flexDirection: 'row', alignItems: 'center' }} {...({} as any)}>

                            <MaterialIcons name="email" size={16} color="#64748b" style={{ marginRight: 10 }} />

                            <Text style={{ fontSize: 13, color: '#334155' }}>{selectedVolunteer?.email || (selectedMatch as any).volunteerEmail || 'No email provided'}</Text>

                          </View>

                          <View style={{ flexDirection: 'row', alignItems: 'center' }} {...({} as any)}>

                            <MaterialIcons name="phone" size={16} color="#64748b" style={{ marginRight: 10 }} />

                            <Text style={{ fontSize: 13, color: '#334155' }}>{selectedVolunteer?.phone || '0917 123 4567'}</Text>

                          </View>

                          <View style={{ flexDirection: 'row', alignItems: 'center' }} {...({} as any)}>

                            <MaterialIcons name="location-on" size={16} color="#64748b" style={{ marginRight: 10 }} />

                            <Text style={{ fontSize: 13, color: '#334155' }}>{selectedVolunteer?.homeAddress || 'Brgy. Alangilan, Bacolod City'}</Text>

                          </View>

                        </View>

                      </View>



                      {/* Documents */}

                      <View style={{ marginBottom: 24 }} {...({} as any)}>

                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>

                          Documents

                        </Text>

                        <View style={{ gap: 8 }}>

                          {[

                            { name: 'Valid ID', uri: '' },

                            ...(selectedVolunteer?.certificationsOrTrainings ? [{ name: 'Training Certificate', uri: selectedVolunteer.certificationsOrTrainings }] : [])

                          ].map((doc, idx) => (

                            <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }} {...({} as any)}>

                              <View style={{ flexDirection: 'row', alignItems: 'center' }} {...({} as any)}>

                                <MaterialIcons name="attachment" size={16} color="#64748b" style={{ marginRight: 8 }} />

                                <Text style={{ fontSize: 13, color: '#334155' }}>{doc.name}</Text>

                              </View>

                              {doc.uri ? (

                                <TouchableOpacity

                                  onPress={async () => {

                                    try {

                                      await openAttachmentUri(doc.uri);

                                    } catch (error: any) {

                                      Alert.alert(

                                        'Document View Failed',

                                        error?.message || 'Unable to open document.',

                                      );

                                    }

                                  }}

                                  style={{ padding: 6, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8 }}

                                >

                                  <MaterialIcons name="visibility" size={16} color="#166534" />

                                </TouchableOpacity>

                              ) : (

                                <Text style={{ fontSize: 12, color: '#94a3b8' }}>Missing</Text>

                              )}

                            </View>

                          ))}

                          {selectedVolunteer?.certificationsOrTrainings && isImageMediaUri(selectedVolunteer.certificationsOrTrainings || '') ? (

                            <Text style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>

                              {getAttachmentLabel(selectedVolunteer.certificationsOrTrainings || '')}

                            </Text>

                          ) : null}

                        </View>

                      </View>



                                         {/* Review Section */}
                      {selectedMatch.status === 'Requested' ? (
                        <View style={{ marginBottom: 24 }} {...({} as any)}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Review
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                            Reviewer Notes (optional)
                          </Text>
                          <TextInput
                            placeholder="Add notes about this application..."
                            value={reviewerNotes}
                            onChangeText={setReviewerNotes}
                            multiline={true}
                            numberOfLines={3}
                            style={{
                              borderWidth: 1,
                              borderColor: '#cbd5e1',
                              borderRadius: 8,
                              padding: 10,
                              fontSize: 13,
                              color: '#0f172a',
                              backgroundColor: '#ffffff',
                              textAlignVertical: 'top',
                              minHeight: 64,
                              marginBottom: 16
                            }}
                            {...({} as any)}
                          />
                          <View style={{ flexDirection: 'row', gap: 12 }} {...({} as any)}>
                            <TouchableOpacity
                              onPress={() => handleReviewApplication(selectedMatch.id, 'Rejected')}
                              style={{
                                flex: 1,
                                paddingVertical: 12,
                                backgroundColor: '#ffffff',
                                borderWidth: 1,
                                borderColor: '#ef4444',
                                borderRadius: 8,
                                justifyContent: 'center',
                                alignItems: 'center'
                              }}
                              disabled={reviewActionLoadingId !== null}
                            >
                              <Text style={{ fontSize: 14, fontWeight: '700', color: '#ef4444' }}>Decline</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleReviewApplication(selectedMatch.id, 'Matched')}
                              style={{
                                flex: 2,
                                paddingVertical: 12,
                                backgroundColor: '#166534',
                                borderRadius: 8,
                                justifyContent: 'center',
                                alignItems: 'center',
                                flexDirection: 'row',
                                gap: 6
                              }}
                              disabled={reviewActionLoadingId !== null}
                            >
                              {reviewActionLoadingId === `${selectedMatch.id}-Matched` ? (
                                <ActivityIndicator size="small" color="#ffffff" />
                              ) : (
                                <>
                                  <MaterialIcons name="check" size={18} color="#ffffff" />
                                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#ffffff' }}>Approve Volunteer</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : selectedMatch.status === 'Matched' ? (
                        <View style={{
                          backgroundColor: '#f0fdf4',
                          borderWidth: 1,
                          borderColor: '#bbf7d0',
                          borderRadius: 8,
                          padding: 14,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 24,
                        }} {...({} as any)}>
                          <MaterialIcons name="check-circle" size={22} color="#166534" />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#166534' }}>Application Approved</Text>
                            <Text style={{ fontSize: 12, color: '#15803d', marginTop: 2 }}>This volunteer has been confirmed and joined to the event.</Text>
                          </View>
                        </View>
                      ) : (
                        <View style={{
                          backgroundColor: '#fef2f2',
                          borderWidth: 1,
                          borderColor: '#fecaca',
                          borderRadius: 8,
                          padding: 14,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 24,
                        }} {...({} as any)}>
                          <MaterialIcons name="cancel" size={22} color="#dc2626" />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#dc2626' }}>Application Declined</Text>
                            <Text style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>This volunteer application was not accepted.</Text>
                          </View>
                        </View>
                      )}



                    </ScrollView>

                  ) : (

                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }} {...({} as any)}>

                      <MaterialIcons name="description" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />

                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#64748b' }}>

                        Select an applicant to view details

                      </Text>

                    </View>

                  )}

                </View>

              )}



      </View>

    </View>

  );



    if (isWeb) {

      return (

        <View style={{

          position: 'absolute',

          top: 0,

          left: 0,

          right: 0,

          bottom: 0,

          backgroundColor: '#ffffff',

          zIndex: 99999,

          ...Platform.select({

            web: {

              overflowY: 'auto'

            } as any

          })

        }} {...({} as any)}>

          {modalContent}

        </View>

      );

    }



    return (

      <Modal

        visible={true}

        animationType="none"

        transparent={false}

        onRequestClose={() => setShowVolunteerApplicationsModal(false)}

      >

        {modalContent}

      </Modal>

    );

  };



  const renderProjectEditorModal = () => {

    const isWeb = getPlatformOS() === 'web';

    const eventDateMin = projectDraft.isEvent && projectDraftParentProject

      ? getDateOnlyBoundary(projectDraftParentProject.startDate)

      : undefined;

    const eventDateMax = projectDraft.isEvent && projectDraftParentProject

      ? getDateOnlyBoundary(projectDraftParentProject.endDate, true)

      : undefined;



    const PuzzleIllustration = () => (

      <Svg width={140} height={80} viewBox="0 0 140 80">

        <Path

          d="M20,25 C20,15 35,15 35,25 C35,25 45,25 45,35 C45,45 35,45 35,45 C35,55 20,55 20,45 Z"

          fill="#3b82f6"

          opacity={0.85}

        />

        <Path

          d="M48,25 C48,15 63,15 63,25 C63,25 73,25 73,35 C73,45 63,45 63,45 C63,55 48,55 48,45 Z"

          fill="#f97316"

          opacity={0.85}

        />

        <Circle cx={28} cy={18} r={5} fill="#10b981" />

        <Path d="M23,28 C23,28 28,34 28,34 C28,34 33,28 33,28" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" />

        <Circle cx={58} cy={18} r={5} fill="#a21caf" />

        <Path d="M53,28 C53,28 58,34 58,34 C58,34 63,28 63,28" stroke="#a21caf" strokeWidth={2.5} strokeLinecap="round" />

      </Svg>

    );



    const renderNewEventFormContent = () => {

      const trackProjects = projects.filter(p => !p.isEvent && p.programModule === projectDraft.programModule);

      const activeParentProject = projects.find(p => p.id === projectDraft.parentProjectId);

      const isMobile = width < 768;

      const eventProgramName = activeParentProject

        ? programSections.find(section => section.module === activeParentProject.program_id)?.title

        || activeParentProject.program_id

        || activeParentProject.programModule

        : programSections.find(section => section.module === projectDraft.program_id)?.title

        || projectDraft.program_id;



      const handleInsertToolbarMarkup = (markup: string) => {

        setProjectDraft(prev => ({

          ...prev,

          description: prev.description + markup,

        }));

      };



      const getFormattedDateText = (dateVal: string | undefined | null, fallback: string) => {

        if (!dateVal) return fallback;

        try {

          const d = new Date(dateVal);

          if (isNaN(d.getTime())) return dateVal;

          return format(d, 'MMM dd, yyyy');

        } catch (e) {

          return dateVal;

        }

      };

      // Per-field error helpers — only activate after a save attempt (when projectSaveError is set)
      const hasAttemptedSave = !!projectSaveError;
      const resolvedParentId = projectDraft.parentProjectId?.trim() ||
        (!selectedProject?.isEvent ? selectedProject?.id ?? '' : '');
      const fieldErrors: Record<string, string> = hasAttemptedSave ? {
        title: !projectDraft.title.trim() ? 'Event title is required.' : '',
        description: !projectDraft.description.trim() ? 'Description is required.' : '',
        startDate: !projectDraft.startDate.trim() ? 'Start date is required.' : '',
        endDate: !projectDraft.endDate.trim() ? 'End date is required.' : '',
        parentProject: !resolvedParentId ? 'Parent project is required.' : '',
        location: !projectPlaceVenue.trim() ? 'Location / venue is required.' : '',
        barangay: !projectBarangayCode ? 'Barangay is required.' : '',
      } : {};

      const errBorder = (field: string): object =>
        fieldErrors[field] ? { borderColor: '#ef4444', borderWidth: 1.5 } : {};

      const FieldError = ({ field }: { field: string }) =>
        fieldErrors[field] ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <MaterialIcons name="error-outline" size={12} color="#ef4444" />
            <Text style={{ fontSize: 11, color: '#ef4444', fontWeight: '700' }}>{fieldErrors[field]}</Text>
          </View>
        ) : null;

      return (
        <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={true}>

          {/* Header Row */}

          <View style={{ flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingBottom: 20, marginBottom: 20, gap: 16 }}>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>

              <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef7ef' }}>

                <MaterialIcons name="event" size={28} color="#166534" />

              </View>

              <View>

                <Text style={{ fontSize: 24, fontWeight: '800', color: '#0f172a' }}>

                  {editingProjectId ? 'Edit Event' : 'New Event'}

                </Text>

                <Text style={{ fontSize: 13, color: '#64748b', marginTop: 3 }} numberOfLines={1}>

                  Create an event under {activeParentProject?.title || 'selected parent project'}{activeParentProject?.location?.barangay ? `, Brgy. ${activeParentProject.location.barangay}` : ''}.

                </Text>

              </View>

            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>

              <TouchableOpacity

                style={{ flex: isMobile ? 1 : undefined, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd5e1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, gap: 8, backgroundColor: '#ffffff' }}

                onPress={closeProjectModal}

              >

                <MaterialIcons name="close" size={18} color="#475569" />

                <Text style={{ color: '#475569', fontWeight: '700', fontSize: 14 }}>Cancel</Text>

              </TouchableOpacity>

              <TouchableOpacity

                style={{ flex: isMobile ? 1 : undefined, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#166534', paddingVertical: 10, paddingHorizontal: 22, borderRadius: 8, gap: 8 }}

                onPress={handleSaveProjectRecord}

              >

                <MaterialIcons name="event-available" size={18} color="#fff" />

                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{editingProjectId ? 'Update Event' : 'Post Event'}</Text>

              </TouchableOpacity>

            </View>

          </View>



          {/* Validation Error Banner */}

          {projectSaveError ? (
            <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 10, padding: 14, marginBottom: 4, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <MaterialIcons name="error-outline" size={18} color="#b91c1c" />
              <Text style={{ color: '#b91c1c', fontSize: 13, fontWeight: '700', flex: 1 }}>{projectSaveError}</Text>
            </View>
          ) : null}



          {/* Two-Column Grid Content */}

          <View style={{ flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>



            {/* Left Column (Event details) */}

            <View style={{ flex: 1.6, gap: 20 }}>



              {/* Card 1: Event Status */}

              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 20, backgroundColor: '#ffffff' }}>

                <Text style={{ fontSize: 12, fontWeight: '800', color: '#166534', letterSpacing: 0.5, marginBottom: 12 }}>EVENT STATUS</Text>



                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>

                  {statuses.map(statusOption => {

                    const isSelected = projectDraft.status === statusOption;

                    const isOpenStatus = statusOption === 'In Progress';

                    return (

                      <TouchableOpacity

                        key={statusOption}

                        style={{

                          flexDirection: 'row',

                          alignItems: 'center',

                          gap: 6,

                          borderWidth: 1,

                          borderColor: isSelected ? '#166534' : '#cbd5e1',

                          borderRadius: 8,

                          paddingVertical: 8,

                          paddingHorizontal: 12,

                          backgroundColor: isSelected ? '#f0fdf4' : '#ffffff',

                        }}

                        onPress={() => handleProjectDraftChange('status', statusOption)}

                        activeOpacity={0.85}

                      >

                        {isSelected ? <MaterialIcons name="check" size={14} color="#166534" /> : null}

                        <Text style={{ fontSize: 12, fontWeight: '800', color: isSelected ? '#166534' : '#334155' }}>

                          {isOpenStatus ? 'Open - Spots available' : statusOption}

                        </Text>

                      </TouchableOpacity>

                    );

                  })}

                </View>



                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>Event will automatically close when the open slots are filled.</Text>

              </View>



              {/* Card 2: Parent Project and Event Title */}

              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 20, backgroundColor: '#ffffff' }}>

                <View style={{ flexDirection: isMobile ? 'column' : 'row', gap: 20 }}>

                  <View style={{ flex: 1.2 }}>

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 6 }}>Parent Project <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    <View style={[styles.formPickerContainer, errBorder('parentProject')]}>

                      <Picker

                        selectedValue={projectDraft.parentProjectId}

                        onValueChange={(val: string) => {

                          const parentProj = projects.find(p => p.id === val);

                          if (parentProj) {

                            const locSel = getProjectLocationSelection(parentProj);

                            setProjectDraft(prev => ({

                              ...prev,

                              parentProjectId: val,

                              partnerId: parentProj.partnerId,

                            }));

                            setProjectRegionCode(locSel.regionCode || '');

                            setProjectCityCode(locSel.cityCode || '');



                            const cityCode = locSel.cityCode || '';

                            if (cityCode) {

                              const barangays = getBarangaysByCity(cityCode);

                              setProjectLocationBarangays(barangays);

                              const parentBarangayName = parentProj.location.barangay || parentProj.locationBarangay || '';

                              const matchedBarangay = barangays.find(b => b.name.toLowerCase() === parentBarangayName.toLowerCase());

                              if (matchedBarangay) {

                                setProjectBarangayCode(matchedBarangay.code);

                              } else {

                                setProjectBarangayCode('');

                              }

                            } else {

                              setProjectBarangayCode('');

                            }



                            setProjectPlaceVenue(parentProj.location.address || '');

                          } else {

                            setProjectDraft(prev => ({

                              ...prev,

                              parentProjectId: val,

                            }));

                          }

                        }}

                        style={styles.formPicker}

                      >

                        <Picker.Item label="Select parent project..." value="" />

                        {trackProjects.map(proj => (

                          <Picker.Item key={proj.id} label={proj.title} value={proj.id} />

                        ))}

                      </Picker>

                    </View>
                    <FieldError field="parentProject" />

                  </View>



                  <View style={{ flex: 1 }}>

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 6 }}>Event Title <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    <TextInput

                      style={[styles.formInput, { height: 38 }, errBorder('title')]}

                      placeholder="Add title"

                      placeholderTextColor="#94a3b8"

                      value={projectDraft.title}

                      onChangeText={value => handleProjectDraftChange('title', value)}

                    />
                    <FieldError field="title" />

                  </View>

                </View>

              </View>



              {/* Card 3: Event Date & Time */}

              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 20, backgroundColor: '#ffffff' }}>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

                  {/* Start Date & Time */}

                  <View style={{ flex: 1, minWidth: 240 }}>

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 6 }}>Start Date & Time <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>

                      <TouchableOpacity

                        style={{ flex: 1.2, height: 42, borderWidth: fieldErrors.startDate ? 1.5 : 1, borderColor: fieldErrors.startDate ? '#ef4444' : '#cbd5e1', borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, backgroundColor: '#fff' }}

                        onPress={() => {

                          setDatePickerMode('startDate');

                          const startVal = projectDraft.startDate ? new Date(projectDraft.startDate) : new Date();

                          setSelectedDate(startVal);

                          setShowDatePicker(true);

                        }}

                      >

                        <MaterialIcons name="calendar-today" size={16} color="#64748b" />

                        <Text style={{ fontSize: 13, color: '#0f172a', fontWeight: '600' }}>

                          {getFormattedDateText(projectDraft.startDate, 'Select Date')}

                        </Text>

                      </TouchableOpacity>



                      {!eventAllDay && (

                        <View style={{ flex: 1, height: 42, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center' }}>

                          <Picker

                            selectedValue={eventTimeStart}

                            onValueChange={(val: string) => setEventTimeStart(val)}

                            style={{ width: '100%', height: '100%', color: '#0f172a' }}

                          >

                            {['8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM'].map(t => (

                              <Picker.Item key={t} label={t} value={t} />

                            ))}

                          </Picker>

                        </View>

                      )}

                    </View>
                    <FieldError field="startDate" />

                  </View>



                  <Text style={{ fontSize: 14, color: '#64748b', alignSelf: 'flex-end', marginBottom: 12, marginHorizontal: 4 }}>to</Text>



                  {/* End Date & Time */}

                  <View style={{ flex: 1, minWidth: 240 }}>

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 6 }}>End Date & Time <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>

                      <TouchableOpacity

                        style={{ flex: 1.2, height: 42, borderWidth: fieldErrors.endDate ? 1.5 : 1, borderColor: fieldErrors.endDate ? '#ef4444' : '#cbd5e1', borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, backgroundColor: '#fff' }}

                        onPress={() => {

                          setDatePickerMode('endDate');

                          const endVal = projectDraft.endDate ? new Date(projectDraft.endDate) : new Date();

                          setSelectedDate(endVal);

                          setShowDatePicker(true);

                        }}

                      >

                        <MaterialIcons name="calendar-today" size={16} color="#64748b" />

                        <Text style={{ fontSize: 13, color: '#0f172a', fontWeight: '600' }}>

                          {getFormattedDateText(projectDraft.endDate, 'Select Date')}

                        </Text>

                      </TouchableOpacity>



                      {!eventAllDay && (

                        <View style={{ flex: 1, height: 42, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center' }}>

                          <Picker

                            selectedValue={eventTimeEnd}

                            onValueChange={(val: string) => setEventTimeEnd(val)}

                            style={{ width: '100%', height: '100%', color: '#0f172a' }}

                          >

                            {['8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM'].map(t => (

                              <Picker.Item key={t} label={t} value={t} />

                            ))}

                          </Picker>

                        </View>

                      )}

                    </View>
                    <FieldError field="endDate" />

                  </View>

                </View>



                {/* All day & Repeat Row */}

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 16 }}>

                  <TouchableOpacity

                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}

                    onPress={() => setEventAllDay(!eventAllDay)}

                  >

                    <View style={{ width: 18, height: 18, borderWidth: 1.5, borderColor: '#64748b', borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: eventAllDay ? '#166534' : 'transparent' }}>

                      {eventAllDay && <MaterialIcons name="check" size={14} color="#fff" />}

                    </View>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '500' }}>All day event</Text>

                  </TouchableOpacity>



                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '500' }}>Repeat</Text>

                    <View style={{ width: 160, height: 38, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center' }}>

                      <Picker

                        selectedValue={eventRepeat}

                        onValueChange={(val: string) => setEventRepeat(val)}

                        style={{ width: '100%', height: '100%', color: '#0f172a' }}

                      >

                        <Picker.Item label="Does not repeat" value="Does not repeat" />

                        <Picker.Item label="Daily" value="Daily" />

                        <Picker.Item label="Weekly" value="Weekly" />

                        <Picker.Item label="Monthly" value="Monthly" />

                      </Picker>

                    </View>

                  </View>

                </View>

              </View>



              {/* Card 4: Event Details */}

              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 20, backgroundColor: '#ffffff' }}>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>

                  <MaterialIcons name="flag" size={18} color="#166534" />

                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#166534', letterSpacing: 0.5 }}>EVENT DETAILS</Text>

                </View>



                <View style={{ flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>

                  {/* Left Sub-Column */}

                  <View style={{ flex: 1.2, gap: 16 }}>



                    {/* Location */}

                    <View style={{ gap: 6 }}>

                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Location (Address/Venue) <Text style={{ color: '#ef4444' }}>*</Text></Text>

                      <TextInput

                        style={[styles.formInput, errBorder('location')]}

                        placeholder="Enter location"

                        placeholderTextColor="#94a3b8"

                        value={projectPlaceVenue}

                        onChangeText={setProjectPlaceVenue}

                      />
                      <FieldError field="location" />

                    </View>



                    {/* Barangay */}

                    <View style={{ gap: 6 }}>

                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Barangay <Text style={{ color: '#ef4444' }}>*</Text></Text>

                      <View style={[styles.formPickerContainer, { marginBottom: 0 }, errBorder('barangay')]}>

                        <Picker

                          selectedValue={projectBarangayCode}

                          onValueChange={(itemValue: string) => handleProjectBarangayChange(itemValue)}

                          enabled={projectCityCode !== ''}

                          style={styles.formPicker}

                        >

                          <Picker.Item label="Select Barangay..." value="" />

                          {projectLocationBarangays.map(barangay => (

                            <Picker.Item key={barangay.code} label={barangay.displayName} value={barangay.code} />

                          ))}

                        </Picker>

                      </View>
                      <FieldError field="barangay" />

                    </View>



                    {/* Google Meet Link / URL (Optional) */}

                    <View style={{ gap: 6 }}>

                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Google Meet Link / URL (Optional)</Text>

                      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#ffffff', height: 38, paddingLeft: 8, paddingRight: 4, gap: 4 }}>

                        <TextInput

                          style={{ flex: 1, fontSize: 13, color: '#0f172a', fontWeight: '500', height: '100%', padding: 0 }}

                          placeholder="https://meet.google.com/..."

                          placeholderTextColor="#94a3b8"

                          value={eventZoomLink}

                          onChangeText={setEventZoomLink}

                        />

                        <TouchableOpacity

                          style={{

                            flexDirection: 'row',

                            alignItems: 'center',

                            borderWidth: 1,

                            borderColor: '#166534',

                            borderRadius: 6,

                            paddingVertical: 4,

                            paddingHorizontal: 10,

                            backgroundColor: '#ffffff',

                            gap: 4,

                          }}

                          onPress={() => {

                            const normalizedUrl = normalizeExternalUrl(eventZoomLink);

                            if (normalizedUrl) {

                              Linking.openURL(normalizedUrl).catch(err => console.log(err));

                            }

                          }}

                        >

                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#166534' }}>Join Meet</Text>

                          <MaterialIcons name="open-in-new" size={12} color="#166534" />

                        </TouchableOpacity>

                      </View>

                    </View>



                    {/* Document Attachment */}

                    <View style={{ gap: 6, marginTop: 12 }}>

                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Document Attachment (Optional)</Text>

                      <TouchableOpacity

                        onPress={handlePickProjectDocument}

                        style={{ 

                          flexDirection: 'row', 

                          alignItems: 'center', 

                          borderWidth: 1, 

                          borderColor: '#cbd5e1', 

                          borderRadius: 8, 

                          backgroundColor: '#ffffff', 

                          padding: 10, 

                          gap: 8 

                        }}

                      >

                        <MaterialIcons 

                          name={projectDraft.attachmentUrl ? 'attach-file' : 'upload-file'} 

                          size={18} 

                          color="#2563eb" 

                        />

                        <Text style={{ flex: 1, fontSize: 13, color: projectDraft.attachmentUrl ? '#0f172a' : '#94a3b8', fontWeight: '500' }} numberOfLines={1}>

                          {projectDraft.attachmentUrl 

                            ? projectDraft.attachmentUrl.split('/').pop() || 'Attached document'

                            : 'Upload document'}

                        </Text>

                        {projectDraft.attachmentUrl && (

                          <TouchableOpacity 

                            onPress={(e) => {

                              e.stopPropagation();

                              handleRemoveProjectDocument();

                            }}

                            style={{ padding: 4 }}

                          >

                            <MaterialIcons name="close" size={16} color="#64748b" />

                          </TouchableOpacity>

                        )}

                      </TouchableOpacity>

                    </View>



                  </View>



                  {/* Right Sub-Column */}

                  <View style={{ flex: 1.4, gap: 6 }}>

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Description <Text style={{ color: '#ef4444' }}>*</Text></Text>



                    <View style={{ flex: 1, minHeight: 180, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, overflow: 'hidden' }}>

                      {/* Toolbar */}

                      <View style={{ flexDirection: 'row', gap: 14, padding: 8, backgroundColor: '#f8fafc', borderBottomWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' }}>

                        <TouchableOpacity style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }} onPress={() => handleInsertToolbarMarkup('**bold**')}><Text style={{ fontWeight: 'bold', color: '#475569', fontSize: 13 }}>B</Text></TouchableOpacity>

                        <TouchableOpacity style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }} onPress={() => handleInsertToolbarMarkup('*italic*')}><Text style={{ fontStyle: 'italic', color: '#475569', fontSize: 13 }}>I</Text></TouchableOpacity>

                        <TouchableOpacity style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }} onPress={() => handleInsertToolbarMarkup('<u>underline</u>')}><Text style={{ textDecorationLine: 'underline', color: '#475569', fontSize: 13 }}>U</Text></TouchableOpacity>

                        <View style={{ width: 1, height: 16, backgroundColor: '#cbd5e1' }} />

                        <TouchableOpacity onPress={() => handleInsertToolbarMarkup('\n- ')}><MaterialIcons name="format-list-bulleted" size={16} color="#475569" /></TouchableOpacity>

                        <TouchableOpacity onPress={() => handleInsertToolbarMarkup('\n1. ')}><MaterialIcons name="format-list-numbered" size={16} color="#475569" /></TouchableOpacity>

                        <TouchableOpacity onPress={() => handleInsertToolbarMarkup('[link](url)')}><MaterialIcons name="link" size={16} color="#475569" /></TouchableOpacity>

                      </View>



                      <TextInput

                        style={{ flex: 1, padding: 12, fontSize: 13, color: '#0f172a', fontWeight: '500', textAlignVertical: 'top', minHeight: 120, backgroundColor: '#fff' }}

                        placeholder="Add description"

                        placeholderTextColor="#94a3b8"

                        multiline={true}

                        value={projectDraft.description}

                        onChangeText={value => handleProjectDraftChange('description', value)}

                        maxLength={1000}

                      />



                      <View style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff', alignItems: 'flex-end' }}>

                        <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600' }}>

                          {projectDraft.description.length} / 1000

                        </Text>

                      </View>

                    </View>

                  </View>

                </View>

              </View>



            </View>



            {/* Right Column (Sidebar Cards) */}

            <View style={{ flex: 1, gap: 20 }}>



              {/* Card 1: Notifications */}

              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 20, backgroundColor: '#ffffff' }}>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>

                  <MaterialIcons name="notifications" size={18} color="#166534" />

                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#166534', letterSpacing: 0.5 }}>NOTIFICATIONS</Text>

                </View>



                <View style={{ gap: 12 }}>

                  {eventNotifications.map((notif, index) => (

                    <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>

                      <View style={{ flex: 1.5, height: 40, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center' }}>

                        <Picker

                          selectedValue={notif.type}

                          onValueChange={(val) => {

                            updateEventNotification(index, { type: val as EventNotificationSetting['type'] });

                          }}

                          style={{ width: '100%', height: '100%', color: '#0f172a' }}

                        >

                          <Picker.Item label="Send notification" value="Notification" />

                          <Picker.Item label="Email" value="Email" />

                        </Picker>

                      </View>

                      <TextInput

                        style={[styles.formInput, { flex: 0.8, height: 40, marginBottom: 0, textAlign: 'center' }]}

                        keyboardType="numeric"

                        value={notif.value}

                        onChangeText={(val) => {

                          updateEventNotification(index, { value: val.replace(/\D/g, '') });

                        }}

                      />

                      <View style={{ flex: 1.2, height: 40, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center' }}>

                        <Picker

                          selectedValue={notif.unit}

                          onValueChange={(val) => {

                            updateEventNotification(index, { unit: val as EventNotificationSetting['unit'] });

                          }}

                          style={{ width: '100%', height: '100%', color: '#0f172a' }}

                        >

                          <Picker.Item label="minutes" value="minutes" />

                          <Picker.Item label="hours" value="hours" />

                          <Picker.Item label="days" value="days" />

                        </Picker>

                      </View>

                      <TouchableOpacity

                        onPress={() => {

                          removeEventNotification(index);

                        }}

                        style={{ padding: 4 }}

                      >

                        <MaterialIcons name="close" size={18} color="#ef4444" />

                      </TouchableOpacity>

                    </View>

                  ))}



                  <TouchableOpacity

                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}

                    onPress={() => {

                      addEventNotification();

                    }}

                  >

                    <MaterialIcons name="add" size={18} color="#166534" />

                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#166534' }}>Add another notification</Text>

                  </TouchableOpacity>

                </View>

              </View>



              {/* Card 2: Volunteer Settings */}

              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 20, backgroundColor: '#ffffff' }}>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>

                  <MaterialIcons name="people" size={18} color="#166534" />

                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#166534', letterSpacing: 0.5 }}>VOLUNTEER SETTINGS</Text>

                </View>



                <View style={{ gap: 16 }}>

                  <View style={{ gap: 4 }}>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '700' }}>Accept Volunteers</Text>

                    <CustomToggle

                      value={(projectDraft as any).acceptVolunteers !== false}

                      onValueChange={value => handleProjectDraftChange('acceptVolunteers' as any, value)}

                      label="Yes, this event accepts volunteers"

                    />

                  </View>



                  <View style={{ gap: 6 }}>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '700' }}>Maximum Volunteer Slots <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    <TextInput

                      style={[styles.formInput, { height: 38, marginBottom: 0 }]}

                      keyboardType="numeric"

                      placeholder="100"

                      placeholderTextColor="#94a3b8"

                      value={String(projectDraft.volunteersNeeded || '')}

                      onChangeText={value => handleProjectDraftChange('volunteersNeeded', value)}

                    />

                  </View>



                  <View style={{ gap: 4 }}>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '700' }}>Application Required</Text>

                    <CustomToggle

                      value={(projectDraft as any).applicationRequired !== false}

                      onValueChange={value => handleProjectDraftChange('applicationRequired' as any, value)}

                      label="Yes, volunteers must apply"

                    />

                  </View>



                  <View style={{ gap: 4 }}>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '700' }}>Review Applications Before Approval</Text>

                    <CustomToggle

                      value={(projectDraft as any).reviewRequired !== false}

                      onValueChange={value => handleProjectDraftChange('reviewRequired' as any, value)}

                      label="Yes, review applications"

                    />

                  </View>



                  <View style={{ gap: 6 }}>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '700' }}>Application Deadline</Text>

                    <TouchableOpacity

                      style={{

                        height: 40,

                        borderWidth: 1,

                        borderColor: '#cbd5e1',

                        borderRadius: 8,

                        backgroundColor: '#fff',

                        flexDirection: 'row',

                        alignItems: 'center',

                        paddingHorizontal: 12,

                      }}

                      onPress={() => {

                        const deadline = (projectDraft as any).applicationDeadline;

                        setDatePickerMode('applicationDeadline');

                        setSelectedDate(deadline ? new Date(deadline) : new Date());

                        setShowDatePicker(true);

                      }}

                    >

                      <Text style={{ flex: 1, color: (projectDraft as any).applicationDeadline ? '#1e293b' : '#94a3b8', fontSize: 13, fontWeight: '600' }}>

                        {getFormattedDateText((projectDraft as any).applicationDeadline, 'Select deadline')}

                      </Text>

                      <MaterialIcons name="calendar-today" size={16} color="#64748b" />

                    </TouchableOpacity>

                  </View>



                  {/* Volunteer Requirements Checklist (Create/Edit Event) */}

                  <View style={{ gap: 6, marginTop: 8 }}>

                    <Text style={{ fontSize: 13, color: '#334155', fontWeight: '700' }}>Volunteer Requirements</Text>

                    <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Select all requirements that apply.</Text>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>

                      {(() => {

                        const base = [

                          '18 years old or above',

                          'Must be physically fit for field activities',

                          'Attend volunteer orientation',

                          'Prior volunteer experience',

                          'Wear appropriate clothing',

                          'Complete required training',

                          'Bring valid ID',

                          'Submit required documents',

                          'Attend event briefing'

                        ];

                        return [

                          ...base,

                          ...(projectDraft.volunteerRequirements || []).filter(r => !base.includes(r))

                        ];

                      })().map(req => {

                        const isChecked = (projectDraft.volunteerRequirements || []).includes(req);

                        return (

                          <TouchableOpacity

                            key={req}

                            onPress={() => {

                              const currentReqs = projectDraft.volunteerRequirements || [];

                              const nextReqs = currentReqs.includes(req)

                                ? currentReqs.filter(r => r !== req)

                                : [...currentReqs, req];

                              handleProjectDraftChange('volunteerRequirements', nextReqs);

                            }}

                            activeOpacity={0.8}

                            style={{

                              flexDirection: 'row',

                              alignItems: 'center',

                              width: '48%',

                              marginBottom: 6,

                              gap: 6

                            }}

                          >

                            <MaterialIcons

                              name={isChecked ? 'check-box' : 'check-box-outline-blank'}

                              size={18}

                              color={isChecked ? '#166534' : '#64748b'}

                            />

                            <Text style={{ fontSize: 12, color: '#334155', flex: 1 }}>{req}</Text>

                          </TouchableOpacity>

                        );

                      })}

                    </View>



                    {/* Add Custom Requirement Input Row */}

                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'center' }}>

                      <TextInput

                        style={{

                          flex: 1,

                          height: 32,

                          borderWidth: 1,

                          borderColor: '#cbd5e1',

                          borderRadius: 6,

                          paddingHorizontal: 8,

                          fontSize: 12,

                          color: '#1e293b',

                          backgroundColor: '#fff',

                        }}

                        placeholder="Add custom requirement..."

                        placeholderTextColor="#94a3b8"

                        value={customRequirementText}

                        onChangeText={setCustomRequirementText}

                      />

                      <TouchableOpacity

                        style={{

                          height: 32,

                          paddingHorizontal: 12,

                          borderRadius: 6,

                          backgroundColor: '#166534',

                          justifyContent: 'center',

                          alignItems: 'center',

                        }}

                        onPress={() => {

                          const val = customRequirementText.trim();

                          if (!val) return;

                          const currentReqs = projectDraft.volunteerRequirements || [];

                          if (currentReqs.includes(val)) {

                            Alert.alert('Alert', 'Requirement already exists.');

                            return;

                          }

                          handleProjectDraftChange('volunteerRequirements', [...currentReqs, val]);

                          setCustomRequirementText('');

                        }}

                      >

                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>+ Custom</Text>

                      </TouchableOpacity>

                    </View>

                  </View>



                </View>

              </View>



              {/* Card 3: Need Help? */}

              <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 20, backgroundColor: '#f8fafc' }}>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>

                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#166534', alignItems: 'center', justifyContent: 'center' }}>

                    <MaterialIcons name="help" size={16} color="#fff" />

                  </View>

                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#166534' }}>Need Help?</Text>

                </View>

                <Text style={{ fontSize: 13, color: '#475569', marginBottom: 12, lineHeight: 18 }}>

                  Learn how to create and manage events.

                </Text>

                <TouchableOpacity

                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#fff', gap: 6, alignSelf: 'flex-start' }}

                  onPress={() => Linking.openURL('https://example.com/guide').catch(() => { })}

                >

                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>View Guide</Text>

                  <MaterialIcons name="open-in-new" size={14} color="#334155" />

                </TouchableOpacity>

              </View>



            </View>

          </View>

        </ScrollView>

      );

    };







    const formContent = (

      <View style={styles.modalContainer}>

        {isProjectSaveSuccess ? (

          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>

            <View style={{ backgroundColor: '#fff', width: '100%', maxWidth: 520, borderRadius: 18, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' }}>

              <MaterialIcons name="check-circle" size={84} color="#166534" />

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

        ) : projectDraft.isEvent ? (

          renderNewEventFormContent()

        ) : editingProjectId ? (

          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={true}>

            {renderInlineProjectForm({

              module: projectDraft.program_id,

              title: programSections.find(section => section.module === projectDraft.program_id)?.title || projectDraft.program_id,

            })}

          </ScrollView>

        ) : (

          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={true}>

            {/* Header Row */}

            <View style={styles.modalHeaderRow}>

              <View style={{ flex: 1 }}>

                {/* Breadcrumb Row */}

                <View style={styles.modalBreadcrumbs}>

                  <Text style={styles.breadcrumbMuted}>Projects</Text>

                  <MaterialIcons name="chevron-right" size={14} color="#94a3b8" style={{ marginHorizontal: 4 }} />

                  <Text style={styles.breadcrumbActive}>

                    {editingProjectId ? 'Edit Project' : 'Create Project'}

                  </Text>

                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>

                  <Text style={styles.modalTitleText}>

                    {editingProjectId

                      ? projectDraft.isEvent ? 'Edit Event Details' : 'Edit Project Details'

                      : projectDraft.isEvent ? 'Create New Event' : 'Create New Project'}

                  </Text>

                </View>

                <Text style={styles.modalSubtitleText}>

                  Provide accurate project information for planning, coordination, and reporting.

                </Text>

              </View>



              {/* Illustration puzzle matching mockup */}

              <View style={styles.modalHeaderIllustration}>

                <PuzzleIllustration />

              </View>



              {/* Cancel top-right button */}

              <TouchableOpacity style={styles.modalHeaderCancelButton} onPress={closeProjectModal}>

                <MaterialIcons name="close" size={16} color="#64748b" style={{ marginRight: 6 }} />

                <Text style={styles.modalHeaderCancelText}>Cancel</Text>

              </TouchableOpacity>

            </View>



            {projectSaveError ? (

              <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, padding: 12, marginBottom: 20 }}>

                <Text style={{ color: '#b91c1c', fontSize: 13, fontWeight: '600' }}>{projectSaveError}</Text>

              </View>

            ) : null}



            {/* Two Column Form Grid */}

            <View style={styles.modalTwoColumnGrid}>

              {/* Left Column (50%) */}

              <View style={styles.modalLeftColumn}>



                {/* Project Title Field */}

                <View style={styles.formFieldContainer}>

                  <View style={styles.fieldLabelRow}>

                    <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f0fdf4' }]}>

                      <MaterialIcons name="edit" size={16} color="#166534" />

                    </View>

                    <Text style={styles.formFieldLabel}>

                      {projectDraft.isEvent ? 'Event title' : 'Project title'} <Text style={{ color: '#ef4444' }}>*</Text>

                    </Text>

                  </View>

                  <TextInput

                    style={styles.formInput}

                    placeholder={projectDraft.isEvent ? 'Enter event title' : 'Enter project title'}

                    placeholderTextColor="#94a3b8"

                    value={projectDraft.title}

                    onChangeText={value => handleProjectDraftChange('title', value)}

                  />

                </View>



                {/* Project Description Field */}

                <View style={styles.formFieldContainer}>

                  <View style={styles.fieldLabelRow}>

                    <View style={[styles.fieldLabelIconBg, { backgroundColor: '#fff7ed' }]}>

                      <MaterialIcons name="description" size={16} color="#ea580c" />

                    </View>

                    <Text style={styles.formFieldLabel}>

                      {projectDraft.isEvent ? 'Event description' : 'Project description'} <Text style={{ color: '#ef4444' }}>*</Text>

                    </Text>

                  </View>

                  <TextInput

                    style={[styles.formInput, { height: 120, textAlignVertical: 'top', paddingTop: 10 }]}

                    placeholder={projectDraft.isEvent ? 'Describe the event...' : 'Describe the project, its goals, and expected impact...'}

                    placeholderTextColor="#94a3b8"

                    multiline

                    numberOfLines={5}

                    maxLength={500}

                    value={projectDraft.description}

                    onChangeText={value => handleProjectDraftChange('description', value)}

                  />

                  <Text style={styles.charCounter}>{projectDraft.description.length} / 500</Text>

                </View>



                {/* Status and Type Row */}

                <View style={styles.formRowEditor}>

                  <View style={[styles.formFieldContainer, { flex: 1 }]}>

                    <View style={styles.fieldLabelRow}>

                      <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f5f3ff' }]}>

                        <MaterialIcons name="flag" size={16} color="#7c3aed" />

                      </View>

                      <Text style={styles.formFieldLabel}>Status <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    </View>

                    <View style={styles.formPickerContainer}>

                      <Picker

                        selectedValue={projectDraft.status}

                        onValueChange={value => handleProjectDraftChange('status', value as Project['status'])}

                        style={styles.formPicker}

                      >

                        <Picker.Item label="Select status" value="" />

                        {statuses.map(st => (

                          <Picker.Item key={st} label={st} value={st} />

                        ))}

                      </Picker>

                    </View>

                  </View>



                  <View style={[styles.formFieldContainer, { flex: 1 }]}>

                    <View style={styles.fieldLabelRow}>

                      <View style={[styles.fieldLabelIconBg, { backgroundColor: '#eff6ff' }]}>

                        <MaterialIcons name="layers" size={16} color="#2563eb" />

                      </View>

                      <Text style={styles.formFieldLabel}>Type <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    </View>

                    <View style={styles.formPickerContainer}>

                      <Picker

                        selectedValue={projectDraft.isEvent ? 'event' : 'project'}

                        onValueChange={value => handleProjectDraftChange('isEvent', value === 'event')}

                        enabled={!editingProjectId && !projectDraft.isEvent}

                        style={styles.formPicker}

                      >

                        <Picker.Item label="Project" value="project" />

                        <Picker.Item label="Event" value="event" />

                      </Picker>

                    </View>

                  </View>

                </View>



                {/* Project Picture Box */}

                <View style={styles.formFieldContainer}>

                  <View style={styles.fieldLabelRow}>

                    <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f0fdf4' }]}>

                      <MaterialIcons name="image" size={16} color="#166534" />

                    </View>

                    <Text style={styles.formFieldLabel}>Project Picture</Text>

                  </View>

                  <Text style={styles.formFieldDescText}>

                    Upload or replace the picture shown in the project panels, project list, and map preview.

                  </Text>

                  <View style={styles.uploadDashedBox}>

                    <View style={styles.uploadIconCircle}>

                      <MaterialIcons name="image" size={24} color="#94a3b8" />

                    </View>



                    {projectDraft.imageUrl ? (

                      <View style={{ alignItems: 'center' }}>

                        <Text style={styles.uploadTitle}>Custom picture uploaded successfully</Text>

                        {isImageMediaUri(projectDraft.imageUrl) ? (

                          <Image

                            source={{ uri: projectDraft.imageUrl }}

                            style={styles.projectImagePreview}

                            resizeMode="cover"

                          />

                        ) : null}

                      </View>

                    ) : (

                      <>

                        <Text style={styles.uploadTitle}>No custom picture uploaded yet.</Text>

                        <Text style={styles.uploadSubtitle}>The app will use the default project image.</Text>

                      </>

                    )}



                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>

                      <TouchableOpacity style={styles.uploadButtonGreenOutline} onPress={handlePickProjectImage}>

                        <MaterialIcons name="cloud-upload" size={16} color="#166534" style={{ marginRight: 6 }} />

                        <Text style={styles.uploadButtonGreenOutlineText}>

                          {projectDraft.imageUrl ? 'Replace Picture' : 'Upload Picture'}

                        </Text>

                      </TouchableOpacity>

                      {projectDraft.imageUrl ? (

                        <TouchableOpacity style={styles.uploadRemoveButtonRedOutline} onPress={handleRemoveProjectImage}>

                          <MaterialIcons name="delete-outline" size={16} color="#ef4444" style={{ marginRight: 6 }} />

                          <Text style={styles.uploadRemoveButtonRedOutlineText}>Remove</Text>

                        </TouchableOpacity>

                      ) : null}

                    </View>

                    <Text style={styles.uploadHint}>JPG, PNG or WEBP (Max. 5MB)</Text>

                  </View>

                </View>



              </View>



              {/* Right Column (50%) */}

              <View style={styles.modalRightColumn}>



                {/* Start Date & End Date Row */}

                <View style={styles.formRowEditor}>

                  <View style={[styles.formFieldContainer, { flex: 1 }]}>

                    <View style={styles.fieldLabelRow}>

                      <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f0fdf4' }]}>

                        <MaterialIcons name="calendar-today" size={16} color="#166534" />

                      </View>

                      <Text style={styles.formFieldLabel}>Start Date <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    </View>

                    <TouchableOpacity

                      style={styles.datePickerInput}

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

                      <Text style={styles.datePickerInputText}>

                        {projectDraft.startDate

                          ? new Date(projectDraft.startDate).toLocaleDateString('en-US', {

                            year: 'numeric',

                            month: 'short',

                            day: 'numeric',

                          })

                          : 'Select start date'}

                      </Text>

                      <MaterialIcons name="calendar-today" size={16} color="#64748b" />

                    </TouchableOpacity>

                  </View>



                  <View style={[styles.formFieldContainer, { flex: 1 }]}>

                    <View style={styles.fieldLabelRow}>

                      <View style={[styles.fieldLabelIconBg, { backgroundColor: '#fff7ed' }]}>

                        <MaterialIcons name="calendar-today" size={16} color="#ea580c" />

                      </View>

                      <Text style={styles.formFieldLabel}>End Date <Text style={{ color: '#ef4444' }}>*</Text></Text>

                    </View>

                    <TouchableOpacity

                      style={styles.datePickerInput}

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

                      <Text style={styles.datePickerInputText}>

                        {projectDraft.endDate

                          ? new Date(projectDraft.endDate).toLocaleDateString('en-US', {

                            year: 'numeric',

                            month: 'short',

                            day: 'numeric',

                          })

                          : 'Select end date'}

                      </Text>

                      <MaterialIcons name="calendar-today" size={16} color="#64748b" />

                    </TouchableOpacity>

                  </View>

                </View>



                {/* Region Field */}

                <View style={styles.formFieldContainer}>

                  <View style={styles.fieldLabelRow}>

                    <View style={[styles.fieldLabelIconBg, { backgroundColor: '#eff6ff' }]}>

                      <MaterialIcons name="location-on" size={16} color="#2563eb" />

                    </View>

                    <Text style={styles.formFieldLabel}>Region <Text style={{ color: '#ef4444' }}>*</Text></Text>

                  </View>

                  <View style={styles.formPickerContainer}>

                    <Picker

                      selectedValue={projectRegionCode}

                      onValueChange={(itemValue: string) => handleProjectRegionChange(itemValue)}

                      style={styles.formPicker}

                    >

                      <Picker.Item label="Select Region..." value="" />

                      {PHRegions.map(region => (

                        <Picker.Item key={region.code} label={region.name} value={region.code} />

                      ))}

                    </Picker>

                  </View>

                </View>



                {/* City / Municipality Field */}

                <View style={styles.formFieldContainer}>

                  <View style={styles.fieldLabelRow}>

                    <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f5f3ff' }]}>

                      <MaterialIcons name="business" size={16} color="#7c3aed" />

                    </View>

                    <Text style={styles.formFieldLabel}>City / Municipality <Text style={{ color: '#ef4444' }}>*</Text></Text>

                  </View>

                  <View style={styles.formPickerContainer}>

                    <Picker

                      selectedValue={projectCityCode}

                      onValueChange={(itemValue: string) => handleProjectCityChange(itemValue)}

                      enabled={projectRegionCode !== ''}

                      style={styles.formPicker}

                    >

                      <Picker.Item label="Select City/Municipality..." value="" />

                      {projectLocationCities.map(city => (

                        <Picker.Item key={city.code} label={city.displayName} value={city.code} />

                      ))}

                    </Picker>

                  </View>

                  <Text style={styles.cityHelperText}>Choose region and city/municipality to set the place.</Text>

                </View>



                {/* Place / Venue Field */}

                <View style={styles.formFieldContainer}>

                  <View style={styles.fieldLabelRow}>

                    <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f0fdf4' }]}>

                      <MaterialIcons name="location-on" size={16} color="#166534" />

                    </View>

                    <Text style={styles.formFieldLabel}>Place <Text style={{ color: '#ef4444' }}>*</Text></Text>

                  </View>

                  <TextInput

                    style={styles.formInput}

                    placeholder="Enter exact location or venue"

                    placeholderTextColor="#94a3b8"

                    value={projectPlaceVenue}

                    onChangeText={setProjectPlaceVenue}

                  />

                </View>



                {/* Show Barangay and Volunteer Slots field only for events */}

                {projectDraft.isEvent && (

                  <View style={styles.formRowEditor}>

                    <View style={[styles.formFieldContainer, { flex: 1 }]}>

                      <View style={styles.fieldLabelRow}>

                        <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f5f3ff' }]}>

                          <MaterialIcons name="location-city" size={16} color="#7c3aed" />

                        </View>

                        <Text style={styles.formFieldLabel}>Barangay <Text style={{ color: '#ef4444' }}>*</Text></Text>

                      </View>

                      <View style={styles.formPickerContainer}>

                        <Picker

                          selectedValue={projectBarangayCode}

                          onValueChange={(itemValue: string) => handleProjectBarangayChange(itemValue)}

                          enabled={projectCityCode !== ''}

                          style={styles.formPicker}

                        >

                          <Picker.Item label="Select Barangay..." value="" />

                          {projectLocationBarangays.map(barangay => (

                            <Picker.Item key={barangay.code} label={barangay.displayName} value={barangay.code} />

                          ))}

                        </Picker>

                      </View>

                    </View>



                    <View style={[styles.formFieldContainer, { flex: 1 }]}>

                      <View style={styles.fieldLabelRow}>

                        <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f0fdf4' }]}>

                          <MaterialIcons name="people" size={16} color="#166534" />

                        </View>

                        <Text style={styles.formFieldLabel}>Volunteer Slots <Text style={{ color: '#ef4444' }}>*</Text></Text>

                      </View>

                      <TextInput

                        style={styles.formInput}

                        placeholder="Volunteer slots"

                        placeholderTextColor="#94a3b8"

                        keyboardType="number-pad"

                        value={projectDraft.volunteersNeeded}

                        onChangeText={value => handleProjectDraftChange('volunteersNeeded', value)}

                      />

                    </View>

                  </View>

                )}



                {/* Show Volunteer Requirements only for events */}

                {projectDraft.isEvent && (

                  <View style={styles.formFieldContainer}>

                    <View style={styles.fieldLabelRow}>

                      <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f0fdf4' }]}>

                        <MaterialIcons name="assignment-turned-in" size={16} color="#166534" />

                      </View>

                      <Text style={styles.formFieldLabel}>Volunteer Requirements</Text>

                    </View>

                    <Text style={styles.formFieldDescText}>

                      Select all requirements that apply.

                    </Text>



                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>

                      {(() => {

                        const base = [

                          '18 years old or above',

                          'Must be physically fit for field activities',

                          'Attend volunteer orientation',

                          'Prior volunteer experience',

                          'Wear appropriate clothing',

                          'Complete required training',

                          'Bring valid ID',

                          'Submit required documents',

                          'Attend event briefing'

                        ];

                        return [

                          ...base,

                          ...(projectDraft.volunteerRequirements || []).filter(r => !base.includes(r))

                        ];

                      })().map(req => {

                        const isChecked = (projectDraft.volunteerRequirements || []).includes(req);

                        return (

                          <TouchableOpacity

                            key={req}

                            onPress={() => {

                              const currentReqs = projectDraft.volunteerRequirements || [];

                              const nextReqs = currentReqs.includes(req)

                                ? currentReqs.filter(r => r !== req)

                                : [...currentReqs, req];

                              handleProjectDraftChange('volunteerRequirements', nextReqs);

                            }}

                            activeOpacity={0.8}

                            style={{

                              flexDirection: 'row',

                              alignItems: 'center',

                              width: '47%',

                              marginBottom: 8,

                              gap: 8

                            }}

                          >

                            <MaterialIcons

                              name={isChecked ? 'check-box' : 'check-box-outline-blank'}

                              size={20}

                              color={isChecked ? '#166534' : '#64748b'}

                            />

                            <Text style={{ fontSize: 13, color: '#334155', flex: 1 }}>{req}</Text>

                          </TouchableOpacity>

                        );

                      })}

                    </View>



                    {/* Add Custom Requirement Input Row */}

                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>

                      <TextInput

                        style={{

                          flex: 1,

                          height: 36,

                          borderWidth: 1,

                          borderColor: '#cbd5e1',

                          borderRadius: 8,

                          paddingHorizontal: 12,

                          fontSize: 13,

                          color: '#1e293b',

                          backgroundColor: '#fff',

                        }}

                        placeholder="Add custom requirement..."

                        placeholderTextColor="#94a3b8"

                        value={customRequirementText}

                        onChangeText={setCustomRequirementText}

                      />

                      <TouchableOpacity

                        style={{

                          height: 36,

                          paddingHorizontal: 16,

                          borderRadius: 8,

                          backgroundColor: '#166534',

                          justifyContent: 'center',

                          alignItems: 'center',

                        }}

                        onPress={() => {

                          const val = customRequirementText.trim();

                          if (!val) return;

                          const currentReqs = projectDraft.volunteerRequirements || [];

                          if (currentReqs.includes(val)) {

                            Alert.alert('Alert', 'Requirement already exists.');

                            return;

                          }

                          handleProjectDraftChange('volunteerRequirements', [...currentReqs, val]);

                          setCustomRequirementText('');

                        }}

                      >

                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>+ Custom</Text>

                      </TouchableOpacity>

                    </View>

                  </View>

                )}



                {/* Skills Needed */}

                <View style={styles.formFieldContainer}>

                  <View style={styles.fieldLabelRow}>

                    <View style={[styles.fieldLabelIconBg, { backgroundColor: '#f0fdf4' }]}>

                      <MaterialIcons name="people" size={16} color="#166534" />

                    </View>

                    <Text style={styles.formFieldLabel}>Skills Needed</Text>

                  </View>

                  <Text style={styles.formFieldDescText}>

                    Select skills needed for this project or event. You can also add a custom skill.

                  </Text>

                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 }}>

                    <View style={[styles.formPickerContainer, { flex: 1, marginBottom: 0 }]}>

                      <Picker

                        selectedValue=""

                        onValueChange={(itemValue: string) => {

                          if (itemValue) {

                            toggleProjectSkill(itemValue);

                          }

                        }}

                        style={styles.formPicker}

                      >

                        <Picker.Item label="Search or select skills..." value="" />

                        {TASK_SKILL_OPTIONS.map(skill => (

                          <Picker.Item key={skill} label={skill} value={skill} />

                        ))}

                      </Picker>

                    </View>

                    <TouchableOpacity

                      style={styles.addCustomSkillButtonGreenOutline}

                      onPress={() => {

                        Alert.prompt(

                          'Add Custom Skill',

                          'Enter the name of the custom skill:',

                          [

                            { text: 'Cancel', style: 'cancel' as const },

                            {

                              text: 'Add',

                              onPress: (text?: string) => {

                                if (text && text.trim()) {

                                  if (!projectDraft.skillsNeeded.includes(text.trim())) {

                                    handleProjectDraftChange('skillsNeeded', [...projectDraft.skillsNeeded, text.trim()]);

                                  }

                                }

                              }

                            }

                          ]

                        );

                      }}

                    >

                      <Text style={styles.addCustomSkillButtonGreenOutlineText}>+ Add new skill</Text>

                    </TouchableOpacity>

                  </View>



                  {/* Selected Skills Chips Container */}

                  <View style={styles.selectedSkillsLabelRow}>

                    <Text style={styles.selectedSkillsLabel}>Selected Skills</Text>

                  </View>

                  <View style={styles.selectedSkillsGrayBox}>

                    {projectDraft.skillsNeeded.length > 0 ? (

                      <View style={styles.selectedSkillChips}>

                        {projectDraft.skillsNeeded.map(skill => (

                          <TouchableOpacity

                            key={skill}

                            style={styles.selectedSkillChip}

                            onPress={() => removeProjectSkill(skill)}

                          >

                            <Text style={styles.selectedSkillChipText}>{skill}</Text>

                            <MaterialIcons name="close" size={12} color="#475569" style={{ marginLeft: 4 }} />

                          </TouchableOpacity>

                        ))}

                      </View>

                    ) : (

                      <Text style={styles.noSkillsText}>No skills selected yet.</Text>

                    )}

                  </View>

                </View>



                {/* Document Attachment */}

                {!projectDraft.isEvent && (

                  <View style={styles.formFieldContainer}>

                    <View style={styles.fieldLabelRow}>

                      <View style={[styles.fieldLabelIconBg, { backgroundColor: '#eff6ff' }]}>

                        <MaterialIcons name="insert-drive-file" size={16} color="#2563eb" />

                      </View>

                      <Text style={styles.formFieldLabel}>Document Attachment</Text>

                    </View>

                    <Text style={styles.formFieldDescText}>

                      Keep the project document aligned with the approved proposal file.

                    </Text>

                    <View style={styles.uploadDashedBox}>

                      <View style={styles.uploadIconCircle}>

                        <MaterialIcons name="description" size={24} color="#94a3b8" />

                      </View>



                      {projectDraft.attachmentUrl ? (

                        <View style={{ alignItems: 'center' }}>

                          <Text style={styles.uploadTitle}>

                            Document uploaded: {projectDraft.attachmentUrl.split('/').pop() || 'Attached document'}

                          </Text>

                        </View>

                      ) : (

                        <>

                          <Text style={styles.uploadTitle}>No document uploaded yet.</Text>

                          <Text style={styles.uploadSubtitle}>Upload proposal or supporting documents.</Text>

                        </>

                      )}



                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>

                        <TouchableOpacity style={styles.uploadButtonGreenOutline} onPress={handlePickProjectDocument}>

                          <MaterialIcons name="attach-file" size={16} color="#166534" style={{ marginRight: 6 }} />

                          <Text style={styles.uploadButtonGreenOutlineText}>

                            {projectDraft.attachmentUrl ? 'Replace Document' : 'Upload Document'}

                          </Text>

                        </TouchableOpacity>

                        {projectDraft.attachmentUrl ? (

                          <TouchableOpacity style={styles.uploadRemoveButtonRedOutline} onPress={handleRemoveProjectDocument}>

                            <MaterialIcons name="delete-outline" size={16} color="#ef4444" style={{ marginRight: 6 }} />

                            <Text style={styles.uploadRemoveButtonRedOutlineText}>Remove</Text>

                          </TouchableOpacity>

                        ) : null}

                      </View>

                      <Text style={styles.uploadHint}>PDF (Max. 25MB)</Text>

                    </View>

                  </View>

                )}



              </View>

            </View>



            {/* Bottom Actions Footer Row matching mockup */}

            <View style={styles.modalFooterActionsRow}>

              <TouchableOpacity style={styles.modalFooterCancelButton} onPress={closeProjectModal}>

                <Text style={styles.modalFooterCancelButtonText}>Cancel</Text>

              </TouchableOpacity>

              <TouchableOpacity style={styles.modalFooterSubmitButton} onPress={handleSaveProjectRecord}>

                <MaterialIcons name="add" size={18} color="#ffffff" style={{ marginRight: 6 }} />

                <Text style={styles.modalFooterSubmitButtonText}>

                  {editingProjectId

                    ? projectDraft.isEvent ? 'Update Event' : 'Update Project'

                    : projectDraft.isEvent ? 'Create Event' : 'Create Project'}

                </Text>

              </TouchableOpacity>

            </View>

          </ScrollView>

        )}







        {/* Saving Event Loading Modal */}

        <Modal transparent visible={isSavingEvent} animationType="fade">

          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>

            <View style={{ backgroundColor: '#ffffff', padding: 24, borderRadius: 16, alignItems: 'center', gap: 12, width: 220 }}>

              <ActivityIndicator size="large" color="#166534" />

              <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b' }}>Saving Event...</Text>

            </View>

          </View>

        </Modal>

      </View>

    );



    if (!showProjectModal) return null;



    if (isWeb) {

      return (

        <View style={projectEditorStyles.webOverlay}>

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

    return null;

  };



  const renderProgramWebDetailsModal = () => {

    if (!selectedProgramWebSection) {

      return null;

    }



    const overview = getProgramWebOverview(selectedProgramWebSection.title);

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

                  <Text style={[programWebStyles.navCtaText, { color: accent }]}>View projects ΓåÆ</Text>

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

                          {getProjectDisplayStatus(project)} ┬╖ {formatProjectDateRangeLabel(project.startDate, project.endDate)}

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

                <Text style={programWebStyles.footerText}>NVC ┬╖ {selectedProgramWebSection.title} Program</Text>

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

                    <Text style={[programWebStyles.footerPrimaryText, { color: accent }]}>View projects ΓåÆ</Text>

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



  const schedulerCalendarDaysMonday = useMemo(() => {

    return getMonthCalendarDaysMonday(schedulerAnchorDate);

  }, [schedulerAnchorDate]);



  const schedulerCalendarWeeksMonday = useMemo(

    () => [0, 1, 2, 3, 4, 5].map(weekIndex => schedulerCalendarDaysMonday.slice(weekIndex * 7, weekIndex * 7 + 7)),

    [schedulerCalendarDaysMonday]

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



  if (selectedProgramProposalModule) {

    const module = selectedProgramProposalModule;

    const pendingProposal =

      module

        ? allPartnerApplications.find(

          application =>

            application.status === 'Pending' &&

            getProgramModuleFromProposalProjectId(application.projectId) === module

        ) || null

        : null;



    const section = programSections.find(s => s.module === module) || null;

    const track = activeProgramTracks.find(t => t.id === module) || null;

    const accent = section?.accent || track?.color || '#6366f1';

    const icon = section?.icon || track?.icon || 'folder';

    const programProjects = section?.projects || [];



    const isWeb = Platform.OS === 'web';



    const renderProjectCard = (project: Project) => {

      const headerBackground = isWeb

        ? { backgroundImage: `linear-gradient(135deg, ${accent || '#6366f1'}, ${accent ? accent + 'cc' : '#4f46e5'})` }

        : { backgroundColor: accent || '#6366f1' };



      return (

        <View key={project.id} style={{

          width: isDesktop ? '48%' : '100%',

          backgroundColor: '#ffffff',

          borderRadius: 16,

          borderWidth: 1,

          borderColor: '#f1f5f9',

          shadowColor: '#0f172a',

          shadowOpacity: 0.05,

          shadowRadius: 10,

          shadowOffset: { width: 0, height: 4 },

          elevation: 3,

          overflow: 'hidden',

          marginBottom: 8,

        }}>

          {/* Top Gradient/Solid Background Header */}

          <View style={[{

            height: 120,

            alignItems: 'center',

            justifyContent: 'center',

          }, headerBackground]}>

            <MaterialIcons name={icon as any || 'folder'} size={40} color="#ffffff" style={{ opacity: 0.95 }} />

          </View>



          {/* Bottom Text Part */}

          <View style={{ padding: 16, flex: 1, justifyContent: 'space-between' }}>

            <View>

              <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 6 }} numberOfLines={1}>

                {project.title}

              </Text>

              <Text style={{ fontSize: 12, color: '#475569', lineHeight: 16, marginBottom: 14 }} numberOfLines={3}>

                {project.description || 'No description provided.'}

              </Text>

            </View>



            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>

              <TouchableOpacity

                style={{

                  flexDirection: 'row',

                  alignItems: 'center',

                  alignSelf: 'flex-start',

                  backgroundColor: '#818cf8',

                  paddingVertical: 6,

                  paddingHorizontal: 12,

                  borderRadius: 20,

                }}

                onPress={() => {

                  closeProgramProposalModal();

                  handleSelectProject(project);

                }}

              >

                <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700', marginRight: 4, letterSpacing: 0.5 }}>

                  LEARN MORE

                </Text>

                <MaterialIcons name="arrow-forward" size={10} color="#ffffff" />

              </TouchableOpacity>



              {isAdmin && (

                activeInlineCreateEventProjectId === project.id ? (

                  <Pressable style={{ marginTop: 12, width: '100%' }} onPress={(e) => e.stopPropagation()}>

                    {renderInlineEventForm(project, section || { module: track?.id || module, title: track?.title || module, accent: accent })}

                  </Pressable>

                ) : (

                  <TouchableOpacity

                    style={{

                      flexDirection: 'row',

                      alignItems: 'center',

                      alignSelf: 'flex-start',

                      backgroundColor: '#0284c7',

                      paddingVertical: 6,

                      paddingHorizontal: 12,

                      borderRadius: 20,

                    }}

                    onPress={() => {

                      startInlineEventCreation(project);

                    }}

                  >

                    <MaterialIcons name="add" size={12} color="#ffffff" style={{ marginRight: 2 }} />

                    <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>

                      ADD EVENT

                    </Text>

                  </TouchableOpacity>

                )

              )}

            </View>

          </View>

        </View>

      );

    };



    const renderCompactProjectItem = (project: Project) => {

      return (

        <View key={project.id} style={{ width: '100%', marginBottom: 8 }}>

          <TouchableOpacity

            style={{

              flexDirection: 'row',

              alignItems: 'center',

              justifyContent: 'space-between',

              backgroundColor: '#ffffff',

              borderRadius: 10,

              borderWidth: 1,

              borderColor: '#f1f5f9',

              paddingHorizontal: 12,

              paddingVertical: 10,

              width: '100%',

            }}

            onPress={() => {

              closeProgramProposalModal();

              handleSelectProject(project);

            }}

          >

            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}>

              <View style={{

                width: 32,

                height: 32,

                borderRadius: 6,

                backgroundColor: `${accent}15`,

                alignItems: 'center',

                justifyContent: 'center',

              }}>

                <MaterialIcons name={icon as any || 'folder'} size={18} color={accent} />

              </View>

              <View style={{ flex: 1 }}>

                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }} numberOfLines={1}>

                  {project.title}

                </Text>

                <Text style={{ fontSize: 11, color: '#64748b' }} numberOfLines={1}>

                  {project.description || 'No description.'}

                </Text>

              </View>

            </View>



            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>

              {isAdmin && (

                <TouchableOpacity

                  style={{

                    flexDirection: 'row',

                    alignItems: 'center',

                    backgroundColor: '#e0f2fe',

                    paddingVertical: 4,

                    paddingHorizontal: 8,

                    borderRadius: 6,

                    gap: 4

                  }}

                  onPress={(e) => {

                    e.stopPropagation();

                    startInlineEventCreation(project);

                  }}

                >

                  <MaterialIcons name="add" size={12} color="#0369a1" />

                  <Text style={{ color: '#0369a1', fontSize: 11, fontWeight: '700' }}>Add Event</Text>

                </TouchableOpacity>

              )}



              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>

                <Text style={{ color: '#6366f1', fontSize: 11, fontWeight: '700' }}>Open</Text>

                <MaterialIcons name="chevron-right" size={14} color="#6366f1" />

              </View>

            </View>

          </TouchableOpacity>



          {activeInlineCreateEventProjectId === project.id && (

            <Pressable style={{ marginTop: 8, width: '100%' }} onPress={(e) => e.stopPropagation()}>

              {renderInlineEventForm(project, section || { module: track?.id || module, title: track?.title || module, accent: accent })}

            </Pressable>

          )}

        </View>

      );

    };



    const renderCompactPendingProposalItem = (proposal: any) => {

      return (

        <View style={{

          backgroundColor: '#fffdfa',

          borderWidth: 1,

          borderColor: '#fed7aa',

          borderRadius: 12,

          padding: 12,

        }}>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>

            <MaterialIcons name="business" size={16} color="#ea580c" />

            <Text style={{ fontSize: 13, fontWeight: '800', color: '#1e293b', flex: 1 }} numberOfLines={1}>

              {proposal.partnerName}

            </Text>

            <View style={{ backgroundColor: '#ffedd5', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8 }}>

              <Text style={{ fontSize: 9, fontWeight: '700', color: '#ea580c' }}>PENDING</Text>

            </View>

          </View>



          <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 4 }} numberOfLines={1}>

            {proposal.proposalDetails?.proposedTitle || 'Untitled Proposal'}

          </Text>

          <Text style={{ fontSize: 11, color: '#475569', lineHeight: 15, marginBottom: 8 }} numberOfLines={2}>

            {proposal.proposalDetails?.proposedDescription || 'No description.'}

          </Text>



          {isAdmin && (

            <View style={{ flexDirection: 'row', gap: 6 }}>

              <TouchableOpacity

                style={{

                  flex: 1,

                  backgroundColor: '#166534',

                  paddingVertical: 6,

                  borderRadius: 6,

                  alignItems: 'center',

                }}

                onPress={async () => {

                  closeProgramProposalModal();

                  await handleReviewPartnerApplication(proposal.id, 'Approved');

                }}

              >

                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Approve</Text>

              </TouchableOpacity>

              <TouchableOpacity

                style={{

                  flex: 1,

                  backgroundColor: '#b91c1c',

                  paddingVertical: 6,

                  borderRadius: 6,

                  alignItems: 'center',

                }}

                onPress={async () => {

                  closeProgramProposalModal();

                  await handleReviewPartnerApplication(proposal.id, 'Rejected');

                }}

              >

                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Reject</Text>

              </TouchableOpacity>

            </View>

          )}

        </View>

      );

    };



    return (

      <View style={[styles.screenShell, { backgroundColor: '#f8fafc' }]}>

        {/* Workspace Toolbar/Header */}

        <View style={{

          flexDirection: 'row',

          alignItems: 'center',

          justifyContent: 'space-between',

          paddingHorizontal: 24,

          paddingVertical: 16,

          backgroundColor: '#ffffff',

          borderBottomWidth: 1,

          borderBottomColor: '#e2e8f0',

        }}>

          {/* Breadcrumb / Title */}

          <View style={{ flex: 1 }}>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>

              <TouchableOpacity onPress={closeProgramProposalModal}>

                <Text style={{ fontSize: 13, color: '#64748b', fontWeight: '500' }}>Programs</Text>

              </TouchableOpacity>

              <MaterialIcons name="chevron-right" size={16} color="#94a3b8" />

              <Text style={{ fontSize: 13, color: '#0f172a', fontWeight: '700' }}>Workspace</Text>

            </View>

            <Text style={{ fontSize: 24, fontWeight: '900', color: '#0f172a' }}>

              {track?.title || module} Workspace

            </Text>

          </View>



          {/* Right Toolbar Actions */}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>

            {/* Layout Mode Switcher */}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f1f5f9', padding: 3, borderRadius: 8 }}>

              <TouchableOpacity

                onPress={() => setWorkspaceLayoutMode('card')}

                style={{

                  paddingVertical: 6,

                  paddingHorizontal: 12,

                  borderRadius: 6,

                  backgroundColor: workspaceLayoutMode === 'card' ? '#ffffff' : 'transparent',

                  shadowColor: workspaceLayoutMode === 'card' ? '#000' : 'transparent',

                  shadowOffset: { width: 0, height: 1 },

                  shadowOpacity: 0.1,

                  shadowRadius: 1,

                  elevation: workspaceLayoutMode === 'card' ? 1 : 0,

                  flexDirection: 'row',

                  alignItems: 'center',

                  gap: 4

                }}

              >

                <MaterialIcons name="grid-view" size={14} color={workspaceLayoutMode === 'card' ? '#0f172a' : '#64748b'} />

                <Text style={{ fontSize: 11, fontWeight: '700', color: workspaceLayoutMode === 'card' ? '#0f172a' : '#64748b' }}>Cards</Text>

              </TouchableOpacity>

              <TouchableOpacity

                onPress={() => setWorkspaceLayoutMode('compact')}

                style={{

                  paddingVertical: 6,

                  paddingHorizontal: 12,

                  borderRadius: 6,

                  backgroundColor: workspaceLayoutMode === 'compact' ? '#ffffff' : 'transparent',

                  shadowColor: workspaceLayoutMode === 'compact' ? '#000' : 'transparent',

                  shadowOffset: { width: 0, height: 1 },

                  shadowOpacity: 0.1,

                  shadowRadius: 1,

                  elevation: workspaceLayoutMode === 'compact' ? 1 : 0,

                  flexDirection: 'row',

                  alignItems: 'center',

                  gap: 4

                }}

              >

                <MaterialIcons name="format-list-bulleted" size={14} color={workspaceLayoutMode === 'compact' ? '#0f172a' : '#64748b'} />

                <Text style={{ fontSize: 11, fontWeight: '700', color: workspaceLayoutMode === 'compact' ? '#0f172a' : '#64748b' }}>Compact</Text>

              </TouchableOpacity>

            </View>



            {isAdmin && (

              <TouchableOpacity

                onPress={() => startInlineProjectCreation(track?.id || module, track?.title || module, pendingProposal)}

                style={{

                  flexDirection: 'row',

                  alignItems: 'center',

                  backgroundColor: accent || '#6366f1',

                  paddingVertical: 8,

                  paddingHorizontal: 16,

                  borderRadius: 8,

                  gap: 6

                }}

              >

                <MaterialIcons name="add" size={16} color="#ffffff" />

                <Text style={{ fontSize: 13, fontWeight: '700', color: '#ffffff' }}>Create Project</Text>

              </TouchableOpacity>

            )}



            {/* Back Button */}

            <TouchableOpacity

              onPress={closeProgramProposalModal}

              style={{

                flexDirection: 'row',

                alignItems: 'center',

                backgroundColor: '#f1f5f9',

                paddingVertical: 8,

                paddingHorizontal: 16,

                borderRadius: 8,

                gap: 6

              }}

            >

              <MaterialIcons name="arrow-back" size={16} color="#334155" />

              <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Back</Text>

            </TouchableOpacity>

          </View>

        </View>



        {/* Workspace Body */}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }}>

          <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: 24 }}>



            {/* Left Section: Active Projects */}

            <View style={{ flex: 1.8 }}>

              <Text style={{ fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 16 }}>

                Active Projects ({programProjects.length})

              </Text>



              {activeInlineCreateProjectProgramId === (track?.id || module) && (

                <View style={{ marginBottom: 16, width: '100%' }}>

                  {renderInlineProjectForm(section || { module: track?.id || module, title: track?.title || module, accent: accent, border: accent + '33', surface: accent + '08' })}

                </View>

              )}



              {workspaceLayoutMode === 'compact' ? (

                <View style={{ width: '100%' }}>

                  {programProjects.length > 0 ? (

                    programProjects.map(project => renderCompactProjectItem(project))

                  ) : (

                    <View style={{

                      padding: 40,

                      alignItems: 'center',

                      justifyContent: 'center',

                      width: '100%',

                      borderWidth: 1,

                      borderColor: '#e2e8f0',

                      borderStyle: 'dashed',

                      borderRadius: 12,

                      backgroundColor: '#ffffff'

                    }}>

                      <MaterialIcons name="folder-open" size={36} color="#94a3b8" />

                      <Text style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>

                        No projects created in this program yet.

                      </Text>

                    </View>

                  )}

                </View>

              ) : (

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>

                  {programProjects.length > 0 ? (

                    programProjects.map(project => renderProjectCard(project))

                  ) : (

                    <View style={{

                      padding: 40,

                      alignItems: 'center',

                      justifyContent: 'center',

                      width: '100%',

                      borderWidth: 1,

                      borderColor: '#e2e8f0',

                      borderStyle: 'dashed',

                      borderRadius: 12,

                      backgroundColor: '#ffffff'

                    }}>

                      <MaterialIcons name="folder-open" size={36} color="#94a3b8" />

                      <Text style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>

                        No projects created in this program yet.

                      </Text>

                    </View>

                  )}

                </View>

              )}

            </View>



            {/* Right Section: Pending Proposals */}

            <View style={{ width: isDesktop ? 360 : '100%' }}>

              <Text style={{ fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 16 }}>

                Pending Proposals

              </Text>



              {pendingProposal ? (

                workspaceLayoutMode === 'compact' ? (

                  renderCompactPendingProposalItem(pendingProposal)

                ) : (

                  <View style={{

                    backgroundColor: '#fffdfa',

                    borderWidth: 1,

                    borderColor: '#fed7aa',

                    borderRadius: 16,

                    padding: 20,

                    shadowColor: '#0f172a',

                    shadowOpacity: 0.04,

                    shadowRadius: 8,

                    shadowOffset: { width: 0, height: 4 },

                    elevation: 2,

                  }}>

                    {/* Partner Info */}

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 }}>

                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffedd5', alignItems: 'center', justifyContent: 'center' }}>

                        <MaterialIcons name="business" size={18} color="#ea580c" />

                      </View>

                      <View style={{ flex: 1 }}>

                        <Text style={{ fontSize: 14, fontWeight: '800', color: '#1e293b' }} numberOfLines={1}>

                          {pendingProposal.partnerName}

                        </Text>

                        <Text style={{ fontSize: 11, color: '#64748b' }} numberOfLines={1}>

                          {pendingProposal.partnerEmail}

                        </Text>

                      </View>

                      <View style={{ backgroundColor: '#ffedd5', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12 }}>

                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#ea580c' }}>PENDING</Text>

                      </View>

                    </View>



                    <View style={{ borderBottomWidth: 1, borderBottomColor: '#fed7aa', marginVertical: 8 }} />



                    {/* Proposal Details */}

                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 }}>PROPOSED TITLE</Text>

                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 12 }}>

                      {pendingProposal.proposalDetails?.proposedTitle || 'Untitled Proposal'}

                    </Text>



                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 }}>DESCRIPTION</Text>

                    <Text style={{ fontSize: 12, color: '#334155', lineHeight: 16, marginBottom: 12 }} numberOfLines={4}>

                      {pendingProposal.proposalDetails?.proposedDescription || 'No description.'}

                    </Text>



                    {/* Removed Community Need as requested */}



                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>

                      <View>

                        <Text style={{ fontSize: 10, color: '#64748b' }}>Volunteers Needed</Text>

                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}>

                          {pendingProposal.proposalDetails?.proposedVolunteersNeeded ?? 'N/A'}

                        </Text>

                      </View>

                      <View>

                        <Text style={{ fontSize: 10, color: '#64748b' }}>Target Date</Text>

                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}>

                          {formatProposalDateValue(pendingProposal.proposalDetails?.proposedStartDate)}

                        </Text>

                      </View>

                    </View>



                    {isAdmin && (

                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>

                        <TouchableOpacity

                          style={{

                            flex: 1,

                            backgroundColor: '#166534',

                            paddingVertical: 10,

                            borderRadius: 8,

                            alignItems: 'center',

                          }}

                          onPress={async () => {

                            closeProgramProposalModal();

                            await handleReviewPartnerApplication(pendingProposal.id, 'Approved');

                          }}

                        >

                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Approve</Text>

                        </TouchableOpacity>

                        <TouchableOpacity

                          style={{

                            flex: 1,

                            backgroundColor: '#b91c1c',

                            paddingVertical: 10,

                            borderRadius: 8,

                            alignItems: 'center',

                          }}

                          onPress={async () => {

                            closeProgramProposalModal();

                            await handleReviewPartnerApplication(pendingProposal.id, 'Rejected');

                          }}

                        >

                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Reject</Text>

                        </TouchableOpacity>

                      </View>

                    )}

                  </View>

                )

              ) : (

                <View style={{

                  backgroundColor: '#f8fafc',

                  borderWidth: 1,

                  borderColor: '#e2e8f0',

                  borderRadius: 16,

                  padding: 24,

                  alignItems: 'center',

                  justifyContent: 'center',

                }}>

                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>

                    <MaterialIcons name="check-circle" size={22} color="#15803d" />

                  </View>

                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#1e293b', marginBottom: 4 }}>All Caught Up</Text>

                  <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', lineHeight: 16 }}>

                    No pending proposals for this program module.

                  </Text>

                </View>

              )}

            </View>

          </View>

        </ScrollView>

      </View>

    );

  }



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
    const formattedProjectLocation = formatProjectLocation(activeSelectedProject);

    const activeProjectVolunteerSummary = getProjectVolunteerSummary(activeSelectedProject);

    const volunteerSlotsFilled = activeProjectVolunteerSummary.count;

    const volunteerSlotsNeeded = activeProjectVolunteerSummary.needed;

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

        value: formattedProjectLocation,

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

          meta: 'Aggregated from this eventΓÇÖs task skills and event skill tags',

        },

        {

          label: 'Task Board',

          value: `${internalTasks.length} task${internalTasks.length === 1 ? '' : 's'}`,

          meta: internalTasks.length ? 'Assignments are ready to review' : 'No tasks created yet',

        },

      ]

      : [];



    const projectReports = allPartnerReports.filter(

      report => report.projectId === activeSelectedProject.id

    );

    const beneficiariesCount = projectReports.reduce((sum, r) => sum + (r.metrics?.beneficiariesServed || 0), 0);

    const reportsCount = projectReports.length;

    const volunteersCount = volunteerEntries.length;

    const projectAuthorName =

      partners.find(partner => partner.id === activeSelectedProject.partnerId)?.name ||

      (isAdmin && user?.name ? user.name : 'NVC Admin');

    const projectDocumentAttachment = (activeSelectedProject as any).attachments?.find(

      (attachment: any) => attachment?.type === 'document' && attachment?.url

    );



    const getEventDateParts = (dateString: string) => {

      try {

        const d = new Date(dateString);

        if (isNaN(d.getTime())) return { month: 'TBD', day: '--' };

        const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();

        const day = d.toLocaleDateString('en-US', { day: 'numeric' });

        return { month, day };

      } catch {

        return { month: 'TBD', day: '--' };

      }

    };



    const getProjectProgramTitle = (project: Project) => {

      let targetProject = project;

      if (project.isEvent && project.parentProjectId) {

        const parent = projects.find(p => p.id === project.parentProjectId);

        if (parent) {

          targetProject = parent;

        }

      }

      const programId = targetProject.program_id || targetProject.parentProjectId || targetProject.programModule;

      if (programId) {

        const section = programSections.find(s => s.module === programId || s.title === programId);

        if (section) return section.title;

      }

      return detailModuleLabel || 'Nutrition';

    };



    const handleAttendanceChange = async (volunteerId: string, status: 'Present' | 'Absent' | 'Late') => {

      try {

        const todayKey = getLocalDateKey(currentDate.toISOString());

        const allLogs = await getStorageItem<VolunteerTimeLog[]>('volunteerTimeLogs') || [];

        const todayLogIndex = allLogs.findIndex(log => 

          log.volunteerId === volunteerId && 

          log.projectId === activeSelectedProject.id && 

          getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === todayKey

        );



        if (status === 'Absent') {

          if (todayLogIndex >= 0) {

            allLogs.splice(todayLogIndex, 1);

            await setStorageItem('volunteerTimeLogs', allLogs);

            void loadVolunteerTimeLogs();

          }

        } else {

          const existingNote = todayLogIndex >= 0 ? allLogs[todayLogIndex].note || '' : '';

          let cleanNote = existingNote.replace(/^\[Late\]\s*/, '');

          const finalNote = status === 'Late' ? `[Late] ${cleanNote}`.trim() : cleanNote;



          if (todayLogIndex >= 0) {

            allLogs[todayLogIndex] = {

              ...allLogs[todayLogIndex],

              note: finalNote,

              attendanceCheckedAt: new Date().toISOString(),

              attendanceCheckedBy: user?.id || 'Admin',

              attendanceCheckedByName: user?.name || 'Admin',

            };

          } else {

            const newLog: VolunteerTimeLog = {

              id: `log-${Date.now()}-${volunteerId}`,

              volunteerId,

              projectId: activeSelectedProject.id,

              timeIn: new Date().toISOString(),

              timeOut: new Date().toISOString(),

              attendanceConfirmedAt: new Date().toISOString(),

              attendanceCheckedAt: new Date().toISOString(),

              attendanceCheckedBy: user?.id || 'Admin',

              attendanceCheckedByName: user?.name || 'Admin',

              note: finalNote,

            };

            allLogs.push(newLog);

          }

          await setStorageItem('volunteerTimeLogs', allLogs);

          void loadVolunteerTimeLogs();

        }

      } catch (error) {

        Alert.alert('Error', 'Failed to update attendance status.');

      }

    };



    const handleTaskCompletedChange = async (volunteerId: string, taskTitle: string) => {

      try {

        const todayKey = getLocalDateKey(currentDate.toISOString());

        const allLogs = await getStorageItem<VolunteerTimeLog[]>('volunteerTimeLogs') || [];

        const todayLogIndex = allLogs.findIndex(log => 

          log.volunteerId === volunteerId && 

          log.projectId === activeSelectedProject.id && 

          getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === todayKey

        );



        let logToUpdate: VolunteerTimeLog;

        if (todayLogIndex >= 0) {

          logToUpdate = allLogs[todayLogIndex];

        } else {

          logToUpdate = {

            id: `log-${Date.now()}-${volunteerId}`,

            volunteerId,

            projectId: activeSelectedProject.id,

            timeIn: new Date().toISOString(),

            timeOut: new Date().toISOString(),

            attendanceConfirmedAt: new Date().toISOString(),

            attendanceCheckedAt: new Date().toISOString(),

            attendanceCheckedBy: user?.id || 'Admin',

            attendanceCheckedByName: user?.name || 'Admin',

            note: '',

          };

          allLogs.push(logToUpdate);

        }



        const isLate = logToUpdate.note?.startsWith('[Late]');

        const cleanTaskTitle = taskTitle === 'None' ? '' : taskTitle;

        const finalNote = isLate ? `[Late] ${cleanTaskTitle}`.trim() : cleanTaskTitle;



        logToUpdate.note = finalNote;

        if (todayLogIndex >= 0) {

          allLogs[todayLogIndex] = logToUpdate;

        } else {

          allLogs[allLogs.length - 1] = logToUpdate;

        }

        await setStorageItem('volunteerTimeLogs', allLogs);



        const eventTasks = Array.isArray(activeSelectedProject.internalTasks) ? [...activeSelectedProject.internalTasks] : [];

        let tasksUpdated = false;



        eventTasks.forEach(task => {

          if (task.assignedVolunteerId === volunteerId) {

            task.assignedVolunteerId = undefined;

            task.assignedVolunteerName = undefined;

            task.status = 'Unassigned';

            tasksUpdated = true;

          }

          if (Array.isArray(task.assignedVolunteerIds) && task.assignedVolunteerIds.includes(volunteerId)) {

            task.assignedVolunteerIds = task.assignedVolunteerIds.filter(id => id !== volunteerId);

            task.assignedVolunteerNames = (task.assignedVolunteerNames || []).filter(name => name !== user?.name);

            if (task.assignedVolunteerIds.length === 0) {

              task.status = 'Unassigned';

            }

            tasksUpdated = true;

          }

        });



        if (taskTitle !== 'None') {

          const selectedTask = eventTasks.find(t => t.title === taskTitle);

          const volunteerName = volunteers.find(v => v.id === volunteerId)?.name || 'Volunteer';

          if (selectedTask) {

            selectedTask.assignedVolunteerId = volunteerId;

            selectedTask.assignedVolunteerName = volunteerName;

            selectedTask.status = 'Completed';

            tasksUpdated = true;

          }

        }



        if (tasksUpdated) {

          const updatedProject = {

            ...activeSelectedProject,

            internalTasks: eventTasks,

          };

          await saveEvent(updatedProject);

          setSelectedProject(updatedProject);

        } else {

          void loadVolunteerTimeLogs();

        }

      } catch (error) {

        Alert.alert('Error', 'Failed to update completed task.');

      }

    };

    const handleToggleAttendanceCheck = async (log: VolunteerTimeLog, checked: boolean) => {
      if (!user) return;
      if (attendanceCheckInFlightLogId === log.id) return;
      
      try {
        setAttendanceCheckInFlightLogId(log.id);
        const updatedLog = await setVolunteerAttendanceChecked(log.id, checked, user.id);
        setPreviewAttendanceLog(current => current?.id === log.id ? updatedLog : current);
        await loadVolunteerTimeLogs();
        Alert.alert('Success', checked ? 'Attendance verified' : 'Verification removed');
      } catch (error: any) {
        Alert.alert('Error', error?.message || 'Failed to update attendance verification');
      } finally {
        setAttendanceCheckInFlightLogId(null);
      }
    };



    const handleExportAttendanceReport = () => {

      const todayKey = getLocalDateKey(currentDate.toISOString());

      const eventVolunteers = getProjectVolunteerEntries(activeSelectedProject);

      const rows = eventVolunteers.map(volunteer => {

        const volunteerLogs = volunteerTimeLogs.filter(log => log.volunteerId === volunteer.id && log.projectId === activeSelectedProject.id);

        const todayLog = volunteerLogs.find(log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === todayKey);

        

        const isLate = todayLog && (todayLog.note?.startsWith('[Late]') || todayLog.note?.includes('late') || false);

        const isPresent = todayLog && !isLate;

        const attendanceStatus = isLate ? 'Late' : isPresent ? 'Present' : 'Absent';

        

        let completedTask = 'None';

        if (todayLog) {

          const cleanNote = (todayLog.note || '').replace(/^\[Late\]\s*/, '').trim();

          completedTask = cleanNote || 'None';

        }

        

        return [

          volunteer.name,

          volunteer.email,

          attendanceStatus,

          completedTask,

        ];

      });



      const csv = [

        ['Volunteer Name', 'Email', 'Attendance Status', 'Task Completed'],

        ...rows,

      ]

        .map(columns =>

          columns

            .map(value => `"${String(value).replace(/"/g, '""')}"`)

            .join(',')

        )

        .join('\n');



      if (typeof document !== 'undefined') {

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

        const url = window.URL.createObjectURL(blob);

        const link = document.createElement('a');

        link.href = url;

        link.download = `attendance-report-${activeSelectedProject.title.toLowerCase().replace(/\s+/g, '-')}-${todayKey}.csv`;

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        window.URL.revokeObjectURL(url);

        return;

      }



      Alert.alert('Report Ready', 'Report generated successfully.');

    };



    const renderInitialsAvatar = (name: string, size = 40) => {

      const initials = name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'V';

      return (

        <View style={{

          width: size,

          height: size,

          borderRadius: size / 2,

          backgroundColor: '#e8f5e9',

          alignItems: 'center',

          justifyContent: 'center',

          borderWidth: 1,

          borderColor: '#c8e6c9',

        }}>

          <Text style={{ fontSize: size * 0.35, fontWeight: '700', color: '#1b5e20' }}>

            {initials}

          </Text>

        </View>

      );

    };



    const renderAttendanceTasksView = (project: Project) => {

      const todayKey = getLocalDateKey(currentDate.toISOString());

      let dateLabel = 'TBD';

      try {

        dateLabel = format(new Date(project.startDate), 'MMM d, yyyy (EEEE)');

      } catch {}



      let timeLabel = 'TBD';

      try {

        timeLabel = `${format(new Date(project.startDate), 'h:mm a')} - ${format(new Date(project.endDate), 'h:mm a')}`;

      } catch {}



      const projectVolunteerSummary = getProjectVolunteerSummary(project);

      const volunteersCount = projectVolunteerSummary.count;

      const volunteersNeeded = projectVolunteerSummary.needed;

    const taskRows = Array.isArray(project.internalTasks) ? [...project.internalTasks] : [];

    const taskCount = taskRows.length;

    const assignedTaskCount = taskRows.filter(task => task.status === 'Assigned' || task.status === 'Completed' || task.assignedVolunteerId).length;

    const unassignedTaskCount = Math.max(taskCount - assignedTaskCount, 0);

    const assignableVolunteers = volunteerEntries.filter(entry => entry.participationStatus === 'Active');

    const taskCards = taskRows

      .slice()

      .sort((left, right) => {

        const leftAssigned = left.status === 'Completed' ? 2 : left.status === 'Assigned' ? 1 : 0;

        const rightAssigned = right.status === 'Completed' ? 2 : right.status === 'Assigned' ? 1 : 0;

        return rightAssigned - leftAssigned || left.title.localeCompare(right.title);

      });

      const activeTaskAction = taskCards.find(task => task.id === activeActionTaskId) || null;
      const activeTaskActionAssignedIds = activeTaskAction ? getTaskAssignedVolunteerIds(activeTaskAction) : [];



      const filteredVolunteers = volunteerEntries.filter(volunteer => {

        if (attendanceSearchQuery.trim()) {

          const query = attendanceSearchQuery.toLowerCase();

          if (!volunteer.name.toLowerCase().includes(query) && !volunteer.email.toLowerCase().includes(query)) {

            return false;

          }

        }



        const volunteerLogs = volunteerTimeLogs.filter(log => log.volunteerId === volunteer.id && log.projectId === project.id);

        const todayLog = volunteerLogs.find(log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn) === todayKey);



        const isLate = todayLog && (todayLog.note?.startsWith('[Late]') || todayLog.note?.includes('late') || false);

        const isPresent = todayLog && !isLate;



        if (attendanceFilter === 'Present' && !isPresent) return false;

        if (attendanceFilter === 'Late' && !isLate) return false;

        if (attendanceFilter === 'Absent' && todayLog) return false;



        return true;

      });

      const activeAttendanceVolunteer = assignableVolunteers.find(volunteer => volunteer.id === activeActionTaskId) || null;
      const activeAttendanceLogs = activeAttendanceVolunteer
        ? volunteerTimeLogs
          .filter(log => log.projectId === project.id && log.volunteerId === activeAttendanceVolunteer.id)
          .sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime())
        : [];
      const activeAttendanceLog = activeAttendanceLogs[0] || null;



      return (

        <View style={{ flex: 1 }}>

          <ScrollView

            style={{ flex: 1, backgroundColor: '#f6f7f3' }}

            contentContainerStyle={{ padding: 24, paddingBottom: 72 }}

            showsVerticalScrollIndicator={true}

          >

            <TouchableOpacity

              onPress={() => setShowAttendanceTasks(false)}

              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}

            >

            <MaterialIcons name="arrow-back" size={18} color="#166534" />

            <Text style={{ fontSize: 14, fontWeight: '700', color: '#166534', marginLeft: 6 }}>

              Back to Event

            </Text>

          </TouchableOpacity>



          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>

            <View>

              <Text style={{ fontSize: 30, fontWeight: '800', color: '#0f172a', marginBottom: 4 }}>

                Event Tasks

              </Text>

              <Text style={{ fontSize: 14, color: '#64748b' }}>

                Define tasks, required skills, and assign volunteers.

              </Text>

            </View>



            <TouchableOpacity

              onPress={() => {

                setEditingTaskId(null);

                setTaskDraft(createEmptyProjectTaskDraft());

                setShowTaskModal(true);

              }}

              style={{

                flexDirection: 'row',

                alignItems: 'center',

                backgroundColor: '#ffffff',

                borderWidth: 1,

                borderColor: '#e2e8f0',

                borderRadius: 8,

                paddingVertical: 10,

                paddingHorizontal: 16,

                shadowColor: '#0f172a',

                shadowOffset: { width: 0, height: 1 },

                shadowOpacity: 0.05,

                shadowRadius: 2,

                elevation: 1,

              }}

            >

              <MaterialIcons name="add" size={16} color="#166534" style={{ marginRight: 6 }} />

              <Text style={{ fontSize: 14, fontWeight: '700', color: '#166534' }}>Add Task</Text>

            </TouchableOpacity>

          </View>



          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>

            <View style={{

              flex: 1,

              flexDirection: 'row',

              alignItems: 'center',

              backgroundColor: '#ffffff',

              borderRadius: 12,

              padding: 16,

              borderWidth: 1,

              borderColor: '#f1f5f9',

              gap: 12

            }}>

              <View style={{ backgroundColor: '#f0fdf4', borderRadius: 8, padding: 8 }}>

                <MaterialIcons name="groups" size={20} color="#166534" />

              </View>

              <View>

                <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '500' }}>Total Estimated Volunteers</Text>

                <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>{volunteersNeeded}</Text>

                <Text style={{ fontSize: 12, color: '#64748b' }}>{volunteersCount} of {volunteersNeeded} needed</Text>

              </View>

            </View>



            <View style={{

              flex: 1,

              flexDirection: 'row',

              alignItems: 'center',

              backgroundColor: '#ffffff',

              borderRadius: 12,

              padding: 16,

              borderWidth: 1,

              borderColor: '#f1f5f9',

              gap: 12

            }}>

              <View style={{ backgroundColor: '#f0fdf4', borderRadius: 8, padding: 8 }}>

                <MaterialIcons name="check-circle" size={20} color="#3b82f6" />

              </View>

              <View>

                <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '500' }}>Tasks Created</Text>

                <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>{taskCount}</Text>

                <Text style={{ fontSize: 12, color: '#64748b' }}>{taskCount} tasks</Text>

              </View>

            </View>



            <View style={{

              flex: 1,

              flexDirection: 'row',

              alignItems: 'center',

              backgroundColor: '#ffffff',

              borderRadius: 12,

              padding: 16,

              borderWidth: 1,

              borderColor: '#f1f5f9',

              gap: 12

            }}>

              <View style={{ backgroundColor: '#f0fdf4', borderRadius: 8, padding: 8 }}>

                <MaterialIcons name="groups" size={20} color="#d97706" />

              </View>

              <View>

                <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '500' }}>Assigned Volunteers</Text>

                <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>{assignedTaskCount}</Text>

                <Text style={{ fontSize: 12, color: '#64748b' }}>{assignedTaskCount} of {volunteersNeeded} needed</Text>

              </View>

            </View>

          </View>



          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 16 }}>

            <View style={{

              flex: 1,

              flexDirection: 'row',

              alignItems: 'center',

              backgroundColor: '#ffffff',

              borderWidth: 1,

              borderColor: '#e2e8f0',

              borderRadius: 8,

              paddingHorizontal: 12,

              height: 40,

            }}>

              <MaterialIcons name="search" size={18} color="#94a3b8" style={{ marginRight: 8 }} />

              <TextInput

                placeholder="Search tasks or volunteers..."

                placeholderTextColor="#94a3b8"

                value={attendanceSearchQuery}

                onChangeText={setAttendanceSearchQuery}

                style={{ flex: 1, fontSize: 14, color: '#0f172a', padding: 0, outline: 'none' } as any}

              />

            </View>



            <View style={{

              flexDirection: 'row',

              alignItems: 'center',

              backgroundColor: '#ffffff',

              borderWidth: 1,

              borderColor: '#e2e8f0',

              borderRadius: 8,

              paddingHorizontal: 12,

              height: 40,

              width: 150,

            }}>

              <MaterialIcons name="filter-list" size={18} color="#64748b" style={{ marginRight: 8 }} />

              <Picker

                selectedValue={attendanceFilter}

                onValueChange={(val) => setAttendanceFilter(val as any)}

                style={{ flex: 1, height: 40, borderWidth: 0, backgroundColor: 'transparent', outline: 'none' } as any}

              >

                <Picker.Item label="All" value="All" />

                <Picker.Item label="Present" value="Present" />

                <Picker.Item label="Absent" value="Absent" />

                <Picker.Item label="Late" value="Late" />

              </Picker>

            </View>

          </View>



          <View style={{

            flexDirection: 'row',

            backgroundColor: '#ffffff',

            borderWidth: 1,

            borderColor: '#e2e8f0',

            borderRadius: 14,

            padding: 4,

            marginBottom: 20,

            width: 320,

          }}>

            {(['Attendance', 'Tasks'] as const).map(tab => (

              <TouchableOpacity

                key={tab}

                onPress={() => setEventWorkspaceTab(tab)}

                style={{

                  flex: 1,

                  paddingVertical: 10,

                  borderRadius: 10,

                  backgroundColor: eventWorkspaceTab === tab ? '#166534' : 'transparent',

                  alignItems: 'center',

                }}

              >

                <Text style={{

                  fontSize: 13,

                  fontWeight: '800',

                  color: eventWorkspaceTab === tab ? '#ffffff' : '#475569',

                }}>

                  {tab}

                </Text>

              </TouchableOpacity>

            ))}

          </View>



          {eventWorkspaceTab === 'Tasks' && (

          <>

          <View style={{

            backgroundColor: '#ffffff',

            borderRadius: 16,

            borderWidth: 1,

            borderColor: '#e2e8f0',

            padding: 18,

            marginBottom: 20,

          }}>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>

              <View>

                <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>Task Board</Text>

                <Text style={{ fontSize: 13, color: '#64748b' }}>Assign joined volunteers to each event task.</Text>

              </View>

              <TouchableOpacity

                onPress={() => {

                  setEditingTaskId(null);

                  setTaskDraft(createEmptyProjectTaskDraft());

                  setShowTaskModal(true);

                }}

                style={{

                  flexDirection: 'row',

                  alignItems: 'center',

                  backgroundColor: '#166534',

                  borderRadius: 10,

                  paddingHorizontal: 14,

                  paddingVertical: 10,

                }}

              >

                <MaterialIcons name="add" size={16} color="#ffffff" style={{ marginRight: 6 }} />

                <Text style={{ fontSize: 13, fontWeight: '800', color: '#ffffff' }}>Add Task</Text>

              </TouchableOpacity>

            </View>



            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>

              {[

                { label: 'Total Estimated Volunteers', value: volunteersNeeded, note: `${volunteersCount} joined` },

                { label: 'Tasks Created', value: taskCount, note: `${taskCount} task${taskCount === 1 ? '' : 's'}` },

                { label: 'Assigned Volunteers', value: assignedTaskCount, note: `${assignedTaskCount} assigned` },

                { label: 'Unassigned', value: unassignedTaskCount, note: `${unassignedTaskCount} slots open` },

              ].map((stat, idx) => (

                <View

                  key={idx}

                  style={{

                    flexGrow: 1,

                    minWidth: 170,

                    flexBasis: '22%',

                    backgroundColor: '#f8fafc',

                    borderRadius: 14,

                    borderWidth: 1,

                    borderColor: '#e2e8f0',

                    padding: 14,

                  }}

                >

                  <Text style={{ fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>{stat.label}</Text>

                  <Text style={{ fontSize: 28, fontWeight: '900', color: '#0f172a', lineHeight: 32 }}>{stat.value}</Text>

                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{stat.note}</Text>

                </View>

              ))}

            </View>

          </View>



          <View style={{

            backgroundColor: '#ffffff',

            borderRadius: 12,

            borderWidth: 1,

            borderColor: '#e2e8f0',

            overflow: 'hidden',

            maxHeight: 520,

            shadowColor: '#0f172a',

            shadowOffset: { width: 0, height: 2 },

            shadowOpacity: 0.03,

            shadowRadius: 4,

            elevation: 2,

          }}>

            <View style={{

              flexDirection: 'row',

              backgroundColor: '#f8fafc',

              borderBottomWidth: 1,

              borderBottomColor: '#e2e8f0',

              paddingVertical: 12,

              paddingHorizontal: 20,

            }}>

              <Text style={{ flex: 2.2, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>

                Task / Responsibility

              </Text>

              <Text style={{ flex: 1.4, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>

                Required Skills

              </Text>

              <Text style={{ flex: 0.8, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>

                Est. Volunteers

              </Text>

              <Text style={{ flex: 1.2, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>

                Assigned

              </Text>

              <Text style={{ width: 60, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>

                Action

              </Text>

            </View>



            <ScrollView style={{ maxHeight: 470 }} showsVerticalScrollIndicator={true}>

              {taskCards.length === 0 ? (

                <View style={{ padding: 40, alignItems: 'center' }}>

                  <MaterialIcons name="assignment" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />

                  <Text style={{ fontSize: 14, color: '#64748b', fontWeight: '500' }}>No event tasks yet</Text>

                </View>

              ) : (

                taskCards.map(task => {

                  const assignedVolunteerIds = getTaskAssignedVolunteerIds(task, volunteers);

                  const needed = Math.max(1, Number((task as any).volunteersNeeded || 1));

                  const assignedCount = assignedVolunteerIds.length;

                  const isFullyAssigned = assignedCount >= needed;

                  const hasNoVolunteers = assignedCount === 0;

                  const statusColor = isFullyAssigned ? '#166534' : assignedCount > 0 ? '#d97706' : '#dc2626';



                  const taskHasRequiredSkills = task.skillsNeeded && task.skillsNeeded.length > 0;

                  const matchingAssignableVolunteers = taskHasRequiredSkills

                    ? assignableVolunteers.filter(volEntry => {

                        const fullVol = volunteers.find(v => v.id === volEntry.id || v.userId === volEntry.id);

                        return (fullVol?.skills || []).some(skill =>

                          task.skillsNeeded.some(neededSkill => neededSkill.trim().toLowerCase() === String(skill || '').trim().toLowerCase())

                        );

                      })

                    : assignableVolunteers;

                  const noMatchingVolunteersExist = taskHasRequiredSkills && assignableVolunteers.length > 0 && matchingAssignableVolunteers.length === 0;

                  const isCurrentlyDeleting = isDeletingTaskId === task.id;



                  return (

                    <View key={task.id} style={{

                      flexDirection: 'row',

                      alignItems: 'center',

                      borderBottomWidth: 1,

                      borderBottomColor: '#f1f5f9',

                      paddingVertical: 14,

                      paddingHorizontal: 20,

                      gap: 12,

                      opacity: isCurrentlyDeleting ? 0.5 : 1,

                      zIndex: activeActionTaskId === task.id ? 50 : 1,

                    }}>

                      <View style={{ flex: 2.2, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>

                        {isCurrentlyDeleting ? (

                          <ActivityIndicator size="small" color="#dc2626" style={{ marginTop: 2 }} />

                        ) : (

                          <MaterialIcons name="drag-indicator" size={20} color="#cbd5e1" style={{ marginTop: 2 }} />

                        )}

                        <View style={{ flex: 1 }}>

                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

                            <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a' }}>{task.title}</Text>

                            {hasNoVolunteers ? (

                              <View style={{ backgroundColor: '#fef2f2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#fecaca' }}>

                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#dc2626' }}>Requires Assignment</Text>

                              </View>

                            ) : !isFullyAssigned ? (

                              <View style={{ backgroundColor: '#fffbeb', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#fde68a' }}>

                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#b45309' }}>Needs {needed - assignedCount} more</Text>

                              </View>

                            ) : null}

                            {noMatchingVolunteersExist && hasNoVolunteers ? (

                              <View style={{ backgroundColor: '#fff7ed', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#ffedd5' }}>

                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#c2410c' }}>No skill match</Text>

                              </View>

                            ) : null}

                          </View>

                          <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 18 }}>

                            {task.description}

                          </Text>

                        </View>

                      </View>



                      <View style={{ flex: 1.4, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>

                        {task.skillsNeeded.length > 0 ? task.skillsNeeded.map(skill => (

                          <View key={skill} style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>

                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#166534' }}>{skill}</Text>

                          </View>

                        )) : (

                          <Text style={{ fontSize: 12, color: '#94a3b8' }}>No skills set</Text>

                        )}

                      </View>



                      <View style={{ flex: 0.8, alignItems: 'center', justifyContent: 'center' }}>

                        <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>

                          {needed}

                        </Text>

                      </View>



                      <View style={{ flex: 1.2, alignItems: 'center' }}>

                         <Text style={{ fontSize: 14, fontWeight: '800', color: statusColor, marginBottom: 4 }}>

                            {assignedVolunteerIds.length} / {needed}

                         </Text>

                         <View style={{ flexDirection: 'row' }}>

                           {assignedVolunteerIds.slice(0, 4).map((id, index) => (

                             <View key={id} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', marginLeft: index > 0 ? -8 : 0, borderWidth: 2, borderColor: '#fff' }}>

                               <MaterialIcons name="person" size={14} color="#64748b" />

                             </View>

                           ))}

                           {assignedVolunteerIds.length > 4 && (

                             <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center', marginLeft: -8, borderWidth: 2, borderColor: '#fff' }}>

                               <Text style={{ fontSize: 10, fontWeight: '700', color: '#64748b' }}>+{assignedVolunteerIds.length - 4}</Text>

                             </View>

                           )}

                         </View>

                      </View>



                      <View style={{ width: 60, alignItems: 'center', justifyContent: 'center' }} {...({} as any)}>

                         <TouchableOpacity onPress={() => setActiveActionTaskId(activeActionTaskId === task.id ? null : task.id)} style={{ padding: 4 }}>

                            <MaterialIcons name="more-vert" size={20} color="#64748b" />

                         </TouchableOpacity>

                      </View>

                    </View>

                  );

                })

              )}

            </ScrollView>

          </View>



          {/* Info banner & Unassigned section */}

          {(() => {

            const allAssignedIds = new Set(taskCards.flatMap(t => getTaskAssignedVolunteerIds(t, volunteers)));

            // Check both v.id and v.userId so dual-ID volunteers (vol-... / user-...) are correctly detected as assigned
            const unassignedVolunteers = assignableVolunteers.filter(v =>
              !allAssignedIds.has(v.id) && !allAssignedIds.has(v.userId ?? '')
            );

            

            return (

              <View style={{ marginTop: 24, marginBottom: 40 }}>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>

                  <MaterialIcons name="info-outline" size={20} color="#166534" style={{ marginRight: 12 }} />

                  <View>

                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>Total estimated volunteers needed: {volunteersNeeded}</Text>

                    <Text style={{ fontSize: 12, color: '#64748b' }}>This will help volunteers understand where they can help.</Text>

                  </View>

                </View>



                <View style={{ backgroundColor: '#f8fafc', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' }}>

                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', marginBottom: 16 }}>

                    UNASSIGNED VOLUNTEERS ({unassignedVolunteers.length})

                  </Text>

                  

                  {unassignedVolunteers.length === 0 ? (

                    <Text style={{ fontSize: 13, color: '#64748b' }}>All joined volunteers are currently assigned to tasks.</Text>

                  ) : (

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>

                      {unassignedVolunteers.map(uv => {

                        const hasMatchingTask = taskCards.some(t => {

                          const needed = Math.max(1, Number((t as any).volunteersNeeded || 1));

                          const assigned = getTaskAssignedVolunteerIds(t, volunteers).length;

                          return assigned < needed;

                        });



                        return (

                          <View key={uv.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' }}>

                            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>

                              <MaterialIcons name="person" size={12} color="#475569" />

                            </View>

                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>{uv.name}</Text>

                            {hasMatchingTask && (

                              <TouchableOpacity

                                onPress={async () => {

                                  const targetTask = taskCards.find(t => {

                                    const needed = Math.max(1, Number((t as any).volunteersNeeded || 1));

                                    return getTaskAssignedVolunteerIds(t, volunteers).length < needed;

                                  });

                                  if (!targetTask) return;

                                  const existingIds = getTaskAssignedVolunteerIds(targetTask);

                                  const updatedTask = {

                                    ...targetTask,

                                    assignedVolunteerIds: [...existingIds, uv.id],

                                    status: 'Assigned' as const,

                                  };

                                  const updatedTasks = taskCards.map(t => t.id === targetTask.id ? updatedTask : t);

                                  await saveProjectLikeRecord({ ...activeSelectedProject, internalTasks: updatedTasks });

                                  setProjects(current => current.map(p => p.id === activeSelectedProject.id ? { ...activeSelectedProject, internalTasks: updatedTasks } : p));

                                  const uvVolunteer = volunteers.find(v => v.id === uv.id || v.userId === uv.id);

                                  if (uvVolunteer) {

                                    void notifyVolunteerAboutTaskUpdate({

                                      event: activeSelectedProject,

                                      task: updatedTask,

                                      volunteer: uvVolunteer,

                                      actorUserId: user?.id,

                                      action: 'assigned',

                                    });

                                  }

                                }}

                                style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0', marginLeft: 4 }}

                              >

                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#166534' }}>Quick Assign</Text>

                              </TouchableOpacity>

                            )}

                          </View>

                        );

                      })}

                    </View>

                  )}

                </View>

              </View>

            );

          })()}

          <Modal transparent visible={showTaskModal} animationType="fade" onRequestClose={closeTaskModal}>

            <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'center', padding: 20 }}>

              <View style={{ backgroundColor: '#ffffff', borderRadius: 18, padding: 18, maxWidth: 760, width: '100%', alignSelf: 'center' }}>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>

                  <Text style={{ fontSize: 20, fontWeight: '900', color: '#0f172a' }}>

                    {editingTaskId ? 'Edit Task' : 'Add Task'}

                  </Text>

                  <TouchableOpacity onPress={closeTaskModal}>

                    <MaterialIcons name="close" size={22} color="#64748b" />

                  </TouchableOpacity>

                </View>



                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>Task name</Text>

                <TextInput value={taskDraft.title} onChangeText={text => setTaskDraft(current => ({ ...current, title: text }))} style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, marginBottom: 12 }} />



                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>Task description</Text>

                <TextInput value={taskDraft.description} onChangeText={text => setTaskDraft(current => ({ ...current, description: text }))} style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, marginBottom: 12 }} multiline />



                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>Skills required</Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>

                  {TASK_SKILL_OPTIONS.map(skill => {

                    const isSelected = taskDraft.skillsNeeded.includes(skill);

                    return (

                      <TouchableOpacity 

                        key={skill} 

                        onPress={() => toggleTaskSkill(skill)} 

                        style={{ 

                          backgroundColor: isSelected ? '#166534' : '#f8fafc', 

                          paddingHorizontal: 10, 

                          paddingVertical: 8, 

                          borderRadius: 999,

                          borderWidth: 1,

                          borderColor: isSelected ? '#166534' : '#e2e8f0'

                        }}

                      >

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>

                          <Text style={{ fontSize: 12, fontWeight: '700', color: isSelected ? '#fff' : '#64748b' }}>

                            {skill}

                          </Text>

                          <MaterialIcons name={isSelected ? 'close' : 'add'} size={13} color={isSelected ? '#ffffff' : '#64748b'} />

                        </View>

                      </TouchableOpacity>

                    );

                  })}

                  {taskDraft.skillsNeeded.filter(s => !(TASK_SKILL_OPTIONS as readonly string[]).includes(s)).map(skill => (

                    <TouchableOpacity key={skill} onPress={() => toggleTaskSkill(skill)} style={{ backgroundColor: '#166534', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#166534' }}>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>

                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{skill}</Text>

                        <MaterialIcons name="close" size={13} color="#ffffff" />

                      </View>

                    </TouchableOpacity>

                  ))}

                </View>

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>

                  <TextInput

                    value={customTaskSkill}

                    onChangeText={setCustomTaskSkill}

                    placeholder="Add custom skill"

                    style={{ flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12 }}

                  />

                  <TouchableOpacity onPress={handleAddCustomTaskSkill} style={{ backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: '#e2e8f0' }}>

                    <Text style={{ color: '#475569', fontWeight: '800' }}>Add</Text>

                  </TouchableOpacity>

                </View>



                {/* No matching volunteer warnings */}

                {(() => {

                  const hasRequiredSkills = taskDraft.skillsNeeded && taskDraft.skillsNeeded.length > 0;

                  const matchingVolunteers = hasRequiredSkills

                    ? assignableVolunteers.filter(volEntry => {

                        const fullVol = volunteers.find(v => v.id === volEntry.id || v.userId === volEntry.id);

                        return (fullVol?.skills || []).some(skill =>

                          taskDraft.skillsNeeded.some(needed => needed.trim().toLowerCase() === String(skill || '').trim().toLowerCase())

                        );

                      })

                    : assignableVolunteers;

                  const hasNoMatchingVolunteer = hasRequiredSkills && assignableVolunteers.length > 0 && matchingVolunteers.length === 0;

                  const hasNoJoinedVolunteers = assignableVolunteers.length === 0;



                  if (hasNoJoinedVolunteers) {

                    return (

                      <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 8, padding: 10, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>

                        <MaterialIcons name="warning" size={18} color="#d97706" />

                        <Text style={{ fontSize: 12, color: '#92400e', flex: 1, fontWeight: '600' }}>

                          No volunteers have joined this event yet. Joined volunteers can be assigned once they sign up.

                        </Text>

                      </View>

                    );

                  }



                  if (hasNoMatchingVolunteer) {

                    return (

                      <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 8, padding: 10, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>

                        <MaterialIcons name="warning" size={18} color="#d97706" />

                        <Text style={{ fontSize: 12, color: '#92400e', flex: 1, fontWeight: '600' }}>

                          Warning: No suitable match exists. None of the joined volunteers currently match the selected skills ({taskDraft.skillsNeeded.join(', ')}). You may adjust required skills or assign available volunteers manually.

                        </Text>

                      </View>

                    );

                  }



                  return null;

                })()}



                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>No. of volunteers</Text>

                <TextInput value={taskDraft.volunteersNeeded} onChangeText={text => setTaskDraft(current => ({ ...current, volunteersNeeded: text }))} keyboardType="numeric" style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, marginBottom: 12 }} />



                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>Assign volunteers</Text>

                <Picker

                  selectedValue=""

                  onValueChange={(val) => {

                    const id = String(val || '');

                    if (!id || taskDraft.assignedVolunteerIds.includes(id)) return;

                    setTaskDraft(current => ({ ...current, assignedVolunteerIds: [...current.assignedVolunteerIds, id] }));

                  }}

                  style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, marginBottom: 12 }}

                >

                  <Picker.Item label="Select volunteer" value="" />

                  {assignableVolunteers.map(volunteer => {

                    const hasRequiredSkills = taskDraft.skillsNeeded && taskDraft.skillsNeeded.length > 0;

                    const fullVol = volunteers.find(v => v.id === volunteer.id || v.userId === volunteer.id);

                    const isMatch = hasRequiredSkills && (fullVol?.skills || []).some(skill =>

                      taskDraft.skillsNeeded.some(needed => needed.trim().toLowerCase() === String(skill || '').trim().toLowerCase())

                    );

                    return (

                      <Picker.Item

                        key={volunteer.id}

                        label={hasRequiredSkills ? `${volunteer.name}${isMatch ? ' ★ (Skill Match)' : ''}` : volunteer.name}

                        value={volunteer.id}

                      />

                    );

                  })}

                </Picker>



                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>

                  {taskDraft.assignedVolunteerIds.map(id => {

                    const volunteer = assignableVolunteers.find(item => item.id === id);

                    return volunteer ? (

                      <TouchableOpacity

                        key={id}

                        onPress={() => setTaskDraft(current => ({ ...current, assignedVolunteerIds: current.assignedVolunteerIds.filter(existing => existing !== id) }))}

                        style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#bbf7d0' }}

                      >

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>

                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#166534' }}>{volunteer.name}</Text>

                          <MaterialIcons name="close" size={13} color="#166534" />

                        </View>

                      </TouchableOpacity>

                    ) : null;

                  })}

                </View>



                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>

                  <TouchableOpacity

                    onPress={closeTaskModal}

                    disabled={isSavingTask}

                    style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1' }}

                  >

                    <Text style={{ fontWeight: '800', color: '#475569' }}>Cancel</Text>

                  </TouchableOpacity>



                  <TouchableOpacity

                    onPress={() => void handleSaveInternalTask()}

                    disabled={isSavingTask}

                    style={{

                      paddingHorizontal: 16,

                      paddingVertical: 12,

                      borderRadius: 10,

                      backgroundColor: '#166534',

                      flexDirection: 'row',

                      alignItems: 'center',

                      gap: 8,

                      opacity: isSavingTask ? 0.7 : 1,

                    }}

                  >

                    {isSavingTask && <ActivityIndicator size="small" color="#ffffff" />}

                    <Text style={{ fontWeight: '800', color: '#fff' }}>{isSavingTask ? 'Saving Task...' : 'Save Task'}</Text>

                  </TouchableOpacity>

                </View>

              </View>

            </View>

          </Modal>

          </>

          )}



          {eventWorkspaceTab === 'Attendance' && (

            <View style={{

              backgroundColor: '#ffffff',

              borderRadius: 12,

              borderWidth: 1,

              borderColor: '#e2e8f0',

              overflow: 'hidden',

              maxHeight: 560,

            }}>

              <View style={{

                flexDirection: 'row',

                backgroundColor: '#f8fafc',

                borderBottomWidth: 1,

                borderBottomColor: '#e2e8f0',

                paddingVertical: 12,

                paddingHorizontal: 20,

              }}>

                <Text style={{ width: 40 }} />

                <Text style={{ flex: 2, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>

                  Volunteer

                </Text>

                <Text style={{ flex: 1.2, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>

                  Attendance

                </Text>

                <Text style={{ flex: 1.2, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>

                  Time

                </Text>

                <Text style={{ flex: 2, fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>

                  Assigned Tasks

                </Text>

                <Text style={{ width: 40 }} />

              </View>



              <ScrollView style={{ maxHeight: 510 }} showsVerticalScrollIndicator={true}>

                {assignableVolunteers.length === 0 ? (

                  <View style={{ padding: 40, alignItems: 'center' }}>

                    <MaterialIcons name="groups" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />

                    <Text style={{ fontSize: 14, color: '#64748b', fontWeight: '500' }}>No volunteers assigned yet</Text>

                  </View>

                ) : (

                  assignableVolunteers.filter(v => {

                    const searchLower = attendanceSearchQuery.toLowerCase();

                    if (searchLower && !v.name.toLowerCase().includes(searchLower)) return false;

                    // For filter logic, we compute status below, but we can do a rough filter if needed

                    return true;

                  }).map(volunteer => {

                    const assignedTasks = taskCards.filter(t => getTaskAssignedVolunteerIds(t).includes(volunteer.id));

                    const assignedRoles = assignedTasks.map(t => t.title).join(', ') || 'Unassigned';

                    const completedTasks = assignedTasks.filter(t => t.status === 'Completed');

                    const logs = volunteerTimeLogs.filter(log => log.projectId === activeSelectedProject.id && log.volunteerId === volunteer.id).sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime());

                    const activeLog = logs[0];

                    

                    let attendanceStatus = 'Absent';

                    let badgeColor = '#fee2e2';

                    let textColor = '#dc2626';

                    

                    if (activeLog) {

                      attendanceStatus = 'Present';

                      badgeColor = '#dcfce7';

                      textColor = '#166534';

                      // Basic logic for Late: if timeIn is after project startDate

                      const projectStartTime = new Date(activeSelectedProject.startDate).getTime();

                      const logTime = new Date(activeLog.timeIn).getTime();

                      if (projectStartTime && logTime > projectStartTime + 15 * 60000) {

                        attendanceStatus = 'Late';

                        badgeColor = '#ffedd5';

                        textColor = '#d97706';

                      }

                    }



                    if (attendanceFilter !== 'All' && attendanceStatus !== attendanceFilter) {

                      return null;

                    }



                    const isChecked = activeLog && Boolean(activeLog.attendanceCheckedAt);
                    const isCheckingAttendance =
                      activeLog && attendanceCheckInFlightLogId === activeLog.id;

                    return (

                      <View key={volunteer.id} style={{

                        flexDirection: 'row',

                        alignItems: 'center',

                        borderBottomWidth: 1,

                        borderBottomColor: '#f1f5f9',

                        paddingVertical: 14,

                        paddingHorizontal: 20,

                        gap: 12,

                      }}>

                        <TouchableOpacity 
                          style={{ width: 40 }}
                          onPress={() => activeLog && handleToggleAttendanceCheck(activeLog, !isChecked)}
                          disabled={!activeLog || Boolean(isCheckingAttendance)}
                        >

                          {isCheckingAttendance ? (
                            <ActivityIndicator size="small" color="#166534" />
                          ) : (
                            <MaterialIcons 
                              name={isChecked ? "check-box" : "check-box-outline-blank"} 
                              size={20} 
                              color={isChecked ? "#166534" : "#cbd5e1"} 
                            />
                          )}

                        </TouchableOpacity>

                        <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>

                          {renderInitialsAvatar(volunteer.name, 36)}

                          <View style={{ flex: 1 }}>

                            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }}>{volunteer.name}</Text>

                            <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }} numberOfLines={1}>{assignedRoles}</Text>

                          </View>

                        </View>

                        <View style={{ flex: 1.2, alignItems: 'flex-start' }}>

                          <View style={{ backgroundColor: badgeColor, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>

                            <Text style={{ fontSize: 12, fontWeight: '700', color: textColor }}>{attendanceStatus}</Text>

                          </View>

                        </View>

                        <View style={{ flex: 1.2 }}>

                          {activeLog ? (

                            <>

                              <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>

                                {format(new Date(activeLog.timeIn), 'h:mm a')}

                              </Text>

                              <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>

                                {format(new Date(activeLog.timeIn), 'MMM d, yyyy')}

                              </Text>

                            </>

                          ) : (

                            <Text style={{ fontSize: 13, color: '#94a3b8' }}>ΓÇö</Text>

                          )}

                        </View>

                        <View style={{ flex: 2, justifyContent: 'center' }}>

                          {assignedTasks.length > 0 ? (

                            assignedTasks.map(t => (

                              <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>

                                <MaterialIcons name={t.status === 'Completed' ? "check-circle" : "assignment"} size={14} color={t.status === 'Completed' ? "#166534" : "#64748b"} />

                                <Text style={{ fontSize: 12, color: '#475569' }} numberOfLines={1}>{t.title}</Text>

                              </View>

                            ))

                          ) : (

                            <Text style={{ fontSize: 13, color: '#94a3b8' }}>ΓÇö</Text>

                          )}

                        </View>

                        <View style={{ width: 40, alignItems: 'flex-end' }} {...({} as any)}>

                          <TouchableOpacity 

                            onPress={() => setActiveActionTaskId(activeActionTaskId === volunteer.id ? null : volunteer.id)}

                            style={{ padding: 4 }}

                          >

                            <MaterialIcons name="more-vert" size={20} color="#64748b" />

                          </TouchableOpacity>

                        </View>

                      </View>

                    );

                  })

                )}

              </ScrollView>

            </View>

          )}



          <Modal transparent visible={Boolean(eventWorkspaceTab === 'Tasks' && activeTaskAction)} animationType="fade" onRequestClose={() => setActiveActionTaskId(null)}>

            <Pressable style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.18)', justifyContent: 'center', alignItems: 'center', padding: 20 }} onPress={() => setActiveActionTaskId(null)}>

              {activeTaskAction ? (

                <Pressable style={{ width: '100%', maxWidth: 320, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 18, elevation: 8 }} onPress={(event) => event.stopPropagation()}>

                  <TouchableOpacity

                    onPress={() => {

                      setActiveActionTaskId(null);

                      setEditingTaskId(activeTaskAction.id);

                      setTaskDraft({

                        title: activeTaskAction.title,

                        description: activeTaskAction.description,

                        category: activeTaskAction.category,

                        volunteersNeeded: String((activeTaskAction as any).volunteersNeeded || activeTaskActionAssignedIds.length || 1),

                        priority: activeTaskAction.priority,

                        status: activeTaskAction.status,

                        assignedVolunteerIds: activeTaskActionAssignedIds,

                        isFieldOfficer: activeTaskAction.isFieldOfficer || false,

                        skillsNeeded: activeTaskAction.skillsNeeded || [],

                      });

                      setShowTaskModal(true);

                    }}

                    style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}

                  >

                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#334155' }}>Edit Task</Text>

                  </TouchableOpacity>

                  <TouchableOpacity

                    onPress={() => {

                      setActiveActionTaskId(null);

                      handleDeleteInternalTask(activeTaskAction.id);

                    }}

                    style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}

                  >

                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#dc2626' }}>Delete Task</Text>

                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      const taskId = activeTaskAction.id;
                      setActiveActionTaskId(null);
                      if (activeTaskActionAssignedIds.length === 0) {
                        Alert.alert('No Volunteers Assigned', 'This task currently has no assigned volunteers.');
                        return;
                      }
                      setRemoveVolunteerPickerTaskId(taskId);
                    }}
                    style={{ padding: 14 }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#dc2626' }}>Remove Assigned Volunteers</Text>
                  </TouchableOpacity>
                </Pressable>
              ) : null}
            </Pressable>
          </Modal>

          {/* Modal to pick which assigned volunteer to remove */}
          {(() => {
            const removePickerTask = taskCards.find(t => t.id === removeVolunteerPickerTaskId) || null;
            const removePickerAssignedIds = removePickerTask ? getTaskAssignedVolunteerIds(removePickerTask) : [];

            return (
              <Modal
                transparent
                visible={Boolean(removeVolunteerPickerTaskId && removePickerTask)}
                animationType="fade"
                onRequestClose={() => setRemoveVolunteerPickerTaskId(null)}
              >
                <Pressable
                  style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
                  onPress={() => setRemoveVolunteerPickerTaskId(null)}
                >
                  <Pressable
                    style={{ width: '100%', maxWidth: 480, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10 }}
                    onPress={e => e.stopPropagation()}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}>
                          <MaterialIcons name="person-remove" size={20} color="#dc2626" />
                        </View>
                        <View>
                          <Text style={{ fontSize: 17, fontWeight: '800', color: '#0f172a' }}>Remove Assigned Volunteer</Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>Task: {removePickerTask?.title}</Text>
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => setRemoveVolunteerPickerTaskId(null)} style={{ padding: 4 }}>
                        <MaterialIcons name="close" size={20} color="#64748b" />
                      </TouchableOpacity>
                    </View>

                    <Text style={{ fontSize: 13, color: '#475569', marginBottom: 14 }}>
                      Select which assigned volunteer you want to remove from this task:
                    </Text>

                    {removePickerAssignedIds.length === 0 ? (
                      <View style={{ padding: 20, alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 10, marginBottom: 14 }}>
                        <Text style={{ fontSize: 13, color: '#64748b' }}>No volunteers currently assigned to this task.</Text>
                      </View>
                    ) : (
                      <ScrollView style={{ maxHeight: 260, marginBottom: 14 }}>
                        {removePickerAssignedIds.map(vid => {
                          const volEntry = assignableVolunteers.find(v => v.id === vid) || { id: vid, name: 'Volunteer' };
                          const fullVol = volunteers.find(v => v.id === vid || v.userId === vid);
                          const isThisRemoving = isRemovingVolunteerId === vid;

                          return (
                            <View
                              key={vid}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: 12,
                                backgroundColor: '#f8fafc',
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: '#e2e8f0',
                                marginBottom: 8,
                              }}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
                                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>
                                    {volEntry.name.charAt(0).toUpperCase()}
                                  </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{volEntry.name}</Text>
                                  {fullVol?.email ? <Text style={{ fontSize: 12, color: '#64748b' }}>{fullVol.email}</Text> : null}
                                </View>
                              </View>

                              <TouchableOpacity
                                onPress={() => removePickerTask && handleRemoveSpecificVolunteerFromTask(removePickerTask, vid, volEntry.name)}
                                disabled={Boolean(isRemovingVolunteerId)}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 6,
                                  backgroundColor: '#fef2f2',
                                  paddingHorizontal: 12,
                                  paddingVertical: 8,
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor: '#fecaca',
                                  opacity: isThisRemoving ? 0.7 : 1,
                                }}
                              >
                                {isThisRemoving ? (
                                  <ActivityIndicator size="small" color="#dc2626" />
                                ) : (
                                  <MaterialIcons name="person-remove" size={16} color="#dc2626" />
                                )}
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#dc2626' }}>
                                  {isThisRemoving ? 'Removing...' : 'Remove'}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </ScrollView>
                    )}

                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      {removePickerAssignedIds.length > 1 ? (
                        <TouchableOpacity
                          onPress={() => removePickerTask && handleRemoveAllVolunteersFromTask(removePickerTask)}
                          disabled={Boolean(isRemovingVolunteerId)}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                            borderRadius: 8,
                            backgroundColor: '#fee2e2',
                            borderWidth: 1,
                            borderColor: '#fca5a5',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <MaterialIcons name="group-remove" size={16} color="#dc2626" />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#dc2626' }}>
                            Remove All ({removePickerAssignedIds.length})
                          </Text>
                        </TouchableOpacity>
                      ) : <View />}

                      <TouchableOpacity
                        onPress={() => setRemoveVolunteerPickerTaskId(null)}
                        style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  </Pressable>
                </Pressable>
              </Modal>
            );
          })()}



          <Modal transparent visible={Boolean(eventWorkspaceTab === 'Attendance' && activeAttendanceVolunteer)} animationType="fade" onRequestClose={() => setActiveActionTaskId(null)}>

            <Pressable style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.18)', justifyContent: 'center', alignItems: 'center', padding: 20 }} onPress={() => setActiveActionTaskId(null)}>

              {activeAttendanceVolunteer ? (

                <Pressable style={{ width: '100%', maxWidth: 260, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 18, elevation: 8 }} onPress={(event) => event.stopPropagation()}>

                  <TouchableOpacity

                    onPress={() => {

                      setActiveActionTaskId(null);

                      if (activeAttendanceLog?.attendancePhoto) {

                        setPreviewImageUri(activeAttendanceLog.attendancePhoto);
                        setPreviewAttendanceLog(activeAttendanceLog);

                        setPreviewImageModalVisible(true);

                      } else {

                        Alert.alert('No Photo', 'Volunteer has not submitted an attendance photo.');

                      }

                    }}

                    style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', alignItems: 'center', gap: 8 }}

                  >

                    <MaterialIcons name="photo-camera" size={16} color={activeAttendanceLog?.attendancePhoto ? '#166534' : '#94a3b8'} />

                    <Text style={{ fontSize: 14, fontWeight: '700', color: activeAttendanceLog?.attendancePhoto ? '#334155' : '#94a3b8' }}>View Photo</Text>

                  </TouchableOpacity>

                  <TouchableOpacity

                    onPress={() => setActiveActionTaskId(null)}

                    style={{ padding: 14 }}

                  >

                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#64748b' }}>Close Menu</Text>

                  </TouchableOpacity>

                </Pressable>

              ) : null}

            </Pressable>

          </Modal>



          <Modal
            visible={previewImageModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => {
              setPreviewImageModalVisible(false);
              setPreviewAttendanceLog(null);
            }}
          >

            <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>

              <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, width: '100%', maxWidth: 500 }}>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>

                  <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>Submitted Photo</Text>

                  <TouchableOpacity
                    onPress={() => {
                      setPreviewImageModalVisible(false);
                      setPreviewAttendanceLog(null);
                    }}
                  >

                    <MaterialIcons name="close" size={24} color="#64748b" />

                  </TouchableOpacity>

                </View>

                {previewImageUri ? (

                  <Image source={{ uri: previewImageUri }} style={{ width: '100%', height: 400, borderRadius: 8, backgroundColor: '#f1f5f9' }} resizeMode="contain" />

                ) : (

                  <View style={{ height: 400, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8 }}>

                    <Text style={{ color: '#94a3b8' }}>No image to display</Text>

                  </View>

                )}

                {previewAttendanceLog ? (

                  <View style={{ marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: previewAttendanceLog.attendanceCheckedAt ? '#f0fdf4' : '#f8fafc', borderWidth: 1, borderColor: previewAttendanceLog.attendanceCheckedAt ? '#86efac' : '#e2e8f0' }}>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>

                      <MaterialIcons name={previewAttendanceLog.attendanceCheckedAt ? 'verified' : 'fact-check'} size={18} color={previewAttendanceLog.attendanceCheckedAt ? '#166534' : '#64748b'} />

                      <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: previewAttendanceLog.attendanceCheckedAt ? '#166534' : '#334155' }}>
                        {previewAttendanceLog.attendanceCheckedAt ? 'Admin attendance confirmed after photo review' : 'Admin confirmation pending after photo review'}
                      </Text>

                    </View>

                    {previewAttendanceLog.attendanceCheckedAt ? (

                      <Text style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>
                        Verified {format(new Date(previewAttendanceLog.attendanceCheckedAt), 'PPp')}
                      </Text>

                    ) : null}

                    <TouchableOpacity
                      onPress={() => void handleToggleAttendanceCheck(previewAttendanceLog, !Boolean(previewAttendanceLog.attendanceCheckedAt))}
                      disabled={attendanceCheckInFlightLogId === previewAttendanceLog.id}
                      style={{ minHeight: 42, borderRadius: 8, backgroundColor: previewAttendanceLog.attendanceCheckedAt ? '#f8fafc' : '#166534', borderWidth: 1, borderColor: previewAttendanceLog.attendanceCheckedAt ? '#cbd5e1' : '#166534', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: attendanceCheckInFlightLogId === previewAttendanceLog.id ? 0.75 : 1 }}
                    >

                      {attendanceCheckInFlightLogId === previewAttendanceLog.id ? (
                        <ActivityIndicator size="small" color={previewAttendanceLog.attendanceCheckedAt ? '#475569' : '#ffffff'} />
                      ) : (
                        <MaterialIcons name={previewAttendanceLog.attendanceCheckedAt ? 'remove-done' : 'verified'} size={16} color={previewAttendanceLog.attendanceCheckedAt ? '#475569' : '#ffffff'} />
                      )}

                      <Text style={{ fontSize: 13, fontWeight: '800', color: previewAttendanceLog.attendanceCheckedAt ? '#475569' : '#ffffff' }}>
                        {attendanceCheckInFlightLogId === previewAttendanceLog.id
                          ? 'Saving Confirmation...'
                          : previewAttendanceLog.attendanceCheckedAt
                          ? 'Remove Admin Confirmation'
                          : 'Confirm Attendance After Checking Photo'}
                      </Text>

                    </TouchableOpacity>

                  </View>

                ) : null}

              </View>

            </View>

          </Modal>

        </ScrollView>

        <ConfirmDialog
          visible={dialogState.visible}
          loading={dialogState.loading}
          title={dialogState.title}
          message={dialogState.message}
          confirmText={dialogState.confirmText}
          loadingText={dialogState.loadingText}
          cancelText={dialogState.cancelText}
          confirmColor={dialogState.confirmColor}
          icon={dialogState.icon as any}
          iconColor={dialogState.iconColor}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </View>
    );

    };



    if (showAttendanceTasks && activeSelectedProject.isEvent) {

      return renderAttendanceTasksView(activeSelectedProject);

    }



    return (

      <View style={styles.screenShell}>

        {renderTaskSaveToast()}

        <ScrollView style={styles.container} contentContainerStyle={styles.detailsScreenContent}>



          {/* Breadcrumb Row */}

          <View style={premiumDetailsStyles.breadcrumbBar}>

            <TouchableOpacity onPress={handleReturnToProjectList}>

              <Text style={premiumDetailsStyles.breadcrumbText}>Projects</Text>

            </TouchableOpacity>

            <MaterialIcons name="chevron-right" size={14} color="#64748b" style={{ marginHorizontal: 4 }} />

            <Text style={premiumDetailsStyles.breadcrumbMuted}>

              {getProjectProgramTitle(activeSelectedProject)}

            </Text>

            <MaterialIcons name="chevron-right" size={14} color="#64748b" style={{ marginHorizontal: 4 }} />

            <Text style={premiumDetailsStyles.breadcrumbActive}>{activeSelectedProject.title}</Text>

          </View>



          {/* Hero Banner */}

          <View style={premiumDetailsStyles.heroBanner}>

            <ImageBackground

              source={activeProjectImageSource || { uri: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=1200&auto=format&fit=crop' }}

              style={premiumDetailsStyles.heroBackground}

              imageStyle={{ borderRadius: 16 }}

              resizeMode="cover"

            >

              <View style={[premiumDetailsStyles.heroOverlay, { borderRadius: 16 }]} />



              <View style={premiumDetailsStyles.heroTop}>

                <View style={[premiumDetailsStyles.heroStatusPill, { backgroundColor: getProjectStatusColor(activeSelectedProject) }]}>

                  <Text style={premiumDetailsStyles.heroStatusText}>

                    {getProjectDisplayStatus(activeSelectedProject).toUpperCase()}

                  </Text>

                </View>

                <Text style={premiumDetailsStyles.heroTitle}>{activeSelectedProject.title}</Text>



                <View style={premiumDetailsStyles.heroMetaRow}>

                  <View style={premiumDetailsStyles.heroMetaItem}>

                    <MaterialIcons name="folder" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.heroMetaText}>

                      {getProjectProgramTitle(activeSelectedProject)}

                    </Text>

                  </View>

                  <View style={premiumDetailsStyles.heroMetaItem}>

                    <MaterialIcons name="location-on" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.heroMetaText}>

                      {formattedProjectLocation}

                    </Text>

                  </View>

                  <View style={premiumDetailsStyles.heroMetaItem}>

                    <MaterialIcons name="calendar-today" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.heroMetaText}>{formattedScheduleRange}</Text>

                  </View>

                </View>

              </View>



              <View style={premiumDetailsStyles.heroActionsRow}>

                {/* Non-event: Create Event button */}

                {!activeSelectedProject.isEvent && isAdmin && !isProjectReadOnly && (

                  <TouchableOpacity

                    style={premiumDetailsStyles.heroBtnGreen}

                    onPress={() => openCreateEventModal(activeSelectedProject)}

                  >

                    <MaterialIcons name="event" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.heroBtnGreenText}>Create Event</Text>

                  </TouchableOpacity>

                )}



                {/* Edit button */}

                {isAdmin && !isProjectReadOnly && (

                  <TouchableOpacity

                    style={premiumDetailsStyles.heroBtnOutline}

                    onPress={() => openEditProjectModal(activeSelectedProject)}

                  >

                    <MaterialIcons name="edit" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.heroBtnOutlineText}>

                      {activeSelectedProject.isEvent ? 'Edit Event' : 'Edit Project'}

                    </Text>

                  </TouchableOpacity>

                )}

                {isAdmin && (

                  <TouchableOpacity

                    style={premiumDetailsStyles.heroBtnDanger}

                    onPress={handleDeleteProjectRecord}

                  >

                    <MaterialIcons name="delete-outline" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.heroBtnOutlineText}>

                      {activeSelectedProject.isEvent ? 'Delete Event' : 'Delete Project'}

                    </Text>

                  </TouchableOpacity>

                )}



                {/* More dropdown */}

                <View style={premiumDetailsStyles.heroMoreMenuWrap} {...({} as any)}>

                  <TouchableOpacity

                    style={premiumDetailsStyles.heroBtnOutline}

                    onPress={() => setShowMoreDropdown(prev => !prev)}

                  >

                    <MaterialIcons name="more-horiz" size={18} color="#ffffff" />

                    <Text style={premiumDetailsStyles.heroBtnOutlineText}>More</Text>

                  </TouchableOpacity>



                  {showMoreDropdown && (

                    <Pressable

                      style={premiumDetailsStyles.heroMoreDropdown}

                      {...({} as any)}

                    >

                      {/* Event-only options */}

                      {activeSelectedProject.isEvent && isAdmin && (

                        <>

                          <TouchableOpacity

                            onPress={() => {

                              setShowMoreDropdown(false);

                              handleOpenVolunteerApplications(activeSelectedProject.id);

                            }}

                            style={premiumDetailsStyles.heroMoreDropdownItem}

                          >

                            <MaterialIcons name="people" size={18} color="#166534" style={{ marginRight: 12 }} />

                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f172a' }}>Volunteer Applications</Text>

                          </TouchableOpacity>



                          <TouchableOpacity

                            onPress={() => {

                              setShowMoreDropdown(false);

                              setShowAttendanceTasks(true);

                            }}

                            style={premiumDetailsStyles.heroMoreDropdownItem}

                          >

                            <MaterialIcons name="assignment-turned-in" size={18} color="#166534" style={{ marginRight: 12 }} />

                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f172a' }}>Attendance & Tasks</Text>

                          </TouchableOpacity>

                        </>

                      )}



                    </Pressable>

                  )}

                </View>

              </View>



            </ImageBackground>

          </View>



          {/* Main Grid */}

          <View style={[premiumDetailsStyles.mainGrid, { flexDirection: isDesktop ? 'row' : 'column' }]}>



            {/* Left Column */}

            <View style={{ flex: isDesktop ? 2.2 : 1 }}>



              {/* About Card */}

              <View style={premiumDetailsStyles.card}>

                <Text style={[premiumDetailsStyles.cardTitle, { marginBottom: 16 }]}>About This Project</Text>

                <View style={premiumDetailsStyles.aboutContainer}>

                  <Text style={premiumDetailsStyles.aboutText}>{detailsDescription}</Text>



                  {/* Stats Box */}

                  {activeSelectedProject.isEvent ? (

                    <View style={premiumDetailsStyles.statsBox}>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="people" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue}>

                          {volunteerEntries.length}

                        </Text>

                        <Text style={premiumDetailsStyles.statLabel}>Volunteer Applications</Text>

                      </View>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="description" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue}>{projectReports.length}</Text>

                        <Text style={premiumDetailsStyles.statLabel}>Submitted Reports</Text>

                      </View>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="assignment-turned-in" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue}>

                          {internalTasks.filter(t => t.status === 'Assigned' || t.status === 'Completed' || t.assignedVolunteerId).length}

                        </Text>

                        <Text style={premiumDetailsStyles.statLabel}>Assigned Tasks</Text>

                      </View>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="assignment" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue}>

                          {internalTasks.filter(t => t.status !== 'Assigned' && t.status !== 'Completed' && !t.assignedVolunteerId).length}

                        </Text>

                        <Text style={premiumDetailsStyles.statLabel}>Unassigned Tasks</Text>

                      </View>

                    </View>

                  ) : (

                    <View style={premiumDetailsStyles.statsBox}>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="account-circle" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue} numberOfLines={1} ellipsizeMode="tail">{projectAuthorName}</Text>

                        <Text style={premiumDetailsStyles.statLabel}>Author</Text>

                      </View>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="person" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue}>{volunteersCount}</Text>

                        <Text style={premiumDetailsStyles.statLabel}>Volunteers</Text>

                      </View>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="event" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue}>{linkedEvents.length}</Text>

                        <Text style={premiumDetailsStyles.statLabel}>Events</Text>

                      </View>

                      <View style={premiumDetailsStyles.statCell}>

                        <View style={premiumDetailsStyles.statIconRow}>

                          <MaterialIcons name="description" size={16} color="#166534" />

                        </View>

                        <Text style={premiumDetailsStyles.statValue}>{reportsCount}</Text>

                        <Text style={premiumDetailsStyles.statLabel}>Reports</Text>

                      </View>

                    </View>

                  )}



                  {activeSelectedProject.isEvent && activeSelectedProject.volunteerRequirements && activeSelectedProject.volunteerRequirements.length > 0 && (

                    <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 16 }}>

                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#1e293b', marginBottom: 10 }}>Volunteer Requirements</Text>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>

                        {activeSelectedProject.volunteerRequirements.map(req => (

                          <View

                            key={req}

                            {...({} as any)}

                            style={{

                              flexDirection: 'row',

                              alignItems: 'center',

                              backgroundColor: '#f0fdf4',

                              borderRadius: 8,

                              paddingVertical: 6,

                              paddingHorizontal: 12,

                              borderWidth: 1,

                              borderColor: '#bbf7d0',

                              gap: 6

                            }}

                          >

                            <MaterialIcons name="check-circle" size={14} color="#166534" />

                            <Text style={{ fontSize: 12, color: '#166534', fontWeight: '600' }}>{req}</Text>

                          </View>

                        ))}

                      </View>

                    </View>

                  )}



                </View>

              </View>



              {/* Upcoming Events Card */}

              {!activeSelectedProject.isEvent && (

                <View style={premiumDetailsStyles.card}>

                  <View style={premiumDetailsStyles.cardHeader}>

                    <Text style={premiumDetailsStyles.cardTitle}>Upcoming Events</Text>

                    <TouchableOpacity onPress={() => Alert.alert('Events', 'Show all events list.')}>

                      <Text style={premiumDetailsStyles.cardLink}>View all events</Text>

                    </TouchableOpacity>

                  </View>



                  {linkedEvents.length === 0 ? (

                    <Text style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>No upcoming events scheduled.</Text>

                  ) : (

                    linkedEvents.map(event => {

                      const dateParts = getEventDateParts(event.startDate);

                      const eventVolunteers = getProjectVolunteerEntries(event);

                      return (

                        <View key={event.id} style={premiumDetailsStyles.eventItem}>

                          <View style={premiumDetailsStyles.dateBadge}>

                            <Text style={premiumDetailsStyles.dateBadgeMonth}>{dateParts.month}</Text>

                            <Text style={premiumDetailsStyles.dateBadgeDay}>{dateParts.day}</Text>

                          </View>



                          <View style={premiumDetailsStyles.eventInfo}>

                            <Text style={premiumDetailsStyles.eventTitle}>{event.title}</Text>

                            <Text style={premiumDetailsStyles.eventMeta}>

                              {format(new Date(event.startDate), 'MMMM d, yyyy')} ΓÇó {formatProjectDateLabel(event.startDate)}

                            </Text>

                            <Text style={premiumDetailsStyles.eventMeta}>

                              {event.location.address || 'Alangilan Covered Court'}

                            </Text>

                          </View>



                          <Text style={premiumDetailsStyles.eventRatio}>

                            {eventVolunteers.length}/{event.volunteersNeeded} Volunteers

                          </Text>



                          <TouchableOpacity

                            style={premiumDetailsStyles.eventViewBtn}

                            onPress={() => handleSelectProject(event)}

                          >

                            <Text style={premiumDetailsStyles.eventViewBtnText}>View</Text>

                          </TouchableOpacity>

                        </View>

                      );

                    })

                  )}

                </View>

              )}



              {/* Recent Reports Card */}

              <View style={premiumDetailsStyles.card}>

                <View style={premiumDetailsStyles.cardHeader}>

                  <Text style={premiumDetailsStyles.cardTitle}>Recent Reports</Text>

                  <TouchableOpacity onPress={() => Alert.alert('Reports', 'Show all reports list.')}>

                    <Text style={premiumDetailsStyles.cardLink}>View all reports</Text>

                  </TouchableOpacity>

                </View>



                {projectReports.length === 0 ? (

                  <Text style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>No reports submitted yet.</Text>

                ) : (

                  projectReports.map(report => (

                    <View key={report.id} style={premiumDetailsStyles.reportItem}>

                      <View style={premiumDetailsStyles.reportIconBg}>

                        <MaterialIcons name="insert-drive-file" size={16} color="#166534" />

                      </View>



                      <View style={premiumDetailsStyles.reportInfo}>

                        <Text style={premiumDetailsStyles.reportTitle}>{report.title}</Text>

                        <Text style={premiumDetailsStyles.reportMeta}>

                          {format(new Date(report.createdAt), 'MMM d, yyyy')} ΓÇó Submitted by {report.partnerName || 'John D.'}

                        </Text>

                      </View>



                      <View style={[

                        premiumDetailsStyles.statusBadge,

                        { backgroundColor: report.status === 'Reviewed' ? '#f0fdf4' : '#eff6ff' }

                      ]}>

                        <Text style={[

                          premiumDetailsStyles.statusBadgeText,

                          { color: report.status === 'Reviewed' ? '#166534' : '#1e40af' }

                        ]}>

                          {report.status === 'Reviewed' ? 'Approved' : 'For Review'}

                        </Text>

                      </View>

                    </View>

                  ))

                )}

              </View>



            </View>



            {/* Right Column */}

            <View style={{ flex: isDesktop ? 1 : 1 }}>



              {/* Project/Event Summary Card */}

              <View style={premiumDetailsStyles.card}>

                <Text style={[premiumDetailsStyles.cardTitle, { marginBottom: 16 }]}>

                  {activeSelectedProject.isEvent ? 'Event Summary' : 'Project Summary'}

                </Text>



                <View style={premiumDetailsStyles.summaryRow}>

                  <MaterialIcons name="check-circle" size={16} color="#166534" />

                  <Text style={premiumDetailsStyles.summaryLabel}>Status</Text>

                  <Text style={premiumDetailsStyles.summaryValue}>

                    {getProjectDisplayStatus(activeSelectedProject)}

                  </Text>

                </View>



                <View style={premiumDetailsStyles.summaryRow}>

                  <MaterialIcons name="folder" size={16} color="#3b82f6" />

                  <Text style={premiumDetailsStyles.summaryLabel}>Program</Text>

                  <Text style={premiumDetailsStyles.summaryValue} numberOfLines={1}>

                    {getProjectProgramTitle(activeSelectedProject)}

                  </Text>

                </View>



                <View style={premiumDetailsStyles.summaryRow}>

                  <MaterialIcons name="calendar-month" size={16} color="#64748b" />

                  <Text style={premiumDetailsStyles.summaryLabel}>{formattedScheduleRange}</Text>

                  <Text style={premiumDetailsStyles.summaryValue}>

                    ({Math.max(1, Math.round((new Date(activeSelectedProject.endDate).getTime() - new Date(activeSelectedProject.startDate).getTime()) / (1000 * 60 * 60 * 24)))} days)

                  </Text>

                </View>



                {activeSelectedProject.isEvent && (

                  <View style={premiumDetailsStyles.summaryRow}>

                    <MaterialIcons name="group" size={16} color="#64748b" />

                    <Text style={premiumDetailsStyles.summaryLabel}>Volunteer Slots</Text>

                    <Text style={premiumDetailsStyles.summaryValue}>

                      {volunteersCount} / {activeSelectedProject.volunteersNeeded || 0}

                    </Text>

                  </View>

                )}





                <View style={premiumDetailsStyles.summaryRow}>

                  <MaterialIcons name="location-on" size={16} color="#64748b" />

                  <Text style={premiumDetailsStyles.summaryLabel}>Location</Text>

                  <Text style={premiumDetailsStyles.summaryValue} numberOfLines={2}>

                    {formattedProjectLocation}

                  </Text>

                </View>



                <TouchableOpacity

                  style={premiumDetailsStyles.summaryRow}

                  onPress={() => {

                    if (projectDocumentAttachment?.url) {

                      // Open/download the document

                      openAttachmentUri(projectDocumentAttachment.url);

                    } else if (!isProjectReadOnly) {

                      // Open edit modal to upload document

                      openEditProjectModal(activeSelectedProject);

                    }

                  }}

                >

                  <MaterialIcons

                    name={projectDocumentAttachment?.url ? 'attach-file' : 'upload-file'}

                    size={16}

                    color="#2563eb"

                  />

                  <Text style={premiumDetailsStyles.summaryLabel}>Document Attachment</Text>

                  <Text style={premiumDetailsStyles.summaryValue} numberOfLines={1}>

                    {projectDocumentAttachment?.url

                      ? projectDocumentAttachment.url.split('/').pop() || 'Attached document'

                      : isProjectReadOnly ? 'No document attached' : 'Upload document'}

                  </Text>

                </TouchableOpacity>



                <TouchableOpacity

                  style={premiumDetailsStyles.summaryLink}

                  onPress={() => Alert.alert('Details', 'Show full project metadata.')}

                >

                  <Text style={premiumDetailsStyles.summaryLinkText}>View full details</Text>

                  <MaterialIcons name="arrow-forward" size={14} color="#166534" />

                </TouchableOpacity>

              </View>



              {/* Quick Actions Card */}

              <View style={premiumDetailsStyles.card}>

                <Text style={[premiumDetailsStyles.cardTitle, { marginBottom: 16 }]}>Quick Actions</Text>



                {!activeSelectedProject.isEvent && !isProjectReadOnly && (

                  <TouchableOpacity

                    style={premiumDetailsStyles.actionBtnGreen}

                    onPress={() => openCreateEventModal(activeSelectedProject)}

                  >

                    <MaterialIcons name="event" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.actionBtnGreenText}>Create Event</Text>

                  </TouchableOpacity>

                )}



                {activeSelectedProject.isEvent && (

                  <TouchableOpacity

                    style={premiumDetailsStyles.actionBtnGreen}

                    onPress={() => setShowAttendanceTasks(true)}

                  >

                    <MaterialIcons name="assignment-turned-in" size={16} color="#ffffff" />

                    <Text style={premiumDetailsStyles.actionBtnGreenText}>Attendance & Tasks</Text>

                  </TouchableOpacity>

                )}



                <TouchableOpacity

                  style={premiumDetailsStyles.actionBtnOutline}

                  onPress={() => {
                    if (navigation) {
                      navigation.navigate('Volunteers' as any, { projectId: activeSelectedProject.id });
                    } else {
                      Alert.alert('Invite Volunteers', 'Navigate to the Volunteers section to manage and invite volunteers for this project.');
                    }
                  }}

                >

                  <MaterialIcons name="person-add" size={16} color="#475569" />

                  <Text style={premiumDetailsStyles.actionBtnOutlineText}>Invite Volunteers</Text>

                </TouchableOpacity>



                <TouchableOpacity

                  style={premiumDetailsStyles.actionBtnOutline}

                  onPress={() => {
                    if (navigation) {
                      navigation.navigate('Reports' as any, { projectId: activeSelectedProject.id });
                    } else {
                      Alert.alert('View Reports', 'Navigate to the Reports section to view and review submitted reports for this project.');
                    }
                  }}

                >

                  <MaterialIcons name="description" size={16} color="#475569" />

                  <Text style={premiumDetailsStyles.actionBtnOutlineText}>View Reports</Text>

                </TouchableOpacity>

              </View>



              {/* Share Project Card */}

              <View style={premiumDetailsStyles.card}>

                <Text style={[premiumDetailsStyles.cardTitle, { marginBottom: 12 }]}>Share Project</Text>

                <Text style={premiumDetailsStyles.shareDesc}>

                  Invite partners and volunteers to collaborate on this project.

                </Text>



                <TouchableOpacity

                  style={premiumDetailsStyles.actionBtnOutline}

                  onPress={() => Alert.alert('Share Link', 'Project link copied to clipboard.')}

                >

                  <MaterialIcons name="link" size={16} color="#475569" />

                  <Text style={premiumDetailsStyles.actionBtnOutlineText}>Share Project Link</Text>

                </TouchableOpacity>

              </View>



            </View>



          </View>



          {renderProgramProposalModal()}

        </ScrollView>

        {renderProjectEditorModal()}

        {renderDatePickerModal()}

        {renderVolunteerApplicationsModal()}

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

        {/* Top-level hero header removed as requested */}



        {/* Removed old projects status pills */}







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

                      {' '}ΓÇö switch to Projects or Events to see filtered results.

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



                {/* Summary Metrics Bar */}

                <View style={styles.programSummaryRow}>

                  <View style={styles.programSummaryCard}>

                    <View style={styles.programSummaryIconBg}>

                      <MaterialIcons name="folder" size={20} color="#166534" />

                    </View>

                    <View style={{ marginLeft: 12 }}>

                      <Text style={styles.programSummaryValue}>{programSections.length}</Text>

                      <Text style={styles.programSummaryLabel}>Total Programs</Text>

                    </View>

                  </View>



                  <View style={styles.programSummaryCard}>

                    <View style={styles.programSummaryIconBg}>

                      <MaterialIcons name="assignment" size={20} color="#166534" />

                    </View>

                    <View style={{ marginLeft: 12 }}>

                      <Text style={styles.programSummaryValue}>{projects.filter(p => !p.isEvent).length}</Text>

                      <Text style={styles.programSummaryLabel}>Active Projects</Text>

                    </View>

                  </View>



                  <View style={styles.programSummaryCard}>

                    <View style={styles.programSummaryIconBg}>

                      <MaterialIcons name="people" size={20} color="#166534" />

                    </View>

                    <View style={{ marginLeft: 12 }}>

                      <Text style={styles.programSummaryValue}>{volunteers.length}</Text>

                      <Text style={styles.programSummaryLabel}>Confirmed Volunteers</Text>

                    </View>

                  </View>



                  <View style={[styles.programSummaryCard, { borderRightWidth: 0, paddingRight: 0 }]}>

                    <View style={styles.programSummaryIconBg}>

                      <MaterialIcons name="event" size={20} color="#166534" />

                    </View>

                    <View style={{ marginLeft: 12 }}>

                      <Text style={styles.programSummaryValue}>{projects.filter(p => p.isEvent).length}</Text>

                      <Text style={styles.programSummaryLabel}>Scheduled Events</Text>

                    </View>

                  </View>

                </View>



                {/* Active Programs Subheader */}

                <View style={styles.programSectionHeaderRow}>

                  <View style={{ position: 'relative' }}>

                    <Text style={styles.programSectionTitle}>Active Programs</Text>

                    <View style={styles.programSectionTitleActiveLine} />

                  </View>



                  <View style={styles.programSectionControls}>

                    <View style={styles.layoutToggleGroup}>

                      <TouchableOpacity style={[styles.layoutToggleButton, styles.layoutToggleButtonActive]}>

                        <MaterialIcons name="grid-on" size={16} color="#166534" />

                      </TouchableOpacity>

                      <TouchableOpacity style={styles.layoutToggleButton}>

                        <MaterialIcons name="format-list-bulleted" size={16} color="#64748b" />

                      </TouchableOpacity>

                    </View>



                    <TouchableOpacity style={styles.sortDropdownButton}>

                      <Text style={styles.sortDropdownText}>Sort by: Recently Updated</Text>

                      <MaterialIcons name="arrow-drop-down" size={16} color="#475569" />

                    </TouchableOpacity>

                  </View>

                </View>



                {/* Programs Grid */}

                <View style={styles.programGrid}>

                  {programSections.map(section => {

                    const track = activeProgramTracks.find(t => t.id === section.module);

                    const overview = getProgramWebOverview(section.title);

                    return (

                      <View key={section.module} style={styles.programCard}>

                        <TouchableOpacity

                          style={{ flex: 1 }}

                          onPress={() => openProgramProposalModal(section.module)}

                          activeOpacity={0.9}

                        >

                          <View style={styles.programCardImageContainer}>

                            <View style={styles.programCardImagePlaceholder}>

                              <MaterialIcons name={section.icon} size={32} color={section.accent} />

                            </View>

                            <View style={styles.programCardBadge}>

                              <Text style={styles.programCardBadgeText}>{section.totalPrograms} Projects</Text>

                            </View>

                          </View>



                          <View style={styles.programCardBody}>

                            <View style={styles.programCardHeaderRow}>

                              <View style={[styles.programCardAvatar, { backgroundColor: section.surface }]}>

                                <MaterialIcons name={section.icon} size={18} color={section.accent} />

                              </View>

                              <View style={{ flex: 1 }}>

                                <Text style={styles.programCardTitle} numberOfLines={1}>{section.title}</Text>

                                <Text style={styles.programCardSubtitle} numberOfLines={1}>{section.module}</Text>

                              </View>

                            </View>



                            <Text style={styles.programCardDesc} numberOfLines={3}>

                              {track?.description || overview.about || ''}

                            </Text>



                            <View style={styles.programCardMetrics}>

                              <View style={styles.programCardMetricCell}>

                                <Text style={styles.programCardMetricValue}>{section.totalPrograms}</Text>

                                <Text style={styles.programCardMetricLabel}>Projects</Text>

                              </View>

                              <View style={[styles.programCardMetricCell, { borderLeftWidth: 1, borderLeftColor: '#f1f5f9', borderRightWidth: 1, borderRightColor: '#f1f5f9' }]}>

                                <Text style={styles.programCardMetricValue}>{section.eventCount}</Text>

                                <Text style={styles.programCardMetricLabel}>Events</Text>

                              </View>

                              <View style={styles.programCardMetricCell}>

                                <Text style={styles.programCardMetricValue}>{section.inProgressCount}</Text>

                                <Text style={styles.programCardMetricLabel}>Active</Text>

                              </View>

                            </View>



                            {isAdmin && track && (

                              <View style={styles.programCardActions}>

                                <TouchableOpacity

                                  style={[styles.programCardActionButton, { borderColor: '#cbd5e1', backgroundColor: '#ffffff' }]}

                                  onPress={(event) => {

                                    event.stopPropagation?.();

                                    openEditProgramModal(track);

                                  }}

                                >

                                  <Text style={[styles.programCardActionButtonText, { color: '#475569' }]}>Edit Track</Text>

                                </TouchableOpacity>

                                <TouchableOpacity

                                  style={[styles.programCardActionButton, { borderColor: '#fecaca', backgroundColor: '#fef2f2' }]}

                                  onPress={(event) => {

                                    event.stopPropagation?.();

                                    handleDeleteProgram(track.id, track.title);

                                  }}

                                >

                                  <Text style={[styles.programCardActionButtonText, { color: '#b91c1c' }]}>Delete</Text>

                                </TouchableOpacity>

                              </View>

                            )}



                            <View style={styles.programCardFooter}>

                              <Text style={styles.programCardFooterText}>Open Workspace</Text>

                              <MaterialIcons name="arrow-forward" size={14} color="#166534" />

                            </View>

                          </View>

                        </TouchableOpacity>

                      </View>

                    );

                  })}



                  {/* Dashed Add Program Shortcut Card */}

                  {isAdmin && (

                    <TouchableOpacity

                      style={styles.programGridAddCard}

                      onPress={openCreateProgramModal}

                      activeOpacity={0.8}

                    >

                      <View style={styles.programGridAddIconBg}>

                        <MaterialIcons name="add" size={24} color="#64748b" />

                      </View>

                      <Text style={styles.programGridAddLabel}>Add Program</Text>

                    </TouchableOpacity>

                  )}

                </View>

              </>

            ) : programSuiteView === 'projects' ? (

              <View style={styles.projectsLayoutContainer}>

                {/* Header block */}

                <View style={styles.projectsHeaderRow}>

                  <View>

                    <Text style={styles.projectsHeaderTitle}>Projects</Text>

                    <Text style={styles.projectsHeaderSubtitle}>Manage projects grouped by program.</Text>

                  </View>

                </View>



                {/* Filter controls row */}

                <View style={[

                  styles.projectsFilterRow,

                  activeProjectsFilterMenu && styles.projectsFilterRowMenuOpen

                ]}>

                  {/* Program filter dropdown */}

                  <View style={[
                    styles.projectsFilterMenuWrap,
                    activeProjectsFilterMenu === 'program' && styles.projectsFilterMenuWrapActive
                  ]}>

                    <TouchableOpacity

                      style={styles.projectsFilterDropdown}

                      onPress={() => setActiveProjectsFilterMenu(current => current === 'program' ? null : 'program')}

                      activeOpacity={0.85}

                    >

                      <Text style={styles.projectsFilterDropdownText}>

                        {projectProgramFilter

                          ? programSections.find(s => s.module === projectProgramFilter)?.title || 'Program'

                          : 'Program'}

                      </Text>

                      <MaterialIcons name={activeProjectsFilterMenu === 'program' ? 'arrow-drop-up' : 'arrow-drop-down'} size={16} color="#475569" />

                    </TouchableOpacity>

                    {activeProjectsFilterMenu === 'program' ? (

                      <View style={styles.projectsFilterMenu}>

                        {projectProgramFilter ? (

                          <TouchableOpacity

                            style={styles.projectsFilterMenuItem}

                            onPress={() => {

                              setProjectProgramFilter(null);

                              setActiveProjectsFilterMenu(null);

                            }}

                          >

                            <Text style={styles.projectsFilterMenuText}>Clear filter</Text>

                          </TouchableOpacity>

                        ) : null}

                        {programSections.map(section => (

                          <TouchableOpacity

                            key={section.module}

                            style={styles.projectsFilterMenuItem}

                            onPress={() => {

                              setProjectProgramFilter(section.module);

                              setActiveProjectsFilterMenu(null);

                            }}

                          >

                            <Text style={[

                              styles.projectsFilterMenuText,

                              projectProgramFilter === section.module && styles.projectsFilterMenuTextActive

                            ]}>

                              {section.title}

                            </Text>

                          </TouchableOpacity>

                        ))}

                      </View>

                    ) : null}

                  </View>



                  {/* Project Type filter dropdown */}

                  <View style={[
                    styles.projectsFilterMenuWrap,
                    activeProjectsFilterMenu === 'type' && styles.projectsFilterMenuWrapActive
                  ]}>

                    <TouchableOpacity

                      style={styles.projectsFilterDropdown}

                      onPress={() => setActiveProjectsFilterMenu(current => current === 'type' ? null : 'type')}

                      activeOpacity={0.85}

                    >

                      <Text style={styles.projectsFilterDropdownText}>

                        {projectTypeFilter ? (projectTypeFilter === 'Projects' ? 'Projects Only' : 'Events Only') : 'Project Type'}

                      </Text>

                      <MaterialIcons name={activeProjectsFilterMenu === 'type' ? 'arrow-drop-up' : 'arrow-drop-down'} size={16} color="#475569" />

                    </TouchableOpacity>

                    {activeProjectsFilterMenu === 'type' ? (

                      <View style={styles.projectsFilterMenu}>

                        {projectTypeFilter ? (

                          <TouchableOpacity

                            style={styles.projectsFilterMenuItem}

                            onPress={() => {

                              setProjectTypeFilter(null);

                              setActiveProjectsFilterMenu(null);

                            }}

                          >

                            <Text style={styles.projectsFilterMenuText}>Clear filter</Text>

                          </TouchableOpacity>

                        ) : null}

                        {(['Projects', 'Events'] as const).map(typeOption => (

                          <TouchableOpacity

                            key={typeOption}

                            style={styles.projectsFilterMenuItem}

                            onPress={() => {

                              setProjectTypeFilter(typeOption);

                              setActiveProjectsFilterMenu(null);

                            }}

                          >

                            <Text style={[

                              styles.projectsFilterMenuText,

                              projectTypeFilter === typeOption && styles.projectsFilterMenuTextActive

                            ]}>

                              {typeOption === 'Projects' ? 'Projects Only' : 'Events Only'}

                            </Text>

                          </TouchableOpacity>

                        ))}

                      </View>

                    ) : null}

                  </View>



                  {/* Status filter dropdown */}

                  <View style={[
                    styles.projectsFilterMenuWrap,
                    activeProjectsFilterMenu === 'status' && styles.projectsFilterMenuWrapActive
                  ]}>

                    <TouchableOpacity

                      style={styles.projectsFilterDropdown}

                      onPress={() => setActiveProjectsFilterMenu(current => current === 'status' ? null : 'status')}

                      activeOpacity={0.85}

                    >

                      <Text style={styles.projectsFilterDropdownText}>

                        {statusFilter ? statusFilter : 'Status'}

                      </Text>

                      <MaterialIcons name={activeProjectsFilterMenu === 'status' ? 'arrow-drop-up' : 'arrow-drop-down'} size={16} color="#475569" />

                    </TouchableOpacity>

                    {activeProjectsFilterMenu === 'status' ? (

                      <View style={styles.projectsFilterMenu}>

                        {statusFilter ? (

                          <TouchableOpacity

                            style={styles.projectsFilterMenuItem}

                            onPress={() => {

                              setStatusFilter(null);

                              setActiveProjectsFilterMenu(null);

                            }}

                          >

                            <Text style={styles.projectsFilterMenuText}>Clear filter</Text>

                          </TouchableOpacity>

                        ) : null}

                        {statuses.map(statusOption => (

                          <TouchableOpacity

                            key={statusOption}

                            style={styles.projectsFilterMenuItem}

                            onPress={() => {

                              setStatusFilter(statusOption);

                              setActiveProjectsFilterMenu(null);

                            }}

                          >

                            <Text style={[

                              styles.projectsFilterMenuText,

                              statusFilter === statusOption && styles.projectsFilterMenuTextActive

                            ]}>

                              {statusOption}

                            </Text>

                          </TouchableOpacity>

                        ))}

                      </View>

                    ) : null}

                  </View>



                  {/* Search input box */}

                  <View style={styles.projectsSearchContainer}>

                    <MaterialIcons name="search" size={18} color="#64748b" style={{ marginRight: 8 }} />

                    <TextInput

                      style={styles.projectsSearchInput}

                      placeholder="Search projects..."

                      placeholderTextColor="#94a3b8"

                      value={projectSearchQuery}

                      onChangeText={setProjectSearchQuery}

                    />

                  </View>



                  {/* Sort by dropdown */}

                  <View style={[

                    styles.projectsFilterMenuWrap,

                    styles.projectsSortMenuWrap,

                    activeProjectsFilterMenu === 'sort' && styles.projectsFilterMenuWrapActive

                  ]}>

                    <TouchableOpacity

                      style={styles.projectsSortDropdown}

                      onPress={() => setActiveProjectsFilterMenu(current => current === 'sort' ? null : 'sort')}

                      activeOpacity={0.85}

                    >

                      <Text style={styles.projectsSortDropdownText}>

                        Sort by: {PROJECTS_SORT_OPTIONS.find(option => option.key === projectsSortKey)?.label || 'Recently Updated'}

                      </Text>

                      <MaterialIcons name={activeProjectsFilterMenu === 'sort' ? 'arrow-drop-up' : 'arrow-drop-down'} size={16} color="#475569" />

                    </TouchableOpacity>

                    {activeProjectsFilterMenu === 'sort' ? (

                      <View style={[styles.projectsFilterMenu, styles.projectsSortMenu]}>

                        {PROJECTS_SORT_OPTIONS.map(option => (

                          <TouchableOpacity

                            key={option.key}

                            style={styles.projectsFilterMenuItem}

                            onPress={() => {

                              setProjectsSortKey(option.key);

                              setActiveProjectsFilterMenu(null);

                            }}

                          >

                            <Text style={[

                              styles.projectsFilterMenuText,

                              projectsSortKey === option.key && styles.projectsFilterMenuTextActive

                            ]}>

                              {option.label}

                            </Text>

                          </TouchableOpacity>

                        ))}

                      </View>

                    ) : null}

                  </View>

                </View>



                {/* Collapsible/Accordion Program Panels */}

                <View style={styles.projectsAccordionList}>

                  {programSections

                    .filter(section => !projectProgramFilter || section.module === projectProgramFilter)

                    .map(section => {

                      const isExpanded = expandedProgramModules.has(section.module);



                      // Filter projects/events inside this program section based on the active controls.

                      let sectionProjects = projectTypeFilter === 'Events'

                        ? section.events

                        : projectTypeFilter === 'Projects'

                          ? section.projects

                          : [...section.projects, ...section.events].filter(

                            (project, index, array) => array.findIndex(candidate => candidate.id === project.id) === index

                          );

                      if (statusFilter) {

                        sectionProjects = sectionProjects.filter(p => getProjectDisplayStatus(p) === statusFilter);

                      }

                      if (projectSearchQuery.trim()) {

                        const query = projectSearchQuery.toLowerCase();

                        sectionProjects = sectionProjects.filter(p =>

                          p.title.toLowerCase().includes(query) ||

                          (p.description && p.description.toLowerCase().includes(query))

                        );

                      }

                      const visibleProjectRows = sectionProjects
                        .filter(project => !project.isEvent)
                        .sort((left, right) =>
                          compareProjectsForSort(left, right, projectsSortKey)
                        );

                      const visibleEventRows = sectionProjects
                        .filter(project => project.isEvent)
                        .sort((left, right) =>
                          compareProjectsForSort(left, right, projectsSortKey)
                        );

                      sectionProjects = [...visibleProjectRows, ...visibleEventRows].sort((left, right) =>

                        Number(Boolean(left.isEvent)) - Number(Boolean(right.isEvent)) ||
                        compareProjectsForSort(left, right, projectsSortKey)

                      );



                      const projectCount = visibleProjectRows.length;

                      const eventCount = visibleEventRows.length;

                      const itemCount = projectCount + eventCount;



                      return (

                        <View key={section.module} style={styles.projectsAccordionCard}>

                          {/* Accordion Header */}

                          <TouchableOpacity

                            style={styles.projectsAccordionHeader}

                            onPress={() => toggleProgramSection(section.module)}

                            activeOpacity={0.9}

                          >

                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>

                              <View style={[styles.projectsAccordionIconBg, { backgroundColor: section.surface }]}>

                                <MaterialIcons name={section.icon} size={20} color={section.accent} />

                              </View>

                              <View style={{ marginLeft: 12 }}>

                                <Text style={styles.projectsAccordionTitle}>{section.title}</Text>

                                <Text style={styles.projectsAccordionSubtitle}>{section.module}</Text>

                              </View>

                            </View>



                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>

                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>

                                <View style={[styles.statusDot, { backgroundColor: section.accent }]} />

                                <Text style={styles.projectsAccordionCountText}>

                                  {projectCount} Project{projectCount === 1 ? '' : 's'} / {eventCount} Event{eventCount === 1 ? '' : 's'}

                                </Text>

                              </View>

                              <MaterialIcons

                                name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}

                                size={20}

                                color="#64748b"

                              />

                            </View>

                          </TouchableOpacity>



                          {/* Accordion Body */}

                          {isExpanded && (

                            <View style={styles.projectsAccordionBody}>

                              {itemCount === 0 ? (

                                <View style={styles.projectsAccordionEmpty}>

                                  <MaterialIcons name="description" size={32} color="#cbd5e1" style={{ marginBottom: 8 }} />

                                  <Text style={styles.projectsAccordionEmptyText}>

                                    No {section.title} projects or events yet

                                  </Text>

                                </View>

                              ) : (

                                <View style={styles.projectsTable}>

                                  {/* Table Headers */}

                                  <View style={styles.projectsTableHeader}>

                                    <Text style={[styles.projectsTableHeaderCell, { flex: 4 }]}>Project Name</Text>

                                    <Text style={[styles.projectsTableHeaderCell, { flex: 1.5, textAlign: 'center' }]}>Status</Text>

                                    <Text style={[styles.projectsTableHeaderCell, { flex: 2, textAlign: 'center' }]}>Schedule</Text>

                                    <Text style={[styles.projectsTableHeaderCell, { flex: 2, textAlign: 'center' }]}>Location</Text>

                                    <Text style={[styles.projectsTableHeaderCell, { flex: 1.5, textAlign: 'center' }]}>Volunteers</Text>

                                    <Text style={[styles.projectsTableHeaderCell, { flex: 1.2, textAlign: 'center' }]}>Actions</Text>

                                  </View>



                                  {/* Table Rows */}

                                  {sectionProjects.map((project, projectIndex) => {

                                    const volunteerSummary = getProjectVolunteerSummary(project);
                                    const projectStatus = getProjectDisplayStatus(project);
                                    const projectEnded = projectStatus === 'Completed' || projectStatus === 'Cancelled';

                                    const showGroupHeader =
                                      projectIndex === 0 ||
                                      Boolean(sectionProjects[projectIndex - 1]?.isEvent) !== Boolean(project.isEvent);

                                    return (

                                      <React.Fragment key={project.id}>

                                      {showGroupHeader ? (

                                        <View style={styles.projectsTableGroupRow}>

                                          <Text style={styles.projectsTableGroupText}>

                                            {project.isEvent ? `Events (${eventCount})` : `Projects (${projectCount})`}

                                          </Text>

                                        </View>

                                      ) : null}

                                      <View style={[styles.projectsTableRow, projectEnded && styles.projectsTableRowEnded]}>

                                        {/* Project Name & Desc */}

                                        <View style={[styles.projectsTableCell, { flex: 4 }]}>

                                          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>

                                            <View style={[styles.projectsStatusDotSmall, { backgroundColor: getProjectStatusColor(project), marginTop: 4 }]} />

                                            <View style={{ marginLeft: 8, flex: 1 }}>

                                              <Text style={styles.projectsTableRowName}>{project.title}</Text>

                                              {project.description ? (

                                                <Text style={styles.projectsTableRowDesc} numberOfLines={2}>

                                                  {project.description}

                                                </Text>

                                              ) : null}

                                            </View>

                                          </View>

                                        </View>



                                        {/* Status Pill */}

                                        <View style={[styles.projectsTableCell, { flex: 1.5, alignItems: 'center', justifyContent: 'center' }]}>

                                          <View style={[styles.projectsTableRowStatusPill, { backgroundColor: getProjectStatusColor(project) + '15' }]}>

                                            <Text style={[styles.projectsTableRowStatusText, { color: getProjectStatusColor(project) }]}>

                                              {projectStatus}

                                            </Text>

                                          </View>

                                        </View>



                                        {/* Schedule */}

                                        <View style={[styles.projectsTableCell, { flex: 2, alignItems: 'center', justifyContent: 'center' }]}>

                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>

                                            <MaterialIcons name="calendar-today" size={14} color="#64748b" />

                                            <View>

                                              <Text style={styles.projectsTableRowScheduleText}>

                                                {project.startDate ? format(new Date(project.startDate), 'MMM d, yyyy') : '--'}

                                              </Text>

                                              <Text style={styles.projectsTableRowScheduleTextTime}>

                                                {project.startDate ? format(new Date(project.startDate), 'h:mm a') : ''}

                                              </Text>

                                              {project.endDate ? (

                                                <>

                                                  <Text style={styles.projectsTableRowScheduleDivider}>-</Text>

                                                  <Text style={styles.projectsTableRowScheduleText}>

                                                    {format(new Date(project.endDate), 'MMM d, yyyy')}

                                                  </Text>

                                                  <Text style={styles.projectsTableRowScheduleTextTime}>

                                                    {format(new Date(project.endDate), 'h:mm a')}

                                                  </Text>

                                                </>

                                              ) : null}

                                            </View>

                                          </View>

                                        </View>



                                        {/* Location */}

                                        <View style={[styles.projectsTableCell, { flex: 2, alignItems: 'center', justifyContent: 'center' }]}>

                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>

                                            <MaterialIcons name="location-on" size={14} color="#64748b" />

                                            <Text style={styles.projectsTableRowLocationText} numberOfLines={1}>

                                              {formatProjectLocation(project)}

                                            </Text>

                                          </View>

                                        </View>



                                        {/* Volunteers */}

                                        <View style={[styles.projectsTableCell, { flex: 1.5, alignItems: 'center', justifyContent: 'center' }]}>

                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>

                                            <MaterialIcons name="people" size={14} color="#64748b" />

                                            <Text style={styles.projectsTableRowVolunteersText}>

                                              {volunteerSummary.count}/{volunteerSummary.needed}

                                            </Text>

                                          </View>

                                        </View>



                                        {/* Actions */}

                                        <View style={[styles.projectsTableCell, { flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, position: 'relative', zIndex: activeProjectRowActionId === project.id ? 20 : 1 }]}>

                                          {isAdmin && !project.isEvent && !projectEnded && (

                                            <TouchableOpacity

                                              onPress={() => {
                                                setActiveProjectRowActionId(null);
                                                openCreateEventModal(project);
                                              }}

                                              style={{

                                                padding: 4,

                                                backgroundColor: '#e0f2fe',

                                                borderRadius: 4

                                              }}

                                            >

                                              <MaterialIcons name="event" size={14} color="#0369a1" />

                                            </TouchableOpacity>

                                          )}

                                          <TouchableOpacity

                                            onPress={(event) => {
                                              event.stopPropagation?.();
                                              setActiveProjectRowActionId(current =>
                                                current === project.id ? null : project.id
                                              );
                                            }}

                                            activeOpacity={0.8}
                                            style={styles.projectsTableActionIconButton}

                                          >

                                            <MaterialIcons name="more-vert" size={18} color="#64748b" />

                                          </TouchableOpacity>

                                          {activeProjectRowActionId === project.id && (
                                            <View style={styles.projectsTableActionMenu}>
                                              <TouchableOpacity
                                                style={styles.projectsTableActionMenuItem}
                                                onPress={() => {
                                                  setActiveProjectRowActionId(null);
                                                  void handleSelectProject(project);
                                                }}
                                              >
                                                <MaterialIcons name="visibility" size={16} color="#166534" />
                                                <Text style={styles.projectsTableActionMenuText}>Open Details</Text>
                                              </TouchableOpacity>

                                              {isAdmin && !projectEnded && (
                                                <TouchableOpacity
                                                  style={styles.projectsTableActionMenuItem}
                                                  onPress={() => {
                                                    setActiveProjectRowActionId(null);
                                                    openEditProjectModal(project);
                                                  }}
                                                >
                                                  <MaterialIcons name="edit" size={16} color="#475569" />
                                                  <Text style={styles.projectsTableActionMenuText}>Edit</Text>
                                                </TouchableOpacity>
                                              )}

                                              {isAdmin && (
                                                <TouchableOpacity
                                                  style={styles.projectsTableActionMenuItem}
                                                  onPress={() => {
                                                    setActiveProjectRowActionId(null);
                                                    handleDeleteProjectFromCard(project);
                                                  }}
                                                >
                                                  <MaterialIcons name="delete-outline" size={16} color="#dc2626" />
                                                  <Text style={[styles.projectsTableActionMenuText, { color: '#dc2626' }]}>Delete</Text>
                                                </TouchableOpacity>
                                              )}
                                            </View>
                                          )}

                                        </View>

                                      </View>

                                      </React.Fragment>

                                    );

                                  })}

                                </View>

                              )}



                              {/* Add Project button */}

                              {isAdmin && (

                                <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>

                                  <TouchableOpacity

                                    style={[styles.projectsAccordionAddButton, { borderColor: '#0284c7', backgroundColor: '#f0f9ff' }]}

                                    onPress={() => openCreateEventInProgramModal(section.module, section.title)}

                                  >

                                    <MaterialIcons name="add-circle-outline" size={16} color="#0284c7" style={{ marginRight: 6 }} />

                                    <Text style={[styles.projectsAccordionAddButtonText, { color: '#0284c7' }]}>Add Project</Text>

                                  </TouchableOpacity>

                                </View>

                              )}

                            </View>

                          )}

                        </View>

                      );

                    })}

                </View>

              </View>

            ) : (

              <View style={{ flex: 1, padding: 16 }}>

                <ProjectTimelineCalendarCard

                  title="Admin Project Calendar"

                  subtitle="Review the shared project schedule, admin planning dates, and Google Calendar events."

                  projects={projects}

                  planningCalendars={planningCalendars}

                  planningItems={planningItems}

                  accentColor="#7c3aed"

                  emptyText="No timeline items yet."

                  statusFilter={statusFilter}

                  setStatusFilter={setStatusFilter}

                  onAddEvent={handleAddEventFromCalendar}

                  onOpenProject={projectId => {

                    const proj = projects.find(p => p.id === projectId);

                    if (proj) {

                      handleSelectProject(proj);

                    }

                  }}

                  onEditProject={projectId => {

                    const proj = projects.find(p => p.id === projectId);

                    if (proj) {

                      openEditProjectModal(proj);

                    }

                  }}

                  onDeleteProject={projectId => {

                    const proj = projects.find(p => p.id === projectId);

                    if (proj) {

                      handleDeleteProjectFromCard(proj);

                    }

                  }}

                />

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

      {renderDatePickerModal()}

      {renderVolunteerApplicationsModal()}

      <ConfirmDialog
        visible={dialogState.visible}
        loading={dialogState.loading}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        loadingText={dialogState.loadingText}
        cancelText={dialogState.cancelText}
        confirmColor={dialogState.confirmColor}
        icon={dialogState.icon as any}
        iconColor={dialogState.iconColor}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

    </View>

  );

}



const styles = StyleSheet.create({

  modalHeaderRow: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    paddingBottom: 20,

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    marginBottom: 20

  },

  modalBreadcrumbs: {

    flexDirection: 'row',

    alignItems: 'center',

    marginBottom: 8

  },

  breadcrumbMuted: {

    fontSize: 12,

    color: '#64748b',

    fontWeight: '600'

  },

  modalTitleText: {

    fontSize: 24,

    fontWeight: '900',

    color: '#0f172a'

  },

  modalSubtitleText: {

    fontSize: 13,

    color: '#64748b',

    marginTop: 4,

    fontWeight: '500'

  },

  modalHeaderIllustration: {

    marginHorizontal: 16,

    alignItems: 'center',

    justifyContent: 'center'

  },

  modalHeaderCancelButton: {

    flexDirection: 'row',

    alignItems: 'center',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingHorizontal: 12,

    paddingVertical: 8,

    backgroundColor: '#ffffff'

  },

  modalHeaderCancelText: {

    fontSize: 13,

    fontWeight: '700',

    color: '#475569'

  },

  modalTwoColumnGrid: {

    flexDirection: 'row',

    gap: 40,

    marginTop: 24

  },

  modalLeftColumn: {

    flex: 1,

    gap: 24

  },

  modalRightColumn: {

    flex: 1,

    gap: 24

  },

  fieldLabelRow: {

    flexDirection: 'row',

    alignItems: 'center',

    marginBottom: 8

  },

  fieldLabelIconBg: {

    width: 28,

    height: 28,

    borderRadius: 14,

    alignItems: 'center',

    justifyContent: 'center',

    marginRight: 8

  },

  formFieldDescText: {

    fontSize: 12,

    color: '#64748b',

    lineHeight: 18,

    marginBottom: 10,

    marginTop: -4,

    fontWeight: '500'

  },

  cityHelperText: {

    fontSize: 11,

    color: '#64748b',

    marginTop: 4,

    fontWeight: '500',

    paddingLeft: 4

  },

  uploadIconCircle: {

    width: 44,

    height: 44,

    borderRadius: 22,

    backgroundColor: '#f8fafc',

    alignItems: 'center',

    justifyContent: 'center',

    marginBottom: 10

  },

  uploadButtonGreenOutline: {

    flexDirection: 'row',

    alignItems: 'center',

    borderWidth: 1,

    borderColor: '#166534',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingHorizontal: 14,

    paddingVertical: 8

  },

  uploadButtonGreenOutlineText: {

    color: '#166534',

    fontSize: 12,

    fontWeight: '800'

  },

  uploadRemoveButtonRedOutline: {

    flexDirection: 'row',

    alignItems: 'center',

    borderWidth: 1,

    borderColor: '#fca5a5',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingHorizontal: 14,

    paddingVertical: 8

  },

  uploadRemoveButtonRedOutlineText: {

    color: '#ef4444',

    fontSize: 12,

    fontWeight: '800'

  },

  addCustomSkillButtonGreenOutline: {

    borderWidth: 1,

    borderColor: '#166534',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingHorizontal: 14,

    height: 38,

    alignItems: 'center',

    justifyContent: 'center'

  },

  addCustomSkillButtonGreenOutlineText: {

    color: '#166534',

    fontSize: 12,

    fontWeight: '800'

  },

  selectedSkillsLabelRow: {

    marginBottom: 6

  },

  selectedSkillsLabel: {

    fontSize: 12,

    fontWeight: '800',

    color: '#475569'

  },

  selectedSkillsGrayBox: {

    backgroundColor: '#f8fafc',

    borderRadius: 8,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 12,

    minHeight: 46,

    justifyContent: 'center'

  },

  modalFooterActionsRow: {

    flexDirection: 'row',

    justifyContent: 'flex-end',

    alignItems: 'center',

    gap: 12,

    borderTopWidth: 1,

    borderTopColor: '#e2e8f0',

    paddingTop: 20,

    marginTop: 32,

    marginBottom: 20

  },

  modalFooterCancelButton: {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingHorizontal: 24,

    paddingVertical: 10,

    alignItems: 'center',

    justifyContent: 'center'

  },

  modalFooterCancelButtonText: {

    color: '#475569',

    fontSize: 13,

    fontWeight: '800'

  },

  modalFooterSubmitButton: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#166534',

    borderRadius: 8,

    paddingHorizontal: 24,

    paddingVertical: 10,

    justifyContent: 'center'

  },

  modalFooterSubmitButtonText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '800'

  },



  formCard: {

    backgroundColor: '#ffffff',

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 24,

    marginBottom: 24,

    gap: 20

  },

  formFieldContainer: {

    marginBottom: 4

  },

  formFieldLabel: {

    fontSize: 14,

    fontWeight: '800',

    color: '#0f172a',

    marginBottom: 4

  },

  formFieldSubtitle: {

    fontSize: 11,

    color: '#64748b',

    fontWeight: '500',

    marginBottom: 8

  },

  formInput: {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    backgroundColor: '#ffffff',

    height: 38,

    paddingHorizontal: 12,

    fontSize: 13,

    color: '#0f172a',

    fontWeight: '600'

  },

  formRowEditor: {

    flexDirection: 'row',

    gap: 16

  },

  formPickerContainer: {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    backgroundColor: '#ffffff',

    height: 38,

    justifyContent: 'center',

    overflow: 'hidden',

    marginBottom: 4

  },

  formPicker: {

    height: 38,

    borderWidth: 0,

    backgroundColor: 'transparent',

    fontSize: 13,

    color: '#0f172a',

    fontWeight: '600'

  },

  charCounter: {

    fontSize: 11,

    color: '#94a3b8',

    alignSelf: 'flex-end',

    marginTop: 4,

    fontWeight: '700'

  },

  uploadDashedBox: {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderStyle: 'dashed',

    borderRadius: 12,

    backgroundColor: '#ffffff',

    padding: 24,

    alignItems: 'center',

    justifyContent: 'center'

  },

  uploadIconContainer: {

    width: 48,

    height: 48,

    borderRadius: 24,

    backgroundColor: '#f0fdf4',

    alignItems: 'center',

    justifyContent: 'center',

    marginBottom: 12

  },

  uploadTitle: {

    fontSize: 13,

    color: '#475569',

    fontWeight: '700',

    textAlign: 'center',

    marginBottom: 8,

    lineHeight: 18,

    maxWidth: 420

  },

  uploadSubtitle: {

    fontSize: 12,

    color: '#94a3b8',

    textAlign: 'center',

    marginBottom: 4,

    fontWeight: '500'

  },

  uploadButton: {

    flexDirection: 'row',

    alignItems: 'center',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingHorizontal: 16,

    paddingVertical: 8

  },

  uploadButtonText: {

    color: '#475569',

    fontSize: 12,

    fontWeight: '800'

  },

  uploadRemoveButton: {

    flexDirection: 'row',

    alignItems: 'center',

    borderWidth: 1,

    borderColor: '#fca5a5',

    backgroundColor: '#fef2f2',

    borderRadius: 8,

    paddingHorizontal: 16,

    paddingVertical: 8

  },

  uploadRemoveButtonText: {

    color: '#ef4444',

    fontSize: 12,

    fontWeight: '800'

  },

  uploadHint: {

    fontSize: 11,

    color: '#94a3b8',

    marginTop: 8,

    fontWeight: '500'

  },

  datePickerInput: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    backgroundColor: '#ffffff',

    height: 38,

    paddingHorizontal: 12

  },

  datePickerInputText: {

    fontSize: 13,

    color: '#0f172a',

    fontWeight: '600'

  },

  addCustomSkillButton: {

    borderWidth: 1,

    borderColor: '#bbf7d0',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingHorizontal: 16,

    height: 38,

    alignItems: 'center',

    justifyContent: 'center'

  },

  addCustomSkillButtonText: {

    color: '#166534',

    fontSize: 12,

    fontWeight: '800'

  },

  noSkillsText: {

    fontSize: 12,

    color: '#94a3b8',

    fontStyle: 'italic',

    marginTop: 4

  },

  formFooterRow: {

    flexDirection: 'row',

    justifyContent: 'flex-end',

    gap: 12,

    marginBottom: 40

  },

  cancelButtonOutline: {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingHorizontal: 24,

    paddingVertical: 10,

    alignItems: 'center',

    justifyContent: 'center'

  },

  cancelButtonOutlineText: {

    color: '#475569',

    fontSize: 13,

    fontWeight: '800'

  },

  submitButtonSolid: {

    backgroundColor: '#166534',

    borderRadius: 8,

    paddingHorizontal: 24,

    paddingVertical: 10,

    alignItems: 'center',

    justifyContent: 'center'

  },

  submitButtonSolidText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '800'

  },

  calendarScreenLayout: {

    padding: 16,

    backgroundColor: '#FAF9F6',

    flex: 1

  },

  calendarHeaderRow: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    marginBottom: 20

  },

  calendarHeaderLeft: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 20

  },

  calendarScreenTitle: {

    fontSize: 24,

    fontWeight: '900',

    color: '#0f172a'

  },

  calendarTabFilters: {

    flexDirection: 'row',

    backgroundColor: '#f1f5f9',

    borderRadius: 999,

    padding: 3

  },

  calendarTabFilterButton: {

    paddingHorizontal: 16,

    paddingVertical: 6,

    borderRadius: 999

  },

  calendarTabFilterActive: {

    backgroundColor: '#ffffff',

    shadowColor: '#000',

    shadowOffset: {

      width: 0,

      height: 1

    },

    shadowOpacity: 0.1,

    shadowRadius: 2,

    elevation: 1

  },

  calendarTabFilterText: {

    fontSize: 13,

    fontWeight: '700',

    color: '#64748b'

  },

  calendarTabFilterActiveText: {

    color: '#0f172a'

  },

  calendarHeaderRight: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 12

  },

  calendarExportButton: {

    width: 36,

    height: 36,

    borderRadius: 8,

    borderWidth: 1,

    borderColor: '#cbd5e1',

    backgroundColor: '#ffffff',

    alignItems: 'center',

    justifyContent: 'center'

  },

  calendarAddButton: {

    backgroundColor: '#c27d38',

    paddingHorizontal: 16,

    paddingVertical: 8,

    borderRadius: 8

  },

  calendarAddButtonText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '800'

  },

  calendarContentGrid: {

    flexDirection: 'row',

    gap: 24

  },

  calendarMonthGridWrapper: {

    flex: 7.5,

    backgroundColor: '#ffffff',

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 16

  },

  calendarMonthHeaderRow: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    marginBottom: 16

  },

  calendarMonthLabel: {

    fontSize: 18,

    fontWeight: '900',

    color: '#0f172a'

  },

  calendarMonthNavControls: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8

  },

  calendarMonthNavButton: {

    width: 28,

    height: 28,

    borderRadius: 14,

    backgroundColor: '#f1f5f9',

    alignItems: 'center',

    justifyContent: 'center'

  },

  calendarMonthTodayButton: {

    paddingHorizontal: 12,

    paddingVertical: 5,

    backgroundColor: '#faf2f5',

    borderRadius: 6

  },

  calendarMonthTodayText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#a21caf'

  },

  calendarGrid: {

    flex: 1

  },

  calendarGridHeader: {

    flexDirection: 'row',

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    paddingBottom: 8,

    marginBottom: 8

  },

  calendarGridHeaderCell: {

    flex: 1,

    textAlign: 'center',

    fontSize: 12,

    fontWeight: '700',

    color: '#64748b'

  },

  calendarGridWeeks: {

    gap: 4

  },

  calendarGridWeekRow: {

    flexDirection: 'row',

    gap: 4

  },

  calendarGridDayCell: {

    flex: 1,

    aspectRatio: 1.1,

    backgroundColor: '#f8fafc',

    borderRadius: 8,

    padding: 6,

    minHeight: 84

  },

  calendarGridDayCellMuted: {

    opacity: 0.45

  },

  calendarGridDayNumber: {

    fontSize: 11,

    fontWeight: '700',

    color: '#64748b',

    alignSelf: 'flex-end',

    marginBottom: 4

  },

  calendarGridDayNumberMuted: {

    color: '#94a3b8'

  },

  calendarDayCard: {

    flexDirection: 'row',

    borderRadius: 6,

    paddingRight: 6,

    height: 32,

    alignItems: 'stretch',

    overflow: 'hidden',

    marginBottom: 4

  },

  calendarDayCardActive: {

    backgroundColor: '#dcfce7'

  },

  calendarDayCardDraft: {

    backgroundColor: '#f1f5f9'

  },

  calendarDayCardAccent: {

    width: 3

  },

  calendarDayCardAccentActive: {

    backgroundColor: '#22c55e'

  },

  calendarDayCardAccentDraft: {

    backgroundColor: '#94a3b8'

  },

  calendarDayCardContent: {

    flex: 1,

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    paddingLeft: 6

  },

  calendarDayCardName: {

    fontSize: 10,

    fontWeight: '700',

    color: '#1e293b',

    flex: 1,

    marginRight: 4

  },

  calendarDayCardBadge: {

    paddingHorizontal: 4,

    paddingVertical: 1,

    borderRadius: 4

  },

  calendarDayCardBadgeActive: {

    backgroundColor: '#22c55e'

  },

  calendarDayCardBadgeDraft: {

    backgroundColor: '#94a3b8'

  },

  calendarDayCardBadgeText: {

    color: '#ffffff',

    fontSize: 8,

    fontWeight: '800'

  },

  upcomingEventsPanel: {

    flex: 4.5,

    backgroundColor: '#ffffff',

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 16,

    maxHeight: 650

  },

  upcomingEventsTitle: {

    fontSize: 15,

    fontWeight: '900',

    color: '#0f172a',

    marginBottom: 16,

    textAlign: 'center'

  },

  upcomingEventsScroll: {

    flex: 1

  },

  upcomingGroupHeader: {

    fontSize: 12,

    fontWeight: '800',

    color: '#64748b',

    marginTop: 14,

    marginBottom: 8

  },

  upcomingEventCard: {

    backgroundColor: '#ffffff',

    borderRadius: 12,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 12,

    marginBottom: 12

  },

  upcomingEventCardHeader: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    marginBottom: 8

  },

  upcomingEventTitleRow: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    flex: 1

  },

  upcomingEventProjectName: {

    fontSize: 13,

    fontWeight: '800',

    color: '#1e293b',

    flex: 1

  },

  upcomingEventMetaRow: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    marginBottom: 4

  },

  upcomingEventMetaText: {

    fontSize: 11,

    color: '#64748b',

    fontWeight: '500'

  },

  upcomingEventActions: {

    flexDirection: 'row',

    gap: 8,

    marginTop: 12

  },

  upcomingEventButtonSecondary: {

    flex: 1,

    paddingVertical: 6,

    backgroundColor: '#f1f5f9',

    borderRadius: 6,

    alignItems: 'center'

  },

  upcomingEventButtonSecondaryText: {

    fontSize: 11,

    fontWeight: '800',

    color: '#475569'

  },

  upcomingEventButtonPrimary: {

    flex: 1,

    paddingVertical: 6,

    backgroundColor: '#faf2f5',

    borderRadius: 6,

    alignItems: 'center'

  },

  upcomingEventButtonPrimaryText: {

    fontSize: 11,

    fontWeight: '800',

    color: '#a21caf'

  },

  breadcrumbBar: {

    flexDirection: 'row',

    alignItems: 'center',

    marginBottom: 16,

    paddingHorizontal: 4

  },

  breadcrumbText: {

    fontSize: 12,

    color: '#64748b',

    fontWeight: '600'

  },

  breadcrumbActive: {

    fontSize: 12,

    color: '#0f172a',

    fontWeight: '700'

  },

  titleRow: {

    flexDirection: 'row',

    justifyContent: 'space-between',

    alignItems: 'flex-start',

    marginBottom: 24,

    paddingHorizontal: 4

  },

  projectTitleText: {

    fontSize: 28,

    fontWeight: '900',

    color: '#0f172a'

  },

  projectDescText: {

    fontSize: 14,

    color: '#475569',

    marginTop: 4,

    lineHeight: 20

  },

  statusPill: {

    paddingHorizontal: 12,

    paddingVertical: 4,

    borderRadius: 999

  },

  statusPillText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#1e293b'

  },

  titleActions: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8

  },

  editButtonGreen: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#15803d',

    paddingHorizontal: 16,

    paddingVertical: 8,

    borderRadius: 8,

    gap: 6

  },

  editButtonGreenText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '700'

  },

  overflowButton: {

    width: 36,

    height: 36,

    borderRadius: 8,

    borderWidth: 1,

    borderColor: '#cbd5e1',

    backgroundColor: '#ffffff',

    alignItems: 'center',

    justifyContent: 'center'

  },

  twoColumnGrid: {

    flexDirection: 'row',

    gap: 24

  },

  leftColumn: {

    flex: 6.5,

    gap: 20

  },

  rightColumn: {

    flex: 3.5,

    gap: 20

  },

  highlightsCard: {

    flexDirection: 'row',

    backgroundColor: '#ffffff',

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    paddingVertical: 16,

    paddingHorizontal: 20,

    alignItems: 'center'

  },

  highlightSection: {

    flex: 1,

    flexDirection: 'row',

    alignItems: 'center',

    gap: 12

  },

  highlightIconBg: {

    width: 36,

    height: 36,

    borderRadius: 18,

    backgroundColor: '#f0fdf4',

    alignItems: 'center',

    justifyContent: 'center'

  },

  highlightLabel: {

    fontSize: 11,

    fontWeight: '800',

    color: '#64748b',

    textTransform: 'uppercase'

  },

  highlightValue: {

    fontSize: 13,

    fontWeight: '700',

    color: '#0f172a',

    marginTop: 2

  },

  highlightDivider: {

    width: 1,

    height: 32,

    backgroundColor: '#e2e8f0',

    marginHorizontal: 20

  },

  projectCard: {

    backgroundColor: '#ffffff',

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 20

  },

  cardHeaderRow: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8,

    marginBottom: 8

  },

  alignedCardTitle: {

    fontSize: 15,

    fontWeight: '900',

    color: '#0f172a',

    flex: 1

  },

  cardDescText: {

    fontSize: 12,

    color: '#64748b',

    lineHeight: 18,

    marginBottom: 16

  },

  pictureContainer: {

    aspectRatio: 1.8,

    borderRadius: 12,

    backgroundColor: '#f8fafc',

    overflow: 'hidden',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    marginBottom: 12

  },

  picturePreview: {

    width: '100%',

    height: '100%'

  },

  pictureEmptyState: {

    flex: 1,

    alignItems: 'center',

    justifyContent: 'center'

  },

  pictureEmptyText: {

    fontSize: 13,

    color: '#94a3b8',

    marginTop: 8

  },

  pictureCaption: {

    fontSize: 11,

    color: '#64748b',

    textAlign: 'center',

    fontStyle: 'italic',

    marginBottom: 16

  },

  pictureActions: {

    flexDirection: 'row',

    gap: 10,

    justifyContent: 'center'

  },

  pictureActionButton: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    paddingHorizontal: 12,

    paddingVertical: 6,

    borderRadius: 6,

    borderWidth: 1,

    borderColor: '#bbf7d0',

    backgroundColor: '#f0fdf4'

  },

  pictureActionText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#166534'

  },

  pictureActionRemoveButton: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    paddingHorizontal: 12,

    paddingVertical: 6,

    borderRadius: 6,

    borderWidth: 1,

    borderColor: '#fecaca',

    backgroundColor: '#fef2f2'

  },

  pictureActionRemoveText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#b91c1c'

  },

  timelineAddButton: {

    width: 24,

    height: 24,

    borderRadius: 12,

    backgroundColor: '#15803d',

    alignItems: 'center',

    justifyContent: 'center'

  },

  emptyTimelineText: {

    fontSize: 13,

    color: '#94a3b8',

    textAlign: 'center',

    paddingVertical: 16

  },

  timelineList: {

    marginTop: 8

  },

  timelineItem: {

    flexDirection: 'row',

    gap: 12

  },

  timelineIconColumn: {

    alignItems: 'center'

  },

  timelineStatusDot: {

    width: 18,

    height: 18,

    borderRadius: 9,

    alignItems: 'center',

    justifyContent: 'center'

  },

  timelineLine: {

    width: 2,

    flex: 1,

    backgroundColor: '#e2e8f0',

    marginVertical: 4

  },

  timelineContent: {

    flex: 1,

    paddingBottom: 20

  },

  timelineStatusTitle: {

    fontSize: 13,

    fontWeight: '800',

    color: '#0f172a'

  },

  timelineDescText: {

    fontSize: 12,

    color: '#475569',

    marginTop: 2

  },

  timelineDateText: {

    fontSize: 10,

    color: '#94a3b8',

    marginTop: 4,

    fontWeight: '600'

  },

  coreSetupFieldLabel: {

    fontSize: 12,

    fontWeight: '800',

    color: '#475569',

    marginBottom: 6

  },

  coreSetupModuleTag: {

    flexDirection: 'row',

    alignItems: 'center',

    alignSelf: 'flex-start',

    backgroundColor: '#f0fdf4',

    borderWidth: 1,

    borderColor: '#bbf7d0',

    borderRadius: 6,

    paddingHorizontal: 8,

    paddingVertical: 4,

    marginBottom: 6

  },

  coreSetupModuleText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#166534'

  },

  coreSetupFieldDesc: {

    fontSize: 11,

    color: '#64748b'

  },

  panelEmptyState: {

    alignItems: 'center',

    paddingVertical: 24,

    borderWidth: 1,

    borderColor: '#f1f5f9',

    borderStyle: 'dashed',

    borderRadius: 12,

    backgroundColor: '#f8fafc',

    marginBottom: 16

  },

  panelEmptyTitle: {

    fontSize: 13,

    fontWeight: '800',

    color: '#475569'

  },

  panelEmptyDesc: {

    fontSize: 11,

    color: '#94a3b8',

    textAlign: 'center',

    paddingHorizontal: 20,

    marginTop: 4

  },

  panelAddButton: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor: '#15803d',

    borderRadius: 8,

    paddingVertical: 8

  },

  panelAddButtonText: {

    color: '#ffffff',

    fontSize: 12,

    fontWeight: '800'

  },

  panelUploadButton: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    backgroundColor: '#ffffff',

    borderRadius: 8,

    paddingVertical: 8

  },

  panelUploadButtonText: {

    color: '#475569',

    fontSize: 12,

    fontWeight: '800'

  },

  eventsListMini: {

    marginBottom: 16,

    gap: 8

  },

  eventItemMini: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#f8fafc',

    borderRadius: 8,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 10

  },

  eventItemTitleMini: {

    fontSize: 12,

    fontWeight: '800',

    color: '#0f172a'

  },

  eventItemMetaMini: {

    fontSize: 10,

    color: '#64748b',

    marginTop: 2

  },

  attachmentsListMini: {

    marginBottom: 16,

    gap: 8

  },

  attachmentItemMini: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#f8fafc',

    borderRadius: 8,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 10

  },

  attachmentNameMini: {

    fontSize: 12,

    fontWeight: '700',

    color: '#475569',

    flex: 1

  },

  programEyebrow: {

    fontSize: 11,

    fontWeight: '800',

    color: '#166534',

    textTransform: 'uppercase',

    letterSpacing: 0.5,

    marginBottom: 4

  },

  programMainTitle: {

    fontSize: 28,

    fontWeight: '900',

    color: '#0f172a',

    marginBottom: 6

  },

  programMainDesc: {

    fontSize: 14,

    color: '#64748b',

    lineHeight: 20,

    marginBottom: 24

  },

  programHeaderRow: {

    flexDirection: 'row',

    justifyContent: 'space-between',

    alignItems: 'flex-start',

    marginBottom: 20

  },

  programAddButton: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#166534',

    paddingHorizontal: 16,

    paddingVertical: 10,

    borderRadius: 8,

    gap: 6

  },

  programAddButtonText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '800'

  },

  programSummaryRow: {

    flexDirection: 'row',

    backgroundColor: '#ffffff',

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 20,

    marginBottom: 32,

    gap: 16

  },

  programSummaryCard: {

    flex: 1,

    flexDirection: 'row',

    alignItems: 'center',

    borderRightWidth: 1,

    borderRightColor: '#f1f5f9',

    paddingRight: 16

  },

  programSummaryIconBg: {

    width: 44,

    height: 44,

    borderRadius: 22,

    backgroundColor: '#f0fdf4',

    alignItems: 'center',

    justifyContent: 'center'

  },

  programSummaryValue: {

    fontSize: 20,

    fontWeight: '900',

    color: '#0f172a'

  },

  programSummaryLabel: {

    fontSize: 11,

    fontWeight: '700',

    color: '#64748b',

    marginTop: 2

  },

  programSectionHeaderRow: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    marginBottom: 20,

    borderBottomWidth: 1,

    borderBottomColor: '#e2e8f0',

    paddingBottom: 12

  },

  programSectionTitle: {

    fontSize: 18,

    fontWeight: '800',

    color: '#0f172a',

    position: 'relative',

    paddingBottom: 12,

    marginBottom: -13

  },

  programSectionTitleActiveLine: {

    position: 'absolute',

    bottom: 0,

    left: 0,

    right: 0,

    height: 3,

    backgroundColor: '#166534',

    borderRadius: 99

  },

  programSectionControls: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 12

  },

  layoutToggleGroup: {

    flexDirection: 'row',

    backgroundColor: '#f1f5f9',

    borderRadius: 8,

    padding: 3

  },

  layoutToggleButton: {

    padding: 6,

    borderRadius: 6

  },

  layoutToggleButtonActive: {

    backgroundColor: '#ffffff',

    shadowColor: '#000',

    shadowOffset: {

      width: 0,

      height: 1

    },

    shadowOpacity: 0.05,

    shadowRadius: 1,

    elevation: 1

  },

  sortDropdownButton: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#ffffff',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingHorizontal: 12,

    paddingVertical: 7,

    gap: 8

  },

  sortDropdownText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#475569'

  },

  programGrid: {

    flexDirection: 'row',

    flexWrap: 'wrap',

    gap: 20

  },

  programCard: {

    flexBasis: 280,

    flexGrow: 1,

    maxWidth: 360,

    backgroundColor: '#ffffff',

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    overflow: 'hidden'

  },

  programCardImageContainer: {

    aspectRatio: 1.8,

    backgroundColor: '#f8fafc',

    position: 'relative'

  },

  programCardImage: {

    width: '100%',

    height: '100%'

  },

  programCardImagePlaceholder: {

    flex: 1,

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor: '#f1f5f9'

  },

  programCardBadge: {

    position: 'absolute',

    top: 12,

    right: 12,

    backgroundColor: 'rgba(255, 255, 255, 0.9)',

    borderRadius: 6,

    paddingHorizontal: 8,

    paddingVertical: 4,

    shadowColor: '#000',

    shadowOffset: {

      width: 0,

      height: 1

    },

    shadowOpacity: 0.1,

    shadowRadius: 2,

    elevation: 2

  },

  programCardBadgeText: {

    fontSize: 10,

    fontWeight: '800',

    color: '#166534'

  },

  programCardBody: {

    padding: 16

  },

  programCardHeaderRow: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 10,

    marginBottom: 10

  },

  programCardAvatar: {

    width: 36,

    height: 36,

    borderRadius: 18,

    alignItems: 'center',

    justifyContent: 'center'

  },

  programCardTitle: {

    fontSize: 15,

    fontWeight: '900',

    color: '#0f172a'

  },

  programCardSubtitle: {

    fontSize: 11,

    fontWeight: '700',

    color: '#64748b',

    marginTop: 1

  },

  programCardDesc: {

    fontSize: 12,

    color: '#475569',

    lineHeight: 18,

    height: 54,

    marginBottom: 16

  },

  programCardMetrics: {

    flexDirection: 'row',

    borderTopWidth: 1,

    borderTopColor: '#f1f5f9',

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    paddingVertical: 12,

    marginBottom: 16,

    gap: 8

  },

  programCardMetricCell: {

    flex: 1,

    alignItems: 'center'

  },

  programCardMetricValue: {

    fontSize: 14,

    fontWeight: '800',

    color: '#0f172a'

  },

  programCardMetricLabel: {

    fontSize: 10,

    fontWeight: '700',

    color: '#64748b',

    marginTop: 2

  },

  programCardActions: {

    flexDirection: 'row',

    gap: 8,

    marginBottom: 14

  },

  programCardActionButton: {

    flex: 1,

    paddingVertical: 6,

    borderRadius: 6,

    borderWidth: 1,

    alignItems: 'center'

  },

  programCardActionButtonText: {

    fontSize: 11,

    fontWeight: '800'

  },

  programCardFooter: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    borderTopWidth: 1,

    borderTopColor: '#f1f5f9',

    paddingTop: 12

  },

  programCardFooterText: {

    fontSize: 11,

    fontWeight: '800',

    color: '#166534'

  },

  programGridAddCard: {

    flexBasis: 280,

    flexGrow: 1,

    maxWidth: 360,

    minHeight: 320,

    borderWidth: 2,

    borderColor: '#cbd5e1',

    borderStyle: 'dashed',

    borderRadius: 16,

    backgroundColor: '#f8fafc',

    alignItems: 'center',

    justifyContent: 'center',

    padding: 20

  },

  programGridAddIconBg: {

    width: 48,

    height: 48,

    borderRadius: 24,

    backgroundColor: '#ffffff',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    alignItems: 'center',

    justifyContent: 'center',

    marginBottom: 12,

    shadowColor: '#000',

    shadowOffset: {

      width: 0,

      height: 1

    },

    shadowOpacity: 0.05,

    shadowRadius: 2,

    elevation: 1

  },

  programGridAddLabel: {

    fontSize: 13,

    fontWeight: '800',

    color: '#475569'

  },

  projectsLayoutContainer: {

    padding: 16,

    backgroundColor: '#FAF9F6',

    flex: 1

  },

  projectsHeaderRow: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    marginBottom: 20

  },

  projectsHeaderTitle: {

    fontSize: 24,

    fontWeight: '900',

    color: '#0f172a'

  },

  projectsHeaderSubtitle: {

    fontSize: 13,

    color: '#64748b',

    marginTop: 4

  },

  projectsAddButton: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#166534',

    paddingHorizontal: 16,

    paddingVertical: 10,

    borderRadius: 8,

    gap: 6

  },

  projectsAddButtonText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '800'

  },

  projectsFilterRow: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 12,

    marginBottom: 20,

    flexWrap: 'wrap'

  },

  projectsFilterRowMenuOpen: {

    marginBottom: 300

  },

  projectsFilterDropdown: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#ffffff',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingHorizontal: 12,

    paddingVertical: 8,

    gap: 8,

    minWidth: 140

  },

  projectsFilterMenuWrap: {

    position: 'relative',

    zIndex: 50

  },

  projectsFilterMenuWrapActive: {

    zIndex: 2000

  },

  projectsFilterDropdownText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#475569',

    flex: 1

  },

  projectsFilterMenu: {

    position: 'absolute',

    top: 42,

    left: 0,

    minWidth: 180,

    maxHeight: 280,

    backgroundColor: '#ffffff',

    borderWidth: 1,

    borderColor: '#dbe3ef',

    borderRadius: 8,

    paddingVertical: 4,

    shadowColor: '#000',

    shadowOpacity: 0.14,

    shadowRadius: 14,

    shadowOffset: { width: 0, height: 8 },

    elevation: 24,

    zIndex: 1000

  },

  projectsSortMenuWrap: {

    marginLeft: 'auto'

  },

  projectsSortMenu: {

    minWidth: 220,

    right: 0,

    left: undefined

  },

  projectsFilterMenuItem: {

    paddingHorizontal: 12,

    paddingVertical: 10

  },

  projectsFilterMenuText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#334155'

  },

  projectsFilterMenuTextActive: {

    color: '#0284c7'

  },

  projectsSearchContainer: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#ffffff',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingHorizontal: 12,

    flex: 1,

    minWidth: 200,

    height: 38

  },

  projectsSearchInput: {

    flex: 1,

    fontSize: 13,

    color: '#0f172a',

    fontWeight: '600',

    padding: 0

  },

  projectsSortDropdown: {

    flexDirection: 'row',

    alignItems: 'center',

    backgroundColor: '#ffffff',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingHorizontal: 12,

    paddingVertical: 8,

    gap: 8

  },

  projectsSortDropdownText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#475569'

  },

  projectsAccordionList: {

    gap: 16

  },

  projectsAccordionCard: {

    backgroundColor: '#ffffff',

    borderRadius: 12,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    overflow: 'visible'

  },

  projectsAccordionHeader: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    padding: 16,

    backgroundColor: '#ffffff'

  },

  projectsAccordionIconBg: {

    width: 36,

    height: 36,

    borderRadius: 18,

    alignItems: 'center',

    justifyContent: 'center'

  },

  projectsAccordionTitle: {

    fontSize: 15,

    fontWeight: '900',

    color: '#0f172a'

  },

  projectsAccordionSubtitle: {

    fontSize: 11,

    fontWeight: '700',

    color: '#64748b',

    marginTop: 1

  },

  statusDot: {

    width: 6,

    height: 6,

    borderRadius: 3

  },

  projectsAccordionCountText: {

    fontSize: 12,

    fontWeight: '800',

    color: '#334155'

  },

  projectsAccordionBody: {

    borderTopWidth: 1,

    borderTopColor: '#f1f5f9',

    padding: 16,

    backgroundColor: '#f8fafc'

  },

  projectsAccordionEmpty: {

    alignItems: 'center',

    paddingVertical: 32

  },

  projectsAccordionEmptyText: {

    fontSize: 13,

    fontWeight: '700',

    color: '#64748b'

  },

  projectsTable: {

    backgroundColor: '#ffffff',

    borderRadius: 8,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    overflow: 'visible',

    marginBottom: 16

  },

  projectsTableHeader: {

    flexDirection: 'row',

    backgroundColor: '#f8fafc',

    borderBottomWidth: 1,

    borderBottomColor: '#e2e8f0',

    paddingVertical: 10,

    paddingHorizontal: 12

  },

  projectsTableHeaderCell: {

    fontSize: 11,

    fontWeight: '800',

    color: '#475569',

    textTransform: 'uppercase'

  },

  projectsTableGroupRow: {

    backgroundColor: '#f8fafc',

    borderBottomWidth: 1,

    borderBottomColor: '#e2e8f0',

    paddingVertical: 8,

    paddingHorizontal: 12

  },

  projectsTableGroupText: {

    fontSize: 11,

    fontWeight: '900',

    color: '#166534',

    textTransform: 'uppercase'

  },

  projectsTableRow: {

    flexDirection: 'row',

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    paddingVertical: 12,

    paddingHorizontal: 12,

    alignItems: 'center'

  },
  projectsTableRowEnded: {
    opacity: 0.55,
    backgroundColor: '#f8fafc',
  },

  projectsTableCell: {

    justifyContent: 'center'

  },
  projectsTableActionIconButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectsTableActionMenu: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  projectsTableActionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  projectsTableActionMenuText: {
    display: 'none',
  },

  projectsStatusDotSmall: {

    width: 6,

    height: 6,

    borderRadius: 3

  },

  projectsTableRowName: {

    fontSize: 13,

    fontWeight: '800',

    color: '#0f172a'

  },

  projectsTableRowDesc: {

    fontSize: 11,

    color: '#64748b',

    marginTop: 2,

    lineHeight: 15

  },

  projectsTableRowStatusPill: {

    paddingHorizontal: 8,

    paddingVertical: 4,

    borderRadius: 999

  },

  projectsTableRowStatusText: {

    fontSize: 11,

    fontWeight: '700'

  },

  projectsTableRowScheduleText: {

    fontSize: 11,

    fontWeight: '700',

    color: '#334155'

  },

  projectsTableRowScheduleTextTime: {

    fontSize: 9,

    fontWeight: '600',

    color: '#64748b'

  },

  projectsTableRowScheduleDivider: {

    fontSize: 9,

    color: '#94a3b8',

    textAlign: 'center',

    marginVertical: 1

  },

  projectsTableRowLocationText: {

    fontSize: 11,

    fontWeight: '700',

    color: '#334155'

  },

  projectsTableRowVolunteersText: {

    fontSize: 11,

    fontWeight: '700',

    color: '#334155'

  },

  projectsAccordionAddButton: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    borderWidth: 1,

    borderColor: '#bbf7d0',

    borderStyle: 'dashed',

    borderRadius: 8,

    backgroundColor: '#ffffff',

    paddingVertical: 10

  },

  projectsAccordionAddButtonText: {

    fontSize: 12,

    fontWeight: '800',

    color: '#166534'

  },



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

  webOverlay: {

    position: 'absolute',

    top: 0,

    left: 0,

    right: 0,

    bottom: 0,

    backgroundColor: '#faf9f6',

    zIndex: 100,

    padding: 32,

    paddingTop: 16,

    ...Platform.select({

      web: {

        overflowY: 'auto',

      } as any,

    }),

  },

  overlay: {

    flex: 1,

    backgroundColor: '#faf9f6',

  },

  overlayDismiss: {

    flex: 1,

  },

  drawer: {

    width: '100%',

    maxWidth: 1100,

    marginHorizontal: 'auto',

  },

});



const premiumDetailsStyles = StyleSheet.create({

  breadcrumbBar: {

    flexDirection: 'row',

    alignItems: 'center',

    paddingVertical: 12,

    marginBottom: 8,

  },

  breadcrumbText: {

    fontSize: 13,

    color: '#166534',

    fontWeight: '700',

  },

  breadcrumbMuted: {

    fontSize: 13,

    color: '#64748b',

    fontWeight: '500',

  },

  breadcrumbActive: {

    fontSize: 13,

    color: '#64748b',

    fontWeight: '700',

  },

  heroBanner: {

    borderRadius: 16,

    overflow: 'visible',

    marginBottom: 24,

    minHeight: 220,

    backgroundColor: '#0f172a',

    position: 'relative',

    zIndex: 100,

    elevation: 20,

  },

  heroBackground: {

    width: '100%',

    height: '100%',

    padding: 24,

    justifyContent: 'space-between',

    borderRadius: 16,

    overflow: 'visible',

  },

  heroOverlay: {

    ...StyleSheet.absoluteFillObject,

    backgroundColor: 'rgba(15, 23, 42, 0.65)',

  },

  heroTop: {

    alignItems: 'flex-start',

  },

  heroStatusPill: {

    backgroundColor: '#166534',

    paddingHorizontal: 10,

    paddingVertical: 4,

    borderRadius: 6,

    marginBottom: 12,

  },

  heroStatusText: {

    color: '#ffffff',

    fontSize: 11,

    fontWeight: '800',

    letterSpacing: 0.5,

  },

  heroTitle: {

    fontSize: 26,

    fontWeight: '800',

    color: '#ffffff',

    marginBottom: 16,

    maxWidth: 800,

    lineHeight: 34,

  },

  heroMetaRow: {

    flexDirection: 'row',

    flexWrap: 'wrap',

    alignItems: 'center',

    gap: 16,

  },

  heroMetaItem: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

  },

  heroMetaText: {

    color: '#f8fafc',

    fontSize: 13,

    fontWeight: '600',

  },

  heroActionsRow: {

    flexDirection: 'row',

    flexWrap: 'wrap',

    alignItems: 'center',

    gap: 12,

    marginTop: 20,

  },

  heroBtnGreen: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    backgroundColor: '#166534',

    paddingVertical: 10,

    paddingHorizontal: 16,

    borderRadius: 8,

  },

  heroBtnGreenText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '700',

  },

  heroBtnOutline: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    backgroundColor: 'rgba(255, 255, 255, 0.1)',

    borderWidth: 1,

    borderColor: 'rgba(255, 255, 255, 0.25)',

    paddingVertical: 10,

    paddingHorizontal: 16,

    borderRadius: 8,

  },
  heroBtnDanger: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    backgroundColor: 'rgba(220, 38, 38, 0.92)',

    borderWidth: 1,

    borderColor: 'rgba(254, 202, 202, 0.65)',

    paddingVertical: 10,

    paddingHorizontal: 16,

    borderRadius: 8,

  },

  heroBtnOutlineText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '700',

  },
  heroMoreMenuWrap: {
    position: 'relative',
    zIndex: 50,
  },
  heroMoreDropdown: {
    position: 'absolute',
    top: 46,
    right: 0,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    minWidth: 220,
    zIndex: 9999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  heroMoreDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },

  mainGrid: {

    gap: 24,

  },

  card: {

    backgroundColor: '#ffffff',

    borderWidth: 1,

    borderColor: '#e2e8f0',

    borderRadius: 16,

    padding: 24,

    marginBottom: 20,

    shadowColor: '#0f172a',

    shadowOffset: { width: 0, height: 4 },

    shadowOpacity: 0.02,

    shadowRadius: 10,

    elevation: 2,

  },

  cardHeader: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    marginBottom: 20,

  },

  cardTitle: {

    fontSize: 16,

    fontWeight: '800',

    color: '#0f172a',

  },

  cardLink: {

    fontSize: 13,

    fontWeight: '700',

    color: '#166534',

  },

  aboutContainer: {

    flexDirection: 'row',

    flexWrap: 'wrap',

    gap: 24,

  },

  aboutText: {

    flex: 1.4,

    fontSize: 14,

    color: '#334155',

    lineHeight: 22,

    fontWeight: '500',

  },

  statsBox: {

    flex: 1,

    flexDirection: 'row',

    flexWrap: 'wrap',

    backgroundColor: '#f8fafc',

    borderRadius: 12,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    padding: 16,

    gap: 16,

  },

  statCell: {

    width: '45%',

    alignItems: 'center',

    paddingVertical: 8,

  },

  statIconRow: {

    width: 32,

    height: 32,

    borderRadius: 16,

    backgroundColor: '#f0fdf4',

    alignItems: 'center',

    justifyContent: 'center',

    marginBottom: 6,

  },

  statValue: {

    fontSize: 18,

    fontWeight: '800',

    color: '#0f172a',

    marginBottom: 2,

  },

  statLabel: {

    fontSize: 11,

    fontWeight: '700',

    color: '#64748b',

    textAlign: 'center',

  },

  eventItem: {

    flexDirection: 'row',

    alignItems: 'center',

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    paddingVertical: 16,

    gap: 16,

  },

  dateBadge: {

    width: 48,

    height: 52,

    borderRadius: 8,

    backgroundColor: '#f1f5f9',

    alignItems: 'center',

    justifyContent: 'center',

  },

  dateBadgeMonth: {

    fontSize: 10,

    fontWeight: '800',

    color: '#ef4444',

  },

  dateBadgeDay: {

    fontSize: 18,

    fontWeight: '800',

    color: '#0f172a',

  },

  eventInfo: {

    flex: 1,

  },

  eventTitle: {

    fontSize: 14,

    fontWeight: '700',

    color: '#0f172a',

    marginBottom: 4,

  },

  eventMeta: {

    fontSize: 12,

    color: '#64748b',

    lineHeight: 16,

  },

  eventRatio: {

    fontSize: 13,

    fontWeight: '700',

    color: '#1e293b',

    marginRight: 8,

  },

  eventViewBtn: {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    paddingVertical: 6,

    paddingHorizontal: 12,

    backgroundColor: '#ffffff',

  },

  eventViewBtnText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#475569',

  },

  reportItem: {

    flexDirection: 'row',

    alignItems: 'center',

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    paddingVertical: 14,

    gap: 16,

  },

  reportIconBg: {

    width: 36,

    height: 36,

    borderRadius: 18,

    backgroundColor: '#f0fdf4',

    alignItems: 'center',

    justifyContent: 'center',

  },

  reportInfo: {

    flex: 1,

  },

  reportTitle: {

    fontSize: 14,

    fontWeight: '700',

    color: '#0f172a',

    marginBottom: 4,

  },

  reportMeta: {

    fontSize: 12,

    color: '#64748b',

  },

  statusBadge: {

    paddingHorizontal: 10,

    paddingVertical: 4,

    borderRadius: 6,

  },

  statusBadgeText: {

    fontSize: 11,

    fontWeight: '800',

  },

  summaryRow: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 12,

    paddingVertical: 12,

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

  },

  summaryLabel: {

    fontSize: 13,

    color: '#64748b',

    fontWeight: '500',

    width: 130,

  },

  summaryValue: {

    flex: 1,

    fontSize: 13,

    fontWeight: '700',

    color: '#0f172a',

  },

  summaryLink: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 6,

    marginTop: 16,

  },

  summaryLinkText: {

    fontSize: 13,

    fontWeight: '700',

    color: '#166534',

  },

  actionBtnGreen: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 8,

    backgroundColor: '#166534',

    paddingVertical: 12,

    borderRadius: 8,

    marginBottom: 10,

  },

  actionBtnGreenText: {

    color: '#ffffff',

    fontSize: 13,

    fontWeight: '700',

  },

  actionBtnOutline: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 8,

    borderWidth: 1,

    borderColor: '#cbd5e1',

    backgroundColor: '#ffffff',

    paddingVertical: 12,

    borderRadius: 8,

    marginBottom: 10,

  },

  actionBtnOutlineText: {

    color: '#475569',

    fontSize: 13,

    fontWeight: '700',

  },

  shareDesc: {

    fontSize: 12,

    color: '#64748b',

    lineHeight: 18,

    marginBottom: 16,

  },

});

