import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import ProjectTimelineCalendarCard from '../components/ProjectTimelineCalendarCard';
import { useAuth } from '../contexts/AuthContext';
import {
  getDashboardTimelineSnapshot,
  getPartnerDashboardSnapshot,
  submitPartnerProgramProposal,
  submitPartnerReport,
  subscribeToStorageChanges,
  buildProgramProposalProjectId,
} from '../models/storage';
import {
  AdminPlanningCalendar,
  AdminPlanningItem,
  AdvocacyFocus,
  Partner,
  PartnerProjectApplication,
  PartnerProjectProposalDetails,
  PartnerReport,
  PartnerReportType,
  Project,
} from '../models/types';
import { isImageMediaUri, pickImageFromDevice, pickDocumentFromDevice } from '../utils/media';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getProjectDisplayStatus as getDerivedProjectStatus } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

type ReportFormState = {
  projectId: string;
  reportType: PartnerReportType;
  description: string;
  impactCount: string;
  mediaFile: string;
};

type ProposalFormState = {
  requestedProgramModule: AdvocacyFocus;
  proposedTitle: string;
  proposedDescription: string;
  proposedStartDate: string;
  proposedEndDate: string;
  proposedLocation: string;
  proposedVolunteersNeeded: string;
  communityNeed: string;
  expectedDeliverables: string;
  photoAttachment: string;
  attachmentUrl: string;
};

function createEmptyReportForm(projectId = ''): ReportFormState {
  return {
    projectId,
    reportType: 'General',
    description: '',
    impactCount: '',
    mediaFile: '',
  };
}

function createEmptyProposalForm(module: AdvocacyFocus): ProposalFormState {
  return {
    requestedProgramModule: module,
    proposedTitle: '',
    proposedDescription: '',
    proposedStartDate: '',
    proposedEndDate: '',
    proposedLocation: '',
    proposedVolunteersNeeded: '',
    communityNeed: '',
    expectedDeliverables: '',
    photoAttachment: '',
    attachmentUrl: '',
  };
}

function getDisplayProjectStatus(project: Project): 'Planned' | 'Active' | 'Completed' | 'Cancelled' {
  switch (getDerivedProjectStatus(project)) {
    case 'Planning':
      return 'Planned';
    case 'Completed':
      return 'Completed';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Active';
  }
}

const REPORT_TYPE_OPTIONS: PartnerReportType[] = ['General', 'Medical', 'Logistics'];
const FEATURED_PROGRAM_MODULES: AdvocacyFocus[] = ['Nutrition', 'Education', 'Livelihood'];

function getProjectStatusColor(status: ReturnType<typeof getDisplayProjectStatus>) {
  switch (status) {
    case 'Planned':
      return '#2563eb';
    case 'Completed':
      return '#16a34a';
    case 'Cancelled':
      return '#dc2626';
    default:
      return '#0f766e';
  }
}

function getProgramModuleColor(module: AdvocacyFocus): string {
  switch (module) {
    case 'Nutrition':
      return '#dc2626';
    case 'Education':
      return '#2563eb';
    case 'Livelihood':
      return '#7c3aed';
    case 'Disaster':
      return '#ea580c';
    default:
      return '#64748b';
  }
}

function getProgramModuleDescription(module: AdvocacyFocus): string {
  switch (module) {
    case 'Nutrition':
      return 'Food security and health programs';
    case 'Education':
      return 'Learning and skill development programs';
    case 'Livelihood':
      return 'Economic empowerment programs';
    case 'Disaster':
      return 'Emergency relief programs';
    default:
      return 'Community program';
  }
}

// Shows the partner workspace for program proposals and report uploads.
export default function PartnerDashboardScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [partnerReports, setPartnerReports] = useState<PartnerReport[]>([]);
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState<ReportFormState>(createEmptyReportForm());
  const [proposalForm, setProposalForm] = useState<ProposalFormState>(createEmptyProposalForm(FEATURED_PROGRAM_MODULES[0]));
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [activeProposalModule, setActiveProposalModule] = useState<AdvocacyFocus | null>(null);
  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);
  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);

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

  const loadDashboardData = React.useCallback(async () => {
    try {
      if (!user?.id) {
        return;
      }

      const [snapshot, timelineSnapshot] = await Promise.all([
        getPartnerDashboardSnapshot(),
        getDashboardTimelineSnapshot(),
      ]);
      const ownedPartners = snapshot.partners.filter(isOwnedByCurrentPartner);
      setPartners(ownedPartners);
      setProjects(snapshot.projects);
      setPartnerApplications(
        snapshot.partnerApplications
          .filter(application => application.partnerUserId === user.id)
          .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      );
      setPartnerReports(
        snapshot.partnerReports
          .filter(
            report =>
              report.submitterUserId === user.id ||
              report.partnerUserId === user.id
          )
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setPlanningCalendars(timelineSnapshot.planningCalendars);
      setPlanningItems(timelineSnapshot.planningItems);
      setLoadError(null);

      setReportForm(current =>
        current.projectId ? current : createEmptyReportForm()
      );
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load the partner dashboard.'),
      });
    } finally {
      setLoading(false);
    }
  }, [isOwnedByCurrentPartner, user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      void loadDashboardData();
      return subscribeToStorageChanges(
        [
          'partners',
          'projects',
          'partnerProjectApplications',
          'partnerReports',
          'adminPlanningCalendars',
        ],
        () => {
          void loadDashboardData();
        }
      );
    }, [loadDashboardData])
  );

  const approvedPartner = useMemo(
    () => partners.find(partner => partner.status === 'Approved') || null,
    [partners]
  );

  const applicationByProjectId = useMemo(
    () => new Map(partnerApplications.map(application => [application.projectId, application])),
    [partnerApplications]
  );

  const programApplicationByModule = useMemo(() => {
    const byModule = new Map<string, PartnerProjectApplication>();
    partnerApplications.forEach(application => {
      const programModule = application.projectId.startsWith('program:')
        ? application.projectId.slice('program:'.length).trim()
        : application.proposalDetails?.requestedProgramModule || '';
      if (programModule) {
        byModule.set(programModule, application);
      }
    });
    return byModule;
  }, [partnerApplications]);

  const attendingProjects = useMemo(
    () =>
      projects.filter(project => {
        const application = applicationByProjectId.get(project.id);
        return application?.status === 'Approved';
      }),
    [applicationByProjectId, projects, user?.id]
  );

  const activeProjects = useMemo(
    () => projects.filter(project => getDisplayProjectStatus(project) !== 'Cancelled'),
    [projects]
  );
  const timelineProjectIds = useMemo(
    () => (attendingProjects.length ? attendingProjects.map(project => project.id) : undefined),
    [attendingProjects]
  );

  const openReportForm = (projectId: string) => {
    setReportForm(current =>
      current.projectId === projectId ? current : createEmptyReportForm(projectId)
    );
  };

  const closeReportForm = () => {
    setReportForm(createEmptyReportForm());
  };

  const updateReportFormForProject = (
    projectId: string,
    updates: Partial<Omit<ReportFormState, 'projectId'>>
  ) => {
    setReportForm(current => ({
      ...(current.projectId === projectId ? current : createEmptyReportForm(projectId)),
      projectId,
      ...updates,
    }));
  };

  const openProposalForm = (module: AdvocacyFocus) => {
    setActiveProposalModule(module);
    setProposalForm(current =>
      current.requestedProgramModule === module ? current : createEmptyProposalForm(module)
    );
    setShowProposalModal(true);
  };

  const closeProposalForm = () => {
    setShowProposalModal(false);
    setActiveProposalModule(null);
  };

  const updateProposalForm = (updates: Partial<Omit<ProposalFormState, 'requestedProgramModule'>>) => {
    setProposalForm(current => ({
      ...current,
      ...updates,
    }));
  };

  const handlePickProposalPhoto = async () => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }
      updateProposalForm({ photoAttachment: pickedImage });
    } catch (error: any) {
      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');
    }
  };

  const handleRemoveProposalPhoto = () => {
    updateProposalForm({ photoAttachment: '' });
  };

  const handlePickProposalDocument = async () => {
    try {
      const pickedDocument = await pickDocumentFromDevice();
      if (!pickedDocument) {
        return;
      }
      updateProposalForm({ attachmentUrl: pickedDocument });
    } catch (error: any) {
      const errorMessage = error?.message || 'Unable to access your file library. Please check app permissions in settings.';
      Alert.alert('Permission Required', errorMessage);
    }
  };

  const handleRemoveProposalDocument = () => {
    updateProposalForm({ attachmentUrl: '' });
  };

  const handleSubmitProgramProposal = async () => {
    if (!user || !activeProposalModule) {
      return;
    }

    const proposalProjectId = buildProgramProposalProjectId(activeProposalModule);
    const volunteersNeeded = Number(proposalForm.proposedVolunteersNeeded);
    const proposalDetails: PartnerProjectProposalDetails = {
      requestedProgramModule: activeProposalModule,
      proposedTitle: proposalForm.proposedTitle.trim(),
      proposedDescription: proposalForm.proposedDescription.trim(),
      proposedStartDate: proposalForm.proposedStartDate.trim(),
      proposedEndDate: proposalForm.proposedEndDate.trim(),
      proposedLocation: proposalForm.proposedLocation.trim(),
      proposedVolunteersNeeded: Number.isNaN(volunteersNeeded) ? 0 : volunteersNeeded,
      communityNeed: proposalForm.communityNeed.trim(),
      expectedDeliverables: proposalForm.expectedDeliverables.trim(),
      targetProjectId: undefined,
      targetProjectTitle: undefined,
      targetProjectDescription: undefined,
      targetProjectAddress: undefined,
      skillsNeeded: [],
      attachments: [
        ...(proposalForm.photoAttachment
          ? [{ url: proposalForm.photoAttachment, type: 'image' as const }]
          : []),
        ...(proposalForm.attachmentUrl.trim()
          ? [{ url: proposalForm.attachmentUrl.trim(), type: 'document' as const }]
          : []),
      ],
    };

    // Comprehensive validation for all required proposal details
    if (!proposalDetails.proposedTitle || !proposalDetails.proposedTitle.trim()) {
      Alert.alert('Missing Information', 'Please enter the proposal title.');
      return;
    }

    if (!proposalDetails.proposedDescription || !proposalDetails.proposedDescription.trim()) {
      Alert.alert('Missing Information', 'Please enter the proposal description.');
      return;
    }

    if (!proposalDetails.proposedStartDate || !proposalDetails.proposedStartDate.trim()) {
      Alert.alert('Missing Information', 'Please enter the start date (YYYY-MM-DD format).');
      return;
    }

    if (!proposalDetails.proposedEndDate || !proposalDetails.proposedEndDate.trim()) {
      Alert.alert('Missing Information', 'Please enter the end date (YYYY-MM-DD format).');
      return;
    }

    if (!proposalDetails.proposedLocation || !proposalDetails.proposedLocation.trim()) {
      Alert.alert('Missing Information', 'Please enter the project location.');
      return;
    }

    if (proposalDetails.proposedVolunteersNeeded <= 0) {
      Alert.alert('Missing Information', 'Please enter the number of volunteers needed (must be greater than 0).');
      return;
    }

    if (!proposalDetails.communityNeed || !proposalDetails.communityNeed.trim()) {
      Alert.alert('Missing Information', 'Please describe the community need.');
      return;
    }

    if (!proposalDetails.expectedDeliverables || !proposalDetails.expectedDeliverables.trim()) {
      Alert.alert('Missing Information', 'Please describe the expected deliverables.');
      return;
    }

    try {
      setActionProjectId(proposalProjectId);
      await submitPartnerProgramProposal(proposalProjectId, user, {
        programModule: activeProposalModule,
        proposalDetails,
      });
      setShowProposalModal(false);
      Alert.alert('Proposal Sent', 'Your proposal has been sent to the admin for review.');
      void loadDashboardData();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to send the program proposal.')
      );
    } finally {
      setActionProjectId(null);
      setActiveProposalModule(null);
    }
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined' ? window.confirm('Are you sure you want to logout?') : true;
      if (confirmed) {
        await logout();
      }
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel' },
      { text: 'Logout', onPress: async () => await logout() },
    ]);
  };

  const handleUploadReport = async (projectId: string) => {
    if (!user || !approvedPartner) {
      Alert.alert('Approval Required', 'You need an approved project proposal before uploading a report.');
      return;
    }

    const targetProject = attendingProjects.find(project => project.id === projectId);
    if (!targetProject) {
      Alert.alert('Validation Error', 'Join the event first before submitting a report.');
      return;
    }

    const activeReportForm =
      reportForm.projectId === projectId ? reportForm : createEmptyReportForm(projectId);

    if (!activeReportForm.description.trim() || !activeReportForm.impactCount.trim()) {
      Alert.alert('Validation Error', 'Complete the report details for this event.');
      return;
    }

    const impactCount = Number(activeReportForm.impactCount);
    if (Number.isNaN(impactCount) || impactCount <= 0) {
      Alert.alert('Validation Error', 'Impact count must be a positive number.');
      return;
    }

    try {
      await submitPartnerReport({
        projectId,
        partnerId: approvedPartner.id,
        partnerUserId: user.id,
        partnerName: approvedPartner.name,
        reportType: activeReportForm.reportType,
        description: activeReportForm.description,
        impactCount,
        mediaFile: activeReportForm.mediaFile,
      });
      setReportForm(createEmptyReportForm(projectId));
      Alert.alert('Uploaded', 'Your report was submitted to the admin impact hub.');
      void loadDashboardData();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, 'Upload Failed'),
        getRequestErrorMessage(error, 'Unable to upload the report.')
      );
    }
  };

  const handlePickReportImage = async (projectId: string) => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }

      updateReportFormForProject(projectId, { mediaFile: pickedImage });
    } catch (error: any) {
      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');
    }
  };

  const handleRemoveReportImage = (projectId: string) => {
    updateReportFormForProject(projectId, { mediaFile: '' });
  };

  if (loading && projects.length === 0 && partners.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingCard}>
          <MaterialIcons name="event-note" size={34} color="#166534" />
          <Text style={styles.loadingTitle}>Preparing partner workspace</Text>
          <Text style={styles.loadingText}>Loading your project requests, reports, and timeline.</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'P'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Welcome, {user?.name}</Text>
          <Text style={styles.role}>Partner Dashboard</Text>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <MaterialIcons name="logout" size={22} color="#475569" />
        </TouchableOpacity>
      </View>

      {loadError ? (
        <InlineLoadError
          title={loadError.title}
          message={loadError.message}
          onRetry={() => void loadDashboardData()}
        />
      ) : null}

      <ProjectTimelineCalendarCard
        title="Partner Project Calendar"
        subtitle={
          timelineProjectIds?.length
            ? 'Your approved project proposals are aligned with the admin planning calendar.'
            : 'Review the shared project schedule and admin planning dates in one timeline.'
        }
        projects={projects}
        planningCalendars={planningCalendars}
        planningItems={planningItems}
        projectFilterIds={timelineProjectIds}
        accentColor="#166534"
        emptyText="No partner timeline items yet."
        onOpenProject={projectId =>
          navigateToAvailableRoute(navigation, 'Programs', {
            projectId,
          })
        }
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Registration Status</Text>
        {partners.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>No organization application found yet.</Text>
          </View>
        ) : (
          partners.map(partner => (
            <View key={partner.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{partner.name}</Text>
                  <Text style={styles.cardMeta}>
                    {partner.sectorType} • DSWD {partner.dswdAccreditationNo || 'Pending'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getProjectStatusColor(partner.status === 'Approved' ? 'Completed' : 'Active') },
                  ]}
                >
                  <Text style={styles.statusBadgeText}>{partner.status}</Text>
                </View>
              </View>
              <Text style={styles.cardText}>
                Verification: {partner.verificationStatus || 'Pending'}{partner.credentialsUnlockedAt ? ' • Login unlocked' : ' • Login locked'}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Browse Programs</Text>
        <Text style={styles.sectionSubtitle}>
          Select a program to view its projects or submit a proposal.
        </Text>
        {FEATURED_PROGRAM_MODULES.map(module => {
          const application = programApplicationByModule.get(module);
          const status = application?.status;
          const isApproved = status === 'Approved';
          const isPending = status === 'Pending';
          const isRejected = status === 'Rejected';
          const proposalProjectId = buildProgramProposalProjectId(module);
          const buttonLabel = isApproved
            ? 'Proposal Approved'
            : isPending
            ? 'Proposal Pending'
            : isRejected
            ? 'Submit Again'
            : 'Submit Project Proposal';

          return (
            <TouchableOpacity 
              key={module} 
              style={[styles.card, styles.programCard, { borderColor: getProgramModuleColor(module) }]}
              onPress={() => navigateToAvailableRoute(navigation, 'Programs', { programModule: module })}
            > 
              <View style={styles.programCardHeader}>
                <View style={[styles.programIcon, { backgroundColor: getProgramModuleColor(module) }]}> 
                  <MaterialIcons name={module === 'Nutrition' ? 'restaurant' : module === 'Education' ? 'school' : 'work'} size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{module}</Text>
                  <Text style={styles.cardMeta}>{getProgramModuleDescription(module)}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getProgramModuleColor(module) }]}> 
                  <Text style={styles.statusBadgeText}>{isApproved ? 'Approved' : isPending ? 'Pending' : 'Open'}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.primaryButton, isApproved && styles.secondaryButton, isPending && styles.timeButtonDisabled]}
                onPress={() => openProposalForm(module)}
                disabled={actionProjectId === proposalProjectId || isApproved || isPending}
              >
                <Text style={[styles.primaryButtonText, isApproved && styles.secondaryButtonText]}>
                  {actionProjectId === proposalProjectId ? 'Sending...' : buttonLabel}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Field Activity History</Text>
        {partnerReports.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>No partner reports submitted yet. Approved projects will show submitted reports here.</Text>
          </View>
        ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Submitted Reports</Text>
                {partnerReports.slice(0, 5).map(report => {
                  const linkedProject = projects.find(project => project.id === report.projectId);
                  return (
                    <View key={report.id} style={styles.historyItem}>
                      <Text style={styles.historyTitle}>
                        {report.title || linkedProject?.title || 'Project report'}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {report.reportType} • {report.status} • {new Date(report.createdAt).toLocaleDateString()}
                      </Text>
                      {report.reviewNotes ? (
                        <Text style={styles.historyNotes}>Admin notes: {report.reviewNotes}</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
        )}
      </View>

      <Modal
        visible={showProposalModal}
        animationType="slide"
        transparent
        onRequestClose={closeProposalForm}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Submit Program Proposal</Text>
                <TouchableOpacity onPress={closeProposalForm} style={styles.modalCloseButton}>
                  <MaterialIcons name="close" size={20} color="#475569" />
                </TouchableOpacity>
              </View>
              <Text style={styles.fieldLabel}>Proposal Title</Text>
              <TextInput
                style={styles.input}
                value={proposalForm.proposedTitle}
                onChangeText={value => updateProposalForm({ proposedTitle: value })}
                placeholder="Short proposal title"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.fieldLabel}>Proposal Description</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={proposalForm.proposedDescription}
                onChangeText={value => updateProposalForm({ proposedDescription: value })}
                placeholder="What will this project deliver?"
                placeholderTextColor="#94a3b8"
                multiline
              />
              <Text style={styles.fieldLabel}>Start / End Date</Text>
              <View style={styles.dateRow}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  value={proposalForm.proposedStartDate}
                  onChangeText={value => updateProposalForm({ proposedStartDate: value })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94a3b8"
                />
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  value={proposalForm.proposedEndDate}
                  onChangeText={value => updateProposalForm({ proposedEndDate: value })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94a3b8"
                />
              </View>
              <Text style={styles.fieldLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={proposalForm.proposedLocation}
                onChangeText={value => updateProposalForm({ proposedLocation: value })}
                placeholder="Address or barangay"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.fieldLabel}>Volunteers Needed</Text>
              <TextInput
                style={styles.input}
                value={proposalForm.proposedVolunteersNeeded}
                onChangeText={value => updateProposalForm({ proposedVolunteersNeeded: value.replace(/[^0-9]/g, '') })}
                placeholder="Number of volunteers"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
              />
              <Text style={styles.fieldLabel}>Community Need</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={proposalForm.communityNeed}
                onChangeText={value => updateProposalForm({ communityNeed: value })}
                placeholder="Describe the community need"
                placeholderTextColor="#94a3b8"
                multiline
              />
              <Text style={styles.fieldLabel}>Expected Deliverables</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={proposalForm.expectedDeliverables}
                onChangeText={value => updateProposalForm({ expectedDeliverables: value })}
                placeholder="What will the project deliver?"
                placeholderTextColor="#94a3b8"
                multiline
              />
              <Text style={styles.fieldLabel}>Document Attachment</Text>
              {proposalForm.attachmentUrl ? (
                <View style={styles.photoPreviewCard}>
                  <View style={styles.documentPreview}>
                    <MaterialIcons name="description" size={24} color="#166534" />
                  </View>
                  <View style={styles.photoPreviewMeta}>
                    <Text style={styles.photoPreviewLabel}>Document attached</Text>
                    <TouchableOpacity onPress={handleRemoveProposalDocument}>
                      <Text style={styles.photoRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoPickerButton} onPress={handlePickProposalDocument}>
                  <MaterialIcons name="attach-file" size={18} color="#166534" />
                  <Text style={styles.photoPickerButtonText}>Add document attachment</Text>
                </TouchableOpacity>
              )}
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Photo Attachment</Text>
              {proposalForm.photoAttachment ? (
                <View style={styles.photoPreviewCard}>
                  <Image source={{ uri: proposalForm.photoAttachment }} style={styles.photoPreview} />
                  <View style={styles.photoPreviewMeta}>
                    <Text style={styles.photoPreviewLabel}>Selected photo attachment</Text>
                    <TouchableOpacity onPress={handleRemoveProposalPhoto}>
                      <Text style={styles.photoRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoPickerButton} onPress={handlePickProposalPhoto}>
                  <MaterialIcons name="photo" size={18} color="#166534" />
                  <Text style={styles.photoPickerButtonText}>Add project photo</Text>
                </TouchableOpacity>
              )}
              <View style={styles.modalActionRow}>
                <TouchableOpacity style={[styles.primaryButton, styles.modalCancelButton]} onPress={closeProposalForm}>
                  <Text style={[styles.primaryButtonText, styles.modalCancelText]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={handleSubmitProgramProposal}>
                  <Text style={styles.primaryButtonText}>Send Proposal</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    padding: 24,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    gap: 10,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  loadingText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 18,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  greeting: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  role: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  section: {
    marginTop: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  programCard: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  programCardHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  programIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeButtonDisabled: {
    opacity: 0.6,
  },
  projectCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  cardText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#dcfce7',
  },
  secondaryButtonText: {
    color: '#166534',
  },
  inlineReportCard: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    backgroundColor: '#f8fafc',
  },
  inlineReportHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  inlineReportTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  inlineReportMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  inlineReportToggle: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
  },
  inlineReportToggleText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  inlineReportForm: {
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  selectorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  selectorChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  selectorChipActive: {
    backgroundColor: '#166534',
  },
  selectorChipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  selectorChipTextActive: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#0f172a',
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  photoPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingVertical: 12,
  },
  photoPickerButtonText: {
    color: '#166534',
    fontWeight: '700',
  },
  photoPreviewCard: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  photoPreview: {
    width: '100%',
    height: 180,
    backgroundColor: '#e2e8f0',
  },
  documentPreview: {
    width: '100%',
    height: 100,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#dbe2ea',
  },
  photoPreviewMeta: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  photoPreviewLabel: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  photoRemoveText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalContent: {
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalCloseButton: {
    padding: 6,
  },
  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
  },
  modalCancelButton: {
    backgroundColor: '#f8fafc',
  },
  modalCancelText: {
    color: '#475569',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateInput: {
    flex: 1,
  },
  historyItem: {
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  historyMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  historyNotes: {
    marginTop: 6,
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
});
