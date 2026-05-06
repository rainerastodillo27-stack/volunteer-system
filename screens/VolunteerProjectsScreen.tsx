import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageSourcePropType,
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
import { ProgramTrack, Project, VolunteerProjectMatch } from '../models/types';
import { getRequestErrorMessage, isAbortLikeError } from '../utils/requestErrors';

const PROGRAM_IMAGE_BY_CATEGORY: Record<Project['category'], ImageSourcePropType> = {
  Nutrition: require('../assets/programs/nutrition.jpg'),
  Education: require('../assets/programs/education.jpg'),
  Livelihood: require('../assets/programs/livelihood.jpg'),
  Disaster: require('../assets/programs/mingo-relief.jpg'),
};

const DEFAULT_PROGRAMS: Project['category'][] = ['Livelihood', 'Education', 'Nutrition'];

type ProgramGroup = {
  id: string;
  title: string;
  description?: string;
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

function getProjectProgramId(project: Project): string {
  return project.programModule || project.category;
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
  return PROGRAM_VISUALS[programId as Project['category']] || DEFAULT_PROGRAM_VISUAL;
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
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
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
        const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'programTracks', 'volunteerProfile', 'volunteerMatches']);
        const snapshotRecords = snapshot.projects || [];
        const eventCount = snapshotRecords.filter(project => project.isEvent).length;
        console.log('[VolunteerProjectsScreen] Snapshot received:', {
          recordCount: snapshotRecords.length,
          eventCount,
          trackCount: snapshot.programTracks?.length,
          matchCount: snapshot.volunteerMatches?.length,
          profile: snapshot.volunteerProfile?.id || 'none',
        });

        setRecords(snapshotRecords);
        setProgramTracks(snapshot.programTracks || []);
        if (Array.isArray(snapshot.volunteerMatches)) {
          setVolunteerMatches(snapshot.volunteerMatches);
        } else if (snapshot.volunteerProfile?.id) {
          const matches = await getVolunteerProjectMatches(snapshot.volunteerProfile.id);
          setVolunteerMatches(matches);
        } else {
          setVolunteerMatches([]);
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
      setProgramTracks([]);
      setVolunteerMatches([]);
    } finally {
      if (shouldShowBlockingLoader) {
        setLoading(false);
      }
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    void loadData();
    return subscribeToStorageChanges(['projects', 'events', 'programTracks', 'volunteerMatches', 'volunteerProjectJoins'], loadData);
  }, [loadData]));

  const programs = useMemo<ProgramGroup[]>(() => {
    const programMap = new Map<string, ProgramGroup>();

    DEFAULT_PROGRAMS.forEach(programId => {
      programMap.set(programId, {
        id: programId,
        title: programId,
        projectCount: 0,
        eventCount: 0,
      });
    });

    programTracks
      .filter(track => track.isActive !== false)
      .forEach(track => {
        programMap.set(track.id, {
          id: track.id,
          title: track.title || track.id,
          description: track.description,
          projectCount: 0,
          eventCount: 0,
        });
      });

    const projectsOnly = records.filter(project => !project.isEvent);
    const eventsOnly = records.filter(project => project.isEvent);

    projectsOnly.forEach(project => {
      const programId = getProjectProgramId(project);
      const current = programMap.get(programId) || {
        id: programId,
        title: programId,
        projectCount: 0,
        eventCount: 0,
      };
      current.projectCount += 1;
      programMap.set(programId, current);
    });

    eventsOnly.forEach(event => {
      const parentProject = event.parentProjectId
        ? projectsOnly.find(project => project.id === event.parentProjectId)
        : null;
      const programId = parentProject ? getProjectProgramId(parentProject) : getProjectProgramId(event);
      const current = programMap.get(programId) || {
        id: programId,
        title: programId,
        projectCount: 0,
        eventCount: 0,
      };
      current.eventCount += 1;
      programMap.set(programId, current);
    });

    return Array.from(programMap.values())
      .filter(program => program.projectCount > 0 || program.eventCount > 0)
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [programTracks, records]);

  const selectedProgram = useMemo(
    () => programs.find(program => program.id === selectedProgramId) || null,
    [programs, selectedProgramId]
  );

  const projectsForSelectedProgram = useMemo(
    () =>
      selectedProgramId
        ? records
            .filter(project => !project.isEvent && getProjectProgramId(project) === selectedProgramId)
            .sort(sortByDate)
        : [],
    [records, selectedProgramId]
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
      programCount: programs.length,
      projectCount: records.filter(project => !project.isEvent).length,
      eventCount: eventRecords.length,
      pendingCount,
      joinedCount,
    };
  }, [programs.length, records, volunteerMatches]);

  const nextOpenEvent = useMemo(() => {
    const now = Date.now();
    return records
      .filter(project => project.isEvent)
      .filter(event => !matchByProjectId.has(event.id))
      .filter(event => {
        const start = new Date(event.startDate).getTime();
        return Number.isNaN(start) || start >= now;
      })
      .sort(sortByDate)[0] || null;
  }, [matchByProjectId, records]);

  const handleJoin = async (eventId: string) => {
    if (!user?.id) return;
    try {
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

      const firstProgram = programs[0];
      if (firstProgram) {
        setSelectedProgramId(firstProgram.id);
        setSelectedProjectId(null);
      }
      return;
    }

    if (selectedProjectId) {
      return;
    }

    const resolvedProgramId = selectedProgramId || programs[0]?.id || null;
    if (!resolvedProgramId) {
      return;
    }

    const firstProjectForProgram = records
      .filter(project => !project.isEvent && getProjectProgramId(project) === resolvedProgramId)
      .sort(sortByDate)[0];

    setSelectedProgramId(resolvedProgramId);
    setSelectedProjectId(firstProjectForProgram?.id || null);
  };

  const openProjectDetails = (projectId: string) => {
    navigation.navigate('ProjectDetails', { projectId });
  };

  const renderEventCard = (event: Project) => {
    const match = matchByProjectId.get(event.id);
    const joinedByUser = (event.joinedUserIds || []).includes(user?.id || '');
    const isJoined = Boolean(match) || joinedByUser;
    const isPending = match?.status === 'Requested';
    const visual = getProgramVisual(event.programModule || event.category);
    const statusLabel = getEventStatusLabel(match, joinedByUser);

    return (
      <TouchableOpacity
        key={event.id}
        style={styles.eventCard}
        onPress={() => openProjectDetails(event.id)}
        activeOpacity={0.88}
      >
        <View style={styles.eventImageWrap}>
          <Image source={getProjectImageSource(event)} style={styles.cardImage} />
          <View style={[styles.floatingBadge, { backgroundColor: visual.color }]}>
            <MaterialIcons name="event-available" size={15} color="#fff" />
            <Text style={styles.floatingBadgeText}>{statusLabel}</Text>
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

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: visual.color },
              isJoined && styles.buttonDisabled,
            ]}
            onPress={() => !isJoined && handleJoin(event.id)}
            disabled={isJoined || loadingProjectId === event.id}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name={isJoined ? 'check-circle' : 'send'}
              size={18}
              color="#fff"
            />
            <Text style={styles.buttonText}>
              {loadingProjectId === event.id
                ? 'Sending...'
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
            const programId = parentProject ? getProjectProgramId(parentProject) : getProjectProgramId(nextOpenEvent);
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
          {programs.length ? (
            programs.map(program => {
              const visual = getProgramVisual(program.id);
              return (
                <TouchableOpacity
                  key={program.id}
                  style={styles.selectionCard}
                  onPress={() => {
                    setSelectedProgramId(program.id);
                    setSelectedProjectId(null);
                  }}
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
            <Text style={styles.screenSubtitle}>Select a project to see event schedules and join options.</Text>
          </View>
          {projectsForSelectedProgram.length ? (
            projectsForSelectedProgram.map(project => {
              const eventCount = records.filter(event => event.isEvent && event.parentProjectId === project.id).length;
              const visual = getProgramVisual(getProjectProgramId(project));
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
              <Text style={styles.loadingText}>No projects available for this program.</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef7ef' },
  listContent: { padding: 14, paddingBottom: 30 },
  centerContent: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { marginTop: 10, fontSize: 13, color: '#64748b', fontWeight: '700', textAlign: 'center' },
  heroCard: {
    backgroundColor: '#0f5132',
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
    overflow: 'hidden',
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
});
