import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Partner } from '../models/types';
import { getAllPartners, savePartner, subscribeToStorageChanges } from '../models/storage';
import { useAuth } from '../contexts/AuthContext';

type PartnerFormState = {
  name: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  category: Partner['category'];
};

// Returns the default partner form state for create or edit mode.
function createEmptyPartnerForm(defaultEmail = ''): PartnerFormState {
  return {
    name: '',
    description: '',
    contactEmail: defaultEmail,
    contactPhone: '',
    address: '',
    category: 'Other',
  };
}

// Manages partner organization submission, review, and admin editing flows.
export default function PartnerOnboardingScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [loading, setLoading] = useState(true);
  const [partnerForm, setPartnerForm] = useState<PartnerFormState>(
    createEmptyPartnerForm(user?.email ?? '')
  );
  const [editingPartnerId, setEditingPartnerId] = useState<string | null>(null);
  const [showAdminEditor, setShowAdminEditor] = useState(false);

  // Checks whether a partner record belongs to the signed-in partner account.
  const isOwnedByCurrentPartner = React.useCallback((partner: Partner) => {
    if (!user) {
      return false;
    }

    if (partner.ownerUserId) {
      return partner.ownerUserId === user.id;
    }

    return partner.contactEmail.toLowerCase() === user.email?.toLowerCase();
  }, [user]);

  // Loads the partner list for the current role and active filter.
  const loadPartners = React.useCallback(async () => {
    try {
      const allPartners = await getAllPartners();
      if (isAdmin) {
        if (filter === 'All') {
          setPartners(allPartners);
        } else {
          setPartners(allPartners.filter(p => p.status === filter));
        }
        return;
      }

      const ownPartners = allPartners.filter(isOwnedByCurrentPartner);
      setPartners(ownPartners);
    } catch (error) {
      Alert.alert('Error', 'Failed to load partners');
    } finally {
      setLoading(false);
    }
  }, [filter, isAdmin, isOwnedByCurrentPartner]);

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

  // Updates a single field in the partner form state.
  const updatePartnerForm = <K extends keyof PartnerFormState>(
    key: K,
    value: PartnerFormState[K]
  ) => {
    setPartnerForm(current => ({ ...current, [key]: value }));
  };

  // Resets the partner form after save or cancel actions.
  const resetPartnerForm = () => {
    setPartnerForm(createEmptyPartnerForm(isAdmin ? '' : user?.email ?? ''));
    setEditingPartnerId(null);
    setShowAdminEditor(false);
  };

  // Marks a pending partner organization as approved.
  const handleApprove = async (partnerId: string) => {
    try {
      const partner = partners.find(p => p.id === partnerId);
      if (!partner) return;

      await savePartner({
        ...partner,
        status: 'Approved',
        validatedBy: user?.id,
        validatedAt: new Date().toISOString(),
      });
      Alert.alert('Success', `${partner.name} has been approved`);
      void loadPartners();
    } catch (error) {
      Alert.alert('Error', 'Failed to approve partner');
    }
  };

  // Marks a pending partner organization as rejected.
  const handleReject = async (partnerId: string) => {
    try {
      const partner = partners.find(p => p.id === partnerId);
      if (!partner) return;

      await savePartner({
        ...partner,
        status: 'Rejected',
        validatedBy: user?.id,
        validatedAt: new Date().toISOString(),
      });
      Alert.alert('Success', `${partner.name} has been rejected`);
      void loadPartners();
    } catch (error) {
      Alert.alert('Error', 'Failed to reject partner');
    }
  };

  // Opens the admin edit form using an existing partner record.
  const handleEditPartner = (partner: Partner) => {
    setEditingPartnerId(partner.id);
    setPartnerForm({
      name: partner.name,
      description: partner.description,
      contactEmail: partner.contactEmail,
      contactPhone: partner.contactPhone,
      address: partner.address,
      category: partner.category,
    });
    setShowAdminEditor(true);
  };

  // Opens an empty admin form for creating a new partner organization.
  const handleOpenAdminCreate = () => {
    setEditingPartnerId(null);
    setPartnerForm(createEmptyPartnerForm());
    setShowAdminEditor(true);
  };

  // Saves an admin-created or admin-edited partner organization profile.
  const handleSavePartnerProfile = async () => {
    if (
      !partnerForm.name.trim() ||
      !partnerForm.description.trim() ||
      !partnerForm.contactEmail.trim() ||
      !partnerForm.contactPhone.trim() ||
      !partnerForm.address.trim()
    ) {
      Alert.alert('Validation Error', 'Please fill all partner organization fields.');
      return;
    }

    try {
      const existingPartner =
        editingPartnerId ? partners.find(partner => partner.id === editingPartnerId) || null : null;
      const now = new Date().toISOString();

      const savedPartner: Partner = {
        id: existingPartner?.id || `partner-${Date.now()}`,
        ownerUserId: existingPartner?.ownerUserId,
        name: partnerForm.name.trim(),
        description: partnerForm.description.trim(),
        category: partnerForm.category,
        contactEmail: partnerForm.contactEmail.trim().toLowerCase(),
        contactPhone: partnerForm.contactPhone.trim(),
        address: partnerForm.address.trim(),
        status: existingPartner?.status || 'Pending',
        validatedBy: existingPartner?.validatedBy,
        validatedAt: existingPartner?.validatedAt,
        createdAt: existingPartner?.createdAt || now,
        registrationDocuments: existingPartner?.registrationDocuments,
      };

      await savePartner(savedPartner);
      resetPartnerForm();
      Alert.alert(
        'Saved',
        existingPartner ? 'Partner organization updated.' : 'Partner organization created.'
      );
      void loadPartners();
    } catch (error) {
      Alert.alert('Error', 'Failed to save partner organization.');
    }
  };

  // Renders the reusable partner submission form for admin and partner flows.
  const renderPartnerFormCard = ({
    title,
    submitLabel,
    onSubmit,
    onCancel,
  }: {
    title: string;
    submitLabel: string;
    onSubmit: () => void;
    onCancel?: () => void;
  }) => (
    <View style={styles.submissionCard}>
      <Text style={styles.submissionTitle}>{title}</Text>
      <TextInput
        style={styles.input}
        placeholder="Program or Organization Name"
        value={partnerForm.name}
        onChangeText={value => updatePartnerForm('name', value)}
      />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Description / Focus area"
        value={partnerForm.description}
        onChangeText={value => updatePartnerForm('description', value)}
        multiline
      />
      <View style={styles.chipRow}>
        {(['Education', 'Livelihood', 'Nutrition', 'Other'] as const).map(option => (
          <TouchableOpacity
            key={option}
            style={[styles.chip, partnerForm.category === option && styles.chipActive]}
            onPress={() => updatePartnerForm('category', option)}
          >
            <Text
              style={[
                styles.chipText,
                partnerForm.category === option && styles.chipTextActive,
              ]}
            >
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
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
        placeholder="Contact Phone"
        value={partnerForm.contactPhone}
        onChangeText={value => updatePartnerForm('contactPhone', value)}
        keyboardType="phone-pad"
      />
      <TextInput
        style={styles.input}
        placeholder="Address / City"
        value={partnerForm.address}
        onChangeText={value => updatePartnerForm('address', value)}
      />
      <View style={styles.formActions}>
        {onCancel ? (
          <TouchableOpacity style={[styles.formButton, styles.cancelButton]} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.formButton, styles.submitButton]} onPress={onSubmit}>
          <Text style={styles.submitButtonText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // Renders one partner organization card with actions based on the current role.
  const renderPartnerCard = (partner: Partner) => {
    // Chooses the background color for the partner status badge.
    const getStatusColor = (status: string) => {
      switch (status) {
        case 'Approved':
          return '#4CAF50';
        case 'Pending':
          return '#FFA500';
        case 'Rejected':
          return '#f44336';
        default:
          return '#999';
      }
    };

    return (
      <View key={partner.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>{partner.name}</Text>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{partner.category}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(partner.status) }]}>
            <Text style={styles.statusText}>{partner.status}</Text>
          </View>
        </View>

        <Text style={styles.description}>{partner.description}</Text>

        <View style={styles.contactInfo}>
          <View style={styles.contactRow}>
            <MaterialIcons name="email" size={16} color="#666" />
            <Text style={styles.contactText}>{partner.contactEmail}</Text>
          </View>
          <View style={styles.contactRow}>
            <MaterialIcons name="phone" size={16} color="#666" />
            <Text style={styles.contactText}>{partner.contactPhone}</Text>
          </View>
          <View style={styles.contactRow}>
            <MaterialIcons name="location-on" size={16} color="#666" />
            <Text style={styles.contactText}>{partner.address}</Text>
          </View>
        </View>

        {isAdmin && (
          <View style={styles.adminActionStack}>
            <TouchableOpacity
              style={[styles.button, styles.editButton]}
              onPress={() => handleEditPartner(partner)}
            >
              <MaterialIcons name="edit" size={18} color="#166534" />
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>

            {partner.status === 'Pending' && (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={[styles.button, styles.approveButton]}
                  onPress={() => handleApprove(partner.id)}
                >
                  <MaterialIcons name="check-circle" size={20} color="#fff" />
                  <Text style={styles.buttonText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.rejectButton]}
                  onPress={() => handleReject(partner.id)}
                >
                  <MaterialIcons name="cancel" size={20} color="#fff" />
                  <Text style={styles.buttonText}>Reject</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  // Submits a new partner onboarding request from a partner account.
  const handleSubmitPartner = async () => {
    if (
      !partnerForm.name.trim() ||
      !partnerForm.description.trim() ||
      !partnerForm.contactEmail.trim() ||
      !partnerForm.contactPhone.trim() ||
      !partnerForm.address.trim()
    ) {
      Alert.alert('Validation Error', 'Please fill all partner program fields.');
      return;
    }

    try {
      const newPartner: Partner = {
        id: `partner-${Date.now()}`,
        ownerUserId: user?.id,
        name: partnerForm.name.trim(),
        description: partnerForm.description.trim(),
        category: partnerForm.category,
        contactEmail: partnerForm.contactEmail.trim().toLowerCase(),
        contactPhone: partnerForm.contactPhone.trim(),
        address: partnerForm.address.trim(),
        status: 'Pending',
        createdAt: new Date().toISOString(),
      };

      await savePartner(newPartner);
      setPartnerForm(createEmptyPartnerForm(user?.email ?? ''));
      Alert.alert('Submitted', 'Program onboarding request sent for admin approval.');
      void loadPartners();
    } catch (error) {
      Alert.alert('Error', 'Failed to submit program.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Partner Onboarding</Text>

      {user?.role === 'partner' && (
        renderPartnerFormCard({
          title: 'Submit Program / Organization',
          submitLabel: 'Submit for Approval',
          onSubmit: handleSubmitPartner,
        })
      )}

      {isAdmin && showAdminEditor && (
        renderPartnerFormCard({
          title: editingPartnerId ? 'Edit Partner Organization' : 'Create Partner Organization',
          submitLabel: editingPartnerId ? 'Save Changes' : 'Create Partner',
          onSubmit: handleSavePartnerProfile,
          onCancel: resetPartnerForm,
        })
      )}

      {isAdmin && (
        <View style={styles.filterContainer}>
          {(['All', 'Pending', 'Approved', 'Rejected'] as const).map(status => (
            <TouchableOpacity
              key={status}
              style={[styles.filterButton, filter === status && styles.filterButtonActive]}
              onPress={() => setFilter(status)}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  filter === status && styles.filterButtonTextActive,
                ]}
              >
                {status}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {partners.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="business" size={48} color="#ccc" />
          <Text style={styles.emptyText}>
            {isAdmin ? 'No partners found' : 'Partners are visible to admins only'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {partners.map(renderPartnerCard)}
        </View>
      )}

      {isAdmin && (
        <TouchableOpacity
          style={styles.fab}
          onPress={showAdminEditor ? resetPartnerForm : handleOpenAdminCreate}
        >
          <MaterialIcons name={showAdminEditor ? 'close' : 'add'} size={28} color="#fff" />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  submissionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  submissionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    backgroundColor: '#fff',
    color: '#333',
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  formActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  formButton: {
    flex: 1,
  },
  cancelButton: {
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e0e0e0',
  },
  chipActive: {
    backgroundColor: '#4CAF50',
  },
  chipText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e0e0e0',
  },
  filterButtonActive: {
    backgroundColor: '#4CAF50',
  },
  filterButtonText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  categoryBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  categoryText: {
    color: '#2E7D32',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  description: {
    color: '#666',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  contactInfo: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactText: {
    color: '#666',
    fontSize: 13,
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  adminActionStack: {
    gap: 8,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  approveButton: {
    backgroundColor: '#4CAF50',
  },
  rejectButton: {
    backgroundColor: '#f44336',
  },
  editButton: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  editButtonText: {
    color: '#166534',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    marginBottom: 80,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#999',
    fontSize: 16,
    marginTop: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});
