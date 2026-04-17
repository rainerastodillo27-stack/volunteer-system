import React from 'react';
import { Image, ImageSourcePropType, StyleSheet, Text, View } from 'react-native';

type PhotoMapMarkerProps = {
  imageSource?: ImageSourcePropType;
  initials: string;
  accentColor: string;
};

// Renders a circular image marker with a pointed pin tail for native maps.
export default function PhotoMapMarker({
  imageSource,
  initials,
  accentColor,
}: PhotoMapMarkerProps) {
  return (
    <View style={styles.wrapper}>
      <View style={[styles.bubble, { borderColor: accentColor }]}>
        {imageSource ? (
          <Image source={imageSource} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.fallback, { backgroundColor: accentColor }]}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
        )}
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
    borderWidth: 3,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    elevation: 6,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  pointer: {
    width: 14,
    height: 14,
    marginTop: -5,
    borderBottomLeftRadius: 3,
    transform: [{ rotate: '45deg' }],
  },
});
