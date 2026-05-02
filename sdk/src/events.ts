// sdk/src/events.ts
//
// Parsers for all 17 on-chain events emitted by the Legacy Vault program.
//
// Anchor emits events as base64-encoded data in program log lines that start
// with "Program data: ". The decoded bytes are:
//   [0..8]  — 8-byte event discriminator = sha256("event:EventName")[0..8]
//   [8..]   — borsh-encoded event fields in declaration order
//
// Every event struct field is read in the exact order it appears in the Rust
// source. Pubkeys are 32 bytes, u64 is 8 bytes LE, u8/bool is 1 byte, and
// the CovenantType enum is 1 byte (variant index 0/1/2).

import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { CovenantType, LegacyEvent } from "./types";

// ── Discriminator computation ─────────────────────────────────────────────────

function eventDiscriminator(name: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`event:${name}`).digest(),
  ).slice(0, 8);
}

// Pre-compute all 17 discriminators at module load time. Each is 8 bytes.
const DISC: Record<string, Buffer> = {
  VaultInitialised:          eventDiscriminator("VaultInitialised"),
  CheckedIn:                 eventDiscriminator("CheckedIn"),
  InheritanceTriggered:      eventDiscriminator("InheritanceTriggered"),
  InheritanceClaimed:        eventDiscriminator("InheritanceClaimed"),
  EmergencySwept:            eventDiscriminator("EmergencySwept"),
  AnomalyFlagged:            eventDiscriminator("AnomalyFlagged"),
  ThresholdUpdated:          eventDiscriminator("ThresholdUpdated"),
  Deposited:                 eventDiscriminator("Deposited"),
  VaultClosed:               eventDiscriminator("VaultClosed"),
  GuardianAdded:             eventDiscriminator("GuardianAdded"),
  GuardianRemovalInitiated:  eventDiscriminator("GuardianRemovalInitiated"),
  GuardianRemoved:           eventDiscriminator("GuardianRemoved"),
  CovenantCreated:           eventDiscriminator("CovenantCreated"),
  CovenantSigned:            eventDiscriminator("CovenantSigned"),
  BeneficiaryChanged:        eventDiscriminator("BeneficiaryChanged"),
  GuardianRemovedByCovenant: eventDiscriminator("GuardianRemovedByCovenant"),
  OrphanedCovenantClosed:    eventDiscriminator("OrphanedCovenantClosed"),
};

// ── Binary reading helpers ────────────────────────────────────────────────────

class Reader {
  private pos: number;

  constructor(private buf: Buffer, startAt: number = 0) {
    this.pos = startAt;
  }

  pubkey(): string {
    const pk = new PublicKey(this.buf.slice(this.pos, this.pos + 32)).toBase58();
    this.pos += 32;
    return pk;
  }

  u64(): bigint {
    const val = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return val;
  }

  u8(): number {
    const val = this.buf[this.pos];
    this.pos += 1;
    return val;
  }

  bool(): boolean {
    const val = this.buf[this.pos] === 1;
    this.pos += 1;
    return val;
  }

  covenantType(): CovenantType {
    return this.u8() as CovenantType;
  }
}

// ── Individual event parsers ──────────────────────────────────────────────────

export function parseVaultInitialisedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["VaultInitialised"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:           "VaultInitialised",
    vault:          r.pubkey(),
    owner:          r.pubkey(),
    beneficiary:    r.pubkey(),
    thresholdSlots: r.u64(),
    createdSlot:    r.u64(),
  };
}

export function parseCheckedInEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["CheckedIn"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:         "CheckedIn",
    vault:        r.pubkey(),
    owner:        r.pubkey(),
    slot:         r.u64(),
    interval:     r.u64(),
    checkinCount: r.u64(),
  };
}

export function parseInheritanceTriggeredEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["InheritanceTriggered"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:              "InheritanceTriggered",
    vault:             r.pubkey(),
    owner:             r.pubkey(),
    beneficiary:       r.pubkey(),
    triggeredSlot:     r.u64(),
    lastCheckInSlot:   r.u64(),
    depositedLamports: r.u64(),
  };
}

export function parseInheritanceClaimedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["InheritanceClaimed"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:        "InheritanceClaimed",
    vault:       r.pubkey(),
    beneficiary: r.pubkey(),
    lamports:    r.u64(),
    claimedSlot: r.u64(),
  };
}

export function parseEmergencySweptEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["EmergencySwept"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:        "EmergencySwept",
    vault:       r.pubkey(),
    beneficiary: r.pubkey(),
    lamports:    r.u64(),
    sweptSlot:   r.u64(),
    covenant:    r.pubkey(),
  };
}

export function parseAnomalyFlaggedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["AnomalyFlagged"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:            "AnomalyFlagged",
    vault:           r.pubkey(),
    guardian:        r.pubkey(),
    flaggedSlot:     r.u64(),
    lastCheckInSlot: r.u64(),
    checkinCount:    r.u64(),
  };
}

export function parseThresholdUpdatedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["ThresholdUpdated"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:         "ThresholdUpdated",
    vault:        r.pubkey(),
    oldThreshold: r.u64(),
    newThreshold: r.u64(),
  };
}

export function parseDepositedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["Deposited"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:     "Deposited",
    vault:    r.pubkey(),
    lamports: r.u64(),
    total:    r.u64(),
  };
}

export function parseVaultClosedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["VaultClosed"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:  "VaultClosed",
    vault: r.pubkey(),
    owner: r.pubkey(),
  };
}

export function parseGuardianAddedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["GuardianAdded"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:          "GuardianAdded",
    vault:         r.pubkey(),
    guardian:      r.pubkey(),
    guardianCount: r.u8(),
    mOfN:          r.u8(),
  };
}

export function parseGuardianRemovalInitiatedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["GuardianRemovalInitiated"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:                 "GuardianRemovalInitiated",
    vault:                r.pubkey(),
    guardian:             r.pubkey(),
    removalRequestedSlot: r.u64(),
    finaliseAfterSlot:    r.u64(),
  };
}

export function parseGuardianRemovedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["GuardianRemoved"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:             "GuardianRemoved",
    vault:            r.pubkey(),
    guardian:         r.pubkey(),
    guardianCount:    r.u8(),
    mOfN:             r.u8(),
    thresholdLowered: r.bool(),
  };
}

export function parseCovenantCreatedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["CovenantCreated"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:          "CovenantCreated",
    vault:         r.pubkey(),
    covenant:      r.pubkey(),
    covenantType:  r.covenantType(),
    covenantIndex: r.u64(),
    requiredSigs:  r.u8(),
    firstSigner:   r.pubkey(),
  };
}

export function parseCovenantSignedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["CovenantSigned"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:             "CovenantSigned",
    vault:            r.pubkey(),
    covenant:         r.pubkey(),
    guardian:         r.pubkey(),
    totalSigners:     r.u8(),
    requiredSigners:  r.u8(),
    thresholdReached: r.bool(),
  };
}

export function parseBeneficiaryChangedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["BeneficiaryChanged"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:           "BeneficiaryChanged",
    vault:          r.pubkey(),
    oldBeneficiary: r.pubkey(),
    newBeneficiary: r.pubkey(),
    covenant:       r.pubkey(),
    executedSlot:   r.u64(),
  };
}

export function parseGuardianRemovedByCovenantEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["GuardianRemovedByCovenant"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:             "GuardianRemovedByCovenant",
    vault:            r.pubkey(),
    guardian:         r.pubkey(),
    covenant:         r.pubkey(),
    guardianCount:    r.u8(),
    mOfN:             r.u8(),
    thresholdLowered: r.bool(),
    executedSlot:     r.u64(),
  };
}

export function parseOrphanedCovenantClosedEvent(data: Buffer): LegacyEvent | null {
  if (!DISC["OrphanedCovenantClosed"].equals(data.slice(0, 8))) return null;
  const r = new Reader(data, 8);
  return {
    name:          "OrphanedCovenantClosed",
    vault:         r.pubkey(),
    covenant:      r.pubkey(),
    covenantIndex: r.u64(),
    covenantType:  r.covenantType(),
    caller:        r.pubkey(),
    closedSlot:    r.u64(),
  };
}

// ── Log-level parsing ─────────────────────────────────────────────────────────

const ALL_PARSERS = [
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

/**
 * Attempts to parse a single "Program data: <base64>" log line into a typed
 * LegacyEvent. Returns null if the line is not a program data log or if its
 * discriminator does not match any known event.
 */
export function parseLegacyEventFromLog(log: string): LegacyEvent | null {
  const PREFIX = "Program data: ";
  if (!log.startsWith(PREFIX)) return null;

  let data: Buffer;
  try {
    data = Buffer.from(log.slice(PREFIX.length), "base64");
  } catch {
    return null;
  }

  if (data.length < 8) return null;

  for (const parser of ALL_PARSERS) {
    const result = parser(data);
    if (result !== null) return result;
  }

  return null;
}

/**
 * Parses all Legacy Protocol events from a transaction's log lines.
 * Skips log lines that are not program data or that do not match any event.
 */
export function parseLegacyEventsFromLogs(logs: string[]): LegacyEvent[] {
  const events: LegacyEvent[] = [];
  for (const log of logs) {
    const event = parseLegacyEventFromLog(log);
    if (event !== null) events.push(event);
  }
  return events;
}
