import React, { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, Modal, TouchableOpacity, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { PartnerProjectApplication, User, VolunteerProjectMatch } from '../models/types';

type NotificationMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: string;
  read: boolean;
  senderName?: string;
  attachments?: string[];
};

type NotificationReport = {
  id: string;
  viewedBy?: string[];
  submittedBy?: string;
  submitterName?: string;
  projectTitle?: string;
  title?: string;
  createdAt: string;
  projectId?: string;
};

type ScreenBrandHeaderProps = {
  title: string;
  notificationCount?: number;
  pendingUsers?: User[];
  unreadMessages?: NotificationMessage[];
  unreadReports?: NotificationReport[];
  pendingPartnerApplications?: PartnerProjectApplication[];
  pendingVolunteerRequests?: Array<VolunteerProjectMatch & { volunteerName?: string; projectTitle?: string }>;
  onNotificationDismiss?: () => void;
  onNotificationOpen?: () => void;
  onNotificationClick?: (item: NotificationItemType) => void;
  navigation?: any;
  userId?: string;
};

type NotificationItemType = {
  id: string;
  type: 'approval' | 'message' | 'report' | 'partner-application' | 'volunteer-request';
  title: string;
  subtitle: string;
  timestamp: string;
  data?: any;
};

// Shows the shared branded header used above most top-level screens.
export default function ScreenBrandHeader({
  title,
  notificationCount = 0,
  pendingUsers = [],
  unreadMessages = [],
  unreadReports = [],
  pendingPartnerApplications = [],
  pendingVolunteerRequests = [],
  onNotificationDismiss,
  onNotificationOpen,
  onNotificationClick,
  navigation,
  userId,
}: ScreenBrandHeaderProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isCompact = width < 380;
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const canGoBack = !!navigation?.canGoBack?.();
  const handleGoBack = () => navigation?.goBack?.();

  const handleDismissNotification = () => {
    setShowNotificationModal(false);
    onNotificationDismiss?.();
  };

  const handleOpenNotificationModal = () => {
    setShowNotificationModal(true);
    onNotificationOpen?.();
  };

  const formatTimestamp = (value: string) => {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  };

  const buildNotificationsList = (): NotificationItemType[] => {
    const items: NotificationItemType[] = [];

    // Add pending user approvals
    pendingUsers.forEach((user) => {
      items.push({
        id: `approval-${user.id}`,
        type: 'approval',
        title: user.name || user.email || 'New account approval',
        subtitle: `${user.role} account waiting for review`,
        timestamp: formatTimestamp(user.createdAt),
        data: user,
      });
    });

    // Add unread messages
    unreadMessages.forEach((msg) => {
      items.push({
        id: `message-${msg.id}`,
        type: 'message',
        title: msg.senderName || msg.senderId || 'New Message',
        subtitle: msg.content || 'New message received',
        timestamp: formatTimestamp(msg.timestamp),
        data: msg,
      });
    });

    // Add unread reports
    unreadReports.forEach((report) => {
      items.push({
        id: `report-${report.id}`,
        type: 'report',
        title: report.title || report.projectTitle || 'New Report',
        subtitle: report.submitterName || report.submittedBy || 'Report submitted',
        timestamp: formatTimestamp(report.createdAt),
        data: report,
      });
    });

    // Add pending partner project proposals/applications
    pendingPartnerApplications.forEach((application) => {
      items.push({
        id: `partner-application-${application.id}`,
        type: 'partner-application',
        title: application.proposalDetails?.proposedTitle || application.proposalDetails?.targetProjectTitle || 'New partner proposal',
        subtitle: `${application.partnerName || 'Partner'} is waiting for project review`,
        timestamp: formatTimestamp(application.requestedAt),
        data: application,
      });
    });

    // Add pending volunteer project/event requests
    pendingVolunteerRequests.forEach((request) => {
      items.push({
        id: `volunteer-request-${request.id}`,
        type: 'volunteer-request',
        title: request.projectTitle || 'New volunteer request',
        subtitle: `${request.volunteerName || request.volunteerId || 'Volunteer'} requested to join`,
        timestamp: formatTimestamp(request.requestedAt || request.matchedAt),
        data: request,
      });
    });

    return items.sort((left, right) => {
      const leftTime = new Date(left.data?.requestedAt || left.data?.createdAt || left.data?.timestamp || left.data?.matchedAt || 0).getTime();
      const rightTime = new Date(right.data?.requestedAt || right.data?.createdAt || right.data?.timestamp || right.data?.matchedAt || 0).getTime();
      return rightTime - leftTime;
    });
  };

  const handleNotificationClick = (item: NotificationItemType) => {
    if (navigation) {
      switch (item.type) {
        case 'approval':
          navigation.navigate('Users');
          break;
        case 'message':
          navigation.navigate('Messages', {
            conversationUserId: item.data?.senderId || item.data?.recipientId,
          });
          break;
        case 'report':
          navigation.navigate('Reports', {
            projectId: item.data?.projectId,
          });
          break;
        case 'partner-application':
          navigation.navigate('Projects', {
            projectId: item.data?.projectId,
          });
          break;
        case 'volunteer-request':
          navigation.navigate('Projects', {
            projectId: item.data?.projectId,
          });
          break;
      }
    }

    onNotificationClick?.(item);
    handleDismissNotification();
  };

  const getNotificationIcon = (type: NotificationItemType['type']) => {
    switch (type) {
      case 'approval':
        return 'person-add';
      case 'message':
        return 'mail';
      case 'report':
        return 'insert-chart';
      case 'partner-application':
        return 'business';
      case 'volunteer-request':
        return 'volunteer-activism';
      default:
        return 'notifications';
    }
  };

  const getNotificationColor = (type: NotificationItemType['type']) => {
    switch (type) {
      case 'approval':
        return '#166534';
      case 'message':
        return '#0369a1';
      case 'report':
        return '#b45309';
      case 'partner-application':
        return '#7c3aed';
      case 'volunteer-request':
        return '#0f766e';
      default:
        return '#64748b';
    }
  };

  const notifications = buildNotificationsList();
  const hasNotifications = notificationCount > 0;

  return (
    <>
      <View style={[styles.container, { paddingTop: Math.max(12, insets.top + 8) }]}>
        <View style={[styles.brandBlock, isCompact && styles.brandBlockCompact]}>
          <View style={[styles.copyBlock, isCompact && styles.copyBlockCompact]}>
            <Text style={[styles.screenTitle, isCompact && styles.screenTitleCompact]} numberOfLines={2}>
              {title}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.notificationBellWrap}
            onPress={handleOpenNotificationModal}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name={hasNotifications ? 'notifications-active' : 'notifications-none'} size={24} color="#166534" />
            {hasNotifications && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={showNotificationModal} animationType="fade" transparent onRequestClose={handleDismissNotification}>
        <Pressable style={styles.notificationModalOverlay} onPress={handleDismissNotification}>
          <View style={styles.notificationModal}>
            <View style={styles.notificationModalHeader}>
              <Text style={styles.notificationModalTitle}>Notifications</Text>
              <TouchableOpacity
                onPress={handleDismissNotification}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={24} color="#475569" />
              </TouchableOpacity>
            </View>

            {notifications.length === 0 ? (
              <View style={styles.notificationEmptyState}>
                <MaterialIcons name="check-circle" size={48} color="#16a34a" />
                <Text style={styles.notificationEmptyText}>All caught up!</Text>
              </View>
            ) : (
              <ScrollView style={styles.notificationList} contentContainerStyle={styles.notificationListContent} scrollEnabled>
                {notifications.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.notificationItem}
                    onPress={() => handleNotificationClick(item)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.notificationItemIcon, { backgroundColor: getNotificationColor(item.type) + '15' }]}>
                      <MaterialIcons name={getNotificationIcon(item.type)} size={18} color={getNotificationColor(item.type)} />
                    </View>
                    <View style={styles.notificationItemContent}>
                      <Text style={styles.notificationItemName}>{item.title}</Text>
                      <Text style={styles.notificationItemSubtitle}>{item.subtitle}</Text>
                      <Text style={styles.notificationItemTimestamp}>{item.timestamp}</Text>
                    </View>
                    <View style={styles.notificationItemChevron}>
                      <MaterialIcons name="chevron-right" size={20} color="#cbd5e1" />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={styles.notificationModalFooter}>
              <Text style={styles.notificationModalFooterText}>
                {notifications.length > 0
                  ? `${notifications.length} notification${notifications.length !== 1 ? 's' : ''}`
                  : 'No notifications'}
              </Text>
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  brandBlock: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 4,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  brandBlockCompact: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  logoWrap: {
    width: 108,
    height: 72,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  logoWrapCompact: {
    width: 86,
    height: 58,
  },
  copyBlock: {
    flex: 1,
  },
  copyBlockCompact: {
    alignItems: 'center',
  },
  brandName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.3,
  },
  brandNameCompact: {
    fontSize: 17,
    textAlign: 'center',
  },
  screenTitle: {
    marginTop: 2,
    fontSize: 18,
    color: '#17212f',
    fontWeight: '700',
  },
  screenTitleCompact: {
    textAlign: 'center',
    fontSize: 12,
  },
  notificationBellWrap: {
    position: 'relative',
    padding: 8,
    marginLeft: 'auto',
  },
  notificationBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  notificationBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  notificationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-start',
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  notificationModal: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    maxWidth: 400,
    maxHeight: 500,
    width: '100%',
    alignSelf: 'center',
  },
  notificationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  notificationModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  notificationList: {
    flex: 1,
    maxHeight: 350,
  },
  notificationListContent: {
    paddingVertical: 8,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  notificationItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationItemContent: {
    flex: 1,
  },
  notificationItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  notificationItemSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
  },
  notificationItemTimestamp: {
    fontSize: 11,
    color: '#94a3b8',
  },
  notificationItemChevron: {
    paddingLeft: 8,
  },
  notificationEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  notificationEmptyText: {
    fontSize: 14,
    color: '#16a34a',
    fontWeight: '600',
  },
  notificationModalFooter: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  goBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ecfdf5',
    marginRight: 8,
  },
  goBackButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  notificationModalFooterText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    textAlign: 'center',
  },
});
