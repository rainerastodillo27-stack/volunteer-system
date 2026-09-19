import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export type NotificationMessage = {
  id: string;
  senderId: string;
  recipientId?: string;
  content?: string;
  timestamp?: string;
  read?: boolean;
  senderName?: string;
  attachments?: string[];
};

type NotificationCenterContextValue = {
  openNotifications: (onItemPress?: () => void) => void;
  notificationCount: number;
};

type NotificationCenterProviderProps = {
  children: React.ReactNode;
  unreadMessages: NotificationMessage[];
  onNotificationClick?: (item: { type: 'message'; data: NotificationMessage }) => void | Promise<void>;
};

const NotificationCenterContext = createContext<NotificationCenterContextValue | null>(null);

function formatTimestamp(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export function NotificationCenterProvider({
  children,
  unreadMessages,
  onNotificationClick,
}: NotificationCenterProviderProps) {
  const [visible, setVisible] = useState(false);
  const onItemPressRef = useRef<(() => void) | undefined>(undefined);

  const notifications = useMemo(
    () => [...unreadMessages].sort((left, right) => {
      const leftTime = new Date(left.timestamp || 0).getTime();
      const rightTime = new Date(right.timestamp || 0).getTime();
      return rightTime - leftTime;
    }),
    [unreadMessages]
  );

  const closeNotifications = useCallback(() => {
    setVisible(false);
    onItemPressRef.current = undefined;
  }, []);

  const openNotifications = useCallback((onItemPress?: () => void) => {
    onItemPressRef.current = onItemPress;
    setVisible(true);
  }, []);

  const handleMessagePress = useCallback((message: NotificationMessage) => {
    void onNotificationClick?.({ type: 'message', data: message });
    const onItemPress = onItemPressRef.current;
    closeNotifications();
    onItemPress?.();
  }, [closeNotifications, onNotificationClick]);

  return (
    <NotificationCenterContext.Provider value={{ openNotifications, notificationCount: notifications.length }}>
      {children}
      <Modal visible={visible} animationType="fade" transparent onRequestClose={closeNotifications}>
        <Pressable style={styles.overlay} onPress={closeNotifications}>
          <Pressable style={styles.modal} onPress={(event) => event.stopPropagation()}>
            <View style={styles.header}>
              <Text style={styles.title}>Notifications</Text>
              <TouchableOpacity
                onPress={closeNotifications}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close notifications"
              >
                <MaterialIcons name="close" size={24} color="#475569" />
              </TouchableOpacity>
            </View>

            {notifications.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="check-circle" size={48} color="#16a34a" />
                <Text style={styles.emptyText}>All caught up!</Text>
              </View>
            ) : (
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {notifications.map((message) => (
                  <TouchableOpacity
                    key={message.id}
                    style={styles.item}
                    onPress={() => handleMessagePress(message)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.itemIcon}>
                      <MaterialIcons name="mail" size={18} color="#0369a1" />
                    </View>
                    <View style={styles.itemContent}>
                      <Text style={styles.itemName}>{message.senderName || message.senderId || 'New message'}</Text>
                      <Text style={styles.itemSubtitle} numberOfLines={2}>
                        {message.content || 'New message received'}
                      </Text>
                      <Text style={styles.itemTimestamp}>{formatTimestamp(message.timestamp)}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color="#cbd5e1" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {notifications.length > 0
                  ? `${notifications.length} notification${notifications.length !== 1 ? 's' : ''}`
                  : 'No notifications'}
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter() {
  const context = useContext(NotificationCenterContext);
  if (!context) {
    throw new Error('useNotificationCenter must be used inside NotificationCenterProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-start',
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  modal: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    maxWidth: 400,
    maxHeight: 500,
    width: '100%',
    alignSelf: 'center',
  } as any,
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  list: {
    flexGrow: 0,
    maxHeight: 350,
  },
  listContent: {
    paddingVertical: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#e0f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContent: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  itemSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
  },
  itemTimestamp: {
    fontSize: 11,
    color: '#94a3b8',
  },
  emptyState: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#16a34a',
    fontWeight: '600',
  },
  footer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  footerText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    textAlign: 'center',
  },
});
