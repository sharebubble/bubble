import { Button } from '@mantine/core';
import { useState } from 'react';

interface LoginWithSocialButtonProps {
  name: string;
  /** Starts the redirect. Resolves only if the navigation did not happen. */
  onLogin: () => Promise<void>;
  /** Overrides the default caption, e.g. to offer a retry after a failure. */
  label?: string;
}

export default function LoginWithSocialButton({
  name,
  onLogin,
  label,
}: LoginWithSocialButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      await onLogin();
    } finally {
      // Reached only when the redirect never left the page (it throws before
      // navigating). Otherwise the page is gone and this never runs.
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={loading} aria-busy={loading}>
      {loading ? `Signing in with ${name}...` : (label ?? `Login with ${name}`)}
    </Button>
  );
}
