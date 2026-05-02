import "./platformInit";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { AuthProvider } from "./contexts/AuthContext";
import StackNavigator from "./navigation/StackNavigator";
import { useFonts } from "expo-font";
import { ActivityIndicator, View } from "react-native";

// Bootstraps the root providers and navigation tree for the mobile and web app.
export default function App() {
  const [fontsLoaded] = useFonts({
    // Add any custom fonts here if needed
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StackNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
