import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  Easing,
  Vibration,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import {
  getMessagesForUser,
  markMessageAsRead,
  subscribeToMessages,
  subscribeToStorageChanges,
} from '../models/storage';
import { Message } from '../models/types';
import { navigateTo } from '../navigation/navigationRef';

type ActiveBannerNotification = {
  id: string;
  title: string;
  body: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconBg: string;
  iconColor: string;
  timestamp: string;
};

export default function InAppNotificationBanner() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [activeNotification, setActiveNotification] = useState<ActiveBannerNotification | null>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const translateY = useRef(new Animated.Value(-140)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const dismissBanner = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -140,
        duration: 250,
        easing: Easing.in(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start(() => {
      setActiveNotification(null);
    });
  }, [opacity, translateY]);

  const showNotificationBanner = useCallback(
    (notification: ActiveBannerNotification) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      setActiveNotification(notification);

      // Light haptic pulse on mobile devices
      if (Platform.OS !== 'web') {
        try {
          Vibration.vibrate(80);
        } catch {}
      }

      translateY.setValue(-140);
      opacity.setValue(0);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 65,
          friction: 9,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();

      // Auto-hide after 5.5 seconds
      hideTimerRef.current = setTimeout(() => {
        dismissBanner();
      }, 5500);
    },
    [dismissBanner, opacity, translateY]
  );

  const handleIncomingMessage = useCallback(
    (message: Message) => {
      if (!user?.id) return;
      if (message.recipientId !== user.id) return;
      if (seenMessageIdsRef.current.has(message.id)) return;

      seenMessageIdsRef.current.add(message.id);

      // Only display banner if the message is fresh (within last 2 minutes or unread)
      const messageAgeMs = Date.now() - new Date(message.timestamp).getTime();
      if (messageAgeMs > 2 * 60 * 1000 && message.read) {
        return;
      }

      const content = String(message.content || '').trim();
      let title = 'New Notification';
      let icon: keyof typeof MaterialIcons.glyphMap = 'notifications-active';
      let iconBg = '#dcfce7';
      let iconColor = '#166534';

      if (content.startsWith('You were assigned to')) {
        title = 'Task Assigned';
        icon = 'assignment-turned-in';
        iconBg = '#e0f2fe';
        iconColor = '#0369a1';
      } else if (content.startsWith('You were unassigned from')) {
        title = 'Task Unassigned';
        icon = 'assignment-late';
        iconBg = '#fee2e2';
        iconColor = '#b91c1c';
      } else if (content.includes('assigned you to')) {
        title = 'Event Assignment';
        icon = 'event-available';
        iconBg = '#dcfce7';
        iconColor = '#166534';
      } else if (content.includes('approved your request')) {
        title = 'Application Approved';
        icon = 'check-circle';
        iconBg = '#dcfce7';
        iconColor = '#166534';
      } else if (content.includes('rejected your request')) {
        title = 'Application Notice';
        icon = 'highlight-off';
        iconBg = '#fee2e2';
        iconColor = '#dc2626';
      } else if (content.includes('approved')) {
        title = 'Account Approved';
        icon = 'verified-user';
        iconBg = '#dcfce7';
        iconColor = '#166534';
      } else {
        title = 'New Message';
        icon = 'chat-bubble';
        iconBg = '#fef3c7';
        iconColor = '#b45309';
      }

      showNotificationBanner({
        id: message.id,
        title,
        body: content,
        icon,
        iconBg,
        iconColor,
        timestamp: message.timestamp,
      });
    },
    [showNotificationBanner, user?.id]
  );

  const checkRecentMessages = useCallback(async () => {
    if (!user?.id) return;
    try {
      const messages = await getMessagesForUser(user.id);
      if (!initialLoadDoneRef.current) {
        // Record all existing message IDs initially so old ones don't trigger banners
        messages.forEach(m => seenMessageIdsRef.current.add(m.id));
        initialLoadDoneRef.current = true;
        return;
      }

      // Check for any newly arrived messages
      for (const msg of messages) {
        if (!seenMessageIdsRef.current.has(msg.id)) {
          handleIncomingMessage(msg);
        }
      }
    } catch (err) {
      console.warn('[InAppNotificationBanner] Error checking messages:', err);
    }
  }, [handleIncomingMessage, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setActiveNotification(null);
      seenMessageIdsRef.current.clear();
      initialLoadDoneRef.current = false;
      return;
    }

    void checkRecentMessages();

    // 1. WebSocket real-time subscription
    const unsubscribeWs = subscribeToMessages(user.id, event => {
      if (event.type === 'message.changed' && event.message) {
        handleIncomingMessage(event.message);
      }
    });

    // 2. Storage listener
    const unsubscribeStorage = subscribeToStorageChanges(['messages'], () => {
      void checkRecentMessages();
    });

    // 3. Periodic polling fallback every 4 seconds
    const interval = setInterval(() => {
      void checkRecentMessages();
    }, 4000);

    return () => {
      unsubscribeWs();
      unsubscribeStorage();
      clearInterval(interval);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [checkRecentMessages, handleIncomingMessage, user?.id]);

  const handlePressBanner = () => {
    if (activeNotification?.id) {
      void markMessageAsRead(activeNotification.id);
    }
    dismissBanner();
    navigateTo('Messages');
  };

  if (!activeNotification) {
    return null;
  }

  const topOffset = Math.max(insets.top, Platform.OS === 'web' ? 14 : 10);

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          top: topOffset,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={styles.bannerContainer}
        activeOpacity={0.92}
        onPress={handlePressBanner}
      >
        {/* Left Icon */}
        <View style={[styles.iconWrap, { backgroundColor: activeNotification.iconBg }]}>
          <MaterialIcons
            name={activeNotification.icon}
            size={22}
            color={activeNotification.iconColor}
          />
        </View>

        {/* Center Content */}
        <View style={styles.textContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.titleText} numberOfLines={1}>
              {activeNotification.title}
            </Text>
            <Text style={styles.timeText}>Just now</Text>
          </View>
          <Text style={styles.bodyText} numberOfLines={2}>
            {activeNotification.body}
          </Text>
        </View>

        {/* Action Button & Dismiss */}
        <View style={styles.actionContainer}>
          <View style={styles.viewBadge}>
            <Text style={styles.viewBadgeText}>View</Text>
            <MaterialIcons name="chevron-right" size={14} color="#166534" />
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={(e) => {
              e.stopPropagation();
              dismissBanner();
            }}
          >
            <MaterialIcons name="close" size={16} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999999,
    alignItems: 'center',
  },
  bannerContainer: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
      },
      android: {
        elevation: 10,
      },
      web: {
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)',
      },
    }),
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  titleText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  timeText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  bodyText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
    fontWeight: '500',
  },
  actionContainer: {
    alignItems: 'center',
    gap: 6,
    marginLeft: 4,
  },
  viewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  viewBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  closeBtn: {
    padding: 2,
  },
});
