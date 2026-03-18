import React, { useCallback, useEffect, useState } from 'react';
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
  Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllProjects,
  getAllUsers,
  getVolunteerCompletedProjectIds,
  getUserByEmailOrPhone,
  getVolunteerByUserId,
  saveUser,
  saveVolunteer,
  subscribeToStorageChanges,
} from '../models/storage';
import { NVCSector, User, UserType, Volunteer } from '../models/types';

const USER_TYPES: UserType[] = ['Student', 'Adult', 'Senior'];
const PILLAR_OPTIONS: NVCSector[] = ['Nutrition', 'Education', 'Livelihood'];
const SAVE_SYNC_RETRY_COUNT = 3;
const SAVE_SYNC_RETRY_DELAY_MS = 250;

export default function ProfileScreen() {
  const { user, logout, updateUserProfile } = useAuth();
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [completedProjectIds, setCompletedProjectIds] = useState<string[]>([]);
  const [projectTitlesById, setProjectTitlesById] = useState<Record<string, string>>({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [userTypeDraft, setUserTypeDraft] = useState<UserType>('Adult');
  const [pillarsDraft, setPillarsDraft] = useState<NVCSector[]>([]);
  const [skillsDraft, setSkillsDraft] = useState('');
  const [skillsDescriptionDraft, setSkillsDescriptionDraft] = useState('');
  const [backgroundDraft, setBackgroundDraft] = useState('');
  const [isBusyDraft, setIsBusyDraft] = useState(false);

  const loadVolunteerProfile = useCallback(async () => {
    if (user?.role !== 'volunteer' || !user.id) {
      setVolunteerProfile(null);
      setCompletedProjectIds([]);
      return;
    }

    try {
      const profile = await getVolunteerByUserId(user.id);
      setVolunteerProfile(profile);
      if (profile?.id) {
        const completedIds = await getVolunteerCompletedProjectIds(profile.id);
        setCompletedProjectIds(completedIds);
      } else {
        setCompletedProjectIds([]);
      }
    } catch (error) {
      console.error('Error loading volunteer profile:', error);
    }
  }, [user?.id, user?.role]);

  const loadProjectTitles = useCallback(async () => {
    try {
      const projects = await getAllProjects();
      setProjectTitlesById(
        Object.fromEntries(projects.map(project => [project.id, project.title]))
      );
    } catch (error) {
      console.error('Error loading projects for profile:', error);
    }
  }, []);

  useEffect(() => {
    void loadVolunteerProfile();
    void loadProjectTitles();
  }, [loadProjectTitles, loadVolunteerProfile]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['volunteers', 'projects', 'volunteerProjectJoins'],
      () => {
        void loadVolunteerProfile();
        void loadProjectTitles();
      }
    );
  }, [loadProjectTitles, loadVolunteerProfile]);

  useFocusEffect(
    useCallback(() => {
      void loadVolunteerProfile();
      void loadProjectTitles();
    }, [loadProjectTitles, loadVolunteerProfile])
  );

  const populateDrafts = useCallback(() => {
    if (!user) {
      return;
    }

    setNameDraft(user.name || '');
    setEmailDraft(user.email || '');
    setPhoneDraft(user.phone || '');
    setPasswordDraft(user.password || '');
    setUserTypeDraft(user.userType || 'Adult');
    setPillarsDraft(user.pillarsOfInterest || []);
    setSkillsDraft(volunteerProfile?.skills.join(', ') || '');
    setSkillsDescriptionDraft(volunteerProfile?.skillsDescription || '');
    setBackgroundDraft(volunteerProfile?.background || '');
    setIsBusyDraft(volunteerProfile?.engagementStatus === 'Busy');
  }, [user, volunteerProfile]);

  useEffect(() => {
    populateDrafts();
  }, [populateDrafts]);

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

  const openEditModal = () => {
    populateDrafts();
    setShowEditModal(true);
  };

  const togglePillar = (pillar: NVCSector) => {
    setPillarsDraft(current =>
      current.includes(pillar)
        ? current.filter(item => item !== pillar)
        : [...current, pillar]
    );
  };

  const waitForCredentialSync = async (identifier: string, password: string, userId: string) => {
    for (let attempt = 0; attempt < SAVE_SYNC_RETRY_COUNT; attempt += 1) {
      const syncedUser = await getUserByEmailOrPhone(identifier);
      if (syncedUser && syncedUser.id === userId && syncedUser.password === password) {
        return syncedUser;
      }

      if (attempt < SAVE_SYNC_RETRY_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, SAVE_SYNC_RETRY_DELAY_MS));
      }
    }

    throw new Error('Your new login details did not sync yet. Please try saving again.');
  };

  const handleSaveProfile = async () => {
    if (!user) {
      return;
    }

    const normalizedName = nameDraft.trim();
    const normalizedEmail = emailDraft.trim().toLowerCase();
    const normalizedPhone = phoneDraft.trim();
    const normalizedPassword = passwordDraft.trim();

    if (!normalizedName || !normalizedPassword) {
      Alert.alert('Validation Error', 'Name and password are required.');
      return;
    }

    if (!normalizedEmail && !normalizedPhone) {
      Alert.alert('Validation Error', 'Please provide an email or phone number.');
      return;
    }

    if (normalizedEmail && !normalizedEmail.includes('@')) {
      Alert.alert('Validation Error', 'Please enter a valid email address.');
      return;
    }

    try {
      setSaveLoading(true);

      const allUsers = await getAllUsers();
      const duplicateEmail = normalizedEmail
        ? allUsers.find(
            existingUser =>
              existingUser.id !== user.id &&
              existingUser.email?.trim().toLowerCase() === normalizedEmail
          )
        : null;
      if (duplicateEmail) {
        throw new Error('An account with this email already exists.');
      }

      const duplicatePhone = normalizedPhone
        ? allUsers.find(
            existingUser =>
              existingUser.id !== user.id &&
              existingUser.phone?.trim() === normalizedPhone
          )
        : null;
      if (duplicatePhone) {
        throw new Error('An account with this phone number already exists.');
      }

      const updatedUser: User = {
        ...user,
        name: normalizedName,
        email: normalizedEmail || undefined,
        phone: normalizedPhone || undefined,
        password: normalizedPassword,
        userType: userTypeDraft,
        pillarsOfInterest: pillarsDraft,
      };

      await saveUser(updatedUser);

      if (user.role === 'volunteer') {
        const parsedSkills = skillsDraft
          .split(',')
          .map(skill => skill.trim())
          .filter(Boolean);

        const updatedVolunteerProfile: Volunteer = {
          id: volunteerProfile?.id || `volunteer-${user.id}`,
          userId: user.id,
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
          skills: parsedSkills,
          skillsDescription: skillsDescriptionDraft.trim(),
          availability: volunteerProfile?.availability || {
            daysPerWeek: 0,
            hoursPerWeek: 0,
            availableDays: [],
          },
          pastProjects: volunteerProfile?.pastProjects || [],
          totalHoursContributed: volunteerProfile?.totalHoursContributed || 0,
          rating: volunteerProfile?.rating || 0,
          engagementStatus: isBusyDraft ? 'Busy' : 'Open to Volunteer',
          background: backgroundDraft.trim(),
          createdAt: volunteerProfile?.createdAt || new Date().toISOString(),
        };

        await saveVolunteer(updatedVolunteerProfile);
        setVolunteerProfile(updatedVolunteerProfile);
        setCompletedProjectIds(updatedVolunteerProfile.pastProjects || []);
      }

      const loginIdentifier = normalizedEmail || normalizedPhone;
      const syncedUser = await waitForCredentialSync(
        loginIdentifier,
        normalizedPassword,
        user.id
      );

      await updateUserProfile(syncedUser);
      setShowEditModal(false);
      Alert.alert(
        'Saved',
        `Profile updated successfully. Use ${loginIdentifier} the next time you log in.`
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to update profile.');
    } finally {
      setSaveLoading(false);
    }
  };

  const initials = (user?.name || 'U')
    .split(' ')
    .map(part => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const completedPrograms = completedProjectIds;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        <Text style={styles.name}>{user?.name ?? 'User'}</Text>
        <Text style={styles.email}>{user?.email ?? user?.phone ?? 'No contact info'}</Text>

        <TouchableOpacity style={styles.editButton} onPress={openEditModal}>
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>

        <View style={styles.infoContainer}>
          <Text style={styles.infoLabel}>Role</Text>
          <Text style={styles.infoValue}>
            {user?.role === 'admin'
              ? 'National Volunteer Coordinator (NVC)'
              : user?.role === 'partner'
                ? 'Partner Account'
                : 'Volunteer'}
          </Text>

          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>{user?.phone ?? volunteerProfile?.phone ?? 'Not provided'}</Text>

          <Text style={styles.infoLabel}>Profile Type</Text>
          <Text style={styles.infoValue}>{user?.userType || 'Adult'}</Text>

          <Text style={styles.infoLabel}>Pillars of Interest</Text>
          <Text style={styles.infoValue}>
            {(user?.pillarsOfInterest || []).length > 0
              ? user?.pillarsOfInterest?.join(', ')
              : 'No pillar preferences'}
          </Text>
        </View>

        {user?.role === 'admin' && (
          <View style={styles.infoContainer}>
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
                <Text style={styles.statNumber}>{completedProjectIds.length}</Text>
                <Text style={styles.statLabel}>Projects</Text>
              </View>
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.infoLabel}>Skills</Text>
              {volunteerProfile.skills.length > 0 ? (
                <View style={styles.skillList}>
                  {volunteerProfile.skills.map(skill => (
                    <View key={skill} style={styles.skillChip}>
                      <Text style={styles.skillChipText}>{skill}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.infoValue}>No skills added yet.</Text>
              )}

              <Text style={styles.infoLabel}>Skills Description</Text>
              <Text style={styles.descriptionText}>
                {volunteerProfile.skillsDescription || 'No skills description added yet.'}
              </Text>

              <Text style={styles.infoLabel}>Background</Text>
              <Text style={styles.infoValue}>{volunteerProfile.background || 'No background added yet.'}</Text>

              <Text style={styles.infoLabel}>Completed Programs</Text>
              {completedPrograms.length > 0 ? (
                <View style={styles.completedProgramsList}>
                  {completedPrograms.map(projectId => (
                    <View key={projectId} style={styles.completedProgramCard}>
                      <Text style={styles.completedProgramTitle}>
                        {projectTitlesById[projectId] || projectId}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.infoValue}>No completed programs yet.</Text>
              )}
            </View>
          </>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showEditModal} animationType="slide" onRequestClose={() => setShowEditModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditModal(false)} disabled={saveLoading}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={handleSaveProfile} disabled={saveLoading}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalLabel}>Update your account details below.</Text>

            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Full name"
              editable={!saveLoading}
            />
            <TextInput
              style={styles.input}
              value={emailDraft}
              onChangeText={setEmailDraft}
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!saveLoading}
            />
            <TextInput
              style={styles.input}
              value={phoneDraft}
              onChangeText={setPhoneDraft}
              placeholder="Phone number"
              keyboardType="phone-pad"
              editable={!saveLoading}
            />
            <TextInput
              style={styles.input}
              value={passwordDraft}
              onChangeText={setPasswordDraft}
              placeholder="Password"
              secureTextEntry
              editable={!saveLoading}
            />

            <Text style={styles.fieldLabel}>Profile Type</Text>
            <View style={styles.optionRow}>
              {USER_TYPES.map(userType => (
                <TouchableOpacity
                  key={userType}
                  style={[styles.optionChip, userTypeDraft === userType && styles.optionChipActive]}
                  onPress={() => setUserTypeDraft(userType)}
                  disabled={saveLoading}
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      userTypeDraft === userType && styles.optionChipTextActive,
                    ]}
                  >
                    {userType}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Pillars of Interest</Text>
            <View style={styles.optionRow}>
              {PILLAR_OPTIONS.map(pillar => (
                <TouchableOpacity
                  key={pillar}
                  style={[styles.optionChip, pillarsDraft.includes(pillar) && styles.optionChipActive]}
                  onPress={() => togglePillar(pillar)}
                  disabled={saveLoading}
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      pillarsDraft.includes(pillar) && styles.optionChipTextActive,
                    ]}
                  >
                    {pillar}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {user?.role === 'volunteer' && (
              <>
                <Text style={styles.fieldLabel}>Skills</Text>
                <TextInput
                  style={styles.input}
                  value={skillsDraft}
                  onChangeText={setSkillsDraft}
                  placeholder="Separate skills with commas"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>Skills Description</Text>
                <TextInput
                  style={styles.modalInput}
                  multiline
                  numberOfLines={6}
                  value={skillsDescriptionDraft}
                  onChangeText={setSkillsDescriptionDraft}
                  placeholder="Describe the skills you can use in volunteer programs."
                  placeholderTextColor="#94a3b8"
                  textAlignVertical="top"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>Background</Text>
                <TextInput
                  style={styles.modalInput}
                  multiline
                  numberOfLines={5}
                  value={backgroundDraft}
                  onChangeText={setBackgroundDraft}
                  placeholder="Share your background and experience."
                  placeholderTextColor="#94a3b8"
                  textAlignVertical="top"
                  editable={!saveLoading}
                />

                <View style={styles.switchRow}>
                  <View style={styles.switchTextBlock}>
                    <Text style={styles.fieldLabel}>Availability Status</Text>
                    <Text style={styles.switchHint}>
                      Turn this on if you want your status to appear as busy.
                    </Text>
                  </View>
                  <Switch
                    value={isBusyDraft}
                    onValueChange={setIsBusyDraft}
                    disabled={saveLoading}
                    trackColor={{ false: '#bbf7d0', true: '#fecaca' }}
                    thumbColor={isBusyDraft ? '#dc2626' : '#16a34a'}
                  />
                </View>
              </>
            )}
          </ScrollView>
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
    marginBottom: 12,
  },
  editButton: {
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
  },
  editButtonText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
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
  descriptionText: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  completedProgramsList: {
    marginTop: 8,
    gap: 10,
  },
  completedProgramCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  completedProgramTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
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
    paddingBottom: 32,
  },
  modalLabel: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  optionChipActive: {
    backgroundColor: '#166534',
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  optionChipTextActive: {
    color: '#fff',
  },
  modalInput: {
    minHeight: 120,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
  },
  switchRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchTextBlock: {
    flex: 1,
  },
  switchHint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
});
