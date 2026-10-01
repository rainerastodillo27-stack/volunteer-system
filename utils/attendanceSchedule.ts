function getLocalDateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function getValidDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type EventRepeat = 'Does not repeat' | 'Daily' | 'Weekly' | 'Monthly';

export type RecurringEvent = {
  isEvent?: boolean;
  startDate?: string;
  endDate?: string;
  repeat?: string;
  repeatRule?: string;
  repeat_rule?: string;
};

export function normalizeEventRepeat(value?: string): EventRepeat {
  switch (String(value || '').trim().toLowerCase()) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    default:
      return 'Does not repeat';
  }
}

export function getEventRepeatRule(event: RecurringEvent): EventRepeat {
  return normalizeEventRepeat(event.repeat || event.repeatRule || event.repeat_rule);
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Returns whether an event has a scheduled occurrence on the supplied local
 * calendar date. The event's end date is the series end date for recurring
 * events, matching the backend reminder scheduler.
 */
export function isEventOccurrenceToday(
  event: RecurringEvent,
  now: Date = new Date(),
): boolean {
  if (!event.isEvent) {
    return true;
  }

  const start = getValidDate(event.startDate);
  if (!start) {
    return true;
  }

  const end = getValidDate(event.endDate) || start;
  const todayKey = getLocalDateKey(now);
  const startKey = getLocalDateKey(start);
  const endKey = getLocalDateKey(end < start ? start : end);

  if (!todayKey || todayKey < startKey || todayKey > endKey) {
    return false;
  }

  const repeat = getEventRepeatRule(event);
  if (repeat === 'Does not repeat') {
    return todayKey === startKey;
  }

  if (repeat === 'Daily') {
    return true;
  }

  if (repeat === 'Weekly') {
    return now.getDay() === start.getDay();
  }

  const scheduledDay = Math.min(
    start.getDate(),
    getDaysInMonth(now.getFullYear(), now.getMonth()),
  );
  return now.getDate() === scheduledDay;
}

/** Returns the local calendar dates on which attendance is scheduled. */
export function getScheduledAttendanceDateKeys(event: RecurringEvent): string[] {
  const start = getValidDate(event.startDate);
  if (!start) {
    return [];
  }

  const end = getValidDate(event.endDate) || start;
  const candidate = new Date(start);
  candidate.setHours(12, 0, 0, 0);
  const finalDate = new Date(end < start ? start : end);
  finalDate.setHours(12, 0, 0, 0);

  const dateKeys: string[] = [];
  for (let guard = 0; candidate <= finalDate && guard < 3660; guard += 1) {
    if (!event.isEvent || isEventOccurrenceToday(event, candidate)) {
      dateKeys.push(getLocalDateKey(candidate));
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  return dateKeys;
}

/** Returns the next scheduled occurrence on or after the supplied date. */
export function getNextEventOccurrenceDate(
  event: RecurringEvent,
  now: Date = new Date(),
): Date | null {
  if (!event.isEvent) {
    return null;
  }

  const start = getValidDate(event.startDate);
  if (!start) {
    return null;
  }

  const end = getValidDate(event.endDate) || start;
  const finalDate = new Date(end < start ? start : end);
  finalDate.setHours(23, 59, 59, 999);

  const candidate = new Date(now);
  candidate.setHours(12, 0, 0, 0);
  const startDate = new Date(start);
  startDate.setHours(12, 0, 0, 0);
  if (candidate < startDate) {
    candidate.setTime(startDate.getTime());
  }

  for (let guard = 0; guard < 10000 && candidate <= finalDate; guard += 1) {
    if (isEventOccurrenceToday(event, candidate)) {
      return new Date(candidate);
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  return null;
}

export function formatEventOccurrenceDate(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    return '';
  }

  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Returns the calendar date used by the attendance picker and backend. The
// event start value is retained for call-site compatibility, but attendance
// records are reported on the local date when they were confirmed.
export function getAttendanceWindowKey(startValue?: string, value?: string): string {
  void startValue;
  const target = value ? new Date(value) : new Date();
  if (Number.isNaN(target.getTime())) {
    return '';
  }

  return getLocalDateKey(target);
}

// Attendance opens at the event's saved start time on each event day.
export function hasEventStartedForToday(startValue?: string, now: Date = new Date()): boolean {
  const eventStart = getValidDate(startValue);
  if (!eventStart) {
    return true;
  }

  if (now < eventStart) {
    return false;
  }

  const todayStart = new Date(now);
  todayStart.setHours(
    eventStart.getHours(),
    eventStart.getMinutes(),
    eventStart.getSeconds(),
    eventStart.getMilliseconds()
  );

  return now >= todayStart;
}

// Keeps the existing 15-minute grace period and applies it to the event's
// configured start time on the same local calendar day.
export function isEventAttendanceLate(startValue?: string, timeIn?: string): boolean {
  const eventStart = getValidDate(startValue);
  const logTime = getValidDate(timeIn);
  if (!eventStart || !logTime || logTime < eventStart) {
    return false;
  }

  const windowStart = new Date(logTime);
  windowStart.setHours(
    eventStart.getHours(),
    eventStart.getMinutes(),
    eventStart.getSeconds(),
    eventStart.getMilliseconds()
  );

  if (logTime < windowStart) {
    return false;
  }

  return logTime.getTime() > windowStart.getTime() + 15 * 60000;
}
