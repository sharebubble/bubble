import { Text, Title } from '@mantine/core';
import { BackButton } from '@/components/layout/BackButton';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { useLanguage } from '@/contexts/LanguageContext';

const PersonalSettings = () => {
  const { t } = useLanguage();

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <BackButton />
          <Title order={1} size="h3">
            {t('profile.title')}
          </Title>
        </div>
        <Text c="dimmed" className="mt-2">
          {t('profile.manage')}
        </Text>
      </div>
      <ProfileForm />
    </div>
  );
};

export default PersonalSettings;
