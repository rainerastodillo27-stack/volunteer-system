import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Modal,
  FlatList,
  Dimensions,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { getProjects, getVolunteers, getMessages } from '../models/storage';
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
  const [filterType, setFilterType] = useState<SubmittedReport['reportType'] | 'all'>('all');
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
      // In a real app, fetch from API
      const cachedReports = await getMessages(user.id);
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
          viewedBy: ['admin1'],
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
      const allProjects = await getProjects();
      setProjects(allProjects);
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }, []);

  const loadVolunteers = useCallback(async () => {
    try {
      const allVolunteers = await getVolunteers();
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

  const filteredReports = useMemo(() => {
    if (filterType === 'all') return reports;
    return reports.filter(r => r.reportType === filterType);
  }, [reports, filterType]);

  const userReports = useMemo(() => {
    if (user?.role === 'admin') return filteredReports;
    return filteredReports.filter(r => r.submittedBy === user?.id);
  }, [filteredReports, user?.id, user?.role]);

  const renderReportCard = useCallback(
    ({ item }: { item: SubmittedReport }) => (
      <TouchableOpacity
        style={styles.reportCard}
        onPress={() => handleViewReport(item)}
        activeOpacity={0.7}
      >
        <View style={styles.reportCardHeader}>
          <View style={styles.reportCardTitle}>
            <Text style={styles.reportTitle}>{item.title}</Text>
            <Text style={styles.reportSubtitle}>{item.submitterName}</Text>
          </View>
          <View
            style={[
              styles.reportStatusBadge,
              item.status === 'Approved' && styles.statusApproved,
              item.status === 'Rejected' && styles.statusRejected,
              item.status === 'Draft' && styles.statusDraft,
              item.status === 'Submitted' && styles.statusSubmitted,
            ]}
          >
            <Text style={styles.reportStatusText}>{item.status}</Text>
          </View>
        </View>

        <Text style={styles.reportDescription}>{item.description}</Text>

        <View style={styles.reportMetrics}>
          {item.metrics.volunteerHours && (
            <View style={styles.metricBadge}>
              <MaterialIcons name="schedule" size={14} color="#666" />
              <Text style={styles.metricText}>{item.metrics.volunteerHours}h</Text>
            </View>
          )}
          {item.metrics.beneficiariesServed && (
            <View style={styles.metricBadge}>
              <MaterialIcons name="people" size={14} color="#666" />
              <Text style={styles.metricText}>{item.metrics.beneficiariesServed} served</Text>
            </View>
          )}
          {item.metrics.eventsCount && (
            <View style={styles.metricBadge}>
              <MaterialIcons name="event" size={14} color="#666" />
              <Text style={styles.metricText}>{item.metrics.eventsCount} events</Text>
            </View>
          )}
        </View>

        <View style={styles.reportFooter}>
          <Text style={styles.reportDate}>
            {new Date(item.submittedAt).toLocaleDateString()}
          </Text>
          {item.viewedBy && item.viewedBy.length > 0 && (
            <Text style={styles.viewCount}>Viewed by {item.viewedBy.length}</Text>
          )}
        </View>
      </TouchableOpacity>
    ),
    [handleViewReport]
  );

  const renderFilterButton = (type: SubmittedReport['reportType'] | 'all', label: string) => (
    <TouchableOpacity
      key={type}
      style={[styles.filterButton, filterType === type && styles.filterButtonActive]}
      onPress={() => setFilterType(type)}
    >
      <Text style={[styles.filterButtonText, filterType === type && styles.filterButtonTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  // Show role-specific dashboard
  if (user?.role === 'admin') {
    return (
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
    );
  }

  if (user?.role === 'partner') {
    return (
      <PartnerReportsDashboard
        reports={userReports}
        projects={projects}
        onUploadReport={() => setShowUploadModal(true)}
        onViewReport={handleViewReport}
        loading={loading}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    );
  }

  return (
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
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Platform.select({ web: 8, default: 15 }),
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  uploadButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  filterButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  reportCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  reportCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  reportCardTitle: {
    flex: 1,
  },
  reportTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  reportSubtitle: {
    fontSize: 12,
    color: '#64748b',
  },
  reportStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fef3c7',
  },
  statusApproved: {
    backgroundColor: '#dcfce7',
  },
  statusRejected: {
    backgroundColor: '#fee2e2',
  },
  statusDraft: {
    backgroundColor: '#f3f4f6',
  },
  statusSubmitted: {
    backgroundColor: '#dbeafe',
  },
  reportStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400e',
  },
  reportDescription: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 12,
  },
  reportMetrics: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  metricBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  metricText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  reportFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  reportDate: {
    fontSize: 11,
    color: '#94a3b8',
  },
  viewCount: {
    fontSize: 11,
    color: '#94a3b8',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748b',
  },
});
