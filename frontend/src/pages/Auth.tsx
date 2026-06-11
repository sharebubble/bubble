import LoginWithSocialButton from '@/components/ui/login-with-social-button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { authAPI, LoginCredentials } from '@/services/custom/auth';
import { client } from '@/services/django/client.gen';
import { Alert, Button, Card, Divider, PasswordInput, Text, TextInput, Title } from '@mantine/core';
import { Eye, EyeOff, Loader } from 'lucide-react';
import { useEffect, useState } from 'react';
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

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { refreshAuth } = useAuth();

  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [loginData, setLoginData] = useState<LoginCredentials>({
    username: '',
    password: '',
  });

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
            {/* Social Login Button */}
            <div className="text-center">
              {loadingConfig ? (
                <Text size="sm" c="dimmed">
                  {t('common.loading')}
                </Text>
              ) : (
                // render one button per provider if available
                (authConfig?.data?.socialaccount?.providers ?? []).map(p => (
                  <div key={p.id} className="mb-2">
                    <LoginWithSocialButton name={p.name} id={p.id} />
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
              {!loadingConfig && (authConfig?.data?.account?.login_methods ?? []).length > 0 && (
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
