// watcher/src/monitor/anomaly.ts
//
// Drives the anomaly detection pipeline. This module sits above the raw math
// in block_counter.ts and makes operational decisions: which vaults need an
// anomaly flag submitted on-chain, which have already been flagged, and
// which guardians should be selected to submit the flag transaction.
//
// On-chain anomaly flags are submitted by an active guardian, not by the
// relayer, because the on-chain `anomaly_flag` instruction validates that
// the signer is a registered guardian. The watcher therefore selects a
// guardian keypair from its configured signing pool and submits on their
// behalf.
//
// Fee payer: the guardian keypair must be the transaction fee payer, not a
// shared read-only wallet. The anomaly_flag Accounts struct declares guardian
// as Signer<'info> without #[account(mut)], so the program itself does not
// write to the guardian account — but the Solana runtime must deduct fees from
// the fee payer, which requires the fee payer to be writable in the compiled
// transaction message. Using a separate provider-level wallet that has no SOL
// causes every submission to fail with InsufficientFunds. The fix is a
// per-submission AnchorProvider whose wallet IS the guardian keypair, making
// the guardian both the instruction signer and the fee payer in one account
// entry (web3.js automatically marks the fee payer as writable).
//
// QVAC integration (surgical addition):
//   When isAnomalous() returns true, the pipeline does NOT submit the flag
//   immediately. Instead:
//     1. querySimilarTriggered() queries the RAG store for historically
//        similar vaults that have triggered inheritance.
//     2. buildVaultBehavior() constructs the behavioral metadata struct.
//     3. analyzeVaultAnomaly() runs the LLM against the behavioral profile.
//     4. qvacResult.shouldAlert gates the flag submission — false means no
//        on-chain transaction is submitted regardless of the math result.
//   The AnomalyEvaluation return shape is preserved exactly.

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, Idl } from "@coral-xyz/anchor";
import { LegacyVault }     from "../types/legacy_vault";
import { VaultRecord }     from "../types/watcher";
import {
  VaultInactivityState,
  isAnomalous,
  ActivityZone,
} from "./block_counter";
import { getStore }        from "../db/store";
import { getSigningPool }  from "../signing_pool";
import { logger }          from "../logger";
import {
  analyzeVaultAnomaly,
  buildVaultBehavior,
} from "./qvac_anomaly";
import { querySimilarTriggered, SIMILARITY_THRESHOLD, TOP_K } from "./qvac_rag";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Represents the outcome of an anomaly evaluation for a single vault.
 */
export interface AnomalyEvaluation {
  vaultAddress: string;
  /** True if the on-chain anomaly_flag instruction was submitted this cycle. */
  flagSubmitted: boolean;
  /** True if the vault was already flagged in a prior cycle. */
  alreadyFlagged: boolean;
  /** True if the mathematical condition for anomaly was not met. */
  noAnomaly: boolean;
  /** Error message if the flag submission failed. */
  error?: string;
}

// ── Main evaluation loop ───────────────────────────────────────────────────────

/**
 * Evaluates all active vaults for anomalous silence and submits on-chain
 * `anomaly_flag` transactions for those that qualify.
 *
 * A vault qualifies for an anomaly flag when:
 *   1. Its silence exceeds ANOMALY_MULTIPLIER_PCT × historical average interval.
 *   2. It has not already been flagged on-chain (activity.anomalyFlagged == false).
 *   3. It has not yet reached the full inactivity threshold (still in Green/Yellow
 *      zone — if it is already Orange/Red, progressive warnings handle it).
 *   4. The QVAC LLM analysis returns shouldAlert: true for this behavioral pattern.
 *
 * Returns one AnomalyEvaluation per vault for upstream logging.
 */
export async function evaluateAllAnomalies(
  connection: Connection,
  program: Program<any>,
  vaults: VaultRecord[],
  states: VaultInactivityState[],
): Promise<AnomalyEvaluation[]> {
  // Build a map from vaultAddress → state for O(1) lookup.
  const stateMap = new Map<string, VaultInactivityState>(
    states.map((s) => [s.vaultAddress, s]),
  );

  const evaluations = await Promise.allSettled(
    vaults.map((vault) => {
      const state = stateMap.get(vault.vaultAddress);
      if (!state) {
        return Promise.resolve<AnomalyEvaluation>({
          vaultAddress:   vault.vaultAddress,
          flagSubmitted:  false,
          alreadyFlagged: false,
          noAnomaly:      true,
        });
      }
      return evaluateSingleAnomaly(connection, program, vault, state);
    }),
  );

  return evaluations.map((result, i) => {
    if (result.status === "rejected") {
      return {
        vaultAddress:   vaults[i].vaultAddress,
        flagSubmitted:  false,
        alreadyFlagged: false,
        noAnomaly:      false,
        error:          String(result.reason),
      };
    }
    return result.value;
  });
}

/**
 * Evaluates and optionally flags a single vault.
 *
 * QVAC gate: when isAnomalous() returns true, the RAG store is queried first
 * for similar triggered vaults, then the LLM analyses the behavioral profile.
 * Only if qvacResult.shouldAlert is true does flag submission proceed.
 */
async function evaluateSingleAnomaly(
  connection: Connection,
  program: Program<any>,
  vault: VaultRecord,
  state: VaultInactivityState,
): Promise<AnomalyEvaluation> {
  const base: Omit<AnomalyEvaluation, "flagSubmitted" | "alreadyFlagged" | "noAnomaly"> = {
    vaultAddress: vault.vaultAddress,
  };

  // Skip if the vault is already flagged on-chain. The flag is cleared by
  // the owner's next check-in, so we do not need to re-submit it.
  if (vault.anomalyFlagged) {
    return { ...base, flagSubmitted: false, alreadyFlagged: true, noAnomaly: false };
  }

  // Only flag vaults in the Green or Yellow zone. Orange/Red vaults are
  // handled by the guardian_ping and beneficiary_warn alert modules.
  if (state.zone === ActivityZone.Orange || state.zone === ActivityZone.Red) {
    return { ...base, flagSubmitted: false, alreadyFlagged: false, noAnomaly: true };
  }

  // Apply the same mathematical anomaly check as the on-chain program.
  const anomalous = isAnomalous(
    state.computedAtSlot,
    BigInt(vault.lastCheckInSlot),
    BigInt(vault.checkinCount),
    BigInt(vault.sumOfIntervals),
  );

  if (!anomalous) {
    return { ...base, flagSubmitted: false, alreadyFlagged: false, noAnomaly: true };
  }

  // Mathematical anomaly confirmed. Run the QVAC pipeline before submitting.
  //
  // Step 1: RAG lookup — query for behaviorally similar vaults that have
  // triggered inheritance. The vault address, similarity threshold, and topK
  // are passed explicitly so the RAG store can retrieve the vault's stored
  // behavioral profile and perform the cosine similarity search against the
  // corpus. Returns 0 if the vault has not yet been ingested.
  const similarTriggeredVaults = await querySimilarTriggered(
    vault.vaultAddress,
    SIMILARITY_THRESHOLD,
    TOP_K,
  );

  // Step 2: Build the full behavioral profile with the real RAG count.
  const behavior = buildVaultBehavior(vault, state, similarTriggeredVaults);

  // Step 3: LLM analysis — returns a validated QVACAnomalyResult.
  const qvacResult = await analyzeVaultAnomaly(vault, state, behavior);

  logger.warn(
    {
      vault:                 vault.vaultAddress,
      elapsedSlots:          state.elapsedSlots.toString(),
      checkinCount:          vault.checkinCount,
      sumOfIntervals:        vault.sumOfIntervals,
      similarTriggeredVaults,
      qvacRiskLevel:         qvacResult.riskLevel,
      qvacShouldAlert:       qvacResult.shouldAlert,
      qvacConfidence:        qvacResult.confidenceScore,
      qvacReasoning:         qvacResult.reasoning,
    },
    "Statistical anomaly detected — QVAC analysis complete",
  );

  // Step 4: QVAC gates flag submission. shouldAlert: false → no on-chain tx.
  if (!qvacResult.shouldAlert) {
    logger.info(
      { vault: vault.vaultAddress, riskLevel: qvacResult.riskLevel },
      "QVAC: shouldAlert false — suppressing on-chain anomaly flag",
    );
    return { ...base, flagSubmitted: false, alreadyFlagged: false, noAnomaly: false };
  }

  try {
    await submitAnomalyFlag(connection, program, vault);

    // Mark as flagged locally AFTER the on-chain transaction confirms so the
    // two sources of truth stay consistent. If the process crashes after the
    // on-chain write but before this line, the next reconciliation cycle will
    // read anomalyFlagged = true from on-chain and write it to the local DB,
    // preventing re-submission.
    getStore().setAnomalyFlagged(vault.vaultAddress, true);

    return { ...base, flagSubmitted: true, alreadyFlagged: false, noAnomaly: false };
  } catch (err) {
    logger.error(
      { vault: vault.vaultAddress, err },
      "Failed to submit anomaly_flag transaction",
    );
    return {
      ...base,
      flagSubmitted:  false,
      alreadyFlagged: false,
      noAnomaly:      false,
      error:          String(err),
    };
  }
}

// ── On-chain transaction builder ──────────────────────────────────────────────

/**
 * Selects a guardian signer from the watcher's signing pool and submits
 * the `anomaly_flag` instruction on-chain.
 *
 * The guardian keypair is used as the AnchorProvider wallet so it acts as
 * BOTH the instruction signer (required by the on-chain Signer<'info>
 * constraint) AND the transaction fee payer. Solana's runtime requires the
 * fee payer to be writable in the compiled transaction message — @solana/web3.js
 * automatically marks the feePayer as writable regardless of how the account
 * appears in individual instruction account metas. Using a separate shared
 * read-only wallet (a randomly generated keypair with no SOL) as the provider
 * causes every submission to fail with InsufficientFunds because that wallet
 * has no lamports to pay fees.
 */
async function submitAnomalyFlag(
  connection: Connection,
  program: Program<any>,
  vault: VaultRecord,
): Promise<void> {
  const signingPool = getSigningPool();

  // Select the guardian keypair that is registered for this vault.
  const guardianKeypair = signingPool.getGuardianForVault(vault.vaultAddress);
  if (!guardianKeypair) {
    throw new Error(
      `No guardian keypair available in signing pool for vault ${vault.vaultAddress}`,
    );
  }

  const vaultPubkey    = new PublicKey(vault.vaultAddress);
  const guardianPubkey = guardianKeypair.publicKey;

  // Derive the guardian account PDA for this (vault, guardian) pair.
  const [guardianAccountPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("guardian"),
      vaultPubkey.toBuffer(),
      guardianPubkey.toBuffer(),
    ],
    program.programId,
  );

  // Derive the activity account PDA.
  const [activityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("activity"), vaultPubkey.toBuffer()],
    program.programId,
  );

  // Build a per-submission provider whose wallet IS the guardian keypair.
  // This guarantees the guardian is the fee payer and the instruction signer
  // in the same account entry — @solana/web3.js marks the feePayer writable
  // automatically when compiling the transaction message, satisfying the
  // runtime's requirement that the fee payer account be writable even though
  // the on-chain program declares guardian as Signer<'info> without mut.
  const guardianWallet   = new Wallet(guardianKeypair);
  const guardianProvider = new AnchorProvider(connection, guardianWallet, {
    commitment: "confirmed",
  });
  const guardianProgram = new Program<any>(
    { ...program.idl, address: program.programId.toBase58(), metadata: { name: "legacy_vault", version: "0.1.0", spec: "0.1.0" } } as any,
    guardianProvider,
  ) as Program<any>;

  // Build and send the transaction using the guardian-scoped program client.
  const tx = await (guardianProgram as any).methods
    .anomalyFlag()
    .accounts({
      guardian:        guardianPubkey,
      vault:           vaultPubkey,
      guardianAccount: guardianAccountPda,
      activity:        activityPda,
    })
    .rpc({ commitment: "confirmed" });

  logger.info(
    { vault: vault.vaultAddress, tx, guardian: guardianPubkey.toBase58() },
    "anomaly_flag transaction confirmed",
  );
}
