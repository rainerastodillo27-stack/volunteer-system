import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllPartnerReports,
  getAllProjects,
  getAllVolunteers,
  getImpactHubReportsByUser,
  reviewPartnerReport,
  submitImpactHubReport,
  subscribeToStorageChanges,
} from '../models/storage';
import type { ImpactHubReportType, PartnerReport, Project, Volunteer, UserRole } from '../models/types';
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
    category: linkedProject?.category,
    metrics: report.metrics || {},
    attachments: report.attachments || [],
    status: report.status === 'Reviewed' ? 'Approved' : 'Submitted',
    submittedAt: report.createdAt,
    approvedBy: report.reviewedBy,
    approvedAt: report.reviewedAt,
    viewedBy: [],
  };
}

export default function ReportsScreen() {
  const { user } = useAuth();
  const [reports, setReports] = useState<SubmittedReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<SubmittedReport | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);

  const loadProjects = useCallback(async () => {
    const allProjects = await getAllProjects();
    setProjects(allProjects);
    return allProjects;
  }, []);

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
      const impactReports =
        user.role === 'admin'
          ? await getAllPartnerReports()
          : await getImpactHubReportsByUser(user.id);

      setReports(impactReports.map(report => normalizeImpactHubReport(report, allProjects)));
    } catch (error) {
      console.error('Error loading reports:', error);
      Alert.alert('Error', 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [loadProjects, user?.id, user?.role]);

  useEffect(() => {
    void loadReports();
    void loadVolunteers();
  }, [loadReports, loadVolunteers]);

  useEffect(() => {
    return subscribeToStorageChanges(['partnerReports', 'projects'], () => {
      void loadReports();
    });
  }, [loadReports]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadReports(), loadVolunteers()]);
    setRefreshing(false);
  }, [loadReports, loadVolunteers]);

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

      const targetProjectId = reportData.projectId || projects[0]?.id;
      if (!targetProjectId) {
        Alert.alert('Validation Error', 'Select a project before submitting a report.');
        return;
      }

      try {
        await submitImpactHubReport({
          projectId: targetProjectId,
          submitterUserId: user.id,
          submitterName: user.name,
          submitterRole: user.role,
          partnerUserId: user.role === 'partner' ? user.id : undefined,
          partnerName: user.role === 'partner' ? user.name : undefined,
          reportType: reportData.reportType as ImpactHubReportType,
          title: reportData.title,
          description: reportData.description,
          metrics: Object.fromEntries(
            Object.entries(reportData.metrics).filter(([, value]) => typeof value === 'number')
          ) as Record<string, number>,
          attachments: reportData.attachments,
        });
        setShowUploadModal(false);
        await loadReports();
        Alert.alert('Success', 'Your report was submitted to the impact hub.');
      } catch (error) {
        console.error('Error submitting report:', error);
        Alert.alert('Error', 'Failed to submit report');
      }
    },
    [loadReports, projects, user?.id, user?.name, user?.role]
  );

  const handleViewReport = useCallback((report: SubmittedReport) => {
    setSelectedReport(report);
    setShowDetailsModal(true);
  }, []);

  const handleCloseDetails = useCallback(() => {
    setShowDetailsModal(false);
    setSelectedReport(null);
  }, []);

  const handleReviewReport = useCallback(
    async (reportId: string, nextStatus: 'Approved' | 'Rejected') => {
      if (nextStatus === 'Rejected') {
        Alert.alert('Not Available', 'Impact hub reports currently support review approval only.');
        return;
      }

      try {
        await reviewPartnerReport(reportId, user?.id || '');
        await loadReports();
        handleCloseDetails();
      } catch (error) {
        console.error('Error reviewing report:', error);
        Alert.alert('Error', 'Failed to review report');
      }
    },
    [handleCloseDetails, loadReports, user?.id]
  );

  const userReports = useMemo(() => {
    if (user?.role === 'admin') {
      return reports;
    }

    return reports.filter(report => report.submittedBy === user?.id);
  }, [reports, user?.id, user?.role]);

  const dashboard =
    user?.role === 'admin' ? (
      <AdminReportsDashboard
        reports={userReports}
        projects={projects}
        volunteers={volunteers}
        onUploadReport={() => setShowUploadModal(true)}
        onViewReport={handleViewReport}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    ) : user?.role === 'partner' ? (
      <PartnerReportsDashboard
        reports={userReports}
        projects={projects}
        onUploadReport={() => setShowUploadModal(true)}
        onViewReport={handleViewReport}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    ) : (
      <VolunteerReportsDashboard
        reports={userReports}
        projects={projects}
        onUploadReport={() => setShowUploadModal(true)}
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
        onClose={() => setShowUploadModal(false)}
        onSubmit={handleUploadReport}
        projects={projects}
      />
      <ReportDetailsModal
        visible={showDetailsModal}
        report={selectedReport}
        onClose={handleCloseDetails}
        onApprove={(reportId) => {
          void handleReviewReport(reportId, 'Approved');
        }}
        onReject={(reportId) => {
          void handleReviewReport(reportId, 'Rejected');
        }}
        userRole={user?.role}
      />
    </>
  );
}
