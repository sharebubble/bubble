import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useDismissPwaInstallPrompt, useProfile } from '@/hooks/useProfile';
import { Button, CloseButton, Group, Paper, Text } from '@mantine/core';
import { Download } from 'lucide-react';
import { useState } from 'react';

/**
 * Offers to install Bubble as a home-screen app to mobile visitors whose
 * browser supports it (Chromium; Safari never fires `beforeinstallprompt`
 * and is left to its own share-sheet flow, same as the header/account menus).
 *
 * Dismissing is permanent and account-wide: it's recorded on the profile
 * rather than just this device, so the prompt doesn't come back on a
 * reinstall or a different phone. The local `dismissed` state hides it
 * immediately rather than waiting on that round trip.
 */
export const PwaInstallBanner = () => {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const dismissPrompt = useDismissPwaInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  // Wait for the profile before deciding — otherwise an already-dismissed
  // account would see the banner flash for the instant it takes to load.
  if (
    !isMobile ||
    !canInstall ||
    installed ||
    dismissed ||
    profileLoading ||
    profile?.pwa_install_dismissed
  ) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    dismissPrompt.mutate();
  };

  return (
    <Paper withBorder radius="md" p="sm" mb="md">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" className="min-w-0">
          <Download
            size={20}
            className="shrink-0"
            color="light-dark(var(--mantine-color-green-6), var(--mantine-color-green-4))"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <Text size="sm" fw={600}>
              {t('pwa.installBannerTitle')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('pwa.installBannerMessage')}
            </Text>
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap" className="shrink-0">
          <Button size="xs" onClick={() => void promptInstall()}>
            {t('pwa.install')}
          </Button>
          <CloseButton aria-label={t('pwa.installBannerDismiss')} onClick={handleDismiss} />
        </Group>
      </Group>
    </Paper>
  );
};
