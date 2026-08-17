import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

const getSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;

/**
 * Whether the viewport is below the `md` breakpoint — the same 768px cutoff the
 * Tailwind `md:` utilities use, so JS-side branching and CSS-side visibility
 * stay in sync.
 *
 * Backed by `useSyncExternalStore` so the value is correct on the very first
 * render. Callers that branch on it (the "/" route dispatcher) would otherwise
 * act on a false negative before an effect could correct it, and a redirect
 * issued that early is not recoverable.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
