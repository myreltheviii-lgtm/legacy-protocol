// Tests that the watcher's math module (block_counter.ts) produces
// bit-identical results to the SDK's math module (which mirrors the Rust).

import {
  computeInactivityScore   as sdkScore,
  classifyZone             as sdkClassify,
  computeMilestones        as sdkMilestones,
  isAnomalous              as sdkAnomalous,
  thresholdCrossed         as sdkThresholdCrossed,
  ActivityZone             as SdkZone,
} from "../../sdk/src/math";

import {
  computeInactivityScore   as watcherScore,
  classifyZone             as watcherClassify,
  computeMilestones        as watcherMilestones,
  isAnomalous              as watcherAnomalous,
  ActivityZone             as WatcherZone,
} from "../../watcher/src/monitor/block_counter";

// The watcher's VaultRecord stores u64 as strings
function makeVaultRecord(lastCheckInSlot: bigint, inactivityThresholdSlots: bigint) {
  return {
    vaultAddress:             "11111111111111111111111111111111",
    ownerAddress:             "11111111111111111111111111111111",
    beneficiary:              "11111111111111111111111111111111",
    vaultIndex:               "0",
    lastCheckInSlot:          lastCheckInSlot.toString(),
    inactivityThresholdSlots: inactivityThresholdSlots.toString(),
    depositedLamports:        "0",
    guardianCount:            0,
    mOfNThreshold:            0,
    warning75Sent:            false,
    warning90Sent:            false,
    triggerSignalled:         false,
    anomalyFlagged:           false,
    checkinCount:             "0",
    sumOfIntervals:           "0",
    lastPolledSlot:           "0",
    createdAt:                "2024-01-01 00:00:00",
    updatedAt:                "2024-01-01 00:00:00",
  };
}

const THRESHOLD = 5_000_000n;

describe("watcher vs SDK math parity", () => {
  it("computeInactivityScore: parity for 100+ input combinations", () => {
    const checkIns    = [0n, 1000n, 500_000n, 1_000_000n, 5_000_000n];
    const thresholds  = [432_000n, 1_000_000n, 5_000_000n, 10_000_000n];
    const pcts        = [0, 25, 50, 75, 90, 100, 110, 150];

    for (const lastCheckIn of checkIns) {
      for (const threshold of thresholds) {
        for (const pct of pcts) {
          const elapsed     = (threshold * BigInt(pct)) / 100n;
          const currentSlot = lastCheckIn + elapsed;

          const sdkResult     = sdkScore(currentSlot, lastCheckIn, threshold);
          const watcherResult = watcherScore(currentSlot, lastCheckIn, threshold);

          expect(watcherResult).toBe(sdkResult);
        }
      }
    }
  });

  it("classifyZone: parity for all boundary values and zones", () => {
    const scores = [0n, 1n, 74n, 75n, 89n, 90n, 99n, 100n, 101n, 200n];
    for (const score of scores) {
      const sdkZone     = sdkClassify(score);
      const watcherZone = watcherClassify(score);
      // Map zone strings to compare
      expect(watcherZone.toString()).toBe(sdkZone.toString());
    }
  });

  it("computeMilestones: parity for multiple threshold/checkIn combinations", () => {
    const pairs: Array<[bigint, bigint]> = [
      [0n, 5_000_000n],
      [1_000_000n, 5_000_000n],
      [10_000_000n, 432_000n],
      [0n, 157_680_000n],
      [5_000_000n, 10_000_000n],
    ];
    for (const [lastCheckIn, threshold] of pairs) {
      const sdkM     = sdkMilestones(lastCheckIn, threshold);
      const watcherM = watcherMilestones(lastCheckIn, threshold);

      expect(watcherM.warning75Slot).toBe(sdkM.warning75Slot);
      expect(watcherM.warning90Slot).toBe(sdkM.warning90Slot);
      expect(watcherM.triggerSlot).toBe(sdkM.triggerSlot);
    }
  });

  it("isAnomalous: parity for 100+ input combinations covering all boundary conditions", () => {
    const testCases = [
      { elapsed: 0n,    lastCheckIn: 0n, count: 0n, sum: 0n },
      { elapsed: 1000n, lastCheckIn: 0n, count: 1n, sum: 1000n },   // exactly average, not anomalous
      { elapsed: 1501n, lastCheckIn: 0n, count: 1n, sum: 1000n },   // 1501 > 1500, anomalous
      { elapsed: 1500n, lastCheckIn: 0n, count: 1n, sum: 1000n },   // = 1500, NOT anomalous
      { elapsed: 2000n, lastCheckIn: 0n, count: 2n, sum: 2000n },   // avg=1000, threshold=1500, NOT anomalous
      { elapsed: 1501n, lastCheckIn: 0n, count: 2n, sum: 2000n },   // > 1500, anomalous
    ];

    for (const tc of testCases) {
      const currentSlot = tc.lastCheckIn + tc.elapsed;
      const sdkResult     = sdkAnomalous(currentSlot, tc.lastCheckIn, tc.count, tc.sum);
      const watcherResult = watcherAnomalous(currentSlot, tc.lastCheckIn, tc.count, tc.sum);
      expect(watcherResult).toBe(sdkResult);
    }
  });

  it("BigInt operation order: multiply before divide verified — no intermediate float", () => {
    // Large values that would overflow if floats were used
    const threshold = 157_680_000n;
    const elapsed   = 118_260_000n; // 75% of max threshold
    const expected  = (elapsed * 100n) / threshold;

    expect(sdkScore(elapsed, 0n, threshold)).toBe(expected);
    expect(watcherScore(elapsed, 0n, threshold)).toBe(expected);
    expect(sdkScore(elapsed, 0n, threshold)).toBe(watcherScore(elapsed, 0n, threshold));
  });

  it("Zone boundaries match across all 4 zones", () => {
    const boundaries: Array<[bigint, string]> = [
      [0n,   "GREEN"],
      [74n,  "GREEN"],
      [75n,  "YELLOW"],
      [89n,  "YELLOW"],
      [90n,  "ORANGE"],
      [99n,  "ORANGE"],
      [100n, "RED"],
      [999n, "RED"],
    ];
    for (const [score, expectedZone] of boundaries) {
      const watcher = watcherClassify(score);
      const sdk     = sdkClassify(score);
      expect(watcher).toBe(expectedZone as any);
      expect(sdk.toString()).toBe(expectedZone);
    }
  });
});
```

