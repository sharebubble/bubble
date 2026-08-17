import { useLanguage } from '@/contexts/LanguageContext';
import { Group, Text } from '@mantine/core';
import { useNetwork } from '@mantine/hooks';
import { WifiOff } from 'lucide-react';

/**
 * Tells the user why things stopped loading.
 *
 * The service worker keeps already-visited pages and images available offline,
 * but every list, booking and message still needs the API — without a marker the
 * app just looks broken. Sits above the mobile bottom navigation and clears the
 * iOS home indicator via the same safe-area inset that bar uses.
 */
export const OfflineIndicator = () => {
  const { online } = useNetwork();
  const { t } = useLanguage();

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-16 z-50 flex justify-center px-4 md:bottom-4"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <Group
        gap="xs"
        wrap="nowrap"
        className="rounded-full px-3 py-1.5 shadow-md"
        style={{
          backgroundColor: 'var(--mantine-color-dark-6)',
          color: 'var(--mantine-color-gray-0)',
        }}
      >
        <WifiOff size={16} aria-hidden="true" />
        <Text size="sm">{t('pwa.offline')}</Text>
      </Group>
    </div>
  );
};
