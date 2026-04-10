import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { Message, Project, ProjectGroupMessage, User, VolunteerProjectJoinRecord } from '../models/types';
import {
  getAllUsers,
  getConversation,
  getMessagesForUser,
  getProjectGroupMessages,
  getProjectsScreenSnapshot,
  markMessageAsRead,
  MessageSubscriptionEvent,
  saveMessage,
  saveProjectGroupMessage,
  subscribeToMessages,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const WEB_MESSAGE_SYNC_KEY = 'volcre:messages:updatedAt';

type ConversationItem = {
  user: User;
  lastMessage?: Message;
  unreadCount: number;
};

type ProjectChatItem = {
  project: Project;
  participantCount: number;
};

type ChatMessage = Message | ProjectGroupMessage;

// Converts a user role into a label that is easier to read in chat lists.
const formatRoleLabel = (chatUser: User) => {
  if (chatUser.role === 'admin') {
    return 'NVC Admin Account';
  }

  return chatUser.role.charAt(0).toUpperCase() + chatUser.role.slice(1);
};

// Formats message timestamps for the conversation preview and chat bubbles.
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

// Generates a lightweight local id before the message is saved.
const createMessageId = () =>
  `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Builds the one-line preview shown in conversation rows when a photo was sent.
const getMessagePreview = (message?: Message) => {
  if (!message) {
    return '';
  }

  if (message.content?.trim()) {
    return message.content;
  }

  return message.attachments?.length ? 'Photo attachment' : '';
};

// Keeps direct conversations ordered by the newest message first.
function sortConversations(items: ConversationItem[]): ConversationItem[] {
  return [...items].sort((left, right) => {
    const leftTime = left.lastMessage ? new Date(left.lastMessage.timestamp).getTime() : 0;
    const rightTime = right.lastMessage ? new Date(right.lastMessage.timestamp).getTime() : 0;
    return rightTime - leftTime;
  });
}

// Replaces an existing message or appends a new one while keeping chat order stable.
function upsertChatMessage(currentMessages: ChatMessage[], nextMessage: ChatMessage): ChatMessage[] {
  const existingIndex = currentMessages.findIndex(message => message.id === nextMessage.id);
  if (existingIndex >= 0) {
    const updated = [...currentMessages];
    updated[existingIndex] = nextMessage;
    return updated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  return [...currentMessages, nextMessage].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

// Counts unique volunteers participating in a project chat.
function countProjectParticipants(
  project: Project,
  joinRecords: VolunteerProjectJoinRecord[]
): number {
  const participants = new Set<string>();
  let matchedVolunteerCount = 0;

  for (const userId of project.joinedUserIds || []) {
    if (userId) {
      participants.add(userId);
    }
  }

  for (const record of joinRecords) {
    if (record.projectId === project.id && record.volunteerUserId) {
      participants.add(record.volunteerUserId);
      matchedVolunteerCount += 1;
    }
  }

  return Math.max(participants.size, matchedVolunteerCount, project.volunteers.length);
}

// Manages direct messages and volunteer project group chats.
export default function CommunicationHubScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const [view, setView] = useState<'conversations' | 'detail'>('conversations');
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [projectChats, setProjectChats] = useState<ProjectChatItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedProjectChat, setSelectedProjectChat] = useState<ProjectChatItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [selectedAttachmentUri, setSelectedAttachmentUri] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const selectedUserRef = useRef<User | null>(null);
  const selectedProjectChatRef = useRef<ProjectChatItem | null>(null);
  const viewRef = useRef<'conversations' | 'detail'>('conversations');
  const allUsersRef = useRef<User[]>([]);
  const lastLoadAlertMessageRef = useRef<string | null>(null);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    selectedProjectChatRef.current = selectedProjectChat;
  }, [selectedProjectChat]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    allUsersRef.current = allUsers;
  }, [allUsers]);

  const showRequestAlert = React.useCallback(
    (error: unknown, fallbackTitle = 'Error', fallbackMessage: string) => {
      const title = getRequestErrorTitle(error, fallbackTitle);
      const message = getRequestErrorMessage(error, fallbackMessage);
      const alertKey = `${title}:${message}`;

      if (lastLoadAlertMessageRef.current === alertKey) {
        return;
      }

      setLoadError({ title, message });
      lastLoadAlertMessageRef.current = alertKey;
    },
    []
  );

  // Loads all chatable users except the currently logged-in account.
  const loadUsers = async () => {
    try {
      const users = await getAllUsers();
      const otherUsers = users.filter(candidate => candidate.id !== user?.id);

      otherUsers.sort((left, right) => {
        if (left.role === 'admin' && right.role !== 'admin') return -1;
        if (left.role !== 'admin' && right.role === 'admin') return 1;
        return left.name.localeCompare(right.name);
      });

      setAllUsers(otherUsers);
      setLoadError(null);
      lastLoadAlertMessageRef.current = null;
    } catch (error) {
      showRequestAlert(error, 'Database Unavailable', 'Failed to load users for messaging.');
    }
  };

  // Builds the conversation list with unread counts and latest messages.
  const loadConversations = async () => {
    try {
      const allMessages = await getMessagesForUser(user?.id || '');
      const conversationMap = new Map<string, ConversationItem>();

      for (const message of allMessages) {
        const otherUserId = message.senderId === user?.id ? message.recipientId : message.senderId;
        const otherUser = allUsersRef.current.find(chatUser => chatUser.id === otherUserId);

        if (!otherUser) {
          continue;
        }

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

      setConversations(sortConversations(Array.from(conversationMap.values())));
      setLoadError(null);
      lastLoadAlertMessageRef.current = null;
    } catch (error) {
      showRequestAlert(error, 'Database Unavailable', 'Failed to load conversations.');
    }
  };

  // Loads the project or event chats available to the current account.
  const loadProjectChats = async () => {
    if (!user?.id || (user.role !== 'volunteer' && user.role !== 'admin')) {
      setProjectChats([]);
      return;
    }

    try {
      const snapshot = await getProjectsScreenSnapshot(user);
      if (user.role === 'admin') {
        const nextProjectChats = snapshot.projects
          .map(project => ({
            project,
            participantCount: countProjectParticipants(project, snapshot.volunteerJoinRecords),
          }))
          .sort((left, right) => left.project.title.localeCompare(right.project.title));

        setProjectChats(nextProjectChats);
        setLoadError(null);
        lastLoadAlertMessageRef.current = null;
        return;
      }

      const joinedProjectIds = new Set<string>(
        snapshot.volunteerJoinRecords.map(record => record.projectId)
      );

      for (const project of snapshot.projects) {
        if ((project.joinedUserIds || []).includes(user.id)) {
          joinedProjectIds.add(project.id);
        }

        if (
          snapshot.volunteerProfile &&
          project.volunteers.includes(snapshot.volunteerProfile.id)
        ) {
          joinedProjectIds.add(project.id);
        }
      }

      const nextProjectChats = snapshot.projects
        .filter(project => joinedProjectIds.has(project.id))
        .map(project => ({
          project,
          participantCount: countProjectParticipants(project, snapshot.volunteerJoinRecords),
        }))
        .sort((left, right) => left.project.title.localeCompare(right.project.title));

      setProjectChats(nextProjectChats);
      setLoadError(null);
      lastLoadAlertMessageRef.current = null;
    } catch (error) {
      showRequestAlert(error, 'Database Unavailable', 'Failed to load project chats.');
    }
  };

  // Loads the messages for the currently selected direct or group chat.
  const loadSelectedMessages = async () => {
    if (!user) {
      return;
    }

    if (selectedUserRef.current) {
      try {
        const userMessages = await getConversation(user.id, selectedUserRef.current.id);
        setMessages(userMessages);

        const unreadMessages = userMessages.filter(
          message => !message.read && message.recipientId === user.id
        );
        if (unreadMessages.length > 0) {
          await Promise.all(unreadMessages.map(message => markMessageAsRead(message.id)));
          setMessages(currentMessages =>
            currentMessages.map(message =>
              unreadMessages.some(unreadMessage => unreadMessage.id === message.id)
                ? { ...message, read: true }
                : message
            )
          );
          setConversations(currentConversations =>
            currentConversations.map(conversation =>
              conversation.user.id === selectedUserRef.current?.id
                ? { ...conversation, unreadCount: 0 }
                : conversation
            )
          );
        }
        setLoadError(null);
        lastLoadAlertMessageRef.current = null;
      } catch (error) {
        showRequestAlert(error, 'Database Unavailable', 'Failed to load messages.');
      }
      return;
    }

    if (!selectedProjectChatRef.current) {
      setMessages([]);
      return;
    }

    try {
      const projectMessages = await getProjectGroupMessages(
        selectedProjectChatRef.current.project.id,
        user.id
      );
      setMessages(projectMessages);
      setLoadError(null);
      lastLoadAlertMessageRef.current = null;
    } catch (error) {
      showRequestAlert(error, 'Group chat unavailable', 'Failed to load this project group chat.');
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      void loadUsers();
      void loadProjectChats();

      if (view === 'detail' && (selectedUser || selectedProjectChat)) {
        void loadSelectedMessages();
      } else {
        void loadConversations();
      }

      const unsubscribeUsers = subscribeToStorageChanges(['users'], () => {
        void loadUsers();
      });

      const unsubscribeProjectChats = subscribeToStorageChanges(
        ['projects', 'volunteerProjectJoins'],
        () => {
          void loadProjectChats();
        }
      );

      return () => {
        unsubscribeUsers();
        unsubscribeProjectChats();
      };
    }, [view, selectedUser, selectedProjectChat, user?.id, user?.role])
  );

  useEffect(() => {
    if (view === 'conversations') {
      void loadConversations();
    }
  }, [view, allUsers, user?.id]);

  useEffect(() => {
    if (view === 'detail' && (selectedUser || selectedProjectChat)) {
      void loadSelectedMessages();
    }
  }, [view, selectedUser, selectedProjectChat, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const unsubscribe = subscribeToMessages(
      user.id,
      async (event: MessageSubscriptionEvent) => {
        if (event.type === 'message.changed') {
          const incomingMessage = event.message;
          const selectedDirectUser = selectedUserRef.current;
          const isSelectedConversation =
            viewRef.current === 'detail' &&
            !selectedProjectChatRef.current &&
            selectedDirectUser &&
            (incomingMessage.senderId === selectedDirectUser.id ||
              incomingMessage.recipientId === selectedDirectUser.id);

          if (isSelectedConversation) {
            await loadSelectedMessages();
            return;
          }

          await loadConversations();
          return;
        }

        const selectedProjectId = selectedProjectChatRef.current?.project.id;
        if (
          viewRef.current === 'detail' &&
          selectedProjectId &&
          event.message.projectId === selectedProjectId
        ) {
          setMessages(current => upsertChatMessage(current, event.message));
        }
      }
    );

    const fallbackRefresh = setInterval(() => {
      if (viewRef.current === 'detail') {
        void loadSelectedMessages();
        return;
      }
      void loadConversations();
      void loadProjectChats();
    }, 30000);

    return () => {
      clearInterval(fallbackRefresh);
      unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleStorageUpdate = (event: StorageEvent) => {
      if (event.key !== WEB_MESSAGE_SYNC_KEY) return;

      if (view === 'detail') {
        void loadSelectedMessages();
        return;
      }

      void loadConversations();
      void loadProjectChats();
    };

    window.addEventListener('storage', handleStorageUpdate);
    return () => window.removeEventListener('storage', handleStorageUpdate);
  }, [view, selectedUser, selectedProjectChat, user?.id]);

  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projectChats.length === 0) {
      return;
    }

    const requestedProjectChat = projectChats.find(
      projectChat => projectChat.project.id === requestedProjectId
    );
    if (!requestedProjectChat) {
      return;
    }

    setSelectedProjectChat(requestedProjectChat);
    setSelectedUser(null);
    setMessages([]);
    setView('detail');
    navigation.setParams({ projectId: undefined });
  }, [navigation, projectChats, route?.params?.projectId]);

  useEffect(() => {
    if (!selectedProjectChat) {
      return;
    }

    const refreshedProjectChat = projectChats.find(
      projectChat => projectChat.project.id === selectedProjectChat.project.id
    );

    if (!refreshedProjectChat) {
      setSelectedProjectChat(null);
      setMessages([]);
      setView('conversations');
      return;
    }

    if (
      refreshedProjectChat.participantCount !== selectedProjectChat.participantCount ||
      refreshedProjectChat.project.title !== selectedProjectChat.project.title
    ) {
      setSelectedProjectChat(refreshedProjectChat);
    }
  }, [projectChats, selectedProjectChat]);

  const handlePickAttachment = async () => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }

      setSelectedAttachmentUri(pickedImage);
    } catch (error: any) {
      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');
    }
  };

  // Sends a direct or project group message from the current detail view.
  const handleSendMessage = async () => {
    if ((!messageText.trim() && !selectedAttachmentUri) || !user) {
      Alert.alert('Error', 'Add a message or photo before sending.');
      return;
    }

    try {
      if (selectedUser) {
        const newMessage: Message = {
          id: createMessageId(),
          senderId: user.id,
          recipientId: selectedUser.id,
          content: messageText,
          timestamp: new Date().toISOString(),
          read: false,
          attachments: selectedAttachmentUri ? [selectedAttachmentUri] : undefined,
        };

        setMessages(current => upsertChatMessage(current, newMessage));
        setConversations(currentConversations => {
          const nextConversation: ConversationItem = {
            user: selectedUser,
            lastMessage: newMessage,
            unreadCount: 0,
          };

          const remainingConversations = currentConversations.filter(
            conversation => conversation.user.id !== selectedUser.id
          );

          return sortConversations([nextConversation, ...remainingConversations]);
        });
        await saveMessage(newMessage);
        setMessageText('');
        setSelectedAttachmentUri(null);
        return;
      }

      if (!selectedProjectChat) {
        return;
      }

      const newMessage: ProjectGroupMessage = {
        id: createMessageId(),
        projectId: selectedProjectChat.project.id,
        senderId: user.id,
        content: messageText,
        timestamp: new Date().toISOString(),
        attachments: selectedAttachmentUri ? [selectedAttachmentUri] : undefined,
      };

      setMessages(current => upsertChatMessage(current, newMessage));
      await saveProjectGroupMessage(newMessage);
      setMessageText('');
      setSelectedAttachmentUri(null);
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to send message.')
      );
      await loadSelectedMessages();
      await loadConversations();
    }
  };

  // Opens a direct conversation with the selected user.
  const handleSelectUser = (chatUser: User) => {
    setSelectedUser(chatUser);
    setSelectedProjectChat(null);
    setMessages([]);
    setSelectedAttachmentUri(null);
    setView('detail');
  };

  // Opens the selected project or event group chat.
  const handleSelectProjectChat = (projectChat: ProjectChatItem) => {
    setSelectedProjectChat(projectChat);
    setSelectedUser(null);
    setMessages([]);
    setSelectedAttachmentUri(null);
    setView('detail');
  };

  // Resolves the sender name shown above each group chat message.
  const getSenderLabel = (senderId: string) => {
    if (senderId === user?.id) {
      return 'You';
    }

    return allUsersRef.current.find(chatUser => chatUser.id === senderId)?.name || 'Volunteer';
  };

  const conversationUserIds = new Set(conversations.map(conversation => conversation.user.id));
  const suggestedUsers = allUsers.filter(chatUser => !conversationUserIds.has(chatUser.id));
  const isAdminUser = user?.role === 'admin';
  const projectChatSectionTitle = isAdminUser ? 'All Project Group Chats' : 'Your Project Group Chats';
  const projectChatSubtitle =
    isAdminUser
      ? 'Direct messages plus project and event group chats across the system'
      : 'Direct messages plus joined project and event group chats';
  const selectedChatTitle = selectedUser?.name || selectedProjectChat?.project.title || '';
  const selectedChatSubtitle = selectedUser
    ? formatRoleLabel(selectedUser)
    : selectedProjectChat
    ? isAdminUser
      ? `${selectedProjectChat.participantCount} volunteer${
          selectedProjectChat.participantCount === 1 ? '' : 's'
        } currently joined in this ${selectedProjectChat.project.isEvent ? 'event' : 'project'} chat`
      : `${selectedProjectChat.participantCount} volunteer${
          selectedProjectChat.participantCount === 1 ? '' : 's'
        } in this ${selectedProjectChat.project.isEvent ? 'event' : 'project'} chat`
    : '';

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

  if (view === 'detail' && (selectedUser || selectedProjectChat)) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <View style={styles.detailHeader}>
          <TouchableOpacity
            onPress={() => {
              setView('conversations');
              setSelectedUser(null);
              setSelectedProjectChat(null);
              setMessages([]);
              setSelectedAttachmentUri(null);
            }}
          >
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.detailHeaderTitle}>{selectedChatTitle}</Text>
            <Text style={styles.detailHeaderRole}>{selectedChatSubtitle}</Text>
          </View>
        </View>

        {loadError ? (
          <View style={styles.inlineErrorWrap}>
            <InlineLoadError
              title={loadError.title}
              message={loadError.message}
              onRetry={() => void loadSelectedMessages()}
            />
          </View>
        ) : null}

        <ScrollView style={styles.messagesContainer} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <View style={styles.emptyMessages}>
              <MaterialIcons
                name={selectedProjectChat ? 'groups' : 'mail-outline'}
                size={40}
                color="#ccc"
              />
              <Text style={styles.emptyText}>
                {selectedProjectChat
                  ? 'No group messages yet. Start the conversation.'
                  : 'No messages yet. Start a conversation!'}
              </Text>
            </View>
          ) : (
            messages.map(message => {
              const isOwnMessage = message.senderId === user.id;
              const senderLabel = getSenderLabel(message.senderId);
              const imageAttachments = (message.attachments || []).filter(isImageMediaUri);

              return (
                <View
                  key={message.id}
                  style={[
                    styles.messageBubble,
                    isOwnMessage && styles.messageBubbleSent,
                  ]}
                >
                  {selectedProjectChat && (
                    <Text
                      style={[
                        styles.messageSender,
                        isOwnMessage && styles.messageSenderSent,
                      ]}
                    >
                      {senderLabel}
                    </Text>
                  )}
                  {imageAttachments.map((attachmentUri, index) => (
                    <Image
                      key={`${message.id}-attachment-${index}`}
                      source={{ uri: attachmentUri }}
                      style={styles.messageAttachment}
                      resizeMode="cover"
                    />
                  ))}
                  {message.content?.trim() ? (
                    <Text
                      style={[
                        styles.messageText,
                        isOwnMessage && styles.messageTextSent,
                      ]}
                    >
                      {message.content}
                    </Text>
                  ) : null}
                  {!!formatMessageTime(message.timestamp) && (
                    <Text style={styles.messageTime}>{formatMessageTime(message.timestamp)}</Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={styles.inputContainer}>
          {selectedAttachmentUri ? (
            <View style={styles.attachmentPreviewCard}>
              <Image source={{ uri: selectedAttachmentUri }} style={styles.attachmentPreviewImage} />
              <TouchableOpacity
                style={styles.attachmentRemoveButton}
                onPress={() => setSelectedAttachmentUri(null)}
              >
                <MaterialIcons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TouchableOpacity style={styles.attachmentButton} onPress={handlePickAttachment}>
              <MaterialIcons name="photo-library" size={18} color="#166534" />
            </TouchableOpacity>
            <TextInput
              style={styles.messageInput}
              placeholder={
                selectedProjectChat ? 'Message this volunteer group...' : 'Type a message...'
              }
              placeholderTextColor="#999"
              value={messageText}
              onChangeText={setMessageText}
              multiline
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
              <MaterialIcons name="send" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  const showEmptyState =
    projectChats.length === 0 && conversations.length === 0 && suggestedUsers.length === 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Communication Hub</Text>

      <Text style={styles.subtitle}>
        {projectChatSubtitle}
      </Text>

      {loadError ? (
        <View style={styles.inlineErrorWrap}>
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => {
              void loadUsers();
              void loadProjectChats();
              void loadConversations();
            }}
          />
        </View>
      ) : null}

      {showEmptyState ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="mail-outline" size={48} color="#ccc" />
          <Text style={styles.emptyStateText}>No conversations yet</Text>
        </View>
      ) : (
        <ScrollView style={styles.listContainer} showsVerticalScrollIndicator={false}>
          {projectChats.length > 0 && (
            <View style={styles.projectChatsSection}>
              <Text style={styles.sectionTitle}>{projectChatSectionTitle}</Text>
              {projectChats.map(projectChat => (
                <TouchableOpacity
                  key={projectChat.project.id}
                  style={styles.projectChatCard}
                  onPress={() => handleSelectProjectChat(projectChat)}
                >
                  <View style={styles.projectChatIcon}>
                    <MaterialIcons
                      name={projectChat.project.isEvent ? 'event' : 'groups'}
                      size={22}
                      color="#166534"
                    />
                  </View>
                  <View style={styles.projectChatCopy}>
                    <Text style={styles.projectChatTitle}>{projectChat.project.title}</Text>
                    <Text style={styles.projectChatMeta}>
                      {projectChat.project.isEvent ? 'Event group chat' : 'Project group chat'} •{' '}
                      {projectChat.participantCount} volunteer
                      {projectChat.participantCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <MaterialIcons name="arrow-forward" size={20} color="#999" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {suggestedUsers.length > 0 && (
            <View style={styles.suggestedUsers}>
              <Text style={styles.sectionTitle}>
                {conversations.length === 0 ? 'Start a direct conversation with:' : 'New users available to chat:'}
              </Text>
              {suggestedUsers.map(chatUser => (
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
          )}

          {conversations.length > 0 ? (
            <View style={styles.conversationsSection}>
              <Text style={styles.sectionTitle}>Direct Conversations</Text>
              {conversations.map(item => (
                <TouchableOpacity
                  key={item.user.id}
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
                        {getMessagePreview(item.lastMessage)}
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
              ))}
            </View>
          ) : null}
        </ScrollView>
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
  inlineErrorWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  listContainer: {
    flex: 1,
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
  messageSender: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 4,
  },
  messageSenderSent: {
    color: '#e8f5e9',
  },
  messageAttachment: {
    width: 180,
    height: 180,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#d1d5db',
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
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  attachmentButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  attachmentPreviewCard: {
    alignSelf: 'flex-start',
    width: 108,
    height: 108,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
  },
  attachmentPreviewImage: {
    width: '100%',
    height: '100%',
  },
  attachmentRemoveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
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
    textAlign: 'center',
  },
  projectChatsSection: {
    padding: 16,
  },
  projectChatCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  projectChatIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectChatCopy: {
    flex: 1,
  },
  projectChatTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  projectChatMeta: {
    fontSize: 12,
    color: '#666',
    marginTop: 3,
  },
  suggestedUsers: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  conversationsSection: {
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
    paddingHorizontal: 16,
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
