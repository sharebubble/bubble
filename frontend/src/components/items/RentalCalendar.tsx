import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { publicBookingsList } from '@/services/django';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { useMemo, useState } from 'react';

interface RentalCalendarProps {
  itemUuid?: string;
  onDateRangeSelect?: (start: Date, end: Date) => void;
  selectedStart?: Date;
  selectedEnd?: Date;
  onBookNow?: (start: Date, end: Date) => void;
}

export const RentalCalendar = ({
  itemUuid,
  onDateRangeSelect,
  selectedStart,
  selectedEnd,
  onBookNow,
}: RentalCalendarProps) => {
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<'weekly' | 'monthly'>('weekly');

  // Fetch existing bookings for this item
  const { data: bookingsData } = useQuery({
    queryKey: ['publicBookings', itemUuid],
    queryFn: async () => {
      if (!itemUuid) return null;
      const response = await publicBookingsList({
        query: {
          item: itemUuid,
          status: [1, 3], // Pending (1) and Confirmed (3) bookings
        },
      });
      return response.data;
    },
    enabled: !!itemUuid,
  });

  const existingBookings = useMemo(() => {
    if (!bookingsData?.results) return [];
    // Type assertion: The API actually returns time fields even though BookingList type doesn't include them
    type BookingWithTime = (typeof bookingsData.results)[0] & {
      time_from?: string | null;
      time_to?: string | null;
    };
    return (bookingsData.results as BookingWithTime[])
      .filter(booking => booking.time_from && booking.time_to)
      .map(booking => ({
        start: new Date(booking.time_from!),
        end: new Date(booking.time_to!),
        userName: booking.user.username,
        userFullName: booking.user.name || booking.user.username,
      }));
  }, [bookingsData]);

  // All dates use the browser's local timezone
  // JavaScript Date objects automatically work in the user's timezone
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectingStart, setSelectingStart] = useState<Date | null>(null);

  const currentWeekStart = useMemo(() => startOfDay(currentDate), [currentDate]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const firstDayOfMonth = useMemo(() => startOfMonth(currentDate), [currentDate]);
  const lastDayOfMonth = useMemo(() => endOfMonth(currentDate), [currentDate]);
  const daysInMonthGrid = useMemo(() => {
    const start = startOfWeek(firstDayOfMonth, { weekStartsOn: 1 });
    const end = endOfWeek(lastDayOfMonth, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [firstDayOfMonth, lastDayOfMonth]);

  const goToPrevious = () => {
    if (viewMode === 'weekly') {
      setCurrentDate(prev => addWeeks(prev, -1));
    } else {
      setCurrentDate(prev => addMonths(prev, -1));
    }
  };

  const goToNext = () => {
    if (viewMode === 'weekly') {
      setCurrentDate(prev => addWeeks(prev, 1));
    } else {
      setCurrentDate(prev => addMonths(prev, 1));
    }
  };

  const handleDayClick = (day: Date) => {
    if (isBefore(day, startOfDay(new Date()))) {
      return;
    }

    const dayStart = startOfDay(day);

    if (!selectingStart) {
      setSelectingStart(dayStart);
    } else {
      const start = isBefore(dayStart, selectingStart) ? dayStart : selectingStart;
      const end = isBefore(dayStart, selectingStart) ? selectingStart : dayStart;
      const adjustedEnd = addDays(end, 1); // Next day at 00:00:00 for full 24h

      onDateRangeSelect?.(start, adjustedEnd);
      setSelectingStart(null);
    }
  };

  const handleTimeSlotClick = (date: Date, hour: number) => {
    // Create datetime in user's local timezone
    const selectedDateTime = new Date(date);
    selectedDateTime.setHours(hour, 0, 0, 0);

    // Prevent selecting past times (using local timezone)
    if (isBefore(selectedDateTime, startOfDay(new Date()))) {
      return;
    }

    if (!selectingStart) {
      // Start selection
      setSelectingStart(selectedDateTime);
    } else {
      // Check if clicking the same slot - select just one hour
      if (selectedDateTime.getTime() === selectingStart.getTime()) {
        const endDateTime = new Date(selectedDateTime);
        endDateTime.setHours(hour + 1, 0, 0, 0);
        onDateRangeSelect?.(selectedDateTime, endDateTime);
        setSelectingStart(null);
        return;
      }

      // Complete selection
      const start = isBefore(selectedDateTime, selectingStart) ? selectedDateTime : selectingStart;
      const end = isBefore(selectedDateTime, selectingStart) ? selectingStart : selectedDateTime;

      // Add one hour to the end time to include the full hour
      const adjustedEnd = new Date(end);
      adjustedEnd.setHours(adjustedEnd.getHours() + 1, 0, 0, 0);

      onDateRangeSelect?.(start, adjustedEnd);
      setSelectingStart(null);
    }
  };

  const isTimeSlotSelected = (date: Date, hour: number): boolean => {
    if (!selectedStart || !selectedEnd) return false;

    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);

    // Check if this hour slot starts at or after selectedStart and before selectedEnd
    return (
      slotStart.getTime() >= selectedStart.getTime() && slotStart.getTime() < selectedEnd.getTime()
    );
  };

  const isTimeSlotInPreview = (date: Date, hour: number): boolean => {
    if (!selectingStart) return false;

    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);

    const start = selectingStart;
    const end = slotStart;

    if (isBefore(end, start)) {
      return isWithinInterval(slotStart, { start: end, end: start });
    }
    return isWithinInterval(slotStart, { start, end });
  };

  const isTimeSlotPast = (date: Date, hour: number): boolean => {
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    return isBefore(slotStart, new Date());
  };

  const isTimeSlotBooked = (date: Date, hour: number): boolean => {
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(hour + 1, 0, 0, 0);

    return existingBookings.some(booking => {
      // Check if this slot overlaps with any booking
      return (
        (slotStart >= booking.start && slotStart < booking.end) ||
        (slotEnd > booking.start && slotEnd <= booking.end) ||
        (slotStart <= booking.start && slotEnd >= booking.end)
      );
    });
  };

  const getBookingForTimeSlot = (date: Date, hour: number) => {
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(hour + 1, 0, 0, 0);

    return existingBookings.find(booking => {
      return (
        (slotStart >= booking.start && slotStart < booking.end) ||
        (slotEnd > booking.start && slotEnd <= booking.end) ||
        (slotStart <= booking.start && slotEnd >= booking.end)
      );
    });
  };

  const isDaySelected = (day: Date): boolean => {
    if (!selectedStart || !selectedEnd) return false;
    const dayStart = startOfDay(day);
    const rangeStart = startOfDay(selectedStart);

    // Check if the day is before the range end
    // For visual selection, exclude the end day if selectedEnd is exactly at midnight
    const isEndAtMidnight =
      selectedEnd.getHours() === 0 &&
      selectedEnd.getMinutes() === 0 &&
      selectedEnd.getSeconds() === 0;

    if (isEndAtMidnight) {
      // If end is at midnight, exclude that day from visual selection
      return dayStart >= rangeStart && dayStart < selectedEnd;
    }

    return isWithinInterval(dayStart, {
      start: rangeStart,
      end: selectedEnd,
    });
  };

  const isDayInPreview = (day: Date): boolean => {
    if (!selectingStart) return false;
    const dayStart = startOfDay(day);
    const previewEnd = startOfDay(new Date()); // just for a valid date object
    const start = selectingStart;
    const end = dayStart;

    if (isBefore(end, start)) {
      return isWithinInterval(dayStart, { start: end, end: start });
    }
    return isWithinInterval(dayStart, { start, end });
  };

  const isDayPast = (day: Date): boolean => {
    return isBefore(day, startOfDay(new Date()));
  };

  const isDayBooked = (day: Date): boolean => {
    const dayStart = startOfDay(day);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    return existingBookings.some(booking => {
      // Check if this day overlaps with any booking
      return (
        (dayStart >= booking.start && dayStart < booking.end) ||
        (dayEnd > booking.start && dayEnd <= booking.end) ||
        (dayStart <= booking.start && dayEnd >= booking.end)
      );
    });
  };

  const getBookingsForDay = (day: Date) => {
    const dayStart = startOfDay(day);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    return existingBookings.filter(booking => {
      return (
        (dayStart >= booking.start && dayStart < booking.end) ||
        (dayEnd > booking.start && dayEnd <= booking.end) ||
        (dayStart <= booking.start && dayEnd >= booking.end)
      );
    });
  };

  const renderWeeklyView = () => (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Week Day Headers */}
        <div className="grid grid-cols-8 gap-1 mb-2">
          <div className="text-xs font-medium text-muted-foreground sticky left-0 bg-background p-2">
            {t('calendar.time')}
          </div>
          {weekDays.map((day, index) => (
            <div
              key={index}
              className={cn(
                'text-xs font-medium text-center p-2 rounded',
                isSameDay(day, new Date()) && 'bg-primary text-primary-foreground',
              )}
            >
              <div>{format(day, 'EEE')}</div>
              <div className="text-lg font-bold">{format(day, 'd')}</div>
            </div>
          ))}
        </div>

        {/* Time Slots */}
        <div className="space-y-1">
          {hours.map(hour => (
            <div key={hour} className="grid grid-cols-8 gap-1">
              <div className="text-xs text-muted-foreground sticky left-0 bg-background p-2 flex items-center">
                {format(new Date().setHours(hour, 0, 0, 0), 'HH:mm')}
              </div>
              {weekDays.map((day, dayIndex) => {
                const isPast = isTimeSlotPast(day, hour);
                const isBooked = isTimeSlotBooked(day, hour);
                const booking = isBooked ? getBookingForTimeSlot(day, hour) : null;
                const isSelected = isTimeSlotSelected(day, hour);
                const isPreview = isTimeSlotInPreview(day, hour);
                const isClickDisabled = isPast || isBooked;

                const slotButton = (
                  <button
                    key={dayIndex}
                    onClick={() => !isClickDisabled && handleTimeSlotClick(day, hour)}
                    disabled={isPast && !isBooked}
                    className={cn(
                      'h-8 rounded transition-colors w-full',
                      isPast && 'bg-muted cursor-not-allowed opacity-50',
                      isBooked &&
                        !isPast &&
                        'bg-destructive/20 cursor-pointer opacity-70 border border-destructive/50',
                      !isClickDisabled &&
                        !isSelected &&
                        !isPreview &&
                        'bg-background hover:bg-accent border',
                      isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                      isPreview && !isSelected && 'bg-primary/30 hover:bg-primary/40',
                    )}
                  />
                );

                if (isBooked && booking) {
                  return (
                    <Popover key={dayIndex}>
                      <PopoverTrigger asChild>{slotButton}</PopoverTrigger>
                      <PopoverContent className="w-auto p-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 font-semibold text-sm">
                            <User className="h-3.5 w-3.5" />
                            {booking.userFullName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(booking.start, 'MMM d, HH:mm')} -{' '}
                            {format(booking.end, 'MMM d, HH:mm')}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  );
                }

                return slotButton;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMonthlyView = () => (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="text-xs font-medium text-center p-2 text-muted-foreground">
            {format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), i), 'EEE')}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {daysInMonthGrid.map((day, index) => {
          const isPast = isDayPast(day);
          const isBooked = isDayBooked(day);
          const bookings = isBooked ? getBookingsForDay(day) : [];
          const isSelected = isDaySelected(day);
          const isPreview = isDayInPreview(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isClickDisabled = isPast || isBooked;

          const dayButton = (
            <button
              onClick={() => !isClickDisabled && handleDayClick(day)}
              disabled={isPast && !isBooked}
              className={cn(
                'h-16 rounded transition-colors flex flex-col items-center justify-center p-1 w-full',
                !isCurrentMonth && 'text-muted-foreground',
                isPast && 'bg-muted cursor-not-allowed opacity-50',
                isBooked &&
                  !isPast &&
                  'bg-destructive/20 cursor-pointer opacity-70 border border-destructive/50',
                !isClickDisabled &&
                  !isSelected &&
                  !isPreview &&
                  'bg-background hover:bg-accent border',
                isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                isPreview && !isSelected && 'bg-primary/30 hover:bg-primary/40',
                isSameDay(day, new Date()) && !isSelected && 'border-2 border-primary',
              )}
            >
              <span className="text-sm font-medium">{format(day, 'd')}</span>
            </button>
          );

          if (isBooked && bookings.length > 0) {
            return (
              <Popover key={index}>
                <PopoverTrigger asChild>{dayButton}</PopoverTrigger>
                <PopoverContent className="w-auto p-3">
                  <div className="flex flex-col gap-2">
                    <div className="font-semibold text-sm">{format(day, 'MMM d, yyyy')}</div>
                    {bookings.map((booking, idx) => (
                      <div key={idx} className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-medium">{booking.userFullName}</span>
                        </div>
                        <div className="text-xs text-muted-foreground ml-5">
                          {format(booking.start, 'HH:mm')} - {format(booking.end, 'HH:mm')}
                        </div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            );
          }

          return <div key={index}>{dayButton}</div>;
        })}
      </div>
    </div>
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{t('calendar.selectRentalPeriod')}</CardTitle>
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={value => {
                if (value) setViewMode(value as 'weekly' | 'monthly');
              }}
              size="sm"
            >
              <ToggleGroupItem value="weekly" aria-label="Weekly view">
                {t('calendar.week')}
              </ToggleGroupItem>
              <ToggleGroupItem value="monthly" aria-label="Monthly view">
                {t('calendar.month')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={goToPrevious}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[180px] text-center">
              {viewMode === 'weekly'
                ? `${format(currentWeekStart, 'MMM d')} - ${format(
                    endOfWeek(currentWeekStart, { weekStartsOn: 1 }),
                    'MMM d, yyyy',
                  )}`
                : format(currentDate, 'MMMM yyyy')}
            </span>
            <Button variant="outline" size="sm" onClick={goToNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {viewMode === 'weekly' ? renderWeeklyView() : renderMonthlyView()}

        {/* Selection Summary */}
        {selectedStart && selectedEnd && (
          <div className="mt-4 p-4 bg-muted rounded-lg relative">
            <p className="text-sm font-medium mb-1">{t('calendar.selectedPeriod')}:</p>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">{t('calendar.from')}:</span>{' '}
              {format(selectedStart, 'EEE, MMM d, yyyy HH:mm')}
            </div>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">{t('calendar.to')}:</span>{' '}
              {format(selectedEnd, 'EEE, MMM d, yyyy HH:mm')}
            </div>
            <div className="text-sm font-semibold mt-2">
              {t('calendar.duration')}:{' '}
              {Math.round((selectedEnd.getTime() - selectedStart.getTime()) / (1000 * 60 * 60))}{' '}
              {t('calendar.hours')}
            </div>

            {/* Book Now button bottom-right */}
            <div className="absolute right-4 bottom-4">
              <Button size="sm" onClick={() => onBookNow && onBookNow(selectedStart, selectedEnd)}>
                {t('booking.bookNow')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
