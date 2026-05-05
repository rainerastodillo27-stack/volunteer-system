import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  composePhilippineAddress,
  getBarangaysByCity,
  getCitiesByRegion,
  PHBarangay,
  PHCityMunicipality,
  PHRegions,
} from '../utils/philippineAddressData';
import {
  getAllUsers,
  getConversation,
  getMessagesForUser,
  getProjectGroupMessages,
  getProjectsScreenSnapshot,
  leaveVolunteerEventGroup,
  markMessageAsRead,
  saveMessage,
  saveProjectGroupMessage,
  subscribeToMessages,
  subscribeToStorageChanges,
  submitPartnerProgramProposal,
  reviewPartnerProjectApplication,
} from '../models/storage';
import {
  Message,
  PartnerProjectApplication,
  Project,
  ProjectGroupMessage,
  User,
  AdvocacyFocus,
} from '../models/types';
import { navigateToAvailableRoute } from '../utils/navigation';
import { isImageMediaUri, pickDocumentFromDevice, pickImageFromDevice } from '../utils/media';
import { getRequestErrorMessage } from '../utils/requestErrors';

function LazyDateTimePicker(props: any) {
  if (Platform.OS === 'web') {
    return (
      <View style={{ marginTop: 10 }}>
        <input
          type="date"
          value={props.value instanceof Date ? props.value.toISOString().split('T')[0] : ''}
          onChange={(e) => {
            if (props.onChange) {
              props.onChange({ type: 'set' }, new Date(e.target.value));
            }
          }}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            fontSize: '14px',
            fontFamily: 'inherit',
            color: '#1e293b',
            backgroundColor: '#fff',
            cursor: 'pointer'
          }}
        />
      </View>
    );
  }
  const DateTimePickerComponent = require('@react-native-community/datetimepicker').default;
  return <DateTimePickerComponent {...props} />;
}

type SidebarSection = 'messages' | 'projects' | 'proposals' | 'contacts';

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

type ChatMessage = Message | ProjectGroupMessage;

function upsertChatMessage(current: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const byId = new Map(current.map(message => [message.id, message]));
  byId.set(incoming.id, incoming);
  return Array.from(byId.values()).sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
}

function getAttachmentName(uri: string, index: number): string {
  if (uri.startsWith('data:')) {
    const mimeType = uri.slice(5, uri.indexOf(';') > -1 ? uri.indexOf(';') : undefined);
    const extension = mimeType.includes('/') ? mimeType.split('/').pop() : 'file';
    return `Attachment ${index + 1}.${extension || 'file'}`;
  }

  const cleanUri = uri.split('?')[0];
  const fileName = cleanUri.split('/').pop();
  return fileName || `Attachment ${index + 1}`;
}

type ProposalFormState = {
  proposedTitle: string;
  proposedDescription: string;
  proposedStartDate: string;
  proposedEndDate: string;
  proposedLocation: string;
  proposedVolunteersNeeded: string;
  communityNeed: string;
  expectedDeliverables: string;
};


export default function CommunicationHubScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 1024;
  const isTablet = width >= 768;
  const isVolunteer = user?.role === 'volunteer';

  const {
    projectId: requestedProjectId,
    newProposalModule,
    newProposalProjectId,
    newProposalTitle
  } = route?.params || {};

  const [view, setView] = useState<'sidebar' | 'detail'>(isWide ? 'detail' : 'sidebar');
  const [activeSection, setActiveSection] = useState<SidebarSection>('messages');
  const [loading, setLoading] = useState(true);

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [projectChats, setProjectChats] = useState<ProjectChatItem[]>([]);
  const [proposalChats, setProposalChats] = useState<ProposalChatItem[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedProjectChat, setSelectedProjectChat] = useState<ProjectChatItem | null>(null);
  const [selectedProposalApplication, setSelectedProposalApplication] = useState<PartnerProjectApplication | null>(null);
  const [proposalIntent, setProposalIntent] = useState<{ module?: string; projectId?: string; title?: string } | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const [templateActive, setTemplateActive] = useState(true);
  const [showMessageHub, setShowMessageHub] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const selectedUserRef = useRef<User | null>(null);
  const selectedProjectChatRef = useRef<ProjectChatItem | null>(null);

  const [proposalForm, setProposalForm] = useState<ProposalFormState>({
    proposedTitle: newProposalTitle || '',
    proposedDescription: '',
    proposedStartDate: '',
    proposedEndDate: '',
    proposedLocation: '',
    proposedVolunteersNeeded: '',
    communityNeed: '',
    expectedDeliverables: '',
  });

  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [selectedRegionCode, setSelectedRegionCode] = useState('');
  const [selectedCityCode, setSelectedCityCode] = useState('');
  const [filteredCities, setFilteredCities] = useState<PHCityMunicipality[]>([]);
  const [filteredBarangays, setFilteredBarangays] = useState<PHBarangay[]>([]);
  const [locRegion, setLocRegion] = useState('');
  const [locCity, setLocCity] = useState('');
  const [locBarangay, setLocBarangay] = useState('');

  const availableSections: SidebarSection[] = isVolunteer
    ? ['messages', 'projects']
    : ['messages', 'projects', 'proposals', 'contacts'];

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [users, snapshot, msgs] = await Promise.all([
        getAllUsers(),
        getProjectsScreenSnapshot(user),
        getMessagesForUser(user.id),
      ]);

      const others = users.filter(u => u.id !== user.id);
      const allowedDirectUsers = user.role === 'volunteer'
        ? others.filter(u => u.role === 'admin')
        : others;
      const allowedDirectUserIds = new Set(allowedDirectUsers.map(u => u.id));
      const joinedEventIds = new Set(snapshot.volunteerJoinRecords.map(record => record.projectId));
      const volunteerProfileId = snapshot.volunteerProfile?.id;

      setAllUsers(allowedDirectUsers);

      setProjectChats(
        snapshot.projects
          .filter(project => {
            if (!project?.isEvent) {
              return false;
            }
            if (user.role !== 'volunteer') {
              return true;
            }
            const joinedByRecord = joinedEventIds.has(project.id);
            const joinedByUserId = (project.joinedUserIds || []).includes(user.id);
            const joinedByVolunteerId = Boolean(
              volunteerProfileId && (project.volunteers || []).includes(volunteerProfileId)
            );
            return joinedByRecord || joinedByUserId || joinedByVolunteerId;
          })
          .map(project => ({
            project,
            participantCount: Math.max(
              (project.joinedUserIds || []).length,
              (project.volunteers || []).length,
            ),
          }))
      );

      setProposalChats((user.role === 'volunteer' ? [] : snapshot.partnerApplications).map(app => ({
        application: app,
        projectTitle: app.proposalDetails?.proposedTitle || 'Untitled Proposal',
        programModule: app.proposalDetails?.requestedProgramModule || 'Nutrition'
      })));

      const convMap = new Map<string, ConversationItem>();
      msgs.forEach(m => {
        const otherId = m.senderId === user.id ? m.recipientId : m.senderId;
        if (!allowedDirectUserIds.has(otherId)) return;
        const otherUser = others.find(u => u.id === otherId);
        if (!otherUser) return;
        const entry = convMap.get(otherId) || { user: otherUser, unreadCount: 0 };
        if (!entry.lastMessage || new Date(m.timestamp) > new Date(entry.lastMessage.timestamp)) {
          entry.lastMessage = m;
        }
        if (!m.read && m.recipientId === user.id) {
          entry.unreadCount++;
        }
        convMap.set(otherId, entry);
      });

      setConversations(Array.from(convMap.values()).sort((a, b) =>
        new Date(b.lastMessage?.timestamp || 0).getTime() - new Date(a.lastMessage?.timestamp || 0).getTime()
      ));
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }, [user]);

  const loadMessages = async () => {
    if (!user) return;
    try {
      if (selectedUser) {
        const chat = await getConversation(user.id, selectedUser.id);
        setMessages(chat);
        const unread = chat.filter(m => !m.read && m.recipientId === user.id);
        if (unread.length > 0) {
          await Promise.all(unread.map(m => markMessageAsRead(m.id)));
          void loadData();
        }
      } else if (selectedProjectChat) {
        const chat = await getProjectGroupMessages(selectedProjectChat.project.id, user.id);
        setMessages(chat);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    selectedProjectChatRef.current = selectedProjectChat;
    setShowConversationMenu(false);
  }, [selectedProjectChat]);

  useFocusEffect(useCallback(() => {
    void loadData();
    return subscribeToStorageChanges(['users', 'projects', 'partnerProjectApplications', 'messages', 'projectGroupMessages'], loadData);
  }, [loadData]));

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    return subscribeToMessages(user.id, event => {
      if (event.type === 'message.changed') {
        const incoming = event.message;
        const activeUser = selectedUserRef.current;
        const isActiveConversation = Boolean(
          activeUser &&
          ((incoming.senderId === user.id && incoming.recipientId === activeUser.id) ||
            (incoming.senderId === activeUser.id && incoming.recipientId === user.id))
        );

        if (isActiveConversation) {
          setMessages(current => upsertChatMessage(current, incoming));
          if (!incoming.read && incoming.recipientId === user.id) {
            void markMessageAsRead(incoming.id).then(() => {
              void loadData();
            });
          }
        } else {
          void loadData();
        }
        return;
      }

      if (event.type === 'project-group-message.changed') {
        const incoming = event.message;
        const activeProjectChat = selectedProjectChatRef.current;

        if (activeProjectChat?.project.id === incoming.projectId) {
          setMessages(current => upsertChatMessage(current, incoming));
        }
      }
    });
  }, [loadData, user?.id]);

  useEffect(() => {
    if (view === 'detail') {
      void loadMessages();
    }
  }, [selectedUser, selectedProjectChat, view]);

  useEffect(() => {
    if (!availableSections.includes(activeSection)) {
      setActiveSection(availableSections[0]);
    }
  }, [activeSection, availableSections]);

  useEffect(() => {
    if (selectedUser && !allUsers.some(candidate => candidate.id === selectedUser.id)) {
      setSelectedUser(null);
    }
  }, [allUsers, selectedUser]);

  useEffect(() => {
    if (
      selectedProjectChat &&
      !projectChats.some(candidate => candidate.project.id === selectedProjectChat.project.id)
    ) {
      setSelectedProjectChat(null);
    }
  }, [projectChats, selectedProjectChat]);

  useEffect(() => {
    if (!requestedProjectId || loading) return;

    const matchedProjectChat = projectChats.find(chat => chat.project.id === requestedProjectId);
    if (matchedProjectChat) {
      setSelectedProjectChat(matchedProjectChat);
      setSelectedUser(null);
      setSelectedProposalApplication(null);
      setProposalIntent(null);
      setView('detail');
    }

    navigation.setParams({ projectId: undefined });
  }, [requestedProjectId, loading, navigation, projectChats]);

  useEffect(() => {
    if (newProposalModule || newProposalProjectId) {
      setProposalIntent({
        module: newProposalModule,
        projectId: newProposalProjectId,
        title: newProposalTitle
      });
      setProposalForm(f => ({ ...f, proposedTitle: newProposalTitle || '' }));
      setView('detail');

      // Auto-select Admin for proposals
      const admin = allUsers.find(u => u.role === 'admin');
      if (admin) {
        setSelectedUser(admin);
      } else {
        setSelectedUser(null);
      }

      setSelectedProjectChat(null);
      setSelectedProposalApplication(null);
      navigation.setParams({ newProposalModule: undefined, newProposalProjectId: undefined, newProposalTitle: undefined });
    }
  }, [newProposalModule, newProposalProjectId, newProposalTitle, navigation]);

  const PROPOSAL_PREFIX = '___PROPOSAL_CARD___:';

  const handleSendProposalCard = async (overrideForm?: any) => {
    if (!user || (!selectedUser && !selectedProjectChat)) return;
    setIsSending(true);

    const formData = overrideForm || proposalForm;
    const proposalData = {
      ...formData,
      status: 'Proposed',
      proposedById: user.id,
      proposedByName: user.name,
      timestamp: new Date().toISOString(),
    };

    const msg = {
      id: `prop-${Date.now()}`,
      senderId: user.id,
      content: `${PROPOSAL_PREFIX}${JSON.stringify(proposalData)}`,
      timestamp: new Date().toISOString(),
    };

    try {
      if (selectedUser) {
        const fullMsg: Message = { ...msg, recipientId: selectedUser.id, read: false };
        await saveMessage(fullMsg);
        setMessages(curr => [...curr, fullMsg]);
      } else if (selectedProjectChat) {
        const fullMsg: ProjectGroupMessage = { ...msg, projectId: selectedProjectChat.project.id, kind: 'scope-proposal' as any };
        await saveProjectGroupMessage(fullMsg);
        setMessages(curr => [...curr, fullMsg]);
      }
      setShowMessageHub(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to send proposal card');
    } finally {
      setIsSending(false);
    }
  };

  const handleApproveProposal = async (msgId: string, currentData: any) => {
    if (user?.role !== 'admin') return;

    const updatedData = { ...currentData, status: 'Approved', approvedBy: user.id, approvedAt: new Date().toISOString() };
    const updatedContent = `${PROPOSAL_PREFIX}${JSON.stringify(updatedData)}`;

    try {
      // In a real app, we'd update the specific message. Here we send an "Approval" message or update local state.
      // For this demo, let's send a final approved card.
      const msg = {
        id: `appr-${Date.now()}`,
        senderId: user.id,
        content: updatedContent,
        timestamp: new Date().toISOString(),
      };

      if (selectedUser) {
        await saveMessage({ ...msg, recipientId: selectedUser.id, read: false });
      }
      setMessages(curr => [...curr, msg as any]);
      Alert.alert('Approved', 'The proposal has been officially approved.');
    } catch (e) {
      Alert.alert('Error', 'Failed to approve proposal');
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const handlePickAttachment = async (type: 'photo' | 'file') => {
    try {
      setShowAttachmentMenu(false);
      const uri = type === 'photo'
        ? await pickImageFromDevice()
        : await pickDocumentFromDevice();

      if (!uri) {
        return;
      }

      setPendingAttachments(current => [...current, uri]);
    } catch (error) {
      Alert.alert(
        type === 'photo' ? 'Photo Upload Failed' : 'File Upload Failed',
        error instanceof Error ? error.message : 'Unable to attach this file. Please try again.'
      );
    }
  };

  const removePendingAttachment = (attachmentUri: string) => {
    setPendingAttachments(current => current.filter(uri => uri !== attachmentUri));
  };

  const handleLeaveEventGc = () => {
    if (!user?.id || user.role !== 'volunteer' || !selectedProjectChat) {
      return;
    }

    const eventTitle = selectedProjectChat.project.title;
    Alert.alert(
      'Leave Event GC',
      `Leave "${eventTitle}"? You will be removed from this event group chat.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              setShowConversationMenu(false);
              await leaveVolunteerEventGroup(selectedProjectChat.project.id, user.id);
              setSelectedProjectChat(null);
              setMessages([]);
              setView(isWide ? 'detail' : 'sidebar');
              await loadData();
              Alert.alert('Left GC', `You left "${eventTitle}".`);
            } catch (error) {
              Alert.alert(
                'Unable to Leave',
                getRequestErrorMessage(error, 'Failed to leave this event group chat. Please try again.')
              );
            }
          },
        },
      ]
    );
  };

  const handleSendMessage = async () => {
    const trimmedMessage = messageText.trim();
    if (!user || (!trimmedMessage && pendingAttachments.length === 0) || isSending) return;
    setIsSending(true);
    const msg = {
      id: `msg-${Date.now()}`,
      senderId: user.id,
      content: trimmedMessage || 'Attachment',
      timestamp: new Date().toISOString(),
      attachments: pendingAttachments,
    };
    try {
      if (selectedUser) {
        const fullMsg: Message = { ...msg, recipientId: selectedUser.id, read: false };
        await saveMessage(fullMsg);
        setMessages(curr => [...curr, fullMsg]);
      } else if (selectedProjectChat) {
        const fullMsg: ProjectGroupMessage = { ...msg, projectId: selectedProjectChat.project.id, kind: 'message' };
        await saveProjectGroupMessage(fullMsg);
        setMessages(curr => [...curr, fullMsg]);
      }
      setMessageText('');
      setPendingAttachments([]);
    } catch (e) {
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmitProposal = async () => {
    if (!user || !proposalIntent) return;
    try {
      await submitPartnerProgramProposal(proposalIntent.projectId || 'new', user, {
        programModule: (proposalIntent.module as AdvocacyFocus) || 'Nutrition',
        proposalDetails: {
          ...proposalForm,
          proposedVolunteersNeeded: Number(proposalForm.proposedVolunteersNeeded) || 0,
          requestedProgramModule: (proposalIntent.module as AdvocacyFocus) || 'Nutrition',
          targetProjectId: proposalIntent.projectId,
        }
      });
      Alert.alert('Success', 'Your proposal has been submitted for review.');
      setProposalIntent(null);
      setView(isWide ? 'detail' : 'sidebar');
      void loadData();
    } catch (e) {
      Alert.alert('Error', 'Failed to submit proposal. Please check your connection.');
    }
  };

  useEffect(() => {
    const composed = composePhilippineAddress(locRegion, locCity, locBarangay);
    setProposalForm(f => ({ ...f, proposedLocation: composed }));
  }, [locRegion, locCity, locBarangay]);

  const handleReview = async (app: PartnerProjectApplication, status: 'Approved' | 'Rejected') => {
    try {
      await reviewPartnerProjectApplication(app.id, status, user?.id || '');
      Alert.alert('Success', `Proposal has been ${status.toLowerCase()}.`);
      setSelectedProposalApplication(null);
      setView(isWide ? 'detail' : 'sidebar');
      void loadData();
    } catch (e) {
      Alert.alert('Error', 'Failed to complete review.');
    }
  };

  const filteredConversations = conversations.filter(c => c.user.name.toLowerCase().includes(searchText.toLowerCase()));
  const filteredProjects = projectChats.filter(c => c.project.title.toLowerCase().includes(searchText.toLowerCase()));
  const filteredProposals = proposalChats.filter(c => c.application.partnerName.toLowerCase().includes(searchText.toLowerCase()) || c.projectTitle.toLowerCase().includes(searchText.toLowerCase()));
  const filteredUsers = allUsers.filter(u => u.name.toLowerCase().includes(searchText.toLowerCase()));

  const renderSidebarItem = (
    id: string,
    title: string,
    subtitle: string,
    active: boolean,
    onPress: () => void,
    options?: { avatar?: string; icon?: string; badge?: number; color?: string }
  ) => (
    <TouchableOpacity
      key={id}
      style={[styles.sidebarItem, active && styles.sidebarItemActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.sidebarAvatar, { backgroundColor: options?.color || '#166534' }]}>
        {options?.icon ? (
          <MaterialIcons name={options.icon as any} size={20} color="#fff" />
        ) : (
          <Text style={styles.sidebarAvatarText}>{title[0].toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.sidebarItemInfo}>
        <View style={styles.sidebarItemHeader}>
          <Text style={[styles.sidebarItemTitle, active && styles.sidebarItemTitleActive]} numberOfLines={1}>
            {title}
          </Text>
          {options?.badge ? (
            <View style={styles.sidebarBadge}>
              <Text style={styles.sidebarBadgeText}>{options.badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.sidebarItemSubtitle, active && styles.sidebarItemSubtitleActive]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderSidebar = () => (
    <View style={[styles.sidebar, !isWide && view === 'detail' && styles.hidden]}>
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarHeaderTitle}>Messages</Text>
        <TouchableOpacity style={styles.sidebarHeaderAction}>
          <Ionicons name="create-outline" size={22} color="#166534" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color="#94a3b8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search..."
          value={searchText}
          onChangeText={setSearchText}
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.sectionTabs}>
        {availableSections.map(s => (
          <TouchableOpacity
            key={s}
            onPress={() => setActiveSection(s)}
            style={[styles.sectionTab, activeSection === s && styles.sectionTabActive]}
          >
            <Text style={[styles.sectionTabText, activeSection === s && styles.sectionTabTextActive]}>
              {s === 'projects' ? 'Event GC' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.sidebarList}>
        {activeSection === 'messages' && (
          <>
            <Text style={styles.listSectionLabel}>General</Text>
            {renderSidebarItem('admin-nvc', 'Admin NVC', 'System support and updates', false, () => {
              const admin = allUsers.find(u => u.role === 'admin');
              if (admin) {
                setSelectedUser(admin); setSelectedProjectChat(null); setSelectedProposalApplication(null); setProposalIntent(null); setView('detail');
              } else {
                Alert.alert('Notice', 'Admin contact not available in this session.');
              }
            }, { icon: 'verified-user', color: '#0369a1' })}

            <Text style={styles.listSectionLabel}>Conversations</Text>
            {filteredConversations.length > 0 ? (
              filteredConversations.map(c => renderSidebarItem(
                c.user.id,
                c.user.name,
                c.lastMessage?.content || 'Start a conversation',
                selectedUser?.id === c.user.id,
                () => { setSelectedUser(c.user); setSelectedProjectChat(null); setSelectedProposalApplication(null); setProposalIntent(null); setView('detail'); },
                { badge: c.unreadCount }
              ))
            ) : (
              <Text style={styles.emptyListText}>No conversations yet</Text>
            )}
          </>
        )}

        {activeSection === 'projects' && (
          <>
            <Text style={styles.listSectionLabel}>Event GC</Text>
            {filteredProjects.length > 0 ? (
              filteredProjects.map(p => renderSidebarItem(
                p.project.id,
                p.project.title,
                `${p.participantCount} participants`,
                selectedProjectChat?.project.id === p.project.id,
                () => { setSelectedProjectChat(p); setSelectedUser(null); setSelectedProposalApplication(null); setProposalIntent(null); setView('detail'); },
                { icon: 'groups' }
              ))
            ) : (
              <Text style={styles.emptyListText}>
                {isVolunteer ? 'No joined event GC yet' : 'No event GC available'}
              </Text>
            )}
          </>
        )}

        {activeSection === 'proposals' && (
          <>
            <Text style={styles.listSectionLabel}>Project Proposals</Text>
            {filteredProposals.length > 0 ? (
              filteredProposals.map(p => renderSidebarItem(
                p.application.id,
                p.projectTitle,
                `${p.application.partnerName} • ${p.application.status}`,
                selectedProposalApplication?.id === p.application.id,
                () => { setSelectedProposalApplication(p.application); setSelectedUser(null); setSelectedProjectChat(null); setProposalIntent(null); setView('detail'); },
                { icon: 'description', color: p.application.status === 'Approved' ? '#166534' : '#f59e0b' }
              ))
            ) : (
              <Text style={styles.emptyListText}>No proposals found</Text>
            )}
          </>
        )}

        {activeSection === 'contacts' && (
          <>
            <Text style={styles.listSectionLabel}>All Contacts</Text>
            {filteredUsers.length > 0 ? (
              filteredUsers.map(u => renderSidebarItem(
                u.id,
                u.name,
                u.role.toUpperCase(),
                selectedUser?.id === u.id,
                () => { setSelectedUser(u); setSelectedProjectChat(null); setSelectedProposalApplication(null); setProposalIntent(null); setView('detail'); }
              ))
            ) : (
              <Text style={styles.emptyListText}>No contacts found</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  const renderDetail = () => {
    if (!isWide && view === 'sidebar') return null;

    if (proposalIntent) {
      return (
        <View style={styles.detail}>
          <View style={styles.detailHeader}>
            {!isWide && (
              <TouchableOpacity onPress={() => setView('sidebar')} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#166534" />
              </TouchableOpacity>
            )}
            <View>
              <Text style={styles.detailTitle}>New Project Proposal</Text>
              <Text style={styles.detailSubtitle}>Track: {proposalIntent.module}</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.detailScrollContent}>
            <View style={styles.proposalCard}>
              <View style={styles.proposalHeader}>
                <Ionicons name="document-text" size={32} color="#166534" />
                <View>
                  <Text style={styles.proposalTitle}>Project Specifications</Text>
                  <Text style={styles.proposalMeta}>Provide details for the {proposalIntent.module} program</Text>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Project Title</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Community Nutrition Drive 2024"
                  value={proposalForm.proposedTitle}
                  onChangeText={t => setProposalForm(f => ({ ...f, proposedTitle: t }))}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Detailed Description</Text>
                <TextInput
                  style={[styles.formInput, { height: 120, textAlignVertical: 'top' }]}
                  multiline
                  placeholder="Outline the goals, target beneficiaries, and scope..."
                  value={proposalForm.proposedDescription}
                  onChangeText={t => setProposalForm(f => ({ ...f, proposedDescription: t }))}
                />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Start Date</Text>
                  <TouchableOpacity
                    style={styles.pickerTrigger}
                    onPress={() => setShowStartDatePicker(true)}
                  >
                    <MaterialIcons name="calendar-today" size={18} color="#166534" />
                    <Text style={[styles.pickerTriggerText, !proposalForm.proposedStartDate && styles.pickerPlaceholder]}>
                      {proposalForm.proposedStartDate || 'Select date'}
                    </Text>
                  </TouchableOpacity>
                  {showStartDatePicker && (
                    <LazyDateTimePicker
                      value={proposalForm.proposedStartDate ? new Date(proposalForm.proposedStartDate) : new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                      onChange={(event: any, date?: Date) => {
                        setShowStartDatePicker(false);
                        if (date) setProposalForm(f => ({ ...f, proposedStartDate: date.toISOString().split('T')[0] }));
                      }}
                    />
                  )}
                </View>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.formLabel}>End Date</Text>
                  <TouchableOpacity
                    style={styles.pickerTrigger}
                    onPress={() => setShowEndDatePicker(true)}
                  >
                    <MaterialIcons name="calendar-today" size={18} color="#166534" />
                    <Text style={[styles.pickerTriggerText, !proposalForm.proposedEndDate && styles.pickerPlaceholder]}>
                      {proposalForm.proposedEndDate || 'Select date'}
                    </Text>
                  </TouchableOpacity>
                  {showEndDatePicker && (
                    <LazyDateTimePicker
                      value={proposalForm.proposedEndDate ? new Date(proposalForm.proposedEndDate) : new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                      onChange={(event: any, date?: Date) => {
                        setShowEndDatePicker(false);
                        if (date) setProposalForm(f => ({ ...f, proposedEndDate: date.toISOString().split('T')[0] }));
                      }}
                    />
                  )}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Target Location</Text>
                <View style={styles.addressContainer}>
                  <View style={styles.pickerWrap}>
                    <Text style={styles.pickerLabel}>Region</Text>
                    <View style={styles.pickerBorder}>
                      <Picker
                        selectedValue={selectedRegionCode}
                        onValueChange={(code) => {
                          setSelectedRegionCode(code);
                          const region = PHRegions.find(r => r.code === code);
                          setLocRegion(region ? region.name : '');
                          setFilteredCities(getCitiesByRegion(code));
                          setSelectedCityCode('');
                          setLocCity('');
                          setLocBarangay('');
                        }}
                        style={styles.picker}
                      >
                        <Picker.Item label="Select Region" value="" color="#94a3b8" />
                        {PHRegions.map(r => <Picker.Item key={r.code} label={r.name} value={r.code} />)}
                      </Picker>
                    </View>
                  </View>

                  <View style={styles.pickerWrap}>
                    <Text style={styles.pickerLabel}>City / Municipality</Text>
                    <View style={styles.pickerBorder}>
                      <Picker
                        selectedValue={selectedCityCode}
                        enabled={!!selectedRegionCode}
                        onValueChange={(code) => {
                          setSelectedCityCode(code);
                          const city = filteredCities.find(c => c.code === code);
                          setLocCity(city ? city.name : '');
                          setFilteredBarangays(getBarangaysByCity(code));
                          setLocBarangay('');
                        }}
                        style={styles.picker}
                      >
                        <Picker.Item label="Select City" value="" color="#94a3b8" />
                        {filteredCities.map(c => <Picker.Item key={c.code} label={c.name} value={c.code} />)}
                      </Picker>
                    </View>
                  </View>

                  <View style={styles.pickerWrap}>
                    <Text style={styles.pickerLabel}>Barangay</Text>
                    <View style={styles.pickerBorder}>
                      <Picker
                        selectedValue={locBarangay}
                        enabled={!!selectedCityCode}
                        onValueChange={(name) => setLocBarangay(name)}
                        style={styles.picker}
                      >
                        <Picker.Item label="Select Barangay" value="" color="#94a3b8" />
                        {filteredBarangays.map(b => <Picker.Item key={b.name} label={b.name} value={b.name} />)}
                      </Picker>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Volunteers Needed</Text>
                <TextInput style={styles.formInput} placeholder="Number of volunteers" keyboardType="numeric" value={proposalForm.proposedVolunteersNeeded} onChangeText={t => setProposalForm(f => ({ ...f, proposedVolunteersNeeded: t }))} />
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleSubmitProposal}>
                <Text style={styles.submitBtnText}>Submit Proposal for Review</Text>
                <MaterialIcons name="send" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      );
    }

    if (selectedProposalApplication) {
      const app = selectedProposalApplication;
      return (
        <View style={styles.detail}>
          <View style={styles.detailHeader}>
            {!isWide && (
              <TouchableOpacity onPress={() => setView('sidebar')} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#166534" />
              </TouchableOpacity>
            )}
            <View>
              <Text style={styles.detailTitle}>Proposal Review</Text>
              <Text style={styles.detailSubtitle}>{app.partnerName}</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.detailScrollContent}>
            <View style={styles.proposalCard}>
              <View style={styles.statusBanner}>
                <MaterialIcons name="info" size={20} color={app.status === 'Approved' ? '#166534' : '#f59e0b'} />
                <Text style={[styles.statusText, { color: app.status === 'Approved' ? '#166534' : '#f59e0b' }]}>
                  Current Status: {app.status}
                </Text>
              </View>

              <Text style={styles.previewTitle}>{app.proposalDetails?.proposedTitle}</Text>
              <Text style={styles.previewSectionLabel}>PROJECT DESCRIPTION</Text>
              <Text style={styles.previewText}>{app.proposalDetails?.proposedDescription}</Text>

              <View style={styles.previewGrid}>
                <View style={styles.previewGridItem}>
                  <Text style={styles.previewSectionLabel}>TIMELINE</Text>
                  <Text style={styles.previewText}>{app.proposalDetails?.proposedStartDate} to {app.proposalDetails?.proposedEndDate}</Text>
                </View>
                <View style={styles.previewGridItem}>
                  <Text style={styles.previewSectionLabel}>LOCATION</Text>
                  <Text style={styles.previewText}>{app.proposalDetails?.proposedLocation}</Text>
                </View>
              </View>

              {user?.role === 'admin' && app.status === 'Pending' && (
                <View style={styles.adminActionRow}>
                  <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleReview(app, 'Approved')}>
                    <Text style={styles.actionBtnText}>Approve Proposal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleReview(app, 'Rejected')}>
                    <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      );
    }

    if (!selectedUser && !selectedProjectChat) {
      return (
        <View style={styles.detailEmpty}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="chatbubbles-outline" size={64} color="#166534" />
          </View>
          <Text style={styles.emptyTitle}>Your Workspace Hub</Text>
          <Text style={styles.emptySubtitle}>Select an admin conversation or Event GC to start collaborating</Text>
        </View>
      );
    }

    const title = selectedUser?.name || selectedProjectChat?.project.title;
    const subtitle = selectedUser
      ? (selectedUser.role === 'admin' ? 'System Admin' : 'Direct Message')
      : 'Event GC';

    return (
      <View style={styles.detail}>
        <View style={styles.detailHeader}>
          {!isWide && (
            <TouchableOpacity onPress={() => setView('sidebar')} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#166534" />
            </TouchableOpacity>
          )}
          <View style={styles.headerInfo}>
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>{title?.[0].toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.detailTitle}>{title}</Text>
              <Text style={styles.detailSubtitle}>{subtitle}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            {selectedProjectChat && user?.role === 'volunteer' ? (
              <View style={styles.conversationMenuWrap}>
                <TouchableOpacity
                  style={styles.headerAction}
                  onPress={() => setShowConversationMenu(current => !current)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="ellipsis-vertical" size={22} color="#64748b" />
                </TouchableOpacity>
                {showConversationMenu ? (
                  <View style={styles.conversationMenu}>
                    <TouchableOpacity
                      style={styles.conversationMenuItem}
                      onPress={handleLeaveEventGc}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons name="logout" size={18} color="#dc2626" />
                      <Text style={styles.conversationMenuDangerText}>Leave GC</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesListContent}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>Secure, end-to-end encrypted messaging.</Text>
            </View>
          ) : (
            messages.map((m, i) => {
              const isOwn = m.senderId === user?.id;
              const isProposal = m.content.startsWith(PROPOSAL_PREFIX);

              if (isProposal) {
                let data: any = {};
                try {
                  data = JSON.parse(m.content.replace(PROPOSAL_PREFIX, ''));
                } catch (e) { return null; }

                const isApproved = data.status === 'Approved';

                return (
                  <View key={m.id} style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther, { maxWidth: '90%' }]}>
                    <View style={styles.proposalMsgCard}>
                      <View style={styles.propCardHeader}>
                        <View style={styles.propCardIconBox}>
                          <MaterialIcons name="assignment" size={24} color="#d97706" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.propCardTitle}>{data.proposedTitle || 'Untitled Proposal'}</Text>
                          <Text style={styles.propCardSubtitle}>Project Proposal • {data.status}</Text>
                        </View>
                        {isApproved && (
                          <View style={styles.propApprovedBadge}>
                            <MaterialIcons name="check-circle" size={16} color="#166534" />
                            <Text style={styles.propApprovedText}>Approved</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.propCardBody}>
                        <Text style={styles.propCardDesc} numberOfLines={3}>
                          {data.proposedDescription || 'No description provided.'}
                        </Text>

                        <View style={styles.propCardMetaGrid}>
                          <View style={styles.propCardMetaItem}>
                            <MaterialIcons name="event" size={14} color="#64748b" />
                            <Text style={styles.propCardMetaText}>{data.proposedStartDate || 'TBD'}</Text>
                          </View>
                          <View style={styles.propCardMetaItem}>
                            <MaterialIcons name="people" size={14} color="#64748b" />
                            <Text style={styles.propCardMetaText}>{data.proposedVolunteersNeeded || '0'} Volunteers</Text>
                          </View>
                          <View style={styles.propCardMetaItem}>
                            <MaterialIcons name="location-on" size={14} color="#64748b" />
                            <Text style={styles.propCardMetaText} numberOfLines={1}>{data.proposedLocation || 'Flexible'}</Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.propCardFooter}>
                        {!isApproved && (
                          <TouchableOpacity
                            style={styles.propCardEditBtn}
                            onPress={() => {
                              setProposalForm(data);
                              setShowMessageHub(true);
                            }}
                          >
                            <MaterialIcons name="edit" size={16} color="#475569" />
                            <Text style={styles.propCardEditBtnText}>Edit Details</Text>
                          </TouchableOpacity>
                        )}

                        {user?.role === 'admin' && !isApproved && (
                          <TouchableOpacity
                            style={styles.propCardApproveBtn}
                            onPress={() => handleApproveProposal(m.id, data)}
                          >
                            <MaterialIcons name="check" size={16} color="#fff" />
                            <Text style={styles.propCardApproveBtnText}>Approve</Text>
                          </TouchableOpacity>
                        )}

                        {isApproved && (
                          <TouchableOpacity style={styles.propCardViewBtn}>
                            <Text style={styles.propCardViewBtnText}>View Full Scope</Text>
                            <MaterialIcons name="arrow-forward" size={16} color="#166534" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    <Text style={styles.messageTime}>
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                );
              }

              const messageAttachments = m.attachments || [];

              return (
                <View key={m.id} style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
                  <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
                    {m.content ? (
                      <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{m.content}</Text>
                    ) : null}
                    {messageAttachments.length > 0 ? (
                      <View style={styles.messageAttachmentList}>
                        {messageAttachments.map((attachmentUri, attachmentIndex) => {
                          const attachmentName = getAttachmentName(attachmentUri, attachmentIndex);
                          const isImageAttachment = isImageMediaUri(attachmentUri);

                          return (
                            <TouchableOpacity
                              key={`${m.id}-attachment-${attachmentIndex}`}
                              style={[
                                styles.messageAttachmentCard,
                                isOwn && styles.messageAttachmentCardOwn,
                              ]}
                              onPress={() => {
                                void Linking.openURL(attachmentUri).catch(() => {
                                  Alert.alert('Attachment', 'Unable to open this attachment on this device.');
                                });
                              }}
                              activeOpacity={0.85}
                            >
                              {isImageAttachment ? (
                                <Image source={{ uri: attachmentUri }} style={styles.messageAttachmentImage} />
                              ) : (
                                <View style={[styles.messageAttachmentFileIcon, isOwn && styles.messageAttachmentFileIconOwn]}>
                                  <MaterialIcons name="insert-drive-file" size={22} color={isOwn ? '#dcfce7' : '#166534'} />
                                </View>
                              )}
                              <Text
                                style={[
                                  styles.messageAttachmentName,
                                  isOwn && styles.messageAttachmentNameOwn,
                                ]}
                                numberOfLines={1}
                              >
                                {attachmentName}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.messageTime}>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Message Hub Template Panel — Partner ↔ Admin chats only */}
        {((user?.role === 'partner' && selectedUser?.role === 'admin') || (user?.role === 'admin' && selectedUser?.role === 'partner')) && (
          <View style={styles.msgHubOuter}>
            {/* Toggle bar */}
            <TouchableOpacity
              style={styles.msgHubToggle}
              onPress={() => setShowMessageHub(!showMessageHub)}
              activeOpacity={0.8}
            >
              <View style={styles.msgHubToggleLeft}>
                <View style={styles.msgHubPIcon}>
                  <Text style={styles.msgHubPIconText}>P</Text>
                </View>
                <Text style={styles.msgHubToggleTitle}>Message Hub</Text>
              </View>
              <Ionicons name={showMessageHub ? 'chevron-down' : 'chevron-up'} size={20} color="#64748b" />
            </TouchableOpacity>

            {showMessageHub && (
              <View style={styles.msgHubPanel}>
                {/* Tabs */}
                <View style={styles.msgHubTabs}>
                  <TouchableOpacity
                    style={[styles.msgHubTab, styles.msgHubTabActive]}
                    activeOpacity={1}
                  >
                    <MaterialIcons name="description" size={18} color="#d97706" />
                    <Text style={[styles.msgHubTabText, styles.msgHubTabTextActive]}>Project proposal scope</Text>
                  </TouchableOpacity>
                </View>


                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator>
                  <View style={styles.msgHubFormWrap}>
                    {/* Proposal Form Fields — same as main proposal form */}
                    <View style={styles.msgHubFormGroup}>
                      <Text style={styles.msgHubFieldLabel}>Project Title</Text>
                      <TextInput
                        style={styles.msgHubFormInput}
                        placeholder="e.g. Community Nutrition Drive 2024"
                        placeholderTextColor="#94a3b8"
                        value={proposalForm.proposedTitle}
                        onChangeText={t => setProposalForm(f => ({ ...f, proposedTitle: t }))}
                      />
                    </View>

                    <View style={styles.msgHubFormGroup}>
                      <Text style={styles.msgHubFieldLabel}>Detailed Description</Text>

                      {/* Rich Editor Toolbar moved here */}
                      <View style={[styles.msgHubToolbar, { marginBottom: 0, borderBottomWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
                        {[
                          { icon: 'format-bold', label: 'B' },
                          { icon: 'format-italic', label: 'I' },
                          { icon: 'format-underlined', label: 'U' },
                          { icon: 'format-strikethrough', label: 'S' },
                        ].map(btn => (
                          <TouchableOpacity key={btn.icon} style={styles.msgHubToolBtn}>
                            <MaterialIcons name={btn.icon as any} size={20} color="#475569" />
                          </TouchableOpacity>
                        ))}
                        <View style={styles.msgHubToolDivider} />
                        <TouchableOpacity style={styles.msgHubToolBtn}>
                          <MaterialIcons name="format-size" size={20} color="#475569" />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.msgHubToolBtn}>
                          <MaterialIcons name="format-color-text" size={20} color="#475569" />
                        </TouchableOpacity>
                        <View style={styles.msgHubToolDivider} />
                        <TouchableOpacity style={styles.msgHubToolBtn}>
                          <MaterialIcons name="link" size={20} color="#475569" />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.msgHubToolBtn}>
                          <MaterialIcons name="format-quote" size={20} color="#475569" />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.msgHubToolBtn}>
                          <View style={styles.msgHubColorSwatch} />
                        </TouchableOpacity>
                      </View>

                      <TextInput
                        style={[styles.msgHubFormInput, { minHeight: 120, textAlignVertical: 'top', borderTopLeftRadius: 0, borderTopRightRadius: 0 }]}
                        multiline
                        numberOfLines={4}
                        placeholder="Outline the goals, target beneficiaries, and scope..."
                        placeholderTextColor="#94a3b8"
                        value={proposalForm.proposedDescription}
                        onChangeText={t => setProposalForm(f => ({ ...f, proposedDescription: t }))}
                      />
                    </View>

                    <View style={styles.msgHubFormRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.msgHubFieldLabel}>Start Date</Text>
                        <TouchableOpacity
                          style={styles.msgHubDateTrigger}
                          onPress={() => setShowStartDatePicker(true)}
                        >
                          <MaterialIcons name="calendar-today" size={16} color="#166534" />
                          <Text style={[styles.msgHubDateText, !proposalForm.proposedStartDate && { color: '#94a3b8' }]}>
                            {proposalForm.proposedStartDate || 'Select date'}
                          </Text>
                        </TouchableOpacity>
                        {showStartDatePicker && (
                          <LazyDateTimePicker
                            value={proposalForm.proposedStartDate ? new Date(proposalForm.proposedStartDate) : new Date()}
                            mode="date"
                            display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                            onChange={(event: any, date?: Date) => {
                              setShowStartDatePicker(false);
                              if (date) setProposalForm(f => ({ ...f, proposedStartDate: date.toISOString().split('T')[0] }));
                            }}
                          />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.msgHubFieldLabel}>End Date</Text>
                        <TouchableOpacity
                          style={styles.msgHubDateTrigger}
                          onPress={() => setShowEndDatePicker(true)}
                        >
                          <MaterialIcons name="calendar-today" size={16} color="#166534" />
                          <Text style={[styles.msgHubDateText, !proposalForm.proposedEndDate && { color: '#94a3b8' }]}>
                            {proposalForm.proposedEndDate || 'Select date'}
                          </Text>
                        </TouchableOpacity>
                        {showEndDatePicker && (
                          <LazyDateTimePicker
                            value={proposalForm.proposedEndDate ? new Date(proposalForm.proposedEndDate) : new Date()}
                            mode="date"
                            display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                            onChange={(event: any, date?: Date) => {
                              setShowEndDatePicker(false);
                              if (date) setProposalForm(f => ({ ...f, proposedEndDate: date.toISOString().split('T')[0] }));
                            }}
                          />
                        )}
                      </View>
                    </View>

                    <View style={styles.msgHubFormGroup}>
                      <Text style={styles.msgHubFieldLabel}>Target Location</Text>
                      <View style={styles.msgHubAddrGrid}>
                        <View style={styles.msgHubAddrItem}>
                          <Text style={styles.msgHubAddrLabel}>Region</Text>
                          <View style={styles.msgHubAddrPickerBorder}>
                            <Picker
                              selectedValue={selectedRegionCode}
                              onValueChange={(code) => {
                                setSelectedRegionCode(code);
                                const region = PHRegions.find(r => r.code === code);
                                setLocRegion(region ? region.name : '');
                                setFilteredCities(getCitiesByRegion(code));
                                setSelectedCityCode('');
                                setLocCity('');
                                setLocBarangay('');
                              }}
                              style={styles.msgHubAddrPicker}
                            >
                              <Picker.Item label="Select Region" value="" color="#94a3b8" />
                              {PHRegions.map(r => <Picker.Item key={r.code} label={r.name} value={r.code} />)}
                            </Picker>
                          </View>
                        </View>
                        <View style={styles.msgHubAddrItem}>
                          <Text style={styles.msgHubAddrLabel}>City / Municipality</Text>
                          <View style={styles.msgHubAddrPickerBorder}>
                            <Picker
                              selectedValue={selectedCityCode}
                              enabled={!!selectedRegionCode}
                              onValueChange={(code) => {
                                setSelectedCityCode(code);
                                const city = filteredCities.find(c => c.code === code);
                                setLocCity(city ? city.name : '');
                                setFilteredBarangays(getBarangaysByCity(code));
                                setLocBarangay('');
                              }}
                              style={styles.msgHubAddrPicker}
                            >
                              <Picker.Item label="Select City" value="" color="#94a3b8" />
                              {filteredCities.map(c => <Picker.Item key={c.code} label={c.name} value={c.code} />)}
                            </Picker>
                          </View>
                        </View>
                        <View style={styles.msgHubAddrItem}>
                          <Text style={styles.msgHubAddrLabel}>Barangay</Text>
                          <View style={styles.msgHubAddrPickerBorder}>
                            <Picker
                              selectedValue={locBarangay}
                              enabled={!!selectedCityCode}
                              onValueChange={(name) => setLocBarangay(name)}
                              style={styles.msgHubAddrPicker}
                            >
                              <Picker.Item label="Select Barangay" value="" color="#94a3b8" />
                              {filteredBarangays.map(b => <Picker.Item key={b.name} label={b.name} value={b.name} />)}
                            </Picker>
                          </View>
                        </View>
                      </View>
                    </View>

                    <View style={styles.msgHubFormRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.msgHubFieldLabel}>Volunteers Needed</Text>
                        <TextInput
                          style={styles.msgHubFormInput}
                          placeholder="Number of volunteers"
                          placeholderTextColor="#94a3b8"
                          keyboardType="numeric"
                          value={proposalForm.proposedVolunteersNeeded}
                          onChangeText={t => setProposalForm(f => ({ ...f, proposedVolunteersNeeded: t }))}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.msgHubFieldLabel}>Community Need</Text>
                        <TextInput
                          style={styles.msgHubFormInput}
                          placeholder="What need does this address?"
                          placeholderTextColor="#94a3b8"
                          value={proposalForm.communityNeed}
                          onChangeText={t => setProposalForm(f => ({ ...f, communityNeed: t }))}
                        />
                      </View>
                    </View>

                    <View style={styles.msgHubFormGroup}>
                      <Text style={styles.msgHubFieldLabel}>Expected Deliverables</Text>
                      <TextInput
                        style={[styles.msgHubFormInput, { minHeight: 80, textAlignVertical: 'top' }]}
                        multiline
                        numberOfLines={3}
                        placeholder="List out the tangible outcomes or deliverables..."
                        placeholderTextColor="#94a3b8"
                        value={proposalForm.expectedDeliverables}
                        onChangeText={t => setProposalForm(f => ({ ...f, expectedDeliverables: t }))}
                      />
                    </View>
                  </View>
                </ScrollView>


                {/* Footer: Active/Inactive toggle + action buttons */}
                <View style={styles.msgHubFooter}>
                  <View style={styles.msgHubToggleRow}>
                    <View>
                      <Text style={styles.msgHubToggleLabel}>Active or Inactive <Text style={{ color: '#ef4444' }}>*</Text></Text>
                      <Text style={styles.msgHubToggleSub}>Enable or disable this template</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.msgHubSwitch, templateActive && styles.msgHubSwitchOn]}
                      onPress={() => setTemplateActive(!templateActive)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.msgHubSwitchThumb, templateActive && styles.msgHubSwitchThumbOn]} />
                      <Text style={[styles.msgHubSwitchLabel, templateActive && styles.msgHubSwitchLabelOn]}>
                        {templateActive ? 'Active' : 'Inactive'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.msgHubBtnRow}>
                    {user?.role === 'partner' && (
                      <TouchableOpacity
                        style={styles.msgHubSubmitProposalBtn}
                        onPress={() => {
                          if (!proposalForm.proposedTitle.trim()) {
                            Alert.alert('Validation', 'Please enter a project title.');
                            return;
                          }
                          // Build proposal intent from form and submit
                          const intent = {
                            module: (proposalIntent as any)?.module || 'Nutrition',
                            projectId: (proposalIntent as any)?.projectId || 'new',
                            title: proposalForm.proposedTitle,
                          };
                          setProposalIntent(intent);
                          handleSubmitProposal();
                        }}
                      >
                        <MaterialIcons name="task-alt" size={18} color="#fff" />
                        <Text style={styles.msgHubSendBtnText}>Submit Proposal</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.msgHubSendBtn}
                      onPress={() => handleSendProposalCard()}
                    >
                      <MaterialIcons name="send" size={18} color="#fff" />
                      <Text style={styles.msgHubSendBtnText}>Send Proposal Card</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {showAttachmentMenu ? (
            <View style={styles.attachmentMenu}>
              <TouchableOpacity
                style={styles.attachmentMenuButton}
                onPress={() => void handlePickAttachment('photo')}
                activeOpacity={0.85}
              >
                <View style={styles.attachmentMenuIcon}>
                  <Ionicons name="image-outline" size={20} color="#166534" />
                </View>
                <View style={styles.attachmentMenuTextWrap}>
                  <Text style={styles.attachmentMenuTitle}>Photo upload</Text>
                  <Text style={styles.attachmentMenuSubtitle}>Attach an image from this device</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachmentMenuButton}
                onPress={() => void handlePickAttachment('file')}
                activeOpacity={0.85}
              >
                <View style={styles.attachmentMenuIcon}>
                  <MaterialIcons name="attach-file" size={20} color="#166534" />
                </View>
                <View style={styles.attachmentMenuTextWrap}>
                  <Text style={styles.attachmentMenuTitle}>File upload</Text>
                  <Text style={styles.attachmentMenuSubtitle}>Attach a document or file</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : null}

          {pendingAttachments.length > 0 ? (
            <View style={styles.pendingAttachmentTray}>
              {pendingAttachments.map((attachmentUri, attachmentIndex) => (
                <View key={`${attachmentUri}-${attachmentIndex}`} style={styles.pendingAttachmentChip}>
                  <MaterialIcons
                    name={isImageMediaUri(attachmentUri) ? 'image' : 'insert-drive-file'}
                    size={16}
                    color="#166534"
                  />
                  <Text style={styles.pendingAttachmentText} numberOfLines={1}>
                    {getAttachmentName(attachmentUri, attachmentIndex)}
                  </Text>
                  <TouchableOpacity onPress={() => removePendingAttachment(attachmentUri)}>
                    <MaterialIcons name="close" size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.composer}>
            <TouchableOpacity
              style={[styles.composerAdd, showAttachmentMenu && styles.composerAddActive]}
              onPress={() => setShowAttachmentMenu(current => !current)}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle" size={28} color="#166534" />
            </TouchableOpacity>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.composerInput}
                placeholder="Type a message..."
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={1000}
              />
            </View>
            <TouchableOpacity
              style={[
                styles.sendBtn,
                (!messageText.trim() && pendingAttachments.length === 0) && styles.sendBtnDisabled,
              ]}
              onPress={handleSendMessage}
              disabled={(!messageText.trim() && pendingAttachments.length === 0) || isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  };

  const renderNavRail = () => (
    <View style={styles.navRail}>
      <TouchableOpacity style={[styles.railItem, styles.railItemActive]}>
        <Ionicons name="chatbubble" size={24} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.railItem}>
        <Ionicons name="people-outline" size={24} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.railItem}>
        <Ionicons name="calendar-outline" size={24} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.railItem}>
        <Ionicons name="settings-outline" size={24} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.railAvatar, { backgroundColor: '#fff' }]}
        onPress={() => navigation.navigate('Profile')}
      >
        <Text style={{ color: '#166534', fontWeight: '800' }}>{user?.name?.[0].toUpperCase()}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.layout}>
        {isTablet && renderNavRail()}
        {renderSidebar()}
        {renderDetail()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  layout: { flex: 1, flexDirection: 'row' },
  hidden: { display: 'none' },

  navRail: {
    width: 72,
    backgroundColor: '#166534',
    alignItems: 'center',
    paddingVertical: 24,
    gap: 24
  },
  railItem: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)'
  },
  railItemActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  railAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },

  sidebar: {
    width: 340,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#f1f5f9'
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    paddingBottom: 16
  },
  sidebarHeaderTitle: { fontSize: 24, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5 },
  sidebarHeaderAction: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center'
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    marginBottom: 20
  },
  searchInput: { flex: 1, fontSize: 15, color: '#1e293b' },

  sectionTabs: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 16
  },
  sectionTab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f1f5f9'
  },
  sectionTabActive: { backgroundColor: '#166534' },
  sectionTabText: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  sectionTabTextActive: { color: '#fff' },

  sidebarList: { flex: 1 },
  listSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    paddingHorizontal: 24,
    marginTop: 20,
    marginBottom: 12
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    marginHorizontal: 12,
    borderRadius: 16,
    marginBottom: 4
  },
  sidebarItemActive: { backgroundColor: '#f0fdf4' },
  sidebarAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sidebarAvatarText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  sidebarItemInfo: { flex: 1 },
  sidebarItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sidebarItemTitle: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  sidebarItemTitleActive: { color: '#166534' },
  sidebarItemSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  sidebarItemSubtitleActive: { color: '#166534', opacity: 0.8 },
  sidebarBadge: { backgroundColor: '#166534', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sidebarBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  emptyListText: { textAlign: 'center', color: '#94a3b8', fontSize: 14, marginTop: 20 },

  detail: { flex: 1, backgroundColor: '#fff' },
  detailHeader: {
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#166534', alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  detailTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  detailSubtitle: { fontSize: 13, color: '#166534', fontWeight: '600', marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerAction: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  conversationMenuWrap: { position: 'relative' },
  conversationMenu: {
    position: 'absolute',
    right: 0,
    top: 44,
    minWidth: 150,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: '#fee2e2',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
    zIndex: 20,
  },
  conversationMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
  },
  conversationMenuDangerText: { fontSize: 13, fontWeight: '900', color: '#dc2626' },
  backButton: { marginRight: 16 },

  messagesList: { flex: 1 },
  messagesListContent: { padding: 24, gap: 20 },
  messageRow: { maxWidth: '80%', gap: 6 },
  messageRowOwn: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageRowOther: { alignSelf: 'flex-start' },
  bubble: { padding: 16, borderRadius: 24 },
  bubbleOwn: { backgroundColor: '#166534', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#f1f5f9', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22, color: '#334155' },
  bubbleTextOwn: { color: '#fff' },
  messageAttachmentList: { gap: 8, marginTop: 10 },
  messageAttachmentCard: {
    minWidth: 180,
    maxWidth: 280,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  messageAttachmentCardOwn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  messageAttachmentImage: {
    width: 240,
    height: 150,
    backgroundColor: '#e2e8f0',
  },
  messageAttachmentFileIcon: {
    width: 240,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  messageAttachmentFileIconOwn: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  messageAttachmentName: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  messageAttachmentNameOwn: { color: '#ffffff' },
  messageTime: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
  emptyChat: { padding: 40, alignItems: 'center' },
  emptyChatText: { color: '#94a3b8', fontSize: 12 },

  attachmentMenu: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  attachmentMenuButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  attachmentMenuIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentMenuTextWrap: { flex: 1 },
  attachmentMenuTitle: { fontSize: 13, fontWeight: '900', color: '#14532d' },
  attachmentMenuSubtitle: { fontSize: 11, fontWeight: '600', color: '#64748b', marginTop: 2 },
  pendingAttachmentTray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: '#ffffff',
  },
  pendingAttachmentChip: {
    maxWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  pendingAttachmentText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9'
  },
  composerAdd: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  composerAddActive: { backgroundColor: '#dcfce7', borderRadius: 20 },
  inputWrap: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 24, paddingHorizontal: 16 },
  composerInput: { minHeight: 44, maxHeight: 120, fontSize: 15, color: '#1e293b', paddingVertical: 10 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#166534', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.5 },

  detailEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIconCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  emptyTitle: { fontSize: 24, fontWeight: '900', color: '#0f172a', marginBottom: 8 },
  emptySubtitle: { fontSize: 16, color: '#64748b', textAlign: 'center', lineHeight: 24 },

  detailScrollContent: { padding: 24 },
  proposalCard: {
    backgroundColor: '#fff',
    borderRadius: 32,
    padding: 32,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 5
  },
  proposalHeader: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 32 },
  proposalTitle: { fontSize: 24, fontWeight: '900', color: '#0f172a' },
  proposalMeta: { fontSize: 14, color: '#64748b', marginTop: 4 },
  formGroup: { marginBottom: 20 },
  formLabel: { fontSize: 14, fontWeight: '800', color: '#475569', marginBottom: 8, marginLeft: 4 },
  formInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 16, fontSize: 16, color: '#0f172a' },
  formRow: { flexDirection: 'row', gap: 16 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#166534', paddingVertical: 20, borderRadius: 20, marginTop: 12 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, marginBottom: 24 },
  statusText: { fontSize: 14, fontWeight: '700' },
  previewTitle: { fontSize: 28, fontWeight: '900', color: '#0f172a', marginBottom: 24 },
  previewSectionLabel: { fontSize: 12, fontWeight: '900', color: '#94a3b8', letterSpacing: 1.5, marginBottom: 8 },
  previewText: { fontSize: 16, lineHeight: 26, color: '#334155', marginBottom: 24 },
  previewGrid: { flexDirection: 'row', gap: 40, marginBottom: 32 },
  previewGridItem: { flex: 1 },
  adminActionRow: { flexDirection: 'row', gap: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 32 },
  actionBtn: { flex: 1, paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  approveBtn: { backgroundColor: '#166534' },
  rejectBtn: { backgroundColor: '#fee2e2' },

  pickerTrigger: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerTriggerText: { fontSize: 16, color: '#0f172a', fontWeight: '500' },
  pickerPlaceholder: { color: '#94a3b8' },

  addressContainer: { gap: 12 },
  pickerWrap: { flex: 1 },
  pickerLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 4, marginLeft: 4 },
  pickerBorder: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    overflow: 'hidden',
  },
  picker: { height: 50, width: '100%' },

  // ── Message Hub Template Panel ──
  msgHubOuter: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#fff',
  },
  msgHubToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  msgHubToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  msgHubPIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgHubPIconText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#d97706',
  },
  msgHubToggleTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1e293b',
  },
  msgHubPanel: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 14,
  },
  msgHubTabs: {
    flexDirection: 'row',
    gap: 0,
    borderBottomWidth: 2,
    borderBottomColor: '#f1f5f9',
  },
  msgHubTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -2,
  },
  msgHubTabActive: {
    borderBottomColor: '#d97706',
  },
  msgHubTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
  },
  msgHubTabTextActive: {
    color: '#d97706',
    fontWeight: '700',
  },
  msgHubField: {
    gap: 6,
  },
  msgHubFieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  msgHubSubjectInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1e293b',
  },
  msgHubToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: '#fafafa',
    flexWrap: 'wrap',
  },
  msgHubToolBtn: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgHubToolDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 4,
  },
  msgHubColorSwatch: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  msgHubBodyInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    color: '#1e293b',
    minHeight: 120,
    lineHeight: 22,
  },
  msgHubFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  msgHubToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
  },
  msgHubToggleLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  msgHubToggleSub: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  msgHubSwitch: {
    width: 72,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  msgHubSwitchOn: {
    backgroundColor: '#d97706',
  },
  msgHubSwitchThumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  msgHubSwitchThumbOn: {
    marginLeft: 'auto',
  },
  msgHubSwitchLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    position: 'absolute',
    right: 10,
  },
  msgHubSwitchLabelOn: {
    color: '#fff',
    left: 10,
    right: undefined,
  },
  msgHubSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  msgHubSendBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },

  // Message Hub — Proposal Form styles
  msgHubFormWrap: {
    gap: 16,
    paddingBottom: 8,
  },
  msgHubFormGroup: {
    gap: 6,
  },
  msgHubFormInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1e293b',
  },
  msgHubFormRow: {
    flexDirection: 'row',
    gap: 14,
  },
  msgHubDateTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
  },
  msgHubDateText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1e293b',
  },
  msgHubAddrGrid: {
    gap: 10,
    marginTop: 4,
  },
  msgHubAddrItem: {
    flex: 1,
  },
  msgHubAddrLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 4,
    marginLeft: 4,
  },
  msgHubAddrPickerBorder: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  msgHubAddrPicker: {
    height: 46,
    width: '100%',
  },
  msgHubBtnRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  msgHubSubmitProposalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#d97706',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },

  // ── Proposal Card Styles ──
  proposalMsgCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden',
  },
  propCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#fffbeb',
  },
  propCardIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  propCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#92400e',
  },
  propCardSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#d97706',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  propApprovedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  propApprovedText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  propCardBody: {
    padding: 16,
  },
  propCardDesc: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 16,
  },
  propCardMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  propCardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  propCardMetaText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  propCardFooter: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#fafafa',
  },
  propCardEditBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 10,
    borderRadius: 10,
  },
  propCardEditBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  propCardApproveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#166534',
    paddingVertical: 10,
    borderRadius: 10,
  },
  propCardApproveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  propCardViewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  propCardViewBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
});
