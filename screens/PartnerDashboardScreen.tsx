import React, { useEffect, useMemo, useState } from 'react';
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
import { Picker } from '@react-native-picker/picker';
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
  getProgramModuleFromProposalProjectId,
} from '../models/storage';
import {
  AdminPlanningCalendar,
  AdminPlanningItem,
  AdvocacyFocus,
  Partner,
  PartnerProjectApplication,
  PartnerProjectProposalDetails,
  PartnerReportType,
  Project,
} from '../models/types';
import { isImageMediaUri, pickImageFromDevice, pickDocumentFromDevice } from '../utils/media';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getProjectDisplayStatus as getDerivedProjectStatus } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import {
  DEFAULT_VOLUNTEER_SKILL_OPTIONS,
  TASK_SKILL_OPTIONS,
  mergeSkillOptions,
} from '../utils/skills';
import {
  getBarangaysByCity,
  getCitiesByRegion,
  PHRegions,
  type PHBarangay,
  type PHCityMunicipality,
} from '../utils/philippineAddressData';

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
  skillsNeeded: string[];
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
    skillsNeeded: [],
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
const FEATURED_PROGRAM_MODULES: AdvocacyFocus[] = ['Nutrition', 'Education', 'Livelihood', 'Disaster'];

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

function LazyDateTimePicker(props: any) {
  if (Platform.OS === 'web') {
    return (
      <View style={{ marginTop: 10 }}>
        <input
          type="date"
          value={props.value instanceof Date ? props.value.toISOString().split('T')[0] : ''}
          min={props.minimumDate instanceof Date ? props.minimumDate.toISOString().split('T')[0] : undefined}
          max={props.maximumDate instanceof Date ? props.maximumDate.toISOString().split('T')[0] : undefined}
          onChange={event => {
            if (props.onChange) {
              props.onChange({ type: 'set' }, new Date(event.target.value));
            }
          }}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '10px',
            border: '1px solid #dbe2ea',
            fontSize: '14px',
            fontFamily: 'inherit',
            color: '#0f172a',
            backgroundColor: '#fff',
            cursor: 'pointer',
          }}
        />
      </View>
    );
  }

  const DateTimePickerComponent = require('@react-native-community/datetimepicker').default;
  return <DateTimePickerComponent {...props} />;
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }

  const parsedDate = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

// Shows the partner workspace for program proposals and report uploads.
export default function PartnerDashboardScreen({ navigation, route }: any) {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState<ReportFormState>(createEmptyReportForm());
  const [proposalForm, setProposalForm] = useState<ProposalFormState>(createEmptyProposalForm(FEATURED_PROGRAM_MODULES[0]));
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [activeProposalModule, setActiveProposalModule] = useState<AdvocacyFocus | null>(null);
  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);
  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);
  const [availableProposalSkills, setAvailableProposalSkills] = useState<string[]>(
    mergeSkillOptions(TASK_SKILL_OPTIONS, DEFAULT_VOLUNTEER_SKILL_OPTIONS)
  );
  const [selectedProposalSkillOption, setSelectedProposalSkillOption] = useState('');
  const [customProposalSkill, setCustomProposalSkill] = useState('');
  const [selectedRegionCode, setSelectedRegionCode] = useState('');
  const [selectedCityCode, setSelectedCityCode] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState('');
  const [filteredCities, setFilteredCities] = useState<PHCityMunicipality[]>([]);
  const [filteredBarangays, setFilteredBarangays] = useState<PHBarangay[]>([]);
  const [showProposalDatePicker, setShowProposalDatePicker] = useState(false);
  const [proposalDatePickerMode, setProposalDatePickerMode] = useState<'startDate' | 'endDate'>('startDate');
  const [selectedProposalDate, setSelectedProposalDate] = useState(new Date());

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
      const programModule =
        getProgramModuleFromProposalProjectId(application.projectId) ||
        application.proposalDetails?.requestedProgramModule ||
        '';
      if (programModule) {
        const existing = byModule.get(programModule);
        if (
          !existing ||
          new Date(application.requestedAt).getTime() > new Date(existing.requestedAt).getTime()
        ) {
          byModule.set(programModule, application);
        }
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

  const trackedProjects = useMemo(
    () =>
      [...attendingProjects].sort(
        (left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
      ),
    [attendingProjects]
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
    setSelectedProposalSkillOption('');
    setCustomProposalSkill('');
    setSelectedRegionCode('');
    setSelectedCityCode('');
    setSelectedBarangay('');
    setFilteredCities([]);
    setFilteredBarangays([]);
    setShowProposalDatePicker(false);
    setProposalDatePickerMode('startDate');
    setSelectedProposalDate(new Date());
    setShowProposalModal(true);
  };

  useEffect(() => {
    const requestedModule = route?.params?.openProposalModule;
    if (!requestedModule || !FEATURED_PROGRAM_MODULES.includes(requestedModule)) {
      return;
    }

    openProposalForm(requestedModule as AdvocacyFocus);
    navigation.setParams({ openProposalModule: undefined });
  }, [navigation, route?.params?.openProposalModule]);

  const closeProposalForm = () => {
    setShowProposalModal(false);
    setActiveProposalModule(null);
    setSelectedProposalSkillOption('');
    setCustomProposalSkill('');
    setSelectedRegionCode('');
    setSelectedCityCode('');
    setSelectedBarangay('');
    setFilteredCities([]);
    setFilteredBarangays([]);
    setShowProposalDatePicker(false);
    setProposalDatePickerMode('startDate');
  };

  const updateProposalForm = (updates: Partial<ProposalFormState>) => {
    setProposalForm(current => ({
      ...current,
      ...updates,
    }));
  };

  useEffect(() => {
    if (!showProposalModal) {
      return;
    }

    const regionName = PHRegions.find(region => region.code === selectedRegionCode)?.name || '';
    const cityName =
      filteredCities.find(city => city.code === selectedCityCode)?.displayName ||
      filteredCities.find(city => city.code === selectedCityCode)?.name ||
      '';
    const barangayName =
      filteredBarangays.find(barangay => barangay.code === selectedBarangay)?.displayName ||
      filteredBarangays.find(barangay => barangay.code === selectedBarangay)?.name ||
      '';
    const nextLocation = [barangayName, cityName, regionName].filter(Boolean).join(', ');

    if (!nextLocation) {
      return;
    }

    setProposalForm(current =>
      current.proposedLocation === nextLocation
        ? current
        : {
            ...current,
            proposedLocation: nextLocation,
          }
    );
  }, [
    filteredBarangays,
    filteredCities,
    selectedBarangay,
    selectedCityCode,
    selectedRegionCode,
    showProposalModal,
  ]);

  const handleSelectProposalRegion = (regionCode: string) => {
    setSelectedRegionCode(regionCode);
    setSelectedCityCode('');
    setSelectedBarangay('');
    setFilteredCities(regionCode ? getCitiesByRegion(regionCode) : []);
    setFilteredBarangays([]);
    updateProposalForm({ proposedLocation: '' });
  };

  const handleSelectProposalCity = (cityCode: string) => {
    setSelectedCityCode(cityCode);
    setSelectedBarangay('');
    setFilteredBarangays(cityCode ? getBarangaysByCity(cityCode) : []);
    updateProposalForm({ proposedLocation: '' });
  };

  const handleAddSelectedProposalSkill = () => {
    const normalizedSkill = selectedProposalSkillOption.trim();
    if (!normalizedSkill) {
      return;
    }

    setProposalForm(current => ({
      ...current,
      skillsNeeded: mergeSkillOptions(current.skillsNeeded, [normalizedSkill]),
    }));
    setSelectedProposalSkillOption('');
  };

  const handleRemoveProposalSkill = (skill: string) => {
    setProposalForm(current => ({
      ...current,
      skillsNeeded: current.skillsNeeded.filter(existingSkill => existingSkill !== skill),
    }));
  };

  const handleAddCustomProposalSkill = () => {
    const normalizedSkill = customProposalSkill.trim();
    if (!normalizedSkill) {
      return;
    }

    setAvailableProposalSkills(current => mergeSkillOptions(current, [normalizedSkill]));
    setProposalForm(current => ({
      ...current,
      skillsNeeded: mergeSkillOptions(current.skillsNeeded, [normalizedSkill]),
    }));
    setCustomProposalSkill('');
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

  const openProposalDatePicker = (mode: 'startDate' | 'endDate') => {
    const currentValue =
      mode === 'startDate' ? proposalForm.proposedStartDate : proposalForm.proposedEndDate;
    const parsedDate = parseDateValue(currentValue);

    setProposalDatePickerMode(mode);
    setSelectedProposalDate(parsedDate || new Date());
    setShowProposalDatePicker(true);
  };

  const handleProposalDateChange = (_event: unknown, date?: Date) => {
    if (Platform.OS !== 'ios') {
      setShowProposalDatePicker(false);
    }

    if (!date) {
      return;
    }

    const formattedDate = formatDateValue(date);
    setSelectedProposalDate(date);

    if (proposalDatePickerMode === 'startDate') {
      updateProposalForm({ proposedStartDate: formattedDate });
      return;
    }

    updateProposalForm({ proposedEndDate: formattedDate });
  };

  const handleSubmitProgramProposal = async () => {
    if (!user) {
      return;
    }

    const selectedModule = proposalForm.requestedProgramModule;
    const proposalProjectId = buildProgramProposalProjectId(selectedModule);
    const volunteersNeeded = Number(proposalForm.proposedVolunteersNeeded);
    const proposalDetails: PartnerProjectProposalDetails = {
      requestedProgramModule: selectedModule,
      proposedTitle: proposalForm.proposedTitle.trim(),
      proposedDescription: proposalForm.proposedDescription.trim(),
      proposedStartDate: proposalForm.proposedStartDate.trim(),
      proposedEndDate: proposalForm.proposedEndDate.trim(),
      proposedLocation: proposalForm.proposedLocation.trim(),
      proposedVolunteersNeeded: Number.isNaN(volunteersNeeded) ? 0 : volunteersNeeded,
      skillsNeeded: proposalForm.skillsNeeded,
      communityNeed: proposalForm.communityNeed.trim(),
      expectedDeliverables: proposalForm.expectedDeliverables.trim(),
      targetProjectId: undefined,
      targetProjectTitle: undefined,
      targetProjectDescription: undefined,
      targetProjectAddress: undefined,
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
        programModule: selectedModule,
        proposalDetails,
      });
      setShowProposalModal(false);
      Alert.alert('Proposal Sent', 'Your project proposal has been sent to the admin for review.');
      void loadDashboardData();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to send the project proposal.')
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
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={styles.sectionTitle}>Approved Proposal Projects</Text>
            <Text style={styles.sectionSubtitle}>
              Track the live status of projects that were approved from your proposals.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.secondaryActionButton}
            onPress={() => navigateToAvailableRoute(navigation, 'Projects')}
          >
            <Text style={styles.secondaryActionButtonText}>My Projects</Text>
          </TouchableOpacity>
        </View>
        {trackedProjects.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>No approved proposal projects to track yet.</Text>
          </View>
        ) : (
          trackedProjects.map(project => (
            <TouchableOpacity
              key={project.id}
              style={styles.card}
              activeOpacity={0.86}
              onPress={() =>
                navigateToAvailableRoute(navigation, 'Projects', {
                  projectId: project.id,
                })
              }
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{project.title}</Text>
                  <Text style={styles.cardMeta}>
                    {(project.programModule || project.category)} â€¢ {getDisplayProjectStatus(project)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getProjectStatusColor(getDisplayProjectStatus(project)) },
                  ]}
                >
                  <Text style={styles.statusBadgeText}>{getDisplayProjectStatus(project)}</Text>
                </View>
              </View>
              <Text style={styles.cardText}>{project.location?.address || 'Location to be finalized'}</Text>
              <Text style={styles.cardText}>
                {new Date(project.startDate).toLocaleDateString()} - {new Date(project.endDate).toLocaleDateString()}
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() =>
                  navigateToAvailableRoute(navigation, 'Projects', {
                    projectId: project.id,
                  })
                }
              >
                <Text style={styles.primaryButtonText}>Track Project</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </View>

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
                    {partner.sectorType} â€¢ DSWD {partner.dswdAccreditationNo || 'Pending'}
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
                Verification: {partner.verificationStatus || 'Pending'}{partner.credentialsUnlockedAt ? ' â€¢ Login unlocked' : ' â€¢ Login locked'}
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
          const buttonLabel = application ? 'Submit Another Proposal' : 'Submit Project Proposal';

          return (
            <View
              key={module}
              style={[styles.card, styles.programCard, { borderColor: getProgramModuleColor(module) }]}
            >
              <View style={styles.programCardHeader}>
                <View style={[styles.programIcon, { backgroundColor: getProgramModuleColor(module) }]}> 
                  <MaterialIcons
                    name={module === 'Nutrition' ? 'restaurant' : module === 'Education' ? 'school' : module === 'Livelihood' ? 'work' : 'warning'}
                    size={20}
                    color="#fff"
                  />
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
                style={[styles.primaryButton, actionProjectId === proposalProjectId && styles.timeButtonDisabled]}
                onPress={() => openProposalForm(module)}
                disabled={actionProjectId === proposalProjectId}
              >
                <Text style={styles.primaryButtonText}>
                  {actionProjectId === proposalProjectId ? 'Sending...' : buttonLabel}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
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
                <Text style={styles.modalTitle}>Submit Project Proposal</Text>
                <TouchableOpacity onPress={closeProposalForm} style={styles.modalCloseButton}>
                  <MaterialIcons name="close" size={20} color="#475569" />
                </TouchableOpacity>
              </View>
              <View style={styles.proposalFieldRow}>
                <TextInput
                  style={[styles.input, styles.proposalInputField]}
                  value={proposalForm.proposedTitle}
                  onChangeText={value => updateProposalForm({ proposedTitle: value })}
                  placeholder="Project title"
                  placeholderTextColor="#94a3b8"
                />
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <TextInput
                  style={[styles.input, styles.inputMultiline, styles.proposalInputField]}
                  value={proposalForm.proposedDescription}
                  onChangeText={value => updateProposalForm({ proposedDescription: value })}
                  placeholder="Project description"
                  placeholderTextColor="#94a3b8"
                  multiline
                />
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <View style={styles.proposalCardField}>
                  <View style={styles.selectorGrid}>
                    {FEATURED_PROGRAM_MODULES.map(module => {
                      const selected = proposalForm.requestedProgramModule === module;
                      return (
                        <TouchableOpacity
                          key={module}
                          style={[
                            styles.selectorChip,
                            selected && styles.selectorChipActive,
                            selected && { backgroundColor: getProgramModuleColor(module) },
                          ]}
                          onPress={() => {
                            setActiveProposalModule(module);
                            updateProposalForm({ requestedProgramModule: module });
                          }}
                        >
                          <Text style={[styles.selectorChipText, selected && styles.selectorChipTextActive]}>
                            {module}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <View style={[styles.proposalCardField, styles.proposalImageEditorCard]}>
                  <View style={styles.proposalImageEditorHeader}>
                    <Text style={styles.proposalImageEditorTitle}>Project Picture</Text>
                    <Text style={styles.fieldHelpText}>
                      Upload the picture that should carry over into the approved project details.
                    </Text>
                  </View>
                  <View style={styles.proposalImageEditorActions}>
                    <TouchableOpacity style={styles.photoPickerButton} onPress={handlePickProposalPhoto}>
                      <MaterialIcons name="photo-library" size={18} color="#166534" />
                      <Text style={styles.photoPickerButtonText}>
                        {proposalForm.photoAttachment ? 'Replace Picture' : 'Upload Picture'}
                      </Text>
                    </TouchableOpacity>
                    {proposalForm.photoAttachment ? (
                      <TouchableOpacity style={styles.photoRemoveButton} onPress={handleRemoveProposalPhoto}>
                        <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                        <Text style={styles.photoRemoveButtonText}>Remove</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {proposalForm.photoAttachment ? (
                    <View style={styles.photoPreviewCard}>
                      <Image source={{ uri: proposalForm.photoAttachment }} style={styles.photoPreview} />
                      <View style={styles.photoPreviewMeta}>
                        <Text style={styles.photoPreviewLabel}>Custom project image ready</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.photoEmptyState}>
                      <MaterialIcons name="image" size={22} color="#94a3b8" />
                      <Text style={styles.photoEmptyStateText}>
                        No custom picture uploaded yet. The project will use the default image until you add one.
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={styles.proposalFieldRow}>
                <TouchableOpacity
                  style={[styles.input, styles.dateFieldButton, styles.proposalInputField]}
                  onPress={() => openProposalDatePicker('startDate')}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.dateFieldButtonText,
                      !proposalForm.proposedStartDate && styles.dateFieldButtonPlaceholder,
                    ]}
                  >
                    {proposalForm.proposedStartDate || 'Select start date'}
                  </Text>
                  <MaterialIcons name="calendar-today" size={18} color="#64748b" />
                </TouchableOpacity>
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              {showProposalDatePicker && proposalDatePickerMode === 'startDate' ? (
                <>
                  <LazyDateTimePicker
                    value={selectedProposalDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleProposalDateChange}
                    maximumDate={parseDateValue(proposalForm.proposedEndDate) || undefined}
                  />
                  {Platform.OS === 'ios' ? (
                    <View style={styles.iosDatePickerActions}>
                      <TouchableOpacity onPress={() => setShowProposalDatePicker(false)}>
                        <Text style={styles.iosDatePickerButton}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </>
              ) : null}
              <View style={styles.proposalFieldRow}>
                <TouchableOpacity
                  style={[styles.input, styles.dateFieldButton, styles.proposalInputField]}
                  onPress={() => openProposalDatePicker('endDate')}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.dateFieldButtonText,
                      !proposalForm.proposedEndDate && styles.dateFieldButtonPlaceholder,
                    ]}
                  >
                    {proposalForm.proposedEndDate || 'Select end date'}
                  </Text>
                  <MaterialIcons name="calendar-today" size={18} color="#64748b" />
                </TouchableOpacity>
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              {showProposalDatePicker && proposalDatePickerMode === 'endDate' ? (
                <>
                  <LazyDateTimePicker
                    value={selectedProposalDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleProposalDateChange}
                    minimumDate={parseDateValue(proposalForm.proposedStartDate) || undefined}
                  />
                  {Platform.OS === 'ios' ? (
                    <View style={styles.iosDatePickerActions}>
                      <TouchableOpacity onPress={() => setShowProposalDatePicker(false)}>
                        <Text style={styles.iosDatePickerButton}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </>
              ) : null}
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <View style={[styles.proposalCardField, styles.addressContainer]}>
                  <View style={styles.pickerWrap}>
                    <Text style={styles.pickerLabel}>Region</Text>
                    <View style={styles.pickerBorder}>
                      <Picker
                        selectedValue={selectedRegionCode}
                        onValueChange={handleSelectProposalRegion}
                        style={styles.picker}
                      >
                        <Picker.Item label="Select Region..." value="" color="#94a3b8" />
                        {PHRegions.map(region => (
                          <Picker.Item key={region.code} label={region.name} value={region.code} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  <View style={styles.pickerWrap}>
                    <Text style={styles.pickerLabel}>City / Municipality</Text>
                    <View style={styles.pickerBorder}>
                      <Picker
                        selectedValue={selectedCityCode}
                        onValueChange={handleSelectProposalCity}
                        enabled={selectedRegionCode !== ''}
                        style={styles.picker}
                      >
                        <Picker.Item label="Select City/Municipality..." value="" color="#94a3b8" />
                        {filteredCities.map(city => (
                          <Picker.Item
                            key={city.code}
                            label={city.displayName || city.name}
                            value={city.code}
                          />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  <View style={styles.pickerWrap}>
                    <Text style={styles.pickerLabel}>Barangay</Text>
                    <View style={styles.pickerBorder}>
                      <Picker
                        selectedValue={selectedBarangay}
                        onValueChange={value => setSelectedBarangay(String(value || ''))}
                        enabled={selectedCityCode !== ''}
                        style={styles.picker}
                      >
                        <Picker.Item label="Select Barangay..." value="" color="#94a3b8" />
                        {filteredBarangays.map(barangay => (
                          <Picker.Item
                            key={barangay.code}
                            label={barangay.displayName || barangay.name}
                            value={barangay.code}
                          />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  <Text style={styles.locationPreviewText}>
                    {proposalForm.proposedLocation || 'Choose region, city/municipality, and barangay to set the place.'}
                  </Text>
                </View>
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={styles.proposalFieldRow}>
                <TextInput
                  style={[styles.input, styles.proposalInputField]}
                  value={proposalForm.proposedVolunteersNeeded}
                  onChangeText={value => updateProposalForm({ proposedVolunteersNeeded: value.replace(/[^0-9]/g, '') })}
                  placeholder="Volunteer slots"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                />
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <View style={[styles.proposalCardField, styles.skillSelectionCard]}>
                  <Text style={styles.proposalCardTitle}>Skills Needed</Text>
                  <Text style={styles.fieldHelpText}>
                    Select skills needed for this project. You can also add a custom skill.
                  </Text>
                  <View style={styles.skillSelectorRow}>
                    <View style={[styles.pickerBorder, styles.skillPickerWrap]}>
                      <Picker
                        selectedValue={selectedProposalSkillOption}
                        onValueChange={value => setSelectedProposalSkillOption(String(value || ''))}
                        style={styles.picker}
                      >
                        <Picker.Item label="Select skill" value="" color="#94a3b8" />
                        {availableProposalSkills.map(skill => (
                          <Picker.Item key={skill} label={skill} value={skill} />
                        ))}
                      </Picker>
                    </View>
                    <TouchableOpacity style={styles.addSkillButton} onPress={handleAddSelectedProposalSkill}>
                      <Text style={styles.addSkillButtonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                  {proposalForm.skillsNeeded.length > 0 ? (
                    <View style={styles.selectedSkillList}>
                      {proposalForm.skillsNeeded.map(skill => (
                        <View key={skill} style={styles.selectedSkillItem}>
                          <Text style={styles.selectedSkillText}>{skill}</Text>
                          <TouchableOpacity onPress={() => handleRemoveProposalSkill(skill)}>
                            <MaterialIcons name="close" size={16} color="#166534" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.skillInputRow}>
                    <TextInput
                      style={[styles.input, styles.skillInput]}
                      value={customProposalSkill}
                      onChangeText={setCustomProposalSkill}
                      placeholder="Add new skill"
                      placeholderTextColor="#94a3b8"
                    />
                    <TouchableOpacity style={styles.addSkillButton} onPress={handleAddCustomProposalSkill}>
                      <Text style={styles.addSkillButtonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <TextInput
                  style={[styles.input, styles.inputMultiline, styles.proposalInputField]}
                  value={proposalForm.communityNeed}
                  onChangeText={value => updateProposalForm({ communityNeed: value })}
                  placeholder="Describe the community need"
                  placeholderTextColor="#94a3b8"
                  multiline
                />
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <TextInput
                  style={[styles.input, styles.inputMultiline, styles.proposalInputField]}
                  value={proposalForm.expectedDeliverables}
                  onChangeText={value => updateProposalForm({ expectedDeliverables: value })}
                  placeholder="What will the project deliver?"
                  placeholderTextColor="#94a3b8"
                  multiline
                />
                <View style={styles.proposalFieldTagSpacer} />
              </View>
              <View style={[styles.proposalFieldRow, styles.proposalFieldRowTop]}>
                <View style={styles.proposalCardField}>
                  <Text style={styles.proposalCardTitle}>Document Attachment</Text>
                  <Text style={styles.fieldHelpText}>
                    Upload the same project file that should stay with the approved project details.
                  </Text>
                  {proposalForm.attachmentUrl ? (
                    <View style={styles.proposalDocumentCard}>
                      <View style={styles.proposalDocumentMeta}>
                        <MaterialIcons name="description" size={20} color="#166534" />
                        <Text style={styles.proposalDocumentName} numberOfLines={1}>
                          {proposalForm.attachmentUrl.split('/').pop() || 'Attached document'}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={handleRemoveProposalDocument}>
                        <Text style={styles.photoRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.photoPickerButton} onPress={handlePickProposalDocument}>
                      <MaterialIcons name="attach-file" size={18} color="#166534" />
                      <Text style={styles.photoPickerButtonText}>Upload Document</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.proposalFieldTagSpacer} />
              </View>
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
    fontSize: 16,
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
    fontSize: 16,
    fontWeight: '700',
  },
  greeting: {
    fontSize: 15,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionSubtitle: {
    fontSize: 12,
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
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
    lineHeight: 18,
  },
  cardText: {
    fontSize: 12,
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
  secondaryActionButton: {
    backgroundColor: '#dcfce7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryActionButtonText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '800',
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
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  inlineReportMeta: {
    marginTop: 4,
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: '700',
  },
  inlineReportForm: {
    gap: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  fieldHelpText: {
    fontSize: 11,
    lineHeight: 18,
    color: '#64748b',
  },
  proposalFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  proposalFieldRowTop: {
    alignItems: 'flex-start',
  },
  proposalInputField: {
    flex: 1,
  },
  proposalFieldTag: {
    width: 110,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  proposalFieldTagSpacer: {
    width: 0,
  },
  proposalFieldTagTop: {
    paddingTop: 6,
  },
  proposalCardField: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 14,
    gap: 10,
  },
  proposalCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalReadonlyChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  proposalReadonlyChipText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '800',
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
    fontSize: 11,
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
  dateFieldButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
  },
  dateFieldButtonText: {
    color: '#0f172a',
    fontSize: 13,
  },
  dateFieldButtonPlaceholder: {
    color: '#94a3b8',
  },
  iosDatePickerActions: {
    alignItems: 'flex-end',
    marginTop: 6,
    marginBottom: 4,
  },
  iosDatePickerButton: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  addressContainer: {
    gap: 10,
  },
  pickerWrap: {
    flex: 1,
  },
  pickerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 4,
    marginLeft: 4,
  },
  pickerBorder: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 10,
    overflow: 'hidden',
  },
  picker: {
    height: 52,
    width: '100%',
  },
  locationPreviewText: {
    fontSize: 11,
    lineHeight: 18,
    color: '#64748b',
  },
  skillSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  skillPickerWrap: {
    flex: 1,
  },
  skillSelectionCard: {
    gap: 10,
  },
  selectedSkillList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  selectedSkillItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  selectedSkillText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '700',
  },
  skillInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  skillInput: {
    flex: 1,
  },
  addSkillButton: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addSkillButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  proposalImageEditorCard: {
    gap: 12,
  },
  proposalImageEditorHeader: {
    gap: 4,
  },
  proposalImageEditorTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalImageEditorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
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
  photoRemoveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  photoRemoveButtonText: {
    color: '#b91c1c',
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
  photoEmptyState: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoEmptyStateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  proposalDocumentCard: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  proposalDocumentMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  proposalDocumentName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
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
    fontSize: 16,
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
});
