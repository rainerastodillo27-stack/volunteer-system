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
  ImpactHubReportType,
  PartnerReport,
  PartnerReportType,
  PartnerSectorType,
  User,
  UserType,
  Partner,
  Project,
  ProjectInternalTask,
  ProgramTrack,
  Volunteer,
  Message,
  ProjectGroupMessage,
  StatusUpdate,
  VolunteerProjectMatch,
  SectorNeed,
  VolunteerTimeLog,
  PartnerProjectApplication,
  PartnerProjectProposalDetails,
  PublishedImpactReport,
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
  PUBLISHED_IMPACT_REPORTS: 'publishedImpactReports',
  ADMIN_PLANNING_CALENDARS: 'adminPlanningCalendars',
  ADMIN_PLANNING_ITEMS: 'adminPlanningItems',
  PROGRAM_TRACKS: 'programTracks',
};

const WEB_MESSAGE_SYNC_KEY = 'volcre:messages:updatedAt';
const memoryStorageCache = new Map<string, unknown>();
const sharedStorageCacheTimestamps = new Map<string, number>();
let mockDataInitializationPromise: Promise<void> | null = null;
// Shared reads should fail fast enough to keep the UI responsive when the
// backend is slow or unavailable.
const REMOTE_STORAGE_TIMEOUT_MS = 90000; // Increased from 60s to 90s for slow projects table
const REMOTE_STORAGE_BATCH_TIMEOUT_MS = 120000;
const API_HEALTH_TIMEOUT_MS = 4000; // Reduced from 8s for faster startup detection
const API_READY_RETRY_MS = 500; // Reduced from 1s for faster retries
const API_READY_MAX_ATTEMPTS = 2; // Keep low to fail fast on mobile
const API_READY_CACHE_MS = 10000; // Increased from 5s to reduce health checks
const API_REQUEST_MAX_ATTEMPTS = 3; // Reduced from 4 to fail faster
const API_REQUEST_RETRY_BASE_MS = 500; // Reduced from 1s
const API_REQUEST_RETRY_MAX_MS = 4000; // Reduced from 8s
const SHARED_STORAGE_CACHE_TTL_MS = 300000; // Increased from 90s to 5m
const PROJECTS_SNAPSHOT_CACHE_TTL_MS = 60000; // Increased from 20s to 1m
const STORAGE_CHANGE_POLL_INTERVAL_MS = 1000;
const STORAGE_CHANGE_DEBOUNCE_MS = 250;
const STORAGE_CHANGE_CALLBACK_COOLDOWN_MS = 250;
const LOCAL_ONLY_STORAGE_KEYS = new Set([STORAGE_KEYS.CURRENT_USER]);
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

const PERSISTED_CACHE_KEY_PREFIX = 'volcre:v2:cache:';
const PERSISTED_CACHE_TS_PREFIX = 'volcre:v2:cacheTs:';
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

async function migrateLegacyPlanningItemsIntoCalendars(
  calendars: AdminPlanningCalendar[]
): Promise<AdminPlanningCalendar[]> {
  const legacyItems = (await getStorageItem<AdminPlanningItem[]>(STORAGE_KEYS.ADMIN_PLANNING_ITEMS)) || [];
  const nextCalendars = calendars.map(calendar => normalizeAdminPlanningCalendarRecord(calendar));

  if (legacyItems.length === 0) {
    return nextCalendars;
  }

  for (const legacyItem of legacyItems) {
    const normalizedItem = normalizeAdminPlanningItemRecord(legacyItem);
    let targetIndex = nextCalendars.findIndex(calendar => calendar.id === normalizedItem.calendarId);

    if (targetIndex < 0) {
      const fallbackCalendarId = normalizedItem.calendarId || nextCalendars[0]?.id || 'planner-projects';
      targetIndex = nextCalendars.findIndex(calendar => calendar.id === fallbackCalendarId);

      if (targetIndex < 0) {
        nextCalendars.push({
          id: fallbackCalendarId,
          name: fallbackCalendarId,
          color: '#0F766E',
          description: 'Migrated planning lane.',
          planningItems: [],
          createdAt: normalizedItem.createdAt,
          updatedAt: normalizedItem.updatedAt,
        });
        targetIndex = nextCalendars.length - 1;
      }
    }

    const targetCalendar = nextCalendars[targetIndex];
    targetCalendar.planningItems = [
      ...(targetCalendar.planningItems || []).filter(entry => entry.id !== normalizedItem.id),
      normalizedItem,
    ];
  }

  await setStorageItem(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS, nextCalendars);
  return nextCalendars;
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

  const extractedModule = projectId.slice('program:'.length).trim();
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
  partnerUser: Pick<User, 'id' | 'name' | 'email'>
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
}

async function notifyPartnerAboutProjectJoinReview(
  application: PartnerProjectApplication,
  reviewedBy: string
): Promise<void> {
  const [project, requestedProgramModule] = await Promise.all([
    getProject(application.projectId),
    Promise.resolve(getProgramModuleFromProposalProjectId(application.projectId)),
  ]);

  const targetLabel = project
    ? `"${project.title}"`
    : requestedProgramModule
    ? `the ${requestedProgramModule} program module`
    : 'your proposed program';

  const outcome =
    application.status === 'Approved'
      ? `approved your project proposal for ${targetLabel}. You can now coordinate with NVC through Messages.`
      : `rejected your project proposal for ${targetLabel}. You may contact NVC admin for clarification.`;

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
    `${volunteer.name}${volunteerEmail} requested to join "${project.title}". Review it in the Project Management Suite to approve or reject.`
  );
}

async function notifyVolunteerAboutProjectJoinRequestCreated(
  projectId: string,
  volunteerUserId: string
): Promise<void> {
  const [project, adminUser] = await Promise.all([
    getProject(projectId),
    getPrimaryAdminUser(),
  ]);

  if (!project || !adminUser || !volunteerUserId) {
    return;
  }

  await sendSystemMessage(
    adminUser.id,
    volunteerUserId,
    `Your request to join "${project.title}" was submitted. You will be notified when admin approves or rejects it.`
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
        ? `assigned you to "${project.title}". You are now joined to this event and can coordinate through Event GC.`
        : `approved your request to join "${project.title}". You are now joined to this event and can coordinate through Event GC.`
      : `rejected your request to join "${project.title}". You may contact NVC admin for clarification.`;

  await sendSystemMessage(
    reviewedBy,
    volunteerUserId,
    `NVC Admin ${outcome}`
  );
}

// Notifies a volunteer when a task assignment is removed from an event.
export async function notifyVolunteerAboutTaskUnassignment(params: {
  event: Pick<Project, 'id' | 'title'>;
  task: Pick<ProjectInternalTask, 'id' | 'title'>;
  volunteer: Pick<Volunteer, 'userId' | 'name'>;
  actorUserId?: string;
}): Promise<void> {
  if (!params.volunteer.userId) {
    return;
  }

  const adminUser = await getPrimaryAdminUser();
  const senderId = adminUser?.id || params.actorUserId;

  if (!senderId || senderId === params.volunteer.userId) {
    return;
  }

  try {
    await sendSystemMessage(
      senderId,
      params.volunteer.userId,
      `You were unassigned from "${params.task.title}" in "${params.event.title}". This task has been removed from My Tasks.`
    );
  } catch (error) {
    console.error('Failed to send task unassignment notification:', error);
  }
}

// Notifies a volunteer when one of their assigned event tasks is created or edited.
export async function notifyVolunteerAboutTaskUpdate(params: {
  event: Pick<Project, 'id' | 'title'>;
  task: Pick<ProjectInternalTask, 'id' | 'title' | 'status'>;
  volunteer: Pick<Volunteer, 'userId' | 'name'>;
  actorUserId?: string;
  action: 'assigned' | 'updated';
}): Promise<void> {
  if (!params.volunteer.userId) {
    return;
  }

  const adminUser = await getPrimaryAdminUser();
  const senderId = adminUser?.id || params.actorUserId;

  if (!senderId || senderId === params.volunteer.userId) {
    return;
  }

  const message =
    params.action === 'assigned'
      ? `You were assigned to "${params.task.title}" in "${params.event.title}". Check My Tasks for details.`
      : `"${params.task.title}" in "${params.event.title}" was updated. Current status: ${params.task.status}.`;

  try {
    await sendSystemMessage(senderId, params.volunteer.userId, message);
  } catch (error) {
    console.error('Failed to send task update notification:', error);
  }
}

// Notifies a volunteer that their event time in was recorded successfully.
export async function notifyVolunteerAboutTimeIn(params: {
  event: Pick<Project, 'id' | 'title'>;
  volunteer: Pick<Volunteer, 'userId' | 'name'>;
  timeIn: string;
}): Promise<void> {
  if (!params.volunteer.userId) {
    return;
  }

  const adminUser = await getPrimaryAdminUser();
  const senderId = adminUser?.id;

  if (!senderId || senderId === params.volunteer.userId) {
    return;
  }

  const formattedTimeIn = new Date(params.timeIn).toLocaleString();

  try {
    await sendSystemMessage(
      senderId,
      params.volunteer.userId,
      `Time in recorded for "${params.event.title}" at ${formattedTimeIn}. You can submit your event report when you are ready to time out.`
    );
  } catch (error) {
    console.error('Failed to send time in notification:', error);
  }
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
  const platformOS = getPlatformOS();

  try {
    const parsedUrl = new URL(trimmedBaseUrl);
    const isLoopbackHost =
      parsedUrl.hostname === '127.0.0.1' ||
      parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname === '10.0.2.2';

    if (bundlerHost && isLoopbackHost && platformOS !== 'web') {
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

  return undefined;
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

  if (getPlatformOS() === 'android') {
    return 'http://10.0.2.2:8000';
  }

  return 'http://127.0.0.1:8000';
}

// Returns the effective HTTP base URL used by the frontend storage layer.
export function getApiBaseUrl(): string {
  const envWebBaseUrl = process.env.EXPO_PUBLIC_WEB_API_BASE_URL;
  const envNativeBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const configuredWebBaseUrl = getExpoExtraValue('webApiBaseUrl');
  if (typeof document !== 'undefined') {
    if (envWebBaseUrl && envWebBaseUrl.trim().length > 0) {
      return envWebBaseUrl.trim().replace(/\/$/, '');
    }
    if (configuredWebBaseUrl && configuredWebBaseUrl.trim().length > 0) {
      return configuredWebBaseUrl.trim().replace(/\/$/, '');
    }

    const protocol = document.location.protocol || 'http:';
    const host = document.location.hostname || '127.0.0.1';
    return `${protocol}//${host}:8000`;
  }

  const configuredNativeBaseUrl = getExpoExtraValue('apiBaseUrl') || envNativeBaseUrl;
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
  return Math.min(
    API_REQUEST_RETRY_BASE_MS * Math.pow(2, attempt),
    API_REQUEST_RETRY_MAX_MS
  );
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
  const response = await fetchApiResponse('/storage/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ keys }),
  }, REMOTE_STORAGE_BATCH_TIMEOUT_MS);
  const payload = (await response.json()) as { items?: Record<string, unknown | null> };
  return payload.items || {};
}

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string | Array<{ msg?: string }>;
    };
    if (typeof payload.detail === 'string' && payload.detail.trim()) {
      return payload.detail;
    }
    if (Array.isArray(payload.detail)) {
      const message = payload.detail
        .map(item => String(item?.msg || '').trim())
        .filter(Boolean)
        .join('\n');
      if (message) {
        return message;
      }
    }
  } catch {
    // Ignore parse errors and fall back to the default message.
  }

  return fallback;
}

async function fetchApiResponse(
  path: string,
  init?: RequestInit,
  timeoutMs = REMOTE_STORAGE_TIMEOUT_MS
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < API_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${getApiBaseUrl()}${path}`, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(
          response,
          `API request failed: ${response.status}`
        );

        if (isRetryableApiStatus(response.status) && attempt < API_REQUEST_MAX_ATTEMPTS - 1) {
          invalidateApiReady();
          lastError = new Error(message);
          await delay(getApiRetryDelayMs(attempt));
          continue;
        }

        invalidateApiReady();
        throw new Error(message);
      }

      markApiReady();
      return response;
    } catch (error) {
      if (isExpectedRemoteStorageError(error) && attempt < API_REQUEST_MAX_ATTEMPTS - 1) {
        invalidateApiReady();
        lastError = error;
        await delay(getApiRetryDelayMs(attempt));
        continue;
      }

      invalidateApiReady();
      throw error;
    } finally {
      clearTimeout(timeout);
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
    return existingRequest as Promise<T>;
  }

  const nextRequest = (async () => {
    try {
      const response = await fetchApiResponse(path, init, timeoutMs);
      return (await response.json()) as T;
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
    return;
  }

  for (const key of keys) {
    sharedStorageCacheTimestamps.delete(key);
    if (!isLocalOnlyStorageKey(key)) {
      memoryStorageCache.delete(key);
    }
  }
}

// Exported function to allow screens to invalidate the storage cache
export function clearStorageCache(keys?: string[]): void {
  invalidateSharedStorageCache(keys);
}

// Reads only the device cache without starting a backend request.
export async function getCachedStorageItem<T>(key: string): Promise<T | null> {
  return getLocalStorageItem<T>(key);
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
    const cached = await getLocalStorageItem<T>(key);
    const cachedAt = sharedStorageCacheTimestamps.get(key);
    const isFresh = cachedAt !== undefined && Date.now() - cachedAt <= SHARED_STORAGE_CACHE_TTL_MS;

    if (!isFresh || cached === null) {
      triggerBackgroundStorageRefresh([key]);
    }

    if (cached !== null) {
      return cached;
    }

    return getStorageItem<T>(key);
  } catch {
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
    
    if (!isFresh || cached === null) {
      keysToRefresh.push(key);
    }

    if (cached !== null && isFresh) {
      results[key] = cached;
    } else {
      if (cached !== null) {
        results[key] = cached;
      }
      missingKeys.push(key);
    }
  }

  if (keysToRefresh.length > 0) {
    triggerBackgroundStorageRefresh(keysToRefresh);
  }

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

async function clearRemoteStorage(): Promise<void> {
  await fetchApiResponse('/storage', {
    method: 'DELETE',
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
      return null;
    }

    console.error(`Error reading shared ${key} from backend:`, error);
    throw error;
  }
}

// Reads multiple storage values in a single backend request when possible.
// Split batch requests into smaller chunks to avoid timeout issues
const STORAGE_BATCH_CHUNK_SIZE = 3;

async function fetchRemoteStorageItemsInChunks(keys: string[]): Promise<Record<string, unknown | null>> {
  if (keys.length <= STORAGE_BATCH_CHUNK_SIZE) {
    return fetchRemoteStorageItems(keys);
  }

  const results: Record<string, unknown | null> = {};
  const chunks: string[][] = [];
  
  for (let i = 0; i < keys.length; i += STORAGE_BATCH_CHUNK_SIZE) {
    chunks.push(keys.slice(i, i + STORAGE_BATCH_CHUNK_SIZE));
  }

  // Fetch chunks sequentially to avoid overwhelming the backend
  for (const chunk of chunks) {
    try {
      const chunkResults = await fetchRemoteStorageItems(chunk);
      Object.assign(results, chunkResults);
    } catch (error) {
      // If a chunk fails, still try to include cached values for those keys
      if (!isAbortLikeError(error)) {
        throw error;
      }
      for (const key of chunk) {
        results[key] = null;
      }
    }
  }

  return results;
}

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

    const remoteResults = await fetchRemoteStorageItemsInChunks(missingSharedKeys);
    for (const key of missingSharedKeys) {
      const value = remoteResults[key] ?? null;
      setSharedStorageCacheValue(key, value);
      results[key] = value;
    }
    return results;
  } catch (error) {
    if (isAbortLikeError(error)) {
      if (hasStorageChangeSubscribers()) {
        connectSharedStorageSocket();
      }

      return results;
    }

    console.error(`Error reading shared storage batch from backend:`, error);
    throw error;
  }
}

// Loads the combined data set required by the admin dashboard screen.
export async function getDashboardSnapshot(): Promise<{
  users: User[];
  partners: Partner[];
  projects: Project[];
  programs: Project[];
  events: Project[];
  volunteers: Volunteer[];
  statusUpdates: StatusUpdate[];
  volunteerMatches: VolunteerProjectMatch[];
  volunteerTimeLogs: VolunteerTimeLog[];
  volunteerProjectJoins: VolunteerProjectJoinRecord[];
  partnerProjectApplications: PartnerProjectApplication[];
  partnerReports: PartnerReport[];
  publishedImpactReports: PublishedImpactReport[];
  adminPlanningCalendars: AdminPlanningCalendar[];
  adminPlanningItems: AdminPlanningItem[];
}> {
  const coreItems = await getStorageItemsFast([
    STORAGE_KEYS.USERS,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.PARTNERS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.STATUS_UPDATES,
  ]);

  const partners = ((coreItems[STORAGE_KEYS.PARTNERS] as Partner[] | null) || [])
    .filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));

  const projects = (coreItems[STORAGE_KEYS.PROJECTS] as Project[] | null) || [];

  return {
    users: (coreItems[STORAGE_KEYS.USERS] as User[] | null) || [],
    projects: mergeProjectAndEventRecords(
      projects,
      coreItems[STORAGE_KEYS.EVENTS] as Project[] | null
    ),
    programs: [],
    events: (coreItems[STORAGE_KEYS.EVENTS] as Project[] | null) || [],
    partners,
    volunteers: (coreItems[STORAGE_KEYS.VOLUNTEERS] as Volunteer[] | null) || [],
    statusUpdates: (coreItems[STORAGE_KEYS.STATUS_UPDATES] as StatusUpdate[] | null) || [],
    volunteerMatches: [],
    volunteerTimeLogs: [],
    volunteerProjectJoins: [],
    partnerProjectApplications: [],
    partnerReports: [],
    publishedImpactReports: [],
    adminPlanningCalendars: [],
    adminPlanningItems: [],
  };
}

// Loads the combined data set required by the partner dashboard screen.
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
  publishedImpactReports: PublishedImpactReport[];
  volunteerMatches: VolunteerProjectMatch[];
  volunteerTimeLogs: VolunteerTimeLog[];
  volunteerProjectJoins: VolunteerProjectJoinRecord[];
  adminPlanningCalendars: AdminPlanningCalendar[];
  adminPlanningItems: AdminPlanningItem[];
}> {
  await ensurePartnerOwnershipLinks();
  
  const coreItems = await getStorageItemsFast([
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.EVENTS,
    STORAGE_KEYS.PARTNERS,
    STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
    STORAGE_KEYS.PARTNER_REPORTS,
  ]);

  const partners = ((coreItems[STORAGE_KEYS.PARTNERS] as Partner[] | null) || [])
    .filter(p => !p.contactEmail?.toLowerCase().includes('eduindia.org'));

  const projects = (coreItems[STORAGE_KEYS.PROJECTS] as Project[] | null) || [];

  return {
    users: [],
    projects: mergeProjectAndEventRecords(
      projects,
      coreItems[STORAGE_KEYS.EVENTS] as Project[] | null
    ),
    programs: [],
    events: (coreItems[STORAGE_KEYS.EVENTS] as Project[] | null) || [],
    partners,
    volunteers: [],
    statusUpdates: [],
    partnerApplications:
      (coreItems[STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS] as PartnerProjectApplication[] | null) ||
      [],
    partnerReports: (coreItems[STORAGE_KEYS.PARTNER_REPORTS] as PartnerReport[] | null) || [],
    publishedImpactReports: [],
    volunteerMatches: [],
    volunteerTimeLogs: [],
    volunteerProjectJoins: [],
    adminPlanningCalendars: [],
    adminPlanningItems: [],
  };
}

// Loads the shared planning calendar data used by volunteer and partner dashboards.
export async function getDashboardTimelineSnapshot(): Promise<DashboardTimelineSnapshot> {
  try {
    const planningCalendars = await ensureAdminPlanningCalendarsSeeded();

    const coreItems = await getStorageItemsFast([
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.EVENTS,
      STORAGE_KEYS.ADMIN_PLANNING_CALENDARS,
    ]);

    const projects = mergeProjectAndEventRecords(
      coreItems[STORAGE_KEYS.PROJECTS] as Project[] | null,
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

// In-flight requests for snapshots to avoid redundant network overhead.
const inFlightSnapshotRequests = new Map<string, Promise<ProjectsScreenSnapshot>>();

const lastSnapshotRequestTimes = new Map<string, number>();
const GLOBAL_SNAPSHOT_COOLDOWN_MS = 1000;

function invalidateProjectsSnapshotCache(): void {
  projectsSnapshotCache.clear();
}


// Loads the combined project, volunteer, and application data for project-facing screens.
// Optional field filters are forwarded to the backend so each screen can request only
// the collections it needs while still caching per-user/per-field snapshots.
export async function getProjectsScreenSnapshot(
  user?: Pick<User, 'id' | 'role'> | null,
  fields?: string[]
): Promise<ProjectsScreenSnapshot> {
  const normalizedFields = fields?.length
    ? Array.from(
        new Set(
          fields
            .map(field => String(field || '').trim())
            .filter(Boolean)
        )
      )
    : [];
  const requestedFieldSet = new Set(normalizedFields);
  const shouldLoadProjects = normalizedFields.length === 0 || requestedFieldSet.has('projects');
  const shouldLoadProgramTracks =
    normalizedFields.length === 0 ||
    requestedFieldSet.has('programTracks') ||
    requestedFieldSet.has('programCatalog');

  const params = new URLSearchParams();
  if (user?.id) params.set('user_id', user.id);
  if (user?.role) params.set('role', user.role);
  if (normalizedFields.length > 0) {
    params.set('fields', normalizedFields.join(','));
  }
  
  const cacheKey = `snapshot:${params.toString()}`;
  const lastRequestTime = lastSnapshotRequestTimes.get(cacheKey) || 0;

  // Serve only this user's cached snapshot. Reusing another account's snapshot
  // makes volunteer dashboards show the wrong joined events.
  if (Date.now() - lastRequestTime < GLOBAL_SNAPSHOT_COOLDOWN_MS) {
    const cached = projectsSnapshotCache.get(cacheKey);
    if (cached) {
      return cached.data as ProjectsScreenSnapshot;
    }
  }

  const existingRequest = inFlightSnapshotRequests.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const buildSnapshotFallback = async (
    seed?: Partial<ProjectsScreenSnapshot>
  ): Promise<ProjectsScreenSnapshot> => {
    const [fallbackProjects, fallbackProgramTracks] = await Promise.all([
      shouldLoadProjects ? getAllProjects().catch(() => []) : Promise.resolve([] as Project[]),
      shouldLoadProgramTracks
        ? getAllProgramTracks().catch(() => [])
        : Promise.resolve([] as ProgramTrack[]),
    ]);

    return {
      projects:
        shouldLoadProjects && fallbackProjects.length > 0
          ? fallbackProjects
          : (seed?.projects as Project[] | undefined) || [],
      programTracks:
        shouldLoadProgramTracks && fallbackProgramTracks.length > 0
          ? fallbackProgramTracks
          : seed?.programTracks || [],
      volunteerProfile: seed?.volunteerProfile || null,
      volunteerMatches: Array.isArray(seed?.volunteerMatches) ? seed?.volunteerMatches : undefined,
      timeLogs: seed?.timeLogs || [],
      partnerApplications: seed?.partnerApplications || [],
      volunteerJoinRecords: seed?.volunteerJoinRecords || [],
    };
  };

  const snapshotRequest = (async () => {
    try {
      lastSnapshotRequestTimes.set(cacheKey, Date.now());
      const query = params.toString();
      const payload = await requestApiJson<Partial<ProjectsScreenSnapshot>>(
        `/projects/snapshot${query ? `?${query}` : ''}`
      );

      try {
        const result = {
          projects: (payload.projects || []).map(project => {
            try {
              return project?.isEvent ? normalizeEventRecord(project) : normalizeProjectRecord(project);
            } catch (normalizeError) {
              console.error(`[Data] Error normalizing project ${project?.id}:`, normalizeError);
              return project as Project;
            }
          }),
          programTracks: Array.isArray(payload.programTracks) ? payload.programTracks : [],
          volunteerProfile: payload.volunteerProfile || null,
          volunteerMatches: Array.isArray(payload.volunteerMatches) ? payload.volunteerMatches : undefined,
          timeLogs: payload.timeLogs || [],
          partnerApplications: payload.partnerApplications || [],
          volunteerJoinRecords: payload.volunteerJoinRecords || [],
        };

        const recoveredResult =
          (shouldLoadProjects && result.projects.length === 0) ||
          (shouldLoadProgramTracks && result.programTracks.length === 0)
            ? await buildSnapshotFallback(result)
            : result;

        // Cache the result for this specific field-set request
        projectsSnapshotCache.set(cacheKey, { data: recoveredResult, timestamp: Date.now() });
        return recoveredResult;
      } catch (normalizeError) {
        console.error(`[Data] Error normalizing ProjectsSnapshot:`, normalizeError);
        // Return what we can even if normalization fails
        const partialResult = {
          projects: payload.projects || [],
          programTracks: payload.programTracks || [],
          volunteerProfile: payload.volunteerProfile || null,
          volunteerMatches: payload.volunteerMatches,
          timeLogs: payload.timeLogs || [],
          partnerApplications: payload.partnerApplications || [],
          volunteerJoinRecords: payload.volunteerJoinRecords || [],
        };
        const fallbackResult = await buildSnapshotFallback(partialResult);
        projectsSnapshotCache.set(cacheKey, { data: fallbackResult, timestamp: Date.now() });
        return fallbackResult;
      }
    } catch (error) {
      console.error(`[Data] Error fetching ProjectsSnapshot:`, error);
      const fallbackResult = await buildSnapshotFallback();
      projectsSnapshotCache.set(cacheKey, { data: fallbackResult, timestamp: Date.now() });
      return fallbackResult;
    } finally {
      inFlightSnapshotRequests.delete(cacheKey);
    }
  })();

  inFlightSnapshotRequests.set(cacheKey, snapshotRequest);
  return snapshotRequest;
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
  } catch (error) {
    console.error(`Error saving shared ${key} to backend:`, error);
    throw error;
  }
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

export async function validateDswdAccreditationNo(value: string): Promise<{valid: boolean, reason?: string}> {
  const normalizedValue = value.trim().toUpperCase();
  
  // First check basic format
  if (!isValidDswdAccreditationNo(value)) {
    return {valid: false, reason: "Invalid format"};
  }
  
  try {
    const response = await fetch(`${getApiBaseUrl()}/validation/dswd-accreditation/${encodeURIComponent(normalizedValue)}`);
    if (!response.ok) {
      return {valid: false, reason: "Network error"};
    }
    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error validating DSWD accreditation number:", error);
    return {valid: false, reason: "Network error"};
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
  const normalizedAccountPhone = normalizeAccountPhone(value);
  if (normalizedAccountPhone) {
    return normalizedAccountPhone;
  }

  const digits = (value || '').replace(/\D/g, '');
  if (/^63\d{9,11}$/.test(digits)) {
    return `+${digits}`;
  }
  if (/^0\d{9,11}$/.test(digits)) {
    return `+63${digits.slice(1)}`;
  }
  return undefined;
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
  return {
    ...task,
    id: task.id || `task-${projectId}-${Date.now()}`,
    title: task.title?.trim() || 'Untitled Task',
    description: task.description?.trim() || '',
    category: task.category?.trim() || 'General',
    priority: task.priority || 'Medium',
    status: task.status || (task.assignedVolunteerId ? 'Assigned' : 'Unassigned'),
    assignedVolunteerId: task.assignedVolunteerId?.trim() || undefined,
    assignedVolunteerName: task.assignedVolunteerName?.trim() || undefined,
    isFieldOfficer: Boolean(task.isFieldOfficer),
    skillsNeeded: task.skillsNeeded || [],
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now,
  };
}

function _coerceToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string' && value.trim()) {
    // Try comma-separated first, fall back to space-separated
    return value.includes(',')
      ? value.split(',').map(s => s.trim()).filter(Boolean)
      : value.split(/\s+/).filter(Boolean);
  }
  return [];
}

function normalizeProjectSkillsNeeded(
  project: Project,
  normalizedTasks: ProjectInternalTask[]
): string[] {
  const rawSkills = [
    ..._coerceToStringArray(project.skillsNeeded),
    ...normalizedTasks.flatMap(task => _coerceToStringArray(task.skillsNeeded)),
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
    Array.isArray(project.internalTasks) && project.internalTasks.length > 0
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
  const normalizedProgramId =
    String(project.program_id || project.programModule || project.category || '')
      .trim() || undefined;
  const rawStatusMode = String(project.statusMode || '').trim().toLowerCase();
  const hasExplicitStatusMode = rawStatusMode === 'manual' || rawStatusMode === 'system';
  const normalizedStatusMode: Project['statusMode'] =
    rawStatusMode === 'manual' ? 'Manual' : 'System';
  const legacyManualStatus =
    !hasExplicitStatusMode && (project.status === 'On Hold' || project.status === 'Cancelled')
      ? project.status
      : undefined;
  const normalizedManualStatus =
    normalizedStatusMode === 'Manual'
      ? (project.manualStatus || project.status)
      : legacyManualStatus;

  return {
    ...project,
    imageUrl: project.imageUrl?.trim() || undefined,
    imageHidden: Boolean(project.imageHidden),
    category: normalizedCategory,
    programModule: normalizedProgramModule,
    program_id: normalizedProgramId,
    statusMode: normalizedManualStatus ? 'Manual' : normalizedStatusMode,
    manualStatus: normalizedManualStatus || undefined,
    parentProjectId: project.parentProjectId?.trim() || undefined,
    joinedUserIds: project.isEvent ? _coerceToStringArray(project.joinedUserIds) : [],
    volunteers: project.isEvent ? _coerceToStringArray(project.volunteers) : [],
    skillsNeeded: normalizeProjectSkillsNeeded(project, normalizedTasks),
    statusUpdates: project.statusUpdates || [],
    internalTasks: normalizedTasks,
  };
}

function normalizeEventRecord(event: Project): Project {
  return {
    ...normalizeProjectRecord(event),
    isEvent: true,
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
      parentProjectId: undefined,
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

export async function getAllEvents(): Promise<Project[]> {
  return ((await getStorageItemFast<Project[]>(STORAGE_KEYS.EVENTS)) || []).map(
    normalizeEventRecord
  );
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
  partnerRegistration?: {
    organizationName: string;
    sectorType: PartnerSectorType;
    dswdAccreditationNo: string;
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
  const normalizedPassword = input.password.trim();
  const normalizedPhone = normalizeAccountPhone(input.phone);

  if (!normalizedName || !normalizedPassword) {
    throw new Error('Name and password are required.');
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
      !isValidDswdAccreditationNo(input.partnerRegistration.dswdAccreditationNo) ||
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
    password: normalizedPassword,
    phone: normalizedPhone || undefined,
    role: input.role,
    userType: input.userType,
    pillarsOfInterest: input.pillarsOfInterest,
    approvalStatus: 'pending', // New accounts require admin approval
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
  }

  if (input.role === 'partner' && input.partnerRegistration) {
    await savePartner({
      id: `partner-${createdUser.id}`,
      ownerUserId: createdUser.id,
      name: input.partnerRegistration.organizationName.trim(),
      description: `${input.partnerRegistration.advocacyFocus.join(', ')} partnership application`,
      category: getCategoryFromAdvocacyFocus(input.partnerRegistration.advocacyFocus),
      sectorType: input.partnerRegistration.sectorType,
      dswdAccreditationNo: input.partnerRegistration.dswdAccreditationNo.trim().toUpperCase(),
      secRegistrationNo: input.partnerRegistration.secRegistrationNo?.trim().toUpperCase() || '',
      advocacyFocus: input.partnerRegistration.advocacyFocus,
      contactEmail: createdUser.email,
      contactPhone: createdUser.phone,
      status: 'Pending',
      verificationStatus: 'Pending',
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
  const payload = await requestApiJson<{ user?: User | null }>('/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier: identifier.trim(),
      password: password.trim(),
    }),
  }, 15000); // 15 seconds timeout
  return payload.user || null;
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
  const [users, volunteers, partners] = await Promise.all([
    getAllUsers(),
    getAllVolunteers(),
    getAllPartners(),
  ]);

  return users.filter(user => {
    if (user.role === 'admin') {
      return false;
    }

    if (user.approvalStatus === 'pending') {
      return true;
    }

    if (user.approvalStatus === 'approved' || user.approvalStatus === 'rejected') {
      return false;
    }

    if (user.role === 'volunteer') {
      return volunteers.some(
        volunteer =>
          userMatchesLinkedRecord(user, {
            userId: volunteer.userId,
            email: volunteer.email,
            phone: volunteer.phone,
          }) && (volunteer.registrationStatus || 'Pending') === 'Pending'
      );
    }

    if (user.role === 'partner') {
      return partners.some(
        partner =>
          userMatchesLinkedRecord(user, {
            ownerUserId: partner.ownerUserId,
            email: partner.contactEmail,
            phone: partner.contactPhone,
          }) && (partner.status || 'Pending') === 'Pending'
      );
    }

    return false;
  });
}

// Gets all approved users.
export async function getApprovedUsers(): Promise<User[]> {
  const users = await getAllUsers();
  return users.filter(user => user.approvalStatus === 'approved' || !user.approvalStatus);
}

// Approves a pending user account.
export async function approveUser(userId: string, adminId: string): Promise<User> {
  const payload = await requestApiJson<{ user: User }>(
    `/auth/users/${encodeURIComponent(userId)}/approve?admin_id=${encodeURIComponent(adminId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'approved' }),
    }
  );

  invalidateSharedStorageCache([
    STORAGE_KEYS.USERS,
    STORAGE_KEYS.VOLUNTEERS,
    STORAGE_KEYS.PARTNERS,
    STORAGE_KEYS.MESSAGES,
  ]);

  if (!payload.user) {
    throw new Error('Approval completed but the updated user was not returned.');
  }

  return payload.user;
}

// Deletes a pending user account instead of keeping a rejected login around.
export async function rejectUser(
  userId: string,
  rejectionReason: string = 'Account rejected by administrator.',
  adminId?: string
): Promise<void> {
  void rejectionReason;
  void adminId;
  await deleteUser(userId);
}

// Partner Storage
// Inserts or updates a partner organization record.
export async function savePartner(partner: Partner): Promise<void> {
  if (partner.contactEmail?.trim() && !isValidEmailAddress(partner.contactEmail.trim().toLowerCase())) {
    throw new Error('Please enter a valid partner email address.');
  }
  if (partner.contactPhone?.trim() && !normalizePartnerContactPhone(partner.contactPhone)) {
    throw new Error('Use a valid Philippine contact number for the partner record.');
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
}

async function ensureAdminPlanningCalendarsSeeded(): Promise<AdminPlanningCalendar[]> {
  try {
    const existingCalendars =
      (await getStorageItem<AdminPlanningCalendar[]>(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS)) || [];

    if (existingCalendars.length > 0) {
      return migrateLegacyPlanningItemsIntoCalendars(existingCalendars);
    }

    const seededCalendars = DEFAULT_ADMIN_PLANNING_CALENDARS.map(calendar => ({ ...calendar }));
    await setStorageItem(STORAGE_KEYS.ADMIN_PLANNING_CALENDARS, seededCalendars);
    return migrateLegacyPlanningItemsIntoCalendars(seededCalendars);
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

// Program Tracks Storage
// Inserts or updates a program track.
export async function saveProgramTrack(programTrack: ProgramTrack): Promise<void> {
  const [programTracks, programs] = await Promise.all([
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAM_TRACKS),
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAMS),
  ]);

  const nextProgramTracks = (programTracks || []).slice();
  const nextPrograms = (programs || []).slice();
  const now = new Date().toISOString();
  const normalizedTrack: ProgramTrack = {
    ...programTrack,
    createdAt: programTrack.createdAt || now,
    updatedAt: now,
  };
  const syncCollection = (collection: ProgramTrack[]) => {
    const existingIndex = collection.findIndex(item => item.id === normalizedTrack.id);
    if (existingIndex >= 0) {
      collection[existingIndex] = normalizedTrack;
      return;
    }
    collection.push(normalizedTrack);
  };

  syncCollection(nextProgramTracks);
  syncCollection(nextPrograms);

  await Promise.all([
    setStorageItem(STORAGE_KEYS.PROGRAM_TRACKS, nextProgramTracks),
    setStorageItem(STORAGE_KEYS.PROGRAMS, nextPrograms),
  ]);
}

// Deletes a program track by id.
export async function deleteProgramTrack(programTrackId: string): Promise<void> {
  const [programTracks, programs] = await Promise.all([
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAM_TRACKS),
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAMS),
  ]);

  await Promise.all([
    setStorageItem(
      STORAGE_KEYS.PROGRAM_TRACKS,
      (programTracks || []).filter(programTrack => programTrack.id !== programTrackId)
    ),
    setStorageItem(
      STORAGE_KEYS.PROGRAMS,
      (programs || []).filter(program => program.id !== programTrackId)
    ),
  ]);
}

export async function getAllProgramTracks(): Promise<ProgramTrack[]> {
  return (await getStorageItem<ProgramTrack[]>('programTracks')) || [];
}

// Project Storage
// Inserts or updates a project or event record.
export async function saveProgram(program: ProgramTrack): Promise<void> {
  const [programTracks, programs] = await Promise.all([
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAM_TRACKS),
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAMS),
  ]);

  const nextProgram = { ...program };
  const nextProgramTracks = (programTracks || []).slice();
  const nextPrograms = (programs || []).slice();

  const upsert = (collection: ProgramTrack[]) => {
    const existingIndex = collection.findIndex(item => item.id === nextProgram.id);
    if (existingIndex >= 0) {
      collection[existingIndex] = { ...collection[existingIndex], ...nextProgram };
      return;
    }
    collection.push(nextProgram);
  };

  upsert(nextProgramTracks);
  upsert(nextPrograms);

  await Promise.all([
    setStorageItem(STORAGE_KEYS.PROGRAM_TRACKS, nextProgramTracks),
    setStorageItem(STORAGE_KEYS.PROGRAMS, nextPrograms),
  ]);
}

export async function deleteProgram(programId: string): Promise<void> {
  const [programTracks, programs] = await Promise.all([
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAM_TRACKS),
    getStorageItem<ProgramTrack[]>(STORAGE_KEYS.PROGRAMS),
  ]);

  await Promise.all([
    setStorageItem(
      STORAGE_KEYS.PROGRAM_TRACKS,
      (programTracks || []).filter(track => track.id !== programId)
    ),
    setStorageItem(
      STORAGE_KEYS.PROGRAMS,
      (programs || []).filter(program => program.id !== programId)
    ),
  ]);
}

export async function saveProject(project: Project): Promise<void> {
  const projects = await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS) || [];
  const existingIndex = projects.findIndex(p => p.id === project.id);
  const normalizedProject = normalizeProjectRecord({
    ...project,
    isEvent: false,
    parentProjectId: undefined,
    skillsNeeded: normalizeProjectSkillsNeeded(project, Array.isArray(project.internalTasks) ? project.internalTasks : []),
  });
  if (existingIndex >= 0) {
    projects[existingIndex] = normalizedProject;
  } else {
    projects.push(normalizedProject);
  }
  await setStorageItem(STORAGE_KEYS.PROJECTS, projects);
  invalidateProjectsSnapshotCache();
}

// Inserts or updates an event record in the dedicated events collection.
export async function saveEvent(event: Project): Promise<void> {
  const rawEvents = await getStorageItem<Project[]>(STORAGE_KEYS.EVENTS) || [];
  const existingIndex = rawEvents.findIndex(entry => entry.id === event.id);
  const normalizedEvent = normalizeEventRecord({
    ...event,
    skillsNeeded: normalizeProjectSkillsNeeded(event, Array.isArray(event.internalTasks) ? event.internalTasks : []),
  });
  if (existingIndex >= 0) {
    rawEvents[existingIndex] = normalizedEvent;
  } else {
    rawEvents.push(normalizedEvent);
  }
  // Normalize all events (fixes legacy string-vs-array issues in older records)
  const events = rawEvents.map(e => e.id === normalizedEvent.id ? normalizedEvent : normalizeEventRecord(e));
  await setStorageItem(STORAGE_KEYS.EVENTS, events);
  invalidateProjectsSnapshotCache();
}

// Deletes a project and cleans up dependent records that reference it.
export async function deleteProject(projectId: string): Promise<void> {
  const [
    projects,
    programs,
    events,
    statusUpdates,
    partnerApplications,
    partnerReports,
    publishedImpactReports,
    volunteerJoinRecords,
    volunteerTimeLogs,
    projectGroupMessages,
  ] =
    await Promise.all([
      getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS),
      getStorageItem<Project[]>(STORAGE_KEYS.PROGRAMS),
      getStorageItem<Project[]>(STORAGE_KEYS.EVENTS),
      getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES),
      getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS),
      getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS),
      getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS),
      getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
      getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS),
      getStorageItem<ProjectGroupMessage[]>(STORAGE_KEYS.PROJECT_GROUP_MESSAGES),
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
      STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS,
      (publishedImpactReports || []).filter(report => !relatedProjectIds.has(report.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
      (volunteerJoinRecords || []).filter(record => !relatedProjectIds.has(record.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
      (volunteerTimeLogs || []).filter(log => !relatedProjectIds.has(log.projectId))
    ),
    setStorageItem(
      STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
      (projectGroupMessages || []).filter(message => !relatedProjectIds.has(message.projectId))
    ),
  ]);
}

// Deletes one event and cleans up records that reference it.
export async function deleteEvent(eventId: string): Promise<void> {
  const [
    events,
    statusUpdates,
    partnerApplications,
    partnerReports,
    publishedImpactReports,
    volunteerJoinRecords,
    volunteerTimeLogs,
    projectGroupMessages,
  ] =
    await Promise.all([
      getStorageItem<Project[]>(STORAGE_KEYS.EVENTS),
      getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES),
      getStorageItem<PartnerProjectApplication[]>(STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS),
      getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS),
      getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS),
      getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
      getStorageItem<VolunteerTimeLog[]>(STORAGE_KEYS.VOLUNTEER_TIME_LOGS),
      getStorageItem<ProjectGroupMessage[]>(STORAGE_KEYS.PROJECT_GROUP_MESSAGES),
    ]);

  await Promise.all([
    setStorageItem(
      STORAGE_KEYS.EVENTS,
      (events || []).filter(event => event.id !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.STATUS_UPDATES,
      (statusUpdates || []).filter(update => update.projectId !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_PROJECT_APPLICATIONS,
      (partnerApplications || []).filter(application => application.projectId !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.PARTNER_REPORTS,
      (partnerReports || []).filter(report => report.projectId !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS,
      (publishedImpactReports || []).filter(report => report.projectId !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
      (volunteerJoinRecords || []).filter(record => record.projectId !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_TIME_LOGS,
      (volunteerTimeLogs || []).filter(log => log.projectId !== eventId)
    ),
    setStorageItem(
      STORAGE_KEYS.PROJECT_GROUP_MESSAGES,
      (projectGroupMessages || []).filter(message => message.projectId !== eventId)
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
  const [projects, events] = await Promise.all([
    getStorageItemFast<Project[]>(STORAGE_KEYS.PROJECTS),
    getStorageItemFast<Project[]>(STORAGE_KEYS.EVENTS),
  ]);

  return mergeProjectAndEventRecords(
    projects,
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
    name: volunteer.name.trim(),
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
  const payload = await requestApiJson<{ volunteer?: Volunteer | null }>(
    `/volunteers/by-user/${encodeURIComponent(userId)}`
  );
  return payload.volunteer ? normalizeVolunteerRecord(payload.volunteer) : null;
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

  try {
    const [volunteer, project] = await Promise.all([
      getVolunteer(volunteerId),
      getProject(projectId),
    ]);

    if (volunteer && project) {
      await notifyVolunteerAboutTimeIn({
        event: project,
        volunteer,
        timeIn: payload.log.timeIn,
      });
    }
  } catch (error) {
    console.error('Failed to send volunteer time in notification:', error);
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
    await ensureVolunteerProjectJoinRecord(
      match.projectId,
      match.volunteerId,
      match.requestedAt ? 'VolunteerJoin' : 'AdminMatch'
    );
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

  // Keep local shared storage in sync with the backend review result.
  await saveVolunteerProjectMatch(payload.match);

  try {
    const volunteer = await getVolunteer(payload.match.volunteerId);
    await notifyVolunteerAboutProjectMatchDecision(
      payload.match.projectId,
      volunteer?.userId || '',
      reviewedBy,
      nextStatus,
      'request'
    );
  } catch (error) {
    console.error('Error notifying volunteer about request review:', error);
  }

  return payload.match;
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

// Repairs legacy/partial approvals so every matched volunteer is present in event membership.
export async function reconcileApprovedVolunteerEventMemberships(): Promise<void> {
  const [events, volunteers, matches, joinRecords] = await Promise.all([
    getStorageItem<Project[]>(STORAGE_KEYS.EVENTS),
    getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS),
    getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES),
    getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
  ]);

  const eventRecords = events || [];
  const volunteerById = new Map((volunteers || []).map(volunteer => [volunteer.id, volunteer]));
  const nextJoinRecords = [...(joinRecords || [])];
  let eventsChanged = false;
  let joinRecordsChanged = false;

  const matchedByProjectId = new Map<string, VolunteerProjectMatch[]>();
  (matches || []).forEach(match => {
    if (match.status !== 'Matched') {
      return;
    }
    const projectMatches = matchedByProjectId.get(match.projectId) || [];
    projectMatches.push(match);
    matchedByProjectId.set(match.projectId, projectMatches);
  });

  const nextEvents = eventRecords.map(event => {
    if (!event.isEvent) {
      return event;
    }

    const projectMatches = matchedByProjectId.get(event.id) || [];
    if (projectMatches.length === 0) {
      return event;
    }

    const volunteerIds = new Set(event.volunteers || []);
    const joinedUserIds = new Set(event.joinedUserIds || []);
    let eventChanged = false;

    projectMatches.forEach(match => {
      const volunteer = volunteerById.get(match.volunteerId);
      if (!volunteer) {
        return;
      }

      if (!volunteerIds.has(volunteer.id)) {
        volunteerIds.add(volunteer.id);
        eventChanged = true;
      }

      if (volunteer.userId && !joinedUserIds.has(volunteer.userId)) {
        joinedUserIds.add(volunteer.userId);
        eventChanged = true;
      }

      const hasJoinRecord = nextJoinRecords.some(
        record => record.projectId === event.id && record.volunteerId === volunteer.id
      );
      if (!hasJoinRecord) {
        nextJoinRecords.push({
          id: buildVolunteerProjectJoinRecordId(event.id, volunteer.id),
          projectId: event.id,
          volunteerId: volunteer.id,
          volunteerUserId: volunteer.userId,
          volunteerName: volunteer.name,
          volunteerEmail: volunteer.email,
          joinedAt: match.reviewedAt || match.matchedAt || new Date().toISOString(),
          source: 'VolunteerJoin',
          participationStatus: 'Active',
        });
        joinRecordsChanged = true;
      }
    });

    if (!eventChanged) {
      return event;
    }

    eventsChanged = true;
    return {
      ...event,
      volunteers: Array.from(volunteerIds),
      joinedUserIds: Array.from(joinedUserIds),
      updatedAt: new Date().toISOString(),
    };
  });

  const writes: Promise<void>[] = [];
  if (eventsChanged) {
    writes.push(setStorageItem(STORAGE_KEYS.EVENTS, nextEvents));
  }
  if (joinRecordsChanged) {
    writes.push(setStorageItem(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS, nextJoinRecords));
  }

  if (writes.length > 0) {
    await Promise.all(writes);
    invalidateProjectsSnapshotCache();
    invalidateSharedStorageCache([
      STORAGE_KEYS.EVENTS,
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
      STORAGE_KEYS.VOLUNTEER_MATCHES,
    ]);
  }
}

// Removes a volunteer from an event group chat by clearing their event membership records.
export async function leaveVolunteerEventGroup(
  projectId: string,
  userId: string
): Promise<void> {
  const [project, volunteer, joinRecords, matches] = await Promise.all([
    getProject(projectId),
    getVolunteerByUserId(userId),
    getStorageItem<VolunteerProjectJoinRecord[]>(STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS),
    getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES),
  ]);

  if (!project?.isEvent) {
    throw new Error('Event group chat not found.');
  }

  if (!volunteer) {
    throw new Error('Volunteer profile not found.');
  }

  const nextTasks = (project.internalTasks || []).map(task => {
    if (task.assignedVolunteerId !== volunteer.id || task.isFieldOfficer) {
      return task;
    }

    return {
      ...task,
      assignedVolunteerId: undefined,
      assignedVolunteerName: undefined,
      status: 'Unassigned' as const,
      updatedAt: new Date().toISOString(),
    };
  });

  await Promise.all([
    saveEvent({
      ...project,
      volunteers: (project.volunteers || []).filter(volunteerId => volunteerId !== volunteer.id),
      joinedUserIds: (project.joinedUserIds || []).filter(joinedUserId => joinedUserId !== userId),
      internalTasks: nextTasks,
      updatedAt: new Date().toISOString(),
    }),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_PROJECT_JOINS,
      (joinRecords || []).filter(
        record => !(record.projectId === projectId && record.volunteerId === volunteer.id)
      )
    ),
    setStorageItem(
      STORAGE_KEYS.VOLUNTEER_MATCHES,
      (matches || []).filter(
        match => !(match.projectId === projectId && match.volunteerId === volunteer.id)
      )
    ),
  ]);
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
  const proposalProjectId = requestedProgramModule
    ? buildProgramProposalProjectId(requestedProgramModule)
    : projectId;

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

  try {
    await notifyAdminAboutPartnerProjectJoin(proposalProjectId, partnerUser);
  } catch (error) {
    console.error('Error notifying admin about partner join request:', error);
  }

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
  reviewedBy: string
): Promise<void> {
  const payload = await requestApiJson<{ application?: PartnerProjectApplication | null }>(
    `/partner-project-applications/${encodeURIComponent(applicationId)}/review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
        reviewedBy,
      }),
    }
  );

  if (!payload.application) {
    throw new Error('Application review did not complete.');
  }

  try {
    await notifyPartnerAboutProjectJoinReview(payload.application, reviewedBy);
  } catch (error) {
    console.error('Error notifying partner about application review:', error);
  }
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
  reviewedBy: string
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

  return updatedPartner;
}

// Saves one uploaded partner report.
export async function savePartnerReport(report: PartnerReport): Promise<void> {
  const reports = await getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  const existingIndex = reports.findIndex(entry => entry.id === report.id);
  if (existingIndex >= 0) {
    reports[existingIndex] = report;
  } else {
    reports.push(report);
  }
  await setStorageItem(STORAGE_KEYS.PARTNER_REPORTS, reports);
}

// Returns partner reports associated with one project.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getPartnerReportsByProject(projectId: string): Promise<PartnerReport[]> {
  const reports = await getStorageItemFast<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  return reports
    .filter(report => report.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Returns partner reports submitted by one partner user.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getPartnerReportsByUser(partnerUserId: string): Promise<PartnerReport[]> {
  const reports = await getStorageItemFast<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  return reports
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
  return reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Returns every impact-hub report submitted by one user regardless of role.
// OPTIMIZED: Use cached getStorageItemFast instead of slow getStorageItem
export async function getImpactHubReportsByUser(userId: string): Promise<PartnerReport[]> {
  const reports = await getStorageItemFast<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [];
  return reports
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

  const total = Object.values(metrics).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0
  );

  return Math.max(0, Math.round(total));
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

  const volunteer = await getVolunteerByUserIdWithFallback(input.submitterUserId);
  if (!volunteer) {
    throw new Error('Volunteer profile not found. You must complete your volunteer profile first.');
  }

  const timeLogs = await getVolunteerTimeLogsWithFallback(volunteer.id);
  const hasTimedIn = timeLogs.some(
    log => log.projectId === input.projectId && Boolean(log.timeIn?.trim())
  );

  if (!hasTimedIn) {
    throw new Error('You must time in to this event before submitting a report.');
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
    createdAt: new Date().toISOString(),
    status: 'Submitted',
    sourceReportIds: [],
  };

  try {
    const payload = await requestApiJson<{ report?: PartnerReport }>('/reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(report),
    });
    if (payload.report) {
      return payload.report;
    }
  } catch (error: any) {
    const message = String(error?.message || '');
    if (!message.includes('404')) {
      throw error;
    }
  }

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

// Saves one generated impact file entry.
export async function savePublishedImpactReport(report: PublishedImpactReport): Promise<void> {
  const reports =
    await getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS) || [];
  const existingIndex = reports.findIndex(entry => entry.id === report.id);
  if (existingIndex >= 0) {
    reports[existingIndex] = report;
  } else {
    reports.push(report);
  }
  await setStorageItem(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS, reports);
}

// Returns generated impact files for a specific project.
export async function getPublishedImpactReportsByProject(
  projectId: string
): Promise<PublishedImpactReport[]> {
  const reports =
    await getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS) || [];
  return reports
    .filter(report => report.projectId === projectId)
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
}

// Returns every generated impact file regardless of partner visibility.
export async function getAllPublishedImpactReports(): Promise<PublishedImpactReport[]> {
  const reports =
    await getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS) || [];
  return reports.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
}

// Returns only partner-visible impact files for the owning partner user.
export async function getPublishedImpactReportsByPartnerUser(
  partnerUserId: string
): Promise<PublishedImpactReport[]> {
  const [reports, projects, partnerApplications] = await Promise.all([
    getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS),
    getAllProjects(),
    getPartnerProjectApplicationsByUser(partnerUserId),
  ]);

  const approvedApplicationProjectIds = new Set(
    partnerApplications
      .filter(application => application.status === 'Approved')
      .map(application => application.projectId)
  );
  const allowedProjectIds = new Set(
    projects
      .filter(project => approvedApplicationProjectIds.has(project.id))
      .map(project => project.id)
  );

  return (reports || [])
    .filter(report => Boolean(report.publishedAt) && allowedProjectIds.has(report.projectId))
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
}

function formatMetricLabel(metricKey: string): string {
  return metricKey
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function escapeCsvValue(value: string | number | undefined): string {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

function buildGeneratedImpactTextReport(project: Project, reports: PartnerReport[]): string {
  const totals = reports.reduce<Record<string, number>>((accumulator, report) => {
    Object.entries(report.metrics || {}).forEach(([key, value]) => {
      if (typeof value === 'number') {
        accumulator[key] = (accumulator[key] || 0) + value;
      }
    });
    return accumulator;
  }, {});

  const volunteerCount = reports.filter(report => report.submitterRole === 'volunteer').length;
  const partnerCount = reports.filter(report => report.submitterRole === 'partner').length;
  const totalImpact = reports.reduce((sum, report) => sum + (report.impactCount || 0), 0);
  const metricLines = Object.entries(totals)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `- ${formatMetricLabel(key)}: ${value}`);

  const reportDetails = reports.map((report, index) => {
    const metricSummary = Object.entries(report.metrics || {})
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => `${formatMetricLabel(key)}=${value}`)
      .join(', ');

    return [
      `${index + 1}. ${report.title || `${report.submitterName || report.partnerName || 'User'} Report`}`,
      `   Submitted by: ${report.submitterName || report.partnerName || 'User'} (${report.submitterRole || 'partner'})`,
      `   Type: ${report.reportType}`,
      `   Date: ${new Date(report.createdAt).toLocaleString()}`,
      `   Impact Count: ${report.impactCount || 0}`,
      `   Description: ${report.description || 'No description provided.'}`,
      `   Metrics: ${metricSummary || 'No numeric metrics submitted.'}`,
      `   Media: ${report.mediaFile || 'No media attached.'}`,
    ].join('\n');
  });

  return [
    'Volunteer System Impact Summary',
    `Project: ${project.title}`,
    `Category: ${project.category}`,
    `Status: ${project.status}`,
    `Location: ${project.location}`,
    `Schedule: ${project.startDate} to ${project.endDate}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    'Submission Summary',
    `- Total Submitted Reports: ${reports.length}`,
    `- Volunteer Reports: ${volunteerCount}`,
    `- Partner Reports: ${partnerCount}`,
    `- Total Impact Count: ${totalImpact}`,
    ...(metricLines.length > 0 ? ['', 'Metric Totals', ...metricLines] : ['', 'Metric Totals', '- No numeric metrics submitted.']),
    '',
    'Submitted Report Details',
    ...(reportDetails.length > 0 ? reportDetails : ['No reports have been submitted for this project yet.']),
  ].join('\n');
}

function buildGeneratedImpactCsvReport(project: Project, reports: PartnerReport[]): string {
  const headers = [
    'Project',
    'Project Status',
    'Title',
    'Submitter Name',
    'Submitter Role',
    'Report Type',
    'Submitted At',
    'Impact Count',
    'Description',
    'Metrics',
    'Media File',
  ];

  const rows = reports.map(report => {
    const metricSummary = Object.entries(report.metrics || {})
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => `${formatMetricLabel(key)}=${value}`)
      .join('; ');

    return [
      project.title,
      project.status,
      report.title || `${report.submitterName || report.partnerName || 'User'} Report`,
      report.submitterName || report.partnerName || 'User',
      report.submitterRole || 'partner',
      report.reportType,
      report.createdAt,
      report.impactCount || 0,
      report.description || '',
      metricSummary,
      report.mediaFile || '',
    ]
      .map(escapeCsvValue)
      .join(',');
  });

  return [headers.map(escapeCsvValue).join(','), ...rows].join('\n');
}

// Generates readable text and spreadsheet exports from submitted project reports.
export async function generateFinalImpactReports(
  projectId: string,
  generatedBy: string
): Promise<PublishedImpactReport[]> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found.');
  }

  const submittedReports =
    (await getStorageItem<PartnerReport[]>(STORAGE_KEYS.PARTNER_REPORTS) || [])
      .filter(report => report.projectId === projectId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const timestamp = Date.now();
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const generatedAt = new Date().toISOString();
  const reports: PublishedImpactReport[] = [
    {
      id: `impact-${projectId}-pdf-${timestamp}`,
      projectId,
      generatedBy,
      generatedAt,
      reportFile: `${slug || 'project'}-impact-report-${timestamp}.pdf`,
      format: 'PDF',
      downloadContent: buildGeneratedImpactTextReport(project, submittedReports),
      downloadMimeType: 'text/plain;charset=utf-8;',
      sourceReportIds: submittedReports.map(report => report.id),
    },
    {
      id: `impact-${projectId}-excel-${timestamp}`,
      projectId,
      generatedBy,
      generatedAt,
      reportFile: `${slug || 'project'}-impact-report-${timestamp}.xlsx`,
      format: 'Excel',
      downloadContent: buildGeneratedImpactCsvReport(project, submittedReports),
      downloadMimeType: 'text/csv;charset=utf-8;',
      sourceReportIds: submittedReports.map(report => report.id),
    },
  ];

  const existingReports =
    await getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS) || [];
  const nextReports = existingReports.filter(
    report =>
      report.projectId !== projectId ||
      Boolean(report.publishedAt) ||
      !reports.some(generatedReport => generatedReport.format === report.format)
  );
  await setStorageItem(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS, [...nextReports, ...reports]);

  return reports;
}

// Publishes a generated impact file to the partner portal.
export async function publishImpactReport(reportId: string): Promise<PublishedImpactReport> {
  const reports =
    await getStorageItem<PublishedImpactReport[]>(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS) || [];
  const reportIndex = reports.findIndex(report => report.id === reportId);
  if (reportIndex === -1) {
    throw new Error('Generated impact report not found.');
  }

  const updatedReport: PublishedImpactReport = {
    ...reports[reportIndex],
    publishedAt: new Date().toISOString(),
  };
  reports[reportIndex] = updatedReport;
  await setStorageItem(STORAGE_KEYS.PUBLISHED_IMPACT_REPORTS, reports);
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
      sharedStorageCacheTimestamps.clear();
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
