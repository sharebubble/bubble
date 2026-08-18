import { Card, Checkbox, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { Check, Loader2 } from 'lucide-react';
import React from 'react';
import { PushNotificationSettings } from '@/components/profile/PushNotificationSettings';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import { useProfile } from '@/hooks/useProfile';
import { useProfileFieldAutoSave } from '@/hooks/useProfileFieldAutoSave';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import type { NotificationPreferenceMe, PatchedNotificationPreferenceMe } from '@/services/django';
import { useQueryClient } from '@tanstack/react-query';

// `webpush` is deliberately absent: it needs a per-device grant, so
// PushNotificationSettings renders it instead of the generic row below.
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
  const { available: pushAvailable } = usePushNotifications();
  const { data: profile } = useProfile();
  const { fieldStates, saveField } = useProfileFieldAutoSave();
  const queryClient = useQueryClient();
  const hasPrefilledMatrixId = React.useRef(false);
  const matrixIdForm = useForm({ initialValues: { matrix_id: '' } });

  React.useEffect(() => {
    if (profile) matrixIdForm.setValues({ matrix_id: profile.matrix_id ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const isAvailable = (provider: Provider) =>
    prefs?.[`${provider}_available` as keyof NotificationPreferenceMe] === true;

  const isConfigured = (provider: Provider) =>
    prefs?.[`${provider}_configured` as keyof NotificationPreferenceMe] === true;

  // Every other channel is only ever shown once it's already reachable
  // (its target field is filled in), so its panel doubles as a status
  // display. Matrix is the exception: its ID field now lives inside this
  // panel, so the panel has to appear as soon as Matrix is configured on the
  // backend — otherwise there'd be nowhere to type the ID in the first place.
  const visibleProviders = PROVIDERS.filter(p =>
    p.id === 'matrix' ? isConfigured(p.id) : isAvailable(p.id),
  );

  const toggle = (field: ToggleField, checked: boolean) => {
    const payload: PatchedNotificationPreferenceMe = { [field]: checked };
    updatePrefs.mutate(payload);
  };

  // Saving the Matrix ID changes matrix_available/matrix_target, so refresh
  // notification preferences afterwards instead of waiting for a reload.
  const saveMatrixId = React.useCallback(
    async (value: string): Promise<boolean> => {
      const success = await saveField('matrix_id', value);
      queryClient.invalidateQueries({
        queryKey: ['notification-preferences', profile?.username],
      });
      return success;
    },
    [saveField, queryClient, profile?.username],
  );

  // When Matrix notifications are configured on the backend but this user has
  // no Matrix ID yet, prefill it with their bubble username (same as
  // RocketChat, which always addresses users by their bubble username) so the
  // Matrix notification options work without requiring manual setup.
  React.useEffect(() => {
    if (hasPrefilledMatrixId.current) return;
    if (!profile || !prefs) return;
    if (!prefs.matrix_configured) return;
    if (profile.matrix_id || !profile.username) return;

    // Set the ref up front so a re-render during the save can't trigger a
    // second attempt.
    hasPrefilledMatrixId.current = true;
    const username = profile.username;
    matrixIdForm.setFieldValue('matrix_id', username);
    saveMatrixId(username).then(success => {
      if (!success) {
        // Roll back so the form doesn't show an unpersisted value, and clear
        // the ref so the next profile/prefs refetch can retry.
        hasPrefilledMatrixId.current = false;
        matrixIdForm.setFieldValue('matrix_id', '');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, prefs]);

  const matrixIdBorderClass = () => {
    const status = fieldStates.matrix_id?.status;
    if (status === 'success') return 'border-green-500 focus-visible:ring-green-500';
    if (status === 'error') return 'border-destructive focus-visible:ring-destructive';
    return '';
  };

  const matrixIdStatusIcon = () => {
    const status = fieldStates.matrix_id?.status;
    if (status === 'saving')
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (status === 'success') return <Check className="h-4 w-4 text-green-500" />;
    return null;
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
      ) : visibleProviders.length === 0 && !pushAvailable ? (
        <Text size="sm" c="dimmed">
          {t('profile.notificationsUnavailable')}
        </Text>
      ) : (
        <Stack gap="lg">
          <PushNotificationSettings />
          {visibleProviders.map(provider => {
            const target = prefs?.[`${provider.id}_target` as keyof NotificationPreferenceMe] as
              string | undefined;
            const messagesField = `${provider.id}_messages` as ToggleField;
            const newItemField = `${provider.id}_new_item` as ToggleField;
            const isMatrix = provider.id === 'matrix';

            return (
              <Paper key={provider.id} withBorder radius="md" p="md">
                <Text fw={600}>{t(provider.labelKey)}</Text>
                {isMatrix ? (
                  <TextInput
                    className="mt-2 mb-3"
                    label={t('profile.matrixId')}
                    placeholder="@alice:matrix.org"
                    description={t('profile.matrixIdDesc')}
                    classNames={{ input: matrixIdBorderClass() }}
                    rightSection={matrixIdStatusIcon()}
                    {...matrixIdForm.getInputProps('matrix_id')}
                    onBlur={() => saveMatrixId(matrixIdForm.getValues().matrix_id)}
                  />
                ) : (
                  target && (
                    <Text size="xs" c="dimmed" className="mb-3">
                      {t('profile.channelTarget')}: {target}
                    </Text>
                  )
                )}
                <Stack gap="sm" className="mt-2">
                  <Checkbox
                    checked={prefs?.[messagesField] === true}
                    disabled={updatePrefs.isPending || !target}
                    onChange={event => toggle(messagesField, event.currentTarget.checked)}
                    label={t('profile.notifyMessages')}
                    description={t('profile.notifyMessagesDesc')}
                  />
                  <Checkbox
                    checked={prefs?.[newItemField] === true}
                    disabled={updatePrefs.isPending || !target}
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
