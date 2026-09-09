import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../models/types';

const NAVIGATION_STATE_PREFIX = 'volcre:navigation-state:v1:';

type NavigationUser = Pick<User, 'id' | 'role'>;

function getNavigationStateKey(user: NavigationUser): string {
  return `${NAVIGATION_STATE_PREFIX}${encodeURIComponent(user.role)}:${encodeURIComponent(user.id)}`;
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/** Restores the last React Navigation state for the signed-in account. */
export async function getPersistedNavigationState(user: NavigationUser): Promise<unknown | null> {
  try {
    const browserStorage = getBrowserStorage();
    const raw = browserStorage
      ? browserStorage.getItem(getNavigationStateKey(user))
      : await AsyncStorage.getItem(getNavigationStateKey(user));

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { routes?: unknown }).routes)) {
      return null;
    }

    return parsed;
  } catch {
    // A corrupted or unavailable cache should never prevent the app from opening.
    return null;
  }
}

/** Saves the current React Navigation state for the signed-in account. */
export async function savePersistedNavigationState(
  user: NavigationUser,
  state: unknown,
): Promise<void> {
  try {
    if (!state || typeof state !== 'object') {
      return;
    }

    const serialized = JSON.stringify(state);
    const browserStorage = getBrowserStorage();
    if (browserStorage) {
      browserStorage.setItem(getNavigationStateKey(user), serialized);
    } else {
      await AsyncStorage.setItem(getNavigationStateKey(user), serialized);
    }
  } catch {
    // Navigation persistence is best-effort and must not interrupt navigation.
  }
}

/** Clears the saved location when the account explicitly logs out. */
export async function clearPersistedNavigationState(user: NavigationUser): Promise<void> {
  try {
    const browserStorage = getBrowserStorage();
    if (browserStorage) {
      browserStorage.removeItem(getNavigationStateKey(user));
    } else {
      await AsyncStorage.removeItem(getNavigationStateKey(user));
    }
  } catch {
    // Ignore unavailable storage during logout.
  }
}
