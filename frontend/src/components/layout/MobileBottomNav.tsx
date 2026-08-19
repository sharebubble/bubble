import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadMessages } from '@/hooks/useMessages';
import { ACCOUNT_PATH, BROWSE_PATH } from '@/lib/routes';
import { Indicator, Paper, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { CalendarCheck, Home, Plus, Search, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

// Mantine's `dimmed` only reaches ~3.2:1 against the light surface, short of
// WCAG AA for these 12px labels; gray-7 clears it while dark keeps the shade
// `dimmed` already resolves to.
const INACTIVE_COLOR = 'light-dark(var(--mantine-color-gray-7), var(--mantine-color-dark-2))';
// green-6 is too dark to read on the dark surface, so lighten it there.
const ACTIVE_COLOR = 'light-dark(var(--mantine-color-green-6), var(--mantine-color-green-4))';

interface NavItem {
  key: string;
  icon: LucideIcon;
  to: string;
  isActive: (pathname: string) => boolean;
  badge?: number;
}

export const MobileBottomNav = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: unreadMessages } = useUnreadMessages();

  // The bar's destinations are user-specific; hide it for anonymous visitors.
  if (!user) return null;

  const unreadCount = unreadMessages?.count || 0;

  const items: NavItem[] = [
    {
      key: 'nav.home',
      icon: Home,
      to: '/',
      isActive: pathname => pathname === '/',
    },
    {
      key: 'nav.search',
      icon: Search,
      to: BROWSE_PATH,
      isActive: pathname => pathname === BROWSE_PATH,
    },
    {
      key: 'nav.add',
      icon: Plus,
      to: '/create-item',
      isActive: pathname => pathname.startsWith('/create-item'),
    },
    {
      key: 'nav.bookings',
      icon: CalendarCheck,
      to: '/bookings',
      isActive: pathname => pathname.startsWith('/bookings'),
      badge: unreadCount,
    },
    {
      key: 'nav.profile',
      icon: User,
      to: ACCOUNT_PATH,
      // Only the hub itself counts as "active" — /profile and its sub-pages
      // (notifications, calendar) are destinations reached *from* the hub,
      // same as /my-items or /collections, so they stay clickable rather
      // than looking selected and swallowing the tap as a scroll-to-top.
      isActive: pathname => pathname.startsWith(ACCOUNT_PATH),
    },
  ];

  return (
    <Paper
      component="nav"
      radius={0}
      // Mantine's own responsive prop rather than a Tailwind `md:hidden`: the
      // Paper root class is unlayered and would otherwise win the cascade over
      // Tailwind's layered utility, leaving the bar visible on desktop. The
      // theme's `md` breakpoint is 768px, matching useIsMobile() and `md:`.
      hiddenFrom="md"
      // Tailwind here is positioning only; the surface, border and colours come
      // from the Mantine theme.
      className="fixed inset-x-0 bottom-0 z-50"
      style={{
        borderTop: '1px solid var(--mantine-color-default-border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-label={t('nav.primary')}
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around">
        {items.map(item => {
          const active = item.isActive(location.pathname);
          const Icon = item.icon;
          const isAdd = item.key === 'nav.add';
          const iconColor = active ? ACTIVE_COLOR : INACTIVE_COLOR;
          return (
            <UnstyledButton
              key={item.key}
              // Re-tapping the active tab scrolls to top rather than pushing a
              // duplicate history entry. The search tab is the exception: it
              // always (re-)focuses the search bar so tapping it starts typing
              // right away, whether or not the browse screen is already open.
              onClick={() => {
                if (item.key === 'nav.search') {
                  // Preserve any filters already in the URL when re-tapping
                  // from the browse screen itself, rather than dropping them.
                  navigate(
                    { pathname: item.to, search: active ? location.search : '' },
                    { state: { focusSearch: true }, replace: active },
                  );
                  return;
                }
                if (active) window.scrollTo({ top: 0, behavior: 'smooth' });
                else navigate(item.to);
              }}
              aria-current={active ? 'page' : undefined}
              className="flex flex-1 flex-col items-center justify-center gap-0.5"
            >
              {isAdd ? (
                <ThemeIcon radius="xl" size={32} color="green">
                  <Icon size={20} aria-hidden="true" />
                </ThemeIcon>
              ) : item.badge ? (
                <Indicator label={item.badge} color="red" size={14} offset={2}>
                  <Icon size={22} color={iconColor} aria-hidden="true" />
                </Indicator>
              ) : (
                <Icon size={22} color={iconColor} aria-hidden="true" />
              )}
              <Text size="xs" c={iconColor}>
                {t(item.key)}
              </Text>
            </UnstyledButton>
          );
        })}
      </div>
    </Paper>
  );
};
