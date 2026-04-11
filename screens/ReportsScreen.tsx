import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllProjects,
  getAllVolunteers,
  getMessagesForUser,
} from '../models/storage';
import type { Project, Volunteer, UserRole } from '../models/types';
import ReportUploadModal from '../components/ReportUploadModal';
import ReportDetailsModal from '../components/ReportDetailsModal';
import AdminReportsDashboard from '../components/AdminReportsDashboard';
import VolunteerReportsDashboard, { PartnerReportsDashboard } from '../components/VolunteerReportsDashboard';

export interface SubmittedReport {
  id: string;
  submittedBy: string;
  submitterName: string;
  submitterRole: UserRole;
  reportType: 'volunteer_engagement' | 'program_impact' | 'event_performance' | 'partner_collaboration' | 'system_metrics';
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

export default function ReportsScreen({ navigation }: any) {
  const { user } = useAuth();
  const [reports, setReports] = useState<SubmittedReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<SubmittedReport | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);

  // Load reports and supporting data
  useEffect(() => {
    void loadReports();
    void loadProjects();
    void loadVolunteers();
  }, [user?.id]);

  const loadReports = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const syncedMessages = await getMessagesForUser(user.id);
      // Transform messages to reports (placeholder - would need actual report API)
      const mockReports: SubmittedReport[] = [
        {
          id: 'rpt1',
          submittedBy: user.id,
          submitterName: user.name,
          submitterRole: user.role,
          reportType: 'volunteer_engagement',
          title: 'Weekly Volunteer Hours Report',
          description: 'Summary of volunteer engagement for this week',
          metrics: {
            volunteerHours: 156,
            verifiedAttendance: 45,
            activeVolunteers: 23,
          },
          status: 'Submitted',
          submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          viewedBy: syncedMessages.length > 0 ? ['admin1'] : [],
        },
      ];
      setReports(mockReports);
    } catch (error) {
      console.error('Error loading reports:', error);
      Alert.alert('Error', 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.name, user?.role]);

  const loadProjects = useCallback(async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }, []);

  const loadVolunteers = useCallback(async () => {
    try {
      const allVolunteers = await getAllVolunteers();
      setVolunteers(allVolunteers);
    } catch (error) {
      console.error('Error loading volunteers:', error);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  }, [loadReports]);

  const handleUploadReport = useCallback(
    async (reportData: Omit<SubmittedReport, 'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'>) => {
      if (!user?.id) return;

      const newReport: SubmittedReport = {
        ...reportData,
        id: `rpt_${Date.now()}`,
        submittedBy: user.id,
        submitterName: user.name,
        submitterRole: user.role,
        submittedAt: new Date().toISOString(),
        viewedBy: [],
      };

      try {
        // In production: POST to API
        setReports(prev => [newReport, ...prev]);
        setShowUploadModal(false);
        Alert.alert('Success', 'Report submitted successfully');
      } catch (error) {
        Alert.alert('Error', 'Failed to submit report');
      }
    },
    [user?.id, user?.name, user?.role]
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
    (reportId: string, nextStatus: 'Approved' | 'Rejected', notes: string) => {
      setReports(current =>
        current.map(report =>
          report.id === reportId
            ? {
                ...report,
                status: nextStatus,
                approvalNotes: notes || undefined,
                approvedBy: user?.name || user?.id || 'Admin',
                approvedAt: new Date().toISOString(),
              }
            : report
        )
      );
      handleCloseDetails();
    },
    [handleCloseDetails, user?.id, user?.name]
  );

  const userReports = useMemo(() => {
    if (user?.role === 'admin') return reports;
    return reports.filter(r => r.submittedBy === user?.id);
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
        onApprove={(reportId, notes) => handleReviewReport(reportId, 'Approved', notes)}
        onReject={(reportId, notes) => handleReviewReport(reportId, 'Rejected', notes)}
        userRole={user?.role}
      />
    </>
  );
}
