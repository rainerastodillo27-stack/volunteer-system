import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import {
  User,
  UserType,
  Partner,
  Project,
  Volunteer,
  Message,
  StatusUpdate,
  VolunteerProjectMatch,
  SectorNeed,
  VolunteerTimeLog,
  PartnerProjectApplication,
  VolunteerProjectJoinRecord,
} from './types';
import { NVCSector, UserRole } from './types';

const STORAGE_KEYS = {
  USERS: 'users',
  CURRENT_USER: 'currentUser',
  PARTNERS: 'partners',
  PROJECTS: 'projects',
  VOLUNTEERS: 'volunteers',
  MESSAGES: 'messages',
  STATUS_UPDATES: 'statusUpdates',
  VOLUNTEER_MATCHES: 'volunteerMatches',
  VOLUNTEER_TIME_LOGS: 'volunteerTimeLogs',
  VOLUNTEER_PROJECT_JOINS: 'volunteerProjectJoins',
  PARTNER_PROJECT_APPLICATIONS: 'partnerProjectApplications',
};

const WEB_MESSAGE_SYNC_KEY = 'volcre:messages:updatedAt';
const memoryStorageCache = new Map<string, unknown>();
let mockDataInitializationPromise: Promise<void> | null = null;
let sharedStorageCleanupPromise: Promise<void> | null = null;
let sharedStorageCleanupCompleted = false;
// Supabase-backed storage reads can exceed 2.5s on some networks.
// Keep this comfortably above the observed backend round-trip so web/mobile
// prefer shared storage instead of silently falling back to stale local cache.
const REMOTE_STORAGE_TIMEOUT_MS = 10000;
const API_READY_RETRY_MS = 800;
const API_READY_MAX_ATTEMPTS = 6;
const LOCAL_ONLY_STORAGE_KEYS = new Set([STORAGE_KEYS.CURRENT_USER]);
const SHARED_STORAGE_KEYS = Object.values(STORAGE_KEYS).filter(
  key => !LOCAL_ONLY_STORAGE_KEYS.has(key)
);
const NEGROS_OCCIDENTAL_BOUNDS = {
  minLatitude: 9.85,
  maxLatitude: 11.05,
  minLongitude: 122.45,
  maxLongitude: 123.35,
};
export const NEGROS_SAMPLE_PROJECTS: Project[] = [
  {
    id: 'project-1',
    title: 'Mingo for Nutritional Support',
    description: 'Nutrition program focused on serving Mingo meals to undernourished children and improving child wellness outcomes.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'In Progress',
    category: 'Nutrition',
    startDate: new Date(2026, 0, 6).toISOString(),
    endDate: new Date(2026, 10, 28).toISOString(),
    location: {
      latitude: 10.6765,
      longitude: 122.9509,
      address: 'Bacolod City, Negros Occidental, Philippines',
    },
    volunteersNeeded: 24,
    volunteers: ['volunteer-1'],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-2',
    title: 'Farm to Fork Program',
    description: 'Nutrition-linked sourcing initiative that supports local farmers while supplying ingredients and food products for feeding efforts.',
    partnerId: 'partner-2',
    isEvent: false,
    status: 'In Progress',
    category: 'Nutrition',
    startDate: new Date(2026, 0, 20).toISOString(),
    endDate: new Date(2026, 9, 30).toISOString(),
    location: {
      latitude: 10.5333,
      longitude: 122.8333,
      address: 'Pulupandan, Negros Occidental, Philippines',
    },
    volunteersNeeded: 14,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-3',
    title: 'Mingo for Emergency Relief',
    description: 'Emergency response program using Mingo as a ready nutrition intervention for disaster-affected families.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'Planning',
    category: 'Nutrition',
    startDate: new Date(2026, 1, 10).toISOString(),
    endDate: new Date(2026, 11, 15).toISOString(),
    location: {
      latitude: 10.6667,
      longitude: 122.9667,
      address: 'Talisay City, Negros Occidental, Philippines',
    },
    volunteersNeeded: 18,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-4',
    title: 'Masiglang Pagbubuntis, Masiglang Kamusmusan',
    description: 'PBSP-led maternal nutrition and early childhood support program for pregnant women.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'In Progress',
    category: 'Nutrition',
    startDate: new Date(2026, 4, 1).toISOString(),
    endDate: new Date(2026, 9, 30).toISOString(),
    location: {
      latitude: 14.5547,
      longitude: 121.0244,
      address: 'Makati City, Metro Manila, Philippines',
    },
    volunteersNeeded: 15,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-5',
    title: 'Mingo Parties!',
    description: 'Community activation program that turns nutrition sessions into child-friendly outreach events using Mingo meals and learning activities.',
    partnerId: 'partner-3',
    isEvent: true,
    status: 'Planning',
    category: 'Nutrition',
    startDate: new Date(2026, 5, 14).toISOString(),
    endDate: new Date(2026, 5, 14).toISOString(),
    location: {
      latitude: 10.6311,
      longitude: 122.9784,
      address: 'Silay City, Negros Occidental, Philippines',
    },
    volunteersNeeded: 30,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-6',
    title: 'LoveBags',
    description: 'Education support drive that distributes school bags and learning supplies to students from underserved communities.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'In Progress',
    category: 'Education',
    startDate: new Date(2026, 0, 13).toISOString(),
    endDate: new Date(2026, 7, 29).toISOString(),
    location: {
      latitude: 10.1042,
      longitude: 122.8682,
      address: 'Binalbagan, Negros Occidental, Philippines',
    },
    volunteersNeeded: 20,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-7',
    title: 'School Support',
    description: 'Education improvement program covering classroom repairs, school equipment, and student learning support.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'Planning',
    category: 'Education',
    startDate: new Date(2026, 1, 2).toISOString(),
    endDate: new Date(2026, 10, 20).toISOString(),
    location: {
      latitude: 10.1078,
      longitude: 123.0111,
      address: 'Victorias City, Negros Occidental, Philippines',
    },
    volunteersNeeded: 16,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-8',
    title: 'Artisans of Hope',
    description: 'Livelihood program that helps community artisans produce and sell handcrafted items for sustainable income.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'In Progress',
    category: 'Livelihood',
    startDate: new Date(2026, 0, 27).toISOString(),
    endDate: new Date(2026, 8, 25).toISOString(),
    location: {
      latitude: 9.9904,
      longitude: 122.8144,
      address: 'Kabankalan City, Negros Occidental, Philippines',
    },
    volunteersNeeded: 12,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-9',
    title: 'Project Joseph',
    description: 'Livelihood assistance project that provides tools and starter equipment to skilled workers and breadwinners.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'Planning',
    category: 'Livelihood',
    startDate: new Date(2026, 2, 9).toISOString(),
    endDate: new Date(2026, 10, 13).toISOString(),
    location: {
      latitude: 10.4302,
      longitude: 122.9212,
      address: 'La Carlota City, Negros Occidental, Philippines',
    },
    volunteersNeeded: 10,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-10',
    title: 'Growing Hope',
    description: 'Community gardening and food security initiative that helps families grow produce for consumption and income.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'In Progress',
    category: 'Livelihood',
    startDate: new Date(2026, 1, 16).toISOString(),
    endDate: new Date(2026, 11, 4).toISOString(),
    location: {
      latitude: 10.3986,
      longitude: 122.9861,
      address: 'Bago City, Negros Occidental, Philippines',
    },
    volunteersNeeded: 22,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
  {
    id: 'project-11',
    title: 'Peter Project',
    description: 'Livelihood support for fisherfolk through boat assistance and market access for their catch.',
    partnerId: 'partner-3',
    isEvent: false,
    status: 'Planning',
    category: 'Livelihood',
    startDate: new Date(2026, 2, 23).toISOString(),
    endDate: new Date(2026, 11, 11).toISOString(),
    location: {
      latitude: 10.4989,
      longitude: 122.8167,
      address: 'Valladolid, Negros Occidental, Philippines',
    },
    volunteersNeeded: 15,
    volunteers: [],
    joinedUserIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusUpdates: [],
  },
];

const SECTOR_NEEDS: SectorNeed[] = [
  {
    sector: 'Education',
    title: 'NVC Education Sector',
    description: 'Learning materials, school equipment, and classroom support.',
    goalAmount: 500000,
  },
  {
    sector: 'Livelihood',
    title: 'NVC Livelihood Sector',
    description: 'Skills training tools, starter kits, and income-generation support.',
    goalAmount: 400000,
  },
  {
    sector: 'Nutrition',
    title: 'NVC Nutrition Sector',
    description: 'Nutrition packs, feeding programs, and health monitoring.',
    goalAmount: 300000,
  },
];

function notifyWebMessageUpdate(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(WEB_MESSAGE_SYNC_KEY, String(Date.now()));
  }
}

function getBundlerHost(): string | null {
  const scriptUrl = NativeModules?.SourceCode?.scriptURL as string | undefined;
  if (!scriptUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(scriptUrl);
    return parsedUrl.hostname || null;
  } catch {
    const match = scriptUrl.match(/https?:\/\/([^/:]+)/i);
    return match?.[1] ?? null;
  }
}

function resolveConfiguredApiBaseUrl(configuredBaseUrl: string): string {
  const trimmedBaseUrl = configuredBaseUrl.trim().replace(/\/$/, '');
  const bundlerHost = getBundlerHost();

  try {
    const parsedUrl = new URL(trimmedBaseUrl);
    const isLoopbackHost =
      parsedUrl.hostname === '127.0.0.1' ||
      parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname === '10.0.2.2';

    if (bundlerHost && isLoopbackHost && Platform.OS !== 'web') {
      parsedUrl.hostname = bundlerHost;
      return parsedUrl.toString().replace(/\/$/, '');
    }
  } catch {
    return trimmedBaseUrl;
  }

  return trimmedBaseUrl;
}

function resolveNativeApiBaseUrl(configuredBaseUrl?: string): string {
  const bundlerHost = getBundlerHost();

  if (configuredBaseUrl && configuredBaseUrl.trim().length > 0) {
    const trimmedBaseUrl = configuredBaseUrl.trim().replace(/\/$/, '');

    try {
      const parsedUrl = new URL(trimmedBaseUrl);
      if (bundlerHost) {
        parsedUrl.hostname = bundlerHost;
        return parsedUrl.toString().replace(/\/$/, '');
      }

      return resolveConfiguredApiBaseUrl(trimmedBaseUrl);
    } catch {
      if (bundlerHost) {
        return `http://${bundlerHost}:8000`;
      }

      return trimmedBaseUrl;
    }
  }

  if (bundlerHost) {
    return `http://${bundlerHost}:8000`;
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }

  return 'http://127.0.0.1:8000';
}

export function getApiBaseUrl(): string {
  const configuredWebBaseUrl = Constants.expoConfig?.extra?.webApiBaseUrl as string | undefined;
  if (typeof document !== 'undefined') {
    if (configuredWebBaseUrl && configuredWebBaseUrl.trim().length > 0) {
      return configuredWebBaseUrl.trim().replace(/\/$/, '');
    }

    return 'http://127.0.0.1:8000';
  }

  const configuredNativeBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
  return resolveNativeApiBaseUrl(configuredNativeBaseUrl);
}

function getMessagesWebSocketUrl(userId: string): string {
  const wsBaseUrl = getApiBaseUrl().replace(/^http/i, 'ws');
  return `${wsBaseUrl}/ws/messages/${encodeURIComponent(userId)}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForApiReady(): Promise<void> {
  for (let attempt = 0; attempt < API_READY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Backend may still be starting.
    }

    if (attempt < API_READY_MAX_ATTEMPTS - 1) {
      await delay(API_READY_RETRY_MS);
    }
  }
}

async function fetchRemoteStorageItem<T>(key: string): Promise<T | null> {
  await waitForApiReady();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_STORAGE_TIMEOUT_MS);
  const response = await fetch(`${getApiBaseUrl()}/storage/${encodeURIComponent(key)}`, {
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`Remote storage read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { value: T | null };
  return payload.value ?? null;
}

async function getLocalStorageItem<T>(key: string): Promise<T | null> {
  if (memoryStorageCache.has(key)) {
    return (memoryStorageCache.get(key) as T) ?? null;
  }

  const item = await AsyncStorage.getItem(key);
  if (!item) {
    return null;
  }

  const parsedItem = JSON.parse(item) as T;
  memoryStorageCache.set(key, parsedItem);
  return parsedItem;
}

async function setLocalStorageItem<T>(key: string, value: T): Promise<void> {
  memoryStorageCache.set(key, value);
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function deleteLocalStorageItem(key: string): Promise<void> {
  memoryStorageCache.delete(key);
  await AsyncStorage.removeItem(key);
}

function isLocalOnlyStorageKey(key: string): boolean {
  return LOCAL_ONLY_STORAGE_KEYS.has(key);
}

async function ensureSharedStorageCleanup(): Promise<void> {
  if (sharedStorageCleanupCompleted) {
    return;
  }

  if (sharedStorageCleanupPromise) {
    return sharedStorageCleanupPromise;
  }

  sharedStorageCleanupPromise = (async () => {
    for (const key of SHARED_STORAGE_KEYS) {
      memoryStorageCache.delete(key);
    }
    await AsyncStorage.multiRemove(SHARED_STORAGE_KEYS);
  })();

  try {
    await sharedStorageCleanupPromise;
    sharedStorageCleanupCompleted = true;
  } finally {
    sharedStorageCleanupPromise = null;
  }
}

async function saveRemoteStorageItem<T>(key: string, value: T): Promise<void> {
  await waitForApiReady();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_STORAGE_TIMEOUT_MS);
  const response = await fetch(`${getApiBaseUrl()}/storage/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Remote storage write failed: ${response.status}`);
  }
}

async function deleteRemoteStorageItem(key: string): Promise<void> {
  await waitForApiReady();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_STORAGE_TIMEOUT_MS);
  const response = await fetch(`${getApiBaseUrl()}/storage/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Remote storage delete failed: ${response.status}`);
  }
}

async function clearRemoteStorage(): Promise<void> {
  await waitForApiReady();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_STORAGE_TIMEOUT_MS);
  const response = await fetch(`${getApiBaseUrl()}/storage`, {
    method: 'DELETE',
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Remote storage clear failed: ${response.status}`);
  }
}

function isExpectedRemoteStorageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { name?: string; message?: string };
  const message = maybeError.message?.toLowerCase() || '';

  return (
    maybeError.name === 'AbortError' ||
    message.includes('network request failed') ||
    message.includes('aborted') ||
    message.includes('timed out')
  );
}

// Generic storage functions
export async function getStorageItem<T>(key: string): Promise<T | null> {
  if (isLocalOnlyStorageKey(key)) {
    try {
      return await getLocalStorageItem<T>(key);
    } catch (error) {
      console.error(`Error reading local ${key}:`, error);
      return null;
    }
  }

  await ensureSharedStorageCleanup();

  try {
    return await fetchRemoteStorageItem<T>(key);
  } catch (error) {
    console.error(`Error reading shared ${key} from backend:`, error);
    throw error;
  }
}

export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (isLocalOnlyStorageKey(key)) {
    await setLocalStorageItem(key, value);
    return;
  }

  await ensureSharedStorageCleanup();

  try {
    await saveRemoteStorageItem(key, value);
  } catch (error) {
    console.error(`Error saving shared ${key} to backend:`, error);
    throw error;
  }
}

// User Storage
export async function saveUser(user: User): Promise<void> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  const existingIndex = users.findIndex(u => u.id === user.id);
  if (existingIndex >= 0) {
    users[existingIndex] = user;
  } else {
    users.push(user);
  }
  await setStorageItem(STORAGE_KEYS.USERS, users);
}

export async function createUserAccount(input: {
  name: string;
  email?: string;
  password: string;
  phone?: string;
  role: Exclude<UserRole, 'admin'>;
  userType: UserType;
  pillarsOfInterest: NVCSector[];
}): Promise<User> {
  const normalizedEmail = input.email?.trim().toLowerCase();
  const normalizedName = input.name.trim();
  const normalizedPassword = input.password.trim();
  const normalizedPhone = input.phone?.trim();

  if (!normalizedName || !normalizedPassword) {
    throw new Error('Name and password are required.');
  }

  if (!normalizedEmail && !normalizedPhone) {
    throw new Error('Email or phone is required.');
  }

  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  const existingEmailUser = normalizedEmail
    ? users.find(user => user.email?.trim().toLowerCase() === normalizedEmail)
    : null;
  if (existingEmailUser) {
    throw new Error('An account with this email already exists.');
  }

  const existingPhoneUser = normalizedPhone
    ? users.find(user => user.phone?.trim() === normalizedPhone)
    : null;
  if (existingPhoneUser) {
    throw new Error('An account with this phone number already exists.');
  }

  const createdAt = new Date().toISOString();
  const createdUser: User = {
    id: `user-${Date.now()}`,
    name: normalizedName,
    email: normalizedEmail,
    password: normalizedPassword,
    phone: normalizedPhone || undefined,
    role: input.role,
    userType: input.userType,
    pillarsOfInterest: input.pillarsOfInterest,
    createdAt,
  };

  await saveUser(createdUser);

  if (input.role === 'volunteer') {
    await saveVolunteer({
      id: `volunteer-${createdUser.id}`,
      userId: createdUser.id,
      name: createdUser.name,
      email: createdUser.email || '',
      phone: createdUser.phone || '',
      skills: [],
      skillsDescription: input.pillarsOfInterest.join(', '),
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
      createdAt,
    });
  }

  const savedUser = await getUser(createdUser.id);
  if (!savedUser) {
    throw new Error('Account creation did not sync correctly. Please try again.');
  }

  return createdUser;
}

export async function getUser(id: string): Promise<User | null> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  return users.find(u => u.id === id) || null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  return users.find(u => u.email?.trim().toLowerCase() === email.trim().toLowerCase()) || null;
}

export async function getUserByEmailOrPhone(identifier: string): Promise<User | null> {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  return users.find(
    u =>
      u.email?.trim().toLowerCase() === normalizedIdentifier ||
      u.phone?.trim() === identifier.trim()
  ) || null;
}

export async function getAllUsers(): Promise<User[]> {
  await ensureCoreUsers();
  return (await getStorageItem<User[]>(STORAGE_KEYS.USERS)) || [];
}

export async function deleteUser(userId: string): Promise<void> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  const filteredUsers = users.filter(user => user.id !== userId);
  await setStorageItem(STORAGE_KEYS.USERS, filteredUsers);

  const volunteers = await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS) || [];
  const removedVolunteerIds = volunteers
    .filter(volunteer => volunteer.id === userId || volunteer.userId === userId)
    .map(volunteer => volunteer.id);
  const filteredVolunteers = volunteers.filter(
    volunteer => volunteer.id !== userId && volunteer.userId !== userId
  );
  await setStorageItem(STORAGE_KEYS.VOLUNTEERS, filteredVolunteers);

  const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
  const filteredMessages = messages.filter(
    message => message.senderId !== userId && message.recipientId !== userId
  );
  await setStorageItem(STORAGE_KEYS.MESSAGES, filteredMessages);

  const partnerApplications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  const filteredPartnerApplications = partnerApplications.filter(
    application => application.partnerUserId !== userId
  );
  await setStorageItem(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS, filteredPartnerApplications);

  const volunteerJoinRecords =
    await getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS) || [];
  const filteredVolunteerJoinRecords = volunteerJoinRecords.filter(
    record =>
      record.volunteerUserId !== userId &&
      !removedVolunteerIds.includes(record.volunteerId)
  );
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS, filteredVolunteerJoinRecords);

  const projects = await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS) || [];
  const updatedProjects = projects.map(project => ({
    ...project,
    joinedUserIds: (project.joinedUserIds || []).filter(joinedId => joinedId !== userId),
    volunteers: project.volunteers.filter(
      volunteerId => !removedVolunteerIds.includes(volunteerId)
    ),
  }));
  await setStorageItem(STORAGE_KEYS.PROJECTS, updatedProjects);

  const currentUser = await getCurrentUser();
  if (currentUser?.id === userId) {
    await setCurrentUser(null);
  }
}

export async function setCurrentUser(user: User | null): Promise<void> {
  if (user) {
    await setLocalStorageItem(STORAGE_KEYS.CURRENT_USER, user);
  } else {
    await deleteLocalStorageItem(STORAGE_KEYS.CURRENT_USER);
  }
}

export async function getCurrentUser(): Promise<User | null> {
  return (await getLocalStorageItem<User>(STORAGE_KEYS.CURRENT_USER)) || null;
}

// Partner Storage
export async function savePartner(partner: Partner): Promise<void> {
  const partners = await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS) || [];
  const existingIndex = partners.findIndex(p => p.id === partner.id);
  if (existingIndex >= 0) {
    partners[existingIndex] = partner;
  } else {
    partners.push(partner);
  }
  await setStorageItem(STORAGE_KEYS.PARTNERS, partners);
}

export async function getPartner(id: string): Promise<Partner | null> {
  const partners = await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS) || [];
  return partners.find(p => p.id === id) || null;
}

export async function getAllPartners(): Promise<Partner[]> {
  await ensureCorePartners();
  const partners = (await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS)) || [];
  return partners.filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));
}

export async function getPartnersByStatus(status: string): Promise<Partner[]> {
  const partners = await getAllPartners();
  return partners.filter(p => p.status === status);
}

// Project Storage
export async function saveProject(project: Project): Promise<void> {
  const projects = await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS) || [];
  const existingIndex = projects.findIndex(p => p.id === project.id);
  if (existingIndex >= 0) {
    projects[existingIndex] = project;
  } else {
    projects.push(project);
  }
  await setStorageItem(STORAGE_KEYS.PROJECTS, projects);
}

export async function getProject(id: string): Promise<Project | null> {
  const projects = await getAllProjects();
  return projects.find(p => p.id === id) || null;
}

export async function getAllProjects(): Promise<Project[]> {
  try {
    await ensureCoreProjects();
    const storedProjects = (await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS)) || [];
    if (storedProjects.length > 0) {
      return storedProjects;
    }

    await setStorageItem(STORAGE_KEYS.PROJECTS, NEGROS_SAMPLE_PROJECTS);
    return NEGROS_SAMPLE_PROJECTS;
  } catch (error) {
    console.error('Error loading projects, falling back to defaults:', error);
    return NEGROS_SAMPLE_PROJECTS;
  }
}

export function isProjectInNegros(project: Project): boolean {
  const address = project.location.address.toLowerCase();
  const hasNegrosAddress =
    address.includes('negros occidental') ||
    address.includes('negros');
  const isWithinNegrosBounds =
    project.location.latitude >= NEGROS_OCCIDENTAL_BOUNDS.minLatitude &&
    project.location.latitude <= NEGROS_OCCIDENTAL_BOUNDS.maxLatitude &&
    project.location.longitude >= NEGROS_OCCIDENTAL_BOUNDS.minLongitude &&
    project.location.longitude <= NEGROS_OCCIDENTAL_BOUNDS.maxLongitude;

  return hasNegrosAddress || isWithinNegrosBounds;
}

export async function getNegrosProjects(): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(isProjectInNegros);
}

export async function getProjectsByStatus(status: string): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(p => p.status === status);
}

export async function getProjectsByPartner(partnerId: string): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(p => p.partnerId === partnerId);
}

// Volunteer Storage
export async function saveVolunteer(volunteer: Volunteer): Promise<void> {
  const volunteers = await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS) || [];
  const existingIndex = volunteers.findIndex(v => v.id === volunteer.id);
  if (existingIndex >= 0) {
    volunteers[existingIndex] = volunteer;
  } else {
    volunteers.push(volunteer);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEERS, volunteers);
}

export async function getVolunteer(id: string): Promise<Volunteer | null> {
  const volunteers = await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS) || [];
  return volunteers.find(v => v.id === id) || null;
}

export async function getAllVolunteers(): Promise<Volunteer[]> {
  return (await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS)) || [];
}

export async function getVolunteerByUserId(userId: string): Promise<Volunteer | null> {
  const volunteers = await getAllVolunteers();
  return volunteers.find(v => v.userId === userId) || null;
}

// Volunteer Time Logs
export async function saveVolunteerTimeLog(log: VolunteerTimeLog): Promise<void> {
  const logs = await getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS) || [];
  const existingIndex = logs.findIndex(l => l.id === log.id);
  if (existingIndex >= 0) {
    logs[existingIndex] = log;
  } else {
    logs.push(log);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_TIME_LOGS, logs);
}

export async function getVolunteerTimeLogs(volunteerId: string): Promise<VolunteerTimeLog[]> {
  const logs = await getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS) || [];
  return logs
    .filter(l => l.volunteerId === volunteerId)
    .sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime());
}

export async function startVolunteerTimeLog(
  volunteerId: string,
  projectId: string,
  note?: string
): Promise<VolunteerTimeLog> {
  const existingLogs = await getVolunteerTimeLogs(volunteerId);
  const activeLog = existingLogs.find(l => l.projectId === projectId && !l.timeOut);
  if (activeLog) {
    throw new Error('You already have an active time log for this project.');
  }

  const newLog: VolunteerTimeLog = {
    id: `timelog-${Date.now()}`,
    volunteerId,
    projectId,
    timeIn: new Date().toISOString(),
    note,
  };

  await saveVolunteerTimeLog(newLog);
  return newLog;
}

export async function endVolunteerTimeLog(
  volunteerId: string,
  projectId: string
): Promise<VolunteerTimeLog | null> {
  const logs = await getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS) || [];
  const activeIndex = logs.findIndex(
    l => l.volunteerId === volunteerId && l.projectId === projectId && !l.timeOut
  );

  if (activeIndex === -1) {
    return null;
  }

  const updatedLog: VolunteerTimeLog = {
    ...logs[activeIndex],
    timeOut: new Date().toISOString(),
  };

  logs[activeIndex] = updatedLog;
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_TIME_LOGS, logs);
  await addLoggedHoursToVolunteer(volunteerId, updatedLog);
  return updatedLog;
}

async function addLoggedHoursToVolunteer(
  volunteerId: string,
  log: VolunteerTimeLog
): Promise<void> {
  if (!log.timeOut) return;

  const volunteer = await getVolunteer(volunteerId);
  if (!volunteer) return;

  const durationHours = Math.max(
    0,
    (new Date(log.timeOut).getTime() - new Date(log.timeIn).getTime()) / 3_600_000
  );

  await saveVolunteer({
    ...volunteer,
    totalHoursContributed: parseFloat(
      (volunteer.totalHoursContributed + durationHours).toFixed(1)
    ),
    pastProjects: volunteer.pastProjects.includes(log.projectId)
      ? volunteer.pastProjects
      : [...volunteer.pastProjects, log.projectId],
  });
}

// Message Storage
export async function saveMessage(message: Message): Promise<void> {
  try {
    await waitForApiReady();
    const response = await fetch(`${getApiBaseUrl()}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`Message send failed: ${response.status}`);
    }
    notifyWebMessageUpdate();
  } catch (error) {
    if (!isExpectedRemoteStorageError(error)) {
      console.error('Error saving message:', error);
    }
    throw error;
  }
}

export async function getMessagesForUser(userId: string): Promise<Message[]> {
  try {
    await waitForApiReady();
    const response = await fetch(`${getApiBaseUrl()}/messages?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error(`Message fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as { messages: Message[] };
    return payload.messages;
  } catch (error) {
    if (!isExpectedRemoteStorageError(error)) {
      console.error('Error loading messages for user:', error);
    }
    const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
    return messages.filter(
      m => m.recipientId === userId || m.senderId === userId
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
}

export async function getConversation(userId1: string, userId2: string): Promise<Message[]> {
  try {
    await waitForApiReady();
    const response = await fetch(
      `${getApiBaseUrl()}/messages/conversation?user1=${encodeURIComponent(userId1)}&user2=${encodeURIComponent(userId2)}`
    );
    if (!response.ok) {
      throw new Error(`Conversation fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as { messages: Message[] };
    return payload.messages;
  } catch (error) {
    if (!isExpectedRemoteStorageError(error)) {
      console.error('Error loading conversation:', error);
    }
    const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
    return messages
      .filter(
        m =>
          (m.senderId === userId1 && m.recipientId === userId2) ||
          (m.senderId === userId2 && m.recipientId === userId1)
      )
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
}

export async function markMessageAsRead(messageId: string): Promise<void> {
  try {
    await waitForApiReady();
    const response = await fetch(`${getApiBaseUrl()}/messages/${encodeURIComponent(messageId)}/read`, {
      method: 'PATCH',
    });
    if (!response.ok) {
      throw new Error(`Mark read failed: ${response.status}`);
    }
    notifyWebMessageUpdate();
  } catch (error) {
    if (!isExpectedRemoteStorageError(error)) {
      console.error('Error marking message as read:', error);
    }
    const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
    const message = messages.find(m => m.id === messageId);
    if (message) {
      message.read = true;
      await setStorageItem(STORAGE_KEYS.MESSAGES, messages);
      notifyWebMessageUpdate();
    }
  }
}

export function subscribeToMessages(
  userId: string,
  onChange: (event: { type: string; message: Message }) => void
): () => void {
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const cleanupSocket = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      socket = null;
    }
  };

  const connect = () => {
    cleanupSocket();
    socket = new WebSocket(getMessagesWebSocketUrl(userId));

    socket.onopen = () => {
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send('ping');
        }
      }, 25000);
    };

    socket.onmessage = event => {
      try {
        const payload = JSON.parse(event.data) as { type: string; message: Message };
        onChange(payload);
      } catch (error) {
        console.error('Error parsing message event:', error);
      }
    };

    socket.onclose = () => {
      cleanupSocket();
      if (!closed) {
        reconnectTimer = setTimeout(connect, 1500);
      }
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    cleanupSocket();
  };
}

// Status Update Storage
export async function saveStatusUpdate(update: StatusUpdate): Promise<void> {
  const updates = await getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES) || [];
  updates.push(update);
  await setStorageItem(STORAGE_KEYS.STATUS_UPDATES, updates);
}

export async function getStatusUpdatesByProject(projectId: string): Promise<StatusUpdate[]> {
  const updates = await getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES) || [];
  return updates
    .filter(u => u.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// Volunteer Project Match Storage
export async function saveVolunteerProjectMatch(match: VolunteerProjectMatch): Promise<void> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  const existingIndex = matches.findIndex(m => m.id === match.id);
  if (existingIndex >= 0) {
    matches[existingIndex] = match;
  } else {
    matches.push(match);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_MATCHES, matches);
  await attachVolunteerToProject(match.projectId, match.volunteerId);
  if (match.status === 'Matched') {
    await ensureVolunteerProjectJoinRecord(match.projectId, match.volunteerId, 'AdminMatch');
  }
  await syncVolunteerEngagementStatus(match.volunteerId);
}

export async function getVolunteerProjectMatches(volunteerId: string): Promise<VolunteerProjectMatch[]> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  return matches.filter(m => m.volunteerId === volunteerId);
}

export async function getProjectMatches(projectId: string): Promise<VolunteerProjectMatch[]> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  return matches.filter(m => m.projectId === projectId);
}

export async function saveVolunteerProjectJoinRecord(
  record: VolunteerProjectJoinRecord
): Promise<void> {
  const records =
    await getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS) || [];
  const normalizedRecord: VolunteerProjectJoinRecord = {
    ...record,
    participationStatus: record.participationStatus || 'Active',
  };
  const existingIndex = records.findIndex(existingRecord => existingRecord.id === record.id);
  if (existingIndex >= 0) {
    records[existingIndex] = normalizedRecord;
  } else {
    records.push(normalizedRecord);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS, records);
}

export async function getVolunteerProjectJoinRecords(
  projectId: string
): Promise<VolunteerProjectJoinRecord[]> {
  const records =
    await getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS) || [];
  return records
    .filter(record => record.projectId === projectId)
    .map(record => ({
      ...record,
      participationStatus: record.participationStatus || 'Active',
    }))
    .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());
}

export async function completeVolunteerProjectParticipation(
  projectId: string,
  volunteerId: string,
  completedBy: string
): Promise<VolunteerProjectJoinRecord> {
  await ensureVolunteerProjectJoinRecord(projectId, volunteerId, 'AdminMatch');

  const records =
    await getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS) || [];
  const recordIndex = records.findIndex(
    record => record.projectId === projectId && record.volunteerId === volunteerId
  );

  if (recordIndex === -1) {
    throw new Error('Volunteer participation record not found.');
  }

  const updatedRecord: VolunteerProjectJoinRecord = {
    ...records[recordIndex],
    participationStatus: 'Completed',
    completedAt: new Date().toISOString(),
    completedBy,
  };

  records[recordIndex] = updatedRecord;
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS, records);
  await markVolunteerMatchCompleted(projectId, volunteerId);
  await addProjectToVolunteerHistory(volunteerId, projectId);
  await syncVolunteerEngagementStatus(volunteerId);
  return updatedRecord;
}

export async function savePartnerProjectApplication(
  application: PartnerProjectApplication
): Promise<void> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  const existingIndex = applications.findIndex(app => app.id === application.id);
  if (existingIndex >= 0) {
    applications[existingIndex] = application;
  } else {
    applications.push(application);
  }
  await setStorageItem(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS, applications);
}

export async function getPartnerProjectApplications(
  projectId: string
): Promise<PartnerProjectApplication[]> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  return applications
    .filter(app => app.projectId === projectId)
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

export async function getPartnerProjectApplicationsByUser(
  partnerUserId: string
): Promise<PartnerProjectApplication[]> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  return applications
    .filter(app => app.partnerUserId === partnerUserId)
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

export async function requestPartnerProjectJoin(
  projectId: string,
  partnerUser: User
): Promise<PartnerProjectApplication> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const existingApplications = await getPartnerProjectApplicationsByUser(partnerUser.id);
  const existingForProject = existingApplications.find(app => app.projectId === projectId);
  if (existingForProject) {
    return existingForProject;
  }

  const application: PartnerProjectApplication = {
    id: `partner-application-${Date.now()}`,
    projectId,
    partnerUserId: partnerUser.id,
    partnerName: partnerUser.name,
    partnerEmail: partnerUser.email || '',
    status: 'Pending',
    requestedAt: new Date().toISOString(),
  };

  await savePartnerProjectApplication(application);
  return application;
}

export async function reviewPartnerProjectApplication(
  applicationId: string,
  status: 'Approved' | 'Rejected',
  reviewedBy: string
): Promise<void> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  const applicationIndex = applications.findIndex(app => app.id === applicationId);
  if (applicationIndex === -1) {
    throw new Error('Application not found');
  }

  const application = applications[applicationIndex];
  const updatedApplication: PartnerProjectApplication = {
    ...application,
    status,
    reviewedAt: new Date().toISOString(),
    reviewedBy,
  };
  applications[applicationIndex] = updatedApplication;
  await setStorageItem(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS, applications);

  if (status === 'Approved') {
    const project = await getProject(application.projectId);
    if (!project) return;

    const joinedUserIds = project.joinedUserIds || [];
    if (!joinedUserIds.includes(application.partnerUserId)) {
      await saveProject({
        ...project,
        joinedUserIds: [...joinedUserIds, application.partnerUserId],
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

export async function joinProjectEvent(projectId: string, userId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const volunteer = await getVolunteerByUserId(userId);
  const volunteerId = volunteer?.id;
  const joinedUserIds = project.joinedUserIds || [];
  const updatedJoinedUserIds = joinedUserIds.includes(userId)
    ? joinedUserIds
    : [...joinedUserIds, userId];
  const updatedVolunteerIds =
    volunteerId && !project.volunteers.includes(volunteerId)
      ? [...project.volunteers, volunteerId]
      : project.volunteers;

  await saveProject({
    ...project,
    joinedUserIds: updatedJoinedUserIds,
    volunteers: updatedVolunteerIds,
    updatedAt: new Date().toISOString(),
  });

  if (volunteerId) {
    await ensureVolunteerProjectJoinRecord(projectId, volunteerId, 'VolunteerJoin');
    await syncVolunteerEngagementStatus(volunteerId);
  }
}

export async function getSectorNeeds(): Promise<SectorNeed[]> {
  return SECTOR_NEEDS;
}

// Clear all storage (for testing/logout)
export async function clearAllStorage(): Promise<void> {
  try {
    try {
      await clearRemoteStorage();
    } catch (error) {
        console.error('Error clearing remote storage:', error);
      }
      memoryStorageCache.clear();
      await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
}

// Initialize with mock data
export async function initializeMockData(): Promise<void> {
  if (mockDataInitializationPromise) {
    return mockDataInitializationPromise;
  }

  mockDataInitializationPromise = initializeMockDataInternal();
  try {
    await mockDataInitializationPromise;
  } finally {
    mockDataInitializationPromise = null;
  }
}

async function initializeMockDataInternal(): Promise<void> {
  const existingUsers = await getAllUsers();
  if (existingUsers.length > 0) {
    await ensureAdminProfile();
    await ensurePartnerUser();
    await ensurePartnerUsers();
    await ensureVolunteerProfile();
    await purgeDeprecatedPartners();
    await ensureCorePartners();
    await ensureCoreProjects();
    await ensureNegrosProjectData();
    await ensureVolunteerStatuses();
    await ensureAdminVolunteerConversation();
    return;
  }

  // Create mock admin and volunteer users
  const admin: User = {
    id: 'admin-1',
    email: 'admin@nvc.org',
    password: 'admin123',
    role: 'admin',
    name: 'NVC Admin Account',
    phone: '+63 917 000 0001',
    userType: 'Adult',
    pillarsOfInterest: ['Education', 'Livelihood', 'Nutrition'],
    createdAt: new Date().toISOString(),
  };

  const volunteer: User = {
    id: 'volunteer-1',
    email: 'volunteer@example.com',
    password: 'volunteer123',
    role: 'volunteer',
    name: 'Volunteer Account',
    phone: '+0987654321',
    userType: 'Student',
    pillarsOfInterest: ['Education', 'Nutrition'],
    createdAt: new Date().toISOString(),
  };

  const partnerUser: User = {
    id: 'partner-user-1',
    email: 'partner@livelihoods.org',
    password: 'partner123',
    role: 'partner',
    name: 'Partner Org Account',
    phone: '+919876543211',
    userType: 'Adult',
    pillarsOfInterest: ['Livelihood'],
    createdAt: new Date().toISOString(),
  };

  const partnerUserPbsp: User = {
    id: 'partner-user-2',
    email: 'partnerships@pbsp.org.ph',
    password: 'partner123',
    role: 'partner',
    name: 'PBSP Account',
    phone: '+63 2 8818 8678',
    userType: 'Adult',
    pillarsOfInterest: ['Education', 'Livelihood', 'Nutrition'],
    createdAt: new Date().toISOString(),
  };

  const partnerUserJfc: User = {
    id: 'partner-user-3',
    email: 'partnerships@jollibeefoundation.org',
    password: 'partner123',
    role: 'partner',
    name: 'Jollibee Foundation Account',
    phone: '+63 2 8634 1111',
    userType: 'Adult',
    pillarsOfInterest: ['Nutrition', 'Livelihood'],
    createdAt: new Date().toISOString(),
  };

  await saveUser(admin);
  await saveUser(volunteer);
  await saveUser(partnerUser);
  await saveUser(partnerUserPbsp);
  await saveUser(partnerUserJfc);

  // Mock partners
  const partners: Partner[] = [
    {
      id: 'partner-2',
      name: 'LGU Kabankalan Livelihood Office',
      description: 'LGU-led livelihood partner providing local skills training programs.',
      category: 'Livelihood',
      contactEmail: 'contact@livelihoods.org',
      contactPhone: '+919876543211',
      address: 'Kabankalan City, Negros Occidental, Philippines',
      status: 'Pending',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-3',
      name: 'Philippine Business for Social Progress',
      description: 'Private-sector led foundation focused on inclusive development and CSR programs.',
      category: 'Other',
      contactEmail: 'partnerships@pbsp.org.ph',
      contactPhone: '+63 2 8818 8678',
      address: 'Makati City, Metro Manila, Philippines',
      status: 'Approved',
      validatedBy: 'admin-1',
      validatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-4',
      name: 'Jollibee Group Foundation',
      description: 'Foundation of Jollibee Group supporting education, agriculture, and food security programs.',
      category: 'Nutrition',
      contactEmail: 'partnerships@jollibeefoundation.org',
      contactPhone: '+63 2 8634 1111',
      address: 'Pasig City, Metro Manila, Philippines',
      status: 'Approved',
      validatedBy: 'admin-1',
      validatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];

  for (const partner of partners) {
    await savePartner(partner);
  }

  await purgeDeprecatedPartners();

  // Mock projects
  const projects: Project[] = NEGROS_SAMPLE_PROJECTS;

  for (const project of projects) {
    await saveProject(project);
  }

  // Mock volunteer profile
  const volunteerProfile: Volunteer = {
    id: 'volunteer-1',
    userId: 'volunteer-1',
    name: 'Volunteer Account',
    email: 'volunteer@example.com',
    phone: '+0987654321',
    skills: ['Teaching', 'Mentoring', 'Community Outreach'],
    skillsDescription:
      'I can support reading sessions, mentor students, organize community outreach, and help with event coordination.',
    availability: {
      daysPerWeek: 3,
      hoursPerWeek: 12,
      availableDays: ['Monday', 'Wednesday', 'Saturday'],
    },
    pastProjects: [],
    totalHoursContributed: 24,
    rating: 4.5,
    engagementStatus: 'Open to Volunteer',
    background: 'Software Engineer with passion for education',
    createdAt: new Date().toISOString(),
  };

  await saveVolunteer(volunteerProfile);

  await ensureAdminVolunteerConversation();

  // Mock status updates
  const statusUpdate: StatusUpdate = {
    id: 'status-1',
    projectId: 'project-1',
    status: 'In Progress',
    description: 'Construction of library shelves completed',
    updatedBy: 'admin-1',
    updatedAt: new Date().toISOString(),
  };

  await saveStatusUpdate(statusUpdate);

  console.log('Mock data initialized successfully');
}

async function ensurePartnerUser(): Promise<void> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  const primary = users.find(u => u.id === 'partner-user-1');
  if (primary) return;

  const partnerUser: User = {
    id: 'partner-user-1',
    email: 'partner@livelihoods.org',
    password: 'partner123',
    role: 'partner',
    name: 'Partner Org Account',
    phone: '+919876543211',
    userType: 'Adult',
    pillarsOfInterest: ['Livelihood'],
    createdAt: new Date().toISOString(),
  };

  await saveUser(partnerUser);
}

async function ensurePartnerUsers(): Promise<void> {
  const requiredUsers: User[] = [
    {
      id: 'partner-user-2',
      email: 'partnerships@pbsp.org.ph',
      password: 'partner123',
      role: 'partner',
      name: 'PBSP Account',
      phone: '+63 2 8818 8678',
      userType: 'Adult',
      pillarsOfInterest: ['Education', 'Livelihood', 'Nutrition'],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-user-3',
      email: 'partnerships@jollibeefoundation.org',
      password: 'partner123',
      role: 'partner',
      name: 'Jollibee Foundation Account',
      phone: '+63 2 8634 1111',
      userType: 'Adult',
      pillarsOfInterest: ['Nutrition', 'Livelihood'],
      createdAt: new Date().toISOString(),
    },
  ];

  const existingUsers = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];

  for (const user of requiredUsers) {
    const existing = existingUsers.find(existingUser => existingUser.id === user.id);
    if (!existing) {
      await saveUser(user);
    }
  }
}

async function ensureVolunteerProfile(): Promise<void> {
  const users = await getAllUsers();
  const volunteerUser = users.find((u) => u.id === 'volunteer-1');
  if (volunteerUser && volunteerUser.name !== 'Volunteer Account') {
    await saveUser({
      ...volunteerUser,
      name: 'Volunteer Account',
    });
  }

  const volunteerProfile = await getVolunteer('volunteer-1');
  if (volunteerProfile && volunteerProfile.name !== 'Volunteer Account') {
    await saveVolunteer({
      ...volunteerProfile,
      name: 'Volunteer Account',
    });
  }

  if (volunteerProfile && !volunteerProfile.skillsDescription) {
    await saveVolunteer({
      ...volunteerProfile,
      skillsDescription: volunteerProfile.background,
    });
  }
}

async function ensureAdminProfile(): Promise<void> {
  const users = await getAllUsers();
  const adminUser = users.find((u) => u.id === 'admin-1');
  if (!adminUser) return;

  if (adminUser.name !== 'NVC Admin Account') {
    await saveUser({
      ...adminUser,
      name: 'NVC Admin Account',
    });
  }
}

async function ensureNegrosProjectData(): Promise<void> {
  const projects = await getAllProjects();

  for (const sampleProject of NEGROS_SAMPLE_PROJECTS) {
    const existingProject = projects.find((project) => project.id === sampleProject.id);

    if (!existingProject) {
      await saveProject(sampleProject);
      continue;
    }

    await saveProject({
      ...existingProject,
      title: sampleProject.title,
      description: sampleProject.description,
      partnerId: sampleProject.partnerId,
      isEvent: sampleProject.isEvent,
      status: sampleProject.status,
      category: sampleProject.category,
      startDate: sampleProject.startDate,
      endDate: sampleProject.endDate,
      location: sampleProject.location,
      volunteersNeeded: sampleProject.volunteersNeeded,
      joinedUserIds: existingProject.joinedUserIds || sampleProject.joinedUserIds || [],
      updatedAt: new Date().toISOString(),
    });
  }
}

async function ensureVolunteerStatuses(): Promise<void> {
  const volunteers = await getAllVolunteers();

  for (const volunteer of volunteers) {
    if (!volunteer.engagementStatus) {
      await saveVolunteer({
        ...volunteer,
        engagementStatus: 'Open to Volunteer',
      });
    }

    if (!volunteer.skillsDescription) {
      await saveVolunteer({
        ...volunteer,
        skillsDescription: volunteer.background,
      });
    }

    await syncVolunteerEngagementStatus(volunteer.id);
  }
}

async function attachVolunteerToProject(projectId: string, volunteerId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return;

  if (project.volunteers.includes(volunteerId)) return;

  await saveProject({
    ...project,
    volunteers: [...project.volunteers, volunteerId],
    updatedAt: new Date().toISOString(),
  });
}

async function ensureVolunteerProjectJoinRecord(
  projectId: string,
  volunteerId: string,
  source: VolunteerProjectJoinRecord['source']
): Promise<void> {
  const records =
    await getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS) || [];
  const existingRecord = records.find(
    record => record.projectId === projectId && record.volunteerId === volunteerId
  );
  if (existingRecord) {
    return;
  }

  const volunteer = await getVolunteer(volunteerId);
  if (!volunteer) {
    return;
  }

  const record: VolunteerProjectJoinRecord = {
    id: `volunteer-join-${projectId}-${volunteerId}`,
    projectId,
    volunteerId,
    volunteerUserId: volunteer.userId,
    volunteerName: volunteer.name,
    volunteerEmail: volunteer.email,
    joinedAt: new Date().toISOString(),
    source,
    participationStatus: 'Active',
  };

  await saveVolunteerProjectJoinRecord(record);
}

async function markVolunteerMatchCompleted(
  projectId: string,
  volunteerId: string
): Promise<void> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  let updated = false;

  const nextMatches = matches.map(match => {
    if (
      match.projectId === projectId &&
      match.volunteerId === volunteerId &&
      (match.status === 'Matched' || match.status === 'Requested')
    ) {
      updated = true;
      return {
        ...match,
        status: 'Completed' as const,
      };
    }
    return match;
  });

  if (updated) {
    await setStorageItem(STORAGE_KEYS.VOLUNTEER_MATCHES, nextMatches);
  }
}

async function addProjectToVolunteerHistory(
  volunteerId: string,
  projectId: string
): Promise<void> {
  const volunteer = await getVolunteer(volunteerId);
  if (!volunteer || volunteer.pastProjects.includes(projectId)) {
    return;
  }

  await saveVolunteer({
    ...volunteer,
    pastProjects: [...volunteer.pastProjects, projectId],
  });
}

async function syncVolunteerEngagementStatus(volunteerId: string): Promise<void> {
  const volunteer = await getVolunteer(volunteerId);
  if (!volunteer) return;

  const [matches, joinRecords] = await Promise.all([
    getVolunteerProjectMatches(volunteerId),
    getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
  ]);

  const hasActiveMatch = matches.some(
    match => match.status === 'Matched' || match.status === 'Requested'
  );
  const hasActiveParticipation = (joinRecords || []).some(
    record =>
      record.volunteerId === volunteerId &&
      (record.participationStatus || 'Active') === 'Active'
  );

  const nextStatus = hasActiveMatch || hasActiveParticipation ? 'Busy' : 'Open to Volunteer';

  if (volunteer.engagementStatus !== nextStatus) {
    await saveVolunteer({
      ...volunteer,
      engagementStatus: nextStatus,
    });
  }
}

async function purgeDeprecatedPartners(): Promise<void> {
  const partners = await getAllPartners();
  const filtered = partners.filter(
    p => !p.contactEmail?.toLowerCase().includes('eduindia.org')
  );
  if (filtered.length !== partners.length) {
    await setStorageItem(STORAGE_KEYS.PARTNERS, filtered);
  }
}

async function ensureCorePartners(): Promise<void> {
  const partners = (await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS)) || [];
  const byId = new Map(partners.map(p => [p.id, p]));

  const requiredPartners: Partner[] = [
    {
      id: 'partner-2',
      name: 'LGU Kabankalan Livelihood Office',
      description: 'LGU-led livelihood partner providing local skills training programs.',
      category: 'Livelihood',
      contactEmail: 'contact@livelihoods.org',
      contactPhone: '+919876543211',
      address: 'Kabankalan City, Negros Occidental, Philippines',
      status: 'Pending',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-3',
      name: 'Philippine Business for Social Progress',
      description: 'Private-sector led foundation focused on inclusive development and CSR programs.',
      category: 'Other',
      contactEmail: 'partnerships@pbsp.org.ph',
      contactPhone: '+63 2 8818 8678',
      address: 'Makati City, Metro Manila, Philippines',
      status: 'Approved',
      validatedBy: 'admin-1',
      validatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-4',
      name: 'Jollibee Group Foundation',
      description: 'Foundation of Jollibee Group supporting education, agriculture, and food security programs.',
      category: 'Nutrition',
      contactEmail: 'partnerships@jollibeefoundation.org',
      contactPhone: '+63 2 8634 1111',
      address: 'Pasig City, Metro Manila, Philippines',
      status: 'Approved',
      validatedBy: 'admin-1',
      validatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];

  let changed = false;
  for (const partner of requiredPartners) {
    if (!byId.has(partner.id)) {
      partners.push(partner);
      changed = true;
    }
  }

  if (changed) {
    await setStorageItem(STORAGE_KEYS.PARTNERS, partners);
  }
}

async function ensureCoreProjects(): Promise<void> {
  const projects = (await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS)) || [];
  const mergedProjects = NEGROS_SAMPLE_PROJECTS.map((project) => {
    const existingProject = projects.find((storedProject) => storedProject.id === project.id);
    if (!existingProject) {
      return project;
    }

    return {
      ...existingProject,
      title: project.title,
      description: project.description,
      partnerId: project.partnerId,
      isEvent: project.isEvent,
      status: project.status,
      category: project.category,
      startDate: project.startDate,
      endDate: project.endDate,
      location: project.location,
      volunteersNeeded: project.volunteersNeeded,
      updatedAt: new Date().toISOString(),
    };
  });

  const nextProjects = mergedProjects;

  if (projects.length !== nextProjects.length || projects.some((project, index) => project.id !== nextProjects[index]?.id)) {
    await setStorageItem(STORAGE_KEYS.PROJECTS, nextProjects);
    return;
  }

  const hasCanonicalDiff = nextProjects.some((project, index) => JSON.stringify(project) !== JSON.stringify(projects[index]));
  if (hasCanonicalDiff) {
    await setStorageItem(STORAGE_KEYS.PROJECTS, nextProjects);
  }
}

async function ensureCoreUsers(): Promise<void> {
  const users = (await getStorageItem<User[]>(STORAGE_KEYS.USERS)) || [];
  const byId = new Map(users.map(user => [user.id, user]));

  const requiredUsers: User[] = [
    {
      id: 'admin-1',
      email: 'admin@nvc.org',
      password: 'admin123',
      role: 'admin',
      name: 'NVC Admin Account',
      phone: '+63 917 000 0001',
      userType: 'Adult',
      pillarsOfInterest: ['Education', 'Livelihood', 'Nutrition'],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'volunteer-1',
      email: 'volunteer@example.com',
      password: 'volunteer123',
      role: 'volunteer',
      name: 'Volunteer Account',
      phone: '+0987654321',
      userType: 'Student',
      pillarsOfInterest: ['Education', 'Nutrition'],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-user-1',
      email: 'partner@livelihoods.org',
      password: 'partner123',
      role: 'partner',
      name: 'Partner Org Account',
      phone: '+919876543211',
      userType: 'Adult',
      pillarsOfInterest: ['Livelihood'],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-user-2',
      email: 'partnerships@pbsp.org.ph',
      password: 'partner123',
      role: 'partner',
      name: 'PBSP Account',
      phone: '+63 2 8818 8678',
      userType: 'Adult',
      pillarsOfInterest: ['Education', 'Livelihood', 'Nutrition'],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-user-3',
      email: 'partnerships@jollibeefoundation.org',
      password: 'partner123',
      role: 'partner',
      name: 'Jollibee Foundation Account',
      phone: '+63 2 8634 1111',
      userType: 'Adult',
      pillarsOfInterest: ['Nutrition', 'Livelihood'],
      createdAt: new Date().toISOString(),
    },
  ];

  let changed = false;
  for (const requiredUser of requiredUsers) {
    if (!byId.has(requiredUser.id)) {
      users.push(requiredUser);
      changed = true;
    }
  }

  if (changed) {
    await setStorageItem(STORAGE_KEYS.USERS, users);
  }
}

async function ensureAdminVolunteerConversation(): Promise<void> {
  const users = await getAllUsers();
  const hasAdmin = users.some(u => u.id === 'admin-1');
  const hasVolunteer = users.some(u => u.id === 'volunteer-1');
  if (!hasAdmin || !hasVolunteer) return;

  const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
  const hasAdminToVolunteer = messages.some(
    m => m.senderId === 'admin-1' && m.recipientId === 'volunteer-1'
  );
  const hasVolunteerToAdmin = messages.some(
    m => m.senderId === 'volunteer-1' && m.recipientId === 'admin-1'
  );

  const now = Date.now();
  const seeds: Message[] = [];

  if (!hasAdminToVolunteer) {
    seeds.push({
      id: `msg-seed-admin-${now}`,
      senderId: 'admin-1',
      recipientId: 'volunteer-1',
      content: 'Welcome to Volcre!',
      timestamp: new Date(now - 60_000).toISOString(),
      read: false,
    });
  }

  if (!hasVolunteerToAdmin) {
    seeds.push({
      id: `msg-seed-volunteer-${now}`,
      senderId: 'volunteer-1',
      recipientId: 'admin-1',
      content: 'Thank you! Glad to be part of the team.',
      timestamp: new Date(now - 30_000).toISOString(),
      read: false,
    });
  }

  if (seeds.length > 0) {
    await setStorageItem(STORAGE_KEYS.MESSAGES, [...messages, ...seeds]);
  }
}
