import React, { useState } from 'react';
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type EventSummary = {
  id: string;
  title: string;
  schedule: string;
  location: string;
  month: string;
  day: string;
  imageSource?: ImageSourcePropType | null;
  volunteerCount: number;
  volunteersNeeded: number;
};

export default function ProjectUpcomingEventsCard({ events, onViewEvent }: {
  events: EventSummary[];
  onViewEvent: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleEvents = showAll ? events : events.slice(0, 3);

  return (
    <View style={styles.card} testID="project-upcoming-events">
      <View style={styles.header}>
        <Text style={styles.heading}>Upcoming Events</Text>
        {events.length > 3 && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: showAll }}
            aria-expanded={showAll}
            onPress={() => setShowAll(value => !value)}
            style={styles.toggle}
          >
            <Text style={styles.link}>{showAll ? 'Show fewer events' : 'View all events'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {visibleEvents.length === 0 ? (
        <Text style={styles.meta}>No upcoming events scheduled.</Text>
      ) : visibleEvents.map(event => (
        <View key={event.id} style={styles.event} testID={`upcoming-event-${event.id}`}>
          {/* Only the thumbnail and copy share this row. Actions cannot squeeze the title. */}
          <View style={styles.details}>
            <View style={styles.thumbnail}>
              {event.imageSource && <Image source={event.imageSource} style={StyleSheet.absoluteFill} resizeMode="cover" />}
              <View style={[styles.date, event.imageSource ? styles.dateOverlay : undefined]}>
                <Text style={[styles.month, event.imageSource ? styles.photoDateText : undefined]}>{event.month}</Text>
                <Text style={[styles.day, event.imageSource ? styles.photoDateText : undefined]}>{event.day}</Text>
              </View>
            </View>
            <View style={styles.copy}>
              <Text style={styles.title} numberOfLines={2} accessibilityLabel={event.title}>{event.title}</Text>
              <Text style={styles.meta} numberOfLines={2}>{event.schedule}</Text>
              <Text style={styles.meta} numberOfLines={2}>{event.location}</Text>
            </View>
          </View>
          <View style={styles.footer}>
            <Text style={styles.volunteers}>{event.volunteerCount}/{event.volunteersNeeded} Volunteers</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`View ${event.title}`}
              onPress={() => onViewEvent(event.id)}
              style={styles.viewButton}
            >
              <Text style={styles.link}>View event</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', minWidth: 0, flexGrow: 0, flexShrink: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 16, marginBottom: 20, gap: 16 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heading: { fontSize: 16, fontWeight: '800', color: '#0f172a', flexShrink: 1 },
  toggle: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 13, fontWeight: '700', color: '#166534' },
  event: { alignSelf: 'stretch', minWidth: 0, gap: 12 },
  details: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  thumbnail: { width: 64, height: 64, flexShrink: 0, borderRadius: 10, overflow: 'hidden', backgroundColor: '#f0fdf4' },
  date: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dateOverlay: { backgroundColor: 'rgba(0,0,0,0.45)' },
  month: { fontSize: 11, fontWeight: '700', color: '#166534' },
  day: { fontSize: 22, fontWeight: '800', color: '#166534' },
  photoDateText: { color: '#fff' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 12, lineHeight: 18, color: '#64748b' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  volunteers: { fontSize: 13, fontWeight: '600', color: '#334155', flexShrink: 1 },
  viewButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8 },
});
