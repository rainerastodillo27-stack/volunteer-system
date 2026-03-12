import React, { useEffect, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator, Platform } from 'react-native';
import { getUserByEmail, initializeMockData } from '../models/storage';
import { useAuth } from '../contexts/AuthContext';

export default function LoginScreen({ navigation }: any) {
  const isWeb = Platform.OS === 'web';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const { login } = useAuth();

  useEffect(() => {
    // Initialize mock data on first load
    const initApp = async () => {
      try {
        await initializeMockData();
        setInitialized(true);
      } catch (error) {
        console.error('Error initializing mock data:', error);
        Alert.alert('Error', 'Failed to initialize app. Please restart.');
      } finally {
        setLoading(false);
      }
    };

    initApp();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Validation Error', 'Please enter both email and password');
      return;
    }

    if (!email.includes('@')) {
      Alert.alert('Validation Error', 'Please enter a valid email address');
      return;
    }

    try {
      setLoading(true);
      const user = await getUserByEmail(email.toLowerCase().trim());

      if (!user) {
        Alert.alert('Authentication Failed', 'Email not found. Please check your credentials.');
        setLoading(false);
        return;
      }

      if (user.password !== password) {
        Alert.alert('Authentication Failed', 'Incorrect password. Please try again.');
        setLoading(false);
        return;
      }

      if (isWeb && user.role !== 'admin') {
        Alert.alert('Access Restricted', 'Volunteer and partner accounts can only log in on mobile.');
        setLoading(false);
        return;
      }

      if (!isWeb && user.role !== 'volunteer' && user.role !== 'partner') {
        Alert.alert('Access Restricted', 'Admin accounts can only log in on web. Use volunteer or partner on mobile.');
        setLoading(false);
        return;
      }

      // Update auth context - this triggers state change and navigation
      await login(user);
      setEmail('');
      setPassword('');
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Login Error', 'An error occurred during login. Please try again.');
      setLoading(false);
    }
  };

  if (loading && !initialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Initializing app...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Volunteer System</Text>
      <Text style={styles.subtitle}>Volunteer Management Platform</Text>

      <TextInput
        style={[styles.input, email && !email.includes('@') ? styles.inputError : null]}
        placeholder="Email Address"
        placeholderTextColor="#999"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#999"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />

      <TouchableOpacity 
        style={[styles.button, loading ? styles.buttonDisabled : null]} 
        onPress={handleLogin} 
        disabled={loading || !email || !password}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign In</Text>
        )}
      </TouchableOpacity>

      <View style={styles.demoSection}>
        <Text style={styles.demoTitle}>Demo Credentials:</Text>
        {isWeb ? (
          <View style={styles.demoItem}>
            <Text style={styles.demoLabel}>Admin Account (Web Only):</Text>
            <Text style={styles.demoEmail}>admin@nvc.org</Text>
            <Text style={styles.demoPassword}>admin123</Text>
          </View>
        ) : (
          <>
            <View style={styles.demoItem}>
              <Text style={styles.demoLabel}>Volunteer Account (Mobile):</Text>
              <Text style={styles.demoEmail}>volunteer@example.com</Text>
              <Text style={styles.demoPassword}>volunteer123</Text>
            </View>
            <View style={styles.demoItem}>
              <Text style={styles.demoLabel}>Partner Account - LGU / Partner Org (Mobile):</Text>
              <Text style={styles.demoEmail}>partner@livelihoods.org</Text>
              <Text style={styles.demoPassword}>partner123</Text>
            </View>
          </>
        )}
      </View>

      <TouchableOpacity onPress={() => Alert.alert('Sign Up', 'Feature coming soon')}>
        <Text style={styles.signupText}>Don't have an account? Sign Up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
  },
  inputError: {
    borderColor: '#ff6b6b',
  },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
    minHeight: 50,
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#999',
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  demoSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginTop: 20,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  demoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  demoItem: {
    marginBottom: 12,
  },
  demoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  demoEmail: {
    fontSize: 13,
    color: '#333',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  demoPassword: {
    fontSize: 13,
    color: '#333',
    fontFamily: 'monospace',
  },
  signupText: {
    color: '#4CAF50',
    textAlign: 'center',
    fontSize: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
});

