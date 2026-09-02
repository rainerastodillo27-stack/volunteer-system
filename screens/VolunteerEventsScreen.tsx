import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  getProjectsScreenSnapshot,
  subscribeToStorageChanges,
  getAllAdminPlanningCalendars,
  getAllAdminPlanningItems,
  saveEvent,
  requestVolunteerProjectJoin,
  getAllVolunteers,
} from '../models/storage';
import { Project, Volunteer, VolunteerProjectMatch, VolunteerProjectJoinRecord, AdminPlanningCalendar, AdminPlanningItem } from '../models/types';
import { getRequestErrorMessage } from '../utils/requestErrors';
import { getActiveProjectJoinCount } from '../utils/projectVolunteers';
import { format } from 'date-fns';

type SortOption = 'date' | 'priority' | 'title';
type FilterCategory = 'All' | 'Nutrition' | 'Education' | 'Livelihood' | 'Disaster';

const getEventImage = (category: string, title: string) => {
  const t = title.toLowerCase();
  if (t.includes('gala') || t.includes('wedding')) {
    return 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=500&auto=format&fit=crop&q=80';
  }
  if (t.includes('market') || t.includes('farm')) {
    return 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=500&auto=format&fit=crop&q=80';
  }
  if (t.includes('party') || t.includes('picnic') || t.includes('block')) {
    return 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=500&auto=format&fit=crop&q=80';
  }
  if (t.includes('concert') || t.includes('post malone') || t.includes('music')) {
    return 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=500&auto=format&fit=crop&q=80';
  }
  if (t.includes('forum') || t.includes('business') || t.includes('conference')) {
    return 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=500&auto=format&fit=crop&q=80';
  }
  if (t.includes('dinner') || t.includes('charity')) {
    return 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=500&auto=format&fit=crop&q=80';
  }
  if (t.includes('comic') || t.includes('culture') || t.includes('expo')) {
    return 'https://images.unsplash.com/photo-1560969184-10fe8719e047?w=500&auto=format&fit=crop&q=80';
  }
  if (t.includes('cheese') || t.includes('food') || t.includes('festival')) {
    return 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500&auto=format&fit=crop&q=80';
  }
  if (category === 'Nutrition') {
    return 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=500&auto=format&fit=crop&q=80';
  }
  if (category === 'Education') {
    return 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=500&auto=format&fit=crop&q=80';
  }
  if (category === 'Livelihood') {
    return 'https://images.unsplash.com/photo-1489659639091-8b687bc4386e?w=500&auto=format&fit=crop&q=80';
  }
  if (category === 'Disaster') {
    return 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=500&auto=format&fit=crop&q=80';
  }
  return 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=500&auto=format&fit=crop&q=80';
};

const convertPlanningItemToProjectEvent = (
  item: AdminPlanningItem,
  calendars: AdminPlanningCalendar[]
): Project => {
  const calendar = calendars.find(c => c.id === item.calendarId);
  const calendarName = calendar?.name || '';
  let category: Project['category'] = 'Nutrition';
  const nameLower = calendarName.toLowerCase();
  if (nameLower.includes('education')) category = 'Education';
  else if (nameLower.includes('livelihood')) category = 'Livelihood';
  else if (nameLower.includes('disaster') || nameLower.includes('relief')) category = 'Disaster';
  else if (nameLower.includes('community')) category = 'Livelihood';
  
  let volunteersNeeded = 20;
  if (item.participantsLabel) {
    const match = item.participantsLabel.match(/(\d+)/);
    if (match) {
      volunteersNeeded = parseInt(match[1], 10);
    }
  }

  return {
    id: item.id,
    title: item.title,
    description: item.description || '',
    partnerId: 'system',
    imageUrl: undefined,
    imageHidden: true,
    programModule: category as any,
    isEvent: true,
    status: 'In Progress',
    category,
    startDate: item.startDate,
    endDate: item.endDate,
    location: {
      latitude: 10.3157,
      longitude: 123.8854,
      address: item.location || 'Bacolod City, Philippines',
    },
    volunteersNeeded,
    volunteers: [],
    joinedUserIds: [],
    skillsNeeded: [],
    communityNeed: '',
    expectedDeliverables: '',
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
    statusUpdates: [],
  };
};

const convertGoogleEventToProjectEvent = (event: any): Project => {
  const title = event.summary || 'Google Calendar Event';
  const description = event.description || '';
  const id = `gcal-${event.id}`;
  
  let category: Project['category'] = 'Nutrition';
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  if (titleLower.includes('education') || descLower.includes('education')) category = 'Education';
  else if (titleLower.includes('livelihood') || descLower.includes('livelihood')) category = 'Livelihood';
  else if (titleLower.includes('disaster') || descLower.includes('disaster') || titleLower.includes('relief') || descLower.includes('relief')) category = 'Disaster';
  else if (titleLower.includes('community') || descLower.includes('community')) category = 'Livelihood';

  const startVal = event.start?.dateTime || event.start?.date || new Date().toISOString();
  const endVal = event.end?.dateTime || event.end?.date || startVal;

  return {
    id,
    title,
    description,
    partnerId: 'system',
    imageUrl: undefined,
    imageHidden: true,
    programModule: category as any,
    isEvent: true,
    status: 'In Progress',
    category,
    startDate: startVal,
    endDate: endVal,
    location: {
      latitude: 10.3157,
      longitude: 123.8854,
      address: event.location || 'Online',
    },
    volunteersNeeded: 20,
    volunteers: [],
    joinedUserIds: [],
    skillsNeeded: [],
    communityNeed: '',
    expectedDeliverables: '',
    createdAt: event.created || new Date().toISOString(),
    updatedAt: event.updated || new Date().toISOString(),
    statusUpdates: [],
  };
};

export default function VolunteerEventsScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const numColumns = width >= 1024 ? 3 : width >= 768 ? 2 : 1;

  const [records, setRecords] = useState<Project[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [joinRecords, setJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [allVolunteersList, setAllVolunteersList] = useState<Volunteer[]>([]);
  const [planningItems, setPlanningItems] = useState<AdminPlanningItem[]>([]);
  const [planningCalendars, setPlanningCalendars] = useState<AdminPlanningCalendar[]>([]);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Sort / Filter states
  const [sortBy, setSortBy] = useState<SortOption>('date');
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('All');
  const [showSortModal, setShowSortModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'applications'>('all');

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [snapshot, calendars, items, volunteersList] = await Promise.all([
        getProjectsScreenSnapshot(user, [
          'projects',
          'volunteerProfile',
          'volunteerMatches',
          'volunteerJoinRecords',
        ]),
        getAllAdminPlanningCalendars(),
        getAllAdminPlanningItems(),
        getAllVolunteers().catch(() => []),
      ]);
      setRecords(snapshot.projects || []);
      setVolunteerProfile(snapshot.volunteerProfile);
      setVolunteerMatches(snapshot.volunteerMatches || []);
      setJoinRecords(snapshot.volunteerJoinRecords || []);
      setAllVolunteersList(volunteersList || []);
      setPlanningCalendars(calendars || []);
      setPlanningItems(items || []);

      // Fetch Google Calendar items
      try {
        const storedId = await AsyncStorage.getItem('gcal_id');
        const storedKey = await AsyncStorage.getItem('gcal_key');
        const calendarId = storedId || 'en.philippines#holiday@group.v.calendar.google.com';
        const apiKey = storedKey || process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_WEB_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_WEB_API_KEY || '';
        
        if (apiKey) {
          const now = new Date();
          const timeMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
          const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();
          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;
          
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            setGoogleEvents(data.items || []);
          } else {
            setGoogleEvents([]);
          }
        }
      } catch (err) {
        console.warn('[VolunteerEventsScreen] Google Calendar fetch error:', err);
        setGoogleEvents([]);
      }
    } catch (error) {
      console.error('[VolunteerEventsScreen] Failed to load events data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return subscribeToStorageChanges(
        ['projects', 'events', 'volunteerMatches', 'volunteerProjectJoins', 'adminPlanningCalendars'],
        loadData
      );
    }, [loadData])
  );

  const handleJoinEvent = async (event: Project) => {
    if (!user?.id) {
      Alert.alert('Error', 'User profile not authenticated');
      return;
    }
    const joinedCount = getActiveProjectJoinCount(event, joinRecords, volunteerMatches, allVolunteersList);
    const totalSlots = Number(event.volunteersNeeded || 0);
    if (totalSlots > 0 && joinedCount >= totalSlots) {
      Alert.alert('Event Full', 'This event has reached its maximum volunteer capacity and is already full.');
      return;
    }
    try {
      setLoadingEventId(event.id);
      if (event.id.startsWith('planner-item-') || event.id.startsWith('gcal-')) {
        await saveEvent(event);
      }
      const match = await requestVolunteerProjectJoin(event.id, user.id);
      setVolunteerMatches(current => [
        match,
        ...current.filter(existing => existing.projectId !== event.id),
      ]);
      Alert.alert('Success', `Successfully requested to join "${event.title}"!`);
      void loadData();
    } catch (err) {
      Alert.alert('Error', getRequestErrorMessage(err, 'Failed to request join event'));
    } finally {
      setLoadingEventId(null);
    }
  };

  const getEventPriority = (event: Project): 'High' | 'Medium' | 'Low' => {
    // Map priority logically based on category
    if (event.category === 'Disaster') return 'High';
    if (event.category === 'Nutrition') return 'High';
    if (event.category === 'Livelihood') return 'Medium';
    return 'Low';
  };

  const getCurrentUserJoinRecord = (event: Project) => {
    const userId = user?.id || '';
    const volunteerId = volunteerProfile?.id || '';
    return joinRecords.find(record =>
      record.projectId === event.id &&
      (record.volunteerUserId === userId || record.volunteerId === volunteerId)
    );
  };

  const getEventStatus = (event: Project) => {
    const currentJoinRecord = getCurrentUserJoinRecord(event);
    const isJoined = currentJoinRecord && (currentJoinRecord.participationStatus || 'Active') === 'Active';
    const isCompleted = currentJoinRecord && currentJoinRecord.participationStatus === 'Completed';

    const match = volunteerMatches.find(m => m.projectId === event.id);
    
    if (match?.status === 'Requested') return { label: 'Pending', color: '#C97F1F', joinable: false };
    if (isCompleted || match?.status === 'Completed') return { label: 'Completed', color: '#5B564C', joinable: false };
    if (match?.status === 'Matched' || isJoined) return { label: 'Joined', color: '#3F7A54', joinable: false };

    // Check if event is full
    const joinedCount = getActiveProjectJoinCount(event, joinRecords, volunteerMatches, allVolunteersList);
    const totalSlots = Number(event.volunteersNeeded || 0);
    if (totalSlots > 0 && joinedCount >= totalSlots) {
      return { label: 'Full', color: '#B0432B', joinable: false };
    }
    
    if (match?.status === 'Rejected') return { label: 'Apply Again', color: '#B0432B', joinable: true };
    
    return { label: 'Open', color: '#3F7A54', joinable: true };
  };

  const formatEventDate = (startValue?: string, endValue?: string): string => {
    const startDate = startValue ? new Date(startValue) : null;
    const endDate = endValue ? new Date(endValue) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) return 'Schedule to be announced';
    const startLabel = format(startDate, 'MMM d, yyyy');
    if (!endDate || Number.isNaN(endDate.getTime())) return startLabel;
    
    if (format(startDate, 'yyyy') === format(endDate, 'yyyy')) {
      if (format(startDate, 'MMM') === format(endDate, 'MMM')) {
        if (format(startDate, 'd') === format(endDate, 'd')) {
          return startLabel;
        }
        return `${format(startDate, 'MMM d')} - ${format(endDate, 'd, yyyy')}`;
      }
      return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
    }
    return `${format(startDate, 'MMM d, yyyy')} - ${format(endDate, 'MMM d, yyyy')}`;
  };

  const getEventIcon = (category: string) => {
    switch (category) {
      case 'Nutrition':
        return (
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path d="M12 2C9 6 5 9 5 14a7 7 0 0 0 14 0c0-5-4-8-7-12Z" stroke="#E8A33D" strokeWidth={2} />
          </Svg>
        );
      case 'Education':
        return (
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path d="M4 6l8-3 8 3-8 3-8-3Z" stroke="#E8A33D" strokeWidth={2} />
            <Path d="M4 6v7l8 3 8-3V6" stroke="#E8A33D" strokeWidth={2} />
          </Svg>
        );
      case 'Livelihood':
        return (
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Rect x="4" y="10" width="16" height="9" rx="1.5" stroke="#E8A33D" strokeWidth={2} />
            <Path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#E8A33D" strokeWidth={2} />
          </Svg>
        );
      default:
        return (
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path d="M9 11l3 3L22 4" stroke="#E8A33D" strokeWidth={2} />
            <Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="#E8A33D" strokeWidth={2} />
          </Svg>
        );
    }
  };

  // Filter and sort computation
  const filteredEvents = useMemo(() => {
    const standardEvents = records.filter(p => p.isEvent);
    const standardEventIds = new Set(standardEvents.map(e => e.id));
    const manualEventsMapped = planningItems
      .filter(item => !item.linkedProjectId || !standardEventIds.has(item.linkedProjectId))
      .map(item => convertPlanningItemToProjectEvent(item, planningCalendars));

    const googleEventsMapped = googleEvents
      .filter(item => !standardEventIds.has(`gcal-${item.id}`))
      .map(item => convertGoogleEventToProjectEvent(item));

    let result = [...standardEvents, ...manualEventsMapped, ...googleEventsMapped];

    // Search query filter
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        e =>
          e.title.toLowerCase().includes(q) ||
          (e.description || '').toLowerCase().includes(q) ||
          (e.location?.address || '').toLowerCase().includes(q)
      );
    }

    // Category filter
    if (filterCategory !== 'All') {
      result = result.filter(e => e.category === filterCategory);
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'priority') {
        const priorityVal = { High: 3, Medium: 2, Low: 1 };
        return priorityVal[getEventPriority(b)] - priorityVal[getEventPriority(a)];
      }
      return 0;
    });

    return result;
  }, [records, planningItems, planningCalendars, googleEvents, searchQuery, filterCategory, sortBy]);

  const displayEvents = useMemo(() => {
    if (activeTab === 'applications') {
      return filteredEvents.filter(e => {
        const currentJoinRecord = getCurrentUserJoinRecord(e);
        const isJoined = currentJoinRecord && (currentJoinRecord.participationStatus || 'Active') === 'Active';
        const match = volunteerMatches.find(m => m.projectId === e.id);
        return isJoined || match?.status === 'Requested' || match?.status === 'Matched' || match?.status === 'Rejected';
      });
    }
    return filteredEvents;
  }, [filteredEvents, activeTab, volunteerMatches, volunteerProfile, user, joinRecords]);

  const applicationCount = useMemo(() => {
    return volunteerMatches.filter(m => m.status === 'Requested' || m.status === 'Matched').length;
  }, [volunteerMatches]);

  const getCategoryBgColor = (cat: string) => {
    switch (cat) {
      case 'Nutrition': return '#15803d'; // green
      case 'Education': return '#1a73e8'; // blue
      case 'Livelihood': return '#a142f4'; // purple
      case 'Disaster': return '#ef4444'; // red
      default: return '#5f6368'; // gray
    }
  };

  const cardStyle = useMemo(() => {
    const cardWidth = (numColumns === 3 ? '32%' : numColumns === 2 ? '48%' : '100%') as any;
    return [
      styles.eventCard,
      { maxWidth: cardWidth }
    ];
  }, [numColumns]);

  const renderEventItem = ({ item }: { item: Project }) => {
    const status = getEventStatus(item);
    const joinedCount = getActiveProjectJoinCount(item, joinRecords, volunteerMatches, allVolunteersList);
    const totalSlots = Number(item.volunteersNeeded || 0);
    const displayTotalSlots = totalSlots > 0 ? totalSlots : (item.volunteersNeeded || 20);

    let imageUrl = item.imageUrl;
    if (!imageUrl && item.parentProjectId) {
      const parentProject = records.find(p => p.id === item.parentProjectId);
      if (parentProject?.imageUrl) {
        imageUrl = parentProject.imageUrl;
      }
    }
    const displayImageUri = imageUrl || getEventImage(item.category, item.title);

    return (
      <TouchableOpacity
        style={cardStyle}
        activeOpacity={0.9}
        onPress={() => (navigation as any).navigate('ProjectDetails', { projectId: item.id })}
      >
        {/* Card Header Image */}
        <View style={styles.cardImageContainer}>
          <Image
            source={{ uri: displayImageUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
          <View style={styles.badgeOverlayRow}>
            <View style={styles.eventOverlayBadge}>
              <Text style={styles.eventOverlayText}>EVENT</Text>
            </View>
          </View>
        </View>

        {/* Card Body */}
        <View style={styles.cardBody}>
          {/* Location row */}
          <View style={styles.metaRow}>
            <MaterialIcons name="place" size={14} color="#70757a" style={{ marginRight: 6 }} />
            <Text style={styles.locationText} numberOfLines={1}>
              {item.location?.address || 'Bacolod City, Philippines'}
            </Text>
          </View>

          {/* Title */}
          <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>

          {/* Date Row */}
          <View style={styles.metaRow}>
            <MaterialIcons name="calendar-today" size={14} color="#70757a" style={{ marginRight: 6 }} />
            <Text style={styles.dateText}>
              {formatEventDate(item.startDate, item.endDate)}
            </Text>
          </View>

          {/* Status & Slots row */}
          <View style={styles.slotsRow}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    status.label === 'Open'
                      ? '#e6f4ea'
                      : status.label === 'Pending'
                      ? '#fef7e0'
                      : status.label === 'Full'
                      ? '#fde8e8'
                      : '#f1f3f4',
                },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  {
                    color:
                      status.label === 'Open'
                        ? '#137333'
                        : status.label === 'Pending'
                        ? '#b06000'
                        : status.label === 'Full'
                        ? '#c53030'
                        : '#3c4043',
                  },
                ]}
              >
                {status.label}
              </Text>
            </View>
            <Text style={styles.slotsText}>{joinedCount}/{displayTotalSlots} slots</Text>
          </View>

          {/* Volunteer Requirements row */}
          {item.volunteerRequirements && item.volunteerRequirements.length > 0 && (
            <View style={{ marginTop: 8, marginBottom: 4, gap: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#5f6368' }}>Requirements:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {item.volunteerRequirements.map(req => (
                  <Text
                    key={req}
                    {...({} as any)}
                    style={{
                      backgroundColor: '#f1f3f4',
                      borderRadius: 4,
                      paddingVertical: 2,
                      paddingHorizontal: 6,
                      fontSize: 10,
                      color: '#3c4043',
                    }}
                  >
                    {req}
                  </Text>
                ))}
              </View>
            </View>
          )}

          {/* Button */}
          {status.joinable ? (
            <TouchableOpacity
              style={styles.joinBtn}
              onPress={() => handleJoinEvent(item)}
              disabled={loadingEventId === item.id}
            >
              {loadingEventId === item.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.joinBtnText}>
                  {status.label === 'Apply Again' ? 'Apply Again' : 'Join Event'}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <View style={[styles.joinBtn, { backgroundColor: '#f1f3f4', borderWidth: 0 }]}>
              <Text style={[styles.joinBtnText, { color: '#70757a' }]}>
                {status.label === 'Joined'
                  ? 'Joined'
                  : status.label === 'Full'
                  ? 'Event Full'
                  : status.label}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && records.length === 0) {
    return (
      <View style={styles.loadingWrapper}>
        <ActivityIndicator size="large" color="#1F3A2E" />
      </View>
    );
  }

  return (
    <View style={[styles.rootContainer, { paddingTop: Math.max(insets.top, 12) }]}>
      
      {/* TOP BAR */}
      <View style={styles.topbar}>
        <TouchableOpacity style={styles.menuIcon} onPress={() => {}}>
          <View style={styles.menuLine} />
          <View style={styles.menuLine} />
          <View style={styles.menuLine} />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Events</Text>
        <TouchableOpacity style={styles.bellWrap} onPress={() => navigation.navigate('Messages' as never)}>
          <MaterialIcons name="notifications-none" size={24} color="#1F3A2E" />
          <View style={styles.bellDot} />
        </TouchableOpacity>
      </View>

      {/* SEARCH AND FILTER BAR */}
      <View style={styles.searchAndFilterRow}>
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={20} color="#5f6368" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search events or volunteer roles"
            placeholderTextColor="#5f6368"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <TouchableOpacity
          style={styles.filterIconButton}
          onPress={() => setShowFilterModal(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="filter-list" size={20} color="#15803d" />
        </TouchableOpacity>
      </View>

      {/* TAB ROW */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
          onPress={() => setActiveTab('all')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabButtonText, activeTab === 'all' && styles.tabButtonTextActive]}>
            All Events
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'applications' && styles.tabButtonActive]}
          onPress={() => setActiveTab('applications')}
          activeOpacity={0.8}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.tabButtonText, activeTab === 'applications' && styles.tabButtonTextActive]}>
              My Applications
            </Text>
            {applicationCount > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{applicationCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* SUB-FILTERS ROW (Upcoming / Sort) */}
      <View style={styles.subFiltersRow}>
        <View style={styles.dropdownBtn}>
          <MaterialIcons name="event" size={16} color="#3c4043" />
          <Text style={styles.dropdownBtnText}>Upcoming</Text>
          <MaterialIcons name="keyboard-arrow-down" size={16} color="#3c4043" />
        </View>

        <TouchableOpacity
          style={styles.dropdownBtn}
          onPress={() => setShowSortModal(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="sort" size={16} color="#3c4043" />
          <Text style={styles.dropdownBtnText}>Sort: {sortBy === 'date' ? 'Date' : sortBy === 'title' ? 'Title' : 'Priority'}</Text>
          <MaterialIcons name="keyboard-arrow-down" size={16} color="#3c4043" />
        </TouchableOpacity>
      </View>

      {/* LIST OF EVENTS */}
      <FlatList
        {...({ key: numColumns } as any)}
        numColumns={numColumns}
        data={displayEvents}
        renderItem={renderEventItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={numColumns > 1 ? styles.listGridRow : undefined}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={null}
      />

      {/* BOTTOM REVIEW BANNER */}
      {activeTab === 'all' && (
        <View style={styles.reviewBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={styles.reviewIconContainer}>
              <MaterialIcons name="assignment" size={18} color="#15803d" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewBannerTitle}>For review applications</Text>
              <Text style={styles.reviewBannerText}>
                Applications for events with limited slots will be reviewed by the organizer.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.reviewBannerButton}
            onPress={() => setActiveTab('applications')}
            activeOpacity={0.8}
          >
            <Text style={styles.reviewBannerButtonText}>View My Applications</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sort Options Modal */}
      {showSortModal && (
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSortModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Sort Events By</Text>
            {[
              { label: 'Date (Soonest)', value: 'date' },
              { label: 'Priority (High first)', value: 'priority' },
              { label: 'Alphabetical', value: 'title' },
            ].map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.modalOption, sortBy === opt.value && styles.modalOptionActive]}
                onPress={() => {
                  setSortBy(opt.value as SortOption);
                  setShowSortModal(false);
                }}
              >
                <Text style={[styles.modalOptionText, sortBy === opt.value && styles.modalOptionTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      )}

      {/* Filter Category Modal */}
      {showFilterModal && (
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFilterModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Filter By Category</Text>
            {['All'].map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.modalOption, filterCategory === cat && styles.modalOptionActive]}
                onPress={() => {
                  setFilterCategory(cat as FilterCategory);
                  setShowFilterModal(false);
                }}
              >
                <Text style={[styles.modalOptionText, filterCategory === cat && styles.modalOptionTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  menuIcon: {
    width: 24,
    height: 20,
    justifyContent: 'space-between',
  },
  menuLine: {
    height: 2.5,
    backgroundColor: '#3c4043',
    borderRadius: 2,
  },
  pageTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    fontSize: 22,
    color: '#3c4043',
  },
  bellWrap: {
    position: 'relative',
    padding: 2,
  },
  bellDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  searchAndFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f3f4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#3c4043',
    padding: 0,
  },
  filterIconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    paddingHorizontal: 16,
  },
  tabButton: {
    paddingVertical: 12,
    marginRight: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#15803d',
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#5f6368',
  },
  tabButtonTextActive: {
    fontWeight: '700',
    color: '#15803d',
  },
  tabBadge: {
    backgroundColor: '#3c4043',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  subFiltersRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  dropdownBtnText: {
    fontSize: 13,
    color: '#3c4043',
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  listGridRow: {
    justifyContent: 'space-between',
    gap: 16,
  },
  eventCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dadce0',
    overflow: 'hidden',
    marginBottom: 20,
  },
  cardImageContainer: {
    height: 140,
    position: 'relative',
    backgroundColor: '#f1f3f4',
  },
  cardImagePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.85,
  },
  badgeOverlayRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 6,
  },
  eventOverlayBadge: {
    backgroundColor: '#1b5e20',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  eventOverlayText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  categoryOverlayBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryOverlayText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cardBody: {
    padding: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationText: {
    fontSize: 12,
    color: '#5f6368',
    flex: 1,
  },
  eventTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 10,
  },
  dateText: {
    fontSize: 12,
    color: '#5f6368',
    flex: 1,
  },
  slotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 14,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  slotsText: {
    fontSize: 12,
    color: '#5f6368',
    fontWeight: '500',
  },
  joinBtn: {
    backgroundColor: '#15803d',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  reviewBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#f6fdf9',
    borderTopWidth: 1,
    borderTopColor: '#e6f4ea',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 4,
  },
  reviewIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e6f4ea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#137333',
  },
  reviewBannerText: {
    fontSize: 11,
    color: '#5f6368',
    marginTop: 2,
  },
  reviewBannerButton: {
    borderWidth: 1,
    borderColor: '#15803d',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
  },
  reviewBannerButtonText: {
    fontSize: 12,
    color: '#15803d',
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 14,
    color: '#5f6368',
    marginTop: 12,
    textAlign: 'center',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  modalContent: {
    width: '80%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 8,
  },
  modalTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 18,
    fontWeight: '700',
    color: '#3c4043',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalOptionActive: {
    backgroundColor: '#f1f3f4',
    borderColor: '#dadce0',
  },
  modalOptionText: {
    fontSize: 14,
    color: '#3c4043',
  },
  modalOptionTextActive: {
    fontWeight: '700',
    color: '#15803d',
  },
});
