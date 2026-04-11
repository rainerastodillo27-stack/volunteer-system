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
import type { Project } from '../models/types';

interface VolunteerReportsDashboardProps {
  reports: SubmittedReport[];
  projects: Project[];
  onUploadReport: () => void;
  onViewReport: (report: SubmittedReport) => void;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

export function VolunteerReportsDashboard({
  reports,
  projects,
  onUploadReport,
  onViewReport,
  loading,
  onRefresh,
  refreshing,
}: VolunteerReportsDashboardProps) {
  const stats = useMemo(() => {
    const submitted = reports.filter(r => r.status === 'Submitted').length;
    const approved = reports.filter(r => r.status === 'Approved').length;
    const totalHours = reports.reduce((sum, r) => sum + (r.metrics.volunteerHours || 0), 0);

    return { submitted, approved, totalHours };
  }, [reports]);

  const renderReportItem = ({ item }: { item: SubmittedReport }) => (
    <TouchableOpacity
      style={styles.reportItem}
      onPress={() => onViewReport(item)}
      activeOpacity={0.7}
    >
      <View style={styles.reportItemLeft}>
        <View
          style={[
            styles.statusIndicator,
            item.status === 'Approved' && styles.statusIndicatorApproved,
            item.status === 'Submitted' && styles.statusIndicatorSubmitted,
            item.status === 'Rejected' && styles.statusIndicatorRejected,
          ]}
        />
        <View style={styles.reportItemContent}>
          <Text style={styles.reportItemTitle}>{item.title}</Text>
          <Text style={styles.reportItemType}>{formatReportType(item.reportType)}</Text>
          <Text style={styles.reportItemDate}>{new Date(item.submittedAt).toLocaleDateString()}</Text>
        </View>
      </View>
      <View
        style={[
          styles.reportStatusBadge,
          item.status === 'Approved' && styles.badgeApproved,
          item.status === 'Submitted' && styles.badgeSubmitted,
          item.status === 'Rejected' && styles.badgeRejected,
        ]}
      >
        <Text style={styles.badgeText}>{item.status}</Text>
      </View>
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
            <Text style={styles.title}>My Reports</Text>
            <Text style={styles.subtitle}>Track your submitted reports</Text>
          </View>
          <TouchableOpacity style={styles.uploadButton} onPress={onUploadReport}>
            <MaterialIcons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <MaterialIcons name="book" size={24} color="#1D4ED8" />
            <Text style={styles.statValue}>{reports.length}</Text>
            <Text style={styles.statLabel}>Total Reports</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialIcons name="check-circle" size={24} color="#16a34a" />
            <Text style={styles.statValue}>{stats.approved}</Text>
            <Text style={styles.statLabel}>Approved</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialIcons name="schedule" size={24} color="#F97316" />
            <Text style={styles.statValue}>{stats.totalHours}</Text>
            <Text style={styles.statLabel}>Total Hours</Text>
          </View>
        </View>

        {/* Reports List */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Report History</Text>
            {reports.length > 0 && (
              <Text style={styles.sectionBadge}>{reports.length}</Text>
            )}
          </View>

          {reports.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="upload-file" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No reports yet</Text>
              <Text style={styles.emptyText}>Start by uploading your first report</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={onUploadReport}>
                <MaterialIcons name="add-circle" size={16} color="#fff" />
                <Text style={styles.emptyButtonText}>Upload Report</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={reports}
              renderItem={renderReportItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <MaterialIcons name="info" size={18} color="#1D4ED8" />
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>Report Tips</Text>
            <Text style={styles.infoText}>
              Include accurate metrics and clear descriptions to ensure faster approval. Admins review submitted reports regularly.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export function PartnerReportsDashboard({
  reports,
  projects,
  onUploadReport,
  onViewReport,
  loading,
  onRefresh,
  refreshing,
}: VolunteerReportsDashboardProps) {
  const stats = useMemo(() => {
    const submitted = reports.filter(r => r.status === 'Submitted').length;
    const approved = reports.filter(r => r.status === 'Approved').length;
    const beneficiaries = reports.reduce((sum, r) => sum + (r.metrics.beneficiariesServed || 0), 0);

    return { submitted, approved, beneficiaries };
  }, [reports]);

  const reportsByType = useMemo(() => {
    const grouped: Record<string, SubmittedReport[]> = {};
    reports.forEach(r => {
      if (!grouped[r.reportType]) grouped[r.reportType] = [];
      grouped[r.reportType].push(r);
    });
    return grouped;
  }, [reports]);

  const renderReportItem = ({ item }: { item: SubmittedReport }) => (
    <TouchableOpacity
      style={styles.reportItem}
      onPress={() => onViewReport(item)}
      activeOpacity={0.7}
    >
      <View style={styles.reportItemLeft}>
        <MaterialIcons name={getReportIcon(item.reportType)} size={20} color="#166534" />
        <View style={styles.reportItemContent}>
          <Text style={styles.reportItemTitle}>{item.title}</Text>
          {item.projectTitle && (
            <Text style={styles.reportItemType}>{item.projectTitle}</Text>
          )}
          <Text style={styles.reportItemDate}>
            {new Date(item.submittedAt).toLocaleDateString()}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.reportStatusBadge,
          item.status === 'Approved' && styles.badgeApproved,
          item.status === 'Submitted' && styles.badgeSubmitted,
        ]}
      >
        <Text style={styles.badgeText}>{item.status}</Text>
      </View>
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
            <Text style={styles.title}>Program Reports</Text>
            <Text style={styles.subtitle}>Monitor program impact and progress</Text>
          </View>
          <TouchableOpacity style={styles.uploadButton} onPress={onUploadReport}>
            <MaterialIcons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Impact Metrics */}
        <View style={styles.impactContainer}>
          <View style={[styles.impactCard, styles.impactCardBlue]}>
            <Text style={styles.impactLabel}>Reports Submitted</Text>
            <Text style={styles.impactValue}>{reports.length}</Text>
          </View>
          <View style={[styles.impactCard, styles.impactCardGreen]}>
            <Text style={styles.impactLabel}>Approved</Text>
            <Text style={styles.impactValue}>{stats.approved}</Text>
          </View>
          <View style={[styles.impactCard, styles.impactCardOrange]}>
            <Text style={styles.impactLabel}>Beneficiaries</Text>
            <Text style={styles.impactValue}>{stats.beneficiaries}</Text>
          </View>
        </View>

        {/* Reports by Type */}
        {Object.entries(reportsByType).map(([typeKey, typeReports]) => (
          <View key={typeKey} style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name={getReportIcon(typeKey as any)} size={18} color="#166534" />
              <Text style={styles.sectionTitle}>{formatReportType(typeKey as any)}</Text>
              <Text style={styles.sectionBadge}>{typeReports.length}</Text>
            </View>
            <FlatList
              data={typeReports}
              renderItem={renderReportItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        ))}

        {reports.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialIcons name="trending-up" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No Reports Submitted</Text>
            <Text style={styles.emptyText}>
              Start documenting your program impact by submitting your first report
            </Text>
            <TouchableOpacity style={styles.emptyButton} onPress={onUploadReport}>
              <MaterialIcons name="add-circle" size={16} color="#fff" />
              <Text style={styles.emptyButtonText}>Create Report</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

export default VolunteerReportsDashboard;

export { PartnerReportsDashboard };

function formatReportType(type: string): string {
  const types: Record<string, string> = {
    volunteer_engagement: 'Volunteer Engagement',
    program_impact: 'Program Impact',
    event_performance: 'Event Performance',
    partner_collaboration: 'Partner Collaboration',
    system_metrics: 'System Metrics',
  };
  return types[type] || type;
}

function getReportIcon(type: string): string {
  const icons: Record<string, string> = {
    volunteer_engagement: 'people',
    program_impact: 'trending-up',
    event_performance: 'event',
    partner_collaboration: 'handshake',
    system_metrics: 'analytics',
  };
  return icons[type] || 'description';
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
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginVertical: 6,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
  },
  impactContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  impactCard: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  impactCardBlue: {
    backgroundColor: '#eff6ff',
  },
  impactCardGreen: {
    backgroundColor: '#f0fdf4',
  },
  impactCardOrange: {
    backgroundColor: '#fff7ed',
  },
  impactLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.6)',
    marginBottom: 6,
  },
  impactValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
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
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  sectionBadge: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  reportItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reportItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fbbf24',
  },
  statusIndicatorApproved: {
    backgroundColor: '#16a34a',
  },
  statusIndicatorSubmitted: {
    backgroundColor: '#3b82f6',
  },
  statusIndicatorRejected: {
    backgroundColor: '#dc2626',
  },
  reportItemContent: {
    flex: 1,
  },
  reportItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  reportItemType: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 2,
  },
  reportItemDate: {
    fontSize: 10,
    color: '#94a3b8',
  },
  reportStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#dbeafe',
  },
  badgeApproved: {
    backgroundColor: '#dcfce7',
  },
  badgeSubmitted: {
    backgroundColor: '#dbeafe',
  },
  badgeRejected: {
    backgroundColor: '#fee2e2',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0c4a6e',
  },
  separator: {
    height: 8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
    maxWidth: 240,
    marginBottom: 16,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#166534',
    borderRadius: 10,
  },
  emptyButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 12,
    backgroundColor: '#eff6ff',
    marginBottom: 12,
    marginHorizontal: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#1D4ED8',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  infoText: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
});
