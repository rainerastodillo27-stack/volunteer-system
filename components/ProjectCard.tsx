import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';

type ProjectCardProps = {
  id: string;
  title: string;
  status: string;
  volunteers: number;
  description: string;
};

export default function ProjectCard({
  id,
  title,
  status,
  volunteers,
  description,
}: ProjectCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Ongoing':
        return '#FFA500';
      case 'Completed':
        return '#4CAF50';
      case 'Planning':
        return '#2196F3';
      default:
        return '#999';
    }
  };

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
              { backgroundColor: getStatusColor(status) },
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
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
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
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  volunteers: {
    fontSize: 12,
    color: '#999',
  },
});
