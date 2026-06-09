// toast.tsx — type stubs for backward compatibility
// The actual notification logic now lives in hooks/use-toast.ts which
// delegates to @mantine/notifications.

export type ToastProps = {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'default' | 'destructive';
  duration?: number;
};

export type ToastActionElement = React.ReactElement;

import React from 'react';
