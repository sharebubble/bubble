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
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

// Icon-only below `lg`, icon+label from `lg` up: at `md` the header first
// has room to show these destinations at all, but not enough for
// icon-and-label buttons across five items plus the logo, search bar and
// avatar — that combination used to force the header itself to scroll
// horizontally. Compact icon buttons keep every item narrow until `lg`,
// where there's space for the full row.
//
// Each item renders two real Mantine buttons rather than one button whose
// internal layout gets hacked per breakpoint, so both states keep Mantine's
// own filled/subtle/light styling (padding, radius, hover, focus ring)
// instead of a hand-rolled approximation. `visibleFrom`/`hiddenFrom` pick
// between them: plain Tailwind `hidden`/`lg:flex` can't do this on a real
// Button/ActionIcon root, because Mantine's component CSS is unlayered and
// its own `display` declaration beats Tailwind's layered utility regardless
// of breakpoint (same gotcha called out on MobileBottomNav's `hiddenFrom`
// below).
type HeaderNavButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: number;
};

const HeaderNavButton = ({ icon: Icon, label, onClick, active, badge }: HeaderNavButtonProps) => {
  const icon = <Icon size={20} aria-hidden="true" />;
  const color = active ? 'green' : 'gray';
  const variant = active ? 'light' : 'subtle';

  const hasBadge = badge !== undefined && badge > 0;

  return (
    <>
      {/* `disabled` (rather than conditionally rendering Indicator) keeps the
          wrapper itself present so `hiddenFrom`/`visibleFrom` — which must
          sit on this outer element, not the button inside it, or the badge
          stays visible after the button it's pinned to is hidden — always
          has something to toggle. */}
      <Indicator
        label={badge}
        color="red"
        size={16}
        offset={3}
        disabled={!hasBadge}
        hiddenFrom="lg"
      >
        <ActionIcon
          variant={variant}
          color={color}
          size="lg"
          onClick={onClick}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          title={label}
        >
          {icon}
        </ActionIcon>
      </Indicator>
      <Indicator
        label={badge}
        color="red"
        size={16}
        offset={4}
        disabled={!hasBadge}
        visibleFrom="lg"
      >
        <Button
          variant={variant}
          color={color}
          size="sm"
          leftSection={icon}
          onClick={onClick}
          aria-current={active ? 'page' : undefined}
        >
          {label}
        </Button>
      </Indicator>
    </>
  );
};

// The primary CTA gets the same compact/row treatment, always in filled
// green, with a fully round icon button at the compact size — the same "+"
// affordance MobileBottomNav already uses for this exact action.
type HeaderShareButtonProps = {
  label: string;
  onClick: () => void;
  active?: boolean;
};

const HeaderShareButton = ({ label, onClick, active }: HeaderShareButtonProps) => (
  <>
    <ActionIcon
      variant="filled"
      color="green"
      radius="xl"
      size="lg"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
      hiddenFrom="lg"
    >
      <Plus size={20} aria-hidden="true" />
    </ActionIcon>
    <Button
      variant="filled"
      size="sm"
      leftSection={<Plus size={16} aria-hidden="true" />}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      visibleFrom="lg"
    >
      {label}
    </Button>
  </>
);

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
            <HeaderShareButton
              label={t('header.shareItem')}
              onClick={() => navigate('/create-item')}
              active={location.pathname.startsWith('/create-item')}
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
