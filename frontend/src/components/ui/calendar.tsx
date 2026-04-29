import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, useDayPicker, type MonthCaptionProps } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function MonthCaptionWithNav({ calendarMonth, displayIndex }: MonthCaptionProps) {
  const {
    goToMonth,
    nextMonth,
    previousMonth,
    formatters: { formatMonthCaption },
    locale,
  } = useDayPicker();

  return (
    <div className="flex items-center justify-between pt-1 h-7 px-1">
      <button
        type="button"
        onClick={() => previousMonth && goToMonth(previousMonth)}
        disabled={!previousMonth}
        aria-label="Go to previous month"
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'h-6 w-6 p-0 opacity-50 hover:opacity-100 disabled:opacity-20',
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <span className="text-sm font-medium">
        {formatMonthCaption(calendarMonth.date, { locale })}
      </span>

      <button
        type="button"
        onClick={() => nextMonth && goToMonth(nextMonth)}
        disabled={!nextMonth}
        aria-label="Go to next month"
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'h-6 w-6 p-0 opacity-50 hover:opacity-100 disabled:opacity-20',
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-4',
        month_caption: '',
        caption_label: 'text-sm font-medium',
        nav: 'hidden',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center',
        weeks: 'flex flex-col gap-2 mt-2',
        week: 'flex w-full',
        day: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day_button: cn(buttonVariants({ variant: 'ghost' }), 'h-9 w-9 p-0 font-normal'),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground [&>button]:focus:bg-primary [&>button]:focus:text-primary-foreground',
        today: '[&>button]:bg-accent [&>button]:text-accent-foreground [&>button]:font-semibold',
        outside: 'text-muted-foreground opacity-50',
        disabled: '[&>button]:text-muted-foreground [&>button]:opacity-50',
        range_middle: '[&>button]:bg-accent [&>button]:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        MonthCaption: MonthCaptionWithNav,
        Chevron: ({ orientation }) => {
          if (orientation === 'left') return <ChevronLeft className="h-4 w-4" />;
          return <ChevronRight className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
