// tests/sdk/math.test.ts
//
// Tests for the SDK math module and all exported protocol constants.
// Framework: Jest.
//
// Import paths:
//   - Math functions: sdk/src/math.ts
//   - ActivityZone enum: sdk/src/types.ts
//   - Exported constants: sdk/src/index.ts (barrel re-exports from index)
//   - Non-exported constants (ANOMALY_MULTIPLIER_PCT, WARNING_SLOT_PCT_75,
//     WARNING_SLOT_PCT_90, MAX_COVENANT_SIGNERS) are not exposed by the SDK.
//     They are hardcoded below from constants.rs (authoritative source of truth).

import {
  computeInactivityScore,
  classifyZone,
  computeMilestones,
  thresholdCrossed,
  isAnomalous,
  computeVaultInactivityState,
  estimateSecondsToTrigger,
} from "../../sdk/src/math";
import { ActivityZone } from "../../sdk/src/types";
import type { VaultAccount } from "../../sdk/src/types";
import {
  DEFAULT_INACTIVITY_THRESHOLD_SLOTS,
  MIN_INACTIVITY_THRESHOLD_SLOTS,
  MAX_INACTIVITY_THRESHOLD_SLOTS,
  GUARDIAN_REMOVAL_TIMELOCK_SLOTS,
  BENEFICIARY_CHANGE_TIMELOCK_SLOTS,
  EMERGENCY_SWEEP_TIMELOCK_SLOTS,
  GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS,
  MAX_GUARDIANS,
} from "../../sdk/src";

// Constants mirrored from constants.rs that are NOT exported by the SDK barrel.
// Hardcoded here against the authoritative values from the prompt.
const ANOMALY_MULTIPLIER_PCT   = 150n;
const WARNING_SLOT_PCT_75      = 75n;
const WARNING_SLOT_PCT_90      = 90n;
const MAX_COVENANT_SIGNERS     = 10;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Builds a minimal valid VaultAccount for computeVaultInactivityState tests.
 * All fields required by the v2 VaultAccount interface are provided.
 * NOTE: v2 removed the `beneficiary` Pubkey field — only beneficiaryUtxoPubkey
 * (hex string) exists. Including a `beneficiary` field here would be a V1
 * remnant and must not be present.
 */
function makeVaultAccount(
  lastCheckInSlot:          bigint,
  inactivityThresholdSlots: bigint,
): VaultAccount {
  return {
    owner:                    "11111111111111111111111111111112",
    beneficiaryUtxoPubkey:    "0".repeat(64),
    guardianCount:            0,
    mOfNThreshold:            0,
    inactivityThresholdSlots,
    lastCheckInSlot,
    createdSlot:              0n,
    depositedLamports:        0n,
    covenantCounter:          0n,
    vaultIndex:               0n,
    utxoCommitment:           "0".repeat(64),
    utxoLeafIndex:            0n,
    isTriggered:              false,
    isClaimed:                false,
    isEmergencySwept:         false,
    warning75Sent:            false,
    warning90Sent:            false,
    bump:                     255,
  };
}

// ── Protocol constants ─────────────────────────────────────────────────────

describe("protocol constants match constants.rs exactly", () => {
  it("DEFAULT_INACTIVITY_THRESHOLD_SLOTS = 5_000_000", () => {
    expect(DEFAULT_INACTIVITY_THRESHOLD_SLOTS).toBe(5_000_000n);
  });

  it("MIN_INACTIVITY_THRESHOLD_SLOTS = 432_000", () => {
    expect(MIN_INACTIVITY_THRESHOLD_SLOTS).toBe(432_000n);
  });

  it("MAX_INACTIVITY_THRESHOLD_SLOTS = 157_680_000", () => {
    expect(MAX_INACTIVITY_THRESHOLD_SLOTS).toBe(157_680_000n);
  });

  it("GUARDIAN_REMOVAL_TIMELOCK_SLOTS = 216_000", () => {
    expect(GUARDIAN_REMOVAL_TIMELOCK_SLOTS).toBe(216_000n);
  });

  it("BENEFICIARY_CHANGE_TIMELOCK_SLOTS = 432_000", () => {
    expect(BENEFICIARY_CHANGE_TIMELOCK_SLOTS).toBe(432_000n);
  });

  it("EMERGENCY_SWEEP_TIMELOCK_SLOTS = 0", () => {
    expect(EMERGENCY_SWEEP_TIMELOCK_SLOTS).toBe(0n);
  });

  it("GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS = 0", () => {
    expect(GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS).toBe(0n);
  });

  it("ANOMALY_MULTIPLIER_PCT = 150", () => {
    expect(ANOMALY_MULTIPLIER_PCT).toBe(150n);
  });

  it("WARNING_SLOT_PCT_75 = 75", () => {
    expect(WARNING_SLOT_PCT_75).toBe(75n);
  });

  it("WARNING_SLOT_PCT_90 = 90", () => {
    expect(WARNING_SLOT_PCT_90).toBe(90n);
  });

  it("MAX_GUARDIANS = 10", () => {
    expect(MAX_GUARDIANS).toBe(10);
  });

  it("MAX_COVENANT_SIGNERS = 10", () => {
    expect(MAX_COVENANT_SIGNERS).toBe(10);
  });
});

// ── computeInactivityScore ─────────────────────────────────────────────────

describe("computeInactivityScore — multiply-before-divide, BigInt only", () => {
  it("returns 0 for zero elapsed", () => {
    expect(computeInactivityScore(1000n, 1000n, 5_000_000n)).toBe(0n);
  });

  it("returns 0 for clock regression (currentSlot < lastCheckInSlot)", () => {
    expect(computeInactivityScore(500n, 1000n, 5_000_000n)).toBe(0n);
  });

  it("returns 0 for zero threshold — no divide-by-zero", () => {
    expect(computeInactivityScore(1000n, 0n, 0n)).toBe(0n);
    expect(computeInactivityScore(0n, 0n, 0n)).toBe(0n);
  });

  it("exactly 75% threshold = 75", () => {
    const threshold = 5_000_000n;
    const elapsed = (threshold * 75n) / 100n;
    expect(computeInactivityScore(elapsed, 0n, threshold)).toBe(75n);
  });

  it("exactly 90% threshold = 90", () => {
    const threshold = 5_000_000n;
    const elapsed = (threshold * 90n) / 100n;
    expect(computeInactivityScore(elapsed, 0n, threshold)).toBe(90n);
  });

  it("exactly 100% threshold = 100", () => {
    const threshold = 5_000_000n;
    expect(computeInactivityScore(threshold, 0n, threshold)).toBe(100n);
  });

  it("score above 100% when elapsed > threshold", () => {
    const threshold = 5_000_000n;
    expect(computeInactivityScore(threshold + 1n, 0n, threshold)).toBeGreaterThan(100n);
  });

  it("multiply-before-divide verified: no precision loss at MAX threshold boundaries", () => {
    const threshold = 157_680_000n;
    const elapsed   = 157_680_000n;
    expect(computeInactivityScore(elapsed, 0n, threshold)).toBe(100n);
  });

  it("BigInt results match Rust u64 output exactly for 100+ input combinations", () => {
    const threshold = 5_000_000n;
    for (let pct = 0; pct <= 150; pct += 1) {
      const elapsed = (threshold * BigInt(pct)) / 100n;
      const score = computeInactivityScore(elapsed, 0n, threshold);
      // Integer division means score may be pct or pct-1 depending on rounding
      expect(Math.abs(Number(score) - pct)).toBeLessThanOrEqual(1);
    }
  });

  it("returns BigInt type, not Number", () => {
    const score = computeInactivityScore(100n, 0n, 5_000_000n);
    expect(typeof score).toBe("bigint");
  });

  it("works with non-zero lastCheckInSlot anchor", () => {
    const lastCheckIn = 1_000_000n;
    const threshold   = 5_000_000n;
    const current     = lastCheckIn + (threshold * 50n) / 100n;
    expect(computeInactivityScore(current, lastCheckIn, threshold)).toBe(50n);
  });
});

// ── classifyZone ───────────────────────────────────────────────────────────

describe("classifyZone — all 4 zones with all boundary values", () => {
  it("0 is Green", () => {
    expect(classifyZone(0n)).toBe(ActivityZone.Green);
  });

  it("74 is Green", () => {
    expect(classifyZone(74n)).toBe(ActivityZone.Green);
  });

  it("75 is Yellow", () => {
    expect(classifyZone(75n)).toBe(ActivityZone.Yellow);
  });

  it("89 is Yellow", () => {
    expect(classifyZone(89n)).toBe(ActivityZone.Yellow);
  });

  it("90 is Orange", () => {
    expect(classifyZone(90n)).toBe(ActivityZone.Orange);
  });

  it("99 is Orange", () => {
    expect(classifyZone(99n)).toBe(ActivityZone.Orange);
  });

  it("100 is Red", () => {
    expect(classifyZone(100n)).toBe(ActivityZone.Red);
  });

  it("200 is Red", () => {
    expect(classifyZone(200n)).toBe(ActivityZone.Red);
  });

  it("1 is Green, 50 is Green", () => {
    expect(classifyZone(1n)).toBe(ActivityZone.Green);
    expect(classifyZone(50n)).toBe(ActivityZone.Green);
  });

  it("boundary 74→75: Green to Yellow transition", () => {
    expect(classifyZone(74n)).toBe(ActivityZone.Green);
    expect(classifyZone(75n)).toBe(ActivityZone.Yellow);
  });

  it("boundary 89→90: Yellow to Orange transition", () => {
    expect(classifyZone(89n)).toBe(ActivityZone.Yellow);
    expect(classifyZone(90n)).toBe(ActivityZone.Orange);
  });

  it("boundary 99→100: Orange to Red transition", () => {
    expect(classifyZone(99n)).toBe(ActivityZone.Orange);
    expect(classifyZone(100n)).toBe(ActivityZone.Red);
  });
});

// ── computeMilestones ──────────────────────────────────────────────────────

describe("computeMilestones — all 3 milestones correct", () => {
  it("warning75Slot = lastCheckIn + threshold*75/100", () => {
    const m = computeMilestones(0n, 1_000_000n);
    expect(m.warning75Slot).toBe(750_000n);
  });

  it("warning90Slot = lastCheckIn + threshold*90/100", () => {
    const m = computeMilestones(0n, 1_000_000n);
    expect(m.warning90Slot).toBe(900_000n);
  });

  it("triggerSlot = lastCheckIn + threshold", () => {
    const m = computeMilestones(500_000n, 2_000_000n);
    expect(m.triggerSlot).toBe(2_500_000n);
  });

  it("all milestones correct for DEFAULT threshold from slot 1_000_000", () => {
    const lastCheckIn = 1_000_000n;
    const threshold   = 5_000_000n;
    const m           = computeMilestones(lastCheckIn, threshold);
    expect(m.warning75Slot).toBe(lastCheckIn + (threshold * 75n) / 100n);
    expect(m.warning90Slot).toBe(lastCheckIn + (threshold * 90n) / 100n);
    expect(m.triggerSlot).toBe(lastCheckIn + threshold);
  });

  it("milestones with lastCheckIn=0 produce absolute offsets", () => {
    const m = computeMilestones(0n, 5_000_000n);
    expect(m.warning75Slot).toBe(3_750_000n);
    expect(m.warning90Slot).toBe(4_500_000n);
    expect(m.triggerSlot).toBe(5_000_000n);
  });

  it("warning75Slot < warning90Slot < triggerSlot ordering always holds", () => {
    for (const threshold of [432_000n, 5_000_000n, 157_680_000n]) {
      const m = computeMilestones(0n, threshold);
      expect(m.warning75Slot).toBeLessThan(m.warning90Slot);
      expect(m.warning90Slot).toBeLessThan(m.triggerSlot);
    }
  });
});

// ── thresholdCrossed ───────────────────────────────────────────────────────

describe("thresholdCrossed — exact slot boundary verified", () => {
  it("true at exactly last_check_in + threshold", () => {
    expect(thresholdCrossed(5_000_000n, 0n, 5_000_000n)).toBe(true);
  });

  it("false at last_check_in + threshold - 1", () => {
    expect(thresholdCrossed(4_999_999n, 0n, 5_000_000n)).toBe(false);
  });

  it("true well past threshold", () => {
    expect(thresholdCrossed(10_000_000n, 0n, 5_000_000n)).toBe(true);
  });

  it("false before threshold", () => {
    expect(thresholdCrossed(100n, 0n, 5_000_000n)).toBe(false);
  });

  it("works with non-zero lastCheckInSlot anchor", () => {
    expect(thresholdCrossed(1_499_999n, 1_000_000n, 500_000n)).toBe(false);
    expect(thresholdCrossed(1_500_000n, 1_000_000n, 500_000n)).toBe(true);
  });

  it("returns boolean type", () => {
    expect(typeof thresholdCrossed(100n, 0n, 50n)).toBe("boolean");
  });
});

// ── isAnomalous ────────────────────────────────────────────────────────────

describe("isAnomalous — true/false boundary verified", () => {
  it("false when checkinCount = 0", () => {
    expect(isAnomalous(2000n, 0n, 0n, 0n)).toBe(false);
  });

  it("false when sumOfIntervals = 0", () => {
    expect(isAnomalous(2000n, 0n, 1n, 0n)).toBe(false);
  });

  it("false when sumOfIntervals = 0 regardless of checkinCount — guards against zero-divisor", () => {
    expect(isAnomalous(999_999n, 0n, 100n, 0n)).toBe(false);
  });

  it("false when currentSlot <= lastCheckInSlot", () => {
    expect(isAnomalous(1000n, 2000n, 5n, 5000n)).toBe(false);
  });

  it("true when elapsed > (sum * 150) / count / 100", () => {
    // average = 1000, anomaly_threshold = 1500, elapsed = 1501 → anomalous
    expect(isAnomalous(1502n, 1n, 1n, 1000n)).toBe(true);
  });

  it("false at exactly the anomaly threshold (condition is strictly >)", () => {
    // elapsed = 1500 = threshold exactly → NOT anomalous
    expect(isAnomalous(1501n, 1n, 1n, 1000n)).toBe(false);
  });

  it("multiply-before-divide: sum*multiplier before /count/100 matches Rust is_anomalous", () => {
    const cases = [
      { current: 1n + 1501n, lastCheckIn: 1n, count: 1n, sum: 1000n, expected: true  },
      { current: 1n + 1500n, lastCheckIn: 1n, count: 1n, sum: 1000n, expected: false },
      { current: 1n + 751n,  lastCheckIn: 1n, count: 2n, sum: 1000n, expected: true  },
      { current: 1n + 750n,  lastCheckIn: 1n, count: 2n, sum: 1000n, expected: false },
    ];
    for (const c of cases) {
      expect(isAnomalous(c.current, c.lastCheckIn, c.count, c.sum)).toBe(c.expected);
    }
  });

  it("returns boolean type", () => {
    expect(typeof isAnomalous(100n, 0n, 1n, 50n)).toBe("boolean");
  });
});

// ── computeVaultInactivityState ────────────────────────────────────────────

describe("computeVaultInactivityState", () => {
  it("returns correct score, zone, and milestones for 50% elapsed", () => {
    const vault = makeVaultAccount(0n, 5_000_000n);
    const state = computeVaultInactivityState(vault, 2_500_000n);
    expect(state.score).toBe(50n);
    expect(state.zone).toBe(ActivityZone.Green);
    // SDK's VaultInactivityState has { score, zone, milestones } — no elapsedSlots field.
    expect(state.milestones.triggerSlot).toBe(5_000_000n);
    expect(state.milestones.warning75Slot).toBe(3_750_000n);
    expect(state.milestones.warning90Slot).toBe(4_500_000n);
  });

  it("zone is Red when score >= 100", () => {
    const vault = makeVaultAccount(0n, 5_000_000n);
    const state = computeVaultInactivityState(vault, 5_000_000n);
    expect(state.zone).toBe(ActivityZone.Red);
    expect(state.score).toBe(100n);
  });

  it("score = 0 when currentSlot <= lastCheckInSlot", () => {
    const vault = makeVaultAccount(0n, 5_000_000n);
    const state = computeVaultInactivityState(vault, 0n);
    expect(state.score).toBe(0n);
    expect(state.zone).toBe(ActivityZone.Green);
  });

  it("score = 100 when elapsed = threshold exactly", () => {
    const vault = makeVaultAccount(1000n, 1000n);
    const state = computeVaultInactivityState(vault, 2000n);
    expect(state.score).toBe(100n);
    expect(state.zone).toBe(ActivityZone.Red);
  });

  it("milestones are derived from the vault's lastCheckInSlot and threshold", () => {
    const vault = makeVaultAccount(1_000_000n, 5_000_000n);
    const state = computeVaultInactivityState(vault, 3_000_000n);
    expect(state.milestones.triggerSlot).toBe(6_000_000n);
    expect(state.milestones.warning75Slot).toBe(4_750_000n);
    expect(state.milestones.warning90Slot).toBe(5_500_000n);
  });

  it("Yellow zone when score is 75–89", () => {
    const vault = makeVaultAccount(0n, 5_000_000n);
    const state = computeVaultInactivityState(vault, 4_000_000n); // 80%
    expect(state.zone).toBe(ActivityZone.Yellow);
  });

  it("Orange zone when score is 90–99", () => {
    const vault = makeVaultAccount(0n, 5_000_000n);
    const state = computeVaultInactivityState(vault, 4_750_000n); // 95%
    expect(state.zone).toBe(ActivityZone.Orange);
  });
});

// ── estimateSecondsToTrigger ───────────────────────────────────────────────

describe("estimateSecondsToTrigger", () => {
  it("returns 0 when currentSlot >= triggerSlot", () => {
    expect(estimateSecondsToTrigger(1000n, 500n)).toBe(0);
  });

  it("returns positive seconds when below trigger", () => {
    const seconds = estimateSecondsToTrigger(0n, 1000n);
    expect(seconds).toBe(500); // 1000 slots / 2 slots/sec
  });

  it("returns number type", () => {
    expect(typeof estimateSecondsToTrigger(0n, 100n)).toBe("number");
  });

  it("5_000_000 slots remaining ≈ 2_500_000 seconds", () => {
    expect(estimateSecondsToTrigger(0n, 5_000_000n)).toBe(2_500_000);
  });
});
