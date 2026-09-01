import Constants from 'expo-constants';
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAbortLikeError } from '../utils/requestErrors';

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}
import {
  AdminPlanningCalendar,
  AdminPlanningItem,
  AdvocacyFocus,
  AppSettings,
  ImpactHubReportType,
  PartnerReport,
  PartnerReportType,
  PartnerSectorType,
  User,
  UserType,
  Partner,
  Project,
  ProjectInternalTask,
  Volunteer,
  Message,
  ProjectGroupMessage,
  StatusUpdate,
  VolunteerProjectMatch,
  VolunteerTimeLog,
  PartnerProjectApplication,
  PartnerProjectProposalDetails,
  ProgramTrack,
  VolunteerProjectJoinRecord,
} from './types';
import { NVCSector, UserRole } from './types';

// Central frontend data layer for backend-backed data access, auth helpers, and messaging.
const STORAGE_KEYS = {
  USERS: 'users',
  CURRENT_USER: 'currentUser',
  PARTNERS: 'partners',
  PROJECTS: 'projects',
  PROGRAMS: 'programs',
  EVENTS: 'events',
  VOLUNTEERS: 'volunteers',
  MESSAGES: 'messages',
  PROJECT_GROUP_MESSAGES: 'projectGroupMessages',
  STATUS_UPDATES: 'statusUpdates',
  VOLUNTEER_MATCHES: 'volunteerMatches',
  VOLUNTEER_TIME_LOGS: 'volunteerTimeLogs',
  VOLUNTEER_PROJECT_JOINS: 'volunteerProjectJoins',
  PARTNER_PROJECT_APPLICATIONS: 'partnerProjectApplications',
  PARTNER_REPORTS: 'partnerReports',
  ADMIN_PLANNING_CALENDARS: 'adminPlanningCalendars',
  PROGRAM_TRACKS: 'programTracks',
  APP_SETTINGS: 'appSettings',
};

const WEB_MESSAGE_SYNC_KEY = 'volcre:messages:updatedAt';
export const DEFAULT_APP_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  autoRefreshEnabled: true,
  compactDashboard: false,
  approvalConfirmations: true,
  showProgramContext: true,
  startupScreen: 'Dashboard',
  customBackendUrl: '',
};

// Runtime override for the backend URL — loaded from AsyncStorage at app start.
// When set (e.g. to an ngrok URL), this takes priority over the baked-in APK URL.
let _runtimeCustomBackendUrl: string | null = null;

export function setRuntimeBackendUrl(url: string | null): void {
  _runtimeCustomBackendUrl = url && url.trim() ? url.trim().replace(/\/$/, '') : null;
}

export function getRuntimeBackendUrl(): string | null {
  return _runtimeCustomBackendUrl;
}

const memoryStorageCache = new Map<string, unknown>();
const sharedStorageCacheTimestamps = new Map<string, number>();
// Shared reads should fail fast enough to keep the UI responsive when the
// backend is slow or unavailable.
const REMOTE_STORAGE_TIMEOUT_MS = 15000;
const API_HEALTH_TIMEOUT_MS = 5000;

// Detect mobile at runtime (not module load time) to avoid errors
function getRequestTimeoutMs(): number {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
      const ua = navigator.userAgent.toLowerCase();
      if (/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(ua)) {
        return 20000;
      }
    }
  } catch {
    // Ignore errors in user agent detection
  }
  return REMOTE_STORAGE_TIMEOUT_MS;
}
const API_READY_RETRY_MS = 400;
const API_READY_MAX_ATTEMPTS = 2;
const API_READY_CACHE_MS = 15000;
const API_REQUEST_MAX_ATTEMPTS = 3;
const API_REQUEST_RETRY_BASE_MS = 300;
const API_REQUEST_RETRY_MAX_MS = 2000;
const SHARED_STORAGE_CACHE_TTL_MS = 600000;
const PROJECTS_SNAPSHOT_CACHE_TTL_MS = 120000; // Increased from 1m to 2m
const MESSAGES_CACHE_TTL_MS = 3000; // 3s — Firestore handles real-time; short TTL prevents stale proposal cards
const CONVERSATION_CACHE_TTL_MS = 3000; // 3s — same reason
const STORAGE_CHANGE_POLL_INTERVAL_MS = 5000; // Increased from 3s to 5s
const STORAGE_CHANGE_DEBOUNCE_MS = 800; // Increased from 500ms
const STORAGE_CHANGE_CALLBACK_COOLDOWN_MS = 1500; // Increased from 1s
const LOCAL_ONLY_STORAGE_KEYS = new Set([STORAGE_KEYS.CURRENT_USER, STORAGE_KEYS.APP_SETTINGS]);
const NEGROS_OCCIDENTAL_BOUNDS = {
  minLatitude: 9.85,
  maxLatitude: 11.05,
  minLongitude: 122.45,
  maxLongitude: 123.35,
};
let apiReadyConfirmedAt = 0;
let apiReadyCheckPromise: Promise<void> | null = null;
const inFlightJsonRequests = new Map<string, Promise<unknown>>();
const projectsSnapshotCache = new Map<string, { data: unknown; timestamp: number }>();
// Message-specific caches — short TTL, invalidated on send/receive via WebSocket
const messagesForUserCache = new Map<string, { data: Message[]; timestamp: number }>();
const conversationCache = new Map<string, { data: Message[]; timestamp: number }>();
const groupMessagesCache = new Map<string, { data: ProjectGroupMessage[]; timestamp: number }>();

const PERSISTED_CACHE_KEY_PREFIX = 'volcre:cache:';
const PERSISTED_CACHE_TS_PREFIX = 'volcre:cacheTs:';
const PERSISTED_CACHE_PENDING_WRITES = new Map<string, ReturnType<typeof setTimeout>>();
const PERSISTED_CACHE_WRITE_DEBOUNCE_MS = 200;

function getPersistedCacheKey(key: string): string {
  return `${PERSISTED_CACHE_KEY_PREFIX}${key}`;
}

function getPersistedCacheTimestampKey(key: string): string {
  return `${PERSISTED_CACHE_TS_PREFIX}${key}`;
}

function schedulePersistedWrite(key: string, task: () => Promise<void>): void {
  const existing = PERSISTED_CACHE_PENDING_WRITES.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    PERSISTED_CACHE_PENDING_WRITES.delete(key);
    void task().catch(() => null);
  }, PERSISTED_CACHE_WRITE_DEBOUNCE_MS);
  PERSISTED_CACHE_PENDING_WRITES.set(key, timer);
}
type StorageChangeEvent = { type: string; keys: string[] };
type StorageChangeSubscriber = {
  watchedKeys: Set<string>;
  onChange: (event: StorageChangeEvent) => void | Promise<void>;
  pendingKeys: Set<string>;
  notifyTimer: ReturnType<typeof setTimeout> | null;
  isNotifying: boolean;
};
const storageChangeSubscribers = new Map<number, StorageChangeSubscriber>();
let nextStorageSubscriberId = 1;
let sharedStorageSocket: WebSocket | null = null;
let sharedStorageHeartbeat: ReturnType<typeof setInterval> | null = null;
let sharedStorageReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sharedStoragePendingChangeTimer: ReturnType<typeof setTimeout> | null = null;
const sharedStoragePendingChangedKeys = new Set<string>();

function hasStorageChangeSubscribers(): boolean {
  return storageChangeSubscribers.size > 0;
}

function queueStorageSubscriberNotification(
  subscriber: StorageChangeSubscriber,
  changedKeys: string[]
) {
  changedKeys.forEach(key => {
    if (subscriber.watchedKeys.has(key)) {
      subscriber.pendingKeys.add(key);
    }
  });

  if (subscriber.pendingKeys.size === 0 || subscriber.notifyTimer) {
    return;
  }

  subscriber.notifyTimer = setTimeout(() => {
    subscriber.notifyTimer = null;
    void flushStorageSubscriberNotification(subscriber);
  }, STORAGE_CHANGE_DEBOUNCE_MS);
}

async function flushStorageSubscriberNotification(subscriber: StorageChangeSubscriber) {
  if (subscriber.isNotifying || subscriber.pendingKeys.size === 0) {
    return;
  }

  const changedKeys = Array.from(subscriber.pendingKeys);
  subscriber.pendingKeys.clear();
  subscriber.isNotifying = true;

  try {
    const callbackResult = subscriber.onChange({ type: 'storage.changed', keys: changedKeys });
    if (callbackResult && typeof (callbackResult as Promise<void>).then === 'function') {
      await callbackResult;
    } else {
      await new Promise<void>(resolve => {
        setTimeout(resolve, STORAGE_CHANGE_CALLBACK_COOLDOWN_MS);
      });
    }
  } catch (error) {
    console.error('Error notifying storage subscriber:', error);
  } finally {
    subscriber.isNotifying = false;
    if (subscriber.pendingKeys.size > 0) {
      queueStorageSubscriberNotification(subscriber, Array.from(subscriber.pendingKeys));
    }
  }
}

function notifyStorageChanged(changedKeys: string[]) {
  for (const subscriber of storageChangeSubscribers.values()) {
    if (!changedKeys.some(key => subscriber.watchedKeys.has(key))) {
      continue;
    }

    queueStorageSubscriberNotification(subscriber, changedKeys);
  }
}

function flushSharedStorageChangedKeys() {
  if (sharedStoragePendingChangedKeys.size === 0) {
    return;
  }

  const changedKeys = Array.from(sharedStoragePendingChangedKeys);
  sharedStoragePendingChangedKeys.clear();
  notifyStorageChanged(changedKeys);
}

function queueSharedStorageChangedKeys(changedKeys: string[]) {
  changedKeys.forEach(key => sharedStoragePendingChangedKeys.add(key));
  if (!sharedStoragePendingChangeTimer) {
    sharedStoragePendingChangeTimer = setTimeout(() => {
      sharedStoragePendingChangeTimer = null;
      flushSharedStorageChangedKeys();
    }, STORAGE_CHANGE_DEBOUNCE_MS);
  }
}

function clearSharedStorageSocketResources(closeSocket = true) {
  if (sharedStorageHeartbeat) {
    clearInterval(sharedStorageHeartbeat);
    sharedStorageHeartbeat = null;
  }
  if (sharedStoragePendingChangeTimer) {
    clearTimeout(sharedStoragePendingChangeTimer);
    sharedStoragePendingChangeTimer = null;
  }
  if (sharedStorageReconnectTimer) {
    clearTimeout(sharedStorageReconnectTimer);
    sharedStorageReconnectTimer = null;
  }
  if (closeSocket && sharedStorageSocket) {
    sharedStorageSocket.onopen = null;
    sharedStorageSocket.onmessage = null;
    sharedStorageSocket.onerror = null;
    sharedStorageSocket.onclose = null;
    sharedStorageSocket.close();
    sharedStorageSocket = null;
  }
}

function connectSharedStorageSocket() {
  if (!hasStorageChangeSubscribers()) {
    clearSharedStorageSocketResources(true);
    return;
  }

  if (
    sharedStorageSocket &&
    (sharedStorageSocket.readyState === WebSocket.OPEN ||
      sharedStorageSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  if (sharedStorageReconnectTimer) {
    clearTimeout(sharedStorageReconnectTimer);
    sharedStorageReconnectTimer = null;
  }

  sharedStorageSocket = new WebSocket(getStorageWebSocketUrl());

  sharedStorageSocket.onopen = () => {
    if (sharedStorageHeartbeat) {
      clearInterval(sharedStorageHeartbeat);
    }
    sharedStorageHeartbeat = setInterval(() => {
      if (sharedStorageSocket?.readyState === WebSocket.OPEN) {
        sharedStorageSocket.send('ping');
      }
    }, 25000);
  };

  sharedStorageSocket.onmessage = event => {
    try {
      const payload = JSON.parse(event.data) as { type: string; keys?: string[] };
      const changedKeys = payload.keys || [];
      if (payload.type !== 'storage.changed' || changedKeys.length === 0) {
        return;
      }

      const hasInterestedSubscriber = Array.from(storageChangeSubscribers.values()).some(
        subscriber => changedKeys.some(key => subscriber.watchedKeys.has(key))
      );

      if (!hasInterestedSubscriber) {
        return;
      }

      invalidateSharedStorageCache(changedKeys);
      queueSharedStorageChangedKeys(changedKeys);
    } catch (error) {
      console.error('Error parsing storage event:', error);
    }
  };

  sharedStorageSocket.onclose = () => {
    clearSharedStorageSocketResources(false);
    sharedStorageSocket = null;
    if (hasStorageChangeSubscribers()) {
      sharedStorageReconnectTimer = setTimeout(connectSharedStorageSocket, 1500);
    }
  };

  sharedStorageSocket.onerror = () => {
    sharedStorageSocket?.close();
  };
}

type ProjectsScreenSnapshot = {
  projects: Project[];
  programs?: Project[];
  programTracks?: ProgramTrack[];
  volunteerProfile: Volunteer | null;
  volunteerMatches?: VolunteerProjectMatch[];
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

export type DashboardTimelineSnapshot = {
  projects: Project[];
  planningCalendars: AdminPlanningCalendar[];
  planningItems: AdminPlanningItem[];
};

function buildVolunteerProjectJoinRecordId(projectId: string, volunteerId: string): string {
  const rawId = `volunteer-join-${projectId}-${volunteerId}`;
  if (rawId.length <= 64) {
    return rawId;
  }

  let hash = 2166136261;
  for (let index = 0; index < rawId.length; index += 1) {
    hash ^= rawId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `voljoin-${projectId.slice(0, 18)}-${volunteerId.slice(0, 18)}-${(hash >>> 0).toString(16)}`;
}

const DEFAULT_ADMIN_PLANNING_CALENDARS: AdminPlanningCalendar[] = [
  {
    id: 'planner-projects',
    name: 'Project Plans',
    color: '#0F766E',
    description: 'Project scheduling blocks and delivery windows.',
    planningItems: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'planner-meetings',
    name: 'Meetings',
    color: '#3B82F6',
    description: 'Coordination meetings, reviews, and check-ins.',
    planningItems: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'planner-training',
    name: 'Training',
    color: '#65A30D',
    description: 'Volunteer onboarding, safety briefings, and workshops.',
    planningItems: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'planner-fieldwork',
    name: 'Field Work',
    color: '#F97316',
    description: 'Community visits, deployment, and field coordination.',
    planningItems: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'planner-deadlines',
    name: 'Deadlines',
    color: '#DC2626',
    description: 'Submission deadlines, approvals, and milestone cutoffs.',
    planningItems: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function normalizeAdminPlanningItemRecord(item: AdminPlanningItem): AdminPlanningItem {
  return {
    ...item,
    title: item.title.trim(),
    description: item.description?.trim() || undefined,
    location: item.location?.trim() || undefined,
    participantsLabel: item.participantsLabel?.trim() || undefined,
    linkedProjectId: item.linkedProjectId?.trim() || undefined,
  };
}

function normalizeAdminPlanningCalendarRecord(calendar: AdminPlanningCalendar): AdminPlanningCalendar {
  return {
    ...calendar,
    name: calendar.name.trim(),
    color: calendar.color.trim() || '#0F766E',
    description: calendar.description?.trim() || undefined,
    planningItems: (calendar.planningItems || []).map(normalizeAdminPlanningItemRecord),
  };
}

function collectPlanningItemsFromCalendars(calendars: AdminPlanningCalendar[]): AdminPlanningItem[] {
  return calendars
    .flatMap(calendar => (calendar.planningItems || []).map(item => normalizeAdminPlanningItemRecord(item)))
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime() ||
        new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
    );
}

function attachPlanningItemToCalendars(
  calendars: AdminPlanningCalendar[],
  item: AdminPlanningItem
): AdminPlanningCalendar[] {
  const normalizedItem = normalizeAdminPlanningItemRecord(item);
  const nextCalendars = calendars.map(calendar => ({
    ...normalizeAdminPlanningCalendarRecord(calendar),
    planningItems: (calendar.planningItems || []).filter(entry => entry.id !== normalizedItem.id),
  }));

  const targetIndex = nextCalendars.findIndex(calendar => calendar.id === normalizedItem.calendarId);
  if (targetIndex >= 0) {
    nextCalendars[targetIndex] = {
      ...nextCalendars[targetIndex],
      planningItems: [...(nextCalendars[targetIndex].planningItems || []), normalizedItem],
    };
  }

  return nextCalendars;
}

function normalizePlanningCalendars(
  calendars: AdminPlanningCalendar[]
): AdminPlanningCalendar[] {
  return calendars.map(calendar => normalizeAdminPlanningCalendarRecord(calendar));
}

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

export function buildProgramProposalProjectId(programModule: string): string {
  return `program:${String(programModule || '').trim()}`;
}

export function getProgramModuleFromProposalProjectId(projectId: string): string | null {
  if (!projectId.startsWith('program:')) {
    return null;
  }

  const extractedModule = projectId.slice('program:'.length).split('::', 1)[0].trim();
  return extractedModule || null;
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
  partnerUser: Pick<User, 'id' | 'name' | 'email'>,
  application?: PartnerProjectApplication
): Promise<void> {
  const [project, adminUser] = await Promise.all([
    getProject(projectId),
    getPrimaryAdminUser(),
  ]);

  if (!adminUser) {
    return;
  }

  const requestedProgramModule = getProgramModuleFromProposalProjectId(projectId);
  const targetLabel = project
    ? `"${project.title}"`
    : requestedProgramModule
      ? `the ${requestedProgramModule} program module`
      : 'a new program';

  const partnerEmail = partnerUser.email?.trim()
    ? ` (${partnerUser.email.trim()})`
    : '';

  await sendSystemMessage(
    partnerUser.id,
    adminUser.id,
    `${partnerUser.name}${partnerEmail} submitted a project proposal for ${targetLabel}. Review it in the Communication Hub to approve or reject.`
  );

  // Also send a lightweight confirmation back to the partner so they see a record in Messages.
  try {
    await sendSystemMessage(
      adminUser.id,
      partnerUser.id,
      `Your proposal for ${targetLabel} has been submitted and is pending admin review.`
    );
  } catch (err) {
    // Confirmation is best-effort — don't fail the main flow if it errors.
    console.warn('Failed to send partner confirmation message:', err);
  }
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
    `${volunteer.name}${volunteerEmail} requested to join "${project.title}". Review it in the Project Management Suite to approve or reject.`
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

export async function notifyVolunteerAboutTaskUnassignment(params: {
  event: Pick<Project, 'id' | 'title'>;
  task: Pick<ProjectInternalTask, 'id' | 'title'>;
  volunteer: Pick<Volunteer, 'userId' | 'name'> | { id?: string; userId?: string; name?: string };
  actorUserId?: string;
}): Promise<void> {
  const recipientId = params.volunteer.userId || (params.volunteer as any).id;
  if (!recipientId) {
    return;
  }

  const adminUser = await getPrimaryAdminUser();
  const senderId = params.actorUserId || adminUser?.id || 'admin-system';
  if (!senderId || senderId === recipientId) {
    return;
  }

  await sendSystemMessage(
    senderId,
    recipientId,
    `You were unassigned from "${params.task.title}" in "${params.event.title}".`
  );
}

export async function notifyVolunteerAboutTaskUpdate(params: {
  event: Pick<Project, 'id' | 'title'>;
  task: Pick<ProjectInternalTask, 'id' | 'title' | 'status'>;
  volunteer: Pick<Volunteer, 'userId' | 'name'> | { id?: string; userId?: string; name?: string };
  actorUserId?: string;
  action: 'assigned' | 'updated';
}): Promise<void> {
  const recipientId = params.volunteer.userId || (params.volunteer as any).id;
  if (!recipientId) {
    return;
  }

  const adminUser = await getPrimaryAdminUser();
  const senderId = params.actorUserId || adminUser?.id || 'admin-system';
  if (!senderId || senderId === recipientId) {
    return;
  }

  const message =
    params.action === 'assigned'
      ? `You were assigned to "${params.task.title}" in "${params.event.title}".`
      : `"${params.task.title}" in "${params.event.title}" was updated. Current status: ${params.task.status}.`;

  await sendSystemMessage(senderId, recipientId, message);
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

    if (bundlerHost && isLoopbackHost && getPlatformOS() !== 'web') {
      parsedUrl.hostname = bundlerHost;
      return parsedUrl.toString().replace(/\/$/, '');
    }
  } catch {
    return trimmedBaseUrl;
  }

  return trimmedBaseUrl;
}

type ExpoConstantsWithManifest = {
  expoConfig?: { extra?: Record<string, unknown> };
  extra?: Record<string, unknown>;
  manifest?: { extra?: Record<string, unknown> };
  manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
};

function getExpoExtraValue(key: string): string | undefined {
  const constantsAny = Constants as unknown as ExpoConstantsWithManifest;
  const fromExpoConfig = constantsAny.expoConfig?.extra?.[key];
  if (typeof fromExpoConfig === 'string' && fromExpoConfig.trim().length > 0) {
    return fromExpoConfig.trim();
  }

  const fromManifest = constantsAny.manifest?.extra?.[key];
  if (typeof fromManifest === 'string' && fromManifest.trim().length > 0) {
    return fromManifest.trim();
  }

  const fromManifest2 = constantsAny.manifest2?.extra?.expoClient?.extra?.[key];
  if (typeof fromManifest2 === 'string' && fromManifest2.trim().length > 0) {
    return fromManifest2.trim();
  }

  if (typeof process !== 'undefined' && typeof process.env === 'object' && process.env) {
    const envValues = [] as string[];

    if (key === 'webApiBaseUrl') {
      envValues.push(
        process.env.EXPO_PUBLIC_WEB_API_BASE_URL as string,
        process.env.VOLCRE_WEB_API_BASE_URL as string,
        process.env.EXPO_PUBLIC_API_BASE_URL as string,
        process.env.VOLCRE_API_BASE_URL as string
      );
    } else if (key === 'apiBaseUrl') {
      envValues.push(
        process.env.EXPO_PUBLIC_API_BASE_URL as string,
        process.env.VOLCRE_API_BASE_URL as string
      );
    }

    for (const value of envValues) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  return undefined;
}

const DEFAULT_PRODUCTION_TUNNEL_URL = 'http://129.121.73.76:8001';

function isPrivateOrLocalHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().trim();
  return (
    h === '127.0.0.1' ||
    h === 'localhost' ||
    h === '10.0.2.2' ||
    h.startsWith('192.168.') ||
    h.startsWith('10.') ||
    h.startsWith('172.')
  );
}

// Resolves the native-device API base URL from Expo config or Metro host info.
function resolveNativeApiBaseUrl(configuredBaseUrl?: string): string {
  const bundlerHost = getBundlerHost();

  if (configuredBaseUrl && configuredBaseUrl.trim().length > 0) {
    const trimmedBaseUrl = configuredBaseUrl.trim().replace(/\/$/, '');

    try {
      const parsedUrl = new URL(trimmedBaseUrl);
      const isLocalHost = isPrivateOrLocalHost(parsedUrl.hostname);

      if (bundlerHost && isLocalHost) {
        parsedUrl.hostname = bundlerHost;
        return parsedUrl.toString().replace(/\/$/, '');
      }

      // On a standalone device without a bundler host, private IPs and loopbacks
      // cannot be reached over cellular data. Route directly to the public tunnel.
      if (!bundlerHost && isLocalHost) {
        return DEFAULT_PRODUCTION_TUNNEL_URL;
      }

      return trimmedBaseUrl;
    } catch {
      return trimmedBaseUrl;
    }
  }

  if (bundlerHost) {
    return `http://${bundlerHost}:8000`;
  }

  return DEFAULT_PRODUCTION_TUNNEL_URL;
}

// Returns the effective HTTP base URL used by the frontend storage layer.
export function getApiBaseUrl(): string {
  // Check runtime override first (e.g. ngrok URL saved from System Settings).
  if (_runtimeCustomBackendUrl) {
    return _runtimeCustomBackendUrl;
  }

  const configuredWebBaseUrl = getExpoExtraValue('webApiBaseUrl');
  if (typeof document !== 'undefined') {
    const protocol = document.location.protocol || 'http:';
    const host = document.location.hostname || '127.0.0.1';
    if (isPrivateOrLocalHost(host)) {
      return `${protocol}//${host}:8000`;
    }

    if (configuredWebBaseUrl && configuredWebBaseUrl.trim().length > 0) {
      return configuredWebBaseUrl.trim().replace(/\/$/, '');
    }

    return `${protocol}//${host}:8000`;
  }

  const configuredNativeBaseUrl = getExpoExtraValue('apiBaseUrl');
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

function markApiReady(): void {
  apiReadyConfirmedAt = Date.now();
}

function invalidateApiReady(): void {
  apiReadyConfirmedAt = 0;
}

function getApiRetryDelayMs(attempt: number): number {
  return Math.min(300 * Math.pow(1.5, attempt), 2000);
}

function isRetryableApiStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function getApiHealthError(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${getApiBaseUrl()}/health`, {
      signal: controller.signal,
      headers: {
        'ngrok-skip-browser-warning': '69420',
        'User-Agent': 'VolCre-App/1.0',
        'Accept': 'application/json',
      },
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
  if (Date.now() - apiReadyConfirmedAt < API_READY_CACHE_MS) {
    return;
  }

  if (apiReadyCheckPromise) {
    return apiReadyCheckPromise;
  }

  apiReadyCheckPromise = (async () => {
    let lastError = `Backend unavailable at ${getApiBaseUrl()}.`;

    for (let attempt = 0; attempt < API_READY_MAX_ATTEMPTS; attempt += 1) {
      const healthError = await getApiHealthError();
      if (!healthError) {
        markApiReady();
        return;
      }
      lastError = healthError;

      if (attempt < API_READY_MAX_ATTEMPTS - 1) {
        await delay(API_READY_RETRY_MS);
      }
    }

    invalidateApiReady();
    throw new Error(lastError);
  })();

  try {
    await apiReadyCheckPromise;
  } finally {
    apiReadyCheckPromise = null;
  }
}

async function fetchRemoteStorageItem<T>(key: string): Promise<T | null> {
  const response = await fetchApiResponse(`/storage/${encodeURIComponent(key)}`);
  const payload = (await response.json()) as { value: T | null };
  return payload.value ?? null;
}

async function fetchRemoteStorageItems(
  keys: string[]
): Promise<Record<string, unknown | null>> {
  // Optimization: If fetching the exact admin dashboard key set, use the dedicated endpoint
  // which fetches all keys in a single DB connection instead of a thread pool.
  const adminDashboardKeys = [
    'users',
    'projects',
    'programs',
    'programTracks',
    'events',
    'partners',
    'volunteers',
    'statusUpdates',
    'adminPlanningCalendars',
    'volunteerMatches',
    'volunteerTimeLogs',
    'volunteerProjectJoins',
    'partnerProjectApplications',
    'partnerReports',
  ];
  const sortedKeys = [...keys].sort();
  const sortedAdminKeys = [...adminDashboardKeys].sort();
  const isAdminDashboardRequest =
    sortedKeys.length === sortedAdminKeys.length &&
    sortedKeys.every((key, index) => key === sortedAdminKeys[index]);

  if (isAdminDashboardRequest) {
    try {
      const response = await fetchApiResponse('/admin/dashboard-snapshot');
      const payload = (await response.json()) as { items?: Record<string, unknown | null> };
      return payload.items || {};
    } catch (error) {
      console.warn('[storage] Admin dashboard endpoint failed, falling back to batch:', error);
      // Fall through to standard batch request
    }
  }

  const response = await fetchApiResponse('/storage/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ keys }),
  });
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

async function fetchApiResponse(
  path: string,
  init?: RequestInit,
  timeoutMs?: number
): Promise<Response> {
  let lastError: unknown = null;
  const pathShort = path.slice(0, 50);
  const actualTimeoutMs = timeoutMs ?? getRequestTimeoutMs();

  for (let attempt = 0; attempt < API_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.warn(`[Network] Request timeout after ${actualTimeoutMs}ms: ${pathShort}`);
      controller.abort();
    }, actualTimeoutMs);

    try {
      const response = await fetch(`${getApiBaseUrl()}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'ngrok-skip-browser-warning': '69420',
          'User-Agent': 'VolCre-App/1.0',
          'Accept': 'application/json',
          ...(init?.headers || {}),
        },
      });

      if (!response.ok) {
        clearTimeout(timeout);
        const message = await getApiErrorMessage(
          response,
          `API request failed: ${response.status}`
        );

        if (isRetryableApiStatus(response.status) && attempt < API_REQUEST_MAX_ATTEMPTS - 1) {
          invalidateApiReady();
          lastError = new Error(message);
          const delay_ms = getApiRetryDelayMs(attempt);
          console.log(`[Network] Retrying ${pathShort} after ${delay_ms}ms (attempt ${attempt + 1}/${API_REQUEST_MAX_ATTEMPTS})`);
          await delay(delay_ms);
          continue;
        }

        invalidateApiReady();
        throw new Error(message);
      }

      clearTimeout(timeout);
      markApiReady();
      return response;
    } catch (error) {
      clearTimeout(timeout);
      const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
      if (isExpectedRemoteStorageError(error) && attempt < API_REQUEST_MAX_ATTEMPTS - 1) {
        invalidateApiReady();
        if (isAbort) {
          console.warn(`[Network] Request aborted for ${pathShort} (attempt ${attempt + 1}/${API_REQUEST_MAX_ATTEMPTS})`);
        }
        lastError = error;
        const delay_ms = getApiRetryDelayMs(attempt);
        await delay(delay_ms);
        continue;
      }

      if (isAbort) {
        console.error(`[Network] Request aborted for ${pathShort} - max retries exceeded`);
      }
      invalidateApiReady();
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Backend unavailable at ${getApiBaseUrl()}.`);
}

async function requestApiJson<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = REMOTE_STORAGE_TIMEOUT_MS
): Promise<T> {
  const method = String(init?.method || 'GET').toUpperCase();
  const canDeduplicate = method === 'GET' && !init?.body;

  if (!canDeduplicate) {
    const response = await fetchApiResponse(path, init, timeoutMs);
    return (await response.json()) as T;
  }

  const requestKey = `${method}:${path}:${timeoutMs}`;
  const existingRequest = inFlightJsonRequests.get(requestKey);
  if (existingRequest) {
    console.log(`[Network] Deduplicating request: ${path.slice(0, 50)}`);
    return existingRequest as Promise<T>;
  }

  const nextRequest = (async () => {
    try {
      const reqStart = Date.now();
      const response = await fetchApiResponse(path, init, timeoutMs);
      const result = (await response.json()) as T;
      console.log(`[Network] ${method} ${path.slice(0, 50)} completed in ${Date.now() - reqStart}ms`);
      return result;
    } catch (error) {
      inFlightJsonRequests.delete(requestKey);
      throw error;
    }
  })();

  inFlightJsonRequests.set(requestKey, nextRequest as Promise<unknown>);
  try {
    return await nextRequest;
  } finally {
    inFlightJsonRequests.delete(requestKey);
  }

}


async function getLocalStorageItem<T>(key: string): Promise<T | null> {
  if (memoryStorageCache.has(key)) {
    return (memoryStorageCache.get(key) as T) ?? null;
  }

  // Web: localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(getPersistedCacheKey(key));
      const rawTs = window.localStorage.getItem(getPersistedCacheTimestampKey(key));
      const parsed = raw ? (JSON.parse(raw) as T) : null;
      const ts = rawTs ? Number(rawTs) : 0;
      if (rawTs && Number.isFinite(ts) && ts > 0) {
        sharedStorageCacheTimestamps.set(key, ts);
      }
      memoryStorageCache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  // Native: AsyncStorage
  try {
    const [raw, rawTs] = await AsyncStorage.multiGet([
      getPersistedCacheKey(key),
      getPersistedCacheTimestampKey(key),
    ]);
    const valueRaw = raw?.[1] ?? null;
    const tsRaw = rawTs?.[1] ?? null;
    const parsed = valueRaw ? (JSON.parse(valueRaw) as T) : null;
    const ts = tsRaw ? Number(tsRaw) : 0;
    if (tsRaw && Number.isFinite(ts) && ts > 0) {
      sharedStorageCacheTimestamps.set(key, ts);
    }
    memoryStorageCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

// Restore saved backend URL override at earliest module load
void (async () => {
  try {
    const stored = await getLocalStorageItem<Partial<AppSettings>>(STORAGE_KEYS.APP_SETTINGS);
    if (stored?.customBackendUrl && stored.customBackendUrl.trim()) {
      setRuntimeBackendUrl(stored.customBackendUrl.trim());
      console.log(`[Data] Restored custom backend URL from settings: ${stored.customBackendUrl.trim()}`);
    }
  } catch { }
})();

async function setLocalStorageItem<T>(key: string, value: T): Promise<void> {
  memoryStorageCache.set(key, value);

  const serialized = JSON.stringify(value);
  const ts = String(Date.now());

  // Web: localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    schedulePersistedWrite(key, async () => {
      window.localStorage.setItem(getPersistedCacheKey(key), serialized);
      window.localStorage.setItem(getPersistedCacheTimestampKey(key), ts);
    });
    return;
  }

  // Native: AsyncStorage
  schedulePersistedWrite(key, async () => {
    await AsyncStorage.multiSet([
      [getPersistedCacheKey(key), serialized],
      [getPersistedCacheTimestampKey(key), ts],
    ]);
  });
}

async function deleteLocalStorageItem(key: string): Promise<void> {
  memoryStorageCache.delete(key);

  const existing = PERSISTED_CACHE_PENDING_WRITES.get(key);
  if (existing) {
    clearTimeout(existing);
    PERSISTED_CACHE_PENDING_WRITES.delete(key);
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(getPersistedCacheKey(key));
      window.localStorage.removeItem(getPersistedCacheTimestampKey(key));
    } catch {
      // ignore
    }
    return;
  }

  try {
    await AsyncStorage.multiRemove([
      getPersistedCacheKey(key),
      getPersistedCacheTimestampKey(key),
    ]);
  } catch {
    // ignore
  }
}

// Marks keys that should remain local instead of syncing through shared backend storage.
function isLocalOnlyStorageKey(key: string): boolean {
  return LOCAL_ONLY_STORAGE_KEYS.has(key);
}

function getFreshSharedStorageCacheValue<T>(
  key: string
): { hit: boolean; value: T | null } {
  const cachedAt = sharedStorageCacheTimestamps.get(key);
  if (cachedAt === undefined) {
    return { hit: false, value: null };
  }

  if (Date.now() - cachedAt > SHARED_STORAGE_CACHE_TTL_MS) {
    sharedStorageCacheTimestamps.delete(key);
    memoryStorageCache.delete(key);
    return { hit: false, value: null };
  }

  return {
    hit: true,
    value: (memoryStorageCache.get(key) as T | null) ?? null,
  };
}

function setSharedStorageCacheValue<T>(key: string, value: T | null): void {
  memoryStorageCache.set(key, value);
  sharedStorageCacheTimestamps.set(key, Date.now());
}

function invalidateSharedStorageCache(keys?: string[]): void {
  if (!keys) {
    sharedStorageCacheTimestamps.clear();
    projectsSnapshotCache.clear();
    return;
  }

  for (const key of keys) {
    sharedStorageCacheTimestamps.delete(key);
    if (!isLocalOnlyStorageKey(key)) {
      memoryStorageCache.delete(key);
    }
  }
  projectsSnapshotCache.clear();
}

// Exported function to allow screens to invalidate the storage cache
export function clearStorageCache(keys?: string[]): void {
  invalidateSharedStorageCache(keys);
}

function triggerBackgroundStorageRefresh(keys: string[]): void {
  if (keys.length === 0) {
    return;
  }

  void (async () => {
    try {
      const sharedKeys = keys.filter(key => !isLocalOnlyStorageKey(key));
      if (sharedKeys.length === 0) {
        return;
      }
      const remoteResults = await fetchRemoteStorageItems(sharedKeys);
      for (const key of sharedKeys) {
        const value = remoteResults[key] ?? null;
        setSharedStorageCacheValue(key, value);
      }
      queueSharedStorageChangedKeys(sharedKeys);
    } catch {
      // Ignore background refresh failures; UI can retry on focus/change events.
    }
  })();
}

// Returns cached data immediately (if available) and refreshes in the background.
export async function getStorageItemFast<T>(key: string): Promise<T | null> {
  try {
    // OPTIMIZED: Return cached data immediately on both Web and Mobile
    const cached = await getLocalStorageItem<T>(key);
    const cachedAt = sharedStorageCacheTimestamps.get(key);

    // If we have cached data, return it immediately and refresh in background
    if (cached !== null) {
      // Trigger background refresh if cache is stale
      if (cachedAt === undefined || Date.now() - cachedAt > SHARED_STORAGE_CACHE_TTL_MS) {
        triggerBackgroundStorageRefresh([key]);
      }
      return cached;
    }

    // No cache available, fetch from server
    const value = await getStorageItem<T>(key);
    return value;
  } catch {
    // On error, try to return cached data even if stale
    const cached = await getLocalStorageItem<T>(key);
    if (cached !== null) {
      return cached;
    }
    return getStorageItem<T>(key);
  }
}

// Retrieves multiple storage items from local cache (localStorage or AsyncStorage) in a single batch.
async function getLocalStorageItems(keys: string[]): Promise<Record<string, unknown | null>> {
  const results: Record<string, unknown | null> = {};
  const keysToFetch: string[] = [];

  for (const key of keys) {
    if (memoryStorageCache.has(key)) {
      results[key] = memoryStorageCache.get(key) ?? null;
    } else {
      keysToFetch.push(key);
    }
  }

  if (keysToFetch.length === 0) {
    return results;
  }

  // Web: localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      for (const key of keysToFetch) {
        const raw = window.localStorage.getItem(getPersistedCacheKey(key));
        const rawTs = window.localStorage.getItem(getPersistedCacheTimestampKey(key));
        const parsed = raw ? JSON.parse(raw) : null;
        const ts = rawTs ? Number(rawTs) : 0;
        if (rawTs && Number.isFinite(ts) && ts > 0) {
          sharedStorageCacheTimestamps.set(key, ts);
        }
        memoryStorageCache.set(key, parsed);
        results[key] = parsed;
      }
    } catch {
      // Fallback: results initialized with nulls for remaining keys
      for (const key of keysToFetch) { results[key] = null; }
    }
    return results;
  }

  // Native: AsyncStorage
  try {
    const multiGetKeys = keysToFetch.flatMap(key => [
      getPersistedCacheKey(key),
      getPersistedCacheTimestampKey(key),
    ]);
    const rawPairs = await AsyncStorage.multiGet(multiGetKeys);

    for (let i = 0; i < keysToFetch.length; i++) {
      const key = keysToFetch[i];
      const valueRaw = rawPairs[i * 2]?.[1] ?? null;
      const tsRaw = rawPairs[i * 2 + 1]?.[1] ?? null;
      const parsed = valueRaw ? JSON.parse(valueRaw) : null;
      const ts = tsRaw ? Number(tsRaw) : 0;

      if (tsRaw && Number.isFinite(ts) && ts > 0) {
        sharedStorageCacheTimestamps.set(key, ts);
      }
      memoryStorageCache.set(key, parsed);
      results[key] = parsed;
    }
  } catch {
    for (const key of keysToFetch) { results[key] = null; }
  }
  return results;
}

// Returns cached data for all keys immediately (when available) and refreshes in background.
export async function getStorageItemsFast(keys: string[]): Promise<Record<string, unknown | null>> {
  const results: Record<string, unknown | null> = {};
  const keysToRefresh: string[] = [];
  const missingKeys: string[] = [];

  const localResults = await getLocalStorageItems(keys);

  for (const key of keys) {
    const cached = localResults[key];
    const cachedAt = sharedStorageCacheTimestamps.get(key);
    const isFresh = cachedAt !== undefined && Date.now() - cachedAt <= SHARED_STORAGE_CACHE_TTL_MS;

    if (cachedAt !== undefined) {
      keysToRefresh.push(key);
    }

    if (cached !== null && (isFresh || cachedAt === undefined)) {
      results[key] = cached;
    } else {
      missingKeys.push(key);
    }
  }

  triggerBackgroundStorageRefresh(keysToRefresh);

  if (missingKeys.length === 0) {
    return results;
  }

  try {
    const fetched = await getStorageItems(missingKeys);
    return { ...results, ...fetched };
  } catch {
    return results;
  }
}

async function saveRemoteStorageItem<T>(key: string, value: T): Promise<void> {
  await fetchApiResponse(`/storage/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value }),
  });
}

async function deleteRemoteStorageItem(key: string): Promise<void> {
  await fetchApiResponse(`/storage/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}

async function deleteRemoteProjectRecord(projectId: string): Promise<void> {
  await fetchApiResponse(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
}

async function deleteRemoteEventRecord(eventId: string): Promise<void> {
  await fetchApiResponse(`/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

async function clearRemoteStorage(): Promise<void> {
  await fetchApiResponse('/storage', {
    method: 'DELETE',
  });
}

async function sendAccountApprovalEmailNotification(
  account: Pick<User, 'email' | 'name' | 'role'>,
  approvedBy: string
): Promise<void> {
  const email = account.email?.trim().toLowerCase();
  if (!email || !isValidEmailAddress(email)) {
    return;
  }

  let approvedByName = 'the admin team';
  if (approvedBy) {
    try {
      const adminUser = await getUser(approvedBy);
      approvedByName = adminUser?.name || approvedByName;
    } catch {
      approvedByName = 'the admin team';
    }
  }

  await requestApiJson('/auth/approval-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      name: account.name || '',
      role: account.role || '',
      approvedByName,
    }),
  });
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
    message.includes('failed to fetch') ||
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
    if (getPlatformOS() === 'web') {
      const remoteValue = await fetchRemoteStorageItem<T>(key);
      setSharedStorageCacheValue(key, remoteValue);
      return remoteValue;
    }

    const cachedValue = getFreshSharedStorageCacheValue<T>(key);
    if (cachedValue.hit) {
      return cachedValue.value;
    }

    const remoteValue = await fetchRemoteStorageItem<T>(key);
    setSharedStorageCacheValue(key, remoteValue);
    return remoteValue;
  } catch (error) {
    // Abort/timeouts can happen during concurrent startup fetches and should not
    // surface as console errors or crash-like LogBox noise.
    if (isExpectedRemoteStorageError(error) || isAbortLikeError(error)) {
      if (hasStorageChangeSubscribers()) {
        connectSharedStorageSocket();
      }
      return getLocalStorageItem<T>(key);
    }

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
    if (getPlatformOS() === 'web') {
      const remoteResults = await fetchRemoteStorageItems(sharedKeys);
      for (const key of sharedKeys) {
        const value = remoteResults[key] ?? null;
        setSharedStorageCacheValue(key, value);
        results[key] = value;
      }
      return results;
    }

    const missingSharedKeys: string[] = [];

    for (const key of sharedKeys) {
      const cachedValue = getFreshSharedStorageCacheValue(key);
      if (cachedValue.hit) {
        results[key] = cachedValue.value;
      } else {
        missingSharedKeys.push(key);
      }
    }

    if (missingSharedKeys.length === 0) {
      return results;
    }

    const remoteResults = await fetchRemoteStorageItems(missingSharedKeys);
    for (const key of missingSharedKeys) {
      const value = remoteResults[key] ?? null;
      setSharedStorageCacheValue(key, value);
      results[key] = value;
    }
    return results;
  } catch (error) {
    if (isExpectedRemoteStorageError(error) || isAbortLikeError(error)) {
      if (hasStorageChangeSubscribers()) {
        connectSharedStorageSocket();
      }

      const fallbackResults = await getLocalStorageItems(sharedKeys);
      for (const key of sharedKeys) {
        if (!(key in results)) {
          results[key] = fallbackResults[key] ?? null;
        }
      }
      return results;
    }

    console.error(`Error reading shared storage batch from backend:`, error);
    throw error;
  }
}

// Loads the combined data set required by the admin dashboard screen.
// OPTIMIZED: Selective loading to minimize egress while ensuring all data is available.
// Core collections fetched immediately, supplemental data loaded on-demand.
export async function getDashboardSnapshot(): Promise<{
  users: User[];
  partners: Partner[];
  projects: Project[];
  programs: Project[];
  programTracks: ProgramTrack[];
  events: Project[];
  volunteers: Volunteer[];
  statusUpdates: StatusUpdate[];
  volunteerMatches: VolunteerProjectMatch[];
  volunteerTimeLogs: VolunteerTimeLog[];
  volunteerProjectJoins: VolunteerProjectJoinRecord[];
  partnerProjectApplications: PartnerProjectApplication[];
  partnerReports: PartnerReport[];
  adminPlanningCalendars: AdminPlanningCalendar[];
  adminPlanningItems: AdminPlanningItem[];
}> {
  // SINGLE BATCH LOAD: Fetch all dashboard keys in one request to avoid sequential round-trips.
  // getStorageItemsFast returns cached data immediately and refreshes stale keys in the background,
  // so this is effectively instant on warm cache and one network round-trip on cold start.
  const allItems = await getStorageItemsFast([
    STORAGE_KEYS.USERS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.PROGRAMS,
    STORAGE_KEYS.PROGRAM_TRACKS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.PARTNERS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.STATUS_UPDATES,
    STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
  ]);

  const partners = ((allItems[STORAGE_KEYS.PARTNERS] as Partner[] | null) || [])
    .filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));

  const programs = (allItems[STORAGE_KEYS.PROGRAMS] as Project[] | null) || [];
  const projects = (allItems[STORAGE_KEYS.PROJECTS] as Project[] | null) || [];
  const programTracks =
    (allItems[STORAGE_KEYS.PROGRAM_TRACKS] as ProgramTrack[] | null) ||
    (await getStorageItemFast<ProgramTrack[]>(STORAGE_KEYS.PROGRAM_TRACKS)) ||
    [];

  return {
    users: (allItems[STORAGE_KEYS.USERS] as User[] | null) || [],
    projects: mergeProjectAndEventRecords(
      [...programs, ...projects],
      allItems[STORAGE_KEYS.EVENTS] as Project[] | null
    ),
    programs: (allItems[STORAGE_KEYS.PROGRAMS] as Project[] | null) || [],
    programTracks,
    events: (allItems[STORAGE_KEYS.EVENTS] as Project[] | null) || [],
    partners,
    volunteers: (allItems[STORAGE_KEYS.VOLUNTEERS] as Volunteer[] | null) || [],
    statusUpdates: (allItems[STORAGE_KEYS.STATUS_UPDATES] as StatusUpdate[] | null) || [],
    volunteerMatches: (allItems[STORAGE_KEYS.VOLUNTEER_MATCHES] as VolunteerProjectMatch[] | null) || [],
    volunteerTimeLogs: (allItems[STORAGE_KEYS.VOLUNTEER_TIME_LOGS] as VolunteerTimeLog[] | null) || [],
    volunteerProjectJoins: (allItems[STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS] as VolunteerProjectJoinRecord[] | null) || [],
    partnerProjectApplications: (allItems[STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS] as PartnerProjectApplication[] | null) || [],
    partnerReports: (allItems[STORAGE_KEYS.PARTNER_REPORTS] as PartnerReport[] | null) || [],
    adminPlanningCalendars: (allItems[STORAGE_KEYS.ADMIN_PLANNING_CALENDARS] as AdminPlanningCalendar[] | null) || [],
    adminPlanningItems: collectPlanningItemsFromCalendars(
      (allItems[STORAGE_KEYS.ADMIN_PLANNING_CALENDARS] as AdminPlanningCalendar[] | null) || []
    ),
  };
}

// Loads the combined data set required by the partner dashboard screen.
// OPTIMIZED: Selective loading to minimize egress while ensuring all data is available.
// Core collections fetched immediately, supplemental data loaded on-demand.
export async function getPartnerDashboardSnapshot(): Promise<{
  users: User[];
  partners: Partner[];
  projects: Project[];
  programs: Project[];
  events: Project[];
  volunteers: Volunteer[];
  statusUpdates: StatusUpdate[];
  partnerApplications: PartnerProjectApplication[];
  partnerReports: PartnerReport[];
  volunteerMatches: VolunteerProjectMatch[];
  volunteerTimeLogs: VolunteerTimeLog[];
  volunteerProjectJoins: VolunteerProjectJoinRecord[];
  adminPlanningCalendars: AdminPlanningCalendar[];
  adminPlanningItems: AdminPlanningItem[];
}> {
  await ensurePartnerOwnershipLinks();

  // CORE LOAD: Essential data for partner dashboard (minimizes egress)
  const coreItems = await getStorageItemsFast([
    STORAGE_KEYS.USERS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.PROGRAMS,
    STORAGE_KEYS.PROGRAM_TRACKS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.PARTNERS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.STATUS_UPDATES,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
    STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
  ]);

  // SUPPLEMENTAL LOAD: Additional data needed for partner dashboard
  // Load these to ensure they're available
  let supplementalItems: Record<string, unknown | null> = {};
  try {
    supplementalItems = await getStorageItemsFast([
      STORAGE_KEYS.VOLUNTEER_MATCHES,
      STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    ]);
  } catch (error) {
    console.warn('Supplemental data failed to load:', error);
    // Return empty arrays for failed supplemental data
    supplementalItems = {
      [STORAGE_KEYS.VOLUNTEER_MATCHES]: [],
      [STORAGE_KEYS.VOLUNTEER_TIME_LOGS]: [],
      [STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS]: [],
    };
  }

  const partners = ((coreItems[STORAGE_KEYS.PARTNERS] as Partner[] | null) || [])
    .filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));

  const programs = (coreItems[STORAGE_KEYS.PROGRAMS] as Project[] | null) || [];
  const projects = (coreItems[STORAGE_KEYS.PROJECTS] as Project[] | null) || [];
  const programTracks = (coreItems[STORAGE_KEYS.PROGRAM_TRACKS] as ProgramTrack[] | null) || [];
  const partnerApplications =
    (coreItems[STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS] as PartnerProjectApplication[] | null) ||
    [];
  const proposalProjectIds = new Set(
    partnerApplications.map(application => String(application.projectId || '').trim()).filter(Boolean)
  );
  const proposalTitles = new Set(
    partnerApplications
      .map(application => String(application.proposalDetails?.proposedTitle || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const inferProgramCategory = (program: Pick<ProgramTrack, 'id' | 'title'>): AdvocacyFocus => {
    const text = `${program.id || ''} ${program.title || ''}`.toLowerCase();
    if (text.includes('nutrition')) return 'Nutrition';
    if (text.includes('education')) return 'Education';
    if (text.includes('livelihood')) return 'Livelihood';
    if (text.includes('disaster')) return 'Disaster';
    return 'Disaster';
  };
  const programTrackRecords: Project[] = programTracks
    .filter(track => track.isActive !== false)
    .map(track => {
      const category = inferProgramCategory(track);
      const now = new Date().toISOString();
      return {
        id: String(track.id || track.title).trim(),
        title: String(track.title || track.id).trim(),
        description: track.description || '',
        partnerId: '',
        imageUrl: track.imageUrl,
        imageHidden: false,
        programModule: category,
        status: 'Planning',
        category,
        startDate: track.createdAt || now,
        endDate: track.updatedAt || track.createdAt || now,
        location: {
          latitude: track.location?.latitude || 0,
          longitude: track.location?.longitude || 0,
          address: track.location?.address || [track.locationCity, track.locationRegion].filter(Boolean).join(', '),
          region: track.location?.region || track.locationRegion,
          city: track.location?.city || track.locationCity,
        },
        locationRegion: track.locationRegion || track.location?.region,
        locationCity: track.locationCity || track.location?.city,
        volunteersNeeded: 0,
        volunteers: [],
        joinedUserIds: [],
        createdAt: track.createdAt || now,
        updatedAt: track.updatedAt || now,
        statusUpdates: [],
        internalTasks: [],
        isEvent: false,
        icon: track.icon,
        color: track.color,
      } as Project;
    });
  const topLevelProjectPrograms = projects.filter(project => {
    const id = String(project.id || '').trim();
    const title = String(project.title || '').trim();
    const normalizedTitle = title.toLowerCase();
    if (project.isEvent || project.parentProjectId) {
      return false;
    }
    if (id.startsWith('project-proposal-') || proposalProjectIds.has(id) || proposalTitles.has(normalizedTitle)) {
      return false;
    }
    return normalizedTitle.includes('program');
  });
  const dashboardProgramById = new Map<string, Project>();
  [...programTrackRecords, ...topLevelProjectPrograms, ...programs]
    .filter(program => String(program.id || '').trim())
    .forEach(program => {
      dashboardProgramById.set(String(program.id || '').trim(), program);
    });
  const dashboardPrograms = Array.from(dashboardProgramById.values());

  return {
    users: (coreItems[STORAGE_KEYS.USERS] as User[] | null) || [],
    projects: mergeProjectAndEventRecords(
      [...dashboardPrograms, ...projects],
      coreItems[STORAGE_KEYS.EVENTS] as Project[] | null
    ),
    programs: dashboardPrograms,
    events: (coreItems[STORAGE_KEYS.EVENTS] as Project[] | null) || [],
    partners,
    volunteers: (coreItems[STORAGE_KEYS.VOLUNTEERS] as Volunteer[] | null) || [],
    statusUpdates: (coreItems[STORAGE_KEYS.STATUS_UPDATES] as StatusUpdate[] | null) || [],
    partnerApplications,
    partnerReports: (coreItems[STORAGE_KEYS.PARTNER_REPORTS] as PartnerReport[] | null) || [],
    volunteerMatches: (supplementalItems[STORAGE_KEYS.VOLUNTEER_MATCHES] as VolunteerProjectMatch[] | null) || [],
    volunteerTimeLogs: (supplementalItems[STORAGE_KEYS.VOLUNTEER_TIME_LOGS] as VolunteerTimeLog[] | null) || [],
    volunteerProjectJoins: (supplementalItems[STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS] as VolunteerProjectJoinRecord[] | null) || [],
    adminPlanningCalendars: (coreItems[STORAGE_KEYS.ADMIN_PLANNING_CALENDARS] as AdminPlanningCalendar[] | null) || [],
    adminPlanningItems: collectPlanningItemsFromCalendars(
      (coreItems[STORAGE_KEYS.ADMIN_PLANNING_CALENDARS] as AdminPlanningCalendar[] | null) || []
    ),
  };
}

// Loads the shared planning calendar data used by volunteer and partner dashboards.
// OPTIMIZED: Selective loading to minimize egress usage.
// Core collections fetched immediately, supplemental data loaded on-demand in background.
export async function getDashboardTimelineSnapshot(): Promise<DashboardTimelineSnapshot> {
  try {
    const planningCalendars = await ensureAdminPlanningCalendarsSeeded();

    // CORE LOAD: Timeline critical data only
    const coreItems = await getStorageItemsFast([
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.PROGRAMS,
      STORAGE_KEYS.EVENTS,
      STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
    ]);

    // LAZY LOAD: Supplemental data in background, non-blocking
    (async () => {
      try {
        await getStorageItemsFast([
          STORAGE_KEYS.USERS,
          STORAGE_KEYS.PARTNERS,
          STORAGE_KEYS.VOLUNTEERS,
          STORAGE_KEYS.STATUS_UPDATES,
          STORAGE_KEYS.VOLUNTEER_MATCHES,
          STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
          STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
          STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
          STORAGE_KEYS.PARTNER_REPORTS,
        ]);
      } catch (error) {
        console.warn('Supplemental timeline data failed to load (non-blocking):', error);
      }
    })();

    const programs = (coreItems[STORAGE_KEYS.PROGRAMS] as Project[] | null) || [];
    const projects = mergeProjectAndEventRecords(
      programs.length > 0 ? programs : (coreItems[STORAGE_KEYS.PROJECTS] as Project[] | null),
      coreItems[STORAGE_KEYS.EVENTS] as Project[] | null
    );
    const planningItems = collectPlanningItemsFromCalendars(
      (coreItems[STORAGE_KEYS.ADMIN_PLANNING_CALENDARS] as AdminPlanningCalendar[] | null) || []
    );

    return {
      projects,
      planningCalendars,
      planningItems,
    };
  } catch (error) {
    console.error('Error fetching dashboard timeline snapshot:', error);
    // Gracefully return empty data if backend is unavailable
    return {
      projects: [],
      planningCalendars: DEFAULT_ADMIN_PLANNING_CALENDARS,
      planningItems: [],
    };
  }
}

// Loads the combined project, volunteer, and application data for the projects screen.
export async function getProjectsScreenSnapshot(
  user?: Pick<User, 'id' | 'role'> | null,
  fields?: string[],
  forceRefresh: boolean = false
): Promise<ProjectsScreenSnapshot> {
  const params = new URLSearchParams();
  if (user?.id) {
    params.set('user_id', user.id);
  }
  if (user?.role) {
    params.set('role', user.role);
  }
  if (fields && fields.length > 0) {
    params.set('fields', fields.join(','));
  }

  const cacheKey = `snapshot:${params.toString()}`;
  const cached = projectsSnapshotCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < PROJECTS_SNAPSHOT_CACHE_TTL_MS) {
    console.log(`[Data] ProjectsSnapshot cache hit (${cacheKey.slice(0, 40)}...)`);
    return cached.data as ProjectsScreenSnapshot;
  }

  const query = params.toString();
  const timerLabel = `[Data] ProjectsSnapshot (${user?.role || 'unknown'})`;
  console.time(timerLabel);
  const snapshotStart = Date.now();

  const payload = await requestApiJson<Partial<ProjectsScreenSnapshot>>(
    `/projects/snapshot${query ? `?${query}` : ''}`
  );

  const normalizedPrograms = (payload.programs || []).map(program => normalizeProjectRecord(program));
  const payloadProgramTracks = Array.isArray(payload.programTracks) ? payload.programTracks : [];
  const normalizedProgramTracks =
    payloadProgramTracks.length > 0
      ? payloadProgramTracks
      : normalizedPrograms
        .filter(program => !program.parentProjectId && !program.isEvent)
        .map(program => ({
          id: program.id,
          title: program.title,
          description: program.description,
          icon: program.icon,
          color: program.color,
          imageUrl: program.imageUrl,
          sortOrder: 0,
          isActive: true,
          createdAt: program.createdAt,
          updatedAt: program.updatedAt,
        }));

  const result = {
    projects: (payload.projects || []).map(project =>
      project?.isEvent ? normalizeEventRecord(project) : normalizeProjectRecord(project)
    ),
    programTracks: normalizedProgramTracks,
    programs: normalizedPrograms,
    volunteerProfile: payload.volunteerProfile || null,
    volunteerMatches: payload.volunteerMatches || [],
    timeLogs: payload.timeLogs || [],
    partnerApplications: payload.partnerApplications || [],
    volunteerJoinRecords: payload.volunteerJoinRecords || [],
  };

  projectsSnapshotCache.set(cacheKey, { data: result, timestamp: Date.now() });
  console.timeEnd(timerLabel);
  console.log(`[Data] ProjectsSnapshot fetched ${result.projects?.length || 0} projects in ${Date.now() - snapshotStart}ms`);
  return result;
}

// Writes one storage value to the backend and local cache.
export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (isLocalOnlyStorageKey(key)) {
    await setLocalStorageItem(key, value);
    return;
  }

  try {
    await saveRemoteStorageItem(key, value);
    setSharedStorageCacheValue(key, value);
    projectsSnapshotCache.clear();
  } catch (error) {
    if (isExpectedRemoteStorageError(error) || isAbortLikeError(error)) {
      await setLocalStorageItem(key, value);
      setSharedStorageCacheValue(key, value);
      projectsSnapshotCache.clear();
      queueSharedStorageChangedKeys([key]);
      return;
    }

    console.error(`Error saving shared ${key} to backend:`, error);
    throw error;
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  const stored = await getStorageItem<Partial<AppSettings>>(STORAGE_KEYS.APP_SETTINGS);
  return {
    ...DEFAULT_APP_SETTINGS,
    ...(stored || {}),
  };
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getAppSettings();
  await setStorageItem(STORAGE_KEYS.APP_SETTINGS, {
    ...current,
    ...settings,
  });
}

export async function getAllProgramTracks(): Promise<ProgramTrack[]> {
  // Programs are now stored ONLY in the programs table.
  // Always fetch fresh from the network so deleted programs are never returned
  // from a stale in-memory or localStorage cache.
  invalidateSharedStorageCache([STORAGE_KEYS.PROGRAMS]);
  const allPrograms = (await getStorageItem<Project[]>(STORAGE_KEYS.PROGRAMS)) || [];

  // Convert top-level programs to ProgramTrack format
  const programTracks: ProgramTrack[] = allPrograms
    .filter(program => !program.parentProjectId && !program.isEvent)
    .map(program => ({
      id: program.id,
      title: program.title,
      description: program.description,
      location: program.location,
      locationRegion: program.locationRegion || program.location?.region,
      locationCity: program.locationCity || program.location?.city,
      icon: program.icon,
      color: program.color,
      imageUrl: program.imageUrl,
      sortOrder: 0,
      isActive: true,
      createdAt: program.createdAt,
      updatedAt: program.updatedAt,
    }));

  return programTracks;
}

export async function saveProgram(program: ProgramTrack): Promise<void> {
  // Programs are stored as Project records in the 'programs' collection
  const allPrograms = (await getStorageItem<Project[]>(STORAGE_KEYS.PROGRAMS)) || [];
  const now = new Date().toISOString();
  const programId = String(program.id || program.title).trim();
  const programFocusText = `${programId} ${program.title || ''}`.toLowerCase();
  const inferredCategory =
    programFocusText.includes('nutrition')
      ? 'Nutrition'
      : programFocusText.includes('education')
        ? 'Education'
        : programFocusText.includes('livelihood')
          ? 'Livelihood'
          : programFocusText.includes('disaster')
            ? 'Disaster'
            : 'Disaster';

  // Convert ProgramTrack to Project record
  const projectRecord: Project = {
    id: programId,
    title: program.title.trim(),
    description: program.description || '',
    partnerId: '',
    status: 'Planning',
    category: ((program as any).category || inferredCategory) as Project['category'],
    programModule: ((program as any).programModule || (program as any).category || inferredCategory) as AdvocacyFocus,
    startDate: program.createdAt || now,
    endDate: program.updatedAt || now,
    location: {
      latitude: program.location?.latitude || 0,
      longitude: program.location?.longitude || 0,
      address: program.location?.address || [program.locationCity, program.locationRegion].filter(Boolean).join(', '),
      region: program.location?.region || program.locationRegion,
      city: program.location?.city || program.locationCity,
    },
    locationRegion: program.locationRegion || program.location?.region,
    locationCity: program.locationCity || program.location?.city,
    volunteersNeeded: 0,
    volunteers: [],
    joinedUserIds: [],
    imageUrl: program.imageUrl || '',
    imageHidden: false,
    parentProjectId: undefined, // Top-level program
    isEvent: false,
    createdAt: program.createdAt || now,
    updatedAt: now,
    statusUpdates: [],
    icon: (program as any).icon || 'folder',
    color: (program as any).color || '#6366f1',
  };

  const existingIndex = allPrograms.findIndex(entry => entry.id === programId);
  if (existingIndex >= 0) {
    // Preserve original createdAt for updates
    projectRecord.createdAt = allPrograms[existingIndex].createdAt;
    allPrograms[existingIndex] = projectRecord;
  } else {
    allPrograms.push(projectRecord);
  }

  await setStorageItem(STORAGE_KEYS.PROGRAMS, allPrograms);
  // Clear both shared and snapshot caches so mobile app sees changes immediately
  invalidateSharedStorageCache([STORAGE_KEYS.PROGRAM_TRACKS]);
  projectsSnapshotCache.clear();
}

export async function deleteProgram(programId: string): Promise<void> {
  const normalizedProgramId = String(programId || '').trim();

  try {
    await fetchApiResponse(`/program-tracks/${encodeURIComponent(normalizedProgramId)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!message.toLowerCase().includes('program track not found')) {
      throw error;
    }
  }

  // The backend endpoint deletes the canonical program row and cascades linked data.
  // Avoid rewriting client-side cached collections after the mutation, which can
  // restore the deleted program when stale cache entries are still warm.
  const changedKeys = [
    STORAGE_KEYS.PROGRAM_TRACKS,
    STORAGE_KEYS.PROGRAMS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.STATUS_UPDATES,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
    STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
  ];
  invalidateSharedStorageCache(changedKeys);
  await Promise.all(changedKeys.map(key => deleteLocalStorageItem(key)));
  projectsSnapshotCache.clear();
  notifyStorageChanged(changedKeys);
}

// User Storage
// Inserts or updates a user record inside shared storage.
export async function saveUser(user: User): Promise<void> {
  const normalizedEmail = user.email?.trim().toLowerCase() || undefined;
  const normalizedPhone = normalizeAccountPhone(user.phone);
  if (normalizedEmail && !isValidEmailAddress(normalizedEmail)) {
    throw new Error('Please enter a valid email address.');
  }
  if (user.phone?.trim() && !normalizedPhone) {
    throw new Error('Use a valid Philippine mobile number in 11-digit or +63 format.');
  }

  const normalizedUser: User = {
    ...user,
    name: user.name.trim(),
    email: normalizedEmail,
    phone: normalizedPhone || undefined,
  };
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  const existingIndex = users.findIndex(u => u.id === normalizedUser.id);
  if (existingIndex >= 0) {
    users[existingIndex] = normalizedUser;
  } else {
    users.push(normalizedUser);
  }
  await setStorageItem(STORAGE_KEYS.USERS, users);
}

// Validates DSWD accreditation numbers before partner applications are saved.
export function isValidDswdAccreditationNo(value: string): boolean {
  const normalizedValue = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9\-\/]{5,}$/.test(normalizedValue);
}

// Validates DSWD accreditation number against database (format + assignment check).
export async function validateDswdAccreditationNo(value: string): Promise<{ valid: boolean; reason?: string }> {
  const normalizedValue = value.trim().toUpperCase();

  // First check basic format
  if (!isValidDswdAccreditationNo(value)) {
    return { valid: false, reason: 'Invalid format' };
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/validation/dswd-accreditation/${encodeURIComponent(normalizedValue)}`, {
      headers: {
        'ngrok-skip-browser-warning': '69420',
        'User-Agent': 'VolCre-App/1.0',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) {
      return { valid: false, reason: 'Network error' };
    }
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error validating DSWD accreditation number:', error);
    return { valid: false, reason: 'Network error' };
  }
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeAccountPhone(value?: string): string | undefined {
  const digits = (value || '').replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) {
    return digits;
  }
  if (/^639\d{9}$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  return undefined;
}

function normalizePartnerContactPhone(value?: string): string | undefined {
  return normalizeAccountPhone(value);
}

// Maps one advocacy focus into the existing project/partner category taxonomy.
function getCategoryFromAdvocacyFocus(focuses: AdvocacyFocus[]): Partner['category'] {
  if (focuses.includes('Disaster')) {
    return 'Disaster';
  }
  if (focuses.includes('Education')) {
    return 'Education';
  }
  if (focuses.includes('Livelihood')) {
    return 'Livelihood';
  }
  if (focuses.includes('Nutrition')) {
    return 'Nutrition';
  }
  return 'Disaster';
}

// Upgrades older partner records so the newer workflow can rely on required fields.
function normalizePartnerRecord(partner: Partner): Partner {
  const advocacyFocus = (partner.advocacyFocus || []).filter(Boolean);
  const rawCategory = partner.category as string | undefined;
  const derivedCategory =
    !rawCategory || rawCategory === 'Other'
      ? getCategoryFromAdvocacyFocus(advocacyFocus)
      : partner.category;

  return {
    ...partner,
    description: partner.description?.trim() || '',
    category: derivedCategory,
    sectorType: partner.sectorType || 'NGO',
    dswdAccreditationNo: partner.dswdAccreditationNo?.trim().toUpperCase() || '',
    secRegistrationNo: partner.secRegistrationNo?.trim().toUpperCase() || '',
    advocacyFocus,
    contactEmail: partner.contactEmail?.trim().toLowerCase() || '',
    contactPhone: normalizePartnerContactPhone(partner.contactPhone) || '',
    address: partner.address?.trim() || '',
    verificationStatus:
      partner.verificationStatus ||
      (partner.status === 'Approved' ? 'Verified' : 'Pending'),
  };
}

function buildSampleProjectTasks(project: Project): ProjectInternalTask[] {
  const now = new Date().toISOString();
  const createTask = (
    idSuffix: string,
    title: string,
    description: string,
    category: string,
    priority: ProjectInternalTask['priority'],
    skillsNeeded?: string[]
  ): ProjectInternalTask => {
    // Use 'event-' prefix for event tasks, 'task-' for project tasks
    const prefix = project.isEvent ? 'event-' : 'task-';
    return {
      id: `${prefix}${project.id}-${idSuffix}`,
      title,
      description,
      category,
      priority,
      status: 'Unassigned',
      skillsNeeded: skillsNeeded || [],
      createdAt: now,
      updatedAt: now,
    };
  };

  const normalizedTitle = project.title.trim().toLowerCase();

  if (normalizedTitle.includes('mingo for nutritional support')) {
    return [
      createTask(
        'registration',
        'Registration of the Kids',
        'Handle child registration when the children are gathered in the common area before services begin.',
        'Front Desk',
        'High',
        ['organization', 'communication']
      ),
      createTask(
        'assessment',
        'Rapid Assessment Interviews',
        'Conduct condensed caregiver interviews using the shortened assessment tool. Best assigned to senior volunteers who can follow the questionnaire closely.',
        'Assessment',
        'High',
        ['interviewing', 'assessment', 'communication']
      ),
      createTask(
        'measurement',
        'Measurement',
        'Measure each child\'s height and weight accurately and prepare the values for encoding.',
        'Health Screening',
        'High',
        ['measurement', 'healthcare', 'accuracy']
      ),
      createTask(
        'encoding',
        'Encoding',
        'Encode all assessment and measurement data into the project records for reporting and monitoring.',
        'Data Encoding',
        'Medium',
        ['data entry', 'computer skills', 'attention to detail']
      ),
      createTask(
        'photo-documentation',
        'Photo Documentation',
        'Manage the photo booth and capture child photos for growth tracking and enrollment validation.',
        'Documentation',
        'Medium',
        ['photography', 'organization', 'technical skills']
      ),
      createTask(
        'wellness-counseling',
        'Wellness Counseling',
        'Advise mothers or caregivers using previous data and follow-through questions about the child\'s progress. Best assigned to senior volunteers.',
        'Counseling',
        'High',
        ['counseling', 'communication', 'healthcare knowledge']
      ),
      createTask(
        'entertainment',
        'Entertainment',
        'Lead child-friendly engagement activities while families wait and keep the common area organized.',
        'Youth Engagement',
        'Low',
        ['childcare', 'entertainment', 'organization']
      ),
      createTask(
        'packing',
        'Packing Activities',
        'Assist with packing nutrition materials, supplies, or take-home items before and after distribution.',
        'Operations',
        'Medium',
        ['organization', 'packing', 'logistics']
      ),
    ];
  }

  if (project.programModule === 'Nutrition') {
    return [
      createTask('registration', 'Beneficiary Registration', 'Register participants and confirm attendance before the nutrition activity starts.', 'Front Desk', 'High', ['organization', 'communication']),
      createTask('preparation', 'Nutrition Pack Preparation', 'Prepare food packs, supplements, or feeding materials for the service area.', 'Operations', 'High', ['food handling', 'organization', 'logistics']),
      createTask('monitoring', 'Growth Monitoring Support', 'Support measurements, queue management, and beneficiary monitoring during the activity.', 'Field Support', 'Medium', ['measurement', 'organization', 'healthcare']),
      createTask('documentation', 'Documentation and Photos', 'Capture photos and activity notes for reporting and monitoring.', 'Documentation', 'Medium', ['photography', 'documentation', 'communication']),
      createTask('cleanup', 'Site Wrap-Up', 'Help consolidate materials, clean the area, and verify remaining inventory.', 'Operations', 'Low', ['cleanup', 'organization', 'inventory management']),
    ];
  }

  if (project.programModule === 'Education') {
    return [
      createTask('registration', 'Learner Registration', 'Check in learners and guardians, confirm attendance, and guide them to the proper station.', 'Front Desk', 'High', ['organization', 'communication', 'customer service']),
      createTask('materials', 'Learning Materials Setup', 'Prepare handouts, kits, and learning materials before the session begins.', 'Operations', 'Medium', ['organization', 'preparation', 'logistics']),
      createTask('facilitation', 'Facilitation Support', 'Assist the lead facilitator, manage transitions, and support small-group learning.', 'Program Support', 'High', ['teaching', 'facilitation', 'communication']),
      createTask('attendance', 'Attendance and Notes Encoding', 'Encode attendance, outputs, and key observations after the session.', 'Data Encoding', 'Medium', ['data entry', 'attention to detail', 'computer skills']),
      createTask('documentation', 'Photo and Story Capture', 'Capture session highlights and beneficiary stories for reporting.', 'Documentation', 'Low', ['photography', 'storytelling', 'communication']),
    ];
  }

  if (project.programModule === 'Livelihood') {
    return [
      createTask('registration', 'Participant Sign-In', 'Manage participant sign-in and orient arrivals to the workshop flow.', 'Front Desk', 'High', ['organization', 'communication', 'customer service']),
      createTask('materials', 'Workshop Materials Preparation', 'Prepare tools, consumables, and handouts required for the livelihood session.', 'Operations', 'High', ['organization', 'preparation', 'logistics']),
      createTask('support', 'Workshop Support', 'Assist facilitators during demonstrations, breakout work, or production activities.', 'Program Support', 'Medium', ['teaching', 'facilitation', 'technical skills']),
      createTask('inventory', 'Inventory and Output Tracking', 'Track distributed materials and completed outputs from participants.', 'Inventory', 'Medium', ['inventory management', 'data entry', 'attention to detail']),
      createTask('documentation', 'Photo Documentation', 'Capture workshop activities and outputs for monitoring and reporting.', 'Documentation', 'Low', ['photography', 'documentation']),
    ];
  }

  return [
    createTask('coordination', 'Field Coordination', 'Support the project lead with on-site coordination and participant flow.', 'Operations', 'High', ['coordination', 'leadership', 'organization']),
    createTask('logistics', 'Logistics Support', 'Prepare supplies, manage equipment, and keep the work area organized.', 'Operations', 'Medium', ['logistics', 'organization', 'equipment management']),
    createTask('beneficiary', 'Beneficiary Assistance', 'Assist attendees, answer questions, and route them to the proper station.', 'Field Support', 'Medium', ['communication', 'customer service', 'guidance']),
    createTask('documentation', 'Documentation', 'Capture activity notes and photos for project monitoring.', 'Documentation', 'Low', ['documentation', 'photography', 'note-taking']),
  ];
}

function normalizeProjectInternalTask(
  task: ProjectInternalTask,
  projectId: string
): ProjectInternalTask {
  const now = new Date().toISOString();
  const assignedVolunteerIds = Array.from(
    new Set(
      [
        ...(Array.isArray(task.assignedVolunteerIds) ? task.assignedVolunteerIds : []),
        task.assignedVolunteerId,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  );
  const assignedVolunteerNames = Array.from(
    new Set(
      [
        ...(Array.isArray(task.assignedVolunteerNames) ? task.assignedVolunteerNames : []),
        task.assignedVolunteerName,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  );
  return {
    ...task,
    id: task.id || `task-${projectId}-${Date.now()}`,
    title: task.title?.trim() || 'Untitled Task',
    description: task.description?.trim() || '',
    category: task.category?.trim() || 'General',
    priority: task.priority || 'Medium',
    status: task.status || (assignedVolunteerIds.length > 0 ? 'Assigned' : 'Unassigned'),
    assignedVolunteerId: assignedVolunteerIds[0] || undefined,
    assignedVolunteerName: assignedVolunteerNames[0] || undefined,
    assignedVolunteerIds: assignedVolunteerIds.length ? assignedVolunteerIds : undefined,
    assignedVolunteerNames: assignedVolunteerNames.length ? assignedVolunteerNames : undefined,
    isFieldOfficer: Boolean(task.isFieldOfficer),
    skillsNeeded: task.skillsNeeded || [],
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now,
  };
}

function normalizeProjectSkillsNeeded(
  project: Project,
  normalizedTasks: ProjectInternalTask[]
): string[] {
  const rawSkills = [
    ...(project.skillsNeeded || []),
    ...normalizedTasks.flatMap(task => task.skillsNeeded || []),
  ]
    .map(skill => skill.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  return rawSkills.filter(skill => {
    const key = skill.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeProjectRecord(project: Project): Project {
  const normalizedTasks =
    project.internalTasks && project.internalTasks.length > 0
      ? project.internalTasks.map(task => normalizeProjectInternalTask(task, project.id))
      : [];
  const normalizedCategory =
    (project.category as string) === 'Other'
      ? 'Disaster'
      : project.category || (project.programModule || 'Disaster');
  const normalizedProgramModule =
    project.programModule ||
    ((project.category as string) === 'Other'
      ? 'Disaster'
      : (project.category as AdvocacyFocus | undefined)) ||
    'Disaster';

  return {
    ...project,
    imageUrl: project.imageUrl?.trim() || undefined,
    imageHidden: Boolean(project.imageHidden),
    category: normalizedCategory,
    programModule: normalizedProgramModule,
    parentProjectId: project.parentProjectId?.trim() || undefined,
    joinedUserIds: project.isEvent ? (project.joinedUserIds || []) : [],
    volunteers: project.isEvent ? (project.volunteers || []) : [],
    skillsNeeded: normalizeProjectSkillsNeeded(project, normalizedTasks),
    statusUpdates: project.statusUpdates || [],
    internalTasks: normalizedTasks,
  };
}

function normalizeEventRecord(event: Project): Project {
  const normalized = normalizeProjectRecord(event);
  const eventWithFlag = {
    ...normalized,
    isEvent: true,
  };

  return ensureFieldOfficerTaskForEvent(eventWithFlag);
}

function isCurrentOrFutureEvent(project: Project): boolean {
  if (!project?.isEvent) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventEndDate = new Date(project.endDate);
  if (!Number.isNaN(eventEndDate.getTime())) {
    return eventEndDate >= today;
  }

  const eventStartDate = new Date(project.startDate);
  return !Number.isNaN(eventStartDate.getTime()) && eventStartDate >= today;
}

function ensureFieldOfficerTaskForEvent(event: Project): Project {
  if (!isCurrentOrFutureEvent(event)) {
    return event;
  }
  if ((event.internalTasks || []).some(task => task.isFieldOfficer)) {
    return event;
  }

  const now = new Date().toISOString();
  return {
    ...event,
    internalTasks: [
      ...(event.internalTasks || []),
      {
        id: `${event.id}-field-officer-${Date.now()}`,
        title: 'Field Officer',
        description: 'Manage attendance tracking and volunteer coordination for this event.',
        category: 'Field Coordination',
        priority: 'High',
        status: 'Assigned',
        isFieldOfficer: true,
        skillsNeeded: ['Leadership', 'Communication'],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function isVolunteerJoinableEvent(project: Project | null | undefined): project is Project {
  return Boolean(project?.isEvent);
}

function mergeProjectAndEventRecords(
  projects: Project[] | null | undefined,
  events: Project[] | null | undefined
): Project[] {
  const normalizedProjects = (projects || []).map(project =>
    normalizeProjectRecord({
      ...project,
      isEvent: false,
      // Don't strip parentProjectId - projects can have parents (programs)
    })
  );
  const normalizedEvents = (events || []).map(event =>
    normalizeEventRecord(event)
  );
  const mergedById = new Map<string, Project>();

  normalizedProjects.forEach(project => {
    mergedById.set(project.id, project);
  });

  // Event entries take precedence so a duplicated id is represented once as an event.
  normalizedEvents.forEach(event => {
    mergedById.set(event.id, event);
  });

  return Array.from(mergedById.values());
}

function removeProjectIdsFromVolunteerHistory(
  volunteers: Volunteer[] | null | undefined,
  removedProjectIds: Set<string>
): Volunteer[] {
  return (volunteers || []).map(volunteer => ({
    ...volunteer,
    pastProjects: (volunteer.pastProjects || []).filter(projectId => !removedProjectIds.has(projectId)),
  }));
}

function removeProjectIdsFromPlanningCalendars(
  calendars: AdminPlanningCalendar[] | null | undefined,
  removedProjectIds: Set<string>
): AdminPlanningCalendar[] {
  return (calendars || []).map(calendar => ({
    ...calendar,
    planningItems: (calendar.planningItems || []).filter(
      item => !item.linkedProjectId || !removedProjectIds.has(item.linkedProjectId)
    ),
    updatedAt: new Date().toISOString(),
  }));
}

export async function getAllEvents(): Promise<Project[]> {
  return ((await getStorageItemFast<Project[]>(STORAGE_KEYS.EVENTS)) || []).map(
    normalizeEventRecord
  );
}

function getRegistrationPasswordValidationMessage(password: string): string | null {
  const trimmedPassword = password.trim();
  if (trimmedPassword.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Z]/.test(trimmedPassword)) {
    return 'Password must include at least one uppercase letter.';
  }
  if (!/[a-z]/.test(trimmedPassword)) {
    return 'Password must include at least one lowercase letter.';
  }
  if (!/\d/.test(trimmedPassword)) {
    return 'Password must include at least one number.';
  }
  return null;
}

// Creates a new sign-in account and optional volunteer profile records.
export async function createUserAccount(input: {
  name: string;
  email?: string;
  password?: string; // Deprecated: OTP auth — no password needed
  phone?: string;
  role: UserRole;
  userType: UserType;
  pillarsOfInterest: NVCSector[];
  partnerRegistration?: {
    organizationName: string;
    stakeholderName?: string;
    sectorType: PartnerSectorType;
    dswdAccreditationNo?: string;
    secRegistrationNo?: string;
    advocacyFocus: AdvocacyFocus[];
  };
  volunteerMembershipSheet?: {
    gender: string;
    dateOfBirth: string;
    civilStatus: string;
    homeAddress: string;
    homeAddressRegion?: string;
    homeAddressCityMunicipality?: string;
    homeAddressBarangay?: string;
    occupation: string;
    workplaceOrSchool: string;
    collegeCourse?: string;
    certificationsOrTrainings?: string;
    hobbiesAndInterests?: string;
    specialSkills?: string;
    validIdPhoto?: string;
    skills: string[];
    videoBriefingUrl?: string;
    affiliations?: Array<{
      organization: string;
      position: string;
    }>;
  };
}): Promise<User> {
  const normalizedEmail = input.email?.trim().toLowerCase();
  const normalizedName = input.name.trim();
  const normalizedPassword = input.password?.trim() || '';
  const normalizedPhone = normalizeAccountPhone(input.phone);

  if (!normalizedName) {
    throw new Error('Name is required.');
  }

  if (input.role === 'partner' || input.role === 'volunteer') {
    const passwordValidationMessage =
      getRegistrationPasswordValidationMessage(normalizedPassword);
    if (passwordValidationMessage) {
      throw new Error(passwordValidationMessage);
    }
  }

  if (normalizedEmail && !isValidEmailAddress(normalizedEmail)) {
    throw new Error('Please enter a valid email address.');
  }

  if (!normalizedEmail && !normalizedPhone) {
    throw new Error('Email or phone is required.');
  }

  if (input.phone?.trim() && !normalizedPhone) {
    throw new Error('Use a valid Philippine mobile number in 11-digit or +63 format.');
  }

  if (
    input.role === 'partner' &&
    (!input.partnerRegistration ||
      !input.partnerRegistration.organizationName.trim() ||
      input.partnerRegistration.advocacyFocus.length === 0)
  ) {
    throw new Error('Complete the organization application details before submitting.');
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
    ...(normalizedPassword ? { password: normalizedPassword } : {}),
    phone: normalizedPhone || undefined,
    role: input.role,
    userType: input.userType,
    pillarsOfInterest: input.pillarsOfInterest,
    approvalStatus: input.role === 'admin' ? 'approved' : 'pending',
    createdAt,
  };

  await saveUser(createdUser);

  if (input.role === 'volunteer') {
    try {
      await saveVolunteer({
        id: `volunteer-${createdUser.id}`,
        userId: createdUser.id,
        name: createdUser.name,
        email: createdUser.email || '',
        phone: createdUser.phone || '',
        skills: input.volunteerMembershipSheet?.skills || [],
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
        homeAddressRegion: input.volunteerMembershipSheet?.homeAddressRegion || '',
        homeAddressCityMunicipality: input.volunteerMembershipSheet?.homeAddressCityMunicipality || '',
        homeAddressBarangay: input.volunteerMembershipSheet?.homeAddressBarangay || '',
        occupation: input.volunteerMembershipSheet?.occupation || '',
        workplaceOrSchool: input.volunteerMembershipSheet?.workplaceOrSchool || '',
        collegeCourse: input.volunteerMembershipSheet?.collegeCourse || '',
        certificationsOrTrainings:
          input.volunteerMembershipSheet?.certificationsOrTrainings || '',
        hobbiesAndInterests: input.volunteerMembershipSheet?.hobbiesAndInterests || '',
        specialSkills: input.volunteerMembershipSheet?.specialSkills || '',
        videoBriefingUrl: input.volunteerMembershipSheet?.videoBriefingUrl || '',
        affiliations: input.volunteerMembershipSheet?.affiliations || [],
        registrationStatus: 'Pending',
        createdAt,
      });
    } catch (error) {
      console.error('Error saving volunteer profile:', error);
      throw new Error(`Failed to create volunteer profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  if (input.role === 'partner' && input.partnerRegistration) {
    try {
      await savePartner({
        id: `partner-${createdUser.id}`,
        ownerUserId: createdUser.id,
        name: input.partnerRegistration.organizationName.trim(),
        description: `${input.partnerRegistration.advocacyFocus.join(', ')} partnership application`,
        category: getCategoryFromAdvocacyFocus(input.partnerRegistration.advocacyFocus),
        sectorType: input.partnerRegistration.sectorType,
        dswdAccreditationNo: input.partnerRegistration.dswdAccreditationNo?.trim().toUpperCase() || '',
        secRegistrationNo: input.partnerRegistration.secRegistrationNo?.trim().toUpperCase() || '',
        advocacyFocus: input.partnerRegistration.advocacyFocus,
        contactEmail: createdUser.email,
        contactPhone: createdUser.phone,
        status: 'Pending',
        verificationStatus: 'Pending',
        createdAt,
      });
    } catch (error) {
      console.error('Error saving partner profile:', error);
      throw new Error(`Failed to create partner profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  const savedUser = await getUser(createdUser.id);
  if (!savedUser) {
    throw new Error('Account creation did not sync correctly. Please try again.');
  }

  return createdUser;
}

// Looks up a single user by id.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getUser(id: string): Promise<User | null> {
  const users = await getStorageItemFast<User[]>(STORAGE_KEYS.USERS) || [];
  return users.find(u => u.id === id) || null;
}

// Looks up a single user by email address.
export async function getUserByEmail(email: string): Promise<User | null> {
  return getUserByEmailOrPhone(email);
}

function getLoginIdentifierUsernameAlias(identifier: string): string {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier || normalizedIdentifier.includes('@')) {
    return '';
  }

  const phoneLikeIdentifier = normalizedIdentifier.replace(/[+\-()\s]/g, '');
  if (/^\d+$/.test(phoneLikeIdentifier)) {
    return '';
  }
  return normalizedIdentifier;
}

function getMatchingUserByLoginIdentifier(users: User[], identifier: string): User | null {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const usernameAlias = getLoginIdentifierUsernameAlias(identifier);
  const normalizedPhone = normalizeComparablePhone(identifier);

  return (
    users.find(user => {
      const normalizedUserEmail = user.email?.trim().toLowerCase() || '';
      const normalizedUserPhone = normalizeComparablePhone(user.phone);

      if (normalizedUserEmail && normalizedUserEmail === normalizedIdentifier) {
        return true;
      }

      if (
        usernameAlias &&
        normalizedUserEmail &&
        normalizedUserEmail.split('@', 1)[0] === usernameAlias
      ) {
        return true;
      }

      return Boolean(
        normalizedPhone &&
        normalizedUserPhone &&
        normalizedUserPhone === normalizedPhone
      );
    }) || null
  );
}

async function canVolunteerLogin(user: User): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  if (user.role !== 'volunteer') {
    return { allowed: true };
  }

  const volunteers = await getLinkedVolunteersForUserAccount(user);
  const approvedVolunteer = volunteers.find(
    volunteer => (volunteer.registrationStatus || 'Approved') === 'Approved'
  );
  if (approvedVolunteer) {
    return { allowed: true };
  }

  const rejectedVolunteer = volunteers.find(
    volunteer => volunteer.registrationStatus === 'Rejected'
  );
  if (rejectedVolunteer) {
    return {
      allowed: false,
      reason: 'Your volunteer account was rejected. Please contact the admin team.',
    };
  }

  if (volunteers.length > 0) {
    return {
      allowed: false,
      reason: 'Your volunteer account is still pending approval.',
    };
  }

  return {
    allowed: false,
    reason: 'No volunteer profile is linked to this account yet.',
  };
}

async function loginWithStoredCredentials(
  identifier: string,
  password: string
): Promise<User | null> {
  const users = await getAllUsers();
  const matchedUser = getMatchingUserByLoginIdentifier(users, identifier);
  if (!matchedUser) {
    return null;
  }

  if ((matchedUser.password || '').trim() !== password.trim()) {
    return null;
  }

  const [volunteerAccess, partnerAccess] = await Promise.all([
    canVolunteerLogin(matchedUser),
    canPartnerLogin(matchedUser),
  ]);

  if (!volunteerAccess.allowed) {
    throw new Error(volunteerAccess.reason || 'Your volunteer account cannot log in right now.');
  }

  if (!partnerAccess.allowed) {
    throw new Error(partnerAccess.reason || 'Your partner account cannot log in right now.');
  }

  return matchedUser;
}

// Looks up a single user by email address, email username alias, or phone number.
export async function getUserByEmailOrPhone(identifier: string): Promise<User | null> {
  try {
    const payload = await requestApiJson<{ user?: User | null }>(
      `/users/lookup?identifier=${encodeURIComponent(identifier.trim())}`
    );
    if (payload.user) {
      return payload.user;
    }
  } catch {
    // Fall back to the mirrored shared users list when lookup is unavailable.
  }

  return getMatchingUserByLoginIdentifier(await getAllUsers(), identifier);
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
      return loginWithStoredCredentials(identifier, password);
    }

    const fallbackMessages = [
      'Database unavailable while checking your account. Please try again.',
      'Failed to fetch',
      'Network request failed',
      'Database Unavailable',
    ];
    if (fallbackMessages.some(message => String(error?.message || '').includes(message))) {
      return loginWithStoredCredentials(identifier, password);
    }

    throw error;
  }
}

// Returns all user accounts from shared storage.
export async function getAllUsers(): Promise<User[]> {
  return (await getStorageItemFast<User[]>(STORAGE_KEYS.USERS)) || [];
}

// Deletes a user account and related volunteer data when necessary.
export async function deleteUser(userId: string): Promise<void> {
  await requestApiJson(`/auth/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });

  const changedKeys = [
    STORAGE_KEYS.USERS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.PARTNERS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
  ];
  invalidateSharedStorageCache(changedKeys);
  notifyStorageChanged(changedKeys);

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

function userMatchesLinkedRecord(
  user: Pick<User, 'id' | 'email' | 'phone'>,
  linkedRecord: {
    ownerUserId?: string;
    userId?: string;
    email?: string;
    phone?: string;
  }
): boolean {
  const userId = user.id.trim();
  if (linkedRecord.ownerUserId?.trim() === userId || linkedRecord.userId?.trim() === userId) {
    return true;
  }

  const normalizedUserEmail = user.email?.trim().toLowerCase();
  if (
    normalizedUserEmail &&
    linkedRecord.email?.trim().toLowerCase() === normalizedUserEmail
  ) {
    return true;
  }

  const normalizedUserPhone = normalizeComparablePhone(user.phone);
  return Boolean(
    normalizedUserPhone &&
    normalizeComparablePhone(linkedRecord.phone) === normalizedUserPhone
  );
}

async function getLinkedVolunteersForUserAccount(user: User): Promise<Volunteer[]> {
  const volunteers = await getAllVolunteers();
  return volunteers.filter(volunteer =>
    userMatchesLinkedRecord(user, {
      userId: volunteer.userId,
      email: volunteer.email,
      phone: volunteer.phone,
    })
  );
}

async function getLinkedPartnerRecordsForUserAccount(user: User): Promise<Partner[]> {
  const partners = await getAllPartners();
  return partners.filter(partner =>
    userMatchesLinkedRecord(user, {
      ownerUserId: partner.ownerUserId,
      email: partner.contactEmail,
      phone: partner.contactPhone,
    })
  );
}

async function getLinkedUserAccountForVolunteer(volunteer: Volunteer): Promise<User | null> {
  if (volunteer.userId?.trim()) {
    const directUser = await getUser(volunteer.userId.trim());
    if (directUser) {
      return directUser;
    }
  }

  const users = await getAllUsers();
  return (
    users.find(
      user =>
        user.role === 'volunteer' &&
        userMatchesLinkedRecord(user, {
          userId: volunteer.userId,
          email: volunteer.email,
          phone: volunteer.phone,
        })
    ) || null
  );
}

async function getLinkedUserAccountForPartner(partner: Partner): Promise<User | null> {
  if (partner.ownerUserId?.trim()) {
    const directUser = await getUser(partner.ownerUserId.trim());
    if (directUser) {
      return directUser;
    }
  }

  const users = await getAllUsers();
  return (
    users.find(
      user =>
        user.role === 'partner' &&
        userMatchesLinkedRecord(user, {
          ownerUserId: partner.ownerUserId,
          email: partner.contactEmail,
          phone: partner.contactPhone,
        })
    ) || null
  );
}

// User Approval Management
// Gets all pending user accounts that need admin approval.
export async function getPendingUserApprovals(): Promise<User[]> {
  const users = await getAllUsers();
  return users.filter(
    user => user.role !== 'admin' && user.approvalStatus === 'pending'
  );
}

// Gets all approved users.
export async function getApprovedUsers(): Promise<User[]> {
  const users = await getAllUsers();
  return users.filter(user => user.approvalStatus === 'approved' || !user.approvalStatus);
}

// Approves a pending user account.
export async function approveUser(userId: string, adminId: string): Promise<User> {
  const user = await getUser(userId);
  if (!user) {
    throw new Error('User not found.');
  }

  const approvedAt = new Date().toISOString();
  const updatedUser: User = {
    ...user,
    approvalStatus: 'approved',
    approvedBy: adminId,
    approvedAt,
    rejectionReason: undefined,
  };

  await saveUser(updatedUser);

  if (updatedUser.role === 'volunteer') {
    const linkedVolunteers = await getLinkedVolunteersForUserAccount(updatedUser);
    await Promise.all(
      linkedVolunteers.map(volunteer =>
        saveVolunteer({
          ...volunteer,
          registrationStatus: 'Approved',
          reviewedBy: adminId,
          reviewedAt: approvedAt,
          credentialsUnlockedAt: approvedAt,
        })
      )
    );
  }

  if (updatedUser.role === 'partner') {
    const linkedPartners = await getLinkedPartnerRecordsForUserAccount(updatedUser);
    await Promise.all(
      linkedPartners.map(partner =>
        savePartner({
          ...partner,
          status: 'Approved',
          validatedBy: adminId,
          validatedAt: approvedAt,
          credentialsUnlockedAt: approvedAt,
        })
      )
    );
  }

  try {
    await sendAccountApprovalEmailNotification(updatedUser, adminId);
  } catch (error) {
    console.error('[ApprovalEmail] Failed to send account approval email:', error);
  }

  return updatedUser;
}

// Rejects a pending user account with an optional reason.
export async function rejectUser(
  userId: string,
  rejectionReason: string = 'Account rejected by administrator.',
  adminId?: string
): Promise<User> {
  const user = await getUser(userId);
  if (!user) {
    throw new Error('User not found.');
  }

  const reviewedAt = new Date().toISOString();
  const updatedUser: User = {
    ...user,
    approvalStatus: 'rejected',
    approvedBy: undefined,
    approvedAt: undefined,
    rejectionReason,
  };

  await saveUser(updatedUser);

  if (updatedUser.role === 'volunteer') {
    const linkedVolunteers = await getLinkedVolunteersForUserAccount(updatedUser);
    await Promise.all(
      linkedVolunteers.map(volunteer =>
        saveVolunteer({
          ...volunteer,
          registrationStatus: 'Rejected',
          rejectionReason,
          reviewedBy: adminId,
          reviewedAt,
          credentialsUnlockedAt: undefined,
        })
      )
    );
  }

  if (updatedUser.role === 'partner') {
    const linkedPartners = await getLinkedPartnerRecordsForUserAccount(updatedUser);
    await Promise.all(
      linkedPartners.map(partner =>
        savePartner({
          ...partner,
          status: 'Rejected',
          validatedBy: adminId,
          validatedAt: reviewedAt,
          credentialsUnlockedAt: undefined,
        })
      )
    );
  }

  if (updatedUser.email) {
    void sendRejectionEmail(
      updatedUser.email,
      updatedUser.name,
      rejectionReason,
      updatedUser.role || 'volunteer'
    );
  }

  return updatedUser;
}

// Sends an email to an applicant with the rejection reason.
export async function sendRejectionEmail(
  recipientEmail: string,
  recipientName: string,
  rejectionReason: string,
  role: string = 'volunteer'
): Promise<{ success: boolean; message: string }> {
  const normalizedEmail = (recipientEmail || '').trim();
  if (!normalizedEmail) {
    return { success: false, message: 'No recipient email provided.' };
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/auth/send-rejection-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientEmail: normalizedEmail,
        recipientName: (recipientName || 'Volunteer').trim(),
        rejectionReason: (rejectionReason || 'Application did not meet requirements.').trim(),
        role,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, message: data.message || 'Rejection email sent successfully.' };
    } else {
      console.warn('[EMAIL] Rejection email endpoint returned non-OK:', response.status);
      return { success: false, message: `Server returned ${response.status}` };
    }
  } catch (error) {
    console.warn('[EMAIL] Failed to send rejection email:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Network error' };
  }
}

// Partner Storage
// Inserts or updates a partner organization record.
export async function savePartner(partner: Partner): Promise<void> {
  if (partner.contactEmail?.trim() && !isValidEmailAddress(partner.contactEmail.trim().toLowerCase())) {
    throw new Error('Please enter a valid partner email address.');
  }
  if (partner.contactPhone?.trim() && !normalizePartnerContactPhone(partner.contactPhone)) {
    throw new Error('Use a valid 11-digit Philippine mobile number for the partner record.');
  }

  const partners = await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS) || [];
  const existingIndex = partners.findIndex(p => p.id === partner.id);
  const existingPartner = existingIndex >= 0 ? partners[existingIndex] : null;

  let ownerUserId = partner.ownerUserId || existingPartner?.ownerUserId;
  if (!ownerUserId && partner.contactEmail?.trim()) {
    const users = await getAllUsers();
    ownerUserId = users.find(user =>
      user.role === 'partner' &&
      user.email?.toLowerCase() === partner.contactEmail?.trim().toLowerCase()
    )?.id;
  }

  const normalizedPartner: Partner = {
    ...normalizePartnerRecord({
      ...existingPartner,
      ...partner,
      ownerUserId,
      name: partner.name.trim(),
    } as Partner),
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
  const partners = (await getStorageItemFast<Partner[]>(STORAGE_KEYS.PARTNERS)) || [];
  const partner = partners.find(p => p.id === id) || null;
  return partner ? normalizePartnerRecord(partner) : null;
}

// Returns partner organizations owned by a specific partner account.
export async function getPartnersByOwnerUserId(ownerUserId: string): Promise<Partner[]> {
  const partners = await getAllPartners();
  return partners.filter(partner => partner.ownerUserId === ownerUserId);
}

// Returns all partner organization records.
export async function getAllPartners(): Promise<Partner[]> {
  await ensurePartnerOwnershipLinks();
  const partners = (await getStorageItemFast<Partner[]>(STORAGE_KEYS.PARTNERS)) || [];
  return partners
    .map(normalizePartnerRecord)
    .filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));
}

// Checks whether a partner account already has admin-approved organization access.
export async function canPartnerLogin(user: User): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  if (user.role !== 'partner') {
    return { allowed: true };
  }

  const partners = await getPartnersByOwnerUserId(user.id);
  const approvedPartner = partners.find(partner => partner.status === 'Approved');
  if (approvedPartner) {
    return { allowed: true };
  }

  const rejectedPartner = partners.find(partner => partner.status === 'Rejected');
  if (rejectedPartner) {
    return {
      allowed: false,
      reason: 'Your organization application was rejected. Please contact the admin team.',
    };
  }

  return {
    allowed: false,
    reason: 'Your organization application is still pending admin approval.',
  };
}

// Returns partner organization records filtered by approval status.
export async function getPartnersByStatus(status: string): Promise<Partner[]> {
  const partners = await getAllPartners();
  return partners.filter(p => p.status === status);
}

// Deletes a partner organization and cleans up related records.
export async function deletePartner(partnerId: string): Promise<void> {
  const [partners, applications, reports] = await Promise.all([
    getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS),
    getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS),
    getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS),
  ]);

  const partnerToDelete = (partners || []).find(p => p.id === partnerId);
  const ownerUserId = partnerToDelete?.ownerUserId;

  await Promise.all([
    setStorageItem(
      STORAGE_KEYS.PARTNERS,
      (partners || []).filter(partner => partner.id !== partnerId)
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
      (applications || []).filter(app =>
        ownerUserId ? app.partnerUserId !== ownerUserId : true
      )
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_REPORTS,
      (reports || []).filter(report => report.partnerId !== partnerId)
    ),
  ]);
  invalidateSharedStorageCache([
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.PROGRAMS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.STATUS_UPDATES,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
    STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
  ]);
  notifyStorageChanged([
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.PROGRAMS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.STATUS_UPDATES,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
    STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
  ]);
}

async function ensureAdminPlanningCalendarsSeeded(): Promise<AdminPlanningCalendar[]> {
  try {
    const existingCalendars =
      (await getStorageItem<AdminPlanningCalendar[]>(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS)) || [];

    if (existingCalendars.length > 0) {
      return normalizePlanningCalendars(existingCalendars);
    }

    const seededCalendars = DEFAULT_ADMIN_PLANNING_CALENDARS.map(calendar => ({ ...calendar }));
    await setStorageItem(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS, seededCalendars);
    return normalizePlanningCalendars(seededCalendars);
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.error('Failed to seed admin planning calendars:', error);
    }
    // Gracefully fall back to default calendars if backend is unavailable
    return DEFAULT_ADMIN_PLANNING_CALENDARS.map(calendar => normalizeAdminPlanningCalendarRecord({ ...calendar }));
  }
}

// Returns all admin planning calendars, seeding a default set on first load.
export async function getAllAdminPlanningCalendars(): Promise<AdminPlanningCalendar[]> {
  const calendars = await ensureAdminPlanningCalendarsSeeded();
  return calendars.map(normalizeAdminPlanningCalendarRecord);
}

// Inserts or updates one admin planning calendar.
export async function saveAdminPlanningCalendar(
  calendar: AdminPlanningCalendar
): Promise<void> {
  const calendars = await getAllAdminPlanningCalendars();
  const existingIndex = calendars.findIndex(entry => entry.id === calendar.id);
  const existingPlanningItems = existingIndex >= 0 ? calendars[existingIndex].planningItems || [] : [];
  const normalizedCalendar = normalizeAdminPlanningCalendarRecord({
    ...calendar,
    planningItems: calendar.planningItems || existingPlanningItems,
  });

  if (existingIndex >= 0) {
    calendars[existingIndex] = normalizedCalendar;
  } else {
    calendars.push(normalizedCalendar);
  }

  await setStorageItem(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS, calendars);
}

// Deletes one admin planning calendar when it has no scheduled items.
export async function deleteAdminPlanningCalendar(calendarId: string): Promise<void> {
  const calendars = await getAllAdminPlanningCalendars();

  if (DEFAULT_ADMIN_PLANNING_CALENDARS.some(calendar => calendar.id === calendarId)) {
    throw new Error('Default planning calendars cannot be deleted, but you can rename or recolor them.');
  }

  if ((calendars.find(calendar => calendar.id === calendarId)?.planningItems || []).length > 0) {
    throw new Error('Move or delete planner entries before removing this calendar.');
  }

  await setStorageItem(
    STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
    calendars.filter(calendar => calendar.id !== calendarId)
  );
}

// Returns every admin planner item sorted by start date.
export async function getAllAdminPlanningItems(): Promise<AdminPlanningItem[]> {
  const calendars = await getAllAdminPlanningCalendars();
  return collectPlanningItemsFromCalendars(calendars);
}

// Inserts or updates one scheduled planner entry.
export async function saveAdminPlanningItem(item: AdminPlanningItem): Promise<void> {
  const calendars = await getAllAdminPlanningCalendars();
  const nextCalendars = attachPlanningItemToCalendars(calendars, item);
  await setStorageItem(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS, nextCalendars);
}

// Deletes one scheduled planner entry.
export async function deleteAdminPlanningItem(itemId: string): Promise<void> {
  const calendars = await getAllAdminPlanningCalendars();
  const nextCalendars = calendars.map(calendar => ({
    ...calendar,
    planningItems: (calendar.planningItems || []).filter(item => item.id !== itemId),
  }));

  await setStorageItem(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS, nextCalendars);
}

// Project Storage
// Inserts or updates a project or event record.
export async function saveProject(project: Project): Promise<void> {
  invalidateSharedStorageCache([STORAGE_KEYS.PROJECTS]);
  const projects = await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS) || [];
  const existingIndex = projects.findIndex(p => p.id === project.id);
  const normalizedProject = normalizeProjectRecord({
    ...project,
    isEvent: false,
    skillsNeeded: normalizeProjectSkillsNeeded(project, project.internalTasks || []),
  });
  if (existingIndex >= 0) {
    projects[existingIndex] = normalizedProject;
  } else {
    projects.push(normalizedProject);
  }
  await setStorageItem(STORAGE_KEYS.PROJECTS, projects);
  // Clear snapshot cache so mobile app sees changes immediately
  projectsSnapshotCache.clear();
  notifyStorageChanged([STORAGE_KEYS.PROJECTS]);
}

// Inserts or updates an event record in the dedicated events collection.
export async function saveEvent(event: Project): Promise<void> {
  invalidateSharedStorageCache([STORAGE_KEYS.EVENTS]);
  const events = await getStorageItem<Project[]>(STORAGE_KEYS.EVENTS) || [];
  const existingIndex = events.findIndex(entry => entry.id === event.id);
  const normalizedEvent = normalizeEventRecord({
    ...event,
    skillsNeeded: normalizeProjectSkillsNeeded(event, event.internalTasks || []),
  });
  if (existingIndex >= 0) {
    events[existingIndex] = normalizedEvent;
  } else {
    events.push(normalizedEvent);
  }
  await setStorageItem(STORAGE_KEYS.EVENTS, events);
  // Clear snapshot cache so mobile app sees changes immediately
  projectsSnapshotCache.clear();
  notifyStorageChanged([STORAGE_KEYS.EVENTS]);
}

// Deletes a project and cleans up dependent records that reference it.
export async function deleteProject(projectId: string): Promise<void> {
  const changedKeys = [
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.STATUS_UPDATES,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
    STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
  ];

  try {
    await deleteRemoteProjectRecord(projectId);
    invalidateSharedStorageCache(changedKeys);
    projectsSnapshotCache.clear();
    notifyStorageChanged(changedKeys);
    return;
  } catch (error) {
    console.warn('Direct project delete failed; falling back to storage cleanup:', error);
  }

  const [
    projects,
    programs,
    events,
    statusUpdates,
    partnerApplications,
    partnerReports,
    volunteerJoinRecords,
    volunteerMatches,
    volunteerTimeLogs,
    projectGroupMessages,
    volunteers,
    adminPlanningCalendars,
  ] =
    await Promise.all([
      getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS),
      getStorageItem<Project[]>(STORAGE_KEYS.PROGRAMS),
      getStorageItem<Project[]>(STORAGE_KEYS.EVENTS),
      getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES),
      getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS),
      getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS),
      getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
      getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES),
      getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS),
      getStorageItem<ProjectGroupMessage[]>(STORAGE_KEYS.PROJECT_GROUP_MESSAGES),
      getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS),
      getStorageItem<AdminPlanningCalendar[]>(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS),
    ]);

  const relatedProjectIds = new Set([
    projectId,
    ...((events || [])
      .filter(event => event.parentProjectId === projectId)
      .map(event => event.id)),
  ]);

  await Promise.all([
    setStorageItem(
      STORAGE_KEYS.PROJECTS,
      (projects || []).filter(project => project.id !== projectId)
    ),
    setStorageItem(
      STORAGE_KEYS.PROGRAMS,
      (programs || []).filter(project => project.id !== projectId)
    ),
    setStorageItem(
      STORAGE_KEYS.EVENTS,
      (events || []).filter(event => !relatedProjectIds.has(event.id))
    ),
    setStorageItem(
      STORAGE_KEYS.STATUS_UPDATES,
      (statusUpdates || []).filter(update => !relatedProjectIds.has(update.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
      (partnerApplications || []).filter(application => !relatedProjectIds.has(application.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_REPORTS,
      (partnerReports || []).filter(report => !relatedProjectIds.has(report.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
      (volunteerJoinRecords || []).filter(record => !relatedProjectIds.has(record.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_MATCHES,
      (volunteerMatches || []).filter(match => !relatedProjectIds.has(match.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
      (volunteerTimeLogs || []).filter(log => !relatedProjectIds.has(log.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
      (projectGroupMessages || []).filter(message => !relatedProjectIds.has(message.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEERS,
      removeProjectIdsFromVolunteerHistory(volunteers, relatedProjectIds)
    ),
    setStorageItem(
      STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
      removeProjectIdsFromPlanningCalendars(adminPlanningCalendars, relatedProjectIds)
    ),
  ]);
  invalidateSharedStorageCache([STORAGE_KEYS.PROGRAMS, ...changedKeys]);
  notifyStorageChanged([STORAGE_KEYS.PROGRAMS, ...changedKeys]);
}

// Deletes one event and cleans up records that reference it.
export async function deleteEvent(eventId: string): Promise<void> {
  const changedKeys = [
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.STATUS_UPDATES,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
    STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
  ];

  try {
    await deleteRemoteEventRecord(eventId);
    invalidateSharedStorageCache(changedKeys);
    projectsSnapshotCache.clear();
    notifyStorageChanged(changedKeys);
    return;
  } catch (error) {
    console.warn('Direct event delete failed; falling back to storage cleanup:', error);
  }

  const [
    projects,
    events,
    statusUpdates,
    partnerApplications,
    partnerReports,
    volunteerJoinRecords,
    volunteerMatches,
    volunteerTimeLogs,
    projectGroupMessages,
    volunteers,
    adminPlanningCalendars,
  ] =
    await Promise.all([
      getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS),
      getStorageItem<Project[]>(STORAGE_KEYS.EVENTS),
      getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES),
      getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS),
      getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS),
      getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
      getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES),
      getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS),
      getStorageItem<ProjectGroupMessage[]>(STORAGE_KEYS.PROJECT_GROUP_MESSAGES),
      getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS),
      getStorageItem<AdminPlanningCalendar[]>(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS),
    ]);
  const relatedEventIds = new Set([eventId]);

  await Promise.all([
    setStorageItem(
      STORAGE_KEYS.PROJECTS,
      (projects || []).filter(project => project.id !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.EVENTS,
      (events || []).filter(event => !relatedEventIds.has(event.id))
    ),
    setStorageItem(
      STORAGE_KEYS.STATUS_UPDATES,
      (statusUpdates || []).filter(update => !relatedEventIds.has(update.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
      (partnerApplications || []).filter(application => !relatedEventIds.has(application.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_REPORTS,
      (partnerReports || []).filter(report => !relatedEventIds.has(report.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
      (volunteerJoinRecords || []).filter(record => !relatedEventIds.has(record.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_MATCHES,
      (volunteerMatches || []).filter(match => !relatedEventIds.has(match.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
      (volunteerTimeLogs || []).filter(log => !relatedEventIds.has(log.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
      (projectGroupMessages || []).filter(message => !relatedEventIds.has(message.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEERS,
      removeProjectIdsFromVolunteerHistory(volunteers, relatedEventIds)
    ),
    setStorageItem(
      STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
      removeProjectIdsFromPlanningCalendars(adminPlanningCalendars, relatedEventIds)
    ),
  ]);
  invalidateSharedStorageCache(changedKeys);
  notifyStorageChanged(changedKeys);
}

// Looks up a single project by id.
export async function getProject(id: string): Promise<Project | null> {
  const projects = await getAllProjects();
  return projects.find(p => p.id === id) || null;
}

// Returns all projects and events from shared storage.
export async function getAllProjects(): Promise<Project[]> {
  const [programs, projects, events] = await Promise.all([
    getStorageItemFast<Project[]>(STORAGE_KEYS.PROGRAMS),
    getStorageItemFast<Project[]>(STORAGE_KEYS.PROJECTS),
    getStorageItemFast<Project[]>(STORAGE_KEYS.EVENTS),
  ]);

  return mergeProjectAndEventRecords(
    [...(programs || []), ...(projects || [])],
    events
  );
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
function normalizeVolunteerRecord(volunteer: Volunteer): Volunteer {
  const registrationStatus = volunteer.registrationStatus || 'Approved';

  return {
    ...volunteer,
    name: (volunteer.name || '').trim(),
    email: volunteer.email?.trim().toLowerCase() || '',
    phone: normalizeAccountPhone(volunteer.phone) || '',
    registrationStatus,
    credentialsUnlockedAt:
      volunteer.credentialsUnlockedAt ||
      (registrationStatus === 'Approved' ? volunteer.reviewedAt || volunteer.createdAt : undefined),
  };
}

// Inserts or updates a volunteer profile record.
export async function saveVolunteer(volunteer: Volunteer): Promise<void> {
  if (volunteer.email?.trim() && !isValidEmailAddress(volunteer.email.trim().toLowerCase())) {
    throw new Error('Please enter a valid volunteer email address.');
  }
  if (volunteer.phone?.trim() && !normalizeAccountPhone(volunteer.phone)) {
    throw new Error('Use a valid Philippine mobile number for the volunteer profile.');
  }

  const volunteers = await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS) || [];
  const existingIndex = volunteers.findIndex(v => v.id === volunteer.id);
  const normalizedVolunteer = normalizeVolunteerRecord(volunteer);
  if (existingIndex >= 0) {
    volunteers[existingIndex] = normalizedVolunteer;
  } else {
    volunteers.push(normalizedVolunteer);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEERS, volunteers);
}

// Looks up a single volunteer profile by id.
export async function getVolunteer(id: string): Promise<Volunteer | null> {
  const volunteers = (await getStorageItemFast<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS)) || [];
  const volunteer = volunteers.find(v => v.id === id) || null;
  return volunteer ? normalizeVolunteerRecord(volunteer) : null;
}

// Returns all volunteer profiles from shared storage.
export async function getAllVolunteers(): Promise<Volunteer[]> {
  return ((await getStorageItemFast<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS)) || []).map(
    normalizeVolunteerRecord
  );
}

// Looks up the volunteer profile linked to a specific user account.
export async function getVolunteerByUserId(userId: string): Promise<Volunteer | null> {
  console.log('[getVolunteerByUserId] Looking up volunteer for userId:', userId);

  try {
    const payload = await requestApiJson<{ volunteer?: Volunteer | null }>(
      `/volunteers/by-user/${encodeURIComponent(userId)}`
    );

    console.log('[getVolunteerByUserId] API response:', payload);

    if (payload.volunteer) {
      console.log('[getVolunteerByUserId] Found volunteer:', payload.volunteer.id, payload.volunteer.name);
      return normalizeVolunteerRecord(payload.volunteer);
    }

    console.log('[getVolunteerByUserId] No volunteer in API response, trying fallback...');
  } catch (error) {
    console.error('[getVolunteerByUserId] API call failed:', error);
  }

  const linkedUser = await getUser(userId);
  if (!linkedUser) {
    console.log('[getVolunteerByUserId] No linked user found');
    return null;
  }

  console.log('[getVolunteerByUserId] Found linked user, searching volunteers...');
  const linkedVolunteers = await getLinkedVolunteersForUserAccount(linkedUser);

  if (linkedVolunteers[0]) {
    console.log('[getVolunteerByUserId] Found volunteer via fallback:', linkedVolunteers[0].id);
    return normalizeVolunteerRecord(linkedVolunteers[0]);
  }

  console.log('[getVolunteerByUserId] No volunteer found via any method');
  return null;
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

// Approves or rejects a volunteer registration and unlocks login access when approved.
export async function reviewVolunteerRegistration(
  volunteerId: string,
  status: NonNullable<Volunteer['registrationStatus']>,
  reviewedBy: string
): Promise<Volunteer> {
  const volunteer = await getVolunteer(volunteerId);
  if (!volunteer) {
    throw new Error('Volunteer registration not found.');
  }

  if (status === 'Pending') {
    throw new Error('Volunteer registration review must approve or reject the account.');
  }

  const now = new Date().toISOString();
  const updatedVolunteer: Volunteer = {
    ...volunteer,
    registrationStatus: status,
    reviewedBy,
    reviewedAt: now,
    credentialsUnlockedAt: status === 'Approved' ? now : undefined,
  };

  await saveVolunteer(updatedVolunteer);

  const linkedUser = await getLinkedUserAccountForVolunteer(updatedVolunteer);
  if (linkedUser) {
    await saveUser({
      ...linkedUser,
      approvalStatus: status === 'Approved' ? 'approved' : 'rejected',
      approvedBy: status === 'Approved' ? reviewedBy : undefined,
      approvedAt: status === 'Approved' ? now : undefined,
      rejectionReason:
        status === 'Rejected'
          ? 'Volunteer registration rejected by administrator.'
          : undefined,
    });

    // Send notification message to volunteer when approved
    if (status === 'Approved') {
      try {
        const adminUser = await getUser(reviewedBy);
        const adminName = adminUser?.name || 'Admin';

        await saveMessage({
          id: `msg-approval-${linkedUser.id}-${Date.now()}`,
          senderId: reviewedBy,
          recipientId: linkedUser.id,
          content: `🎉 Congratulations! Your volunteer account has been approved by ${adminName}. You can now access all volunteer features and start contributing to our programs!`,
          timestamp: now,
          read: false,
        });

        console.log(`[Notification] Sent approval notification to volunteer ${linkedUser.id}`);
      } catch (error) {
        console.error('[Notification] Failed to send approval notification:', error);
        // Don't fail the approval if notification fails
      }
    }
  }

  if (status === 'Approved') {
    try {
      await sendAccountApprovalEmailNotification(
        linkedUser || {
          email: updatedVolunteer.email,
          name: updatedVolunteer.name,
          role: 'volunteer',
        },
        reviewedBy
      );
    } catch (error) {
      console.error('[ApprovalEmail] Failed to send volunteer approval email:', error);
    }
  }

  return updatedVolunteer;
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

// Returns every volunteer time log stored in the system.
export async function getAllVolunteerTimeLogs(): Promise<VolunteerTimeLog[]> {
  const logs = (await getStorageItemFast<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS)) || [];
  return logs.sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime());
}

export async function setVolunteerAttendanceChecked(
  logId: string,
  checked: boolean,
  checkedByUserId: string
): Promise<VolunteerTimeLog> {
  const logs = (await getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS)) || [];
  const existingLog = logs.find(log => log.id === logId);
  if (!existingLog) {
    throw new Error('Attendance log not found.');
  }

  const users = (await getStorageItem<User[]>(STORAGE_KEYS.USERS)) || [];
  const checkedByUser = users.find(candidate => candidate.id === checkedByUserId);
  const updatedLog: VolunteerTimeLog = {
    ...existingLog,
    attendanceCheckedAt: checked ? new Date().toISOString() : undefined,
    attendanceCheckedBy: checked ? checkedByUserId : undefined,
    attendanceCheckedByName: checked ? checkedByUser?.name || 'Field Officer' : undefined,
  };

  await saveVolunteerTimeLog(updatedLog);
  return updatedLog;
}

// Starts a volunteer time log for the selected project.
export async function startVolunteerTimeLog(
  volunteerId: string,
  projectId: string,
  note?: string,
  attendancePhoto?: string
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
        attendancePhoto,
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
  projectId: string,
  completionReport?: string,
  completionPhoto?: string
): Promise<VolunteerTimeLogMutationResult> {
  const payload = await requestApiJson<Partial<VolunteerTimeLogMutationResult>>(
    `/volunteers/${encodeURIComponent(volunteerId)}/time-logs/end`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        completionReport,
        completionPhoto,
      }),
    }
  );

  return {
    log: payload.log || null,
    volunteerProfile: payload.volunteerProfile || null,
  };
}

export async function submitVolunteerTimeOutReport(input: {
  projectId: string;
  projectTitle?: string;
  volunteerUserId: string;
  volunteerName: string;
  completionLog: VolunteerTimeLog;
}): Promise<PartnerReport> {
  const completionReport = input.completionLog.completionReport?.trim() || '';
  const completionPhoto = input.completionLog.completionPhoto?.trim() || '';
  const durationHours =
    input.completionLog.timeIn && input.completionLog.timeOut
      ? Math.max(
        0,
        (new Date(input.completionLog.timeOut).getTime() -
          new Date(input.completionLog.timeIn).getTime()) /
        3_600_000
      )
      : 0;

  const description = completionReport || 'Volunteer submitted completion proof during time out.';

  return submitFieldReport({
    projectId: input.projectId,
    submitterUserId: input.volunteerUserId,
    submitterName: input.volunteerName,
    submitterRole: 'volunteer',
    title: `${input.projectTitle || 'Volunteer Project'} Completion Report`,
    description,
    metrics: {
      volunteerHours: Number(durationHours.toFixed(1)),
      tasksCompleted: 1,
    },
    attachments: completionPhoto
      ? [
        {
          url: completionPhoto,
          type: 'image',
          description: 'Volunteer completion photo',
        },
      ]
      : [],
    mediaFile: completionPhoto || undefined,
  });
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
    await fetchApiResponse('/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    // Invalidate caches for both sender and recipient
    invalidateMessageCache(message.senderId, message.recipientId);
    invalidateMessageCache(message.recipientId, message.senderId);
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
    await fetchApiResponse(
      `/projects/${encodeURIComponent(message.projectId)}/group-messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );
    // Invalidate group message cache for this project
    invalidateMessageCache(undefined, undefined, message.projectId);
    notifyWebMessageUpdate();
  } catch (error) {
    if (!isExpectedRemoteStorageError(error)) {
      console.error('Error saving project group message:', error);
    }
    throw error;
  }
}

export async function deleteProjectGroupChat(projectId: string): Promise<void> {
  const messages =
    (await getStorageItem<ProjectGroupMessage[]>(STORAGE_KEYS.PROJECT_GROUP_MESSAGES)) || [];
  await setStorageItem(
    STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
    messages.filter(message => message.projectId !== projectId)
  );
  invalidateMessageCache(undefined, undefined, projectId);
  notifyWebMessageUpdate();
}

// Returns all direct messages relevant to a specific user.
// Results are cached for MESSAGES_CACHE_TTL_MS and invalidated on send/receive.
export async function getMessagesForUser(userId: string): Promise<Message[]> {
  const cached = messagesForUserCache.get(userId);
  if (cached && Date.now() - cached.timestamp < MESSAGES_CACHE_TTL_MS) {
    return cached.data;
  }
  const payload = await requestApiJson<{ messages?: Message[] }>(
    `/messages?user_id=${encodeURIComponent(userId)}&limit=500`
  );
  const messages = payload.messages || [];
  messagesForUserCache.set(userId, { data: messages, timestamp: Date.now() });
  return messages;
}

export async function getUnreadMessagesForUser(userId: string): Promise<Message[]> {
  const payload = await requestApiJson<{ messages?: Message[] }>(
    `/messages/unread?user_id=${encodeURIComponent(userId)}&limit=100`
  );
  return payload.messages || [];
}

// Returns the direct-message history between two users.
// Results are cached for CONVERSATION_CACHE_TTL_MS and invalidated on send/receive.
export async function getConversation(userId1: string, userId2: string): Promise<Message[]> {
  const cacheKey = [userId1, userId2].sort().join(':');
  const cached = conversationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CONVERSATION_CACHE_TTL_MS) {
    return cached.data;
  }
  const payload = await requestApiJson<{ messages?: Message[] }>(
    `/messages/conversation?user1=${encodeURIComponent(userId1)}&user2=${encodeURIComponent(userId2)}&limit=500`
  );
  const messages = payload.messages || [];
  conversationCache.set(cacheKey, { data: messages, timestamp: Date.now() });
  return messages;
}

// Returns the project group chat history available to a specific user.
// Results are cached for CONVERSATION_CACHE_TTL_MS and invalidated on new messages.
export async function getProjectGroupMessages(
  projectId: string,
  userId: string
): Promise<ProjectGroupMessage[]> {
  const cacheKey = `${projectId}:${userId}`;
  const cached = groupMessagesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CONVERSATION_CACHE_TTL_MS) {
    return cached.data;
  }
  const payload = await requestApiJson<{ messages?: ProjectGroupMessage[] }>(
    `/projects/${encodeURIComponent(projectId)}/group-messages?user_id=${encodeURIComponent(userId)}`
  );
  const messages = payload.messages || [];
  groupMessagesCache.set(cacheKey, { data: messages, timestamp: Date.now() });
  return messages;
}

// Invalidates all message caches for a user (call after send/receive).
export function invalidateMessageCache(userId?: string, conversationPartnerId?: string, projectId?: string): void {
  if (userId) {
    messagesForUserCache.delete(userId);
  }
  if (userId && conversationPartnerId) {
    const cacheKey = [userId, conversationPartnerId].sort().join(':');
    conversationCache.delete(cacheKey);
  }
  if (projectId) {
    // Clear all group message cache entries for this project
    for (const key of groupMessagesCache.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        groupMessagesCache.delete(key);
      }
    }
  }
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
  onChange: (event: { type: string; keys: string[] }) => void
): () => void {
  const watchedKeys = new Set(keys);
  const subscriberId = nextStorageSubscriberId;
  nextStorageSubscriberId += 1;

  storageChangeSubscribers.set(subscriberId, {
    watchedKeys,
    onChange,
    pendingKeys: new Set<string>(),
    notifyTimer: null,
    isNotifying: false,
  });

  connectSharedStorageSocket();

  return () => {
    const subscriber = storageChangeSubscribers.get(subscriberId);
    if (subscriber?.notifyTimer) {
      clearTimeout(subscriber.notifyTimer);
      subscriber.notifyTimer = null;
    }
    storageChangeSubscribers.delete(subscriberId);
    if (!hasStorageChangeSubscribers()) {
      clearSharedStorageSocketResources(true);
      sharedStoragePendingChangedKeys.clear();
    }
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
  invalidateSharedStorageCache([
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.PROJECTS,
  ]);
  if (match.status === 'Matched') {
    await attachVolunteerToProject(match.projectId, match.volunteerId);
  }
  await syncVolunteerEngagementStatus(match.volunteerId);
}

// Returns match records for one volunteer profile.
export async function getVolunteerProjectMatches(volunteerId: string): Promise<VolunteerProjectMatch[]> {
  const matches =
    (await getStorageItemFast<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES)) || [];
  return matches
    .filter(m => m.volunteerId === volunteerId)
    .sort((a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime());
}

// Returns every volunteer-project match record in storage.
export async function getAllVolunteerProjectMatches(): Promise<VolunteerProjectMatch[]> {
  const matches =
    (await getStorageItemFast<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES)) || [];
  return matches.sort((a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime());
}

// Returns volunteer match records filtered by project id.
export async function getProjectMatches(projectId: string): Promise<VolunteerProjectMatch[]> {
  const matches =
    (await getStorageItemFast<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES)) || [];
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

  if (!isVolunteerJoinableEvent(project)) {
    throw new Error('Volunteers can only join events. Open an event inside this program to continue.');
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

  const volunteersNeeded = Number(project.volunteersNeeded || 0);
  if (volunteersNeeded > 0) {
    const [joinRecords, allMatches] = await Promise.all([
      getVolunteerProjectJoinRecords(projectId),
      getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES),
    ]);
    const activeVolunteerKeys = new Set<string>();
    (joinRecords || [])
      .filter(record => (record.participationStatus || 'Active') === 'Active')
      .forEach(record => {
        const key = record.volunteerUserId || record.volunteerId || record.id;
        if (key) activeVolunteerKeys.add(key);
      });
    (project.volunteers || []).forEach(vId => {
      if (vId) activeVolunteerKeys.add(vId);
    });
    (project.joinedUserIds || []).forEach(uId => {
      if (uId) activeVolunteerKeys.add(uId);
    });
    (allMatches || [])
      .filter(m => m.projectId === projectId && m.status === 'Matched')
      .forEach(m => {
        if (m.volunteerId) activeVolunteerKeys.add(m.volunteerId);
      });

    if (activeVolunteerKeys.size >= volunteersNeeded) {
      throw new Error('This event has reached its maximum volunteer capacity and is already full.');
    }
  }

  const requestedMatch: VolunteerProjectMatch = {
    id: existingMatch?.id || `match-${Date.now()}`,
    volunteerId: volunteer.id,
    projectId,
    status: 'Requested',
    requestedAt: existingMatch?.requestedAt || new Date().toISOString(),
    matchedAt: new Date().toISOString(),
    reviewedAt: undefined,
    reviewedBy: undefined,
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
  const payload = await requestApiJson<{ match?: VolunteerProjectMatch | null }>(
    `/volunteer-matches/${encodeURIComponent(matchId)}/review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: nextStatus,
        reviewedBy,
      }),
    }
  );

  if (!payload.match) {
    throw new Error('Volunteer request review did not complete.');
  }
  const reviewedMatch = payload.match;

  const changedKeys = [
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
  ];
  const cachedMatches = getFreshSharedStorageCacheValue<VolunteerProjectMatch[]>(
    STORAGE_KEYS.VOLUNTEER_MATCHES
  );
  if (cachedMatches.hit && Array.isArray(cachedMatches.value)) {
    const existingIndex = cachedMatches.value.findIndex(match => match.id === payload.match?.id);
    const nextMatches = [...cachedMatches.value];
    if (existingIndex >= 0) {
      nextMatches[existingIndex] = payload.match;
    } else {
      nextMatches.push(payload.match);
    }
    setSharedStorageCacheValue(STORAGE_KEYS.VOLUNTEER_MATCHES, nextMatches);
    invalidateSharedStorageCache(changedKeys.filter(key => key !== STORAGE_KEYS.VOLUNTEER_MATCHES));
  } else {
    invalidateSharedStorageCache(changedKeys);
  }
  notifyStorageChanged(changedKeys);

  // Do not hold the approval response on the best-effort notification path.
  // The match/project updates above are already persisted and are what the
  // reviewer needs to see immediately; notification delivery can complete in
  // the background without leaving the approval button spinning.
  void (async () => {
    try {
      const volunteer = await getVolunteer(reviewedMatch.volunteerId);
      await notifyVolunteerAboutProjectMatchDecision(
        reviewedMatch.projectId,
        volunteer?.userId || '',
        reviewedBy,
        nextStatus,
        'request'
      );
    } catch (error) {
      console.error('Error notifying volunteer about request review:', error);
    }
  })();

  return reviewedMatch;
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

  if (!isVolunteerJoinableEvent(project)) {
    throw new Error('Volunteers can only be assigned to events.');
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
    requestedAt: existingMatch?.requestedAt,
    matchedAt: new Date().toISOString(),
    reviewedAt: new Date().toISOString(),
    reviewedBy: assignedBy,
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

export async function getAllVolunteerProjectJoinRecords(): Promise<VolunteerProjectJoinRecord[]> {
  const records =
    (await getStorageItemFast<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS)) || [];
  return records
    .map(record => ({
      ...record,
      participationStatus: record.participationStatus || 'Active',
    }))
    .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());
}

// Removes a volunteer from a project/event.
export async function deleteVolunteerProjectJoinRecord(
  projectId: string,
  volunteerId: string
): Promise<void> {
  console.log('deleteVolunteerProjectJoinRecord called with:', { projectId, volunteerId });

  const url = `/projects/${encodeURIComponent(projectId)}/volunteers/${encodeURIComponent(volunteerId)}`;
  console.log('DELETE URL:', url);

  const payload = await requestApiJson<{ success?: boolean }>(
    url,
    {
      method: 'DELETE',
    }
  );

  console.log('API response:', payload);

  if (!payload.success) {
    throw new Error('Failed to remove volunteer from event.');
  }

  // Clear caches
  const changedKeys = [
    STORAGE_KEYS.VOLUNTEER_MATCHES,
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
  ];
  invalidateSharedStorageCache(changedKeys);
  notifyStorageChanged(changedKeys);

  console.log('Volunteer removed successfully, caches cleared');
}

export async function reconcileApprovedVolunteerEventMemberships(): Promise<void> {
  const [matches, volunteers, projects, existingRecords] = await Promise.all([
    getAllVolunteerProjectMatches(),
    getAllVolunteers(),
    getAllProjects(),
    getAllVolunteerProjectJoinRecords(),
  ]);

  const existingKeys = new Set(
    existingRecords.map(record => `${record.projectId}:${record.volunteerId}`)
  );
  const projectById = new Map(projects.map(project => [project.id, project]));
  const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
  const nextRecords = [...existingRecords];

  matches
    .filter(match => match.status === 'Matched' || match.status === 'Completed')
    .forEach(match => {
      const project = projectById.get(match.projectId);
      const volunteer = volunteerById.get(match.volunteerId);
      if (!project?.isEvent || !volunteer || existingKeys.has(`${match.projectId}:${match.volunteerId}`)) {
        return;
      }

      nextRecords.push({
        id: buildVolunteerProjectJoinRecordId(match.projectId, match.volunteerId),
        projectId: match.projectId,
        volunteerId: match.volunteerId,
        volunteerUserId: volunteer.userId,
        volunteerName: volunteer.name,
        volunteerEmail: volunteer.email,
        joinedAt: match.matchedAt || match.requestedAt || new Date().toISOString(),
        source: 'AdminMatch',
        participationStatus: match.status === 'Completed' ? 'Completed' : 'Active',
        completedAt: match.status === 'Completed' ? match.reviewedAt || new Date().toISOString() : undefined,
      });
      existingKeys.add(`${match.projectId}:${match.volunteerId}`);
    });

  if (nextRecords.length !== existingRecords.length) {
    await setStorageItem(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS, nextRecords);
  }
}

export async function leaveVolunteerEventGroup(projectId: string, userId: string): Promise<void> {
  const [records, project] = await Promise.all([
    getAllVolunteerProjectJoinRecords(),
    getProject(projectId),
  ]);

  await setStorageItem(
    STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
    records.filter(record => !(record.projectId === projectId && record.volunteerUserId === userId))
  );

  if (project?.isEvent) {
    await saveEvent({
      ...project,
      joinedUserIds: (project.joinedUserIds || []).filter(id => id !== userId),
      updatedAt: new Date().toISOString(),
    });
  }
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
  const project = await getProject(projectId);
  if (!isVolunteerJoinableEvent(project)) {
    throw new Error('Volunteer participation can only be completed for events.');
  }

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

// Returns partner applications across all programs.
export async function getAllPartnerProjectApplications(): Promise<PartnerProjectApplication[]> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  return applications.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

async function updatePartnerProjectApplicationCache(
  application: PartnerProjectApplication
): Promise<void> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  const existingIndex = applications.findIndex(app => app.id === application.id);
  const nextApplications =
    existingIndex >= 0
      ? applications.map(app => (app.id === application.id ? application : app))
      : [...applications, application];

  setSharedStorageCacheValue(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS, nextApplications);
  projectsSnapshotCache.clear();
  notifyStorageChanged([STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS]);
}

async function updateApprovedProposalProjectCache(project: Project): Promise<void> {
  const projects = (await getStorageItemFast<Project[]>(STORAGE_KEYS.PROJECTS)) || [];
  const existingIndex = projects.findIndex(item => item.id === project.id);
  const nextProjects =
    existingIndex >= 0
      ? projects.map(item => (item.id === project.id ? project : item))
      : [project, ...projects];

  setSharedStorageCacheValue(STORAGE_KEYS.PROJECTS, nextProjects);
  projectsSnapshotCache.clear();
  notifyStorageChanged([STORAGE_KEYS.PROJECTS]);
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

// Deletes a partner project application by id.
export async function deletePartnerProjectApplication(applicationId: string): Promise<void> {
  const applications =
    await getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS) || [];
  await setStorageItem(
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    applications.filter(app => app.id !== applicationId)
  );
}

// Creates a partner program proposal for admin review.
export async function submitPartnerProgramProposal(
  projectId: string,
  partnerUser: User,
  options?: {
    programModule?: string;
    proposalDetails?: PartnerProjectProposalDetails;
  }
): Promise<PartnerProjectApplication> {
  const requestedProgramModule = String(options?.programModule || '').trim();
  const normalizedProjectId = String(projectId || '').trim();
  const proposalProjectId =
    normalizedProjectId && normalizedProjectId !== 'new'
      ? normalizedProjectId
      : requestedProgramModule
        ? buildProgramProposalProjectId(requestedProgramModule)
        : normalizedProjectId;

  const payload = await requestApiJson<{ application?: PartnerProjectApplication | null }>(
    '/partner-project-applications/request',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: proposalProjectId,
        programModule: requestedProgramModule || undefined,
        partnerUserId: partnerUser.id,
        partnerName: partnerUser.name,
        partnerEmail: partnerUser.email || '',
        proposalDetails: options?.proposalDetails,
      }),
    }
  );

  if (!payload.application) {
    throw new Error('Partner program proposal did not complete.');
  }

  await updatePartnerProjectApplicationCache(payload.application);

  return payload.application;
}

// Backwards-compatible alias used by older screens.
export async function requestPartnerProjectJoin(
  projectId: string,
  partnerUser: User
): Promise<PartnerProjectApplication> {
  return submitPartnerProgramProposal(projectId, partnerUser);
}

// Approves or rejects a partner join request.
export async function reviewPartnerProjectApplication(
  applicationId: string,
  status: 'Approved' | 'Rejected',
  reviewedBy: string,
  reviewNotes?: string
): Promise<PartnerProjectApplication> {
  const payload = await requestApiJson<{
    application?: PartnerProjectApplication | null;
    project?: Project | null;
  }>(
    `/partner-project-applications/${encodeURIComponent(applicationId)}/review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
        reviewedBy,
        reviewNotes: reviewNotes?.trim() || undefined,
      }),
    }
  );

  if (!payload.application) {
    throw new Error('Application review did not complete.');
  }

  await updatePartnerProjectApplicationCache(payload.application);
  if (payload.project) {
    await updateApprovedProposalProjectCache(payload.project);
  }

  return payload.application;
}

// Marks a partner registration as externally verified by admin.
export async function verifyPartnerRegistration(
  partnerId: string,
  reviewedBy: string,
  verificationNotes?: string
): Promise<Partner> {
  const partner = await getPartner(partnerId);
  if (!partner) {
    throw new Error('Partner application not found.');
  }

  const updatedPartner: Partner = {
    ...partner,
    verificationStatus: 'Verified',
    verificationNotes: verificationNotes?.trim() || `DSWD accreditation checked by admin on ${new Date().toLocaleString()}.`,
    validatedBy: reviewedBy,
    validatedAt: new Date().toISOString(),
  };

  await savePartner(updatedPartner);
  return updatedPartner;
}

// Approves or rejects a partner registration and unlocks login access when approved.
export async function reviewPartnerRegistration(
  partnerId: string,
  status: Partner['status'],
  reviewedBy: string,
  rejectionReason?: string
): Promise<Partner> {
  const partner = await getPartner(partnerId);
  if (!partner) {
    throw new Error('Partner application not found.');
  }

  if (status === 'Pending') {
    throw new Error('Partner registration review must approve or reject the application.');
  }

  const now = new Date().toISOString();
  const updatedPartner: Partner = {
    ...partner,
    status,
    validatedBy: reviewedBy,
    validatedAt: now,
    credentialsUnlockedAt: status === 'Approved' ? now : undefined,
  };

  await savePartner(updatedPartner);

  const linkedUser = await getLinkedUserAccountForPartner(updatedPartner);
  if (linkedUser) {
    await saveUser({
      ...linkedUser,
      approvalStatus: status === 'Approved' ? 'approved' : 'rejected',
      approvedBy: status === 'Approved' ? reviewedBy : undefined,
      approvedAt: status === 'Approved' ? now : undefined,
      rejectionReason:
        status === 'Rejected'
          ? 'Partner registration rejected by administrator.'
          : undefined,
    });
  }

  if (status === 'Approved') {
    try {
      await sendAccountApprovalEmailNotification(
        linkedUser || {
          email: updatedPartner.contactEmail,
          name: updatedPartner.name,
          role: 'partner',
        },
        reviewedBy
      );
    } catch (error) {
      console.error('[ApprovalEmail] Failed to send partner approval email:', error);
    }
  }

  return updatedPartner;
}

// Saves one uploaded partner report.
function dedupeReports<T extends { id: string }>(reports: T[]): T[] {
  const seen = new Set<string>();
  return reports.filter(report => {
    if (seen.has(report.id)) {
      return false;
    }
    seen.add(report.id);
    return true;
  });
}

export async function savePartnerReport(report: PartnerReport): Promise<void> {
  const reports = await getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  const existingIndex = reports.findIndex(entry => entry.id === report.id);
  if (existingIndex >= 0) {
    reports[existingIndex] = report;
  } else {
    reports.push(report);
  }
  await setStorageItem(STORAGE_KEYS.PARTNER_REPORTS, dedupeReports(reports));
}

// Returns partner reports associated with one project.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getPartnerReportsByProject(projectId: string): Promise<PartnerReport[]> {
  const reports = await getStorageItemFast<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  return dedupeReports(reports)
    .filter(report => report.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Returns partner reports submitted by one partner user.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getPartnerReportsByUser(partnerUserId: string): Promise<PartnerReport[]> {
  const reports = await getStorageItemFast<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  return dedupeReports(reports)
    .filter(
      report =>
        report.submitterUserId === partnerUserId ||
        report.partnerUserId === partnerUserId
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Returns every partner report stored in the system.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getAllPartnerReports(): Promise<PartnerReport[]> {
  const reports = await getStorageItemFast<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  return dedupeReports(reports).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Returns every impact-hub report submitted by one user regardless of role.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getImpactHubReportsByUser(userId: string): Promise<PartnerReport[]> {
  const reports = await getStorageItemFast<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  return dedupeReports(reports)
    .filter(report => report.submitterUserId === userId || report.partnerUserId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Returns only field reports stored in the dedicated field report collection.
export async function getFieldReports(): Promise<PartnerReport[]> {
  const reports = await getAllPartnerReports();
  return reports
    .filter(report => report.reportType === 'field_report')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Backwards-compatible alias for callers that expect an all-records getter.
export async function getAllFieldReports(): Promise<PartnerReport[]> {
  return getFieldReports();
}

// Returns only field reports created by one user.
export async function getFieldReportsByUser(userId: string): Promise<PartnerReport[]> {
  const reports = await getFieldReports();
  return reports.filter(report => report.submitterUserId === userId || report.partnerUserId === userId);
}

function calculateImpactCountFromMetrics(metrics?: Record<string, number>): number {
  if (!metrics) {
    return 0;
  }

  // Beneficiary totals are the canonical impact count used by analytics.
  // Do not let operational metrics (hours, joins, tasks, etc.) inflate that
  // count when a report explicitly provides a beneficiary value.
  const beneficiaryKeys = [
    'beneficiariesServed',
    'beneficiaries_served',
    'beneficiaries',
    'beneficiariesAssisted',
    'beneficiaries_assisted',
    'beneficiariesReached',
    'beneficiaries_reached',
  ];
  const beneficiaryValue = beneficiaryKeys
    .map(key => Number(metrics[key]))
    .find(value => Number.isFinite(value) && value >= 0);
  if (beneficiaryValue !== undefined) {
    return beneficiaryValue;
  }

  const total = Object.values(metrics).reduce((sum, value) => {
    const numericValue = Number(value);
    return sum + (Number.isFinite(numericValue) ? numericValue : 0);
  }, 0);
  return Math.max(total, 0);
}

const REPORT_MEDIA_FILE_MAX_LENGTH = 500;

function normalizeReportMediaPayload(input: {
  attachments?: {
    url: string;
    type: 'image' | 'video' | 'document' | 'media';
    description?: string;
  }[];
  mediaFile?: string;
}): {
  attachments: {
    url: string;
    type: 'image' | 'video' | 'document' | 'media';
    description?: string;
  }[];
  mediaFile?: string;
} {
  const attachments = (input.attachments || [])
    .map(attachment => ({
      ...attachment,
      url: attachment.url.trim(),
      description: attachment.description?.trim() || undefined,
    }))
    .filter(attachment => attachment.url);

  let mediaFile = input.mediaFile?.trim() || undefined;
  if (mediaFile && mediaFile.length > REPORT_MEDIA_FILE_MAX_LENGTH) {
    if (!attachments.some(attachment => attachment.url === mediaFile)) {
      attachments.unshift({
        url: mediaFile,
        type: 'image',
        description: 'Uploaded report photo',
      });
    }
    mediaFile = undefined;
  }

  return { attachments, mediaFile };
}

async function getVolunteerByUserIdWithFallback(userId: string): Promise<Volunteer | null> {
  try {
    return await getVolunteerByUserId(userId);
  } catch (error) {
    console.error('Error loading volunteer profile for report validation:', error);
    const volunteers = (await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS)) || [];
    return volunteers
      .map(normalizeVolunteerRecord)
      .find(volunteer => volunteer.userId === userId) || null;
  }
}

async function getVolunteerTimeLogsWithFallback(
  volunteerId: string
): Promise<VolunteerTimeLog[]> {
  try {
    return await getVolunteerTimeLogs(volunteerId);
  } catch (error) {
    console.error('Error loading volunteer time logs for report validation:', error);
    const logs =
      (await getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS)) || [];
    return logs.filter(log => log.volunteerId === volunteerId);
  }
}

async function validateVolunteerReportEligibility(input: {
  projectId: string;
  submitterUserId: string;
  submitterRole: UserRole;
}): Promise<void> {
  if (input.submitterRole !== 'volunteer') {
    return;
  }

  const volunteers = (await getStorageItemFast<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS)) || [];
  const volunteer = volunteers.find(v => v.userId === input.submitterUserId || v.id === input.submitterUserId);
  if (!volunteer) {
    // Fallback if not found in fast storage
    const fetched = await getVolunteerByUserIdWithFallback(input.submitterUserId);
    if (!fetched) {
      throw new Error('Volunteer profile not found. You must complete your volunteer profile first.');
    }
  }

  const volunteerId = volunteer?.id || input.submitterUserId;
  const timeLogs = (await getStorageItemFast<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS)) || [];
  const hasTimedIn = timeLogs.some(
    log => log.projectId === input.projectId && (log.volunteerId === volunteerId || log.volunteerId === input.submitterUserId) && Boolean(log.timeIn?.trim())
  );

  if (!hasTimedIn) {
    const fetchedLogs = await getVolunteerTimeLogsWithFallback(volunteerId);
    const hasFetchedTimeIn = fetchedLogs.some(
      log => log.projectId === input.projectId && Boolean(log.timeIn?.trim())
    );
    if (!hasFetchedTimeIn) {
      throw new Error('You must time in to this event before submitting a report.');
    }
  }
}

// Submits one report into the shared impact hub for any supported role.
export async function submitImpactHubReport(input: {
  projectId: string;
  submitterUserId: string;
  submitterName: string;
  submitterRole: UserRole;
  reportType: ImpactHubReportType;
  title?: string;
  description: string;
  impactCount?: number;
  metrics?: Record<string, number>;
  attachments?: {
    url: string;
    type: 'image' | 'video' | 'document' | 'media';
    description?: string;
  }[];
  mediaFile?: string;
  partnerId?: string;
  partnerUserId?: string;
  partnerName?: string;
  collaborationFeedback?: string;
  volunteerPraise?: string;
  gratitudeNote?: string;
}): Promise<PartnerReport> {
  await validateVolunteerReportEligibility({
    projectId: input.projectId,
    submitterUserId: input.submitterUserId,
    submitterRole: input.submitterRole,
  });

  const normalizedMetrics = input.metrics || {};
  const normalizedMediaPayload = normalizeReportMediaPayload({
    attachments: input.attachments,
    mediaFile: input.mediaFile,
  });
  const report: PartnerReport = {
    id: `impact-report-${Date.now()}`,
    projectId: input.projectId,
    partnerId: input.partnerId,
    partnerUserId: input.partnerUserId,
    partnerName: input.partnerName,
    submitterUserId: input.submitterUserId,
    submitterName: input.submitterName,
    submitterRole: input.submitterRole,
    title: input.title?.trim() || undefined,
    reportType: input.reportType,
    description: input.description.trim(),
    impactCount:
      input.impactCount !== undefined
        ? input.impactCount
        : calculateImpactCountFromMetrics(normalizedMetrics),
    metrics: normalizedMetrics,
    attachments: normalizedMediaPayload.attachments,
    mediaFile: normalizedMediaPayload.mediaFile,
    collaborationFeedback: input.collaborationFeedback?.trim() || undefined,
    volunteerPraise: input.volunteerPraise?.trim() || undefined,
    gratitudeNote: input.gratitudeNote?.trim() || undefined,
    createdAt: new Date().toISOString(),
    status: 'Submitted',
  };

  await savePartnerReport(report);
  return report;
}

// Submits a field report with the same shared storage path as other impact reports.
export async function submitFieldReport(input: {
  projectId: string;
  submitterUserId: string;
  submitterName: string;
  submitterRole: UserRole;
  title?: string;
  description: string;
  metrics?: Record<string, number>;
  attachments?: {
    url: string;
    type: 'image' | 'video' | 'document' | 'media';
    description?: string;
  }[];
  mediaFile?: string;
  partnerId?: string;
  partnerUserId?: string;
  partnerName?: string;
}): Promise<PartnerReport> {
  return submitImpactHubReport({
    projectId: input.projectId,
    submitterUserId: input.submitterUserId,
    submitterName: input.submitterName,
    submitterRole: input.submitterRole,
    reportType: 'field_report',
    title: input.title,
    description: input.description,
    metrics: input.metrics,
    attachments: input.attachments,
    mediaFile: input.mediaFile,
    partnerId: input.partnerId,
    partnerUserId: input.partnerUserId,
    partnerName: input.partnerName,
  });
}

// Submits a partner impact or operations report.
export async function submitPartnerReport(input: {
  projectId: string;
  partnerId: string;
  partnerUserId: string;
  partnerName: string;
  reportType: PartnerReportType;
  description: string;
  impactCount: number;
  mediaFile?: string;
}): Promise<PartnerReport> {
  return submitImpactHubReport({
    projectId: input.projectId,
    submitterUserId: input.partnerUserId,
    submitterName: input.partnerName,
    submitterRole: 'partner',
    partnerId: input.partnerId,
    partnerUserId: input.partnerUserId,
    partnerName: input.partnerName,
    reportType: input.reportType,
    description: input.description,
    impactCount: input.impactCount,
    mediaFile: input.mediaFile,
  });
}

// Marks a submitted partner report as reviewed by admin.
export async function reviewPartnerReport(
  reportId: string,
  reviewedBy: string,
  nextStatus: 'Reviewed' | 'Rejected' = 'Reviewed',
  reviewNotes?: string
): Promise<PartnerReport> {
  const reports = await getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  const reportIndex = reports.findIndex(report => report.id === reportId);
  if (reportIndex === -1) {
    throw new Error('Partner report not found.');
  }

  const updatedReport: PartnerReport = {
    ...reports[reportIndex],
    status: nextStatus,
    reviewedAt: new Date().toISOString(),
    reviewedBy,
    reviewNotes: reviewNotes?.trim() || undefined,
  };
  reports[reportIndex] = updatedReport;
  await setStorageItem(STORAGE_KEYS.PARTNER_REPORTS, reports);
  return updatedReport;
}

// Adds a user directly to an event once access has been approved.
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

// Clear all storage (for testing/logout)
// Clears all shared storage collections and resets local caches.
export async function clearAllStorage(): Promise<void> {
  try {
    try {
      await clearRemoteStorage();
    } catch (error) {
      console.error('Error clearing remote storage:', error);
    }
    sharedStorageCacheTimestamps.clear();
    memoryStorageCache.clear();
    projectsSnapshotCache.clear();
    messagesForUserCache.clear();
    conversationCache.clear();
    groupMessagesCache.clear();
  } catch (error) {
    console.error('Error clearing storage:', error);
  }
}


async function attachVolunteerToProject(projectId: string, volunteerId: string): Promise<void> {
  const [project, volunteer] = await Promise.all([
    getProject(projectId),
    getVolunteer(volunteerId),
  ]);
  if (!project || !volunteer || !project.isEvent) return;

  const joinedUserIds = project.joinedUserIds || [];
  const hasVolunteerId = project.volunteers.includes(volunteerId);
  const hasUserId = joinedUserIds.includes(volunteer.userId);

  if (hasVolunteerId && hasUserId) return;

  const updatedRecord: Project = {
    ...project,
    volunteers: hasVolunteerId ? project.volunteers : [...project.volunteers, volunteerId],
    joinedUserIds: hasUserId ? joinedUserIds : [...joinedUserIds, volunteer.userId],
    updatedAt: new Date().toISOString(),
  };

  if (project.isEvent) {
    await saveEvent(updatedRecord);
    return;
  }

  await saveProject(updatedRecord);
}

async function ensureVolunteerProjectJoinRecord(
  projectId: string,
  volunteerId: string,
  source: VolunteerProjectJoinRecord['source']
): Promise<void> {
  const project = await getProject(projectId);
  if (!project?.isEvent) {
    return;
  }

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
    id: buildVolunteerProjectJoinRecordId(projectId, volunteerId),
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

  const activeEventMatchFlags = await Promise.all(
    matches
      .filter(match => match.status === 'Matched')
      .map(async match => {
        const project = await getProject(match.projectId);
        return Boolean(project?.isEvent);
      })
  );
  const hasActiveMatch = activeEventMatchFlags.some(Boolean);

  const activeParticipationFlags = await Promise.all(
    (joinRecords || [])
      .filter(record => record.volunteerId === volunteerId)
      .map(async record => {
        if ((record.participationStatus || 'Active') !== 'Active') {
          return false;
        }

        const project = await getProject(record.projectId);
        return Boolean(project?.isEvent);
      })
  );
  const hasActiveParticipation = activeParticipationFlags.some(Boolean);

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
  const digits = (value || '').replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) {
    return `63${digits.slice(1)}`;
  }
  if (/^639\d{9}$/.test(digits)) {
    return digits;
  }
  if (/^0\d{9,11}$/.test(digits)) {
    return `63${digits.slice(1)}`;
  }
  if (/^63\d{9,11}$/.test(digits)) {
    return digits;
  }
  return digits;
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

    const partnerEmail = (partner.contactEmail || '').trim().toLowerCase();
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
