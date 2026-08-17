import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { client } from '@/services/django/client.gen';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getCookie(name: string): string | null {
  let cookieValue: string | null = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      // Does this cookie string begin with the name we want?
      if (cookie.substring(0, name.length + 1) === name + '=') {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}
export function getCSRFToken() {
  return getCookie('csrftoken');
}

// Submits a hidden form that triggers an allauth social provider login redirect.
export function redirectToSocialProvider(providerId: string) {
  const form = document.createElement('form');
  form.style.display = 'none';
  form.method = 'POST';
  form.action = `${client.getConfig().baseUrl}/api/_allauth/browser/v1/auth/provider/redirect`;
  const data = {
    provider: providerId,
    callback_url: `${window.location.origin}/`,
    csrfmiddlewaretoken: getCSRFToken() || '',
    process: 'login',
  };

  Object.entries(data).forEach(([k, v]) => {
    const input = document.createElement('input');
    input.name = k;
    input.value = v as string;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}
