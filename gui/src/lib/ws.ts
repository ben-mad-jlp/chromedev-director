/**
 * WebSocket client for real-time communication with the API server
 * Provides auto-reconnect with exponential backoff, subscribe/unsubscribe API for message types
 */

import type { WsMessage } from './types';

/**
 * Callback signature for WebSocket message listeners
 */
export type WsCallback = (data: any) => void;

/**
 * WebSocket client singleton with auto-reconnect and pub/sub functionality
 */
class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start at 1 second
  private maxReconnectDelay = 30000; // Cap at 30 seconds
  private reconnectTimeout: number | null = null;
  private messageListeners: Map<string, Set<WsCallback>> = new Map();
  private connectionPromise: Promise<void> | null = null;
  private connectionResolver: (() => void) | null = null;
  private connectionRejecter: ((error: Error) => void) | null = null;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${protocol}//${window.location.host}/ws`;
    }
  }

  /**
   * Connect to the WebSocket server
   * Returns a promise that resolves when connected
   */
  async connect(): Promise<void> {
    // If already connected, resolve immediately
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    // If a connection is already in progress, return that promise
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Create new connection promise
    this.connectionPromise = new Promise((resolve, reject) => {
      this.connectionResolver = resolve;
      this.connectionRejecter = reject;
      this._connect();
    });

    return this.connectionPromise;
  }

  /**
   * Internal connection method
   */
  private _connect(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        console.log('[WebSocket] Connected');

        if (this.connectionResolver) {
          this.connectionResolver();
          this.connectionResolver = null;
        }
        this.connectionPromise = null;
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this._handleMessage(event.data);
      };

      this.ws.onerror = (event: Event) => {
        console.error('[WebSocket] Error:', event);
        if (this.connectionRejecter) {
          this.connectionRejecter(new Error('WebSocket connection failed'));
          this.connectionRejecter = null;
        }
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        this.connected = false;
        this.connectionPromise = null;

        // Auto-reconnect logic
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
          );

          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

          this.reconnectTimeout = window.setTimeout(() => {
            this._connect();
          }, delay);
        } else {
          console.error('[WebSocket] Max reconnect attempts reached');
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      if (this.connectionRejecter) {
        this.connectionRejecter(error as Error);
        this.connectionRejecter = null;
      }
      this.connectionPromise = null;
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private _handleMessage(rawData: string): void {
    try {
      const message = JSON.parse(rawData);
      const type = message.type;
      const callbacks = this.messageListeners.get(type);

      if (callbacks) {
        callbacks.forEach((callback) => {
          try {
            callback(message);
          } catch (error) {
            console.error(`[WebSocket] Error in callback for message type "${type}":`, error);
          }
        });
      }
    } catch (error) {
      console.error('[WebSocket] Error parsing message:', error);
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    // Clear any pending reconnect timeout
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Mark as disconnected to prevent auto-reconnect
    this.connected = false;

    // Close the WebSocket connection
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }

    this.ws = null;
    this.connectionPromise = null;
  }

  /**
   * Subscribe to a specific message type
   * Returns an unsubscribe function
   */
  subscribe(type: string, callback: WsCallback): () => void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, new Set());
    }

    const callbacks = this.messageListeners.get(type)!;
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.messageListeners.delete(type);
      }
    };
  }

  /**
   * Send a message to the WebSocket server
   */
  send(message: WsMessage): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Cannot send message: not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[WebSocket] Error sending message:', error);
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Global WebSocket client singleton instance
 */
let wsClient: WebSocketClient | null = null;

/**
 * Get or create the WebSocket client singleton
 */
export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    // Use environment variable or fallback to localhost
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsUrl = (import.meta.env as any).VITE_WS_URL || undefined;
    wsClient = new WebSocketClient(wsUrl);
  }
  return wsClient;
}

/**
 * Singleton API for WebSocket operations
 * Most code should use these convenience functions instead of getWebSocketClient() directly
 */

export async function connectWebSocket(): Promise<void> {
  return getWebSocketClient().connect();
}

export async function disconnectWebSocket(): Promise<void> {
  return getWebSocketClient().disconnect();
}

export function subscribeToWebSocket(
  type: string,
  callback: WsCallback
): () => void {
  return getWebSocketClient().subscribe(type, callback);
}

export function sendWebSocketMessage(message: WsMessage): void {
  getWebSocketClient().send(message);
}

export function isWebSocketConnected(): boolean {
  return getWebSocketClient().isConnected();
}
