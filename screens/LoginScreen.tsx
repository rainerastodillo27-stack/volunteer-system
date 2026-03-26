import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator, Platform, ScrollView, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  createUserAccount,
  getAllUsers,
  getApiBaseUrl,
  loginWithCredentials,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import AppLogo from '../components/AppLogo';
import { NVCSector, User, UserRole, UserType } from '../models/types';

type SignupVolunteerSheetState = {
  gender: string;
  dateOfBirth: string;
  civilStatus: string;
  homeAddress: string;
  occupation: string;
  workplaceOrSchool: string;
  collegeCourse: string;
  certificationsOrTrainings: string;
  hobbiesAndInterests: string;
  specialSkills: string;
  affiliationOrg1: string;
  affiliationPos1: string;
  affiliationOrg2: string;
  affiliationPos2: string;
};

function createEmptySignupVolunteerSheet(): SignupVolunteerSheetState {
  return {
    gender: '',
    dateOfBirth: '',
    civilStatus: '',
    homeAddress: '',
    occupation: '',
    workplaceOrSchool: '',
    collegeCourse: '',
    certificationsOrTrainings: '',
    hobbiesAndInterests: '',
    specialSkills: '',
    affiliationOrg1: '',
    affiliationPos1: '',
    affiliationOrg2: '',
    affiliationPos2: '',
  };
}

export default function LoginScreen({ navigation }: any) {
  const isWeb = Platform.OS === 'web';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupAccountPhone, setSignupAccountPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupUserType, setSignupUserType] = useState<UserType>('Student');
  const [signupPillars, setSignupPillars] = useState<NVCSector[]>([]);
  const [signupRole, setSignupRole] = useState<Exclude<UserRole, 'admin'>>('volunteer');
  const [signupVolunteerSheet, setSignupVolunteerSheet] = useState<SignupVolunteerSheetState>(
    createEmptySignupVolunteerSheet()
  );
  const [signupAcceptedCommitment, setSignupAcceptedCommitment] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [backendMessage, setBackendMessage] = useState('Checking backend connection...');
  const [savedAccounts, setSavedAccounts] = useState<User[]>([]);
  const { login } = useAuth();
  const mountedRef = useRef(true);

  useEffect(() => {
    setInitialized(true);
    setLoading(false);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkBackend = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

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
      } catch (error: any) {
        if (!cancelled && mountedRef.current) {
          setBackendStatus('offline');
          setBackendMessage(
            error?.message ||
            `Database backend unavailable at ${getApiBaseUrl()}. Check the backend process and Supabase connection.`
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    void checkBackend();
    const intervalId = setInterval(() => {
      void checkBackend();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (backendStatus !== 'online') {
      setSavedAccounts([]);
      return undefined;
    }

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

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      Alert.alert('Validation Error', 'Please enter email or phone and password');
      return;
    }

    if (backendStatus !== 'online') {
      Alert.alert('Database Unavailable', backendMessage);
      return;
    }

    try {
      setLoading(true);
      const user = await loginWithCredentials(identifier.trim(), password.trim());

      if (!user) {
        Alert.alert('Authentication Failed', 'Incorrect email/phone or password.');
        setLoading(false);
        return;
      }

      if (isWeb && user.role !== 'admin') {
        Alert.alert('Access Restricted', 'Volunteer and partner accounts can only log in on mobile.');
        setLoading(false);
        return;
      }

      // Update auth context - this triggers state change and navigation
      await login(user);
      setIdentifier('');
      setPassword('');
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Login Error', 'An error occurred during login. Please try again.');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const resetSignupForm = () => {
    setSignupName('');
    setSignupEmail('');
    setSignupAccountPhone('');
    setSignupPassword('');
    setSignupUserType('Student');
    setSignupPillars([]);
    setSignupRole('volunteer');
    setSignupVolunteerSheet(createEmptySignupVolunteerSheet());
    setSignupAcceptedCommitment(false);
  };

  const updateSignupVolunteerSheet = <K extends keyof SignupVolunteerSheetState>(
    key: K,
    value: SignupVolunteerSheetState[K]
  ) => {
    setSignupVolunteerSheet(current => ({ ...current, [key]: value }));
  };

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

    if (signupPillars.length === 0) {
      Alert.alert('Validation Error', 'Select at least one pillar of interest.');
      return;
    }

    if (signupRole === 'volunteer') {
      if (
        !signupVolunteerSheet.gender.trim() ||
        !signupVolunteerSheet.dateOfBirth.trim() ||
        !signupVolunteerSheet.civilStatus.trim() ||
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
        pillarsOfInterest: signupPillars,
        volunteerMembershipSheet:
          signupRole === 'volunteer'
            ? {
                gender: signupVolunteerSheet.gender.trim(),
                dateOfBirth: signupVolunteerSheet.dateOfBirth.trim(),
                civilStatus: signupVolunteerSheet.civilStatus.trim(),
                homeAddress: signupVolunteerSheet.homeAddress.trim(),
                occupation: signupVolunteerSheet.occupation.trim(),
                workplaceOrSchool: signupVolunteerSheet.workplaceOrSchool.trim(),
                collegeCourse: signupVolunteerSheet.collegeCourse.trim(),
                certificationsOrTrainings:
                  signupVolunteerSheet.certificationsOrTrainings.trim(),
                hobbiesAndInterests: signupVolunteerSheet.hobbiesAndInterests.trim(),
                specialSkills: signupVolunteerSheet.specialSkills.trim(),
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
      setShowSignupModal(false);
      resetSignupForm();
      Alert.alert(
        'Account Created',
        'Your account has been registered and will appear in admin user management.'
      );
    } catch (error: any) {
      Alert.alert('Sign Up Error', error?.message || 'Failed to create account.');
    } finally {
      setSignupLoading(false);
    }
  };

  const handleUseSavedAccount = (account: User) => {
    setIdentifier(account.email || account.phone || '');
    setPassword(account.password);
  };

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
          <Text style={styles.title}>Volcre</Text>
          <Text style={styles.subtitle}>Volunteer coordination platform</Text>
        </View>

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

        <TextInput
          style={styles.input}
          placeholder="Email or Phone"
          placeholderTextColor="#999"
          value={identifier}
          onChangeText={setIdentifier}
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />

        <TouchableOpacity 
          style={[styles.button, loading ? styles.buttonDisabled : null]} 
          onPress={handleLogin} 
          disabled={loading || !identifier || !password || backendStatus !== 'online'}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <View style={styles.demoSection}>
          <Text style={styles.demoTitle}>Demo Credentials:</Text>
          {isWeb ? (
            <>
              <View style={styles.demoItem}>
                <Text style={styles.demoLabel}>Admin Account (Web Only):</Text>
                <Text style={styles.demoEmail}>admin@nvc.org</Text>
                <Text style={styles.demoPassword}>admin123</Text>
              </View>
              <View style={[styles.demoItem, styles.mobileOnlyCard]}>
                <Text style={styles.demoLabel}>Partner Accounts (Mobile App Only):</Text>
                <Text style={styles.demoEmail}>PBSP: partnerships@pbsp.org.ph</Text>
                <Text style={styles.demoPassword}>partner123</Text>
                <Text style={styles.demoEmail}>Jollibee Foundation: partnerships@jollibeefoundation.org</Text>
                <Text style={styles.demoPassword}>partner123</Text>
                <Text style={styles.demoEmail}>Kabankalan LGU: partner@livelihoods.org</Text>
                <Text style={styles.demoPassword}>partner123</Text>
                <Text style={styles.mobileOnlyBadge}>Use via the mobile app</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.demoItem}>
                <Text style={styles.demoLabel}>Volunteer Account (Mobile):</Text>
                <Text style={styles.demoEmail}>volunteer@example.com</Text>
                <Text style={styles.demoPassword}>volunteer123</Text>
              </View>
              <View style={styles.demoItem}>
                <Text style={styles.demoLabel}>Partner Accounts (Mobile):</Text>
                <Text style={styles.demoEmail}>PBSP: partnerships@pbsp.org.ph</Text>
                <Text style={styles.demoPassword}>partner123</Text>
                <Text style={styles.demoEmail}>Jollibee Foundation: partnerships@jollibeefoundation.org</Text>
                <Text style={styles.demoPassword}>partner123</Text>
                <Text style={styles.demoEmail}>Kabankalan LGU: partner@livelihoods.org</Text>
                <Text style={styles.demoPassword}>partner123</Text>
              </View>
            </>
          )}
        </View>

        {savedAccounts.length > 0 && (
          <View style={styles.demoSection}>
            <Text style={styles.demoTitle}>
              {isWeb ? 'Saved Admin Accounts:' : 'Saved Mobile Accounts:'}
            </Text>
            {savedAccounts.map(account => (
              <TouchableOpacity
                key={account.id}
                style={styles.savedAccountCard}
                onPress={() => handleUseSavedAccount(account)}
                activeOpacity={0.85}
              >
                <View style={styles.savedAccountHeader}>
                  <Text style={styles.savedAccountName}>{account.name}</Text>
                  <Text style={styles.savedAccountRole}>{account.role}</Text>
                </View>
                <Text style={styles.savedAccountCredential}>
                  {account.email || account.phone || 'No login identifier'}
                </Text>
                <Text style={styles.savedAccountPassword}>{account.password}</Text>
                <Text style={styles.savedAccountHint}>Tap to use these credentials</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity onPress={() => setShowSignupModal(true)}>
          <Text style={styles.signupText}>Don't have an account? Sign Up</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showSignupModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSignupModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Account</Text>
            <Text style={styles.modalSubtitle}>
              {signupRole === 'volunteer'
                ? 'Register with email or phone, choose a profile type, and complete the volunteer membership information sheet.'
                : 'Register with email or phone, choose a profile type, and pick your pillar interests.'}
            </Text>

            <ScrollView
              style={styles.modalForm}
              contentContainerStyle={styles.modalFormContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <TextInput
                style={styles.input}
                placeholder="Full Name"
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

              <View style={styles.roleSelector}>
                {(['volunteer', 'partner'] as const).map(role => (
                  <TouchableOpacity
                    key={role}
                    style={[styles.roleChip, signupRole === role && styles.roleChipActive]}
                    onPress={() => setSignupRole(role)}
                    disabled={signupLoading}
                  >
                    <Text style={[styles.roleChipText, signupRole === role && styles.roleChipTextActive]}>
                      {role === 'volunteer' ? 'Volunteer' : 'Partner'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

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

              {signupRole === 'volunteer' && (
                <>
                  <Text style={styles.modalSectionLabel}>NVC Membership Information Sheet</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Gender"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.gender}
                    onChangeText={value => updateSignupVolunteerSheet('gender', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Date of Birth"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.dateOfBirth}
                    onChangeText={value => updateSignupVolunteerSheet('dateOfBirth', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Civil Status"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.civilStatus}
                    onChangeText={value => updateSignupVolunteerSheet('civilStatus', value)}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Home Address"
                    placeholderTextColor="#999"
                    value={signupVolunteerSheet.homeAddress}
                    onChangeText={value => updateSignupVolunteerSheet('homeAddress', value)}
                    editable={!signupLoading}
                  />
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

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryButton}
                onPress={() => {
                  setShowSignupModal(false);
                  resetSignupForm();
                }}
                disabled={signupLoading}
              >
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimaryButton, signupLoading && styles.buttonDisabled]}
                onPress={handleSignup}
                disabled={signupLoading}
              >
                {signupLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
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
  inputError: {
    borderColor: '#ff6b6b',
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
  savedAccountCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
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
});

