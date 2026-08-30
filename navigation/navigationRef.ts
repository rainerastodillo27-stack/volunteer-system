import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

export function navigateTo(name: string, params?: Record<string, any>) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}
