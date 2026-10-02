/**
 * googleCalendarSync.ts
 *
 * Handles Google OAuth sign-in and syncing of system projects/events
 * to the authenticated user's Google Calendar (primary calendar).
 *
 * Flow:
 *   1. signInWithGoogle()       — Opens OAuth browser flow, returns access token
 *   2. syncToGoogleCalendar()   — Accepts access token + projects, pushes events
 *   3. formatProjectAsEvent()   — Maps a Project to a Google Calendar event body
 */

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { AdminPlanningItem, Project } from '../models/types';
import { getApiBaseUrl, getApiAuthHeaders } from '../models/storage';
import { getEventRepeatRule } from './attendanceSchedule';

// Required so the auth session redirect works correctly on mobile
WebBrowser.maybeCompleteAuthSession();

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Your Google Cloud OAuth 2.0 Client ID.
 * Replace this with the one from your Google Cloud Console credentials page.
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  '163385365479-jaeg90dmalfqvjrkmbc0pigdaocof652.apps.googleusercontent.com';

export const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
  process.env.GOOGLE_ANDROID_CLIENT_ID ||
  '163385365479-ad5evavq9an4oarcp08ct9abv50jcr74.apps.googleusercontent.com';

const GOOGLE_NATIVE_REDIRECT_URI = 'com.volcre.nvcconnect:/oauthredirect';

// Retain the existing export for callers that only need the active platform's
// client ID. Calendar OAuth must use the Android client in the APK and the web
// client in the browser.
export const GOOGLE_CLIENT_ID = Platform.OS === 'android'
  ? GOOGLE_ANDROID_CLIENT_ID
  : GOOGLE_WEB_CLIENT_ID;

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Scopes requested from Google:
//   - openid + profile + email  → basic user info
//   - calendar.events           → write events to Google Calendar
export const GOOGLE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GoogleCalendarEvent {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  recurrence?: string[];
  colorId?: string;
  status?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

export interface SyncResult {
  success: boolean;
  synced: number;
  removed: number;
  failed: number;
  errors: string[];
}

type CalendarCleanupOptions = {
  role: 'volunteer';
  userId: string;
  unjoinedEventProjects: Project[];
} | {
  role: 'admin';
  userId: string;
  planningItems: AdminPlanningItem[];
  retainedProjectIds: string[];
};

export type CalendarSyncRole = 'volunteer' | 'partner' | 'admin';

type CalendarSyncEmailPayload = {
  recipientEmail?: string;
  userName: string;
  syncedCount: number;
  role: CalendarSyncRole;
  calendarUrl?: string;
};

export const GOOGLE_CALENDAR_WEB_URL = 'https://calendar.google.com/calendar/u/0/r';

// ─── OAuth Hook Config ────────────────────────────────────────────────────────

/**
 * Returns the discovery document and request config needed by expo-auth-session.
 * Call this inside a component using useAuthRequest().
 */
export function getGoogleAuthConfig(
  loginHint?: string,
  options: { serverExchange?: boolean } = {}
) {
  const discovery = {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  };

  const isAndroid = Platform.OS === 'android';
  const useAuthorizationCode = isAndroid || options.serverExchange === true;
  const redirectUri = AuthSession.makeRedirectUri(
    isAndroid ? { native: GOOGLE_NATIVE_REDIRECT_URI } : undefined
  );

  const request: AuthSession.AuthRequestConfig = {
    clientId: isAndroid ? GOOGLE_ANDROID_CLIENT_ID : GOOGLE_WEB_CLIENT_ID,
    redirectUri,
    scopes: GOOGLE_SCOPES,
    // The partner's server-side connection needs an authorization code so the
    // backend can retain an encrypted refresh token and watch for calendar edits.
    // Other calendar sync callers keep their existing browser flow.
    responseType: useAuthorizationCode
      ? AuthSession.ResponseType.Code
      : AuthSession.ResponseType.Token,
    // AuthSession defaults an undefined value to true. The browser token flow
    // must pass false explicitly so Google receives no PKCE parameters.
    usePKCE: useAuthorizationCode,
    extraParams: {
      access_type: options.serverExchange ? 'offline' : 'online',
      prompt: options.serverExchange ? 'consent select_account' : 'select_account',
      ...(loginHint?.trim() ? { login_hint: loginHint.trim() } : {}),
    },
  };

  return { discovery, request, redirectUri };
}

/** Connects a partner Google Calendar through the authenticated NVC backend. */
export async function connectPartnerGoogleCalendar(
  authResult: AuthSession.AuthSessionResult,
  request: Pick<AuthSession.AuthRequest, 'codeVerifier'> | null,
  authConfig: ReturnType<typeof getGoogleAuthConfig>,
  projectIds: string[]
): Promise<{ synced: number; connected: boolean }> {
  if (authResult.type !== 'success') {
    throw new Error('Google Calendar permission was not granted.');
  }

  const authorizationCode = authResult.params.code;
  if (!authorizationCode) {
    throw new Error('Google did not return an authorization code. Please try again.');
  }
  if (!request?.codeVerifier) {
    throw new Error('Google authorization did not return a valid PKCE verifier. Please try again.');
  }

  const authHeaders = await getApiAuthHeaders();
  const response = await fetch(`${getApiBaseUrl()}/partner/google-calendar/connect`, {
    method: 'POST',
    credentials: typeof document !== 'undefined' ? 'include' : undefined,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'ngrok-skip-browser-warning': '69420',
      'User-Agent': 'VolCre-App/1.0',
      ...authHeaders,
    },
    body: JSON.stringify({
      authorizationCode,
      clientId: authConfig.request.clientId,
      redirectUri: authConfig.redirectUri,
      codeVerifier: request.codeVerifier,
      projectIds: [...new Set(projectIds.map(id => String(id || '').trim()).filter(Boolean))],
    }),
  });

  const payload = await response.json().catch(() => ({})) as {
    detail?: string;
    synced?: number;
    connected?: boolean;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Partner calendar connection failed (HTTP ${response.status}).`);
  }
  return { synced: Number(payload.synced || 0), connected: payload.connected === true };
}

/**
 * Returns the access token from either the browser implicit response or the
 * Android authorization-code response. The core AuthSession hook does not
 * exchange authorization codes automatically, so native builds do it here
 * with the request's PKCE verifier.
 */
export async function resolveGoogleCalendarAccessToken(
  authResult: AuthSession.AuthSessionResult,
  request: Pick<AuthSession.AuthRequest, 'codeVerifier'> | null,
  authConfig: ReturnType<typeof getGoogleAuthConfig>
): Promise<string | undefined> {
  if (authResult.type !== 'success') {
    return undefined;
  }

  const directAccessToken = authResult.authentication?.accessToken;
  if (directAccessToken) {
    return directAccessToken;
  }

  const code = authResult.params.code;
  if (!code) {
    return undefined;
  }

  if (!request?.codeVerifier) {
    throw new Error('Google authorization did not return a valid PKCE verifier. Please try again.');
  }

  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId: authConfig.request.clientId,
      code,
      redirectUri: authConfig.redirectUri,
      scopes: GOOGLE_SCOPES,
      extraParams: {
        code_verifier: request.codeVerifier,
      },
    },
    authConfig.discovery
  );

  return tokenResponse.accessToken || undefined;
}

function normalizeEmail(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

export async function getGoogleCalendarAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Unable to verify the selected Google account.');
  }

  const profile = (await response.json().catch(() => ({}))) as { email?: string };
  return normalizeEmail(profile.email);
}

export async function assertGoogleCalendarAccountMatchesUser(
  accessToken: string,
  expectedEmail?: string | null
): Promise<string> {
  const expected = normalizeEmail(expectedEmail);
  if (!expected) {
    return getGoogleCalendarAccountEmail(accessToken);
  }

  const selectedEmail = await getGoogleCalendarAccountEmail(accessToken);
  if (!selectedEmail) {
    throw new Error('Google did not return an email for the selected account.');
  }

  if (selectedEmail !== expected) {
    throw new Error(
      `You selected ${selectedEmail}, but this NVC account is signed in as ${expected}. Choose the matching Google account before syncing.`
    );
  }

  return selectedEmail;
}

// ─── Event Formatting ─────────────────────────────────────────────────────────

function addDaysToDateOnly(value: string, days: number): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFirstOccurrenceEndDateTime(project: Project): string {
  const start = new Date(project.startDate);
  const seriesEnd = new Date(project.endDate || project.startDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(seriesEnd.getTime())) {
    return project.endDate || project.startDate;
  }

  const occurrenceEnd = new Date(start);
  occurrenceEnd.setHours(
    seriesEnd.getHours(),
    seriesEnd.getMinutes(),
    seriesEnd.getSeconds(),
    seriesEnd.getMilliseconds()
  );
  if (occurrenceEnd <= start) {
    occurrenceEnd.setDate(occurrenceEnd.getDate() + 1);
  }
  return occurrenceEnd.toISOString();
}

function getGoogleRecurrence(project: Project): string[] {
  if (!project.isEvent) return [];

  const repeat = getEventRepeatRule(project);
  const frequencyByRepeat = {
    Daily: 'DAILY',
    Weekly: 'WEEKLY',
    Monthly: 'MONTHLY',
  } as const;
  if (repeat === 'Does not repeat') return [];

  const endValue = project.endDate || project.startDate;
  const isAllDay = !project.startDate.includes('T') && !endValue.includes('T');
  let until: string;
  let frequencyRule = `FREQ=${frequencyByRepeat[repeat]}`;

  if (repeat === 'Monthly') {
    const start = new Date(project.startDate);
    if (!Number.isNaN(start.getTime())) {
      const startDay = start.getDate();
      frequencyRule += startDay > 28
        ? `;BYMONTHDAY=${startDay},-1;BYSETPOS=1`
        : `;BYMONTHDAY=${startDay}`;
    }
  }

  if (isAllDay) {
    until = endValue.slice(0, 10).replace(/-/g, '');
  } else {
    const start = new Date(project.startDate);
    const end = new Date(endValue);
    const finalOccurrence = end < start ? start : end;
    if (Number.isNaN(finalOccurrence.getTime())) return [];
    until = finalOccurrence.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  return [`RRULE:${frequencyRule};UNTIL=${until}`];
}

/**
 * Maps a Project/Event from the volunteer system to a Google Calendar event body.
 * Uses ISO date strings if times are present, or date-only format otherwise.
 */
export function formatProjectAsGoogleEvent(project: Project): GoogleCalendarEvent {
  const toDateTime = (dateStr: string): { dateTime: string; timeZone: string } | { date: string } => {
    // If the stored string includes a time component (T), treat as dateTime
    if (dateStr.includes('T')) {
      return { dateTime: dateStr, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
    // Otherwise use date-only (all-day event)
    return { date: dateStr.slice(0, 10) };
  };

  const locationParts: string[] = [];
  if (project.location?.address) locationParts.push(project.location.address);
  if (project.locationVenue) locationParts.push(project.locationVenue);
  if (project.locationCity) locationParts.push(project.locationCity);
  if (project.locationRegion) locationParts.push(project.locationRegion);

  const descriptionLines: string[] = [
    project.description,
    '',
    `📂 Category: ${project.category}`,
    `📌 Status: ${project.status}`,
    `👥 Volunteers Needed: ${project.volunteersNeeded}`,
  ];
  if (project.communityNeed) descriptionLines.push(`🌱 Community Need: ${project.communityNeed}`);
  if (project.expectedDeliverables)
    descriptionLines.push(`🎯 Expected Deliverables: ${project.expectedDeliverables}`);
  if (project.skillsNeeded?.length)
    descriptionLines.push(`🛠 Skills Needed: ${project.skillsNeeded.join(', ')}`);

  // Map category to a Google Calendar color ID (1–11)
  const COLOR_MAP: Record<string, string> = {
    // Pillar categories removed



  };

  const repeat = project.isEvent ? getEventRepeatRule(project) : 'Does not repeat';
  const isRecurring = project.isEvent && repeat !== 'Does not repeat';
  const endValue = project.endDate || project.startDate;
  const isAllDay = !project.startDate.includes('T') && !endValue.includes('T');
  const start = toDateTime(project.startDate);
  const end = isRecurring
    ? isAllDay
      ? { date: addDaysToDateOnly(project.startDate.slice(0, 10), 1) }
      : toDateTime(getFirstOccurrenceEndDateTime(project))
    : isAllDay
      ? { date: addDaysToDateOnly(endValue.slice(0, 10), 1) }
      : toDateTime(project.endDate);

  return {
    summary: `[${project.isEvent ? 'Event' : 'Project'}] ${project.title}`,
    description: descriptionLines.join('\n'),
    location: locationParts.join(', ') || undefined,
    start,
    end,
    ...(project.isEvent ? { recurrence: getGoogleRecurrence(project) } : {}),
    colorId: COLOR_MAP[project.category] ?? '1',
  };
}

export function formatAdminPlanningItemAsGoogleEvent(item: AdminPlanningItem): GoogleCalendarEvent {
  const endValue = item.endDate || item.startDate;
  const start = new Date(item.startDate);
  const end = new Date(endValue);
  const isAllDay = !item.startDate.includes('T') && !endValue.includes('T');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
      item.startDate.includes('T') !== endValue.includes('T') ||
      (isAllDay ? end < start : end <= start)) {
    throw new Error('The planning item has no valid start and end schedule.');
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const description = [
    item.description || '',
    ...(item.participantsLabel ? [`Participants: ${item.participantsLabel}`] : []),
    ...(item.linkedProjectId ? [`Linked NVC project: ${item.linkedProjectId}`] : []),
  ].join('\n');
  return {
    summary: `[Planning] ${item.title}`,
    description,
    location: item.location || undefined,
    start: isAllDay ? { date: item.startDate.slice(0, 10) } : { dateTime: item.startDate, timeZone },
    end: isAllDay ? { date: addDaysToDateOnly(endValue.slice(0, 10), 1) } : { dateTime: endValue, timeZone },
  };
}

function getStableGoogleEventId(project: Pick<Project, 'id'>): string {
  const source = `nvc:${project.id}`;
  let hash = 5381;

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) >>> 0;
  }

  return `nvc${hash.toString(16)}${String(project.id || '').length.toString(16)}`.toLowerCase();
}

// ─── Sync Function ────────────────────────────────────────────────────────────

/**
 * Pushes a list of projects/events to the user's primary Google Calendar.
 * Returns a SyncResult with success/failure counts.
 *
 * @param accessToken  - OAuth access token obtained from signInWithGoogle()
 * @param projects     - Array of Project items to push
 */
export async function syncProjectsToGoogleCalendar(
  accessToken: string,
  projects: Project[],
  cleanupOptions?: CalendarCleanupOptions,
): Promise<SyncResult> {
  const result: SyncResult = { success: true, synced: 0, removed: 0, failed: 0, errors: [] };
  const syncItems = [
    ...projects.map(project => ({ id: project.id, title: project.title, project, planningItem: undefined as AdminPlanningItem | undefined })),
    ...(cleanupOptions?.role === 'admin' ? cleanupOptions.planningItems.map(planningItem => ({
      id: `admin-planning:${planningItem.id}`,
      title: planningItem.title,
      project: undefined as Project | undefined,
      planningItem,
    })) : []),
  ];

  for (const item of syncItems) {
    try {
      const event = item.planningItem
        ? formatAdminPlanningItemAsGoogleEvent(item.planningItem)
        : formatProjectAsGoogleEvent(item.project!);
      if (cleanupOptions?.userId) {
        // Explicitly restore previously deleted entries when their stable ID
        // is reused by a later sync (for example, after a volunteer rejoins).
        event.status = 'confirmed';
        event.extendedProperties = {
          ...event.extendedProperties,
          private: {
            ...event.extendedProperties?.private,
            nvcManagedBy: 'nvc-connect',
            nvcSyncRole: cleanupOptions.role,
            nvcSyncUserId: cleanupOptions.userId,
            nvcProjectId: item.id,
            nvcRecordType: item.planningItem ? 'planning' : item.project?.isEvent ? 'event' : 'project',
          },
        };
      }

      const eventId = getStableGoogleEventId(item);
      const response = await fetch(GOOGLE_CALENDAR_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: eventId,
          ...event,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        const msg = body?.error?.message ?? `HTTP ${response.status}`;
        if (response.status === 409) {
          const updateResponse = await fetch(`${GOOGLE_CALENDAR_API}/${encodeURIComponent(eventId)}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
          });

          if (updateResponse.ok) {
            result.synced++;
          } else {
            const updateBody = (await updateResponse.json().catch(() => ({}))) as { error?: { message?: string } };
            result.failed++;
            result.errors.push(`"${item.title}": ${updateBody?.error?.message ?? `HTTP ${updateResponse.status}`}`);
          }
        } else {
          result.failed++;
          result.errors.push(`"${item.title}": ${msg}`);
        }
      } else {
        result.synced++;
      }
    } catch (error: unknown) {
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`"${item.title}": ${message}`);
    }
  }

  if (cleanupOptions?.userId) {
    type StoredCalendarEvent = Partial<GoogleCalendarEvent> & {
      id?: string;
      etag?: string;
      status?: string;
      recurringEventId?: string;
    };
    const retainedRecordIds = new Set([
      ...syncItems.map(item => item.id),
      ...(cleanupOptions.role === 'admin' ? [
        ...cleanupOptions.retainedProjectIds,
        ...cleanupOptions.planningItems.map(item => `admin-planning:${item.id}`),
      ] : []),
    ]);
    const retainedGoogleIds = new Set(Array.from(retainedRecordIds, id => getStableGoogleEventId({ id })));
    const retainedNvcTitles = new Set(
      syncItems.map(item => item.title.trim().toLocaleLowerCase()).filter(Boolean)
    );
    const legacyUnjoinedGoogleIds = new Set(
      cleanupOptions.role === 'volunteer' ? cleanupOptions.unjoinedEventProjects.map(getStableGoogleEventId) : []
    );
    const calendarEvents: StoredCalendarEvent[] = [];
    try {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          maxResults: '2500',
          singleEvents: 'false',
          showDeleted: 'false',
          fields: 'items(id,etag,status,summary,description,recurringEventId,extendedProperties),nextPageToken',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const response = await fetch(`${GOOGLE_CALENDAR_API}?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const body = await response.json() as {
          items?: StoredCalendarEvent[];
          nextPageToken?: string;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(body.error?.message || `HTTP ${response.status}`);
        }
        calendarEvents.push(...(body.items || []));
        pageToken = body.nextPageToken;
      } while (pageToken);
    } catch (error: unknown) {
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Could not check old calendar entries: ${message}`);
      // An incomplete listing must not trigger any deletions.
      calendarEvents.length = 0;
    }

    const checkedEventIds = new Set<string>();
    for (const existingEvent of calendarEvents) {
      const eventId = existingEvent.id;
      if (!eventId || checkedEventIds.has(eventId) || retainedGoogleIds.has(eventId) ||
          existingEvent.status === 'cancelled' || existingEvent.recurringEventId) continue;
      checkedEventIds.add(eventId);
      try {
        const privateProperties = existingEvent.extendedProperties?.private || {};
        const isOwnedStaleEvent =
          privateProperties.nvcManagedBy === 'nvc-connect' &&
          privateProperties.nvcSyncRole === cleanupOptions.role &&
          privateProperties.nvcSyncUserId === cleanupOptions.userId &&
          Boolean(privateProperties.nvcProjectId) &&
          !retainedRecordIds.has(privateProperties.nvcProjectId);
        const isLegacyNvcEvent =
          !Object.keys(privateProperties).some(key => key.startsWith('nvc')) &&
          (/^nvc[0-9a-f]{2,16}$/.test(eventId) || legacyUnjoinedGoogleIds.has(eventId)) &&
          /^\[(Event|Project)\] /.test(String(existingEvent.summary || '')) &&
          /(?:^|\n)📂 Category: [^\n]+/.test(String(existingEvent.description || '')) &&
          /(?:^|\n)📌 Status: [^\n]+/.test(String(existingEvent.description || '')) &&
          /(?:^|\n)👥 Volunteers Needed: \d+(?:\n|$)/.test(String(existingEvent.description || ''));
        const summary = String(existingEvent.summary || '').trim();
        const isLegacyManualNvcCopy =
          !Object.keys(privateProperties).some(key => key.startsWith('nvc')) &&
          !/^\[(?:Event|Project|Planning)\] /.test(summary) &&
          !retainedNvcTitles.has(summary.toLocaleLowerCase()) &&
          /(?:^|\n)Volunteer slots: \d+\s*$/.test(String(existingEvent.description || ''));
        if (!isOwnedStaleEvent && !isLegacyNvcEvent && !isLegacyManualNvcCopy) continue;

        const deleteResponse = await fetch(`${GOOGLE_CALENDAR_API}/${encodeURIComponent(eventId)}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(existingEvent.etag ? { 'If-Match': existingEvent.etag } : {}),
          },
        });
        if (deleteResponse.ok || deleteResponse.status === 404 || deleteResponse.status === 410) {
          result.removed++;
        } else {
          const body = (await deleteResponse.json().catch(() => ({}))) as { error?: { message?: string } };
          result.failed++;
          result.errors.push(`Could not remove old event "${existingEvent.summary || eventId}": ${body?.error?.message ?? `HTTP ${deleteResponse.status}`}`);
        }
      } catch (error: unknown) {
        result.failed++;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Could not remove old event "${existingEvent.summary || eventId}": ${message}`);
      }
    }
  }

  if (result.failed > 0) {
    result.success = false;
  }

  return result;
}

export async function sendGoogleCalendarSyncEmail({
  recipientEmail,
  userName,
  syncedCount,
  role,
  calendarUrl = GOOGLE_CALENDAR_WEB_URL,
}: CalendarSyncEmailPayload): Promise<void> {
  if (!recipientEmail?.trim() || syncedCount <= 0) {
    return;
  }

  const authHeaders = await getApiAuthHeaders();
  await fetch(`${getApiBaseUrl()}/notify/gcal-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      recipient_email: recipientEmail.trim(),
      user_name: userName || 'NVC user',
      synced_count: syncedCount,
      synced_at: new Date().toLocaleString(),
      schedule_type: role,
      calendar_url: calendarUrl,
    }),
  }).catch(error => {
    console.error('Failed to send Google Calendar sync email:', error);
  });
}
