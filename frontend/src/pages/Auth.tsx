import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LoginWithSocialButton from '@/components/ui/login-with-social-button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { authAPI, LoginCredentials } from '@/services/custom/auth';
import { client } from '@/services/django/client.gen';
import { Eye, EyeOff, Loader } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { refreshAuth } = useAuth();

  const [authConfig, setAuthConfig] = useState<any | null>(null);
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
    <div className="min-h-screen bg-linear-to-br from-background to-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg border-0 bg-card/50 backdrop-blur-xs">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold bg-linear-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              {t('auth.welcomeTitle')}
            </CardTitle>
            <p className="text-muted-foreground mt-2">{t('auth.signInSubtitle')}</p>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Social Login Button */}
            <div className="text-center">
              {loadingConfig ? (
                <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
              ) : (
                // render one button per provider if available
                (authConfig?.data?.socialaccount?.providers ?? []).map((p: any) => (
                  <div key={p.id} className="mb-2">
                    <LoginWithSocialButton name={p.name} id={p.id} />
                  </div>
                ))
              )}
            </div>

            {/* Divider */}
            <div className="border-t" />

            <form onSubmit={handleLogin} className="space-y-4">
              {/* CSRF Token */}
              <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* show username/password login only when backend indicates methods are available */}
              {!loadingConfig && (authConfig?.data?.account?.login_methods ?? []).length > 0 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="username">{t('auth.usernameOrEmail')}</Label>
                    <Input
                      id="username"
                      name="username"
                      type="text"
                      value={loginData.username}
                      onChange={e => setLoginData({ ...loginData, username: e.target.value })}
                      placeholder={t('auth.enterUsernameOrEmail')}
                      required
                      disabled={isLoading}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">{t('auth.password')}</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={loginData.password}
                        onChange={e => setLoginData({ ...loginData, password: e.target.value })}
                        placeholder={t('auth.enterPassword')}
                        required
                        disabled={isLoading}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        disabled={isLoading}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || !loginData.username || !loginData.password}
                  >
                    {isLoading ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        {t('auth.signingIn')}
                      </>
                    ) : (
                      t('auth.signIn')
                    )}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
