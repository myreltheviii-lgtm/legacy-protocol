// watcher/src/monitor/block_counter.ts
//
// The core mathematics of the watcher. Given a vault's last check-in slot,
// its configured threshold, and the current chain slot, this module computes:
//
//   1. The raw inactivity score (0–100+ as an integer percentage).
//   2. Which activity zone the vault is currently in (Green/Yellow/Orange/Red).
//   3. The absolute slot numbers for each progressive warning milestone.
//
// This module deliberately mirrors the math modules in the on-chain program
// (math/activity_score.rs and math/threshold_calc.rs). Both sides must agree
// exactly on all threshold calculations or the watcher will fire warnings at
// the wrong time and fail to trigger vaults that should be triggered.
//
// All arithmetic uses BigInt to match Rust's u64 semantics exactly. JavaScript
// Number is a 64-bit float and loses precision for slot values above 2^53.

import { VaultRecord } from "../types/watcher";
import { logger } from "../logger";

// ── Constants mirroring constants.rs ─────────────────────────────────────────
// These must be kept in sync with the on-chain program constants manually.
// If you change a constant in the Rust program, update it here too.
//
// Exported so alert modules (guardian_ping.ts, trigger_signal.ts) import the
// canonical value rather than re-declaring magic literals. A threshold change
// in constants.rs requires exactly one update here; everything else follows.

export const WARNING_SLOT_PCT_75    = 75n;
export const WARNING_SLOT_PCT_90    = 90n;
export const ANOMALY_MULTIPLIER_PCT = 150n; // 1.5× the historical average interval

// ── Zone classification ───────────────────────────────────────────────────────

export enum ActivityZone {
  /** 0–74%: Normal. Owner is checking in regularly. */
  Green  = "GREEN",
  /** 75–89%: Unusual silence. Guardian ping warranted. */
  Yellow = "YELLOW",
  /** 90–99%: Critical silence. Beneficiary warning warranted. */
  Orange = "ORANGE",
  /** 100%+: Threshold crossed. trigger_inheritance is callable. */
  Red    = "RED",
}

// ── Core data structure ───────────────────────────────────────────────────────

/**
 * All inactivity metrics for a single vault at a single point in time.
 * Computed once per poll cycle per vault and passed to the alert pipeline.
 */
export interface VaultInactivityState {
  /** The vault address this state belongs to. */
  vaultAddress: string;

  /** The slot number used as the basis for this computation. */
  computedAtSlot: bigint;

  /** Slots elapsed since the owner last checked in. */
  elapsedSlots: bigint;

  /**
   * Inactivity score as an integer percentage.
   * 0 = freshly checked in. 100 = exactly at threshold. >100 = past threshold.
   */
  score: bigint;

  /** Which zone the score falls into. */
  zone: ActivityZone;

  /** Absolute slot at which the 75% warning should fire. */
  warning75Slot: bigint;

  /** Absolute slot at which the 90% warning should fire. */
  warning90Slot: bigint;

  /** Absolute slot at which trigger_inheritance becomes callable. */
  triggerSlot: bigint;

  /** Whether the 75% warning has already been sent (from on-chain state). */
  warning75AlreadySent: boolean;

  /** Whether the 90% warning has already been sent (from on-chain state). */
  warning90AlreadySent: boolean;
}

// ── Score computation ─────────────────────────────────────────────────────────

/**
 * Computes the inactivity score for a vault.
 *
 * Score = (elapsed_slots / threshold_slots) × 100, using integer division.
 * Matches the on-chain formula in math/activity_score.rs exactly.
 *
 * Returns 0n if currentSlot <= lastCheckInSlot (clock regression guard).
 */
export function computeInactivityScore(
  currentSlot: bigint,
  lastCheckInSlot: bigint,
  inactivityThresholdSlots: bigint,
): bigint {
  if (currentSlot <= lastCheckInSlot) return 0n;
  if (inactivityThresholdSlots === 0n) return 0n;

  const elapsed = currentSlot - lastCheckInSlot;
  // Multiply before dividing to preserve precision without floating point.
  return (elapsed * 100n) / inactivityThresholdSlots;
}

/**
 * Maps an inactivity score to the named ActivityZone.
 * Thresholds match the Rust classify_zone() function exactly.
 */
export function classifyZone(score: bigint): ActivityZone {
  if (score < WARNING_SLOT_PCT_75) return ActivityZone.Green;
  if (score < WARNING_SLOT_PCT_90) return ActivityZone.Yellow;
  if (score < 100n)                return ActivityZone.Orange;
  return ActivityZone.Red;
}

// ── Milestone slot computation ────────────────────────────────────────────────

/**
 * Computes the three absolute milestone slot numbers for a vault.
 * Matches the on-chain compute_milestones() function in threshold_calc.rs.
 */
export function computeMilestones(
  lastCheckInSlot: bigint,
  inactivityThresholdSlots: bigint,
): { warning75Slot: bigint; warning90Slot: bigint; triggerSlot: bigint } {
  const offset75 = (inactivityThresholdSlots * WARNING_SLOT_PCT_75) / 100n;
  const offset90 = (inactivityThresholdSlots * WARNING_SLOT_PCT_90) / 100n;

  return {
    warning75Slot: lastCheckInSlot + offset75,
    warning90Slot: lastCheckInSlot + offset90,
    triggerSlot:   lastCheckInSlot + inactivityThresholdSlots,
  };
}

// ── Full state computation ────────────────────────────────────────────────────

/**
 * Computes the complete VaultInactivityState for a single vault record.
 * This is the primary function called by the poll loop — it bundles all
 * metrics into a single object so the alert pipeline has everything it needs
 * without making redundant calculations.
 */
export function computeVaultInactivityState(
  vault: VaultRecord,
  currentSlot: bigint,
): VaultInactivityState {
  const lastCheckInSlot         = BigInt(vault.lastCheckInSlot);
  const inactivityThresholdSlots = BigInt(vault.inactivityThresholdSlots);

  const elapsedSlots = currentSlot > lastCheckInSlot
    ? currentSlot - lastCheckInSlot
    : 0n;

  const score = computeInactivityScore(
    currentSlot,
    lastCheckInSlot,
    inactivityThresholdSlots,
  );

  const zone = classifyZone(score);

  const milestones = computeMilestones(lastCheckInSlot, inactivityThresholdSlots);

  return {
    vaultAddress:         vault.vaultAddress,
    computedAtSlot:       currentSlot,
    elapsedSlots,
    score,
    zone,
    warning75Slot:        milestones.warning75Slot,
    warning90Slot:        milestones.warning90Slot,
    triggerSlot:          milestones.triggerSlot,
    warning75AlreadySent: vault.warning75Sent,
    warning90AlreadySent: vault.warning90Sent,
  };
}

/**
 * Computes VaultInactivityState for all active vault records in a single pass.
 * Logs a summary of how many vaults fall into each zone.
 */
export function computeAllInactivityStates(
  vaults: VaultRecord[],
  currentSlot: bigint,
): VaultInactivityState[] {
  const states = vaults.map((v) => computeVaultInactivityState(v, currentSlot));

  // Zone summary for operational visibility.
  const summary = {
    [ActivityZone.Green]:  0,
    [ActivityZone.Yellow]: 0,
    [ActivityZone.Orange]: 0,
    [ActivityZone.Red]:    0,
  };
  for (const s of states) summary[s.zone]++;

  logger.info(
    { currentSlot: currentSlot.toString(), total: states.length, ...summary },
    "Inactivity zone summary",
  );

  return states;
}

// ── Anomaly detection ─────────────────────────────────────────────────────────

/**
 * Returns true if the current elapsed time is anomalous relative to the
 * owner's historical check-in average, even if the hard threshold has not
 * yet been reached.
 *
 * Mirrors is_anomalous() from math/activity_score.rs exactly.
 * Condition: elapsed > (sum_of_intervals / checkin_count) × 1.5
 */
export function isAnomalous(
  currentSlot: bigint,
  lastCheckInSlot: bigint,
  checkinCount: bigint,
  sumOfIntervals: bigint,
): boolean {
  if (checkinCount === 0n || sumOfIntervals === 0n) return false;
  if (currentSlot <= lastCheckInSlot)               return false;

  const elapsed = currentSlot - lastCheckInSlot;

  // Mirror the Rust computation order exactly:
  //   threshold = (sum_of_intervals × ANOMALY_MULTIPLIER_PCT) / checkin_count / 100
  //
  // Multiplying the sum by the percentage multiplier FIRST ensures the
  // subsequent integer divisions operate on the largest possible numerator,
  // minimising rounding loss. Dividing by checkin_count first (computing the
  // average before applying the multiplier) introduces a systematic negative
  // bias: the truncated average is smaller than the true value, so the derived
  // threshold is lower than intended and anomaly_flag fires prematurely.
  // The on-chain program uses this same multiply-first order (see
  // math/activity_score.rs is_anomalous) — both sides must agree or the
  // watcher will submit anomaly_flag transactions the program then rejects.
  const anomalyThreshold = (sumOfIntervals * ANOMALY_MULTIPLIER_PCT) / checkinCount / 100n;

  return elapsed > anomalyThreshold;
}

/**
 * Returns the estimated number of seconds remaining until the trigger slot,
 * based on Solana's approximate slot production rate of 2 slots per second.
 * Used only for human-readable log messages and notifications — never for
 * on-chain decisions.
 */
export function estimateSecondsToTrigger(
  currentSlot: bigint,
  triggerSlot: bigint,
): number {
  if (currentSlot >= triggerSlot) return 0;
  const slotsRemaining = triggerSlot - currentSlot;
  // ~2 slots per second on Solana mainnet; use 2 as a conservative estimate.
  return Number(slotsRemaining) / 2;
}
