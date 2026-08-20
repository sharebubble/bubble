import { ActionIcon, Avatar, Button, Indicator, Menu, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useUnreadMessages } from '@/hooks/useMessages';
import { useProfile } from '@/hooks/useProfile';
import { SearchBar } from '@/components/layout/SearchBar';

import { BROWSE_PATH } from '@/lib/routes';
import { cn } from '@/lib/utils';
import {
  Bell,
  BookMarked,
  Calendar,
  CalendarCheck,
  Compass,
  Download,
  Library,
  LogIn,
  LogOut,
  Plus,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

// Icon-over-label between `md` and `lg`: at `md` the header first gets wide
// enough to show these destinations at all, but there isn't yet room for
// icon-and-label side by side across five items plus the logo, search bar
// and avatar — that combination used to force the header itself to scroll
// horizontally. Stacking icon above a smaller label keeps every item
// narrow until `lg`, where there's space to lay them out in a row again.
//
// Colors go through Mantine's `bg`/`c` style props rather than Tailwind
// color utilities: Mantine's own component CSS is unlayered and beats
// Tailwind's layered utilities in the cascade (see the `hiddenFrom` note
// on MobileBottomNav below for the same gotcha), so a Tailwind
// `bg-[...]`/`text-...` class on an UnstyledButton is silently overridden.
type HeaderNavButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  variant?: 'subtle' | 'filled';
  badge?: number;
};

const HeaderNavButton = ({
  icon: Icon,
  label,
  onClick,
  active,
  variant = 'subtle',
  badge,
}: HeaderNavButtonProps) => {
  const [hovered, setHovered] = useState(false);
  const icon = <Icon size={20} aria-hidden="true" />;
  const filled = variant === 'filled';

  return (
    <UnstyledButton
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-current={active ? 'page' : undefined}
      bg={
        filled
          ? hovered
            ? 'green.7'
            : 'green.6'
          : hovered
            ? 'var(--mantine-color-default-hover)'
            : undefined
      }
      c={filled ? 'white' : active ? undefined : 'dimmed'}
      fw={active && !filled ? 600 : undefined}
      className="flex flex-col items-center gap-0.5 rounded-md px-2.5 py-1.5 text-[11px] leading-none transition-colors lg:flex-row lg:gap-2 lg:text-sm"
    >
      {badge !== undefined && badge > 0 ? (
        <Indicator label={badge} color="red" size={16} offset={2}>
          {icon}
        </Indicator>
      ) : (
        icon
      )}
      <span>{label}</span>
    </UnstyledButton>
  );
};

export const Header = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: unreadMessages } = useUnreadMessages();
  const { data: profile } = useProfile();
  const { canInstall, promptInstall } = useInstallPrompt();

  const { t } = useLanguage();

  const unreadCount = unreadMessages?.count || 0;

  // The header (logo + search bar) is always shown on desktop. On mobile it's
  // only relevant on the screens that act as the search bar's entry points —
  // the start page and the browse/search screen itself — so the whole bar is
  // hidden everywhere else to keep those screens uncluttered. `md:block`
  // keeps it unconditional on desktop regardless of route.
  const showHeaderOnMobile = location.pathname === '/' || location.pathname === BROWSE_PATH;
  const headerClassName = cn(
    'sticky top-0 z-50 w-full border-b border-border bg-background/95 md:block md:bg-background/80 md:backdrop-blur-md',
    showHeaderOnMobile ? 'block' : 'hidden',
  );
  const searchWrapperClassName = 'min-w-0 flex-1 max-w-lg';

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (!user) {
    return (
      <header className={headerClassName}>
        <div className="mx-auto w-full max-w-[1400px] px-4 py-3 sm:px-8">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <NavLink to="/" className="flex shrink-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg overflow-hidden">
                <img src="/logo.png" alt="bubble logo" className="h-10 w-10 object-cover" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xl font-bold text-foreground">bubble</h1>
                <p className="text-xs text-muted-foreground">Community Network</p>
              </div>
            </NavLink>
            <div className={searchWrapperClassName}>
              <SearchBar loggedIn={false} />
            </div>

            <Button
              variant="default"
              size="sm"
              leftSection={<LogIn size={16} aria-hidden="true" />}
              onClick={() => navigate('/profile')}
              // The label is hidden on narrow screens, so name the button explicitly.
              aria-label={t('header.signIn')}
            >
              <span className="hidden sm:inline">{t('header.signIn')}</span>
            </Button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className={headerClassName}>
      <div className="mx-auto w-full max-w-[1400px] px-4 py-3 sm:px-8">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Logo */}
          <NavLink to="/" className="flex shrink-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg overflow-hidden">
              <img src="/logo.png" alt="bubble logo" className="h-10 w-10 object-cover" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold text-foreground">bubble</h1>
              <p className="text-xs text-muted-foreground">Community Network</p>
            </div>
          </NavLink>

          {/* Search Bar */}
          <div className={searchWrapperClassName}>
            <SearchBar loggedIn />
          </div>

          {/* Actions — hidden below `md`, where MobileBottomNav covers the same
              destinations (Browse, Bookings, Add, Account). The breakpoint must
              stay in sync with that bar's `hiddenFrom="md"`. */}
          <div className="hidden shrink-0 items-center gap-1 md:flex lg:gap-2">
            {/* Browse — "/" is the start page, so the catalogue needs its own
                entry point here. */}
            <HeaderNavButton
              icon={Compass}
              label={t('header.browse')}
              onClick={() => navigate(BROWSE_PATH)}
              active={location.pathname === BROWSE_PATH}
            />

            {/* My Items */}
            <HeaderNavButton
              icon={Library}
              label={t('header.items')}
              onClick={() => navigate('/my-items')}
              active={location.pathname.startsWith('/my-items')}
            />

            {/* Bookings — also the home of booking conversations and their
                unread-message notifications, hence the badge. */}
            <HeaderNavButton
              icon={CalendarCheck}
              label={t('header.bookings')}
              onClick={() => navigate('/bookings')}
              active={location.pathname.startsWith('/bookings')}
              badge={unreadCount}
            />

            {/* Collections */}
            <HeaderNavButton
              icon={BookMarked}
              label={t('collections.title')}
              onClick={() => navigate('/collections')}
              active={location.pathname.startsWith('/collections')}
            />

            {/* Add Item */}
            <HeaderNavButton
              icon={Plus}
              label={t('header.shareItem')}
              onClick={() => navigate('/create-item')}
              active={location.pathname.startsWith('/create-item')}
              variant="filled"
            />

            {/* Profile Dropdown */}
            <Menu position="bottom-end" shadow="md" width={224}>
              <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label={t('header.myProfile')}>
                  <Avatar size={20} radius="xl" color="green" src={profile?.profile_image}>
                    {user.email?.charAt(0).toUpperCase()}
                  </Avatar>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  component={NavLink}
                  to="/profile"
                  leftSection={<User size={16} aria-hidden="true" />}
                >
                  {t('account.settings')}
                </Menu.Item>
                <Menu.Item
                  component={NavLink}
                  to="/profile/notifications"
                  leftSection={<Bell size={16} aria-hidden="true" />}
                >
                  {t('header.notificationSettings')}
                </Menu.Item>
                <Menu.Item
                  component={NavLink}
                  to="/profile/calendar"
                  leftSection={<Calendar size={16} aria-hidden="true" />}
                >
                  {t('header.calendarSettings')}
                </Menu.Item>
                {/* Only rendered while the browser is actually offering an
                    install; Safari never does and handles it in its share menu. */}
                {canInstall && (
                  <Menu.Item
                    leftSection={<Download size={16} aria-hidden="true" />}
                    onClick={() => void promptInstall()}
                  >
                    {t('pwa.install')}
                  </Menu.Item>
                )}
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<LogOut size={16} aria-hidden="true" />}
                  onClick={handleSignOut}
                >
                  {t('header.signOut')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
      </div>
    </header>
  );
};
