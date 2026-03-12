import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Modal,
  TextInput,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { getVolunteerByUserId, saveVolunteer } from '../models/storage';
import { Volunteer } from '../models/types';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [skillsDescriptionDraft, setSkillsDescriptionDraft] = useState('');

  useEffect(() => {
    const loadVolunteerProfile = async () => {
      if (user?.role !== 'volunteer' || !user.id) return;

      const profile = await getVolunteerByUserId(user.id);
      if (profile) {
        setVolunteerProfile(profile);
        setSkillsDescriptionDraft(profile.skillsDescription);
      }
    };

    loadVolunteerProfile();
  }, [user]);

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined' ? window.confirm('Are you sure you want to logout?') : true;
      if (confirmed) {
        logout();
      }
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Logout',
        onPress: async () => {
          try {
            await logout();
          } catch (error) {
            Alert.alert('Error', 'Failed to logout. Please try again.');
          }
        },
      },
    ]);
  };

  const handleSaveSkillsDescription = async () => {
    if (!volunteerProfile) return;

    try {
      const updatedProfile: Volunteer = {
        ...volunteerProfile,
        skillsDescription: skillsDescriptionDraft.trim(),
      };

      await saveVolunteer(updatedProfile);
      setVolunteerProfile(updatedProfile);
      setShowEditModal(false);
      Alert.alert('Saved', 'Skills description updated.');
    } catch (error) {
      Alert.alert('Error', 'Failed to save skills description.');
    }
  };

  const initials = (user?.name || 'U')
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        <Text style={styles.name}>{user?.name ?? 'User'}</Text>
        <Text style={styles.email}>{user?.email ?? 'user@example.com'}</Text>

        {user?.role === 'admin' && (
          <View style={styles.infoContainer}>
            <Text style={styles.infoLabel}>Role</Text>
            <Text style={styles.infoValue}>National Volunteer Coordinator (NVC)</Text>
            <Text style={styles.infoLabel}>About</Text>
            <Text style={styles.infoValue}>
              Oversees program rollouts, partner validation, and volunteer engagement across Negros Occidental.
            </Text>
          </View>
        )}

        {user?.role === 'volunteer' && volunteerProfile && (
          <>
            <View
              style={[
                styles.statusChip,
                volunteerProfile.engagementStatus === 'Busy'
                  ? styles.statusChipBusy
                  : styles.statusChipOpen,
              ]}
            >
              <Text
                style={[
                  styles.statusChipText,
                  volunteerProfile.engagementStatus === 'Busy'
                    ? styles.statusChipTextBusy
                    : styles.statusChipTextOpen,
                ]}
              >
                Status: {volunteerProfile.engagementStatus}
              </Text>
            </View>

            <View style={styles.statsContainer}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{volunteerProfile.totalHoursContributed}</Text>
                <Text style={styles.statLabel}>Hours Logged</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{volunteerProfile.pastProjects.length}</Text>
                <Text style={styles.statLabel}>Projects</Text>
              </View>
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.infoLabel}>Phone</Text>
              <Text style={styles.infoValue}>{volunteerProfile.phone}</Text>

              <Text style={styles.infoLabel}>Skills</Text>
              <View style={styles.skillList}>
                {volunteerProfile.skills.map((skill) => (
                  <View key={skill} style={styles.skillChip}>
                    <Text style={styles.skillChipText}>{skill}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.skillsHeader}>
                <Text style={styles.infoLabel}>Skills Description</Text>
                <TouchableOpacity onPress={() => setShowEditModal(true)}>
                  <Text style={styles.editInline}>Edit</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.descriptionText}>
                {volunteerProfile.skillsDescription || 'No skills description added yet.'}
              </Text>

              <Text style={styles.infoLabel}>Background</Text>
              <Text style={styles.infoValue}>{volunteerProfile.background}</Text>
            </View>
          </>
        )}

        {user?.role !== 'volunteer' && (
          <View style={styles.infoContainer}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue}>{user?.phone ?? 'Not provided'}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showEditModal} animationType="slide" onRequestClose={() => setShowEditModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Skills Description</Text>
            <TouchableOpacity onPress={handleSaveSkillsDescription}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.modalLabel}>Describe the skills you can use in volunteer programs.</Text>
            <TextInput
              style={styles.modalInput}
              multiline
              numberOfLines={8}
              value={skillsDescriptionDraft}
              onChangeText={setSkillsDescriptionDraft}
              placeholder="Example: I can teach reading, organize outreach events, mentor youth, and help with community logistics."
              placeholderTextColor="#94a3b8"
              textAlignVertical="top"
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 15,
  },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  email: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 20,
  },
  statusChipOpen: {
    backgroundColor: '#dcfce7',
  },
  statusChipBusy: {
    backgroundColor: '#fee2e2',
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusChipTextOpen: {
    color: '#166534',
  },
  statusChipTextBusy: {
    color: '#b91c1c',
  },
  statsContainer: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  infoContainer: {
    width: '100%',
    marginBottom: 20,
  },
  infoLabel: {
    fontSize: 12,
    color: '#999',
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 16,
    color: '#333',
    marginTop: 3,
    marginBottom: 10,
  },
  skillList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 10,
  },
  skillChip: {
    backgroundColor: '#ecfdf5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  skillChipText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '600',
  },
  skillsHeader: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editInline: {
    color: '#4CAF50',
    fontSize: 13,
    fontWeight: '700',
  },
  descriptionText: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  logoutButton: {
    width: '100%',
    backgroundColor: '#f44336',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalCancel: {
    color: '#64748b',
    fontSize: 15,
  },
  modalSave: {
    color: '#15803d',
    fontSize: 15,
    fontWeight: '700',
  },
  modalBody: {
    padding: 16,
  },
  modalLabel: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
    lineHeight: 20,
  },
  modalInput: {
    minHeight: 180,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0f172a',
  },
});
