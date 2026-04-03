import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { deleteUser, getAllUsers, saveUser, subscribeToStorageChanges } from '../models/storage';
import { NVCSector, User, UserRole, UserType } from '../models/types';

const roleOptions: UserRole[] = ['admin', 'partner', 'volunteer'];
const NEW_ACCOUNT_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;

// Lets admins review, edit, and remove application user accounts.
export default function UserManagementScreen() {
  const { user, isAdmin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
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

  // Loads and sorts all user accounts for the admin management table.
  const loadUsers = useCallback(async () => {
    try {
      const allUsers = await getAllUsers();
      const sortedUsers = [...allUsers].sort((a, b) => {
        const createdAtDiff =
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (!Number.isNaN(createdAtDiff) && createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return a.name.localeCompare(b.name);
      });
      setUsers(sortedUsers);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      Alert.alert('Error', 'Failed to load users.');
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      void loadUsers();
    }
  }, [isAdmin, loadUsers]);

  useFocusEffect(
    React.useCallback(() => {
      if (!isAdmin) {
        return undefined;
      }

      void loadUsers();
      return undefined;
    }, [isAdmin, loadUsers])
  );

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return subscribeToStorageChanges(['users'], () => {
      void loadUsers();
    });
  }, [isAdmin, loadUsers]);

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
      setShowEditModal(false);
      setSelectedUser(null);
      await loadUsers();
      Alert.alert('Saved', 'User updated.');
    } catch (error) {
      Alert.alert('Error', 'Failed to update user.');
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
              Alert.alert('Error', 'Failed to delete user.');
            }
          },
        },
      ]
    );
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>User Management</Text>

      <View style={styles.toolbar}>
        <Text style={styles.syncText}>
          {lastSyncedAt
            ? `Last synced ${format(new Date(lastSyncedAt), 'MMM dd, yyyy hh:mm a')}`
            : 'Syncing users...'}
        </Text>
        <TouchableOpacity style={styles.refreshButton} onPress={() => void loadUsers()}>
          <MaterialIcons name="refresh" size={16} color="#166534" />
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

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

      <FlatList
        data={users}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
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
        )}
      />

      <Modal visible={showEditModal} animationType="slide" onRequestClose={() => setShowEditModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
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
    marginTop: 3,
    fontSize: 12,
    color: '#64748b',
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
});
