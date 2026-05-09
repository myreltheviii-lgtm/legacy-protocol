import * as path from "path";
import * as fs   from "fs";
import * as os   from "os";
import { EventEmitter } from "events";
import { initStore, getStore } from "../../watcher/src/db/store";
import {
  guardianAlertBus,
  sendGuardianPingsForEligibleVaults,
  type GuardianPingEvent,
} from "../../watcher/src/alerts/guardian_ping";
import {
  beneficiaryAlertBus,
  sendBeneficiaryWarningsForEligibleVaults,
  type BeneficiaryWarnEvent,
} from "../../watcher/src/alerts/beneficiary_warn";
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
import type { VaultRecord } from "../../watcher/src/types/watcher";

function makeVaultRecord(lastCheckInSlot: bigint, threshold: bigint, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    vaultAddress:             "V1" + "1".repeat(42),
    ownerAddress:             "O" + "1".repeat(43),
    beneficiary:              "B" + "1".repeat(43),
    vaultIndex:               "0",
    lastCheckInSlot:          lastCheckInSlot.toString(),
    inactivityThresholdSlots: threshold.toString(),
    depositedLamports:        "1000000000",
    guardianCount:            2,
    mOfNThreshold:            2,
    warning75Sent:            false,
    warning90Sent:            false,
    triggerSignalled:         false,
    anomalyFlagged:           false,
    checkinCount:             "5",
    sumOfIntervals:           "5000",
    lastPolledSlot:           lastCheckInSlot.toString(),
    createdAt:                "2024-01-01 00:00:00",
    updatedAt:                "2024-01-01 00:00:00",
    ...overrides,
  };
}

let dbPath: string;
beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `test-alerts-${Date.now()}.db`);
  initStore(dbPath);
  initTriggerSigner(undefined); // no signing in tests
});
afterEach(() => {
  getStore().close();
  [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
  // Clean up any lingering listeners to prevent accumulation across tests
  guardianAlertBus.removeAllListeners();
  beneficiaryAlertBus.removeAllListeners();
  triggerSignalBus.removeAllListeners();
});

describe("guardian alert bus — Yellow zone (75-89%)", () => {
  it("guardianAlertBus fires at Yellow zone (75-89%)", (done) => {
    const threshold = 5_000_000n;
    const yellowSlot = (threshold * 80n) / 100n; // 80% → Yellow
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const currentSlot = yellowSlot;
    const state = computeVaultInactivityState(vault, currentSlot);
    expect(state.zone).toBe(ActivityZone.Yellow);

    let pinged = false;
    const handler = (event: GuardianPingEvent) => {
      if (event.vaultAddress === vault.vaultAddress) { pinged = true; done(); }
    };
    guardianAlertBus.once("guardian_ping", handler);

    sendGuardianPingsForEligibleVaults(null as any, null as any, [vault], [state]).then(() => {
      if (!pinged) done(new Error("Guardian ping not emitted"));
    });
  });

  it("no duplicate alerts for same vault same zone", async () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold, { warning75Sent: true });
    getStore().registerVault(vault);

    const currentSlot = (threshold * 80n) / 100n;
    const state = computeVaultInactivityState(vault, currentSlot);

    let pinCount = 0;
    guardianAlertBus.on("guardian_ping", () => { pinCount++; });

    await sendGuardianPingsForEligibleVaults(null as any, null as any, [vault], [state]);
    await sendGuardianPingsForEligibleVaults(null as any, null as any, [vault], [state]);

    expect(pinCount).toBe(0); // already sent
  });
});

describe("beneficiary alert bus — Orange zone (90-99%)", () => {
  it("beneficiaryAlertBus fires at Orange zone (90-99%)", (done) => {
    const threshold = 5_000_000n;
    const orangeSlot = (threshold * 95n) / 100n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const state = computeVaultInactivityState(vault, orangeSlot);
    expect(state.zone).toBe(ActivityZone.Orange);

    let warned = false;
    const handler = (event: BeneficiaryWarnEvent) => {
      if (event.vaultAddress === vault.vaultAddress) { warned = true; done(); }
    };
    beneficiaryAlertBus.once("beneficiary_warn", handler);

    sendBeneficiaryWarningsForEligibleVaults(null as any, null as any, [vault], [state], "http://localhost:3000").then(() => {
      if (!warned) done(new Error("Beneficiary warning not emitted"));
    });
  });

  it("no duplicate beneficiary alerts for same vault", async () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold, { warning90Sent: true });
    getStore().registerVault(vault);

    const state = computeVaultInactivityState(vault, (threshold * 95n) / 100n);
    let warnCount = 0;
    beneficiaryAlertBus.on("beneficiary_warn", () => { warnCount++; });

    await sendBeneficiaryWarningsForEligibleVaults(null as any, null as any, [vault], [state], "http://localhost:3000");
    expect(warnCount).toBe(0);
  });

  it("Orange zone (90-99%) does NOT emit a trigger signal", async () => {
    // Layer H: a vault at 90-99% (Orange zone) is not past the threshold — the
    // trigger signal must NOT be emitted. Only Red zone (>=100%) should trigger.
    const threshold = 5_000_000n;
    const orangeSlot = (threshold * 95n) / 100n; // 95% = Orange
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const state = computeVaultInactivityState(vault, orangeSlot);
    expect(state.zone).toBe(ActivityZone.Orange);
    expect(state.score).toBeGreaterThanOrEqual(90n);
    expect(state.score).toBeLessThan(100n);

    let signalCount = 0;
    triggerSignalBus.on("trigger_ready", () => { signalCount++; });

    const results = await signalEligibleTriggers(null as any, null as any, [vault], [state]);
    expect(results[0].signalEmitted).toBe(false);
    expect(signalCount).toBe(0);
  });

  it("Yellow zone (75-89%) does NOT emit a trigger signal", async () => {
    const threshold = 5_000_000n;
    const yellowSlot = (threshold * 80n) / 100n; // 80% = Yellow
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const state = computeVaultInactivityState(vault, yellowSlot);
    expect(state.zone).toBe(ActivityZone.Yellow);

    let signalCount = 0;
    triggerSignalBus.on("trigger_ready", () => { signalCount++; });

    const results = await signalEligibleTriggers(null as any, null as any, [vault], [state]);
    expect(results[0].signalEmitted).toBe(false);
    expect(signalCount).toBe(0);
  });

  it("Green zone does NOT emit beneficiary warning or trigger signal", async () => {
    const threshold  = 5_000_000n;
    const greenSlot  = (threshold * 50n) / 100n; // 50% = Green
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const state = computeVaultInactivityState(vault, greenSlot);
    expect(state.zone).toBe(ActivityZone.Green);

    let warnCount   = 0;
    let signalCount = 0;
    beneficiaryAlertBus.on("beneficiary_warn", () => { warnCount++; });
    triggerSignalBus.on("trigger_ready", () => { signalCount++; });

    await sendBeneficiaryWarningsForEligibleVaults(null as any, null as any, [vault], [state], "http://localhost:3000");
    await signalEligibleTriggers(null as any, null as any, [vault], [state]);

    expect(warnCount).toBe(0);
    expect(signalCount).toBe(0);
  });
});

describe("trigger signal bus — Red zone (>=100%)", () => {
  it("triggerSignalBus fires at Red zone (>=100%)", (done) => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);

    const state = computeVaultInactivityState(vault, threshold + 1n);
    expect(state.zone).toBe(ActivityZone.Red);

    let signalled = false;
    const handler = (event: TriggerReadyEvent) => {
      if (event.vaultAddress === vault.vaultAddress) { signalled = true; done(); }
    };
    triggerSignalBus.once("trigger_ready", handler);

    signalEligibleTriggers(null as any, null as any, [vault], [state]).then(() => {
      if (!signalled) done(new Error("Trigger signal not emitted"));
    });
  });

  it("no duplicate trigger signals for same vault", async () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);
    getStore().registerVault(vault);
    getStore().setTriggerSignalled(vault.vaultAddress, true);

    const state = computeVaultInactivityState(vault, threshold + 1n);
    let signalCount = 0;
    triggerSignalBus.on("trigger_ready", () => { signalCount++; });

    await signalEligibleTriggers(null as any, null as any, [vault], [state]);
    expect(signalCount).toBe(0);
  });

  it("alerts reset after check-in — zone returns to Green", () => {
    const threshold = 5_000_000n;
    const vault = makeVaultRecord(0n, threshold);

    // Red zone
    const redState = computeVaultInactivityState(vault, threshold + 1n);
    expect(redState.zone).toBe(ActivityZone.Red);

    // After check-in (simulate lastCheckInSlot advancing)
    const afterCheckIn = { ...vault, lastCheckInSlot: (threshold + 2n).toString() };
    const greenState = computeVaultInactivityState(afterCheckIn, threshold + 3n);
    expect(greenState.zone).toBe(ActivityZone.Green);
  });
});
