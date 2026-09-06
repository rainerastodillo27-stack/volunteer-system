import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import InlineLoadError from '../components/InlineLoadError';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
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
  clearStorageCache,
  getStorageItem,
  subscribeToStorageChanges,
  getPendingUserApprovals,
  approveUser,
  rejectUser,
} from '../models/storage';
import { NVCSector, Partner, User, UserRole, UserType, Volunteer } from '../models/types';
import { getAttachmentLabel, isImageMediaUri, openAttachmentUri } from '../utils/media';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const roleOptions: UserRole[] = ['admin', 'partner', 'volunteer'];

export default function UserManagementScreen() {
  const { user, isAdmin } = useAuth();

  // Confirmation dialog hook
  const { dialogState, showConfirm, handleConfirm, handleCancel } = useConfirmDialog();

  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [successNotice, setSuccessNotice] = useState<{ title: string; message: string } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [pendingUserApprovals, setPendingUserApprovals] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showActionMenuUser, setShowActionMenuUser] = useState<User | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loadVersionRef = useRef(0);

  // Form state drafts
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState<UserRole>('volunteer');
  const [userTypeDraft, setUserTypeDraft] = useState<UserType>('Adult');
  const [pillarsDraft, setPillarsDraft] = useState<NVCSector[]>([]);

  const [reviewTarget, setReviewTarget] = useState<{ type: 'user'; record: User } | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending'>('all');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Load user data
  const loadUsers = useCallback(async (forceRefresh = false) => {
    const requestVersion = ++loadVersionRef.current;
    try {
      if (forceRefresh) {
        clearStorageCache(['users', 'partners', 'volunteers']);
      }

      const [allUsersResult, allPartnersResult] = await Promise.all([
        forceRefresh ? getStorageItem<User[]>('users') : getAllUsers(),
        forceRefresh ? getStorageItem<Partner[]>('partners') : getAllPartners(),
      ]);
      const allUsers = allUsersResult || [];
      const allPartners = allPartnersResult || [];
      setVolunteers([]);
      setPendingUserApprovals([]);

      const loadSupplementalData = async () => {
        try {
          const [allVolunteersResult, pendingApprovals] = await Promise.all([
            forceRefresh ? getStorageItem<Volunteer[]>('volunteers') : getAllVolunteers(),
            forceRefresh
              ? Promise.resolve(allUsers.filter(user => user.role !== 'admin' && user.approvalStatus === 'pending'))
              : getPendingUserApprovals(),
          ]);
          if (requestVersion !== loadVersionRef.current) return;
          setVolunteers(allVolunteersResult || []);
          setPendingUserApprovals(pendingApprovals);
        } catch {}
      };

      if (forceRefresh) {
        await loadSupplementalData();
      } else {
        setTimeout(() => void loadSupplementalData(), 50);
      }

      if (requestVersion !== loadVersionRef.current) return;

      const sortedUsers = [...allUsers].sort((a, b) => {
        const createdAtDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (!Number.isNaN(createdAtDiff) && createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return a.name.localeCompare(b.name);
      });
      setUsers(sortedUsers);
      setPartners(allPartners);
      setLoadError(null);
    } catch (error) {
      setLoadError({
        title: getRequestErrorTitle(error),
        message: getRequestErrorMessage(error, 'Failed to load users.'),
      });
    }
  }, []);

  const handleRefreshUsers = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadUsers(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadUsers]);

  useFocusEffect(
    React.useCallback(() => {
      if (!isAdmin) return undefined;
      void loadUsers();
      return subscribeToStorageChanges(['users', 'partners', 'volunteers'], () => {
        void loadUsers();
      });
    }, [isAdmin, loadUsers])
  );

  React.useEffect(() => {
    if (!successNotice) return undefined;
    const timer = setTimeout(() => setSuccessNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [successNotice]);

  // Open / Close Modals
  const openEditModal = (targetUser: User) => {
    setSelectedUser(targetUser);
    setNameDraft(targetUser.name);
    setEmailDraft(targetUser.email || '');
    setPhoneDraft(targetUser.phone || '');
    // Passwords are write-only and are never returned by the backend.
    setPasswordDraft('');
    setRoleDraft(targetUser.role);
    setUserTypeDraft(targetUser.userType || 'Adult');
    setPillarsDraft(targetUser.pillarsOfInterest || []);
    setShowEditModal(true);
    setShowActionMenuUser(null);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedUser(null);
  };

  // Save changes logic
  const handleSaveUser = async () => {
    if (!selectedUser) return;
    if (!nameDraft.trim() || !emailDraft.trim()) {
      Alert.alert('Validation Error', 'Name and email are required.');
      return;
    }

    try {
      const updatedUser: User = {
        ...selectedUser,
        name: nameDraft.trim(),
        email: emailDraft.trim().toLowerCase(),
        phone: phoneDraft.trim() || undefined,
        role: roleDraft,
        userType: userTypeDraft,
        pillarsOfInterest: pillarsDraft,
      };

      if (passwordDraft.trim()) {
        updatedUser.password = passwordDraft.trim();
      }

      await saveUser(updatedUser);

      // Update the visible account immediately. Linked profile maintenance is
      // independent of the account save and should not hold the editor open.
      setUsers(currentUsers =>
        currentUsers.map(account => account.id === updatedUser.id ? updatedUser : account)
      );
      closeEditModal();
      setSuccessNotice({
        title: 'Changes Saved',
        message: `${updatedUser.name}'s details were updated successfully.`,
      });

      void (async () => {
        try {
          const [linkedVolunteers, linkedPartners] = await Promise.all([
            getAllVolunteers(),
            getAllPartners(),
          ]);

          const linkedVolunteer = linkedVolunteers.find(
            volunteer => volunteer.userId === updatedUser.id ||
              (volunteer.email && volunteer.email.toLowerCase() === updatedUser.email?.toLowerCase())
          );
          const volunteerSave = linkedVolunteer && updatedUser.email
            ? saveVolunteer({
                ...linkedVolunteer,
                name: updatedUser.name,
                email: updatedUser.email,
                phone: updatedUser.phone || linkedVolunteer.phone,
              })
            : Promise.resolve();

          const linkedPartner = linkedPartners.find(
            partner => partner.ownerUserId === updatedUser.id ||
              (partner.contactEmail && partner.contactEmail.toLowerCase() === updatedUser.email?.toLowerCase())
          );
          const partnerSave = linkedPartner
            ? savePartner({
                ...linkedPartner,
                name: updatedUser.name,
                contactEmail: updatedUser.email || linkedPartner.contactEmail,
                contactPhone: updatedUser.phone || linkedPartner.contactPhone,
              })
            : Promise.resolve();

          await Promise.all([volunteerSave, partnerSave]);
        } catch (syncErr) {
          console.warn('Profile sync notice:', syncErr);
        }
        void loadUsers();
      })();
    } catch (error) {
      Alert.alert(getRequestErrorTitle(error), getRequestErrorMessage(error, 'Failed to update user.'));
    }
  };

  // Delete user logic
  const handleDeleteUser = async (targetUser: User) => {
    setShowActionMenuUser(null);
    if (targetUser.id === user?.id) {
      Alert.alert('Restricted', 'You cannot delete the currently signed-in admin account.');
      return;
    }

    const executeDelete = async () => {
      const previousUsers = users;
      setUsers(currentUsers => currentUsers.filter(existingUser => existingUser.id !== targetUser.id));
      setPendingUserApprovals(currentApprovals =>
        currentApprovals.filter(existingUser => existingUser.id !== targetUser.id)
      );
      try {
        await deleteUser(targetUser.id);
        setSuccessNotice({
          title: 'Account Deleted',
          message: `${targetUser.name}'s account has been removed.`,
        });
        Alert.alert('Account Deleted', `${targetUser.name}'s account has been removed.`);
      } catch (error) {
        setUsers(previousUsers);
        Alert.alert(getRequestErrorTitle(error), getRequestErrorMessage(error, 'Failed to delete user account.'));
      }
    };

    showConfirm({
      title: 'Delete Account',
      message: `Are you sure you want to delete ${targetUser.name}'s account? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      icon: 'person-remove',
      iconColor: '#DC2626',
      confirmColor: '#DC2626',
      loadingText: 'Deleting...',
      onConfirm: executeDelete,
    });
  };

  // CSV Export logic
  const handleExportCSV = () => {
    const csvContent =
      'Name,Email,Role,Status,Joined\n' +
      users.map(u => `"${u.name}","${u.email}","${u.role}","${u.approvalStatus || 'Active'}","${u.createdAt}"`).join('\n');

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `user_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      Alert.alert('Export Complete', `${users.length} user records ready for export.`);
    }
  };

  const openUserReview = (targetUser: User) => {
    setReviewTarget({ type: 'user', record: targetUser });
    setShowActionMenuUser(null);
  };

  const closeReviewModal = () => {
    setReviewTarget(null);
  };

  const getLinkedPartnerForUser = (targetUser: User) =>
    partners.find(partner => {
      if (partner.ownerUserId) return partner.ownerUserId === targetUser.id;
      return (
        (partner.contactEmail || '').trim().toLowerCase() === (targetUser.email || '').trim().toLowerCase() ||
        (partner.contactPhone || '').trim() === (targetUser.phone || '').trim()
      );
    }) || null;

  const getLinkedVolunteerForUser = (targetUser: User) =>
    volunteers.find(volunteer =>
      volunteer.userId === targetUser.id ||
      (volunteer.email || '').trim().toLowerCase() === (targetUser.email || '').trim().toLowerCase()
    ) || null;

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

  // Summary stats
  const adminUsers = users.filter(item => item.role === 'admin');
  const partnerUsers = users.filter(item => item.role === 'partner');
  const volunteerUsers = users.filter(item => item.role === 'volunteer');
  const totalAdmins = adminUsers.length;
  const totalPartners = partnerUsers.length;
  const totalVolunteers = volunteerUsers.length;

  // Filtered users list
  const visibleUsers = users.filter(account => {
    const roleMatches = accountFilter === 'all' || account.role === accountFilter;
            const isPending = account.approvalStatus?.toLowerCase() === 'pending';
    const statusMatches =
      statusFilter === 'all' ||
      (statusFilter === 'pending' && isPending) ||
      (statusFilter === 'active' && !isPending);

    const partner = getLinkedPartnerForUser(account);
    const query = accountSearch.trim().toLowerCase();
    const searchMatches =
      !query ||
      [account.name, account.email, account.phone, partner?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);

    return roleMatches && statusMatches && searchMatches;
  });

  // Pagination bounds
  const totalItems = visibleUsers.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const paginatedUsers = visibleUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.mainScrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconContainer}>
              <MaterialIcons name="person-outline" size={24} color="#16a34a" />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.pageTitle}>User Management</Text>
              <Text style={styles.pageSubtitle}>Manage and oversee all user accounts in the system.</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.secondaryExportButton} onPress={handleExportCSV} activeOpacity={0.85}>
              <MaterialIcons name="file-download" size={18} color="#475569" />
              <Text style={styles.secondaryExportButtonText}>Export</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loadError ? (
          <View style={styles.bannerWrap}>
            <InlineLoadError title={loadError.title} message={loadError.message} onRetry={() => void loadUsers()} />
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

        {/* 4 Summary Cards Grid */}
        <View style={styles.summaryGrid}>
          {/* Card 1: Total Users */}
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconBox, { backgroundColor: '#f0fdf4' }]}>
              <MaterialIcons name="person-outline" size={24} color="#16a34a" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={styles.summaryNumber}>{users.length}</Text>
              <Text style={styles.summaryTitle}>Total Users</Text>
              <Text style={styles.summarySubtext}>All registered accounts</Text>
            </View>
          </View>

          {/* Card 2: Administrators */}
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconBox, { backgroundColor: '#eff6ff' }]}>
              <MaterialIcons name="shield" size={22} color="#2563eb" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={styles.summaryNumber}>{totalAdmins}</Text>
              <Text style={styles.summaryTitle}>Administrators</Text>
              <Text style={styles.summarySubtext}>System administrators</Text>
            </View>
          </View>

          {/* Card 3: Partners */}
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconBox, { backgroundColor: '#f3e8ff' }]}>
              <MaterialIcons name="handshake" size={22} color="#9333ea" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={styles.summaryNumber}>{totalPartners}</Text>
              <Text style={styles.summaryTitle}>Partners</Text>
              <Text style={styles.summarySubtext}>Partner accounts</Text>
            </View>
          </View>

          {/* Card 4: Volunteers */}
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconBox, { backgroundColor: '#fff7ed' }]}>
              <MaterialIcons name="favorite" size={22} color="#ea580c" />
            </View>
            <View style={styles.summaryContent}>
              <Text style={styles.summaryNumber}>{totalVolunteers}</Text>
              <Text style={styles.summaryTitle}>Volunteers</Text>
              <Text style={styles.summarySubtext}>Volunteer accounts</Text>
            </View>
          </View>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabsContainer}>
          {([
            { key: 'all', label: 'All Accounts' },
            { key: 'admin', label: 'Administrators' },
            { key: 'partner', label: 'Partners' },
            { key: 'volunteer', label: 'Volunteers' },
          ] as const).map(tab => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => {
                setAccountFilter(tab.key);
                setCurrentPage(1);
              }}
              style={[styles.tabButton, accountFilter === tab.key && styles.tabButtonActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabButtonText, accountFilter === tab.key && styles.tabButtonTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Search & Filter Toolbar */}
        <View style={styles.toolbarContainer}>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={20} color="#94a3b8" />
            <TextInput
              value={accountSearch}
              onChangeText={text => {
                setAccountSearch(text);
                setCurrentPage(1);
              }}
              placeholder="Search users by name, email, or organization..."
              placeholderTextColor="#94a3b8"
              style={styles.searchInput}
            />
          </View>

          <View style={styles.toolbarRight}>
            {/* Account Type Dropdown */}
            <TouchableOpacity
              style={styles.filterDropdownButton}
              onPress={() => {
                setShowTypeDropdown(!showTypeDropdown);
                setShowStatusDropdown(false);
              }}
            >
              <MaterialIcons name="manage-accounts" size={18} color="#64748b" />
              <Text style={styles.filterDropdownText}>
                {accountFilter === 'all' ? 'Account Type' : accountFilter.charAt(0).toUpperCase() + accountFilter.slice(1)}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={18} color="#64748b" />
            </TouchableOpacity>

            {/* Status Dropdown */}
            <TouchableOpacity
              style={styles.filterDropdownButton}
              onPress={() => {
                setShowStatusDropdown(!showStatusDropdown);
                setShowTypeDropdown(false);
              }}
            >
              <Text style={styles.filterDropdownText}>
                {statusFilter === 'all' ? 'Status' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={18} color="#64748b" />
            </TouchableOpacity>

            {/* Refresh Button */}
            <TouchableOpacity
              style={styles.refreshIconButton}
              onPress={() => void handleRefreshUsers()}
              disabled={isRefreshing}
              activeOpacity={0.7}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color="#475569" />
              ) : (
                <MaterialIcons name="refresh" size={18} color="#475569" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Dropdown Options Overlays */}
        {showTypeDropdown && (
          <View style={styles.dropdownMenuOverlay}>
            {(['all', 'admin', 'partner', 'volunteer'] as const).map(typeKey => (
              <TouchableOpacity
                key={typeKey}
                style={[styles.dropdownMenuItem, accountFilter === typeKey && styles.dropdownMenuItemActive]}
                onPress={() => {
                  setAccountFilter(typeKey);
                  setShowTypeDropdown(false);
                  setCurrentPage(1);
                }}
              >
                <Text style={[styles.dropdownMenuText, accountFilter === typeKey && styles.dropdownMenuTextActive]}>
                  {typeKey === 'all' ? 'All Account Types' : typeKey.charAt(0).toUpperCase() + typeKey.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {showStatusDropdown && (
          <View style={[styles.dropdownMenuOverlay, { right: 70 }]}>
            {(['all', 'active', 'pending'] as const).map(statKey => (
              <TouchableOpacity
                key={statKey}
                style={[styles.dropdownMenuItem, statusFilter === statKey && styles.dropdownMenuItemActive]}
                onPress={() => {
                  setStatusFilter(statKey);
                  setShowStatusDropdown(false);
                  setCurrentPage(1);
                }}
              >
                <Text style={[styles.dropdownMenuText, statusFilter === statKey && styles.dropdownMenuTextActive]}>
                  {statKey === 'all' ? 'All Statuses' : statKey.charAt(0).toUpperCase() + statKey.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Data Table */}
        <View style={styles.tableContainer}>
          <View style={styles.tableHeaderRow}>
            <View style={[styles.colCell, styles.colUser]}>
              <Text style={styles.thText}>USER</Text>
              <MaterialIcons name="unfold-more" size={14} color="#94a3b8" />
            </View>
            <View style={[styles.colCell, styles.colType]}>
              <Text style={styles.thText}>ACCOUNT TYPE</Text>
              <MaterialIcons name="unfold-more" size={14} color="#94a3b8" />
            </View>
            <View style={[styles.colCell, styles.colEmail]}>
              <Text style={styles.thText}>EMAIL</Text>
            </View>
            <View style={[styles.colCell, styles.colOrg]}>
              <Text style={styles.thText}>ORGANIZATION</Text>
              <MaterialIcons name="unfold-more" size={14} color="#94a3b8" />
            </View>
            <View style={[styles.colCell, styles.colStatus]}>
              <Text style={styles.thText}>STATUS</Text>
              <MaterialIcons name="unfold-more" size={14} color="#94a3b8" />
            </View>
            <View style={[styles.colCell, styles.colJoined]}>
              <Text style={styles.thText}>JOINED</Text>
              <MaterialIcons name="unfold-more" size={14} color="#94a3b8" />
            </View>
            <View style={[styles.colCell, styles.colActions]}>
              <Text style={styles.thText}>ACTIONS</Text>
            </View>
          </View>

          {paginatedUsers.map(account => {
            const partner = getLinkedPartnerForUser(account);
                    const isPending = account.approvalStatus?.toLowerCase() === 'pending';

            // Role Badge styling
            let badgeBg = '#f0fdf4';
            let badgeText = '#16a34a';
            let badgeIcon = 'handshake';
            let roleLabel = 'Partner';
            let avatarBg = '#dcfce7';
            let avatarTextColor = '#15803d';

            if (account.role === 'admin') {
              badgeBg = '#eff6ff';
              badgeText = '#2563eb';
              badgeIcon = 'shield';
              roleLabel = 'Administrator';
              avatarBg = '#dbeafe';
              avatarTextColor = '#1d4ed8';
            } else if (account.role === 'volunteer') {
              badgeBg = '#fff7ed';
              badgeText = '#ea580c';
              badgeIcon = 'favorite';
              roleLabel = 'Volunteer';
              avatarBg = '#ffedd5';
              avatarTextColor = '#c2410c';
            }

            const formattedDate = format(new Date(account.createdAt || Date.now()), 'MMM dd, yyyy');

            return (
              <View key={account.id} style={styles.tableBodyRow}>
                {/* User Column */}
                <View style={[styles.colCell, styles.colUser]}>
                  <View style={[styles.avatarCircle, { backgroundColor: avatarBg }]}>
                    <Text style={[styles.avatarText, { color: avatarTextColor }]}>
                      {account.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.userNameMeta}>
                    <Text style={styles.userNameText}>{account.name}</Text>
                    <Text style={styles.userSubText}>{account.phone || account.userType || roleLabel}</Text>
                  </View>
                </View>

                {/* Account Type Column */}
                <View style={[styles.colCell, styles.colType]}>
                  <View style={[styles.rolePill, { backgroundColor: badgeBg }]}>
                    <MaterialIcons name={badgeIcon as any} size={14} color={badgeText} />
                    <Text style={[styles.rolePillText, { color: badgeText }]}>{roleLabel}</Text>
                  </View>
                </View>

                {/* Email Column */}
                <View style={[styles.colCell, styles.colEmail]}>
                  <Text style={styles.tdText} numberOfLines={1}>
                    {account.email || '—'}
                  </Text>
                </View>

                {/* Organization Column */}
                <View style={[styles.colCell, styles.colOrg]}>
                  <Text style={styles.tdText} numberOfLines={1}>
                    {partner?.name || (account.role === 'admin' ? 'NVC' : '—')}
                  </Text>
                </View>

                {/* Status Column */}
                <View style={[styles.colCell, styles.colStatus]}>
                  <View style={[styles.statusPill, isPending ? styles.statusPillPending : styles.statusPillActive]}>
                    <View style={[styles.statusDot, isPending ? styles.statusDotPending : styles.statusDotActive]} />
                    <Text style={[styles.statusText, isPending ? styles.statusTextPending : styles.statusTextActive]}>
                      {isPending ? 'Pending' : 'Active'}
                    </Text>
                  </View>
                </View>

                {/* Joined Column */}
                <View style={[styles.colCell, styles.colJoined]}>
                  <Text style={styles.tdText}>{formattedDate}</Text>
                </View>

                {/* Actions Column */}
                <View style={[styles.colCell, styles.colActions]}>
                  <TouchableOpacity
                    style={[styles.actionIconButton, styles.actionBtnView]}
                    onPress={() => openUserReview(account)}
                    activeOpacity={0.75}
                    accessibilityLabel="View details"
                  >
                    <MaterialIcons name="visibility" size={17} color="#475569" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionIconButton, styles.actionBtnEdit]}
                    onPress={() => openEditModal(account)}
                    activeOpacity={0.75}
                    accessibilityLabel="Edit account"
                  >
                    <MaterialIcons name="edit" size={17} color="#15803d" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.actionIconButton,
                      styles.actionBtnDelete,
                      account.id === user?.id && styles.actionBtnDisabled,
                    ]}
                    onPress={() => handleDeleteUser(account)}
                    activeOpacity={0.75}
                    disabled={account.id === user?.id}
                    accessibilityLabel="Delete account"
                  >
                    <MaterialIcons
                      name="delete-outline"
                      size={17}
                      color={account.id === user?.id ? "#cbd5e1" : "#ef4444"}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {paginatedUsers.length === 0 && (
            <View style={styles.emptyTableState}>
              <MaterialIcons name="person-search" size={36} color="#cbd5e1" />
              <Text style={styles.emptyTableText}>No accounts found matching search or filters.</Text>
            </View>
          )}
        </View>

        {/* Footer Pagination */}
        <View style={styles.paginationFooter}>
          <Text style={styles.paginationCountText}>
            Showing {startItem} to {endItem} of {totalItems} users
          </Text>

          <View style={styles.paginationControls}>
            <TouchableOpacity
              style={[styles.pageNavButton, currentPage === 1 && styles.pageNavButtonDisabled]}
              onPress={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              <MaterialIcons name="chevron-left" size={20} color={currentPage === 1 ? '#cbd5e1' : '#475569'} />
            </TouchableOpacity>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
              <TouchableOpacity
                key={pageNum}
                style={[styles.pageNumberButton, currentPage === pageNum && styles.pageNumberButtonActive]}
                onPress={() => setCurrentPage(pageNum)}
              >
                <Text style={[styles.pageNumberText, currentPage === pageNum && styles.pageNumberTextActive]}>
                  {pageNum}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.pageNavButton, currentPage === totalPages && styles.pageNavButtonDisabled]}
              onPress={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
            >
              <MaterialIcons name="chevron-right" size={20} color={currentPage === totalPages ? '#cbd5e1' : '#475569'} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Edit User Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent onRequestClose={closeEditModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentCard}>
            <View style={styles.modalHeaderBar}>
              <Text style={styles.modalHeadingTitle}>Edit User Details</Text>
              <TouchableOpacity onPress={closeEditModal}>
                <MaterialIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalFormBody}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput style={styles.formInput} value={nameDraft} onChangeText={setNameDraft} />

              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput style={styles.formInput} value={emailDraft} onChangeText={setEmailDraft} keyboardType="email-address" autoCapitalize="none" />

              <Text style={styles.inputLabel}>Phone Number</Text>
              <TextInput style={styles.formInput} value={phoneDraft} onChangeText={setPhoneDraft} keyboardType="phone-pad" />

              <Text style={styles.inputLabel}>Role</Text>
              <View style={styles.optionRow}>
                {roleOptions.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.optionChip, roleDraft === r && styles.optionChipActive]}
                    onPress={() => setRoleDraft(r)}
                  >
                    <Text style={[styles.optionChipText, roleDraft === r && styles.optionChipTextActive]}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>User Type</Text>
              <View style={styles.optionRow}>
                {(['Student', 'Adult', 'Senior'] as const).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.optionChip, userTypeDraft === t && styles.optionChipActive]}
                    onPress={() => setUserTypeDraft(t)}
                  >
                    <Text style={[styles.optionChipText, userTypeDraft === t && styles.optionChipTextActive]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>New Password (optional)</Text>
              <TextInput style={styles.formInput} placeholder="Leave blank to keep current password" value={passwordDraft} onChangeText={setPasswordDraft} secureTextEntry />

              {selectedUser && selectedUser.id !== user?.id && (
                <>
                  <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
                    <TouchableOpacity 
                      style={styles.deleteAccountButton} 
                      onPress={() => {
                        const target = selectedUser;
                        closeEditModal();
                        handleDeleteUser(target);
                      }}
                    >
                      <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
                      <Text style={styles.deleteAccountButtonText}>Delete This Account</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.modalFooterActions}>
              <TouchableOpacity style={styles.cancelFormButton} onPress={closeEditModal}>
                <Text style={styles.cancelFormButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitFormButton} onPress={handleSaveUser}>
                <Text style={styles.submitFormButtonText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Review Modal */}
      <Modal visible={Boolean(reviewTarget)} animationType="slide" onRequestClose={closeReviewModal}>
        {reviewTarget && (
          <View style={styles.reviewModalContainer}>
            <View style={styles.reviewModalHeader}>
              <TouchableOpacity style={styles.reviewCloseButton} onPress={closeReviewModal}>
                <MaterialIcons name="close" size={18} color="#334155" />
                <Text style={styles.reviewCloseButtonText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.reviewModalTitle}>User Account Details</Text>
              <View style={{ width: 80 }} />
            </View>
            <ScrollView style={styles.reviewModalBodyContent}>
              {/* Profile Header */}
              <View style={styles.reviewSummaryBox}>
                <View style={styles.reviewAvatarBig}>
                  <Text style={styles.reviewAvatarTextBig}>
                    {reviewTarget.record.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={styles.reviewNameText}>{reviewTarget.record.name}</Text>
                  <Text style={styles.reviewSubText}>{reviewTarget.record.email}</Text>
                </View>
              </View>

              {/* Account Details Section */}
              <View style={styles.reviewDetailsSection}>
                <Text style={styles.reviewSectionTitle}>Account Information</Text>
                
                <View style={styles.reviewDetailRow}>
                  <Text style={styles.reviewDetailLabel}>User ID</Text>
                  <Text style={styles.reviewDetailValue}>{reviewTarget.record.id}</Text>
                </View>

                <View style={styles.reviewDetailRow}>
                  <Text style={styles.reviewDetailLabel}>Role</Text>
                  <View style={[styles.reviewRolePill, { 
                    backgroundColor: reviewTarget.record.role === 'admin' ? '#eff6ff' : 
                                     reviewTarget.record.role === 'partner' ? '#f3e8ff' : '#fff7ed',
                  }]}>
                    <Text style={[styles.reviewRolePillText, {
                      color: reviewTarget.record.role === 'admin' ? '#2563eb' : 
                             reviewTarget.record.role === 'partner' ? '#9333ea' : '#ea580c',
                    }]}>
                      {reviewTarget.record.role.charAt(0).toUpperCase() + reviewTarget.record.role.slice(1)}
                    </Text>
                  </View>
                </View>

                <View style={styles.reviewDetailRow}>
                  <Text style={styles.reviewDetailLabel}>Status</Text>
                  <View style={[styles.reviewStatusPill, { 
                    backgroundColor: reviewTarget.record.approvalStatus === 'pending' ? '#fffbeb' : '#f0fdf4',
                  }]}>
                    <View style={[styles.reviewStatusDot, { 
                      backgroundColor: reviewTarget.record.approvalStatus === 'pending' ? '#d97706' : '#16a34a',
                    }]} />
                    <Text style={[styles.reviewStatusText, {
                      color: reviewTarget.record.approvalStatus === 'pending' ? '#b45309' : '#15803d',
                    }]}>
                      {reviewTarget.record.approvalStatus === 'pending' ? 'Pending' : 'Active'}
                    </Text>
                  </View>
                </View>

                <View style={styles.reviewDetailRow}>
                  <Text style={styles.reviewDetailLabel}>Phone</Text>
                  <Text style={styles.reviewDetailValue}>{reviewTarget.record.phone || 'Not provided'}</Text>
                </View>

                <View style={styles.reviewDetailRow}>
                  <Text style={styles.reviewDetailLabel}>User Type</Text>
                  <Text style={styles.reviewDetailValue}>{reviewTarget.record.userType || 'Adult'}</Text>
                </View>

                <View style={styles.reviewDetailRow}>
                  <Text style={styles.reviewDetailLabel}>Organization</Text>
                  <Text style={styles.reviewDetailValue}>{getLinkedPartnerForUser(reviewTarget.record)?.name || (reviewTarget.record.role === 'admin' ? 'NVC' : '—')}</Text>
                </View>

                <View style={styles.reviewDetailRow}>
                  <Text style={styles.reviewDetailLabel}>Joined</Text>
                  <Text style={styles.reviewDetailValue}>{format(new Date(reviewTarget.record.createdAt || Date.now()), 'MMM dd, yyyy HH:mm')}</Text>
                </View>

              </View>

              {reviewTarget.record.role === 'volunteer' && getLinkedVolunteerForUser(reviewTarget.record) ? (() => {
                const volunteerProfile = getLinkedVolunteerForUser(reviewTarget.record)!;
                const registration = (reviewTarget.record as any).volunteerRegistration || {};
                const validIdPhoto = registration.validIdPhoto || (volunteerProfile as any).validIdPhoto;
                return (
                  <View style={styles.reviewDetailsSection}>
                    <Text style={styles.reviewSectionTitle}>Volunteer Profile Details</Text>
                    {[
                      ['Gender', volunteerProfile.gender],
                      ['Date of Birth', volunteerProfile.dateOfBirth],
                      ['Civil Status', volunteerProfile.civilStatus],
                      ['Address', volunteerProfile.homeAddress],
                      ['Occupation', volunteerProfile.occupation],
                      ['Workplace / School', volunteerProfile.workplaceOrSchool],
                      ['College Course', volunteerProfile.collegeCourse],
                      ['Certifications / Trainings', volunteerProfile.certificationsOrTrainings],
                      ['Hobbies & Interests', volunteerProfile.hobbiesAndInterests],
                      ['Special Skills', volunteerProfile.specialSkills],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.reviewDetailRow}>
                        <Text style={styles.reviewDetailLabel}>{label}</Text>
                        <Text style={styles.reviewDetailValue}>{value || 'Not provided'}</Text>
                      </View>
                    ))}
                    {volunteerProfile.skills?.length ? (
                      <View style={styles.reviewDetailRow}>
                        <Text style={styles.reviewDetailLabel}>Skills</Text>
                        <View style={styles.reviewInterestsWrap}>
                          {volunteerProfile.skills.map(skill => (
                            <View key={skill} style={styles.reviewInterestChip}>
                              <Text style={styles.reviewInterestText}>{skill}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                    {volunteerProfile.affiliations?.length ? (
                      <View style={styles.reviewDetailRow}>
                        <Text style={styles.reviewDetailLabel}>Affiliations</Text>
                        <View style={styles.reviewListValue}>
                          {volunteerProfile.affiliations.map((affiliation, index) => (
                            <Text key={`${affiliation.organization}-${index}`} style={styles.reviewDetailValue}>
                              {affiliation.position || 'Member'} at {affiliation.organization || 'Organization not provided'}
                            </Text>
                          ))}
                        </View>
                      </View>
                    ) : null}
                    {validIdPhoto ? (
                      <View style={styles.reviewMediaBlock}>
                        <Text style={styles.reviewDetailLabel}>Valid ID Photo</Text>
                        <TouchableOpacity onPress={() => void openAttachmentUri(validIdPhoto)}>
                          <Image source={{ uri: validIdPhoto }} style={styles.reviewDocumentImage} resizeMode="contain" />
                          <Text style={styles.reviewAttachmentLink}>View full image</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })() : null}

              {reviewTarget.record.role === 'partner' && getLinkedPartnerForUser(reviewTarget.record) ? (() => {
                const partnerProfile = getLinkedPartnerForUser(reviewTarget.record)!;
                return (
                  <View style={styles.reviewDetailsSection}>
                    <Text style={styles.reviewSectionTitle}>Partner Application Details</Text>
                    {[
                      ['Organization Name', partnerProfile.name],
                      ['Sector Type', partnerProfile.sectorType],
                      ['Stakeholder Name', partnerProfile.stakeholderName],
                      ['DSWD Accreditation No', partnerProfile.dswdAccreditationNo],
                      ['SEC Registration No', partnerProfile.secRegistrationNo],
                      ['Address / Location', [partnerProfile.address, partnerProfile.cityMunicipality, partnerProfile.province, partnerProfile.region].filter(Boolean).join(', ')],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.reviewDetailRow}>
                        <Text style={styles.reviewDetailLabel}>{label}</Text>
                        <Text style={styles.reviewDetailValue}>{value || 'Not provided'}</Text>
                      </View>
                    ))}
                    {partnerProfile.advocacyFocus?.length ? (
                      <View style={styles.reviewDetailRow}>
                        <Text style={styles.reviewDetailLabel}>Advocacy Focus</Text>
                        <View style={styles.reviewInterestsWrap}>
                          {partnerProfile.advocacyFocus.map(focus => (
                            <View key={focus} style={styles.reviewInterestChip}>
                              <Text style={styles.reviewInterestText}>{focus}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                    {partnerProfile.registrationDocuments?.length ? (
                      <View style={styles.reviewMediaBlock}>
                        <Text style={styles.reviewDetailLabel}>Submitted Documents</Text>
                        {partnerProfile.registrationDocuments.map((documentUri, index) => (
                          <TouchableOpacity key={`${documentUri}-${index}`} style={styles.reviewDocumentRow} onPress={() => void openAttachmentUri(documentUri)}>
                            <MaterialIcons name="description" size={17} color="#166534" />
                            <Text style={styles.reviewAttachmentLink} numberOfLines={1}>{getAttachmentLabel(documentUri)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })() : null}
            </ScrollView>
          </View>
        )}
      </Modal>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  mainScrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    maxWidth: 1280,
    alignSelf: 'center',
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    flexWrap: 'wrap',
    gap: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    justifyContent: 'center',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    fontFamily: 'Nunito',
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  secondaryExportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  secondaryExportButtonText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Nunito',
  },
  bannerWrap: {
    marginBottom: 16,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 8,
    padding: 12,
  },
  successBannerTextWrap: {
    flex: 1,
  },
  successBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
  },
  successBannerMessage: {
    fontSize: 13,
    color: '#15803d',
  },

  // Summary Grid
  summaryGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  summaryCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  summaryIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryContent: {
    flex: 1,
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    fontFamily: 'Nunito',
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginTop: 2,
    fontFamily: 'Nunito',
  },
  summarySubtext: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
    fontFamily: 'Nunito',
  },

  // Tabs
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 20,
    gap: 24,
  },
  tabButton: {
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#16a34a',
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    fontFamily: 'Nunito',
  },
  tabButtonTextActive: {
    color: '#16a34a',
    fontWeight: '700',
  },

  // Search & Filter Toolbar
  toolbarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
    zIndex: 10,
  },
  searchBox: {
    flex: 1,
    minWidth: 280,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    fontFamily: 'Nunito',
    outlineStyle: 'none' as any,
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterDropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
  },
  filterDropdownText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
    fontFamily: 'Nunito',
  },
  refreshIconButton: {
    width: 42,
    height: 42,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownMenuOverlay: {
    position: 'absolute',
    top: 220,
    right: 120,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 100,
    minWidth: 160,
  },
  dropdownMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  dropdownMenuItemActive: {
    backgroundColor: '#f0fdf4',
  },
  dropdownMenuText: {
    fontSize: 13,
    color: '#334155',
  },
  dropdownMenuTextActive: {
    color: '#16a34a',
    fontWeight: '700',
  },

  // Table
  tableContainer: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  thText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
    fontFamily: 'Nunito',
  },
  tableBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  colCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  colUser: {
    flex: 2.2,
    minWidth: 180,
  },
  colType: {
    flex: 1.4,
    minWidth: 130,
  },
  colEmail: {
    flex: 2,
    minWidth: 180,
  },
  colOrg: {
    flex: 1.6,
    minWidth: 130,
  },
  colStatus: {
    flex: 1.2,
    minWidth: 100,
  },
  colJoined: {
    flex: 1.3,
    minWidth: 110,
  },
  colActions: {
    flex: 1.4,
    minWidth: 125,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Nunito',
  },
  userNameMeta: {
    marginLeft: 10,
  },
  userNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    fontFamily: 'Nunito',
  },
  userSubText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
    fontFamily: 'Nunito',
  },

  // Pills
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Nunito',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  statusPillActive: {
    backgroundColor: '#f0fdf4',
  },
  statusPillPending: {
    backgroundColor: '#fffbeb',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotActive: {
    backgroundColor: '#16a34a',
  },
  statusDotPending: {
    backgroundColor: '#d97706',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Nunito',
  },
  statusTextActive: {
    color: '#15803d',
  },
  statusTextPending: {
    color: '#b45309',
  },
  tdText: {
    fontSize: 13,
    color: '#334155',
    fontFamily: 'Nunito',
  },
  actionIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionBtnView: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  actionBtnEdit: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  actionBtnDelete: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  actionBtnDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    opacity: 0.45,
  },
  emptyTableState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTableText: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
  },

  // Pagination Footer
  paginationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingVertical: 8,
    flexWrap: 'wrap',
    gap: 12,
  },
  paginationCountText: {
    fontSize: 13,
    color: '#64748b',
    fontFamily: 'Nunito',
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pageNavButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  pageNavButtonDisabled: {
    backgroundColor: '#f8fafc',
  },
  pageNumberButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  pageNumberButtonActive: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  pageNumberText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
  },
  pageNumberTextActive: {
    color: '#16a34a',
    fontWeight: '700',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalContentCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  modalHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalHeadingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalFormBody: {
    padding: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    marginTop: 12,
  },
  formInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  optionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  optionChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  optionChipActive: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  optionChipText: {
    fontSize: 13,
    color: '#475569',
  },
  optionChipTextActive: {
    color: '#16a34a',
    fontWeight: '700',
  },
  modalFooterActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  cancelFormButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cancelFormButtonText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
  },
  submitFormButton: {
    backgroundColor: '#15803d',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  submitFormButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Empty state
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  reviewModalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  reviewModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  reviewCloseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reviewCloseButtonText: {
    fontSize: 14,
    color: '#334155',
  },
  reviewModalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  reviewModalBodyContent: {
    padding: 20,
  },
  reviewSummaryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  reviewAvatarBig: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarTextBig: {
    fontSize: 24,
    fontWeight: '700',
    color: '#15803d',
  },
  reviewNameText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  reviewSubText: {
    fontSize: 14,
    color: '#64748b',
  },
  reviewDetailsSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  reviewSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
  },
  reviewDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  reviewDetailLabel: {
    fontSize: 14,
    color: '#64748b',
    flex: 1,
  },
  reviewDetailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1.5,
    textAlign: 'right',
  },
  reviewRolePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reviewRolePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reviewStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reviewStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  reviewStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reviewInterestsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1.5,
    justifyContent: 'flex-end',
  },
  reviewInterestChip: {
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  reviewInterestText: {
    fontSize: 11,
    color: '#166534',
    fontWeight: '500',
  },
  reviewListValue: {
    flex: 1.5,
    gap: 4,
    alignItems: 'flex-end',
  },
  reviewMediaBlock: {
    marginTop: 12,
    gap: 8,
  },
  reviewDocumentImage: {
    width: '100%',
    height: 210,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  reviewDocumentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
  },
  reviewAttachmentLink: {
    flex: 1,
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    textDecorationLine: 'underline',
  },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
  },
  deleteAccountButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
});
