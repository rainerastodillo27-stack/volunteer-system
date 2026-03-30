import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllPartners,
  isValidDswdAccreditationNo,
  reviewPartnerRegistration,
  savePartner,
  subscribeToStorageChanges,
  verifyPartnerRegistration,
} from '../models/storage';
import { AdvocacyFocus, Partner, PartnerSectorType } from '../models/types';

type PartnerFormState = {
  organizationName: string;
  sectorType: PartnerSectorType;
  dswdAccreditationNo: string;
  advocacyFocus: AdvocacyFocus[];
  contactEmail: string;
  contactPhone: string;
  description: string;
};

const sectorOptions: PartnerSectorType[] = ['NGO', 'Hospital', 'Institution', 'Private'];
const advocacyOptions: AdvocacyFocus[] = ['Nutrition', 'Education', 'Livelihood', 'Disaster'];

function derivePartnerCategory(focuses: AdvocacyFocus[]): Partner['category'] {
  if (focuses.includes('Education')) {
    return 'Education';
  }
  if (focuses.includes('Livelihood')) {
    return 'Livelihood';
  }
  if (focuses.includes('Nutrition')) {
    return 'Nutrition';
  }
  return 'Other';
}

function createEmptyPartnerForm(defaultEmail = '', defaultPhone = ''): PartnerFormState {
  return {
    organizationName: '',
    sectorType: 'NGO',
    dswdAccreditationNo: '',
    advocacyFocus: [],
    contactEmail: defaultEmail,
    contactPhone: defaultPhone,
    description: '',
  };
}

function createFormFromPartner(partner: Partner): PartnerFormState {
  return {
    organizationName: partner.name,
    sectorType: partner.sectorType || 'NGO',
    dswdAccreditationNo: partner.dswdAccreditationNo || '',
    advocacyFocus: partner.advocacyFocus || [],
    contactEmail: partner.contactEmail || '',
    contactPhone: partner.contactPhone || '',
    description: partner.description || '',
  };
}

// Manages partner registration applications and admin inbound verification.
export default function PartnerOnboardingScreen() {
  const { user, isAdmin } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [partnerForm, setPartnerForm] = useState<PartnerFormState>(
    createEmptyPartnerForm(user?.email || '', user?.phone || '')
  );
  const [editingPartnerId, setEditingPartnerId] = useState<string | null>(null);
  const [showAdminEditor, setShowAdminEditor] = useState(false);

  const isOwnedByCurrentPartner = React.useCallback(
    (partner: Partner) => {
      if (!user) {
        return false;
      }

      if (partner.ownerUserId) {
        return partner.ownerUserId === user.id;
      }

      return partner.contactEmail?.toLowerCase() === user.email?.toLowerCase();
    },
    [user]
  );

  const loadPartners = React.useCallback(async () => {
    try {
      const allPartners = await getAllPartners();
      const scopedPartners = isAdmin
        ? filter === 'All'
          ? allPartners
          : allPartners.filter(partner => partner.status === filter)
        : allPartners
            .filter(isOwnedByCurrentPartner)
            .sort(
              (left, right) =>
                new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
            );

      setPartners(scopedPartners);
      if (!isAdmin && scopedPartners[0] && !editingPartnerId) {
        setPartnerForm(createFormFromPartner(scopedPartners[0]));
      }
    } catch {
      Alert.alert('Error', 'Failed to load partner applications.');
    }
  }, [editingPartnerId, filter, isAdmin, isOwnedByCurrentPartner]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useFocusEffect(
    React.useCallback(() => {
      void loadPartners();
    }, [loadPartners])
  );

  useEffect(() => {
    return subscribeToStorageChanges(['partners'], () => {
      void loadPartners();
    });
  }, [loadPartners]);

  const latestOwnedPartner = useMemo(() => partners[0] || null, [partners]);

  const updatePartnerForm = <K extends keyof PartnerFormState>(
    key: K,
    value: PartnerFormState[K]
  ) => {
    setPartnerForm(current => ({ ...current, [key]: value }));
  };

  const resetPartnerForm = () => {
    setPartnerForm(createEmptyPartnerForm(isAdmin ? '' : user?.email || '', isAdmin ? '' : user?.phone || ''));
    setEditingPartnerId(null);
    setShowAdminEditor(false);
  };

  const validateForm = () => {
    if (!partnerForm.organizationName.trim()) {
      Alert.alert('Validation Error', 'Organization name is required.');
      return false;
    }

    if (!isValidDswdAccreditationNo(partnerForm.dswdAccreditationNo)) {
      Alert.alert('Validation Error', 'Enter a valid DSWD accreditation number.');
      return false;
    }

    if (partnerForm.advocacyFocus.length === 0) {
      Alert.alert('Validation Error', 'Select at least one advocacy focus.');
      return false;
    }

    return true;
  };

  const handleSaveApplication = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      const existingPartner =
        editingPartnerId
          ? partners.find(partner => partner.id === editingPartnerId) || null
          : !isAdmin
          ? latestOwnedPartner
          : null;
      const now = new Date().toISOString();

      const nextPartner: Partner = {
        id: existingPartner?.id || `partner-${Date.now()}`,
        ownerUserId: existingPartner?.ownerUserId || user?.id,
        name: partnerForm.organizationName.trim(),
        description:
          partnerForm.description.trim() ||
          `${partnerForm.advocacyFocus.join(', ')} partnership application`,
        category: derivePartnerCategory(partnerForm.advocacyFocus),
        sectorType: partnerForm.sectorType,
        dswdAccreditationNo: partnerForm.dswdAccreditationNo.trim().toUpperCase(),
        advocacyFocus: partnerForm.advocacyFocus,
        contactEmail: partnerForm.contactEmail.trim().toLowerCase(),
        contactPhone: partnerForm.contactPhone.trim(),
        status: existingPartner?.status === 'Approved' && !isAdmin ? 'Approved' : 'Pending',
        verificationStatus:
          existingPartner?.status === 'Approved' && !isAdmin
            ? existingPartner.verificationStatus || 'Verified'
            : 'Pending',
        verificationNotes: existingPartner?.status === 'Approved' && !isAdmin
          ? existingPartner.verificationNotes
          : undefined,
        validatedAt: existingPartner?.status === 'Approved' && !isAdmin ? existingPartner.validatedAt : undefined,
        validatedBy: existingPartner?.status === 'Approved' && !isAdmin ? existingPartner.validatedBy : undefined,
        credentialsUnlockedAt:
          existingPartner?.status === 'Approved' && !isAdmin
            ? existingPartner.credentialsUnlockedAt
            : undefined,
        createdAt: existingPartner?.createdAt || now,
      };

      await savePartner(nextPartner);
      setPartnerForm(createFormFromPartner(nextPartner));
      setEditingPartnerId(nextPartner.id);
      setShowAdminEditor(false);
      Alert.alert(
        isAdmin ? 'Saved' : 'Application Submitted',
        isAdmin
          ? 'Partner record saved.'
          : 'Your organization application is now in the inbound inquiry queue for admin verification.'
      );
      void loadPartners();
    } catch {
      Alert.alert('Error', 'Failed to save the partner application.');
    }
  };

  const handleVerify = async (partnerId: string) => {
    if (!user?.id) {
      return;
    }

    try {
      const partner = await verifyPartnerRegistration(partnerId, user.id);
      Alert.alert('Verified', `${partner.name} was marked as DSWD-verified.`);
      void loadPartners();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to verify partner application.');
    }
  };

  const handleReview = async (partnerId: string, status: 'Approved' | 'Rejected') => {
    if (!user?.id) {
      return;
    }

    try {
      const partner = await reviewPartnerRegistration(partnerId, status, user.id);
      Alert.alert(
        status === 'Approved' ? 'Approved' : 'Rejected',
        status === 'Approved'
          ? `${partner.name} can now log in to the partner portal.`
          : `${partner.name} was rejected.`
      );
      void loadPartners();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to review partner application.');
    }
  };

  const openAdminEditor = (partner?: Partner) => {
    if (partner) {
      setEditingPartnerId(partner.id);
      setPartnerForm(createFormFromPartner(partner));
    } else {
      setEditingPartnerId(null);
      setPartnerForm(createEmptyPartnerForm());
    }
    setShowAdminEditor(true);
  };

  const renderChipGroup = (
    options: readonly string[],
    selectedValues: string[],
    onToggle: (value: string) => void
  ) => (
    <View style={styles.chipRow}>
      {options.map(option => {
        const selected = selectedValues.includes(option);
        return (
          <TouchableOpacity
            key={option}
            style={[styles.chip, selected && styles.chipActive]}
            onPress={() => onToggle(option)}
          >
            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{option}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderFormCard = ({
    title,
    submitLabel,
    onSubmit,
  }: {
    title: string;
    submitLabel: string;
    onSubmit: () => void;
  }) => (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>{title}</Text>
      <TextInput
        style={styles.input}
        placeholder="Organization Name"
        value={partnerForm.organizationName}
        onChangeText={value => updatePartnerForm('organizationName', value)}
      />

      <Text style={styles.sectionLabel}>Sector Type</Text>
      <View style={styles.chipRow}>
        {sectorOptions.map(option => {
          const selected = partnerForm.sectorType === option;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.chip, selected && styles.chipActive]}
              onPress={() => updatePartnerForm('sectorType', option)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{option}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        style={styles.input}
        placeholder="DSWD Accreditation No."
        value={partnerForm.dswdAccreditationNo}
        onChangeText={value => updatePartnerForm('dswdAccreditationNo', value)}
        autoCapitalize="characters"
      />

      <Text style={styles.sectionLabel}>Advocacy Focus</Text>
      {renderChipGroup(
        advocacyOptions,
        partnerForm.advocacyFocus,
        value => {
          const nextValues = partnerForm.advocacyFocus.includes(value as AdvocacyFocus)
            ? partnerForm.advocacyFocus.filter(item => item !== value)
            : [...partnerForm.advocacyFocus, value as AdvocacyFocus];
          updatePartnerForm('advocacyFocus', nextValues);
        }
      )}

      <TextInput
        style={styles.input}
        placeholder="Contact Email"
        value={partnerForm.contactEmail}
        onChangeText={value => updatePartnerForm('contactEmail', value)}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Mobile Number"
        value={partnerForm.contactPhone}
        onChangeText={value => updatePartnerForm('contactPhone', value)}
        keyboardType="phone-pad"
      />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Partnership notes or description"
        value={partnerForm.description}
        onChangeText={value => updatePartnerForm('description', value)}
        multiline
      />

      <TouchableOpacity style={styles.submitButton} onPress={onSubmit}>
        <Text style={styles.submitButtonText}>{submitLabel}</Text>
      </TouchableOpacity>
    </View>
  );

  const getStatusColor = (status: Partner['status']) => {
    switch (status) {
      case 'Approved':
        return '#16a34a';
      case 'Rejected':
        return '#dc2626';
      default:
        return '#f59e0b';
    }
  };

  const renderPartnerCard = (partner: Partner) => (
    <View key={partner.id} style={styles.partnerCard}>
      <View style={styles.partnerHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.partnerName}>{partner.name}</Text>
          <Text style={styles.partnerMeta}>
            {partner.sectorType} • DSWD {partner.dswdAccreditationNo || 'Pending'}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(partner.status) }]}>
          <Text style={styles.statusText}>{partner.status}</Text>
        </View>
      </View>

      <View style={styles.metaList}>
        <Text style={styles.metaLabel}>Advocacy Focus</Text>
        {renderChipGroup(
          partner.advocacyFocus.length > 0 ? partner.advocacyFocus : ['None'],
          [],
          () => {}
        )}
      </View>

      <View style={styles.infoGrid}>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Verification</Text>
          <Text style={styles.infoValue}>{partner.verificationStatus || 'Pending'}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Credentials</Text>
          <Text style={styles.infoValue}>
            {partner.credentialsUnlockedAt ? 'Unlocked' : 'Locked'}
          </Text>
        </View>
      </View>

      {partner.contactEmail ? (
        <Text style={styles.partnerMeta}>Email: {partner.contactEmail}</Text>
      ) : null}
      {partner.contactPhone ? (
        <Text style={styles.partnerMeta}>Mobile: {partner.contactPhone}</Text>
      ) : null}
      {partner.description ? (
        <Text style={styles.partnerDescription}>{partner.description}</Text>
      ) : null}
      {partner.verificationNotes ? (
        <View style={styles.verificationNote}>
          <MaterialIcons name="verified" size={16} color="#92400e" />
          <Text style={styles.verificationNoteText}>{partner.verificationNotes}</Text>
        </View>
      ) : null}

      {isAdmin ? (
        <View style={styles.adminActions}>
          <TouchableOpacity style={styles.editButton} onPress={() => openAdminEditor(partner)}>
            <MaterialIcons name="edit" size={18} color="#166534" />
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.verifyButton}
            onPress={() => handleVerify(partner.id)}
          >
            <MaterialIcons name="fact-check" size={18} color="#fff" />
            <Text style={styles.adminButtonText}>Verify</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.approveButton}
            onPress={() => handleReview(partner.id, 'Approved')}
          >
            <MaterialIcons name="check-circle" size={18} color="#fff" />
            <Text style={styles.adminButtonText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectButton}
            onPress={() => handleReview(partner.id, 'Rejected')}
          >
            <MaterialIcons name="cancel" size={18} color="#fff" />
            <Text style={styles.adminButtonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{isAdmin ? 'Inbound Inquiries' : 'Partner Registration Form'}</Text>
      <Text style={styles.subtitle}>
        {isAdmin
          ? 'Review organization submissions, verify DSWD accreditation numbers, and approve or reject portal access.'
          : 'Submit your organization details for verification. Partner login is unlocked after admin approval.'}
      </Text>

      {!isAdmin &&
        renderFormCard({
          title: latestOwnedPartner ? 'Update Organization Application' : 'New Organization Application',
          submitLabel: latestOwnedPartner ? 'Submit Application Update' : 'Submit Application',
          onSubmit: handleSaveApplication,
        })}

      {isAdmin && showAdminEditor
        ? renderFormCard({
            title: editingPartnerId ? 'Edit Partner Record' : 'Create Partner Record',
            submitLabel: editingPartnerId ? 'Save Changes' : 'Create Partner',
            onSubmit: handleSaveApplication,
          })
        : null}

      {isAdmin ? (
        <View style={styles.filterRow}>
          {(['All', 'Pending', 'Approved', 'Rejected'] as const).map(status => (
            <TouchableOpacity
              key={status}
              style={[styles.filterChip, filter === status && styles.filterChipActive]}
              onPress={() => setFilter(status)}
            >
              <Text style={[styles.filterChipText, filter === status && styles.filterChipTextActive]}>
                {status}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.list}>
        {partners.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="business" size={42} color="#94a3b8" />
            <Text style={styles.emptyText}>
              {isAdmin ? 'No inbound partner applications yet.' : 'No organization application submitted yet.'}
            </Text>
          </View>
        ) : (
          partners.map(renderPartnerCard)
        )}
      </View>

      {isAdmin ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => (showAdminEditor ? resetPartnerForm() : openAdminEditor())}
        >
          <MaterialIcons name={showAdminEditor ? 'close' : 'add'} size={26} color="#fff" />
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 96,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 16,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#0f172a',
    marginBottom: 12,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: '#166534',
  },
  chipText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 12,
  },
  chipTextActive: {
    color: '#fff',
  },
  submitButton: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  filterChipActive: {
    backgroundColor: '#166534',
  },
  filterChipText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 12,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  list: {
    gap: 12,
  },
  partnerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  partnerHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  partnerName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  partnerMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  metaList: {
    gap: 8,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  infoGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
  },
  infoLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  infoValue: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  partnerDescription: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  verificationNote: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 12,
    padding: 12,
  },
  verificationNoteText: {
    flex: 1,
    fontSize: 12,
    color: '#92400e',
    lineHeight: 18,
    fontWeight: '600',
  },
  adminActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  editButtonText: {
    color: '#166534',
    fontWeight: '700',
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f59e0b',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  adminButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    backgroundColor: '#fff',
    borderRadius: 16,
  },
  emptyText: {
    marginTop: 10,
    fontSize: 14,
    color: '#64748b',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#166534',
  },
});
