import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { SubmittedReport } from '../screens/ReportsScreen';
import type { Project, Volunteer } from '../models/types';

interface AdminReportsDashboardProps {
  reports: SubmittedReport[];
  projects: Project[];
  volunteers: Volunteer[];
  onUploadReport: () => void;
  onViewReport: (report: SubmittedReport) => void;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

export default function AdminReportsDashboard({
  reports,
  projects,
  volunteers,
  onUploadReport,
  onViewReport,
  loading,
  onRefresh,
  refreshing,
}: AdminReportsDashboardProps) {
  // Calculate dashboard metrics
  const metrics = useMemo(() => {
    const totalHours = reports.reduce((sum, r) => sum + (r.metrics.volunteerHours || 0), 0);
    const totalAttendance = reports.reduce((sum, r) => sum + (r.metrics.verifiedAttendance || 0), 0);
    const activeVolunteers = new Set(reports.flatMap(r => r.submittedBy)).size;
    const totalBeneficiaries = reports.reduce((sum, r) => sum + (r.metrics.beneficiariesServed || 0), 0);
    const approvedReports = reports.filter(r => r.status === 'Approved').length;
    const pendingReports = reports.filter(r => r.status === 'Submitted').length;

    return {
      totalHours,
      totalAttendance,
      activeVolunteers,
      totalBeneficiaries,
      approvedReports,
      pendingReports,
    };
  }, [reports]);

  // Group reports by status
  const reportsByStatus = useMemo(() => {
    return {
      submitted: reports.filter(r => r.status === 'Submitted'),
      approved: reports.filter(r => r.status === 'Approved'),
      rejected: reports.filter(r => r.status === 'Rejected'),
    };
  }, [reports]);

  const renderMetricCard = (icon: string, label: string, value: string | number, color: string) => (
    <View style={[styles.metricCard, { borderLeftColor: color }]}>
      <View style={[styles.metricIconBox, { backgroundColor: color }]}>
        <MaterialIcons name={icon as any} size={20} color="#fff" />
      </View>
      <View style={styles.metricContent}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, { color }]}>{value}</Text>
      </View>
    </View>
  );

  const renderReportCard = ({ item }: { item: SubmittedReport }) => (
    <TouchableOpacity
      style={styles.reportCard}
      onPress={() => onViewReport(item)}
      activeOpacity={0.7}
    >
      <View style={styles.reportCardHeader}>
        <View style={styles.reportInfo}>
          <Text style={styles.reportTitle}>{item.title}</Text>
          <Text style={styles.reportSubmitter}>{item.submitterName}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            item.status === 'Approved' && styles.statusApproved,
            item.status === 'Rejected' && styles.statusRejected,
          ]}
        >
          <Text style={styles.statusLabel}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.reportDescription}>{item.description}</Text>
      <Text style={styles.reportDate}>{new Date(item.submittedAt).toLocaleDateString()}</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Reports Dashboard</Text>
            <Text style={styles.subtitle}>Manage and review all submitted reports</Text>
          </View>
          <TouchableOpacity style={styles.uploadButton} onPress={onUploadReport}>
            <MaterialIcons name="add-circle" size={18} color="#fff" />
            <Text style={styles.uploadButtonText}>Upload</Text>
          </TouchableOpacity>
        </View>

        {/* Key Metrics */}
        <View style={styles.metricsSection}>
          <Text style={styles.sectionTitle}>Key Performance Indicators</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metricsScroll}>
            {renderMetricCard('schedule', 'Total Hours', metrics.totalHours, '#1D4ED8')}
            {renderMetricCard('people', 'Active Volunteers', metrics.activeVolunteers, '#9333EA')}
            {renderMetricCard('verified', 'Verified Attendance', metrics.totalAttendance, '#DC2626')}
            {renderMetricCard('favorite', 'Beneficiaries Served', metrics.totalBeneficiaries, '#F97316')}
          </ScrollView>
        </View>

        {/* Report Status Overview */}
        <View style={styles.statusOverviewSection}>
          <Text style={styles.sectionTitle}>Report Status Overview</Text>
          <View style={styles.statusGrid}>
            <View style={[styles.statusCard, styles.pendingStatus]}>
              <Text style={styles.statusCardLabel}>Pending Review</Text>
              <Text style={styles.statusCardValue}>{metrics.pendingReports}</Text>
              <Text style={styles.statusCardAction}>Action Required</Text>
            </View>
            <View style={[styles.statusCard, styles.approvedStatus]}>
              <Text style={styles.statusCardLabel}>Approved</Text>
              <Text style={styles.statusCardValue}>{metrics.approvedReports}</Text>
              <Text style={styles.statusCardAction}>Confirmed</Text>
            </View>
            <View style={[styles.statusCard, styles.rejectedStatus]}>
              <Text style={styles.statusCardLabel}>Rejected</Text>
              <Text style={styles.statusCardValue}>{reportsByStatus.rejected.length}</Text>
              <Text style={styles.statusCardAction}>Revisions Needed</Text>
            </View>
          </View>
        </View>

        {/* Pending Reports Section */}
        {reportsByStatus.submitted.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="hourglass-empty" size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Pending Review ({reportsByStatus.submitted.length})</Text>
            </View>
            <FlatList
              data={reportsByStatus.submitted}
              renderItem={renderReportCard}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        )}

        {/* Recent Reports */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="list" size={20} color="#166534" />
            <Text style={styles.sectionTitle}>Recent Reports</Text>
          </View>
          {reports.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="folder-open" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No reports yet</Text>
              <Text style={styles.emptyText}>Reports submitted by volunteers and partners will appear here</Text>
            </View>
          ) : (
            <FlatList
              data={reports.slice(0, 10)}
              renderItem={renderReportCard}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  uploadButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  metricsSection: {
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  metricsScroll: {
    paddingHorizontal: 0,
  },
  metricCard: {
    width: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginRight: 10,
    borderRadius: 12,
    borderLeftWidth: 4,
    backgroundColor: '#f8fafc',
  },
  metricIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricContent: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  statusOverviewSection: {
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 12,
  },
  statusGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statusCard: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  pendingStatus: {
    backgroundColor: '#fef3c7',
  },
  approvedStatus: {
    backgroundColor: '#dcfce7',
  },
  rejectedStatus: {
    backgroundColor: '#fee2e2',
  },
  statusCardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.6)',
    marginBottom: 4,
  },
  statusCardValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  statusCardAction: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(0, 0, 0, 0.5)',
  },
  section: {
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  reportCard: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reportCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  reportInfo: {
    flex: 1,
  },
  reportTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  reportSubmitter: {
    fontSize: 11,
    color: '#64748b',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#dbeafe',
  },
  statusApproved: {
    backgroundColor: '#dcfce7',
  },
  statusRejected: {
    backgroundColor: '#fee2e2',
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0c4a6e',
  },
  reportDescription: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
    marginBottom: 8,
  },
  reportDate: {
    fontSize: 10,
    color: '#94a3b8',
  },
  separator: {
    height: 8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 12,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    maxWidth: 200,
  },
});
