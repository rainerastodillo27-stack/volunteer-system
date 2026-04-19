import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator, Platform, ScrollView, Modal } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  createUserAccount,
  getAllUsers,
  getApiBaseUrl,
  getUserByEmailOrPhone,
  isValidDswdAccreditationNo,
  loginWithCredentials,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import AppLogo from '../components/AppLogo';
import InlineLoadError from '../components/InlineLoadError';
import { AdvocacyFocus, NVCSector, PartnerSectorType, User, UserRole, UserType } from '../models/types';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import {
  composePhilippineAddress,
  getBarangaysByCity,
  getCitiesByRegion,
  PHBarangay,
  PHCityMunicipality,
  PHRegions,
} from '../utils/philippineAddressData';

const BACKEND_HEALTH_TIMEOUT_MS = 5000;

type SignupVolunteerSheetState = {
  gender: string;
  dateOfBirth: string;
  civilStatus: string;
  homeAddress: string;
  homeAddressRegion: string;
  homeAddressCityMunicipality: string;
  homeAddressBarangay: string;
  occupation: string;
  workplaceOrSchool: string;
  collegeCourse: string;
  certificationsOrTrainings: string;
  videoBriefingUrl: string;
  hobbiesAndInterests: string;
  specialSkills: string;
  affiliationOrg1: string;
  affiliationPos1: string;
  affiliationOrg2: string;
  affiliationPos2: string;
};

type SignupPartnerApplicationState = {
  organizationName: string;
  sectorType: PartnerSectorType;
  dswdAccreditationNo: string;
  secRegistrationNo: string;
  advocacyFocus: AdvocacyFocus[];
};

type MobileEntryRole = Exclude<UserRole, 'admin'>;
type SignupStep = 'role' | 'details';
type DemoLoginAccount = {
  id: string;
  name: string;
  identifier: string;
  password: string;
  badge: string;
  mobileRole?: MobileEntryRole;
};

const ADMIN_DEMO_ACCOUNT: DemoLoginAccount = {
  id: 'demo-admin',
  name: 'Admin Account',
  identifier: 'admin@nvc.org',
  password: 'admin123',
  badge: 'ADMIN',
};

const VOLUNTEER_DEMO_ACCOUNT: DemoLoginAccount = {
  id: 'demo-volunteer',
  name: 'Volunteer Account',
  identifier: 'volunteer@example.com',
  password: 'volunteer123',
  badge: 'VOLUNTEER',
  mobileRole: 'volunteer',
};

const PARTNER_DEMO_ACCOUNTS: DemoLoginAccount[] = [
  {
    id: 'demo-partner-pbsp',
    name: 'PBSP',
    identifier: 'partnerships@pbsp.org.ph',
    password: 'partner123',
    badge: 'PARTNER',
    mobileRole: 'partner',
  },
  {
    id: 'demo-partner-jollibee',
    name: 'Jollibee Foundation',
    identifier: 'partnerships@jollibeefoundation.org',
    password: 'partner123',
    badge: 'PARTNER',
    mobileRole: 'partner',
  },
  {
    id: 'demo-partner-kabankalan',
    name: 'Kabankalan LGU',
    identifier: 'partner@livelihoods.org',
    password: 'partner123',
    badge: 'PARTNER',
    mobileRole: 'partner',
  },
];

function getVisibleDemoAccounts(
  isWeb: boolean,
  selectedMobileRole: MobileEntryRole | null
): DemoLoginAccount[] {
  if (isWeb) {
    return [ADMIN_DEMO_ACCOUNT];
  }

  if (selectedMobileRole === 'volunteer') {
    return [VOLUNTEER_DEMO_ACCOUNT];
  }

  if (selectedMobileRole === 'partner') {
    return PARTNER_DEMO_ACCOUNTS;
  }

  return [VOLUNTEER_DEMO_ACCOUNT, ...PARTNER_DEMO_ACCOUNTS];
}

// Returns a clean volunteer membership form state for the signup modal.
function createEmptySignupVolunteerSheet(): SignupVolunteerSheetState {
  return {
    gender: '',
    dateOfBirth: '',
    civilStatus: '',
    homeAddress: '',
    homeAddressRegion: '',
    homeAddressCityMunicipality: '',
    homeAddressBarangay: '',
    occupation: '',
    workplaceOrSchool: '',
    collegeCourse: '',
    certificationsOrTrainings: '',
    videoBriefingUrl: '',
    hobbiesAndInterests: '',
    specialSkills: '',
    affiliationOrg1: '',
    affiliationPos1: '',
    affiliationOrg2: '',
    affiliationPos2: '',
  };
}

// Returns the default state for partner registration applications.
function createEmptySignupPartnerApplication(): SignupPartnerApplicationState {
  return {
    organizationName: '',
    sectorType: 'NGO',
    dswdAccreditationNo: '',
    secRegistrationNo: '',
    advocacyFocus: [],
  };
}

// Chooses the most specific credential error message for failed login attempts.
function getIncorrectLoginMessage(
  matchedUser: User | null,
  allUsers: User[],
  attemptedPassword: string
): string {
  if (matchedUser) {
    return 'Wrong password.';
  }

  const passwordExists = allUsers.some(user => user.password === attemptedPassword);
  return passwordExists ? 'Wrong user.' : 'Wrong user and password.';
}

function getMobileRoleLabel(role: MobileEntryRole): string {
  return role === 'partner' ? 'Partner Organization' : 'Volunteer';
}

function getMobileRoleLoginTitle(role: MobileEntryRole): string {
  return role === 'partner' ? 'Partner Organization Sign In' : 'Volunteer Sign In';
}

function getMobileRoleLoginHint(role: MobileEntryRole): string {
  return role === 'partner'
    ? 'Use your approved organization account to open the partner portal.'
    : 'Use your approved volunteer account to open the volunteer portal.';
}

function getMobileRoleMismatchMessage(selectedRole: MobileEntryRole, actualRole: UserRole): string {
  if (actualRole === 'admin') {
    return 'This account is registered as an admin account. Please use the web portal for admin access.';
  }

  return selectedRole === 'partner'
    ? 'This account is registered as a volunteer. Go back and choose Volunteer before signing in.'
    : 'This account is registered as a partner organization. Go back and choose Partner Organization before signing in.';
}

// Handles account login and volunteer or partner self-registration.
export default function LoginScreen() {
  const isWeb = Platform.OS === 'web';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loginError, setLoginError] = useState<{ title: string; message: string } | null>(null);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [signupStep, setSignupStep] = useState<SignupStep>('role');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupAccountPhone, setSignupAccountPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupUserType, setSignupUserType] = useState<UserType>('Student');
  const [signupPillars, setSignupPillars] = useState<NVCSector[]>([]);
  const [signupRole, setSignupRole] = useState<Exclude<UserRole, 'admin'>>('volunteer');
  const [signupPartnerApplication, setSignupPartnerApplication] =
    useState<SignupPartnerApplicationState>(createEmptySignupPartnerApplication());
  const [signupVolunteerSheet, setSignupVolunteerSheet] = useState<SignupVolunteerSheetState>(
    createEmptySignupVolunteerSheet()
  );
  const [signupAcceptedCommitment, setSignupAcceptedCommitment] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [backendMessage, setBackendMessage] = useState('Checking backend connection...');
  const [savedAccounts, setSavedAccounts] = useState<User[]>([]);
  const [selectedMobileRole, setSelectedMobileRole] = useState<MobileEntryRole | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedRegionCode, setSelectedRegionCode] = useState('');
  const [selectedCityCode, setSelectedCityCode] = useState('');
  const [filteredCities, setFilteredCities] = useState<PHCityMunicipality[]>([]);
  const [filteredBarangays, setFilteredBarangays] = useState<PHBarangay[]>([]);
  const { login } = useAuth();
  const mountedRef = useRef(true);
  const visibleDemoAccounts = getVisibleDemoAccounts(isWeb, selectedMobileRole);

  useEffect(() => {
    setInitialized(true);
    setLoading(false);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const composedHomeAddress = composePhilippineAddress(
      signupVolunteerSheet.homeAddressRegion,
      signupVolunteerSheet.homeAddressCityMunicipality,
      signupVolunteerSheet.homeAddressBarangay
    );

    setSignupVolunteerSheet(current =>
      current.homeAddress === composedHomeAddress
        ? current
        : { ...current, homeAddress: composedHomeAddress }
    );
  }, [
    signupVolunteerSheet.homeAddressBarangay,
    signupVolunteerSheet.homeAddressCityMunicipality,
    signupVolunteerSheet.homeAddressRegion,
  ]);

  useEffect(() => {
    let cancelled = false;

    // Checks whether the backend is reachable before allowing authentication flows.
    const checkBackend = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BACKEND_HEALTH_TIMEOUT_MS);

      try {
        setBackendStatus(current => (current === 'online' ? current : 'checking'));
        setBackendMessage('Checking backend and Supabase connection...');
        const response = await fetch(`${getApiBaseUrl()}/health`, {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as
          | { status?: string; mode?: string; detail?: string }
          | null;

        if (!response.ok || payload?.status !== 'ok' || payload?.mode !== 'postgres') {
          throw new Error(
            payload?.detail ||
            `Database backend is unavailable at ${getApiBaseUrl()}.`
          );
        }

        if (!cancelled && mountedRef.current) {
          setBackendStatus('online');
          setBackendMessage(`Backend connected to Postgres: ${getApiBaseUrl()}`);
        }
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          const defaultMessage = `Database backend unavailable at ${getApiBaseUrl()}. Check the backend process and Supabase connection, then run npm run all:bg or npm run all.`;
          const fallbackMessage = getRequestErrorMessage(error, defaultMessage, {
            backendUrl: getApiBaseUrl(),
          });

          setBackendStatus('offline');
          setBackendMessage(fallbackMessage);
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    void checkBackend();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (backendStatus !== 'online') {
      setSavedAccounts([]);
      return undefined;
    }

    // Loads stored accounts so users can quickly reuse credentials from this device.
    const loadSavedAccounts = async () => {
      try {
        const users = await getAllUsers();
        const visibleUsers = users
          .filter(user => (isWeb ? user.role === 'admin' : user.role !== 'admin'))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (mountedRef.current) {
          setSavedAccounts(visibleUsers);
        }
      } catch (error) {
        if (mountedRef.current) {
          setSavedAccounts([]);
        }
      }
    };

    void loadSavedAccounts();
    const unsubscribe = subscribeToStorageChanges(['users'], () => {
      void loadSavedAccounts();
    });

    return unsubscribe;
  }, [backendStatus, isWeb]);

  // Authenticates the user with an email or phone identifier and password.
  const performLogin = async (
    rawIdentifier: string,
    rawPassword: string,
    roleOverride?: MobileEntryRole | null
  ) => {
    const trimmedIdentifier = rawIdentifier.trim();
    const trimmedPassword = rawPassword.trim();
    const activeMobileRole = roleOverride ?? selectedMobileRole;
    const showLoginError = (title: string, message: string) => {
      if (isWeb) {
        setLoginError({ title, message });
        return;
      }

      Alert.alert(title, message);
    };

    setLoginError(null);

    if (!isWeb && !activeMobileRole) {
      Alert.alert(
        'Select Account Type',
        'Choose whether you are signing in as a volunteer or partner organization first.'
      );
      return;
    }

    if (!trimmedIdentifier || !trimmedPassword) {
      Alert.alert('Validation Error', 'Please enter email or phone and password');
      return;
    }

    try {
      setLoading(true);
      if (backendStatus !== 'online') {
        setBackendStatus('checking');
        setBackendMessage('Trying to reach the database on a slow connection...');
      }
      const user = await loginWithCredentials(trimmedIdentifier, trimmedPassword);

      if (!user) {
        const [matchedUser, allUsers] = await Promise.all([
          getUserByEmailOrPhone(trimmedIdentifier),
          getAllUsers(),
        ]);

        showLoginError(
          'Authentication Failed',
          getIncorrectLoginMessage(matchedUser, allUsers, trimmedPassword)
        );
        setLoading(false);
        return;
      }

      if (!isWeb && activeMobileRole && user.role !== activeMobileRole) {
        showLoginError('Role Mismatch', getMobileRoleMismatchMessage(activeMobileRole, user.role));
        setLoading(false);
        return;
      }

      if (isWeb && user.role !== 'admin') {
        showLoginError(
          'Access Restricted',
          'Volunteer and partner accounts can only log in on mobile.'
        );
        setLoading(false);
        return;
      }

      // Update auth context - this triggers state change and navigation
      await login(user);
      setBackendStatus('online');
      setBackendMessage(`Backend connected to Postgres: ${getApiBaseUrl()}`);
      setLoginError(null);
      setIdentifier('');
      setPassword('');
    } catch (error) {
      console.error('Login error:', error);
      const message = getRequestErrorMessage(
        error,
        'An error occurred during login. Please try again.',
        { backendUrl: getApiBaseUrl() }
      );
      const title =
        getRequestErrorTitle(error, '') === 'Database Unavailable'
          ? 'Database Unavailable'
          : message.includes('rejected')
          ? 'Application Rejected'
          : message.includes('pending admin approval') ||
            message.includes('organization application') ||
            message.includes('partner account') ||
            message.includes('volunteer account')
          ? 'Application Pending'
          : 'Login Error';
      showLoginError(title, message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleLogin = async () => {
    await performLogin(identifier, password);
  };

  const handleQuickLogin = async (account: DemoLoginAccount) => {
    setIdentifier(account.identifier);
    setPassword(account.password);
    if (!isWeb && account.mobileRole) {
      setSelectedMobileRole(account.mobileRole);
    }
    await performLogin(account.identifier, account.password, account.mobileRole ?? null);
  };

  // Clears all signup fields after registration or when the modal is closed.
  const resetSignupForm = () => {
    setSignupName('');
    setSignupEmail('');
    setSignupAccountPhone('');
    setSignupPassword('');
    setSignupUserType('Student');
    setSignupPillars([]);
    setSignupRole('volunteer');
    setSignupPartnerApplication(createEmptySignupPartnerApplication());
    setSignupVolunteerSheet(createEmptySignupVolunteerSheet());
    setSelectedRegionCode('');
    setSelectedCityCode('');
    setFilteredCities([]);
    setFilteredBarangays([]);
    setSignupAcceptedCommitment(false);
    setSignupStep('role');
  };

  const openSignupModal = () => {
    resetSignupForm();
    if (!isWeb && selectedMobileRole) {
      setSignupRole(selectedMobileRole);
      setSignupUserType(selectedMobileRole === 'partner' ? 'Adult' : 'Student');
      setSignupStep('details');
    }
    setShowSignupModal(true);
  };

  const closeSignupModal = () => {
    setShowSignupModal(false);
    resetSignupForm();
  };

  const handleSelectSignupRole = (role: MobileEntryRole) => {
    setSignupRole(role);
    if (role === 'partner') {
      setSignupUserType('Adult');
    }
    setSignupStep('details');
  };

  const handleSelectMobileRole = (
    role: MobileEntryRole,
    options?: { preserveCredentials?: boolean }
  ) => {
    setSelectedMobileRole(role);
    setLoginError(null);
    if (!options?.preserveCredentials) {
      setIdentifier('');
      setPassword('');
    }
  };

  const handleBackToRoleSelection = () => {
    setSelectedMobileRole(null);
    setIdentifier('');
    setPassword('');
    setLoginError(null);
  };

  // Updates one field in the volunteer membership form without replacing the whole object.
  const updateSignupVolunteerSheet = <K extends keyof SignupVolunteerSheetState>(
    key: K,
    value: SignupVolunteerSheetState[K]
  ) => {
    setSignupVolunteerSheet(current => ({ ...current, [key]: value }));
  };

  // Updates one field in the partner application form.
  const updateSignupPartnerApplication = <K extends keyof SignupPartnerApplicationState>(
    key: K,
    value: SignupPartnerApplicationState[K]
  ) => {
    setSignupPartnerApplication(current => ({ ...current, [key]: value }));
  };

  // Validates and creates a new volunteer or partner account.
  const handleSignup = async () => {
    if (!signupName.trim() || !signupPassword.trim()) {
      Alert.alert('Validation Error', 'Name and password are required.');
      return;
    }

    if (!signupEmail.trim() && !signupAccountPhone.trim()) {
      Alert.alert('Validation Error', 'Please provide an email or phone number.');
      return;
    }

    if (signupEmail.trim() && !signupEmail.includes('@')) {
      Alert.alert('Validation Error', 'Please enter a valid email address.');
      return;
    }

    if (signupRole === 'volunteer' && signupPillars.length === 0) {
      Alert.alert('Validation Error', 'Select at least one pillar of interest.');
      return;
    }

    if (signupRole === 'partner') {
      if (!signupPartnerApplication.organizationName.trim()) {
        Alert.alert('Validation Error', 'Organization name is required.');
        return;
      }

      if (!isValidDswdAccreditationNo(signupPartnerApplication.dswdAccreditationNo)) {
        Alert.alert('Validation Error', 'Enter a valid DSWD accreditation number.');
        return;
      }

      if (signupPartnerApplication.advocacyFocus.length === 0) {
        Alert.alert('Validation Error', 'Select at least one advocacy focus.');
        return;
      }
    }

    if (signupRole === 'volunteer') {
      if (
        !signupVolunteerSheet.gender.trim() ||
        !signupVolunteerSheet.dateOfBirth.trim() ||
        !signupVolunteerSheet.civilStatus.trim() ||
        !signupVolunteerSheet.homeAddressRegion.trim() ||
        !signupVolunteerSheet.homeAddressCityMunicipality.trim() ||
        !signupVolunteerSheet.homeAddressBarangay.trim() ||
        !signupVolunteerSheet.homeAddress.trim() ||
        !signupVolunteerSheet.occupation.trim() ||
        !signupVolunteerSheet.workplaceOrSchool.trim()
      ) {
        Alert.alert(
          'Validation Error',
          'Complete the volunteer membership information sheet before creating the account.'
        );
        return;
      }

      if (!signupAcceptedCommitment) {
        Alert.alert(
          'Validation Error',
          'You must accept the NVC volunteer commitment before creating the account.'
        );
        return;
      }
    }

    try {
      setSignupLoading(true);
      const createdUser = await createUserAccount({
        name: signupName,
        email: signupEmail,
        password: signupPassword,
        phone: signupAccountPhone,
        role: signupRole,
        userType: signupUserType,
        pillarsOfInterest:
          signupRole === 'partner'
            ? signupPartnerApplication.advocacyFocus.filter(
                (focus): focus is NVCSector => focus !== 'Disaster'
              )
            : signupPillars,
        partnerRegistration:
          signupRole === 'partner'
            ? {
                organizationName: signupPartnerApplication.organizationName.trim(),
                sectorType: signupPartnerApplication.sectorType,
                dswdAccreditationNo: signupPartnerApplication.dswdAccreditationNo.trim(),
                secRegistrationNo: signupPartnerApplication.secRegistrationNo.trim(),
                advocacyFocus: signupPartnerApplication.advocacyFocus,
              }
            : undefined,
        volunteerMembershipSheet:
          signupRole === 'volunteer'
            ? {
                gender: signupVolunteerSheet.gender.trim(),
                dateOfBirth: signupVolunteerSheet.dateOfBirth.trim(),
                civilStatus: signupVolunteerSheet.civilStatus.trim(),
                homeAddress: signupVolunteerSheet.homeAddress.trim(),
                homeAddressRegion: signupVolunteerSheet.homeAddressRegion.trim(),
                homeAddressCityMunicipality: signupVolunteerSheet.homeAddressCityMunicipality.trim(),
                homeAddressBarangay: signupVolunteerSheet.homeAddressBarangay.trim(),
                occupation: signupVolunteerSheet.occupation.trim(),
                workplaceOrSchool: signupVolunteerSheet.workplaceOrSchool.trim(),
                collegeCourse: signupVolunteerSheet.collegeCourse.trim(),
                certificationsOrTrainings:
                  signupVolunteerSheet.certificationsOrTrainings.trim(),
                hobbiesAndInterests: signupVolunteerSheet.hobbiesAndInterests.trim(),
                specialSkills: signupVolunteerSheet.specialSkills.trim(),
                videoBriefingUrl: signupVolunteerSheet.videoBriefingUrl.trim(),
                affiliations: [
                  {
                    organization: signupVolunteerSheet.affiliationOrg1.trim(),
                    position: signupVolunteerSheet.affiliationPos1.trim(),
                  },
                  {
                    organization: signupVolunteerSheet.affiliationOrg2.trim(),
                    position: signupVolunteerSheet.affiliationPos2.trim(),
                  },
                ].filter(affiliation => affiliation.organization || affiliation.position),
              }
            : undefined,
      });

      setIdentifier(createdUser.email || createdUser.phone || '');
      setPassword(createdUser.password);
      if (!isWeb) {
        handleSelectMobileRole(signupRole, { preserveCredentials: true });
      }
      setShowSignupModal(false);
      resetSignupForm();
      Alert.alert(
        signupRole === 'partner' ? 'Application Submitted' : 'Application Submitted',
        signupRole === 'partner'
          ? 'Your partner application was submitted. An admin must verify and approve it before partner login is unlocked.'
          : 'Your volunteer account was submitted. An admin must approve it before volunteer login is unlocked.'
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, 'Sign Up Error'),
        getRequestErrorMessage(error, 'Failed to create account.', {
          backendUrl: getApiBaseUrl(),
        })
      );
    } finally {
      setSignupLoading(false);
    }
  };

  // Signs in immediately with a saved account shown on this device.
  const handleUseSavedAccount = async (account: User) => {
    const nextIdentifier = account.email || account.phone || '';
    if (!nextIdentifier) {
      Alert.alert('Login Unavailable', 'This saved account does not have an email or phone number.');
      return;
    }

    setLoginError(null);
    setIdentifier(nextIdentifier);
    setPassword(account.password);
    if (!isWeb && account.role !== 'admin') {
      setSelectedMobileRole(account.role);
    }
    await performLogin(
      nextIdentifier,
      account.password,
      account.role === 'admin' ? null : account.role
    );
  };

  const visibleSavedAccounts =
    isWeb || !selectedMobileRole
      ? savedAccounts
      : savedAccounts.filter(account => account.role === selectedMobileRole);
  const selectedMobileRoleLabel = selectedMobileRole
    ? getMobileRoleLabel(selectedMobileRole)
    : '';
  const selectedMobileRoleTitle = selectedMobileRole
    ? getMobileRoleLoginTitle(selectedMobileRole)
    : '';
  const selectedMobileRoleHint = selectedMobileRole
    ? getMobileRoleLoginHint(selectedMobileRole)
    : '';
  const quickLoginTitle = isWeb
    ? 'Quick Admin Sign In'
    : selectedMobileRole
    ? `${selectedMobileRoleLabel} Quick Sign In`
    : 'Quick Demo Sign In';

  const renderQuickLoginSection = () => (
    <View style={styles.demoSection}>
      <Text style={styles.demoTitle}>{quickLoginTitle}</Text>
      {visibleDemoAccounts.map(account => (
        <TouchableOpacity
          key={account.id}
          style={[styles.savedAccountCard, loading && styles.accountCardDisabled]}
          onPress={() => {
            void handleQuickLogin(account);
          }}
          activeOpacity={0.85}
          disabled={loading}
        >
          <View style={styles.savedAccountHeader}>
            <Text style={styles.savedAccountName}>{account.name}</Text>
            <Text style={styles.savedAccountRole}>{account.badge}</Text>
          </View>
          <Text style={styles.savedAccountCredential}>{account.identifier}</Text>
          <Text style={styles.savedAccountPassword}>{account.password}</Text>
          <Text style={styles.savedAccountHint}>Tap to sign in instantly</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (loading && !initialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Initializing app...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.contentContainer, isWeb && styles.webContainer]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.contentShell, isWeb && styles.webContentShell, !isWeb && styles.mobileContentShell]}>
        <View style={styles.brandSection}>
          <AppLogo width={isWeb ? 126 : 138} />
          <Text style={styles.title}>NVC CONNECT</Text>
          <Text style={styles.subtitle}>
            {isWeb ? 'Admin web portal' : 'Volunteer coordination platform'}
          </Text>
        </View>

        {isWeb ? (
          <View style={styles.webAccessNotice}>
            <Text style={styles.webAccessNoticeTitle}>Web access is for admin only</Text>
            <Text style={styles.webAccessNoticeText}>
              Volunteer and partner accounts can sign in through the mobile app.
            </Text>
          </View>
        ) : null}

        <View
          style={[
            styles.backendStatusCard,
            backendStatus === 'online'
              ? styles.backendStatusOnline
              : backendStatus === 'offline'
              ? styles.backendStatusOffline
              : styles.backendStatusChecking,
          ]}
        >
          <View style={styles.backendStatusRow}>
            <View
              style={[
                styles.backendStatusDot,
                backendStatus === 'online'
                  ? styles.backendStatusDotOnline
                  : backendStatus === 'offline'
                  ? styles.backendStatusDotOffline
                  : styles.backendStatusDotChecking,
              ]}
            />
            <Text style={styles.backendStatusTitle}>
              {backendStatus === 'online'
                ? 'Database Connected'
                : backendStatus === 'offline'
                ? 'Database Unavailable'
                : 'Checking Database'}
            </Text>
          </View>
          <Text style={styles.backendStatusText}>{backendMessage}</Text>
        </View>

        {!isWeb && !selectedMobileRole ? (
          <>
            <View style={styles.selectionDashboard}>
              <Text style={styles.selectionTitle}>Choose Your Mobile Portal</Text>
              <Text style={styles.selectionSubtitle}>
                Select whether you are signing in as a volunteer or a partner organization
                before continuing.
              </Text>

              <TouchableOpacity
                style={styles.selectionCard}
                onPress={() => handleSelectMobileRole('volunteer')}
                activeOpacity={0.9}
              >
                <View style={styles.selectionIconWrap}>
                  <MaterialIcons name="volunteer-activism" size={28} color="#166534" />
                </View>
                <View style={styles.selectionCopy}>
                  <Text style={styles.selectionCardTitle}>Volunteer</Text>
                  <Text style={styles.selectionCardDescription}>
                    Join projects, track your hours, and manage your volunteer activities.
                  </Text>
                  <Text style={styles.selectionCardAction}>Continue as Volunteer</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.selectionCard, styles.selectionCardPartner]}
                onPress={() => handleSelectMobileRole('partner')}
                activeOpacity={0.9}
              >
                <View style={[styles.selectionIconWrap, styles.selectionIconWrapPartner]}>
                  <MaterialIcons name="business" size={28} color="#92400e" />
                </View>
                <View style={styles.selectionCopy}>
                  <Text style={styles.selectionCardTitle}>Partner Organization</Text>
                  <Text style={styles.selectionCardDescription}>
                    Coordinate organization projects, submit reports, and collaborate with NVC.
                  </Text>
                  <Text style={[styles.selectionCardAction, styles.selectionCardActionPartner]}>
                    Continue as Partner Organization
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {renderQuickLoginSection()}

            <TouchableOpacity onPress={openSignupModal}>
              <Text style={styles.signupText}>Sign up as Volunteer or Partner</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {!isWeb && selectedMobileRole ? (
              <View style={styles.mobileRoleBanner}>
                <TouchableOpacity
                  style={styles.backToRoleButton}
                  onPress={handleBackToRoleSelection}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="arrow-back" size={18} color="#166534" />
                  <Text style={styles.backToRoleText}>Change account type</Text>
                </TouchableOpacity>
                <View style={styles.mobileRoleBannerHeader}>
                  <MaterialIcons
                    name={selectedMobileRole === 'partner' ? 'business' : 'volunteer-activism'}
                    size={22}
                    color={selectedMobileRole === 'partner' ? '#92400e' : '#166534'}
                  />
                  <Text style={styles.mobileRoleBannerTitle}>{selectedMobileRoleTitle}</Text>
                </View>
                <Text style={styles.mobileRoleBannerText}>{selectedMobileRoleHint}</Text>
              </View>
            ) : null}

            <TextInput
              style={styles.input}
              placeholder="Email or Phone"
              placeholderTextColor="#999"
              value={identifier}
              onChangeText={value => {
                setIdentifier(value);
                if (loginError) {
                  setLoginError(null);
                }
              }}
              editable={!loading}
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={value => {
                setPassword(value);
                if (loginError) {
                  setLoginError(null);
                }
              }}
              secureTextEntry
              editable={!loading}
            />

            {isWeb && loginError ? (
              <InlineLoadError title={loginError.title} message={loginError.message} />
            ) : null}

            <TouchableOpacity
              style={[styles.button, loading ? styles.buttonDisabled : null]}
              onPress={() => {
                void handleLogin();
              }}
              disabled={loading || !identifier || !password}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Log In</Text>
              )}
            </TouchableOpacity>

            {renderQuickLoginSection()}

            {visibleSavedAccounts.length > 0 && (
              <View style={styles.demoSection}>
                <Text style={styles.demoTitle}>
                  {isWeb
                    ? 'Saved Admin Accounts:'
                    : `Saved ${selectedMobileRoleLabel} Accounts:`}
                </Text>
                {visibleSavedAccounts.map(account => (
                  <TouchableOpacity
                    key={account.id}
                    style={[styles.savedAccountCard, loading && styles.accountCardDisabled]}
                    onPress={() => {
                      void handleUseSavedAccount(account);
                    }}
                    activeOpacity={0.85}
                    disabled={loading}
                  >
                    <View style={styles.savedAccountHeader}>
                      <Text style={styles.savedAccountName}>{account.name}</Text>
                      <Text style={styles.savedAccountRole}>{account.role}</Text>
                    </View>
                    <Text style={styles.savedAccountCredential}>
                      {account.email || account.phone || 'No login identifier'}
                    </Text>
                    <Text style={styles.savedAccountPassword}>{account.password}</Text>
                    <Text style={styles.savedAccountHint}>Tap to sign in instantly</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {!isWeb ? (
              <TouchableOpacity onPress={openSignupModal}>
                <Text style={styles.signupText}>
                  {!selectedMobileRole
                    ? 'Sign up as Volunteer or Partner'
                    : `Sign up as ${selectedMobileRoleLabel}`}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </View>

      <Modal
        visible={showSignupModal}
        animationType="slide"
        transparent
        onRequestClose={closeSignupModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {signupStep === 'role'
                ? 'Choose Account Type'
                : signupRole === 'partner'
                ? 'Partner Registration'
                : 'Volunteer Registration'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {signupStep === 'role'
                ? 'Choose how you want to sign up. Access after registration will follow the selected role.'
                : signupRole === 'volunteer'
                ? 'Register with email or phone, choose a profile type, and complete the volunteer membership information sheet.'
                : 'Submit your organization application with DSWD details. Partner login is unlocked after admin approval.'}
            </Text>

            {signupStep === 'role' ? (
              <View style={styles.signupRoleChoiceGrid}>
                {([
                  {
                    role: 'volunteer' as const,
                    icon: 'volunteer-activism' as const,
                    title: 'Volunteer',
                    description: 'Join projects, log hours, and access volunteer-only screens after approval.',
                  },
                  {
                    role: 'partner' as const,
                    icon: 'business' as const,
                    title: 'Partner Organization',
                    description: 'Submit an organization application and access partner tools after approval.',
                  },
                ]).map(option => (
                  <TouchableOpacity
                    key={option.role}
                    style={styles.signupRoleCard}
                    onPress={() => handleSelectSignupRole(option.role)}
                  >
                    <View style={styles.signupRoleCardHeader}>
                      <MaterialIcons name={option.icon} size={22} color="#166534" />
                      <Text style={styles.signupRoleCardTitle}>{option.title}</Text>
                    </View>
                    <Text style={styles.signupRoleCardDescription}>{option.description}</Text>
                    <Text style={styles.signupRoleCardAction}>
                      {option.role === 'volunteer' ? 'Continue as Volunteer' : 'Continue as Partner'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <ScrollView
                style={styles.modalForm}
                contentContainerStyle={styles.modalFormContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <TextInput
                  style={styles.input}
                  placeholder={signupRole === 'partner' ? 'Primary Contact Name' : 'Full Name'}
                  placeholderTextColor="#999"
                  value={signupName}
                  onChangeText={setSignupName}
                  editable={!signupLoading}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email Address"
                  placeholderTextColor="#999"
                  value={signupEmail}
                  onChangeText={setSignupEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!signupLoading}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone Number"
                  placeholderTextColor="#999"
                  value={signupAccountPhone}
                  onChangeText={setSignupAccountPhone}
                  keyboardType="phone-pad"
                  editable={!signupLoading}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#999"
                  value={signupPassword}
                  onChangeText={setSignupPassword}
                  secureTextEntry
                  editable={!signupLoading}
                />

                {signupRole === 'volunteer' ? (
                  <>
                    <Text style={styles.modalSectionLabel}>Profile Creation</Text>
                    <View style={styles.roleSelector}>
                      {(['Student', 'Adult', 'Senior'] as const).map(userType => (
                        <TouchableOpacity
                          key={userType}
                          style={[styles.roleChip, signupUserType === userType && styles.roleChipActive]}
                          onPress={() => setSignupUserType(userType)}
                          disabled={signupLoading}
                        >
                          <Text style={[styles.roleChipText, signupUserType === userType && styles.roleChipTextActive]}>
                            {userType}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={styles.modalSectionLabel}>Preferences</Text>
                    <View style={styles.pillarGrid}>
                      {(['Nutrition', 'Education', 'Livelihood'] as const).map(pillar => {
                        const selected = signupPillars.includes(pillar);
                        return (
                          <TouchableOpacity
                            key={pillar}
                            style={[styles.pillarChip, selected && styles.pillarChipActive]}
                            onPress={() =>
                              setSignupPillars(current =>
                                current.includes(pillar)
                                  ? current.filter(item => item !== pillar)
                                  : [...current, pillar]
                              )
                            }
                            disabled={signupLoading}
                          >
                            <Text style={[styles.pillarChipText, selected && styles.pillarChipTextActive]}>
                              {pillar}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.modalSectionLabel}>Organization Application</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Organization Name"
                      placeholderTextColor="#999"
                      value={signupPartnerApplication.organizationName}
                      onChangeText={value => updateSignupPartnerApplication('organizationName', value)}
                      editable={!signupLoading}
                    />

                    <Text style={styles.modalSectionSubLabel}>Sector Type</Text>
                    <View style={styles.pillarGrid}>
                      {(['NGO', 'Hospital', 'Institution', 'Private'] as const).map(sector => {
                        const selected = signupPartnerApplication.sectorType === sector;
                        return (
                          <TouchableOpacity
                            key={sector}
                            style={[styles.pillarChip, selected && styles.pillarChipActive]}
                            onPress={() => updateSignupPartnerApplication('sectorType', sector)}
                            disabled={signupLoading}
                          >
                            <Text style={[styles.pillarChipText, selected && styles.pillarChipTextActive]}>
                              {sector}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <TextInput
                      style={styles.input}
                      placeholder="DSWD Registration No. e.g. DSWD-SB-SP-00001-2026"
                      placeholderTextColor="#999"
                      value={signupPartnerApplication.dswdAccreditationNo}
                      onChangeText={value => updateSignupPartnerApplication('dswdAccreditationNo', value)}
                      autoCapitalize="characters"
                      editable={!signupLoading}
                    />

                    <TextInput
                      style={styles.input}
                      placeholder="SEC Registration No. e.g. CN201234567"
                      placeholderTextColor="#999"
                      value={signupPartnerApplication.secRegistrationNo}
                      onChangeText={value => updateSignupPartnerApplication('secRegistrationNo', value)}
                      autoCapitalize="characters"
                      editable={!signupLoading}
                    />

                    <Text style={styles.modalSectionSubLabel}>Advocacy Focus</Text>
                    <View style={styles.pillarGrid}>
                      {(['Nutrition', 'Education', 'Livelihood', 'Disaster'] as const).map(focus => {
                        const selected = signupPartnerApplication.advocacyFocus.includes(focus);
                        return (
                          <TouchableOpacity
                            key={focus}
                            style={[styles.pillarChip, selected && styles.pillarChipActive]}
                            onPress={() =>
                              updateSignupPartnerApplication(
                                'advocacyFocus',
                                selected
                                  ? signupPartnerApplication.advocacyFocus.filter(item => item !== focus)
                                  : [...signupPartnerApplication.advocacyFocus, focus]
                              )
                            }
                            disabled={signupLoading}
                          >
                            <Text style={[styles.pillarChipText, selected && styles.pillarChipTextActive]}>
                              {focus}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <View style={styles.partnerLockNotice}>
                      <MaterialIcons name="verified-user" size={18} color="#92400e" />
                      <Text style={styles.partnerLockNoticeText}>
                        Admin will review your DSWD accreditation number, verify the application, and unlock partner login after approval.
                      </Text>
                    </View>
                  </>
                )}

                {signupRole === 'volunteer' && (
                  <>
                    <Text style={styles.modalSectionLabel}>NVC Membership Information Sheet</Text>
                    
                    <Text style={styles.modalSectionSubLabel}>Gender</Text>
                    <View style={styles.genderGrid}>
                      {['Male', 'Female', 'Other'].map(gender => (
                        <TouchableOpacity
                          key={gender}
                          style={[styles.genderChip, signupVolunteerSheet.gender === gender && styles.genderChipActive]}
                          onPress={() => updateSignupVolunteerSheet('gender', gender)}
                          disabled={signupLoading}
                        >
                          <Text style={[styles.genderChipText, signupVolunteerSheet.gender === gender && styles.genderChipTextActive]}>
                            {gender}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                  <Text style={styles.modalSectionSubLabel}>Date of Birth</Text>
                  <TouchableOpacity
                    style={[styles.button, styles.datePickerButton]}
                    onPress={() => setShowDatePicker(true)}
                    disabled={signupLoading}
                  >
                    <MaterialIcons name="calendar-today" size={20} color="#fff" />
                    <Text style={styles.datePickerButtonText}>
                      {signupVolunteerSheet.dateOfBirth
                        ? new Date(signupVolunteerSheet.dateOfBirth).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })
                        : 'Select Date of Birth'}
                    </Text>
                  </TouchableOpacity>

                  <Text style={styles.modalSectionSubLabel}>Civil Status</Text>
                  <View style={styles.statusGrid}>
                    {['Single', 'Married', 'Widowed', 'Separated', 'Domestic Partnership'].map(status => (
                      <TouchableOpacity
                        key={status}
                        style={[styles.statusChip, signupVolunteerSheet.civilStatus === status && styles.statusChipActive]}
                        onPress={() => updateSignupVolunteerSheet('civilStatus', status)}
                        disabled={signupLoading}
                      >
                        <Text style={[styles.statusChipText, signupVolunteerSheet.civilStatus === status && styles.statusChipTextActive]}>
                          {status}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.modalSectionLabel}>Home Address (Philippines)</Text>

                  <Text style={styles.modalSectionSubLabel}>Region</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={selectedRegionCode}
                      onValueChange={(itemValue: string) => {
                        const selectedRegion = PHRegions.find(region => region.code === itemValue);
                        updateSignupVolunteerSheet('homeAddressRegion', selectedRegion?.name || '');
                        updateSignupVolunteerSheet('homeAddressCityMunicipality', '');
                        updateSignupVolunteerSheet('homeAddressBarangay', '');
                        setSelectedRegionCode(itemValue);
                        setSelectedCityCode('');
                        setFilteredCities(getCitiesByRegion(itemValue));
                        setFilteredBarangays([]);
                      }}
                      enabled={!signupLoading}
                      style={styles.picker}
                    >
                      <Picker.Item label="Select Region..." value="" />
                      {PHRegions.map(region => (
                        <Picker.Item key={region.code} label={region.name} value={region.code} />
                      ))}
                    </Picker>
                  </View>

                  <Text style={styles.modalSectionSubLabel}>City / Municipality</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={selectedCityCode}
                      onValueChange={(itemValue: string) => {
                        const selectedCity = filteredCities.find(city => city.code === itemValue);
                        updateSignupVolunteerSheet(
                          'homeAddressCityMunicipality',
                          selectedCity?.displayName || ''
                        );
                        updateSignupVolunteerSheet('homeAddressBarangay', '');
                        setSelectedCityCode(itemValue);
                        setFilteredBarangays(getBarangaysByCity(itemValue));
                      }}
                      enabled={!signupLoading && selectedRegionCode !== ''}
                      style={styles.picker}
                    >
                      <Picker.Item label="Select City/Municipality..." value="" />
                      {filteredCities.map(city => (
                        <Picker.Item key={city.code} label={city.displayName} value={city.code} />
                      ))}
                    </Picker>
                  </View>

                  <Text style={styles.modalSectionSubLabel}>Barangay</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={signupVolunteerSheet.homeAddressBarangay}
                      onValueChange={(itemValue: string) => updateSignupVolunteerSheet('homeAddressBarangay', itemValue)}
                      enabled={!signupLoading && selectedCityCode !== ''}
                      style={styles.picker}
                    >
                      <Picker.Item label="Select Barangay..." value="" />
                      {filteredBarangays.map(barangay => (
                        <Picker.Item
                          key={barangay.code}
                          label={barangay.displayName}
                          value={barangay.name}
                        />
                      ))}
                    </Picker>
                  </View>


                  <Text style={styles.modalSectionLabel}>Professional Information</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Occupation"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.occupation}
                    onChangeText={value => updateSignupVolunteerSheet('occupation', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Workplace or School"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.workplaceOrSchool}
                    onChangeText={value => updateSignupVolunteerSheet('workplaceOrSchool', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="College Course"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.collegeCourse}
                    onChangeText={value => updateSignupVolunteerSheet('collegeCourse', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Certifications or Trainings"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.certificationsOrTrainings}
                    onChangeText={value => updateSignupVolunteerSheet('certificationsOrTrainings', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Hobbies and Interests"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.hobbiesAndInterests}
                    onChangeText={value => updateSignupVolunteerSheet('hobbiesAndInterests', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Special Skills"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.specialSkills}
                    onChangeText={value => updateSignupVolunteerSheet('specialSkills', value)}
                    editable={!signupLoading}
                  />

                  <Text style={styles.modalSectionLabel}>Certifications & Media</Text>
                  
                  <TouchableOpacity
                    style={[styles.button, styles.uploadButton, signupLoading && { opacity: 0.6 }]}
                    onPress={() => {
                      // TODO: Integrate with expo-image-picker for certificate uploads
                      Alert.alert('Certificate Upload', 'File picker to be implemented with expo-image-picker');
                    }}
                    disabled={signupLoading}
                  >
                    <Text style={styles.uploadButtonText}>📎 Upload Certificates</Text>
                  </TouchableOpacity>

                  <Text style={styles.modalSectionSubLabel}>Video Briefing</Text>
                  <View style={styles.briefingVideoCard}>
                    <View style={styles.briefingVideoPreview}>
                      <MaterialIcons name="play-circle-filled" size={58} color="#ffffff" />
                      <Text style={styles.briefingVideoPreviewText}>Placeholder video</Text>
                    </View>
                    <Text style={styles.briefingVideoTitle}>Volunteer orientation briefing</Text>
                    <Text style={styles.briefingVideoDescription}>
                      Volunteers should finish watching the orientation video before submitting
                      registration. This placeholder can be replaced with the final video later.
                    </Text>
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Video or audio briefing link (URL)"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.videoBriefingUrl}
                    onChangeText={value => updateSignupVolunteerSheet('videoBriefingUrl', value)}
                    editable={!signupLoading}
                  />

                  <Text style={styles.modalSectionSubLabel}>Affiliations (if any)</Text>
                  <View style={styles.affiliationRow}>
                    <TextInput
                      style={[styles.input, styles.affiliationInput]}
                      placeholder="Organization"
                      placeholderTextColor="#999"
                      value={signupVolunteerSheet.affiliationOrg1}
                      onChangeText={value => updateSignupVolunteerSheet('affiliationOrg1', value)}
                      editable={!signupLoading}
                    />
                    <TextInput
                      style={[styles.input, styles.affiliationInput]}
                      placeholder="Position"
                      placeholderTextColor="#999"
                      value={signupVolunteerSheet.affiliationPos1}
                      onChangeText={value => updateSignupVolunteerSheet('affiliationPos1', value)}
                      editable={!signupLoading}
                    />
                  </View>
                  <View style={styles.affiliationRow}>
                    <TextInput
                      style={[styles.input, styles.affiliationInput]}
                      placeholder="Organization"
                      placeholderTextColor="#999"
                      value={signupVolunteerSheet.affiliationOrg2}
                      onChangeText={value => updateSignupVolunteerSheet('affiliationOrg2', value)}
                      editable={!signupLoading}
                    />
                    <TextInput
                      style={[styles.input, styles.affiliationInput]}
                      placeholder="Position"
                      placeholderTextColor="#999"
                      value={signupVolunteerSheet.affiliationPos2}
                      onChangeText={value => updateSignupVolunteerSheet('affiliationPos2', value)}
                      editable={!signupLoading}
                    />
                  </View>

                  <Text style={styles.modalSectionLabel}>Commitment</Text>
                  <View style={styles.commitmentCard}>
                    <Text style={styles.commitmentParagraph}>
                      I {signupName.trim() || '_______________________________'}, voluntarily and
                      freely commit myself to be a member of the NVC Foundation, Inc. I believe
                      in the foundation&apos;s ideals, objectives and directions which are aimed to
                      fight hunger and poverty by providing nutrition, access to quality education
                      for children and livelihood opportunities for the poor.
                    </Text>
                    <Text style={styles.commitmentParagraph}>
                      As a full pledged member, I have read the NVC&apos;s volunteers manual and I
                      commit:
                    </Text>
                    <Text style={styles.commitmentBullet}>
                      • To actively participate in the Foundation&apos;s projects and activities.
                    </Text>
                    <Text style={styles.commitmentBullet}>
                      • To willingly work towards positive and peaceful change.
                    </Text>
                    <Text style={styles.commitmentBullet}>
                      • To refrain from using one&apos;s personal participation in NVC, or using
                      NVC&apos;s collective activities, for partisan politics, whether it be for
                      personal advantage or endorsement of any politician or political party.
                    </Text>
                    <Text style={styles.commitmentBullet}>
                      • To insure that my personal interests do not conflict with those of NVC&apos;s.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.commitmentAcceptanceRow}
                    onPress={() => setSignupAcceptedCommitment(current => !current)}
                    disabled={signupLoading}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons
                      name={signupAcceptedCommitment ? 'check-box' : 'check-box-outline-blank'}
                      size={22}
                      color={signupAcceptedCommitment ? '#166534' : '#64748b'}
                    />
                    <Text style={styles.commitmentAcceptanceText}>
                      I have read and accept the NVC volunteer commitment.
                    </Text>
                  </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            )}

            {signupStep === 'role' ? (
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalSecondaryButton}
                  onPress={closeSignupModal}
                >
                  <Text style={styles.modalSecondaryText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalSecondaryButton}
                  onPress={() => setSignupStep('role')}
                  disabled={signupLoading}
                >
                  <Text style={styles.modalSecondaryText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalPrimaryButton, signupLoading && styles.buttonDisabled]}
                  onPress={handleSignup}
                  disabled={signupLoading}
                >
                  {signupLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalPrimaryText}>
                      {signupRole === 'partner' ? 'Submit Application' : 'Create Volunteer Account'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
        
        {/* Date Picker Modal */}
        {showDatePicker && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, date) => {
              if (Platform.OS === 'android') {
                setShowDatePicker(false);
              }
              if (date) {
                setSelectedDate(date);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                updateSignupVolunteerSheet('dateOfBirth', `${year}-${month}-${day}`);
              }
            }}
            maximumDate={new Date()}
          />
        )}
        
        {/* iOS Date Picker Close Button */}
        {Platform.OS === 'ios' && showDatePicker && (
          <View style={styles.iosDatePickerActions}>
            <TouchableOpacity onPress={() => setShowDatePicker(false)}>
              <Text style={styles.iosDatePickerButton}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'flex-start',
  },
  webContainer: {
    justifyContent: 'flex-start',
  },
  contentShell: {
    width: '100%',
  },
  mobileContentShell: {
    paddingTop: 24,
    paddingBottom: 24,
  },
  webContentShell: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingTop: 32,
    paddingBottom: 32,
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 18,
    marginBottom: 8,
    textAlign: 'center',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  webAccessNotice: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  webAccessNoticeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  webAccessNoticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  selectionDashboard: {
    gap: 14,
    marginBottom: 20,
  },
  selectionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  selectionSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
    textAlign: 'center',
  },
  selectionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 18,
    padding: 18,
  },
  selectionCardPartner: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
  },
  selectionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionIconWrapPartner: {
    backgroundColor: '#fef3c7',
  },
  selectionCopy: {
    flex: 1,
  },
  selectionCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  selectionCardDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  selectionCardAction: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  selectionCardActionPartner: {
    color: '#92400e',
  },
  backendStatusCard: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  backendStatusChecking: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  backendStatusOnline: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
  },
  backendStatusOffline: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  backendStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backendStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  backendStatusDotChecking: {
    backgroundColor: '#2563eb',
  },
  backendStatusDotOnline: {
    backgroundColor: '#16a34a',
  },
  backendStatusDotOffline: {
    backgroundColor: '#dc2626',
  },
  backendStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  backendStatusText: {
    marginTop: 8,
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
  },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
    minHeight: 50,
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#999',
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  demoSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginTop: 20,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  demoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  demoItem: {
    marginBottom: 12,
  },
  demoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  demoEmail: {
    fontSize: 13,
    color: '#333',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  demoPassword: {
    fontSize: 13,
    color: '#333',
    fontFamily: 'monospace',
  },
  mobileOnlyCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  mobileOnlyBadge: {
    marginTop: 6,
    fontSize: 12,
    color: '#64748b',
  },
  mobileRoleBanner: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 14,
    marginBottom: 16,
  },
  backToRoleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  backToRoleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  mobileRoleBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  mobileRoleBannerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  mobileRoleBannerText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  savedAccountCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  accountCardDisabled: {
    opacity: 0.65,
  },
  savedAccountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  savedAccountName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  savedAccountRole: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
  },
  savedAccountCredential: {
    fontSize: 13,
    color: '#334155',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  savedAccountPassword: {
    fontSize: 13,
    color: '#334155',
    fontFamily: 'monospace',
  },
  savedAccountHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#64748b',
  },
  signupText: {
    color: '#4CAF50',
    textAlign: 'center',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    maxHeight: '92%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 6,
    marginBottom: 14,
  },
  modalForm: {
    maxHeight: 520,
  },
  modalFormContent: {
    paddingBottom: 8,
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  modalSectionSubLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
  },
  roleSelector: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  signupRoleChoiceGrid: {
    gap: 14,
    marginBottom: 16,
  },
  signupRoleCard: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 16,
  },
  signupRoleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  signupRoleCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  signupRoleCardDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  signupRoleCardAction: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  pillarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  pillarChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  pillarChipActive: {
    backgroundColor: '#166534',
  },
  pillarChipText: {
    color: '#475569',
    fontWeight: '700',
  },
  pillarChipTextActive: {
    color: '#fff',
  },
  partnerLockNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  partnerLockNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#78350f',
    fontWeight: '600',
  },
  affiliationRow: {
    flexDirection: 'row',
    gap: 10,
  },
  affiliationInput: {
    flex: 1,
  },
  commitmentCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  commitmentParagraph: {
    fontSize: 13,
    lineHeight: 21,
    color: '#334155',
    marginBottom: 10,
  },
  commitmentBullet: {
    fontSize: 13,
    lineHeight: 21,
    color: '#334155',
    marginBottom: 8,
  },
  commitmentAcceptanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 16,
  },
  commitmentAcceptanceText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
    fontWeight: '600',
  },
  roleChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  roleChipActive: {
    backgroundColor: '#4CAF50',
  },
  roleChipText: {
    color: '#475569',
    fontWeight: '700',
  },
  roleChipTextActive: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalSecondaryButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalSecondaryText: {
    color: '#475569',
    fontWeight: '700',
  },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
  textArea: {
    minHeight: 80,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  uploadButton: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#0ea5e9',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadButtonText: {
    color: '#0369a1',
    fontWeight: '600',
    fontSize: 14,
  },
  briefingVideoCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  briefingVideoPreview: {
    height: 180,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  briefingVideoPreviewText: {
    marginTop: 8,
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  briefingVideoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  briefingVideoDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  locationField: {
    marginBottom: 0,
  },
  phLocationInput: {
    marginBottom: 12,
  },
  genderGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  genderChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  genderChipActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#2e7d32',
  },
  genderChipText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 14,
  },
  genderChipTextActive: {
    color: '#fff',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statusChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  statusChipActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#2e7d32',
  },
  statusChipText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 13,
  },
  statusChipTextActive: {
    color: '#fff',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#3b82f6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 12,
  },
  datePickerButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: '#f8fafc',
  },
  picker: {
    height: 50,
    color: '#334155',
  },
  iosDatePickerActions: {
    backgroundColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iosDatePickerButton: {
    color: '#4CAF50',
    fontWeight: '600',
    fontSize: 16,
    paddingHorizontal: 16,
  },
});



