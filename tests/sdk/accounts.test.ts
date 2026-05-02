import { createHash } from "node:crypto";
import { PublicKey }  from "@solana/web3.js";
import { CovenantType } from "../../sdk/src/types";

// We test the SDK's binary deserialisers directly by constructing on-chain
// account byte layouts that exactly match constants.rs and verifying the
// deserialisers produce correct typed output.
//
// The deserialisers are not exported individually — they are exercised through
// fetchVault / fetchActivity / fetchGuardian / fetchCovenant, which require
// a Connection. We therefore test the serialisation layout by building raw
// buffers matching the on-chain format and asserting the fetch functions
// return null for wrong data, and truthy for correct data, by mocking
// Connection.getAccountInfo.

function disc(name: string): Buffer {
  return Buffer.from(createHash("sha256").update(`account:${name}`).digest()).slice(0, 8);
}

function u64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

const PROGRAM_ID  = new PublicKey("LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const OWNER       = new PublicKey("So11111111111111111111111111111111111111112");
const BENEFICIARY = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VAULT_PK    = new PublicKey("11111111111111111111111111111112");
const GUARDIAN_PK = new PublicKey("11111111111111111111111111111113");

// Builds a 128-byte VaultAccount buffer matching constants.rs layout
function buildVaultBuffer(overrides: {
  owner?: PublicKey;
  beneficiary?: PublicKey;
  guardianCount?: number;
  mOfNThreshold?: number;
  inactivityThresholdSlots?: bigint;
  lastCheckInSlot?: bigint;
  createdSlot?: bigint;
  depositedLamports?: bigint;
  covenantCounter?: bigint;
  vaultIndex?: bigint;
  isTriggered?: boolean;
  isClaimed?: boolean;
  isEmergencySwept?: boolean;
  warning75Sent?: boolean;
  warning90Sent?: boolean;
  bump?: number;
} = {}): Buffer {
  const {
    owner               = OWNER,
    beneficiary         = BENEFICIARY,
    guardianCount       = 0,
    mOfNThreshold       = 0,
    inactivityThresholdSlots = 5_000_000n,
    lastCheckInSlot     = 100n,
    createdSlot         = 100n,
    depositedLamports   = 0n,
    covenantCounter     = 0n,
    vaultIndex          = 0n,
    isTriggered         = false,
    isClaimed           = false,
    isEmergencySwept    = false,
    warning75Sent       = false,
    warning90Sent       = false,
    bump                = 255,
  } = overrides;

  return Buffer.concat([
    disc("VaultAccount"),          // [0..8]
    owner.toBuffer(),              // [8..40]
    beneficiary.toBuffer(),        // [40..72]
    Buffer.from([guardianCount]),  // [72]
    Buffer.from([mOfNThreshold]),  // [73]
    u64LE(inactivityThresholdSlots), // [74..82]
    u64LE(lastCheckInSlot),        // [82..90]
    u64LE(createdSlot),            // [90..98]
    u64LE(depositedLamports),      // [98..106]
    u64LE(covenantCounter),        // [106..114]
    u64LE(vaultIndex),             // [114..122]
    Buffer.from([isTriggered ? 1 : 0]),    // [122]
    Buffer.from([isClaimed ? 1 : 0]),      // [123]
    Buffer.from([isEmergencySwept ? 1 : 0]), // [124]
    Buffer.from([warning75Sent ? 1 : 0]),  // [125]
    Buffer.from([warning90Sent ? 1 : 0]),  // [126]
    Buffer.from([bump]),                    // [127]
  ]);
}

// Builds a 74-byte ActivityAccount buffer
function buildActivityBuffer(overrides: {
  vault?: PublicKey;
  checkinCount?: bigint;
  sumOfIntervals?: bigint;
  lastInterval?: bigint;
  anomalyFlagged?: boolean;
  anomalyFlaggedSlot?: bigint;
  bump?: number;
} = {}): Buffer {
  const {
    vault             = VAULT_PK,
    checkinCount      = 0n,
    sumOfIntervals    = 0n,
    lastInterval      = 0n,
    anomalyFlagged    = false,
    anomalyFlaggedSlot = 0n,
    bump              = 255,
  } = overrides;

  return Buffer.concat([
    disc("ActivityAccount"),       // [0..8]
    vault.toBuffer(),              // [8..40]
    u64LE(checkinCount),           // [40..48]
    u64LE(sumOfIntervals),         // [48..56]
    u64LE(lastInterval),           // [56..64]
    Buffer.from([anomalyFlagged ? 1 : 0]), // [64]
    u64LE(anomalyFlaggedSlot),     // [65..73]
    Buffer.from([bump]),           // [73]
  ]);
}

// Builds a 90-byte GuardianAccount buffer
function buildGuardianBuffer(overrides: {
  vault?: PublicKey;
  guardian?: PublicKey;
  isActive?: boolean;
  addedSlot?: bigint;
  removalRequestedSlot?: bigint;
  bump?: number;
} = {}): Buffer {
  const {
    vault                = VAULT_PK,
    guardian             = GUARDIAN_PK,
    isActive             = true,
    addedSlot            = 500n,
    removalRequestedSlot = 0n,
    bump                 = 255,
  } = overrides;

  return Buffer.concat([
    disc("GuardianAccount"),       // [0..8]
    vault.toBuffer(),              // [8..40]
    guardian.toBuffer(),           // [40..72]
    Buffer.from([isActive ? 1 : 0]), // [72]
    u64LE(addedSlot),              // [73..81]
    u64LE(removalRequestedSlot),   // [81..89]
    Buffer.from([bump]),           // [89]
  ]);
}

// Builds a CovenantAccount buffer (variable size due to signers vec)
function buildCovenantBuffer(overrides: {
  vault?: PublicKey;
  covenantType?: CovenantType;
  target?: PublicKey;
  signers?: PublicKey[];
  requiredSignatures?: number;
  createdSlot?: bigint;
  timelockSlots?: bigint;
  signaturesCompleteSlot?: bigint;
  covenantIndex?: bigint;
  isExecuted?: boolean;
  bump?: number;
} = {}): Buffer {
  const {
    vault                   = VAULT_PK,
    covenantType            = CovenantType.EmergencySweep,
    target                  = PublicKey.default,
    signers                 = [GUARDIAN_PK],
    requiredSignatures      = 1,
    createdSlot             = 100n,
    timelockSlots           = 0n,
    signaturesCompleteSlot  = 100n,
    covenantIndex           = 0n,
    isExecuted              = false,
    bump                    = 255,
  } = overrides;

  const signersLenBuf = Buffer.alloc(4);
  signersLenBuf.writeUInt32LE(signers.length);

  return Buffer.concat([
    disc("CovenantAccount"),       // [0..8]
    vault.toBuffer(),              // [8..40]
    Buffer.from([covenantType]),   // [40]
    target.toBuffer(),             // [41..73]
    signersLenBuf,                 // [73..77]
    ...signers.map((s) => s.toBuffer()), // variable
    Buffer.from([requiredSignatures]),   // +1
    u64LE(createdSlot),                  // +8
    u64LE(timelockSlots),                // +8
    u64LE(signaturesCompleteSlot),       // +8
    u64LE(covenantIndex),                // +8
    Buffer.from([isExecuted ? 1 : 0]),   // +1
    Buffer.from([bump]),                 // +1
  ]);
}

// Mock Connection to test deserialisers indirectly
function mockConnection(data: Buffer): any {
  return {
    getAccountInfo: async () => ({
      data,
      lamports: 1_000_000,
      owner: PROGRAM_ID,
      executable: false,
    }),
  };
}

describe("fetchVault deserialises all fields correctly", () => {
  it("owner and beneficiary decoded as base58 strings", async () => {
    const { fetchVault } = await import("../../sdk/src/accounts");
    const buf = buildVaultBuffer();
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault).not.toBeNull();
    expect(vault!.owner).toBe(OWNER.toBase58());
    expect(vault!.beneficiary).toBe(BENEFICIARY.toBase58());
  });

  it("guardianCount and mOfNThreshold decoded as numbers", async () => {
    const { fetchVault } = await import("../../sdk/src/accounts");
    const buf = buildVaultBuffer({ guardianCount: 3, mOfNThreshold: 2 });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.guardianCount).toBe(3);
    expect(vault!.mOfNThreshold).toBe(2);
  });

  it("u64 fields decoded as bigint", async () => {
    const { fetchVault } = await import("../../sdk/src/accounts");
    const buf = buildVaultBuffer({
      inactivityThresholdSlots: 5_000_000n,
      lastCheckInSlot:          1_234_567n,
      depositedLamports:        1_000_000_000n,
      vaultIndex:               7n,
    });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.inactivityThresholdSlots).toBe(5_000_000n);
    expect(vault!.lastCheckInSlot).toBe(1_234_567n);
    expect(vault!.depositedLamports).toBe(1_000_000_000n);
    expect(vault!.vaultIndex).toBe(7n);
  });

  it("boolean flags decoded correctly", async () => {
    const { fetchVault } = await import("../../sdk/src/accounts");
    const buf = buildVaultBuffer({
      isTriggered: true,
      isClaimed: false,
      isEmergencySwept: false,
      warning75Sent: true,
      warning90Sent: false,
    });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.isTriggered).toBe(true);
    expect(vault!.isClaimed).toBe(false);
    expect(vault!.warning75Sent).toBe(true);
    expect(vault!.warning90Sent).toBe(false);
  });

  it("returns null for wrong discriminator", async () => {
    const { fetchVault } = await import("../../sdk/src/accounts");
    const buf = buildActivityBuffer(); // wrong discriminator
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault).toBeNull();
  });

  it("returns null when account does not exist", async () => {
    const { fetchVault } = await import("../../sdk/src/accounts");
    const nullConn = { getAccountInfo: async () => null };
    const vault = await fetchVault(nullConn as any, PROGRAM_ID, VAULT_PK);
    expect(vault).toBeNull();
  });
});

describe("fetchActivity deserialises all fields correctly", () => {
  it("checkinCount, sumOfIntervals, lastInterval decoded as bigint", async () => {
    const { fetchActivity } = await import("../../sdk/src/accounts");
    const buf = buildActivityBuffer({
      checkinCount:   10n,
      sumOfIntervals: 50_000n,
      lastInterval:   5_000n,
    });
    const activity = await fetchActivity(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(activity!.checkinCount).toBe(10n);
    expect(activity!.sumOfIntervals).toBe(50_000n);
    expect(activity!.lastInterval).toBe(5_000n);
  });

  it("anomalyFlagged and anomalyFlaggedSlot decoded correctly", async () => {
    const { fetchActivity } = await import("../../sdk/src/accounts");
    const buf = buildActivityBuffer({ anomalyFlagged: true, anomalyFlaggedSlot: 4_500_000n });
    const activity = await fetchActivity(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(activity!.anomalyFlagged).toBe(true);
    expect(activity!.anomalyFlaggedSlot).toBe(4_500_000n);
  });

  it("vault field is base58 string", async () => {
    const { fetchActivity } = await import("../../sdk/src/accounts");
    const buf = buildActivityBuffer({ vault: VAULT_PK });
    const activity = await fetchActivity(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(activity!.vault).toBe(VAULT_PK.toBase58());
  });
});

describe("fetchGuardian deserialises all fields correctly", () => {
  it("isActive, addedSlot, removalRequestedSlot decoded correctly", async () => {
    const { fetchGuardian } = await import("../../sdk/src/accounts");
    const buf = buildGuardianBuffer({
      isActive:             true,
      addedSlot:            1_000n,
      removalRequestedSlot: 0n,
    });
    const guardian = await fetchGuardian(mockConnection(buf), PROGRAM_ID, GUARDIAN_PK);
    expect(guardian!.isActive).toBe(true);
    expect(guardian!.addedSlot).toBe(1_000n);
    expect(guardian!.removalRequestedSlot).toBe(0n);
  });

  it("guardian and vault are base58 strings", async () => {
    const { fetchGuardian } = await import("../../sdk/src/accounts");
    const buf = buildGuardianBuffer({ vault: VAULT_PK, guardian: GUARDIAN_PK });
    const guardian = await fetchGuardian(mockConnection(buf), PROGRAM_ID, GUARDIAN_PK);
    expect(guardian!.vault).toBe(VAULT_PK.toBase58());
    expect(guardian!.guardian).toBe(GUARDIAN_PK.toBase58());
  });
});

describe("fetchCovenant deserialises all fields correctly including signers vec", () => {
  it("signers vec decoded correctly — 1 signer", async () => {
    const { fetchCovenant } = await import("../../sdk/src/accounts");
    const buf = buildCovenantBuffer({ signers: [GUARDIAN_PK] });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.signers.length).toBe(1);
    expect(covenant!.signers[0]).toBe(GUARDIAN_PK.toBase58());
  });

  it("covenantType, timelockSlots, signaturesCompleteSlot decoded correctly", async () => {
    const { fetchCovenant } = await import("../../sdk/src/accounts");
    const buf = buildCovenantBuffer({
      covenantType:           CovenantType.BeneficiaryChange,
      timelockSlots:          432_000n,
      signaturesCompleteSlot: 5_000_100n,
      covenantIndex:          3n,
    });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.covenantType).toBe(CovenantType.BeneficiaryChange);
    expect(covenant!.timelockSlots).toBe(432_000n);
    expect(covenant!.signaturesCompleteSlot).toBe(5_000_100n);
    expect(covenant!.covenantIndex).toBe(3n);
  });

  it("isExecuted flag decoded correctly", async () => {
    const { fetchCovenant } = await import("../../sdk/src/accounts");
    const buf = buildCovenantBuffer({ isExecuted: true });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.isExecuted).toBe(true);
  });

  it("returns null for buffer with signers length > MAX_COVENANT_SIGNERS (corrupted)", async () => {
    const { fetchCovenant } = await import("../../sdk/src/accounts");
    // Build a buffer claiming 11 signers (> MAX_COVENANT_SIGNERS=10)
    const buf = buildCovenantBuffer({
      signers: Array(11).fill(GUARDIAN_PK),
    });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant).toBeNull();
  });
});
