import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteAdminPlanningCalendar,
  deleteAdminPlanningItem,
  getAllAdminPlanningCalendars,
  getAllAdminPlanningItems,
  getAllProjects,
  saveAdminPlanningCalendar,
  saveAdminPlanningItem,
  subscribeToStorageChanges,
} from '../models/storage';
import { AdminPlanningCalendar, AdminPlanningItem, Project } from '../models/types';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

type PlannerViewMode = '3weeks' | 'month' | 'agenda';

type PlanningItemDraft = {
  id?: string;
  title: string;
  description: string;
  calendarId: string;
  linkedProjectId: string;
  startDate: string;
  endDate: string;
  location: string;
  participantsLabel: string;
};

type PlanningCalendarDraft = {
  id?: string;
  name: string;
  description: string;
  color: string;
};

type PlannerDisplayItem = {
  id: string;
  title: string;
  description?: string;
  calendarId: string;
  color: string;
  startDate: string;
  endDate: string;
  location?: string;
  participantsLabel?: string;
  linkedProjectId?: string;
  kind: 'manual' | 'project';
  projectStatus?: Project['status'];
};

const VIEW_OPTIONS: Array<{ id: PlannerViewMode; label: string }> = [
  { id: '3weeks', label: '3 Weeks' },
  { id: 'month', label: 'Month' },
  { id: 'agenda', label: 'Agenda' },
];

const COLOR_OPTIONS = [
  '#0F766E',
  '#3B82F6',
  '#65A30D',
  '#F97316',
  '#DC2626',
  '#7C3AED',
  '#EC4899',
  '#0891B2',
];

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDateInput(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function parseDateInput(value: string): Date | null {
  const trimmedValue = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
    return null;
  }

  const parsedDate = parseISO(trimmedValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function createEmptyPlanningItemDraft(calendarId: string, selectedDate: Date): PlanningItemDraft {
  const dateValue = toDateInput(selectedDate);

  return {
    title: '',
    description: '',
    calendarId,
    linkedProjectId: '',
    startDate: dateValue,
    endDate: dateValue,
    location: '',
    participantsLabel: '',
  };
}

function createEmptyPlanningCalendarDraft(color = COLOR_OPTIONS[0]): PlanningCalendarDraft {
  return {
    name: '',
    description: '',
    color,
  };
}

function getPlannerRange(referenceDate: Date, viewMode: PlannerViewMode) {
  if (viewMode === '3weeks') {
    const startDate = startOfWeek(referenceDate, { weekStartsOn: 0 });
    return {
      startDate,
      endDate: addDays(startDate, 20),
    };
  }

  const startDate = startOfWeek(startOfMonth(referenceDate), { weekStartsOn: 0 });
  const endDate = endOfWeek(endOfMonth(referenceDate), { weekStartsOn: 0 });
  return {
    startDate,
    endDate,
  };
}

function chunkDates(days: Date[]): Date[][] {
  const chunks: Date[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    chunks.push(days.slice(index, index + 7));
  }
  return chunks;
}

function itemSpansDay(item: Pick<PlannerDisplayItem, 'startDate' | 'endDate'>, day: Date): boolean {
  const startDate = parseDateInput(item.startDate);
  const endDate = parseDateInput(item.endDate);

  if (!startDate || !endDate) {
    return false;
  }

  return day >= startDate && day <= endDate;
}

function itemTouchesRange(
  item: Pick<PlannerDisplayItem, 'startDate' | 'endDate'>,
  rangeStart: Date,
  rangeEnd: Date
): boolean {
  const startDate = parseDateInput(item.startDate);
  const endDate = parseDateInput(item.endDate);

  if (!startDate || !endDate) {
    return false;
  }

  return endDate >= rangeStart && startDate <= rangeEnd;
}

function getProjectTimelineColor(project: Project, fallbackColor: string): string {
  switch (project.status) {
    case 'Planning':
      return fallbackColor;
    case 'In Progress':
      return '#2563EB';
    case 'On Hold':
      return '#F97316';
    case 'Completed':
      return '#65A30D';
    case 'Cancelled':
      return '#DC2626';
    default:
      return fallbackColor;
  }
}

function formatRangeLabel(referenceDate: Date, viewMode: PlannerViewMode): string {
  if (viewMode === 'agenda') {
    const { startDate, endDate } = getPlannerRange(referenceDate, 'month');
    return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
  }

  const { startDate, endDate } = getPlannerRange(referenceDate, viewMode);
  return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
}

function formatPlannerItemDateLabel(item: PlannerDisplayItem): string {
  const startDate = parseDateInput(item.startDate);
  const endDate = parseDateInput(item.endDate);

  if (!startDate || !endDate) {
    return item.startDate;
  }

  if (isSameDay(startDate, endDate)) {
    return format(startDate, 'MMM d, yyyy');
  }

  return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
}

export default function AdminPlanningCalendarScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [referenceDate, setReferenceDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<PlannerViewMode>('3weeks');
  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);
  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [itemDraft, setItemDraft] = useState<PlanningItemDraft>(createEmptyPlanningItemDraft('planner-projects', new Date()));
  const [calendarDraft, setCalendarDraft] = useState<PlanningCalendarDraft>(createEmptyPlanningCalendarDraft());

  const loadPlannerData = async () => {
    try {
      const [calendars, items, allProjects] = await Promise.all([
        getAllAdminPlanningCalendars(),
        getAllAdminPlanningItems(),
        getAllProjects(),
      ]);

      setPlanningCalendars(calendars);
      setPlanningItems(items);
      setProjects(allProjects);
      setSelectedCalendarIds(currentSelection => {
        const validIds = calendars.map(calendar => calendar.id);
        if (currentSelection.length === 0) {
          return validIds;
        }

        const nextSelection = currentSelection.filter(calendarId => validIds.includes(calendarId));
        return nextSelection.length > 0 ? nextSelection : validIds;
      });
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load the planning calendar.'),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPlannerData();
    const unsubscribe = subscribeToStorageChanges(
      ['adminPlanningCalendars', 'adminPlanningItems', 'projects'],
      () => {
        void loadPlannerData();
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const projectPlanningCalendar =
    planningCalendars.find(calendar => calendar.id === 'planner-projects') ||
    planningCalendars[0] || {
      id: 'planner-projects',
      name: 'Project Plans',
      color: '#0F766E',
      createdAt: '',
      updatedAt: '',
    };

  const manualDisplayItems: PlannerDisplayItem[] = planningItems.map(item => {
    const calendar = planningCalendars.find(entry => entry.id === item.calendarId);
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      calendarId: item.calendarId,
      color: calendar?.color || '#0F766E',
      startDate: item.startDate,
      endDate: item.endDate,
      location: item.location,
      participantsLabel: item.participantsLabel,
      linkedProjectId: item.linkedProjectId,
      kind: 'manual',
    };
  });

  const projectTimelineItems: PlannerDisplayItem[] = projects
    .filter(project => parseDateInput(project.startDate) && parseDateInput(project.endDate))
    .map(project => ({
      id: `project-${project.id}`,
      title: project.title,
      description: project.description,
      calendarId: projectPlanningCalendar.id,
      color: getProjectTimelineColor(project, projectPlanningCalendar.color),
      startDate: project.startDate,
      endDate: project.endDate,
      location: project.location.address,
      participantsLabel: `${project.volunteersNeeded} volunteer slots`,
      linkedProjectId: project.id,
      kind: 'project' as const,
      projectStatus: project.status,
    }));

  const allDisplayItems = [...projectTimelineItems, ...manualDisplayItems].sort((left, right) => {
    const leftDate = parseDateInput(left.startDate)?.getTime() || 0;
    const rightDate = parseDateInput(right.startDate)?.getTime() || 0;
    return leftDate - rightDate || left.title.localeCompare(right.title);
  });

  const filteredDisplayItems = allDisplayItems.filter(item => selectedCalendarIds.includes(item.calendarId));
  const activeRange = getPlannerRange(referenceDate, viewMode === 'agenda' ? 'month' : viewMode);
  const visibleDays = eachDayOfInterval({
    start: activeRange.startDate,
    end: activeRange.endDate,
  });
  const visibleWeeks = chunkDates(visibleDays);
  const rangeItems = filteredDisplayItems.filter(item =>
    itemTouchesRange(item, activeRange.startDate, activeRange.endDate)
  );
  const linkedProjectIds = new Set(
    manualDisplayItems
      .map(item => item.linkedProjectId)
      .filter((value): value is string => Boolean(value))
  );
  const unscheduledProjects = projects.filter(project => !linkedProjectIds.has(project.id));
  const currentMonthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(referenceDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(referenceDate), { weekStartsOn: 0 }),
  });
  const miniMonthWeeks = chunkDates(currentMonthDays);
  const scheduledThisRange = rangeItems.length;
  const manualItemsThisRange = manualDisplayItems.filter(item =>
    itemTouchesRange(item, activeRange.startDate, activeRange.endDate)
  ).length;
  const projectTimelineCount = projectTimelineItems.filter(item =>
    itemTouchesRange(item, activeRange.startDate, activeRange.endDate)
  ).length;
  const useStackedLayout = Platform.OS !== 'web' || viewportWidth < 1280;
  const useStackedSummaryCards = Platform.OS !== 'web' || viewportWidth < 1100;
  const useCompactScheduler = viewportWidth < 1180;

  const openPlannerItemModal = (date = selectedDate, project?: Project) => {
    const defaultCalendarId = project ? projectPlanningCalendar.id : planningCalendars[0]?.id || 'planner-projects';
    setItemDraft({
      id: undefined,
      title: project ? project.title : '',
      description: project?.description || '',
      calendarId: defaultCalendarId,
      linkedProjectId: project?.id || '',
      startDate: project?.startDate || toDateInput(date),
      endDate: project?.endDate || toDateInput(date),
      location: project?.location.address || '',
      participantsLabel: project ? `${project.volunteersNeeded} volunteer slots` : '',
    });
    setSelectedDate(date);
    setShowItemModal(true);
  };

  const openEditPlannerItem = (item: AdminPlanningItem) => {
    setItemDraft({
      id: item.id,
      title: item.title,
      description: item.description || '',
      calendarId: item.calendarId,
      linkedProjectId: item.linkedProjectId || '',
      startDate: item.startDate,
      endDate: item.endDate,
      location: item.location || '',
      participantsLabel: item.participantsLabel || '',
    });
    setShowItemModal(true);
  };

  const openCalendarEditor = (calendar?: AdminPlanningCalendar) => {
    if (calendar) {
      setCalendarDraft({
        id: calendar.id,
        name: calendar.name,
        description: calendar.description || '',
        color: calendar.color,
      });
    } else {
      setCalendarDraft(createEmptyPlanningCalendarDraft(planningCalendars[0]?.color || COLOR_OPTIONS[0]));
    }

    setShowCalendarModal(true);
  };

  const handleItemChipPress = (item: PlannerDisplayItem) => {
    if (item.kind === 'project') {
      navigation.navigate('Projects', {
        projectId: item.linkedProjectId,
      });
      return;
    }

    const editableItem = planningItems.find(entry => entry.id === item.id);
    if (editableItem) {
      openEditPlannerItem(editableItem);
    }
  };

  const handleSavePlannerItem = async () => {
    const startDate = parseDateInput(itemDraft.startDate);
    const endDate = parseDateInput(itemDraft.endDate);

    if (!itemDraft.title.trim()) {
      Alert.alert('Validation Error', 'Enter a title for this plan item.');
      return;
    }

    if (!planningCalendars.some(calendar => calendar.id === itemDraft.calendarId)) {
      Alert.alert('Validation Error', 'Choose a calendar lane for this plan item.');
      return;
    }

    if (!startDate || !endDate) {
      Alert.alert('Validation Error', 'Use the YYYY-MM-DD format for both start and end dates.');
      return;
    }

    if (endDate < startDate) {
      Alert.alert('Validation Error', 'The end date cannot be earlier than the start date.');
      return;
    }

    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      await saveAdminPlanningItem({
        id: itemDraft.id || `planner-item-${Date.now()}`,
        title: itemDraft.title,
        description: itemDraft.description,
        calendarId: itemDraft.calendarId,
        linkedProjectId: itemDraft.linkedProjectId || undefined,
        startDate: itemDraft.startDate,
        endDate: itemDraft.endDate,
        location: itemDraft.location,
        participantsLabel: itemDraft.participantsLabel,
        createdBy: user?.id || 'admin',
        createdAt: itemDraft.id
          ? planningItems.find(item => item.id === itemDraft.id)?.createdAt || timestamp
          : timestamp,
        updatedAt: timestamp,
      });
      setShowItemModal(false);
      await loadPlannerData();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Unable to save this plan item.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlannerItem = async () => {
    if (!itemDraft.id) {
      setShowItemModal(false);
      return;
    }

    Alert.alert('Delete plan item', 'Remove this entry from the calendar?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await deleteAdminPlanningItem(itemDraft.id!);
            setShowItemModal(false);
            await loadPlannerData();
          } catch (error) {
            Alert.alert(
              getRequestErrorTitle(error),
              getRequestErrorMessage(error, 'Unable to delete this plan item.')
            );
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const handleSavePlanningCalendar = async () => {
    if (!calendarDraft.name.trim()) {
      Alert.alert('Validation Error', 'Enter a calendar name.');
      return;
    }

    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const existingCalendar = planningCalendars.find(calendar => calendar.id === calendarDraft.id);
      const savedCalendar: AdminPlanningCalendar = {
        id: calendarDraft.id || `planner-calendar-${Date.now()}`,
        name: calendarDraft.name,
        description: calendarDraft.description,
        color: calendarDraft.color,
        createdAt: existingCalendar?.createdAt || timestamp,
        updatedAt: timestamp,
      };

      await saveAdminPlanningCalendar(savedCalendar);
      setSelectedCalendarIds(currentSelection => {
        if (currentSelection.includes(savedCalendar.id)) {
          return currentSelection;
        }
        return [...currentSelection, savedCalendar.id];
      });
      setShowCalendarModal(false);
      await loadPlannerData();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Unable to save this calendar.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlanningCalendar = (calendarId: string) => {
    Alert.alert('Delete calendar', 'Remove this custom calendar lane?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await deleteAdminPlanningCalendar(calendarId);
            setShowCalendarModal(false);
            await loadPlannerData();
          } catch (error) {
            Alert.alert(
              getRequestErrorTitle(error),
              getRequestErrorMessage(error, 'Unable to delete this calendar.')
            );
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const toggleCalendarSelection = (calendarId: string) => {
    setSelectedCalendarIds(currentSelection => {
      if (currentSelection.includes(calendarId)) {
        if (currentSelection.length === 1) {
          return currentSelection;
        }
        return currentSelection.filter(id => id !== calendarId);
      }

      return [...currentSelection, calendarId];
    });
  };

  const shiftRange = (direction: 'backward' | 'forward') => {
    setReferenceDate(currentDate => {
      if (viewMode === 'month' || viewMode === 'agenda') {
        return direction === 'forward' ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
      }

      return direction === 'forward' ? addWeeks(currentDate, 3) : subWeeks(currentDate, 3);
    });
  };

  if (!isAdmin) {
    return (
      <View style={styles.centerState}>
        <MaterialIcons name="lock" size={42} color="#166534" />
        <Text style={styles.centerTitle}>Admin planner only</Text>
        <Text style={styles.centerText}>
          This calendar is available only to the admin workspace for project planning and scheduling.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color="#16A34A" />
        <Text style={styles.centerText}>Loading admin planner...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator
    >
      {loadError ? (
        <InlineLoadError
          title={loadError.title}
          message={loadError.message}
          onRetry={() => {
            setLoading(true);
            void loadPlannerData();
          }}
        />
      ) : null}

      <View style={styles.toolbarCard}>
        <View style={styles.toolbarTopRow}>
          <View>
            <Text style={styles.toolbarEyebrow}>Admin project planning board</Text>
            <Text style={styles.toolbarTitle}>Volunteer Operations Calendar</Text>
            <Text style={styles.toolbarSubtitle}>
              Schedule projects, meetings, deployments, and deadlines in one shared admin view.
            </Text>
          </View>

          <View style={styles.toolbarActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => openCalendarEditor()}>
              <MaterialIcons name="palette" size={18} color="#166534" />
              <Text style={styles.secondaryButtonText}>Add Calendar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={() => openPlannerItemModal()}>
              <MaterialIcons name="add" size={18} color="#ffffff" />
              <Text style={styles.primaryButtonText}>Add Plan</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.toolbarBottomRow}>
          <View style={styles.rangeControls}>
            <TouchableOpacity style={styles.iconButton} onPress={() => shiftRange('backward')}>
              <MaterialIcons name="chevron-left" size={20} color="#166534" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.todayButton}
              onPress={() => {
                const today = new Date();
                setReferenceDate(today);
                setSelectedDate(today);
              }}
            >
              <Text style={styles.todayButtonText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => shiftRange('forward')}>
              <MaterialIcons name="chevron-right" size={20} color="#166534" />
            </TouchableOpacity>
            <View style={styles.rangeLabelBlock}>
              <Text style={styles.rangeMonthLabel}>{format(referenceDate, 'MMMM yyyy')}</Text>
              <Text style={styles.rangeValueLabel}>{formatRangeLabel(referenceDate, viewMode)}</Text>
            </View>
          </View>

          <View style={styles.viewModeRow}>
            {VIEW_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.id}
                style={[styles.viewModeChip, viewMode === option.id && styles.viewModeChipActive]}
                onPress={() => setViewMode(option.id)}
              >
                <Text
                  style={[
                    styles.viewModeChipText,
                    viewMode === option.id && styles.viewModeChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={[styles.dashboardGrid, useStackedLayout ? styles.dashboardGridStacked : styles.dashboardGridWide]}>
        <View
          style={[
            styles.sidebarColumn,
            useStackedLayout ? styles.sidebarColumnStacked : styles.sidebarColumnWide,
          ]}
        >
          <View style={styles.sidebarCard}>
            <Text style={styles.sidebarTitle}>Mini calendar</Text>
            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map(day => (
                <Text key={day} style={styles.weekdayLabel}>
                  {day[0]}
                </Text>
              ))}
            </View>

            {miniMonthWeeks.map((week, weekIndex) => (
              <View key={`mini-week-${weekIndex}`} style={styles.miniWeekRow}>
                {week.map(day => {
                  const isSelected = isSameDay(day, selectedDate);
                  const isOutsideMonth = !isSameMonth(day, referenceDate);
                  const hasItems = filteredDisplayItems.some(item => itemSpansDay(item, day));
                  return (
                    <Pressable
                      key={day.toISOString()}
                      style={[
                        styles.miniDayButton,
                        isSelected && styles.miniDayButtonSelected,
                        isOutsideMonth && styles.miniDayButtonMuted,
                      ]}
                      onPress={() => {
                        setSelectedDate(day);
                        setReferenceDate(day);
                      }}
                    >
                      <Text
                        style={[
                          styles.miniDayLabel,
                          isSelected && styles.miniDayLabelSelected,
                          isOutsideMonth && styles.miniDayLabelMuted,
                        ]}
                      >
                        {format(day, 'd')}
                      </Text>
                      {hasItems ? <View style={styles.miniDayDot} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.sidebarCard}>
            <View style={styles.sidebarHeaderRow}>
              <Text style={styles.sidebarTitle}>Calendars</Text>
              <TouchableOpacity
                onPress={() => setSelectedCalendarIds(planningCalendars.map(calendar => calendar.id))}
              >
                <Text style={styles.inlineLink}>Select all</Text>
              </TouchableOpacity>
            </View>

            {planningCalendars.map(calendar => {
              const itemCount = allDisplayItems.filter(item => item.calendarId === calendar.id).length;
              const selected = selectedCalendarIds.includes(calendar.id);

              return (
                <View key={calendar.id} style={styles.calendarFilterRow}>
                  <TouchableOpacity
                    style={styles.calendarFilterToggle}
                    onPress={() => toggleCalendarSelection(calendar.id)}
                  >
                    <View
                      style={[
                        styles.calendarColorSwatch,
                        { backgroundColor: calendar.color },
                        !selected && styles.calendarColorSwatchMuted,
                      ]}
                    />
                    <View style={styles.calendarFilterCopy}>
                      <Text style={styles.calendarFilterName}>{calendar.name}</Text>
                      <Text style={styles.calendarFilterMeta}>{itemCount} items</Text>
                    </View>
                    <MaterialIcons
                      name={selected ? 'visibility' : 'visibility-off'}
                      size={18}
                      color={selected ? '#166534' : '#94A3B8'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openCalendarEditor(calendar)}>
                    <MaterialIcons name="edit" size={18} color="#166534" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={styles.sidebarCard}>
            <View style={styles.sidebarHeaderRow}>
              <Text style={styles.sidebarTitle}>Project backlog</Text>
              <Text style={styles.sidebarMeta}>{unscheduledProjects.length} unscheduled</Text>
            </View>

            {unscheduledProjects.slice(0, 5).map(project => (
              <View key={project.id} style={styles.projectBacklogCard}>
                <View style={styles.projectBacklogCopy}>
                  <Text style={styles.projectBacklogTitle}>{project.title}</Text>
                  <Text style={styles.projectBacklogMeta}>
                    {formatPlannerItemDateLabel({
                      id: project.id,
                      title: project.title,
                      calendarId: projectPlanningCalendar.id,
                      color: projectPlanningCalendar.color,
                      startDate: project.startDate,
                      endDate: project.endDate,
                      kind: 'project',
                    })}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.backlogPlanButton}
                  onPress={() => openPlannerItemModal(parseDateInput(project.startDate) || selectedDate, project)}
                >
                  <Text style={styles.backlogPlanButtonText}>Plan</Text>
                </TouchableOpacity>
              </View>
            ))}

            {unscheduledProjects.length === 0 ? (
              <Text style={styles.emptySidebarText}>
                Every project already has a matching custom plan entry.
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.mainColumn}>
          <View
            style={[
              styles.summaryRow,
              useStackedSummaryCards ? styles.summaryRowStacked : styles.summaryRowWide,
            ]}
          >
            <View style={[styles.summaryCard, styles.summaryCardTeal]}>
              <Text style={styles.summaryLabel}>Visible schedule items</Text>
              <Text style={styles.summaryValue}>{scheduledThisRange}</Text>
              <Text style={styles.summaryHint}>Across the current {viewMode === 'agenda' ? 'agenda' : viewMode} range</Text>
            </View>

            <View style={[styles.summaryCard, styles.summaryCardBlue]}>
              <Text style={styles.summaryLabel}>Custom admin plans</Text>
              <Text style={styles.summaryValue}>{manualItemsThisRange}</Text>
              <Text style={styles.summaryHint}>Meetings, trainings, fieldwork, and deadlines</Text>
            </View>

            <View style={[styles.summaryCard, styles.summaryCardLime]}>
              <Text style={styles.summaryLabel}>Project timelines</Text>
              <Text style={styles.summaryValue}>{projectTimelineCount}</Text>
              <Text style={styles.summaryHint}>Pulled directly from project start and end dates</Text>
            </View>
          </View>

          {viewMode === 'agenda' ? (
            <View style={styles.schedulerCard}>
              <Text style={styles.schedulerTitle}>Agenda view</Text>
              <Text style={styles.schedulerSubtitle}>
                Items are grouped by day so the admin can scan upcoming work quickly.
              </Text>

              {visibleDays
                .filter(day => rangeItems.some(item => itemSpansDay(item, day)))
                .map(day => {
                  const itemsForDay = rangeItems.filter(item => itemSpansDay(item, day));
                  return (
                    <View key={day.toISOString()} style={styles.agendaDayGroup}>
                      <View style={styles.agendaDayHeader}>
                        <Text style={styles.agendaDayLabel}>{format(day, 'EEEE')}</Text>
                        <Text style={styles.agendaDayDate}>{format(day, 'MMMM d, yyyy')}</Text>
                        <TouchableOpacity
                          style={styles.agendaAddButton}
                          onPress={() => openPlannerItemModal(day)}
                        >
                          <MaterialIcons name="add" size={16} color="#166534" />
                        </TouchableOpacity>
                      </View>

                      {itemsForDay.map(item => (
                        <TouchableOpacity
                          key={`${item.id}-${day.toISOString()}`}
                          style={[styles.agendaItemCard, { borderLeftColor: item.color }]}
                          onPress={() => handleItemChipPress(item)}
                        >
                          <View style={styles.agendaItemTopRow}>
                            <Text style={styles.agendaItemTitle}>{item.title}</Text>
                            <Text style={styles.agendaItemBadge}>
                              {planningCalendars.find(calendar => calendar.id === item.calendarId)?.name || 'Plan'}
                            </Text>
                          </View>
                          <Text style={styles.agendaItemMeta}>{formatPlannerItemDateLabel(item)}</Text>
                          {item.location ? (
                            <Text style={styles.agendaItemMeta}>{item.location}</Text>
                          ) : null}
                          {item.projectStatus ? (
                            <Text style={styles.agendaItemMeta}>Project status: {item.projectStatus}</Text>
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })}

              {rangeItems.length === 0 ? (
                <View style={styles.emptyScheduleState}>
                  <MaterialIcons name="event-busy" size={32} color="#94A3B8" />
                  <Text style={styles.emptyScheduleTitle}>Nothing scheduled in this range</Text>
                  <Text style={styles.emptyScheduleText}>
                    Add a plan item or turn on more calendar lanes to populate the agenda.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.schedulerCard}>
              <View style={styles.schedulerHeaderRow}>
                <View>
                  <Text style={styles.schedulerTitle}>Scheduler view</Text>
                  <Text style={styles.schedulerSubtitle}>
                    Click a day to add a plan. Click a project band to jump to the Project Suite.
                  </Text>
                </View>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={useCompactScheduler}
                contentContainerStyle={styles.schedulerScrollContent}
              >
                <View
                  style={[
                    styles.schedulerBoard,
                    useCompactScheduler && styles.schedulerBoardCompact,
                  ]}
                >
                  <View style={styles.schedulerWeekdayRow}>
                    {WEEKDAY_LABELS.map(label => (
                      <View key={label} style={styles.schedulerWeekdayCell}>
                        <Text style={styles.schedulerWeekdayText}>{label}</Text>
                      </View>
                    ))}
                  </View>

                  {visibleWeeks.map((week, weekIndex) => (
                    <View key={`week-${weekIndex}`} style={styles.schedulerWeekRow}>
                      {week.map(day => {
                        const itemsForDay = rangeItems
                          .filter(item => itemSpansDay(item, day))
                          .slice(0, 5);
                        const hiddenItemCount =
                          rangeItems.filter(item => itemSpansDay(item, day)).length - itemsForDay.length;

                        return (
                          <View
                            key={day.toISOString()}
                            style={[
                              styles.schedulerDayCell,
                              !isSameMonth(day, referenceDate) && styles.schedulerDayCellMuted,
                              isSameDay(day, selectedDate) && styles.schedulerDayCellSelected,
                            ]}
                          >
                            <View style={styles.schedulerDayHeader}>
                              <TouchableOpacity
                                onPress={() => {
                                  setSelectedDate(day);
                                  setReferenceDate(day);
                                }}
                              >
                                <Text style={styles.schedulerDayNumber}>{format(day, 'd')}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => openPlannerItemModal(day)}>
                                <MaterialIcons name="add-circle-outline" size={18} color="#166534" />
                              </TouchableOpacity>
                            </View>

                            <View style={styles.schedulerItemsStack}>
                              {itemsForDay.map(item => (
                                <TouchableOpacity
                                  key={`${item.id}-${day.toISOString()}`}
                                  style={[styles.schedulerItemChip, { backgroundColor: item.color }]}
                                  onPress={() => handleItemChipPress(item)}
                                >
                                  <View style={styles.schedulerChipTopRow}>
                                    <MaterialIcons
                                      name={item.kind === 'project' ? 'business-center' : 'event-note'}
                                      size={11}
                                      color="#ffffff"
                                    />
                                    <Text style={styles.schedulerChipTitle} numberOfLines={1}>
                                      {item.title}
                                    </Text>
                                  </View>
                                  {item.projectStatus ? (
                                    <Text style={styles.schedulerChipMeta} numberOfLines={1}>
                                      {item.projectStatus}
                                    </Text>
                                  ) : item.location ? (
                                    <Text style={styles.schedulerChipMeta} numberOfLines={1}>
                                      {item.location}
                                    </Text>
                                  ) : null}
                                </TouchableOpacity>
                              ))}

                              {hiddenItemCount > 0 ? (
                                <Text style={styles.hiddenItemsText}>+{hiddenItemCount} more</Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      <Modal visible={showItemModal} transparent animationType="slide" onRequestClose={() => setShowItemModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{itemDraft.id ? 'Edit plan item' : 'Add plan item'}</Text>
                <Text style={styles.modalSubtitle}>Create a custom entry for the admin scheduling board.</Text>
              </View>
              <TouchableOpacity onPress={() => setShowItemModal(false)}>
                <MaterialIcons name="close" size={24} color="#334155" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.input}
                value={itemDraft.title}
                onChangeText={value => setItemDraft(current => ({ ...current, title: value }))}
                placeholder="Volunteer orientation"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={itemDraft.description}
                onChangeText={value => setItemDraft(current => ({ ...current, description: value }))}
                placeholder="Add context, goals, or facilitator notes"
                placeholderTextColor="#94A3B8"
                multiline
              />

              <Text style={styles.fieldLabel}>Calendar lane</Text>
              <View style={styles.selectorWrap}>
                {planningCalendars.map(calendar => (
                  <TouchableOpacity
                    key={calendar.id}
                    style={[
                      styles.selectorChip,
                      itemDraft.calendarId === calendar.id && {
                        backgroundColor: calendar.color,
                        borderColor: calendar.color,
                      },
                    ]}
                    onPress={() => setItemDraft(current => ({ ...current, calendarId: calendar.id }))}
                  >
                    <Text
                      style={[
                        styles.selectorChipText,
                        itemDraft.calendarId === calendar.id && styles.selectorChipTextActive,
                      ]}
                    >
                      {calendar.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.fieldRow}>
                <View style={styles.fieldColumn}>
                  <Text style={styles.fieldLabel}>Start date</Text>
                  <TextInput
                    style={styles.input}
                    value={itemDraft.startDate}
                    onChangeText={value => setItemDraft(current => ({ ...current, startDate: value }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <View style={styles.fieldColumn}>
                  <Text style={styles.fieldLabel}>End date</Text>
                  <TextInput
                    style={styles.input}
                    value={itemDraft.endDate}
                    onChangeText={value => setItemDraft(current => ({ ...current, endDate: value }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={itemDraft.location}
                onChangeText={value => setItemDraft(current => ({ ...current, location: value }))}
                placeholder="Kabankalan City Hall"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.fieldLabel}>Participants or staffing note</Text>
              <TextInput
                style={styles.input}
                value={itemDraft.participantsLabel}
                onChangeText={value => setItemDraft(current => ({ ...current, participantsLabel: value }))}
                placeholder="12 volunteers + 2 facilitators"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.fieldLabel}>Link to a project</Text>
              <View style={styles.selectorWrap}>
                <TouchableOpacity
                  style={[
                    styles.selectorChip,
                    !itemDraft.linkedProjectId && styles.selectorChipNeutralActive,
                  ]}
                  onPress={() => setItemDraft(current => ({ ...current, linkedProjectId: '' }))}
                >
                  <Text
                    style={[
                      styles.selectorChipText,
                      !itemDraft.linkedProjectId && styles.selectorChipTextActive,
                    ]}
                  >
                    None
                  </Text>
                </TouchableOpacity>

                {projects.map(project => (
                  <TouchableOpacity
                    key={project.id}
                    style={[
                      styles.selectorChip,
                      itemDraft.linkedProjectId === project.id && styles.selectorChipNeutralActive,
                    ]}
                    onPress={() =>
                      setItemDraft(current => ({
                        ...current,
                        linkedProjectId: project.id,
                        title: current.title.trim() ? current.title : project.title,
                        description: current.description.trim() ? current.description : project.description,
                        location: current.location.trim() ? current.location : project.location.address,
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.selectorChipText,
                        itemDraft.linkedProjectId === project.id && styles.selectorChipTextActive,
                      ]}
                    >
                      {project.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              {itemDraft.id ? (
                <TouchableOpacity style={styles.deleteButton} onPress={handleDeletePlannerItem}>
                  <MaterialIcons name="delete-outline" size={18} color="#DC2626" />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              ) : <View />}

              <View style={styles.modalActionRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowItemModal(false)}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, saving && styles.buttonDisabled]}
                  onPress={handleSavePlannerItem}
                  disabled={saving}
                >
                  <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Save Plan'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showCalendarModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCalendarModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{calendarDraft.id ? 'Edit calendar lane' : 'Create calendar lane'}</Text>
                <Text style={styles.modalSubtitle}>Customize planning lanes and colors for the admin board.</Text>
              </View>
              <TouchableOpacity onPress={() => setShowCalendarModal(false)}>
                <MaterialIcons name="close" size={24} color="#334155" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.fieldLabel}>Existing lanes</Text>
              {planningCalendars.map(calendar => (
                <View key={calendar.id} style={styles.existingCalendarCard}>
                  <View style={[styles.calendarColorSwatchLarge, { backgroundColor: calendar.color }]} />
                  <View style={styles.existingCalendarCopy}>
                    <Text style={styles.existingCalendarName}>{calendar.name}</Text>
                    <Text style={styles.existingCalendarDescription}>
                      {calendar.description || 'No description yet.'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => openCalendarEditor(calendar)}>
                    <MaterialIcons name="edit" size={18} color="#166534" />
                  </TouchableOpacity>
                </View>
              ))}

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={calendarDraft.name}
                onChangeText={value => setCalendarDraft(current => ({ ...current, name: value }))}
                placeholder="Community events"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={calendarDraft.description}
                onChangeText={value => setCalendarDraft(current => ({ ...current, description: value }))}
                placeholder="Use this lane for high-visibility public activities."
                placeholderTextColor="#94A3B8"
                multiline
              />

              <Text style={styles.fieldLabel}>Color</Text>
              <View style={styles.colorPaletteRow}>
                {COLOR_OPTIONS.map(color => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorSwatchButton,
                      { backgroundColor: color },
                      calendarDraft.color === color && styles.colorSwatchButtonActive,
                    ]}
                    onPress={() => setCalendarDraft(current => ({ ...current, color }))}
                  />
                ))}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              {calendarDraft.id ? (
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeletePlanningCalendar(calendarDraft.id!)}
                >
                  <MaterialIcons name="delete-outline" size={18} color="#DC2626" />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              ) : <View />}

              <View style={styles.modalActionRow}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    setCalendarDraft(createEmptyPlanningCalendarDraft());
                    setShowCalendarModal(false);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, saving && styles.buttonDisabled]}
                  onPress={handleSavePlanningCalendar}
                  disabled={saving}
                >
                  <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Save Calendar'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7F3',
  },
  contentContainer: {
    gap: 18,
    paddingBottom: 18,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#F5F7F3',
  },
  centerTitle: {
    marginTop: 14,
    fontSize: 24,
    fontWeight: '800',
    color: '#14532D',
  },
  centerText: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
    textAlign: 'center',
    maxWidth: 520,
  },
  toolbarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 20,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  toolbarTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  toolbarEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  toolbarTitle: {
    marginTop: 6,
    fontSize: 28,
    fontWeight: '800',
    color: '#16351F',
  },
  toolbarSubtitle: {
    marginTop: 8,
    maxWidth: 620,
    fontSize: 14,
    lineHeight: 22,
    color: '#64748B',
  },
  toolbarActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  toolbarBottomRow: {
    marginTop: 18,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    flexWrap: 'wrap',
  },
  rangeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#14532D',
  },
  rangeLabelBlock: {
    marginLeft: 6,
  },
  rangeMonthLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16A34A',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  rangeValueLabel: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  viewModeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  viewModeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
  },
  viewModeChipActive: {
    backgroundColor: '#166534',
  },
  viewModeChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  viewModeChipTextActive: {
    color: '#FFFFFF',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#166534',
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  dashboardGrid: {
    gap: 18,
  },
  dashboardGridWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  dashboardGridStacked: {
    flexDirection: 'column',
  },
  sidebarColumn: {
    gap: 16,
  },
  sidebarColumnWide: {
    width: 300,
    flexShrink: 0,
  },
  sidebarColumnStacked: {
    width: '100%',
  },
  mainColumn: {
    flex: 1,
    gap: 16,
    minWidth: 0,
  },
  sidebarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sidebarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#16351F',
  },
  sidebarMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  inlineLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  miniWeekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  miniDayButton: {
    width: `${100 / 7}%`,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  miniDayButtonSelected: {
    backgroundColor: '#166534',
  },
  miniDayButtonMuted: {
    opacity: 0.45,
  },
  miniDayLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  miniDayLabelSelected: {
    color: '#FFFFFF',
  },
  miniDayLabelMuted: {
    color: '#64748B',
  },
  miniDayDot: {
    marginTop: 3,
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#16A34A',
  },
  calendarFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  calendarFilterToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  calendarColorSwatch: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  calendarColorSwatchMuted: {
    opacity: 0.35,
  },
  calendarFilterCopy: {
    flex: 1,
  },
  calendarFilterName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  calendarFilterMeta: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748B',
  },
  projectBacklogCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  projectBacklogCopy: {
    flex: 1,
  },
  projectBacklogTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  projectBacklogMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748B',
  },
  backlogPlanButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
  },
  backlogPlanButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  emptySidebarText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#64748B',
  },
  summaryRow: {
    gap: 14,
  },
  summaryRowWide: {
    flexDirection: 'row',
  },
  summaryRowStacked: {
    flexDirection: 'column',
  },
  summaryCard: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    minWidth: 0,
  },
  summaryCardTeal: {
    backgroundColor: '#CCFBF1',
  },
  summaryCardBlue: {
    backgroundColor: '#DBEAFE',
  },
  summaryCardLime: {
    backgroundColor: '#ECFCCB',
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  summaryValue: {
    marginTop: 12,
    fontSize: 34,
    fontWeight: '800',
    color: '#0F172A',
  },
  summaryHint: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  schedulerCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    minWidth: 0,
  },
  schedulerHeaderRow: {
    marginBottom: 14,
  },
  schedulerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#16351F',
  },
  schedulerSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: '#64748B',
  },
  schedulerScrollContent: {
    flexGrow: 1,
    width: '100%',
  },
  schedulerBoard: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    minWidth: 0,
  },
  schedulerBoardCompact: {
    minWidth: 860,
  },
  schedulerWeekdayRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
  },
  schedulerWeekdayCell: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
  },
  schedulerWeekdayText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  schedulerWeekRow: {
    flexDirection: 'row',
  },
  schedulerDayCell: {
    flex: 1,
    minHeight: 180,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  schedulerDayCellMuted: {
    backgroundColor: '#F8FAFC',
  },
  schedulerDayCellSelected: {
    backgroundColor: '#F0FDF4',
  },
  schedulerDayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  schedulerDayNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  schedulerItemsStack: {
    gap: 8,
  },
  schedulerItemChip: {
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  schedulerChipTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  schedulerChipTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  schedulerChipMeta: {
    marginTop: 4,
    fontSize: 10,
    color: 'rgba(255,255,255,0.92)',
  },
  hiddenItemsText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  agendaDayGroup: {
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 14,
  },
  agendaDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  agendaDayLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  agendaDayDate: {
    fontSize: 13,
    color: '#64748B',
  },
  agendaAddButton: {
    marginLeft: 'auto',
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agendaItemCard: {
    borderLeftWidth: 5,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  agendaItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  agendaItemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  agendaItemBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  agendaItemMeta: {
    marginTop: 5,
    fontSize: 12,
    color: '#64748B',
  },
  emptyScheduleState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 42,
  },
  emptyScheduleTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptyScheduleText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    color: '#64748B',
    maxWidth: 440,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    paddingHorizontal: 20,
    paddingVertical: 24,
    justifyContent: 'center',
  },
  modalCard: {
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
  },
  modalHeader: {
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: '#64748B',
  },
  modalScroll: {
    maxHeight: Platform.OS === 'web' ? 640 : 560,
  },
  modalScrollContent: {
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  fieldLabel: {
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 14,
  },
  textarea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  fieldRow: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    gap: 12,
  },
  fieldColumn: {
    flex: 1,
  },
  selectorWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  selectorChip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#FFFFFF',
  },
  selectorChipNeutralActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  selectorChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  selectorChipTextActive: {
    color: '#FFFFFF',
  },
  colorPaletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  colorSwatchButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
  },
  colorSwatchButtonActive: {
    borderWidth: 3,
    borderColor: '#0F172A',
  },
  existingCalendarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  calendarColorSwatchLarge: {
    width: 16,
    height: 48,
    borderRadius: 999,
  },
  existingCalendarCopy: {
    flex: 1,
  },
  existingCalendarName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  existingCalendarDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748B',
  },
  modalFooter: {
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
  },
  deleteButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
