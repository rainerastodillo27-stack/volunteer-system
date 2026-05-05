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
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import VolunteerImpactMap from '../components/VolunteerImpactMap';
import {
  getAllProjects,
  getAllUsers,
  getPartnersByOwnerUserId,
  getVolunteerCompletedProjectIds,
  getVolunteerRecognitionStatus,
  getUserByEmailOrPhone,
  getVolunteerByUserId,
  savePartner,
  saveUser,
  saveVolunteer,
  subscribeToStorageChanges,
} from '../models/storage';
import { VolunteerRecognitionStatus } from '../models/storage';
import { NVCSector, Partner, Project, User, UserType, Volunteer } from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle, isAbortLikeError } from '../utils/requestErrors';

const USER_TYPES: UserType[] = ['Student', 'Adult', 'Senior'];
const PILLAR_OPTIONS: NVCSector[] = ['Nutrition', 'Education', 'Livelihood'];
const SAVE_SYNC_RETRY_COUNT = 3;
const SAVE_SYNC_RETRY_DELAY_MS = 250;

// Displays the signed-in user's profile, volunteer recognition, and edit form.
export default function ProfileScreen() {
  const { user, logout, updateUserProfile } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [partnerProfiles, setPartnerProfiles] = useState<Partner[]>([]);
  const [completedProjectIds, setCompletedProjectIds] = useState<string[]>([]);
  const [recognitionStatus, setRecognitionStatus] = useState<VolunteerRecognitionStatus>({
    joinedProgramCount: 0,
    isTopVolunteer: false,
  });
  const [projects, setProjects] = useState<Project[]>([]);
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
  const [profilePhotoDraft, setProfilePhotoDraft] = useState('');

  // Loads the volunteer profile plus recognition details for volunteer accounts.
  const loadVolunteerProfile = useCallback(async () => {
    if (user?.role !== 'volunteer' || !user.id) {
      setVolunteerProfile(null);
      setCompletedProjectIds([]);
      setRecognitionStatus({
        joinedProgramCount: 0,
        isTopVolunteer: false,
      });
      return;
    }

    try {
      const profile = await getVolunteerByUserId(user.id);
      setVolunteerProfile(profile);
      if (profile?.id) {
        const completedIds = await getVolunteerCompletedProjectIds(profile.id);
        setCompletedProjectIds(completedIds);
        setRecognitionStatus({ joinedProgramCount: 0, isTopVolunteer: false });
        // defer heavier recognition check
        setTimeout(async () => {
          try {
            const recognition = await getVolunteerRecognitionStatus(profile.id);
            setRecognitionStatus(recognition);
          } catch {}
        }, 50);
      } else {
        setCompletedProjectIds([]);
        setRecognitionStatus({
          joinedProgramCount: 0,
          isTopVolunteer: false,
        });
      }
      setLoadError(null);
    } catch (error) {
      if (isAbortLikeError(error)) {
        return;
      }

      console.error('Error loading volunteer profile:', error);
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load your volunteer profile.'),
      });
    }
  }, [user?.id, user?.role]);

  // Loads the signed-in partner's organization application records.
  const loadPartnerProfiles = useCallback(async () => {
    if (user?.role !== 'partner' || !user.id) {
      setPartnerProfiles([]);
      return;
    }

    try {
      const ownedPartners = await getPartnersByOwnerUserId(user.id);
      const sortedPartners = [...ownedPartners].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setPartnerProfiles(sortedPartners);
      setLoadError(null);
    } catch (error) {
      if (isAbortLikeError(error)) {
        return;
      }

      console.error('Error loading partner profile:', error);
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load your partner profile.'),
      });
    }
  }, [user?.id, user?.role]);

  // Loads project titles used to display completed volunteer work.
  const loadProjectTitles = useCallback(async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
      setLoadError(null);
    } catch (error) {
      if (isAbortLikeError(error)) {
        return;
      }

      console.error('Error loading projects for profile:', error);
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load your project history.'),
      });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadVolunteerProfile();
      void loadPartnerProfiles();
      void loadProjectTitles();
      return subscribeToStorageChanges(
        ['volunteers', 'partners', 'projects', 'volunteerProjectJoins'],
        () => {
          void loadVolunteerProfile();
          void loadPartnerProfiles();
          void loadProjectTitles();
        }
      );
    }, [loadPartnerProfiles, loadProjectTitles, loadVolunteerProfile])
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
    setProfilePhotoDraft(user.profilePhoto || '');
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

  // Closes the profile editor once saving or cancellation is complete.
  const closeEditModal = (resetDrafts = true) => {
    if (resetDrafts) {
      populateDrafts();
    }
    setShowEditModal(false);
  };

  const handleCancelEdit = () => {
    closeEditModal();
  };

  // Adds or removes a pillar-of-interest selection from the draft profile.
  const togglePillar = (pillar: NVCSector) => {
    setPillarsDraft(current =>
      current.includes(pillar)
        ? current.filter(item => item !== pillar)
        : [...current, pillar]
    );
  };

  // Opens the device photo picker and stores the selected image in the edit draft.
  const handlePickProfilePhoto = async () => {
    try {
      const selectedImage = await pickImageFromDevice();
      if (selectedImage) {
        setProfilePhotoDraft(selectedImage);
      }
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to select a profile picture.')
      );
    }
  };

  // Removes the profile picture from the current draft.
  const handleRemoveProfilePhoto = () => {
    setProfilePhotoDraft('');
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
        profilePhoto: profilePhotoDraft || undefined,
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
          createdAt: volunteerProfile?.createdAt || new Date().toISOString(),
        };

        await saveVolunteer(updatedVolunteerProfile);
        setVolunteerProfile(updatedVolunteerProfile);
        setCompletedProjectIds(updatedVolunteerProfile.pastProjects || []);
      }

      if (user.role === 'partner' && partnerProfiles.length > 0) {
        const updatedPartnerProfiles = await Promise.all(
          partnerProfiles.map(async partnerProfile => {
            const updatedPartnerProfile: Partner = {
              ...partnerProfile,
              ownerUserId: user.id,
              contactEmail: normalizedEmail || undefined,
              contactPhone: normalizedPhone || undefined,
            };
            await savePartner(updatedPartnerProfile);
            return updatedPartnerProfile;
          })
        );

        setPartnerProfiles(
          updatedPartnerProfiles.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        );
      }

      const loginIdentifier = normalizedEmail || normalizedPhone;
      const syncedUser = await waitForCredentialSync(
        loginIdentifier,
        normalizedPassword,
        user.id
      );

      await updateUserProfile(syncedUser);
      closeEditModal(false);
      Alert.alert(
        'Saved',
        `Profile updated successfully. Use ${loginIdentifier} the next time you log in.`
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update profile.')
      );
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
  const joinedProgramCount = recognitionStatus.joinedProgramCount;
  const isTopVolunteer = recognitionStatus.isTopVolunteer;
  const primaryPartnerProfile = partnerProfiles[0] || null;
  const profilePhotoUri = isImageMediaUri(user?.profilePhoto) ? user?.profilePhoto : null;
  const draftProfilePhotoUri = isImageMediaUri(profilePhotoDraft) ? profilePhotoDraft : null;
  const projectById: Record<string, Project> = Object.fromEntries(
    projects.map(project => [project.id, project])
  );
  const joinedEventProjects = projects.filter(project => {
    if (!project.isEvent) return false;
    
    const isJoinedByUser = (project.joinedUserIds || []).includes(user?.id || '');
    const isJoinedByVolunteer = volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false;
    const isAssignedToTask = (project.internalTasks || []).some(
      task => task.assignedVolunteerId === volunteerProfile?.id
    );
    
    return isJoinedByUser || isJoinedByVolunteer || isAssignedToTask;
  });

  return (
    <ScrollView style={styles.container}>
      {loadError ? (
        <View style={styles.inlineErrorWrap}>
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => {
              void loadVolunteerProfile();
              void loadProjectTitles();
            }}
          />
        </View>
      ) : null}
      <View style={styles.profileCard}>
        {profilePhotoUri ? (
          <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}

        <Text style={styles.name}>{user?.name ?? 'User'}</Text>
        <Text style={styles.email}>{user?.email ?? user?.phone ?? 'No contact info'}</Text>
        {user?.role === 'partner' && primaryPartnerProfile ? (
          <Text style={styles.subheading}>{primaryPartnerProfile.name}</Text>
        ) : null}

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

          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>
            {user?.email ?? volunteerProfile?.email ?? primaryPartnerProfile?.contactEmail ?? 'Not provided'}
          </Text>

          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>
            {user?.phone ?? volunteerProfile?.phone ?? primaryPartnerProfile?.contactPhone ?? 'Not provided'}
          </Text>

          <Text style={styles.infoLabel}>Pillars of Interest</Text>
          <Text style={styles.infoValue}>
            {(user?.pillarsOfInterest || []).length > 0
              ? user?.pillarsOfInterest?.join(', ')
              : 'No pillar preferences'}
          </Text>

          {user?.role !== 'partner' ? (
            <>
              <Text style={styles.infoLabel}>Profile Type</Text>
              <Text style={styles.infoValue}>{user?.userType || 'Adult'}</Text>
            </>
          ) : null}
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

            <View style={styles.infoContainer}>
              <Text style={styles.sectionTitle}>Volunteer Registration Details</Text>
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
              {volunteerProfile.certificationsOrTrainings ? (
                isImageMediaUri(volunteerProfile.certificationsOrTrainings) ? (
                  <Image
                    source={{ uri: volunteerProfile.certificationsOrTrainings }}
                    style={styles.certificateImage}
                  />
                ) : (
                  <Text style={styles.infoValue}>{volunteerProfile.certificationsOrTrainings}</Text>
                )
              ) : (
                <Text style={styles.infoValue}>Not provided</Text>
              )}

              <Text style={styles.infoLabel}>Hobbies and Interests</Text>
              <Text style={styles.infoValue}>{volunteerProfile.hobbiesAndInterests || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Special Skills</Text>
              <Text style={styles.infoValue}>{volunteerProfile.specialSkills || 'Not provided'}</Text>

              <Text style={styles.infoLabel}>Affiliations</Text>
              {volunteerProfile.affiliations && volunteerProfile.affiliations.length > 0 ? (
                <View style={styles.detailCardList}>
                  {volunteerProfile.affiliations.map((affiliation, index) => (
                    <View
                      key={`${affiliation.organization}-${affiliation.position}-${index}`}
                      style={styles.detailCard}
                    >
                      <Text style={styles.detailCardTitle}>
                        {affiliation.organization || 'Organization not provided'}
                      </Text>
                      <Text style={styles.detailCardSubtitle}>
                        {affiliation.position || 'Position not provided'}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.infoValue}>No affiliations provided.</Text>
              )}
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.sectionTitle}>Volunteer Activity</Text>
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

              {joinedEventProjects.length > 0 && (
                <VolunteerImpactMap projects={joinedEventProjects} />
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
          <View style={styles.infoContainer}>
            <Text style={styles.sectionTitle}>Partner Registration Details</Text>
            {partnerProfiles.length > 0 ? (
              <View style={styles.detailCardList}>
                {partnerProfiles.map(partnerProfile => (
                  <View key={partnerProfile.id} style={styles.detailCard}>
                    <Text style={styles.detailCardTitle}>{partnerProfile.name}</Text>
                    <Text style={styles.detailCardSubtitle}>
                      {partnerProfile.status} / {partnerProfile.verificationStatus || 'Pending'}
                    </Text>

                    <Text style={styles.infoLabel}>Sector Type</Text>
                    <Text style={styles.infoValue}>{partnerProfile.sectorType || 'Not provided'}</Text>

                    <Text style={styles.infoLabel}>DSWD Accreditation No.</Text>
                    <Text style={styles.infoValue}>
                      {partnerProfile.dswdAccreditationNo || 'Not provided'}
                    </Text>

                    <Text style={styles.infoLabel}>SEC Registration No.</Text>
                    <Text style={styles.infoValue}>
                      {partnerProfile.secRegistrationNo || 'Not provided'}
                    </Text>

                    <Text style={styles.infoLabel}>Advocacy Focus</Text>
                    <Text style={styles.infoValue}>
                      {partnerProfile.advocacyFocus.length > 0
                        ? partnerProfile.advocacyFocus.join(', ')
                        : 'Not provided'}
                    </Text>

                    <Text style={styles.infoLabel}>Contact Email</Text>
                    <Text style={styles.infoValue}>{partnerProfile.contactEmail || 'Not provided'}</Text>

                    <Text style={styles.infoLabel}>Contact Phone</Text>
                    <Text style={styles.infoValue}>{partnerProfile.contactPhone || 'Not provided'}</Text>

                    <Text style={styles.infoLabel}>Login Access</Text>
                    <Text style={styles.infoValue}>
                      {partnerProfile.credentialsUnlockedAt ? 'Unlocked' : 'Locked'}
                    </Text>

                    <Text style={styles.infoLabel}>Submitted On</Text>
                    <Text style={styles.infoValue}>
                      {new Date(partnerProfile.createdAt).toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.infoValue}>No partner registration details found yet.</Text>
            )}
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showEditModal} animationType="slide" onRequestClose={handleCancelEdit}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={handleCancelEdit} disabled={saveLoading}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={handleSaveProfile} disabled={saveLoading}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalLabel}>Update your account details below.</Text>

            <View style={styles.photoSection}>
              {draftProfilePhotoUri ? (
                <Image source={{ uri: draftProfilePhotoUri }} style={styles.modalAvatarImage} />
              ) : (
                <View style={styles.modalAvatarFallback}>
                  <Text style={styles.modalAvatarFallbackText}>{initials}</Text>
                </View>
              )}
              <View style={styles.photoButtonRow}>
                <TouchableOpacity
                  style={styles.photoButton}
                  onPress={handlePickProfilePhoto}
                  disabled={saveLoading}
                >
                  <Text style={styles.photoButtonText}>
                    {draftProfilePhotoUri ? 'Change Picture' : 'Add Picture'}
                  </Text>
                </TouchableOpacity>
                {draftProfilePhotoUri ? (
                  <TouchableOpacity
                    style={styles.photoButtonSecondary}
                    onPress={handleRemoveProfilePhoto}
                    disabled={saveLoading}
                  >
                    <Text style={styles.photoButtonSecondaryText}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

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
  inlineErrorWrap: {
    marginBottom: 16,
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
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 15,
    backgroundColor: '#dbeafe',
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
  subheading: {
    fontSize: 15,
    color: '#4b5563',
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
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
  detailCardList: {
    marginTop: 8,
    gap: 10,
  },
  detailCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  certificateImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: '#e2e8f0',
  },
  detailCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  detailCardSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
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
  photoSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  modalAvatarImage: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#dbeafe',
    marginBottom: 12,
  },
  modalAvatarFallback: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalAvatarFallbackText: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
  },
  photoButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  photoButton: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  photoButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  photoButtonSecondary: {
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  photoButtonSecondaryText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
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
