import React, { useCallback, useMemo, useState } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  ActivityIndicator,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProgramModuleFromProposalProjectId,
  getPartnerDashboardSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { AdvocacyFocus, AdminPlanningCalendar, AdminPlanningItem, PartnerProjectApplication, Project } from '../models/types';
import ProjectTimelineCalendarCard from '../components/ProjectTimelineCalendarCard';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { getPrimaryProjectImageSource } from '../utils/projectMap';
import { isAbortLikeError } from '../utils/requestErrors';

type ProgramCardConfig = {
  id: string;
  title: string;
  module: AdvocacyFocus;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  accent: string;
};

const CATEGORY_TABS: Array<'All' | AdvocacyFocus> = ['All', 'Nutrition', 'Education', 'Livelihood', 'Disaster'];

const TOP_LEVEL_PROGRAM_IDS = new Set([
  'nutrition',
  'education',
  'livelihood',
  'disaster',
  'program-nutrition',
  'program-education',
  'program-livelihood',
  'program-disaster',
]);

function getAdvocacyFocusFromText(value?: string): AdvocacyFocus | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('nutrition')) return 'Nutrition';
  if (normalized.includes('education')) return 'Education';
  if (normalized.includes('livelihood')) return 'Livelihood';
  if (normalized.includes('disaster')) return 'Disaster';
  return null;
}

function getProgramModule(program: Project): AdvocacyFocus | null {
  return (
    getAdvocacyFocusFromText(program.programModule) ||
    getAdvocacyFocusFromText(program.id) ||
    getAdvocacyFocusFromText(program.title) ||
    getAdvocacyFocusFromText(program.category)
  );
}

function getProgramIcon(module: AdvocacyFocus): keyof typeof MaterialIcons.glyphMap {
  if (module === 'Nutrition') return 'restaurant';
  if (module === 'Education') return 'school';
  if (module === 'Livelihood') return 'work';
  return 'warning';
}

function getProgramAccent(module: AdvocacyFocus): string {
  if (module === 'Nutrition') return '#dc2626';
  if (module === 'Education') return '#2563eb';
  if (module === 'Livelihood') return '#7c3aed';
  return '#ea580c';
}

export default function PartnerProgramManagementScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 800;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [programs, setPrograms] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);
  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<'All' | AdvocacyFocus>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [detailModalProject, setDetailModalProject] = useState<Project | null>(null);

  const loadData = useCallback(async (showRefresh = false) => {
    if (!user) {
      setLoading(false);
      return;
    }

    if (showRefresh) {
      setRefreshing(true);
    }

    try {
      const snapshot = await getPartnerDashboardSnapshot();
      setPrograms(
        (snapshot.programs || []).filter(program => !program.isEvent && !program.parentProjectId)
      );
      setPartnerApplications(
        (snapshot.partnerApplications || []).filter(application => application.partnerUserId === user.id)
      );
      setAllProjects(snapshot.projects || []);
      setPlanningCalendars(snapshot.adminPlanningCalendars || []);
      setPlanningItems(snapshot.adminPlanningItems || []);
    } catch (error) {
      if (!isAbortLikeError(error)) {
        console.error('PartnerProgramManagementScreen loadData error:', error);
      }
    } finally {
      setLoading(false);
      if (showRefresh) {
        setRefreshing(false);
      }
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return subscribeToStorageChanges(['projects', 'programs', 'partnerProjectApplications'], () => {
        void loadData();
      });
    }, [loadData])
  );

  const programCards = useMemo<ProgramCardConfig[]>(() => {
    const byId = new Map<string, ProgramCardConfig>();

    programs.forEach(program => {
      const module = getProgramModule(program);
      const id = String(program.id || '').trim();
      if (!id || !module || byId.has(id)) {
        return;
      }

      byId.set(id, {
        id,
        title: program.title || module,
        module,
        description: program.description || `${module} program`,
        icon: getProgramIcon(module),
        accent: program.color || getProgramAccent(module),
      });
    });

    return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
  }, [programs]);

  const applicationByModule = useMemo(() => {
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

  const availableProjects = useMemo(
    () =>
      allProjects
        .filter(project => !project.isEvent && !TOP_LEVEL_PROGRAM_IDS.has(String(project.id || '').trim().toLowerCase()))
        .sort((left, right) =>
          new Date(right.updatedAt || right.createdAt || 0).getTime() -
          new Date(left.updatedAt || left.createdAt || 0).getTime()
        ),
    [allProjects]
  );

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return availableProjects.filter(project => {
      const module = getProgramModule(project);
      if (selectedCategoryTab !== 'All' && module !== selectedCategoryTab) return false;
      if (!query) return true;
      return [project.title, project.description, project.location?.address, ...(project.skillsNeeded || [])]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [availableProjects, searchQuery, selectedCategoryTab]);

  const approvedProposalProjects = useMemo(
    () =>
      partnerApplications
        .filter(application => application.status === 'Approved')
        .map(application => {
          const title =
            application.proposalDetails?.proposedTitle ||
            application.proposalDetails?.targetProjectTitle ||
            'Approved proposal';
          const module =
            getProgramModuleFromProposalProjectId(application.projectId) ||
            application.proposalDetails?.requestedProgramModule ||
            'Program';

          return {
            id: application.id,
            title,
            module,
            projectId: application.projectId,
          };
        })
        .sort((left, right) => left.title.localeCompare(right.title)),
    [partnerApplications]
  );

  const handleOpenProposal = (card: ProgramCardConfig) => {
    navigation.navigate('Messages', {
      newProposalModule: card.module,
      newProposalProjectId: card.id,
      newProposalTitle: card.title,
    });
  };

  const handleOpenProjectProposal = (project: Project) => {
    const module = getProgramModule(project) || 'Nutrition';
    setDetailModalProject(null);
    navigation.navigate('Messages', {
      newProposalModule: module,
      newProposalProjectId: project.id,
      newProposalTitle: project.title,
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#166534" />
        <Text style={styles.loadingText}>Loading programs...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroBanner}>
        <View style={styles.heroTag}>
          <MaterialIcons name="handshake" size={14} color="#166534" />
          <Text style={styles.heroTagText}>Partner Collaboration Portal</Text>
        </View>
        <Text style={styles.heroTitle}>NVC Program Management</Text>
        <Text style={styles.heroSubtitle}>
          Explore active projects, review requirements, and submit a proposal using your existing messaging workflow.
        </Text>
      </View>

      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.availableProgramHeader}>Available Projects</Text>
          <Text style={styles.sectionSubtitle}>Projects currently available for partner collaboration.</Text>
        </View>
        <Text style={styles.projectCountText}>{availableProjects.length}</Text>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScrollContent}>
          {CATEGORY_TABS.map(tab => {
            const selected = selectedCategoryTab === tab;
            const accent = tab === 'All' ? '#166534' : getProgramAccent(tab);
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.filterTab, selected && { backgroundColor: accent, borderColor: accent }]}
                onPress={() => setSelectedCategoryTab(tab)}
              >
                <Text style={[styles.filterTabText, selected && styles.filterTabTextActive]}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={styles.searchBox}>
          <MaterialIcons name="search" size={18} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search projects by name, location, or skill..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialIcons name="close" size={17} color="#94a3b8" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {availableProjects.length > 0 ? (
        filteredProjects.length > 0 ? (
          <View style={styles.projectsGrid}>
            {filteredProjects.map(project => {
              const module = getProgramModule(project) || 'Nutrition';
              const accent = getProgramAccent(module);
              const imageSource = getPrimaryProjectImageSource(project);
              return (
                <View key={project.id} style={[styles.projectCard, isDesktop && styles.projectCardDesktop]}>
                  <View style={[styles.cardHeaderWrap, { backgroundColor: accent }]}>
                    {imageSource ? <Image source={imageSource} style={styles.cardHeaderImage} resizeMode="cover" /> : null}
                    {!imageSource ? <MaterialIcons name={getProgramIcon(module)} size={46} color="#ffffff" /> : null}
                    <View style={styles.cardHeaderOverlay}>
                      <View style={[styles.moduleBadge, { backgroundColor: accent }]}>
                        <Text style={styles.moduleBadgeText}>{module.toUpperCase()}</Text>
                      </View>
                      <View style={[styles.projectStatusBadge, { backgroundColor: getProjectStatusColor(project) }]}>
                        <Text style={styles.projectStatusText}>{getProjectDisplayStatus(project)}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.projectCardTitle} numberOfLines={2}>{project.title}</Text>
                    <Text style={styles.projectCardDescription} numberOfLines={3}>{project.description || 'No project description provided.'}</Text>
                    <View style={styles.cardMetaBox}>
                      <View style={styles.metaRow}>
                        <MaterialIcons name="place" size={14} color="#64748b" />
                        <Text style={styles.metaText} numberOfLines={1}>{project.location?.address || 'Location not provided'}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        <MaterialIcons name="people" size={14} color="#64748b" />
                        <Text style={styles.metaText}>{project.volunteersNeeded || 0} volunteers requested</Text>
                      </View>
                      {project.skillsNeeded?.length ? (
                        <View style={styles.metaRow}>
                          <MaterialIcons name="psychology" size={14} color="#64748b" />
                          <Text style={styles.metaText} numberOfLines={1}>{project.skillsNeeded.join(', ')}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.cardActionRow}>
                      <TouchableOpacity style={styles.detailsButton} onPress={() => setDetailModalProject(project)}>
                        <Text style={styles.detailsButtonText}>Learn More</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.proposalButton, { backgroundColor: accent }]} onPress={() => handleOpenProjectProposal(project)}>
                        <MaterialIcons name="edit-note" size={16} color="#ffffff" />
                        <Text style={styles.proposalButtonText}>Submit Proposal</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="folder-open" size={36} color="#cbd5e1" />
            <Text style={styles.emptyText}>No projects match the selected filters.</Text>
          </View>
        )
      ) : (
        <>
          {programCards.length === 0 ? (
            <View style={styles.emptyCard}><Text style={styles.emptyText}>No programs available yet.</Text></View>
          ) : null}
          {programCards.map(card => {
            const application = applicationByModule.get(card.module);
            const buttonLabel = application ? 'Submit Another Proposal' : 'Submit Project Proposal';
            return (
              <View key={card.id} style={[styles.programCard, { borderColor: `${card.accent}66` }]}>
                <View style={styles.programHeader}>
                  <View style={[styles.iconBadge, { backgroundColor: card.accent }]}>
                    <MaterialIcons name={card.icon} size={20} color="#fff" />
                  </View>
                  <View style={styles.programCopy}>
                    <Text style={styles.programTitle}>{card.title}</Text>
                    <Text style={styles.programDescription}>{card.description}</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.primaryButton} onPress={() => handleOpenProposal(card)}>
                  <Text style={styles.primaryButtonText}>{buttonLabel}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </>
      )}

      {allProjects.length > 0 ? (
        <>
          <Text style={styles.calendarSectionHeader}>Project & Event Timeline Calendar</Text>
          <ProjectTimelineCalendarCard
            title="Program Calendar"
            subtitle="Review projects, scheduled events, and milestones."
            projects={allProjects}
            planningCalendars={planningCalendars}
            planningItems={planningItems}
            accentColor="#166534"
            emptyText="No scheduled items yet."
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            hideSecondCalendar
            onOpenProject={(projectId) => {
              const match = allProjects.find(project => project.id === projectId);
              if (match) setDetailModalProject(match);
            }}
          />
        </>
      ) : null}

      <View style={styles.sectionSpacer} />

      <Text style={styles.availableProgramHeader}>Approved Proposal Projects</Text>
      {approvedProposalProjects.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No approved proposal projects yet.</Text>
        </View>
      ) : null}
      {approvedProposalProjects.map(project => (
        <View key={project.id} style={[styles.programCard, styles.approvedCard]}>
          <View style={styles.programHeader}>
            <View style={[styles.iconBadge, { backgroundColor: '#166534' }]}>
              <MaterialIcons name="check-circle" size={20} color="#fff" />
            </View>
            <View style={styles.programCopy}>
              <Text style={styles.programTitle}>{project.title}</Text>
              <Text style={styles.programDescription}>{project.module}</Text>
            </View>
          </View>
          <Text style={styles.approvedStatusText}>Approved</Text>
        </View>
      ))}

      <Modal
        visible={Boolean(detailModalProject)}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailModalProject(null)}
      >
        <View style={styles.modalOverlay}>
          {detailModalProject ? (
            <View style={styles.detailModalCard}>
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailModalEyebrow}>{(getProgramModule(detailModalProject) || 'Program').toUpperCase()}</Text>
                  <Text style={styles.detailModalTitle}>{detailModalProject.title}</Text>
                </View>
                <TouchableOpacity onPress={() => setDetailModalProject(null)} style={styles.modalCloseButton}>
                  <MaterialIcons name="close" size={22} color="#64748b" />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.detailModalDescription}>{detailModalProject.description || 'No project description provided.'}</Text>
                <View style={styles.modalDetailBox}>
                  <Text style={styles.modalDetailLabel}>Status</Text>
                  <Text style={[styles.modalDetailValue, { color: getProjectStatusColor(detailModalProject) }]}>{getProjectDisplayStatus(detailModalProject)}</Text>
                  <Text style={styles.modalDetailLabel}>Location</Text>
                  <Text style={styles.modalDetailValue}>{detailModalProject.location?.address || 'Location not provided'}</Text>
                  <Text style={styles.modalDetailLabel}>Volunteers Target</Text>
                  <Text style={styles.modalDetailValue}>{detailModalProject.volunteersNeeded || 0}</Text>
                  <Text style={styles.modalDetailLabel}>Key Skills & Expertise</Text>
                  <Text style={styles.modalDetailValue}>{detailModalProject.skillsNeeded?.join(', ') || 'No skills specified'}</Text>
                </View>
              </ScrollView>
              <View style={styles.modalFooterRow}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDetailModalProject(null)}>
                  <Text style={styles.modalCancelText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalPrimaryButton} onPress={() => handleOpenProjectProposal(detailModalProject)}>
                  <MaterialIcons name="handshake" size={17} color="#ffffff" />
                  <Text style={styles.modalPrimaryText}>Partner With This Project</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 28,
    gap: 16,
  },
  heroBanner: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 20,
    gap: 7,
  },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
  },
  heroTagText: { fontSize: 11, fontWeight: '800', color: '#166534', textTransform: 'uppercase' },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#0f172a' },
  heroSubtitle: { fontSize: 13, lineHeight: 20, color: '#475569', maxWidth: 720 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionSubtitle: { marginTop: 4, fontSize: 12, color: '#64748b' },
  projectCountText: {
    minWidth: 34,
    textAlign: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    color: '#166534',
    fontWeight: '800',
  },
  filterBar: { gap: 10 },
  tabsScrollContent: { gap: 8 },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dbe7df',
    backgroundColor: '#ffffff',
  },
  filterTabText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  filterTabTextActive: { color: '#ffffff' },
  searchBox: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe7df',
    backgroundColor: '#ffffff',
  },
  searchInput: { flex: 1, height: '100%', fontSize: 13, color: '#0f172a' },
  projectsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  projectCard: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  projectCardDesktop: { width: '48.5%' },
  cardHeaderWrap: { height: 140, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  cardHeaderImage: { width: '100%', height: '100%' },
  cardHeaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15,23,42,0.30)',
  },
  moduleBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  moduleBadgeText: { fontSize: 10, fontWeight: '800', color: '#ffffff', letterSpacing: 0.4 },
  projectStatusBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  projectStatusText: { fontSize: 10, fontWeight: '800', color: '#ffffff', textTransform: 'uppercase' },
  cardBody: { padding: 16, gap: 11 },
  projectCardTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800', color: '#0f172a' },
  projectCardDescription: { fontSize: 12, lineHeight: 18, color: '#475569' },
  cardMetaBox: { padding: 10, gap: 8, borderRadius: 12, backgroundColor: '#f8fafc' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#334155' },
  cardActionRow: { flexDirection: 'row', gap: 10 },
  detailsButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  detailsButtonText: { fontSize: 12, fontWeight: '800', color: '#166534' },
  proposalButton: {
    flex: 1.35,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
  },
  proposalButtonText: { fontSize: 12, fontWeight: '800', color: '#ffffff' },
  calendarSectionHeader: { fontSize: 12, fontWeight: '900', color: '#166534', textTransform: 'uppercase', letterSpacing: 0.7 },
  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(15,23,42,0.68)',
  },
  detailModalCard: { width: '100%', maxWidth: 540, maxHeight: '86%', padding: 20, borderRadius: 20, backgroundColor: '#ffffff' },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  modalCloseButton: { padding: 5 },
  detailModalEyebrow: { fontSize: 10, fontWeight: '900', color: '#166534', letterSpacing: 0.6 },
  detailModalTitle: { marginTop: 4, fontSize: 20, lineHeight: 26, fontWeight: '900', color: '#0f172a' },
  detailModalDescription: { fontSize: 14, lineHeight: 22, color: '#334155', marginBottom: 14 },
  modalDetailBox: { padding: 14, gap: 4, borderRadius: 14, backgroundColor: '#f8fafc' },
  modalDetailLabel: { marginTop: 7, fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase' },
  modalDetailValue: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  modalFooterRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancelButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1' },
  modalCancelText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  modalPrimaryButton: { flex: 2, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: '#166534' },
  modalPrimaryText: { fontSize: 13, fontWeight: '800', color: '#ffffff' },
  availableProgramHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: -4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    borderRadius: 18,
    padding: 16,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#64748b',
  },
  sectionSpacer: {
    height: 4,
  },
  programCard: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderRadius: 22,
    padding: 16,
    gap: 14,
  },
  programHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  programCopy: {
    flex: 1,
    gap: 4,
  },
  programTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  programDescription: {
    fontSize: 11,
    lineHeight: 18,
    color: '#64748b',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusPillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  primaryButton: {
    backgroundColor: '#166534',
    borderRadius: 12,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  approvedCard: {
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
  },
  approvedStatusText: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    backgroundColor: '#dcfce7',
  },
  secondaryButtonText: {
    color: '#166534',
  },
  disabledButton: {
    opacity: 0.9,
  },
});
