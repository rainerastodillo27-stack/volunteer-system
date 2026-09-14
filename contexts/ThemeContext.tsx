import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_APP_SETTINGS,
  getAppSettings,
  saveAppSettings,
  subscribeToStorageChanges,
} from '../models/storage';
import type { AppSettings } from '../models/types';

type ThemeContextValue = {
  settings: AppSettings;
  isLoading: boolean;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const storedSettings = await getAppSettings();
        if (!cancelled) {
          setSettings(storedSettings);
        }
      } catch (error) {
        console.warn('[Theme] Unable to load saved app settings:', error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToStorageChanges(['appSettings'], async () => {
      try {
        setSettings(await getAppSettings());
      } catch (error) {
        console.warn('[Theme] Unable to refresh saved app settings:', error);
      }
    });

    return unsubscribe;
  }, []);

  const updateSetting = useCallback(async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> => {
    const previous = settings;
    const next = { ...previous, [key]: value };
    setSettings(next);

    try {
      await saveAppSettings({ [key]: value });
    } catch (error) {
      setSettings(previous);
      throw error;
    }
  }, [settings]);

  const value = useMemo<ThemeContextValue>(() => ({
    settings,
    isLoading,
    updateSetting,
  }), [isLoading, settings, updateSetting]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return context;
}

