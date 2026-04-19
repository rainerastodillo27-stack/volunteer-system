import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
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

type StatusColumn = {
  key: 'Approved' | 'Submitted' | 'Rejected';
  label: string;
  subtitle: string;
  count: number;
  accent: string;
  panel: string;
  card: string;
  chips: string[];
  reports: SubmittedReport[];
};

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getProgressPercent(report: SubmittedReport): number {
  const metricValues = Object.values(report.metrics).filter((value): value is number => typeof value === 'number');
  if (!metricValues.length) {
    return report.status === 'Approved' ? 100 : report.status === 'Submitted' ? 55 : 35;
  }

  const scaled = metricValues.slice(0, 4).reduce((sum, value) => sum + Math.min(value, 100), 0);
  return Math.max(8, Math.min(100, Math.round(scaled / Math.min(metricValues.length, 4))));
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
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' || width >= 1100;

  const summary = useMemo(() => {
    const totalHours = reports.reduce((sum, report) => sum + (report.metrics.volunteerHours || 0), 0);
    const verifiedAttendance = reports.reduce((sum, report) => sum + (report.metrics.verifiedAttendance || 0), 0);
    const beneficiariesServed = reports.reduce((sum, report) => sum + (report.metrics.beneficiariesServed || 0), 0);

    return {
      totalHours,
      verifiedAttendance,
      beneficiariesServed,
    };
  }, [reports]);

  const columns = useMemo<StatusColumn[]>(() => {
    const approved = reports
      .filter(report => report.status === 'Approved')
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    const submitted = reports
      .filter(report => report.status === 'Submitted')
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    const rejected = reports
      .filter(report => report.status === 'Rejected')
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    return [
      {
        key: 'Approved',
        label: 'Volunteer Hours',
        subtitle: 'Green lane',
        count: approved.length,
        accent: '#d9f2de',
        panel: '#2f8f45',
        card: '#4aa764',
        chips: ['A-Z', 'Recent first', 'Hours'],
        reports: approved,
      },
      {
        key: 'Submitted',
        label: 'Approved Collaborations',
        subtitle: 'Yellow lane',
        count: submitted.length,
        accent: '#fff6d9',
        panel: '#d1a120',
        card: '#dfb33f',
        chips: ['A-Z', 'Pending', 'Partner'],
        reports: submitted,
      },
      {
        key: 'Rejected',
        label: 'Field Reports',
        subtitle: 'Red lane',
        count: rejected.length,
        accent: '#ffdfe4',
        panel: '#bd3c4f',
        card: '#cd5a6d',
        chips: ['A-Z', 'Rejected', 'Program'],
        reports: rejected,
      },
    ];
  }, [reports]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4067d9" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.frame}>
          <View style={styles.masthead}>
            <View style={styles.logoTile}>
              <MaterialIcons name="assessment" size={28} color="#4d5cd6" />
            </View>
            <View style={styles.mastheadText}>
              <Text style={styles.title}>Analytics Report</Text>
              <Text style={styles.subtitle}>Keep report content unchanged, monitor progress by review status</Text>
            </View>
            <TouchableOpacity style={styles.uploadButton} onPress={onUploadReport} activeOpacity={0.85}>
              <MaterialIcons name="add" size={18} color="#fff" />
              <Text style={styles.uploadButtonText}>Upload report</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tabBar}>
            <Text style={styles.tabItem}>Reports</Text>
            <Text style={styles.tabDivider}>|</Text>
            <Text style={styles.tabDivider}>+</Text>
          </View>

          <View style={styles.kpiRow}>
            <Text style={styles.kpiText}>Volunteer Hours: {summary.totalHours}</Text>
            <Text style={styles.kpiText}>Approved Collaborations: {summary.verifiedAttendance}</Text>
            <Text style={styles.kpiText}>Field Reports: {summary.beneficiariesServed}</Text>
            <Text style={styles.kpiText}>Projects: {projects.length}</Text>
            <Text style={styles.kpiText}>Volunteers: {volunteers.length}</Text>
          </View>

          <View style={[styles.board, !isDesktop && styles.boardStacked]}>
            {columns.map(column => (
              <View key={column.key} style={[styles.columnPanel, { backgroundColor: column.panel }]}> 
                <View style={styles.columnHeader}>
                  <Text style={styles.bigCount}>{column.count}</Text>
                  <View style={styles.headerMeta}>
                    <Text style={styles.columnLabel}>{column.label}</Text>
                    <Text style={styles.columnSubLabel}>{column.subtitle}</Text>
                    <TouchableOpacity style={[styles.viewAllButton, { backgroundColor: column.card }]} activeOpacity={0.85}>
                      <Text style={styles.viewAllText}>View all</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.filterRow}>
                  <Text style={styles.filterHeading}>Show reports by</Text>
                  <View style={styles.chipRow}>
                    {column.chips.map(chip => (
                      <View key={chip} style={[styles.chip, { backgroundColor: column.card }]}>
                        <Text style={styles.chipText}>{chip}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <ScrollView style={styles.cardList} showsVerticalScrollIndicator={false}>
                  {column.reports.length === 0 ? (
                    <View style={[styles.emptyCard, { backgroundColor: column.card }]}> 
                      <MaterialIcons name="inbox" size={24} color="rgba(255,255,255,0.85)" />
                      <Text style={styles.emptyCardTitle}>No reports in this lane</Text>
                      <Text style={styles.emptyCardText}>Submitted reports will appear automatically.</Text>
                    </View>
                  ) : (
                    column.reports.slice(0, 8).map(report => {
                      const progress = getProgressPercent(report);
                      return (
                        <TouchableOpacity
                          key={report.id}
                          style={[styles.reportCard, { backgroundColor: column.card }]}
                          onPress={() => onViewReport(report)}
                          activeOpacity={0.85}
                        >
                          <View style={styles.reportTopRow}>
                            <Text style={styles.reportTitle} numberOfLines={1}>{report.title}</Text>
                            <Text style={styles.reportDate}>{formatShortDate(report.submittedAt)}</Text>
                          </View>
                          <Text style={styles.reportMeta} numberOfLines={1}>
                            {report.submitterName} • {report.projectTitle || 'No linked project'}
                          </Text>
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: column.accent }]} />
                          </View>
                          <Text style={styles.progressText}>{progress}% metrics captured</Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eceff6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eceff6',
  },
  frame: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  masthead: {
    backgroundColor: '#f2f4fa',
    borderWidth: 1,
    borderColor: '#d6dbea',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoTile: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e6e9ff',
  },
  mastheadText: {
    flex: 1,
  },
  title: {
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '700',
    color: '#2d333f',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#5f687a',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4067d9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  tabBar: {
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#c9cfde',
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tabItem: {
    fontSize: 32,
    color: '#3f4655',
    fontWeight: '500',
  },
  tabItemActive: {
    color: '#4067d9',
    borderBottomWidth: 3,
    borderBottomColor: '#4067d9',
    paddingBottom: 4,
  },
  tabDivider: {
    fontSize: 24,
    color: '#9aa2b1',
    fontWeight: '700',
  },
  kpiRow: {
    marginTop: 12,
    marginBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiText: {
    fontSize: 12,
    color: '#475069',
    fontWeight: '600',
    backgroundColor: '#dde3f2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  board: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  boardStacked: {
    flexDirection: 'column',
  },
  columnPanel: {
    flex: 1,
    borderRadius: 8,
    minHeight: 520,
    padding: 12,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bigCount: {
    fontSize: 78,
    lineHeight: 78,
    color: '#fff',
    fontWeight: '800',
  },
  headerMeta: {
    flex: 1,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  columnLabel: {
    fontSize: 32,
    lineHeight: 34,
    color: '#fff',
    fontWeight: '700',
  },
  columnSubLabel: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    fontWeight: '600',
  },
  viewAllButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  viewAllText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  filterRow: {
    marginTop: 12,
  },
  filterHeading: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  chipText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  cardList: {
    marginTop: 10,
    maxHeight: 460,
  },
  reportCard: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  reportTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  reportTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  reportDate: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11,
    fontWeight: '700',
  },
  reportMeta: {
    color: 'rgba(255,255,255,0.88)',
    marginTop: 4,
    fontSize: 11,
  },
  progressTrack: {
    marginTop: 8,
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.38)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressText: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyCard: {
    paddingVertical: 20,
    borderRadius: 10,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  emptyCardTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyCardText: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    textAlign: 'center',
  },
});


