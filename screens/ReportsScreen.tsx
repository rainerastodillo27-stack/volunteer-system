import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllPartnerReports,
  getAllProjects,
  getProjectsScreenSnapshot,
  getAllVolunteers,
  getAllVolunteerTimeLogs,
  submitFieldReport,
  getImpactHubReportsByUser,
  submitImpactHubReport,
  subscribeToStorageChanges,
} from '../models/storage';
import type {
  ImpactHubReportType,
  PartnerProjectApplication,
  PartnerReport,
  Project,
  Volunteer,
  UserRole,
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
  volunteerHours: number;
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

function normalizeImpactHubReport(
  report: PartnerReport,
  projects: Project[]
): SubmittedReport {
  const linkedProject = projects.find(project => project.id === report.projectId);

  return {
    id: report.id,
    submittedBy: report.submitterUserId || report.partnerUserId || '',
    submitterName: report.submitterName || report.partnerName || 'User',
    submitterRole: report.submitterRole || 'partner',
    reportType: report.reportType || 'program_impact',
    title: report.title || `${report.submitterName || report.partnerName || 'User'} Report`,
    description: report.description || '',
    projectId: report.projectId,
    projectTitle: linkedProject?.title,
    projectKind: linkedProject?.isEvent ? 'event' : linkedProject ? 'project' : undefined,
    category: linkedProject?.category,
    metrics: report.metrics || {},
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

function getCompletedVolunteerHours(log: VolunteerTimeLog): number {
  if (!log.timeIn || !log.timeOut) {
    return 0;
  }

  const start = new Date(log.timeIn).getTime();
  const end = new Date(log.timeOut).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }

  return (end - start) / 3_600_000;
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
    `Volunteer Hours from completed time in and time out: ${formatMetricNumber(metrics.volunteerHours, ' hours')}`,
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
  volunteerTimeLogs: VolunteerTimeLog[]
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
  const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));

  return projects
    .filter(project => !project.isEvent && approvedProjectIds.has(project.id))
    .map(project => {
      const linkedEvents = projects.filter(
        candidate => candidate.isEvent && candidate.parentProjectId === project.id
      );
      const linkedEventIds = new Set(linkedEvents.map(event => event.id));
      const partnerReports = reports
        .filter(
          report =>
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
          volunteerHours: 0,
          verifiedAttendance: 0,
          beneficiariesServed: 0,
        };
        volunteerAccountsMap.set(key, created);
        return created;
      };

      relatedCompletedLogs.forEach(log => {
        const volunteer = volunteerById.get(log.volunteerId);
        const accountKey = volunteer?.userId || `volunteer:${log.volunteerId}`;
        const account = ensureVolunteerAccount(accountKey, volunteer?.name || 'Volunteer');
        account.volunteerHours += getCompletedVolunteerHours(log);
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
          volunteerHours: Number(account.volunteerHours.toFixed(1)),
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
        volunteerHours: Number(
          relatedCompletedLogs
            .reduce((sum, log) => sum + getCompletedVolunteerHours(log), 0)
            .toFixed(1)
        ),
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
  const reportsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const reportsReloadQueuedRef = useRef(false);
  const hasLoadedReportsRef = useRef(false);

  const loadProjects = useCallback(async () => {
    if (user?.role === 'volunteer' && user.id) {
      const snapshot = await getProjectsScreenSnapshot(user, [
        'projects',
        'timeLogs',
        'volunteerProfile',
      ]);
      setProjects(snapshot.projects);
      setPartnerApplications([]);
      setVolunteerProfileId(snapshot.volunteerProfile?.id || null);
      setVolunteerTimeLogs(snapshot.timeLogs);
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
      return snapshot.projects;
    }

    setVolunteerProfileId(null);
    setVolunteerTimedInProjectIds([]);
    setVolunteerTimeLogs([]);
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
            task => task.isFieldOfficer && task.assignedVolunteerId === volunteerProfileId
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
      const [rawReports, allTimeLogs] = await Promise.all([
        user.role === 'admin' || user.role === 'partner'
          ? getAllPartnerReports()
          : getImpactHubReportsByUser(user.id),
        user.role === 'partner' ? getAllVolunteerTimeLogs() : Promise.resolve(null),
      ]);

      if (user.role === 'partner') {
        setVolunteerTimeLogs(allTimeLogs || []);
      }

      setReports(
        rawReports
          .map(report => normalizeImpactHubReport(report, allProjects))
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
      ['partnerReports', 'projects', 'partnerProjectApplications', 'volunteerTimeLogs'],
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
            volunteerTimeLogs
          )
        : [],
    [partnerApplications, projects, reports, user?.id, user?.role, volunteerTimeLogs, volunteers]
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
        await loadReportsCoalesced();
        Alert.alert(
          'Success',
          user.role === 'volunteer'
            ? hadActiveVolunteerLog
              ? 'Your report was submitted and your time out is complete for today.'
              : 'Your report was submitted to the event reports.'
            : 'Your report was submitted to the impact hub.'
        );
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

  const handleViewReport = useCallback((report: SubmittedReport) => {
    setSelectedReport(report);
    setShowDetailsModal(true);
  }, []);

  const handleCloseDetails = useCallback(() => {
    setShowDetailsModal(false);
    setSelectedReport(null);
  }, []);

  const handleCloseUploadModal = useCallback(() => {
    setShowUploadModal(false);
    setUploadModalInitialValues(null);
  }, []);

  const userReports = useMemo(() => {
    if (user?.role === 'admin') {
      return reports;
    }

    return reports.filter(report => report.submittedBy === user?.id);
  }, [reports, user?.id, user?.role]);

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
        'Time In Required',
        'You can only submit a report for an event where you already timed in.'
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

  const dashboard =
    user?.role === 'admin' ? (
      <AdminReportsDashboard
        reports={userReports}
        projects={projects}
        volunteers={volunteers}
        onUploadReport={handleOpenUploadModal}
        onViewReport={handleViewReport}
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
        fieldOfficerProjectIds={user?.role === 'volunteer' ? fieldOfficerProjectIds : undefined}
        initialProjectId={uploadModalInitialValues?.projectId}
        initialDescription={uploadModalInitialValues?.completionReport}
        initialMediaUri={uploadModalInitialValues?.completionPhoto}
        partnerProjectSummaries={
          user?.role === 'partner' ? partnerProjectSummaries : undefined
        }
      />
      <ReportDetailsModal
        visible={showDetailsModal}
        report={selectedReport}
        onClose={handleCloseDetails}
        userRole={user?.role}
        showModerationActions={false}
      />
    </>
  );
}
