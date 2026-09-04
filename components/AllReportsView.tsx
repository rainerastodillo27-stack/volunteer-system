import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Image, Platform, Linking, Alert, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { SubmittedReport } from '../screens/ReportsScreen';
import type { Project, VolunteerTimeLog, Volunteer } from '../models/types';
import { isImageMediaUri } from '../utils/media';

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
  const hasJpg = title.endsWith('.jpg') || title.endsWith('.jpeg') || title.endsWith('.png') || report.attachments?.some(a => a.type === 'image') || isImageMediaUri(report.mediaFile || '');
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

function reportHasPhoto(report: SubmittedReport): boolean {
  return Boolean(
    report.attachments?.some(attachment => attachment.type === 'image') ||
      isImageMediaUri(report.mediaFile || '')
  );
}

function reportHasDocument(report: SubmittedReport): boolean {
  const documentExtensions = /\.(pdf|doc|docx|xls|xlsx|csv)(?:$|[?#])/i;
  return Boolean(
    report.attachments?.some(
      attachment =>
        attachment.type === 'document' || documentExtensions.test(attachment.url)
    ) ||
      documentExtensions.test(report.title || '') ||
      documentExtensions.test(report.mediaFile || '')
  );
}

function reportHasAttachment(report: SubmittedReport): boolean {
  return Boolean(report.mediaFile || report.attachments?.length);
}

export default function AllReportsView({ reports, projects, volunteerTimeLogs = [], volunteers = [], onViewReport, onUploadReport, reportType = 'all' }: Props) {
  const { width: viewportWidth } = useWindowDimensions();
  const isNarrow = viewportWidth < 700;
  const [activeFilter, setActiveFilter] = useState<'All' | 'Events' | 'Photos'>('All');
  const [search, setSearch] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [attachmentFilter, setAttachmentFilter] = useState<'all' | 'photos' | 'documents' | 'none'>('all');
  const [selectedEventFolderKey, setSelectedEventFolderKey] = useState<string | null>(null);
  const [selectedPhotoFolderKey, setSelectedPhotoFolderKey] = useState<string | null>(null);

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach(p => m.set(p.id, p));
    return m;
  }, [projects]);

  // Merge time-log attendance photos as synthetic reports so they show in All Reports
  const allItems = useMemo(() => {
    const base = [...reports];
    const volunteerById = new Map((volunteers || []).map(v => [v.id, v]));
    (volunteerTimeLogs || []).forEach(log => {
      const photo = (log as any).attendancePhoto || (log as any).completionPhoto;
      if (!photo || !isImageMediaUri(photo)) return;
      const proj = log.projectId ? projectById.get(log.projectId) : undefined;
      const verified = Boolean((log as any).attendanceCheckedAt);
      const volunteer = volunteerById.get((log as any).volunteerId);
      const volunteerName = volunteer?.name || 'Volunteer';
      base.push({
        id: `timelog-${log.id}`,
        submittedBy: (log as any).volunteerId || volunteer?.userId || '',
        submitterName: volunteerName,
        submitterRole: 'volunteer' as const,
        reportType: 'field_report' as any,
        title: verified ? `Verified Attendance - ${proj?.title || 'Event'}` : `Attendance Photo - ${proj?.title || 'Event'}`,
        description: verified ? `Verified by ${(log as any).attendanceCheckedByName || 'Field Officer'} on ${new Date((log as any).attendanceCheckedAt).toLocaleDateString()}` : `Attendance submitted on ${new Date(log.timeIn || '').toLocaleDateString()}`,
        projectId: log.projectId,
        projectTitle: proj?.title || 'Attendance',
        projectKind: 'event' as const,
        category: proj?.category,
        metrics: {},
        attachments: [{ url: photo, type: 'image' as const, description: 'Attendance Photo' }],
        mediaFile: photo,
        status: verified ? 'Approved' as const : 'Submitted' as const,
        submittedAt: (log as any).attendanceCheckedAt || log.timeIn || new Date().toISOString(),
        viewedBy: [],
      } as any);
    });
    return base;
  }, [reports, volunteerTimeLogs, projectById, volunteers]);

  const searchFiltered = useMemo(() => {
    let r = allItems.filter(r => (r as any).status !== 'Rejected');
    if (attachmentFilter !== 'all') {
      r = r.filter(rep => {
        const hasPhoto = reportHasPhoto(rep);
        const hasDocument = reportHasDocument(rep);
        if (attachmentFilter === 'photos') return hasPhoto;
        if (attachmentFilter === 'documents') return hasDocument;
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
  }, [allItems, attachmentFilter, projectById, search]);

  const eventReports = useMemo(() => searchFiltered.filter(r => (r as any).projectKind === 'event'), [searchFiltered]);
  const photoReports = useMemo(() => searchFiltered.filter(reportHasPhoto), [searchFiltered]);

  // Build folders grouped by project — for Events/All show relevant, for Photos hide
  const folders = useMemo(() => {
    const sourceReports = activeFilter === 'Photos' ? [] as SubmittedReport[] : activeFilter === 'Events' ? eventReports : searchFiltered;
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
  }, [searchFiltered, eventReports, activeFilter, attachmentFilter, search, projects, projectById]);

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
      f.count += 1;
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

  const totalReports = activeFilter === 'Photos' ? photoReports.length : activeFilter === 'Events' ? eventReports.length : searchFiltered.length;
  const totalFolders = activeFilter === 'Photos' ? photoFolders.length : folders.length;
  const eventSectionReports = activeFilter === 'All' ? searchFiltered : eventReports;
  const tableReports = selectedEventFolderKey
    ? eventSectionReports.filter(report => reportFolderKey(report) === selectedEventFolderKey)
    : eventSectionReports;
  const selectedEventFolder = folders.find(folder => folder.key === selectedEventFolderKey);
  const photoTableReports = selectedPhotoFolderKey
    ? photoReports.filter(report => photoFolderKey(report) === selectedPhotoFolderKey)
    : photoReports;
  const selectedPhotoFolder = photoFolders.find(folder => folder.key === selectedPhotoFolderKey);
  const attachmentFilterLabel =
    attachmentFilter === 'photos'
      ? 'Has Photos'
      : attachmentFilter === 'documents'
      ? 'Has Documents'
      : attachmentFilter === 'none'
      ? 'No Attachments'
      : 'Filter';

  const selectAttachmentFilter = (nextFilter: typeof attachmentFilter) => {
    setAttachmentFilter(nextFilter);
    setShowFilter(false);
    setSelectedEventFolderKey(null);
    setSelectedPhotoFolderKey(null);
  };

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
          {([
            ['all', 'All reports'],
            ['photos', 'Has photos'],
            ['documents', 'Has documents'],
            ['none', 'No attachments'],
          ] as const).map(([value, label]) => (
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
                {label}
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
                <Text style={styles.sectionTitle}>{reportType === 'partner' ? 'Project Reports' : 'Events Reports'}</Text>
                <Text style={styles.sectionSubtitle}>{reportType === 'partner' ? 'All folders and reports related to projects.' : 'All folders and reports related to events.'}</Text>
              </View>
            </View>
            <View style={styles.sectionHeaderRight}>
              <Text style={styles.sectionMeta}>
                {selectedEventFolder
                  ? `${selectedEventFolder.title} • ${tableReports.length} report${tableReports.length === 1 ? '' : 's'}`
                  : `${folders.length} folders • ${eventReports.length} reports`}
              </Text>
              {selectedEventFolder ? (
                <TouchableOpacity
                  style={styles.clearFolderButton}
                  onPress={() => setSelectedEventFolderKey(null)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.clearFolderButtonText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
              <MaterialIcons name="keyboard-arrow-up" size={20} color="#5B564C" />
            </View>
          </View>

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
                    <View style={styles.folderMenu}>
                      <MaterialIcons name="more-vert" size={18} color="#9ca3af" />
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
          tableReports.map(rep => {
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
                  <Text style={styles.reportName} numberOfLines={1}>{rep.title}</Text>
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
                    onPress={() => {
                      const url = rep.attachments?.[0]?.url || rep.mediaFile;
                      if (url) Linking.openURL(url).catch(() => Alert.alert('Unable to open file'));
                      else onViewReport(rep);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="file-download" size={20} color="#64748b" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onViewReport(rep)} activeOpacity={0.7}>
                    <MaterialIcons name="more-vert" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
          )}
        </View>
      )}

      {/* Photos Reports Section (collapsed preview like image) */}
      {(activeFilter === 'All' || activeFilter === 'Photos') && (
      <View style={[styles.sectionCard, { marginTop: 16 }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <View style={[styles.sectionIconBox, { backgroundColor: '#FEF3C7' }]}>
              <MaterialIcons name="photo-library" size={20} color="#8B5A2B" />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Photos Reports</Text>
              <Text style={styles.sectionSubtitle}>All folders and reports related to photos and documentation.</Text>
            </View>
          </View>
          <View style={styles.sectionHeaderRight}>
            <Text style={styles.sectionMeta}>
              {selectedPhotoFolder
                ? `${selectedPhotoFolder.title} • ${photoTableReports.length} photo${photoTableReports.length === 1 ? '' : 's'}`
                : `${photoFolders.length} folder${photoFolders.length === 1 ? '' : 's'} • ${photoReports.length} reports`}
            </Text>
            {selectedPhotoFolder ? (
              <TouchableOpacity
                style={styles.clearFolderButton}
                onPress={() => setSelectedPhotoFolderKey(null)}
                activeOpacity={0.8}
              >
                <Text style={styles.clearFolderButtonText}>Clear</Text>
              </TouchableOpacity>
            ) : null}
            <MaterialIcons name={activeFilter==='Photos' ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color="#5B564C" />
          </View>
        </View>
        {photoFolders.length > 0 ? (
          <View style={styles.folderGrid}>
            {photoFolders.map(f => {
              const updated = new Date(f.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const isSelected = selectedPhotoFolderKey === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.folderCard, isNarrow && styles.folderCardNarrow, isSelected && styles.folderCardSelected]}
                  onPress={() => setSelectedPhotoFolderKey(isSelected ? null : f.key)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter photos for ${f.title}`}
                >
                  <View style={styles.folderTopRow}>
                    <View style={styles.folderIcon}>
                      <MaterialIcons name="folder" size={28} color="#EAB308" />
                    </View>
                    <View style={styles.folderMenu}>
                      <MaterialIcons name="more-vert" size={18} color="#9ca3af" />
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
                    onPress={() => {
                      const url = rep.attachments?.[0]?.url || rep.mediaFile;
                      if (url) Linking.openURL(url).catch(() => Alert.alert('Unable to open file'));
                      else onViewReport(rep);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="file-download" size={20} color="#64748b" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onViewReport(rep)} activeOpacity={0.7}>
                    <MaterialIcons name="more-vert" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>
      )}

      </ScrollView>
      {/* Floating upload button like image bottom right */}
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
    </View>
  );
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFBF5',
    borderBottomWidth: 1,
    borderBottomColor: '#F3E8D9',
    gap: 12,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
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
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionMeta: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  clearFolderButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
  },
  clearFolderButtonText: { fontSize: 10, color: '#166534', fontWeight: '800' },
  emptyFolderBox: { padding: 24, alignItems: 'center' },
  emptyFolderText: { color: '#9CA3AF', fontSize: 13 },
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
