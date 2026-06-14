import { Button, Popover, ScrollArea, Text } from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface DateHourPickerProps {
  /** ISO-like local datetime string "YYYY-MM-DDTHH:mm" — the component's value */
  value: string;
  onChange: (value: string) => void;
  /** Minimum selectable value as "YYYY-MM-DDTHH:mm" */
  min?: string;
  placeholder?: string;
  id?: string;
}

/** Parse a "YYYY-MM-DDTHH:mm" local string into a Date, or return undefined. */
const parseLocal = (s: string): Date | undefined => {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
};

/** Format a Date back to "YYYY-MM-DDTHH:mm" local string. */
const toLocalString = (date: Date, hour: number): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:00`;
};

/** Returns "YYYY-MM-DDTHH:mm" for the current local hour (minutes zeroed). */
const nowLocalHour = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:00`;
};

/** Parse a Mantine "YYYY-MM-DD" date string into a local Date (no timezone shift). */
const parseDateString = (s: string): Date | undefined => {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
};

export const DateHourPicker = ({
  value,
  onChange,
  min,
  placeholder = 'Select date & time',
  id,
}: DateHourPickerProps) => {
  const [open, setOpen] = useState(false);

  const parsed = parseLocal(value);
  const selectedDate = parsed
    ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
    : undefined;
  const selectedHour = parsed ? parsed.getHours() : undefined;

  // Default min to current hour so past dates/hours are always disabled
  const effectiveMin = min ?? nowLocalHour();
  const minParsed = parseLocal(effectiveMin);
  const minDate = minParsed
    ? new Date(minParsed.getFullYear(), minParsed.getMonth(), minParsed.getDate())
    : undefined;
  const minHour = minParsed ? minParsed.getHours() : 0;

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) return;
    const hour = selectedHour ?? 0;
    onChange(toLocalString(day, hour));
  };

  const handleHourSelect = (hour: number) => {
    const base = selectedDate ?? new Date();
    onChange(toLocalString(base, hour));
    setOpen(false);
  };

  const isHourDisabled = (hour: number): boolean => {
    if (!minDate || !selectedDate) return false;
    const sameDay =
      selectedDate.getFullYear() === minDate.getFullYear() &&
      selectedDate.getMonth() === minDate.getMonth() &&
      selectedDate.getDate() === minDate.getDate();
    return sameDay && hour < minHour;
  };

  // Scroll the active hour into view when the popover opens
  const hourListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && selectedHour !== undefined && hourListRef.current) {
      const btn = hourListRef.current.querySelector<HTMLButtonElement>(
        `[data-hour="${selectedHour}"]`,
      );
      btn?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, selectedHour]);

  const displayValue =
    parsed != null
      ? `${format(parsed, 'dd.MM.yyyy')}  ${String(parsed.getHours()).padStart(2, '0')}:00`
      : null;

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withinPortal>
      <Popover.Target>
        <Button
          id={id}
          variant="default"
          fullWidth
          justify="flex-start"
          fw={400}
          c={displayValue ? undefined : 'dimmed'}
          leftSection={<CalendarIcon size={16} className="shrink-0" />}
          type="button"
          onClick={() => setOpen(o => !o)}
        >
          {displayValue ?? placeholder}
        </Button>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <div className="flex">
          {/* Calendar */}
          <div className="p-3">
            <DatePicker
              value={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null}
              onChange={dateString => {
                if (!dateString) return;
                handleDaySelect(parseDateString(dateString));
              }}
              minDate={minDate}
            />
          </div>

          {/* Hour picker */}
          <div className="flex flex-col border-l w-16">
            <Text
              size="xs"
              fw={500}
              c="dimmed"
              ta="center"
              className="px-2 pt-[2.1rem] pb-1"
              component="p"
            >
              Hour
            </Text>
            <ScrollArea h={252}>
              <div ref={hourListRef} className="flex flex-col gap-0.5 p-1">
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    type="button"
                    data-hour={h}
                    disabled={isHourDisabled(h)}
                    onClick={() => handleHourSelect(h)}
                    className={cn(
                      'rounded px-2 py-1.5 text-sm text-center transition-colors',
                      'hover:bg-[var(--mantine-color-gray-1)]',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                      selectedHour === h &&
                        'bg-[var(--mantine-color-green-6)] text-white hover:bg-[var(--mantine-color-green-6)]',
                    )}
                  >
                    {String(h).padStart(2, '0')}:00
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
};
