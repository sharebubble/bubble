import { useAuth } from '@/hooks/useAuth';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface WebSocketMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  title?: string;
  message?: string;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export const useWebSocket = (options: UseWebSocketOptions = {}) => {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectInterval = 5000,
    maxReconnectAttempts = 5,
  } = options;

  const { user } = useAuth();
  const isAuthenticated = !!user;
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(true);
  const isConnectingRef = useRef(false);
  const connectionIdRef = useRef(0); // Track connection attempts to prevent race conditions

  // Store callbacks in refs to avoid reconnection when they change
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
  }, [onMessage, onConnect, onDisconnect, onError]);

  const getWebSocketUrl = useCallback(() => {
    // Get API URL from environment variable or window._env_, fallback to http://localhost:8000
    const apiUrl =
      import.meta.env.VITE_API_URL || window._env_?.VITE_API_URL || window.location.origin;

    // Parse the API URL to extract host
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = url.host;

    return `${protocol}//${host}/api/ws/notifications/`;
  }, []);

  const connect = useCallback(() => {
    if (!isAuthenticated || !shouldConnectRef.current || isConnectingRef.current) {
      return;
    }

    // Prevent multiple simultaneous connection attempts
    isConnectingRef.current = true;

    // Increment connection ID to track this specific connection attempt
    const currentConnectionId = ++connectionIdRef.current;

    // Clean up existing connection before creating new one
    if (wsRef.current) {
      const existingWs = wsRef.current;
      const readyState = existingWs.readyState;

      if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
        console.log('[WebSocket] Already connected or connecting, skipping...');
        isConnectingRef.current = false;
        return;
      }

      // Force close any existing connection
      try {
        existingWs.onopen = null;
        existingWs.onmessage = null;
        existingWs.onerror = null;
        existingWs.onclose = null;
        existingWs.close();
      } catch (error) {
        console.error('[WebSocket] Error closing existing connection:', error);
      }
      wsRef.current = null;
    }

    // Clear any pending reconnection attempts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        // Check if this is still the current connection attempt
        if (currentConnectionId !== connectionIdRef.current) {
          console.log('[WebSocket] Stale connection opened, closing...');
          ws.close();
          return;
        }

        setIsConnected(true);
        setReconnectAttempts(0);
        isConnectingRef.current = false;
        onConnectRef.current?.();
      };

      ws.onmessage = event => {
        // Check if this is still the current connection
        if (currentConnectionId !== connectionIdRef.current) {
          return;
        }

        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          onMessageRef.current?.(message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onerror = event => {
        // Check if this is still the current connection
        if (currentConnectionId !== connectionIdRef.current) {
          return;
        }

        console.error('[WebSocket] Error:', event);
        isConnectingRef.current = false;
        onErrorRef.current?.(event);
      };

      ws.onclose = event => {
        // Check if this is still the current connection
        if (currentConnectionId !== connectionIdRef.current) {
          return;
        }

        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        setIsConnected(false);
        wsRef.current = null;
        isConnectingRef.current = false;
        onDisconnectRef.current?.();

        // Attempt reconnection if we should still be connected
        if (
          shouldConnectRef.current &&
          isAuthenticated &&
          reconnectAttempts < maxReconnectAttempts
        ) {
          console.log(
            `[WebSocket] Reconnecting in ${reconnectInterval}ms (attempt ${
              reconnectAttempts + 1
            }/${maxReconnectAttempts})`,
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, reconnectInterval);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.error('[WebSocket] Max reconnection attempts reached');
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection failed:', error);
      isConnectingRef.current = false;
    }
  }, [
    isAuthenticated,
    getWebSocketUrl,
    reconnectInterval,
    maxReconnectAttempts,
    reconnectAttempts,
  ]);

  const disconnect = useCallback(() => {
    shouldConnectRef.current = false;

    // Increment connection ID to invalidate any in-flight connections
    connectionIdRef.current++;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      try {
        // Remove event handlers to prevent reconnection
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch (error) {
        console.error('[WebSocket] Error during disconnect:', error);
      }
      wsRef.current = null;
    }

    setIsConnected(false);
    setReconnectAttempts(0);
    isConnectingRef.current = false;
  }, []);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message: not connected');
    }
  }, []);

  // Connect when authenticated, disconnect when not
  useEffect(() => {
    if (isAuthenticated) {
      shouldConnectRef.current = true;

      // Only connect if not already connected or connecting
      if (
        !wsRef.current ||
        wsRef.current.readyState === WebSocket.CLOSED ||
        wsRef.current.readyState === WebSocket.CLOSING
      ) {
        connect();
      }
    } else {
      disconnect();
    }

    return () => {
      // Cleanup on unmount or when authentication changes
      shouldConnectRef.current = false;
      connectionIdRef.current++;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch (error) {
          console.error('[WebSocket] Error during cleanup:', error);
        }
        wsRef.current = null;
      }

      isConnectingRef.current = false;
    };
    // Only re-run when authentication status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return {
    isConnected,
    sendMessage,
    reconnectAttempts,
    disconnect,
  };
};
