import React, { useState, useEffect } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { PartnerProjectApplication, Project } from '../models/types';
import {
  getAllPartnerProjectApplications,
  getAllProjects,
  reviewPartnerProjectApplication,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import InlineLoadError from '../components/InlineLoadError';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

export default function ProposalReviewScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [proposalsPending, setProposalsPending] = useState<PartnerProjectApplication[]>([]);
  const [proposalsApproved, setProposalsApproved] = useState<PartnerProjectApplication[]>([]);
  const [proposalsRejected, setProposalsRejected] = useState<PartnerProjectApplication[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProposal, setSelectedProposal] = useState<PartnerProjectApplication | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    loadData();

    const unsubscribe = subscribeToStorageChanges(['partnerProjectApplications', 'projects'], () => {
      loadData();
    });

    return () => unsubscribe?.();
  }, [isAdmin]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [applications, allProjects] = await Promise.all([
        getAllPartnerProjectApplications(),
        getAllProjects(),
      ]);

      const pending = applications.filter(a => a.status === 'Pending');
      const approved = applications.filter(a => a.status === 'Approved');
      const rejected = applications.filter(a => a.status === 'Rejected');

      setProposalsPending(pending);
      setProposalsApproved(approved);
      setProposalsRejected(rejected);
      setProjects(allProjects);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load proposals.'),
      });
    } finally {
      setLoading(false);
    }
  };

  const getProjectTitle = (projectId: string): string => {
    const project = projects.find(p => p.id === projectId);
    return project?.title || projectId;
  };

  const handleApprove = async () => {
    if (!selectedProposal || !user?.id) return;

    try {
      setReviewing(true);
      const reviewedProposal = await reviewPartnerProjectApplication(
        selectedProposal.id,
        'Approved',
        user.id,
        approvalNotes
      );
      
      setShowModal(false);
      setSelectedProposal(null);
      setApprovalNotes('');
      setAction(null);
      
      // Show success message with project creation confirmation
      const projectTitle = reviewedProposal.proposalDetails?.proposedTitle || 
                          getProjectTitle(reviewedProposal.projectId) ||
                          'Untitled Project';
      
      Alert.alert(
        'Proposal Approved ✅',
        `"${projectTitle}" has been approved.\n\nA new project has been automatically created in the Program Management Suite.`,
        [{ text: 'OK', onPress: () => loadData() }]
      );
    } catch (error) {
      Alert.alert(
        'Approval Failed',
        error instanceof Error ? error.message : 'Failed to approve proposal. Please try again.'
      );
    } finally {
      setReviewing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedProposal || !user?.id) return;

    if (!rejectionNotes.trim()) {
      Alert.alert('Required', 'Please provide a rejection reason.');
      return;
    }

    try {
      setReviewing(true);
      await reviewPartnerProjectApplication(selectedProposal.id, 'Rejected', user.id, rejectionNotes);
      setShowModal(false);
      setSelectedProposal(null);
      setRejectionNotes('');
      setAction(null);
      Alert.alert('Proposal Rejected', 'The partner has been notified and can submit a revision.');
      await loadData();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to reject proposal.');
    } finally {
      setReviewing(false);
    }
  };

  const openApprovalModal = (proposal: PartnerProjectApplication) => {
    setSelectedProposal(proposal);
    setAction('approve');
    setApprovalNotes('');
    setRejectionNotes('');
    setShowModal(true);
  };

  const openRejectionModal = (proposal: PartnerProjectApplication) => {
    setSelectedProposal(proposal);
    setAction('reject');
    setRejectionNotes('');
    setApprovalNotes('');
    setShowModal(true);
  };

  const ProposalCard = ({
    proposal,
    onApprove,
    onReject,
  }: {
    proposal: PartnerProjectApplication;
    onApprove: () => void;
    onReject: () => void;
  }) => {
    const details = proposal.proposalDetails;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitle}>
            <Text style={styles.cardName}>{proposal.partnerName}</Text>
            <Text style={styles.cardMeta}>
              {details?.proposedTitle || details?.targetProjectTitle || getProjectTitle(proposal.projectId)}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              proposal.status === 'Approved'
                ? styles.statusApproved
                : proposal.status === 'Rejected'
                ? styles.statusRejected
                : styles.statusPending,
            ]}
          >
            <Text style={styles.statusText}>{proposal.status}</Text>
          </View>
        </View>

        <View style={styles.cardContent}>
          <Text style={styles.cardLabel}>Email:</Text>
          <Text style={styles.cardValue}>{proposal.partnerEmail}</Text>

          {details?.proposedTitle && (
            <>
              <Text style={styles.cardLabel}>Proposed Title:</Text>
              <Text style={styles.cardValue}>{details.proposedTitle}</Text>
            </>
          )}

          {details?.proposedDescription && (
            <>
              <Text style={styles.cardLabel}>Description:</Text>
              <Text style={styles.cardValue}>{details.proposedDescription}</Text>
            </>
          )}

          {details?.proposedStartDate && (
            <>
              <Text style={styles.cardLabel}>Start Date:</Text>
              <Text style={styles.cardValue}>{format(new Date(details.proposedStartDate), 'MMM d, yyyy')}</Text>
            </>
          )}

          {details?.proposedEndDate && (
            <>
              <Text style={styles.cardLabel}>End Date:</Text>
              <Text style={styles.cardValue}>{format(new Date(details.proposedEndDate), 'MMM d, yyyy')}</Text>
            </>
          )}

          {details?.proposedVolunteersNeeded && (
            <>
              <Text style={styles.cardLabel}>Volunteers Needed:</Text>
              <Text style={styles.cardValue}>{details.proposedVolunteersNeeded}</Text>
            </>
          )}

          {details?.communityNeed && (
            <>
              <Text style={styles.cardLabel}>Community Need:</Text>
              <Text style={styles.cardValue}>{details.communityNeed}</Text>
            </>
          )}

          {details?.expectedDeliverables && (
            <>
              <Text style={styles.cardLabel}>Expected Deliverables:</Text>
              <Text style={styles.cardValue}>{details.expectedDeliverables}</Text>
            </>
          )}

          <Text style={styles.cardLabel}>Submitted:</Text>
          <Text style={styles.cardValue}>{format(new Date(proposal.requestedAt), 'MMM d, yyyy h:mm a')}</Text>

          {proposal.reviewNotes && (
            <>
              <Text style={styles.cardLabel}>Review Notes:</Text>
              <Text style={styles.cardValue}>{proposal.reviewNotes}</Text>
            </>
          )}
        </View>

        {proposal.status === 'Pending' && (
          <View style={styles.cardActions}>
            <TouchableOpacity style={[styles.btn, styles.btnApprove]} onPress={onApprove}>
              <MaterialIcons name="check-circle" size={18} color="#fff" />
              <Text style={styles.btnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={onReject}>
              <MaterialIcons name="cancel" size={18} color="#fff" />
              <Text style={styles.btnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (!isAdmin) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Admin access required</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centerContainer}>
        <InlineLoadError title={loadError.title} message={loadError.message} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {proposalsPending.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="hourglass-empty" size={24} color="#ea580c" />
              <Text style={styles.sectionTitle}>Pending Proposals ({proposalsPending.length})</Text>
            </View>
            {proposalsPending.map(proposal => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onApprove={() => openApprovalModal(proposal)}
                onReject={() => openRejectionModal(proposal)}
              />
            ))}
          </View>
        )}

        {proposalsApproved.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="check-circle" size={24} color="#16a34a" />
              <Text style={styles.sectionTitle}>Approved ({proposalsApproved.length})</Text>
            </View>
            {proposalsApproved.map(proposal => (
              <ProposalCard key={proposal.id} proposal={proposal} onApprove={() => {}} onReject={() => {}} />
            ))}
          </View>
        )}

        {proposalsRejected.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="cancel" size={24} color="#dc2626" />
              <Text style={styles.sectionTitle}>Rejected ({proposalsRejected.length})</Text>
            </View>
            {proposalsRejected.map(proposal => (
              <ProposalCard key={proposal.id} proposal={proposal} onApprove={() => {}} onReject={() => {}} />
            ))}
          </View>
        )}

        {proposalsPending.length === 0 && proposalsApproved.length === 0 && proposalsRejected.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialIcons name="rate-review" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No proposals found</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={showModal} animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <MaterialIcons name="close" size={24} color="#1e293b" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{action === 'approve' ? 'Approve Proposal' : 'Reject Proposal'}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            {selectedProposal && (
              <>
                <View style={styles.proposalInfo}>
                  <Text style={styles.proposalName}>{selectedProposal.partnerName}</Text>
                  <Text style={styles.proposalEmail}>{selectedProposal.partnerEmail}</Text>
                  <Text style={styles.proposalTitle}>
                    {selectedProposal.proposalDetails?.proposedTitle ||
                      selectedProposal.proposalDetails?.targetProjectTitle ||
                      getProjectTitle(selectedProposal.projectId)}
                  </Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>
                    {action === 'approve' ? 'Approval Notes (optional)' : 'Rejection Reason (required)'}
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    multiline
                    numberOfLines={5}
                    placeholder={
                      action === 'approve'
                        ? 'Add any approval notes...'
                        : 'Please explain why this proposal is being rejected...'
                    }
                    value={action === 'approve' ? approvalNotes : rejectionNotes}
                    onChangeText={action === 'approve' ? setApprovalNotes : setRejectionNotes}
                  />
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => setShowModal(false)}>
                    <Text style={styles.btnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.btn,
                      action === 'approve' ? styles.btnApprove : styles.btnReject,
                      reviewing && styles.btnDisabled,
                    ]}
                    onPress={action === 'approve' ? handleApprove : handleReject}
                    disabled={reviewing}
                  >
                    {reviewing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.btnText}>{action === 'approve' ? 'Approve' : 'Reject'}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 16, gap: 24 },
  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  cardMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignItems: 'center' },
  statusPending: { backgroundColor: '#fed7aa' },
  statusApproved: { backgroundColor: '#bbf7d0' },
  statusRejected: { backgroundColor: '#fecaca' },
  statusText: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  cardContent: { gap: 8 },
  cardLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 14, color: '#1e293b', marginBottom: 8 },
  cardActions: { flexDirection: 'row', gap: 12 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  btnApprove: { backgroundColor: '#16a34a' },
  btnReject: { backgroundColor: '#dc2626' },
  btnCancel: { backgroundColor: '#e2e8f0' },
  btnDisabled: { opacity: 0.65 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnCancelText: { color: '#1e293b', fontSize: 14, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  emptyText: { fontSize: 16, color: '#64748b', marginTop: 16 },
  errorText: { fontSize: 16, color: '#dc2626' },
  modal: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  modalContent: { flex: 1 },
  modalContentInner: { paddingHorizontal: 16, paddingVertical: 20, gap: 20 },
  proposalInfo: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 10 },
  proposalName: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  proposalEmail: { fontSize: 13, color: '#64748b', marginTop: 4 },
  proposalTitle: { fontSize: 14, color: '#475569', marginTop: 8, fontWeight: '500' },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  textInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1e293b',
    fontFamily: 'DM Sans',
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20, marginBottom: 20 },
});
