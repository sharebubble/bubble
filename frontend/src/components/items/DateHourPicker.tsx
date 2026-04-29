import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !displayValue && 'text-muted-foreground',
          )}
          type="button"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {displayValue ?? placeholder}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Calendar */}
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDaySelect}
            disabled={minDate ? { before: minDate } : undefined}
            initialFocus
          />

          {/* Hour picker */}
          <div className="flex flex-col border-l w-16">
            <p className="px-2 pt-[2.1rem] pb-1 text-xs font-medium text-muted-foreground text-center">
              Hour
            </p>
            <ScrollArea className="h-[252px]">
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
                      'hover:bg-accent hover:text-accent-foreground',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                      selectedHour === h && 'bg-primary text-primary-foreground hover:bg-primary',
                    )}
                  >
                    {String(h).padStart(2, '0')}:00
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
