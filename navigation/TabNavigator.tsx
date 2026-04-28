import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import AdminNavigator from './AdminNavigator';
import VolunteerNavigator from './VolunteerNavigator';
import PartnerNavigator from './PartnerNavigator';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

// Dispatches the appropriate tab navigator based on the authenticated user's role.
export default function TabNavigator() {
  const { user, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (isAdmin) {
    return <AdminNavigator />;
  }

  if (user?.role === 'volunteer') {
    return <VolunteerNavigator />;
  }

  if (user?.role === 'partner') {
    return <PartnerNavigator />;
  }

  // Fallback (should be handled by Auth guards in StackNavigator)
  return <VolunteerNavigator />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
