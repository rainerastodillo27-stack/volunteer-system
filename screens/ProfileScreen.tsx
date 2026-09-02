import React, { useCallback, useEffect, useState } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Modal,
  TextInput,
  Switch,
  Image,
  type ImageStyle,
} from 'react-native';
import { Text } from '../components/Text';
import { Picker } from '@react-native-picker/picker';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import LogoutConfirmationModal from '../components/LogoutConfirmationModal';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllProjects,
  getAllUsers,
  getPartnersByOwnerUserId,
  getVolunteerRecognitionStatus,
  getVolunteerTimeLogs,
  getUserByEmailOrPhone,
  getVolunteerByUserId,
  savePartner,
  saveUser,
  saveVolunteer,
  subscribeToStorageChanges,
} from '../models/storage';
import { VolunteerRecognitionStatus } from '../models/storage';
import { NVCSector, Partner, Project, User, UserType, Volunteer, VolunteerTimeLog, VolunteerAffiliation, PartnerSectorType, AdvocacyFocus } from '../models/types';
import { getAttachmentLabel, isImageMediaUri, openAttachmentUri, pickImageFromDevice } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle, isAbortLikeError } from '../utils/requestErrors';
import { getProjectDisplayStatus } from '../utils/projectStatus';
import { TASK_SKILL_OPTIONS } from '../utils/skills';
import VolunteerImpactMap from '../components/VolunteerImpactMap';

const USER_TYPES: UserType[] = ['Student', 'Adult', 'Senior'];
const PILLAR_OPTIONS: NVCSector[] = [];
const SAVE_SYNC_RETRY_COUNT = 3;
const SAVE_SYNC_RETRY_DELAY_MS = 250;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getEndOfDay(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function getStartOfDay(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

// Displays the signed-in user's profile, volunteer recognition, and edit form.
export default function ProfileScreen() {
  const { user, logout, updateUserProfile } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [partnerProfiles, setPartnerProfiles] = useState<Partner[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
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
  const [newPasswordDraft, setNewPasswordDraft] = useState('');
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('');
  const [userTypeDraft, setUserTypeDraft] = useState<UserType>('Adult');
  const [pillarsDraft, setPillarsDraft] = useState<NVCSector[]>([]);
  const [skillsDraft, setSkillsDraft] = useState<string[]>([]);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [isBusyDraft, setIsBusyDraft] = useState(false);
  const [profilePhotoDraft, setProfilePhotoDraft] = useState('');
  const [photoTimestamp, setPhotoTimestamp] = useState(Date.now());
  const [genderDraft, setGenderDraft] = useState('');
  const [dateOfBirthDraft, setDateOfBirthDraft] = useState('');
  const [civilStatusDraft, setCivilStatusDraft] = useState('');
  const [homeAddressDraft, setHomeAddressDraft] = useState('');
  const [occupationDraft, setOccupationDraft] = useState('');
  const [workplaceOrSchoolDraft, setWorkplaceOrSchoolDraft] = useState('');
  const [collegeCourseDraft, setCollegeCourseDraft] = useState('');
  const [certificationsOrTrainingsDraft, setCertificationsOrTrainingsDraft] = useState('');
  const [hobbiesAndInterestsDraft, setHobbiesAndInterestsDraft] = useState('');
  const [affiliationsDraft, setAffiliationsDraft] = useState<VolunteerAffiliation[]>([]);
  const [orgNameDraft, setOrgNameDraft] = useState('');
  const [dswdAccreditationNoDraft, setDswdAccreditationNoDraft] = useState('');
  const [sectorTypeDraft, setSectorTypeDraft] = useState<PartnerSectorType>('NGO');
  const [stakeholderNameDraft, setStakeholderNameDraft] = useState('');
  const [advocacyFocusDraft, setAdvocacyFocusDraft] = useState<AdvocacyFocus[]>([]);
  const [addressDraft, setAddressDraft] = useState('');

  // Loads the volunteer profile plus recognition details for volunteer accounts.
  const loadVolunteerProfile = useCallback(async () => {
    if (user?.role !== 'volunteer' || !user.id) {
      setVolunteerProfile(null);
      setVolunteerTimeLogs([]);
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
        const timeLogs = await getVolunteerTimeLogs(profile.id);
        setVolunteerTimeLogs(timeLogs);
        setRecognitionStatus({ joinedProgramCount: 0, isTopVolunteer: false });
        // defer heavier recognition check
        setTimeout(async () => {
          try {
            const recognition = await getVolunteerRecognitionStatus(profile.id);
            setRecognitionStatus(recognition);
          } catch {}
        }, 50);
      } else {
        setVolunteerTimeLogs([]);
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
    setNewPasswordDraft('');
    setConfirmPasswordDraft('');
    setUserTypeDraft(user.userType || 'Adult');
    setPillarsDraft(user.pillarsOfInterest || []);
    setSkillsDraft(volunteerProfile?.skills || []);
    setIsBusyDraft(volunteerProfile?.engagementStatus === 'Busy');
    setProfilePhotoDraft(user.profilePhoto || '');
    setGenderDraft(volunteerProfile?.gender || user?.volunteerMembershipSheet?.gender || '');
    setDateOfBirthDraft(volunteerProfile?.dateOfBirth || user?.volunteerMembershipSheet?.dateOfBirth || '');
    setCivilStatusDraft(volunteerProfile?.civilStatus || user?.volunteerMembershipSheet?.civilStatus || '');
    setHomeAddressDraft(volunteerProfile?.homeAddress || user?.volunteerMembershipSheet?.homeAddress || '');
    setOccupationDraft(volunteerProfile?.occupation || user?.volunteerMembershipSheet?.occupation || '');
    setWorkplaceOrSchoolDraft(volunteerProfile?.workplaceOrSchool || user?.volunteerMembershipSheet?.workplaceOrSchool || '');
    setCollegeCourseDraft(volunteerProfile?.collegeCourse || user?.volunteerMembershipSheet?.collegeCourse || '');
    setCertificationsOrTrainingsDraft(volunteerProfile?.certificationsOrTrainings || user?.volunteerMembershipSheet?.certificationsOrTrainings || '');
    setHobbiesAndInterestsDraft(volunteerProfile?.hobbiesAndInterests || user?.volunteerMembershipSheet?.hobbiesAndInterests || '');
    setAffiliationsDraft(volunteerProfile?.affiliations || []);

    const primaryPartner = partnerProfiles[0] || null;
    setOrgNameDraft(primaryPartner?.name || '');
    setDswdAccreditationNoDraft(primaryPartner?.dswdAccreditationNo || '');
    setSectorTypeDraft(primaryPartner?.sectorType || 'NGO');
    setStakeholderNameDraft(primaryPartner?.stakeholderName || '');
    setAdvocacyFocusDraft(primaryPartner?.advocacyFocus || []);
    setAddressDraft(primaryPartner?.address || '');
  }, [user, volunteerProfile, partnerProfiles]);

  useEffect(() => {
    populateDrafts();
  }, [populateDrafts]);

  // Update photo timestamp when profile photo changes to bust cache
  useEffect(() => {
    console.log('[ProfileScreen] Profile photo changed, updating timestamp for cache bust');
    setPhotoTimestamp(Date.now());
  }, [user?.profilePhoto]);

  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Confirms logout before clearing the signed-in session.
  const handleLogout = () => {
    setShowLogoutModal(true);
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

  const handlePickVolunteerCertificate = async () => {
    try {
      const selectedImage = await pickImageFromDevice();
      if (!selectedImage) {
        return;
      }
      setCertificationsOrTrainingsDraft(selectedImage);
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to select a certificate photo.')
      );
    }
  };

  // Removes the profile picture from the current draft.
  const handleRemoveProfilePhoto = () => {
    setProfilePhotoDraft('');
  };

  // Waits for updated credentials to be readable from shared storage before closing save flow.
  const waitForCredentialSync = async (identifier: string, password: string, userId: string) => {
    console.log('[ProfileScreen] Waiting for credential sync');
    
    for (let attempt = 0; attempt < SAVE_SYNC_RETRY_COUNT; attempt += 1) {
      const syncedUser = await getUserByEmailOrPhone(identifier);
      console.log(`[ProfileScreen] Sync attempt ${attempt + 1}, found user:`, !!syncedUser);
      
      if (syncedUser && syncedUser.id === userId && syncedUser.password === password) {
        console.log('[ProfileScreen] Credentials synced successfully!');
        return syncedUser;
      }

      if (attempt < SAVE_SYNC_RETRY_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, SAVE_SYNC_RETRY_DELAY_MS));
      }
    }

    console.error('[ProfileScreen] Sync timeout - credentials did not sync');
    throw new Error('Your profile updates did not sync yet. Please try saving again.');
  };

  // Saves the edited user and volunteer profile data.
  const handleSaveProfile = async () => {
    console.log('[ProfileScreen] handleSaveProfile called');
    
    if (!user) {
      console.log('[ProfileScreen] No user, aborting save');
      return;
    }

    const normalizedName = nameDraft.trim();
    const normalizedEmail = emailDraft.trim().toLowerCase();
    const normalizedPhone = phoneDraft.trim();
    
    console.log('[ProfileScreen] Saving profile, photo draft:', profilePhotoDraft?.substring(0, 50));
    
    // Use new password if provided, otherwise keep current password
    let normalizedPassword = passwordDraft.trim();
    if (newPasswordDraft.trim()) {
      if (newPasswordDraft !== confirmPasswordDraft) {
        Alert.alert('Validation Error', 'New passwords do not match.');
        return;
      }
      if (newPasswordDraft.trim().length < 6) {
        Alert.alert('Validation Error', 'Password must be at least 6 characters long.');
        return;
      }
      normalizedPassword = newPasswordDraft.trim();
    }

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
        volunteerMembershipSheet: user.role === 'volunteer'
          ? {
              ...(user.volunteerMembershipSheet || {}),
              gender: genderDraft,
              dateOfBirth: dateOfBirthDraft,
              civilStatus: civilStatusDraft,
              homeAddress: homeAddressDraft,
              occupation: occupationDraft,
              workplaceOrSchool: workplaceOrSchoolDraft,
              collegeCourse: collegeCourseDraft,
              certificationsOrTrainings: certificationsOrTrainingsDraft,
              hobbiesAndInterests: hobbiesAndInterestsDraft,
              specialSkills: skillsDraft.join(', '),
            }
          : user.volunteerMembershipSheet,
      };

      await saveUser(updatedUser);
      console.log('[ProfileScreen] User saved with new profile photo');
      
      // Update context immediately with the saved user
      await updateUserProfile(updatedUser);

      if (user.role === 'volunteer') {
        const baseVolunteerProfile: Volunteer = volunteerProfile || {
          id: `volunteer-${user.id}`,
          userId: user.id,
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
          skills: [],
          skillsDescription: '',
          availability: {
            daysPerWeek: 0,
            hoursPerWeek: 0,
            availableDays: [],
          },
          pastProjects: [],
          totalHoursContributed: 0,
          rating: 0,
          engagementStatus: 'Open to Volunteer',
          background: '',
          createdAt: new Date().toISOString(),
        };
        const updatedVolunteerProfile: Volunteer = {
          ...baseVolunteerProfile,
          id: baseVolunteerProfile.id || `volunteer-${user.id}`,
          userId: user.id,
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
          skills: skillsDraft,
          skillsDescription: '',
          availability: baseVolunteerProfile.availability || {
            daysPerWeek: 0,
            hoursPerWeek: 0,
            availableDays: [],
          },
          pastProjects: baseVolunteerProfile.pastProjects || [],
          totalHoursContributed: baseVolunteerProfile.totalHoursContributed || 0,
          rating: baseVolunteerProfile.rating || 0,
          engagementStatus: isBusyDraft ? 'Busy' : 'Open to Volunteer',
          background: '',
          createdAt: baseVolunteerProfile.createdAt || new Date().toISOString(),
          gender: genderDraft,
          dateOfBirth: dateOfBirthDraft,
          civilStatus: civilStatusDraft,
          homeAddress: homeAddressDraft,
          occupation: occupationDraft,
          workplaceOrSchool: workplaceOrSchoolDraft,
          collegeCourse: collegeCourseDraft,
          certificationsOrTrainings: certificationsOrTrainingsDraft,
          hobbiesAndInterests: hobbiesAndInterestsDraft,
          affiliations: affiliationsDraft,
        };

        await saveVolunteer(updatedVolunteerProfile);
        setVolunteerProfile(updatedVolunteerProfile);
      }

      if (user.role === 'partner' && partnerProfiles.length > 0) {
        const updatedPartnerProfiles = await Promise.all(
          partnerProfiles.map(async partnerProfile => {
            const updatedPartnerProfile: Partner = {
              ...partnerProfile,
              name: orgNameDraft.trim(),
              dswdAccreditationNo: dswdAccreditationNoDraft.trim(),
              sectorType: sectorTypeDraft,
              stakeholderName: stakeholderNameDraft.trim(),
              advocacyFocus: advocacyFocusDraft,
              address: addressDraft.trim(),
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
      await waitForCredentialSync(
        loginIdentifier,
        normalizedPassword,
        user.id
      );

      closeEditModal(false);
      
      const changedItems = [];
      if (normalizedEmail !== user.email) changedItems.push('email');
      if (normalizedPhone !== user.phone) changedItems.push('phone');
      if (newPasswordDraft.trim()) changedItems.push('password');
      
      const changesText = changedItems.length > 0 
        ? ` Your ${changedItems.join(', ')} has been updated.`
        : '';
      
      Alert.alert(
        'Saved',
        `Profile updated successfully.${changesText} Use ${loginIdentifier} to log in.`
      );
    } catch (error) {
      console.error('[ProfileScreen] Save failed:', error);
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
  const joinedProgramCount = recognitionStatus.joinedProgramCount;
  const isTopVolunteer = recognitionStatus.isTopVolunteer;
  const primaryPartnerProfile = partnerProfiles[0] || null;
  const profilePhotoUri = isImageMediaUri(user?.profilePhoto) ? user?.profilePhoto : null;
  const draftProfilePhotoUri = isImageMediaUri(profilePhotoDraft) ? profilePhotoDraft : null;
  
  // Use timestamp for cache busting - forces re-render when photo changes
  const photoKey = profilePhotoUri ? `photo-${photoTimestamp}` : 'no-photo';
  const draftPhotoKey = draftProfilePhotoUri ? `draft-${draftProfilePhotoUri.substring(0, 50)}` : 'no-draft-photo';
  const joinedEventProjects = projects.filter(project => {
    if (!project.isEvent) return false;
    
    const isJoinedByUser = (project.joinedUserIds || []).includes(user?.id || '');
    const isJoinedByVolunteer = volunteerProfile ? project.volunteers.includes(volunteerProfile.id) : false;
    const isAssignedToTask = (project.internalTasks || []).some(
      task => task.assignedVolunteerId === volunteerProfile?.id
    );
    
    return isJoinedByUser || isJoinedByVolunteer || isAssignedToTask;
  });
  const completedEvents = joinedEventProjects
    .filter(project => getProjectDisplayStatus(project) === 'Completed')
    .filter(project => {
      const completedLogs = volunteerTimeLogs
        .filter(log => log.projectId === project.id && Boolean(log.timeIn) && Boolean(log.timeOut))
        .sort(
          (left, right) =>
            new Date(right.timeOut || right.timeIn).getTime() -
            new Date(left.timeOut || left.timeIn).getTime()
        );

      if (completedLogs.length === 0) {
        return false;
      }

      const latestCompletedLog = completedLogs[0];
      const eventEndDay = getEndOfDay(project.endDate || project.startDate);
      const lastAttendanceDay = getStartOfDay(latestCompletedLog.timeOut || latestCompletedLog.timeIn);

      if (!eventEndDay || !lastAttendanceDay) {
        return false;
      }

      const eventEndStartDay = new Date(eventEndDay);
      eventEndStartDay.setHours(0, 0, 0, 0);

      const absentDaysBeforeEventFinished = Math.max(
        0,
        Math.floor((eventEndStartDay.getTime() - lastAttendanceDay.getTime()) / MS_PER_DAY)
      );

      return absentDaysBeforeEventFinished < 7;
    })
    .sort(
      (left, right) =>
        new Date(right.endDate || right.startDate).getTime() -
        new Date(left.endDate || left.startDate).getTime()
    );
  const accountOverviewCards = [
    {
      label: 'Role',
      value:
        user?.role === 'admin'
          ? 'National Volunteer Coordinator (NVC)'
          : user?.role === 'partner'
            ? 'Partner Account'
            : 'Volunteer',
    },
    {
      label: 'Email',
      value: user?.email ?? volunteerProfile?.email ?? primaryPartnerProfile?.contactEmail ?? 'Not provided',
    },
    {
      label: 'Phone',
      value: user?.phone ?? volunteerProfile?.phone ?? primaryPartnerProfile?.contactPhone ?? 'Not provided',
    },
    ...(user?.role === 'volunteer'
      ? [
          {
            label: 'Events Joined',
            value: String(new Set(volunteerTimeLogs.map(log => log.projectId)).size),
          },
        ]
      : []),
    ...(user?.role !== 'partner'
      ? [
          {
            label: 'Profile Type',
            value: user?.userType || 'Adult',
          },
        ]
      : []),
  ];
  const volunteerRegistrationCards = volunteerProfile
    ? [
        { label: 'Gender', value: volunteerProfile.gender || 'Not provided' },
        { label: 'Date of Birth', value: volunteerProfile.dateOfBirth || 'Not provided' },
        { label: 'Civil Status', value: volunteerProfile.civilStatus || 'Not provided' },
        { label: 'Home Address', value: volunteerProfile.homeAddress || 'Not provided' },
        { label: 'Occupation', value: volunteerProfile.occupation || 'Not provided' },
        { label: 'Workplace or School', value: volunteerProfile.workplaceOrSchool || 'Not provided' },
        { label: 'College Course', value: volunteerProfile.collegeCourse || 'Not provided' },
      ]
    : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
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

      {/* Screen Title Header */}
      <View style={styles.headerContainer}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitleText}>My Profile</Text>
          <View style={styles.headerUnderline} />
        </View>
        <TouchableOpacity style={styles.headerEditButton} onPress={openEditModal}>
          <MaterialIcons name="edit" size={18} color="#166534" style={{ marginRight: 6 }} />
          <Text style={styles.headerEditButtonText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* Hero Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroLeft}>
          {profilePhotoUri ? (
            <Image 
              key={photoKey}
              source={{ uri: profilePhotoUri }} 
              style={styles.heroAvatarImage as ImageStyle} 
            />
          ) : (
            <View style={styles.heroAvatarTextContainer}>
              <Text style={styles.heroAvatarText}>{initials}</Text>
            </View>
          )}

          <View style={styles.heroCopy}>
            <Text style={styles.heroName}>{user?.name ?? 'User'}</Text>
            <Text style={styles.heroEmail}>{user?.email ?? user?.phone ?? 'No contact info'}</Text>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>
                {user?.role === 'volunteer'
                  ? 'Volunteer'
                  : user?.role === 'admin'
                  ? 'Admin'
                  : 'Partner'}
              </Text>
            </View>
          </View>
        </View>

      </View>

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

      {/* Account Overview Section */}
      {user?.role === 'volunteer' && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="person-outline" size={24} color="#166534" />
            <Text style={styles.sectionTitleText}>Account Overview</Text>
          </View>
          
          <View style={styles.overviewGrid}>
            <View style={styles.overviewItem}>
              <View style={styles.overviewIconWrap}>
                <MaterialIcons name="person" size={20} color="#166534" />
              </View>
              <View style={styles.overviewTextWrap}>
                <Text style={styles.overviewLabel}>ROLE</Text>
                <Text style={styles.overviewValue}>Volunteer</Text>
              </View>
            </View>

            <View style={styles.overviewItem}>
              <View style={styles.overviewIconWrap}>
                <MaterialIcons name="mail-outline" size={20} color="#166534" />
              </View>
              <View style={styles.overviewTextWrap}>
                <Text style={styles.overviewLabel}>EMAIL</Text>
                <Text style={styles.overviewValue} numberOfLines={1} ellipsizeMode="tail">
                  {user?.email ?? volunteerProfile?.email ?? 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.overviewItem}>
              <View style={styles.overviewIconWrap}>
                <MaterialIcons name="phone" size={20} color="#166534" />
              </View>
              <View style={styles.overviewTextWrap}>
                <Text style={styles.overviewLabel}>PHONE</Text>
                <Text style={styles.overviewValue}>
                  {user?.phone ?? volunteerProfile?.phone ?? 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.overviewItem}>
              <View style={styles.overviewIconWrap}>
                <MaterialIcons name="assignment-ind" size={20} color="#166534" />
              </View>
              <View style={styles.overviewTextWrap}>
                <Text style={styles.overviewLabel}>PROFILE TYPE</Text>
                <Text style={styles.overviewValue}>{user?.userType || 'Adult'}</Text>
              </View>
            </View>
          </View>

          {/* Stats Panel */}
          <View style={styles.statsPanel}>
            <View style={styles.statBlock}>
              <View style={styles.statIconWrap}>
                <MaterialIcons name="calendar-today" size={24} color="#166534" />
              </View>
              <View style={styles.statTextWrap}>
                <Text style={styles.statLabelUpper}>EVENTS JOINED</Text>
                <Text style={styles.statCountText}>{new Set(volunteerTimeLogs.map(log => log.projectId)).size}</Text>
                <Text style={styles.statLabelLower}>Joined Events</Text>
              </View>
            </View>
            
            <View style={styles.statDivider} />
            
            <View style={styles.statBlock}>
              <View style={styles.statTextWrap}>
                <View style={styles.statusRow}>
                  <Text style={styles.statLabelUpper}>STATUS</Text>
                  <View style={styles.statusIndicatorRow}>
                    <View style={[styles.statusDot, volunteerProfile?.engagementStatus === 'Busy' ? styles.statusDotBusy : styles.statusDotOpen]} />
                    <Text style={styles.statusText}>{volunteerProfile?.engagementStatus === 'Busy' ? 'Busy' : 'Active'}</Text>
                  </View>
                </View>
                <Text style={styles.statCountText}>{completedEvents.length}</Text>
                <Text style={styles.statLabelLower}>Completed Events</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* User Account Details */}
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitleText}>User Account Details</Text>
        <View style={styles.detailInfoCard}>
          <Text style={styles.detailInfoLabel}>Name</Text>
          <Text style={styles.detailInfoValue}>{user?.name || 'Not provided'}</Text>
        </View>
        <View style={styles.detailInfoCard}>
          <Text style={styles.detailInfoLabel}>Email</Text>
          <Text style={styles.detailInfoValue}>{user?.email || 'Not provided'}</Text>
        </View>
        <View style={styles.detailInfoCard}>
          <Text style={styles.detailInfoLabel}>Phone</Text>
          <Text style={styles.detailInfoValue}>{user?.phone || 'Not provided'}</Text>
        </View>
        <View style={styles.detailInfoCard}>
          <Text style={styles.detailInfoLabel}>Profile Type</Text>
          <Text style={styles.detailInfoValue}>{user?.userType || 'Not provided'}</Text>
        </View>
        <View style={styles.detailInfoCard}>
          <Text style={styles.detailInfoLabel}>Approval Status</Text>
          <Text style={styles.detailInfoValue}>{user?.approvalStatus || 'Not provided'}</Text>
        </View>
        <View style={styles.detailInfoCard}>
          <Text style={styles.detailInfoLabel}>Submitted</Text>
          <Text style={styles.detailInfoValue}>
            {user?.createdAt ? new Date(user.createdAt).toLocaleString() : 'Not provided'}
          </Text>
        </View>
      </View>

      {/* Volunteer Registration Details Section */}
      {user?.role === 'volunteer' && volunteerProfile && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="assignment" size={24} color="#166534" />
            <Text style={styles.sectionTitleText}>Volunteer Registration Details</Text>
          </View>

          <View style={styles.regGrid}>
            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="wc" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>GENDER</Text>
                <Text style={styles.regValue}>{volunteerProfile.gender || user?.volunteerMembershipSheet?.gender || 'Not provided'}</Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="people-outline" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>CIVIL STATUS</Text>
                <Text style={styles.regValue}>{volunteerProfile.civilStatus || user?.volunteerMembershipSheet?.civilStatus || 'Not provided'}</Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="work-outline" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>OCCUPATION</Text>
                <Text style={styles.regValue}>{volunteerProfile.occupation || user?.volunteerMembershipSheet?.occupation || 'Not provided'}</Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="school" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>COLLEGE COURSE</Text>
                <Text style={styles.regValue}>{volunteerProfile.collegeCourse || user?.volunteerMembershipSheet?.collegeCourse || 'Not provided'}</Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="card-membership" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>CERTIFICATIONS OR TRAININGS</Text>
                {volunteerProfile.certificationsOrTrainings || user?.volunteerMembershipSheet?.certificationsOrTrainings ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <Text style={[styles.regValue, { flex: 1 }]} numberOfLines={1}>
                      {isImageMediaUri(volunteerProfile.certificationsOrTrainings || user?.volunteerMembershipSheet?.certificationsOrTrainings)
                        ? getAttachmentLabel(volunteerProfile.certificationsOrTrainings || user?.volunteerMembershipSheet?.certificationsOrTrainings || '')
                        : (volunteerProfile.certificationsOrTrainings || user?.volunteerMembershipSheet?.certificationsOrTrainings)}
                    </Text>
                    {isImageMediaUri(volunteerProfile.certificationsOrTrainings || user?.volunteerMembershipSheet?.certificationsOrTrainings) ? (
                      <TouchableOpacity
                        onPress={async () => {
                          try {
                            await openAttachmentUri((volunteerProfile.certificationsOrTrainings || user?.volunteerMembershipSheet?.certificationsOrTrainings) || '');
                          } catch (error: any) {
                            Alert.alert(
                              'Unable to Open Certificate',
                              error?.message || 'Certificate attachment could not be opened.',
                            );
                          }
                        }}
                        style={styles.attachmentIconButton}
                      >
                        <MaterialIcons name="visibility" size={16} color="#166534" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.regValue}>Not provided</Text>
                )}
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="groups" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>AFFILIATIONS</Text>
                <Text style={styles.regValue}>
                  {volunteerProfile.affiliations && volunteerProfile.affiliations.length > 0
                    ? `${volunteerProfile.affiliations[0].position} at ${volunteerProfile.affiliations[0].organization}`
                    : 'No affiliations provided.'}
                </Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="cake" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>DATE OF BIRTH</Text>
                <Text style={styles.regValue}>{volunteerProfile.dateOfBirth || 'Not provided'}</Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="public" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>REGION / CITY / BARANGAY</Text>
                <Text style={styles.regValue}>
                  {[volunteerProfile.homeAddressRegion, volunteerProfile.homeAddressCityMunicipality, volunteerProfile.homeAddressBarangay]
                    .filter(Boolean)
                    .join(' / ') || 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="home" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>HOME ADDRESS</Text>
                <Text style={styles.regValue}>{volunteerProfile.homeAddress || 'Not provided'}</Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="business" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>WORKPLACE OR SCHOOL</Text>
                <Text style={styles.regValue}>{volunteerProfile.workplaceOrSchool || 'Not provided'}</Text>
              </View>
            </View>

            <View style={styles.regItem}>
              <View style={styles.regIconWrap}>
                <MaterialIcons name="school" size={18} color="#166534" />
              </View>
              <View style={styles.regTextWrap}>
                <Text style={styles.regLabel}>COLLEGE COURSE</Text>
                <Text style={styles.regValue}>{volunteerProfile.collegeCourse || 'Not provided'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Volunteer Skills & Completed Events Section */}
      {user?.role === 'volunteer' && volunteerProfile && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="bolt" size={24} color="#166534" />
            <Text style={styles.sectionTitleText}>Volunteer Activity & Skills</Text>
          </View>

          <Text style={styles.subsectionLabel}>Skills</Text>
          {volunteerProfile.skills.length > 0 ? (
            <View style={styles.skillList}>
              {volunteerProfile.skills.map(skill => (
                <View key={skill} style={styles.skillChip}>
                  <Text style={styles.skillChipText}>{skill}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={[styles.detailInfoCard, styles.detailInfoCardWide, { marginBottom: 12 }]}>
              <Text style={styles.detailInfoValue}>No skills added yet.</Text>
            </View>
          )}

          <Text style={styles.subsectionLabel}>Completed Events</Text>
          {completedEvents.length > 0 ? (
            <View style={styles.completedProgramsList}>
              {completedEvents.map(project => (
                <View key={project.id} style={styles.completedProgramCard}>
                  <Text style={styles.completedProgramTitle}>
                    {project.title}
                  </Text>
                  {project.location?.address ? (
                    <Text style={styles.completedProgramMeta}>
                      {project.location.address}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <View style={[styles.detailInfoCard, styles.detailInfoCardWide]}>
              <Text style={styles.detailInfoValue}>No completed events yet.</Text>
            </View>
          )}
        </View>
      )}

      {/* Personal Impact Map Section */}
      {user?.role === 'volunteer' && volunteerProfile && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="map" size={24} color="#166534" />
            <Text style={styles.sectionTitleText}>Personal Impact Map</Text>
          </View>
          <View style={styles.profileMapCard}>
            <VolunteerImpactMap
              projects={projects}
              volunteerAccounts={[
                {
                  id: volunteerProfile.id,
                  label: volunteerProfile.name,
                  projectIds: joinedEventProjects.map(p => p.id),
                },
              ]}
              initialMapStyleKey="volunteer-view"
              title="Personal Impact Map"
              subtitle="Pinned places where you joined or completed volunteer work."
            />
          </View>
        </View>
      )}

      {/* Admin and Partner Sections */}
      {user?.role === 'admin' && (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitleText}>About</Text>
          <View style={[styles.detailInfoCard, styles.detailInfoCardWide]}>
            <Text style={styles.detailInfoLabel}>Coordinator Scope</Text>
            <Text style={styles.detailInfoValue}>
              Oversees program rollouts, partner validation, and volunteer engagement across Negros Occidental.
            </Text>
          </View>
        </View>
      )}

      {user?.role === 'partner' && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="assignment" size={24} color="#166534" />
            <Text style={styles.sectionTitleText}>Partner Registration Details</Text>
          </View>
          
          {partnerProfiles.length > 0 ? (
            <View style={styles.partnerGrid}>
              {partnerProfiles.map(partnerProfile => {
                const statusStr = [partnerProfile.status, partnerProfile.verificationStatus]
                  .filter(Boolean)
                  .join(' / ');
                  
                const locationStr = partnerProfile.address ||
                  [partnerProfile.cityMunicipality, partnerProfile.province, partnerProfile.region]
                    .filter(Boolean)
                    .join(', ') ||
                  'Not provided';

                return (
                  <View key={partnerProfile.id} style={styles.partnerGridInner}>
                    {/* Organization */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="security" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Organization</Text>
                        <Text style={styles.partnerGridValue}>{partnerProfile.name}</Text>
                      </View>
                    </View>

                    {/* Status */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="check-circle-outline" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Status</Text>
                        <Text style={[styles.partnerGridValue, { color: '#166534' }]}>{statusStr}</Text>
                      </View>
                    </View>

                    {/* DSWD Accreditation No. */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="card-membership" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>DSWD Accreditation No.</Text>
                        <Text style={styles.partnerGridValue}>{partnerProfile.dswdAccreditationNo || 'Not provided'}</Text>
                      </View>
                    </View>

                    {/* Sector Type */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="business" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Sector Type</Text>
                        <Text style={styles.partnerGridValue}>{partnerProfile.sectorType || 'Not provided'}</Text>
                      </View>
                    </View>

                    {/* Stakeholder Name */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="person" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Stakeholder Name</Text>
                        <Text style={styles.partnerGridValue}>{partnerProfile.stakeholderName || 'Not provided'}</Text>
                      </View>
                    </View>

                    {/* Advocacy Focus */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="track-changes" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Advocacy Focus</Text>
                        <Text style={styles.partnerGridValue}>
                          {partnerProfile.advocacyFocus && partnerProfile.advocacyFocus.length > 0
                            ? partnerProfile.advocacyFocus.join(', ')
                            : 'Not provided'}
                        </Text>
                      </View>
                    </View>

                    {/* Contact Email */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="mail-outline" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Contact Email</Text>
                        <Text style={styles.partnerGridValue}>{partnerProfile.contactEmail || 'Not provided'}</Text>
                      </View>
                    </View>

                    {/* Contact Phone */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="phone" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Contact Phone</Text>
                        <Text style={styles.partnerGridValue}>{partnerProfile.contactPhone || 'Not provided'}</Text>
                      </View>
                    </View>

                    {/* Location */}
                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="location-on" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Location</Text>
                        <Text style={styles.partnerGridValue}>{locationStr}</Text>
                      </View>
                    </View>

                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="badge" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Stakeholder Name</Text>
                        <Text style={styles.partnerGridValue}>{partnerProfile.stakeholderName || 'Not provided'}</Text>
                      </View>
                    </View>

                    <View style={styles.partnerGridItem}>
                      <View style={styles.partnerGridIconWrap}>
                        <MaterialIcons name="public" size={20} color="#166534" />
                      </View>
                      <View style={styles.partnerGridTextWrap}>
                        <Text style={styles.partnerGridLabel}>Region / Province / City</Text>
                        <Text style={styles.partnerGridValue}>
                          {[partnerProfile.region, partnerProfile.province, partnerProfile.cityMunicipality]
                            .filter(Boolean)
                            .join(', ') || 'Not provided'}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.infoValue}>No partner registration details found yet.</Text>
          )}
        </View>
      )}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <MaterialIcons name="logout" size={20} color="#ffffff" style={{ marginRight: 8 }} />
        <Text style={styles.logoutButtonText}>Logout</Text>
      </TouchableOpacity>

      <LogoutConfirmationModal
        visible={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={logout}
      />

      {/* Edit Profile Modal */}
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
                <Image 
                  key={draftPhotoKey}
                  source={{ uri: draftProfilePhotoUri }} 
                  style={styles.modalAvatarImage as ImageStyle} 
                />
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

            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Full name"
              editable={!saveLoading}
            />

            <Text style={styles.fieldLabel}>Username (Email)</Text>
            <TextInput
              style={styles.input}
              value={emailDraft}
              onChangeText={setEmailDraft}
              placeholder={user?.email || "your.username@example.com"}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!saveLoading}
            />
            
            <Text style={styles.fieldLabel}>Phone Number (Optional)</Text>
            <TextInput
              style={styles.input}
              value={phoneDraft}
              onChangeText={setPhoneDraft}
              placeholder={user?.phone || "Phone number"}
              keyboardType="phone-pad"
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

            {user?.role === 'partner' && (
              <>
                <Text style={styles.sectionHeader}>Partner Registration Details</Text>
                
                <Text style={styles.fieldLabel}>Organization Name</Text>
                <TextInput
                  style={styles.input}
                  value={orgNameDraft}
                  onChangeText={setOrgNameDraft}
                  placeholder="Organization Name"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>Sector Type</Text>
                <View style={styles.optionRow}>
                  {['NGO', 'Hospital', 'Institution', 'Private'].map(sector => (
                    <TouchableOpacity
                      key={sector}
                      style={[styles.optionChip, sectorTypeDraft === sector && styles.optionChipActive]}
                      onPress={() => setSectorTypeDraft(sector as PartnerSectorType)}
                      disabled={saveLoading}
                    >
                      <Text style={[styles.optionChipText, sectorTypeDraft === sector && styles.optionChipTextActive]}>
                        {sector}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {sectorTypeDraft === 'NGO' && (
                  <>
                    <Text style={styles.fieldLabel}>DSWD Accreditation No.</Text>
                    <TextInput
                      style={styles.input}
                      value={dswdAccreditationNoDraft}
                      onChangeText={setDswdAccreditationNoDraft}
                      placeholder="DSWD Accreditation No."
                      editable={!saveLoading}
                    />
                  </>
                )}

                <Text style={styles.fieldLabel}>Stakeholder Name</Text>
                <TextInput
                  style={styles.input}
                  value={stakeholderNameDraft}
                  onChangeText={setStakeholderNameDraft}
                  placeholder="Stakeholder Name"
                  editable={!saveLoading}
                />

                {/* Advocacy Focus field removed */}

                <Text style={styles.fieldLabel}>Location Address</Text>
                <TextInput
                  style={styles.input}
                  value={addressDraft}
                  onChangeText={setAddressDraft}
                  placeholder="Full Address"
                  editable={!saveLoading}
                />
              </>
            )}

            {user?.role === 'volunteer' && (
              <>
                <Text style={styles.sectionHeader}>Volunteer Registration Details</Text>
                
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.optionRow}>
                  {['Male', 'Female', 'Prefer not to say'].map(gender => (
                    <TouchableOpacity
                      key={gender}
                      style={[styles.optionChip, genderDraft === gender && styles.optionChipActive]}
                      onPress={() => setGenderDraft(gender)}
                      disabled={saveLoading}
                    >
                      <Text style={[styles.optionChipText, genderDraft === gender && styles.optionChipTextActive]}>
                        {gender}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Civil Status</Text>
                <View style={styles.optionRow}>
                  {['Single', 'Married', 'Widowed', 'Separated'].map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[styles.optionChip, civilStatusDraft === status && styles.optionChipActive]}
                      onPress={() => setCivilStatusDraft(status)}
                      disabled={saveLoading}
                    >
                      <Text style={[styles.optionChipText, civilStatusDraft === status && styles.optionChipTextActive]}>
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Date of Birth</Text>
                <TextInput
                  style={styles.input}
                  value={dateOfBirthDraft}
                  onChangeText={setDateOfBirthDraft}
                  placeholder="YYYY-MM-DD (e.g. 1960-05-15)"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>Home Address</Text>
                <TextInput
                  style={styles.input}
                  value={homeAddressDraft}
                  onChangeText={setHomeAddressDraft}
                  placeholder="Full Home Address"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>Occupation</Text>
                <TextInput
                  style={styles.input}
                  value={occupationDraft}
                  onChangeText={setOccupationDraft}
                  placeholder="Occupation"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>Workplace or School</Text>
                <TextInput
                  style={styles.input}
                  value={workplaceOrSchoolDraft}
                  onChangeText={setWorkplaceOrSchoolDraft}
                  placeholder="Workplace or School"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>College Course</Text>
                <TextInput
                  style={styles.input}
                  value={collegeCourseDraft}
                  onChangeText={setCollegeCourseDraft}
                  placeholder="College Course (if applicable)"
                  editable={!saveLoading}
                />

                <Text style={styles.fieldLabel}>Certifications or Trainings</Text>
                <View style={styles.certificateActionsRow}>
                  <TouchableOpacity
                    style={[styles.photoButton, styles.certificatePrimaryButton, saveLoading && { opacity: 0.6 }]}
                    onPress={handlePickVolunteerCertificate}
                    disabled={saveLoading}
                  >
                    <Text style={styles.photoButtonText}>
                      {certificationsOrTrainingsDraft
                        ? 'Change Certificate Photo'
                        : 'Upload Certificate Photo'}
                    </Text>
                  </TouchableOpacity>
                  {certificationsOrTrainingsDraft ? (
                    <TouchableOpacity
                      style={[styles.photoButtonSecondary, styles.certificateSecondaryButton]}
                      onPress={() => setCertificationsOrTrainingsDraft('')}
                      disabled={saveLoading}
                    >
                      <Text style={styles.photoButtonSecondaryText}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {certificationsOrTrainingsDraft ? (
                  isImageMediaUri(certificationsOrTrainingsDraft) ? (
                    <View style={styles.certificatePreviewCard}>
                      <View style={styles.certificatePreviewTopRow}>
                        <Image
                          source={{ uri: certificationsOrTrainingsDraft }}
                          style={styles.certificatePreviewThumb as any}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.certificatePreviewLabel}>
                            {getAttachmentLabel(certificationsOrTrainingsDraft)}
                          </Text>
                          <TouchableOpacity
                            onPress={async () => {
                              try {
                                await openAttachmentUri(certificationsOrTrainingsDraft);
                              } catch (error: any) {
                                Alert.alert(
                                  'Unable to Open Certificate',
                                  error?.message || 'Certificate attachment could not be opened.',
                                );
                              }
                            }}
                            disabled={saveLoading}
                            style={{ alignSelf: 'flex-start', marginTop: 8 }}
                          >
                            <Text style={styles.certificatePreviewLink}>View</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={certificationsOrTrainingsDraft}
                      onChangeText={setCertificationsOrTrainingsDraft}
                      placeholder="Certifications or Trainings"
                      editable={!saveLoading}
                    />
                  )
                ) : null}

                <Text style={styles.fieldLabel}>Affiliation (Primary Organization)</Text>
                <TextInput
                  style={styles.input}
                  value={affiliationsDraft[0]?.organization || ''}
                  onChangeText={(text) => {
                    setAffiliationsDraft(prev => {
                      const copy = [...prev];
                      if (copy.length === 0) {
                        copy.push({ organization: text, position: '' });
                      } else {
                        copy[0] = { ...copy[0], organization: text };
                      }
                      return copy;
                    });
                  }}
                  placeholder="Organization Name"
                  editable={!saveLoading}
                />
                
                <Text style={styles.fieldLabel}>Affiliation (Primary Role / Position)</Text>
                <TextInput
                  style={styles.input}
                  value={affiliationsDraft[0]?.position || ''}
                  onChangeText={(text) => {
                    setAffiliationsDraft(prev => {
                      const copy = [...prev];
                      if (copy.length === 0) {
                        copy.push({ organization: '', position: text });
                      } else {
                        copy[0] = { ...copy[0], position: text };
                      }
                      return copy;
                    });
                  }}
                  placeholder="Position / Role"
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

            <Text style={styles.sectionHeader}>Change Password</Text>
            <Text style={styles.sectionHint}>Leave blank to keep your current password.</Text>
            
            <Text style={styles.fieldLabel}>New Password</Text>
            <TextInput
              style={styles.input}
              value={newPasswordDraft}
              onChangeText={setNewPasswordDraft}
              placeholder="Enter new password (min 6 characters)"
              secureTextEntry
              editable={!saveLoading}
              autoCapitalize="none"
            />
            
            <Text style={styles.fieldLabel}>Confirm New Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPasswordDraft}
              onChangeText={setConfirmPasswordDraft}
              placeholder="Re-enter new password"
              secureTextEntry
              editable={!saveLoading}
              autoCapitalize="none"
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Skills Selection Modal */}
      <Modal visible={showSkillsModal} animationType="slide" onRequestClose={() => setShowSkillsModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSkillsModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Select Skills</Text>
            <TouchableOpacity onPress={() => setShowSkillsModal(false)}>
              <Text style={styles.modalSave}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalLabel}>Tap to select or deselect skills.</Text>
            
            {TASK_SKILL_OPTIONS.map(skill => {
              const isSelected = skillsDraft.includes(skill);
              return (
                <TouchableOpacity
                  key={skill}
                  style={styles.skillOptionRow}
                  onPress={() => {
                    setSkillsDraft(prev =>
                      prev.includes(skill)
                        ? prev.filter(s => s !== skill)
                        : [...prev, skill]
                    );
                  }}
                >
                  <Text style={styles.skillOptionText}>{skill}</Text>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && (
                      <MaterialIcons name="check" size={18} color="#fff" />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 16,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  inlineErrorWrap: {
    marginBottom: 16,
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitleContainer: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  headerTitleText: {
    fontSize: 26,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#0f172a',
  },
  headerUnderline: {
    height: 4,
    width: 36,
    backgroundColor: '#166534',
    marginTop: 4,
    borderRadius: 2,
  },
  headerEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
  },
  headerEditButtonText: {
    color: '#334155',
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
  },
  heroCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 16,
    width: '100%',
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  heroAvatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  heroAvatarTextContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#3b5c32',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  heroAvatarText: {
    color: '#ffffff',
    fontSize: 26,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
  },
  heroCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  heroName: {
    fontSize: 22,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#0f172a',
  },
  heroEmail: {
    fontSize: 15,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    marginTop: 2,
  },
  heroBadge: {
    backgroundColor: '#eaf5eb',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  heroBadgeText: {
    color: '#166534',
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroIllustration: {
    width: 120,
    height: 80,
    marginLeft: 8,
  },
  sectionBlock: {
    width: '100%',
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 8,
  },
  sectionTitleText: {
    fontSize: 18,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#166534',
    marginLeft: 8,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  overviewItem: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  overviewIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#f0fdf4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  overviewTextWrap: {
    flex: 1,
  },
  overviewLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  overviewValue: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#0f172a',
    fontWeight: '700',
    marginTop: 2,
  },
  statsPanel: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  statBlock: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  statIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eaf5eb',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  statTextWrap: {
    flex: 1,
  },
  statLabelUpper: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statCountText: {
    fontSize: 28,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#0f172a',
    marginVertical: 1,
  },
  statLabelLower: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
  },
  statDivider: {
    width: 1,
    height: 50,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  statusIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  statusDotOpen: {
    backgroundColor: '#22c55e',
  },
  statusDotBusy: {
    backgroundColor: '#ef4444',
  },
  statusText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#1e293b',
  },
  regGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  regItem: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  regIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  regTextWrap: {
    flex: 1,
  },
  regLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  regValue: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#334155',
    fontWeight: '700',
    marginTop: 2,
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
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  topVolunteerSubtitle: {
    color: '#ecfccb',
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    marginTop: 2,
  },
  detailInfoCard: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  detailInfoCardWide: {
    width: '100%',
  },
  detailInfoLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.25,
    marginBottom: 4,
  },
  detailInfoValue: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#0f172a',
    lineHeight: 18,
    fontWeight: '600',
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#333',
    marginTop: 3,
    marginBottom: 10,
    fontWeight: '600',
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
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skillChipText: {
    color: '#166534',
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
  },
  subsectionLabel: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
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
  detailCardTitle: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    color: '#0f172a',
  },
  detailCardSubtitle: {
    marginTop: 4,
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#475569',
    fontWeight: '600',
  },
  completedProgramsList: {
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
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    color: '#0f172a',
  },
  completedProgramMeta: {
    marginTop: 4,
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    lineHeight: 16,
    color: '#64748b',
  },
  logoutButton: {
    width: '100%',
    backgroundColor: '#dc2626',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  logoutButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#0f172a',
  },
  modalCancel: {
    color: '#64748b',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
  },
  modalSave: {
    color: '#15803d',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
  },
  modalBody: {
    padding: 16,
    paddingBottom: 40,
  },
  modalLabel: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#475569',
    marginBottom: 16,
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
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalAvatarFallbackText: {
    fontSize: 32,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    color: '#ffffff',
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
    color: '#ffffff',
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
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
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
  },
  attachmentIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  certificateActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  certificatePrimaryButton: {
    flex: 1,
  },
  certificateSecondaryButton: {
    paddingHorizontal: 14,
  },
  certificatePreviewCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  certificatePreviewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  certificatePreviewThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  certificatePreviewLabel: {
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    color: '#0f172a',
  },
  certificatePreviewLink: {
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#15803d',
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#0f172a',
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#334155',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '800',
    color: '#166534',
    marginTop: 24,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 18,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  optionChipActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  optionChipText: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    color: '#475569',
  },
  optionChipTextActive: {
    color: '#ffffff',
  },
  switchRow: {
    marginTop: 8,
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
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    lineHeight: 18,
  },
  dropdownButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  dropdownButtonText: {
    fontSize: 15,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#334155',
    fontWeight: '600',
  },
  selectedSkillsPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  skillPreviewChip: {
    backgroundColor: '#ecfdf5',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skillPreviewText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#166534',
    fontWeight: '700',
  },
  skillOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  skillOptionText: {
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#0f172a',
    fontWeight: '600',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2.5,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  partnerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  partnerGridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
  },
  partnerGridItem: {
    width: '31%',
    minWidth: 160,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  partnerGridIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  partnerGridTextWrap: {
    flex: 1,
  },
  partnerGridLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#64748b',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  partnerGridValue: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#334155',
    fontWeight: '700',
    marginTop: 2,
  },
  profileMapCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    minHeight: 450,
    marginTop: 12,
  },
});
