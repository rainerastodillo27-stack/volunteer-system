import { Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Project } from '../models/types';

export interface CalendarConfig {
  calendarId: string;
  apiKey: string;
}

const STORAGE_KEY_GCAL_ID = 'gcal_id';
const STORAGE_KEY_GCAL_KEY = 'gcal_key';

const DEFAULT_CALENDAR_ID = 'en.philippines#holiday@group.v.calendar.google.com';

/**
 * Reads Google Calendar settings from AsyncStorage or fallback defaults.
 */
export async function getStoredCalendarConfig(): Promise<CalendarConfig> {
  try {
    const storedId = await AsyncStorage.getItem(STORAGE_KEY_GCAL_ID);
    const storedKey = await AsyncStorage.getItem(STORAGE_KEY_GCAL_KEY);
    const defaultApiKey =
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ||
      process.env.GOOGLE_MAPS_WEB_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';

    return {
      calendarId: storedId || DEFAULT_CALENDAR_ID,
      apiKey: storedKey || defaultApiKey,
    };
  } catch (err) {
    console.error('Failed to read stored calendar config:', err);
    return {
      calendarId: DEFAULT_CALENDAR_ID,
      apiKey: '',
    };
  }
}

/**
 * Saves Google Calendar settings to AsyncStorage.
 */
export async function saveStoredCalendarConfig(calendarId: string, apiKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_GCAL_ID, calendarId.trim());
    await AsyncStorage.setItem(STORAGE_KEY_GCAL_KEY, apiKey.trim());
  } catch (err) {
    console.error('Failed to save calendar config:', err);
    throw err;
  }
}

/**
 * Formats a Date object or date string into UTC YYYYMMDDTHHmmssZ format for Google Calendar URLs.
 */
function formatGoogleCalendarDate(dateInput?: string | Date | null): string {
  if (!dateInput) {
    const now = new Date();
    return now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  const dateObj = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(dateObj.getTime())) {
    const now = new Date();
    return now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  return dateObj.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Opens Google Calendar web interface with pre-filled event details.
 * Allows volunteers and partners to add any project or event to their personal Google Calendar in one click.
 */
export async function openAddGoogleCalendarEvent({
  title,
  details = '',
  location = '',
  startDate,
  endDate,
}: {
  title: string;
  details?: string;
  location?: string;
  startDate?: string | Date;
  endDate?: string | Date;
}): Promise<void> {
  const startStr = formatGoogleCalendarDate(startDate);
  const endStr = formatGoogleCalendarDate(endDate || (startDate ? new Date(new Date(startDate).getTime() + 2 * 3600 * 1000) : null));

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    title
  )}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}&dates=${startStr}/${endStr}`;

  try {
    await Linking.openURL(url);
  } catch (err) {
    console.error('Failed to open Google Calendar template link:', err);
  }
}

/**
 * Syncs user's schedule of joined/proposed events directly to Google Calendar.
 */
export async function syncUserScheduleToGoogleCalendar(
  projects: Project[],
  roleLabel: 'volunteer' | 'partner' = 'volunteer'
): Promise<void> {
  if (!projects || projects.length === 0) {
    Alert.alert(
      'No Schedule to Sync',
      roleLabel === 'volunteer'
        ? 'You have not joined any project events yet. Join an event first to sync your schedule!'
        : 'You have no project proposals yet. Submit a proposal first to sync your schedule!'
    );
    return;
  }

  // Pick the upcoming or first project event
  const targetProject = projects[0];
  const locationText = typeof targetProject.location === 'string' ? targetProject.location : targetProject.location?.address || '';

  await openAddGoogleCalendarEvent({
    title: targetProject.title,
    details: `${roleLabel === 'volunteer' ? 'NVC Volunteer Event' : 'NVC Partner Project'}: ${targetProject.description || targetProject.title}`,
    location: locationText,
    startDate: targetProject.startDate,
    endDate: targetProject.endDate,
  });
}

/**
 * Fetches events from Google Calendar API v3 safely with error handling.
 */
export async function fetchGoogleCalendarEvents(
  calendarId: string,
  apiKey: string,
  timeMin: string,
  timeMax: string
): Promise<{ items: any[]; error?: string }> {
  if (!calendarId || !apiKey) {
    return { items: [], error: 'Google Calendar API Key or Calendar ID is not configured.' };
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId
  )}/events?key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error?.message || `Google Calendar API returned status ${res.status}`;
      return { items: [], error: msg };
    }
    const data = await res.json();
    return { items: data.items || [] };
  } catch (err: any) {
    return { items: [], error: err?.message || 'Network error fetching Google Calendar events.' };
  }
}
