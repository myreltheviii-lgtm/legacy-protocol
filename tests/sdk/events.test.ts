// tests/sdk/events.test.ts
//
// Tests for all 19 event parsers in sdk/src/events.ts.
// Framework: Jest.
//
// All 17 original event parsers plus the 2 Cloak integration event parsers
// (parseCloakDepositRecordedEvent, parseInheritanceCloakClaimedEvent) are
// tested individually and in the parseLegacyEventsFromLogs batch.

import { createHash } from "node:crypto";
import { PublicKey }  from "@solana/web3.js";
import {
  parseVaultInitialisedEvent,
  parseCheckedInEvent,
  parseInheritanceTriggeredEvent,
  parseInheritanceClaimedEvent,
  parseEmergencySweptEvent,
  parseAnomalyFlaggedEvent,
  parseThresholdUpdatedEvent,
  parseDepositedEvent,
  parseVaultClosedEvent,
  parseGuardianAddedEvent,
  parseGuardianRemovalInitiatedEvent,
  parseGuardianRemovedEvent,
  parseCovenantCreatedEvent,
  parseCovenantSignedEvent,
  parseBeneficiaryChangedEvent,
  parseGuardianRemovedByCovenantEvent,
  parseOrphanedCovenantClosedEvent,
  parseCloakDepositRecordedEvent,
  parseInheritanceCloakClaimedEvent,
  parseLegacyEventFromLog,
  parseLegacyEventsFromLogs,
} from "../../sdk/src/events";
import { CovenantType } from "../../sdk/src/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function eventDisc(name: string): Buffer {
  return Buffer.from(createHash("sha256").update(`event:${name}`).digest()).slice(0, 8);
}

class Writer {
  private parts: Buffer[] = [];

  pubkey(pk: PublicKey): this {
    this.parts.push(Buffer.from(pk.toBytes()));
    return this;
  }

  u64(n: bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    this.parts.push(b);
    return this;
  }

  // CRITICAL: n must be a number, NOT a string enum value.
  // CovenantType is a string enum — passing CovenantType.BeneficiaryChange (= "BeneficiaryChange")
  // would result in "BeneficiaryChange" & 0xff = NaN & 0xff = 0, silently writing byte 0
  // (EmergencySweep) instead of byte 1 (BeneficiaryChange). Always pass the numeric
  // discriminant directly (0, 1, or 2).
  u8(n: number): this {
    this.parts.push(Buffer.from([n & 0xff]));
    return this;
  }

  bool(v: boolean): this {
    this.parts.push(Buffer.from([v ? 1 : 0]));
    return this;
  }

  // Writes raw 32 bytes — used for [u8;32] fields (utxo commitments, UTXO pubkeys).
  bytes32(arr: Uint8Array): this {
    this.parts.push(Buffer.from(arr.slice(0, 32)));
    return this;
  }

  // Writes raw 64 bytes — used for [u8;64] fields (Cloak transfer signatures).
  bytes64(arr: Uint8Array): this {
    this.parts.push(Buffer.from(arr.slice(0, 64)));
    return this;
  }

  build(eventName: string): Buffer {
    return Buffer.concat([eventDisc(eventName), ...this.parts]);
  }
}

const VAULT    = new PublicKey("So11111111111111111111111111111111111111112");
const OWNER    = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const BEN      = new PublicKey("11111111111111111111111111111112");
const GUARDIAN = new PublicKey("11111111111111111111111111111113");
const COVENANT = new PublicKey("11111111111111111111111111111114");

// Covenant type numeric discriminants — must be used instead of the string enum
// when writing bytes to buffers. CovenantType string values coerce to NaN → 0.
const COVENANT_TYPE_EMERGENCY_SWEEP    = 0; // CovenantType.EmergencySweep
const COVENANT_TYPE_BENEFICIARY_CHANGE = 1; // CovenantType.BeneficiaryChange
const COVENANT_TYPE_GUARDIAN_REMOVAL   = 2; // CovenantType.GuardianRemoval

// ── Individual parsers ────────────────────────────────────────────────────────

describe("parseVaultInitialisedEvent", () => {
  it("parses all fields correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(OWNER)
      .pubkey(BEN)
      .u64(5_000_000n)
      .u64(100n)
      .build("VaultInitialised");

    const event = parseVaultInitialisedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("VaultInitialised");
    expect(event!.vault).toBe(VAULT.toBase58());
    expect(event!.owner).toBe(OWNER.toBase58());
    expect((event as any).beneficiaryUtxoPubkey).toBe(BEN.toBuffer().toString("hex"));
    expect((event as any).thresholdSlots).toBe(5_000_000n);
    expect((event as any).createdSlot).toBe(100n);
  });

  it("returns null for wrong discriminator", () => {
    const data = new Writer().pubkey(VAULT).pubkey(OWNER).pubkey(BEN).u64(5_000_000n).u64(100n).build("CheckedIn");
    expect(parseVaultInitialisedEvent(data)).toBeNull();
  });
});

describe("parseCheckedInEvent", () => {
  it("parses all fields correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(OWNER)
      .u64(500n)
      .u64(100n)
      .u64(3n)
      .build("CheckedIn");

    const event = parseCheckedInEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("CheckedIn");
    expect(event!.vault).toBe(VAULT.toBase58());
    expect((event as any).slot).toBe(500n);
    expect((event as any).interval).toBe(100n);
    expect((event as any).checkinCount).toBe(3n);
  });

  it("returns null for wrong discriminator", () => {
    const data = new Writer().pubkey(VAULT).pubkey(OWNER).u64(1n).u64(1n).u64(1n).build("VaultInitialised");
    expect(parseCheckedInEvent(data)).toBeNull();
  });
});

describe("parseInheritanceTriggeredEvent", () => {
  it("parses triggeredSlot and lastCheckInSlot correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(OWNER)
      .pubkey(BEN)
      .u64(5_000_100n)
      .u64(100n)
      .u64(1_000_000_000n)
      .build("InheritanceTriggered");

    const event = parseInheritanceTriggeredEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("InheritanceTriggered");
    expect((event as any).triggeredSlot).toBe(5_000_100n);
    expect((event as any).lastCheckInSlot).toBe(100n);
    expect((event as any).depositedLamports).toBe(1_000_000_000n);
  });
});

describe("parseInheritanceClaimedEvent", () => {
  it("parses all lamport amounts correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(BEN)
      .u64(2_000_000_000n)
      .u64(5_500_000n)
      .build("InheritanceClaimed");

    const event = parseInheritanceClaimedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("InheritanceClaimed");
    expect(event!.vault).toBe(VAULT.toBase58());
    expect((event as any).lamports).toBe(2_000_000_000n);
    expect((event as any).claimedSlot).toBe(5_500_000n);
  });
});

describe("parseEmergencySweptEvent", () => {
  it("parses caller rent amount correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(BEN)
      .u64(3_000_000_000n)
      .u64(5_000_200n)
      .pubkey(COVENANT)
      .build("EmergencySwept");

    const event = parseEmergencySweptEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("EmergencySwept");
    expect((event as any).lamports).toBe(3_000_000_000n);
    expect((event as any).sweptSlot).toBe(5_000_200n);
    expect((event as any).covenant).toBe(COVENANT.toBase58());
  });
});

describe("parseAnomalyFlaggedEvent", () => {
  it("parses anomaly_flagged_slot correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(GUARDIAN)
      .u64(4_500_000n)
      .u64(1_000_000n)
      .u64(5n)
      .build("AnomalyFlagged");

    const event = parseAnomalyFlaggedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("AnomalyFlagged");
    expect((event as any).flaggedSlot).toBe(4_500_000n);
    expect((event as any).lastCheckInSlot).toBe(1_000_000n);
    expect((event as any).checkinCount).toBe(5n);
  });
});

describe("parseThresholdUpdatedEvent", () => {
  it("parses old and new threshold correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .u64(5_000_000n)
      .u64(10_000_000n)
      .build("ThresholdUpdated");

    const event = parseThresholdUpdatedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("ThresholdUpdated");
    expect((event as any).oldThreshold).toBe(5_000_000n);
    expect((event as any).newThreshold).toBe(10_000_000n);
  });
});

describe("parseDepositedEvent", () => {
  it("parses lamports and total correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .u64(500_000_000n)
      .u64(1_000_000_000n)
      .build("Deposited");

    const event = parseDepositedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("Deposited");
    expect((event as any).lamports).toBe(500_000_000n);
    expect((event as any).total).toBe(1_000_000_000n);
  });
});

describe("parseVaultClosedEvent", () => {
  it("parses vault and owner correctly", () => {
    const data = new Writer().pubkey(VAULT).pubkey(OWNER).build("VaultClosed");
    const event = parseVaultClosedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("VaultClosed");
    expect(event!.vault).toBe(VAULT.toBase58());
    expect((event as any).owner).toBe(OWNER.toBase58());
  });
});

describe("parseGuardianAddedEvent", () => {
  it("parses guardian_count and mOfN correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(GUARDIAN)
      .u8(3)
      .u8(2)
      .build("GuardianAdded");

    const event = parseGuardianAddedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("GuardianAdded");
    expect((event as any).guardianCount).toBe(3);
    expect((event as any).mOfN).toBe(2);
  });
});

describe("parseGuardianRemovalInitiatedEvent", () => {
  it("parses removal slots correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(GUARDIAN)
      .u64(1_000_000n)
      .u64(1_216_000n)
      .build("GuardianRemovalInitiated");

    const event = parseGuardianRemovalInitiatedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("GuardianRemovalInitiated");
    expect((event as any).removalRequestedSlot).toBe(1_000_000n);
    expect((event as any).finaliseAfterSlot).toBe(1_216_000n);
  });
});

describe("parseGuardianRemovedEvent", () => {
  it("parses threshold_lowered bool correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(GUARDIAN)
      .u8(2)
      .u8(2)
      .bool(false)
      .build("GuardianRemoved");

    const event = parseGuardianRemovedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("GuardianRemoved");
    expect((event as any).guardianCount).toBe(2);
    expect((event as any).thresholdLowered).toBe(false);
  });

  it("parses threshold_lowered=true correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(GUARDIAN)
      .u8(1)
      .u8(1)
      .bool(true)
      .build("GuardianRemoved");

    const event = parseGuardianRemovedEvent(data);
    expect((event as any).thresholdLowered).toBe(true);
  });
});

describe("parseCovenantCreatedEvent", () => {
  it("parses covenant_type EmergencySweep (byte 0) and covenant_index correctly", () => {
    // Use numeric discriminant 0 for EmergencySweep.
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u8(COVENANT_TYPE_EMERGENCY_SWEEP) // 0
      .u64(0n)
      .u8(2)
      .pubkey(GUARDIAN)
      .build("CovenantCreated");

    const event = parseCovenantCreatedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("CovenantCreated");
    expect((event as any).covenantType).toBe(CovenantType.EmergencySweep);
    expect((event as any).covenantIndex).toBe(0n);
    expect((event as any).requiredSigs).toBe(2);
  });

  it("parses covenant_type BeneficiaryChange (byte 1) correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u8(COVENANT_TYPE_BENEFICIARY_CHANGE) // 1
      .u64(3n)
      .u8(2)
      .pubkey(GUARDIAN)
      .build("CovenantCreated");

    const event = parseCovenantCreatedEvent(data);
    expect(event).not.toBeNull();
    expect((event as any).covenantType).toBe(CovenantType.BeneficiaryChange);
    expect((event as any).covenantIndex).toBe(3n);
  });

  it("parses covenant_type GuardianRemoval (byte 2) correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u8(COVENANT_TYPE_GUARDIAN_REMOVAL) // 2
      .u64(1n)
      .u8(1)
      .pubkey(GUARDIAN)
      .build("CovenantCreated");

    const event = parseCovenantCreatedEvent(data);
    expect(event).not.toBeNull();
    expect((event as any).covenantType).toBe(CovenantType.GuardianRemoval);
  });
});

describe("parseCovenantSignedEvent", () => {
  it("parses totalSigners and threshold_reached correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .pubkey(GUARDIAN)
      .u8(2)
      .u8(2)
      .bool(true)
      .build("CovenantSigned");

    const event = parseCovenantSignedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("CovenantSigned");
    expect((event as any).totalSigners).toBe(2);
    expect((event as any).thresholdReached).toBe(true);
  });
});

describe("parseBeneficiaryChangedEvent", () => {
  it("parses oldBeneficiaryUtxoPubkey and newBeneficiaryUtxoPubkey as hex strings", () => {
    // On-chain struct: vault(Pubkey), old_beneficiary_utxo_pubkey([u8;32]),
    // new_beneficiary_utxo_pubkey([u8;32]), covenant(Pubkey), executed_slot(u64).
    // [u8;32] and Pubkey have identical 32-byte wire representation, so .pubkey()
    // correctly writes the bytes the parser then reads via .bytes32Hex() as hex.
    const newBen = new PublicKey("11111111111111111111111111111115");
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(BEN)        // old_beneficiary_utxo_pubkey as [u8;32]
      .pubkey(newBen)     // new_beneficiary_utxo_pubkey as [u8;32]
      .pubkey(COVENANT)
      .u64(6_000_000n)
      .build("BeneficiaryChanged");

    const event = parseBeneficiaryChangedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("BeneficiaryChanged");
    // Field names are oldBeneficiaryUtxoPubkey and newBeneficiaryUtxoPubkey (hex strings).
    // The parser reads [u8;32] as bytes32Hex(), producing the 64-char hex of the pubkey bytes.
    expect((event as any).oldBeneficiaryUtxoPubkey).toBe(BEN.toBuffer().toString("hex"));
    expect((event as any).newBeneficiaryUtxoPubkey).toBe(newBen.toBuffer().toString("hex"));
    expect((event as any).covenant).toBe(COVENANT.toBase58());
    expect((event as any).executedSlot).toBe(6_000_000n);
  });
});

describe("parseGuardianRemovedByCovenantEvent", () => {
  it("parses all 7 fields correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(GUARDIAN)
      .pubkey(COVENANT)
      .u8(2)
      .u8(2)
      .bool(false)
      .u64(5_100_000n)
      .build("GuardianRemovedByCovenant");

    const event = parseGuardianRemovedByCovenantEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("GuardianRemovedByCovenant");
    expect((event as any).guardianCount).toBe(2);
    expect((event as any).executedSlot).toBe(5_100_000n);
    expect((event as any).thresholdLowered).toBe(false);
  });
});

describe("parseOrphanedCovenantClosedEvent", () => {
  it("parses covenant_index and covenant_type BeneficiaryChange (byte 1) correctly", () => {
    // CRITICAL: Must use numeric discriminant 1 for BeneficiaryChange.
    const CALLER = new PublicKey("11111111111111111111111111111116");
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u64(3n)
      .u8(COVENANT_TYPE_BENEFICIARY_CHANGE) // 1 — must NOT be CovenantType.BeneficiaryChange
      .pubkey(CALLER)
      .u64(5_200_000n)
      .build("OrphanedCovenantClosed");

    const event = parseOrphanedCovenantClosedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("OrphanedCovenantClosed");
    expect((event as any).covenantIndex).toBe(3n);
    expect((event as any).covenantType).toBe(CovenantType.BeneficiaryChange);
    expect((event as any).closedSlot).toBe(5_200_000n);
  });

  it("parses covenant_type EmergencySweep (byte 0) correctly", () => {
    const CALLER2 = new PublicKey("11111111111111111111111111111117");
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u64(0n)
      .u8(COVENANT_TYPE_EMERGENCY_SWEEP) // 0
      .pubkey(CALLER2)
      .u64(5_300_000n)
      .build("OrphanedCovenantClosed");

    const event = parseOrphanedCovenantClosedEvent(data);
    expect(event).not.toBeNull();
    expect((event as any).covenantType).toBe(CovenantType.EmergencySweep);
  });

  it("parses covenant_type GuardianRemoval (byte 2) correctly", () => {
    const CALLER3 = new PublicKey("11111111111111111111111111111118");
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u64(5n)
      .u8(COVENANT_TYPE_GUARDIAN_REMOVAL) // 2
      .pubkey(CALLER3)
      .u64(5_400_000n)
      .build("OrphanedCovenantClosed");

    const event = parseOrphanedCovenantClosedEvent(data);
    expect(event).not.toBeNull();
    expect((event as any).covenantType).toBe(CovenantType.GuardianRemoval);
  });
});

// ── Cloak integration event parsers ──────────────────────────────────────────
//
// These two parsers were added with record_cloak_deposit / record_cloak_claim.
// They are part of ALL_PARSERS so parseLegacyEventsFromLogs dispatches to them.

describe("parseCloakDepositRecordedEvent", () => {
  it("parses all 6 fields correctly", () => {
    // On-chain struct: vault(Pubkey), owner(Pubkey), utxo_commitment([u8;32]),
    // utxo_leaf_index(u64), lamports(u64), total_lamports(u64).
    const utxoCommitment = new Uint8Array(32);
    for (let i = 0; i < 32; i++) utxoCommitment[i] = (0x11 + i) & 0xff;

    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(OWNER)
      .bytes32(utxoCommitment)
      .u64(42n)
      .u64(1_000_000_000n)
      .u64(2_000_000_000n)
      .build("CloakDepositRecorded");

    const event = parseCloakDepositRecordedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("CloakDepositRecorded");
    expect(event!.vault).toBe(VAULT.toBase58());
    expect((event as any).owner).toBe(OWNER.toBase58());
    expect((event as any).utxoCommitment).toBe(Buffer.from(utxoCommitment).toString("hex"));
    expect((event as any).utxoLeafIndex).toBe(42n);
    expect((event as any).lamports).toBe(1_000_000_000n);
    expect((event as any).totalLamports).toBe(2_000_000_000n);
  });

  it("returns null for wrong discriminator", () => {
    const data = new Writer().pubkey(VAULT).pubkey(OWNER).build("VaultClosed");
    expect(parseCloakDepositRecordedEvent(data)).toBeNull();
  });

  it("does not throw on malformed data — returns null", () => {
    const bad = Buffer.alloc(4, 0xff);
    expect(() => parseCloakDepositRecordedEvent(bad)).not.toThrow();
    expect(parseCloakDepositRecordedEvent(bad)).toBeNull();
  });
});

describe("parseInheritanceCloakClaimedEvent", () => {
  it("parses all 5 fields correctly", () => {
    // On-chain struct: vault(Pubkey), beneficiary_utxo_pubkey([u8;32]),
    // lamports(u64), cloak_transfer_signature([u8;64]), claimed_slot(u64).
    const beneficiaryUtxoPubkey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) beneficiaryUtxoPubkey[i] = (0x22 + i) & 0xff;

    const cloakSig = new Uint8Array(64);
    for (let i = 0; i < 64; i++) cloakSig[i] = (0xab + i) & 0xff;

    const data = new Writer()
      .pubkey(VAULT)
      .bytes32(beneficiaryUtxoPubkey)
      .u64(1_500_000_000n)
      .bytes64(cloakSig)
      .u64(5_100_000n)
      .build("InheritanceCloakClaimed");

    const event = parseInheritanceCloakClaimedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("InheritanceCloakClaimed");
    expect(event!.vault).toBe(VAULT.toBase58());
    expect((event as any).beneficiaryUtxoPubkey).toBe(Buffer.from(beneficiaryUtxoPubkey).toString("hex"));
    expect((event as any).lamports).toBe(1_500_000_000n);
    expect((event as any).cloakTransferSignature).toBe(Buffer.from(cloakSig).toString("hex"));
    expect((event as any).claimedSlot).toBe(5_100_000n);
  });

  it("all 64 cloak_transfer_signature bytes preserved — no truncation", () => {
    const distinctSig = new Uint8Array(64);
    for (let i = 0; i < 64; i++) distinctSig[i] = (0xde + i * 13) & 0xff;
    const beneficiaryUtxoPubkey = new Uint8Array(32).fill(0x01);

    const data = new Writer()
      .pubkey(VAULT)
      .bytes32(beneficiaryUtxoPubkey)
      .u64(500_000_000n)
      .bytes64(distinctSig)
      .u64(6_000_000n)
      .build("InheritanceCloakClaimed");

    const event = parseInheritanceCloakClaimedEvent(data);
    expect(event).not.toBeNull();
    expect((event as any).cloakTransferSignature).toBe(Buffer.from(distinctSig).toString("hex"));
    expect((event as any).cloakTransferSignature.length).toBe(128); // 64 bytes = 128 hex chars
  });

  it("returns null for wrong discriminator", () => {
    const data = new Writer().pubkey(VAULT).pubkey(OWNER).build("VaultClosed");
    expect(parseInheritanceCloakClaimedEvent(data)).toBeNull();
  });

  it("does not throw on malformed data — returns null", () => {
    const bad = Buffer.alloc(4, 0xff);
    expect(() => parseInheritanceCloakClaimedEvent(bad)).not.toThrow();
    expect(parseInheritanceCloakClaimedEvent(bad)).toBeNull();
  });
});

// ── parseLegacyEventFromLog ───────────────────────────────────────────────────

describe("parseLegacyEventFromLog", () => {
  it("parses a valid Program data: log line", () => {
    const data = new Writer().pubkey(VAULT).pubkey(OWNER).build("VaultClosed");
    const b64  = data.toString("base64");
    const event = parseLegacyEventFromLog(`Program data: ${b64}`);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("VaultClosed");
  });

  it("returns null for non-Program-data log line", () => {
    expect(parseLegacyEventFromLog("Program log: Instruction: CheckIn")).toBeNull();
    expect(parseLegacyEventFromLog("")).toBeNull();
    expect(parseLegacyEventFromLog("Program data: ")).toBeNull();
  });

  it("returns null for malformed base64 data", () => {
    expect(parseLegacyEventFromLog("Program data: !!!not base64!!!")).toBeNull();
  });

  it("returns null for unknown discriminator", () => {
    const data = Buffer.alloc(16, 0xde); // 16 bytes of 0xde — unknown discriminator
    const b64  = data.toString("base64");
    expect(parseLegacyEventFromLog(`Program data: ${b64}`)).toBeNull();
  });

  it("returns null for data shorter than 8 bytes", () => {
    const data = Buffer.from([1, 2, 3]);
    const b64  = data.toString("base64");
    expect(parseLegacyEventFromLog(`Program data: ${b64}`)).toBeNull();
  });

  it("does not throw on malformed data — returns null", () => {
    expect(() => parseLegacyEventFromLog("Program data: aaaaaaaaaaaaa")).not.toThrow();
  });
});

describe("parseLegacyEventsFromLogs", () => {
  it("parses all 19 event types from a batch of log lines (17 original + 2 Cloak)", () => {
    // Build one valid log line for each of the 19 event types and verify all are parsed.
    const newBen   = new PublicKey("11111111111111111111111111111115");
    const CALLER   = new PublicKey("11111111111111111111111111111116");

    const utxoCommitment        = new Uint8Array(32).fill(0x33);
    const beneficiaryUtxoPubkey = new Uint8Array(32).fill(0x44);
    const cloakSig              = new Uint8Array(64).fill(0xab);

    const eventBuffers: Buffer[] = [
      // 1. VaultInitialised
      new Writer().pubkey(VAULT).pubkey(OWNER).pubkey(BEN).u64(5_000_000n).u64(100n).build("VaultInitialised"),
      // 2. CheckedIn
      new Writer().pubkey(VAULT).pubkey(OWNER).u64(500n).u64(100n).u64(3n).build("CheckedIn"),
      // 3. InheritanceTriggered
      new Writer().pubkey(VAULT).pubkey(OWNER).pubkey(BEN).u64(5_000_100n).u64(100n).u64(1_000_000_000n).build("InheritanceTriggered"),
      // 4. InheritanceClaimed
      new Writer().pubkey(VAULT).pubkey(BEN).u64(2_000_000_000n).u64(5_500_000n).build("InheritanceClaimed"),
      // 5. EmergencySwept
      new Writer().pubkey(VAULT).pubkey(BEN).u64(3_000_000_000n).u64(5_000_200n).pubkey(COVENANT).build("EmergencySwept"),
      // 6. AnomalyFlagged
      new Writer().pubkey(VAULT).pubkey(GUARDIAN).u64(4_500_000n).u64(1_000_000n).u64(5n).build("AnomalyFlagged"),
      // 7. ThresholdUpdated
      new Writer().pubkey(VAULT).u64(5_000_000n).u64(10_000_000n).build("ThresholdUpdated"),
      // 8. Deposited
      new Writer().pubkey(VAULT).u64(500_000_000n).u64(1_000_000_000n).build("Deposited"),
      // 9. VaultClosed
      new Writer().pubkey(VAULT).pubkey(OWNER).build("VaultClosed"),
      // 10. GuardianAdded
      new Writer().pubkey(VAULT).pubkey(GUARDIAN).u8(3).u8(2).build("GuardianAdded"),
      // 11. GuardianRemovalInitiated
      new Writer().pubkey(VAULT).pubkey(GUARDIAN).u64(1_000_000n).u64(1_216_000n).build("GuardianRemovalInitiated"),
      // 12. GuardianRemoved
      new Writer().pubkey(VAULT).pubkey(GUARDIAN).u8(2).u8(2).bool(false).build("GuardianRemoved"),
      // 13. CovenantCreated — numeric discriminant 0 for EmergencySweep
      new Writer().pubkey(VAULT).pubkey(COVENANT).u8(COVENANT_TYPE_EMERGENCY_SWEEP).u64(0n).u8(2).pubkey(GUARDIAN).build("CovenantCreated"),
      // 14. CovenantSigned
      new Writer().pubkey(VAULT).pubkey(COVENANT).pubkey(GUARDIAN).u8(2).u8(2).bool(true).build("CovenantSigned"),
      // 15. BeneficiaryChanged
      new Writer().pubkey(VAULT).pubkey(BEN).pubkey(newBen).pubkey(COVENANT).u64(6_000_000n).build("BeneficiaryChanged"),
      // 16. GuardianRemovedByCovenant
      new Writer().pubkey(VAULT).pubkey(GUARDIAN).pubkey(COVENANT).u8(2).u8(2).bool(false).u64(5_100_000n).build("GuardianRemovedByCovenant"),
      // 17. OrphanedCovenantClosed — numeric discriminant 1 for BeneficiaryChange
      new Writer().pubkey(VAULT).pubkey(COVENANT).u64(3n).u8(COVENANT_TYPE_BENEFICIARY_CHANGE).pubkey(CALLER).u64(5_200_000n).build("OrphanedCovenantClosed"),
      // 18. CloakDepositRecorded
      new Writer().pubkey(VAULT).pubkey(OWNER).bytes32(utxoCommitment).u64(42n).u64(1_000_000_000n).u64(1_000_000_000n).build("CloakDepositRecorded"),
      // 19. InheritanceCloakClaimed
      new Writer().pubkey(VAULT).bytes32(beneficiaryUtxoPubkey).u64(1_500_000_000n).bytes64(cloakSig).u64(5_100_000n).build("InheritanceCloakClaimed"),
    ];

    const expectedNames = [
      "VaultInitialised",
      "CheckedIn",
      "InheritanceTriggered",
      "InheritanceClaimed",
      "EmergencySwept",
      "AnomalyFlagged",
      "ThresholdUpdated",
      "Deposited",
      "VaultClosed",
      "GuardianAdded",
      "GuardianRemovalInitiated",
      "GuardianRemoved",
      "CovenantCreated",
      "CovenantSigned",
      "BeneficiaryChanged",
      "GuardianRemovedByCovenant",
      "OrphanedCovenantClosed",
      "CloakDepositRecorded",
      "InheritanceCloakClaimed",
    ];

    // Build a log array interleaved with noise to verify filtering
    const logs: string[] = [];
    for (const buf of eventBuffers) {
      logs.push("Program log: noise line");
      logs.push(`Program data: ${buf.toString("base64")}`);
    }

    const events = parseLegacyEventsFromLogs(logs);
    expect(events.length).toBe(19);

    for (let i = 0; i < 19; i++) {
      expect(events[i].name).toBe(expectedNames[i]);
    }
  });

  it("returns empty array when no program data logs", () => {
    const events = parseLegacyEventsFromLogs(["Program log: Instruction: CloseVault"]);
    expect(events.length).toBe(0);
  });

  it("skips non-program-data lines without throwing", () => {
    expect(() => parseLegacyEventsFromLogs(["not a valid log", "", "also nothing"])).not.toThrow();
  });

  it("returns empty array for empty log array", () => {
    expect(parseLegacyEventsFromLogs([])).toEqual([]);
  });
});

// ── All 19 events: parse success + malformed input ────────────────────────────

describe("all 19 events: malformed input returns null, does not throw", () => {
  const parsers = [
    parseVaultInitialisedEvent,
    parseCheckedInEvent,
    parseInheritanceTriggeredEvent,
    parseInheritanceClaimedEvent,
    parseEmergencySweptEvent,
    parseAnomalyFlaggedEvent,
    parseThresholdUpdatedEvent,
    parseDepositedEvent,
    parseVaultClosedEvent,
    parseGuardianAddedEvent,
    parseGuardianRemovalInitiatedEvent,
    parseGuardianRemovedEvent,
    parseCovenantCreatedEvent,
    parseCovenantSignedEvent,
    parseBeneficiaryChangedEvent,
    parseGuardianRemovedByCovenantEvent,
    parseOrphanedCovenantClosedEvent,
    parseCloakDepositRecordedEvent,
    parseInheritanceCloakClaimedEvent,
  ];

  const malformed = Buffer.alloc(4, 0xff); // too short, bad discriminator

  for (const parser of parsers) {
    it(`${parser.name}: returns null on malformed data`, () => {
      expect(parser(malformed)).toBeNull();
    });

    it(`${parser.name}: does not throw on empty buffer`, () => {
      expect(() => parser(Buffer.alloc(0))).not.toThrow();
    });

    it(`${parser.name}: returns null for wrong discriminator (all-zeros 8-byte prefix)`, () => {
      const wrongDisc = Buffer.alloc(40, 0);
      expect(parser(wrongDisc)).toBeNull();
    });
  }
});
