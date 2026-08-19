import React, { useCallback, useMemo, useState } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
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
import { AdvocacyFocus, PartnerProjectApplication, Project } from '../models/types';
import { isAbortLikeError } from '../utils/requestErrors';

type ProgramCardConfig = {
  id: string;
  title: string;
  module: AdvocacyFocus;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  accent: string;
};

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [programs, setPrograms] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);

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
      return subscribeToStorageChanges(['partnerProjectApplications'], () => {
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
      <Text style={styles.availableProgramHeader}>Available Program</Text>
      {programCards.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No programs available yet.</Text>
        </View>
      ) : null}
      {programCards.map(card => {
        const application = applicationByModule.get(card.module);
        const status = application?.status;
        const proposalProjectId = card.id;
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

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => handleOpenProposal(card)}
              accessibilityLabel={`${buttonLabel} for ${card.module}`}
              testID={proposalProjectId}
            >
              <Text style={styles.primaryButtonText}>{buttonLabel}</Text>
            </TouchableOpacity>
          </View>
        );
      })}

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
