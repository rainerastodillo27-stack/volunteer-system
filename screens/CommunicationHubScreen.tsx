import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Message, User } from '../models/types';
import {
  getMessagesForUser,
  getConversation,
  saveMessage,
  getAllUsers,
  markMessageAsRead,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';

const WEB_MESSAGE_SYNC_KEY = 'volcre:messages:updatedAt';

const formatRoleLabel = (chatUser: User) => {
  if (chatUser.role === 'admin') {
    return 'NVC Admin Account';
  }

  return chatUser.role.charAt(0).toUpperCase() + chatUser.role.slice(1);
};

const formatMessageTime = (timestamp?: string) => {
  if (!timestamp) {
    return '';
  }

  const parsedDate = new Date(timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  return format(parsedDate, 'HH:mm');
};

export default function CommunicationHubScreen({ navigation }: any) {
  const { user } = useAuth();
  const [view, setView] = useState<'conversations' | 'detail'>('conversations');
  const [conversations, setConversations] = useState<{
    user: User;
    lastMessage?: Message;
    unreadCount: number;
  }[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [allUsers, setAllUsers] = useState<User[]>([]);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (view === 'conversations') {
      loadConversations();
    }
  }, [view, allUsers]);

  useEffect(() => {
    if (view !== 'conversations') return;
    const interval = setInterval(loadConversations, 2000);
    return () => clearInterval(interval);
  }, [view, allUsers, user?.id]);

  useEffect(() => {
    if (selectedUser && view === 'detail') {
      loadMessages();
      const interval = setInterval(loadMessages, 2000); // Poll for new messages
      return () => clearInterval(interval);
    }
  }, [selectedUser, view]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleStorageUpdate = (event: StorageEvent) => {
      if (event.key !== WEB_MESSAGE_SYNC_KEY) return;
      if (view === 'detail' && selectedUser) {
        loadMessages();
      } else {
        loadConversations();
      }
    };

    window.addEventListener('storage', handleStorageUpdate);
    return () => window.removeEventListener('storage', handleStorageUpdate);
  }, [view, selectedUser, allUsers, user?.id]);

  const loadUsers = async () => {
    try {
      const users = await getAllUsers();
      const otherUsers = users.filter(u => u.id !== user?.id);
      setAllUsers(otherUsers);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadConversations = async () => {
    try {
      const allMessages = await getMessagesForUser(user?.id || '');

      // Group messages by user
      const conversationMap = new Map<
        string,
        { user: User; lastMessage?: Message; unreadCount: number }
      >();

      for (const message of allMessages) {
        const otherUserId = message.senderId === user?.id ? message.recipientId : message.senderId;
        const otherUser = allUsers.find(u => u.id === otherUserId);

        if (otherUser) {
          const existing = conversationMap.get(otherUserId) || {
            user: otherUser,
            unreadCount: 0,
          };

          if (!existing.lastMessage || new Date(message.timestamp) > new Date(existing.lastMessage.timestamp)) {
            existing.lastMessage = message;
          }

          if (!message.read && message.recipientId === user?.id) {
            existing.unreadCount += 1;
          }

          conversationMap.set(otherUserId, existing);
        }
      }

      setConversations(Array.from(conversationMap.values()));
    } catch (error) {
      Alert.alert('Error', 'Failed to load conversations');
    }
  };

  const loadMessages = async () => {
    if (!selectedUser || !user) return;

    try {
      const userMessages = await getConversation(user.id, selectedUser.id);
      setMessages(userMessages);

      // Mark unread messages as read
      for (const message of userMessages) {
        if (!message.read && message.recipientId === user.id) {
          await markMessageAsRead(message.id);
        }
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedUser || !user) {
      Alert.alert('Error', 'Message cannot be empty');
      return;
    }

    try {
      const newMessage: Message = {
        id: `msg-${Date.now()}`,
        senderId: user.id,
        recipientId: selectedUser.id,
        content: messageText,
        timestamp: new Date().toISOString(),
        read: false,
      };

      await saveMessage(newMessage);
      setMessageText('');
      await loadMessages();
      await loadConversations();
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  const handleSelectUser = (chatUser: User) => {
    setSelectedUser(chatUser);
    setView('detail');
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <MaterialIcons name="mail-outline" size={48} color="#ccc" />
          <Text style={styles.emptyStateText}>Loading messages...</Text>
        </View>
      </View>
    );
  }

  if (view === 'detail' && selectedUser) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setView('conversations')}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.detailHeaderTitle}>{selectedUser.name}</Text>
            <Text style={styles.detailHeaderRole}>{formatRoleLabel(selectedUser)}</Text>
          </View>
        </View>

        <ScrollView style={styles.messagesContainer} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <View style={styles.emptyMessages}>
              <MaterialIcons name="mail-outline" size={40} color="#ccc" />
              <Text style={styles.emptyText}>No messages yet. Start a conversation!</Text>
            </View>
          ) : (
            messages.map(message => (
              <View
                key={message.id}
                style={[
                  styles.messageBubble,
                  message.senderId === user?.id && styles.messageBubbleSent,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    message.senderId === user?.id && styles.messageTextSent,
                  ]}
                >
                  {message.content}
                </Text>
                {!!formatMessageTime(message.timestamp) && (
                  <Text style={styles.messageTime}>{formatMessageTime(message.timestamp)}</Text>
                )}
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.messageInput}
            placeholder="Type a message..."
            placeholderTextColor="#999"
            value={messageText}
            onChangeText={setMessageText}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
            <MaterialIcons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Communication Hub</Text>

      <Text style={styles.subtitle}>Connect with team members</Text>

      {conversations.length === 0 && allUsers.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="mail-outline" size={48} color="#ccc" />
          <Text style={styles.emptyStateText}>No conversations yet</Text>
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.suggestedUsers}>
          <Text style={styles.sectionTitle}>Start a conversation with:</Text>
          {allUsers.map(chatUser => (
            <TouchableOpacity
              key={chatUser.id}
              style={styles.userCard}
              onPress={() => handleSelectUser(chatUser)}
            >
              <View style={styles.userInfo}>
                <View style={styles.userAvatar}>
                  <Text style={styles.userAvatarText}>{chatUser.name.charAt(0)}</Text>
                </View>
                <View>
                  <Text style={styles.userName}>{chatUser.name}</Text>
                  <Text style={styles.userRole}>{formatRoleLabel(chatUser)}</Text>
                </View>
              </View>
              <MaterialIcons name="arrow-forward" size={20} color="#999" />
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => item.user.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.conversationItem}
              onPress={() => handleSelectUser(item.user)}
            >
              <View style={styles.conversationAvatar}>
                <Text style={styles.conversationAvatarText}>{item.user.name.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.conversationName}>{item.user.name}</Text>
                {item.lastMessage && (
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.conversationPreview,
                      item.unreadCount > 0 && styles.conversationPreviewUnread,
                    ]}
                  >
                    {item.lastMessage.content}
                  </Text>
                )}
              </View>
              <View style={styles.conversationRight}>
                {item.lastMessage && (
                  <Text style={styles.conversationTime}>
                    {formatMessageTime(item.lastMessage.timestamp)}
                  </Text>
                )}
                {item.unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
          scrollEnabled={true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 12,
  },
  detailHeaderTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  detailHeaderRole: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyMessages: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  messageBubble: {
    backgroundColor: '#e0e0e0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 6,
    maxWidth: '80%',
  },
  messageBubbleSent: {
    backgroundColor: '#4CAF50',
    alignSelf: 'flex-end',
  },
  messageText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 18,
  },
  messageTextSent: {
    color: '#fff',
  },
  messageTime: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
    textAlign: 'right',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 8,
  },
  messageInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    borderWidth: 1,
    borderColor: '#ddd',
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#4CAF50',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  emptyStateText: {
    color: '#999',
    fontSize: 16,
    marginTop: 8,
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
    marginTop: 8,
  },
  suggestedUsers: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  userRole: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  conversationItem: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  conversationAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  conversationAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
  },
  conversationName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  conversationPreview: {
    fontSize: 12,
    color: '#999',
  },
  conversationPreviewUnread: {
    color: '#333',
    fontWeight: '500',
  },
  conversationRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  conversationTime: {
    fontSize: 11,
    color: '#999',
  },
  unreadBadge: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
