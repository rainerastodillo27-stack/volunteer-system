import React, { useMemo, useState, useEffect } from 'react';
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
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import {
  Partner,
  Project,
  PartnerSectorType,
  AdvocacyFocus,
  PartnerProjectApplication,
} from '../models/types';
import {
  getAllPartners,
  getAllProjects,
  savePartner,
  reviewPartnerRegistration,
  subscribeToStorageChanges,
  getAllPartnerProjectApplications,
  reviewPartnerProjectApplication,
} from '../models/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import InlineLoadError from '../components/InlineLoadError';
import { getProjectDisplayStatus } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { navigateToAvailableRoute } from '../utils/navigation';

const sectorOptions: PartnerSectorType[] = ['NGO', 'Hospital', 'Institution', 'Private'];
const advocacyOptions: AdvocacyFocus[] = ['Nutrition', 'Education', 'Livelihood', 'Disaster'];

export default function PartnerManagementScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const insets = useSafeAreaInsets();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [allPartnersList, setAllPartnersList] = useState<Partner[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [applications, setApplications] = useState<PartnerProjectApplication[]>([]);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [activeTab, setActiveTab] = useState<'approved' | 'pending' | 'all'>('approved');
  const [pendingFilter, setPendingFilter] = useState<'all' | 'registrations' | 'proposals'>('all');
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<Partner | PartnerProjectApplication | null>(null);
  const [reviewTargetType, setReviewTargetType] = useState<'partner' | 'proposal' | null>(null);
  const [reviewMode, setReviewMode] = useState<'revision' | 'rejection' | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [sectorTypeDraft, setSectorTypeDraft] = useState<PartnerSectorType>('NGO');
  const [dswdAccreditationNoDraft, setDswdAccreditationNoDraft] = useState('');
  const [advocacyFocusDraft, setAdvocacyFocusDraft] = useState<AdvocacyFocus[]>([]);
  const [contactEmailDraft, setContactEmailDraft] = useState('');
  const [contactPhoneDraft, setContactPhoneDraft] = useState('');
  const [addressDraft, setAddressDraft] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sectorFilter, setSectorFilter] = useState<PartnerSectorType | 'All'>('All');

  useEffect(() => {
    if (navigation) {
      const showHeader = view === 'list';
      navigation.setOptions({ headerShown: showHeader });
    }
  }, [view, navigation]);

  useEffect(() => {
    if (!actionNotice) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setActionNotice(null);
    }, 2000);

    return () => clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void loadPartners();
    void loadProjects();
  }, [isAdmin]);

  useEffect(() => {
    const partnerId = route?.params?.partnerId;
    if (!isAdmin || !partnerId || allPartnersList.length === 0) {
      return;
    }

    const targetPartner = allPartnersList.find(partner => partner.id === partnerId);
    if (!targetPartner) {
      return;
    }

    void handleSelectPartner(targetPartner);
    navigation.setParams({ partnerId: undefined });
  }, [isAdmin, navigation, route?.params?.partnerId, allPartnersList]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return subscribeToStorageChanges(
      ['partners', 'users', 'partnerProjectApplications', 'projects'],
      () => {
        void loadPartners();
        void loadProjects();
      }
    );
  }, [isAdmin]);

  // Loads all partner profiles and applications.
  const loadPartners = async () => {
    try {
      const allPartners = await getAllPartners();
      setAllPartnersList(allPartners);
      const approvedPartners = allPartners.filter(partner => partner.status === 'Approved');
      setPartners(approvedPartners);
      const allApps = await getAllPartnerProjectApplications();
      setApplications(allApps);
      setLoadError(null);
      setSelectedPartner(currentSelectedPartner => {
        if (!currentSelectedPartner) {
          return currentSelectedPartner;
        }

        return (
          allPartners.find(partner => partner.id === currentSelectedPartner.id) ||
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

  const handleApprovePartner = async (partner: Partner) => {
    try {
      await reviewPartnerRegistration(partner.id, 'Approved', user?.id || 'admin');
      setActionNotice(`Approved "${partner.name}". Organization credentials unlocked.`);
      await loadPartners();
      if (selectedPartner?.id === partner.id) {
        setSelectedPartner(curr => curr ? { ...curr, status: 'Approved' } : null);
      }
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve partner.');
    }
  };

  const openPartnerReview = (partner: Partner, mode: 'revision' | 'rejection') => {
    setReviewTarget(partner);
    setReviewTargetType('partner');
    setReviewMode(mode);
  };

  const openProposalReview = (proposal: PartnerProjectApplication, mode: 'revision' | 'rejection') => {
    setReviewTarget(proposal);
    setReviewTargetType('proposal');
    setReviewMode(mode);
  };

  const closeReviewModal = () => {
    setReviewTarget(null);
    setReviewTargetType(null);
    setReviewMode(null);
  };

  const confirmReviewAction = async () => {
    if (!reviewTarget || !reviewTargetType || !reviewMode) return;

    try {
      if (reviewTargetType === 'partner') {
        const partnerTarget = reviewTarget as Partner;
        const rejectionReason =
          reviewMode === 'revision'
            ? 'Returned for revision by administrator.'
            : 'Partner registration rejected by administrator.';
        await reviewPartnerRegistration(
          partnerTarget.id,
          'Rejected',
          user?.id || 'admin',
          rejectionReason
        );
        setActionNotice(
          reviewMode === 'revision'
            ? `Sent "${partnerTarget.name}" back for revision.`
            : `Totally rejected "${partnerTarget.name}".`
        );
      } else {
        const proposalTarget = reviewTarget as PartnerProjectApplication;
        const reviewNotes =
          reviewMode === 'revision'
            ? 'Returned for revision by administrator.'
            : 'Partner project proposal rejected by administrator.';
        await reviewPartnerProjectApplication(
          proposalTarget.id,
          'Rejected',
          user?.id || 'admin',
          reviewNotes
        );
        const title = proposalTarget.proposalDetails?.proposedTitle || proposalTarget.projectId;
        setActionNotice(
          reviewMode === 'revision'
            ? `Sent proposal "${title}" back for revision.`
            : `Totally rejected proposal "${title}".`
        );
      }

      closeReviewModal();
      await loadPartners();
      await loadProjects();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to perform review action.');
    }
  };

  const handleApproveProposal = async (application: PartnerProjectApplication) => {
    try {
      const reviewedApp = await reviewPartnerProjectApplication(application.id, 'Approved', user?.id || 'admin');
      const title = application.proposalDetails?.proposedTitle || application.projectId;
      setActionNotice(`Approved proposal "${title}".`);
      await loadPartners();
      await loadProjects();
      
      if (reviewedApp.projectId) {
        navigateToAvailableRoute(navigation, 'Projects', { projectId: reviewedApp.projectId });
      }
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve proposal.');
    }
  };

  const handleRejectProposal = async (application: PartnerProjectApplication) => {
    openProposalReview(application, 'rejection');
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
  };

  // Saves changes made to the selected partner.
  const handleSavePartner = async () => {
    if (!selectedPartner) return;
    if (!nameDraft.trim()) {
      Alert.alert('Validation Error', 'Partner name is required.');
      return;
    }

    const previousPartners = partners;
    const previousSelectedPartner = selectedPartner;

    try {
      const updatedPartner: Partner = {
        ...selectedPartner,
        name: nameDraft.trim(),
        description: descriptionDraft.trim() || undefined,
        sectorType: sectorTypeDraft,
        dswdAccreditationNo: dswdAccreditationNoDraft.trim(),
        advocacyFocus: advocacyFocusDraft,
        contactEmail: contactEmailDraft.trim() || undefined,
        contactPhone: contactPhoneDraft.trim() || undefined,
        address: addressDraft.trim() || undefined,
      };
      setPartners(currentPartners =>
        currentPartners.map(partner => (partner.id === updatedPartner.id ? updatedPartner : partner))
      );
      setSelectedPartner(updatedPartner);
      closeEditModal();
      setActionNotice('Partner updated.');
      await savePartner(updatedPartner);
      void loadPartners();
    } catch (error) {
      setPartners(previousPartners);
      setSelectedPartner(previousSelectedPartner);
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

  // Returns projects linked to the selected partner.
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
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCloseDetail}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Partner Profile</Text>
          <TouchableOpacity onPress={() => openEditModal(selectedPartner)}>
            <MaterialIcons name="edit" size={24} color="#4CAF50" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }}>
          {actionNotice ? (
            <View style={styles.noticeBanner}>
              <MaterialIcons name="check-circle" size={18} color="#166534" />
              <Text style={styles.noticeBannerText}>{actionNotice}</Text>
            </View>
          ) : null}

          {selectedPartner.status === 'Pending' && (
            <View style={styles.detailPendingBanner}>
              <View style={styles.detailPendingCopy}>
                <View style={styles.pendingPill}>
                  <MaterialIcons name="schedule" size={12} color="#b45309" />
                  <Text style={styles.pendingPillText}>Pending Registration Review</Text>
                </View>
                <Text style={styles.detailPendingTitle}>
                  Review Organization Application
                </Text>
                <Text style={styles.detailPendingSubtitle}>
                  Approving this organization will unlock login credentials for their account.
                </Text>
              </View>
              <View style={styles.detailPendingActions}>
                    <TouchableOpacity
                      style={styles.appRejectButton}
                      onPress={() => openPartnerReview(selectedPartner, 'revision')}
                    >
                      <MaterialIcons name="replay" size={16} color="#dc2626" />
                      <Text style={styles.appRejectButtonText}>For Revise</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.appRejectButton, styles.appRejectButtonHard]}
                      onPress={() => openPartnerReview(selectedPartner, 'rejection')}
                    >
                      <MaterialIcons name="block" size={16} color="#b91c1c" />
                      <Text style={styles.appRejectButtonText}>Totally Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.appApproveButton}
                      onPress={() => handleApprovePartner(selectedPartner)}
                >
                  <MaterialIcons name="check" size={16} color="#fff" />
                  <Text style={styles.appApproveButtonText}>Approve Partner</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.partnerHeader}>
              <View style={styles.partnerInfo}>
                <Text style={styles.partnerName}>{selectedPartner.name}</Text>
                <Text style={styles.partnerSector}>{selectedPartner.sectorType}</Text>
                {selectedPartner.dswdAccreditationNo ? (
                  <Text style={styles.partnerMeta}>
                    DSWD: {selectedPartner.dswdAccreditationNo}
                  </Text>
                ) : null}
                {selectedPartner.secRegistrationNo ? (
                  <Text style={styles.partnerMeta}>
                    SEC: {selectedPartner.secRegistrationNo}
                  </Text>
                ) : null}
                <Text style={styles.partnerMeta}>
                  {selectedPartner.status === 'Approved'
                    ? `Approved ${format(new Date(selectedPartner.validatedAt || selectedPartner.createdAt), 'MMM dd, yyyy')}`
                    : `Submitted ${format(new Date(selectedPartner.createdAt), 'MMM dd, yyyy')}`}
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
                  {partnerProjects.filter(p => getProjectDisplayStatus(p) === 'Completed').length}
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
                      {project.volunteers.length} volunteer{project.volunteers.length === 1 ? '' : 's'} • {getProjectDisplayStatus(project)}
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
      </View>
    );
  }

  const sectorFilters: Array<PartnerSectorType | 'All'> = ['All', ...sectorOptions];

  const pendingPartners = useMemo(() => {
    return allPartnersList.filter(partner => partner.status === 'Pending');
  }, [allPartnersList]);

  const approvedPartners = useMemo(() => {
    return allPartnersList.filter(partner => partner.status === 'Approved');
  }, [allPartnersList]);

  const pendingProposals = useMemo(() => {
    return applications.filter(app => app.status === 'Pending');
  }, [applications]);

  const totalPendingCount = pendingPartners.length + pendingProposals.length;

  const displayList = useMemo(() => {
    if (activeTab === 'pending') {
      return pendingPartners;
    }
    if (activeTab === 'all') {
      return allPartnersList;
    }
    return approvedPartners;
  }, [activeTab, pendingPartners, approvedPartners, allPartnersList]);

  const filteredPartners = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return [...displayList]
      .filter(partner => sectorFilter === 'All' || partner.sectorType === sectorFilter)
      .filter(partner => !normalizedSearch || [partner.name, partner.sectorType, partner.dswdAccreditationNo, partner.secRegistrationNo, ...partner.advocacyFocus]
        .join(' ').toLowerCase().includes(normalizedSearch))
      .sort((left, right) => {
        if (activeTab === 'pending') {
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        }
        return left.name.localeCompare(right.name);
      });
  }, [displayList, searchTerm, sectorFilter, activeTab]);

  const filteredPendingProposals = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return pendingProposals.filter(proposal => {
      if (!normalizedSearch) return true;
      const title = proposal.proposalDetails?.proposedTitle || proposal.projectId || '';
      const name = proposal.partnerName || '';
      const module = proposal.proposalDetails?.requestedProgramModule || '';
      return `${title} ${name} ${module}`.toLowerCase().includes(normalizedSearch);
    });
  }, [pendingProposals, searchTerm]);

  const partnerProjectCount = projects.filter(project => allPartnersList.some(partner => partner.id === project.partnerId)).length;
  const nextSectorFilter = () => {
    const currentIndex = sectorFilters.indexOf(sectorFilter);
    setSectorFilter(sectorFilters[(currentIndex + 1) % sectorFilters.length]);
  };
  const getPartnerInitials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const getPartnerSince = (partner: Partner) => format(new Date(partner.validatedAt || partner.createdAt), 'MMM d, yyyy');

  return (
    <View style={styles.container}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.title}>Partner Management</Text>
          <Text style={styles.subtitle}>Review partner applications, verify organizations, and manage collaborations.</Text>
        </View>
        <View style={styles.headerAccent}>
          <MaterialIcons name="handshake" size={22} color="#166534" />
        </View>
      </View>

      {actionNotice ? (
        <View style={styles.noticeBanner}>
          <MaterialIcons name="check-circle" size={18} color="#166534" />
          <Text style={styles.noticeBannerText}>{actionNotice}</Text>
        </View>
      ) : null}

      {totalPendingCount > 0 && activeTab !== 'pending' && (
        <TouchableOpacity
          style={styles.pendingAlertBanner}
          onPress={() =>
            navigateToAvailableRoute(
              navigation,
              'Messages',
              { section: 'proposals' },
              { routeName: 'Messages', params: { section: 'proposals' } }
            )
          }
          activeOpacity={0.85}
        >
          <View style={styles.pendingAlertLeft}>
            <MaterialIcons name="notification-important" size={22} color="#b45309" />
            <View>
              <Text style={styles.pendingAlertTitle}>
                {totalPendingCount} Pending Application{totalPendingCount === 1 ? '' : 's'} in Messages
              </Text>
              <Text style={styles.pendingAlertSubtitle}>
                {pendingPartners.length > 0 ? `${pendingPartners.length} partner registration(s)` : ''}
                {pendingPartners.length > 0 && pendingProposals.length > 0 ? ' • ' : ''}
                {pendingProposals.length > 0 ? `${pendingProposals.length} project proposal(s)` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.pendingAlertButton}>
            <Text style={styles.pendingAlertButtonText}>Open Messages</Text>
            <MaterialIcons name="arrow-forward" size={16} color="#ffffff" />
          </View>
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={styles.managementContent} showsVerticalScrollIndicator={false}>
        {loadError ? (
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => { void loadPartners(); void loadProjects(); }}
          />
        ) : null}

        <View style={styles.summaryGrid}>
          {[
            {
              tab: 'approved' as const,
              label: 'Active partners',
              value: approvedPartners.length,
              note: 'Verified organizations',
              icon: 'groups',
              tint: '#eaf7ed',
              color: '#258044',
            },
            {
              tab: 'pending' as const,
              label: 'Pending Applications',
              value: totalPendingCount,
              note: totalPendingCount > 0 ? `${pendingPartners.length} regs · ${pendingProposals.length} proposals` : 'No pending reviews',
              icon: 'pending-actions',
              tint: totalPendingCount > 0 ? '#fef3c7' : '#f1f5f9',
              color: totalPendingCount > 0 ? '#b45309' : '#64748b',
              highlight: totalPendingCount > 0,
            },
            {
              label: 'Partnered projects',
              value: partnerProjectCount,
              note: 'Projects with a partner',
              icon: 'folder-special',
              tint: '#eef4ff',
              color: '#2f69bd',
            },
            {
              label: 'Approved Proposals',
              value: applications.filter(app => app.status === 'Approved').length,
              note: 'Proposals approved',
              icon: 'check-circle',
              tint: '#f6efff',
              color: '#7c52bd',
            },
          ].map(stat => (
            <TouchableOpacity
              key={stat.label}
              style={[
                styles.summaryCard,
                stat.tab && activeTab === stat.tab && styles.summaryCardActive,
                stat.highlight && styles.summaryCardHighlight,
              ]}
              onPress={() => {
                if (stat.tab) {
                  setActiveTab(stat.tab);
                }
              }}
              activeOpacity={stat.tab ? 0.75 : 1}
            >
              <View style={[styles.summaryIcon, { backgroundColor: stat.tint }]}>
                <MaterialIcons name={stat.icon as any} size={24} color={stat.color} />
              </View>
              <View style={styles.summaryCopy}>
                <Text style={[styles.summaryValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={styles.summaryLabel}>{stat.label}</Text>
                <Text style={styles.summaryNote}>{stat.note}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'approved' && styles.tabButtonActive]}
            onPress={() => setActiveTab('approved')}
          >
            <MaterialIcons
              name="verified"
              size={18}
              color={activeTab === 'approved' ? '#166534' : '#64748b'}
            />
            <Text style={[styles.tabButtonText, activeTab === 'approved' && styles.tabButtonTextActive]}>
              Active Partners ({approvedPartners.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'pending' && styles.tabButtonActivePending]}
            onPress={() => setActiveTab('pending')}
          >
            <MaterialIcons
              name="pending-actions"
              size={18}
              color={activeTab === 'pending' ? '#b45309' : '#64748b'}
            />
            <Text style={[styles.tabButtonText, activeTab === 'pending' && styles.tabButtonTextActivePending]}>
              Applications ({totalPendingCount})
            </Text>
            {totalPendingCount > 0 && (
              <View style={styles.tabPendingBadge}>
                <Text style={styles.tabPendingBadgeText}>{totalPendingCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
            onPress={() => setActiveTab('all')}
          >
            <MaterialIcons
              name="list-alt"
              size={18}
              color={activeTab === 'all' ? '#166534' : '#64748b'}
            />
            <Text style={[styles.tabButtonText, activeTab === 'all' && styles.tabButtonTextActive]}>
              All ({allPartnersList.length})
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'pending' && (
          <View style={styles.subFilterRow}>
            <TouchableOpacity
              style={[styles.subFilterChip, pendingFilter === 'all' && styles.subFilterChipActive]}
              onPress={() => setPendingFilter('all')}
            >
              <Text style={[styles.subFilterChipText, pendingFilter === 'all' && styles.subFilterChipTextActive]}>
                All Applications ({totalPendingCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.subFilterChip, pendingFilter === 'registrations' && styles.subFilterChipActive]}
              onPress={() => setPendingFilter('registrations')}
            >
              <Text style={[styles.subFilterChipText, pendingFilter === 'registrations' && styles.subFilterChipTextActive]}>
                Registrations ({pendingPartners.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.subFilterChip, pendingFilter === 'proposals' && styles.subFilterChipActive]}
              onPress={() => setPendingFilter('proposals')}
            >
              <Text style={[styles.subFilterChipText, pendingFilter === 'proposals' && styles.subFilterChipTextActive]}>
                Project Proposals ({pendingProposals.length})
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.directoryCard}>
          <View style={styles.directoryHeader}>
            <View>
              <Text style={styles.directoryTitle}>
                {activeTab === 'pending'
                  ? 'Pending Review Queue'
                  : activeTab === 'all'
                    ? 'All Partner Organizations'
                    : 'Active Partners'}
              </Text>
              <Text style={styles.directorySubtitle}>
                {activeTab === 'pending'
                  ? 'Review submitted partner registrations and project collaboration proposals.'
                  : activeTab === 'all'
                    ? 'Browse all partner organization records and their review statuses.'
                    : 'Browse verified organizations collaborating on projects.'}
              </Text>
            </View>
            <Text style={styles.directoryCount}>
              {activeTab === 'pending'
                ? `${(pendingFilter === 'proposals' ? 0 : filteredPartners.length) + (pendingFilter === 'registrations' ? 0 : filteredPendingProposals.length)} items`
                : `${filteredPartners.length} shown`}
            </Text>
          </View>

          <View style={styles.directoryTools}>
            <View style={styles.searchBox}>
              <MaterialIcons name="search" size={20} color="#84909f" />
              <TextInput
                value={searchTerm}
                onChangeText={setSearchTerm}
                placeholder={activeTab === 'pending' ? "Search applications & proposals..." : "Search partners..."}
                placeholderTextColor="#98a2b3"
                style={styles.searchInput}
              />
            </View>
            <TouchableOpacity style={styles.filterButton} onPress={nextSectorFilter}>
              <MaterialIcons name="filter-list" size={20} color="#475467" />
              <Text style={styles.filterText}>{sectorFilter === 'All' ? 'All types' : sectorFilter}</Text>
              <MaterialIcons name="keyboard-arrow-down" size={18} color="#667085" />
            </TouchableOpacity>
          </View>

          <View style={styles.partnerList}>
            {/* 1. Pending Project Proposals (if in pending tab and filter allows) */}
            {activeTab === 'pending' && pendingFilter !== 'registrations' && filteredPendingProposals.map(proposal => {
              const proposedTitle = proposal.proposalDetails?.proposedTitle || proposal.projectId;
              return (
                <View key={proposal.id} style={styles.proposalCard}>
                  <TouchableOpacity
                    style={styles.applicationCardHeader}
                    onPress={() => navigation.navigate('Messages', { projectId: proposal.projectId, proposalId: proposal.id })}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.applicationAvatar, { backgroundColor: '#e0e7ff' }]}>
                      <MaterialIcons name="description" size={24} color="#4338ca" />
                    </View>
                    <View style={styles.applicationHeaderCopy}>
                      <View style={styles.applicationTitleRow}>
                        <Text style={styles.applicationName}>{proposedTitle}</Text>
                        <View style={styles.proposalPill}>
                          <MaterialIcons name="auto-awesome" size={12} color="#4338ca" />
                          <Text style={styles.proposalPillText}>Project Proposal</Text>
                        </View>
                      </View>
                      <View style={styles.applicationMetaTags}>
                        <Text style={[styles.partnerCardSector, { backgroundColor: '#e0e7ff', color: '#3730a3' }]}>
                          {proposal.proposalDetails?.requestedProgramModule || 'Program Proposal'}
                        </Text>
                        <Text style={styles.applicationAppliedDate}>
                          Submitted {format(new Date(proposal.requestedAt), 'MMM d, yyyy')}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.applicationDetailsBox}>
                    <View style={styles.appDetailRow}>
                      <Text style={styles.appDetailLabel}>Partner Org:</Text>
                      <Text style={styles.appDetailValue}>{proposal.partnerName}</Text>
                    </View>
                    {proposal.partnerEmail ? (
                      <View style={styles.appDetailRow}>
                        <Text style={styles.appDetailLabel}>Email:</Text>
                        <Text style={styles.appDetailValue}>{proposal.partnerEmail}</Text>
                      </View>
                    ) : null}
                    {proposal.proposalDetails?.proposedLocation ? (
                      <View style={styles.appDetailRow}>
                        <Text style={styles.appDetailLabel}>Location:</Text>
                        <Text style={styles.appDetailValue}>{proposal.proposalDetails.proposedLocation}</Text>
                      </View>
                    ) : null}
                    {proposal.proposalDetails?.proposedVolunteersNeeded ? (
                      <View style={styles.appDetailRow}>
                        <Text style={styles.appDetailLabel}>Volunteers:</Text>
                        <Text style={styles.appDetailValue}>{proposal.proposalDetails.proposedVolunteersNeeded} needed</Text>
                      </View>
                    ) : null}
                  </View>

                  {proposal.proposalDetails?.proposedDescription ? (
                    <Text style={styles.applicationDescription} numberOfLines={2}>
                      {proposal.proposalDetails.proposedDescription}
                    </Text>
                  ) : null}

                  <View style={styles.applicationActionsRow}>
                    <TouchableOpacity
                      style={styles.appRejectButton}
                      onPress={() => openProposalReview(proposal, 'revision')}
                    >
                      <MaterialIcons name="replay" size={16} color="#dc2626" />
                      <Text style={styles.appRejectButtonText}>For Revise</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.appRejectButton, styles.appRejectButtonHard]}
                      onPress={() => handleRejectProposal(proposal)}
                    >
                      <MaterialIcons name="block" size={16} color="#b91c1c" />
                      <Text style={styles.appRejectButtonText}>Totally Reject</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.appApproveButton}
                      onPress={() => handleApproveProposal(proposal)}
                    >
                      <MaterialIcons name="check" size={16} color="#fff" />
                      <Text style={styles.appApproveButtonText}>Approve Proposal</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            {/* 2. Partner Registration Applications */}
            {(activeTab !== 'pending' || pendingFilter !== 'proposals') && filteredPartners.map(partner => {
              const projectCount = projects.filter(project => project.partnerId === partner.id).length;
              const isPending = partner.status === 'Pending';
              const isRejected = partner.status === 'Rejected';

              if (isPending) {
                return (
                  <View key={partner.id} style={styles.applicationCard}>
                    <View style={styles.applicationCardHeader}>
                      <View style={styles.applicationAvatar}>
                        <Text style={styles.applicationAvatarText}>{getPartnerInitials(partner.name)}</Text>
                      </View>
                      <View style={styles.applicationHeaderCopy}>
                        <View style={styles.applicationTitleRow}>
                          <Text style={styles.applicationName}>{partner.name}</Text>
                          <View style={styles.pendingPill}>
                            <MaterialIcons name="schedule" size={12} color="#b45309" />
                            <Text style={styles.pendingPillText}>Organization Registration</Text>
                          </View>
                        </View>
                        <View style={styles.applicationMetaTags}>
                          <Text style={styles.partnerCardSector}>{partner.sectorType}</Text>
                          <Text style={styles.applicationAppliedDate}>
                            Applied {format(new Date(partner.createdAt), 'MMM d, yyyy')}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.applicationDetailsBox}>
                      {partner.dswdAccreditationNo ? (
                        <View style={styles.appDetailRow}>
                          <Text style={styles.appDetailLabel}>DSWD Accr. No:</Text>
                          <Text style={styles.appDetailValue}>{partner.dswdAccreditationNo}</Text>
                        </View>
                      ) : null}
                      {partner.secRegistrationNo ? (
                        <View style={styles.appDetailRow}>
                          <Text style={styles.appDetailLabel}>SEC Reg. No:</Text>
                          <Text style={styles.appDetailValue}>{partner.secRegistrationNo}</Text>
                        </View>
                      ) : null}
                      {partner.contactEmail ? (
                        <View style={styles.appDetailRow}>
                          <Text style={styles.appDetailLabel}>Email:</Text>
                          <Text style={styles.appDetailValue}>{partner.contactEmail}</Text>
                        </View>
                      ) : null}
                      {partner.contactPhone ? (
                        <View style={styles.appDetailRow}>
                          <Text style={styles.appDetailLabel}>Phone:</Text>
                          <Text style={styles.appDetailValue}>{partner.contactPhone}</Text>
                        </View>
                      ) : null}
                      {partner.advocacyFocus && partner.advocacyFocus.length > 0 && (
                        <View style={styles.appFocusRow}>
                          <Text style={styles.appDetailLabel}>Advocacy:</Text>
                          <View style={styles.appFocusChips}>
                            {partner.advocacyFocus.map(focus => (
                              <View key={focus} style={styles.appFocusChip}>
                                <Text style={styles.appFocusChipText}>{focus}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>

                    {partner.description ? (
                      <Text style={styles.applicationDescription} numberOfLines={2}>
                        {partner.description}
                      </Text>
                    ) : null}

                    <View style={styles.applicationActionsRow}>
                      <TouchableOpacity
                        style={styles.appDetailsButton}
                        onPress={() => handleSelectPartner(partner)}
                      >
                        <MaterialIcons name="visibility" size={16} color="#475569" />
                        <Text style={styles.appDetailsButtonText}>View Full</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.appRejectButton}
                        onPress={() => openPartnerReview(partner, 'revision')}
                      >
                        <MaterialIcons name="replay" size={16} color="#dc2626" />
                        <Text style={styles.appRejectButtonText}>For Revise</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.appRejectButton, styles.appRejectButtonHard]}
                        onPress={() => openPartnerReview(partner, 'rejection')}
                      >
                        <MaterialIcons name="block" size={16} color="#b91c1c" />
                        <Text style={styles.appRejectButtonText}>Totally Reject</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.appApproveButton}
                        onPress={() => handleApprovePartner(partner)}
                      >
                        <MaterialIcons name="check" size={16} color="#fff" />
                        <Text style={styles.appApproveButtonText}>Approve Partner</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  key={partner.id}
                  style={styles.partnerCard}
                  onPress={() => handleSelectPartner(partner)}
                  activeOpacity={0.78}
                >
                  <View style={styles.partnerAvatar}>
                    <Text style={styles.partnerAvatarText}>{getPartnerInitials(partner.name)}</Text>
                  </View>
                  <View style={styles.partnerCardContent}>
                    <Text style={styles.partnerCardName}>{partner.name}</Text>
                    <View style={styles.partnerTags}>
                      <Text style={styles.partnerCardSector}>{partner.sectorType}</Text>
                      <Text style={styles.partnerFocus}>{partner.advocacyFocus.join(' · ') || partner.category}</Text>
                    </View>
                    <Text style={styles.partnerCardMeta}>
                      {projectCount} partnered project{projectCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.partnerStatusArea}>
                    {isRejected ? (
                      <View style={styles.rejectedPill}>
                        <Text style={styles.rejectedPillText}>Rejected</Text>
                      </View>
                    ) : (
                      <View style={styles.activePill}>
                        <View style={styles.activeDot} />
                        <Text style={styles.activePillText}>Active</Text>
                      </View>
                    )}
                    <Text style={styles.partnerDate}>
                      {isRejected
                        ? `Rejected ${getPartnerSince(partner)}`
                        : `Partner since ${getPartnerSince(partner)}`}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color="#667085" />
                </TouchableOpacity>
              );
            })}

            {!loadError &&
              filteredPartners.length === 0 &&
              (activeTab !== 'pending' || filteredPendingProposals.length === 0) ? (
              <View style={styles.emptyDirectory}>
                <MaterialIcons
                  name={activeTab === 'pending' ? "assignment-turned-in" : "search-off"}
                  size={36}
                  color="#98a2b3"
                />
                <Text style={styles.emptyText}>
                  {activeTab === 'pending'
                    ? "No pending applications or proposals. New registrations and project submissions will appear here."
                    : "No partners match this search."}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <Modal visible={Boolean(reviewTarget && reviewTargetType && reviewMode)} transparent animationType="fade" onRequestClose={closeReviewModal}>
        <View style={styles.reviewModalBackdrop}>
          <View style={styles.reviewModalCard}>
            <Text style={styles.reviewModalTitle}>
              {reviewMode === 'revision' ? 'Send Back For Revise' : 'Totally Reject'}
            </Text>
            <Text style={styles.reviewModalBody}>
              {reviewTargetType === 'partner'
                ? `This will mark "${(reviewTarget as Partner)?.name || ''}" as rejected.`
                : `This will mark "${(reviewTarget as PartnerProjectApplication)?.proposalDetails?.proposedTitle || (reviewTarget as PartnerProjectApplication)?.projectId || ''}" as rejected.`}
            </Text>
            <View style={styles.reviewModalActions}>
              <TouchableOpacity style={styles.reviewModalCancel} onPress={closeReviewModal}>
                <Text style={styles.reviewModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reviewModalConfirm, reviewMode === 'revision' && styles.reviewModalConfirmRevision]}
                onPress={confirmReviewAction}
              >
                <Text style={styles.reviewModalConfirmText}>
                  {reviewMode === 'revision' ? 'Send Back' : 'Reject Now'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f9f8',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: '#17212f',
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#dcfce7',
  },
  noticeBannerText: {
    flex: 1,
    color: '#14532d',
    fontSize: 13,
    fontWeight: '700',
  },
  pendingAlertBanner: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fef3c7',
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pendingAlertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  pendingAlertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400e',
  },
  pendingAlertSubtitle: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
  },
  pendingAlertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#b45309',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pendingAlertButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 20,
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
  detailPendingBanner: {
    margin: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  detailPendingCopy: {
    marginBottom: 14,
  },
  detailPendingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400e',
    marginTop: 6,
    marginBottom: 4,
  },
  detailPendingSubtitle: {
    fontSize: 12,
    color: '#b45309',
    lineHeight: 18,
  },
  detailPendingActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#fff',
    margin: 12,
    marginTop: 0,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5eaf0',
  },
  partnerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  partnerInfo: {
    flex: 1,
  },
  partnerName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  partnerSector: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 4,
  },
  partnerMeta: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5eaf0',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 20,
  },
  contactInfo: {
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    width: 80,
  },
  infoValue: {
    fontSize: 12,
    color: '#0f172a',
    flex: 1,
  },
  focusContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  focusTag: {
    backgroundColor: '#e0f2fe',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  focusTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0369a1',
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  projectCategory: {
    fontSize: 12,
    color: '#64748b',
  },
  projectMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  emptyTextProjects: {
    fontSize: 13,
    color: '#94a3b8',
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
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalCancel: {
    color: '#64748b',
    fontSize: 14,
  },
  modalSave: {
    color: '#15803d',
    fontSize: 14,
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
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 12,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  fieldLabel: {
    fontSize: 12,
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
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#667085',
  },
  headerAccent: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#eaf7ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  managementContent: {
    paddingHorizontal: 16,
    paddingBottom: 34,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 18,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: 160,
    minHeight: 100,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5eaf0',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryCardActive: {
    borderColor: '#166534',
    borderWidth: 1.5,
  },
  summaryCardHighlight: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffdfa',
  },
  summaryIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCopy: {
    flex: 1,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  summaryLabel: {
    marginTop: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#202939',
  },
  summaryNote: {
    marginTop: 3,
    fontSize: 11,
    color: '#7a8698',
  },
  tabContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabButtonActive: {
    backgroundColor: '#eaf7ed',
    borderColor: '#86efac',
  },
  tabButtonActivePending: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  tabButtonTextActive: {
    color: '#166534',
    fontWeight: '700',
  },
  tabButtonTextActivePending: {
    color: '#b45309',
    fontWeight: '700',
  },
  tabPendingBadge: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 2,
  },
  tabPendingBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  subFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  subFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  subFilterChipActive: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  subFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  subFilterChipTextActive: {
    color: '#92400e',
    fontWeight: '700',
  },
  directoryCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5eaf0',
    borderRadius: 16,
    overflow: 'hidden',
  },
  directoryHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  directoryTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1d2939',
    letterSpacing: -0.3,
  },
  directorySubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#667085',
  },
  directoryCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3b7f4a',
    backgroundColor: '#edf8ee',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  directoryTools: {
    borderTopWidth: 1,
    borderTopColor: '#edf0f2',
    padding: 12,
    flexDirection: 'row',
    gap: 10,
  },
  searchBox: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: '#dde3e8',
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 13,
    color: '#202939',
    outlineStyle: 'none' as any,
  },
  filterButton: {
    minWidth: 120,
    height: 42,
    borderWidth: 1,
    borderColor: '#dde3e8',
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  filterText: {
    flex: 1,
    fontSize: 13,
    color: '#475467',
    fontWeight: '600',
  },
  partnerList: {
    padding: 12,
    paddingTop: 4,
  },
  partnerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#edf0f2',
  },
  partnerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#eaf5ed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  partnerAvatarText: {
    color: '#237841',
    fontSize: 14,
    fontWeight: '700',
  },
  partnerCardContent: {
    flex: 1,
  },
  partnerCardName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202939',
  },
  partnerTags: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  partnerCardSector: {
    fontSize: 11,
    fontWeight: '700',
    color: '#397e4b',
    backgroundColor: '#eaf7ed',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  partnerFocus: {
    fontSize: 12,
    color: '#667085',
    flexShrink: 1,
  },
  partnerCardMeta: {
    fontSize: 11,
    color: '#7a8698',
    marginTop: 4,
  },
  partnerStatusArea: {
    alignItems: 'flex-end',
    marginRight: 10,
    gap: 4,
  },
  activePill: {
    backgroundColor: '#edf8ee',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#378a48',
  },
  activePillText: {
    color: '#28753c',
    fontSize: 11,
    fontWeight: '700',
  },
  rejectedPill: {
    backgroundColor: '#fee2e2',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  rejectedPillText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '700',
  },
  partnerDate: {
    fontSize: 11,
    color: '#7a8698',
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pendingPillText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '700',
  },
  proposalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e0e7ff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  proposalPillText: {
    color: '#4338ca',
    fontSize: 11,
    fontWeight: '700',
  },
  applicationCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  proposalCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  applicationCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  applicationAvatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#ffedd5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  applicationAvatarText: {
    color: '#ea580c',
    fontSize: 14,
    fontWeight: '700',
  },
  applicationHeaderCopy: {
    flex: 1,
  },
  applicationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  applicationName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    flex: 1,
  },
  applicationMetaTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  applicationAppliedDate: {
    fontSize: 11,
    color: '#64748b',
  },
  applicationDetailsBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    gap: 4,
    marginBottom: 10,
  },
  appDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appDetailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    width: 100,
  },
  appDetailValue: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1e293b',
    flex: 1,
  },
  appFocusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  appFocusChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  appFocusChip: {
    backgroundColor: '#e0e7ff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  appFocusChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3730a3',
  },
  applicationDescription: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 12,
  },
  applicationActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  appDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  appDetailsButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  appRejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  appRejectButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dc2626',
  },
  appRejectButtonHard: {
    borderColor: '#f87171',
    backgroundColor: '#fff1f2',
  },
  appApproveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#16a34a',
  },
  appApproveButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  emptyDirectory: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  reviewModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  reviewModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
  },
  reviewModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  reviewModalBody: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
  },
  reviewModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  reviewModalCancel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  reviewModalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  reviewModalConfirm: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#dc2626',
  },
  reviewModalConfirmRevision: {
    backgroundColor: '#b45309',
  },
  reviewModalConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});
