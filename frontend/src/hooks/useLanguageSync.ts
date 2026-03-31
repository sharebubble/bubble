import { useLanguage, type Language } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { profilesMePartialUpdate, profilesMeRetrieve } from '@/services/django';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

const LANGUAGES = ['en', 'de'] as const;

/**
 * Syncs the UI language with the user's profile.
 *
 * - On login: loads the profile and applies the saved language (if set).
 * - On language change: patches the profile to persist the new choice.
 *
 * Must be called inside both <AuthProvider> and <LanguageProvider>.
 */
export const useLanguageSync = () => {
  const { user } = useAuth();
  const { language, setLanguage, syncLanguage } = useLanguage();
  const initialSyncDone = useRef(false);
  const pendingSave = useRef(false);

  const { data: profile } = useQuery({
    queryKey: ['profile', user?.username],
    queryFn: async () => {
      const response = await profilesMeRetrieve();
      return response.data;
    },
    enabled: !!user,
  });

  // Apply the profile language once after first successful load.
  useEffect(() => {
    if (!profile || initialSyncDone.current) return;
    const profileLang = profile.language;
    if (profileLang && LANGUAGES.includes(profileLang as Language)) {
      initialSyncDone.current = true;
      // Use syncLanguage so we don't trigger a save-back loop.
      syncLanguage(profileLang as Language);
    } else {
      // Profile has no language set yet — mark done and let the current
      // localStorage/browser value be saved to the profile.
      initialSyncDone.current = true;
      pendingSave.current = true;
    }
  }, [profile, syncLanguage]);

  // Save the language to the profile whenever it changes, but only after
  // the initial sync has been applied (to avoid overwriting a profile value
  // with a stale localStorage value on first load).
  useEffect(() => {
    if (!user || !initialSyncDone.current) return;

    profilesMePartialUpdate({ body: { language } }).catch(err => {
      console.error('Failed to save language preference to profile:', err);
    });
  }, [language, user]);

  // Reset on logout so the next login triggers a fresh sync.
  useEffect(() => {
    if (!user) {
      initialSyncDone.current = false;
      pendingSave.current = false;
    }
  }, [user]);
};
