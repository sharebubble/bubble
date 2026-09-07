import LoginWithSocialButton from '@/components/auth/LoginWithSocialButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useAppConfig } from '@/hooks/useAppConfig';
import { authAPI, LoginCredentials } from '@/services/custom/auth';
import { getSsoReturn, getSsoSuppression, redirectToSocialProvider } from '@/lib/sso';
import { client } from '@/services/django/client.gen';
import { Alert, Button, Card, Divider, PasswordInput, Text, TextInput, Title } from '@mantine/core';
import { Eye, EyeOff, Loader } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface AuthConfig {
  data?: {
    socialaccount?: {
      providers?: { id: string; name: string }[];
    };
    account?: {
      login_methods?: string[];
    };
  };
}

/**
 * Reasons not to forward to the provider on our own. All but `signout` are
 * failures that used to end in the same silent bounce between app and provider,
 * and are reported to the user; `signout` is the user's own choice.
 */
type BlockedReason = 'signout' | 'error' | 'pending' | 'unreachable' | 'returned';

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { refreshAuth, sessionError, pendingFlows } = useAuth();
  const { requireLogin } = useAppConfig();

  // Guards the automatic forward against firing twice within one mount. The
  // cross-page guards live in lib/sso: this screen is remounted by the round
  // trip itself, so a ref alone can never see the previous attempt.
  const autoForwardedRef = useRef(false);

  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Read once: the markers are stripped from the URL as the module loads.
  const ssoReturn = getSsoReturn();
  const [ssoError, setSsoError] = useState<string | null>(ssoReturn.error);

  // Read once at mount: the marker describes *earlier* page loads. Re-reading it
  // per render would flip the screen back to the button the moment this screen
  // records its own forward, while the browser is already navigating away.
  const [suppression] = useState(getSsoSuppression);

  /**
   * Why the automatic forward is held back, or null when it may go ahead.
   *
   * The forward is a full page navigation, so a failed round trip comes back to
   * a freshly mounted screen with no memory of having tried. Without these
   * checks it forwards again immediately, and keeps doing so — the provider
   * signs the user straight back in, allauth fails or parks the login the same
   * way as before, and the browser bounces until the user gives up.
   */
  const blockedReason: BlockedReason | null =
    suppression === 'signout'
      ? 'signout'
      : ssoError
        ? 'error'
        : pendingFlows.some(flow => flow.is_pending)
          ? 'pending'
          : sessionError
            ? 'unreachable'
            : ssoReturn.returned || suppression === 'attempt'
              ? 'returned'
              : null;

  const [loginData, setLoginData] = useState<LoginCredentials>({
    username: '',
    password: '',
  });
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null);

  // Fetch CSRF token on component mount
  useEffect(() => {
    const initializeCSRF = async () => {
      try {
        const token = await authAPI.fetchCSRFToken();
        if (token) {
          setCsrfToken(token);
        }
      } catch (error) {
        console.error('Failed to fetch CSRF token:', error);
      }
    };

    initializeCSRF();
  }, []);

  const startSocialLogin = useCallback(async (provider: { id: string; name: string }) => {
    setRedirectingTo(provider.name);
    try {
      await redirectToSocialProvider(provider.id);
    } catch (err) {
      // Usually a missing CSRF token, i.e. the backend never answered. Posting
      // the form anyway would land the user on a bare 403 page.
      console.error('Failed to start social login:', err);
      setRedirectingTo(null);
      setSsoError('redirect_failed');
      // Rethrown so the button drops out of its busy state; the alert above
      // carries the explanation.
      throw err;
    }
  }, []);

  // When anonymous access is disabled and exactly one social provider is
  // configured with no username/password login, skip the login screen and
  // forward straight to the provider. Otherwise users would only ever see a
  // single "Login with X" button that does the same thing.
  const providers = authConfig?.data?.socialaccount?.providers ?? [];
  const loginMethods = authConfig?.data?.account?.login_methods ?? [];
  const singleProvider = providers.length === 1 && loginMethods.length === 0 ? providers[0] : null;
  const autoForwardTo =
    requireLogin && !loadingConfig && !blockedReason && singleProvider ? singleProvider : null;

  useEffect(() => {
    if (!autoForwardTo || autoForwardedRef.current) return;
    autoForwardedRef.current = true;
    redirectToSocialProvider(autoForwardTo.id).catch(err => {
      console.error('Failed to start social login:', err);
      autoForwardedRef.current = false;
      setSsoError('redirect_failed');
    });
  }, [autoForwardTo]);

  // A forward under way means the page is on its way out; anything else this
  // screen could render would only flash by.
  const forwardingTo = redirectingTo ?? autoForwardTo?.name ?? null;

  // Fetch auth config to determine which login methods and social providers are available
  useEffect(() => {
    const fetchConfig = async () => {
      setLoadingConfig(true);
      try {
        const res = await fetch(`${client.getConfig().baseUrl}/api/_allauth/app/v1/config`);
        if (!res.ok) {
          throw new Error(`Config fetch failed: ${res.status}`);
        }
        const json = await res.json();
        setAuthConfig(json);
      } catch (err) {
        console.error('Failed to fetch auth config:', err);
        setAuthConfig(null);
      } finally {
        setLoadingConfig(false);
      }
    };

    fetchConfig();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await authAPI.login(loginData);

      if (response.status === 200 && response.meta.is_authenticated && response.data.user) {
        // Refresh the auth state to update user context
        await refreshAuth();

        toast({
          title: t('auth.welcomeBackTitle'),
          description: `${t('auth.loggedInAs')} ${response.data.user.username}`,
        });

        // Use navigate for proper SPA routing instead of hard redirect
        navigate('/');
      } else {
        setError(t('auth.loginFailed'));
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : t('auth.unexpectedError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card withBorder padding="lg" shadow="md">
          <div className="text-center">
            <Title order={2}>
              <Text
                component="span"
                inherit
                variant="gradient"
                gradient={{ from: 'green.6', to: 'green.4' }}
              >
                {t('auth.welcomeTitle')}
              </Text>
            </Title>
            <Text c="dimmed" className="mt-2">
              {t('auth.signInSubtitle')}
            </Text>
          </div>

          <div className="space-y-6 mt-6">
            {/* Why the automatic forward was held back, so the user is not left
                staring at a screen that silently bounced them around. */}
            {blockedReason && blockedReason !== 'signout' && singleProvider && (
              <Alert color="yellow" variant="light" title={t('auth.ssoBlockedTitle')}>
                <Text size="sm">{t(`auth.ssoBlocked.${blockedReason}`)}</Text>
                {ssoError && (
                  <Text size="xs" c="dimmed" className="mt-1">
                    {t('auth.ssoErrorCode', { code: ssoError })}
                  </Text>
                )}
              </Alert>
            )}

            {/* Social Login Button */}
            <div className="text-center">
              {forwardingTo ? (
                <Text size="sm" c="dimmed">
                  {t('auth.redirectingToProvider', { provider: forwardingTo })}
                </Text>
              ) : loadingConfig ? (
                <Text size="sm" c="dimmed">
                  {t('common.loading')}
                </Text>
              ) : (
                // render one button per provider if available
                providers.map(p => (
                  <div key={p.id} className="mb-2">
                    <LoginWithSocialButton
                      name={p.name}
                      label={
                        blockedReason && blockedReason !== 'signout'
                          ? t('auth.retrySignIn', { provider: p.name })
                          : undefined
                      }
                      onLogin={() => startSocialLogin(p)}
                    />
                  </div>
                ))
              )}
            </div>

            <Divider />

            <form onSubmit={handleLogin} className="space-y-4">
              {/* CSRF Token */}
              <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />

              {error && (
                <Alert color="red" variant="light">
                  {error}
                </Alert>
              )}

              {/* show username/password login only when backend indicates methods are available */}
              {!loadingConfig && loginMethods.length > 0 && (
                <>
                  <TextInput
                    label={t('auth.usernameOrEmail')}
                    name="username"
                    type="text"
                    value={loginData.username}
                    onChange={e => setLoginData({ ...loginData, username: e.target.value })}
                    placeholder={t('auth.enterUsernameOrEmail')}
                    required
                    disabled={isLoading}
                  />

                  <PasswordInput
                    label={t('auth.password')}
                    name="password"
                    value={loginData.password}
                    onChange={e => setLoginData({ ...loginData, password: e.target.value })}
                    placeholder={t('auth.enterPassword')}
                    required
                    disabled={isLoading}
                    visible={showPassword}
                    onVisibilityChange={setShowPassword}
                    visibilityToggleIcon={({ reveal }) =>
                      reveal ? <EyeOff size={16} /> : <Eye size={16} />
                    }
                  />

                  <Button
                    type="submit"
                    fullWidth
                    disabled={isLoading || !loginData.username || !loginData.password}
                    leftSection={
                      isLoading ? <Loader size={16} className="animate-spin" /> : undefined
                    }
                  >
                    {isLoading ? t('auth.signingIn') : t('auth.signIn')}
                  </Button>
                </>
              )}
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
