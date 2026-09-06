import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Appearance,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import {
  clearStorageCache,
  DEFAULT_APP_SETTINGS,
  getApiBaseUrl,
  getAppSettings,
  getRuntimeBackendUrl,
  saveAppSettings,
  setRuntimeBackendUrl,
} from '../models/storage';
import { AppSettings } from '../models/types';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';
import LogoutConfirmationModal from '../components/LogoutConfirmationModal';

const APPEARANCE_OPTIONS: Array<{ value: AppSettings['themeMode']; label: string; icon: 'light-mode' | 'dark-mode' }> = [
  { value: 'light', label: 'Light mode', icon: 'light-mode' },
  { value: 'dark', label: 'Dark mode', icon: 'dark-mode' },
];

// Shows configurable app preferences and a few safe maintenance actions.
export default function SystemSettingsScreen() {
  const { user, logout } = useAuth();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const storedSettings = await getAppSettings();
        setSettings(storedSettings);
        // Pre-fill the URL input with whatever is currently saved / active.
        setCustomUrlInput(storedSettings.customBackendUrl || getRuntimeBackendUrl() || '');
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

  useEffect(() => {
    Appearance.setColorScheme?.(settings.themeMode);
    if (typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = settings.themeMode;
      document.documentElement.dataset.nvcTheme = settings.themeMode;
      document.body.style.backgroundColor = settings.themeMode === 'dark' ? '#0f172a' : '#ffffff';
    }
  }, [settings.themeMode]);

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

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color="#166534" />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  const isDarkMode = settings.themeMode === 'dark';
  const settingsColors = isDarkMode
    ? {
        page: '#0f172a',
        card: '#172033',
        border: '#334155',
        text: '#f8fafc',
        muted: '#cbd5e1',
        input: '#0f172a',
      }
    : {
        page: '#f1f5f9',
        card: '#ffffff',
        border: '#e2e8f0',
        text: '#0f172a',
        muted: '#64748b',
        input: '#f8fafc',
      };

  return (
    <ScrollView style={[styles.container, { backgroundColor: settingsColors.page }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: settingsColors.text }]}>System Settings</Text>

      <View style={[styles.card, { backgroundColor: settingsColors.card, borderColor: settingsColors.border }]}>
        <Text style={[styles.sectionTitle, { color: settingsColors.text }]}>Appearance</Text>
        <Text style={[styles.sectionDescription, { color: settingsColors.muted }]}>
          Choose a light or dark display preference for the app and device controls.
        </Text>
        <View style={styles.appearanceRow}>
          {APPEARANCE_OPTIONS.map(option => {
            const isSelected = settings.themeMode === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.appearanceOption,
                  { backgroundColor: settingsColors.input, borderColor: settingsColors.border },
                  isSelected && styles.appearanceOptionSelected,
                ]}
                onPress={() => void updateSetting('themeMode', option.value)}
                activeOpacity={0.85}
              >
                {savingKey === 'themeMode' && isSelected ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <MaterialIcons name={option.icon} size={19} color={isSelected ? '#ffffff' : '#166534'} />
                )}
                  <Text style={[styles.appearanceOptionText, { color: settingsColors.text }, isSelected && styles.appearanceOptionTextSelected]}>
                    {option.label}
                  </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: settingsColors.card, borderColor: settingsColors.border }]}>
        <Text style={[styles.sectionTitle, { color: settingsColors.text }]}>Application</Text>
        <Text style={[styles.infoLabel, { color: settingsColors.muted }]}>App Name</Text>
        <Text style={[styles.infoText, { color: settingsColors.text }]}>NVC</Text>
        <Text style={[styles.infoLabel, { color: settingsColors.muted }]}>Version</Text>
        <Text style={[styles.infoText, { color: settingsColors.text }]}>1.0.0</Text>
        <Text style={[styles.infoLabel, { color: settingsColors.muted }]}>Backend URL (Active)</Text>
        <Text style={[styles.infoText, { color: settingsColors.text }]}>{getApiBaseUrl()}</Text>

        <Text style={[styles.infoLabel, { marginTop: 16, color: settingsColors.muted }]}>Custom Backend URL</Text>
        <Text style={[styles.settingDescription, { marginBottom: 6, color: settingsColors.muted }]}>
          Paste an ngrok URL (e.g. https://abc123.ngrok-free.app) or a local IP to override the
          default. Leave blank to use the built-in address.
        </Text>
        <TextInput
          style={[styles.urlInput, { backgroundColor: settingsColors.input, borderColor: settingsColors.border, color: settingsColors.text }]}
          value={customUrlInput}
          onChangeText={setCustomUrlInput}
          placeholder="https://abc123.ngrok-free.app"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TouchableOpacity
          style={[styles.secondaryButton, { marginTop: 8, backgroundColor: settingsColors.input, borderColor: settingsColors.border }]}
          onPress={async () => {
            setSavingUrl(true);
            try {
              const trimmed = customUrlInput.trim().replace(/\/$/, '');
              setRuntimeBackendUrl(trimmed || null);
              await saveAppSettings({ customBackendUrl: trimmed });
              Alert.alert(
                'Backend URL Updated',
                trimmed
                  ? `App will now connect to:\n${trimmed}`
                  : 'Reverted to the built-in backend address.'
              );
            } catch (error) {
              Alert.alert('Error', getRequestErrorMessage(error, 'Failed to save backend URL.'));
            } finally {
              setSavingUrl(false);
            }
          }}
          disabled={savingUrl}
        >
          {savingUrl ? (
            <ActivityIndicator size="small" color="#166534" />
          ) : (
            <Text style={[styles.secondaryButtonText, { color: isDarkMode ? '#86efac' : '#166534' }]}>Save Backend URL</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: settingsColors.card, borderColor: settingsColors.border }]}>
        <Text style={[styles.sectionTitle, { color: settingsColors.text }]}>Maintenance</Text>
        <Text style={[styles.sectionDescription, { color: settingsColors.muted }]}>
          Safe utility actions for local cleanup and demo data support.
        </Text>
        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: settingsColors.input, borderColor: settingsColors.border }]}
          onPress={() => void handleRefreshCache()}
          disabled={actionKey === 'cache'}
        >
          {actionKey === 'cache' ? (
            <ActivityIndicator size="small" color="#166534" />
          ) : (
            <Text style={[styles.secondaryButtonText, { color: isDarkMode ? '#86efac' : '#166534' }]}>Refresh Local Cache</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ghostButton, { backgroundColor: settingsColors.card, borderColor: settingsColors.border }]}
          onPress={() => void handleResetSettings()}
          disabled={actionKey === 'reset'}
        >
          {actionKey === 'reset' ? (
            <ActivityIndicator size="small" color="#475569" />
          ) : (
            <Text style={[styles.ghostButtonText, { color: settingsColors.muted }]}>Reset Preferences</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: settingsColors.card, borderColor: settingsColors.border }]}>
        <Text style={[styles.sectionTitle, { color: settingsColors.text }]}>Session</Text>
        <Text style={[styles.infoText, { color: settingsColors.text }]}>{user?.email}</Text>
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
  settingDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
  },
  appearanceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  appearanceOption: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  appearanceOptionSelected: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  appearanceOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  appearanceOptionTextSelected: {
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
  urlInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    marginTop: 4,
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
