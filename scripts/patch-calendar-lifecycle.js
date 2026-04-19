const fs = require('fs');

function write(path, content) {
  fs.writeFileSync(path, content, { encoding: 'utf8' });
}

const dashboardPath = 'C:/Users/ASUS/Desktop/VMS/volunteer-system/screens/DashboardScreen.tsx';
let dashboard = fs.readFileSync(dashboardPath, 'utf8');

if (!dashboard.includes('calendarOpenHint')) {
  dashboard = dashboard.replace(
    /\s*<View style=\{\[styles\.panel, styles\.compactPanel\]\}>[\s\S]*?<\/View>\s*\n\s*<\/View>\n\s*<\/View>/,
`            <TouchableOpacity
              style={[styles.panel, styles.compactPanel]}
              onPress={() => openLifecycle()}
              activeOpacity={0.85}
            >
              <View style={styles.panelHeaderCompact}>
                <Text style={styles.panelTitle}>Calendar</Text>
              </View>
              <Text style={styles.calendarDay}>Monday</Text>
              <Text style={styles.calendarDate}>January 5</Text>
              <Text style={styles.calendarYear}>2026</Text>
              <Text style={styles.calendarOpenHint}>Open lifecycle scheduler</Text>
            </TouchableOpacity>
          </View>
        </View>`
  );

  dashboard = dashboard.replace(
    /calendarYear:\s*\{[\s\S]*?\n\s*\},/,
`calendarYear: {
    marginTop: 6,
    fontSize: 16,
    color: '#4b5563',
    fontWeight: '700',
  },
  calendarOpenHint: {
    marginTop: 10,
    fontSize: 11,
    color: '#166534',
    fontWeight: '700',
  },`
  );
}

write(dashboardPath, dashboard);

const lifecyclePath = 'C:/Users/ASUS/Desktop/VMS/volunteer-system/screens/ProjectLifecycleScreen.tsx';
let lifecycle = fs.readFileSync(lifecyclePath, 'utf8');

lifecycle = lifecycle.replace(`new Date('"'"'2026-01-05T00:00:00'"'"')`, `new Date('2026-01-05T00:00:00')`);

if (!lifecycle.includes('type LifecycleBoardView')) {
  lifecycle = lifecycle.replace(
`type ProjectTimeLogEntry = VolunteerTimeLog & {
  volunteerName: string;
  volunteerEmail: string;
};
`,
`type ProjectTimeLogEntry = VolunteerTimeLog & {
  volunteerName: string;
  volunteerEmail: string;
};

type LifecycleBoardView = 'scheduler' | 'timeline';

function getStartOfWeekMonday(sourceDate: Date): Date {
  const date = new Date(sourceDate);
  const dayIndex = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayIndex);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getCalendarDayDifference(start: Date, end: Date): number {
  const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((utcEnd - utcStart) / (1000 * 60 * 60 * 24));
}

function isDateOverlappingRange(target: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return target.getTime() >= rangeStart.getTime() && target.getTime() <= rangeEnd.getTime();
}
`
  );
}

if (!lifecycle.includes('const [lifecycleView, setLifecycleView]')) {
  lifecycle = lifecycle.replace(
`  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(createEmptyProjectDraft());
  const [taskDraft, setTaskDraft] = useState<ProjectTaskDraft>(createEmptyProjectTaskDraft());
`,
`  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(createEmptyProjectDraft());
  const [taskDraft, setTaskDraft] = useState<ProjectTaskDraft>(createEmptyProjectTaskDraft());
  const [lifecycleView, setLifecycleView] = useState<LifecycleBoardView>(() =>
    route?.params?.lifecycleView === 'timeline' ? 'timeline' : 'scheduler'
  );
`
  );
}

if (!lifecycle.includes('requestedLifecycleView')) {
  lifecycle = lifecycle.replace(
`  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projects.length === 0) {
      return;
    }

    const nextProject = projects.find(project => project.id === requestedProjectId);
    if (!nextProject) {
      return;
    }

    void handleSelectProject(nextProject);
    navigation.setParams({ projectId: undefined });
  }, [navigation, projects, route?.params?.projectId]);
`,
`  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projects.length === 0) {
      return;
    }

    const nextProject = projects.find(project => project.id === requestedProjectId);
    if (!nextProject) {
      return;
    }

    void handleSelectProject(nextProject);
    navigation.setParams({ projectId: undefined });
  }, [navigation, projects, route?.params?.projectId]);

  useEffect(() => {
    const requestedLifecycleView = route?.params?.lifecycleView;
    if (requestedLifecycleView !== 'scheduler' && requestedLifecycleView !== 'timeline') {
      return;
    }

    setLifecycleView(requestedLifecycleView);
    navigation.setParams({ lifecycleView: undefined });
  }, [navigation, route?.params?.lifecycleView]);
`
  );
}

if (!lifecycle.includes('lifecycleBoardCard')) {
  lifecycle = lifecycle.replace(
`      {!loadError && projects.length === 0 ? (
`,
`      {!loadError ? (
        <View style={styles.lifecycleBoardCard}>
          <View style={styles.lifecycleBoardHeader}>
            <View>
              <Text style={styles.lifecycleBoardTitle}>Calendar</Text>
              <Text style={styles.lifecycleBoardDay}>{format(schedulerAnchorDate, 'EEEE')}</Text>
              <Text style={styles.lifecycleBoardDate}>{format(schedulerAnchorDate, 'MMMM d')}</Text>
              <Text style={styles.lifecycleBoardYear}>{format(schedulerAnchorDate, 'yyyy')}</Text>
            </View>
            <View style={styles.lifecycleBoardTabs}>
              <TouchableOpacity
                style={[
                  styles.lifecycleBoardTab,
                  lifecycleView === 'scheduler' && styles.lifecycleBoardTabActive,
                ]}
                onPress={() => setLifecycleView('scheduler')}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.lifecycleBoardTabText,
                    lifecycleView === 'scheduler' && styles.lifecycleBoardTabTextActive,
                  ]}
                >
                  Scheduler
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.lifecycleBoardTab,
                  lifecycleView === 'timeline' && styles.lifecycleBoardTabActive,
                ]}
                onPress={() => setLifecycleView('timeline')}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.lifecycleBoardTabText,
                    lifecycleView === 'timeline' && styles.lifecycleBoardTabTextActive,
                  ]}
                >
                  Timeline
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {lifecycleView === 'scheduler' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.schedulerWeekRow}>
                {schedulerDays.map(day => {
                  const dayProjects = visibleBoardProjects.filter(project => {
                    const startDate = new Date(project.startDate);
                    const endDate = new Date(project.endDate);
                    return isDateOverlappingRange(day, startDate, endDate);
                  });

                  return (
                    <View key={day.toISOString()} style={styles.schedulerDayColumn}>
                      <Text style={styles.schedulerDayName}>{format(day, 'EEE')}</Text>
                      <Text style={styles.schedulerDayDate}>{format(day, 'MMM d')}</Text>

                      {dayProjects.length ? (
                        dayProjects.slice(0, 6).map(project => (
                          <TouchableOpacity
                            key={`${day.toISOString()}-${project.id}`}
                            style={[
                              styles.schedulerEventPill,
                              { borderLeftColor: getProjectStatusColor(project.status) },
                            ]}
                            onPress={() => {
                              void handleSelectProject(project);
                            }}
                            activeOpacity={0.85}
                          >
                            <Text numberOfLines={1} style={styles.schedulerEventTitle}>
                              {project.title}
                            </Text>
                            <Text style={styles.schedulerEventMeta}>{project.status}</Text>
                          </TouchableOpacity>
                        ))
                      ) : (
                        <Text style={styles.schedulerEmptyText}>No schedules</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.timelineBoard}>
                <View style={styles.timelineHeaderRow}>
                  <Text style={styles.timelineHeaderProject}>Project</Text>
                  <View style={styles.timelineHeaderDays}>
                    {schedulerDays.map(day => (
                      <Text key={`header-${day.toISOString()}`} style={styles.timelineHeaderDay}>
                        {format(day, 'MMM d')}
                      </Text>
                    ))}
                  </View>
                </View>

                {visibleBoardProjects.length ? (
                  visibleBoardProjects.map(project => {
                    const projectStart = new Date(project.startDate);
                    const projectEnd = new Date(project.endDate);
                    const clampedStartOffset = Math.max(
                      0,
                      getCalendarDayDifference(schedulerWindow.start, projectStart)
                    );
                    const clampedEndOffset = Math.min(
                      6,
                      getCalendarDayDifference(schedulerWindow.start, projectEnd)
                    );
                    const spanDays = Math.max(1, clampedEndOffset - clampedStartOffset + 1);

                    return (
                      <TouchableOpacity
                        key={`timeline-${project.id}`}
                        style={styles.timelineProjectRow}
                        onPress={() => {
                          void handleSelectProject(project);
                        }}
                        activeOpacity={0.85}
                      >
                        <Text numberOfLines={1} style={styles.timelineProjectName}>{project.title}</Text>
                        <View style={styles.timelineTrack}>
                          <View
                            style={[
                              styles.timelineBar,
                              {
                                left: clampedStartOffset * timelineCellWidth,
                                width: spanDays * timelineCellWidth,
                                backgroundColor: getProjectStatusColor(project.status),
                              },
                            ]}
                          />
                          <Text style={styles.timelineDateRange}>
                            {format(projectStart, 'MMM d')} - {format(projectEnd, 'MMM d')}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <Text style={styles.schedulerEmptyText}>No projects scheduled in this week.</Text>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      ) : null}

      {!loadError && projects.length === 0 ? (
`
  );
}

if (!lifecycle.includes('const schedulerAnchorDate = useMemo')) {
  lifecycle = lifecycle.replace(
`  const activeSelectedProject = getCurrentSelectedProject();
`,
`  const schedulerAnchorDate = useMemo(() => new Date('2026-01-05T00:00:00'), []);

  const schedulerDays = useMemo(() => {
    const monday = getStartOfWeekMonday(schedulerAnchorDate);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + index);
      return day;
    });
  }, [schedulerAnchorDate]);

  const schedulerWindow = useMemo(() => {
    const start = schedulerDays[0] || getStartOfWeekMonday(new Date());
    const end = schedulerDays[6] || start;
    return { start, end };
  }, [schedulerDays]);

  const visibleBoardProjects = useMemo(
    () =>
      projects
        .filter(project => {
          const startDate = new Date(project.startDate);
          const endDate = new Date(project.endDate);
          if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return false;
          }

          return isDateOverlappingRange(schedulerWindow.start, startDate, endDate)
            || isDateOverlappingRange(schedulerWindow.end, startDate, endDate)
            || isDateOverlappingRange(startDate, schedulerWindow.start, schedulerWindow.end);
        })
        .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime()),
    [projects, schedulerWindow.end, schedulerWindow.start]
  );

  const timelineCellWidth = 64;

  const activeSelectedProject = getCurrentSelectedProject();
`
  );
}

if (!lifecycle.includes('lifecycleBoardCard:')) {
  lifecycle = lifecycle.replace(
`  addButton: {
`,
`  lifecycleBoardCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 16,
    marginBottom: 16,
  },
  lifecycleBoardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  lifecycleBoardTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1e3a8a',
  },
  lifecycleBoardDay: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
  },
  lifecycleBoardDate: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  lifecycleBoardYear: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '700',
    color: '#2563eb',
  },
  lifecycleBoardTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  lifecycleBoardTab: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
  },
  lifecycleBoardTabActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  lifecycleBoardTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  lifecycleBoardTabTextActive: {
    color: '#ffffff',
  },
  schedulerWeekRow: {
    flexDirection: 'row',
    gap: 10,
  },
  schedulerDayColumn: {
    width: 170,
    minHeight: 220,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#f8fafc',
  },
  schedulerDayName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  schedulerDayDate: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  schedulerEventPill: {
    borderLeftWidth: 4,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginBottom: 8,
  },
  schedulerEventTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  schedulerEventMeta: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  schedulerEmptyText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 6,
  },
  timelineBoard: {
    minWidth: 880,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  timelineHeaderProject: {
    width: 220,
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
  },
  timelineHeaderDays: {
    flexDirection: 'row',
    width: 448,
    justifyContent: 'space-between',
  },
  timelineHeaderDay: {
    width: 64,
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    fontWeight: '700',
  },
  timelineProjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  timelineProjectName: {
    width: 220,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    paddingRight: 10,
  },
  timelineTrack: {
    width: 448,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    position: 'relative',
    justifyContent: 'center',
  },
  timelineBar: {
    position: 'absolute',
    top: 5,
    height: 24,
    borderRadius: 6,
  },
  timelineDateRange: {
    paddingLeft: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
  },
  addButton: {
`
  );
}

write(lifecyclePath, lifecycle);
console.log('patched-dashboard-and-lifecycle');
