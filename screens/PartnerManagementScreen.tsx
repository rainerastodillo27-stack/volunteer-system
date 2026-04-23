import React, { useState, useEffect } from 'react';
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
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Partner, Project, PartnerSectorType, AdvocacyFocus } from '../models/types';
import {
  getAllPartners,
  getAllProjects,
  savePartner,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import InlineLoadError from '../components/InlineLoadError';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const sectorOptions: PartnerSectorType[] = ['NGO', 'Hospital', 'Institution', 'Private'];
const advocacyOptions: AdvocacyFocus[] = ['Nutrition', 'Education', 'Livelihood', 'Disaster'];

// Lets admins inspect approved partners, update their details, and view associated projects.
export default function PartnerManagementScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [sectorTypeDraft, setSectorTypeDraft] = useState<PartnerSectorType>('NGO');
  const [dswdAccreditationNoDraft, setDswdAccreditationNoDraft] = useState('');
  const [advocacyFocusDraft, setAdvocacyFocusDraft] = useState<AdvocacyFocus[]>([]);
  const [contactEmailDraft, setContactEmailDraft] = useState('');
  const [contactPhoneDraft, setContactPhoneDraft] = useState('');
  const [addressDraft, setAddressDraft] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void loadPartners();
    void loadProjects();
  }, [isAdmin]);

  useEffect(() => {
    const partnerId = route?.params?.partnerId;
    if (!isAdmin || !partnerId || partners.length === 0) {
      return;
    }

    const targetPartner = partners.find(partner => partner.id === partnerId);
    if (!targetPartner) {
      return;
    }

    void handleSelectPartner(targetPartner);
    navigation.setParams({ partnerId: undefined });
  }, [isAdmin, navigation, route?.params?.partnerId, partners]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return subscribeToStorageChanges(['partners', 'projects'], () => {
      void loadPartners();
      void loadProjects();
    });
  }, [isAdmin]);

  // Loads all approved partner profiles.
  const loadPartners = async () => {
    try {
      const allPartners = await getAllPartners();
      const approvedPartners = allPartners.filter(partner => partner.status === 'Approved');
      setPartners(approvedPartners);
      setLoadError(null);
      setSelectedPartner(currentSelectedPartner => {
        if (!currentSelectedPartner) {
          return currentSelectedPartner;
        }

        return (
          approvedPartners.find(partner => partner.id === currentSelectedPartner.id) ||
          currentSelectedPartner
        );
      });
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load partners.'),
      });
    }
  };

  // Loads available projects for display.
  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load projects.'),
      });
    }
  };

  // Opens the detail view for a selected partner.
  const handleSelectPartner = async (partner: Partner) => {
    setSelectedPartner(partner);
    setView('detail');
  };

  // Closes the partner detail view.
  const handleCloseDetail = () => {
    setView('list');
    setSelectedPartner(null);
  };

  // Opens the edit modal with the selected partner's current values.
  const openEditModal = (partner: Partner) => {
    setSelectedPartner(partner);
    setNameDraft(partner.name);
    setDescriptionDraft(partner.description || '');
    setSectorTypeDraft(partner.sectorType);
    setDswdAccreditationNoDraft(partner.dswdAccreditationNo);
    setAdvocacyFocusDraft([...partner.advocacyFocus]);
    setContactEmailDraft(partner.contactEmail || '');
    setContactPhoneDraft(partner.contactPhone || '');
    setAddressDraft(partner.address || '');
    setShowEditModal(true);
  };

  // Closes the partner editor.
  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedPartner(null);
  };

  // Saves changes made to the selected partner.
  const handleSavePartner = async () => {
    if (!selectedPartner) return;
    if (!nameDraft.trim()) {
      Alert.alert('Validation Error', 'Partner name is required.');
      return;
    }

    try {
      await savePartner({
        ...selectedPartner,
        name: nameDraft.trim(),
        description: descriptionDraft.trim() || undefined,
        sectorType: sectorTypeDraft,
        dswdAccreditationNo: dswdAccreditationNoDraft.trim(),
        advocacyFocus: advocacyFocusDraft,
        contactEmail: contactEmailDraft.trim() || undefined,
        contactPhone: contactPhoneDraft.trim() || undefined,
        address: addressDraft.trim() || undefined,
      });
      closeEditModal();
      await loadPartners();
      Alert.alert('Saved', 'Partner updated.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update partner.')
      );
    }
  };

  // Toggles an advocacy focus in the draft.
  const toggleAdvocacyFocus = (focus: AdvocacyFocus) => {
    setAdvocacyFocusDraft(current =>
      current.includes(focus)
        ? current.filter(item => item !== focus)
        : [...current, focus]
    );
  };

  // Returns projects linked to the selected partner through approved proposals.
  const getPartnerProjects = () => {
    if (!selectedPartner) return [];
    return projects.filter(project => project.partnerId === selectedPartner.id);
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Partner Management</Text>
        <View style={styles.emptyState}>
          <MaterialIcons name="lock" size={48} color="#cbd5e1" />
          <Text style={styles.emptyText}>Only admins can manage partners.</Text>
        </View>
      </View>
    );
  }

  if (view === 'detail' && selectedPartner) {
    const partnerProjects = getPartnerProjects();

    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCloseDetail}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Partner Profile</Text>
          <TouchableOpacity onPress={() => openEditModal(selectedPartner)}>
            <MaterialIcons name="edit" size={24} color="#4CAF50" />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.partnerHeader}>
            <View style={styles.partnerInfo}>
              <Text style={styles.partnerName}>{selectedPartner.name}</Text>
              <Text style={styles.partnerSector}>{selectedPartner.sectorType}</Text>
              <Text style={styles.partnerMeta}>
                DSWD: {selectedPartner.dswdAccreditationNo}
              </Text>
              <Text style={styles.partnerMeta}>
                Approved {format(new Date(selectedPartner.validatedAt || selectedPartner.createdAt), 'MMM dd, yyyy')}
              </Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.stat}>
              <MaterialIcons name="folder" size={24} color="#2196F3" />
              <Text style={styles.statValue}>{partnerProjects.length}</Text>
              <Text style={styles.statLabel}>Partnered Projects</Text>
            </View>
            <View style={styles.stat}>
              <MaterialIcons name="group" size={24} color="#FFA500" />
              <Text style={styles.statValue}>
                {partnerProjects.reduce((sum, project) => sum + project.volunteers.length, 0)}
              </Text>
              <Text style={styles.statLabel}>Volunteers</Text>
            </View>
            <View style={styles.stat}>
              <MaterialIcons name="location-on" size={24} color="#4CAF50" />
              <Text style={styles.statValue}>
                {partnerProjects.filter(p => p.status === 'Completed').length}
              </Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
          </View>
        </View>

        {selectedPartner.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.descriptionText}>{selectedPartner.description}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Information</Text>
          <View style={styles.contactInfo}>
            {selectedPartner.contactEmail ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Email:</Text>
                <Text style={styles.infoValue}>{selectedPartner.contactEmail}</Text>
              </View>
            ) : null}
            {selectedPartner.contactPhone ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Phone:</Text>
                <Text style={styles.infoValue}>{selectedPartner.contactPhone}</Text>
              </View>
            ) : null}
            {selectedPartner.address ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Address:</Text>
                <Text style={styles.infoValue}>{selectedPartner.address}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Advocacy Focus</Text>
          <View style={styles.focusContainer}>
            {selectedPartner.advocacyFocus.map(focus => (
              <View key={focus} style={styles.focusTag}>
                <Text style={styles.focusTagText}>{focus}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Partnered Projects</Text>
          {partnerProjects.length === 0 ? (
            <Text style={styles.emptyTextProjects}>No projects yet</Text>
          ) : (
            partnerProjects.map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>{project.category}</Text>
                  <Text style={styles.projectMeta}>
                    {project.volunteers.length} volunteer{project.volunteers.length === 1 ? '' : 's'} • {project.status}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color="#999" />
              </View>
            ))
          )}
        </View>

        <Modal visible={showEditModal} animationType="slide" onRequestClose={closeEditModal}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeEditModal}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Edit Partner</Text>
              <TouchableOpacity onPress={handleSavePartner}>
                <Text style={styles.modalSave}>Save</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              <TextInput
                style={styles.input}
                placeholder="Organization Name"
                value={nameDraft}
                onChangeText={setNameDraft}
              />
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Description"
                multiline
                value={descriptionDraft}
                onChangeText={setDescriptionDraft}
              />
              <TextInput
                style={styles.input}
                placeholder="DSWD Accreditation No"
                value={dswdAccreditationNoDraft}
                onChangeText={setDswdAccreditationNoDraft}
              />
              <TextInput
                style={styles.input}
                placeholder="Contact Email"
                keyboardType="email-address"
                autoCapitalize="none"
                value={contactEmailDraft}
                onChangeText={setContactEmailDraft}
              />
              <TextInput
                style={styles.input}
                placeholder="Contact Phone"
                keyboardType="phone-pad"
                value={contactPhoneDraft}
                onChangeText={setContactPhoneDraft}
              />
              <TextInput
                style={styles.input}
                placeholder="Address"
                value={addressDraft}
                onChangeText={setAddressDraft}
              />

              <Text style={styles.fieldLabel}>Sector Type</Text>
              <View style={styles.optionsGrid}>
                {sectorOptions.map(sector => (
                  <TouchableOpacity
                    key={sector}
                    style={[styles.optionButton, sectorTypeDraft === sector && styles.optionButtonActive]}
                    onPress={() => setSectorTypeDraft(sector)}
                  >
                    <Text style={[styles.optionButtonText, sectorTypeDraft === sector && styles.optionButtonTextActive]}>
                      {sector}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Advocacy Focus</Text>
              <View style={styles.optionsGrid}>
                {advocacyOptions.map(focus => (
                  <TouchableOpacity
                    key={focus}
                    style={[styles.optionButton, advocacyFocusDraft.includes(focus) && styles.optionButtonActive]}
                    onPress={() => toggleAdvocacyFocus(focus)}
                  >
                    <Text style={[styles.optionButtonText, advocacyFocusDraft.includes(focus) && styles.optionButtonTextActive]}>
                      {focus}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  const sortedPartners = [...partners].sort((left, right) => left.name.localeCompare(right.name));

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Partner Management</Text>
      </View>
      <View style={styles.listContent}>
        {loadError ? (
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => {
              void loadPartners();
              void loadProjects();
            }}
          />
        ) : null}
      </View>
      <FlatList
        data={sortedPartners}
        keyExtractor={partner => partner.id}
        renderItem={({ item: partner }) => (
          <TouchableOpacity
            style={styles.partnerCard}
            onPress={() => handleSelectPartner(partner)}
          >
            <View style={styles.partnerCardContent}>
              <Text style={styles.partnerCardName}>{partner.name}</Text>
              <Text style={styles.partnerCardSector}>{partner.sectorType}</Text>
              <Text style={styles.partnerCardMeta}>
                {partner.advocacyFocus.join(', ')}
              </Text>
              <Text style={styles.partnerCardMeta}>
                {projects.filter(p => p.partnerId === partner.id).length} partnered projects
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#999" />
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.listContainer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  titleRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  listContainer: {
    padding: 16,
  },
  partnerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  partnerCardContent: {
    flex: 1,
  },
  partnerCardName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  partnerCardSector: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 2,
  },
  partnerCardMeta: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  partnerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  partnerInfo: {
    flex: 1,
  },
  partnerName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  partnerSector: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 2,
  },
  partnerMeta: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  descriptionText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  contactInfo: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    width: 80,
  },
  infoValue: {
    fontSize: 14,
    color: '#6b7280',
    flex: 1,
  },
  focusContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  focusTag: {
    backgroundColor: '#dbeafe',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  focusTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e40af',
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  projectCategory: {
    fontSize: 14,
    color: '#64748b',
  },
  projectMeta: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  emptyTextProjects: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalCancel: {
    color: '#64748b',
    fontSize: 15,
  },
  modalSave: {
    color: '#15803d',
    fontSize: 15,
    fontWeight: '700',
  },
  modalContent: {
    padding: 16,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
    marginTop: 4,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  optionButtonActive: {
    backgroundColor: '#166534',
  },
  optionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  optionButtonTextActive: {
    color: '#fff',
  },
});
