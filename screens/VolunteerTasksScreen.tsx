import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import InlineLoadError from '../components/InlineLoadError';
import { useAuth } from '../contexts/AuthContext';
import {
  getAllVolunteers,
  getAllProjects,
  getVolunteerByUserId,
  subscribeToStorageChanges,
  saveEvent,
  saveProject,
} from '../models/storage';
import { Project, ProjectInternalTask, Volunteer } from '../models/types';
import { getRequestErrorMessage, getRequestErrorTitle } from '../utils/requestErrors';

// Displays volunteer's assigned tasks from projects.
export default function VolunteerTasksScreen() {
  const { user } = useAuth();
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [tasks, setTasks] = useState<(ProjectInternalTask & { projectId: string; projectTitle: string })[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allVolunteers, setAllVolunteers] = useState<Volunteer[]>([]);
  const [volunteerProfile, setVolunteerProfile] = useState<Volunteer | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<(ProjectInternalTask & { projectId: string; projectTitle: string }) | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'All' | 'Assigned' | 'In Progress' | 'Completed'>('All');

  useFocusEffect(
    React.useCallback(() => {
      void loadVolunteerTasks();
    }, [user])
  );

  useEffect(() => {
    return subscribeToStorageChanges(['projects', 'events', 'volunteers'], () => {
      void loadVolunteerTasks();
    });
  }, [user]);

  const loadVolunteerTasks = async () => {
    try {
      if (!user?.id) {
        setTasks([]);
        setAllProjects([]);
        setAllVolunteers([]);
        setVolunteerProfile(null);
        setLoading(false);
        return;
      }

      const [projects, volunteers, currentVolunteerProfile] = await Promise.all([
        getAllProjects(),
        getAllVolunteers(),
        getVolunteerByUserId(user.id),
      ]);

      // Find all tasks assigned to this volunteer
      const assignedTasks: (ProjectInternalTask & { projectId: string; projectTitle: string })[] = [];

      projects.forEach(project => {
        if (project.internalTasks && Array.isArray(project.internalTasks)) {
          project.internalTasks.forEach(task => {
            if (currentVolunteerProfile && task.assignedVolunteerId === currentVolunteerProfile.id) {
              assignedTasks.push({
                ...task,
                projectId: project.id,
                projectTitle: project.title,
              });
            }
          });
        }
      });

      setAllProjects(projects);
      setAllVolunteers(volunteers);
      setVolunteerProfile(currentVolunteerProfile);
      setTasks(assignedTasks);
      setLoadError(null);
      setLoading(false);
    } catch (error) {
      console.error('Error loading volunteer tasks:', error);
      setTasks([]);
      setAllProjects([]);
      setAllVolunteers([]);
      setVolunteerProfile(null);
      setLoadError({
        title: getRequestErrorTitle(error, 'Database Unavailable'),
        message: getRequestErrorMessage(error, 'Failed to load your assigned tasks.'),
      });
      setLoading(false);
    }
  };

  const handleUpdateTaskStatus = async (task: ProjectInternalTask & { projectId: string }, newStatus: string) => {
    try {
      const project = allProjects.find(p => p.id === task.projectId);

      if (!project) {
        Alert.alert('Error', 'Project not found');
        return;
      }

      const updatedTasks = project.internalTasks?.map(t =>
        t.id === task.id ? { ...t, status: newStatus as any, updatedAt: new Date().toISOString() } : t
      ) || [];

      const updatedProject: Project = {
        ...project,
        internalTasks: updatedTasks,
      };

      if (project.isEvent) {
        await saveEvent(updatedProject);
      } else {
        await saveProject(updatedProject);
      }
      setShowDetails(false);
      void loadVolunteerTasks();
      Alert.alert('Success', 'Task status updated');
    } catch (error) {
      console.error('Error updating task:', error);
      Alert.alert('Error', 'Failed to update task status');
    }
  };

  const selectedEventProject = useMemo(
    () => allProjects.find(project => project.id === selectedTask?.projectId && project.isEvent) || null,
    [allProjects, selectedTask?.projectId]
  );

  const isFieldOfficerForSelectedEvent = useMemo(() => {
    if (!selectedEventProject || !volunteerProfile) {
      return false;
    }

    return (selectedEventProject.internalTasks || []).some(
      task => task.isFieldOfficer && task.assignedVolunteerId === volunteerProfile.id
    );
  }, [selectedEventProject, volunteerProfile]);

  const joinedVolunteerOptions = useMemo(() => {
    if (!selectedEventProject) {
      return [];
    }

    return selectedEventProject.volunteers
      .map(volunteerId => allVolunteers.find(volunteer => volunteer.id === volunteerId) || null)
      .filter((volunteer): volunteer is Volunteer => volunteer !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [allVolunteers, selectedEventProject]);

  const handleAssignEventTask = async (taskId: string, volunteerId?: string) => {
    if (!selectedEventProject || !isFieldOfficerForSelectedEvent) {
      return;
    }

    try {
      const assignedVolunteer = volunteerId
        ? joinedVolunteerOptions.find(volunteer => volunteer.id === volunteerId) || null
        : null;
      const updatedTasks = (selectedEventProject.internalTasks || []).map(task => {
        if (task.id !== taskId) {
          return task;
        }

        const nextStatus =
          volunteerId && task.status === 'Unassigned'
            ? 'Assigned'
            : !volunteerId
            ? 'Unassigned'
            : task.status;

        return {
          ...task,
          assignedVolunteerId: volunteerId || undefined,
          assignedVolunteerName: assignedVolunteer?.name || undefined,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        };
      });

      await saveEvent({
        ...selectedEventProject,
        internalTasks: updatedTasks,
        updatedAt: new Date().toISOString(),
      });
      void loadVolunteerTasks();
      Alert.alert('Saved', 'Event task assignment updated.');
    } catch (error) {
      console.error('Error assigning event task:', error);
      Alert.alert('Error', 'Failed to update the event task assignment.');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High':
        return '#dc2626';
      case 'Medium':
        return '#f59e0b';
      case 'Low':
        return '#10b981';
      default:
        return '#6b7280';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return '#10b981';
      case 'In Progress':
        return '#3b82f6';
      case 'Assigned':
        return '#f59e0b';
      case 'Unassigned':
        return '#6b7280';
      default:
        return '#6b7280';
    }
  };

  const filteredTasks = filterStatus === 'All' ? tasks : tasks.filter(t => t.status === filterStatus);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading your tasks...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Assigned Tasks</Text>
        <Text style={styles.headerSubtitle}>Tasks assigned to you inside joined events</Text>
      </View>

      {loadError && (
        <View style={styles.inlineErrorWrap}>
          <InlineLoadError
            title={loadError.title}
            message={loadError.message}
            onRetry={() => void loadVolunteerTasks()}
          />
        </View>
      )}

      {tasks.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="check-circle-outline" size={64} color="#ccc" />
          <Text style={styles.emptyTitle}>No tasks assigned yet</Text>
          <Text style={styles.emptySubtitle}>Tasks will appear here when admins or field officers assign work to you inside an event</Text>
        </View>
      ) : (
        <>
          <View style={styles.filterContainer}>
            {['All', 'Assigned', 'In Progress', 'Completed'].map(status => (
              <TouchableOpacity
                key={status}
                style={[styles.filterButton, filterStatus === status && styles.filterButtonActive]}
                onPress={() => setFilterStatus(status as any)}
              >
                <Text
                  style={[
                    styles.filterButtonText,
                    filterStatus === status && styles.filterButtonTextActive,
                  ]}
                >
                  {status}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <FlatList
            data={filteredTasks}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.taskCard}
                onPress={() => {
                  setSelectedTask(item);
                  setShowDetails(true);
                }}
              >
                <View style={styles.taskCardHeader}>
                  <Text style={styles.taskTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View
                    style={[
                      styles.priorityBadge,
                      { backgroundColor: getPriorityColor(item.priority) },
                    ]}
                  >
                    <Text style={styles.priorityText}>{item.priority}</Text>
                  </View>
                </View>

                <Text style={styles.projectName}>{item.projectTitle}</Text>
                <Text style={styles.taskCategory}>{item.category}</Text>

                <View style={styles.taskCardFooter}>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusColor(item.status) },
                    ]}
                  >
                    <Text style={styles.statusText}>{item.status}</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#999" />
                </View>
              </TouchableOpacity>
            )}
            style={styles.taskList}
            contentContainerStyle={styles.taskListContent}
          />
        </>
      )}

      <Modal
        animationType="slide"
        transparent
        visible={showDetails}
        onRequestClose={() => setShowDetails(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowDetails(false)}
            >
              <MaterialIcons name="close" size={28} color="#333" />
            </TouchableOpacity>

            {selectedTask && (
              <ScrollView style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{selectedTask.title}</Text>
                  <View
                    style={[
                      styles.priorityBadgeLarge,
                      { backgroundColor: getPriorityColor(selectedTask.priority) },
                    ]}
                  >
                    <Text style={styles.priorityText}>{selectedTask.priority}</Text>
                  </View>
                </View>

                <Text style={styles.projectNameModal}>{selectedTask.projectTitle}</Text>

                {selectedTask.isFieldOfficer ? (
                  <View style={styles.fieldOfficerBadge}>
                    <MaterialIcons name="supervisor-account" size={16} color="#166534" />
                    <Text style={styles.fieldOfficerBadgeText}>Field Officer task</Text>
                  </View>
                ) : null}

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Category</Text>
                  <Text style={styles.infoValue}>{selectedTask.category}</Text>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Description</Text>
                  <Text style={styles.descriptionText}>{selectedTask.description}</Text>
                </View>

                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>Status</Text>
                  <View style={styles.statusButtonGroup}>
                    {['Assigned', 'In Progress', 'Completed'].map(status => (
                      <TouchableOpacity
                        key={status}
                        style={[
                          styles.statusButton,
                          selectedTask.status === status && styles.statusButtonActive,
                          { borderColor: getStatusColor(status) },
                        ]}
                        onPress={() => handleUpdateTaskStatus(selectedTask, status)}
                      >
                        <Text
                          style={[
                            styles.statusButtonText,
                            selectedTask.status === status && styles.statusButtonTextActive,
                          ]}
                        >
                          {status}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.dateSection}>
                  <View style={styles.dateItem}>
                    <Text style={styles.dateLabel}>Created</Text>
                    <Text style={styles.dateValue}>
                      {new Date(selectedTask.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.dateItem}>
                    <Text style={styles.dateLabel}>Last Updated</Text>
                    <Text style={styles.dateValue}>
                      {new Date(selectedTask.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                {isFieldOfficerForSelectedEvent && selectedEventProject ? (
                  <View style={styles.infoSection}>
                    <Text style={styles.infoLabel}>Field Officer Controls</Text>
                    <Text style={styles.descriptionText}>
                      You can assign volunteers to tasks inside {selectedEventProject.title}.
                    </Text>

                    {(selectedEventProject.internalTasks || []).map(eventTask => (
                      <View key={eventTask.id} style={styles.assignmentCard}>
                        <Text style={styles.assignmentTitle}>{eventTask.title}</Text>
                        <Text style={styles.assignmentMeta}>
                          {eventTask.assignedVolunteerName || 'Unassigned'}
                        </Text>
                        <View style={styles.assignmentButtonGroup}>
                          <TouchableOpacity
                            style={styles.assignmentButton}
                            onPress={() => void handleAssignEventTask(eventTask.id)}
                          >
                            <Text style={styles.assignmentButtonText}>Unassign</Text>
                          </TouchableOpacity>
                          {joinedVolunteerOptions.map(volunteer => (
                            <TouchableOpacity
                              key={`${eventTask.id}-${volunteer.id}`}
                              style={[
                                styles.assignmentButton,
                                eventTask.assignedVolunteerId === volunteer.id &&
                                  styles.assignmentButtonActive,
                              ]}
                              onPress={() => void handleAssignEventTask(eventTask.id, volunteer.id)}
                            >
                              <Text
                                style={[
                                  styles.assignmentButtonText,
                                  eventTask.assignedVolunteerId === volunteer.id &&
                                    styles.assignmentButtonTextActive,
                                ]}
                              >
                                {volunteer.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  inlineErrorWrap: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterButtonActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  taskList: {
    flex: 1,
  },
  taskListContent: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 12,
  },
  taskTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  projectName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4CAF50',
    marginBottom: 4,
  },
  taskCategory: {
    fontSize: 12,
    color: '#999',
    marginBottom: 12,
  },
  taskCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingVertical: 20,
    minHeight: '70%',
    maxHeight: '90%',
  },
  closeButton: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  modalContent: {
    paddingHorizontal: 20,
  },
  modalHeader: {
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 12,
  },
  priorityBadgeLarge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  projectNameModal: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
    marginBottom: 20,
  },
  fieldOfficerBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 20,
  },
  fieldOfficerBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  infoSection: {
    marginBottom: 20,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 6,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  descriptionText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 22,
  },
  statusButtonGroup: {
    flexDirection: 'row',
    gap: 10,
  },
  statusButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: '#f9f9f9',
    alignItems: 'center',
  },
  statusButtonActive: {
    backgroundColor: '#e8f5e9',
  },
  statusButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  statusButtonTextActive: {
    color: '#10b981',
  },
  dateSection: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  dateItem: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  assignmentCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#dbe7df',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#f8fafc',
  },
  assignmentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  assignmentMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  assignmentButtonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  assignmentButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  assignmentButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  assignmentButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  assignmentButtonTextActive: {
    color: '#fff',
  },
});
