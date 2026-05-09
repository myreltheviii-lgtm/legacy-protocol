// cloak-integration/src/types.ts
//
// Shared types for the Cloak integration layer. These types represent the
// data structures passed between the Cloak SDK, Legacy Protocol SDK,
// and the frontend components.

import type { Connection, PublicKey } from "@solana/web3.js";

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * A Cloak UTXO keypair — the cryptographic identity for a shielded vault
 * participant. The private key controls spending; the public key goes on-chain.
 */
export interface UtxoIdentity {
  /** 32-byte secret that authorises spending from the shielded pool. */
  privateKey:    Uint8Array;
  /** 32-byte public key stored on-chain as beneficiary_utxo_pubkey. */
  publicKey:     Uint8Array;
  /** Derived viewing key used to scan for incoming shielded transactions. */
  viewingKeyNk:  Uint8Array;
}

// ── Shares ────────────────────────────────────────────────────────────────────

/**
 * A single Shamir share distributed to one guardian. The shareBase64 is the
 * only persistent value — guardians store this and never need to know it is
 * a share of the vault owner's UTXO private key.
 */
export interface GuardianShare {
  /** 1-indexed share number (matches ShamirShare.index). */
  shareIndex:     number;
  /** Base64-encoded share data produced by encodeShareBase64(). */
  shareBase64:    string;
  /** Solana wallet address of the guardian who holds this share. */
  guardianWallet: string;
}

// ── Shield state ──────────────────────────────────────────────────────────────

/**
 * On-chain Cloak state for a vault as parsed from VaultAccount.
 */
export interface VaultShieldState {
  /** Hex-encoded Poseidon commitment of the shielded UTXO (all zeros = not shielded). */
  utxoCommitment:   string;
  /** Leaf index in Cloak's Merkle tree. */
  utxoLeafIndex:    bigint;
  /** Declared shielded lamports (from record_cloak_deposit). */
  depositedLamports: bigint;
  /** True when utxoCommitment is non-zero. */
  shielded:         boolean;
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Configuration needed to shield a vault — passed from the frontend to
 * the cloak-integration functions.
 */
export interface ShieldedVaultConfig {
  connection:      Connection;
  vaultPda:        PublicKey;
  ownerWallet:     PublicKey;
  amountLamports:  bigint;
}

// ── Results ───────────────────────────────────────────────────────────────────

/**
 * Result of a successful shielded deposit.
 */
export interface ShieldedDepositResult {
  /** Cloak transaction signature. */
  cloakSignature:   string;
  /** Poseidon commitment of the new UTXO (to record on-chain). */
  utxoCommitment:   Uint8Array;
  /** Leaf index in Cloak's Merkle tree (to record on-chain). */
  utxoLeafIndex:    bigint;
  /** Net lamports actually shielded (gross minus fee). */
  netLamports:      bigint;
}

/**
 * Result of a guardian-executed shielded inheritance transfer.
 */
export interface InheritanceClaim {
  /** Cloak transfer transaction signature (stored in record_cloak_claim). */
  cloakSignature:   string;
  /** Amount transferred (gross before Cloak fee). */
  grossLamports:    bigint;
}

/**
 * Cryptographically verifiable proof that the beneficiary received the inheritance.
 * Generated via scanTransactions + toComplianceReport.
 */
export interface ComplianceProof {
  /** High-level summary from Cloak's compliance report. */
  summary:      unknown;
  /** Per-transaction details (amounts visible only to key holder). */
  transactions: unknown[];
  /** ISO timestamp when this proof was generated. */
  generatedAt:  string;
}

/**
 * Fee breakdown for display before a Cloak operation.
 */
export interface CloakFeeBreakdown {
  /** Total gross lamports entering or leaving Cloak. */
  gross:    bigint;
  /** Fixed protocol fee (5_000_000 lamports). */
  fixed:    bigint;
  /** Variable fee: floor(gross * 3 / 1000). */
  variable: bigint;
  /** Total fee = fixed + variable. */
  total:    bigint;
  /** Net lamports after fees. */
  net:      bigint;
}
