import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadMessages } from '@/hooks/useMessages';
import * as Sentry from '@sentry/react';

import { cn } from '@/lib/utils';
import { BookMarked, Handshake, Library, LogIn, LogOut, Plus, Search, User } from 'lucide-react';
import { SubmitEvent, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

export const Header = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: unreadMessages } = useUnreadMessages();

  const { t } = useLanguage();

  const unreadCount = unreadMessages?.count || 0;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const searchTerm = searchParams.get('search') || '';
  const [inputValue, setInputValue] = useState(searchTerm);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (term: string) => {
    setInputValue(term);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (term.length > 0) {
        next.set('search', term);
      } else {
        next.delete('search');
      }
      setSearchParams(next, { replace: true });
    }, 300);
  };

  // Keep input in sync if the URL param changes externally (e.g. browser back/forward)
  useEffect(() => {
    setInputValue(searchTerm);
  }, [searchTerm]);

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setSearchParams(searchParams, { replace: false });
  };

  if (!user) {
    return (
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
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
            <form className="flex-1 max-w-lg" onSubmit={handleSubmit}>
              <div className={cn('relative transition-all duration-300 focus-within:scale-105')}>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('header.search')}
                  className="pl-10 shadow-soft focus:shadow-medium transition-shadow"
                  value={inputValue}
                  onChange={e => handleSearchChange(e.target.value)}
                />
              </div>
            </form>

            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => navigate('/profile')}
            >
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">{t('header.signIn')}</span>
            </Button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
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
          <form className="flex-1 max-w-lg" onSubmit={handleSubmit}>
            <div className={cn('relative transition-all duration-300 focus-within:scale-105')}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('header.search')}
                className="pl-10 shadow-soft focus:shadow-medium transition-shadow"
                value={inputValue}
                onChange={e => handleSearchChange(e.target.value)}
              />
            </div>
          </form>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Bookings */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/bookings')}
              aria-current={location.pathname.startsWith('/bookings') ? 'page' : undefined}
              className={cn(
                'relative gap-2',
                location.pathname.startsWith('/bookings') && 'font-semibold',
              )}
              title={t('header.bookings')}
            >
              <Handshake className="h-5 w-5" />
              <span className="hidden sm:inline">{t('bookings.title')}</span>

              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 text-xs"
                >
                  {unreadCount}
                </Badge>
              )}
            </Button>

            {/* My Items */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/my-items')}
              aria-current={location.pathname.startsWith('/my-items') ? 'page' : undefined}
              className={cn('gap-2', location.pathname.startsWith('/my-items') && 'font-semibold')}
              title={t('header.items')}
            >
              <Library className="h-5 w-5" />
              <span className="hidden sm:inline">{t('myItems.title')}</span>
            </Button>

            {/* Add Item */}
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={() => navigate('/create-item')}
              aria-current={location.pathname.startsWith('/create-item') ? 'page' : undefined}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('header.shareItem')}</span>
            </Button>

            {/* Profile Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="relative">
                  <Avatar className="w-5 h-5">
                    <AvatarFallback className="text-xs">
                      {user.email?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 bg-background border border-border z-50"
              >
                <DropdownMenuItem asChild className="flex items-center">
                  <NavLink to="/collections">
                    <BookMarked className="w-4 h-4 mr-2" />
                    {t('collections.header.myCollections')}
                  </NavLink>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="flex items-center">
                  <NavLink to="/profile">
                    <User className="w-4 h-4 mr-2" />
                    {t('header.myProfile')}
                  </NavLink>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="flex items-center text-destructive focus:text-destructive"
                  onClick={handleSignOut}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  {t('header.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
};
