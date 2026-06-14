import { Text, Title } from '@mantine/core';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { useLanguage } from '@/contexts/LanguageContext';

const Profile = () => {
  const { t } = useLanguage();

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <Title order={1}>{t('profile.title')}</Title>
        <Text c="dimmed" className="mt-2">
          {t('profile.manage')}
        </Text>
      </div>
      <ProfileForm />
    </div>
  );
};

export default Profile;
