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
