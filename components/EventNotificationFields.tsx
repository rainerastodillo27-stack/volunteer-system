import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export type EventNotificationSetting = {
  type: 'Notification' | 'Email';
  value: string;
  unit: 'minutes' | 'hours' | 'days';
};

export default function EventNotificationFields({ value, index, onChange, onRemove }: {
  value: EventNotificationSetting;
  index: number;
  onChange: (changes: Partial<EventNotificationSetting>) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.container} testID={`event-reminder-${index}`}>
      <View style={styles.header}>
        <Text style={styles.label}>Reminder {index + 1}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove reminder ${index + 1}`} onPress={onRemove} style={styles.remove}>
          <Text style={styles.removeText}>Remove</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.label}>Send via</Text>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={`Reminder ${index + 1} delivery`}>
        {(['Notification', 'Email'] as const).map(type => (
          <TouchableOpacity
            key={type}
            accessibilityRole="radio"
            accessibilityState={{ checked: value.type === type }}
            aria-checked={value.type === type}
            onPress={() => onChange({ type })}
            style={[styles.choice, value.type === type && styles.selected]}
          >
            <Text style={[styles.choiceText, value.type === type && styles.selectedText]}>{type}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Time before event</Text>
      <TextInput
        accessibilityLabel={`Reminder ${index + 1} amount`}
        keyboardType="number-pad"
        value={value.value}
        onChangeText={amount => onChange({ value: amount.replace(/\D/g, '') })}
        style={styles.input}
      />
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={`Reminder ${index + 1} time unit`}>
        {(['minutes', 'hours', 'days'] as const).map(unit => (
          <TouchableOpacity
            key={unit}
            accessibilityRole="radio"
            accessibilityState={{ checked: value.unit === unit }}
            aria-checked={value.unit === unit}
            onPress={() => onChange({ unit })}
            style={[styles.choice, value.unit === unit && styles.selected]}
          >
            <Text style={[styles.choiceText, value.unit === unit && styles.selectedText]}>{unit[0].toUpperCase() + unit.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', minWidth: 0, gap: 10, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff' },
  selected: { borderColor: '#166534', backgroundColor: '#f0fdf4' },
  choiceText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  selectedText: { color: '#166534' },
  input: { width: '100%', minHeight: 48, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#0f172a', textAlignVertical: 'center' },
  remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },
});
