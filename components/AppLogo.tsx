import React from 'react';
import { StyleSheet, View } from 'react-native';

type AppLogoProps = {
  width?: number;
};

export default function AppLogo({ width = 96 }: AppLogoProps) {
  const height = Math.round(width * 0.72);
  const topLeafWidth = Math.round(width * 0.4);
  const topLeafHeight = Math.round(height * 0.44);
  const bottomLeafWidth = Math.round(width * 0.3);
  const bottomLeafHeight = Math.round(height * 0.3);

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
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  leaf: {
    position: 'absolute',
  },
  topLeft: {
    top: 0,
    left: 2,
    backgroundColor: '#0f9d4d',
    transform: [{ rotate: '26deg' }],
  },
  topRight: {
    top: 0,
    right: 2,
    backgroundColor: '#3fbc46',
    transform: [{ rotate: '-26deg' }],
  },
  bottomLeft: {
    left: 14,
    bottom: 0,
    backgroundColor: '#d4e93c',
    transform: [{ rotate: '-18deg' }],
  },
  bottomRight: {
    right: 14,
    bottom: 0,
    backgroundColor: '#93cd3c',
    transform: [{ rotate: '18deg' }],
  },
});
