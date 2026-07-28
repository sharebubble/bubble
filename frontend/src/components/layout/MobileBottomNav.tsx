import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadMessages } from '@/hooks/useMessages';
import { ACCOUNT_PATH, BROWSE_PATH } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { Indicator } from '@mantine/core';
import { Handshake, Home, Plus, Search, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

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
      key: 'nav.requests',
      icon: Handshake,
      to: '/requests',
      isActive: pathname => pathname.startsWith('/requests'),
      badge: unreadCount,
    },
    {
      key: 'nav.profile',
      icon: User,
      to: ACCOUNT_PATH,
      isActive: pathname => pathname.startsWith(ACCOUNT_PATH) || pathname.startsWith('/profile'),
    },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label={t('nav.primary')}
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around">
        {items.map(item => {
          const active = item.isActive(location.pathname);
          const Icon = item.icon;
          const isAdd = item.key === 'nav.add';
          return (
            <button
              key={item.key}
              type="button"
              // Re-tapping the active tab scrolls to top rather than pushing a
              // duplicate history entry.
              onClick={() =>
                active ? window.scrollTo({ top: 0, behavior: 'smooth' }) : navigate(item.to)
              }
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
                active
                  ? 'text-[var(--mantine-color-green-6)]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {isAdd ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mantine-color-green-6)] text-white">
                  <Icon size={20} aria-hidden="true" />
                </span>
              ) : item.badge ? (
                <Indicator label={item.badge} color="red" size={14} offset={2}>
                  <Icon size={22} aria-hidden="true" />
                </Indicator>
              ) : (
                <Icon size={22} aria-hidden="true" />
              )}
              <span className={cn(isAdd && 'mt-0.5')}>{t(item.key)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
