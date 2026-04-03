import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator, Platform, ScrollView, Modal, Picker, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  createUserAccount,
  getAllUsers,
  getApiBaseUrl,
  isValidDswdAccreditationNo,
  loginWithCredentials,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import AppLogo from '../components/AppLogo';
import { AdvocacyFocus, NVCSector, PartnerSectorType, User, UserRole, UserType } from '../models/types';

type SignupVolunteerSheetState = {
  gender: string;
  dateOfBirth: string;
  civilStatus: string;
  homeAddress: string;
  profilePhotoUrl?: string;
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

type SignupPartnerApplicationState = {
  organizationName: string;
  sectorType: PartnerSectorType;
  dswdAccreditationNo: string;
  advocacyFocus: AdvocacyFocus[];
};

// Validates email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Validates phone number format (basic validation)
function isValidPhone(phone: string): boolean {
  const phoneRegex = /^[0-9\s+()-]{7,}$/;
  return phoneRegex.test(phone);
}

// Validates date format (YYYY-MM-DD or MM/DD/YYYY)
function isValidDateFormat(dateStr: string): boolean {
  if (!dateStr.trim()) return false;
  const dateRegex = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})$/;
  return dateRegex.test(dateStr);
}

// Converts date string to Date object
function parseDate(dateStr: string): Date | null {
  if (!dateStr.trim()) return null;
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date;
    
    // Try MM/DD/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`);
    }
  } catch {
    return null;
  }
  return null;
}

// Formats date to MM/DD/YYYY
function formatDateToString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// Helper function to get days in a month
function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Helper function to get first day of month (0 = Sunday, 1 = Monday, etc.)
function getFirstDayOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
}

// Function to pick an image from device library
async function pickProfilePhoto(setSelectedPhoto: React.Dispatch<React.SetStateAction<string | null>>) {
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
      quality: 0.7,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedPhoto(result.assets[0].uri);
    }
  } catch (error) {
    console.error('Error picking image:', error);
    Alert.alert('Error', 'Failed to pick image. Please try again.');
  }
}

// Function to pick certificate images
async function pickCertificateImages(setCertificates: React.Dispatch<React.SetStateAction<string[]>>) {
  try {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission needed', 'Please grant access to your photos to upload certificates.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 5, // Limit to 5 certificates
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setCertificates(prev => {
        const total = prev.length + result.assets.length;
        if (total > 5) {
          Alert.alert('Limit reached', 'You can upload a maximum of 5 certificates.');
          return prev;
        }
        const newCertificates = result.assets.map(asset => asset.uri);
        return [...prev, ...newCertificates];
      });
    }
  } catch (error) {
    console.error('Error picking certificate images:', error);
    Alert.alert('Error', 'Failed to pick certificate images. Please try again.');
  }
}

// Philippine regions and cities
const PHILIPPINES_LOCATIONS: Record<string, string[]> = {
  'NCR': ['Caloocan City', 'Las Piñas City', 'Makati City', 'Malabon City', 'Mandaluyong City', 'Manila', 'Marikina City', 'Muntinlupa City', 'Navotas City', 'Parañaque City', 'Pasay City', 'Quezon City', 'San Juan City', 'Taguig City', 'Valenzuela City'],
  'Region 1': ['Alaminos City', 'Batac City', 'Candon City', 'Dagupan City', 'Laoag City', 'San Fernando', 'Vigan City'],
  'Region 2': ['Batanes', 'Bayombong', 'Bulacan', 'Cabanatuan City', 'Cauayan City', 'Gapan City', 'Ilagan City', 'Nueva Ecija', 'Nueva Vizcaya', 'Quirino', 'Santiago City', 'Tuguegarao City'],
  'Region 3': ['Angeles City', 'Arayat', 'Bataan', 'Bulacan', 'Cabanatuan', 'Calapan', 'Dinalupihan', 'Gapan', 'Guimba', 'Iba', 'Lucena', 'Mabalacat City', 'Mariveles', 'Morong', 'Nueva Ecija', 'Olongapo City', 'Palayan City', 'Pampanga', 'San Fernando', 'Subic'],
  'Region 4A': ['Agujón', 'Angono', 'Antipolo City', 'Baras', 'Bauan', 'Binagouan', 'Biñan City', 'Calatagan', 'Calayab', 'Cavite City', 'Cavitenõ', 'Coco', 'Dasmariñas', 'Imus City', 'Kawit', 'Lipa City', 'Magdalo', 'Maragondon', 'Mendez-Nuñez', 'Morong', 'Nasugbu', 'Palawan', 'Pila', 'Quezon', 'Rosario', 'Silang', 'Tagaytay City', 'Tanuan City', 'Tanza', 'Ternate', 'Tuy', 'Unisan'],
  'Region 5': ['Albay', 'Camarines Norte', 'Camarines Sur', 'Catanduanes', 'Daet', 'Dagang', 'Daraga', 'Guinobatan', 'Iriga City', 'Legaspi City', 'Ligao City', 'Masbate', 'Masbate City', 'Naga City', 'Nabua', 'Pili', 'Polangui', 'Ragay', 'Sorsogon', 'Sorsogon City'],
  'Region 6': ['Aklan', 'Antique', 'Bacolod City', 'Bago City', 'Bauan', 'Cabanatuan', 'Calinog', 'Camarines', 'Capay', 'Capiz', 'Culasi', 'Dingle', 'Dumalag', 'Estancia', 'Hamtic', 'Iloilo', 'Iloilo City', 'Janiuay', 'Kalibo', 'Lambunao', 'Leganes', 'Maayon', 'Mambusao', 'Mandurriao', 'Miagao', 'Negros Occidental', 'Panay', 'Panitan', 'Pavia', 'Pilo', 'Roxas City', 'Saravia', 'San Dionisio', 'San Joaquin', 'San Remedio', 'Santa Barbara', 'Sipalay', 'Sumisip'],
  'Region 7': ['Badian', 'Bohol', 'Capiznon', 'Carcar City', 'Catmon', 'Cebu', 'Cebu City', 'Compostela', 'Cordova', 'Daanbantayan', 'Dalaguete', 'Danao City', 'Dumaguete City', 'Ginatilan', 'Lapu-Lapu City', 'Liloan', 'Mactan', 'Malabuyoc', 'Mandaue City', 'Medellin', 'Minglanilla', 'Moalboal', 'Naga City', 'Negros Oriental', 'Oslob', 'Pilar', 'San Fernando', 'Santa Fe', 'Santander', 'Sibulan', 'Sibonga', 'Siquijor', 'Talisay City', 'Toledo City', 'Tubigon'],
  'Region 8': ['Abuyog', 'Alangalang', 'Barugo', 'Baybay City', 'Biliran', 'Borongan City', 'Calbayog City', 'Calsigüey', 'Capul', 'Catarman', 'Catabangan', 'Catbalogan City', 'Culasi', 'Eastern Samar', 'Giporlos', 'Guiuan', 'Hernani', 'Hinunangan', 'Ibarra', 'Jaro', 'Jipapad', 'Kananga', 'Laoang', 'Laua-an', 'Leyte', 'Leyte City', 'Macrohon', 'Mahayag', 'Maribojoc', 'Mariposa', 'Matag-ob', 'Matarinao', 'Motiong', 'Northern Samar', 'Ormoc City', 'Palompon', 'Paranas', 'Piat', 'Placer', 'Quezon', 'Rosario', 'Sabal', 'San Isidro', 'San Jorge', 'San Policarpo', 'San Ricardo', 'Santa Margarita', 'Santo Tomas', 'Southern Leyte', 'Tabango', 'Tacloban City', 'Tanauan', 'Tanauan City', 'Tabontabon', 'Tagapul-an', 'Tabina', 'Tago-Iloco', 'Ügat', 'Villareal', 'Villasis'],
  'Region 9': ['Dipolog City', 'Dapitan City', 'Ipil', 'Isabela City', 'Labuhan', 'Liloy', 'Pagadian City', 'Siayan', 'Sibuco', 'Zamboanga City', 'Zamboanga Sibugay', 'Zamboanga del Norte', 'Zamboanga del Sur'],
  'Region 10': ['Agusan del Norte', 'Agusan del Sur', 'Butuan City', 'Cabadbaran City', 'Cagayan de Oro City', 'Camiguin', 'Gingoog City', 'Hinatuan', 'Kolambugan', 'Lanuza', 'Lianga', 'Misamis Oriental', 'Misamis Occidental', 'Nasipit', 'Oroquieta City', 'Ozamiz City', 'Prosperidad', 'Rotonda', 'Surigao City', 'Surigao del Norte', 'Surigao del Sur', 'Tandag City', 'Ubay'],
  'Region 11': ['Baganga', 'Bansalan', 'Calinog', 'Cotabato', 'Dali-Dali', 'Davao City', 'Davao del Norte', 'Davao del Sur', 'Davao Oriental', 'Digos City', 'Dolores', 'Dueling', 'Filemon', 'General Santos City', 'Glan', 'Godod', 'Hagonoy', 'Kiblawan', 'Maco', 'Malalag', 'Marilog', 'Masipit', 'Matanao', 'Mati City', 'Monkayo', 'Montalban', 'Nabunturan', 'Padada', 'Panabo City', 'Pantukan', 'Paquibato', 'Paredon', 'Pujada', 'Santo Tomas', 'Santa Cruz', 'Sarangani', 'Saug', 'Sitio', 'Somot', 'South Cotabato', 'Tagum City', 'Tamisan', 'Taraka', 'Tayabas', 'Teguestaga', 'Ternate', 'Tiagos', 'Tibungco', 'Todaya'],
  'Region 12': ['Awang', 'Bacolod City', 'Baguio', 'Banisilan', 'Bamanga', 'Baraan', 'Bele', 'Bendum', 'Bentayan', 'Bessayag', 'Binzanon', 'Biong', 'Biraran', 'Bolongan', 'Bontod', 'Borowan', 'Botanon', 'Boworan', 'Bucayan', 'Buduan', 'Buguias', 'Bulang', 'Bunawan', 'Cachipayan', 'Cadz-an', 'Calasio', 'Calinog', 'Calongkot', 'Calubian', 'Caluwan', 'Calumpang', 'Calumpit', 'Columbog', 'Cotabato', 'Cotabato City', 'Darahan', 'Dumiring', 'Enoguran', 'Esperanza', 'Estancia', 'Falone', 'Finaz-an', 'Gadalon', 'Gaddi', 'Gadi', 'Galoyon', 'Gamay', 'Ganga', 'Garo', 'Gasan', 'Gasigan', 'Gaupang', 'Gil', 'Gilangel', 'Gilutongan', 'Ginayan', 'Ginigaran', 'Ginolayan', 'Ginoton', 'Giparion', 'Gipodan', 'Girito', 'Gitagum', 'Glaiza', 'Glaizo', 'Glango', 'Gluyon', 'Godod', 'Goka', 'Golbao', 'Golen', 'General Santos City', 'Gon-Gon', 'Goyo', 'Goza', 'Gradel', 'Gralagan', 'Graland', 'Grana', 'Grane', 'Granim', 'Granito', 'Grano', 'Gran-ub', 'Granyar', 'Grapil', 'Grapo', 'Grapu', 'Grasil', 'Grasol', 'Gratez', 'Gratia', 'Gratiala', 'Gratin', 'Gratio', 'Gratirn', 'Gratnion', 'Gratrion', 'Gratul', 'Graueloa', 'Gravane', 'Gravilla', 'Graya', 'Gre', 'Greba', 'Grebu', 'Greca', 'Gredata', 'Gredel', 'Gredey', 'Gredia', 'Grediel', 'Greding', 'Gredia', 'Gregonia', 'Gregorio', 'Grela', 'Grelado', 'Grelancia', 'Grelbay', 'Grelburn', 'Grelcy', 'Grelda', 'Grelei', 'Grelfey', 'Greli', 'Grelita', 'Greliz', 'Grelka', 'Grella', 'Grelli', 'Grelo', 'Grelod', 'Grelona', 'Grelon', 'Grelonja', 'Grelop', 'Grelopon', 'Grelopz', 'Grelornia', 'Grelosea', 'Greloue', 'Greloveia', 'Grelovia', 'Grelovinca', 'Grelovinia', 'Grelovinka', 'Grelovio', 'Grelovolia', 'Grelovulia', 'Grelowa', 'Greloy', 'Greloza', 'Grelph', 'Grelsix', 'Grelta', 'Greltha', 'Greltia', 'Greltina', 'Grelto', 'Greltonia', 'Greltra', 'Greltu', 'Greltuna', 'Greltus', 'Grelua', 'Grelu', 'Greluba', 'Grelucia', 'Greluda', 'Greludicia', 'Greludion', 'Greludy', 'Greluffrey', 'Grelugo', 'Grelu', 'Kalalayan', 'Kalamansig', 'Kalapati', 'Kalapawis', 'Kalarabutan', 'Kalawakan', 'Kalaya-an', 'Kalayaan', 'Kalaya', 'Kalayaga', 'Kalayahan', 'Kalayakan', 'Kalayalangan', 'Kalbatayan', 'Kalbog', 'Kalbugan', 'Kalbulan', 'Kalburan', 'Kaldaba', 'Kaldabang', 'Kaldabasan', 'Koronadal City', 'Tacurong City'],
  'Region 13': ['Bislig City', 'Butuan City', 'Cabadbaran City', 'Mati City', 'Nasipit City', 'Surigao City', 'Tandag City', 'Agusan del Norte', 'Agusan del Sur', 'Dinagat Islands', 'Surigao del Norte', 'Surigao del Sur'],
  'BARMM': ['Basilan', 'Basilan City', 'Cotabato City', 'Isabella City', 'Jolo City', 'Lamitan City', 'Marawi City', 'Zamboanga City'],
};

// Returns a clean volunteer membership form state for the signup modal.
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

// Returns the default state for partner registration applications.
function createEmptySignupPartnerApplication(): SignupPartnerApplicationState {
  return {
    organizationName: '',
    sectorType: 'NGO',
    dswdAccreditationNo: '',
    advocacyFocus: [],
  };
}

// Handles account login and volunteer or partner self-registration.
export default function LoginScreen() {
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
  const [signupPartnerApplication, setSignupPartnerApplication] =
    useState<SignupPartnerApplicationState>(createEmptySignupPartnerApplication());
  const [signupVolunteerSheet, setSignupVolunteerSheet] = useState<SignupVolunteerSheetState>(
    createEmptySignupVolunteerSheet()
  );
  const [signupAcceptedCommitment, setSignupAcceptedCommitment] = useState(false);
  const [signupWatchedVideo, setSignupWatchedVideo] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);
  const [showCivilStatusPicker, setShowCivilStatusPicker] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date(2000, 0, 1));
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(new Date(2000, 0, 1));
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showAddressSearchModal, setShowAddressSearchModal] = useState(false);
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedProfilePhoto, setSelectedProfilePhoto] = useState<string | null>(null);
  const [uploadedCertificates, setUploadedCertificates] = useState<string[]>([]);
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

    // Checks whether the backend is reachable before allowing authentication flows.
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
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'An error occurred during login. Please try again.';
      const title =
        message.includes('rejected')
          ? 'Application Rejected'
          : message.includes('organization application') || message.includes('partner account')
          ? 'Application Pending'
          : 'Login Error';
      Alert.alert(title, message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
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
    setSignupAcceptedCommitment(false);
    setSignupWatchedVideo(false);
    setShowDatePicker(false);
    setShowGenderPicker(false);
    setShowCivilStatusPicker(false);
    setUploadedCertificates([]);
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

    if (!signupName.trim()) {
      Alert.alert('Validation Error', 'Name is required.');
      return;
    }

    if (!signupPassword.trim()) {
      Alert.alert('Validation Error', 'Password is required.');
      return;
    }

    if (signupPassword.trim().length < 6) {
      Alert.alert('Validation Error', 'Password must be at least 6 characters.');
      return;
    }

    if (!signupEmail.trim() && !signupAccountPhone.trim()) {
      Alert.alert('Validation Error', 'Please provide an email or phone number.');
      return;
    }

    if (signupEmail.trim() && !isValidEmail(signupEmail.trim())) {
      Alert.alert('Validation Error', 'Please enter a valid email address (e.g., user@example.com).');
      return;
    }

    if (signupAccountPhone.trim() && !isValidPhone(signupAccountPhone.trim())) {
      Alert.alert('Validation Error', 'Please enter a valid phone number.');
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

      if (!isValidDateFormat(signupVolunteerSheet.dateOfBirth.trim())) {
        Alert.alert(
          'Validation Error',
          'Please enter a valid date of birth (e.g., 01/15/1990 or 1990-01-15).'
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

      if (!signupWatchedVideo) {
        Alert.alert(
          'Validation Error',
          'You must watch the volunteer orientation video before creating your account.'
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
        signupRole === 'partner' ? 'Application Submitted' : 'Account Created',
        signupRole === 'partner'
          ? 'Your partner application was submitted. An admin must verify and approve it before partner login is unlocked.'
          : 'Your account has been registered and will appear in admin user management.'
      );
    } catch (error: any) {
      Alert.alert('Sign Up Error', error?.message || 'Failed to create account.');
    } finally {
      setSignupLoading(false);
    }
  };

  // Prefills the login form with a saved account for faster access.
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
            <Text style={styles.buttonText}>Log In</Text>
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
          <Text style={styles.signupText}>Don't have an account? Register</Text>
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
            <Text style={styles.modalTitle}>
              {signupRole === 'partner' ? 'Partner Registration' : 'Create Account'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {signupRole === 'volunteer'
                ? 'Register with email or phone, choose a profile type, and complete the volunteer membership information sheet.'
                : 'Submit your organization application with DSWD details. Partner login is unlocked after admin approval.'}
            </Text>

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
                    placeholder="DSWD Accreditation No."
                    placeholderTextColor="#999"
                    value={signupPartnerApplication.dswdAccreditationNo}
                    onChangeText={value => updateSignupPartnerApplication('dswdAccreditationNo', value)}
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
                  
                  <Text style={styles.inputLabel}>Gender *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownButton}
                    onPress={() => setShowGenderPicker(!showGenderPicker)}
                    disabled={signupLoading}
                  >
                    <Text style={styles.dropdownButtonText}>
                      {signupVolunteerSheet.gender || 'Select Gender'}
                    </Text>
                    <MaterialIcons name="arrow-drop-down" size={20} color="#64748b" />
                  </TouchableOpacity>
                  {showGenderPicker && (
                    <View style={styles.pickerContainer}>
                      {['Male', 'Female', 'Other', 'Prefer not to say'].map(option => (
                        <TouchableOpacity 
                          key={option}
                          style={styles.pickerOption}
                          onPress={() => {
                            updateSignupVolunteerSheet('gender', option);
                            setShowGenderPicker(false);
                          }}
                        >
                          <Text style={styles.pickerOptionText}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text style={styles.inputLabel}>Date of Birth (MM/DD/YYYY) *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownButton}
                    onPress={() => {
                      setShowDatePicker(!showDatePicker);
                      if (!showDatePicker) {
                        const parsed = parseDate(signupVolunteerSheet.dateOfBirth);
                        if (parsed) {
                          setCalendarDate(parsed);
                          setCurrentCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
                        }
                      }
                    }}
                    disabled={signupLoading}
                  >
                    <Text style={styles.dropdownButtonText}>
                      {signupVolunteerSheet.dateOfBirth || 'Select Date'}
                    </Text>
                    <MaterialIcons name="calendar-today" size={20} color="#64748b" />
                  </TouchableOpacity>
                  {showDatePicker && (
                    <View style={styles.calendarContainer}>
                      {/* Year/Month Navigation */}
                      {!showYearPicker && (
                        <>
                          <View style={styles.calendarHeader}>
                            <TouchableOpacity 
                              onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() - 1, 1))}
                              style={styles.calendarNavButton}
                            >
                              <MaterialIcons name="chevron-left" size={24} color="#2563eb" />
                            </TouchableOpacity>
                            <TouchableOpacity 
                              onPress={() => setShowYearPicker(true)}
                              style={styles.monthYearButton}
                            >
                              <Text style={styles.calendarMonthYear}>
                                {currentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                              </Text>
                              <MaterialIcons name="arrow-drop-down" size={20} color="#2563eb" />
                            </TouchableOpacity>
                            <TouchableOpacity 
                              onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 1))}
                              style={styles.calendarNavButton}
                            >
                              <MaterialIcons name="chevron-right" size={24} color="#2563eb" />
                            </TouchableOpacity>
                          </View>
                          
                          {/* Day Headers */}
                          <View style={styles.calendarDayHeaders}>
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                              <Text key={day} style={styles.calendarDayHeader}>{day}</Text>
                            ))}
                          </View>
                          
                          {/* Calendar Days */}
                          <View style={styles.calendarDaysGrid}>
                            {Array.from({ length: getFirstDayOfMonth(currentCalendarMonth) }).map((_, i) => (
                              <View key={`empty-${i}`} style={styles.calendarDaySlot} />
                            ))}
                            {Array.from({ length: getDaysInMonth(currentCalendarMonth) }).map((_, i) => {
                              const day = i + 1;
                              const date = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth(), day);
                              const isSelected = calendarDate.getDate() === day &&
                                                calendarDate.getMonth() === currentCalendarMonth.getMonth() &&
                                                calendarDate.getFullYear() === currentCalendarMonth.getFullYear();
                              
                              return (
                                <TouchableOpacity
                                  key={day}
                                  style={[styles.calendarDaySlot, isSelected && styles.calendarDaySelected]}
                                  onPress={() => {
                                    setCalendarDate(date);
                                    updateSignupVolunteerSheet('dateOfBirth', formatDateToString(date));
                                    setShowDatePicker(false);
                                  }}
                                >
                                  <Text style={[styles.calendarDay, isSelected && styles.calendarDaySelectedText]}>
                                    {day}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </>
                      )}
                      
                      {/* Year Picker */}
                      {showYearPicker && (
                        <View style={styles.yearPickerContainer}>
                          <View style={styles.yearPickerHeader}>
                            <TouchableOpacity 
                              onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.getFullYear() - 10, 0, 1))}
                              style={styles.yearNavButton}
                            >
                              <MaterialIcons name="chevron-left" size={24} color="#2563eb" />
                            </TouchableOpacity>
                            <Text style={styles.yearPickerTitle}>
                              {currentCalendarMonth.getFullYear() - 5} - {currentCalendarMonth.getFullYear() + 4}
                            </Text>
                            <TouchableOpacity 
                              onPress={() => setCurrentCalendarMonth(new Date(currentCalendarMonth.getFullYear() + 10, 0, 1))}
                              style={styles.yearNavButton}
                            >
                              <MaterialIcons name="chevron-right" size={24} color="#2563eb" />
                            </TouchableOpacity>
                          </View>
                          <View style={styles.yearGrid}>
                            {Array.from({ length: 10 }).map((_, i) => {
                              const year = currentCalendarMonth.getFullYear() - 5 + i;
                              const isSelected = calendarDate.getFullYear() === year;
                              
                              return (
                                <TouchableOpacity
                                  key={year}
                                  style={[styles.yearCell, isSelected && styles.yearCellSelected]}
                                  onPress={() => {
                                    setCurrentCalendarMonth(new Date(year, 0, 1));
                                    setShowYearPicker(false);
                                  }}
                                >
                                  <Text style={[styles.yearCellText, isSelected && styles.yearCellSelectedText]}>
                                    {year}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          <TouchableOpacity 
                            style={styles.pickerConfirmButton}
                            onPress={() => setShowYearPicker(false)}
                          >
                            <Text style={styles.pickerConfirmText}>Done</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      
                      {!showYearPicker && (
                        <TouchableOpacity 
                          style={styles.pickerConfirmButton}
                          onPress={() => setShowDatePicker(false)}
                        >
                          <Text style={styles.pickerConfirmText}>Done</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  <Text style={styles.inputLabel}>Civil Status *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownButton}
                    onPress={() => setShowCivilStatusPicker(!showCivilStatusPicker)}
                    disabled={signupLoading}
                  >
                    <Text style={styles.dropdownButtonText}>
                      {signupVolunteerSheet.civilStatus || 'Select Civil Status'}
                    </Text>
                    <MaterialIcons name="arrow-drop-down" size={20} color="#64748b" />
                  </TouchableOpacity>
                  {showCivilStatusPicker && (
                    <View style={styles.pickerContainer}>
                      {['Single', 'Married', 'Divorced', 'Widowed', 'Prefer not to say'].map(option => (
                        <TouchableOpacity 
                          key={option}
                          style={styles.pickerOption}
                          onPress={() => {
                            updateSignupVolunteerSheet('civilStatus', option);
                            setShowCivilStatusPicker(false);
                          }}
                        >
                          <Text style={styles.pickerOptionText}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text style={styles.inputLabel}>Profile Photo (Optional)</Text>
                  <TouchableOpacity 
                    style={styles.uploadButton}
                    onPress={() => pickProfilePhoto(setSelectedProfilePhoto)}
                    disabled={signupLoading}
                  >
                    <MaterialIcons name="camera-alt" size={24} color="#166534" />
                    <Text style={styles.uploadButtonText}>
                      {selectedProfilePhoto ? 'Change Photo' : 'Upload Profile Photo'}
                    </Text>
                  </TouchableOpacity>
                  {selectedProfilePhoto && (
                    <View style={styles.photoPreviewContainer}>
                      <Image
                        source={{ uri: selectedProfilePhoto }}
                        style={styles.photoPreview}
                      />
                      <TouchableOpacity
                        style={styles.photoRemoveButton}
                        onPress={() => setSelectedProfilePhoto(null)}
                      >
                        <MaterialIcons name="close" size={18} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  )}

                  <Text style={styles.inputLabel}>Home Address *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownButton}
                    onPress={() => setShowAddressSearchModal(!showAddressSearchModal)}
                    disabled={signupLoading}
                  >
                    <Text style={[styles.dropdownButtonText, !signupVolunteerSheet.homeAddress && { color: '#999' }]}>
                      {signupVolunteerSheet.homeAddress || 'Select Address'}
                    </Text>
                    <MaterialIcons name="location-on" size={20} color="#64748b" />
                  </TouchableOpacity>
                  {showAddressSearchModal && (
                    <View style={styles.addressSearchContainer}>
                      {!selectedRegion ? (
                        <>
                          <Text style={styles.pickerLabel}>Select Region:</Text>
                          <ScrollView style={styles.addressSuggestions} nestedScrollEnabled>
                            {Object.keys(PHILIPPINES_LOCATIONS)
                              .sort()
                              .map(region => (
                                <TouchableOpacity
                                  key={region}
                                  style={styles.addressSuggestion}
                                  onPress={() => setSelectedRegion(region)}
                                >
                                  <MaterialIcons name="location-on" size={16} color="#2563eb" />
                                  <Text style={styles.addressSuggestionText}>{region}</Text>
                                  <MaterialIcons name="chevron-right" size={16} color="#64748b" />
                                </TouchableOpacity>
                              ))}
                          </ScrollView>
                        </>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.backButton}
                            onPress={() => setSelectedRegion(null)}
                          >
                            <MaterialIcons name="chevron-left" size={20} color="#2563eb" />
                            <Text style={styles.backButtonText}>{selectedRegion}</Text>
                          </TouchableOpacity>
                          <Text style={styles.pickerLabel}>Select City/Municipality:</Text>
                          <ScrollView style={styles.addressSuggestions} nestedScrollEnabled>
                            {PHILIPPINES_LOCATIONS[selectedRegion]
                              .sort()
                              .map((city, idx) => (
                                <TouchableOpacity
                                  key={idx}
                                  style={styles.addressSuggestion}
                                  onPress={() => {
                                    updateSignupVolunteerSheet('homeAddress', `${city}, ${selectedRegion}`);
                                    setShowAddressSearchModal(false);
                                    setAddressSearchQuery('');
                                    setSelectedRegion(null);
                                  }}
                                >
                                  <MaterialIcons name="location-on" size={16} color="#2563eb" />
                                  <Text style={styles.addressSuggestionText}>{city}</Text>
                                </TouchableOpacity>
                              ))}
                          </ScrollView>
                        </>
                      )}
                      <TouchableOpacity 
                        style={styles.pickerConfirmButton}
                        onPress={() => {
                          setShowAddressSearchModal(false);
                          setAddressSearchQuery('');
                          setSelectedRegion(null);
                        }}
                      >
                        <Text style={styles.pickerConfirmText}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  )}

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

                  <Text style={styles.modalSectionSubLabel}>Professional Certifications (optional)</Text>
                  <TouchableOpacity
                    style={styles.uploadButton}
                    onPress={() => pickCertificateImages(setUploadedCertificates)}
                    disabled={signupLoading}
                  >
                    <MaterialIcons name="cloud-upload" size={24} color="#166534" />
                    <Text style={styles.uploadButtonText}>
                      {uploadedCertificates.length > 0 
                        ? `${uploadedCertificates.length} certificate(s) uploaded` 
                        : 'Upload Certificates'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.uploadHint}>
                    Supported formats: PDF, JPG, PNG (Max 5MB each). You can upload multiple files.
                  </Text>
                  {uploadedCertificates.length > 0 && (
                    <View style={styles.certificatesList}>
                      {uploadedCertificates.map((cert, index) => (
                        <View key={index} style={styles.certificateItem}>
                          <Image
                            source={{ uri: cert }}
                            style={styles.certificatePreview}
                          />
                          <View style={styles.certificateInfo}>
                            <Text style={styles.certificateItemText}>Certificate {index + 1}</Text>
                            <TouchableOpacity
                              onPress={() => setUploadedCertificates(uploadedCertificates.filter((_, i) => i !== index))}
                              style={styles.certificateRemoveButton}
                            >
                              <MaterialIcons name="close" size={16} color="#dc2626" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

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

                  <Text style={styles.modalSectionLabel}>Volunteer Orientation Video</Text>
                  <View style={styles.videoContainer}>
                    <View style={styles.videoPlaceholder}>
                      <MaterialIcons name="play-circle-outline" size={64} color="#166534" />
                      <Text style={styles.videoPlaceholderText}>Sample Video</Text>
                      <Text style={styles.videoPlaceholderSubText}>Learn about NVC volunteer opportunities</Text>
                    </View>
                    <Text style={styles.videoDescription}>
                      This orientation video introduces you to the NVC Foundation, our mission, volunteer roles, and what to expect as a member.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.commitmentAcceptanceRow}
                    onPress={() => setSignupWatchedVideo(current => !current)}
                    disabled={signupLoading}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons
                      name={signupWatchedVideo ? 'check-box' : 'check-box-outline-blank'}
                      size={22}
                      color={signupWatchedVideo ? '#166534' : '#64748b'}
                    />
                    <Text style={styles.commitmentAcceptanceText}>
                      I have watched the orientation video.
                    </Text>
                  </TouchableOpacity>

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
                  <Text style={styles.modalPrimaryText}>
                    {signupRole === 'partner' ? 'Submit Application' : 'Create'}
                  </Text>
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
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginTop: 12,
    marginBottom: 6,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  dropdownButtonText: {
    flex: 1,
    fontSize: 14,
    color: '#334155',
  },
  pickerContainer: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  pickerOption: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  pickerOptionText: {
    fontSize: 14,
    color: '#334155',
  },
  datePickerContainer: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  calendarContainer: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 8,
  },
  calendarNavButton: {
    padding: 8,
  },
  monthYearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f9ff',
    gap: 4,
  },
  calendarMonthYear: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  yearPickerContainer: {
    paddingVertical: 12,
  },
  yearPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  yearNavButton: {
    padding: 8,
  },
  yearPickerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  yearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  yearCell: {
    width: '20%',
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    marginVertical: 4,
  },
  yearCellSelected: {
    backgroundColor: '#2563eb',
  },
  yearCellText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  yearCellSelectedText: {
    color: '#fff',
  },
  calendarDayHeaders: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  calendarDayHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    width: '14.28%',
    textAlign: 'center',
  },
  calendarDaysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  calendarDaySlot: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 2,
    borderRadius: 6,
  },
  calendarDay: {
    fontSize: 13,
    color: '#334155',
    textAlign: 'center',
  },
  calendarDaySelected: {
    backgroundColor: '#2563eb',
  },
  calendarDaySelectedText: {
    color: '#fff',
    fontWeight: '600',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    gap: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563eb',
  },
  pickerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  pickerConfirmButton: {
    backgroundColor: '#166534',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 12,
  },
  pickerConfirmText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  addressSearchContainer: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    maxHeight: 300,
  },
  addressSuggestions: {
    maxHeight: 200,
    marginVertical: 8,
  },
  addressSuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  addressSuggestionText: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
  },
  regionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
    backgroundColor: '#eff6ff',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 4,
  },
  addressInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  inputHint: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
    borderColor: '#166534',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 20,
    marginBottom: 8,
  },
  uploadButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#166534',
  },
  uploadHint: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },
  photoPreviewContainer: {
    position: 'relative',
    alignItems: 'center',
    marginBottom: 12,
  },
  photoPreview: {
    width: 150,
    height: 150,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  photoRemoveButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#dc2626',
    borderRadius: 50,
    padding: 6,
  },
  certificatesList: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    marginBottom: 12,
    padding: 8,
  },
  certificateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  certificatePreview: {
    width: 50,
    height: 50,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  certificateInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  certificateRemoveButton: {
    padding: 4,
  },
  certificateItemText: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
  },
  videoContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  videoPlaceholder: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  videoPlaceholderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginTop: 10,
  },
  videoPlaceholderSubText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  videoDescription: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 20,
    textAlign: 'center',
  },
});

