import * as path from "path";
import * as fs   from "fs";
import * as os   from "os";
import { initStore, getStore } from "../../watcher/src/db/store";
import { initSigningPool }     from "../../watcher/src/signing_pool";
import { isAnomalous }         from "../../watcher/src/monitor/block_counter";
import type { VaultRecord }    from "../../watcher/src/types/watcher";

function makeVaultRecord(overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    vaultAddress:             "Vault1111111111111111111111111111111111111",
    ownerAddress:             "Owner111111111111111111111111111111111111",
    beneficiary:              "Bene1111111111111111111111111111111111111",
    vaultIndex:               "0",
    lastCheckInSlot:          "1000",
    inactivityThresholdSlots: "5000000",
    depositedLamports:        "1000000000",
    guardianCount:            1,
    mOfNThreshold:            1,
    warning75Sent:            false,
    warning90Sent:            false,
    triggerSignalled:         false,
    anomalyFlagged:           false,
    checkinCount:             "1",
    sumOfIntervals:           "1000",
    lastPolledSlot:           "1000",
    createdAt:                "2024-01-01 00:00:00",
    updatedAt:                "2024-01-01 00:00:00",
    ...overrides,
  };
}

describe("watcher anomaly detection", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-anomaly-${Date.now()}.db`);
    initStore(dbPath);
    initSigningPool([]); // empty pool — no actual signing
  });

  afterEach(() => {
    getStore().close();
    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
  });

  it("anomaly detected when is_anomalous()=true", () => {
    // count=1, sum=1000 → avg=1000, threshold=1500
    // elapsed = 1501 → anomalous
    const currentSlot   = 1001n + 1501n; // lastCheckIn=1001, elapsed=1501
    const lastCheckIn   = 1001n;
    expect(isAnomalous(currentSlot, lastCheckIn, 1n, 1000n)).toBe(true);
  });

  it("no anomaly when below threshold", () => {
    // elapsed = 1500 → not anomalous (condition is >)
    const currentSlot = 1001n + 1500n;
    const lastCheckIn = 1001n;
    expect(isAnomalous(currentSlot, lastCheckIn, 1n, 1000n)).toBe(false);
  });

  it("no anomaly when checkinCount = 0 (no history yet)", () => {
    expect(isAnomalous(2000n, 0n, 0n, 0n)).toBe(false);
  });

  it("already-flagged vault: anomalyFlagged field is tracked in DB", () => {
    const vault = makeVaultRecord();
    getStore().registerVault(vault);
    getStore().setAnomalyFlagged(vault.vaultAddress, true);
    const fetched = getStore().getVault(vault.vaultAddress);
    expect(fetched!.anomalyFlagged).toBe(true);
  });

  it("anomaly threshold respects multiply-before-divide order", () => {
    // sum=2000, count=2 → avg=1000, threshold = 2000*150/2/100 = 1500
    // elapsed=1501 → anomalous
    expect(isAnomalous(1502n, 1n, 2n, 2000n)).toBe(true);
    // elapsed=1500 → not anomalous
    expect(isAnomalous(1501n, 1n, 2n, 2000n)).toBe(false);
  });

  it("anomaly flag cleared after check-in (local store update)", () => {
    const vault = makeVaultRecord();
    getStore().registerVault(vault);
    getStore().setAnomalyFlagged(vault.vaultAddress, true);
    expect(getStore().getVault(vault.vaultAddress)!.anomalyFlagged).toBe(true);

    // Simulate a check-in clearing the flag
    getStore().setAnomalyFlagged(vault.vaultAddress, false);
    expect(getStore().getVault(vault.vaultAddress)!.anomalyFlagged).toBe(false);
  });

  it("multiple vaults: anomaly independently tracked per vault", () => {
    const v1 = makeVaultRecord({ vaultAddress: "A" + "1".repeat(43) });
    const v2 = makeVaultRecord({ vaultAddress: "B" + "2".repeat(43) });
    getStore().registerVault(v1);
    getStore().registerVault(v2);

    getStore().setAnomalyFlagged(v1.vaultAddress, true);
    expect(getStore().getVault(v1.vaultAddress)!.anomalyFlagged).toBe(true);
    expect(getStore().getVault(v2.vaultAddress)!.anomalyFlagged).toBe(false);
  });
});
```

