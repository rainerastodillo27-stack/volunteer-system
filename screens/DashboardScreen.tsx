import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  getAllVolunteerTimeLogs,
  getAllPartnerReports,
  getAllPublishedImpactReports,
  getDashboardSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';

// Shows the latest dashboard metrics and shortcuts for the logged-in user.
export default function DashboardScreen({ navigation }: any) {
  const { user, isAdmin, logout } = useAuth();
  const [projectStats, setProjectStats] = useState({ total: 0, active: 0, completed: 0 });
  const [partnerStats, setPartnerStats] = useState({ total: 0, approved: 0, pending: 0 });
  const [userStats, setUserStats] = useState({ total: 0 });
  const [workflowStats, setWorkflowStats] = useState({
    inboundInquiries: 0,
    timeIns: 0,
    timeOuts: 0,
    pendingReports: 0,
    publishedReports: 0,
  });
  const [timeTrackingTarget, setTimeTrackingTarget] = useState({
    latestTimeInProjectId: undefined as string | undefined,
    latestTimeOutProjectId: undefined as string | undefined,
  });
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Loads dashboard totals and recent status updates from storage.
  const loadDashboardData = React.useCallback(async () => {
    try {
      const [{ projects, partners, users, statusUpdates }, volunteerTimeLogs, partnerReports, impactReports] =
        await Promise.all([
          getDashboardSnapshot(),
          getAllVolunteerTimeLogs(),
          getAllPartnerReports(),
          getAllPublishedImpactReports(),
        ]);

      setLoadError(null);

      setProjectStats({
        total: projects.length,
        active: projects.filter(p => p.status === 'In Progress').length,
        completed: projects.filter(p => p.status === 'Completed').length,
      });

      setPartnerStats({
        total: partners.length,
        approved: partners.filter(p => p.status === 'Approved').length,
        pending: partners.filter(p => p.status === 'Pending').length,
      });

      setUserStats({
        total: users.length,
      });

      setWorkflowStats({
        inboundInquiries: partners.filter(p => p.status === 'Pending').length,
        timeIns: volunteerTimeLogs.length,
        timeOuts: volunteerTimeLogs.filter(log => Boolean(log.timeOut)).length,
        pendingReports: partnerReports.filter(report => report.status === 'Submitted').length,
        publishedReports: impactReports.filter(report => Boolean(report.publishedAt)).length,
      });

      const latestTimeInLog = volunteerTimeLogs[0];
      const latestTimeOutLog =
        volunteerTimeLogs.find(log => Boolean(log.timeOut)) || null;
      setTimeTrackingTarget({
        latestTimeInProjectId: latestTimeInLog?.projectId,
        latestTimeOutProjectId: latestTimeOutLog?.projectId,
      });

      // Get recent updates
      const projectNamesById = new Map(projects.map(project => [project.id, project.title]));
      const allUpdates = statusUpdates
        .map(update => ({
          ...update,
          projectName: projectNamesById.get(update.projectId) || 'Unknown Project',
        }))
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      setRecentUpdates(allUpdates.slice(0, 5));
    } catch (error: any) {
      setLoadError(
        error?.message || 'Database data is unavailable. Check the backend and Supabase connection.'
      );
      setRecentUpdates([]);
      Alert.alert('Error', error?.message || 'Failed to load dashboard data from Postgres.');
    }
  }, []);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  useFocusEffect(
    React.useCallback(() => {
      void loadDashboardData();
    }, [loadDashboardData])
  );

  useEffect(() => {
    return subscribeToStorageChanges(
      ['users', 'projects', 'partners', 'volunteers', 'statusUpdates', 'volunteerProjectJoins', 'volunteerTimeLogs', 'partnerReports', 'publishedImpactReports'],
      () => {
        void loadDashboardData();
      }
    );
  }, [loadDashboardData]);

  // Confirms logout before clearing the current authenticated session.
  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Are you sure you want to logout?') : true;
      if (confirmed) {
        await logout();
      }
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Logout',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  };

  const displayName =
    Platform.OS === 'web' && user?.role === 'admin' ? 'NVC Admin Account' : user?.name;
  const roleLabel =
    user?.role === 'admin'
      ? Platform.OS === 'web'
        ? 'NVC Admin Account'
        : 'Administrator'
      : 'Volunteer Account';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header with User Info */}
      <View style={styles.header}>
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName?.charAt(0) ?? 'N'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Welcome, {displayName}</Text>
            <Text style={styles.role}>{roleLabel}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout}>
            <MaterialIcons name="logout" size={24} color="#666" />
          </TouchableOpacity>
        </View>
      </View>

      {loadError && (
        <View style={styles.errorBanner}>
          <MaterialIcons name="error-outline" size={20} color="#991b1b" />
          <View style={styles.errorBannerContent}>
            <Text style={styles.errorBannerTitle}>Database Unavailable</Text>
            <Text style={styles.errorBannerText}>{loadError}</Text>
          </View>
          <TouchableOpacity onPress={loadDashboardData}>
            <Text style={styles.errorBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Key Metrics */}
      {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>

          <View style={styles.metricsGrid}>
            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigation.navigate('Projects')}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <MaterialIcons name="folder" size={32} color="#4CAF50" />
              <Text style={styles.metricValue}>{projectStats.total}</Text>
              <Text style={styles.metricLabel}>Projects</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigation.navigate('Partners')}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <MaterialIcons name="business" size={32} color="#66BB6A" />
              <Text style={styles.metricValue}>{partnerStats.total}</Text>
              <Text style={styles.metricLabel}>Partners</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigation.navigate('Users')}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <MaterialIcons name="group" size={32} color="#4CAF50" />
              <Text style={styles.metricValue}>{userStats.total}</Text>
              <Text style={styles.metricLabel}>Users</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigation.navigate('Projects')}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <MaterialIcons name="trending-up" size={32} color="#2E7D32" />
              <Text style={styles.metricValue}>{projectStats.active}</Text>
              <Text style={styles.metricLabel}>Active</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admin Workflow</Text>
          <View style={styles.metricsGrid}>
            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigation.navigate('Partners')}
              activeOpacity={0.8}
            >
              <MaterialIcons name="mark-email-unread" size={32} color="#f59e0b" />
              <Text style={styles.metricValue}>{workflowStats.inboundInquiries}</Text>
              <Text style={styles.metricLabel}>Inbound Inquiries</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() =>
                navigation.navigate('Lifecycle', {
                  projectId: timeTrackingTarget.latestTimeInProjectId,
                })
              }
              activeOpacity={0.8}
            >
              <MaterialIcons name="login" size={32} color="#2563eb" />
              <Text style={styles.metricValue}>{workflowStats.timeIns}</Text>
              <Text style={styles.metricLabel}>Time Ins</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() =>
                navigation.navigate('Lifecycle', {
                  projectId: timeTrackingTarget.latestTimeOutProjectId,
                })
              }
              activeOpacity={0.8}
            >
              <MaterialIcons name="logout" size={32} color="#0f766e" />
              <Text style={styles.metricValue}>{workflowStats.timeOuts}</Text>
              <Text style={styles.metricLabel}>Time Outs</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigation.navigate('Lifecycle')}
              activeOpacity={0.8}
            >
              <MaterialIcons name="assignment-late" size={32} color="#dc2626" />
              <Text style={styles.metricValue}>{workflowStats.pendingReports}</Text>
              <Text style={styles.metricLabel}>Pending Reports</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigation.navigate('Lifecycle')}
              activeOpacity={0.8}
            >
              <MaterialIcons name="published-with-changes" size={32} color="#16a34a" />
              <Text style={styles.metricValue}>{workflowStats.publishedReports}</Text>
              <Text style={styles.metricLabel}>Published Files</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Project Overview */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Project Overview</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Projects')}>
            <Text style={styles.viewAll}>View All</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('Projects')}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <MaterialIcons name="av-timer" size={20} color="#66BB6A" />
              <Text style={styles.statText}>
                <Text style={styles.statValue}>In Progress</Text>
                <Text style={styles.statCount}>{'\n'}{projectStats.active}</Text>
              </Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.statItem}>
              <MaterialIcons name="check-circle" size={20} color="#4CAF50" />
              <Text style={styles.statText}>
                <Text style={styles.statValue}>Completed</Text>
                <Text style={styles.statCount}>{'\n'}{projectStats.completed}</Text>
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* Partner Overview (Admin Only) */}
      {isAdmin && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Partner Overview</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Partners')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Partners')}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <View style={styles.statRow}>
              <View style={styles.statItem}>
                <MaterialIcons name="check" size={20} color="#4CAF50" />
                <Text style={styles.statText}>
                  <Text style={styles.statValue}>Approved</Text>
                  <Text style={styles.statCount}>{'\n'}{partnerStats.approved}</Text>
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.statItem}>
                <MaterialIcons name="schedule" size={20} color="#66BB6A" />
                <Text style={styles.statText}>
                  <Text style={styles.statValue}>Pending</Text>
                  <Text style={styles.statCount}>{'\n'}{partnerStats.pending}</Text>
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent Updates */}
      {isAdmin && recentUpdates.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Updates</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Lifecycle')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>

          {recentUpdates.map((update, index) => (
            <TouchableOpacity
              key={index}
              style={styles.updateItem}
              onPress={() => navigation.navigate('Lifecycle')}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.updateTimeline}>
                <View style={styles.updateDot} />
                {index < recentUpdates.length - 1 && <View style={styles.updateLine} />}
              </View>
              <View style={styles.updateContent}>
                <Text style={styles.updateProject}>{update.projectName}</Text>
                <Text style={styles.updateStatus}>{update.status}</Text>
                <Text style={styles.updateDescription} numberOfLines={2}>
                  {update.description}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>

        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('Messages')}
          >
            <MaterialIcons name="mail" size={24} color="#4CAF50" />
            <Text style={styles.actionButtonText}>Messages</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('Map')}
          >
            <MaterialIcons name="map" size={24} color="#FF6B6B" />
            <Text style={styles.actionButtonText}>Map</Text>
          </TouchableOpacity>

          {isAdmin && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate('Users')}
            >
              <MaterialIcons name="group" size={24} color="#2E7D32" />
              <Text style={styles.actionButtonText}>Users</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Volcre v1.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  errorBanner: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  errorBannerContent: {
    flex: 1,
  },
  errorBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
  },
  errorBannerText: {
    fontSize: 12,
    color: '#7f1d1d',
    marginTop: 4,
    lineHeight: 18,
  },
  errorBannerAction: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991b1b',
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 20,
  },
  greeting: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  role: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewAll: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '600',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  metricLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statText: {
    flex: 1,
  },
  statValue: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
  },
  statCount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: '#eee',
  },
  updateItem: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 12,
  },
  updateTimeline: {
    alignItems: 'center',
    width: 40,
  },
  updateDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
  },
  updateLine: {
    width: 2,
    height: 40,
    backgroundColor: '#e0e0e0',
    marginTop: 4,
  },
  updateContent: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
  },
  updateProject: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  updateStatus: {
    fontSize: 11,
    color: '#4CAF50',
    marginTop: 2,
    fontWeight: '600',
  },
  updateDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    lineHeight: 16,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  actionButtonText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
    textAlign: 'center',
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  footerText: {
    fontSize: 12,
    color: '#999',
  },
});
