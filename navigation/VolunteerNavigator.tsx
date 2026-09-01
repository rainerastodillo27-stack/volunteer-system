import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import ScreenBrandHeader from '../components/ScreenBrandHeader';
import VolunteerHomeScreen from '../screens/VolunteerHomeScreen';
import VolunteerDashboardScreen from '../screens/VolunteerDashboardScreen';
import VolunteerEventsScreen from '../screens/VolunteerEventsScreen';
import VolunteerProjectsScreen from '../screens/VolunteerProjectsScreen';
import VolunteerTasksScreen from '../screens/VolunteerTasksScreen';
import MappingScreen from '../screens/MappingScreen';
import CommunicationHubScreen from '../screens/CommunicationHubScreen';
import VolunteerReportsScreen from '../screens/VolunteerReportsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import VolunteerProjectDetailsScreen from '../screens/VolunteerProjectDetailsScreen';
import { getUnreadMessagesForUser, subscribeToMessages, getAllUsers, subscribeToStorageChanges, markMessageAsRead } from '../models/storage';

export type VolunteerTabParamList = {
  Home: undefined;
  Dashboard: undefined;
  Programs: { projectId?: string } | undefined;
  Projects: { projectId?: string } | undefined;
  ProjectDetails: { projectId: string };
  Events: { projectId?: string } | undefined;
  Tasks: undefined;
  Map: undefined;
  Messages: { projectId?: string } | undefined;
  Reports: { projectId?: string; autoOpenUpload?: boolean } | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<VolunteerTabParamList>();

const getIconName = (routeName: keyof VolunteerTabParamList) => {
  switch (routeName) {
    case 'Home': return 'home';
    case 'Dashboard': return 'dashboard';
    case 'Programs': return 'business-center';
    case 'Projects': return 'business-center';
    case 'Events': return 'event';
    case 'Tasks': return 'assignment';
    case 'Map': return 'map';
    case 'Messages': return 'mail';
    case 'Reports': return 'insert-chart';
    case 'Profile': return 'person';
    default: return 'help-outline';
  }
};

export default function VolunteerNavigator() {
  const { user } = useAuth();
  const [unreadMessages, setUnreadMessages] = useState<any[]>([]);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!user?.id) return;
    const loadUnreadCount = async () => {
      try {
        const [messages, usersList] = await Promise.all([
          getUnreadMessagesForUser(user.id).catch(() => []),
          getAllUsers().catch(() => []),
        ]);
        const enriched = messages.map(msg => {
          const sender = usersList.find(u => u.id === msg.senderId);
          return {
            ...msg,
            senderName: sender ? sender.name : msg.senderId,
          };
        });
        setUnreadMessages(enriched);
        setMessageUnreadCount(enriched.length);
      } catch {}
    };
    loadUnreadCount();

    const unsubMessages = subscribeToMessages(user.id, loadUnreadCount);
    const unsubStorage = subscribeToStorageChanges(['messages', 'users'], loadUnreadCount);
    return () => {
      unsubMessages();
      unsubStorage?.();
    };
  }, [user?.id]);

  const handleNotificationsSeen = React.useCallback(async () => {
    if (!user?.id || unreadMessages.length === 0) return;
    await Promise.all(
      unreadMessages.map((msg) => markMessageAsRead(msg.id).catch(() => undefined))
    );
  }, [unreadMessages, user?.id]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: route.name !== 'Messages',
        header: ({ options, navigation }) => (
          <ScreenBrandHeader
            title={options.title || route.name}
            navigation={navigation}
            userId={user?.id}
            notificationCount={unreadMessages.length}
            unreadMessages={unreadMessages}
            onNotificationOpen={handleNotificationsSeen}
          />
        ),
        tabBarIcon: ({ color, size }) => (
          <View style={{ marginBottom: 6 }}>
            <MaterialIcons name={getIconName(route.name as keyof VolunteerTabParamList)} size={size} color={color} />
          </View>
        ),
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#999',
        tabBarShowLabel: false,
        tabBarItemStyle: { paddingTop: 6, paddingBottom: 8 },
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#eee', paddingBottom: Math.max(insets.bottom, 12), height: 56 + Math.max(insets.bottom, 12) },
      })}
    >
      <Tab.Screen name="Home" component={VolunteerHomeScreen} options={{ title: 'Home', headerShown: false }} />
      <Tab.Screen name="Dashboard" component={VolunteerDashboardScreen} options={{ title: 'Volunteer Dashboard' }} />
      <Tab.Screen name="Programs" component={VolunteerProjectsScreen} options={{ title: 'Program Management' }} />
      <Tab.Screen name="Projects" component={VolunteerProjectsScreen} options={{ title: 'Program Management', tabBarButton: () => null }} />
      <Tab.Screen name="Events" component={VolunteerEventsScreen} options={{ title: 'Events' }} />
      <Tab.Screen name="ProjectDetails" component={VolunteerProjectDetailsScreen} options={{ title: 'Project Details', tabBarButton: () => null }} />
      <Tab.Screen name="Tasks" component={VolunteerTasksScreen} options={{ title: 'My Tasks' }} />
      <Tab.Screen name="Map" component={MappingScreen} options={{ title: 'Impact Map' }} />
      <Tab.Screen name="Messages" component={CommunicationHubScreen} options={{ title: 'Messages', tabBarBadge: messageUnreadCount > 0 ? messageUnreadCount : undefined }} />
      <Tab.Screen name="Reports" component={VolunteerReportsScreen} options={{ title: 'My Reports' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'My Profile' }} />
    </Tab.Navigator>
  );
}
