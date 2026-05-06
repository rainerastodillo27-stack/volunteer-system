import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../contexts/AuthContext';
import {
  clearStorageCache,
  DEFAULT_APP_SETTINGS,
  getApiBaseUrl,
  getAppSettings,
  initializeMockData,
  saveAppSettings,
} from '../models/storage';
import { AppSettings } from '../models/types';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

const STARTUP_SCREENS: AppSettings['startupScreen'][] = ['Dashboard', 'Projects', 'Reports', 'Messages'];

// Shows configurable app preferences and a few safe maintenance actions.
export default function SystemSettingsScreen() {
  const { user, logout, isAdmin } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const storedSettings = await getAppSettings();
        setSettings(storedSettings);
      } catch (error) {
        Alert.alert(
          getRequestErrorTitle(error),
          getRequestErrorMessage(error, 'Failed to load saved settings.')
        );
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const updateSetting = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const previous = settings;
    const next = {
      ...previous,
      [key]: value,
    };

    setSettings(next);
    setSavingKey(String(key));

    try {
      await saveAppSettings({ [key]: value });
    } catch (error) {
      setSettings(previous);
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to save this setting.')
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleResetSettings = async () => {
    setActionKey('reset');
    try {
      setSettings(DEFAULT_APP_SETTINGS);
      await saveAppSettings(DEFAULT_APP_SETTINGS);
      Alert.alert('Settings reset', 'Application preferences were restored to defaults.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to reset settings.')
      );
    } finally {
      setActionKey(null);
    }
  };

  const handleRefreshCache = async () => {
    setActionKey('cache');
    try {
      clearStorageCache();
      Alert.alert('Cache refreshed', 'Local cache was cleared successfully.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to refresh the local cache.')
      );
    } finally {
      setActionKey(null);
    }
  };

  const handleSeedBackendData = async () => {
    setActionKey('seed');
    try {
      await initializeMockData();
      Alert.alert('Updated', 'Demo login accounts have been synchronized to the backend.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to seed demo login accounts into the backend.')
      );
    } finally {
      setActionKey(null);
    }
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Are you sure you want to logout?') : true;
      if (confirmed) {
        await logout();
      }
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: async () => await logout() },
    ]);
  };

  const renderToggleRow = (
    key: keyof AppSettings,
    title: string,
    description: string,
    value: boolean,
  ) => (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <View style={styles.settingControl}>
        {savingKey === key ? <ActivityIndicator size="small" color="#166534" /> : null}
        <Switch
          value={value}
          onValueChange={nextValue => void updateSetting(key, nextValue as AppSettings[typeof key])}
          trackColor={{ false: '#cbd5e1', true: '#86efac' }}
          thumbColor={value ? '#166534' : '#f8fafc'}
        />
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color="#166534" />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>System Settings</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>General Preferences</Text>
        {renderToggleRow(
          'notificationsEnabled',
          'Notifications',
          'Keep alerts and reminders enabled inside the app.',
          settings.notificationsEnabled,
        )}
        {renderToggleRow(
          'autoRefreshEnabled',
          'Auto Refresh',
          'Refresh dashboard-style screens automatically when they reopen.',
          settings.autoRefreshEnabled,
        )}
        {renderToggleRow(
          'compactDashboard',
          'Compact Layout',
          'Prefer denser cards and tighter spacing where supported.',
          settings.compactDashboard,
        )}
        {renderToggleRow(
          'approvalConfirmations',
          'Approval Confirmations',
          'Show confirmation prompts before approvals, rejections, and similar actions.',
          settings.approvalConfirmations,
        )}
        {renderToggleRow(
          'showProgramContext',
          'Show Program Context',
          'Display saved program context details in program management views.',
          settings.showProgramContext,
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Startup Screen</Text>
        <Text style={styles.sectionDescription}>
          Choose which main screen should be treated as your preferred landing area.
        </Text>
        <View style={styles.chipRow}>
          {STARTUP_SCREENS.map(option => {
            const isSelected = settings.startupScreen === option;
            return (
              <TouchableOpacity
                key={option}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => void updateSetting('startupScreen', option)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{option}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Application</Text>
        <Text style={styles.infoLabel}>App Name</Text>
        <Text style={styles.infoText}>{Constants.expoConfig?.name || 'NVC CONNECT'}</Text>
        <Text style={styles.infoLabel}>Version</Text>
        <Text style={styles.infoText}>{Constants.expoConfig?.version || '1.0.0'}</Text>
        <Text style={styles.infoLabel}>Backend URL</Text>
        <Text style={styles.infoText}>{getApiBaseUrl()}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Maintenance</Text>
        <Text style={styles.sectionDescription}>
          Safe utility actions for local cleanup and demo data support.
        </Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => void handleRefreshCache()}
          disabled={actionKey === 'cache'}
        >
          {actionKey === 'cache' ? (
            <ActivityIndicator size="small" color="#166534" />
          ) : (
            <Text style={styles.secondaryButtonText}>Refresh Local Cache</Text>
          )}
        </TouchableOpacity>
        {isAdmin ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => void handleSeedBackendData()}
            disabled={actionKey === 'seed'}
          >
            {actionKey === 'seed' ? (
              <ActivityIndicator size="small" color="#166534" />
            ) : (
              <Text style={styles.secondaryButtonText}>Seed Demo Login Accounts</Text>
            )}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.ghostButton}
          onPress={() => void handleResetSettings()}
          disabled={actionKey === 'reset'}
        >
          {actionKey === 'reset' ? (
            <ActivityIndicator size="small" color="#475569" />
          ) : (
            <Text style={styles.ghostButtonText}>Reset Preferences</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Session</Text>
        <Text style={styles.infoText}>{user?.email}</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#475569',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
    marginBottom: 14,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  settingCopy: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  settingDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
  },
  settingControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  chipSelected: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  chipTextSelected: {
    color: '#ffffff',
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  infoText: {
    fontSize: 14,
    color: '#334155',
    marginTop: 4,
    lineHeight: 20,
  },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#166534',
    fontSize: 14,
    fontWeight: '700',
  },
  ghostButton: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  ghostButtonText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  logoutButton: {
    marginTop: 14,
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
