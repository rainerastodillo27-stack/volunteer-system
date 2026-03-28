import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert, Platform } from 'react-native';
import { User } from '../models/types';
import { getCurrentUser, setCurrentUser as saveCurrentUser } from '../models/storage';

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
    // Check if user is already logged in
    // Restores the previously signed-in user from storage when the app launches.
    const checkAuth = async () => {
      try {
        const currentUser = await getCurrentUser();

        // Enforce that only admin accounts stay signed in on web
        if (Platform.OS === 'web' && currentUser && currentUser.role !== 'admin') {
          await saveCurrentUser(null);
          setUser(null);
          if (typeof window !== 'undefined') {
            Alert.alert(
              'Access Restricted',
              'Volunteer and partner accounts can only be opened on mobile. Please sign in with the admin account on web.'
            );
          }
          return;
        }

        if (currentUser) {
          setUser(currentUser);
        }
      } catch (error) {
        console.error('Error checking auth:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Saves the active user in memory and persistent storage after login.
  const login = async (userData: User) => {
    try {
      if (Platform.OS === 'web' && userData.role !== 'admin') {
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
