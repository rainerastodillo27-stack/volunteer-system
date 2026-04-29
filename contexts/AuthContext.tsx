import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert } from 'react-native';
import { User } from '../models/types';
import { getStorageItemsFast, setCurrentUser as saveCurrentUser } from '../models/storage';

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  try {
    const { Platform } = require('react-native');
    return Platform?.OS || 'web';
  } catch {
    return 'web';
  }
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
    'volunteerTimeLogs',
    'partnerReports',
  ],
  volunteer: [
    'projects',
    'events',
    'volunteers',
    'volunteerMatches',
    'volunteerTimeLogs',
    'adminPlanningCalendars',
  ],
  partner: [
    'projects',
    'events',
    'partners',
    'partnerProjectApplications',
    'partnerReports',
    'publishedImpactReports',
  ],
} as const satisfies Record<string, string[]>;

async function prefetchForUser(user: User | null): Promise<void> {
  if (!user?.role) {
    return;
  }
  const keys = PREFETCH_KEYS_BY_ROLE[user.role];
  if (!keys) {
    return;
  }
  // Fire-and-forget prefetch: do not wait for completion to avoid blocking auth gate.
  // Cache will be populated in the background for faster first screen load.
  const prefetchStart = Date.now();
  console.time(`[App] Prefetch (${user.role})`);
  void getStorageItemsFast(Array.from(keys)).then(() => {
    console.timeEnd(`[App] Prefetch (${user.role})`);
    console.log(`[App] Prefetch completed in ${Date.now() - prefetchStart}ms`);
  }).catch(error => {
    console.debug(`[App] Background prefetch failed (non-blocking):`, error);
    console.timeEnd(`[App] Prefetch (${user.role})`);
  });
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
    // Always open the portal chooser first for a predictable app entry point.
    // We intentionally clear any persisted session so launch never skips Login.
    setLoading(false);
    setUser(null);

    void saveCurrentUser(null)
      .catch(error => {
        console.error('[App] Error clearing persisted session on launch:', error);
      });

    return () => undefined;
  }, []);

  // Saves the active user in memory and persistent storage after login.
  const login = async (userData: User) => {
    try {
      if (getPlatformOS() === 'web' && userData.role !== 'admin') {
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
