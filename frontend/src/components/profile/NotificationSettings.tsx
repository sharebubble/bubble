import { Card, Checkbox, Paper, Stack, Text, Title } from '@mantine/core';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import type { NotificationPreferenceMe, PatchedNotificationPreferenceMe } from '@/services/django';

type Provider = 'rocketchat' | 'signal' | 'matrix' | 'email';

// Only the writable boolean toggles — never the readonly availability/target fields.
type ToggleField = `${Provider}_messages` | `${Provider}_new_item`;

const PROVIDERS: { id: Provider; labelKey: string }[] = [
  { id: 'rocketchat', labelKey: 'profile.channelRocketchat' },
  { id: 'signal', labelKey: 'profile.channelSignal' },
  { id: 'matrix', labelKey: 'profile.channelMatrix' },
  { id: 'email', labelKey: 'profile.channelEmail' },
];

export const NotificationSettings = () => {
  const { t } = useLanguage();
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  const isAvailable = (provider: Provider) =>
    prefs?.[`${provider}_available` as keyof NotificationPreferenceMe] === true;

  const availableProviders = PROVIDERS.filter(p => isAvailable(p.id));

  const toggle = (field: ToggleField, checked: boolean) => {
    const payload: PatchedNotificationPreferenceMe = { [field]: checked };
    updatePrefs.mutate(payload);
  };

  return (
    <Card withBorder padding="lg" className="mt-6">
      <Title order={3}>{t('profile.notifications')}</Title>
      <Text size="sm" c="dimmed" className="mb-4">
        {t('profile.notificationsDesc')}
      </Text>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : availableProviders.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('profile.notificationsUnavailable')}
        </Text>
      ) : (
        <Stack gap="lg">
          {availableProviders.map(provider => {
            const target = prefs?.[`${provider.id}_target` as keyof NotificationPreferenceMe] as
              | string
              | undefined;
            const messagesField = `${provider.id}_messages` as ToggleField;
            const newItemField = `${provider.id}_new_item` as ToggleField;

            return (
              <Paper key={provider.id} withBorder radius="md" p="md">
                <Text fw={600}>{t(provider.labelKey)}</Text>
                {target && (
                  <Text size="xs" c="dimmed" className="mb-3">
                    {t('profile.channelTarget')}: {target}
                  </Text>
                )}
                <Stack gap="sm" className="mt-2">
                  <Checkbox
                    checked={prefs?.[messagesField] === true}
                    disabled={updatePrefs.isPending}
                    onChange={event => toggle(messagesField, event.currentTarget.checked)}
                    label={t('profile.notifyMessages')}
                    description={t('profile.notifyMessagesDesc')}
                  />
                  <Checkbox
                    checked={prefs?.[newItemField] === true}
                    disabled={updatePrefs.isPending}
                    onChange={event => toggle(newItemField, event.currentTarget.checked)}
                    label={t('profile.notifyNewItem')}
                    description={t('profile.notifyNewItemDesc')}
                  />
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Card>
  );
};
