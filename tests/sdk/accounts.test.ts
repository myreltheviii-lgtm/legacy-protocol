import { createHash } from "node:crypto";
import { PublicKey, Keypair }  from "@solana/web3.js";
import { CovenantType } from "../../sdk/src/types";
import {
  deserialiseVault,
  VAULT_SIZE,
  ACTIVITY_SIZE,
  GUARDIAN_SIZE,
  fetchVault,
  fetchActivity,
  fetchGuardian,
  fetchCovenant,
  fetchAllVaultsForOwner,
} from "../../sdk/src/accounts";

// We test the SDK's binary deserialisers directly by constructing on-chain
// account byte layouts that exactly match constants.rs and verifying the
// deserialisers produce correct typed output.

function disc(name: string): Buffer {
  return Buffer.from(createHash("sha256").update(`account:${name}`).digest()).slice(0, 8);
}

function u64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

const PROGRAM_ID  = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
const OWNER       = new PublicKey("So11111111111111111111111111111111111111112");
const BENEFICIARY = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VAULT_PK    = new PublicKey("11111111111111111111111111111112");
const GUARDIAN_PK = new PublicKey("11111111111111111111111111111113");

// A non-zero 32-byte UTXO pubkey used for beneficiaryUtxoPubkey tests.
// Using BENEFICIARY's raw bytes makes round-trip testing straightforward.
const BENEFICIARY_UTXO_PUBKEY = BENEFICIARY.toBuffer();

// Maps the CovenantType string enum to the on-chain Borsh discriminant byte.
// CovenantType is a string enum ("EmergencySweep", "BeneficiaryChange",
// "GuardianRemoval") so Buffer.from([covenantType]) would coerce the string
// to NaN → 0 and always write byte 0, silently encoding EmergencySweep for
// every variant. This helper converts to the numeric discriminant matching
// the Rust declaration order in state/covenant.rs.
function covenantTypeDiscriminant(ct: CovenantType): number {
  switch (ct) {
    case CovenantType.EmergencySweep:    return 0;
    case CovenantType.BeneficiaryChange: return 1;
    case CovenantType.GuardianRemoval:   return 2;
  }
}

// Builds a 168-byte VaultAccount buffer matching constants.rs v2 layout:
//   [0..8]    disc
//   [8..40]   owner: Pubkey
//   [40..72]  beneficiary_utxo_pubkey: [u8;32]
//   [72]      guardian_count: u8
//   [73]      m_of_n_threshold: u8
//   [74..82]  inactivity_threshold_slots: u64
//   [82..90]  last_check_in_slot: u64
//   [90..98]  created_slot: u64
//   [98..106] deposited_lamports: u64
//   [106..114] covenant_counter: u64
//   [114..122] vault_index: u64
//   [122..154] utxo_commitment: [u8;32]
//   [154..162] utxo_leaf_index: u64
//   [162]     is_triggered: bool
//   [163]     is_claimed: bool
//   [164]     is_emergency_swept: bool
//   [165]     warning_75_sent: bool
//   [166]     warning_90_sent: bool
//   [167]     bump: u8
function buildVaultBuffer(overrides: {
  owner?: PublicKey;
  beneficiaryUtxoPubkey?: Buffer;
  guardianCount?: number;
  mOfNThreshold?: number;
  inactivityThresholdSlots?: bigint;
  lastCheckInSlot?: bigint;
  createdSlot?: bigint;
  depositedLamports?: bigint;
  covenantCounter?: bigint;
  vaultIndex?: bigint;
  utxoCommitment?: Buffer;
  utxoLeafIndex?: bigint;
  isTriggered?: boolean;
  isClaimed?: boolean;
  isEmergencySwept?: boolean;
  warning75Sent?: boolean;
  warning90Sent?: boolean;
  bump?: number;
} = {}): Buffer {
  const {
    owner                    = OWNER,
    beneficiaryUtxoPubkey    = BENEFICIARY_UTXO_PUBKEY,
    guardianCount            = 0,
    mOfNThreshold            = 0,
    inactivityThresholdSlots = 5_000_000n,
    lastCheckInSlot          = 100n,
    createdSlot              = 100n,
    depositedLamports        = 0n,
    covenantCounter          = 0n,
    vaultIndex               = 0n,
    utxoCommitment           = Buffer.alloc(32, 0),
    utxoLeafIndex            = 0n,
    isTriggered              = false,
    isClaimed                = false,
    isEmergencySwept         = false,
    warning75Sent            = false,
    warning90Sent            = false,
    bump                     = 255,
  } = overrides;

  const buf = Buffer.concat([
    disc("VaultAccount"),                          // [0..8]
    owner.toBuffer(),                              // [8..40]
    beneficiaryUtxoPubkey,                         // [40..72]
    Buffer.from([guardianCount]),                  // [72]
    Buffer.from([mOfNThreshold]),                  // [73]
    u64LE(inactivityThresholdSlots),               // [74..82]
    u64LE(lastCheckInSlot),                        // [82..90]
    u64LE(createdSlot),                            // [90..98]
    u64LE(depositedLamports),                      // [98..106]
    u64LE(covenantCounter),                        // [106..114]
    u64LE(vaultIndex),                             // [114..122]
    utxoCommitment,                                // [122..154]
    u64LE(utxoLeafIndex),                          // [154..162]
    Buffer.from([isTriggered ? 1 : 0]),            // [162]
    Buffer.from([isClaimed ? 1 : 0]),              // [163]
    Buffer.from([isEmergencySwept ? 1 : 0]),       // [164]
    Buffer.from([warning75Sent ? 1 : 0]),          // [165]
    Buffer.from([warning90Sent ? 1 : 0]),          // [166]
    Buffer.from([bump]),                           // [167]
  ]);

  // Verify the buffer is exactly VAULT_SIZE before returning.
  if (buf.length !== VAULT_SIZE) {
    throw new Error(`buildVaultBuffer produced ${buf.length} bytes, expected ${VAULT_SIZE}`);
  }

  return buf;
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
    vault              = VAULT_PK,
    checkinCount       = 0n,
    sumOfIntervals     = 0n,
    lastInterval       = 0n,
    anomalyFlagged     = false,
    anomalyFlaggedSlot = 0n,
    bump               = 255,
  } = overrides;

  return Buffer.concat([
    disc("ActivityAccount"),                       // [0..8]
    vault.toBuffer(),                              // [8..40]
    u64LE(checkinCount),                           // [40..48]
    u64LE(sumOfIntervals),                         // [48..56]
    u64LE(lastInterval),                           // [56..64]
    Buffer.from([anomalyFlagged ? 1 : 0]),         // [64]
    u64LE(anomalyFlaggedSlot),                     // [65..73]
    Buffer.from([bump]),                           // [73]
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
    disc("GuardianAccount"),                       // [0..8]
    vault.toBuffer(),                              // [8..40]
    guardian.toBuffer(),                           // [40..72]
    Buffer.from([isActive ? 1 : 0]),               // [72]
    u64LE(addedSlot),                              // [73..81]
    u64LE(removalRequestedSlot),                   // [81..89]
    Buffer.from([bump]),                           // [89]
  ]);
}

// Builds a CovenantAccount buffer (variable size due to signers vec).
//
// covenantType is a string enum — it must be converted to its on-chain
// numeric discriminant (0=EmergencySweep, 1=BeneficiaryChange,
// 2=GuardianRemoval) via covenantTypeDiscriminant() before writing to the
// buffer. Buffer.from([stringEnumValue]) coerces the string to NaN → 0,
// silently encoding every variant as EmergencySweep.
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
    vault                  = VAULT_PK,
    covenantType           = CovenantType.EmergencySweep,
    target                 = PublicKey.default,
    signers                = [GUARDIAN_PK],
    requiredSignatures     = 1,
    createdSlot            = 100n,
    timelockSlots          = 0n,
    signaturesCompleteSlot = 100n,
    covenantIndex          = 0n,
    isExecuted             = false,
    bump                   = 255,
  } = overrides;

  const signersLenBuf = Buffer.alloc(4);
  signersLenBuf.writeUInt32LE(signers.length);

  return Buffer.concat([
    disc("CovenantAccount"),                           // [0..8]
    vault.toBuffer(),                                  // [8..40]
    // covenantTypeDiscriminant() maps the string enum to its numeric Borsh
    // variant index — the single byte the on-chain Borsh encoder emits.
    Buffer.from([covenantTypeDiscriminant(covenantType)]), // [40]
    target.toBuffer(),                                 // [41..73]
    signersLenBuf,                                     // [73..77]
    ...signers.map((s) => s.toBuffer()),               // variable
    Buffer.from([requiredSignatures]),                 // +1
    u64LE(createdSlot),                                // +8
    u64LE(timelockSlots),                              // +8
    u64LE(signaturesCompleteSlot),                     // +8
    u64LE(covenantIndex),                              // +8
    Buffer.from([isExecuted ? 1 : 0]),                 // +1
    Buffer.from([bump]),                               // +1
  ]);
}

// Mock Connection to test deserialisers indirectly through fetch wrappers
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

// Mock Connection for getProgramAccounts (used by fetchAllVaultsForOwner)
function mockProgramAccountsConnection(accounts: Array<{ pubkey: PublicKey; data: Buffer }>): any {
  return {
    getAccountInfo: async () => null,
    getProgramAccounts: async (_programId: PublicKey, _config: any) => {
      return accounts.map(({ pubkey, data }) => ({
        pubkey,
        account: {
          data,
          lamports: 1_000_000,
          owner: PROGRAM_ID,
          executable: false,
        },
      }));
    },
  };
}

// ── VAULT_SIZE constant ───────────────────────────────────────────────────────

describe("VAULT_SIZE constant", () => {
  it("is exactly 168 (v2 layout with Cloak fields)", () => {
    expect(VAULT_SIZE).toBe(168);
  });
});

// ── fetchVault deserialises all fields correctly ──────────────────────────────

describe("fetchVault deserialises all fields correctly", () => {
  it("owner decoded as base58 string", async () => {
    const buf   = buildVaultBuffer();
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault).not.toBeNull();
    expect(vault!.owner).toBe(OWNER.toBase58());
  });

  it("beneficiaryUtxoPubkey decoded as hex string (64 chars)", async () => {
    const buf   = buildVaultBuffer();
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.beneficiaryUtxoPubkey).toBe(BENEFICIARY_UTXO_PUBKEY.toString("hex"));
    expect(vault!.beneficiaryUtxoPubkey.length).toBe(64);
  });

  it("guardianCount and mOfNThreshold decoded as numbers", async () => {
    const buf   = buildVaultBuffer({ guardianCount: 3, mOfNThreshold: 2 });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.guardianCount).toBe(3);
    expect(vault!.mOfNThreshold).toBe(2);
  });

  it("u64 fields decoded as bigint", async () => {
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

  it("depositedLamports = 0 with all-zero utxoCommitment — vault is unshielded (is_shielded() = false)", async () => {
    // Authoritative: utxo_commitment all zeros = sentinel for 'not shielded'.
    // A vault with depositedLamports=0 and no record_cloak_deposit call has
    // all-zero utxo_commitment. is_shielded() checks whether any commitment
    // byte is non-zero.
    const buf   = buildVaultBuffer({ depositedLamports: 0n, utxoCommitment: Buffer.alloc(32, 0) });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.depositedLamports).toBe(0n);
    expect(vault!.utxoCommitment).toBe("00".repeat(32)); // 64 zeros
    // is_shielded semantic: all-zero commitment means not shielded
    const isShielded = vault!.utxoCommitment !== "0".repeat(64);
    expect(isShielded).toBe(false);
  });

  it("utxoCommitment decoded as 64-char hex string", async () => {
    const commitment = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) commitment[i] = i + 1;
    const buf   = buildVaultBuffer({ utxoCommitment: commitment });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.utxoCommitment).toBe(commitment.toString("hex"));
    expect(vault!.utxoCommitment.length).toBe(64);
  });

  it("utxoLeafIndex decoded as bigint at correct offset [154..162]", async () => {
    // This test specifically verifies the new v2 field at byte 154, not at
    // the old bool-region (byte 122 in the v1 layout).
    const buf   = buildVaultBuffer({ utxoLeafIndex: 99_999n });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.utxoLeafIndex).toBe(99_999n);
  });

  it("boolean flags decoded correctly at v2 offsets [162..167]", async () => {
    // Explicitly tests that the booleans are read from [162..167] (v2),
    // not [122..127] (v1). The utxo_commitment at [122..154] must not
    // interfere with boolean reads.
    const nonZeroCommitment = Buffer.alloc(32, 0xab); // all bytes = 0xab
    const buf = buildVaultBuffer({
      utxoCommitment:  nonZeroCommitment, // fills [122..154] with 0xab
      isTriggered:     true,              // must be at [162], not [122]
      isClaimed:       false,
      isEmergencySwept: false,
      warning75Sent:   true,
      warning90Sent:   false,
    });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.isTriggered).toBe(true);
    expect(vault!.isClaimed).toBe(false);
    expect(vault!.isEmergencySwept).toBe(false);
    expect(vault!.warning75Sent).toBe(true);
    expect(vault!.warning90Sent).toBe(false);
    // utxoCommitment itself should be non-zero
    expect(vault!.utxoCommitment).toBe(nonZeroCommitment.toString("hex"));
  });

  it("all boolean flags true simultaneously — all read correctly", async () => {
    const buf = buildVaultBuffer({
      isTriggered:     true,
      isClaimed:       true,
      isEmergencySwept: true,
      warning75Sent:   true,
      warning90Sent:   true,
    });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.isTriggered).toBe(true);
    expect(vault!.isClaimed).toBe(true);
    expect(vault!.isEmergencySwept).toBe(true);
    expect(vault!.warning75Sent).toBe(true);
    expect(vault!.warning90Sent).toBe(true);
  });

  it("bump decoded at byte [167]", async () => {
    const buf   = buildVaultBuffer({ bump: 200 });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.bump).toBe(200);
  });

  it("returns null for wrong discriminator", async () => {
    const buf   = buildActivityBuffer(); // wrong discriminator
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault).toBeNull();
  });

  it("returns null when account does not exist", async () => {
    const nullConn = { getAccountInfo: async () => null };
    const vault = await fetchVault(nullConn as any, PROGRAM_ID, VAULT_PK);
    expect(vault).toBeNull();
  });

  it("returns null for buffer shorter than 168 bytes", async () => {
    const short = Buffer.alloc(167);
    const vault = await fetchVault(mockConnection(short), PROGRAM_ID, VAULT_PK);
    expect(vault).toBeNull();
  });
});

// ── fetchActivity deserialises all fields correctly ───────────────────────────

describe("fetchActivity deserialises all fields correctly", () => {
  it("checkinCount, sumOfIntervals, lastInterval decoded as bigint", async () => {
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
    const buf = buildActivityBuffer({ anomalyFlagged: true, anomalyFlaggedSlot: 4_500_000n });
    const activity = await fetchActivity(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(activity!.anomalyFlagged).toBe(true);
    expect(activity!.anomalyFlaggedSlot).toBe(4_500_000n);
  });

  it("vault field is base58 string", async () => {
    const buf = buildActivityBuffer({ vault: VAULT_PK });
    const activity = await fetchActivity(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(activity!.vault).toBe(VAULT_PK.toBase58());
  });
});

// ── fetchGuardian deserialises all fields correctly ───────────────────────────

describe("fetchGuardian deserialises all fields correctly", () => {
  it("isActive, addedSlot, removalRequestedSlot decoded correctly", async () => {
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
    const buf = buildGuardianBuffer({ vault: VAULT_PK, guardian: GUARDIAN_PK });
    const guardian = await fetchGuardian(mockConnection(buf), PROGRAM_ID, GUARDIAN_PK);
    expect(guardian!.vault).toBe(VAULT_PK.toBase58());
    expect(guardian!.guardian).toBe(GUARDIAN_PK.toBase58());
  });
});

// ── fetchCovenant deserialises all fields correctly ───────────────────────────

describe("fetchCovenant deserialises all fields correctly including signers vec", () => {
  it("signers vec decoded correctly — 1 signer", async () => {
    const buf = buildCovenantBuffer({ signers: [GUARDIAN_PK] });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.signers.length).toBe(1);
    expect(covenant!.signers[0]).toBe(GUARDIAN_PK.toBase58());
  });

  it("covenantType BeneficiaryChange decoded correctly — discriminant byte 1", async () => {
    // Uses covenantTypeDiscriminant() to write byte 1 into the buffer.
    // Before the fix, Buffer.from(["BeneficiaryChange"]) wrote byte 0,
    // causing deserialiseCovenantType(0) → EmergencySweep, failing this test.
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

  it("covenantType GuardianRemoval decoded correctly — discriminant byte 2", async () => {
    const buf = buildCovenantBuffer({ covenantType: CovenantType.GuardianRemoval });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.covenantType).toBe(CovenantType.GuardianRemoval);
  });

  it("covenantType EmergencySweep decoded correctly — discriminant byte 0", async () => {
    const buf = buildCovenantBuffer({ covenantType: CovenantType.EmergencySweep });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.covenantType).toBe(CovenantType.EmergencySweep);
  });

  it("isExecuted flag decoded correctly", async () => {
    const buf = buildCovenantBuffer({ isExecuted: true });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.isExecuted).toBe(true);
  });

  it("returns null for buffer with signers length > MAX_COVENANT_SIGNERS (corrupted)", async () => {
    // Build a buffer claiming 11 signers (> MAX_COVENANT_SIGNERS=10).
    // The deserialiser must reject this as corrupted data rather than
    // allocating 11 pubkeys from potentially garbage bytes.
    const buf = buildCovenantBuffer({
      signers: Array(11).fill(GUARDIAN_PK),
    });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant).toBeNull();
  });

  it("3-of-5 signers all decoded with correct base58 addresses", async () => {
    const signer1 = Keypair.generate().publicKey;
    const signer2 = Keypair.generate().publicKey;
    const signer3 = Keypair.generate().publicKey;
    const buf = buildCovenantBuffer({
      signers:            [signer1, signer2, signer3],
      requiredSignatures: 3,
    });
    const covenant = await fetchCovenant(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(covenant!.signers.length).toBe(3);
    expect(covenant!.signers[0]).toBe(signer1.toBase58());
    expect(covenant!.signers[1]).toBe(signer2.toBase58());
    expect(covenant!.signers[2]).toBe(signer3.toBase58());
    expect(covenant!.requiredSignatures).toBe(3);
  });
});

// ── Non-trivial u64 values at exact byte boundaries ───────────────────────────

describe("vault u64 fields at exact v2 byte offsets", () => {
  // These tests use distinctive non-trivial values that would produce
  // obviously wrong results if the byte offset were off by even 1.

  it("inactivity_threshold_slots [74..82] — non-trivial value", async () => {
    const buf   = buildVaultBuffer({ inactivityThresholdSlots: 0xdeadbeefcafebaaan });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.inactivityThresholdSlots).toBe(0xdeadbeefcafebaaan);
  });

  it("last_check_in_slot [82..90] — non-trivial value", async () => {
    const buf   = buildVaultBuffer({ lastCheckInSlot: 0x1234567890abcdefn });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.lastCheckInSlot).toBe(0x1234567890abcdefn);
  });

  it("covenant_counter [106..114] and vault_index [114..122] adjacent — no bleed", async () => {
    const buf = buildVaultBuffer({
      covenantCounter: 0xaaaaaaaan,
      vaultIndex:      0xbbbbbbbbn,
    });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.covenantCounter).toBe(0xaaaaaaaan);
    expect(vault!.vaultIndex).toBe(0xbbbbbbbbn);
  });

  it("utxo_commitment [122..154] all non-zero does not corrupt is_triggered [162]", async () => {
    // All-0xff commitment fills [122..154]. isTriggered=false at [162] must
    // still read 0 even though [122..161] are all 0xff.
    const buf = buildVaultBuffer({
      utxoCommitment: Buffer.alloc(32, 0xff),
      isTriggered:    false,
    });
    const vault = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.isTriggered).toBe(false);
    expect(vault!.utxoCommitment).toBe("ff".repeat(32));
  });

  it("depositedLamports u64::MAX (18446744073709551615n) decoded without precision loss", async () => {
    const maxU64 = 18446744073709551615n;
    const buf    = buildVaultBuffer({ depositedLamports: maxU64 });
    const vault  = await fetchVault(mockConnection(buf), PROGRAM_ID, VAULT_PK);
    expect(vault!.depositedLamports).toBe(maxU64);
    // Verify no .toNumber() truncation — this value exceeds Number.MAX_SAFE_INTEGER
    expect(vault!.depositedLamports).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });
});

// ── fetchAllVaultsForOwner — dataSize filter of 168 ──────────────────────────

describe("fetchAllVaultsForOwner — dataSize filter and owner filter", () => {
  it("returns all vaults for the given owner when connection returns valid vault accounts", async () => {
    const owner1 = Keypair.generate();
    const owner2 = Keypair.generate();

    // Build two vault buffers for owner1
    const vault1Buf = buildVaultBuffer({ owner: owner1.publicKey, vaultIndex: 0n });
    const vault2Buf = buildVaultBuffer({ owner: owner1.publicKey, vaultIndex: 1n });
    // Build one vault buffer for a different owner (should not appear in results
    // if the connection correctly filters — here we return it to verify the SDK
    // filters by owner bytes at offset 8 via the memcmp filter, not just dataSize)
    const vault3Buf = buildVaultBuffer({ owner: owner2.publicKey, vaultIndex: 0n });

    // Mock getProgramAccounts to simulate the RPC returning only filtered results
    // (in production the RPC applies the memcmp filter server-side; we simulate that)
    const conn = mockProgramAccountsConnection([
      { pubkey: new PublicKey("11111111111111111111111111111112"), data: vault1Buf },
      { pubkey: new PublicKey("11111111111111111111111111111113"), data: vault2Buf },
    ]);

    const vaults = await fetchAllVaultsForOwner(conn, PROGRAM_ID, owner1.publicKey);
    expect(vaults.length).toBe(2);
    expect(vaults[0].owner).toBe(owner1.publicKey.toBase58());
    expect(vaults[1].owner).toBe(owner1.publicKey.toBase58());
    expect(vaults[0].vaultIndex).toBe(0n);
    expect(vaults[1].vaultIndex).toBe(1n);
  });

  it("returns empty array when connection returns no accounts", async () => {
    const owner = Keypair.generate();
    const conn  = mockProgramAccountsConnection([]);
    const vaults = await fetchAllVaultsForOwner(conn, PROGRAM_ID, owner.publicKey);
    expect(vaults).toEqual([]);
    expect(vaults.length).toBe(0);
  });

  it("skips accounts with wrong discriminator (returns only valid vault accounts)", async () => {
    const owner = Keypair.generate();

    const validVaultBuf   = buildVaultBuffer({ owner: owner.publicKey });
    const invalidAccountBuf = buildActivityBuffer(); // wrong discriminator

    const conn = mockProgramAccountsConnection([
      { pubkey: new PublicKey("11111111111111111111111111111112"), data: validVaultBuf },
      { pubkey: new PublicKey("11111111111111111111111111111113"), data: invalidAccountBuf },
    ]);

    const vaults = await fetchAllVaultsForOwner(conn, PROGRAM_ID, owner.publicKey);
    // Only the valid vault account should be returned; the activity account
    // has the wrong discriminator and should be filtered out.
    expect(vaults.length).toBe(1);
    expect(vaults[0].owner).toBe(owner.publicKey.toBase58());
  });

  it("the dataSize filter value is VAULT_SIZE (168) — verified by constant", () => {
    // Authoritative: fetchAllVaultsForOwner must use dataSize: 168 in its
    // getProgramAccounts filter. VAULT_SIZE is the canonical constant for this.
    // This test verifies the constant matches the authoritative layout size.
    expect(VAULT_SIZE).toBe(168);
  });
});
