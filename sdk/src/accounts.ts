// sdk/src/accounts.ts
//
// Low-level account deserializers AND high-level fetch helpers.
// Parses raw program account bytes into typed structs without going through
// the Anchor IDL client, and provides Connection-based fetch wrappers for
// all four account types.
//
// These parsers must exactly mirror constants.rs byte offsets.
// VaultAccount layout: 168 bytes (v2, with Cloak integration fields).

import { Connection, PublicKey } from "@solana/web3.js";
import type { VaultAccount, ActivityAccount, GuardianAccount, CovenantAccount, GuardianWithAddress } from "./types";
import { CovenantType, ActivityZone } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

export const VAULT_SIZE    = 168;
export const ACTIVITY_SIZE = 74;
export const GUARDIAN_SIZE = 90;

// Maximum signers in a CovenantAccount Vec<Pubkey> — mirrors MAX_COVENANT_SIGNERS
// in constants.rs. A parsed count exceeding this indicates data corruption.
const MAX_COVENANT_SIGNERS = 10;

// ── Low-level helpers ─────────────────────────────────────────────────────────

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.slice(offset, offset + 32)).toBase58();
}

function readU64(buf: Buffer, offset: number): bigint {
  let val = 0n; for (let i = 7; i >= 0; i--) { val = (val << 8n) | BigInt(buf[offset + i]); } return val;
}

function readBytes32Hex(buf: Buffer, offset: number): string {
  return buf.slice(offset, offset + 32).toString("hex");
}

// ── VaultAccount deserializer ─────────────────────────────────────────────────

/**
 * Deserialises a raw VaultAccount buffer (168 bytes).
 *
 * Byte layout:
 *   [0..8]    disc
 *   [8..40]   owner
 *   [40..72]  beneficiary_utxo_pubkey (32 raw bytes, hex-encoded in TS)
 *   [72]      guardian_count
 *   [73]      m_of_n_threshold
 *   [74..82]  inactivity_threshold_slots
 *   [82..90]  last_check_in_slot
 *   [90..98]  created_slot
 *   [98..106] deposited_lamports
 *   [106..114] covenant_counter
 *   [114..122] vault_index
 *   [122..154] utxo_commitment (hex-encoded)
 *   [154..162] utxo_leaf_index
 *   [162]     is_triggered
 *   [163]     is_claimed
 *   [164]     is_emergency_swept
 *   [165]     warning_75_sent
 *   [166]     warning_90_sent
 *   [167]     bump
 */
export function deserialiseVault(buf: Buffer): VaultAccount | null {
  if (buf.length < VAULT_SIZE) return null;

  const beneficiaryUtxoPubkeyHex = readBytes32Hex(buf, 40);

  return {
    owner:                    readPubkey(buf, 8),
    beneficiaryUtxoPubkey:    beneficiaryUtxoPubkeyHex,
    // Backward-compat alias: for non-shielded vaults the bytes at [40..72]
    // are a Solana pubkey; try to present as base58 for callers expecting it.
    beneficiary:              tryHexToBase58(beneficiaryUtxoPubkeyHex),
    guardianCount:            buf[72],
    mOfNThreshold:            buf[73],
    inactivityThresholdSlots: readU64(buf, 74),
    lastCheckInSlot:          readU64(buf, 82),
    createdSlot:              readU64(buf, 90),
    depositedLamports:        readU64(buf, 98),
    covenantCounter:          readU64(buf, 106),
    vaultIndex:               readU64(buf, 114),
    utxoCommitment:           readBytes32Hex(buf, 122),
    utxoLeafIndex:            readU64(buf, 154),
    isTriggered:              buf[162] === 1,
    isClaimed:                buf[163] === 1,
    isEmergencySwept:         buf[164] === 1,
    warning75Sent:            buf[165] === 1,
    warning90Sent:            buf[166] === 1,
    bump:                     buf[167],
  };
}

/** Returns true if the vault has a shielded Cloak deposit recorded. */
export function isVaultShielded(vault: VaultAccount): boolean {
  return vault.utxoCommitment !== "0".repeat(64);
}

// ── ActivityAccount deserializer ──────────────────────────────────────────────

export function deserialiseActivity(buf: Buffer): ActivityAccount | null {
  if (buf.length < ACTIVITY_SIZE) return null;

  return {
    vault:              readPubkey(buf, 8),
    checkinCount:       readU64(buf, 40),
    sumOfIntervals:     readU64(buf, 48),
    lastInterval:       readU64(buf, 56),
    anomalyFlagged:     buf[64] === 1,
    anomalyFlaggedSlot: readU64(buf, 65),
    bump:               buf[73],
  };
}

// ── GuardianAccount deserializer ──────────────────────────────────────────────

export function deserialiseGuardian(buf: Buffer): GuardianAccount | null {
  if (buf.length < GUARDIAN_SIZE) return null;

  return {
    vault:                readPubkey(buf, 8),
    guardian:             readPubkey(buf, 40),
    isActive:             buf[72] === 1,
    addedSlot:            readU64(buf, 73),
    removalRequestedSlot: readU64(buf, 81),
    bump:                 buf[89],
  };
}

// ── CovenantAccount deserializer ──────────────────────────────────────────────

export function deserialiseCovenantType(discriminant: number): CovenantType {
  switch (discriminant) {
    case 0: return CovenantType.EmergencySweep;
    case 1: return CovenantType.BeneficiaryChange;
    case 2: return CovenantType.GuardianRemoval;
    default: return CovenantType.EmergencySweep;
  }
}

export function deserialiseCovenantFromBuffer(buf: Buffer): CovenantAccount | null {
  if (buf.length < 8) return null;

  let offset = 8;
  const vault         = readPubkey(buf, offset); offset += 32;
  const covenantType  = deserialiseCovenantType(buf[offset]); offset += 1;
  const target        = readPubkey(buf, offset); offset += 32;

  // Guard: if the signers vec length is unreasonable, treat as corrupted data.
  if (offset + 4 > buf.length) return null;
  const signerCount   = buf.readUInt32LE(offset); offset += 4;

  if (signerCount > MAX_COVENANT_SIGNERS) return null;

  if (offset + signerCount * 32 > buf.length) return null;

  const signers: string[] = [];
  for (let i = 0; i < signerCount; i++) {
    signers.push(readPubkey(buf, offset)); offset += 32;
  }

  if (offset + 1 + 8 + 8 + 8 + 8 + 1 + 1 > buf.length) return null;

  const requiredSignatures     = buf[offset]; offset += 1;
  const createdSlot            = readU64(buf, offset); offset += 8;
  const timelockSlots          = readU64(buf, offset); offset += 8;
  const signaturesCompleteSlot = readU64(buf, offset); offset += 8;
  const covenantIndex          = readU64(buf, offset); offset += 8;
  const isExecuted             = buf[offset] === 1; offset += 1;
  const bump                   = buf[offset];

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

// ── High-level fetch helpers ──────────────────────────────────────────────────
//
// These wrappers accept (connection, programId, pubkey) for a consistent
// API across all account types. programId is used for getProgramAccounts
// queries and for structural consistency — single-account fetches derive
// the data directly from the PDA address and do not require programId to
// locate the account.

/**
 * Fetches and deserialises a VaultAccount.
 * Returns null if the account does not exist or fails to deserialise.
 */
export async function fetchVault(
  connection: Connection,
  _programId: PublicKey,
  vaultPda:   PublicKey,
): Promise<VaultAccount | null> {
  const info = await connection.getAccountInfo(vaultPda, "confirmed");
  if (!info) return null;
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
  if (!info) return null;
  return deserialiseActivity(Buffer.from(info.data));
}

/**
 * Fetches and deserialises a GuardianAccount.
 */
export async function fetchGuardian(
  connection:         Connection,
  _programId:         PublicKey,
  guardianAccountPda: PublicKey,
): Promise<GuardianAccount | null> {
  const info = await connection.getAccountInfo(guardianAccountPda, "confirmed");
  if (!info) return null;
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
  if (!info) return null;
  return deserialiseCovenantFromBuffer(Buffer.from(info.data));
}

/**
 * Fetches all active GuardianAccounts for a vault using getProgramAccounts.
 * The vault pubkey is stored at offset 8 in the GuardianAccount layout,
 * which is used as the memcmp filter.
 */
export async function fetchAllGuardiansForVault(
  connection: Connection,
  programId:  PublicKey,
  vaultPda:   PublicKey,
): Promise<GuardianWithAddress[]> {
  // vault field is at offset 8 (after discriminator) in GuardianAccount.
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: GUARDIAN_SIZE },
      { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
    ],
  });

  const results: GuardianWithAddress[] = [];
  for (const { pubkey, account } of accounts) {
    const parsed = deserialiseGuardian(Buffer.from(account.data));
    if (parsed && parsed.vault === vaultPda.toBase58()) {
      results.push({ publicKey: pubkey.toBase58(), account: parsed });
    }
  }
  return results;
}

/**
 * Fetches all CovenantAccounts for a vault using getProgramAccounts.
 * The vault pubkey is stored at offset 8 in the CovenantAccount layout.
 */
export async function fetchAllCovenantsForVault(
  connection: Connection,
  programId:  PublicKey,
  vaultPda:   PublicKey,
): Promise<Array<{ publicKey: string; account: CovenantAccount }>> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 8, bytes: vaultPda.toBase58() } },
    ],
  });

  const results: Array<{ publicKey: string; account: CovenantAccount }> = [];
  for (const { pubkey, account } of accounts) {
    const parsed = deserialiseCovenantFromBuffer(Buffer.from(account.data));
    if (parsed && parsed.vault === vaultPda.toBase58()) {
      results.push({ publicKey: pubkey.toBase58(), account: parsed });
    }
  }
  return results;
}

/**
 * Fetches all VaultAccounts where beneficiary_utxo_pubkey matches the given
 * Solana pubkey bytes. For non-shielded vaults only — beneficiary_utxo_pubkey
 * at offset 40 stores the raw bytes of the beneficiary's Solana pubkey.
 */
export async function fetchAllVaultsForBeneficiary(
  connection:  Connection,
  programId:   PublicKey,
  beneficiary: PublicKey,
): Promise<Array<{ publicKey: string; account: VaultAccount }>> {
  // beneficiary_utxo_pubkey is at offset 40 in the vault account.
  // For non-shielded vaults, these bytes = the Solana pubkey bytes.
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: VAULT_SIZE },
      { memcmp: { offset: 40, bytes: beneficiary.toBase58() } },
    ],
  });

  const results: Array<{ publicKey: string; account: VaultAccount }> = [];
  for (const { pubkey, account } of accounts) {
    const parsed = deserialiseVault(Buffer.from(account.data));
    if (parsed) results.push({ publicKey: pubkey.toBase58(), account: parsed });
  }
  return results;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function tryHexToBase58(hex: string): string {
  try {
    const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return new PublicKey(bytes).toBase58();
  } catch {
    return hex;
  }
}

/**
 * Fetches all VaultAccounts where owner matches the given pubkey.
 * Owner is stored at offset 8 in the VaultAccount layout (after discriminator).
 */
export async function fetchAllVaultsForOwner(
  connection: Connection,
  programId:  PublicKey,
  owner:      PublicKey,
): Promise<Array<{ publicKey: string; account: VaultAccount }>> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: VAULT_SIZE },
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ],
  });

  const results: Array<{ publicKey: string; account: VaultAccount }> = [];
  for (const { pubkey, account } of accounts) {
    const parsed = deserialiseVault(Buffer.from(account.data));
    if (parsed && parsed.owner === owner.toBase58()) {
      results.push({ publicKey: pubkey.toBase58(), account: parsed });
    }
  }
  return results;
}
