import { Title } from '@mantine/core';
import { CalendarSubscription } from '@/components/calendar/CalendarSubscription';
import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';

const CalendarSettingsPage = () => {
  const { t } = useLanguage();

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8 flex items-center gap-2">
        <BackButton />
        <Title order={1} size="h3">
          {t('header.calendarSettings')}
        </Title>
      </div>
      <CalendarSubscription kind="user" />
    </div>
  );
};

export default CalendarSettingsPage;
