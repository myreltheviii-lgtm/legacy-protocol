// relayer/src/verify_threshold.ts
//
// Before the relayer submits trigger_inheritance, it re-reads the vault's
// on-chain state and re-runs the threshold calculation to confirm that the
// condition is still true. This pre-flight check exists because:
//
//   1. The watcher may have emitted the signal several seconds (or slots)
//      before the relayer processes it. The owner could have checked in during
//      that window, resetting the clock and making the trigger invalid.
//
//   2. Another relayer instance (or a third party) may have already submitted
//      trigger_inheritance for the same vault between the signal and this
//      relayer's attempt.
//
//   3. The vault may have been emergency-swept or closed by the owner since
//      the signal was emitted.
//
// Submitting a transaction that will fail on-chain wastes SOL on fees and
// creates noise in the relayer's retry logs. The pre-flight check is cheap
// (one RPC call) relative to the cost of a failed transaction.

import { Connection, PublicKey }  from "@solana/web3.js";
import { Program }                from "@coral-xyz/anchor";
import { LegacyVault }            from "./types/legacy_vault";
import { logger }                 from "./logger";

// ── Result type ───────────────────────────────────────────────────────────────

export enum PreflightStatus {
  /** The vault is past threshold and trigger_inheritance should be submitted. */
  ReadyToTrigger   = "READY_TO_TRIGGER",
  /** The owner checked in since the signal — vault is no longer past threshold. */
  OwnerCheckedIn   = "OWNER_CHECKED_IN",
  /** The vault has already been triggered by another party. */
  AlreadyTriggered = "ALREADY_TRIGGERED",
  /** The vault has already been claimed. */
  AlreadyClaimed   = "ALREADY_CLAIMED",
  /** The vault has already been emergency-swept. */
  AlreadySwept     = "ALREADY_SWEPT",
  /** The vault account no longer exists (closed by owner). */
  VaultGone        = "VAULT_GONE",
  /** The RPC call failed — the relayer should retry the pre-flight. */
  RpcError         = "RPC_ERROR",
}

export interface PreflightResult {
  status:       PreflightStatus;
  currentSlot:  bigint;
  /** Present when status === ReadyToTrigger. */
  elapsedSlots?: bigint;
  /** Present when status === ReadyToTrigger. */
  inactivityScore?: bigint;
  error?:       unknown;
}

// ── Main verification function ────────────────────────────────────────────────

/**
 * Fetches the current on-chain state of a vault and determines whether
 * trigger_inheritance is still valid to submit.
 *
 * @param vaultAddress    Base58-encoded vault PDA address.
 * @param ownerAddress    Base58-encoded owner pubkey (needed for PDA re-derivation).
 * @param vaultIndex      The vault index as a string (u64).
 *
 * The inactivity threshold is re-read from the on-chain vault account rather
 * than accepted as a parameter, because the owner may have changed it via
 * configure_threshold after the watcher emitted its signal. Using stale threshold
 * data could cause the relayer to submit a transaction that fails on-chain.
 */
export async function verifyTriggerPreflight(
  connection: Connection,
  program: Program<LegacyVault>,
  vaultAddress: string,
  ownerAddress: string,
  vaultIndex: string,
): Promise<PreflightResult> {
  let currentSlot: bigint;

  try {
    currentSlot = BigInt(await connection.getSlot("confirmed"));
  } catch (err) {
    logger.error({ err, vault: vaultAddress }, "Pre-flight: failed to fetch current slot");
    return { status: PreflightStatus.RpcError, currentSlot: 0n, error: err };
  }

  // Fetch the vault account directly using the Anchor program client.
  let vaultAccount: any;
  try {
    const vaultPubkey = new PublicKey(vaultAddress);
    vaultAccount = await program.account.vaultAccount.fetchNullable(vaultPubkey);
  } catch (err) {
    logger.error({ err, vault: vaultAddress }, "Pre-flight: failed to fetch vault account");
    return { status: PreflightStatus.RpcError, currentSlot, error: err };
  }

  // Vault no longer exists on-chain.
  if (!vaultAccount) {
    logger.warn({ vault: vaultAddress }, "Pre-flight: vault account gone");
    return { status: PreflightStatus.VaultGone, currentSlot };
  }

  // ── Lifecycle checks ──────────────────────────────────────────────────────
  // Check all terminal states before the threshold calculation so we fail
  // fast with a clear reason rather than computing an irrelevant score.

  if (vaultAccount.isClaimed) {
    logger.info({ vault: vaultAddress }, "Pre-flight: vault already claimed");
    return { status: PreflightStatus.AlreadyClaimed, currentSlot };
  }

  if (vaultAccount.isEmergencySwept) {
    logger.info({ vault: vaultAddress }, "Pre-flight: vault already emergency-swept");
    return { status: PreflightStatus.AlreadySwept, currentSlot };
  }

  if (vaultAccount.isTriggered) {
    // The vault was already triggered — either by another relayer instance or
    // by a third party calling trigger_inheritance directly. The beneficiary
    // can now call claim_inheritance without any further relayer action.
    logger.info({ vault: vaultAddress }, "Pre-flight: vault already triggered");
    return { status: PreflightStatus.AlreadyTriggered, currentSlot };
  }

  // ── Threshold check ───────────────────────────────────────────────────────
  // Use the on-chain lastCheckInSlot and inactivityThresholdSlots rather than
  // the values cached in the watcher signal. This catches the case where the
  // owner checked in (resetting lastCheckInSlot) after the signal was emitted.

  const lastCheckInSlot         = BigInt(vaultAccount.lastCheckInSlot.toString());
  const inactivityThresholdSlots = BigInt(vaultAccount.inactivityThresholdSlots.toString());

  const triggerSlot = lastCheckInSlot + inactivityThresholdSlots;

  if (currentSlot < triggerSlot) {
    // The threshold has not been crossed. The owner must have checked in
    // between the signal and this pre-flight.
    const elapsed = currentSlot - lastCheckInSlot;
    const score   = (elapsed * 100n) / inactivityThresholdSlots;

    logger.info(
      {
        vault:        vaultAddress,
        currentSlot:  currentSlot.toString(),
        triggerSlot:  triggerSlot.toString(),
        score:        score.toString(),
      },
      "Pre-flight: owner checked in since signal — threshold no longer crossed",
    );
    return { status: PreflightStatus.OwnerCheckedIn, currentSlot };
  }

  // All checks passed. The vault is ready to trigger.
  const elapsedSlots    = currentSlot - lastCheckInSlot;
  const inactivityScore = (elapsedSlots * 100n) / inactivityThresholdSlots;

  logger.info(
    {
      vault:          vaultAddress,
      currentSlot:    currentSlot.toString(),
      triggerSlot:    triggerSlot.toString(),
      elapsedSlots:   elapsedSlots.toString(),
      score:          inactivityScore.toString(),
    },
    "Pre-flight: vault confirmed ready to trigger",
  );

  return {
    status:          PreflightStatus.ReadyToTrigger,
    currentSlot,
    elapsedSlots,
    inactivityScore,
  };
}
