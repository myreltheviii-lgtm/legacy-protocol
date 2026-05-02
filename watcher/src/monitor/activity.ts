// watcher/src/monitor/activity.ts
//
// Responsible for fetching each registered vault's live on-chain state and
// reconciling it with the local database record. This module is the bridge
// between Solana's account data and the watcher's internal model.
//
// It does not decide what to do with stale vaults — that decision belongs to
// block_counter.ts and the alert pipeline. This module only answers:
// "what does the chain say right now about this vault?"

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { LegacyVault } from "../types/legacy_vault";
import { VaultRecord } from "../types/watcher";
import { getStore } from "../db/store";
import { logger } from "../logger";

// ── On-chain account shapes mirrored here ────────────────────────────────────
// These interfaces mirror the Anchor-generated account structs from Layer 1.
// If the on-chain program schema changes, update these accordingly.

export interface OnChainVaultAccount {
  owner: PublicKey;
  beneficiary: PublicKey;
  guardianCount: number;
  mOfNThreshold: number;
  inactivityThresholdSlots: bigint;
  lastCheckInSlot: bigint;
  createdSlot: bigint;
  depositedLamports: bigint;
  covenantCounter: bigint;
  vaultIndex: bigint;
  isTriggered: boolean;
  isClaimed: boolean;
  isEmergencySwept: boolean;
  warning75Sent: boolean;
  warning90Sent: boolean;
  bump: number;
}

export interface OnChainActivityAccount {
  vault: PublicKey;
  checkinCount: bigint;
  sumOfIntervals: bigint;
  lastInterval: bigint;
  anomalyFlagged: boolean;
  anomalyFlaggedSlot: bigint;
  bump: number;
}

// ── Seeds must exactly match constants.rs ─────────────────────────────────────

const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");

// ── PDA derivation helpers ────────────────────────────────────────────────────

/**
 * Derives the vault PDA for a given owner and vault index.
 * Must produce the same address as the on-chain program or account fetches
 * will silently return null.
 *
 * Synchronous: findProgramAddressSync does not perform any I/O. The async
 * wrapper was removed to avoid unnecessary microtask bounces on the hot path.
 */
export function deriveVaultPda(
  programId: PublicKey,
  owner: PublicKey,
  vaultIndex: bigint,
): [PublicKey, number] {
  const indexBytes = Buffer.alloc(8);
  // Solana uses little-endian for u64 seeds — matches to_le_bytes() in Rust.
  indexBytes.writeBigUInt64LE(vaultIndex);
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), indexBytes],
    programId,
  );
}

/**
 * Derives the activity PDA for a given vault PDA.
 *
 * Synchronous: findProgramAddressSync does not perform any I/O.
 */
export function deriveActivityPda(
  programId: PublicKey,
  vaultPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ACTIVITY_SEED, vaultPubkey.toBuffer()],
    programId,
  );
}

// ── Account fetching ──────────────────────────────────────────────────────────

/**
 * Fetches and deserialises the VaultAccount at the given address.
 * Returns null ONLY if the account genuinely does not exist on-chain.
 *
 * Critical distinction: this function does NOT catch RPC-level errors.
 * A thrown exception means the RPC call failed (network issue, timeout,
 * rate limit) — NOT that the account is absent. Callers that swallow this
 * exception and treat it as "account not found" would incorrectly deactivate
 * vaults during transient RPC outages. Let the exception propagate so
 * reconcileAllVaults can keep the stale record in the active set and retry
 * on the next cycle.
 */
export async function fetchVaultAccount(
  connection: Connection,
  program: Program<LegacyVault>,
  vaultPubkey: PublicKey,
): Promise<OnChainVaultAccount | null> {
  // fetchNullable returns null when the account does not exist (discriminator
  // not found / zero lamports). It throws on RPC transport errors. We do not
  // catch here — let the caller decide how to handle failures.
  const account = await program.account.vaultAccount.fetchNullable(vaultPubkey);
  return account as OnChainVaultAccount | null;
}

/**
 * Fetches and deserialises the ActivityAccount for a given vault.
 * Returns null if the activity account does not exist.
 *
 * RPC transport errors are not caught here for the same reason as
 * fetchVaultAccount — callers must see the exception to handle retries
 * correctly rather than treating a network failure as a missing account.
 */
export async function fetchActivityAccount(
  connection: Connection,
  program: Program<LegacyVault>,
  vaultPubkey: PublicKey,
): Promise<OnChainActivityAccount | null> {
  const [activityPda] = deriveActivityPda(program.programId, vaultPubkey);
  const account = await program.account.activityAccount.fetchNullable(activityPda);
  return account as OnChainActivityAccount | null;
}

// ── Batch reconciliation ──────────────────────────────────────────────────────

/**
 * Reconciles the local database record for a single vault against the current
 * on-chain state. Updates the local record if the on-chain lastCheckInSlot has
 * moved forward (i.e., the owner checked in between poll cycles).
 *
 * Returns the updated VaultRecord, or null if the vault no longer exists
 * on-chain (was closed by the owner) or has completed its lifecycle.
 *
 * Throws on RPC transport errors — the caller (reconcileAllVaults) wraps
 * this in Promise.allSettled and keeps the stale record in the active set
 * so monitoring continues without interruption on transient failures.
 */
export async function reconcileVault(
  connection: Connection,
  program: Program<LegacyVault>,
  localRecord: VaultRecord,
  currentSlot: bigint,
): Promise<VaultRecord | null> {
  const vaultPubkey = new PublicKey(localRecord.vaultAddress);

  const [onChainVault, onChainActivity] = await Promise.all([
    fetchVaultAccount(connection, program, vaultPubkey),
    fetchActivityAccount(connection, program, vaultPubkey),
  ]);

  // The vault account has been closed on-chain. Remove from active monitoring.
  if (!onChainVault) {
    logger.info(
      { vault: localRecord.vaultAddress },
      "Vault account no longer exists on-chain — removing from watch list",
    );
    return null;
  }

  // Skip vaults that have already completed their lifecycle. These do not
  // need ongoing monitoring.
  if (
    onChainVault.isTriggered ||
    onChainVault.isClaimed ||
    onChainVault.isEmergencySwept
  ) {
    logger.info(
      { vault: localRecord.vaultAddress, state: deriveVaultState(onChainVault) },
      "Vault lifecycle complete — removing from active monitoring",
    );
    return null;
  }

  // Detect a fresh check-in: the on-chain lastCheckInSlot has advanced past
  // what we recorded in the previous poll cycle.
  const onChainLastCheckIn = onChainVault.lastCheckInSlot;
  const localLastCheckIn   = BigInt(localRecord.lastCheckInSlot);

  if (onChainLastCheckIn > localLastCheckIn) {
    logger.info(
      {
        vault:        localRecord.vaultAddress,
        previousSlot: localRecord.lastCheckInSlot,
        newSlot:      onChainLastCheckIn.toString(),
      },
      "Owner checked in — resetting inactivity clock",
    );
  }

  // Build the updated local record from on-chain truth.
  const updated: VaultRecord = {
    ...localRecord,
    lastCheckInSlot:          onChainLastCheckIn.toString(),
    inactivityThresholdSlots: onChainVault.inactivityThresholdSlots.toString(),
    beneficiary:              onChainVault.beneficiary.toBase58(),
    guardianCount:            onChainVault.guardianCount,
    mOfNThreshold:            onChainVault.mOfNThreshold,
    depositedLamports:        onChainVault.depositedLamports.toString(),
    warning75Sent:            onChainVault.warning75Sent,
    warning90Sent:            onChainVault.warning90Sent,
    lastPolledSlot:           currentSlot.toString(),
    // Carry over the activity model from on-chain.
    checkinCount:             onChainActivity?.checkinCount.toString()   ?? "0",
    sumOfIntervals:           onChainActivity?.sumOfIntervals.toString() ?? "0",
    anomalyFlagged:           onChainActivity?.anomalyFlagged            ?? false,
  };

  // Persist the updated record. upsertVault is synchronous — no await needed.
  getStore().upsertVault(updated);

  return updated;
}

/**
 * Loads all vaults registered in the local database and reconciles each one
 * against the current on-chain state in parallel, up to pollConcurrency
 * simultaneous RPC calls.
 *
 * Returns a struct containing:
 *   active      — records still under active monitoring after this cycle
 *   deactivated — count of vaults removed from monitoring this cycle
 *
 * Vault-level reconciliation errors (thrown by reconcileVault on RPC failure)
 * are captured by Promise.allSettled. A failed vault keeps its stale local
 * record in the active set so monitoring resumes on the next cycle.
 */
export async function reconcileAllVaults(
  connection: Connection,
  program: Program<LegacyVault>,
  currentSlot: bigint,
  pollConcurrency: number,
): Promise<{ active: VaultRecord[]; deactivated: number }> {
  const store  = getStore();
  const vaults = store.getAllActiveVaults();

  logger.info({ count: vaults.length }, "Reconciling vault states");

  // Process vaults in concurrent batches of `pollConcurrency` to avoid
  // bursting all RPC calls simultaneously. This caps the peak RPC call rate
  // and prevents rate-limit errors on private RPC nodes.
  const active: VaultRecord[] = [];
  let deactivated = 0;

  for (let i = 0; i < vaults.length; i += pollConcurrency) {
    const batch = vaults.slice(i, i + pollConcurrency);

    const results = await Promise.allSettled(
      batch.map((v) => reconcileVault(connection, program, v, currentSlot)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const vault  = batch[j];

      if (result.status === "rejected") {
        logger.error(
          { vault: vault.vaultAddress, reason: result.reason },
          "Reconciliation failed for vault — will retry next cycle",
        );
        // Keep the stale local record in rotation so we retry next cycle.
        active.push(vault);
        continue;
      }

      if (result.value !== null) {
        active.push(result.value);
      } else {
        // Vault is gone or lifecycle complete — deactivate in DB.
        try {
          store.deactivateVault(vault.vaultAddress);
          deactivated++;
        } catch (err) {
          logger.error(
            { vault: vault.vaultAddress, err },
            "Failed to deactivate vault in DB — will retry next cycle",
          );
          // Keep in active set so it is tried again next cycle.
          active.push(vault);
        }
      }
    }
  }

  return { active, deactivated };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable state string for logging purposes only.
 */
function deriveVaultState(vault: OnChainVaultAccount): string {
  if (vault.isClaimed)        return "claimed";
  if (vault.isEmergencySwept) return "emergency_swept";
  if (vault.isTriggered)      return "triggered";
  return "active";
}
