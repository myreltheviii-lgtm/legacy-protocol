"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  fetchVault,
  fetchActivity,
  computeVaultInactivityState,
  VaultAccount,
  ActivityAccount,
  VaultInactivityState,
} from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";
import { deriveActivityPda } from "@legacy-protocol/sdk";

export interface UseVaultResult {
  vault:           VaultAccount | null;
  activity:        ActivityAccount | null;
  inactivity:      VaultInactivityState | null;
  currentSlot:     bigint;
  loading:         boolean;
  error:           string | null;
  refresh:         () => Promise<void>;
}

/**
 * Fetches a VaultAccount and its companion ActivityAccount, then derives the
 * inactivity state. Refreshes automatically every 30 seconds to stay current.
 */
export function useVault(vaultAddress: string | null): UseVaultResult {
  const { connection } = useConnection();

  const [vault,       setVault]       = useState<VaultAccount | null>(null);
  const [activity,    setActivity]    = useState<ActivityAccount | null>(null);
  const [inactivity,  setInactivity]  = useState<VaultInactivityState | null>(null);
  const [currentSlot, setCurrentSlot] = useState<bigint>(0n);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!vaultAddress) return;

    setLoading(true);
    setError(null);

    try {
      const vaultPk  = new PublicKey(vaultAddress);
      const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPk);
      const slot     = BigInt(await connection.getSlot("confirmed"));

      const [v, a] = await Promise.all([
        fetchVault(connection, PROGRAM_ID, vaultPk),
        fetchActivity(connection, PROGRAM_ID, actPda),
      ]);

      setVault(v);
      setActivity(a);
      setCurrentSlot(slot);

      if (v) {
        setInactivity(computeVaultInactivityState(v, slot));
      } else {
        setInactivity(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vault");
    } finally {
      setLoading(false);
    }
  }, [vaultAddress, connection]);

  // Fetch on mount and whenever the vault address changes.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh every 30 seconds to keep the inactivity score current.
  useEffect(() => {
    if (!vaultAddress) return;
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [vaultAddress, refresh]);

  return { vault, activity, inactivity, currentSlot, loading, error, refresh };
}