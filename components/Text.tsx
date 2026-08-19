import React, { ReactNode } from 'react';
import { Text as RNText, TextProps, Platform, StyleSheet } from 'react-native';
import { GLOBAL_FONT_FAMILY, FONT_WEIGHTS } from '../utils/fonts';

interface NunitoTextProps extends TextProps {
  children: ReactNode;
  weight?: keyof typeof FONT_WEIGHTS;
}

/**
 * Custom Text component that applies Nunito font by default
 * Use this instead of React Native's Text for consistent font styling
 */
export const Text: React.FC<NunitoTextProps> = ({
  weight = 'normal',
  style,
  children,
  ...props
}) => {
  const fontStyle = StyleSheet.create({
    text: {
      fontFamily: GLOBAL_FONT_FAMILY,
      fontWeight: FONT_WEIGHTS[weight] as any,
    },
  });

  return (
    <RNText
      {...props}
      style={[fontStyle.text, style]}
    >
      {children}
    </RNText>
  );
};

export default Text;
