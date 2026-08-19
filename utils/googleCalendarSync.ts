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
import { Project } from '../models/types';
import { getApiBaseUrl } from '../models/storage';

// Required so the auth session redirect works correctly on mobile
WebBrowser.maybeCompleteAuthSession();

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Your Google Cloud OAuth 2.0 Client ID.
 * Replace this with the one from your Google Cloud Console credentials page.
 */
export const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ||
  '761439905958-24ag4ap26ec46m9va2lakpprat6p5gd6.apps.googleusercontent.com';

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
  colorId?: string;
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

export type CalendarSyncRole = 'volunteer' | 'partner';

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
export function getGoogleAuthConfig(loginHint?: string) {
  const discovery = {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  };

  const redirectUri = AuthSession.makeRedirectUri();

  const request: AuthSession.AuthRequestConfig = {
    clientId: GOOGLE_CLIENT_ID,
    redirectUri,
    scopes: GOOGLE_SCOPES,
    responseType: AuthSession.ResponseType.Token,
    usePKCE: false,
    extraParams: {
      access_type: 'online',
      prompt: 'select_account',
      ...(loginHint?.trim() ? { login_hint: loginHint.trim() } : {}),
    },
  };

  return { discovery, request, redirectUri };
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
    Education: '1',   // Lavender/Blue
    Livelihood: '2',  // Sage/Green
    Nutrition: '6',   // Tangerine/Orange
    Disaster: '11',   // Tomato/Red
  };

  return {
    summary: `[${project.isEvent ? 'Event' : 'Project'}] ${project.title}`,
    description: descriptionLines.join('\n'),
    location: locationParts.join(', ') || undefined,
    start: toDateTime(project.startDate),
    end: toDateTime(project.endDate),
    colorId: COLOR_MAP[project.category] ?? '1',
  };
}

function getStableGoogleEventId(project: Project): string {
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
  projects: Project[]
): Promise<SyncResult> {
  const result: SyncResult = { success: true, synced: 0, failed: 0, errors: [] };

  for (const project of projects) {
    try {
      const event = formatProjectAsGoogleEvent(project);

      const eventId = getStableGoogleEventId(project);
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
            result.errors.push(`"${project.title}": ${updateBody?.error?.message ?? `HTTP ${updateResponse.status}`}`);
          }
        } else {
          result.failed++;
          result.errors.push(`"${project.title}": ${msg}`);
        }
      } else {
        result.synced++;
      }
    } catch (error: unknown) {
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`"${project.title}": ${message}`);
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

  await fetch(`${getApiBaseUrl()}/notify/gcal-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

// ─── Token Validation ─────────────────────────────────────────────────────────

/**
 * Quick check to verify an access token is still valid by calling the
 * Google tokeninfo endpoint. Returns true if valid, false otherwise.
 */
export async function validateGoogleToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    return response.ok;
  } catch {
    return false;
  }
}
