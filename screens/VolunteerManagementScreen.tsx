import React, { useState, useEffect } from 'react';
import ModernTheme from '../utils/modernTheme';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  FlatList,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Volunteer, Project, VolunteerProjectMatch, VolunteerTimeLog, User, UserType, NVCSector, VolunteerAffiliation } from '../models/types';
import {
  assignVolunteerToProject,
  getAllVolunteers,
  getAllProjects,
  getVolunteerCompletedProjectIds,
  getAllVolunteerTimeLogs,
  getVolunteerProjectMatches,
  saveVolunteer,
  subscribeToStorageChanges,
  approveUser,
  rejectUser,
  getUser,
  sendRejectionEmail,
  getApiBaseUrl,
} from '../models/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import InlineLoadError from '../components/InlineLoadError';
import UserAccountDetailsModal from '../components/UserAccountDetailsModal';
import { getProjectDisplayStatus } from '../utils/projectStatus';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import { getAttachmentLabel, isImageMediaUri, openAttachmentUri } from '../utils/media';

// Lets admins inspect volunteers, update availability, and assign projects.
export default function VolunteerManagementScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const insets = useSafeAreaInsets();

  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const hasInitialVolunteerId = Boolean(route?.params?.volunteerId);
  const [view, setView] = useState<'list' | 'detail'>(hasInitialVolunteerId ? 'detail' : 'list');
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [selectedVolunteerCompletedProjectIds, setSelectedVolunteerCompletedProjectIds] = useState<string[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [volunteerTimeLogs, setVolunteerTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [showAccountDetailsModal, setShowAccountDetailsModal] = useState(false);
  const [daysPerWeek, setDaysPerWeek] = useState('3');
  const [hoursPerWeek, setHoursPerWeek] = useState('12');
  const [availableDays, setAvailableDays] = useState<string[]>(['Monday', 'Wednesday', 'Saturday']);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Approved'>('All');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionError, setRejectionError] = useState<string | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'applications' | 'approved' | 'profiles' | 'reports' | null>(null);

  useEffect(() => {
    if (navigation) {
      const showHeader = view === 'list';
      navigation.setOptions({ headerShown: showHeader });
    }
  }, [view, navigation]);

  useEffect(() => {
    if (!actionNotice) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setActionNotice(null);
    }, 1000);

    return () => clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    // Load volunteers and projects quickly; defer heavy time-log audit
    void loadVolunteers();
    void loadProjects();
    setTimeout(() => {
      void loadTimeLogs();
    }, 50);
  }, [isAdmin]);

  useEffect(() => {
    const volunteerId = route?.params?.volunteerId;
    if (!isAdmin || !volunteerId) {
      return;
    }

    // If volunteers haven't loaded yet, wait for them
    if (volunteers.length === 0) {
      return;
    }

    const targetVolunteer = volunteers.find(volunteer => volunteer.id === volunteerId);
    if (!targetVolunteer) {
      return;
    }

    // Select the volunteer and load their details
    setSelectedVolunteer(targetVolunteer);
    void loadSelectedVolunteerDetails(targetVolunteer.id, targetVolunteer.userId);
    setView('detail');
    // Clear the param after processing
    navigation.setParams({ volunteerId: undefined });
  }, [isAdmin, navigation, route?.params?.volunteerId, volunteers]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return subscribeToStorageChanges(
      ['volunteers', 'projects', 'volunteerMatches', 'volunteerProjectJoins', 'volunteerTimeLogs'],
      () => {
        void loadVolunteers();
        void loadProjects();
        setTimeout(() => {
          void loadTimeLogs();
        }, 100);
        if (selectedVolunteer) {
          void loadSelectedVolunteerDetails(selectedVolunteer.id, selectedVolunteer.userId);
        }
      }
    );
  }, [isAdmin, selectedVolunteer?.id]);

  // Loads all volunteer profiles and keeps the selected volunteer in sync.
  const loadVolunteers = async () => {
    try {
      const allVolunteers = await getAllVolunteers();
      setVolunteers(allVolunteers);
      setLoadError(null);
      setSelectedVolunteer(currentSelectedVolunteer => {
        if (!currentSelectedVolunteer) {
          return currentSelectedVolunteer;
        }

        return (
          allVolunteers.find(volunteer => volunteer.id === currentSelectedVolunteer.id) ||
          currentSelectedVolunteer
        );
      });
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteers.'),
      });
    }
  };

  // Loads available projects for matching and detail display.
  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load projects.'),
      });
    }
  };

  // Loads every volunteer time log so admins can audit time-in/time-out activity.
  const loadTimeLogs = async () => {
    try {
      const logs = await getAllVolunteerTimeLogs();
      setVolunteerTimeLogs(logs);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load volunteer time logs.'),
      });
    }
  };

  // Loads match history, completed projects, and linked user account for the selected volunteer.
  const loadSelectedVolunteerDetails = async (volunteerId: string, linkedUserId?: string) => {
    try {
      const matches = await getVolunteerProjectMatches(volunteerId);
      setVolunteerMatches(matches);
    } catch (err) {
      setVolunteerMatches([]);
    }

    setSelectedVolunteerCompletedProjectIds([]);
    setTimeout(async () => {
      try {
        const completedProjectIds = await getVolunteerCompletedProjectIds(volunteerId);
        setSelectedVolunteerCompletedProjectIds(completedProjectIds);
      } catch {}
    }, 50);

    try {
      if (linkedUserId) {
        const linkedUser = await getUser(linkedUserId);
        setSelectedUser(linkedUser);
      } else {
        setSelectedUser(null);
      }
    } catch {
      setSelectedUser(null);
    }
  };

  // Opens the detail view for the chosen volunteer.
  const handleSelectVolunteer = (volunteer: Volunteer) => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage volunteers.');
      return;
    }

    setSelectedVolunteer(volunteer);
    void loadSelectedVolunteerDetails(volunteer.id, volunteer.userId);
    setView('detail');
  };

  // Closes the availability editor after save or cancel.
  const closeAvailabilityModal = () => {
    setShowAvailabilityModal(false);
  };

  const closeRejectModal = () => {
    setShowRejectModal(false);
    setRejectionReason('');
    setRejectionError(null);
    setIsRejecting(false);
  };

  const handleApproveVolunteer = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can approve volunteers.');
      return;
    }
    if (!selectedVolunteer || isApproving || isRejecting) return;
    const adminId = user?.id || '';
    const previousVolunteers = volunteers;
    const previousSelected = selectedVolunteer;
    setIsApproving(true);
    try {
      const updated = {
        ...selectedVolunteer,
        registrationStatus: 'Approved' as const,
        reviewedBy: adminId,
        reviewedAt: new Date().toISOString(),
      };
      setVolunteers(current =>
        current.map(v => (v.id === updated.id ? updated : v))
      );
      setSelectedVolunteer(updated);
      setActionNotice('Volunteer application approved.');
      if (selectedVolunteer.userId) {
        await approveUser(selectedVolunteer.userId, adminId);
      } else {
        await saveVolunteer(updated);
      }
      void loadVolunteers();
    } catch (error) {
      setVolunteers(previousVolunteers);
      setSelectedVolunteer(previousSelected);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to approve volunteer application.')
      );
    } finally {
      setIsApproving(false);
    }
  };

  const handleRejectVolunteer = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can reject volunteers.');
      return;
    }
    if (!selectedVolunteer) return;

    const trimmedReason = rejectionReason.trim();
    if (!trimmedReason) {
      setRejectionError('Please provide a reason before rejecting the application.');
      return;
    }

    const adminId = user?.id || '';
    const previousVolunteers = volunteers;
    setIsRejecting(true);
    setRejectionError(null);

    try {
      // Modal stays open — spinner is shown inside the modal while we process

      // Send rejection email first (non-blocking on failure)
      const volunteerEmail = (selectedVolunteer.email || selectedUser?.email || '').trim();
      let emailNotice = '';
      if (volunteerEmail) {
        try {
          await sendRejectionEmail(volunteerEmail, selectedVolunteer.name, trimmedReason, 'volunteer');
          emailNotice = ` Notification email sent to ${volunteerEmail}.`;
        } catch (emailErr) {
          console.warn('[REJECTION-EMAIL] Failed to send rejection email:', emailErr);
        }
      }

      // Call backend approve endpoint with status=rejected to fully delete the user and all linked records
      if (selectedVolunteer.userId) {
        const response = await fetch(
          `${getApiBaseUrl()}/auth/users/${selectedVolunteer.userId}/approve?admin_id=${encodeURIComponent(adminId)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'ngrok-skip-browser-warning': '69420',
              'User-Agent': 'VolCre-App/1.0',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ status: 'rejected', rejectionReason: trimmedReason }),
          }
        );
        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Rejection failed: ${response.status} ${errText}`);
        }
      } else {
        // No linked user account — just mark the volunteer record as rejected
        await saveVolunteer({
          ...selectedVolunteer,
          registrationStatus: 'Rejected' as const,
          rejectionReason: trimmedReason,
          reviewedBy: adminId,
          reviewedAt: new Date().toISOString(),
        });
      }

      // Close modal, remove from local state, and show success notice
      closeRejectModal();
      setVolunteers(current => current.filter(v => v.id !== selectedVolunteer.id));
      setSelectedVolunteer(null);
      setActionNotice(`Application for ${selectedVolunteer.name} has been rejected and removed from the system.${emailNotice}`);

      void loadVolunteers();
    } catch (error) {
      setVolunteers(previousVolunteers);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to reject volunteer application.')
      );
    } finally {
      setIsRejecting(false);
    }
  };

  // Assigns the selected volunteer to an in-progress event.
  const handleMatchVolunteer = async (projectId: string) => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can match volunteers to events.');
      return;
    }

    if (!selectedVolunteer) return;

    const previousVolunteerMatches = volunteerMatches;
    const now = new Date().toISOString();
    const optimisticMatch: VolunteerProjectMatch = {
      id: `match-${Date.now()}`,
      volunteerId: selectedVolunteer.id,
      projectId,
      status: 'Matched',
      requestedAt: undefined,
      matchedAt: now,
      reviewedAt: now,
      reviewedBy: user?.id || '',
      hoursContributed: 0,
    };
    setVolunteerMatches(currentMatches => [...currentMatches, optimisticMatch]);
    setActionNotice('Volunteer assigned to event and notified.');

    try {
      const savedMatch = await assignVolunteerToProject(projectId, selectedVolunteer.id, user?.id || '');
      setVolunteerMatches(currentMatches =>
        currentMatches.map(match => (match.id === optimisticMatch.id ? savedMatch : match))
      );
      void loadSelectedVolunteerDetails(selectedVolunteer.id, selectedVolunteer.userId);
    } catch (error) {
      setVolunteerMatches(previousVolunteerMatches);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to match volunteer.')
      );
    }
  };

  // Saves availability changes for the selected volunteer profile.
  const handleUpdateAvailability = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can update volunteer availability.');
      return;
    }

    if (!selectedVolunteer) return;

    const previousVolunteers = volunteers;
    const previousSelectedVolunteer = selectedVolunteer;

    try {
      const updated = {
        ...selectedVolunteer,
        availability: {
          daysPerWeek: parseInt(daysPerWeek, 10),
          hoursPerWeek: parseFloat(hoursPerWeek),
          availableDays,
        },
      };

      setVolunteers(currentVolunteers =>
        currentVolunteers.map(volunteer => (volunteer.id === updated.id ? updated : volunteer))
      );
      setSelectedVolunteer(updated);
      closeAvailabilityModal();
      setActionNotice('Availability updated.');

      await saveVolunteer(updated);
      void loadVolunteers();
    } catch (error) {
      setVolunteers(previousVolunteers);
      setSelectedVolunteer(previousSelectedVolunteer);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update availability.')
      );
    }
  };

  // Adds or removes one selected day from the volunteer availability draft.
  const toggleAvailableDay = (day: string) => {
    setAvailableDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Returns one formatted timestamp for the time-log cards.
  const formatTimestamp = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--';
    return format(parsed, 'PPpp');
  };

  // Returns the logged duration in hours for one completed volunteer time log.
  const getLogDurationHours = (log: VolunteerTimeLog) => {
    if (!log.timeOut) {
      return 0;
    }

    return Math.max(
      0,
      (new Date(log.timeOut).getTime() - new Date(log.timeIn).getTime()) / 3_600_000
    );
  };

  // Downloads a CSV report with total hours per volunteer for admin review.
  const handleDownloadVolunteerHoursReport = () => {
    const rows = volunteers
      .slice()
      .sort((left, right) => right.totalHoursContributed - left.totalHoursContributed)
      .map(volunteer => {
        const logsForVolunteer = volunteerTimeLogs.filter(log => log.volunteerId === volunteer.id);
        const completedLogs = logsForVolunteer.filter(log => Boolean(log.timeOut)).length;
        const activeLogs = logsForVolunteer.length - completedLogs;

        return [
          volunteer.name,
          volunteer.email,
          volunteer.totalHoursContributed.toFixed(1),
          String(completedLogs),
          String(activeLogs),
        ];
      });

    const csv = [
      ['Volunteer Name', 'Email', 'Total Hours', 'Completed Logs', 'Active Logs'],
      ...rows,
    ]
      .map(columns =>
        columns
          .map(value => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');

    if (typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `volunteer-hours-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      return;
    }

    Alert.alert(
      'Report Ready',
      'CSV download is currently available on the admin web view.'
    );
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Volunteer Management</Text>
        <View style={styles.emptyState}>
          <MaterialIcons name="lock" size={48} color="#ccc" />
          <Text style={styles.emptyText}>Volunteer management is available only in the admin web account.</Text>
        </View>
      </View>
    );
  }

  // Returns in-progress projects already matched to the selected volunteer.
  const getMatchedProjects = () => {
    return projects.filter(p =>
      p.isEvent &&
      getProjectDisplayStatus(p) === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Matched')
    );
  };

  // Returns in-progress projects still waiting for match approval.
  const getPendingProjects = () => {
    return projects.filter(p =>
      p.isEvent &&
      getProjectDisplayStatus(p) === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Requested')
    );
  };

  // Returns in-progress projects that can still accept this volunteer.
  const getAvailableProjects = () => {
    return projects.filter(
      p =>
        p.isEvent &&
        getProjectDisplayStatus(p) === 'In Progress' &&
        !volunteerMatches.find(
          m =>
            m.projectId === p.id &&
            (m.status === 'Matched' || m.status === 'Requested' || m.status === 'Completed')
        )
    );
  };

  if (view === 'detail' && selectedVolunteer) {
    const matchedProjects = getMatchedProjects();
    const pendingProjects = getPendingProjects();
    const availableProjects = getAvailableProjects();
    const matchRecords = volunteerMatches.map(match => {
      const project = projects.find(projectEntry => projectEntry.id === match.projectId);
      return {
        ...match,
        projectTitle: project?.title || 'Project',
        projectCategory: project?.category || 'Volunteer activity',
      };
    });
    const selectedVolunteerTimeLogs = volunteerTimeLogs
      .filter(log => log.volunteerId === selectedVolunteer.id)
      .sort((a, b) => new Date(b.timeIn).getTime() - new Date(a.timeIn).getTime());
    
    // Count unique events joined from time logs, join records, and matches
    const eventsFromTimeLogs = new Set(selectedVolunteerTimeLogs.map(log => log.projectId));
    const eventsFromMatches = new Set(
      volunteerMatches
        .filter(match => match.status === 'Matched' || match.status === 'Completed')
        .map(match => match.projectId)
    );
    const joinedProjects = projects.filter(p => p.isEvent && (p.joinedUserIds || []).includes(selectedVolunteer.id));
    const eventsFromJoined = new Set(joinedProjects.map(p => p.id));
    const allUniqueEvents = new Set([...eventsFromTimeLogs, ...eventsFromMatches, ...eventsFromJoined]);
    const eventsJoinedCount = allUniqueEvents.size;
    const photoReportsCount = selectedVolunteerTimeLogs.filter(log =>
      Boolean(log.attendancePhoto || log.completionPhoto || log.completionReport)
    ).length;
    
    const completedProjects = selectedVolunteerCompletedProjectIds.map(projectId => {
      const project = projects.find(projectEntry => projectEntry.id === projectId);
      return {
        id: projectId,
        title: project?.title || projectId,
        category: project?.category,
        isEvent: project?.isEvent,
      };
    });
    const completedEventsCount = completedProjects.filter(projectEntry => Boolean(projectEntry.isEvent)).length;

    const isApplicationPending = selectedVolunteer.registrationStatus === 'Pending';
    const membershipSheet = selectedUser?.volunteerMembershipSheet;
    const pillarsOfInterest = selectedUser?.pillarsOfInterest || [];
    const userType: UserType | undefined = selectedUser?.userType;
    const certificateUri = (membershipSheet?.certificationsOrTrainings || selectedVolunteer.certificationsOrTrainings || '').trim();
    const availableDaysLabel = selectedVolunteer.availability?.availableDays?.length
      ? selectedVolunteer.availability.availableDays.join(', ')
      : '-';

    return (
      <View style={styles.container}>
        <UserAccountDetailsModal
          visible={showAccountDetailsModal}
          onClose={() => setShowAccountDetailsModal(false)}
          user={selectedUser}
        />
        <View style={[styles.header, { paddingTop: insets.top, height: 56 + insets.top }]}>
          <TouchableOpacity onPress={() => setView('list')}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>{isApplicationPending ? 'Volunteer Application' : 'Volunteer Profile'}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={{ flex: 1 }}>

        {actionNotice ? (
          <View style={styles.noticeBanner}>
            <MaterialIcons name="check-circle" size={18} color="#166534" />
            <Text style={styles.noticeBannerText}>{actionNotice}</Text>
          </View>
        ) : null}

        {isApplicationPending ? (
          <>
            <View style={styles.applicationCard}>
              <View style={styles.applicationCardTopRow}>
                <View style={[styles.applicationAvatarRow, { marginBottom: 0, flex: 1 }]}>
                  <View style={styles.applicationAvatar}>
                    <Text style={styles.applicationAvatarText}>{selectedVolunteer.name.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.applicationName}>{selectedVolunteer.name}</Text>
                    {selectedVolunteer.email ? (
                      <Text style={styles.applicationEmail}>{selectedVolunteer.email}</Text>
                    ) : null}
                    {selectedVolunteer.phone ? (
                      <Text style={styles.applicationPhone}>{selectedVolunteer.phone}</Text>
                    ) : null}
                    <View style={[styles.registrationBadge, styles.registrationBadgePending]}>
                      <Text style={styles.registrationBadgeText}>Pending Review</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.applicationActionRow}>
                  <TouchableOpacity
                    style={[
                      styles.reviewActionButton,
                      styles.reviewApproveButton,
                      (isApproving || isRejecting) && { opacity: 0.75 },
                    ]}
                    disabled={isApproving || isRejecting}
                    onPress={() => {
                      if (Platform.OS === 'web') {
                        const ok = window.confirm('Approve this volunteer application?');
                        if (!ok) return;
                        void handleApproveVolunteer();
                      } else {
                        Alert.alert(
                          'Approve Application',
                          'Approve this volunteer application?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Approve', style: 'default', onPress: () => void handleApproveVolunteer() },
                          ]
                        );
                      }
                    }}
                  >
                    {isApproving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <MaterialIcons name="check-circle" size={18} color="#fff" />
                    )}
                    <Text style={styles.reviewActionButtonText}>
                      {isApproving ? 'Approving...' : 'Approve'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.reviewActionButton,
                      styles.reviewRejectButton,
                      (isApproving || isRejecting) && { opacity: 0.75 },
                    ]}
                    disabled={isApproving || isRejecting}
                    onPress={() => setShowRejectModal(true)}
                  >
                    <MaterialIcons name="cancel" size={18} color="#fff" />
                    <Text style={styles.reviewActionButtonText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reviewActionButton, { backgroundColor: '#166534' }]}
                    onPress={() => setShowAccountDetailsModal(true)}
                  >
                    <MaterialIcons name="visibility" size={18} color="#fff" />
                    <Text style={styles.reviewActionButtonText}>Details</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.applicationCardDivider} />

              <View style={styles.applicationCardMetaRow}>
                <View style={styles.applicationCardMetaItem}>
                  <MaterialIcons name="person" size={16} color="#64748b" />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={styles.applicationInfoLabel}>User Type</Text>
                    <Text style={styles.applicationInfoValue}>
                      {userType || membershipSheet ? (userType || 'Adult') : 'Adult'}
                    </Text>
                  </View>
                </View>
                <View style={styles.applicationCardMetaItem}>
                  <MaterialIcons name="calendar-month" size={16} color="#64748b" />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={styles.applicationInfoLabel}>Submitted</Text>
                    <Text style={styles.applicationInfoValue}>
                      {format(new Date(selectedUser?.createdAt || selectedVolunteer.createdAt), 'PPpp')}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.applicationGrid}>
              <View style={styles.applicationGridColumn}>
                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="person" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Personal Information</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    {[
                      { label: 'Gender', value: membershipSheet?.gender || selectedVolunteer.gender || '-' },
                      { label: 'Date of Birth', value: membershipSheet?.dateOfBirth || selectedVolunteer.dateOfBirth || '-' },
                      { label: 'Civil Status', value: membershipSheet?.civilStatus || selectedVolunteer.civilStatus || '-' },
                      { label: 'Volunteer Status', value: selectedVolunteer.engagementStatus || '-' },
                      { label: 'Available on', value: availableDaysLabel },
                    ].map(field => (
                      <View key={field.label} style={styles.applicationFieldRow}>
                        <Text style={styles.applicationFieldLabel}>{field.label}</Text>
                        <Text style={styles.applicationFieldValue}>{field.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="location-on" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Contact &amp; Address</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    {[
                      { label: 'Full Address', value: membershipSheet?.homeAddress || selectedVolunteer.homeAddress || '-' },
                      { label: 'Region', value: membershipSheet?.homeAddressRegion || selectedVolunteer.homeAddressRegion || '-' },
                      { label: 'City / Municipality', value: membershipSheet?.homeAddressCityMunicipality || selectedVolunteer.homeAddressCityMunicipality || '-' },
                      { label: 'Barangay', value: membershipSheet?.homeAddressBarangay || selectedVolunteer.homeAddressBarangay || '-' },
                    ].map(field => (
                      <View key={field.label} style={styles.applicationFieldRow}>
                        <Text style={styles.applicationFieldLabel}>{field.label}</Text>
                        <Text style={styles.applicationFieldValue}>{field.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="school" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Education &amp; Work</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    {[
                      { label: 'Occupation', value: membershipSheet?.occupation || selectedVolunteer.occupation || '-' },
                      { label: 'Workplace / School', value: membershipSheet?.workplaceOrSchool || selectedVolunteer.workplaceOrSchool || '-' },
                      { label: 'College Course', value: membershipSheet?.collegeCourse || selectedVolunteer.collegeCourse || '-' },
                    ].map(field => (
                      <View key={field.label} style={styles.applicationFieldRow}>
                        <Text style={styles.applicationFieldLabel}>{field.label}</Text>
                        <Text style={styles.applicationFieldValue}>{field.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              <View style={styles.applicationGridColumn}>
                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="star" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Skills &amp; Interests</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    <View style={styles.applicationFieldRow}>
                      <Text style={[styles.applicationFieldLabel, { flex: 1 }]}>Certifications / Trainings</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {certificateUri && isImageMediaUri(certificateUri) ? (
                          <TouchableOpacity
                            onPress={async () => {
                              try {
                                await openAttachmentUri(certificateUri);
                              } catch (error: any) {
                                Alert.alert(
                                  'Unable to Open Certificate',
                                  error?.message || 'Certificate attachment could not be opened.',
                                );
                              }
                            }}
                            style={{ padding: 6, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8 }}
                          >
                            <MaterialIcons name="visibility" size={16} color="#166534" />
                          </TouchableOpacity>
                        ) : null}
                        <Text style={styles.applicationFieldValue}>
                          {certificateUri
                            ? isImageMediaUri(certificateUri)
                              ? getAttachmentLabel(certificateUri)
                              : certificateUri
                            : '-'}
                        </Text>
                      </View>
                    </View>

                    {selectedVolunteer.skills && selectedVolunteer.skills.length > 0 ? (
                      <View style={{ marginTop: 10 }}>
                        <Text style={styles.applicationFieldLabel}>Tagged Skills</Text>
                        <View style={styles.applicationSkillsWrap}>
                          {selectedVolunteer.skills.map(skill => (
                            <View key={skill} style={styles.applicationSkillTag}>
                              <Text style={styles.applicationSkillTagText}>{skill}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={styles.applicationStatRow}>
                  <View style={styles.applicationStatCard}>
                    <MaterialIcons name="event" size={20} color="#166534" />
                    <Text style={styles.applicationStatValue}>{eventsJoinedCount}</Text>
                    <Text style={styles.applicationStatLabel}>Events Joined</Text>
                  </View>
                  <View style={styles.applicationStatCard}>
                    <MaterialIcons name="photo-camera" size={20} color="#166534" />
                    <Text style={styles.applicationStatValue}>{photoReportsCount}</Text>
                    <Text style={styles.applicationStatLabel}>Photo Reports</Text>
                  </View>
                  <View style={styles.applicationStatCard}>
                    <MaterialIcons name="check-circle" size={20} color="#166534" />
                    <Text style={styles.applicationStatValue}>{completedEventsCount}</Text>
                    <Text style={styles.applicationStatLabel}>Completed Events</Text>
                  </View>
                </View>

                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="event-available" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Available Events</Text>
                  </View>
                  <Text style={styles.applicationStatValue}>{availableProjects.length}</Text>
                  {availableProjects.length === 0 ? (
                    <Text style={styles.applicationAvailableEmpty}>No available events</Text>
                  ) : (
                    <View style={{ marginTop: 8, gap: 6 }}>
                      {availableProjects.slice(0, 3).map(projectEntry => (
                        <Text key={projectEntry.id} style={styles.applicationAvailableItem}>
                          {projectEntry.title}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.applicationGridColumn}>
                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="bar-chart" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Activity Overview</Text>
                  </View>
                  {[
                    { label: 'Events Joined', icon: 'event', value: eventsJoinedCount },
                    { label: 'Photo Reports', icon: 'photo-camera', value: photoReportsCount },
                    { label: 'Completed Events', icon: 'check-circle', value: completedEventsCount },
                    { label: 'Available Events', icon: 'event-available', value: availableProjects.length },
                  ].map(row => (
                    <View key={row.label} style={styles.applicationOverviewRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MaterialIcons name={row.icon as any} size={16} color="#64748b" style={{ marginRight: 10 }} />
                        <Text style={styles.applicationOverviewLabel}>{row.label}</Text>
                      </View>
                      <Text style={styles.applicationOverviewValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </>
        ) : (
          <>
            {/* Header card */}
            <View style={styles.applicationCard}>
              <View style={styles.applicationCardTopRow}>
                <View style={[styles.applicationAvatarRow, { marginBottom: 0, flex: 1 }]}>
                  <View style={styles.applicationAvatar}>
                    <Text style={styles.applicationAvatarText}>{selectedVolunteer.name.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.applicationName}>{selectedVolunteer.name}</Text>
                    {selectedVolunteer.email ? (
                      <Text style={styles.applicationEmail}>{selectedVolunteer.email}</Text>
                    ) : null}
                    {selectedVolunteer.phone ? (
                      <Text style={styles.applicationPhone}>{selectedVolunteer.phone}</Text>
                    ) : null}
                    {selectedVolunteer.registrationStatus === 'Rejected' ? (
                      <View style={[styles.registrationBadge, { backgroundColor: '#fee2e2' }]}>
                        <Text style={[styles.registrationBadgeText, { color: '#dc2626' }]}>Rejected</Text>
                      </View>
                    ) : (
                      <View style={[styles.registrationBadge, styles.registrationBadgeApproved]}>
                        <Text style={styles.registrationBadgeText}>{selectedVolunteer.engagementStatus || 'Approved'}</Text>
                      </View>
                    )}
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.editButton, { padding: 10, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10 }]}
                  onPress={() => {
                    setDaysPerWeek(selectedVolunteer.availability.daysPerWeek.toString());
                    setHoursPerWeek(selectedVolunteer.availability.hoursPerWeek.toString());
                    setAvailableDays([...selectedVolunteer.availability.availableDays]);
                    setShowAvailabilityModal(true);
                  }}
                >
                  <MaterialIcons name="edit" size={18} color="#166534" />
                </TouchableOpacity>
              </View>

              <View style={styles.applicationCardDivider} />

              <View style={styles.applicationCardMetaRow}>
                <View style={styles.applicationCardMetaItem}>
                  <MaterialIcons name="person" size={16} color="#64748b" />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={styles.applicationInfoLabel}>User Type</Text>
                    <Text style={styles.applicationInfoValue}>
                      {userType || membershipSheet ? (userType || 'Adult') : 'Adult'}
                    </Text>
                  </View>
                </View>
                <View style={styles.applicationCardMetaItem}>
                  <MaterialIcons name="calendar-month" size={16} color="#64748b" />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={styles.applicationInfoLabel}>Registered</Text>
                    <Text style={styles.applicationInfoValue}>
                      {format(new Date(selectedUser?.createdAt || selectedVolunteer.createdAt), 'PPpp')}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {selectedVolunteer.registrationStatus === 'Rejected' && (
              <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 16, marginHorizontal: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <MaterialIcons name="cancel" size={18} color="#dc2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#991b1b' }}>Application Rejected</Text>
                  <Text style={{ fontSize: 13, color: '#b91c1c', marginTop: 4, lineHeight: 18 }}>
                    <Text style={{ fontWeight: '700' }}>Reason: </Text>
                    {selectedVolunteer.rejectionReason || selectedUser?.rejectionReason || 'Application did not meet requirements.'}
                  </Text>
                  {selectedVolunteer.reviewedAt && (
                    <Text style={{ fontSize: 11, color: '#7f1d1d', marginTop: 6 }}>
                      Reviewed on: {format(new Date(selectedVolunteer.reviewedAt), 'PPpp')}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Grid */}
            <View style={styles.applicationGrid}>
              {/* Left column */}
              <View style={styles.applicationGridColumn}>
                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="person" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Personal Information</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    {[
                      { label: 'Gender', value: membershipSheet?.gender || selectedVolunteer.gender || '-' },
                      { label: 'Date of Birth', value: membershipSheet?.dateOfBirth || selectedVolunteer.dateOfBirth || '-' },
                      { label: 'Civil Status', value: membershipSheet?.civilStatus || selectedVolunteer.civilStatus || '-' },
                      { label: 'Volunteer Status', value: selectedVolunteer.engagementStatus || '-' },
                      { label: 'Available on', value: availableDaysLabel },
                    ].map(field => (
                      <View key={field.label} style={styles.applicationFieldRow}>
                        <Text style={styles.applicationFieldLabel}>{field.label}</Text>
                        <Text style={styles.applicationFieldValue}>{field.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="location-on" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Contact &amp; Address</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    {[
                      { label: 'Full Address', value: membershipSheet?.homeAddress || selectedVolunteer.homeAddress || '-' },
                      { label: 'Region', value: membershipSheet?.homeAddressRegion || selectedVolunteer.homeAddressRegion || '-' },
                      { label: 'City / Municipality', value: membershipSheet?.homeAddressCityMunicipality || selectedVolunteer.homeAddressCityMunicipality || '-' },
                      { label: 'Barangay', value: membershipSheet?.homeAddressBarangay || selectedVolunteer.homeAddressBarangay || '-' },
                    ].map(field => (
                      <View key={field.label} style={styles.applicationFieldRow}>
                        <Text style={styles.applicationFieldLabel}>{field.label}</Text>
                        <Text style={styles.applicationFieldValue}>{field.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="school" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Education &amp; Work</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    {[
                      { label: 'Occupation', value: membershipSheet?.occupation || selectedVolunteer.occupation || '-' },
                      { label: 'Workplace / School', value: membershipSheet?.workplaceOrSchool || selectedVolunteer.workplaceOrSchool || '-' },
                      { label: 'College Course', value: membershipSheet?.collegeCourse || selectedVolunteer.collegeCourse || '-' },
                    ].map(field => (
                      <View key={field.label} style={styles.applicationFieldRow}>
                        <Text style={styles.applicationFieldLabel}>{field.label}</Text>
                        <Text style={styles.applicationFieldValue}>{field.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {/* Middle column */}
              <View style={styles.applicationGridColumn}>
                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="star" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Skills &amp; Interests</Text>
                  </View>
                  <View style={styles.applicationFieldList}>
                    <View style={styles.applicationFieldRow}>
                      <Text style={[styles.applicationFieldLabel, { flex: 1 }]}>Certifications / Trainings</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {certificateUri && isImageMediaUri(certificateUri) ? (
                          <TouchableOpacity
                            onPress={async () => {
                              try {
                                await openAttachmentUri(certificateUri);
                              } catch (error: any) {
                                Alert.alert(
                                  'Unable to Open Certificate',
                                  error?.message || 'Certificate attachment could not be opened.',
                                );
                              }
                            }}
                            style={{ padding: 6, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8 }}
                          >
                            <MaterialIcons name="visibility" size={16} color="#166534" />
                          </TouchableOpacity>
                        ) : null}
                        <Text style={styles.applicationFieldValue}>
                          {certificateUri
                            ? isImageMediaUri(certificateUri)
                              ? getAttachmentLabel(certificateUri)
                              : certificateUri
                            : '-'}
                        </Text>
                      </View>
                    </View>

                    {selectedVolunteer.skills && selectedVolunteer.skills.length > 0 ? (
                      <View style={{ marginTop: 10 }}>
                        <Text style={styles.applicationFieldLabel}>Tagged Skills</Text>
                        <View style={styles.applicationSkillsWrap}>
                          {selectedVolunteer.skills.map(skill => (
                            <View key={skill} style={styles.applicationSkillTag}>
                              <Text style={styles.applicationSkillTagText}>{skill}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={styles.applicationStatRow}>
                  <View style={styles.applicationStatCard}>
                    <MaterialIcons name="event" size={20} color="#166534" />
                    <Text style={styles.applicationStatValue}>{eventsJoinedCount}</Text>
                    <Text style={styles.applicationStatLabel}>Events Joined</Text>
                    <Text style={[styles.applicationStatLabel, { color: '#94a3b8' }]}>Total records</Text>
                  </View>
                  <View style={styles.applicationStatCard}>
                    <MaterialIcons name="photo-camera" size={20} color="#166534" />
                    <Text style={styles.applicationStatValue}>{photoReportsCount}</Text>
                    <Text style={styles.applicationStatLabel}>Photo Reports</Text>
                    <Text style={[styles.applicationStatLabel, { color: '#94a3b8' }]}>Total records</Text>
                  </View>
                  <View style={styles.applicationStatCard}>
                    <MaterialIcons name="check-circle" size={20} color="#166534" />
                    <Text style={styles.applicationStatValue}>{completedEventsCount}</Text>
                    <Text style={styles.applicationStatLabel}>Completed Events</Text>
                    <Text style={[styles.applicationStatLabel, { color: '#94a3b8' }]}>Total records</Text>
                  </View>
                </View>

                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="event-available" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Available Events</Text>
                    <MaterialIcons name="chevron-right" size={16} color="#94a3b8" style={{ marginLeft: 'auto' }} />
                  </View>
                  <Text style={styles.applicationStatValue}>{availableProjects.length}</Text>
                  {availableProjects.length === 0 ? (
                    <Text style={styles.applicationAvailableEmpty}>No available events</Text>
                  ) : (
                    <View style={{ marginTop: 8, gap: 6 }}>
                      {availableProjects.slice(0, 3).map(projectEntry => (
                        <View key={projectEntry.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={styles.applicationAvailableItem}>{projectEntry.title}</Text>
                          <TouchableOpacity onPress={() => handleMatchVolunteer(projectEntry.id)}>
                            <MaterialIcons name="add-circle" size={20} color="#4CAF50" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* Right column */}
              <View style={styles.applicationGridColumn}>
                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="bar-chart" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Activity Overview</Text>
                  </View>
                  {[
                    { label: 'Events Joined', icon: 'event', value: eventsJoinedCount },
                    { label: 'Photo Reports', icon: 'photo-camera', value: photoReportsCount },
                    { label: 'Completed Events', icon: 'check-circle', value: completedEventsCount },
                    { label: 'Available Events', icon: 'event-available', value: availableProjects.length },
                  ].map(row => (
                    <View key={row.label} style={styles.applicationOverviewRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MaterialIcons name={row.icon as any} size={16} color="#64748b" style={{ marginRight: 10 }} />
                        <Text style={styles.applicationOverviewLabel}>{row.label}</Text>
                      </View>
                      <Text style={styles.applicationOverviewValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>

                {/* Match Records */}
                <View style={styles.applicationPanel}>
                  <View style={styles.applicationPanelHeader}>
                    <MaterialIcons name="assignment" size={16} color="#166534" />
                    <Text style={styles.applicationPanelTitle}>Match Records</Text>
                    <Text style={[styles.applicationInfoLabel, { marginLeft: 'auto' }]}>{matchRecords.length} total</Text>
                  </View>
                  {matchRecords.length === 0 ? (
                    <Text style={styles.applicationAvailableEmpty}>No match records yet</Text>
                  ) : (
                    matchRecords.slice(0, 4).map(match => {
                      const statusStyle =
                        match.status === 'Matched'
                          ? styles.matchRecordStatusMatched
                          : match.status === 'Requested'
                          ? styles.matchRecordStatusRequested
                          : match.status === 'Completed'
                          ? styles.matchRecordStatusCompleted
                          : styles.matchRecordStatusInactive;
                      return (
                        <View key={match.id} style={styles.applicationOverviewRow}>
                          <Text style={[styles.applicationOverviewLabel, { flex: 1 }]} numberOfLines={1}>{match.projectTitle}</Text>
                          <View style={[styles.matchRecordStatusBadge, statusStyle]}>
                            <Text style={styles.matchRecordStatusText}>{match.status}</Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              </View>
            </View>


          </>
        )}

        <Modal
          visible={showAvailabilityModal}
          animationType="slide"
          onRequestClose={closeAvailabilityModal}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeAvailabilityModal}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Update Availability</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <View style={styles.formRow}>
                <TextInput
                  style={[styles.input, styles.inputWithLabel]}
                  placeholder="Number of days"
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                  value={daysPerWeek}
                  onChangeText={setDaysPerWeek}
                />
                <Text style={[styles.label, styles.labelRight]}>Days per week</Text>
              </View>

              <View style={styles.formRow}>
                <TextInput
                  style={[styles.input, styles.inputWithLabel]}
                  placeholder="Total hours"
                  placeholderTextColor="#999"
                  keyboardType="decimal-pad"
                  value={hoursPerWeek}
                  onChangeText={setHoursPerWeek}
                />
                <Text style={[styles.label, styles.labelRight]}>Hours per week</Text>
              </View>

              <View style={[styles.formRow, styles.formRowTop]}>
                <View style={[styles.daysGrid, styles.daysGridCard]}>
                  {daysOfWeek.map(day => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayButton,
                        availableDays.includes(day) && styles.dayButtonSelected,
                      ]}
                      onPress={() => toggleAvailableDay(day)}
                    >
                      <Text
                        style={[
                          styles.dayButtonText,
                          availableDays.includes(day) && styles.dayButtonTextSelected,
                        ]}
                      >
                        {day.substring(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.label, styles.labelRight, styles.labelTop]}>
                  Available days
                </Text>
              </View>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleUpdateAvailability}
              >
                <Text style={styles.submitButtonText}>Update Availability</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>

        <Modal
          visible={showRejectModal}
          transparent={true}
          animationType="fade"
          onRequestClose={isRejecting ? undefined : closeRejectModal}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <View style={{ width: '100%', maxWidth: 520, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10, overflow: 'hidden' }}>

              {/* Loading overlay — shown while rejection is processing */}
              {isRejecting && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.92)', zIndex: 10, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <ActivityIndicator size="large" color="#dc2626" />
                  <View style={{ alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a' }}>Rejecting Application…</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>Removing record and sending notification email</Text>
                  </View>
                </View>
              )}
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialIcons name="cancel" size={22} color="#dc2626" />
                  </View>
                  <View>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>Reject Volunteer Application</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>Provide a reason explaining why the application is rejected.</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={closeRejectModal} disabled={isRejecting} style={{ padding: 4 }}>
                  <MaterialIcons name="close" size={22} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* Applicant Preview */}
              {selectedVolunteer && (
                <View style={{ backgroundColor: '#f8fafc', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#475569' }}>{selectedVolunteer.name.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{selectedVolunteer.name}</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>{selectedVolunteer.email || selectedVolunteer.phone || 'Volunteer Applicant'}</Text>
                  </View>
                  <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#d97706' }}>Pending Review</Text>
                  </View>
                </View>
              )}

              {/* Quick Reason Suggestions */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>
                Common Reasons (tap to apply):
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {[
                  'Incomplete application details / missing requirements',
                  'Location outside active service coverage area',
                  'Does not meet eligibility or age criteria',
                  'Schedule and availability mismatch',
                  'Duplicate application submission',
                ].map(reasonOption => (
                  <TouchableOpacity
                    key={reasonOption}
                    onPress={() => {
                      setRejectionReason(reasonOption);
                      setRejectionError(null);
                    }}
                    style={{
                      backgroundColor: rejectionReason === reasonOption ? '#fee2e2' : '#f1f5f9',
                      borderWidth: 1,
                      borderColor: rejectionReason === reasonOption ? '#f87171' : '#e2e8f0',
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 8,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: rejectionReason === reasonOption ? '#b91c1c' : '#475569' }}>
                      {reasonOption}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Rejection Reason Input */}
              <View style={{ marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>
                    Reason for rejection <Text style={{ color: '#dc2626' }}>*</Text>
                  </Text>
                  <Text style={{ fontSize: 11, color: '#94a3b8' }}>Required</Text>
                </View>
                <TextInput
                  style={{
                    backgroundColor: '#ffffff',
                    borderWidth: 1,
                    borderColor: rejectionError ? '#ef4444' : '#cbd5e1',
                    borderRadius: 10,
                    padding: 12,
                    minHeight: 90,
                    textAlignVertical: 'top',
                    fontSize: 13,
                    color: '#0f172a',
                  }}
                  placeholder="Type or edit the specific reason for rejecting this volunteer application..."
                  placeholderTextColor="#94a3b8"
                  multiline={true}
                  numberOfLines={4}
                  value={rejectionReason}
                  onChangeText={text => {
                    setRejectionReason(text);
                    if (text.trim()) setRejectionError(null);
                  }}
                />
              </View>

              {rejectionError ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 10 }}>
                  <MaterialIcons name="error-outline" size={15} color="#dc2626" />
                  <Text style={{ fontSize: 12, color: '#dc2626', fontWeight: '600' }}>{rejectionError}</Text>
                </View>
              ) : (
                <View style={{ height: 10 }} />
              )}

              {/* Buttons */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <TouchableOpacity
                  style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' }}
                  onPress={closeRejectModal}
                  disabled={isRejecting}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: '#dc2626',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    opacity: isRejecting ? 0.75 : 1,
                  }}
                  onPress={() => void handleRejectVolunteer()}
                  disabled={isRejecting}
                >
                  {isRejecting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <MaterialIcons name="cancel" size={16} color="#ffffff" />
                  )}
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#ffffff' }}>
                    {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
    );
  }

  const sortedVolunteers = [...volunteers]
    .filter(volunteer => {
      if (statusFilter === 'Pending') return volunteer.registrationStatus === 'Pending';
      if (statusFilter === 'Approved') return volunteer.registrationStatus !== 'Pending';
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const approvedVolunteers = volunteers.filter(volunteer => volunteer.registrationStatus !== 'Pending').length;
  const pendingApplications = Math.max(0, volunteers.length - approvedVolunteers);

  return (
    <View style={styles.container}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }} {...({} as any)}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b' }}>
          {statusFilter === 'Pending' ? 'Volunteer Applications' : statusFilter === 'Approved' ? 'Approved Volunteers' : 'All Volunteers'} ({sortedVolunteers.length})
        </Text>
        {statusFilter !== 'All' && (
          <TouchableOpacity onPress={() => setStatusFilter('All')} style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#f1f5f9', borderRadius: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>Clear Filter</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={expandedSection ? [] : sortedVolunteers}
        keyExtractor={vol => vol.id}
        ListHeaderComponent={
          <>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Volunteer Management</Text>
            </View>
            <Text style={styles.managementSubtitle}>Manage volunteer applications, approvals, and profiles.</Text>
            <View style={styles.managementStats}>
        {[
          { icon: 'description', value: pendingApplications, label: 'New Applications', color: '#8b5cf6', filter: 'Pending', section: 'applications' as const },
          { icon: 'check-circle-outline', value: approvedVolunteers, label: 'Approved Volunteers', color: '#475569', filter: 'Approved', section: 'approved' as const },
          { icon: 'groups', value: volunteers.length, label: 'Total Volunteers', color: '#3b67f3', filter: 'All', section: 'profiles' as const },
          { icon: 'assignment', value: '', label: 'Reports', color: '#e99b34', filter: null, section: 'reports' as const },
        ].map(item => {
          const isSelected = expandedSection === item.section;
          return (
            <TouchableOpacity
              key={item.label}
              style={[
                styles.managementStat,
                isSelected ? { borderColor: '#cbd5e1', borderWidth: 2 } : null
              ]}
              onPress={() => {
                if (expandedSection === item.section) {
                  setExpandedSection(null);
                } else {
                  setExpandedSection(item.section);
                  if (item.filter) {
                    setStatusFilter(item.filter as any);
                  }
                }
              }}
            >
              <View style={[styles.managementStatIcon, { backgroundColor: item.color + '16' }]}>
                <MaterialIcons name={item.icon as any} size={31} color={item.color} />
              </View>
              <View>
                <Text style={styles.managementStatValue}>{item.value}</Text>
                <Text style={styles.managementStatLabel}>{item.label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.managementPanel}>
        <Text style={styles.managementPanelTitle}>Volunteer Management</Text>
        <View style={styles.managementActions}>
          {[
            { icon: 'assignment', title: 'Volunteer Applications', body: 'Review and manage new volunteer applications.', color: '#8b5cf6', action: 'View Applications', filter: 'Pending', section: 'applications' as const },
            { icon: 'badge', title: 'Approved Volunteers', body: 'View and manage all approved volunteers.', color: '#475569', action: 'View Approved Volunteers', filter: 'Approved', section: 'approved' as const },
            { icon: 'account-circle', title: 'Volunteer Profiles', body: 'Browse and manage volunteer profiles and information.', color: '#3b67f3', action: 'View Volunteer Profiles', filter: 'All', section: 'profiles' as const },
          ].map(item => {
            const isSelected = expandedSection === item.section;
            return (
              <TouchableOpacity
                key={item.title}
                style={[
                  styles.managementAction,
                  { borderColor: isSelected ? '#cbd5e1' : item.color + '28', borderWidth: isSelected ? 2 : 1 }
                ]}
                onPress={() => {
                  if (expandedSection === item.section) {
                    setExpandedSection(null);
                  } else {
                    setExpandedSection(item.section);
                    setStatusFilter(item.filter as any);
                  }
                }}
              >
                <View style={[styles.managementActionIcon, { backgroundColor: item.color + '14' }]}>
                  <MaterialIcons name={item.icon as any} size={54} color={item.color} />
                </View>
                <Text style={styles.managementActionTitle}>{item.title}</Text>
                <Text style={styles.managementActionBody}>{item.body}</Text>
                <View style={[styles.managementActionButton, { borderColor: item.color, backgroundColor: 'transparent' }]}>
                  <Text style={[styles.managementActionButtonText, { color: item.color }]}>
                    {isSelected ? 'Hide Details' : item.action}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      
      {/* Expanded Details Section - Appears Below Management Cards */}
      {expandedSection === 'applications' && (
        <View style={[styles.expandedDetailsCard, { marginHorizontal: 16, marginTop: 20, marginBottom: 20, marginLeft: 16, marginRight: 16 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', fontFamily: 'Nunito' }}>
              Volunteer Applications Details
            </Text>
            <TouchableOpacity onPress={() => setExpandedSection(null)}>
              <MaterialIcons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 12, fontFamily: 'Nunito' }}>
            {pendingApplications} pending application{pendingApplications !== 1 ? 's' : ''} awaiting review
          </Text>
          {pendingApplications > 0 ? (
            <View style={{ gap: 8 }}>
              {volunteers.filter(v => v.registrationStatus === 'Pending').slice(0, 3).map(vol => (
                <View key={vol.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fef3c7', borderRadius: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a', fontFamily: 'Nunito' }}>{vol.name}</Text>
                    <Text style={{ fontSize: 12, color: '#64748b', fontFamily: 'Nunito' }}>{vol.email}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleSelectVolunteer(vol)}
                    style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#8b5cf6', borderRadius: 8 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13, fontFamily: 'Nunito' }}>Review</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <MaterialIcons name="check-circle" size={48} color="#86efac" />
              <Text style={{ marginTop: 12, fontSize: 14, color: '#64748b', fontFamily: 'Nunito' }}>All applications reviewed</Text>
            </View>
          )}
        </View>
      )}
      
      {expandedSection === 'approved' && (
        <View style={[styles.expandedDetailsCard, { marginHorizontal: 16, marginTop: 20, marginBottom: 20, marginLeft: 16, marginRight: 16 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', fontFamily: 'Nunito' }}>
              Approved Volunteers Details
            </Text>
            <TouchableOpacity onPress={() => setExpandedSection(null)}>
              <MaterialIcons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 12, fontFamily: 'Nunito' }}>
            {approvedVolunteers} approved volunteer{approvedVolunteers !== 1 ? 's' : ''} in the system
          </Text>
          {approvedVolunteers > 0 && (
            <View style={{ gap: 8 }}>
              {volunteers.filter(v => v.registrationStatus !== 'Pending').slice(0, 3).map(vol => (
                <View key={vol.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a', fontFamily: 'Nunito' }}>{vol.name}</Text>
                    <Text style={{ fontSize: 12, color: '#64748b', fontFamily: 'Nunito' }}>
                      {vol.totalHoursContributed.toFixed(1)} hours contributed
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleSelectVolunteer(vol)}
                    style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#475569', borderRadius: 8 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13, fontFamily: 'Nunito' }}>View</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      
      {expandedSection === 'profiles' && (
        <View style={[styles.expandedDetailsCard, { marginHorizontal: 16, marginTop: 20, marginBottom: 20, marginLeft: 16, marginRight: 16 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', fontFamily: 'Nunito' }}>
              All Volunteer Profiles
            </Text>
            <TouchableOpacity onPress={() => setExpandedSection(null)}>
              <MaterialIcons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 12, fontFamily: 'Nunito' }}>
            Total of {volunteers.length} volunteer{volunteers.length !== 1 ? 's' : ''} registered
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                setExpandedSection('applications');
                setStatusFilter('Pending');
              }}
              style={{ flex: 1, padding: 16, backgroundColor: '#f1f5f9', borderRadius: 12 }}
            >
              <Text style={{ fontSize: 24, fontWeight: '800', color: '#0f172a', fontFamily: 'Nunito' }}>{pendingApplications}</Text>
              <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'Nunito' }}>Pending</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                setExpandedSection('approved');
                setStatusFilter('Approved');
              }}
              style={{ flex: 1, padding: 16, backgroundColor: '#f1f5f9', borderRadius: 12 }}
            >
              <Text style={{ fontSize: 24, fontWeight: '800', color: '#0f172a', fontFamily: 'Nunito' }}>{approvedVolunteers}</Text>
              <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'Nunito' }}>Approved</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      
      {expandedSection === 'reports' && (
        <View style={[styles.expandedDetailsCard, { marginHorizontal: 16, marginTop: 20, marginBottom: 20, marginLeft: 16, marginRight: 16 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', fontFamily: 'Nunito' }}>
              Volunteer Reports
            </Text>
            <TouchableOpacity onPress={() => setExpandedSection(null)}>
              <MaterialIcons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 16, fontFamily: 'Nunito' }}>
            Generate and download volunteer activity reports
          </Text>
          <View style={{ gap: 12 }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff7ed', borderRadius: 12, borderWidth: 1, borderColor: '#fed7aa' }}
              onPress={handleDownloadVolunteerHoursReport}
            >
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#e99b34', alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
                <MaterialIcons name="download" size={24} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a', fontFamily: 'Nunito' }}>Volunteer Hours Report</Text>
                <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'Nunito' }}>CSV export of all volunteer hours and activity</Text>
              </View>
              <MaterialIcons name="arrow-forward" size={20} color="#e99b34" />
            </TouchableOpacity>
            
            <View style={{ padding: 16, backgroundColor: '#f1f5f9', borderRadius: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8, fontFamily: 'Nunito' }}>Report Summary</Text>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'Nunito' }}>Total Volunteers:</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a', fontFamily: 'Nunito' }}>{volunteers.length}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'Nunito' }}>Total Hours Logged:</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a', fontFamily: 'Nunito' }}>
                    {volunteers.reduce((sum, v) => sum + v.totalHoursContributed, 0).toFixed(1)}h
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: '#64748b', fontFamily: 'Nunito' }}>Active Time Logs:</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a', fontFamily: 'Nunito' }}>
                    {volunteerTimeLogs.filter(log => !log.timeOut).length}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      )}
      
      {actionNotice ? (
        <View style={styles.noticeBanner}>
          <MaterialIcons name="check-circle" size={18} color="#166534" />
          <Text style={styles.noticeBannerText}>{actionNotice}</Text>
        </View>
      ) : null}
      <View style={styles.listContent}>
        {loadError ? (
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => {
              void loadVolunteers();
              void loadProjects();
              void loadTimeLogs();
            }}
          />
        ) : null}
      </View>
          </>
        }
        ListFooterComponent={<View style={{ height: 40 }} />}
        renderItem={({ item: volunteer }) => (
          <TouchableOpacity
            style={styles.volunteerCard}
            onPress={() => handleSelectVolunteer(volunteer)}
          >
            <View style={styles.volunteerCardAvatar}>
              <Text style={styles.volunteerCardAvatarText}>
                {volunteer.name.charAt(0)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.volunteerCardName}>{volunteer.name}</Text>
              <View style={styles.volunteerCardMeta}>
                <MaterialIcons name="schedule" size={12} color="#666" />
                <Text style={styles.volunteerCardMetaText}>
                  {volunteer.availability.hoursPerWeek}h/week
                </Text>
                <MaterialIcons name="star" size={12} color="#FFA500" />
                <Text style={styles.volunteerCardMetaText}>
                  {volunteer.rating}
                </Text>
              </View>
              {(volunteer.registrationStatus && volunteer.registrationStatus !== 'Approved') ? (
                <View
                  style={[
                    styles.registrationBadge,
                    styles.listRegistrationBadge,
                    volunteer.registrationStatus === 'Pending'
                      ? styles.registrationBadgePending
                      : volunteer.registrationStatus === 'Rejected'
                      ? styles.registrationBadgeRejected
                      : styles.registrationBadgeApproved,
                  ]}
                >
                  <Text style={styles.registrationBadgeText}>
                    {volunteer.registrationStatus === 'Pending' ? '⏳ Application Pending' :
                     volunteer.registrationStatus === 'Rejected' ? '✕ Application Rejected' :
                     volunteer.registrationStatus}
                  </Text>
                </View>
              ) : (
                <Text
                  style={[
                    styles.volunteerCardStatus,
                    volunteer.engagementStatus === 'Busy'
                      ? styles.volunteerCardStatusBusy
                      : styles.volunteerCardStatusOpen,
                  ]}
                >
                  {volunteer.engagementStatus}
                </Text>
              )}
            </View>
            <MaterialIcons name="arrow-forward" size={20} color="#999" />
          </TouchableOpacity>
        )}
        scrollEnabled={true}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  managementSubtitle: { marginHorizontal: 16, marginBottom: 24, fontSize: 16, color: '#64748b', fontFamily: 'Nunito' },
  managementStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginHorizontal: 16, marginBottom: 28 },
  managementStat: { flex: 1, minWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 18, padding: 24, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#edf0f4' },
  managementStatIcon: { width: 68, height: 68, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  managementStatValue: { fontSize: 29, fontWeight: '800', color: '#111827', fontFamily: 'Nunito' },
  managementStatLabel: { fontSize: 16, color: '#334155', marginTop: 2, fontFamily: 'Nunito' },
  managementStatNote: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: '#f4f7fb', fontWeight: '700', fontFamily: 'Nunito' },
  managementPanel: { marginHorizontal: 16, padding: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#edf0f4', borderRadius: 18 },
  managementPanelTitle: { fontSize: 18, fontWeight: '800', color: '#172033', marginBottom: 20, fontFamily: 'Nunito' },
  managementActions: { flexDirection: 'row', gap: 24, flexWrap: 'wrap' },
  managementAction: { flex: 1, minWidth: 260, alignItems: 'center', padding: 28, borderWidth: 1, borderRadius: 15, backgroundColor: '#fff' },
  managementActionIcon: { width: 118, height: 118, borderRadius: 59, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  managementActionTitle: { fontSize: 19, fontWeight: '800', color: '#172033', textAlign: 'center', fontFamily: 'Nunito' },
  managementActionBody: { marginTop: 9, fontSize: 15, lineHeight: 22, color: '#475569', textAlign: 'center', maxWidth: 240, fontFamily: 'Nunito' },
  managementActionNote: { marginTop: 16, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f4f7fb', fontWeight: '700', fontFamily: 'Nunito' },
  managementActionButton: { alignSelf: 'stretch', marginTop: 20, paddingVertical: 12, borderWidth: 1, borderRadius: 8, alignItems: 'center' },
  managementActionButtonText: { fontSize: 15, fontWeight: '800', fontFamily: 'Nunito' },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    fontFamily: 'Nunito',
  },
  titleRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 12,
  },
  reportButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  reportButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Nunito',
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#dcfce7',
  },
  noticeBannerText: {
    flex: 1,
    color: '#14532d',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Nunito',
  },
  registrationSummaryCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  registrationSummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9a3412',
    fontFamily: 'Nunito',
  },
  registrationSummaryText: {
    marginTop: 4,
    fontSize: 12,
    color: '#7c2d12',
    lineHeight: 18,
    fontFamily: 'Nunito',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    margin: 6,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
    fontFamily: 'Nunito',
  },
  volunteerName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
    fontFamily: 'Nunito',
  },
  volunteerEmail: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  statusOpen: {
    backgroundColor: '#dcfce7',
  },
  statusBusy: {
    backgroundColor: '#fee2e2',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1f2937',
    fontFamily: 'Nunito',
  },
  registrationBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  registrationBadgePending: {
    backgroundColor: '#fef3c7',
  },
  registrationBadgeApproved: {
    backgroundColor: '#dcfce7',
  },
  registrationBadgeRejected: {
    backgroundColor: '#fee2e2',
  },
  registrationBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1f2937',
    fontFamily: 'Nunito',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  stat: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 6,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  statLabel: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    margin: 6,
    marginBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
    fontFamily: 'Nunito',
  },
  sectionSummary: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    fontFamily: 'Nunito',
  },
  editButton: {
    padding: 8,
  },
  reviewActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  reviewActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    paddingVertical: 10,
  },
  reviewApproveButton: {
    backgroundColor: '#16a34a',
  },
  reviewRejectButton: {
    backgroundColor: '#dc2626',
  },
  reviewActionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Nunito',
  },
  availabilityInfo: {
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'Nunito',
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    fontFamily: 'Nunito',
  },
  availableDaysLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    marginTop: 6,
    fontFamily: 'Nunito',
  },
  daysContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayBadge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  dayBadgeText: {
    color: '#1976d2',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Nunito',
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  skillTag: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  skillTagText: {
    fontSize: 11,
    color: '#333',
    fontWeight: '500',
    fontFamily: 'Nunito',
  },
  timeLogCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timeLogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  timeLogStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  timeLogStatusActive: {
    backgroundColor: '#fef3c7',
  },
  timeLogStatusCompleted: {
    backgroundColor: '#dcfce7',
  },
  timeLogStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1f2937',
    fontFamily: 'Nunito',
  },
  timeLogMeta: {
    fontSize: 11,
    color: '#334155',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  timeLogNote: {
    fontSize: 11,
    color: '#475569',
    marginTop: 4,
    fontStyle: 'italic',
    fontFamily: 'Nunito',
  },
  timeLogProofText: {
    fontSize: 11,
    color: '#334155',
    marginTop: 4,
    lineHeight: 16,
    fontFamily: 'Nunito',
  },
  projectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    fontFamily: 'Nunito',
  },
  projectCategory: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  pendingRequestBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pendingRequestBadgeText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Nunito',
  },
  matchRecordCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  matchRecordHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  matchRecordStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  matchRecordStatusMatched: {
    backgroundColor: '#dcfce7',
  },
  matchRecordStatusRequested: {
    backgroundColor: '#fef3c7',
  },
  matchRecordStatusCompleted: {
    backgroundColor: '#dbeafe',
  },
  matchRecordStatusInactive: {
    backgroundColor: '#e5e7eb',
  },
  matchRecordStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1f2937',
    fontFamily: 'Nunito',
  },
  matchRecordMeta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 6,
    fontFamily: 'Nunito',
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
    fontFamily: 'Nunito',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  matchCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchContent: {
    flex: 1,
  },
  matchDetails: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
    fontFamily: 'Nunito',
  },
  matchButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  volunteerCardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCardAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
    fontFamily: 'Nunito',
  },
  volunteerCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    fontFamily: 'Nunito',
  },
  volunteerCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  volunteerCardMetaText: {
    fontSize: 11,
    color: '#666',
    marginRight: 8,
    fontFamily: 'Nunito',
  },
  volunteerCardStatus: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'Nunito',
  },
  listRegistrationBadge: {
    marginTop: 6,
  },
  inlineReviewActions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  inlineReviewButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  inlineReviewButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'Nunito',
  },
  volunteerCardStatusOpen: {
    color: '#15803d',
  },
  volunteerCardStatusBusy: {
    color: '#b91c1c',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    fontFamily: 'Nunito',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    fontFamily: 'Nunito',
  },
  labelRight: {
    marginBottom: 0,
    minWidth: 140,
    textAlign: 'right',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#14532d',
    fontFamily: 'Nunito',
  },
  labelTop: {
    marginTop: 4,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  formRowTop: {
    alignItems: 'flex-start',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
    color: '#333',
    marginBottom: 20,
    fontFamily: 'Nunito',
  },
  inputWithLabel: {
    flex: 1,
    marginBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 0,
  },
  daysGridCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  dayButton: {
    flex: 0.3,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  dayButtonSelected: {
    backgroundColor: '#4CAF50',
  },
  dayButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    fontFamily: 'Nunito',
  },
  dayButtonTextSelected: {
    color: '#fff',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'Nunito',
  },
  applicationCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  applicationCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  applicationCardDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginTop: 16,
    marginBottom: 14,
  },
  applicationCardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  applicationCardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 220,
  },
  applicationAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  applicationAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#8b5cf6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationAvatarText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'Nunito',
  },
  applicationName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    fontFamily: 'Nunito',
  },
  applicationEmail: {
    fontSize: 13,
    color: '#475569',
    marginTop: 3,
    fontFamily: 'Nunito',
  },
  applicationPhone: {
    fontSize: 13,
    color: '#475569',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  applicationActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  applicationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 10,
  },
  applicationGridColumn: {
    flex: 1,
    minWidth: 280,
    gap: 10,
  },
  applicationPanel: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  applicationPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  applicationPanelTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
    fontFamily: 'Nunito',
  },
  applicationStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  applicationStatCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationStatValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
    marginTop: 8,
    fontFamily: 'Nunito',
  },
  applicationStatLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
    fontFamily: 'Nunito',
  },
  applicationAvailableEmpty: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 6,
    fontFamily: 'Nunito',
  },
  applicationAvailableItem: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
    fontFamily: 'Nunito',
  },
  applicationOverviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  applicationOverviewLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    fontFamily: 'Nunito',
  },
  applicationOverviewValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    fontFamily: 'Nunito',
  },
  applicationSection: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  applicationSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    fontFamily: 'Nunito',
  },
  applicationInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  applicationInfoItem: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  applicationInfoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Nunito',
  },
  applicationInfoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 4,
    fontFamily: 'Nunito',
  },
  applicationPillarsRow: {
    marginTop: 14,
    gap: 8,
  },
  applicationPillarsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  applicationPillarTag: {
    backgroundColor: '#ede9fe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  applicationPillarTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6d28d9',
    fontFamily: 'Nunito',
  },
  applicationFieldList: {
    gap: 10,
  },
  applicationFieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  applicationFieldBlock: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  applicationFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    minWidth: 140,
    fontFamily: 'Nunito',
  },
  applicationFieldValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
    textAlign: 'right',
    fontFamily: 'Nunito',
  },
  applicationFieldBlockValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1e293b',
    lineHeight: 19,
    marginTop: 6,
    fontFamily: 'Nunito',
  },
  applicationEmptyValue: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#94a3b8',
    paddingVertical: 10,
    textAlign: 'center',
    fontFamily: 'Nunito',
  },
  applicationSkillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  applicationSkillTag: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  applicationSkillTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369a1',
    fontFamily: 'Nunito',
  },
  applicationAffiliationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  applicationAffiliationOrg: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    fontFamily: 'Nunito',
  },
  applicationAffiliationPos: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  expandedDetailsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
});
