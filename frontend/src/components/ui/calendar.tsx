import { Calendar as MantineCalendar } from '@mantine/dates';
import dayjs from 'dayjs';
import React from 'react';

// Compatibility wrapper for the old react-day-picker Calendar API.
// The codebase uses:
//   <Calendar mode="single" selected={Date} onSelect={(day) => ...}
//             disabled={{ before: Date }} initialFocus />

interface CalendarProps {
  mode?: 'single' | 'multiple' | 'range';
  selected?: Date;
  onSelect?: (day: Date | undefined) => void;
  disabled?: { before?: Date; after?: Date } | ((date: Date) => boolean);
  initialFocus?: boolean;
  className?: string;
}

const Calendar = ({ selected, onSelect, disabled, className }: CalendarProps) => {
  const isDateDisabled = (date: Date | string): boolean => {
    if (!disabled) return false;
    const d = date instanceof Date ? date : new Date(date);
    if (typeof disabled === 'function') return disabled(d);
    if (disabled.before && dayjs(d).isBefore(dayjs(disabled.before), 'day')) return true;
    if (disabled.after && dayjs(d).isAfter(dayjs(disabled.after), 'day')) return true;
    return false;
  };

  return (
    <MantineCalendar
      // Show the month of the selected date as the initial visible month
      defaultDate={selected}
      getDayProps={dateStr => {
        const date = new Date(dateStr);
        return {
          disabled: isDateDisabled(dateStr),
          selected: selected ? dayjs(date).isSame(dayjs(selected), 'day') : false,
          onClick: () => onSelect?.(date),
        };
      }}
      className={className}
    />
  );
};
Calendar.displayName = 'Calendar';

export { Calendar };
