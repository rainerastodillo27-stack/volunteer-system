import React, { useState } from 'react';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { Platform, StyleSheet, TouchableOpacity, View, Text } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import AppLogo from '../components/AppLogo';
import ScreenBrandHeader from '../components/ScreenBrandHeader';
import DashboardScreen from '../screens/DashboardScreen';
import PartnerDashboardScreen from '../screens/PartnerDashboardScreen';
import ProjectsScreen from '../screens/ProjectsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SystemSettingsScreen from '../screens/SystemSettingsScreen';
import PartnerOnboardingScreen from '../screens/PartnerOnboardingScreen';
import ProjectLifecycleScreen from '../screens/ProjectLifecycleScreen';
import MappingScreen from '../screens/MappingScreen';
import CommunicationHubScreen from '../screens/CommunicationHubScreen';
import UserManagementScreen from '../screens/UserManagementScreen';

export type TabParamList = {
  Dashboard: undefined;
  Partners: undefined;
  Projects: undefined;
  Lifecycle: undefined;
  Map: undefined;
  Messages: undefined;
  Users: undefined;
  Settings: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const SIDEBAR_WIDTH = 200;
const SIDEBAR_WIDTH_COLLAPSED = 60;
const CONTENT_GUTTER = 32;
const CONTENT_GUTTER_COLLAPSED = 80;

const getIconName = (routeName: keyof TabParamList) => {
  switch (routeName) {
    case 'Dashboard':
      return 'dashboard';
    case 'Partners':
      return 'business';
    case 'Projects':
      return 'folder';
    case 'Lifecycle':
      return 'timeline';
    case 'Map':
      return 'map';
    case 'Messages':
      return 'mail';
    case 'Users':
      return 'manage-accounts';
    case 'Settings':
      return 'settings';
    case 'Profile':
      return 'person';
    default:
      return 'help-outline';
  }
};

type SidebarProps = BottomTabBarProps & {
  collapsed: boolean;
  onToggle: () => void;
};

function SidebarTabBar({ state, descriptors, navigation, collapsed, onToggle }: SidebarProps) {
  const systemsRoutes = state.routes.filter(
    route =>
      route.name !== 'Users' &&
      route.name !== 'Settings' &&
      route.name !== 'Profile'
  );
  const settingsRoutes = state.routes.filter(
    route =>
      route.name === 'Users' ||
      route.name === 'Settings' ||
      route.name === 'Profile'
  );

  const renderItem = (routeName: string) => {
    const route = state.routes.find(r => r.name === routeName);
    if (!route) return null;

    const focused = state.index === state.routes.indexOf(route);
    const { options } = descriptors[route.key];
    const rawLabel =
      options.tabBarLabel !== undefined
        ? options.tabBarLabel
        : options.title !== undefined
        ? options.title
        : route.name;

    const label =
      typeof rawLabel === 'function'
        ? rawLabel({
            focused,
            color: focused ? '#166534' : '#4d7c0f',
            position: 'beside-icon',
            children: '',
          })
        : rawLabel;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name);
      }
    };

    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        onPress={onPress}
        style={[
          styles.sidebarItem,
          focused && styles.sidebarItemActive,
          collapsed && styles.sidebarItemCollapsed,
        ]}
      >
        <MaterialIcons
          name={getIconName(route.name as keyof TabParamList)}
          size={20}
          color={focused ? '#166534' : '#65a30d'}
          style={styles.sidebarIcon}
        />
        {!collapsed && (
          <Text style={[styles.sidebarLabel, focused && styles.sidebarLabelActive]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.sidebarContainer, collapsed && styles.sidebarContainerCollapsed]}>
      {!collapsed && (
        <View style={styles.sidebarBrand}>
          <View style={styles.sidebarBrandIcon}>
            <AppLogo width={36} />
          </View>
          <View style={styles.sidebarBrandCopy}>
            <Text style={styles.sidebarBrandName}>Volcre</Text>
            <Text style={styles.sidebarBrandTag}>Volunteer coordination</Text>
          </View>
        </View>
      )}
      <TouchableOpacity style={styles.toggleButton} onPress={onToggle} accessibilityRole="button">
        <MaterialIcons
          name={collapsed ? 'chevron-right' : 'chevron-left'}
          size={22}
          color="#15803d"
        />
      </TouchableOpacity>
      {!collapsed && <Text style={styles.sidebarHeading}>Systems</Text>}
      {systemsRoutes.map(route => renderItem(route.name))}
      <View style={[styles.sidebarDivider, collapsed && styles.sidebarDividerCollapsed]} />
      {!collapsed && <Text style={styles.sidebarHeading}>System Settings</Text>}
      {settingsRoutes.map(route => renderItem(route.name))}
    </View>
  );
}

export default function TabNavigator() {
  const { user, isAdmin } = useAuth();
  const showPartnersTab = isAdmin || user?.role === 'partner'; // available to admins and partner org accounts
  const showLifecycleTab = isAdmin;
  const showUsersTab = isAdmin;
  const dashboardTitle =
    user?.role === 'partner'
      ? 'Partner Dashboard'
      : user?.role === 'volunteer'
      ? 'Volunteer Dashboard'
      : 'Admin Dashboard';
  const dashboardComponent = user?.role === 'partner' ? PartnerDashboardScreen : DashboardScreen;
  const isWeb = Platform.OS === 'web';
  const useSidebar = isWeb && isAdmin;
  const [collapsed, setCollapsed] = useState(true);
  const [tabBarProps, setTabBarProps] = useState<BottomTabBarProps | null>(null);
  const sidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH;
  const contentGutter = collapsed ? CONTENT_GUTTER_COLLAPSED : CONTENT_GUTTER;

  const navigator = (
    <Tab.Navigator
      tabBar={useSidebar ? props => {
        setTabBarProps(prev => (prev?.state === props.state ? prev : props));
        return null;
      } : undefined}
      screenOptions={({ route }) => ({
        headerShown: true,
        header: ({ options }) => {
          const resolvedTitle =
            typeof options.title === 'string' && options.title.trim().length > 0
              ? options.title
              : route.name;

          return <ScreenBrandHeader title={resolvedTitle} />;
        },
        tabBarIcon: ({ color, size }) => (
          <MaterialIcons name={getIconName(route.name as keyof TabParamList)} size={size} color={color} />
        ),
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: useSidebar
          ? { display: 'none' }
          : {
              backgroundColor: '#fff',
              borderTopColor: '#eee',
              paddingBottom: 4,
            },
        sceneContainerStyle: useSidebar
          ? {
              backgroundColor: '#f5f5f5',
              paddingHorizontal: 0,
            }
          : undefined,
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

      <Tab.Screen
        name="Messages"
        component={CommunicationHubScreen}
        options={{ title: 'Messages' }}
      />

      {showUsersTab && (
        <Tab.Screen
          name="Users"
          component={UserManagementScreen}
          options={{ title: 'User Management' }}
        />
      )}

      {isAdmin ? (
        <>
          <Tab.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ title: 'Admin Profile' }}
          />

        <Tab.Screen
          name="Settings"
          component={SystemSettingsScreen}
          options={{ title: 'System Settings' }}
        />
        </>
      ) : (
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ title: 'Profile' }}
        />
      )}
    </Tab.Navigator>
  );

  if (!useSidebar) {
    return navigator;
  }

  return (
    <View style={styles.webLayout}>
      <View
        style={[
          styles.sidebarWrapper,
          collapsed ? styles.sidebarWrapperCollapsed : styles.sidebarWrapperExpanded,
        ]}
      >
        {tabBarProps && (
          <SidebarTabBar
            {...tabBarProps}
            collapsed={collapsed}
            onToggle={() => setCollapsed(prev => !prev)}
          />
        )}
      </View>

      <View
        style={[
          styles.webContent,
          { paddingHorizontal: contentGutter },
        ]}
      >
        {navigator}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webLayout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
  },
  sidebarWrapper: {
    height: '100%',
    backgroundColor: '#f0fdf4',
    borderRightWidth: 1,
    borderRightColor: '#bbf7d0',
  },
  sidebarWrapperExpanded: {
    width: SIDEBAR_WIDTH,
  },
  sidebarWrapperCollapsed: {
    width: SIDEBAR_WIDTH_COLLAPSED,
  },
  webContent: {
    flex: 1,
    paddingVertical: 20,
    backgroundColor: '#f5f5f5',
  },
  sidebarContainer: {
    position: 'relative',
    flex: 1,
    width: SIDEBAR_WIDTH,
    backgroundColor: '#f0fdf4',
    paddingTop: 28,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: '#bbf7d0',
  },
  sidebarBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
    paddingHorizontal: 6,
  },
  sidebarBrandIcon: {
    width: 72,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarBrandCopy: {
    flex: 1,
  },
  sidebarBrandName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#166534',
  },
  sidebarBrandTag: {
    marginTop: 2,
    fontSize: 12,
    color: '#4d7c0f',
    fontWeight: '600',
  },
  sidebarContainerCollapsed: {
    width: SIDEBAR_WIDTH_COLLAPSED,
    paddingHorizontal: 8,
  },
  toggleButton: {
    alignSelf: 'flex-end',
    padding: 6,
    marginBottom: 12,
  },
  sidebarHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
    letterSpacing: 0.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  sidebarDivider: {
    height: 1,
    backgroundColor: '#bbf7d0',
    marginVertical: 14,
  },
  sidebarDividerCollapsed: {
    marginVertical: 10,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 6,
  },
  sidebarItemCollapsed: {
    justifyContent: 'center',
  },
  sidebarItemActive: {
    backgroundColor: '#d9f99d',
  },
  sidebarIcon: {
    marginRight: 12,
  },
  sidebarLabel: {
    fontSize: 14,
    color: '#4d7c0f',
    flexShrink: 1,
    marginRight: 6,
  },
  sidebarLabelActive: {
    color: '#166534',
    fontWeight: '600',
  },
});
