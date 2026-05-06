import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Alert,
  TouchableOpacity,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type {
  PartnerProjectReportSummary,
  SubmittedReport,
} from '../screens/ReportsScreen';
import type { Project } from '../models/types';
import { buildTextPdf, downloadPdfFile } from '../utils/pdfDownload';

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

interface VolunteerReportsDashboardProps {
  reports: SubmittedReport[];
  projects: Project[];
  onUploadReport: () => void;
  onViewReport: (report: SubmittedReport) => void;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  projectSummaries?: PartnerProjectReportSummary[];
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
  const eventCount = useMemo(
    () => new Set(reports.map(report => report.projectId).filter(Boolean)).size,
    [reports]
  );
  const stats = useMemo(() => {
    const submitted = reports.filter(r => r.status === 'Submitted').length;
    const totalHours = reports.reduce((sum, r) => sum + (r.metrics.volunteerHours || 0), 0);
    const linkedProjects = new Set(reports.map(report => report.projectId).filter(Boolean)).size;

    return { submitted, totalHours, linkedProjects };
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
          {item.projectTitle ? (
            <Text style={styles.reportItemDate}>{item.projectTitle}</Text>
          ) : null}
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
            <Text style={styles.title}>My Event Reports</Text>
            <Text style={styles.subtitle}>Track reports connected to your joined events</Text>
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
            <MaterialIcons name="send" size={24} color="#16a34a" />
            <Text style={styles.statValue}>{stats.submitted}</Text>
            <Text style={styles.statLabel}>Submitted</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialIcons name="schedule" size={24} color="#F97316" />
            <Text style={styles.statValue}>{eventCount}</Text>
            <Text style={styles.statLabel}>Events Linked</Text>
          </View>
        </View>

        {/* Reports List */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Event Report History</Text>
            {reports.length > 0 && (
              <Text style={styles.sectionBadge}>{reports.length}</Text>
            )}
          </View>

          {reports.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="upload-file" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No reports yet</Text>
              <Text style={styles.emptyText}>
                Start by uploading your first report for a joined event
              </Text>
              <TouchableOpacity style={styles.emptyButton} onPress={onUploadReport}>
                <MaterialIcons name="add-circle" size={16} color="#fff" />
                <Text style={styles.emptyButtonText}>Upload Event Report</Text>
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
              Link each report to the exact event you joined, add a short reflection, and upload a photo when you can so the admin side has complete event documentation.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export function PartnerReportsDashboard({
  reports,
  projectSummaries = [],
  onUploadReport,
  onViewReport,
  loading,
  onRefresh,
  refreshing,
}: VolunteerReportsDashboardProps) {
  const stats = useMemo(() => {
    const submitted = projectSummaries.reduce(
      (sum, summary) => sum + getVolunteerReportsForSummary(summary).length,
      0
    );
    const beneficiaries = projectSummaries.reduce(
      (sum, summary) => sum + (summary.metrics.beneficiariesServed || 0),
      0
    );
    const linkedProjects = projectSummaries.length;

    return { submitted, beneficiaries, linkedProjects };
  }, [projectSummaries]);

  const projectSections = useMemo(
    () =>
      projectSummaries.map(summary => ({
        key: summary.project.id,
        title: summary.project.title,
        subtitle: `${summary.linkedEvents.length} linked event${summary.linkedEvents.length === 1 ? '' : 's'} • ${summary.volunteerAccounts.length} volunteer account${summary.volunteerAccounts.length === 1 ? '' : 's'}`,
        reports: getVolunteerReportsForSummary(summary),
        summary,
      })),
    [projectSummaries]
  );

  const handleDownloadProjectSummary = (summary: PartnerProjectReportSummary) => {
    const title = `${summary.project.title} Project Summary`;
    void downloadPdfFile(
      `${summary.project.title}-summary-${new Date().toISOString().slice(0, 10)}.pdf`,
      buildTextPdf(title, buildProjectSummaryContent(summary))
    );
  };

  const handleDownloadAllSummaries = () => {
    if (!projectSummaries.length) {
      Alert.alert('Reports', 'There are no approved partner projects to summarize yet.');
      return;
    }

    void downloadPdfFile(
      `partner-project-summaries-${new Date().toISOString().slice(0, 10)}.pdf`,
      buildTextPdf(
        'Partner Project Summaries',
        projectSummaries
          .map(summary => buildProjectSummaryContent(summary))
          .join('\n\n==================================================\n\n')
      )
    );
  };

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
          <Text style={styles.reportItemType}>Volunteer account: {item.submitterName}</Text>
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
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.secondaryHeaderButton} onPress={handleDownloadAllSummaries}>
              <MaterialIcons name="download" size={18} color="#166534" />
              <Text style={styles.secondaryHeaderButtonText}>All PDFs</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uploadButton} onPress={onUploadReport}>
              <MaterialIcons name="add" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Impact Metrics */}
        <View style={styles.impactContainer}>
          <View style={[styles.impactCard, styles.impactCardBlue]}>
            <Text style={styles.impactLabel}>Reports Submitted</Text>
            <Text style={styles.impactValue}>{stats.submitted}</Text>
          </View>
          <View style={[styles.impactCard, styles.impactCardGreen]}>
            <Text style={styles.impactLabel}>Projects Linked</Text>
            <Text style={styles.impactValue}>{stats.linkedProjects}</Text>
          </View>
          <View style={[styles.impactCard, styles.impactCardOrange]}>
            <Text style={styles.impactLabel}>Beneficiaries</Text>
            <Text style={styles.impactValue}>{stats.beneficiaries}</Text>
          </View>
        </View>

        {projectSections.map(section => (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <MaterialIcons name="folder" size={18} color="#166534" />
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionBadge}>{section.reports.length}</Text>
              </View>
              <TouchableOpacity
                style={styles.inlineActionButton}
                onPress={() => handleDownloadProjectSummary(section.summary)}
              >
                <MaterialIcons name="download" size={16} color="#166534" />
                <Text style={styles.inlineActionButtonText}>PDF</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.reportItemType}>{section.subtitle}</Text>
            {section.reports.length > 0 ? (
              <FlatList
                data={section.reports}
                renderItem={renderReportItem}
                keyExtractor={item => item.id}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
              />
            ) : (
              <View style={styles.emptyState}>
                <MaterialIcons name="description" size={40} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>No volunteer reports yet</Text>
                <Text style={styles.emptyText}>
                  Volunteer reports from the linked approved project events will appear here.
                </Text>
              </View>
            )}

            {section.summary.volunteerAccounts.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="groups" size={18} color="#166534" />
                  <Text style={styles.sectionTitle}>Volunteer Accounts</Text>
                  <Text style={styles.sectionBadge}>{section.summary.volunteerAccounts.length}</Text>
                </View>
                {section.summary.volunteerAccounts.map(account => (
                  <TouchableOpacity
                    key={account.key}
                    style={styles.reportItem}
                    onPress={() => {
                      if (account.reports[0]) {
                        onViewReport(account.reports[0]);
                      }
                    }}
                    activeOpacity={account.reports[0] ? 0.7 : 1}
                  >
                    <View style={styles.reportItemLeft}>
                      <MaterialIcons name="person" size={20} color="#166534" />
                      <View style={styles.reportItemContent}>
                        <Text style={styles.reportItemTitle}>{account.submitterName}</Text>
                        <Text style={styles.reportItemType}>
                          {`${account.verifiedAttendance} verified • ${account.beneficiariesServed} beneficiaries • ${Number.isInteger(account.volunteerHours) ? account.volunteerHours : account.volunteerHours.toFixed(1)} hours`}
                        </Text>
                        <Text style={styles.reportItemDate}>
                          {account.reports.length} volunteer report{account.reports.length === 1 ? '' : 's'}
                          {account.reports.length > 0 ? ' • Tap to open latest report' : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.reportStatusBadge}>
                      <Text style={styles.badgeText}>{account.reports.length}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        {projectSections.length === 0 && (
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

function getVolunteerReportsForSummary(summary: PartnerProjectReportSummary): SubmittedReport[] {
  return summary.volunteerAccounts
    .flatMap(account => account.reports)
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
    );
}

function formatMetricValue(value?: number): string {
  if (!value) {
    return '0';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildProjectSummaryContent(summary: PartnerProjectReportSummary): string {
  const volunteerReports = getVolunteerReportsForSummary(summary);
  const linkedEvents = summary.linkedEvents.length
    ? summary.linkedEvents
        .map(
          event =>
            `- ${event.title}${event.startDate ? ` (${new Date(event.startDate).toLocaleDateString()})` : ''}`
        )
        .join('\n')
    : 'No linked events yet.';
  const volunteerAccounts = summary.volunteerAccounts.length
    ? summary.volunteerAccounts
        .map(account =>
          [
            `- ${account.submitterName}`,
            `  Volunteer Reports: ${account.reports.length}`,
            `  Verified Attendance: ${account.verifiedAttendance}`,
            `  Volunteer Hours: ${formatMetricValue(account.volunteerHours)}`,
            `  Beneficiaries Served: ${account.beneficiariesServed}`,
            account.reports.length
              ? `  Reports: ${account.reports.map(report => report.title).join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join('\n')
        )
        .join('\n\n')
    : 'No volunteer accounts yet.';
  const reportDetails = volunteerReports.length
    ? volunteerReports
        .map(report =>
          [
            `- ${report.title}`,
            `  Volunteer Account: ${report.submitterName}`,
            report.projectTitle ? `  Event: ${report.projectTitle}` : null,
            `  Status: ${report.status}`,
            `  Submitted: ${new Date(report.submittedAt).toLocaleString()}`,
            `  Description: ${report.description || 'No description provided.'}`,
          ]
            .filter(Boolean)
            .join('\n')
        )
        .join('\n\n')
    : 'No volunteer reports yet.';

  return [
    `Project Summary: ${summary.project.title}`,
    `Project Description: ${summary.project.description || 'No project description provided.'}`,
    '',
    'Project Metrics',
    `Volunteer Reports Submitted: ${volunteerReports.length}`,
    `Verified Attendance: ${formatMetricValue(summary.metrics.verifiedAttendance)}`,
    `Volunteer Hours: ${formatMetricValue(summary.metrics.volunteerHours)}`,
    `Active Volunteers: ${formatMetricValue(summary.metrics.activeVolunteers)}`,
    `Beneficiaries Served: ${formatMetricValue(summary.metrics.beneficiariesServed)}`,
    `Linked Events Count: ${summary.linkedEvents.length}`,
    '',
    'Linked Events',
    linkedEvents,
    '',
    'Volunteer Accounts',
    volunteerAccounts,
    '',
    'Volunteer Report Details',
    reportDetails,
  ].join('\n');
}

function formatReportType(type: string): string {
  const types: Record<string, string> = {
    General: 'General Report',
    Medical: 'Medical Report',
    Logistics: 'Logistics Report',
    field_report: 'Field Report',
    volunteer_engagement: 'Volunteer Engagement',
    program_impact: 'Program Impact',
    event_performance: 'Event Performance',
    partner_collaboration: 'Partner Collaboration',
    system_metrics: 'System Metrics',
  };
  return types[type] || type;
}

function getReportIcon(type: string): MaterialIconName {
  const icons: Record<string, MaterialIconName> = {
    General: 'description',
    Medical: 'local-hospital',
    Logistics: 'local-shipping',
    field_report: 'assignment',
    volunteer_engagement: 'people',
    program_impact: 'trending-up',
    event_performance: 'event',
    partner_collaboration: 'groups',
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  secondaryHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  secondaryHeaderButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
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
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  inlineActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe4ee',
  },
  inlineActionButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
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
