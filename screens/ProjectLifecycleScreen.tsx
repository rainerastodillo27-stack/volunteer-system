import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import {
  AdvocacyFocus,
  Partner,
  PartnerEventCheckIn,
  PartnerProjectApplication,
  PartnerReport,
  Project,
  ProjectInternalTask,
  PublishedImpactReport,
  StatusUpdate,
  VolunteerTimeLog,
} from '../models/types';
import {
  completeVolunteerProjectParticipation,
  deleteProject,
  getAllVolunteerProjectMatches,
  getAllVolunteerTimeLogs,
  getAllPartners,
  getPartnerEventCheckInsByProject,
  getAllProjects,
  getAllVolunteers,
  generateFinalImpactReports,
  getPartnerReportsByProject,
  getPartnerProjectApplications,
  getPublishedImpactReportsByProject,
  getProjectMatches,
  getStatusUpdatesByProject,
  getVolunteerProjectJoinRecords,
  publishImpactReport,
  reviewPartnerProjectApplication,
  reviewVolunteerProjectMatch,
  saveProject,
  saveStatusUpdate,
  subscribeToStorageChanges,
} from '../models/storage';
import { Volunteer, VolunteerProjectJoinRecord, VolunteerProjectMatch } from '../models/types';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getPrimaryProjectImageSource } from '../utils/projectMap';
import { getProjectStatusColor } from '../utils/projectStatus';
import { isImageMediaUri } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const statuses = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const projectModules: AdvocacyFocus[] = ['Nutrition', 'Education', 'Livelihood', 'Disaster'];

type ProjectDraft = {
  id?: string;
  title: string;
  description: string;
  programModule: AdvocacyFocus;
  status: Project['status'];
  partnerId: string;
  startDate: string;
  endDate: string;
  address: string;
  latitude: string;
  longitude: string;
  volunteersNeeded: string;
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
};

type ProjectTimeLogEntry = VolunteerTimeLog & {
  volunteerName: string;
  volunteerEmail: string;
};

type LifecycleBoardView = 'scheduler' | 'timeline';

function getStartOfWeekMonday(sourceDate: Date): Date {
  const date = new Date(sourceDate);
  const dayIndex = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayIndex);
  date.setHours(0, 0, 0, 0);
  return date;
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

// Returns the default project form used for create and edit flows.
const createEmptyProjectDraft = (partnerId = ''): ProjectDraft => ({
  title: '',
  description: '',
  programModule: 'Education',
  status: 'Planning',
  partnerId,
  startDate: '',
  endDate: '',
  address: '',
  latitude: '',
  longitude: '',
  volunteersNeeded: '1',
  isEvent: false,
});

const createEmptyProjectTaskDraft = (): ProjectTaskDraft => ({
  title: '',
  description: '',
  category: 'General',
  priority: 'Medium',
  status: 'Unassigned',
  assignedVolunteerId: '',
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

// Gives admins a unified project operations workspace for planning, delivery, and approvals.
export default function ProjectLifecycleScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' || width >= 1100;
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [partnerCheckIns, setPartnerCheckIns] = useState<PartnerEventCheckIn[]>([]);
  const [partnerReports, setPartnerReports] = useState<PartnerReport[]>([]);
  const [impactReports, setImpactReports] = useState<PublishedImpactReport[]>([]);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [allVolunteerMatches, setAllVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<Project['status']>('Planning');
  const [updateDescription, setUpdateDescription] = useState('');
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(createEmptyProjectDraft());
  const [taskDraft, setTaskDraft] = useState<ProjectTaskDraft>(createEmptyProjectTaskDraft());
  const [lifecycleView, setLifecycleView] = useState<LifecycleBoardView>('scheduler');

  useFocusEffect(
    React.useCallback(() => {
      const refresh = async () => {
        await Promise.all([loadProjects(), loadPartners(), loadVolunteers(), loadAllVolunteerMatches(), loadVolunteerTimeLogs()]);
        if (selectedProject?.id) {
          await Promise.all([
            loadStatusUpdates(selectedProject.id),
            loadPartnerApplicationsForProject(selectedProject.id),
            loadPartnerCheckInsForProject(selectedProject.id),
            loadPartnerReportsForProject(selectedProject.id),
            loadImpactReportsForProject(selectedProject.id),
            loadVolunteerJoinsForProject(selectedProject.id),
            loadVolunteerMatchesForProject(selectedProject.id),
          ]);
        }
      };

      void refresh();
      const unsubscribe = subscribeToStorageChanges(
        ['projects', 'partners', 'volunteers', 'statusUpdates', 'partnerProjectApplications', 'partnerEventCheckIns', 'partnerReports', 'publishedImpactReports', 'volunteerProjectJoins', 'volunteerMatches', 'volunteerTimeLogs'],
        () => {
          void refresh();
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
      const allProjects = await getAllProjects();
      setProjects(allProjects);
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

  // Loads partner organizations for project ownership selection.
  const loadPartners = async () => {
    try {
      const allPartners = await getAllPartners();
      setPartners(allPartners);
      setProjectDraft(current =>
        current.partnerId ? current : { ...current, partnerId: allPartners[0]?.id || '' }
      );
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

  // Loads lifecycle updates for the selected project.
  const loadStatusUpdates = async (projectId: string) => {
    try {
      const updates = await getStatusUpdatesByProject(projectId);
      setStatusUpdates(updates);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load status updates.'),
      });
    }
  };

  // Loads partner project proposals for the selected project.
  const loadPartnerApplicationsForProject = async (projectId: string) => {
    try {
      const applications = await getPartnerProjectApplications(projectId);
      setPartnerApplications(applications);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load program proposals.'),
      });
    }
  };

  // Loads partner field check-ins for the selected project.
  const loadPartnerCheckInsForProject = async (projectId: string) => {
    try {
      const checkIns = await getPartnerEventCheckInsByProject(projectId);
      setPartnerCheckIns(checkIns);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load partner check-ins.'),
      });
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

  // Loads generated final impact files for the selected project.
  const loadImpactReportsForProject = async (projectId: string) => {
    try {
      const reports = await getPublishedImpactReportsByProject(projectId);
      setImpactReports(reports);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load generated impact reports.'),
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
    setSelectedProject(project);
    await Promise.all([
      loadStatusUpdates(project.id),
      loadPartnerApplicationsForProject(project.id),
      loadPartnerCheckInsForProject(project.id),
      loadPartnerReportsForProject(project.id),
      loadImpactReportsForProject(project.id),
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
    setProjectDraft(createEmptyProjectDraft(partners[0]?.id || ''));
    setShowProjectModal(true);
  };

  // Closes the project editor and clears edit mode so the main screen is shown again.
  const closeProjectModal = () => {
    setShowProjectModal(false);
    setEditingProjectId(null);
  };

  // Opens the project modal in edit mode using the selected project values.
  const openEditProjectModal = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectDraft({
      id: project.id,
      title: project.title,
      description: project.description,
      programModule: getProjectDraftModule(project),
      status: project.status,
      partnerId: project.partnerId,
      startDate: project.startDate.slice(0, 10),
      endDate: project.endDate.slice(0, 10),
      address: project.location.address,
      latitude: String(project.location.latitude),
      longitude: String(project.location.longitude),
      volunteersNeeded: String(project.volunteersNeeded),
      isEvent: !!project.isEvent,
    });
    setShowProjectModal(true);
  };

  // Updates a single project draft field without replacing the entire object.
  const handleProjectDraftChange = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => {
    setProjectDraft(current => ({ ...current, [key]: value }));
  };

  const handleTaskDraftChange = <K extends keyof ProjectTaskDraft>(
    key: K,
    value: ProjectTaskDraft[K]
  ) => {
    setTaskDraft(current => ({ ...current, [key]: value }));
  };

  const openCreateTaskModal = () => {
    setEditingTaskId(null);
    setTaskDraft(createEmptyProjectTaskDraft());
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
    });
    setShowTaskModal(true);
  };

  const closeTaskModal = () => {
    setShowTaskModal(false);
    setEditingTaskId(null);
    setTaskDraft(createEmptyProjectTaskDraft());
  };

  const getCurrentSelectedProject = (): Project | null => {
    if (!selectedProject) {
      return null;
    }

    return projects.find(project => project.id === selectedProject.id) || selectedProject;
  };

  // Opens the volunteer management route for one volunteer when available.
  const openVolunteerProfile = (volunteerId: string) => {
    navigateToAvailableRoute(navigation, 'Volunteers', { volunteerId }, {
      routeName: 'Dashboard',
    });
  };

  const visibleImpactReports = useMemo(() => {
    const latestReportByFormat = new Map<PublishedImpactReport['format'], PublishedImpactReport>();

    [...impactReports]
      .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime())
      .forEach(report => {
        if (!latestReportByFormat.has(report.format)) {
          latestReportByFormat.set(report.format, report);
        }
      });

    return Array.from(latestReportByFormat.values());
  }, [impactReports]);

  // Creates or updates a project record from the modal form.
  const handleSaveProjectRecord = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage programs.');
      return;
    }

    const latitude = Number(projectDraft.latitude);
    const longitude = Number(projectDraft.longitude);
    const volunteersNeeded = Number(projectDraft.volunteersNeeded);
    const startDateValue = new Date(projectDraft.startDate);
    const endDateValue = new Date(projectDraft.endDate);

    if (
      !projectDraft.title.trim() ||
      !projectDraft.description.trim() ||
      !projectDraft.partnerId.trim() ||
      !projectDraft.startDate.trim() ||
      !projectDraft.endDate.trim() ||
      !projectDraft.address.trim() ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude) ||
      Number.isNaN(volunteersNeeded) ||
      Number.isNaN(startDateValue.getTime()) ||
      Number.isNaN(endDateValue.getTime())
    ) {
      Alert.alert('Validation Error', 'Fill in all required project fields with valid values.');
      return;
    }

    const existingProject = editingProjectId
      ? projects.find(project => project.id === editingProjectId) || null
      : null;
    const now = new Date().toISOString();
    const savedProject: Project = {
      id: existingProject?.id || `project-${Date.now()}`,
      title: projectDraft.title.trim(),
      description: projectDraft.description.trim(),
      partnerId: projectDraft.partnerId.trim(),
      programModule: projectDraft.programModule,
      isEvent: projectDraft.isEvent,
      status: projectDraft.status,
      category: getProjectCategoryFromModule(projectDraft.programModule),
      startDate: startDateValue.toISOString(),
      endDate: endDateValue.toISOString(),
      location: {
        latitude,
        longitude,
        address: projectDraft.address.trim(),
      },
      volunteersNeeded,
      volunteers: existingProject?.volunteers || [],
      joinedUserIds: existingProject?.joinedUserIds || [],
      createdAt: existingProject?.createdAt || now,
      updatedAt: now,
      statusUpdates: existingProject?.statusUpdates || [],
      internalTasks: existingProject?.internalTasks,
    };

    try {
      await saveProject(savedProject);
      await loadProjects();
      setSelectedProject(savedProject);
      closeProjectModal();
      Alert.alert('Saved', editingProjectId ? 'Program updated.' : 'Program created.');
      await Promise.all([
        loadStatusUpdates(savedProject.id),
        loadPartnerApplicationsForProject(savedProject.id),
        loadPartnerCheckInsForProject(savedProject.id),
        loadPartnerReportsForProject(savedProject.id),
        loadImpactReportsForProject(savedProject.id),
        loadVolunteerJoinsForProject(savedProject.id),
      ]);
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to save program.')
      );
    }
  };

  // Confirms and deletes the currently edited project record.
  const handleDeleteProjectRecord = () => {
    if (!selectedProject || !isAdmin) {
      return;
    }

    Alert.alert(
      'Delete Program',
      `Delete ${selectedProject.title}? This will remove its related join records, applications, and logs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProject(selectedProject.id);
              setSelectedProject(null);
              setStatusUpdates([]);
              setPartnerApplications([]);
              setPartnerCheckIns([]);
              setPartnerReports([]);
              setImpactReports([]);
              setVolunteerJoinRecords([]);
              await loadProjects();
              Alert.alert('Deleted', 'Program removed.');
            } catch (error) {
              Alert.alert(
                getRequestErrorTitle(error),
                getRequestErrorMessage(error, 'Failed to delete program.')
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
    if (!currentSelectedProject || !updateDescription.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return;
    }

    try {
      const now = new Date().toISOString();
      const updatedProject = {
        ...currentSelectedProject,
        status: newStatus,
        updatedAt: now,
      };

      const statusUpdate: StatusUpdate = {
        id: `status-${Date.now()}`,
        projectId: currentSelectedProject.id,
        status: newStatus,
        description: updateDescription,
        updatedBy: user?.id || '',
        updatedAt: now,
      };

      await saveProject(updatedProject);
      await saveStatusUpdate(statusUpdate);

      Alert.alert('Success', 'Status update added');
      setShowStatusModal(false);
      setUpdateDescription('');
      setNewStatus('Planning');
      setSelectedProject(updatedProject);
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
    if (!isAdmin || !user?.id || !selectedProject) return;

    try {
      await reviewPartnerProjectApplication(applicationId, nextStatus, user.id);
      await Promise.all([
        loadPartnerApplicationsForProject(selectedProject.id),
        loadProjects(),
      ]);
      const refreshedProject = await getAllProjects();
      const nextSelectedProject = refreshedProject.find(project => project.id === selectedProject.id) || null;
      setSelectedProject(nextSelectedProject);
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

  const handleGenerateFinalReports = async () => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    try {
      setActionLoadingKey('generate-reports');
      await generateFinalImpactReports(selectedProject.id, user.id);
      await loadImpactReportsForProject(selectedProject.id);
      Alert.alert('Generated', 'Final PDF and Excel report files are ready to publish.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to generate the final impact reports.')
      );
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handlePublishImpactFile = async (reportId: string) => {
    if (!selectedProject) {
      return;
    }

    try {
      setActionLoadingKey(`publish-${reportId}`);
      await publishImpactReport(reportId);
      await loadImpactReportsForProject(selectedProject.id);
      Alert.alert('Published', 'The file is now available in the partner portal.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to publish the impact report.')
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
    return getProjectVolunteerEntries(project).map(entry => ({
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
    const now = new Date().toISOString();
    const taskStatus =
      taskDraft.assignedVolunteerId && taskDraft.status === 'Unassigned'
        ? 'Assigned'
        : taskDraft.status;

    const nextTask: ProjectInternalTask = {
      id: editingTaskId || `${currentSelectedProject.id}-task-${Date.now()}`,
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      category: taskDraft.category.trim(),
      priority: taskDraft.priority,
      status: taskStatus,
      assignedVolunteerId: taskDraft.assignedVolunteerId || undefined,
      assignedVolunteerName: assignedVolunteer?.name,
      createdAt:
        currentSelectedProject.internalTasks?.find(task => task.id === editingTaskId)?.createdAt || now,
      updatedAt: now,
    };

    const nextInternalTasks = editingTaskId
      ? (currentSelectedProject.internalTasks || []).map(task =>
          task.id === editingTaskId ? nextTask : task
        )
      : [...(currentSelectedProject.internalTasks || []), nextTask];

    const updatedProject: Project = {
      ...currentSelectedProject,
      internalTasks: nextInternalTasks,
      updatedAt: now,
    };

    try {
      await saveProject(updatedProject);
      setSelectedProject(updatedProject);
      closeTaskModal();
      Alert.alert('Saved', editingTaskId ? 'Internal task updated.' : 'Internal task added.');
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
              internalTasks: (currentSelectedProject.internalTasks || []).filter(task => task.id !== taskId),
              updatedAt: new Date().toISOString(),
            };

            try {
              await saveProject(updatedProject);
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
    const projectCategoryLabel = project.programModule || project.category;
    const projectDateLabel = `${format(new Date(project.startDate), 'EEE, dd MMM yyyy')} - ${format(
      new Date(project.endDate),
      'EEE, dd MMM yyyy'
    )}`;

    return (
      <TouchableOpacity
        key={project.id}
        style={[styles.card, isDesktop ? styles.cardDesktop : styles.cardMobile]}
        onPress={() => handleSelectProject(project)}
      >
        {projectImageSource ? (
          <Image
            source={projectImageSource}
            style={styles.cardImage}
            resizeMode="cover"
          />
        ) : null}

        <View style={styles.cardBody}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>{project.title}</Text>
              <Text style={styles.cardSubtitle}>{projectCategoryLabel}</Text>
            </View>
            <View style={styles.cardHeaderBadges}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getProjectStatusColor(project.status) },
                ]}
              >
                <Text style={styles.statusText}>{project.status}</Text>
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
            <View style={styles.requestNotificationBadge}>
              <MaterialIcons name="notifications-active" size={14} color="#92400e" />
              <Text style={styles.requestNotificationBadgeText}>
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
                  <Text style={styles.infoRowSubtitle}>Project schedule</Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#cbd5e1" />
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <View style={styles.infoRowLeading}>
                <View style={styles.infoIconWrap}>
                  <MaterialIcons name="location-on" size={18} color="#ef4444" />
                </View>
                <View style={styles.infoRowCopy}>
                  <Text style={styles.infoRowTitle}>{project.location.address}</Text>
                  <Text style={styles.infoRowSubtitle}>Program location</Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#cbd5e1" />
            </View>
          </View>

          <View style={styles.aboutSection}>
            <Text style={styles.aboutLabel}>About Project</Text>
            <Text style={styles.description} numberOfLines={4}>
              {project.description}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderProjectEditorModal = () => (
    <Modal
      visible={showProjectModal}
      animationType="slide"
      onRequestClose={closeProjectModal}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={closeProjectModal}>
            <MaterialIcons name="close" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {editingProjectId ? 'Edit Program' : 'Create Program'}
          </Text>
          <TouchableOpacity onPress={handleSaveProjectRecord}>
            <Text style={styles.projectModalSave}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={[styles.formRow, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="Program title"
              placeholderTextColor="#999"
              value={projectDraft.title}
              onChangeText={value => handleProjectDraftChange('title', value)}
            />
            <Text style={styles.labelRight}>Title</Text>
          </View>

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel]}
              placeholder="Program description"
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
              <TouchableOpacity
                style={[
                  styles.statusOption,
                  !projectDraft.isEvent && styles.statusOptionSelected,
                ]}
                onPress={() => handleProjectDraftChange('isEvent', false)}
              >
                <Text
                  style={[
                    styles.statusOptionText,
                    !projectDraft.isEvent && styles.statusOptionTextSelected,
                  ]}
                >
                  Program
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statusOption,
                  projectDraft.isEvent && styles.statusOptionSelected,
                ]}
                onPress={() => handleProjectDraftChange('isEvent', true)}
              >
                <Text
                  style={[
                    styles.statusOptionText,
                    projectDraft.isEvent && styles.statusOptionTextSelected,
                  ]}
                >
                  Event
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.labelRight}>Type</Text>
          </View>

          <View style={[styles.formRow, styles.formRowTop, styles.formRowReverse]}>
            <View style={[styles.statusOptions, styles.statusOptionsCard]}>
              {partners.map(partner => (
                <TouchableOpacity
                  key={partner.id}
                  style={[
                    styles.statusOption,
                    projectDraft.partnerId === partner.id && styles.statusOptionSelected,
                  ]}
                  onPress={() => handleProjectDraftChange('partnerId', partner.id)}
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      projectDraft.partnerId === partner.id && styles.statusOptionTextSelected,
                    ]}
                  >
                    {partner.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.labelRight, styles.labelTop]}>Partner</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#999"
              value={projectDraft.startDate}
              onChangeText={value => handleProjectDraftChange('startDate', value)}
            />
            <Text style={styles.labelRight}>Start Date</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#999"
              value={projectDraft.endDate}
              onChangeText={value => handleProjectDraftChange('endDate', value)}
            />
            <Text style={styles.labelRight}>End Date</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="Location address"
              placeholderTextColor="#999"
              value={projectDraft.address}
              onChangeText={value => handleProjectDraftChange('address', value)}
            />
            <Text style={styles.labelRight}>Address</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="Latitude"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              value={projectDraft.latitude}
              onChangeText={value => handleProjectDraftChange('latitude', value)}
            />
            <Text style={styles.labelRight}>Latitude</Text>
          </View>

          <View style={[styles.formRow, styles.formRowReverse]}>
            <TextInput
              style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
              placeholder="Longitude"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              value={projectDraft.longitude}
              onChangeText={value => handleProjectDraftChange('longitude', value)}
            />
            <Text style={styles.labelRight}>Longitude</Text>
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

          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSaveProjectRecord}
          >
            <Text style={styles.submitButtonText}>
              {editingProjectId ? 'Update Program' : 'Create Program'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );

  const schedulerAnchorDate = useMemo(() => {
    const requestedProjectId = route?.params?.projectId;
    const requestedProject = requestedProjectId
      ? projects.find(project => project.id === requestedProjectId)
      : null;
    const candidateDate = selectedProject?.startDate || requestedProject?.startDate || projects[0]?.startDate;
    const parsedDate = candidateDate ? new Date(candidateDate) : new Date();
    return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  }, [projects, route?.params?.projectId, selectedProject?.startDate]);

  const schedulerDays = useMemo(() => {
    const monday = getStartOfWeekMonday(schedulerAnchorDate);
    return Array.from({ length: 7 }, (_, index) => {
      return addDays(monday, index);
    });
  }, [schedulerAnchorDate]);

  const schedulerCalendarDays = useMemo(() => {
    const monday = getStartOfWeekMonday(schedulerAnchorDate);
    return Array.from({ length: 21 }, (_, index) => addDays(monday, index));
  }, [schedulerAnchorDate]);

  const schedulerCalendarWeeks = useMemo(
    () => [0, 1, 2].map(weekIndex => schedulerCalendarDays.slice(weekIndex * 7, weekIndex * 7 + 7)),
    [schedulerCalendarDays]
  );

  const schedulerCalendarWindow = useMemo(() => {
    const start = schedulerCalendarDays[0] || getStartOfWeekMonday(new Date());
    const end = schedulerCalendarDays[20] || start;
    return { start, end };
  }, [schedulerCalendarDays]);

  const schedulerWindow = useMemo(() => {
    const start = schedulerDays[0] || getStartOfWeekMonday(new Date());
    const end = schedulerDays[6] || start;
    return { start, end };
  }, [schedulerDays]);

  const visibleBoardProjects = useMemo(
    () =>
      projects
        .filter(project => {
          const startDate = new Date(project.startDate);
          const endDate = new Date(project.endDate);
          if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return false;
          }

          return isDateOverlappingRange(schedulerWindow.start, startDate, endDate)
            || isDateOverlappingRange(schedulerWindow.end, startDate, endDate)
            || isDateOverlappingRange(startDate, schedulerWindow.start, schedulerWindow.end);
        })
        .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime()),
    [projects, schedulerWindow.end, schedulerWindow.start]
  );

  const schedulerCalendarProjects = useMemo(
    () =>
      projects
        .filter(project => {
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
        .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime()),
    [projects, schedulerCalendarWindow.end, schedulerCalendarWindow.start]
  );

  const schedulerCalendarEventsByDate = useMemo(() => {
    const eventsByDate = new Map<string, Project[]>();

    schedulerCalendarDays.forEach(day => {
      const dayEvents = schedulerCalendarProjects.filter(project => {
        const startDate = new Date(project.startDate);
        const endDate = new Date(project.endDate);
        return isDateOverlappingRange(day, startDate, endDate);
      });

      eventsByDate.set(getDateKey(day), dayEvents);
    });

    return eventsByDate;
  }, [schedulerCalendarDays, schedulerCalendarProjects]);

  const schedulerRangeLabel = useMemo(() => {
    const rangeStart = schedulerCalendarDays[0] || schedulerAnchorDate;
    const rangeEnd = schedulerCalendarDays[schedulerCalendarDays.length - 1] || schedulerAnchorDate;
    return `${format(rangeStart, 'MMM d')} - ${format(rangeEnd, 'MMM d, yyyy')}`;
  }, [schedulerAnchorDate, schedulerCalendarDays]);

  const timelineCellWidth = 64;

  const activeSelectedProject = getCurrentSelectedProject();

  if (activeSelectedProject) {
    const volunteerEntries = getProjectVolunteerEntries(activeSelectedProject);
    const assignableVolunteerOptions = getAssignableVolunteerOptions(activeSelectedProject);
    const volunteerRequestEntries = getProjectVolunteerRequestEntries();
    const pendingPartnerApplications = partnerApplications.filter(
      application => application.status === 'Pending',
    );
    const approvedPartnerApplications = partnerApplications.filter(
      application => application.status === 'Approved',
    );
    const rejectedPartnerApplications = partnerApplications.filter(
      application => application.status === 'Rejected',
    );
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
      partners.find(partner => partner.id === activeSelectedProject.partnerId)?.name || activeSelectedProject.partnerId;
    const pendingPartnerRequests = pendingPartnerApplications.length;
    const internalTasks = activeSelectedProject.internalTasks || [];

    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedProject(null)}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Project Details</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailsHero}>
            <View style={styles.detailsHeroHeader}>
              <View style={styles.detailsHeroCopy}>
                <Text style={styles.detailsEyebrow}>
                  {activeSelectedProject.isEvent ? 'Event Workspace' : 'Program Workspace'}
                </Text>
                <Text style={styles.detailsTitle}>{activeSelectedProject.title}</Text>
                <Text style={styles.detailsSubtitle}>{activeSelectedProject.description}</Text>
              </View>
              <View
                style={[
                  styles.detailsHeroStatus,
                  { backgroundColor: getProjectStatusColor(activeSelectedProject.status) },
                ]}
              >
                <Text style={styles.statusText}>{activeSelectedProject.status}</Text>
              </View>
            </View>

            <View style={styles.detailsQuickGrid}>
              <View style={styles.detailsQuickCard}>
                <Text style={styles.detailsQuickLabel}>Program Module</Text>
                <Text style={styles.detailsQuickValue}>
                  {activeSelectedProject.programModule || activeSelectedProject.category}
                </Text>
              </View>
              <View style={styles.detailsQuickCard}>
                <Text style={styles.detailsQuickLabel}>Assigned Partner</Text>
                <Text style={styles.detailsQuickValue}>{selectedPartnerName}</Text>
              </View>
              <View style={styles.detailsQuickCard}>
                <Text style={styles.detailsQuickLabel}>Volunteer Slots</Text>
                <Text style={styles.detailsQuickValue}>
                  {activeSelectedProject.volunteers.length}/{activeSelectedProject.volunteersNeeded}
                </Text>
              </View>
              <View style={styles.detailsQuickCard}>
                <Text style={styles.detailsQuickLabel}>Pending Program Proposals</Text>
                <Text style={styles.detailsQuickValue}>{pendingPartnerRequests}</Text>
              </View>
              <View style={styles.detailsQuickCard}>
                <Text style={styles.detailsQuickLabel}>Start Date</Text>
                <Text style={styles.detailsQuickValue}>
                  {format(new Date(activeSelectedProject.startDate), 'PPP')}
                </Text>
              </View>
              <View style={styles.detailsQuickCard}>
                <Text style={styles.detailsQuickLabel}>End Date</Text>
                <Text style={styles.detailsQuickValue}>
                  {format(new Date(activeSelectedProject.endDate), 'PPP')}
                </Text>
              </View>
            </View>
          </View>

          {isAdmin && (
            <View style={styles.detailsActionRow}>
              <TouchableOpacity
                style={[styles.detailsActionButton, Boolean(actionLoadingKey) && styles.detailsActionButtonDisabled]}
                onPress={() => openEditProjectModal(activeSelectedProject)}
                disabled={Boolean(actionLoadingKey)}
              >
                <MaterialIcons name="edit" size={18} color="#166534" />
                <Text style={styles.detailsActionButtonText}>Edit Program</Text>
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
                <Text style={styles.detailsDeleteButtonText}>Delete</Text>
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
            <Text style={styles.sectionTitle}>Program Setup</Text>
            <Text style={styles.sectionHint}>Core project information for admin review.</Text>
            <View style={styles.detailField}>
              <Text style={styles.detailFieldLabel}>Project Type</Text>
              <Text style={styles.detailFieldValue}>{activeSelectedProject.isEvent ? 'Event' : 'Program'}</Text>
            </View>
            <View style={styles.detailField}>
              <Text style={styles.detailFieldLabel}>Program Module</Text>
              <Text style={styles.detailFieldValue}>
                {activeSelectedProject.programModule || activeSelectedProject.category}
              </Text>
            </View>
            <View style={styles.detailField}>
              <Text style={styles.detailFieldLabel}>Assigned Partner</Text>
              <Text style={styles.detailFieldValue}>{selectedPartnerName}</Text>
            </View>
          </View>

          <View style={[styles.detailsSection, styles.detailsSectionCard]}>
            <Text style={styles.sectionTitle}>Schedule and Capacity</Text>
            <Text style={styles.sectionHint}>Quick schedule and staffing snapshot.</Text>
            <View style={styles.detailField}>
              <Text style={styles.detailFieldLabel}>Start Date</Text>
              <Text style={styles.detailFieldValue}>
                {format(new Date(activeSelectedProject.startDate), 'PPP')}
              </Text>
            </View>
            <View style={styles.detailField}>
              <Text style={styles.detailFieldLabel}>End Date</Text>
              <Text style={styles.detailFieldValue}>
                {format(new Date(activeSelectedProject.endDate), 'PPP')}
              </Text>
            </View>
            <View style={styles.detailField}>
              <Text style={styles.detailFieldLabel}>Volunteer Slots</Text>
              <Text style={styles.detailFieldValue}>
                {activeSelectedProject.volunteers.length}/{activeSelectedProject.volunteersNeeded}
              </Text>
            </View>
          </View>

          <View style={styles.detailsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Internal Task Board</Text>
              {isAdmin && (
                <TouchableOpacity style={styles.addButton} onPress={openCreateTaskModal}>
                  <MaterialIcons name="add-task" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.sectionHint}>
              Admin can add internal tasks and assign them to joined volunteers. Starter tasks are generated per project.
            </Text>

            {internalTasks.length === 0 ? (
              <Text style={styles.emptyText}>No internal tasks added yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {internalTasks.map(task => (
                  <View key={task.id} style={styles.taskCard}>
                    <View style={styles.taskCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.taskTitle}>{task.title}</Text>
                        <Text style={styles.taskMeta}>
                          {task.category} â€¢ {task.priority} Priority
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

                    <Text style={styles.taskDescription}>{task.description}</Text>
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

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Pending Program Proposals</Text>

            {pendingPartnerApplications.length === 0 ? (
              <Text style={styles.emptyText}>No pending program proposals right now</Text>
            ) : (
              <View style={styles.updatesList}>
                {pendingPartnerApplications.map(application => (
                  <View key={application.id} style={styles.applicationCard}>
                    <View style={styles.applicationHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicationName}>{application.partnerName}</Text>
                        <Text style={styles.applicationMeta}>{application.partnerEmail}</Text>
                        <Text style={styles.applicationMeta}>
                          Requested {format(new Date(application.requestedAt), 'PPpp')}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.applicationStatusBadge,
                          styles.applicationStatusPending,
                        ]}
                      >
                        <Text style={styles.applicationStatusText}>{application.status}</Text>
                      </View>
                    </View>

                    {isAdmin && (
                      <View style={styles.applicationActions}>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.approveButton]}
                          onPress={() => handleReviewPartnerApplication(application.id, 'Approved')}
                        >
                          <Text style={styles.applicationButtonText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.rejectButton]}
                          onPress={() => handleReviewPartnerApplication(application.id, 'Rejected')}
                        >
                          <Text style={styles.applicationButtonText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Approved Proposals</Text>

            {approvedPartnerApplications.length === 0 ? (
              <Text style={styles.emptyText}>No approved proposals yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {approvedPartnerApplications.map(application => (
                  <View key={application.id} style={styles.applicationCard}>
                    <View style={styles.applicationHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicationName}>{application.partnerName}</Text>
                        <Text style={styles.applicationMeta}>{application.partnerEmail}</Text>
                        <Text style={styles.applicationMeta}>
                          Requested {format(new Date(application.requestedAt), 'PPpp')}
                        </Text>
                        {application.reviewedAt ? (
                          <Text style={styles.applicationMeta}>
                            Approved {format(new Date(application.reviewedAt), 'PPpp')}
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={[
                          styles.applicationStatusBadge,
                          styles.applicationStatusApproved,
                        ]}
                      >
                        <Text style={styles.applicationStatusText}>Approved</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Rejected Proposals</Text>

            {rejectedPartnerApplications.length === 0 ? (
              <Text style={styles.emptyText}>No rejected proposals</Text>
            ) : (
              <View style={styles.updatesList}>
                {rejectedPartnerApplications.map(application => (
                  <View key={application.id} style={styles.applicationCard}>
                    <View style={styles.applicationHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicationName}>{application.partnerName}</Text>
                        <Text style={styles.applicationMeta}>{application.partnerEmail}</Text>
                        <Text style={styles.applicationMeta}>
                          Requested {format(new Date(application.requestedAt), 'PPpp')}
                        </Text>
                        {application.reviewedAt ? (
                          <Text style={styles.applicationMeta}>
                            Rejected {format(new Date(application.reviewedAt), 'PPpp')}
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
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Project Time Tracking</Text>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>Time Ins:</Text>
              <Text style={styles.timelineValue}>{projectTimeInCount}</Text>
            </View>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>Time Outs:</Text>
              <Text style={styles.timelineValue}>{projectTimeOutCount}</Text>
            </View>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>Latest Time Activity:</Text>
              <Text style={styles.timelineValue}>
                {projectTimeLogEntries[0]
                  ? projectTimeLogEntries[0].timeOut
                    ? `Time Out ${format(new Date(projectTimeLogEntries[0].timeOut), 'PPpp')}`
                    : `Time In ${format(new Date(projectTimeLogEntries[0].timeIn), 'PPpp')}`
                  : 'No time logs yet'}
              </Text>
            </View>

            <Text style={styles.timelineLabel}>Volunteer Time Logs</Text>
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

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>
              Pending Volunteer Join Requests ({pendingVolunteerRequestEntries.length})
            </Text>

            {pendingVolunteerRequestEntries.length === 0 ? (
              <Text style={styles.emptyText}>No pending volunteer join requests</Text>
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

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>
              Rejected Volunteer Join Requests ({rejectedVolunteerRequestEntries.length})
            </Text>

            {rejectedVolunteerRequestEntries.length === 0 ? (
              <Text style={styles.emptyText}>No rejected volunteer join requests</Text>
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

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>
              Volunteer Participants ({volunteerEntries.length})
            </Text>

            {volunteerEntries.length === 0 ? (
              <Text style={styles.emptyText}>No volunteers have joined this project yet</Text>
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

          <View style={styles.detailsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Impact Hub</Text>
              {isAdmin && (
                <TouchableOpacity
                  style={[
                    styles.addButton,
                    actionLoadingKey === 'generate-reports' && styles.addButtonDisabled,
                  ]}
                  onPress={handleGenerateFinalReports}
                  disabled={Boolean(actionLoadingKey)}
                >
                  {actionLoadingKey === 'generate-reports' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialIcons name="description" size={18} color="#fff" />
                  )}
                </TouchableOpacity>
              )}
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
                          {report.reportType} â€¢ Impact {report.impactCount}
                        </Text>
                        <Text style={styles.applicationMeta}>
                          Submitted by {report.submitterName || report.partnerName || 'User'}
                        </Text>
                        <Text style={styles.applicationMeta}>{report.description}</Text>
                        <Text style={styles.applicationMeta}>
                          Uploaded {format(new Date(report.createdAt), 'PPpp')}
                        </Text>
                        {report.mediaFile ? (
                          isImageMediaUri(report.mediaFile) ? (
                            <Image
                              source={{ uri: report.mediaFile }}
                              style={styles.reportImagePreview}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={styles.applicationMeta}>Media: {report.mediaFile}</Text>
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

            <Text style={styles.timelineLabel}>Generated Final Reports</Text>
            {visibleImpactReports.length === 0 ? (
              <Text style={styles.emptyText}>No final report files generated yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {visibleImpactReports.map(report => (
                  <View key={report.id} style={styles.applicationCard}>
                    <View style={styles.applicationHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicationName}>{report.reportFile}</Text>
                        <Text style={styles.applicationMeta}>
                          {report.format} â€¢ Generated {format(new Date(report.generatedAt), 'PPpp')}
                        </Text>
                        <Text style={styles.applicationMeta}>
                          {report.publishedAt
                            ? `Published ${format(new Date(report.publishedAt), 'PPpp')}`
                            : 'Not published to partner portal yet'}
                        </Text>
                      </View>
                    </View>

                    {isAdmin && !report.publishedAt ? (
                      <View style={styles.applicationActions}>
                        <TouchableOpacity
                          style={[
                            styles.applicationButton,
                            styles.approveButton,
                            actionLoadingKey === `publish-${report.id}` && styles.applicationButtonDisabled,
                          ]}
                          onPress={() => handlePublishImpactFile(report.id)}
                          disabled={Boolean(actionLoadingKey)}
                        >
                          {actionLoadingKey === `publish-${report.id}` ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={styles.applicationButtonText}>Publish to Partner Portal</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.detailsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Status Updates</Text>
              {isAdmin && (
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setShowStatusModal(true)}
                >
                  <MaterialIcons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

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
                      <Text style={styles.updateStatus}>{update.status}</Text>
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
                <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                  <TouchableOpacity
                    style={[
                      styles.statusOption,
                      taskDraft.assignedVolunteerId === '' && styles.statusOptionSelected,
                    ]}
                    onPress={() => handleTaskDraftChange('assignedVolunteerId', '')}
                  >
                    <Text
                      style={[
                        styles.statusOptionText,
                        taskDraft.assignedVolunteerId === '' && styles.statusOptionTextSelected,
                      ]}
                    >
                      Unassigned
                    </Text>
                  </TouchableOpacity>
                  {assignableVolunteerOptions.map(volunteerOption => (
                    <TouchableOpacity
                      key={volunteerOption.id}
                      style={[
                        styles.statusOption,
                        taskDraft.assignedVolunteerId === volunteerOption.id &&
                          styles.statusOptionSelected,
                      ]}
                      onPress={() =>
                        handleTaskDraftChange('assignedVolunteerId', volunteerOption.id)
                      }
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          taskDraft.assignedVolunteerId === volunteerOption.id &&
                            styles.statusOptionTextSelected,
                        ]}
                      >
                        {volunteerOption.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.labelRight, styles.labelTop]}>Assign To</Text>
              </View>

              {assignableVolunteerOptions.length === 0 ? (
                <Text style={styles.helperText}>
                  No volunteers have joined this project yet. You can still create the task and assign it later.
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
              <Text style={styles.modalTitle}>Add Status Update</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
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

              <View style={[styles.formRow, styles.formRowTop]}>
                <TextInput
                  style={[styles.textArea, styles.inputWithLabel]}
                  placeholder="Describe the status update..."
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
        {renderProjectEditorModal()}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.lifecycleHero}>
        <View style={styles.lifecycleHeroCopy}>
          <Text style={styles.lifecycleEyebrow}>Lifecycle workspace</Text>
          <Text style={styles.title}>Project Management Suite</Text>
          <Text style={styles.listSubtitle}>
            Track programs, events, volunteers, and approvals in one responsive command center.
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
          <Text style={styles.lifecycleStatValue}>{projects.length}</Text>
          <Text style={styles.lifecycleStatLabel}>Programs</Text>
        </View>
        <View style={styles.lifecycleStatPill}>
          <Text style={styles.lifecycleStatValue}>{projects.filter(project => project.status === 'In Progress').length}</Text>
          <Text style={styles.lifecycleStatLabel}>In progress</Text>
        </View>
        <View style={styles.lifecycleStatPill}>
          <Text style={styles.lifecycleStatValue}>{projects.filter(project => project.status === 'Planning').length}</Text>
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
        <View style={styles.lifecycleBoardCard}>
          <View style={styles.lifecycleBoardHeader}>
            <View>
              <Text style={styles.lifecycleBoardTitle}>Project Scheduler</Text>
              <Text style={styles.lifecycleBoardMeta}>Tap a program or event to open its lifecycle view.</Text>
            </View>
            <View style={styles.lifecycleBoardTabs}>
              <TouchableOpacity
                style={[styles.lifecycleBoardTab, lifecycleView === 'scheduler' && styles.lifecycleBoardTabActive]}
                onPress={() => setLifecycleView('scheduler')}
                activeOpacity={0.85}
              >
                <Text style={[styles.lifecycleBoardTabText, lifecycleView === 'scheduler' && styles.lifecycleBoardTabTextActive]}>Scheduler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.lifecycleBoardTab, lifecycleView === 'timeline' && styles.lifecycleBoardTabActive]}
                onPress={() => setLifecycleView('timeline')}
                activeOpacity={0.85}
              >
                <Text style={[styles.lifecycleBoardTabText, lifecycleView === 'timeline' && styles.lifecycleBoardTabTextActive]}>Timeline</Text>
              </TouchableOpacity>
            </View>
          </View>

          {lifecycleView === 'scheduler' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.schedulerCalendarWrap}>
                <View style={styles.schedulerCalendarTopRow}>
                  <Text style={styles.schedulerCalendarRange}>{schedulerRangeLabel}</Text>
                  <Text style={styles.schedulerCalendarHint}>3-week view</Text>
                </View>

                <View style={styles.schedulerCalendarHeaderRow}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(dayLabel => (
                    <Text key={dayLabel} style={styles.schedulerCalendarHeaderCell}>{dayLabel}</Text>
                  ))}
                </View>

                {schedulerCalendarWeeks.map((week, weekIndex) => (
                  <View key={`scheduler-week-${weekIndex}`} style={styles.schedulerCalendarWeekRow}>
                    {week.map(day => {
                      const dayProjects = schedulerCalendarEventsByDate.get(getDateKey(day)) || [];
                      return (
                        <View key={day.toISOString()} style={styles.schedulerCalendarDayCell}>
                          <Text style={styles.schedulerCalendarDayDate}>{format(day, 'd')}</Text>

                          {dayProjects.length ? (
                            <>
                              {dayProjects.slice(0, 3).map(project => (
                                <TouchableOpacity
                                  key={`${project.id}-${day.toISOString()}`}
                                  style={[
                                    styles.schedulerCalendarEvent,
                                    { backgroundColor: getProjectStatusColor(project.status) },
                                  ]}
                                  onPress={() => {
                                    void handleSelectProject(project);
                                  }}
                                  activeOpacity={0.85}
                                >
                                  <Text style={styles.schedulerCalendarEventText} numberOfLines={1}>
                                    {project.title}
                                  </Text>
                                </TouchableOpacity>
                              ))}

                              {dayProjects.length > 3 ? (
                                <Text style={styles.schedulerCalendarMoreText}>+{dayProjects.length - 3} more</Text>
                              ) : null}
                            </>
                          ) : (
                            <Text style={styles.schedulerCalendarEmpty}>No events</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.timelineBoard}>
              {visibleBoardProjects.length ? visibleBoardProjects.slice(0, 8).map(project => (
                <TouchableOpacity
                  key={`timeline-${project.id}`}
                  style={styles.timelineProjectRow}
                  onPress={() => { void handleSelectProject(project); }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.timelineProjectName} numberOfLines={1}>{project.title}</Text>
                  <View style={styles.timelineTrack}>
                    <View style={[styles.timelineBar, { backgroundColor: getProjectStatusColor(project.status) }]} />
                  </View>
                  <Text style={styles.timelineDateRange}>{format(new Date(project.startDate), 'MMM d')} - {format(new Date(project.endDate), 'MMM d')}</Text>
                </TouchableOpacity>
              )) : <Text style={styles.schedulerEmptyText}>No projects scheduled in this week.</Text>}
            </View>
          )}
        </View>
      ) : null}
      {!loadError && projects.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="folder-open" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No initiatives found</Text>
        </View>
      ) : (
        <View style={styles.list}>{projects.map(renderProjectCard)}</View>
      )}

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerSpacer: {
    width: 24,
    height: 24,
  },  lifecycleHero: {
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
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 4,
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
    flexBasis: '31.7%',
    maxWidth: '31.7%',
  },
  cardMobile: {
    flexBasis: '100%',
    maxWidth: '100%',
  },
  cardImage: {
    width: '100%',
    height: 160,
    backgroundColor: '#dbe4ea',
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  cardHeaderCopy: {
    flex: 1,
  },
  cardHeaderBadges: {
    alignItems: 'flex-end',
    gap: 10,
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    color: '#1f2544',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
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
    gap: 16,
    alignItems: 'stretch',
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
    borderRadius: 6,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  detailsHero: {
    backgroundColor: '#f8fff9',
    borderWidth: 1,
    borderColor: '#d1fae5',
    borderRadius: 6,
    padding: 18,
    marginBottom: 22,
  },
  detailsHeroHeader: {
    gap: 12,
    marginBottom: 18,
  },
  detailsHeroCopy: {
    gap: 8,
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
    minWidth: 170,
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: '#ffffff',
    borderRadius: 6,
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
    borderRadius: 6,
    paddingHorizontal: 12,
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
    borderRadius: 6,
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
    marginVertical: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  detailsSectionCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 6,
    padding: 18,
    marginVertical: 12,
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
  detailField: {
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
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
    borderRadius: 6,
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
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
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
    borderRadius: 6,
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
    minWidth: 980,
  },
  schedulerCalendarTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  schedulerCalendarRange: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1f2937',
  },
  schedulerCalendarHint: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  schedulerCalendarHeaderRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderBottomWidth: 0,
  },
  schedulerCalendarHeaderCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderRightWidth: 1,
    borderRightColor: '#dbeafe',
  },
  schedulerCalendarWeekRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderTopWidth: 0,
  },
  schedulerCalendarDayCell: {
    flex: 1,
    minHeight: 160,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
    borderRightWidth: 1,
    borderRightColor: '#dbeafe',
    backgroundColor: '#ffffff',
  },
  schedulerCalendarDayDate: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 6,
  },
  schedulerCalendarEvent: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 5,
    marginBottom: 6,
  },
  schedulerCalendarEventText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  schedulerCalendarMoreText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 2,
  },
  schedulerCalendarEmpty: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4,
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
});






