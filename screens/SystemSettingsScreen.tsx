import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useAppTheme } from '../contexts/ThemeContext';
import { getApiBaseUrl } from '../models/storage';
import type { AppSettings } from '../models/types';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import LogoutConfirmationModal from '../components/LogoutConfirmationModal';

type BackendStatus = 'checking' | 'online' | 'offline';

export default function SystemSettingsScreen() {
  const { user, logout } = useAuth();
  const { settings, isLoading, updateSetting } = useAppTheme();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');

  const colors = {
    page: '#f1f5f9',
    card: '#ffffff',
    border: '#e2e8f0',
    text: '#0f172a',
    muted: '#64748b',
    input: '#f8fafc',
  };

  const checkBackend = useCallback(async () => {
    setBackendStatus('checking');
    try {
      const response = await fetch(`${getApiBaseUrl()}/health`);
      setBackendStatus(response.ok ? 'online' : 'offline');
    } catch {
      setBackendStatus('offline');
    }
  }, []);

  useEffect(() => {
    void checkBackend();
  }, [checkBackend]);

  const handleUpdate = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSavingKey(String(key));
    try {
      await updateSetting(key, value);
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to save this setting.')
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingState, { backgroundColor: colors.page }]}>
        <ActivityIndicator size="large" color="#166534" />
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading settings...</Text>
      </View>
    );
  }

  const backendStatusLabel = backendStatus === 'online'
    ? 'Connected'
    : backendStatus === 'offline'
      ? 'Unavailable'
      : 'Checking...';
  const backendStatusColor = backendStatus === 'online'
    ? '#16a34a'
    : backendStatus === 'offline'
      ? '#dc2626'
      : '#d97706';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.page }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: colors.text }]}>System Settings</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>Manage your NVC workspace experience.</Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Notifications</Text>
        <Text style={[styles.sectionDescription, { color: colors.muted }]}>Control real-time in-app alerts for messages, assignments, and approvals.</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={[styles.settingTitle, { color: colors.text }]}>In-app alerts</Text>
            <Text style={[styles.settingDescription, { color: colors.muted }]}>Show notification banners while you work.</Text>
          </View>
          <Switch
            value={settings.notificationsEnabled}
            onValueChange={value => void handleUpdate('notificationsEnabled', value)}
            disabled={savingKey === 'notificationsEnabled'}
            trackColor={{ false: '#cbd5e1', true: '#86efac' }}
            thumbColor={settings.notificationsEnabled ? '#166534' : '#f8fafc'}
            accessibilityLabel="In-app alerts"
          />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Connection</Text>
        <Text style={[styles.sectionDescription, { color: colors.muted }]}>Current service connection used by this web portal.</Text>
        <View style={styles.connectionRow}>
          <MaterialIcons name="cloud" size={22} color={backendStatusColor} />
          <View style={styles.settingCopy}>
            <Text style={[styles.settingTitle, { color: colors.text }]}>NVC backend</Text>
            <Text style={[styles.settingDescription, { color: colors.muted }]}>{backendStatusLabel}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: backendStatusColor }]} />
        </View>
        <Text style={[styles.infoLabel, { color: colors.muted }]}>Active service address</Text>
        <Text style={[styles.infoText, { color: colors.text }]}>{getApiBaseUrl()}</Text>
        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: colors.input, borderColor: colors.border }]}
          onPress={() => void checkBackend()}
          disabled={backendStatus === 'checking'}
        >
          {backendStatus === 'checking' ? (
            <ActivityIndicator size="small" color="#166534" />
          ) : (
            <Text style={[styles.secondaryButtonText, { color: '#166534' }]}>Check connection</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Account</Text>
        <Text style={[styles.infoLabel, { color: colors.muted }]}>Signed in as</Text>
        <Text style={[styles.infoText, { color: colors.text }]}>{user?.name || 'NVC user'}</Text>
        <Text style={[styles.infoLabel, { color: colors.muted }]}>Email</Text>
        <Text style={[styles.infoText, { color: colors.text }]}>{user?.email || '—'}</Text>
        <Text style={[styles.infoLabel, { color: colors.muted }]}>Role</Text>
        <Text style={[styles.infoText, { color: colors.text }]}>{user?.role || '—'}</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <LogoutConfirmationModal
        visible={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={logout}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 14 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 4 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: { borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1 },
  sectionTitle: { fontSize: 17, fontWeight: '800', marginBottom: 8 },
  sectionDescription: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  settingCopy: { flex: 1 },
  settingTitle: { fontSize: 14, fontWeight: '700' },
  settingDescription: { marginTop: 3, fontSize: 13, lineHeight: 18 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  infoLabel: { fontSize: 12, fontWeight: '700', marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoText: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  secondaryButton: { marginTop: 14, borderRadius: 12, borderWidth: 1, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '700' },
  logoutButton: { marginTop: 16, backgroundColor: '#dc2626', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  logoutButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
