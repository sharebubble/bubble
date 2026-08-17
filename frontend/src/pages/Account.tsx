import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, Button, Card, Divider, Group, NavLink, Stack, Text } from '@mantine/core';
import { BookMarked, ChevronRight, Library, LogOut, Settings } from 'lucide-react';
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
];

const Account = () => {
  const { t } = useLanguage();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <main className="container mx-auto max-w-2xl px-4 py-4">
      <Stack gap="md">
        {/* Identity */}
        <Group gap="sm" wrap="nowrap">
          <Avatar size={48} radius="xl" color="green">
            {user?.email?.charAt(0).toUpperCase()}
          </Avatar>
          <div className="min-w-0">
            <Text fw={600} truncate>
              {user?.display || user?.username}
            </Text>
            <Text size="sm" c="dimmed" truncate>
              {user?.email}
            </Text>
          </div>
        </Group>

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
