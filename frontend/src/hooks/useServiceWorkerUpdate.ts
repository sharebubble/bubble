import { onServiceWorkerUpdate } from '@/lib/serviceWorker';
import { useEffect, useState } from 'react';

/**
 * True once a new build has installed and is waiting to take over the page.
 *
 * Bubble is a single-page app whose entry HTML points at content-hashed bundles,
 * so a tab left open across a deploy keeps running code the server no longer
 * serves. Surfacing the waiting worker lets the user opt into the swap instead of
 * hitting a chunk-load error on their next navigation.
 */
export function useServiceWorkerUpdate(): boolean {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => onServiceWorkerUpdate(waiting => setUpdateReady(waiting !== null)), []);

  return updateReady;
}
