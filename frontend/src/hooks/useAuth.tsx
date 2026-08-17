import * as Sentry from '@sentry/react';
import { revokePushOnSignOut } from '@/lib/push';
import { clearCachedMedia } from '@/lib/serviceWorker';
import { authAPI, Session, SessionResponse, User } from '@/services/custom/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react';

interface AuthContextType {
  user?: User;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  signOut: async () => {},
  refreshAuth: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  const { data: sessionData, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const responseData: SessionResponse = await authAPI.getSession();
      if (responseData.meta.is_authenticated) {
        const { user } = responseData.data;
        Sentry.setUser({ id: user.id, username: user.username, email: user.email });
        return responseData.data;
      }
      Sentry.setUser(null);
      return null;
    },
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await authAPI.logout();
    },
    onSuccess: () => {
      Sentry.setUser(null);
      // Clear all data from the cache.
      // This could be refined in the future to clear only user-specific data.
      queryClient.clear();
      // The React Query cache is in memory; item images cached by the service
      // worker outlive the session and have to be dropped explicitly.
      clearCachedMedia();
    },
    onError: (err: unknown) => {
      // Clear data even on error (e.g., 401 means already logged out)
      queryClient.clear();
      clearCachedMedia();

      const isUnauthorized =
        err instanceof Error &&
        (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized'));

      if (!isUnauthorized) {
        console.error('Logout failed:', err);
      }
    },
  });

  const signOut = useCallback(async () => {
    // Before the session goes away: the unsubscribe call is authenticated, and a
    // subscription left behind would keep delivering this account's notifications
    // to a browser the next person signs in on.
    await revokePushOnSignOut();
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const refreshAuth = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ['session'] });
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user: sessionData?.user,
      session: sessionData ?? null,
      loading: isLoading,
      signOut,
      refreshAuth,
    }),
    [sessionData, isLoading, signOut, refreshAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
