import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import AppLogo from "../components/AppLogo";
import LoginScreen from "../screens/LoginScreen";
import TabNavigator from "./TabNavigator";

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Switches between the login flow and the authenticated tab navigator.
export default function StackNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingCard}>
          <AppLogo width={120} />
          <Text style={styles.loadingTitle}>NVC CONNECT</Text>
          <Text style={styles.loadingSubtitle}>Preparing your workspace</Text>
          <ActivityIndicator size="small" color="#4CAF50" style={styles.loadingSpinner} />
        </View>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      {user ? (
        <Stack.Screen name="Main" component={TabNavigator} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
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
