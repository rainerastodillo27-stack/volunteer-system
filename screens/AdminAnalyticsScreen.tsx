import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Modal,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  getAllPartnerReports,
  getAllProjects,
  getAllProgramTracks,
  getAllVolunteers,
  getAllVolunteerProjectJoinRecords,
  getAllVolunteerTimeLogs,
  getAllPartners,
  getAllPartnerProjectApplications,
  subscribeToStorageChanges,
} from '../models/storage';
import type { Partner, PartnerProjectApplication, PartnerReport, ProgramTrack, Project, Volunteer, VolunteerProjectJoinRecord, VolunteerTimeLog } from '../models/types';
import ModernTheme from '../utils/modernTheme';
import { navigateToAvailableRoute } from '../utils/navigation';

type MonthPoint = {
  key: string;
  label: string;
  value: number;
  names: string[];
};

type WeekBucket = {
  key: string;
  label: string;
  subLabel: string;
  start: Date;
  end: Date;
};

type HeatmapCell = {
  value: number;
  names: string[];
};

type HeatmapRow = {
  id: string;
  title: string;
  joined: number;
  cells: HeatmapCell[];
};

type SkillSlice = {
  name: string;
  count: number;
  percent: number;
  color: string;
};

const SKILL_COLORS = [
  '#243f1f',
  '#477f39',
  '#6f9a38',
  '#8db653',
  '#9fc76f',
  '#37682b',
  '#4f988c',
  '#d9e44f',
];

const HEAT_COLORS = ['#eef2f7', '#c9d9bf', '#a7c082', '#ba8f72', '#9d6f55'];

function safeDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReportMetrics(report: PartnerReport): Record<string, unknown> {
  const rawMetrics = report.metrics as unknown;
  if (rawMetrics && typeof rawMetrics === 'object') {
    return rawMetrics as Record<string, unknown>;
  }

  if (typeof rawMetrics === 'string') {
    try {
      const parsed = JSON.parse(rawMetrics);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function parseBeneficiariesFromNarrative(description: string | undefined): number | undefined {
  const match = String(description || '').match(
    /\bbeneficiaries\s+(?:reached|served|assisted)\s*:\s*(\d+(?:\.\d+)?)/i
  );
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function getReportBeneficiariesServed(report: PartnerReport): number {
  const metrics = getReportMetrics(report);
  const beneficiaryKeys = [
    'beneficiariesServed',
    'beneficiaries_served',
    'beneficiaries',
    'beneficiariesAssisted',
    'beneficiaries_assisted',
    'beneficiariesReached',
    'beneficiaries_reached',
  ];

  for (const key of beneficiaryKeys) {
    const value = Number(metrics[key]);
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  const narrativeValue = parseBeneficiariesFromNarrative(report.description);
  if (narrativeValue !== undefined) {
    return narrativeValue;
  }

  const impactCount = Number(report.impactCount);
  return Number.isFinite(impactCount) && impactCount >= 0 ? impactCount : 0;
}

function hasExplicitBeneficiaryMetric(report: PartnerReport): boolean {
  const metrics = getReportMetrics(report);
  return [
    'beneficiariesServed',
    'beneficiaries_served',
    'beneficiaries',
    'beneficiariesAssisted',
    'beneficiaries_assisted',
    'beneficiariesReached',
    'beneficiaries_reached',
  ].some(key => {
    const value = Number(metrics[key]);
    return Number.isFinite(value) && value >= 0;
  }) || parseBeneficiariesFromNarrative(report.description) !== undefined;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short' });
}

function formatWeekSubLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase();
}

function getVolunteerIdForLog(log: VolunteerTimeLog, volunteersById: Map<string, Volunteer>): string {
  return volunteersById.has(log.volunteerId) ? log.volunteerId : log.volunteerId;
}

function getEventVolunteerIds(
  event: Project,
  timeLogs: VolunteerTimeLog[],
  joinRecords: VolunteerProjectJoinRecord[],
  volunteersById: Map<string, Volunteer>,
  volunteersByUserId: Map<string, Volunteer>
): Set<string> {
  const ids = new Set<string>();

  (event.volunteers || []).forEach(id => {
    if (id) {
      ids.add(id);
    }
  });

  (event.joinedUserIds || []).forEach(userId => {
    const volunteer = volunteersByUserId.get(userId);
    if (volunteer?.id) {
      ids.add(volunteer.id);
    }
  });

  joinRecords
    .filter(record => record.projectId === event.id)
    .forEach(record => {
      if (record.volunteerId) {
        ids.add(record.volunteerId);
      } else if (record.volunteerUserId) {
        const volunteer = volunteersByUserId.get(record.volunteerUserId);
        if (volunteer?.id) {
          ids.add(volunteer.id);
        }
      }
    });

  timeLogs
    .filter(log => log.projectId === event.id)
    .forEach(log => ids.add(getVolunteerIdForLog(log, volunteersById)));

  return ids;
}

function getProjectVolunteerIdsIncludingEvents(
  project: Project,
  allProjects: Project[],
  timeLogs: VolunteerTimeLog[],
  joinRecords: VolunteerProjectJoinRecord[],
  volunteers: Volunteer[]
): Set<string> {
  const volunteersById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
  const volunteersByUserId = new Map(
    volunteers
      .map(volunteer => [String(volunteer.userId || '').trim(), volunteer] as const)
      .filter(([userId]) => Boolean(userId))
  );
  const relatedProjects = project.isEvent
    ? [project]
    : allProjects.filter(candidate =>
        candidate.id === project.id ||
        (candidate.isEvent && candidate.parentProjectId === project.id)
      );
  const ids = new Set<string>();

  relatedProjects.forEach(relatedProject => {
    getEventVolunteerIds(
      relatedProject,
      timeLogs,
      joinRecords,
      volunteersById,
      volunteersByUserId
    ).forEach(id => ids.add(id));
  });

  return ids;
}

function formatEventTitle(title: string): string {
  if (title.length <= 24) {
    return title;
  }

  return `${title.slice(0, 21)}...`;
}

function getHeatColor(value: number, maxValue: number): string {
  if (value <= 0 || maxValue <= 0) {
    return HEAT_COLORS[0];
  }

  const index = Math.min(HEAT_COLORS.length - 1, Math.ceil((value / maxValue) * (HEAT_COLORS.length - 1)));
  return HEAT_COLORS[index];
}

function buildMonthPoints(volunteers: Volunteer[]): MonthPoint[] {
  const now = startOfMonth(new Date());
  const firstMonth = addMonths(now, -11);
  const sortedVolunteers = [...volunteers]
    .map(volunteer => ({
      createdAt: safeDate(volunteer.createdAt),
      name: volunteer.name || volunteer.email || 'Unknown volunteer',
    }))
    .filter(item => item.createdAt !== null)
    .sort((left, right) => left.createdAt!.getTime() - right.createdAt!.getTime()) as { createdAt: Date; name: string }[];

  return Array.from({ length: 12 }).map((_, index) => {
    const monthStart = addMonths(firstMonth, index);
    const monthEnd = addMonths(monthStart, 1);
    const names = sortedVolunteers
      .filter(item => item.createdAt < monthEnd)
      .map(item => item.name)
      .sort((left, right) => left.localeCompare(right));

    return {
      key: `${monthStart.getFullYear()}-${monthStart.getMonth()}`,
      label: formatMonthLabel(monthStart),
      value: names.length,
      names,
    };
  });
}

function buildWeekBuckets(): WeekBucket[] {
  const currentWeek = startOfWeek(new Date());
  const firstWeek = new Date(currentWeek);
  firstWeek.setDate(firstWeek.getDate() - 9 * 7);

  return Array.from({ length: 10 }).map((_, index) => {
    const start = new Date(firstWeek);
    start.setDate(firstWeek.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    return {
      key: start.toISOString(),
      label: `W${index + 1}`,
      subLabel: formatWeekSubLabel(start),
      start,
      end,
    };
  });
}

function buildHeatmapRows(
  projects: Project[],
  timeLogs: VolunteerTimeLog[],
  joinRecords: VolunteerProjectJoinRecord[],
  volunteers: Volunteer[],
  weeks: WeekBucket[]
): HeatmapRow[] {
  const events = projects.filter(project => project.isEvent);
  const volunteersById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
  const volunteersByUserId = new Map(volunteers.map(volunteer => [volunteer.userId, volunteer]));

  return events
    .map(event => {
      const joinedIds = getEventVolunteerIds(event, timeLogs, joinRecords, volunteersById, volunteersByUserId);
      const cells = weeks.map(week => {
        const weeklyVolunteerIds = new Set<string>();
        timeLogs
          .filter(log => log.projectId === event.id)
          .forEach(log => {
            const timeIn = safeDate(log.timeIn);
            if (timeIn && timeIn >= week.start && timeIn < week.end) {
              weeklyVolunteerIds.add(getVolunteerIdForLog(log, volunteersById));
            }
          });

        joinRecords
          .filter(record => record.projectId === event.id)
          .forEach(record => {
            const joinedAt = safeDate(record.joinedAt);
            if (joinedAt && joinedAt >= week.start && joinedAt < week.end) {
              if (record.volunteerId) {
                weeklyVolunteerIds.add(record.volunteerId);
              } else if (record.volunteerUserId) {
                const volunteer = volunteersByUserId.get(record.volunteerUserId);
                if (volunteer?.id) {
                  weeklyVolunteerIds.add(volunteer.id);
                }
              }
            }
          });

        const names = Array.from(weeklyVolunteerIds)
          .map(volunteerId => volunteersById.get(volunteerId)?.name || volunteerId)
          .sort((a, b) => a.localeCompare(b));

        return {
          value: weeklyVolunteerIds.size,
          names,
        };
      });

      return {
        id: event.id,
        title: event.title || 'Untitled event',
        joined: joinedIds.size,
        cells,
      };
    })
    .filter(row => row.joined > 0 || row.cells.some(cell => cell.value > 0))
    .sort((left, right) => {
      const rightTotal = right.cells.reduce((sum, cell) => sum + cell.value, 0);
      const leftTotal = left.cells.reduce((sum, cell) => sum + cell.value, 0);
      return rightTotal - leftTotal || right.joined - left.joined || left.title.localeCompare(right.title);
    })
    .slice(0, 6);
}

function buildSkillSlices(
  volunteers: Volunteer[],
  projects: Project[],
  timeLogs: VolunteerTimeLog[],
  joinRecords: VolunteerProjectJoinRecord[]
): { slices: SkillSlice[]; volunteerCount: number; contributionCount: number } {
  const events = projects.filter(project => project.isEvent);
  const volunteersById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
  const volunteersByUserId = new Map(volunteers.map(volunteer => [volunteer.userId, volunteer]));
  const joinedVolunteerIds = new Set<string>();

  events.forEach(event => {
    getEventVolunteerIds(event, timeLogs, joinRecords, volunteersById, volunteersByUserId).forEach(id => joinedVolunteerIds.add(id));
  });

  // Always include all volunteers' skills, not just those in events
  const skillCounts = new Map<string, number>();

  volunteers.forEach(volunteer => {
    (volunteer.skills || [])
      .map(normalizeSkill)
      .filter(Boolean)
      .forEach(skill => {
        skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
      });
  });

  const sortedSkills = Array.from(skillCounts.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  );
  const topSkills = sortedSkills.slice(0, 7);
  const otherCount = sortedSkills.slice(7).reduce((sum, [, count]) => sum + count, 0);
  const visibleSkills = otherCount > 0 ? [...topSkills, [`Other (${sortedSkills.length - 7})`, otherCount] as [string, number]] : topSkills;
  const contributionCount = visibleSkills.reduce((sum, [, count]) => sum + count, 0);

  return {
    slices: visibleSkills.map(([name, count], index) => ({
      name,
      count,
      percent: contributionCount > 0 ? Math.round((count / contributionCount) * 100) : 0,
      color: SKILL_COLORS[index % SKILL_COLORS.length],
    })),
    volunteerCount: volunteers.length,
    contributionCount,
  };
}

function buildDonutGradient(slices: SkillSlice[]): string {
  if (slices.length === 0) {
    return 'conic-gradient(#dfe8d6 0deg 360deg)';
  }

  let cursor = 0;
  const segments = slices.map(slice => {
    const degrees = (slice.percent / 100) * 360;
    const start = cursor;
    const end = cursor + degrees;
    cursor = end;
    return `${slice.color} ${start}deg ${end}deg`;
  });

  if (cursor < 360) {
    segments.push(`${slices[slices.length - 1].color} ${cursor}deg 360deg`);
  }

  return `conic-gradient(${segments.join(', ')})`;
}

function getCompletedVolunteerHours(log: VolunteerTimeLog): number {
  const start = safeDate(log.timeIn);
  const end = safeDate(log.timeOut);
  if (!start || !end || end <= start) {
    return 0;
  }

  return (end.getTime() - start.getTime()) / 3_600_000;
}

function isTopLevelProgramRecord(project: Project, programTracks: ProgramTrack[]): boolean {
  const projectId = String(project.id || '').trim().toLowerCase();
  const projectTitle = String(project.title || '').trim().toLowerCase();

  return programTracks.some(track => {
    const trackId = String(track.id || '').trim().toLowerCase();
    const trackTitle = String(track.title || '').trim().toLowerCase();

    return Boolean(
      (trackId && projectId === trackId) ||
      (trackTitle && projectTitle === trackTitle)
    );
  });
}

type PartnerSectorData = {
  quarter: string;
  NGO: number;
  Hospital: number;
  Institution: number;
  Private: number;
};

function buildPartnerSectorsByQuarter(partners: Partner[]): PartnerSectorData[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  
  // Generate last 4 quarters including current
  const quarters: Array<{label: string; year: number; quarter: number}> = [];
  for (let i = 3; i >= 0; i--) {
    let q = currentQuarter - i;
    let y = currentYear;
    if (q <= 0) {
      q += 4;
      y -= 1;
    }
    quarters.push({ label: `Q${q} ${y}`, year: y, quarter: q });
  }
  
  return quarters.map(({ label, year, quarter }) => {
    const quarterStart = new Date(year, (quarter - 1) * 3, 1);
    const quarterEnd = new Date(year, quarter * 3, 0, 23, 59, 59);
    
    const counts = { NGO: 0, Hospital: 0, Institution: 0, Private: 0 };
    
    partners.forEach(partner => {
      const createdAt = safeDate(partner.createdAt);
      if (!createdAt || createdAt < quarterStart || createdAt > quarterEnd) return;
      
      const sector = partner.sectorType || 'Private';
      if (sector === 'NGO') counts.NGO++;
      else if (sector === 'Hospital') counts.Hospital++;
      else if (sector === 'Institution') counts.Institution++;
      else counts.Private++;
    });
    
    return {
      quarter: label,
      NGO: counts.NGO,
      Hospital: counts.Hospital,
      Institution: counts.Institution,
      Private: counts.Private,
    };
  });
}

// Generate HTML report for PDF export
function generatePDFReportHTML(
  sections: string[],
  data: {
    volunteers: Volunteer[];
    projects: Project[];
    partners: Partner[];
    reports: PartnerReport[];
    timeLogs: VolunteerTimeLog[];
    joinRecords: VolunteerProjectJoinRecord[];
    applications: PartnerProjectApplication[];
  },
  analytics: {
    partnerFilter: string | 'all';
    programFilter: string | 'all';
    metrics: any;
    volunteerGrowthData: any[];
    skillAnalytics: any;
    quarterlyPartnerData: any[];
  }
): string {
  const reportDate = new Date().toLocaleString();
  const filterInfo = `Partner: ${analytics.partnerFilter === 'all' ? 'All Partners' : data.partners.find(p => p.id === analytics.partnerFilter)?.name || 'Unknown'}, Program: ${analytics.programFilter === 'all' ? 'All Programs' : analytics.programFilter}`;

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>NVC Analytics Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; background: #f8f9fa; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #16a34a; padding-bottom: 20px; }
    .header h1 { color: #16a34a; font-size: 32px; margin-bottom: 8px; }
    .header .subtitle { color: #666; font-size: 14px; }
    .meta { background: #f0fdf4; padding: 16px; border-radius: 8px; margin-bottom: 32px; }
    .meta p { margin: 4px 0; font-size: 14px; }
    .section { margin-bottom: 40px; page-break-inside: avoid; }
    .section h2 { color: #16a34a; font-size: 24px; margin-bottom: 16px; border-bottom: 2px solid #dcfce7; padding-bottom: 8px; }
    .section h3 { color: #333; font-size: 18px; margin: 16px 0 8px; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 20px 0; }
    .metric-card { background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #16a34a; }
    .metric-card .label { color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-card .value { color: #16a34a; font-size: 28px; font-weight: bold; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    table th { background: #16a34a; color: white; padding: 12px; text-align: left; font-size: 14px; }
    table td { padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    table tr:nth-child(even) { background: #f9fafb; }
    .list-item { padding: 12px; background: #f9fafb; margin: 8px 0; border-radius: 6px; border-left: 3px solid #16a34a; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #666; font-size: 12px; }
    @media print {
      body { padding: 0; background: white; }
      .container { box-shadow: none; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Nasugbu Volunteer Center Analytics Report</h1>
      <p class="subtitle">Comprehensive Program Performance & Impact Analysis</p>
    </div>
    
    <div class="meta">
      <p><strong>Generated:</strong> ${reportDate}</p>
      <p><strong>Filters:</strong> ${filterInfo}</p>
      <p><strong>Sections Included:</strong> ${sections.join(', ')}</p>
    </div>
`;

  // Section 1: Volunteers
  if (sections.includes('volunteers')) {
    const totalVolunteers = data.volunteers.length;
    const activeVolunteers = data.volunteers.filter(v => v.registrationStatus === 'Approved').length;
    
    html += `
    <div class="section">
      <h2>1. Total Volunteers Growth</h2>
      <div class="metric-grid">
        <div class="metric-card">
          <div class="label">Total Registered</div>
          <div class="value">${totalVolunteers}</div>
        </div>
        <div class="metric-card">
          <div class="label">Active Volunteers</div>
          <div class="value">${activeVolunteers}</div>
        </div>
        <div class="metric-card">
          <div class="label">Completion Rate</div>
          <div class="value">${analytics.metrics?.completionPercentage || 0}%</div>
        </div>
      </div>
      
      <h3>12-Month Growth Trend</h3>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>Cumulative Volunteers</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.volunteerGrowthData.slice(-12).map(point => `
            <tr>
              <td>${point.label}</td>
              <td>${point.value}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
`;
  }

  // Section 2: Events
  if (sections.includes('events')) {
    const events = data.projects.filter(p => p.isEvent);
    
    html += `
    <div class="section">
      <h2>2. Volunteers Per Event</h2>
      <p style="margin-bottom: 16px; color: #666;">Total Events: <strong>${events.length}</strong></p>
      
      ${events.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Event Title</th>
              <th>Date</th>
              <th>Volunteer Count</th>
            </tr>
          </thead>
          <tbody>
            ${events.map(event => {
              const volunteerCount = (event.volunteers || []).length;
              return `
                <tr>
                  <td>${event.title || 'Untitled Event'}</td>
                  <td>${event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBD'}</td>
                  <td>${volunteerCount}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      ` : '<p>No events found.</p>'}
    </div>
`;
  }

  // Section 3: Skills
  if (sections.includes('skills')) {
    const topSkills = analytics.skillAnalytics?.slices?.slice(0, 10) || [];
    
    html += `
    <div class="section">
      <h2>3. Skills Contributed</h2>
      <p style="margin-bottom: 16px; color: #666;">Total Unique Skills: <strong>${analytics.skillAnalytics?.slices?.length || 0}</strong></p>
      
      <h3>Top 10 Skills</h3>
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Volunteer Count</th>
            <th>Percentage</th>
          </tr>
        </thead>
        <tbody>
          ${topSkills.map((skill: SkillSlice) => `
            <tr>
              <td>${skill.name}</td>
              <td>${skill.count}</td>
              <td>${skill.percent}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
`;
  }

  // Section 4: Partners
  if (sections.includes('partners')) {
    html += `
    <div class="section">
      <h2>4. Partner Sectors by Quarter</h2>
      <table>
        <thead>
          <tr>
            <th>Quarter</th>
            <th>NGO</th>
            <th>Hospital</th>
            <th>Institution</th>
            <th>Private</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.quarterlyPartnerData.map(q => {
            const total = q.NGO + q.Hospital + q.Institution + q.Private;
            return `
              <tr>
                <td>${q.quarter}</td>
                <td>${q.NGO}</td>
                <td>${q.Hospital}</td>
                <td>${q.Institution}</td>
                <td>${q.Private}</td>
                <td><strong>${total}</strong></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      
      <h3>All Partners</h3>
      <table>
        <thead>
          <tr>
            <th>Organization</th>
            <th>Sector</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.partners.map(partner => `
            <tr>
              <td>${partner.name}</td>
              <td>${partner.sectorType || 'N/A'}</td>
              <td>${partner.status || 'N/A'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
`;
  }

  // Section 5: Projects
  if (sections.includes('projects')) {
    const statusCounts = {
      Planning: data.projects.filter(p => p.status === 'Planning').length,
      'In Progress': data.projects.filter(p => p.status === 'In Progress').length,
      'On Hold': data.projects.filter(p => p.status === 'On Hold').length,
      Completed: data.projects.filter(p => p.status === 'Completed').length,
      Cancelled: data.projects.filter(p => p.status === 'Cancelled').length,
    };
    
    html += `
    <div class="section">
      <h2>5. Project Status Overview</h2>
      <div class="metric-grid">
        <div class="metric-card">
          <div class="label">Total Projects</div>
          <div class="value">${data.projects.length}</div>
        </div>
        <div class="metric-card">
          <div class="label">Completed Hours</div>
          <div class="value">${analytics.metrics?.completedHours || 0}</div>
        </div>
        <div class="metric-card">
          <div class="label">Total Beneficiaries</div>
          <div class="value">${analytics.metrics?.totalBeneficiaries || 0}</div>
        </div>
      </div>
      
      <h3>Status Breakdown</h3>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(statusCounts).map(([status, count]) => `
            <tr>
              <td>${status}</td>
              <td>${count}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
`;
  }

  html += `
    <div class="footer">
      <p>Generated by Nasugbu Volunteer Center Analytics System</p>
      <p>© ${new Date().getFullYear()} NVC. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

  return html;
}

export default function AdminAnalyticsScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const [projects, setProjects] = useState<Project[]>([]);
  const [programTracks, setProgramTracks] = useState<ProgramTrack[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [reports, setReports] = useState<PartnerReport[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | 'all'>('all');
  const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState<string | 'all'>('all');
  const [showProgramDropdown, setShowProgramDropdown] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedReportSections, setSelectedReportSections] = useState<string[]>(['full']);

  const loadAnalytics = useCallback(async (showLoader = false) => {
    if (showLoader) {
      setLoading(true);
    }

    try {
      const [nextProjects, nextProgramTracks, nextVolunteers, nextTimeLogs, nextJoinRecords, nextReports, nextPartners, nextApplications] = await Promise.all([
        getAllProjects(),
        getAllProgramTracks(),
        getAllVolunteers(),
        getAllVolunteerTimeLogs(),
        getAllVolunteerProjectJoinRecords(),
        getAllPartnerReports(),
        getAllPartners(),
        getAllPartnerProjectApplications(),
      ]);
      setProjects(nextProjects);
      setProgramTracks(nextProgramTracks);
      setVolunteers(nextVolunteers);
      setTimeLogs(nextTimeLogs);
      setVolunteerJoinRecords(nextJoinRecords);
      setReports(nextReports);
      setPartners(nextPartners);
      setPartnerApplications(nextApplications);
    } catch (error) {
      console.error('Failed to load admin analytics:', error);
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadAnalytics(true);
  }, [loadAnalytics]);

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'programTracks', 'programs', 'volunteers', 'volunteerTimeLogs', 'partnerReports', 'volunteerProjectJoins', 'partners', 'partnerProjectApplications'],
      () => {
        void loadAnalytics();
      }
    );
  }, [loadAnalytics]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAnalytics();
    setRefreshing(false);
  }, [loadAnalytics]);

  // Filter data by selected partner and program
  const filteredProjects = useMemo(() => {
    let result = projects;
    
    // Filter by partner
    if (selectedPartnerId !== 'all') {
      result = result.filter(p => p.partnerId === selectedPartnerId);
    }
    
    // Filter by program
    if (selectedProgramId !== 'all') {
      result = result.filter(p => p.program_id === selectedProgramId);
    }
    
    return result;
  }, [projects, selectedPartnerId, selectedProgramId]);

  const filteredReports = useMemo(() => {
    const activeReports = reports.filter(report => report.status !== 'Rejected');
    if (selectedPartnerId === 'all' && selectedProgramId === 'all') return activeReports;
    const partnerProjectIds = new Set(filteredProjects.map(p => p.id));
    return activeReports.filter(r => partnerProjectIds.has(r.projectId));
  }, [reports, filteredProjects, selectedPartnerId, selectedProgramId]);

  const filteredTimeLogs = useMemo(() => {
    if (selectedPartnerId === 'all' && selectedProgramId === 'all') return timeLogs;
    const partnerProjectIds = new Set(filteredProjects.map(p => p.id));
    return timeLogs.filter(log => partnerProjectIds.has(log.projectId));
  }, [timeLogs, filteredProjects, selectedPartnerId, selectedProgramId]);

  const filteredJoinRecords = useMemo(() => {
    if (selectedPartnerId === 'all' && selectedProgramId === 'all') return volunteerJoinRecords;
    const partnerProjectIds = new Set(filteredProjects.map(p => p.id));
    return volunteerJoinRecords.filter(record => partnerProjectIds.has(record.projectId));
  }, [volunteerJoinRecords, filteredProjects, selectedPartnerId, selectedProgramId]);

  const filteredVolunteers = useMemo(() => {
    if (selectedPartnerId === 'all' && selectedProgramId === 'all') return volunteers;
    // Get volunteers who participated in filtered projects
    const volunteerIds = new Set<string>();
    filteredTimeLogs.forEach(log => volunteerIds.add(log.volunteerId));
    filteredJoinRecords.forEach(record => {
      if (record.volunteerId) volunteerIds.add(record.volunteerId);
    });
    filteredProjects.forEach(project => {
      (project.volunteers || []).forEach(id => volunteerIds.add(id));
    });
    return volunteers.filter(v => volunteerIds.has(v.id));
  }, [volunteers, filteredTimeLogs, filteredJoinRecords, filteredProjects, selectedPartnerId, selectedProgramId]);

  const monthPoints = useMemo(() => buildMonthPoints(filteredVolunteers), [filteredVolunteers]);
  const weeks = useMemo(() => buildWeekBuckets(), []);
  const heatmapRows = useMemo(
    () => buildHeatmapRows(filteredProjects, filteredTimeLogs, filteredJoinRecords, filteredVolunteers, weeks),
    [filteredProjects, filteredTimeLogs, filteredJoinRecords, filteredVolunteers, weeks]
  );
  const skillAnalytics = useMemo(
    () => buildSkillSlices(filteredVolunteers, filteredProjects, filteredTimeLogs, filteredJoinRecords),
    [filteredProjects, filteredTimeLogs, filteredJoinRecords, filteredVolunteers]
  );
  const trackedProjects = useMemo(
    () => filteredProjects.filter(project => !project.isEvent && !isTopLevelProgramRecord(project, programTracks)),
    [filteredProjects, programTracks]
  );

  const partnerSectorsByQuarter = useMemo(() => buildPartnerSectorsByQuarter(partners), [partners]);

  const completedHours = useMemo(
    () => Math.round(filteredTimeLogs.reduce((sum, log) => sum + getCompletedVolunteerHours(log), 0)),
    [filteredTimeLogs]
  );
  
  // Calculate project metrics
  const projectMetrics = useMemo(() => {
    const totalProjects = trackedProjects.length;
    const completedProjects = trackedProjects.filter(p => p.status === 'Completed').length;
    const completionPercentage = totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0;
    
    // Impact reports are the authoritative source for beneficiaries reached.
    // Keep expectedBeneficiaries as a fallback for legacy project records that
    // predate the reports workflow.
    // Volunteer reports are the source for event-level beneficiary counts.
    // A partner report may contain an auto-generated roll-up of those same
    // volunteer reports, so prefer volunteer values per project and only use
    // partner/legacy impact counts when no volunteer value exists.
    const reportsByProject = new Map<string, PartnerReport[]>();
    filteredReports.forEach(report => {
      const projectId = String(report.projectId || '').trim();
      if (!projectId) return;
      const existing = reportsByProject.get(projectId) || [];
      existing.push(report);
      reportsByProject.set(projectId, existing);
    });

    let reportedBeneficiaries = 0;
    let hasReportBeneficiaryData = false;
    reportsByProject.forEach(projectReports => {
      const volunteerReports = projectReports.filter(
        report => report.submitterRole === 'volunteer' && hasExplicitBeneficiaryMetric(report)
      );
      const sourceReports = volunteerReports.length
        ? volunteerReports
        : projectReports.filter(report => report.submitterRole !== 'volunteer');

      if (sourceReports.length > 0) {
        hasReportBeneficiaryData = true;
        reportedBeneficiaries += sourceReports.reduce(
          (sum, report) => sum + getReportBeneficiariesServed(report),
          0
        );
      }
    });
    const legacyBeneficiaries = trackedProjects.reduce(
      (sum, project) => sum + (Number((project as any).expectedBeneficiaries) || 0),
      0
    );
    const totalBeneficiaries = hasReportBeneficiaryData
      ? reportedBeneficiaries
      : legacyBeneficiaries;
    
    return {
      totalProjects,
      completedProjects,
      completionPercentage,
      totalBeneficiaries,
      completedHours,
    };
  }, [trackedProjects, filteredReports, completedHours]);
  
  const currentTotal = filteredVolunteers.length;
  const previousTotal = monthPoints[monthPoints.length - 2]?.value || 0;
  const monthlyDelta = currentTotal - previousTotal;
  const maxVolunteerValue = Math.max(4, ...monthPoints.map(point => point.value));
  const maxHeatValue = Math.max(0, ...heatmapRows.flatMap(row => row.cells.map(cell => cell.value)));
  const chartWidth = Math.max(620, Math.min(900, width - 260));
  const chartHeight = 230;
  const plotPadding = { top: 18, right: 16, bottom: 32, left: 46 };
  const plotWidth = chartWidth - plotPadding.left - plotPadding.right;
  const plotHeight = chartHeight - plotPadding.top - plotPadding.bottom;
  const chartPoints = monthPoints.map((point, index) => {
    const x = plotPadding.left + (plotWidth / Math.max(1, monthPoints.length - 1)) * index;
    const y = plotPadding.top + plotHeight - (point.value / maxVolunteerValue) * plotHeight;
    return { ...point, x, y };
  });
  const donutGradient = buildDonutGradient(skillAnalytics.slices);
  const isCompact = width < 980;
  const isWeb = Platform.OS === 'web';
  const [hoveredPointKey, setHoveredPointKey] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{
    rowTitle: string;
    weekLabel: string;
    value: number;
    names: string[];
    rowIndex: number;
    columnIndex: number;
  } | null>(null);
  const hoverClearTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedPartnerName = useMemo(() => {
    if (selectedPartnerId === 'all') return 'All Partners';
    return partners.find(p => p.id === selectedPartnerId)?.name || 'Unknown Partner';
  }, [selectedPartnerId, partners]);

  const selectedProgramName = useMemo(() => {
    if (selectedProgramId === 'all') return 'All Programs';
    return programTracks.find(p => p.id === selectedProgramId)?.title || 'Unknown Program';
  }, [selectedProgramId, programTracks]);

  // CSV Export Function
  const exportToCSV = () => {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const filterInfo = `${selectedPartnerName} - ${selectedProgramName}`;

      // Prepare CSV data for different sections
      let csvContent = 'data:text/csv;charset=utf-8,';

      // Header
      csvContent += `Nasugbu Volunteer Center Analytics Report\n`;
      csvContent += `Generated: ${new Date().toLocaleString()}\n`;
      csvContent += `Filters: ${filterInfo}\n\n`;

      // 1. Project Metrics Summary
      csvContent += `PROJECT METRICS SUMMARY\n`;
      csvContent += `Metric,Value\n`;
      csvContent += `Total Projects,${projectMetrics.totalProjects}\n`;
      csvContent += `Completed Projects,${projectMetrics.completedProjects}\n`;
      csvContent += `Completion Percentage,${projectMetrics.completionPercentage}%\n`;
      csvContent += `Total Beneficiaries,${projectMetrics.totalBeneficiaries}\n`;
      csvContent += `Completed Hours,${projectMetrics.completedHours}\n`;
      csvContent += `Active Volunteers,${filteredVolunteers.filter(v => v.registrationStatus === 'Approved').length}\n\n`;

      // 2. Volunteer Growth (Last 12 Months)
      csvContent += `VOLUNTEER GROWTH - LAST 12 MONTHS\n`;
      csvContent += `Month,Cumulative Volunteers\n`;
      monthPoints.slice(-12).forEach(point => {
        csvContent += `${point.label},${point.value}\n`;
      });
      csvContent += `\n`;

      // 3. Skills Distribution (Top 20)
      csvContent += `TOP 20 SKILLS CONTRIBUTED\n`;
      csvContent += `Skill,Volunteer Count,Percentage\n`;
      skillAnalytics.slices.slice(0, 20).forEach(skill => {
        csvContent += `"${skill.name}",${skill.count},${skill.percent}%\n`;
      });
      csvContent += `\n`;

      // 4. Events Summary
      const events = filteredProjects.filter(p => p.isEvent);
      csvContent += `EVENTS SUMMARY\n`;
      csvContent += `Event Title,Start Date,End Date,Volunteer Count,Status\n`;
      events.forEach(event => {
        const title = (event.title || 'Untitled Event').replace(/"/g, '""');
        const startDate = event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBD';
        const endDate = event.endDate ? new Date(event.endDate).toLocaleDateString() : 'TBD';
        const volunteerCount = (event.volunteers || []).length;
        csvContent += `"${title}",${startDate},${endDate},${volunteerCount},${event.status}\n`;
      });
      csvContent += `\n`;

      // 5. Partner Sectors by Quarter
      csvContent += `PARTNER SECTORS BY QUARTER\n`;
      csvContent += `Quarter,NGO,Hospital,Institution,Private,Total\n`;
      partnerSectorsByQuarter.forEach(q => {
        const total = q.NGO + q.Hospital + q.Institution + q.Private;
        csvContent += `${q.quarter},${q.NGO},${q.Hospital},${q.Institution},${q.Private},${total}\n`;
      });
      csvContent += `\n`;

      // 6. All Projects
      csvContent += `ALL PROJECTS\n`;
      csvContent += `Title,Status,Start Date,End Date,Hours Logged,Volunteers,Is Event\n`;
      filteredProjects.forEach(project => {
        const title = (project.title || 'Untitled').replace(/"/g, '""');
        const startDate = project.startDate ? new Date(project.startDate).toLocaleDateString() : 'N/A';
        const endDate = project.endDate ? new Date(project.endDate).toLocaleDateString() : 'N/A';
        const hoursLogged = filteredTimeLogs.filter(log => log.projectId === project.id)
          .reduce((sum, log) => sum + getCompletedVolunteerHours(log), 0);
        const volunteerCount = (project.volunteers || []).length;
        const isEvent = project.isEvent ? 'Yes' : 'No';
        csvContent += `"${title}",${project.status},${startDate},${endDate},${hoursLogged},${volunteerCount},${isEvent}\n`;
      });
      csvContent += `\n`;

      // 7. All Volunteers
      csvContent += `ALL VOLUNTEERS\n`;
      csvContent += `Name,Email,Phone,Status,Skills,Joined Date\n`;
      filteredVolunteers.forEach(volunteer => {
        const name = (volunteer.name || 'N/A').replace(/"/g, '""');
        const email = (volunteer.email || 'N/A').replace(/"/g, '""');
        const phone = volunteer.phone || 'N/A';
        const status = volunteer.registrationStatus || 'N/A';
        const skills = (volunteer.skills || []).join('; ').replace(/"/g, '""');
        const joinedDate = volunteer.createdAt ? new Date(volunteer.createdAt).toLocaleDateString() : 'N/A';
        csvContent += `"${name}","${email}",${phone},${status},"${skills}",${joinedDate}\n`;
      });
      csvContent += `\n`;

      // 8. All Partners
      csvContent += `ALL PARTNERS\n`;
      csvContent += `Organization Name,Sector,Contact Name,Email,Phone,Status\n`;
      partners.forEach(partner => {
        const orgName = (partner.name || 'N/A').replace(/"/g, '""');
        const sector = partner.sectorType || 'N/A';
        const contactName = (partner.stakeholderName || 'N/A').replace(/"/g, '""');
        const email = (partner.contactEmail || 'N/A').replace(/"/g, '""');
        const phone = partner.contactPhone || 'N/A';
        const status = partner.status || 'N/A';
        csvContent += `"${orgName}",${sector},"${contactName}","${email}",${phone},${status}\n`;
      });

      // Create download
      if (Platform.OS === 'web') {
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `NVC_Analytics_Export_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        Alert.alert('Success', 'CSV file downloaded successfully!');
      } else {
        Alert.alert('Export Complete', 'CSV export is currently optimized for web. Please use the web version for downloads.');
      }
    } catch (error) {
      console.error('CSV export error:', error);
      Alert.alert('Error', 'Failed to export CSV. Please try again.');
    }
  };

  const cancelHoverClear = useCallback(() => {
    if (hoverClearTimeoutRef.current) {
      clearTimeout(hoverClearTimeoutRef.current);
      hoverClearTimeoutRef.current = null;
    }
  }, []);

  const clearHoverPointAfterDelay = useCallback(() => {
    cancelHoverClear();
    hoverClearTimeoutRef.current = setTimeout(() => {
      setHoveredPointKey(null);
      hoverClearTimeoutRef.current = null;
    }, 300);
  }, [cancelHoverClear]);

  const handleHoverPoint = useCallback(
    (key: string) => {
      cancelHoverClear();
      setHoveredPointKey(key);
    },
    [cancelHoverClear]
  );

  useEffect(() => {
    return () => {
      cancelHoverClear();
    };
  }, [cancelHoverClear]);

  const hoveredPoint = hoveredPointKey ? chartPoints.find(point => point.key === hoveredPointKey) : null;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4b7d3c" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Filter Selectors */}
        <View style={styles.filtersContainer}>
          {/* Partner Selector */}
          <View style={styles.filterCard}>
            <Text style={styles.selectorLabel}>Filter by Partner</Text>
            <TouchableOpacity
              style={styles.partnerDropdownButton}
              onPress={() => {
                setShowPartnerDropdown(!showPartnerDropdown);
                setShowProgramDropdown(false);
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="business" size={20} color={ModernTheme.colors.primary[700]} />
              <Text style={styles.partnerDropdownText}>{selectedPartnerName}</Text>
              <MaterialIcons 
                name={showPartnerDropdown ? "arrow-drop-up" : "arrow-drop-down"} 
                size={24} 
                color={ModernTheme.colors.text.secondary} 
              />
            </TouchableOpacity>
            
            {showPartnerDropdown && (
              <View style={styles.partnerDropdownMenu}>
                <TouchableOpacity
                  style={[
                    styles.partnerDropdownItem,
                    selectedPartnerId === 'all' && styles.partnerDropdownItemActive
                  ]}
                  onPress={() => {
                    setSelectedPartnerId('all');
                    setShowPartnerDropdown(false);
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons 
                    name="dashboard" 
                    size={18} 
                    color={selectedPartnerId === 'all' ? ModernTheme.colors.primary[700] : ModernTheme.colors.text.secondary} 
                  />
                  <Text style={[
                    styles.partnerDropdownItemText,
                    selectedPartnerId === 'all' && styles.partnerDropdownItemTextActive
                  ]}>All Partners</Text>
                  {selectedPartnerId === 'all' && (
                    <MaterialIcons name="check" size={18} color={ModernTheme.colors.primary[700]} />
                  )}
                </TouchableOpacity>
                
                {partners.map(partner => (
                  <TouchableOpacity
                    key={partner.id}
                    style={[
                      styles.partnerDropdownItem,
                      selectedPartnerId === partner.id && styles.partnerDropdownItemActive
                    ]}
                    onPress={() => {
                      setSelectedPartnerId(partner.id);
                      setShowPartnerDropdown(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons 
                      name="business" 
                      size={18} 
                      color={selectedPartnerId === partner.id ? ModernTheme.colors.primary[700] : ModernTheme.colors.text.secondary} 
                    />
                    <Text style={[
                      styles.partnerDropdownItemText,
                      selectedPartnerId === partner.id && styles.partnerDropdownItemTextActive
                    ]} numberOfLines={1}>{partner.name}</Text>
                    {selectedPartnerId === partner.id && (
                      <MaterialIcons name="check" size={18} color={ModernTheme.colors.primary[700]} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Program Selector */}
          <View style={styles.filterCard}>
            <Text style={styles.selectorLabel}>Filter by Program</Text>
            <TouchableOpacity
              style={styles.partnerDropdownButton}
              onPress={() => {
                setShowProgramDropdown(!showProgramDropdown);
                setShowPartnerDropdown(false);
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="category" size={20} color={ModernTheme.colors.primary[700]} />
              <Text style={styles.partnerDropdownText}>{selectedProgramName}</Text>
              <MaterialIcons 
                name={showProgramDropdown ? "arrow-drop-up" : "arrow-drop-down"} 
                size={24} 
                color={ModernTheme.colors.text.secondary} 
              />
            </TouchableOpacity>
            
            {showProgramDropdown && (
              <View style={styles.partnerDropdownMenu}>
                <TouchableOpacity
                  style={[
                    styles.partnerDropdownItem,
                    selectedProgramId === 'all' && styles.partnerDropdownItemActive
                  ]}
                  onPress={() => {
                    setSelectedProgramId('all');
                    setShowProgramDropdown(false);
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons 
                    name="dashboard" 
                    size={18} 
                    color={selectedProgramId === 'all' ? ModernTheme.colors.primary[700] : ModernTheme.colors.text.secondary} 
                  />
                  <Text style={[
                    styles.partnerDropdownItemText,
                    selectedProgramId === 'all' && styles.partnerDropdownItemTextActive
                  ]}>All Programs</Text>
                  {selectedProgramId === 'all' && (
                    <MaterialIcons name="check" size={18} color={ModernTheme.colors.primary[700]} />
                  )}
                </TouchableOpacity>
                
                {programTracks.map(program => (
                  <TouchableOpacity
                    key={program.id}
                    style={[
                      styles.partnerDropdownItem,
                      selectedProgramId === program.id && styles.partnerDropdownItemActive
                    ]}
                    onPress={() => {
                      setSelectedProgramId(program.id);
                      setShowProgramDropdown(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons 
                      name="category" 
                      size={18} 
                      color={selectedProgramId === program.id ? ModernTheme.colors.primary[700] : ModernTheme.colors.text.secondary} 
                    />
                    <Text style={[
                      styles.partnerDropdownItemText,
                      selectedProgramId === program.id && styles.partnerDropdownItemTextActive
                    ]} numberOfLines={1}>{program.title}</Text>
                    {selectedProgramId === program.id && (
                      <MaterialIcons name="check" size={18} color={ModernTheme.colors.primary[700]} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Project Metrics Overview */}
        <View style={styles.metricsOverviewCard}>
          <View style={[styles.cardHeader, { marginBottom: ModernTheme.spacing[4] }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>PROJECT METRICS OVERVIEW</Text>
              <Text style={styles.cardSubtitle}>Key performance indicators across filtered projects</Text>
            </View>
            <View style={styles.exportButtonsContainer}>
              <TouchableOpacity
                style={styles.exportCSVButton}
                onPress={() => exportToCSV()}
                activeOpacity={0.8}
              >
                <MaterialIcons name="table-chart" size={20} color="#16a34a" />
                <Text style={styles.exportCSVButtonText}>Export CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.generateReportButton}
                onPress={() => setShowReportModal(true)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="picture-as-pdf" size={20} color="#fff" />
                <Text style={styles.generateReportButtonText}>Generate PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.metricsGrid}>
            {/* Project Completion */}
            <View style={styles.metricBox}>
              <View style={styles.metricIconCircle}>
                <MaterialIcons name="check-circle" size={28} color={ModernTheme.colors.primary[600]} />
              </View>
              <Text style={styles.metricValue}>{projectMetrics.completionPercentage}%</Text>
              <Text style={styles.metricLabel}>Project Completion</Text>
              <Text style={styles.metricSubtext}>
                {projectMetrics.completedProjects} of {projectMetrics.totalProjects} completed
              </Text>
            </View>

            {/* Volunteer Hours */}
            <View style={styles.metricBox}>
              <View style={[styles.metricIconCircle, { backgroundColor: ModernTheme.colors.accent[50] }]}>
                <MaterialIcons name="schedule" size={28} color={ModernTheme.colors.accent[600]} />
              </View>
              <Text style={styles.metricValue}>{projectMetrics.completedHours.toLocaleString()}</Text>
              <Text style={styles.metricLabel}>Volunteer Hours</Text>
              <Text style={styles.metricSubtext}>
                Total hours contributed
              </Text>
            </View>

            {/* Beneficiaries Reached */}
            <View style={styles.metricBox}>
              <View style={[styles.metricIconCircle, { backgroundColor: ModernTheme.colors.status.completed + '20' }]}>
                <MaterialIcons name="people-outline" size={28} color={ModernTheme.colors.status.completed} />
              </View>
              <Text style={styles.metricValue}>{projectMetrics.totalBeneficiaries.toLocaleString()}</Text>
              <Text style={styles.metricLabel}>Beneficiaries Reached</Text>
              <Text style={styles.metricSubtext}>
                Across all projects
              </Text>
            </View>

            {/* Active Volunteers */}
            <View style={styles.metricBox}>
              <View style={[styles.metricIconCircle, { backgroundColor: ModernTheme.colors.primary[100] }]}>
                <MaterialIcons name="groups" size={28} color={ModernTheme.colors.primary[700]} />
              </View>
              <Text style={styles.metricValue}>{currentTotal}</Text>
              <Text style={styles.metricLabel}>Active Volunteers</Text>
              <Text style={styles.metricSubtext}>
                Total registered
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.chartCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>TOTAL VOLUNTEERS</Text>
              <Text style={styles.cardSubtitle}>Cumulative growth across the last 12 months</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendDot} />
              <Text style={styles.legendText}>Volunteers</Text>
            </View>
          </View>

          <View style={styles.metricStrip}>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
            <View style={styles.totalPill}>
              <MaterialIcons name="groups" size={14} color="#fff" />
              <Text style={styles.totalPillText}>{currentTotal} total volunteers</Text>
            </View>
            <View style={styles.deltaPill}>
              <MaterialIcons name={monthlyDelta >= 0 ? 'trending-up' : 'trending-down'} size={14} color="#2d6f35" />
              <Text style={styles.deltaPillText}>
                {monthlyDelta >= 0 ? '+' : ''}{monthlyDelta} vs last month
              </Text>
            </View>
            <Text style={styles.inspectHint}>
              {hoveredPoint ? `${hoveredPoint.label}: ${hoveredPoint.value} volunteers` : 'Hover a point to inspect a month'}
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View
              style={[styles.lineChart, { width: chartWidth, height: chartHeight }]}
            >
              {[0, 1, 2, 3, 4].map(step => {
                const value = Math.round((maxVolunteerValue / 4) * step);
                const top = plotPadding.top + plotHeight - (plotHeight / 4) * step;
                return (
                  <View key={step} style={[styles.gridLine, { top, left: plotPadding.left, width: plotWidth }]}>
                    <Text style={styles.axisLabel}>{value}</Text>
                  </View>
                );
              })}
              {chartPoints.slice(1).map((point, index) => {
                const previous = chartPoints[index];
                const dx = point.x - previous.x;
                const dy = point.y - previous.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const angle = `${Math.atan2(dy, dx)}rad`;
                return (
                  <View
                    key={`${previous.key}-${point.key}`}
                    style={[
                      styles.lineSegment,
                      {
                        width: distance,
                        left: (previous.x + point.x) / 2 - distance / 2,
                        top: (previous.y + point.y) / 2 - 1.5,
                        transform: [{ rotate: angle }],
                      },
                    ]}
                  />
                );
              })}
              {hoveredPoint ? (
                <View
                  style={[styles.tooltip, { left: Math.max(8, hoveredPoint.x - 42), top: Math.max(4, hoveredPoint.y - 50) }]}
                  {...(isWeb
                    ? ({
                        onMouseEnter: () => handleHoverPoint(hoveredPoint.key),
                        onPointerEnter: () => handleHoverPoint(hoveredPoint.key),
                        onMouseLeave: clearHoverPointAfterDelay,
                        onPointerLeave: clearHoverPointAfterDelay,
                      } as any)
                    : {})}
                >
                  <Text style={styles.tooltipLabel}>{hoveredPoint.label}</Text>
                  <Text style={styles.tooltipValue}>{hoveredPoint.value} volunteers</Text>
                  {hoveredPoint.names.length > 0 ? (
                    <Text style={styles.tooltipNames}>
                      {hoveredPoint.names.slice(0, 6).join(', ')}
                      {hoveredPoint.names.length > 6 ? ` +${hoveredPoint.names.length - 6} more` : ''}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {chartPoints.map(point => (
                <React.Fragment key={point.key}>
                  <View
                    style={[styles.hoverTarget, { left: point.x - 21, top: point.y - 21 }]}
                    {...(isWeb
                      ? ({
                          onMouseEnter: () => handleHoverPoint(point.key),
                          onPointerEnter: () => handleHoverPoint(point.key),
                          onMouseOver: () => handleHoverPoint(point.key),
                          onMouseLeave: clearHoverPointAfterDelay,
                          onPointerLeave: clearHoverPointAfterDelay,
                        } as any)
                      : {
                          onStartShouldSetResponder: () => true,
                          onResponderGrant: () => handleHoverPoint(point.key),
                          onResponderMove: () => handleHoverPoint(point.key),
                          onResponderRelease: clearHoverPointAfterDelay,
                        })}
                  >
                    <View style={styles.chartPoint} />
                  </View>
                  <Text style={[styles.monthLabel, { left: point.x - 18, top: chartHeight - 25 }]}>{point.label}</Text>
                </React.Fragment>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={[styles.lowerGrid, isCompact && styles.lowerGridStacked]}>
          <View style={[styles.heatmapCard, isCompact && styles.fullWidthCard]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>VOLUNTEERS PER EVENT</Text>
                <Text style={styles.cardSubtitle}>Weekly distribution of volunteer activity across top events</Text>
              </View>
              <View style={styles.heatLegend}>
                <Text style={styles.heatLegendText}>Low</Text>
                {HEAT_COLORS.slice(1).map(color => (
                  <View key={color} style={[styles.heatLegendSwatch, { backgroundColor: color }]} />
                ))}
                <Text style={styles.heatLegendText}>High</Text>
              </View>
            </View>
            <Text style={styles.previewHint}>
              {hoveredCell ? (
                hoveredCell.names.length > 0 ?
                  `${hoveredCell.weekLabel} — ${hoveredCell.rowTitle}: ${hoveredCell.names.join(', ')}` :
                  `${hoveredCell.weekLabel} — ${hoveredCell.rowTitle}: ${hoveredCell.value} volunteer${hoveredCell.value === 1 ? '' : 's'}`
              ) : (
                'Hover a cell to preview - tap to see volunteer details'
              )}
            </Text>

            {heatmapRows.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No event volunteer activity yet</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.heatmapTableWrapper}>
                  <View style={styles.heatmapTable}>
                    <View style={styles.heatmapHeaderRow}>
                    <View style={styles.eventNameSpacer} />
                    {weeks.map(week => (
                      <View key={week.key} style={styles.weekHeader}>
                        <Text style={styles.weekLabel}>{week.label}</Text>
                        <Text style={styles.weekSubLabel}>{week.subLabel}</Text>
                      </View>
                    ))}
                  </View>
                  {heatmapRows.map((row, rowIndex) => (
                    <View key={row.id} style={styles.heatmapRow}>
                      <View style={styles.eventNameCell}>
                        <Text style={styles.eventName} numberOfLines={1}>{formatEventTitle(row.title)}</Text>
                        <Text style={styles.eventJoined}>{row.joined} joined</Text>
                      </View>
                      {row.cells.map((cell, index) => (
                        <View
                          key={`${row.id}-${weeks[index].key}`}
                          style={[
                            styles.heatCell,
                            { backgroundColor: getHeatColor(cell.value, maxHeatValue) },
                          ]}
                          {...(isWeb
                            ? ({
                                onMouseEnter: () => setHoveredCell({
                                  rowTitle: row.title,
                                  weekLabel: weeks[index].label,
                                  value: cell.value,
                                  names: cell.names,
                                  rowIndex,
                                  columnIndex: index,
                                }),
                                onMouseLeave: () => setHoveredCell(null),
                              } as any)
                            : {
                                onStartShouldSetResponder: () => true,
                                onResponderGrant: () => setHoveredCell({
                                  rowTitle: row.title,
                                  weekLabel: weeks[index].label,
                                  value: cell.value,
                                  names: cell.names,
                                  rowIndex,
                                  columnIndex: index,
                                }),
                                onResponderRelease: () => setHoveredCell(null),
                              })}
                        >
                          {cell.value > 0 ? <Text style={styles.heatCellText}>{cell.value}</Text> : null}
                        </View>
                      ))}
                    </View>
                  ))}
                  {hoveredCell ? (
                    <View
                      style={[
                        styles.tooltip,
                        {
                          left: 168 + hoveredCell.columnIndex * 58,
                          top: 48 + hoveredCell.rowIndex * 47,
                        },
                      ]}
                    >
                      <Text style={styles.tooltipLabel}>{hoveredCell.weekLabel}</Text>
                      <Text style={styles.tooltipValue}>{hoveredCell.rowTitle}</Text>
                      {hoveredCell.names.length > 0 ? (
                        <Text style={styles.tooltipNames}>{hoveredCell.names.join(', ')}</Text>
                      ) : (
                        <Text style={styles.tooltipValue}>{hoveredCell.value} volunteer{hoveredCell.value === 1 ? '' : 's'}</Text>
                      )}
                    </View>
                  ) : null}
                </View>
              </View>
              </ScrollView>
            )}
          </View>

          <View style={[styles.skillsCard, isCompact && styles.fullWidthCard]}>
            <Text style={styles.cardTitle}>SKILLS CONTRIBUTED</Text>
            <Text style={styles.cardSubtitle}>All skills brought by volunteers joined to events</Text>
            <View style={styles.skillsBody}>
              <View style={styles.donutWrap}>
                <View
                  style={[
                    styles.donutOuter,
                    Platform.OS === 'web' ? ({ backgroundImage: donutGradient } as any) : null,
                  ]}
                >
                  {Platform.OS !== 'web' && skillAnalytics.slices.map((slice, index) => (
                    <View
                      key={slice.name}
                      style={[
                        styles.mobileDonutBand,
                        {
                          backgroundColor: slice.color,
                          transform: [{ rotate: `${index * (360 / Math.max(1, skillAnalytics.slices.length))}deg` }],
                        },
                      ]}
                    />
                  ))}
                  <View style={styles.donutInner}>
                    <Text style={styles.donutNumber}>{skillAnalytics.slices.length}</Text>
                    <Text style={styles.donutLabel}>SKILLS</Text>
                  </View>
                </View>
                <Text style={styles.donutMeta}>
                  {skillAnalytics.volunteerCount} volunteers - {skillAnalytics.contributionCount} contributions
                </Text>
              </View>

              <View style={styles.skillList}>
                {skillAnalytics.slices.length === 0 ? (
                  <Text style={styles.emptyText}>No skills available</Text>
                ) : (
                  skillAnalytics.slices.map(slice => (
                    <View key={slice.name} style={styles.skillRow}>
                      <View style={[styles.skillDot, { backgroundColor: slice.color }]} />
                      <Text style={styles.skillName} numberOfLines={1}>{slice.name}</Text>
                      <Text style={styles.skillValue}>{slice.count} - {slice.percent}%</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>
        </View>

        {/* PROJECT STATUS OVERVIEW */}
        <View style={styles.statusOverviewCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>PROJECT STATUS OVERVIEW</Text>
              <Text style={styles.cardSubtitle}>Engage projects are sorted by current status</Text>
            </View>
          </View>

          <View style={styles.statusList}>
            {(['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'] as const).map(status => {
              const count = trackedProjects.filter(p => p.status === status).length;
              const statusColor = 
                status === 'Planning' ? ModernTheme.colors.status.planning :
                status === 'In Progress' ? ModernTheme.colors.status.inProgress :
                status === 'On Hold' ? ModernTheme.colors.status.onHold :
                status === 'Completed' ? ModernTheme.colors.status.completed :
                ModernTheme.colors.status.cancelled;
              
              return (
                <View key={status} style={styles.statusRow}>
                  <View style={styles.statusLeft}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={styles.statusLabel}>{status}</Text>
                  </View>
                  <Text style={styles.statusCount}>{count}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* PROJECTS TRACKING */}
        <View style={styles.trackingCard}>
          <View style={styles.trackingHeader}>
            <View>
              <Text style={styles.cardTitle}>PROJECTS TRACKING</Text>
              <Text style={styles.cardSubtitle}>Partner organization projects with their counts and current status</Text>
            </View>
            <View style={styles.trackingFilters}>
              {(() => {
                const partnerProjects = trackedProjects;
                
                return (
                  <>
                    <View style={[styles.filterChip, styles.filterChipActive]}>
                      <Text style={[styles.filterChipText, styles.filterChipTextActive]}>All ({partnerProjects.length})</Text>
                    </View>
                    {(['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'] as const).map(status => {
                      const count = partnerProjects.filter(p => p.status === status).length;
                      return (
                        <View key={status} style={styles.filterChip}>
                          <Text style={styles.filterChipText}>{status} ({count})</Text>
                        </View>
                      );
                    })}
                  </>
                );
              })()}
            </View>
          </View>

          {(() => {
            const partnerProjects = trackedProjects.slice(0, 10);

            if (partnerProjects.length === 0) {
              return (
                <View style={styles.emptyTrackingState}>
                  <MaterialIcons name="folder-open" size={48} color={ModernTheme.colors.neutral[300]} />
                  <Text style={styles.emptyText}>No partner projects yet</Text>
                </View>
              );
            }

            return (
              <View style={styles.projectTrackingList}>
                {partnerProjects.map(project => {
                  const statusColor = 
                    project.status === 'Planning' ? ModernTheme.colors.status.planning :
                    project.status === 'In Progress' ? ModernTheme.colors.status.inProgress :
                    project.status === 'On Hold' ? ModernTheme.colors.status.onHold :
                    project.status === 'Completed' ? ModernTheme.colors.status.completed :
                    ModernTheme.colors.status.cancelled;

                  // Find the partner organization for this project
                  const application = partnerApplications.find(
                    app => app.projectId === project.id && app.status === 'Approved'
                  );
                  const partner = partners.find(
                    p => p.id === project.partnerId || p.ownerUserId === application?.partnerUserId
                  );
                  const partnerName = partner?.name || application?.partnerName || 'Internal';
                  const volunteerCount = getProjectVolunteerIdsIncludingEvents(
                    project,
                    filteredProjects,
                    filteredTimeLogs,
                    filteredJoinRecords,
                    filteredVolunteers
                  ).size;

                  return (
                    <TouchableOpacity
                      key={project.id}
                      style={styles.projectTrackingItem}
                      onPress={() => navigateToAvailableRoute(navigation, 'Projects', { projectId: project.id })}
                      activeOpacity={0.75}
                    >
                      <View style={styles.projectTrackingMain}>
                        <View style={[styles.projectStatusIndicator, { backgroundColor: statusColor }]} />
                        <View style={styles.projectTrackingInfo}>
                          <Text style={styles.projectTrackingTitle} numberOfLines={1}>
                            {project.title}
                          </Text>
                          <Text style={styles.projectTrackingMeta}>
                            Project
                          </Text>
                          <View style={styles.partnerOrgBadge}>
                            <MaterialIcons name="business" size={12} color={ModernTheme.colors.accent[700]} />
                            <Text style={styles.partnerOrgText} numberOfLines={1}>{partnerName}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={styles.projectTrackingStats}>
                        <View style={styles.projectStatBadge}>
                          <MaterialIcons name="people" size={14} color={ModernTheme.colors.primary[700]} />
                          <Text style={styles.projectStatText}>{volunteerCount}</Text>
                        </View>
                        <View style={[styles.projectStatusBadge, { backgroundColor: `${statusColor}15`, borderColor: statusColor }]}>
                          <Text style={[styles.projectStatusText, { color: statusColor }]}>{project.status}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {trackedProjects.length > 10 && (
                  <Text style={styles.trackingFooterHint}>
                    Showing 10 of {trackedProjects.length} projects • View full list in Projects screen
                  </Text>
                )}
              </View>
            );
          })()}
        </View>

        {/* PARTNER SECTORS BY QUARTER */}
        <View style={styles.sectorsByQuarterCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>PARTNER SECTORS BY QUARTER</Text>
              <Text style={styles.cardSubtitle}>New partner organizations grouped by creation quarter</Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.sectorTable}>
              {/* Table Header */}
              <View style={styles.sectorTableRow}>
                <View style={[styles.sectorTableCell, styles.sectorTableHeaderCell, styles.sectorTableFirstColumn]}>
                  <Text style={styles.sectorTableHeaderText}>Quarter</Text>
                </View>
                <View style={[styles.sectorTableCell, styles.sectorTableHeaderCell]}>
                  <Text style={styles.sectorTableHeaderText}>NGO</Text>
                </View>
                <View style={[styles.sectorTableCell, styles.sectorTableHeaderCell]}>
                  <Text style={styles.sectorTableHeaderText}>Hospital</Text>
                </View>
                <View style={[styles.sectorTableCell, styles.sectorTableHeaderCell]}>
                  <Text style={styles.sectorTableHeaderText}>Institution</Text>
                </View>
                <View style={[styles.sectorTableCell, styles.sectorTableHeaderCell]}>
                  <Text style={styles.sectorTableHeaderText}>Private</Text>
                </View>
              </View>

              {/* Table Rows */}
              {partnerSectorsByQuarter.map((row, index) => (
                <View key={row.quarter} style={[styles.sectorTableRow, index % 2 === 1 && styles.sectorTableRowAlt]}>
                  <View style={[styles.sectorTableCell, styles.sectorTableFirstColumn]}>
                    <Text style={styles.sectorTableQuarterText}>{row.quarter}</Text>
                  </View>
                  <View style={styles.sectorTableCell}>
                    <Text style={styles.sectorTableValueText}>{row.NGO}</Text>
                  </View>
                  <View style={styles.sectorTableCell}>
                    <Text style={styles.sectorTableValueText}>{row.Hospital}</Text>
                  </View>
                  <View style={styles.sectorTableCell}>
                    <Text style={styles.sectorTableValueText}>{row.Institution}</Text>
                  </View>
                  <View style={styles.sectorTableCell}>
                    <Text style={styles.sectorTableValueText}>{row.Private}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.footerStats}>
          <Text style={styles.footerStat}>Event reports: {filteredReports.length}</Text>
          <Text style={styles.footerStat}>Completed volunteer hours: {completedHours}</Text>
          <Text style={styles.footerStat}>Tracked events: {filteredProjects.filter(project => project.isEvent).length}</Text>
        </View>
      </ScrollView>

      {/* Generate Report Modal */}
      <Modal
        visible={showReportModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowReportModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowReportModal(false)}
        >
          <TouchableOpacity
            style={styles.reportModalContent}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.reportModalHeader}>
              <MaterialIcons name="picture-as-pdf" size={32} color={ModernTheme.colors.primary[700]} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.reportModalTitle}>Generate Analytics PDF Report</Text>
                <Text style={styles.reportModalSubtitle}>Select the sections to include in your generated report</Text>
              </View>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <MaterialIcons name="close" size={24} color={ModernTheme.colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.reportOptions}>
              {/* Full Executive Report */}
              <TouchableOpacity
                style={[styles.reportOption, selectedReportSections.includes('full') && styles.reportOptionSelected]}
                onPress={() => setSelectedReportSections(['full'])}
                activeOpacity={0.7}
              >
                <View style={[styles.reportOptionRadio, selectedReportSections.includes('full') && styles.reportOptionRadioSelected]}>
                  {selectedReportSections.includes('full') && (
                    <View style={styles.reportOptionRadioInner} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportOptionTitle}>Full Executive Analytics Report</Text>
                  <Text style={styles.reportOptionDesc}>All sections including volunteer report, event participation, skills directory, partner sectors, and statistical breakdowns</Text>
                </View>
              </TouchableOpacity>

              {/* Custom Selection */}
              <TouchableOpacity
                style={[styles.reportOption, selectedReportSections.length > 1 || (selectedReportSections.length === 1 && selectedReportSections[0] !== 'full') ? styles.reportOptionSelected : null]}
                onPress={() => setSelectedReportSections([])}
                activeOpacity={0.7}
              >
                <View style={[styles.reportOptionRadio, selectedReportSections.length > 1 || (selectedReportSections.length === 1 && selectedReportSections[0] !== 'full') ? styles.reportOptionRadioSelected : null]}>
                  {(selectedReportSections.length > 1 || (selectedReportSections.length === 1 && selectedReportSections[0] !== 'full')) && (
                    <View style={styles.reportOptionRadioInner} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportOptionTitle}>Custom Selection</Text>
                  <Text style={styles.reportOptionDesc}>Choose specific sections below</Text>
                </View>
              </TouchableOpacity>

              {/* Individual Sections */}
              {['volunteers', 'events', 'skills', 'partners', 'projects'].map((section) => {
                const isDisabled = selectedReportSections.includes('full');
                const isSelected = selectedReportSections.includes(section);
                const sectionTitles = {
                  volunteers: '1. Total Volunteers Growth',
                  events: '2. Volunteers Per Event',
                  skills: '3. Skills Contributed',
                  partners: '4. Partner Sectors by Quarter',
                  projects: '5. Project Status Overview'
                };
                const sectionDescs = {
                  volunteers: '12-month cumulative growth curve with completed metrics of registered volunteers and onboard',
                  events: 'All breakout events and full volunteer names for each event',
                  skills: 'Skill distribution metrics and complete volunteer-to-skill directory',
                  partners: 'Quarterly breakdown of NGO, Hospital, Institution, Private partners and full organization directory',
                  projects: 'Filtered project breakdown across Planning, In Progress, On Hold, Completed, and Cancelled'
                };

                return (
                  <TouchableOpacity
                    key={section}
                    style={[styles.reportOptionIndent, isSelected && !isDisabled && styles.reportOptionSelected, isDisabled && styles.reportOptionDisabled]}
                    onPress={() => {
                      if (isDisabled) return;
                      setSelectedReportSections(prev => {
                        if (prev.includes(section)) {
                          return prev.filter(s => s !== section);
                        } else {
                          return [...prev.filter(s => s !== 'full'), section];
                        }
                      });
                    }}
                    activeOpacity={isDisabled ? 1 : 0.7}
                    disabled={isDisabled}
                  >
                    <View style={[styles.reportOptionCheckbox, isSelected && !isDisabled && styles.reportOptionCheckboxSelected]}>
                      {isSelected && !isDisabled && (
                        <MaterialIcons name="check" size={16} color="#fff" />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reportOptionTitle, isDisabled && styles.reportOptionTextDisabled]}>{sectionTitles[section as keyof typeof sectionTitles]}</Text>
                      <Text style={[styles.reportOptionDesc, isDisabled && styles.reportOptionTextDisabled]}>{sectionDescs[section as keyof typeof sectionDescs]}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.reportModalFooter}>
              <TouchableOpacity
                style={styles.reportCancelButton}
                onPress={() => setShowReportModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.reportCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.reportGenerateButton}
                onPress={async () => {
                  try {
                    const sections = selectedReportSections.includes('full') 
                      ? ['volunteers', 'events', 'skills', 'partners', 'projects']
                      : selectedReportSections.filter(s => s !== 'full');
                    
                    if (sections.length === 0) {
                      Alert.alert('No Sections Selected', 'Please select at least one section to include in the report.');
                      return;
                    }

                    setShowReportModal(false);

                    // Generate PDF content as HTML
                    const htmlContent = generatePDFReportHTML(
                      sections,
                      {
                        volunteers: filteredVolunteers,
                        projects: filteredProjects,
                        partners: partners,
                        reports: filteredReports,
                        timeLogs: filteredTimeLogs,
                        joinRecords: filteredJoinRecords,
                        applications: partnerApplications,
                      },
                      {
                        partnerFilter: selectedPartnerId,
                        programFilter: selectedProgramId,
                        metrics: projectMetrics,
                        volunteerGrowthData: monthPoints,
                        skillAnalytics,
                        quarterlyPartnerData: partnerSectorsByQuarter,
                      }
                    );

                    // Open report in a new popup tab for viewing/printing
                    if (Platform.OS === 'web') {
                      // Inject a print button into the HTML
                      const printButtonHtml = `
                        <div style="position:fixed;top:16px;right:24px;z-index:9999;display:flex;gap:12px;">
                          <button onclick="window.print()" style="background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px 22px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.18);">
                            🖨️ Print / Save as PDF
                          </button>
                          <button onclick="window.close()" style="background:#6b7280;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:15px;font-weight:600;cursor:pointer;">
                            ✕ Close
                          </button>
                        </div>`;
                      const fullHtml = htmlContent.replace('<body>', '<body>' + printButtonHtml);
                      const blob = new Blob([fullHtml], { type: 'text/html' });
                      const url = URL.createObjectURL(blob);
                      const popup = window.open(url, '_blank', 'width=1100,height=800,scrollbars=yes,resizable=yes');
                      if (!popup) {
                        // Fallback: download if popup was blocked
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `Analytics_Report_${new Date().toISOString().split('T')[0]}.html`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        Alert.alert('Popup Blocked', 'Please allow popups for this site, then try again. The report was downloaded as a fallback.');
                      }
                      // Revoke after a delay so the popup can load
                      setTimeout(() => URL.revokeObjectURL(url), 60000);
                    } else {
                      Alert.alert('Report Ready', 'Report generation is optimized for the web version. Please use the web app for the best experience.');
                    }
                  } catch (error) {
                    console.error('PDF generation error:', error);
                    Alert.alert('Error', 'Failed to generate report. Please try again.');
                  }
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="download" size={20} color="#fff" />
                <Text style={styles.reportGenerateButtonText}>Download PDF Report</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ModernTheme.colors.background.secondary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ModernTheme.colors.background.secondary,
  },
  scrollContent: {
    padding: ModernTheme.spacing[5],
    gap: ModernTheme.spacing[4],
  },
  // Filter Selectors styles
  filtersContainer: {
    flexDirection: 'row',
    gap: ModernTheme.spacing[3],
    flexWrap: 'wrap',
  },
  filterCard: {
    flex: 1,
    minWidth: 280,
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[4],
    ...ModernTheme.shadows.base,
    position: 'relative',
    zIndex: 1000,
  },
  // Partner Selector styles (reused for program)
  partnerSelectorCard: {
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[4],
    ...ModernTheme.shadows.base,
    position: 'relative',
    zIndex: 1000,
  },
  selectorLabel: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.secondary,
    marginBottom: ModernTheme.spacing[2],
  },
  partnerDropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[2],
    paddingHorizontal: ModernTheme.spacing[3],
    paddingVertical: ModernTheme.spacing[2.5],
    backgroundColor: ModernTheme.colors.background.tertiary,
    borderRadius: ModernTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: ModernTheme.colors.primary[200],
    ...ModernTheme.shadows.sm,
  },
  partnerDropdownText: {
    flex: 1,
    fontSize: ModernTheme.typography.fontSize.md,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.primary,
  },
  partnerDropdownMenu: {
    marginTop: ModernTheme.spacing[2],
    borderRadius: ModernTheme.borderRadius.md,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 1.5,
    borderColor: ModernTheme.colors.neutral[200],
    ...ModernTheme.shadows.lg,
    maxHeight: 300,
    overflow: 'scroll',
  },
  partnerDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[2],
    paddingHorizontal: ModernTheme.spacing[3],
    paddingVertical: ModernTheme.spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: ModernTheme.colors.neutral[100],
  },
  partnerDropdownItemActive: {
    backgroundColor: ModernTheme.colors.primary[50],
  },
  partnerDropdownItemText: {
    flex: 1,
    fontSize: ModernTheme.typography.fontSize.md,
    fontWeight: ModernTheme.typography.fontWeight.medium,
    color: ModernTheme.colors.text.secondary,
  },
  partnerDropdownItemTextActive: {
    color: ModernTheme.colors.primary[700],
    fontWeight: ModernTheme.typography.fontWeight.semibold,
  },
  // Partner Sectors by Quarter styles
  sectorsByQuarterCard: {
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[5],
    ...ModernTheme.shadows.base,
  },
  sectorTable: {
    minWidth: 600,
    marginTop: ModernTheme.spacing[3],
  },
  sectorTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: ModernTheme.colors.neutral[200],
  },
  sectorTableRowAlt: {
    backgroundColor: ModernTheme.colors.background.tertiary,
  },
  sectorTableCell: {
    flex: 1,
    paddingVertical: ModernTheme.spacing[3],
    paddingHorizontal: ModernTheme.spacing[4],
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 120,
  },
  sectorTableFirstColumn: {
    alignItems: 'flex-start',
    minWidth: 100,
  },
  sectorTableHeaderCell: {
    backgroundColor: ModernTheme.colors.primary[700],
    borderBottomWidth: 0,
  },
  sectorTableHeaderText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.inverse,
    textTransform: 'uppercase',
    letterSpacing: ModernTheme.typography.letterSpacing.wide,
  },
  sectorTableQuarterText: {
    fontSize: ModernTheme.typography.fontSize.md,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
  },
  sectorTableValueText: {
    fontSize: ModernTheme.typography.fontSize.md,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.secondary,
  },
  // Project Metrics Overview styles
  metricsOverviewCard: {
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[5],
    ...ModernTheme.shadows.base,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ModernTheme.spacing[3],
    marginTop: ModernTheme.spacing[4],
  },
  metricBox: {
    flex: 1,
    minWidth: 200,
    padding: ModernTheme.spacing[4],
    backgroundColor: ModernTheme.colors.background.tertiary,
    borderRadius: ModernTheme.borderRadius.md,
    alignItems: 'center',
    ...ModernTheme.shadows.xs,
  },
  metricIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ModernTheme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: ModernTheme.spacing[3],
  },
  metricValue: {
    fontSize: 32,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
    marginBottom: ModernTheme.spacing[1],
  },
  metricLabel: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: ModernTheme.spacing[1],
  },
  metricSubtext: {
    fontSize: ModernTheme.typography.fontSize.xs,
    color: ModernTheme.colors.text.tertiary,
    textAlign: 'center',
  },
  chartCard: {
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[5],
    ...ModernTheme.shadows.base,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: ModernTheme.spacing[3],
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: ModernTheme.typography.fontSize.xl,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
    letterSpacing: ModernTheme.typography.letterSpacing.tight,
  },
  cardSubtitle: {
    marginTop: ModernTheme.spacing[1],
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.secondary,
    fontWeight: ModernTheme.typography.fontWeight.medium,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[2],
    paddingTop: ModernTheme.spacing[2.5],
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.primary[600],
  },
  legendText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.secondary,
  },
  metricStrip: {
    marginTop: ModernTheme.spacing[3.5],
    minHeight: 42,
    borderRadius: ModernTheme.borderRadius.md,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: ModernTheme.colors.background.tertiary,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: ModernTheme.spacing[2.5],
    paddingHorizontal: ModernTheme.spacing[3],
    paddingVertical: ModernTheme.spacing[2],
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[1.5],
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.background.card,
    paddingHorizontal: ModernTheme.spacing[2.5],
    paddingVertical: ModernTheme.spacing[1.5],
    ...ModernTheme.shadows.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.accent[400],
  },
  liveText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
  },
  totalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[1.5],
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.primary[600],
    paddingHorizontal: ModernTheme.spacing[3],
    paddingVertical: ModernTheme.spacing[1.5],
    ...ModernTheme.shadows.sm,
  },
  totalPillText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.inverse,
  },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[1.5],
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.primary[100],
    paddingHorizontal: ModernTheme.spacing[3],
    paddingVertical: ModernTheme.spacing[1.5],
  },
  deltaPillText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.primary[800],
  },
  inspectHint: {
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.tertiary,
    fontStyle: 'italic',
  },
  lineChart: {
    marginTop: 10,
    alignSelf: 'center',
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: '#d9e7cc',
  },
  axisLabel: {
    position: 'absolute',
    left: -18,
    top: -8,
    fontSize: 11,
    color: '#8a967f',
    fontWeight: '700',
  },
  lineSegment: {
    position: 'absolute',
    height: 3,
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.primary[600],
  },
  chartPoint: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 3,
    borderColor: ModernTheme.colors.primary[600],
  },
  monthLabel: {
    position: 'absolute',
    width: 36,
    textAlign: 'center',
    fontSize: ModernTheme.typography.fontSize.xs,
    color: ModernTheme.colors.text.secondary,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
  },
  lowerGrid: {
    flexDirection: 'row',
    gap: ModernTheme.spacing[3.5],
    alignItems: 'stretch',
  },
  lowerGridStacked: {
    flexDirection: 'column',
  },
  heatmapCard: {
    flex: 2,
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[5],
    ...ModernTheme.shadows.base,
  },
  skillsCard: {
    flex: 0.95,
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[5],
    ...ModernTheme.shadows.base,
  },
  fullWidthCard: {
    width: '100%',
  },
  heatLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: 8,
  },
  heatLegendText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#596074',
  },
  heatLegendSwatch: {
    width: 16,
    height: 16,
    borderRadius: 5,
  },
  previewHint: {
    marginTop: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#dce8d3',
    backgroundColor: '#f5f9f1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: '#8a99a7',
    fontStyle: 'italic',
  },
  emptyState: {
    minHeight: 168,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.secondary,
  },
  heatmapTableWrapper: {
    position: 'relative',
  },
  heatmapTable: {
    marginTop: 12,
    minWidth: 720,
  },
  heatmapHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  eventNameSpacer: {
    width: 165,
  },
  weekHeader: {
    width: 58,
    alignItems: 'center',
  },
  weekLabel: {
    fontSize: 12,
    color: '#4f566a',
    fontWeight: '900',
  },
  weekSubLabel: {
    marginTop: 3,
    fontSize: 9,
    color: '#8a99a7',
    fontWeight: '700',
  },
  heatmapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  eventNameCell: {
    width: 165,
    paddingRight: 12,
  },
  eventName: {
    fontSize: 12,
    color: '#344051',
    fontWeight: '900',
  },
  eventJoined: {
    marginTop: 3,
    fontSize: 10,
    color: '#7b8798',
    fontWeight: '700',
  },
  heatCell: {
    width: 54,
    height: 42,
    borderRadius: 5,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hoverTarget: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
  },
  tooltip: {
    position: 'absolute',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#ffffffcc',
    borderWidth: 1,
    borderColor: '#d1ddc6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 10,
  },
  tooltipLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#223a23',
  },
  tooltipValue: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '900',
    color: '#4b7d3c',
  },
  tooltipNames: {
    marginTop: 6,
    fontSize: 11,
    color: '#3b4d3a',
    fontWeight: '700',
    lineHeight: 16,
  },
  heatCellText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '900',
  },
  skillsBody: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  donutWrap: {
    alignItems: 'center',
    minWidth: 190,
  },
  donutOuter: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: '#dfe8d6',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mobileDonutBand: {
    position: 'absolute',
    width: 84,
    height: 168,
    left: 84,
    top: 0,
    opacity: 0.9,
  },
  donutInner: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutNumber: {
    fontSize: 34,
    lineHeight: 36,
    color: '#262b3d',
    fontWeight: '900',
  },
  donutLabel: {
    marginTop: 3,
    fontSize: 12,
    color: '#596074',
    fontWeight: '800',
  },
  donutMeta: {
    marginTop: 12,
    fontSize: 12,
    color: '#6a7182',
    fontWeight: '800',
    textAlign: 'center',
  },
  skillList: {
    flex: 1,
    minWidth: 220,
    gap: 10,
  },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  skillDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  skillName: {
    flex: 1,
    fontSize: 12,
    color: '#344051',
    fontWeight: '900',
  },
  skillValue: {
    fontSize: 12,
    color: '#6a7182',
    fontWeight: '900',
  },
  footerStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ModernTheme.spacing[2.5],
    paddingBottom: ModernTheme.spacing[1],
  },
  footerStat: {
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingHorizontal: ModernTheme.spacing[3],
    paddingVertical: ModernTheme.spacing[1.5],
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.secondary,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    ...ModernTheme.shadows.sm,
  },
  // Project Status Overview styles
  statusOverviewCard: {
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[5],
    ...ModernTheme.shadows.base,
  },
  statusList: {
    marginTop: ModernTheme.spacing[3],
    gap: ModernTheme.spacing[2],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: ModernTheme.spacing[3],
    paddingHorizontal: ModernTheme.spacing[4],
    backgroundColor: ModernTheme.colors.background.tertiary,
    borderRadius: ModernTheme.borderRadius.md,
    marginBottom: 0,
    ...ModernTheme.shadows.xs,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[3],
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: ModernTheme.borderRadius.full,
    ...ModernTheme.shadows.sm,
  },
  statusLabel: {
    fontSize: ModernTheme.typography.fontSize.md,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.primary,
  },
  statusCount: {
    fontSize: ModernTheme.typography.fontSize.lg,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
  },
  // Projects Tracking styles
  trackingCard: {
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.card,
    borderWidth: 0,
    borderColor: 'transparent',
    padding: ModernTheme.spacing[5],
    ...ModernTheme.shadows.base,
  },
  trackingHeader: {
    gap: ModernTheme.spacing[3],
  },
  trackingFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ModernTheme.spacing[2],
    marginTop: ModernTheme.spacing[2],
  },
  filterChip: {
    paddingHorizontal: ModernTheme.spacing[3],
    paddingVertical: ModernTheme.spacing[1.5],
    borderRadius: ModernTheme.borderRadius.full,
    backgroundColor: ModernTheme.colors.neutral[100],
    borderWidth: 0,
    borderColor: 'transparent',
    ...ModernTheme.shadows.xs,
  },
  filterChipActive: {
    backgroundColor: ModernTheme.colors.primary[600],
    borderColor: ModernTheme.colors.primary[600],
    ...ModernTheme.shadows.sm,
  },
  filterChipText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.secondary,
  },
  filterChipTextActive: {
    color: ModernTheme.colors.text.inverse,
  },
  emptyTrackingState: {
    alignItems: 'center',
    paddingVertical: ModernTheme.spacing[12],
    gap: ModernTheme.spacing[3],
  },
  projectTrackingList: {
    marginTop: ModernTheme.spacing[4],
    gap: ModernTheme.spacing[2],
  },
  projectTrackingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: ModernTheme.spacing[3],
    paddingHorizontal: ModernTheme.spacing[4],
    backgroundColor: ModernTheme.colors.background.tertiary,
    borderRadius: ModernTheme.borderRadius.md,
    gap: ModernTheme.spacing[3],
    ...ModernTheme.shadows.xs,
  },
  projectTrackingMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[3],
  },
  projectStatusIndicator: {
    width: 4,
    height: 40,
    borderRadius: ModernTheme.borderRadius.sm,
  },
  projectTrackingInfo: {
    flex: 1,
  },
  projectTrackingTitle: {
    fontSize: ModernTheme.typography.fontSize.md,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.text.primary,
    marginBottom: ModernTheme.spacing[1],
  },
  projectTrackingMeta: {
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.secondary,
    fontWeight: ModernTheme.typography.fontWeight.medium,
  },
  partnerOrgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[1],
    marginTop: ModernTheme.spacing[1],
    paddingHorizontal: ModernTheme.spacing[2],
    paddingVertical: ModernTheme.spacing[0.5],
    backgroundColor: ModernTheme.colors.accent[50],
    borderRadius: ModernTheme.borderRadius.sm,
    alignSelf: 'flex-start',
  },
  partnerOrgText: {
    fontSize: ModernTheme.typography.fontSize.xs,
    color: ModernTheme.colors.accent[700],
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    maxWidth: 200,
  },
  projectTrackingStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[2],
  },
  projectStatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[1],
    paddingHorizontal: ModernTheme.spacing[2],
    paddingVertical: ModernTheme.spacing[1],
    backgroundColor: ModernTheme.colors.primary[50],
    borderRadius: ModernTheme.borderRadius.sm,
  },
  projectStatText: {
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
    color: ModernTheme.colors.primary[700],
  },
  projectStatusBadge: {
    paddingHorizontal: ModernTheme.spacing[2.5],
    paddingVertical: ModernTheme.spacing[1],
    borderRadius: ModernTheme.borderRadius.full,
    borderWidth: 1.5,
  },
  projectStatusText: {
    fontSize: ModernTheme.typography.fontSize.xs,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: ModernTheme.typography.letterSpacing.wide,
  },
  trackingFooterHint: {
    marginTop: ModernTheme.spacing[3],
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.secondary,
    fontWeight: ModernTheme.typography.fontWeight.medium,
    textAlign: 'center',
  },
  // Generate Report Button styles
  exportButtonsContainer: {
    flexDirection: 'row',
    gap: ModernTheme.spacing[2],
  },
  exportCSVButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: ModernTheme.colors.primary[700],
    paddingHorizontal: ModernTheme.spacing[4],
    paddingVertical: ModernTheme.spacing[2.5],
    borderRadius: ModernTheme.borderRadius.md,
    gap: ModernTheme.spacing[2],
  },
  exportCSVButtonText: {
    color: ModernTheme.colors.primary[700],
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.bold,
  },
  generateReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ModernTheme.colors.primary[700],
    paddingHorizontal: ModernTheme.spacing[4],
    paddingVertical: ModernTheme.spacing[2.5],
    borderRadius: ModernTheme.borderRadius.md,
    gap: ModernTheme.spacing[2],
    ...ModernTheme.shadows.md,
  },
  generateReportButtonText: {
    color: '#fff',
    fontSize: ModernTheme.typography.fontSize.sm,
    fontWeight: ModernTheme.typography.fontWeight.bold,
  },
  // Report Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: ModernTheme.spacing[4],
  },
  reportModalContent: {
    backgroundColor: ModernTheme.colors.background.card,
    borderRadius: ModernTheme.borderRadius.xl,
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%',
    ...ModernTheme.shadows.xl,
  },
  reportModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: ModernTheme.spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: ModernTheme.colors.border.medium,
  },
  reportModalTitle: {
    fontSize: ModernTheme.typography.fontSize.xl,
    fontWeight: ModernTheme.typography.fontWeight.extrabold,
    color: ModernTheme.colors.text.primary,
    marginBottom: ModernTheme.spacing[1],
  },
  reportModalSubtitle: {
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.secondary,
  },
  reportOptions: {
    padding: ModernTheme.spacing[5],
    maxHeight: 450,
  },
  reportOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: ModernTheme.spacing[4],
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.tertiary,
    marginBottom: ModernTheme.spacing[3],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reportOptionSelected: {
    backgroundColor: ModernTheme.colors.primary[50],
    borderColor: ModernTheme.colors.primary[700],
  },
  reportOptionDisabled: {
    opacity: 0.4,
  },
  reportOptionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: ModernTheme.colors.border.medium,
    marginRight: ModernTheme.spacing[3],
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  reportOptionRadioSelected: {
    borderColor: ModernTheme.colors.primary[700],
  },
  reportOptionRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ModernTheme.colors.primary[700],
  },
  reportOptionCheckbox: {
    width: 20,
    height: 20,
    borderRadius: ModernTheme.borderRadius.sm,
    borderWidth: 2,
    borderColor: ModernTheme.colors.border.medium,
    marginRight: ModernTheme.spacing[3],
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  reportOptionCheckboxSelected: {
    backgroundColor: ModernTheme.colors.primary[700],
    borderColor: ModernTheme.colors.primary[700],
  },
  reportOptionIndent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: ModernTheme.spacing[4],
    paddingLeft: ModernTheme.spacing[6],
    borderRadius: ModernTheme.borderRadius.lg,
    backgroundColor: ModernTheme.colors.background.tertiary,
    marginBottom: ModernTheme.spacing[2],
    marginLeft: ModernTheme.spacing[4],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reportOptionTitle: {
    fontSize: ModernTheme.typography.fontSize.base,
    fontWeight: ModernTheme.typography.fontWeight.bold,
    color: ModernTheme.colors.text.primary,
    marginBottom: ModernTheme.spacing[1],
  },
  reportOptionDesc: {
    fontSize: ModernTheme.typography.fontSize.sm,
    color: ModernTheme.colors.text.secondary,
    lineHeight: 20,
  },
  reportOptionTextDisabled: {
    opacity: 0.6,
  },
  reportModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: ModernTheme.spacing[3],
    padding: ModernTheme.spacing[5],
    borderTopWidth: 1,
    borderTopColor: ModernTheme.colors.border.medium,
  },
  reportCancelButton: {
    paddingHorizontal: ModernTheme.spacing[5],
    paddingVertical: ModernTheme.spacing[3],
    borderRadius: ModernTheme.borderRadius.md,
    backgroundColor: ModernTheme.colors.background.tertiary,
  },
  reportCancelButtonText: {
    color: ModernTheme.colors.text.primary,
    fontSize: ModernTheme.typography.fontSize.base,
    fontWeight: ModernTheme.typography.fontWeight.semibold,
  },
  reportGenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ModernTheme.spacing[2],
    paddingHorizontal: ModernTheme.spacing[5],
    paddingVertical: ModernTheme.spacing[3],
    borderRadius: ModernTheme.borderRadius.md,
    backgroundColor: ModernTheme.colors.primary[700],
    ...ModernTheme.shadows.md,
  },
  reportGenerateButtonText: {
    color: '#fff',
    fontSize: ModernTheme.typography.fontSize.base,
    fontWeight: ModernTheme.typography.fontWeight.bold,
  },
});

