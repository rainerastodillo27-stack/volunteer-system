import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import {
  createPartnerEventCheckIn,
  getPartnerDashboardSnapshot,
  requestPartnerProjectJoin,
  submitPartnerReport,
  subscribeToStorageChanges,
} from '../models/storage';
import {
  Partner,
  PartnerProjectApplication,
  PartnerReportType,
  Project,
  PublishedImpactReport,
} from '../models/types';

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
export default function PartnerDashboardScreen() {
  const { user, logout } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerProjectApplication[]>([]);
  const [publishedImpactReports, setPublishedImpactReports] = useState<PublishedImpactReport[]>([]);
  const [partnerCheckInProjectId, setPartnerCheckInProjectId] = useState<string | null>(null);
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState<ReportFormState>(createEmptyReportForm());

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
      const snapshot = await getPartnerDashboardSnapshot();
      const ownedPartners = snapshot.partners.filter(isOwnedByCurrentPartner);
      setPartners(ownedPartners);
      setProjects(snapshot.projects);
      setPartnerApplications(
        snapshot.partnerApplications
          .filter(application => application.partnerUserId === user?.id)
          .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      );
      setPublishedImpactReports(
        snapshot.publishedImpactReports.filter(report =>
          snapshot.projects.some(
            project =>
              project.id === report.projectId &&
              ownedPartners.some(partner => partner.id === project.partnerId) &&
              Boolean(report.publishedAt)
          )
        )
      );

      setReportForm(current =>
        current.projectId
          ? current
          : createEmptyReportForm(
              snapshot.projects.find(project => project.joinedUserIds?.includes(user?.id || ''))?.id || ''
            )
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

  const updateReportForm = <K extends keyof ReportFormState>(key: K, value: ReportFormState[K]) => {
    setReportForm(current => ({ ...current, [key]: value }));
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

    try {
      setActionProjectId(projectId);
      await requestPartnerProjectJoin(projectId, user);
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

  const handleUploadReport = async () => {
    if (!user || !approvedPartner) {
      Alert.alert('Approval Required', 'You need an approved partner application before uploading a report.');
      return;
    }

    if (!reportForm.projectId || !reportForm.description.trim() || !reportForm.impactCount.trim()) {
      Alert.alert('Validation Error', 'Select a project and complete the report details.');
      return;
    }

    const impactCount = Number(reportForm.impactCount);
    if (Number.isNaN(impactCount) || impactCount <= 0) {
      Alert.alert('Validation Error', 'Impact count must be a positive number.');
      return;
    }

    try {
      await submitPartnerReport({
        projectId: reportForm.projectId,
        partnerId: approvedPartner.id,
        partnerUserId: user.id,
        partnerName: approvedPartner.name,
        reportType: reportForm.reportType,
        description: reportForm.description,
        impactCount,
        mediaFile: reportForm.mediaFile,
      });
      setReportForm(createEmptyReportForm(reportForm.projectId));
      Alert.alert('Uploaded', 'Your report was submitted to the admin impact hub.');
    } catch (error: any) {
      Alert.alert('Upload Failed', error?.message || 'Unable to upload the report.');
    }
  };

  const handleDownloadReport = (report: PublishedImpactReport) => {
    Alert.alert(
      'Download Report',
      `${report.reportFile}\nGenerated ${new Date(report.generatedAt).toLocaleString()}`
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0) || 'P'}</Text>
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
          const attending =
            project.joinedUserIds?.includes(user?.id || '') || application?.status === 'Approved';
          const buttonLabel = attending
            ? 'Attending'
            : application?.status === 'Pending'
            ? 'Pending Approval'
            : application?.status === 'Rejected'
            ? 'Request Again'
            : 'Join Event';

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

              {attending ? (
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
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Submission Form</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Project</Text>
          <View style={styles.selectorGrid}>
            {attendingProjects.map(project => {
              const selected = reportForm.projectId === project.id;
              return (
                <TouchableOpacity
                  key={project.id}
                  style={[styles.selectorChip, selected && styles.selectorChipActive]}
                  onPress={() => updateReportForm('projectId', project.id)}
                >
                  <Text style={[styles.selectorChipText, selected && styles.selectorChipTextActive]}>
                    {project.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Report Type</Text>
          <View style={styles.selectorGrid}>
            {(['General', 'Medical', 'Logistics'] as const).map(type => {
              const selected = reportForm.reportType === type;
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.selectorChip, selected && styles.selectorChipActive]}
                  onPress={() => updateReportForm('reportType', type)}
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
            onChangeText={value => updateReportForm('description', value)}
            multiline
          />
          <TextInput
            style={styles.input}
            placeholder="Impact Count"
            value={reportForm.impactCount}
            onChangeText={value => updateReportForm('impactCount', value)}
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Media File (photo/video name or link)"
            value={reportForm.mediaFile}
            onChangeText={value => updateReportForm('mediaFile', value)}
          />

          <TouchableOpacity style={styles.primaryButton} onPress={handleUploadReport}>
            <Text style={styles.primaryButtonText}>Upload Report</Text>
          </TouchableOpacity>
        </View>
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
                  {report.format} • Published {new Date(report.publishedAt || report.generatedAt).toLocaleDateString()}
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
});
