import { Platform } from 'react-native';
import { useFonts } from 'expo-font';

/**
 * Load the Nunito font family used throughout the app.
 */
export function useNunitoFont() {
  const [fontsLoaded] = useFonts({
    Nunito: require('../assets/fonts/Nunito-Regular.ttf'),
    'Nunito-Light': require('../assets/fonts/Nunito-Light.ttf'),
    'Nunito-SemiBold': require('../assets/fonts/Nunito-SemiBold.ttf'),
    'Nunito-Bold': require('../assets/fonts/Nunito-Bold.ttf'),
    'Nunito-ExtraBold': require('../assets/fonts/Nunito-ExtraBold.ttf'),
  });

  return Platform.OS === 'web' || fontsLoaded;
}

/**
 * Global default font family to use throughout the app
 */
export const GLOBAL_FONT_FAMILY = Platform.select({
  web: "'Nunito', sans-serif",
  default: 'Nunito',
});

/**
 * Font weight mappings for Nunito font
 */
export const FONT_WEIGHTS = {
  light: Platform.select({ web: '300', default: '300' }),
  normal: Platform.select({ web: '400', default: '400' }),
  semibold: Platform.select({ web: '600', default: '600' }),
  bold: Platform.select({ web: '700', default: '700' }),
  extrabold: Platform.select({ web: '800', default: '800' }),
} as const;
