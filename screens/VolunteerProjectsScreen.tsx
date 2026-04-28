import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Text, TouchableOpacity, Alert, Image, ImageSourcePropType, Modal, TextInput, ScrollView, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllVolunteers,
  getProjectsScreenSnapshot,
  getVolunteerProjectMatches,
  requestVolunteerProjectJoin,
  startVolunteerTimeLog,
  endVolunteerTimeLog,
  submitVolunteerTimeOutReport,
  subscribeToStorageChanges,
} from '../models/storage';
import { Project, Volunteer, VolunteerProjectJoinRecord, VolunteerProjectMatch, VolunteerTimeLog } from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { getProjectDisplayStatus, getProjectStatusColor } from '../utils/projectStatus';
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

const FALLBACK_ICON_BY_CATEGORY: Record<Project['category'], keyof typeof MaterialIcons.glyphMap> = {
  Nutrition: 'restaurant',
  Education: 'school',
  Livelihood: 'volunteer-activism',
  Disaster: 'warning',
};

function formatProjectDateRange(startValue?: string, endValue?: string): string {
  const startDate = startValue ? new Date(startValue) : null;
  const endDate = endValue ? new Date(endValue) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return 'Schedule to be announced';
  const startLabel = format(startDate, 'MMM d, yyyy');
  if (!endDate || Number.isNaN(endDate.getTime())) return startLabel;
  const endLabel = format(endDate, 'MMM d, yyyy');
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

export default function VolunteerProjectsScreen() {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [timeLogs, setTimeLogs] = useState<VolunteerTimeLog[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'volunteerProfile', 'timeLogs', 'volunteerJoinRecords']);
      setProjects(snapshot.projects);
      setVolunteerProfile(snapshot.volunteerProfile);
      setTimeLogs(snapshot.timeLogs);
      if (snapshot.volunteerProfile?.id) {
        const matches = await getVolunteerProjectMatches(snapshot.volunteerProfile.id);
        setVolunteerMatches(matches);
      }
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    loadData();
    return subscribeToStorageChanges(['projects', 'volunteerMatches', 'volunteerTimeLogs'], loadData);
  }, [loadData]));

  const handleJoin = async (projectId: string) => {
    if (!user?.id) return;
    try {
      setLoadingProjectId(projectId);
      const match = await requestVolunteerProjectJoin(projectId, user.id);
      setVolunteerMatches(prev => [match, ...prev.filter(m => m.projectId !== projectId)]);
      Alert.alert('Success', 'Join request sent.');
    } catch (e) {
      Alert.alert('Error', getRequestErrorMessage(e));
    } finally {
      setLoadingProjectId(null);
    }
  };

  const renderProject = ({ item }: { item: Project }) => {
    const match = volunteerMatches.find(m => m.projectId === item.id);
    const isJoined = !!match;
    const isPending = match?.status === 'Requested';
    
    return (
      <View style={styles.card}>
        <Image source={PROGRAM_PHOTO_BY_TITLE[item.title] || { uri: item.imageUrl }} style={styles.cardImage} />
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardDate}>{formatProjectDateRange(item.startDate, item.endDate)}</Text>
          <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
          
          <TouchableOpacity 
            style={[styles.button, isJoined && styles.buttonDisabled]} 
            onPress={() => !isJoined && handleJoin(item.id)}
            disabled={isJoined || loadingProjectId === item.id}
          >
            <Text style={styles.buttonText}>
              {isPending ? 'Pending Approval' : isJoined ? 'Joined' : 'Request to Join'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={projects}
        renderItem={renderProject}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  listContent: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 16, overflow: 'hidden', elevation: 2 },
  cardImage: { width: '100%', height: 150 },
  cardContent: { padding: 16 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  cardDate: { fontSize: 14, color: '#666', marginVertical: 4 },
  cardDescription: { fontSize: 14, color: '#444' },
  button: { backgroundColor: '#4CAF50', padding: 12, borderRadius: 8, marginTop: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#ccc' },
  buttonText: { color: '#fff', fontWeight: 'bold' }
});
