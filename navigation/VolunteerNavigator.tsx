import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import ScreenBrandHeader from '../components/ScreenBrandHeader';
import {
  clearStorageCache,
  getAllProjects,
  getMessagesForUser,
  getVolunteerByUserId,
  subscribeToMessages,
  subscribeToStorageChanges,
} from '../models/storage';
import { Project, Volunteer } from '../models/types';

export type VolunteerTabParamList = {
  Dashboard: undefined;
  Projects: { projectId?: string } | undefined;
  ProjectDetails: { projectId: string };
  Tasks: undefined;
  Map: undefined;
  Messages: { projectId?: string } | undefined;
  Reports: { projectId?: string; autoOpenUpload?: boolean } | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<VolunteerTabParamList>();

function lazyScreen<T extends object>(loader: () => { default: React.ComponentType<T> }) {
  return function LazyLoadedScreen(props: T) {
    const Component = loader().default;
    return <Component {...props} />;
  };
}

const VolunteerDashboardScreen = lazyScreen(() => require('../screens/VolunteerDashboardScreen'));
const VolunteerProjectsScreen = lazyScreen(() => require('../screens/VolunteerProjectsScreen'));
const VolunteerTasksScreen = lazyScreen(() => require('../screens/VolunteerTasksScreen'));
const MappingScreen = lazyScreen(() => require('../screens/MappingScreen'));
const CommunicationHubScreen = lazyScreen(() => require('../screens/CommunicationHubScreen'));
const VolunteerReportsScreen = lazyScreen(() => require('../screens/VolunteerReportsScreen'));
const ProfileScreen = lazyScreen(() => require('../screens/ProfileScreen'));
const VolunteerProjectDetailsScreen = lazyScreen(() => require('../screens/VolunteerProjectDetailsScreen'));

const getIconName = (routeName: keyof VolunteerTabParamList) => {
  switch (routeName) {
    case 'Dashboard': return 'dashboard';
    case 'Projects': return 'business-center';
    case 'Tasks': return 'assignment';
    case 'Map': return 'map';
    case 'Messages': return 'mail';
    case 'Reports': return 'insert-chart';
    case 'Profile': return 'person';
    default: return 'help-outline';
  }
};

type TrackedVolunteerTask = {
  taskTitle: string;
  projectTitle: string;
  status: string;
  updatedAt: string;
  signature: string;
};

type TrackedJoinedEvent = {
  eventTitle: string;
};

function collectVolunteerAssignedTaskMap(
  projects: Project[],
  volunteer: Volunteer | null
): Map<string, TrackedVolunteerTask> {
  const assignmentMap = new Map<string, TrackedVolunteerTask>();

  if (!volunteer?.id) {
    return assignmentMap;
  }

  projects.forEach(project => {
    (project.internalTasks || []).forEach(task => {
      if (task.assignedVolunteerId !== volunteer.id) {
        return;
      }

      assignmentMap.set(`${project.id}:${task.id}`, {
        taskTitle: task.title,
        projectTitle: project.title,
        status: task.status,
        updatedAt: task.updatedAt,
        signature: [
          task.title,
          task.description,
          task.category,
          task.priority,
          task.status,
          task.updatedAt,
          (task.skillsNeeded || []).join(','),
        ].join('|'),
      });
    });
  });

  return assignmentMap;
}

function collectVolunteerJoinedEventMap(
  projects: Project[],
  userId: string,
  volunteer: Volunteer | null
): Map<string, TrackedJoinedEvent> {
  const joinedEventMap = new Map<string, TrackedJoinedEvent>();

  projects.forEach(project => {
    if (!project.isEvent) {
      return;
    }

    const joinedByUser = (project.joinedUserIds || []).includes(userId);
    const joinedByVolunteer = Boolean(
      volunteer?.id && (project.volunteers || []).includes(volunteer.id)
    );

    if (!joinedByUser && !joinedByVolunteer) {
      return;
    }

    joinedEventMap.set(project.id, {
      eventTitle: project.title,
    });
  });

  return joinedEventMap;
}

export default function VolunteerNavigator() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const taskAssignmentSnapshotRef = useRef<Map<string, TrackedVolunteerTask> | null>(null);
  const joinedEventSnapshotRef = useRef<Map<string, TrackedJoinedEvent> | null>(null);
  const taskAssignmentCheckInFlightRef = useRef(false);

  useEffect(() => {
    if (!user?.id) return;
    const loadUnreadCount = async () => {
      try {
        const messages = await getMessagesForUser(user.id);
        setMessageUnreadCount(messages.filter(m => !m.read && m.recipientId === user.id).length);
      } catch {}
    };
    loadUnreadCount();
    return subscribeToMessages(user.id, loadUnreadCount);
  }, [user?.id]);

  useEffect(() => {
    taskAssignmentSnapshotRef.current = null;
    joinedEventSnapshotRef.current = null;

    if (!user?.id) {
      return;
    }

    const refreshVolunteerTaskAssignments = async (showChangeAlert: boolean) => {
      if (taskAssignmentCheckInFlightRef.current) {
        return;
      }

      taskAssignmentCheckInFlightRef.current = true;
      try {
        if (showChangeAlert) {
          clearStorageCache(['projects', 'events']);
        }

        const [volunteerProfile, projects] = await Promise.all([
          getVolunteerByUserId(user.id),
          getAllProjects(),
        ]);
        const nextSnapshot = collectVolunteerAssignedTaskMap(projects, volunteerProfile);
        const previousSnapshot = taskAssignmentSnapshotRef.current;
        const nextJoinedEvents = collectVolunteerJoinedEventMap(projects, user.id, volunteerProfile);
        const previousJoinedEvents = joinedEventSnapshotRef.current;

        if (showChangeAlert && previousSnapshot) {
          const removedTasks = Array.from(previousSnapshot.entries())
            .filter(([assignmentKey]) => !nextSnapshot.has(assignmentKey))
            .map(([, task]) => task);

          if (removedTasks.length > 0) {
            const firstRemovedTask = removedTasks[0];
            const extraCount = removedTasks.length - 1;
            Alert.alert(
              'Task Unassigned',
              extraCount > 0
                ? `You were unassigned from "${firstRemovedTask.taskTitle}" in "${firstRemovedTask.projectTitle}" and ${extraCount} more task${extraCount === 1 ? '' : 's'}.`
                : `You were unassigned from "${firstRemovedTask.taskTitle}" in "${firstRemovedTask.projectTitle}". This task was removed from My Tasks.`
            );
          } else {
            const addedTasks = Array.from(nextSnapshot.entries())
              .filter(([assignmentKey]) => !previousSnapshot.has(assignmentKey))
              .map(([, task]) => task);
            const updatedTasks = Array.from(nextSnapshot.entries())
              .filter(([assignmentKey, task]) => {
                const previousTask = previousSnapshot.get(assignmentKey);
                return previousTask && previousTask.signature !== task.signature;
              })
              .map(([, task]) => task);

            if (addedTasks.length > 0) {
              const firstAddedTask = addedTasks[0];
              Alert.alert(
                'Task Assigned',
                `You were assigned to "${firstAddedTask.taskTitle}" in "${firstAddedTask.projectTitle}".`
              );
            } else if (updatedTasks.length > 0) {
              const firstUpdatedTask = updatedTasks[0];
              Alert.alert(
                'Task Updated',
                `"${firstUpdatedTask.taskTitle}" in "${firstUpdatedTask.projectTitle}" was updated. Current status: ${firstUpdatedTask.status}.`
              );
            }
          }
        }

        if (showChangeAlert && previousJoinedEvents) {
          const newlyJoinedEvents = Array.from(nextJoinedEvents.entries())
            .filter(([eventId]) => !previousJoinedEvents.has(eventId))
            .map(([, event]) => event);

          if (newlyJoinedEvents.length > 0) {
            const firstJoinedEvent = newlyJoinedEvents[0];
            Alert.alert(
              'Event Joined',
              `You are now joined to "${firstJoinedEvent.eventTitle}". You can open its Event GC and check assigned tasks.`
            );
          }
        }

        taskAssignmentSnapshotRef.current = nextSnapshot;
        joinedEventSnapshotRef.current = nextJoinedEvents;
      } catch (error) {
        console.error('Failed to refresh live task assignment notifications:', error);
      } finally {
        taskAssignmentCheckInFlightRef.current = false;
      }
    };

    void refreshVolunteerTaskAssignments(false);

    return subscribeToStorageChanges(['events', 'projects'], () => {
      void refreshVolunteerTaskAssignments(true);
    });
  }, [user?.id]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        header: ({ options }) => <ScreenBrandHeader title={options.title || route.name} />,
        tabBarIcon: ({ color, size }) => <MaterialIcons name={getIconName(route.name as keyof VolunteerTabParamList)} size={size} color={color} />,
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#999',
        tabBarShowLabel: false,
        tabBarItemStyle: { paddingTop: 6, paddingBottom: 10 },
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#eee',
          height: 58 + Math.max(insets.bottom, 16),
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={VolunteerDashboardScreen} options={{ title: 'Volunteer Dashboard' }} />
      <Tab.Screen name="Projects" component={VolunteerProjectsScreen} options={{ title: 'Program Suite' }} />
      <Tab.Screen name="ProjectDetails" component={VolunteerProjectDetailsScreen} options={{ title: 'Project Details', tabBarButton: () => null }} />
      <Tab.Screen name="Tasks" component={VolunteerTasksScreen} options={{ title: 'My Tasks' }} />
      <Tab.Screen name="Map" component={MappingScreen} options={{ title: 'Impact Map' }} />
      <Tab.Screen name="Messages" component={CommunicationHubScreen} options={{ title: 'Messages', tabBarBadge: messageUnreadCount > 0 ? messageUnreadCount : undefined }} />
      <Tab.Screen name="Reports" component={VolunteerReportsScreen} options={{ title: 'My Reports' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'My Profile' }} />
    </Tab.Navigator>
  );
}
