import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { SubmittedReport } from '../screens/ReportsScreen';
import type { VolunteerTimeLog } from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

interface ReportUploadModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (
    report: Omit<
      SubmittedReport,
      'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'
    >
  ) => void;
  projects?: any[];
  userRole?: SubmittedReport['submitterRole'];
  volunteerTimeLogs?: VolunteerTimeLog[];
}

export default function ReportUploadModal({
  visible,
  onClose,
  onSubmit,
  projects = [],
  userRole,
  volunteerTimeLogs,
}: ReportUploadModalProps) {
  const [reportType, setReportType] =
    useState<SubmittedReport['reportType']>('volunteer_engagement');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
  const [selectedPhotoUri, setSelectedPhotoUri] = useState('');
  const [volunteerSummary, setVolunteerSummary] = useState('');
  const [volunteerContribution, setVolunteerContribution] = useState('');
  const [volunteerExperience, setVolunteerExperience] = useState('');
  const [volunteerFollowUp, setVolunteerFollowUp] = useState('');
  const [metrics, setMetrics] = useState({
    volunteerHours: '',
    verifiedAttendance: '',
    activeVolunteers: '',
    beneficiariesServed: '',
    tasksCompleted: '',
    eventsCount: '',
    geofenceCompliance: '',
  });
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isVolunteer = userRole === 'volunteer';
  const entityLabel = isVolunteer ? 'Event' : 'Project';
  const entityLabelLower = entityLabel.toLowerCase();

  const volunteerMetrics = useMemo(() => {
    if (!isVolunteer || !selectedProject || !volunteerTimeLogs?.length) {
      return { volunteerHours: 0, tasksCompleted: 0 };
    }

    const logsForProject = volunteerTimeLogs.filter(log => log.projectId === selectedProject);
    const totalHours = logsForProject.reduce((sum, log) => {
      if (!log.timeIn) {
        return sum;
      }

      const start = new Date(log.timeIn).getTime();
      const end = log.timeOut ? new Date(log.timeOut).getTime() : Date.now();
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        return sum;
      }
      return sum + (end - start) / 3_600_000;
    }, 0);

    const completedLogs = logsForProject.filter(log => Boolean(log.timeOut));
    const hasAnyLog = logsForProject.length > 0;

    return {
      volunteerHours: Number(totalHours.toFixed(1)),
      tasksCompleted: completedLogs.length > 0 ? completedLogs.length : hasAnyLog ? 1 : 0,
    };
  }, [isVolunteer, selectedProject, volunteerTimeLogs]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (isVolunteer) {
      setReportType('event_performance');
      setSelectedProject(current => current || projects[0]?.id);
    }
  }, [isVolunteer, projects, visible]);

  useEffect(() => {
    if (!visible || !isVolunteer || !selectedProject || title.trim()) {
      return;
    }

    const selectedEvent = projects.find(project => project.id === selectedProject);
    if (!selectedEvent) {
      return;
    }

    setTitle(`${selectedEvent.title} Volunteer Reflection`);
  }, [isVolunteer, projects, selectedProject, title, visible]);

  const reportTypeOptions: {
    value: SubmittedReport['reportType'];
    label: string;
    icon: MaterialIconName;
  }[] = [
    { value: 'field_report', label: 'Field Report', icon: 'assignment' },
    { value: 'volunteer_engagement', label: 'Volunteer Engagement', icon: 'people' },
    { value: 'program_impact', label: 'Program Impact', icon: 'trending-up' },
    { value: 'event_performance', label: 'Event Performance', icon: 'event' },
    { value: 'partner_collaboration', label: 'Partner Collaboration', icon: 'groups' },
    { value: 'system_metrics', label: 'System Metrics', icon: 'analytics' },
  ];

  const getMetricFieldsForType = () => {
    if (isVolunteer) {
      return ['beneficiariesServed'];
    }

    const baseFields = ['volunteerHours', 'verifiedAttendance', 'activeVolunteers'];

    switch (reportType) {
      case 'field_report':
      case 'program_impact':
        return ['beneficiariesServed', 'tasksCompleted'];
      case 'event_performance':
        return ['eventsCount', 'geofenceCompliance'];
      default:
        return baseFields;
    }
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};

    if (!title.trim()) {
      nextErrors.title = 'Title is required';
    }

    if (isVolunteer && !selectedProject) {
      nextErrors.project = `${entityLabel} is required`;
    }

    if (isVolunteer) {
      if (!volunteerSummary.trim()) {
        nextErrors.volunteerSummary = 'Tell the admin what happened during the event';
      }
      if (!volunteerExperience.trim()) {
        nextErrors.volunteerExperience = 'Share your experience during the event';
      }
      if (!description.trim()) {
        nextErrors.description = 'Add a short summary for the admin side';
      }
    } else {
      if (!description.trim()) {
        nextErrors.description = 'Description is required';
      }

      const relevantMetrics = getMetricFieldsForType();
      const hasAnyMetric = relevantMetrics.some(
        field => metrics[field as keyof typeof metrics]
      );

      if (!hasAnyMetric) {
        nextErrors.metrics = 'At least one metric is required';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handlePickPhoto = useCallback(async () => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (!pickedImage) {
        return;
      }

      setSelectedPhotoUri(pickedImage);
    } catch (error: any) {
      Alert.alert(
        'Photo Access Needed',
        error?.message || 'Unable to open your photo library.'
      );
    }
  }, []);

  const handleReset = useCallback(() => {
    setTitle('');
    setDescription('');
    setSelectedProject(undefined);
    setSelectedPhotoUri('');
    setVolunteerSummary('');
    setVolunteerContribution('');
    setVolunteerExperience('');
    setVolunteerFollowUp('');
    setMetrics({
      volunteerHours: '',
      verifiedAttendance: '',
      activeVolunteers: '',
      beneficiariesServed: '',
      tasksCompleted: '',
      eventsCount: '',
      geofenceCompliance: '',
    });
    setErrors({});
    setShowProjectPicker(false);
    setReportType(isVolunteer ? 'event_performance' : 'volunteer_engagement');
  }, [isVolunteer]);

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleMetricChange = (field: string, value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    setMetrics(prev => ({
      ...prev,
      [field]: numericValue,
    }));
  };

  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      return;
    }

    // Check if volunteer has timed in for this project
    if (isVolunteer && selectedProject && volunteerTimeLogs) {
      const hasTimeIn = volunteerTimeLogs.some(log =>
        log.project_id === selectedProject && log.time_in && !log.time_out
      );

      if (!hasTimeIn) {
        Alert.alert(
          'Time-in Required',
          'You must time-in to this event before you can submit a report. Please use the time tracking feature first.'
        );
        return;
      }
    }

    const selectedProjectData = selectedProject
      ? projects.find(project => project.id === selectedProject)
      : undefined;

    const volunteerMetricValues = isVolunteer
      ? {
          volunteerHours: volunteerMetrics.volunteerHours,
          tasksCompleted: volunteerMetrics.tasksCompleted,
        }
      : {};

    const manualMetricsFields = getMetricFieldsForType();
    const manualMetrics = Object.fromEntries(
      manualMetricsFields
        .filter(field => metrics[field as keyof typeof metrics])
        .map(field => [
          field,
          Number.parseInt(metrics[field as keyof typeof metrics], 10),
        ])
    );

    const metricsData = {
      ...volunteerMetricValues,
      ...manualMetrics,
    };

    const volunteerNarrative = isVolunteer
      ? [
          volunteerSummary.trim()
            ? `What happened during the event:\n${volunteerSummary.trim()}`
            : '',
          volunteerContribution.trim()
            ? `What I helped with:\n${volunteerContribution.trim()}`
            : '',
          volunteerExperience.trim()
            ? `My experience:\n${volunteerExperience.trim()}`
            : '',
          volunteerFollowUp.trim()
            ? `Suggestions or follow-up needs:\n${volunteerFollowUp.trim()}`
            : '',
          description.trim()
            ? `Short admin summary:\n${description.trim()}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      : description.trim();

    const reportData: Omit<
      SubmittedReport,
      'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'
    > = {
      reportType,
      title: title.trim() || `${selectedProjectData?.title || 'Event'} Volunteer Reflection`,
      description: volunteerNarrative,
      projectId: selectedProject,
      projectTitle: selectedProjectData?.title,
      category: selectedProjectData?.category,
      metrics: metricsData,
      attachments: [],
      mediaFile: selectedPhotoUri || undefined,
      status: 'Submitted',
    };

    onSubmit(reportData);
    handleReset();
  }, [
    description,
    handleReset,
    isVolunteer,
    metrics,
    onSubmit,
    projects,
    reportType,
    selectedPhotoUri,
    selectedProject,
    title,
    volunteerContribution,
    volunteerExperience,
    volunteerFollowUp,
    volunteerSummary,
  ]);

  const renderVolunteerFields = () => (
    <>
      <View style={styles.volunteerIntroCard}>
        <View style={styles.volunteerIntroIcon}>
          <MaterialIcons name="volunteer-activism" size={20} color="#166534" />
        </View>
        <View style={styles.volunteerIntroContent}>
          <Text style={styles.volunteerIntroTitle}>Share your event experience</Text>
          <Text style={styles.volunteerIntroText}>
            Tell the admin what happened, what you worked on, how the event felt on the
            ground, and add a photo if you have one.
          </Text>
        </View>
      </View>

      <Text style={styles.label}>{entityLabel} *</Text>
      <TouchableOpacity
        style={[styles.projectSelector, errors.project && styles.inputError]}
        onPress={() => setShowProjectPicker(!showProjectPicker)}
      >
        <Text style={styles.projectSelectorText}>
          {selectedProject
            ? projects.find(project => project.id === selectedProject)?.title ||
              `Select ${entityLabelLower}`
            : `Select ${entityLabelLower}`}
        </Text>
        <MaterialIcons
          name={showProjectPicker ? 'expand-less' : 'expand-more'}
          size={20}
          color="#666"
        />
      </TouchableOpacity>
      {errors.project ? <Text style={styles.errorText}>{errors.project}</Text> : null}

      {showProjectPicker ? (
        <View style={styles.projectList}>
          {projects.map(project => (
            <TouchableOpacity
              key={project.id}
              style={styles.projectOption}
              onPress={() => {
                setSelectedProject(project.id);
                setShowProjectPicker(false);
              }}
            >
              <Text style={styles.projectOptionText}>{project.title}</Text>
              <Text style={styles.projectOptionCategory}>
                {project.isEvent ? 'Event' : project.category}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Text style={styles.label}>Title *</Text>
      <TextInput
        style={[styles.input, errors.title && styles.inputError]}
        placeholder="Event volunteer reflection"
        value={title}
        onChangeText={setTitle}
        placeholderTextColor="#cbd5e1"
      />
      {errors.title ? <Text style={styles.errorText}>{errors.title}</Text> : null}

      <Text style={styles.sectionTitle}>Volunteer Reflection</Text>

      <Text style={styles.label}>What happened during the event? *</Text>
      <TextInput
        style={[styles.textArea, errors.volunteerSummary && styles.inputError]}
        placeholder="Describe the activities, turnout, important moments, and how the event went."
        value={volunteerSummary}
        onChangeText={setVolunteerSummary}
        multiline
        numberOfLines={4}
        placeholderTextColor="#cbd5e1"
      />
      {errors.volunteerSummary ? (
        <Text style={styles.errorText}>{errors.volunteerSummary}</Text>
      ) : null}

      <Text style={styles.label}>What did you help with?</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Example: registration, setup, assisting participants, distribution, documentation, cleanup."
        value={volunteerContribution}
        onChangeText={setVolunteerContribution}
        multiline
        numberOfLines={3}
        placeholderTextColor="#cbd5e1"
      />

      <Text style={styles.label}>How was your experience? *</Text>
      <TextInput
        style={[styles.textArea, errors.volunteerExperience && styles.inputError]}
        placeholder="Share what you learned, what stood out, or how the event affected you and the community."
        value={volunteerExperience}
        onChangeText={setVolunteerExperience}
        multiline
        numberOfLines={4}
        placeholderTextColor="#cbd5e1"
      />
      {errors.volunteerExperience ? (
        <Text style={styles.errorText}>{errors.volunteerExperience}</Text>
      ) : null}

      <Text style={styles.label}>Any suggestions or follow-up needed?</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Optional: mention issues, supplies needed, or ideas to improve the next event."
        value={volunteerFollowUp}
        onChangeText={setVolunteerFollowUp}
        multiline
        numberOfLines={3}
        placeholderTextColor="#cbd5e1"
      />

      <Text style={styles.sectionTitle}>Auto-generated Event Metrics</Text>
      <Text style={styles.sectionHelper}>
        Volunteer hours and task count are generated automatically from your time log.
      </Text>
      <View style={styles.autoMetricsCard}>
        <View style={styles.autoMetricRow}>
          <Text style={styles.autoMetricLabel}>Volunteer Hours</Text>
          <Text style={styles.autoMetricValue}>
            {selectedProject ? `${volunteerMetrics.volunteerHours.toFixed(1)} hrs` : 'Select an event'}
          </Text>
        </View>
        <View style={styles.autoMetricRow}>
          <Text style={styles.autoMetricLabel}>Tasks Completed</Text>
          <Text style={styles.autoMetricValue}>
            {selectedProject ? volunteerMetrics.tasksCompleted : 'Select an event'}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Optional Impact Numbers</Text>
      <Text style={styles.sectionHelper}>
        Share how many people your event work helped, if you know it.
      </Text>
      <View style={styles.metricsGrid}>
        {getMetricFieldsForType().map(field => (
          <View key={field} style={styles.metricInput}>
            <Text style={styles.metricLabel}>{formatMetricLabel(field, true)}</Text>
            <TextInput
              style={styles.metricInputField}
              placeholder="0"
              value={metrics[field as keyof typeof metrics]}
              onChangeText={value => handleMetricChange(field, value)}
              keyboardType="number-pad"
              placeholderTextColor="#cbd5e1"
            />
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Photo Proof</Text>
      <TouchableOpacity style={styles.photoButton} onPress={handlePickPhoto}>
        <MaterialIcons name="photo-library" size={18} color="#166534" />
        <Text style={styles.photoButtonText}>
          {selectedPhotoUri ? 'Replace Photo' : 'Upload Event Photo'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.photoHint}>
        Optional, but this helps admins verify the event story and keeps documentation in
        one place.
      </Text>

      {selectedPhotoUri ? (
        <View style={styles.photoPreviewCard}>
          {isImageMediaUri(selectedPhotoUri) ? (
            <Image
              source={{ uri: selectedPhotoUri }}
              style={styles.photoPreview}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.photoFallbackCard}>
              <MaterialIcons name="image" size={24} color="#166534" />
            </View>
          )}
          <View style={styles.photoPreviewMeta}>
            <Text style={styles.photoPreviewTitle}>Photo ready for this report</Text>
            <TouchableOpacity onPress={() => setSelectedPhotoUri('')}>
              <Text style={styles.photoRemoveText}>Remove Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Short Admin Summary</Text>
      <Text style={styles.sectionHelper}>
        Write one short summary an admin can scan quickly before opening the full report.
      </Text>
      <TextInput
        style={[styles.textArea, errors.description && styles.inputError]}
        placeholder="Example: We served 45 families, finished registration on time, and the event stayed organized throughout the day."
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        placeholderTextColor="#cbd5e1"
      />
      {errors.description ? <Text style={styles.errorText}>{errors.description}</Text> : null}
    </>
  );

  const renderStandardFields = () => (
    <>
      <Text style={styles.sectionTitle}>Report Type</Text>
      <View style={styles.typeGrid}>
        {reportTypeOptions.map(option => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.typeButton,
              reportType === option.value && styles.typeButtonActive,
            ]}
            onPress={() => setReportType(option.value)}
          >
            <MaterialIcons
              name={option.icon}
              size={20}
              color={reportType === option.value ? '#fff' : '#166534'}
            />
            <Text
              style={[
                styles.typeButtonText,
                reportType === option.value && styles.typeButtonTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Title *</Text>
      <TextInput
        style={[styles.input, errors.title && styles.inputError]}
        placeholder="Report title"
        value={title}
        onChangeText={setTitle}
        placeholderTextColor="#cbd5e1"
      />
      {errors.title ? <Text style={styles.errorText}>{errors.title}</Text> : null}

      <Text style={styles.label}>Description *</Text>
      <TextInput
        style={[styles.textArea, errors.description && styles.inputError]}
        placeholder="Provide details about this report..."
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        placeholderTextColor="#cbd5e1"
      />
      {errors.description ? <Text style={styles.errorText}>{errors.description}</Text> : null}

      <Text style={styles.label}>{entityLabel} (Optional)</Text>
      <TouchableOpacity
        style={[styles.projectSelector, errors.project && styles.inputError]}
        onPress={() => setShowProjectPicker(!showProjectPicker)}
      >
        <Text style={styles.projectSelectorText}>
          {selectedProject
            ? projects.find(project => project.id === selectedProject)?.title ||
              `Select ${entityLabelLower}`
            : `Select ${entityLabelLower}`}
        </Text>
        <MaterialIcons
          name={showProjectPicker ? 'expand-less' : 'expand-more'}
          size={20}
          color="#666"
        />
      </TouchableOpacity>

      {showProjectPicker ? (
        <View style={styles.projectList}>
          <TouchableOpacity
            style={styles.projectOption}
            onPress={() => {
              setSelectedProject(undefined);
              setShowProjectPicker(false);
            }}
          >
            <Text style={styles.projectOptionText}>No project</Text>
          </TouchableOpacity>
          {projects.map(project => (
            <TouchableOpacity
              key={project.id}
              style={styles.projectOption}
              onPress={() => {
                setSelectedProject(project.id);
                setShowProjectPicker(false);
              }}
            >
              <Text style={styles.projectOptionText}>{project.title}</Text>
              <Text style={styles.projectOptionCategory}>
                {project.isEvent ? 'Event' : project.category}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>
        Metrics {errors.metrics ? <Text style={styles.errorBadge}>Required</Text> : null}
      </Text>
      {errors.metrics ? <Text style={styles.errorText}>{errors.metrics}</Text> : null}
      <View style={styles.metricsGrid}>
        {getMetricFieldsForType().map(field => (
          <View key={field} style={styles.metricInput}>
            <Text style={styles.metricLabel}>{formatMetricLabel(field)}</Text>
            <TextInput
              style={styles.metricInputField}
              placeholder="0"
              value={metrics[field as keyof typeof metrics]}
              onChangeText={value => handleMetricChange(field, value)}
              keyboardType="number-pad"
              placeholderTextColor="#cbd5e1"
            />
          </View>
        ))}
      </View>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {isVolunteer ? 'Volunteer Event Report' : 'New Report'}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <MaterialIcons name="close" size={24} color="#0f172a" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator>
            {isVolunteer ? renderVolunteerFields() : renderStandardFields()}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSubmit} style={styles.submitButton}>
              <MaterialIcons name="check-circle" size={18} color="#fff" />
              <Text style={styles.submitButtonText}>Submit Report</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatMetricLabel(field: string, isVolunteer = false): string {
  const labels: Record<string, string> = {
    volunteerHours: isVolunteer ? 'Hours You Volunteered' : 'Volunteer Hours',
    verifiedAttendance: 'Verified Attendance',
    activeVolunteers: 'Active Volunteers',
    beneficiariesServed: isVolunteer ? 'People You Helped' : 'Beneficiaries Served',
    tasksCompleted: isVolunteer ? 'Tasks You Finished' : 'Tasks Completed',
    eventsCount: 'Events Count',
    geofenceCompliance: 'Geofence Compliance %',
  };

  return labels[field] || field;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
    justifyContent: 'flex-end',
  },
  container: {
    height: '90%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingTop: 20,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  content: {
    flex: 1,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 16,
    marginBottom: 12,
  },
  sectionHelper: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
    marginTop: -4,
    marginBottom: 10,
  },
  volunteerIntroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#ecfdf3',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 14,
    marginBottom: 4,
  },
  volunteerIntroIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  volunteerIntroContent: {
    flex: 1,
    gap: 4,
  },
  volunteerIntroTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#14532d',
  },
  volunteerIntroText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#166534',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  typeButton: {
    flex: Platform.select({ web: 0, default: 1 }),
    minWidth: Platform.select({ web: 140, default: 110 }),
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  typeButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  typeButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#166534',
    textAlign: 'center',
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 12,
    marginBottom: 8,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  inputError: {
    borderColor: '#dc2626',
    backgroundColor: '#fee2e2',
  },
  errorText: {
    marginTop: 4,
    fontSize: 11,
    color: '#dc2626',
    fontWeight: '600',
  },
  errorBadge: {
    color: '#dc2626',
    fontWeight: '700',
  },
  textArea: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    textAlignVertical: 'top',
  },
  projectSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
  },
  projectSelectorText: {
    fontSize: 14,
    color: '#0f172a',
    flex: 1,
  },
  projectList: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 8,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
  },
  projectOption: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  projectOptionText: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '500',
  },
  projectOptionCategory: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  metricInput: {
    flex: 1,
    minWidth: '45%',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  metricInputField: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  photoButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  photoButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  photoHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
    marginTop: 8,
  },
  photoPreviewCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dcfce7',
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  photoPreview: {
    width: '100%',
    height: 180,
    backgroundColor: '#e2e8f0',
  },
  photoFallbackCard: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf3',
  },
  photoPreviewMeta: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  photoPreviewTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  photoRemoveText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b91c1c',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  submitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#166534',
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  autoMetricsCard: {
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 20,
  },
  autoMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  autoMetricLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  autoMetricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
  },
});
