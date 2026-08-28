import React, { useCallback, useEffect, useState } from 'react';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, TouchableOpacity, View, Text } from 'react-native';

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
  savePartnerReport,
} from '../models/storage';
import { User, PartnerProjectApplication } from '../models/types';
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
const SystemSettingsScreen = lazyScreen(() => require('../screens/SystemSettingsScreen'));

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
  Settings: undefined;
};

const Tab = createBottomTabNavigator<AdminTabParamList>();

const SIDEBAR_WIDTH = 246;
const SIDEBAR_WIDTH_COLLAPSED = 60;
const CONTENT_GUTTER = 22;
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
    case 'Settings': return 'settings';
    default: return 'help-outline';
  }
};

type SidebarProps = BottomTabBarProps & {
  collapsed: boolean;
  onToggle: () => void;
  onNavigateWithBadge: (route: keyof AdminTabParamList) => void;
};

type AdminSearchItem = {
  id: string;
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  route: keyof AdminTabParamList;
  params?: any;
};

type AdminNotificationItem = {
  id: string;
  title: string;
  subtitle: string;
  timestamp?: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  route: keyof AdminTabParamList;
  params?: any;
};

const SIDEBAR_GROUPS = [
  {
    title: 'PROJECTS',
    items: [
      { label: 'Dashboard', icon: 'dashboard', route: 'Dashboard', params: undefined },
      { label: 'Programs', icon: 'work', route: 'Projects', params: { programSuiteView: 'programs', programSuiteNavKey: 1 } },
      { label: 'All Projects', icon: 'folder', route: 'Projects', params: { programSuiteView: 'projects', programSuiteNavKey: 2 } },
      { label: 'Calendar', icon: 'event', route: 'Projects', params: { programSuiteView: 'events', programSuiteNavKey: 3 } },
    ]
  },
  {
    title: 'COMMUNITY',
    items: [
      { label: 'Volunteers', icon: 'groups', route: 'Volunteers', params: undefined },
      { label: 'Partners', icon: 'business', route: 'Partners', params: undefined },
      { label: 'Impact Map', icon: 'map', route: 'Map', params: undefined },
    ]
  },
  {
    title: 'COMMUNICATION',
    items: [
      { label: 'Messages', icon: 'chat-bubble-outline', route: 'Messages', params: undefined },
    ]
  },
  {
    title: 'REPORTS',
    items: [
      { label: 'Analytics', icon: 'analytics', route: 'Analytics', params: undefined },
      { label: 'Reports', icon: 'insert-chart', route: 'Reports', params: undefined },
    ]
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { label: 'User Management', icon: 'manage-accounts', route: 'Users', params: undefined },
      { label: 'Profile', icon: 'person', route: 'Profile', params: undefined },
      { label: 'Settings', icon: 'settings', route: 'Settings', params: undefined },
    ]
  }
] as const;

function SidebarTabBar({ state, descriptors, navigation, collapsed, onToggle, onNavigateWithBadge }: SidebarProps) {
  const renderSidebarItem = (item: typeof SIDEBAR_GROUPS[number]['items'][number]) => {
    const activeRouteName = state.routes[state.index].name;
    let focused = activeRouteName === item.route;
    
    // Custom check for programSuiteView params on Projects screen
    if (item.route === 'Projects') {
      const activeView = (state.routes[state.index].params as any)?.programSuiteView || 'projects';
      focused = focused && (item.params?.programSuiteView === activeView);
    }
    
    const routeObj = state.routes.find(r => r.name === item.route);
    const badgeValue = routeObj ? (descriptors[routeObj.key]?.options?.tabBarBadge as number || 0) : 0;

    return (
      <TouchableOpacity
        key={item.label}
        onPress={() => {
          onNavigateWithBadge(item.route as keyof AdminTabParamList);
          navigation.navigate(item.route, {
            ...(item.params || {}),
            navTimestamp: Date.now(),
          });
        }}
        style={[styles.sidebarItem, focused && styles.sidebarItemActive, collapsed && styles.sidebarItemCollapsed]}
      >
        <View style={styles.sidebarIconWrap}>
          <MaterialIcons
            name={item.icon}
            size={20}
            color={focused ? '#16a34a' : '#64748b'}
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
            <Text style={[styles.sidebarLabel, focused && styles.sidebarLabelActive]} numberOfLines={1}>
              {item.label}
            </Text>
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
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        onPress={onToggle}
        style={[styles.toggleButton, collapsed && styles.toggleButtonCollapsed]}
      >
        <MaterialIcons name={collapsed ? 'keyboard-arrow-right' : 'keyboard-arrow-left'} size={20} color="#166534" />
      </TouchableOpacity>
      <ScrollView style={styles.sidebarScrollArea} contentContainerStyle={styles.sidebarScrollContent} showsVerticalScrollIndicator={false}>
        {SIDEBAR_GROUPS.map(group => (
          <View key={group.title} style={styles.sidebarGroup}>
            {!collapsed && <Text style={styles.sidebarHeading}>{group.title}</Text>}
            {group.items.map(item => renderSidebarItem(item))}
          </View>
        ))}
      </ScrollView>

      {!collapsed && (
        <TouchableOpacity
          style={styles.sidebarHelpCard}
          activeOpacity={0.85}
          onPress={() => {
            navigation.navigate('Messages', {
              conversationUserId: 'admin-nvc',
              navTimestamp: Date.now(),
            });
          }}
        >
          <View style={styles.sidebarHelpIcon}>
            <MaterialIcons name="headset-mic" size={20} color="#16a34a" />
          </View>
          <View style={styles.sidebarHelpCopy}>
            <Text style={styles.sidebarHelpTitle}>Need help?</Text>
            <Text style={styles.sidebarHelpText}>Contact support</Text>
          </View>
          <MaterialIcons name="chevron-right" size={16} color="#64748b" />
        </TouchableOpacity>
      )}
    </View>
  );
}

function SidebarCapture({ onPropsChange, ...tabBarProps }: BottomTabBarProps & { onPropsChange: (props: BottomTabBarProps, signature: string) => void }) {
  const signature = [
    String(tabBarProps.state.index),
    ...tabBarProps.state.routes.map(route => {
      const options = tabBarProps.descriptors[route.key]?.options;
      return `${options?.title || route.name}:${String(options?.tabBarBadge || '')}:${JSON.stringify(route.params || {})}`;
    }),
  ].join('|');
  useEffect(() => { onPropsChange(tabBarProps, signature); }, [signature]);
  return null;
}

function getAdminInitials(name?: string): string {
  if (!name) return 'AA';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AdminNavigator() {
  const { user } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<any[]>([]);
  const [unreadReports, setUnreadReports] = useState<any[]>([]);
  const [pendingPartnerApplications, setPendingPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [pendingVolunteerRequests, setPendingVolunteerRequests] = useState<any[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [seenPendingUserIds, setSeenPendingUserIds] = useState<Set<string>>(() => new Set());
  const [seenReportIds, setSeenReportIds] = useState<Set<string>>(() => new Set());
  const [seenPartnerApplicationIds, setSeenPartnerApplicationIds] = useState<Set<string>>(() => new Set());
  const [seenVolunteerRequestIds, setSeenVolunteerRequestIds] = useState<Set<string>>(() => new Set());

  const messageUnreadCount = unreadMessages.length;
  const reportNotificationCount = unreadReports.length;
  const pendingUserApprovalCount = pendingUsers.length;
  const totalNotificationCount =
    pendingUserApprovalCount +
    messageUnreadCount +
    reportNotificationCount +
    pendingPartnerApplications.length +
    pendingVolunteerRequests.length;
  const [collapsed, setCollapsed] = useState(false);
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
        const unreadRpts = reports.filter(
          r => !r.viewedBy?.includes(user.id) && !seenReportIds.has(r.id)
        );
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
        setPendingUsers(pUsers.filter(pendingUser => !seenPendingUserIds.has(pendingUser.id)));

        // Pending partner applications
        const pendingApps = apps.filter(
          a => a.status === 'Pending' && !seenPartnerApplicationIds.has(a.id)
        );
        setPendingPartnerApplications(pendingApps);

        // Pending volunteer requests
        const pendingMatches = matches.filter(
          m => m.status === 'Requested' && !seenVolunteerRequestIds.has(m.id)
        );
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
  }, [
    seenPartnerApplicationIds,
    seenPendingUserIds,
    seenReportIds,
    seenVolunteerRequestIds,
    user?.id,
  ]);

  const handleNotificationsSeen = React.useCallback(async () => {
    if (!user?.id || unreadMessages.length === 0) return;
    await Promise.all(
      unreadMessages.map((msg) => markMessageAsRead(msg.id).catch(() => undefined))
    );
    setUnreadMessages([]);
  }, [unreadMessages, user?.id]);

  const markReportsSeen = React.useCallback(async () => {
    if (!user?.id || unreadReports.length === 0) return;
    const reportsToMark = unreadReports;
    setSeenReportIds(current => {
      const next = new Set(current);
      reportsToMark.forEach(report => next.add(report.id));
      return next;
    });
    setUnreadReports([]);
    await Promise.all(
      reportsToMark.map(report =>
        savePartnerReport({
          ...report,
          viewedBy: Array.from(new Set([...(report.viewedBy || []), user.id])),
        }).catch(() => undefined)
      )
    );
  }, [unreadReports, user?.id]);

  const markRouteNotificationsSeen = React.useCallback(
    (route: keyof AdminTabParamList) => {
      if (route === 'Messages') {
        void handleNotificationsSeen();
        return;
      }

      if (route === 'Reports') {
        void markReportsSeen();
        return;
      }

      if (route === 'Projects') {
        setSeenVolunteerRequestIds(current => {
          const next = new Set(current);
          pendingVolunteerRequests.forEach(request => next.add(request.id));
          return next;
        });
        setSeenPartnerApplicationIds(current => {
          const next = new Set(current);
          pendingPartnerApplications.forEach(application => next.add(application.id));
          return next;
        });
        setPendingVolunteerRequests([]);
        setPendingPartnerApplications([]);
        return;
      }

      if (route === 'Users') {
        setSeenPendingUserIds(current => {
          const next = new Set(current);
          pendingUsers.forEach(pendingUser => next.add(pendingUser.id));
          return next;
        });
        setPendingUsers([]);
      }
    },
    [
      handleNotificationsSeen,
      markReportsSeen,
      pendingPartnerApplications,
      pendingUsers,
      pendingVolunteerRequests,
    ]
  );

  const markAllNotificationsSeen = React.useCallback(() => {
    void handleNotificationsSeen();
    void markReportsSeen();
    markRouteNotificationsSeen('Projects');
    markRouteNotificationsSeen('Users');
  }, [handleNotificationsSeen, markReportsSeen, markRouteNotificationsSeen]);

  const navigateFromTopBar = React.useCallback(
    (route: keyof AdminTabParamList, params?: any) => {
      markRouteNotificationsSeen(route);
      setIsSearchOpen(false);
      setIsNotificationPanelOpen(false);
      setSearchQuery('');
      (tabBarProps?.navigation as any)?.navigate(route, params);
    },
    [markRouteNotificationsSeen, tabBarProps?.navigation]
  );

  const notificationItems = React.useMemo<AdminNotificationItem[]>(() => {
    const formatTimestamp = (value?: string) => {
      if (!value) return '';
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
    };

    return [
      ...pendingUsers.map((pendingUser): AdminNotificationItem => ({
        id: `user-${pendingUser.id}`,
        title: pendingUser.name || pendingUser.email || 'Pending account',
        subtitle: `${pendingUser.role || 'User'} account waiting for approval`,
        timestamp: formatTimestamp(pendingUser.createdAt),
        icon: 'person-add',
        route: 'Users',
      })),
      ...unreadMessages.map((message): AdminNotificationItem => ({
        id: `message-${message.id}`,
        title: message.senderName || message.senderId || 'New message',
        subtitle: message.content || 'Unread message',
        timestamp: formatTimestamp(message.timestamp),
        icon: 'mail',
        route: 'Messages',
        params: { conversationUserId: message.senderId || message.recipientId },
      })),
      ...unreadReports.map((report): AdminNotificationItem => ({
        id: `report-${report.id}`,
        title: report.title || report.projectTitle || 'New report',
        subtitle: report.submitterName || report.submittedBy || 'Report submitted',
        timestamp: formatTimestamp(report.createdAt),
        icon: 'insert-chart',
        route: 'Reports',
        params: { projectId: report.projectId },
      })),
      ...pendingPartnerApplications.map((application): AdminNotificationItem => ({
        id: `partner-application-${application.id}`,
        title:
          application.proposalDetails?.proposedTitle ||
          application.proposalDetails?.targetProjectTitle ||
          'Partner proposal',
        subtitle: `${application.partnerName || 'Partner'} is waiting for review`,
        timestamp: formatTimestamp(application.requestedAt),
        icon: 'business',
        route: 'Projects',
        params: { projectId: application.projectId },
      })),
      ...pendingVolunteerRequests.map((request): AdminNotificationItem => ({
        id: `volunteer-request-${request.id}`,
        title: request.projectTitle || 'Volunteer request',
        subtitle: `${request.volunteerName || request.volunteerId || 'Volunteer'} requested to join`,
        timestamp: formatTimestamp(request.requestedAt || request.matchedAt),
        icon: 'volunteer-activism',
        route: 'Projects',
        params: { projectId: request.projectId },
      })),
    ];
  }, [
    pendingPartnerApplications,
    pendingUsers,
    pendingVolunteerRequests,
    unreadMessages,
    unreadReports,
  ]);

  const searchItems = React.useMemo<AdminSearchItem[]>(() => {
    const routeItems = SIDEBAR_GROUPS.flatMap(group =>
      group.items.map(item => ({
        id: `route-${group.title}-${item.label}`,
        title: item.label,
        subtitle: group.title.toLowerCase(),
        icon: item.icon as keyof typeof MaterialIcons.glyphMap,
        route: item.route as keyof AdminTabParamList,
        params: item.params,
      }))
    );

    const liveItems: AdminSearchItem[] = [
      ...pendingUsers.map(pendingUser => ({
        id: `search-user-${pendingUser.id}`,
        title: pendingUser.name || pendingUser.email || 'Pending account',
        subtitle: 'Pending user approval',
        icon: 'person-add' as const,
        route: 'Users' as const,
      })),
      ...unreadReports.map(report => ({
        id: `search-report-${report.id}`,
        title: report.title || report.projectTitle || 'Report',
        subtitle: `Report from ${report.submitterName || report.submittedBy || 'user'}`,
        icon: 'insert-chart' as const,
        route: 'Reports' as const,
        params: { projectId: report.projectId },
      })),
      ...pendingPartnerApplications.map(application => ({
        id: `search-partner-app-${application.id}`,
        title:
          application.proposalDetails?.proposedTitle ||
          application.proposalDetails?.targetProjectTitle ||
          'Partner proposal',
        subtitle: `Pending proposal from ${application.partnerName || 'partner'}`,
        icon: 'business' as const,
        route: 'Projects' as const,
        params: { projectId: application.projectId },
      })),
      ...pendingVolunteerRequests.map(request => ({
        id: `search-volunteer-request-${request.id}`,
        title: request.projectTitle || 'Volunteer request',
        subtitle: `${request.volunteerName || request.volunteerId || 'Volunteer'} requested to join`,
        icon: 'volunteer-activism' as const,
        route: 'Projects' as const,
        params: { projectId: request.projectId },
      })),
    ];

    const query = searchQuery.trim().toLowerCase();
    const allItems = [...routeItems, ...liveItems];
    if (!query) {
      return allItems.slice(0, 12);
    }

    return allItems
      .filter(item =>
        `${item.title} ${item.subtitle}`.toLowerCase().includes(query)
      )
      .slice(0, 20);
  }, [pendingPartnerApplications, pendingUsers, pendingVolunteerRequests, searchQuery, unreadReports]);

  const navigator = (
    <Tab.Navigator
      tabBar={isWeb ? props => <SidebarCapture {...props} onPropsChange={(p, s) => { setTabBarProps(p); setTabBarSignature(s); }} /> : undefined}
      screenOptions={({ route }) => ({
        headerShown: !isWeb,
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
            onNotificationOpen={markAllNotificationsSeen}
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
          title: 'Projects',
          tabBarBadge:
            pendingVolunteerRequests.length + pendingPartnerApplications.length > 0
              ? pendingVolunteerRequests.length + pendingPartnerApplications.length
              : undefined,
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
      <Tab.Screen name="Settings" component={SystemSettingsScreen} options={{ title: 'System Settings' }} />
    </Tab.Navigator>
  );

  if (!isWeb) return navigator;

  return (
    <View style={styles.webFrame}>
      <View style={styles.adminTopBar}>
        <View style={styles.adminTopActions}>
          <TouchableOpacity
            style={styles.adminTopIconButton}
            activeOpacity={0.8}
            onPress={() => setIsSearchOpen(true)}
          >
            <MaterialIcons name="search" size={24} color="#475569" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.adminTopIconButton}
            activeOpacity={0.8}
            onPress={() => {
              setIsNotificationPanelOpen(true);
              markAllNotificationsSeen();
            }}
          >
            <MaterialIcons
              name={totalNotificationCount > 0 ? 'notifications-active' : 'notifications-none'}
              size={24}
              color="#475569"
            />
            {totalNotificationCount > 0 ? (
              <View style={styles.adminTopBadge}>
                <Text style={styles.adminTopBadgeText}>{totalNotificationCount > 9 ? '9+' : totalNotificationCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <View style={styles.adminTopDivider} />
          
          <View style={{ position: 'relative', zIndex: 1000 }}>
            <TouchableOpacity
              style={styles.adminUserTrigger}
              onPress={() => setIsUserMenuOpen(prev => !prev)}
              activeOpacity={0.8}
            >
              <View style={styles.adminTopAvatar}>
                <Text style={styles.adminTopAvatarText}>{getAdminInitials(user?.name)}</Text>
              </View>
              <View>
                <Text style={styles.adminTopUserName}>{user?.name || 'Admin Account'}</Text>
                <Text style={styles.adminTopUserOrg}>Negrense Volunteers for Change (NVC)</Text>
              </View>
              <MaterialIcons
                name={isUserMenuOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={22}
                color="#64748b"
              />
            </TouchableOpacity>

            {isUserMenuOpen ? (
              <>
                <TouchableOpacity
                  style={styles.dropdownBackdrop}
                  onPress={() => setIsUserMenuOpen(false)}
                  activeOpacity={1}
                />
                <View style={styles.userDropdownCard}>
                  <TouchableOpacity
                    style={styles.userDropdownItem}
                    onPress={() => {
                      setIsUserMenuOpen(false);
                      tabBarProps?.navigation?.navigate('Profile');
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="person" size={18} color="#15803d" />
                    <Text style={styles.userDropdownItemText}>Profile Tab</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.userDropdownItem}
                    onPress={() => {
                      setIsUserMenuOpen(false);
                      tabBarProps?.navigation?.navigate('Settings');
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="settings" size={18} color="#15803d" />
                    <Text style={styles.userDropdownItemText}>Settings Tab</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={isSearchOpen}
        onRequestClose={() => setIsSearchOpen(false)}
      >
        <Pressable style={styles.topOverlayBackdrop} onPress={() => setIsSearchOpen(false)}>
          <Pressable style={styles.topPanel} onPress={(event) => event.stopPropagation()}>
            <View style={styles.topPanelHeader}>
              <View style={styles.searchInputWrap}>
                <MaterialIcons name="search" size={20} color="#64748b" />
                <TextInput
                  autoFocus
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search pages, reports, requests..."
                  placeholderTextColor="#94a3b8"
                  style={styles.searchInput}
                />
              </View>
              <TouchableOpacity onPress={() => setIsSearchOpen(false)} hitSlop={8}>
                <MaterialIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.topPanelList} keyboardShouldPersistTaps="handled">
              {searchItems.length ? (
                searchItems.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.topPanelItem}
                    onPress={() => navigateFromTopBar(item.route, item.params)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.topPanelItemIcon}>
                      <MaterialIcons name={item.icon} size={18} color="#166534" />
                    </View>
                    <View style={styles.topPanelItemCopy}>
                      <Text style={styles.topPanelItemTitle}>{item.title}</Text>
                      <Text style={styles.topPanelItemSubtitle}>{item.subtitle}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color="#cbd5e1" />
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.topPanelEmpty}>
                  <MaterialIcons name="search-off" size={32} color="#94a3b8" />
                  <Text style={styles.topPanelEmptyText}>No results found</Text>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={isNotificationPanelOpen}
        onRequestClose={() => setIsNotificationPanelOpen(false)}
      >
        <Pressable style={styles.topOverlayBackdrop} onPress={() => setIsNotificationPanelOpen(false)}>
          <Pressable style={styles.topPanel} onPress={(event) => event.stopPropagation()}>
            <View style={styles.notificationPanelHeader}>
              <View>
                <Text style={styles.topPanelTitle}>Notifications</Text>
                <Text style={styles.topPanelSubtitle}>
                  {notificationItems.length
                    ? `${notificationItems.length} item${notificationItems.length === 1 ? '' : 's'} need attention`
                    : 'No pending notifications'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsNotificationPanelOpen(false)} hitSlop={8}>
                <MaterialIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.topPanelList}>
              {notificationItems.length ? (
                notificationItems.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.topPanelItem}
                    onPress={() => navigateFromTopBar(item.route, item.params)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.topPanelItemIcon}>
                      <MaterialIcons name={item.icon} size={18} color="#166534" />
                    </View>
                    <View style={styles.topPanelItemCopy}>
                      <Text style={styles.topPanelItemTitle}>{item.title}</Text>
                      <Text style={styles.topPanelItemSubtitle}>{item.subtitle}</Text>
                      {item.timestamp ? (
                        <Text style={styles.topPanelTimestamp}>{item.timestamp}</Text>
                      ) : null}
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color="#cbd5e1" />
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.topPanelEmpty}>
                  <MaterialIcons name="check-circle" size={36} color="#16a34a" />
                  <Text style={styles.topPanelEmptyText}>All caught up</Text>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.webLayout}>
        <View style={[styles.sidebarWrapper, collapsed ? styles.sidebarWrapperCollapsed : styles.sidebarWrapperExpanded]}>
          {tabBarProps ? (
            <SidebarTabBar
              {...tabBarProps}
              collapsed={collapsed}
              onToggle={() => setCollapsed(!collapsed)}
              onNavigateWithBadge={markRouteNotificationsSeen}
            />
          ) : (
            <View style={styles.fallbackSidebar} />
          )}
        </View>
        <View style={styles.webMainPane}>
          <View style={[styles.webContent, { paddingHorizontal: collapsed ? CONTENT_GUTTER_COLLAPSED : CONTENT_GUTTER }]}>
            {navigator}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webFrame: { flex: 1, backgroundColor: '#f6f8fa' },
  webMainPane: { flex: 1, backgroundColor: '#f6f8fa' },
  adminTopBar: {
    height: 102,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6ebef',
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 32,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
    zIndex: 1000,
  },
  adminTopBrandSlot: { width: SIDEBAR_WIDTH, height: 56, borderRightWidth: 1, borderRightColor: '#dfe5ea', alignItems: 'center', justifyContent: 'center' },
  adminTopActions: { marginLeft: 'auto' as any, flexDirection: 'row', alignItems: 'center', gap: 18, zIndex: 1000 },
  adminTopIconButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  adminTopBadge: { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#157a34', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  adminTopBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  adminTopDivider: { width: 1, height: 48, backgroundColor: '#e5eaf0' },
  adminTopAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#e7f3e3', alignItems: 'center', justifyContent: 'center' },
  adminTopAvatarText: { color: '#0b7a35', fontWeight: '900', fontSize: 14 },
  adminTopUserName: { fontSize: 14, fontWeight: '900', color: '#101828' },
  adminTopUserOrg: { marginTop: 3, fontSize: 11, color: '#667085' },
  topOverlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
    alignItems: 'flex-end',
    paddingTop: 86,
    paddingRight: 32,
  },
  topPanel: {
    width: 430,
    maxHeight: 520,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 24,
    overflow: 'hidden',
  },
  topPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  notificationPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  topPanelTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  topPanelSubtitle: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  searchInputWrap: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    outlineStyle: 'none' as any,
  },
  topPanelList: {
    maxHeight: 430,
  },
  topPanelItem: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  topPanelItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topPanelItemCopy: {
    flex: 1,
  },
  topPanelItemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  topPanelItemSubtitle: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  topPanelTimestamp: {
    marginTop: 4,
    fontSize: 11,
    color: '#94a3b8',
  },
  topPanelEmpty: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  topPanelEmptyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  adminUserTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    cursor: 'pointer' as any,
  },
  dropdownBackdrop: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
  },
  userDropdownCard: {
    position: 'absolute',
    top: 60,
    right: 0,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    minWidth: 170,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    zIndex: 9999,
  },
  userDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  userDropdownItemText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  webLayout: { flex: 1, flexDirection: 'row', backgroundColor: '#f6f8fa' },
  sidebarWrapper: { height: '100%', backgroundColor: '#ffffff', borderRightWidth: 1, borderRightColor: '#edf1f4', overflow: 'hidden' },
  sidebarWrapperExpanded: { width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH },
  sidebarWrapperCollapsed: { width: SIDEBAR_WIDTH_COLLAPSED, minWidth: SIDEBAR_WIDTH_COLLAPSED },
  webContent: { flex: 1, paddingVertical: 24, backgroundColor: '#f6f8fa', overflow: 'auto' as any },
  sidebarContainer: { position: 'relative', flex: 1, width: SIDEBAR_WIDTH, backgroundColor: '#ffffff', paddingTop: 16, borderRightWidth: 0, borderRightColor: '#ffffff' },
  sidebarHeader: { width: '100%', height: 60, alignItems: 'flex-start', paddingLeft: 18, justifyContent: 'center', marginBottom: 16 },
  sidebarHeaderCollapsed: { alignItems: 'center', paddingLeft: 0 },
  sidebarGroup: { marginBottom: 16 },
  sidebarHeading: { fontSize: 10, fontWeight: '800', color: '#64748b', letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase', paddingHorizontal: 18 },
  sidebarContainerCollapsed: { width: SIDEBAR_WIDTH_COLLAPSED, paddingHorizontal: 4 },
  sidebarScrollArea: { flex: 1 },
  sidebarScrollContent: { paddingBottom: 20 },
  fallbackSidebar: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 20 },
  toggleButton: { alignSelf: 'flex-end', width: 32, height: 32, marginRight: 12, marginBottom: 10, borderRadius: 10, backgroundColor: '#edf8ee', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d5edd9' },
  toggleButtonCollapsed: { alignSelf: 'center', marginRight: 0 },
  sidebarDivider: { height: 1, backgroundColor: '#bbf7d0', marginVertical: 14 },
  sidebarDividerCollapsed: { marginVertical: 10 },
  sidebarItem: { height: 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderRadius: 8, marginBottom: 4, marginHorizontal: 12 },
  sidebarItemCollapsed: { justifyContent: 'center', marginHorizontal: 4 },
  sidebarItemActive: { backgroundColor: '#f0fdf4' },
  sidebarIconWrap: { position: 'relative' },
  sidebarIcon: { marginRight: 12 },
  sidebarLabelRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sidebarLabel: { fontSize: 13, color: '#475569', flexShrink: 1, fontWeight: '600' },
  sidebarLabelActive: { color: '#16a34a', fontWeight: '700' },
  sidebarBadge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  sidebarBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  sidebarIconBadge: { position: 'absolute', top: -10, right: -12, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 999, backgroundColor: '#dc2626', borderWidth: 2, borderColor: '#d9f99d', alignItems: 'center', justifyContent: 'center' },
  sidebarIconBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 12 },
  sidebarSubmenu: { marginLeft: 28, marginBottom: 8, gap: 4 },
  sidebarSubmenuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.45)' },
  sidebarSubmenuText: { fontSize: 13, color: '#15803d', fontWeight: '700' },
  sidebarHelpCard: { marginHorizontal: 12, marginBottom: 24, padding: 12, borderRadius: 10, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', gap: 10 },
  sidebarHelpIcon: { width: 32, height: 32, borderRadius: 6, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center' },
  sidebarHelpCopy: { flex: 1 },
  sidebarHelpTitle: { fontSize: 12, fontWeight: '800', color: '#1e293b' },
  sidebarHelpText: { marginTop: 2, fontSize: 10, color: '#64748b' },
  sidebarCopyright: { marginHorizontal: 12, marginBottom: 28, fontSize: 12, color: '#75839a' },
});
