import * as Sentry from '@sentry/react';
import { authAPI, Session, SessionResponse, User } from '@/services/custom/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext } from 'react';

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
    },
    onError: (err: unknown) => {
      // Clear data even on error (e.g., 401 means already logged out)
      queryClient.clear();

      const isUnauthorized =
        err instanceof Error &&
        (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized'));

      if (!isUnauthorized) {
        console.error('Logout failed:', err);
      }
    },
  });

  const signOut = async () => {
    await logoutMutation.mutateAsync();
  };

  const refreshAuth = () => {
    return queryClient.invalidateQueries({ queryKey: ['session'] });
  };

  const value = {
    user: sessionData?.user,
    session: sessionData ?? null,
    loading: isLoading,
    signOut,
    refreshAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
