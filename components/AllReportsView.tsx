import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Image, Platform, Alert, Modal, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { SubmittedReport } from '../screens/ReportsScreen';
import type { Project, VolunteerTimeLog, Volunteer } from '../models/types';
import { downloadPhotoBatch, getAttachmentUris, isImageMediaUri, type PhotoBatchDownloadItem } from '../utils/media';
import { buildTablePdf, downloadPdfFile } from '../utils/pdfDownload';
import type { PdfTable } from '../utils/pdfDownload';
import { getAttendanceReportMetrics } from '../utils/attendanceReportMetrics';
import DownloadPreviewModal from './DownloadPreviewModal';

interface Props {
  reports: SubmittedReport[];
  projects: Project[];
  volunteerTimeLogs?: VolunteerTimeLog[];
  volunteers?: Volunteer[];
  onViewReport: (report: SubmittedReport) => void;
  onUploadReport?: () => void;
  reportType?: 'all' | 'volunteer' | 'partner';
}

function initials(name: string) {
  const parts = (name || 'U').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || 'U').toUpperCase();
}
function avatarBg(name: string) {
  const colors = ['#FDE68A', '#BFDBFE', '#FECACA', '#D1FAE5', '#DDD6FE', '#FED7AA', '#FBCFE8', '#C7D2FE'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
  return colors[h];
}
function avatarTextColor(bg: string) {
  // dark text on light bg
  return '#1F2937';
}
function fileIcon(report: SubmittedReport) {
  const title = (report.title || '').toLowerCase();
  const hasPdf = title.endsWith('.pdf') || report.attachments?.some(a => a.url.toLowerCase().endsWith('.pdf'));
  const hasDocx = title.endsWith('.docx') || title.endsWith('.doc');
  const hasJpg = Boolean(
    title.endsWith('.jpg') ||
      title.endsWith('.jpeg') ||
      title.endsWith('.png') ||
      report.hasMediaFile ||
      report.attachments?.some(a => a.type === 'image') ||
      isImageMediaUri(report.mediaFile || '')
  );
  if (hasPdf) return { bg: '#FEE2E2', icon: 'picture-as-pdf' as const, color: '#DC2626', label: 'Pdf' };
  if (hasDocx) return { bg: '#DBEAFE', icon: 'description' as const, color: '#1D4ED8', label: 'W' };
  if (hasJpg) return { bg: '#DCFCE7', icon: 'image' as const, color: '#16A34A', label: 'Img' };
  return { bg: '#FEE2E2', icon: 'picture-as-pdf' as const, color: '#DC2626', label: 'Pdf' };
}
function extIconBg(report: SubmittedReport) {
  return fileIcon(report);
}

function reportFolderKey(report: SubmittedReport): string {
  return report.projectId || report.projectTitle || report.category || 'uncategorized';
}

function photoFolderKey(report: SubmittedReport): string {
  return report.projectId || 'photos';
}

function isAttendanceReport(report: SubmittedReport): boolean {
  return report.reportType === 'attendance_report';
}

type AttachmentFilter = 'all' | 'photos' | 'videos' | 'documents' | 'other' | 'none';

type ReportDownloadPreview = {
  title: string;
  subtitle: string;
  totalRows: number;
  recordCount?: number;
  previewRows: Array<Record<string, string>>;
  columns: string[];
  previewTables?: PdfTable[];
  documentTitle?: string;
  documentSubtitle?: string;
  fileName: string;
  pdf?: string;
  photoItems?: PhotoBatchDownloadItem[];
  errorMessage: string;
};

const DOCUMENT_FILE_PATTERN = /\.(pdf|doc|docx|xls|xlsx|csv)(?:$|[?#])/i;
const VIDEO_FILE_PATTERN = /\.(mp4|mov|m4v|avi|webm|3gp|mkv)(?:$|[?#])/i;

function reportAttachments(report: SubmittedReport) {
  return (report.attachments || []).filter(
    attachment => Boolean(attachment && typeof attachment.url === 'string' && attachment.url.trim())
  );
}

function getReportPhotoUris(report: SubmittedReport): string[] {
  return getAttachmentUris([
    report.mediaFile || '',
    ...(report.attachments || []),
  ]).filter(isImageMediaUri);
}

function safePhotoFilenamePart(value: string | undefined, fallback: string): string {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70) || fallback;
}

function getPhotoExtension(uri: string): string {
  const dataMime = uri.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1];
  if (dataMime) {
    const normalized = dataMime.toLowerCase();
    return normalized === 'jpeg' ? 'jpg' : normalized.split('+')[0];
  }
  const extension = uri.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  const supportedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif']);
  return extension && supportedExtensions.has(extension) ? extension : 'jpg';
}

function buildPhotoDownloadItem(report: SubmittedReport, uri: string, photoIndex: number): PhotoBatchDownloadItem {
  const submittedDate = new Date(report.submittedAt || '');
  const dateKey = Number.isNaN(submittedDate.getTime())
    ? 'undated'
    : submittedDate.toISOString().slice(0, 10);
  const volunteer = safePhotoFilenamePart(report.submitterName, 'volunteer');
  const event = safePhotoFilenamePart(report.projectTitle, 'event');
  const extension = getPhotoExtension(uri);
  return {
    uri,
    filename: `${volunteer}-${event}-${dateKey}-${photoIndex + 1}.${extension}`,
  };
}

function reportHasPhoto(report: SubmittedReport): boolean {
  return getReportPhotoUris(report).length > 0;
}

function reportHasVideo(report: SubmittedReport): boolean {
  return Boolean(
    reportAttachments(report).some(
      attachment => attachment.type === 'video' || VIDEO_FILE_PATTERN.test(attachment.url)
    ) ||
      VIDEO_FILE_PATTERN.test(report.mediaFile || '')
  );
}

function reportHasDocument(report: SubmittedReport): boolean {
  return Boolean(
    reportAttachments(report).some(
      attachment => attachment.type === 'document' || DOCUMENT_FILE_PATTERN.test(attachment.url)
    ) ||
      DOCUMENT_FILE_PATTERN.test(report.title || '') ||
      DOCUMENT_FILE_PATTERN.test(report.mediaFile || '')
  );
}

function reportHasAttachment(report: SubmittedReport): boolean {
  return Boolean(
    report.hasMediaFile ||
      report.hasAttachments ||
      (report.mediaFile || '').trim() ||
      reportAttachments(report).length
  );
}

function reportHasOtherAttachment(report: SubmittedReport): boolean {
  return Boolean(
    reportHasAttachment(report) &&
      !reportHasPhoto(report) &&
      !reportHasVideo(report) &&
      !reportHasDocument(report)
  );
}

function formatReportDateTime(value?: string): string {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Unknown date';
}

function formatMetricLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, character => character.toUpperCase());
}

function getReportActivityTitle(report: SubmittedReport, projectById: Map<string, Project>): string {
  const project = report.projectId ? projectById.get(report.projectId) : undefined;
  return project?.title || report.projectTitle || report.category || 'Unlinked activity';
}

function getReportAttachmentSummary(report: SubmittedReport): string {
  const attachmentTypes = [
    ...(report.attachments || []).map(attachment => attachment.type || 'attachment'),
    ...(report.mediaFile ? ['media'] : []),
  ];
  return attachmentTypes.length ? Array.from(new Set(attachmentTypes)).join(', ') : 'None';
}

function buildSingleReportPdf(
  report: SubmittedReport,
  projectById: Map<string, Project>,
): string {
  return buildTablePdf(report.title || 'Report', {
    subtitle: `Generated report export - ${formatReportDateTime(report.submittedAt)}`,
    orientation: 'portrait',
    tables: buildSingleReportTables(report, projectById),
  });
}

function buildSingleReportTables(
  report: SubmittedReport,
  projectById: Map<string, Project>,
): PdfTable[] {
  const metricRows = Object.entries(report.metrics || {})
    .filter(([metric]) => (
      metric !== 'volunteerHours'
      && metric !== 'beneficiariesServed'
      && metric !== 'attendanceHours'
    ))
    .map(([metric, value]) => ({
      metric: formatMetricLabel(metric),
      value,
    }));

  return [
      {
        title: 'Report Details',
        columns: [
          { key: 'field', label: 'Field', width: 1 },
          { key: 'value', label: 'Value', width: 2.8 },
        ],
        rows: [
          { field: 'Title', value: report.title || 'Untitled report' },
          { field: 'Event / Project', value: getReportActivityTitle(report, projectById) },
          { field: 'Submitted by', value: report.submitterName || 'Unknown user' },
          { field: 'Status', value: report.status || 'Unknown' },
          { field: 'Submitted', value: formatReportDateTime(report.submittedAt) },
          { field: 'Attachments', value: getReportAttachmentSummary(report) },
        ],
      },
      {
        title: 'Description',
        columns: [{ key: 'description', label: 'Report narrative', width: 1, maxLines: 12 }],
        rows: [{ description: report.description || 'No description provided.' }],
      },
      {
        title: 'Metrics',
        columns: [
          { key: 'metric', label: 'Metric', width: 1.3 },
          { key: 'value', label: 'Value', width: 1 },
        ],
        rows: metricRows,
        emptyMessage: 'No metrics captured for this report.',
      },
  ];
}

function buildBatchReportTables(
  reports: SubmittedReport[],
  projectById: Map<string, Project>,
): PdfTable[] {
  const summaryRows = reports.map((report, index) => ({
    number: index + 1,
    title: report.title || 'Untitled report',
    activity: getReportActivityTitle(report, projectById),
    submitter: report.submitterName || 'Unknown user',
    status: report.status || 'Unknown',
    submitted: formatReportDateTime(report.submittedAt),
    attachments: getReportAttachmentSummary(report),
  }));
  const descriptionRows = reports.map((report, index) => ({
    number: index + 1,
    report: report.title || 'Untitled report',
    description: report.description || 'No description provided.',
  }));
  const metricKeys = Array.from(
    new Set(
      reports.flatMap(report =>
        Object.entries(report.metrics || {})
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([metric]) => metric)
      )
    )
  );
  const metricRows = reports.map((report, index) => {
    const row: Record<string, unknown> = {
      number: index + 1,
      report: report.title || 'Untitled report',
      submitter: report.submitterName || 'Unknown user',
    };
    metricKeys.forEach(metric => {
      row[`metric_${metric}`] = report.metrics?.[metric] ?? '-';
    });
    return row;
  });

  return [
    {
      title: 'Report Index',
      columns: [
        { key: 'number', label: '#', width: 0.35 },
        { key: 'title', label: 'Report', width: 1.35 },
        { key: 'activity', label: 'Event / Project', width: 1.35 },
        { key: 'submitter', label: 'Submitted By', width: 1.05 },
        { key: 'status', label: 'Status', width: 0.7 },
        { key: 'submitted', label: 'Submitted', width: 1.05 },
        { key: 'attachments', label: 'Attachments', width: 0.85 },
      ],
      rows: summaryRows,
    },
    {
      title: 'Report Narratives',
      columns: [
        { key: 'number', label: '#', width: 0.35 },
        { key: 'report', label: 'Report', width: 1.15 },
        { key: 'description', label: 'Description', width: 3.5, maxLines: 30 },
      ],
      rows: descriptionRows,
    },
    {
      title: 'Reported Metrics',
      columns: [
        { key: 'number', label: '#', width: 0.35 },
        { key: 'report', label: 'Report', width: 1.8 },
        { key: 'submitter', label: 'Submitted By', width: 1.1 },
        ...metricKeys.map(metric => ({
          key: `metric_${metric}`,
          label: formatMetricLabel(metric),
          width: 1,
        })),
      ],
      rows: metricRows,
      emptyMessage: 'No metrics were captured in this batch.',
    },
  ];
}

function buildBatchReportPdf(
  reports: SubmittedReport[],
  projectById: Map<string, Project>,
  title: string,
): string {
  return buildTablePdf(title, {
    subtitle: `${reports.length} report${reports.length === 1 ? '' : 's'} - Generated ${new Date().toLocaleString()}`,
    tables: buildBatchReportTables(reports, projectById),
  });
}

export default function AllReportsView({ reports, projects, volunteerTimeLogs = [], volunteers = [], onViewReport, onUploadReport, reportType = 'all' }: Props) {
  const { width: viewportWidth } = useWindowDimensions();
  const isNarrow = viewportWidth < 700;
  const [activeFilter, setActiveFilter] = useState<'All' | 'Events' | 'Photos'>('All');
  const [search, setSearch] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [attachmentFilter, setAttachmentFilter] = useState<AttachmentFilter>('all');
  const [selectedEventFolderKey, setSelectedEventFolderKey] = useState<string | null>(null);
  const [selectedPhotoFolderKey, setSelectedPhotoFolderKey] = useState<string | null>(null);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({
    tasks: false,
    attendance: false,
    photos: false,
  });

  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections(current => ({ ...current, [section]: !current[section] }));
  };
  const [downloadPreview, setDownloadPreview] = useState<ReportDownloadPreview | null>(null);
  const [photoPreview, setPhotoPreview] = useState<{
    uri: string;
    volunteerName: string;
    eventTitle: string;
    filename: string;
  } | null>(null);

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach(p => m.set(p.id, p));
    return m;
  }, [projects]);

  // Add one synthetic attendance report per canonical time-log.  The report
  // values come from the time-log itself; its photo is optional evidence.
  const allItems = useMemo(() => {
    const base = [...reports];
    const volunteerById = new Map((volunteers || []).map(v => [v.id, v]));
    (volunteerTimeLogs || []).forEach(log => {
      const timeIn = new Date(log.timeIn || '').getTime();
      if (!Number.isFinite(timeIn)) return;
      const photo = (log as any).attendancePhoto;
      const hasAttendancePhoto = Boolean(photo && isImageMediaUri(photo));
      const proj = log.projectId ? projectById.get(log.projectId) : undefined;
      const verified = Boolean((log as any).attendanceCheckedAt);
      const volunteer = volunteerById.get((log as any).volunteerId);
      const volunteerName = volunteer?.name || 'Volunteer';
      base.push({
        id: `timelog-${log.id}`,
        submittedBy: (log as any).volunteerId || volunteer?.userId || '',
        submitterName: volunteerName,
        submitterRole: 'volunteer' as const,
        reportType: 'attendance_report',
        title: verified ? `Verified Attendance - ${proj?.title || 'Event'}` : `Attendance Report - ${proj?.title || 'Event'}`,
        description: verified
          ? `Verified by ${(log as any).attendanceCheckedByName || 'Field Officer'} on ${new Date((log as any).attendanceCheckedAt).toLocaleDateString()}`
          : `Attendance recorded on ${new Date(log.timeIn).toLocaleDateString()}`,
        projectId: log.projectId,
        projectTitle: proj?.title || 'Attendance',
        projectKind: 'event' as const,
        category: proj?.category,
        metrics: getAttendanceReportMetrics(log),
        attachments: hasAttendancePhoto
          ? [{ url: photo, type: 'image' as const, description: 'Attendance Photo' }]
          : [],
        mediaFile: hasAttendancePhoto ? photo : undefined,
        hasAttachments: hasAttendancePhoto,
        hasMediaFile: hasAttendancePhoto,
        status: verified ? 'Approved' as const : 'Submitted' as const,
        submittedAt: (log as any).attendanceCheckedAt || log.timeIn || new Date().toISOString(),
        viewedBy: [],
      } as any);
    });
    return base;
  }, [reports, volunteerTimeLogs, projectById, volunteers]);

  const filterableItems = useMemo(
    () => allItems.filter(report => (report as any).status !== 'Rejected'),
    [allItems]
  );

  const attachmentFilterOptions = useMemo(() => {
    const options: { value: AttachmentFilter; label: string; count: number }[] = [
      { value: 'all', label: 'All reports', count: filterableItems.length },
      {
        value: 'photos',
        label: 'Has photos',
        count: filterableItems.filter(reportHasPhoto).length,
      },
      {
        value: 'videos',
        label: 'Has videos',
        count: filterableItems.filter(reportHasVideo).length,
      },
      {
        value: 'documents',
        label: 'Has documents',
        count: filterableItems.filter(reportHasDocument).length,
      },
      {
        value: 'other',
        label: 'Has other files',
        count: filterableItems.filter(reportHasOtherAttachment).length,
      },
      {
        value: 'none',
        label: 'No attachments',
        count: filterableItems.filter(report => !reportHasAttachment(report)).length,
      },
    ];

    // Keep the current selection available while a refresh is in flight, then
    // expose only attachment categories that are actually present in the data.
    return options.filter(option => option.value === 'all' || option.count > 0 || option.value === attachmentFilter);
  }, [attachmentFilter, filterableItems]);

  const searchFiltered = useMemo(() => {
    let r = filterableItems;
    if (attachmentFilter !== 'all') {
      r = r.filter(rep => {
        const hasPhoto = reportHasPhoto(rep);
        const hasVideo = reportHasVideo(rep);
        const hasDocument = reportHasDocument(rep);
        if (attachmentFilter === 'photos') return hasPhoto;
        if (attachmentFilter === 'videos') return hasVideo;
        if (attachmentFilter === 'documents') return hasDocument;
        if (attachmentFilter === 'other') return reportHasOtherAttachment(rep);
        return !reportHasAttachment(rep);
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(rep => {
        const project = rep.projectId ? projectById.get(rep.projectId) : undefined;
        const searchableText = [
          rep.title,
          rep.description,
          rep.submitterName,
          rep.submitterRole,
          rep.projectTitle,
          rep.reportType,
          rep.category,
          project?.title,
          project?.category,
          project?.location?.address,
          ...(rep.attachments || []).flatMap(attachment => [attachment.url, attachment.description]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchableText.includes(q);
      });
    }
    return r.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [attachmentFilter, filterableItems, projectById, search]);

  const attendanceReports = useMemo(
    () => searchFiltered.filter(isAttendanceReport),
    [searchFiltered],
  );
  const taskReports = useMemo(
    () => searchFiltered.filter(report => !isAttendanceReport(report)),
    [searchFiltered],
  );
  const eventReports = useMemo(() => taskReports.filter(r => (r as any).projectKind === 'event'), [taskReports]);
  const photoReports = useMemo(
    () => searchFiltered.filter(report => reportHasPhoto(report) && isAttendanceReport(report)),
    [searchFiltered],
  );

  // Build folders grouped by project — for Events/All show relevant, for Photos hide
  const folders = useMemo(() => {
    const sourceReports = activeFilter === 'Photos' ? [] as SubmittedReport[] : activeFilter === 'Events' ? eventReports : taskReports;
    const map = new Map<string, { key: string; title: string; reports: SubmittedReport[]; updatedAt: string }>();
    const targetReports = sourceReports;
    targetReports.forEach(rep => {
      const proj = rep.projectId ? projectById.get(rep.projectId) : undefined;
      const key = reportFolderKey(rep);
      const title = proj?.title || rep.projectTitle || rep.category || 'General';
      if (!map.has(key)) map.set(key, { key, title, reports: [], updatedAt: rep.submittedAt });
      const f = map.get(key)!;
      f.reports.push(rep);
      if (new Date(rep.submittedAt).getTime() > new Date(f.updatedAt).getTime()) f.updatedAt = rep.submittedAt;
    });
    if (map.size === 0 && activeFilter === 'All' && attachmentFilter === 'all' && !search.trim()) {
      const srcProjects = projects.filter(p => p.isEvent).slice(0, 7);
      srcProjects.forEach(p => {
        if (!map.has(p.id)) map.set(p.id, { key: p.id, title: p.title, reports: [], updatedAt: p.updatedAt || p.createdAt });
      });
    }
    const arr = Array.from(map.values()).sort((a, b) => b.reports.length - a.reports.length || a.title.localeCompare(b.title));
    return arr;
  }, [taskReports, eventReports, activeFilter, attachmentFilter, search, projects, projectById]);

  // Photos folders: group by image reports
  const photoFolders = useMemo(() => {
    const map = new Map<string, { key: string; title: string; count: number; updatedAt: string }>();
    const target = activeFilter === 'Events' ? [] : photoReports;
    target.forEach(rep => {
      const key = photoFolderKey(rep);
      const proj = rep.projectId ? projectById.get(rep.projectId) : undefined;
      const title = proj?.title || rep.projectTitle || 'Photos';
      if (!map.has(key)) map.set(key, { key, title, count: 0, updatedAt: rep.submittedAt });
      const f = map.get(key)!;
      f.count += getReportPhotoUris(rep).length;
      if (new Date(rep.submittedAt).getTime() > new Date(f.updatedAt).getTime()) f.updatedAt = rep.submittedAt;
    });
    if (map.size === 0 && activeFilter !== 'Events') {
      // fallback to show empty state, not needed
    }
    return Array.from(map.values());
  }, [photoReports, activeFilter, projectById]);

  // If a search/filter removes the selected folder, clear the selection so
  // the table never remains stuck on an invisible event.
  useEffect(() => {
    if (
      selectedEventFolderKey &&
      !folders.some(folder => folder.key === selectedEventFolderKey)
    ) {
      setSelectedEventFolderKey(null);
    }
  }, [folders, selectedEventFolderKey]);

  useEffect(() => {
    if (
      selectedPhotoFolderKey &&
      !photoFolders.some(folder => folder.key === selectedPhotoFolderKey)
    ) {
      setSelectedPhotoFolderKey(null);
    }
  }, [photoFolders, selectedPhotoFolderKey]);

  const totalReports = activeFilter === 'Photos'
    ? photoReports.length
    : activeFilter === 'Events'
    ? eventReports.length + attendanceReports.length
    : taskReports.length + attendanceReports.length;
  const totalFolders = activeFilter === 'Photos' ? photoFolders.length : folders.length;
  const eventSectionReports = activeFilter === 'All' ? taskReports : eventReports;
  const tableReports = selectedEventFolderKey
    ? eventSectionReports.filter(report => reportFolderKey(report) === selectedEventFolderKey)
    : eventSectionReports;
  const visibleAttendanceReports = selectedEventFolderKey
    ? attendanceReports.filter(report => reportFolderKey(report) === selectedEventFolderKey)
    : attendanceReports;
  const selectedEventFolder = folders.find(folder => folder.key === selectedEventFolderKey);
  const photoTableReports = selectedPhotoFolderKey
    ? photoReports.filter(report => photoFolderKey(report) === selectedPhotoFolderKey)
    : photoReports;
  const selectedPhotoFolder = photoFolders.find(folder => folder.key === selectedPhotoFolderKey);
  const photoItems = photoTableReports.flatMap(report =>
    getReportPhotoUris(report).map((uri, photoIndex) => {
      const photoFile = buildPhotoDownloadItem(report, uri, photoIndex);
      return {
        ...photoFile,
        report,
        volunteerName: report.submitterName || 'Volunteer',
        eventTitle: getReportActivityTitle(report, projectById),
      };
    })
  );
  const attachmentFilterLabel =
    attachmentFilter === 'photos'
      ? 'Has Photos'
      : attachmentFilter === 'videos'
      ? 'Has Videos'
      : attachmentFilter === 'documents'
      ? 'Has Documents'
      : attachmentFilter === 'other'
      ? 'Has Other Files'
      : attachmentFilter === 'none'
      ? 'No Attachments'
      : 'Filter';

  const handleBatchDownload = (
    items: SubmittedReport[],
    title: string,
    filenamePrefix: string,
  ) => {
    if (!items.length) {
      Alert.alert('No Reports', 'There are no reports available to download.');
      return;
    }

    const dateKey = new Date().toISOString().slice(0, 10);
    const pdf = buildBatchReportPdf(items, projectById, title);
    const documentSubtitle = `${items.length} report${items.length === 1 ? '' : 's'} - Generated ${new Date().toLocaleString()}`;
    setDownloadPreview({
      title: `Preview: ${title}`,
      subtitle: `${items.length} report${items.length === 1 ? '' : 's'} ready to download`,
      totalRows: items.length,
      columns: ['#', 'Report', 'Event / Project', 'Submitted By', 'Status', 'Submitted'],
      previewTables: buildBatchReportTables(items, projectById),
      documentTitle: title,
      documentSubtitle,
      previewRows: items.slice(0, 5).map((report, index) => ({
        '#': String(index + 1),
        Report: report.title || 'Untitled report',
        'Event / Project': getReportActivityTitle(report, projectById),
        'Submitted By': report.submitterName || 'Unknown user',
        Status: report.status || 'Unknown',
        Submitted: formatReportDateTime(report.submittedAt),
      })),
      fileName: `${filenamePrefix}-${dateKey}`,
      pdf,
      errorMessage: 'Unable to save the batch report on this device.',
    });
  };

  const handlePhotoBatchDownload = () => {
    if (!photoItems.length) {
      Alert.alert('No Photos', 'There are no attendance photos available to download.');
      return;
    }

    const dateKey = new Date().toISOString().slice(0, 10);
    const archiveTitle = selectedPhotoFolder
      ? `${selectedPhotoFolder.title} Attendance Photos`
      : 'Attendance Photos';
    setDownloadPreview({
      title: `Preview: ${archiveTitle}`,
      subtitle: `${photoItems.length} photo${photoItems.length === 1 ? '' : 's'} from ${new Set(photoItems.map(item => item.volunteerName)).size} volunteer${new Set(photoItems.map(item => item.volunteerName)).size === 1 ? '' : 's'} ready to download as a ZIP archive`,
      totalRows: photoItems.length,
      recordCount: photoItems.length,
      previewRows: photoItems.slice(0, 5).map(item => ({
        Volunteer: item.volunteerName,
        Event: item.eventTitle,
        Photo: item.filename,
      })),
      columns: ['Volunteer', 'Event', 'Photo'],
      fileName: `attendance-photos-${dateKey}`,
      photoItems,
      errorMessage: 'Unable to download the attendance photos on this device.',
    });
  };

  const handleReportDownload = (report: SubmittedReport) => {
    const submittedDate = new Date(report.submittedAt || '');
    const dateKey = (Number.isNaN(submittedDate.getTime()) ? new Date() : submittedDate)
      .toISOString()
      .slice(0, 10);
    const pdf = buildSingleReportPdf(report, projectById);
    const previewRows = buildSingleReportPreviewRows(report, projectById);
    const documentSubtitle = `Generated report export - ${formatReportDateTime(report.submittedAt)}`;
    setDownloadPreview({
      title: `Preview: ${report.title || 'Report'}`,
      subtitle: 'Review the report fields before downloading the PDF',
      totalRows: previewRows.length,
      recordCount: 1,
      columns: ['Field', 'Value'],
      previewRows,
      previewTables: buildSingleReportTables(report, projectById),
      documentTitle: report.title || 'Report',
      documentSubtitle,
      fileName: `${report.title || 'report'}-${dateKey}`,
      pdf,
      errorMessage: 'Unable to save this report on this device.',
    });
  };

  const selectAttachmentFilter = (nextFilter: typeof attachmentFilter) => {
    setAttachmentFilter(nextFilter);
    setShowFilter(false);
    setSelectedEventFolderKey(null);
    setSelectedPhotoFolderKey(null);
    setShowAllPhotos(false);
  };

  const renderReportRows = (items: SubmittedReport[]) => items.map(rep => {
    const proj = rep.projectId ? projectById.get(rep.projectId) : undefined;
    const eventTitle = proj?.title || rep.projectTitle || (reportType === 'partner' ? 'Unlisted Project' : 'Unlisted Event');
    const eventSub = proj?.location?.address || proj?.category || rep.category || 'NVC';
    const dateStr = new Date(rep.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const bg = avatarBg(rep.submitterName);
    const ic = fileIcon(rep);
    return (
      <View key={rep.id} style={styles.tr}>
        <View style={[styles.td, { flex: 2.2, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <View style={[styles.fileIconBox, { backgroundColor: ic.bg }]}>
            {ic.icon === 'picture-as-pdf' ? (
              <Text style={[styles.fileIconText, { color: ic.color }]}>Pdf</Text>
            ) : ic.icon === 'image' ? (
              <MaterialIcons name="image" size={16} color={ic.color} />
            ) : (
              <Text style={[styles.fileIconText, { color: ic.color }]}>W</Text>
            )}
          </View>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => onViewReport(rep)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`View ${rep.title || 'report'}`}
          >
            <Text style={styles.reportName} numberOfLines={1}>{rep.title}</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.td, { flex: 1.4 }]}>
          <Text style={styles.eventName} numberOfLines={1}>{eventTitle}</Text>
          <Text style={styles.eventSub} numberOfLines={1}>{eventSub}</Text>
        </View>
        <View style={[styles.td, { flex: 1 }]}>
          <Text style={styles.dateText}>{dateStr}</Text>
        </View>
        <View style={[styles.td, { flex: 1.2, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <View style={[styles.avatar, { backgroundColor: bg }]}>
            <Text style={styles.avatarText}>{initials(rep.submitterName)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.submitterName} numberOfLines={1}>{rep.submitterName}</Text>
            <Text style={styles.submitterRole} numberOfLines={1}>{rep.submitterRole === 'volunteer' ? 'Volunteer' : rep.submitterRole === 'partner' ? 'Partner' : 'Coordinator'}</Text>
          </View>
        </View>
        <View style={[styles.td, { flex: 0.6, flexDirection: 'row', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }]}>
          <TouchableOpacity
            onPress={() => handleReportDownload(rep)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Download ${rep.title || 'report'} as a table PDF`}
          >
            <MaterialIcons name="file-download" size={20} color="#64748b" />
          </TouchableOpacity>
        </View>
      </View>
    );
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAF6' }}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* Second row: Show reports by + Search + Filter */}
      <View style={[styles.showByRow, isNarrow && styles.showByRowNarrow]}>
        <View style={[styles.showByLeft, isNarrow && styles.showByLeftNarrow]}>
          <Text style={styles.showByLabel}>Show reports by</Text>
          <View style={[styles.showByPills, isNarrow && styles.showByPillsNarrow]}>
            {(['All', 'Events', 'Photos'] as const).map(k => (
              <TouchableOpacity
                key={k}
                style={[styles.pill, activeFilter === k && styles.pillActive]}
                onPress={() => {
                  setActiveFilter(k);
                  setSelectedEventFolderKey(null);
                  setSelectedPhotoFolderKey(null);
                }}
                activeOpacity={0.85}
              >
                <MaterialIcons
                  name={k === 'All' ? 'apps' : k === 'Events' ? 'event' : 'photo-library'}
                  size={14}
                  color={activeFilter === k ? '#fff' : '#5B564C'}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.pillText, activeFilter === k && styles.pillTextActive]}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={[styles.showByRight, isNarrow && styles.showByRightNarrow]}>
          <View style={[styles.searchBox, isNarrow && styles.searchBoxNarrow]}>
            <MaterialIcons name="search" size={18} color="#94a3b8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search reports..."
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity
            style={[styles.filterBtn, attachmentFilter !== 'all' && styles.filterBtnActive]}
            onPress={() => setShowFilter(v => !v)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Filter reports"
          >
            <MaterialIcons name="filter-list" size={18} color="#5B564C" />
            <Text style={styles.filterBtnText}>{attachmentFilterLabel}</Text>
            <MaterialIcons name={showFilter ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color="#5B564C" />
          </TouchableOpacity>
        </View>
      </View>

      {showFilter ? (
        <View style={[styles.filterMenu, isNarrow && styles.filterMenuNarrow]}>
          <Text style={styles.filterMenuTitle}>Filter reports</Text>
          {attachmentFilterOptions.map(({ value, label, count }) => (
            <TouchableOpacity
              key={value}
              style={styles.filterMenuItem}
              onPress={() => selectAttachmentFilter(value)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.filterMenuItemText,
                  attachmentFilter === value && styles.filterMenuItemTextActive,
                ]}
              >
                {label} ({count})
              </Text>
              {attachmentFilter === value ? (
                <MaterialIcons name="check" size={16} color="#166534" />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {(activeFilter === 'All' || activeFilter === 'Events') && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <View style={styles.sectionIconBox}>
                <MaterialIcons name="folder" size={20} color="#8B5A2B" />
              </View>
              <View>
                <Text style={styles.sectionTitle}>{reportType === 'partner' ? 'Project Reports' : 'Task & Field Reports'}</Text>
                <Text style={styles.sectionSubtitle}>{reportType === 'partner' ? 'All folders and reports related to projects.' : 'Submitted task and field reports related to events.'}</Text>
              </View>
            </View>
            <View style={styles.sectionHeaderRight}>
              <Text style={styles.sectionMeta}>
                {selectedEventFolder
                  ? `${selectedEventFolder.title} • ${tableReports.length} report${tableReports.length === 1 ? '' : 's'}`
                  : `${folders.length} folders • ${eventReports.length} reports`}
              </Text>
              <TouchableOpacity
                style={[styles.batchDownloadButton, !tableReports.length && styles.batchDownloadButtonDisabled]}
                onPress={() =>
                  handleBatchDownload(
                    tableReports,
                    reportType === 'partner' ? 'Project Reports' : 'Task and Field Reports',
                    reportType === 'partner' ? 'project-reports' : 'task-field-reports',
                  )
                }
                disabled={!tableReports.length}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Batch download task and field reports"
              >
                <MaterialIcons name="file-download" size={15} color="#fff" />
                <Text style={styles.batchDownloadButtonText}>Batch Download</Text>
              </TouchableOpacity>
              {selectedEventFolder ? (
                <TouchableOpacity
                  style={styles.clearFolderButton}
                  onPress={() => setSelectedEventFolderKey(null)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.clearFolderButtonText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.sectionToggleButton}
                onPress={() => toggleSection('tasks')}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${collapsedSections.tasks ? 'Expand' : 'Collapse'} task and field reports`}
              >
                <MaterialIcons
                  name={collapsedSections.tasks ? 'keyboard-arrow-down' : 'keyboard-arrow-up'}
                  size={20}
                  color="#5B564C"
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={collapsedSections.tasks && styles.sectionContentCollapsed}>
        {folders.length === 0 ? (
          <View style={styles.emptyFolderBox}>
            <Text style={styles.emptyFolderText}>No folders yet</Text>
          </View>
        ) : (
          <View style={styles.folderGrid}>
            {folders.map(folder => {
              const updated = new Date(folder.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const isSelected = selectedEventFolderKey === folder.key;
              return (
                <TouchableOpacity
                  key={folder.key}
                  style={[styles.folderCard, isNarrow && styles.folderCardNarrow, isSelected && styles.folderCardSelected]}
                  onPress={() => setSelectedEventFolderKey(isSelected ? null : folder.key)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter reports for ${folder.title}`}
                >
                  <View style={styles.folderTopRow}>
                    <View style={styles.folderIcon}>
                      <MaterialIcons name="folder" size={28} color="#EAB308" />
                    </View>
                  </View>
                  <Text style={styles.folderTitle} numberOfLines={1}>{folder.title}</Text>
                  <Text style={styles.folderCount}>{folder.reports.length} report{folder.reports.length===1?'':'s'}</Text>
                  <View style={styles.folderUpdatedRow}>
                    <MaterialIcons name="description" size={12} color="#94a3b8" />
                    <Text style={styles.folderUpdated}>Updated {updated}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Table header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 2.2 }]}>{reportType === 'partner' ? 'Report name' : 'Report Name'} <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 1.4 }]}>{reportType === 'partner' ? 'Project report' : 'Event'} <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 1 }]}>Date <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 1.2 }]}>Submitted By <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 0.6, textAlign: 'right' }]}>Actions</Text>
        </View>

        {tableReports.length === 0 ? (
          <View style={styles.emptyTable}>
            <Text style={styles.emptyTableText}>No reports found</Text>
          </View>
        ) : (
          renderReportRows(tableReports)
        )}
        </View>
          </View>
      )}

      {/* Attendance is kept separate and is sourced from volunteer time logs. */}
      {(activeFilter === 'All' || activeFilter === 'Events') && (
        <View style={[styles.sectionCard, { marginTop: 16 }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <View style={[styles.sectionIconBox, { backgroundColor: '#DCFCE7' }]}>
                <MaterialIcons name="event-available" size={20} color="#166534" />
              </View>
              <View>
                <Text style={styles.sectionTitle}>Attendance Reports</Text>
                <Text style={styles.sectionSubtitle}>Attendance records and photos submitted by volunteers.</Text>
              </View>
            </View>
            <View style={styles.sectionHeaderRight}>
              <Text style={styles.sectionMeta}>
                {selectedEventFolder
                  ? `${selectedEventFolder.title} • ${visibleAttendanceReports.length} report${visibleAttendanceReports.length === 1 ? '' : 's'}`
                  : `${attendanceReports.length} report${attendanceReports.length === 1 ? '' : 's'}`}
              </Text>
              <TouchableOpacity
                style={[styles.batchDownloadButton, !visibleAttendanceReports.length && styles.batchDownloadButtonDisabled]}
                onPress={() => handleBatchDownload(visibleAttendanceReports, 'Attendance Reports', 'attendance-reports')}
                disabled={!visibleAttendanceReports.length}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Batch download attendance reports"
              >
                <MaterialIcons name="file-download" size={15} color="#fff" />
                <Text style={styles.batchDownloadButtonText}>Batch Download</Text>
              </TouchableOpacity>
              {selectedEventFolder ? (
                <TouchableOpacity
                  style={styles.clearFolderButton}
                  onPress={() => setSelectedEventFolderKey(null)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.clearFolderButtonText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.sectionToggleButton}
                onPress={() => toggleSection('attendance')}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${collapsedSections.attendance ? 'Expand' : 'Collapse'} attendance reports`}
              >
                <MaterialIcons
                  name={collapsedSections.attendance ? 'keyboard-arrow-down' : 'keyboard-arrow-up'}
                  size={20}
                  color="#5B564C"
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={collapsedSections.attendance && styles.sectionContentCollapsed}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 2.2 }]}>Attendance <Text style={styles.thSort}>↕</Text></Text>
            <Text style={[styles.th, { flex: 1.4 }]}>Event <Text style={styles.thSort}>↕</Text></Text>
            <Text style={[styles.th, { flex: 1 }]}>Date <Text style={styles.thSort}>↕</Text></Text>
            <Text style={[styles.th, { flex: 1.2 }]}>Submitted By <Text style={styles.thSort}>↕</Text></Text>
            <Text style={[styles.th, { flex: 0.6, textAlign: 'right' }]}>Actions</Text>
          </View>

          {visibleAttendanceReports.length === 0 ? (
            <View style={styles.emptyTable}>
              <Text style={styles.emptyTableText}>No attendance reports found</Text>
            </View>
          ) : (
            renderReportRows(visibleAttendanceReports)
          )}
          </View>
        </View>
      )}

      {/* Photos Reports Section: attendance-photo gallery */}
      {(activeFilter === 'All' || activeFilter === 'Photos') && (
      <View style={[styles.sectionCard, { marginTop: 16 }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <View style={[styles.sectionIconBox, { backgroundColor: '#FEF3C7' }]}>
              <MaterialIcons name="photo-library" size={20} color="#8B5A2B" />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Photos Reports</Text>
              <Text style={styles.sectionSubtitle}>Attendance photos submitted by volunteers who timed in.</Text>
            </View>
          </View>
          <View style={styles.sectionHeaderRight}>
            <Text style={styles.sectionMeta}>
              {selectedPhotoFolder
                ? `${selectedPhotoFolder.title} • ${photoItems.length} photo${photoItems.length === 1 ? '' : 's'}`
                : showAllPhotos
                ? `All folders • ${photoItems.length} photo${photoItems.length === 1 ? '' : 's'}`
                : `${photoFolders.length} folder${photoFolders.length === 1 ? '' : 's'} • ${photoItems.length} photo${photoItems.length === 1 ? '' : 's'}`}
            </Text>
            {Platform.OS === 'web' ? (
              <TouchableOpacity
                style={[styles.batchDownloadButton, !photoItems.length && styles.batchDownloadButtonDisabled]}
                onPress={handlePhotoBatchDownload}
                disabled={!photoItems.length}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Batch download attendance photos"
              >
                <MaterialIcons name="file-download" size={15} color="#fff" />
                <Text style={styles.batchDownloadButtonText}>Batch Download</Text>
              </TouchableOpacity>
            ) : null}
            {!showAllPhotos && photoItems.length > 0 ? (
              <TouchableOpacity
                style={styles.viewAllPhotosButton}
                onPress={() => {
                  setSelectedPhotoFolderKey(null);
                  setShowAllPhotos(true);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="View all photos"
              >
                <MaterialIcons name="photo-library" size={15} color="#166534" />
                <Text style={styles.viewAllPhotosButtonText}>View All Photos</Text>
              </TouchableOpacity>
            ) : null}
            {selectedPhotoFolder ? (
              <TouchableOpacity
                style={styles.clearFolderButton}
                onPress={() => {
                  setSelectedPhotoFolderKey(null);
                  setShowAllPhotos(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.clearFolderButtonText}>Hide Photos</Text>
              </TouchableOpacity>
            ) : null}
            {showAllPhotos ? (
              <TouchableOpacity
                style={styles.clearFolderButton}
                onPress={() => setShowAllPhotos(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.clearFolderButtonText}>Hide Photos</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.sectionToggleButton}
              onPress={() => toggleSection('photos')}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`${collapsedSections.photos ? 'Expand' : 'Collapse'} photo reports`}
            >
              <MaterialIcons
                name={collapsedSections.photos ? 'keyboard-arrow-down' : 'keyboard-arrow-up'}
                size={20}
                color="#5B564C"
              />
            </TouchableOpacity>
          </View>
        </View>
        <View style={collapsedSections.photos && styles.sectionContentCollapsed}>
        {photoFolders.length > 0 ? (
          <View style={styles.folderGrid}>
            {photoFolders.map(f => {
              const updated = new Date(f.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const isSelected = selectedPhotoFolderKey === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.folderCard, isNarrow && styles.folderCardNarrow, isSelected && styles.folderCardSelected]}
                  onPress={() => {
                    setSelectedPhotoFolderKey(isSelected ? null : f.key);
                    setShowAllPhotos(false);
                  }}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter photos for ${f.title}`}
                >
                  <View style={styles.folderTopRow}>
                    <View style={styles.folderIcon}>
                      <MaterialIcons name="folder" size={28} color="#EAB308" />
                    </View>
                  </View>
                  <Text style={styles.folderTitle} numberOfLines={1}>{f.title}</Text>
                  <Text style={styles.folderCount}>{f.count} photo{f.count===1?'':'s'}</Text>
                  <View style={styles.folderUpdatedRow}>
                    <MaterialIcons name="image" size={12} color="#94a3b8" />
                    <Text style={styles.folderUpdated}>Updated {updated}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {photoFolders.length === 0 ? (
          <View style={styles.emptyTable}>
            <Text style={styles.emptyTableText}>No attendance photos found</Text>
          </View>
        ) : selectedPhotoFolder || showAllPhotos ? (
          photoItems.length > 0 ? (
          <View style={styles.photoGrid}>
            {photoItems.map(item => (
              <TouchableOpacity
                key={`${item.report.id}-${item.uri}`}
                style={styles.photoTile}
                onPress={() => setPhotoPreview(item)}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel={`View attendance photo from ${item.volunteerName}`}
              >
                <Image source={{ uri: item.uri }} style={styles.photoTileImage} resizeMode="cover" />
                <View style={styles.photoTileCaption}>
                  <Text style={styles.photoTileVolunteer} numberOfLines={1}>{item.volunteerName}</Text>
                  <Text style={styles.photoTileEvent} numberOfLines={1}>{item.eventTitle}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          ) : (
            <View style={styles.emptyTable}>
              <Text style={styles.emptyTableText}>No attendance photos found</Text>
            </View>
          )
        ) : null}

        <View style={styles.hiddenPhotoReportDetails}>
        {/* Table header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 2.2 }]}>Report name <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 1.4 }]}>Project report <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 1 }]}>Date <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 1.2 }]}>Submitted By <Text style={styles.thSort}>↕</Text></Text>
          <Text style={[styles.th, { flex: 0.6, textAlign: 'right' }]}>Actions</Text>
        </View>

        {photoTableReports.length === 0 ? (
          <View style={styles.emptyTable}>
            <Text style={styles.emptyTableText}>No reports found</Text>
          </View>
        ) : (
          photoTableReports.map(rep => {
            const proj = rep.projectId ? projectById.get(rep.projectId) : undefined;
            const projectTitle = proj?.title || rep.projectTitle || 'Unlisted Project';
            const projectSub = proj?.location?.address || proj?.category || rep.category || 'NVC';
            const dateStr = new Date(rep.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const bg = avatarBg(rep.submitterName);
            const ic = fileIcon(rep);
            return (
              <View key={rep.id} style={styles.tr}>
                <View style={[styles.td, { flex: 2.2, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <View style={[styles.fileIconBox, { backgroundColor: ic.bg }]}>
                    {ic.icon === 'picture-as-pdf' ? (
                      <Text style={[styles.fileIconText, { color: ic.color }]}>Pdf</Text>
                    ) : ic.icon === 'image' ? (
                      <MaterialIcons name="image" size={16} color={ic.color} />
                    ) : (
                      <Text style={[styles.fileIconText, { color: ic.color }]}>W</Text>
                    )}
                  </View>
                  <Text style={styles.reportName} numberOfLines={1}>{rep.title}</Text>
                </View>
                <View style={[styles.td, { flex: 1.4 }]}>
                  <Text style={styles.eventName} numberOfLines={1}>{projectTitle}</Text>
                  <Text style={styles.eventSub} numberOfLines={1}>{projectSub}</Text>
                </View>
                <View style={[styles.td, { flex: 1 }]}>
                  <Text style={styles.dateText}>{dateStr}</Text>
                </View>
                <View style={[styles.td, { flex: 1.2, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <View style={[styles.avatar, { backgroundColor: bg }]}>
                    <Text style={styles.avatarText}>{initials(rep.submitterName)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.submitterName} numberOfLines={1}>{rep.submitterName}</Text>
                    <Text style={styles.submitterRole} numberOfLines={1}>{rep.submitterRole === 'volunteer' ? 'Volunteer' : rep.submitterRole === 'partner' ? 'Partner' : 'Coordinator'}</Text>
                  </View>
                </View>
                <View style={[styles.td, { flex: 0.6, flexDirection: 'row', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }]}>
                  <TouchableOpacity
                    onPress={() => handleReportDownload(rep)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Download ${rep.title || 'report'} as a table PDF`}
                  >
                    <MaterialIcons name="file-download" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
        </View>
        </View>
      </View>
      )}

      </ScrollView>
      {/* Keep report upload in the page header on web; the floating button
          obscures the Actions column. It remains available on native screens. */}
      {Platform.OS !== 'web' ? (
        <View style={styles.fabWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={[styles.fab, !onUploadReport && styles.fabDisabled]}
            activeOpacity={0.85}
            onPress={onUploadReport}
            disabled={!onUploadReport}
            accessibilityRole="button"
            accessibilityLabel="Upload report"
          >
            <MaterialIcons name="file-upload" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : null}
      <Modal
        visible={Boolean(photoPreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoPreview(null)}
      >
        <View style={styles.photoViewerBackdrop}>
          <View style={styles.photoViewerCard}>
            <View style={styles.photoViewerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.photoViewerTitle}>Attendance photo</Text>
                <Text style={styles.photoViewerSubtitle} numberOfLines={1}>
                  {photoPreview?.volunteerName || 'Volunteer'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setPhotoPreview(null)}
                style={styles.photoViewerClose}
                accessibilityRole="button"
                accessibilityLabel="Close photo preview"
              >
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Image
              source={{ uri: photoPreview?.uri || '' }}
              style={styles.photoViewerImage}
              resizeMode="contain"
            />
          </View>
        </View>
      </Modal>
      <DownloadPreviewModal
        visible={Boolean(downloadPreview)}
        title={downloadPreview?.title || 'Download preview'}
        subtitle={downloadPreview?.subtitle || ''}
        totalRows={downloadPreview?.totalRows || 0}
        previewRows={downloadPreview?.previewRows || []}
        columns={downloadPreview?.columns || []}
        previewTables={downloadPreview?.previewTables}
        documentTitle={downloadPreview?.documentTitle}
        documentSubtitle={downloadPreview?.documentSubtitle}
        stats={downloadPreview ? [
          { label: 'File format', value: downloadPreview.photoItems ? 'ZIP archive' : 'PDF', icon: downloadPreview.photoItems ? 'photo-library' : 'picture-as-pdf' },
          { label: 'Included records', value: String(downloadPreview.recordCount ?? downloadPreview.totalRows), icon: 'description' },
        ] : undefined}
        onConfirm={() => {
          if (!downloadPreview) return;
          const pending = downloadPreview;
          setDownloadPreview(null);
          if (pending.photoItems) {
            void downloadPhotoBatch(pending.photoItems, pending.fileName).catch(error => {
              console.error('Unable to download attendance photos:', error);
              Alert.alert('Download failed', pending.errorMessage);
            });
          } else if (pending.pdf) {
            void downloadPdfFile(pending.fileName, pending.pdf, pending.errorMessage);
          }
        }}
        onCancel={() => setDownloadPreview(null)}
        confirmText={downloadPreview?.photoItems ? 'Download ZIP' : 'Download PDF'}
        confirmColor="#166534"
      />
    </View>
  );
}

function buildSingleReportPreviewRows(
  report: SubmittedReport,
  projectById: Map<string, Project>,
): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [
    { Field: 'Title', Value: report.title || 'Untitled report' },
    { Field: 'Event / Project', Value: getReportActivityTitle(report, projectById) },
    { Field: 'Submitted by', Value: report.submitterName || 'Unknown user' },
    { Field: 'Status', Value: report.status || 'Unknown' },
    { Field: 'Submitted', Value: formatReportDateTime(report.submittedAt) },
    { Field: 'Attachments', Value: getReportAttachmentSummary(report) },
    { Field: 'Report narrative', Value: report.description || 'No description provided.' },
  ];

  Object.entries(report.metrics || {})
    .filter(([metric, value]) => (
      value !== undefined
      && value !== null
      && metric !== 'volunteerHours'
      && metric !== 'beneficiariesServed'
      && metric !== 'attendanceHours'
    ))
    .forEach(([metric, value]) => {
      rows.push({ Field: formatMetricLabel(metric), Value: String(value) });
    });

  return rows;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F8FAF6' },
  container: { gap: 16, padding: 16, paddingBottom: 80, backgroundColor: '#F8FAF6' },
  showByRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  showByRowNarrow: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
    marginBottom: 8,
    paddingBottom: 4,
  },
  showByLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  showByLeftNarrow: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  showByLabel: { fontSize: 13, color: '#5B564C', fontWeight: '600' },
  showByPills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  showByPillsNarrow: { flexWrap: 'nowrap', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  pillActive: { backgroundColor: '#8B5A2B', borderColor: '#8B5A2B' },
  pillText: { fontSize: 13, fontWeight: '700', color: '#5B564C' },
  pillTextActive: { color: '#fff' },
  showByRight: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap' },
  showByRightNarrow: {
    width: '100%',
    alignSelf: 'stretch',
    flex: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
    zIndex: 2,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 220,
    flex: 1,
    maxWidth: 320,
  },
  searchBoxNarrow: { minWidth: 0, flex: 1, maxWidth: 9999, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 13, color: '#1F2937', padding: 0 },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterBtnActive: {
    backgroundColor: '#FFFBF5',
    borderColor: '#8B5A2B',
  },
  filterBtnText: { fontSize: 13, fontWeight: '700', color: '#5B564C' },
  filterMenu: {
    alignSelf: 'flex-end',
    width: 220,
    marginTop: -4,
    marginBottom: 4,
    padding: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 5,
  },
  filterMenuNarrow: {
    alignSelf: 'stretch',
    width: '100%',
  },
  filterMenuTitle: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '800',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterMenuItem: {
    minHeight: 36,
    paddingHorizontal: 8,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterMenuItemText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '600',
  },
  filterMenuItemTextActive: {
    color: '#166534',
    fontWeight: '800',
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E7E5E4',
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFBF5',
    borderBottomWidth: 1,
    borderBottomColor: '#F3E8D9',
    gap: 12,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  sectionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#1F2937' },
  sectionSubtitle: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 1 },
  sectionMeta: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  sectionToggleButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  sectionContentCollapsed: {
    display: 'none',
  },
  batchDownloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: '#166534',
  },
  batchDownloadButtonDisabled: {
    opacity: 0.45,
  },
  batchDownloadButtonText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  clearFolderButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
  },
  clearFolderButtonText: { fontSize: 10, color: '#166534', fontWeight: '800' },
  viewAllPhotosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#86B89A',
    backgroundColor: '#F0FDF4',
  },
  viewAllPhotosButtonText: { fontSize: 11, color: '#166534', fontWeight: '800' },
  hiddenPhotoReportDetails: { display: 'none' },
  emptyFolderBox: { padding: 24, alignItems: 'center' },
  emptyFolderText: { color: '#9CA3AF', fontSize: 13 },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    padding: 14,
  },
  photoTile: {
    width: 220,
    minWidth: 170,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 12,
    overflow: 'hidden',
  },
  photoTileImage: {
    width: '100%',
    height: 170,
    backgroundColor: '#E2E8F0',
  },
  photoTileCaption: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 3,
  },
  photoTileVolunteer: { fontSize: 12, fontWeight: '800', color: '#1F2937' },
  photoTileEvent: { fontSize: 10, color: '#6B7280' },
  photoViewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  photoViewerCard: {
    width: '100%',
    maxWidth: 980,
    height: '88%',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    overflow: 'hidden',
  },
  photoViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  photoViewerTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  photoViewerSubtitle: { color: '#CBD5E1', fontSize: 11, marginTop: 2 },
  photoViewerClose: { padding: 4, marginLeft: 12 },
  photoViewerImage: { flex: 1, width: '100%', backgroundColor: '#0F172A' },
  folderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 12,
  },
  folderCard: {
    width: '23.5%',
    minWidth: 150,
    backgroundColor: '#FFFBF5',
    borderWidth: 1,
    borderColor: '#F3E8D9',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  folderCardSelected: {
    borderColor: '#166534',
    backgroundColor: '#F0FDF4',
    borderWidth: 2,
  },
  folderCardNarrow: { width: '47%', minWidth: 0, padding: 12 },
  folderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  folderIcon: { width: 32, height: 28, justifyContent: 'center' },
  folderMenu: { padding: 4 },
  folderTitle: { fontSize: 13, fontWeight: '700', color: '#1F2937', marginTop: 4 },
  folderCount: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  folderUpdatedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  folderUpdated: { fontSize: 10, color: '#9CA3AF', fontWeight: '600' },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderTopColor: '#E7E5E4',
    borderBottomWidth: 1,
    borderBottomColor: '#E7E5E4',
    gap: 12,
  },
  th: { fontSize: 11, fontWeight: '700', color: '#6B7280' },
  thSort: { fontSize: 10, color: '#9CA3AF' },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
    backgroundColor: '#fff',
  },
  td: {},
  fileIconBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  fileIconText: { fontSize: 10, fontWeight: '800' },
  reportName: { fontSize: 13, fontWeight: '600', color: '#1F2937', flex: 1 },
  eventName: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  eventSub: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  dateText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 11, fontWeight: '800', color: '#1F2937' },
  submitterName: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  submitterRole: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  emptyTable: { padding: 24, alignItems: 'center' },
  emptyTableText: { color: '#9CA3AF' },
  fabWrap: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#C4C4C7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabDisabled: {
    opacity: 0.45,
  },
});
