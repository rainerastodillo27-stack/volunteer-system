import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PartnerProjectApplication } from '../../models/types';
import { format } from 'date-fns';

interface ProposalCardProps {
  application: PartnerProjectApplication;
  onPress?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  isAdmin?: boolean;
}

/**
 * A specialized card for rendering Partner Project Proposals (Applications).
 * This component mirrors the 'Project Proposal' detail view in a compact card format.
 */
export default function ProposalCard({ 
  application, 
  onPress, 
  onApprove, 
  onReject,
  isAdmin = false 
}: ProposalCardProps) {
  const { proposalDetails, partnerName, status, requestedAt } = application;
  
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not specified';
    try {
      return format(new Date(dateString), 'MMM d, yyyy');
    } catch {
      return dateString;
    }
  };

  const getStatusColor = (statusValue: string) => {
    switch (statusValue) {
      case 'Approved': return '#16a34a';
      case 'Rejected': return '#dc2626';
      default: return '#2563eb';
    }
  };

  return (
    <TouchableOpacity 
      activeOpacity={0.9} 
      onPress={onPress}
      style={styles.container}
    >
      <View style={styles.header}>
        <View style={styles.partnerInfo}>
          <View style={styles.partnerAvatar}>
            <Text style={styles.partnerAvatarText}>{partnerName.charAt(0)}</Text>
          </View>
          <View>
            <Text style={styles.partnerName}>{partnerName}</Text>
            <Text style={styles.requestDate}>Requested {formatDate(requestedAt)}</Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(status) + '15' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(status) }]}>{status}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.proposalBody}>
        <Text style={styles.proposalTitle}>{proposalDetails?.proposedTitle || 'Untitled Proposal'}</Text>
        <Text style={styles.proposalDescription} numberOfLines={2}>
          {proposalDetails?.proposedDescription || 'No description provided.'}
        </Text>

        <View style={styles.infoGrid}>
          <View style={styles.infoItem}>
            <MaterialIcons name="event" size={14} color="#64748b" />
            <Text style={styles.infoText}>{formatDate(proposalDetails?.proposedStartDate)}</Text>
          </View>
          <View style={styles.infoItem}>
            <MaterialIcons name="place" size={14} color="#64748b" />
            <Text style={styles.infoText} numberOfLines={1}>{proposalDetails?.proposedLocation || 'TBD'}</Text>
          </View>
          <View style={styles.infoItem}>
            <MaterialIcons name="groups" size={14} color="#64748b" />
            <Text style={styles.infoText}>{proposalDetails?.proposedVolunteersNeeded || 0} Volunteers</Text>
          </View>
        </View>

        {proposalDetails?.communityNeed && (
          <View style={styles.narrativeSection}>
            <Text style={styles.narrativeLabel}>Community Need</Text>
            <Text style={styles.narrativeText} numberOfLines={2}>{proposalDetails.communityNeed}</Text>
          </View>
        )}
      </View>

      {isAdmin && status === 'Pending' && (
        <View style={styles.actionRow}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.rejectButton]} 
            onPress={onReject}
          >
            <Text style={styles.rejectButtonText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionButton, styles.approveButton]} 
            onPress={onApprove}
          >
            <Text style={styles.approveButtonText}>Approve Proposal</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  partnerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  partnerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  partnerAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2563eb',
  },
  partnerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  requestDate: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginBottom: 12,
  },
  proposalBody: {
    gap: 8,
  },
  proposalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: '#475569',
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  infoText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  narrativeSection: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#f8fbff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  narrativeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563eb',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  narrativeText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: '#16a34a',
  },
  approveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  rejectButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  rejectButtonText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },
});
