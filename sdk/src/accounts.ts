// sdk/src/accounts.ts
//
// Account fetchers. Each function performs a getAccountInfo call, validates
// the discriminator, and deserialises the binary data into a typed struct.
//
// Discriminators are computed using Node's built-in crypto module (no external
// dependency). Anchor computes account discriminators as the first 8 bytes of
// sha256("account:StructName"). A discriminator mismatch means the account at
// that address belongs to a different program or is a different account type —
// both are treated as not-found rather than silent misparse.
//
// u64 fields are returned as bigint. Pubkeys are returned as base58 strings.
// The caller never needs to import PublicKey to consume an account struct.

import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  VaultAccount,
  ActivityAccount,
  GuardianAccount,
  CovenantAccount,
  CovenantType,
  VaultWithAddress,
} from "./types";

// ── Discriminator computation ─────────────────────────────────────────────────

function accountDiscriminator(name: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`account:${name}`).digest(),
  ).slice(0, 8);
}

const VAULT_DISC    = accountDiscriminator("VaultAccount");
const ACTIVITY_DISC = accountDiscriminator("ActivityAccount");
const GUARDIAN_DISC = accountDiscriminator("GuardianAccount");
const COVENANT_DISC = accountDiscriminator("CovenantAccount");

// ── Protocol constants mirrored from constants.rs ─────────────────────────────

// The deserialiseCovenant function validates signers length against this cap.
// A covenant with more than MAX_COVENANT_SIGNERS declared signers cannot have
// been produced by the on-chain program — the guardian_sign instruction
// enforces the cap at write time. Rejecting such an account prevents reading
// past the expected buffer region on any malformed or adversarial account data.
const MAX_COVENANT_SIGNERS = 10;

// ── Binary deserialisers ──────────────────────────────────────────────────────

/** Reads a 32-byte Pubkey from a Buffer at the given offset, returns base58 string. */
function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.slice(offset, offset + 32)).toBase58();
}

/** Reads an 8-byte little-endian u64 from a Buffer at the given offset. */
function readU64(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

/** Reads a 4-byte little-endian u32 from a Buffer at the given offset. */
function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function deserialiseVault(data: Buffer): VaultAccount | null {
  if (data.length < 128) return null;
  if (!VAULT_DISC.equals(data.slice(0, 8))) return null;

  return {
    owner:                    readPubkey(data, 8),
    beneficiary:              readPubkey(data, 40),
    guardianCount:            data[72],
    mOfNThreshold:            data[73],
    inactivityThresholdSlots: readU64(data, 74),
    lastCheckInSlot:          readU64(data, 82),
    createdSlot:              readU64(data, 90),
    depositedLamports:        readU64(data, 98),
    covenantCounter:          readU64(data, 106),
    vaultIndex:               readU64(data, 114),
    isTriggered:              data[122] === 1,
    isClaimed:                data[123] === 1,
    isEmergencySwept:         data[124] === 1,
    warning75Sent:            data[125] === 1,
    warning90Sent:            data[126] === 1,
    bump:                     data[127],
  };
}

function deserialiseActivity(data: Buffer): ActivityAccount | null {
  if (data.length < 74) return null;
  if (!ACTIVITY_DISC.equals(data.slice(0, 8))) return null;

  return {
    vault:              readPubkey(data, 8),
    checkinCount:       readU64(data, 40),
    sumOfIntervals:     readU64(data, 48),
    lastInterval:       readU64(data, 56),
    anomalyFlagged:     data[64] === 1,
    anomalyFlaggedSlot: readU64(data, 65),
    bump:               data[73],
  };
}

function deserialiseGuardian(data: Buffer): GuardianAccount | null {
  if (data.length < 90) return null;
  if (!GUARDIAN_DISC.equals(data.slice(0, 8))) return null;

  return {
    vault:                readPubkey(data, 8),
    guardian:             readPubkey(data, 40),
    isActive:             data[72] === 1,
    addedSlot:            readU64(data, 73),
    removalRequestedSlot: readU64(data, 81),
    bump:                 data[89],
  };
}

function deserialiseCovenant(data: Buffer): CovenantAccount | null {
  // Minimum fixed-region size: 8 disc + 32 vault + 1 type + 32 target + 4 len
  // = 77 bytes before the variable signer array begins.
  if (data.length < 77) return null;
  if (!COVENANT_DISC.equals(data.slice(0, 8))) return null;

  const vault        = readPubkey(data, 8);
  const covenantType = data[40] as CovenantType;
  const target       = readPubkey(data, 41);
  const signersLen   = readU32(data, 73);

  // The on-chain program caps the signer list at MAX_COVENANT_SIGNERS via
  // the guardian_sign instruction. A declared length exceeding this cap
  // indicates corrupted or adversarial account data — reject rather than
  // reading past the expected buffer region.
  if (signersLen > MAX_COVENANT_SIGNERS) return null;

  // Validate the buffer is large enough to hold the declared signer array
  // plus all remaining fixed fields (1 + 8 + 8 + 8 + 8 + 1 + 1 = 35 bytes).
  const signersStart   = 77;
  const signersBytes   = signersLen * 32;
  const fixedTailBytes = 35;
  if (data.length < signersStart + signersBytes + fixedTailBytes) return null;

  const signers: string[] = [];
  for (let i = 0; i < signersLen; i++) {
    signers.push(readPubkey(data, signersStart + i * 32));
  }

  let cursor = signersStart + signersBytes;

  const requiredSignatures     = data[cursor];      cursor += 1;
  const createdSlot            = readU64(data, cursor); cursor += 8;
  const timelockSlots          = readU64(data, cursor); cursor += 8;
  const signaturesCompleteSlot = readU64(data, cursor); cursor += 8;
  const covenantIndex          = readU64(data, cursor); cursor += 8;
  const isExecuted             = data[cursor] === 1;  cursor += 1;
  const bump                   = data[cursor];

  return {
    vault,
    covenantType,
    target,
    signers,
    requiredSignatures,
    createdSlot,
    timelockSlots,
    signaturesCompleteSlot,
    covenantIndex,
    isExecuted,
    bump,
  };
}

// ── Public fetchers ───────────────────────────────────────────────────────────

/**
 * Fetches and deserialises a VaultAccount.
 * Returns null if the account does not exist or has the wrong discriminator.
 * Throws on RPC transport errors — callers must distinguish "not found" from
 * "network failure" to avoid incorrectly concluding a vault is gone.
 */
export async function fetchVault(
  connection: Connection,
  _programId: PublicKey,
  vaultPda:   PublicKey,
): Promise<VaultAccount | null> {
  const info = await connection.getAccountInfo(vaultPda, "confirmed");
  if (!info || !info.data) return null;
  return deserialiseVault(Buffer.from(info.data));
}

/**
 * Fetches and deserialises an ActivityAccount.
 */
export async function fetchActivity(
  connection:  Connection,
  _programId:  PublicKey,
  activityPda: PublicKey,
): Promise<ActivityAccount | null> {
  const info = await connection.getAccountInfo(activityPda, "confirmed");
  if (!info || !info.data) return null;
  return deserialiseActivity(Buffer.from(info.data));
}

/**
 * Fetches and deserialises a GuardianAccount.
 */
export async function fetchGuardian(
  connection:  Connection,
  _programId:  PublicKey,
  guardianPda: PublicKey,
): Promise<GuardianAccount | null> {
  const info = await connection.getAccountInfo(guardianPda, "confirmed");
  if (!info || !info.data) return null;
  return deserialiseGuardian(Buffer.from(info.data));
}

/**
 * Fetches and deserialises a CovenantAccount.
 */
export async function fetchCovenant(
  connection:  Connection,
  _programId:  PublicKey,
  covenantPda: PublicKey,
): Promise<CovenantAccount | null> {
  const info = await connection.getAccountInfo(covenantPda, "confirmed");
  if (!info || !info.data) return null;
  return deserialiseCovenant(Buffer.from(info.data));
}

/**
 * Fetches all VaultAccounts owned by a specific owner, using getProgramAccounts
 * with a memcmp filter on the owner field (bytes 8–39 of the account data).
 *
 * This is the correct approach rather than iterating locally: the RPC node
 * applies the filter server-side and only returns matching accounts, bounding
 * the response size to the number of vaults the owner controls.
 */
export async function fetchAllVaultsForOwner(
  connection: Connection,
  programId:  PublicKey,
  owner:      PublicKey,
): Promise<VaultWithAddress[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      // The vault account size filter prevents false positives from other
      // account types whose first 8 bytes happen to contain the owner pubkey
      // at the same offset. VaultAccount is always exactly 128 bytes.
      { dataSize: 128 },
      {
        memcmp: {
          offset: 8, // skip 8-byte discriminator; owner Pubkey starts here
          bytes:  owner.toBase58(),
        },
      },
    ],
  });

  const results: VaultWithAddress[] = [];

  for (const { pubkey, account } of accounts) {
    const vault = deserialiseVault(Buffer.from(account.data));
    if (vault) {
      results.push({ publicKey: pubkey.toBase58(), account: vault });
    }
  }

  // Sort by vault_index ascending so the caller always sees vaults in creation order.
  results.sort((a, b) => (a.account.vaultIndex < b.account.vaultIndex ? -1 : 1));

  return results;
}

/**
 * Fetches all active GuardianAccounts for a given vault by scanning program
 * accounts filtered by the vault pubkey at the guardian account's vault field
 * (bytes 8–39). Returns only guardians where is_active == true.
 */
export async function fetchAllGuardiansForVault(
  connection: Connection,
  programId:  PublicKey,
  vault:      PublicKey,
): Promise<Array<{ publicKey: string; account: GuardianAccount }>> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: 90 },
      {
        memcmp: {
          offset: 8, // vault field starts at byte 8 of GuardianAccount
          bytes:  vault.toBase58(),
        },
      },
      {
        memcmp: {
          offset: 72, // is_active: bool — byte value 1 = active, base58 "2"
          bytes:  "2",
        },
      },
    ],
  });

  const results: Array<{ publicKey: string; account: GuardianAccount }> = [];

  for (const { pubkey, account } of accounts) {
    const guardian = deserialiseGuardian(Buffer.from(account.data));
    if (guardian && guardian.isActive) {
      results.push({ publicKey: pubkey.toBase58(), account: guardian });
    }
  }

  return results;
}

/**
 * Fetches all CovenantAccounts for a given vault. Returns all covenants,
 * including those with is_executed = true, so the caller can display the
 * full covenant history.
 */
export async function fetchAllCovenantsForVault(
  connection: Connection,
  programId:  PublicKey,
  vault:      PublicKey,
): Promise<Array<{ publicKey: string; account: CovenantAccount }>> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: 432 },
      {
        memcmp: {
          offset: 8, // vault field starts at byte 8 of CovenantAccount
          bytes:  vault.toBase58(),
        },
      },
    ],
  });

  const results: Array<{ publicKey: string; account: CovenantAccount }> = [];

  for (const { pubkey, account } of accounts) {
    const covenant = deserialiseCovenant(Buffer.from(account.data));
    if (covenant) {
      results.push({ publicKey: pubkey.toBase58(), account: covenant });
    }
  }

  results.sort((a, b) =>
    a.account.covenantIndex < b.account.covenantIndex ? -1 : 1,
  );

  return results;
}
