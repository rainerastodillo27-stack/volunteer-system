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
  Image,
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
  saveUser,
  savePartner,
  saveVolunteer,
  setCurrentUser,
  subscribeToStorageChanges,
  getPendingUserApprovals,
  approveUser,
  rejectUser,
} from '../models/storage';
import { NVCSector, Partner, User, UserRole, UserType, Volunteer } from '../models/types';
import { isImageMediaUri } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const roleOptions: UserRole[] = ['admin', 'partner', 'volunteer'];
const NEW_ACCOUNT_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;

// Lets admins review, edit, and remove application user accounts.
export default function UserManagementScreen() {
  const { user, isAdmin } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [successNotice, setSuccessNotice] = useState<{ title: string; message: string } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [pendingUserApprovals, setPendingUserApprovals] = useState<User[]>([]);
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
  const [expandedUserRoles, setExpandedUserRoles] = useState<Record<UserRole, boolean>>({
    admin: false,
    partner: true,
    volunteer: true,
  });
  const [reviewTarget, setReviewTarget] = useState<
    | { type: 'user'; record: User }
    | null
  >(null);

  // Loads and sorts all user accounts for the admin management table.
  const loadUsers = useCallback(async () => {
    try {
      // Load users and partners quickly; defer volunteers and pending approvals
      const [allUsers, allPartners] = await Promise.all([getAllUsers(), getAllPartners()]);
      let pending: User[] = [];
      setVolunteers([]);
      setPendingUserApprovals([]);
      setTimeout(async () => {
        try {
          const [allVolunteers, pendingApprovals] = await Promise.all([
            getAllVolunteers(),
            getPendingUserApprovals(),
          ]);
          setVolunteers(allVolunteers);
          setPendingUserApprovals(pendingApprovals);
        } catch {}
      }, 50);
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

  React.useEffect(() => {
    if (!successNotice) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setSuccessNotice(null);
    }, 4000);

    return () => clearTimeout(timer);
  }, [successNotice]);

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

    const previousUsers = users;
    const previousPartners = partners;
    const previousVolunteers = volunteers;

    try {
      const updatedUser: User = {
        ...selectedUser,
        name: nameDraft.trim(),
        email: emailDraft.trim().toLowerCase(),
        phone: phoneDraft.trim() || undefined,
        password: passwordDraft.trim(),
        role: roleDraft,
        userType: userTypeDraft,
        pillarsOfInterest: pillarsDraft,
      };
      const linkedPartners = partners.filter(partner => {
        if (partner.ownerUserId) {
          return partner.ownerUserId === selectedUser.id;
        }

        return (
          (partner.contactEmail || '').trim().toLowerCase() === (selectedUser.email || '').trim().toLowerCase() ||
          (partner.contactPhone || '').trim() === (selectedUser.phone || '').trim()
        );
      });

      const linkedVolunteers = volunteers.filter(volunteer => {
        if (volunteer.userId) {
          return volunteer.userId === selectedUser.id;
        }

        return (
          (volunteer.email || '').trim().toLowerCase() === (selectedUser.email || '').trim().toLowerCase() ||
          (volunteer.phone || '').trim() === (selectedUser.phone || '').trim()
        );
      });
      const nextPartners = partners.map(partner =>
        linkedPartners.some(linkedPartner => linkedPartner.id === partner.id)
          ? {
            ...partner,
            ownerUserId: updatedUser.id,
            contactEmail: updatedUser.email,
            contactPhone: updatedUser.phone,
          }
          : partner
      );
      const nextVolunteers = volunteers.map(volunteer =>
        linkedVolunteers.some(linkedVolunteer => linkedVolunteer.id === volunteer.id)
          ? {
            ...volunteer,
            userId: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email || '',
            phone: updatedUser.phone || '',
          }
          : volunteer
      );
      setUsers(currentUsers =>
        currentUsers.map(currentUser => (currentUser.id === updatedUser.id ? updatedUser : currentUser))
      );
      setPartners(nextPartners);
      setVolunteers(nextVolunteers);
      if (reviewTarget?.type === 'user' && reviewTarget.record.id === updatedUser.id) {
        setReviewTarget({ type: 'user', record: updatedUser });
      }
      closeEditModal();
      setSuccessNotice({
        title: 'Changes Saved',
        message: `${updatedUser.name}'s account details were updated successfully.`,
      });

      await saveUser(updatedUser);

      await Promise.all([
        ...linkedPartners.map(partner =>
          savePartner({
            ...partner,
            ownerUserId: updatedUser.id,
            contactEmail: updatedUser.email,
            contactPhone: updatedUser.phone,
          })
        ),
        ...linkedVolunteers.map(volunteer =>
          saveVolunteer({
            ...volunteer,
            userId: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email || '',
            phone: updatedUser.phone || '',
          })
        ),
      ]);
      if (user?.id === updatedUser.id) {
        await setCurrentUser(updatedUser);
      }
      void loadUsers();
    } catch (error) {
      setUsers(previousUsers);
      setPartners(previousPartners);
      setVolunteers(previousVolunteers);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to update user.')
      );
    }
  };

  const performDeleteUser = async (targetUser: User) => {
    const previousUsers = users;
    const previousPendingApprovals = pendingUserApprovals;
    setUsers(currentUsers => currentUsers.filter(currentUser => currentUser.id !== targetUser.id));
    setPendingUserApprovals(currentUsers =>
      currentUsers.filter(currentUser => currentUser.id !== targetUser.id)
    );
    if (reviewTarget?.type === 'user' && reviewTarget.record.id === targetUser.id) {
      closeReviewModal();
    }
    if (selectedUser?.id === targetUser.id) {
      closeEditModal();
    }
    setSuccessNotice({
      title: 'Deletion Complete',
      message: `${targetUser.name}'s account and linked application records were deleted.`,
    });

    try {
      await deleteUser(targetUser.id);
      void loadUsers();
    } catch (error) {
      setUsers(previousUsers);
      setPendingUserApprovals(previousPendingApprovals);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to delete user account.')
      );
    }
  };

  // Confirms and deletes a user account that is not the active admin session.
  const handleDeleteUser = (targetUser: User) => {
    if (targetUser.id === user?.id) {
      Alert.alert('Restricted', 'You cannot delete the currently signed-in admin account.');
      return;
    }

    void performDeleteUser(targetUser);
  };

  const handleApproveUser = async (targetUser: User) => {
    if (!user?.id) {
      return;
    }

    const previousUsers = users;
    const previousPendingApprovals = pendingUserApprovals;
    const now = new Date().toISOString();
    const optimisticApprovedUser: User = {
      ...targetUser,
      approvalStatus: 'approved',
      approvedBy: user.id,
      approvedAt: now,
      rejectionReason: undefined,
    };
    setUsers(currentUsers =>
      currentUsers.map(currentUser =>
        currentUser.id === targetUser.id ? optimisticApprovedUser : currentUser
      )
    );
    setPendingUserApprovals(currentUsers =>
      currentUsers.filter(currentUser => currentUser.id !== targetUser.id)
    );
    if (reviewTarget?.type === 'user' && reviewTarget.record.id === targetUser.id) {
      closeReviewModal();
    }
    setSuccessNotice({
      title: 'Approval Complete',
      message: `${targetUser.name}'s account has been approved and login access is now unlocked.`,
    });

    try {
      const approvedUser = await approveUser(targetUser.id, user.id);
      setUsers(currentUsers =>
        currentUsers.map(currentUser =>
          currentUser.id === targetUser.id ? approvedUser : currentUser
        )
      );
      void loadUsers();
    } catch (error) {
      setUsers(previousUsers);
      setPendingUserApprovals(previousPendingApprovals);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to approve user account.')
      );
    }
  };

  const handleRejectUser = async (targetUser: User) => {
    if (!user?.id) {
      return;
    }

    const previousUsers = users;
    const previousPendingApprovals = pendingUserApprovals;
    setUsers(currentUsers =>
      currentUsers.filter(currentUser => currentUser.id !== targetUser.id)
    );
    setPendingUserApprovals(currentUsers =>
      currentUsers.filter(currentUser => currentUser.id !== targetUser.id)
    );
    if (reviewTarget?.type === 'user' && reviewTarget.record.id === targetUser.id) {
      closeReviewModal();
    }
    setSuccessNotice({
      title: 'Deletion Complete',
      message: `${targetUser.name}'s unapproved account was deleted from the approval queue.`,
    });

    try {
      await rejectUser(targetUser.id, 'Account rejected by administrator.', user.id);
      void loadUsers();
    } catch (error) {
      setUsers(previousUsers);
      setPendingUserApprovals(previousPendingApprovals);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to reject user account.')
      );
    }
  };

  const openUserReview = (targetUser: User) => {
    setReviewTarget({ type: 'user', record: targetUser });
  };

  const closeReviewModal = () => {
    setReviewTarget(null);
  };

  const toggleUserRoleSection = (role: UserRole) => {
    setExpandedUserRoles(current => ({
      ...current,
      [role]: !current[role],
    }));
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

  const adminUsers = users.filter(item => item.role === 'admin');
  const partnerUsers = users.filter(item => item.role === 'partner');
  const volunteerUsers = users.filter(item => item.role === 'volunteer');
  const totalAdmins = adminUsers.length;
  const totalPartners = partnerUsers.length;
  const totalVolunteers = volunteerUsers.length;
  const pendingPartnerApprovals = pendingUserApprovals.filter(item => item.role === 'partner').length;
  const pendingVolunteerApprovals = pendingUserApprovals.filter(item => item.role === 'volunteer').length;
  const getLinkedPartnerForUser = (targetUser: User) =>
    partners.find(partner => {
      if (partner.ownerUserId) {
        return partner.ownerUserId === targetUser.id;
      }

      return (
        (partner.contactEmail || '').trim().toLowerCase() === (targetUser.email || '').trim().toLowerCase() ||
        (partner.contactPhone || '').trim() === (targetUser.phone || '').trim()
      );
    }) || null;
  const getLinkedVolunteerForUser = (targetUser: User) =>
    volunteers.find(volunteer => {
      if (volunteer.userId) {
        return volunteer.userId === targetUser.id;
      }

      return (
        (volunteer.email || '').trim().toLowerCase() === (targetUser.email || '').trim().toLowerCase() ||
        (volunteer.phone || '').trim() === (targetUser.phone || '').trim()
      );
    }) || null;

  const renderPendingApprovalCard = (pendingUser: User) => {
    return (
      <TouchableOpacity
        key={pendingUser.id}
        style={styles.requestTile}
        activeOpacity={0.88}
        onPress={() => openUserReview(pendingUser)}
      >
        <View style={styles.requestTileHeader}>
          <View style={styles.requestTileAvatar}>
            <Text style={styles.requestTileAvatarText}>
              {(pendingUser.name || pendingUser.email || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={[styles.requestBadge, styles.requestRolePill]}>
            <Text style={[styles.requestBadgeText, styles.requestRolePillText]}>
              {pendingUser.role}
            </Text>
          </View>
        </View>
        <Text style={styles.requestTileName} numberOfLines={1}>
          {pendingUser.name || pendingUser.email || 'Unnamed applicant'}
        </Text>
        <Text style={styles.requestTileHint}>Tap to view full application</Text>
      </TouchableOpacity>
    );
  };

  const renderUserCard = (item: User) => {
    const linkedPartners = partners.filter(partner => {
      if (partner.ownerUserId) {
        return partner.ownerUserId === item.id;
      }

      return (
        (partner.contactEmail || '').trim().toLowerCase() === (item.email || '').trim().toLowerCase() ||
        (partner.contactPhone || '').trim() === (item.phone || '').trim()
      );
    });
    const linkedVolunteer = getLinkedVolunteerForUser(item);

    return (
      <View key={item.id} style={styles.userCard}>
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
            {item.role === 'volunteer' && linkedVolunteer ? (
              <View style={styles.linkedRecordBox}>
                <Text style={styles.linkedRecordTitle}>{linkedVolunteer.name}</Text>
                <Text style={styles.linkedRecordMeta}>
                  {linkedVolunteer.registrationStatus || 'Pending'} • {linkedVolunteer.occupation || 'No occupation provided'}
                </Text>
              </View>
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
  };

  const renderReviewField = (
    label: string,
    value: React.ReactNode,
    options?: { wide?: boolean }
  ) => (
    <View style={[styles.reviewField, options?.wide && styles.reviewFieldWide]}>
      <Text style={styles.reviewRowLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.reviewRowValue}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );

  const renderReviewSection = (title: string, children: React.ReactNode) => (
    <View style={styles.reviewSectionCard}>
      <Text style={styles.reviewSectionTitle}>{title}</Text>
      <View style={styles.reviewFieldGrid}>{children}</View>
    </View>
  );

  const userSections: Array<{
    id: string;
    role: UserRole;
    title: string;
    subtitle: string;
    users: User[];
  }> = [
    {
      id: 'section-partners',
      role: 'partner',
      title: 'Partner Accounts',
      subtitle: 'Review, edit, or delete approved partner accounts from this section.',
      users: partnerUsers,
    },
    {
      id: 'section-volunteers',
      role: 'volunteer',
      title: 'Volunteer Accounts',
      subtitle: 'Review, edit, or delete approved volunteer accounts from this section.',
      users: volunteerUsers,
    },
    {
      id: 'section-admins',
      role: 'admin',
      title: 'Admin Accounts',
      subtitle: 'Admin users are shown separately; expand only when you need account actions.',
      users: adminUsers,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderTop}>
          <View style={styles.pageHeaderTextWrap}>
            <Text style={styles.title}>User Management</Text>
            <Text style={styles.pageSubtitle}>
              Review approvals and manage user accounts from one place.
            </Text>
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={() => void loadUsers()}>
            <MaterialIcons name="refresh" size={16} color="#166534" />
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.syncText}>
          {lastSyncedAt
            ? `Last synced ${format(new Date(lastSyncedAt), 'MMM dd, yyyy hh:mm a')}`
            : loadError
            ? 'Unable to sync users right now.'
            : 'Syncing users...'}
        </Text>
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

      {successNotice ? (
        <View style={styles.bannerWrap}>
          <View style={styles.successBanner}>
            <MaterialIcons name="check-circle" size={18} color="#166534" />
            <View style={styles.successBannerTextWrap}>
              <Text style={styles.successBannerTitle}>{successNotice.title}</Text>
              <Text style={styles.successBannerMessage}>{successNotice.message}</Text>
            </View>
          </View>
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
        data={userSections}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.requestSection}>
              <View style={styles.requestQueueHeader}>
                <View style={styles.requestQueueTitleWrap}>
                  <Text style={styles.requestSectionTitle}>User Approval Queue</Text>
                  <Text style={styles.requestSectionSubtitle}>
                    Click a name to open the full application and review the details.
                  </Text>
                </View>
                <View style={styles.requestQueueBadge}>
                  <Text style={styles.requestQueueBadgeText}>{pendingUserApprovals.length} pending</Text>
                </View>
              </View>
              <View style={styles.requestQueueSummaryRow}>
                <View style={styles.requestSummaryCard}>
                  <Text style={styles.requestSummaryValue}>{pendingUserApprovals.length}</Text>
                  <Text style={styles.requestSummaryLabel}>Total requests</Text>
                </View>
                <View style={styles.requestSummaryCard}>
                  <Text style={styles.requestSummaryValue}>{pendingPartnerApprovals}</Text>
                  <Text style={styles.requestSummaryLabel}>Partner applications</Text>
                </View>
                <View style={styles.requestSummaryCard}>
                  <Text style={styles.requestSummaryValue}>{pendingVolunteerApprovals}</Text>
                  <Text style={styles.requestSummaryLabel}>Volunteer applications</Text>
                </View>
              </View>
              {pendingUserApprovals.length === 0 ? (
                <Text style={styles.requestEmptyText}>No users are waiting for approval.</Text>
              ) : (
                <View style={styles.requestTileGrid}>
                  {pendingUserApprovals.map(renderPendingApprovalCard)}
                </View>
              )}
            </View>

          </>
        }
        renderItem={({ item }) => {
          const isExpanded = expandedUserRoles[item.role];

          return (
            <View style={styles.userRoleSection}>
              <TouchableOpacity
                style={styles.userTypeBox}
                onPress={() => toggleUserRoleSection(item.role)}
                activeOpacity={0.85}
              >
                <View style={styles.userTypeBoxHeader}>
                  <View style={styles.userTypeBoxTextWrap}>
                    <Text style={styles.requestSectionTitle}>{item.title}</Text>
                    <Text style={styles.requestSectionSubtitle}>{item.subtitle}</Text>
                  </View>
                  <View style={styles.userTypeBoxMeta}>
                    <View style={styles.userTypeCountBadge}>
                      <Text style={styles.userTypeCountText}>{item.users.length}</Text>
                    </View>
                    <MaterialIcons
                      name={isExpanded ? 'expand-less' : 'expand-more'}
                      size={24}
                      color="#0f172a"
                    />
                  </View>
                </View>
              </TouchableOpacity>

              {isExpanded ? (
                item.users.length > 0 ? (
                  item.users.map(renderUserCard)
                ) : (
                  <View style={styles.userRoleEmptyState}>
                    <Text style={styles.requestEmptyText}>No accounts in this section.</Text>
                  </View>
                )
              ) : null}
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
        <View style={styles.reviewModalContainer}>
          <View style={styles.reviewModalHeader}>
            <TouchableOpacity style={styles.reviewCloseButton} onPress={closeReviewModal}>
              <MaterialIcons name="close" size={18} color="#334155" />
              <Text style={styles.reviewCloseButtonText}>Close</Text>
            </TouchableOpacity>
            <View style={styles.reviewHeaderTitleWrap}>
              <Text style={styles.reviewModalTitle}>User Review</Text>
              <Text style={styles.reviewModalSubtitle}>
                Review the application details and choose whether to approve or reject the request.
              </Text>
            </View>
            <View style={styles.modalHeaderSpacer} />
          </View>

          <ScrollView style={styles.reviewModalBody} contentContainerStyle={styles.reviewContent}>
            {reviewTarget?.type === 'user' ? (
              <View style={styles.reviewPanel}>
                <View style={styles.reviewSummaryCard}>
                  <View style={styles.reviewAvatar}>
                    <Text style={styles.reviewAvatarText}>
                      {(reviewTarget.record.name || reviewTarget.record.email || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.reviewSummaryText}>
                    <Text style={styles.reviewApplicantName}>{reviewTarget.record.name || 'Unnamed applicant'}</Text>
                    <Text style={styles.reviewApplicantMeta}>
                      {reviewTarget.record.email || 'No email'} / {reviewTarget.record.phone || 'No phone'}
                    </Text>
                    <Text style={styles.reviewApplicantSupport}>
                      Submitted {format(new Date(reviewTarget.record.createdAt), 'MMM dd, yyyy hh:mm a')}
                    </Text>
                  </View>
                  <View style={styles.reviewStatusStack}>
                    <View style={styles.reviewRoleBadge}>
                      <Text style={styles.reviewRoleBadgeText}>{reviewTarget.record.role}</Text>
                    </View>
                    <View style={styles.reviewPendingBadge}>
                      <Text style={styles.reviewPendingBadgeText}>{reviewTarget.record.approvalStatus || 'pending'}</Text>
                    </View>
                  </View>
                </View>

                {renderReviewSection(
                  'Account Details',
                  <>
                    {renderReviewField('Full Name', reviewTarget.record.name || 'Not provided')}
                    {renderReviewField('Role', reviewTarget.record.role)}
                    {renderReviewField('Email', reviewTarget.record.email || 'Not provided')}
                    {renderReviewField('Phone', reviewTarget.record.phone || 'Not provided')}
                    {renderReviewField('Profile Type', reviewTarget.record.userType || 'Not provided')}
                    {renderReviewField('Approval Status', reviewTarget.record.approvalStatus || 'pending')}
                    {renderReviewField(
                      'Pillars of Interest',
                      reviewTarget.record.pillarsOfInterest && reviewTarget.record.pillarsOfInterest.length > 0
                        ? reviewTarget.record.pillarsOfInterest.join(', ')
                        : 'No pillar preferences',
                      { wide: true }
                    )}
                    {renderReviewField(
                      'Submitted',
                      format(new Date(reviewTarget.record.createdAt), 'MMM dd, yyyy hh:mm a'),
                      { wide: true }
                    )}
                  </>
                )}

                {reviewTarget.record.role === 'partner'
                  ? (() => {
                      const linkedPartner = getLinkedPartnerForUser(reviewTarget.record);
                      if (!linkedPartner) {
                        return renderReviewSection(
                          'Partner Application',
                          renderReviewField('Application Record', 'No partner application record found.', { wide: true })
                        );
                      }

                      return renderReviewSection(
                        'Partner Application',
                        <>
                          {renderReviewField('Organization Name', linkedPartner.name)}
                          {renderReviewField('Stakeholder Name', linkedPartner.stakeholderName || 'Not provided')}
                          {renderReviewField('Sector Type', linkedPartner.sectorType)}
                          {renderReviewField('DSWD Accreditation No.', linkedPartner.dswdAccreditationNo || 'Not provided')}
                          {renderReviewField(
                            'Advocacy Focus',
                            linkedPartner.advocacyFocus.length > 0 ? linkedPartner.advocacyFocus.join(', ') : 'Not provided'
                          )}
                          {renderReviewField('Verification Status', linkedPartner.verificationStatus || 'Pending')}
                          {renderReviewField('Contact Email', linkedPartner.contactEmail || 'Not provided')}
                          {renderReviewField('Contact Phone', linkedPartner.contactPhone || 'Not provided')}
                          {renderReviewField('Region', linkedPartner.region || 'Not provided')}
                          {renderReviewField('Province', linkedPartner.province || 'Not provided')}
                          {renderReviewField('City / Municipality', linkedPartner.cityMunicipality || 'Not provided')}
                          {renderReviewField('Address', linkedPartner.address || 'Not provided', { wide: true })}
                          {renderReviewField('Description', linkedPartner.description || 'Not provided', { wide: true })}
                        </>
                      );
                    })()
                  : null}

                {reviewTarget.record.role === 'volunteer'
                  ? (() => {
                      const linkedVolunteer = getLinkedVolunteerForUser(reviewTarget.record);
                      if (!linkedVolunteer) {
                        return renderReviewSection(
                          'Volunteer Membership Form',
                          renderReviewField('Application Record', 'No volunteer profile record found.', { wide: true })
                        );
                      }

                      return renderReviewSection(
                        'Volunteer Membership Form',
                        <>
                          {renderReviewField('Gender', linkedVolunteer.gender || 'Not provided')}
                          {renderReviewField('Date of Birth', linkedVolunteer.dateOfBirth || 'Not provided')}
                          {renderReviewField('Civil Status', linkedVolunteer.civilStatus || 'Not provided')}
                          {renderReviewField('Registration Status', linkedVolunteer.registrationStatus || 'Pending')}
                          {renderReviewField('Home Address', linkedVolunteer.homeAddress || 'Not provided', { wide: true })}
                          {renderReviewField('Region', linkedVolunteer.homeAddressRegion || 'Not provided')}
                          {renderReviewField('City / Municipality', linkedVolunteer.homeAddressCityMunicipality || 'Not provided')}
                          {renderReviewField('Barangay', linkedVolunteer.homeAddressBarangay || 'Not provided')}
                          {renderReviewField('Occupation', linkedVolunteer.occupation || 'Not provided')}
                          {renderReviewField('Workplace / School', linkedVolunteer.workplaceOrSchool || 'Not provided')}
                          {renderReviewField('College Course', linkedVolunteer.collegeCourse || 'Not provided')}
                          {renderReviewField(
                            'Certifications / Trainings',
                            linkedVolunteer.certificationsOrTrainings ? (
                              isImageMediaUri(linkedVolunteer.certificationsOrTrainings) ? (
                                <Image
                                  source={{ uri: linkedVolunteer.certificationsOrTrainings }}
                                  style={styles.reviewCertificateImage}
                                />
                              ) : (
                                <Text style={styles.reviewRowValue}>{linkedVolunteer.certificationsOrTrainings}</Text>
                              )
                            ) : (
                              'Not provided'
                            ),
                            { wide: true }
                          )}
                          {renderReviewField('Hobbies and Interests', linkedVolunteer.hobbiesAndInterests || 'Not provided', { wide: true })}
                          {renderReviewField('Special Skills', linkedVolunteer.specialSkills || 'Not provided', { wide: true })}
                          {renderReviewField('Video Briefing URL', linkedVolunteer.videoBriefingUrl || 'Not provided', { wide: true })}
                          {renderReviewField(
                            'Affiliations',
                            linkedVolunteer.affiliations && linkedVolunteer.affiliations.length > 0
                              ? linkedVolunteer.affiliations
                                  .map(affiliation =>
                                    `${affiliation.organization || 'Organization not provided'} - ${affiliation.position || 'Position not provided'}`
                                  )
                                  .join('\n')
                              : 'No affiliations provided.',
                            { wide: true }
                          )}
                        </>
                      );
                    })()
                  : null}
              </View>
            ) : null}
          </ScrollView>

          {reviewTarget ? (
            <View style={styles.reviewActionFooter}>
              {reviewTarget.type === 'user' ? (
                <View style={styles.reviewActionBar}>
                  <View style={styles.reviewActionCopy}>
                    <Text style={styles.reviewActionTitle}>Decision</Text>
                    <Text style={styles.reviewActionDescription}>
                      Approve to unlock account access. Reject will remove the pending application from the system.
                    </Text>
                  </View>
                  <View style={styles.reviewActionButtons}>
                    <TouchableOpacity
                      style={[styles.requestActionButton, styles.approveActionButton]}
                      onPress={() => handleApproveUser(reviewTarget.record)}
                    >
                      <MaterialIcons name="check-circle-outline" size={16} color="#166534" />
                      <Text style={[styles.requestActionButtonText, styles.approveActionButtonText]}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.requestActionButton, styles.reviewRejectButton]}
                      onPress={() => handleRejectUser(reviewTarget.record)}
                    >
                      <MaterialIcons name="block" size={16} color="#991b1b" />
                      <Text style={[styles.requestActionButtonText, styles.rejectActionButtonText]}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
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
    backgroundColor: '#f3f4f6',
  },
  pageHeader: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  pageHeaderTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  pageHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  pageSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
  },
  bannerWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  syncText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  successBannerTextWrap: {
    flex: 1,
  },
  successBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  successBannerMessage: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    color: '#166534',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dcfce7',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: '23%',
    minWidth: 140,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#166534',
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  listContent: {
    paddingBottom: 20,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
  reviewModalContainer: {
    flex: 1,
    backgroundColor: '#eef2f7',
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
  reviewModalHeader: {
    minHeight: 76,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#dbe3ee',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  reviewCloseButton: {
    minWidth: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  reviewCloseButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  reviewHeaderTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  reviewModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  reviewModalSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    textAlign: 'center',
  },
  reviewModalBody: {
    flex: 1,
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
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  requestQueueHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  requestQueueTitleWrap: {
    flex: 1,
  },
  requestQueueBadge: {
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
  },
  requestQueueBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  requestQueueSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  requestSummaryCard: {
    flexGrow: 1,
    minWidth: 120,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  requestSummaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  requestSummaryLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  userRoleSection: {
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  userTypeBox: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  userTypeBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  userTypeBoxTextWrap: {
    flex: 1,
  },
  userTypeBoxMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userTypeCountBadge: {
    minWidth: 30,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
  },
  userTypeCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  userRoleEmptyState: {
    paddingTop: 10,
  },
  requestSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 2,
  },
  requestSectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 10,
  },
  requestEmptyText: {
    fontSize: 14,
    color: '#64748b',
    fontStyle: 'italic',
  },
  requestTileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  requestTile: {
    flexGrow: 1,
    flexBasis: '23%',
    minWidth: 180,
    maxWidth: 260,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe3ee',
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  requestTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  requestTileAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestTileAvatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  requestTileName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  requestTileHint: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  requestRolePill: {
    backgroundColor: '#e0f2fe',
  },
  requestRolePillText: {
    color: '#075985',
  },
  requestMeta: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  requestBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  requestBadgePending: {
    backgroundColor: '#fef3c7',
  },
  requestBadgeRejected: {
    backgroundColor: '#fee2e2',
  },
  requestBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
    textTransform: 'uppercase',
  },
  requestBadgeTextRejected: {
    color: '#b91c1c',
  },
  requestActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  requestActionButton: {
    flexGrow: 1,
    minWidth: 120,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
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
  reviewDeleteButton: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  reviewRejectButton: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  reviewActionButton: {
    backgroundColor: '#e0f2fe',
  },
  requestActionButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  reviewActionButtonText: {
    color: '#075985',
  },
  approveActionButtonText: {
    color: '#166534',
  },
  rejectActionButtonText: {
    color: '#b91c1c',
  },
  modalHeaderSpacer: {
    width: 96,
  },
  reviewContent: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 120,
  },
  reviewPanel: {
    gap: 18,
  },
  reviewSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe3ee',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  reviewAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  reviewSummaryText: {
    flex: 1,
    minWidth: 0,
  },
  reviewApplicantName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  reviewApplicantMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748b',
  },
  reviewApplicantSupport: {
    marginTop: 8,
    fontSize: 12,
    color: '#475569',
  },
  reviewStatusStack: {
    alignItems: 'flex-end',
    gap: 8,
  },
  reviewRoleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#e0f2fe',
  },
  reviewRoleBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#075985',
    textTransform: 'uppercase',
  },
  reviewPendingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#fef3c7',
  },
  reviewPendingBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
    textTransform: 'uppercase',
  },
  reviewSectionCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe3ee',
    borderRadius: 18,
    padding: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  reviewSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 14,
  },
  reviewFieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  reviewField: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 220,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reviewFieldWide: {
    flexBasis: '100%',
  },
  reviewRowLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
  },
  reviewRowValue: {
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 20,
    marginTop: 6,
  },
  reviewCertificateImage: {
    width: '100%',
    height: 260,
    borderRadius: 8,
    marginTop: 8,
    backgroundColor: '#e2e8f0',
  },
  reviewActionFooter: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    paddingTop: 14,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#dbe3ee',
  },
  reviewActionBar: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
  },
  reviewActionCopy: {
    flex: 1,
  },
  reviewActionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  reviewActionDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  reviewActionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
