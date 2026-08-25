import React, { useMemo, useState, useEffect } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View, Linking, useWindowDimensions, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addMonths, format, isSameDay, isSameMonth, subMonths } from 'date-fns';
import type { AdminPlanningCalendar, AdminPlanningItem, Project } from '../models/types';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
import { formatProjectLocation } from '../utils/locationFormat';

type TimelineEntry = {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  color: string;
  laneLabel: string;
  projectId?: string;
  kind: 'project' | 'planning' | 'google';
  htmlLink?: string;
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
  statusFilter?: string | null;
  setStatusFilter?: (status: string | null) => void;
  onAddEvent?: (date: Date) => void;
  onOpenProject?: (projectId: string) => void;
  onEditProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
};

function getMonthGrid(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: Date[] = [];

  // Add empty cells for days before the first day of the month
  for (let index = 0; index < firstDay; index += 1) {
    const prevMonthDate = new Date(year, month, -firstDay + index + 1);
    cells.push(prevMonthDate);
  }

  // Add cells for the current month
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(new Date(year, month, day));
  }

  // Add cells for the remaining cells of the 6-week grid
  const remainingCells = 42 - cells.length; // 6 weeks * 7 days
  for (let index = 0; index < remainingCells; index += 1) {
    const nextMonthDate = new Date(year, month + 1, index + 1);
    cells.push(nextMonthDate);
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
  statusFilter,
  setStatusFilter,
  onAddEvent,
  onOpenProject,
  onEditProject,
  onDeleteProject,
}: ProjectTimelineCalendarCardProps) {
  // Main calendar date & selected date state
  const [calendarDate, setCalendarDate] = useState(() => {
    if (isValidDateValue(focusDate)) {
      return new Date(focusDate!);
    }
    return new Date();
  });
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<'Month' | 'Week' | 'Day'>('Month');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const monthGrid = useMemo(() => getMonthGrid(calendarDate), [calendarDate]);
  const monthLabel = useMemo(
    () => calendarDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [calendarDate]
  );

  // Google Calendar Integration states
  const [calendarSettings, setCalendarSettings] = useState({
    calendarId: 'en.philippines#holiday@group.v.calendar.google.com',
    apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || '',
  });
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const [showProjects, setShowProjects] = useState(true);
  const [showPlanning, setShowPlanning] = useState(true);
  const [showGoogle, setShowGoogle] = useState(true);

  // Load calendar settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const storedId = await AsyncStorage.getItem('gcal_id');
        const storedKey = await AsyncStorage.getItem('gcal_key');
        if (storedId || storedKey) {
          setCalendarSettings({
            calendarId: storedId || 'en.philippines#holiday@group.v.calendar.google.com',
            apiKey: storedKey || process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || '',
          });
        }
      } catch (err) {
        console.error('Failed to load Google Calendar settings:', err);
      }
    };
    loadSettings();
  }, []);

  // Fetch events when month, calendarId, or apiKey change
  useEffect(() => {
    let active = true;
    const fetchGCalEvents = async () => {
      setCalendarError(null);
      
      const year = calendarDate.getFullYear();
      const month = calendarDate.getMonth();
      const timeMin = new Date(year, month - 1, 20).toISOString();
      const timeMax = new Date(year, month + 1, 10).toISOString();

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarSettings.calendarId)}/events?key=${calendarSettings.apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (active) {
          setGoogleEvents(data.items || []);
        }
      } catch (err: any) {
        console.warn('Google Calendar fetch error:', err);
        if (active) {
          setCalendarError(err.message || 'Failed to fetch events');
          setGoogleEvents([]);
        }
      }
    };

    fetchGCalEvents();
    return () => {
      active = false;
    };
  }, [calendarDate, calendarSettings]);

  const timelineEntries = useMemo(() => {
    const visibleProjectIds = projectFilterIds ? new Set(projectFilterIds) : null;
    const calendarById = new Map(planningCalendars.map(calendar => [calendar.id, calendar]));

    const projectEntries: TimelineEntry[] = showProjects
      ? projects
          .filter(project => {
            if (!project.isEvent) {
              return false;
            }

            // Apply status filter
            if (statusFilter && getProjectDisplayStatus(project) !== statusFilter) {
              return false;
            }

            // Hide cancelled events unless explicitly filtered
            if (!statusFilter && getProjectDisplayStatus(project) === 'Cancelled') {
              return false;
            }

            if (!isValidDateValue(project.startDate)) {
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
          }))
      : [];

    const planningEntries: TimelineEntry[] = showPlanning
      ? planningItems
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
          }))
      : [];

    const googleEntries: TimelineEntry[] = showGoogle
      ? googleEvents.map(event => {
          const startDate = event.start?.dateTime || event.start?.date || '';
          let endDate = event.end?.dateTime || event.end?.date || startDate;
          if (event.start?.date && event.end?.date) {
            const endD = new Date(endDate);
            endD.setSeconds(endD.getSeconds() - 1);
            endDate = endD.toISOString().split('T')[0];
          }
          return {
            id: `google-${event.id}`,
            title: event.summary || 'Google Calendar Event',
            description: event.description || undefined,
            startDate,
            endDate,
            color: '#166534',
            laneLabel: 'Google Calendar',
            kind: 'google',
            htmlLink: event.htmlLink,
          };
        })
      : [];

    return [...projectEntries, ...planningEntries, ...googleEntries].sort(
      (left, right) =>
        new Date(left.startDate).getTime() - new Date(right.startDate).getTime() ||
        new Date(left.endDate).getTime() - new Date(right.endDate).getTime()
    );
  }, [planningCalendars, planningItems, projectFilterIds, projects, googleEvents, showProjects, showPlanning, showGoogle, statusFilter]);

  // Compute status counts for events
  const statusCounts = useMemo(() => {
    const counts = {
      'In Progress': 0,
      'Planning': 0,
      'Completed': 0,
      'Cancelled': 0,
    };
    projects.forEach(project => {
      if (project.isEvent) {
        const displayStatus = getProjectDisplayStatus(project);
        if (displayStatus in counts) {
          counts[displayStatus as keyof typeof counts]++;
        }
      }
    });
    return counts;
  }, [projects]);

  // Count events for each day of the current month
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

  // List of upcoming events
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = timelineEntries.filter(entry => {
      const endDate = new Date(entry.endDate || entry.startDate);
      return !Number.isNaN(endDate.getTime()) && endDate >= today;
    });

    return (items.length ? items : timelineEntries).slice(0, 4);
  }, [timelineEntries]);

  // Filter events for the currently selected day
  const selectedDayEvents = useMemo(() => {
    return timelineEntries.filter(entry => {
      const date = new Date(entry.startDate);
      return !Number.isNaN(date.getTime()) && isSameDay(date, selectedDate);
    });
  }, [timelineEntries, selectedDate]);

  // Navigation handlers
  const handlePrevMonth = () => {
    setCalendarDate(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCalendarDate(prev => addMonths(prev, 1));
  };

  const handleResetToToday = () => {
    const today = new Date();
    setCalendarDate(today);
    setSelectedDate(today);
  };

  const { width } = useWindowDimensions();
  const isMobile = width < 992;

  // Render a single day cell in the big monthly calendar
  const renderBigCalendarDay = (day: Date, idx: number) => {
    const isCurrentMonth = isSameMonth(day, calendarDate);
    const isSelected = isSameDay(day, selectedDate);
    const dayEvents = timelineEntries.filter(entry => isSameDay(new Date(entry.startDate), day));

    return (
      <TouchableOpacity
        key={idx}
        style={[
          styles.bigDayCell,
          !isCurrentMonth && styles.bigDayCellOutside,
          isSelected && styles.bigDayCellSelected,
        ]}
        onPress={() => {
          setSelectedDate(day);
          onAddEvent?.(day);
        }}
      >
        <View style={styles.bigDayHeader}>
          <Text
            style={[
              styles.bigDayNumber,
              !isCurrentMonth && styles.bigDayNumberOutside,
              isSelected && styles.bigDayNumberSelected,
            ]}
          >
            {format(day, 'd')}
          </Text>
        </View>

        <View style={styles.bigDayEventsContainer}>
          {dayEvents.slice(0, 2).map((event, eventIdx) => (
            <View
              key={eventIdx}
              style={[styles.bigEventChip, { backgroundColor: event.color }]}
            >
              <Text style={styles.bigEventChipText} numberOfLines={1}>
                {new Date(event.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {event.title}
              </Text>
            </View>
          ))}
          {dayEvents.length > 2 && (
            <Text style={styles.bigMoreEventsText}>
              +{dayEvents.length - 2} more
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.card}>
      {/* Top Header Bar */}
      <View style={styles.googleHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MaterialIcons name="calendar-today" size={22} color="#166534" />
          <Text style={styles.googleHeaderTitle}>{title}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, position: 'relative', zIndex: 10 }}>
          {/* Status Filter Icon Button */}
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilterDropdown(!showFilterDropdown)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="filter-list" size={20} color={statusFilter ? '#166534' : '#475569'} />
            {statusFilter && (
              <View style={styles.filterActiveIndicator} />
            )}
          </TouchableOpacity>

          {/* Filter Dropdown */}
          {showFilterDropdown && (
            <View style={styles.filterDropdownMenu}>
              <TouchableOpacity
                style={styles.filterDropdownItem}
                onPress={() => {
                  setStatusFilter?.(null);
                  setShowFilterDropdown(false);
                }}
              >
                <Text style={[styles.filterDropdownText, !statusFilter && styles.filterDropdownTextActive]}>
                  All Status
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.filterDropdownItem}
                onPress={() => {
                  setStatusFilter?.('In Progress');
                  setShowFilterDropdown(false);
                }}
              >
                <Text style={[styles.filterDropdownText, statusFilter === 'In Progress' && styles.filterDropdownTextActive]}>
                  {statusCounts['In Progress']} In Progress
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.filterDropdownItem}
                onPress={() => {
                  setStatusFilter?.('Planning');
                  setShowFilterDropdown(false);
                }}
              >
                <Text style={[styles.filterDropdownText, statusFilter === 'Planning' && styles.filterDropdownTextActive]}>
                  {statusCounts['Planning']} Planning
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.filterDropdownItem}
                onPress={() => {
                  setStatusFilter?.('Completed');
                  setShowFilterDropdown(false);
                }}
              >
                <Text style={[styles.filterDropdownText, statusFilter === 'Completed' && styles.filterDropdownTextActive]}>
                  {statusCounts['Completed']} Completed
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.filterDropdownItem}
                onPress={() => {
                  setStatusFilter?.('Cancelled');
                  setShowFilterDropdown(false);
                }}
              >
                <Text style={[styles.filterDropdownText, statusFilter === 'Cancelled' && styles.filterDropdownTextActive]}>
                  {statusCounts['Cancelled']} Cancelled
                </Text>
              </TouchableOpacity>
            </View>
          )}

        </View>
      </View>

      {/* Main Grid Layout */}
      <View style={[styles.mainLayout, { flexDirection: isMobile ? 'column' : 'row' }]}>
        
        {/* Left Column (Big Calendar + Event List) */}
        <View style={styles.leftColumn}>
          
          {/* Calendar Header with navigation and Mode buttons */}
          <View style={styles.calendarControlBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={styles.bigMonthLabel}>{monthLabel}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <TouchableOpacity style={styles.navButton} onPress={handlePrevMonth}>
                  <MaterialIcons name="chevron-left" size={20} color="#475569" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.navButton} onPress={handleNextMonth}>
                  <MaterialIcons name="chevron-right" size={20} color="#475569" />
                </TouchableOpacity>
              </View>
            </View>

            {/* View Mode Tabs */}
            <View style={styles.viewModeTabs}>
              {(['Month', 'Week', 'Day'] as const).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.viewModeTabButton, viewMode === mode && styles.viewModeTabButtonActive]}
                  onPress={() => setViewMode(mode)}
                >
                  <Text style={[styles.viewModeTabText, viewMode === mode && styles.viewModeTabTextActive]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Weekday labels */}
          <View style={styles.weekdayLabelsRow}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <View key={day} style={styles.weekdayLabelCell}>
                <Text style={styles.weekdayLabelText}>{day}</Text>
              </View>
            ))}
          </View>

          {/* Big Monthly grid */}
          <View style={styles.bigCalendarGrid}>
            {monthGrid.map((day, idx) => renderBigCalendarDay(day, idx))}
          </View>

          {/* Event List Table at the bottom */}
          <View style={styles.eventTableContainer}>
            <Text style={styles.eventTableTitle}>Event List</Text>
            
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Time</Text>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Event</Text>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Location</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'center' }]}>Attendees</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Status</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1.2, textAlign: 'center' }]}>Actions</Text>
            </View>

            {selectedDayEvents.length > 0 ? (
              selectedDayEvents.map(entry => {
                const project = projects.find(p => p.id === entry.projectId);
                const canUseProjectActions = Boolean(project?.id);
                const volunteersNeeded = project?.volunteersNeeded || 0;
                const joinedCount = project?.volunteers?.length || project?.joinedUserIds?.length || 0;
                const displayStatus = project ? getProjectDisplayStatus(project) : 'Open';

                return (
                  <View key={entry.id} style={styles.tableRow}>
                    <Text style={[styles.tableCell, { flex: 1.5 }]}>
                      {new Date(entry.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(entry.endDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 2, fontWeight: '700' }]}>{entry.title}</Text>
                    <Text style={[styles.tableCell, { flex: 2 }]} numberOfLines={1}>
                      {project ? formatProjectLocation(project) : 'TBA'}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 1.5, textAlign: 'center' }]}>
                      {joinedCount} / {volunteersNeeded}
                    </Text>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <View style={[styles.statusPill, { backgroundColor: entry.color + '15' }]}>
                        <Text style={[styles.statusPillText, { color: entry.color }]}>
                          {displayStatus}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <TouchableOpacity 
                        style={[styles.actionButton, !canUseProjectActions && styles.actionButtonDisabled]}
                        disabled={!canUseProjectActions}
                        onPress={() => {
                          if (project?.id) {
                            onOpenProject?.(project.id);
                          }
                        }}
                      >
                        <MaterialIcons name="visibility" size={18} color={canUseProjectActions ? '#166534' : '#94a3b8'} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.actionButton, !canUseProjectActions && styles.actionButtonDisabled]}
                        disabled={!canUseProjectActions}
                        onPress={() => {
                          if (project?.id) {
                            onEditProject?.(project.id);
                          }
                        }}
                      >
                        <MaterialIcons name="edit" size={18} color={canUseProjectActions ? '#2563eb' : '#94a3b8'} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.actionButton, !canUseProjectActions && styles.actionButtonDisabled]}
                        disabled={!canUseProjectActions}
                        onPress={() => {
                          if (project?.id) {
                            onDeleteProject?.(project.id);
                          }
                        }}
                      >
                        <MaterialIcons name="delete-outline" size={18} color={canUseProjectActions ? '#dc2626' : '#94a3b8'} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyTableState}>
                <Text style={styles.emptyTableText}>No events scheduled for this day</Text>
              </View>
            )}
          </View>

        </View>

        {/* Right Column (Sidebar Panel) */}
        <View style={[styles.sidebarPanel, { width: isMobile ? '100%' : 300, borderLeftWidth: isMobile ? 0 : 1, borderTopWidth: isMobile ? 1 : 0 }]}>
          
          <Text style={styles.sidebarHeading}>Calendar</Text>

          {/* Month Selector in Mini Calendar */}
          <View style={styles.miniMonthHeader}>
            <Text style={styles.miniMonthLabel}>{monthLabel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity style={styles.navButtonSmall} onPress={handlePrevMonth}>
                <MaterialIcons name="chevron-left" size={16} color="#475569" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.navButtonSmall} onPress={handleNextMonth}>
                <MaterialIcons name="chevron-right" size={16} color="#475569" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Mini Calendar Weekday Labels */}
          <View style={styles.miniWeekRow}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, idx) => (
              <Text key={idx} style={styles.miniWeekLabel}>
                {day}
              </Text>
            ))}
          </View>

          {/* Mini Calendar Grid */}
          <View style={styles.miniGrid}>
            {monthGrid.map((day, index) => {
              const isCurrentMonth = isSameMonth(day, calendarDate);
              const isSelected = isSameDay(day, selectedDate);
              const hasEvents = timelineEntries.some(entry => isSameDay(new Date(entry.startDate), day));

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.miniDayCell,
                    isSelected && styles.miniDayCellSelected,
                  ]}
                  onPress={() => {
                    setSelectedDate(day);
                    if (!isCurrentMonth) {
                      setCalendarDate(day);
                    }
                    onAddEvent?.(day);
                  }}
                >
                  <Text
                    style={[
                      styles.miniDayText,
                      !isCurrentMonth && styles.miniDayTextOutside,
                      isSelected && styles.miniDayTextSelected,
                    ]}
                  >
                    {format(day, 'd')}
                  </Text>
                  {hasEvents && !isSelected && (
                    <View style={styles.miniEventDot} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Upcoming Events list */}
          <View style={styles.upcomingEventsSection}>
            <View style={styles.upcomingHeaderRow}>
              <Text style={styles.upcomingTitle}>Upcoming Events</Text>
              <TouchableOpacity>
                <Text style={styles.viewAllLink}>View all</Text>
              </TouchableOpacity>
            </View>

            <View style={{ gap: 12 }}>
              {upcomingEvents.length > 0 ? (
                upcomingEvents.map(event => {
                  const project = projects.find(p => p.id === event.projectId);
                  return (
                    <View key={event.id} style={styles.upcomingEventCard}>
                      <View style={[styles.upcomingEventIconBox, { backgroundColor: event.color }]}>
                        <MaterialIcons name="calendar-today" size={16} color="#ffffff" />
                      </View>
                      <View style={styles.upcomingEventInfo}>
                        <Text style={styles.upcomingEventName} numberOfLines={1}>
                          {event.title}
                        </Text>
                        <Text style={styles.upcomingEventMeta}>
                          {formatRange(event.startDate, event.endDate)} • {new Date(event.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        <Text style={styles.upcomingEventSubtext} numberOfLines={1}>
                          {project?.title || event.laneLabel}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.emptyUpcomingText}>{emptyText}</Text>
              )}
            </View>
          </View>

          {/* View Full Calendar Button */}
          <TouchableOpacity
            style={styles.viewFullCalendarButton}
            onPress={handleResetToToday}
            activeOpacity={0.8}
          >
            <MaterialIcons name="calendar-today" size={16} color="#166534" />
            <Text style={styles.viewFullCalendarButtonText}>View full calendar</Text>
          </TouchableOpacity>

        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dadce0',
  },
  googleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    backgroundColor: '#ffffff',
  },
  googleHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#16351F',
  },
  filterButton: {
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterActiveIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  filterDropdownMenu: {
    position: 'absolute',
    top: 38,
    right: 0,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 6,
    width: 160,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  filterDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterDropdownText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  filterDropdownTextActive: {
    color: '#166534',
    fontWeight: '700',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f0fdf4',
  },
  syncBadgeText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '600',
  },
  mainLayout: {
    backgroundColor: '#ffffff',
  },
  leftColumn: {
    flex: 1,
    padding: 20,
  },
  calendarControlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  bigMonthLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1e293b',
  },
  navButton: {
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  viewModeTabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
  },
  viewModeTabButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  viewModeTabButtonActive: {
    backgroundColor: '#f1f5f9',
  },
  viewModeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  viewModeTabTextActive: {
    color: '#166534',
  },
  weekdayLabelsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 8,
    marginBottom: 8,
  },
  weekdayLabelCell: {
    width: '14.28%',
    alignItems: 'center',
  },
  weekdayLabelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  bigCalendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
  },
  bigDayCell: {
    width: '14.28%',
    aspectRatio: 1.1,
    borderWidth: 0.5,
    borderColor: '#cbd5e1',
    padding: 6,
    justifyContent: 'flex-start',
  },
  bigDayCellOutside: {
    backgroundColor: '#f8fafc',
  },
  bigDayCellSelected: {
    borderColor: '#166534',
    borderWidth: 1.5,
    borderRadius: 8,
  },
  bigDayHeader: {
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  bigDayNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
    padding: 2,
  },
  bigDayNumberOutside: {
    color: '#94a3b8',
  },
  bigDayNumberSelected: {
    color: '#166534',
    fontWeight: '900',
  },
  bigDayEventsContainer: {
    flex: 1,
    gap: 3,
  },
  bigEventChip: {
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  bigEventChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ffffff',
  },
  bigMoreEventsText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 2,
  },
  eventTableContainer: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 20,
  },
  eventTableTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 14,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0fdf4',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  tableHeaderCell: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableCell: {
    fontSize: 13,
    color: '#334155',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  actionButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  emptyTableState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyTableText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  sidebarPanel: {
    padding: 20,
    borderColor: '#dadce0',
    backgroundColor: '#ffffff',
  },
  sidebarHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#16351F',
    marginBottom: 16,
  },
  miniMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  miniMonthLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3c4043',
  },
  navButtonSmall: {
    padding: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  miniWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  miniWeekLabel: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: '#70757a',
  },
  miniGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  miniDayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  miniDayCellSelected: {
    backgroundColor: '#166534',
  },
  miniDayText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3c4043',
  },
  miniDayTextOutside: {
    color: '#b0b3b8',
  },
  miniDayTextSelected: {
    color: '#ffffff',
  },
  miniEventDot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#166534',
  },
  upcomingEventsSection: {
    borderTopWidth: 1,
    borderTopColor: '#f1f3f4',
    paddingTop: 16,
    marginBottom: 20,
  },
  upcomingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  upcomingTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#3c4043',
  },
  viewAllLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  upcomingEventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  upcomingEventIconBox: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingEventInfo: {
    flex: 1,
  },
  upcomingEventName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  upcomingEventMeta: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  upcomingEventSubtext: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    marginTop: 2,
  },
  emptyUpcomingText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 12,
  },
  viewFullCalendarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 8,
    paddingVertical: 10,
    width: '100%',
  },
  viewFullCalendarButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
});
