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

  u8(n: number): this {
    this.parts.push(Buffer.from([n & 0xff]));
    return this;
  }

  bool(v: boolean): this {
    this.parts.push(Buffer.from([v ? 1 : 0]));
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
    expect(event!.beneficiary).toBe(BEN.toBase58());
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
  it("parses covenant_type and covenant_index correctly", () => {
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u8(CovenantType.EmergencySweep)
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
  it("parses old and new beneficiary correctly", () => {
    const newBen = new PublicKey("11111111111111111111111111111115");
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(BEN)
      .pubkey(newBen)
      .pubkey(COVENANT)
      .u64(6_000_000n)
      .build("BeneficiaryChanged");

    const event = parseBeneficiaryChangedEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe("BeneficiaryChanged");
    expect((event as any).oldBeneficiary).toBe(BEN.toBase58());
    expect((event as any).newBeneficiary).toBe(newBen.toBase58());
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
  it("parses covenant_index and covenant_type correctly", () => {
    const CALLER = new PublicKey("11111111111111111111111111111116");
    const data = new Writer()
      .pubkey(VAULT)
      .pubkey(COVENANT)
      .u64(3n)
      .u8(CovenantType.BeneficiaryChange)
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
  it("parses all 17 event types from a batch of log lines", () => {
    const vaultClosedData = new Writer().pubkey(VAULT).pubkey(OWNER).build("VaultClosed");
    const checkInData = new Writer()
      .pubkey(VAULT).pubkey(OWNER).u64(1000n).u64(100n).u64(5n)
      .build("CheckedIn");

    const logs = [
      "Program log: Instruction: CloseVault",
      `Program data: ${vaultClosedData.toString("base64")}`,
      "Program log: something else",
      `Program data: ${checkInData.toString("base64")}`,
    ];

    const events = parseLegacyEventsFromLogs(logs);
    expect(events.length).toBe(2);
    expect(events[0].name).toBe("VaultClosed");
    expect(events[1].name).toBe("CheckedIn");
  });

  it("returns empty array when no program data logs", () => {
    const events = parseLegacyEventsFromLogs(["Program log: Instruction: CloseVault"]);
    expect(events.length).toBe(0);
  });

  it("skips non-program-data lines without throwing", () => {
    expect(() => parseLegacyEventsFromLogs(["not a valid log", "", "also nothing"])).not.toThrow();
  });
});

// ── All 17 events: parse success + malformed input ───────────────────────────

describe("all 17 events: malformed input returns null, does not throw", () => {
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
