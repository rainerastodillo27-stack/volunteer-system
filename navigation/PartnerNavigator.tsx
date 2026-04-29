import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import ScreenBrandHeader from '../components/ScreenBrandHeader';
import PartnerDashboardScreen from '../screens/PartnerDashboardScreen';
import PartnerProgramManagementScreen from '../screens/PartnerProgramManagementScreen';
import MappingScreen from '../screens/MappingScreen';
import CommunicationHubScreen from '../screens/CommunicationHubScreen';
import PartnerReportsScreen from '../screens/PartnerReportsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { getMessagesForUser, subscribeToMessages } from '../models/storage';

export type PartnerTabParamList = {
  Dashboard: undefined;
  Programs: { programModule?: string; projectId?: string } | undefined;
  Map: undefined;
  Messages: { projectId?: string } | undefined;
  Reports: { projectId?: string } | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<PartnerTabParamList>();

const getIconName = (routeName: keyof PartnerTabParamList) => {
  switch (routeName) {
    case 'Dashboard': return 'dashboard';
    case 'Programs': return 'business-center';
    case 'Map': return 'map';
    case 'Messages': return 'mail';
    case 'Reports': return 'insert-chart';
    case 'Profile': return 'person';
    default: return 'help-outline';
  }
};

export default function PartnerNavigator() {
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
        tabBarIcon: ({ color, size }) => <MaterialIcons name={getIconName(route.name as keyof PartnerTabParamList)} size={size} color={color} />,
        tabBarActiveTintColor: '#166534',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#eee', paddingBottom: 4 },
      })}
    >
      <Tab.Screen name="Dashboard" component={PartnerDashboardScreen} options={{ title: 'Partner Dashboard' }} />
      <Tab.Screen name="Programs" component={PartnerProgramManagementScreen} options={{ title: 'Program Management' }} />
      <Tab.Screen name="Map" component={MappingScreen} options={{ title: 'Impact Map' }} />
      <Tab.Screen name="Messages" component={CommunicationHubScreen} options={{ title: 'Messages', tabBarBadge: messageUnreadCount > 0 ? messageUnreadCount : undefined }} />
      <Tab.Screen name="Reports" component={PartnerReportsScreen} options={{ title: 'Reports' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Partner Profile' }} />
    </Tab.Navigator>
  );
}
