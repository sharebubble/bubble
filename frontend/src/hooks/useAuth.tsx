import * as Sentry from '@sentry/react';
import { revokePushOnSignOut } from '@/lib/push';
import { clearCachedMedia } from '@/lib/serviceWorker';
import { clearSsoAttempt, suppressAutoSso } from '@/lib/sso';
import { authAPI, AuthFlow, Session, SessionResponse, User } from '@/services/custom/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react';

interface AuthContextType {
  user?: User;
  session: Session | null;
  loading: boolean;
  /**
   * The session could not be determined — the backend did not answer, or
   * answered with an error. Distinct from `session === null`, which is a
   * definite "not signed in": callers that act on being signed out (the login
   * screen forwards to the SSO provider) must not act on a failed request.
   */
  sessionError: boolean;
  /** Steps allauth is waiting on, e.g. a social signup that needs a form. */
  pendingFlows: AuthFlow[];
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  sessionError: false,
  pendingFlows: [],
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

  const {
    data: sessionData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const responseData: SessionResponse | undefined = await authAPI.getSession();
      if (responseData?.meta.is_authenticated) {
        const { user } = responseData.data;
        Sentry.setUser({ id: user.id, username: user.username, email: user.email });
        // The round trip through the provider worked; let the next sign-out
        // forward straight away instead of hitting the loop guard.
        clearSsoAttempt();
        return responseData.data;
      }
      Sentry.setUser(null);
      // Not signed in, but allauth may be waiting on a step (a pending social
      // signup, an email verification). Keep those: the login screen must not
      // forward to the provider again over a login that is already half done.
      return { flows: responseData?.data?.flows ?? [] } as Partial<Session> & {
        flows: AuthFlow[];
      };
    },
    // A blip on the way to the session endpoint used to read as "signed out",
    // which on an SSO-only deployment immediately forwards the browser to the
    // provider. Retrying twice makes a transient failure heal itself instead.
    retry: 2,
  });

  const authenticated = Boolean(sessionData && 'user' in sessionData && sessionData.user);
  const session = authenticated ? (sessionData as Session) : null;

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
    // The identity provider keeps its own session, so an automatic forward would
    // sign the user right back in and make "Sign out" look broken.
    suppressAutoSso();
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const refreshAuth = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ['session'] });
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user: session?.user,
      session,
      loading: isLoading,
      sessionError: isError,
      pendingFlows: authenticated ? [] : ((sessionData as { flows?: AuthFlow[] })?.flows ?? []),
      signOut,
      refreshAuth,
    }),
    [session, sessionData, authenticated, isLoading, isError, signOut, refreshAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
