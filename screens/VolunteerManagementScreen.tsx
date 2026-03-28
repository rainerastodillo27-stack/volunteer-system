import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  FlatList,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Volunteer, Project, VolunteerProjectMatch } from '../models/types';
import {
  assignVolunteerToProject,
  getAllVolunteers,
  getAllProjects,
  getVolunteerCompletedProjectIds,
  saveVolunteer,
  getVolunteerProjectMatches,
  subscribeToStorageChanges,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';

// Lets admins inspect volunteers, update availability, and assign projects.
export default function VolunteerManagementScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [selectedVolunteerCompletedProjectIds, setSelectedVolunteerCompletedProjectIds] = useState<string[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [daysPerWeek, setDaysPerWeek] = useState('3');
  const [hoursPerWeek, setHoursPerWeek] = useState('12');
  const [availableDays, setAvailableDays] = useState<string[]>(['Monday', 'Wednesday', 'Saturday']);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    loadVolunteers();
    loadProjects();
  }, [isAdmin]);

  useEffect(() => {
    const volunteerId = route?.params?.volunteerId;
    if (!isAdmin || !volunteerId || volunteers.length === 0) {
      return;
    }

    const targetVolunteer = volunteers.find(volunteer => volunteer.id === volunteerId);
    if (!targetVolunteer) {
      return;
    }

    void handleSelectVolunteer(targetVolunteer);
    navigation.setParams({ volunteerId: undefined });
  }, [isAdmin, navigation, route?.params?.volunteerId, volunteers]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return subscribeToStorageChanges(
      ['volunteers', 'projects', 'volunteerMatches', 'volunteerProjectJoins'],
      () => {
        void loadVolunteers();
        void loadProjects();
        if (selectedVolunteer) {
          void loadSelectedVolunteerDetails(selectedVolunteer.id);
        }
      }
    );
  }, [isAdmin, selectedVolunteer?.id]);

  // Loads all volunteer profiles and keeps the selected volunteer in sync.
  const loadVolunteers = async () => {
    try {
      const allVolunteers = await getAllVolunteers();
      setVolunteers(allVolunteers);
      setSelectedVolunteer(currentSelectedVolunteer => {
        if (!currentSelectedVolunteer) {
          return currentSelectedVolunteer;
        }

        return (
          allVolunteers.find(volunteer => volunteer.id === currentSelectedVolunteer.id) ||
          currentSelectedVolunteer
        );
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to load volunteers');
    }
  };

  // Loads available projects for matching and detail display.
  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
    } catch (error) {
      Alert.alert('Error', 'Failed to load projects');
    }
  };

  // Loads match history and completed projects for the selected volunteer.
  const loadSelectedVolunteerDetails = async (volunteerId: string) => {
    const [matches, completedProjectIds] = await Promise.all([
      getVolunteerProjectMatches(volunteerId),
      getVolunteerCompletedProjectIds(volunteerId),
    ]);
    setVolunteerMatches(matches);
    setSelectedVolunteerCompletedProjectIds(completedProjectIds);
  };

  // Opens the detail view for the chosen volunteer.
  const handleSelectVolunteer = async (volunteer: Volunteer) => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage volunteers.');
      return;
    }

    setSelectedVolunteer(volunteer);
    await loadSelectedVolunteerDetails(volunteer.id);
    setView('detail');
  };

  // Assigns the selected volunteer to an in-progress project.
  const handleMatchVolunteer = async (projectId: string) => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can match volunteers to projects.');
      return;
    }

    if (!selectedVolunteer) return;

    try {
      await assignVolunteerToProject(projectId, selectedVolunteer.id, user?.id || '');
      Alert.alert('Success', 'Volunteer assigned to project and notified.');

      const matches = await getVolunteerProjectMatches(selectedVolunteer.id);
      setVolunteerMatches(matches);
    } catch (error) {
      Alert.alert('Error', 'Failed to match volunteer');
    }
  };

  // Saves availability changes for the selected volunteer profile.
  const handleUpdateAvailability = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can update volunteer availability.');
      return;
    }

    if (!selectedVolunteer) return;

    try {
      const updated = {
        ...selectedVolunteer,
        availability: {
          daysPerWeek: parseInt(daysPerWeek, 10),
          hoursPerWeek: parseFloat(hoursPerWeek),
          availableDays,
        },
      };

      await saveVolunteer(updated);
      Alert.alert('Success', 'Availability updated');
      setShowAvailabilityModal(false);
      setSelectedVolunteer(updated);
      loadVolunteers();
    } catch (error) {
      Alert.alert('Error', 'Failed to update availability');
    }
  };

  // Adds or removes one selected day from the volunteer availability draft.
  const toggleAvailableDay = (day: string) => {
    setAvailableDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Volunteer Management</Text>
        <View style={styles.emptyState}>
          <MaterialIcons name="lock" size={48} color="#ccc" />
          <Text style={styles.emptyText}>Volunteer management is available only in the admin web account.</Text>
        </View>
      </View>
    );
  }

  // Returns in-progress projects already matched to the selected volunteer.
  const getMatchedProjects = () => {
    return projects.filter(p =>
      p.status === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Matched')
    );
  };

  // Returns in-progress projects still waiting for match approval.
  const getPendingProjects = () => {
    return projects.filter(p =>
      p.status === 'In Progress' &&
      volunteerMatches.find(m => m.projectId === p.id && m.status === 'Requested')
    );
  };

  // Returns in-progress projects that can still accept this volunteer.
  const getAvailableProjects = () => {
    return projects.filter(
      p =>
        p.status === 'In Progress' &&
        !volunteerMatches.find(
          m =>
            m.projectId === p.id &&
            (m.status === 'Matched' || m.status === 'Requested' || m.status === 'Completed')
        )
    );
  };

  if (view === 'detail' && selectedVolunteer) {
    const matchedProjects = getMatchedProjects();
    const pendingProjects = getPendingProjects();
    const availableProjects = getAvailableProjects();
    const completedProjects = selectedVolunteerCompletedProjectIds.map(projectId => {
      const project = projects.find(projectEntry => projectEntry.id === projectId);
      return {
        id: projectId,
        title: project?.title || projectId,
        category: project?.category,
      };
    });

    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('list')}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Volunteer Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.card}>
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{selectedVolunteer.name.charAt(0)}</Text>
            </View>
            <View>
              <Text style={styles.volunteerName}>{selectedVolunteer.name}</Text>
              <Text style={styles.volunteerEmail}>{selectedVolunteer.email}</Text>
              <View
                style={[
                  styles.statusBadge,
                  selectedVolunteer.engagementStatus === 'Busy'
                    ? styles.statusBusy
                    : styles.statusOpen,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {selectedVolunteer.engagementStatus}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.stat}>
              <MaterialIcons name="schedule" size={24} color="#2196F3" />
              <Text style={styles.statValue}>{selectedVolunteer.totalHoursContributed}</Text>
              <Text style={styles.statLabel}>Hours</Text>
            </View>
            <View style={styles.stat}>
              <MaterialIcons name="star" size={24} color="#FFA500" />
              <Text style={styles.statValue}>{selectedVolunteer.rating}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.stat}>
              <MaterialIcons name="task-alt" size={24} color="#4CAF50" />
              <Text style={styles.statValue}>{selectedVolunteerCompletedProjectIds.length}</Text>
              <Text style={styles.statLabel}>Projects</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Availability</Text>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => {
                setDaysPerWeek(selectedVolunteer.availability.daysPerWeek.toString());
                setHoursPerWeek(selectedVolunteer.availability.hoursPerWeek.toString());
                setAvailableDays([...selectedVolunteer.availability.availableDays]);
                setShowAvailabilityModal(true);
              }}
            >
              <MaterialIcons name="edit" size={16} color="#4CAF50" />
            </TouchableOpacity>
          </View>

          <View style={styles.availabilityInfo}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Days per week:</Text>
              <Text style={styles.infoValue}>{selectedVolunteer.availability.daysPerWeek}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Hours per week:</Text>
              <Text style={styles.infoValue}>{selectedVolunteer.availability.hoursPerWeek}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Volunteer status:</Text>
              <Text style={styles.infoValue}>{selectedVolunteer.engagementStatus}</Text>
            </View>
            <Text style={styles.availableDaysLabel}>Available on:</Text>
            <View style={styles.daysContainer}>
              {selectedVolunteer.availability.availableDays.map(day => (
                <View key={day} style={styles.dayBadge}>
                  <Text style={styles.dayBadgeText}>{day.substring(0, 3)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skills</Text>
          <View style={styles.skillsContainer}>
            {selectedVolunteer.skills.map(skill => (
              <View key={skill} style={styles.skillTag}>
                <Text style={styles.skillTagText}>{skill}</Text>
              </View>
            ))}
          </View>
        </View>

        {matchedProjects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Assigned Projects</Text>
            {matchedProjects.map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>{project.category}</Text>
                </View>
                <MaterialIcons name="check-circle" size={20} color="#4CAF50" />
              </View>
            ))}
          </View>
        )}

        {pendingProjects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Join Requests</Text>
            {pendingProjects.map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>{project.category}</Text>
                </View>
                <View style={styles.pendingRequestBadge}>
                  <Text style={styles.pendingRequestBadgeText}>Pending</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Completed Projects</Text>
          {completedProjects.length === 0 ? (
            <Text style={styles.emptyText}>No completed projects yet</Text>
          ) : (
            completedProjects.map(project => (
              <View key={project.id} style={styles.projectItem}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>
                    {project.category || 'Completed program'}
                  </Text>
                </View>
                <MaterialIcons name="task-alt" size={20} color="#16a34a" />
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Available Projects ({availableProjects.length})
            </Text>
          </View>

          {availableProjects.length === 0 ? (
            <Text style={styles.emptyText}>No available projects</Text>
          ) : (
            availableProjects.map(project => (
              <View key={project.id} style={styles.matchCard}>
                <View style={styles.matchContent}>
                  <Text style={styles.projectName}>{project.title}</Text>
                  <Text style={styles.projectCategory}>{project.category}</Text>
                  <Text style={styles.matchDetails}>
                    Volunteers: {project.volunteers.length}/{project.volunteersNeeded}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.matchButton}
                  onPress={() => handleMatchVolunteer(project.id)}
                >
                  <MaterialIcons name="add-circle" size={24} color="#4CAF50" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <Modal
          visible={showAvailabilityModal}
          animationType="slide"
          onRequestClose={() => setShowAvailabilityModal(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowAvailabilityModal(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Update Availability</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <View style={styles.formRow}>
                <TextInput
                  style={[styles.input, styles.inputWithLabel]}
                  placeholder="Number of days"
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                  value={daysPerWeek}
                  onChangeText={setDaysPerWeek}
                />
                <Text style={[styles.label, styles.labelRight]}>Days per week</Text>
              </View>

              <View style={styles.formRow}>
                <TextInput
                  style={[styles.input, styles.inputWithLabel]}
                  placeholder="Total hours"
                  placeholderTextColor="#999"
                  keyboardType="decimal-pad"
                  value={hoursPerWeek}
                  onChangeText={setHoursPerWeek}
                />
                <Text style={[styles.label, styles.labelRight]}>Hours per week</Text>
              </View>

              <View style={[styles.formRow, styles.formRowTop]}>
                <View style={[styles.daysGrid, styles.daysGridCard]}>
                  {daysOfWeek.map(day => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayButton,
                        availableDays.includes(day) && styles.dayButtonSelected,
                      ]}
                      onPress={() => toggleAvailableDay(day)}
                    >
                      <Text
                        style={[
                          styles.dayButtonText,
                          availableDays.includes(day) && styles.dayButtonTextSelected,
                        ]}
                      >
                        {day.substring(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.label, styles.labelRight, styles.labelTop]}>
                  Available days
                </Text>
              </View>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleUpdateAvailability}
              >
                <Text style={styles.submitButtonText}>Update Availability</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Volunteer Management</Text>
      <FlatList
        data={volunteers}
        keyExtractor={vol => vol.id}
        renderItem={({ item: volunteer }) => (
          <TouchableOpacity
            style={styles.volunteerCard}
            onPress={() => handleSelectVolunteer(volunteer)}
          >
            <View style={styles.volunteerCardAvatar}>
              <Text style={styles.volunteerCardAvatarText}>
                {volunteer.name.charAt(0)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.volunteerCardName}>{volunteer.name}</Text>
              <View style={styles.volunteerCardMeta}>
                <MaterialIcons name="schedule" size={12} color="#666" />
                <Text style={styles.volunteerCardMetaText}>
                  {volunteer.availability.hoursPerWeek}h/week
                </Text>
                <MaterialIcons name="star" size={12} color="#FFA500" />
                <Text style={styles.volunteerCardMetaText}>
                  {volunteer.rating}
                </Text>
              </View>
              <Text
                style={[
                  styles.volunteerCardStatus,
                  volunteer.engagementStatus === 'Busy'
                    ? styles.volunteerCardStatusBusy
                    : styles.volunteerCardStatusOpen,
                ]}
              >
                {volunteer.engagementStatus}
              </Text>
            </View>
            <MaterialIcons name="arrow-forward" size={20} color="#999" />
          </TouchableOpacity>
        )}
        scrollEnabled={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 16,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 24,
  },
  volunteerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  volunteerEmail: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
  },
  statusOpen: {
    backgroundColor: '#dcfce7',
  },
  statusBusy: {
    backgroundColor: '#fee2e2',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1f2937',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  stat: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  editButton: {
    padding: 8,
  },
  availabilityInfo: {
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  availableDaysLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    marginTop: 8,
  },
  daysContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayBadge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  dayBadgeText: {
    color: '#1976d2',
    fontSize: 11,
    fontWeight: '600',
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillTag: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  skillTagText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  projectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  projectCategory: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  pendingRequestBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pendingRequestBadgeText: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  matchCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  matchContent: {
    flex: 1,
  },
  matchDetails: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  matchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  volunteerCardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volunteerCardAvatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  volunteerCardName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  volunteerCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  volunteerCardMetaText: {
    fontSize: 11,
    color: '#666',
    marginRight: 8,
  },
  volunteerCardStatus: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
  },
  volunteerCardStatusOpen: {
    color: '#15803d',
  },
  volunteerCardStatusBusy: {
    color: '#b91c1c',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  labelRight: {
    marginBottom: 0,
    minWidth: 140,
    textAlign: 'right',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#14532d',
  },
  labelTop: {
    marginTop: 4,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  formRowTop: {
    alignItems: 'flex-start',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
    color: '#333',
    marginBottom: 20,
  },
  inputWithLabel: {
    flex: 1,
    marginBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 0,
  },
  daysGridCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  dayButton: {
    flex: 0.3,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  dayButtonSelected: {
    backgroundColor: '#4CAF50',
  },
  dayButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  dayButtonTextSelected: {
    color: '#fff',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
