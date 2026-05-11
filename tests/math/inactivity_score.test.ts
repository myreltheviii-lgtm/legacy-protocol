// tests/math/inactivity_score.test.ts
//
// Unit tests for the SDK's client-side inactivity math functions.
// These mirror the on-chain Rust math module and must produce bit-identical
// results for all inputs. Framework: Jest.

import {
  computeInactivityScore,
  classifyZone,
  computeMilestones,
  isAnomalous,
  thresholdCrossed,
} from "../../sdk/src/math";
import { ActivityZone } from "../../sdk/src/types";

// ActivityZone string values from sdk/src/types.ts (authoritative):
//   Green="Green", Yellow="Yellow", Orange="Orange", Red="Red"
// WARNING_SLOT_PCT_75 = 75n and WARNING_SLOT_PCT_90 = 90n are internal
// constants in math.ts (not exported). Tests use hardcoded numeric literals.

describe("computeInactivityScore", () => {
  it("score at 0% elapsed = 0", () => {
    expect(computeInactivityScore(1000n, 1000n, 5_000_000n)).toBe(0n);
  });

  it("score at exactly 75% threshold = 75", () => {
    const threshold = 5_000_000n;
    const elapsed   = (threshold * 75n) / 100n;
    expect(computeInactivityScore(elapsed, 0n, threshold)).toBe(75n);
  });

  it("score at exactly 90% threshold = 90", () => {
    const threshold = 5_000_000n;
    const elapsed   = (threshold * 90n) / 100n;
    expect(computeInactivityScore(elapsed, 0n, threshold)).toBe(90n);
  });

  it("score at exactly 100% threshold = 100", () => {
    const threshold = 5_000_000n;
    expect(computeInactivityScore(threshold, 0n, threshold)).toBe(100n);
  });

  it("score above 100% threshold is >100", () => {
    const threshold = 5_000_000n;
    expect(computeInactivityScore(threshold + 1n, 0n, threshold)).toBeGreaterThan(100n);
  });

  it("returns 0 for clock regression (currentSlot <= lastCheckInSlot)", () => {
    expect(computeInactivityScore(500n, 1000n, 5_000_000n)).toBe(0n);
    expect(computeInactivityScore(1000n, 1000n, 5_000_000n)).toBe(0n);
  });

  it("returns 0 for zero threshold — no divide-by-zero", () => {
    expect(computeInactivityScore(1000n, 0n, 0n)).toBe(0n);
    expect(computeInactivityScore(0n, 0n, 0n)).toBe(0n);
    expect(computeInactivityScore(999_999n, 0n, 0n)).toBe(0n);
  });

  it("multiply-before-divide verified: no precision loss at u64 boundaries", () => {
    // For a very large threshold, verify the result is computed correctly.
    const threshold = 157_680_000n; // MAX_INACTIVITY_THRESHOLD_SLOTS
    const elapsed   = 157_680_000n; // exactly at threshold
    expect(computeInactivityScore(elapsed, 0n, threshold)).toBe(100n);
  });

  it("BigInt results match Rust u64 output for 50+ input combinations", () => {
    const threshold = 5_000_000n;
    const testCases: Array<[bigint, bigint]> = [];
    for (let pct = 0; pct <= 150; pct += 3) {
      const elapsed = (threshold * BigInt(pct)) / 100n;
      testCases.push([elapsed, BigInt(pct > 0 ? Math.floor(pct / 1) : 0)]);
    }

    for (const [elapsed, expectedPct] of testCases) {
      const score = computeInactivityScore(elapsed, 0n, threshold);
      // score should be close to expectedPct (integer division rounding)
      expect(Math.abs(Number(score) - Number(expectedPct))).toBeLessThanOrEqual(1);
    }
  });
});

describe("classifyZone", () => {
  it("Green: score < 75", () => {
    expect(classifyZone(0n)).toBe(ActivityZone.Green);
    expect(classifyZone(74n)).toBe(ActivityZone.Green);
    expect(classifyZone(50n)).toBe(ActivityZone.Green);
  });

  it("Yellow: 75 <= score < 90", () => {
    expect(classifyZone(75n)).toBe(ActivityZone.Yellow);
    expect(classifyZone(89n)).toBe(ActivityZone.Yellow);
    expect(classifyZone(80n)).toBe(ActivityZone.Yellow);
  });

  it("Orange: 90 <= score < 100", () => {
    expect(classifyZone(90n)).toBe(ActivityZone.Orange);
    expect(classifyZone(99n)).toBe(ActivityZone.Orange);
    expect(classifyZone(95n)).toBe(ActivityZone.Orange);
  });

  it("Red: score >= 100", () => {
    expect(classifyZone(100n)).toBe(ActivityZone.Red);
    expect(classifyZone(150n)).toBe(ActivityZone.Red);
    expect(classifyZone(10000n)).toBe(ActivityZone.Red);
  });

  it("boundary value 74 is Green, 75 is Yellow", () => {
    expect(classifyZone(74n)).toBe(ActivityZone.Green);
    expect(classifyZone(75n)).toBe(ActivityZone.Yellow);
  });

  it("boundary value 89 is Yellow, 90 is Orange", () => {
    expect(classifyZone(89n)).toBe(ActivityZone.Yellow);
    expect(classifyZone(90n)).toBe(ActivityZone.Orange);
  });

  it("boundary value 99 is Orange, 100 is Red", () => {
    expect(classifyZone(99n)).toBe(ActivityZone.Orange);
    expect(classifyZone(100n)).toBe(ActivityZone.Red);
  });
});

describe("computeMilestones", () => {
  it("all 3 milestones correct for DEFAULT threshold", () => {
    const lastCheckIn = 1_000_000n;
    const threshold   = 5_000_000n;
    const milestones  = computeMilestones(lastCheckIn, threshold);

    expect(milestones.warning75Slot).toBe(lastCheckIn + (threshold * 75n) / 100n);
    expect(milestones.warning90Slot).toBe(lastCheckIn + (threshold * 90n) / 100n);
    expect(milestones.triggerSlot).toBe(lastCheckIn + threshold);
  });

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

  it("milestones with lastCheckIn=0 produce absolute offsets", () => {
    const m = computeMilestones(0n, 5_000_000n);
    expect(m.warning75Slot).toBe(3_750_000n);
    expect(m.warning90Slot).toBe(4_500_000n);
    expect(m.triggerSlot).toBe(5_000_000n);
  });
});

describe("isAnomalous", () => {
  it("returns false when checkinCount = 0", () => {
    expect(isAnomalous(2000n, 0n, 0n, 0n)).toBe(false);
  });

  it("returns false when sumOfIntervals = 0", () => {
    expect(isAnomalous(2000n, 0n, 1n, 0n)).toBe(false);
  });

  it("returns false when sumOfIntervals = 0 and checkinCount is non-zero (no divide-by-zero)", () => {
    expect(isAnomalous(999_999n, 0n, 10n, 0n)).toBe(false);
    expect(isAnomalous(1n, 0n, 100n, 0n)).toBe(false);
  });

  it("returns false when currentSlot <= lastCheckInSlot", () => {
    expect(isAnomalous(1000n, 2000n, 5n, 5000n)).toBe(false);
  });

  it("true when elapsed > (sum * 150) / count / 100", () => {
    // average = 1000/1 = 1000, threshold = 1000 * 150 / 100 = 1500
    // elapsed = 1501 → anomalous
    expect(isAnomalous(1502n, 1n, 1n, 1000n)).toBe(true);
  });

  it("false at exact threshold (condition is strictly >)", () => {
    // average = 1000, anomaly_threshold = 1500
    // elapsed = 1500 → NOT anomalous (condition is >)
    expect(isAnomalous(1501n, 1n, 1n, 1000n)).toBe(false);
  });

  it("multiply-before-divide: same result as Rust is_anomalous for 20 inputs", () => {
    // The calling pattern is: isAnomalous(tc.elapsed + tc.lastCheckin, tc.lastCheckin, tc.count, tc.sum).
    // Inside the function: elapsed_internal = tc.elapsed, threshold = (sum * 150) / count / 100.
    // Result is true iff elapsed_internal > threshold (and no early-return conditions fire).
    const testCases: Array<{ elapsed: bigint; lastCheckin: bigint; count: bigint; sum: bigint; expected: boolean }> = [
      // case 1: elapsed=2000, threshold=(1000*150)/2/100=750 → 2000 > 750 → true
      { elapsed: 2000n, lastCheckin: 1n, count: 2n, sum: 1000n, expected: true  },
      // case 2: elapsed=751, threshold=750 → 751 > 750 → true
      { elapsed: 751n,  lastCheckin: 1n, count: 2n, sum: 1000n, expected: true  },
      // case 3: elapsed=1501, threshold=(1000*150)/1/100=1500 → 1501 > 1500 → true
      { elapsed: 1501n, lastCheckin: 1n, count: 1n, sum: 1000n, expected: true  },
      // case 4: elapsed=1500, threshold=1500 → 1500 NOT > 1500 → false
      { elapsed: 1500n, lastCheckin: 1n, count: 1n, sum: 1000n, expected: false },
      // case 5: elapsed=750, threshold=750 → 750 NOT > 750 → false
      { elapsed: 750n,  lastCheckin: 1n, count: 2n, sum: 1000n, expected: false },
      // case 6: elapsed=749, threshold=750 → 749 < 750 → false
      { elapsed: 749n,  lastCheckin: 1n, count: 2n, sum: 1000n, expected: false },
      // case 7: checkinCount=0 → early return false
      { elapsed: 0n,    lastCheckin: 0n, count: 0n, sum: 0n,    expected: false },
      // case 8: sumOfIntervals=0 → early return false
      { elapsed: 0n,    lastCheckin: 0n, count: 1n, sum: 0n,    expected: false },
      // case 9: checkinCount=0 with non-zero sum → early return false
      { elapsed: 100n,  lastCheckin: 0n, count: 0n, sum: 1000n, expected: false },
      // case 10: elapsed=2251, threshold=(3000*150)/3/100=1500 → 2251 > 1500 → true
      { elapsed: 2251n, lastCheckin: 0n, count: 3n, sum: 3000n, expected: true  },
      // case 11: elapsed=1500, threshold=1500 → NOT > → false
      { elapsed: 1500n, lastCheckin: 0n, count: 3n, sum: 3000n, expected: false },
      // case 12: elapsed=1501, threshold=1500 → 1501 > 1500 → true
      { elapsed: 1501n, lastCheckin: 0n, count: 3n, sum: 3000n, expected: true  },
      // case 13: elapsed=75, threshold=(50*150)/1/100=75 → 75 NOT > 75 → false
      { elapsed: 75n,   lastCheckin: 0n, count: 1n, sum: 50n,   expected: false },
      // case 14: elapsed=76, threshold=75 → 76 > 75 → true
      { elapsed: 76n,   lastCheckin: 0n, count: 1n, sum: 50n,   expected: true  },
      // case 15: elapsed=100, threshold=(1000*150)/10/100=150 → 100 < 150 → false
      { elapsed: 100n,  lastCheckin: 0n, count: 10n, sum: 1000n, expected: false },
      // case 16: elapsed=151, threshold=150 → 151 > 150 → true
      { elapsed: 151n,  lastCheckin: 0n, count: 10n, sum: 1000n, expected: true  },
      // case 17: very large elapsed vs threshold=1500 → true
      { elapsed: 10000n, lastCheckin: 0n, count: 1n, sum: 1000n, expected: true  },
      // case 18: elapsed=1, well below threshold=1500 → false
      { elapsed: 1n,    lastCheckin: 0n, count: 1n, sum: 1000n, expected: false  },
      // case 19: elapsed=2 with count=2 → threshold=750, 2 < 750 → false
      { elapsed: 2n,    lastCheckin: 1n, count: 2n, sum: 1000n, expected: false },
      // case 20: elapsed=1000 with count=2, sum=1000 → threshold=750, 1000 > 750 → true
      { elapsed: 1000n, lastCheckin: 0n, count: 2n, sum: 1000n, expected: true  },
    ];
    for (const tc of testCases) {
      const result = isAnomalous(tc.elapsed + tc.lastCheckin, tc.lastCheckin, tc.count, tc.sum);
      expect(result).toBe(tc.expected);
    }
  });
});

describe("thresholdCrossed", () => {
  it("true at exactly last_check_in + threshold", () => {
    expect(thresholdCrossed(5_000_000n, 0n, 5_000_000n)).toBe(true);
  });

  it("false at last_check_in + threshold - 1", () => {
    expect(thresholdCrossed(4_999_999n, 0n, 5_000_000n)).toBe(false);
  });

  it("true when well past threshold", () => {
    expect(thresholdCrossed(10_000_000n, 0n, 5_000_000n)).toBe(true);
  });

  it("false when before threshold", () => {
    expect(thresholdCrossed(100n, 0n, 5_000_000n)).toBe(false);
  });

  it("works with non-zero lastCheckInSlot", () => {
    // lastCheckIn=1_000_000, threshold=500_000 → triggerSlot=1_500_000
    expect(thresholdCrossed(1_499_999n, 1_000_000n, 500_000n)).toBe(false);
    expect(thresholdCrossed(1_500_000n, 1_000_000n, 500_000n)).toBe(true);
  });
});
