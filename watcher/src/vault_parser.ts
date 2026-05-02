// watcher/src/vault_parser.ts
//
// Parses raw program account bytes into typed VaultAccount and ActivityAccount
// structs without going through the Anchor program client. Used by the Geyser
// stream handler to process account updates as they arrive.
//
// These parsers must exactly mirror the on-chain account layouts defined in
// constants.rs — any byte offset mismatch silently produces wrong values.
//
// Account discriminators are the first 8 bytes of sha256("account:StructName").
// They are pre-computed here so the hot-path Geyser dispatch does not invoke
// crypto on every update.
//
// Layouts (from constants.rs):
//
//   VaultAccount (128 bytes):
//     [0..8]   discriminator
//     [8..40]  owner: Pubkey
//     [40..72] beneficiary: Pubkey
//     [72]     guardian_count: u8
//     [73]     m_of_n_threshold: u8
//     [74..82] inactivity_threshold_slots: u64 LE
//     [82..90] last_check_in_slot: u64 LE
//     [90..98] created_slot: u64 LE
//     [98..106] deposited_lamports: u64 LE
//     [106..114] covenant_counter: u64 LE
//     [114..122] vault_index: u64 LE
//     [122]    is_triggered: bool
//     [123]    is_claimed: bool
//     [124]    is_emergency_swept: bool
//     [125]    warning_75_sent: bool
//     [126]    warning_90_sent: bool
//     [127]    bump: u8
//
//   ActivityAccount (74 bytes):
//     [0..8]   discriminator
//     [8..40]  vault: Pubkey
//     [40..48] checkin_count: u64 LE
//     [48..56] sum_of_intervals: u64 LE
//     [56..64] last_interval: u64 LE
//     [64]     anomaly_flagged: bool
//     [65..73] anomaly_flagged_slot: u64 LE
//     [73]     bump: u8

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

// ── Parsed account shapes ─────────────────────────────────────────────────────

export interface ParsedVaultAccount {
  owner:                    string; // base58
  beneficiary:              string; // base58
  guardianCount:            number;
  mOfNThreshold:            number;
  inactivityThresholdSlots: bigint;
  lastCheckInSlot:          bigint;
  createdSlot:              bigint;
  depositedLamports:        bigint;
  covenantCounter:          bigint;
  vaultIndex:               bigint;
  isTriggered:              boolean;
  isClaimed:                boolean;
  isEmergencySwept:         boolean;
  warning75Sent:            boolean;
  warning90Sent:            boolean;
  bump:                     number;
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
 * Parses a raw VaultAccount buffer. Returns null if the buffer is too short
 * or does not carry the vault discriminator.
 */
export function parseVaultAccount(data: Buffer): ParsedVaultAccount | null {
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

// ── Activity parser ───────────────────────────────────────────────────────────

/**
 * Parses a raw ActivityAccount buffer.
 */
export function parseActivityAccount(data: Buffer): ParsedActivityAccount | null {
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

// ── Guardian parser ───────────────────────────────────────────────────────────

/**
 * Parses a raw GuardianAccount buffer.
 */
export function parseGuardianAccount(data: Buffer): ParsedGuardianAccount | null {
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
