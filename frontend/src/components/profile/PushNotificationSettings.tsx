import { useLanguage } from '@/contexts/LanguageContext';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Alert, Button, Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Bell, BellOff, Send } from 'lucide-react';

/**
 * Browser push, which needs its own block rather than a row in the generic
 * channel list: the other channels are addressed by a profile field, this one has
 * to be granted per device, and the grant lives in the browser rather than on the
 * account. So there are two levels here — enable this device, then choose which
 * events are worth interrupting for.
 */
export const PushNotificationSettings = () => {
  const { t } = useLanguage();
  const {
    available,
    blocker,
    subscribed,
    loading,
    busy,
    testPending,
    subscribe,
    unsubscribe,
    sendTest,
  } = usePushNotifications();
  const { data: prefs } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  // Nothing to offer when the backend has no VAPID keys or the browser has no
  // Push API (iOS Safari, until the app is installed to the home screen).
  if (!available && blocker !== 'denied') return null;

  const handleEnable = async () => {
    try {
      const ok = await subscribe();
      // Permission was refused — the blocker alert below explains what to do, so
      // there is nothing to announce here.
      if (!ok) return;
      // Subscribing is only useful together with at least one event: opting in on
      // a device but receiving nothing would read as a broken feature.
      if (prefs?.webpush_messages !== true) {
        updatePrefs.mutate({ webpush_messages: true });
      }
    } catch {
      // pushManager.subscribe() can fail even after permission is granted — no
      // reachable push service, or a browser policy blocking it. Silence here
      // would leave the button looking like it simply did nothing.
      notifications.show({ message: t('push.enableFailed'), color: 'red' });
    }
  };

  const handleDisable = async () => {
    try {
      await unsubscribe();
    } catch {
      notifications.show({ message: t('push.disableFailed'), color: 'red' });
    }
  };

  const handleTest = async () => {
    try {
      await sendTest();
      notifications.show({ message: t('push.testSent'), color: 'green' });
    } catch {
      notifications.show({ message: t('push.testFailed'), color: 'red' });
    }
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={600}>{t('push.title')}</Text>
          <Text size="sm" c="dimmed">
            {t('push.description')}
          </Text>
        </div>
        {subscribed ? (
          <Button
            variant="default"
            size="sm"
            loading={busy}
            leftSection={<BellOff size={16} aria-hidden="true" />}
            onClick={handleDisable}
          >
            {t('push.disable')}
          </Button>
        ) : (
          <Button
            size="sm"
            loading={busy || loading}
            disabled={blocker === 'denied'}
            leftSection={<Bell size={16} aria-hidden="true" />}
            onClick={handleEnable}
          >
            {t('push.enable')}
          </Button>
        )}
      </Group>

      {blocker === 'denied' && (
        <Alert color="yellow" variant="light" mt="md">
          {t('push.blocked')}
        </Alert>
      )}

      {subscribed && (
        <Stack gap="sm" mt="md">
          <Checkbox
            checked={prefs?.webpush_messages === true}
            disabled={updatePrefs.isPending}
            onChange={event =>
              updatePrefs.mutate({ webpush_messages: event.currentTarget.checked })
            }
            label={t('profile.notifyMessages')}
            description={t('profile.notifyMessagesDesc')}
          />
          <Checkbox
            checked={prefs?.webpush_new_item === true}
            disabled={updatePrefs.isPending}
            onChange={event =>
              updatePrefs.mutate({ webpush_new_item: event.currentTarget.checked })
            }
            label={t('profile.notifyNewItem')}
            description={t('profile.notifyNewItemDesc')}
          />
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {t('push.deviceHint')}
            </Text>
            <Button
              variant="subtle"
              size="compact-sm"
              loading={testPending}
              leftSection={<Send size={14} aria-hidden="true" />}
              onClick={handleTest}
            >
              {t('push.test')}
            </Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
};
