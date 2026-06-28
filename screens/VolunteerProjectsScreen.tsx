import React, { useCallback, useMemo, useRef, useState } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageSourcePropType,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { format } from 'date-fns';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProjectsScreenSnapshot,
  getVolunteerProjectMatches,
  requestVolunteerProjectJoin,
  subscribeToStorageChanges,
} from '../models/storage';
import { ProgramTrack, Project, VolunteerProjectMatch, VolunteerProjectJoinRecord } from '../models/types';
import { getRequestErrorMessage, isAbortLikeError } from '../utils/requestErrors';

const PROGRAM_IMAGE_BY_CATEGORY: Record<Project['category'], ImageSourcePropType> = {
  Nutrition: require('../assets/programs/nutrition.jpg'),
  Education: require('../assets/programs/education.jpg'),
  Livelihood: require('../assets/programs/livelihood.jpg'),
  Disaster: require('../assets/programs/mingo-relief.jpg'),
};

type ProgramGroup = {
  id: string;
  title: string;
  description?: string;
  context?: string;
  projectCount: number;
  eventCount: number;
};

type ProgramVisual = {
  color: string;
  softColor: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

const PROGRAM_VISUALS: Record<Project['category'], ProgramVisual> = {
  Education: { color: '#2563eb', softColor: '#dbeafe', icon: 'school' },
  Livelihood: { color: '#b45309', softColor: '#fef3c7', icon: 'work' },
  Nutrition: { color: '#16a34a', softColor: '#dcfce7', icon: 'restaurant' },
  Disaster: { color: '#dc2626', softColor: '#fee2e2', icon: 'volunteer-activism' },
};

const DEFAULT_PROGRAM_VISUAL: ProgramVisual = {
  color: '#166534',
  softColor: '#dcfce7',
  icon: 'eco',
};

function inferProgramTrackFocus(track: ProgramTrack): Project['category'] | null {
  const text = `${track.id || ''} ${track.title || ''}`.toLowerCase();
  if (text.includes('education')) return 'Education';
  if (text.includes('livelihood')) return 'Livelihood';
  if (text.includes('nutrition')) return 'Nutrition';
  if (text.includes('disaster')) return 'Disaster';
  return null;
}

function getProjectProgramId(project: Project, programTracks: ProgramTrack[] = []): string {
  if (project.parentProjectId) {
    return project.parentProjectId;
  }

  const projectFocus = project.programModule || project.category;
  const matchingTrack = programTracks.find(track => inferProgramTrackFocus(track) === projectFocus);
  return matchingTrack?.id || projectFocus;
}

function getProjectImageSource(project: Project): ImageSourcePropType {
  if (!project.imageHidden && project.imageUrl) {
    return { uri: project.imageUrl };
  }
  return PROGRAM_IMAGE_BY_CATEGORY[project.programModule || project.category];
}

function formatProjectDateRange(startValue?: string, endValue?: string): string {
  const startDate = startValue ? new Date(startValue) : null;
  const endDate = endValue ? new Date(endValue) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return 'Schedule to be announced';
  const startLabel = format(startDate, 'MMM d, yyyy');
  if (!endDate || Number.isNaN(endDate.getTime())) return startLabel;
  const endLabel = format(endDate, 'MMM d, yyyy');
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function sortByDate(left: Project, right: Project): number {
  return new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
}

function getProgramVisual(programId?: string): ProgramVisual {
  const directVisual = PROGRAM_VISUALS[programId as Project['category']];
  if (directVisual) return directVisual;

  const normalized = String(programId || '').toLowerCase();
  if (normalized.includes('education')) return PROGRAM_VISUALS.Education;
  if (normalized.includes('livelihood')) return PROGRAM_VISUALS.Livelihood;
  if (normalized.includes('nutrition')) return PROGRAM_VISUALS.Nutrition;
  if (normalized.includes('disaster')) return PROGRAM_VISUALS.Disaster;
  return DEFAULT_PROGRAM_VISUAL;
}

function getEventStatusLabel(match?: VolunteerProjectMatch, joinedByUser?: boolean): string {
  if (match?.status === 'Requested') return 'Pending review';
  if (match?.status === 'Rejected') return 'Request rejected';
  if (match?.status === 'Matched' || joinedByUser) return 'Joined';
  if (match?.status === 'Completed') return 'Completed';
  return 'Open to join';
}

export default function VolunteerProjectsScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [records, setRecords] = useState<Project[]>([]);
  const [programs, setPrograms] = useState<ProgramTrack[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedProgramDetailsId, setSelectedProgramDetailsId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [joinRecords, setJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const hasLoadedOnceRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    const shouldShowBlockingLoader = !hasLoadedOnceRef.current;
    try {
      if (shouldShowBlockingLoader) {
        setLoading(true);
      }

      try {
        console.log('[VolunteerProjectsScreen] Starting data load for user:', user.id);
        const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'programTracks', 'volunteerProfile', 'volunteerMatches', 'volunteerJoinRecords']);
        const snapshotRecords = snapshot.projects || [];
        const snapshotPrograms = snapshot.programTracks || [];
        const eventCount = snapshotRecords.filter(project => project.isEvent).length;
        console.log('[VolunteerProjectsScreen] Snapshot received:', {
          recordCount: snapshotRecords.length,
          eventCount,
          programCount: snapshotPrograms.length,
          projectCount: snapshotRecords.filter(p => !p.isEvent && p.id.startsWith('project-proposal-')).length,
          matchCount: snapshot.volunteerMatches?.length,
          profile: snapshot.volunteerProfile?.id || 'none',
        });

        setRecords(snapshotRecords);
        setPrograms(snapshotPrograms);
        if (Array.isArray(snapshot.volunteerMatches)) {
          setVolunteerMatches(snapshot.volunteerMatches);
        } else if (snapshot.volunteerProfile?.id) {
          const matches = await getVolunteerProjectMatches(snapshot.volunteerProfile.id);
          setVolunteerMatches(matches);
        } else {
          setVolunteerMatches([]);
        }
        if (Array.isArray(snapshot.volunteerJoinRecords)) {
          setJoinRecords(snapshot.volunteerJoinRecords);
        } else {
          setJoinRecords([]);
        }
      } finally {
        // Reserved for future request cancellation; the storage helper owns its timeout.
      }
      hasLoadedOnceRef.current = true;
    } catch (error) {
      if (isAbortLikeError(error)) {
        console.warn('[VolunteerProjectsScreen] loadData timeout');
        return;
      }

      console.error('[VolunteerProjectsScreen] loadData error:', error);
      setRecords([]);
      setPrograms([]);
      setVolunteerMatches([]);
      setJoinRecords([]);
    } finally {
      if (shouldShowBlockingLoader) {
        setLoading(false);
      }
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    void loadData();
    return subscribeToStorageChanges(['projects', 'events', 'programs', 'volunteerMatches', 'volunteerProjectJoins'], loadData);
  }, [loadData]));

  const projectsOnly = useMemo(() => {
    // Only count actual projects, not top-level program records.
    const programIds = new Set(programs.map(program => String(program.id).trim()));
    return records.filter(project => {
      if (project.isEvent) return false;
      if (project.parentProjectId) return true;
      if (programIds.has(String(project.id).trim())) return false;
      
      // Always include proposal projects
      if (String(project.id || '').startsWith('project-proposal-')) return true;
      
      return Boolean(getProjectProgramId(project, programs));
    });
  }, [programs, records]);

  const programGroups = useMemo<ProgramGroup[]>(() => {
    const programMap = new Map<string, ProgramGroup>();

    // Use programs directly from the programs table
    programs.forEach(program => {
      programMap.set(program.id, {
        id: program.id,
        title: program.title,
        description: program.description,
        context: '', // Programs from database don't have context field
        projectCount: 0,
        eventCount: 0,
      });
    });

    const eventsOnly = records.filter(project => project.isEvent);



    projectsOnly.forEach(project => {
      const programId = getProjectProgramId(project, programs);
      if (!programId) {
        return;
      }
      const current = programMap.get(programId);
      
      // Only count projects that belong to existing programs
      if (current) {
        current.projectCount += 1;
        programMap.set(programId, current);
      }
    });

    eventsOnly.forEach(event => {
      // Find the parent project first
      const parentProject = event.parentProjectId
        ? projectsOnly.find(project => project.id === event.parentProjectId)
        : null;
      
      // If parent project not found, check if the parent is directly in records (might be a proposal)
      const parentInRecords = !parentProject && event.parentProjectId
        ? records.find(r => r.id === event.parentProjectId && !r.isEvent)
        : null;
      
      // If event has a parent project, use that project's parent program
      // Otherwise, use the event's parentProjectId directly (in case it points to a program)
      const programId = parentProject 
        ? getProjectProgramId(parentProject, programs) 
        : parentInRecords
        ? getProjectProgramId(parentInRecords, programs)
        : event.parentProjectId;
        
      if (!programId) {
        return;
      }
      const current = programMap.get(programId);
      
      // Only count events that belong to existing programs
      if (current) {
        current.eventCount += 1;
        programMap.set(programId, current);
      }
    });

    return Array.from(programMap.values())
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [programs, projectsOnly, records]);

  const selectedProgram = useMemo(
    () => programGroups.find(program => program.id === selectedProgramId) || null,
    [programGroups, selectedProgramId]
  );

  const selectedProgramDetails = useMemo(
    () => programGroups.find(program => program.id === selectedProgramDetailsId) || null,
    [programGroups, selectedProgramDetailsId]
  );

  const projectsForSelectedProgram = useMemo(
    () =>
      selectedProgramId
        ? projectsOnly
            .filter(project => !project.isEvent && getProjectProgramId(project, programs) === selectedProgramId)
            .sort(sortByDate)
        : [],
    [programs, projectsOnly, selectedProgramId]
  );

  const projectsForProgramDetails = useMemo(
    () =>
      selectedProgramDetailsId
        ? projectsOnly
            .filter(project => {
              if (project.isEvent) return false;
              const programId = getProjectProgramId(project, programs);
              // Include if it matches the program OR if it's a proposal with matching parentProjectId
              return programId === selectedProgramDetailsId || project.parentProjectId === selectedProgramDetailsId;
            })
            .sort(sortByDate)
        : [],
    [programs, projectsOnly, selectedProgramDetailsId]
  );

  const selectedProject = useMemo(
    () => projectsForSelectedProgram.find(project => project.id === selectedProjectId) || null,
    [projectsForSelectedProgram, selectedProjectId]
  );

  const eventsForSelectedProject = useMemo(
    () =>
      selectedProject
        ? records
            .filter(project => project.isEvent && project.parentProjectId === selectedProject.id)
            .sort(sortByDate)
        : [],
    [records, selectedProject]
  );

  const matchByProjectId = useMemo(
    () => new Map(volunteerMatches.map(match => [match.projectId, match])),
    [volunteerMatches]
  );

  const screenStats = useMemo(() => {
    const eventRecords = records.filter(project => project.isEvent);
    const pendingCount = volunteerMatches.filter(match => match.status === 'Requested').length;
    const joinedCount = volunteerMatches.filter(match => match.status === 'Matched' || match.status === 'Completed').length;

    return {
      programCount: programGroups.length,
      projectCount: projectsOnly.length,
      eventCount: eventRecords.length,
      pendingCount,
      joinedCount,
    };
  }, [programGroups.length, projectsOnly.length, records, volunteerMatches]);

  const nextOpenEvent = useMemo(() => {
    const now = Date.now();
    return records
      .filter(project => project.isEvent)
      .filter(event => {
        const match = matchByProjectId.get(event.id);
        // Rejected matches should NOT hide the event — the volunteer can re-apply
        if (match && match.status !== 'Rejected') return false;
        return true;
      })
      .filter(event => {
        const start = new Date(event.startDate).getTime();
        return Number.isNaN(start) || start >= now;
      })
      .sort(sortByDate)[0] || null;
  }, [matchByProjectId, records]);

  const handleJoin = async (eventId: string) => {
    if (!user?.id) return;
    try {
      // Find the event and check if it's full
      const event = records.find(project => project.id === eventId);
      if (event) {
        const volunteersNeeded = event.volunteersNeeded || 0;
        const currentVolunteers = event.volunteers?.length || 0;
        const pendingJoinRequests = volunteerMatches.filter(
          match => match.projectId === eventId && match.status === 'Requested'
        ).length;
        const approvedJoinRecords = joinRecords.filter(
          record => record.projectId === eventId
        ).length;
        
        const totalSlotsTaken = currentVolunteers + pendingJoinRequests + approvedJoinRecords;
        
        if (totalSlotsTaken >= volunteersNeeded && volunteersNeeded > 0) {
          Alert.alert(
            'Event Full',
            'This event has reached its volunteer capacity. All slots are filled.'
          );
          return;
        }
      }
      
      setLoadingProjectId(eventId);
      const match = await requestVolunteerProjectJoin(eventId, user.id);
      setVolunteerMatches(prev => [match, ...prev.filter(existing => existing.projectId !== eventId)]);
      Alert.alert('Request Sent', 'Your event join request was sent to admin. You will be notified when it is approved.');
    } catch (error) {
      Alert.alert('Error', getRequestErrorMessage(error, 'Unable to send join request. Please try again.'));
    } finally {
      setLoadingProjectId(null);
    }
  };

  const goBackOneLevel = () => {
    if (selectedProjectId) {
      setSelectedProjectId(null);
      return;
    }
    if (selectedProgramId) {
      setSelectedProgramId(null);
    }
  };

  const handleStepPress = (step: 'Program' | 'Project' | 'Event') => {
    if (step === 'Program') {
      setSelectedProgramId(null);
      setSelectedProjectId(null);
      return;
    }

    if (step === 'Project') {
      if (selectedProgramId) {
        setSelectedProjectId(null);
        return;
      }

      const firstProgram = programGroups[0];
      if (firstProgram) {
        setSelectedProgramId(firstProgram.id);
        setSelectedProjectId(null);
      }
      return;
    }

    if (selectedProjectId) {
      return;
    }

    const resolvedProgramId = selectedProgramId || programGroups[0]?.id || null;
    if (!resolvedProgramId) {
      return;
    }

    const firstProjectForProgram = projectsOnly
      .filter(project => !project.isEvent && getProjectProgramId(project, programs) === resolvedProgramId)
      .sort(sortByDate)[0];

    setSelectedProgramId(resolvedProgramId);
    setSelectedProjectId(firstProjectForProgram?.id || null);
  };

  const openProjectDetails = (projectId: string) => {
    navigation.navigate('ProjectDetails', { projectId });
  };

  const openProgramDetails = (programId: string) => {
    setSelectedProgramDetailsId(programId);
  };

  const closeProgramDetails = () => {
    setSelectedProgramDetailsId(null);
  };

  const continueToProgramProjects = () => {
    if (!selectedProgramDetails) return;
    setSelectedProgramId(selectedProgramDetails.id);
    setSelectedProjectId(null);
    setSelectedProgramDetailsId(null);
  };

  const renderEventCard = (event: Project) => {
    const match = matchByProjectId.get(event.id);
    const joinedByUser = (event.joinedUserIds || []).includes(user?.id || '');
    const isJoined = (match?.status === 'Matched' || match?.status === 'Completed') || joinedByUser;
    const isPending = match?.status === 'Requested';
    const visual = getProgramVisual(event.programModule || event.category);
    const statusLabel = getEventStatusLabel(match, joinedByUser);
    const isLoading = loadingProjectId === event.id;

    // Check if event is completed or cancelled
    const eventStatus = event.status || 'Planning';
    const isCompleted = eventStatus === 'Completed';
    const isCancelled = eventStatus === 'Cancelled';
    const isEnded = isCompleted || isCancelled;

    // Check if event is full
    const volunteersNeeded = event.volunteersNeeded || 0;
    const currentVolunteers = event.volunteers?.length || 0;
    const pendingJoinRequests = volunteerMatches.filter(
      m => m.projectId === event.id && m.status === 'Requested'
    ).length;
    const approvedJoinRecords = joinRecords.filter(r => r.projectId === event.id).length;
    const totalSlotsTaken = currentVolunteers + pendingJoinRequests + approvedJoinRecords;
    const isFull = volunteersNeeded > 0 && totalSlotsTaken >= volunteersNeeded;

    const isDisabled = isJoined || isEnded || isFull || isLoading;

    return (
      <TouchableOpacity
        key={event.id}
        style={styles.eventCard}
        onPress={() => openProjectDetails(event.id)}
        activeOpacity={0.88}
      >
        <View style={styles.eventImageWrap}>
          <Image
            source={getProjectImageSource(event)}
            style={[styles.cardImage, (isEnded || isFull) && styles.cardImageEnded]}
          />
          <View style={[styles.floatingBadge, { backgroundColor: isFull && !isJoined ? '#dc2626' : visual.color }]}>
            <MaterialIcons
              name={isFull && !isJoined ? 'group-off' : 'event-available'}
              size={15}
              color="#fff"
            />
            <Text style={styles.floatingBadgeText}>
              {isFull && !isJoined ? 'Event Full' : statusLabel}
            </Text>
          </View>
        </View>
        <View style={styles.cardContent}>
          <View style={styles.cardLabelRow}>
            <View style={[styles.miniIcon, { backgroundColor: visual.softColor }]}>
              <MaterialIcons name="event" size={16} color={visual.color} />
            </View>
            <Text style={[styles.cardLabel, { color: visual.color }]}>Event</Text>
          </View>
          <Text style={styles.cardTitle}>{event.title}</Text>
          <View style={styles.infoRow}>
            <MaterialIcons name="schedule" size={16} color="#64748b" />
            <Text style={styles.cardDate}>{formatProjectDateRange(event.startDate, event.endDate)}</Text>
          </View>
          <Text style={styles.cardDescription} numberOfLines={3}>{event.description}</Text>
          <View style={styles.infoRow}>
            <MaterialIcons name="place" size={16} color="#64748b" />
            <Text style={styles.metaText} numberOfLines={2}>{event.location.address}</Text>
          </View>

          {/* Volunteer slots info row */}
          {volunteersNeeded > 0 ? (
            <View style={styles.infoRow}>
              <MaterialIcons name="people" size={16} color={isFull ? '#dc2626' : '#64748b'} />
              <Text style={[styles.metaText, isFull && { color: '#dc2626', fontWeight: '600' }]}>
                {isFull
                  ? `All ${volunteersNeeded} slot${volunteersNeeded === 1 ? '' : 's'} filled`
                  : `${totalSlotsTaken} / ${volunteersNeeded} volunteer slot${volunteersNeeded === 1 ? '' : 's'} taken`}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: isFull && !isJoined ? '#dc2626' : visual.color },
              isDisabled && styles.buttonDisabled,
            ]}
            onPress={() => !isDisabled && handleJoin(event.id)}
            disabled={isDisabled}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons
                name={
                  isEnded ? 'event-busy'
                  : isFull && !isJoined ? 'group-off'
                  : isJoined ? 'check-circle'
                  : 'send'
                }
                size={18}
                color="#fff"
              />
            )}
            <Text style={styles.buttonText}>
              {isLoading
                ? 'Sending...'
                : isCancelled
                ? 'Event Cancelled'
                : isCompleted
                ? 'Event Ended'
                : isFull && !isJoined
                ? 'Event Full'
                : isPending
                ? 'Pending Approval'
                : isJoined
                ? 'Joined'
                : 'Request to Join'}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Loading programs...</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.listContent}>
      {(selectedProgramId || selectedProjectId) ? (
        <TouchableOpacity style={styles.backButton} onPress={goBackOneLevel}>
          <MaterialIcons name="arrow-back" size={18} color="#166534" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroEyebrow}>Volunteer Program Suite</Text>
            <Text style={styles.heroTitle}>
              Find the right program, choose an event, and join with confidence.
            </Text>
            <Text style={styles.heroSubtitle}>
              Browse opportunities by program area and track your join requests in one place.
            </Text>
          </View>
          <View style={styles.heroIcon}>
            <MaterialIcons name="volunteer-activism" size={34} color="#ffffff" />
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{screenStats.programCount}</Text>
            <Text style={styles.statLabel}>Programs</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{screenStats.eventCount}</Text>
            <Text style={styles.statLabel}>Events</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{screenStats.joinedCount}</Text>
            <Text style={styles.statLabel}>Joined</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{screenStats.pendingCount}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
        </View>
      </View>

      <View style={styles.stepper}>
        {[
          { label: 'Program', active: !selectedProgramId },
          { label: 'Project', active: Boolean(selectedProgramId && !selectedProjectId) },
          { label: 'Event', active: Boolean(selectedProjectId) },
        ].map((step, index) => (
          <TouchableOpacity
            key={step.label}
            style={[styles.stepItem, step.active && styles.stepItemActive]}
            onPress={() => handleStepPress(step.label as 'Program' | 'Project' | 'Event')}
            activeOpacity={0.88}
          >
            <Text style={[styles.stepNumber, step.active && styles.stepNumberActive]}>{index + 1}</Text>
            <Text style={[styles.stepLabel, step.active && styles.stepLabelActive]}>{step.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!selectedProgramId && nextOpenEvent ? (
        <TouchableOpacity
          style={styles.featuredEventCard}
          onPress={() => {
            const parentProject = nextOpenEvent.parentProjectId
              ? records.find(project => project.id === nextOpenEvent.parentProjectId)
              : null;
            const programId = parentProject ? getProjectProgramId(parentProject, programs) : getProjectProgramId(nextOpenEvent, programs);
            setSelectedProgramId(programId);
            setSelectedProjectId(parentProject?.id || null);
          }}
          activeOpacity={0.88}
        >
          <View>
            <Text style={styles.featuredEyebrow}>Recommended next event</Text>
            <Text style={styles.featuredTitle} numberOfLines={2}>{nextOpenEvent.title}</Text>
            <Text style={styles.featuredMeta}>{formatProjectDateRange(nextOpenEvent.startDate, nextOpenEvent.endDate)}</Text>
          </View>
          <MaterialIcons name="arrow-forward" size={22} color="#166534" />
        </TouchableOpacity>
      ) : null}

      {!selectedProgramId ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.screenTitle}>Explore Programs</Text>
            <Text style={styles.screenSubtitle}>Start with a cause area, then choose a project and event.</Text>
          </View>
          {programGroups.length ? (
            programGroups.map(program => {
              const visual = getProgramVisual(program.id);
              return (
                <TouchableOpacity
                  key={program.id}
                  style={styles.selectionCard}
                  onPress={() => openProgramDetails(program.id)}
                  activeOpacity={0.88}
                >
                  <View style={[styles.programIcon, { backgroundColor: visual.softColor }]}>
                    <MaterialIcons name={visual.icon} size={28} color={visual.color} />
                  </View>
                  <View style={styles.selectionBody}>
                    <Text style={[styles.cardLabel, { color: visual.color }]}>Program</Text>
                    <Text style={styles.selectionTitle}>{program.title}</Text>
                    {program.description ? (
                      <Text style={styles.cardDescription} numberOfLines={2}>{program.description}</Text>
                    ) : null}
                    <View style={styles.metricPillRow}>
                      <View style={styles.metricPill}>
                        <MaterialIcons name="folder-open" size={14} color="#64748b" />
                        <Text style={styles.metricPillText}>
                          {program.projectCount} project{program.projectCount === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <View style={styles.metricPill}>
                        <MaterialIcons name="event" size={14} color="#64748b" />
                        <Text style={styles.metricPillText}>
                          {program.eventCount} event{program.eventCount === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={26} color="#94a3b8" />
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.centerContent}>
              <Text style={styles.loadingText}>No programs available right now.</Text>
            </View>
          )}
        </>
      ) : selectedProgram && !selectedProject ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.screenTitle}>{selectedProgram.title}</Text>
            <Text style={styles.screenSubtitle}>All available projects to contribute to.</Text>
          </View>
          {projectsForSelectedProgram.length ? (
            projectsForSelectedProgram.map(project => {
              const eventCount = records.filter(event => event.isEvent && event.parentProjectId === project.id).length;
              const visual = getProgramVisual(getProjectProgramId(project, programs));
              return (
                <TouchableOpacity
                  key={project.id}
                  style={styles.card}
                  onPress={() => setSelectedProjectId(project.id)}
                  activeOpacity={0.88}
                >
                  <Image source={getProjectImageSource(project)} style={styles.cardImage} />
                  <View style={styles.cardContent}>
                    <View style={styles.cardLabelRow}>
                      <View style={[styles.miniIcon, { backgroundColor: visual.softColor }]}>
                        <MaterialIcons name="business-center" size={16} color={visual.color} />
                      </View>
                      <Text style={[styles.cardLabel, { color: visual.color }]}>Project</Text>
                    </View>
                    <Text style={styles.cardTitle}>{project.title}</Text>
                    <View style={styles.infoRow}>
                      <MaterialIcons name="date-range" size={16} color="#64748b" />
                      <Text style={styles.cardDate}>{formatProjectDateRange(project.startDate, project.endDate)}</Text>
                    </View>
                    <Text style={styles.cardDescription} numberOfLines={3}>{project.description}</Text>
                    <View style={styles.projectFooter}>
                      <Text style={styles.metaText}>{eventCount} event{eventCount === 1 ? '' : 's'} inside</Text>
                      <View style={styles.openButtonLite}>
                        <Text style={styles.openButtonLiteText}>View events</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.centerContent}>
              <Text style={styles.loadingText}>No projects available right now.</Text>
            </View>
          )}
        </>
      ) : selectedProject ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.screenTitle}>{selectedProject.title}</Text>
            <Text style={styles.screenSubtitle}>Choose an event and request to join. Admin will review pending requests.</Text>
          </View>
          {eventsForSelectedProject.length ? (
            eventsForSelectedProject.map(renderEventCard)
          ) : (
            <View style={styles.centerContent}>
              <Text style={styles.loadingText}>No events available for this project.</Text>
            </View>
          )}
        </>
      ) : null}

      <Modal
        visible={Boolean(selectedProgramDetails)}
        transparent
        animationType="fade"
        onRequestClose={closeProgramDetails}
      >
        <Pressable style={styles.programModalBackdrop} onPress={closeProgramDetails}>
          <Pressable style={styles.programModalCard} onPress={() => undefined}>
            {selectedProgramDetails ? (
              <>
                <View style={styles.programModalHeader}>
                  <View
                    style={[
                      styles.programModalIcon,
                      { backgroundColor: getProgramVisual(selectedProgramDetails.id).softColor },
                    ]}
                  >
                    <MaterialIcons
                      name={getProgramVisual(selectedProgramDetails.id).icon}
                      size={28}
                      color={getProgramVisual(selectedProgramDetails.id).color}
                    />
                  </View>
                  <TouchableOpacity style={styles.programModalClose} onPress={closeProgramDetails}>
                    <MaterialIcons name="close" size={20} color="#475569" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.programModalLabel}>Program Details</Text>
                <Text style={styles.programModalTitle}>{selectedProgramDetails.title}</Text>
                <Text style={styles.programModalDescription}>
                  {selectedProgramDetails.context ||
                    selectedProgramDetails.description ||
                    'Program details will appear here once the program information is added.'}
                </Text>

                <View style={styles.programModalStats}>
                  <View style={styles.programModalStat}>
                    <Text style={styles.programModalStatValue}>{selectedProgramDetails.projectCount}</Text>
                    <Text style={styles.programModalStatLabel}>Projects</Text>
                  </View>
                  <View style={styles.programModalStat}>
                    <Text style={styles.programModalStatValue}>{selectedProgramDetails.eventCount}</Text>
                    <Text style={styles.programModalStatLabel}>Events</Text>
                  </View>
                </View>

                {projectsForProgramDetails.length ? (
                  <View style={styles.programModalSection}>
                    <Text style={styles.programModalSectionTitle}>Linked projects</Text>
                    {projectsForProgramDetails.slice(0, 3).map(project => (
                      <View key={project.id} style={styles.programModalProjectRow}>
                        <MaterialIcons name="business-center" size={16} color="#166534" />
                        <Text style={styles.programModalProjectText} numberOfLines={1}>
                          {project.title}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.programModalActions}>
                  <TouchableOpacity style={styles.programModalSecondaryButton} onPress={closeProgramDetails}>
                    <Text style={styles.programModalSecondaryText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.programModalPrimaryButton} onPress={continueToProgramProjects}>
                    <Text style={styles.programModalPrimaryText}>View projects</Text>
                    <MaterialIcons name="arrow-forward" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ModernTheme.colors.background.secondary },
  listContent: { padding: ModernTheme.spacing[3.5], paddingBottom: ModernTheme.spacing[7] },
  centerContent: { alignItems: 'center', justifyContent: 'center', padding: ModernTheme.spacing[5] },
  loadingText: { marginTop: ModernTheme.spacing[2.5], fontSize: ModernTheme.typography.fontSize.sm, color: ModernTheme.colors.text.secondary, fontWeight: ModernTheme.typography.fontWeight.semibold, textAlign: 'center' },
  heroCard: {
    backgroundColor: ModernTheme.colors.primary[900],
    borderRadius: ModernTheme.borderRadius['2xl'],
    padding: ModernTheme.spacing[4],
    marginBottom: ModernTheme.spacing[4],
    overflow: 'hidden',
    ...ModernTheme.shadows.lg,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  heroTextWrap: { flex: 1 },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '900',
    color: '#bbf7d0',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  heroTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900', color: '#ffffff' },
  heroSubtitle: { fontSize: 12, lineHeight: 18, color: '#dcfce7', marginTop: 8, fontWeight: '600' },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsGrid: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 15,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  statValue: { fontSize: 16, fontWeight: '900', color: '#ffffff' },
  statLabel: { fontSize: 10, fontWeight: '800', color: '#bbf7d0', marginTop: 2 },
  stepper: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 7,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dbe7df',
  },
  stepItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 11,
    paddingVertical: 8,
  },
  stepItemActive: { backgroundColor: '#dcfce7' },
  stepNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    textAlign: 'center',
    lineHeight: 18,
    fontSize: 10,
    fontWeight: '900',
    color: '#64748b',
    backgroundColor: '#f1f5f9',
  },
  stepNumberActive: { color: '#ffffff', backgroundColor: '#166534' },
  stepLabel: { fontSize: 10, fontWeight: '900', color: '#64748b' },
  stepLabelActive: { color: '#166534' },
  featuredEventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 13,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  featuredEyebrow: { fontSize: 10, fontWeight: '900', color: '#166534', textTransform: 'uppercase', letterSpacing: 0.6 },
  featuredTitle: { fontSize: 15, fontWeight: '900', color: '#102118', marginTop: 4 },
  featuredMeta: { fontSize: 11, fontWeight: '800', color: '#64748b', marginTop: 4 },
  sectionHeader: { marginTop: 4, marginBottom: 10 },
  screenTitle: { fontSize: 19, fontWeight: '900', color: '#102118', marginBottom: 4 },
  screenSubtitle: { fontSize: 12, color: '#64748b', lineHeight: 18 },
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backButtonText: { color: '#166534', fontWeight: '800' },
  selectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 12,
    padding: 13,
    borderWidth: 1,
    borderColor: '#dbe7df',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  programIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  selectionBody: { flex: 1 },
  selectionTitle: { fontSize: 16, fontWeight: '900', color: '#102118', marginBottom: 6 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dbe7df',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  eventCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dbe7df',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  eventImageWrap: { position: 'relative' },
  cardImage: { width: '100%', height: 142, backgroundColor: '#e5e7eb' },
  cardImageEnded: { opacity: 0.5 },
  floatingBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  floatingBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  cardContent: { padding: 13 },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  miniIcon: { width: 26, height: 26, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardTitle: { fontSize: 14, fontWeight: '900', color: '#102118', marginBottom: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 },
  cardDate: { fontSize: 12, color: '#64748b', fontWeight: '700', flex: 1 },
  cardDescription: { fontSize: 12, color: '#475569', lineHeight: 18 },
  metaText: { fontSize: 11, color: '#64748b', fontWeight: '800', flex: 1 },
  metricPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f8fafc',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  metricPillText: { fontSize: 10, color: '#64748b', fontWeight: '900' },
  projectFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  openButtonLite: { backgroundColor: '#dcfce7', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  openButtonLiteText: { color: '#166534', fontSize: 10, fontWeight: '900' },
  button: {
    padding: 12,
    borderRadius: 14,
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonDisabled: { backgroundColor: '#94a3b8' },
  buttonText: { color: '#fff', fontWeight: '900' },
  programModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: 18,
  },
  programModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbe7df',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 8,
  },
  programModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  programModalIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  programModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  programModalLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#166534',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  programModalTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
    color: '#102118',
    marginBottom: 8,
  },
  programModalDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
    fontWeight: '600',
  },
  programModalStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  programModalStat: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  programModalStatValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#102118',
  },
  programModalStatLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    marginTop: 2,
  },
  programModalSection: {
    marginTop: 16,
    gap: 8,
  },
  programModalSectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#102118',
  },
  programModalProjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  programModalProjectText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  programModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  programModalSecondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  programModalSecondaryText: {
    color: '#475569',
    fontWeight: '900',
  },
  programModalPrimaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  programModalPrimaryText: {
    color: '#ffffff',
    fontWeight: '900',
  },
});
