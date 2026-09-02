"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectDisplayStatus = getProjectDisplayStatus;
exports.getProjectStatusColor = getProjectStatusColor;
function normalizeProjectStatusValue(status) {
    const normalizedStatus = String(status || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    switch (normalizedStatus) {
        case 'planning':
        case 'planned':
            return 'Planning';
        case 'in progress':
        case 'ongoing':
        case 'active':
            return 'In Progress';
        case 'on hold':
            return 'On Hold';
        case 'completed':
            return 'Completed';
        case 'cancelled':
            return 'Cancelled';
        default:
            return 'Planning';
    }
}
function getComparableDate(value, endOfDay = false) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    }
    else {
        date.setHours(0, 0, 0, 0);
    }
    return date;
}
function getProjectDisplayStatus(projectOrStatus, now = new Date()) {
    if (!projectOrStatus) {
        return normalizeProjectStatusValue(null);
    }
    if (typeof projectOrStatus === 'string') {
        return normalizeProjectStatusValue(projectOrStatus);
    }
    const normalizedStatus = normalizeProjectStatusValue(projectOrStatus.status);
    const normalizedManualStatus = projectOrStatus.manualStatus
        ? normalizeProjectStatusValue(projectOrStatus.manualStatus)
        : null;
    const normalizedStatusMode = String(projectOrStatus.statusMode || '')
        .trim()
        .toLowerCase();
    // Explicit manual overrides always win.
    if (normalizedStatusMode === 'manual' && normalizedManualStatus) {
        return normalizedManualStatus;
    }
    // Backward-compatibility: legacy records used `status` directly for paused/cancelled states.
    if (!projectOrStatus.statusMode && (normalizedStatus === 'Cancelled' || normalizedStatus === 'On Hold')) {
        return normalizedStatus;
    }
    const startDate = getComparableDate(projectOrStatus.startDate);
    const endDate = getComparableDate(projectOrStatus.endDate || projectOrStatus.startDate, true);
    if (!startDate || !endDate) {
        return normalizedManualStatus || normalizedStatus;
    }
    if (now < startDate) {
        return 'Planning';
    }
    if (now > endDate) {
        return 'Completed';
    }
    return 'In Progress';
}
// Maps project lifecycle states to the colors used across the UI.
function getProjectStatusColor(projectOrStatus) {
    const normalizedStatus = getProjectDisplayStatus(projectOrStatus);
    switch (normalizedStatus) {
        case 'Planning':
            return '#2563EB';
        case 'In Progress':
            return '#0F766E';
        case 'On Hold':
            return '#D97706';
        case 'Completed':
            return '#16A34A';
        case 'Cancelled':
            return '#DC2626';
        default:
            return '#2563EB';
    }
}
