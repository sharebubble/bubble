import type { ReactNode } from 'react';
import { notifications } from '@mantine/notifications';

/**
 * Compatibility adapter over @mantine/notifications, keeping the call
 * signature of the old shadcn use-toast hook. Prefer calling
 * `notifications.show()` directly in new/migrated code.
 */

type ToastInput = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: 'default' | 'destructive';
};

function toast({ title, description, variant }: ToastInput) {
  notifications.show({
    title,
    message: description ?? '',
    color: variant === 'destructive' ? 'red' : undefined,
  });
}

function useToast() {
  return { toast };
}

export { useToast, toast };
