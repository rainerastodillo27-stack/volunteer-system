import { StyleSheet, Platform } from 'react-native';
import { GLOBAL_FONT_FAMILY, FONT_WEIGHTS } from './fonts';

/**
 * Global text styles using Nunito font family
 * Use these throughout your app for consistent typography
 */
export const globalTextStyles = StyleSheet.create({
  // Base text styles
  text: {
    fontFamily: GLOBAL_FONT_FAMILY,
    fontWeight: Platform.OS === 'web' ? '400' : undefined,
  },
  textLight: {
    fontFamily: GLOBAL_FONT_FAMILY,
    fontWeight: '300',
  },
  textRegular: {
    fontFamily: GLOBAL_FONT_FAMILY,
    fontWeight: '400',
  },
  textSemiBold: {
    fontFamily: GLOBAL_FONT_FAMILY,
    fontWeight: '600',
  },
  textBold: {
    fontFamily: GLOBAL_FONT_FAMILY,
    fontWeight: '700',
  },
  textExtraBold: {
    fontFamily: GLOBAL_FONT_FAMILY,
    fontWeight: '800',
  },
});

/**
 * Helper to get font style based on weight
 */
export function getFontStyle(weight: 'light' | 'normal' | 'semibold' | 'bold' | 'extrabold' = 'normal') {
  return {
    fontFamily: GLOBAL_FONT_FAMILY,
    fontWeight: {
      light: '300',
      normal: '400',
      semibold: '600',
      bold: '700',
      extrabold: '800',
    }[weight] as any,
  };
}

/**
 * Apply Nunito font to any text component
 * Example: <Text style={withNunito({ fontSize: 16, color: '#000' })}>Hello</Text>
 */
export function withNunito(styles?: any) {
  return {
    ...globalTextStyles.text,
    ...styles,
  };
}
