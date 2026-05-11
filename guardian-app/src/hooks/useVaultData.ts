// guardian-app/src/hooks/useVaultData.ts
//
// Fetches vault and guardian data from the watcher's /vaults HTTP endpoint
// and derives urgency scores for dashboard sorting.
// All data is behavioral metadata — no Cloak cryptographic fields are exposed.

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultSummary {
  vaultAddress:             string;
  ownerAddress:             string;
  // beneficiary is the beneficiary_utxo_pubkey as a 64-char hex string.
  // For non-shielded vaults this encodes a Solana wallet pubkey.
  // For shielded vaults this encodes a Cloak UTXO pubkey (NOT a Solana wallet).
  // Used by SignCovenant to derive beneficiaryUtxoPubkey for Cloak transfers.
  beneficiary:              string;
  lastCheckInSlot:          string;
  inactivityThresholdSlots: string;
  depositedLamports:        string;
  guardianCount:            number;
  mOfNThreshold:            number;
  warning75Sent:            boolean;
  warning90Sent:            boolean;
  triggerSignalled:         boolean;
  anomalyFlagged:           boolean;
  checkinCount:             string;
  sumOfIntervals:           string;
  lastPolledSlot:           string;
  // Derived client-side
  urgencyScore:             number;
  zone:                     "GREEN" | "YELLOW" | "ORANGE" | "RED";
  silenceDays:              number;
  historicalAvgDays:        number;
  isShielded:               boolean;
}

// EXPO_PUBLIC_WATCHER_URL must be set at build time — no fallback is accepted
// because a hardcoded localhost address would silently fail in production.
// If this var is absent the hook surfaces an actionable error in the UI.
const WATCHER_URL     = process.env.EXPO_PUBLIC_WATCHER_URL ?? "";
const SLOTS_PER_DAY   = 172_800;
const REFRESH_INTERVAL_MS = 30_000;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVaultData() {
  const [vaults,    setVaults]    = useState<VaultSummary[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchVaults = useCallback(async () => {
    if (!WATCHER_URL) {
      setError(
        "EXPO_PUBLIC_WATCHER_URL is not configured. " +
        "Set it in your .env file before building the app.",
      );
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${WATCHER_URL}/vaults`);
      if (!res.ok) throw new Error(`Watcher responded ${res.status}`);

      const raw: Array<Record<string, unknown>> = await res.json();

      const enriched: VaultSummary[] = raw.map((v) => {
        const lastCheckIn  = Number(v.lastCheckInSlot  ?? "0");
        const threshold    = Number(v.inactivityThresholdSlots ?? "1");
        const lastPolled   = Number(v.lastPolledSlot   ?? "0");
        const checkinCount = Number(v.checkinCount     ?? "0");
        const sumIntervals = Number(v.sumOfIntervals   ?? "0");

        const elapsedSlots = Math.max(0, lastPolled - lastCheckIn);
        const score        = threshold > 0 ? (elapsedSlots / threshold) * 100 : 0;

        const zone: VaultSummary["zone"] =
          score >= 100 ? "RED"    :
          score >= 90  ? "ORANGE" :
          score >= 75  ? "YELLOW" : "GREEN";

        const silenceDays        = elapsedSlots / SLOTS_PER_DAY;
        const historicalAvgDays  =
          checkinCount > 0 && sumIntervals > 0
            ? (sumIntervals / checkinCount) / SLOTS_PER_DAY
            : 0;

        // Urgency score: zones get base weights; anomaly and trigger flags add bonus.
        const zoneWeight =
          zone === "RED"    ? 1000 :
          zone === "ORANGE" ? 100  :
          zone === "YELLOW" ? 10   : 1;

        const urgencyScore =
          zoneWeight * score +
          ((v.anomalyFlagged  as boolean) ? 500  : 0) +
          ((v.triggerSignalled as boolean) ? 1000 : 0);

        return {
          vaultAddress:             v.vaultAddress             as string,
          ownerAddress:             v.ownerAddress             as string,
          // beneficiary is the watcher's record of beneficiary_utxo_pubkey (hex string).
          beneficiary:              (v.beneficiary as string) ?? "",
          lastCheckInSlot:          v.lastCheckInSlot          as string,
          inactivityThresholdSlots: v.inactivityThresholdSlots as string,
          depositedLamports:        v.depositedLamports        as string,
          guardianCount:            v.guardianCount            as number,
          mOfNThreshold:            v.mOfNThreshold            as number,
          warning75Sent:            v.warning75Sent            as boolean,
          warning90Sent:            v.warning90Sent            as boolean,
          triggerSignalled:         v.triggerSignalled         as boolean,
          anomalyFlagged:           v.anomalyFlagged           as boolean,
          checkinCount:             v.checkinCount             as string,
          sumOfIntervals:           v.sumOfIntervals           as string,
          lastPolledSlot:           v.lastPolledSlot           as string,
          urgencyScore,
          zone,
          silenceDays,
          historicalAvgDays,
          isShielded: (v.depositedLamports as string) === "0",
        };
      });

      // Sort by urgency descending — most urgent vault appears first.
      enriched.sort((a, b) => b.urgencyScore - a.urgencyScore);

      setVaults(enriched);
      setError(null);
      setLastFetch(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVaults();
    const timer = setInterval(fetchVaults, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchVaults]);

  return { vaults, loading, error, lastFetch, refetch: fetchVaults };
}
