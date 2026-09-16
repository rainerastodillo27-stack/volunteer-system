// Isolated rendering of the production components: no accounts or live data needed.
import '../../platformInit';
import React, { useState } from 'react';
import { AppRegistry, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import ProjectUpcomingEventsCard from '../../components/ProjectUpcomingEventsCard';
import EventNotificationFields, { EventNotificationSetting } from '../../components/EventNotificationFields';
import { useNunitoFont } from '../../utils/fonts';
import ProjectDetailsSidebar, { projectDetailsLayout } from '../../components/ProjectDetailsSidebar';

const event = {
  id: 'sample',
  title: 'APK proposal test Event with a long project title',
  schedule: 'Sep 14, 2026 – Dec 31, 2026',
  location: 'Alicante, Enrique B. Magalona, Negros Island Region (NIR)',
  month: 'SEP', day: '14', volunteerCount: 1, volunteersNeeded: 1,
  imageSource: { uri: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="1000"><rect width="100" height="1000" fill="#166534"/></svg>') },
};

function Preview() {
  useNunitoFont();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1100;
  const [previewEvent, setPreviewEvent] = useState(false);
  const [summaryAction, setSummaryAction] = useState('');
  const [selectedEvent, setSelectedEvent] = useState('');
  const [reminders, setReminders] = useState<EventNotificationSetting[]>([{ type: 'Email', value: '30', unit: 'minutes' }]);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, backgroundColor: '#edf4f0', alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 900 }}>
        <ProjectUpcomingEventsCard events={[event]} onViewEvent={setSelectedEvent} />
        <Text testID="selected-event">{selectedEvent}</Text>
        <View style={{ width: '100%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12, marginBottom: 20 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: '#166534' }}>NOTIFICATIONS</Text>
          {reminders.map((value, index) => (
            <EventNotificationFields key={index} value={value} index={index}
              onChange={changes => setReminders(items => items.map((item, i) => i === index ? { ...item, ...changes } : item))}
              onRemove={() => setReminders(items => items.filter((_, i) => i !== index))}
            />
          ))}
          <TouchableOpacity accessibilityRole="button" onPress={() => setReminders(items => [...items, { type: 'Notification', value: '30', unit: 'minutes' }])}>
            <Text>Add another notification</Text>
          </TouchableOpacity>
        </View>
        <ProjectUpcomingEventsCard events={[]} onViewEvent={setSelectedEvent} />
        <ProjectUpcomingEventsCard events={Array.from({ length: 5 }, (_, i) => ({ ...event, id: `event-${i}`, imageSource: undefined }))} onViewEvent={setSelectedEvent} />
        <View style={[projectDetailsLayout.grid, { flexDirection: isDesktop ? 'row' : 'column' }, !isDesktop && projectDetailsLayout.gridMobile]}>
          <View style={[projectDetailsLayout.column, isDesktop ? { flex: 2.2 } : projectDetailsLayout.columnMobile]}>
            <Text>About This Project</Text>
            <Text>Project details and reports appear in this column.</Text>
          </View>
          <View testID="summary-column" style={[projectDetailsLayout.column, isDesktop ? { flex: 1 } : projectDetailsLayout.columnMobile]}>
            <ProjectDetailsSidebar
              isEvent={previewEvent} status="In Progress" program="Community Nutrition Program"
              schedule="August 31st, 2026 - December 30th, 2026" durationDays={121}
              volunteerSlots="1 / 10" location={event.location} documentLabel="Upload document" hasDocument={false}
              onDocumentPress={() => setSummaryAction('document')}
              onDetailsPress={() => setSummaryAction('details')}
              onCreateEvent={previewEvent ? undefined : () => setSummaryAction('create')}
              onAttendance={() => setSummaryAction('attendance')}
              onReports={() => setSummaryAction('reports')}
            />
          </View>
        </View>
        <Text testID="summary-action">{summaryAction}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => setPreviewEvent(value => !value)}>
          <Text>Preview event summary</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

AppRegistry.registerComponent('PartnerUiPreview', () => Preview);
AppRegistry.runApplication('PartnerUiPreview', { rootTag: document.getElementById('root') });
