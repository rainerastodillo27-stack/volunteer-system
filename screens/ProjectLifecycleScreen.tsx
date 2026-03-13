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
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PartnerProjectApplication, Project, StatusUpdate } from '../models/types';
import {
  getAllProjects,
  getPartnerProjectApplications,
  getStatusUpdatesByProject,
  reviewPartnerProjectApplication,
  saveProject,
  saveStatusUpdate,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';

const statuses = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];

export default function ProjectLifecycleScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState<Project['status']>('Planning');
  const [updateDescription, setUpdateDescription] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
    } catch (error) {
      Alert.alert('Error', 'Failed to load projects');
    }
  };

  const loadStatusUpdates = async (projectId: string) => {
    try {
      const updates = await getStatusUpdatesByProject(projectId);
      setStatusUpdates(updates);
    } catch (error) {
      Alert.alert('Error', 'Failed to load status updates');
    }
  };

  const loadPartnerApplicationsForProject = async (projectId: string) => {
    try {
      const applications = await getPartnerProjectApplications(projectId);
      setPartnerApplications(applications);
    } catch (error) {
      Alert.alert('Error', 'Failed to load partner applications');
    }
  };

  const handleSelectProject = async (project: Project) => {
    setSelectedProject(project);
    await Promise.all([
      loadStatusUpdates(project.id),
      loadPartnerApplicationsForProject(project.id),
    ]);
  };

  const handleAddStatusUpdate = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can add project status updates.');
      return;
    }

    if (!selectedProject || !updateDescription.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return;
    }

    try {
      const updatedProject = {
        ...selectedProject,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      };

      const statusUpdate: StatusUpdate = {
        id: `status-${Date.now()}`,
        projectId: selectedProject.id,
        status: newStatus,
        description: updateDescription,
        updatedBy: user?.id || '',
        updatedAt: new Date().toISOString(),
      };

      await saveProject(updatedProject);
      await saveStatusUpdate(statusUpdate);

      Alert.alert('Success', 'Status update added');
      setShowStatusModal(false);
      setUpdateDescription('');
      setNewStatus('Planning');
      setSelectedProject(updatedProject);
      await loadStatusUpdates(selectedProject.id);
      loadProjects();
    } catch (error) {
      Alert.alert('Error', 'Failed to add status update');
    }
  };

  const handleReviewPartnerApplication = async (
    applicationId: string,
    nextStatus: 'Approved' | 'Rejected'
  ) => {
    if (!isAdmin || !user?.id || !selectedProject) return;

    try {
      await reviewPartnerProjectApplication(applicationId, nextStatus, user.id);
      await Promise.all([
        loadPartnerApplicationsForProject(selectedProject.id),
        loadProjects(),
      ]);
      const refreshedProject = await getAllProjects();
      const nextSelectedProject = refreshedProject.find(project => project.id === selectedProject.id) || null;
      setSelectedProject(nextSelectedProject);
      Alert.alert('Success', `Partner application ${nextStatus.toLowerCase()}.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to review partner application');
    }
  };

  const getStatusColor = (status: Project['status']) => {
    switch (status) {
      case 'Planning':
        return '#2196F3';
      case 'In Progress':
        return '#FFA500';
      case 'On Hold':
        return '#FF9800';
      case 'Completed':
        return '#4CAF50';
      case 'Cancelled':
        return '#f44336';
      default:
        return '#999';
    }
  };

  const renderProjectCard = (project: Project) => (
    <TouchableOpacity
      key={project.id}
      style={styles.card}
      onPress={() => handleSelectProject(project)}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{project.title}</Text>
          <Text style={styles.cardSubtitle}>{project.category}</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor(project.status) }]} />
      </View>

      <Text style={styles.description}>{project.description}</Text>

      <View style={styles.timeline}>
        <View style={styles.timelineItem}>
          <MaterialIcons name="calendar-today" size={16} color="#666" />
          <Text style={styles.timelineText}>
            {format(new Date(project.startDate), 'MMM dd, yyyy')}
          </Text>
        </View>
        <MaterialIcons name="arrow-forward" size={16} color="#ccc" />
        <View style={styles.timelineItem}>
          <MaterialIcons name="calendar-today" size={16} color="#666" />
          <Text style={styles.timelineText}>
            {format(new Date(project.endDate), 'MMM dd, yyyy')}
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <MaterialIcons name="people" size={16} color="#4CAF50" />
          <Text style={styles.statText}>{project.volunteers.length}/{project.volunteersNeeded}</Text>
        </View>
        <View style={styles.stat}>
          <MaterialIcons name="location-on" size={16} color="#2196F3" />
          <Text style={styles.statText}>{project.location.address}</Text>
        </View>
      </View>

      <View
        style={[
          styles.statusBadge,
          { backgroundColor: getStatusColor(project.status) },
        ]}
      >
        <Text style={styles.statusText}>{project.status}</Text>
      </View>
    </TouchableOpacity>
  );

  if (selectedProject) {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedProject(null)}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Project Details</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>{selectedProject.title}</Text>
          <Text style={styles.detailsSubtitle}>{selectedProject.description}</Text>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>Start:</Text>
              <Text style={styles.timelineValue}>
                {format(new Date(selectedProject.startDate), 'PPP')}
              </Text>
            </View>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>End:</Text>
              <Text style={styles.timelineValue}>
                {format(new Date(selectedProject.endDate), 'PPP')}
              </Text>
            </View>
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Current Status</Text>
            <View
              style={[
                styles.currentStatusBadge,
                { backgroundColor: getStatusColor(selectedProject.status) },
              ]}
            >
              <Text style={styles.statusText}>{selectedProject.status}</Text>
            </View>
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Partner Join Requests</Text>

            {partnerApplications.length === 0 ? (
              <Text style={styles.emptyText}>No partner applications yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {partnerApplications.map(application => (
                  <View key={application.id} style={styles.applicationCard}>
                    <View style={styles.applicationHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicationName}>{application.partnerName}</Text>
                        <Text style={styles.applicationMeta}>{application.partnerEmail}</Text>
                        <Text style={styles.applicationMeta}>
                          Requested {format(new Date(application.requestedAt), 'PPpp')}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.applicationStatusBadge,
                          application.status === 'Approved'
                            ? styles.applicationStatusApproved
                            : application.status === 'Rejected'
                            ? styles.applicationStatusRejected
                            : styles.applicationStatusPending,
                        ]}
                      >
                        <Text style={styles.applicationStatusText}>{application.status}</Text>
                      </View>
                    </View>

                    {isAdmin && application.status === 'Pending' && (
                      <View style={styles.applicationActions}>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.approveButton]}
                          onPress={() => handleReviewPartnerApplication(application.id, 'Approved')}
                        >
                          <Text style={styles.applicationButtonText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.rejectButton]}
                          onPress={() => handleReviewPartnerApplication(application.id, 'Rejected')}
                        >
                          <Text style={styles.applicationButtonText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.detailsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Status Updates</Text>
              {isAdmin && (
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setShowStatusModal(true)}
                >
                  <MaterialIcons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            {statusUpdates.length === 0 ? (
              <Text style={styles.emptyText}>No status updates yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {statusUpdates.map(update => (
                  <View key={update.id} style={styles.updateItem}>
                    <View
                      style={[
                        styles.updateStatusDot,
                        { backgroundColor: getStatusColor(update.status) },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.updateStatus}>{update.status}</Text>
                      <Text style={styles.updateDescription}>{update.description}</Text>
                      <Text style={styles.updateDate}>
                        {format(new Date(update.updatedAt), 'PPpp')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        <Modal
          visible={showStatusModal}
          animationType="slide"
          onRequestClose={() => setShowStatusModal(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowStatusModal(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add Status Update</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <View style={[styles.formRow, styles.formRowTop]}>
                <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                  {statuses.map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.statusOption,
                        newStatus === status && styles.statusOptionSelected,
                      ]}
                      onPress={() => setNewStatus(status as Project['status'])}
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          newStatus === status && styles.statusOptionTextSelected,
                        ]}
                      >
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.label, styles.labelRight, styles.labelTop]}>New Status</Text>
              </View>

              <View style={[styles.formRow, styles.formRowTop]}>
                <TextInput
                  style={[styles.textArea, styles.inputWithLabel]}
                  placeholder="Describe the status update..."
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={4}
                  value={updateDescription}
                  onChangeText={setUpdateDescription}
                />
                <Text style={[styles.label, styles.labelRight, styles.labelTop]}>Description</Text>
              </View>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleAddStatusUpdate}
              >
                <Text style={styles.submitButtonText}>Add Update</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Project Lifecycle Tracking</Text>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="folder-open" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No projects found</Text>
        </View>
      ) : (
        <View style={styles.list}>{projects.map(renderProjectCard)}</View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    flex: 1,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  description: {
    color: '#666',
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  timelineText: {
    fontSize: 12,
    color: '#666',
  },
  stats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  statText: {
    fontSize: 12,
    color: '#666',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  list: {
    marginBottom: 20,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#999',
    fontSize: 16,
    marginTop: 8,
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  detailsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  detailsSubtitle: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 16,
  },
  detailsSection: {
    marginVertical: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  timelineDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timelineLabel: {
    color: '#666',
    fontSize: 12,
  },
  timelineValue: {
    color: '#333',
    fontWeight: '600',
    fontSize: 12,
  },
  currentStatusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  updatesList: {
    marginTop: 12,
  },
  updateItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  updateStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  updateStatus: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  updateDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
    lineHeight: 18,
  },
  updateDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  applicationCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 12,
  },
  applicationHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  applicationName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  applicationMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  applicationStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  applicationStatusPending: {
    backgroundColor: '#fef3c7',
  },
  applicationStatusApproved: {
    backgroundColor: '#dcfce7',
  },
  applicationStatusRejected: {
    backgroundColor: '#fee2e2',
  },
  applicationStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  applicationActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  applicationButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  applicationButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  approveButton: {
    backgroundColor: '#16a34a',
  },
  rejectButton: {
    backgroundColor: '#dc2626',
  },
  addButton: {
    backgroundColor: '#4CAF50',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
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
  statusOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 0,
  },
  statusOptionsCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  statusOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  statusOptionSelected: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  statusOptionText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  statusOptionTextSelected: {
    color: '#fff',
  },
  textArea: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
    color: '#333',
    textAlignVertical: 'top',
    marginBottom: 0,
  },
  inputWithLabel: {
    flex: 1,
    marginBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
