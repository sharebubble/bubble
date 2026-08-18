import { Button, Card, Text, TextInput, Title, useMantineColorScheme } from '@mantine/core';
import { useForm } from '@mantine/form';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useProfile } from '@/hooks/useProfile';
import { useProfileFieldAutoSave } from '@/hooks/useProfileFieldAutoSave';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Monitor, Moon, Sun } from 'lucide-react';
import React from 'react';
import { z } from 'zod';

const profileSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export const ProfileForm = () => {
  const { data: profile, isLoading } = useProfile();
  const { data: notificationPrefs } = useNotificationPreferences();
  const { fieldStates, saveField } = useProfileFieldAutoSave();
  const { language, setLanguage, t } = useLanguage();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const queryClient = useQueryClient();

  // Notification availability (which channels a user can be reached on)
  // depends on the profile fields saved above, so refresh it whenever one of
  // those fields is saved — otherwise the Notifications card would keep
  // showing its previous, now-stale set of channels until the next reload.
  const saveFieldAndRefreshNotifications = React.useCallback(
    async (fieldName: string, value: unknown): Promise<boolean> => {
      const success = await saveField(fieldName, value);
      queryClient.invalidateQueries({
        queryKey: ['notification-preferences', profile?.username],
      });
      return success;
    },
    [saveField, queryClient, profile?.username],
  );

  const form = useForm<ProfileFormData>({
    validate: zod4Resolver(profileSchema),
    initialValues: {
      name: '',
      phone: '',
    },
  });

  React.useEffect(() => {
    if (profile) {
      form.setValues({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const getFieldBorderClass = (fieldName: string) => {
    const status = fieldStates[fieldName]?.status;
    if (status === 'success') return 'border-green-500 focus-visible:ring-green-500';
    if (status === 'error') return 'border-destructive focus-visible:ring-destructive';
    return '';
  };

  const renderFieldStatusIcon = (fieldName: string) => {
    const status = fieldStates[fieldName]?.status;
    if (status === 'saving')
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (status === 'success') return <Check className="h-4 w-4 text-green-500" />;
    return null;
  };

  if (isLoading) {
    return (
      <Card withBorder padding="lg">
        <div className="flex justify-center items-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card withBorder padding="lg">
        <Title order={3} className="mb-4">
          {t('profile.title')}
        </Title>

        {/* Read-only account fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <TextInput
            label={t('profile.username')}
            value={profile?.username ?? '—'}
            readOnly
            variant="filled"
          />
          <TextInput
            label={t('profile.email')}
            value={profile?.email ?? '—'}
            readOnly
            variant="filled"
          />
        </div>

        <form className="space-y-6">
          <TextInput
            label={t('profile.name')}
            placeholder={t('profile.name')}
            classNames={{ input: getFieldBorderClass('name') }}
            rightSection={renderFieldStatusIcon('name')}
            {...form.getInputProps('name')}
            onBlur={() => saveField('name', form.getValues().name)}
          />

          <TextInput
            label={t('profile.phone')}
            placeholder={t('profile.phone')}
            classNames={{ input: getFieldBorderClass('phone') }}
            rightSection={renderFieldStatusIcon('phone')}
            {...form.getInputProps('phone')}
            onBlur={() => saveFieldAndRefreshNotifications('phone', form.getValues().phone)}
          />

          {notificationPrefs?.rocketchat_configured && (
            <TextInput
              label={t('profile.rocketchatUsername')}
              description={t('profile.rocketchatUsernameDesc')}
              value={profile?.username ?? ''}
              readOnly
              variant="filled"
            />
          )}
        </form>
      </Card>

      {/* Appearance Card */}
      <Card withBorder padding="lg" className="mt-6">
        <Title order={3} className="mb-4">
          {t('profile.appearance')}
        </Title>
        <div className="flex gap-2">
          <Button
            variant={colorScheme === 'light' ? 'filled' : 'outline'}
            size="sm"
            leftSection={<Sun size={16} />}
            onClick={() => setColorScheme('light')}
          >
            {t('header.light')}
          </Button>
          <Button
            variant={colorScheme === 'dark' ? 'filled' : 'outline'}
            size="sm"
            leftSection={<Moon size={16} />}
            onClick={() => setColorScheme('dark')}
          >
            {t('header.dark')}
          </Button>
          <Button
            variant={colorScheme === 'auto' ? 'filled' : 'outline'}
            size="sm"
            leftSection={<Monitor size={16} />}
            onClick={() => setColorScheme('auto')}
          >
            {t('profile.themeAuto')}
          </Button>
        </div>
      </Card>

      {/* Language Card */}
      <Card withBorder padding="lg" className="mt-6">
        <Title order={3} className="mb-4">
          {t('profile.language')}
        </Title>
        <div className="flex gap-2">
          <Button
            variant={language === 'en' ? 'filled' : 'outline'}
            size="sm"
            onClick={() => setLanguage('en')}
          >
            🇺🇸 English
          </Button>
          <Button
            variant={language === 'de' ? 'filled' : 'outline'}
            size="sm"
            onClick={() => setLanguage('de')}
          >
            🇩🇪 Deutsch
          </Button>
        </div>
      </Card>
    </>
  );
};
