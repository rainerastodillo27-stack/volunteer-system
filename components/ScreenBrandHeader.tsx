import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AppLogo from './AppLogo';

type ScreenBrandHeaderProps = {
  title: string;
};

// Shows the shared branded header used above most top-level screens.
export default function ScreenBrandHeader({ title }: ScreenBrandHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.brandBlock}>
        <View style={styles.logoWrap}>
          <AppLogo width={78} />
        </View>
        <View style={styles.copyBlock}>
          <Text style={styles.brandName}>NVC CONNECT</Text>
          <Text style={styles.screenTitle}>{title}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  brandBlock: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  logoWrap: {
    width: 108,
    height: 72,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  copyBlock: {
    flex: 1,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.3,
  },
  screenTitle: {
    marginTop: 2,
    fontSize: 13,
    color: '#4b5563',
    fontWeight: '600',
  },
});
