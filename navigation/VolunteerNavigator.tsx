import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import ScreenBrandHeader from '../components/ScreenBrandHeader';
import VolunteerDashboardScreen from '../screens/VolunteerDashboardScreen';
import VolunteerProjectsScreen from '../screens/VolunteerProjectsScreen';
import VolunteerTasksScreen from '../screens/VolunteerTasksScreen';
import MappingScreen from '../screens/MappingScreen';
import CommunicationHubScreen from '../screens/CommunicationHubScreen';
import VolunteerReportsScreen from '../screens/VolunteerReportsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import VolunteerProjectDetailsScreen from '../screens/VolunteerProjectDetailsScreen';
import { getMessagesForUser, subscribeToMessages } from '../models/storage';

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

export default function VolunteerNavigator() {
  const { user } = useAuth();
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);

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

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        header: ({ options }) => <ScreenBrandHeader title={options.title || route.name} />,
        tabBarIcon: ({ color, size }) => <MaterialIcons name={getIconName(route.name as keyof VolunteerTabParamList)} size={size} color={color} />,
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#eee', paddingBottom: 4 },
      })}
    >
      <Tab.Screen name="Dashboard" component={VolunteerDashboardScreen} options={{ title: 'Volunteer Dashboard' }} />
      <Tab.Screen name="Projects" component={VolunteerProjectsScreen} options={{ title: 'Projects' }} />
      <Tab.Screen name="ProjectDetails" component={VolunteerProjectDetailsScreen} options={{ title: 'Project Details', tabBarButton: () => null }} />
      <Tab.Screen name="Tasks" component={VolunteerTasksScreen} options={{ title: 'My Tasks' }} />
      <Tab.Screen name="Map" component={MappingScreen} options={{ title: 'Impact Map' }} />
      <Tab.Screen name="Messages" component={CommunicationHubScreen} options={{ title: 'Messages', tabBarBadge: messageUnreadCount > 0 ? messageUnreadCount : undefined }} />
      <Tab.Screen name="Reports" component={VolunteerReportsScreen} options={{ title: 'My Reports' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'My Profile' }} />
    </Tab.Navigator>
  );
}
