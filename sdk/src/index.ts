// sdk/src/index.ts — barrel export for @legacy-protocol/sdk

export * from "./types";
export * from "./accounts";
export * from "./pda";
export * from "./math";
export * from "./instructions";
// transactions.ts is the complete superset of send.ts — it includes retry,
// versioned tx support, offline signing, and simulateTx. send.ts is not
// re-exported to avoid duplicate WalletAdapter / sendAndConfirmLegacyTx names.
export * from "./transactions";
export * from "./events";
export * from "./shamir";
export * from "./cloak";
// blink.ts provides Solana Actions / Blink URL builders used by the watcher,
// relayer, and frontend notification flows. Must be exported from the barrel
// so all downstream consumers can import via @legacy-protocol/sdk without
// reaching into the package internals.
export * from "./blink";

// Constants mirrored from the on-chain program for client-side validation.
export const MIN_INACTIVITY_THRESHOLD_SLOTS = 432_000n;
export const MAX_INACTIVITY_THRESHOLD_SLOTS = 157_680_000n;
export const DEFAULT_INACTIVITY_THRESHOLD_SLOTS = 5_000_000n;
export const MAX_GUARDIANS = 10;
// Covenant timelock constants mirrored from constants.rs.
export const BENEFICIARY_CHANGE_TIMELOCK_SLOTS    = 432_000n;
export const GUARDIAN_REMOVAL_TIMELOCK_SLOTS      = 216_000n;
export const EMERGENCY_SWEEP_TIMELOCK_SLOTS       = 0n;
export const GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS = 0n;
