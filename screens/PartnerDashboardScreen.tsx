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
import {
  getAllPartners,
  getAllProjects,
  getSectorNeeds,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import { SectorNeed } from '../models/types';

export default function PartnerDashboardScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [orgStats, setOrgStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [projectStats, setProjectStats] = useState({ total: 0, active: 0, completed: 0 });
  const [sectorNeeds, setSectorNeeds] = useState<SectorNeed[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const partners = await getAllPartners();
      const projects = await getAllProjects();
      const myOrgs = partners.filter(p => p.contactEmail.toLowerCase() === user?.email?.toLowerCase());
      const myOrgIds = new Set(myOrgs.map((partner) => partner.id));
      const myProjects = projects.filter((project) => myOrgIds.has(project.partnerId));

      setOrgStats({
        total: myOrgs.length,
        pending: myOrgs.filter(p => p.status === 'Pending').length,
        approved: myOrgs.filter(p => p.status === 'Approved').length,
        rejected: myOrgs.filter(p => p.status === 'Rejected').length,
      });

      setProjectStats({
        total: myProjects.length,
        active: myProjects.filter(p => p.status === 'In Progress').length,
        completed: myProjects.filter(p => p.status === 'Completed').length,
      });

      const needs = await getSectorNeeds();
      setSectorNeeds(needs);
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
      { text: 'Logout', onPress: async () => await logout() },
    ]);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0) ?? 'P'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Welcome, {user?.name}</Text>
            <Text style={styles.role}>Partner Org Account</Text>
          </View>
          <TouchableOpacity onPress={handleLogout}>
            <MaterialIcons name="logout" size={24} color="#666" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Organization Summary</Text>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <MaterialIcons name="business" size={30} color="#4CAF50" />
            <Text style={styles.metricValue}>{orgStats.total}</Text>
            <Text style={styles.metricLabel}>My Orgs</Text>
          </View>
          <View style={styles.metricCard}>
            <MaterialIcons name="hourglass-empty" size={30} color="#66BB6A" />
            <Text style={styles.metricValue}>{orgStats.pending}</Text>
            <Text style={styles.metricLabel}>Pending</Text>
          </View>
          <View style={styles.metricCard}>
            <MaterialIcons name="check-circle" size={30} color="#4CAF50" />
            <Text style={styles.metricValue}>{orgStats.approved}</Text>
            <Text style={styles.metricLabel}>Approved</Text>
          </View>
          <View style={styles.metricCard}>
            <MaterialIcons name="cancel" size={30} color="#f44336" />
            <Text style={styles.metricValue}>{orgStats.rejected}</Text>
            <Text style={styles.metricLabel}>Rejected</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Project Snapshot</Text>
        <View style={styles.card}>
          <Text style={styles.cardLine}>Total Projects: {projectStats.total}</Text>
          <Text style={styles.cardLine}>Active Projects: {projectStats.active}</Text>
          <Text style={styles.cardLine}>Completed Projects: {projectStats.completed}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Project Management</Text>
        <View style={styles.card}>
          <Text style={styles.cardLine}>
            Align your project requests with priority sector needs. Coordinate with NVC admins for approval.
          </Text>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.smallButton, styles.primaryButton]}
              onPress={() => navigation.navigate('Projects')}
            >
              <Text style={styles.smallButtonText}>View Projects</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallButton, styles.secondaryButton]}
              onPress={() => navigation.navigate('Messages')}
            >
              <Text style={styles.smallButtonText}>Message Admin</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NVC Sector Needs</Text>
        {sectorNeeds.map((need) => {
          return (
            <View key={need.sector} style={styles.needCard}>
              <Text style={styles.needTitle}>{need.title}</Text>
              <Text style={styles.needDescription}>{need.description}</Text>
              <Text style={styles.needLine}>Goal: PHP {need.goalAmount.toLocaleString()}</Text>
            </View>
          );
        })}
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
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  greeting: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  role: {
    marginTop: 2,
    fontSize: 12,
    color: '#666',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginTop: 6,
  },
  metricLabel: {
    marginTop: 4,
    color: '#666',
    fontSize: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  needCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  needTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  needDescription: {
    color: '#666',
    fontSize: 12,
    marginBottom: 8,
  },
  needLine: {
    color: '#333',
    fontSize: 13,
    marginBottom: 2,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  smallButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  secondaryButton: {
    backgroundColor: '#e0e0e0',
  },
  smallButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  cardLine: {
    color: '#333',
    fontSize: 14,
  },
});
