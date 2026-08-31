import React, { useCallback, useEffect, useRef, useState } from 'react';

import {

  Alert,

  KeyboardAvoidingView,

  Modal,

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
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import { Picker } from '@react-native-picker/picker';

import { useFocusEffect } from '@react-navigation/native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../contexts/AuthContext';

import {

  composePhilippineAddress,

  getCitiesByRegion,

  PHCityMunicipality,

  PHRegions,

} from '../utils/philippineAddressData';

import {

  deleteProjectGroupChat,

  getAllPartnerProjectApplications,

  getAllUsers,

  getConversation,

  getUserByEmailOrPhone,

  getProject,

  getMessagesForUser,

  getProjectsScreenSnapshot,

  invalidateMessageCache,

  leaveVolunteerEventGroup,

  saveEvent,

  saveMessage,

  saveProject,

  subscribeToStorageChanges,

  submitPartnerProgramProposal,

  reviewPartnerProjectApplication,

  subscribeToMessages,

} from '../models/storage';

import {

  subscribeToDirectMessages,

  subscribeToGroupMessages,

  getDirectMessagesForUser,

  sendDirectMessage,

  sendGroupMessage,

  markDirectMessageReadFirestore,

} from '../utils/firestoreMessaging';

import {

  Message,

  PartnerProjectApplication,

  PartnerProjectProposalDetails,

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



type ProjectChatMember = {

  id: string;

  name: string;

  role: 'Admin' | 'Partner' | 'Volunteer';

  detail?: string;

};



type ProjectChatItem = {

  project: Project;

  participantCount: number;

  members: ProjectChatMember[];

};

const PROPOSAL_PREFIX = '___PROPOSAL_CARD___:';
// WebSocket delivery is immediate. This covers a temporarily disconnected socket.
const DIRECT_BACKEND_MESSAGE_POLL_MS = 1000;



type ProposalChatItem = {

  application: PartnerProjectApplication;

  projectTitle: string;

  programModule: string;

};



type ChatMessage = Message | ProjectGroupMessage;

function getProposalReviewCardKey(message: ChatMessage): string | null {
  if (!message.content?.startsWith(PROPOSAL_PREFIX)) {
    return null;
  }

  try {
    const data = JSON.parse(message.content.replace(PROPOSAL_PREFIX, ''));
    const applicationId = String(data.applicationId || data.id || data.application?.id || '').trim();
    const revisionNumber = Number(data.revisionNumber || data.application?.revisionNumber || 0);
    const status = String(data.status || '').trim();
    const messageId = message.id || '';
    
    if (!applicationId) {
      return null;
    }

    // Create unique keys for each card type to preserve conversation history:
    // - Submission cards (from partner): msg-proposal-{timestamp}
    // - Review cards (from admin): review-card-{status}-{appId}-{timestamp}
    // This ensures we keep both the original submission AND the admin's review response
    
    const isReviewCard = messageId.startsWith('review-card-');
    const cardType = isReviewCard ? 'review' : 'submission';
    
    // Key format: "applicationId:revisionNumber:cardType:status"
    // This creates separate cards for:
    // 1. Partner submits (rev 0, submission, Pending)
    // 2. Admin rejects (rev 0, review, Rejected)
    // 3. Partner resubmits (rev 1, submission, Pending)
    // 4. Admin approves (rev 1, review, Approved)
    return [applicationId, revisionNumber, cardType, status].join(':');
  } catch (_) {
    return null;
  }
}

function dedupeProposalReviewCards(messagesToDedupe: ChatMessage[]): ChatMessage[] {
  const cardsByKey = new Map<string, ChatMessage>();

  const isBackendProposalCard = (message: ChatMessage) =>
    message.id.startsWith('msg-proposal-') || message.id.startsWith('review-card-');

  messagesToDedupe.forEach(message => {
    const proposalCardKey = getProposalReviewCardKey(message);
    if (!proposalCardKey) return;

    const existingMessage = cardsByKey.get(proposalCardKey);
    
    // Keep only one card per unique key (applicationId + revision + status)
    // Prefer backend messages over local temporary ones
    const shouldReplace =
      !existingMessage ||
      (isBackendProposalCard(message) && !isBackendProposalCard(existingMessage)) ||
      (isBackendProposalCard(message) === isBackendProposalCard(existingMessage) &&
        new Date(message.timestamp).getTime() >= new Date(existingMessage.timestamp).getTime());
    
    if (shouldReplace) {
      cardsByKey.set(proposalCardKey, message);
    }
  });

  return messagesToDedupe.filter(message => {
    const reviewCardKey = getProposalReviewCardKey(message);
    if (!reviewCardKey) {
      return true;
    }

    return cardsByKey.get(reviewCardKey)?.id === message.id;
  });
}

function mergeChatMessageLists<T extends ChatMessage>(...messageGroups: T[][]): T[] {
  const byId = new Map<string, T>();
  const byMessageSignature = new Map<string, T>();
  messageGroups.flat().forEach(message => {
    const messageWithOptionalTargets = message as ChatMessage & {
      recipientId?: string;
      projectId?: string;
    };
    const timestampBucket = Math.floor(new Date(message.timestamp).getTime() / 5000);
    const messageSignature = [
      message.senderId,
      messageWithOptionalTargets.recipientId || '',
      messageWithOptionalTargets.projectId || '',
      message.content || '',
      timestampBucket,
    ].join('|');
    const existingSimilarMessage = byMessageSignature.get(messageSignature);
    if (existingSimilarMessage) {
      const preferCurrentMessage =
        message.id.startsWith('msg-') && !existingSimilarMessage.id.startsWith('msg-');
      if (preferCurrentMessage) {
        byId.delete(existingSimilarMessage.id);
        byId.set(message.id, message);
        byMessageSignature.set(messageSignature, message);
      }
      return;
    }

    byId.set(message.id, message);
    byMessageSignature.set(messageSignature, message);
  });

  return dedupeProposalReviewCards(Array.from(byId.values())).sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  ) as T[];
}

function getDirectMessagesBetween(messagesToFilter: Message[], userId1: string, userId2: string): Message[] {
  return messagesToFilter.filter(message =>
    (message.senderId === userId1 && message.recipientId === userId2) ||
    (message.senderId === userId2 && message.recipientId === userId1)
  );
}

function getMessagePreviewText(message?: Message): string {
  if (!message?.content) {
    return 'Start a conversation';
  }

  if (!message.content.startsWith(PROPOSAL_PREFIX)) {
    return message.content;
  }

  try {
    const application = JSON.parse(message.content.replace(PROPOSAL_PREFIX, ''));
    const proposalDetails = application.proposalDetails || {};
    const title =
      proposalDetails.proposedTitle ||
      application.proposedTitle ||
      proposalDetails.targetProjectTitle ||
      'Project proposal';
    const status = application.status || 'Pending';
    return `${title} - Proposal ${status}`;
  } catch {
    return 'Project proposal';
  }
}

function upsertChatMessage(current: ChatMessage[], incoming: ChatMessage): ChatMessage[] {

  const byId = new Map(current.map(message => [message.id, message]));

  byId.set(incoming.id, incoming);

  const result = dedupeProposalReviewCards(Array.from(byId.values()));

  return result.sort(

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



function formatProposalDate(value?: string): string {

  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {

    return 'Not provided';

  }



  const parsedDate = new Date(normalizedValue);

  if (Number.isNaN(parsedDate.getTime())) {

    return normalizedValue;

  }



  return parsedDate.toLocaleDateString(undefined, {

    year: 'numeric',

    month: 'long',

    day: 'numeric',

  });

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

  photoAttachment?: string;

};

const createEmptyProposalForm = (title = ''): ProposalFormState => ({
  proposedTitle: title,
  proposedDescription: '',
  proposedStartDate: '',
  proposedEndDate: '',
  proposedLocation: '',
  proposedVolunteersNeeded: '',
  communityNeed: '',
  expectedDeliverables: '',
  photoAttachment: '',
});



function getSidebarSectionMeta(section: SidebarSection): {

  label: string;

  icon: keyof typeof MaterialIcons.glyphMap;

} {

  switch (section) {

    case 'projects':

      return { label: 'Event GC', icon: 'groups' };

    case 'proposals':

      return { label: 'Proposals', icon: 'calendar-today' };

    case 'contacts':

      return { label: 'Contacts', icon: 'contacts' };

    case 'messages':

    default:

      return { label: 'Messages', icon: 'mail-outline' };

  }

}





export default function CommunicationHubScreen({ navigation, route }: any) {

  const { user } = useAuth();
  const { dialogState, showConfirm, handleConfirm, handleCancel } = useConfirmDialog();

  // Older browser sessions can contain the pre-migration admin ID. Resolve
  // the current account once so this screen always uses the backend identity
  // when reading a direct-message thread.
  const [messageUserId, setMessageUserId] = useState(user?.id || '');

  const insets = useSafeAreaInsets();

  const { width } = useWindowDimensions();

  const isMobileMode = React.useMemo(() => {
    if (Platform.OS !== 'web') return true;
    try {
      if (typeof window !== 'undefined' && window?.location?.search) {
        const params = new URLSearchParams(window.location.search);
        return params.get('mode') === 'mobile';
      }
    } catch {
      // ignore
    }
    return false;
  }, []);

  const isWide = !isMobileMode && width >= 1024;

  const isTablet = !isMobileMode && width >= 768;

  const isVolunteer = user?.role === 'volunteer';

  const isPartner = user?.role === 'partner';



  const {

    projectId: requestedProjectId,

    conversationUserId,

    newProposalModule,

    newProposalProjectId,

    newProposalTitle

  } = route?.params || {};



  const [view, setView] = useState<'sidebar' | 'detail'>(isWide ? 'detail' : 'sidebar');

  const [activeSection, setActiveSection] = useState<SidebarSection>(

    user?.role === 'admin' ? 'messages' : 'messages'

  );

  const [loading, setLoading] = useState(true);



  const [conversations, setConversations] = useState<ConversationItem[]>([]);

  const [directMessages, setDirectMessages] = useState<Message[]>([]);

  const [projectChats, setProjectChats] = useState<ProjectChatItem[]>([]);

  const [proposalChats, setProposalChats] = useState<ProposalChatItem[]>([]);

  const [allUsers, setAllUsers] = useState<User[]>([]);



  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const [selectedProjectChat, setSelectedProjectChat] = useState<ProjectChatItem | null>(null);

  const [selectedProposalApplication, setSelectedProposalApplication] = useState<PartnerProjectApplication | null>(null);

  const [proposalIntent, setProposalIntent] = useState<{ module?: string; projectId?: string; title?: string } | null>(null);

  const [proposalRevisionMode, setProposalRevisionMode] = useState(false);



  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [messageText, setMessageText] = useState('');

  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);

  const [searchText, setSearchText] = useState('');

  const [isSending, setIsSending] = useState(false);

  const [reviewNotice, setReviewNotice] = useState<{

    title: string;

    message: string;

    tone: 'success' | 'warning';

  } | null>(null);



  const [activeProposalCardData, setActiveProposalCardData] = useState<any>(null);

  const [rejectionNotes, setRejectionNotes] = useState('');

  const [showRejectionModal, setShowRejectionModal] = useState(false);

  const [pendingRejectApp, setPendingRejectApp] = useState<PartnerProjectApplication | null>(null);


  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  const [showConversationMenu, setShowConversationMenu] = useState(false);

  const [showMembersModal, setShowMembersModal] = useState(false);

  const [conversationMenuAction, setConversationMenuAction] = useState<string | null>(null);



  const scrollRef = useRef<ScrollView>(null);

  const selectedUserRef = useRef<User | null>(null);

  const selectedProjectChatRef = useRef<ProjectChatItem | null>(null);

  const directMessagesRef = useRef<Message[]>([]);



  const [proposalForm, setProposalForm] = useState<ProposalFormState>(() =>
    createEmptyProposalForm(newProposalTitle || '')
  );
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [proposalValidationErrors, setProposalValidationErrors] = useState<Record<string, string>>({});



  const [showStartDatePicker, setShowStartDatePicker] = useState(false);

  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const [selectedRegionCode, setSelectedRegionCode] = useState('');

  const [selectedCityCode, setSelectedCityCode] = useState('');

  const [filteredCities, setFilteredCities] = useState<PHCityMunicipality[]>([]);

  const [locRegion, setLocRegion] = useState('');

  const [locCity, setLocCity] = useState('');

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setMessageUserId('');
      return undefined;
    }

    setMessageUserId(user.id);
    const identifier = user.email || user.phone || '';
    if (!identifier) return undefined;

    void getUserByEmailOrPhone(identifier)
      .then(canonicalUser => {
        if (!cancelled && canonicalUser?.role === user.role) {
          setMessageUserId(canonicalUser.id);
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [user?.email, user?.id, user?.phone, user?.role]);



  useEffect(() => {
    if (!isWide && navigation) {
      const showHeader = view === 'sidebar';
      navigation.setOptions({ headerShown: showHeader });
    } else if (isWide && navigation) {
      navigation.setOptions({ headerShown: true });
    }
  }, [view, isWide, navigation]);

  // The backend emits this for every direct-message write, including proposal
  // review cards. Update the active conversation as soon as the event arrives.
  useEffect(() => {
    if (!user) return undefined;

    if (!messageUserId) return undefined;

    return subscribeToMessages(messageUserId, event => {
      if (event.type === 'project-group-message.changed') {
        invalidateMessageCache(undefined, undefined, event.message.projectId);
        if (selectedProjectChatRef.current?.project.id === event.message.projectId) {
          setMessages(current => mergeChatMessageLists(current as ProjectGroupMessage[], [event.message]));
        }
        return;
      }

      if (event.type !== 'message.changed') return;

      const incomingMessage = event.message;
      const otherUserId = incomingMessage.senderId === messageUserId
        ? incomingMessage.recipientId
        : incomingMessage.senderId;

      if (!otherUserId) return;

      invalidateMessageCache(messageUserId, otherUserId);
      const mergedMessages = mergeChatMessageLists(directMessagesRef.current, [incomingMessage]);
      directMessagesRef.current = mergedMessages;
      setDirectMessages(mergedMessages);

      setConversations(current => current
        .map(conversation => {
          if (conversation.user.id !== otherUserId) return conversation;
          const isNewUnreadMessage =
            conversation.lastMessage?.id !== incomingMessage.id &&
            incomingMessage.recipientId === messageUserId &&
            !incomingMessage.read;
          return {
            ...conversation,
            lastMessage: incomingMessage,
            unreadCount: conversation.unreadCount + (isNewUnreadMessage ? 1 : 0),
          };
        })
        .sort((left, right) =>
          new Date(right.lastMessage?.timestamp || 0).getTime() -
          new Date(left.lastMessage?.timestamp || 0).getTime()
        )
      );

      if (selectedUserRef.current?.id === otherUserId) {
        setMessages(current => mergeChatMessageLists(current as Message[], [incomingMessage]));
      }
    });
  }, [messageUserId, user]);

  const availableSections: SidebarSection[] = isVolunteer

    ? ['messages', 'projects', 'contacts']

    : isPartner

    ? ['messages', 'projects']

    : ['messages', 'projects', 'contacts'];



  const loadData = useCallback(async (skipMessages = false) => {

    if (!user || !messageUserId) return;

    try {
      const [usersResult, snapshotResult, firestoreMessagesResult, storedMessagesResult, partnerApplicationsResult] = await Promise.allSettled([

        getAllUsers(),

        getProjectsScreenSnapshot(user),

        // Skip message fetches on background refreshes — Firestore/WebSocket subscriptions keep them live
        skipMessages ? Promise.resolve([] as Message[]) : getDirectMessagesForUser(messageUserId),

        skipMessages ? Promise.resolve([] as Message[]) : getMessagesForUser(messageUserId),

        user.role === 'volunteer'

          ? Promise.resolve([] as PartnerProjectApplication[])

          : getAllPartnerProjectApplications(),

      ]);



      const users = usersResult.status === 'fulfilled' ? usersResult.value : [];

      const snapshot =

        snapshotResult.status === 'fulfilled'

          ? snapshotResult.value

          : {

              projects: [],

              partnerApplications: [],

              volunteerJoinRecords: [],

              volunteerProfile: null,

            };

      // Proposal cards are created and updated by the backend. Firestore is
      // retained for ordinary chat only so an old cached card cannot hide a
      // newer proposal revision from the admin thread.
      let msgs = directMessagesRef.current;
      if (!skipMessages) {
        const firestoreMessages = firestoreMessagesResult.status === 'fulfilled'
          ? firestoreMessagesResult.value.filter(message => !message.content?.startsWith(PROPOSAL_PREFIX))
          : [];

        const storedMessages = storedMessagesResult.status === 'fulfilled' ? storedMessagesResult.value : [];

        msgs = mergeChatMessageLists(firestoreMessages, storedMessages);

        directMessagesRef.current = msgs;

        setDirectMessages(msgs);

        const currentSelectedUser = selectedUserRef.current;
        if (currentSelectedUser) {
          setMessages(getDirectMessagesBetween(msgs, messageUserId, currentSelectedUser.id));
        }
      }

      const directPartnerApplications =

        partnerApplicationsResult.status === 'fulfilled' ? partnerApplicationsResult.value : [];



      const others = users.filter(u => u.id !== messageUserId);

      const allowedDirectUsers = user.role === 'volunteer' || user.role === 'partner'

        ? others.filter(u => u.role === 'admin')

        : others;

      const allowedDirectUserIds = new Set(allowedDirectUsers.map(u => u.id));

      const joinedEventIds = new Set(snapshot.volunteerJoinRecords.map(record => record.projectId));

      const volunteerProfileId = snapshot.volunteerProfile?.id;

      const adminUsers = users.filter(candidate => candidate.role === 'admin');



      setAllUsers(allowedDirectUsers);



      const approvedPartnerProjectIds = new Set(

        [...snapshot.partnerApplications, ...directPartnerApplications]

          .filter(

            application =>

              application.status === 'Approved' && application.partnerUserId === user.id

          )

          .map(application => application.projectId)

          .filter(Boolean)

      );



      setProjectChats(

        snapshot.projects

          .filter(project => {

            if (!project?.isEvent || project.groupChatDisabled) {

              return false;

            }

            if (user.role === 'admin') {

              return true;

            }

            if (user.role === 'partner') {

              return (

                approvedPartnerProjectIds.has(project.id) ||

                Boolean(project.parentProjectId && approvedPartnerProjectIds.has(project.parentProjectId))

              );

            }



            const joinedByRecord = joinedEventIds.has(project.id);

            const joinedByUserId = (project.joinedUserIds || []).includes(user.id);

            const joinedByVolunteerId = Boolean(

              volunteerProfileId && (project.volunteers || []).includes(volunteerProfileId)

            );

            return joinedByRecord || joinedByUserId || joinedByVolunteerId;

          })

          .map(project => {

            const memberMap = new Map<string, ProjectChatMember>();

            adminUsers.forEach(admin => {

              memberMap.set(`admin:${admin.id}`, {

                id: admin.id,

                name: admin.name || 'Admin',

                role: 'Admin',

                detail: admin.email,

              });

            });



            (project.joinedUserIds || []).forEach(joinedUserId => {

              const joinedUser = users.find(candidate => candidate.id === joinedUserId);

              if (!joinedUser || joinedUser.role !== 'volunteer') {

                return;

              }



              memberMap.set(`volunteer:${joinedUser.id}`, {

                id: joinedUser.id,

                name: joinedUser.name || 'Volunteer',

                role: 'Volunteer',

                detail: joinedUser.email,

              });

            });



            [...snapshot.partnerApplications, ...directPartnerApplications]

              .filter(application => {

                if (application.status !== 'Approved') {

                  return false;

                }



                return (

                  application.projectId === project.id ||

                  Boolean(project.parentProjectId && application.projectId === project.parentProjectId)

                );

              })

              .forEach(application => {

                const partnerUser = users.find(candidate => candidate.id === application.partnerUserId);

                memberMap.set(`partner:${application.partnerUserId}`, {

                  id: application.partnerUserId,

                  name: application.partnerName || partnerUser?.name || 'Partner Account',

                  role: 'Partner',

                  detail: application.partnerEmail || partnerUser?.email,

                });

              });



            const members = Array.from(memberMap.values()).sort((left, right) => {

              const rank = { Admin: 0, Partner: 1, Volunteer: 2 };

              const roleRank = rank[left.role] - rank[right.role];

              return roleRank !== 0 ? roleRank : left.name.localeCompare(right.name);

            });

            const partnerParticipantCount =

              user.role === 'partner' &&

              (approvedPartnerProjectIds.has(project.id) ||

                Boolean(project.parentProjectId && approvedPartnerProjectIds.has(project.parentProjectId)))

                ? 1

                : 0;



            return {

              project,

              participantCount:

                Math.max(

                  members.length,

                  Math.max(

                    (project.joinedUserIds || []).length,

                    (project.volunteers || []).length

                  ) + partnerParticipantCount

                ),

              members,

            };

          })

      );



      setProposalChats(

        (user.role === 'admin' 
          ? directPartnerApplications 
          : (partnerApplicationsResult.status === 'fulfilled' ? partnerApplicationsResult.value : [])
        )

          .sort((left, right) => {

            const leftRank = left.status === 'Pending' ? 0 : 1;

            const rightRank = right.status === 'Pending' ? 0 : 1;

            if (leftRank !== rightRank) {

              return leftRank - rightRank;

            }

            return new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime();

          })

          .map(app => ({

            application: app,

            projectTitle:

              app.proposalDetails?.proposedTitle ||

              app.proposalDetails?.targetProjectTitle ||

              'Untitled Proposal',

            programModule: app.proposalDetails?.requestedProgramModule || 'Nutrition'

          }))

      );



      const convMap = new Map<string, ConversationItem>();

      msgs.forEach(m => {

        const otherId = m.senderId === messageUserId ? m.recipientId : m.senderId;

        if (!allowedDirectUserIds.has(otherId)) return;

        const otherUser = others.find(u => u.id === otherId);

        if (!otherUser) return;

        const entry = convMap.get(otherId) || { user: otherUser, unreadCount: 0 };

        if (!entry.lastMessage || new Date(m.timestamp) > new Date(entry.lastMessage.timestamp)) {

          entry.lastMessage = m;

        }

        if (!m.read && m.recipientId === messageUserId) {

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

  }, [messageUserId, user]);



  // Firestore real-time listener; tears down automatically when conversation changes.
  useEffect(() => {

    if (!user || !messageUserId) return;

    if (selectedUser) {

      let cancelled = false;
      let refreshingStoredMessages = false;

      setMessages(getDirectMessagesBetween(directMessagesRef.current, messageUserId, selectedUser.id));

      const refreshStoredDirectMessages = async () => {
        if (refreshingStoredMessages) return;
        refreshingStoredMessages = true;
        try {
          invalidateMessageCache(messageUserId, selectedUser.id);
          const storedMessages = await getConversation(messageUserId, selectedUser.id);
          
          const proposalCards = storedMessages.filter(m => m.content?.startsWith(PROPOSAL_PREFIX));
          if (proposalCards.length > 0) {
            console.log(`📬 Received ${proposalCards.length} proposal card(s) from backend for conversation ${messageUserId} ↔ ${selectedUser.id}`);
          }
          
          if (cancelled) return;

          const existingChatOnlyMessages = directMessagesRef.current.filter(
            message => !message.content?.startsWith(PROPOSAL_PREFIX)
          );
          const mergedDirectMessages = mergeChatMessageLists(existingChatOnlyMessages, storedMessages);
          directMessagesRef.current = mergedDirectMessages;
          setDirectMessages(mergedDirectMessages);
          setMessages(getDirectMessagesBetween(mergedDirectMessages, messageUserId, selectedUser.id));
        } catch (error) {
          if (!cancelled) {
            console.warn('Failed to load stored direct messages:', error);
          }
        } finally {
          refreshingStoredMessages = false;
        }
      };

      void refreshStoredDirectMessages();
      const backendMessagePoll = setInterval(() => {
        void refreshStoredDirectMessages();
      }, DIRECT_BACKEND_MESSAGE_POLL_MS);

      const unsubscribe = subscribeToDirectMessages(messageUserId, selectedUser.id, msgs => {

        if (!cancelled) {
          const chatOnlyMessages = msgs.filter(message => !message.content?.startsWith(PROPOSAL_PREFIX));
          const mergedDirectMessages = mergeChatMessageLists(directMessagesRef.current, chatOnlyMessages);
          directMessagesRef.current = mergedDirectMessages;
          setDirectMessages(mergedDirectMessages);
          setMessages(current => mergeChatMessageLists(current as Message[], chatOnlyMessages));
        }

        const unread = msgs.filter(message => !message.read && message.recipientId === messageUserId);

        unread.forEach(message => {

          void markDirectMessageReadFirestore(message.id, message.senderId, message.recipientId);

        });

      });

      return () => {
        cancelled = true;
        clearInterval(backendMessagePoll);
        unsubscribe();
      };

    }

    if (selectedProjectChat) {

      setMessages([]);

      return subscribeToGroupMessages(selectedProjectChat.project.id, msgs => {

        setMessages(dedupeProposalReviewCards(msgs));

      });

    }

    setMessages([]);

    return undefined;

  }, [messageUserId, selectedProjectChat?.project.id, selectedUser?.id, user]);



  useEffect(() => {

    selectedUserRef.current = selectedUser;

  }, [selectedUser]);

  useEffect(() => {

    directMessagesRef.current = directMessages;

  }, [directMessages]);



  useEffect(() => {

    selectedProjectChatRef.current = selectedProjectChat;

    setShowConversationMenu(false);

    setShowMembersModal(false);

  }, [selectedProjectChat]);



  useFocusEffect(useCallback(() => {

    void loadData();

    // Background refreshes skip the heavy message fetches — Firestore subscriptions handle message freshness
    return subscribeToStorageChanges(['users', 'projects', 'partnerProjectApplications', 'messages', 'projectGroupMessages'], () => loadData(true));

  }, [loadData]));



  useEffect(() => {

    if (user?.role !== 'admin' || activeSection !== 'proposals') {

      return undefined;

    }



    const pollTimer = setInterval(() => {

      // Skip message fetches on the proposal poll — only need fresh proposal data
      void loadData(true);

    }, 5000);



    return () => clearInterval(pollTimer);

  }, [activeSection, loadData, user?.role]);



  // Direct and group conversations are loaded from Firestore snapshots.



  useEffect(() => {

    if (!availableSections.includes(activeSection)) {

      setActiveSection(availableSections[0]);

    }

  }, [activeSection, availableSections]);



  const pendingProposalChats = proposalChats.filter(item => item.application.status === 'Pending');







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

    if (!conversationUserId || loading) return;


    const matchedUser =
      conversationUserId === 'admin-nvc'
        ? allUsers.find((candidate) => candidate.role === 'admin')
        : allUsers.find((candidate) => candidate.id === conversationUserId);
    if (matchedUser) {
      setSelectedUser(matchedUser);
      setSelectedProjectChat(null);
      setSelectedProposalApplication(null);
      setProposalIntent(null);
      setView('detail');
    }


    navigation.setParams({ conversationUserId: undefined });

  }, [conversationUserId, loading, navigation, allUsers]);


  useEffect(() => {

    if (newProposalModule || newProposalProjectId) {

      setProposalIntent({

        module: newProposalModule,

        projectId: newProposalProjectId,

        title: newProposalTitle

      });
      setProposalRevisionMode(false);

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

  }, [newProposalModule, newProposalProjectId, newProposalTitle, navigation, user?.role, allUsers]);



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



  const handlePickProposalPhoto = async () => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }
      setProposalForm(current => ({ ...current, photoAttachment: pickedImage }));
    } catch (error: any) {
      Alert.alert('Photo Upload Failed', error?.message || 'Unable to upload a photo. Please try again.');
    }
  };

  const handleRemoveProposalPhoto = () => {
    setProposalForm(current => ({ ...current, photoAttachment: '' }));
  };

  const closeProposalComposer = () => {
    setProposalForm(createEmptyProposalForm());
    setProposalRevisionMode(false);
    setProposalIntent(null);
    navigation.setParams({
      newProposalModule: undefined,
      newProposalProjectId: undefined,
      newProposalTitle: undefined,
    });
    setView(isWide ? 'detail' : 'sidebar');
  };

  const closeActiveConversation = () => {

    setSelectedUser(null);

    setSelectedProjectChat(null);

    setSelectedProposalApplication(null);

    setProposalIntent(null);

    setProposalRevisionMode(false);

    setShowConversationMenu(false);

    setMessages([]);

    if (!isWide) {

      setView('sidebar');

    }

  };



  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  const handleOpenProposalAttachment = async (uri: string, attachmentIndex: number) => {

    const normalizedUri = String(uri || '').trim();

    if (!normalizedUri) {

      return;

    }

    // Check if it's an image
    const isImage = isImageMediaUri(normalizedUri);

    try {

      if (Platform.OS === 'web') {
        if (isImage) {
          // For images, show in preview modal
          setPreviewImageUri(normalizedUri);
          return;
        }
        
        // For non-images, download as before
        if (typeof document !== 'undefined') {
          const link = document.createElement('a');
          link.href = normalizedUri;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.download = getAttachmentName(normalizedUri, attachmentIndex);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        return;
      }

      await Linking.openURL(normalizedUri);

    } catch {

      Alert.alert('Attachment Unavailable', 'Unable to open or download this attachment right now.');

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

    const previousProjectChats = projectChats;

    const previousSelectedProjectChat = selectedProjectChat;

    const previousMessages = messages;

    setShowConversationMenu(false);

    setProjectChats(currentChats =>

      currentChats.filter(chat => chat.project.id !== selectedProjectChat.project.id)

    );

    setSelectedProjectChat(null);

    setMessages([]);

    setView(isWide ? 'detail' : 'sidebar');

    setReviewNotice({

      title: 'Left event GC',

      message: `You left "${eventTitle}".`,

      tone: 'warning',

    });



    void (async () => {

      try {

        await leaveVolunteerEventGroup(previousSelectedProjectChat.project.id, user.id);

        void loadData();

      } catch (error) {

        setProjectChats(previousProjectChats);

        setSelectedProjectChat(previousSelectedProjectChat);

        setMessages(previousMessages);

        setView(isWide ? 'detail' : 'sidebar');

        Alert.alert(

          'Unable to Leave',

          getRequestErrorMessage(error, 'Failed to leave this event group chat. Please try again.')

        );

      }

    })();

  };



  const handleOpenGcProjectDetails = () => {

    if (!selectedProjectChat) {

      return;

    }



    setShowConversationMenu(false);

    navigateToAvailableRoute(navigation, 'Projects', { projectId: selectedProjectChat.project.id });

  };



  const handleOpenGcMembers = () => {

    if (!selectedProjectChat) {

      return;

    }



    setShowConversationMenu(false);

    setShowMembersModal(true);

  };



  const handleDeleteEventGc = () => {

    if (!user || user.role !== 'admin' || !selectedProjectChat) {

      return;

    }



    const targetProject = selectedProjectChat.project;
    setShowConversationMenu(false);

    const executeDelete = async () => {
      const previousProjectChats = projectChats;

      const previousSelectedProjectChat = selectedProjectChat;

      const previousMessages = messages;

      setConversationMenuAction('delete-gc');

      setShowConversationMenu(false);

      setProjectChats(currentChats =>

        currentChats.filter(chat => chat.project.id !== targetProject.id)

      );

      setSelectedProjectChat(null);

      setMessages([]);

      setView(isWide ? 'detail' : 'sidebar');

      setReviewNotice({

        title: 'GC deleted',

        message: `The group chat for "${targetProject.title}" has been removed.`,

        tone: 'warning',

      });



      try {

        const latestProject = await getProject(targetProject.id);

        if (!latestProject) {

          throw new Error('Project not found.');

        }



        const nextProject = {

          ...latestProject,

          groupChatDisabled: true,

          updatedAt: new Date().toISOString(),

        };



        if (latestProject.isEvent) {

          await saveEvent(nextProject);

        } else {

          await saveProject(nextProject);

        }



        await deleteProjectGroupChat(latestProject.id);
        Alert.alert('Group Chat Deleted', `The group chat for "${targetProject.title}" has been removed.`);

        void loadData();

      } catch (error) {

        setProjectChats(previousProjectChats);

        setSelectedProjectChat(previousSelectedProjectChat);

        setMessages(previousMessages);

        setView(isWide ? 'detail' : 'sidebar');

        Alert.alert(

          'Unable to delete GC',

          getRequestErrorMessage(error, 'Failed to delete this group chat. Please try again.')

        );

      } finally {

        setConversationMenuAction(null);

      }

    };

    showConfirm({
      title: 'Delete Group Chat',
      message: `Delete the group chat for "${targetProject.title}"? This removes the chat messages and disables the group chat.`,
      confirmText: 'Delete',
      loadingText: 'Deleting...',
      cancelText: 'Cancel',
      icon: 'delete-outline',
      iconColor: '#DC2626',
      confirmColor: '#DC2626',
      onConfirm: executeDelete,
    });

  };



  const handleSendMessage = async () => {

    const trimmedMessage = messageText.trim();

    const senderId = messageUserId || user?.id || '';

    if (!user || !senderId || (!trimmedMessage && pendingAttachments.length === 0) || isSending) return;

    setIsSending(true);

    const msg = {

      id: `msg-${Date.now()}`,

      senderId,

      content: trimmedMessage || 'Attachment',

      timestamp: new Date().toISOString(),

      attachments: pendingAttachments,

    };

    try {

      if (selectedUser) {

        const fullMsg = { ...msg, recipientId: selectedUser.id, read: false };

        if (selectedUser.id === senderId) {
          Alert.alert('Conversation Unavailable', 'Select a volunteer, partner, or another admin before sending a message.');
          return;
        }

        setMessages(current => mergeChatMessageLists(current as Message[], [fullMsg as Message]));
        directMessagesRef.current = mergeChatMessageLists(directMessagesRef.current, [fullMsg as Message]);

        // Write to BOTH Firestore (real-time sync) and backend (persistence)
        const { id: _id, ...msgWithoutId } = fullMsg as Message;
        await Promise.all([
          sendDirectMessage(msgWithoutId).catch(err => {
            console.warn('[Chat] Firestore DM send failed (non-fatal):', err);
          }),
          saveMessage(fullMsg as Message),
        ]);

      } else if (selectedProjectChat) {

        const fullMsg = { ...msg, projectId: selectedProjectChat.project.id, kind: 'message' as const };

        await sendGroupMessage(fullMsg);

      }

      setMessageText('');

      setPendingAttachments([]);

    } catch (e) {

      const errorMsg = e instanceof Error ? e.message : 'Failed to send message';

      Alert.alert('Error', `Failed to send message: ${errorMsg}`);

    } finally {

      setIsSending(false);

    }

  };



  const handleSubmitProposal = async () => {

    if (!user || !proposalIntent || isSubmittingProposal) return;

    // Validate required proposal fields
    const errors: Record<string, string> = {};

    if (!proposalForm.proposedTitle || !proposalForm.proposedTitle.trim()) {
      errors.proposedTitle = 'Please enter the proposal title.';
    }

    if (!proposalForm.proposedDescription || !proposalForm.proposedDescription.trim()) {
      errors.proposedDescription = 'Please enter the proposal description.';
    }

    if (!proposalForm.proposedStartDate || !proposalForm.proposedStartDate.trim()) {
      errors.proposedStartDate = 'Please select a start date.';
    }

    if (!proposalForm.proposedEndDate || !proposalForm.proposedEndDate.trim()) {
      errors.proposedEndDate = 'Please select an end date.';
    } else if (
      proposalForm.proposedStartDate &&
      proposalForm.proposedEndDate.trim() < proposalForm.proposedStartDate.trim()
    ) {
      errors.proposedEndDate = 'End date cannot be earlier than start date.';
    }

    if (!proposalForm.proposedLocation || !proposalForm.proposedLocation.trim()) {
      errors.proposedLocation = 'Please select a region and city/municipality for the project location.';
    }

    if (Object.keys(errors).length > 0) {
      setProposalValidationErrors(errors);
      const firstError = Object.values(errors)[0];
      Alert.alert('Missing Information', firstError);
      return;
    }

    setProposalValidationErrors({});
    setIsSubmittingProposal(true);

    try {

      const proposalAttachments = proposalForm.photoAttachment
        ? [{ url: proposalForm.photoAttachment, type: 'image' as const }]
        : [];

      console.log('📤 Submitting proposal:');
      console.log('  - Project ID:', proposalIntent.projectId || 'new');
      console.log('  - Program Module:', proposalIntent.module);
      console.log('  - Revision Mode:', proposalRevisionMode);

      await submitPartnerProgramProposal(proposalIntent.projectId || 'new', user, {

        programModule: (proposalIntent.module as AdvocacyFocus) || 'Nutrition',

        proposalDetails: {

          ...proposalForm,

          proposedVolunteersNeeded: Number(proposalForm.proposedVolunteersNeeded) || 0,

          requestedProgramModule: (proposalIntent.module as AdvocacyFocus) || 'Nutrition',

          targetProjectId: proposalIntent.projectId,

          attachments: proposalAttachments,

        }

      });

      console.log('✅ Proposal submitted successfully, refreshing messages...');

      closeProposalComposer();

      const successMessage = proposalRevisionMode 
        ? 'Your revised proposal has been submitted for review.'
        : 'Your proposal has been submitted for review.';
      
      Alert.alert('Success', successMessage);

      // Force a full data reload without skipping messages to ensure new card appears
      await loadData(false);

      console.log('✅ Data reloaded after proposal submission');

    } catch (e) {

      console.error('❌ Error submitting proposal:', e);
      Alert.alert('Error', 'Failed to submit proposal. Please check your connection.');

    } finally {

      setIsSubmittingProposal(false);

    }

  };



  useEffect(() => {

    const composed = composePhilippineAddress(locRegion, locCity, '');

    setProposalForm(f => ({ ...f, proposedLocation: composed }));

  }, [locRegion, locCity]);



  useEffect(() => {

    if (!reviewNotice) {

      return undefined;

    }



    const timer = setTimeout(() => {

      setReviewNotice(null);

    }, 4500);



    return () => clearTimeout(timer);

  }, [reviewNotice]);



  const handleRejectWithNotes = (app: PartnerProjectApplication) => {

    setRejectionNotes('');

    setPendingRejectApp(app);

    setShowRejectionModal(true);

  };



  const handleReview = async (app: PartnerProjectApplication, status: 'Approved' | 'Rejected', notes?: string) => {

    console.log('=== PROPOSAL REVIEW DEBUG ===');
    console.log('Application ID:', app.id);
    console.log('Status:', status);
    console.log('Notes:', notes);
    console.log('User ID:', user?.id);

    // Check if this proposal has already been reviewed
    if (app.status !== 'Pending') {
      Alert.alert(
        'Already Reviewed',
        `This proposal has already been ${app.status.toLowerCase()}. Please refresh to see the latest status.`
      );
      return;
    }

    const previousProposalChats = proposalChats;

    const previousSelectedProposalApplication = selectedProposalApplication;



    try {

      // Call API first so we have the real result
      console.log('Calling reviewPartnerProjectApplication API...');
      const reviewedApplication = await reviewPartnerProjectApplication(app.id, status, user?.id || '', notes);
      console.log('API Response:', reviewedApplication);
      console.log('Project ID:', reviewedApplication.projectId);


      // Keep reviewed proposals visible so rejected applications can still be referenced and approved history remains visible
      setProposalChats(current =>
        current.map(item =>
          item.application.id === reviewedApplication.id
            ? {
                ...item,
                application: reviewedApplication,
                projectTitle:
                  reviewedApplication.proposalDetails?.proposedTitle ||
                  reviewedApplication.proposalDetails?.targetProjectTitle ||
                  item.projectTitle,
              }
            : item
        )
      );
      
      // DO NOT update existing message cards - each card represents a point in time
      // The backend creates a new review card, and we'll receive it via WebSocket
      // This preserves the conversation history: Original → Rejection → Revised → Approval

      setReviewNotice(

        status === 'Approved'

          ? { title: 'Proposal approved', message: 'The proposal was approved and a new project was created.', tone: 'success' }

          : { title: 'Proposal rejected', message: 'The proposal was rejected. A notification card has been sent to the partner.', tone: 'warning' }

      );

      if (selectedProposalApplication?.id === reviewedApplication.id) {
        setSelectedProposalApplication(reviewedApplication);
      }

      if (
        activeProposalCardData &&
        (activeProposalCardData.applicationId === reviewedApplication.id || activeProposalCardData.id === reviewedApplication.id)
      ) {
        setActiveProposalCardData((prev: any) =>
          prev
            ? {
                ...prev,
                status: reviewedApplication.status,
                reviewNotes: reviewedApplication.reviewNotes || prev.reviewNotes,
              }
            : prev
        );
      }

      setView(isWide ? 'detail' : 'sidebar');

      // Reload data in background without blocking UI
      console.log('Reloading data in background...');
      void loadData();



      // Show success alert after reload

      if (status === 'Approved') {

        const title = app.proposalDetails?.proposedTitle || 'Untitled';

        setTimeout(() => {

          if (Platform.OS === 'web') {

            if (typeof window !== 'undefined') {

              window.alert(`✅ Proposal Approved!\n\n"${title}" has been approved and a new project has been created in the Program Management Suite.`);

            }

          } else {

            Alert.alert('Proposal Approved! ✅', `"${title}" has been approved and a new project has been created in the Program Management Suite.`, [{ text: 'OK' }]);

          }

        }, 200);

      }

    } catch (e) {

      setProposalChats(previousProposalChats);

      setSelectedProposalApplication(previousSelectedProposalApplication);

      setView(isWide ? 'detail' : 'sidebar');

      Alert.alert('Error', 'Failed to complete review.');

    }

  };


  const openProposalRevision = (cardData: any) => {
    if (!user) return;

    const applicationId = String(cardData.applicationId || cardData.id || '');
    const currentApplication = proposalChats.find(
      item => item.application.id === applicationId
    )?.application;
    if (currentApplication && currentApplication.status !== 'Rejected') {
      Alert.alert(
        'Proposal finalized',
        'This proposal has already been approved or is pending review and can no longer be revised.'
      );
      setActiveProposalCardData(null);
      return;
    }

    const requestedProgramModule = String(cardData.requestedProgramModule || cardData.programModule || 'Nutrition');
    // IMPORTANT: Use the application's projectId (not targetProjectId) so backend can match and increment revision
    const applicationProjectId = String(cardData.projectId || 'new');
    const title = String(cardData.proposedTitle || cardData.title || '');

    console.log('🔄 Opening proposal revision:');
    console.log('  - Application ID:', applicationId);
    console.log('  - Project ID:', applicationProjectId);
    console.log('  - Program Module:', requestedProgramModule);

    setProposalIntent({
      module: requestedProgramModule,
      projectId: applicationProjectId,  // This must be the application's projectId for backend matching!
      title,
    });
    setProposalRevisionMode(true);

    setProposalForm({
      proposedTitle: title,
      proposedDescription: String(cardData.proposedDescription || ''),
      proposedStartDate: String(cardData.proposedStartDate || ''),
      proposedEndDate: String(cardData.proposedEndDate || ''),
      proposedLocation: String(cardData.proposedLocation || ''),
      proposedVolunteersNeeded: String(cardData.proposedVolunteersNeeded || ''),
      communityNeed: String(cardData.communityNeed || ''),
      expectedDeliverables: String(cardData.expectedDeliverables || ''),
    });

    setView('detail');
    setActiveProposalCardData(null);
  };

  const filteredConversations = conversations.filter(c => c.user.name.toLowerCase().includes(searchText.toLowerCase()));

  const filteredProjects = projectChats.filter(c => c.project.title.toLowerCase().includes(searchText.toLowerCase()));

  const filteredProposals = proposalChats.filter(c => c.application.partnerName.toLowerCase().includes(searchText.toLowerCase()) || c.projectTitle.toLowerCase().includes(searchText.toLowerCase()));

  const filteredUsers = allUsers.filter(u => u.name.toLowerCase().includes(searchText.toLowerCase()));

  const pendingProposalCount = pendingProposalChats.length;



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

    <View style={[styles.sidebar, !isWide && { width: '100%', flex: 1, borderRightWidth: 0 }, !isWide && view === 'detail' && styles.hidden]}>

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



      {!isTablet && (

        <View style={styles.sectionTabs}>

          {availableSections.map(section => {

            const sectionMeta = getSidebarSectionMeta(section);

            return (

              <TouchableOpacity

                key={section}

                onPress={() => setActiveSection(section)}

                style={[styles.sectionTab, activeSection === section && styles.sectionTabActive]}

              >

                <View style={[styles.sectionTabIconWrap, activeSection === section && styles.sectionTabIconWrapActive]}>

                  <MaterialIcons

                    name={sectionMeta.icon}

                    size={18}

                    color={activeSection === section ? '#ffffff' : '#166534'}

                  />

                </View>

                <Text style={[styles.sectionTabText, activeSection === section && styles.sectionTabTextActive]}>

                  {sectionMeta.label}

                </Text>

                {section === 'proposals' && pendingProposalCount > 0 ? (

                  <View style={[styles.sectionTabBadge, activeSection === section && styles.sectionTabBadgeActive]}>

                    <Text

                      style={[

                        styles.sectionTabBadgeText,

                        activeSection === section && styles.sectionTabBadgeTextActive,

                      ]}

                    >

                      {pendingProposalCount}

                    </Text>

                  </View>

                ) : null}

              </TouchableOpacity>

            );

          })}

        </View>

      )}



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

                getMessagePreviewText(c.lastMessage),

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

            <Text style={styles.listSectionLabel}>

              {pendingProposalCount > 0

                ? `Project Proposals ΓÇó ${pendingProposalCount} pending`

                : 'Project Proposals'}

            </Text>

            {filteredProposals.length > 0 ? (

              filteredProposals.map(p => renderSidebarItem(

                p.application.id,

                p.projectTitle,

                `${p.application.partnerName} ΓÇó ${p.application.status}`,

                selectedProposalApplication?.id === p.application.id,

                () => { setSelectedProposalApplication(p.application); setSelectedUser(null); setSelectedProjectChat(null); setProposalIntent(null); setView('detail'); },

                {

                  icon: 'description',

                  color:

                    p.application.status === 'Approved'

                      ? '#166534'

                      : p.application.status === 'Rejected'

                      ? '#dc2626'

                      : '#f59e0b',

                  badge: p.application.status === 'Pending' ? 1 : (p.application.status === 'Rejected' ? 1 : undefined),

                }

              ))

            ) : (

              <Text style={styles.emptyListText}>

                No partner proposals yet. Submitted proposals will appear here for admin review.

              </Text>

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

          <View style={[styles.detailHeader, !isWide && { paddingTop: insets.top, height: 70 + insets.top }]}>

            {!isWide && (

              <TouchableOpacity onPress={() => setView('sidebar')} style={styles.backButton}>

                <Ionicons name="arrow-back" size={24} color="#166534" />

              </TouchableOpacity>

            )}

            <View style={{ flex: 1, flexShrink: 1 }}>

              <Text style={styles.detailTitle} numberOfLines={1} ellipsizeMode="tail">New Project Proposal</Text>

              <Text style={styles.detailSubtitle} numberOfLines={1} ellipsizeMode="tail">Track: {proposalIntent.module}</Text>

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

              {Object.keys(proposalValidationErrors).length > 0 ? (
                <View style={styles.formValidationBanner}>
                  <MaterialIcons name="error-outline" size={18} color="#b91c1c" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formValidationBannerTitle}>Missing Required Information</Text>
                    <Text style={styles.formValidationBannerText}>
                      {Object.values(proposalValidationErrors)[0]}
                    </Text>
                  </View>
                </View>
              ) : null}



              <View style={styles.formGroup}>

                <Text style={styles.formLabel}>
                  Project Title <Text style={styles.requiredAsterisk}>*</Text>
                </Text>

                <TextInput

                  style={[styles.formInput, proposalValidationErrors.proposedTitle ? styles.inputError : null]}

                  placeholder="e.g. Community Nutrition Drive 2024"

                  value={proposalForm.proposedTitle}

                  onChangeText={t => {
                    setProposalForm(f => ({ ...f, proposedTitle: t }));
                    if (proposalValidationErrors.proposedTitle) {
                      setProposalValidationErrors(prev => {
                        const n = { ...prev };
                        delete n.proposedTitle;
                        return n;
                      });
                    }
                  }}

                />

                {proposalValidationErrors.proposedTitle ? (
                  <View style={styles.fieldErrorRow}>
                    <MaterialIcons name="error" size={13} color="#dc2626" />
                    <Text style={styles.fieldErrorText}>{proposalValidationErrors.proposedTitle}</Text>
                  </View>
                ) : null}

              </View>



              <View style={styles.formGroup}>

                <Text style={styles.formLabel}>
                  Detailed Description <Text style={styles.requiredAsterisk}>*</Text>
                </Text>

                <TextInput

                  style={[
                    styles.formInput,
                    { height: 120, textAlignVertical: 'top' },
                    proposalValidationErrors.proposedDescription ? styles.inputError : null,
                  ]}

                  multiline

                  placeholder="Outline the goals, target beneficiaries, and scope..."

                  value={proposalForm.proposedDescription}

                  onChangeText={t => {
                    setProposalForm(f => ({ ...f, proposedDescription: t }));
                    if (proposalValidationErrors.proposedDescription) {
                      setProposalValidationErrors(prev => {
                        const n = { ...prev };
                        delete n.proposedDescription;
                        return n;
                      });
                    }
                  }}

                />

                {proposalValidationErrors.proposedDescription ? (
                  <View style={styles.fieldErrorRow}>
                    <MaterialIcons name="error" size={13} color="#dc2626" />
                    <Text style={styles.fieldErrorText}>{proposalValidationErrors.proposedDescription}</Text>
                  </View>
                ) : null}

              </View>



              <View style={styles.formRow}>

                <View style={[styles.formGroup, { flex: 1 }]}>

                  <Text style={styles.formLabel}>
                    Start Date <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>

                  <TouchableOpacity

                    style={[
                      styles.pickerTrigger,
                      proposalValidationErrors.proposedStartDate ? styles.pickerTriggerError : null,
                    ]}

                    onPress={() => setShowStartDatePicker(true)}

                  >

                    <MaterialIcons
                      name="calendar-today"
                      size={18}
                      color={proposalValidationErrors.proposedStartDate ? '#dc2626' : '#166534'}
                    />

                    <Text style={[styles.pickerTriggerText, !proposalForm.proposedStartDate && styles.pickerPlaceholder]}>

                      {proposalForm.proposedStartDate || 'Select date'}

                    </Text>

                  </TouchableOpacity>

                  {proposalValidationErrors.proposedStartDate ? (
                    <View style={styles.fieldErrorRow}>
                      <MaterialIcons name="error" size={13} color="#dc2626" />
                      <Text style={styles.fieldErrorText}>{proposalValidationErrors.proposedStartDate}</Text>
                    </View>
                  ) : null}

                  {showStartDatePicker && (

                    <LazyDateTimePicker

                      value={proposalForm.proposedStartDate ? new Date(proposalForm.proposedStartDate) : new Date()}

                      mode="date"

                      display={Platform.OS === 'ios' ? 'inline' : 'calendar'}

                      onChange={(event: any, date?: Date) => {

                        setShowStartDatePicker(false);

                        if (date) {
                          const dateStr = date.toISOString().split('T')[0];
                          setProposalForm(f => ({ ...f, proposedStartDate: dateStr }));
                          if (proposalValidationErrors.proposedStartDate) {
                            setProposalValidationErrors(prev => {
                              const n = { ...prev };
                              delete n.proposedStartDate;
                              return n;
                            });
                          }
                        }

                      }}

                    />

                  )}

                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>

                  <Text style={styles.formLabel}>
                    End Date <Text style={styles.requiredAsterisk}>*</Text>
                  </Text>

                  <TouchableOpacity

                    style={[
                      styles.pickerTrigger,
                      proposalValidationErrors.proposedEndDate ? styles.pickerTriggerError : null,
                    ]}

                    onPress={() => setShowEndDatePicker(true)}

                  >

                    <MaterialIcons
                      name="calendar-today"
                      size={18}
                      color={proposalValidationErrors.proposedEndDate ? '#dc2626' : '#166534'}
                    />

                    <Text style={[styles.pickerTriggerText, !proposalForm.proposedEndDate && styles.pickerPlaceholder]}>

                      {proposalForm.proposedEndDate || 'Select date'}

                    </Text>

                  </TouchableOpacity>

                  {proposalValidationErrors.proposedEndDate ? (
                    <View style={styles.fieldErrorRow}>
                      <MaterialIcons name="error" size={13} color="#dc2626" />
                      <Text style={styles.fieldErrorText}>{proposalValidationErrors.proposedEndDate}</Text>
                    </View>
                  ) : null}

                  {showEndDatePicker && (

                    <LazyDateTimePicker

                      value={proposalForm.proposedEndDate ? new Date(proposalForm.proposedEndDate) : new Date()}

                      mode="date"

                      display={Platform.OS === 'ios' ? 'inline' : 'calendar'}

                      onChange={(event: any, date?: Date) => {

                        setShowEndDatePicker(false);

                        if (date) {
                          const dateStr = date.toISOString().split('T')[0];
                          setProposalForm(f => ({ ...f, proposedEndDate: dateStr }));
                          if (proposalValidationErrors.proposedEndDate) {
                            setProposalValidationErrors(prev => {
                              const n = { ...prev };
                              delete n.proposedEndDate;
                              return n;
                            });
                          }
                        }

                      }}

                    />

                  )}

                </View>

              </View>



              <View style={styles.formGroup}>

                <Text style={styles.formLabel}>
                  Target Location <Text style={styles.requiredAsterisk}>*</Text>
                </Text>

                <View style={[
                  styles.addressContainer,
                  proposalValidationErrors.proposedLocation ? styles.addressContainerError : null,
                ]}>

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

                        }}

                        style={styles.picker}

                      >

                        <Picker.Item label="Select City" value="" color="#94a3b8" />

                        {filteredCities.map(c => <Picker.Item key={c.code} label={c.name} value={c.code} />)}

                      </Picker>

                    </View>

                  </View>

                </View>

                {proposalValidationErrors.proposedLocation ? (
                  <View style={styles.fieldErrorRow}>
                    <MaterialIcons name="error" size={13} color="#dc2626" />
                    <Text style={styles.fieldErrorText}>{proposalValidationErrors.proposedLocation}</Text>
                  </View>
                ) : null}

              </View>



              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Proposal Photo</Text>
                <TouchableOpacity style={styles.photoUploadButton} onPress={handlePickProposalPhoto}>
                  <MaterialIcons name="photo-camera" size={18} color="#ffffff" />
                  <Text style={styles.photoUploadButtonText}>
                    {proposalForm.photoAttachment ? 'Change Photo' : 'Attach Photo'}
                  </Text>
                </TouchableOpacity>
                {proposalForm.photoAttachment ? (
                  <View style={styles.photoPreviewContainer}>
                    <Image source={{ uri: proposalForm.photoAttachment }} style={styles.photoPreview} resizeMode="cover" />
                    <TouchableOpacity style={styles.photoRemoveButton} onPress={handleRemoveProposalPhoto}>
                      <Text style={styles.photoRemoveButtonText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  isSubmittingProposal && { opacity: 0.7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }
                ]}
                onPress={handleSubmitProposal}
                disabled={isSubmittingProposal}
              >
                {isSubmittingProposal ? (
                  <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                ) : null}
                <Text style={styles.submitBtnText}>
                  {isSubmittingProposal
                    ? 'Submitting Proposal...'
                    : proposalRevisionMode
                    ? 'Revise & Resubmit'
                    : 'Submit Proposal for Review'}
                </Text>
                {!isSubmittingProposal ? (
                  <MaterialIcons name="send" size={20} color="#fff" style={{ marginLeft: 8 }} />
                ) : null}
              </TouchableOpacity>

            </View>

          </ScrollView>

        </View>

      );

    }



    if (selectedProposalApplication) {

      const app = selectedProposalApplication;

      const proposalDetails: Partial<PartnerProjectProposalDetails> = app.proposalDetails || {};

      const proposalAttachments = Array.isArray(proposalDetails.attachments) ? proposalDetails.attachments : [];

      const proposalSkills = Array.isArray(proposalDetails.skillsNeeded) ? proposalDetails.skillsNeeded : [];

      const proposalTitle =

        String(proposalDetails.proposedTitle || '').trim() ||

        String(proposalDetails.targetProjectTitle || '').trim() ||

        'Untitled Proposal';

      return (

        <View style={styles.detail}>

          <View style={[styles.detailHeader, !isWide && { paddingTop: insets.top, height: 70 + insets.top }]}>

            {!isWide && (

              <TouchableOpacity onPress={() => setView('sidebar')} style={styles.backButton}>

                <Ionicons name="arrow-back" size={24} color="#166534" />

              </TouchableOpacity>

            )}

            <View style={{ flex: 1, flexShrink: 1 }}>

              <Text style={styles.detailTitle} numberOfLines={1} ellipsizeMode="tail">Proposal Review</Text>

              <Text style={styles.detailSubtitle} numberOfLines={1} ellipsizeMode="tail">{app.partnerName}</Text>

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



              <View style={styles.reviewWorkflowCard}>

                <Text style={styles.reviewWorkflowTitle}>Admin Workflow</Text>

                <Text style={styles.reviewWorkflowText}>

                  Approve this proposal to create a new project automatically. After approval, open the project in

                  Projects and add events there.

                </Text>

              </View>



              <Text style={styles.previewTitle}>{proposalTitle}</Text>



              <View style={styles.previewGrid}>

                <View style={styles.previewGridItem}>

                  <Text style={styles.previewSectionLabel}>PARTNER ORGANIZATION</Text>

                  <Text style={styles.previewTextCompact}>{app.partnerName || 'Not provided'}</Text>

                </View>

                <View style={styles.previewGridItem}>

                  <Text style={styles.previewSectionLabel}>PROGRAM MODULE</Text>

                  <Text style={styles.previewTextCompact}>

                    {proposalDetails.requestedProgramModule || 'Not provided'}

                  </Text>

                </View>

              </View>



              <View style={styles.previewGrid}>

                <View style={styles.previewGridItem}>

                  <Text style={styles.previewSectionLabel}>TIMELINE</Text>

                  <Text style={styles.previewTextCompact}>

                    {formatProposalDate(proposalDetails.proposedStartDate)} to {formatProposalDate(proposalDetails.proposedEndDate)}

                  </Text>

                </View>

                <View style={styles.previewGridItem}>

                  <Text style={styles.previewSectionLabel}>LOCATION</Text>

                  <Text style={styles.previewTextCompact}>{proposalDetails.proposedLocation || 'Not provided'}</Text>

                </View>

              </View>



              <View style={styles.previewGrid}>

                <View style={styles.previewGridItem}>

                  <Text style={styles.previewSectionLabel}>VOLUNTEER SLOTS</Text>

                  <Text style={styles.previewTextCompact}>

                    {proposalDetails.proposedVolunteersNeeded ?? 'Not provided'}

                  </Text>

                </View>

                <View style={styles.previewGridItem}>

                  <Text style={styles.previewSectionLabel}>SUBMITTED ON</Text>

                  <Text style={styles.previewTextCompact}>{formatProposalDate(app.requestedAt)}</Text>

                </View>

              </View>



              <View style={styles.previewNarrativeCard}>

                <Text style={styles.previewSectionLabel}>PROJECT DESCRIPTION</Text>

                <Text style={styles.previewText}>{proposalDetails.proposedDescription || 'Not provided'}</Text>

              </View>



              <View style={styles.previewNarrativeCard}>

                <Text style={styles.previewSectionLabel}>COMMUNITY NEED</Text>

                <Text style={styles.previewText}>{proposalDetails.communityNeed || 'Not provided'}</Text>

              </View>



              <View style={styles.previewNarrativeCard}>

                <Text style={styles.previewSectionLabel}>EXPECTED DELIVERABLES</Text>

                <Text style={styles.previewText}>{proposalDetails.expectedDeliverables || 'Not provided'}</Text>

              </View>



              <View style={styles.previewNarrativeCard}>

                <Text style={styles.previewSectionLabel}>SKILLS NEEDED</Text>

                {proposalSkills.length > 0 ? (

                  <View style={styles.previewSkillRow}>

                    {proposalSkills.map((skill: string) => (

                      <View key={skill} style={styles.previewSkillChip}>

                        <Text style={styles.previewSkillChipText}>{skill}</Text>

                      </View>

                    ))}

                  </View>

                ) : (

                  <Text style={styles.previewText}>No skills specified.</Text>

                )}

              </View>



              <View style={styles.previewNarrativeCard}>

                <Text style={styles.previewSectionLabel}>ATTACHMENTS</Text>

                {proposalAttachments.length > 0 ? (

                  <View style={styles.attachmentList}>

                    {proposalAttachments.map((attachment: any, attachmentIndex: number) => {

                      const attachmentUri = String(attachment?.url || '').trim();

                      const isImageAttachment =

                        String(attachment?.type || '').trim() === 'image' || isImageMediaUri(attachmentUri);

                      if (!attachmentUri) {

                        return null;

                      }



                      return (

                        <View key={`${attachmentUri}-${attachmentIndex}`} style={styles.attachmentCard}>

                          {isImageAttachment ? (

                            <TouchableOpacity

                              onPress={() => void handleOpenProposalAttachment(attachmentUri, attachmentIndex)}

                              activeOpacity={0.85}

                            >

                              <Image source={{ uri: attachmentUri }} style={styles.attachmentPreviewImage} />

                            </TouchableOpacity>

                          ) : (

                            <View style={styles.attachmentPreviewFile}>

                              <MaterialIcons name="description" size={28} color="#166534" />

                            </View>

                          )}

                          <View style={styles.attachmentMeta}>

                            <Text style={styles.attachmentTitle}>{getAttachmentName(attachmentUri, attachmentIndex)}</Text>

                            <Text style={styles.attachmentSubtitle}>

                              {isImageAttachment ? 'Photo attachment' : 'Document attachment'}

                            </Text>

                            <TouchableOpacity

                              style={styles.attachmentDownloadButton}

                              onPress={() => void handleOpenProposalAttachment(attachmentUri, attachmentIndex)}

                              activeOpacity={0.85}

                            >

                              <MaterialIcons name={isImageAttachment ? "visibility" : "download"} size={18} color="#166534" />

                              <Text style={styles.attachmentDownloadButtonText}>

                                {isImageAttachment ? 'View Photo' : 'Open or Download File'}

                              </Text>

                            </TouchableOpacity>

                          </View>

                        </View>

                      );

                    })}

                  </View>

                ) : (

                  <Text style={styles.previewText}>No attachments uploaded.</Text>

                )}

              </View>



              {user?.role === 'admin' && app.status === 'Pending' && (

                <View style={styles.adminActionRow}>

                  <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleReview(app, 'Approved')}>

                    <Text style={styles.actionBtnText}>Approve Proposal</Text>

                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleRejectWithNotes(app)}>

                    <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>Reject</Text>

                  </TouchableOpacity>

                </View>

              )}



              {user?.role === 'admin' && app.status === 'Approved' && (

                <View style={styles.adminActionRow}>

                  <TouchableOpacity

                    style={[styles.actionBtn, styles.approveBtn]}

                    onPress={() => navigateToAvailableRoute(navigation, 'Projects', { projectId: app.projectId })}

                  >

                    <Text style={styles.actionBtnText}>Open Project</Text>

                  </TouchableOpacity>

                </View>

              )}



              {app.status === 'Rejected' && app.reviewNotes ? (

                <View style={{ marginTop: 10, padding: 10, backgroundColor: '#fef2f2', borderRadius: 8, borderWidth: 1, borderColor: '#fecaca' }}>

                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#991b1b', marginBottom: 4 }}>Rejection Reason</Text>

                  <Text style={{ fontSize: 13, color: '#7f1d1d' }}>{app.reviewNotes}</Text>

                </View>

              ) : null}

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

          <Text style={styles.emptySubtitle}>

            {user?.role === 'admin'

              ? 'Open a partner proposal, contact, or Event GC to continue your admin workflow.'

              : user?.role === 'partner'

              ? 'Select an admin conversation to start collaborating.'

              : 'Select an admin conversation or Event GC to start collaborating.'}

          </Text>

        </View>

      );

    }



    const title = selectedUser?.name || selectedProjectChat?.project.title;

    const subtitle = selectedUser

      ? (selectedUser.role === 'admin' ? 'System Admin' : 'Direct Message')

      : 'Event GC';



    return (

      <View style={styles.detail}>

        <View style={[styles.detailHeader, !isWide && { paddingTop: insets.top, height: 70 + insets.top }]}>

          {!isWide && (

            <TouchableOpacity onPress={() => setView('sidebar')} style={styles.backButton}>

              <Ionicons name="arrow-back" size={24} color="#166534" />

            </TouchableOpacity>

          )}

          <View style={styles.headerInfo}>

            <View style={styles.headerAvatar}>

              <Text style={styles.headerAvatarText}>{title?.[0].toUpperCase()}</Text>

            </View>

            <View style={{ flex: 1, flexShrink: 1 }}>

              <Text style={styles.detailTitle} numberOfLines={1} ellipsizeMode="tail">{title}</Text>

              <Text style={styles.detailSubtitle} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>

            </View>

          </View>

          <View style={styles.headerActions}>

            {isWide && (

              <TouchableOpacity

                style={styles.headerAction}

                onPress={closeActiveConversation}

                activeOpacity={0.8}

              >

                <MaterialIcons name="close" size={22} color="#64748b" />

              </TouchableOpacity>

            )}

            {selectedProjectChat ? (

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

                      onPress={handleOpenGcMembers}

                      activeOpacity={0.85}

                    >

                      <MaterialIcons name="groups" size={18} color="#166534" />

                      <Text style={styles.conversationMenuText}>View Members</Text>

                    </TouchableOpacity>

                    <TouchableOpacity

                      style={styles.conversationMenuItem}

                      onPress={handleOpenGcProjectDetails}

                      activeOpacity={0.85}

                    >

                      <MaterialIcons name="open-in-new" size={18} color="#166534" />

                      <Text style={styles.conversationMenuText}>Open Event Details</Text>

                    </TouchableOpacity>

                    {user?.role === 'admin' ? (

                      <TouchableOpacity

                        style={[styles.conversationMenuItem, styles.conversationMenuItemDanger]}

                        onPress={handleDeleteEventGc}

                        activeOpacity={0.85}

                        disabled={conversationMenuAction === 'delete-gc'}

                      >

                        {conversationMenuAction === 'delete-gc' ? (

                          <ActivityIndicator size="small" color="#dc2626" />

                        ) : (

                          <MaterialIcons name="delete-forever" size={18} color="#dc2626" />

                        )}

                        <Text style={styles.conversationMenuDangerText}>Delete GC</Text>

                      </TouchableOpacity>

                    ) : null}

                    {user?.role === 'volunteer' ? (

                    <TouchableOpacity

                      style={[styles.conversationMenuItem, styles.conversationMenuItemDanger]}

                      onPress={handleLeaveEventGc}

                      activeOpacity={0.85}

                    >

                      <MaterialIcons name="logout" size={18} color="#dc2626" />

                      <Text style={styles.conversationMenuDangerText}>Leave GC</Text>

                    </TouchableOpacity>

                    ) : null}

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

            (() => {

              // Deduplicate proposal cards with same status/timestamp (prevents duplicates)
              // Each status change (Pending → Rejected → Approved) is a separate card
              const filteredMessages = dedupeProposalReviewCards(messages);

              return filteredMessages.map((m, i) => {

              const isOwn = m.senderId === messageUserId;

              const isProposal = m.content.startsWith(PROPOSAL_PREFIX);



              if (isProposal) {

                let application: any = {};

                try {

                  application = JSON.parse(m.content.replace(PROPOSAL_PREFIX, ''));

                } catch (e) { return null; }

                
                // Handle both nested (proposalDetails) and flat (legacy) formats
                const proposalDetails = application.proposalDetails || {};
                const data = {
                  proposedTitle: proposalDetails.proposedTitle || application.proposedTitle || 'Untitled Proposal',
                  proposedDescription: proposalDetails.proposedDescription || application.proposedDescription || 'No description provided.',
                  proposedStartDate: proposalDetails.proposedStartDate || application.proposedStartDate || 'TBD',
                  proposedEndDate: proposalDetails.proposedEndDate || application.proposedEndDate || 'TBD',
                  proposedLocation: proposalDetails.proposedLocation || application.proposedLocation || 'TBD',
                  proposedVolunteersNeeded: proposalDetails.proposedVolunteersNeeded || application.proposedVolunteersNeeded || '0',
                  status: application.status || 'Pending',
                  id: application.id,
                };

                const isApproved = application.status === 'Approved';
                const isRejected = application.status === 'Rejected';
                const revisionNumber = Number(application.revisionNumber || 0);
                const applicationId = String(application.applicationId || application.id || '');
                
                // Determine if this is a review card (from admin) or submission card (from partner)
                const isReviewCard = m.id.startsWith('review-card-');
                const isSubmissionCard = m.id.startsWith('msg-proposal-');
                
                const followsRejection = filteredMessages.slice(0, i).some(previousMessage => {
                  if (!previousMessage.content?.startsWith(PROPOSAL_PREFIX)) return false;
                  try {
                    const previousApplication = JSON.parse(previousMessage.content.replace(PROPOSAL_PREFIX, ''));
                    return (
                      String(previousApplication.applicationId || previousApplication.id || '') === applicationId &&
                      previousApplication.status === 'Rejected'
                    );
                  } catch {
                    return false;
                  }
                });
                const proposalLabel = revisionNumber > 0 || followsRejection
                  ? `Revised Proposal${revisionNumber > 0 ? ` #${revisionNumber}` : ''}`
                  : 'Proposal';
                
                // For submission cards: show "Your proposal has been submitted"
                // For review cards: show "Your proposal has been approved/rejected"
                let statusColor = isApproved ? '#166534' : isRejected ? '#dc2626' : '#d97706';
                let statusBg = isApproved ? '#dcfce7' : isRejected ? '#fee2e2' : '#fef3c7';
                let statusDisplay = 'DRAFT';
                let statusIcon: any = 'edit-note';
                let summaryLead = '';
                
                const moduleLabel =
                  String(proposalDetails.requestedProgramModule || application.programModule || '').trim() ||
                  data.proposedTitle;
                
                if (isReviewCard) {
                  // This is admin's response card
                  statusDisplay = isApproved ? 'APPROVED' : 'REJECTED';
                  statusIcon = isApproved ? 'check-circle' : 'cancel';
                  summaryLead = isApproved
                    ? `Your proposal for "${moduleLabel}" has been reviewed and has been approved`
                    : `Your proposal for "${moduleLabel}" has been reviewed and needs changes`;
                } else if (isSubmissionCard) {
                  // This is partner's submission card
                  const isRevision = revisionNumber > 0 || followsRejection;
                  statusDisplay = isRevision ? 'RESUBMITTED' : 'SUBMITTED';
                  statusIcon = 'send';
                  statusColor = isRevision ? '#7c3aed' : '#2563eb';
                  statusBg = isRevision ? '#ede9fe' : '#dbeafe';
                  summaryLead = revisionNumber > 0
                    ? `Your revised proposal for "${moduleLabel}" has been submitted for review`
                    : `Your proposal for "${moduleLabel}" has been submitted for review`;
                } else {
                  // Legacy card without proper ID prefix
                  statusDisplay = isApproved ? 'APPROVED' : isRejected ? 'REJECTED' : 'DRAFT';
                  statusIcon = isApproved ? 'check-circle' : isRejected ? 'cancel' : 'edit-note';
                  summaryLead = isApproved
                    ? `Your proposal for "${moduleLabel}" has been submitted and has been approved`
                    : isRejected
                      ? `Your proposal for "${moduleLabel}" has been reviewed and needs changes`
                      : `Your proposal for "${moduleLabel}" has been saved as a draft`;
                }
                
                const dateRange = data.proposedEndDate && data.proposedEndDate !== 'TBD'
                  ? `${formatProposalDate(data.proposedStartDate)} - ${formatProposalDate(data.proposedEndDate)}`
                  : formatProposalDate(data.proposedStartDate);

                return (

                  <View key={`proposal-${m.id}-${i}`} style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther, styles.proposalMessageRow]}>

                    <TouchableOpacity 

                      style={styles.proposalMsgCard}

                      onPress={() => {

                        setActiveProposalCardData({ ...application, messageId: m.id });

                      }}

                      activeOpacity={0.7}

                    >

                      {/* Status Badge Header */}
                      <View style={[styles.propStatusHeader, { backgroundColor: statusBg }]}>
                        <View style={styles.propStatusIconCircle}>
                          <MaterialIcons name={statusIcon} size={20} color={statusColor} />
                        </View>
                        <Text style={[styles.propStatusText, { color: statusColor }]}>
                          {statusDisplay}
                        </Text>
                      </View>

                      {/* Status Message */}
                      <Text style={styles.propStatusMessage} numberOfLines={2}>
                        {summaryLead}
                      </Text>

                      {/* Project Details */}
                      <View style={styles.propCardBody}>
                        <View style={styles.propProjectSummary}>
                          <Text style={styles.propProjectTitle} numberOfLines={1}>
                            {data.proposedTitle}
                          </Text>
                          
                          <Text style={styles.propCardDesc} numberOfLines={2}>
                            {data.proposedDescription || 'No description provided.'}
                          </Text>

                          <View style={styles.propMetaRow}>
                            <MaterialIcons name="event" size={16} color="#64748b" />
                            <Text style={styles.propMetaText} numberOfLines={1}>{dateRange}</Text>
                          </View>

                          <View style={styles.propMetaRow}>
                            <MaterialIcons name="location-on" size={16} color="#64748b" />
                            <Text style={styles.propMetaText} numberOfLines={1}>{data.proposedLocation || 'TBD'}</Text>
                          </View>
                        </View>

                        {isRejected && application.reviewNotes ? (
                          <View style={styles.propRejectionNote}>
                            <Text style={styles.propRejectionNoteLabel}>Rejection reason</Text>
                            <Text style={styles.propRejectionNoteText} numberOfLines={2}>
                              {application.reviewNotes}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* CTA Button */}
                      <View style={styles.propCardCta}>
                        <MaterialIcons name={isApproved ? "work" : "visibility"} size={18} color="#ffffff" />
                        <Text style={styles.propCardCtaText}>
                          {isApproved ? 'View my Projects' : 'View proposal details'}
                        </Text>
                        <MaterialIcons name="arrow-forward" size={18} color="#ffffff" />
                      </View>

                    </TouchableOpacity>

                    <Text style={styles.messageTime}>
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>

                  </View>

                );

              }



              const messageAttachments = m.attachments || [];



              return (

                <View key={`msg-${m.id}-${i}`} style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>

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

              });

            })()

          )}

        </ScrollView>



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

      {availableSections.map(section => {

        const sectionMeta = getSidebarSectionMeta(section);

        const isActive = activeSection === section;

        const badgeCount = section === 'proposals' ? pendingProposalCount : 0;



        return (

          <TouchableOpacity

            key={section}

            style={[styles.railItem, isActive && styles.railItemActive]}

            onPress={() => setActiveSection(section)}

            activeOpacity={0.85}

          >

            <MaterialIcons

              name={sectionMeta.icon}

              size={24}

              color={isActive ? '#ffffff' : 'rgba(255,255,255,0.72)'}

            />

            {badgeCount > 0 ? (

              <View style={styles.railBadge}>

                <Text style={styles.railBadgeText}>{badgeCount}</Text>

              </View>

            ) : null}

          </TouchableOpacity>

        );

      })}

      <View style={{ flex: 1 }} />

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

      {/* Proposal Card Detail Popup */}
      {activeProposalCardData && (() => {
        const pd = activeProposalCardData;
        const proposalDetails = pd.proposalDetails || {};
        
        // Find the matching application from proposalChats FIRST (before using it)
        const matchedApp = proposalChats.find(
          item => item.application.id === pd.applicationId || item.application.id === pd.id
        )?.application || null;
        
        // Check if there's a newer revision of this proposal
        const currentRevision = pd.revisionNumber || matchedApp?.revisionNumber || 0;
        const applicationId = pd.applicationId || pd.id || matchedApp?.id;
        const hasNewerRevision = proposalChats.some(item => {
          const app = item.application;
          const appId = app.id;
          const appProjectId = app.projectId;
          const matchesApp = appId === applicationId || appProjectId === (pd.projectId || matchedApp?.projectId);
          const appRevision = app.revisionNumber || 0;
          return matchesApp && appRevision > currentRevision;
        });
        
        // Handle both nested and flat formats
        const extractedData = {
          proposedTitle: proposalDetails.proposedTitle || pd.proposedTitle || 'Project Proposal',
          proposedDescription: proposalDetails.proposedDescription || pd.proposedDescription,
          proposedStartDate: proposalDetails.proposedStartDate || pd.proposedStartDate,
          proposedEndDate: proposalDetails.proposedEndDate || pd.proposedEndDate,
          proposedLocation: proposalDetails.proposedLocation || pd.proposedLocation,
          proposedVolunteersNeeded: proposalDetails.proposedVolunteersNeeded ?? pd.proposedVolunteersNeeded,
          communityNeed: proposalDetails.communityNeed || pd.communityNeed,
          expectedDeliverables: proposalDetails.expectedDeliverables || pd.expectedDeliverables,
          skillsNeeded: proposalDetails.skillsNeeded || pd.skillsNeeded,
          programModule: proposalDetails.requestedProgramModule || pd.programModule || pd.requestedProgramModule,
        };
        
        const pdStatus: string = pd.status || matchedApp?.status || 'Pending';
        const pdApproved = pdStatus === 'Approved';
        const pdRejected = pdStatus === 'Rejected';
        const pdPending = pdStatus === 'Pending';
        const pdStatusColor = pdApproved ? '#166534' : pdRejected ? '#dc2626' : '#d97706';
        const pdStatusBg = pdApproved ? '#dcfce7' : pdRejected ? '#fee2e2' : '#fef9c3';
        
        // Double-check: use matchedApp status if available (most up-to-date)
        const actualStatus = matchedApp?.status || pdStatus;
        const isActuallyPending = actualStatus === 'Pending' && !hasNewerRevision; // Not pending if superseded by revision
        const canReviseProposal = user?.role === 'partner' && actualStatus === 'Rejected' && !hasNewerRevision;

        return (
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { maxWidth: 520, maxHeight: '85%' }]}>
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 }}>
                <View style={[styles.propCompactIconBox, { backgroundColor: pdStatusBg, width: 40, height: 40 }]}>
                  <MaterialIcons name="assignment" size={22} color={pdStatusColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#1e293b' }} numberOfLines={2}>
                    {extractedData.proposedTitle}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <View style={[{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: pdStatusBg }]}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: pdStatusColor }}>{pdStatus}</Text>
                    </View>
                    {extractedData.programModule ? (
                      <Text style={{ fontSize: 11, color: '#64748b' }}>{extractedData.programModule}</Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity onPress={() => setActiveProposalCardData(null)} style={{ padding: 4 }}>
                  <MaterialIcons name="close" size={22} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
                {/* Description */}
                {extractedData.proposedDescription ? (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Description</Text>
                    <Text style={{ fontSize: 13, color: '#374151', lineHeight: 20 }}>{extractedData.proposedDescription}</Text>
                  </View>
                ) : null}

                {/* Meta grid */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  {extractedData.proposedStartDate ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <MaterialIcons name="event" size={14} color="#64748b" />
                      <Text style={{ fontSize: 12, color: '#374151' }}>{extractedData.proposedStartDate}</Text>
                    </View>
                  ) : null}
                  {extractedData.proposedVolunteersNeeded ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <MaterialIcons name="people" size={14} color="#64748b" />
                      <Text style={{ fontSize: 12, color: '#374151' }}>{extractedData.proposedVolunteersNeeded} Volunteers</Text>
                    </View>
                  ) : null}
                  {extractedData.proposedLocation ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <MaterialIcons name="location-on" size={14} color="#64748b" />
                      <Text style={{ fontSize: 12, color: '#374151' }}>{extractedData.proposedLocation}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Community need */}
                {extractedData.communityNeed ? (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Community Need</Text>
                    <Text style={{ fontSize: 13, color: '#374151', lineHeight: 20 }}>{extractedData.communityNeed}</Text>
                  </View>
                ) : null}

                {/* Expected deliverables */}
                {extractedData.expectedDeliverables ? (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Expected Deliverables</Text>
                    <Text style={{ fontSize: 13, color: '#374151', lineHeight: 20 }}>{extractedData.expectedDeliverables}</Text>
                  </View>
                ) : null}

                {Array.isArray(proposalDetails.attachments) && proposalDetails.attachments.length > 0 ? (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Attachments</Text>
                    <View style={styles.attachmentList}>
                      {proposalDetails.attachments.map((attachment: any, attachmentIndex: number) => {
                        const attachmentUri = String(attachment?.url || '').trim();
                        const isImageAttachment =
                          String(attachment?.type || '').trim() === 'image' || isImageMediaUri(attachmentUri);
                        if (!attachmentUri) {
                          return null;
                        }

                        return (
                          <View key={`${attachmentUri}-${attachmentIndex}`} style={styles.attachmentCard}>
                            {isImageAttachment ? (
                              <TouchableOpacity
                                onPress={() => void handleOpenProposalAttachment(attachmentUri, attachmentIndex)}
                                activeOpacity={0.85}
                              >
                                <Image source={{ uri: attachmentUri }} style={styles.attachmentPreviewImage} />
                              </TouchableOpacity>
                            ) : (
                              <View style={styles.attachmentPreviewFile}>
                                <MaterialIcons name="description" size={28} color="#166534" />
                              </View>
                            )}
                            <View style={styles.attachmentMeta}>
                              <Text style={styles.attachmentTitle}>{getAttachmentName(attachmentUri, attachmentIndex)}</Text>
                              <Text style={styles.attachmentSubtitle}>
                                {isImageAttachment ? 'Photo attachment' : 'Document attachment'}
                              </Text>
                              <TouchableOpacity
                                style={styles.attachmentDownloadButton}
                                onPress={() => void handleOpenProposalAttachment(attachmentUri, attachmentIndex)}
                                activeOpacity={0.85}
                              >
                                <MaterialIcons name="download" size={18} color="#166534" />
                                <Text style={styles.attachmentDownloadButtonText}>
                                  {isImageAttachment ? 'Open or Download Photo' : 'Open or Download File'}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {/* Rejection reason (if rejected) */}
                {pdRejected && pd.reviewNotes ? (
                  <View style={{ marginBottom: 12, padding: 10, backgroundColor: '#fef2f2', borderRadius: 8, borderWidth: 1, borderColor: '#fecaca' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#991b1b', marginBottom: 4 }}>Rejection Reason</Text>
                    <Text style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 18 }}>{pd.reviewNotes}</Text>
                  </View>
                ) : null}

                {/* Superseded warning */}
                {hasNewerRevision ? (
                  <View style={{ marginBottom: 12, padding: 10, backgroundColor: '#fffbeb', borderRadius: 8, borderWidth: 1, borderColor: '#fcd34d' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <MaterialIcons name="info" size={16} color="#d97706" />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#d97706' }}>OLDER VERSION</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: '#92400e', lineHeight: 18 }}>
                      This is an older version. A revised proposal has been submitted.
                    </Text>
                  </View>
                ) : null}
              </ScrollView>

              {/* Admin actions — only for pending proposals where we have the application */}
              {user?.role === 'admin' && isActuallyPending && matchedApp ? (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { flex: 1, backgroundColor: '#f3f4f6' }]}
                    onPress={() => {
                      setActiveProposalCardData(null);
                      handleRejectWithNotes(matchedApp);
                    }}
                  >
                    <Text style={[styles.actionBtnText, { color: '#dc2626' }]}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn, { flex: 2 }]}
                    onPress={() => {
                      setActiveProposalCardData(null);
                      void handleReview(matchedApp, 'Approved');
                    }}
                  >
                    <Text style={styles.actionBtnText}>Approve Proposal</Text>
                  </TouchableOpacity>
                </View>
              ) : canReviseProposal ? (
                <TouchableOpacity
                  style={[styles.reviseBtn, { marginTop: 16, borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }]}
                  onPress={() => {
                    openProposalRevision(pd);
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="edit" size={20} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 }}>Revise & Resubmit</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#f3f4f6', marginTop: 14 }]}
                  onPress={() => setActiveProposalCardData(null)}
                >
                  <Text style={[styles.actionBtnText, { color: '#374151' }]}>Close</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })()}



      {/* Rejection Notes Modal */}

      {showRejectionModal && pendingRejectApp && (

        <View style={styles.modalOverlay}>

          <View style={[styles.modalContainer, { maxWidth: 480 }]}>

            <Text style={[styles.modalTitle, { marginBottom: 8 }]}>Reject Proposal</Text>

            <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>

              Provide a reason so the partner can revise and resubmit.

            </Text>

            <TextInput

              style={[styles.input, { height: 100, textAlignVertical: 'top', marginBottom: 16 }]}

              placeholder="Rejection reason (required)"

              value={rejectionNotes}

              onChangeText={setRejectionNotes}

              multiline

              maxLength={500}

            />

            <View style={{ flexDirection: 'row', gap: 10 }}>

              <TouchableOpacity

                style={[styles.actionBtn, { flex: 1, backgroundColor: '#f3f4f6' }]}

                onPress={() => { setShowRejectionModal(false); setPendingRejectApp(null); }}

              >

                <Text style={[styles.actionBtnText, { color: '#374151' }]}>Cancel</Text>

              </TouchableOpacity>

              <TouchableOpacity

                style={[styles.actionBtn, styles.rejectBtn, { flex: 1, opacity: rejectionNotes.trim() ? 1 : 0.5 }]}

                disabled={!rejectionNotes.trim()}

                onPress={() => {

                  const app = pendingRejectApp;

                  const notes = rejectionNotes.trim();

                  setShowRejectionModal(false);

                  setPendingRejectApp(null);

                  void handleReview(app, 'Rejected', notes);

                }}

              >

                <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>Confirm Reject</Text>

              </TouchableOpacity>

            </View>

          </View>

        </View>

      )}



      {reviewNotice ? (

        <View style={styles.reviewNoticeWrap}>

          <View

            style={[

              styles.reviewNoticeCard,

              reviewNotice.tone === 'warning' ? styles.reviewNoticeWarning : styles.reviewNoticeSuccess,

            ]}

          >

            <MaterialIcons

              name={reviewNotice.tone === 'warning' ? 'info' : 'check-circle'}

              size={18}

              color={reviewNotice.tone === 'warning' ? '#9a3412' : '#166534'}

            />

            <View style={styles.reviewNoticeTextWrap}>

              <Text

                style={[

                  styles.reviewNoticeTitle,

                  reviewNotice.tone === 'warning' ? styles.reviewNoticeTitleWarning : null,

                ]}

              >

                {reviewNotice.title}

              </Text>

              <Text

                style={[

                  styles.reviewNoticeMessage,

                  reviewNotice.tone === 'warning' ? styles.reviewNoticeMessageWarning : null,

                ]}

              >

                {reviewNotice.message}

              </Text>

            </View>

            <TouchableOpacity onPress={() => setReviewNotice(null)} style={styles.reviewNoticeClose}>

              <Ionicons

                name="close"

                size={18}

                color={reviewNotice.tone === 'warning' ? '#9a3412' : '#166534'}

              />

            </TouchableOpacity>

          </View>

        </View>

      ) : null}

      <ConfirmDialog
        visible={dialogState.visible}
        loading={dialogState.loading}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        loadingText={dialogState.loadingText}
        cancelText={dialogState.cancelText}
        confirmColor={dialogState.confirmColor}
        icon={dialogState.icon as any}
        iconColor={dialogState.iconColor}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      <Modal

        visible={showMembersModal}

        transparent

        animationType="fade"

        onRequestClose={() => setShowMembersModal(false)}

      >

        <View style={styles.membersModalBackdrop}>

          <View style={styles.membersModalCard}>

            <View style={styles.membersModalHeader}>

              <View>

                <Text style={styles.membersModalTitle}>GC Members</Text>

                <Text style={styles.membersModalSubtitle}>

                  {selectedProjectChat?.project.title || 'Event GC'}

                </Text>

              </View>

              <TouchableOpacity

                style={styles.membersModalClose}

                onPress={() => setShowMembersModal(false)}

                activeOpacity={0.85}

              >

                <Ionicons name="close" size={20} color="#475569" />

              </TouchableOpacity>

            </View>



            <ScrollView style={styles.membersList} showsVerticalScrollIndicator>

              {(selectedProjectChat?.members || []).length > 0 ? (

                selectedProjectChat?.members.map(member => (

                  <View key={`${member.role}:${member.id}`} style={styles.memberItem}>

                    <View

                      style={[

                        styles.memberAvatar,

                        member.role === 'Admin'

                          ? styles.memberAvatarAdmin

                          : member.role === 'Partner'

                          ? styles.memberAvatarPartner

                          : styles.memberAvatarVolunteer,

                      ]}

                    >

                      <Text style={styles.memberAvatarText}>

                        {member.name.charAt(0).toUpperCase()}

                      </Text>

                    </View>

                    <View style={styles.memberInfo}>

                      <Text style={styles.memberName}>{member.name}</Text>

                      {member.detail ? (

                        <Text style={styles.memberDetail} numberOfLines={1}>

                          {member.detail}

                        </Text>

                      ) : null}

                    </View>

                    <View style={styles.memberRoleBadge}>

                      <Text style={styles.memberRoleText}>{member.role}</Text>

                    </View>

                  </View>

                ))

              ) : (

                <View style={styles.membersEmptyState}>

                  <MaterialIcons name="groups" size={28} color="#94a3b8" />

                  <Text style={styles.membersEmptyText}>No members found for this GC.</Text>

                </View>

              )}

            </ScrollView>

          </View>

        </View>

      </Modal>

      <Modal

        visible={Boolean(previewImageUri)}

        transparent

        animationType="fade"

        onRequestClose={() => setPreviewImageUri(null)}

      >

        <View style={styles.imagePreviewBackdrop}>

          <View style={styles.imagePreviewCard}>

            <View style={styles.imagePreviewHeader}>

              <Text style={styles.imagePreviewTitle}>Preview Photo</Text>

              <TouchableOpacity onPress={() => setPreviewImageUri(null)} style={styles.imagePreviewClose}>

                <MaterialIcons name="close" size={20} color="#0f172a" />

              </TouchableOpacity>

            </View>

            <Image

              source={{ uri: previewImageUri || '' }}

              style={styles.imagePreviewImage}

              resizeMode="contain"

            />

          </View>

        </View>

      </Modal>

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

  reviewNoticeWrap: {

    paddingHorizontal: 16,

    paddingTop: 12,

    paddingBottom: 4,

  },

  reviewNoticeCard: {

    flexDirection: 'row',

    alignItems: 'flex-start',

    gap: 10,

    borderRadius: 14,

    borderWidth: 1,

    paddingHorizontal: 14,

    paddingVertical: 12,

  },

  reviewNoticeSuccess: {

    backgroundColor: '#dcfce7',

    borderColor: '#86efac',

  },

  reviewNoticeWarning: {

    backgroundColor: '#ffedd5',

    borderColor: '#fdba74',

  },

  reviewNoticeTextWrap: {

    flex: 1,

  },

  reviewNoticeTitle: {

    fontSize: 13,

    fontWeight: '800',

    color: '#166534',

  },

  reviewNoticeTitleWarning: {

    color: '#9a3412',

  },

  reviewNoticeMessage: {

    marginTop: 2,

    fontSize: 12,

    lineHeight: 18,

    color: '#166534',

  },

  reviewNoticeMessageWarning: {

    color: '#9a3412',

  },

  reviewNoticeClose: {

    padding: 2,

  },



  navRail: {

    width: 72,

    backgroundColor: '#166534',

    alignItems: 'center',

    paddingVertical: 24,

    gap: 16

  },

  railItem: {

    width: 52,

    height: 52,

    borderRadius: 18,

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor: 'rgba(255,255,255,0.12)',

    position: 'relative',

  },

  railItemActive: { backgroundColor: 'rgba(255,255,255,0.22)' },

  railBadge: {

    position: 'absolute',

    top: -4,

    right: -2,

    minWidth: 20,

    height: 20,

    borderRadius: 10,

    backgroundColor: '#f59e0b',

    alignItems: 'center',

    justifyContent: 'center',

    paddingHorizontal: 5,

  },

  railBadgeText: {

    color: '#ffffff',

    fontSize: 10,

    fontWeight: '900',

  },

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

    padding: 12,

    paddingBottom: 8

  },

  sidebarHeaderTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5 },

  sidebarHeaderAction: {

    width: 30,

    height: 30,

    borderRadius: 8,

    backgroundColor: '#f0fdf4',

    alignItems: 'center',

    justifyContent: 'center'

  },



  searchBox: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8,

    marginHorizontal: 12,

    paddingHorizontal: 10,

    paddingVertical: 6,

    backgroundColor: '#f8fafc',

    borderRadius: 10,

    marginBottom: 10

  },

  searchInput: { flex: 1, fontSize: 13, color: '#1e293b' },



  sectionTabs: {

    flexDirection: 'row',

    paddingHorizontal: 12,

    gap: 8,

    marginBottom: 8,

    flexWrap: 'wrap',

  },

  sectionTab: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    paddingVertical: 6,

    paddingHorizontal: 10,

    borderRadius: 10,

    backgroundColor: '#f1f5f9',

    borderWidth: 1,

    borderColor: '#e2e8f0',

  },

  sectionTabActive: {

    backgroundColor: '#166534',

    borderColor: '#166534',

  },

  sectionTabIconWrap: {

    width: 24,

    height: 24,

    borderRadius: 8,

    backgroundColor: '#dcfce7',

    alignItems: 'center',

    justifyContent: 'center',

  },

  sectionTabIconWrapActive: {

    backgroundColor: 'rgba(255,255,255,0.18)',

  },

  sectionTabText: { fontSize: 11, fontWeight: '700', color: '#64748b' },

  sectionTabTextActive: { color: '#fff' },

  sectionTabBadge: {

    minWidth: 18,

    height: 18,

    borderRadius: 9,

    backgroundColor: '#dcfce7',

    alignItems: 'center',

    justifyContent: 'center',

    paddingHorizontal: 4,

  },

  sectionTabBadgeActive: {

    backgroundColor: 'rgba(255,255,255,0.2)',

  },

  sectionTabBadgeText: {

    fontSize: 9,

    fontWeight: '900',

    color: '#166534',

  },

  sectionTabBadgeTextActive: {

    color: '#ffffff',

  },



  sidebarList: { flex: 1 },

  listSectionLabel: {

    fontSize: 10,

    fontWeight: '800',

    color: '#94a3b8',

    textTransform: 'uppercase',

    letterSpacing: 1.2,

    paddingHorizontal: 12,

    marginTop: 10,

    marginBottom: 6

  },

  sidebarItem: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 10,

    padding: 8,

    marginHorizontal: 6,

    borderRadius: 10,

    marginBottom: 4

  },

  sidebarItemActive: { backgroundColor: '#f0fdf4' },

  sidebarAvatar: {

    width: 32,

    height: 32,

    borderRadius: 10,

    alignItems: 'center',

    justifyContent: 'center'

  },

  sidebarAvatarText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  sidebarItemInfo: { flex: 1 },

  sidebarItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  sidebarItemTitle: { fontSize: 13, fontWeight: '800', color: '#1e293b' },

  sidebarItemTitleActive: { color: '#166534' },

  sidebarItemSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },

  sidebarItemSubtitleActive: { color: '#166534', opacity: 0.8 },

  sidebarBadge: { backgroundColor: '#166534', borderRadius: 8, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },

  sidebarBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },

  emptyListText: { textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 12 },



  detail: { flex: 1, backgroundColor: '#fff' },

  detailHeader: {

    height: 70,

    flexDirection: 'row',

    alignItems: 'center',

    paddingHorizontal: 18,

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    overflow: 'visible',

    zIndex: 50,

    elevation: 12,

  },

  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },

  headerAvatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#166534', alignItems: 'center', justifyContent: 'center' },

  headerAvatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  detailTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a' },

  detailSubtitle: { fontSize: 13, color: '#166534', fontWeight: '600', marginTop: 1 },

  headerActions: { flexDirection: 'row', gap: 4, zIndex: 60 },

  headerAction: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  conversationMenuWrap: { position: 'relative', zIndex: 70 },

  conversationMenu: {

    position: 'absolute',

    right: 0,

    top: 44,

    minWidth: 190,

    backgroundColor: '#ffffff',

    borderRadius: 16,

    padding: 8,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    shadowColor: '#0f172a',

    shadowOffset: { width: 0, height: 8 },

    shadowOpacity: 0.12,

    shadowRadius: 18,

    elevation: 8,

    zIndex: 80,

  },

  conversationMenuItem: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8,

    paddingHorizontal: 10,

    paddingVertical: 10,

    borderRadius: 12,

    backgroundColor: '#f8fafc',

  },

  conversationMenuItemDanger: {

    backgroundColor: '#fef2f2',

  },

  conversationMenuText: { fontSize: 12, fontWeight: '800', color: '#166534' },

  conversationMenuDangerText: { fontSize: 12, fontWeight: '900', color: '#dc2626' },

  backButton: { marginRight: 16 },



  membersModalBackdrop: {

    flex: 1,

    backgroundColor: 'rgba(15,23,42,0.48)',

    alignItems: 'center',

    justifyContent: 'center',

    padding: 18,

  },

  membersModalCard: {

    width: '100%',

    maxWidth: 520,

    maxHeight: '82%',

    backgroundColor: '#ffffff',

    borderRadius: 22,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    overflow: 'hidden',

    shadowColor: '#0f172a',

    shadowOffset: { width: 0, height: 16 },

    shadowOpacity: 0.18,

    shadowRadius: 28,

    elevation: 14,

  },

  membersModalHeader: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    gap: 12,

    paddingHorizontal: 18,

    paddingVertical: 16,

    borderBottomWidth: 1,

    borderBottomColor: '#e2e8f0',

    backgroundColor: '#f8fafc',

  },

  membersModalTitle: {

    fontSize: 16,

    fontWeight: '900',

    color: '#0f172a',

  },

  membersModalSubtitle: {

    marginTop: 2,

    fontSize: 12,

    fontWeight: '700',

    color: '#166534',

  },

  membersModalClose: {

    width: 34,

    height: 34,

    borderRadius: 12,

    backgroundColor: '#ffffff',

    alignItems: 'center',

    justifyContent: 'center',

    borderWidth: 1,

    borderColor: '#e2e8f0',

  },

  membersList: {

    padding: 12,

  },

  memberItem: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 10,

    padding: 10,

    borderRadius: 16,

    borderWidth: 1,

    borderColor: '#eef2f7',

    backgroundColor: '#ffffff',

    marginBottom: 8,

  },

  memberAvatar: {

    width: 38,

    height: 38,

    borderRadius: 14,

    alignItems: 'center',

    justifyContent: 'center',

  },

  memberAvatarAdmin: {

    backgroundColor: '#166534',

  },

  memberAvatarPartner: {

    backgroundColor: '#0369a1',

  },

  memberAvatarVolunteer: {

    backgroundColor: '#b45309',

  },

  memberAvatarText: {

    fontSize: 14,

    fontWeight: '900',

    color: '#ffffff',

  },

  memberInfo: {

    flex: 1,

    minWidth: 0,

  },

  memberName: {

    fontSize: 13,

    fontWeight: '900',

    color: '#0f172a',

  },

  memberDetail: {

    marginTop: 2,

    fontSize: 11,

    fontWeight: '600',

    color: '#64748b',

  },

  memberRoleBadge: {

    paddingHorizontal: 8,

    paddingVertical: 5,

    borderRadius: 999,

    backgroundColor: '#f0fdf4',

    borderWidth: 1,

    borderColor: '#bbf7d0',

  },

  memberRoleText: {

    fontSize: 10,

    fontWeight: '900',

    color: '#166534',

  },

  membersEmptyState: {

    alignItems: 'center',

    justifyContent: 'center',

    paddingVertical: 36,

    gap: 8,

  },

  membersEmptyText: {

    fontSize: 12,

    fontWeight: '700',

    color: '#64748b',

    textAlign: 'center',

  },

  

  imagePreviewBackdrop: {

    flex: 1,

    backgroundColor: 'rgba(15, 23, 42, 0.7)',

    justifyContent: 'center',

    alignItems: 'center',

    padding: 20,

  },

  imagePreviewCard: {

    width: '100%',

    maxWidth: 720,

    backgroundColor: '#fff',

    borderRadius: 20,

    overflow: 'hidden',

  },

  imagePreviewHeader: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    padding: 16,

    borderBottomWidth: 1,

    borderBottomColor: '#e2e8f0',

  },

  imagePreviewTitle: {

    fontSize: 16,

    fontWeight: '800',

    color: '#0f172a',

  },

  imagePreviewClose: {

    padding: 8,

  },

  imagePreviewImage: {

    width: '100%',

    height: 420,

    backgroundColor: '#f8fafc',

  },



  messagesList: { flex: 1 },

  messagesListContent: { padding: 10, gap: 8 },

  messageRow: { maxWidth: '85%', gap: 4 },

  proposalMessageRow: { maxWidth: '92%', width: '92%' },

  messageRowOwn: { alignSelf: 'flex-end', alignItems: 'flex-end' },

  messageRowOther: { alignSelf: 'flex-start' },

  bubble: { padding: 8, borderRadius: 12 },

  bubbleOwn: { backgroundColor: '#166534', borderBottomRightRadius: 3 },

  bubbleOther: { backgroundColor: '#f1f5f9', borderBottomLeftRadius: 3 },

  bubbleText: { fontSize: 12, lineHeight: 16, color: '#334155' },

  bubbleTextOwn: { color: '#fff' },

  messageAttachmentList: { gap: 6, marginTop: 8 },

  messageAttachmentCard: {

    minWidth: 160,

    maxWidth: 240,

    borderRadius: 12,

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

    width: 200,

    height: 120,

    backgroundColor: '#e2e8f0',

  },

  messageAttachmentFileIcon: {

    width: 200,

    height: 72,

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor: '#dcfce7',

  },

  messageAttachmentFileIconOwn: {

    backgroundColor: 'rgba(255,255,255,0.14)',

  },

  messageAttachmentName: {

    paddingHorizontal: 8,

    paddingVertical: 6,

    fontSize: 10,

    fontWeight: '800',

    color: '#334155',

  },

  messageAttachmentNameOwn: { color: '#ffffff' },

  messageTime: { fontSize: 9, color: '#94a3b8', fontWeight: '600' },

  emptyChat: { padding: 20, alignItems: 'center' },

  emptyChatText: { color: '#94a3b8', fontSize: 11 },



  attachmentMenu: {

    flexDirection: 'row',

    gap: 8,

    paddingHorizontal: 12,

    paddingTop: 8,

    paddingBottom: 4,

    borderTopWidth: 1,

    borderTopColor: '#f1f5f9',

    backgroundColor: '#ffffff',

  },

  attachmentMenuButton: {

    flex: 1,

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    padding: 8,

    borderRadius: 10,

    backgroundColor: '#f0fdf4',

    borderWidth: 1,

    borderColor: '#bbf7d0',

  },

  attachmentMenuIcon: {

    width: 28,

    height: 28,

    borderRadius: 8,

    backgroundColor: '#ffffff',

    alignItems: 'center',

    justifyContent: 'center',

  },

  attachmentMenuTextWrap: { flex: 1 },

  attachmentMenuTitle: { fontSize: 11, fontWeight: '900', color: '#14532d' },

  attachmentMenuSubtitle: { fontSize: 10, fontWeight: '600', color: '#64748b', marginTop: 1 },

  pendingAttachmentTray: {

    flexDirection: 'row',

    flexWrap: 'wrap',

    gap: 6,

    paddingHorizontal: 12,

    paddingTop: 8,

    backgroundColor: '#ffffff',

  },

  pendingAttachmentChip: {

    maxWidth: 240,

    flexDirection: 'row',

    alignItems: 'center',

    gap: 6,

    paddingHorizontal: 8,

    paddingVertical: 5,

    borderRadius: 999,

    backgroundColor: '#f0fdf4',

    borderWidth: 1,

    borderColor: '#bbf7d0',

  },

  pendingAttachmentText: {

    flexShrink: 1,

    fontSize: 10,

    fontWeight: '800',

    color: '#166534',

  },

  composer: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8,

    padding: 10,

    paddingTop: 8,

    borderTopWidth: 1,

    borderTopColor: '#f1f5f9'

  },

  composerAdd: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  composerAddActive: { backgroundColor: '#dcfce7', borderRadius: 16 },

  inputWrap: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 14, paddingHorizontal: 10 },

  composerInput: { minHeight: 32, maxHeight: 80, fontSize: 13, color: '#1e293b', paddingVertical: 6 },

  sendBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#166534', alignItems: 'center', justifyContent: 'center' },

  sendBtnDisabled: { opacity: 0.5 },



  detailEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },

  emptyIconCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },

  emptyTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', marginBottom: 8 },

  emptySubtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22 },



  detailScrollContent: { padding: 18 },

  proposalCard: {

    backgroundColor: '#fff',

    borderRadius: 24,

    padding: 20,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    shadowColor: '#000',

    shadowOffset: { width: 0, height: 8 },

    shadowOpacity: 0.05,

    shadowRadius: 20,

    elevation: 5

  },

  proposalHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },

  proposalTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a' },

  proposalMeta: { fontSize: 12, color: '#64748b', marginTop: 4 },

  formGroup: { marginBottom: 16 },

  formLabel: { fontSize: 12, fontWeight: '800', color: '#475569', marginBottom: 6, marginLeft: 4 },

  formInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 13, fontSize: 14, color: '#0f172a' },

  photoUploadButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#166534', paddingVertical: 12, borderRadius: 14, paddingHorizontal: 14, marginTop: 6 },

  photoUploadButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  photoPreviewContainer: { marginTop: 10, alignItems: 'center', gap: 8 },

  photoPreview: { width: '100%', height: 180, borderRadius: 14, backgroundColor: '#f1f5f9' },

  photoRemoveButton: { marginTop: 8, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },

  photoRemoveButtonText: { color: '#334155', fontSize: 13, fontWeight: '700' },

  formRow: { flexDirection: 'row', gap: 12 },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#166534', paddingVertical: 15, borderRadius: 16, marginTop: 10 },

  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '900' },



  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, marginBottom: 24 },

  statusText: { fontSize: 13, fontWeight: '700' },

  reviewWorkflowCard: {

    backgroundColor: '#eff6ff',

    borderWidth: 1,

    borderColor: '#bfdbfe',

    borderRadius: 16,

    padding: 14,

    marginBottom: 24,

  },

  reviewWorkflowTitle: {

    fontSize: 13,

    fontWeight: '900',

    color: '#1d4ed8',

    textTransform: 'uppercase',

    letterSpacing: 0.6,

  },

  reviewWorkflowText: {

    marginTop: 6,

    fontSize: 12,

    lineHeight: 18,

    color: '#334155',

  },

  previewTitle: { fontSize: 22, fontWeight: '900', color: '#0f172a', marginBottom: 24 },

  previewSectionLabel: { fontSize: 12, fontWeight: '900', color: '#94a3b8', letterSpacing: 1.5, marginBottom: 8 },

  previewText: { fontSize: 14, lineHeight: 22, color: '#334155', marginBottom: 20 },

  previewTextCompact: { fontSize: 14, lineHeight: 21, color: '#334155', marginBottom: 14 },

  previewGrid: { flexDirection: 'row', gap: 24, marginBottom: 24 },

  previewGridItem: { flex: 1 },

  previewNarrativeCard: {

    backgroundColor: '#f8fafc',

    borderWidth: 1,

    borderColor: '#e2e8f0',

    borderRadius: 16,

    padding: 14,

    marginBottom: 16,

  },

  previewSkillRow: {

    flexDirection: 'row',

    flexWrap: 'wrap',

    gap: 8,

  },

  previewSkillChip: {

    paddingHorizontal: 10,

    paddingVertical: 7,

    borderRadius: 999,

    backgroundColor: '#dcfce7',

    borderWidth: 1,

    borderColor: '#86efac',

  },

  previewSkillChipText: {

    fontSize: 11,

    fontWeight: '800',

    color: '#166534',

  },

  attachmentList: {

    gap: 12,

  },

  attachmentCard: {

    borderWidth: 1,

    borderColor: '#dbe2ea',

    borderRadius: 16,

    overflow: 'hidden',

    backgroundColor: '#ffffff',

  },

  attachmentPreviewImage: {

    width: '100%',

    height: 120,

    backgroundColor: '#e2e8f0',

  },

  attachmentPreviewFile: {

    width: '100%',

    height: 98,

    backgroundColor: '#f0fdf4',

    alignItems: 'center',

    justifyContent: 'center',

    borderBottomWidth: 1,

    borderBottomColor: '#dbe2ea',

  },

  attachmentMeta: {

    padding: 12,

    gap: 6,

  },

  attachmentTitle: {

    fontSize: 13,

    fontWeight: '800',

    color: '#0f172a',

  },

  attachmentSubtitle: {

    fontSize: 12,

    color: '#64748b',

    marginBottom: 8,

  },

  attachmentDownloadButton: {

    alignSelf: 'flex-start',

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8,

    paddingHorizontal: 12,

    paddingVertical: 9,

    borderRadius: 10,

    backgroundColor: '#f0fdf4',

    borderWidth: 1,

    borderColor: '#86efac',

  },

  attachmentDownloadButtonText: {

    fontSize: 12,

    fontWeight: '800',

    color: '#166534',

  },

  adminActionRow: { flexDirection: 'row', gap: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 32 },

  actionBtn: { flex: 1, paddingVertical: 18, borderRadius: 16, alignItems: 'center' },

  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  reviseBtnText: { color: '#ffffff' },

  approveBtn: { backgroundColor: '#166534' },

  reviseBtn: { backgroundColor: '#047857', borderWidth: 1, borderColor: '#0f766e' },

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



  // ΓöÇΓöÇ Message Hub Template Panel ΓöÇΓöÇ

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



  // Message Hub ΓÇö Proposal Form styles

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



  // ΓöÇΓöÇ Proposal Card Styles ΓöÇΓöÇ

  proposalMsgCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '100%',
    minHeight: 240,

    borderWidth: 1,

    borderColor: '#e2e8f0',

    shadowColor: '#000',

    shadowOffset: { width: 0, height: 2 },

    shadowOpacity: 0.04,

    shadowRadius: 6,

    elevation: 2,

    overflow: 'hidden',

  },

  propCardHeader: {

    flexDirection: 'row',

    alignItems: 'flex-start',

    gap: 10,

    padding: 12,

    borderBottomWidth: 1,

    borderBottomColor: '#f1f5f9',

    backgroundColor: '#fffbeb',

  },

  propCardIconBox: {

    width: 40,

    height: 40,

    borderRadius: 8,

    backgroundColor: '#fef3c7',

    alignItems: 'center',

    justifyContent: 'center',

    flexShrink: 0,

  },

  propCompactIconBox: {

    width: 40,

    height: 40,

    borderRadius: 12,

    alignItems: 'center',

    justifyContent: 'center',

  },

  propCardTitle: {

    fontSize: 15,

    fontWeight: '700',

    color: '#92400e',

    lineHeight: 20,

  },

  propCardSubtitle: {

    fontSize: 12,

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

    fontSize: 12,

    fontWeight: '800',

    color: '#166534',

  },

  propCardBody: {

    padding: 16,

    flex: 1,

  },

  propCardDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
    marginBottom: 14,

  },

  propRejectionNote: {

    borderRadius: 10,

    borderWidth: 1,

    borderColor: '#fecaca',

    backgroundColor: '#fef2f2',

    padding: 10,

    marginBottom: 12,

  },

  propRejectionNoteLabel: {

    fontSize: 11,

    fontWeight: '800',

    color: '#991b1b',

    marginBottom: 4,

  },

  propRejectionNoteText: {

    fontSize: 12,

    color: '#7f1d1d',

    lineHeight: 17,

  },

  propCardMetaGrid: {

    flexDirection: 'row',

    flexWrap: 'nowrap',

    gap: 8,

    height: 32,

  },

  propCardMetaItem: {

    flex: 1,

    flexDirection: 'row',

    alignItems: 'center',

    gap: 4,

    backgroundColor: '#f8fafc',

    paddingHorizontal: 8,

    paddingVertical: 6,

    borderRadius: 8,

    minWidth: 0,

  },

  propCardMetaText: {

    fontSize: 12,

    fontWeight: '600',

    color: '#64748b',

    flex: 1,

  },

  propCardFooter: {

    flexDirection: 'row',

    padding: 16,

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

  modalOverlay: {

    position: 'absolute',

    top: 0,

    left: 0,

    right: 0,

    bottom: 0,

    backgroundColor: 'rgba(0, 0, 0, 0.5)',

    justifyContent: 'center',

    alignItems: 'center',

    zIndex: 1000,

  },

  modalContainer: {

    backgroundColor: '#fff',

    borderRadius: 12,

    padding: 20,

    shadowColor: '#000',

    shadowOffset: { width: 0, height: 4 },

    shadowOpacity: 0.3,

    shadowRadius: 8,

    elevation: 10,

  },

  modalTitle: {

    fontSize: 18,

    fontWeight: '700',

    color: '#1e293b',

  },

  input: {

    borderWidth: 1,

    borderColor: '#cbd5e1',

    borderRadius: 10,

    paddingHorizontal: 12,

    paddingVertical: 10,

    color: '#0f172a',

    backgroundColor: '#ffffff',

  },

  propTapHint: {

    fontSize: 11,

    color: '#94a3b8',

    textAlign: 'center',

    paddingVertical: 8,

    paddingHorizontal: 12,

    fontStyle: 'italic',

  },
  propStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },

  propStatusIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  propStatusText: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  propStatusMessage: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    paddingHorizontal: 16,
    paddingVertical: 10,
    lineHeight: 19,
  },

  propProjectSummary: {
    flex: 1,
  },

  propProjectTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
    letterSpacing: 0.3,
  },

  propMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },

  propMetaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    flex: 1,
  },

  propCardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3f6f54',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginHorizontal: 16,
    marginBottom: 16,
    marginTop: 4,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },

  propCardCtaText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },

  // ── Validation Error Styles ───────────────────────────────────────────────

  requiredAsterisk: {
    color: '#dc2626',
    fontWeight: '700',
  },

  formValidationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#fca5a5',
    marginBottom: 10,
  },

  formValidationBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 2,
  },

  formValidationBannerText: {
    fontSize: 12,
    color: '#b91c1c',
    lineHeight: 16,
  },

  inputError: {
    borderColor: '#ef4444',
    borderWidth: 1.5,
    backgroundColor: '#fff5f5',
  },

  pickerTriggerError: {
    borderColor: '#ef4444',
    borderWidth: 1.5,
    backgroundColor: '#fff5f5',
  },

  addressContainerError: {
    borderColor: '#ef4444',
    borderWidth: 1.5,
    borderRadius: 12,
    backgroundColor: '#fff5f5',
    padding: 4,
  },

  fieldErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },

  fieldErrorText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '600',
  },

});



