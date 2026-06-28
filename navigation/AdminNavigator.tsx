import React, { useCallback, useEffect, useState } from 'react';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, TouchableOpacity, View, Text } from 'react-native';

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  if (typeof window !== 'undefined') {
    return 'web';
  }
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
import {
  getAllPartnerReports,
  getMessagesForUser,
  getPendingUserApprovals,
  subscribeToMessages,
  subscribeToStorageChanges,
  getAllVolunteerProjectMatches,
  getAllVolunteers,
  getAllProjects,
  getAllUsers,
  getAllPartnerProjectApplications,
  markMessageAsRead,
} from '../models/storage';
import { User, PartnerProjectApplication } from '../models/types';


export type AdminTabParamList = {
  Dashboard: undefined;
  Analytics: undefined;
  Partners: { partnerId?: string } | undefined;
  Projects: {
    projectId?: string;
    programSuiteView?: 'programs' | 'projects' | 'events';
    programSuiteNavKey?: number;
  } | undefined;
  Volunteers: { volunteerId?: string } | undefined;
  Map: undefined;
  Messages: { projectId?: string } | undefined;
  Reports: { projectId?: string } | undefined;
  Users: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<AdminTabParamList>();

function lazyScreen<T extends object>(loader: () => { default: React.ComponentType<T> }) {
  return function LazyLoadedScreen(props: T) {
    const Component = loader().default;
    return <Component {...props} />;
  };
}

const DashboardScreen = lazyScreen(() => require('../screens/DashboardScreen'));
const AdminAnalyticsScreen = lazyScreen(() => require('../screens/AdminAnalyticsScreen'));
const AdminProjectsScreen = lazyScreen(() => require('../screens/AdminProjectsScreen'));
const MappingScreen = lazyScreen(() => require('../screens/MappingScreen'));
const CommunicationHubScreen = lazyScreen(() => require('../screens/CommunicationHubScreen'));
const UserManagementScreen = lazyScreen(() => require('../screens/UserManagementScreen'));
const VolunteerManagementScreen = lazyScreen(() => require('../screens/VolunteerManagementScreen'));
const PartnerManagementScreen = lazyScreen(() => require('../screens/PartnerManagementScreen'));
const AdminReportsScreen = lazyScreen(() => require('../screens/AdminReportsScreen'));
const ProfileScreen = lazyScreen(() => require('../screens/ProfileScreen'));

const SIDEBAR_WIDTH = 260;
const SIDEBAR_WIDTH_COLLAPSED = 60;
const CONTENT_GUTTER = 32;
const CONTENT_GUTTER_COLLAPSED = 80;

const getIconName = (routeName: keyof AdminTabParamList) => {
  switch (routeName) {
    case 'Dashboard': return 'dashboard';
    case 'Analytics': return 'analytics';
    case 'Partners': return 'business';
    case 'Projects': return 'business-center';
    case 'Volunteers': return 'groups';
    case 'Map': return 'map';
    case 'Messages': return 'mail';
    case 'Reports': return 'insert-chart';
    case 'Users': return 'manage-accounts';
    case 'Profile': return 'person';
    default: return 'help-outline';
  }
};

type SidebarProps = BottomTabBarProps & {
  collapsed: boolean;
  onToggle: () => void;
};

function SidebarTabBar({ state, descriptors, navigation, collapsed, onToggle }: SidebarProps) {
  const [programMenuOpen, setProgramMenuOpen] = useState(false);
  const [programBtnTop, setProgramBtnTop] = useState(0);
  const navigateToProgramSuiteView = React.useCallback(
    (view: 'programs' | 'projects' | 'events') => {
      navigation.navigate('Projects', {
        programSuiteView: view,
        programSuiteNavKey: Date.now(),
      });
      setProgramMenuOpen(false);
    },
    [navigation]
  );

  const systemsRoutes = state.routes.filter(
    route => !['Partners', 'Volunteers', 'Users', 'Profile'].includes(route.name)
  );
  const settingsRoutes = state.routes.filter(
    route => ['Partners', 'Volunteers', 'Users', 'Profile'].includes(route.name)
  );

  // Close menu when sidebar expands
  React.useEffect(() => {
    if (!collapsed) setProgramMenuOpen(false);
  }, [collapsed]);

  // Inject/remove a fixed-position DOM popup for the collapsed state on web
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const POPUP_ID = 'program-suite-popup';
    let existing = document.getElementById(POPUP_ID);

    if (!collapsed || !programMenuOpen) {
      if (existing) existing.remove();
      return;
    }

    if (!existing) {
      existing = document.createElement('div');
      existing.id = POPUP_ID;
      document.body.appendChild(existing);
    }

    const top = programBtnTop > 0 ? programBtnTop : 120;
    const left = SIDEBAR_WIDTH_COLLAPSED + 8;

    existing.innerHTML = '';
    existing.style.cssText = `
      position: fixed;
      top: ${top}px;
      left: ${left}px;
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #bbf7d0;
      padding: 8px 4px;
      min-width: 175px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      z-index: 99999;
      font-family: inherit;
    `;

    const label = document.createElement('div');
    label.textContent = 'Program Suite';
    label.style.cssText = 'font-size:11px;font-weight:700;color:#94a3b8;padding:0 10px 6px;text-transform:uppercase;letter-spacing:0.5px;';
    existing.appendChild(label);

    const items = [
      { icon: '💼', text: 'Programs', view: 'programs' },
      { icon: '📁', text: 'Projects', view: 'projects' },
      { icon: '📅', text: 'Events',   view: 'events'   },
    ] as const;

    items.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = `${item.icon}  ${item.text}`;
      btn.style.cssText = `
        display: flex;
        align-items: center;
        width: 100%;
        padding: 9px 12px;
        border: none;
        background: transparent;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 700;
        color: #15803d;
        cursor: pointer;
        text-align: left;
        gap: 8px;
      `;
      btn.onmouseenter = () => { btn.style.background = '#f0fdf4'; };
      btn.onmouseleave = () => { btn.style.background = 'transparent'; };
      btn.onclick = () => {
        navigateToProgramSuiteView(item.view);
      };
      existing!.appendChild(btn);
    });

    // Click outside to close
    const handleOutside = (e: MouseEvent) => {
      if (!existing!.contains(e.target as Node)) {
        setProgramMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      existing?.remove();
    };
  }, [collapsed, programMenuOpen, programBtnTop, navigation, navigateToProgramSuiteView]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (typeof document !== 'undefined') {
        document.getElementById('program-suite-popup')?.remove();
      }
    };
  }, []);

  const programBtnRef = React.useRef<React.ElementRef<typeof TouchableOpacity>>(null);

  const renderItem = (routeName: string) => {
    const route = state.routes.find(r => r.name === routeName);
    if (!route) return null;

    const focused = state.index === state.routes.indexOf(route);
    const { options } = descriptors[route.key];
    const rawLabel = options.tabBarLabel ?? options.title ?? route.name;
    const label = typeof rawLabel === 'function' ? rawLabel({ focused, color: focused ? '#166534' : '#4d7c0f', position: 'beside-icon', children: '' }) : rawLabel;
    const badgeValue = typeof options.tabBarBadge === 'number' ? options.tabBarBadge : 0;

    const isProgramRoute = route.name === 'Projects';

    return (
      <View key={route.key}>
        <TouchableOpacity
          ref={isProgramRoute ? programBtnRef : undefined}
          onPress={() => {
            if (isProgramRoute) {
              // Measure the button's position via DOM getBoundingClientRect
              if (typeof window !== 'undefined') {
                const domNode = (programBtnRef.current as any)?._nativeTag
                  ? undefined
                  : (programBtnRef.current as unknown as HTMLElement);
                if (domNode?.getBoundingClientRect) {
                  const rect = domNode.getBoundingClientRect();
                  setProgramBtnTop(rect.top);
                }
              }
              setProgramMenuOpen(current => !current);
              return;
            }
            navigation.navigate(route.name);
          }}
          style={[styles.sidebarItem, focused && styles.sidebarItemActive, collapsed && styles.sidebarItemCollapsed]}
        >
          <View style={styles.sidebarIconWrap}>
            <MaterialIcons
              name={getIconName(route.name as keyof AdminTabParamList)}
              size={20}
              color={focused ? '#166534' : '#65a30d'}
              style={collapsed ? undefined : styles.sidebarIcon}
            />
            {collapsed && badgeValue > 0 && (
              <View style={styles.sidebarIconBadge}>
                <Text style={styles.sidebarIconBadgeText}>{badgeValue > 99 ? '99+' : badgeValue}</Text>
              </View>
            )}
          </View>
          {!collapsed && (
            <View style={styles.sidebarLabelRow}>
              <Text style={[styles.sidebarLabel, focused && styles.sidebarLabelActive]} numberOfLines={1}>{label}</Text>
              {badgeValue > 0 && (
                <View style={styles.sidebarBadge}>
                  <Text style={styles.sidebarBadgeText}>{badgeValue > 99 ? '99+' : badgeValue}</Text>
                </View>
              )}
              {isProgramRoute && (
                <MaterialIcons
                  name={programMenuOpen ? 'expand-less' : 'expand-more'}
                  size={18}
                  color={focused ? '#166534' : '#65a30d'}
                />
              )}
            </View>
          )}
        </TouchableOpacity>
        {/* Inline submenu when sidebar is expanded */}
        {isProgramRoute && !collapsed && programMenuOpen && (
          <View style={styles.sidebarSubmenu}>
            <TouchableOpacity style={styles.sidebarSubmenuItem} onPress={() => navigateToProgramSuiteView('programs')}>
              <MaterialIcons name="work" size={16} color="#15803d" />
              <Text style={styles.sidebarSubmenuText}>Programs</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sidebarSubmenuItem} onPress={() => navigateToProgramSuiteView('projects')}>
              <MaterialIcons name="folder" size={16} color="#15803d" />
              <Text style={styles.sidebarSubmenuText}>Projects</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sidebarSubmenuItem} onPress={() => navigateToProgramSuiteView('events')}>
              <MaterialIcons name="event" size={16} color="#15803d" />
              <Text style={styles.sidebarSubmenuText}>Events</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.sidebarContainer, collapsed && styles.sidebarContainerCollapsed]}>
      {!collapsed && (
        <View style={styles.sidebarBrand}>
          <View style={styles.sidebarBrandIcon}><AppLogo width={36} /></View>
          <View style={styles.sidebarBrandCopy}>
            <Text style={styles.sidebarBrandName}>NVC</Text>
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
  const signature = [
    String(tabBarProps.state.index),
    ...tabBarProps.state.routes.map(route => {
      const options = tabBarProps.descriptors[route.key]?.options;
      return `${options?.title || route.name}:${String(options?.tabBarBadge || '')}`;
    }),
  ].join('|');
  useEffect(() => { onPropsChange(tabBarProps, signature); }, [signature]);
  return null;
}

export default function AdminNavigator() {
  const { user } = useAuth();
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<any[]>([]);
  const [unreadReports, setUnreadReports] = useState<any[]>([]);
  const [pendingPartnerApplications, setPendingPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [pendingVolunteerRequests, setPendingVolunteerRequests] = useState<any[]>([]);

  const messageUnreadCount = unreadMessages.length;
  const reportNotificationCount = unreadReports.length;
  const pendingUserApprovalCount = pendingUsers.length;
  const [collapsed, setCollapsed] = useState(true);
  const [tabBarProps, setTabBarProps] = useState<BottomTabBarProps | null>(null);
  const [tabBarSignature, setTabBarSignature] = useState('');
  const isMobileModeOnWeb = React.useMemo(() => {
    if (getPlatformOS() !== 'web') return false;
    try {
      if (typeof window !== 'undefined' && window?.location?.search) {
        return new URLSearchParams(window.location.search).get('mode') === 'mobile';
      }
    } catch {}
    return false;
  }, []);
  const isWeb = getPlatformOS() === 'web' && !isMobileModeOnWeb;

  useEffect(() => {
    if (!user?.id) return;

    const loadAllNotifications = async () => {
      try {
        const [
          allMsgs,
          reports,
          pUsers,
          apps,
          matches,
          volunteers,
          projects,
          usersList,
        ] = await Promise.all([
          getMessagesForUser(user.id).catch(() => []),
          getAllPartnerReports().catch(() => []),
          getPendingUserApprovals().catch(() => []),
          getAllPartnerProjectApplications().catch(() => []),
          getAllVolunteerProjectMatches().catch(() => []),
          getAllVolunteers().catch(() => []),
          getAllProjects().catch(() => []),
          getAllUsers().catch(() => []),
        ]);

        // Map unread messages and enrich with senderName
        const unreadMsgs = allMsgs.filter(m => !m.read && m.recipientId === user.id);
        const enrichedMsgs = unreadMsgs.map(msg => {
          const sender = usersList.find(u => u.id === msg.senderId);
          return {
            ...msg,
            senderName: sender ? sender.name : msg.senderId,
          };
        });
        setUnreadMessages(enrichedMsgs);

        // Map unread reports and enrich with submitterName, projectTitle
        const unreadRpts = reports.filter(r => !r.viewedBy?.includes(user.id));
        const enrichedReports = unreadRpts.map(r => {
          const project = projects.find(p => p.id === r.projectId);
          return {
            ...r,
            projectTitle: project ? project.title : 'NVC Project',
            title: r.title || `Report for ${project ? project.title : 'Project'}`,
          };
        });
        setUnreadReports(enrichedReports);

        // Pending user approvals
        setPendingUsers(pUsers);

        // Pending partner applications
        const pendingApps = apps.filter(a => a.status === 'Pending');
        setPendingPartnerApplications(pendingApps);

        // Pending volunteer requests
        const pendingMatches = matches.filter(m => m.status === 'Requested');
        const enrichedMatches = pendingMatches.map(match => {
          const volunteer = volunteers.find(v => v.id === match.volunteerId);
          const project = projects.find(p => p.id === match.projectId);
          return {
            ...match,
            volunteerName: volunteer ? volunteer.name : match.volunteerId,
            projectTitle: project ? project.title : 'NVC Project',
          };
        });
        setPendingVolunteerRequests(enrichedMatches);
      } catch (err) {
        console.error('Error loading admin notifications:', err);
      }
    };

    loadAllNotifications();

    const unsubMessages = subscribeToMessages(user.id, loadAllNotifications);
    const unsubStorage = subscribeToStorageChanges([
      'messages',
      'partnerReports',
      'users',
      'partnerProjectApplications',
      'volunteerMatches',
      'projects',
      'volunteers'
    ], loadAllNotifications);

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

  const navigator = (
    <Tab.Navigator
      tabBar={isWeb ? props => <SidebarCapture {...props} onPropsChange={(p, s) => { setTabBarProps(p); setTabBarSignature(s); }} /> : undefined}
      screenOptions={({ route }) => ({
        headerShown: true,
        header: ({ options, navigation }) => (
          <ScreenBrandHeader
            title={options.title || route.name}
            navigation={navigation}
            userId={user?.id}
            notificationCount={
              pendingUsers.length +
              unreadMessages.length +
              unreadReports.length +
              pendingPartnerApplications.length +
              pendingVolunteerRequests.length
            }
            pendingUsers={pendingUsers}
            unreadMessages={unreadMessages}
            unreadReports={unreadReports}
            pendingPartnerApplications={pendingPartnerApplications}
            pendingVolunteerRequests={pendingVolunteerRequests}
            onNotificationOpen={handleNotificationsSeen}
          />
        ),
        tabBarIcon: ({ color, size }) => <MaterialIcons name={getIconName(route.name as keyof AdminTabParamList)} size={size} color={color} />,
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: isWeb ? { display: 'none' } : { backgroundColor: '#fff', borderTopColor: '#eee', paddingBottom: 4 },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Admin Dashboard' }} />
      <Tab.Screen
        name="Projects"
        component={AdminProjectsScreen}
        options={{
          title: 'Program Management Suite',
          tabBarLabel: 'Program Suite',
          tabBarBadge: pendingVolunteerRequests.length > 0 ? pendingVolunteerRequests.length : undefined,
        }}
      />
      <Tab.Screen name="Partners" component={PartnerManagementScreen} options={{ title: 'Partner Management' }} />
      <Tab.Screen name="Volunteers" component={VolunteerManagementScreen} options={{ title: 'Volunteer Management' }} />
      <Tab.Screen name="Map" component={MappingScreen} options={{ title: 'Map' }} />
      <Tab.Screen name="Messages" component={CommunicationHubScreen} options={{ title: 'Messages', tabBarBadge: messageUnreadCount > 0 ? messageUnreadCount : undefined }} />
      <Tab.Screen name="Reports" component={AdminReportsScreen} options={{ title: 'Reports', tabBarBadge: reportNotificationCount > 0 ? reportNotificationCount : undefined }} />
      <Tab.Screen name="Analytics" component={AdminAnalyticsScreen} options={{ title: 'Analytics' }} />
      <Tab.Screen name="Users" component={UserManagementScreen} options={{ title: 'User Management', tabBarBadge: pendingUserApprovalCount > 0 ? pendingUserApprovalCount : undefined }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Admin Profile' }} />
    </Tab.Navigator>
  );

  if (!isWeb) return navigator;

  return (
    <View style={styles.webLayout}>
      <View style={[styles.sidebarWrapper, collapsed ? styles.sidebarWrapperCollapsed : styles.sidebarWrapperExpanded]}>
        {tabBarProps ? (
          <SidebarTabBar {...tabBarProps} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        ) : (
          <View style={styles.fallbackSidebar}>
            <TouchableOpacity onPress={() => setCollapsed(!collapsed)} style={styles.toggleButton}>
              <MaterialIcons
                name={collapsed ? 'chevron-right' : 'chevron-left'}
                size={24}
                color="#15803d"
              />
            </TouchableOpacity>
          </View>
        )}
      </View>
      <View style={[styles.webContent, { paddingHorizontal: collapsed ? CONTENT_GUTTER_COLLAPSED : CONTENT_GUTTER }]}>
        {navigator}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webLayout: { flex: 1, flexDirection: 'row', backgroundColor: '#f5f5f5' },
  sidebarWrapper: { height: '100%', backgroundColor: '#f0fdf4', borderRightWidth: 2, borderRightColor: '#15803d', overflow: 'hidden' },
  sidebarWrapperExpanded: { width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH },
  sidebarWrapperCollapsed: { width: SIDEBAR_WIDTH_COLLAPSED, minWidth: SIDEBAR_WIDTH_COLLAPSED },
  webContent: { flex: 1, paddingVertical: 20, backgroundColor: '#f5f5f5', overflow: 'auto' as any },
  sidebarContainer: { position: 'relative', flex: 1, width: SIDEBAR_WIDTH, backgroundColor: '#f0fdf4', paddingTop: 28, paddingHorizontal: 12, borderRightWidth: 1, borderRightColor: '#bbf7d0' },
  sidebarBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, paddingHorizontal: 6 },
  sidebarBrandIcon: { width: 72, height: 48, borderRadius: 14, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  sidebarBrandCopy: { flex: 1 },
  sidebarBrandName: { fontSize: 22, fontWeight: '800', color: '#166534' },
  sidebarBrandTag: { marginTop: 2, fontSize: 12, color: '#4d7c0f', fontWeight: '600' },
  sidebarContainerCollapsed: { width: SIDEBAR_WIDTH_COLLAPSED, paddingHorizontal: 8 },
  sidebarScrollArea: { flex: 1 },
  sidebarScrollContent: { paddingBottom: 20 },
  fallbackSidebar: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 20 },
  toggleButton: { alignSelf: 'center', padding: 10, marginBottom: 12, borderRadius: 8, backgroundColor: 'rgba(21, 128, 61, 0.1)' },
  sidebarHeading: { fontSize: 12, fontWeight: '700', color: '#15803d', letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase' },
  sidebarDivider: { height: 1, backgroundColor: '#bbf7d0', marginVertical: 14 },
  sidebarDividerCollapsed: { marginVertical: 10 },
  sidebarItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10, marginBottom: 6 },
  sidebarItemCollapsed: { justifyContent: 'center' },
  sidebarItemActive: { backgroundColor: '#d9f99d' },
  sidebarIconWrap: { position: 'relative' },
  sidebarIcon: { marginRight: 12 },
  sidebarLabelRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sidebarLabel: { fontSize: 14, color: '#4d7c0f', flexShrink: 1, marginRight: 6 },
  sidebarLabelActive: { color: '#166534', fontWeight: '600' },
  sidebarBadge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  sidebarBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  sidebarIconBadge: { position: 'absolute', top: -10, right: -12, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 999, backgroundColor: '#dc2626', borderWidth: 2, borderColor: '#d9f99d', alignItems: 'center', justifyContent: 'center' },
  sidebarIconBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 12 },
  sidebarSubmenu: { marginLeft: 28, marginBottom: 8, gap: 4 },
  sidebarSubmenuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.45)' },
  sidebarSubmenuText: { fontSize: 13, color: '#15803d', fontWeight: '700' },
});
