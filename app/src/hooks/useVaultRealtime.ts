"use client";

import { useEffect, useRef, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, AccountChangeCallback } from "@solana/web3.js";

/**
 * Subscribes to real-time WebSocket account change notifications for the
 * given vault PDA. Calls onUpdate whenever the on-chain account changes.
 *
 * The subscription is established once and cleaned up when the component
 * unmounts or the vaultAddress changes. A debounce of 400 ms prevents
 * duplicate calls when multiple updates arrive in the same slot.
 */
export function useVaultRealtime(
  vaultAddress: string | null,
  onUpdate:     () => void,
): void {
  const { connection } = useConnection();
  const subIdRef       = useRef<number | null>(null);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedUpdate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(onUpdate, 400);
  }, [onUpdate]);

  useEffect(() => {
    if (!vaultAddress) return;

    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(vaultAddress);
    } catch {
      return;
    }

    const handler: AccountChangeCallback = (_info) => {
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
}