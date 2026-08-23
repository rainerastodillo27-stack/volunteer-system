import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProject,
  getVolunteerProjectMatches,
  subscribeToStorageChanges,
  getAllPartners,
  getAllProjects,
  requestVolunteerProjectJoin,
  getVolunteerByUserId,
} from '../models/storage';
import { Project, Volunteer, VolunteerProjectMatch, Partner } from '../models/types';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getRequestErrorMessage } from '../utils/requestErrors';
import { getPrimaryProjectImageSource } from '../utils/projectMap';
import { openAddGoogleCalendarEvent } from '../utils/calendarSync';

export default function VolunteerProjectDetailsScreen({
  navigation,
  route,
}: {
  navigation: any;
  route: any;
}) {
  const { user } = useAuth();
  const projectId = route?.params?.projectId;

  const [project, setProject] = useState<Project | null>(null);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [parentProject, setParentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkLayout = () => {
      const { width } = Dimensions.get('window');
      setIsDesktop(width >= 1024);
    };
    checkLayout();
    const subscription = Dimensions.addEventListener('change', checkLayout);
    return () => subscription.remove();
  }, []);

  const loadData = useCallback(async () => {
    if (!projectId || !user?.id) return;

    try {
      setLoading(true);
      const profile = await getVolunteerByUserId(user.id);
      setVolunteerProfile(profile);

      const volunteerId = profile?.id || user.id;

      const [projectData, matches, partnersList, projectsList] = await Promise.all([
        getProject(projectId),
        getVolunteerProjectMatches(volunteerId).catch(() => []),
        getAllPartners().catch(() => []),
        getAllProjects().catch(() => []),
      ]);

      setProject(projectData);
      setVolunteerMatches(matches);
      setPartners(partnersList);

      if (projectData?.parentProjectId) {
        const parent = projectsList.find((p) => p.id === projectData.parentProjectId);
        setParentProject(parent || null);
      } else {
        setParentProject(null);
      }
    } catch (error) {
      console.error('Error loading project details:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      return subscribeToStorageChanges(
        ['projects', 'volunteerMatches'],
        loadData
      );
    }, [loadData])
  );


  const handleJoinEvent = async () => {
    if (!user?.id || !project) return;
    try {
      setLoadingAction('join');
      const match = await requestVolunteerProjectJoin(project.id, user.id);
      setVolunteerMatches(prev => [match, ...prev.filter(existing => existing.projectId !== project.id)]);
      Alert.alert('Success', `Successfully requested to join "${project.title}"!`);
      void loadData();
    } catch (err) {
      Alert.alert('Error', getRequestErrorMessage(err, 'Failed to join event'));
    } finally {
      setLoadingAction(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerWrapper}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!project) {
    return (
      <View style={styles.centerWrapper}>
        <MaterialIcons name="folder-open" size={48} color="#ccc" />
        <Text style={styles.errorText}>Event not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentMatch = volunteerMatches.find((m) => m.projectId === project.id);
  const joinedByUser =
    (project.joinedUserIds || []).includes(user?.id || '') ||
    Boolean(volunteerProfile?.id && (project.volunteers || []).includes(volunteerProfile.id));
  const isJoined =
    currentMatch?.status === 'Matched' ||
    currentMatch?.status === 'Completed' ||
    joinedByUser;
  const isPending = currentMatch?.status === 'Requested';
  const wasRejected = currentMatch?.status === 'Rejected';

  const partnerInfo = partners.find((p) => p.id === project.partnerId) || null;

  const joinedCount = project.volunteers?.length || 0;
  const totalSlots = project.volunteersNeeded || 30;

  const formatEventDate = (start: string, end: string) => {
    if (!start) return 'TBD';
    try {
      return format(new Date(start), 'MMM d, yyyy (EEEE)');
    } catch {
      return start;
    }
  };

  const formatEventTime = (start: string, end: string) => {
    if (!start || !end) return 'TBD';
    try {
      return `${format(new Date(start), 'h:mm a')} - ${format(new Date(end), 'h:mm a')}`;
    } catch {
      return 'TBD';
    }
  };

  const projectImageSource = getPrimaryProjectImageSource(project);

  const renderJoinButton = (styleProps = {}) => {
    if (isPending) {
      return (
        <View style={[styles.joinBtn, styles.joinBtnPending, styleProps]}>
          <MaterialIcons name="hourglass-empty" size={18} color="#b06000" style={{ marginRight: 6 }} />
          <Text style={[styles.joinBtnText, { color: '#b06000' }]}>Pending</Text>
        </View>
      );
    }
    if (isJoined) {
      return (
        <View style={[styles.joinBtn, styles.joinBtnJoined, styleProps]}>
          <MaterialIcons name="check" size={18} color="#137333" style={{ marginRight: 6 }} />
          <Text style={[styles.joinBtnText, { color: '#137333' }]}>Approved</Text>
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={[styles.joinBtn, styleProps]}
        activeOpacity={0.85}
        onPress={handleJoinEvent}
        disabled={loadingAction === 'join'}
      >
        {loadingAction === 'join' ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <MaterialIcons name="person-add" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.joinBtnText}>{wasRejected ? 'Apply Again' : 'Join Event'}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  const renderLeftColumn = () => (
    <View style={styles.leftColumn}>
      {/* Hero Card */}
      <View style={styles.heroCard}>
        <View style={[styles.heroRow, !isDesktop && { flexDirection: 'column' }]}>
          {projectImageSource && (
            <View style={[styles.heroImageContainer, !isDesktop && { width: '100%', height: 220 }]}>
              <Image source={projectImageSource} style={styles.heroImage} resizeMode="cover" />
              <View style={styles.imageOverlayBadges}>
                <View style={styles.overlayBadgeGreen} {...({} as any)}>
                  <Text style={styles.overlayBadgeText}>EVENT</Text>
                </View>
                <View style={styles.overlayBadgeLightGreen} {...({} as any)}>
                  <Text style={styles.overlayBadgeTextLight}>
                    {project.category ? project.category.toUpperCase() : 'NUTRITION'}
                  </Text>
                </View>
              </View>
            </View>
          )}

          <View style={[styles.heroDetails, !isDesktop && { minWidth: '100%' }]}>
            <Text style={styles.heroTitle}>{project.title}</Text>

            <View style={[styles.statusBadge, { backgroundColor: isJoined ? '#e6f4ea' : isPending ? '#fef7e0' : '#e6f4ea' }]}>
              <Text style={[styles.statusBadgeText, { color: isJoined ? '#137333' : isPending ? '#b06000' : '#137333' }]}>
                {isJoined ? 'Approved' : isPending ? 'Pending' : 'Open'}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <MaterialIcons name="folder" size={16} color="#64748b" style={{ marginRight: 6 }} />
              <Text style={styles.metaText}>{parentProject?.title || project.programModule || 'NVC Program'}</Text>
            </View>

            <View style={styles.metaRow}>
              <MaterialIcons name="calendar-today" size={16} color="#64748b" style={{ marginRight: 6 }} />
              <Text style={styles.metaText}>{formatEventDate(project.startDate, project.endDate)}</Text>
            </View>

            <View style={styles.metaRow}>
              <MaterialIcons name="access-time" size={16} color="#64748b" style={{ marginRight: 6 }} />
              <Text style={styles.metaText}>{formatEventTime(project.startDate, project.endDate)}</Text>
            </View>

            <View style={styles.metaRow}>
              <MaterialIcons name="place" size={16} color="#64748b" style={{ marginRight: 6 }} />
              <Text style={styles.metaText}>{project.location.address}</Text>
            </View>

            <View style={styles.heroActions}>
              {renderJoinButton({ flex: 1 })}
              <TouchableOpacity style={styles.bookmarkBtn} activeOpacity={0.8}>
                <MaterialIcons name="bookmark-border" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Overview Grid Card */}
      <View style={[styles.detailsCard, !isDesktop && { padding: 16 }]}>
        <View style={styles.cardHeaderRow}>
          <MaterialIcons name="info-outline" size={20} color="#166534" />
          <Text style={styles.cardSectionTitle}>Overview</Text>
        </View>

        <View style={styles.overviewGrid}>
          <View style={[styles.overviewCell, !isDesktop && { width: '47%', minWidth: 100 }]} {...({} as any)}>
            <MaterialIcons name="group" size={20} color="#166534" style={{ marginBottom: 6 }} />
            <Text style={styles.cellLabel}>Volunteer Slots</Text>
            <Text style={styles.cellValue}>{`${joinedCount} / ${totalSlots}`}</Text>
            <Text style={styles.cellSub}>filled</Text>
          </View>

          <View style={[styles.overviewCell, !isDesktop && { width: '47%', minWidth: 100 }]} {...({} as any)}>
            <MaterialIcons name="calendar-today" size={20} color="#166534" style={{ marginBottom: 6 }} />
            <Text style={styles.cellLabel}>Date</Text>
            <Text style={styles.cellValue} numberOfLines={1}>
              {project.startDate ? format(new Date(project.startDate), 'MMM d, yyyy') : 'TBD'}
            </Text>
            <Text style={styles.cellSub}>
              {project.startDate ? format(new Date(project.startDate), '(EEEE)') : ''}
            </Text>
          </View>

          <View style={[styles.overviewCell, !isDesktop && { width: '47%', minWidth: 100 }]} {...({} as any)}>
            <MaterialIcons name="access-time" size={20} color="#166534" style={{ marginBottom: 6 }} />
            <Text style={styles.cellLabel}>Time</Text>
            <Text style={styles.cellValue} numberOfLines={1}>
              {project.startDate ? format(new Date(project.startDate), 'h:mm a') : 'TBD'}
            </Text>
            <Text style={styles.cellSub}>
              {project.endDate ? `to ${format(new Date(project.endDate), 'h:mm a')}` : ''}
            </Text>
          </View>

          <View style={[styles.overviewCell, !isDesktop && { width: '47%', minWidth: 100 }]} {...({} as any)}>
            <MaterialIcons name="place" size={20} color="#166534" style={{ marginBottom: 6 }} />
            <Text style={styles.cellLabel}>Location</Text>
            <Text style={styles.cellValue} numberOfLines={2}>
              {project.location.address.split(',')[0]}
            </Text>
            <Text style={styles.cellSub}>Bacolod City</Text>
          </View>
        </View>
      </View>

      {/* About This Event Card */}
      <View style={styles.detailsCard}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.roundIconBadge} {...({} as any)}>
            <MaterialIcons name="description" size={16} color="#166534" />
          </View>
          <Text style={styles.cardSectionTitle}>About This Event</Text>
        </View>
        <Text style={styles.bodyDescriptionText}>{project.description}</Text>
      </View>



      {/* Requirements Card */}
      <View style={styles.detailsCard}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.roundIconBadge} {...({} as any)}>
            <MaterialIcons name="assignment" size={16} color="#166534" />
          </View>
          <Text style={styles.cardSectionTitle}>Requirements</Text>
        </View>

        <View style={styles.bulletListContainer}>
          {(project.volunteerRequirements && project.volunteerRequirements.length > 0
            ? project.volunteerRequirements
            : [
                '18 years old and above',
                'Attend volunteer orientation',
                'Follow event guidelines',
                'Wear appropriate clothing',
              ]
          ).map((reqText, idx) => (
            <View key={idx} style={styles.bulletRow} {...({} as any)}>
              <Text style={styles.bulletPoint}>•</Text>
              <Text style={styles.bulletText}>{reqText}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.skillsHeading}>Required Skills</Text>
        <View style={styles.skillsContainer}>
          {(project.skillsNeeded && project.skillsNeeded.length > 0
            ? project.skillsNeeded
            : ['Community Outreach', 'Event Support']
          ).map((skill) => (
            <View key={skill} style={styles.skillPill} {...({} as any)}>
              <Text style={styles.skillPillText}>{skill}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Application Card */}
      <View style={styles.detailsCard}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.roundIconBadge} {...({} as any)}>
            <MaterialIcons name="person" size={16} color="#166534" />
          </View>
          <Text style={styles.cardSectionTitle}>Application</Text>
        </View>

        <Text style={styles.appSlotsLabel}>Volunteer Slots</Text>
        <Text style={styles.appSlotsValue}>{`${joinedCount} / ${totalSlots} filled`}</Text>

        <View style={{ marginTop: 16 }}>{renderJoinButton()}</View>

        <View style={styles.deadlineRow} {...({} as any)}>
          <MaterialIcons name="access-time" size={14} color="#64748b" style={{ marginRight: 6 }} />
          <Text style={styles.deadlineText}>
            Application deadline:{' '}
            {project.startDate
              ? format(new Date(new Date(project.startDate).getTime() - 4 * 86400000), 'MMM d, yyyy')
              : 'TBD'}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderRightColumn = () => (
    <View style={styles.rightColumn}>
      {/* Organizer Card */}
      <View style={styles.rightCard}>
        <Text style={styles.rightCardHeaderTitle}>Organizer</Text>
        <View style={styles.organizerProfileRow} {...({} as any)}>
          <View style={styles.heartAvatarBg} {...({} as any)}>
            <MaterialIcons name="favorite" size={22} color="#166534" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.organizerName}>{partnerInfo?.name || 'NVC Foundation'}</Text>
            <Text style={styles.organizerSub}>
              {partnerInfo?.category || 'Nutrition Program'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.outlineBtn}
          activeOpacity={0.8}
          onPress={() => Alert.alert('Organization', 'Show Organization details.')}
        >
          <Text style={styles.outlineBtnText}>View Organization</Text>
        </TouchableOpacity>
      </View>

      {/* Part of Project Card */}
      <View style={styles.rightCard}>
        <View style={styles.rightCardHeaderRow} {...({} as any)}>
          <MaterialIcons name="folder" size={18} color="#1e293b" />
          <Text style={styles.rightCardHeaderTitle}>Part of Project</Text>
        </View>
        <Text style={styles.partOfProjectTitle}>
          {parentProject?.title || project.programModule || 'NVC Program'}
        </Text>
        <Text style={styles.partOfProjectSub}>
          {parentProject?.location?.address || project.location?.address || 'Philippines'}
        </Text>
        <TouchableOpacity
          style={styles.outlineBtn}
          activeOpacity={0.8}
          onPress={() => {
            if (parentProject) {
              navigation.navigate('ProjectDetails', { projectId: parentProject.id });
            } else {
              Alert.alert('Project Details', 'No parent project linked.');
            }
          }}
        >
          <Text style={styles.outlineBtnText}>View Project</Text>
        </TouchableOpacity>
      </View>

      {/* Event Reminders Card */}
      <View style={[styles.rightCard, styles.remindersCard]}>
        <View style={styles.rightCardHeaderRow} {...({} as any)}>
          <MaterialIcons name="notifications-none" size={18} color="#166534" />
          <Text style={[styles.rightCardHeaderTitle, { color: '#166534' }]}>Event Reminders</Text>
        </View>
        <Text style={styles.reminderCardText}>
          You will receive a reminder 1 day before the event.
        </Text>
      </View>

      {/* Need Help Card */}
      <View style={styles.rightCard}>
        <View style={styles.rightCardHeaderRow} {...({} as any)}>
          <MaterialIcons name="help-outline" size={18} color="#1e293b" />
          <Text style={styles.rightCardHeaderTitle}>Need Help?</Text>
        </View>
        <Text style={styles.reminderCardText}>
          Learn more about volunteering and event guidelines.
        </Text>
        <TouchableOpacity
          style={styles.outlineBtn}
          activeOpacity={0.8}
          onPress={() => Alert.alert('Guide', 'Opening volunteer guidelines...')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.outlineBtnText}>View Guide</Text>
            <MaterialIcons name="open-in-new" size={14} color="#475569" />
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Top Navbar */}
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBackBtn}>
          <MaterialIcons name="arrow-back" size={20} color="#1e293b" />
          <Text style={styles.navBackText}>Back to Events</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navBellBtn}>
          <MaterialIcons name="notifications-none" size={22} color="#1e293b" />
          <View style={styles.bellRedBadge} {...({} as any)}>
            <Text style={styles.bellBadgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, !isDesktop && { padding: 16 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.layoutGrid, { flexDirection: isDesktop ? 'row' : 'column' }]}>
          {renderLeftColumn()}
          {isDesktop && renderRightColumn()}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  centerWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 15,
    color: '#64748b',
    marginBottom: 12,
  },
  backButton: {
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  navbar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  navBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navBackText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  navBellBtn: {
    position: 'relative',
    padding: 4,
  },
  bellRedBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#ef4444',
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  scrollContent: {
    padding: 24,
  },
  layoutGrid: {
    gap: 24,
  },
  leftColumn: {
    flex: 2.2,
    gap: 16,
  },
  rightColumn: {
    flex: 1,
    gap: 16,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 20,
    flexWrap: 'wrap',
  },
  heroImageContainer: {
    width: 320,
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f1f5f9',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlayBadges: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 8,
  },
  overlayBadgeGreen: {
    backgroundColor: '#166534',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  overlayBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  overlayBadgeLightGreen: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  overlayBadgeTextLight: {
    color: '#166534',
    fontSize: 10,
    fontWeight: '800',
  },
  heroDetails: {
    flex: 1,
    minWidth: 260,
    gap: 8,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  metaText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  heroActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    alignItems: 'center',
  },
  joinBtn: {
    height: 40,
    backgroundColor: '#166534',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  joinBtnPending: {
    backgroundColor: '#fef7e0',
    borderWidth: 1.5,
    borderColor: '#fcd34d',
  },
  joinBtnJoined: {
    backgroundColor: '#e6f4ea',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
  },
  joinBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  bookmarkBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  detailsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  roundIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  overviewCell: {
    width: '31%',
    minWidth: 100,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    alignItems: 'center',
  },
  cellLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
    marginBottom: 4,
  },
  cellValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  cellSub: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
  },
  bodyDescriptionText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  bulletListContainer: {
    gap: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bulletPoint: {
    fontSize: 14,
    color: '#166534',
    lineHeight: 18,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#475569',
  },
  skillsHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
    marginTop: 16,
    marginBottom: 8,
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillPill: {
    backgroundColor: '#f0fdf4',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  skillPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  appSlotsLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '700',
  },
  appSlotsValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  deadlineText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  rightCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
  },
  rightCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  rightCardHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  organizerProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  heartAvatarBg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  organizerName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  organizerSub: {
    fontSize: 12,
    color: '#64748b',
  },
  outlineBtn: {
    height: 38,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  outlineBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  partOfProjectTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  partOfProjectSub: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 14,
  },
  remindersCard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  reminderCardText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  timeLogActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  timeLogContent: {
    flex: 1,
  },
  timeLogStatus: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f59e0b',
  },
  timeLogTime: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  timeLogButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  timeLogButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  timeLogStartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  timeLogStartButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  timeLogsHistory: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
  },
  timeLogsHistoryTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    marginBottom: 6,
  },
  timeLogEntry: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  timeLogEntryDate: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  timeLogEntryDuration: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
});
