"use client";

import { useEffect, useRef, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, AccountChangeCallback } from "@solana/web3.js";
import { useWatcherEvents } from "@/hooks/useWatcherEvents";

export function useVaultRealtime(
  vaultAddress: string | null,
  onUpdate:     () => void,
): void {
  const { connection } = useConnection();
  const { subscribe }  = useWatcherEvents();

  const subIdRef    = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedUpdate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(onUpdate, 400);
  }, [onUpdate]);

  // Solana native onAccountChange subscription
  useEffect(() => {
    if (!vaultAddress) return;

    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(vaultAddress);
    } catch {
      return;
    }

    const handler: AccountChangeCallback = () => {
      debouncedUpdate();
    };

    subIdRef.current = connection.onAccountChange(pubkey, handler, "confirmed");

    return () => {
      if (subIdRef.current !== null) {
        connection.removeAccountChangeListener(subIdRef.current).catch(() => {});
        subIdRef.current = null;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [vaultAddress, connection, debouncedUpdate]);

  // Watcher WebSocket subscription (no-op if env var absent)
  useEffect(() => {
    if (!vaultAddress) return;
    const unsubscribe = subscribe(vaultAddress, debouncedUpdate);
    return unsubscribe;
  }, [vaultAddress, subscribe, debouncedUpdate]);
}
