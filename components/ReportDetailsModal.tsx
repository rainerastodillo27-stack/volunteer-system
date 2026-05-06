import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  TextInput,
  Image,
  useWindowDimensions,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { SubmittedReport } from '../screens/ReportsScreen';
import {
  getAttachmentLabel,
  getAttachmentUris,
  isImageMediaUri,
  openAttachmentUri,
} from '../utils/media';
import { buildTextPdf, downloadPdfFile } from '../utils/pdfDownload';

interface ReportDetailsModalProps {
  visible: boolean;
  report: SubmittedReport | null;
  onClose: () => void;
  onApprove?: (reportId: string, notes: string) => void;
  onReject?: (reportId: string, notes: string) => void;
  userRole?: 'admin' | 'volunteer' | 'partner';
  showModerationActions?: boolean;
}

export default function ReportDetailsModal({
  visible,
  report,
  onClose,
  onApprove,
  onReject,
  userRole,
  showModerationActions = false,
}: ReportDetailsModalProps) {
  const [approvalNotes, setApprovalNotes] = useState('');
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
  const { width } = useWindowDimensions();

  if (!report) return null;

  const handleApprove = () => {
    if (onApprove) {
      onApprove(report.id, approvalNotes);
      setApprovalNotes('');
      setShowApprovalForm(false);
    }
  };

  const handleReject = () => {
    if (onReject) {
      onReject(report.id, approvalNotes);
      setApprovalNotes('');
      setShowApprovalForm(false);
    }
  };

  const handleClose = () => {
    setApprovalNotes('');
    setShowApprovalForm(false);
    setActionType(null);
    onClose();
  };

  const canApprove = showModerationActions && userRole === 'admin' && report.status === 'Submitted';
  const isWideLayout = Platform.OS === 'web' && width >= 960;
  const attachmentPreviews = getAttachmentUris([
    report.mediaFile || '',
    ...(report.attachments || []),
  ]);
  const statusPresentation = getStatusPresentation(report.status);
  const handleOpenAttachment = async (uri: string) => {
    try {
      await openAttachmentUri(uri);
    } catch (error) {
      console.error('Unable to open report attachment:', error);
      Alert.alert('Attachment', 'Unable to open this attachment on this device.');
    }
  };
  const handleDownloadReport = () => {
    void downloadPdfFile(
      `${report.title}-${new Date(report.submittedAt).toISOString().slice(0, 10)}.pdf`,
      buildTextPdf(report.title, buildReportDownloadContent(report))
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={[styles.container, isWideLayout && styles.containerWide]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text style={styles.title}>{report.title}</Text>
              <Text style={styles.submitter}>Submitted by {report.submitterName}</Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.downloadButton} onPress={handleDownloadReport}>
                <MaterialIcons name="download" size={18} color="#166534" />
                <Text style={styles.downloadButtonText}>PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerCloseButton} onPress={handleClose} hitSlop={8}>
                <MaterialIcons name="close" size={24} color="#0f172a" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator
          >
            {/* Status Section */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: statusPresentation.badgeBackground },
                  ]}
                >
                  <MaterialIcons
                    name={statusPresentation.icon}
                    size={16}
                    color={statusPresentation.badgeText}
                  />
                  <Text style={[styles.statusText, { color: statusPresentation.badgeText }]}>
                    {report.status}
                  </Text>
                </View>

                <View style={styles.dateInfo}>
                  <MaterialIcons name="calendar-today" size={14} color="#64748b" />
                  <Text style={styles.dateText}>
                    {new Date(report.submittedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </Text>
                </View>
              </View>

              <View style={[styles.metadataSection, isWideLayout && styles.metadataSectionWide]}>
                <View style={[styles.metadataItem, isWideLayout && styles.metadataItemWide]}>
                  <Text style={styles.metadataLabel}>Report Type</Text>
                  <Text style={styles.metadataValue}>{formatReportType(report.reportType)}</Text>
                </View>
                {report.projectTitle && (
                  <View style={[styles.metadataItem, isWideLayout && styles.metadataItemWide]}>
                    <Text style={styles.metadataLabel}>
                      {report.projectKind === 'event' ? 'Event' : 'Project'}
                    </Text>
                    <Text style={styles.metadataValue}>{report.projectTitle}</Text>
                  </View>
                )}
                {report.category && (
                  <View style={[styles.metadataItem, isWideLayout && styles.metadataItemWide]}>
                    <Text style={styles.metadataLabel}>Category</Text>
                    <Text style={styles.metadataValue}>{report.category}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Description */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.descriptionText}>{report.description}</Text>
            </View>

            {(report.collaborationFeedback || report.volunteerPraise || report.gratitudeNote) && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Partner Feedback</Text>
                {report.collaborationFeedback ? (
                  <View style={styles.feedbackBlock}>
                    <Text style={styles.feedbackLabel}>How Was the Collaboration?</Text>
                    <Text style={styles.descriptionText}>{report.collaborationFeedback}</Text>
                  </View>
                ) : null}
                {report.volunteerPraise ? (
                  <View style={styles.feedbackBlock}>
                    <Text style={styles.feedbackLabel}>Praise for the Volunteers</Text>
                    <Text style={styles.descriptionText}>{report.volunteerPraise}</Text>
                  </View>
                ) : null}
                {report.gratitudeNote ? (
                  <View style={styles.feedbackBlock}>
                    <Text style={styles.feedbackLabel}>Thank You Note</Text>
                    <Text style={styles.descriptionText}>{report.gratitudeNote}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {attachmentPreviews.length > 0 && (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Attachments</Text>
                  <Text style={styles.sectionCaption}>
                    {attachmentPreviews.length} file{attachmentPreviews.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={[styles.attachmentsList, isWideLayout && styles.attachmentsListWide]}>
                  {attachmentPreviews.map(uri =>
                    isImageMediaUri(uri) ? (
                      <TouchableOpacity
                        key={uri}
                        style={[styles.attachmentPreviewCard, isWideLayout && styles.attachmentPreviewCardWide]}
                        onPress={() => {
                          void handleOpenAttachment(uri);
                        }}
                        activeOpacity={0.9}
                      >
                        <Image
                          source={{ uri }}
                          style={styles.attachmentPreview}
                          resizeMode="contain"
                        />
                        <View style={styles.attachmentPreviewMeta}>
                          <Text style={styles.attachmentPreviewTitle} numberOfLines={1}>
                            {getAttachmentLabel(uri)}
                          </Text>
                          <View style={styles.attachmentOpenRow}>
                            <MaterialIcons name="open-in-new" size={14} color="#166534" />
                            <Text style={styles.attachmentOpenText}>Open photo</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        key={uri}
                        style={styles.attachmentFileCard}
                        onPress={() => {
                          void handleOpenAttachment(uri);
                        }}
                        activeOpacity={0.85}
                      >
                        <View style={styles.attachmentFileIcon}>
                          <MaterialIcons name="attach-file" size={18} color="#166534" />
                        </View>
                        <View style={styles.attachmentFileMeta}>
                          <Text style={styles.attachmentFileTitle} numberOfLines={1}>
                            {getAttachmentLabel(uri)}
                          </Text>
                          <Text style={styles.attachmentFileText} numberOfLines={1}>
                            Tap to open attachment
                          </Text>
                        </View>
                        <MaterialIcons name="open-in-new" size={18} color="#166534" />
                      </TouchableOpacity>
                    )
                  )}
                </View>
              </View>
            )}

            {/* Metrics */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Key Metrics</Text>
                <Text style={styles.sectionCaption}>
                  {Object.values(report.metrics).filter(value => Boolean(value)).length} captured
                </Text>
              </View>
              <View style={[styles.metricsDisplay, isWideLayout && styles.metricsDisplayWide]}>
                {Object.entries(report.metrics).map(
                  ([key, value]) =>
                    value && (
                      <View key={key} style={styles.metricCard}>
                        <Text style={styles.metricCardLabel}>{formatMetricKey(key)}</Text>
                        <Text style={styles.metricCardValue}>{value}</Text>
                      </View>
                    )
                )}
              </View>
            </View>

            {/* Approval Section (Admin Only) */}
            {canApprove && !showApprovalForm && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Admin Actions</Text>
                <View style={styles.adminActions}>
                  <TouchableOpacity
                    style={[styles.adminActionButton, styles.approveButton]}
                    onPress={() => {
                      setActionType('approve');
                      setShowApprovalForm(true);
                    }}
                  >
                    <MaterialIcons name="check-circle" size={16} color="#fff" />
                    <Text style={styles.adminActionText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.adminActionButton, styles.rejectButton]}
                    onPress={() => {
                      setActionType('reject');
                      setShowApprovalForm(true);
                    }}
                  >
                    <MaterialIcons name="cancel" size={16} color="#fff" />
                    <Text style={styles.adminActionText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Approval Form */}
            {showApprovalForm && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>
                  {actionType === 'approve' ? 'Approve Report' : 'Reject Report'}
                </Text>
                <Text style={styles.formLabel}>Notes (Optional)</Text>
                <TextInput
                  style={styles.notesInput}
                  placeholder={
                    actionType === 'approve'
                      ? 'Add approval notes...'
                      : 'Explain why this report is being rejected...'
                  }
                  value={approvalNotes}
                  onChangeText={setApprovalNotes}
                  multiline
                  numberOfLines={4}
                  placeholderTextColor="#cbd5e1"
                />
                <View style={styles.formActions}>
                  <TouchableOpacity
                    style={styles.formCancelButton}
                    onPress={() => {
                      setShowApprovalForm(false);
                      setApprovalNotes('');
                      setActionType(null);
                    }}
                  >
                    <Text style={styles.formCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.formSubmitButton,
                      actionType === 'reject' && styles.formRejectButton,
                    ]}
                    onPress={actionType === 'approve' ? handleApprove : handleReject}
                  >
                    <Text style={styles.formSubmitText}>
                      {actionType === 'approve' ? 'Approve' : 'Reject'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Approval History */}
            {report.approvedBy && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Approval History</Text>
                <View style={styles.approvalHistory}>
                  <View
                    style={[
                      styles.approvalHistoryItem,
                      report.status === 'Approved' && styles.approvalHistoryApproved,
                    ]}
                  >
                    <MaterialIcons
                      name={report.status === 'Approved' ? 'check' : 'close'}
                      size={18}
                      color="#fff"
                      style={styles.approvalHistoryIcon}
                    />
                    <View style={styles.approvalHistoryContent}>
                      <Text style={styles.approvalHistoryStatus}>
                        {report.status === 'Approved' ? 'Approved' : 'Rejected'}
                      </Text>
                      <Text style={styles.approvalHistoryBy}>by {report.approvedBy}</Text>
                      {report.approvedAt && (
                        <Text style={styles.approvalHistoryDate}>
                          {new Date(report.approvedAt).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  </View>
                  {report.approvalNotes && (
                    <View style={styles.approvalNotesBox}>
                      <Text style={styles.approvalNotesLabel}>Notes:</Text>
                      <Text style={styles.approvalNotesText}>{report.approvalNotes}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function buildReportDownloadContent(report: SubmittedReport): string {
  const metricLines = Object.entries(report.metrics)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${formatMetricKey(key)}: ${value}`);
  const feedbackLines = [
    report.collaborationFeedback
      ? `How Was the Collaboration?: ${report.collaborationFeedback}`
      : null,
    report.volunteerPraise ? `Praise for the Volunteers: ${report.volunteerPraise}` : null,
    report.gratitudeNote ? `Thank You Note: ${report.gratitudeNote}` : null,
  ].filter(Boolean) as string[];

  return [
    `Title: ${report.title}`,
    `Submitted By: ${report.submitterName}`,
    `Role: ${report.submitterRole}`,
    `Status: ${report.status}`,
    `Submitted At: ${new Date(report.submittedAt).toLocaleString()}`,
    `Report Type: ${formatReportType(report.reportType)}`,
    report.projectTitle
      ? `${report.projectKind === 'event' ? 'Event' : 'Project'}: ${report.projectTitle}`
      : null,
    report.category ? `Category: ${report.category}` : null,
    '',
    'Description',
    report.description || 'No description provided.',
    feedbackLines.length ? '' : null,
    feedbackLines.length ? 'Partner Feedback' : null,
    feedbackLines.length ? feedbackLines.join('\n') : null,
    '',
    'Metrics',
    metricLines.length ? metricLines.join('\n') : 'No metrics captured.',
    report.approvedBy ? '' : null,
    report.approvedBy ? 'Approval History' : null,
    report.approvedBy ? `Reviewed By: ${report.approvedBy}` : null,
    report.approvedAt ? `Reviewed At: ${new Date(report.approvedAt).toLocaleString()}` : null,
    report.approvalNotes ? `Approval Notes: ${report.approvalNotes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
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

function formatMetricKey(key: string): string {
  const labels: Record<string, string> = {
    volunteerHours: 'Volunteer Hours',
    verifiedAttendance: 'Verified Attendance',
    activeVolunteers: 'Active Volunteers',
    beneficiariesServed: 'Beneficiaries Served',
    tasksCompleted: 'Tasks Completed',
    attendanceDays: 'Days Timed In',
    eventsCount: 'Events Count',
    geofenceCompliance: 'Geofence Compliance',
    dataStorageVolume: 'Data Storage Volume',
  };
  return labels[key] || key;
}

function getStatusPresentation(status: SubmittedReport['status']) {
  switch (status) {
    case 'Approved':
      return {
        icon: 'check-circle' as const,
        badgeBackground: '#dcfce7',
        badgeText: '#166534',
      };
    case 'Rejected':
      return {
        icon: 'cancel' as const,
        badgeBackground: '#fee2e2',
        badgeText: '#b91c1c',
      };
    case 'Draft':
      return {
        icon: 'edit' as const,
        badgeBackground: '#e2e8f0',
        badgeText: '#475569',
      };
    default:
      return {
        icon: 'hourglass-empty' as const,
        badgeBackground: '#dbeafe',
        badgeText: '#1d4ed8',
      };
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.56)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  container: {
    height: '90%',
    width: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    flexDirection: 'column',
  },
  containerWide: {
    width: '88%',
    maxWidth: 1180,
    height: '88%',
    marginBottom: 24,
    borderRadius: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerContent: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  downloadButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  headerCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  submitter: {
    fontSize: 13,
    color: '#64748b',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 20,
  },
  heroCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  dateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dateText: {
    fontSize: 12,
    color: '#64748b',
  },
  metadataSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metadataSectionWide: {
    gap: 12,
  },
  metadataItem: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  metadataItemWide: {
    flex: 1,
    minWidth: 220,
  },
  metadataLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 4,
  },
  metadataValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionCard: {
    marginBottom: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderBottomColor: '#e2e8f0',
    borderColor: '#e2e8f0',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionCaption: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
  },
  feedbackBlock: {
    marginTop: 10,
  },
  feedbackLabel: {
    marginBottom: 4,
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  metricsDisplay: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricsDisplayWide: {
    gap: 12,
  },
  attachmentsList: {
    gap: 10,
  },
  attachmentsListWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 14,
  },
  attachmentPreviewCard: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
  attachmentPreviewCardWide: {
    width: '100%',
  },
  attachmentPreview: {
    width: '100%',
    height: Platform.select({ web: 360, default: 220 }),
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  attachmentPreviewMeta: {
    paddingTop: 10,
    gap: 4,
  },
  attachmentPreviewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  attachmentOpenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attachmentOpenText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  attachmentFileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#dbe4ee',
  },
  attachmentFileIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  attachmentFileMeta: {
    flex: 1,
    gap: 2,
  },
  attachmentFileTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  attachmentFileText: {
    fontSize: 12,
    color: '#475569',
  },
  metricCard: {
    flex: Platform.select({ web: 0, default: 1 }),
    minWidth: 220,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#166534',
  },
  metricCardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 4,
  },
  metricCardValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#166534',
  },
  adminActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  adminActionButton: {
    flex: 1,
    minWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
  },
  approveButton: {
    backgroundColor: '#16a34a',
  },
  rejectButton: {
    backgroundColor: '#dc2626',
  },
  adminActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  notesInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  formCancelButton: {
    flex: 1,
    minWidth: 160,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
  },
  formCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  formSubmitButton: {
    flex: 1,
    minWidth: 160,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#16a34a',
    alignItems: 'center',
  },
  formRejectButton: {
    backgroundColor: '#dc2626',
  },
  formSubmitText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  approvalHistory: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  approvalHistoryItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fff7ed',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    borderRadius: 14,
  },
  approvalHistoryApproved: {
    backgroundColor: '#ecfdf3',
    borderLeftColor: '#16a34a',
  },
  approvalHistoryIcon: {
    marginTop: 2,
  },
  approvalHistoryContent: {
    flex: 1,
  },
  approvalHistoryStatus: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  approvalHistoryBy: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  approvalHistoryDate: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  approvalNotesBox: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 8,
  },
  approvalNotesLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  approvalNotesText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  footer: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  closeButton: {
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
