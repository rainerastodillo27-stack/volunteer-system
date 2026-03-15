import React, { useState, useEffect } from 'react';
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
import {
  getAllProjects,
  getAllPartners,
  getAllVolunteers,
  getStatusUpdatesByProject,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';

export default function DashboardScreen({ navigation }: any) {
  const { user, isAdmin, logout } = useAuth();
  const [projectStats, setProjectStats] = useState({ total: 0, active: 0, completed: 0 });
  const [partnerStats, setPartnerStats] = useState({ total: 0, approved: 0, pending: 0 });
  const [volunteerStats, setVolunteerStats] = useState({ total: 0, active: 0 });
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const projects = await getAllProjects();
      const partners = await getAllPartners();
      const volunteers = await getAllVolunteers();

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

      setVolunteerStats({
        total: volunteers.length,
        active: volunteers.filter(v => v.totalHoursContributed > 0).length,
      });

      // Get recent updates
      const allUpdates: any[] = [];
      for (const project of projects) {
        const updates = await getStatusUpdatesByProject(project.id);
        allUpdates.push(
          ...updates.map(u => ({
            ...u,
            projectName: project.title,
          }))
        );
      }
      setRecentUpdates(allUpdates.slice(0, 5));
    } catch (error) {
      Alert.alert('Error', 'Failed to load dashboard data');
    }
  };

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
  const navigateTo = (screen: string) => navigation.navigate(screen);

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

      {/* Key Metrics */}
      {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>

          <View style={styles.metricsGrid}>
            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigateTo('Projects')}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <MaterialIcons name="folder" size={32} color="#4CAF50" />
              <Text style={styles.metricValue}>{projectStats.total}</Text>
              <Text style={styles.metricLabel}>Projects</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigateTo('Partners')}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <MaterialIcons name="business" size={32} color="#66BB6A" />
              <Text style={styles.metricValue}>{partnerStats.total}</Text>
              <Text style={styles.metricLabel}>Partners</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigateTo('Users')}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <MaterialIcons name="group" size={32} color="#4CAF50" />
              <Text style={styles.metricValue}>{volunteerStats.total}</Text>
              <Text style={styles.metricLabel}>Volunteers</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.metricCard}
              onPress={() => navigateTo('Projects')}
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
          onPress={() => navigateTo('Projects')}
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
            onPress={() => navigateTo('Partners')}
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
              onPress={() => navigateTo('Lifecycle')}
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
              onPress={() => navigation.navigate('Impact')}
            >
              <MaterialIcons name="assessment" size={24} color="#4CAF50" />
              <Text style={styles.actionButtonText}>Reports</Text>
            </TouchableOpacity>
          )}

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
