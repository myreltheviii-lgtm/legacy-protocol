// sdk/src/math.ts
//
// Client-side mirrors of the on-chain math functions in programs/legacy_vault/src/math/.
// These must produce results identical to their Rust counterparts for every input.

import type { VaultAccount, ActivityAccount, VaultInactivityState, ThresholdMilestones } from "./types";
import { ActivityZone } from "./types";

const WARNING_75 = 75n;
const WARNING_90 = 90n;
const ANOMALY_MULTIPLIER = 150n;

export function computeInactivityScore(
  currentSlot:             bigint,
  lastCheckInSlot:         bigint,
  inactivityThresholdSlots: bigint,
): bigint {
  if (inactivityThresholdSlots === 0n) return 0n;
  if (currentSlot <= lastCheckInSlot) return 0n;
  const elapsed = currentSlot - lastCheckInSlot;
  return (elapsed * 100n) / inactivityThresholdSlots;
}

export function classifyZone(score: bigint): ActivityZone {
  if (score < WARNING_75) return ActivityZone.Green;
  if (score < WARNING_90) return ActivityZone.Yellow;
  if (score < 100n)       return ActivityZone.Orange;
  return ActivityZone.Red;
}

export function computeMilestones(
  lastCheckInSlot:         bigint,
  inactivityThresholdSlots: bigint,
): ThresholdMilestones {
  const offset75 = (inactivityThresholdSlots * WARNING_75) / 100n;
  const offset90 = (inactivityThresholdSlots * WARNING_90) / 100n;
  return {
    warning75Slot: lastCheckInSlot + offset75,
    warning90Slot: lastCheckInSlot + offset90,
    triggerSlot:   lastCheckInSlot + inactivityThresholdSlots,
  };
}

export function isAnomalous(
  currentSlot:     bigint,
  lastCheckInSlot: bigint,
  checkinCount:    bigint,
  sumOfIntervals:  bigint,
): boolean {
  if (checkinCount === 0n || sumOfIntervals === 0n) return false;
  if (currentSlot <= lastCheckInSlot) return false;
  const elapsed = currentSlot - lastCheckInSlot;
  const threshold = (sumOfIntervals * ANOMALY_MULTIPLIER) / checkinCount / 100n;
  return elapsed > threshold;
}

export function thresholdCrossed(
  currentSlot:             bigint,
  lastCheckInSlot:         bigint,
  inactivityThresholdSlots: bigint,
): boolean {
  return currentSlot >= lastCheckInSlot + inactivityThresholdSlots;
}

export function computeVaultInactivityState(
  vault:       VaultAccount,
  currentSlot: bigint,
): VaultInactivityState {
  const score      = computeInactivityScore(currentSlot, vault.lastCheckInSlot, vault.inactivityThresholdSlots);
  const zone       = classifyZone(score);
  const milestones = computeMilestones(vault.lastCheckInSlot, vault.inactivityThresholdSlots);
  return { score, zone, milestones };
}

export function estimateSecondsToTrigger(currentSlot: bigint, triggerSlot: bigint): number {
  if (currentSlot >= triggerSlot) return 0;
  const slotsRemaining = Number(triggerSlot - currentSlot);
  return slotsRemaining / 2; // ~2 slots/second
}
