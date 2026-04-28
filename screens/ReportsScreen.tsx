import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllPartnerReports,
  getAllProjects,
  getProjectsScreenSnapshot,
  getAllVolunteers,
  submitFieldReport,
  getImpactHubReportsByUser,
  submitImpactHubReport,
  subscribeToStorageChanges,
} from '../models/storage';
import type { ImpactHubReportType, PartnerReport, Project, Volunteer, UserRole, VolunteerTimeLog } from '../models/types';
import ReportUploadModal from '../components/ReportUploadModal';
import ReportDetailsModal from '../components/ReportDetailsModal';
import AdminReportsDashboard from '../components/AdminReportsDashboard';
import VolunteerReportsDashboard, { PartnerReportsDashboard } from '../components/VolunteerReportsDashboard';

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
    status: 'Submitted',
    submittedAt: report.createdAt,
    approvalNotes: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    viewedBy: [],
  };
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
  const [volunteerTimedInProjectIds, setVolunteerTimedInProjectIds] = useState<string[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const reportsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const reportsReloadQueuedRef = useRef(false);

  const loadProjects = useCallback(async () => {
    if (user?.role === 'volunteer' && user.id) {
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'timeLogs']);
      setProjects(snapshot.projects);
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

    setVolunteerTimedInProjectIds([]);
    setVolunteerTimeLogs([]);
    const allProjects = await getAllProjects();
    setProjects(allProjects);
    return allProjects;
  }, [user]);

  const loadVolunteers = useCallback(async () => {
    const allVolunteers = await getAllVolunteers();
    setVolunteers(allVolunteers);
  }, []);

  const loadReports = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setLoading(true);
    try {
      const allProjects = await loadProjects();
      const rawReports = user.role === 'admin' ? await getAllPartnerReports() : await getImpactHubReportsByUser(user.id);

      setReports(
        rawReports
          .map(report => normalizeImpactHubReport(report, allProjects))
          .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
      );
    } catch (error) {
      console.error('Error loading reports:', error);
      Alert.alert('Error', 'Failed to load reports');
    } finally {
      setLoading(false);
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
    // defer volunteers to avoid blocking initial reports render
    setTimeout(() => {
      void loadVolunteers();
    }, 50);
  }, [loadReportsCoalesced, loadVolunteers]);

  useEffect(() => {
    return subscribeToStorageChanges(['partnerReports', 'projects', 'volunteerTimeLogs'], async () => {
      await loadReportsCoalesced();
    });
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
    // refresh volunteers without blocking the UI
    setTimeout(() => {
      void loadVolunteers();
    }, 50);
    setRefreshing(false);
  }, [loadReportsCoalesced, loadVolunteers]);

  const handleUploadReport = useCallback(
    async (
      reportData: Omit<
        SubmittedReport,
        'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'
      >
    ) => {
      if (!user?.id) {
        return;
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
        return;
      }

      try {
        const reportType = reportData.reportType as ImpactHubReportType;
        const numericMetrics = Object.fromEntries(
          Object.entries(reportData.metrics).filter(([, value]) => typeof value === 'number')
        ) as Record<string, number>;
        const completionPhotoUri =
          (reportData.mediaFile || '').trim() ||
          reportData.attachments?.find(attachment => Boolean(attachment?.url?.trim()))?.url?.trim() ||
          undefined;

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
          });
        }

        setShowUploadModal(false);
        await loadReportsCoalesced();
        Alert.alert(
          'Success',
          user.role === 'volunteer'
            ? 'Your report was submitted. Time out is complete and this event is now marked as task completed.'
            : 'Your report was submitted to the impact hub.'
        );
      } catch (error: any) {
        console.error('Error submitting report:', error);
        const detail =
          typeof error?.message === 'string' && error.message.trim()
            ? error.message.trim()
            : 'Failed to submit report.';
        Alert.alert('Error', detail);
      }
    },
    [loadReportsCoalesced, projects, user?.id, user?.name, user?.role]
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

    setUploadModalInitialValues(null);
    setShowUploadModal(true);
  }, [user?.role, volunteerEventProjects.length]);

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
        projects={projects}
        onUploadReport={handleOpenUploadModal}
        onViewReport={handleViewReport}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
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
        projects={user?.role === 'volunteer' ? volunteerEventProjects : projects}
        userRole={user?.role}
        volunteerTimeLogs={user?.role === 'volunteer' ? volunteerTimeLogs : undefined}
        initialProjectId={uploadModalInitialValues?.projectId}
        initialDescription={uploadModalInitialValues?.completionReport}
        initialMediaUri={uploadModalInitialValues?.completionPhoto}
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
