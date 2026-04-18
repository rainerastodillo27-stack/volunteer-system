import React from 'react';
import { StyleSheet, View } from 'react-native';

type PhotoMapMarkerProps = {
  accentColor: string;
};

// Renders a plain pin marker for native maps.
export default function PhotoMapMarker({ accentColor }: PhotoMapMarkerProps) {
  return (
    <View style={styles.wrapper}>
      <View style={[styles.bubble, { backgroundColor: accentColor }]}>
        <View style={styles.innerDot} />
      </View>
      <View style={[styles.pointer, { backgroundColor: accentColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  bubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    elevation: 6,
  },
  innerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
  },
  pointer: {
    width: 14,
    height: 14,
    marginTop: -5,
    borderBottomLeftRadius: 3,
    transform: [{ rotate: '45deg' }],
  },
});
