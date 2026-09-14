import "./platformInit";
import React, { useEffect } from 'react';
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, type InitialState } from "@react-navigation/native";
import { Alert, Platform, View, ActivityIndicator } from "react-native";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { GlobalDataProvider, useGlobalData } from "./contexts/GlobalDataContext";
import { AppThemeProvider } from "./contexts/ThemeContext";
import StackNavigator from "./navigation/StackNavigator";
import ErrorBoundary from './components/ErrorBoundary';
import InAppNotificationBanner from './components/InAppNotificationBanner';
import SplashScreen from './components/SplashScreen';
import { navigationRef } from './navigation/navigationRef';
import { useNunitoFont } from './utils/fonts';
import * as ExpSplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import SystemAlertHost, { showSystemAlert, showSystemPrompt } from './components/SystemAlertModal';
import {
  clearPersistedNavigationState,
  getPersistedNavigationState,
  savePersistedNavigationState,
} from './utils/navigationPersistence';

// React Native Web implements Alert.alert with the blocking browser
// window.alert API. Route the existing app-wide calls to our non-blocking,
// app-owned modal instead. The host queues calls until the root is mounted.
try {
  (Alert as any).alert = showSystemAlert;
  (Alert as any).prompt = showSystemPrompt;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const browserWindow = window as Window & { __nvcSystemAlertPatched?: boolean };
    if (!browserWindow.__nvcSystemAlertPatched) {
      browserWindow.alert = (message?: string) => {
        const text = String(message ?? '');
        const [title, ...messageParts] = text.split('\n\n');
        showSystemAlert(title || 'Notice', messageParts.join('\n\n'));
      };
      browserWindow.__nvcSystemAlertPatched = true;
    }
  }
} catch {
  // Keep startup resilient on platforms that expose Alert as read-only.
}

// Must be called at the root level so Google OAuth redirects are caught globally
WebBrowser.maybeCompleteAuthSession();

// Keep the splash screen visible while fonts load
ExpSplashScreen.preventAutoHideAsync().catch(() => {});

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
    'Nunito, sans-serif';

  // React Native Web's Text primitive includes a `System` font shorthand in
  // its own style. Text/TextInput are patched in platformInit.ts so Nunito is
  // the default while explicit icon font families remain intact.
  const globalFontStyle = document.createElement('style');
  globalFontStyle.textContent = `
    html, body, #root,
    body input,
    body textarea,
    body button,
    body select,
    body option {
      font-family: 'Nunito', sans-serif !important;
    }
  `;
  document.head.appendChild(globalFontStyle);

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
      body > div:not(#root) > div {
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

      /* React Native Web places the actual modal content several levels
         below the portal wrapper. The role=dialog element has its own
         full-viewport fixed styles when active, so constrain it too.
         Without this rule an edit form expands across the desktop browser
         even when the app is running in mobile mode. */
      body > div:not(#root):has([role="dialog"]) [role="dialog"] {
        pointer-events: auto !important;
        position: fixed !important;
        width: 430px !important;
        max-width: 100vw !important;
        height: 100% !important;
        max-height: 932px !important;
        left: 50% !important;
        top: 50% !important;
        right: auto !important;
        bottom: auto !important;
        transform: translate(-50%, -50%) !important;
        border-radius: 24px !important;
        overflow: hidden !important;
      }

      /* ModalContent and its inner container both add full-screen fixed
         styles. These selectors also cover inactive modals, which no longer
         expose role=dialog while a confirmation modal is on top. */
      body > div:not(#root) > div > div > div,
      body > div:not(#root) > div > div > div > div {
        position: relative !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        inset: auto !important;
      }

      /* Enable pointer events normally for descendants of active dialogs. */
      body > div:not(#root):has([role="dialog"]) div {
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);
  }
}

// Inner component that uses global data to show splash screen
function AppContent() {
  const { isLoading, loadingProgress, isInitialized } = useGlobalData();
  const { user, loading: authLoading } = useAuth();
  const [forceShowApp, setForceShowApp] = React.useState(false);
  const [initialNavigationState, setInitialNavigationState] = React.useState<InitialState | undefined>();
  const [navigationStateReady, setNavigationStateReady] = React.useState(false);
  const [navigationStateOwner, setNavigationStateOwner] = React.useState<string | null>(null);
  const lastAuthenticatedUserRef = React.useRef<typeof user>(null);
  const currentNavigationStateOwner = user ? `${user.role}:${user.id}` : 'logged-out';

  // NavigationContainer only consumes initialState on its first mount. Load
  // the account-specific state after auth restoration and mount navigation
  // once so refresh can restore nested tabs/details as well as the root stack.
  React.useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;
    setNavigationStateReady(false);

    const restoreNavigationState = async () => {
      if (!user) {
        setInitialNavigationState(undefined);
        setNavigationStateOwner('logged-out');
        if (!cancelled) {
          setNavigationStateReady(true);
        }
        return;
      }

      const savedState = await getPersistedNavigationState(user);
      if (cancelled) {
        return;
      }

      setInitialNavigationState(savedState as InitialState | undefined);
      setNavigationStateReady(true);
      setNavigationStateOwner(`${user.role}:${user.id}`);
      lastAuthenticatedUserRef.current = user;
    };

    void restoreNavigationState();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, user?.role]);

  // An explicit logout should not reopen the old authenticated screen after
  // the next login. The session itself is cleared by AuthContext.
  React.useEffect(() => {
    if (authLoading || user || !lastAuthenticatedUserRef.current) {
      return;
    }

    const previousUser = lastAuthenticatedUserRef.current;
    lastAuthenticatedUserRef.current = null;
    void clearPersistedNavigationState(previousUser);
  }, [authLoading, user]);

  // Fallback: force show app after 10 seconds if still loading
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      if (isLoading || !isInitialized) {
        console.warn('⚠️ Forcing app display after 10s timeout');
        setForceShowApp(true);
      }
    }, 10000);

    return () => clearTimeout(timeout);
  }, [isLoading, isInitialized]);

  // Show splash screen during initial data load (unless forced)
  const isNavigationStateReadyForCurrentUser =
    navigationStateReady && navigationStateOwner === currentNavigationStateOwner;

  if ((isLoading || !isInitialized || authLoading || !isNavigationStateReadyForCurrentUser) && !forceShowApp) {
    return (
      <SplashScreen 
        progress={loadingProgress}
        message={loadingProgress < 33 ? 'Loading projects...' : loadingProgress < 66 ? 'Loading volunteers...' : 'Almost ready...'}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer
        ref={navigationRef}
        initialState={initialNavigationState}
        onStateChange={state => {
          // Never save the Login route during logout. Otherwise a navigation
          // update that races the logout effect could restore stale state.
          if (!user || !state) {
            return;
          }
          lastAuthenticatedUserRef.current = user;
          void savePersistedNavigationState(user, state);
        }}
      >
        <StackNavigator />
      </NavigationContainer>
      <InAppNotificationBanner />
    </View>
  );
}

// Bootstraps the root providers and navigation tree for the mobile and web app.
export default function App() {
  const fontsLoaded = useNunitoFont();

  useEffect(() => {
    if (fontsLoaded) {
      ExpSplashScreen.hideAsync().catch(() => {});
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
        <AppThemeProvider>
          <GlobalDataProvider>
            <SystemAlertHost />
            <ErrorBoundary>
              <AppContent />
            </ErrorBoundary>
          </GlobalDataProvider>
        </AppThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}


