import { ActionIcon, Avatar, Button, Indicator, Menu } from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadMessages } from '@/hooks/useMessages';
import { SearchBar } from '@/components/layout/SearchBar';

import { cn } from '@/lib/utils';
import {
  BookMarked,
  CalendarCheck,
  Handshake,
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

  const { t } = useLanguage();

  const unreadCount = unreadMessages?.count || 0;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (!user) {
    return (
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 md:bg-background/80 md:backdrop-blur-md">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <NavLink to="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg overflow-hidden">
                <img src="/logo.png" alt="bubble logo" className="h-10 w-10 object-cover" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-xl font-bold text-foreground">bubble</h1>
                <p className="text-xs text-muted-foreground">Community Network</p>
              </div>
            </NavLink>
            <div className="flex-1 max-w-lg">
              <SearchBar loggedIn={false} />
            </div>

            <Button
              variant="default"
              size="sm"
              leftSection={<LogIn size={16} aria-hidden="true" />}
              onClick={() => navigate('/profile')}
            >
              <span className="hidden sm:inline">{t('header.signIn')}</span>
            </Button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 md:bg-background/80 md:backdrop-blur-md">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg overflow-hidden">
              <img src="/logo.png" alt="bubble logo" className="h-10 w-10 object-cover" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold text-foreground">bubble</h1>
              <p className="text-xs text-muted-foreground">Community Network</p>
            </div>
          </NavLink>

          {/* Search Bar */}
          <div className="flex-1 max-w-lg">
            <SearchBar loggedIn />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Bookings */}
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
                onClick={() => navigate('/requests')}
                aria-current={location.pathname.startsWith('/requests') ? 'page' : undefined}
                className={cn(location.pathname.startsWith('/requests') && '!font-semibold')}
                title={t('header.bookings')}
                leftSection={<Handshake size={20} aria-hidden="true" />}
              >
                <span className="hidden sm:inline">{t('requests.title')}</span>
              </Button>
            </Indicator>

            {/* Add Item */}
            <Button
              variant="filled"
              size="sm"
              leftSection={<Plus size={16} aria-hidden="true" />}
              onClick={() => navigate('/create-item')}
              aria-current={location.pathname.startsWith('/create-item') ? 'page' : undefined}
            >
              <span className="hidden sm:inline">{t('header.shareItem')}</span>
            </Button>

            {/* Profile Dropdown */}
            <Menu position="bottom-end" shadow="md" width={224}>
              <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label={t('header.myProfile')}>
                  <Avatar size={20} radius="xl" color="green">
                    {user.email?.charAt(0).toUpperCase()}
                  </Avatar>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  component={NavLink}
                  to="/my-items"
                  leftSection={<Library size={16} aria-hidden="true" />}
                >
                  {t('header.items')}
                </Menu.Item>
                <Menu.Item
                  component={NavLink}
                  to="/bookings"
                  leftSection={<CalendarCheck size={16} aria-hidden="true" />}
                >
                  {t('header.bookings')}
                </Menu.Item>
                <Menu.Item
                  component={NavLink}
                  to="/collections"
                  leftSection={<BookMarked size={16} aria-hidden="true" />}
                >
                  {t('collections.title')}
                </Menu.Item>
                <Menu.Item
                  component={NavLink}
                  to="/profile"
                  leftSection={<User size={16} aria-hidden="true" />}
                >
                  {t('header.myProfile')}
                </Menu.Item>
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
