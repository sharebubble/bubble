import { copyToClipboard } from '@/lib/clipboard';
import { useMediaQuery } from '@mantine/hooks';
import { useCallback } from 'react';

/** Mirrors the app's mobile breakpoint (see `useIsMobile`). */
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export interface ShareLinkData {
  url: string;
  title?: string;
  text?: string;
}

/**
 * - `shared`: the native share sheet handled the link
 * - `dismissed`: the user closed the native share sheet without sharing
 * - `copied`: the link was copied to the clipboard
 * - `error`: the link could neither be shared nor copied
 */
export type ShareOutcome = 'shared' | 'dismissed' | 'copied' | 'error';

/**
 * Sharing of a link with the platform-appropriate behaviour: on mobile the
 * native share sheet is opened, on desktop (or whenever the Web Share API is
 * unavailable) the link is copied to the clipboard instead.
 */
export function useShare() {
  // Evaluated during the first render (not in an effect), so the very first
  // click already takes the native-share path on mobile.
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY, false, { getInitialValueInEffect: false });
  const canShareNatively = isMobile && typeof navigator !== 'undefined' && !!navigator.share;

  const share = useCallback(
    async (data: ShareLinkData): Promise<ShareOutcome> => {
      if (canShareNatively) {
        try {
          await navigator.share(data);
          return 'shared';
        } catch (error) {
          // The user closing the share sheet is not a failure.
          if (error instanceof DOMException && error.name === 'AbortError') {
            return 'dismissed';
          }
          // Anything else (e.g. no share target) falls back to copying.
        }
      }

      return (await copyToClipboard(data.url)) ? 'copied' : 'error';
    },
    [canShareNatively],
  );

  return { share, canShareNatively };
}
