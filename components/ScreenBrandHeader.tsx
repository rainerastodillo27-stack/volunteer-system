import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AppLogo from './AppLogo';

type ScreenBrandHeaderProps = {
  title: string;
};

// Shows the shared branded header used above most top-level screens.
export default function ScreenBrandHeader({ title }: ScreenBrandHeaderProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < 380;

  return (
    <View style={styles.container}>
      <View style={[styles.brandBlock, isCompact && styles.brandBlockCompact]}>
        <View style={[styles.logoWrap, isCompact && styles.logoWrapCompact]}>
          <AppLogo width={isCompact ? 62 : 78} />
        </View>
        <View style={[styles.copyBlock, isCompact && styles.copyBlockCompact]}>
          <Text style={[styles.brandName, isCompact && styles.brandNameCompact]}>NVC CONNECT</Text>
          <Text style={[styles.screenTitle, isCompact && styles.screenTitleCompact]} numberOfLines={2}>
            {title}
          </Text>
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
  brandBlockCompact: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
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
  logoWrapCompact: {
    width: 86,
    height: 58,
  },
  copyBlock: {
    flex: 1,
  },
  copyBlockCompact: {
    alignItems: 'center',
  },
  brandName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.3,
  },
  brandNameCompact: {
    fontSize: 17,
    textAlign: 'center',
  },
  screenTitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#4b5563',
    fontWeight: '600',
  },
  screenTitleCompact: {
    textAlign: 'center',
    fontSize: 12,
  },
});
