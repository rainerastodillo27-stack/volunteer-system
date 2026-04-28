import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, Text, TouchableOpacity, Alert, Pressable, Image, Platform, ImageSourcePropType, Modal, TextInput, ScrollView, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import {
  buildProgramProposalProjectId,
  getAllVolunteers,
  getProjectsScreenSnapshot,
  getVolunteerProjectMatches,
  requestVolunteerProjectJoin,
  saveEvent,
  submitVolunteerTimeOutReport,
  submitPartnerProgramProposal,
  startVolunteerTimeLog,
  endVolunteerTimeLog,
  subscribeToStorageChanges,
} from '../models/storage';
import { PartnerProjectApplication, PartnerProjectProposalDetails, Project, Volunteer, VolunteerProjectJoinRecord, VolunteerProjectMatch, VolunteerTimeLog } from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const CATEGORY_KEYWORDS: Record<Project['category'], string[]> = {
  Education: ['teaching', 'mentoring', 'reading', 'library', 'school', 'student', 'tutor'],
  Livelihood: ['livelihood', 'training', 'skills', 'sewing', 'enterprise', 'food', 'workshop'],
  Nutrition: ['nutrition', 'feeding', 'meal', 'health', 'wellness', 'food'],
  Disaster: ['disaster', 'relief', 'emergency', 'evacuation', 'response', 'rescue', 'aid'],
};

const PROGRAM_IMAGE_BY_CATEGORY: Partial<Record<Project['category'], ImageSourcePropType>> = {
  Nutrition: require('../assets/programs/nutrition.jpg'),
  Education: require('../assets/programs/education.jpg'),
  Livelihood: require('../assets/programs/livelihood.jpg'),
  Disaster: require('../assets/programs/mingo-relief.jpg'),
};

const PROGRAM_PHOTO_BY_TITLE: Record<string, ImageSourcePropType> = {
  'Farm to Fork Program': require('../assets/programs/farm-to-fork.jpg'),
  'Mingo for Nutritional Support': require('../assets/programs/nutrition.jpg'),
  'Mingo for Emergency Relief': require('../assets/programs/mingo-relief.jpg'),
  LoveBags: require('../assets/programs/lovebags.jpg'),
  'School Support': require('../assets/programs/school-support.jpg'),
  'Artisans of Hope': require('../assets/programs/artisans-of-hope.jpg'),
  'Project Joseph': require('../assets/programs/project-joseph.jpg'),
  'Growing Hope': require('../assets/programs/growing-hope.jpg'),
  'Peter Project': require('../assets/programs/peter-project.jpg'),
};

const FALLBACK_ICON_BY_CATEGORY: Record<Project['category'], keyof typeof MaterialIcons.glyphMap> = {
  Nutrition: 'restaurant',
  Education: 'school',
  Livelihood: 'volunteer-activism',
  Disaster: 'warning',
};

type ProjectCategoryGroup = {
  category: Project['category'];
  eventCount: number;
  programCount: number;
  projects: Project[];
};

type Recommendation = {
  label: 'Good Skill Fit' | 'Suggested for You' | 'Open Program';
  reasons: string[];
};

type ContentFilter = 'All' | 'Programs' | 'Events';

type PartnerProposalDraft = {
  proposedTitle: string;
  proposedDescription: string;
  proposedStartDate: string;
  proposedEndDate: string;
  proposedLocation: string;
  proposedVolunteersNeeded: string;
  skillsNeeded: string;
  communityNeed: string;
  expectedDeliverables: string;
};

function formatProjectDateRange(startValue?: string, endValue?: string): string {
  const startDate = startValue ? new Date(startValue) : null;
  const endDate = endValue ? new Date(endValue) : null;

  if (!startDate || Number.isNaN(startDate.getTime())) {
    return 'Schedule to be announced';
  }

  const startLabel = format(startDate, 'MMM d, yyyy');
  if (!endDate || Number.isNaN(endDate.getTime())) {
    return startLabel;
  }

  const endLabel = format(endDate, 'MMM d, yyyy');
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function hasEventStartedForToday(startValue?: string, now: Date = new Date()): boolean {
  if (!startValue) {
    return true;
  }

  const startDate = new Date(startValue);
  if (Number.isNaN(startDate.getTime())) {
    return true;
  }

  const startDay = new Date(startDate);
  startDay.setHours(0, 0, 0, 0);
  return now >= startDay;
}

function createPartnerProposalDraft(project: Project): PartnerProposalDraft {
  return {
    proposedTitle: project.title,
    proposedDescription: project.description,
    proposedStartDate: project.startDate.slice(0, 10),
    proposedEndDate: project.endDate.slice(0, 10),
    proposedLocation: project.location.address,
    proposedVolunteersNeeded: String(project.volunteersNeeded || 1),
    skillsNeeded: (project.skillsNeeded || []).join(', '),
    communityNeed: '',
    expectedDeliverables: '',
  };
}

function buildPartnerProposalDetails(
  project: Project,
  draft: PartnerProposalDraft
): PartnerProjectProposalDetails {
  return {
    targetProjectId: project.id,
    targetProjectTitle: project.title,
    targetProjectDescription: project.description,
    targetProjectAddress: project.location.address,
    requestedProgramModule: project.programModule || project.category,
    proposedTitle: draft.proposedTitle.trim(),
    proposedDescription: draft.proposedDescription.trim(),
    proposedStartDate: draft.proposedStartDate.trim(),
    proposedEndDate: draft.proposedEndDate.trim(),
    proposedLocation: draft.proposedLocation.trim(),
    proposedVolunteersNeeded: Number(draft.proposedVolunteersNeeded),
    skillsNeeded: draft.skillsNeeded.split(',').map(s => s.trim()).filter(s => s.length > 0),
    communityNeed: draft.communityNeed.trim(),
    expectedDeliverables: draft.expectedDeliverables.trim(),
  };
}

function getCompletionProofSummary(log?: VolunteerTimeLog | null): string {
  const proofItems: string[] = [];

  if (log?.completionPhoto) {
    proofItems.push('Photo uploaded');
  }

  if (log?.completionReport) {
    proofItems.push('Report submitted');
  }

  return proofItems.length > 0 ? proofItems.join(' and ') : 'No proof submitted';
}

function formatSuggestionReasons(reasons: string[]): string {
  return reasons
    .map((reason) => (reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : reason))
    .join(', ');
}

function getEventAvailabilitySummary(project: Project): string {
  const displayStatus = getProjectDisplayStatus(project);

  if (displayStatus === 'Completed' || displayStatus === 'Cancelled') {
    return displayStatus;
  }

  if (displayStatus === 'On Hold') {
    return 'Currently on hold';
  }

  const volunteersNeeded = Math.max(project.volunteersNeeded || 0, 0);
  const remainingSlots = Math.max(volunteersNeeded - project.volunteers.length, 0);

  if (remainingSlots === 0) {
    return 'Volunteer slots full';
  }

  return `${remainingSlots} spot${remainingSlots === 1 ? '' : 's'} left`;
}

// Normalizes text into searchable word tokens for project recommendations.
const normalizeWords = (value?: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

// Removes duplicate recommendation terms while preserving display order.
const unique = (values: string[]) => Array.from(new Set(values));

// Builds a lightweight recommendation label for a volunteer and project pair.
function getProjectSuggestion(project: Project, volunteer: Volunteer | null): Recommendation {
  if (!volunteer) {
    return {
      label: 'Open Program',
      reasons: [project.category, 'Volunteer-ready'],
    };
  }

  const skillTerms = unique([
    ...((volunteer.skills || []).flatMap(normalizeWords)),
    ...normalizeWords(volunteer.skillsDescription),
    ...normalizeWords(volunteer.specialSkills),
  ]);

  const projectTerms = unique([
    ...normalizeWords(project.title),
    ...normalizeWords(project.description),
    ...normalizeWords(project.location.address),
    ...((project.skillsNeeded || []).flatMap(normalizeWords)),
    ...CATEGORY_KEYWORDS[project.category],
  ]);

  const matchedTerms = skillTerms.filter((term) => projectTerms.includes(term)).slice(0, 3);
  const reasons = matchedTerms.length > 0 ? [...matchedTerms] : [];
  const isLocalProgram = project.location.address.toLowerCase().includes('negros');

  if (isLocalProgram) {
    reasons.push('Negros location');
  }

  return {
    label:
      matchedTerms.length >= 2 ? 'Good Skill Fit' : reasons.length > 0 ? 'Suggested for You' : 'Open Program',
    reasons: reasons.length > 0 ? reasons : ['Open for volunteers'],
  };
}

const PROGRAM_PHOTO_MATCHERS: Array<{
  matches: (project: Project, normalizedTitle: string) => boolean;
  source: ImageSourcePropType;
}> = [
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('farm to fork'),
    source: require('../assets/programs/farm-to-fork.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('emergency') || normalizedTitle.includes('relief'),
    source: require('../assets/programs/mingo-relief.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('lovebag') || normalizedTitle.includes('school bag'),
    source: require('../assets/programs/lovebags.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('school'),
    source: require('../assets/programs/school-support.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('artisans'),
    source: require('../assets/programs/artisans-of-hope.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('joseph') || normalizedTitle.includes('sewing'),
    source: require('../assets/programs/project-joseph.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('growing hope') || normalizedTitle.includes('garden'),
    source: require('../assets/programs/growing-hope.jpg'),
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('peter'),
    source: require('../assets/programs/peter-project.jpg'),
  },
  {
    matches: (project, normalizedTitle) =>
      normalizedTitle.includes('mingo') || normalizedTitle.includes('masiglang') || project.category === 'Nutrition',
    source: require('../assets/programs/nutrition.jpg'),
  },
];

function getProgramPhotoSource(project: Project): ImageSourcePropType | undefined {
  if (PROGRAM_PHOTO_BY_TITLE[project.title]) {
    return PROGRAM_PHOTO_BY_TITLE[project.title];
  }

  const normalizedTitle = project.title.trim().toLowerCase();
  return PROGRAM_PHOTO_MATCHERS.find((entry) => entry.matches(project, normalizedTitle))?.source;
}

// Returns image candidates for a project card, prioritizing bundled local program photos.
function getProjectImageSources(project: Project): ImageSourcePropType[] {
  if (project.imageHidden) {
    return [];
  }

  const imageSources: ImageSourcePropType[] = [];
  if (isImageMediaUri(project.imageUrl)) {
    imageSources.push({ uri: project.imageUrl });
  }
  const programPhotoSource = getProgramPhotoSource(project);

  if (programPhotoSource) {
    imageSources.push(programPhotoSource);
  }

  if (project.programModule && project.programModule in PROGRAM_IMAGE_BY_CATEGORY) {
    imageSources.push(PROGRAM_IMAGE_BY_CATEGORY[project.programModule as Project['category']] as ImageSourcePropType);
  }

  const categoryImageSource = PROGRAM_IMAGE_BY_CATEGORY[project.category];
  if (categoryImageSource && !imageSources.includes(categoryImageSource)) {
    imageSources.push(categoryImageSource);
  }

  return imageSources;
}

function getPrimaryProjectImageSource(project: Project): ImageSourcePropType | undefined {
  return getProjectImageSources(project)[0];
}

function ProjectCardImage({
  project,
  onPress,
}: {
  project: Project;
  onPress: () => void;
}) {
  const imageSources = useMemo(() => getProjectImageSources(project), [project]);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageIndex(0);
  }, [imageSources]);

  const activeImageSource = imageSources[imageIndex];
  if (!activeImageSource) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.programImageFallback,
          styles[`programImageFallback${project.category}`],
          pressed && styles.programImagePressed,
        ]}
      >
        <MaterialIcons
          name={FALLBACK_ICON_BY_CATEGORY[project.category]}
          size={34}
          color="#166534"
        />
        <Text style={styles.programImageFallbackTitle}>{project.title}</Text>
        <Text style={styles.programImageFallbackSubtitle}>Program preview</Text>
        <Text style={styles.programImageHint}>Click image to open</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.programImageButton, pressed && styles.programImagePressed]}
    >
      <Image
        source={activeImageSource}
        style={styles.programImageBackdrop}
        resizeMode="cover"
      />
      <Image
        source={activeImageSource}
        style={styles.programImage}
        resizeMode="contain"
        onError={() => {
          setImageIndex((currentIndex) => currentIndex + 1);
        }}
      />
      <View style={styles.programImageTitleBadge}>
        <Text style={styles.programImageTitle}>{project.title}</Text>
        <Text style={styles.programImageCategory}>{project.category}</Text>
      </View>
      <View style={styles.programImageOverlay}>
        <Text style={styles.programImageOverlayText}>Click image to open</Text>
      </View>
    </Pressable>
  );
}

// Category header component for collapsible categories
function CategoryHeader({
  category,
  eventCount,
  programCount,
  projectCount,
  isExpanded,
  onToggle,
}: {
  category: Project['category'];
  eventCount: number;
  programCount: number;
  projectCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const categoryColors: Record<Project['category'], string> = {
    Education: '#1D4ED8',
    Livelihood: '#9333EA',
    Nutrition: '#DC2626',
    Disaster: '#F97316',
  };

  const categoryIcons: Record<Project['category'], keyof typeof MaterialIcons.glyphMap> = {
    Education: 'school',
    Livelihood: 'work',
    Nutrition: 'restaurant',
    Disaster: 'warning',
  };

  return (
    <TouchableOpacity
      onPress={onToggle}
      style={[styles.categoryHeader, { backgroundColor: categoryColors[category] }]}
      activeOpacity={0.7}
    >
      <View style={styles.categoryHeaderContent}>
        <MaterialIcons
          name={categoryIcons[category]}
          size={24}
          color="#fff"
          style={styles.categoryIcon}
        />
        <View style={styles.categoryHeaderText}>
          <Text style={styles.categoryTitle}>{category}</Text>
          <Text style={styles.categoryCount}>
            {projectCount} item{projectCount !== 1 ? 's' : ''} | {programCount} program{programCount !== 1 ? 's' : ''} | {eventCount} event{eventCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
      <MaterialIcons
        name={isExpanded ? 'expand-less' : 'expand-more'}
        size={28}
        color="#fff"
      />
    </TouchableOpacity>
  );
}

// Lists projects and actions for volunteers, partners, and admins.
export default function ProjectsScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' || width >= 1100;
  const perfNow = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const projectListRef = useRef<FlatList<ProjectCategoryGroup> | null>(null);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [allVolunteers, setAllVolunteers] = useState<Volunteer[]>([]);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Project['category'] | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [timeOutProjectId, setTimeOutProjectId] = useState<string | null>(null);
  const [timeOutReportDraft, setTimeOutReportDraft] = useState('');
  const [timeOutPhotoDraft, setTimeOutPhotoDraft] = useState('');
  const [proposalProjectId, setProposalProjectId] = useState<string | null>(null);
  const [partnerProposalDraft, setPartnerProposalDraft] = useState<PartnerProposalDraft | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    title: string;
    source: ImageSourcePropType;
  } | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<Project['category']>>(
    new Set()
  );

  const [statusFilter, setStatusFilter] = useState<'All' | Project['status']>('All');
  const [contentFilter, setContentFilter] = useState<ContentFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  // Applies the latest project snapshot to local screen state.
  const applySnapshot = useCallback((snapshot: {
    projects: Project[];
    volunteerProfile: Volunteer | null;
    timeLogs: VolunteerTimeLog[];
    partnerApplications: PartnerProjectApplication[];
    volunteerJoinRecords: VolunteerProjectJoinRecord[];
  }) => {
    startTransition(() => {
      setProjects(snapshot.projects);
      setVolunteerProfile(snapshot.volunteerProfile);
      setTimeLogs(snapshot.timeLogs);
      setPartnerApplications(snapshot.partnerApplications);
      setVolunteerJoinRecords(snapshot.volunteerJoinRecords);
    });
  }, []);

  // Loads projects plus role-specific volunteer or partner data for this screen.
  const loadProjectsData = useCallback(async () => {
    const startedAt = perfNow();
    try {
      const [snapshot, volunteers] = await Promise.all([
        getProjectsScreenSnapshot(user, ['projects', 'volunteerProfile']),
        user?.role === 'volunteer' ? getAllVolunteers() : Promise.resolve([] as Volunteer[]),
      ]);
      applySnapshot(snapshot);
      setAllVolunteers(volunteers);
      setLoadError(null);
      if (snapshot.volunteerProfile?.id) {
        const matches = await getVolunteerProjectMatches(snapshot.volunteerProfile.id);
        setVolunteerMatches(matches);
      } else {
        setVolunteerMatches([]);
      }
      const elapsedMs = perfNow() - startedAt;
      console.log(`[perf] ProjectsScreen data ready in ${Math.round(elapsedMs)}ms`);
    } catch (error) {
      const nextLoadError = {
        title: 'Database Unavailable',
        message: getRequestErrorMessage(error, 'Failed to load projects from Postgres.'),
      };
      startTransition(() => {
        setProjects([]);
        setVolunteerProfile(null);
        setTimeLogs([]);
        setPartnerApplications([]);
        setVolunteerJoinRecords([]);
        setVolunteerMatches([]);
        setAllVolunteers([]);
      });
      setLoadError(nextLoadError);
    }
  }, [applySnapshot, user]);

  useFocusEffect(
    React.useCallback(() => {
      void loadProjectsData();
      return subscribeToStorageChanges(
        ['projects', 'volunteers', 'volunteerProjectJoins', 'volunteerTimeLogs', 'partnerProjectApplications', 'volunteerMatches'],
        () => {
          void loadProjectsData();
        }
      );
    }, [loadProjectsData])
  );

  // Handles the active project action based on the current user role.
  const handleJoinProject = async (projectId: string) => {
    if (!user?.id) return;
    try {
      setLoadingProjectId(projectId);
      if (user.role === 'partner') {
        const selectedProject = projects.find(project => project.id === projectId);
        if (!selectedProject) {
          throw new Error('Selected project was not found.');
        }
        setProposalProjectId(projectId);
        setPartnerProposalDraft(createPartnerProposalDraft(selectedProject));
        return;
      }

      const requestedMatch = await requestVolunteerProjectJoin(projectId, user.id);
      startTransition(() => {
        setVolunteerMatches(prev => {
          const withoutCurrent = prev.filter(match => match.projectId !== requestedMatch.projectId);
          return [requestedMatch, ...withoutCurrent].sort(
            (a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime()
          );
        });
      });
      Alert.alert(
        'Request Sent',
        'Your event join request was sent to the admin. You will be notified once it is approved or rejected.'
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to submit this request. Please try again.')
      );
    } finally {
      setLoadingProjectId(null);
    }
  };

  const activeProposalProject = useMemo(
    () => projects.find(project => project.id === proposalProjectId) || null,
    [projects, proposalProjectId]
  );

  const closeProposalModal = useCallback(() => {
    if (loadingProjectId === proposalProjectId) {
      return;
    }
    setProposalProjectId(null);
    setPartnerProposalDraft(null);
  }, [loadingProjectId, proposalProjectId]);

  const handlePartnerProposalDraftChange = useCallback(
    <K extends keyof PartnerProposalDraft>(key: K, value: PartnerProposalDraft[K]) => {
      setPartnerProposalDraft(current => (current ? { ...current, [key]: value } : current));
    },
    []
  );

  const submitPartnerProposal = useCallback(async () => {
    if (!user || user.role !== 'partner' || !activeProposalProject || !partnerProposalDraft) {
      return;
    }

    const volunteersNeeded = Number(partnerProposalDraft.proposedVolunteersNeeded);
    if (
      !partnerProposalDraft.proposedTitle.trim() ||
      !partnerProposalDraft.proposedDescription.trim() ||
      !partnerProposalDraft.proposedStartDate.trim() ||
      !partnerProposalDraft.proposedEndDate.trim() ||
      !partnerProposalDraft.proposedLocation.trim() ||
      !partnerProposalDraft.communityNeed.trim() ||
      !partnerProposalDraft.expectedDeliverables.trim() ||
      Number.isNaN(volunteersNeeded) ||
      volunteersNeeded < 1
    ) {
      Alert.alert(
        'Incomplete Proposal',
        'Fill in the proposal title, description, dates, location, volunteers needed, community need, and expected deliverables.'
      );
      return;
    }

    try {
      setLoadingProjectId(activeProposalProject.id);
      const application = await submitPartnerProgramProposal(activeProposalProject.id, user, {
        programModule: activeProposalProject.programModule || activeProposalProject.category,
        proposalDetails: buildPartnerProposalDetails(activeProposalProject, partnerProposalDraft),
      });
      startTransition(() => {
        setPartnerApplications(prev => {
          const withoutCurrent = prev.filter(existing => existing.id !== application.id);
          return [application, ...withoutCurrent].sort(
            (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
          );
        });
      });
      setProposalProjectId(null);
      setPartnerProposalDraft(null);
      Alert.alert('Submitted', 'Your detailed project proposal has been sent to the admin for review.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to submit this request. Please try again.')
      );
    } finally {
      setLoadingProjectId(null);
    }
  }, [activeProposalProject, partnerProposalDraft, user]);

  // Starts a volunteer time log for the selected project.
  const handleTimeIn = async (projectId: string) => {
    if (!volunteerProfile) return;
    const project = projects.find(item => item.id === projectId) || null;
    if (!project) {
      Alert.alert('Event not found', 'Please try opening the event again.');
      return;
    }

    const projectStatus = getProjectDisplayStatus(project);
    if (projectStatus === 'Completed' || projectStatus === 'Cancelled') {
      Alert.alert('Event closed', 'Time in is only available while the event is still active.');
      return;
    }

    if (project.isEvent) {
      const startDate = project.startDate ? new Date(project.startDate) : null;
      if (startDate && !Number.isNaN(startDate.getTime()) && !hasEventStartedForToday(project.startDate)) {
        Alert.alert(
          'Event not started',
          `This event starts on ${format(startDate, 'MMM d')}. Please refresh once the event begins to time in.`
        );
        return;
      }

      const isAssignedToEventTask = (project.internalTasks || []).some(
        task => task.assignedVolunteerId === volunteerProfile.id
      );

      if (!isAssignedToEventTask) {
        Alert.alert(
          'Assignment Required',
          'You need to be assigned to an event task before you can time in.'
        );
        return;
      }
    }

    try {
      setLoadingProjectId(projectId);
      const createdLog = await startVolunteerTimeLog(volunteerProfile.id, projectId);
      startTransition(() => {
        setTimeLogs(prev =>
          [createdLog, ...prev.filter(log => log.id !== createdLog.id)].sort(
            (a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime()
          )
        );
      });
      Alert.alert('Time In recorded', 'Remember to time out when you finish.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, 'Unable to time in'),
        getRequestErrorMessage(error, 'Please try again.')
      );
    } finally {
      setLoadingProjectId(null);
    }
  };

  // Opens the group chat tied to the selected project or event.
  const handleOpenGroupChat = (projectId: string) => {
    navigateToAvailableRoute(navigation, 'Messages', { projectId });
  };

  const partnerApplicationByProjectId = useMemo(
    () => {
      const byProjectId = new Map<string, PartnerProjectApplication>();
      const byProgramModule = new Map<string, PartnerProjectApplication>();

      partnerApplications.forEach(application => {
        byProjectId.set(application.projectId, application);

        const requestedProgramModule = application.projectId.startsWith('program:')
          ? application.projectId.slice('program:'.length).trim()
          : '';
        if (requestedProgramModule) {
          byProgramModule.set(requestedProgramModule, application);
        }
      });

      return {
        byProjectId,
        byProgramModule,
      };
    },
    [partnerApplications]
  );

  const activeLogByProjectId = useMemo(
    () => new Map(timeLogs.filter(log => !log.timeOut).map(log => [log.projectId, log])),
    [timeLogs]
  );

  const latestLogByProjectId = useMemo(
    () => new Map(timeLogs.map(log => [log.projectId, log])),
    [timeLogs]
  );

  const volunteerJoinRecordByProjectId = useMemo(
    () => new Map(volunteerJoinRecords.map(record => [record.projectId, record])),
    [volunteerJoinRecords]
  );

  const volunteerMatchByProjectId = useMemo(
    () => new Map(volunteerMatches.map(match => [match.projectId, match])),
    [volunteerMatches]
  );

  const activeTimeOutProject = useMemo(
    () => projects.find(project => project.id === timeOutProjectId) || null,
    [projects, timeOutProjectId]
  );

  const visibleProjects = useMemo(() => {
    return projects
      .filter(project => (statusFilter === 'All' ? true : getProjectDisplayStatus(project) === statusFilter))
      .filter(project =>
        contentFilter === 'All'
          ? true
          : contentFilter === 'Programs'
          ? !project.isEvent
          : Boolean(project.isEvent)
      )
      .filter(project => {
        if (!deferredSearchQuery) {
          return true;
        }

        const searchableText = [
          project.title,
          project.description,
          project.location.address,
          project.category,
          project.programModule || '',
          project.isEvent ? 'event' : 'program',
          getProjectDisplayStatus(project),
        ]
          .join(' ')
          .toLowerCase();

        return searchableText.includes(deferredSearchQuery);
      })
      .sort((left, right) => {
        if (Boolean(left.isEvent) !== Boolean(right.isEvent)) {
          return Number(Boolean(left.isEvent)) - Number(Boolean(right.isEvent));
        }

        return new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
      });
  }, [contentFilter, deferredSearchQuery, projects, statusFilter]);

  const linkedEventsByProgramId = useMemo(() => {
    const map = new Map<string, Project[]>();

    visibleProjects
      .filter(project => project.isEvent && project.parentProjectId)
      .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime())
      .forEach(event => {
        const parentId = event.parentProjectId!;
        const current = map.get(parentId) || [];
        current.push(event);
        map.set(parentId, current);
      });

    return map;
  }, [visibleProjects]);

  // Groups projects by category
  const projectsByCategory = useMemo<ProjectCategoryGroup[]>(() => {
    const categories: Project['category'][] = ['Education', 'Livelihood', 'Nutrition', 'Disaster'];
    const groupedPrograms: Record<Project['category'], Project[]> = {
      Education: [],
      Livelihood: [],
      Nutrition: [],
      Disaster: [],
    };

    projects
      .filter(project => !project.isEvent)
      .forEach(project => {
        if (!groupedPrograms[project.category]) {
          return;
        }

        const programMatches = visibleProjects.some(visibleProject => visibleProject.id === project.id);
        const hasVisibleEvents = (linkedEventsByProgramId.get(project.id) || []).length > 0;
        const shouldInclude =
          contentFilter === 'Programs'
            ? programMatches
            : contentFilter === 'Events'
            ? hasVisibleEvents
            : programMatches || hasVisibleEvents;

        if (shouldInclude) {
          groupedPrograms[project.category].push(project);
        }
      });
    
    Object.values(groupedPrograms).forEach(group =>
      group.sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime())
    );

    return categories.map(category => {
      const categoryPrograms = groupedPrograms[category];
      const visibleEventCount = categoryPrograms.reduce(
        (count, project) => count + (linkedEventsByProgramId.get(project.id) || []).length,
        0
      );

      return {
        category,
        eventCount: visibleEventCount,
        programCount: categoryPrograms.length,
        projects: categoryPrograms,
      };
    }).filter(group => group.projects.length > 0);
  }, [contentFilter, linkedEventsByProgramId, projects, visibleProjects]);

  const categoryCount = projectsByCategory.length;
  const totalProgramCount = useMemo(
    () => projectsByCategory.reduce((count, group) => count + group.programCount, 0),
    [projectsByCategory]
  );
  const totalEventCount = useMemo(
    () => projectsByCategory.reduce((count, group) => count + group.eventCount, 0),
    [projectsByCategory]
  );
  const openVolunteerEventCount = useMemo(
    () =>
      Array.from(linkedEventsByProgramId.values())
        .flat()
        .filter(
          project =>
            getProjectDisplayStatus(project) !== 'Completed' &&
            getProjectDisplayStatus(project) !== 'Cancelled'
        ).length,
    [linkedEventsByProgramId]
  );

  const totalVisibleGroupItems = totalProgramCount + totalEventCount;

  const selectedCategoryGroup = useMemo(
    () => (selectedCategory ? projectsByCategory.find(group => group.category === selectedCategory) || null : null),
    [projectsByCategory, selectedCategory]
  );

  const selectedProgram = useMemo(
    () => projects.find(project => project.id === selectedProgramId && !project.isEvent) || null,
    [projects, selectedProgramId]
  );

  const selectedProgramEvents = useMemo(
    () => (selectedProgram ? linkedEventsByProgramId.get(selectedProgram.id) || [] : []),
    [linkedEventsByProgramId, selectedProgram]
  );

  const selectedEvent = useMemo(
    () => projects.find(project => project.id === selectedEventId && project.isEvent) || null,
    [projects, selectedEventId]
  );

  const isFieldOfficerForEvent = useCallback((event: Project) => {
    if (!volunteerProfile?.id || !event.isEvent) {
      return false;
    }

    return (event.internalTasks || []).some(
      task => task.isFieldOfficer && task.assignedVolunteerId === volunteerProfile.id
    );
  }, [volunteerProfile?.id]);

  const getAssignableVolunteersForEvent = useCallback((event: Project) => {
    return event.volunteers
      .map(volunteerId => allVolunteers.find(volunteer => volunteer.id === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [allVolunteers]);

  const handleAssignEventTask = useCallback(async (
    eventProject: Project,
    taskId: string,
    volunteerId?: string
  ) => {
    if (!isFieldOfficerForEvent(eventProject)) {
      Alert.alert('Access Restricted', 'Only the assigned field officer can manage volunteers in this event.');
      return;
    }

    try {
      const assignableVolunteers = getAssignableVolunteersForEvent(eventProject);
      const assignedVolunteer =
        volunteerId ? assignableVolunteers.find(volunteer => volunteer.id === volunteerId) || null : null;

      const updatedTasks = (eventProject.internalTasks || []).map(task => {
        if (task.id !== taskId) {
          return task;
        }

        if (task.isFieldOfficer) {
          return task;
        }

        const nextStatus =
          volunteerId && task.status === 'Unassigned'
            ? 'Assigned'
            : !volunteerId
            ? 'Unassigned'
            : task.status;

        return {
          ...task,
          assignedVolunteerId: volunteerId || undefined,
          assignedVolunteerName: assignedVolunteer?.name || undefined,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        };
      });

      await saveEvent({
        ...eventProject,
        internalTasks: updatedTasks,
        updatedAt: new Date().toISOString(),
      });

      void loadProjectsData();
      Alert.alert('Saved', 'Volunteer assignment updated for this event.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update the event assignment.')
      );
    }
  }, [getAssignableVolunteersForEvent, isFieldOfficerForEvent, loadProjectsData]);

  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projectsByCategory.length === 0) {
      return;
    }

    const targetCategoryIndex = projectsByCategory.findIndex(categoryGroup =>
      categoryGroup.projects.some(project => project.id === requestedProjectId)
    );
    if (targetCategoryIndex === -1) {
      return;
    }

    const targetCategory = projectsByCategory[targetCategoryIndex];
    if (!targetCategory) {
      return;
    }

    setExpandedProjectId(requestedProjectId);
    setExpandedCategories(prev => new Set(prev).add(targetCategory.category));
    requestAnimationFrame(() => {
      projectListRef.current?.scrollToIndex({
        index: targetCategoryIndex,
        animated: true,
        viewPosition: 0.15,
      });
    });
    navigation.setParams({ projectId: undefined });
  }, [navigation, projectsByCategory, route?.params?.projectId]);

  useEffect(() => {
    if (selectedCategory && !projectsByCategory.some(group => group.category === selectedCategory)) {
      setSelectedCategory(null);
      setSelectedProgramId(null);
      setSelectedEventId(null);
    }
  }, [projectsByCategory, selectedCategory]);

  useEffect(() => {
    if (selectedProgramId && !projects.some(project => project.id === selectedProgramId && !project.isEvent)) {
      setSelectedProgramId(null);
      setSelectedEventId(null);
    }
  }, [projects, selectedProgramId]);

  useEffect(() => {
    if (selectedEventId && !projects.some(project => project.id === selectedEventId && project.isEvent)) {
      setSelectedEventId(null);
    }
  }, [projects, selectedEventId]);

  // Toggle category expansion
  const toggleCategory = useCallback((category: Project['category']) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const expandAllCategories = useCallback(() => {
    setExpandedCategories(new Set(projectsByCategory.map(group => group.category)));
  }, [projectsByCategory]);

  const collapseAllCategories = useCallback(() => {
    setExpandedCategories(new Set());
  }, []);

  // Checks whether the current volunteer is already part of a project.
  const isJoined = useCallback((project: Project) => {
    if (!project.isEvent) {
      return false;
    }

    const joinedUsers = project.joinedUserIds || [];
    const volunteerId = volunteerProfile?.id;
    const isVolunteerAssigned = (project.internalTasks || []).some(
      task => task.assignedVolunteerId === volunteerId
    );
    
    return (
      (user?.id ? joinedUsers.includes(user.id) : false) ||
      (volunteerId ? project.volunteers.includes(volunteerId) : false) ||
      isVolunteerAssigned
    );
  }, [user?.id, volunteerProfile?.id]);

  const getVolunteerEventActionState = useCallback((project: Project) => {
    const displayStatus = getProjectDisplayStatus(project);
    const joined = isJoined(project);
    const joinRecord = volunteerJoinRecordByProjectId.get(project.id);
    const volunteerMatch = volunteerMatchByProjectId.get(project.id);
    const isAssigned = (project.internalTasks || []).some(
      task => task.assignedVolunteerId === volunteerProfile?.id
    );
    const completedParticipation = joinRecord?.participationStatus === 'Completed';
    const isPendingApproval = volunteerMatch?.status === 'Requested';
    const wasRejected = volunteerMatch?.status === 'Rejected';
    const isClosedStatus = displayStatus === 'Completed' || displayStatus === 'Cancelled';
    const isOnHold = displayStatus === 'On Hold';

    const startDate = project.startDate ? new Date(project.startDate) : null;
    const eventHasNotStarted = project.isEvent ? !hasEventStartedForToday(project.startDate) : false;
    const canTimeIn =
      isAssigned &&
      !completedParticipation &&
      !isPendingApproval &&
      !isClosedStatus &&
      !isOnHold &&
      !eventHasNotStarted;

    const joinButtonLabel = completedParticipation
      ? 'Task Completed'
      : joined
      ? isAssigned
        ? 'Assigned'
        : 'Approved'
      : isPendingApproval
      ? 'Pending Approval'
      : isClosedStatus
      ? displayStatus
      : isOnHold
      ? 'On Hold'
      : wasRejected
      ? 'Request Again'
      : 'Request to Join';

    const joinButtonIcon: keyof typeof MaterialIcons.glyphMap = completedParticipation
      ? 'task-alt'
      : joined
      ? 'check-circle'
      : isPendingApproval
      ? 'hourglass-empty'
      : isClosedStatus || isOnHold
      ? 'event-busy'
      : wasRejected
      ? 'refresh'
      : 'add-circle-outline';

    const statusMessage = completedParticipation
      ? 'You already completed this event.'
      : joined
      ? isAssigned
        ? eventHasNotStarted && startDate
          ? `Assigned. Time in becomes available on ${format(startDate, 'MMM d')}.`
          : 'Admin assigned you to this event. You can time in now.'
        : 'You are approved to join this event, but you need an assigned task before timing in.'
      : isPendingApproval
      ? 'Waiting for admin approval.'
      : isClosedStatus
      ? `This event is ${displayStatus.toLowerCase()}.`
      : isOnHold
      ? 'This event is currently on hold.'
      : wasRejected
      ? 'Your last request was rejected. You can submit again.'
      : 'Open for volunteer requests.';

    const isJoinDisabled =
      joined || completedParticipation || isPendingApproval || isClosedStatus || isOnHold;

    return {
      joined,
      joinButtonIcon,
      joinButtonLabel,
      completedParticipation,
      isJoinDisabled,
      isPendingApproval,
      isAssigned,
      canTimeIn,
      statusMessage,
      wasRejected,
      eventHasNotStarted,
    };
  }, [isJoined, volunteerJoinRecordByProjectId, volunteerMatchByProjectId, volunteerProfile?.id]);

  // Formats timestamps shown on time logs and project metadata.
  const formatTimestamp = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--';
    return format(parsed, 'MMM d, HH:mm');
  };

  const handleOpenProject = useCallback((projectId: string) => {
    if (user?.role === 'admin') {
      navigateToAvailableRoute(navigation, 'Lifecycle', { projectId }, {
        routeName: 'Projects',
        params: { projectId },
      });
      return;
    }

    setExpandedProjectId((current) => (current === projectId ? null : projectId));
  }, [navigation, user?.role]);

  const handleOpenImagePreview = useCallback((project: Project) => {
    const source = getPrimaryProjectImageSource(project);
    if (!source) {
      return;
    }

    setImagePreview({
      title: project.title,
      source,
    });
  }, []);

  const openTimeOutModal = useCallback((projectId: string) => {
    const activeLog = activeLogByProjectId.get(projectId);
    navigateToAvailableRoute(navigation, 'Reports', {
      projectId,
      autoOpenUpload: true,
      completionReport: activeLog?.completionReport,
      completionPhoto: activeLog?.completionPhoto,
    });
  }, [activeLogByProjectId, navigation]);

  const closeTimeOutModal = useCallback(() => {
    if (loadingProjectId === timeOutProjectId && timeOutProjectId) {
      return;
    }

    setTimeOutProjectId(null);
    setTimeOutReportDraft('');
    setTimeOutPhotoDraft('');
  }, [loadingProjectId, timeOutProjectId]);

  const handlePickTimeOutPhoto = useCallback(async () => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }

      setTimeOutPhotoDraft(pickedImage);
    } catch (error: any) {
      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');
    }
  }, []);

  const handleOpenCategory = useCallback((category: Project['category']) => {
    setSelectedCategory(category);
    setSelectedProgramId(null);
    setSelectedEventId(null);
  }, []);

  const handleOpenProgramDetails = useCallback((projectId: string) => {
    setSelectedProgramId(projectId);
    setSelectedEventId(null);
  }, []);

  const handleOpenEventDetails = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
  }, []);

  const handleMobileBack = useCallback(() => {
    if (selectedEventId) {
      setSelectedEventId(null);
      return;
    }

    if (selectedProgramId) {
      setSelectedProgramId(null);
      return;
    }

    if (selectedCategory) {
      setSelectedCategory(null);
    }
  }, [selectedCategory, selectedEventId, selectedProgramId]);

  // Renders a single project card with role-specific actions.
  const renderProjectItem = useCallback(({ item }: { item: Project }) => {
          const suggestion = getProjectSuggestion(item, volunteerProfile);
          const eventActionState = item.isEvent ? getVolunteerEventActionState(item) : null;
          const joined = eventActionState?.joined || false;
          const activeLog = activeLogByProjectId.get(item.id);
          const latestLog = latestLogByProjectId.get(item.id);
          const joinRecord = volunteerJoinRecordByProjectId.get(item.id);
          const completedParticipation = eventActionState?.completedParticipation || false;
          const isExpanded = expandedProjectId === item.id;
          const linkedEvents = !item.isEvent ? linkedEventsByProgramId.get(item.id) || [] : [];
          const dateSummary = formatProjectDateRange(item.startDate, item.endDate);
          const locationSummary = item.location.address || 'Location to be announced';
          const partnerApplication =
            partnerApplicationByProjectId.byProjectId.get(item.id) ||
            partnerApplicationByProjectId.byProgramModule.get(item.programModule || item.category) ||
            partnerApplicationByProjectId.byProjectId.get(buildProgramProposalProjectId(item.programModule || item.category));
          const isPendingApproval = eventActionState?.isPendingApproval || false;
          const wasRejected = eventActionState?.wasRejected || false;
          const joinButtonLabel = item.isEvent && eventActionState ? eventActionState.joinButtonLabel : 'Open Event';
          const joinButtonIcon = item.isEvent && eventActionState ? eventActionState.joinButtonIcon : 'add-circle-outline';
          const suggestionReasonText = formatSuggestionReasons(suggestion.reasons);
          const aboutSectionTitle = item.isEvent ? 'About this event' : 'About this program';
          const activitySummary = item.isEvent
            ? getEventAvailabilitySummary(item)
            : `${linkedEvents.length} linked event${linkedEvents.length === 1 ? '' : 's'}`;

          return (
            <View style={styles.card}>
              <ProjectCardImage
                project={item}
                onPress={() => handleOpenImagePreview(item)}
              />

              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{item.title}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.category}>{item.category}</Text>
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>
                        {item.isEvent ? 'Event' : 'Program'}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.recommendationBadge}>
                  <Text style={styles.recommendationLabel}>{suggestion.label}</Text>
                </View>
              </View>

              <View style={styles.cardQuickFacts}>
                <View style={styles.cardQuickFact}>
                  <MaterialIcons name="event" size={15} color="#166534" />
                  <Text style={styles.cardQuickFactText} numberOfLines={1}>
                    {dateSummary}
                  </Text>
                </View>
                <View style={styles.cardQuickFact}>
                  <MaterialIcons name="place" size={15} color="#0f766e" />
                  <Text style={styles.cardQuickFactText} numberOfLines={1}>
                    {locationSummary}
                  </Text>
                </View>
                <View style={styles.cardQuickFact}>
                  <MaterialIcons
                    name={item.isEvent ? 'people-alt' : 'event-note'}
                    size={15}
                    color="#4338ca"
                  />
                  <Text style={styles.cardQuickFactText} numberOfLines={1}>
                    {activitySummary}
                  </Text>
                </View>
              </View>

              <Text style={styles.cardSectionLabel}>{aboutSectionTitle}</Text>
              <Text style={styles.description} numberOfLines={isExpanded ? undefined : 3}>
                {item.description}
              </Text>

              {user?.role === 'volunteer' ? (
                <View style={styles.cardInsightWrap}>
                  <View style={styles.volunteerInsightCard}>
                    <Text style={styles.volunteerInsightLabel}>
                      {item.isEvent ? 'Why this event may fit you' : 'Why this program may fit you'}
                    </Text>
                    <Text style={styles.volunteerInsightText}>{suggestionReasonText}</Text>
                  </View>
                </View>
              ) : null}

              <Pressable
                style={styles.expandToggle}
                onPress={() =>
                  setExpandedProjectId((current) => (current === item.id ? null : item.id))
                }
              >
                <Text style={styles.expandToggleText}>
                  {isExpanded ? 'Hide details' : 'Show details'}
                </Text>
                <MaterialIcons
                  name={isExpanded ? 'expand-less' : 'expand-more'}
                  size={18}
                  color="#166534"
                />
              </Pressable>

              {isExpanded && (
                <View style={styles.expandedSection}>
                  {item.isEvent ? (
                    <>
                      <View style={styles.expandedRow}>
                        <MaterialIcons name="campaign" size={18} color="#7c3aed" />
                        <View style={styles.expandedTextWrap}>
                          <Text style={styles.expandedLabel}>Event type</Text>
                          <Text style={styles.expandedValue}>{item.programModule || item.category}</Text>
                        </View>
                      </View>
                      <View style={styles.expandedRow}>
                        <MaterialIcons name="place" size={18} color="#f97316" />
                        <View style={styles.expandedTextWrap}>
                          <Text style={styles.expandedLabel}>Venue</Text>
                          <Text style={styles.expandedValue}>{item.location.address}</Text>
                        </View>
                      </View>
                      <View style={styles.expandedRow}>
                        <MaterialIcons name="event-available" size={18} color="#2563eb" />
                        <View style={styles.expandedTextWrap}>
                          <Text style={styles.expandedLabel}>Event day</Text>
                          <Text style={styles.expandedValue}>{format(new Date(item.startDate), 'MMM d, yyyy')}</Text>
                        </View>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.expandedRow}>
                        <MaterialIcons name="place" size={18} color="#f97316" />
                        <View style={styles.expandedTextWrap}>
                          <Text style={styles.expandedLabel}>Location</Text>
                          <Text style={styles.expandedValue}>{item.location.address}</Text>
                        </View>
                      </View>
                      <View style={styles.expandedRow}>
                        <MaterialIcons name="event" size={18} color="#2563eb" />
                        <View style={styles.expandedTextWrap}>
                          <Text style={styles.expandedLabel}>Schedule</Text>
                          <Text style={styles.expandedValue}>
                            {`${format(new Date(item.startDate), 'MMM d, yyyy')} - ${format(
                              new Date(item.endDate),
                              'MMM d, yyyy'
                            )}`}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.expandedRow}>
                        <MaterialIcons name="info" size={18} color="#16a34a" />
                        <View style={styles.expandedTextWrap}>
                          <Text style={styles.expandedLabel}>Suggested because</Text>
                          <Text style={styles.expandedValue}>{suggestionReasonText}</Text>
                        </View>
                      </View>
                    </>
                  )}
                </View>
              )}

              {!item.isEvent && isExpanded ? (
                <View style={styles.projectEventsPanel}>
                  <View style={styles.projectEventsPanelHeader}>
                    <Text style={styles.projectEventsPanelTitle}>Events Inside This Project</Text>
                    <Text style={styles.projectEventsPanelMeta}>
                      {linkedEvents.length} event{linkedEvents.length === 1 ? '' : 's'}
                    </Text>
                  </View>

                  {linkedEvents.length ? (
                    linkedEvents.map(event => {
                      const linkedEventAction = getVolunteerEventActionState(event);
                      const eventJoined = linkedEventAction.joined;
                      const eventCompleted = linkedEventAction.completedParticipation;
                      const eventLifecycleStatus = getProjectDisplayStatus(event);
                      const eventIsClosed = eventLifecycleStatus === 'Completed' || eventLifecycleStatus === 'Cancelled';
                      const eventJoinRecord = volunteerJoinRecordByProjectId.get(event.id);
                      const eventActiveLog = activeLogByProjectId.get(event.id);
                      const eventLatestLog = latestLogByProjectId.get(event.id);
                      const eventExpanded = expandedEventId === event.id;
                      const eventFieldOfficer = isFieldOfficerForEvent(event);
                      const assignableVolunteers = getAssignableVolunteersForEvent(event);
                      const assignableTasks = (event.internalTasks || []).filter(task => !task.isFieldOfficer);

                      return (
                        <View key={event.id} style={styles.nestedEventCard}>
                          <TouchableOpacity
                            style={styles.nestedEventHeader}
                            activeOpacity={0.86}
                            onPress={() =>
                              setExpandedEventId(current => (current === event.id ? null : event.id))
                            }
                          >
                            <View style={styles.nestedEventHeaderCopy}>
                              <View style={styles.nestedEventTitleRow}>
                                <Text style={styles.nestedEventTitle}>{event.title}</Text>
                                <View style={styles.nestedEventTypeBadge}>
                                  <Text style={styles.nestedEventTypeBadgeText}>Event</Text>
                                </View>
                              </View>
                              <Text style={styles.nestedEventMeta}>
                                {formatProjectDateRange(event.startDate, event.endDate)}
                              </Text>
                              <Text style={styles.nestedEventMeta}>{event.location.address}</Text>
                              <Text style={styles.nestedEventStatus}>{linkedEventAction.statusMessage}</Text>
                            </View>
                            <MaterialIcons
                              name={eventExpanded ? 'expand-less' : 'expand-more'}
                              size={20}
                              color="#166534"
                            />
                          </TouchableOpacity>

                          <View style={styles.nestedEventSummaryRow}>
                            <Text style={styles.nestedEventSummaryText}>
                              {event.volunteers.length}/{event.volunteersNeeded} volunteers
                            </Text>
                            <Text style={styles.nestedEventSummaryText}>{getProjectDisplayStatus(event)}</Text>
                          </View>

                          {user?.role === 'volunteer' ? (
                            <View style={styles.nestedEventActionBlock}>
                              <View style={styles.joinRow}>
                                <TouchableOpacity
                                  style={[
                                    styles.joinButton,
                                    eventCompleted
                                      ? styles.joinButtonCompleted
                                      : (eventJoined || linkedEventAction.isPendingApproval) && styles.joinButtonJoined,
                                    loadingProjectId === event.id && styles.joinButtonLoading,
                                  ]}
                                  disabled={linkedEventAction.isJoinDisabled || loadingProjectId === event.id}
                                  onPress={() => handleJoinProject(event.id)}
                                >
                                  <MaterialIcons
                                    name={linkedEventAction.joinButtonIcon}
                                    size={18}
                                    color={
                                      eventCompleted
                                        ? '#166534'
                                        : eventJoined || linkedEventAction.isPendingApproval
                                        ? '#155724'
                                        : '#fff'
                                    }
                                  />
                                  <Text
                                    style={[
                                      styles.joinButtonText,
                                      eventCompleted
                                        ? styles.joinButtonTextCompleted
                                        : (eventJoined || linkedEventAction.isPendingApproval) && styles.joinButtonTextJoined,
                                    ]}
                                  >
                                    {loadingProjectId === event.id ? 'Sending...' : linkedEventAction.joinButtonLabel}
                                  </Text>
                                </TouchableOpacity>

                                {eventJoined && (eventActiveLog || (!eventCompleted && !eventIsClosed)) ? (
                                  <TouchableOpacity
                                    style={[
                                      styles.timeButton,
                                      eventActiveLog ? styles.timeOutButton : styles.timeInButton,
                                      (!eventActiveLog && !linkedEventAction.canTimeIn) || linkedEventAction.eventHasNotStarted ? styles.timeButtonDisabled : null,
                                    ]}
                                    onPress={() => {
                                      if (eventActiveLog) {
                                        return openTimeOutModal(event.id);
                                      }

                                      if (linkedEventAction.eventHasNotStarted) {
                                        const startDate = event.startDate ? new Date(event.startDate) : null;
                                        return Alert.alert(
                                          'Event not started',
                                          startDate
                                            ? `This event starts on ${format(startDate, 'MMM d')}. Time in will be available then.`
                                            : 'This event has not started yet. Please refresh when the event begins.'
                                        );
                                      }

                                      if (linkedEventAction.canTimeIn) {
                                        return handleTimeIn(event.id);
                                      }

                                      if (linkedEventAction.isAssigned && eventLifecycleStatus === 'Planning') {
                                        const startDate = event.startDate ? new Date(event.startDate) : null;
                                        return Alert.alert(
                                          'Not started yet',
                                          startDate
                                            ? `This event starts on ${format(startDate, 'MMM d')}. Time in will be available then.`
                                            : 'This event has not started yet. Please refresh when the event begins.'
                                        );
                                      }

                                      return Alert.alert(
                                        'Assignment Required',
                                        'You need to be assigned to an event task before you can time in.'
                                      );
                                    }}
                                    disabled={
                                      loadingProjectId === event.id ||
                                      (!eventActiveLog && !linkedEventAction.canTimeIn && !linkedEventAction.eventHasNotStarted) ||
                                      linkedEventAction.eventHasNotStarted
                                    }
                                  >
                                    <MaterialIcons
                                      name={
                                        eventActiveLog
                                          ? 'logout'
                                          : linkedEventAction.canTimeIn
                                          ? 'login'
                                          : 'lock'
                                      }
                                      size={16}
                                      color="#fff"
                                    />
                                    <Text style={styles.timeButtonText}>
                                      {eventActiveLog
                                        ? 'Time Out'
                                        : linkedEventAction.canTimeIn
                                        ? 'Time In'
                                        : linkedEventAction.eventHasNotStarted
                                        ? 'Await Start'
                                        : eventLifecycleStatus === 'Planning' && linkedEventAction.isAssigned
                                        ? 'Await Start'
                                        : 'Await Assignment'}
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>

                                {eventJoined ? (
                                <TouchableOpacity
                                  style={styles.groupChatButton}
                                  onPress={() => handleOpenGroupChat(event.id)}
                                >
                                  <MaterialIcons name="groups" size={16} color="#166534" />
                                  <Text style={styles.groupChatButtonText}>Open Group Chat</Text>
                                </TouchableOpacity>
                              ) : null}

                              {(linkedEventAction.isPendingApproval || linkedEventAction.wasRejected) && !eventJoined ? (
                                <View style={styles.logMeta}>
                                  <Text style={styles.logMetaLabel}>Request status</Text>
                                  <Text style={styles.logMetaValue}>{linkedEventAction.statusMessage}</Text>
                                </View>
                              ) : null}

                              {eventJoined ? (
                                <>
                                  <View style={styles.logMeta}>
                                    <Text style={styles.logMetaLabel}>Participation status</Text>
                                    <Text style={styles.logMetaValue}>
                                      {eventCompleted
                                        ? eventJoinRecord?.completedAt
                                          ? `Completed ${formatTimestamp(eventJoinRecord.completedAt)}`
                                          : 'Completed and saved to profile'
                                        : 'Joined'}
                                    </Text>
                                  </View>

                                  <View style={styles.logMeta}>
                                    <Text style={styles.logMetaLabel}>
                                      {eventActiveLog ? 'Active since' : 'Last log'}
                                    </Text>
                                    <Text style={styles.logMetaValue}>
                                      {eventActiveLog
                                        ? formatTimestamp(eventActiveLog.timeIn)
                                        : eventLatestLog
                                        ? `${formatTimestamp(eventLatestLog.timeIn)} -> ${formatTimestamp(eventLatestLog.timeOut)}`
                                        : 'No logs yet'}
                                    </Text>
                                  </View>
                                </>
                              ) : null}
                            </View>
                          ) : user?.role === 'partner' ? (
                            <View style={styles.nestedEventActionBlock}>
                              <TouchableOpacity
                                style={[
                                  styles.joinButton,
                                  loadingProjectId === event.id && styles.joinButtonLoading,
                                ]}
                                disabled={loadingProjectId === event.id}
                                onPress={() => handleJoinProject(event.id)}
                              >
                                <MaterialIcons name="campaign" size={18} color="#fff" />
                                <Text style={styles.joinButtonText}>Submit Proposal</Text>
                              </TouchableOpacity>
                            </View>
                          ) : user?.role === 'admin' ? (
                            <View style={styles.nestedEventActionBlock}>
                              <TouchableOpacity
                                style={styles.openProgramButton}
                                onPress={() => handleOpenProject(event.id)}
                              >
                                <MaterialIcons name="folder-open" size={18} color="#fff" />
                                <Text style={styles.openProgramButtonText}>Open Event</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}

                          {eventExpanded ? (
                            <View style={styles.nestedEventExpandedSection}>
                              <Text style={styles.nestedEventDescription}>{event.description}</Text>

                              {eventFieldOfficer ? (
                                <View style={styles.fieldOfficerInlineCard}>
                                  <View style={styles.fieldOfficerInlineHeader}>
                                    <Text style={styles.fieldOfficerInlineTitle}>Field Officer Controls</Text>
                                    <Text style={styles.fieldOfficerInlineMeta}>
                                      {assignableVolunteers.length} volunteer{assignableVolunteers.length === 1 ? '' : 's'}
                                    </Text>
                                  </View>
                                  <Text style={styles.fieldOfficerInlineText}>
                                    Assign joined volunteers to event tasks here. Field officer role tasks stay locked for admin control.
                                  </Text>

                                  {assignableTasks.length ? (
                                    assignableTasks.map(task => (
                                      <View key={task.id} style={styles.fieldOfficerTaskCard}>
                                        <Text style={styles.fieldOfficerTaskTitle}>{task.title}</Text>
                                        <Text style={styles.fieldOfficerTaskMeta}>
                                          {task.assignedVolunteerName || 'Unassigned'} | {task.status}
                                        </Text>
                                        <View style={styles.assignmentChipRow}>
                                          <TouchableOpacity
                                            style={styles.assignmentChip}
                                            onPress={() => void handleAssignEventTask(event, task.id)}
                                          >
                                            <Text style={styles.assignmentChipText}>Unassign</Text>
                                          </TouchableOpacity>
                                          {assignableVolunteers.map(volunteer => (
                                            <TouchableOpacity
                                              key={`${task.id}-${volunteer.id}`}
                                              style={[
                                                styles.assignmentChip,
                                                task.assignedVolunteerId === volunteer.id && styles.assignmentChipActive,
                                              ]}
                                              onPress={() => void handleAssignEventTask(event, task.id, volunteer.id)}
                                            >
                                              <Text
                                                style={[
                                                  styles.assignmentChipText,
                                                  task.assignedVolunteerId === volunteer.id && styles.assignmentChipTextActive,
                                                ]}
                                              >
                                                {volunteer.name}
                                              </Text>
                                            </TouchableOpacity>
                                          ))}
                                        </View>
                                      </View>
                                    ))
                                  ) : (
                                    <View style={styles.logMeta}>
                                      <Text style={styles.logMetaLabel}>Assignment board</Text>
                                      <Text style={styles.logMetaValue}>No assignable event tasks yet.</Text>
                                    </View>
                                  )}
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  ) : (
                    <View style={styles.logMeta}>
                      <Text style={styles.logMetaLabel}>Events</Text>
                      <Text style={styles.logMetaValue}>
                        No events are linked to this project yet.
                      </Text>
                    </View>
                  )}
                </View>
              ) : null}

              {user?.role === 'volunteer' && item.isEvent && (
                <View style={styles.volunteerActions}>
                  {!joined && !isPendingApproval && !completedParticipation ? (
                    <Text style={styles.volunteerActionHint}>
                      Request to join first. Time In and Time Out appear after approval.
                    </Text>
                  ) : null}

                  {item.isEvent ? (
                    <>
                      <View style={styles.joinRow}>
                        <TouchableOpacity
                          style={[
                            styles.joinButton,
                            completedParticipation
                              ? styles.joinButtonCompleted
                              : (joined || isPendingApproval) && styles.joinButtonJoined,
                            loadingProjectId === item.id && styles.joinButtonLoading,
                          ]}
                          disabled={Boolean(eventActionState?.isJoinDisabled) || loadingProjectId === item.id}
                          onPress={() => handleJoinProject(item.id)}
                        >
                          <MaterialIcons
                            name={joinButtonIcon}
                            size={18}
                            color={
                              completedParticipation
                                ? '#166534'
                                : joined || isPendingApproval
                                ? '#155724'
                                : '#fff'
                            }
                          />
                          <Text
                            style={[
                              styles.joinButtonText,
                              completedParticipation
                                ? styles.joinButtonTextCompleted
                                : (joined || isPendingApproval) && styles.joinButtonTextJoined,
                            ]}
                          >
                            {joinButtonLabel}
                          </Text>
                        </TouchableOpacity>

                        {joined && !completedParticipation && (
                          <TouchableOpacity
                            style={[
                              styles.timeButton,
                              activeLog ? styles.timeOutButton : styles.timeInButton,
                              (!activeLog && item.isEvent && !eventActionState?.isAssigned) || eventActionState?.eventHasNotStarted ? styles.timeButtonDisabled : null,
                            ]}
                            onPress={() => {
                              if (eventActionState?.eventHasNotStarted) {
                                const startDate = item.startDate ? new Date(item.startDate) : null;
                                return Alert.alert(
                                  'Event not started',
                                  startDate
                                    ? `This event starts on ${format(startDate, 'MMM d')}. Time in will be available then.`
                                    : 'This event has not started yet. Please refresh when the event begins.'
                                );
                              }

                              if (activeLog) {
                                return openTimeOutModal(item.id);
                              }

                              if (item.isEvent && !eventActionState?.isAssigned) {
                                return Alert.alert(
                                  'Assignment Required',
                                  'You need to be assigned to an event task before you can time in.'
                                );
                              }

                              return handleTimeIn(item.id);
                            }}
                            disabled={loadingProjectId === item.id || ((!activeLog && item.isEvent && !eventActionState?.isAssigned) || eventActionState?.eventHasNotStarted) && !activeLog}
                          >
                            <MaterialIcons
                              name={activeLog ? 'logout' : item.isEvent && !eventActionState?.isAssigned ? 'lock' : 'login'}
                              size={16}
                              color="#fff"
                            />
                            <Text style={styles.timeButtonText}>
                              {activeLog ? 'Time Out' : eventActionState?.eventHasNotStarted ? 'Await Start' : item.isEvent && !eventActionState?.isAssigned ? 'Await Assignment' : 'Time In'}
                            </Text>
                          </TouchableOpacity>
                        )}

                        {joined && !completedParticipation && eventActionState?.eventHasNotStarted && (
                          <View style={styles.logMeta}>
                            <Text style={styles.logMetaLabel}>Time in availability</Text>
                            <Text style={styles.logMetaValue}>
                              {item.startDate ? `Available from ${format(new Date(item.startDate), 'MMM d')}` : 'Awaiting event start'}
                            </Text>
                          </View>
                        )}
                      </View>

                      {(isPendingApproval || wasRejected) && !joined && (
                        <View style={styles.logMeta}>
                          <Text style={styles.logMetaLabel}>Request status</Text>
                          <Text style={styles.logMetaValue}>
                            {eventActionState?.statusMessage || 'Request status unavailable.'}
                          </Text>
                        </View>
                      )}

                      {joined ? (
                        <>
                          <TouchableOpacity
                            style={styles.groupChatButton}
                            onPress={() => handleOpenGroupChat(item.id)}
                          >
                            <MaterialIcons name="groups" size={16} color="#166534" />
                            <Text style={styles.groupChatButtonText}>Open Group Chat</Text>
                          </TouchableOpacity>

                          <View style={styles.logMeta}>
                            <Text style={styles.logMetaLabel}>Participation status</Text>
                            <Text style={styles.logMetaValue}>
                              {completedParticipation
                                ? joinRecord?.completedAt
                                  ? `Completed ${formatTimestamp(joinRecord.completedAt)}`
                                  : 'Completed and saved to profile'
                                : isPendingApproval
                                ? 'Waiting for admin approval'
                                : wasRejected
                                ? 'Request rejected by admin'
                                : 'Joined'}
                            </Text>
                          </View>

                          <View style={styles.logMeta}>
                            <Text style={styles.logMetaLabel}>
                              {activeLog ? 'Active since' : 'Last log'}
                            </Text>
                            <Text style={styles.logMetaValue}>
                              {activeLog
                                ? formatTimestamp(activeLog.timeIn)
                                : latestLog
                                ? `${formatTimestamp(latestLog.timeIn)} -> ${formatTimestamp(latestLog.timeOut)}`
                                : 'No logs yet'}
                            </Text>
                          </View>

                          {activeLog ? (
                            <View style={styles.proofReminderCard}>
                              <MaterialIcons name="verified" size={16} color="#b45309" />
                              <Text style={styles.proofReminderText}>
                                Tap Time Out to open My Event Reports. Submitting the report will finalize your timeout.
                              </Text>
                            </View>
                          ) : latestLog?.completionPhoto || latestLog?.completionReport ? (
                            <View style={styles.logMeta}>
                              <Text style={styles.logMetaLabel}>Completion proof</Text>
                              <Text style={styles.logMetaValue}>{getCompletionProofSummary(latestLog)}</Text>
                              {latestLog.completionReport ? (
                                <Text style={styles.proofReportText}>{latestLog.completionReport}</Text>
                              ) : null}
                            </View>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </View>
              )}

              {user?.role === 'partner' && (
                <View style={styles.partnerActions}>
                  <Text style={styles.matchReason}>
                    Partner orgs can submit a project proposal for admin approval.
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.joinButton,
                      partnerApplication && styles.joinButtonJoined,
                      loadingProjectId === item.id && styles.joinButtonLoading,
                    ]}
                    disabled={!!partnerApplication || loadingProjectId === item.id}
                    onPress={() => handleJoinProject(item.id)}
                  >
                    <MaterialIcons
                      name={partnerApplication ? 'hourglass-empty' : 'campaign'}
                      size={18}
                      color={partnerApplication ? '#155724' : '#fff'}
                    />
                    <Text
                      style={[
                        styles.joinButtonText,
                        partnerApplication && styles.joinButtonTextJoined,
                      ]}
                    >
                      {partnerApplication?.status === 'Pending'
                        ? 'Proposal Pending'
                        : partnerApplication?.status === 'Rejected'
                        ? 'Proposal Rejected'
                        : partnerApplication?.status === 'Approved'
                        ? 'Proposal Approved'
                        : 'Submit Proposal'}
                    </Text>
                  </TouchableOpacity>
                  {partnerApplication && (
                    <>
                      <Text style={styles.partnerNote}>
                        {partnerApplication?.status === 'Pending'
                          ? 'Your project proposal is pending admin approval.'
                          : partnerApplication?.status === 'Approved'
                          ? 'Your project proposal was approved by the admin and is now shown in Projects.'
                          : 'This proposal was rejected by the admin.'}
                      </Text>

                    </>
                  )}
                </View>
              )}

              {user?.role === 'admin' && (
                <View style={styles.adminActions}>
                  <Text style={styles.matchReason}>
                    Open this program to review participants, update status, and manage completion.
                  </Text>
                  <TouchableOpacity
                    style={styles.openProgramButton}
                    onPress={() => handleOpenProject(item.id)}
                  >
                    <MaterialIcons name="folder-open" size={18} color="#fff" />
                    <Text style={styles.openProgramButtonText}>Open Program</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.footer}>
                <View style={styles.statusBadge}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getProjectStatusColor(item) },
                    ]}
                  />
                  <Text style={styles.status}>{getProjectDisplayStatus(item)}</Text>
                </View>
                <Text style={styles.volunteers}>
                  {item.isEvent
                    ? `${item.volunteers.length}/${item.volunteersNeeded} volunteers`
                    : `${linkedEvents.length} linked event${linkedEvents.length === 1 ? '' : 's'}`}
                </Text>
              </View>
            </View>
          );
        }, [
          activeLogByProjectId,
          allVolunteers,
          expandedEventId,
          expandedProjectId,
          getVolunteerEventActionState,
          getAssignableVolunteersForEvent,
          handleAssignEventTask,
          handleJoinProject,
          handleOpenGroupChat,
          handleTimeIn,
          latestLogByProjectId,
          linkedEventsByProgramId,
          loadingProjectId,
          partnerApplicationByProjectId,
          handleOpenImagePreview,
          handleOpenProject,
          isFieldOfficerForEvent,
          openTimeOutModal,
          user,
          volunteerJoinRecordByProjectId,
          volunteerProfile,
        ]);

  // Ends the active volunteer time log after proof-of-work is submitted.
  const handleTimeOut = async (projectId: string) => {
    if (!volunteerProfile) return;

    const completionReport = timeOutReportDraft.trim();
    const completionPhoto = timeOutPhotoDraft.trim();

    if (!completionReport) {
      Alert.alert('Report Required', 'Submit your completion report before timing out.');
      return;
    }

    if (!completionPhoto) {
      Alert.alert('Photo Required', 'Upload a completion photo before timing out.');
      return;
    }

    try {
      setLoadingProjectId(projectId);
      const result = await endVolunteerTimeLog(
        volunteerProfile.id,
        projectId,
        completionReport || undefined,
        completionPhoto || undefined
      );
      if (!result.log) {
        Alert.alert('No active log', 'Please tap Time In before timing out.');
        return;
      }

      let autoSubmittedReport = false;
      try {
        if (user?.id) {
          await submitVolunteerTimeOutReport({
            projectId,
            projectTitle:
              projects.find(project => project.id === projectId)?.title ||
              activeTimeOutProject?.title,
            volunteerUserId: user.id,
            volunteerName: user.name || volunteerProfile.name,
            completionLog: result.log,
          });
          autoSubmittedReport = true;
        }
      } catch (reportError) {
        console.error('Error auto-submitting volunteer timeout report:', reportError);
      }

      startTransition(() => {
        setTimeLogs(prev =>
          prev
            .map(log => (log.id === result.log?.id ? result.log : log))
            .sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime())
        );
        if (result.volunteerProfile) {
          setVolunteerProfile(result.volunteerProfile);
        }
      });
      setTimeOutProjectId(null);
      setTimeOutReportDraft('');
      setTimeOutPhotoDraft('');
      navigateToAvailableRoute(navigation, 'Reports', {
        projectId,
        autoOpenUpload: true,
        completionReport,
        completionPhoto,
      });
      Alert.alert('Time Out recorded', 'Your hours were added and you can now submit your event report.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, 'Unable to time out'),
        getRequestErrorMessage(error, 'Please try again.')
      );
    } finally {
      setLoadingProjectId(null);
    }
  };

  const hasTimeOutPhoto = Boolean(timeOutPhotoDraft.trim());
  const hasTimeOutReport = Boolean(timeOutReportDraft.trim());
  const hasTimeOutSubmissionRequirements = hasTimeOutPhoto && hasTimeOutReport;
  const selectedEventActionState = selectedEvent ? getVolunteerEventActionState(selectedEvent) : null;
  const selectedEventJoinRecord = selectedEvent ? volunteerJoinRecordByProjectId.get(selectedEvent.id) : undefined;
  const selectedEventActiveLog = selectedEvent ? activeLogByProjectId.get(selectedEvent.id) : undefined;
  const selectedEventLatestLog = selectedEvent ? latestLogByProjectId.get(selectedEvent.id) : undefined;
  const selectedEventLifecycleStatus = selectedEvent ? getProjectDisplayStatus(selectedEvent) : null;
  const selectedEventFieldOfficer = selectedEvent ? isFieldOfficerForEvent(selectedEvent) : false;
  const selectedEventAssignableVolunteers = selectedEvent ? getAssignableVolunteersForEvent(selectedEvent) : [];
  const selectedEventAssignableTasks = selectedEvent
    ? (selectedEvent.internalTasks || []).filter(task => !task.isFieldOfficer)
    : [];

  return (
    <View style={styles.container}>
      {isDesktop ? (
        <>
          <View style={styles.topPanel}>
            <View style={styles.heroCard}>
              <View style={styles.heroEyebrow}>
                <MaterialIcons name="dashboard-customize" size={14} color="#166534" />
                <Text style={styles.heroEyebrowText}>Projects Workspace</Text>
              </View>
              <Text style={styles.heading}>Programs and Projects</Text>
              <Text style={styles.subheading}>
                {user?.role === 'volunteer'
                  ? 'Browse by category, open a program, then choose the event you want to join.'
                  : user?.role === 'partner'
                  ? 'Review active programs, narrow the list quickly, and open the right workspace with less scrolling.'
                  : 'Track programs, events, and participation with a clearer operations view.'}
              </Text>

              <View style={styles.overviewRow}>
                <View style={styles.overviewCard}>
                  <Text style={styles.overviewValue}>{totalVisibleGroupItems}</Text>
                  <Text style={styles.overviewLabel}>visible items</Text>
                </View>
                <View style={styles.overviewCard}>
                  <Text style={styles.overviewValue}>{totalProgramCount}</Text>
                  <Text style={styles.overviewLabel}>programs</Text>
                </View>
                <View style={styles.overviewCard}>
                  <Text style={styles.overviewValue}>{totalEventCount}</Text>
                  <Text style={styles.overviewLabel}>events</Text>
                </View>
                <View style={styles.overviewCard}>
                  <Text style={styles.overviewValue}>
                    {user?.role === 'volunteer' ? openVolunteerEventCount : categoryCount}
                  </Text>
                  <Text style={styles.overviewLabel}>
                    {user?.role === 'volunteer' ? 'open events' : 'categories'}
                  </Text>
                </View>
              </View>

              {user?.role === 'volunteer' ? (
                <View style={styles.volunteerGuideCard}>
                  <Text style={styles.volunteerGuideTitle}>Simple way to use this page</Text>
                  <View style={styles.volunteerGuideSteps}>
                    <View style={styles.volunteerGuideStep}>
                      <Text style={styles.volunteerGuideStepNumber}>1</Text>
                      <Text style={styles.volunteerGuideStepText}>Pick a program category</Text>
                    </View>
                    <View style={styles.volunteerGuideStep}>
                      <Text style={styles.volunteerGuideStepNumber}>2</Text>
                      <Text style={styles.volunteerGuideStepText}>Open a program to see its events</Text>
                    </View>
                    <View style={styles.volunteerGuideStep}>
                      <Text style={styles.volunteerGuideStepNumber}>3</Text>
                      <Text style={styles.volunteerGuideStepText}>Request to join, then time in after approval</Text>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.controlsCard}>
              <View style={styles.searchRow}>
                <MaterialIcons name="search" size={18} color="#64748b" />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search a program, event, place, or status"
                  placeholderTextColor="#94a3b8"
                />
                {searchQuery ? (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <MaterialIcons name="close" size={18} color="#64748b" />
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterSectionLabel}>View</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
                  {(['All', 'Programs', 'Events'] as const).map(option => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.secondaryFilterButton, contentFilter === option && styles.secondaryFilterButtonActive]}
                      onPress={() => setContentFilter(option)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.secondaryFilterButtonText,
                          contentFilter === option && styles.secondaryFilterButtonTextActive,
                        ]}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterSectionLabel}>Status</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
                  {(['All', 'Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'] as const).map(option => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.statusFilterButton, statusFilter === option && styles.statusFilterButtonActive]}
                      onPress={() => setStatusFilter(option)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.statusFilterButtonText, statusFilter === option && styles.statusFilterButtonTextActive]}>
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.controlsFooter}>
                <Text style={styles.controlsSummary}>
                  {totalVisibleGroupItems} result{totalVisibleGroupItems === 1 ? '' : 's'} across {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}
                </Text>
                <View style={styles.controlsFooterActions}>
                  <TouchableOpacity style={styles.controlsFooterButton} onPress={expandAllCategories}>
                    <Text style={styles.controlsFooterButtonText}>Expand All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.controlsFooterButton} onPress={collapseAllCategories}>
                    <Text style={styles.controlsFooterButtonText}>Collapse All</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          {loadError ? (
            <InlineLoadError
              title={loadError.title}
              message={loadError.message}
              onRetry={() => void loadProjectsData()}
            />
          ) : null}

          <FlatList<ProjectCategoryGroup>
            ref={projectListRef}
            data={projectsByCategory}
            keyExtractor={(item, index) => `category-${item.category}-${index}`}
            renderItem={({ item: categoryGroup }) => (
              <View>
                <CategoryHeader
                  category={categoryGroup.category}
                  eventCount={categoryGroup.eventCount}
                  programCount={categoryGroup.programCount}
                  projectCount={categoryGroup.projects.length}
                  isExpanded={expandedCategories.has(categoryGroup.category)}
                  onToggle={() => toggleCategory(categoryGroup.category)}
                />
                {expandedCategories.has(categoryGroup.category) && (
                  <View>
                    {categoryGroup.projects.map((project) => (
                      <React.Fragment key={project.id}>
                        {renderProjectItem({ item: project })}
                      </React.Fragment>
                    ))}
                  </View>
                )}
              </View>
            )}
            initialNumToRender={6}
            maxToRenderPerBatch={8}
            windowSize={7}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews
            onScrollToIndexFailed={({ index }) => {
              const safeIndex = Math.max(0, Math.min(index, projectsByCategory.length - 1));
              projectListRef.current?.scrollToOffset({
                offset: safeIndex * 280,
                animated: true,
              });
            }}
            ListEmptyComponent={
              loadError ? null : (
                <View style={styles.emptyState}>
                  <MaterialIcons name="folder-open" size={44} color="#94a3b8" />
                  <Text style={styles.emptyStateTitle}>No matching items</Text>
                  <Text style={styles.emptyStateText}>
                    {searchQuery || contentFilter !== 'All' || statusFilter !== 'All'
                      ? 'Try clearing some filters or searching with a different keyword.'
                      : 'There are no programs or projects available right now.'}
                  </Text>
                </View>
              )
            }
          />
        </>
      ) : (
        <ScrollView style={styles.mobileFlow} contentContainerStyle={styles.mobileFlowContent}>
          <View style={styles.mobileHeaderCard}>
            {selectedCategory || selectedProgram || selectedEvent ? (
              <TouchableOpacity style={styles.mobileBackButton} onPress={handleMobileBack}>
                <MaterialIcons name="arrow-back" size={18} color="#166534" />
                <Text style={styles.mobileBackButtonText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.heroEyebrow}>
                <MaterialIcons name="dashboard-customize" size={14} color="#166534" />
                <Text style={styles.heroEyebrowText}>Projects Workspace</Text>
              </View>
            )}

            <Text style={styles.mobileTitle}>
              {selectedEvent
                ? 'Event Details'
                : selectedProgram
                ? 'Project Details'
                : selectedCategory
                ? `${selectedCategory} Projects`
                : 'Programs'}
            </Text>
            <Text style={styles.mobileSubtitle}>
              {selectedEvent
                ? 'Open one event at a time so actions and assignments are easier to follow.'
                : selectedProgram
                ? 'Review the selected project, then open one event for the full event details.'
                : selectedCategory
                ? 'Tap a project to open its details and see the events inside it.'
                : user?.role === 'volunteer'
                ? 'Choose a category first, then open a program and the event you want to join.'
                : 'Choose a program category first, then drill down into the project and event you need.'}
            </Text>
          </View>

          {!selectedCategory ? (
            <>
              <View style={styles.controlsCard}>
                <View style={styles.searchRow}>
                  <MaterialIcons name="search" size={18} color="#64748b" />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search a program, event, place, or status"
                    placeholderTextColor="#94a3b8"
                  />
                  {searchQuery ? (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <MaterialIcons name="close" size={18} color="#64748b" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={styles.filterSection}>
                  <Text style={styles.filterSectionLabel}>Status</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
                    {(['All', 'Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'] as const).map(option => (
                      <TouchableOpacity
                        key={option}
                        style={[styles.statusFilterButton, statusFilter === option && styles.statusFilterButtonActive]}
                        onPress={() => setStatusFilter(option)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.statusFilterButtonText, statusFilter === option && styles.statusFilterButtonTextActive]}>
                          {option}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>

              {user?.role === 'volunteer' ? (
                <View style={styles.mobileGuideCard}>
                  <Text style={styles.mobileGuideTitle}>How to browse programs</Text>
                  <Text style={styles.mobileGuideText}>
                    Start with a category, open the program you like, then choose the event where you want to help.
                  </Text>
                </View>
              ) : null}

              {loadError ? (
                <InlineLoadError
                  title={loadError.title}
                  message={loadError.message}
                  onRetry={() => void loadProjectsData()}
                />
              ) : null}

              {projectsByCategory.length ? (
                projectsByCategory.map(group => (
                  <TouchableOpacity
                    key={group.category}
                    style={styles.mobileCategoryCard}
                    onPress={() => handleOpenCategory(group.category)}
                  >
                    <Text style={styles.mobileCardLabel}>Category</Text>
                    <View style={styles.mobileCategoryHeader}>
                      <Text style={styles.mobileCategoryTitle}>{group.category}</Text>
                      <MaterialIcons name="chevron-right" size={22} color="#166534" />
                    </View>
                    <Text style={styles.mobileCategoryMeta}>
                      {group.programCount} project{group.programCount === 1 ? '' : 's'} | {group.eventCount} event{group.eventCount === 1 ? '' : 's'}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <MaterialIcons name="folder-open" size={44} color="#94a3b8" />
                  <Text style={styles.emptyStateTitle}>No matching programs</Text>
                  <Text style={styles.emptyStateText}>Try clearing the status filter or search.</Text>
                </View>
              )}
            </>
          ) : selectedCategoryGroup && !selectedProgram ? (
            selectedCategoryGroup.projects.length ? (
              selectedCategoryGroup.projects.map(project => (
                <TouchableOpacity
                  key={project.id}
                  style={styles.mobileEntityCard}
                  onPress={() => handleOpenProgramDetails(project.id)}
                >
                  <Text style={styles.mobileCardLabel}>Program</Text>
                  <Text style={styles.mobileEntityTitle}>{project.title}</Text>
                  <Text style={styles.mobileEntityMeta}>{formatProjectDateRange(project.startDate, project.endDate)}</Text>
                  <Text style={styles.mobileEntityMeta}>{project.location.address}</Text>
                  <Text style={styles.mobileEntitySummary} numberOfLines={3}>{project.description}</Text>
                  <View style={styles.mobileEntityFooter}>
                    <Text style={styles.mobileEntityFooterText}>
                      {(linkedEventsByProgramId.get(project.id) || []).length} event{(linkedEventsByProgramId.get(project.id) || []).length === 1 ? '' : 's'} inside
                    </Text>
                    <MaterialIcons name="chevron-right" size={20} color="#166534" />
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <MaterialIcons name="folder-open" size={44} color="#94a3b8" />
                <Text style={styles.emptyStateTitle}>No projects in this category</Text>
                <Text style={styles.emptyStateText}>Try changing the active filters.</Text>
              </View>
            )
          ) : selectedProgram && !selectedEvent ? (
            <>
              <View style={styles.mobileDetailCard}>
                <View style={styles.mobileProgramHeaderRow}>
                  <View style={styles.mobileProgramHeaderCopy}>
                    <Text style={styles.mobileCardLabel}>Program card</Text>
                    <Text style={styles.mobileDetailTitle}>{selectedProgram.title}</Text>
                  </View>
                  <View
                    style={[
                      styles.mobileProgramStatusBadge,
                      { backgroundColor: `${getProjectStatusColor(selectedProgram)}1a` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.mobileProgramStatusText,
                        { color: getProjectStatusColor(selectedProgram) },
                      ]}
                    >
                      {getProjectDisplayStatus(selectedProgram)}
                    </Text>
                  </View>
                </View>

                <View style={styles.mobileProgramStatRow}>
                  <View style={styles.mobileProgramStatChip}>
                    <Text style={styles.mobileProgramStatValue}>
                      {selectedProgram.programModule || selectedProgram.category}
                    </Text>
                    <Text style={styles.mobileProgramStatLabel}>module</Text>
                  </View>
                  <View style={styles.mobileProgramStatChip}>
                    <Text style={styles.mobileProgramStatValue}>{selectedProgramEvents.length}</Text>
                    <Text style={styles.mobileProgramStatLabel}>linked events</Text>
                  </View>
                </View>

                <Text style={styles.mobileDetailMeta}>{formatProjectDateRange(selectedProgram.startDate, selectedProgram.endDate)}</Text>
                <Text style={styles.mobileDetailMeta}>{selectedProgram.location.address}</Text>
                <Text style={styles.mobileDetailDescription}>{selectedProgram.description}</Text>
              </View>

              {user?.role === 'volunteer' ? (
                <View style={styles.mobileGuideCard}>
                  <Text style={styles.mobileGuideTitle}>Next step</Text>
                  <Text style={styles.mobileGuideText}>
                    Open an event below to request to join and see your volunteer actions.
                  </Text>
                </View>
              ) : null}

              <View style={styles.mobileSectionHeader}>
                <Text style={styles.mobileSectionTitle}>Events Inside This Project</Text>
                <Text style={styles.mobileSectionMeta}>
                  {selectedProgramEvents.length} event{selectedProgramEvents.length === 1 ? '' : 's'}
                </Text>
              </View>

              {selectedProgramEvents.length ? (
                selectedProgramEvents.map(event => (
                  <TouchableOpacity
                    key={event.id}
                    style={styles.mobileEntityCard}
                    onPress={() => handleOpenEventDetails(event.id)}
                  >
                    <Text style={styles.mobileCardLabel}>Event</Text>
                    <Text style={styles.mobileEntityTitle}>{event.title}</Text>
                    <Text style={styles.mobileEntityMeta}>{formatProjectDateRange(event.startDate, event.endDate)}</Text>
                    <Text style={styles.mobileEntityMeta}>{event.location.address}</Text>
                    <Text style={styles.mobileEntitySummary} numberOfLines={2}>{event.description}</Text>
                    <View style={styles.mobileEntityFooter}>
                      <Text style={styles.mobileEntityFooterText}>{event.volunteers.length}/{event.volunteersNeeded} volunteers</Text>
                      <MaterialIcons name="chevron-right" size={20} color="#166534" />
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <MaterialIcons name="event-busy" size={44} color="#94a3b8" />
                  <Text style={styles.emptyStateTitle}>No events yet</Text>
                  <Text style={styles.emptyStateText}>This project does not have any events yet.</Text>
                </View>
              )}
            </>
          ) : selectedEvent ? (
            <>
              <View style={styles.mobileDetailCard}>
                <Text style={styles.mobileCardLabel}>Event overview</Text>
                <Text style={styles.mobileDetailTitle}>{selectedEvent.title}</Text>
                <Text style={styles.mobileDetailMeta}>{formatProjectDateRange(selectedEvent.startDate, selectedEvent.endDate)}</Text>
                <Text style={styles.mobileDetailMeta}>{selectedEvent.location.address}</Text>
                <Text style={styles.mobileDetailDescription}>{selectedEvent.description}</Text>
              </View>

              {user?.role === 'volunteer' && selectedEventActionState ? (
                <View style={styles.mobileEventActionCard}>
                  <View style={styles.volunteerInsightCard}>
                    <Text style={styles.volunteerInsightLabel}>Why this event may fit you</Text>
                    <Text style={styles.volunteerInsightText}>
                      {formatSuggestionReasons(getProjectSuggestion(selectedEvent, volunteerProfile).reasons)}
                    </Text>
                  </View>

                  {!selectedEventActionState.joined &&
                  !selectedEventActionState.isPendingApproval &&
                  !selectedEventActionState.completedParticipation ? (
                    <Text style={styles.volunteerActionHint}>
                      Request to join first. Time In and Time Out appear after approval.
                    </Text>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.joinButton,
                      selectedEventActionState.completedParticipation
                        ? styles.joinButtonCompleted
                        : (selectedEventActionState.joined || selectedEventActionState.isPendingApproval) && styles.joinButtonJoined,
                      loadingProjectId === selectedEvent.id && styles.joinButtonLoading,
                    ]}
                    disabled={selectedEventActionState.isJoinDisabled || loadingProjectId === selectedEvent.id}
                    onPress={() => handleJoinProject(selectedEvent.id)}
                  >
                    <MaterialIcons
                      name={selectedEventActionState.joinButtonIcon}
                      size={18}
                      color={
                        selectedEventActionState.completedParticipation
                          ? '#166534'
                          : selectedEventActionState.joined || selectedEventActionState.isPendingApproval
                          ? '#155724'
                          : '#fff'
                      }
                    />
                    <Text
                      style={[
                        styles.joinButtonText,
                        selectedEventActionState.completedParticipation
                          ? styles.joinButtonTextCompleted
                          : (selectedEventActionState.joined || selectedEventActionState.isPendingApproval) && styles.joinButtonTextJoined,
                      ]}
                    >
                      {loadingProjectId === selectedEvent.id ? 'Sending...' : selectedEventActionState.joinButtonLabel}
                    </Text>
                  </TouchableOpacity>

                  <Text style={styles.mobileEventStatusText}>{selectedEventActionState.statusMessage}</Text>

                  {selectedEventActionState.joined &&
                  (selectedEventActiveLog ||
                    (!selectedEventActionState.completedParticipation &&
                      selectedEventLifecycleStatus !== 'Completed' &&
                      selectedEventLifecycleStatus !== 'Cancelled')) ? (
                    <TouchableOpacity
                      style={[
                        styles.timeButton,
                        selectedEventActiveLog ? styles.timeOutButton : styles.timeInButton,
                        !selectedEventActiveLog && !selectedEventActionState.canTimeIn && styles.timeButtonDisabled,
                      ]}
                      onPress={() => {
                        if (selectedEventActiveLog) {
                          return openTimeOutModal(selectedEvent.id);
                        }

                        if (selectedEventActionState.canTimeIn) {
                          return handleTimeIn(selectedEvent.id);
                        }

                        if (
                          selectedEventActionState.isAssigned &&
                          selectedEventLifecycleStatus === 'Planning'
                        ) {
                          const startDate = selectedEvent.startDate ? new Date(selectedEvent.startDate) : null;
                          return Alert.alert(
                            'Not started yet',
                            startDate
                              ? `This event starts on ${format(startDate, 'MMM d')}. Time in will be available then.`
                              : 'This event has not started yet. Please refresh when the event begins.'
                          );
                        }

                        return Alert.alert(
                          'Assignment Required',
                          'You need to be assigned to an event task before you can time in.'
                        );
                      }}
                      disabled={loadingProjectId === selectedEvent.id || (!selectedEventActiveLog && !selectedEventActionState.canTimeIn)}
                    >
                      <MaterialIcons
                        name={
                          selectedEventActiveLog
                            ? 'logout'
                            : selectedEventActionState.canTimeIn
                            ? 'login'
                            : 'lock'
                        }
                        size={16}
                        color="#fff"
                      />
                      <Text style={styles.timeButtonText}>
                        {selectedEventActiveLog
                          ? 'Time Out'
                          : selectedEventActionState.canTimeIn
                          ? 'Time In'
                          : selectedEventLifecycleStatus === 'Planning' &&
                            selectedEventActionState.isAssigned
                          ? 'Await Start'
                          : 'Await Assignment'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {selectedEventActionState.joined ? (
                    <TouchableOpacity
                      style={styles.groupChatButton}
                      onPress={() => handleOpenGroupChat(selectedEvent.id)}
                    >
                      <MaterialIcons name="groups" size={16} color="#166534" />
                      <Text style={styles.groupChatButtonText}>Open Group Chat</Text>
                    </TouchableOpacity>
                  ) : null}

                  {selectedEventJoinRecord || selectedEventActiveLog || selectedEventLatestLog ? (
                    <View style={styles.logMeta}>
                      <Text style={styles.logMetaLabel}>Participation</Text>
                      <Text style={styles.logMetaValue}>
                        {selectedEventActionState.completedParticipation
                          ? selectedEventJoinRecord?.completedAt
                            ? `Completed ${formatTimestamp(selectedEventJoinRecord.completedAt)}`
                            : 'Completed and saved to profile'
                          : selectedEventActiveLog
                          ? `Active since ${formatTimestamp(selectedEventActiveLog.timeIn)}`
                          : selectedEventLatestLog
                          ? `Last log ${formatTimestamp(selectedEventLatestLog.timeIn)}`
                          : 'Joined'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : user?.role === 'partner' ? (
                <View style={styles.mobileEventActionCard}>
                  <TouchableOpacity
                    style={[styles.joinButton, loadingProjectId === selectedEvent.id && styles.joinButtonLoading]}
                    disabled={loadingProjectId === selectedEvent.id}
                    onPress={() => handleJoinProject(selectedEvent.id)}
                  >
                    <MaterialIcons name="campaign" size={18} color="#fff" />
                    <Text style={styles.joinButtonText}>Submit Proposal</Text>
                  </TouchableOpacity>
                </View>
              ) : user?.role === 'admin' ? (
                <View style={styles.mobileEventActionCard}>
                  <TouchableOpacity
                    style={styles.openProgramButton}
                    onPress={() => handleOpenProject(selectedEvent.id)}
                  >
                    <MaterialIcons name="folder-open" size={18} color="#fff" />
                    <Text style={styles.openProgramButtonText}>Open Event</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {selectedEventFieldOfficer ? (
                <View style={styles.mobileFieldOfficerCard}>
                  <View style={styles.mobileSectionHeader}>
                    <Text style={styles.mobileSectionTitle}>Field Officer Controls</Text>
                    <Text style={styles.mobileSectionMeta}>
                      {selectedEventAssignableVolunteers.length} volunteer{selectedEventAssignableVolunteers.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text style={styles.mobileDetailDescription}>
                    Assign joined volunteers to event tasks here. These assignments are saved to the shared event record.
                  </Text>

                  {selectedEventAssignableTasks.length ? (
                    selectedEventAssignableTasks.map(task => (
                      <View key={task.id} style={styles.fieldOfficerTaskCard}>
                        <Text style={styles.fieldOfficerTaskTitle}>{task.title}</Text>
                        <Text style={styles.fieldOfficerTaskMeta}>
                          {task.assignedVolunteerName || 'Unassigned'} | {task.status}
                        </Text>
                        <View style={styles.assignmentChipRow}>
                          <TouchableOpacity
                            style={styles.assignmentChip}
                            onPress={() => void handleAssignEventTask(selectedEvent, task.id)}
                          >
                            <Text style={styles.assignmentChipText}>Unassign</Text>
                          </TouchableOpacity>
                          {selectedEventAssignableVolunteers.map(volunteer => (
                            <TouchableOpacity
                              key={`${task.id}-${volunteer.id}`}
                              style={[
                                styles.assignmentChip,
                                task.assignedVolunteerId === volunteer.id && styles.assignmentChipActive,
                              ]}
                              onPress={() => void handleAssignEventTask(selectedEvent, task.id, volunteer.id)}
                            >
                              <Text
                                style={[
                                  styles.assignmentChipText,
                                  task.assignedVolunteerId === volunteer.id && styles.assignmentChipTextActive,
                                ]}
                              >
                                {volunteer.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    ))
                  ) : (
                    <View style={styles.logMeta}>
                      <Text style={styles.logMetaLabel}>Assignment board</Text>
                      <Text style={styles.logMetaValue}>No assignable tasks yet.</Text>
                    </View>
                  )}
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}

      <Modal
        visible={Boolean(timeOutProjectId)}
        transparent
        animationType="slide"
        onRequestClose={closeTimeOutModal}
      >
        <Pressable style={styles.timeOutModalBackdrop} onPress={closeTimeOutModal}>
          <Pressable style={styles.timeOutModalCard} onPress={() => undefined}>
            <View style={styles.timeOutModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.timeOutModalTitle}>Submit Completion Proof</Text>
                <Text style={styles.timeOutModalSubtitle}>
                  {activeTimeOutProject?.title || 'Selected project'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeTimeOutModal}
                style={styles.timeOutModalCloseButton}
                disabled={loadingProjectId === timeOutProjectId}
              >
                <MaterialIcons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            <Text style={styles.timeOutModalHint}>
              Before timing out, submit your completion report and upload a completion photo.
            </Text>

            <View style={styles.timeOutProofActions}>
              <TouchableOpacity
                style={styles.timeOutProofButton}
                onPress={handlePickTimeOutPhoto}
                disabled={loadingProjectId === timeOutProjectId}
              >
                <MaterialIcons name="photo-camera" size={18} color="#166534" />
                <Text style={styles.timeOutProofButtonText}>
                  {timeOutPhotoDraft ? 'Replace Photo' : 'Upload Photo'}
                </Text>
              </TouchableOpacity>

              {timeOutPhotoDraft ? (
                <TouchableOpacity
                  style={styles.timeOutProofRemoveButton}
                  onPress={() => setTimeOutPhotoDraft('')}
                  disabled={loadingProjectId === timeOutProjectId}
                >
                  <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                  <Text style={styles.timeOutProofRemoveText}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {timeOutPhotoDraft ? (
              <View style={styles.timeOutPhotoPreviewCard}>
                {isImageMediaUri(timeOutPhotoDraft) ? (
                  <Image
                    source={{ uri: timeOutPhotoDraft }}
                    style={styles.timeOutPhotoPreview}
                    resizeMode="cover"
                  />
                ) : null}
                <Text style={styles.timeOutPhotoCaption}>Completion photo attached</Text>
              </View>
            ) : null}

            <Text style={styles.timeOutFieldLabel}>Completion Report Required</Text>
            <TextInput
              style={styles.timeOutReportInput}
              multiline
              numberOfLines={5}
              value={timeOutReportDraft}
              onChangeText={setTimeOutReportDraft}
              placeholder="Describe the work you completed, what was delivered, and any important outcome."
              placeholderTextColor="#94a3b8"
              textAlignVertical="top"
              editable={loadingProjectId !== timeOutProjectId}
            />

            <Text style={styles.timeOutRequirementText}>
              {hasTimeOutSubmissionRequirements
                ? 'Report and photo attached. You can now submit sign out.'
                : 'Both completion report and completion photo are required before sign out.'}
            </Text>

            <TouchableOpacity
              style={[
                styles.timeOutSubmitButton,
                !hasTimeOutSubmissionRequirements && styles.timeOutSubmitButtonDisabled,
                loadingProjectId === timeOutProjectId && styles.timeOutSubmitButtonDisabled,
              ]}
              onPress={() => {
                if (timeOutProjectId) {
                  void handleTimeOut(timeOutProjectId);
                }
              }}
              disabled={!hasTimeOutSubmissionRequirements || loadingProjectId === timeOutProjectId}
            >
              <MaterialIcons name="task-alt" size={18} color="#fff" />
              <Text style={styles.timeOutSubmitButtonText}>
                {loadingProjectId === timeOutProjectId ? 'Submitting...' : 'Submit and Time Out'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(activeProposalProject && partnerProposalDraft)}
        transparent
        animationType="slide"
        onRequestClose={closeProposalModal}
      >
        <Pressable style={styles.proposalFormBackdrop} onPress={closeProposalModal}>
          <Pressable style={styles.proposalFormCard} onPress={() => undefined}>
            <View style={styles.proposalFormHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.proposalFormTitle}>Partner Project Proposal</Text>
                <Text style={styles.proposalFormSubtitle}>
                  {activeProposalProject?.title || 'Selected program'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeProposalModal}
                style={styles.proposalFormCloseButton}
                disabled={loadingProjectId === activeProposalProject?.id}
              >
                <MaterialIcons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.proposalFormScroll}
              contentContainerStyle={styles.proposalFormContent}
              showsVerticalScrollIndicator={Platform.OS === 'web'}
            >
              <View style={styles.proposalReferenceCard}>
                <Text style={styles.proposalReferenceLabel}>Program Template</Text>
                <Text style={styles.proposalReferenceTitle}>{activeProposalProject?.title}</Text>
                <Text style={styles.proposalReferenceMeta}>
                  {(activeProposalProject?.programModule || activeProposalProject?.category) ?? 'Program'}
                </Text>
                <Text style={styles.proposalReferenceBody}>
                  {activeProposalProject?.description}
                </Text>
              </View>

              <Text style={styles.proposalFieldLabel}>Proposal Title</Text>
              <TextInput
                style={styles.proposalInput}
                value={partnerProposalDraft?.proposedTitle || ''}
                onChangeText={value => handlePartnerProposalDraftChange('proposedTitle', value)}
                placeholder="Enter the title the admin should review"
                placeholderTextColor="#94a3b8"
                editable={loadingProjectId !== activeProposalProject?.id}
              />

              <Text style={styles.proposalFieldLabel}>Proposal Description</Text>
              <TextInput
                style={[styles.proposalInput, styles.proposalTextArea]}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                value={partnerProposalDraft?.proposedDescription || ''}
                onChangeText={value => handlePartnerProposalDraftChange('proposedDescription', value)}
                placeholder="Describe the proposed project, activities, and partner contribution."
                placeholderTextColor="#94a3b8"
                editable={loadingProjectId !== activeProposalProject?.id}
              />

              <View style={styles.proposalFieldRow}>
                <View style={styles.proposalFieldHalf}>
                  <Text style={styles.proposalFieldLabel}>Start Date</Text>
                  <TextInput
                    style={styles.proposalInput}
                    value={partnerProposalDraft?.proposedStartDate || ''}
                    onChangeText={value => handlePartnerProposalDraftChange('proposedStartDate', value)}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94a3b8"
                    editable={loadingProjectId !== activeProposalProject?.id}
                  />
                </View>
                <View style={styles.proposalFieldHalf}>
                  <Text style={styles.proposalFieldLabel}>End Date</Text>
                  <TextInput
                    style={styles.proposalInput}
                    value={partnerProposalDraft?.proposedEndDate || ''}
                    onChangeText={value => handlePartnerProposalDraftChange('proposedEndDate', value)}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94a3b8"
                    editable={loadingProjectId !== activeProposalProject?.id}
                  />
                </View>
              </View>

              <Text style={styles.proposalFieldLabel}>Proposed Location</Text>
              <TextInput
                style={styles.proposalInput}
                value={partnerProposalDraft?.proposedLocation || ''}
                onChangeText={value => handlePartnerProposalDraftChange('proposedLocation', value)}
                placeholder="Barangay, city, municipality, or venue"
                placeholderTextColor="#94a3b8"
                editable={loadingProjectId !== activeProposalProject?.id}
              />

              <Text style={styles.proposalFieldLabel}>Volunteers Needed</Text>
              <TextInput
                style={styles.proposalInput}
                value={partnerProposalDraft?.proposedVolunteersNeeded || ''}
                onChangeText={value => handlePartnerProposalDraftChange('proposedVolunteersNeeded', value)}
                placeholder="Number of volunteers needed"
                keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
                placeholderTextColor="#94a3b8"
                editable={loadingProjectId !== activeProposalProject?.id}
              />

              <Text style={styles.proposalFieldLabel}>Skills Needed</Text>
              <TextInput
                style={styles.proposalInput}
                value={partnerProposalDraft?.skillsNeeded || ''}
                onChangeText={value => handlePartnerProposalDraftChange('skillsNeeded', value)}
                placeholder="e.g., teaching, medical, construction, cooking (comma-separated)"
                placeholderTextColor="#94a3b8"
                editable={loadingProjectId !== activeProposalProject?.id}
              />

              <Text style={styles.proposalFieldLabel}>Community Need</Text>
              <TextInput
                style={[styles.proposalInput, styles.proposalTextArea]}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                value={partnerProposalDraft?.communityNeed || ''}
                onChangeText={value => handlePartnerProposalDraftChange('communityNeed', value)}
                placeholder="Explain the need or problem this proposal is addressing."
                placeholderTextColor="#94a3b8"
                editable={loadingProjectId !== activeProposalProject?.id}
              />

              <Text style={styles.proposalFieldLabel}>Expected Deliverables</Text>
              <TextInput
                style={[styles.proposalInput, styles.proposalTextArea]}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                value={partnerProposalDraft?.expectedDeliverables || ''}
                onChangeText={value => handlePartnerProposalDraftChange('expectedDeliverables', value)}
                placeholder="List the expected outputs, results, or partner commitments."
                placeholderTextColor="#94a3b8"
                editable={loadingProjectId !== activeProposalProject?.id}
              />
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.proposalSubmitButton,
                loadingProjectId === activeProposalProject?.id && styles.proposalSubmitButtonDisabled,
              ]}
              onPress={() => {
                void submitPartnerProposal();
              }}
              disabled={loadingProjectId === activeProposalProject?.id}
            >
              <MaterialIcons name="campaign" size={18} color="#fff" />
              <Text style={styles.proposalSubmitButtonText}>
                {loadingProjectId === activeProposalProject?.id ? 'Submitting...' : 'Submit Partner Proposal'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(imagePreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setImagePreview(null)}
      >
        <Pressable style={styles.imagePreviewBackdrop} onPress={() => setImagePreview(null)}>
          <Pressable style={styles.imagePreviewCard} onPress={() => undefined}>
            <View style={styles.imagePreviewHeader}>
              <Text style={styles.imagePreviewTitle}>{imagePreview?.title}</Text>
              <TouchableOpacity
                onPress={() => setImagePreview(null)}
                style={styles.imagePreviewCloseButton}
              >
                <MaterialIcons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {imagePreview ? (
              <Image
                source={imagePreview.source}
                style={styles.imagePreviewImage}
                resizeMode="contain"
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Platform.select({ web: 8, default: 15 }),
    backgroundColor: '#eef4ef',
  },
  topPanel: {
    gap: 12,
    marginBottom: 12,
  },
  mobileFlow: {
    flex: 1,
  },
  mobileFlowContent: {
    paddingHorizontal: 2,
    paddingBottom: 24,
    gap: 12,
  },
  mobileHeaderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#dbe7df',
    gap: 8,
  },
  mobileGuideCard: {
    backgroundColor: '#f7fff8',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ccebd5',
    padding: 14,
    gap: 6,
  },
  mobileGuideTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  mobileGuideText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  mobileBackButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mobileBackButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  mobileTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  mobileSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
  },
  mobileCategoryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    gap: 8,
  },
  mobileCardLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#64748b',
  },
  mobileCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mobileCategoryTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  mobileCategoryMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  mobileEntityCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    gap: 6,
  },
  mobileEntityTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  mobileEntityMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  mobileEntitySummary: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  mobileEntityFooter: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  mobileEntityFooterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  mobileDetailCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    gap: 8,
  },
  mobileProgramHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  mobileProgramHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  mobileProgramStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  mobileProgramStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  mobileProgramStatRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mobileProgramStatChip: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mobileProgramStatValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  mobileProgramStatLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  mobileDetailTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  mobileDetailMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  mobileDetailDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  mobileSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mobileSectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  mobileSectionMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  mobileEventActionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    gap: 10,
  },
  mobileEventStatusText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#166534',
    fontWeight: '600',
  },
  mobileFieldOfficerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    gap: 12,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 2,
  },
  heroEyebrow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  heroEyebrowText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 6,
    color: '#0f172a',
  },
  subheading: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 21,
  },
  volunteerGuideCard: {
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: '#f7fff8',
    borderWidth: 1,
    borderColor: '#ccebd5',
    padding: 14,
    gap: 10,
  },
  volunteerGuideTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  volunteerGuideSteps: {
    gap: 8,
  },
  volunteerGuideStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  volunteerGuideStepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
    backgroundColor: '#166534',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 22,
  },
  volunteerGuideStepText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#334155',
    fontWeight: '600',
  },
  overviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  overviewCard: {
    minWidth: 120,
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  overviewValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#166534',
  },
  overviewLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  controlsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#dbe7df',
    gap: 14,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ web: 12, default: 10 }),
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    paddingVertical: 0,
  },
  filterSection: {
    gap: 8,
  },
  filterSectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  filterChipRow: {
    gap: 8,
    paddingRight: 8,
  },
  secondaryFilterButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  secondaryFilterButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  secondaryFilterButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  secondaryFilterButtonTextActive: {
    color: '#ffffff',
  },
  controlsFooter: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
    alignItems: Platform.select({ web: 'center', default: 'flex-start' }),
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 14,
  },
  controlsSummary: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  controlsFooterActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  controlsFooterButton: {
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  controlsFooterButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 36,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  emptyStateTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  emptyStateText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: Platform.select({ web: 18, default: 18 }),
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dbe7df',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
    overflow: 'hidden',
  },
  programImage: {
    width: '100%',
    height: Platform.select({ web: 460, default: 190 }),
    backgroundColor: '#ffffff',
  },
  programImageButton: {
    position: 'relative',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  programImagePressed: {
    opacity: 0.92,
  },
  programImageBackdrop: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.32,
  },
  programImageTitleBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  programImageTitle: {
    color: '#ffffff',
    fontSize: Platform.select({ web: 24, default: 18 }),
    fontWeight: '800',
    lineHeight: Platform.select({ web: 30, default: 22 }),
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  programImageCategory: {
    marginTop: 4,
    color: '#f0fdf4',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  programImageOverlay: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    backgroundColor: 'rgba(22, 101, 52, 0.92)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  programImageOverlayText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  programImageFallback: {
    width: '100%',
    height: Platform.select({ web: 420, default: 190 }),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 8,
    backgroundColor: '#ecfdf5',
  },
  programImageFallbackNutrition: {
    backgroundColor: '#ecfdf5',
  },
  programImageFallbackEducation: {
    backgroundColor: '#eff6ff',
  },
  programImageFallbackLivelihood: {
    backgroundColor: '#fff7ed',
  },
  programImageFallbackDisaster: {
    backgroundColor: '#fef2f2',
  },
  programImageFallbackTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#166534',
    textAlign: 'center',
  },
  programImageFallbackSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  programImageHint: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
    color: '#0f172a',
  },
  category: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4CAF50',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
  },
  recommendationBadge: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recommendationLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
  },
  description: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 10,
    lineHeight: 21,
    paddingHorizontal: 16,
  },
  cardSectionLabel: {
    paddingHorizontal: 16,
    marginBottom: 4,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#64748b',
  },
  cardInsightWrap: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  volunteerInsightCard: {
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  volunteerInsightLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: '#1d4ed8',
  },
  volunteerInsightText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#1e3a8a',
    fontWeight: '600',
  },
  cardQuickFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  cardQuickFact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 150,
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cardQuickFactText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f6fbf7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe7df',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  expandToggleText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  expandedSection: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    marginHorizontal: 15,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  expandedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  expandedTextWrap: {
    flex: 1,
    gap: 2,
  },
  expandedLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: '#64748b',
  },
  expandedValue: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  matchReason: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: '600',
    marginBottom: 10,
  },
  volunteerActions: {
    marginBottom: 4,
    gap: 8,
    paddingHorizontal: 16,
  },
  volunteerActionHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
    fontWeight: '600',
  },
  projectEventsPanel: {
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  projectEventsPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  projectEventsPanelTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectEventsPanelMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  nestedEventCard: {
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 10,
  },
  nestedEventHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  nestedEventHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  nestedEventTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  nestedEventTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  nestedEventTypeBadge: {
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  nestedEventTypeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
  },
  nestedEventMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  nestedEventStatus: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    color: '#166534',
    fontWeight: '600',
  },
  nestedEventSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  nestedEventSummaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  nestedEventActionBlock: {
    gap: 8,
  },
  nestedEventExpandedSection: {
    borderTopWidth: 1,
    borderTopColor: '#dbe7df',
    paddingTop: 12,
    gap: 12,
  },
  nestedEventDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  fieldOfficerInlineCard: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 12,
    gap: 10,
  },
  fieldOfficerInlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  fieldOfficerInlineTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldOfficerInlineMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  fieldOfficerInlineText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  fieldOfficerTaskCard: {
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 8,
  },
  fieldOfficerTaskTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  fieldOfficerTaskMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  assignmentChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  assignmentChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  assignmentChipActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  assignmentChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  assignmentChipTextActive: {
    color: '#ffffff',
  },
  programEventsSection: {
    gap: 10,
  },
  programEventsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  programEventsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  programEventsSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  programEventsCountBadge: {
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  programEventsCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  programEventCard: {
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 10,
  },
  programEventHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  programEventCopy: {
    flex: 1,
    gap: 4,
  },
  programEventTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  programEventMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  programEventStatusText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    color: '#166534',
    fontWeight: '600',
  },
  programEventJoinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignSelf: 'flex-start',
  },
  programEventJoinButtonDisabled: {
    opacity: 0.78,
  },
  programEventJoinButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  programEventFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  programEventTypeBadge: {
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  programEventTypeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
  },
  programEventSlots: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  partnerActions: {
    marginBottom: 4,
    gap: 8,
    paddingHorizontal: 16,
  },
  adminActions: {
    marginBottom: 4,
    gap: 8,
    paddingHorizontal: 16,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  joinButtonJoined: {
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  joinButtonCompleted: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  joinButtonLoading: {
    opacity: 0.7,
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  joinButtonTextJoined: {
    color: '#155724',
  },
  joinButtonTextCompleted: {
    color: '#166534',
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  timeButtonDisabled: {
    opacity: 0.6,
  },
  timeInButton: {
    backgroundColor: '#2563eb',
  },
  timeOutButton: {
    backgroundColor: '#dc2626',
  },
  timeButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  groupChatButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  groupChatButtonText: {
    color: '#166534',
    fontWeight: '700',
    fontSize: 12,
  },
  logMeta: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
  },
  logMetaLabel: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
    fontWeight: '600',
  },
  logMetaValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '600',
  },
  proofReminderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fcd34d',
    padding: 10,
  },
  proofReminderText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#92400e',
    fontWeight: '600',
  },
  proofReportText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  partnerNote: {
    fontSize: 12,
    color: '#0f172a',
  },
  proposalFormBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  proposalFormCard: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '92%',
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
  },
  proposalFormHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  proposalFormTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalFormSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  proposalFormCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  proposalFormScroll: {
    flexGrow: 0,
  },
  proposalFormContent: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
  },
  proposalReferenceCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    padding: 14,
  },
  proposalReferenceLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  proposalReferenceTitle: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalReferenceMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  proposalReferenceBody: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  proposalFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  proposalInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
  },
  proposalTextArea: {
    minHeight: 108,
    lineHeight: 20,
  },
  proposalFieldRow: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
    gap: 12,
  },
  proposalFieldHalf: {
    flex: 1,
    gap: 8,
  },
  proposalSubmitButton: {
    marginHorizontal: 18,
    marginBottom: 18,
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#166534',
    borderRadius: 12,
    paddingVertical: 13,
  },
  proposalSubmitButtonDisabled: {
    opacity: 0.72,
  },
  proposalSubmitButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  filesSection: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe2ea',
    gap: 8,
  },
  filesSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  filesEmptyText: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  fileCard: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  fileName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  fileMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
  },
  openProgramButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  openProgramButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  timeOutModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  timeOutModalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  timeOutModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  timeOutModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  timeOutModalSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  timeOutModalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  timeOutModalHint: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  timeOutProofActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  timeOutProofButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timeOutProofButtonText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  timeOutProofRemoveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timeOutProofRemoveText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '700',
  },
  timeOutPhotoPreviewCard: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fafc',
  },
  timeOutPhotoPreview: {
    width: '100%',
    height: 180,
    backgroundColor: '#e2e8f0',
  },
  timeOutPhotoCaption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  timeOutFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  timeOutReportInput: {
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    lineHeight: 20,
    color: '#0f172a',
  },
  timeOutRequirementText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  timeOutSubmitButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#166534',
    borderRadius: 12,
    paddingVertical: 12,
  },
  timeOutSubmitButtonDisabled: {
    opacity: 0.7,
  },
  timeOutSubmitButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  imagePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  imagePreviewCard: {
    width: '100%',
    maxWidth: 1200,
    maxHeight: '92%',
    backgroundColor: '#0f172a',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  imagePreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  imagePreviewTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    paddingRight: 12,
  },
  imagePreviewCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  imagePreviewImage: {
    width: '100%',
    height: Platform.select({ web: 760, default: 420 }),
    backgroundColor: '#0b1120',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  volunteers: {
    fontSize: 12,
    color: '#999',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 2,
    marginBottom: 12,
    marginTop: 8,
    borderRadius: 16,
  },
  categoryHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  categoryIcon: {
    marginRight: 4,
  },
  categoryHeaderText: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  categoryCount: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 2,
  },
  statusFilterBar: {
    gap: 8,
  },
  statusFilterButton: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusFilterButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  statusFilterButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  statusFilterButtonTextActive: {
    color: '#fff',
  },});
