// sdk/src/math.ts
//
// Off-chain mathematics with exact BigInt parity to the on-chain Rust.
// Every function here must produce identical results to its counterpart in
// math/activity_score.rs and math/threshold_calc.rs. If these diverge, the
// watcher fires alerts at the wrong time and the SDK incorrectly predicts
// when trigger_inheritance will succeed.
//
// All arithmetic uses BigInt (not Number) to match Rust's u64 semantics.
// JavaScript Number is a 64-bit float and silently loses precision for integers
// above 2^53. Solana slot numbers exceed 2^53 in production — using Number
// for slot arithmetic introduces systematic errors.
//
// Operation order matters. Multiply before dividing everywhere to minimise
// integer truncation loss. The comments cite the Rust source so deviations
// are immediately visible during review.

import { ActivityZone, ThresholdMilestones, VaultInactivityState, VaultAccount } from "./types";

// ── Protocol constants — must match constants.rs exactly ──────────────────────

export const DEFAULT_INACTIVITY_THRESHOLD_SLOTS = 5_000_000n;
export const MIN_INACTIVITY_THRESHOLD_SLOTS     = 432_000n;
export const MAX_INACTIVITY_THRESHOLD_SLOTS     = 157_680_000n;
export const GUARDIAN_REMOVAL_TIMELOCK_SLOTS    = 216_000n;
export const BENEFICIARY_CHANGE_TIMELOCK_SLOTS  = 432_000n;
export const EMERGENCY_SWEEP_TIMELOCK_SLOTS     = 0n;
export const GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS = 0n;
export const ANOMALY_MULTIPLIER_PCT             = 150n;
export const WARNING_SLOT_PCT_75                = 75n;
export const WARNING_SLOT_PCT_90                = 90n;
export const MAX_GUARDIANS                      = 10;
export const MAX_COVENANT_SIGNERS               = 10;

// ── Core math functions ───────────────────────────────────────────────────────

/**
 * Computes the inactivity score as an integer percentage.
 * Score = (elapsed × 100) / threshold — multiply before divide.
 *
 * Mirrors compute_inactivity_score() in math/activity_score.rs exactly.
 * Returns 0n for clock regression (currentSlot <= lastCheckInSlot) and for
 * a zero threshold (configuration error).
 */
export function computeInactivityScore(
  currentSlot:             bigint,
  lastCheckInSlot:         bigint,
  inactivityThresholdSlots: bigint,
): bigint {
  if (inactivityThresholdSlots === 0n) return 0n;
  if (currentSlot <= lastCheckInSlot) return 0n;

  const elapsed = currentSlot - lastCheckInSlot;
  // Multiply first, then divide — matches the Rust impl exactly.
  return (elapsed * 100n) / inactivityThresholdSlots;
}

/**
 * Maps an inactivity score to the named ActivityZone.
 * Thresholds match classify_zone() in math/activity_score.rs exactly.
 */
export function classifyZone(score: bigint): ActivityZone {
  if (score < WARNING_SLOT_PCT_75) return ActivityZone.Green;
  if (score < WARNING_SLOT_PCT_90) return ActivityZone.Yellow;
  if (score < 100n)                return ActivityZone.Orange;
  return ActivityZone.Red;
}

/**
 * Computes the three absolute milestone slot numbers for a vault.
 * Mirrors compute_milestones() in math/threshold_calc.rs exactly.
 *
 * Returned slots are absolute (not relative offsets) so callers compare
 * them directly against the current clock slot.
 */
export function computeMilestones(
  lastCheckInSlot:         bigint,
  inactivityThresholdSlots: bigint,
): ThresholdMilestones {
  // Compute the offset first (threshold × pct / 100), then add the anchor slot.
  // This is the same order as the Rust implementation.
  const offset75 = (inactivityThresholdSlots * WARNING_SLOT_PCT_75) / 100n;
  const offset90 = (inactivityThresholdSlots * WARNING_SLOT_PCT_90) / 100n;

  return {
    warning75Slot: lastCheckInSlot + offset75,
    warning90Slot: lastCheckInSlot + offset90,
    triggerSlot:   lastCheckInSlot + inactivityThresholdSlots,
  };
}

/**
 * Returns true if the vault's inactivity threshold has been crossed.
 * Mirrors threshold_crossed() in math/threshold_calc.rs exactly.
 *
 * This is the exact condition the on-chain program checks in trigger_inheritance.
 * Callers can use this to predict whether a trigger transaction will succeed
 * without submitting a real transaction.
 */
export function thresholdCrossed(
  currentSlot:             bigint,
  lastCheckInSlot:         bigint,
  inactivityThresholdSlots: bigint,
): boolean {
  const triggerSlot = lastCheckInSlot + inactivityThresholdSlots;
  return currentSlot >= triggerSlot;
}

/**
 * Returns true if the current silence is anomalous relative to the owner's
 * historical check-in average.
 *
 * Mirrors is_anomalous() in math/activity_score.rs exactly.
 * Condition: elapsed > (sum_of_intervals × ANOMALY_MULTIPLIER_PCT) / checkin_count / 100
 *
 * The multiply-before-divide order is critical — see the Rust source for the
 * full explanation of why dividing first introduces systematic negative bias.
 */
export function isAnomalous(
  currentSlot:    bigint,
  lastCheckInSlot: bigint,
  checkinCount:   bigint,
  sumOfIntervals: bigint,
): boolean {
  if (checkinCount === 0n || sumOfIntervals === 0n) return false;
  if (currentSlot <= lastCheckInSlot) return false;

  const elapsed = currentSlot - lastCheckInSlot;

  // Mirror the Rust operation order: multiply sum by multiplier first, then
  // divide by checkinCount, then divide by 100 to convert out of pct-space.
  const anomalyThreshold =
    (sumOfIntervals * ANOMALY_MULTIPLIER_PCT) / checkinCount / 100n;

  return elapsed > anomalyThreshold;
}

/**
 * Computes the full inactivity state for a vault record and a current slot.
 * Bundles all math into one call so the UI doesn't make redundant computations.
 *
 * The Pick only constrains the two fields this function actually reads —
 * lastCheckInSlot and inactivityThresholdSlots — so any object carrying
 * those fields (VaultAccount, a partial record, a test stub) is accepted
 * without requiring unused fields in the call site.
 */
export function computeVaultInactivityState(
  vault:       Pick<VaultAccount, "lastCheckInSlot" | "inactivityThresholdSlots">,
  currentSlot: bigint,
): VaultInactivityState {
  const lastCheckInSlot         = vault.lastCheckInSlot;
  const inactivityThresholdSlots = vault.inactivityThresholdSlots;

  const elapsedSlots = currentSlot > lastCheckInSlot
    ? currentSlot - lastCheckInSlot
    : 0n;

  const score      = computeInactivityScore(currentSlot, lastCheckInSlot, inactivityThresholdSlots);
  const zone       = classifyZone(score);
  const milestones = computeMilestones(lastCheckInSlot, inactivityThresholdSlots);

  return { score, zone, elapsedSlots, milestones };
}

/**
 * Returns the approximate wall-clock seconds until the trigger slot based
 * on Solana's ~2 slots/second production rate. For display only — never
 * use this for on-chain decisions.
 */
export function estimateSecondsToTrigger(
  currentSlot: bigint,
  triggerSlot: bigint,
): number {
  if (currentSlot >= triggerSlot) return 0;
  const remaining = triggerSlot - currentSlot;
  return Number(remaining) / 2; // ~2 slots per second
}
