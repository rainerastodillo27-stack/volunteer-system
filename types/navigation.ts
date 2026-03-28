import { RootStackParamList } from '../navigation/StackNavigator';
import { TabParamList } from '../navigation/TabNavigator';

// Extends React Navigation's global route typing with this app's stack params.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

// Re-exports navigation param types for shared use across screens and helpers.
export type { RootStackParamList, TabParamList };
