import { Button } from '@/components/ui/button';
import { getCSRFToken } from '@/lib/utils';
import { client } from '@/services/django/client.gen';
import { useState } from 'react';

interface LoginWithSocialButtonProps {
  name: string;
  id: string;
}

export default function LoginWithSocialButton({ name, id }: LoginWithSocialButtonProps) {
  const [loading, setLoading] = useState(false);

  function handleClick() {
    if (loading) return;
    setLoading(true);

    const form = document.createElement('form');
    form.style.display = 'none';
    form.method = 'POST';
    form.action = `${client.getConfig().baseUrl}/api/_allauth/browser/v1/auth/provider/redirect`;
    const data = {
      provider: id,
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
    // Submit will usually navigate away; disable protects against double-clicks
    form.submit();
  }

  return (
    <Button onClick={handleClick} disabled={loading} aria-busy={loading}>
      {loading ? `Signing in with ${name}...` : `Login with ${name}`}
    </Button>
  );
}
