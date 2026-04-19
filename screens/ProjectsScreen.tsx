import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, Text, TouchableOpacity, Alert, Pressable, Image, Platform, ImageSourcePropType, Modal, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllPublishedImpactReports,
  getProjectsScreenSnapshot,
  getVolunteerProjectMatches,
  requestVolunteerProjectJoin,
  requestPartnerProjectJoin,
  startVolunteerTimeLog,
  endVolunteerTimeLog,
  subscribeToStorageChanges,
} from '../models/storage';
import { PartnerProjectApplication, Project, PublishedImpactReport, Volunteer, VolunteerProjectJoinRecord, VolunteerProjectMatch, VolunteerTimeLog } from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { navigateToAvailableRoute } from '../utils/navigation';
import { getProjectStatusColor } from '../utils/projectStatus';
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
  projects: Project[];
};

type Recommendation = {
  label: 'Good Skill Fit' | 'Suggested for You' | 'Open Program';
  reasons: string[];
};

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
  ]);

  const projectTerms = unique([
    ...normalizeWords(project.title),
    ...normalizeWords(project.description),
    ...normalizeWords(project.location.address),
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
  const imageSources: ImageSourcePropType[] = [];
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
  projectCount,
  isExpanded,
  onToggle,
}: {
  category: Project['category'];
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
          <Text style={styles.categoryCount}>{projectCount} program{projectCount !== 1 ? 's' : ''}</Text>
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
  const projectListRef = useRef<FlatList<ProjectCategoryGroup> | null>(null);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [impactReports, setImpactReports] = useState<PublishedImpactReport[]>([]);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [timeOutProjectId, setTimeOutProjectId] = useState<string | null>(null);
  const [timeOutReportDraft, setTimeOutReportDraft] = useState('');
  const [timeOutPhotoDraft, setTimeOutPhotoDraft] = useState('');
  const [imagePreview, setImagePreview] = useState<{
    title: string;
    source: ImageSourcePropType;
  } | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<Project['category']>>(
    new Set()
  );

  const [statusFilter, setStatusFilter] = useState<'All' | Project['status']>('All');
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
    try {
      const [snapshot, publishedReports] = await Promise.all([
        getProjectsScreenSnapshot(user),
        getAllPublishedImpactReports(),
      ]);
      applySnapshot(snapshot);
      setLoadError(null);
      setImpactReports(publishedReports.filter(report => Boolean(report.publishedAt)));
      if (snapshot.volunteerProfile?.id) {
        const matches = await getVolunteerProjectMatches(snapshot.volunteerProfile.id);
        setVolunteerMatches(matches);
      } else {
        setVolunteerMatches([]);
      }
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
        setImpactReports([]);
      });
      setLoadError(nextLoadError);
    }
  }, [applySnapshot, user]);

  useFocusEffect(
    React.useCallback(() => {
      void loadProjectsData();
      return subscribeToStorageChanges(
        ['projects', 'volunteers', 'volunteerProjectJoins', 'volunteerTimeLogs', 'partnerProjectApplications', 'volunteerMatches', 'publishedImpactReports'],
        () => {
          void loadProjectsData();
        }
      );
    }, [loadProjectsData])
  );

  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projects.length === 0) {
      return;
    }

    const targetIndex = projects.findIndex(project => project.id === requestedProjectId);
    if (targetIndex === -1) {
      return;
    }

    setExpandedProjectId(requestedProjectId);
    requestAnimationFrame(() => {
      projectListRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.15,
      });
    });
    navigation.setParams({ projectId: undefined });
  }, [navigation, projects, route?.params?.projectId]);

  // Sends a join request for the active project based on the current user role.
  const handleJoinProject = async (projectId: string) => {
    if (!user?.id) return;
    try {
      setLoadingProjectId(projectId);
      if (user.role === 'partner') {
        const application = await requestPartnerProjectJoin(projectId, user);
        startTransition(() => {
          setPartnerApplications(prev => {
            const withoutCurrent = prev.filter(existing => existing.id !== application.id);
            return [application, ...withoutCurrent].sort(
              (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
            );
          });
        });
        Alert.alert('Submitted', 'Admin has been notified and your request is waiting for approval.');
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
        'Your join request was sent to the admin. You will be notified once it is approved or rejected.'
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to request this program. Please try again.')
      );
    } finally {
      setLoadingProjectId(null);
    }
  };

  // Starts a volunteer time log for the selected project.
  const handleTimeIn = async (projectId: string) => {
    if (!volunteerProfile) return;
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
    () => new Map(partnerApplications.map(app => [app.projectId, app])),
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
    return statusFilter === 'All' ? projects : projects.filter(project => project.status === statusFilter);
  }, [projects, statusFilter]);

  // Groups projects by category
  const projectsByCategory = useMemo<ProjectCategoryGroup[]>(() => {
    const categories: Project['category'][] = ['Education', 'Livelihood', 'Nutrition', 'Disaster'];
    const grouped: Record<Project['category'], Project[]> = {
      Education: [],
      Livelihood: [],
      Nutrition: [],
      Disaster: [],
    };

    visibleProjects.forEach(project => {
      if (grouped[project.category]) {
        grouped[project.category].push(project);
      }
    });

    return categories.map(category => ({
      category,
      projects: grouped[category],
    })).filter(group => group.projects.length > 0);
  }, [visibleProjects]);

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

  // Checks whether the current volunteer is already part of a project.
  const isJoined = useCallback((project: Project) => {
    const joinedUsers = project.joinedUserIds || [];
    const volunteerId = volunteerProfile?.id;
    return (
      (user?.id ? joinedUsers.includes(user.id) : false) ||
      (volunteerId ? project.volunteers.includes(volunteerId) : false)
    );
  }, [user?.id, volunteerProfile?.id]);

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
    setTimeOutProjectId(projectId);
    setTimeOutReportDraft(activeLog?.completionReport || '');
    setTimeOutPhotoDraft(activeLog?.completionPhoto || '');
  }, [activeLogByProjectId]);

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

  // Renders a single project card with role-specific actions.
  const renderProjectItem = useCallback(({ item }: { item: Project }) => {
          const suggestion = getProjectSuggestion(item, volunteerProfile);
          const joined = isJoined(item);
          const activeLog = activeLogByProjectId.get(item.id);
          const latestLog = latestLogByProjectId.get(item.id);
          const joinRecord = volunteerJoinRecordByProjectId.get(item.id);
          const volunteerMatch = volunteerMatchByProjectId.get(item.id);
          const completedParticipation = joinRecord?.participationStatus === 'Completed';
          const isExpanded = expandedProjectId === item.id;
          const partnerApplication = partnerApplicationByProjectId.get(item.id);
          const projectImpactReports = impactReports.filter(report => report.projectId === item.id);
          const canViewProjectFiles =
            user?.role === 'admin' ||
            (user?.role === 'volunteer' && (joined || Boolean(joinRecord))) ||
            (user?.role === 'partner' &&
              (joined || partnerApplication?.status === 'Approved'));
          const isPendingApproval = volunteerMatch?.status === 'Requested';
          const wasRejected = volunteerMatch?.status === 'Rejected';
          const joinButtonLabel = completedParticipation
            ? 'Completed'
            : joined
            ? 'Approved'
            : isPendingApproval
            ? 'Pending Approval'
            : wasRejected
            ? 'Request Again'
            : 'Request to Join';
          const joinButtonIcon = completedParticipation
            ? 'task-alt'
            : joined
            ? 'check-circle'
            : isPendingApproval
            ? 'hourglass-empty'
            : wasRejected
            ? 'refresh'
            : 'add-circle-outline';

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

              <Text style={styles.description}>{item.description}</Text>

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
                  <View style={styles.expandedRow}>
                    <MaterialIcons name="place" size={18} color="#f97316" />
                    <Text style={styles.expandedText}>{item.location.address}</Text>
                  </View>
                  <View style={styles.expandedRow}>
                    <MaterialIcons name="event" size={18} color="#2563eb" />
                    <Text style={styles.expandedText}>
                      {`Schedule: ${format(new Date(item.startDate), 'MMM d, yyyy')} - ${format(
                        new Date(item.endDate),
                        'MMM d, yyyy'
                      )}`}
                    </Text>
                  </View>
                  <View style={styles.expandedRow}>
                    <MaterialIcons name="info" size={18} color="#16a34a" />
                    <Text style={styles.expandedText}>
                      {`Suggested: ${suggestion.label} • ${suggestion.reasons.join(', ')}`}
                    </Text>
                  </View>
                </View>
              )}

              {user?.role === 'volunteer' && (
                <View style={styles.volunteerActions}>
                  <Text style={styles.matchReason}>
                    Suggestion based on: {suggestion.reasons.join(', ')}
                  </Text>

                  <View style={styles.joinRow}>
                    <TouchableOpacity
                      style={[
                        styles.joinButton,
                        completedParticipation
                          ? styles.joinButtonCompleted
                          : (joined || isPendingApproval) && styles.joinButtonJoined,
                        loadingProjectId === item.id && styles.joinButtonLoading,
                      ]}
                      disabled={joined || completedParticipation || isPendingApproval || loadingProjectId === item.id}
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
                        ]}
                        onPress={() =>
                          activeLog ? openTimeOutModal(item.id) : handleTimeIn(item.id)
                        }
                        disabled={loadingProjectId === item.id}
                      >
                        <MaterialIcons
                          name={activeLog ? 'logout' : 'login'}
                          size={16}
                          color="#fff"
                        />
                        <Text style={styles.timeButtonText}>
                          {activeLog ? 'Time Out' : 'Time In'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {(isPendingApproval || wasRejected) && !joined && (
                    <View style={styles.logMeta}>
                      <Text style={styles.logMetaLabel}>Request status</Text>
                      <Text style={styles.logMetaValue}>
                        {isPendingApproval
                          ? 'Waiting for admin approval'
                          : 'Rejected. You may submit a new request.'}
                      </Text>
                    </View>
                  )}

                  {joined && (
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
                            Upload a task photo or write a completion report before timing out.
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

                      {canViewProjectFiles && (
                        <View style={styles.filesSection}>
                          <Text style={styles.filesSectionTitle}>Published Files</Text>
                          {projectImpactReports.length === 0 ? (
                            <Text style={styles.filesEmptyText}>
                              No published files for this project yet.
                            </Text>
                          ) : (
                            projectImpactReports.map(report => (
                              <View key={report.id} style={styles.fileCard}>
                                <Text style={styles.fileName}>{report.reportFile}</Text>
                                <Text style={styles.fileMeta}>
                                  {report.format} • Published{' '}
                                  {format(new Date(report.publishedAt || report.generatedAt), 'MMM d, yyyy')}
                                </Text>
                              </View>
                            ))
                          )}
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}

              {user?.role === 'partner' && (
                <View style={styles.partnerActions}>
                  <Text style={styles.matchReason}>
                    Partner orgs can join any program to coordinate with NVC.
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.joinButton,
                      (joined || partnerApplication) && styles.joinButtonJoined,
                      loadingProjectId === item.id && styles.joinButtonLoading,
                    ]}
                    disabled={joined || !!partnerApplication || loadingProjectId === item.id}
                    onPress={() => handleJoinProject(item.id)}
                  >
                    <MaterialIcons
                      name={joined ? 'check-circle' : partnerApplication ? 'hourglass-empty' : 'group-add'}
                      size={18}
                      color={joined || partnerApplication ? '#155724' : '#fff'}
                    />
                    <Text
                      style={[
                        styles.joinButtonText,
                        (joined || partnerApplication) && styles.joinButtonTextJoined,
                      ]}
                    >
                      {joined
                        ? 'Approved as Partner'
                        : partnerApplication?.status === 'Pending'
                        ? 'Waiting for Approval'
                        : partnerApplication?.status === 'Rejected'
                        ? 'Request Rejected'
                        : 'Join as Partner'}
                    </Text>
                  </TouchableOpacity>
                  {(joined || partnerApplication) && (
                    <>
                      <Text style={styles.partnerNote}>
                        {joined
                          ? 'Your org is approved as a collaborator for this program.'
                          : partnerApplication?.status === 'Pending'
                          ? 'Your request is pending admin approval.'
                          : 'This request was rejected by the admin.'}
                      </Text>

                      {canViewProjectFiles && (
                        <View style={styles.filesSection}>
                          <Text style={styles.filesSectionTitle}>Published Files</Text>
                          {projectImpactReports.length === 0 ? (
                            <Text style={styles.filesEmptyText}>
                              No published files for this project yet.
                            </Text>
                          ) : (
                            projectImpactReports.map(report => (
                              <View key={report.id} style={styles.fileCard}>
                                <Text style={styles.fileName}>{report.reportFile}</Text>
                                <Text style={styles.fileMeta}>
                                  {report.format} • Published{' '}
                                  {format(new Date(report.publishedAt || report.generatedAt), 'MMM d, yyyy')}
                                </Text>
                              </View>
                            ))
                          )}
                        </View>
                      )}
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
                      { backgroundColor: getProjectStatusColor(item.status) },
                    ]}
                  />
                  <Text style={styles.status}>{item.status}</Text>
                </View>
                <Text style={styles.volunteers}>
                  {item.volunteers.length}/{item.volunteersNeeded} volunteers
                </Text>
              </View>
            </View>
          );
        }, [
          activeLogByProjectId,
          expandedProjectId,
          isJoined,
          latestLogByProjectId,
          loadingProjectId,
          partnerApplicationByProjectId,
          impactReports,
          handleOpenImagePreview,
          handleOpenProject,
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

    if (!completionReport && !completionPhoto) {
      Alert.alert(
        'Proof Required',
        'Upload a photo or write a completion report before timing out.'
      );
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
      Alert.alert('Time Out recorded', 'Hours added to your profile and proof of work saved.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, 'Unable to time out'),
        getRequestErrorMessage(error, 'Please try again.')
      );
    } finally {
      setLoadingProjectId(null);
    }
  };

  const hasTimeOutProof = Boolean(timeOutReportDraft.trim() || timeOutPhotoDraft.trim());

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Programs and Projects</Text>
      <Text style={styles.subheading}>
        {user?.role === 'volunteer'
          ? 'Program recommendations are based on your saved skills and skills description.'
          : user?.role === 'partner'
          ? 'Partner organizations can express interest and collaborate on any listed program.'
          : 'Current program list and participation needs.'}
      </Text>

      <View style={styles.statusFilterBar}>
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
              <Text style={styles.emptyStateTitle}>No programs yet</Text>
              <Text style={styles.emptyStateText}>
                There are no programs or projects available right now.
              </Text>
            </View>
          )
        }
      />

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
              Before timing out, upload a photo or write a short report confirming that you finished the task.
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

            <Text style={styles.timeOutFieldLabel}>Completion Report</Text>
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
              {hasTimeOutProof
                ? 'Proof attached. You can now submit your sign out.'
                : 'At least one proof is required before sign out: upload a photo or write a completion report.'}
            </Text>

            <TouchableOpacity
              style={[
                styles.timeOutSubmitButton,
                !hasTimeOutProof && styles.timeOutSubmitButtonDisabled,
                loadingProjectId === timeOutProjectId && styles.timeOutSubmitButtonDisabled,
              ]}
              onPress={() => {
                if (timeOutProjectId) {
                  void handleTimeOut(timeOutProjectId);
                }
              }}
              disabled={!hasTimeOutProof || loadingProjectId === timeOutProjectId}
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
    backgroundColor: '#f5f5f5',
  },
  heading: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#333',
  },
  subheading: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 15,
    lineHeight: 18,
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
    borderRadius: Platform.select({ web: 10, default: 14 }),
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 3,
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
    marginBottom: 8,
    paddingHorizontal: 15,
    paddingTop: 15,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
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
    color: '#666',
    marginBottom: 10,
    lineHeight: 20,
    paddingHorizontal: 15,
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    marginHorizontal: 15,
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
    alignItems: 'center',
    gap: 8,
  },
  expandedText: {
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
    paddingHorizontal: 15,
  },
  partnerActions: {
    marginBottom: 4,
    gap: 8,
    paddingHorizontal: 15,
  },
  adminActions: {
    marginBottom: 4,
    gap: 8,
    paddingHorizontal: 15,
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
    marginTop: 10,
    paddingTop: 10,
    paddingHorizontal: 15,
    paddingBottom: 15,
    borderTopWidth: 1,
    borderTopColor: '#eee',
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
    paddingVertical: 12,
    marginHorizontal: 15,
    marginBottom: 12,
    marginTop: 8,
    borderRadius: 12,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  statusFilterButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe2ea',
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


