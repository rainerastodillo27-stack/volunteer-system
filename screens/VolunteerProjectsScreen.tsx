import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, Text, TouchableOpacity, Alert, Image, ImageSourcePropType, ActivityIndicator } from 'react-native';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProjectsScreenSnapshot,
  getVolunteerProjectMatches,
  requestVolunteerProjectJoin,
  subscribeToStorageChanges,
} from '../models/storage';
import { Project, VolunteerProjectMatch } from '../models/types';
import { getRequestErrorMessage, isAbortLikeError } from '../utils/requestErrors';

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

function formatProjectDateRange(startValue?: string, endValue?: string): string {
  const startDate = startValue ? new Date(startValue) : null;
  const endDate = endValue ? new Date(endValue) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return 'Schedule to be announced';
  const startLabel = format(startDate, 'MMM d, yyyy');
  if (!endDate || Number.isNaN(endDate.getTime())) return startLabel;
  const endLabel = format(endDate, 'MMM d, yyyy');
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

export default function VolunteerProjectsScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    const shouldShowBlockingLoader = !hasLoadedOnceRef.current;
    try {
      if (shouldShowBlockingLoader) {
        setLoading(true);
      }
      const snapshot = await getProjectsScreenSnapshot(user, ['projects', 'volunteerProfile', 'volunteerMatches']);
      console.log('VolunteerProjectsScreen data received:', {
        projectCount: snapshot.projects?.length
      });
      setProjects(snapshot.projects);
      if (Array.isArray(snapshot.volunteerMatches)) {
        setVolunteerMatches(snapshot.volunteerMatches);
      } else if (snapshot.volunteerProfile?.id) {
        const matches = await getVolunteerProjectMatches(snapshot.volunteerProfile.id);
        setVolunteerMatches(matches);
      } else {
        setVolunteerMatches([]);
      }
      hasLoadedOnceRef.current = true;
    } catch (e) {
      if (isAbortLikeError(e)) {
        return;
      }

      console.error('VolunteerProjectsScreen loadData error:', e);
    } finally {
      if (shouldShowBlockingLoader) {
        setLoading(false);
      }
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    void loadData();
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
      Alert.alert('Error', getRequestErrorMessage(e, 'Unable to send join request. Please try again.'));
    } finally {
      setLoadingProjectId(null);
    }
  };
  const matchByProjectId = useMemo(
    () => new Map(volunteerMatches.map(match => [match.projectId, match])),
    [volunteerMatches]
  );

  const renderProject = useCallback(({ item }: { item: Project }) => {
    const match = matchByProjectId.get(item.id);
    const isJoined = !!match;
    const isPending = match?.status === 'Requested';
    
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => (navigation as any).navigate('ProjectDetails', { projectId: item.id })}
      >        <Image source={PROGRAM_PHOTO_BY_TITLE[item.title] || { uri: item.imageUrl }} style={styles.cardImage} />
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
      </TouchableOpacity>
    );
  }, [handleJoin, loadingProjectId, matchByProjectId, navigation]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Loading projects...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={projects}
        renderItem={renderProject}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={styles.centerContent}>
            <Text style={styles.loadingText}>No projects available right now.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  listContent: { padding: 16 },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 10, fontSize: 14, color: '#64748b', fontWeight: '600' },
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
