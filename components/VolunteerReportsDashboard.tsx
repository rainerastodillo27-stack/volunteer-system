import React, { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Alert,
  Modal,
  TouchableOpacity,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Image,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Path, G } from 'react-native-svg';
import type {
  PartnerProjectReportSummary,
  SubmittedReport,
} from '../screens/ReportsScreen';
import type { Project, VolunteerTimeLog, VolunteerProjectJoinRecord, Volunteer } from '../models/types';
import { buildTablePdf, downloadPdfFile } from '../utils/pdfDownload';
import { getAttachmentUris, isImageMediaUri } from '../utils/media';

function initialsPartner(name: string) {
  const parts = (name || 'U').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || 'U').toUpperCase();
}
function avatarBgPartner(name: string) {
  const colors = ['#FDE68A', '#BFDBFE', '#FECACA', '#D1FAE5', '#DDD6FE', '#FED7AA', '#FBCFE8', '#C7D2FE', '#FEF3C7', '#E0E7FF'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
  return colors[h];
}
function fileIconForPartner(report: any) {
  const title = (report.title || '').toLowerCase();
  const hasPdf = title.endsWith('.pdf') || (report.attachments && report.attachments.some((a:any) => (a.url||'').toLowerCase().endsWith('.pdf')));
  const hasDoc = title.endsWith('.docx') || title.endsWith('.doc') || title.includes('summary.docx');
  const hasImg = title.endsWith('.jpg') || title.endsWith('.jpeg') || title.endsWith('.png') || (report.attachments && report.attachments.some((a:any) => a.type==='image')) || (report.mediaFile && report.mediaFile.startsWith('data:image'));
  if (hasPdf) return { bg: '#FEE2E2', color: '#DC2626', label: 'Pdf' };
  if (hasDoc) return { bg: '#DBEAFE', color: '#1D4ED8', label: 'W' };
  if (hasImg) return { bg: '#DCFCE7', color: '#16A34A', label: 'Img' };
  return { bg: '#FEE2E2', color: '#DC2626', label: 'Pdf' };
}

type VolunteerReportPhotoProps = {
  uri: string;
  variant: 'thumbnail' | 'gallery';
};

// Keep the native/web Image source object stable while dashboard data refreshes.
// This prevents an unchanged data URI from being reloaded and flashing on screen.
const StableVolunteerReportPhoto = React.memo(function StableVolunteerReportPhoto({
  uri,
  variant,
}: VolunteerReportPhotoProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const source = useMemo(() => ({ uri }), [uri]);

  if (failedUri === uri) {
    return (
      <View style={styles.volunteerReportPhotoFallback}>
        <MaterialIcons name="broken-image" size={variant === 'gallery' ? 34 : 26} color="#94a3b8" />
        <Text style={styles.volunteerReportPhotoFallbackText}>Photo unavailable</Text>
      </View>
    );
  }

  return (
    <Image
      source={source}
      style={variant === 'gallery' ? styles.volunteerReportPhotoGallery : styles.volunteerReportPhotoThumbnail}
      resizeMode="cover"
      fadeDuration={0}
      onError={() => setFailedUri(uri)}
    />
  );
});

function EmptyReportsIllustration() {
  return (
    <Svg width={180} height={140} viewBox="0 0 180 140" fill="none">
      <Circle cx={90} cy={75} r={38} fill="#E4EEE7" opacity={0.4} />
      <Path d="M45,55 C48,51 55,51 58,54 C61,51 68,51 71,55 C73,60 65,65 58,65 C51,65 43,60 45,55 Z" fill="#E4EEE7" opacity={0.5} />
      <Path d="M125,58 C128,55 133,55 135,57 C137,55 142,55 144,58 C145,61 140,64 135,64 C130,64 124,61 125,58 Z" fill="#E4EEE7" opacity={0.5} />
      
      <G opacity={0.6}>
        <Path d="M48,85 C51,75 59,73 63,70 C64,75 60,85 48,85 Z" fill="#6B8F71" />
        <Path d="M54,70 C56,62 63,60 66,58 C67,62 64,70 54,70 Z" fill="#6B8F71" />
        <Path d="M40,80 L62,86" stroke="#6B8F71" strokeWidth={1.5} strokeLinecap="round" />
      </G>
      
      <G opacity={0.6}>
        <Path d="M132,85 C129,75 121,73 117,70 C116,75 120,85 132,85 Z" fill="#6B8F71" />
        <Path d="M126,70 C124,62 117,60 114,58 C113,62 116,70 126,70 Z" fill="#6B8F71" />
        <Path d="M140,80 L118,86" stroke="#6B8F71" strokeWidth={1.5} strokeLinecap="round" />
      </G>
      
      <Path
        d="M74,42 L106,42 C110,42 113,45 113,49 L113,106 C113,110 110,113 106,113 L74,113 C70,113 67,110 67,106 L67,49 C67,45 70,42 74,42 Z"
        fill="#ffffff"
        stroke="#6B8F71"
        strokeWidth={2.5}
      />
      
      <Path
        d="M83,42 L83,37 C83,35 84,33 86,33 L94,33 C96,35 97,37 97,37 L97,42 Z"
        fill="#6B8F71"
      />
      
      <Circle cx={90} cy={78} r={14} fill="#3F7A54" />
      
      <Path
        d="M90,84 L90,72 M90,72 L86,76 M90,72 L94,76"
        stroke="#ffffff"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      <Path d="M78,98 L92,98" stroke="#E4EEE7" strokeWidth={2} strokeLinecap="round" />
      <Path d="M78,103 L85,103" stroke="#E4EEE7" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

interface VolunteerReportsDashboardProps {
  reports: SubmittedReport[];
  projects: Project[];
  volunteerTimeLogs?: VolunteerTimeLog[];
  volunteerJoinRecords?: VolunteerProjectJoinRecord[];
  onUploadReport?: () => void;
  onViewReport: (report: SubmittedReport) => void;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  projectSummaries?: PartnerProjectReportSummary[];
  isAdminView?: boolean;
  isPartnerView?: boolean;
  volunteers?: Volunteer[];
  joinedEventIds?: string[];
}

type PartnerQuarterlyDocument = {
  id: string;
  title: string;
  size: string;
  type: 'pdf' | 'excel';
  url: string;
};

export function VolunteerReportsDashboard({
  reports,
  projects,
  volunteerTimeLogs = [],
  volunteerJoinRecords = [],
  onUploadReport,
  onViewReport,
  loading,
  onRefresh,
  refreshing,
  isAdminView = false,
  isPartnerView = false,
  volunteers = [],
  joinedEventIds,
}: VolunteerReportsDashboardProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEventPhoto, setSelectedEventPhoto] = useState<{
    uri: string;
    name: string;
    date: string;
  } | null>(null);
  const { width: viewportWidth } = useWindowDimensions();
  const isCompactLayout = viewportWidth < 700;
  const joinedEventIdSet = useMemo(
    () => (joinedEventIds ? new Set(joinedEventIds.map(id => String(id).trim())) : null),
    [joinedEventIds]
  );

  const scopedEventIds = useMemo(
    () =>
      new Set(
        projects
          .filter(project => project.isEvent)
          .filter(project => !joinedEventIdSet || joinedEventIdSet.has(String(project.id).trim()))
          .map(project => String(project.id).trim())
          .filter(Boolean)
      ),
    [joinedEventIdSet, projects]
  );

  const visibleReports = useMemo(() => {
    const uniqueReports = new Map<string, SubmittedReport>();
    reports
      .filter(report => report.status !== 'Rejected')
      .filter(
        report =>
          !joinedEventIdSet ||
          Boolean(report.projectId && joinedEventIdSet.has(String(report.projectId).trim()))
      )
      .forEach(report => {
        const key = String(report.id || '').trim() || `${report.projectId || 'report'}:${report.submittedAt}`;
        if (!uniqueReports.has(key)) uniqueReports.set(key, report);
      });

    return Array.from(uniqueReports.values()).sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
    );
  }, [joinedEventIdSet, reports]);

  const eventCount = useMemo(
    () =>
      new Set(
        [
          ...visibleReports.map(report => report.projectId),
          ...volunteerJoinRecords.map(record => record.projectId),
          ...volunteerTimeLogs.map(log => log.projectId),
        ]
          .filter((projectId): projectId is string => Boolean(projectId))
          .map(projectId => String(projectId).trim())
          .filter(projectId => scopedEventIds.has(projectId))
      ).size,
    [scopedEventIds, visibleReports, volunteerJoinRecords, volunteerTimeLogs]
  );
  const stats = useMemo(() => {
    const submitted = visibleReports.filter(r => r.status === 'Submitted').length;
    const volunteerEventJoins = visibleReports.reduce(
      (sum, r) => sum + (r.metrics.volunteerEventJoins ?? r.metrics.volunteerHours ?? 0),
      0
    );
    const linkedProjects = new Set(
      visibleReports
        .map(report => String(report.projectId || '').trim())
        .filter(projectId => scopedEventIds.has(projectId))
    ).size;

    return { submitted, volunteerEventJoins, linkedProjects };
  }, [scopedEventIds, visibleReports]);

  const { user: authUser } = useAuth() as any;
  const realVolunteerName = (volunteerJoinRecords[0] as any)?.volunteerName || visibleReports[0]?.submitterName || authUser?.name || 'My Volunteer Account';
  const realEventJoins = new Set(
    [...volunteerJoinRecords.map(r => (r as any).projectId), ...volunteerTimeLogs.map(l => (l as any).projectId)]
      .map(projectId => String(projectId || '').trim())
      .filter(projectId => scopedEventIds.has(projectId))
  ).size;
  const realReportsSubmitted = visibleReports.length;
  const allVolunteerAccountsForAdmin = useMemo(() => {
    const normalizeIdentifier = (value: unknown) => String(value || '').trim();
    const identifierToCanonical = new Map<string, string>();
    const volunteerByCanonical = new Map<string, Volunteer>();

    volunteers.forEach(volunteer => {
      const canonical = normalizeIdentifier(volunteer.id) || normalizeIdentifier(volunteer.userId);
      if (!canonical) {
        return;
      }

      volunteerByCanonical.set(canonical, volunteer);
      [volunteer.id, volunteer.userId].forEach(identifier => {
        const normalized = normalizeIdentifier(identifier);
        if (normalized) {
          identifierToCanonical.set(normalized, canonical);
        }
      });
    });

    const canonicalize = (value: unknown, fallback: string) => {
      const normalized = normalizeIdentifier(value);
      return (normalized && identifierToCanonical.get(normalized)) || normalized || fallback;
    };
    const resolveName = (value: unknown, fallback?: string) => {
      const canonical = canonicalize(value, '');
      return volunteerByCanonical.get(canonical)?.name || fallback || 'Volunteer';
    };
    const map = new Map<string, { key: string; name: string; joins: Set<string>; reports: number }>();
    volunteerJoinRecords.forEach((r:any) => {
      const rawIdentifier = r.volunteerId || r.volunteerUserId;
      const key = canonicalize(rawIdentifier, `join:${r.id || r.volunteerName || 'vol'}`);
      if (!map.has(key)) map.set(key, { key, name: resolveName(rawIdentifier, r.volunteerName), joins: new Set(), reports: 0 });
      if (r.projectId) map.get(key)!.joins.add(r.projectId);
    });
    volunteerTimeLogs.forEach((l:any) => {
      const key = canonicalize(l.volunteerId, `log:${l.id || 'vol'}`);
      const join = volunteerJoinRecords.find((r:any) =>
        canonicalize(r.volunteerId || r.volunteerUserId, `join:${r.id || r.volunteerName || 'vol'}`) === key
      );
      const name = resolveName(l.volunteerId, join?.volunteerName);
      if (!map.has(key)) map.set(key, { key, name, joins: new Set(), reports: 0 });
      if (l.projectId) map.get(key)!.joins.add(l.projectId);
    });
    visibleReports.forEach(r => {
      const key = canonicalize(r.submittedBy, `report:${r.id}`);
      if (!map.has(key)) map.set(key, { key, name: resolveName(r.submittedBy, r.submitterName), joins: new Set(), reports: 0 });
      const entry = map.get(key)!;
      entry.reports += 1;
      if (r.projectId) entry.joins.add(r.projectId);
    });
    return Array.from(map.values()).map(v => ({ key: v.key, name: v.name, eventJoins: v.joins.size, reports: v.reports }));
  }, [volunteers, volunteerJoinRecords, volunteerTimeLogs, visibleReports]);

  const eventFolders = useMemo(() => {
    const scopedProjects = joinedEventIdSet
      ? projects.filter(project => joinedEventIdSet.has(String(project.id).trim()))
      : projects;
    const scopedReports = joinedEventIdSet
      ? visibleReports.filter(report => Boolean(report.projectId && joinedEventIdSet.has(String(report.projectId).trim())))
      : visibleReports;
    const scopedTimeLogs = joinedEventIdSet
      ? volunteerTimeLogs.filter(log => joinedEventIdSet.has(String(log.projectId).trim()))
      : volunteerTimeLogs;

    return scopedProjects
      .filter(project => project.isEvent)
      .map(event => {
        const eventId = String(event.id).trim();
        const eventReports = scopedReports.filter(report => String(report.projectId || '').trim() === eventId);
        const eventLogs = scopedTimeLogs.filter(
          log =>
            String(log.projectId || '').trim() === eventId &&
            [log.attendancePhoto, log.completionPhoto].some(photo => isImageMediaUri(photo || ''))
        );

        const photoObjects: { uri: string; date: string; submittedBy: string; reportId?: string }[] = [];

         eventReports.forEach(report => {
            const uris = getAttachmentUris([report.mediaFile || '', ...(report.attachments || [])]).filter(isImageMediaUri);
            uris.forEach(uri => {
               if (!photoObjects.some(p => p.uri === uri)) {
                  photoObjects.push({ uri, date: new Date(report.submittedAt).toLocaleDateString(), submittedBy: 'Me', reportId: report.id });
               }
            });
         });

        eventLogs.forEach(log => {
          [log.attendancePhoto, log.completionPhoto]
            .filter(photo => isImageMediaUri(photo || ''))
            .forEach(photo => {
              if (photo && !photoObjects.some(p => p.uri === photo)) {
                photoObjects.push({ uri: photo, date: new Date(log.timeIn).toLocaleDateString(), submittedBy: 'Volunteer' });
              }
            });
        });

        return {
          event,
          reports: eventReports,
          photos: photoObjects,
        };
      })
      .sort((left, right) => new Date(right.event.startDate || '').getTime() - new Date(left.event.startDate || '').getTime());
  }, [joinedEventIdSet, projects, volunteerTimeLogs, visibleReports]);

  const selectedEvent = useMemo(
    () => eventFolders.find(f => String(f.event.id).trim() === selectedEventId)?.event || null,
    [eventFolders, selectedEventId]
  );

  const selectedEventReports = useMemo(
    () =>
      selectedEvent
        ? visibleReports.filter(report => String(report.projectId || '').trim() === selectedEventId)
        : visibleReports,
    [selectedEvent, selectedEventId, visibleReports]
  );

  const selectedEventVolunteerRows = useMemo(() => {
    if (!selectedEventId) return [];
    const eventId = selectedEventId;
    const map = new Map<string, { key: string; name: string; submittedDate: string; submittedAt: number; photos: string[]; avatarUri?: string }>();
    const volunteerById = new Map(volunteers.map(v => [v.id, v]));
    const volunteerByUserId = new Map(volunteers.map(v => [v.userId, v]));

    volunteerTimeLogs.filter(log => String((log as any).projectId || '').trim() === eventId).forEach(log => {
      const photos = [(log as any).attendancePhoto, (log as any).completionPhoto]
        .filter(photo => isImageMediaUri(photo || '')) as string[];
      if (photos.length === 0) return;
      const join = volunteerJoinRecords.find(r => r.projectId === eventId && ((r as any).volunteerId === (log as any).volunteerId || (r as any).volunteerUserId === (log as any).volunteerId));
      const name = (join as any)?.volunteerName || 'Volunteer';
      const vDetails = volunteerById.get((log as any).volunteerId) || volunteerByUserId.get((log as any).volunteerId);
      const key = (join as any)?.volunteerId || (join as any)?.volunteerUserId || vDetails?.id || vDetails?.userId || (log as any).volunteerId || name;
      const avatarUri = (vDetails as any)?.validIdPhoto || (vDetails as any)?.avatarUri || undefined;
      const volunteerName = vDetails?.name || name;

      const submittedAt = new Date((log as any).timeIn || (log as any).timeOut || '').getTime();
      if (!map.has(key)) map.set(key, { key, name: volunteerName, submittedDate: new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), submittedAt, photos: [], avatarUri });
      const entry = map.get(key)!;
      photos.forEach(photo => { if (!entry.photos.includes(photo)) entry.photos.push(photo); });
    });
    visibleReports.filter(r => String(r.projectId || '').trim() === eventId).forEach(rep => {
      const uris = getAttachmentUris([rep.mediaFile || '', ...(rep.attachments || [])]).filter(isImageMediaUri);
      const join = volunteerJoinRecords.find(r =>
        r.projectId === eventId &&
        (
          (r as any).volunteerId === rep.submittedBy ||
          (r as any).volunteerUserId === rep.submittedBy ||
          (r as any).volunteerName === rep.submitterName
        )
      );
      const vDetails = volunteerById.get(rep.submittedBy) || volunteerByUserId.get(rep.submittedBy);
      const key = (join as any)?.volunteerId || (join as any)?.volunteerUserId || vDetails?.id || vDetails?.userId || rep.submittedBy || rep.submitterName || `rep-${rep.id}`;
      const avatarUri = (vDetails as any)?.validIdPhoto || (vDetails as any)?.avatarUri || undefined;
      const volunteerName = vDetails?.name || rep.submitterName || 'Volunteer';

      const submittedAt = new Date(rep.submittedAt).getTime();
      if (!map.has(key)) map.set(key, { key, name: volunteerName, submittedDate: new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), submittedAt, photos: [], avatarUri });
      const entry = map.get(key)!;
      if (submittedAt > entry.submittedAt) {
        entry.submittedDate = new Date(rep.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        entry.submittedAt = submittedAt;
      }
      uris.forEach(uri => { if (!entry.photos.includes(uri)) entry.photos.push(uri); });
    });
    // Include join records even without photo so volunteer still appears
    volunteerJoinRecords.filter(r => String(r.projectId || '').trim() === eventId).forEach(rec => {
      const key = (rec as any).volunteerId || (rec as any).volunteerUserId || (rec as any).volunteerName;

      const vDetails = volunteerById.get((rec as any).volunteerId) || volunteerByUserId.get((rec as any).volunteerId) || volunteerById.get((rec as any).volunteerUserId) || volunteerByUserId.get((rec as any).volunteerUserId);
      const avatarUri = (vDetails as any)?.validIdPhoto || (vDetails as any)?.avatarUri || undefined;
      const volunteerName = vDetails?.name || (rec as any).volunteerName || 'Volunteer';

      const submittedAt = new Date((rec as any).joinedAt || '').getTime();
      if (!map.has(key)) map.set(key, { key, name: volunteerName, submittedDate: new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), submittedAt, photos: [], avatarUri });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedEventId, volunteerTimeLogs, volunteerJoinRecords, visibleReports, volunteers]);

  const renderReportItem = ({ item }: { item: SubmittedReport }) => (
    <TouchableOpacity
      style={styles.reportItem}
      onPress={() => onViewReport(item)}
      activeOpacity={0.7}
    >
      <View style={styles.reportItemLeft}>
        <View
          style={[
            styles.statusIndicator,
            item.status === 'Approved' && styles.statusIndicatorApproved,
            item.status === 'Submitted' && styles.statusIndicatorSubmitted,
            item.status === 'Rejected' && styles.statusIndicatorRejected,
          ]}
        />
        <View style={styles.reportItemContent}>
          <Text style={styles.reportItemTitle}>{item.title}</Text>
          <Text style={styles.reportItemType}>{formatReportType(item.reportType)}</Text>
          {item.projectTitle ? (
            <Text style={styles.reportItemDate}>{item.projectTitle}</Text>
          ) : null}
          <Text style={styles.reportItemDate}>{new Date(item.submittedAt).toLocaleDateString()}</Text>
        </View>
      </View>
      <View
        style={[
          styles.reportStatusBadge,
          item.status === 'Approved' && styles.badgeApproved,
          item.status === 'Submitted' && styles.badgeSubmitted,
          item.status === 'Rejected' && styles.badgeRejected,
        ]}
      >
        <Text
          style={[
            styles.badgeText,
            item.status === 'Approved' && styles.badgeTextApproved,
            item.status === 'Submitted' && styles.badgeTextSubmitted,
            item.status === 'Rejected' && styles.badgeTextRejected,
          ]}
        >
          {item.status}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderVolunteerPhotoStrip = (row: (typeof selectedEventVolunteerRows)[number]) => (
    <View style={styles.photoStripSmall}>
      {row.photos.slice(0, 3).map(uri => (
        <TouchableOpacity
          key={uri}
          style={styles.photoThumbButton}
          onPress={() => setSelectedEventPhoto({ uri, name: row.name, date: row.submittedDate })}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Open photo submitted by ${row.name}`}
        >
          <StableVolunteerReportPhoto uri={uri} variant="thumbnail" />
        </TouchableOpacity>
      ))}
      {row.photos.length > 3 ? (
        <View style={styles.photoMoreBadge}>
          <Text style={styles.photoMoreText}>+{row.photos.length - 3}</Text>
        </View>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator
      >
        {/* Header — hidden for admin, admin sees who submitted via Events → photo → task */}
        {!isAdminView && !isPartnerView ? (
          <View style={[styles.header, isCompactLayout && styles.headerCompact]}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>My Event Reports</Text>
              <Text style={styles.subtitle}>Submit and manage reports for your completed volunteer activities.</Text>
            </View>
            <TouchableOpacity style={[styles.uploadButton, isCompactLayout && styles.uploadButtonCompact]} onPress={() => onUploadReport?.()} activeOpacity={0.8}>
              <MaterialIcons name="add" size={18} color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.uploadButtonText}>New Report</Text>
            </TouchableOpacity>
          </View>
        ) : isPartnerView ? (
          <View style={[styles.header, isCompactLayout && styles.headerCompact]}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>Approved Project Events</Text>
              <Text style={styles.subtitle}>View volunteer reports and photos from events linked to your approved projects.</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.header, isCompactLayout && styles.headerCompact, { paddingBottom: 8 }]}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>Volunteer Reports</Text>
              <Text style={styles.subtitle}>Events with attendance and submission photos, grouped by volunteer.</Text>
            </View>
          </View>
        )}

        {/* Quick Stats */}
        <View style={[styles.statsContainer, isCompactLayout && styles.statsContainerCompact]}>
          <View style={[styles.statCard, isCompactLayout && styles.statCardCompact]}>
            <View style={styles.statIconWrap}>
              <MaterialIcons name="description" size={20} color="#3F7A54" />
            </View>
            <View style={[styles.statLabelWrap, isCompactLayout && styles.statLabelWrapCompact]}>
              <Text style={styles.statCardLabel}>Reports</Text>
              <Text style={styles.statCardValue}>{visibleReports.length}</Text>
            </View>
          </View>
          <View style={[styles.statCard, isCompactLayout && styles.statCardCompact]}>
            <View style={styles.statIconWrap}>
              <MaterialIcons name="send" size={20} color="#3F7A54" />
            </View>
            <View style={[styles.statLabelWrap, isCompactLayout && styles.statLabelWrapCompact]}>
              <Text style={styles.statCardLabel}>Submitted</Text>
              <Text style={styles.statCardValue}>{stats.submitted}</Text>
            </View>
          </View>
          <View style={[styles.statCard, isCompactLayout && styles.statCardCompact]}>
            <View style={styles.statIconWrap}>
              <MaterialIcons name="calendar-month" size={20} color="#3F7A54" />
            </View>
            <View style={[styles.statLabelWrap, isCompactLayout && styles.statLabelWrapCompact]}>
              <Text style={styles.statCardLabel}>Linked Events</Text>
              <Text style={styles.statCardValue}>{eventCount}</Text>
            </View>
          </View>
        </View>
        {/* Event Folders — image exact */}
        <View style={styles.section}>
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#5B564C', letterSpacing: 0.5, textTransform: 'uppercase' }}>Volunteer Reports / Event Reports</Text>
            <Text style={styles.sectionTitle}>Event Folders</Text>
            <Text style={[styles.emptyText, { textAlign: 'left', marginBottom: 0, paddingHorizontal: 0 }]}>Select an event to view photos submitted by volunteers.</Text>
          </View>
          <View style={[styles.eventFolderGrid, isCompactLayout && styles.eventFolderGridCompact]}>
            {eventFolders.map(folder => {
              const isSelected = selectedEventId === String(folder.event.id).trim();
              const updated = folder.event.startDate ? new Date(folder.event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable';
              const reportCount = folder.reports.length;
              return (
                <TouchableOpacity
                  key={folder.event.id}
                  style={[styles.folderCard, isCompactLayout && styles.folderCardCompact, isSelected && styles.folderCardSelected]}
                  onPress={() => setSelectedEventId(isSelected ? null : String(folder.event.id).trim())}
                  activeOpacity={0.85}
                >
                  <View style={styles.folderCardTop}>
                    <MaterialIcons name="folder" size={28} color="#EAB308" />
                    <MaterialIcons name="more-vert" size={18} color="#9ca3af" />
                  </View>
                  <Text style={styles.folderCardTitle} numberOfLines={2} ellipsizeMode="tail">{folder.event.title}</Text>
                  <Text style={styles.folderCardDate}>{updated}</Text>
                  <Text style={styles.folderCardCount}>
                    {reportCount} report{reportCount === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {selectedEvent ? (
            <View style={styles.eventDetailCard}>
              <TouchableOpacity style={styles.backRow} onPress={() => setSelectedEventId(null)} activeOpacity={0.7}>
                <MaterialIcons name="arrow-back" size={18} color="#1F2937" />
                <View style={{ marginLeft: 8 }}>
                  <Text style={styles.eventDetailTitle}>{selectedEvent.title}</Text>
                  <Text style={styles.eventDetailSub}>{selectedEvent.startDate ? new Date(selectedEvent.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable'}</Text>
                </View>
              </TouchableOpacity>
              {isCompactLayout ? (
                <View style={styles.volunteerTableHeaderCompact}>
                  <Text style={styles.volunteerTableHeaderCompactTitle}>Volunteer submissions</Text>
                  <Text style={styles.volunteerTableHeaderCompactHint}>Attendance and report photos</Text>
                </View>
              ) : (
                <View style={styles.volunteerTableHeader}>
                  <Text style={[styles.volunteerTh, { flex: 1.2 }]} numberOfLines={1}>Volunteer</Text>
                  <Text style={[styles.volunteerTh, { flex: 1 }]} numberOfLines={2}>Submitted Date</Text>
                  <Text style={[styles.volunteerTh, { flex: 1.5 }]} numberOfLines={1}></Text>
                  <Text style={[styles.volunteerTh, { flex: 1.2, textAlign: 'right', paddingRight: 28 }]} numberOfLines={2}>Photos Submitted</Text>
                </View>
              )}
              {selectedEventVolunteerRows.length === 0 ? (
                <View style={styles.emptyTableRow}>
                  <Text style={styles.emptyTableText}>No volunteer submissions yet for this event.</Text>
                </View>
              ) : (
                selectedEventVolunteerRows.map(row => (
                  <View key={row.key} style={[styles.volunteerRow, isCompactLayout && styles.volunteerRowCompact]}>
                    <View style={[styles.volunteerTd, styles.volunteerIdentityCell, isCompactLayout && styles.volunteerIdentityCellCompact, { flex: isCompactLayout ? 0 : 1.2 }]}>
                      <View style={styles.volunteerAvatar}>
                        {row.avatarUri ? (
                          <Image source={{ uri: row.avatarUri }} style={{ width: '100%', height: '100%', borderRadius: 16 }} />
                        ) : (
                          <Text style={styles.volunteerAvatarText}>{row.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</Text>
                        )}
                      </View>
                      <Text style={styles.volunteerName} numberOfLines={isCompactLayout ? 2 : 1} ellipsizeMode="tail">{row.name}</Text>
                    </View>
                    {isCompactLayout ? (
                      <>
                        <View style={styles.volunteerMobileMetaRow}>
                          <Text style={styles.volunteerMobileLabel}>Submitted date</Text>
                          <Text style={styles.volunteerDate} numberOfLines={2} ellipsizeMode="tail">{row.submittedDate}</Text>
                        </View>
                        <View style={styles.volunteerMobilePhotosRow}>
                          <Text style={styles.volunteerMobileLabel}>Photos submitted</Text>
                          <View style={styles.volunteerMobilePhotosContent}>
                            <View style={styles.volunteerMobilePhotoStrip}>{renderVolunteerPhotoStrip(row)}</View>
                            <Text style={styles.photoCountText}>{row.photos.length} photo{row.photos.length===1?'':'s'}</Text>
                            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`More actions for ${row.name}`}>
                              <MaterialIcons name="more-vert" size={18} color="#9ca3af" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </>
                    ) : (
                      <>
                        <View style={[styles.volunteerTd, { flex: 1 }]}>
                          <Text style={styles.volunteerDate} numberOfLines={2} ellipsizeMode="tail">{row.submittedDate}</Text>
                        </View>
                        <View style={[styles.volunteerTd, { flex: 1.5, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                          {renderVolunteerPhotoStrip(row)}
                        </View>
                        <View style={[styles.volunteerTd, { flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }]}>
                          <Text style={styles.photoCountText}>{row.photos.length} photo{row.photos.length===1?'':'s'}</Text>
                          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`More actions for ${row.name}`}>
                            <MaterialIcons name="more-vert" size={18} color="#9ca3af" />
                          </TouchableOpacity>
                        </View>
                      </>
                    )}
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>

        {/* Accounts Section — real system volunteer account */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="person" size={18} color="#166534" style={{ marginRight: 6 }} />
              <Text style={styles.sectionTitle}>{isAdminView || isPartnerView ? 'Volunteer Accounts' : 'Accounts'}</Text>
            </View>
          </View>
          {isAdminView || isPartnerView ? (
            allVolunteerAccountsForAdmin.length === 0 ? (
              <View style={styles.reportItem}>
                <View style={styles.reportItemLeft}>
                  <MaterialIcons name="account-circle" size={32} color="#94a3b8" />
                  <View style={styles.reportItemContent}>
                    <Text style={styles.reportItemTitle}>No volunteer accounts yet</Text>
                    <Text style={styles.reportItemType}>Volunteers will appear here once they join events.</Text>
                  </View>
                </View>
              </View>
            ) : (
              allVolunteerAccountsForAdmin.map(acc => (
                <View key={acc.key} style={styles.reportItem}>
                  <View style={styles.reportItemLeft}>
                    <View style={[styles.volunteerAvatar, { backgroundColor: '#E4EEE7' }]}>
                      <Text style={styles.volunteerAvatarText}>{acc.name.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()}</Text>
                    </View>
                    <View style={styles.reportItemContent}>
                      <Text style={styles.reportItemTitle}>{acc.name}</Text>
                      <Text style={styles.reportItemType}>
                        {acc.eventJoins} event join{acc.eventJoins === 1 ? '' : 's'} • {acc.reports} report{acc.reports === 1 ? '' : 's'} submitted
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            )
          ) : (
            <View style={styles.reportItem}>
              <View style={styles.reportItemLeft}>
                <View style={[styles.volunteerAvatar, { backgroundColor: '#E4EEE7' }]}>
                  <Text style={styles.volunteerAvatarText}>{realVolunteerName.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()}</Text>
                </View>
                <View style={styles.reportItemContent}>
                  <Text style={styles.reportItemTitle}>{realVolunteerName}</Text>
                  <Text style={styles.reportItemType}>
                    {realEventJoins} event join{realEventJoins === 1 ? '' : 's'} • {realReportsSubmitted} report{realReportsSubmitted === 1 ? '' : 's'} submitted
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Reports Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="description" size={18} color="#166534" style={{ marginRight: 6 }} />
              <Text style={styles.sectionTitle}>{selectedEvent ? `${selectedEvent.title} Reports` : 'Event Reports'}</Text>
              <Text style={styles.sectionBadge}>{selectedEventReports.length}</Text>
            </View>
          </View>
          {selectedEventReports.length > 0 ? (
            <FlatList
              data={selectedEventReports}
              renderItem={renderReportItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          ) : (
            <View style={styles.emptyState}>
              <MaterialIcons name="description" size={32} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No reports</Text>
              <Text style={styles.emptyText}>
                {isAdminView || isPartnerView
                  ? selectedEvent
                    ? 'No volunteer reports were submitted for this event.'
                    : 'Volunteer reports will appear here after an event submission.'
                  : "You haven't submitted any reports yet."}
              </Text>
            </View>
          )}
        </View>

        {/* Tips Box */}
        <View style={styles.tipsCard}>
          <View style={styles.tipsIconWrap}>
            <MaterialIcons name="lightbulb-outline" size={20} color="#3F7A54" />
          </View>
          <View style={styles.tipsContent}>
            <Text style={styles.tipsTitle}>Reporting Tips</Text>
            <View style={styles.tipsBulletContainer}>
              <Text style={styles.tipsBulletRow}>•  Upload photos from the event.</Text>
              <Text style={styles.tipsBulletRow}>•  Describe your activities clearly.</Text>
              <Text style={styles.tipsBulletRow}>•  Submit within 48 hours after the event.</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(selectedEventPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedEventPhoto(null)}
      >
        <View style={styles.eventPhotoModalOverlay}>
          <View style={styles.eventPhotoModalCard}>
            <View style={styles.eventPhotoModalHeader}>
              <Text style={styles.eventPhotoModalTitle}>Submitted Photo</Text>
              <TouchableOpacity
                onPress={() => setSelectedEventPhoto(null)}
                accessibilityRole="button"
                accessibilityLabel="Close photo"
              >
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>
            <View style={styles.eventPhotoModalImage}>
              {selectedEventPhoto ? (
                <StableVolunteerReportPhoto uri={selectedEventPhoto.uri} variant="gallery" />
              ) : null}
            </View>
            <Text style={styles.eventPhotoModalMeta}>
              Photo by {selectedEventPhoto?.name || 'Volunteer'} on {selectedEventPhoto?.date || 'Unknown date'}
            </Text>
            <TouchableOpacity
              style={styles.eventPhotoModalCloseButton}
              onPress={() => setSelectedEventPhoto(null)}
            >
              <Text style={styles.eventPhotoModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function PartnerReportsDashboard({
  reports,
  projects = [],
  volunteerTimeLogs = [],
  volunteerJoinRecords = [],
  projectSummaries = [],
  onUploadReport,
  onViewReport,
  loading,
  onRefresh,
  refreshing,
  isAdminView = false,
  volunteers = [],
}: VolunteerReportsDashboardProps) {
  const [showFullDetailsModal, setShowFullDetailsModal] = useState(false);
  const [showAllPhotosModal, setShowAllPhotosModal] = useState(false);
  const [showAllDocsModal, setShowAllDocsModal] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  const { user } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const isCompactLayout = viewportWidth < 700;

  // Helper for generating 3-month quarterly windows
  const availableQuarters = useMemo(() => {
    const list: Array<{
      key: string;
      label: string;
      quarterNum: number;
      year: number;
      startDate: Date;
      endDate: Date;
      periodLabel: string;
      prevQuarterLabel: string;
      prevStartDate: Date;
      prevEndDate: Date;
    }> = [];

    const now = new Date();
    const currentYear = now.getFullYear();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Generate 4 quarters (current and previous)
    for (let offset = 0; offset < 4; offset++) {
      const d = new Date(currentYear, now.getMonth() - offset * 3, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const qNum = Math.floor(month / 3) + 1;
      const startMonth = (qNum - 1) * 3;
      const endMonth = startMonth + 2;
      const startDate = new Date(year, startMonth, 1);
      const endDate = new Date(year, endMonth + 1, 0, 23, 59, 59, 999);
      const periodLabel = `${monthNames[startMonth]} 1 - ${monthNames[endMonth]} ${endDate.getDate()}, ${year}`;

      const prevQNum = qNum === 1 ? 4 : qNum - 1;
      const prevYear = qNum === 1 ? year - 1 : year;
      const prevStartMonth = (prevQNum - 1) * 3;
      const prevEndMonth = prevStartMonth + 2;
      const prevStartDate = new Date(prevYear, prevStartMonth, 1);
      const prevEndDate = new Date(prevYear, prevEndMonth + 1, 0, 23, 59, 59, 999);
      const prevQuarterLabel = `Q${prevQNum} ${prevYear}`;

      const key = `Q${qNum}-${year}`;
      if (!list.find(x => x.key === key)) {
        list.push({
          key,
          label: `Q${qNum} ${year}`,
          quarterNum: qNum,
          year,
          startDate,
          endDate,
          periodLabel,
          prevQuarterLabel,
          prevStartDate,
          prevEndDate,
        });
      }
    }
    return list;
  }, []);

  const [selectedQuarterKey, setSelectedQuarterKey] = useState<string>(() => {
    return availableQuarters[0]?.key || '';
  });

  const currentQuarter = useMemo(() => {
    const selected = availableQuarters.find(q => q.key === selectedQuarterKey) || availableQuarters[0];
    if (selected) return selected;

    const now = new Date();
    const quarterNum = Math.floor(now.getMonth() / 3) + 1;
    const startMonth = (quarterNum - 1) * 3;
    const startDate = new Date(now.getFullYear(), startMonth, 1);
    const endDate = new Date(now.getFullYear(), startMonth + 3, 0, 23, 59, 59, 999);
    const previousEndDate = new Date(startDate.getTime() - 1);
    const previousQuarterNum = quarterNum === 1 ? 4 : quarterNum - 1;
    return {
      key: `Q${quarterNum}-${now.getFullYear()}`,
      label: `Q${quarterNum} ${now.getFullYear()}`,
      quarterNum,
      year: now.getFullYear(),
      startDate,
      endDate,
      periodLabel: `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      prevQuarterLabel: `Q${previousQuarterNum} ${previousEndDate.getFullYear()}`,
      prevStartDate: new Date(previousEndDate.getFullYear(), (previousQuarterNum - 1) * 3, 1),
      prevEndDate: previousEndDate,
    };
  }, [availableQuarters, selectedQuarterKey]);

  // The partner view is a project-level report hub. It includes the
  // partner's report plus every volunteer report linked to the approved
  // project or one of its events for the selected quarter.
  const quarterReports = useMemo(() => {
    return reports
      .filter(r => r.status !== 'Rejected')
      .filter(r => {
        const date = new Date(r.submittedAt);
        return date >= currentQuarter.startDate && date <= currentQuarter.endDate;
      })
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [currentQuarter, reports]);

  const [selectedReportFolderId, setSelectedReportFolderId] = useState<string | null>(null);

  const reportFolders = useMemo(() => {
    const folders = new Map<
      string,
      {
        key: string;
        project?: Project;
        title: string;
        reports: SubmittedReport[];
      }
    >();

    quarterReports.forEach(report => {
      const projectId = String(report.projectId || '').trim();
      const project = projects.find(item => String(item.id || '').trim() === projectId);
      const key = projectId || `title:${report.projectTitle || 'unlinked-event'}`;
      const existing = folders.get(key);

      if (existing) {
        existing.reports.push(report);
        return;
      }

      folders.set(key, {
        key,
        project,
        title: project?.title || report.projectTitle || 'Unlinked Event',
        reports: [report],
      });
    });

    return Array.from(folders.values()).sort((left, right) => {
      const leftDate = new Date(left.project?.startDate || left.reports[0]?.submittedAt || 0).getTime();
      const rightDate = new Date(right.project?.startDate || right.reports[0]?.submittedAt || 0).getTime();
      return rightDate - leftDate;
    });
  }, [projects, quarterReports]);

  const selectedReportFolder = useMemo(
    () => reportFolders.find(folder => folder.key === selectedReportFolderId) || null,
    [reportFolders, selectedReportFolderId]
  );

  const hasQuarterReport = quarterReports.length > 0;
  const activeReport = quarterReports.find(report => report.submitterRole === 'partner') || quarterReports[0] || null;
  const activeSummary = useMemo(() => {
    if (!activeReport) return null;
    return (
      projectSummaries.find(summary =>
        summary.project.id === activeReport.projectId ||
        summary.linkedEvents.some(event => event.id === activeReport.projectId)
      ) ||
      projectSummaries[0] ||
      null
    );
  }, [activeReport, projectSummaries]);

  // Header data - clean empty values when no reports for this quarter
  const reportTitle = `Quarterly Report - ${currentQuarter.label}`;
  const orgName =
    user?.partnerRegistration?.organizationName ||
    (user?.role === 'partner' ? user.name : '—');
  const programTitle =
    activeReport?.projectTitle ||
    (activeSummary?.project?.title) ||
    '—';
  const reportingPeriod = currentQuarter.periodLabel;
  const submittedOn = activeReport?.submittedAt
    ? new Date(activeReport.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const submittedByName = activeReport?.submitterName || (user?.role === 'partner' ? user.name : '—');
  const submittedByRole = activeReport ? 'Program Coordinator' : (user?.role === 'partner' ? 'Program Coordinator' : '—');
  const submitterInitials =
    submittedByName && submittedByName !== '—'
      ? submittedByName
          .split(' ')
          .map(w => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : '—';
  const reportStatus = activeReport?.status || (hasQuarterReport ? 'Submitted' : 'Draft');

  // Quarterly Stats - 0 and — when no report for the quarter
  const skillsCount = useMemo(() => {
    if (!hasQuarterReport) return 0;
    const sSet = new Set<string>();
    projects.forEach(p => (p.skillsNeeded || []).forEach(s => sSet.add(s)));
    return sSet.size || 0;
  }, [hasQuarterReport, projects]);
  const skillsTrend = '—';

  const eventsConductedCount = useMemo(() => {
    if (!hasQuarterReport) return 0;
    const quarterReportProjectIds = new Set(quarterReports.map(report => report.projectId).filter(Boolean));
    const quarterEvents = projects.filter(project =>
      project.isEvent &&
      (quarterReportProjectIds.has(project.id) || (
        project.startDate &&
        new Date(project.startDate) >= currentQuarter.startDate &&
        new Date(project.startDate) <= currentQuarter.endDate
      ))
    );
    return new Set(quarterEvents.map(event => event.id)).size;
  }, [currentQuarter, hasQuarterReport, projects, quarterReports]);
  const eventsTrend = '—';

  const volunteersCount = useMemo(() => {
    if (!hasQuarterReport) return 0;
    const identifiers = new Set<string>();
    quarterReports
      .filter(report => report.submitterRole === 'volunteer')
      .forEach(report => identifiers.add(report.submittedBy || report.submitterName));
    volunteerJoinRecords.forEach(record => {
      if (
        record.projectId &&
        projects.some(project => project.id === record.projectId && project.isEvent)
      ) {
        identifiers.add(record.volunteerId || record.volunteerUserId || record.volunteerName);
      }
    });
    return identifiers.size;
  }, [hasQuarterReport, projects, quarterReports, volunteerJoinRecords]);
  const volunteerTrend = '—';

  // Sectors partner dynamic data - empty neutral state when no report
  const sectorData = useMemo(() => {
    if (!hasQuarterReport) {
      return [{ label: 'No Data', percent: 100, color: '#E2E8F0' }];
    }

    const counts: Record<string, number> = {};
    const items = [...projects, ...projectSummaries.map(s => s.project)];
    items.forEach(p => {
      const sec = (p as any)?.sectorType || p?.category || 'General';
      counts[sec] = (counts[sec] || 0) + 1;
    });

    const palette = ['#22C55E', '#EF4444', '#3B82F6', '#F59E0B', '#9CA3AF', '#8B5CF6', '#EC4899'];
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);

    if (sum === 0) {
      return [{ label: 'No Data', percent: 100, color: '#E2E8F0' }];
    }

    const entries = Object.entries(counts)
      .map(([label, count], idx) => ({
        label,
        percent: Math.round((count / sum) * 100),
        color: palette[idx % palette.length],
      }))
      .sort((a, b) => b.percent - a.percent);

    return entries.slice(0, 5);
  }, [hasQuarterReport, projects, projectSummaries]);

  const conicGradientStr = useMemo(() => {
    let currentDeg = 0;
    const parts = sectorData.map(item => {
      const start = currentDeg;
      currentDeg += item.percent;
      return `${item.color} ${start}% ${currentDeg}%`;
    });
    return `conic-gradient(${parts.join(', ')})`;
  }, [sectorData]);

  // The selected quarter has one canonical download. Financial and M&E files
  // are not separate downloads in this workflow.
  const generatedDocuments = useMemo<PartnerQuarterlyDocument[]>(
    () => [
      {
        id: `doc-${currentQuarter.key}-1`,
        title: `${currentQuarter.label} Quarterly Report.pdf`,
        size: hasQuarterReport ? 'Generated from linked project/event reports' : '0 KB',
        type: 'pdf',
        url:
          activeReport?.mediaFile ||
          activeReport?.attachments?.find(attachment => attachment.type === 'document')?.url ||
          activeReport?.attachments?.[0]?.url ||
          '',
      },
    ],
    [currentQuarter, activeReport, hasQuarterReport]
  );

  const handleDownloadDocument = (document: PartnerQuarterlyDocument) => {
    // Every report download is generated from the current canonical report
    // data, so attached uploads and generated summaries share the same
    // printable table structure.
    void downloadPdfFile(
      `${document.id}-${currentQuarter.label.replace(/\s+/g, '-')}.pdf`,
      buildPartnerQuarterlyReportPdf({
        title: document.title,
        quarterLabel: currentQuarter.label,
        reportingPeriod: currentQuarter.periodLabel,
        organization: orgName,
        program: programTitle,
        status: reportStatus,
        submittedOn,
        report: activeReport,
        summary: activeSummary,
        reports: quarterReports,
      })
    );
  };

  // Volunteer photos
  const volunteerPhotos = useMemo(() => {
    const list: Array<{ id: string; uri: string; date: string; name: string; photosCount: number }> = [];
    const seenUris = new Set<string>();
    const volunteerById = new Map(volunteers.map(v => [v.id, v]));
    const volunteerByUserId = new Map(volunteers.map(v => [v.userId, v]));

    const addPhoto = (id: string, uri: string, date: string, name: string, photosCount: number) => {
      if (!uri || !isImageMediaUri(uri) || seenUris.has(uri)) return;
      seenUris.add(uri);
      list.push({ id, uri, date, name, photosCount });
    };

    const isWithinQuarter = (value?: string) => {
      if (!value) return false;
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) &&
        timestamp >= currentQuarter.startDate.getTime() &&
        timestamp <= currentQuarter.endDate.getTime();
    };

    volunteerTimeLogs.forEach(log => {
      if (!isWithinQuarter(log.timeIn)) return;
      const v = volunteerById.get((log as any).volunteerId) || volunteerByUserId.get((log as any).volunteerId);
      const name = v?.name || (log as any).volunteerName || 'Volunteer';
      const date = log.timeIn
        ? new Date(log.timeIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Date unavailable';
      addPhoto(`${log.id}-attendance`, (log as any).attendancePhoto, date, name, 1);
      addPhoto(`${log.id}-completion`, (log as any).completionPhoto, date, name, 1);
    });

    reports.forEach(r => {
      if (!isWithinQuarter(r.submittedAt)) return;
      const date = new Date(r.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const name = r.submitterName || 'Volunteer';
      addPhoto(`${r.id}-media`, r.mediaFile || '', date, name, 1);
      (r.attachments || []).forEach((att, idx) => {
        if (att.type === 'image') addPhoto(`${r.id}-${idx}`, att.url, date, name, 1);
      });
    });

    return list;
  }, [volunteerTimeLogs, reports, volunteers, currentQuarter]);

  const selectedVolunteerPhoto = useMemo(() => {
    const index = selectedPhotoIndex ?? 0;
    return volunteerPhotos[index] || volunteerPhotos[0] || null;
  }, [selectedPhotoIndex, volunteerPhotos]);

  const handleDownloadReport = () => {
    const reportDocument = generatedDocuments[0];
    handleDownloadDocument(reportDocument);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: '#F8FAFC' }}
        contentContainerStyle={{ padding: isCompactLayout ? 12 : 20, paddingBottom: 60, gap: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* 1. Breadcrumbs & Quarter Selector */}
        <View
          style={{
            backgroundColor: '#F8FAFC',
            paddingBottom: 2,
            zIndex: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748b' }}>Partner Reports</Text>
            <Text style={{ fontSize: 12, color: '#94a3b8' }}>›</Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748b' }}>Quarterly Reports</Text>
            <Text style={{ fontSize: 12, color: '#94a3b8' }}>›</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}>{currentQuarter.label}</Text>
          </View>

          {/* Keep the quarter switcher visible and usable while the report content scrolls. */}
          <View
            style={{
              marginTop: 8,
              minHeight: 52,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#dbe5df',
              backgroundColor: '#ffffff',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <MaterialIcons name="date-range" size={17} color="#166534" />
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#166534' }}>Quarter</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1, minWidth: 0 }}
              contentContainerStyle={{ gap: 6, paddingRight: 4 }}
            >
              {availableQuarters.map(q => (
                <TouchableOpacity
                  key={q.key}
                  style={{
                    minHeight: 34,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 7,
                    backgroundColor: selectedQuarterKey === q.key ? '#166534' : '#ffffff',
                    borderWidth: 1,
                    borderColor: selectedQuarterKey === q.key ? '#166534' : '#cbd5e1',
                    justifyContent: 'center',
                  }}
                  onPress={() => setSelectedQuarterKey(q.key)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${q.label} partner report`}
                  accessibilityState={{ selected: selectedQuarterKey === q.key }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: selectedQuarterKey === q.key ? '#ffffff' : '#475569',
                    }}
                  >
                    {q.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        {/* 2. Top Header Card */}
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            padding: isCompactLayout ? 14 : 20,
            flexDirection: isCompactLayout ? 'column' : 'row',
            alignItems: isCompactLayout ? 'stretch' : 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.04,
            shadowRadius: 3,
            elevation: 1,
          }}
        >
          {/* Left: Icon + Title + Org */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: isCompactLayout ? undefined : 1, width: isCompactLayout ? '100%' : undefined, minWidth: isCompactLayout ? 0 : 280 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: '#E8F5E9',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: '#C8E6C9',
              }}
            >
              <MaterialIcons name="storefront" size={28} color="#2E7D32" />
            </View>
            <View style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: '#0f172a', flexShrink: 1 }}>{reportTitle}</Text>
                <View
                  style={{
                    backgroundColor: hasQuarterReport ? '#DCFCE7' : '#F1F5F9',
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: hasQuarterReport ? '#16A34A' : '#64748b' }}>
                    {reportStatus}
                  </Text>
                </View>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>{orgName}</Text>
              <Text style={{ fontSize: 12, color: '#64748b' }}>{programTitle}</Text>
            </View>
          </View>

          {/* Middle & Right Detail Blocks */}
          <View style={{ flexDirection: isCompactLayout ? 'column' : 'row', alignItems: isCompactLayout ? 'stretch' : 'center', gap: isCompactLayout ? 10 : 20, flexWrap: 'wrap', width: isCompactLayout ? '100%' : undefined }}>
            {/* Reporting Period */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: isCompactLayout ? '100%' : undefined }}>
              <MaterialIcons name="event" size={20} color="#64748b" />
              <View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#94a3b8' }}>Reporting Period</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}>{reportingPeriod}</Text>
              </View>
            </View>

            {/* Divider */}
            <View style={{ width: isCompactLayout ? '100%' : 1, height: isCompactLayout ? 1 : 32, backgroundColor: '#e2e8f0' }} />

            {/* Submitted On */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: isCompactLayout ? '100%' : undefined }}>
              <MaterialIcons name="schedule" size={20} color="#64748b" />
              <View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#94a3b8' }}>Submitted On</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}>{submittedOn}</Text>
              </View>
            </View>

            {/* Divider */}
            <View style={{ width: isCompactLayout ? '100%' : 1, height: isCompactLayout ? 1 : 32, backgroundColor: '#e2e8f0' }} />

            {/* Submitted By */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: isCompactLayout ? '100%' : undefined }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#FDE68A',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#78350F' }}>{submitterInitials}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#94a3b8' }}>Submitted By</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}>{submittedByName}</Text>
                <Text style={{ fontSize: 10, color: '#64748b' }}>{submittedByRole}</Text>
              </View>
            </View>

            {/* Actions */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: isCompactLayout ? '100%' : undefined }}>
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: '#ffffff',
                  borderWidth: 1,
                  borderColor: '#cbd5e1',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  flexShrink: 1,
                }}
                activeOpacity={0.7}
                onPress={handleDownloadReport}
              >
                <MaterialIcons name="file-download" size={16} color="#334155" />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155', flexShrink: 1 }}>Download Report</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#cbd5e1',
                  backgroundColor: '#ffffff',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                activeOpacity={0.7}
                onPress={() => setShowFullDetailsModal(true)}
                accessibilityRole="button"
                accessibilityLabel="View quarterly report options"
              >
                <MaterialIcons name="more-horiz" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 3. Report KPI Stat Cards are intentionally omitted from Partner Reports. */}
        {false && <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          {/* Card 1: Skills Contributed */}
          <View
            style={{
              flex: isCompactLayout ? undefined : 1,
              flexShrink: isCompactLayout ? 0 : undefined,
              minWidth: isCompactLayout ? 0 : 180,
              width: isCompactLayout ? '48%' : undefined,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              padding: 16,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: '#DBEAFE',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="person" size={20} color="#2563EB" />
              </View>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Skills Contributed</Text>
            </View>
            <Text style={{ fontSize: 28, fontWeight: '900', color: '#0f172a' }}>{skillsCount}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: skillsTrend === '—' ? '#64748b' : '#16A34A' }}>
              {skillsTrend}
            </Text>
          </View>

          {/* Card 2: Events Conducted */}
          <View
            style={{
              flex: isCompactLayout ? undefined : 1,
              flexShrink: isCompactLayout ? 0 : undefined,
              minWidth: isCompactLayout ? 0 : 180,
              width: isCompactLayout ? '48%' : undefined,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              padding: 16,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: '#EDE9FE',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="event" size={20} color="#7C3AED" />
              </View>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Events Conducted</Text>
            </View>
            <Text style={{ fontSize: 28, fontWeight: '900', color: '#0f172a' }}>{eventsConductedCount}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: eventsTrend === '—' ? '#64748b' : '#16A34A' }}>
              {eventsTrend}
            </Text>
          </View>

          {/* Card 3: Sectors Partner (Donut Chart) */}
          <View
            style={{
              flex: isCompactLayout ? undefined : 1.2,
              flexShrink: isCompactLayout ? 0 : undefined,
              minWidth: isCompactLayout ? 0 : 230,
              width: isCompactLayout ? '48%' : undefined,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              padding: 14,
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sectorData[0]?.color || '#16A34A' }} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Sectors Partner</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              {/* Donut Chart Ring */}
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: sectorData[0]?.color || '#22C55E',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 5,
                  borderColor: sectorData[1]?.color || '#3B82F6',
                  overflow: 'hidden',
                  ...(Platform.OS === 'web'
                    ? ({
                        backgroundImage: conicGradientStr,
                        borderWidth: 0,
                      } as any)
                    : {}),
                }}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: '#ffffff',
                  }}
                />
              </View>

              {/* Legend */}
              <View style={{ gap: 3, flex: 1 }}>
                {sectorData.map((item, idx) => (
                  <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.color }} />
                      <Text style={{ fontSize: 10, fontWeight: '600', color: '#475569' }}>{item.label}</Text>
                    </View>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#1e293b' }}>{item.percent}%</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Card 4: Volunteers Involved */}
          <View
            style={{
              flex: isCompactLayout ? undefined : 1,
              flexShrink: isCompactLayout ? 0 : undefined,
              minWidth: isCompactLayout ? 0 : 180,
              width: isCompactLayout ? '48%' : undefined,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              padding: 16,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: '#DCFCE7',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="groups" size={20} color="#16A34A" />
              </View>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Volunteers Involved</Text>
            </View>
            <Text style={{ fontSize: 28, fontWeight: '900', color: '#0f172a' }}>{volunteersCount}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: volunteerTrend === '—' ? '#64748b' : '#16A34A' }}>
              {volunteerTrend}
            </Text>
          </View>
        </View>}

        {/* 4. Middle Section: Report Documents */}
        <View style={{ flexDirection: isCompactLayout ? 'column' : 'row', gap: 16, flexWrap: 'wrap' }}>

          {/* Right Card: Report Documents */}
          <View
            style={{
              flex: 1,
              minWidth: 0,
              width: isCompactLayout ? '100%' : undefined,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              padding: 20,
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <View style={{ gap: 14 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a' }}>Report Documents</Text>
              <View style={{ gap: 10 }}>
                {generatedDocuments.map(doc => (
                  <View
                    key={doc.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 4,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          backgroundColor: doc.type === 'pdf' ? '#FEE2E2' : '#DCFCE7',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: doc.type === 'pdf' ? '#FECACA' : '#BBF7D0',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: '900',
                            color: doc.type === 'pdf' ? '#DC2626' : '#16A34A',
                          }}
                        >
                          {doc.type === 'pdf' ? 'Abc' : 'Xl'}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }} numberOfLines={2}>
                          {doc.title}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#64748b' }}>{doc.size}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDownloadDocument(doc)}
                      activeOpacity={0.7}
                      style={{ padding: 4 }}
                    >
                      <MaterialIcons name="file-download" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
            <TouchableOpacity
              style={{
                alignSelf: 'flex-start',
                backgroundColor: '#F1F5F9',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#E2E8F0',
              }}
              activeOpacity={0.7}
              onPress={() => setShowAllDocsModal(true)}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155' }}>View All Documents</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 5. Reports grouped inside their event folders */}
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 14,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            padding: 20,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              {selectedReportFolder ? (
                <TouchableOpacity
                  onPress={() => setSelectedReportFolderId(null)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Back to event folders"
                  style={{ padding: 2 }}
                >
                  <MaterialIcons name="arrow-back" size={19} color="#166534" />
                </TouchableOpacity>
              ) : null}
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a', flexShrink: 1 }}>
                {selectedReportFolder ? selectedReportFolder.title : 'Event Folders'}
              </Text>
            </View>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b' }}>
              {selectedReportFolder
                ? `${selectedReportFolder.reports.length} report${selectedReportFolder.reports.length === 1 ? '' : 's'}`
                : `${reportFolders.length} event${reportFolders.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          {quarterReports.length === 0 ? (
            <Text style={{ fontSize: 12, color: '#64748b' }}>No reports were submitted for {currentQuarter.label}.</Text>
          ) : selectedReportFolder ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="folder-open" size={17} color="#EAB308" />
                <Text style={{ fontSize: 11, color: '#64748b' }}>Reports submitted for this event</Text>
              </View>
              {selectedReportFolder.reports.map(report => (
                <TouchableOpacity
                  key={report.id}
                  onPress={() => onViewReport(report)}
                  activeOpacity={0.75}
                  style={{
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    borderRadius: 10,
                    padding: 12,
                    backgroundColor: '#f8fafc',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: '#1e293b' }} numberOfLines={2}>
                      {report.title || 'Untitled report'}
                    </Text>
                    <MaterialIcons name="chevron-right" size={18} color="#64748b" />
                  </View>
                  <Text style={{ fontSize: 11, color: '#475569', marginTop: 4 }} numberOfLines={1}>
                    {report.projectTitle || 'Linked project/event'} • {report.submitterName || 'Unknown submitter'}
                  </Text>
                  <Text style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
                    {new Date(report.submittedAt).toLocaleDateString()} • {report.submitterRole === 'volunteer' ? 'Volunteer report' : 'Partner report'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 11, color: '#64748b' }}>Select an event folder to view its reports.</Text>
              {reportFolders.map(folder => (
                <TouchableOpacity
                  key={folder.key}
                  onPress={() => setSelectedReportFolderId(folder.key)}
                  activeOpacity={0.75}
                  style={{
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    borderRadius: 10,
                    padding: 12,
                    backgroundColor: '#f8fafc',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <MaterialIcons name="folder" size={27} color="#EAB308" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#1e293b' }} numberOfLines={2}>
                        {folder.title}
                      </Text>
                      <Text style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
                        {folder.project?.startDate
                          ? new Date(folder.project.startDate).toLocaleDateString()
                          : 'Date unavailable'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <MaterialIcons name="chevron-right" size={20} color="#64748b" />
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#64748b' }}>
                        {folder.reports.length} report{folder.reports.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* 6. Bottom Card: Photos from Volunteers Report */}
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 14,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            padding: 20,
            gap: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a' }}>Photos from Volunteers Report</Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShowAllPhotosModal(true)}
              disabled={volunteerPhotos.length === 0}
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: '#ffffff',
                  borderWidth: 1,
                  borderColor: '#cbd5e1',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                },
                volunteerPhotos.length === 0 && { opacity: 0.5 },
              ]}
            >
              <MaterialIcons name="photo-camera" size={15} color="#475569" />
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>
                View All Photos ({volunteerPhotos.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Photos Cards Row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {volunteerPhotos.length === 0 ? (
              <Text style={{ fontSize: 12, color: '#64748b' }}>
                No volunteer photos for {currentQuarter.label}.
              </Text>
            ) : volunteerPhotos.slice(0, 5).map((item, idx) => (
              <TouchableOpacity
                key={item.id || idx}
                style={{
                  width: 210,
                  height: 130,
                  borderRadius: 10,
                  overflow: 'hidden',
                  backgroundColor: '#e2e8f0',
                  position: 'relative',
                }}
                activeOpacity={0.85}
                onPress={() => setSelectedPhotoIndex(idx)}
              >
                <StableVolunteerReportPhoto uri={item.uri} variant="thumbnail" />
                {/* Bottom dark overlay banner */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '500' }}>{item.date}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#ffffff' }} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.25)',
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 4,
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#ffffff' }}>
                      {item.photosCount} photos
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Full Details Modal */}
      {showFullDetailsModal && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 9999,
          }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 24,
              maxWidth: 520,
              width: '100%',
              gap: 16,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>Quarterly Report Full Details</Text>
              <TouchableOpacity onPress={() => setShowFullDetailsModal(false)}>
                <MaterialIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 13, color: '#475569', lineHeight: 20 }}>
              {activeReport?.description ||
                `The ${currentQuarter.label} partner program conducted in collaboration with ${orgName} includes ${eventsConductedCount} community events engaging ${volunteersCount} volunteers.`}
            </Text>
            {user?.role !== 'partner' && onUploadReport ? (
              <TouchableOpacity
                style={{
                  backgroundColor: '#F1F5F9',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#CBD5E1',
                  paddingVertical: 10,
                  alignItems: 'center',
                }}
                onPress={() => {
                  setShowFullDetailsModal(false);
                  onUploadReport();
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Upload Report</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={{
                backgroundColor: '#166534',
                borderRadius: 8,
                paddingVertical: 10,
                alignItems: 'center',
              }}
              onPress={() => setShowFullDetailsModal(false)}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#ffffff' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* All Photos Gallery Modal */}
      {(showAllPhotosModal || selectedPhotoIndex !== null) && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 9999,
          }}
        >
          <View
            style={{
              backgroundColor: '#1e293b',
              borderRadius: 16,
              padding: 20,
              maxWidth: 640,
              width: '100%',
              gap: 16,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#ffffff' }}>
                Volunteer Reports Photo Gallery
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowAllPhotosModal(false);
                  setSelectedPhotoIndex(null);
                }}
              >
                <MaterialIcons name="close" size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>
            <View
              style={{
                width: '100%',
                height: 320,
                borderRadius: 10,
                overflow: 'hidden',
                backgroundColor: '#0f172a',
              }}
            >
              {selectedVolunteerPhoto ? (
                <StableVolunteerReportPhoto uri={selectedVolunteerPhoto.uri} variant="gallery" />
              ) : (
                <View style={styles.volunteerReportPhotoFallback}>
                  <MaterialIcons name="broken-image" size={34} color="#94a3b8" />
                  <Text style={styles.volunteerReportPhotoFallbackText}>Photo unavailable</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: '#94a3b8' }}>
                Photo by {selectedVolunteerPhoto?.name || 'Volunteer'} on {selectedVolunteerPhoto?.date || 'Unknown date'}
              </Text>
              <TouchableOpacity
                style={{
                  backgroundColor: '#334155',
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 6,
                }}
                onPress={() => {
                  setShowAllPhotosModal(false);
                  setSelectedPhotoIndex(null);
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#ffffff' }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* All Documents Modal */}
      {showAllDocsModal && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 9999,
          }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              gap: 16,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>All Report Documents</Text>
              <TouchableOpacity onPress={() => setShowAllDocsModal(false)}>
                <MaterialIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <View style={{ gap: 10 }}>
              {generatedDocuments.map(doc => (
                <View
                  key={doc.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: '#f1f5f9',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>{doc.title}</Text>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>{doc.size}</Text>
                  </View>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: '#F1F5F9',
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 6,
                    }}
                    onPress={() => handleDownloadDocument(doc)}
                  >
                    <MaterialIcons name="file-download" size={16} color="#334155" />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#334155' }}>Download</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

export default VolunteerReportsDashboard;

function getVolunteerReportsForSummary(summary: PartnerProjectReportSummary): SubmittedReport[] {
  return summary.volunteerAccounts
    .flatMap(account => account.reports)
    .filter(report => report.status !== 'Rejected')
    .sort(
      (left, right) =>
        new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()
    );
}

function formatPdfMetricLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, character => character.toUpperCase());
}

function formatPdfDate(value?: string): string {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Unknown date';
}

function buildPartnerQuarterlyReportPdf(input: {
  title: string;
  quarterLabel: string;
  reportingPeriod: string;
  organization: string;
  program: string;
  status: string;
  submittedOn: string;
  report: SubmittedReport | null;
  summary: PartnerProjectReportSummary | null;
  reports?: SubmittedReport[];
}): string {
  const summary = input.summary;
  const relatedReports = input.reports || (summary ? getVolunteerReportsForSummary(summary) : []);
  const metricRows = Object.entries(summary?.metrics || {}).map(([metric, value]) => ({
    metric: formatPdfMetricLabel(metric),
    value,
  }));
  const linkedEventRows = (summary?.linkedEvents || []).map(event => ({
    event: event.title || 'Untitled event',
    schedule: event.startDate
      ? `${new Date(event.startDate).toLocaleDateString()}${event.endDate ? ` - ${new Date(event.endDate).toLocaleDateString()}` : ''}`
      : 'Schedule to be announced',
    status: event.status || 'Unknown',
    volunteers: event.volunteersNeeded || 0,
  }));
  const volunteerAccountRows = (summary?.volunteerAccounts || []).map(account => ({
    volunteer: account.submitterName || 'Volunteer',
    reports: account.reports.length,
    joins: account.volunteerEventJoins,
    verified: account.verifiedAttendance,
    beneficiaries: account.beneficiariesServed,
  }));
  const reportRows = relatedReports.map(report => ({
    report: report.title || 'Untitled report',
    volunteer: report.submitterName || 'Unknown volunteer',
    event: report.projectTitle || 'Unlinked event',
    status: report.status || 'Unknown',
    submitted: formatPdfDate(report.submittedAt),
    description: report.description || 'No description provided.',
  }));

  return buildTablePdf(input.title, {
    subtitle: `${input.quarterLabel} - ${input.reportingPeriod}`,
    tables: [
      {
        title: 'Quarterly Report Overview',
        columns: [
          { key: 'field', label: 'Field', width: 1 },
          { key: 'value', label: 'Value', width: 2.8, maxLines: 12 },
        ],
        rows: [
          { field: 'Quarter', value: input.quarterLabel },
          { field: 'Reporting period', value: input.reportingPeriod },
          { field: 'Organization', value: input.organization },
          { field: 'Program', value: input.program },
          { field: 'Status', value: input.status },
          { field: 'Submitted on', value: input.submittedOn },
          { field: 'Project', value: summary?.project.title || input.report?.projectTitle || 'No linked project' },
          {
            field: 'Project description',
            value: summary?.project.description || input.report?.description || 'No report details were submitted for this quarter.',
          },
        ],
      },
      {
        title: 'Project Metrics',
        columns: [
          { key: 'metric', label: 'Metric', width: 1.3 },
          { key: 'value', label: 'Value', width: 1 },
        ],
        rows: metricRows,
        emptyMessage: 'No project metrics captured for this quarter.',
      },
      {
        title: 'Linked Events',
        columns: [
          { key: 'event', label: 'Event', width: 1.5 },
          { key: 'schedule', label: 'Schedule', width: 1.35 },
          { key: 'status', label: 'Status', width: 0.8 },
          { key: 'volunteers', label: 'Volunteer Slots', width: 0.8 },
        ],
        rows: linkedEventRows,
        emptyMessage: 'No linked events for this project.',
      },
      {
        title: 'Volunteer Account Summary',
        columns: [
          { key: 'volunteer', label: 'Volunteer', width: 1.5 },
          { key: 'reports', label: 'Reports', width: 0.7 },
          { key: 'joins', label: 'Joins', width: 0.7 },
          { key: 'verified', label: 'Verified', width: 0.8 },
          { key: 'beneficiaries', label: 'Beneficiaries', width: 1 },
        ],
        rows: volunteerAccountRows,
        emptyMessage: 'No volunteer account activity was recorded.',
      },
      {
        title: 'Project and Event Report Details',
        columns: [
          { key: 'report', label: 'Report', width: 1.1 },
          { key: 'volunteer', label: 'Volunteer', width: 0.95 },
          { key: 'event', label: 'Event', width: 1 },
          { key: 'status', label: 'Status', width: 0.7 },
          { key: 'submitted', label: 'Submitted', width: 0.95 },
          { key: 'description', label: 'Description', width: 1.9, maxLines: 12 },
        ],
        rows: reportRows,
        emptyMessage: 'No reports were submitted for this quarter.',
      },
    ],
  });
}

function formatReportType(type: string): string {
  const types: Record<string, string> = {
    General: 'General Report',
    Medical: 'Medical Report',
    Logistics: 'Logistics Report',
    field_report: 'Field Report',
    volunteer_engagement: 'Volunteer Engagement',
    program_impact: 'Program Impact',
    event_performance: 'Event Performance',
    partner_collaboration: 'Partner Collaboration',
    system_metrics: 'System Metrics',
  };
  return types[type] || type;
}

function getReportIcon(type: string): MaterialIconName {
  const icons: Record<string, MaterialIconName> = {
    General: 'description',
    Medical: 'local-hospital',
    Logistics: 'local-shipping',
    field_report: 'assignment',
    volunteer_engagement: 'people',
    program_impact: 'trending-up',
    event_performance: 'event',
    partner_collaboration: 'groups',
    system_metrics: 'analytics',
  };
  return icons[type] || 'description';
}

const styles = StyleSheet.create({
  volunteerReportPhotoThumbnail: {
    width: '100%',
    height: '100%',
  },
  volunteerReportPhotoGallery: {
    width: '100%',
    height: '100%',
  },
  volunteerReportPhotoFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  volunteerReportPhotoFallbackText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  container: {
    flex: 1,
    backgroundColor: '#FAF5E9',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5E9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'transparent',
  },
  headerCompact: {
    flexDirection: 'column',
    gap: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 23,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    color: '#5B564C',
    lineHeight: 18,
  },
  uploadButton: {
    borderRadius: 100,
    backgroundColor: '#3F7A54',
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  uploadButtonText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  uploadButtonCompact: {
    alignSelf: 'flex-start',
  },
  secondaryHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  secondaryHeaderButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    marginBottom: 12,
  },
  statsContainerCompact: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DED2B4',
    gap: 8,
  },
  statCardCompact: {
    flex: 1,
    minWidth: 0,
    minHeight: 108,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E4EEE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabelWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  statLabelWrapCompact: {
    width: '100%',
    flex: 0,
    marginTop: 6,
  },
  statCardLabel: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 11,
    fontWeight: '700',
    color: '#5B564C',
    lineHeight: 15,
    letterSpacing: 0.3,
  },
  statCardValue: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 18,
    fontWeight: '800',
    color: '#1F3A2E',
    marginTop: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginVertical: 6,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
  },
  impactContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  impactCard: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  impactCardBlue: {
    backgroundColor: '#eff6ff',
  },
  impactCardGreen: {
    backgroundColor: '#f0fdf4',
  },
  impactCardOrange: {
    backgroundColor: '#fff7ed',
  },
  impactLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.6)',
    marginBottom: 6,
  },
  impactValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  section: {
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  sectionBadge: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  inlineActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe4ee',
  },
  inlineActionButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  reportItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  eventFolder: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe4ee',
  },
  eventFolderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventFolderIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e4eee7',
  },
  eventPhotoStrip: {
    gap: 8,
    paddingVertical: 12,
  },
  eventPhoto: {
    width: 104,
    height: 84,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  eventFolderEmpty: {
    paddingVertical: 8,
    fontSize: 12,
    color: '#64748b',
  },
  reportItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fbbf24',
  },
  statusIndicatorApproved: {
    backgroundColor: '#16a34a',
  },
  statusIndicatorSubmitted: {
    backgroundColor: '#16a34a',
  },
  statusIndicatorRejected: {
    backgroundColor: '#dc2626',
  },
  reportItemContent: {
    flex: 1,
  },
  reportItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  reportItemType: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 2,
  },
  reportItemDate: {
    fontSize: 10,
    color: '#94a3b8',
  },
  reportStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#dbeafe',
  },
  badgeApproved: {
    backgroundColor: '#dcfce7',
  },
  badgeSubmitted: {
    backgroundColor: '#dcfce7',
  },
  badgeRejected: {
    backgroundColor: '#fee2e2',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  badgeTextApproved: {
    color: '#166534',
  },
  badgeTextSubmitted: {
    color: '#166534',
  },
  badgeTextRejected: {
    color: '#b91c1c',
  },
  separator: {
    height: 8,
  },
  emptyCardContainer: {
    backgroundColor: 'rgba(63,122,84,0.02)',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  emptyIllustrationWrap: {
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 20,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 13,
    color: '#5B564C',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#3F7A54',
    borderRadius: 100,
  },
  emptyButtonText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    color: '#fff',
    fontWeight: '700',
    fontSize: 13.5,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 100,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  filterButtonText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 12,
    fontWeight: '700',
    color: '#22201B',
  },
  tipsCard: {
    backgroundColor: '#F2E9D8',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 24,
  },
  tipsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E4EEE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipsContent: {
    flex: 1,
  },
  tipsTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 14.5,
    fontWeight: '700',
    color: '#1F3A2E',
    marginBottom: 6,
  },
  tipsBulletContainer: {
    gap: 4,
  },
  tipsBulletRow: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 12.5,
    color: '#5B564C',
    lineHeight: 18,
  },
  outcomeTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderTopColor: '#E7E5E4',
    borderBottomWidth: 1,
    borderBottomColor: '#E7E5E4',
    gap: 12,
    marginTop: 12,
  },
  outcomeTh: { fontSize: 11, fontWeight: '700', color: '#6B7280' },
  outcomeTr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
    backgroundColor: '#fff',
  },
  outcomeTd: {},
  outcomeFileIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcomeFileIconText: { fontSize: 10, fontWeight: '800' },
  outcomeReportName: { fontSize: 13, fontWeight: '600', color: '#1F2937', flex: 1 },
  outcomeEventName: { fontSize: 12, fontWeight: '700', color: '#1F2937' },
  outcomeEventSub: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  outcomeDate: { fontSize: 12, color: '#374151', fontWeight: '500' },
  outcomeAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  outcomeAvatarText: { fontSize: 11, fontWeight: '800', color: '#1F2937' },
  outcomeSubmitterName: { fontSize: 12, fontWeight: '700', color: '#1F2937' },
  outcomeSubmitterRole: { fontSize: 11, color: '#6B7280' },
  eventFolderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  eventFolderGridCompact: {
    gap: 10,
  },
  folderCard: {
    width: '23%',
    minWidth: 140,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 12,
    padding: 12,
  },
  folderCardCompact: {
    width: '48%',
    minWidth: 0,
    minHeight: 126,
  },
  folderCardSelected: {
    borderColor: '#10B981',
    borderWidth: 2,
    backgroundColor: '#F0FDF4',
  },
  folderCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  folderCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  folderCardDate: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
  },
  folderCardCount: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },
  eventDetailCard: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 12,
    padding: 16,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  eventDetailTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  eventDetailSub: {
    fontSize: 12,
    color: '#6B7280',
  },
  volunteerTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E5E4',
    gap: 8,
  },
  volunteerTableHeaderCompact: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E5E4',
    backgroundColor: '#F9FAFB',
  },
  volunteerTableHeaderCompactTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
  },
  volunteerTableHeaderCompactHint: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  volunteerTh: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    minWidth: 0,
    flexShrink: 1,
  },
  volunteerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 8,
  },
  volunteerRowCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingHorizontal: 12,
    gap: 10,
  },
  volunteerTd: {},
  volunteerIdentityCell: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  volunteerIdentityCellCompact: {
    width: '100%',
    flex: 0,
  },
  volunteerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E4EEE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volunteerAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
  },
  volunteerName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  volunteerDate: {
    fontSize: 12,
    color: '#6B7280',
    minWidth: 0,
    flexShrink: 1,
  },
  volunteerMobileMetaRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  volunteerMobileLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
  },
  volunteerMobilePhotosRow: {
    width: '100%',
    gap: 6,
  },
  volunteerMobilePhotosContent: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  volunteerMobilePhotoStrip: {
    flex: 1,
    minWidth: 0,
  },
  photoStripSmall: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  photoThumbSmall: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
  },
  photoThumbButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  photoMoreBadge: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  photoMoreText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  photoCountText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 4,
  },
  eventPhotoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  eventPhotoModalCard: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  eventPhotoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventPhotoModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1F2937',
  },
  eventPhotoModalImage: {
    width: '100%',
    height: 360,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
  },
  eventPhotoModalMeta: {
    fontSize: 12,
    color: '#64748B',
  },
  eventPhotoModalCloseButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  eventPhotoModalCloseText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyTableRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyTableText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  infoBox: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: Platform.select({ web: 8, default: 15 }),
    paddingVertical: 12,
    backgroundColor: '#eff6ff',
    marginBottom: 12,
    marginHorizontal: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#1D4ED8',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  infoText: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
});
