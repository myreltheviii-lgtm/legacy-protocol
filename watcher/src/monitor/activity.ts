// watcher/src/monitor/activity.ts
//
// Responsible for fetching each registered vault's live on-chain state and
// reconciling it with the local database record.
//
// Cloak integration notes:
//   - The watcher CANNOT see the shielded balance by design. utxo_commitment
//     proves a deposit exists; the amount is private.
//   - beneficiary_utxo_pubkey is stored as hex — not a Solana Pubkey.
//     The watcher logs it but does NOT resolve it to an address.
//   - Inactivity score computation is unchanged — based on slots, not balances.
//   - Shielded detection uses depositedLamports === 0n. utxoCommitment is
//     NOT used for shielded state derivation in the watcher context.

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { VaultRecord } from "../types/watcher";
import { getStore } from "../db/store";
import { logger } from "../logger";

// ── On-chain account shapes ───────────────────────────────────────────────────

export interface OnChainVaultAccount {
  owner:                    PublicKey;
  /** 32-byte Cloak UTXO pubkey as a number array. NOT a Solana wallet address. */
  beneficiaryUtxoPubkey:    number[];
  guardianCount:            number;
  mOfNThreshold:            number;
  inactivityThresholdSlots: bigint;
  lastCheckInSlot:          bigint;
  createdSlot:              bigint;
  depositedLamports:        bigint;
  covenantCounter:          bigint;
  vaultIndex:               bigint;
  /** Poseidon commitment as a number array (32 bytes). All zeros = not shielded. */
  utxoCommitment:           number[];
  utxoLeafIndex:            bigint;
  isTriggered:              boolean;
  isClaimed:                boolean;
  isEmergencySwept:         boolean;
  warning75Sent:            boolean;
  warning90Sent:            boolean;
  bump:                     number;
}

export interface OnChainActivityAccount {
  vault:              PublicKey;
  checkinCount:       bigint;
  sumOfIntervals:     bigint;
  lastInterval:       bigint;
  anomalyFlagged:     boolean;
  anomalyFlaggedSlot: bigint;
  bump:               number;
}

// ── Seeds must exactly match constants.rs ─────────────────────────────────────

const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");

// ── PDA derivation helpers ────────────────────────────────────────────────────

export function deriveVaultPda(
  programId:  PublicKey,
  owner:      PublicKey,
  vaultIndex: bigint,
): [PublicKey, number] {
  const indexBytes = Buffer.alloc(8);
  indexBytes.writeBigUInt64LE(vaultIndex);
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), indexBytes],
    programId,
  );
}

export function deriveActivityPda(
  programId:   PublicKey,
  vaultPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ACTIVITY_SEED, vaultPubkey.toBuffer()],
    programId,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts a number array (32 bytes) to a lowercase hex string. */
function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns true when the vault's SOL has been moved into the Cloak shielded
 * pool. Shielded detection uses depositedLamports === 0n — utxoCommitment
 * is not used for this determination in the watcher context.
 */
function isShielded(account: OnChainVaultAccount): boolean {
  return account.depositedLamports === 0n;
}

// ── Account fetching ──────────────────────────────────────────────────────────

export async function fetchVaultAccount(
  connection: Connection,
  program:    Program<any>,
  vaultPubkey: PublicKey,
): Promise<OnChainVaultAccount | null> {
  const account = await (program.account as any).vaultAccount.fetchNullable(vaultPubkey);
  return account as OnChainVaultAccount | null;
}

export async function fetchActivityAccount(
  connection:  Connection,
  program:     Program<any>,
  vaultPubkey: PublicKey,
): Promise<OnChainActivityAccount | null> {
  const [activityPda] = deriveActivityPda(program.programId, vaultPubkey);
  const account = await (program.account as any).activityAccount.fetchNullable(activityPda);
  return account as OnChainActivityAccount | null;
}

// ── Batch reconciliation ──────────────────────────────────────────────────────

export async function reconcileVault(
  connection:   Connection,
  program:      Program<any>,
  localRecord:  VaultRecord,
  currentSlot:  bigint,
): Promise<VaultRecord | null> {
  const vaultPubkey = new PublicKey(localRecord.vaultAddress);

  const [onChainVault, onChainActivity] = await Promise.all([
    fetchVaultAccount(connection, program, vaultPubkey),
    fetchActivityAccount(connection, program, vaultPubkey),
  ]);

  if (!onChainVault) {
    logger.info(
      { vault: localRecord.vaultAddress },
      "Vault account no longer exists on-chain — removing from watch list",
    );
    return null;
  }

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

  // Log Cloak shielding status. Shielded detection is lamport-based; the
  // utxoCommitment is logged as informational metadata only, not used for
  // the detection decision.
  if (isShielded(onChainVault)) {
    logger.debug(
      {
        vault:          localRecord.vaultAddress,
        utxoCommitment: bytesToHex(onChainVault.utxoCommitment),
        utxoLeafIndex:  onChainVault.utxoLeafIndex.toString(),
      },
      "Vault is shielded — balance hidden by design",
    );
  }

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

  // beneficiary_utxo_pubkey is stored as hex. We do NOT attempt to convert it
  // to a Solana wallet address because for shielded vaults it is a Cloak UTXO
  // pubkey on a different curve.
  const beneficiaryHex = bytesToHex(onChainVault.beneficiaryUtxoPubkey);

  const updated: VaultRecord = {
    ...localRecord,
    lastCheckInSlot:          onChainLastCheckIn.toString(),
    inactivityThresholdSlots: onChainVault.inactivityThresholdSlots.toString(),
    beneficiary:              beneficiaryHex,
    guardianCount:            onChainVault.guardianCount,
    mOfNThreshold:            onChainVault.mOfNThreshold,
    depositedLamports:        onChainVault.depositedLamports.toString(),
    warning75Sent:            onChainVault.warning75Sent,
    warning90Sent:            onChainVault.warning90Sent,
    lastPolledSlot:           currentSlot.toString(),
    checkinCount:             onChainActivity?.checkinCount.toString()   ?? "0",
    sumOfIntervals:           onChainActivity?.sumOfIntervals.toString() ?? "0",
    anomalyFlagged:           onChainActivity?.anomalyFlagged            ?? false,
  };

  getStore().upsertVault(updated);

  return updated;
}

export async function reconcileAllVaults(
  connection:      Connection,
  program:         Program<any>,
  currentSlot:     bigint,
  pollConcurrency: number,
): Promise<{ active: VaultRecord[]; deactivated: number }> {
  const store  = getStore();
  const vaults = store.getAllActiveVaults();

  logger.info({ count: vaults.length }, "Reconciling vault states");

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
        active.push(vault);
        continue;
      }

      if (result.value !== null) {
        active.push(result.value);
      } else {
        try {
          store.deactivateVault(vault.vaultAddress);
          deactivated++;
        } catch (err) {
          logger.error(
            { vault: vault.vaultAddress, err },
            "Failed to deactivate vault in DB — will retry next cycle",
          );
          active.push(vault);
        }
      }
    }
  }

  return { active, deactivated };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function deriveVaultState(vault: OnChainVaultAccount): string {
  if (vault.isClaimed)        return "claimed";
  if (vault.isEmergencySwept) return "emergency_swept";
  if (vault.isTriggered)      return "triggered";
  return "active";
}
