import React, { useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, Text, TouchableOpacity, Alert, Image, ImageSourcePropType, Modal, TextInput, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
} from '../models/storage';
import { Project, PartnerProjectApplication } from '../models/types';
import { getRequestErrorMessage } from '../utils/requestErrors';

const PROGRAM_PHOTO_BY_TITLE: Record<string, ImageSourcePropType> = {
  'Farm to Fork Program': require('../assets/programs/farm-to-fork.jpg'),
  'Mingo for Nutritional Support': require('../assets/programs/nutrition.jpg'),
  'Mingo for Emergency Relief': require('../assets/programs/mingo-relief.jpg'),
  LoveBags: require('../assets/programs/lovebags.jpg'),
  'School Support': require('../assets/programs/school-support.jpg'),
  'Artisans of Hope': require('../assets/programs/artisans-of-hope.jpg'),
  'Project Joseph': require('../assets/programs/project-joseph.jpg'),
  'Growing Hope': require('../assets/programs/growing-hope.jpg'),
  'Peter Project': require('../assets/programs/peter-project.jpg'),
};

export default function PartnerProjectsScreen() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'partnerProjectApplications']);
      setProjects(snapshot.projects);
      setPartnerApplications(snapshot.partnerProjectApplications);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    loadData();
    return subscribeToStorageChanges(['projects', 'partnerProjectApplications'], loadData);
  }, [loadData]));

  // Filter approved projects (partner has approved application for them)
  const approvedProjects = projects.filter(project => {
    const application = partnerApplications.find(a => a.projectId === project.id);
    return application?.status === 'Approved';
  });

  // Filter template programs (project IDs starting with 'program:')
  const templatePrograms = projects.filter(project => project.id.startsWith('program:'));

  const renderApprovedProject = ({ item }: { item: Project }) => {
    const application = partnerApplications.find(a => a.projectId === item.id);
    
    return (
      <View style={styles.card}>
        <Image source={PROGRAM_PHOTO_BY_TITLE[item.title] || { uri: item.imageUrl }} style={styles.cardImage} />
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
          <View style={styles.statusRow}>
            <Text style={styles.approvedBadge}>✓ Approved</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderTemplateProgram = ({ item }: { item: Project }) => {
    const application = partnerApplications.find(a => a.projectId === item.id);
    const hasProposed = !!application;
    
    return (
      <View style={styles.card}>
        <Image source={PROGRAM_PHOTO_BY_TITLE[item.title] || { uri: item.imageUrl }} style={styles.cardImage} />
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
          <TouchableOpacity 
            style={[styles.button, hasProposed && styles.buttonDisabled]} 
            onPress={() => !hasProposed && Alert.alert('Propose', 'Proposal flow initiated')}
            disabled={hasProposed}
          >
            <Text style={styles.buttonText}>
              {hasProposed ? `Status: ${application?.status || 'Pending'}` : 'Propose Program'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={approvedProjects.length > 0 ? 
          [
            { type: 'header', title: 'Approved Projects' },
            ...approvedProjects.map(p => ({ type: 'approved', project: p })),
            { type: 'header', title: 'Available Programs' },
            ...templatePrograms.map(p => ({ type: 'program', project: p }))
          ] : 
          [
            { type: 'header', title: 'Available Programs' },
            ...templatePrograms.map(p => ({ type: 'program', project: p }))
          ]
        }
        renderItem={(({ item }: any) => {
          if (item.type === 'header') {
            return (
              <Text style={styles.sectionHeader}>{item.title}</Text>
            );
          }
          if (item.type === 'approved') {
            return renderApprovedProject({ item: item.project });
          }
          return renderTemplateProgram({ item: item.project });
        })}
        keyExtractor={(item, index) => {
          if (item.type === 'header') return `header-${item.title}`;
          return item.project.id;
        }}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  listContent: { padding: 16 },
  sectionHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  card: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 16, overflow: 'hidden', elevation: 2 },
  cardImage: { width: '100%', height: 150 },
  cardContent: { padding: 16 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  cardDescription: { fontSize: 14, color: '#444', marginTop: 4 },
  statusRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center' },
  approvedBadge: {
    backgroundColor: '#4CAF50',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    fontWeight: 'bold',
    fontSize: 12,
  },
  button: { backgroundColor: '#4CAF50', padding: 12, borderRadius: 8, marginTop: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#81c784' },
  buttonText: { color: '#fff', fontWeight: 'bold' }
});
