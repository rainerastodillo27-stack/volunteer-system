import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

type InlineLoadErrorProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export default function InlineLoadError({
  title = 'Database Unavailable',
  message,
  onRetry,
}: InlineLoadErrorProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="error-outline" size={20} color="#991b1b" />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <MaterialIcons name="refresh" size={16} color="#991b1b" />
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991b1b',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    color: '#7f1d1d',
  },
  retryButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fee2e2',
  },
  retryText: {
    color: '#991b1b',
    fontSize: 12,
    fontWeight: '700',
  },
});
