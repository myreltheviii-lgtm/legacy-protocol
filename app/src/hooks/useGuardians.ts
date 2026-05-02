"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { fetchAllGuardiansForVault, GuardianAccount } from "@legacy-protocol/sdk";
import { PROGRAM_ID } from "@/lib/sdk";

export interface GuardianWithAddress {
  publicKey: string;
  account:   GuardianAccount;
}

export interface UseGuardiansResult {
  guardians: GuardianWithAddress[];
  loading:   boolean;
  error:     string | null;
  refresh:   () => Promise<void>;
}

/**
 * Fetches all active guardian accounts for a vault. Uses getProgramAccounts
 * with a memcmp filter so only relevant accounts are returned from the RPC.
 */
export function useGuardians(vaultAddress: string | null): UseGuardiansResult {
  const { connection } = useConnection();
  const [guardians, setGuardians] = useState<GuardianWithAddress[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!vaultAddress) {
      setGuardians([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const vaultPk = new PublicKey(vaultAddress);
      const result  = await fetchAllGuardiansForVault(connection, PROGRAM_ID, vaultPk);
      setGuardians(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load guardians");
    } finally {
      setLoading(false);
    }
  }, [vaultAddress, connection]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { guardians, loading, error, refresh };
}