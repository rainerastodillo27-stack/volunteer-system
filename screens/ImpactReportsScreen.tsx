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
import { ImpactReport, Project } from '../models/types';
import {
  getImpactReportsByProject,
  getAllProjects,
  saveImpactReport,
} from '../models/storage';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';

export default function ImpactReportsScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<ImpactReport[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [beneficiariesReached, setBeneficiariesReached] = useState('');
  const [hoursContributed, setHoursContributed] = useState('');
  const [volunteersInvolved, setVolunteersInvolved] = useState('');
  const [fundingUtilized, setFundingUtilized] = useState('');
  const [narrative, setNarrative] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects.filter(p => p.status === 'Completed'));
    } catch (error) {
      Alert.alert('Error', 'Failed to load projects');
    }
  };

  const loadReports = async (projectId: string) => {
    try {
      const projectReports = await getImpactReportsByProject(projectId);
      setReports(projectReports);
    } catch (error) {
      Alert.alert('Error', 'Failed to load reports');
    }
  };

  const handleSelectProject = async (project: Project) => {
    setSelectedProject(project);
    await loadReports(project.id);
  };

  const handleAddReport = async () => {
    if (!isAdmin) {
      Alert.alert('Access Restricted', 'Only admin accounts can submit impact reports.');
      return;
    }

    if (
      !beneficiariesReached.trim() ||
      !hoursContributed.trim() ||
      !volunteersInvolved.trim() ||
      !narrative.trim()
    ) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      const report: ImpactReport = {
        id: `report-${Date.now()}`,
        projectId: selectedProject?.id || '',
        category: selectedProject?.category || 'Other',
        metrics: {
          beneficiariesReached: parseInt(beneficiariesReached, 10),
          hoursContributed: parseFloat(hoursContributed),
          volunteersInvolved: parseInt(volunteersInvolved, 10),
          fundingUtilized: parseFloat(fundingUtilized || '0'),
        },
        outcomes: narrative.split('\n').filter(line => line.trim()),
        narrative,
        submittedBy: user?.id || '',
        submittedAt: new Date().toISOString(),
        status: 'Submitted',
      };

      await saveImpactReport(report);
      Alert.alert('Success', 'Impact report submitted');
      setShowReportModal(false);
      setBeneficiariesReached('');
      setHoursContributed('');
      setVolunteersInvolved('');
      setFundingUtilized('');
      setNarrative('');
      if (selectedProject) {
        await loadReports(selectedProject.id);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to submit report');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Draft':
        return '#FFA500';
      case 'Submitted':
        return '#2196F3';
      case 'Approved':
        return '#4CAF50';
      default:
        return '#999';
    }
  };

  if (selectedProject) {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedProject(null)}>
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Impact Report</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.projectTitle}>{selectedProject.title}</Text>
          <View style={styles.categoryRow}>
            <MaterialIcons name="category" size={16} color="#FF9800" />
            <Text style={styles.categoryText}>{selectedProject.category}</Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Summary Metrics</Text>
          <View style={styles.metricsGrid}>
            {reports.length > 0 ? (
              <>
                <View style={styles.metricItem}>
                  <MaterialIcons name="people" size={28} color="#4CAF50" />
                  <Text style={styles.metricValue}>
                    {reports.reduce((sum, r) => sum + r.metrics.beneficiariesReached, 0)}
                  </Text>
                  <Text style={styles.metricLabel}>Beneficiaries</Text>
                </View>
                <View style={styles.metricItem}>
                  <MaterialIcons name="schedule" size={28} color="#2196F3" />
                  <Text style={styles.metricValue}>
                    {reports.reduce((sum, r) => sum + r.metrics.hoursContributed, 0)}
                  </Text>
                  <Text style={styles.metricLabel}>Total Hours</Text>
                </View>
                <View style={styles.metricItem}>
                  <MaterialIcons name="volunteer-activism" size={28} color="#FF9800" />
                  <Text style={styles.metricValue}>
                    {reports.reduce((sum, r) => sum + r.metrics.volunteersInvolved, 0)}
                  </Text>
                  <Text style={styles.metricLabel}>Volunteers</Text>
                </View>
                <View style={styles.metricItem}>
                  <MaterialIcons name="attach-money" size={28} color="#9C27B0" />
                  <Text style={styles.metricValue}>
                    ${reports.reduce((sum, r) => sum + r.metrics.fundingUtilized, 0).toFixed(0)}
                  </Text>
                  <Text style={styles.metricLabel}>Funding Used</Text>
                </View>
              </>
            ) : (
              <View style={styles.emptyMetrics}>
                <Text style={styles.emptyText}>No reports yet</Text>
              </View>
            )}
          </View>
        </View>

        {reports.length > 0 && (
          <View style={styles.scorecard}>
            <Text style={styles.sectionTitle}>Impact Scorecard</Text>
            <View style={styles.scorecardContent}>
              <View style={styles.scoreItem}>
                <Text style={styles.scoreLabel}>Reach Score</Text>
                <View style={styles.scoreBar}>
                  <View
                    style={[
                      styles.scoreBarFill,
                      {
                        width: `${Math.min(100, (reports[0]?.metrics.beneficiariesReached / 100) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={styles.scoreItem}>
                <Text style={styles.scoreLabel}>Engagement Score</Text>
                <View style={styles.scoreBar}>
                  <View
                    style={[
                      styles.scoreBarFill,
                      {
                        width: `${(reports[0]?.metrics.volunteersInvolved / 10) * 100}%`,
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={styles.scoreItem}>
                <Text style={styles.scoreLabel}>Investment Score</Text>
                <View style={styles.scoreBar}>
                  <View
                    style={[
                      styles.scoreBarFill,
                      {
                        width: `${Math.min(100, (reports[0]?.metrics.fundingUtilized / 10000) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
          </View>
        )}

        <View style={styles.reportsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Reports</Text>
            {isAdmin && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowReportModal(true)}
              >
                <MaterialIcons name="add" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {reports.length === 0 ? (
            <Text style={styles.emptyReportsText}>
              {isAdmin ? 'No impact reports yet. Click + to add one.' : 'No impact reports yet.'}
            </Text>
          ) : (
            reports.map(report => (
              <View key={report.id} style={styles.reportItem}>
                <View style={styles.reportHeader}>
                  <View
                    style={[
                      styles.reportStatusBadge,
                      { backgroundColor: getStatusColor(report.status) },
                    ]}
                  >
                    <Text style={styles.reportStatusText}>{report.status}</Text>
                  </View>
                  <Text style={styles.reportDate}>
                    {format(new Date(report.submittedAt), 'MMM dd, yyyy')}
                  </Text>
                </View>
                <Text style={styles.reportNarrative} numberOfLines={2}>
                  {report.narrative}
                </Text>
              </View>
            ))
          )}
        </View>

        <Modal
          visible={showReportModal}
          animationType="slide"
          onRequestClose={() => setShowReportModal(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Submit Impact Report</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <Text style={styles.label}>Beneficiaries Reached</Text>
              <TextInput
                style={styles.input}
                placeholder="Number of people impacted"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                value={beneficiariesReached}
                onChangeText={setBeneficiariesReached}
              />

              <Text style={styles.label}>Volunteer Hours Contributed</Text>
              <TextInput
                style={styles.input}
                placeholder="Total hours"
                placeholderTextColor="#999"
                keyboardType="decimal-pad"
                value={hoursContributed}
                onChangeText={setHoursContributed}
              />

              <Text style={styles.label}>Volunteers Involved</Text>
              <TextInput
                style={styles.input}
                placeholder="Number of volunteers"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                value={volunteersInvolved}
                onChangeText={setVolunteersInvolved}
              />

              <Text style={styles.label}>Funding Utilized ($)</Text>
              <TextInput
                style={styles.input}
                placeholder="Amount spent"
                placeholderTextColor="#999"
                keyboardType="decimal-pad"
                value={fundingUtilized}
                onChangeText={setFundingUtilized}
              />

              <Text style={styles.label}>Narrative Report</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Describe the impact and outcomes..."
                placeholderTextColor="#999"
                multiline
                numberOfLines={6}
                value={narrative}
                onChangeText={setNarrative}
                textAlignVertical="top"
              />

              <TouchableOpacity style={styles.submitButton} onPress={handleAddReport}>
                <Text style={styles.submitButtonText}>Submit Report</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Impact Reports & Scorecards</Text>

      <Text style={styles.subtitle}>
        View completed projects and their impact metrics
      </Text>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="assessment" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No completed projects yet</Text>
        </View>
      ) : (
        projects.map(project => (
          <TouchableOpacity
            key={project.id}
            style={styles.projectCard}
            onPress={() => handleSelectProject(project)}
          >
            <View style={styles.cardContent}>
              <Text style={styles.projectName}>{project.title}</Text>
              <View style={styles.projectMeta}>
                <View style={styles.metaItem}>
                  <MaterialIcons name="category" size={14} color="#FF9800" />
                  <Text style={styles.metaText}>{project.category}</Text>
                </View>
              </View>
            </View>
            <MaterialIcons name="arrow-forward" size={20} color="#999" />
          </TouchableOpacity>
        ))
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
    flex: 1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  projectTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryText: {
    fontSize: 13,
    color: '#FF9800',
    fontWeight: '600',
  },
  projectCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardContent: {
    flex: 1,
  },
  projectName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  projectMeta: {
    flexDirection: 'row',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#666',
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
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricItem: {
    width: '48%',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  metricLabel: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  emptyMetrics: {
    width: '100%',
    padding: 20,
    alignItems: 'center',
  },
  scorecard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  scorecardContent: {
    gap: 16,
  },
  scoreItem: {
    gap: 8,
  },
  scoreLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  scoreBar: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
  },
  reportsSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 30,
  },
  addButton: {
    backgroundColor: '#4CAF50',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 12,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reportStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  reportStatusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  reportDate: {
    fontSize: 11,
    color: '#999',
  },
  reportNarrative: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  emptyReportsText: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
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
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
    color: '#333',
    marginBottom: 16,
  },
  textArea: {
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 30,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
