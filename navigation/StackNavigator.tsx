import { useEffect, useRef } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import AppLogo from "../components/AppLogo";

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const LazyLoginScreen = (props: Record<string, unknown>) => {
  const LoginScreen = require("../screens/LoginScreen").default;
  return <LoginScreen {...props} />;
};

const LazyTabNavigator = (props: Record<string, unknown>) => {
  const TabNavigator = require("./TabNavigator").default;
  return <TabNavigator {...props} />;
};

// Returns true only when running in a browser WITHOUT ?mode=mobile
function getIsMobileMode(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    if (typeof window !== 'undefined' && window?.location?.search) {
      const params = new URLSearchParams(window.location.search);
      return params.get('mode') === 'mobile';
    }
  } catch {
    // ignore
  }
  return false;
}

// Switches between the login flow and the authenticated tab navigator.
export default function StackNavigator() {
  const { user, loading, logout } = useAuth();
  const startupLoggedRef = useRef(false);
  const showBlockingStartupLoader = loading && Platform.OS === 'web';

  // If mobile mode is active and the logged-in user is an admin, force logout.
  const isMobileMode = getIsMobileMode();
  const isAdminInMobileMode = isMobileMode && user?.role === 'admin';

  useEffect(() => {
    if (isAdminInMobileMode && logout) {
      void logout();
    }
  }, [isAdminInMobileMode, logout]);

  useEffect(() => {
    if (loading || startupLoggedRef.current) {
      return;
    }

    startupLoggedRef.current = true;
    const bootTs = (globalThis as { __NVC_APP_BOOT_TS__?: number }).__NVC_APP_BOOT_TS__;
    if (!bootTs) {
      return;
    }

    const elapsedMs = Date.now() - bootTs;
    const platformLabel = Platform.OS === "web" ? "web" : "mobile";
    console.log(`[Perf] ${platformLabel} launch to first screen: ${elapsedMs}ms`);
    if (elapsedMs > 2000) {
      console.warn(`[Perf] Slow ${platformLabel} launch detected (>2000ms).`);
    }
  }, [loading]);

  if (showBlockingStartupLoader) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingCard}>
          <AppLogo width={120} />
          <Text style={styles.loadingTitle}>NVC</Text>
          <Text style={styles.loadingSubtitle}>Preparing your workspace</Text>
          <ActivityIndicator size="small" color="#4CAF50" style={styles.loadingSpinner} />
        </View>
      </View>
    );
  }

  // In mobile mode, admin accounts must not pass through — treat as logged out.
  const effectiveUser = isAdminInMobileMode ? null : user;

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      {effectiveUser ? (
        <Stack.Screen name="Main" component={LazyTabNavigator} />
      ) : (
        <Stack.Screen name="Login" component={LazyLoginScreen} />
      )}
    </Stack.Navigator>
  );
}


const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f3f7f2",
    padding: 24,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 30,
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe7df",
  },
  loadingTitle: {
    marginTop: 18,
    fontSize: 24,
    fontWeight: "800",
    color: "#1f2937",
  },
  loadingSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: "#64748b",
  },
  loadingSpinner: {
    marginTop: 16,
  },
});
