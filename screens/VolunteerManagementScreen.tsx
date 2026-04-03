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
import { Volunteer, Project, User, VolunteerProjectJoinRecord, VolunteerProjectMatch } from '../models/types';
import {
  assignVolunteerToProject,
  getAllVolunteers,
  getAllProjects,
  getAllUsers,
  getVolunteerCompletedProjectIds,
  getVolunteerProjectJoinRecordsByVolunteer,
  saveVolunteer,
  getVolunteerProjectMatches,
  rateVolunteerProjectParticipation,
  subscribeToStorageChanges,
  verifyVolunteerAccount,
  rejectVolunteerAccount,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';

// Lets admins inspect volunteers, update availability, and assign projects.
export default function VolunteerManagementScreen({ navigation, route }: any) {
  const { user, isAdmin } = useAuth();
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [accountUsers, setAccountUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [selectedVolunteerCompletedProjectIds, setSelectedVolunteerCompletedProjectIds] = useState<string[]>([]);
  const [selectedVolunteerJoinRecords, setSelectedVolunteerJoinRecords] = useState<VolunteerProjectJoinRecord[]>([]);
  const [volunteerMatches, setVolunteerMatches] = useState<VolunteerProjectMatch[]>([]);
  const [ratingProjectKey, setRatingProjectKey] = useState<string | null>(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [daysPerWeek, setDaysPerWeek] = useState('3');
  const [hoursPerWeek, setHoursPerWeek] = useState('12');
  const [availableDays, setAvailableDays] = useState<string[]>(['Monday', 'Wednesday', 'Saturday']);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationNotes, setVerificationNotes] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    loadVolunteers();
    loadAccountUsers();
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
      ['volunteers', 'users', 'projects', 'volunteerMatches', 'volunteerProjectJoins'],
      () => {
        void loadVolunteers();
        void loadAccountUsers();
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

  // Loads user accounts so admin views can show volunteer account details too.
  const loadAccountUsers = async () => {
    try {
      const allUsers = await getAllUsers();
      setAccountUsers(allUsers);
    } catch (error) {
      Alert.alert('Error', 'Failed to load volunteer account details');
    }
  };

  // Loads match history and completed projects for the selected volunteer.
  const loadSelectedVolunteerDetails = async (volunteerId: string) => {
    const [matches, completedProjectIds, joinRecords] = await Promise.all([
      getVolunteerProjectMatches(volunteerId),
      getVolunteerCompletedProjectIds(volunteerId),
      getVolunteerProjectJoinRecordsByVolunteer(volunteerId),
    ]);
    setVolunteerMatches(matches);
    setSelectedVolunteerCompletedProjectIds(completedProjectIds);
    setSelectedVolunteerJoinRecords(joinRecords);
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

  const handleRateVolunteerProject = async (projectId: string, rating: number) => {
    if (!isAdmin || !selectedVolunteer || !user) {
      return;
    }

    const nextKey = `${selectedVolunteer.id}:${projectId}`;
    try {
      setRatingProjectKey(nextKey);
      setSelectedVolunteerJoinRecords(current => {
        const nextRatedAt = new Date().toISOString();
        const existingRecordIndex = current.findIndex(record => record.projectId === projectId);

        if (existingRecordIndex >= 0) {
          return current.map(record =>
            record.projectId === projectId
              ? {
                  ...record,
                  projectRating: rating,
                  ratedAt: nextRatedAt,
                  ratedBy: user.id,
                }
              : record
          );
        }

        return [
          {
            id: `volunteer-join-${projectId}-${selectedVolunteer.id}`,
            projectId,
            volunteerId: selectedVolunteer.id,
            volunteerUserId: selectedVolunteer.userId,
            volunteerName: selectedVolunteer.name,
            volunteerEmail: selectedVolunteer.email,
            joinedAt: new Date().toISOString(),
            source: 'AdminMatch',
            participationStatus: 'Active',
            projectRating: rating,
            ratedAt: nextRatedAt,
            ratedBy: user.id,
          },
          ...current,
        ];
      });

      await rateVolunteerProjectParticipation(projectId, selectedVolunteer.id, rating, user.id);
      await Promise.all([
        loadVolunteers(),
        loadSelectedVolunteerDetails(selectedVolunteer.id),
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save volunteer project rating.');
      void loadSelectedVolunteerDetails(selectedVolunteer.id);
    } finally {
      setRatingProjectKey(null);
    }
  };

  // Verifies a pending volunteer account so they can join events.
  const handleVerifyVolunteer = async () => {
    if (!isAdmin || !selectedVolunteer || !user) {
      Alert.alert('Error', 'Admin context required for verification.');
      return;
    }

    try {
      await verifyVolunteerAccount(selectedVolunteer.id, user.id, verificationNotes);
      Alert.alert('Success', 'Volunteer account verified. They can now join events.');
      setShowVerificationModal(false);
      setVerificationNotes('');
      loadVolunteers();
      if (selectedVolunteer) {
        void loadSelectedVolunteerDetails(selectedVolunteer.id);
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to verify volunteer.');
    }
  };

  // Rejects a volunteer account.
  const handleRejectVolunteer = async () => {
    if (!isAdmin || !selectedVolunteer || !user) {
      Alert.alert('Error', 'Admin context required for rejection.');
      return;
    }

    Alert.prompt(
      'Reject Volunteer Account',
      'Please provide a reason for rejection:',
      [
        { text: 'Cancel', onPress: () => {} },
        {
          text: 'Reject',
          onPress: async (reason) => {
            if (!reason?.trim()) {
              Alert.alert('Error', 'Please provide a rejection reason.');
              return;
            }

            try {
              await rejectVolunteerAccount(selectedVolunteer.id, user.id, reason.trim());
              Alert.alert('Success', 'Volunteer account rejected.');
              setShowVerificationModal(false);
              setVerificationNotes('');
              loadVolunteers();
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to reject volunteer.');
            }
          },
        },
      ]
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
    const selectedVolunteerUser =
      accountUsers.find(account => account.id === selectedVolunteer.userId) || null;
    const matchedProjects = getMatchedProjects();
    const pendingProjects = getPendingProjects();
    const availableProjects = getAvailableProjects();
    const joinedProjectRatings = selectedVolunteerJoinRecords.map(record => {
      const project = projects.find(projectEntry => projectEntry.id === record.projectId);
      return {
        ...record,
        title: project?.title || record.projectId,
        category: project?.category || 'Joined program',
      };
    });
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
              <View
                style={[
                  styles.statusBadge,
                  selectedVolunteer.verificationStatus === 'Verified'
                    ? styles.verificationVerified
                    : selectedVolunteer.verificationStatus === 'Rejected'
                    ? styles.verificationRejected
                    : styles.verificationPending,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {selectedVolunteer.verificationStatus || 'Pending'}
                </Text>
              </View>
            </View>
          </View>

          {(!selectedVolunteer.verificationStatus || selectedVolunteer.verificationStatus === 'Pending') && (
            <View style={styles.verificationPromptBanner}>
              <MaterialIcons name="info" size={20} color="#f59e0b" />
              <View style={styles.verificationPromptText}>
                <Text style={styles.verificationPromptTitle}>Action Required</Text>
                <Text style={styles.verificationPromptSubtitle}>Scroll down to verify this account</Text>
              </View>
              <MaterialIcons name="arrow-downward" size={20} color="#f59e0b" />
            </View>
          )}

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
          <Text style={styles.sectionTitle}>Account Details</Text>
          <View style={styles.infoGridSingle}>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Account Name</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteerUser?.name || selectedVolunteer.name}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Email</Text>
              <Text style={styles.detailCardValue}>
                {selectedVolunteerUser?.email || selectedVolunteer.email || 'Not provided'}
              </Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Phone</Text>
              <Text style={styles.detailCardValue}>
                {selectedVolunteerUser?.phone || selectedVolunteer.phone || 'Not provided'}
              </Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Profile Type</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteerUser?.userType || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Pillars of Interest</Text>
              <Text style={styles.detailCardValue}>
                {(selectedVolunteerUser?.pillarsOfInterest || []).length > 0
                  ? selectedVolunteerUser?.pillarsOfInterest?.join(', ')
                  : 'No pillar preferences'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Registration Details</Text>
          <View style={styles.infoGridSingle}>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Gender</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.gender || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Date of Birth</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.dateOfBirth || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Civil Status</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.civilStatus || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Home Address</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.homeAddress || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Occupation</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.occupation || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Workplace or School</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.workplaceOrSchool || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>College Course</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.collegeCourse || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Certifications or Trainings</Text>
              <Text style={styles.detailCardValue}>
                {selectedVolunteer.certificationsOrTrainings || 'Not provided'}
              </Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Hobbies and Interests</Text>
              <Text style={styles.detailCardValue}>
                {selectedVolunteer.hobbiesAndInterests || 'Not provided'}
              </Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Special Skills</Text>
              <Text style={styles.detailCardValue}>{selectedVolunteer.specialSkills || 'Not provided'}</Text>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailCardLabel}>Affiliations</Text>
              <Text style={styles.detailCardValue}>
                {(selectedVolunteer.affiliations || []).length > 0
                  ? selectedVolunteer.affiliations
                      ?.map(affiliation =>
                        [affiliation.organization, affiliation.position].filter(Boolean).join(' - ')
                      )
                      .join('\n')
                  : 'No affiliations provided'}
              </Text>
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
          <Text style={styles.sectionTitle}>Account Verification</Text>
          <View style={[
            styles.verificationStatusBox,
            selectedVolunteer.verificationStatus === 'Verified' ? styles.verificationStatusVerified
              : selectedVolunteer.verificationStatus === 'Rejected' ? styles.verificationStatusRejected
              : styles.verificationStatusPending
          ]}>
            <MaterialIcons 
              name={selectedVolunteer.verificationStatus === 'Verified' ? 'verified-user' 
                : selectedVolunteer.verificationStatus === 'Rejected' ? 'block' 
                : 'schedule'} 
              size={20} 
              color={selectedVolunteer.verificationStatus === 'Verified' ? '#166534'
                : selectedVolunteer.verificationStatus === 'Rejected' ? '#dc2626'
                : '#f59e0b'} 
            />
            <View style={styles.verificationStatusContent}>
              <Text style={styles.verificationStatusTitle}>
                Status: {selectedVolunteer.verificationStatus || 'Pending'}
              </Text>
              <Text style={styles.verificationStatusSubtitle}>
                {selectedVolunteer.verificationStatus === 'Verified' 
                  ? 'Verified by admin - can join events'
                  : selectedVolunteer.verificationStatus === 'Rejected'
                  ? 'Account rejected'
                  : 'Awaiting admin review'}
              </Text>
              {selectedVolunteer.verificationNotes && (
                <Text style={styles.verificationStatusNotes}>
                  Note: {selectedVolunteer.verificationNotes}
                </Text>
              )}
            </View>
          </View>

          {(!selectedVolunteer.verificationStatus || selectedVolunteer.verificationStatus === 'Pending' || selectedVolunteer.verificationStatus === 'Rejected') && (
            <View style={styles.verificationActionsContainer}>
              <TouchableOpacity
                style={[styles.verificationButton, styles.verifyButton]}
                onPress={() => setShowVerificationModal(true)}
              >
                <MaterialIcons name="checked-circle" size={18} color="#fff" />
                <Text style={styles.verificationButtonText}>Verify Account</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.verificationButton, styles.rejectButton]}
                onPress={handleRejectVolunteer}
              >
                <MaterialIcons name="cancel" size={18} color="#fff" />
                <Text style={styles.verificationButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          )}
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
          <Text style={styles.sectionTitle}>Project Ratings</Text>
          {joinedProjectRatings.length === 0 ? (
            <Text style={styles.emptyText}>This volunteer has not joined any project yet</Text>
          ) : (
            joinedProjectRatings.map(projectRecord => (
              <View key={projectRecord.id} style={styles.ratingCard}>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{projectRecord.title}</Text>
                  <Text style={styles.projectCategory}>{projectRecord.category}</Text>
                  <Text style={styles.ratingCardMeta}>
                    {projectRecord.participationStatus === 'Completed'
                      ? 'Completed participation'
                      : 'Active participation'}
                  </Text>
                </View>
                <View style={styles.ratingCardActions}>
                  <View style={styles.ratingStarsRow}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <TouchableOpacity
                        key={`${projectRecord.projectId}-rate-${star}`}
                        onPress={() => handleRateVolunteerProject(projectRecord.projectId, star)}
                        disabled={ratingProjectKey === `${selectedVolunteer.id}:${projectRecord.projectId}`}
                        style={styles.ratingStarButton}
                      >
                        <MaterialIcons
                          name={star <= (projectRecord.projectRating || 0) ? 'star' : 'star-border'}
                          size={22}
                          color={star <= (projectRecord.projectRating || 0) ? '#f59e0b' : '#cbd5e1'}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.ratingCardValue}>
                    {projectRecord.projectRating ? `${projectRecord.projectRating}/5` : 'Not rated yet'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

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

        <Modal
          visible={showVerificationModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowVerificationModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Verify Volunteer Account</Text>
                <TouchableOpacity onPress={() => setShowVerificationModal(false)}>
                  <MaterialIcons name="close" size={24} color="#334155" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBody}>
                <Text style={styles.modalLabel}>
                  Review the volunteer information and add verification notes if needed.
                </Text>

                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>Volunteer:</Text>
                  <Text style={styles.infoLabel}>{selectedVolunteer?.name}</Text>
                  <Text style={styles.infoLabel}>Email: {selectedVolunteer?.email}</Text>
                  <Text style={styles.infoLabel}>Phone: {selectedVolunteer?.phone}</Text>
                </View>

                <Text style={styles.modalLabel}>Verification Notes (optional)</Text>
                <TextInput
                  style={[styles.input, styles.textAreaInput]}
                  placeholder="Add any notes about this verification..."
                  placeholderTextColor="#999"
                  multiline
                  value={verificationNotes}
                  onChangeText={setVerificationNotes}
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      setShowVerificationModal(false);
                      setVerificationNotes('');
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.approveButton}
                    onPress={handleVerifyVolunteer}
                  >
                    <MaterialIcons name="verified-user" size={18} color="#fff" />
                    <Text style={styles.approveButtonText}>Verify Account</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
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
  infoGridSingle: {
    gap: 10,
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
  detailCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
  detailCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailCardValue: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: '#0f172a',
    fontWeight: '600',
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
  ratingCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: 12,
    marginBottom: 10,
  },
  ratingCardMeta: {
    fontSize: 11,
    color: '#9a3412',
    marginTop: 4,
  },
  ratingCardActions: {
    marginTop: 10,
    gap: 6,
  },
  ratingStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 2,
  },
  ratingStarButton: {
    paddingVertical: 2,
    paddingHorizontal: 1,
  },
  ratingCardValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9a3412',
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
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: '85%',
    maxWidth: 500,
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  verificationStatusBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  verificationStatusVerified: {
    backgroundColor: '#dcfce7',
    borderLeftWidth: 4,
    borderLeftColor: '#166534',
  },
  verificationStatusRejected: {
    backgroundColor: '#fee2e2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
  },
  verificationStatusPending: {
    backgroundColor: '#fef3c7',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  verificationStatusContent: {
    flex: 1,
  },
  verificationStatusTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  verificationStatusSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  verificationStatusNotes: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 6,
    fontStyle: 'italic',
  },
  verificationActionsContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  verificationButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 6,
  },
  verifyButton: {
    backgroundColor: '#166534',
  },
  rejectButton: {
    backgroundColor: '#dc2626',
  },
  verificationButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  verificationVerified: {
    backgroundColor: '#dcfce7',
  },
  verificationRejected: {
    backgroundColor: '#fee2e2',
  },
  verificationPending: {
    backgroundColor: '#fef3c7',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalLabel: {
    fontSize: 13,
    color: '#334155',
    marginBottom: 8,
    fontWeight: '500',
  },
  infoBox: {
    backgroundColor: '#f1f5f9',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  textAreaInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#334155',
    fontWeight: '600',
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#166534',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  approveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  modalBody: {
    paddingHorizontal: 4,
    paddingVertical: 12,
    maxHeight: 500,
  },
  verificationPromptBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fef3c7',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 6,
    marginTop: 12,
    marginBottom: 12,
  },
  verificationPromptText: {
    flex: 1,
  },
  verificationPromptTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
  },
  verificationPromptSubtitle: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
  },
});
