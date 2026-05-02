// watcher/src/types/watcher.ts
//
// Shared type definitions for the watcher service's internal data model.
// These types represent the local database record shape — they are NOT the
// same as the on-chain account shapes (those live in activity.ts). The local
// record is a denormalised snapshot of on-chain state plus watcher-specific
// bookkeeping fields (warning flags, signal state, etc.).
//
// All u64 values from on-chain accounts are stored as strings here because
// JavaScript's JSON serialiser loses precision on BigInt and SQLite stores
// integers as text for large values. The watcher converts to BigInt for
// arithmetic and back to string for storage.

// ── Primary vault record ──────────────────────────────────────────────────────

/**
 * The watcher's local representation of a single vault. Persisted in SQLite
 * and updated every poll cycle via reconcileVault().
 */
export interface VaultRecord {
  /** Base58-encoded PDA address of the VaultAccount on-chain. */
  vaultAddress: string;

  /** Base58-encoded pubkey of the vault owner. */
  ownerAddress: string;

  /** Base58-encoded pubkey of the designated beneficiary. */
  beneficiary: string;

  /** u64 as string: the vault_index used to derive this vault's PDA. */
  vaultIndex: string;

  /** u64 as string: last slot at which the owner checked in on-chain. */
  lastCheckInSlot: string;

  /** u64 as string: the configured inactivity threshold in slots. */
  inactivityThresholdSlots: string;

  /** u64 as string: lamports currently held by the vault PDA. */
  depositedLamports: string;

  /** Number of active registered guardians. */
  guardianCount: number;

  /** Required guardian signatures for any covenant to execute. */
  mOfNThreshold: number;

  // ── On-chain warning flags ──────────────────────────────────────────────────
  // These mirror the on-chain boolean fields and are kept in sync during
  // reconciliation. The watcher uses its local copy for the poll-cycle decision
  // and falls back to the on-chain value after a restart.

  /** True if the 75% guardian ping has already been sent. */
  warning75Sent: boolean;

  /** True if the 90% beneficiary warning has already been sent. */
  warning90Sent: boolean;

  // ── Watcher-specific bookkeeping ────────────────────────────────────────────

  /** True if the watcher has emitted a trigger signal to the relayer. */
  triggerSignalled: boolean;

  /** True if the on-chain activity account shows an active anomaly flag. */
  anomalyFlagged: boolean;

  // ── Activity model (mirrored from ActivityAccount) ───────────────────────────

  /** u64 as string: total number of check-ins recorded on-chain. */
  checkinCount: string;

  /** u64 as string: cumulative sum of all check-in intervals in slots. */
  sumOfIntervals: string;

  // ── Metadata ─────────────────────────────────────────────────────────────────

  /** u64 as string: the slot number of the most recent watcher poll. */
  lastPolledSlot: string;

  /** ISO-8601 timestamp when this record was first inserted. */
  createdAt: string;

  /** ISO-8601 timestamp of the most recent update to this record. */
  updatedAt: string;
}

// ── Partial update type ───────────────────────────────────────────────────────

/**
 * A partial VaultRecord used for upsert operations. All fields except
 * `vaultAddress` are optional — the store will only update supplied fields.
 */
export type VaultRecordUpdate = Partial<Omit<VaultRecord, "vaultAddress">> & {
  vaultAddress: string;
};

// ── Poll cycle summary ────────────────────────────────────────────────────────

/**
 * A summary of one complete poll cycle, logged at the end of each iteration
 * and optionally published to a monitoring endpoint.
 */
export interface PollCycleSummary {
  /** The Solana slot number at the start of this cycle. */
  cycleSlot: string;

  /** Wall-clock timestamp (ms) when this cycle started. */
  cycleStartMs: number;

  /** How long the full cycle took in milliseconds. */
  cycleDurationMs: number;

  /** Total vaults actively monitored this cycle. */
  totalVaults: number;

  /** Vaults removed from monitoring this cycle (claimed/swept/closed). */
  deactivated: number;

  /** Guardian pings sent this cycle. */
  guardianPings: number;

  /** Beneficiary warnings sent this cycle. */
  beneficiaryWarnings: number;

  /** Trigger signals emitted to the relayer this cycle. */
  triggerSignals: number;

  /** Anomaly flags submitted on-chain this cycle. */
  anomalyFlags: number;

  /** Number of reconciliation errors encountered. */
  errors: number;
}
