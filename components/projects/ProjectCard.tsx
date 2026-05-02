import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Project } from '../../models/types';
import { getPrimaryProjectImageSource } from '../../utils/projectMap';
import { getProjectStatusColor, getProjectDisplayStatus } from '../../utils/projectStatus';
import { format } from 'date-fns';

interface ProjectCardProps {
  project: Project;
  onPress?: () => void;
}

/**
 * A detailed project card designed to match the 'Project Proposal' aesthetic.
 * This component emphasizes high-quality images and structured proposal-like information grids.
 */
export default function ProjectCard({ project, onPress }: ProjectCardProps) {
  const projectImageSource = getPrimaryProjectImageSource(project);
  const displayStatus = getProjectDisplayStatus(project);
  const statusColor = getProjectStatusColor(project);

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'EEE, dd MMM yyyy');
    } catch {
      return dateString || 'Not specified';
    }
  };

  return (
    <TouchableOpacity 
      activeOpacity={0.9} 
      onPress={onPress}
      style={styles.container}
    >
      {/* Premium Header Image */}
      {projectImageSource ? (
        <View style={styles.imageContainer}>
          <Image 
            source={projectImageSource} 
            style={styles.headerImage} 
            resizeMode="cover" 
          />
          <View style={styles.imageOverlay}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusText}>{displayStatus}</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.imagePlaceholder, { backgroundColor: statusColor + '20' }]}>
          <MaterialIcons name="image" size={40} color={statusColor} />
        </View>
      )}
      
      <View style={styles.content}>
        {/* Header Section */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.categoryText}>
              {project.isEvent ? 'Event' : 'Program'} | {project.programModule || project.category}
            </Text>
            <Text style={styles.titleText}>{project.title}</Text>
          </View>
        </View>

        {/* Proposal Detail Section */}
        <View style={styles.proposalSection}>
          <Text style={styles.sectionTitle}>Proposal Overview</Text>
          
          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Project Schedule</Text>
              <View style={styles.infoValueRow}>
                <MaterialIcons name="calendar-today" size={14} color="#64748b" />
                <Text style={styles.infoValue}>
                  {formatDate(project.startDate)}
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Volunteer Needs</Text>
              <View style={styles.infoValueRow}>
                <MaterialIcons name="groups" size={14} color="#64748b" />
                <Text style={styles.infoValue}>
                  {project.volunteers.length} / {project.volunteersNeeded} Volunteers
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Location</Text>
              <View style={styles.infoValueRow}>
                <MaterialIcons name="place" size={14} color="#64748b" />
                <Text style={styles.infoValue} numberOfLines={1}>
                  {project.location.address}
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Target Skills</Text>
              <View style={styles.infoValueRow}>
                <MaterialIcons name="psychology" size={14} color="#64748b" />
                <Text style={styles.infoValue} numberOfLines={1}>
                  {project.skillsNeeded?.length ? project.skillsNeeded.join(', ') : 'Open to all skills'}
                </Text>
              </View>
            </View>
          </View>

          {/* Narrative Preview */}
          <View style={styles.narrativeCard}>
            <Text style={styles.infoLabel}>Project Summary</Text>
            <Text style={styles.narrativeText} numberOfLines={3}>
              {project.description}
            </Text>
          </View>

          {/* Action Hint */}
          <View style={styles.footerRow}>
            <View style={styles.updateInfo}>
              <MaterialIcons name="history" size={14} color="#94a3b8" />
              <Text style={styles.footerText}>Updated {formatDate(project.updatedAt)}</Text>
            </View>
            <View style={styles.actionPrompt}>
              <Text style={styles.actionPromptText}>View Details</Text>
              <MaterialIcons name="arrow-forward" size={16} color="#2563eb" />
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  imageContainer: {
    width: '100%',
    height: 200,
    position: 'relative',
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 16,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  imagePlaceholder: {
    width: '100%',
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  content: {
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  titleText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
    marginTop: 6,
    lineHeight: 28,
  },
  proposalSection: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  infoCard: {
    flexGrow: 1,
    minWidth: '45%',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    padding: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  narrativeCard: {
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    padding: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  narrativeText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  updateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  actionPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionPromptText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563eb',
  },
});
