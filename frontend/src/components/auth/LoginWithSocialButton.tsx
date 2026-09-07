import { Button } from '@mantine/core';
import { useState } from 'react';

interface LoginWithSocialButtonProps {
  name: string;
  /**
   * Starts the redirect. Resolving means the request to leave was handed to the
   * browser, not that the page has gone — the navigation it triggers is still
   * in flight — so the button stays busy from there on. It rejects only when
   * the redirect could not be started at all.
   */
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
      // Deliberately still busy: the page is on its way out, and flipping the
      // caption back before it unloads would only flash.
    } catch {
      // The redirect never started, so the button has to be usable again. The
      // caller reports the reason.
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={loading} aria-busy={loading}>
      {loading ? `Signing in with ${name}...` : (label ?? `Login with ${name}`)}
    </Button>
  );
}
