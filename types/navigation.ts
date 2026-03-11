import { RootStackParamList } from '../navigation/StackNavigator';
import { TabParamList } from '../navigation/TabNavigator';

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export type { RootStackParamList, TabParamList };
