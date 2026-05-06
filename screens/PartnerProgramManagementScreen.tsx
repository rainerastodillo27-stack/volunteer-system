import React, { useCallback, useMemo, useState } from 'react';
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
  buildProgramProposalProjectId,
  getProgramModuleFromProposalProjectId,
  getPartnerDashboardSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { AdvocacyFocus, PartnerProjectApplication } from '../models/types';
import { isAbortLikeError } from '../utils/requestErrors';

type ProgramCardConfig = {
  module: AdvocacyFocus;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  accent: string;
};

const PROGRAM_CARDS: ProgramCardConfig[] = [
  {
    module: 'Nutrition',
    description: 'Food security and health programs',
    icon: 'restaurant',
    accent: '#ef4444',
  },
  {
    module: 'Education',
    description: 'Learning and skill development programs',
    icon: 'school',
    accent: '#3b82f6',
  },
  {
    module: 'Livelihood',
    description: 'Economic empowerment programs',
    icon: 'work',
    accent: '#8b5cf6',
  },
  {
    module: 'Disaster',
    description: 'Emergency relief programs',
    icon: 'warning',
    accent: '#f97316',
  },
];

export default function PartnerProgramManagementScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  const handleOpenProposal = (module: AdvocacyFocus) => {
    navigation.navigate('Dashboard', { openProposalModule: module });
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
      {PROGRAM_CARDS.map(card => {
        const application = applicationByModule.get(card.module);
        const status = application?.status;
        const proposalProjectId = buildProgramProposalProjectId(card.module);
        const isApproved = status === 'Approved';
        const isPending = status === 'Pending';
        const isRejected = status === 'Rejected';
        const badgeLabel = isApproved ? 'Approved' : isPending ? 'Pending' : isRejected ? 'Rejected' : 'Open';
        const buttonLabel = application ? 'Submit Another Proposal' : 'Submit Project Proposal';

        return (
          <View key={card.module} style={[styles.programCard, { borderColor: `${card.accent}66` }]}>
            <View style={styles.programHeader}>
              <View style={[styles.iconBadge, { backgroundColor: card.accent }]}>
                <MaterialIcons name={card.icon} size={20} color="#fff" />
              </View>

              <View style={styles.programCopy}>
                <Text style={styles.programTitle}>{card.module}</Text>
                <Text style={styles.programDescription}>{card.description}</Text>
              </View>

              <View style={[styles.statusPill, { backgroundColor: card.accent }]}>
                <Text style={styles.statusPillText}>{badgeLabel}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => handleOpenProposal(card.module)}
              accessibilityLabel={`${buttonLabel} for ${card.module}`}
              testID={proposalProjectId}
            >
              <Text style={styles.primaryButtonText}>{buttonLabel}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
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
