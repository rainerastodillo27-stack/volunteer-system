import React from 'react';
import { StyleSheet, View } from 'react-native';

type AppLogoProps = {
  width?: number;
};

// Draws the Volcre logo using layered shapes so it works without image assets.
export default function AppLogo({ width = 96 }: AppLogoProps) {
  const height = Math.round(width * 0.71);
  const topLeafWidth = Math.round(width * 0.37);
  const topLeafHeight = Math.round(height * 0.43);
  const bottomLeafWidth = Math.round(width * 0.24);
  const bottomLeafHeight = Math.round(height * 0.24);
  const topInset = Math.round(width * 0.04);
  const bottomInset = Math.round(width * 0.23);
  const lowerOffset = Math.round(height * 0.06);

  return (
    <View style={[styles.container, { width, height }]}>
      <View
        style={[
          styles.leaf,
          styles.topLeft,
          {
            width: topLeafWidth,
            height: topLeafHeight,
            borderRadius: topLeafHeight,
            left: topInset,
          },
        ]}
      />
      <View
        style={[
          styles.leaf,
          styles.topRight,
          {
            width: topLeafWidth,
            height: topLeafHeight,
            borderRadius: topLeafHeight,
            right: topInset,
          },
        ]}
      />
      <View
        style={[
          styles.leaf,
          styles.bottomLeft,
          {
            width: bottomLeafWidth,
            height: bottomLeafHeight,
            borderRadius: bottomLeafHeight,
            left: bottomInset,
            bottom: lowerOffset,
          },
        ]}
      />
      <View
        style={[
          styles.leaf,
          styles.bottomRight,
          {
            width: bottomLeafWidth,
            height: bottomLeafHeight,
            borderRadius: bottomLeafHeight,
            right: bottomInset,
            bottom: lowerOffset,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'visible',
  },
  leaf: {
    position: 'absolute',
  },
  topLeft: {
    top: 0,
    backgroundColor: '#0f9d4d',
    transform: [{ rotate: '22deg' }],
  },
  topRight: {
    top: 0,
    backgroundColor: '#3fbc46',
    transform: [{ rotate: '-22deg' }],
  },
  bottomLeft: {
    backgroundColor: '#d4e93c',
    transform: [{ rotate: '-12deg' }],
  },
  bottomRight: {
    backgroundColor: '#93cd3c',
    transform: [{ rotate: '12deg' }],
  },
});
