import { ActionIcon, Avatar, Button, Indicator, Menu } from '@mantine/core';
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
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

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
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            {/* Browse — "/" is the start page, so the catalogue needs its own
                entry point here. */}
            <Button
              variant="subtle"
              size="sm"
              color="gray"
              onClick={() => navigate(BROWSE_PATH)}
              aria-current={location.pathname === BROWSE_PATH ? 'page' : undefined}
              className={cn(location.pathname === BROWSE_PATH && '!font-semibold')}
              leftSection={<Compass size={20} aria-hidden="true" />}
            >
              {t('header.browse')}
            </Button>

            {/* My Items */}
            <Button
              variant="subtle"
              size="sm"
              color="gray"
              onClick={() => navigate('/my-items')}
              aria-current={location.pathname.startsWith('/my-items') ? 'page' : undefined}
              className={cn(location.pathname.startsWith('/my-items') && '!font-semibold')}
              leftSection={<Library size={20} aria-hidden="true" />}
            >
              {t('header.items')}
            </Button>

            {/* Bookings — also the home of booking conversations and their
                unread-message notifications, hence the badge. */}
            <Indicator
              label={unreadCount}
              color="red"
              size={20}
              disabled={unreadCount === 0}
              offset={4}
            >
              <Button
                variant="subtle"
                size="sm"
                color="gray"
                onClick={() => navigate('/bookings')}
                aria-current={location.pathname.startsWith('/bookings') ? 'page' : undefined}
                className={cn(location.pathname.startsWith('/bookings') && '!font-semibold')}
                title={t('header.bookings')}
                leftSection={<CalendarCheck size={20} aria-hidden="true" />}
              >
                {t('header.bookings')}
              </Button>
            </Indicator>

            {/* Collections */}
            <Button
              variant="subtle"
              size="sm"
              color="gray"
              onClick={() => navigate('/collections')}
              aria-current={location.pathname.startsWith('/collections') ? 'page' : undefined}
              className={cn(location.pathname.startsWith('/collections') && '!font-semibold')}
              leftSection={<BookMarked size={20} aria-hidden="true" />}
            >
              {t('collections.title')}
            </Button>

            {/* Add Item */}
            <Button
              variant="filled"
              size="sm"
              leftSection={<Plus size={16} aria-hidden="true" />}
              onClick={() => navigate('/create-item')}
              aria-current={location.pathname.startsWith('/create-item') ? 'page' : undefined}
            >
              {t('header.shareItem')}
            </Button>

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
