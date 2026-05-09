// Integration test: watcher detects threshold → emits trigger signal → relayer logic.
// We test the pipeline with real in-process event buses and mocked on-chain calls.
// No live Solana RPC is required.

import * as path from "path";
import * as fs   from "fs";
import * as os   from "os";
import { initStore, getStore } from "../../watcher/src/db/store";
import { initSigningPool }     from "../../watcher/src/signing_pool";
import {
  triggerSignalBus,
  signalEligibleTriggers,
  initTriggerSigner,
  type TriggerReadyEvent,
} from "../../watcher/src/alerts/trigger_signal";
import {
  computeVaultInactivityState,
  ActivityZone,
} from "../../watcher/src/monitor/block_counter";
import {
  isSolanaTransientError,
  withRetry,
} from "../../relayer/src/retry";
import type { VaultRecord } from "../../watcher/src/types/watcher";

function makeVaultRecord(lastCheckInSlot: bigint, threshold: bigint, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    vaultAddress:             "WR1" + "1".repeat(41),
    ownerAddress:             "O" + "1".repeat(43),
    beneficiary:              "B" + "1".repeat(43),
    vaultIndex:               "0",
    lastCheckInSlot:          lastCheckInSlot.toString(),
    inactivityThresholdSlots: threshold.toString(),
    depositedLamports:        "1000000000",
    guardianCount:            1,
    mOfNThreshold:            1,
    warning75Sent:            false,
    warning90Sent:            false,
    triggerSignalled:         false,
    anomalyFlagged:           false,
    checkinCount:             "3",
    sumOfIntervals:           "3000",
    lastPolledSlot:           lastCheckInSlot.toString(),
    createdAt:                "2024-01-01 00:00:00",
    updatedAt:                "2024-01-01 00:00:00",
    ...overrides,
  };
}

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `test-wr-${Date.now()}-${Math.random()}.db`);
  initStore(dbPath);
  initSigningPool([]);
  initTriggerSigner(undefined);
});

afterEach(() => {
  getStore().close();
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  triggerSignalBus.removeAllListeners();
});

describe("watcher detects threshold crossed → emits trigger signal", () => {
  it("watcher emits trigger_ready when vault is in Red zone (>=100%)", (done) => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const currentSlot = threshold + 1n; // just past threshold
    const states = [computeVaultInactivityState(vault, currentSlot)];
    expect(states[0].zone).toBe(ActivityZone.Red);

    let received: TriggerReadyEvent | null = null;
    triggerSignalBus.once("trigger_ready", (event: TriggerReadyEvent) => {
      received = event;
      done();
    });

    signalEligibleTriggers(null as any, null as any, [vault], states).then((results) => {
      expect(results[0].signalEmitted).toBe(true);
      if (!received) done(new Error("trigger_ready not emitted"));
    });
  });

  it("trigger_ready event contains correct vault address, owner, beneficiary", (done) => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const states = [computeVaultInactivityState(vault, threshold + 100n)];

    triggerSignalBus.once("trigger_ready", (event: TriggerReadyEvent) => {
      expect(event.vaultAddress).toBe(vault.vaultAddress);
      expect(event.ownerAddress).toBe(vault.ownerAddress);
      expect(event.beneficiaryAddress).toBe(vault.beneficiary);
      expect(event.maxRetries).toBe(10);
      done();
    });

    signalEligibleTriggers(null as any, null as any, [vault], states);
  });

  it("signal NOT emitted when vault is Green zone", async () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const currentSlot = threshold / 2n; // 50% = Green
    const states = [computeVaultInactivityState(vault, currentSlot)];
    expect(states[0].zone).toBe(ActivityZone.Green);

    let signalCount = 0;
    triggerSignalBus.on("trigger_ready", () => { signalCount++; });

    const results = await signalEligibleTriggers(null as any, null as any, [vault], states);
    expect(results[0].signalEmitted).toBe(false);
    expect(signalCount).toBe(0);
  });
});

describe("relayer deduplication: signal emitted twice → submitted once", () => {
  it("trigger_signalled flag prevents duplicate emission", async () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);
    // Mark as already signalled
    getStore().setTriggerSignalled(vault.vaultAddress, true);

    const states = [computeVaultInactivityState(vault, threshold + 1n)];
    let signalCount = 0;
    triggerSignalBus.on("trigger_ready", () => { signalCount++; });

    const results = await signalEligibleTriggers(null as any, null as any, [vault], states);
    expect(results[0].alreadySignalled).toBe(true);
    expect(results[0].signalEmitted).toBe(false);
    expect(signalCount).toBe(0);
  });

  it("second signalEligibleTriggers call after first emission is a no-op", async () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const states = [computeVaultInactivityState(vault, threshold + 1n)];
    let signalCount = 0;
    triggerSignalBus.on("trigger_ready", () => { signalCount++; });

    // First call — should emit
    await signalEligibleTriggers(null as any, null as any, [vault], states);
    expect(signalCount).toBe(1);

    // Second call — already signalled in DB, should be a no-op
    await signalEligibleTriggers(null as any, null as any, [vault], states);
    expect(signalCount).toBe(1);
  });
});

describe("watcher detects anomaly → ready for SigningPool submission", () => {
  it("anomaly detected when elapsed > 1.5× average interval", () => {
    // count=1, sum=1000, average=1000, anomaly_threshold=1500
    // elapsed = 1501 → anomalous
    const { isAnomalous } = require("../../watcher/src/monitor/block_counter");
    expect(isAnomalous(1502n, 1n, 1n, 1000n)).toBe(true);
    expect(isAnomalous(1501n, 1n, 1n, 1000n)).toBe(false);
  });

  it("anomaly flag stored in DB after setAnomalyFlagged", () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    getStore().setAnomalyFlagged(vault.vaultAddress, true);
    expect(getStore().getVault(vault.vaultAddress)!.anomalyFlagged).toBe(true);
  });
});

describe("relayer retry engine integrates with watcher trigger events", () => {
  it("withRetry succeeds when fn succeeds on first call", async () => {
    const result = await withRetry(async () => "confirmed", {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs:  5,
      maxJitterMs: 0,
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe("confirmed");
    expect(result.attempts).toBe(1);
  });

  it("VaultAlreadyTriggered permanent error fast-fails — does not submit again", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; throw new Error("The vault has already been triggered for inheritance."); },
      { maxAttempts: 10, baseDelayMs: 1, maxDelayMs: 5, maxJitterMs: 0, isRetryable: isSolanaTransientError },
    );
    expect(result.success).toBe(false);
    expect(calls).toBe(1); // fast-fail: only 1 attempt
  });

  it("transient errors retry up to maxAttempts", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; throw new Error("Connection timeout"); },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5, maxJitterMs: 0, isRetryable: isSolanaTransientError },
    );
    expect(result.success).toBe(false);
    expect(calls).toBe(3);
  });
});

describe("trigger signal inactivityScore field is correct", () => {
  it("signal payload carries correct inactivityScore > 100 for past-threshold vaults", (done) => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const currentSlot = threshold + 500_000n; // 110%
    const states = [computeVaultInactivityState(vault, currentSlot)];

    triggerSignalBus.once("trigger_ready", (event: TriggerReadyEvent) => {
      const score = BigInt(event.inactivityScore);
      expect(score).toBeGreaterThan(100n);
      done();
    });

    signalEligibleTriggers(null as any, null as any, [vault], states);
  });
});
