import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenBrandHeader from '../components/ScreenBrandHeader';

export type PartnerTabParamList = {
  Dashboard: { openProposalModule?: string } | undefined;
  Programs: { programModule?: string; projectId?: string } | undefined;
  Projects: { projectId?: string } | undefined;
  Map: undefined;
  Messages: { projectId?: string } | undefined;
  Reports: { projectId?: string } | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<PartnerTabParamList>();

function lazyScreen<T extends object>(loader: () => { default: React.ComponentType<T> }) {
  return function LazyLoadedScreen(props: T) {
    const Component = loader().default;
    return <Component {...props} />;
  };
}

const PartnerDashboardScreen = lazyScreen(() => require('../screens/PartnerDashboardScreen'));
const PartnerProgramManagementScreen = lazyScreen(() => require('../screens/PartnerProgramManagementScreen'));
const PartnerProjectsScreen = lazyScreen(() => require('../screens/PartnerProjectsScreen'));
const MappingScreen = lazyScreen(() => require('../screens/MappingScreen'));
const CommunicationHubScreen = lazyScreen(() => require('../screens/CommunicationHubScreen'));
const PartnerReportsScreen = lazyScreen(() => require('../screens/PartnerReportsScreen'));
const ProfileScreen = lazyScreen(() => require('../screens/ProfileScreen'));

const getIconName = (routeName: keyof PartnerTabParamList) => {
  switch (routeName) {
    case 'Dashboard': return 'dashboard';
    case 'Programs': return 'business-center';
    case 'Projects': return 'assignment';
    case 'Map': return 'map';
    case 'Messages': return 'mail';
    case 'Reports': return 'insert-chart';
    case 'Profile': return 'person';
    default: return 'help-outline';
  }
};

export default function PartnerNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        header: ({ options }) => <ScreenBrandHeader title={options.title || route.name} />,
        tabBarIcon: ({ color, size }) => <MaterialIcons name={getIconName(route.name as keyof PartnerTabParamList)} size={size} color={color} />,
        tabBarActiveTintColor: '#166534',
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
      <Tab.Screen name="Dashboard" component={PartnerDashboardScreen} options={{ title: 'Partner Dashboard' }} />
      <Tab.Screen name="Programs" component={PartnerProgramManagementScreen} options={{ title: 'Program Management' }} />
      <Tab.Screen name="Projects" component={PartnerProjectsScreen} options={{ title: 'My Projects', tabBarLabel: 'Projects' }} />
      <Tab.Screen name="Map" component={MappingScreen} options={{ title: 'Impact Map' }} />
      <Tab.Screen name="Messages" component={CommunicationHubScreen} options={{ title: 'Messages' }} />
      <Tab.Screen name="Reports" component={PartnerReportsScreen} options={{ title: 'Reports' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Partner Profile' }} />
    </Tab.Navigator>
  );
}
