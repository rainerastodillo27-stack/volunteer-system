import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

const LazyAdminNavigator = (props: Record<string, unknown>) => {
  const AdminNavigator = require('./AdminNavigator').default;
  return <AdminNavigator {...props} />;
};

const LazyVolunteerNavigator = (props: Record<string, unknown>) => {
  const VolunteerNavigator = require('./VolunteerNavigator').default;
  return <VolunteerNavigator {...props} />;
};

const LazyPartnerNavigator = (props: Record<string, unknown>) => {
  const PartnerNavigator = require('./PartnerNavigator').default;
  return <PartnerNavigator {...props} />;
};

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
    return <LazyAdminNavigator />;
  }

  if (user?.role === 'volunteer') {
    return <LazyVolunteerNavigator />;
  }

  if (user?.role === 'partner') {
    return <LazyPartnerNavigator />;
  }

  // Fallback (should be handled by Auth guards in StackNavigator)
  return <LazyVolunteerNavigator />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
