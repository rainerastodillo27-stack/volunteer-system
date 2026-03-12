import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import DashboardScreen from '../screens/DashboardScreen';
import PartnerDashboardScreen from '../screens/PartnerDashboardScreen';
import ProjectsScreen from '../screens/ProjectsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import PartnerOnboardingScreen from '../screens/PartnerOnboardingScreen';
import ProjectLifecycleScreen from '../screens/ProjectLifecycleScreen';
import MappingScreen from '../screens/MappingScreen';
import ImpactReportsScreen from '../screens/ImpactReportsScreen';
import CommunicationHubScreen from '../screens/CommunicationHubScreen';
import VolunteerManagementScreen from '../screens/VolunteerManagementScreen';

export type TabParamList = {
  Dashboard: undefined;
  Partners: undefined;
  Projects: undefined;
  Lifecycle: undefined;
  Map: undefined;
  Impact: undefined;
  Messages: undefined;
  Volunteers: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function TabNavigator() {
  const { user, isAdmin } = useAuth();
  const showPartnersTab = isAdmin || user?.role === 'partner';
  const showLifecycleTab = isAdmin;
  const showImpactTab = isAdmin;
  const dashboardTitle =
    user?.role === 'partner'
      ? 'Partner Dashboard'
      : user?.role === 'volunteer'
      ? 'Volunteer Dashboard'
      : 'Admin Dashboard';
  const dashboardComponent = user?.role === 'partner' ? PartnerDashboardScreen : DashboardScreen;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;

          switch (route.name) {
            case 'Dashboard':
              iconName = 'dashboard';
              break;
            case 'Partners':
              iconName = 'business';
              break;
            case 'Projects':
              iconName = 'folder';
              break;
            case 'Lifecycle':
              iconName = 'timeline';
              break;
            case 'Map':
              iconName = 'map';
              break;
            case 'Impact':
              iconName = 'assessment';
              break;
            case 'Messages':
              iconName = 'mail';
              break;
            case 'Volunteers':
              iconName = 'group';
              break;
            case 'Profile':
              iconName = 'person';
              break;
            default:
              iconName = 'help-outline';
          }

          return <MaterialIcons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#eee',
          paddingBottom: 4,
        },
        tabBarPosition: 'bottom',
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={dashboardComponent}
        options={{ title: dashboardTitle, tabBarLabel: dashboardTitle }}
      />

      {showPartnersTab && (
        <Tab.Screen
          name="Partners"
          component={PartnerOnboardingScreen}
          options={{ title: 'Partners' }}
        />
      )}

      <Tab.Screen
        name="Projects"
        component={ProjectsScreen}
        options={{ title: 'Projects' }}
      />

      {showLifecycleTab && (
        <Tab.Screen
          name="Lifecycle"
          component={ProjectLifecycleScreen}
          options={{ title: 'Lifecycle' }}
        />
      )}

      <Tab.Screen
        name="Map"
        component={MappingScreen}
        options={{ title: 'Map' }}
      />

      {showImpactTab && (
        <Tab.Screen
          name="Impact"
          component={ImpactReportsScreen}
          options={{ title: 'Impact' }}
        />
      )}

      <Tab.Screen
        name="Messages"
        component={CommunicationHubScreen}
        options={{ title: 'Messages' }}
      />

      {isAdmin && (
        <Tab.Screen
          name="Volunteers"
          component={VolunteerManagementScreen}
          options={{ title: 'Volunteers' }}
        />
      )}

      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile' }}
      />
    </Tab.Navigator>
  );
}
