import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteUser,
  getAllPartners,
  getAllUsers,
  getAllVolunteers,
  reviewPartnerRegistration,
  reviewVolunteerRegistration,
  saveUser,
  subscribeToStorageChanges,
  verifyPartnerRegistration,
} from '../models/storage';
import { NVCSector, Partner, User, UserRole, UserType, Volunteer } from '../models/types';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const roleOptions: UserRole[] = ['admin', 'partner', 'volunteer'];
const NEW_ACCOUNT_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;

// Lets admins review, edit, and remove application user accounts.
export default function UserManagementScreen() {
  const { user, isAdmin } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState<UserRole>('volunteer');
  const [userTypeDraft, setUserTypeDraft] = useState<UserType>('Adult');
  const [pillarsDraft, setPillarsDraft] = useState<NVCSector[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<
    | { type: 'partner'; record: Partner }
    | { type: 'volunteer'; record: Volunteer }
    | null
  >(null);

  // Loads and sorts all user accounts for the admin management table.
  const loadUsers = useCallback(async () => {
    try {
      const [allUsers, allPartners, allVolunteers] = await Promise.all([
        getAllUsers(),
        getAllPartners(),
        getAllVolunteers(),
      ]);
      const sortedUsers = [...allUsers].sort((a, b) => {
        const createdAtDiff =
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (!Number.isNaN(createdAtDiff) && createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return a.name.localeCompare(b.name);
      });
      setUsers(sortedUsers);
      setPartners(allPartners);
      setVolunteers(allVolunteers);
      setLastSyncedAt(new Date().toISOString());
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load users.'),
      });
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (!isAdmin) {
        return undefined;
      }

      void loadUsers();
      return subscribeToStorageChanges(['users', 'partners', 'volunteers'], () => {
        void loadUsers();
      });
    }, [isAdmin, loadUsers])
  );

  const getVolunteerRegistrationStatus = (volunteer: Volunteer) =>
    volunteer.registrationStatus || 'Approved';

  // Flags recently created accounts so they can be visually highlighted.
  const isNewAccount = (createdAt: string) => {
    const createdTime = new Date(createdAt).getTime();
    if (Number.isNaN(createdTime)) {
      return false;
    }
    return Date.now() - createdTime <= NEW_ACCOUNT_WINDOW_MS;
  };

  // Opens the edit modal with the selected user's current values.
  const openEditModal = (targetUser: User) => {
    setSelectedUser(targetUser);
    setNameDraft(targetUser.name);
    setEmailDraft(targetUser.email || '');
    setPhoneDraft(targetUser.phone || '');
    setPasswordDraft(targetUser.password);
    setRoleDraft(targetUser.role);
    setUserTypeDraft(targetUser.userType || 'Adult');
    setPillarsDraft(targetUser.pillarsOfInterest || []);
    setShowEditModal(true);
  };

  // Closes the user editor and clears the current selection.
  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedUser(null);
  };

  // Saves changes made to the selected user account.
  const handleSaveUser = async () => {
    if (!selectedUser) return;
    if (!nameDraft.trim() || !emailDraft.trim() || !passwordDraft.trim()) {
      Alert.alert('Validation Error', 'Name, email, and password are required.');
      return;
    }

    try {
      await saveUser({
        ...selectedUser,
        name: nameDraft.trim(),
        email: emailDraft.trim().toLowerCase(),
        phone: phoneDraft.trim() || undefined,
        password: passwordDraft.trim(),
        role: roleDraft,
        userType: userTypeDraft,
        pillarsOfInterest: pillarsDraft,
      });
      closeEditModal();
      await loadUsers();
      Alert.alert('Saved', 'User updated.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update user.')
      );
    }
  };

  // Confirms and deletes a user account that is not the active admin session.
  const handleDeleteUser = (targetUser: User) => {
    if (targetUser.id === user?.id) {
      Alert.alert('Restricted', 'You cannot delete the currently signed-in admin account.');
      return;
    }

    Alert.alert(
      'Delete User',
      `Delete ${targetUser.name}? This removes local user data for now.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteUser(targetUser.id);
              await loadUsers();
              Alert.alert('Deleted', 'User removed.');
            } catch (error) {
              Alert.alert(
                getRequestErrorTitle(error),
                getRequestErrorMessage(error, 'Failed to delete user.')
              );
            }
          },
        },
      ]
    );
  };

  const handleVerifyPartner = async (partnerId: string) => {
    if (!user?.id) {
      return;
    }

    try {
      const partner = await verifyPartnerRegistration(partnerId, user.id);
      setReviewTarget(current =>
        current?.type === 'partner' && current.record.id === partner.id
          ? { type: 'partner', record: partner }
          : current
      );
      Alert.alert('Verified', `${partner.name} was marked as DSWD-verified.`);
      await loadUsers();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to verify partner application.')
      );
    }
  };

  const handleReviewPartner = async (partnerId: string, status: 'Approved' | 'Rejected') => {
    if (!user?.id) {
      return;
    }

    try {
      const partner = await reviewPartnerRegistration(partnerId, status, user.id);
      setReviewTarget(null);
      Alert.alert(
        status === 'Approved' ? 'Partner Approved' : 'Partner Rejected',
        status === 'Approved'
          ? `${partner.name} can now log in to the partner portal.`
          : `${partner.name} was rejected.`
      );
      await loadUsers();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review partner application.')
      );
    }
  };

  const handleReviewVolunteer = async (
    volunteerId: string,
    status: 'Approved' | 'Rejected'
  ) => {
    if (!user?.id) {
      return;
    }

    try {
      const volunteer = await reviewVolunteerRegistration(volunteerId, status, user.id);
      setReviewTarget(null);
      Alert.alert(
        status === 'Approved' ? 'Volunteer Approved' : 'Volunteer Rejected',
        status === 'Approved'
          ? `${volunteer.name} can now log in to the volunteer account.`
          : `${volunteer.name} was rejected.`
      );
      await loadUsers();
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to review volunteer account.')
      );
    }
  };

  const openPartnerReview = (partner: Partner) => {
    setReviewTarget({ type: 'partner', record: partner });
  };

  const openVolunteerReview = (volunteer: Volunteer) => {
    setReviewTarget({ type: 'volunteer', record: volunteer });
  };

  const closeReviewModal = () => {
    setReviewTarget(null);
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>User Management</Text>
        <View style={styles.emptyState}>
          <MaterialIcons name="lock" size={48} color="#cbd5e1" />
          <Text style={styles.emptyText}>Only admins can manage users.</Text>
        </View>
      </View>
    );
  }

  const totalAdmins = users.filter(item => item.role === 'admin').length;
  const totalPartners = users.filter(item => item.role === 'partner').length;
  const totalVolunteers = users.filter(item => item.role === 'volunteer').length;
  const pendingPartnerRequests = partners
    .filter(partner => partner.status === 'Pending')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const rejectedPartnerRequests = partners
    .filter(partner => partner.status === 'Rejected')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const pendingVolunteerRequests = volunteers
    .filter(volunteer => getVolunteerRegistrationStatus(volunteer) === 'Pending')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return (
    <View style={styles.container}>
      <Text style={styles.title}>User Management</Text>

      <View style={styles.toolbar}>
        <Text style={styles.syncText}>
          {lastSyncedAt
            ? `Last synced ${format(new Date(lastSyncedAt), 'MMM dd, yyyy hh:mm a')}`
            : loadError
            ? 'Unable to sync users right now.'
            : 'Syncing users...'}
        </Text>
        <TouchableOpacity style={styles.refreshButton} onPress={() => void loadUsers()}>
          <MaterialIcons name="refresh" size={16} color="#166534" />
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loadError ? (
        <View style={styles.bannerWrap}>
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => void loadUsers()}
          />
        </View>
      ) : null}

      {!loadError || users.length > 0 ? (
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{users.length}</Text>
          <Text style={styles.summaryLabel}>Users</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{totalAdmins}</Text>
          <Text style={styles.summaryLabel}>Admins</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{totalPartners}</Text>
          <Text style={styles.summaryLabel}>Partners</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{totalVolunteers}</Text>
          <Text style={styles.summaryLabel}>Volunteers</Text>
        </View>
      </View>
      ) : null}

      <FlatList
        data={users}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.requestSection}>
              <Text style={styles.requestSectionTitle}>Partner Onboarding Requests</Text>
              <Text style={styles.requestSectionSubtitle}>
                Pending partner applications that need verification and admin approval.
              </Text>
              {pendingPartnerRequests.length === 0 ? (
                <Text style={styles.requestEmptyText}>No pending partner onboarding requests.</Text>
              ) : (
                pendingPartnerRequests.map(partner => (
                  <View key={partner.id} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.requestName}>{partner.name}</Text>
                        <Text style={styles.requestMeta}>
                          {partner.sectorType} • DSWD {partner.dswdAccreditationNo || 'Pending'}
                        </Text>
                        <Text style={styles.requestMeta}>
                          {partner.contactEmail || partner.contactPhone || 'No contact details'}
                        </Text>
                        <Text style={styles.requestMeta}>
                          Submitted {format(new Date(partner.createdAt), 'MMM dd, yyyy hh:mm a')}
                        </Text>
                      </View>
                      <View style={[styles.requestBadge, styles.requestBadgePending]}>
                        <Text style={styles.requestBadgeText}>Pending</Text>
                      </View>
                    </View>
                    <View style={styles.requestActionRow}>
                      <TouchableOpacity
                        style={[styles.requestActionButton, styles.reviewActionButton]}
                        onPress={() => openPartnerReview(partner)}
                      >
                        <Text style={styles.requestActionButtonText}>View Application</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.requestSection}>
              <Text style={styles.requestSectionTitle}>Volunteer Onboarding Requests</Text>
              <Text style={styles.requestSectionSubtitle}>
                Pending volunteer accounts that need admin approval before login.
              </Text>
              {pendingVolunteerRequests.length === 0 ? (
                <Text style={styles.requestEmptyText}>No pending volunteer onboarding requests.</Text>
              ) : (
                pendingVolunteerRequests.map(volunteer => (
                  <View key={volunteer.id} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.requestName}>{volunteer.name}</Text>
                        <Text style={styles.requestMeta}>{volunteer.email || 'No email on file'}</Text>
                        <Text style={styles.requestMeta}>{volunteer.phone || 'No phone number on file'}</Text>
                        <Text style={styles.requestMeta}>
                          Submitted {format(new Date(volunteer.createdAt), 'MMM dd, yyyy hh:mm a')}
                        </Text>
                      </View>
                      <View style={[styles.requestBadge, styles.requestBadgePending]}>
                        <Text style={styles.requestBadgeText}>Pending</Text>
                      </View>
                    </View>
                    <View style={styles.requestActionRow}>
                      <TouchableOpacity
                        style={[styles.requestActionButton, styles.reviewActionButton]}
                        onPress={() => openVolunteerReview(volunteer)}
                      >
                        <Text style={styles.requestActionButtonText}>View Membership Form</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.requestSection}>
              <Text style={styles.requestSectionTitle}>Rejected Partner Requests</Text>
              <Text style={styles.requestSectionSubtitle}>
                Rejected partner applications stay here so admins can still approve them later.
              </Text>
              {rejectedPartnerRequests.length === 0 ? (
                <Text style={styles.requestEmptyText}>No rejected partner requests.</Text>
              ) : (
                rejectedPartnerRequests.map(partner => (
                  <View key={partner.id} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.requestName}>{partner.name}</Text>
                        <Text style={styles.requestMeta}>
                          {partner.sectorType} • DSWD {partner.dswdAccreditationNo || 'Pending'}
                        </Text>
                        <Text style={styles.requestMeta}>
                          {partner.contactEmail || partner.contactPhone || 'No contact details'}
                        </Text>
                        <Text style={styles.requestMeta}>
                          Submitted {format(new Date(partner.createdAt), 'MMM dd, yyyy hh:mm a')}
                        </Text>
                        {partner.validatedAt ? (
                          <Text style={styles.requestMeta}>
                            Last reviewed {format(new Date(partner.validatedAt), 'MMM dd, yyyy hh:mm a')}
                          </Text>
                        ) : null}
                      </View>
                      <View style={[styles.requestBadge, styles.requestBadgeRejected]}>
                        <Text style={[styles.requestBadgeText, styles.requestBadgeTextRejected]}>Rejected</Text>
                      </View>
                    </View>
                    <View style={styles.requestActionRow}>
                      <TouchableOpacity
                        style={[styles.requestActionButton, styles.reviewActionButton]}
                        onPress={() => openPartnerReview(partner)}
                      >
                        <Text style={styles.requestActionButtonText}>Review Decision</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        }
        renderItem={({ item }) => {
          const linkedPartners = partners.filter(partner => {
            if (partner.ownerUserId) {
              return partner.ownerUserId === item.id;
            }

            return (
              (partner.contactEmail || '').trim().toLowerCase() === (item.email || '').trim().toLowerCase() ||
              (partner.contactPhone || '').trim() === (item.phone || '').trim()
            );
          });
          const linkedVolunteer =
            volunteers.find(volunteer => {
              if (volunteer.userId) {
                return volunteer.userId === item.id;
              }

              return (
                (volunteer.email || '').trim().toLowerCase() === (item.email || '').trim().toLowerCase() ||
                (volunteer.phone || '').trim() === (item.phone || '').trim()
              );
            }) || null;

          return (
            <View style={styles.userCard}>
              <View style={styles.userHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.userInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.userName}>{item.name}</Text>
                    {isNewAccount(item.createdAt) && (
                      <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>New</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.userMeta}>{item.email}</Text>
                  <Text style={styles.userMeta}>{item.phone || 'No phone number'}</Text>
                  <Text style={styles.userMeta}>{item.userType || 'No profile type'}</Text>
                  <Text style={styles.userMeta}>
                    Created {format(new Date(item.createdAt), 'MMM dd, yyyy hh:mm a')}
                  </Text>
                  <Text style={styles.userMeta}>
                    {(item.pillarsOfInterest || []).length > 0
                      ? item.pillarsOfInterest?.join(', ')
                      : 'No pillar preferences'}
                  </Text>
                  {item.role === 'partner' ? (
                    linkedPartners.length > 0 ? (
                      linkedPartners.map(partner => (
                        <View key={partner.id} style={styles.linkedRecordBox}>
                          <Text style={styles.linkedRecordTitle}>{partner.name}</Text>
                          <Text style={styles.linkedRecordMeta}>
                            {partner.status} • {partner.sectorType} • DSWD {partner.dswdAccreditationNo || 'Not provided'}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <View style={styles.linkedRecordBox}>
                        <Text style={styles.linkedRecordMeta}>No linked partner organization record yet.</Text>
                      </View>
                    )
                  ) : null}
                </View>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{item.role}</Text>
                </View>
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.editButton} onPress={() => openEditModal(item)}>
                  <MaterialIcons name="edit" size={16} color="#166534" />
                  <Text style={styles.editButtonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteUser(item)}>
                  <MaterialIcons name="delete-outline" size={16} color="#b91c1c" />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={showEditModal} animationType="slide" onRequestClose={closeEditModal}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeEditModal}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit User</Text>
            <TouchableOpacity onPress={handleSaveUser}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <TextInput
              style={styles.input}
              placeholder="Full name"
              value={nameDraft}
              onChangeText={setNameDraft}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailDraft}
              onChangeText={setEmailDraft}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone"
              keyboardType="phone-pad"
              value={phoneDraft}
              onChangeText={setPhoneDraft}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              value={passwordDraft}
              onChangeText={setPasswordDraft}
            />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleOptions}>
              {roleOptions.map(role => (
                <TouchableOpacity
                  key={role}
                  style={[styles.roleOption, roleDraft === role && styles.roleOptionActive]}
                  onPress={() => setRoleDraft(role)}
                >
                  <Text style={[styles.roleOptionText, roleDraft === role && styles.roleOptionTextActive]}>
                    {role}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Profile Type</Text>
            <View style={styles.roleOptions}>
              {(['Student', 'Adult', 'Senior'] as const).map(userType => (
                <TouchableOpacity
                  key={userType}
                  style={[styles.roleOption, userTypeDraft === userType && styles.roleOptionActive]}
                  onPress={() => setUserTypeDraft(userType)}
                >
                  <Text style={[styles.roleOptionText, userTypeDraft === userType && styles.roleOptionTextActive]}>
                    {userType}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Pillars of Interest</Text>
            <View style={styles.roleOptions}>
              {(['Nutrition', 'Education', 'Livelihood'] as const).map(pillar => (
                <TouchableOpacity
                  key={pillar}
                  style={[styles.roleOption, pillarsDraft.includes(pillar) && styles.roleOptionActive]}
                  onPress={() =>
                    setPillarsDraft(current =>
                      current.includes(pillar)
                        ? current.filter(item => item !== pillar)
                        : [...current, pillar]
                    )
                  }
                >
                  <Text style={[styles.roleOptionText, pillarsDraft.includes(pillar) && styles.roleOptionTextActive]}>
                    {pillar}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(reviewTarget)} animationType="slide" onRequestClose={closeReviewModal}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeReviewModal}>
              <Text style={styles.modalCancel}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {reviewTarget?.type === 'partner' ? 'Partner Application' : 'Volunteer Form'}
            </Text>
            <View style={styles.modalHeaderSpacer} />
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={styles.reviewContent}>
            {reviewTarget?.type === 'partner' ? (
              <>
                <Text style={styles.reviewSectionTitle}>Organization Details</Text>
                <Text style={styles.reviewRowLabel}>Organization Name</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.name}</Text>
                <Text style={styles.reviewRowLabel}>Sector Type</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.sectorType}</Text>
                <Text style={styles.reviewRowLabel}>DSWD Accreditation No.</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.dswdAccreditationNo || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>SEC Registration No.</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.secRegistrationNo || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Advocacy Focus</Text>
                <Text style={styles.reviewRowValue}>
                  {reviewTarget.record.advocacyFocus.length > 0
                    ? reviewTarget.record.advocacyFocus.join(', ')
                    : 'Not provided'}
                </Text>
                <Text style={styles.reviewRowLabel}>Description</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.description || 'Not provided'}</Text>

                <Text style={styles.reviewSectionTitle}>Contact Information</Text>
                <Text style={styles.reviewRowLabel}>Email</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.contactEmail || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Phone</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.contactPhone || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Address</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.address || 'Not provided'}</Text>

                <Text style={styles.reviewSectionTitle}>Verification</Text>
                <Text style={styles.reviewRowLabel}>Status</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.status}</Text>
                <Text style={styles.reviewRowLabel}>Verification Status</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.verificationStatus || 'Pending'}</Text>
                <Text style={styles.reviewRowLabel}>Verification Notes</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.verificationNotes || 'No verification notes yet.'}</Text>
                <Text style={styles.reviewRowLabel}>Registration Documents</Text>
                <Text style={styles.reviewRowValue}>
                  {reviewTarget.record.registrationDocuments?.length
                    ? reviewTarget.record.registrationDocuments.join('\n')
                    : 'No uploaded registration documents.'}
                </Text>
              </>
            ) : reviewTarget?.type === 'volunteer' ? (
              <>
                <Text style={styles.reviewSectionTitle}>Personal Information</Text>
                <Text style={styles.reviewRowLabel}>Full Name</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.name}</Text>
                <Text style={styles.reviewRowLabel}>Email</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.email || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Phone</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.phone || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Gender</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.gender || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Date of Birth</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.dateOfBirth || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Civil Status</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.civilStatus || 'Not provided'}</Text>

                <Text style={styles.reviewSectionTitle}>Home Address</Text>
                <Text style={styles.reviewRowLabel}>Full Address</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.homeAddress || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Region</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.homeAddressRegion || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>City / Municipality</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.homeAddressCityMunicipality || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Barangay</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.homeAddressBarangay || 'Not provided'}</Text>

                <Text style={styles.reviewSectionTitle}>Professional Information</Text>
                <Text style={styles.reviewRowLabel}>Occupation</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.occupation || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Workplace or School</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.workplaceOrSchool || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>College Course</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.collegeCourse || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Certifications or Trainings</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.certificationsOrTrainings || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Hobbies and Interests</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.hobbiesAndInterests || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Special Skills</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.specialSkills || 'Not provided'}</Text>
                <Text style={styles.reviewRowLabel}>Video Briefing URL</Text>
                <Text style={styles.reviewRowValue}>{reviewTarget.record.videoBriefingUrl || 'Not provided'}</Text>

                <Text style={styles.reviewSectionTitle}>Affiliations</Text>
                <Text style={styles.reviewRowValue}>
                  {reviewTarget.record.affiliations && reviewTarget.record.affiliations.length > 0
                    ? reviewTarget.record.affiliations
                        .map(affiliation => `${affiliation.organization || 'Organization not provided'} - ${affiliation.position || 'Position not provided'}`)
                        .join('\n')
                    : 'No affiliations provided.'}
                </Text>
              </>
            ) : null}
          </ScrollView>

          {reviewTarget ? (
            <View style={styles.reviewActionFooter}>
              {reviewTarget.type === 'partner' ? (
                <>
                  {reviewTarget.record.verificationStatus !== 'Verified' ? (
                    <TouchableOpacity
                      style={[styles.requestActionButton, styles.verifyActionButton]}
                      onPress={() => handleVerifyPartner(reviewTarget.record.id)}
                    >
                      <Text style={styles.requestActionButtonText}>Verify</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.requestActionButton, styles.approveActionButton]}
                    onPress={() => handleReviewPartner(reviewTarget.record.id, 'Approved')}
                  >
                    <Text style={styles.requestActionButtonText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.requestActionButton, styles.rejectActionButton]}
                    onPress={() => handleReviewPartner(reviewTarget.record.id, 'Rejected')}
                  >
                    <Text style={styles.requestActionButtonText}>Reject</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.requestActionButton, styles.approveActionButton]}
                    onPress={() => handleReviewVolunteer(reviewTarget.record.id, 'Approved')}
                  >
                    <Text style={styles.requestActionButtonText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.requestActionButton, styles.rejectActionButton]}
                    onPress={() => handleReviewVolunteer(reviewTarget.record.id, 'Rejected')}
                  >
                    <Text style={styles.requestActionButtonText}>Reject</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null}
        </View>
      </Modal>
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
  toolbar: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  syncText: {
    flex: 1,
    fontSize: 12,
    color: '#64748b',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 16,
  },
  summaryCard: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#166534',
  },
  summaryLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  newBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
    textTransform: 'uppercase',
  },
  userMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    lineHeight: 18,
  },
  linkedRecordBox: {
    marginTop: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  linkedRecordTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  linkedRecordMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  roleBadge: {
    backgroundColor: '#ecfdf5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    textTransform: 'uppercase',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dcfce7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  editButtonText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deleteButtonText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalCancel: {
    color: '#64748b',
    fontSize: 15,
  },
  modalSave: {
    color: '#15803d',
    fontSize: 15,
    fontWeight: '700',
  },
  modalBody: {
    padding: 16,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  roleOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  roleOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  roleOptionActive: {
    backgroundColor: '#166534',
  },
  roleOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'capitalize',
  },
  roleOptionTextActive: {
    color: '#fff',
  },
  requestSection: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  requestSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  requestSectionSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 16,
  },
  requestEmptyText: {
    fontSize: 14,
    color: '#64748b',
    fontStyle: 'italic',
  },
  requestCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  requestName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  requestMeta: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  requestBadge: {
    marginLeft: 'auto',
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  requestBadgePending: {
    backgroundColor: '#fef3c7',
  },
  requestBadgeRejected: {
    backgroundColor: '#fee2e2',
  },
  requestBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
    textTransform: 'uppercase',
  },
  requestBadgeTextRejected: {
    color: '#b91c1c',
  },
  requestActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  requestActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  verifyActionButton: {
    backgroundColor: '#dbeafe',
  },
  approveActionButton: {
    backgroundColor: '#dcfce7',
  },
  rejectActionButton: {
    backgroundColor: '#fee2e2',
  },
  reviewActionButton: {
    backgroundColor: '#e0f2fe',
  },
  requestActionButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalHeaderSpacer: {
    width: 48,
  },
  reviewContent: {
    paddingBottom: 24,
  },
  reviewSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 8,
    marginBottom: 10,
  },
  reviewRowLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginTop: 8,
  },
  reviewRowValue: {
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 20,
    marginTop: 4,
  },
  reviewActionFooter: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
});
