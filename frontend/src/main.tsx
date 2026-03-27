import * as Sentry from '@sentry/react';

import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    _env_?: {
      VITE_API_URL?: string;
      VITE_SENTRY_DSN?: string;
    };
  }
}

const dsn = window._env_?.VITE_SENTRY_DSN || import.meta.env.VITE_SENTRY_DSN;

console.log(`Initializing Sentry with DSN: ${dsn || 'not set'}`);
if (dsn) {
  // get sentryId from dsn, which is the part after the last '/'
  const sentryId = dsn.split('/').pop();

  Sentry.init({
    dsn: dsn,
    // Adds request headers and IP for users, for more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
    tracesSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: 'system',
        autoInject: true,
      }),
    ],
    tunnel: `/sentry-tunnel/${sentryId}/`, // Proxy endpoint to hide the DSN from the client
  });
}

const container = document.getElementById('root')!;
createRoot(container, {
  // Callback called when an error is thrown and not caught by an ErrorBoundary.
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn('Uncaught error', error, errorInfo.componentStack);
  }),
  // Callback called when React catches an error in an ErrorBoundary.
  onCaughtError: Sentry.reactErrorHandler(),
  // Callback called when React automatically recovers from errors.
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(<App />);
