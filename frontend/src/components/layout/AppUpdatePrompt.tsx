import { useLanguage } from '@/contexts/LanguageContext';
import { useServiceWorkerUpdate } from '@/hooks/useServiceWorkerUpdate';
import { applyServiceWorkerUpdate } from '@/lib/serviceWorker';
import { Button, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

const NOTIFICATION_ID = 'app-update-available';

/**
 * Offers a reload once the service worker has a new build waiting.
 *
 * Renders nothing itself — the prompt is a sticky notification so it never
 * displaces content, and it stays put until the user acts on or dismisses it.
 */
export const AppUpdatePrompt = () => {
  const updateReady = useServiceWorkerUpdate();
  const { t } = useLanguage();

  useEffect(() => {
    if (!updateReady) return;

    notifications.show({
      id: NOTIFICATION_ID,
      title: t('pwa.updateTitle'),
      color: 'green',
      icon: <RefreshCw size={18} aria-hidden="true" />,
      autoClose: false,
      message: (
        <Stack gap="xs" align="flex-start">
          <Text size="sm">{t('pwa.updateMessage')}</Text>
          <Button size="xs" onClick={applyServiceWorkerUpdate}>
            {t('pwa.updateAction')}
          </Button>
        </Stack>
      ),
    });

    return () => {
      notifications.hide(NOTIFICATION_ID);
    };
  }, [updateReady, t]);

  return null;
};
