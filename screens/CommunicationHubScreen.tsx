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
  Share,
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
  reviewPartnerProjectApplication,
  saveMessage,
  saveProjectGroupMessage,
  subscribeToMessages,
  subscribeToStorageChanges,
} from '../models/storage';
import {
  Message,
  NeedResponseAction,
  PartnerProjectApplication,
  Project,
  ProjectGroupMessage,
  ProjectGroupNeedPost,
  ProjectGroupScopeProposal,
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
const NEED_RESPONSE_ACTIONS: NeedResponseAction[] = [
  'Can Help',
  'Working On It',
  'Delivered',
  'Need More Info',
];

const SCOPE_PROPOSAL_STATUSES = ['Draft', 'Proposed', 'Under Review', 'Approved', 'Rejected'] as const;
const PROPOSAL_REVIEW_FILTERS = ['All', 'Pending', 'Approved', 'Rejected'] as const;

type ConversationItem = {
  user: User;
  lastMessage?: Message;
  unreadCount: number;
};

type ProjectChatItem = {
  project: Project;
  participantCount: number;
};

type ProposalChatItem = {
  application: PartnerProjectApplication;
  projectTitle: string;
  programModule: string;
};

type ProposalReviewFilter = (typeof PROPOSAL_REVIEW_FILTERS)[number];

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

type ScopeProposalDraft = {
  title: string;
  description: string;
  included: string;
  excluded: string;
  timeline: string;
  resources: string;
  successCriteria: string;
  status: 'Draft' | 'Proposed';
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

function getNeedResponsePalette(action: NeedResponseAction) {
  switch (action) {
    case 'Delivered':
      return { backgroundColor: '#dcfce7', textColor: '#166534', icon: 'inventory-2' as const };
    case 'Working On It':
      return { backgroundColor: '#dbeafe', textColor: '#1d4ed8', icon: 'engineering' as const };
    case 'Need More Info':
      return { backgroundColor: '#fef3c7', textColor: '#b45309', icon: 'help-outline' as const };
    default:
      return { backgroundColor: '#ede9fe', textColor: '#6d28d9', icon: 'volunteer-activism' as const };
  }
}

function buildNeedResponseSummary(
  action: NeedResponseAction,
  needTitle: string,
  note: string
): string {
  const trimmedNote = note.trim();
  const baseText =
    action === 'Can Help'
      ? `can help with "${needTitle}".`
      : action === 'Working On It'
      ? `is already working on "${needTitle}".`
      : action === 'Delivered'
      ? `marked "${needTitle}" as delivered.`
      : `needs more information about "${needTitle}".`;

  return trimmedNote ? `${baseText} ${trimmedNote}` : baseText;
}

// Creates the blank draft used by the scope proposal composer.
function createScopeProposalDraft(): ScopeProposalDraft {
  return {
    title: '',
    description: '',
    included: '',
    excluded: '',
    timeline: '',
    resources: '',
    successCriteria: '',
    status: 'Proposed',
  };
}

// Summarizes a scope proposal into plain content for storage.
function buildScopeProposalSummary(draft: ScopeProposalDraft): string {
  return `Project Proposal: ${draft.title.trim()} - Timeline: ${draft.timeline.trim()}`;
}

function buildScopeProposalExport(scopeProposal: ProjectGroupScopeProposal, senderLabel: string): string {
  const lines = [
    'Project Proposal',
    `Title: ${scopeProposal.title}`,
    `Submitted by: ${senderLabel}`,
    `Status: ${scopeProposal.status}`,
    '',
    'Description:',
    scopeProposal.description,
    '',
  ];

  if (scopeProposal.included.length > 0) {
    lines.push('Included:');
    scopeProposal.included.forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  if (scopeProposal.excluded.length > 0) {
    lines.push('Excluded:');
    scopeProposal.excluded.forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  if (scopeProposal.timeline) {
    lines.push(`Timeline: ${scopeProposal.timeline}`);
  }

  if (scopeProposal.resources) {
    lines.push(`Resources: ${scopeProposal.resources}`);
  }

  if (scopeProposal.successCriteria) {
    lines.push('', 'Success Criteria:', scopeProposal.successCriteria);
  }

  if (scopeProposal.approvedBy && scopeProposal.approvedAt) {
    lines.push('', `Approved on: ${formatDateLabel(scopeProposal.approvedAt)}`);
  }

  return lines.join('\n').trim();
}

async function exportScopeProposalFile(scopeProposal: ProjectGroupScopeProposal, senderLabel: string) {
  const content = buildScopeProposalExport(scopeProposal, senderLabel);
  const fileName = `project-proposal-${scopeProposal.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'proposal'}.txt`;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.URL.revokeObjectURL(url);
    return;
  }

  await Share.share({
    title: 'Project Proposal',
    message: content,
  });
}

// Returns the status color palette for scope proposals.
function getScopeProposalStatusPalette(status: string) {
  switch (status) {
    case 'Approved':
      return { backgroundColor: '#dcfce7', textColor: '#166534', icon: 'check-circle' as const };
    case 'Rejected':
      return { backgroundColor: '#fee2e2', textColor: '#b91c1c', icon: 'cancel' as const };
    case 'Under Review':
      return { backgroundColor: '#fef3c7', textColor: '#b45309', icon: 'schedule' as const };
    case 'Proposed':
      return { backgroundColor: '#dbeafe', textColor: '#1d4ed8', icon: 'lightbulb' as const };
    default:
      return { backgroundColor: '#f3f4f6', textColor: '#6b7280', icon: 'edit' as const };
  }
}

function getProposalReviewStatusPalette(status: PartnerProjectApplication['status']) {
  switch (status) {
    case 'Approved':
      return {
        backgroundColor: '#dcfce7',
        textColor: '#166534',
        borderColor: '#86efac',
        icon: 'check-circle' as const,
      };
    case 'Rejected':
      return {
        backgroundColor: '#fee2e2',
        textColor: '#b91c1c',
        borderColor: '#fecaca',
        icon: 'cancel' as const,
      };
    default:
      return {
        backgroundColor: '#ffedd5',
        textColor: '#c2410c',
        borderColor: '#fdba74',
        icon: 'schedule' as const,
      };
  }
}

function sortProposalChatItems(items: ProposalChatItem[]) {
  const statusRank: Record<PartnerProjectApplication['status'], number> = {
    Pending: 0,
    Approved: 1,
    Rejected: 2,
  };

  return [...items].sort((left, right) => {
    const leftRank = statusRank[left.application.status] ?? 99;
    const rightRank = statusRank[right.application.status] ?? 99;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftTime = new Date(left.application.reviewedAt || left.application.requestedAt || 0).getTime();
    const rightTime = new Date(right.application.reviewedAt || right.application.requestedAt || 0).getTime();
    return rightTime - leftTime;
  });
}

// Manages direct messages and project coordination group chats.
export default function CommunicationHubScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 1180;
  const isMedium = width >= 860;
  const isCompactLayout = width < 640;
  const { projectId: requestedProjectId } = route?.params || {};

  const [view, setView] = useState<'conversations' | 'detail'>('conversations');
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [projectChats, setProjectChats] = useState<ProjectChatItem[]>([]);
  const [proposalChats, setProposalChats] = useState<ProposalChatItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedProjectChat, setSelectedProjectChat] = useState<ProjectChatItem | null>(null);
  const [selectedProposalApplication, setSelectedProposalApplication] = useState<PartnerProjectApplication | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [proposalStatusFilter, setProposalStatusFilter] = useState<ProposalReviewFilter>('Pending');
  const [selectedAttachmentUri, setSelectedAttachmentUri] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<'message' | 'need-post' | 'scope-proposal'>('message');
  const [needDraft, setNeedDraft] = useState<NeedPostDraft>(createNeedPostDraft);
  const [selectedNeedMessageId, setSelectedNeedMessageId] = useState<string | null>(null);
  const [selectedNeedResponseAction, setSelectedNeedResponseAction] = useState<NeedResponseAction>('Can Help');
  const [scopeProposalDraft, setScopeProposalDraft] = useState<ScopeProposalDraft>(createScopeProposalDraft);
  const [selectedScopeProposalId, setSelectedScopeProposalId] = useState<string | null>(null);
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
    setScopeProposalDraft(createScopeProposalDraft());
    setSelectedNeedMessageId(null);
    setSelectedNeedResponseAction('Can Help');
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
      setProposalChats([]);
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

        const nextProposalChats = sortProposalChatItems(
          snapshot.partnerApplications.map(application => ({
            application,
            projectTitle: application.proposalDetails?.targetProjectTitle || 'Program proposal',
            programModule: String(application.proposalDetails?.requestedProgramModule || application.projectId || 'Program'),
          }))
        );

        setProjectChats(nextProjectChats);
        setProposalChats(nextProposalChats);
        setSelectedProposalApplication(currentSelection => {
          if (!currentSelection) {
            return currentSelection;
          }

          return nextProposalChats.find(item => item.application.id === currentSelection.id)?.application || null;
        });
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
        setProposalChats([]);
        setLoadError(null);
        lastLoadAlertMessageRef.current = null;
        return;
      }

      const joinedProjectIds = new Set<string>(
        snapshot.volunteerJoinRecords
          .filter(record => snapshot.projects.some(project => project.id === record.projectId && project.isEvent))
          .map(record => record.projectId)
      );

      for (const project of snapshot.projects) {
        if (!project.isEvent) {
          continue;
        }

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
      setProposalChats([]);
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

    if (selectedProposalApplication) {
      setMessages([]);
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

      if (view === 'detail' && (selectedUser || selectedProjectChat || selectedProposalApplication)) {
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
    if (view === 'detail' && (selectedUser || selectedProjectChat || selectedProposalApplication)) {
      void loadSelectedMessages();
    }
  }, [selectedProjectChat, selectedUser, selectedProposalApplication, user?.id, view]);

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

  useEffect(() => {
    if (user?.role === 'admin' || !selectedProposalApplication) {
      return;
    }

    setSelectedProposalApplication(null);
    if (!selectedUser && !selectedProjectChat) {
      setView('conversations');
    }
  }, [selectedProjectChat, selectedProposalApplication, selectedUser, user?.role]);

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

  const handleReplyToNeed = useCallback(
    (needMessage: ProjectGroupMessage, action: NeedResponseAction = 'Can Help') => {
      setComposerMode('message');
      setSelectedNeedMessageId(needMessage.id);
      setSelectedNeedResponseAction(action);
      setMessageText('');
    },
    []
  );

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

      if (composerMode === 'scope-proposal') {
        if (!selectedProjectChat) {
          return;
        }

        // Only admins and partners can post scope proposals
        if (!['admin', 'partner'].includes(user.role)) {
          Alert.alert('Permission Denied', 'Only admins and partners can post scope proposals.');
          return;
        }

        const title = scopeProposalDraft.title.trim();
        const description = scopeProposalDraft.description.trim();
        const included = scopeProposalDraft.included.trim();
        const excluded = scopeProposalDraft.excluded.trim();
        const timeline = scopeProposalDraft.timeline.trim();
        const resources = scopeProposalDraft.resources.trim();
        const successCriteria = scopeProposalDraft.successCriteria.trim();

        if (!title || !description) {
          Alert.alert('Scope details required', 'Add a title and description before posting this proposal.');
          return;
        }

        const scopeProposal: ProjectGroupScopeProposal = {
          title,
          description,
          included: included ? included.split('\n').filter(d => d.trim()) : [],
          excluded: excluded ? excluded.split('\n').filter(d => d.trim()) : [],
          timeline,
          resources,
          successCriteria,
          proposedByRole: user.role as 'admin' | 'partner',
          proposedById: user.id,
          status: scopeProposalDraft.status as 'Draft' | 'Proposed',
        };

        const newMessage: ProjectGroupMessage = {
          id: createMessageId(),
          projectId: selectedProjectChat.project.id,
          senderId: user.id,
          content: buildScopeProposalSummary(scopeProposalDraft),
          timestamp: new Date().toISOString(),
          kind: 'scope-proposal',
          scopeProposal,
          attachments: selectedAttachmentUri ? [selectedAttachmentUri] : undefined,
        };

        setMessages(current => upsertChatMessage(current, newMessage));
        await saveProjectGroupMessage(newMessage);
        resetComposer();
        return;
      }

      if (composerMode === 'need-post') {
        if (!selectedProjectChat) {
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

      if (selectedNeedMessage) {
        const linkedNeed = selectedNeedMessage.needPost;
        if (!linkedNeed) {
          Alert.alert('Need unavailable', 'This need no longer exists in the planning chat.');
          setSelectedNeedMessageId(null);
          return;
        }

        const newMessage: ProjectGroupMessage = {
          id: createMessageId(),
          projectId: selectedProjectChat.project.id,
          senderId: user.id,
          content: buildNeedResponseSummary(
            selectedNeedResponseAction,
            linkedNeed.title,
            messageText
          ),
          timestamp: new Date().toISOString(),
          kind: 'need-response',
          responseToMessageId: selectedNeedMessage.id,
          responseAction: selectedNeedResponseAction,
          responseToTitle: linkedNeed.title,
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
    setSelectedProposalApplication(null);
    setMessages([]);
    resetComposer();
    setView('detail');
  };

  // Opens the selected project or event group chat.
  const handleSelectProjectChat = (projectChat: ProjectChatItem) => {
    setSelectedProjectChat(projectChat);
    setSelectedUser(null);
    setSelectedProposalApplication(null);
    setMessages([]);
    resetComposer();
    setView('detail');
  };

  const handleSelectProposalApplication = (application: PartnerProjectApplication) => {
    if (user?.role !== 'admin') {
      return;
    }

    setSelectedProposalApplication(application);
    setSelectedUser(null);
    setSelectedProjectChat(null);
    setMessages([]);
    resetComposer();
    setView('detail');
  };

  const getProposalPartnerUser = (application: PartnerProjectApplication): User | undefined => {
    return allUsersRef.current.find(chatUser => chatUser.id === application.partnerUserId);
  };

  const handleReviewPartnerProposal = async (
    application: PartnerProjectApplication,
    nextStatus: 'Approved' | 'Rejected'
  ) => {
    if (!user?.id || user.role !== 'admin') {
      return;
    }

    try {
      await reviewPartnerProjectApplication(application.id, nextStatus, user.id);
      const reviewedAt = new Date().toISOString();
      Alert.alert(
        nextStatus === 'Approved' ? 'Proposal Approved' : 'Proposal Rejected',
        nextStatus === 'Approved'
          ? 'The partner proposal has been updated and the partner will be notified.'
          : 'The partner proposal has been rejected. The partner will be notified.'
      );
      setSelectedProposalApplication(prev =>
        prev && prev.id === application.id
          ? { ...prev, status: nextStatus, reviewedBy: user.id, reviewedAt }
          : prev
      );
      setProposalChats(current =>
        sortProposalChatItems(
          current.map(item =>
            item.application.id === application.id
              ? {
                  ...item,
                  application: {
                    ...item.application,
                    status: nextStatus,
                    reviewedBy: user.id,
                    reviewedAt,
                  },
                }
              : item
          )
        )
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update the partner proposal.')
      );
    }
  };

  // Resolves the sender name shown above each group chat message.
  const getSenderLabel = (senderId: string) => {
    if (senderId === user?.id) {
      return 'You';
    }

    return allUsersRef.current.find(chatUser => chatUser.id === senderId)?.name || 'Community member';
  };

  const detailCanPostNeeds = Boolean(selectedProjectChat);
  const showComposer = Boolean(selectedUser || selectedProjectChat);

  const selectedChatTitle =
    selectedUser?.name ||
    selectedProjectChat?.project.title ||
    selectedProposalApplication?.proposalDetails?.proposedTitle ||
    '';
  const selectedChatSubtitle = selectedUser
    ? formatRoleLabel(selectedUser)
    : selectedProjectChat
    ? `${selectedProjectChat.project.isEvent ? 'Event' : 'Project'} coordination space with ${selectedProjectChat.participantCount} participant${
        selectedProjectChat.participantCount === 1 ? '' : 's'
      }`
    : selectedProposalApplication
    ? `Proposal from ${selectedProposalApplication.partnerName} - ${selectedProposalApplication.status}`
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

  const filteredProposalChats = useMemo(() => {
    if (user?.role !== 'admin') {
      return [];
    }

    const query = searchText.trim().toLowerCase();
    return proposalChats.filter(chat => {
      if (proposalStatusFilter !== 'All' && chat.application.status !== proposalStatusFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const proposalTitle = String(chat.application.proposalDetails?.proposedTitle || '').toLowerCase();
      const partnerName = chat.application.partnerName.toLowerCase();
      const programModule = chat.programModule.toLowerCase();
      const status = chat.application.status.toLowerCase();
      const summary = String(
        chat.application.proposalDetails?.communityNeed ||
          chat.application.proposalDetails?.proposedDescription ||
          ''
      ).toLowerCase();

      return (
        chat.projectTitle.toLowerCase().includes(query) ||
        proposalTitle.includes(query) ||
        partnerName.includes(query) ||
        programModule.includes(query) ||
        status.includes(query) ||
        summary.includes(query)
      );
    });
  }, [proposalChats, proposalStatusFilter, searchText, user?.role]);

  const proposalStatusCounts = useMemo(
    () => ({
      All: proposalChats.length,
      Pending: proposalChats.filter(chat => chat.application.status === 'Pending').length,
      Approved: proposalChats.filter(chat => chat.application.status === 'Approved').length,
      Rejected: proposalChats.filter(chat => chat.application.status === 'Rejected').length,
    }),
    [proposalChats]
  );

  const projectChatSectionTitle =
    user?.role === 'admin'
      ? 'Project coordination spaces'
      : user?.role === 'partner'
      ? 'Partner coordination spaces'
      : 'Joined event group chats';

  const projectChatSubtitle =
    user?.role === 'admin'
      ? 'Monitor every project and event conversation from one place.'
      : user?.role === 'partner'
      ? 'Coordinate approved projects with admin and volunteers, then manage needs in one planning group chat.'
      : 'Stay updated with the events you joined, post needs, and coordinate with your team.';

  const renderProposalFilterChips = () => (
    <View style={styles.proposalFilterRow}>
      {PROPOSAL_REVIEW_FILTERS.map(filterValue => {
        const isActive = proposalStatusFilter === filterValue;
        return (
          <TouchableOpacity
            key={filterValue}
            style={[styles.proposalFilterChip, isActive && styles.proposalFilterChipActive]}
            onPress={() => setProposalStatusFilter(filterValue)}
          >
            <Text style={[styles.proposalFilterChipText, isActive && styles.proposalFilterChipTextActive]}>
              {filterValue} ({proposalStatusCounts[filterValue]})
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const needPosts = useMemo(
    () =>
      selectedProjectChat
        ? messages.filter(
            message => (message as ProjectGroupMessage).kind === 'need-post'
          ) as ProjectGroupMessage[]
        : [],
    [messages, selectedProjectChat]
  );

  const needResponses = useMemo(
    () =>
      selectedProjectChat
        ? messages.filter(
            message => (message as ProjectGroupMessage).kind === 'need-response'
          ) as ProjectGroupMessage[]
        : [],
    [messages, selectedProjectChat]
  );

  const responsesByNeedId = useMemo(() => {
    const map = new Map<string, ProjectGroupMessage[]>();

    needResponses.forEach(message => {
      const needId = message.responseToMessageId;
      if (!needId) {
        return;
      }

      const current = map.get(needId) || [];
      current.push(message);
      map.set(needId, current);
    });

    return map;
  }, [needResponses]);

  const activeNeedPosts = useMemo(
    () =>
      [...needPosts].sort(
        (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
      ),
    [needPosts]
  );

  const planningMetrics = useMemo(() => {
    const open = activeNeedPosts.filter(message => message.needPost?.status === 'Open').length;
    const inProgress = activeNeedPosts.filter(message => message.needPost?.status === 'In Progress').length;
    const fulfilled = activeNeedPosts.filter(message => message.needPost?.status === 'Fulfilled').length;

    return { open, inProgress, fulfilled };
  }, [activeNeedPosts]);

  const selectedNeedMessage = useMemo(
    () => activeNeedPosts.find(message => message.id === selectedNeedMessageId) || null,
    [activeNeedPosts, selectedNeedMessageId]
  );
  const isVolunteerCompact = user?.role === 'volunteer' && !isMedium;
  const compactMetricCards = [
    {
      label: 'Joined chats',
      value: projectChats.length,
      hint: 'Your event spaces',
    },
    {
      label: 'Unread',
      value: totalUnreadCount,
      hint: 'Messages to review',
    },
  ];
  const fullMetricCards = [
    {
      label: 'Project Chats',
      value: projectChats.length,
      hint: 'Shared coordination spaces',
    },
    {
      label: 'Unread',
      value: totalUnreadCount,
      hint: 'Direct messages awaiting review',
    },
    {
      label: 'Reachable Users',
      value: allUsers.length,
      hint: 'Admins, partners, and volunteers',
    },
  ];

  const showEmptyState =
    filteredProjectChats.length === 0 &&
    filteredConversations.length === 0 &&
    filteredSuggestedUsers.length === 0 &&
    filteredProposalChats.length === 0;

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

  if (view === 'detail' && (selectedUser || selectedProjectChat || selectedProposalApplication)) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <View
          style={[
            styles.detailShell,
            isWide && styles.detailShellWide,
            isCompactLayout && styles.detailShellCompact,
            isWide && styles.centeredShell,
          ]}
        >
          <View style={[styles.detailSidebar, isVolunteerCompact && styles.detailSidebarCompact]}>
            <Text style={styles.sidebarGroupLabel}>Planning Threads</Text>
            <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                  {user.role === 'admin' ? 'Project rooms' : 'Shared rooms'}
                </Text>
                <Text style={styles.sectionDescription}>
                  Open the right planning space from one left rail.
                </Text>
              </View>

              {filteredProjectChats.length === 0 ? (
                <Text style={styles.emptyInlineText}>No project chats found.</Text>
              ) : (
                filteredProjectChats.map(projectChat => (
                  <TouchableOpacity
                    key={projectChat.project.id}
                    style={[
                      styles.projectChatCard,
                      isVolunteerCompact && styles.projectChatCardCompact,
                      selectedProjectChat?.project.id === projectChat.project.id && styles.projectChatCardSelected,
                    ]}
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
                      <Text style={styles.projectChatMeta} numberOfLines={1}>
                        {projectChat.project.isEvent ? 'Event chat' : 'Project chat'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>

            {user?.role === 'admin' ? (
              <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                    Partner proposal inbox
                  </Text>
                  <Text style={styles.sectionDescription}>
                    All partner project proposals land here so admins can approve, reject, and follow up in one place.
                  </Text>
                </View>

                {renderProposalFilterChips()}

                {filteredProposalChats.length === 0 ? (
                  <Text style={styles.emptyInlineText}>No proposals match this filter right now.</Text>
                ) : (
                  filteredProposalChats.map(chat => (
                    (() => {
                      const statusPalette = getProposalReviewStatusPalette(chat.application.status);
                      return (
                        <TouchableOpacity
                          key={chat.application.id}
                          style={[
                            styles.projectChatCard,
                            isVolunteerCompact && styles.projectChatCardCompact,
                            selectedProposalApplication?.id === chat.application.id &&
                              styles.projectChatCardSelected,
                          ]}
                          onPress={() => handleSelectProposalApplication(chat.application)}
                        >
                          <View style={styles.projectChatIcon}>
                            <MaterialIcons name="campaign" size={20} color="#166534" />
                          </View>
                          <View style={styles.projectChatCopy}>
                            <View style={styles.proposalListTitleRow}>
                              <Text style={styles.projectChatTitle}>
                                {chat.application.proposalDetails?.proposedTitle || chat.projectTitle}
                              </Text>
                              <View
                                style={[
                                  styles.proposalListStatusBadge,
                                  {
                                    backgroundColor: statusPalette.backgroundColor,
                                    borderColor: statusPalette.borderColor,
                                  },
                                ]}
                              >
                                <MaterialIcons name={statusPalette.icon} size={12} color={statusPalette.textColor} />
                                <Text style={[styles.proposalListStatusText, { color: statusPalette.textColor }]}>
                                  {chat.application.status}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.projectChatMeta} numberOfLines={1}>
                              {chat.application.partnerName} - {chat.programModule}
                            </Text>
                            <Text style={styles.projectChatMetaMuted} numberOfLines={1}>
                              Submitted {formatDateLabel(chat.application.requestedAt)}
                            </Text>
                            <Text style={styles.projectChatDescription} numberOfLines={2}>
                              {chat.application.proposalDetails?.communityNeed ||
                                chat.application.proposalDetails?.proposedDescription ||
                                'Pending partner project proposal.'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })()
                  ))
                )}
              </View>
            ) : null}

            <Text style={styles.sidebarGroupLabel}>General</Text>
            <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                  Direct conversations
                </Text>
                <Text style={styles.sectionDescription}>
                  Reach a partner, volunteer, or admin directly.
                </Text>
              </View>

              {filteredConversations.length === 0 ? (
                <Text style={styles.emptyInlineText}>No direct messages found.</Text>
              ) : (
                filteredConversations.map(item => (
                  <TouchableOpacity
                    key={item.user.id}
                    style={[
                      styles.projectChatCard,
                      isVolunteerCompact && styles.projectChatCardCompact,
                      selectedUser?.id === item.user.id && styles.projectChatCardSelected,
                    ]}
                    onPress={() => handleSelectUser(item.user)}
                  >
                    <View style={styles.projectChatIcon}>
                      <Text style={styles.userAvatarText}>{item.user.name.charAt(0)}</Text>
                    </View>
                    <View style={styles.projectChatCopy}>
                      <Text style={styles.projectChatTitle}>{item.user.name}</Text>
                      <Text style={styles.projectChatMeta} numberOfLines={1}>
                        {formatRoleLabel(item.user)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </View>

          <View style={styles.detailMain}>
            <View style={[styles.detailHero, isVolunteerCompact && styles.detailHeroCompact]}>
              <TouchableOpacity
                onPress={() => {
                  setView('conversations');
                  setSelectedUser(null);
                  setSelectedProjectChat(null);
                  setSelectedProposalApplication(null);
                  setMessages([]);
                  resetComposer();
                }}
                style={styles.backButton}
              >
                <MaterialIcons name="arrow-back" size={22} color="#0f172a" />
              </TouchableOpacity>

              <View style={[styles.detailHeroCopy, isVolunteerCompact && styles.detailHeroCopyCompact]}>
                <Text style={styles.detailEyebrow}>
                  {selectedProjectChat ? 'Project group chat' : selectedProposalApplication ? 'Partner proposal review' : 'Direct conversation'}
                </Text>
                <Text style={[styles.detailTitle, isVolunteerCompact && styles.detailTitleCompact]}>
                  {selectedChatTitle}
                </Text>
                <Text style={[styles.detailSubtitle, isVolunteerCompact && styles.detailSubtitleCompact]}>
                  {selectedChatSubtitle}
                </Text>
              </View>

              {selectedProjectChat ? (
                <View style={[styles.detailBadge, isVolunteerCompact && styles.detailBadgeCompact]}>
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
              contentContainerStyle={[
                styles.messagesContent,
                isCompactLayout && styles.messagesContentCompact,
              ]}
              showsVerticalScrollIndicator={false}
            >
              {selectedProjectChat ? (
              <View style={[styles.planningBoardCard, isVolunteerCompact && styles.planningBoardCardCompact]}>
                <View style={styles.planningBoardHeader}>
                  <View style={styles.planningBoardCopy}>
                    <Text style={styles.planningBoardTitle}>Planning Board</Text>
                    <Text style={styles.planningBoardSubtitle}>
                      Track open needs and respond without leaving the group chat.
                    </Text>
                  </View>
                  <View style={styles.planningBoardBadge}>
                    <MaterialIcons name="device-hub" size={16} color="#166534" />
                    <Text style={styles.planningBoardBadgeText}>Shared with all joined users</Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.planningMetricsRow,
                    (!isMedium || isVolunteerCompact) && styles.metricsRowStacked,
                  ]}
                >
                  <View style={[styles.planningMetricCard, isVolunteerCompact && styles.planningMetricCardCompact]}>
                    <Text style={styles.planningMetricValue}>{planningMetrics.open}</Text>
                    <Text style={styles.planningMetricLabel}>Open</Text>
                  </View>
                  <View style={[styles.planningMetricCard, isVolunteerCompact && styles.planningMetricCardCompact]}>
                    <Text style={styles.planningMetricValue}>{planningMetrics.inProgress}</Text>
                    <Text style={styles.planningMetricLabel}>In Progress</Text>
                  </View>
                  <View style={[styles.planningMetricCard, isVolunteerCompact && styles.planningMetricCardCompact]}>
                    <Text style={styles.planningMetricValue}>{planningMetrics.fulfilled}</Text>
                    <Text style={styles.planningMetricLabel}>Fulfilled</Text>
                  </View>
                </View>

                {activeNeedPosts.length ? (
                  <View style={styles.planningNeedList}>
                    {activeNeedPosts.slice(0, 3).map(needMessage => {
                      const linkedNeed = needMessage.needPost;
                      if (!linkedNeed) {
                        return null;
                      }

                      const responseCount = responsesByNeedId.get(needMessage.id)?.length || 0;
                      const selected = selectedNeedMessageId === needMessage.id;

                      return (
                        <TouchableOpacity
                          key={`planning-${needMessage.id}`}
                          style={[styles.planningNeedCard, selected && styles.planningNeedCardActive]}
                          activeOpacity={0.9}
                          onPress={() => handleReplyToNeed(needMessage)}
                        >
                          <View style={styles.planningNeedTopRow}>
                            <Text style={styles.planningNeedTitle} numberOfLines={1}>
                              {linkedNeed.title}
                            </Text>
                            <Text style={styles.planningNeedStatus}>{linkedNeed.status}</Text>
                          </View>
                          <Text style={styles.planningNeedMeta}>
                            {linkedNeed.category} • {linkedNeed.priority} priority
                          </Text>
                          <Text style={styles.planningNeedSummary} numberOfLines={2}>
                            {linkedNeed.details}
                          </Text>
                          <View style={styles.planningNeedFooter}>
                            <Text style={styles.planningNeedResponses}>
                              {responseCount} response{responseCount === 1 ? '' : 's'}
                            </Text>
                            <Text style={styles.planningNeedAction}>
                              {selected ? 'Ready to reply' : 'Tap to respond'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.planningEmptyText}>
                    No planning needs have been posted yet. Start one from the composer below.
                  </Text>
                )}
              </View>
            ) : null}

            {selectedProposalApplication ? (
              (() => {
                const statusPalette = getProposalReviewStatusPalette(selectedProposalApplication.status);
                return (
              <View style={styles.proposalReviewCard}>
                <View style={styles.proposalReviewIntroBubble}>
                  <Text style={styles.proposalReviewIntroSender}>
                    {selectedProposalApplication.partnerName}
                  </Text>
                  <Text style={styles.proposalReviewIntroText}>
                    Submitted a project proposal into the admin-only Communication Hub review inbox.
                  </Text>
                </View>

                <View style={styles.proposalReviewHeader}>
                  <View style={[styles.proposalReviewHeaderIcon, { backgroundColor: statusPalette.textColor }]}>
                    <MaterialIcons name="campaign" size={20} color="#ffffff" />
                  </View>
                  <View style={styles.proposalReviewHeaderCopy}>
                    <Text style={styles.proposalReviewTitle}>
                      {selectedProposalApplication.proposalDetails?.proposedTitle || 'Partner proposal'}
                    </Text>
                    <Text style={styles.proposalReviewSubtitle}>
                      Review the proposed project details, align on scope, and decide whether to approve or reject.
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.proposalStatusBadge,
                      {
                        backgroundColor: statusPalette.backgroundColor,
                        borderColor: statusPalette.borderColor,
                      },
                    ]}
                  >
                    <MaterialIcons name={statusPalette.icon} size={14} color={statusPalette.textColor} />
                    <Text style={[styles.proposalStatusBadgeText, { color: statusPalette.textColor }]}>
                      {selectedProposalApplication.status}
                    </Text>
                  </View>
                </View>

                <View style={styles.proposalReviewMetaRow}>
                  <View style={styles.proposalReviewMetaPill}>
                    <Text style={styles.proposalReviewMetaLabel}>Submitted by</Text>
                    <Text style={styles.proposalReviewMetaValue}>
                      {selectedProposalApplication.partnerName}
                    </Text>
                  </View>
                  <View style={styles.proposalReviewMetaPill}>
                    <Text style={styles.proposalReviewMetaLabel}>Program</Text>
                    <Text style={styles.proposalReviewMetaValue}>
                      {selectedProposalApplication.proposalDetails?.requestedProgramModule || 'Program'}
                    </Text>
                  </View>
                  <View style={styles.proposalReviewMetaPill}>
                    <Text style={styles.proposalReviewMetaLabel}>Volunteers needed</Text>
                    <Text style={styles.proposalReviewMetaValue}>
                      {selectedProposalApplication.proposalDetails?.proposedVolunteersNeeded ?? 0}
                    </Text>
                  </View>
                  <View style={styles.proposalReviewMetaPill}>
                    <Text style={styles.proposalReviewMetaLabel}>Submitted</Text>
                    <Text style={styles.proposalReviewMetaValue}>
                      {formatDateLabel(selectedProposalApplication.requestedAt)}
                    </Text>
                  </View>
                  {selectedProposalApplication.reviewedAt ? (
                    <View style={styles.proposalReviewMetaPill}>
                      <Text style={styles.proposalReviewMetaLabel}>Reviewed</Text>
                      <Text style={styles.proposalReviewMetaValue}>
                        {formatDateLabel(selectedProposalApplication.reviewedAt)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.proposalReviewSection}>
                  <Text style={styles.proposalReviewLabel}>Proposal description</Text>
                  <Text style={styles.proposalReviewValue}>
                    {selectedProposalApplication.proposalDetails?.proposedDescription}
                  </Text>
                </View>

                <View style={styles.proposalReviewSectionGrid}>
                  <View style={styles.proposalReviewColumn}>
                    <Text style={styles.proposalReviewLabel}>Start date</Text>
                    <Text style={styles.proposalReviewValue}>
                      {formatDateLabel(selectedProposalApplication.proposalDetails?.proposedStartDate)}
                    </Text>
                  </View>
                  <View style={styles.proposalReviewColumn}>
                    <Text style={styles.proposalReviewLabel}>End date</Text>
                    <Text style={styles.proposalReviewValue}>
                      {formatDateLabel(selectedProposalApplication.proposalDetails?.proposedEndDate)}
                    </Text>
                  </View>
                </View>

                <View style={styles.proposalReviewSection}>
                  <Text style={styles.proposalReviewLabel}>Location</Text>
                  <Text style={styles.proposalReviewValue}>
                    {selectedProposalApplication.proposalDetails?.proposedLocation}
                  </Text>
                </View>

                <View style={styles.proposalReviewSection}>
                  <Text style={styles.proposalReviewLabel}>Community need</Text>
                  <Text style={styles.proposalReviewValue}>
                    {selectedProposalApplication.proposalDetails?.communityNeed}
                  </Text>
                </View>

                <View style={styles.proposalReviewSection}>
                  <Text style={styles.proposalReviewLabel}>Expected deliverables</Text>
                  <Text style={styles.proposalReviewValue}>
                    {selectedProposalApplication.proposalDetails?.expectedDeliverables}
                  </Text>
                </View>

                {getProposalPartnerUser(selectedProposalApplication) ? (
                  <TouchableOpacity
                    style={styles.proposalReviewActionButton}
                    onPress={() => handleSelectUser(getProposalPartnerUser(selectedProposalApplication)!)}
                  >
                    <MaterialIcons name="message" size={16} color="#fff" />
                    <Text style={styles.proposalReviewActionText}>Message partner</Text>
                  </TouchableOpacity>
                ) : null}

                {selectedProposalApplication.status === 'Pending' ? (
                  <View style={styles.proposalReviewActions}>
                    <TouchableOpacity
                      style={[styles.approveButton, styles.proposalActionButton]}
                      onPress={() => void handleReviewPartnerProposal(selectedProposalApplication, 'Approved')}
                    >
                      <MaterialIcons name="check-circle" size={16} color="#ffffff" />
                      <Text style={styles.approveButtonText}>Approve proposal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.proposalRejectButton, styles.proposalActionButton]}
                      onPress={() => void handleReviewPartnerProposal(selectedProposalApplication, 'Rejected')}
                    >
                      <MaterialIcons name="cancel" size={16} color="#991b1b" />
                      <Text style={styles.proposalRejectButtonText}>Reject proposal</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.proposalReviewOutcome,
                      {
                        backgroundColor: statusPalette.backgroundColor,
                        borderColor: statusPalette.borderColor,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name={statusPalette.icon}
                      size={18}
                      color={statusPalette.textColor}
                    />
                    <Text style={[styles.proposalReviewOutcomeText, { color: statusPalette.textColor }]}>
                      {selectedProposalApplication.status === 'Approved'
                        ? 'This proposal has been approved and moved forward for project creation.'
                        : 'This proposal has been rejected and kept out of the shared project spaces.'}
                    </Text>
                  </View>
                )}
              </View>
                );
              })()
            ) : null}

            {!selectedProposalApplication ? (
              messages.length === 0 ? (
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
                      ? 'Start with a quick update, post a planning need, or respond to one already in the board.'
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
                const scopeProposal = groupMessage?.kind === 'scope-proposal' ? groupMessage.scopeProposal : undefined;
                const linkedResponses = groupMessage ? responsesByNeedId.get(groupMessage.id) || [] : [];
                const responseTargetNeed =
                  groupMessage?.kind === 'need-response' && groupMessage.responseToMessageId
                    ? needPosts.find(needMessage => needMessage.id === groupMessage.responseToMessageId)?.needPost
                    : null;

                if (selectedProjectChat && needPost) {
                  const priorityPalette = getPriorityPalette(needPost.priority);
                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.needCard,
                        isCompactLayout && styles.needCardCompact,
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
                            {needPost.requestedByRole === 'admin'
                              ? 'Admin request'
                              : needPost.requestedByRole === 'partner'
                              ? 'Partner request'
                              : 'Volunteer request'}
                          </Text>
                        </View>
                        {linkedResponses.length ? (
                          <View style={styles.needMetaPill}>
                            <Text style={styles.needMetaPillText}>
                              {linkedResponses.length} response{linkedResponses.length === 1 ? '' : 's'}
                            </Text>
                          </View>
                        ) : null}
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

                      {linkedResponses.length ? (
                        <View style={styles.needResponsePreviewWrap}>
                          {linkedResponses.slice(0, 3).map(responseMessage => {
                            const action = responseMessage.responseAction || 'Can Help';
                            const palette = getNeedResponsePalette(action);
                            return (
                              <View key={responseMessage.id} style={styles.needResponsePreviewRow}>
                                <View
                                  style={[
                                    styles.needResponsePreviewChip,
                                    { backgroundColor: palette.backgroundColor },
                                  ]}
                                >
                                  <MaterialIcons name={palette.icon} size={12} color={palette.textColor} />
                                  <Text
                                    style={[
                                      styles.needResponsePreviewChipText,
                                      { color: palette.textColor },
                                    ]}
                                  >
                                    {action}
                                  </Text>
                                </View>
                                <Text
                                  numberOfLines={1}
                                  style={[styles.needResponsePreviewText, isOwnMessage && styles.needResponsePreviewTextOwn]}
                                >
                                  {getSenderLabel(responseMessage.senderId)}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      ) : null}

                      <View style={styles.needActionRow}>
                        {NEED_RESPONSE_ACTIONS.map(action => {
                          const palette = getNeedResponsePalette(action);
                          const actionSelected =
                            selectedNeedMessageId === message.id && selectedNeedResponseAction === action;

                          return (
                            <TouchableOpacity
                              key={`${message.id}-${action}`}
                              style={[
                                styles.needActionChip,
                                { backgroundColor: actionSelected ? palette.backgroundColor : '#ffffff' },
                              ]}
                              onPress={() => {
                                handleReplyToNeed(message as ProjectGroupMessage, action);
                              }}
                            >
                              <MaterialIcons name={palette.icon} size={13} color={palette.textColor} />
                              <Text style={[styles.needActionChipText, { color: palette.textColor }]}>
                                {action}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <Text style={[styles.needTimestamp, isOwnMessage && styles.needTimestampOwn]}>
                        {formatMessageTime(message.timestamp)}
                      </Text>
                    </View>
                  );
                }

                if (selectedProjectChat && scopeProposal) {
                  if (user?.role === 'volunteer') {
                    return null;
                  }

                  const statusPalette = getScopeProposalStatusPalette(scopeProposal.status);
                  const isAdmin = user?.role === 'admin';
                  const isProposer = message.senderId === user?.id;
                  const canApprove = isAdmin && !isProposer && scopeProposal.status === 'Proposed';

                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.scopeProposalCard,
                        isCompactLayout && styles.scopeProposalCardCompact,
                        isOwnMessage ? styles.scopeProposalCardOwn : styles.scopeProposalCardOther,
                      ]}
                    >
                      <View style={styles.scopeProposalHeader}>
                        <View style={styles.scopeProposalIconBg}>
                          <MaterialIcons name="description" size={20} color="#ffffff" />
                        </View>
                        <View style={styles.scopeProposalHeaderCopy}>
                          <Text style={styles.scopeProposalTitle}>
                            {scopeProposal.title}
                          </Text>
                          <Text style={styles.scopeProposalSender}>
                            {senderLabel}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.scopeProposalStatusChip,
                            { backgroundColor: statusPalette.backgroundColor },
                          ]}
                        >
                          <Text
                            style={[
                              styles.scopeProposalStatusText,
                              { color: statusPalette.textColor },
                            ]}
                          >
                            {scopeProposal.status}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.scopeProposalDescription}>
                        {scopeProposal.description}
                      </Text>

                      {scopeProposal.included && scopeProposal.included.length > 0 ? (
                        <View style={styles.scopeProposalSection}>
                          <Text style={styles.scopeProposalSectionLabel}>Included:</Text>
                          <View style={styles.scopeItemsList}>
                            {scopeProposal.included.map((item, index) => (
                              <View key={`included-${index}`} style={styles.scopeItem}>
                                <MaterialIcons name="check-circle" size={18} color="#16a34a" />
                                <Text style={styles.scopeItemText}>{item}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ) : null}

                      {scopeProposal.excluded && scopeProposal.excluded.length > 0 ? (
                        <View style={styles.scopeProposalSection}>
                          <Text style={styles.scopeProposalSectionLabel}>Excluded:</Text>
                          <View style={styles.scopeItemsList}>
                            {scopeProposal.excluded.map((item, index) => (
                              <View key={`excluded-${index}`} style={styles.scopeItem}>
                                <MaterialIcons name="cancel" size={18} color="#dc2626" />
                                <Text style={styles.scopeItemTextExcluded}>{item}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ) : null}

                      {scopeProposal.timeline || scopeProposal.resources ? (
                        <View style={styles.scopeMetaSection}>
                          {scopeProposal.timeline ? (
                            <View style={styles.scopeMetaItem}>
                              <Text style={styles.scopeMetaLabel}>Timeline:</Text>
                              <Text style={styles.scopeMetaValue}>{scopeProposal.timeline}</Text>
                            </View>
                          ) : null}
                          {scopeProposal.resources ? (
                            <View style={styles.scopeMetaItem}>
                              <Text style={styles.scopeMetaLabel}>Resources:</Text>
                              <Text style={styles.scopeMetaValue}>{scopeProposal.resources}</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      {scopeProposal.successCriteria ? (
                        <View style={styles.scopeProposalSection}>
                          <Text style={styles.scopeProposalSectionLabel}>Success Criteria:</Text>
                          <Text style={styles.scopeProposalDescription}>{scopeProposal.successCriteria}</Text>
                        </View>
                      ) : null}

                      {scopeProposal.approvedBy && scopeProposal.approvedAt ? (
                        <View style={styles.approvalBadge}>
                          <MaterialIcons name="check-circle" size={16} color="#16a34a" />
                          <Text style={styles.approvalBadgeText}>
                            Approved on {formatDateLabel(scopeProposal.approvedAt)}
                          </Text>
                        </View>
                      ) : null}

                      {canApprove ? (
                        <View style={styles.scopeProposalActions}>
                          <TouchableOpacity
                            style={styles.downloadButton}
                            onPress={() => {
                              void exportScopeProposalFile(scopeProposal, senderLabel);
                            }}
                          >
                            <MaterialIcons name="download" size={16} color="#1d4ed8" />
                            <Text style={styles.downloadButtonText}>Download File</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.approveButton}
                            onPress={() => {
                              if (!user?.id || !message.projectId) {
                                return;
                              }
                              const updatedMessage: ProjectGroupMessage = {
                                ...message,
                                projectId: message.projectId,
                                scopeProposal: {
                                  ...scopeProposal,
                                  status: 'Approved',
                                  approvedBy: user.id,
                                  approvedAt: new Date().toISOString(),
                                },
                              };
                              setMessages(current => upsertChatMessage(current, updatedMessage));
                              void saveProjectGroupMessage(updatedMessage);
                            }}
                          >
                            <MaterialIcons name="check-circle" size={16} color="#ffffff" />
                            <Text style={styles.approveButtonText}>Approve Project Proposal</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.editButton}
                            onPress={() => {
                              Alert.alert('Edit Proposal', 'Partners can edit and repost their proposal.');
                            }}
                          >
                            <MaterialIcons name="edit" size={16} color="#1d4ed8" />
                            <Text style={styles.editButtonText}>Edit</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      {imageAttachments.map((attachmentUri, index) => (
                        <Image
                          key={`${message.id}-attachment-${index}`}
                          source={{ uri: attachmentUri }}
                          style={styles.messageAttachment}
                          resizeMode="cover"
                        />
                      ))}

                      <Text style={styles.scopeProposalTimestamp}>
                        {formatMessageTime(message.timestamp)}
                      </Text>
                    </View>
                  );
                }

                if (selectedProjectChat && groupMessage?.kind === 'need-response') {
                  const action = groupMessage.responseAction || 'Can Help';
                  const palette = getNeedResponsePalette(action);

                  return (
                    <View
                      key={message.id}
                    style={[
                      styles.responseCard,
                      isCompactLayout && styles.responseCardCompact,
                      isOwnMessage ? styles.responseCardOwn : styles.responseCardOther,
                    ]}
                    >
                      <View style={styles.responseTopRow}>
                        <Text style={[styles.messageSender, isOwnMessage && styles.messageSenderOwn]}>
                          {senderLabel}
                        </Text>
                        <View
                          style={[
                            styles.responseActionChip,
                            { backgroundColor: palette.backgroundColor },
                          ]}
                        >
                          <MaterialIcons name={palette.icon} size={12} color={palette.textColor} />
                          <Text style={[styles.responseActionChipText, { color: palette.textColor }]}>
                            {action}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={[
                          styles.responseLinkedCard,
                          isOwnMessage ? styles.responseLinkedCardOwn : styles.responseLinkedCardOther,
                        ]}
                      >
                        <Text
                          style={[
                            styles.responseLinkedLabel,
                            isOwnMessage ? styles.responseLinkedLabelOwn : styles.responseLinkedLabelOther,
                          ]}
                        >
                          Linked need
                        </Text>
                        <Text
                          style={[
                            styles.responseLinkedTitle,
                            isOwnMessage ? styles.responseLinkedTitleOwn : styles.responseLinkedTitleOther,
                          ]}
                        >
                          {groupMessage.responseToTitle || responseTargetNeed?.title || 'Planning need'}
                        </Text>
                      </View>

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
                }

                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageBubble,
                      isCompactLayout && styles.messageBubbleCompact,
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
            )
          ) : null}
          </ScrollView>

          {showComposer ? (
            <View style={[styles.composerShell, isVolunteerCompact && styles.composerShellCompact]}>
              {detailCanPostNeeds ? (
                <View style={[styles.modeToggleRow, isVolunteerCompact && styles.modeToggleRowCompact]}>
                <TouchableOpacity
                  style={[
                    styles.modeToggleButton,
                    isVolunteerCompact && styles.modeToggleButtonCompact,
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
                    isVolunteerCompact && styles.modeToggleButtonCompact,
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

                {['admin', 'partner'].includes(user?.role || '') ? (
                  <TouchableOpacity
                    style={[
                      styles.modeToggleButton,
                      isVolunteerCompact && styles.modeToggleButtonCompact,
                      composerMode === 'scope-proposal' && styles.modeToggleButtonActive,
                    ]}
                    onPress={() => setComposerMode('scope-proposal')}
                  >
                    <MaterialIcons
                      name="description"
                      size={16}
                      color={composerMode === 'scope-proposal' ? '#ffffff' : '#166534'}
                    />
                    <Text
                      style={[
                        styles.modeToggleText,
                        composerMode === 'scope-proposal' && styles.modeToggleTextActive,
                      ]}
                    >
                      Scope proposal
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {detailCanPostNeeds && composerMode === 'need-post' ? (
              <View style={[styles.needComposerCard, isVolunteerCompact && styles.needComposerCardCompact]}>
                <Text style={styles.needComposerTitle}>Post a planning need in this group</Text>
                <Text style={styles.needComposerSubtitle}>
                  Share exactly what the team needs so volunteers, partners, and admins can coordinate around one clear request.
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

            {detailCanPostNeeds && composerMode === 'scope-proposal' && ['admin', 'partner'].includes(user?.role || '') ? (
              <ScrollView style={styles.scopeProposalComposerCard} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scopeProposalComposerContent}>
                <View style={styles.scopeProposalComposerHeader}>
                  <View style={styles.scopeProposalComposerHeaderIcon}>
                    <MaterialIcons name="edit-note" size={20} color="#1d4ed8" />
                  </View>
                  <View style={styles.scopeProposalComposerHeaderCopy}>
                    <Text style={styles.scopeProposalComposerTitle}>Propose a program</Text>
                    <Text style={styles.scopeProposalComposerSubtitle}>
                      Define goals, deliverables, and success criteria for this program.
                    </Text>
                  </View>
                </View>

                <TextInput
                  value={scopeProposalDraft.title}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, title: value }))}
                  placeholder="Proposal title"
                  placeholderTextColor="#94a3b8"
                  style={styles.composerInput}
                />

                <TextInput
                  value={scopeProposalDraft.description}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, description: value }))}
                  placeholder="Describe the scope and project overview"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <TextInput
                  value={scopeProposalDraft.included}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, included: value }))}
                  placeholder="Included in scope (one item per line)"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <TextInput
                  value={scopeProposalDraft.excluded}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, excluded: value }))}
                  placeholder="Excluded from scope (one item per line)"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <View style={[styles.dualInputRow, !isMedium && styles.dualInputRowStacked]}>
                  <TextInput
                    value={scopeProposalDraft.timeline}
                    onChangeText={value => setScopeProposalDraft(current => ({ ...current, timeline: value }))}
                    placeholder="Timeline (e.g., 3 months, Q1 2024)"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                  <TextInput
                    value={scopeProposalDraft.resources}
                    onChangeText={value => setScopeProposalDraft(current => ({ ...current, resources: value }))}
                    placeholder="Resource requirements"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                </View>

                <TextInput
                  value={scopeProposalDraft.successCriteria}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, successCriteria: value }))}
                  placeholder="How will success be measured?"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <Text style={styles.chipGroupLabel}>Status</Text>
                <View style={styles.chipWrap}>
                  {(['Draft', 'Proposed'] as const).map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.choiceChip,
                        scopeProposalDraft.status === status && styles.choiceChipActive,
                      ]}
                      onPress={() => setScopeProposalDraft(current => ({ ...current, status }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          scopeProposalDraft.status === status && styles.choiceChipTextActive,
                        ]}
                      >
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
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

            {selectedNeedMessage && composerMode === 'message' ? (
              <View style={styles.replyBanner}>
                <View style={styles.replyBannerTopRow}>
                  <View style={styles.replyBannerCopy}>
                    <Text style={styles.replyBannerLabel}>Responding to need</Text>
                    <Text style={styles.replyBannerTitle} numberOfLines={1}>
                      {selectedNeedMessage.needPost?.title || selectedNeedMessage.responseToTitle || 'Planning need'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.replyBannerDismiss}
                    onPress={() => {
                      setSelectedNeedMessageId(null);
                      setSelectedNeedResponseAction('Can Help');
                    }}
                  >
                    <MaterialIcons name="close" size={16} color="#166534" />
                  </TouchableOpacity>
                </View>

                <View style={styles.replyActionRow}>
                  {NEED_RESPONSE_ACTIONS.map(action => {
                    const palette = getNeedResponsePalette(action);
                    const selected = selectedNeedResponseAction === action;

                    return (
                      <TouchableOpacity
                        key={`reply-${action}`}
                        style={[
                          styles.replyActionChip,
                          selected && { backgroundColor: palette.backgroundColor, borderColor: palette.backgroundColor },
                        ]}
                        onPress={() => setSelectedNeedResponseAction(action)}
                      >
                        <MaterialIcons name={palette.icon} size={13} color={palette.textColor} />
                        <Text style={[styles.replyActionChipText, { color: palette.textColor }]}>
                          {action}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={[styles.inputRow, !isMedium && styles.inputRowStacked]}>
              <TouchableOpacity
                style={[styles.attachmentButton, isVolunteerCompact && styles.attachmentButtonCompact]}
                onPress={handlePickAttachment}
              >
                <MaterialIcons name="photo-library" size={18} color="#166534" />
              </TouchableOpacity>

              {(composerMode === 'need-post' || composerMode === 'scope-proposal') && detailCanPostNeeds ? (
                <View style={styles.inlineHintBox}>
                  <Text style={styles.inlineHintTitle}>
                    {composerMode === 'scope-proposal' ? 'Scope proposal ready' : 'Needs card ready'}
                  </Text>
                  <Text style={styles.inlineHintText}>
                    {composerMode === 'scope-proposal'
                      ? 'Post this proposal so the team can review and align on project goals.'
                      : 'Post this as a structured request so everyone in the group can coordinate around one clear need.'}
                  </Text>
                </View>
              ) : (
                <TextInput
                  style={styles.messageInput}
                  placeholder={
                    selectedNeedMessage
                      ? 'Add a short update or note for this need...'
                      : selectedProjectChat
                      ? 'Share an update with this group...'
                      : 'Type a message...'
                  }
                  placeholderTextColor="#94a3b8"
                  value={messageText}
                  onChangeText={setMessageText}
                  multiline
                />
              )}

              <TouchableOpacity
                style={[styles.sendButton, isVolunteerCompact && styles.sendButtonCompact]}
                onPress={handleSendMessage}
              >
                <MaterialIcons
                  name={composerMode === 'scope-proposal' ? 'description' : composerMode === 'need-post' ? 'campaign' : selectedNeedMessage ? 'assignment-turned-in' : 'send'}
                  size={18}
                  color="#ffffff"
                />
                <Text style={styles.sendButtonText}>
                  {composerMode === 'scope-proposal' ? 'Post Proposal' : composerMode === 'need-post' ? 'Post Need' : selectedNeedMessage ? 'Post Response' : 'Send'}
                </Text>
              </TouchableOpacity>
            </View>
            </View>
          ) : null}
        </View>
      </View>
  </KeyboardAvoidingView>
  );
}

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={[
          styles.listScrollContent,
          isCompactLayout && styles.listScrollContentCompact,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.listShell, isWide && styles.centeredShell]}>
          <View style={[styles.heroCard, isVolunteerCompact && styles.heroCardCompact]}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>
                {isVolunteerCompact ? 'Volunteer coordination' : 'Collaboration workspace'}
              </Text>
              <Text style={[styles.heroTitle, isVolunteerCompact && styles.heroTitleCompact]}>
                Communication Hub
              </Text>
              <Text style={[styles.heroSubtitle, isVolunteerCompact && styles.heroSubtitleCompact]}>
                {isVolunteerCompact
                  ? 'Open your joined event chats, follow direct messages, and reach people fast.'
                  : projectChatSubtitle}
              </Text>
            </View>

            <View
              style={[
                styles.metricsRow,
                !isMedium && styles.metricsRowStacked,
                isVolunteerCompact && styles.metricsRowCompact,
              ]}
            >
              {(isVolunteerCompact ? compactMetricCards : fullMetricCards).map(card => (
                <View
                  key={card.label}
                  style={[styles.metricCard, isVolunteerCompact && styles.metricCardCompact]}
                >
                  <Text style={styles.metricLabel}>{card.label}</Text>
                  <Text style={[styles.metricValue, isVolunteerCompact && styles.metricValueCompact]}>
                    {card.value}
                  </Text>
                  <Text style={styles.metricHint}>{card.hint}</Text>
                </View>
              ))}
            </View>

            {isVolunteerCompact ? (
              <View style={styles.compactSupportNote}>
                <MaterialIcons name="tips-and-updates" size={16} color="#166534" />
                <Text style={styles.compactSupportNoteText}>
                  Search any name, event, or project to jump straight into the right conversation.
                </Text>
              </View>
            ) : null}

            <View style={[styles.searchCard, isVolunteerCompact && styles.searchCardCompact]}>
              <MaterialIcons name="search" size={20} color="#64748b" />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder={isVolunteerCompact ? 'Search chats, teammates, or events' : 'Search chats, names, or projects'}
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
                <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                        {projectChatSectionTitle}
                      </Text>
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
                        style={[styles.projectChatCard, isVolunteerCompact && styles.projectChatCardCompact]}
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

                {user?.role === 'admin' ? (
                  <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
                    <View style={styles.sectionHeader}>
                      <View>
                        <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                          Partner proposal inbox
                        </Text>
                        <Text style={styles.sectionDescription}>
                          Review every partner submission here, then approve or reject without leaving the hub.
                        </Text>
                      </View>
                    </View>

                    {renderProposalFilterChips()}

                    {filteredProposalChats.length === 0 ? (
                      <Text style={styles.emptyInlineText}>No proposals match this filter right now.</Text>
                    ) : (
                      filteredProposalChats.map(chat => (
                        (() => {
                          const statusPalette = getProposalReviewStatusPalette(chat.application.status);
                          return (
                            <TouchableOpacity
                              key={chat.application.id}
                              style={[styles.projectChatCard, isVolunteerCompact && styles.projectChatCardCompact]}
                              onPress={() => handleSelectProposalApplication(chat.application)}
                            >
                              <View style={styles.projectChatIcon}>
                                <MaterialIcons name="campaign" size={20} color="#166534" />
                              </View>

                              <View style={styles.projectChatCopy}>
                                <View style={styles.proposalListTitleRow}>
                                  <Text style={styles.projectChatTitle}>
                                    {chat.application.proposalDetails?.proposedTitle || chat.projectTitle}
                                  </Text>
                                  <View
                                    style={[
                                      styles.proposalListStatusBadge,
                                      {
                                        backgroundColor: statusPalette.backgroundColor,
                                        borderColor: statusPalette.borderColor,
                                      },
                                    ]}
                                  >
                                    <MaterialIcons
                                      name={statusPalette.icon}
                                      size={12}
                                      color={statusPalette.textColor}
                                    />
                                    <Text style={[styles.proposalListStatusText, { color: statusPalette.textColor }]}>
                                      {chat.application.status}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.projectChatMeta} numberOfLines={1}>
                                  Proposal from {chat.application.partnerName} - {chat.programModule}
                                </Text>
                                <Text style={styles.projectChatMetaMuted} numberOfLines={1}>
                                  Submitted {formatDateLabel(chat.application.requestedAt)}
                                </Text>
                                <Text numberOfLines={2} style={styles.projectChatDescription}>
                                  {chat.application.proposalDetails?.communityNeed || chat.application.proposalDetails?.proposedDescription}
                                </Text>
                              </View>

                              <MaterialIcons name="arrow-forward" size={20} color="#64748b" />
                            </TouchableOpacity>
                          );
                        })()
                      ))
                    )}
                  </View>
                ) : null}

                <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                        Direct conversations
                      </Text>
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
                        style={[styles.conversationRow, isVolunteerCompact && styles.conversationRowCompact]}
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
                <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                        Start a new chat
                      </Text>
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

                <View style={[styles.sectionCard, isVolunteerCompact && styles.sectionCardCompact]}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={[styles.sectionTitle, isVolunteerCompact && styles.sectionTitleCompact]}>
                        {isVolunteerCompact ? 'Quick help' : 'Hub tips'}
                      </Text>
                      <Text style={styles.sectionDescription}>
                        {isVolunteerCompact
                          ? 'A few shortcuts to keep conversations easy to manage on mobile.'
                          : 'Use project group chats, respond to needs, and keep conversations moving.'}
                      </Text>
                    </View>
                  </View>

                  {isVolunteerCompact ? (
                    <View style={styles.compactTipsList}>
                      <View style={styles.tipCard}>
                        <MaterialIcons name="campaign" size={18} color="#166534" />
                        <Text style={styles.tipText}>
                          Use your joined event chat first when the update affects the whole team.
                        </Text>
                      </View>
                      <View style={styles.tipCard}>
                        <MaterialIcons name="assignment-turned-in" size={18} color="#166534" />
                        <Text style={styles.tipText}>
                          Tap a planning need to reply so everyone sees who is helping.
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.tipCard}>
                        <MaterialIcons name="campaign" size={18} color="#166534" />
                        <Text style={styles.tipText}>
                          Use project group chats like planning rooms: admins, partners, and joined volunteers can all post structured needs.
                        </Text>
                      </View>
                      <View style={styles.tipCard}>
                        <MaterialIcons name="forum" size={18} color="#166534" />
                        <Text style={styles.tipText}>
                          Respond to a need directly from the planning board so the whole team can see who is helping.
                        </Text>
                      </View>
                      <View style={styles.tipCard}>
                        <MaterialIcons name="photo-library" size={18} color="#166534" />
                        <Text style={styles.tipText}>
                          Attach a photo when a request needs reference material, stock levels, or field context.
                        </Text>
                      </View>
                    </>
                  )}
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
  listScrollContentCompact: {
    padding: 12,
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
  heroCardCompact: {
    borderRadius: 22,
    padding: 16,
    gap: 14,
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
  heroTitleCompact: {
    fontSize: 25,
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#475569',
    maxWidth: 760,
  },
  heroSubtitleCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  metricsRowCompact: {
    gap: 10,
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
  metricCardCompact: {
    borderRadius: 18,
    padding: 14,
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
  metricValueCompact: {
    marginTop: 6,
    fontSize: 25,
  },
  metricHint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  compactSupportNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#d7ead8',
  },
  compactSupportNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
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
  searchCardCompact: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  sectionCardCompact: {
    borderRadius: 22,
    padding: 16,
    gap: 14,
  },
  sectionHeader: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionTitleCompact: {
    fontSize: 18,
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
  proposalFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  proposalFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d7ead8',
    backgroundColor: '#f8fff7',
  },
  proposalFilterChipActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  proposalFilterChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  proposalFilterChipTextActive: {
    color: '#ffffff',
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
  projectChatCardCompact: {
    alignItems: 'flex-start',
    padding: 14,
  },
  projectChatCardSelected: {
    backgroundColor: '#eefaf2',
    borderColor: '#d1f3de',
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
  projectChatMetaMuted: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  projectChatDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  proposalListTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  proposalListStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  proposalListStatusText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5efe4',
  },
  conversationRowCompact: {
    paddingVertical: 12,
    gap: 12,
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
  compactTipsList: {
    gap: 12,
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
    padding: 16,
    gap: 14,
    backgroundColor: '#f8fafc',
  },
  detailShellCompact: {
    padding: 10,
    gap: 10,
  },
  detailShellWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
  },
  detailSidebar: {
    width: 320,
    minWidth: 280,
    gap: 20,
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  detailSidebarCompact: {
    width: '100%',
  },
  sidebarGroupLabel: {
    marginBottom: -8,
    paddingHorizontal: 4,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  detailMain: {
    flex: 1,
    gap: 20,
    minWidth: 0,
  },
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#0f766e',
    borderRadius: 16,
    padding: 24,
    borderWidth: 0,
    shadowColor: '#0f766e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  detailHeroCompact: {
    alignItems: 'flex-start',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    flexWrap: 'wrap',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b5f59',
  },
  detailHeroCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  detailHeroCopyCompact: {
    width: '100%',
  },
  detailEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#ccfbf1',
  },
  detailTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
  },
  detailTitleCompact: {
    fontSize: 21,
  },
  detailSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#d1fae5',
  },
  detailSubtitleCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
  detailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#dcfce7',
  },
  detailBadgeCompact: {
    alignSelf: 'flex-start',
  },
  detailBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  planningBoardCard: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#f0f9ff',
    borderWidth: 2,
    borderColor: '#bfdbfe',
    gap: 16,
  },
  planningBoardCardCompact: {
    padding: 16,
    gap: 12,
  },
  planningBoardHeader: {
    gap: 12,
  },
  planningBoardCopy: {
    gap: 4,
  },
  planningBoardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e3a8a',
  },
  planningBoardSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#1e40af',
    fontWeight: '500',
  },
  planningBoardBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#2563eb',
  },
  planningBoardBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  planningMetricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  planningMetricCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#d7ead8',
  },
  planningMetricCardCompact: {
    padding: 12,
  },
  planningMetricValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  planningMetricLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  planningNeedList: {
    gap: 10,
  },
  planningNeedCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe7d5',
    gap: 8,
  },
  planningNeedCardActive: {
    borderColor: '#166534',
    backgroundColor: '#effcf3',
  },
  planningNeedTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  planningNeedTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  planningNeedStatus: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    textTransform: 'uppercase',
  },
  planningNeedMeta: {
    fontSize: 12,
    color: '#166534',
    fontWeight: '700',
  },
  planningNeedSummary: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
  planningNeedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  planningNeedResponses: {
    fontSize: 12,
    color: '#64748b',
  },
  planningNeedAction: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  planningEmptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  messagesScroll: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 24,
    gap: 14,
  },
  messagesContentCompact: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    paddingBottom: 18,
    gap: 10,
  },
  messageBubble: {
    maxWidth: '86%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  messageBubbleCompact: {
    maxWidth: '94%',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
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
  needCardCompact: {
    maxWidth: '96%',
    padding: 14,
    gap: 8,
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
  needResponsePreviewWrap: {
    gap: 6,
  },
  needResponsePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  needResponsePreviewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  needResponsePreviewChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  needResponsePreviewText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
  },
  needResponsePreviewTextOwn: {
    color: '#d5f5ef',
  },
  needActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  needActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#dbe7d5',
  },
  needActionChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  responseCard: {
    maxWidth: '88%',
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  responseCardCompact: {
    maxWidth: '94%',
    padding: 14,
    gap: 8,
  },
  responseCardOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d8e7d7',
  },
  responseCardOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#14532d',
  },
  responseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  responseActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  responseActionChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  responseLinkedCard: {
    borderRadius: 14,
    padding: 12,
  },
  responseLinkedCardOther: {
    backgroundColor: '#effcf3',
  },
  responseLinkedCardOwn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  responseLinkedLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  responseLinkedLabelOther: {
    color: '#166534',
  },
  responseLinkedLabelOwn: {
    color: '#bbf7d0',
  },
  responseLinkedTitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '700',
  },
  responseLinkedTitleOther: {
    color: '#0f172a',
  },
  responseLinkedTitleOwn: {
    color: '#ffffff',
  },
  composerShell: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#bfdbfe',
    padding: 20,
    gap: 16,
    shadowColor: '#1e3a8a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  composerShellCompact: {
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },
  modeToggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  modeToggleRowCompact: {
    gap: 8,
  },
  modeToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f9ff',
    borderWidth: 2,
    borderColor: '#bfdbfe',
  },
  modeToggleButtonCompact: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  modeToggleButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  modeToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e40af',
  },
  modeToggleTextActive: {
    color: '#ffffff',
  },
  needComposerCard: {
    borderRadius: 14,
    backgroundColor: '#f0f9ff',
    borderWidth: 2,
    borderColor: '#bfdbfe',
    padding: 18,
    gap: 14,
  },
  needComposerCardCompact: {
    padding: 14,
    gap: 12,
  },
  needComposerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1e3a8a',
  },
  needComposerSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#1e40af',
    fontWeight: '500',
  },
  composerInput: {
    width: '100%',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
  },
  composerTextArea: {
    minHeight: 60,
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
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#1e3a8a',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#bfdbfe',
  },
  choiceChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
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
  attachmentButtonCompact: {
    width: '100%',
    borderRadius: 14,
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
  replyBanner: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#f8fff7',
    borderWidth: 1,
    borderColor: '#d7ead8',
    gap: 12,
  },
  replyBannerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  replyBannerCopy: {
    flex: 1,
    gap: 4,
  },
  replyBannerLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#166534',
  },
  replyBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  replyBannerDismiss: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  replyActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  replyActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5cf',
    backgroundColor: '#ffffff',
  },
  replyActionChipText: {
    fontSize: 12,
    fontWeight: '700',
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
  sendButtonCompact: {
    width: '100%',
    minHeight: 50,
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  scopeProposalComposerCard: {
    borderRadius: 14,
    backgroundColor: '#f0f9ff',
    borderWidth: 2,
    borderColor: '#bfdbfe',
    maxHeight: 280,
  },
  scopeProposalComposerContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  scopeProposalComposerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  scopeProposalComposerHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dbeafe',
  },
  scopeProposalComposerHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  scopeProposalComposerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  scopeProposalComposerSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  scopeProposalCard: {
    maxWidth: '92%',
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  scopeProposalCardCompact: {
    maxWidth: '96%',
    padding: 14,
    gap: 10,
  },
  scopeProposalCardOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#cfe2f3',
  },
  scopeProposalCardOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#1e3a8a',
  },
  proposalReviewCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    gap: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#dbe7d5',
  },
  proposalReviewIntroBubble: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  proposalReviewIntroSender: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  proposalReviewIntroText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
  },
  proposalReviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  proposalReviewHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f766e',
  },
  proposalReviewHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  proposalReviewTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalReviewSubtitle: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  proposalStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  proposalStatusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  proposalReviewMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  proposalReviewMetaPill: {
    minWidth: 150,
    flexGrow: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  proposalReviewMetaLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  proposalReviewMetaValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  proposalReviewSection: {
    gap: 4,
  },
  proposalReviewLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#0f766e',
  },
  proposalReviewValue: {
    fontSize: 14,
    lineHeight: 20,
    color: '#0f172a',
  },
  proposalReviewSectionGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  proposalReviewColumn: {
    flex: 1,
    gap: 4,
  },
  proposalReviewActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  proposalReviewActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#0f766e',
  },
  proposalReviewActionText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  proposalActionButton: {
    flex: 1,
  },
  proposalRejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  proposalRejectButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991b1b',
  },
  proposalReviewOutcome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  proposalReviewOutcomeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
  },
  scopeProposalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  scopeProposalHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  scopeProposalSender: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1d4ed8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scopeProposalSenderOwn: {
    color: '#93c5fd',
  },
  scopeProposalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  scopeProposalTitleOwn: {
    color: '#ffffff',
  },
  scopeProposalStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  scopeProposalStatusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  scopeProposalDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: '#1e293b',
  },
  scopeProposalDescriptionOwn: {
    color: '#ecfdf5',
  },
  scopeProposalSection: {
    gap: 8,
  },
  scopeProposalSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  scopeProposalSectionTitleOwn: {
    color: '#ffffff',
  },
  deliverablesList: {
    gap: 8,
  },
  deliverableItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  deliverableBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
    marginTop: 8,
    flexShrink: 0,
  },
  deliverableText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
  },
  deliverableTextOwn: {
    color: '#e0e7ff',
  },
  scopeProposalMetaRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  scopeProposalMetaRowStacked: {
    flexDirection: 'column',
  },
  scopeProposalMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  scopeProposalMetaPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  scopeProposalLinkedCard: {
    borderRadius: 14,
    padding: 12,
  },
  scopeProposalLinkedCardOther: {
    backgroundColor: '#dbeafe',
  },
  scopeProposalLinkedCardOwn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  scopeProposalLinkedLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  scopeProposalLinkedLabelOther: {
    color: '#1d4ed8',
  },
  scopeProposalLinkedLabelOwn: {
    color: '#93c5fd',
  },
  scopeProposalLinkedText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  scopeProposalLinkedTextOther: {
    color: '#0f172a',
  },
  scopeProposalLinkedTextOwn: {
    color: '#ffffff',
  },
  scopeProposalTimestamp: {
    fontSize: 11,
    color: '#64748b',
  },
  scopeProposalTimestampOwn: {
    color: '#93c5fd',
  },
  scopeProposalIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#a78bfa',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  scopeItemsList: {
    gap: 8,
    marginTop: 8,
  },
  scopeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scopeItemText: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '500',
  },
  scopeItemTextExcluded: {
    flex: 1,
    fontSize: 14,
    color: '#dc2626',
    fontWeight: '500',
    textDecorationLine: 'line-through',
  },
  scopeProposalSectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  scopeMetaSection: {
    gap: 8,
    paddingTop: 8,
  },
  scopeMetaItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  scopeMetaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  scopeMetaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  scopeProposalActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#0f766e',
  },
  approveButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  downloadButton: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  downloadButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f766e',
  },
  editButton: {
    flex: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  editButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f766e',
  },
  approvalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#dcfce7',
    marginTop: 8,
  },
  approvalBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
});
