import React, { useMemo } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { format } from 'date-fns';
import type { Project } from '../models/types';

type ProjectYearCalendarCardProps = {
  program: Project;
  projects: Project[];
};

type CalendarEntry = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  isEvent?: boolean;
  status: Project['status'];
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isValidDateValue(value?: string): boolean {
  if (!value) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

function getStatusColor(status: Project['status']): string {
  switch (status) {
    case 'Completed':
      return '#16a34a';
    case 'Cancelled':
      return '#dc2626';
    case 'Planning':
      return '#2563eb';
    case 'On Hold':
      return '#d97706';
    default:
      return '#166534';
  }
}

function formatEntryDateLabel(startValue: string, endValue: string): string {
  const startDate = new Date(startValue);
  const endDate = isValidDateValue(endValue) ? new Date(endValue) : startDate;

  if (Number.isNaN(startDate.getTime())) {
    return 'Date pending';
  }

  const startLabel = format(startDate, 'MMM d');
  const endLabel = format(endDate, 'MMM d');
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function clampDateToYear(date: Date, year: number, clampToEnd = false): Date {
  if (date.getFullYear() === year) {
    return date;
  }

  if (date.getFullYear() < year) {
    return new Date(year, 0, 1);
  }

  return clampToEnd ? new Date(year, 11, 31, 23, 59, 59, 999) : new Date(year, 0, 1);
}

export default function ProjectYearCalendarCard({
  program,
  projects,
}: ProjectYearCalendarCardProps) {
  const { width } = useWindowDimensions();
  const monthCardWidth = width < 420 ? '100%' : '48%';

  const displayYear = useMemo(() => {
    if (isValidDateValue(program.startDate)) {
      return new Date(program.startDate).getFullYear();
    }

    const firstValidProject = projects.find(project => isValidDateValue(project.startDate));
    return firstValidProject ? new Date(firstValidProject.startDate).getFullYear() : new Date().getFullYear();
  }, [program.startDate, projects]);

  const monthlyEntries = useMemo(() => {
    const yearStart = new Date(displayYear, 0, 1).getTime();
    const yearEnd = new Date(displayYear, 11, 31, 23, 59, 59, 999).getTime();

    const buckets = MONTH_LABELS.map((label, index) => ({
      index,
      label,
      items: [] as CalendarEntry[],
    }));

    projects.forEach(projectItem => {
      if (!isValidDateValue(projectItem.startDate)) {
        return;
      }

      const startDate = new Date(projectItem.startDate);
      const endDate = isValidDateValue(projectItem.endDate) ? new Date(projectItem.endDate) : startDate;

      if (endDate.getTime() < yearStart || startDate.getTime() > yearEnd) {
        return;
      }

      const clampedStart = clampDateToYear(startDate, displayYear);
      const clampedEnd = clampDateToYear(endDate, displayYear, true);

      for (let monthIndex = clampedStart.getMonth(); monthIndex <= clampedEnd.getMonth(); monthIndex += 1) {
        buckets[monthIndex].items.push({
          id: `${projectItem.id}-${monthIndex}`,
          title: projectItem.title,
          startDate: projectItem.startDate,
          endDate: projectItem.endDate,
          isEvent: projectItem.isEvent,
          status: projectItem.status,
        });
      }
    });

    return buckets.map(bucket => ({
      ...bucket,
      items: bucket.items.sort(
        (left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime()
      ),
    }));
  }, [displayYear, projects]);

  const totalPinnedProjects = useMemo(
    () => monthlyEntries.reduce((sum, month) => sum + month.items.length, 0),
    [monthlyEntries]
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Single Calendar</Text>
          <Text style={styles.title}>Program Calendar</Text>
          <Text style={styles.subtitle}>
            Projects are pinned from January to December based on their schedule.
          </Text>
        </View>

        <View style={styles.yearBadge}>
          <MaterialIcons name="calendar-month" size={16} color="#166534" />
          <Text style={styles.yearBadgeText}>{displayYear}</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryChip}>
          <Text style={styles.summaryValue}>{projects.length}</Text>
          <Text style={styles.summaryLabel}>program items</Text>
        </View>
        <View style={styles.summaryChip}>
          <Text style={styles.summaryValue}>{totalPinnedProjects}</Text>
          <Text style={styles.summaryLabel}>month pins</Text>
        </View>
      </View>

      <View style={styles.monthGrid}>
        {monthlyEntries.map(month => (
          <View key={month.label} style={[styles.monthCard, { width: monthCardWidth }]}>
            <View style={styles.monthHeader}>
              <Text style={styles.monthTitle}>{month.label}</Text>
              <Text style={styles.monthMeta}>
                {month.items.length} item{month.items.length === 1 ? '' : 's'}
              </Text>
            </View>

            {month.items.length ? (
              month.items.map(item => (
                <View key={item.id} style={styles.pinCard}>
                  <View style={[styles.pinDot, { backgroundColor: getStatusColor(item.status) }]} />
                  <View style={styles.pinCopy}>
                    <Text style={styles.pinTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.pinMeta}>
                      {item.isEvent ? 'Event' : 'Program'} | {formatEntryDateLabel(item.startDate, item.endDate)}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyMonth}>
                <Text style={styles.emptyMonthText}>No projects pinned</Text>
              </View>
            )}
          </View>
        ))}
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
  yearBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  yearBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
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
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  monthCard: {
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 10,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  monthMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  pinCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 10,
  },
  pinDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  pinCopy: {
    flex: 1,
    gap: 3,
  },
  pinTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  pinMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  emptyMonth: {
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  emptyMonthText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },
});
