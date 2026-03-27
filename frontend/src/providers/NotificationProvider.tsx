import { useAuth } from '@/hooks/useAuth';
import { useWebSocket, WebSocketMessage } from '@/hooks/useWebSocket';
import { useQueryClient } from '@tanstack/react-query';
import { ReactNode, useCallback, useEffect } from 'react';
import { toast } from 'sonner';

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider = ({ children }: NotificationProviderProps) => {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      console.log('[Notification] Received:', message);

      switch (message.type) {
        case 'connection.established':
          // Connection confirmation from server
          if (import.meta.env.DEV) {
            console.log('[Notification] Connection established:', message.data);
          }
          break;

        case 'logout':
          toast.error('You have been logged out', {
            description: message.data?.message || 'Your session has ended.',
          });
          // Give user a moment to see the notification before signing out
          setTimeout(() => {
            signOut();
          }, 2000);
          break;

        case 'session_invalid':
          toast.error('Session Invalid', {
            description:
              message.data?.message || 'Your session has been invalidated. Please log in again.',
          });
          // Give user a moment to see the notification before signing out
          setTimeout(() => {
            signOut();
          }, 2000);
          break;

        case 'new_message':
          toast.info('New Message', {
            description: message.data?.message || 'You have a new message.',
          });
          // Invalidate bookings to update unread message counts
          queryClient.invalidateQueries({ queryKey: ['bookings'] });
          // Invalidate unread messages to update the header badge
          queryClient.invalidateQueries({ queryKey: ['unread-messages'] });
          // Invalidate the specific booking's messages if we have the booking UUID
          if (message.data?.booking) {
            queryClient.invalidateQueries({ queryKey: ['messages', message.data.booking] });
          }
          break;

        case 'notification':
          // Generic notification
          toast(message.data?.title || 'Notification', {
            description: message.data?.message,
          });
          break;

        default:
          console.warn('[Notification] Unknown message type:', message.type);
      }
    },
    [signOut, queryClient],
  );

  const handleConnect = useCallback(() => {
    console.log('[Notification] WebSocket connected');
  }, []);

  const handleDisconnect = useCallback(() => {
    console.log('[Notification] WebSocket disconnected');
  }, []);

  const handleError = useCallback((error: Event) => {
    console.error('[Notification] WebSocket error:', error);
  }, []);

  const { isConnected } = useWebSocket({
    onMessage: handleMessage,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onError: handleError,
    reconnectInterval: 5000,
    maxReconnectAttempts: 5,
  });

  // Optional: Show connection status in development
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Notification] Connection status:', isConnected);
    }
  }, [isConnected]);

  return <>{children}</>;
};
