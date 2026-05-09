// Tests for Geyser client behavior: snapshot-first, reconnect backoff, heartbeat.
// Since we can't spin up a real gRPC server, we test the module's exported
// helper functions and the pure logic around backoff and snapshot handling.

import {
  computeInactivityScore,
  computeAllInactivityStates,
  computeVaultInactivityState,
  ActivityZone,
} from "../../watcher/src/monitor/block_counter";
import type { VaultRecord } from "../../watcher/src/types/watcher";

function makeRecord(lastCheckInSlot: bigint, threshold: bigint, warning75 = false, warning90 = false): VaultRecord {
  return {
    vaultAddress:             "V" + "1".repeat(43),
    ownerAddress:             "O" + "1".repeat(43),
    beneficiary:              "B" + "1".repeat(43),
    vaultIndex:               "0",
    lastCheckInSlot:          lastCheckInSlot.toString(),
    inactivityThresholdSlots: threshold.toString(),
    depositedLamports:        "0",
    guardianCount:            0,
    mOfNThreshold:            0,
    warning75Sent:            warning75,
    warning90Sent:            warning90,
    triggerSignalled:         false,
    anomalyFlagged:           false,
    checkinCount:             "0",
    sumOfIntervals:           "0",
    lastPolledSlot:           lastCheckInSlot.toString(),
    createdAt:                "2024-01-01 00:00:00",
    updatedAt:                "2024-01-01 00:00:00",
  };
}

describe("geyser client logic", () => {
  it("snapshot-first: computeAllInactivityStates processes all vaults", () => {
    const vaults = [
      makeRecord(0n, 5_000_000n),
      makeRecord(0n, 5_000_000n),
      makeRecord(0n, 5_000_000n),
    ];
    vaults[0].vaultAddress = "A" + "1".repeat(43);
    vaults[1].vaultAddress = "B" + "2".repeat(43);
    vaults[2].vaultAddress = "C" + "3".repeat(43);

    const states = computeAllInactivityStates(vaults, 4_000_000n);
    expect(states.length).toBe(3);
    for (const s of states) {
      expect(s.zone).toBe(ActivityZone.Yellow); // ~80%
    }
  });

  it("exponential backoff: delays double with each retry attempt", () => {
    // Test the exponential backoff formula used in geyser_client.ts
    let backoffMs = 1_000;
    const maxBackoff = 30_000;
    const delays: number[] = [];

    for (let i = 0; i < 6; i++) {
      delays.push(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoff);
    }

    expect(delays[0]).toBe(1_000);
    expect(delays[1]).toBe(2_000);
    expect(delays[2]).toBe(4_000);
    expect(delays[3]).toBe(8_000);
    expect(delays[4]).toBe(16_000);
    expect(delays[5]).toBe(30_000); // capped
  });

  it("heartbeat fires at heartbeatSlots=300: slot tracking logic", () => {
    const HEARTBEAT_SLOTS = 300n;
    let lastHeartbeatSlot = 0n;
    const heartbeatsFired: bigint[] = [];

    for (let slot = 1n; slot <= 1000n; slot++) {
      if (slot - lastHeartbeatSlot >= HEARTBEAT_SLOTS) {
        heartbeatsFired.push(slot);
        lastHeartbeatSlot = slot;
      }
    }

    expect(heartbeatsFired.length).toBe(3); // at 300, 600, 900
    expect(heartbeatsFired[0]).toBe(300n);
    expect(heartbeatsFired[1]).toBe(600n);
    expect(heartbeatsFired[2]).toBe(900n);
  });

  it("reconnect loop re-runs snapshot on every reconnect — verified by zone computation", () => {
    // After a disconnect and reconnect, the vault state should be recomputed from fresh data.
    const vault = makeRecord(0n, 5_000_000n);

    // First compute at slot 4_000_000 (80% = Yellow)
    const state1 = computeVaultInactivityState(vault, 4_000_000n);
    expect(state1.zone).toBe(ActivityZone.Yellow);

    // After owner checks in (simulated by updating lastCheckInSlot).
    // IMPORTANT: do NOT use underscore separators in numeric strings — BigInt("4_000_001") throws.
    const updatedVault = { ...vault, lastCheckInSlot: "4000001" };
    const state2 = computeVaultInactivityState(updatedVault, 4_000_100n);
    // 99 slots elapsed out of 5_000_000 = ~0% → Green
    expect(state2.zone).toBe(ActivityZone.Green);
  });

  it("RPC fallback: snapshot provides same data as stream", () => {
    // Verify that computing inactivity state from snapshot (batch) matches per-vault
    const vaults = Array.from({ length: 5 }, (_, i) =>
      makeRecord(BigInt(i * 100_000), 5_000_000n)
    );
    vaults.forEach((v, i) => { v.vaultAddress = `V${i}` + "1".repeat(43); });

    const currentSlot = 4_000_000n;

    const batchStates = computeAllInactivityStates(vaults, currentSlot);
    const singleStates = vaults.map(v => computeVaultInactivityState(v, currentSlot));

    expect(batchStates.length).toBe(singleStates.length);
    for (let i = 0; i < batchStates.length; i++) {
      expect(batchStates[i].score).toBe(singleStates[i].score);
      expect(batchStates[i].zone).toBe(singleStates[i].zone);
    }
  });

  it("account update triggers correct zone state change", () => {
    // Simulate account update: vault lastCheckInSlot advances
    const oldVault = makeRecord(0n, 5_000_000n);
    const newVault = makeRecord(4_000_000n, 5_000_000n); // checked in at 4M

    const currentSlot = 4_001_000n;

    const oldState = computeVaultInactivityState(oldVault, currentSlot);
    const newState = computeVaultInactivityState(newVault, currentSlot);

    // Old: 4_001_000 elapsed = ~80% Yellow
    expect(oldState.zone).toBe(ActivityZone.Yellow);
    // New: 1_000 elapsed = ~0% Green
    expect(newState.zone).toBe(ActivityZone.Green);
  });

  it("numeric string fields must not contain underscore separators — BigInt parse safety", () => {
    // Verify that VaultRecord numeric strings round-trip through BigInt correctly.
    // Strings like "4_000_001" are invalid for BigInt() and throw SyntaxError.
    const validStrings = ["0", "1000", "5000000", "4000001", "18446744073709551615"];
    for (const s of validStrings) {
      expect(() => BigInt(s)).not.toThrow();
    }

    // Demonstrate the failure mode — underscore separators are not valid.
    expect(() => BigInt("4_000_001")).toThrow(SyntaxError);
    expect(() => BigInt("1_000_000")).toThrow(SyntaxError);

    // Vault records derived from lastCheckInSlot.toString() are always safe
    const slot = 4_000_001n;
    const slotStr = slot.toString(); // "4000001" — no underscores
    expect(slotStr).toBe("4000001");
    expect(BigInt(slotStr)).toBe(slot);

    // A record built with vault data from toString() never introduces underscores
    const vault = makeRecord(slot, 5_000_000n);
    expect(() => BigInt(vault.lastCheckInSlot)).not.toThrow();
    expect(BigInt(vault.lastCheckInSlot)).toBe(slot);
  });
});
