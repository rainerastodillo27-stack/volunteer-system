import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { Project } from '../models/types';
import { getInitialProjectRegion, getProjectMarkerColor } from '../utils/projectMap';

type VolunteerImpactMapProps = {
  projects: Project[];
};

// Displays a native map of projects that the volunteer has participated in.
export default function VolunteerImpactMap({ projects }: VolunteerImpactMapProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(projects[0] || null);

  useEffect(() => {
    setSelectedProject(projects[0] || null);
  }, [projects]);

  if (projects.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <MaterialIcons name="place" size={18} color="#166534" />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Personal Impact Map</Text>
          <Text style={styles.subtitle}>Pinned places where you completed volunteer work.</Text>
        </View>
      </View>

      <View style={styles.mapShell}>
        <MapView
          style={styles.map}
          initialRegion={getInitialProjectRegion(projects) as Region}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          showsCompass
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
        >
          {projects.map(project => (
            <Marker
              key={project.id}
              coordinate={{
                latitude: project.location.latitude,
                longitude: project.location.longitude,
              }}
              pinColor={getProjectMarkerColor(project)}
              title={project.title}
              description={project.location.address}
              onPress={() => setSelectedProject(project)}
            />
          ))}
        </MapView>
      </View>

      {selectedProject && (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedProject.title}</Text>
          <Text style={styles.detailMeta}>
            {`${selectedProject.isEvent ? 'Event' : 'Program'} | ${selectedProject.category}`}
          </Text>
          <Text style={styles.detailAddress}>{selectedProject.location.address}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    width: '100%',
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  mapShell: {
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#e0f2fe',
  },
  map: {
    height: 280,
    width: '100%',
  },
  detailCard: {
    marginTop: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  detailAddress: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
});
