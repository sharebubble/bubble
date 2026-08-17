import { isStandalone } from '@/lib/serviceWorker';
import { useCallback, useEffect, useState } from 'react';

/** The non-standard event Chromium fires when the app qualifies for install. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Exposes the browser's "add to home screen" flow as an in-app action.
 *
 * Chromium hands the prompt over exactly once, via a `beforeinstallprompt` event
 * that must be captured and cancelled at load time to be usable later. Safari
 * fires nothing at all and only offers install through its own share sheet, so
 * `canInstall` stays false there and callers simply render nothing.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Without preventDefault the event is spent and cannot be replayed.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // The event is single-use whatever the user chose.
    setPromptEvent(null);
    return outcome === 'accepted';
  }, [promptEvent]);

  return { canInstall: promptEvent !== null && !installed, installed, promptInstall };
}
