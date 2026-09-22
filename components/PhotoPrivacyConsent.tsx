import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  CHILD_PROTECTION_PRIVACY_NOTICE,
  PHOTO_CONSENT_CONFIRMATION,
} from '../utils/photoConsent';

type PhotoPrivacyConsentProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export default function PhotoPrivacyConsent({
  checked,
  onChange,
  disabled = false,
}: PhotoPrivacyConsentProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Child Protection and Privacy Notice</Text>
      <Text style={styles.notice}>{CHILD_PROTECTION_PRIVACY_NOTICE}</Text>
      <TouchableOpacity
        style={styles.confirmationRow}
        onPress={() => onChange(!checked)}
        disabled={disabled}
        activeOpacity={0.8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <MaterialIcons name="check" size={17} color="#fff" /> : null}
        </View>
        <Text style={styles.confirmation}>{PHOTO_CONSENT_CONFIRMATION}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  title: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  notice: {
    color: '#7c2d12',
    fontSize: 11,
    lineHeight: 16,
  },
  confirmationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
    gap: 9,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#c2410c',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#c2410c',
  },
  confirmation: {
    flex: 1,
    color: '#7c2d12',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
});
