import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  getAllPartners,
  getAllProjects,
  getDonationsByPartnerUser,
  getSectorDonationTotals,
  getSectorNeeds,
  saveDonation,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import { NVCSector, PartnerDonation, SectorNeed } from '../models/types';

export default function PartnerDashboardScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [orgStats, setOrgStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [projectStats, setProjectStats] = useState({ total: 0, active: 0, completed: 0 });
  const [sectorNeeds, setSectorNeeds] = useState<SectorNeed[]>([]);
  const [sectorTotals, setSectorTotals] = useState<Record<NVCSector, number>>({
    Education: 0,
    Livelihood: 0,
    Nutrition: 0,
  });
  const [myDonations, setMyDonations] = useState<PartnerDonation[]>([]);
  const [selectedSector, setSelectedSector] = useState<NVCSector>('Education');
  const [donationAmount, setDonationAmount] = useState('');
  const [donationNote, setDonationNote] = useState('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const partners = await getAllPartners();
      const projects = await getAllProjects();
      const myOrgs = partners.filter(p => p.contactEmail.toLowerCase() === user?.email?.toLowerCase());

      setOrgStats({
        total: myOrgs.length,
        pending: myOrgs.filter(p => p.status === 'Pending').length,
        approved: myOrgs.filter(p => p.status === 'Approved').length,
        rejected: myOrgs.filter(p => p.status === 'Rejected').length,
      });

      setProjectStats({
        total: projects.length,
        active: projects.filter(p => p.status === 'In Progress').length,
        completed: projects.filter(p => p.status === 'Completed').length,
      });

      const [needs, totals, donations] = await Promise.all([
        getSectorNeeds(),
        getSectorDonationTotals(),
        getDonationsByPartnerUser(user?.id || ''),
      ]);
      setSectorNeeds(needs);
      setSectorTotals(totals);
      setMyDonations(donations);
    } catch (error) {
      Alert.alert('Error', 'Failed to load dashboard data');
    }
  };

  const handleDonate = async () => {
    if (!user) return;
    const parsedAmount = Number(donationAmount);
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid donation amount.');
      return;
    }

    try {
      const donation: PartnerDonation = {
        id: `donation-${Date.now()}`,
        partnerUserId: user.id,
        partnerEmail: user.email,
        sector: selectedSector,
        amount: parsedAmount,
        note: donationNote.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      await saveDonation(donation);
      setDonationAmount('');
      setDonationNote('');
      await loadDashboardData();
      Alert.alert('Success', `Donation recorded for ${selectedSector}.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to save donation.');
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
            <Text style={styles.role}>Partner Organization</Text>
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
        <Text style={styles.sectionTitle}>NVC Sector Needs</Text>
        {sectorNeeds.map((need) => {
          const donated = sectorTotals[need.sector] || 0;
          const remaining = Math.max(0, need.goalAmount - donated);
          return (
            <View key={need.sector} style={styles.needCard}>
              <Text style={styles.needTitle}>{need.title}</Text>
              <Text style={styles.needDescription}>{need.description}</Text>
              <Text style={styles.needLine}>Goal: PHP {need.goalAmount.toLocaleString()}</Text>
              <Text style={styles.needLine}>Donated: PHP {donated.toLocaleString()}</Text>
              <Text style={styles.needLine}>Remaining: PHP {remaining.toLocaleString()}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Donate to Sector Needs</Text>
        <View style={styles.card}>
          <View style={styles.sectorRow}>
            {(['Education', 'Livelihood', 'Nutrition'] as NVCSector[]).map((sector) => (
              <TouchableOpacity
                key={sector}
                style={[
                  styles.sectorChip,
                  selectedSector === sector && styles.sectorChipActive,
                ]}
                onPress={() => setSelectedSector(sector)}
              >
                <Text
                  style={[
                    styles.sectorChipText,
                    selectedSector === sector && styles.sectorChipTextActive,
                  ]}
                >
                  {sector}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Donation amount (PHP)"
            keyboardType="numeric"
            value={donationAmount}
            onChangeText={setDonationAmount}
          />
          <TextInput
            style={[styles.input, styles.noteInput]}
            placeholder="Note (optional)"
            value={donationNote}
            onChangeText={setDonationNote}
            multiline
          />
          <TouchableOpacity style={styles.donateButton} onPress={handleDonate}>
            <Text style={styles.donateButtonText}>Donate Now</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Recent Donations</Text>
        <View style={styles.card}>
          {myDonations.length === 0 ? (
            <Text style={styles.emptyText}>No donations yet.</Text>
          ) : (
            myDonations.slice(0, 5).map((donation) => (
              <View key={donation.id} style={styles.donationRow}>
                <View>
                  <Text style={styles.donationSector}>{donation.sector}</Text>
                  <Text style={styles.donationDate}>
                    {new Date(donation.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={styles.donationAmount}>PHP {donation.amount.toLocaleString()}</Text>
              </View>
            ))
          )}
        </View>
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
  sectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  sectorChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e0e0e0',
  },
  sectorChipActive: {
    backgroundColor: '#4CAF50',
  },
  sectorChipText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  sectorChipTextActive: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: '#333',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  noteInput: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  donateButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  donateButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
  },
  donationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  donationSector: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  donationDate: {
    marginTop: 2,
    fontSize: 11,
    color: '#777',
  },
  donationAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2E7D32',
  },
  cardLine: {
    color: '#333',
    fontSize: 14,
  },
});
