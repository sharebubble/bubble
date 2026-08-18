import { Title } from '@mantine/core';
import { BackButton } from '@/components/layout/BackButton';
import { NotificationSettings as NotificationSettingsForm } from '@/components/profile/NotificationSettings';
import { useLanguage } from '@/contexts/LanguageContext';

const NotificationSettingsPage = () => {
  const { t } = useLanguage();

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8 flex items-center gap-2">
        <BackButton />
        <Title order={1} size="h3">
          {t('header.notificationSettings')}
        </Title>
      </div>
      <NotificationSettingsForm />
    </div>
  );
};

export default NotificationSettingsPage;
