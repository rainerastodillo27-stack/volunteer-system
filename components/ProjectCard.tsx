import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { getProjectStatusColor } from '../utils/projectStatus';

type ProjectCardProps = {
  id: string;
  title: string;
  status: string;
  volunteers: number;
  description: string;
};

// Displays a compact project summary card used in list-based views.
export default function ProjectCard({
  id,
  title,
  status,
  volunteers,
  description,
}: ProjectCardProps) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => Alert.alert(title, description)}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>

      <View style={styles.footer}>
        <View style={styles.statusBadge}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: getProjectStatusColor(status) },
            ]}
          />
          <Text style={styles.status}>{status}</Text>
        </View>
        <Text style={styles.volunteers}>{volunteers} volunteers</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.86)',
    borderLeftWidth: 4,
    borderLeftColor: '#16a34a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 3,
    color: '#333',
  },
  description: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  status: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
  },
  volunteers: {
    fontSize: 11,
    color: '#999',
  },
});
