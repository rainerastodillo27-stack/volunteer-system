import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Linking, Alert, ActivityIndicator, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { PartnerProjectApplication } from '../models/types';

interface Props {
  application: PartnerProjectApplication;
  onEdit?: (app: PartnerProjectApplication) => void;
  onSubmit?: (app: PartnerProjectApplication) => void;
  onApprove?: (app: PartnerProjectApplication) => void;
  onReject?: (app: PartnerProjectApplication) => void;
  onOpenAttachment?: (url: string, type?: 'image' | 'document') => void;
  onViewProjects?: (app: PartnerProjectApplication) => void;
  isAdmin?: boolean;
  isOwner?: boolean;
  isSubmitting?: boolean;
  reviewAction?: 'approve' | 'reject' | null;
  statusOverride?: PartnerProjectApplication['status'];
  reviewActionsDisabled?: boolean;
}

function formatDate(value?: string) {
  if (!value || value === 'TBD') return value || 'TBD';
  // value may be YYYY-MM-DD or ISO
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}

function getFileName(url: string, fallback: string) {
  if (!url) return fallback;
  if (url.startsWith('data:')) return fallback;
  try {
    const clean = url.split('?')[0];
    const parts = clean.split('/');
    const name = parts.pop() || fallback;
    return decodeURIComponent(name) || fallback;
  } catch {
    return fallback;
  }
}

function formatAttachmentSize(bytes: number): string {
  if (!bytes || bytes < 1024) return bytes ? `${bytes} B` : '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentSize(url: string): string {
  if (!url.startsWith('data:')) return '';
  const separatorIndex = url.indexOf(',');
  if (separatorIndex < 0) return '';
  const payload = url.slice(separatorIndex + 1).replace(/\s/g, '');
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return formatAttachmentSize(Math.max(0, Math.floor((payload.length * 3) / 4) - padding));
}

function truncateFileName(fileName: string, maxLength: number = 22): string {
  if (!fileName || fileName.length <= maxLength) return fileName;
  const extIndex = fileName.lastIndexOf('.');
  if (extIndex > 0 && extIndex > fileName.length - 8) {
    const ext = fileName.slice(extIndex);
    const base = fileName.slice(0, extIndex);
    const leftLen = Math.max(6, maxLength - ext.length - 3);
    return `${base.slice(0, leftLen)}...${ext}`;
  }
  return `${fileName.slice(0, maxLength - 3)}...`;
}

export default function ProposalMessageTemplate({ application, onEdit, onSubmit, onApprove, onReject, onOpenAttachment, onViewProjects, isAdmin, isOwner, isSubmitting, reviewAction, statusOverride, reviewActionsDisabled }: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < 520;
  const d: any = (application as any).proposalDetails || {};
  const requestedModule = d.requestedProgramModule || 'Program';
  const title = d.proposedTitle || 'Untitled Proposal';
  const description = d.proposedDescription || 'No description provided.';
  const targetLocation = d.proposedLocation || 'Location not provided';
  const explicitCity = String((d as any).cityMunicipality || '').trim();
  let cityValue = explicitCity || String(d.proposedLocation || 'Not provided');
  if (!explicitCity && d.proposedLocation && String(d.proposedLocation).includes(',')) {
    const parts = String(d.proposedLocation).split(',');
    cityValue = parts[Math.max(0, parts.length - 2)].trim() || cityValue;
  }

  const startDate = formatDate(d.proposedStartDate || 'TBD');
  const endDate = formatDate(d.proposedEndDate || 'TBD');

  const attachments = (d as any).attachments || [];
  const photoAtt = attachments.find((a: any) => a.type === 'image') || null;
  const docAtt = attachments.find((a: any) => a.type === 'document') || null;

  const photoUrl = photoAtt?.url || (d as any).photoAttachment || '';
  const docUrl = docAtt?.url || '';

  const photoName = photoUrl ? getFileName(photoUrl, 'Proposal photo') : 'No photo attached';
  const docName = docUrl ? getFileName(docUrl, 'Proposal document') : 'No document attached';
  const photoSize = getAttachmentSize(photoUrl);
  const docSize = getAttachmentSize(docUrl);

  // The card can be an older submission snapshot while the live application has
  // already been reviewed. Use the live status for the badge without replacing
  // the snapshot's project details.
  const rawStatus = (application.status || 'Pending').toLowerCase();
  const visibleStatus = String(statusOverride || application.status || 'Pending').toLowerCase();
  let badgeText = 'DRAFT';
  let badgeBg = '#EDE9FE';
  let badgeColor = '#7C3AED';
  if (visibleStatus === 'approved') {
    badgeText = 'Approved';
    badgeBg = '#DCFCE7';
    badgeColor = '#166534';
  } else if (visibleStatus === 'rejected') {
    badgeText = 'Rejected';
    badgeBg = '#FEE2E2';
    badgeColor = '#DC2626';
  } else if (visibleStatus === 'submitted') {
    badgeText = 'SUBMITTED';
    badgeBg = '#DBEAFE';
    badgeColor = '#1D4ED8';
  } else if (visibleStatus === 'pending') {
    badgeText = 'PENDING REVIEW';
    badgeBg = '#FEF3C7';
    badgeColor = '#B45309';
  }

  const handleOpen = (url: string, type?: 'image' | 'document') => {
    if (!url) {
      Alert.alert('No file', 'No attachment available.');
      return;
    }
    if (onOpenAttachment) return onOpenAttachment(url, type);
    Linking.openURL(url).catch(() => Alert.alert('Unable to open attachment'));
  };

  const isDraft = rawStatus === 'draft' || rawStatus === 'proposed' || !application.status;
  const isApproving = Boolean(isSubmitting && reviewAction === 'approve');
  const isRejecting = Boolean(isSubmitting && reviewAction === 'reject');
  if (rawStatus === 'approved') {
    return (
      <View style={styles.approvedCardContainer}>
        {/* Header with Approved Status & Message */}
        <View style={styles.approvedCardHeader}>
          <View style={styles.approvedIconCircle}>
            <MaterialIcons name="check-circle" size={22} color="#166534" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.approvedBadgePill}>
              <Text style={styles.approvedBadgeText}>APPROVED</Text>
            </View>
            <Text style={styles.approvedHeadline}>
              Your proposal for "{requestedModule}" has been submitted and has been approved
            </Text>
          </View>
        </View>

        {/* Project Info Box */}
        <View style={styles.approvedProjectBox}>
          <Text style={styles.approvedProjectTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.approvedProjectDescription} numberOfLines={2}>
            {description}
          </Text>
          <View style={styles.approvedMetaRow}>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="calendar-today" size={12} color="#166534" />
              <Text style={styles.approvedMetaText}>{startDate} – {endDate}</Text>
            </View>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="place" size={12} color="#166534" />
              <Text style={styles.approvedMetaText} numberOfLines={1}>{cityValue}</Text>
            </View>
          </View>
        </View>

        {/* View my Projects Button */}
        <TouchableOpacity
          style={styles.viewProjectsButton}
          onPress={() => {
            if (onViewProjects) {
              onViewProjects(application);
            }
          }}
          activeOpacity={0.85}
        >
          <MaterialIcons name="folder-special" size={18} color="#ffffff" style={{ marginRight: 6 }} />
          <Text style={styles.viewProjectsButtonText}>View my Projects</Text>
          <MaterialIcons name="arrow-forward" size={16} color="#ffffff" style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      </View>
    );
  }

  const isRevisionRequested = rawStatus === 'revision requested' || rawStatus === 'needs revision' || rawStatus === 'revision';
  const isResubmitted = rawStatus === 'resubmitted';
  const canEdit = Boolean(onEdit) && (
    !reviewActionsDisabled && (
      (isAdmin && rawStatus === 'pending') ||
      (!isAdmin && (isOwner || rawStatus === 'rejected' || visibleStatus === 'rejected') && (
        isRevisionRequested || rawStatus === 'rejected' || isDraft || visibleStatus === 'rejected'
      ))
    )
  );

  if (isRevisionRequested) {
    const revisionFeedback = (d as any).reviewNote || application.reviewNotes || 'Please review and update the proposal details based on admin feedback.';
    return (
      <View style={[styles.approvedCardContainer, { borderColor: '#fed7aa' }]}>
        <View style={styles.approvedCardHeader}>
          <View style={[styles.approvedIconCircle, { backgroundColor: '#fef3c7' }]}>
            <MaterialIcons name="edit-note" size={24} color="#d97706" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={[styles.approvedBadgePill, { backgroundColor: '#fef3c7' }]}>
              <Text style={[styles.approvedBadgeText, { color: '#b45309' }]}>NEEDS REVISION</Text>
            </View>
            <Text style={styles.approvedHeadline}>
              Revision Requested for "{requestedModule}"
            </Text>
          </View>
        </View>

        {/* Feedback / Review Notes Box */}
        <View style={styles.revisionFeedbackBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialIcons name="feedback" size={14} color="#b45309" />
            <Text style={styles.revisionFeedbackLabel}>Admin Feedback / Required Changes</Text>
          </View>
          <Text style={styles.revisionFeedbackText}>{revisionFeedback}</Text>
        </View>

        {/* Project Info Box */}
        <View style={styles.approvedProjectBox}>
          <Text style={styles.approvedProjectTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.approvedProjectDescription} numberOfLines={2}>
            {description}
          </Text>
          <View style={styles.approvedMetaRow}>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="calendar-today" size={12} color="#64748b" />
              <Text style={[styles.approvedMetaText, { color: '#64748b' }]}>{startDate} – {endDate}</Text>
            </View>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="place" size={12} color="#64748b" />
              <Text style={[styles.approvedMetaText, { color: '#64748b' }]} numberOfLines={1}>{cityValue}</Text>
            </View>
          </View>
        </View>

        {/* Edit & Resubmit Action */}
        {canEdit ? (
          <TouchableOpacity
            style={[styles.viewProjectsButton, { backgroundColor: '#d97706' }]}
            onPress={() => onEdit?.(application)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="edit" size={16} color="#ffffff" style={{ marginRight: 6 }} />
            <Text style={styles.viewProjectsButtonText}>Edit & Resubmit Proposal</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (isResubmitted) {
    return (
      <View style={[styles.approvedCardContainer, { borderColor: '#bfdbfe' }]}>
        <View style={styles.approvedCardHeader}>
          <View style={[styles.approvedIconCircle, { backgroundColor: '#dbeafe' }]}>
            <MaterialIcons name="update" size={22} color="#2563eb" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={[styles.approvedBadgePill, { backgroundColor: '#dbeafe' }]}>
              <Text style={[styles.approvedBadgeText, { color: '#1d4ed8' }]}>RESUBMITTED</Text>
            </View>
            <Text style={styles.approvedHeadline}>
              Your revised proposal for "{requestedModule}" has been submitted and is pending admin review.
            </Text>
          </View>
        </View>

        {/* Project Info Box */}
        <View style={styles.approvedProjectBox}>
          <Text style={styles.approvedProjectTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.approvedProjectDescription} numberOfLines={2}>
            {description}
          </Text>
          <View style={styles.approvedMetaRow}>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="calendar-today" size={12} color="#2563eb" />
              <Text style={[styles.approvedMetaText, { color: '#2563eb' }]}>{startDate} – {endDate}</Text>
            </View>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="place" size={12} color="#2563eb" />
              <Text style={[styles.approvedMetaText, { color: '#2563eb' }]} numberOfLines={1}>{cityValue}</Text>
            </View>
          </View>
        </View>

        {canEdit ? (
          <TouchableOpacity
            style={[styles.viewProjectsButton, { backgroundColor: '#2563eb' }]}
            onPress={() => onEdit?.(application)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="edit" size={16} color="#ffffff" style={{ marginRight: 6 }} />
            <Text style={styles.viewProjectsButtonText}>Edit Proposal</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (rawStatus === 'rejected') {
    const rejectionReason = (d as any).reviewNote || application.reviewNotes || 'The proposal was not approved. You may review the details, make the required changes, and resubmit.';
    return (
      <View style={[styles.approvedCardContainer, { borderColor: '#fecaca' }]}>
        <View style={styles.approvedCardHeader}>
          <View style={[styles.approvedIconCircle, { backgroundColor: '#fee2e2' }]}>
            <MaterialIcons name="cancel" size={24} color="#dc2626" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={[styles.approvedBadgePill, { backgroundColor: '#fee2e2' }]}>
              <Text style={[styles.approvedBadgeText, { color: '#dc2626' }]}>REJECTED</Text>
            </View>
            <Text style={styles.approvedHeadline}>
              Proposal for "{requestedModule}" was rejected
            </Text>
          </View>
        </View>

        {/* Rejection Reason Box */}
        <View style={[styles.revisionFeedbackBox, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <MaterialIcons name="error-outline" size={16} color="#dc2626" />
            <Text style={[styles.revisionFeedbackLabel, { color: '#dc2626' }]}>Reason for Rejection / Admin Feedback</Text>
          </View>
          <Text style={[styles.revisionFeedbackText, { color: '#991b1b' }]}>{rejectionReason}</Text>
        </View>

        {/* Project Info Box */}
        <View style={styles.approvedProjectBox}>
          <Text style={styles.approvedProjectTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.approvedProjectDescription} numberOfLines={2}>
            {description}
          </Text>
          <View style={styles.approvedMetaRow}>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="calendar-today" size={12} color="#64748b" />
              <Text style={[styles.approvedMetaText, { color: '#64748b' }]}>{startDate} – {endDate}</Text>
            </View>
            <View style={styles.approvedMetaItem}>
              <MaterialIcons name="place" size={12} color="#64748b" />
              <Text style={[styles.approvedMetaText, { color: '#64748b' }]} numberOfLines={1}>{cityValue}</Text>
            </View>
          </View>
        </View>

        {/* Edit & Resubmit Action */}
        {canEdit ? (
          <TouchableOpacity
            style={[styles.viewProjectsButton, { backgroundColor: '#dc2626' }]}
            onPress={() => onEdit?.(application)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="edit" size={16} color="#ffffff" style={{ marginRight: 6 }} />
            <Text style={styles.viewProjectsButtonText}>Edit & Resubmit Proposal</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const isCompactReview = Boolean(
    (d as any).reviewNote ||
    application.reviewNotes
  );

  const reviewNoteText = (d as any).reviewNote || application.reviewNotes || 'Proposal status updated.';

  if (isCompactReview) {
    return (
      <View style={styles.compactCard}>
        <View style={styles.compactIconBox}>
          <MaterialIcons name="assignment" size={18} color="#2563eb" />
        </View>
        <View style={styles.compactContent}>
          <View style={styles.compactHeaderRow}>
            <Text style={styles.compactTitle}>Project Specifications</Text>
            <TouchableOpacity style={styles.compactMoreBtn} onPress={() => onEdit?.(application)}>
              <MaterialIcons name="more-horiz" size={18} color="#64748B" />
            </TouchableOpacity>
          </View>
          <Text style={styles.compactSub}>{reviewNoteText}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <MaterialIcons name="assignment" size={20} color="#16A34A" />
        </View>
        <View style={styles.headerTexts}>
          <Text style={styles.headerTitle}>Project Specifications</Text>
          <Text style={styles.headerSub}>Provide details for the {requestedModule} program.</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.badgeText, { color: badgeColor }]}>{badgeText}</Text>
        </View>
      </View>

      {/* Two-column grid (stacked on mobile) */}
      <View style={[styles.grid, isMobile && styles.gridMobile]}>
        {/* Left column */}
        <View style={[styles.col, isMobile && styles.colMobile]}>
          <View style={styles.field}>
            <Text style={styles.label}>Project Title</Text>
            <Text style={[styles.value, styles.valueBold]}>{title}</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Detailed Description</Text>
            <Text style={styles.value}>{description}</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Target Location</Text>
            <Text style={styles.value}>{targetLocation}</Text>
          </View>
        </View>
        {/* Right column */}
        <View style={[styles.col, isMobile && styles.colMobile]}>
          <View style={styles.field}>
            <Text style={styles.label}>Start Date</Text>
            <View style={styles.dateRow}>
              <Text style={styles.value}>{startDate}</Text>
              <MaterialIcons name="calendar-today" size={14} color="#94A3B8" />
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>End Date</Text>
            <View style={styles.dateRow}>
              <Text style={styles.value}>{endDate}</Text>
              <MaterialIcons name="calendar-today" size={14} color="#94A3B8" />
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>City / Municipality</Text>
            <Text style={styles.value}>{cityValue}</Text>
          </View>
        </View>
      </View>

      {/* Attachments */}
      <View style={[styles.attachRow, isMobile && styles.attachRowMobile]}>
        <View style={[styles.attachCard, isMobile && styles.attachCardMobile]}>
          <Text style={styles.attachLabel}>Proposal Photo</Text>
          <View style={styles.attachInner}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <MaterialIcons name="image" size={20} color="#94A3B8" />
              </View>
            )}
            <View style={[styles.attachMeta, { marginRight: 40 }]}>
              <Text style={styles.attachName} numberOfLines={1} ellipsizeMode="middle">
                {truncateFileName(photoName, 20)}
              </Text>
              <Text style={styles.attachSize}>
                {photoUrl ? photoSize || 'Photo attachment' : 'No photo attached'}
              </Text>
            </View>
            {photoUrl ? (
              <TouchableOpacity onPress={() => handleOpen(photoUrl, 'image')} style={styles.downloadBtn}>
                <MaterialIcons name="visibility" size={18} color="#64748B" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={[styles.attachCard, isMobile && styles.attachCardMobile]}>
          <Text style={styles.attachLabel}>Proposal Document</Text>
          <View style={styles.attachInner}>
            <View style={styles.pdfIconBox}>
              <MaterialIcons name="picture-as-pdf" size={22} color="#DC2626" />
            </View>
            <View style={[styles.attachMeta, { marginRight: 40 }]}>
              <Text style={styles.attachName} numberOfLines={1} ellipsizeMode="middle">
                {truncateFileName(docName, 20)}
              </Text>
              <Text style={styles.attachSize}>{docUrl ? docSize || 'Document attachment' : 'No document attached'}</Text>
            </View>
            {docUrl ? (
              <TouchableOpacity onPress={() => handleOpen(docUrl, 'document')} style={styles.downloadBtn}>
                <MaterialIcons name="visibility" size={18} color="#64748B" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        {canEdit ? (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => onEdit?.(application)}
            activeOpacity={0.85}
          >
            <Text style={styles.editText}>
              {visibleStatus === 'rejected' && !isAdmin ? 'Edit & Resubmit' : 'Edit'}
            </Text>
          </TouchableOpacity>
        ) : !isAdmin && rawStatus === 'pending' ? (
          <View style={styles.waitingStatus}>
            <MaterialIcons name="schedule" size={15} color="#B45309" />
            <Text style={styles.waitingStatusText}>Waiting for admin review</Text>
          </View>
        ) : <View />}

        {isAdmin && application.status === 'Pending' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' }, reviewActionsDisabled && styles.disabledAction]}
              onPress={() => !reviewActionsDisabled && onReject?.(application)}
              activeOpacity={0.85}
              disabled={Boolean(reviewActionsDisabled) || isSubmitting}
            >
              {isRejecting ? (
                <ActivityIndicator size="small" color="#DC2626" style={{ marginRight: 6 }} />
              ) : null}
              <Text style={[styles.submitText, { color: '#64748B' }]}>
                {isRejecting ? 'Rejecting...' : 'Reject'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: '#16A34A', opacity: isSubmitting ? 0.7 : 1 }, reviewActionsDisabled && styles.disabledAction]}
              onPress={() => !isSubmitting && !reviewActionsDisabled && onApprove?.(application)}
              activeOpacity={0.85}
              disabled={isSubmitting || Boolean(reviewActionsDisabled)}
            >
              {isApproving ? (
                <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />
              ) : (
                <MaterialIcons name="check" size={16} color="#fff" />
              )}
              <Text style={styles.submitText}>{isApproving ? 'Approving...' : 'Approve'}</Text>
            </TouchableOpacity>
          </View>
        ) : isDraft && isOwner ? (
          <TouchableOpacity
            style={[styles.submitBtn, (!isDraft || isSubmitting) && { opacity: 0.6 }]}
            onPress={() => !isSubmitting && onSubmit?.(application)}
            activeOpacity={0.85}
            disabled={(!isDraft && !isOwner) || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />
            ) : (
              <MaterialIcons name="send" size={14} color="#fff" />
            )}
            <Text style={styles.submitText}>{isSubmitting ? 'Submitting...' : 'Submit Proposal'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    padding: 12,
    gap: 12,
    maxWidth: '100%',
    width: '100%',
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTexts: { flex: 1 },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#212529',
    lineHeight: 18,
  },
  headerSub: {
    fontSize: 11,
    color: '#6C757D',
    marginTop: 2,
    lineHeight: 14,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  grid: {
    flexDirection: 'row',
    gap: 16,
  },
  gridMobile: {
    flexDirection: 'column',
    gap: 12,
  },
  col: {
    flex: 1,
    gap: 14,
  },
  colMobile: {
    flex: undefined,
    width: '100%',
    gap: 10,
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#212529',
  },
  value: {
    fontSize: 12,
    color: '#212529',
    lineHeight: 16,
  },
  valueBold: {
    fontWeight: '700',
    fontSize: 12,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginTop: 2,
  },
  attachRow: {
    flexDirection: 'row',
    gap: 12,
  },
  attachRowMobile: {
    flexDirection: 'column',
    gap: 8,
  },
  attachCard: {
    flex: 1,
    gap: 6,
  },
  attachCardMobile: {
    flex: undefined,
    width: '100%',
  },
  attachLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#212529',
  },
  attachInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    padding: 8,
    gap: 8,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#E9ECEF',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfIconBox: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachMeta: { flex: 1, gap: 2 },
  attachName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#212529',
  },
  attachSize: {
    fontSize: 10,
    color: '#6C757D',
  },
  downloadBtn: {
    padding: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    gap: 12,
  },
  waitingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
  },
  waitingStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  editBtn: {
    backgroundColor: '#E9ECEF',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  editText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#495057',
  },
  submitBtn: {
    backgroundColor: '#3B82F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  disabledAction: {
    opacity: 0.45,
  },
  submitText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  compactCard: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 420,
    width: '100%',
  },
  compactIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactContent: {
    flex: 1,
    gap: 2,
  },
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#212529',
  },
  compactSub: {
    fontSize: 12,
    color: '#6C757D',
    lineHeight: 16,
  },
  compactMoreBtn: {
    padding: 2,
  },
  approvedCardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#bbf7d0',
    padding: 16,
    gap: 12,
    maxWidth: 480,
    width: '100%',
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  approvedCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  approvedIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  approvedBadgePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginBottom: 4,
  },
  approvedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.5,
  },
  approvedHeadline: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 20,
  },
  approvedProjectBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 6,
  },
  approvedProjectTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  approvedProjectDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  approvedMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  approvedMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  approvedMetaText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#166534',
  },
  viewProjectsButton: {
    backgroundColor: '#166534',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  viewProjectsButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  revisionFeedbackBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fde68a',
    padding: 12,
    gap: 4,
  },
  revisionFeedbackLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
    textTransform: 'uppercase',
  },
  revisionFeedbackText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#92400e',
    marginTop: 2,
  },
});
