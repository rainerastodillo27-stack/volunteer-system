import React, { useState, useEffect, useRef } from 'react';
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
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Partner } from '../models/types';
import {
  getAllPartners,
  reviewPartnerRegistration,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import InlineLoadError from '../components/InlineLoadError';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

export default function PartnerApprovalsScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [partnersPending, setPartnersPending] = useState<Partner[]>([]);
  const [partnersApproved, setPartnersApproved] = useState<Partner[]>([]);
  const [partnersRejected, setPartnersRejected] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [processingAction, setProcessingAction] = useState<string | null>(null);
  const hasLoadedPartnersRef = useRef(false);
  const loadPartnersRequestRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void loadPartners();

    const unsubscribe = subscribeToStorageChanges(['partners'], () => {
      void loadPartners({ showBlockingLoader: false });
    });

    return () => unsubscribe?.();
  }, [isAdmin]);

  const loadPartners = async ({ showBlockingLoader = !hasLoadedPartnersRef.current } = {}) => {
    if (loadPartnersRequestRef.current) {
      return loadPartnersRequestRef.current;
    }

    const request = (async () => {
      if (showBlockingLoader) {
        setLoading(true);
      }

      try {
        const allPartners = await getAllPartners();
        setPartnersPending(allPartners.filter(p => p.status === 'Pending'));
        setPartnersApproved(allPartners.filter(p => p.status === 'Approved'));
        setPartnersRejected(allPartners.filter(p => p.status === 'Rejected'));
        setLoadError(null);
        hasLoadedPartnersRef.current = true;
      } catch (error) {
        setLoadError({
          title: getRequestErrorTitle(error),
          message: getRequestErrorMessage(error, 'Failed to load partners.'),
        });
      } finally {
        if (showBlockingLoader) {
          setLoading(false);
        }
      }
    })();

    loadPartnersRequestRef.current = request;
    try {
      await request;
    } finally {
      if (loadPartnersRequestRef.current === request) {
        loadPartnersRequestRef.current = null;
      }
    }
  };

  const applyPartnerUpdate = (updatedPartner: Partner) => {
    const updateBucket = (partners: Partner[], status: Partner['status']) => {
      const withoutUpdatedPartner = partners.filter(partner => partner.id !== updatedPartner.id);
      return updatedPartner.status === status
        ? [...withoutUpdatedPartner, updatedPartner]
        : withoutUpdatedPartner;
    };

    setPartnersPending(current => updateBucket(current, 'Pending'));
    setPartnersApproved(current => updateBucket(current, 'Approved'));
    setPartnersRejected(current => updateBucket(current, 'Rejected'));
  };

  const handleApprove = async () => {
    if (!selectedPartner || !user?.id || processingAction) return;

    const partnerBeingReviewed = selectedPartner;
    const actionKey = `approve:${partnerBeingReviewed.id}`;
    setProcessingAction(actionKey);

    try {
      const updatedPartner = await reviewPartnerRegistration(
        partnerBeingReviewed.id,
        'Approved',
        user.id,
        approvalNotes.trim() || undefined,
      );
      applyPartnerUpdate(updatedPartner);
      setShowModal(false);
      setSelectedPartner(null);
      setApprovalNotes('');
      setAction(null);
      Alert.alert('Success', 'Partner has been approved.');
      void loadPartners({ showBlockingLoader: false });
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve partner.');
      void loadPartners({ showBlockingLoader: false });
    } finally {
      setProcessingAction(null);
    }
  };

  const handleReject = async () => {
    if (!selectedPartner || !user?.id || processingAction) return;

    if (!rejectionNotes.trim()) {
      Alert.alert('Required', 'Please provide a rejection reason.');
      return;
    }

    const partnerBeingReviewed = selectedPartner;
    const actionKey = `reject:${partnerBeingReviewed.id}`;
    setProcessingAction(actionKey);

    try {
      const updatedPartner = await reviewPartnerRegistration(
        partnerBeingReviewed.id,
        'Rejected',
        user.id,
        `Rejected: ${rejectionNotes.trim()}`,
      );
      applyPartnerUpdate(updatedPartner);
      setShowModal(false);
      setSelectedPartner(null);
      setRejectionNotes('');
      setAction(null);
      Alert.alert('Success', 'Partner has been rejected.');
      void loadPartners({ showBlockingLoader: false });
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to reject partner.');
      void loadPartners({ showBlockingLoader: false });
    } finally {
      setProcessingAction(null);
    }
  };

  const openApprovalModal = (partner: Partner) => {
    setSelectedPartner(partner);
    setAction('approve');
    setApprovalNotes('');
    setRejectionNotes('');
    setShowModal(true);
  };

  const openRejectionModal = (partner: Partner) => {
    setSelectedPartner(partner);
    setAction('reject');
    setRejectionNotes('');
    setApprovalNotes('');
    setShowModal(true);
  };

  const PartnerCard = ({ partner, onApprove, onReject }: { partner: Partner; onApprove: () => void; onReject: () => void }) => {
    const approveBusy = processingAction === `approve:${partner.id}`;
    const rejectBusy = processingAction === `reject:${partner.id}`;
    const actionBusy = Boolean(processingAction);

    return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <Text style={styles.cardName}>{partner.name}</Text>
          <Text style={styles.cardMeta}>{partner.sectorType}</Text>
        </View>
        <View style={[styles.statusBadge, partner.status === 'Approved' ? styles.statusApproved : partner.status === 'Rejected' ? styles.statusRejected : styles.statusPending]}>
          <Text style={styles.statusText}>{partner.status}</Text>
        </View>
      </View>

      <View style={styles.cardContent}>
        <Text style={styles.cardLabel}>DSWD Accreditation:</Text>
        <Text style={styles.cardValue}>{partner.dswdAccreditationNo || 'N/A'}</Text>

        {partner.contactEmail && (
          <>
            <Text style={styles.cardLabel}>Email:</Text>
            <Text style={styles.cardValue}>{partner.contactEmail}</Text>
          </>
        )}

        {partner.contactPhone && (
          <>
            <Text style={styles.cardLabel}>Phone:</Text>
            <Text style={styles.cardValue}>{partner.contactPhone}</Text>
          </>
        )}

        {partner.address && (
          <>
            <Text style={styles.cardLabel}>Address:</Text>
            <Text style={styles.cardValue}>{partner.address}</Text>
          </>
        )}

        {partner.verificationNotes && (
          <>
            <Text style={styles.cardLabel}>Notes:</Text>
            <Text style={styles.cardValue}>{partner.verificationNotes}</Text>
          </>
        )}

        {partner.validatedAt && (
          <>
            <Text style={styles.cardLabel}>Decision Date:</Text>
            <Text style={styles.cardValue}>{format(new Date(partner.validatedAt), 'MMM d, yyyy h:mm a')}</Text>
          </>
        )}
      </View>

      {partner.status === 'Pending' && (
        <View style={styles.cardActions}>
          <TouchableOpacity style={[styles.btn, styles.btnApprove, actionBusy && styles.btnDisabled]} onPress={onApprove} disabled={actionBusy}>
            {approveBusy ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="check-circle" size={18} color="#fff" />}
            <Text style={styles.btnText}>{approveBusy ? 'Approving...' : 'Approve'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnReject, actionBusy && styles.btnDisabled]} onPress={onReject} disabled={actionBusy}>
            {rejectBusy ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="cancel" size={18} color="#fff" />}
            <Text style={styles.btnText}>{rejectBusy ? 'Rejecting...' : 'Reject'}</Text>
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
        {partnersPending.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="hourglass-empty" size={24} color="#ea580c" />
              <Text style={styles.sectionTitle}>Pending Approvals ({partnersPending.length})</Text>
            </View>
            {partnersPending.map(partner => (
              <PartnerCard
                key={partner.id}
                partner={partner}
                onApprove={() => openApprovalModal(partner)}
                onReject={() => openRejectionModal(partner)}
              />
            ))}
          </View>
        )}

        {partnersApproved.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="check-circle" size={24} color="#16a34a" />
              <Text style={styles.sectionTitle}>Approved ({partnersApproved.length})</Text>
            </View>
            {partnersApproved.map(partner => (
              <PartnerCard key={partner.id} partner={partner} onApprove={() => {}} onReject={() => {}} />
            ))}
          </View>
        )}

        {partnersRejected.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="cancel" size={24} color="#dc2626" />
              <Text style={styles.sectionTitle}>Rejected ({partnersRejected.length})</Text>
            </View>
            {partnersRejected.map(partner => (
              <PartnerCard key={partner.id} partner={partner} onApprove={() => {}} onReject={() => {}} />
            ))}
          </View>
        )}

        {partnersPending.length === 0 && partnersApproved.length === 0 && partnersRejected.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialIcons name="business" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No partners found</Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={showModal}
        animationType="slide"
        onRequestClose={() => {
          if (!processingAction) {
            setShowModal(false);
          }
        }}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)} disabled={Boolean(processingAction)}>
              <MaterialIcons name="close" size={24} color="#1e293b" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{action === 'approve' ? 'Approve Partner' : 'Reject Partner'}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            {selectedPartner && (
              <>
                <View style={styles.partnerInfo}>
                  <Text style={styles.partnerName}>{selectedPartner.name}</Text>
                  <Text style={styles.partnerSector}>{selectedPartner.sectorType}</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>
                    {action === 'approve' ? 'Approval Notes (optional)' : 'Rejection Reason (required)'}
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    multiline
                    numberOfLines={5}
                    placeholder={action === 'approve' ? 'Add any approval notes...' : 'Please explain why this partner is being rejected...'}
                    value={action === 'approve' ? approvalNotes : rejectionNotes}
                    onChangeText={action === 'approve' ? setApprovalNotes : setRejectionNotes}
                    editable={!processingAction}
                  />
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity style={[styles.btn, styles.btnCancel, processingAction && styles.btnDisabled]} onPress={() => setShowModal(false)} disabled={Boolean(processingAction)}>
                    <Text style={styles.btnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, action === 'approve' ? styles.btnApprove : styles.btnReject, processingAction && styles.btnDisabled]}
                    onPress={action === 'approve' ? handleApprove : handleReject}
                    disabled={Boolean(processingAction)}
                  >
                    {processingAction ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text style={styles.btnText}>
                      {processingAction
                        ? action === 'approve' ? 'Approving...' : 'Rejecting...'
                        : action === 'approve' ? 'Approve' : 'Reject'}
                    </Text>
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
  container: { flex: 1, backgroundColor: ModernTheme.colors.background.secondary },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: ModernTheme.spacing[4], paddingVertical: ModernTheme.spacing[4], gap: ModernTheme.spacing[6] },
  section: { gap: ModernTheme.spacing[3] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: ModernTheme.spacing[3], marginBottom: ModernTheme.spacing[2] },
  sectionTitle: { fontSize: ModernTheme.typography.fontSize.xl, fontWeight: ModernTheme.typography.fontWeight.semibold, color: ModernTheme.colors.text.primary },
  card: { backgroundColor: ModernTheme.colors.background.card, borderRadius: ModernTheme.borderRadius.lg, padding: ModernTheme.spacing[4], gap: ModernTheme.spacing[3], borderWidth: 0, borderColor: 'transparent', ...ModernTheme.shadows.base },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { flex: 1 },
  cardName: { fontSize: ModernTheme.typography.fontSize.lg, fontWeight: ModernTheme.typography.fontWeight.semibold, color: ModernTheme.colors.text.primary },
  cardMeta: { fontSize: ModernTheme.typography.fontSize.sm, color: ModernTheme.colors.text.secondary, marginTop: ModernTheme.spacing[1] },
  statusBadge: { paddingHorizontal: ModernTheme.spacing[3], paddingVertical: ModernTheme.spacing[1.5], borderRadius: ModernTheme.borderRadius.full, alignItems: 'center' },
  statusPending: { backgroundColor: ModernTheme.colors.warning + '40' },
  statusApproved: { backgroundColor: ModernTheme.colors.primary[200] },
  statusRejected: { backgroundColor: ModernTheme.colors.error + '30' },
  statusText: { fontSize: ModernTheme.typography.fontSize.sm, fontWeight: ModernTheme.typography.fontWeight.semibold, color: ModernTheme.colors.text.primary },
  cardContent: { gap: ModernTheme.spacing[2] },
  cardLabel: { fontSize: ModernTheme.typography.fontSize.sm, fontWeight: ModernTheme.typography.fontWeight.semibold, color: ModernTheme.colors.text.secondary, textTransform: 'uppercase', letterSpacing: ModernTheme.typography.letterSpacing.wide },
  cardValue: { fontSize: ModernTheme.typography.fontSize.md, color: ModernTheme.colors.text.primary, marginBottom: ModernTheme.spacing[2] },
  cardActions: { flexDirection: 'row', gap: ModernTheme.spacing[3] },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: ModernTheme.spacing[2.5], borderRadius: ModernTheme.borderRadius.md, gap: ModernTheme.spacing[2], ...ModernTheme.shadows.xs },
  btnApprove: { backgroundColor: ModernTheme.colors.primary[600] },
  btnReject: { backgroundColor: ModernTheme.colors.error },
  btnDisabled: { opacity: 0.65 },
  btnCancel: { backgroundColor: ModernTheme.colors.neutral[200] },
  btnText: { color: ModernTheme.colors.text.inverse, fontSize: ModernTheme.typography.fontSize.md, fontWeight: ModernTheme.typography.fontWeight.semibold },
  btnCancelText: { color: ModernTheme.colors.text.primary, fontSize: ModernTheme.typography.fontSize.md, fontWeight: ModernTheme.typography.fontWeight.semibold },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: ModernTheme.spacing[16] },
  emptyText: { fontSize: ModernTheme.typography.fontSize.lg, color: ModernTheme.colors.text.secondary, marginTop: ModernTheme.spacing[4] },
  errorText: { fontSize: ModernTheme.typography.fontSize.lg, color: ModernTheme.colors.error },
  modal: { flex: 1, backgroundColor: ModernTheme.colors.background.card },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: ModernTheme.spacing[4], paddingVertical: ModernTheme.spacing[4], borderBottomWidth: 0, borderBottomColor: 'transparent', ...ModernTheme.shadows.sm },
  modalTitle: { fontSize: ModernTheme.typography.fontSize.xl, fontWeight: ModernTheme.typography.fontWeight.semibold, color: ModernTheme.colors.text.primary },
  modalContent: { flex: 1 },
  modalContentInner: { paddingHorizontal: ModernTheme.spacing[4], paddingVertical: ModernTheme.spacing[5], gap: ModernTheme.spacing[5] },
  partnerInfo: { backgroundColor: ModernTheme.colors.background.tertiary, padding: ModernTheme.spacing[4], borderRadius: ModernTheme.borderRadius.md },
  partnerName: { fontSize: ModernTheme.typography.fontSize.lg, fontWeight: ModernTheme.typography.fontWeight.semibold, color: ModernTheme.colors.text.primary },
  partnerSector: { fontSize: ModernTheme.typography.fontSize.sm, color: ModernTheme.colors.text.secondary, marginTop: ModernTheme.spacing[1] },
  inputGroup: { gap: ModernTheme.spacing[2] },
  label: { fontSize: ModernTheme.typography.fontSize.md, fontWeight: ModernTheme.typography.fontWeight.semibold, color: ModernTheme.colors.text.primary },
  textInput: { borderWidth: 1, borderColor: ModernTheme.colors.border.medium, borderRadius: ModernTheme.borderRadius.md, padding: ModernTheme.spacing[3], fontSize: ModernTheme.typography.fontSize.md, color: ModernTheme.colors.text.primary, fontFamily: 'Nunito', textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: ModernTheme.spacing[3], marginTop: ModernTheme.spacing[5], marginBottom: ModernTheme.spacing[5] },
});
