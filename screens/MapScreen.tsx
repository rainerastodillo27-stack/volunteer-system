import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';

export default function MapScreen() {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  const locations = [
    { id: '1', name: 'Community Center - Downtown', volunteers: 8, active: true },
    { id: '2', name: 'Park Conservation Area', volunteers: 15, active: true },
    { id: '3', name: 'Shelter Support Center', volunteers: 12, active: true },
    { id: '4', name: 'School Renovation Site', volunteers: 20, active: false },
  ];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Volunteer Locations</Text>

      {locations.map((location) => (
        <TouchableOpacity
          key={location.id}
          style={[
            styles.card,
            selectedLocation === location.id && styles.selectedCard,
          ]}
          onPress={() => {
            setSelectedLocation(location.id);
            Alert.alert(
              'Location: ' + location.name,
              `Volunteers: ${location.volunteers}\nStatus: ${location.active ? 'Active' : 'Inactive'}`
            );
          }}
        >
          <Text style={styles.locationName}>{location.name}</Text>
          <View style={styles.info}>
            <Text>Volunteers: {location.volunteers}</Text>
            <Text style={[styles.status, { color: location.active ? '#4CAF50' : '#999' }]}>
              {location.active ? '● Active' : '● Inactive'}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 15,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  selectedCard: {
    borderLeftColor: '#2196F3',
    backgroundColor: '#f0f8ff',
  },
  locationName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  info: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  status: {
    fontWeight: 'bold',
  },
});
