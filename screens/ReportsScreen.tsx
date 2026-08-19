import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ModernTheme from '../utils/modernTheme';
import { Alert, Modal, StyleSheet, FlatList, View, Text, ScrollView, TouchableOpacity } from 'react-native';
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
import AdminReportsDashboard from '../components/AdminReportsDashboard';
import VolunteerReportsDashboard, {
  PartnerReportsDashboard,
} from '../components/VolunteerReportsDashboard';

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
  generatedDescription: string;
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

function normalizeImpactHubReport(
  report: PartnerReport,
  projects: Project[]
): SubmittedReport {
  const linkedProject = projects.find(project => project.id === report.projectId);

  const isEvent = linkedProject
    ? Boolean(linkedProject.isEvent)
    : Boolean(
        report.projectId?.startsWith('event-') ||
        report.projectId?.includes('-event-') ||
        report.submitterRole === 'volunteer' ||
        report.reportType === 'field_report'
      );

  const rawMetrics = report.metrics || {};
  const metrics: Record<string, number> = {};
  for (const [key, val] of Object.entries(rawMetrics)) {
    const numVal = typeof val === 'number' ? val : Number(val) || 0;
    if (key === 'beneficiaries' || key === 'beneficiaries_served' || key === 'beneficiariesServed') {
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

  return {
    id: report.id,
    submittedBy: report.submitterUserId || report.partnerUserId || '',
    submitterName: report.submitterName || report.partnerName || 'User',
    submitterRole: report.submitterRole || 'partner',
    reportType: report.reportType || 'program_impact',
    title: report.title || `${report.submitterName || report.partnerName || 'User'} Report`,
    description: report.description || '',
    projectId: report.projectId,
    projectTitle: linkedProject?.title || friendlyEventFallbackTitle(report.projectId, isEvent),
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

function formatMetricNumber(value: number | undefined, suffix = ''): string {
  if (!value) {
    return `0${suffix}`;
  }

  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function buildPartnerGeneratedDescription(
  project: Project,
  linkedEvents: Project[],
  metrics: SubmittedReport['metrics'],
  volunteerAccounts: PartnerVolunteerAccountSummary[]
): string {
  return [
    `Project Title: ${project.title}`,
    `Project Description: ${project.description || 'No project description yet.'}`,
    `Accepted Project Selected: ${project.title}`,
    `Linked Events: ${linkedEvents.length}`,
    `Volunteer Event Joins: ${formatMetricNumber(metrics.volunteerEventJoins ?? metrics.volunteerHours)}`,
    `Verified Attendance from completed time logs: ${formatMetricNumber(metrics.verifiedAttendance)}`,
    `Active Volunteers: ${formatMetricNumber(metrics.activeVolunteers)}`,
    `Beneficiaries Served from volunteer reports: ${formatMetricNumber(metrics.beneficiariesServed)}`,
    `Volunteer Accounts Included: ${volunteerAccounts.length}`,
  ].join('\n\n');
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
  if (!partnerUserId) {
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
      .map(application => application.projectId)
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
        candidate => candidate.isEvent && candidate.parentProjectId === project.id
      );
      const linkedEventIds = new Set(linkedEvents.map(event => event.id));
      const partnerReports = reports
        .filter(
          report =>
            shouldDisplayReport(report) &&
            report.submitterRole === 'partner' &&
            report.submittedBy === partnerUserId &&
            report.projectId === project.id
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
      const relatedCompletedLogs = volunteerTimeLogs.filter(
        log => linkedEventIds.has(log.projectId) && Boolean(log.timeOut)
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

      relatedCompletedLogs.forEach(log => {
        const volunteer = volunteerById.get(log.volunteerId);
        const accountKey = volunteer?.userId || `volunteer:${log.volunteerId}`;
        const account = ensureVolunteerAccount(accountKey, volunteer?.name || 'Volunteer');
        account.verifiedAttendance += 1;
        const latestLogTime = log.timeOut || log.timeIn;
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
        verifiedAttendance: relatedCompletedLogs.length,
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
        generatedDescription: buildPartnerGeneratedDescription(
          project,
          linkedEvents,
          metrics,
          volunteerAccounts
        ),
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
  const reportsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const reportsReloadQueuedRef = useRef(false);
  const hasLoadedReportsRef = useRef(false);

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
        user.role === 'partner' ? getAllVolunteerTimeLogs() : Promise.resolve(null),
        user.role === 'partner' ? getAllVolunteerProjectJoinRecords() : Promise.resolve(null),
      ]);

      if (user.role === 'partner') {
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
      user?.role === 'partner'
        ? buildPartnerProjectSummaries(
            user.id,
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
        Alert.alert(
          'Validation Error',
          user.role === 'volunteer'
            ? 'Select an event you already timed in to before submitting a report.'
            : 'Select a project before submitting a report.'
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
          Alert.alert(
            'Field Officer Only',
            'Field reports are only for the assigned field officer of that event.'
          );
          return false;
        }

        const numericMetrics = Object.fromEntries(
          Object.entries(reportData.metrics).filter(([, value]) => typeof value === 'number')
        ) as Record<string, number>;

        if (user.role === 'partner') {
          const allowedProjectIds = new Set(partnerAcceptedProjects.map(project => project.id));
          if (!allowedProjectIds.has(targetProjectId)) {
            Alert.alert(
              'Approved Projects Only',
              'Partners can only submit reports for projects that they proposed and the admin approved.'
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
            ? 'Your report was submitted for today\'s confirmed attendance.'
            : 'Your report was submitted to the event reports.'
          : 'Your report was submitted to the impact hub.';
        
        Alert.alert('Success', successMessage);
        // Reload reports in background without blocking
        void loadReportsCoalesced();
        return true;
      } catch (error: any) {
        console.error('Error submitting report:', error);
        const detail =
          typeof error?.message === 'string' && error.message.trim()
            ? error.message.trim()
            : 'Failed to submit report.';
        Alert.alert('Error', detail);
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
        setReports(prev =>
          prev.map(report =>
            report.id === reportId
              ? {
                  ...report,
                  status: 'Approved',
                  approvalNotes: notes || undefined,
                  approvedBy: user.id,
                  approvedAt: new Date().toISOString(),
                }
              : report
          )
        );
        Alert.alert('Approved', 'The report has been approved and the submitter has been notified.');
        // Reload in background without blocking
        void loadReportsCoalesced();
      } catch (error: any) {
        Alert.alert('Error', error?.message || 'Failed to approve report.');
      }
    },
    [loadReportsCoalesced, user?.id]
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
        Alert.alert('Rejected', 'The report has been rejected and the submitter has been notified.');
        // Reload in background to sync any changes
        void loadReportsCoalesced();
      } catch (error: any) {
        Alert.alert('Error', error?.message || 'Failed to reject report.');
      }
    },
    [loadReportsCoalesced, user?.id]
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
    if (user?.role !== 'volunteer') {
      return projects;
    }

    return projects.filter(
      project => project.isEvent && volunteerTimedInProjectIds.includes(project.id)
    );
  }, [projects, user?.role, volunteerTimedInProjectIds]);

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

  const dashboard =
    user?.role === 'admin' ? (
      <AdminReportsDashboard
        reports={userReports}
        projects={projects}
        volunteers={volunteers}
        onUploadReport={handleOpenUploadModal}
        onViewReport={handleViewReport}
        onViewAnalytics={handleViewAnalytics}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    ) : user?.role === 'partner' ? (
      <PartnerReportsDashboard
        reports={userReports}
        projects={partnerAcceptedProjects}
        onUploadReport={handleOpenUploadModal}
        onViewReport={handleViewReport}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
        projectSummaries={partnerProjectSummaries}
      />
    ) : (
      <VolunteerReportsDashboard
        reports={userReports}
        projects={volunteerEventProjects}
        onUploadReport={handleOpenUploadModal}
        onViewReport={handleViewReport}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    );

  return (
    <>
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
});
