import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

type Props = {
  isEvent: boolean;
  status: string;
  program: string;
  schedule: string;
  durationDays: number;
  volunteerSlots: string;
  location: string;
  documentLabel: string;
  hasDocument: boolean;
  onDocumentPress?: () => void;
  onDetailsPress: () => void;
  onCreateEvent?: () => void;
  onAttendance?: () => void;
  onReports: () => void;
};

// Columns inside a vertical ScrollView must size to their contents on phones.
// A flex: 1 sidebar in that layout can collapse while its rows overflow it.
export const projectDetailsLayout = StyleSheet.create({
  grid: { gap: 24, alignItems: 'flex-start' },
  gridMobile: { width: '100%', alignItems: 'stretch' },
  column: { minWidth: 0 },
  columnMobile: { width: '100%', flexGrow: 0, flexShrink: 0 },
});

export default function ProjectDetailsSidebar(props: Props) {
  const fields: Array<{
    label: string;
    value: string;
    icon: React.ComponentProps<typeof MaterialIcons>['name'];
    onPress?: () => void;
  }> = [
    { label: 'Status', value: props.status, icon: 'check-circle' },
    { label: 'Program', value: props.program, icon: 'folder' },
    { label: 'Schedule', value: `${props.schedule}${Number.isFinite(props.durationDays) ? ` (${props.durationDays} days)` : ''}`, icon: 'calendar-month' },
    ...(props.isEvent ? [{ label: 'Volunteer Slots', value: props.volunteerSlots, icon: 'group' as const }] : []),
    { label: 'Location', value: props.location, icon: 'location-on' },
    { label: 'Document Attachment', value: props.documentLabel, icon: props.hasDocument ? 'attach-file' : 'upload-file', onPress: props.onDocumentPress },
  ];

  return (
    <View style={styles.sidebar} testID="project-details-sidebar">
      <View style={styles.card} testID="project-summary-card">
        <Text style={styles.heading}>{props.isEvent ? 'Event Summary' : 'Project Summary'}</Text>
        {fields.map(field => {
          const content = (
            <>
              <View style={styles.labelRow}>
                <MaterialIcons name={field.icon} size={16} color="#166534" />
                <Text style={styles.label}>{field.label}</Text>
              </View>
              <Text style={[styles.value, field.onPress && styles.linkText]}>{field.value}</Text>
            </>
          );
          return field.onPress ? (
            <TouchableOpacity key={field.label} style={styles.field} accessibilityRole="button" onPress={field.onPress}>
              {content}
            </TouchableOpacity>
          ) : (
            <View key={field.label} style={styles.field}>{content}</View>
          );
        })}
        <TouchableOpacity style={styles.detailsButton} accessibilityRole="button" onPress={props.onDetailsPress}>
          <Text style={styles.linkText}>View full details</Text>
          <MaterialIcons name="arrow-forward" size={16} color="#166534" />
        </TouchableOpacity>
      </View>
      <View style={styles.card} testID="project-quick-actions">
        <Text style={styles.heading}>Quick Actions</Text>
        {props.onCreateEvent && (
          <TouchableOpacity style={[styles.button, styles.primaryButton]} accessibilityRole="button" onPress={props.onCreateEvent}>
            <MaterialIcons name="event" size={16} color="#fff" />
            <Text style={[styles.buttonText, styles.primaryText]}>Create Event</Text>
          </TouchableOpacity>
        )}
        {props.isEvent && props.onAttendance && (
          <TouchableOpacity style={[styles.button, styles.primaryButton]} accessibilityRole="button" onPress={props.onAttendance}>
            <MaterialIcons name="assignment-turned-in" size={16} color="#fff" />
            <Text style={[styles.buttonText, styles.primaryText]}>Attendance &amp; Tasks</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.button} accessibilityRole="button" onPress={props.onReports}>
          <MaterialIcons name="description" size={16} color="#475569" />
          <Text style={styles.buttonText}>View Reports</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: '100%', minWidth: 0, flexGrow: 0, flexShrink: 0, gap: 20 },
  card: { width: '100%', minWidth: 0, flexGrow: 0, flexShrink: 0, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, backgroundColor: '#fff' },
  heading: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  field: { alignSelf: 'stretch', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: '#64748b' },
  value: { marginLeft: 24, fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#0f172a' },
  detailsButton: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 },
  linkText: { fontSize: 13, fontWeight: '700', color: '#166534' },
  button: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, marginTop: 10 },
  primaryButton: { backgroundColor: '#166534', borderColor: '#166534' },
  buttonText: { flexShrink: 1, textAlign: 'center', fontSize: 13, lineHeight: 20, fontWeight: '700', color: '#475569' },
  primaryText: { color: '#fff' },
});
