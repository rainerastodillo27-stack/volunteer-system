import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  createPartnerEventCheckIn,
  getPartnerDashboardSnapshot,
  getPublishedImpactReportsByPartnerUser,
  requestPartnerProjectJoin,
  submitPartnerReport,
  subscribeToStorageChanges,
  saveUser,
} from '../models/storage';
import {
  User,
  Partner,
  PartnerProjectApplication,
  PartnerReport,
  PartnerReportType,
  Project,
  PublishedImpactReport,
} from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';

type ReportFormState = {
  projectId: string;
  reportType: PartnerReportType;
  description: string;
  impactCount: string;
  mediaFile: string;
};

function createEmptyReportForm(projectId = ''): ReportFormState {
  return {
    projectId,
    reportType: 'General',
    description: '',
    impactCount: '',
    mediaFile: '',
  };
}

function getDisplayProjectStatus(status: Project['status']): 'Planned' | 'Active' | 'Completed' | 'Cancelled' {
  switch (status) {
    case 'Planning':
      return 'Planned';
    case 'Completed':
      return 'Completed';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Active';
  }
}

const REPORT_TYPE_OPTIONS: PartnerReportType[] = ['General', 'Medical', 'Logistics'];

function getProjectStatusColor(status: ReturnType<typeof getDisplayProjectStatus>) {
  switch (status) {
    case 'Planned':
      return '#2563eb';
    case 'Completed':
      return '#16a34a';
    case 'Cancelled':
      return '#dc2626';
    default:
      return '#f59e0b';
  }
}

// Shows the partner workspace for RSVP, field check-in, report uploads, and published impact files.
export default function PartnerDashboardScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [partnerReports, setPartnerReports] = useState<PartnerReport[]>([]);
  const [publishedImpactReports, setPublishedImpactReports] = useState<PublishedImpactReport[]>([]);
  const [partnerCheckInProjectId, setPartnerCheckInProjectId] = useState<string | null>(null);
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [joinDurationProjectId, setJoinDurationProjectId] = useState<string | null>(null);
  const [joinDurationValueDraft, setJoinDurationValueDraft] = useState('1');
  const [joinDurationUnitDraft, setJoinDurationUnitDraft] = useState<'Days' | 'Months'>('Months');
  const [reportForm, setReportForm] = useState<ReportFormState>(createEmptyReportForm());
  const [profilePictureUri, setProfilePictureUri] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  const isOwnedByCurrentPartner = React.useCallback(
    (partner: Partner) => {
      if (!user) {
        return false;
      }

      if (partner.ownerUserId) {
        return partner.ownerUserId === user.id;
      }

      return partner.contactEmail?.toLowerCase() === user.email?.toLowerCase();
    },
    [user]
  );

  const loadDashboardData = React.useCallback(async () => {
    try {
      if (!user?.id) {
        return;
      }

      const [snapshot, visibleImpactReports] = await Promise.all([
        getPartnerDashboardSnapshot(),
        getPublishedImpactReportsByPartnerUser(user.id),
      ]);
      const ownedPartners = snapshot.partners.filter(isOwnedByCurrentPartner);
      setPartners(ownedPartners);
      setProjects(snapshot.projects);
      setPartnerApplications(
        snapshot.partnerApplications
          .filter(application => application.partnerUserId === user.id)
          .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      );
      setPartnerReports(
        snapshot.partnerReports
          .filter(report => report.partnerUserId === user.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setPublishedImpactReports(visibleImpactReports);

      setReportForm(current =>
        current.projectId ? current : createEmptyReportForm()
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to load the partner dashboard.');
    }
  }, [isOwnedByCurrentPartner, user?.id]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  useFocusEffect(
    React.useCallback(() => {
      void loadDashboardData();
    }, [loadDashboardData])
  );

  useEffect(() => {
    return subscribeToStorageChanges(
      [
        'partners',
        'projects',
        'partnerProjectApplications',
        'partnerEventCheckIns',
        'partnerReports',
        'publishedImpactReports',
      ],
      () => {
        void loadDashboardData();
      }
    );
  }, [loadDashboardData]);

  const approvedPartner = useMemo(
    () => partners.find(partner => partner.status === 'Approved') || null,
    [partners]
  );

  const applicationByProjectId = useMemo(
    () => new Map(partnerApplications.map(application => [application.projectId, application])),
    [partnerApplications]
  );

  const attendingProjects = useMemo(
    () =>
      projects.filter(project => {
        const application = applicationByProjectId.get(project.id);
        return (
          project.joinedUserIds?.includes(user?.id || '') ||
          application?.status === 'Approved'
        );
      }),
    [applicationByProjectId, projects, user?.id]
  );

  const activeProjects = useMemo(
    () => projects.filter(project => getDisplayProjectStatus(project.status) !== 'Cancelled'),
    [projects]
  );

  const openReportForm = (projectId: string) => {
    setReportForm(current =>
      current.projectId === projectId ? current : createEmptyReportForm(projectId)
    );
  };

  // Function to pick profile picture
  const pickProfilePicture = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission needed', 'Please grant access to your photos to upload a profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setProfilePictureUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking profile picture:', error);
      Alert.alert('Error', 'Failed to pick profile picture. Please try again.');
    }
  };

  // Function to save profile picture
  const handleSaveProfilePicture = async () => {
    if (!user || !profilePictureUri) {
      return;
    }

    try {
      // For partners, we need to update both the user and partner records
      const updatedUser: User = {
        ...user,
        profilePictureUrl: profilePictureUri,
      };

      await saveUser(updatedUser);

      // Update partner profile if it exists
      if (approvedPartner) {
        const updatedPartner: Partner = {
          ...approvedPartner,
          profilePictureUrl: profilePictureUri,
        };

        // Note: We would need a savePartner function, but for now we'll just update the user
        // In a full implementation, you'd save the partner profile here
      }

      Alert.alert('Success', 'Profile picture saved successfully!');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to save profile picture.');
    }
  };

  const closeReportForm = () => {
    setReportForm(createEmptyReportForm());
  };

  const updateReportFormForProject = (
    projectId: string,
    updates: Partial<Omit<ReportFormState, 'projectId'>>
  ) => {
    setReportForm(current => ({
      ...(current.projectId === projectId ? current : createEmptyReportForm(projectId)),
      projectId,
      ...updates,
    }));
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined' ? window.confirm('Are you sure you want to logout?') : true;
      if (confirmed) {
        await logout();
      }
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel' },
      { text: 'Logout', onPress: async () => await logout() },
    ]);
  };

  const handleJoinProject = async (projectId: string) => {
    if (!user) {
      return;
    }

    setJoinDurationProjectId(projectId);
  };

  const resetJoinDurationFlow = () => {
    setJoinDurationProjectId(null);
    setJoinDurationValueDraft('1');
    setJoinDurationUnitDraft('Months');
  };

  const handleSaveJoinDuration = async () => {
    if (!user || !joinDurationProjectId) {
      return;
    }

    const normalizedDurationValue = Number.parseInt(joinDurationValueDraft.trim(), 10);
    if (Number.isNaN(normalizedDurationValue) || normalizedDurationValue <= 0) {
      Alert.alert('Invalid duration', 'Please enter how many days or months your organization will cooperate.');
      return;
    }

    try {
      setActionProjectId(joinDurationProjectId);
      await requestPartnerProjectJoin(joinDurationProjectId, user, {
        value: normalizedDurationValue,
        unit: joinDurationUnitDraft,
      });
      resetJoinDurationFlow();
      Alert.alert('Request Sent', 'Your RSVP has been sent to the admin for approval.');
      void loadDashboardData();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to send the RSVP request.');
    } finally {
      setActionProjectId(null);
    }
  };

  const handleCheckIn = async (project: Project) => {
    if (!user || !approvedPartner) {
      Alert.alert('Approval Required', 'You need an approved partner application before checking in.');
      return;
    }

    try {
      setPartnerCheckInProjectId(project.id);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Location Required', 'Location access is required to capture GPS coordinates.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const checkIn = await createPartnerEventCheckIn({
        projectId: project.id,
        partnerId: approvedPartner.id,
        partnerUserId: user.id,
        gpsCoordinates: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
      });

      Alert.alert(
        'Checked In',
        `GPS captured at ${checkIn.gpsCoordinates.latitude.toFixed(4)}, ${checkIn.gpsCoordinates.longitude.toFixed(4)} on ${new Date(checkIn.checkInTime).toLocaleString()}.`
      );
    } catch (error: any) {
      Alert.alert('Check-In Failed', error?.message || 'Unable to complete event check-in.');
    } finally {
      setPartnerCheckInProjectId(null);
    }
  };

  const handleUploadReport = async (projectId: string) => {
    if (!user || !approvedPartner) {
      Alert.alert('Approval Required', 'You need an approved partner application before uploading a report.');
      return;
    }

    const targetProject = attendingProjects.find(project => project.id === projectId);
    if (!targetProject) {
      Alert.alert('Validation Error', 'Join the event first before submitting a report.');
      return;
    }

    const activeReportForm =
      reportForm.projectId === projectId ? reportForm : createEmptyReportForm(projectId);

    if (!activeReportForm.description.trim() || !activeReportForm.impactCount.trim()) {
      Alert.alert('Validation Error', 'Complete the report details for this event.');
      return;
    }

    const impactCount = Number(activeReportForm.impactCount);
    if (Number.isNaN(impactCount) || impactCount <= 0) {
      Alert.alert('Validation Error', 'Impact count must be a positive number.');
      return;
    }

    try {
      await submitPartnerReport({
        projectId,
        partnerId: approvedPartner.id,
        partnerUserId: user.id,
        partnerName: approvedPartner.name,
        reportType: activeReportForm.reportType,
        description: activeReportForm.description,
        impactCount,
        mediaFile: activeReportForm.mediaFile,
      });
      setReportForm(createEmptyReportForm(projectId));
      void loadDashboardData();
      Alert.alert('Uploaded', 'Your report was submitted to the admin impact hub.');
    } catch (error: any) {
      Alert.alert('Upload Failed', error?.message || 'Unable to upload the report.');
    }
  };

  const handlePickReportImage = async (projectId: string) => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }

      updateReportFormForProject(projectId, { mediaFile: pickedImage });
    } catch (error: any) {
      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');
    }
  };

  const handleRemoveReportImage = (projectId: string) => {
    updateReportFormForProject(projectId, { mediaFile: '' });
  };

  const handleDownloadReport = (report: PublishedImpactReport) => {
    const linkedProject = projects.find(project => project.id === report.projectId);
    Alert.alert(
      'Open Project File',
      `${report.reportFile}\n${linkedProject?.title || 'Project'}\nGenerated ${new Date(report.generatedAt).toLocaleString()}`,
      [
        { text: 'Close', style: 'cancel' },
        {
          text: 'Open Project',
          onPress: () => navigation.navigate('Projects', { projectId: report.projectId }),
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          {profilePictureUri ? (
            <Image source={{ uri: profilePictureUri }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'P'}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.changePhotoButton} onPress={pickProfilePicture}>
            <MaterialIcons name="camera-alt" size={16} color="#fff" />
          </TouchableOpacity>

          {profilePictureUri && (
            <View style={styles.avatarActionRow}>
              <TouchableOpacity
                style={[styles.saveButton, saveLoading && styles.saveButtonDisabled]}
                onPress={handleSaveProfilePicture}
                disabled={saveLoading}
              >
                <Text style={styles.saveButtonText}>{saveLoading ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setProfilePictureUri(null)}
                disabled={saveLoading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Welcome, {user?.name}</Text>
          <Text style={styles.role}>Partner Dashboard</Text>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <MaterialIcons name="logout" size={22} color="#475569" />
        </TouchableOpacity>
      </View>


      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Registration Status</Text>
        {partners.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>No organization application found yet.</Text>
          </View>
        ) : (
          partners.map(partner => (
            <View key={partner.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{partner.name}</Text>
                  <Text style={styles.cardMeta}>
                    {partner.sectorType} • DSWD {partner.dswdAccreditationNo || 'Pending'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getProjectStatusColor(partner.status === 'Approved' ? 'Completed' : 'Active') },
                  ]}
                >
                  <Text style={styles.statusBadgeText}>{partner.status}</Text>
                </View>
              </View>
              <Text style={styles.cardText}>
                Verification: {partner.verificationStatus || 'Pending'}{partner.credentialsUnlockedAt ? ' • Login unlocked' : ' • Login locked'}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Project Management</Text>
        {activeProjects.map(project => {
          const displayStatus = getDisplayProjectStatus(project.status);
          const application = applicationByProjectId.get(project.id);
          const projectReportsForCard = partnerReports.filter(report => report.projectId === project.id);
          const latestProjectReport = projectReportsForCard[0];
          const reportFormOpen = reportForm.projectId === project.id;
          const attending =
            project.joinedUserIds?.includes(user?.id || '') || application?.status === 'Approved';
          const buttonLabel = attending
            ? project.isEvent
              ? 'Joined Event'
              : 'Joined Project'
            : application?.status === 'Pending'
            ? 'Pending Approval'
            : application?.status === 'Rejected'
            ? 'Request Again'
            : project.isEvent
            ? 'Join Event'
            : 'Join Project';

          return (
            <View key={project.id} style={styles.projectCard}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{project.title}</Text>
                  <Text style={styles.cardMeta}>{project.description}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getProjectStatusColor(displayStatus) }]}>
                  <Text style={styles.statusBadgeText}>{displayStatus}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, attending && styles.secondaryButton]}
                onPress={() => handleJoinProject(project.id)}
                disabled={attending || application?.status === 'Pending' || actionProjectId === project.id}
              >
                <Text style={[styles.primaryButtonText, attending && styles.secondaryButtonText]}>
                  {actionProjectId === project.id ? 'Sending...' : buttonLabel}
                </Text>
              </TouchableOpacity>

              {application?.cooperationDurationValue ? (
                <Text style={styles.joinDurationBadgeText}>
                  Cooperation period: {application.cooperationDurationValue} {application.cooperationDurationUnit?.toLowerCase()}
                </Text>
              ) : null}

              {attending ? (
                <>
                  <TouchableOpacity
                    style={styles.checkInButton}
                    onPress={() => handleCheckIn(project)}
                    disabled={partnerCheckInProjectId === project.id}
                  >
                    <MaterialIcons name="place" size={16} color="#fff" />
                    <Text style={styles.checkInButtonText}>
                      {partnerCheckInProjectId === project.id ? 'Checking In...' : 'Check-In'}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.inlineReportCard}>
                    <View style={styles.inlineReportHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.inlineReportTitle}>Data Submission Form</Text>
                        <Text style={styles.inlineReportMeta}>
                          {projectReportsForCard.length === 0
                            ? `Upload a report inside this ${project.isEvent ? 'event' : 'project'}.`
                            : `${projectReportsForCard.length} submitted report${
                                projectReportsForCard.length === 1 ? '' : 's'
                              } for this ${project.isEvent ? 'event' : 'project'}.`}
                        </Text>
                        {latestProjectReport ? (
                          <Text style={styles.inlineReportMeta}>
                            Latest: {latestProjectReport.reportType} report on{' '}
                            {new Date(latestProjectReport.createdAt).toLocaleDateString()}
                          </Text>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        style={styles.inlineReportToggle}
                        onPress={() =>
                          reportFormOpen ? closeReportForm() : openReportForm(project.id)
                        }
                      >
                        <Text style={styles.inlineReportToggleText}>
                          {reportFormOpen ? 'Hide Form' : 'Open Form'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {reportFormOpen ? (
                      <View style={styles.inlineReportForm}>
                        <Text style={styles.fieldLabel}>Report Type</Text>
                        <View style={styles.selectorGrid}>
                          {REPORT_TYPE_OPTIONS.map(type => {
                            const selected = reportForm.reportType === type;
                            return (
                              <TouchableOpacity
                                key={type}
                                style={[styles.selectorChip, selected && styles.selectorChipActive]}
                                onPress={() => updateReportFormForProject(project.id, { reportType: type })}
                              >
                                <Text style={[styles.selectorChipText, selected && styles.selectorChipTextActive]}>
                                  {type}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <TextInput
                          style={[styles.input, styles.inputMultiline]}
                          placeholder="Description"
                          value={reportForm.description}
                          onChangeText={value =>
                            updateReportFormForProject(project.id, { description: value })
                          }
                          multiline
                        />
                        <TextInput
                          style={styles.input}
                          placeholder="Impact Count"
                          value={reportForm.impactCount}
                          onChangeText={value =>
                            updateReportFormForProject(project.id, { impactCount: value })
                          }
                          keyboardType="number-pad"
                        />
                        <TouchableOpacity
                          style={styles.photoPickerButton}
                          onPress={() => handlePickReportImage(project.id)}
                        >
                          <MaterialIcons name="photo-library" size={18} color="#166534" />
                          <Text style={styles.photoPickerButtonText}>
                            {reportForm.mediaFile ? 'Replace Photo' : 'Choose Photo From Phone'}
                          </Text>
                        </TouchableOpacity>

                        {reportForm.mediaFile ? (
                          <View style={styles.photoPreviewCard}>
                            {isImageMediaUri(reportForm.mediaFile) ? (
                              <Image
                                source={{ uri: reportForm.mediaFile }}
                                style={styles.photoPreview}
                                resizeMode="cover"
                              />
                            ) : null}
                            <View style={styles.photoPreviewMeta}>
                              <Text style={styles.photoPreviewLabel}>Photo ready to upload</Text>
                              <TouchableOpacity onPress={() => handleRemoveReportImage(project.id)}>
                                <Text style={styles.photoRemoveText}>Remove Photo</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : null}

                        <TouchableOpacity
                          style={styles.primaryButton}
                          onPress={() => handleUploadReport(project.id)}
                        >
                          <Text style={styles.primaryButtonText}>Upload Report</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Impact Report Hub</Text>
        {publishedImpactReports.filter(report => Boolean(report.publishedAt)).length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>No published PDF or Excel files yet.</Text>
          </View>
        ) : (
          publishedImpactReports
            .filter(report => Boolean(report.publishedAt))
            .map(report => (
              <View key={report.id} style={styles.card}>
                <Text style={styles.cardTitle}>{report.reportFile}</Text>
                <Text style={styles.cardMeta}>
                  {(projects.find(project => project.id === report.projectId)?.title || 'Project')} • {report.format} • Published {new Date(report.publishedAt || report.generatedAt).toLocaleDateString()}
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => handleDownloadReport(report)}
                >
                  <Text style={styles.primaryButtonText}>Download Report</Text>
                </TouchableOpacity>
              </View>
            ))
        )}
      </View>

      <Modal
        visible={Boolean(joinDurationProjectId)}
        transparent
        animationType="fade"
        onRequestClose={resetJoinDurationFlow}
      >
        <View style={styles.joinDurationOverlay}>
          <View style={styles.joinDurationCard}>
            <Text style={styles.joinDurationTitle}>Set Cooperation Duration</Text>
            <Text style={styles.joinDurationText}>
              Choose how long your organization plans to cooperate on this project.
            </Text>
            <TextInput
              style={styles.joinDurationInput}
              value={joinDurationValueDraft}
              onChangeText={setJoinDurationValueDraft}
              keyboardType="number-pad"
              placeholder="Enter duration"
              placeholderTextColor="#94a3b8"
              editable={!Boolean(actionProjectId)}
            />
            <View style={styles.joinDurationUnitRow}>
              {(['Days', 'Months'] as const).map(unit => (
                <TouchableOpacity
                  key={unit}
                  style={[
                    styles.joinDurationUnitButton,
                    joinDurationUnitDraft === unit && styles.joinDurationUnitButtonActive,
                  ]}
                  onPress={() => setJoinDurationUnitDraft(unit)}
                  disabled={Boolean(actionProjectId)}
                >
                  <Text
                    style={[
                      styles.joinDurationUnitButtonText,
                      joinDurationUnitDraft === unit && styles.joinDurationUnitButtonTextActive,
                    ]}
                  >
                    {unit}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.joinDurationActions}>
              <TouchableOpacity
                style={styles.joinDurationCancelButton}
                onPress={resetJoinDurationFlow}
                disabled={Boolean(actionProjectId)}
              >
                <Text style={styles.joinDurationCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.joinDurationSaveButton}
                onPress={() => {
                  void handleSaveJoinDuration();
                }}
                disabled={Boolean(actionProjectId)}
              >
                <Text style={styles.joinDurationSaveText}>
                  {actionProjectId ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 18,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#166534',
  },
  changePhotoButton: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#166534',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  greeting: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  role: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  section: {
    marginTop: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  projectCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  cardText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#dcfce7',
  },
  secondaryButtonText: {
    color: '#166534',
  },
  checkInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
  },
  checkInButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  inlineReportCard: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    backgroundColor: '#f8fafc',
  },
  inlineReportHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  inlineReportTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  inlineReportMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  inlineReportToggle: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
  },
  inlineReportToggleText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  inlineReportForm: {
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  selectorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  selectorChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  selectorChipActive: {
    backgroundColor: '#166534',
  },
  selectorChipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  selectorChipTextActive: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#0f172a',
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  photoPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingVertical: 12,
  },
  photoPickerButtonText: {
    color: '#166534',
    fontWeight: '700',
  },
  photoPreviewCard: {
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  photoPreview: {
    width: '100%',
    height: 180,
    backgroundColor: '#e2e8f0',
  },
  photoPreviewMeta: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  photoPreviewLabel: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  photoRemoveText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '700',
  },
  saveButtonContainer: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  saveButton: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    minWidth: 120,
  },
  saveButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  avatarActionRow: {
    position: 'absolute',
    bottom: -40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  cancelButton: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    minWidth: 120,
  },
  cancelButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  joinDurationBadgeText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  joinDurationOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  joinDurationCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  joinDurationTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  joinDurationText: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
    textAlign: 'center',
  },
  joinDurationInput: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  joinDurationUnitRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  joinDurationUnitButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  joinDurationUnitButtonActive: {
    backgroundColor: '#dcfce7',
    borderColor: '#4CAF50',
  },
  joinDurationUnitButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  joinDurationUnitButtonTextActive: {
    color: '#166534',
  },
  joinDurationActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  joinDurationCancelButton: {
    flex: 1,
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  joinDurationSaveButton: {
    flex: 1,
    backgroundColor: '#166534',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  joinDurationCancelText: {
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: '700',
  },
  joinDurationSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
