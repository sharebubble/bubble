import { redirectToSocialProvider } from '@/lib/utils';
import { Button } from '@mantine/core';
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
    redirectToSocialProvider(id);
  }

  return (
    <Button onClick={handleClick} disabled={loading} aria-busy={loading}>
      {loading ? `Signing in with ${name}...` : `Login with ${name}`}
    </Button>
  );
}
