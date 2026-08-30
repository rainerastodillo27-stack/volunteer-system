import "./platformInit";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { Platform, View, ActivityIndicator } from "react-native";
import { AuthProvider } from "./contexts/AuthContext";
import StackNavigator from "./navigation/StackNavigator";
import ErrorBoundary from './components/ErrorBoundary';
import InAppNotificationBanner from './components/InAppNotificationBanner';
import { navigationRef } from './navigation/navigationRef';
import { useNunitoFont } from './utils/fonts';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';

// Must be called at the root level so Google OAuth redirects are caught globally
WebBrowser.maybeCompleteAuthSession();

// Keep the splash screen visible while fonts load
SplashScreen.preventAutoHideAsync().catch(() => {});

// Detect ?mode=mobile on web at module level so it stays stable across renders.
const isMobileModeOnWeb = (() => {
  if (Platform.OS !== 'web') return false;
  try {
    if (typeof window !== 'undefined' && window?.location?.search) {
      return new URLSearchParams(window.location.search).get('mode') === 'mobile';
    }
  } catch {}
  return false;
})();


// Add Google Fonts for web only
if (typeof document !== "undefined") {
  const link = document.createElement("link");
  link.href =
    "https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700;800&display=swap";
  link.rel = "stylesheet";
  document.head.appendChild(link);

  // Apply Nunito globally to the body for web
  document.body.style.fontFamily =
    'Nunito, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // When running in ?mode=mobile, inject a <style> tag that constrains the
  // entire app AND all modal portals to a phone-sized frame.  React Native
  // Web renders modals as portal <div>s directly on <body>, so a React View
  // wrapper alone cannot contain them — CSS is the only reliable approach.
  if (isMobileModeOnWeb) {
    const style = document.createElement("style");
    style.textContent = `
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        height: 100% !important;
        overflow: hidden !important;
        background-color: #1e293b !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      /* The Expo/React root container — constrain to phone dimensions */
      #root {
        width: 430px !important;
        max-width: 100% !important;
        height: 100% !important;
        max-height: 932px !important;
        background: #ffffff !important;
        border-radius: 24px !important;
        box-shadow: 0 8px 60px rgba(0, 0, 0, 0.45) !important;
        position: relative !important;
      }

      /* Modal portals — React Native Web attaches them as direct <div>
         children of <body>, outside #root. To prevent empty/inactive
         portals from blocking interactions on the main app, we only target
         portals containing active dialogs and make them click-through,
         allowing pointer events only on their actual modal children. */
      body > div:not(#root):has([role="dialog"]) {
        pointer-events: none !important;
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 9999 !important;
      }

      /* The direct child of the portal (the modal wrapper) is also kept
         click-through, but we constrain it to the phone frame and center
         it perfectly over the main app. */
      body > div:not(#root):has([role="dialog"]) > div {
        pointer-events: none !important;
        position: fixed !important;
        width: 430px !important;
        max-width: 100vw !important;
        height: 100% !important;
        max-height: 932px !important;
        left: 50% !important;
        top: 50% !important;
        transform: translate(-50%, -50%) !important;
        border-radius: 24px !important;
        overflow: hidden !important;
      }

      /* Enable pointer events normally for descendants of active dialogs. */
      body > div:not(#root):has([role="dialog"]) div {
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);
  }
}

// Bootstraps the root providers and navigation tree for the mobile and web app.
export default function App() {
  const fontsLoaded = useNunitoFont();

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  // Show loading screen while fonts are loading on mobile
  if (!fontsLoaded && Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#15803d" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ErrorBoundary>
          <NavigationContainer ref={navigationRef}>
            <StackNavigator />
            <InAppNotificationBanner />
          </NavigationContainer>
        </ErrorBoundary>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

