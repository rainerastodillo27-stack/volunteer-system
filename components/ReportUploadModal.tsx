import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { SubmittedReport } from '../screens/ReportsScreen';

interface ReportUploadModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (report: Omit<SubmittedReport, 'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'>) => void;
  projects?: any[];
}

export default function ReportUploadModal({ visible, onClose, onSubmit, projects = [] }: ReportUploadModalProps) {
  const [reportType, setReportType] = useState<SubmittedReport['reportType']>('volunteer_engagement');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
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

  const reportTypeOptions: { value: SubmittedReport['reportType']; label: string; icon: string }[] = [
    { value: 'volunteer_engagement', label: 'Volunteer Engagement', icon: 'people' },
    { value: 'program_impact', label: 'Program Impact', icon: 'trending-up' },
    { value: 'event_performance', label: 'Event Performance', icon: 'event' },
    { value: 'partner_collaboration', label: 'Partner Collaboration', icon: 'handshake' },
    { value: 'system_metrics', label: 'System Metrics', icon: 'analytics' },
  ];

  const getMetricFieldsForType = () => {
    const baseFields = ['volunteerHours', 'verifiedAttendance', 'activeVolunteers'];
    
    switch (reportType) {
      case 'program_impact':
        return ['beneficiariesServed', 'tasksCompleted'];
      case 'event_performance':
        return ['eventsCount', 'geofenceCompliance'];
      default:
        return baseFields;
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!title.trim()) newErrors.title = 'Title is required';
    if (!description.trim()) newErrors.description = 'Description is required';

    const relevantMetrics = getMetricFieldsForType();
    const hasAnyMetric = relevantMetrics.some(field => metrics[field as keyof typeof metrics]);
    
    if (!hasAnyMetric) {
      newErrors.metrics = 'At least one metric is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = useCallback(() => {
    if (!validateForm()) return;

    const relevantMetrics = getMetricFieldsForType();
    const metricsData = Object.fromEntries(
      relevantMetrics
        .filter(field => metrics[field as keyof typeof metrics])
        .map(field => [field, parseInt(metrics[field as keyof typeof metrics], 10)])
    );

    const selectedProjectData = selectedProject
      ? projects.find(p => p.id === selectedProject)
      : undefined;

    const reportData: Omit<SubmittedReport, 'id' | 'submittedAt' | 'submittedBy' | 'submitterName' | 'submitterRole' | 'viewedBy'> = {
      reportType,
      title,
      description,
      projectId: selectedProject,
      projectTitle: selectedProjectData?.title,
      category: selectedProjectData?.category,
      metrics: metricsData,
      status: 'Submitted',
      attachments: [],
    };

    onSubmit(reportData);
    handleReset();
  }, [reportType, title, description, selectedProject, metrics, projects, onSubmit]);

  const handleReset = () => {
    setTitle('');
    setDescription('');
    setSelectedProject(undefined);
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
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleMetricChange = (field: string, value: string) => {
    const numValue = value.replace(/[^0-9]/g, '');
    setMetrics(prev => ({
      ...prev,
      [field]: numValue,
    }));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>New Report</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <MaterialIcons name="close" size={24} color="#0f172a" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator>
            {/* Report Type Selection */}
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
                    name={option.icon as any}
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

            {/* Title Input */}
            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={[styles.input, errors.title && styles.inputError]}
              placeholder="Report title"
              value={title}
              onChangeText={setTitle}
              placeholderTextColor="#cbd5e1"
            />
            {errors.title && <Text style={styles.errorText}>{errors.title}</Text>}

            {/* Description Input */}
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
            {errors.description && <Text style={styles.errorText}>{errors.description}</Text>}

            {/* Project Selection (Optional) */}
            <Text style={styles.label}>Project (Optional)</Text>
            <TouchableOpacity
              style={styles.projectSelector}
              onPress={() => setShowProjectPicker(!showProjectPicker)}
            >
              <Text style={styles.projectSelectorText}>
                {selectedProject
                  ? projects.find(p => p.id === selectedProject)?.title || 'Select project'
                  : 'Select project'}
              </Text>
              <MaterialIcons
                name={showProjectPicker ? 'expand-less' : 'expand-more'}
                size={20}
                color="#666"
              />
            </TouchableOpacity>

            {showProjectPicker && (
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
                    <Text style={styles.projectOptionCategory}>{project.category}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Metrics Input */}
            <Text style={styles.sectionTitle}>Metrics {errors.metrics && <Text style={styles.errorBadge}>Required</Text>}</Text>
            {errors.metrics && <Text style={styles.errorText}>{errors.metrics}</Text>}

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
          </ScrollView>

          {/* Action Buttons */}
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

function formatMetricLabel(field: string): string {
  const labels: Record<string, string> = {
    volunteerHours: 'Volunteer Hours',
    verifiedAttendance: 'Verified Attendance',
    activeVolunteers: 'Active Volunteers',
    beneficiariesServed: 'Beneficiaries Served',
    tasksCompleted: 'Tasks Completed',
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
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  typeButton: {
    flex: Platform.select({ web: 0, default: 1 }),
    minWidth: Platform.select({ web: 140, default: '30%' }),
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
});
