export interface SocialProvider {
  id: string;
  name: string;
  enabled: boolean;
  icon: string;
}

// Configure social providers here
export const SOCIAL_PROVIDERS: SocialProvider[] = [
  {
    id: 'google',
    name: 'Google',
    enabled: false, // Set to false to disable
    icon: '🌟',
  },
  {
    id: 'github',
    name: 'GitHub',
    enabled: false, // Set to false to disable
    icon: '🐙',
  },
  {
    id: 'keycloak',
    name: 'Keycloak',
    enabled: true,
    icon: '🎮',
  },
];

export const getEnabledSocialProviders = (): SocialProvider[] => {
  return SOCIAL_PROVIDERS.filter(provider => provider.enabled);
};
