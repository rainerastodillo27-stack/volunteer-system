import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert } from 'react-native';
import { User } from '../models/types';
import {
  getProjectsScreenSnapshot,
  getStorageItemsFast,
  setCurrentUser as saveCurrentUser,
  getCurrentUser,
} from '../models/storage';

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
}

/**
 * Returns true when running in a real web browser AND the user has NOT
 * requested mobile-emulation mode via the `?mode=mobile` query param.
 *
 * When ?mode=mobile is present, volunteer and partner accounts are allowed
 * to log in and get their full mobile UI (VolunteerNavigator / PartnerNavigator).
 */
function getIsWeb(): boolean {
  if (getPlatformOS() !== 'web') return false;
  try {
    if (typeof window !== 'undefined' && window?.location?.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'mobile') return false;
    }
  } catch {
    // ignore
  }
  return true;
}

const PREFETCH_KEYS_BY_ROLE = {
  admin: [
    'users',
    'projects',
    'events',
    'partners',
    'volunteers',
    'statusUpdates',
    'volunteerMatches',
    'volunteerProjectJoins',
    'adminPlanningCalendars',
    'programs',
  ],
  volunteer: [
    'projects',
    'events',
    'programs',
    'volunteers',
    'volunteerMatches',
    'adminPlanningCalendars',
  ],
  partner: [
    'projects',
    'events',
    'partners',
    'programs',
  ],
} as const satisfies Record<string, string[]>;

async function prefetchForUser(user: User | null): Promise<void> {
  if (!user?.role) {
    return;
  }
  
  const platform = getPlatformOS();
  // Warm all role-specific keys in the background so the first screen loads from cache.
  // On web, prefetch the full admin key set since the admin dashboard is the only web screen.
  // On mobile, also warm the lightweight projects snapshot for the first screen.
  const keys = Array.from(PREFETCH_KEYS_BY_ROLE[user.role] ?? []);

  if (keys.length > 0) {
    // Fire-and-forget prefetch: do not wait for completion to avoid blocking auth gate.
    // Cache will be populated in the background for faster first screen load.
    void getStorageItemsFast(Array.from(keys)).catch(error => {
      console.debug(`[App] Background prefetch failed (non-blocking):`, error);
    });
  }

  if (platform !== 'web' && user.role !== 'admin') {
    void getProjectsScreenSnapshot(user, ['projects', 'programs', 'programTracks', 'volunteerProfile']).catch(error => {
      console.debug('[App] Background project snapshot prefetch failed:', error);
    });
  }
  // In ?mode=mobile on web, also prefetch the snapshot for volunteer/partner
  if (platform === 'web' && !getIsWeb() && user.role !== 'admin') {
    void getProjectsScreenSnapshot(user, ['projects', 'programs', 'programTracks', 'volunteerProfile']).catch(error => {
      console.debug('[App] Background project snapshot prefetch failed:', error);
    });
  }
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (user: User) => Promise<void>;
  logout: () => Promise<void>;
  updateUserProfile: (user: User) => Promise<void>;
  isAdmin: boolean;
  isVolunteer: boolean;
  isPartner: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Provides authentication state and session actions to the rest of the app.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore persistent session on mobile for faster startup.
    // We only clear sessions on web (non-mobile-mode) to maintain a predictable
    // entry point for admin tools. In ?mode=mobile, allow session restore.
    const platform = getPlatformOS();
    
    if (platform === 'web' && getIsWeb()) {
      setUser(null);
      setLoading(false);
      void saveCurrentUser(null).catch(() => null);
      return;
    }

    // On mobile, try to restore the last active session.
    const restoreSession = async () => {
      try {
        const savedUser = await getCurrentUser();
        if (savedUser) {
          setUser(savedUser);
          void prefetchForUser(savedUser).catch(() => null);
        }
      } catch (error) {
        console.error('[App] Failed to restore session:', error);
      } finally {
        setLoading(false);
      }
    };

    const startupTimeout = setTimeout(() => {
      setLoading(false);
    }, 800);

    void restoreSession().finally(() => {
      clearTimeout(startupTimeout);
    });
  }, []);

  // Saves the active user in memory and persistent storage after login.
  const login = async (userData: User) => {
    try {
      // Block non-admin logins on normal web mode.
      // In ?mode=mobile, allow volunteer and partner to log in and get their full mobile UI.
      if (getIsWeb() && userData.role !== 'admin') {
        Alert.alert(
          'Access Restricted',
          'Only the admin account can be opened on web. Please use the mobile app for volunteer or partner access.'
        );
        return;
      }

      setUser(userData);
      void saveCurrentUser(userData).catch((error) => {
        console.error('Error persisting current user:', error);
      });
      void prefetchForUser(userData).catch(() => null);
    } catch (error) {
      console.error('Error during login:', error);
      throw error;
    }
  };

  // Clears the active session and restores the previous user if logout fails.
  const logout = async () => {
    const previousUser = user;
    try {
      setUser(null);
      await saveCurrentUser(null);
    } catch (error) {
      setUser(previousUser);
      console.error('Error during logout:', error);
      throw error;
    }
  };

  // Updates the current user profile in both context state and storage.
  const updateUserProfile = async (userData: User) => {
    const previousUser = user;
    try {
      setUser(userData);
      await saveCurrentUser(userData);
    } catch (error) {
      setUser(previousUser);
      console.error('Error updating current user profile:', error);
      throw error;
    }
  };

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    updateUserProfile,
    isAdmin: user?.role === 'admin',
    isVolunteer: user?.role === 'volunteer',
    isPartner: user?.role === 'partner',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Gives components access to the shared authentication context.
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
