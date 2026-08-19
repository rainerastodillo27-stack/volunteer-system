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
import Svg, { Circle, Path, G } from 'react-native-svg';

function EmptyReportsIllustration() {
  return (
    <Svg width={180} height={140} viewBox="0 0 180 140" fill="none">
      <Circle cx={90} cy={75} r={38} fill="#E4EEE7" opacity={0.4} />
      <Path d="M45,55 C48,51 55,51 58,54 C61,51 68,51 71,55 C73,60 65,65 58,65 C51,65 43,60 45,55 Z" fill="#E4EEE7" opacity={0.5} />
      <Path d="M125,58 C128,55 133,55 135,57 C137,55 142,55 144,58 C145,61 140,64 135,64 C130,64 124,61 125,58 Z" fill="#E4EEE7" opacity={0.5} />
      
      <G opacity={0.6}>
        <Path d="M48,85 C51,75 59,73 63,70 C64,75 60,85 48,85 Z" fill="#6B8F71" />
        <Path d="M54,70 C56,62 63,60 66,58 C67,62 64,70 54,70 Z" fill="#6B8F71" />
        <Path d="M40,80 L62,86" stroke="#6B8F71" strokeWidth={1.5} strokeLinecap="round" />
      </G>
      
      <G opacity={0.6}>
        <Path d="M132,85 C129,75 121,73 117,70 C116,75 120,85 132,85 Z" fill="#6B8F71" />
        <Path d="M126,70 C124,62 117,60 114,58 C113,62 116,70 126,70 Z" fill="#6B8F71" />
        <Path d="M140,80 L118,86" stroke="#6B8F71" strokeWidth={1.5} strokeLinecap="round" />
      </G>
      
      <Path
        d="M74,42 L106,42 C110,42 113,45 113,49 L113,106 C113,110 110,113 106,113 L74,113 C70,113 67,110 67,106 L67,49 C67,45 70,42 74,42 Z"
        fill="#ffffff"
        stroke="#6B8F71"
        strokeWidth={2.5}
      />
      
      <Path
        d="M83,42 L83,37 C83,35 84,33 86,33 L94,33 C96,35 97,37 97,37 L97,42 Z"
        fill="#6B8F71"
      />
      
      <Circle cx={90} cy={78} r={14} fill="#3F7A54" />
      
      <Path
        d="M90,84 L90,72 M90,72 L86,76 M90,72 L94,76"
        stroke="#ffffff"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      <Path d="M78,98 L92,98" stroke="#E4EEE7" strokeWidth={2} strokeLinecap="round" />
      <Path d="M78,103 L85,103" stroke="#E4EEE7" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

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
  const visibleReports = useMemo(
    () => reports.filter(report => report.status !== 'Rejected'),
    [reports]
  );
  const eventCount = useMemo(
    () => new Set(visibleReports.map(report => report.projectId).filter(Boolean)).size,
    [visibleReports]
  );
  const stats = useMemo(() => {
    const submitted = visibleReports.filter(r => r.status === 'Submitted').length;
    const volunteerEventJoins = visibleReports.reduce(
      (sum, r) => sum + (r.metrics.volunteerEventJoins ?? r.metrics.volunteerHours ?? 0),
      0
    );
    const linkedProjects = new Set(visibleReports.map(report => report.projectId).filter(Boolean)).size;

    return { submitted, volunteerEventJoins, linkedProjects };
  }, [visibleReports]);

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
          <View style={styles.headerTitleWrap}>
            <Text style={styles.title}>My Event Reports</Text>
            <Text style={styles.subtitle}>Submit and manage reports for your completed volunteer activities.</Text>
          </View>
          <TouchableOpacity style={styles.uploadButton} onPress={onUploadReport} activeOpacity={0.8}>
            <MaterialIcons name="add" size={18} color="#fff" style={{ marginRight: 4 }} />
            <Text style={styles.uploadButtonText}>New Report</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <MaterialIcons name="description" size={20} color="#3F7A54" />
            </View>
            <View style={styles.statLabelWrap}>
              <Text style={styles.statCardLabel}>Reports</Text>
              <Text style={styles.statCardValue}>{visibleReports.length}</Text>
            </View>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <MaterialIcons name="send" size={20} color="#3F7A54" />
            </View>
            <View style={styles.statLabelWrap}>
              <Text style={styles.statCardLabel}>Submitted</Text>
              <Text style={styles.statCardValue}>{stats.submitted}</Text>
            </View>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <MaterialIcons name="calendar-month" size={20} color="#3F7A54" />
            </View>
            <View style={styles.statLabelWrap}>
              <Text style={styles.statCardLabel}>Linked Events</Text>
              <Text style={styles.statCardValue}>{eventCount}</Text>
            </View>
          </View>
        </View>

        {/* Reports List */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Report History</Text>
            {visibleReports.length > 0 ? (
              <TouchableOpacity style={styles.filterButton} activeOpacity={0.8}>
                <MaterialIcons name="filter-list" size={16} color="#22201B" style={{ marginRight: 6 }} />
                <Text style={styles.filterButtonText}>Filter ({visibleReports.length})</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.filterButton} activeOpacity={0.8}>
                <MaterialIcons name="filter-list" size={16} color="#22201B" style={{ marginRight: 6 }} />
                <Text style={styles.filterButtonText}>Filter</Text>
              </TouchableOpacity>
            )}
          </View>

          {visibleReports.length === 0 ? (
            <View style={styles.emptyCardContainer}>
              <View style={styles.emptyIllustrationWrap}>
                <EmptyReportsIllustration />
              </View>
              <Text style={styles.emptyTitle}>No reports yet</Text>
              <Text style={styles.emptyText}>
                Your submitted event reports will appear here. Reports help coordinators verify completed volunteer activities.
              </Text>
              <TouchableOpacity style={styles.emptyButton} onPress={onUploadReport} activeOpacity={0.8}>
                <MaterialIcons name="add" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.emptyButtonText}>Create First Report</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={visibleReports}
              renderItem={renderReportItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </View>

        {/* Tips Box */}
        <View style={styles.tipsCard}>
          <View style={styles.tipsIconWrap}>
            <MaterialIcons name="lightbulb-outline" size={20} color="#3F7A54" />
          </View>
          <View style={styles.tipsContent}>
            <Text style={styles.tipsTitle}>Reporting Tips</Text>
            <View style={styles.tipsBulletContainer}>
              <Text style={styles.tipsBulletRow}>•  Upload photos from the event.</Text>
              <Text style={styles.tipsBulletRow}>•  Describe your activities clearly.</Text>
              <Text style={styles.tipsBulletRow}>•  Submit within 48 hours after the event.</Text>
            </View>
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
  // Partner's own submitted reports (not volunteer reports)
  const ownReports = useMemo(
    () =>
      reports
        .filter(r => r.submitterRole === 'partner' && r.status !== 'Rejected')
        .sort(
          (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
        ),
    [reports]
  );

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

  const renderOwnReportItem = ({ item }: { item: SubmittedReport }) => (
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
              <Text style={styles.uploadButtonText}>Add Report</Text>
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

        {/* My Submitted Reports */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <MaterialIcons name="description" size={18} color="#166534" />
              <Text style={styles.sectionTitle}>My Submitted Reports</Text>
              <Text style={styles.sectionBadge}>{ownReports.length}</Text>
            </View>
            <TouchableOpacity style={styles.uploadButton} onPress={onUploadReport}>
              <MaterialIcons name="add" size={16} color="#fff" />
              <Text style={styles.uploadButtonText}>Add</Text>
            </TouchableOpacity>
          </View>
          {ownReports.length > 0 ? (
            <FlatList
              data={ownReports}
              renderItem={renderOwnReportItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          ) : (
            <View style={styles.emptyState}>
              <MaterialIcons name="upload-file" size={40} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No reports submitted yet</Text>
              <Text style={styles.emptyText}>
                Submit a partner report for your approved project to track impact.
              </Text>
            </View>
          )}
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
                          {`${account.verifiedAttendance} verified • ${account.beneficiariesServed} beneficiaries • ${account.volunteerEventJoins} event join${account.volunteerEventJoins === 1 ? '' : 's'}`}
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
    .filter(report => report.status !== 'Rejected')
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
            `  Volunteer Event Joins: ${account.volunteerEventJoins}`,
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
    `Volunteer Event Joins: ${formatMetricValue(summary.metrics.volunteerEventJoins ?? summary.metrics.volunteerHours)}`,
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
    backgroundColor: '#FAF5E9',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5E9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'transparent',
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 23,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    color: '#5B564C',
    lineHeight: 18,
  },
  uploadButton: {
    borderRadius: 100,
    backgroundColor: '#3F7A54',
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  uploadButtonText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
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
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DED2B4',
    gap: 8,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E4EEE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabelWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  statCardLabel: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 10,
    fontWeight: '700',
    color: '#5B564C',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statCardValue: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 18,
    fontWeight: '800',
    color: '#1F3A2E',
    marginTop: 2,
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
  emptyCardContainer: {
    backgroundColor: 'rgba(63,122,84,0.02)',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  emptyIllustrationWrap: {
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 20,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    color: '#5B564C',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#3F7A54',
    borderRadius: 100,
  },
  emptyButtonText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#fff',
    fontWeight: '700',
    fontSize: 13.5,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 100,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  filterButtonText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 12,
    fontWeight: '700',
    color: '#22201B',
  },
  tipsCard: {
    backgroundColor: '#F2E9D8',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 24,
  },
  tipsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E4EEE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipsContent: {
    flex: 1,
  },
  tipsTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 14.5,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 6,
  },
  tipsBulletContainer: {
    gap: 4,
  },
  tipsBulletRow: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 12.5,
    color: '#5B564C',
    lineHeight: 18,
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
