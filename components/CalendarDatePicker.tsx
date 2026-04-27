import React, { useMemo, useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { addMonths, format, isSameDay, isSameMonth, subMonths } from 'date-fns';

type CalendarDatePickerProps = {
  selectedDate?: Date;
  onDateSelect: (date: Date) => void;
  onClose: () => void;
  minDate?: Date;
  maxDate?: Date;
};

function getMonthGrid(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: Date[] = [];

  // Add empty cells for days before the first day of the month
  for (let index = 0; index < firstDay; index += 1) {
    const prevMonthDate = new Date(year, month, -firstDay + index + 1);
    cells.push(prevMonthDate);
  }

  // Add cells for the current month
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(new Date(year, month, day));
  }

  // Add empty cells for days after the last day of the month
  const remainingCells = 42 - cells.length; // 6 weeks * 7 days
  for (let index = 0; index < remainingCells; index += 1) {
    const nextMonthDate = new Date(year, month + 1, index + 1);
    cells.push(nextMonthDate);
  }

  return cells;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function CalendarDatePicker({
  selectedDate,
  onDateSelect,
  onClose,
  minDate,
  maxDate,
}: CalendarDatePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(selectedDate || new Date());

  const monthGrid = useMemo(() => getMonthGrid(currentMonth), [currentMonth]);
  const monthLabel = useMemo(
    () => format(currentMonth, 'MMMM yyyy'),
    [currentMonth]
  );

  const handlePrevMonth = () => {
    setCurrentMonth(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(prev => addMonths(prev, 1));
  };

  const handleDatePress = (date: Date) => {
    // Check if date is within min/max bounds
    if (minDate && date < minDate) return;
    if (maxDate && date > maxDate) return;

    onDateSelect(date);
    onClose();
  };

  const isDateDisabled = (date: Date) => {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handlePrevMonth} style={styles.navButton}>
          <MaterialIcons name="chevron-left" size={24} color="#4CAF50" />
        </TouchableOpacity>

        <Text style={styles.monthLabel}>{monthLabel}</Text>

        <TouchableOpacity onPress={handleNextMonth} style={styles.navButton}>
          <MaterialIcons name="chevron-right" size={24} color="#4CAF50" />
        </TouchableOpacity>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map(day => (
          <Text key={day} style={styles.weekdayLabel}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {monthGrid.map((date, index) => {
          const isSelected = selectedDate && isSameDay(date, selectedDate);
          const isCurrentMonth = isSameMonth(date, currentMonth);
          const disabled = isDateDisabled(date);

          return (
            <TouchableOpacity
              key={date.toISOString()}
              style={[
                styles.dayCell,
                !isCurrentMonth && styles.dayCellOtherMonth,
                isSelected && styles.dayCellSelected,
                disabled && styles.dayCellDisabled,
              ]}
              onPress={() => !disabled && handleDatePress(date)}
              disabled={disabled}
            >
              <Text
                style={[
                  styles.dayText,
                  !isCurrentMonth && styles.dayTextOtherMonth,
                  isSelected && styles.dayTextSelected,
                  disabled && styles.dayTextDisabled,
                ]}
              >
                {format(date, 'd')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        {selectedDate && (
          <TouchableOpacity onPress={() => onDateSelect(selectedDate)} style={styles.confirmButton}>
            <Text style={styles.confirmButtonText}>
              Select {format(selectedDate, 'MMM d, yyyy')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navButton: {
    padding: 8,
    borderRadius: 6,
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    paddingVertical: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 2,
  },
  dayCellOtherMonth: {
    opacity: 0.3,
  },
  dayCellSelected: {
    backgroundColor: '#4CAF50',
    borderRadius: 6,
  },
  dayCellDisabled: {
    opacity: 0.3,
  },
  dayText: {
    fontSize: 16,
    color: '#1f2937',
  },
  dayTextOtherMonth: {
    color: '#9ca3af',
  },
  dayTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  dayTextDisabled: {
    color: '#d1d5db',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '500',
  },
  confirmButton: {
    flex: 2,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});