import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, Card, Text, UnstyledButton } from '@mantine/core';
import { BookMarked, CalendarCheck, ChevronRight, Library, LogOut, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  { labelKey: 'header.bookings', icon: CalendarCheck, to: '/bookings' },
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

  const rowClass =
    'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--mantine-color-gray-0)]';

  return (
    <main className="container mx-auto max-w-2xl px-4 py-4">
      {/* Identity */}
      <div className="mb-4 flex items-center gap-3">
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
      </div>

      {/* Destinations */}
      <Card withBorder radius="lg" padding={0} className="overflow-hidden">
        {ENTRIES.map(({ labelKey, icon: Icon, to }, index) => (
          <UnstyledButton
            key={to}
            onClick={() => navigate(to)}
            className={rowClass}
            style={
              index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined
            }
          >
            <Icon size={20} className="shrink-0 text-[var(--mantine-color-dimmed)]" />
            <Text size="sm" className="flex-1">
              {t(labelKey)}
            </Text>
            <ChevronRight size={16} className="shrink-0 text-[var(--mantine-color-dimmed)]" />
          </UnstyledButton>
        ))}
      </Card>

      {/* Sign out */}
      <Card withBorder radius="lg" padding={0} className="mt-4 overflow-hidden">
        <UnstyledButton onClick={handleSignOut} className={rowClass}>
          <LogOut size={20} className="shrink-0" color="var(--mantine-color-red-6)" />
          <Text size="sm" c="red.6" className="flex-1">
            {t('header.signOut')}
          </Text>
        </UnstyledButton>
      </Card>
    </main>
  );
};

export default Account;
