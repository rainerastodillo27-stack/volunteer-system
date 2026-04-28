import React, { useCallback, useEffect, useState } from 'react';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, TouchableOpacity, View, Text } from 'react-native';

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}
import { useAuth } from '../contexts/AuthContext';
import AppLogo from '../components/AppLogo';
import ScreenBrandHeader from '../components/ScreenBrandHeader';
import DashboardScreen from '../screens/DashboardScreen';
import AdminProjectsScreen from '../screens/AdminProjectsScreen';
import MappingScreen from '../screens/MappingScreen';
import CommunicationHubScreen from '../screens/CommunicationHubScreen';
import UserManagementScreen from '../screens/UserManagementScreen';
import VolunteerManagementScreen from '../screens/VolunteerManagementScreen';
import PartnerManagementScreen from '../screens/PartnerManagementScreen';
import AdminReportsScreen from '../screens/AdminReportsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SystemSettingsScreen from '../screens/SystemSettingsScreen';
import { getAllPartnerReports, getMessagesForUser, subscribeToMessages, subscribeToStorageChanges } from '../models/storage';

export type AdminTabParamList = {
  Dashboard: undefined;
  Partners: { partnerId?: string } | undefined;
  Projects: { projectId?: string } | undefined;
  Volunteers: { volunteerId?: string } | undefined;
  Map: undefined;
  Messages: { projectId?: string } | undefined;
  Reports: { projectId?: string } | undefined;
  Users: undefined;
  Settings: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<AdminTabParamList>();

const SIDEBAR_WIDTH = 200;
const SIDEBAR_WIDTH_COLLAPSED = 60;
const CONTENT_GUTTER = 32;
const CONTENT_GUTTER_COLLAPSED = 80;

const getIconName = (routeName: keyof AdminTabParamList) => {
  switch (routeName) {
    case 'Dashboard': return 'dashboard';
    case 'Partners': return 'business';
    case 'Projects': return 'business-center';
    case 'Volunteers': return 'groups';
    case 'Map': return 'map';
    case 'Messages': return 'mail';
    case 'Reports': return 'insert-chart';
    case 'Users': return 'manage-accounts';
    case 'Settings': return 'settings';
    case 'Profile': return 'person';
    default: return 'help-outline';
  }
};

type SidebarProps = BottomTabBarProps & {
  collapsed: boolean;
  onToggle: () => void;
};

function SidebarTabBar({ state, descriptors, navigation, collapsed, onToggle }: SidebarProps) {
  const systemsRoutes = state.routes.filter(
    route => !['Partners', 'Volunteers', 'Users', 'Settings', 'Profile'].includes(route.name)
  );
  const settingsRoutes = state.routes.filter(
    route => ['Partners', 'Volunteers', 'Users', 'Settings', 'Profile'].includes(route.name)
  );

  const renderItem = (routeName: string) => {
    const route = state.routes.find(r => r.name === routeName);
    if (!route) return null;

    const focused = state.index === state.routes.indexOf(route);
    const { options } = descriptors[route.key];
    const rawLabel = options.tabBarLabel ?? options.title ?? route.name;
    const label = typeof rawLabel === 'function' ? rawLabel({ focused, color: focused ? '#166534' : '#4d7c0f', position: 'beside-icon', children: '' }) : rawLabel;
    const badgeValue = typeof options.tabBarBadge === 'number' ? options.tabBarBadge : 0;

    return (
      <TouchableOpacity
        key={route.key}
        onPress={() => navigation.navigate(route.name)}
        style={[styles.sidebarItem, focused && styles.sidebarItemActive, collapsed && styles.sidebarItemCollapsed]}
      >
        <MaterialIcons name={getIconName(route.name as keyof AdminTabParamList)} size={20} color={focused ? '#166534' : '#65a30d'} style={styles.sidebarIcon} />
        {!collapsed && (
          <View style={styles.sidebarLabelRow}>
            <Text style={[styles.sidebarLabel, focused && styles.sidebarLabelActive]} numberOfLines={1}>{label}</Text>
            {badgeValue > 0 && (
              <View style={styles.sidebarBadge}>
                <Text style={styles.sidebarBadgeText}>{badgeValue > 99 ? '99+' : badgeValue}</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.sidebarContainer, collapsed && styles.sidebarContainerCollapsed]}>
      {!collapsed && (
        <View style={styles.sidebarBrand}>
          <View style={styles.sidebarBrandIcon}><AppLogo width={36} /></View>
          <View style={styles.sidebarBrandCopy}>
            <Text style={styles.sidebarBrandName}>NVC CONNECT</Text>
            <Text style={styles.sidebarBrandTag}>Admin Suite</Text>
          </View>
        </View>
      )}
      <TouchableOpacity style={styles.toggleButton} onPress={onToggle}>
        <MaterialIcons name={collapsed ? 'chevron-right' : 'chevron-left'} size={22} color="#15803d" />
      </TouchableOpacity>
      <ScrollView style={styles.sidebarScrollArea} contentContainerStyle={styles.sidebarScrollContent}>
        {!collapsed && <Text style={styles.sidebarHeading}>Systems</Text>}
        {systemsRoutes.map(route => renderItem(route.name))}
        <View style={[styles.sidebarDivider, collapsed && styles.sidebarDividerCollapsed]} />
        {!collapsed && <Text style={styles.sidebarHeading}>System Settings</Text>}
        {settingsRoutes.map(route => renderItem(route.name))}
      </ScrollView>
    </View>
  );
}

function SidebarCapture({ onPropsChange, ...tabBarProps }: BottomTabBarProps & { onPropsChange: (props: BottomTabBarProps, signature: string) => void }) {
  const signature = [String(tabBarProps.state.index), ...tabBarProps.state.routes.map(r => tabBarProps.descriptors[r.key]?.options.title || r.name)].join('|');
  useEffect(() => { onPropsChange(tabBarProps, signature); }, [signature]);
  return null;
}

export default function AdminNavigator() {
  const { user } = useAuth();
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [reportNotificationCount, setReportNotificationCount] = useState(0);
  const [collapsed, setCollapsed] = useState(true);
  const [tabBarProps, setTabBarProps] = useState<BottomTabBarProps | null>(null);
  const [tabBarSignature, setTabBarSignature] = useState('');
  const isWeb = getPlatformOS() === 'web';

  useEffect(() => {
    if (!user?.id) return;
    const loadCounts = async () => {
        try {
            const messages = await getMessagesForUser(user.id);
            setMessageUnreadCount(messages.filter(m => !m.read && m.receiverUserId === user.id).length);
        } catch {}
    };

    const loadReportNotificationCount = async () => {
      try {
        const reports = await getAllPartnerReports();
        const unreadCount = reports.filter(r => !r.viewedBy?.includes(user.id)).length;
        setReportNotificationCount(unreadCount);
      } catch {}
    };

    loadCounts();
    loadReportNotificationCount();

    const unsubMessages = subscribeToMessages(user.id, loadCounts);
    const unsubStorage = subscribeToStorageChanges(['partnerReports'], () => {
        loadCounts();
        loadReportNotificationCount();
    });
    return () => { unsubMessages(); unsubStorage?.(); };
  }, [user?.id]);

  const navigator = (
    <Tab.Navigator
      tabBar={isWeb ? props => <SidebarCapture {...props} onPropsChange={(p, s) => { setTabBarProps(p); setTabBarSignature(s); }} /> : undefined}
      screenOptions={({ route }) => ({
        headerShown: true,
        header: ({ options }) => <ScreenBrandHeader title={options.title || route.name} />,
        tabBarIcon: ({ color, size }) => <MaterialIcons name={getIconName(route.name as keyof AdminTabParamList)} size={size} color={color} />,
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: isWeb ? { display: 'none' } : { backgroundColor: '#fff', borderTopColor: '#eee', paddingBottom: 4 },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Admin Dashboard' }} />
      <Tab.Screen name="Projects" component={AdminProjectsScreen} options={{ title: 'Program Management Suite' }} />
      <Tab.Screen name="Partners" component={PartnerManagementScreen} options={{ title: 'Partner Management' }} />
      <Tab.Screen name="Volunteers" component={VolunteerManagementScreen} options={{ title: 'Volunteer Management' }} />
      <Tab.Screen name="Map" component={MappingScreen} options={{ title: 'Map' }} />
      <Tab.Screen name="Messages" component={CommunicationHubScreen} options={{ title: 'Messages', tabBarBadge: messageUnreadCount > 0 ? messageUnreadCount : undefined }} />
      <Tab.Screen name="Reports" component={AdminReportsScreen} options={{ title: 'Reports', tabBarBadge: reportNotificationCount > 0 ? reportNotificationCount : undefined }} />
      <Tab.Screen name="Users" component={UserManagementScreen} options={{ title: 'User Management' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Admin Profile' }} />
      <Tab.Screen name="Settings" component={SystemSettingsScreen} options={{ title: 'System Settings' }} />
    </Tab.Navigator>
  );

  if (!isWeb) return navigator;

  return (
    <View style={styles.webLayout}>
      <View style={[styles.sidebarWrapper, collapsed ? styles.sidebarWrapperCollapsed : styles.sidebarWrapperExpanded]}>
        {tabBarProps && <SidebarTabBar {...tabBarProps} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />}
      </View>
      <View style={[styles.webContent, { paddingHorizontal: collapsed ? CONTENT_GUTTER_COLLAPSED : CONTENT_GUTTER }]}>
        {navigator}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webLayout: { flex: 1, flexDirection: 'row', backgroundColor: '#f5f5f5' },
  sidebarWrapper: { height: '100%', backgroundColor: '#f0fdf4', borderRightWidth: 1, borderRightColor: '#bbf7d0' },
  sidebarWrapperExpanded: { width: SIDEBAR_WIDTH },
  sidebarWrapperCollapsed: { width: SIDEBAR_WIDTH_COLLAPSED },
  webContent: { flex: 1, paddingVertical: 20, backgroundColor: '#f5f5f5' },
  sidebarContainer: { position: 'relative', flex: 1, width: SIDEBAR_WIDTH, backgroundColor: '#f0fdf4', paddingTop: 28, paddingHorizontal: 12, borderRightWidth: 1, borderRightColor: '#bbf7d0' },
  sidebarBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, paddingHorizontal: 6 },
  sidebarBrandIcon: { width: 72, height: 48, borderRadius: 14, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  sidebarBrandCopy: { flex: 1 },
  sidebarBrandName: { fontSize: 22, fontWeight: '800', color: '#166534' },
  sidebarBrandTag: { marginTop: 2, fontSize: 12, color: '#4d7c0f', fontWeight: '600' },
  sidebarContainerCollapsed: { width: SIDEBAR_WIDTH_COLLAPSED, paddingHorizontal: 8 },
  sidebarScrollArea: { flex: 1 },
  sidebarScrollContent: { paddingBottom: 20 },
  toggleButton: { alignSelf: 'flex-end', padding: 6, marginBottom: 12 },
  sidebarHeading: { fontSize: 12, fontWeight: '700', color: '#15803d', letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase' },
  sidebarDivider: { height: 1, backgroundColor: '#bbf7d0', marginVertical: 14 },
  sidebarDividerCollapsed: { marginVertical: 10 },
  sidebarItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10, marginBottom: 6 },
  sidebarItemCollapsed: { justifyContent: 'center' },
  sidebarItemActive: { backgroundColor: '#d9f99d' },
  sidebarIcon: { marginRight: 12 },
  sidebarLabelRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sidebarLabel: { fontSize: 14, color: '#4d7c0f', flexShrink: 1, marginRight: 6 },
  sidebarLabelActive: { color: '#166534', fontWeight: '600' },
  sidebarBadge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  sidebarBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
