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

// Returns the attendance window key. Each window starts at the event's saved
// start time and runs until that same time on the following day.
export function getAttendanceWindowKey(startValue?: string, value?: string): string {
  const target = value ? new Date(value) : new Date();
  if (Number.isNaN(target.getTime())) {
    return '';
  }

  const eventStart = getValidDate(startValue);
  if (!eventStart) {
    return getLocalDateKey(target);
  }

  const windowStart = new Date(target);
  windowStart.setHours(
    eventStart.getHours(),
    eventStart.getMinutes(),
    eventStart.getSeconds(),
    eventStart.getMilliseconds()
  );

  if (target < windowStart) {
    windowStart.setDate(windowStart.getDate() - 1);
  }

  return getLocalDateKey(windowStart);
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

// Keeps the existing 15-minute grace period, but applies it to each daily
// attendance window instead of comparing every day with the first event day.
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
    windowStart.setDate(windowStart.getDate() - 1);
  }

  return logTime.getTime() > windowStart.getTime() + 15 * 60000;
}
