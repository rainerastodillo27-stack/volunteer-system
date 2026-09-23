import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { PartnerProjectApplication, PartnerProjectProposalDetails } from '../models/types';

interface ProposalCardProps {
  application: PartnerProjectApplication;
  projectTitle: string;
  onPress?: () => void;
  onApprove?: (application: PartnerProjectApplication) => void;
  onReject?: (application: PartnerProjectApplication, notes: string) => void;
  compact?: boolean;
  isAdmin?: boolean;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Approved': return '#166534';
    case 'Rejected': return '#dc2626';
    case 'Pending':
    default: return '#f59e0b';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'Approved': return 'check-circle';
    case 'Rejected': return 'cancel';
    case 'Pending':
    default: return 'schedule';
  }
};

export default function ProposalCard({ application, projectTitle, onPress, onApprove, onReject, compact = false, isAdmin = false }: ProposalCardProps) {
  const [showModal, setShowModal] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [isActing, setIsActing] = useState(false);

  const statusColor = getStatusColor(application.status);
  const statusIcon = getStatusIcon(application.status);
  const proposalDetails: Partial<PartnerProjectProposalDetails> = application.proposalDetails || {};
  const isPending = application.status === 'Pending';

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      setShowModal(true);
    }
  };

  const handleApprove = async () => {
    if (!onApprove) return;
    setIsActing(true);
    try {
      await onApprove(application);
      setShowModal(false);
    } finally {
      setIsActing(false);
    }
  };

  const handleReject = async () => {
    if (!onReject) return;
    if (!rejectionNotes.trim()) {
      Alert.alert('Required', 'Please provide a reason for rejection.');
      return;
    }
    setIsActing(true);
    try {
      await onReject(application, rejectionNotes.trim());
      setShowModal(false);
      setShowRejectInput(false);
      setRejectionNotes('');
    } finally {
      setIsActing(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.card, compact && styles.cardCompact]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.cardContent}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>{projectTitle}</Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {application.partnerName} • {application.status}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
        </View>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => { setShowModal(false); setShowRejectInput(false); setRejectionNotes(''); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Proposal Details</Text>
                <Text style={styles.modalSubtitle}>{application.partnerName}</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowModal(false); setShowRejectInput(false); setRejectionNotes(''); }} style={styles.closeButton}>
                <MaterialIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              {/* Status Badge */}
              <View style={[styles.statusBadge, { backgroundColor: `${statusColor}15` }]}>
                <MaterialIcons name={statusIcon as any} size={20} color={statusColor} />
                <Text style={[styles.statusText, { color: statusColor }]}>Status: {application.status}</Text>
              </View>

              {/* Core Details */}
              <View style={styles.detailGrid}>
                <View style={styles.detailGridItem}>
                  <Text style={styles.detailLabel}>Project Title</Text>
                  <Text style={styles.detailValue}>{projectTitle}</Text>
                </View>
                <View style={styles.detailGridItem}>
                  <Text style={styles.detailLabel}>Program Module</Text>
                  <Text style={styles.detailValue}>{proposalDetails.requestedProgramModule || 'N/A'}</Text>
                </View>
              </View>

              <View style={styles.detailGrid}>
                <View style={styles.detailGridItem}>
                  <Text style={styles.detailLabel}>Start Date</Text>
                  <Text style={styles.detailValue}>{proposalDetails.proposedStartDate || 'TBD'}</Text>
                </View>
                <View style={styles.detailGridItem}>
                  <Text style={styles.detailLabel}>End Date</Text>
                  <Text style={styles.detailValue}>{proposalDetails.proposedEndDate || 'TBD'}</Text>
                </View>
              </View>

              <View style={styles.detailGrid}>
                <View style={styles.detailGridItem}>
                  <Text style={styles.detailLabel}>Location</Text>
                  <Text style={styles.detailValue}>{proposalDetails.proposedLocation || 'N/A'}</Text>
                </View>
                <View style={styles.detailGridItem}>
                  <Text style={styles.detailLabel}>Volunteers Needed</Text>
                  <Text style={styles.detailValue}>{proposalDetails.proposedVolunteersNeeded ?? 'N/A'}</Text>
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Project Description</Text>
                <Text style={styles.detailValue}>{proposalDetails.proposedDescription || 'N/A'}</Text>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Community Need</Text>
                <Text style={styles.detailValue}>{proposalDetails.communityNeed || 'N/A'}</Text>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Expected Deliverables</Text>
                <Text style={styles.detailValue}>{proposalDetails.expectedDeliverables || 'N/A'}</Text>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Submitted On</Text>
                <Text style={styles.detailValue}>
                  {new Date(application.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>

              {application.reviewNotes ? (
                <View style={[styles.detailSection, styles.reviewNotesBox]}>
                  <Text style={styles.detailLabel}>Review Notes</Text>
                  <Text style={styles.detailValue}>{application.reviewNotes}</Text>
                </View>
              ) : null}

              {/* Admin Actions */}
              {isAdmin && isPending && onApprove && onReject && (
                <View style={styles.actionsSection}>
                  {showRejectInput ? (
                    <View style={styles.rejectInputWrap}>
                      <Text style={styles.rejectInputLabel}>Reason for rejection</Text>
                      <TextInput
                        style={styles.rejectInput}
                        placeholder="Explain why this proposal is being rejected..."
                        value={rejectionNotes}
                        onChangeText={setRejectionNotes}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                      <View style={styles.rejectActions}>
                        <TouchableOpacity
                          style={styles.cancelRejectBtn}
                          onPress={() => { setShowRejectInput(false); setRejectionNotes(''); }}
                        >
                          <Text style={styles.cancelRejectText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.confirmRejectBtn, isActing && styles.btnDisabled]}
                          onPress={handleReject}
                          disabled={isActing}
                        >
                          <MaterialIcons name="cancel" size={16} color="#fff" />
                          <Text style={styles.confirmRejectText}>{isActing ? 'Rejecting...' : 'Confirm Reject'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        style={[styles.rejectBtn, isActing && styles.btnDisabled]}
                        onPress={() => setShowRejectInput(true)}
                        disabled={isActing}
                      >
                        <MaterialIcons name="cancel" size={18} color="#dc2626" />
                        <Text style={styles.rejectBtnText}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.approveBtn, isActing && styles.btnDisabled]}
                        onPress={handleApprove}
                        disabled={isActing}
                      >
                        <MaterialIcons name="check-circle" size={18} color="#fff" />
                        <Text style={styles.approveBtnText}>{isActing ? 'Approving...' : 'Approve'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardCompact: { padding: 10, marginBottom: 6 },
  cardContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginBottom: 2 },
  cardSubtitle: { fontSize: 12, color: '#64748b' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContainer: { width: '100%', backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%', paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', minWidth: 0, padding: 20, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  modalSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  closeButton: { flexShrink: 0, padding: 4 },
  modalContent: { padding: 20 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 20, alignSelf: 'flex-start' },
  statusText: { fontSize: 13, fontWeight: '600' },
  detailSection: { marginBottom: 16 },
  detailGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  detailGridItem: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  detailLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  detailValue: { fontSize: 13, color: '#0f172a', lineHeight: 20, fontWeight: '500' },
  reviewNotesBox: { backgroundColor: '#fef9c3', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#fde047' },
  actionsSection: { marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  actionButtons: { flexDirection: 'row', gap: 12 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#dc2626', backgroundColor: '#fff' },
  rejectBtnText: { fontSize: 14, fontWeight: '700', color: '#dc2626' },
  approveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: '#166534' },
  approveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.5 },
  rejectInputWrap: { gap: 10 },
  rejectInputLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  rejectInput: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, fontSize: 13, color: '#0f172a', backgroundColor: '#f8fafc', minHeight: 80 },
  rejectActions: { flexDirection: 'row', gap: 10 },
  cancelRejectBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  cancelRejectText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  confirmRejectBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: '#dc2626' },
  confirmRejectText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
