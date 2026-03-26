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
import { useFocusEffect } from '@react-navigation/native';
import { Partner, PartnerProjectApplication, Project, StatusUpdate } from '../models/types';
import {
  completeVolunteerProjectParticipation,
  deleteProject,
  getAllPartners,
  getAllProjects,
  getAllVolunteers,
  getPartnerProjectApplications,
  getProjectMatches,
  getStatusUpdatesByProject,
  getVolunteerProjectJoinRecords,
  reviewPartnerProjectApplication,
  reviewVolunteerProjectMatch,
  saveProject,
  saveStatusUpdate,
  subscribeToStorageChanges,
} from '../models/storage';
import { Volunteer, VolunteerProjectJoinRecord, VolunteerProjectMatch } from '../models/types';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { getProjectStatusColor } from '../utils/projectStatus';

const statuses = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const projectCategories: Project['category'][] = ['Education', 'Livelihood', 'Nutrition', 'Other'];
const PROJECT_REFRESH_INTERVAL_MS = 5000;

type ProjectDraft = {
  id?: string;
  title: string;
  description: string;
  category: Project['category'];
  status: Project['status'];
  partnerId: string;
  startDate: string;
  endDate: string;
  address: string;
  latitude: string;
  longitude: string;
  volunteersNeeded: string;
  isEvent: boolean;
};

type ProjectVolunteerEntry = {
  id: string;
  name: string;
  email: string;
  joinedAt: string | undefined;
  source: VolunteerProjectJoinRecord['source'] | undefined;
  participationStatus: VolunteerProjectJoinRecord['participationStatus'];
  completedAt: string | undefined;
  status: Volunteer['engagementStatus'] | undefined;
};

type ProjectVolunteerRequestEntry = {
  id: string;
  volunteerId: string;
  volunteerUserId: string;
  volunteerName: string;
  volunteerEmail: string;
  requestedAt: string;
  status: VolunteerProjectMatch['status'];
};

const createEmptyProjectDraft = (partnerId = ''): ProjectDraft => ({
  title: '',
  description: '',
  category: 'Education',
  status: 'Planning',
  partnerId,
  startDate: '',
  endDate: '',
  address: '',
  latitude: '',
  longitude: '',
  volunteersNeeded: '1',
  isEvent: false,
});

export default function ProjectLifecycleScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [volunteerJoinRecords, setVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<Project['status']>('Planning');
  const [updateDescription, setUpdateDescription] = useState('');
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(createEmptyProjectDraft());

  useEffect(() => {
    loadProjects();
    loadPartners();
    loadVolunteers();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      const refresh = async () => {
        await Promise.all([loadProjects(), loadPartners(), loadVolunteers()]);
        if (selectedProject?.id) {
          await Promise.all([
            loadStatusUpdates(selectedProject.id),
            loadPartnerApplicationsForProject(selectedProject.id),
            loadVolunteerJoinsForProject(selectedProject.id),
            loadVolunteerMatchesForProject(selectedProject.id),
          ]);

          const refreshedProjects = await getAllProjects();
          if (!active) {
            return;
          }
          const refreshedSelectedProject =
            refreshedProjects.find(project => project.id === selectedProject.id) || null;
          setSelectedProject(refreshedSelectedProject);
        }
      };

      void refresh();
      const refreshTimer = setInterval(() => {
        void refresh();
      }, PROJECT_REFRESH_INTERVAL_MS);

      return () => {
        active = false;
        clearInterval(refreshTimer);
      };
    }, [selectedProject?.id])
  );

  useEffect(() => {
    return subscribeToStorageChanges(
      ['projects', 'volunteers', 'statusUpdates', 'partnerProjectApplications', 'volunteerProjectJoins', 'volunteerMatches'],
      () => {
        void Promise.all([loadProjects(), loadPartners(), loadVolunteers()]);
        if (selectedProject?.id) {
          void Promise.all([
            loadStatusUpdates(selectedProject.id),
            loadPartnerApplicationsForProject(selectedProject.id),
            loadVolunteerJoinsForProject(selectedProject.id),
            loadVolunteerMatchesForProject(selectedProject.id),
          ]);
        }
      }
    );
  }, [selectedProject?.id]);

  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects);
      setSelectedProject(currentSelectedProject => {
        if (!currentSelectedProject) {
          return currentSelectedProject;
        }

        return allProjects.find(project => project.id === currentSelectedProject.id) || null;
      });
      return allProjects;
    } catch (error) {
      Alert.alert('Error', 'Failed to load projects');
      return [];
    }
  };

  const loadPartners = async () => {
    try {
      const allPartners = await getAllPartners();
      setPartners(allPartners);
      setProjectDraft(current =>
        current.partnerId ? current : { ...current, partnerId: allPartners[0]?.id || '' }
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to load partners');
    }
  };

  const loadVolunteers = async () => {
    try {
      const allVolunteers = await getAllVolunteers();
      setVolunteers(allVolunteers);
    } catch (error) {
      Alert.alert('Error', 'Failed to load volunteers');
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

  const loadVolunteerJoinsForProject = async (projectId: string) => {
    try {
      const records = await getVolunteerProjectJoinRecords(projectId);
      setVolunteerJoinRecords(records);
    } catch (error) {
      Alert.alert('Error', 'Failed to load joined volunteers');
    }
  };

  const loadVolunteerMatchesForProject = async (projectId: string) => {
    try {
      const matches = await getProjectMatches(projectId);
      setVolunteerMatches(matches);
    } catch (error) {
      Alert.alert('Error', 'Failed to load volunteer requests');
    }
  };

  const handleSelectProject = async (project: Project) => {
    setSelectedProject(project);
    await Promise.all([
      loadStatusUpdates(project.id),
      loadPartnerApplicationsForProject(project.id),
      loadVolunteerJoinsForProject(project.id),
      loadVolunteerMatchesForProject(project.id),
    ]);
  };

  useEffect(() => {
    const requestedProjectId = route?.params?.projectId;
    if (!requestedProjectId || projects.length === 0) {
      return;
    }

    const nextProject = projects.find(project => project.id === requestedProjectId);
    if (!nextProject) {
      return;
    }

    void handleSelectProject(nextProject);
    navigation.setParams({ projectId: undefined });
  }, [navigation, projects, route?.params?.projectId]);

  const openCreateProjectModal = () => {
    setEditingProjectId(null);
    setProjectDraft(createEmptyProjectDraft(partners[0]?.id || ''));
    setShowProjectModal(true);
  };

  const openEditProjectModal = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectDraft({
      id: project.id,
      title: project.title,
      description: project.description,
      category: project.category,
      status: project.status,
      partnerId: project.partnerId,
      startDate: project.startDate.slice(0, 10),
      endDate: project.endDate.slice(0, 10),
      address: project.location.address,
      latitude: String(project.location.latitude),
      longitude: String(project.location.longitude),
      volunteersNeeded: String(project.volunteersNeeded),
      isEvent: !!project.isEvent,
    });
    setShowProjectModal(true);
  };

  const handleProjectDraftChange = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => {
    setProjectDraft(current => ({ ...current, [key]: value }));
  };

  const handleSaveProjectRecord = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can manage programs.');
      return;
    }

    const latitude = Number(projectDraft.latitude);
    const longitude = Number(projectDraft.longitude);
    const volunteersNeeded = Number(projectDraft.volunteersNeeded);
    const startDateValue = new Date(projectDraft.startDate);
    const endDateValue = new Date(projectDraft.endDate);

    if (
      !projectDraft.title.trim() ||
      !projectDraft.description.trim() ||
      !projectDraft.partnerId.trim() ||
      !projectDraft.startDate.trim() ||
      !projectDraft.endDate.trim() ||
      !projectDraft.address.trim() ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude) ||
      Number.isNaN(volunteersNeeded) ||
      Number.isNaN(startDateValue.getTime()) ||
      Number.isNaN(endDateValue.getTime())
    ) {
      Alert.alert('Validation Error', 'Fill in all required project fields with valid values.');
      return;
    }

    const existingProject = editingProjectId
      ? projects.find(project => project.id === editingProjectId) || null
      : null;
    const now = new Date().toISOString();
    const savedProject: Project = {
      id: existingProject?.id || `project-${Date.now()}`,
      title: projectDraft.title.trim(),
      description: projectDraft.description.trim(),
      partnerId: projectDraft.partnerId.trim(),
      isEvent: projectDraft.isEvent,
      status: projectDraft.status,
      category: projectDraft.category,
      startDate: startDateValue.toISOString(),
      endDate: endDateValue.toISOString(),
      location: {
        latitude,
        longitude,
        address: projectDraft.address.trim(),
      },
      volunteersNeeded,
      volunteers: existingProject?.volunteers || [],
      joinedUserIds: existingProject?.joinedUserIds || [],
      createdAt: existingProject?.createdAt || now,
      updatedAt: now,
      statusUpdates: existingProject?.statusUpdates || [],
    };

    try {
      await saveProject(savedProject);
      await loadProjects();
      setSelectedProject(savedProject);
      setShowProjectModal(false);
      Alert.alert('Saved', editingProjectId ? 'Program updated.' : 'Program created.');
      await Promise.all([
        loadStatusUpdates(savedProject.id),
        loadPartnerApplicationsForProject(savedProject.id),
        loadVolunteerJoinsForProject(savedProject.id),
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save program.');
    }
  };

  const handleDeleteProjectRecord = () => {
    if (!selectedProject || !isAdmin) {
      return;
    }

    Alert.alert(
      'Delete Program',
      `Delete ${selectedProject.title}? This will remove its related join records, applications, and logs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProject(selectedProject.id);
              setSelectedProject(null);
              setStatusUpdates([]);
              setPartnerApplications([]);
              setVolunteerJoinRecords([]);
              await loadProjects();
              Alert.alert('Deleted', 'Program removed.');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete program.');
            }
          },
        },
      ]
    );
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
      Alert.alert('Success', `Partner application ${nextStatus.toLowerCase()}. The partner has been notified.`);
    } catch (error) {
      Alert.alert('Error', 'Failed to review partner application');
    }
  };

  const handleCompleteVolunteerParticipation = async (volunteerId: string) => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    try {
      await completeVolunteerProjectParticipation(selectedProject.id, volunteerId, user.id);
      await Promise.all([
        loadVolunteerJoinsForProject(selectedProject.id),
        loadVolunteers(),
        loadVolunteerMatchesForProject(selectedProject.id),
      ]);
      Alert.alert('Success', 'Volunteer marked as completed for this program.');
    } catch (error) {
      Alert.alert('Error', 'Failed to complete volunteer participation.');
    }
  };

  const handleReviewVolunteerRequest = async (
    matchId: string,
    nextStatus: 'Matched' | 'Rejected'
  ) => {
    if (!isAdmin || !user?.id || !selectedProject) {
      return;
    }

    try {
      await reviewVolunteerProjectMatch(matchId, nextStatus, user.id);
      await Promise.all([
        loadVolunteerMatchesForProject(selectedProject.id),
        loadVolunteerJoinsForProject(selectedProject.id),
        loadVolunteers(),
        loadProjects(),
      ]);
      Alert.alert(
        'Success',
        nextStatus === 'Matched'
          ? 'Volunteer approved and notified.'
          : 'Volunteer request rejected and volunteer notified.'
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to review volunteer request.');
    }
  };

  const getProjectVolunteerEntries = (project: Project) => {
    const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));
    const joinRecordByVolunteerId = new Map(
      volunteerJoinRecords.map(record => [record.volunteerId, record])
    );
    const volunteerIds = Array.from(
      new Set([
        ...project.volunteers,
        ...volunteerJoinRecords.map(record => record.volunteerId),
      ])
    );

    return volunteerIds
      .map<ProjectVolunteerEntry | null>(volunteerId => {
        const volunteer = volunteerById.get(volunteerId);
        const joinRecord = joinRecordByVolunteerId.get(volunteerId);
        if (!volunteer && !joinRecord) {
          return null;
        }

        return {
          id: volunteerId,
          name: joinRecord?.volunteerName || volunteer?.name || 'Volunteer',
          email: joinRecord?.volunteerEmail || volunteer?.email || 'No email provided',
          joinedAt: joinRecord?.joinedAt,
          source: joinRecord?.source,
          participationStatus: joinRecord?.participationStatus || 'Active',
          completedAt: joinRecord?.completedAt,
          status: volunteer?.engagementStatus,
        };
      })
      .filter((entry): entry is ProjectVolunteerEntry => entry !== null)
      .sort((a, b) => {
        const left = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
        const right = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
        return right - left;
      });
  };

  const getProjectVolunteerRequestEntries = () => {
    const volunteerById = new Map(volunteers.map(volunteer => [volunteer.id, volunteer]));

    return volunteerMatches
      .filter(match => match.status === 'Requested' || match.status === 'Rejected')
      .map<ProjectVolunteerRequestEntry | null>(match => {
        const volunteer = volunteerById.get(match.volunteerId);
        if (!volunteer) {
          return null;
        }

        return {
          id: match.id,
          volunteerId: volunteer.id,
          volunteerUserId: volunteer.userId,
          volunteerName: volunteer.name,
          volunteerEmail: volunteer.email,
          requestedAt: match.matchedAt,
          status: match.status,
        };
      })
      .filter((entry): entry is ProjectVolunteerRequestEntry => entry !== null)
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
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
        <View style={[styles.statusDot, { backgroundColor: getProjectStatusColor(project.status) }]} />
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
          { backgroundColor: getProjectStatusColor(project.status) },
        ]}
      >
        <Text style={styles.statusText}>{project.status}</Text>
      </View>
    </TouchableOpacity>
  );

  if (selectedProject) {
    const volunteerEntries = getProjectVolunteerEntries(selectedProject);
    const volunteerRequestEntries = getProjectVolunteerRequestEntries();

    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedProject(null)}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Project Details</Text>
          <View style={styles.headerActions}>
            {isAdmin && (
              <TouchableOpacity
                style={styles.iconActionButton}
                onPress={() => openEditProjectModal(selectedProject)}
              >
                <MaterialIcons name="edit" size={20} color="#166534" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.iconActionButton}
              onPress={() => handleSelectProject(selectedProject)}
            >
              <MaterialIcons name="refresh" size={22} color="#166534" />
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity
                style={styles.iconActionButton}
                onPress={handleDeleteProjectRecord}
              >
                <MaterialIcons name="delete-outline" size={20} color="#b91c1c" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>{selectedProject.title}</Text>
          <Text style={styles.detailsSubtitle}>{selectedProject.description}</Text>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Program Setup</Text>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>Type:</Text>
              <Text style={styles.timelineValue}>{selectedProject.isEvent ? 'Event' : 'Program'}</Text>
            </View>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>Partner:</Text>
              <Text style={styles.timelineValue}>
                {partners.find(partner => partner.id === selectedProject.partnerId)?.name || selectedProject.partnerId}
              </Text>
            </View>
            <View style={styles.timelineDetails}>
              <Text style={styles.timelineLabel}>Slots:</Text>
              <Text style={styles.timelineValue}>
                {selectedProject.volunteers.length}/{selectedProject.volunteersNeeded}
              </Text>
            </View>
          </View>

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
                { backgroundColor: getProjectStatusColor(selectedProject.status) },
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
            <Text style={styles.sectionTitle}>
              Volunteer Join Requests ({volunteerRequestEntries.length})
            </Text>

            {volunteerRequestEntries.length === 0 ? (
              <Text style={styles.emptyText}>No volunteer join requests yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {volunteerRequestEntries.map(requestEntry => (
                  <View key={requestEntry.id} style={styles.applicationCard}>
                    <View style={styles.applicationHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.applicationName}>{requestEntry.volunteerName}</Text>
                        <Text style={styles.applicationMeta}>{requestEntry.volunteerEmail}</Text>
                        <Text style={styles.applicationMeta}>
                          Requested {format(new Date(requestEntry.requestedAt), 'PPpp')}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.applicationStatusBadge,
                          requestEntry.status === 'Rejected'
                            ? styles.applicationStatusRejected
                            : styles.applicationStatusPending,
                        ]}
                      >
                        <Text style={styles.applicationStatusText}>{requestEntry.status}</Text>
                      </View>
                    </View>

                    {isAdmin && requestEntry.status === 'Requested' && (
                      <View style={styles.applicationActions}>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.approveButton]}
                          onPress={() => handleReviewVolunteerRequest(requestEntry.id, 'Matched')}
                        >
                          <Text style={styles.applicationButtonText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.applicationButton, styles.rejectButton]}
                          onPress={() => handleReviewVolunteerRequest(requestEntry.id, 'Rejected')}
                        >
                          <Text style={styles.applicationButtonText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    <TouchableOpacity
                      style={styles.viewVolunteerProfileButton}
                      onPress={() => navigation.navigate('Volunteers', { volunteerId: requestEntry.volunteerId })}
                    >
                      <MaterialIcons name="person-search" size={16} color="#2563eb" />
                      <Text style={styles.viewVolunteerProfileText}>Open Volunteer Profile</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>
              Volunteer Participants ({volunteerEntries.length})
            </Text>

            {volunteerEntries.length === 0 ? (
              <Text style={styles.emptyText}>No volunteers have joined this project yet</Text>
            ) : (
              <View style={styles.updatesList}>
                {volunteerEntries.map(volunteerEntry => (
                  <View key={volunteerEntry.id} style={styles.volunteerCard}>
                    <View style={styles.volunteerCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.volunteerName}>{volunteerEntry.name}</Text>
                        <Text style={styles.volunteerMeta}>{volunteerEntry.email}</Text>
                        <Text style={styles.volunteerMeta}>
                          {volunteerEntry.joinedAt
                            ? `Joined ${format(new Date(volunteerEntry.joinedAt), 'PPpp')}`
                            : 'Joined before tracking was enabled'}
                        </Text>
                        <Text style={styles.volunteerMeta}>
                          {volunteerEntry.participationStatus === 'Completed' && volunteerEntry.completedAt
                            ? `Completed ${format(new Date(volunteerEntry.completedAt), 'PPpp')}`
                            : 'Participation active'}
                        </Text>
                      </View>
                      <View style={styles.volunteerBadges}>
                        {volunteerEntry.source && (
                          <View style={styles.volunteerSourceBadge}>
                            <Text style={styles.volunteerSourceBadgeText}>
                              {volunteerEntry.source === 'VolunteerJoin'
                                ? 'Volunteer Join'
                                : 'Admin Match'}
                            </Text>
                          </View>
                        )}
                        <View
                          style={[
                            styles.volunteerParticipationBadge,
                            volunteerEntry.participationStatus === 'Completed'
                              ? styles.volunteerParticipationCompletedBadge
                              : styles.volunteerParticipationActiveBadge,
                          ]}
                        >
                          <Text style={styles.volunteerParticipationBadgeText}>
                            {volunteerEntry.participationStatus}
                          </Text>
                        </View>
                        {volunteerEntry.status && (
                          <View style={styles.volunteerStatusBadge}>
                            <Text style={styles.volunteerStatusBadgeText}>
                              {volunteerEntry.status}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    {isAdmin && volunteerEntry.participationStatus !== 'Completed' && (
                      <TouchableOpacity
                        style={styles.completeVolunteerButton}
                        onPress={() => handleCompleteVolunteerParticipation(volunteerEntry.id)}
                      >
                        <MaterialIcons name="task-alt" size={16} color="#fff" />
                        <Text style={styles.completeVolunteerButtonText}>Mark Complete</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.viewVolunteerProfileButton}
                      onPress={() => navigation.navigate('Volunteers', { volunteerId: volunteerEntry.id })}
                    >
                      <MaterialIcons name="person-search" size={16} color="#2563eb" />
                      <Text style={styles.viewVolunteerProfileText}>Open Volunteer Profile</Text>
                    </TouchableOpacity>
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
                        { backgroundColor: getProjectStatusColor(update.status) },
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
      <View style={styles.listHeader}>
        <Text style={styles.title}>Project Lifecycle Tracking</Text>
        {isAdmin && (
          <TouchableOpacity style={styles.createProjectButton} onPress={openCreateProjectModal}>
            <MaterialIcons name="add" size={18} color="#fff" />
            <Text style={styles.createProjectButtonText}>New Program</Text>
          </TouchableOpacity>
        )}
      </View>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="folder-open" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No projects found</Text>
        </View>
      ) : (
        <View style={styles.list}>{projects.map(renderProjectCard)}</View>
      )}

      <Modal
        visible={showProjectModal}
        animationType="slide"
        onRequestClose={() => setShowProjectModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowProjectModal(false)}>
              <MaterialIcons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingProjectId ? 'Edit Program' : 'Create Program'}
            </Text>
            <TouchableOpacity onPress={handleSaveProjectRecord}>
              <Text style={styles.projectModalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.formRow}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                placeholder="Program title"
                placeholderTextColor="#999"
                value={projectDraft.title}
                onChangeText={value => handleProjectDraftChange('title', value)}
              />
              <Text style={styles.labelRight}>Title</Text>
            </View>

            <View style={[styles.formRow, styles.formRowTop]}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel]}
                placeholder="Program description"
                placeholderTextColor="#999"
                multiline
                numberOfLines={4}
                value={projectDraft.description}
                onChangeText={value => handleProjectDraftChange('description', value)}
              />
              <Text style={[styles.labelRight, styles.labelTop]}>Description</Text>
            </View>

            <View style={[styles.formRow, styles.formRowTop]}>
              <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                {projectCategories.map(category => (
                  <TouchableOpacity
                    key={category}
                    style={[
                      styles.statusOption,
                      projectDraft.category === category && styles.statusOptionSelected,
                    ]}
                    onPress={() => handleProjectDraftChange('category', category)}
                  >
                    <Text
                      style={[
                        styles.statusOptionText,
                        projectDraft.category === category && styles.statusOptionTextSelected,
                      ]}
                    >
                      {category}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.labelRight, styles.labelTop]}>Category</Text>
            </View>

            <View style={[styles.formRow, styles.formRowTop]}>
              <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                {statuses.map(status => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.statusOption,
                      projectDraft.status === status && styles.statusOptionSelected,
                    ]}
                    onPress={() => handleProjectDraftChange('status', status as Project['status'])}
                  >
                    <Text
                      style={[
                        styles.statusOptionText,
                        projectDraft.status === status && styles.statusOptionTextSelected,
                      ]}
                    >
                      {status}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.labelRight, styles.labelTop]}>Status</Text>
            </View>

            <View style={styles.formRow}>
              <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                <TouchableOpacity
                  style={[
                    styles.statusOption,
                    !projectDraft.isEvent && styles.statusOptionSelected,
                  ]}
                  onPress={() => handleProjectDraftChange('isEvent', false)}
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      !projectDraft.isEvent && styles.statusOptionTextSelected,
                    ]}
                  >
                    Program
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.statusOption,
                    projectDraft.isEvent && styles.statusOptionSelected,
                  ]}
                  onPress={() => handleProjectDraftChange('isEvent', true)}
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      projectDraft.isEvent && styles.statusOptionTextSelected,
                    ]}
                  >
                    Event
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.labelRight}>Type</Text>
            </View>

            <View style={[styles.formRow, styles.formRowTop]}>
              <View style={[styles.statusOptions, styles.statusOptionsCard]}>
                {partners.map(partner => (
                  <TouchableOpacity
                    key={partner.id}
                    style={[
                      styles.statusOption,
                      projectDraft.partnerId === partner.id && styles.statusOptionSelected,
                    ]}
                    onPress={() => handleProjectDraftChange('partnerId', partner.id)}
                  >
                    <Text
                      style={[
                        styles.statusOptionText,
                        projectDraft.partnerId === partner.id && styles.statusOptionTextSelected,
                      ]}
                    >
                      {partner.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.labelRight, styles.labelTop]}>Partner</Text>
            </View>

            <View style={styles.formRow}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#999"
                value={projectDraft.startDate}
                onChangeText={value => handleProjectDraftChange('startDate', value)}
              />
              <Text style={styles.labelRight}>Start Date</Text>
            </View>

            <View style={styles.formRow}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#999"
                value={projectDraft.endDate}
                onChangeText={value => handleProjectDraftChange('endDate', value)}
              />
              <Text style={styles.labelRight}>End Date</Text>
            </View>

            <View style={styles.formRow}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                placeholder="Location address"
                placeholderTextColor="#999"
                value={projectDraft.address}
                onChangeText={value => handleProjectDraftChange('address', value)}
              />
              <Text style={styles.labelRight}>Address</Text>
            </View>

            <View style={styles.formRow}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                placeholder="Latitude"
                placeholderTextColor="#999"
                keyboardType="decimal-pad"
                value={projectDraft.latitude}
                onChangeText={value => handleProjectDraftChange('latitude', value)}
              />
              <Text style={styles.labelRight}>Latitude</Text>
            </View>

            <View style={styles.formRow}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                placeholder="Longitude"
                placeholderTextColor="#999"
                keyboardType="decimal-pad"
                value={projectDraft.longitude}
                onChangeText={value => handleProjectDraftChange('longitude', value)}
              />
              <Text style={styles.labelRight}>Longitude</Text>
            </View>

            <View style={styles.formRow}>
              <TextInput
                style={[styles.textArea, styles.inputWithLabel, styles.singleLineInput]}
                placeholder="Volunteer slots"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                value={projectDraft.volunteersNeeded}
                onChangeText={value => handleProjectDraftChange('volunteersNeeded', value)}
              />
              <Text style={styles.labelRight}>Volunteer Slots</Text>
            </View>

            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleSaveProjectRecord}
            >
              <Text style={styles.submitButtonText}>
                {editingProjectId ? 'Update Program' : 'Create Program'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    flex: 1,
  },
  createProjectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  createProjectButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
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
  volunteerCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 12,
    marginBottom: 12,
  },
  volunteerCardHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  volunteerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  volunteerMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  volunteerBadges: {
    alignItems: 'flex-end',
    gap: 8,
  },
  volunteerParticipationBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  volunteerParticipationActiveBadge: {
    backgroundColor: '#dbeafe',
  },
  volunteerParticipationCompletedBadge: {
    backgroundColor: '#dcfce7',
  },
  volunteerParticipationBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  volunteerSourceBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  volunteerSourceBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  volunteerStatusBadge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  volunteerStatusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  completeVolunteerButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#166534',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  completeVolunteerButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  viewVolunteerProfileText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  viewVolunteerProfileButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  projectModalSave: {
    color: '#166534',
    fontSize: 15,
    fontWeight: '700',
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
  singleLineInput: {
    minHeight: 48,
    textAlignVertical: 'center',
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
