import React, { useMemo } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { format } from 'date-fns';
import type { Project } from '../models/types';
import { getProjectStatusColor } from '../utils/projectStatus';

type ProjectYearCalendarCardProps = {
  program: Project;
  projects: Project[];
};

function formatDateRange(startDate?: string, endDate?: string): string {
  if (!startDate) {
    return 'Date pending';
  }

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;

  if (Number.isNaN(start.getTime())) {
    return 'Date pending';
  }

  if (Number.isNaN(end.getTime()) || start.getTime() === end.getTime()) {
    return format(start, 'MMM d, yyyy');
  }

  return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
}

export default function ProjectYearCalendarCard({
  program,
  projects,
}: ProjectYearCalendarCardProps) {
  const linkedEvents = useMemo(
    () => projects.filter(project => project.id !== program.id && project.isEvent),
    [program.id, projects]
  );

  const statusColor = getProjectStatusColor(program.status);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Project Details</Text>
          <Text style={styles.title}>{program.title}</Text>
          <Text style={styles.subtitle} numberOfLines={3}>
            {program.description}
          </Text>
        </View>

        <View style={[styles.statusBadge, { borderColor: `${statusColor}33` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{program.status}</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryChip}>
          <Text style={styles.summaryValue}>{program.programModule || program.category}</Text>
          <Text style={styles.summaryLabel}>module</Text>
        </View>
        <View style={styles.summaryChip}>
          <Text style={styles.summaryValue}>{program.volunteersNeeded}</Text>
          <Text style={styles.summaryLabel}>volunteer slots</Text>
        </View>
      </View>

      <View style={styles.detailList}>
        <View style={styles.detailRow}>
          <MaterialIcons name="event" size={18} color="#166534" />
          <View style={styles.detailCopy}>
            <Text style={styles.detailLabel}>Schedule</Text>
            <Text style={styles.detailValue}>{formatDateRange(program.startDate, program.endDate)}</Text>
          </View>
        </View>

        <View style={styles.detailRow}>
          <MaterialIcons name="place" size={18} color="#0f766e" />
          <View style={styles.detailCopy}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue}>{program.location.address || 'Location to be announced'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.linkedSection}>
        <View style={styles.linkedHeader}>
          <Text style={styles.linkedTitle}>Linked Events</Text>
          <Text style={styles.linkedMeta}>{linkedEvents.length} event{linkedEvents.length === 1 ? '' : 's'}</Text>
        </View>

        {linkedEvents.length ? (
          linkedEvents.slice(0, 3).map(event => (
            <View key={event.id} style={styles.linkedCard}>
              <View style={[styles.linkedDot, { backgroundColor: getProjectStatusColor(event.status) }]} />
              <View style={styles.linkedCopy}>
                <Text style={styles.linkedItemTitle} numberOfLines={2}>
                  {event.title}
                </Text>
                <Text style={styles.linkedItemMeta} numberOfLines={1}>
                  {formatDateRange(event.startDate, event.endDate)}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyState}>
            <MaterialIcons name="event-busy" size={18} color="#94a3b8" />
            <Text style={styles.emptyStateText}>No linked events yet</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryChip: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  detailList: {
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 2,
  },
  detailCopy: {
    flex: 1,
    gap: 2,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: {
    fontSize: 13,
    lineHeight: 19,
    color: '#0f172a',
    fontWeight: '700',
  },
  linkedSection: {
    gap: 10,
  },
  linkedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkedTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  linkedMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  linkedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
  },
  linkedDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  linkedCopy: {
    flex: 1,
    gap: 2,
  },
  linkedItemTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  linkedItemMeta: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  emptyStateText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
  },
});
