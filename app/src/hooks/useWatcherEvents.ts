"use client";

import { useEffect, useRef, useCallback } from "react";

type Listener = () => void;

const _listeners = new Map<string, Set<Listener>>();
let _ws: WebSocket | null = null;
let _connected = false;
let _reconnectAttempt = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _url: string | null = null;

function _notify(vaultAddress: string) {
  const set = _listeners.get(vaultAddress);
  if (set) {
    set.forEach((cb) => {
      try { cb(); } catch { /* ignore */ }
    });
  }
}

function _connect() {
  if (!_url) return;
  if (_connected) return;

  try {
    _ws = new WebSocket(_url);
  } catch {
    _scheduleReconnect();
    return;
  }

  _ws.onopen = () => {
    _connected = true;
    _reconnectAttempt = 0;
  };

  _ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as {
        type: string;
        vault: string;
        data: unknown;
      };
      if (msg.vault) {
        _notify(msg.vault);
      }
    } catch { /* ignore */ }
  };

  _ws.onerror = () => {
    _connected = false;
  };

  _ws.onclose = () => {
    _connected = false;
    _ws = null;
    _scheduleReconnect();
  };
}

function _scheduleReconnect() {
  if (_reconnectTimer) return;
  const delay = Math.min(1000 * Math.pow(2, _reconnectAttempt), 30_000);
  _reconnectAttempt++;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (_url && _listeners.size > 0) {
      _connect();
    }
  }, delay);
}

function _subscribe(vaultAddress: string, cb: Listener): () => void {
  if (!_listeners.has(vaultAddress)) {
    _listeners.set(vaultAddress, new Set());
  }
  _listeners.get(vaultAddress)!.add(cb);

  return () => {
    const set = _listeners.get(vaultAddress);
    if (set) {
      set.delete(cb);
      if (set.size === 0) {
        _listeners.delete(vaultAddress);
      }
    }
  };
}

export function useWatcherEvents(): {
  subscribe: (vaultAddress: string, cb: Listener) => () => void;
} {
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    const wsUrl = process.env.NEXT_PUBLIC_WATCHER_WS_URL;
    if (!wsUrl) return;

    _url = wsUrl;
    _connect();

    return () => {
      // Singleton lives for tab lifetime — don't disconnect on individual hook unmount.
    };
  }, []);

  const subscribe = useCallback(
    (vaultAddress: string, cb: Listener) => _subscribe(vaultAddress, cb),
    [],
  );

  return { subscribe };
}
