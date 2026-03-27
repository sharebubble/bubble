import { client } from '@/services/django/client.gen';

import { getCookie } from '@/lib/utils';

// Configure the API client
export const configureApiClient = () => {
  client.setConfig({
    baseUrl: import.meta.env.VITE_API_URL || window._env_?.VITE_API_URL || '',
    credentials: 'include',
  });

  if (import.meta.env.DEV) {
    console.log('API Client configured with baseUrl:', client.getConfig().baseUrl);
  }

  // Try to add CSRF token interceptor if available
  if (client.interceptors && client.interceptors.request) {
    client.interceptors.request.use(request => {
      const csrfToken = getCookie('csrftoken');
      if (csrfToken) {
        request.headers.set('X-CSRFToken', csrfToken);
      }
      // Always send current language
      const lang = localStorage.getItem('bubble-language') || 'en';
      request.headers.set('Accept-Language', lang);
      return request;
    });
  }

  // Silently ignore 401 responses — unauthenticated state is handled by the UI
  if (client.interceptors && client.interceptors.error) {
    client.interceptors.error.use(error => {
      if (error && (error as { status?: number }).status === 401) {
        console.debug('[API] 401 Unauthorized – ignoring silently');
        return error;
      }
      return Promise.reject(error);
    });
  }
};
