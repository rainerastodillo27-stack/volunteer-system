import type { VolunteerTimeLog } from '../models/types';

export interface AttendanceReportMetrics {
  /** A time-log represents one recorded attendance day. */
  attendanceDays: number;
  /** Hours are only counted after a valid time-out is recorded. */
  attendanceHours: number;
  /** Attendance is verified only after a field officer checks the log. */
  verifiedAttendance: number;
}

function getValidTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Builds the key metrics displayed and exported for one attendance evidence
 * record.  The values are derived from the canonical time-log rather than
 * guessed from a photo or report title.
 */
export function getAttendanceReportMetrics(
  timeLog: VolunteerTimeLog,
): AttendanceReportMetrics {
  const timeIn = getValidTimestamp(timeLog.timeIn);
  const timeOut = getValidTimestamp(timeLog.timeOut);
  const hasRecordedAttendance = timeIn !== null;
  const elapsedHours =
    timeIn !== null && timeOut !== null && timeOut >= timeIn
      ? (timeOut - timeIn) / (60 * 60 * 1000)
      : 0;

  return {
    attendanceDays: hasRecordedAttendance ? 1 : 0,
    attendanceHours: Math.round(elapsedHours * 100) / 100,
    verifiedAttendance: hasRecordedAttendance && timeLog.attendanceCheckedAt ? 1 : 0,
  };
}
