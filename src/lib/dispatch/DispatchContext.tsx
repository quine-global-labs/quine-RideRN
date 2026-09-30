import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { device, DISPATCH_URL } from './device';
import type { ClientMessage, ServerMessage, Snapshot } from './protocol';
import './testHooks';

const RECONNECT_MS = 1000;

type DispatchState = {
  connected: boolean;
  snapshot: Snapshot | null;
  /** The last error the server reported for something this device did. */
  error: string | null;
  /** Returns false when offline; the message is not queued. */
  send: (message: ClientMessage) => boolean;
  clearError: () => void;
};

const DispatchContext = createContext<DispatchState | null>(null);

type HeldTraffic = { outbound: string[]; inbound: ServerMessage[] };

export function DispatchProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heldRef = useRef<HeldTraffic | null>(null);

  const receive = useCallback((message: ServerMessage) => {
    if (message.type === 'snapshot') setSnapshot(message.snapshot);
    else setError(message.message);
  }, []);

  // The multi-phone simulator's hook for staging races (see DispatchLinkControl).
  useEffect(() => {
    if (Platform.OS !== 'web' || !__DEV__) return;
    window.__dispatchLink = {
      hold: () => {
        heldRef.current ??= { outbound: [], inbound: [] };
      },
      release: () => {
        const held = heldRef.current;
        heldRef.current = null;
        if (!held) return;
        for (const raw of held.outbound) socketRef.current?.send(raw);
        held.inbound.forEach(receive);
      },
      get held() {
        return heldRef.current !== null;
      },
    };
    return () => {
      delete window.__dispatchLink;
    };
  }, [receive]);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const socket = new WebSocket(DISPATCH_URL);
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'hello', device } satisfies ClientMessage));
        setConnected(true);
      };
      socket.onmessage = (event) => {
        const message: ServerMessage = JSON.parse(String(event.data));
        if (heldRef.current) heldRef.current.inbound.push(message);
        else receive(message);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [receive]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('Not connected to dispatch');
      return false;
    }
    setError(null);
    const raw = JSON.stringify(message);
    if (heldRef.current) heldRef.current.outbound.push(raw);
    else socket.send(raw);
    return true;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(() => ({ connected, snapshot, error, send, clearError }), [connected, snapshot, error, send, clearError]);
  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>;
}

export function useDispatch(): DispatchState {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error('useDispatch must be used inside <DispatchProvider>');
  return ctx;
}
