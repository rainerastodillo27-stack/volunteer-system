import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
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
import {
  Message,
  Project,
  ProjectGroupMessage,
  ProjectGroupNeedPost,
  User,
  VolunteerProjectJoinRecord,
} from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const WEB_MESSAGE_SYNC_KEY = 'volcre:messages:updatedAt';

const NEED_CATEGORIES = [
  'Volunteers',
  'Supplies',
  'Transport',
  'Venue',
  'Coordination',
  'Funding',
  'Other',
] as const;
const NEED_PRIORITIES: ProjectGroupNeedPost['priority'][] = ['High', 'Medium', 'Low'];
const NEED_STATUSES: ProjectGroupNeedPost['status'][] = ['Open', 'In Progress', 'Fulfilled'];

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

type NeedPostDraft = {
  title: string;
  category: string;
  details: string;
  priority: ProjectGroupNeedPost['priority'];
  status: ProjectGroupNeedPost['status'];
  quantityLabel: string;
  targetDate: string;
};

// Converts a user role into a label that is easier to read in chat lists.
const formatRoleLabel = (chatUser: User) => {
  if (chatUser.role === 'admin') {
    return 'NVC Admin Account';
  }

  if (chatUser.role === 'partner') {
    return 'Partner Organization';
  }

  return 'Volunteer';
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

// Formats dates used in the need-post cards.
const formatDateLabel = (value?: string) => {
  if (!value) {
    return '';
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return format(parsedDate, 'MMM d, yyyy');
};

// Generates a lightweight local id before the message is saved.
const createMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Builds the one-line preview shown in conversation rows.
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

// Counts unique people participating in a project chat.
function countProjectParticipants(project: Project, joinRecords: VolunteerProjectJoinRecord[]): number {
  const participants = new Set<string>();

  for (const userId of project.joinedUserIds || []) {
    if (userId) {
      participants.add(userId);
    }
  }

  for (const record of joinRecords) {
    if (record.projectId === project.id && record.volunteerUserId) {
      participants.add(record.volunteerUserId);
    }
  }

  return Math.max(participants.size, project.volunteers.length);
}

// Creates the blank draft used by the structured need-post composer.
function createNeedPostDraft(): NeedPostDraft {
  return {
    title: '',
    category: NEED_CATEGORIES[0],
    details: '',
    priority: 'High',
    status: 'Open',
    quantityLabel: '',
    targetDate: '',
  };
}

// Summarizes a need card into the plain content field used for previews and storage fallbacks.
function buildNeedPostSummary(draft: NeedPostDraft): string {
  const quantity = draft.quantityLabel.trim();
  const detailPreview = draft.details.trim();

  if (quantity) {
    return `${draft.title.trim()} (${quantity}) - ${detailPreview || 'Need posted in the group chat.'}`;
  }

  return `${draft.title.trim()} - ${detailPreview || 'Need posted in the group chat.'}`;
}

// Returns the tint used by need priority chips.
function getPriorityPalette(priority: ProjectGroupNeedPost['priority']) {
  if (priority === 'High') {
    return { backgroundColor: '#fee2e2', textColor: '#b91c1c' };
  }

  if (priority === 'Medium') {
    return { backgroundColor: '#fef3c7', textColor: '#b45309' };
  }

  return { backgroundColor: '#dcfce7', textColor: '#166534' };
}

// Manages direct messages and project coordination group chats.
export default function CommunicationHubScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 1180;
  const isMedium = width >= 860;
  const { projectId: requestedProjectId } = route?.params || {};

  const [view, setView] = useState<'conversations' | 'detail'>('conversations');
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [projectChats, setProjectChats] = useState<ProjectChatItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedProjectChat, setSelectedProjectChat] = useState<ProjectChatItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedAttachmentUri, setSelectedAttachmentUri] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<'message' | 'need-post'>('message');
  const [needDraft, setNeedDraft] = useState<NeedPostDraft>(createNeedPostDraft);
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

  const resetComposer = useCallback(() => {
    setMessageText('');
    setSelectedAttachmentUri(null);
    setComposerMode('message');
    setNeedDraft(createNeedPostDraft());
  }, []);

  const showRequestAlert = useCallback(
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
    if (!user?.id || !['volunteer', 'admin', 'partner'].includes(user.role)) {
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

      if (user.role === 'partner') {
        const approvedApplicationProjectIds = new Set(
          snapshot.partnerApplications
            .filter(application => application.status === 'Approved')
            .map(application => application.projectId)
        );

        const nextProjectChats = snapshot.projects
          .filter(
            project =>
              approvedApplicationProjectIds.has(project.id) ||
              (project.joinedUserIds || []).includes(user.id)
          )
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

        if (snapshot.volunteerProfile && project.volunteers.includes(snapshot.volunteerProfile.id)) {
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
    useCallback(() => {
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
        ['projects', 'volunteerProjectJoins', 'partnerProjectApplications'],
        () => {
          void loadProjectChats();
        }
      );

      return () => {
        unsubscribeUsers();
        unsubscribeProjectChats();
      };
    }, [selectedProjectChat, selectedUser, user?.id, user?.role, view])
  );

  useEffect(() => {
    if (view === 'conversations') {
      void loadConversations();
    }
  }, [allUsers, user?.id, view]);

  useEffect(() => {
    if (view === 'detail' && (selectedUser || selectedProjectChat)) {
      void loadSelectedMessages();
    }
  }, [selectedProjectChat, selectedUser, user?.id, view]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const unsubscribe = subscribeToMessages(user.id, async (event: MessageSubscriptionEvent) => {
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
    });

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
    if (Platform.OS !== 'web') {
      return;
    }

    const handleStorageUpdate = (event: StorageEvent) => {
      if (event.key !== WEB_MESSAGE_SYNC_KEY) {
        return;
      }

      if (view === 'detail') {
        void loadSelectedMessages();
        return;
      }

      void loadConversations();
      void loadProjectChats();
    };

    window.addEventListener('storage', handleStorageUpdate);
    return () => window.removeEventListener('storage', handleStorageUpdate);
  }, [view, user?.id]);

  useEffect(() => {
    if (!requestedProjectId || projectChats.length === 0) {
      return;
    }

    const requestedProjectChat = projectChats.find(projectChat => projectChat.project.id === requestedProjectId);
    if (!requestedProjectChat) {
      return;
    }

    setSelectedProjectChat(requestedProjectChat);
    setSelectedUser(null);
    setMessages([]);
    resetComposer();
    setView('detail');
    navigation.setParams({ projectId: undefined });
  }, [navigation, projectChats, requestedProjectId, resetComposer]);

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

  // Sends a direct message, normal group message, or structured need post.
  const handleSendMessage = async () => {
    if (!user) {
      return;
    }

    try {
      if (selectedUser) {
        if (!messageText.trim() && !selectedAttachmentUri) {
          Alert.alert('Message Required', 'Add a message or photo before sending.');
          return;
        }

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
        resetComposer();
        return;
      }

      if (!selectedProjectChat) {
        return;
      }

      if (composerMode === 'need-post') {
        if (user.role !== 'admin' && user.role !== 'partner') {
          Alert.alert('Not allowed', 'Only admin and partner accounts can post customized needs.');
          return;
        }

        const title = needDraft.title.trim();
        const details = needDraft.details.trim();
        if (!title || !details) {
          Alert.alert('Need details required', 'Add a title and details before posting this need.');
          return;
        }

        const needPost: ProjectGroupNeedPost = {
          title,
          category: needDraft.category,
          details,
          priority: needDraft.priority,
          status: needDraft.status,
          quantityLabel: needDraft.quantityLabel.trim() || undefined,
          targetDate: needDraft.targetDate.trim() || undefined,
          requestedByRole: user.role,
        };

        const newMessage: ProjectGroupMessage = {
          id: createMessageId(),
          projectId: selectedProjectChat.project.id,
          senderId: user.id,
          content: buildNeedPostSummary(needDraft),
          timestamp: new Date().toISOString(),
          kind: 'need-post',
          needPost,
          attachments: selectedAttachmentUri ? [selectedAttachmentUri] : undefined,
        };

        setMessages(current => upsertChatMessage(current, newMessage));
        await saveProjectGroupMessage(newMessage);
        resetComposer();
        return;
      }

      if (!messageText.trim() && !selectedAttachmentUri) {
        Alert.alert('Message Required', 'Add a message or photo before sending.');
        return;
      }

      const newMessage: ProjectGroupMessage = {
        id: createMessageId(),
        projectId: selectedProjectChat.project.id,
        senderId: user.id,
        content: messageText,
        timestamp: new Date().toISOString(),
        kind: 'message',
        attachments: selectedAttachmentUri ? [selectedAttachmentUri] : undefined,
      };

      setMessages(current => upsertChatMessage(current, newMessage));
      await saveProjectGroupMessage(newMessage);
      resetComposer();
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
    resetComposer();
    setView('detail');
  };

  // Opens the selected project or event group chat.
  const handleSelectProjectChat = (projectChat: ProjectChatItem) => {
    setSelectedProjectChat(projectChat);
    setSelectedUser(null);
    setMessages([]);
    resetComposer();
    setView('detail');
  };

  // Resolves the sender name shown above each group chat message.
  const getSenderLabel = (senderId: string) => {
    if (senderId === user?.id) {
      return 'You';
    }

    return allUsersRef.current.find(chatUser => chatUser.id === senderId)?.name || 'Community member';
  };

  const detailCanPostNeeds = Boolean(
    selectedProjectChat && (user?.role === 'admin' || user?.role === 'partner')
  );

  const selectedChatTitle = selectedUser?.name || selectedProjectChat?.project.title || '';
  const selectedChatSubtitle = selectedUser
    ? formatRoleLabel(selectedUser)
    : selectedProjectChat
    ? `${selectedProjectChat.project.isEvent ? 'Event' : 'Project'} coordination space with ${selectedProjectChat.participantCount} participant${
        selectedProjectChat.participantCount === 1 ? '' : 's'
      }`
    : '';

  const totalUnreadCount = conversations.reduce((total, item) => total + item.unreadCount, 0);
  const conversationUserIds = useMemo(
    () => new Set(conversations.map(conversation => conversation.user.id)),
    [conversations]
  );

  const filteredProjectChats = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return projectChats;
    }

    return projectChats.filter(projectChat => {
      const title = projectChat.project.title.toLowerCase();
      const description = projectChat.project.description.toLowerCase();
      const location = projectChat.project.location?.address?.toLowerCase() || '';
      return title.includes(query) || description.includes(query) || location.includes(query);
    });
  }, [projectChats, searchText]);

  const filteredSuggestedUsers = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return allUsers.filter(chatUser => {
      if (conversationUserIds.has(chatUser.id)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        chatUser.name.toLowerCase().includes(query) ||
        formatRoleLabel(chatUser).toLowerCase().includes(query)
      );
    });
  }, [allUsers, conversationUserIds, searchText]);

  const filteredConversations = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return conversations;
    }

    return conversations.filter(item => {
      const lastPreview = item.lastMessage ? getMessagePreview(item.lastMessage).toLowerCase() : '';
      return item.user.name.toLowerCase().includes(query) || lastPreview.includes(query);
    });
  }, [conversations, searchText]);

  const projectChatSectionTitle =
    user?.role === 'admin'
      ? 'Project coordination spaces'
      : user?.role === 'partner'
      ? 'Partner coordination spaces'
      : 'Joined project group chats';

  const projectChatSubtitle =
    user?.role === 'admin'
      ? 'Monitor every project and event conversation from one place.'
      : user?.role === 'partner'
      ? 'Coordinate approved projects with admin and volunteers, then post your current needs in the group.'
      : 'Stay updated with the programs you joined and coordinate with your team.';

  const showEmptyState =
    filteredProjectChats.length === 0 &&
    filteredConversations.length === 0 &&
    filteredSuggestedUsers.length === 0;

  if (!user) {
    return (
      <View style={styles.screen}>
        <View style={styles.emptyStateCard}>
          <MaterialIcons name="mail-outline" size={44} color="#94a3b8" />
          <Text style={styles.emptyStateTitle}>Loading Communication Hub</Text>
        </View>
      </View>
    );
  }

  if (view === 'detail' && (selectedUser || selectedProjectChat)) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <View style={[styles.detailShell, isWide && styles.centeredShell]}>
          <View style={styles.detailHero}>
            <TouchableOpacity
              onPress={() => {
                setView('conversations');
                setSelectedUser(null);
                setSelectedProjectChat(null);
                setMessages([]);
                resetComposer();
              }}
              style={styles.backButton}
            >
              <MaterialIcons name="arrow-back" size={22} color="#0f172a" />
            </TouchableOpacity>

            <View style={styles.detailHeroCopy}>
              <Text style={styles.detailEyebrow}>
                {selectedProjectChat ? 'Project group chat' : 'Direct conversation'}
              </Text>
              <Text style={styles.detailTitle}>{selectedChatTitle}</Text>
              <Text style={styles.detailSubtitle}>{selectedChatSubtitle}</Text>
            </View>

            {selectedProjectChat ? (
              <View style={styles.detailBadge}>
                <MaterialIcons
                  name={selectedProjectChat.project.isEvent ? 'event' : 'groups'}
                  size={18}
                  color="#166534"
                />
                <Text style={styles.detailBadgeText}>
                  {selectedProjectChat.project.isEvent ? 'Event' : 'Project'}
                </Text>
              </View>
            ) : null}
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

          <ScrollView
            style={styles.messagesScroll}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyStateCard}>
                <MaterialIcons
                  name={selectedProjectChat ? 'groups' : 'mail-outline'}
                  size={42}
                  color="#94a3b8"
                />
                <Text style={styles.emptyStateTitle}>
                  {selectedProjectChat ? 'No messages in this group yet' : 'No direct messages yet'}
                </Text>
                <Text style={styles.emptyStateText}>
                  {selectedProjectChat
                    ? 'Start with a quick update or post a customized need card.'
                    : 'Start the conversation with a short message.'}
                </Text>
              </View>
            ) : (
              messages.map(message => {
                const isOwnMessage = message.senderId === user.id;
                const groupMessage = selectedProjectChat ? (message as ProjectGroupMessage) : null;
                const senderLabel = getSenderLabel(message.senderId);
                const imageAttachments = (message.attachments || []).filter(isImageMediaUri);
                const needPost = groupMessage?.kind === 'need-post' ? groupMessage.needPost : undefined;

                if (selectedProjectChat && needPost) {
                  const priorityPalette = getPriorityPalette(needPost.priority);
                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.needCard,
                        isOwnMessage ? styles.needCardOwn : styles.needCardOther,
                      ]}
                    >
                      <View style={styles.needCardHeader}>
                        <View style={styles.needHeaderCopy}>
                          <Text style={[styles.needSender, isOwnMessage && styles.needSenderOwn]}>
                            {senderLabel}
                          </Text>
                          <Text style={[styles.needTitle, isOwnMessage && styles.needTitleOwn]}>
                            {needPost.title}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.needPriorityChip,
                            { backgroundColor: priorityPalette.backgroundColor },
                          ]}
                        >
                          <Text
                            style={[
                              styles.needPriorityText,
                              { color: priorityPalette.textColor },
                            ]}
                          >
                            {needPost.priority}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.needMetaRow}>
                        <View style={styles.needMetaPill}>
                          <Text style={styles.needMetaPillText}>{needPost.category}</Text>
                        </View>
                        <View style={styles.needMetaPill}>
                          <Text style={styles.needMetaPillText}>{needPost.status}</Text>
                        </View>
                        <View style={styles.needMetaPill}>
                          <Text style={styles.needMetaPillText}>
                            {needPost.requestedByRole === 'admin' ? 'Admin request' : 'Partner request'}
                          </Text>
                        </View>
                      </View>

                      <Text style={[styles.needDetails, isOwnMessage && styles.needDetailsOwn]}>
                        {needPost.details}
                      </Text>

                      {needPost.quantityLabel ? (
                        <Text style={[styles.needSupplemental, isOwnMessage && styles.needSupplementalOwn]}>
                          Needed: {needPost.quantityLabel}
                        </Text>
                      ) : null}

                      {needPost.targetDate ? (
                        <Text style={[styles.needSupplemental, isOwnMessage && styles.needSupplementalOwn]}>
                          Target date: {formatDateLabel(needPost.targetDate)}
                        </Text>
                      ) : null}

                      {imageAttachments.map((attachmentUri, index) => (
                        <Image
                          key={`${message.id}-attachment-${index}`}
                          source={{ uri: attachmentUri }}
                          style={styles.messageAttachment}
                          resizeMode="cover"
                        />
                      ))}

                      <Text style={[styles.needTimestamp, isOwnMessage && styles.needTimestampOwn]}>
                        {formatMessageTime(message.timestamp)}
                      </Text>
                    </View>
                  );
                }

                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageBubble,
                      isOwnMessage ? styles.messageBubbleOwn : styles.messageBubbleOther,
                    ]}
                  >
                    {selectedProjectChat ? (
                      <Text style={[styles.messageSender, isOwnMessage && styles.messageSenderOwn]}>
                        {senderLabel}
                      </Text>
                    ) : null}

                    {imageAttachments.map((attachmentUri, index) => (
                      <Image
                        key={`${message.id}-attachment-${index}`}
                        source={{ uri: attachmentUri }}
                        style={styles.messageAttachment}
                        resizeMode="cover"
                      />
                    ))}

                    {message.content?.trim() ? (
                      <Text style={[styles.messageText, isOwnMessage && styles.messageTextOwn]}>
                        {message.content}
                      </Text>
                    ) : null}

                    <Text style={[styles.messageTime, isOwnMessage && styles.messageTimeOwn]}>
                      {formatMessageTime(message.timestamp)}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.composerShell}>
            {detailCanPostNeeds ? (
              <View style={styles.modeToggleRow}>
                <TouchableOpacity
                  style={[
                    styles.modeToggleButton,
                    composerMode === 'message' && styles.modeToggleButtonActive,
                  ]}
                  onPress={() => setComposerMode('message')}
                >
                  <MaterialIcons
                    name="chat-bubble-outline"
                    size={16}
                    color={composerMode === 'message' ? '#ffffff' : '#166534'}
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      composerMode === 'message' && styles.modeToggleTextActive,
                    ]}
                  >
                    Chat message
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeToggleButton,
                    composerMode === 'need-post' && styles.modeToggleButtonActive,
                  ]}
                  onPress={() => setComposerMode('need-post')}
                >
                  <MaterialIcons
                    name="campaign"
                    size={16}
                    color={composerMode === 'need-post' ? '#ffffff' : '#166534'}
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      composerMode === 'need-post' && styles.modeToggleTextActive,
                    ]}
                  >
                    Needs card
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {detailCanPostNeeds && composerMode === 'need-post' ? (
              <View style={styles.needComposerCard}>
                <Text style={styles.needComposerTitle}>Post a customized need in this group</Text>
                <Text style={styles.needComposerSubtitle}>
                  Share exactly what the admin office or partner organization needs so everyone in the chat can respond quickly.
                </Text>

                <TextInput
                  value={needDraft.title}
                  onChangeText={value => setNeedDraft(current => ({ ...current, title: value }))}
                  placeholder="Need title"
                  placeholderTextColor="#94a3b8"
                  style={styles.composerInput}
                />

                <TextInput
                  value={needDraft.details}
                  onChangeText={value => setNeedDraft(current => ({ ...current, details: value }))}
                  placeholder="Describe the need, context, and expected support"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <View style={[styles.dualInputRow, !isMedium && styles.dualInputRowStacked]}>
                  <TextInput
                    value={needDraft.quantityLabel}
                    onChangeText={value => setNeedDraft(current => ({ ...current, quantityLabel: value }))}
                    placeholder="Quantity or target support"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                  <TextInput
                    value={needDraft.targetDate}
                    onChangeText={value => setNeedDraft(current => ({ ...current, targetDate: value }))}
                    placeholder="Target date (YYYY-MM-DD)"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                </View>

                <Text style={styles.chipGroupLabel}>Category</Text>
                <View style={styles.chipWrap}>
                  {NEED_CATEGORIES.map(category => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.choiceChip,
                        needDraft.category === category && styles.choiceChipActive,
                      ]}
                      onPress={() => setNeedDraft(current => ({ ...current, category }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          needDraft.category === category && styles.choiceChipTextActive,
                        ]}
                      >
                        {category}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.chipGroupLabel}>Priority</Text>
                <View style={styles.chipWrap}>
                  {NEED_PRIORITIES.map(priority => (
                    <TouchableOpacity
                      key={priority}
                      style={[
                        styles.choiceChip,
                        needDraft.priority === priority && styles.choiceChipActive,
                      ]}
                      onPress={() => setNeedDraft(current => ({ ...current, priority }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          needDraft.priority === priority && styles.choiceChipTextActive,
                        ]}
                      >
                        {priority}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.chipGroupLabel}>Status</Text>
                <View style={styles.chipWrap}>
                  {NEED_STATUSES.map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.choiceChip,
                        needDraft.status === status && styles.choiceChipActive,
                      ]}
                      onPress={() => setNeedDraft(current => ({ ...current, status }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          needDraft.status === status && styles.choiceChipTextActive,
                        ]}
                      >
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {selectedAttachmentUri ? (
              <View style={styles.attachmentPreviewCard}>
                <Image source={{ uri: selectedAttachmentUri }} style={styles.attachmentPreviewImage} />
                <TouchableOpacity
                  style={styles.attachmentRemoveButton}
                  onPress={() => setSelectedAttachmentUri(null)}
                >
                  <MaterialIcons name="close" size={18} color="#ffffff" />
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={[styles.inputRow, !isMedium && styles.inputRowStacked]}>
              <TouchableOpacity style={styles.attachmentButton} onPress={handlePickAttachment}>
                <MaterialIcons name="photo-library" size={18} color="#166534" />
              </TouchableOpacity>

              {composerMode === 'need-post' && detailCanPostNeeds ? (
                <View style={styles.inlineHintBox}>
                  <Text style={styles.inlineHintTitle}>Needs card ready</Text>
                  <Text style={styles.inlineHintText}>
                    Post this as a structured request so admins and partner orgs can coordinate around one clear need.
                  </Text>
                </View>
              ) : (
                <TextInput
                  style={styles.messageInput}
                  placeholder={
                    selectedProjectChat ? 'Share an update with this group...' : 'Type a message...'
                  }
                  placeholderTextColor="#94a3b8"
                  value={messageText}
                  onChangeText={setMessageText}
                  multiline
                />
              )}

              <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
                <MaterialIcons
                  name={composerMode === 'need-post' ? 'campaign' : 'send'}
                  size={18}
                  color="#ffffff"
                />
                <Text style={styles.sendButtonText}>
                  {composerMode === 'need-post' ? 'Post Need' : 'Send'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={styles.listScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.listShell, isWide && styles.centeredShell]}>
          <View style={styles.heroCard}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>Collaboration workspace</Text>
              <Text style={styles.heroTitle}>Communication Hub</Text>
              <Text style={styles.heroSubtitle}>
                {projectChatSubtitle}
              </Text>
            </View>

            <View style={[styles.metricsRow, !isMedium && styles.metricsRowStacked]}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Project Chats</Text>
                <Text style={styles.metricValue}>{projectChats.length}</Text>
                <Text style={styles.metricHint}>Shared coordination spaces</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Unread</Text>
                <Text style={styles.metricValue}>{totalUnreadCount}</Text>
                <Text style={styles.metricHint}>Direct messages awaiting review</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Reachable Users</Text>
                <Text style={styles.metricValue}>{allUsers.length}</Text>
                <Text style={styles.metricHint}>Admins, partners, and volunteers</Text>
              </View>
            </View>

            <View style={styles.searchCard}>
              <MaterialIcons name="search" size={20} color="#64748b" />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search chats, names, or projects"
                placeholderTextColor="#94a3b8"
                style={styles.searchInput}
              />
            </View>
          </View>

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
            <View style={styles.emptyStateCard}>
              <MaterialIcons name="forum" size={44} color="#94a3b8" />
              <Text style={styles.emptyStateTitle}>No conversations yet</Text>
              <Text style={styles.emptyStateText}>
                When you start a direct message or join a project chat, it will appear here.
              </Text>
            </View>
          ) : (
            <View style={[styles.sectionsGrid, isWide && styles.sectionsGridWide]}>
              <View style={styles.primaryColumn}>
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={styles.sectionTitle}>{projectChatSectionTitle}</Text>
                      <Text style={styles.sectionDescription}>
                        Open the shared group and post updates, coordination notes, or customized needs.
                      </Text>
                    </View>
                  </View>

                  {filteredProjectChats.length === 0 ? (
                    <Text style={styles.emptyInlineText}>No project chats match your search.</Text>
                  ) : (
                    filteredProjectChats.map(projectChat => (
                      <TouchableOpacity
                        key={projectChat.project.id}
                        style={styles.projectChatCard}
                        onPress={() => handleSelectProjectChat(projectChat)}
                      >
                        <View style={styles.projectChatIcon}>
                          <MaterialIcons
                            name={projectChat.project.isEvent ? 'event' : 'groups'}
                            size={20}
                            color="#166534"
                          />
                        </View>

                        <View style={styles.projectChatCopy}>
                          <Text style={styles.projectChatTitle}>{projectChat.project.title}</Text>
                          <Text style={styles.projectChatMeta}>
                            {projectChat.project.isEvent ? 'Event chat' : 'Project chat'} |{' '}
                            {projectChat.participantCount} participant
                            {projectChat.participantCount === 1 ? '' : 's'}
                          </Text>
                          <Text numberOfLines={2} style={styles.projectChatDescription}>
                            {projectChat.project.description}
                          </Text>
                        </View>

                        <MaterialIcons name="arrow-forward" size={20} color="#64748b" />
                      </TouchableOpacity>
                    ))
                  )}
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={styles.sectionTitle}>Direct conversations</Text>
                      <Text style={styles.sectionDescription}>
                        Keep one-to-one follow-ups clean and easy to track.
                      </Text>
                    </View>
                  </View>

                  {filteredConversations.length === 0 ? (
                    <Text style={styles.emptyInlineText}>No direct conversations match your search.</Text>
                  ) : (
                    filteredConversations.map(item => (
                      <TouchableOpacity
                        key={item.user.id}
                        style={styles.conversationRow}
                        onPress={() => handleSelectUser(item.user)}
                      >
                        <View style={styles.userAvatar}>
                          <Text style={styles.userAvatarText}>{item.user.name.charAt(0)}</Text>
                        </View>

                        <View style={styles.conversationCopy}>
                          <Text style={styles.conversationName}>{item.user.name}</Text>
                          <Text style={styles.conversationRole}>{formatRoleLabel(item.user)}</Text>
                          {item.lastMessage ? (
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.conversationPreview,
                                item.unreadCount > 0 && styles.conversationPreviewUnread,
                              ]}
                            >
                              {getMessagePreview(item.lastMessage)}
                            </Text>
                          ) : null}
                        </View>

                        <View style={styles.conversationRight}>
                          {item.lastMessage ? (
                            <Text style={styles.conversationTime}>
                              {formatMessageTime(item.lastMessage.timestamp)}
                            </Text>
                          ) : null}
                          {item.unreadCount > 0 ? (
                            <View style={styles.unreadBadge}>
                              <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                            </View>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              </View>

              <View style={styles.secondaryColumn}>
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={styles.sectionTitle}>Start a new chat</Text>
                      <Text style={styles.sectionDescription}>
                        Reach out to other people in the system without leaving the hub.
                      </Text>
                    </View>
                  </View>

                  {filteredSuggestedUsers.length === 0 ? (
                    <Text style={styles.emptyInlineText}>No new users match your search.</Text>
                  ) : (
                    filteredSuggestedUsers.map(chatUser => (
                      <TouchableOpacity
                        key={chatUser.id}
                        style={styles.userCard}
                        onPress={() => handleSelectUser(chatUser)}
                      >
                        <View style={styles.userInfo}>
                          <View style={styles.userAvatarMuted}>
                            <Text style={styles.userAvatarTextMuted}>{chatUser.name.charAt(0)}</Text>
                          </View>
                          <View style={styles.userCopy}>
                            <Text style={styles.userName}>{chatUser.name}</Text>
                            <Text style={styles.userRole}>{formatRoleLabel(chatUser)}</Text>
                          </View>
                        </View>
                        <MaterialIcons name="arrow-forward" size={18} color="#166534" />
                      </TouchableOpacity>
                    ))
                  )}
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={styles.sectionTitle}>Hub tips</Text>
                      <Text style={styles.sectionDescription}>
                        Keep project coordination clear for admins, partners, and volunteers.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.tipCard}>
                    <MaterialIcons name="campaign" size={18} color="#166534" />
                    <Text style={styles.tipText}>
                      Admin and partner users can post structured needs cards inside project group chats.
                    </Text>
                  </View>
                  <View style={styles.tipCard}>
                    <MaterialIcons name="forum" size={18} color="#166534" />
                    <Text style={styles.tipText}>
                      Use direct conversations for approvals and private follow-ups, then move shared needs back into the group.
                    </Text>
                  </View>
                  <View style={styles.tipCard}>
                    <MaterialIcons name="photo-library" size={18} color="#166534" />
                    <Text style={styles.tipText}>
                      Attach a photo when a request needs reference material, stock levels, or field context.
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f7f2',
  },
  centeredShell: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 1280,
  },
  listScroll: {
    flex: 1,
  },
  listScrollContent: {
    padding: 20,
  },
  listShell: {
    width: '100%',
    gap: 20,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    padding: 24,
    gap: 20,
    borderWidth: 1,
    borderColor: '#dbe7d5',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  heroCopy: {
    gap: 8,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#0f766e',
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0f172a',
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#475569',
    maxWidth: 760,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  metricsRowStacked: {
    flexDirection: 'column',
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 22,
    padding: 18,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#cde8ce',
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#166534',
  },
  metricValue: {
    marginTop: 10,
    fontSize: 30,
    fontWeight: '800',
    color: '#0f172a',
  },
  metricHint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d6e2db',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
  },
  inlineErrorWrap: {
    width: '100%',
  },
  sectionsGrid: {
    gap: 20,
  },
  sectionsGridWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  primaryColumn: {
    flex: 1.3,
    gap: 20,
    minWidth: 0,
  },
  secondaryColumn: {
    flex: 0.9,
    gap: 20,
    minWidth: 0,
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 26,
    padding: 22,
    gap: 16,
    borderWidth: 1,
    borderColor: '#dbe7d5',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  sectionHeader: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
  projectChatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#d7ead8',
  },
  projectChatIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectChatCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  projectChatTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  projectChatMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  projectChatDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5efe4',
  },
  conversationCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  conversationName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  conversationRole: {
    fontSize: 12,
    color: '#64748b',
  },
  conversationPreview: {
    fontSize: 13,
    color: '#64748b',
  },
  conversationPreviewUnread: {
    color: '#0f172a',
    fontWeight: '700',
  },
  conversationRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  conversationTime: {
    fontSize: 11,
    color: '#94a3b8',
  },
  unreadBadge: {
    minWidth: 24,
    paddingHorizontal: 7,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#166534',
  },
  unreadBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5efe4',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  userCopy: {
    flex: 1,
    minWidth: 0,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  userAvatarMuted: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#e2f3e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarTextMuted: {
    fontSize: 17,
    fontWeight: '800',
    color: '#166534',
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  userRole: {
    fontSize: 13,
    color: '#64748b',
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#d7ead8',
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  emptyStateCard: {
    backgroundColor: '#ffffff',
    borderRadius: 26,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#dbe7d5',
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
    textAlign: 'center',
    maxWidth: 520,
  },
  emptyInlineText: {
    fontSize: 14,
    color: '#64748b',
  },
  detailShell: {
    flex: 1,
    padding: 20,
    gap: 16,
  },
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#ffffff',
    borderRadius: 26,
    padding: 20,
    borderWidth: 1,
    borderColor: '#dbe7d5',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  detailHeroCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  detailEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#0f766e',
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
  detailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
  },
  detailBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  messagesScroll: {
    flex: 1,
  },
  messagesContent: {
    paddingBottom: 12,
    gap: 12,
  },
  messageBubble: {
    maxWidth: '86%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  messageBubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d8e7d7',
  },
  messageBubbleOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#166534',
  },
  messageSender: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    marginBottom: 6,
  },
  messageSenderOwn: {
    color: '#dcfce7',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1e293b',
  },
  messageTextOwn: {
    color: '#ffffff',
  },
  messageTime: {
    marginTop: 8,
    fontSize: 10,
    color: '#94a3b8',
    textAlign: 'right',
  },
  messageTimeOwn: {
    color: '#dcfce7',
  },
  messageAttachment: {
    width: 220,
    height: 220,
    borderRadius: 16,
    marginBottom: 10,
    backgroundColor: '#d7e3da',
  },
  needCard: {
    maxWidth: '92%',
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  needCardOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#effcf3',
    borderWidth: 1,
    borderColor: '#c8e9cf',
  },
  needCardOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#134e4a',
  },
  needCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  needHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  needSender: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  needSenderOwn: {
    color: '#a7f3d0',
  },
  needTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  needTitleOwn: {
    color: '#ffffff',
  },
  needPriorityChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  needPriorityText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  needMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  needMetaPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  needMetaPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  needDetails: {
    fontSize: 14,
    lineHeight: 21,
    color: '#1e293b',
  },
  needDetailsOwn: {
    color: '#ecfeff',
  },
  needSupplemental: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  needSupplementalOwn: {
    color: '#ccfbf1',
  },
  needTimestamp: {
    fontSize: 11,
    color: '#64748b',
  },
  needTimestampOwn: {
    color: '#99f6e4',
  },
  composerShell: {
    backgroundColor: '#ffffff',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#dbe7d5',
    padding: 18,
    gap: 14,
  },
  modeToggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modeToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  modeToggleButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  modeToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  modeToggleTextActive: {
    color: '#ffffff',
  },
  needComposerCard: {
    borderRadius: 22,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#d7ead8',
    padding: 16,
    gap: 12,
  },
  needComposerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  needComposerSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  composerInput: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d4ddd7',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
  },
  composerTextArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  dualInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dualInputRowStacked: {
    flexDirection: 'column',
  },
  dualInputField: {
    flex: 1,
  },
  chipGroupLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#166534',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5cf',
  },
  choiceChipActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  choiceChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  choiceChipTextActive: {
    color: '#ffffff',
  },
  attachmentPreviewCard: {
    alignSelf: 'flex-start',
    width: 116,
    height: 116,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#dbe7d5',
  },
  attachmentPreviewImage: {
    width: '100%',
    height: '100%',
  },
  attachmentRemoveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  inputRowStacked: {
    alignItems: 'stretch',
  },
  attachmentButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  messageInput: {
    flex: 1,
    minHeight: 52,
    maxHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d4ddd7',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
  },
  inlineHintBox: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#d7ead8',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inlineHintTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  inlineHintText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: '#166534',
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
});
