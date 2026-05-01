import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  Image,
  ImageSourcePropType,
  Modal,
  Platform,
  ScrollView,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { Project, PartnerProjectApplication, ProgramTrack } from '../models/types';
import { getRequestErrorMessage } from '../utils/requestErrors';
import { isAbortLikeError } from '../utils/requestErrors';
import ProjectLifecycleScreen from './ProjectLifecycleScreen';

const { width, height } = Dimensions.get('window');

const DEFAULT_PROGRAM_IMAGE = require('../assets/programs/education.jpg');
const DEFAULT_PROGRAM_ICON: keyof typeof MaterialIcons.glyphMap = 'category';
const DEFAULT_PROGRAM_COLOR = '#166534';
const CORE_PROGRAM_IDS = new Set(['Nutrition', 'Education', 'Livelihood']);

type ProgramTrackCard = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  image: ImageSourcePropType;
};

function normalizeProgramIcon(icon: string | undefined): keyof typeof MaterialIcons.glyphMap {
  if (!icon) return DEFAULT_PROGRAM_ICON;
  return icon in MaterialIcons.glyphMap ? (icon as keyof typeof MaterialIcons.glyphMap) : DEFAULT_PROGRAM_ICON;
}

function normalizeProgramColor(color: string | undefined): string {
  const trimmed = String(color || '').trim();
  if (!trimmed) return DEFAULT_PROGRAM_COLOR;
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed : DEFAULT_PROGRAM_COLOR;
}

export default function PartnerProgramManagementScreen() {
  const { user } = useAuth();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'programs' | 'my-projects'>('programs');
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'partnerApplications', 'programTracks']);
      console.log('PartnerProgramManagementScreen data received:', {
        projectCount: snapshot.projects?.length,
        applicationCount: snapshot.partnerApplications?.length,
        trackCount: snapshot.programTracks?.length,
      });
      setProjects(snapshot.projects);
      setPartnerApplications(snapshot.partnerApplications);
      setProgramTracks(snapshot.programTracks || []);
      setLoading(false);
    } catch (e) {
      if (isAbortLikeError(e)) {
        return;
      }

      console.error('PartnerProgramManagementScreen loadData error:', e);
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    loadData();
    return subscribeToStorageChanges(['projects', 'partnerApplications', 'programTracks'], loadData);
  }, [loadData]));
  useEffect(() => {
    if (typeof route.params?.programModule === 'string' && route.params.programModule.trim()) {
      setActiveTab('programs');
      setSelectedProgram(route.params.programModule.trim());
    }
    
    if (route.params?.projectId) {
        setSelectedProjectId(route.params.projectId);
        // Clear param to avoid re-opening if coming back to this screen
        navigation.setParams({ projectId: undefined });
    }
  }, [route.params]);

  const myProjects = useMemo(() => {
    return projects.filter(project => {
      const application = partnerApplications.find(a => a.projectId === project.id && a.partnerUserId === user?.id);
      return application?.status === 'Approved';
    });
  }, [projects, partnerApplications, user?.id]);

  const filteredProjects = useMemo(() => {
    if (!selectedProgram) return [];
    return projects.filter(p => !p.id.startsWith('program:') && (p.programModule === selectedProgram || p.category === selectedProgram));
  }, [projects, selectedProgram]);

  const programTemplates = useMemo(() => {
    if (!selectedProgram) return [];
    return projects.filter(p => p.id.startsWith('program:') && (p.programModule === selectedProgram || p.category === selectedProgram));
  }, [projects, selectedProgram]);

  const availablePrograms = useMemo(() => {
    const tracksById = new Map(
      (programTracks || [])
        .filter(track => track?.id)
        .map(track => [track.id, track])
    );
    const programIds = new Set<string>();
    tracksById.forEach((track, trackId) => {
      if (track.isActive === false || !CORE_PROGRAM_IDS.has(trackId)) {
        return;
      }
      programIds.add(trackId);
    });

    if (programIds.size === 0) {
      projects.forEach(project => {
        const trackId = String(project.programModule || project.category || '').trim();
        if (CORE_PROGRAM_IDS.has(trackId)) {
          programIds.add(trackId);
        }
      });
    }

    const cards: ProgramTrackCard[] = [];
    programIds.forEach(programId => {
      const track = tracksById.get(programId);
      if (track && track.isActive === false) {
        return;
      }

      const sampleProjectWithImage = projects.find(
        project =>
          (project.programModule === programId || project.category === programId) &&
          !project.imageHidden &&
          Boolean(project.imageUrl)
      );

      cards.push({
        id: programId,
        title: String(track?.title || programId),
        description: String(track?.description || 'Community programs under this track.'),
        icon: normalizeProgramIcon(track?.icon),
        color: normalizeProgramColor(track?.color),
        image: sampleProjectWithImage?.imageUrl
          ? { uri: sampleProjectWithImage.imageUrl }
          : track?.imageUrl
          ? { uri: track.imageUrl }
          : DEFAULT_PROGRAM_IMAGE,
      });
    });

    cards.sort((left, right) => {
      const leftTrack = tracksById.get(left.id);
      const rightTrack = tracksById.get(right.id);
      const leftSort = Number(leftTrack?.sortOrder || 0);
      const rightSort = Number(rightTrack?.sortOrder || 0);
      if (leftSort !== rightSort) return leftSort - rightSort;
      return left.title.localeCompare(right.title);
    });
    return cards;
  }, [programTracks, projects]);

  const programCardById = useMemo(
    () => new Map(availablePrograms.map(program => [program.id, program])),
    [availablePrograms]
  );

  const getProjectImageSource = useCallback((project: Project): ImageSourcePropType => {
    if (!project.imageHidden && project.imageUrl) {
      return { uri: project.imageUrl };
    }
    const programId = project.programModule || project.category;
    return programCardById.get(programId)?.image || DEFAULT_PROGRAM_IMAGE;
  }, [programCardById]);

  const renderProgramCard = (program: ProgramTrackCard) => (
    <TouchableOpacity 
      key={program.id}
      style={styles.programCard}
      onPress={() => setSelectedProgram(program.id)}
    >
      <Image source={program.image} style={styles.programCardImage} />
      <View style={[styles.programCardOverlay, { backgroundColor: program.color + 'CC' }]}>
        <MaterialIcons name={program.icon} size={32} color="#fff" />
        <Text style={styles.programCardTitle}>{program.title}</Text>
      </View>
      <View style={styles.programCardContent}>
        <Text style={styles.programCardDescription}>{program.description}</Text>
        <View style={styles.programCardFooter}>
          <Text style={styles.projectCountText}>
            {projects.filter(p => (p.programModule === program.id || p.category === program.id)).length} Projects
          </Text>
          <MaterialIcons name="chevron-right" size={20} color={program.color} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderProjectItem = (project: Project, isTemplate = false) => {
    const application = partnerApplications.find(a => a.projectId === project.id && a.partnerUserId === user?.id);
    const hasApplication = !!application;

    return (
      <View key={project.id} style={styles.projectCard}>
        <Image 
          source={getProjectImageSource(project)}
          style={styles.projectCardImage} 
        />
        <View style={styles.projectCardContent}>
          <View style={styles.projectHeader}>
            <Text style={styles.projectTitle}>{project.title}</Text>
            {isTemplate && <View style={styles.templateBadge}><Text style={styles.templateBadgeText}>Template</Text></View>}
          </View>
          <Text style={styles.projectDescription} numberOfLines={2}>{project.description}</Text>
          <View style={styles.projectMeta}>
            <View style={styles.metaItem}>
              <MaterialIcons name="location-on" size={14} color="#64748b" />
              <Text style={styles.metaText}>{project.location.address}</Text>
            </View>
            <View style={styles.metaItem}>
              <MaterialIcons name="event" size={14} color="#64748b" />
              <Text style={styles.metaText}>{new Date(project.startDate).toLocaleDateString()}</Text>
            </View>
          </View>
          
          {isTemplate ? (
            <TouchableOpacity 
              style={[styles.actionButton, hasApplication && styles.buttonDisabled]}
              onPress={() => !hasApplication && Alert.alert('Propose', 'Use the submission form on the Dashboard to propose this program.')}
              disabled={hasApplication}
            >
              <Text style={styles.actionButtonText}>
                {hasApplication ? `Status: ${application.status}` : 'Propose for this Program'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={[styles.actionButton, styles.secondaryButton]}
              onPress={() => setSelectedProjectId(project.id)}
            >
              <Text style={styles.secondaryButtonText}>View Project Details</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderProgramsView = () => {
    if (selectedProgram) {
      const program = availablePrograms.find(p => p.id === selectedProgram);
      return (
        <ScrollView style={styles.detailsContainer} showsVerticalScrollIndicator={false}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => setSelectedProgram(null)}
          >
            <MaterialIcons name="arrow-back" size={20} color="#166534" />
            <Text style={styles.backButtonText}>Back to Programs</Text>
          </TouchableOpacity>

          <View style={[styles.programHeaderInfo, { borderLeftColor: (program?.color || DEFAULT_PROGRAM_COLOR) }]}>
            <Text style={styles.detailsTitle}>{(program?.title || selectedProgram)} Program</Text>
            <Text style={styles.detailsSubtitle}>{program?.description || 'Community programs under this track.'}</Text>
          </View>

          {programTemplates.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listSectionTitle}>Program Templates</Text>
              <Text style={styles.listSectionSubtitle}>Pre-designed frameworks you can adapt for your community.</Text>
              {programTemplates.map(p => renderProjectItem(p, true))}
            </View>
          )}

          <View style={styles.listSection}>
            <View style={[styles.projectHeader, { marginBottom: 12 }]}>
                <Text style={styles.listSectionTitle}>Active Projects</Text>
                {user?.role === 'admin' && (
                    <TouchableOpacity 
                        style={styles.addButton}
                        onPress={() => navigation.navigate('ProjectLifecycle', { programModule: selectedProgram, projectId: 'new' })}
                    >
                        <Text style={styles.addButtonText}>+ Create</Text>
                    </TouchableOpacity>
                )}
            </View>
            <Text style={styles.listSectionSubtitle}>Ongoing activities within this program track.</Text>
            {filteredProjects.length > 0 ? (
              filteredProjects.map(p => renderProjectItem(p))
            ) : (
              <View style={styles.emptyState}>
                <MaterialIcons name="info-outline" size={40} color="#cbd5e1" />
                <Text style={styles.emptyText}>No active projects found for this program yet.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.programsGrid} showsVerticalScrollIndicator={false}>
        <Text style={styles.tabIntroTitle}>Explore Program Tracks</Text>
        <Text style={styles.tabIntroSubtitle}>Select a core program to view available templates and active projects you can propose or join.</Text>
        {availablePrograms.length > 0 ? (
          availablePrograms.map(renderProgramCard)
        ) : (
          <View style={styles.emptyState}>
            <MaterialIcons name="info-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyText}>No program tracks are available yet.</Text>
          </View>
        )}
      </ScrollView>
    );
  };

  const renderMyProjectsView = () => (
    <ScrollView contentContainerStyle={styles.myProjectsContainer} showsVerticalScrollIndicator={false}>
      <Text style={styles.tabIntroTitle}>Your Partnerships</Text>
      <Text style={styles.tabIntroSubtitle}>Manage the projects your organization is currently approved to participate in.</Text>
      {myProjects.length > 0 ? (
        myProjects.map(p => renderProjectItem(p))
      ) : (
        <View style={styles.emptyStateFull}>
          <MaterialIcons name="assignment-late" size={60} color="#cbd5e1" />
          <Text style={styles.emptyTitle}>No Approved Projects</Text>
          <Text style={styles.emptySubText}>When your project proposals are approved by the admin, they will appear here for tracking and management.</Text>
          <TouchableOpacity 
            style={styles.browseButton}
            onPress={() => setActiveTab('programs')}
          >
            <Text style={styles.browseButtonText}>Browse Programs</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'programs' && styles.activeTab]}
          onPress={() => {
              setActiveTab('programs');
              setSelectedProgram(null);
          }}
        >
          <Text style={[styles.tabText, activeTab === 'programs' && styles.activeTabText]}>Browse Programs</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'my-projects' && styles.activeTab]}
          onPress={() => setActiveTab('my-projects')}
        >
          <Text style={[styles.tabText, activeTab === 'my-projects' && styles.activeTabText]}>My Projects</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <Text>Loading management suite...</Text>
          </View>
        ) : activeTab === 'programs' ? (
          renderProgramsView()
        ) : (
          renderMyProjectsView()
        )}
      </View>

      <Modal
        visible={!!selectedProjectId}
        animationType="slide"
        onRequestClose={() => setSelectedProjectId(null)}
      >
        <View style={styles.modalHeader}>
           <TouchableOpacity 
             style={styles.modalCloseButton}
             onPress={() => setSelectedProjectId(null)}
           >
             <MaterialIcons name="close" size={24} color="#0f172a" />
             <Text style={styles.modalCloseText}>Close Details</Text>
           </TouchableOpacity>
        </View>
        <View style={{ flex: 1 }}>
          <ProjectLifecycleScreen 
            navigation={navigation} 
            route={{ params: { projectId: selectedProjectId } }} 
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  tabBar: { 
    flexDirection: 'row', 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 16,
  },
  tab: { 
    flex: 1, 
    paddingVertical: 14, 
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: { 
    borderBottomColor: '#166534',
  },
  tabText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  activeTabText: { color: '#166534' },
  content: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabIntroTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginTop: 16, marginHorizontal: 16 },
  tabIntroSubtitle: { fontSize: 13, color: '#64748b', marginTop: 4, marginHorizontal: 16, marginBottom: 16, lineHeight: 18 },
  programsGrid: { padding: 16, gap: 16 },
  programCard: { 
    backgroundColor: '#fff', 
    borderRadius: 20, 
    overflow: 'hidden', 
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  programCardImage: { width: '100%', height: 120 },
  programCardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  programCardTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  programCardContent: { padding: 16 },
  programCardDescription: { fontSize: 13, color: '#475569', lineHeight: 18 },
  programCardFooter: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  projectCountText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  detailsContainer: { flex: 1, padding: 16 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  backButtonText: { color: '#166534', fontWeight: '700', fontSize: 14 },
  programHeaderInfo: { 
    paddingLeft: 16, 
    borderLeftWidth: 4, 
    marginBottom: 24,
    gap: 4,
  },
  detailsTitle: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  detailsSubtitle: { fontSize: 14, color: '#64748b', lineHeight: 20 },
  listSection: { marginBottom: 24 },
  listSectionTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  listSectionSubtitle: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  projectCard: { 
    backgroundColor: '#fff', 
    borderRadius: 16, 
    marginBottom: 16, 
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  projectCardImage: { width: '100%', height: 160 },
  projectCardContent: { padding: 16, gap: 8 },
  projectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addButton: { backgroundColor: '#166534', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  addButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  projectTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', flex: 1 },
  templateBadge: { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#dcfce7' },
  templateBadgeText: { fontSize: 10, fontWeight: '800', color: '#166534', textTransform: 'uppercase' },
  projectDescription: { fontSize: 13, color: '#475569', lineHeight: 18 },
  projectMeta: { flexDirection: 'column', gap: 6, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: '#64748b' },
  actionButton: { 
    backgroundColor: '#166534', 
    paddingVertical: 12, 
    borderRadius: 10, 
    alignItems: 'center',
    marginTop: 8,
  },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  buttonDisabled: { backgroundColor: '#dcfce7' },
  secondaryButton: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  secondaryButtonText: { color: '#475569', fontWeight: '700' },
  emptyState: { 
    alignItems: 'center', 
    padding: 32, 
    backgroundColor: '#fff', 
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
  },
  emptyText: { marginTop: 12, color: '#94a3b8', textAlign: 'center', fontSize: 13 },
  emptyStateFull: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginTop: 16 },
  emptySubText: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  browseButton: { backgroundColor: '#166534', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 24 },
  browseButtonText: { color: '#fff', fontWeight: '700' },
  myProjectsContainer: { paddingBottom: 32 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalCloseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
});
