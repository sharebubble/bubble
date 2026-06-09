import { notifications } from '@mantine/notifications';

// use-toast.ts — thin wrapper around @mantine/notifications
// Provides the same { toast, useToast } API that the codebase uses,
// delegating to Mantine's notification system.

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  duration?: number;
}

function toast({ title, description, variant, duration }: ToastOptions) {
  notifications.show({
    title,
    message: description,
    color: variant === 'destructive' ? 'red' : 'brand',
    autoClose: duration ?? 4000,
  });
}

function useToast() {
  return { toast };
}

export { toast, useToast };
