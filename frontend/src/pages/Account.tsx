import { BalanceCard } from '@/components/payments/BalanceCard';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useProfile } from '@/hooks/useProfile';
import {
  Avatar,
  Button,
  Card,
  Divider,
  Group,
  NavLink,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  Bell,
  BookMarked,
  Calendar,
  ChevronRight,
  Download,
  Library,
  LogOut,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';

interface HubEntry {
  labelKey: string;
  icon: LucideIcon;
  to: string;
}

// The user-owned areas of the app. On desktop these live in the header avatar
// menu; on mobile that menu is hidden, so this hub is their entry point.
const ENTRIES: HubEntry[] = [
  { labelKey: 'header.items', icon: Library, to: '/my-items' },
  { labelKey: 'collections.title', icon: BookMarked, to: '/collections' },
  { labelKey: 'account.settings', icon: Settings, to: '/profile' },
  { labelKey: 'header.notificationSettings', icon: Bell, to: '/profile/notifications' },
  { labelKey: 'header.calendarSettings', icon: Calendar, to: '/profile/calendar' },
];

const Account = () => {
  const { t } = useLanguage();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const { installed, canInstall, promptInstall } = useInstallPrompt();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  // `beforeinstallprompt` only fires once the browser decides the visit is
  // "engaged" enough, and Safari never fires it at all — so `canInstall` can
  // still be false here even though installing is possible. The entry stays
  // visible regardless and falls back to manual instructions when there's no
  // captured prompt to trigger.
  const handleInstallClick = async () => {
    if (canInstall) {
      await promptInstall();
      return;
    }
    notifications.show({
      message: t('pwa.installManualInstructions'),
      color: 'blue',
      autoClose: 8000,
    });
  };

  return (
    <main className="container mx-auto max-w-2xl px-4 py-4">
      <Stack gap="md">
        {/* Identity — links to Personal Settings, same destination as the
            account.settings entry below. */}
        <UnstyledButton
          onClick={() => navigate('/profile')}
          aria-label={t('account.settings')}
          className="w-full"
        >
          <Group gap="sm" wrap="nowrap">
            <Avatar size={48} radius="xl" color="green" src={profile?.profile_image}>
              {user?.email?.charAt(0).toUpperCase()}
            </Avatar>
            <div className="min-w-0">
              <Text fw={600} truncate>
                {profile?.name || user?.username}
              </Text>
              <Text size="sm" c="dimmed" truncate>
                {user?.email}
              </Text>
            </div>
          </Group>
        </UnstyledButton>

        {/* Balance — what this member has paid and received across bookings.
            Renders nothing until something has been recorded. */}
        <BalanceCard />

        {/* Destinations */}
        <Card withBorder padding={0}>
          {ENTRIES.map(({ labelKey, icon: Icon, to }, index) => (
            <Fragment key={to}>
              {index > 0 && <Divider />}
              <NavLink
                label={t(labelKey)}
                onClick={() => navigate(to)}
                leftSection={<Icon size={20} aria-hidden="true" />}
                rightSection={<ChevronRight size={16} aria-hidden="true" />}
              />
            </Fragment>
          ))}
          {/* The header's avatar menu is hidden on mobile, so the install offer
              lives here too — this hub is where phone users end up. Shown
              whenever the app isn't already installed, not just when a
              `beforeinstallprompt` has been captured (see handleInstallClick). */}
          {isMobile && !installed && (
            <>
              <Divider />
              <NavLink
                label={t('pwa.install')}
                onClick={() => void handleInstallClick()}
                leftSection={<Download size={20} aria-hidden="true" />}
                rightSection={<ChevronRight size={16} aria-hidden="true" />}
              />
            </>
          )}
        </Card>

        {/* Sign out */}
        <Button
          variant="subtle"
          // `color` alone resolves to a near-white shade under the dark scheme,
          // dropping the destructive cue. Pin the label to a red per scheme so
          // it keeps enough contrast against both backgrounds.
          color="red"
          c="light-dark(var(--mantine-color-red-9), var(--mantine-color-red-4))"
          fullWidth
          justify="flex-start"
          leftSection={<LogOut size={20} aria-hidden="true" />}
          onClick={handleSignOut}
        >
          {t('header.signOut')}
        </Button>
      </Stack>
    </main>
  );
};

export default Account;
