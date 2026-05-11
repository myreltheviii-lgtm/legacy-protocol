// watcher/src/vault_parser.ts
//
// Parses raw program account bytes into typed account structs without going
// through the Anchor program client. Used by the Geyser stream handler to
// process account updates as they arrive.
//
// VaultAccount layout (168 bytes — Cloak integration v2):
//   [0..8]    discriminator
//   [8..40]   owner: Pubkey
//   [40..72]  beneficiary_utxo_pubkey: [u8;32]  (Cloak UTXO pubkey, NOT a Solana wallet)
//   [72]      guardian_count: u8
//   [73]      m_of_n_threshold: u8
//   [74..82]  inactivity_threshold_slots: u64 LE
//   [82..90]  last_check_in_slot: u64 LE
//   [90..98]  created_slot: u64 LE
//   [98..106] deposited_lamports: u64 LE
//   [106..114] covenant_counter: u64 LE
//   [114..122] vault_index: u64 LE
//   [122..154] utxo_commitment: [u8;32]  Poseidon commitment from Cloak deposit
//   [154..162] utxo_leaf_index: u64 LE
//   [162]     is_triggered: bool
//   [163]     is_claimed: bool
//   [164]     is_emergency_swept: bool
//   [165]     warning_75_sent: bool
//   [166]     warning_90_sent: bool
//   [167]     bump: u8

import { createHash } from "node:crypto";
import { PublicKey }  from "@solana/web3.js";

// ── Discriminators ────────────────────────────────────────────────────────────

function disc(accountName: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`account:${accountName}`).digest(),
  ).slice(0, 8);
}

const VAULT_DISC    = disc("VaultAccount");
const ACTIVITY_DISC = disc("ActivityAccount");
const GUARDIAN_DISC = disc("GuardianAccount");

export const VAULT_ACCOUNT_BYTE_SIZE    = 168;
export const ACTIVITY_ACCOUNT_BYTE_SIZE = 74;
export const GUARDIAN_ACCOUNT_BYTE_SIZE = 90;

// ── Parsed account shapes ─────────────────────────────────────────────────────

export interface ParsedVaultAccount {
  owner:                    string; // base58
  /** Hex-encoded 32-byte Cloak UTXO public key. NOT a Solana wallet address. */
  beneficiaryUtxoPubkey:    string; // hex (64 chars)
  guardianCount:            number;
  mOfNThreshold:            number;
  inactivityThresholdSlots: bigint;
  lastCheckInSlot:          bigint;
  createdSlot:              bigint;
  depositedLamports:        bigint;
  covenantCounter:          bigint;
  vaultIndex:               bigint;
  /** Hex-encoded Poseidon commitment. All zeros = no shielded deposit. */
  utxoCommitment:           string; // hex (64 chars)
  utxoLeafIndex:            bigint;
  isTriggered:              boolean;
  isClaimed:                boolean;
  isEmergencySwept:         boolean;
  warning75Sent:            boolean;
  warning90Sent:            boolean;
  bump:                     number;
  /**
   * Derived convenience flag: true when depositedLamports === 0n, indicating
   * the vault's SOL has been moved into the Cloak shielded pool.
   * Shielded detection in the watcher context is always lamport-based —
   * utxoCommitment is never the detection mechanism here.
   */
  isShielded:               boolean;
}

export interface ParsedActivityAccount {
  vault:              string; // base58
  checkinCount:       bigint;
  sumOfIntervals:     bigint;
  lastInterval:       bigint;
  anomalyFlagged:     boolean;
  anomalyFlaggedSlot: bigint;
  bump:               number;
}

export interface ParsedGuardianAccount {
  vault:                string; // base58
  guardian:             string; // base58
  isActive:             boolean;
  addedSlot:            bigint;
  removalRequestedSlot: bigint;
  bump:                 number;
}

export enum AccountKind {
  Vault    = "VAULT",
  Activity = "ACTIVITY",
  Guardian = "GUARDIAN",
  Other    = "OTHER",
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.slice(offset, offset + 32)).toBase58();
}

function readU64(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

function readBytes32Hex(buf: Buffer, offset: number): string {
  return buf.slice(offset, offset + 32).toString("hex");
}

// ── Discriminator detection ───────────────────────────────────────────────────

/**
 * Returns the account kind based on the discriminator in the first 8 bytes.
 * Runs on every Geyser update — kept allocation-free.
 */
export function detectAccountKind(data: Buffer): AccountKind {
  if (data.length < 8) return AccountKind.Other;

  const head = data.slice(0, 8);
  if (VAULT_DISC.equals(head))    return AccountKind.Vault;
  if (ACTIVITY_DISC.equals(head)) return AccountKind.Activity;
  if (GUARDIAN_DISC.equals(head)) return AccountKind.Guardian;
  return AccountKind.Other;
}

// ── Vault parser ──────────────────────────────────────────────────────────────

/**
 * Parses a raw VaultAccount buffer (168 bytes).
 * Returns null if the buffer is too short or does not carry the vault discriminator.
 */
export function parseVaultAccount(data: Buffer): ParsedVaultAccount | null {
  if (data.length < VAULT_ACCOUNT_BYTE_SIZE) return null;
  if (!VAULT_DISC.equals(data.slice(0, 8))) return null;

  const depositedLamports = readU64(data, 98);

  // Shielded detection: depositedLamports === 0n means the vault's SOL has
  // been moved into the Cloak shielded pool. utxoCommitment is NOT used for
  // shielded detection in the watcher context — VaultRecord has no such field.
  const isShielded = depositedLamports === 0n;

  return {
    owner:                    readPubkey(data, 8),
    beneficiaryUtxoPubkey:    readBytes32Hex(data, 40),
    guardianCount:            data[72],
    mOfNThreshold:            data[73],
    inactivityThresholdSlots: readU64(data, 74),
    lastCheckInSlot:          readU64(data, 82),
    createdSlot:              readU64(data, 90),
    depositedLamports,
    covenantCounter:          readU64(data, 106),
    vaultIndex:               readU64(data, 114),
    utxoCommitment:           readBytes32Hex(data, 122),
    utxoLeafIndex:            readU64(data, 154),
    isTriggered:              data[162] === 1,
    isClaimed:                data[163] === 1,
    isEmergencySwept:         data[164] === 1,
    warning75Sent:            data[165] === 1,
    warning90Sent:            data[166] === 1,
    bump:                     data[167],
    isShielded,
  };
}

// ── Activity parser ───────────────────────────────────────────────────────────

/**
 * Parses a raw ActivityAccount buffer (74 bytes).
 */
export function parseActivityAccount(data: Buffer): ParsedActivityAccount | null {
  if (data.length < ACTIVITY_ACCOUNT_BYTE_SIZE) return null;
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

// ── Guardian parser ───────────────────────────────────────────────────────────

/**
 * Parses a raw GuardianAccount buffer (90 bytes).
 */
export function parseGuardianAccount(data: Buffer): ParsedGuardianAccount | null {
  if (data.length < GUARDIAN_ACCOUNT_BYTE_SIZE) return null;
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
