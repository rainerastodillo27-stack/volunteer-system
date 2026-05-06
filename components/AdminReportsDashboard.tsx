import React, { useMemo, useState } from 'react';
import {
  Alert,
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
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
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
  key: 'all' | 'volunteer' | 'partner';
  label: string;
  subtitle: string;
  count: number;
  accent: string;
  panel: string;
  card: string;
  chips: string[];
  reports: SubmittedReport[];
};

type AccountReportGroup = {
  key: string;
  submitterName: string;
  submitterRole: SubmittedReport['submitterRole'];
  reports: SubmittedReport[];
  latestReport: SubmittedReport;
};

type ReportTableRow = {
  id: string;
  title: string;
  submitter: string;
  role: string;
  type: string;
  event: string;
  status: SubmittedReport['status'];
  submittedAt: string;
};

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getProgressPercent(report: SubmittedReport): number {
  const metricValues = Object.values(report.metrics).filter(
    (value): value is number => typeof value === 'number'
  );
  if (!metricValues.length) {
    return 55;
  }

  const scaled = metricValues
    .slice(0, 4)
    .reduce((sum, value) => sum + Math.min(value, 100), 0);
  return Math.max(
    8,
    Math.min(100, Math.round(scaled / Math.min(metricValues.length, 4)))
  );
}

function getLinkedActivityLabel(report: SubmittedReport): string {
  if (report.projectTitle) {
    return report.projectTitle;
  }

  return report.projectKind === 'event' ? 'No linked event' : 'No linked project';
}

function formatRoleLabel(role: SubmittedReport['submitterRole']): string {
  switch (role) {
    case 'volunteer':
      return 'Volunteer Account';
    case 'partner':
      return 'Partner Account';
    case 'admin':
      return 'Admin Account';
    default:
      return 'User Account';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapePdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatReportTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

function getEventNameForReport(
  report: SubmittedReport,
  eventsById: Map<string, { title: string }>
): string {
  if (report.projectId && eventsById.has(report.projectId)) {
    return eventsById.get(report.projectId)?.title || report.projectTitle || 'Event';
  }

  return report.projectKind === 'event' ? report.projectTitle || 'Unlisted event' : 'No linked event';
}

async function downloadFile(
  filename: string,
  content: string,
  type: string,
  fallbackMessage: string
) {
  const safeFilename = filename.replace(/[\\/:*?"<>|]+/g, '-');

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    return;
  }

  try {
    const sharingAvailable = await Sharing.isAvailableAsync();
    if (!sharingAvailable) {
      Alert.alert('Download Unavailable', fallbackMessage);
      return;
    }

    const file = new File(Paths.cache, safeFilename);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(content);

    await Sharing.shareAsync(file.uri, {
      mimeType: type,
      dialogTitle: safeFilename,
      UTI: type === 'application/pdf' ? 'com.adobe.pdf' : undefined,
    });
  } catch (error) {
    console.error('Unable to save report file:', error);
    Alert.alert('Download Failed', fallbackMessage);
  }
}

function buildReportsPdf(rows: ReportTableRow[], title: string): string {
  const lines = [
    title,
    `Generated: ${new Date().toLocaleString()}`,
    `Reports: ${rows.length}`,
    '',
    'Title | Submitter | Role | Type | Event | Status | Submitted',
    ...rows.map(row =>
      [
        truncateText(row.title, 28),
        truncateText(row.submitter, 18),
        truncateText(row.role, 16),
        truncateText(row.type, 18),
        truncateText(row.event, 24),
        row.status,
        row.submittedAt,
      ].join(' | ')
    ),
  ];
  const objects: string[] = [];
  const pageObjects: number[] = [];
  const rowsPerPage = 34;

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [] /Count 0 >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (let pageStart = 0; pageStart < lines.length; pageStart += rowsPerPage) {
    const pageLines = lines.slice(pageStart, pageStart + rowsPerPage);
    const stream = [
      'BT',
      '/F1 9 Tf',
      '40 800 Td',
      ...pageLines.flatMap((line, index) => [
        index === 0 ? '' : '0 -20 Td',
        `(${escapePdfText(line)}) Tj`,
      ]),
      'ET',
    ]
      .filter(Boolean)
      .join('\n');
    const contentObjectNumber = objects.length + 2;
    const pageObjectNumber = objects.length + 1;
    pageObjects.push(pageObjectNumber);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjects.map(objectNumber => `${objectNumber} 0 R`).join(' ')}] /Count ${pageObjects.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function groupReportsByAccount(reports: SubmittedReport[]): AccountReportGroup[] {
  const grouped = new Map<string, SubmittedReport[]>();

  reports.forEach(report => {
    const key = `${report.submitterRole}:${report.submittedBy || report.submitterName}`;
    const accountReports = grouped.get(key) || [];
    accountReports.push(report);
    grouped.set(key, accountReports);
  });

  return Array.from(grouped.entries())
    .map(([key, accountReports]) => {
      const sortedReports = [...accountReports].sort(
        (left, right) =>
          new Date(right.submittedAt).getTime() -
          new Date(left.submittedAt).getTime()
      );

      return {
        key,
        submitterName: sortedReports[0]?.submitterName || 'Unknown user',
        submitterRole: sortedReports[0]?.submitterRole || 'volunteer',
        reports: sortedReports,
        latestReport: sortedReports[0],
      };
    })
    .filter(group => Boolean(group.latestReport))
    .sort(
      (left, right) =>
        new Date(right.latestReport.submittedAt).getTime() -
        new Date(left.latestReport.submittedAt).getTime()
    );
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
  const [selectedEventId, setSelectedEventId] = useState('all');

  const summary = useMemo(() => {
    const totalHours = reports.reduce(
      (sum, report) => sum + (report.metrics.volunteerHours || 0),
      0
    );
    const verifiedAttendance = reports.reduce(
      (sum, report) => sum + (report.metrics.verifiedAttendance || 0),
      0
    );
    const beneficiariesServed = reports.reduce(
      (sum, report) => sum + (report.metrics.beneficiariesServed || 0),
      0
    );

    return {
      totalHours,
      verifiedAttendance,
      beneficiariesServed,
    };
  }, [reports]);

  const eventOptions = useMemo(() => {
    const events = projects
      .filter(project => project.isEvent)
      .map(project => ({ id: project.id, title: project.title || 'Untitled event' }));
    const existingEventIds = new Set(events.map(event => event.id));

    reports.forEach(report => {
      if (
        report.projectKind === 'event' &&
        report.projectId &&
        !existingEventIds.has(report.projectId)
      ) {
        events.push({
          id: report.projectId,
          title: report.projectTitle || 'Unlisted event',
        });
        existingEventIds.add(report.projectId);
      }
    });

    return events.sort((left, right) => left.title.localeCompare(right.title));
  }, [projects, reports]);

  const eventsById = useMemo(
    () => new Map(eventOptions.map(event => [event.id, event])),
    [eventOptions]
  );

  const eventReports = useMemo(
    () =>
      reports.filter(report => {
        const isEventReport =
          report.projectKind === 'event' ||
          Boolean(report.projectId && eventsById.has(report.projectId));

        if (!isEventReport) {
          return false;
        }

        return selectedEventId === 'all' || report.projectId === selectedEventId;
      }),
    [eventsById, reports, selectedEventId]
  );

  const selectedEventLabel = useMemo(() => {
    if (selectedEventId === 'all') {
      return 'All Events';
    }

    return eventsById.get(selectedEventId)?.title || 'Selected Event';
  }, [eventsById, selectedEventId]);

  const tableRows = useMemo<ReportTableRow[]>(
    () =>
      [...eventReports]
        .sort(
          (left, right) =>
            new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
        )
        .map(report => ({
          id: report.id,
          title: report.title || 'Untitled report',
          submitter: report.submitterName || 'Unknown user',
          role: formatRoleLabel(report.submitterRole),
          type: formatReportTypeLabel(report.reportType),
          event: getEventNameForReport(report, eventsById),
          status: report.status,
          submittedAt: new Date(report.submittedAt).toLocaleDateString(),
        })),
    [eventReports, eventsById]
  );

  const handleDownloadCsv = () => {
    const csv = [
      ['Title', 'Submitter', 'Role', 'Type', 'Event', 'Status', 'Submitted At'],
      ...tableRows.map(row => [
        row.title,
        row.submitter,
        row.role,
        row.type,
        row.event,
        row.status,
        row.submittedAt,
      ]),
    ]
      .map(columns =>
        columns.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');

    void downloadFile(
      `admin-event-reports-${selectedEventLabel}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8;',
      'Unable to save this CSV on the phone.'
    );
  };

  const handleDownloadPdf = () => {
    const pdf = buildReportsPdf(tableRows, `Admin Event Reports - ${selectedEventLabel}`);
    void downloadFile(
      `admin-event-reports-${selectedEventLabel}-${new Date().toISOString().slice(0, 10)}.pdf`,
      pdf,
      'application/pdf',
      'Unable to save this PDF on the phone.'
    );
  };

  const handlePrintTable = () => {
    if (typeof window === 'undefined') {
      Alert.alert('Print Unavailable', 'Printing is currently available on the admin web view.');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      Alert.alert('Print Blocked', 'Allow pop-ups in the browser to print the reports table.');
      return;
    }

    const rowsMarkup = tableRows
      .map(
        row => `
          <tr>
            <td>${escapeHtml(row.title)}</td>
            <td>${escapeHtml(row.submitter)}</td>
            <td>${escapeHtml(row.role)}</td>
            <td>${escapeHtml(row.type)}</td>
            <td>${escapeHtml(row.event)}</td>
            <td>${escapeHtml(row.status)}</td>
            <td>${escapeHtml(row.submittedAt)}</td>
          </tr>
        `
      )
      .join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Admin Reports Table</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin-bottom: 8px; }
            p { margin-top: 0; margin-bottom: 20px; color: #475569; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; font-size: 12px; }
            th { background: #e2e8f0; text-transform: uppercase; letter-spacing: 0.4px; font-size: 11px; }
          </style>
        </head>
        <body>
          <h1>Admin Event Reports</h1>
          <p>${escapeHtml(selectedEventLabel)} - Generated on ${escapeHtml(new Date().toLocaleString())}</p>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Submitter</th>
                <th>Role</th>
                <th>Type</th>
                <th>Event</th>
                <th>Status</th>
                <th>Submitted At</th>
              </tr>
            </thead>
            <tbody>${rowsMarkup}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const columns = useMemo<StatusColumn[]>(() => {
    const fieldReports = [...reports]
      .filter(report => report.reportType === 'field_report')
      .sort(
        (left, right) =>
          new Date(right.submittedAt).getTime() -
          new Date(left.submittedAt).getTime()
      );

    const volunteerReports = [...reports]
      .filter(
        report =>
          report.submitterRole === 'volunteer' &&
          report.reportType !== 'field_report'
      )
      .sort(
        (left, right) =>
          new Date(right.submittedAt).getTime() -
          new Date(left.submittedAt).getTime()
      );

    const partnerReports = [...reports]
      .filter(report => report.submitterRole === 'partner')
      .sort(
        (left, right) =>
          new Date(right.submittedAt).getTime() -
          new Date(left.submittedAt).getTime()
      );

    return [
      {
        key: 'all',
        label: 'Field Reports',
        subtitle: 'Assigned field officer submissions',
        count: groupReportsByAccount(fieldReports).length,
        accent: '#d9f2de',
        panel: '#2f8f45',
        card: '#4aa764',
        chips: ['Accounts', 'Field', 'Latest'],
        reports: fieldReports,
      },
      {
        key: 'volunteer',
        label: 'Volunteer Reports',
        subtitle: 'Regular volunteer submissions',
        count: groupReportsByAccount(volunteerReports).length,
        accent: '#fff6d9',
        panel: '#d1a120',
        card: '#dfb33f',
        chips: ['Accounts', 'Volunteer', 'Event'],
        reports: volunteerReports,
      },
      {
        key: 'partner',
        label: 'Partner Reports',
        subtitle: 'Program and event submissions',
        count: groupReportsByAccount(partnerReports).length,
        accent: '#ffdfe4',
        panel: '#bd3c4f',
        card: '#cd5a6d',
        chips: ['Accounts', 'Impact', 'Program'],
        reports: partnerReports,
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.frame}>
          <View style={styles.masthead}>
            <View style={styles.logoTile}>
              <MaterialIcons name="assessment" size={28} color="#4d5cd6" />
            </View>
            <View style={styles.mastheadText}>
              <Text style={styles.title}>Analytics Report</Text>
              <Text style={styles.subtitle}>
                Monitor submitted reports and field metrics across volunteers and
                partners
              </Text>
            </View>
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={onUploadReport}
              activeOpacity={0.85}
            >
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
            <Text style={styles.kpiText}>
              Attendance Metrics: {summary.verifiedAttendance}
            </Text>
            <Text style={styles.kpiText}>
              Beneficiaries: {summary.beneficiariesServed}
            </Text>
            <Text style={styles.kpiText}>Projects: {projects.length}</Text>
            <Text style={styles.kpiText}>Volunteers: {volunteers.length}</Text>
          </View>

          <View style={[styles.board, !isDesktop && styles.boardStacked]}>
            {columns.map(column => {
              const accountGroups = groupReportsByAccount(column.reports);

              return (
                <View
                  key={column.key}
                  style={[styles.columnPanel, { backgroundColor: column.panel }]}
                >
                  <View style={styles.columnHeader}>
                    <Text style={styles.bigCount}>{column.count}</Text>
                    <View style={styles.headerMeta}>
                      <Text style={styles.columnLabel}>{column.label}</Text>
                      <Text style={styles.columnSubLabel}>{column.subtitle}</Text>
                      <TouchableOpacity
                        style={[
                          styles.viewAllButton,
                          { backgroundColor: column.card },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.viewAllText}>View all</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.filterRow}>
                    <Text style={styles.filterHeading}>Show reports by</Text>
                    <View style={styles.chipRow}>
                      {column.chips.map(chip => (
                        <View
                          key={chip}
                          style={[styles.chip, { backgroundColor: column.card }]}
                        >
                          <Text style={styles.chipText}>{chip}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <ScrollView
                    style={styles.cardList}
                    showsVerticalScrollIndicator={false}
                  >
                    {accountGroups.length === 0 ? (
                      <View
                        style={[
                          styles.emptyCard,
                          { backgroundColor: column.card },
                        ]}
                      >
                        <MaterialIcons
                          name="inbox"
                          size={24}
                          color="rgba(255,255,255,0.85)"
                        />
                        <Text style={styles.emptyCardTitle}>No reports yet</Text>
                        <Text style={styles.emptyCardText}>
                          New submissions will appear here automatically.
                        </Text>
                      </View>
                    ) : (
                      accountGroups.slice(0, 8).map(account => {
                        return (
                          <View
                            key={account.key}
                            style={[
                              styles.reportCard,
                              { backgroundColor: column.card },
                            ]}
                          >
                            <View style={styles.reportTopRow}>
                              <Text
                                style={styles.reportTitle}
                                numberOfLines={1}
                              >
                                {account.submitterName}
                              </Text>
                            </View>
                            <Text style={styles.reportMeta} numberOfLines={1}>
                              {[
                                formatRoleLabel(account.submitterRole),
                                `${account.reports.length} ${account.reports.length === 1 ? 'report' : 'reports'}`,
                              ].join(' • ')}
                            </Text>
                            <Text
                              style={styles.reportSubtitle}
                              numberOfLines={1}
                            >
                              Reports in this account
                            </Text>

                            <View
                              style={styles.accountReportList}
                            >
                              {account.reports.map(report => {
                                const progress = getProgressPercent(report);

                                return (
                                  <TouchableOpacity
                                    key={report.id}
                                    style={styles.accountReportItem}
                                    onPress={() => onViewReport(report)}
                                    activeOpacity={0.85}
                                  >
                                    <View style={styles.accountReportTopRow}>
                                      <Text
                                        style={styles.accountReportEvent}
                                        numberOfLines={1}
                                      >
                                        {getLinkedActivityLabel(report)}
                                      </Text>
                                      <Text style={styles.accountReportDate}>
                                        {formatShortDate(report.submittedAt)}
                                      </Text>
                                    </View>
                                    <Text
                                      style={styles.accountReportTitle}
                                      numberOfLines={2}
                                    >
                                      {report.title || 'Untitled report'}
                                    </Text>
                                    <Text
                                      style={styles.accountReportType}
                                      numberOfLines={1}
                                    >
                                      {report.reportType.replace(/_/g, ' ')}
                                    </Text>
                                    <View style={styles.progressTrack}>
                                      <View
                                        style={[
                                          styles.progressFill,
                                          {
                                            width: `${progress}%`,
                                            backgroundColor: column.accent,
                                          },
                                        ]}
                                      />
                                    </View>
                                    <Text style={styles.progressText}>
                                      {progress}% metrics captured
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              );
            })}
          </View>

          <View style={styles.tableSection}>
            <View style={styles.tableSectionHeader}>
              <View>
                <Text style={styles.tableTitle}>Event Submitted Reports</Text>
                <Text style={styles.tableSubtitle}>
                  Select an event, then download CSV, download PDF, or print.
                </Text>
              </View>
              <View style={styles.tableActions}>
                <TouchableOpacity
                  style={[styles.tableActionButton, styles.tableDownloadButton]}
                  onPress={handleDownloadCsv}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="download" size={16} color="#fff" />
                  <Text style={styles.tableActionButtonText}>Download CSV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tableActionButton, styles.tablePdfButton]}
                  onPress={handleDownloadPdf}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="picture-as-pdf" size={16} color="#fff" />
                  <Text style={styles.tableActionButtonText}>Download PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tableActionButton, styles.tablePrintButton]}
                  onPress={handlePrintTable}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="print" size={16} color="#fff" />
                  <Text style={styles.tableActionButtonText}>Print</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.eventSelectorBlock}>
              <Text style={styles.eventSelectorLabel}>Download reports for</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.eventSelectorRow}>
                  <TouchableOpacity
                    style={[
                      styles.eventSelectorChip,
                      selectedEventId === 'all' && styles.eventSelectorChipActive,
                    ]}
                    onPress={() => setSelectedEventId('all')}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.eventSelectorChipText,
                        selectedEventId === 'all' && styles.eventSelectorChipTextActive,
                      ]}
                    >
                      All Events
                    </Text>
                  </TouchableOpacity>
                  {eventOptions.map(event => (
                    <TouchableOpacity
                      key={event.id}
                      style={[
                        styles.eventSelectorChip,
                        selectedEventId === event.id && styles.eventSelectorChipActive,
                      ]}
                      onPress={() => setSelectedEventId(event.id)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.eventSelectorChipText,
                          selectedEventId === event.id && styles.eventSelectorChipTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {event.title}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <Text style={styles.selectedEventHint}>
                Showing {tableRows.length} report{tableRows.length === 1 ? '' : 's'} for {selectedEventLabel}
              </Text>
            </View>

            {tableRows.length === 0 ? (
              <View style={styles.tableEmptyState}>
                <MaterialIcons name="table-rows" size={24} color="#7c8aa5" />
                <Text style={styles.tableEmptyTitle}>No reports available</Text>
                <Text style={styles.tableEmptyText}>
                  Event-linked reports will appear here for export and printing.
                </Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <View style={styles.table}>
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellExtraWide]}>Title</Text>
                    <Text style={[styles.tableCell, styles.tableHeaderCell]}>Submitter</Text>
                    <Text style={[styles.tableCell, styles.tableHeaderCell]}>Role</Text>
                    <Text style={[styles.tableCell, styles.tableHeaderCell]}>Type</Text>
                    <Text style={[styles.tableCell, styles.tableHeaderCell, styles.tableCellWide]}>Event</Text>
                    <Text style={[styles.tableCell, styles.tableHeaderCell]}>Status</Text>
                    <Text style={[styles.tableCell, styles.tableHeaderCell]}>Submitted</Text>
                  </View>
                  {tableRows.map(row => (
                    <TouchableOpacity
                      key={row.id}
                      style={styles.tableRow}
                      onPress={() => {
                        const report = reports.find(entry => entry.id === row.id);
                        if (report) {
                          onViewReport(report);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.tableCell, styles.tableCellExtraWide]} numberOfLines={2}>{row.title}</Text>
                      <Text style={styles.tableCell} numberOfLines={1}>{row.submitter}</Text>
                      <Text style={styles.tableCell} numberOfLines={1}>{row.role}</Text>
                      <Text style={styles.tableCell} numberOfLines={1}>{row.type}</Text>
                      <Text style={[styles.tableCell, styles.tableCellWide]} numberOfLines={1}>{row.event}</Text>
                      <View style={styles.statusCell}>
                        <Text style={styles.statusCellText}>{row.status}</Text>
                      </View>
                      <Text style={styles.tableCell} numberOfLines={1}>{row.submittedAt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
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
  tableSection: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f7f9fe',
    borderWidth: 1,
    borderColor: '#d7dcea',
  },
  tableSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  tableActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  tableActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  tableDownloadButton: {
    backgroundColor: '#2563eb',
  },
  tablePdfButton: {
    backgroundColor: '#b91c1c',
  },
  tablePrintButton: {
    backgroundColor: '#166534',
  },
  tableActionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  tableTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#233046',
  },
  tableSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#617086',
  },
  eventSelectorBlock: {
    marginBottom: 12,
    gap: 8,
  },
  eventSelectorLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#51607b',
    textTransform: 'uppercase',
  },
  eventSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  eventSelectorChip: {
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e9eef8',
    borderWidth: 1,
    borderColor: '#d1daee',
  },
  eventSelectorChipActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  eventSelectorChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#40506a',
  },
  eventSelectorChipTextActive: {
    color: '#fff',
  },
  selectedEventHint: {
    fontSize: 11,
    color: '#617086',
    fontWeight: '600',
  },
  tableCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#40506a',
    backgroundColor: '#e4e9f5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tableEmptyState: {
    paddingVertical: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#eef2fb',
  },
  tableEmptyTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '800',
    color: '#344055',
  },
  tableEmptyText: {
    marginTop: 4,
    fontSize: 11,
    color: '#617086',
  },
  table: {
    minWidth: 920,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#cfd7e8',
    paddingBottom: 10,
    marginBottom: 6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e3e8f2',
  },
  tableCell: {
    flex: 1,
    paddingRight: 10,
    fontSize: 12,
    color: '#2f3a4c',
    fontWeight: '600',
  },
  tableHeaderCell: {
    color: '#51607b',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  tableCellWide: {
    flex: 1.4,
  },
  tableCellExtraWide: {
    flex: 1.8,
  },
  statusCell: {
    flex: 1,
    marginRight: 10,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#d9f2de',
  },
  statusCellText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#245c34',
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
    paddingVertical: 9,
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
    fontSize: 14,
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
  reportSubtitle: {
    color: '#fff',
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  reportCountText: {
    color: 'rgba(255,255,255,0.86)',
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
  },
  accountReportList: {
    marginTop: 8,
    gap: 8,
  },
  accountReportItem: {
    width: '100%',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  accountReportTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  accountReportEvent: {
    flex: 1,
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  accountReportDate: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 10,
    fontWeight: '700',
  },
  accountReportTitle: {
    marginTop: 5,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  accountReportType: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.84)',
    fontSize: 10,
    textTransform: 'capitalize',
  },
  progressTrack: {
    marginTop: 7,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.38)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressText: {
    marginTop: 5,
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
