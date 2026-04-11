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
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { SubmittedReport } from '../screens/ReportsScreen';

interface ReportDetailsModalProps {
  visible: boolean;
  report: SubmittedReport | null;
  onClose: () => void;
  onApprove?: (reportId: string, notes: string) => void;
  onReject?: (reportId: string, notes: string) => void;
  userRole?: 'admin' | 'volunteer' | 'partner';
}

export default function ReportDetailsModal({
  visible,
  report,
  onClose,
  onApprove,
  onReject,
  userRole,
}: ReportDetailsModalProps) {
  const [approvalNotes, setApprovalNotes] = useState('');
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);

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

  const canApprove = userRole === 'admin' && report.status === 'Submitted';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text style={styles.title}>{report.title}</Text>
              <Text style={styles.submitter}>by {report.submitterName}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <MaterialIcons name="close" size={24} color="#0f172a" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator>
            {/* Status Section */}
            <View style={styles.statusSection}>
              <View
                style={[
                  styles.statusBadge,
                  report.status === 'Approved' && styles.statusApproved,
                  report.status === 'Rejected' && styles.statusRejected,
                  report.status === 'Draft' && styles.statusDraft,
                  report.status === 'Submitted' && styles.statusSubmitted,
                ]}
              >
                <MaterialIcons
                  name={
                    report.status === 'Approved'
                      ? 'check-circle'
                      : report.status === 'Rejected'
                      ? 'cancel'
                      : report.status === 'Submitted'
                      ? 'hourglass-empty'
                      : 'edit'
                  }
                  size={16}
                  color="#fff"
                />
                <Text style={styles.statusText}>{report.status}</Text>
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

            {/* Report Type & Category */}
            <View style={styles.metadataSection}>
              <View style={styles.metadataItem}>
                <Text style={styles.metadataLabel}>Report Type</Text>
                <Text style={styles.metadataValue}>{formatReportType(report.reportType)}</Text>
              </View>
              {report.projectTitle && (
                <View style={styles.metadataItem}>
                  <Text style={styles.metadataLabel}>Project</Text>
                  <Text style={styles.metadataValue}>{report.projectTitle}</Text>
                </View>
              )}
              {report.category && (
                <View style={styles.metadataItem}>
                  <Text style={styles.metadataLabel}>Category</Text>
                  <Text style={styles.metadataValue}>{report.category}</Text>
                </View>
              )}
            </View>

            {/* Description */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.descriptionText}>{report.description}</Text>
            </View>

            {/* Metrics */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Key Metrics</Text>
              <View style={styles.metricsDisplay}>
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
              <View style={styles.section}>
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
              <View style={styles.section}>
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
              <View style={styles.section}>
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

function formatMetricKey(key: string): string {
  const labels: Record<string, string> = {
    volunteerHours: 'Volunteer Hours',
    verifiedAttendance: 'Verified Attendance',
    activeVolunteers: 'Active Volunteers',
    beneficiariesServed: 'Beneficiaries Served',
    tasksCompleted: 'Tasks Completed',
    eventsCount: 'Events Count',
    geofenceCompliance: 'Geofence Compliance',
    dataStorageVolume: 'Data Storage Volume',
  };
  return labels[key] || key;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
    justifyContent: 'flex-end',
  },
  container: {
    height: '90%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingTop: 20,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  submitter: {
    fontSize: 12,
    color: '#64748b',
  },
  content: {
    flex: 1,
    paddingHorizontal: 4,
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
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
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  dateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontSize: 12,
    color: '#64748b',
  },
  metadataSection: {
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  metadataItem: {
    paddingVertical: 6,
  },
  metadataLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 4,
  },
  metadataValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  section: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  metricsDisplay: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flex: Platform.select({ web: 0, default: 1 }),
    minWidth: '45%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    borderLeftWidth: 3,
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
  },
  adminActionButton: {
    flex: 1,
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
  },
  formCancelButton: {
    flex: 1,
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fee2e2',
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
  },
  approvalHistoryApproved: {
    backgroundColor: '#dcfce7',
    borderLeftColor: '#16a34a',
  },
  approvalHistoryIcon: {
    marginTop: 2,
  },
  approvalHistoryContent: {
    flex: 1,
  },
  approvalHistoryStatus: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  approvalHistoryBy: {
    fontSize: 12,
    color: '#fff',
    marginTop: 2,
  },
  approvalHistoryDate: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
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
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#166534',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
