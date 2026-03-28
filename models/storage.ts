import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import {
  User,
  UserType,
  Partner,
  Project,
  Volunteer,
  Message,
  ProjectGroupMessage,
  StatusUpdate,
  VolunteerProjectMatch,
  SectorNeed,
  VolunteerTimeLog,
  PartnerProjectApplication,
  VolunteerProjectJoinRecord,
} from './types';
import { NVCSector, UserRole } from './types';

// Central frontend data layer for backend-backed data access, auth helpers, and messaging.
const STORAGE_KEYS = {
  USERS: 'users',
  CURRENT_USER: 'currentUser',
  PARTNERS: 'partners',
  PROJECTS: 'projects',
  VOLUNTEERS: 'volunteers',
  MESSAGES: 'messages',
  PROJECT_GROUP_MESSAGES: 'projectGroupMessages',
  STATUS_UPDATES: 'statusUpdates',
  VOLUNTEER_MATCHES: 'volunteerMatches',
  VOLUNTEER_TIME_LOGS: 'volunteerTimeLogs',
  VOLUNTEER_PROJECT_JOINS: 'volunteerProjectJoins',
  PARTNER_PROJECT_APPLICATIONS: 'partnerProjectApplications',
};

const WEB_MESSAGE_SYNC_KEY = 'volcre:messages:updatedAt';
const memoryStorageCache = new Map<string, unknown>();
let mockDataInitializationPromise: Promise<void> | null = null;
// Supabase-backed storage reads can exceed 2.5s on some networks.
// Keep this comfortably above the observed backend round-trip so web/mobile
// prefer shared storage instead of silently falling back to stale local cache.
const REMOTE_STORAGE_TIMEOUT_MS = 60000;
const API_HEALTH_TIMEOUT_MS = 10000;
const API_READY_RETRY_MS = 800;
const API_READY_MAX_ATTEMPTS = 6;
const LOCAL_ONLY_STORAGE_KEYS = new Set([STORAGE_KEYS.CURRENT_USER]);
const NEGROS_OCCIDENTAL_BOUNDS = {
  minLatitude: 9.85,
  maxLatitude: 11.05,
  minLongitude: 122.45,
  maxLongitude: 123.35,
};

type ProjectsScreenSnapshot = {
  projects: Project[];
  volunteerProfile: Volunteer | null;
  timeLogs: VolunteerTimeLog[];
  partnerApplications: PartnerProjectApplication[];
  volunteerJoinRecords: VolunteerProjectJoinRecord[];
};

type JoinProjectResult = {
  project: Project;
  volunteerProfile: Volunteer | null;
};

type VolunteerTimeLogMutationResult = {
  log: VolunteerTimeLog | null;
  volunteerProfile: Volunteer | null;
};

export type VolunteerRecognitionStatus = {
  joinedProgramCount: number;
  isTopVolunteer: boolean;
};

// Broadcasts a local storage timestamp so web tabs refresh message state.
function notifyWebMessageUpdate(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(WEB_MESSAGE_SYNC_KEY, String(Date.now()));
  }
}

// Generates a lightweight client-side id for newly created chat messages.
function createGeneratedMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getPrimaryAdminUser(): Promise<User | null> {
  const users = await getAllUsers();
  return users.find(candidate => candidate.role === 'admin') || null;
}

async function sendSystemMessage(
  senderId: string,
  recipientId: string,
  content: string
): Promise<void> {
  await saveMessage({
    id: createGeneratedMessageId(),
    senderId,
    recipientId,
    content,
    timestamp: new Date().toISOString(),
    read: false,
  });
}

async function notifyAdminAboutPartnerProjectJoin(
  projectId: string,
  partnerUser: Pick<User, 'id' | 'name' | 'email'>
): Promise<void> {
  const [project, adminUser] = await Promise.all([
    getProject(projectId),
    getPrimaryAdminUser(),
  ]);

  if (!project || !adminUser) {
    return;
  }

  const partnerEmail = partnerUser.email?.trim()
    ? ` (${partnerUser.email.trim()})`
    : '';

  await sendSystemMessage(
    partnerUser.id,
    adminUser.id,
    `${partnerUser.name}${partnerEmail} requested to join "${project.title}". Review it in Program Lifecycle to approve or reject.`
  );
}

async function notifyPartnerAboutProjectJoinReview(
  application: PartnerProjectApplication,
  reviewedBy: string
): Promise<void> {
  const project = await getProject(application.projectId);
  if (!project) {
    return;
  }

  const outcome =
    application.status === 'Approved'
      ? `approved your request to join "${project.title}". You can now coordinate with NVC through Messages.`
      : `rejected your request to join "${project.title}". You may contact NVC admin for clarification.`;

  await sendSystemMessage(
    reviewedBy,
    application.partnerUserId,
    `NVC Admin ${outcome}`
  );
}

async function notifyAdminAboutVolunteerProjectJoinRequest(
  projectId: string,
  volunteer: Pick<Volunteer, 'userId' | 'name' | 'email'>
): Promise<void> {
  const [project, adminUser] = await Promise.all([
    getProject(projectId),
    getPrimaryAdminUser(),
  ]);

  if (!project || !adminUser) {
    return;
  }

  const volunteerEmail = volunteer.email.trim()
    ? ` (${volunteer.email.trim()})`
    : '';

  await sendSystemMessage(
    volunteer.userId,
    adminUser.id,
    `${volunteer.name}${volunteerEmail} requested to join "${project.title}". Review it in Program Lifecycle to approve or reject.`
  );
}

async function notifyVolunteerAboutProjectMatchDecision(
  projectId: string,
  volunteerUserId: string,
  reviewedBy: string,
  decision: 'Matched' | 'Rejected',
  reason: 'request' | 'assignment'
): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    return;
  }

  const outcome =
    decision === 'Matched'
      ? reason === 'assignment'
        ? `assigned you to "${project.title}". You can now join the program and coordinate through Messages.`
        : `approved your request to join "${project.title}". You can now join the program and coordinate through Messages.`
      : `rejected your request to join "${project.title}". You may contact NVC admin for clarification.`;

  await sendSystemMessage(
    reviewedBy,
    volunteerUserId,
    `NVC Admin ${outcome}`
  );
}

// Extracts the Metro bundler host so native devices can resolve the backend URL.
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

// Normalizes a configured API base URL for the current platform.
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

// Resolves the native-device API base URL from Expo config or Metro host info.
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

// Returns the effective HTTP base URL used by the frontend storage layer.
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

// Builds the websocket URL used for user-specific message updates.
function getMessagesWebSocketUrl(userId: string): string {
  const wsBaseUrl = getApiBaseUrl().replace(/^http/i, 'ws');
  return `${wsBaseUrl}/ws/messages/${encodeURIComponent(userId)}`;
}

// Builds the websocket URL used for shared storage change notifications.
function getStorageWebSocketUrl(): string {
  const wsBaseUrl = getApiBaseUrl().replace(/^http/i, 'ws');
  return `${wsBaseUrl}/ws/storage`;
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function getApiHealthError(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${getApiBaseUrl()}/health`, {
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as
      | { detail?: string; message?: string; status?: string }
      | null;

    if (response.ok) {
      return null;
    }

    return (
      payload?.detail ||
      payload?.message ||
      `Backend health check failed with status ${response.status}.`
    );
  } catch (error) {
    if (isExpectedRemoteStorageError(error)) {
      return `Backend unavailable at ${getApiBaseUrl()}. Check the backend process and Supabase connection.`;
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return `Backend unavailable at ${getApiBaseUrl()}.`;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForApiReady(): Promise<void> {
  let lastError = `Backend unavailable at ${getApiBaseUrl()}.`;

  for (let attempt = 0; attempt < API_READY_MAX_ATTEMPTS; attempt += 1) {
    const healthError = await getApiHealthError();
    if (!healthError) {
      return;
    }
    lastError = healthError;

    if (attempt < API_READY_MAX_ATTEMPTS - 1) {
      await delay(API_READY_RETRY_MS);
    }
  }

  throw new Error(lastError);
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

async function fetchRemoteStorageItems(
  keys: string[]
): Promise<Record<string, unknown | null>> {
  await waitForApiReady();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_STORAGE_TIMEOUT_MS);
  const response = await fetch(`${getApiBaseUrl()}/storage/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ keys }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Remote storage batch read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { items?: Record<string, unknown | null> };
  return payload.items || {};
}

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === 'string' && payload.detail.trim()) {
      return payload.detail;
    }
  } catch {
    // Ignore parse errors and fall back to the default message.
  }

  return fallback;
}

async function requestApiJson<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = REMOTE_STORAGE_TIMEOUT_MS
): Promise<T> {
  await waitForApiReady();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        await getApiErrorMessage(response, `API request failed: ${response.status}`)
      );
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function getLocalStorageItem<T>(key: string): Promise<T | null> {
  return (memoryStorageCache.get(key) as T) ?? null;
}

async function setLocalStorageItem<T>(key: string, value: T): Promise<void> {
  memoryStorageCache.set(key, value);
}

async function deleteLocalStorageItem(key: string): Promise<void> {
  memoryStorageCache.delete(key);
}

// Marks keys that should remain local instead of syncing through shared backend storage.
function isLocalOnlyStorageKey(key: string): boolean {
  return LOCAL_ONLY_STORAGE_KEYS.has(key);
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

// Filters expected network and backend errors from real application exceptions.
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
// Reads one storage value from the backend or local cache.
export async function getStorageItem<T>(key: string): Promise<T | null> {
  if (isLocalOnlyStorageKey(key)) {
    try {
      return await getLocalStorageItem<T>(key);
    } catch (error) {
      console.error(`Error reading local ${key}:`, error);
      return null;
    }
  }

  try {
    return await fetchRemoteStorageItem<T>(key);
  } catch (error) {
    console.error(`Error reading shared ${key} from backend:`, error);
    throw error;
  }
}

// Reads multiple storage values in a single backend request when possible.
export async function getStorageItems(
  keys: string[]
): Promise<Record<string, unknown | null>> {
  const localKeys = keys.filter(isLocalOnlyStorageKey);
  const sharedKeys = keys.filter(key => !isLocalOnlyStorageKey(key));
  const results: Record<string, unknown | null> = {};

  for (const key of localKeys) {
    try {
      results[key] = await getLocalStorageItem(key);
    } catch (error) {
      console.error(`Error reading local ${key}:`, error);
      results[key] = null;
    }
  }

  if (sharedKeys.length === 0) {
    return results;
  }

  try {
    const remoteResults = await fetchRemoteStorageItems(sharedKeys);
    for (const key of sharedKeys) {
      results[key] = remoteResults[key] ?? null;
    }
    return results;
  } catch (error) {
    console.error(`Error reading shared storage batch from backend:`, error);
    throw error;
  }
}

// Loads the combined data set required by the admin dashboard screen.
export async function getDashboardSnapshot(): Promise<{
  projects: Project[];
  partners: Partner[];
  users: User[];
  volunteers: Volunteer[];
  statusUpdates: StatusUpdate[];
}> {
  const items = await getStorageItems([
    STORAGE_KEYS.USERS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.PARTNERS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.STATUS_UPDATES,
  ]);

  const partners = ((items[STORAGE_KEYS.PARTNERS] as Partner[] | null) || [])
    .filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));

  return {
    users: (items[STORAGE_KEYS.USERS] as User[] | null) || [],
    projects: (items[STORAGE_KEYS.PROJECTS] as Project[] | null) || [],
    partners,
    volunteers: (items[STORAGE_KEYS.VOLUNTEERS] as Volunteer[] | null) || [],
    statusUpdates: (items[STORAGE_KEYS.STATUS_UPDATES] as StatusUpdate[] | null) || [],
  };
}

// Loads the combined data set required by the partner dashboard screen.
export async function getPartnerDashboardSnapshot(): Promise<{
  projects: Project[];
  partners: Partner[];
  sectorNeeds: SectorNeed[];
}> {
  await ensurePartnerOwnershipLinks();
  const items = await getStorageItems([
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.PARTNERS,
  ]);

  const partners = ((items[STORAGE_KEYS.PARTNERS] as Partner[] | null) || [])
    .filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));

  return {
    projects: (items[STORAGE_KEYS.PROJECTS] as Project[] | null) || [],
    partners,
    sectorNeeds: [],
  };
}

// Loads the combined project, volunteer, and application data for the projects screen.
export async function getProjectsScreenSnapshot(
  user?: Pick<User, 'id' | 'role'> | null
): Promise<ProjectsScreenSnapshot> {
  const params = new URLSearchParams();
  if (user?.id) {
    params.set('user_id', user.id);
  }
  if (user?.role) {
    params.set('role', user.role);
  }

  const query = params.toString();
  const payload = await requestApiJson<Partial<ProjectsScreenSnapshot>>(
    `/projects/snapshot${query ? `?${query}` : ''}`
  );

  return {
    projects: payload.projects || [],
    volunteerProfile: payload.volunteerProfile || null,
    timeLogs: payload.timeLogs || [],
    partnerApplications: payload.partnerApplications || [],
    volunteerJoinRecords: payload.volunteerJoinRecords || [],
  };
}

// Writes one storage value to the backend and local cache.
export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (isLocalOnlyStorageKey(key)) {
    await setLocalStorageItem(key, value);
    return;
  }

  try {
    await saveRemoteStorageItem(key, value);
  } catch (error) {
    console.error(`Error saving shared ${key} to backend:`, error);
    throw error;
  }
}

// User Storage
// Inserts or updates a user record inside shared storage.
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

// Creates a new sign-in account and optional volunteer profile records.
export async function createUserAccount(input: {
  name: string;
  email?: string;
  password: string;
  phone?: string;
  role: Exclude<UserRole, 'admin'>;
  userType: UserType;
  pillarsOfInterest: NVCSector[];
  volunteerMembershipSheet?: {
    gender: string;
    dateOfBirth: string;
    civilStatus: string;
    homeAddress: string;
    occupation: string;
    workplaceOrSchool: string;
    collegeCourse?: string;
    certificationsOrTrainings?: string;
    hobbiesAndInterests?: string;
    specialSkills?: string;
    affiliations?: Array<{
      organization: string;
      position: string;
    }>;
  };
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
      gender: input.volunteerMembershipSheet?.gender || '',
      dateOfBirth: input.volunteerMembershipSheet?.dateOfBirth || '',
      civilStatus: input.volunteerMembershipSheet?.civilStatus || '',
      homeAddress: input.volunteerMembershipSheet?.homeAddress || '',
      occupation: input.volunteerMembershipSheet?.occupation || '',
      workplaceOrSchool: input.volunteerMembershipSheet?.workplaceOrSchool || '',
      collegeCourse: input.volunteerMembershipSheet?.collegeCourse || '',
      certificationsOrTrainings:
        input.volunteerMembershipSheet?.certificationsOrTrainings || '',
      hobbiesAndInterests: input.volunteerMembershipSheet?.hobbiesAndInterests || '',
      specialSkills: input.volunteerMembershipSheet?.specialSkills || '',
      affiliations: input.volunteerMembershipSheet?.affiliations || [],
      createdAt,
    });
  }

  const savedUser = await getUser(createdUser.id);
  if (!savedUser) {
    throw new Error('Account creation did not sync correctly. Please try again.');
  }

  return createdUser;
}

// Looks up a single user by id.
export async function getUser(id: string): Promise<User | null> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  return users.find(u => u.id === id) || null;
}

// Looks up a single user by email address.
export async function getUserByEmail(email: string): Promise<User | null> {
  return getUserByEmailOrPhone(email);
}

// Looks up a single user by email address or phone number.
export async function getUserByEmailOrPhone(identifier: string): Promise<User | null> {
  const payload = await requestApiJson<{ user?: User | null }>(
    `/users/lookup?identifier=${encodeURIComponent(identifier.trim())}`
  );
  return payload.user || null;
}

// Validates login credentials against the shared user list.
export async function loginWithCredentials(
  identifier: string,
  password: string
): Promise<User | null> {
  try {
    const payload = await requestApiJson<{ user?: User | null }>('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier: identifier.trim(),
        password: password.trim(),
      }),
    });
    return payload.user || null;
  } catch (error: any) {
    if (error?.message === 'Invalid email/phone or password.') {
      return null;
    }
    throw error;
  }
}

// Returns all user accounts from shared storage.
export async function getAllUsers(): Promise<User[]> {
  return (await getStorageItem<User[]>(STORAGE_KEYS.USERS)) || [];
}

// Deletes a user account and related volunteer data when necessary.
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

  const projectGroupMessages =
    await getStorageItem<ProjectGroupMessage[]>(STORAGE_KEYS.PROJECT_GROUP_MESSAGES) || [];
  const filteredProjectGroupMessages = projectGroupMessages.filter(
    message => message.senderId !== userId
  );
  await setStorageItem(STORAGE_KEYS.PROJECT_GROUP_MESSAGES, filteredProjectGroupMessages);

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

// Persists the currently signed-in user in local-only storage.
export async function setCurrentUser(user: User | null): Promise<void> {
  if (user) {
    await setLocalStorageItem(STORAGE_KEYS.CURRENT_USER, user);
  } else {
    await deleteLocalStorageItem(STORAGE_KEYS.CURRENT_USER);
  }
}

// Restores the currently signed-in user from local-only storage.
export async function getCurrentUser(): Promise<User | null> {
  return (await getLocalStorageItem<User>(STORAGE_KEYS.CURRENT_USER)) || null;
}

// Partner Storage
// Inserts or updates a partner organization record.
export async function savePartner(partner: Partner): Promise<void> {
  const partners = await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS) || [];
  const existingIndex = partners.findIndex(p => p.id === partner.id);
  const existingPartner = existingIndex >= 0 ? partners[existingIndex] : null;

  let ownerUserId = partner.ownerUserId || existingPartner?.ownerUserId;
  if (!ownerUserId && partner.contactEmail.trim()) {
    const users = await getAllUsers();
    ownerUserId = users.find(user =>
      user.role === 'partner' &&
      user.email?.toLowerCase() === partner.contactEmail.trim().toLowerCase()
    )?.id;
  }

  const normalizedPartner: Partner = {
    ...partner,
    ownerUserId,
  };

  if (existingIndex >= 0) {
    partners[existingIndex] = normalizedPartner;
  } else {
    partners.push(normalizedPartner);
  }
  await setStorageItem(STORAGE_KEYS.PARTNERS, partners);
}

// Looks up a single partner organization by id.
export async function getPartner(id: string): Promise<Partner | null> {
  const partners = await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS) || [];
  return partners.find(p => p.id === id) || null;
}

// Returns all partner organization records.
export async function getAllPartners(): Promise<Partner[]> {
  await ensurePartnerOwnershipLinks();
  const partners = (await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS)) || [];
  return partners.filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));
}

// Returns partner organization records filtered by approval status.
export async function getPartnersByStatus(status: string): Promise<Partner[]> {
  const partners = await getAllPartners();
  return partners.filter(p => p.status === status);
}

// Project Storage
// Inserts or updates a project or event record.
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

// Deletes a project and cleans up dependent records that reference it.
export async function deleteProject(projectId: string): Promise<void> {
  const [
    projects,
    statusUpdates,
    partnerApplications,
    volunteerJoinRecords,
    volunteerTimeLogs,
    projectGroupMessages,
  ] =
    await Promise.all([
      getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS),
      getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES),
      getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS),
      getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
      getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS),
      getStorageItem<ProjectGroupMessage[]>(STORAGE_KEYS.PROJECT_GROUP_MESSAGES),
    ]);

  await Promise.all([
    setStorageItem(
      STORAGE_KEYS.PROJECTS,
      (projects || []).filter(project => project.id !== projectId)
    ),
    setStorageItem(
      STORAGE_KEYS.STATUS_UPDATES,
      (statusUpdates || []).filter(update => update.projectId !== projectId)
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
      (partnerApplications || []).filter(application => application.projectId !== projectId)
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
      (volunteerJoinRecords || []).filter(record => record.projectId !== projectId)
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
      (volunteerTimeLogs || []).filter(log => log.projectId !== projectId)
    ),
    setStorageItem(
      STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
      (projectGroupMessages || []).filter(message => message.projectId !== projectId)
    ),
  ]);
}

// Looks up a single project by id.
export async function getProject(id: string): Promise<Project | null> {
  const projects = await getAllProjects();
  return projects.find(p => p.id === id) || null;
}

// Returns all projects and events from shared storage.
export async function getAllProjects(): Promise<Project[]> {
  return (await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS)) || [];
}

// Checks whether a project's coordinates fall inside Negros Occidental bounds.
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

// Returns projects that fall inside the Negros map bounds.
export async function getNegrosProjects(): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(isProjectInNegros);
}

// Returns projects filtered by lifecycle status.
export async function getProjectsByStatus(status: string): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(p => p.status === status);
}

// Returns projects owned by a specific partner organization.
export async function getProjectsByPartner(partnerId: string): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(p => p.partnerId === partnerId);
}

// Volunteer Storage
// Inserts or updates a volunteer profile record.
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

// Looks up a single volunteer profile by id.
export async function getVolunteer(id: string): Promise<Volunteer | null> {
  const volunteers = await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS) || [];
  return volunteers.find(v => v.id === id) || null;
}

// Returns all volunteer profiles from shared storage.
export async function getAllVolunteers(): Promise<Volunteer[]> {
  return (await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS)) || [];
}

// Looks up the volunteer profile linked to a specific user account.
export async function getVolunteerByUserId(userId: string): Promise<Volunteer | null> {
  const payload = await requestApiJson<{ volunteer?: Volunteer | null }>(
    `/volunteers/by-user/${encodeURIComponent(userId)}`
  );
  return payload.volunteer || null;
}

// Computes recognition metrics such as joined programs and top-volunteer status.
export async function getVolunteerRecognitionStatus(
  volunteerId: string
): Promise<VolunteerRecognitionStatus> {
  const payload = await requestApiJson<{ recognition?: Partial<VolunteerRecognitionStatus> | null }>(
    `/volunteers/${encodeURIComponent(volunteerId)}/recognition`
  );

  return {
    joinedProgramCount: payload.recognition?.joinedProgramCount || 0,
    isTopVolunteer: Boolean(payload.recognition?.isTopVolunteer),
  };
}

// Volunteer Time Logs
// Inserts or updates a volunteer time log entry.
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

// Returns all time log entries for one volunteer profile.
export async function getVolunteerTimeLogs(volunteerId: string): Promise<VolunteerTimeLog[]> {
  const payload = await requestApiJson<{ logs?: VolunteerTimeLog[] }>(
    `/volunteers/${encodeURIComponent(volunteerId)}/time-logs`
  );
  return payload.logs || [];
}

// Starts a volunteer time log for the selected project.
export async function startVolunteerTimeLog(
  volunteerId: string,
  projectId: string,
  note?: string
): Promise<VolunteerTimeLog> {
  const payload = await requestApiJson<{ log?: VolunteerTimeLog | null }>(
    `/volunteers/${encodeURIComponent(volunteerId)}/time-logs/start`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        note,
      }),
    }
  );

  if (!payload.log) {
    throw new Error('Time in did not complete.');
  }

  return payload.log;
}

// Ends an active volunteer time log and updates contributed hours.
export async function endVolunteerTimeLog(
  volunteerId: string,
  projectId: string
): Promise<VolunteerTimeLogMutationResult> {
  const payload = await requestApiJson<Partial<VolunteerTimeLogMutationResult>>(
    `/volunteers/${encodeURIComponent(volunteerId)}/time-logs/end`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId }),
    }
  );

  return {
    log: payload.log || null,
    volunteerProfile: payload.volunteerProfile || null,
  };
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
  });
}

// Message Storage
// Persists a direct user-to-user message and triggers refresh notifications.
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
      throw new Error(
        await getApiErrorMessage(response, `Message send failed: ${response.status}`)
      );
    }
    notifyWebMessageUpdate();
  } catch (error) {
    if (!isExpectedRemoteStorageError(error)) {
      console.error('Error saving message:', error);
    }
    throw error;
  }
}

// Persists a project group chat message and triggers refresh notifications.
export async function saveProjectGroupMessage(message: ProjectGroupMessage): Promise<void> {
  try {
    await waitForApiReady();
    const response = await fetch(
      `${getApiBaseUrl()}/projects/${encodeURIComponent(message.projectId)}/group-messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );
    if (!response.ok) {
      throw new Error(
        await getApiErrorMessage(response, `Group message send failed: ${response.status}`)
      );
    }
    notifyWebMessageUpdate();
  } catch (error) {
    if (!isExpectedRemoteStorageError(error)) {
      console.error('Error saving project group message:', error);
    }
    throw error;
  }
}

// Returns all direct messages relevant to a specific user.
export async function getMessagesForUser(userId: string): Promise<Message[]> {
  const payload = await requestApiJson<{ messages?: Message[] }>(
    `/messages?user_id=${encodeURIComponent(userId)}`
  );
  return payload.messages || [];
}

// Returns the direct-message history between two users.
export async function getConversation(userId1: string, userId2: string): Promise<Message[]> {
  const payload = await requestApiJson<{ messages?: Message[] }>(
    `/messages/conversation?user1=${encodeURIComponent(userId1)}&user2=${encodeURIComponent(userId2)}`
  );
  return payload.messages || [];
}

// Returns the project group chat history available to a specific user.
export async function getProjectGroupMessages(
  projectId: string,
  userId: string
): Promise<ProjectGroupMessage[]> {
  const payload = await requestApiJson<{ messages?: ProjectGroupMessage[] }>(
    `/projects/${encodeURIComponent(projectId)}/group-messages?user_id=${encodeURIComponent(userId)}`
  );
  return payload.messages || [];
}

// Marks a direct message as read and updates storage listeners.
export async function markMessageAsRead(messageId: string): Promise<void> {
  await requestApiJson(
    `/messages/${encodeURIComponent(messageId)}/read`,
    { method: 'PATCH' }
  );
  notifyWebMessageUpdate();
}

export type MessageSubscriptionEvent =
  | { type: 'message.changed'; message: Message }
  | { type: 'project-group-message.changed'; message: ProjectGroupMessage };

// Opens a realtime websocket subscription for direct and project chat updates.
export function subscribeToMessages(
  userId: string,
  onChange: (event: MessageSubscriptionEvent) => void
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
        const payload = JSON.parse(event.data) as MessageSubscriptionEvent;
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

// Opens a realtime websocket subscription for shared storage changes.
export function subscribeToStorageChanges(
  keys: string[],
  onChange: (event: { type: string; keys: string[] }) => void,
  pollIntervalMs = 1000
): () => void {
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const watchedKeys = new Set(keys);
  const watchedKeyList = Array.from(watchedKeys);

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = () => {
    if (pollTimer) {
      return;
    }

    pollTimer = setInterval(() => {
      onChange({ type: 'storage.poll', keys: watchedKeyList });
    }, pollIntervalMs);
  };

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
    startPolling();
    socket = new WebSocket(getStorageWebSocketUrl());

    socket.onopen = () => {
      stopPolling();
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send('ping');
        }
      }, 25000);
      onChange({ type: 'storage.connected', keys: watchedKeyList });
    };

    socket.onmessage = event => {
      try {
        const payload = JSON.parse(event.data) as { type: string; keys?: string[] };
        const changedKeys = payload.keys || [];
        if (payload.type !== 'storage.changed') {
          return;
        }
        if (changedKeys.some(key => watchedKeys.has(key))) {
          onChange({ type: payload.type, keys: changedKeys });
        }
      } catch (error) {
        console.error('Error parsing storage event:', error);
      }
    };

    socket.onclose = () => {
      cleanupSocket();
      startPolling();
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
    stopPolling();
    cleanupSocket();
  };
}

// Status Update Storage
// Persists a lifecycle status update for a project.
export async function saveStatusUpdate(update: StatusUpdate): Promise<void> {
  const updates = await getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES) || [];
  updates.push(update);
  await setStorageItem(STORAGE_KEYS.STATUS_UPDATES, updates);
}

// Returns lifecycle status updates for a single project.
export async function getStatusUpdatesByProject(projectId: string): Promise<StatusUpdate[]> {
  const updates = await getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES) || [];
  return updates
    .filter(u => u.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// Volunteer Project Match Storage
// Persists a volunteer-to-project match or request record.
export async function saveVolunteerProjectMatch(match: VolunteerProjectMatch): Promise<void> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  const existingIndex = matches.findIndex(
    existingMatch =>
      existingMatch.id === match.id ||
      (
        existingMatch.projectId === match.projectId &&
        existingMatch.volunteerId === match.volunteerId
      )
  );
  if (existingIndex >= 0) {
    matches[existingIndex] = match;
  } else {
    matches.push(match);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_MATCHES, matches);
  if (match.status === 'Matched') {
    await attachVolunteerToProject(match.projectId, match.volunteerId);
  }
  await syncVolunteerEngagementStatus(match.volunteerId);
}

// Returns match records for one volunteer profile.
export async function getVolunteerProjectMatches(volunteerId: string): Promise<VolunteerProjectMatch[]> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  return matches
    .filter(m => m.volunteerId === volunteerId)
    .sort((a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime());
}

// Returns every volunteer-project match record in storage.
export async function getAllVolunteerProjectMatches(): Promise<VolunteerProjectMatch[]> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  return matches.sort((a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime());
}

// Returns volunteer match records filtered by project id.
export async function getProjectMatches(projectId: string): Promise<VolunteerProjectMatch[]> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  return matches
    .filter(m => m.projectId === projectId)
    .sort((a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime());
}

// Creates a volunteer join request that an admin can review later.
export async function requestVolunteerProjectJoin(
  projectId: string,
  userId: string
): Promise<VolunteerProjectMatch> {
  const [project, volunteer] = await Promise.all([
    getProject(projectId),
    getVolunteerByUserId(userId),
  ]);

  if (!project) {
    throw new Error('Project not found.');
  }

  if (!volunteer) {
    throw new Error('Volunteer profile not found.');
  }

  const existingMatches = await getVolunteerProjectMatches(volunteer.id);
  const existingMatch = existingMatches.find(match => match.projectId === projectId) || null;

  if (existingMatch?.status === 'Matched') {
    throw new Error('You are already approved for this program.');
  }

  if (existingMatch?.status === 'Requested') {
    throw new Error('Your join request is already pending admin approval.');
  }

  if (existingMatch?.status === 'Completed') {
    throw new Error('You have already completed this program.');
  }

  const requestedMatch: VolunteerProjectMatch = {
    id: existingMatch?.id || `match-${Date.now()}`,
    volunteerId: volunteer.id,
    projectId,
    status: 'Requested',
    matchedAt: new Date().toISOString(),
    hoursContributed: existingMatch?.hoursContributed || 0,
  };

  await saveVolunteerProjectMatch(requestedMatch);

  try {
    await notifyAdminAboutVolunteerProjectJoinRequest(projectId, volunteer);
  } catch (error) {
    console.error('Error notifying admin about volunteer join request:', error);
  }

  return requestedMatch;
}

// Approves or rejects a volunteer join request.
export async function reviewVolunteerProjectMatch(
  matchId: string,
  nextStatus: 'Matched' | 'Rejected',
  reviewedBy: string
): Promise<VolunteerProjectMatch> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  const existingMatch = matches.find(match => match.id === matchId) || null;

  if (!existingMatch) {
    throw new Error('Volunteer request not found.');
  }

  const volunteer = await getVolunteer(existingMatch.volunteerId);
  if (!volunteer) {
    throw new Error('Volunteer not found.');
  }

  const updatedMatch: VolunteerProjectMatch = {
    ...existingMatch,
    status: nextStatus,
    matchedAt: new Date().toISOString(),
  };

  await saveVolunteerProjectMatch(updatedMatch);
  if (nextStatus === 'Matched') {
    await ensureVolunteerProjectJoinRecord(updatedMatch.projectId, updatedMatch.volunteerId, 'VolunteerJoin');
  }

  try {
    await notifyVolunteerAboutProjectMatchDecision(
      updatedMatch.projectId,
      volunteer.userId,
      reviewedBy,
      nextStatus,
      'request'
    );
  } catch (error) {
    console.error('Error notifying volunteer about request review:', error);
  }

  return updatedMatch;
}

// Immediately assigns a volunteer to a project on behalf of an admin.
export async function assignVolunteerToProject(
  projectId: string,
  volunteerId: string,
  assignedBy: string
): Promise<VolunteerProjectMatch> {
  const [project, volunteer, existingMatches] = await Promise.all([
    getProject(projectId),
    getVolunteer(volunteerId),
    getVolunteerProjectMatches(volunteerId),
  ]);

  if (!project) {
    throw new Error('Project not found.');
  }

  if (!volunteer) {
    throw new Error('Volunteer not found.');
  }

  const existingMatch = existingMatches.find(match => match.projectId === projectId) || null;
  if (existingMatch?.status === 'Matched') {
    throw new Error('Volunteer is already assigned to this program.');
  }

  if (existingMatch?.status === 'Completed') {
    throw new Error('Volunteer already completed this program.');
  }

  const assignedMatch: VolunteerProjectMatch = {
    id: existingMatch?.id || `match-${Date.now()}`,
    volunteerId,
    projectId,
    status: 'Matched',
    matchedAt: new Date().toISOString(),
    hoursContributed: existingMatch?.hoursContributed || 0,
  };

  await saveVolunteerProjectMatch(assignedMatch);
  await ensureVolunteerProjectJoinRecord(projectId, volunteerId, 'AdminMatch');

  try {
    await notifyVolunteerAboutProjectMatchDecision(
      projectId,
      volunteer.userId,
      assignedBy,
      'Matched',
      'assignment'
    );
  } catch (error) {
    console.error('Error notifying volunteer about assignment:', error);
  }

  return assignedMatch;
}

// Persists the record that tracks a volunteer's actual participation in a project.
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

// Returns joined-volunteer records for a single project.
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

// Returns project ids that a volunteer has already completed.
export async function getVolunteerCompletedProjectIds(
  volunteerId: string
): Promise<string[]> {
  const [volunteer, records] = await Promise.all([
    getVolunteer(volunteerId),
    getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
  ]);

  const completedProjectIdsFromProfile = volunteer?.pastProjects || [];
  const completedJoinRecords = (records || [])
    .filter(
      record =>
        record.volunteerId === volunteerId &&
        (record.participationStatus || 'Active') === 'Completed'
    )
    .sort((a, b) => {
      const left = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const right = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return right - left;
    });

  return Array.from(
    new Set([
      ...completedJoinRecords.map(record => record.projectId),
      ...completedProjectIdsFromProfile,
    ])
  );
}

// Marks a volunteer's project participation as completed and updates derived state.
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

// Persists a partner application to join a project or event.
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

// Returns partner applications for a specific project.
export async function getPartnerProjectApplications(
  projectId: string
): Promise<PartnerProjectApplication[]> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  return applications
    .filter(app => app.projectId === projectId)
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

// Returns partner applications submitted by a specific partner account.
export async function getPartnerProjectApplicationsByUser(
  partnerUserId: string
): Promise<PartnerProjectApplication[]> {
  const payload = await requestApiJson<{ applications?: PartnerProjectApplication[] }>(
    `/partner-project-applications/by-user/${encodeURIComponent(partnerUserId)}`
  );
  return payload.applications || [];
}

// Creates a partner join request for admin review.
export async function requestPartnerProjectJoin(
  projectId: string,
  partnerUser: User
): Promise<PartnerProjectApplication> {
  const payload = await requestApiJson<{ application?: PartnerProjectApplication | null }>(
    '/partner-project-applications/request',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        partnerUserId: partnerUser.id,
        partnerName: partnerUser.name,
        partnerEmail: partnerUser.email || '',
      }),
    }
  );

  if (!payload.application) {
    throw new Error('Partner join request did not complete.');
  }

  try {
    await notifyAdminAboutPartnerProjectJoin(projectId, partnerUser);
  } catch (error) {
    console.error('Error notifying admin about partner join request:', error);
  }

  return payload.application;
}

// Approves or rejects a partner join request.
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

  try {
    await notifyPartnerAboutProjectJoinReview(updatedApplication, reviewedBy);
  } catch (error) {
    console.error('Error notifying partner about application review:', error);
  }
}

// Adds a user directly to a project or event once access has been approved.
export async function joinProjectEvent(
  projectId: string,
  userId: string
): Promise<JoinProjectResult> {
  const payload = await requestApiJson<Partial<JoinProjectResult>>(
    `/projects/${encodeURIComponent(projectId)}/join`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    }
  );

  if (!payload.project) {
    throw new Error('Project join did not complete.');
  }

  return {
    project: payload.project,
    volunteerProfile: payload.volunteerProfile || null,
  };
}

// Returns the static sector-need cards shown in partner dashboards.
export async function getSectorNeeds(): Promise<SectorNeed[]> {
  return [];
}

// Clear all storage (for testing/logout)
// Clears all shared storage collections and resets local caches.
export async function clearAllStorage(): Promise<void> {
  try {
    try {
      await clearRemoteStorage();
    } catch (error) {
        console.error('Error clearing remote storage:', error);
      }
      memoryStorageCache.clear();
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
}

// Initialize with mock data
// Triggers the backend bootstrap so login demo accounts are seeded from the database layer.
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
  await requestApiJson('/bootstrap', {
    method: 'POST',
  });
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
      match.status === 'Matched'
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
    match => match.status === 'Matched'
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

// Normalizes phone numbers so credentials can be compared consistently.
function normalizeComparablePhone(value?: string): string {
  return (value || '').replace(/\D/g, '');
}

async function ensurePartnerOwnershipLinks(): Promise<void> {
  const [partners, users] = await Promise.all([
    getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS),
    getStorageItem<User[]>(STORAGE_KEYS.USERS),
  ]);

  if (!partners?.length || !users?.length) {
    return;
  }

  let changed = false;
  const nextPartners = partners.map(partner => {
    if (partner.ownerUserId) {
      return partner;
    }

    const partnerEmail = partner.contactEmail.trim().toLowerCase();
    const partnerPhone = normalizeComparablePhone(partner.contactPhone);

    const matchedUser = users.find(user => {
      if (user.role !== 'partner') {
        return false;
      }

      if (partnerEmail && user.email?.toLowerCase() === partnerEmail) {
        return true;
      }

      return Boolean(
        partnerPhone &&
        normalizeComparablePhone(user.phone) === partnerPhone
      );
    });

    if (!matchedUser) {
      return partner;
    }

    changed = true;
    return {
      ...partner,
      ownerUserId: matchedUser.id,
    };
  });

  if (changed) {
    await setStorageItem(STORAGE_KEYS.PARTNERS, nextPartners);
  }
}

