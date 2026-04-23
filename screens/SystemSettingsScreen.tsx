import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../contexts/AuthContext';
import { getApiBaseUrl, initializeMockData } from '../models/storage';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

// Shows environment details, backend controls, and session actions.
export default function SystemSettingsScreen() {
  const { user, logout, isAdmin } = useAuth();

  // Re-seeds the backend with the demo login accounts used by the app.
  const handleSeedBackendData = async () => {
    try {
      await initializeMockData();
      Alert.alert('Updated', 'Demo login accounts have been synchronized to the Postgres-backed backend.');
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error),
        getRequestErrorMessage(error, 'Failed to seed demo login accounts into the backend.')
      );
    }
  };

  // Confirms and clears the current session from the settings screen.
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

  if (!isAdmin) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.title}>Profile</Text>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{user?.name}</Text>
          <Text style={styles.infoText}>{user?.email}</Text>
          <Text style={styles.infoText}>{user?.phone || 'No phone number'}</Text>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>System Settings</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Application</Text>
        <Text style={styles.infoLabel}>App Name</Text>
        <Text style={styles.infoText}>{Constants.expoConfig?.name || 'NVC CONNECT'}</Text>
        <Text style={styles.infoLabel}>Version</Text>
        <Text style={styles.infoText}>{Constants.expoConfig?.version || '1.0.0'}</Text>
        <Text style={styles.infoLabel}>Environment</Text>
        <Text style={styles.infoText}>Backend-backed shared storage with in-memory session state</Text>
        <Text style={styles.infoLabel}>Backend URL</Text>
        <Text style={styles.infoText}>{getApiBaseUrl()}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Access Policy</Text>
        <Text style={styles.infoText}>Admin accounts are intended for web.</Text>
        <Text style={styles.infoText}>Volunteer and partner accounts are intended for mobile.</Text>
        <Text style={styles.infoText}>Partner project joins require admin approval.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Backend Data Controls</Text>
        <Text style={styles.infoText}>
          Re-sync the demo login accounts into the Postgres-backed backend storage.
        </Text>
        <Text style={styles.infoText}>
          This only works when the backend is explicitly unlocked for demo seeding.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleSeedBackendData}>
          <Text style={styles.primaryButtonText}>Seed Demo Login Accounts</Text>
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
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 10,
    textTransform: 'uppercase',
  },
  infoText: {
    fontSize: 14,
    color: '#334155',
    marginTop: 4,
    lineHeight: 20,
  },
  primaryButton: {
    marginTop: 14,
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  logoutButton: {
    marginTop: 14,
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
