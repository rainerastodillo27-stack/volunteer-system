import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import ModernTheme from '../utils/modernTheme';
import { Alert, Modal, StyleSheet, FlatList, View, Text, ScrollView, TouchableOpacity, Platform, Animated } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllPartnerReports,
  getAllProjects,
  getProjectsScreenSnapshot,
  getAllVolunteers,
  getAllVolunteerTimeLogs,
  getAllVolunteerProjectJoinRecords,
  submitFieldReport,
  getImpactHubReportsByUser,
  submitImpactHubReport,
  reviewPartnerReport,
  subscribeToStorageChanges,
  savePartnerReport,
} from '../models/storage';
import type {
  ImpactHubReportType,
  PartnerProjectApplication,
  PartnerReport,
  Project,
  Volunteer,
  UserRole,
  VolunteerProjectJoinRecord,
  VolunteerTimeLog,
} from '../models/types';
import ReportUploadModal from '../components/ReportUploadModal';
import ReportDetailsModal from '../components/ReportDetailsModal';
import VolunteerReportsDashboard, {
  PartnerReportsDashboard,
} from '../components/VolunteerReportsDashboard';
import AllReportsView from '../components/AllReportsView';

export interface SubmittedReport {
  id: string;
  submittedBy: string;
  submitterName: string;
  submitterRole: UserRole;
  reportType: string;
  title: string;
  description: string;
  projectId?: string;
  projectTitle?: string;
  projectKind?: 'event' | 'project';
  category?: string;
  metrics: {
    volunteerHours?: number;
    volunteerEventJoins?: number;
    verifiedAttendance?: number;
    activeVolunteers?: number;
    beneficiariesServed?: number;
    tasksCompleted?: number;
    eventsCount?: number;
    geofenceCompliance?: number;
    dataStorageVolume?: number;
    [key: string]: number | undefined;
  };
  attachments?: {
    url: string;
    type: 'image' | 'video' | 'document' | 'media';
    description?: string;
  }[];
  mediaFile?: string;
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected';
  submittedAt: string;
  approvalNotes?: string;
  approvedBy?: string;
  approvedAt?: string;
  viewedBy?: string[];
  collaborationFeedback?: string;
  volunteerPraise?: string;
  gratitudeNote?: string;
}

export interface PartnerVolunteerAccountSummary {
  key: string;
  submitterName: string;
  reports: SubmittedReport[];
  volunteerEventJoins: number;
  verifiedAttendance: number;
  beneficiariesServed: number;
  latestActivityAt?: string;
}

export interface PartnerProjectReportSummary {
  project: Project;
  linkedEvents: Project[];
  metrics: SubmittedReport['metrics'];
  partnerReports: SubmittedReport[];
  volunteerAccounts: PartnerVolunteerAccountSummary[];
  generatedTitle: string;
}

function friendlyEventFallbackTitle(projectId: string | undefined, isEvent: boolean): string {
  if (!projectId) return 'Unlinked Activity';

  // Try to extract a readable name from structured IDs
  // e.g. "project-sample-nutrition-event-1" → "Nutrition Event"
  const sampleMatch = projectId.match(/project-sample-(\w+)-event/);
  if (sampleMatch) {
    const word = sampleMatch[1];
    return `${word.charAt(0).toUpperCase()}${word.slice(1)} Event`;
  }

  if (isEvent) {
    return `Unlisted Event (${projectId})`;
  }

  return `Unlisted Project (${projectId})`;
}

function parseBeneficiariesFromNarrative(description: string | undefined): number | undefined {
  const match = String(description || '').match(
    /\bbeneficiaries\s+(?:reached|served|assisted)\s*:\s*(\d+(?:\.\d+)?)/i
  );
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeImpactHubReport(
  report: PartnerReport,
  projects: Project[]
): SubmittedReport {
  const normalizedProjectId = String(report.projectId || '').trim();
  const normalizedSubmitterRole = String(report.submitterRole || 'partner').trim().toLowerCase() as UserRole;
  const linkedProject = projects.find(
    project => String(project.id || '').trim() === normalizedProjectId
  );

  const isEvent = linkedProject
    ? Boolean(linkedProject.isEvent)
    : Boolean(
        normalizedProjectId.startsWith('event-') ||
        normalizedProjectId.includes('-event-') ||
        normalizedSubmitterRole === 'volunteer' ||
        report.reportType === 'field_report'
      );

  const rawMetrics =
    report.metrics && typeof report.metrics === 'object' ? report.metrics : {};
  const metrics: Record<string, number> = {};
  for (const [key, val] of Object.entries(rawMetrics)) {
    const numVal = typeof val === 'number' ? val : Number(val) || 0;
    if (
      key === 'beneficiaries' ||
      key === 'beneficiaries_served' ||
      key === 'beneficiariesServed' ||
      key === 'beneficiaries_assisted' ||
      key === 'beneficiariesAssisted' ||
      key === 'beneficiaries_reached' ||
      key === 'beneficiariesReached'
    ) {
      metrics.beneficiariesServed = numVal;
    } else if (key === 'volunteer_hours' || key === 'volunteerHours') {
      metrics.volunteerHours = numVal;
    } else if (key === 'tasks_completed' || key === 'tasksCompleted') {
      metrics.tasksCompleted = numVal;
    } else if (key === 'volunteer_event_joins' || key === 'volunteerEventJoins') {
      metrics.volunteerEventJoins = numVal;
    } else {
      metrics[key] = numVal;
    }
  }

  // Older field reports may have persisted the beneficiary count only in the
  // volunteer narrative. Recover it for the admin/partner details view while
  // preserving an explicitly stored zero or any other metric value.
  if (
    metrics.beneficiariesServed === undefined &&
    (report.reportType === 'field_report' || normalizedSubmitterRole === 'volunteer')
  ) {
    const narrativeValue = parseBeneficiariesFromNarrative(report.description);
    if (narrativeValue !== undefined) {
      metrics.beneficiariesServed = narrativeValue;
    } else {
      const impactCount = Number(report.impactCount);
      if (Number.isFinite(impactCount) && impactCount > 0) {
        metrics.beneficiariesServed = impactCount;
      }
    }
  }

  return {
    id: report.id,
    submittedBy: report.submitterUserId || report.partnerUserId || '',
    submitterName: report.submitterName || report.partnerName || 'User',
    submitterRole: normalizedSubmitterRole,
    reportType: report.reportType || 'program_impact',
    title: report.title || `${report.submitterName || report.partnerName || 'User'} Report`,
    description: report.description || '',
    projectId: normalizedProjectId || undefined,
    projectTitle: linkedProject?.title || friendlyEventFallbackTitle(normalizedProjectId, isEvent),
    projectKind: isEvent ? 'event' : 'project',
    category: linkedProject?.category,
    metrics,
    attachments: report.attachments || [],
    mediaFile: report.mediaFile,
    status:
      report.status === 'Reviewed'
        ? 'Approved'
        : report.status === 'Rejected'
        ? 'Rejected'
        : 'Submitted',
    submittedAt: report.createdAt,
    approvalNotes: report.reviewNotes,
    approvedBy: report.reviewedBy,
    approvedAt: report.reviewedAt,
    viewedBy: report.viewedBy || [],
    collaborationFeedback: report.collaborationFeedback,
    volunteerPraise: report.volunteerPraise,
    gratitudeNote: report.gratitudeNote,
  };
}

function shouldDisplayReport(report: SubmittedReport): boolean {
  return report.status !== 'Rejected';
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

function buildPartnerProjectSummaries(
  partnerUserId: string | undefined,
  projects: Project[],
  reports: SubmittedReport[],
  volunteers: Volunteer[],
  partnerApplications: PartnerProjectApplication[],
  volunteerTimeLogs: VolunteerTimeLog[],
  volunteerJoinRecords: VolunteerProjectJoinRecord[]
): PartnerProjectReportSummary[] {
  if (!partnerUserId && partnerApplications.length === 0) {
    return [];
  }

  const approvedProjectIds = new Set(
    partnerApplications
      .filter(
        application =>
          application.status === 'Approved' &&
          Boolean(application.projectId) &&
          !String(application.projectId).startsWith('program:')
      )
      .map(application => String(application.projectId || '').trim())
      .filter(Boolean)
  );

  // Also collect approved program modules so we can match projects by programModule
  // when the application projectId is still a 'program:' placeholder (stale cache).
  const approvedProgramModules = new Set(
    partnerApplications
      .filter(application => application.status === 'Approved')
      .map(application => {
        const pid = String(application.projectId || '');
        if (pid.startsWith('program:')) {
          return pid.slice('program:'.length).trim();
        }
        return (
          application.proposalDetails?.requestedProgramModule ||
          ''
        );
      })
      .filter(Boolean)
  );

  const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));

  return projects
    .filter(project => {
      if (project.isEvent) return false;
      // Match by direct project ID (normal case after approval)
      if (approvedProjectIds.has(project.id)) return true;
      // Match by programModule (fallback when cache has stale program: IDs)
      if (project.programModule && approvedProgramModules.has(project.programModule)) return true;
      // Match proposal-created projects by ID prefix
      if (String(project.id).startsWith('project-proposal-') && approvedProgramModules.has(project.category || '')) return true;
      return false;
    })
    .map(project => {
      const linkedEvents = projects.filter(
        candidate =>
          candidate.isEvent &&
          String(candidate.parentProjectId || '').trim() === String(project.id || '').trim()
      );
      const linkedEventIds = new Set(linkedEvents.map(event => event.id));
      const partnerReports = reports
        .filter(
          report =>
            shouldDisplayReport(report) &&
            report.submitterRole === 'partner' &&
            (!partnerUserId || report.submittedBy === partnerUserId) &&
            String(report.projectId || '').trim() === String(project.id || '').trim()
        )
        .sort(
          (left, right) =>
            new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
        );
      const volunteerReports = reports
        .filter(
          report =>
            shouldDisplayReport(report) &&
            report.submitterRole === 'volunteer' &&
            linkedEventIds.has(String(report.projectId || ''))
        )
        .sort(
          (left, right) =>
            new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
        );
      const relatedCheckedAttendanceLogs = volunteerTimeLogs.filter(
        log => linkedEventIds.has(log.projectId) && Boolean(log.attendanceCheckedAt)
      );
      const relatedEventJoinRecords = volunteerJoinRecords.filter(record =>
        linkedEventIds.has(record.projectId)
      );

      const volunteerAccountsMap = new Map<string, PartnerVolunteerAccountSummary>();

      const ensureVolunteerAccount = (key: string, submitterName: string) => {
        const existing = volunteerAccountsMap.get(key);
        if (existing) {
          return existing;
        }

        const created: PartnerVolunteerAccountSummary = {
          key,
          submitterName,
          reports: [],
          volunteerEventJoins: 0,
          verifiedAttendance: 0,
          beneficiariesServed: 0,
        };
        volunteerAccountsMap.set(key, created);
        return created;
      };

      relatedEventJoinRecords.forEach(record => {
        const volunteer = volunteerById.get(record.volunteerId);
        const accountKey =
          record.volunteerUserId ||
          volunteer?.userId ||
          `volunteer:${record.volunteerId || record.id}`;
        const account = ensureVolunteerAccount(
          accountKey,
          record.volunteerName || volunteer?.name || 'Volunteer'
        );
        account.volunteerEventJoins += 1;
        if (
          record.joinedAt &&
          (!account.latestActivityAt ||
            new Date(record.joinedAt).getTime() > new Date(account.latestActivityAt).getTime())
        ) {
          account.latestActivityAt = record.joinedAt;
        }
      });

      relatedCheckedAttendanceLogs.forEach(log => {
        const volunteer = volunteerById.get(log.volunteerId);
        const accountKey = volunteer?.userId || `volunteer:${log.volunteerId}`;
        const account = ensureVolunteerAccount(accountKey, volunteer?.name || 'Volunteer');
        account.verifiedAttendance += 1;
        const latestLogTime = log.attendanceCheckedAt || log.timeOut || log.timeIn;
        if (
          latestLogTime &&
          (!account.latestActivityAt ||
            new Date(latestLogTime).getTime() > new Date(account.latestActivityAt).getTime())
        ) {
          account.latestActivityAt = latestLogTime;
        }
      });

      volunteerReports.forEach(report => {
        const accountKey = report.submittedBy || `report:${report.id}`;
        const account = ensureVolunteerAccount(accountKey, report.submitterName || 'Volunteer');
        account.reports.push(report);
        account.beneficiariesServed += report.metrics.beneficiariesServed || 0;
        if (
          !account.latestActivityAt ||
          new Date(report.submittedAt).getTime() > new Date(account.latestActivityAt).getTime()
        ) {
          account.latestActivityAt = report.submittedAt;
        }
      });

      const volunteerAccounts = Array.from(volunteerAccountsMap.values())
        .map(account => ({
          ...account,
          reports: [...account.reports].sort(
            (left, right) =>
              new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
          ),
        }))
        .sort((left, right) => {
          const leftTime = left.latestActivityAt ? new Date(left.latestActivityAt).getTime() : 0;
          const rightTime = right.latestActivityAt ? new Date(right.latestActivityAt).getTime() : 0;
          return rightTime - leftTime;
        });

      const metrics: SubmittedReport['metrics'] = {
        activeVolunteers: volunteerAccounts.length,
        volunteerEventJoins: relatedEventJoinRecords.length,
        verifiedAttendance: relatedCheckedAttendanceLogs.length,
        beneficiariesServed: volunteerReports.reduce(
          (sum, report) => sum + (report.metrics.beneficiariesServed || 0),
          0
        ),
        eventsCount: linkedEvents.length,
      };

      return {
        project,
        linkedEvents: linkedEvents.sort(
          (left, right) =>
            new Date(left.startDate).getTime() - new Date(right.startDate).getTime()
        ),
        metrics,
        partnerReports,
        volunteerAccounts,
        generatedTitle: `${project.title} Partner Impact Report`,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.project.updatedAt || right.project.createdAt).getTime() -
        new Date(left.project.updatedAt || left.project.createdAt).getTime()
    );
}

export default function ReportsScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const [reports, setReports] = useState<SubmittedReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<SubmittedReport | null>(null);
  const [uploadModalInitialValues, setUploadModalInitialValues] = useState<{
    projectId?: string;
    completionReport?: string;
    completionPhoto?: string;
  } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [volunteerProfileId, setVolunteerProfileId] = useState<string | null>(null);
  const [volunteerTimedInProjectIds, setVolunteerTimedInProjectIds] = useState<string[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [selectedReportType, setSelectedReportType] = useState<'all' | 'volunteer' | 'partner' | null>(null);
  const [showFilteredReports, setShowFilteredReports] = useState(false);
  const [activeTopTab, setActiveTopTab] = useState<'all' | 'volunteer' | 'partner'>('all');
  const reportsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const reportsReloadQueuedRef = useRef(false);
  const hasLoadedReportsRef = useRef(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open partners on their own report dashboard once authentication resolves.
  // Admins retain the all-reports landing view, while volunteers keep the
  // existing event-report experience.
  useEffect(() => {
    if (user?.role === 'partner') {
      setActiveTopTab('partner');
    } else if (user?.role === 'volunteer') {
      setActiveTopTab('volunteer');
    } else if (user?.role === 'admin') {
      setActiveTopTab('all');
    }
  }, [user?.role]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const loadProjects = useCallback(async () => {
    if (user?.role === 'volunteer' && user.id) {
      const snapshot = await getProjectsScreenSnapshot(user, [
        'projects',
        'timeLogs',
        'volunteerProfile',
        'volunteerProjectJoins',
      ]);
      setProjects(snapshot.projects);
      setPartnerApplications([]);
      setVolunteerProfileId(snapshot.volunteerProfile?.id || null);
      setVolunteerTimeLogs(snapshot.timeLogs);
      setVolunteerJoinRecords(snapshot.volunteerJoinRecords || []);
      setVolunteerTimedInProjectIds(
        Array.from(
          new Set(
            snapshot.timeLogs
              .filter(log => Boolean(log.timeIn))
              .map(log => log.projectId)
              .filter(Boolean)
          )
        )
      );
      return snapshot.projects;
    }

    if (user?.role === 'partner' && user.id) {
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'partnerApplications']);
      setProjects(snapshot.projects);
      setPartnerApplications(snapshot.partnerApplications || []);
      setVolunteerProfileId(null);
      setVolunteerTimedInProjectIds([]);
      setVolunteerJoinRecords([]);
      return snapshot.projects;
    }

    if (user?.role === 'admin' && user.id) {
      const snapshot = await getProjectsScreenSnapshot(user, [
        'projects',
        'partnerApplications',
        'volunteerJoinRecords',
      ]);
      setProjects(snapshot.projects);
      setPartnerApplications(snapshot.partnerApplications || []);
      setVolunteerProfileId(null);
      setVolunteerTimedInProjectIds([]);
      setVolunteerJoinRecords(snapshot.volunteerJoinRecords || []);
      return snapshot.projects;
    }

    setVolunteerProfileId(null);
    setVolunteerTimedInProjectIds([]);
    setVolunteerTimeLogs([]);
    setVolunteerJoinRecords([]);
    setPartnerApplications([]);
    const allProjects = await getAllProjects();
    setProjects(allProjects);
    return allProjects;
  }, [user]);

  const fieldOfficerProjectIds = useMemo(() => {
    if (!volunteerProfileId) {
      return [];
    }

    return projects
      .filter(
        project =>
          project.isEvent &&
          (project.internalTasks || []).some(
            task => task.isFieldOfficer && isVolunteerAssignedToTask(task, volunteerProfileId)
          )
      )
      .map(project => project.id);
  }, [projects, volunteerProfileId]);

  const loadVolunteers = useCallback(async () => {
    const allVolunteers = await getAllVolunteers();
    setVolunteers(allVolunteers);
  }, []);

  const loadReports = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    const shouldShowBlockingLoader = !hasLoadedReportsRef.current;
    if (shouldShowBlockingLoader) {
      setLoading(true);
    }

    try {
      const allProjects = await loadProjects();
      const [rawReports, allTimeLogs, allJoinRecords] = await Promise.all([
        user.role === 'admin' || user.role === 'partner'
          ? getAllPartnerReports()
          : getImpactHubReportsByUser(user.id),
        user.role === 'admin' || user.role === 'partner'
          ? getAllVolunteerTimeLogs()
          : Promise.resolve(null),
        user.role === 'admin' || user.role === 'partner'
          ? getAllVolunteerProjectJoinRecords()
          : Promise.resolve(null),
      ]);

      if (user.role === 'admin' || user.role === 'partner') {
        setVolunteerTimeLogs(allTimeLogs || []);
        setVolunteerJoinRecords(allJoinRecords || []);
      }

      setReports(
        rawReports
          .map(report => normalizeImpactHubReport(report, allProjects))
          .filter(shouldDisplayReport)
          .sort(
            (left, right) =>
              new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
          )
      );
      hasLoadedReportsRef.current = true;
    } catch (error) {
      console.error('Error loading reports:', error);
      Alert.alert('Error', 'Failed to load reports');
    } finally {
      if (shouldShowBlockingLoader) {
        setLoading(false);
      }
    }
  }, [loadProjects, user?.id, user?.role]);

  const loadReportsCoalesced = useCallback(async () => {
    if (reportsLoadInFlightRef.current) {
      reportsReloadQueuedRef.current = true;
      return;
    }

    do {
      reportsReloadQueuedRef.current = false;
      const task = loadReports();
      reportsLoadInFlightRef.current = task;
      try {
        await task;
      } finally {
        reportsLoadInFlightRef.current = null;
      }
    } while (reportsReloadQueuedRef.current);
  }, [loadReports]);

  useEffect(() => {
    void loadReportsCoalesced();
    setTimeout(() => {
      void loadVolunteers();
    }, 50);
  }, [loadReportsCoalesced, loadVolunteers]);

  // Reload reports every time this screen is focused so the admin always
  // sees the latest submissions without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      void loadReportsCoalesced();
    }, [loadReportsCoalesced])
  );

  useEffect(() => {
    return subscribeToStorageChanges(
      ['partnerReports', 'projects', 'partnerProjectApplications', 'volunteerTimeLogs', 'volunteerProjectJoins'],
      async () => {
        await loadReportsCoalesced();
      }
    );
  }, [loadReportsCoalesced]);

  useEffect(() => {
    const params = route?.params as
      | {
          projectId?: string;
          autoOpenUpload?: boolean;
          completionReport?: string;
          completionPhoto?: string;
        }
      | undefined;

    if (params?.autoOpenUpload) {
      setShowUploadModal(true);
      setUploadModalInitialValues({
        projectId: params.projectId,
        completionReport: params.completionReport,
        completionPhoto: params.completionPhoto,
      });
      navigation?.setParams({
        projectId: undefined,
        autoOpenUpload: undefined,
        completionReport: undefined,
        completionPhoto: undefined,
      });
    }
  }, [navigation, route?.params]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadReportsCoalesced();
    setTimeout(() => {
      void loadVolunteers();
    }, 50);
    setRefreshing(false);
  }, [loadReportsCoalesced, loadVolunteers]);

  const partnerProjectSummaries = useMemo(
    () =>
      user?.role === 'partner' || user?.role === 'admin'
        ? buildPartnerProjectSummaries(
            user.role === 'partner' ? user.id : undefined,
            projects,
            reports,
            volunteers,
            partnerApplications,
            volunteerTimeLogs,
            volunteerJoinRecords
          )
        : [],
    [
      partnerApplications,
      projects,
      reports,
      user?.id,
      user?.role,
      volunteerJoinRecords,
      volunteerTimeLogs,
      volunteers,
    ]
  );

  const partnerAcceptedProjects = useMemo(
    () => partnerProjectSummaries.map(summary => summary.project),
    [partnerProjectSummaries]
  );

  // Partner report views must stay scoped to projects that this partner
  // proposed and the admin approved.  Events are included only when they
  // explicitly belong to one of those approved projects.
  const partnerAcceptedEventProjects = useMemo(() => {
    const byId = new Map<string, Project>();
    partnerProjectSummaries.forEach(summary => {
      summary.linkedEvents.forEach(event => byId.set(event.id, event));
    });
    return Array.from(byId.values());
  }, [partnerProjectSummaries]);

  const partnerAcceptedProjectIds = useMemo(
    () => new Set(partnerAcceptedProjects.map(project => project.id)),
    [partnerAcceptedProjects]
  );

  const partnerAcceptedEventIds = useMemo(
    () => new Set(partnerAcceptedEventProjects.map(event => event.id)),
    [partnerAcceptedEventProjects]
  );

  const partnerVisibleProjects = useMemo(
    () => [...partnerAcceptedProjects, ...partnerAcceptedEventProjects],
    [partnerAcceptedEventProjects, partnerAcceptedProjects]
  );

  const partnerVisibleReports = useMemo(
    () =>
      reports.filter(report => {
        const projectId = String(report.projectId || '').trim();
        if (!projectId) return false;

        const isOwnApprovedProjectReport =
          report.submitterRole === 'partner' &&
          report.submittedBy === user?.id &&
          partnerAcceptedProjectIds.has(projectId);
        const isApprovedProjectEventReport =
          report.submitterRole === 'volunteer' && partnerAcceptedEventIds.has(projectId);

        return isOwnApprovedProjectReport || isApprovedProjectEventReport;
      }),
    [partnerAcceptedEventIds, partnerAcceptedProjectIds, reports, user?.id]
  );

  const partnerVolunteerTimeLogs = useMemo(
    () => volunteerTimeLogs.filter(log => partnerAcceptedEventIds.has(log.projectId)),
    [partnerAcceptedEventIds, volunteerTimeLogs]
  );

  const partnerVolunteerJoinRecords = useMemo(
    () => volunteerJoinRecords.filter(record => partnerAcceptedEventIds.has(record.projectId)),
    [partnerAcceptedEventIds, volunteerJoinRecords]
  );

  const partnerVisibleVolunteers = useMemo(() => {
    if (user?.role !== 'partner') {
      return volunteers;
    }

    const visibleVolunteerKeys = new Set<string>([
      ...partnerVolunteerJoinRecords.flatMap(record => [record.volunteerId, record.volunteerUserId]),
      ...partnerVolunteerTimeLogs.map(log => log.volunteerId),
      ...partnerVisibleReports
        .filter(report => report.submitterRole === 'volunteer')
        .map(report => report.submittedBy),
    ]);

    return volunteers.filter(
      volunteer => visibleVolunteerKeys.has(volunteer.id) || Boolean(volunteer.userId && visibleVolunteerKeys.has(volunteer.userId))
    );
  }, [
    partnerVisibleReports,
    partnerVolunteerJoinRecords,
    partnerVolunteerTimeLogs,
    user?.role,
    volunteers,
  ]);

  const handleUploadReport = useCallback(
    async (
      reportData: Omit<
        SubmittedReport,
        'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'
      >
    ): Promise<boolean> => {
      if (!user?.id) {
        return false;
      }

      const targetProjectId =
        reportData.projectId || (user.role === 'volunteer' ? undefined : projects[0]?.id);
      if (!targetProjectId) {
        showToast(
          user.role === 'volunteer'
            ? 'Select an event you already timed in to before submitting a report.'
            : 'Select a project before submitting a report.',
          'error'
        );
        return false;
      }

      try {
        const reportType = reportData.reportType as ImpactHubReportType;
        if (
          user.role === 'volunteer' &&
          reportType === 'field_report' &&
          !fieldOfficerProjectIds.includes(targetProjectId)
        ) {
          showToast('Field reports are only for the assigned field officer of that event.', 'error');
          return false;
        }

        const numericMetrics = Object.fromEntries(
          Object.entries(reportData.metrics).filter(([, value]) => typeof value === 'number')
        ) as Record<string, number>;

        // Keep the beneficiary value durable even if a legacy/custom report
        // form supplied it only in the volunteer narrative.
        if (
          user.role === 'volunteer' &&
          reportType === 'field_report' &&
          numericMetrics.beneficiariesServed === undefined
        ) {
          const narrativeValue = parseBeneficiariesFromNarrative(reportData.description);
          if (narrativeValue !== undefined) {
            numericMetrics.beneficiariesServed = narrativeValue;
          }
        }

        if (user.role === 'partner') {
          const allowedProjectIds = new Set(partnerAcceptedProjects.map(project => project.id));
          if (!allowedProjectIds.has(targetProjectId)) {
            showToast(
              'Partners can only submit reports for projects that they proposed and the admin approved.',
              'error'
            );
            return false;
          }
        }

        const hadActiveVolunteerLog =
          user.role === 'volunteer'
            ? volunteerTimeLogs.some(
                log => log.projectId === targetProjectId && Boolean(log.timeIn) && !log.timeOut
              )
            : false;

        if (reportType === 'field_report') {
          await submitFieldReport({
            projectId: targetProjectId,
            submitterUserId: user.id,
            submitterName: user.name,
            submitterRole: user.role,
            partnerUserId: user.role === 'partner' ? user.id : undefined,
            partnerName: user.role === 'partner' ? user.name : undefined,
            title: reportData.title,
            description: reportData.description,
            metrics: numericMetrics,
            attachments: reportData.attachments,
            mediaFile: reportData.mediaFile,
          });
        } else {
          await submitImpactHubReport({
            projectId: targetProjectId,
            submitterUserId: user.id,
            submitterName: user.name,
            submitterRole: user.role,
            partnerUserId: user.role === 'partner' ? user.id : undefined,
            partnerName: user.role === 'partner' ? user.name : undefined,
            reportType,
            title: reportData.title,
            description: reportData.description,
            metrics: numericMetrics,
            attachments: reportData.attachments,
            mediaFile: reportData.mediaFile,
            collaborationFeedback: reportData.collaborationFeedback,
            volunteerPraise: reportData.volunteerPraise,
            gratitudeNote: reportData.gratitudeNote,
          });
        }

        setShowUploadModal(false);
        const successMessage = user.role === 'volunteer'
          ? hadActiveVolunteerLog
            ? 'Report submitted! Your attendance has been confirmed.'
            : 'Report submitted successfully to the event reports.'
          : 'Report submitted to the impact hub.';
        showToast(successMessage, 'success');
        // Reload reports in background without blocking
        void loadReportsCoalesced();
        return true;
      } catch (error: any) {
        console.error('Error submitting report:', error);
        const detail =
          typeof error?.message === 'string' && error.message.trim()
            ? error.message.trim()
            : 'Failed to submit report. Please try again.';
        showToast(detail, 'error');
        return false;
      }
    },
    [
      fieldOfficerProjectIds,
      loadReportsCoalesced,
      partnerAcceptedProjects,
      projects,
      user?.id,
      user?.name,
      user?.role,
      volunteerTimeLogs,
    ]
  );

  const handleViewReport = useCallback(async (report: SubmittedReport) => {
    setSelectedReport(report);
    setShowDetailsModal(true);

    if (user?.role === 'admin' && !report.viewedBy?.includes(user.id)) {
      try {
        const updatedViewedBy = [...(report.viewedBy || []), user.id];
        const rawReports = await getAllPartnerReports();
        const rawReport = rawReports.find(r => r.id === report.id);
        if (rawReport) {
          rawReport.viewedBy = updatedViewedBy;
          await savePartnerReport(rawReport);
        }
      } catch (err) {
        console.error('Error marking report as viewed:', err);
      }
    }
  }, [user]);

  const handleCloseDetails = useCallback(() => {
    setShowDetailsModal(false);
    setSelectedReport(null);
  }, []);

  const handleApproveReport = useCallback(
    async (reportId: string, notes: string) => {
      if (!user?.id) return;
      try {
        await reviewPartnerReport(reportId, user.id, 'Reviewed', notes || undefined);
        setShowDetailsModal(false);
        setSelectedReport(null);
        showToast('Report approved. The submitter has been notified.', 'success');
        // Reload in background without blocking
        void loadReportsCoalesced();
      } catch (error: any) {
        showToast(error?.message || 'Failed to approve report.', 'error');
      }
    },
    [loadReportsCoalesced, showToast, user?.id]
  );

  const handleRejectReport = useCallback(
    async (reportId: string, notes: string) => {
      if (!user?.id) return;
      try {
        await reviewPartnerReport(reportId, user.id, 'Rejected', notes || undefined);
        setShowDetailsModal(false);
        setSelectedReport(null);
        // Optimistically remove from display immediately
        setReports(prev => prev.filter(report => report.id !== reportId));
        showToast('Report rejected. The submitter has been notified.', 'info');
        // Reload in background to sync any changes
        void loadReportsCoalesced();
      } catch (error: any) {
        showToast(error?.message || 'Failed to reject report.', 'error');
      }
    },
    [loadReportsCoalesced, showToast, user?.id]
  );

  const handleCloseUploadModal = useCallback(() => {
    setShowUploadModal(false);
    setUploadModalInitialValues(null);
  }, []);

  const handleReviseReport = useCallback((report: SubmittedReport) => {
    setUploadModalInitialValues({
      projectId: report.projectId,
      completionReport: report.description,
      completionPhoto: report.mediaFile,
    });
    setShowUploadModal(true);
  }, []);

  const userReports = useMemo(
    () => (user?.role === 'admin' ? reports : reports.filter(report => report.submittedBy === user?.id)),
    [reports, user?.id, user?.role]
  );

  const volunteerEventProjects = useMemo(() => {
    return projects.filter(project => Boolean(project.isEvent));
  }, [projects]);

  const handleOpenUploadModal = useCallback(() => {
    if (user?.role === 'volunteer' && volunteerEventProjects.length === 0) {
      Alert.alert(
        'Attendance Required',
        'You can only submit a report for an event where your attendance is already confirmed.'
      );
      return;
    }

    if (user?.role === 'partner' && partnerAcceptedProjects.length === 0) {
      Alert.alert(
        'No Approved Project',
        'Approved projects that your account proposed must exist before you can submit a partner report.'
      );
      return;
    }

    setUploadModalInitialValues(null);
    setShowUploadModal(true);
  }, [partnerAcceptedProjects.length, user?.role, volunteerEventProjects.length]);

  const handleViewAnalytics = useCallback((reportType?: 'all' | 'volunteer' | 'partner') => {
    // Filter reports by type and display them
    if (reportType) {
      setSelectedReportType(reportType);
      setShowFilteredReports(true);
    }
    console.log(`View all clicked for: ${reportType || 'analytics'}`);
  }, []);

  const dashboard = (() => {
    if (activeTopTab === 'all') {
      return (
        <AllReportsView
          reports={user?.role === 'partner' ? partnerVisibleReports : reports}
          projects={user?.role === 'partner' ? partnerVisibleProjects : projects}
          volunteerTimeLogs={user?.role === 'partner' ? partnerVolunteerTimeLogs : volunteerTimeLogs}
          volunteers={user?.role === 'partner' ? partnerVisibleVolunteers : volunteers}
          onViewReport={handleViewReport}
          reportType="all"
        />
      );
    }

    if (activeTopTab === 'volunteer') {
      const volunteerReports = user?.role === 'admin'
        ? reports.filter(report => report.submitterRole === 'volunteer')
        : user?.role === 'partner'
        ? partnerVisibleReports.filter(report => report.submitterRole === 'volunteer')
        : userReports;
      const volunteerProjects = user?.role === 'admin'
        ? projects
        : user?.role === 'partner'
        ? partnerAcceptedEventProjects
        : volunteerEventProjects;
      const scopedVolunteerTimeLogs = user?.role === 'partner'
        ? partnerVolunteerTimeLogs
        : volunteerTimeLogs;
      const scopedVolunteerJoinRecords = user?.role === 'partner'
        ? partnerVolunteerJoinRecords
        : volunteerJoinRecords;
      return (
        <VolunteerReportsDashboard
          reports={volunteerReports}
          projects={volunteerProjects}
          volunteerTimeLogs={scopedVolunteerTimeLogs}
          volunteerJoinRecords={scopedVolunteerJoinRecords}
          onUploadReport={handleOpenUploadModal}
          onViewReport={handleViewReport}
          loading={loading}
          onRefresh={onRefresh}
          refreshing={refreshing}
          isAdminView={user?.role === 'admin'}
          isPartnerView={user?.role === 'partner'}
          volunteers={user?.role === 'partner' ? partnerVisibleVolunteers : volunteers}
        />
      );
    }

    const partnerDashboardReports = user?.role === 'admin'
      ? reports.filter(report => {
          const projectId = String(report.projectId || '').trim();
          return (
            (report.submitterRole === 'partner' && partnerAcceptedProjectIds.has(projectId)) ||
            (report.submitterRole === 'volunteer' && partnerAcceptedEventIds.has(projectId))
          );
        })
      : partnerVisibleReports;
    return (
      <PartnerReportsDashboard
        // Include the approved project's volunteer reports as well as partner
        // submissions so the dashboard's photos and generated summaries use
        // the same scoped source data for partners and admins.
        reports={partnerDashboardReports}
        projects={partnerAcceptedProjects}
        volunteerTimeLogs={user?.role === 'partner' ? partnerVolunteerTimeLogs : volunteerTimeLogs}
        volunteerJoinRecords={user?.role === 'partner' ? partnerVolunteerJoinRecords : volunteerJoinRecords}
        onUploadReport={handleOpenUploadModal}
        onViewReport={handleViewReport}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
        projectSummaries={partnerProjectSummaries}
        isAdminView={user?.role === 'admin'}
        volunteers={user?.role === 'partner' ? partnerVisibleVolunteers : volunteers}
      />
    );
  })();

  const renderTopTabs = () => (
    <View style={styles.topTabs}>
      {(user?.role === 'volunteer'
        ? (['all', 'volunteer'] as const)
        : (['all', 'volunteer', 'partner'] as const)
      ).map(tab => {
        const label = tab === 'all'
          ? 'All Reports'
          : tab === 'volunteer'
            ? 'Volunteer Reports'
            : 'Partner Reports';
        const active = activeTopTab === tab;
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.topTab, active && styles.topTabActive]}
            onPress={() => setActiveTopTab(tab)}
            activeOpacity={0.8}
          >
            <Text style={[styles.topTabText, active && styles.topTabTextActive]}>{label}</Text>
            {active ? <View style={styles.topTabUnderline} /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <>
      {/* In-app toast banner — replaces Alert.alert which browsers can block */}
      {toast ? (
        <View
          style={[
            styles.toastBanner,
            toast.type === 'success' && styles.toastSuccess,
            toast.type === 'error' && styles.toastError,
            toast.type === 'info' && styles.toastInfo,
          ]}
          pointerEvents="none"
        >
          <Text style={styles.toastIcon}>
            {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}
          </Text>
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      ) : null}
      {renderTopTabs()}
      {dashboard}
      <ReportUploadModal
        visible={showUploadModal}
        onClose={handleCloseUploadModal}
        onSubmit={handleUploadReport}
        projects={
          user?.role === 'volunteer'
            ? volunteerEventProjects
            : user?.role === 'partner'
            ? partnerAcceptedProjects
            : projects
        }
        userRole={user?.role}
        volunteerTimeLogs={user?.role === 'volunteer' ? volunteerTimeLogs : undefined}
        volunteerJoinRecords={user?.role === 'volunteer' ? volunteerJoinRecords : undefined}
        fieldOfficerProjectIds={user?.role === 'volunteer' ? fieldOfficerProjectIds : undefined}
        volunteerProfileId={user?.role === 'volunteer' ? volunteerProfileId : undefined}
        initialProjectId={uploadModalInitialValues?.projectId}
        initialDescription={uploadModalInitialValues?.completionReport}
        partnerProjectSummaries={
          user?.role === 'partner' ? partnerProjectSummaries : undefined
        }
      />
      <ReportDetailsModal
        visible={showDetailsModal}
        report={selectedReport}
        onClose={handleCloseDetails}
        onApprove={user?.role === 'admin' ? handleApproveReport : undefined}
        onReject={user?.role === 'admin' ? handleRejectReport : undefined}
        onRevise={user?.role !== 'admin' ? handleReviseReport : undefined}
        userRole={user?.role}
        showModerationActions={user?.role === 'admin'}
      />
      <Modal
        visible={showFilteredReports}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFilteredReports(false)}
      >
        <View style={styles.filteredReportsModalOverlay}>
          <View style={styles.filteredReportsModalContent}>
            <View style={styles.filteredReportsHeader}>
              <Text style={styles.filteredReportsTitle}>
                {selectedReportType === 'all' ? 'All Reports' : 
                 selectedReportType === 'volunteer' ? 'Volunteer Reports' : 
                 'Partner Reports'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowFilteredReports(false)}
                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              >
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>
            
            {userReports.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No reports yet</Text>
              </View>
            ) : (
              <ScrollView style={styles.reportsList}>
                {userReports
                  .filter(report => {
                    if (selectedReportType === 'all') return true;
                    if (selectedReportType === 'volunteer') return report.submitterRole === 'volunteer';
                    if (selectedReportType === 'partner') return report.submitterRole === 'partner';
                    return true;
                  })
                  .map(report => (
                    <TouchableOpacity
                      key={report.id}
                      style={styles.reportItem}
                      onPress={() => {
                        setShowFilteredReports(false);
                        handleViewReport(report);
                      }}
                    >
                      <View style={styles.reportItemContent}>
                        <Text style={styles.reportItemTitle}>{report.title || 'Untitled Report'}</Text>
                        <Text style={styles.reportItemMeta}>
                          By {report.submitterName} • {new Date(report.submittedAt).toLocaleDateString()}
                        </Text>
                        <Text style={styles.reportItemDesc} numberOfLines={2}>
                          {report.description}
                        </Text>
                      </View>
                      <Text style={styles.reportItemArrow}>›</Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  filteredReportsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  filteredReportsModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    paddingBottom: 20,
  },
  filteredReportsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  filteredReportsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    fontSize: 24,
    color: '#999',
  },
  reportsList: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  reportItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginVertical: 4,
    backgroundColor: '#fafafa',
    borderRadius: 8,
  },
  reportItemContent: {
    flex: 1,
    marginRight: 12,
  },
  reportItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  reportItemMeta: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  reportItemDesc: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  reportItemArrow: {
    fontSize: 20,
    color: '#ccc',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#999',
  },
  topTabs: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E7E5E4',
  },
  topTab: {
    paddingBottom: 12,
    alignItems: 'center',
  },
  topTabActive: {},
  topTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
  },
  topTabTextActive: {
    color: '#8B5A2B',
  },
  topTabUnderline: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#C9A86A',
    borderRadius: 1,
  },
  toastBanner: {
    position: 'absolute',
    top: 20,
    left: '10%',
    right: '10%',
    zIndex: 99999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  toastSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  toastError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  toastInfo: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
  },
  toastIcon: {
    fontSize: 18,
  },
  toastText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 18,
  },
});
