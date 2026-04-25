import React, { useMemo } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AdminPlanningCalendar, AdminPlanningItem, Project } from '../models/types';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';

type TimelineEntry = {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  color: string;
  laneLabel: string;
  projectId?: string;
  kind: 'project' | 'planning';
};

type ProjectTimelineCalendarCardProps = {
  title: string;
  subtitle: string;
  projects: Project[];
  planningCalendars: AdminPlanningCalendar[];
  planningItems: AdminPlanningItem[];
  accentColor?: string;
  emptyText?: string;
  focusDate?: string;
  projectFilterIds?: string[];
  onOpenProject?: (projectId: string) => void;
};

function getMonthGrid(date: Date): Array<number | null> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [];

  for (let index = 0; index < firstDay; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(day);
  }

  while (cells.length < 42) {
    cells.push(null);
  }

  return cells;
}

function isValidDateValue(value?: string): boolean {
  if (!value) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

function formatRange(startValue: string, endValue: string): string {
  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime())) {
    return 'Date to be announced';
  }

  const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endLabel = Number.isNaN(end.getTime())
    ? startLabel
    : end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (startLabel === endLabel) {
    return startLabel;
  }

  return `${startLabel} - ${endLabel}`;
}

function getLaneLabel(project: Project): string {
  if (project.isEvent) {
    return 'Event';
  }

  return project.programModule || project.category || 'Project';
}

// Shows a synchronized monthly calendar and agenda based on admin planning plus project dates.
export default function ProjectTimelineCalendarCard({
  title,
  subtitle,
  projects,
  planningCalendars,
  planningItems,
  accentColor = '#166534',
  emptyText = 'No scheduled items yet.',
  focusDate,
  projectFilterIds,
  onOpenProject,
}: ProjectTimelineCalendarCardProps) {
  const calendarDate = useMemo(() => {
    if (isValidDateValue(focusDate)) {
      return new Date(focusDate!);
    }

    return new Date();
  }, [focusDate]);
  const monthGrid = useMemo(() => getMonthGrid(calendarDate), [calendarDate]);
  const highlightedDay = calendarDate.getDate();
  const monthLabel = useMemo(
    () => calendarDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [calendarDate]
  );

  const timelineEntries = useMemo(() => {
    const visibleProjectIds = projectFilterIds ? new Set(projectFilterIds) : null;
    const calendarById = new Map(planningCalendars.map(calendar => [calendar.id, calendar]));

    const projectEntries: TimelineEntry[] = projects
      .filter(project => {
        if (getProjectDisplayStatus(project) === 'Cancelled' || !isValidDateValue(project.startDate)) {
          return false;
        }

        if (visibleProjectIds && !visibleProjectIds.has(project.id)) {
          return false;
        }

        return true;
      })
      .map(project => ({
        id: `project-${project.id}`,
        title: project.title,
        description: project.description,
        startDate: project.startDate,
        endDate: project.endDate || project.startDate,
        color: getProjectStatusColor(project),
        laneLabel: getLaneLabel(project),
        projectId: project.id,
        kind: 'project',
      }));

    const planningEntries: TimelineEntry[] = planningItems
      .filter(item => {
        if (!isValidDateValue(item.startDate)) {
          return false;
        }

        if (!visibleProjectIds) {
          return true;
        }

        return !item.linkedProjectId || visibleProjectIds.has(item.linkedProjectId);
      })
      .map(item => ({
        id: `planning-${item.id}`,
        title: item.title,
        description: item.description || item.location || undefined,
        startDate: item.startDate,
        endDate: item.endDate || item.startDate,
        color: calendarById.get(item.calendarId)?.color || '#475569',
        laneLabel: calendarById.get(item.calendarId)?.name || 'Planner',
        projectId: item.linkedProjectId,
        kind: 'planning',
      }));

    return [...projectEntries, ...planningEntries].sort(
      (left, right) =>
        new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
        new Date(left.endDate).getTime() - new Date(right.endDate).getTime()
    );
  }, [planningCalendars, planningItems, projectFilterIds, projects]);

  const dayCounts = useMemo(() => {
    const map = new Map<number, number>();

    timelineEntries.forEach(entry => {
      const date = new Date(entry.startDate);
      if (
        Number.isNaN(date.getTime()) ||
        date.getMonth() !== calendarDate.getMonth() ||
        date.getFullYear() !== calendarDate.getFullYear()
      ) {
        return;
      }

      map.set(date.getDate(), (map.get(date.getDate()) || 0) + 1);
    });

    return map;
  }, [calendarDate, timelineEntries]);

  const upcomingEntries = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureItems = timelineEntries.filter(entry => {
      const endDate = new Date(entry.endDate || entry.startDate);
      return !Number.isNaN(endDate.getTime()) && endDate >= today;
    });

    return (futureItems.length ? futureItems : timelineEntries).slice(0, 5);
  }, [timelineEntries]);

  const upcomingProjectCount = useMemo(
    () =>
      timelineEntries.filter(entry => {
        const startDate = new Date(entry.startDate);
        return entry.kind === 'project' && !Number.isNaN(startDate.getTime()) && startDate >= new Date();
      }).length,
    [timelineEntries]
  );

  return (
    <View style={styles.card}>
      <View style={[styles.heroPanel, { backgroundColor: accentColor }]}>
        <View style={styles.syncBadge}>
          <MaterialIcons name="sync" size={14} color="#ecfdf5" />
          <Text style={styles.syncBadgeText}>Admin calendar synced</Text>
        </View>

        <Text style={styles.heroTitle}>{title}</Text>
        <Text style={styles.heroSubtitle}>{subtitle}</Text>

        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{timelineEntries.length}</Text>
            <Text style={styles.heroStatLabel}>timeline items</Text>
          </View>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{upcomingProjectCount}</Text>
            <Text style={styles.heroStatLabel}>project dates</Text>
          </View>
        </View>
      </View>

      <View style={styles.contentPanel}>
        <View style={styles.calendarPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>{monthLabel}</Text>
            <Text style={styles.panelMeta}>
              {calendarDate.toLocaleDateString(undefined, { weekday: 'long' })}
            </Text>
          </View>

          <View style={styles.weekRow}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <Text key={day} style={styles.weekLabel}>
                {day}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {monthGrid.map((day, index) => {
              const hasEvents = typeof day === 'number' && dayCounts.has(day);
              const isHighlightedDay = day === highlightedDay;

              return (
                <View
                  key={`${day || 'empty'}-${index}`}
                  style={[
                    styles.dayCell,
                    day === null && styles.dayCellEmpty,
                    isHighlightedDay && styles.dayCellToday,
                    hasEvents && styles.dayCellWithEvents,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      day === null && styles.dayTextEmpty,
                      hasEvents && styles.dayTextEvent,
                    ]}
                  >
                    {day ?? ''}
                  </Text>
                  {hasEvents ? <View style={[styles.eventDot, { backgroundColor: accentColor }]} /> : null}
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.agendaPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Upcoming Timeline</Text>
            <Text style={styles.panelMeta}>Projects and admin plans</Text>
          </View>

          {upcomingEntries.length ? (
            upcomingEntries.map(entry => {
              const cardBody = (
                <View style={styles.agendaRow}>
                  <View style={[styles.colorRail, { backgroundColor: entry.color }]} />
                  <View style={styles.agendaCopy}>
                    <View style={styles.agendaTopRow}>
                      <Text style={styles.agendaTitle} numberOfLines={1}>
                        {entry.title}
                      </Text>
                      <Text style={styles.agendaDate}>{formatRange(entry.startDate, entry.endDate)}</Text>
                    </View>
                    <View style={styles.agendaTagRow}>
                      <View style={styles.agendaTag}>
                        <Text style={styles.agendaTagText}>{entry.laneLabel}</Text>
                      </View>
                      <View style={[styles.agendaTag, styles.agendaTagMuted]}>
                        <Text style={styles.agendaTagMutedText}>
                          {entry.kind === 'project' ? 'Project' : 'Admin plan'}
                        </Text>
                      </View>
                    </View>
                    {entry.description ? (
                      <Text style={styles.agendaDescription} numberOfLines={2}>
                        {entry.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );

              if (entry.projectId && onOpenProject) {
                return (
                  <TouchableOpacity
                    key={entry.id}
                    onPress={() => onOpenProject(entry.projectId!)}
                    activeOpacity={0.85}
                  >
                    {cardBody}
                  </TouchableOpacity>
                );
              }

              return (
                <View key={entry.id}>
                  {cardBody}
                </View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <MaterialIcons name="event-busy" size={22} color="#94a3b8" />
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe7df',
  },
  heroPanel: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  syncBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  syncBadgeText: {
    color: '#f0fdf4',
    fontSize: 11,
    fontWeight: '700',
  },
  heroTitle: {
    marginTop: 14,
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: '#dcfce7',
  },
  heroStats: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  heroStat: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroStatLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#dcfce7',
  },
  contentPanel: {
    padding: 16,
    gap: 16,
  },
  calendarPanel: {
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  agendaPanel: {
    borderRadius: 20,
    backgroundColor: '#ffffff',
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  panelTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  panelMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  weekLabel: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dayCellEmpty: {
    backgroundColor: 'transparent',
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: '#166534',
    backgroundColor: '#f0fdf4',
  },
  dayCellWithEvents: {
    backgroundColor: '#ecfdf5',
  },
  dayText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  dayTextEmpty: {
    color: 'transparent',
  },
  dayTextEvent: {
    color: '#14532d',
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  agendaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  colorRail: {
    width: 6,
    borderRadius: 999,
  },
  agendaCopy: {
    flex: 1,
  },
  agendaTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  agendaTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  agendaDate: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  agendaTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  agendaTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#dcfce7',
  },
  agendaTagMuted: {
    backgroundColor: '#e2e8f0',
  },
  agendaTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  agendaTagMutedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  agendaDescription: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 10,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
  },
});
