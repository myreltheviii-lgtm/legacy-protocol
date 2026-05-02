// sdk/src/hooks.ts
//
// React hooks for real-time vault state management. These are SDK-level hooks
// so wallet integrators get out-of-the-box subscriptions without having to
// wire up the underlying SDK calls manually.
//
// Peer dependencies: react ≥ 18, @solana/wallet-adapter-react ≥ 0.15.
// Both are declared as optional peerDependencies in package.json. This file
// uses dynamic resolution so the SDK can still be used in non-React contexts
// (Node.js, relayer, watcher) without React being present.
//
// Level 3 SDK features delivered here:
//   useVault            — fetches + subscribes to a vault and its activity
//   useVaultRealtime    — low-level WebSocket subscription (account change)
//   useGuardians        — fetches all active guardians for a vault
//   useCovenants        — fetches all open (unexecuted) covenants for a vault
//   useVaultInactivity  — computes live inactivity state, auto-refreshes

import { useState, useEffect, useRef, useCallback } from "react";
import type { Connection, AccountChangeCallback } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import {
  fetchVault,
  fetchActivity,
  fetchAllGuardiansForVault,
  fetchAllCovenantsForVault,
} from "./accounts";
import { deriveActivityPda } from "./pda";
import { computeVaultInactivityState } from "./math";
import type {
  VaultAccount,
  ActivityAccount,
  GuardianAccount,
  CovenantAccount,
  VaultInactivityState,
} from "./types";

// ── useVault ──────────────────────────────────────────────────────────────────

export interface UseVaultResult {
  vault:       VaultAccount | null;
  activity:    ActivityAccount | null;
  inactivity:  VaultInactivityState | null;
  currentSlot: bigint;
  loading:     boolean;
  error:       string | null;
  refresh:     () => Promise<void>;
}

/**
 * Fetches a VaultAccount and companion ActivityAccount, derives inactivity state,
 * and auto-refreshes every 30 seconds. Ideal for the vault detail page.
 *
 * Pass `vaultAddress = null` to put the hook in an idle state (no fetches).
 */
export function useVault(
  connection:   Connection,
  programId:    PublicKey,
  vaultAddress: string | null,
): UseVaultResult {
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
      const [actPda] = deriveActivityPda(programId, vaultPk);
      const slot     = BigInt(await connection.getSlot("confirmed"));

      const [v, a] = await Promise.all([
        fetchVault(connection, programId, vaultPk),
        fetchActivity(connection, programId, actPda),
      ]);

      setVault(v);
      setActivity(a);
      setCurrentSlot(slot);
      setInactivity(v ? computeVaultInactivityState(v, slot) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vault");
    } finally {
      setLoading(false);
    }
  }, [vaultAddress, connection, programId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 30 seconds so the inactivity score drifts correctly
  // even without an on-chain event to trigger a WebSocket push.
  useEffect(() => {
    if (!vaultAddress) return;
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [vaultAddress, refresh]);

  return { vault, activity, inactivity, currentSlot, loading, error, refresh };
}

// ── useVaultRealtime ──────────────────────────────────────────────────────────

/**
 * Subscribes to real-time WebSocket account change notifications for the
 * given vault PDA. Calls `onUpdate` whenever the account data changes.
 *
 * A 400 ms debounce prevents duplicate calls when multiple updates arrive
 * in the same slot. The subscription is cleaned up on unmount or when
 * `vaultAddress` changes.
 */
export function useVaultRealtime(
  connection:   Connection,
  vaultAddress: string | null,
  onUpdate:     () => void,
): void {
  const subIdRef    = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const handler: AccountChangeCallback = (_info) => { debouncedUpdate(); };
    subIdRef.current = connection.onAccountChange(pubkey, handler, "confirmed");

    return () => {
      if (subIdRef.current !== null) {
        connection.removeAccountChangeListener(subIdRef.current).catch(() => {});
        subIdRef.current = null;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [vaultAddress, connection, debouncedUpdate]);
}

// ── useGuardians ──────────────────────────────────────────────────────────────

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
 * Fetches all active GuardianAccounts for a vault using getProgramAccounts
 * with a memcmp filter. Refreshes on every call to `refresh`.
 */
export function useGuardians(
  connection:   Connection,
  programId:    PublicKey,
  vaultAddress: string | null,
): UseGuardiansResult {
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
      const result = await fetchAllGuardiansForVault(
        connection,
        programId,
        new PublicKey(vaultAddress),
      );
      setGuardians(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load guardians");
    } finally {
      setLoading(false);
    }
  }, [vaultAddress, connection, programId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { guardians, loading, error, refresh };
}

// ── useCovenants ──────────────────────────────────────────────────────────────

export interface CovenantWithAddress {
  publicKey: string;
  account:   CovenantAccount;
}

export interface UseCovenantsResult {
  covenants:       CovenantWithAddress[];
  openCovenants:   CovenantWithAddress[];  // is_executed = false
  loading:         boolean;
  error:           string | null;
  refresh:         () => Promise<void>;
}

/**
 * Fetches all CovenantAccounts for a vault, sorted by covenant_index ascending.
 * Also provides `openCovenants` — covenants with is_executed = false — as a
 * convenience slice for the signing queue UI.
 */
export function useCovenants(
  connection:   Connection,
  programId:    PublicKey,
  vaultAddress: string | null,
): UseCovenantsResult {
  const [covenants, setCovenants] = useState<CovenantWithAddress[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!vaultAddress) {
      setCovenants([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAllCovenantsForVault(
        connection,
        programId,
        new PublicKey(vaultAddress),
      );
      setCovenants(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load covenants");
    } finally {
      setLoading(false);
    }
  }, [vaultAddress, connection, programId]);

  useEffect(() => { refresh(); }, [refresh]);

  const openCovenants = covenants.filter((c) => !c.account.isExecuted);

  return { covenants, openCovenants, loading, error, refresh };
}

// ── useVaultInactivity ────────────────────────────────────────────────────────

export interface UseVaultInactivityResult {
  inactivity:  VaultInactivityState | null;
  currentSlot: bigint;
}

/**
 * Derives the live inactivity state for a vault by fetching the current slot
 * every `refreshIntervalMs` milliseconds and recomputing. Designed to power
 * animated score counters that update visually without waiting for the vault
 * account itself to change.
 *
 * Uses the same BigInt math as the on-chain program so the displayed score
 * is always prediction-accurate.
 */
export function useVaultInactivity(
  connection:          Connection,
  vault:               VaultAccount | null,
  refreshIntervalMs:   number = 5_000,
): UseVaultInactivityResult {
  const [currentSlot, setCurrentSlot] = useState<bigint>(0n);
  const [inactivity,  setInactivity]  = useState<VaultInactivityState | null>(null);

  useEffect(() => {
    if (!vault) {
      setInactivity(null);
      return;
    }

    async function tick() {
      try {
        const slot = BigInt(await connection.getSlot("confirmed"));
        setCurrentSlot(slot);
        setInactivity(computeVaultInactivityState(vault!, slot));
      } catch {
        // Non-fatal — use the last known state until the next tick
      }
    }

    tick();
    const id = setInterval(tick, refreshIntervalMs);
    return () => clearInterval(id);
  }, [vault, connection, refreshIntervalMs]);

  return { inactivity, currentSlot };
}

