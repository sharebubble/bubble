import {
  ActionIcon,
  Button,
  Card,
  Paper,
  Popover,
  SegmentedControl,
  Text,
  Title,
} from '@mantine/core';
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
  // First click of a range selection (a datetime in weekly view, a day in monthly).
  const [selectingStart, setSelectingStart] = useState<Date | null>(null);
  // Tile currently under the pointer while a start is pending — drives the live preview.
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null);

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
      // First click: mark the start tile and wait for the end.
      setSelectingStart(dayStart);
      setHoveredDate(dayStart);
    } else {
      const start = isBefore(dayStart, selectingStart) ? dayStart : selectingStart;
      const end = isBefore(dayStart, selectingStart) ? selectingStart : dayStart;
      const adjustedEnd = addDays(end, 1); // Next day at 00:00:00 for full 24h

      onDateRangeSelect?.(start, adjustedEnd);
      setSelectingStart(null);
      setHoveredDate(null);
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
      // First click: mark the start slot and wait for the end.
      setSelectingStart(selectedDateTime);
      setHoveredDate(selectedDateTime);
    } else {
      // Check if clicking the same slot - select just one hour
      if (selectedDateTime.getTime() === selectingStart.getTime()) {
        const endDateTime = new Date(selectedDateTime);
        endDateTime.setHours(hour + 1, 0, 0, 0);
        onDateRangeSelect?.(selectedDateTime, endDateTime);
        setSelectingStart(null);
        setHoveredDate(null);
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
      setHoveredDate(null);
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

  const isTimeSlotPendingStart = (date: Date, hour: number): boolean => {
    if (!selectingStart) return false;
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    return slotStart.getTime() === selectingStart.getTime();
  };

  // Light highlight for the tiles between the pending start and the hovered tile.
  const isTimeSlotInPreview = (date: Date, hour: number): boolean => {
    if (!selectingStart || !hoveredDate) return false;

    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);

    const [start, end] = isBefore(hoveredDate, selectingStart)
      ? [hoveredDate, selectingStart]
      : [selectingStart, hoveredDate];

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

  const isDayPendingStart = (day: Date): boolean => {
    if (!selectingStart) return false;
    return startOfDay(day).getTime() === selectingStart.getTime();
  };

  // Light highlight for the days between the pending start and the hovered day.
  const isDayInPreview = (day: Date): boolean => {
    if (!selectingStart || !hoveredDate) return false;
    const dayStart = startOfDay(day);

    const [start, end] = isBefore(hoveredDate, selectingStart)
      ? [hoveredDate, selectingStart]
      : [selectingStart, hoveredDate];

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

  const clearSelection = () => {
    setSelectingStart(null);
    setHoveredDate(null);
  };

  const formatDurationLabel = (start: Date, end: Date) => {
    const hours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60));
    if (viewMode === 'monthly') {
      return `${Math.max(1, Math.round(hours / 24))} ${t('calendar.days')}`;
    }
    return `${hours} ${t('calendar.hours')}`;
  };

  // Live range while a start is pending: ordered start/end plus the unit padding
  // (a full hour in weekly view, a full day in monthly) used for the final booking.
  const previewRange = useMemo(() => {
    if (!selectingStart || !hoveredDate) return null;
    const [start, last] = isBefore(hoveredDate, selectingStart)
      ? [hoveredDate, selectingStart]
      : [selectingStart, hoveredDate];
    const end =
      viewMode === 'weekly' ? new Date(last.getTime() + 60 * 60 * 1000) : addDays(last, 1);
    return { start, end };
  }, [selectingStart, hoveredDate, viewMode]);

  const renderWeeklyView = () => (
    <div className="overflow-x-auto" onMouseLeave={() => selectingStart && setHoveredDate(null)}>
      <div className="min-w-[700px]">
        {/* Week Day Headers */}
        <div className="grid grid-cols-8 gap-1 mb-2">
          <div className="text-xs font-medium text-[var(--mantine-color-dimmed)] sticky left-0 bg-[var(--mantine-color-body)] p-2">
            {t('calendar.time')}
          </div>
          {weekDays.map((day, index) => (
            <div
              key={index}
              className={cn(
                'text-xs font-medium text-center p-2 rounded',
                isSameDay(day, new Date()) && 'bg-[var(--mantine-color-green-6)] text-white',
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
              <div className="text-xs text-[var(--mantine-color-dimmed)] sticky left-0 bg-[var(--mantine-color-body)] p-2 flex items-center">
                {format(new Date().setHours(hour, 0, 0, 0), 'HH:mm')}
              </div>
              {weekDays.map((day, dayIndex) => {
                const isPast = isTimeSlotPast(day, hour);
                const isBooked = isTimeSlotBooked(day, hour);
                const booking = isBooked ? getBookingForTimeSlot(day, hour) : null;
                const isPendingStart = isTimeSlotPendingStart(day, hour);
                // Hide the previously confirmed range while a new selection is in progress.
                const isSelected = !selectingStart && isTimeSlotSelected(day, hour);
                const isPreview = isTimeSlotInPreview(day, hour) && !isPendingStart;
                const isClickDisabled = isPast || isBooked;
                const isHighlighted = isSelected || isPendingStart;

                const slotButton = (
                  <button
                    key={dayIndex}
                    onClick={() => !isClickDisabled && handleTimeSlotClick(day, hour)}
                    onMouseEnter={() => {
                      const slot = new Date(day);
                      slot.setHours(hour, 0, 0, 0);
                      if (selectingStart && !isClickDisabled) setHoveredDate(slot);
                    }}
                    disabled={isPast && !isBooked}
                    className={cn(
                      'h-8 rounded transition-colors w-full',
                      isPast && 'bg-[var(--mantine-color-gray-2)] cursor-not-allowed opacity-50',
                      isBooked &&
                        !isPast &&
                        'bg-[var(--mantine-color-red-1)] cursor-pointer opacity-70 border border-[var(--mantine-color-red-3)]',
                      !isClickDisabled &&
                        !isHighlighted &&
                        !isPreview &&
                        'bg-transparent hover:bg-[var(--mantine-color-gray-1)] border',
                      isHighlighted &&
                        'bg-[var(--mantine-color-green-6)] text-white hover:bg-[var(--mantine-color-green-7)]',
                      isPreview &&
                        'bg-[var(--mantine-color-green-2)] hover:bg-[var(--mantine-color-green-3)]',
                    )}
                  />
                );

                if (isBooked && booking) {
                  return (
                    <Popover key={dayIndex} withinPortal shadow="md">
                      <Popover.Target>{slotButton}</Popover.Target>
                      <Popover.Dropdown p={12}>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 font-semibold text-sm">
                            <User size={14} />
                            {booking.userFullName}
                          </div>
                          <Text size="xs" c="dimmed">
                            {format(booking.start, 'MMM d, HH:mm')} -{' '}
                            {format(booking.end, 'MMM d, HH:mm')}
                          </Text>
                        </div>
                      </Popover.Dropdown>
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
          <div
            key={i}
            className="text-xs font-medium text-center p-2 text-[var(--mantine-color-dimmed)]"
          >
            {format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), i), 'EEE')}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-1"
        onMouseLeave={() => selectingStart && setHoveredDate(null)}
      >
        {daysInMonthGrid.map((day, index) => {
          const isPast = isDayPast(day);
          const isBooked = isDayBooked(day);
          const bookings = isBooked ? getBookingsForDay(day) : [];
          const isPendingStart = isDayPendingStart(day);
          // Hide the previously confirmed range while a new selection is in progress.
          const isSelected = !selectingStart && isDaySelected(day);
          const isPreview = isDayInPreview(day) && !isPendingStart;
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isClickDisabled = isPast || isBooked;
          const isHighlighted = isSelected || isPendingStart;

          const dayButton = (
            <button
              onClick={() => !isClickDisabled && handleDayClick(day)}
              onMouseEnter={() => {
                if (selectingStart && !isClickDisabled) setHoveredDate(startOfDay(day));
              }}
              disabled={isPast && !isBooked}
              className={cn(
                'h-16 rounded transition-colors flex flex-col items-center justify-center p-1 w-full',
                !isCurrentMonth && 'text-[var(--mantine-color-dimmed)]',
                isPast && 'bg-[var(--mantine-color-gray-2)] cursor-not-allowed opacity-50',
                isBooked &&
                  !isPast &&
                  'bg-[var(--mantine-color-red-1)] cursor-pointer opacity-70 border border-[var(--mantine-color-red-3)]',
                !isClickDisabled &&
                  !isHighlighted &&
                  !isPreview &&
                  'bg-transparent hover:bg-[var(--mantine-color-gray-1)] border',
                isHighlighted &&
                  'bg-[var(--mantine-color-green-6)] text-white hover:bg-[var(--mantine-color-green-7)]',
                isPreview &&
                  'bg-[var(--mantine-color-green-2)] hover:bg-[var(--mantine-color-green-3)]',
                isSameDay(day, new Date()) &&
                  !isHighlighted &&
                  'border-2 border-[var(--mantine-color-green-6)]',
              )}
            >
              <span className="text-sm font-medium">{format(day, 'd')}</span>
            </button>
          );

          if (isBooked && bookings.length > 0) {
            return (
              <Popover key={index} withinPortal shadow="md">
                <Popover.Target>{dayButton}</Popover.Target>
                <Popover.Dropdown p={12}>
                  <div className="flex flex-col gap-2">
                    <div className="font-semibold text-sm">{format(day, 'MMM d, yyyy')}</div>
                    {bookings.map((booking, idx) => (
                      <div key={idx} className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 text-sm">
                          <User size={14} className="shrink-0" />
                          <span className="font-medium">{booking.userFullName}</span>
                        </div>
                        <Text size="xs" c="dimmed" className="ml-5">
                          {format(booking.start, 'HH:mm')} - {format(booking.end, 'HH:mm')}
                        </Text>
                      </div>
                    ))}
                  </div>
                </Popover.Dropdown>
              </Popover>
            );
          }

          return <div key={index}>{dayButton}</div>;
        })}
      </div>
    </div>
  );

  return (
    <Card withBorder className="w-full">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between">
          <Title order={3} fz="lg">
            {t('calendar.selectRentalPeriod')}
          </Title>
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={value => {
              if (value) setViewMode(value as 'weekly' | 'monthly');
            }}
            data={[
              { value: 'weekly', label: t('calendar.week') },
              { value: 'monthly', label: t('calendar.month') },
            ]}
          />
        </div>
        <div className="flex items-center justify-center gap-2">
          <ActionIcon variant="default" size="lg" onClick={goToPrevious} aria-label="Previous">
            <ChevronLeft size={16} />
          </ActionIcon>
          <span className="text-sm font-medium min-w-[180px] text-center">
            {viewMode === 'weekly'
              ? `${format(currentWeekStart, 'MMM d')} - ${format(
                  endOfWeek(currentWeekStart, { weekStartsOn: 1 }),
                  'MMM d, yyyy',
                )}`
              : format(currentDate, 'MMMM yyyy')}
          </span>
          <ActionIcon variant="default" size="lg" onClick={goToNext} aria-label="Next">
            <ChevronRight size={16} />
          </ActionIcon>
        </div>
      </div>

      {viewMode === 'weekly' ? renderWeeklyView() : renderMonthlyView()}

      {/* Live preview while a start tile is selected and an end is being chosen */}
      {selectingStart && (
        <Paper
          mt="md"
          p="md"
          radius="lg"
          withBorder
          bg="green.0"
          className="relative flex flex-wrap items-center justify-between gap-3"
        >
          <div>
            <Text size="sm" fw={500} mb={4}>
              {t('calendar.selectingPeriod')}
            </Text>
            {previewRange ? (
              <>
                <Text size="sm" c="dimmed">
                  {format(previewRange.start, 'EEE, MMM d, HH:mm')} –{' '}
                  {format(previewRange.end, 'EEE, MMM d, HH:mm')}
                </Text>
                <Text size="sm" fw={600} mt={2}>
                  {t('calendar.duration')}:{' '}
                  {formatDurationLabel(previewRange.start, previewRange.end)}
                </Text>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                {t('calendar.clickToSetEnd')}
              </Text>
            )}
          </div>
          <Button size="xs" variant="subtle" color="gray" onClick={clearSelection}>
            {t('calendar.clearSelection')}
          </Button>
        </Paper>
      )}

      {/* Selection Summary */}
      {!selectingStart && selectedStart && selectedEnd && (
        <Paper mt="md" p="md" radius="lg" bg="gray.1" className="relative">
          <Text size="sm" fw={500} mb={4}>
            {t('calendar.selectedPeriod')}:
          </Text>
          <Text size="sm" c="dimmed">
            <span className="font-medium">{t('calendar.from')}:</span>{' '}
            {format(selectedStart, 'EEE, MMM d, yyyy HH:mm')}
          </Text>
          <Text size="sm" c="dimmed">
            <span className="font-medium">{t('calendar.to')}:</span>{' '}
            {format(selectedEnd, 'EEE, MMM d, yyyy HH:mm')}
          </Text>
          <Text size="sm" fw={600} mt="xs">
            {t('calendar.duration')}:{' '}
            {Math.round((selectedEnd.getTime() - selectedStart.getTime()) / (1000 * 60 * 60))}{' '}
            {t('calendar.hours')}
          </Text>

          {/* Book Now button bottom-right */}
          <div className="absolute right-4 bottom-4">
            <Button size="sm" onClick={() => onBookNow && onBookNow(selectedStart, selectedEnd)}>
              {t('booking.bookNow')}
            </Button>
          </div>
        </Paper>
      )}
    </Card>
  );
};
