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
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import VolunteerImpactMap from '../components/VolunteerImpactMap';
import {
  getAllProjects,
  getAllUsers,
  getPartnersByOwnerUserId,
  getVolunteerCompletedProjectIds,
  getVolunteerProjectRatingSummary,
  getVolunteerRecognitionStatus,
  getUserByEmailOrPhone,
  getVolunteerByUserId,
  saveUser,
  saveVolunteer,
  subscribeToStorageChanges,
} from '../models/storage';
import { VolunteerRecognitionStatus } from '../models/storage';
import { NVCSector, Partner, Project, User, UserType, Volunteer } from '../models/types';

const USER_TYPES: UserType[] = ['Student', 'Adult', 'Senior'];
const PILLAR_OPTIONS: NVCSector[] = ['Nutrition', 'Education', 'Livelihood'];
const SAVE_SYNC_RETRY_COUNT = 3;
const SAVE_SYNC_RETRY_DELAY_MS = 250;

// Displays the signed-in user's profile, volunteer recognition, and edit form.
const ProfileScreen = () => {
  const { user, logout, updateUserProfile } = useAuth();
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [partnerProfile, setPartnerProfile] = useState<Partner | null>(null);
  const [completedProjectIds, setCompletedProjectIds] = useState<string[]>([]);
  const [recognitionStatus, setRecognitionStatus] = useState<VolunteerRecognitionStatus>({
    joinedProgramCount: 0,
    isTopVolunteer: false,
  });
  const [ratedProjectCount, setRatedProjectCount] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [profilePictureUri, setProfilePictureUri] = useState<string | null>(null);
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

  // Loads the volunteer profile plus recognition details for volunteer accounts.
  const loadVolunteerProfile = useCallback(async () => {
    if (user?.role !== 'volunteer' || !user.id) {
      setVolunteerProfile(null);
      setCompletedProjectIds([]);
      setRecognitionStatus({
        joinedProgramCount: 0,
        isTopVolunteer: false,
      });
      setRatedProjectCount(0);
      return;
    }

    try {
      const profile = await getVolunteerByUserId(user.id);
      setVolunteerProfile(profile);
      if (profile?.id) {
        const [completedIds, recognition, ratingSummary] = await Promise.all([
          getVolunteerCompletedProjectIds(profile.id),
          getVolunteerRecognitionStatus(profile.id),
          getVolunteerProjectRatingSummary(profile.id),
        ]);
        setCompletedProjectIds(completedIds);
        setRecognitionStatus(recognition);
        setRatedProjectCount(ratingSummary.ratedProjectCount);
      } else {
        setCompletedProjectIds([]);
        setRecognitionStatus({
          joinedProgramCount: 0,
          isTopVolunteer: false,
        });
        setRatedProjectCount(0);
      }
    } catch (error) {
      console.error('Error loading volunteer profile:', error);
    }
  }, [user?.id, user?.role]);

  // Loads the latest organization registration linked to the signed-in partner account.
  const loadPartnerProfile = useCallback(async () => {
    if (user?.role !== 'partner' || !user.id) {
      setPartnerProfile(null);
      return;
    }

    try {
      const ownedPartners = await getPartnersByOwnerUserId(user.id);
      const latestPartner =
        [...ownedPartners].sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )[0] || null;
      setPartnerProfile(latestPartner);
    } catch (error) {
      console.error('Error loading partner profile:', error);
    }
  }, [user?.id, user?.role]);

  // Loads project titles used to display completed volunteer work.
  const loadProjectTitles = useCallback(async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
    } catch (error) {
      console.error('Error loading projects for profile:', error);
    }
  }, []);

  const refreshProfileData = useCallback(() => {
    void loadVolunteerProfile();
    void loadPartnerProfile();
    void loadProjectTitles();
  }, [loadPartnerProfile, loadProjectTitles, loadVolunteerProfile]);

  useEffect(() => {
    refreshProfileData();
  }, [refreshProfileData]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['volunteers', 'partners', 'projects', 'volunteerProjectJoins'],
      () => {
        refreshProfileData();
      }
    );
  }, [refreshProfileData]);

  useFocusEffect(
    useCallback(() => {
      refreshProfileData();
    }, [refreshProfileData])
  );

  // Copies the current profile into editable draft fields.
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

  // Confirms logout before clearing the signed-in session.
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

  // Opens the profile editor after refreshing the current draft values.
  const openEditModal = () => {
    populateDrafts();
    setShowEditModal(true);
  };

  // Adds or removes a pillar-of-interest selection from the draft profile.
  const togglePillar = (pillar: NVCSector) => {
    setPillarsDraft(current =>
      current.includes(pillar)
        ? current.filter(item => item !== pillar)
        : [...current, pillar]
    );
  };

  // Waits for updated credentials to be readable from shared storage before closing save flow.
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

  // Saves the edited user and volunteer profile data.
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
          ...volunteerProfile,
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
          verificationStatus: volunteerProfile?.verificationStatus || 'Pending',
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

  // Function to save profile picture
  const handleSaveProfilePicture = async () => {
    if (!user || !profilePictureUri) {
      return;
    }

    try {
      setSaveLoading(true);

      // Update user profile with profile picture
      const updatedUser: User = {
        ...user,
        profilePictureUrl: profilePictureUri,
      };

      await saveUser(updatedUser);

      if (user.role === 'volunteer' && volunteerProfile) {
        const updatedVolunteerProfile: Volunteer = {
          ...volunteerProfile,
          profilePictureUrl: profilePictureUri,
        };

        await saveVolunteer(updatedVolunteerProfile);
        setVolunteerProfile(updatedVolunteerProfile);
      }

      await updateUserProfile(updatedUser);
      Alert.alert('Success', 'Profile picture saved successfully!');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to save profile picture.');
    } finally {
      setSaveLoading(false);
    }
  };

  const pickProfilePicture = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission needed', 'Please grant access to your photos to upload a profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setProfilePictureUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking profile picture:', error);
      Alert.alert('Error', 'Failed to pick profile picture. Please try again.');
    }
  };

  const completedPrograms = completedProjectIds;
  const joinedProgramCount = recognitionStatus.joinedProgramCount;
  const isTopVolunteer = recognitionStatus.isTopVolunteer;
  const projectById: Record<string, Project> = Object.fromEntries(
    projects.map(project => [project.id, project])
  );
  const completedProjects = completedProjectIds
    .map(projectId => projectById[projectId] || null)
    .filter((project): project is Project => project !== null);
  const volunteerAffiliations = (volunteerProfile?.affiliations || []).filter(
    affiliation => affiliation.organization || affiliation.position
  );
  const roundedVolunteerRating = Math.max(0, Math.min(5, Math.round((volunteerProfile?.rating || 0) * 2) / 2));
  const partnerRegistrationStatus = partnerProfile?.status || 'Pending';
  const savedProfilePictureUri =
    user?.profilePictureUrl || volunteerProfile?.profilePictureUrl || partnerProfile?.profilePictureUrl || null;
  const displayedProfilePictureUri = profilePictureUri || savedProfilePictureUri;
  const hasPendingProfilePictureChange =
    Boolean(profilePictureUri) && profilePictureUri !== savedProfilePictureUri;
  const userInitials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .map(part => part[0].toUpperCase())
        .slice(0, 2)
        .join('')
    : 'U';

  const partnerVerificationText = partnerProfile
    ? `${partnerProfile.verificationStatus || 'Pending'}${
        partnerProfile.credentialsUnlockedAt ? ' - Login unlocked' : ' - Login locked'
      }`
    : 'Pending';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatarFrame}>
            {displayedProfilePictureUri ? (
              <Image source={{ uri: displayedProfilePictureUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{userInitials}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.changePhotoButton} onPress={pickProfilePicture}>
              <MaterialIcons name="camera-alt" size={16} color="#fff" />
            </TouchableOpacity>
          </View>

          {hasPendingProfilePictureChange && (
            <View style={styles.avatarActionRow}>
              <TouchableOpacity
                style={[styles.saveButton, saveLoading && styles.saveButtonDisabled]}
                onPress={handleSaveProfilePicture}
                disabled={saveLoading}
              >
                <Text style={styles.saveButtonText}>{saveLoading ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setProfilePictureUri(savedProfilePictureUri)}
                disabled={saveLoading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.name}>{user?.name ?? 'User'}</Text>
        <Text style={styles.email}>{user?.email ?? user?.phone ?? 'No contact info'}</Text>

        {user?.role === 'volunteer' && volunteerProfile && isTopVolunteer && (
          <View style={styles.topVolunteerBadge}>
            <View style={styles.topVolunteerIconWrap}>
              <MaterialIcons name="military-tech" size={20} color="#fffbeb" />
            </View>
            <View style={styles.topVolunteerTextWrap}>
              <Text style={styles.topVolunteerTitle}>Top Volunteer</Text>
              <Text style={styles.topVolunteerSubtitle}>
                Reached {joinedProgramCount} joined programs
              </Text>
            </View>
          </View>
        )}

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

          {user?.role === 'volunteer' && (
            <>
              <Text style={styles.infoLabel}>Profile Type</Text>
              <Text style={styles.infoValue}>{user?.userType || 'Adult'}</Text>

              <Text style={styles.infoLabel}>Pillars of Interest</Text>
              <Text style={styles.infoValue}>
                {(user?.pillarsOfInterest || []).length > 0
                  ? user?.pillarsOfInterest?.join(', ')
                  : 'No pillar preferences'}
              </Text>
            </>
          )}
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
                <Text style={styles.statNumber}>{joinedProgramCount}</Text>
                <Text style={styles.statLabel}>Joined Programs</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{completedProjectIds.length}</Text>
                <Text style={styles.statLabel}>Completed</Text>
              </View>
            </View>

            <View style={styles.ratingSummaryCard}>
              <Text style={styles.sectionHeading}>Volunteer Rating</Text>
              <View style={styles.ratingStarsRow}>
                {[1, 2, 3, 4, 5].map(star => (
                  <MaterialIcons
                    key={`profile-rating-${star}`}
                    name={
                      star <= Math.floor(roundedVolunteerRating)
                        ? 'star'
                        : star - 0.5 === roundedVolunteerRating
                        ? 'star-half'
                        : 'star-border'
                    }
                    size={22}
                    color={
                      star <= roundedVolunteerRating || star - 0.5 === roundedVolunteerRating
                        ? '#f59e0b'
                        : '#cbd5e1'
                    }
                  />
                ))}
              </View>
              <Text style={styles.ratingSummaryValue}>
                {volunteerProfile.rating > 0 ? `${volunteerProfile.rating.toFixed(1)} / 5` : 'Not rated yet'}
              </Text>
              <Text style={styles.ratingSummaryMeta}>
                {ratedProjectCount > 0
                  ? `Based on ${ratedProjectCount} rated project${ratedProjectCount === 1 ? '' : 's'}.`
                  : 'Your star rating will appear after an admin rates your joined projects.'}
              </Text>
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.sectionHeading}>Registration Details</Text>

              <Text style={styles.infoLabel}>Gender</Text>
              <Text style={styles.infoValue}>{volunteerProfile.gender || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Date of Birth</Text>
              <Text style={styles.infoValue}>{volunteerProfile.dateOfBirth || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Civil Status</Text>
              <Text style={styles.infoValue}>{volunteerProfile.civilStatus || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Home Address</Text>
              <Text style={styles.infoValue}>{volunteerProfile.homeAddress || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Occupation</Text>
              <Text style={styles.infoValue}>{volunteerProfile.occupation || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Workplace or School</Text>
              <Text style={styles.infoValue}>{volunteerProfile.workplaceOrSchool || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>College Course</Text>
              <Text style={styles.infoValue}>{volunteerProfile.collegeCourse || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Certifications or Trainings</Text>
              <Text style={styles.infoValue}>
                {volunteerProfile.certificationsOrTrainings || 'Not provided'}
              </Text>

              <Text style={styles.infoLabel}>Hobbies and Interests</Text>
              <Text style={styles.infoValue}>{volunteerProfile.hobbiesAndInterests || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Special Skills</Text>
              <Text style={styles.infoValue}>{volunteerProfile.specialSkills || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Affiliations</Text>
              {volunteerAffiliations.length > 0 ? (
                <View style={styles.detailCardList}>
                  {volunteerAffiliations.map((affiliation, index) => (
                    <View
                      key={`${affiliation.organization}-${affiliation.position}-${index}`}
                      style={styles.detailCard}
                    >
                      <Text style={styles.detailCardTitle}>{affiliation.organization || 'Organization'}</Text>
                      <Text style={styles.detailCardMeta}>{affiliation.position || 'Position not provided'}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.infoValue}>No affiliations provided.</Text>
              )}
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.sectionHeading}>Volunteer Profile</Text>

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

              {completedProjects.length > 0 && (
                <VolunteerImpactMap projects={completedProjects} />
              )}

              <Text style={styles.infoLabel}>Completed Programs</Text>
              {completedPrograms.length > 0 ? (
                <View style={styles.completedProgramsList}>
                  {completedPrograms.map(projectId => (
                    <View key={projectId} style={styles.completedProgramCard}>
                      <Text style={styles.completedProgramTitle}>
                        {projectById[projectId]?.title || projectId}
                      </Text>
                      {projectById[projectId]?.location?.address ? (
                        <Text style={styles.completedProgramMeta}>
                          {projectById[projectId]?.location.address}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.infoValue}>No completed programs yet.</Text>
              )}
            </View>
          </>
        )}

        {user?.role === 'partner' && (
          <>
            <View
              style={[
                styles.statusChip,
                partnerRegistrationStatus === 'Approved'
                  ? styles.statusChipOpen
                  : partnerRegistrationStatus === 'Rejected'
                  ? styles.statusChipRejected
                  : styles.statusChipPending,
              ]}
            >
              <Text
                style={[
                  styles.statusChipText,
                  partnerRegistrationStatus === 'Approved'
                    ? styles.statusChipTextOpen
                    : partnerRegistrationStatus === 'Rejected'
                    ? styles.statusChipTextRejected
                    : styles.statusChipTextPending,
                ]}
              >
                Registration Status: {partnerRegistrationStatus}
              </Text>
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.sectionHeading}>Organization Registration</Text>

              <Text style={styles.infoLabel}>Organization Name</Text>
              <Text style={styles.infoValue}>{partnerProfile?.name || 'Not submitted yet'}</Text>

              <Text style={styles.infoLabel}>Sector Type</Text>
              <Text style={styles.infoValue}>{partnerProfile?.sectorType || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>DSWD Accreditation No.</Text>
              <Text style={styles.infoValue}>{partnerProfile?.dswdAccreditationNo || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Advocacy Focus</Text>
              {partnerProfile && partnerProfile.advocacyFocus.length > 0 ? (
                <View style={styles.skillList}>
                  {partnerProfile.advocacyFocus.map(focus => (
                    <View key={focus} style={styles.skillChip}>
                      <Text style={styles.skillChipText}>{focus}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.infoValue}>No advocacy focus selected.</Text>
              )}

              <Text style={styles.infoLabel}>Verification</Text>
              <Text style={styles.infoValue}>{partnerVerificationText}</Text>

              <Text style={styles.infoLabel}>Organization Contact Email</Text>
              <Text style={styles.infoValue}>{partnerProfile?.contactEmail || user?.email || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Organization Contact Phone</Text>
              <Text style={styles.infoValue}>{partnerProfile?.contactPhone || user?.phone || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Description</Text>
              <Text style={styles.infoValue}>{partnerProfile?.description || 'No description provided yet.'}</Text>
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
};

export default ProfileScreen;

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
  avatarContainer: {
    marginBottom: 15,
    alignItems: 'center',
    width: '100%',
  },
  avatarFrame: {
    position: 'relative',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: '#4CAF50',
  },
  changePhotoButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#4CAF50',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
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
  topVolunteerBadge: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#58732f',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  topVolunteerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#7da03a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  topVolunteerTextWrap: {
    alignItems: 'flex-start',
  },
  topVolunteerTitle: {
    color: '#fffbeb',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  topVolunteerSubtitle: {
    color: '#ecfccb',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
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
  saveButton: {
    backgroundColor: '#166534',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 96,
  },
  saveButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  avatarActionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 14,
  },
  cancelButton: {
    backgroundColor: '#dc2626',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 96,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
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
  statusChipPending: {
    backgroundColor: '#fef3c7',
  },
  statusChipRejected: {
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
  statusChipTextPending: {
    color: '#92400e',
  },
  statusChipTextRejected: {
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
  ratingSummaryCard: {
    width: '100%',
    backgroundColor: '#fff7ed',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: 16,
    marginBottom: 20,
  },
  ratingStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  ratingSummaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#9a3412',
    marginTop: 10,
  },
  ratingSummaryMeta: {
    fontSize: 12,
    color: '#7c2d12',
    marginTop: 4,
    lineHeight: 18,
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
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
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
  detailCardList: {
    marginTop: 8,
    gap: 10,
    marginBottom: 10,
  },
  detailCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  detailCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  detailCardMeta: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
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
  completedProgramMeta: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
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
