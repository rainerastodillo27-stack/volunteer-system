import React, { Fragment, useEffect, useMemo, useState } from 'react';

import {

  Alert,

  ActivityIndicator,

  Image,

  Modal,

  Platform,

  ScrollView,

  StyleSheet,

  Text,

  TextInput,

  TouchableOpacity,

  useWindowDimensions,

  View,

  type ImageStyle,

} from 'react-native';
import * as AuthSession from 'expo-auth-session';

import { MaterialIcons } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';

import { Picker } from '@react-native-picker/picker';

import ModernTheme from '../utils/modernTheme';

import { useFocusEffect } from '@react-navigation/native';

import InlineLoadError from '../components/InlineLoadError';

import ProjectTimelineCalendarCard from '../components/ProjectTimelineCalendarCard';
import {
  assertGoogleCalendarAccountMatchesUser,
  getGoogleAuthConfig,
  sendGoogleCalendarSyncEmail,
  syncProjectsToGoogleCalendar,
} from '../utils/googleCalendarSync';

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

  getCitiesByRegion,

  PHRegions,

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

  skillsNeeded: string[];

  communityNeed: string;

  expectedDeliverables: string;

  photoAttachment: string;

  documentAttachment: string;

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

    skillsNeeded: [],

    communityNeed: '',

    expectedDeliverables: '',

    photoAttachment: '',

    documentAttachment: '',

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

function getProgramModule(program: Project): AdvocacyFocus | null {
  const value = String(program.category || program.programModule || '').trim();
  return value === 'Nutrition' || value === 'Education' || value === 'Livelihood' || value === 'Disaster'
    ? value
    : inferProgramModuleFromText(`${program.id || ''} ${program.title || ''}`);
}

function inferProgramModuleFromText(value: string): AdvocacyFocus | null {
  const text = value.toLowerCase();
  if (text.includes('nutrition')) return 'Nutrition';
  if (text.includes('education')) return 'Education';
  if (text.includes('livelihood')) return 'Livelihood';
  if (text.includes('disaster')) return 'Disaster';
  return null;
}

function getProgramModuleIcon(module: AdvocacyFocus): keyof typeof MaterialIcons.glyphMap {
  if (module === 'Nutrition') return 'restaurant';
  if (module === 'Education') return 'school';
  if (module === 'Livelihood') return 'work';
  return 'warning';
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
  const { width: viewportWidth } = useWindowDimensions();
  const isCompactCalendarHeader = viewportWidth < 420;

  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);

  const [partners, setPartners] = useState<Partner[]>([]);

  const [projects, setProjects] = useState<Project[]>([]);
  
  const [programs, setPrograms] = useState<Project[]>([]);

  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);

  const [actionProjectId, setActionProjectId] = useState<string | null>(null);

  const [reportForm, setReportForm] = useState<ReportFormState>(createEmptyReportForm());

  const [proposalForm, setProposalForm] = useState<ProposalFormState>(createEmptyProposalForm('Disaster'));

  const [showProposalModal, setShowProposalModal] = useState(false);

  const [activeProposalModule, setActiveProposalModule] = useState<AdvocacyFocus | null>(null);

  const [activeProposalProgramId, setActiveProposalProgramId] = useState<string | null>(null);

  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);

  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);

  const [availableProposalSkills, setAvailableProposalSkills] = useState<string[]>(

    mergeSkillOptions(TASK_SKILL_OPTIONS, DEFAULT_VOLUNTEER_SKILL_OPTIONS)

  );

  const [selectedProposalSkillOption, setSelectedProposalSkillOption] = useState('');

  const [customProposalSkill, setCustomProposalSkill] = useState('');

  const [selectedRegionCode, setSelectedRegionCode] = useState('');

  const [selectedCityCode, setSelectedCityCode] = useState('');

  const [filteredCities, setFilteredCities] = useState<PHCityMunicipality[]>([]);

  const [showProposalDatePicker, setShowProposalDatePicker] = useState(false);

  const [proposalDatePickerMode, setProposalDatePickerMode] = useState<'startDate' | 'endDate'>('startDate');

  const [selectedProposalDate, setSelectedProposalDate] = useState(new Date());
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarStatusFilter, setCalendarStatusFilter] = useState<string | null>(null);
  const googleAuthConfig = useMemo(() => getGoogleAuthConfig(user?.email), [user?.email]);
  const [googleAuthRequest, , promptGoogleAuth] = AuthSession.useAuthRequest(
    googleAuthConfig.request,
    googleAuthConfig.discovery
  );



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
      
      setPrograms(snapshot.programs || []);

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

  const availableProgramCards = useMemo(() => {
    const byId = new Map<
      string,
      {
        id: string;
        title: string;
        module: AdvocacyFocus;
        description: string;
        accent: string;
      }
    >();

    const programSources = [
      ...programs,
      ...projects.filter(project => {
        const title = String(project.title || '').toLowerCase();
        const id = String(project.id || '').toLowerCase();
        const module = getProgramModule(project);
        return (
          !project.isEvent &&
          !project.parentProjectId &&
          !id.startsWith('project-proposal-') &&
          !title.includes('proposal') &&
          (Boolean(module) || title.includes('program') || title.includes('education') || title.includes('nutrition') || title.includes('livelihood') || title.includes('disaster') || title.includes('relief') || title.includes('support'))
        );
      }),
    ];

    programSources.forEach(program => {
      const id = String(program.id || '').trim();
      const module = getProgramModule(program);
      if (!id || !module || program.isEvent || program.parentProjectId || byId.has(id)) {
        return;
      }

      byId.set(id, {
        id,
        title: program.title || module,
        module,
        description: program.description || getProgramModuleDescription(module),
        accent: program.color || getProgramModuleColor(module),
      });
    });

    return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
  }, [programs, projects]);

  const availableProgramModules = useMemo<AdvocacyFocus[]>(
    () => Array.from(new Set(availableProgramCards.map(card => card.module))),
    [availableProgramCards]
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

  const handleSyncPartnerCalendar = React.useCallback(async () => {
    if (!user?.id) {
      Alert.alert('Login Required', 'Please sign in before syncing your calendar.');
      return;
    }

    const approvedProjects = attendingProjects.filter(project => !project.isEvent);
    if (approvedProjects.length === 0) {
      Alert.alert(
        'No Approved Projects',
        'Only projects approved by the admin for your partner account can be synced.'
      );
      return;
    }

    setCalendarSyncing(true);
    try {
      if (!googleAuthRequest) {
        throw new Error('Google sign-in is still initializing. Try again in a moment.');
      }

      const authResult = await promptGoogleAuth();
      const accessToken = authResult.type === 'success' ? authResult.authentication?.accessToken : undefined;
      if (!accessToken) {
        throw new Error('Google Calendar permission was not granted.');
      }

      await assertGoogleCalendarAccountMatchesUser(accessToken, user.email);

      const result = await syncProjectsToGoogleCalendar(accessToken, approvedProjects);
      if (!result.success && result.synced === 0) {
        throw new Error(result.errors[0] || 'Google Calendar sync failed.');
      }

      await sendGoogleCalendarSyncEmail({
        recipientEmail: user.email,
        userName: user.name,
        syncedCount: result.synced,
        role: 'partner',
      });

      Alert.alert(
        'Calendar Synced',
        `${result.synced} approved project${result.synced === 1 ? '' : 's'} added or updated in your Google Calendar.`
      );
    } catch (error) {
      Alert.alert('Sync Failed', getRequestErrorMessage(error, 'Unable to sync your Google Calendar.'));
    } finally {
      setCalendarSyncing(false);
    }
  }, [attendingProjects, googleAuthRequest, promptGoogleAuth, user]);



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



  const openProposalForm = (module: AdvocacyFocus, programId?: string) => {

    console.log('[PROPOSAL FORM] Opening form for module:', module, 'program:', programId);

    setActiveProposalModule(module);

    setActiveProposalProgramId(programId || null);

    setProposalForm(createEmptyProposalForm(module));

    setSelectedProposalSkillOption('');

    setCustomProposalSkill('');

    setSelectedRegionCode('');

    setSelectedCityCode('');

    setFilteredCities([]);

    setShowProposalDatePicker(false);

    setProposalDatePickerMode('startDate');

    setSelectedProposalDate(new Date());

    console.log('[PROPOSAL FORM] About to set showProposalModal to true');

    setShowProposalModal(true);

    console.log('[PROPOSAL FORM] setShowProposalModal called');

  };



  useEffect(() => {

    const requestedModule = route?.params?.openProposalModule;

    if (!requestedModule || !availableProgramModules.includes(requestedModule)) {

      return;

    }



    openProposalForm(requestedModule as AdvocacyFocus);

    navigation.setParams({ openProposalModule: undefined });

  }, [navigation, route?.params?.openProposalModule]);



  const closeProposalForm = () => {

    setShowProposalModal(false);

    setActiveProposalModule(null);

    setActiveProposalProgramId(null);

    setSelectedProposalSkillOption('');

    setCustomProposalSkill('');

    setSelectedRegionCode('');

    setSelectedCityCode('');

    setFilteredCities([]);

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

    const nextLocation = [cityName, regionName].filter(Boolean).join(', ');



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

    filteredCities,

    selectedCityCode,

    selectedRegionCode,

    showProposalModal,

  ]);



  const handleSelectProposalRegion = (regionCode: string) => {

    setSelectedRegionCode(regionCode);

    setSelectedCityCode('');

    setFilteredCities(regionCode ? getCitiesByRegion(regionCode) : []);

    updateProposalForm({ proposedLocation: '' });

  };



  const handleSelectProposalCity = (cityCode: string) => {

    setSelectedCityCode(cityCode);

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

      updateProposalForm({ documentAttachment: pickedDocument });

    } catch (error: any) {

      const errorMessage = error?.message || 'Unable to access your file library. Please check app permissions in settings.';

      Alert.alert('Permission Required', errorMessage);

    }

  };



  const handleRemoveProposalDocument = () => {

    updateProposalForm({ documentAttachment: '' });

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

    const targetProgramId =
      activeProposalProgramId ||
      availableProgramCards.find(card => card.module === selectedModule)?.id ||
      buildProgramProposalProjectId(selectedModule);

    const targetProgram = availableProgramCards.find(card => card.id === targetProgramId) || null;

    const proposalProjectId = targetProgramId;

    const proposalDetails: PartnerProjectProposalDetails = {

      requestedProgramModule: selectedModule,

      proposedTitle: proposalForm.proposedTitle.trim(),

      proposedDescription: proposalForm.proposedDescription.trim(),

      proposedStartDate: proposalForm.proposedStartDate.trim(),

      proposedEndDate: proposalForm.proposedEndDate.trim(),

      proposedLocation: proposalForm.proposedLocation.trim(),

      proposedVolunteersNeeded: 0,

      skillsNeeded: proposalForm.skillsNeeded,

      communityNeed: proposalForm.communityNeed.trim(),

      expectedDeliverables: proposalForm.expectedDeliverables.trim(),

      targetProjectId: targetProgramId,

      targetProjectTitle: targetProgram?.title,

      targetProjectDescription: targetProgram?.description,

      targetProjectAddress: undefined,

      attachments: [

        ...(proposalForm.photoAttachment

          ? [{ url: proposalForm.photoAttachment, type: 'image' as const }]

          : []),

        ...(proposalForm.documentAttachment.trim()

          ? [{ url: proposalForm.documentAttachment.trim(), type: 'document' as const }]

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



    try {

      setActionProjectId(proposalProjectId);

      const submittedApplication = await submitPartnerProgramProposal(proposalProjectId, user, {

        programModule: selectedModule,

        proposalDetails,

      });

      setPartnerApplications(current => [
        submittedApplication,
        ...current.filter(application => application.id !== submittedApplication.id),
      ].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()));

      setShowProposalModal(false);

      setProposalForm(createEmptyProposalForm(selectedModule));

      Alert.alert('Proposal Sent', 'Your project proposal has been sent to the admin for review.');

      void loadDashboardData();

    } catch (error) {

      Alert.alert(

        getRequestErrorTitle(error),

        getRequestErrorMessage(error, 'Failed to send the project proposal.')

      );

    } finally {

      setActionProjectId(null);

    }

  };



  const handleLogout = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Are you sure you want to logout?')) {
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

    <View style={{ flex: 1 }}>

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


      <View style={styles.partnerCalendarSection}>
        <View
          style={[
            styles.partnerCalendarHeader,
            isCompactCalendarHeader && styles.partnerCalendarHeaderCompact,
          ]}
        >
          <View style={styles.partnerCalendarHeaderCopy}>
            <Text style={styles.partnerCalendarTitle}>Partner Project Calendar</Text>
            <Text style={styles.partnerCalendarSubtitle}>
              {timelineProjectIds?.length
                ? 'Your approved proposals aligned with admin planning calendar.'
                : 'Review shared project schedule and admin planning dates.'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => void handleSyncPartnerCalendar()}
            disabled={calendarSyncing}
            style={[
              styles.partnerCalendarSyncButton,
              isCompactCalendarHeader && styles.partnerCalendarSyncButtonCompact,
              calendarSyncing && styles.partnerCalendarSyncButtonDisabled,
            ]}
          >
            {calendarSyncing ? (
              <ActivityIndicator size={12} color="#16a34a" />
            ) : (
              <MaterialIcons name="sync" size={14} color="#16a34a" />
            )}
            <Text style={styles.partnerCalendarSyncButtonText}>
              {calendarSyncing ? 'Syncing...' : 'Sync Calendar'}
            </Text>
          </TouchableOpacity>
        </View>

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
        statusFilter={calendarStatusFilter}
        setStatusFilter={setCalendarStatusFilter}

        accentColor="#166534"

        emptyText="No partner timeline items yet."

        onOpenProject={projectId =>

          navigateToAvailableRoute(navigation, 'Programs', {

            projectId,

          })

        }

      />
      </View>




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

        {availableProgramCards.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>No programs available yet. Programs will appear here once created by admin.</Text>
          </View>
        ) : null}

        {availableProgramCards.map(programCard => {
          const module = programCard.module;

          const application = programApplicationByModule.get(module);

          const status = application?.status;

          const isApproved = status === 'Approved';

          const isPending = status === 'Pending';

          const isRejected = status === 'Rejected';

          const proposalProjectId = buildProgramProposalProjectId(module);

          const proposalSubmissionLocked = isPending || isApproved;
          const buttonLabel = isRejected
            ? 'Revise & Resubmit'
            : isPending
              ? 'Proposal Pending Review'
              : isApproved
                ? 'Proposal Approved'
                : 'Submit Project Proposal';



          return (

            <View

              key={programCard.id}

              style={[styles.card, styles.programCard, { borderColor: programCard.accent }]}

            >

              <View style={styles.programCardHeader}>

                <View style={[styles.programIcon, { backgroundColor: programCard.accent }]}> 

                  <MaterialIcons

                    name={getProgramModuleIcon(module)}

                    size={20}

                    color="#fff"

                  />

                </View>

                <View style={{ flex: 1 }}>

                  <Text style={styles.cardTitle}>{programCard.title}</Text>

                  <Text style={styles.cardMeta}>{programCard.description}</Text>

                </View>

              </View>

              {isRejected && application?.reviewNotes ? (

                <View style={{ marginBottom: 8, padding: 10, backgroundColor: '#fef2f2', borderRadius: 8, borderWidth: 1, borderColor: '#fecaca' }}>

                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#991b1b', marginBottom: 2 }}>Rejection Reason</Text>

                  <Text style={{ fontSize: 12, color: '#7f1d1d' }}>{application.reviewNotes}</Text>

                </View>

              ) : null}

              <TouchableOpacity

                style={[
                  styles.primaryButton,
                  (actionProjectId === proposalProjectId || proposalSubmissionLocked) && styles.timeButtonDisabled,
                ]}

                onPress={() => openProposalForm(module, programCard.id)}

                disabled={actionProjectId === proposalProjectId || proposalSubmissionLocked}

              >

                <Text style={styles.primaryButtonText}>

                  {actionProjectId === proposalProjectId ? 'Sending...' : buttonLabel}

                </Text>

              </TouchableOpacity>

            </View>

          );

        })}

      </View>

    </ScrollView>

      <Modal

        visible={showProposalModal}

        animationType="slide"

        transparent

        onRequestClose={closeProposalForm}

      >

        <View style={styles.modalBackdrop}>

          <View style={styles.modalCard}>

            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">

              <View style={styles.proposalCard}>

                <View style={styles.proposalHeader}>

                  <Ionicons name="document-text" size={32} color="#166534" />

                  <View style={{ flex: 1 }}>

                    <Text style={styles.proposalTitle}>Project Specifications</Text>

                    <Text style={styles.proposalMeta}>Provide details for the {proposalForm.requestedProgramModule} program</Text>

                  </View>

                  <TouchableOpacity onPress={closeProposalForm} style={styles.modalCloseButton}>

                    <MaterialIcons name="close" size={20} color="#475569" />

                  </TouchableOpacity>

                </View>

                <View style={styles.formGroup}>

                  <Text style={styles.formLabel}>Project Title</Text>

                  <TextInput

                    style={styles.formInput}

                    placeholder="e.g. Community Nutrition Drive 2024"

                    placeholderTextColor="#94a3b8"

                    value={proposalForm.proposedTitle}

                    onChangeText={value => updateProposalForm({ proposedTitle: value })}

                  />

                </View>

                <View style={styles.formGroup}>

                  <Text style={styles.formLabel}>Detailed Description</Text>

                  <TextInput

                    style={[styles.formInput, { height: 120, textAlignVertical: 'top' }]}

                    multiline

                    placeholder="Outline the goals, target beneficiaries, and scope..."

                    placeholderTextColor="#94a3b8"

                    value={proposalForm.proposedDescription}

                    onChangeText={value => updateProposalForm({ proposedDescription: value })}

                  />

                </View>

                <View style={styles.formRow}>

                  <View style={[styles.formGroup, { flex: 1 }]}>

                    <Text style={styles.formLabel}>Start Date</Text>

                    <TouchableOpacity

                      style={styles.pickerTrigger}

                      onPress={() => openProposalDatePicker('startDate')}

                    >

                      <MaterialIcons name="calendar-today" size={18} color="#166534" />

                      <Text style={[styles.pickerTriggerText, !proposalForm.proposedStartDate && styles.pickerPlaceholder]}>

                        {proposalForm.proposedStartDate || 'Select date'}

                      </Text>

                    </TouchableOpacity>

                    {showProposalDatePicker && proposalDatePickerMode === 'startDate' ? (

                      <>

                        <LazyDateTimePicker

                          value={selectedProposalDate}

                          mode="date"

                          display={Platform.OS === 'ios' ? 'inline' : 'calendar'}

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

                  </View>

                  <View style={[styles.formGroup, { flex: 1 }]}>

                    <Text style={styles.formLabel}>End Date</Text>

                    <TouchableOpacity

                      style={styles.pickerTrigger}

                      onPress={() => openProposalDatePicker('endDate')}

                    >

                      <MaterialIcons name="calendar-today" size={18} color="#166534" />

                      <Text style={[styles.pickerTriggerText, !proposalForm.proposedEndDate && styles.pickerPlaceholder]}>

                        {proposalForm.proposedEndDate || 'Select date'}

                      </Text>

                    </TouchableOpacity>

                    {showProposalDatePicker && proposalDatePickerMode === 'endDate' ? (

                      <>

                        <LazyDateTimePicker

                          value={selectedProposalDate}

                          mode="date"

                          display={Platform.OS === 'ios' ? 'inline' : 'calendar'}

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

                  </View>

                </View>

                <View style={styles.formGroup}>

                  <Text style={styles.formLabel}>Target Location</Text>

                  <View style={styles.addressFormContainer}>

                    <View style={styles.pickerWrap}>

                      <Text style={styles.pickerLabel}>Region</Text>

                      <View style={styles.pickerBorder}>

                        <Picker

                          selectedValue={selectedRegionCode}

                          onValueChange={handleSelectProposalRegion}

                          style={styles.picker}

                        >

                          <Picker.Item label="Select Region" value="" color="#94a3b8" />

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

                          enabled={!!selectedRegionCode}

                          style={styles.picker}

                        >

                          <Picker.Item label="Select City" value="" color="#94a3b8" />

                          {filteredCities.map(city => (

                            <Picker.Item key={city.code} label={city.displayName || city.name} value={city.code} />

                          ))}

                        </Picker>

                      </View>

                    </View>

                  </View>

                </View>

                <View style={styles.formGroup}>

                  <Text style={styles.formLabel}>Proposal Photo</Text>

                  <TouchableOpacity style={styles.photoUploadButton} onPress={handlePickProposalPhoto}>

                    <MaterialIcons name="photo-camera" size={18} color="#ffffff" />

                    <Text style={styles.photoUploadButtonText}>

                      {proposalForm.photoAttachment ? 'Change Photo' : 'Attach Photo'}

                    </Text>

                  </TouchableOpacity>

                  {proposalForm.photoAttachment ? (

                    <View style={styles.photoPreviewContainer}>

                      <Image source={{ uri: proposalForm.photoAttachment }} style={styles.photoPreview as ImageStyle} resizeMode="cover" />

                      <TouchableOpacity style={styles.photoRemoveButton} onPress={handleRemoveProposalPhoto}>

                        <Text style={styles.photoRemoveButtonText}>Remove</Text>

                      </TouchableOpacity>

                    </View>

                  ) : null}

                </View>

                <View style={styles.formGroup}>

                  <Text style={styles.formLabel}>Proposal Document</Text>

                  <TouchableOpacity style={styles.documentUploadButton} onPress={handlePickProposalDocument}>

                    <MaterialIcons name="attach-file" size={18} color="#ffffff" />

                    <Text style={styles.documentUploadButtonText}>

                      {proposalForm.documentAttachment ? 'Change Document' : 'Attach Document'}

                    </Text>

                  </TouchableOpacity>

                  {proposalForm.documentAttachment ? (

                    <View style={styles.documentPreviewContainer}>

                      <View style={styles.documentPreviewContent}>

                        <MaterialIcons name="insert-drive-file" size={32} color="#10b981" />

                        <Text style={styles.documentPreviewText} numberOfLines={1}>

                          {proposalForm.documentAttachment.split('/').pop() || 'Document attached'}

                        </Text>

                      </View>

                      <TouchableOpacity style={styles.documentRemoveButton} onPress={handleRemoveProposalDocument}>

                        <Text style={styles.documentRemoveButtonText}>Remove</Text>

                      </TouchableOpacity>

                    </View>

                  ) : null}

                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={handleSubmitProgramProposal}>

                  <Text style={styles.submitBtnText}>Submit Proposal for Review</Text>

                  <MaterialIcons name="send" size={20} color="#fff" />

                </TouchableOpacity>

              </View>

            </ScrollView>

          </View>

        </View>

      </Modal>

    </View>

  );

}



const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: ModernTheme.colors.background.secondary,

  },

  content: {

    padding: ModernTheme.spacing[4],

    paddingBottom: ModernTheme.spacing[8],

  },

  loadingContainer: {

    flex: 1,

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor: ModernTheme.colors.background.secondary,

    padding: ModernTheme.spacing[6],

  },

  loadingCard: {

    width: '100%',

    maxWidth: 360,

    borderRadius: ModernTheme.borderRadius['2xl'],

    backgroundColor: ModernTheme.colors.background.card,

    alignItems: 'center',

    paddingHorizontal: ModernTheme.spacing[6],

    paddingVertical: ModernTheme.spacing[7],

    borderWidth: 0,

    borderColor: 'transparent',

    gap: ModernTheme.spacing[2.5],

    ...ModernTheme.shadows.lg,

  },

  loadingTitle: {

    fontSize: ModernTheme.typography.fontSize.lg,

    fontWeight: ModernTheme.typography.fontWeight.bold,

    color: ModernTheme.colors.text.primary,

  },

  loadingText: {

    textAlign: 'center',

    fontSize: ModernTheme.typography.fontSize.sm,

    lineHeight: 20,

    color: ModernTheme.colors.text.secondary,

  },

  header: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: ModernTheme.spacing[3],

    backgroundColor: ModernTheme.colors.background.card,

    padding: ModernTheme.spacing[4],

    borderRadius: ModernTheme.borderRadius.xl,

    ...ModernTheme.shadows.base,

  },

  avatar: {

    width: 48,

    height: 48,

    borderRadius: ModernTheme.borderRadius.full,

    backgroundColor: ModernTheme.colors.primary[700],

    alignItems: 'center',

    justifyContent: 'center',

    ...ModernTheme.shadows.sm,

  },

  avatarText: {

    color: ModernTheme.colors.text.inverse,

    fontSize: ModernTheme.typography.fontSize.lg,

    fontWeight: ModernTheme.typography.fontWeight.semibold,

  },

  greeting: {

    fontSize: ModernTheme.typography.fontSize.md,

    fontWeight: ModernTheme.typography.fontWeight.semibold,

    color: ModernTheme.colors.text.primary,

  },

  role: {

    marginTop: ModernTheme.spacing[0.5],

    fontSize: 12,

    color: '#64748b',

  },

  partnerCalendarSection: {

    marginBottom: 4,

  },

  partnerCalendarHeader: {

    flexDirection: 'row',

    alignItems: 'flex-start',

    justifyContent: 'space-between',

    gap: 10,

    marginBottom: 10,

    paddingHorizontal: 4,

  },

  partnerCalendarHeaderCompact: {

    flexDirection: 'column',

    alignItems: 'stretch',

    gap: 8,

  },

  partnerCalendarHeaderCopy: {

    flex: 1,

    minWidth: 0,

  },

  partnerCalendarTitle: {

    fontSize: 16,

    fontWeight: '700',

    color: '#166534',

  },

  partnerCalendarSubtitle: {

    fontSize: 12,

    color: '#64748b',

    lineHeight: 17,

    marginTop: 2,

  },

  partnerCalendarSyncButton: {

    minHeight: 32,

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 5,

    backgroundColor: '#f0fdf4',

    borderWidth: 1,

    borderColor: '#bbf7d0',

    borderRadius: 20,

    paddingVertical: 6,

    paddingHorizontal: 12,

  },

  partnerCalendarSyncButtonCompact: {

    alignSelf: 'flex-end',

  },

  partnerCalendarSyncButtonDisabled: {

    opacity: 0.65,

  },

  partnerCalendarSyncButtonText: {

    fontSize: 12,

    fontWeight: '600',

    color: '#16a34a',

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

  proposalCard: {

    backgroundColor: '#fff',

    borderRadius: 24,

    padding: 20,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    shadowColor: '#000',

    shadowOffset: { width: 0, height: 8 },

    shadowOpacity: 0.05,

    shadowRadius: 20,

    elevation: 5,

  },

  proposalHeader: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 14,

    marginBottom: 20,

  },

  proposalTitle: {

    fontSize: 20,

    fontWeight: '900',

    color: '#0f172a',

  },

  proposalMeta: {

    fontSize: 12,

    color: '#64748b',

    marginTop: 4,

  },

  formGroup: {

    marginBottom: 16,

  },

  formLabel: {

    fontSize: 12,

    fontWeight: '800',

    color: '#475569',

    marginBottom: 6,

    marginLeft: 4,

  },

  formInput: {

    backgroundColor: '#f8fafc',

    borderWidth: 1,

    borderColor: '#e2e8f0',

    borderRadius: 14,

    padding: 13,

    fontSize: 14,

    color: '#0f172a',

  },

  formRow: {

    flexDirection: 'row',

    gap: 12,

  },

  addressFormContainer: {

    backgroundColor: '#f8fafc',

    borderWidth: 1,

    borderColor: '#e2e8f0',

    borderRadius: 14,

    padding: 14,

    gap: 12,

  },

  submitBtn: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 10,

    backgroundColor: '#166534',

    paddingVertical: 15,

    borderRadius: 16,

    marginTop: 10,

  },

  submitBtnText: {

    color: '#fff',

    fontSize: 14,

    fontWeight: '900',

  },

  photoUploadButton: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 10,

    backgroundColor: '#166534',

    paddingVertical: 12,

    borderRadius: 14,

    paddingHorizontal: 14,

    marginTop: 6,

  },

  photoUploadButtonText: {

    color: '#fff',

    fontSize: 14,

    fontWeight: '700',

  },

  photoPreviewContainer: {

    marginTop: 10,

    alignItems: 'center',

    gap: 8,

  },

  documentUploadButton: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 10,

    backgroundColor: '#10b981',

    paddingVertical: 12,

    borderRadius: 14,

    paddingHorizontal: 14,

    marginTop: 6,

  },

  documentUploadButtonText: {

    color: '#fff',

    fontSize: 14,

    fontWeight: '700',

  },

  documentPreviewContainer: {

    marginTop: 10,

    gap: 8,

  },

  documentPreviewContent: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 12,

    borderRadius: 14,

    borderWidth: 1,

    borderColor: '#d1fae5',

    backgroundColor: '#f0fdf4',

    padding: 16,

  },

  documentPreviewText: {

    flex: 1,

    color: '#0f172a',

    fontSize: 14,

    fontWeight: '600',

  },

  documentRemoveButton: {

    marginTop: 8,

    alignSelf: 'flex-end',

    paddingVertical: 8,

    paddingHorizontal: 12,

    borderRadius: 12,

    backgroundColor: '#fee2e2',

    borderWidth: 1,

    borderColor: '#fca5a5',

  },

  documentRemoveButtonText: {

    color: '#dc2626',

    fontSize: 13,

    fontWeight: '700',

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

  emptyText: {

    color: '#64748b',

    fontSize: 13,

    lineHeight: 20,

  },

  pickerTrigger: {

    flexDirection: 'row',

    alignItems: 'center',

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 8,

    padding: 12,

    backgroundColor: '#fff',

    gap: 8,

  },

  pickerTriggerText: {

    fontSize: 16,

    color: '#0f172a',

    fontWeight: '500',

  },

  pickerPlaceholder: {

    color: '#94a3b8',

  },

});

