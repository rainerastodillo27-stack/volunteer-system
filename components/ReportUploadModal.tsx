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
  Keyboard,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type {
  PartnerProjectReportSummary,
  SubmittedReport,
} from '../screens/ReportsScreen';
import type { Project, VolunteerProjectJoinRecord, VolunteerTimeLog } from '../models/types';
import { isImageMediaUri, pickImageFromDevice } from '../utils/media';
import { useAuth } from '../contexts/AuthContext';

type MaterialIconName = keyof typeof MaterialIcons.glyphMap;

interface ReportUploadModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (
    report: Omit<
      SubmittedReport,
      'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'
    >
  ) => Promise<boolean | void>;
  projects?: any[];
  userRole?: SubmittedReport['submitterRole'];
  volunteerTimeLogs?: VolunteerTimeLog[];
  volunteerJoinRecords?: VolunteerProjectJoinRecord[];
  fieldOfficerProjectIds?: string[];
  initialProjectId?: string;
  initialDescription?: string;
  partnerProjectSummaries?: PartnerProjectReportSummary[];
  volunteerProfileId?: string | null;
}

export default function ReportUploadModal({
  visible,
  onClose,
  onSubmit,
  projects = [],
  userRole,
  volunteerTimeLogs,
  volunteerJoinRecords,
  fieldOfficerProjectIds = [],
  initialProjectId,
  initialDescription,
  partnerProjectSummaries = [],
  volunteerProfileId,
}: ReportUploadModalProps) {
  const { user } = useAuth();
  const [reportType, setReportType] =
    useState<SubmittedReport['reportType']>('volunteer_engagement');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
  const [collaborationFeedback, setCollaborationFeedback] = useState('');
  const [volunteerPraise, setVolunteerPraise] = useState('');
  const [gratitudeNote, setGratitudeNote] = useState('');
  const [selectedReportPhoto, setSelectedReportPhoto] = useState('');
  const [metrics, setMetrics] = useState({
    volunteerEventJoins: '',
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
  const isPartner = userRole === 'partner';
  const entityLabel = isVolunteer ? 'Event' : 'Project';
  const entityLabelLower = entityLabel.toLowerCase();

  const isVolunteerAssignedToTask = useCallback(
    (task: { assignedVolunteerId?: string; assignedVolunteerIds?: string[] }) => {
      if (!volunteerProfileId) {
        return false;
      }

      const assignedVolunteerIds = Array.from(
        new Set(
          [
            ...(Array.isArray(task.assignedVolunteerIds) ? task.assignedVolunteerIds : []),
            task.assignedVolunteerId,
          ]
            .map(value => String(value || '').trim())
            .filter(Boolean)
        )
      );

      return assignedVolunteerIds.includes(volunteerProfileId);
    },
    [volunteerProfileId]
  );

  const getLocalDateKey = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  };

  const volunteerMetrics = useMemo(() => {
    if (!isVolunteer || !selectedProject) {
      return {
        volunteerEventJoins: 0,
        tasksCompleted: 0,
        attendanceDays: 0,
        hoursServed: 0,
        latestAttendancePhoto: '',
        assignedTaskTitles: [] as string[],
      };
    }

    const logsForProject = (volunteerTimeLogs || []).filter(log => log.projectId === selectedProject);
    const eventJoinCount = (volunteerJoinRecords || []).filter(
      record =>
        record.projectId === selectedProject &&
        (!volunteerProfileId || record.volunteerId === volunteerProfileId)
    ).length;
    const attendanceDays = new Set(
      logsForProject
        .filter(log => Boolean(log.attendanceConfirmedAt || log.timeIn))
        .map(log => getLocalDateKey(log.attendanceConfirmedAt || log.timeIn || ''))
        .filter(Boolean)
    ).size;
    const hoursServed = logsForProject.reduce((sum, log) => {
      if (!log.timeIn || !log.timeOut) {
        return sum;
      }
      const duration =
        (new Date(log.timeOut).getTime() - new Date(log.timeIn).getTime()) / 3_600_000;
      return sum + Math.max(0, duration);
    }, 0);
    const latestPhotoLog = [...logsForProject]
      .sort(
        (left, right) =>
          new Date(right.attendanceConfirmedAt || right.timeIn).getTime() -
          new Date(left.attendanceConfirmedAt || left.timeIn).getTime()
      )
      .find(log => Boolean((log.attendancePhoto || log.completionPhoto || '').trim()));
    const selectedProjectRecord = projects.find(
      project => project.id === selectedProject
    ) as Project | undefined;
    const assignedTaskTitles = selectedProjectRecord
      ? (selectedProjectRecord.internalTasks || [])
          .filter(task => isVolunteerAssignedToTask(task))
          .map(task => task.title)
      : [];

    return {
      volunteerEventJoins: eventJoinCount,
      tasksCompleted: assignedTaskTitles.length,
      attendanceDays,
      hoursServed,
      latestAttendancePhoto: latestPhotoLog?.attendancePhoto || latestPhotoLog?.completionPhoto || '',
      assignedTaskTitles,
    };
  }, [
    isVolunteer,
    isVolunteerAssignedToTask,
    projects,
    selectedProject,
    volunteerJoinRecords,
    volunteerProfileId,
    volunteerTimeLogs,
  ]);

  const selectedProjectData = useMemo(
    () =>
      selectedProject
        ? (projects.find(project => project.id === selectedProject) as Project | undefined)
        : undefined,
    [projects, selectedProject]
  );
  const selectedPartnerProjectSummary = useMemo(
    () =>
      isPartner
        ? partnerProjectSummaries.find(summary => summary.project.id === selectedProject)
        : undefined,
    [isPartner, partnerProjectSummaries, selectedProject]
  );
  const isFieldOfficerForSelectedProject = useMemo(
    () => Boolean(selectedProject && fieldOfficerProjectIds.includes(selectedProject)),
    [fieldOfficerProjectIds, selectedProject]
  );
  const volunteerReportType = isFieldOfficerForSelectedProject ? 'field_report' : 'event_performance';
  const volunteerReportLabel = isFieldOfficerForSelectedProject ? 'Field Report' : 'Volunteer Report';

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (isVolunteer) {
      setReportType(volunteerReportType);
      setSelectedProject(current => current || projects[0]?.id);
    }

    if (isPartner) {
      setReportType('program_impact');
      setSelectedProject(current => current || projects[0]?.id);
    }

    if (initialProjectId) {
      setSelectedProject(initialProjectId);
    }
    if (initialDescription) {
      setDescription(initialDescription);
    }
  }, [
    initialDescription,
    initialProjectId,
    isPartner,
    isVolunteer,
    projects,
    visible,
    volunteerReportType,
  ]);

  useEffect(() => {
    if (!visible || !isVolunteer) {
      return;
    }

    setReportType(volunteerReportType);
  }, [isVolunteer, visible, volunteerReportType]);

  useEffect(() => {
    if (!visible || !isPartner || !selectedPartnerProjectSummary) {
      return;
    }

    setTitle(selectedPartnerProjectSummary.generatedTitle);
    setDescription(selectedPartnerProjectSummary.project.description || '');
    setReportType('program_impact');
  }, [isPartner, selectedPartnerProjectSummary, visible]);

  useEffect(() => {
    if (!visible || !isVolunteer || !selectedProject || title.trim()) {
      return;
    }

    const selectedEvent = projects.find(project => project.id === selectedProject);
    if (!selectedEvent) {
      return;
    }

    setTitle(
      isFieldOfficerForSelectedProject
        ? `${selectedEvent.title} Field Officer Report`
        : `${selectedEvent.title} Event Report`
    );
  }, [isFieldOfficerForSelectedProject, isVolunteer, projects, selectedProject, title, visible]);

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

    const baseFields = ['volunteerEventJoins', 'verifiedAttendance', 'activeVolunteers'];

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

    if (!title.trim() && !isPartner) {
      nextErrors.title = 'Title is required';
    }

    if ((isVolunteer || isPartner) && !selectedProject) {
      nextErrors.project = `${entityLabel} is required`;
    }

    if (isVolunteer) {
      if (!description.trim()) {
        nextErrors.description = 'Add a short summary for the admin side';
      }
    } else if (isPartner) {
      if (!selectedPartnerProjectSummary) {
        nextErrors.project = 'Select an approved project';
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

  const handleReset = useCallback(() => {
    setTitle('');
    setDescription('');
    setSelectedProject(undefined);
    setCollaborationFeedback('');
    setVolunteerPraise('');
    setGratitudeNote('');
    setSelectedReportPhoto('');
    setMetrics({
      volunteerEventJoins: '',
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

  const handlePickReportPhoto = useCallback(async () => {
    try {
      const pickedImage = await pickImageFromDevice();
      if (pickedImage) {
        setSelectedReportPhoto(pickedImage);
      }
    } catch (error: any) {
      Alert.alert('Photo Access Needed', error?.message || 'Unable to open your photo library.');
    }
  }, []);

  const handleRemoveReportPhoto = useCallback(() => {
    setSelectedReportPhoto('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    // Check if volunteer has timed in for this project
    if (isVolunteer && selectedProject && volunteerTimeLogs) {
      const hasTimeIn = volunteerTimeLogs.some(log =>
        log.projectId === selectedProject && Boolean(log.timeIn)
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
      ? (projects.find(project => project.id === selectedProject) as Project | undefined)
      : undefined;

    if (isPartner) {
      if (!selectedProject || !selectedPartnerProjectSummary) {
        return;
      }

      const reportData: Omit<
        SubmittedReport,
        'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'
      > = {
        reportType: 'program_impact',
        title: selectedPartnerProjectSummary.generatedTitle,
        description: description.trim() || selectedPartnerProjectSummary.project.description || '',
        projectId: selectedPartnerProjectSummary.project.id,
        projectTitle: selectedPartnerProjectSummary.project.title,
        category: selectedPartnerProjectSummary.project.category,
        metrics: selectedPartnerProjectSummary.metrics,
        attachments: [],
        mediaFile: undefined,
        status: 'Approved',
        approvedAt: new Date().toISOString(),
        approvedBy: user?.name || 'System',
        collaborationFeedback: collaborationFeedback.trim() || undefined,
        volunteerPraise: volunteerPraise.trim() || undefined,
        gratitudeNote: gratitudeNote.trim() || undefined,
      };

      Keyboard.dismiss();
      const submissionSucceeded = await onSubmit(reportData);
      if (submissionSucceeded === false) {
        return;
      }

      handleReset();
      onClose();
      return;
    }

    const volunteerMetricValues = isVolunteer
      ? {
          volunteerHours: Number(volunteerMetrics.hoursServed.toFixed(1)),
          volunteerEventJoins: volunteerMetrics.volunteerEventJoins,
          verifiedAttendance: volunteerMetrics.attendanceDays,
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
          volunteerMetrics.assignedTaskTitles.length
            ? `Assigned event task:\n${volunteerMetrics.assignedTaskTitles.join(', ')}`
            : '',
          description.trim() ? `Summary:\n${description.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      : description.trim();

    const reportData: Omit<
      SubmittedReport,
      'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'
    > = {
      reportType,
      title: title.trim() || `${selectedProjectData?.title || 'Event'} Event Report`,
      description: volunteerNarrative,
      projectId: selectedProject,
      projectTitle: selectedProjectData?.title,
      category: selectedProjectData?.category,
      metrics: metricsData,
      attachments: [],
      mediaFile: isVolunteer
        ? selectedReportPhoto || volunteerMetrics.latestAttendancePhoto || undefined
        : undefined,
      status: 'Approved',
      approvedAt: new Date().toISOString(),
      approvedBy: user?.name || 'System',
    };

    Keyboard.dismiss();
    const submissionSucceeded = await onSubmit(reportData);
    if (submissionSucceeded === false) {
      return;
    }

    handleReset();
    onClose();

  }, [
    collaborationFeedback,
    description,
    gratitudeNote,
    handleReset,
    isPartner,
    isVolunteer,
    metrics,
    onSubmit,
    projects,
    reportType,
    selectedProject,
    selectedPartnerProjectSummary,
    title,
    volunteerPraise,
    volunteerMetrics.assignedTaskTitles,
    volunteerMetrics.attendanceDays,
    volunteerMetrics.hoursServed,
    volunteerMetrics.latestAttendancePhoto,
    volunteerMetrics.tasksCompleted,
    volunteerMetrics.volunteerEventJoins,
    selectedReportPhoto,
    volunteerTimeLogs,
    onClose,
  ]);

  const renderPartnerFields = () => (
    <>
      <View style={styles.partnerIntroCard}>
        <View style={styles.partnerIntroIcon}>
          <MaterialIcons name="business-center" size={20} color="#166534" />
        </View>
        <View style={styles.partnerIntroContent}>
          <Text style={styles.partnerIntroTitle}>Approved Project Report</Text>
          <Text style={styles.partnerIntroText}>
            Choose one approved project that your account proposed. The title, description, and metrics are generated automatically from linked events, volunteer event joins, volunteer reports, and verified time logs.
          </Text>
        </View>
      </View>

      <Text style={styles.label}>Approved Project *</Text>
      <TouchableOpacity
        style={[styles.projectSelector, errors.project && styles.inputError]}
        onPress={() => setShowProjectPicker(!showProjectPicker)}
      >
        <Text style={styles.projectSelectorText}>
          {selectedProjectData?.title || `Select ${entityLabelLower}`}
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
                {project.programModule || project.category}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={selectedPartnerProjectSummary?.generatedTitle || ''}
        placeholder="Generated project report title"
        editable={false}
        placeholderTextColor="#cbd5e1"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={styles.textArea}
        value={description}
        placeholder="Project description"
        editable={false}
        multiline
        numberOfLines={6}
        placeholderTextColor="#cbd5e1"
      />

      <Text style={styles.sectionTitle}>Auto-Generated Metrics</Text>
      <View style={styles.metricsGrid}>
        <View style={styles.metricInput}>
          <Text style={styles.metricLabel}>Active Volunteers</Text>
          <TextInput
            style={styles.metricInputField}
            value={String(selectedPartnerProjectSummary?.metrics.activeVolunteers || 0)}
            editable={false}
            placeholder="0"
            placeholderTextColor="#cbd5e1"
          />
        </View>
        <View style={styles.metricInput}>
          <Text style={styles.metricLabel}>Volunteer Event Joins</Text>
          <TextInput
            style={styles.metricInputField}
            value={String(
              selectedPartnerProjectSummary?.metrics.volunteerEventJoins ??
                selectedPartnerProjectSummary?.metrics.volunteerHours ??
                0
            )}
            editable={false}
            placeholder="0"
            placeholderTextColor="#cbd5e1"
          />
        </View>
        <View style={styles.metricInput}>
          <Text style={styles.metricLabel}>Verified Attendance</Text>
          <TextInput
            style={styles.metricInputField}
            value={String(selectedPartnerProjectSummary?.metrics.verifiedAttendance || 0)}
            editable={false}
            placeholder="0"
            placeholderTextColor="#cbd5e1"
          />
        </View>
        <View style={styles.metricInput}>
          <Text style={styles.metricLabel}>Beneficiaries Served</Text>
          <TextInput
            style={styles.metricInputField}
            value={String(selectedPartnerProjectSummary?.metrics.beneficiariesServed || 0)}
            editable={false}
            placeholder="0"
            placeholderTextColor="#cbd5e1"
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Partner Feedback</Text>
      <Text style={styles.label}>How Was the Collaboration?</Text>
      <TextInput
        style={styles.textArea}
        value={collaborationFeedback}
        onChangeText={setCollaborationFeedback}
        placeholder="Share how the collaboration with volunteers and coordinators went."
        multiline
        numberOfLines={4}
        placeholderTextColor="#cbd5e1"
      />

      <Text style={styles.label}>Praise for the Volunteers</Text>
      <TextInput
        style={styles.textArea}
        value={volunteerPraise}
        onChangeText={setVolunteerPraise}
        placeholder="Highlight volunteer effort, teamwork, or standout support."
        multiline
        numberOfLines={4}
        placeholderTextColor="#cbd5e1"
      />

      <Text style={styles.label}>Thank You Note</Text>
      <TextInput
        style={styles.textArea}
        value={gratitudeNote}
        onChangeText={setGratitudeNote}
        placeholder="Add a short thank-you message for the volunteers."
        multiline
        numberOfLines={3}
        placeholderTextColor="#cbd5e1"
      />
    </>
  );

  const renderVolunteerFields = () => (
    <>
      <View style={styles.volunteerIntroCard}>
        <View style={styles.volunteerIntroIcon}>
          <MaterialIcons name="volunteer-activism" size={20} color="#166534" />
        </View>
        <View style={styles.volunteerIntroContent}>
          <Text style={styles.volunteerIntroTitle}>Share your event experience</Text>
          <Text style={styles.volunteerIntroText}>
            {isFieldOfficerForSelectedProject
              ? 'Submit the field officer report for this event. Capture what happened on site, team coordination, and operational outcomes.'
              : 'Submit your volunteer report for this event. Share what happened, what you worked on, and add a photo or file if you have one.'}
          </Text>
        </View>
      </View>

      <View style={styles.reportModeCard}>
        <Text style={styles.reportModeLabel}>Report Type</Text>
        <Text style={styles.reportModeValue}>{volunteerReportLabel}</Text>
        <Text style={styles.reportModeHint}>
          {isFieldOfficerForSelectedProject
            ? 'Field reports are reserved for the assigned field officer of this event.'
            : 'Volunteer reports are for volunteers who are not the field officer for this event.'}
        </Text>
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
        placeholder="Event report title"
        value={title}
        onChangeText={setTitle}
        placeholderTextColor="#cbd5e1"
      />
      {errors.title ? <Text style={styles.errorText}>{errors.title}</Text> : null}

      {isVolunteer && selectedProjectData ? (
        <View style={styles.eventSummaryCard}>
          <Text style={styles.eventSummaryLabel}>Event Schedule</Text>
          <Text style={styles.eventSummaryValue}>
            {`${new Date(selectedProjectData.startDate).toLocaleDateString()} - ${new Date(
              selectedProjectData.endDate
            ).toLocaleDateString()}`}
          </Text>
          <Text style={styles.eventSummaryHint}>
            Time-in days are counted from your log entries for this event until the end date.
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Event Summary</Text>

      <Text style={styles.label}>Assigned Event Task</Text>
      <View style={styles.readOnlyCardLarge}>
        <Text style={styles.readOnlyDescription}>
          {selectedProject
            ? volunteerMetrics.assignedTaskTitles.length
              ? volunteerMetrics.assignedTaskTitles.join(', ')
              : 'No assigned event task found for this event yet.'
            : 'Select an event to load your assigned task.'}
        </Text>
      </View>



      <Text style={styles.sectionTitle}>Report Photo</Text>
      <Text style={styles.sectionHelper}>
        Add a supporting photo from your device. If you do not choose one, the attendance photo from your event record will be used automatically.
      </Text>
      {selectedReportPhoto ? (
        <View style={styles.photoPreviewCard}>
          {isImageMediaUri(selectedReportPhoto) ? (
            <Image
              source={{ uri: selectedReportPhoto }}
              style={styles.photoPreview}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.photoFallbackCard}>
              <MaterialIcons name="image" size={24} color="#166534" />
            </View>
          )}
          <View style={styles.photoPreviewMeta}>
            <Text style={styles.photoPreviewTitle}>Selected photo for this report</Text>
            <TouchableOpacity onPress={handleRemoveReportPhoto} style={styles.photoRemoveButton}>
              <Text style={styles.photoRemoveText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View>
          <TouchableOpacity style={styles.photoButton} onPress={handlePickReportPhoto}>
            <MaterialIcons name="photo-library" size={20} color="#166534" />
            <Text style={styles.photoButtonText}>Add Photo</Text>
          </TouchableOpacity>
          {volunteerMetrics.latestAttendancePhoto ? (
            <View style={styles.photoPreviewCard}>
              {isImageMediaUri(volunteerMetrics.latestAttendancePhoto) ? (
                <Image
                  source={{ uri: volunteerMetrics.latestAttendancePhoto }}
                  style={styles.photoPreview}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.photoFallbackCard}>
                  <MaterialIcons name="image" size={24} color="#166534" />
                </View>
              )}
              <View style={styles.photoPreviewMeta}>
                <Text style={styles.photoPreviewTitle}>Attendance photo available for this report</Text>
              </View>
            </View>
          ) : (
            <View style={styles.readOnlyCard}>
              <Text style={styles.readOnlyDescription}>
                {selectedProject
                  ? 'No attendance photo found yet for this event.'
                  : 'Select an event to load the field photo.'}
              </Text>
            </View>
          )}
        </View>
      )}



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
              {isVolunteer ? 'Volunteer Event Report' : isPartner ? 'Partner Project Report' : 'New Report'}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <MaterialIcons name="close" size={24} color="#0f172a" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator>
            {isVolunteer
              ? renderVolunteerFields()
              : isPartner
              ? renderPartnerFields()
              : renderStandardFields()}
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
    volunteerHours: 'Volunteer Hours Served',
    volunteerEventJoins: isVolunteer ? 'Your Event Joins' : 'Volunteer Event Joins',
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
  partnerIntroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    padding: 14,
    marginBottom: 4,
  },
  partnerIntroIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dbeafe',
  },
  partnerIntroContent: {
    flex: 1,
    gap: 4,
  },
  partnerIntroTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  partnerIntroText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#334155',
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
  readOnlyCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbe7dc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fbf8',
  },
  readOnlyCardLarge: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbe7dc',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fbf8',
    minHeight: 110,
  },
  readOnlyValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  readOnlyDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
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
  metricReadOnlyField: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe7dc',
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#f8fbf8',
  },
  metricReadOnlyValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  proofActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoButton: {
    minHeight: 48,
    minWidth: 180,
    flexGrow: 1,
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
  photoRemoveButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  photoPreviewTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  documentPreviewCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dcfce7',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  documentPreviewIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentPreviewMeta: {
    flex: 1,
    gap: 2,
  },
  documentPreviewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  documentPreviewName: {
    fontSize: 12,
    color: '#64748b',
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
  eventSummaryCard: {
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 14,
    marginBottom: 12,
  },
  eventSummaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 4,
  },
  eventSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  eventSummaryHint: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: '#4b5563',
  },
  reportModeCard: {
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe7df',
    padding: 14,
    marginBottom: 12,
  },
  reportModeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reportModeValue: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  reportModeHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#4b5563',
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
