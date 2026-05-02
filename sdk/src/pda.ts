// sdk/src/pda.ts
//
// PDA derivation helpers. Every seed layout here must exactly match the
// constants and PDA constraints in the Rust program. A mismatch produces a
// different address that silently fails account lookups — seeds are the
// contract between client and program.
//
// All functions use findProgramAddressSync (no I/O) and return both the
// address and the canonical bump so callers can pass the bump to instructions
// that require it for signer reconstruction.

import { PublicKey } from "@solana/web3.js";

// ── Seed byte buffers — must match constants.rs ───────────────────────────────

const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");
const GUARDIAN_SEED = Buffer.from("guardian");
const COVENANT_SEED = Buffer.from("covenant");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Encodes a u64 as an 8-byte little-endian buffer, matching to_le_bytes() in Rust. */
function u64ToLeBytes(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

// ── PDA derivation ────────────────────────────────────────────────────────────

/**
 * Derives the VaultAccount PDA.
 * Seeds: ["vault", owner_pubkey_bytes, vault_index_le_u64_bytes]
 *
 * The vault_index is the same value the owner passed to initialize_vault.
 * One owner can maintain multiple vaults by incrementing this index.
 */
export function deriveVaultPda(
  programId:  PublicKey,
  owner:      PublicKey,
  vaultIndex: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), u64ToLeBytes(vaultIndex)],
    programId,
  );
}

/**
 * Derives the ActivityAccount PDA.
 * Seeds: ["activity", vault_pubkey_bytes]
 *
 * One ActivityAccount exists per vault. It is created alongside the vault
 * in initialize_vault and closed alongside it in close_vault / claim_inheritance.
 */
export function deriveActivityPda(
  programId: PublicKey,
  vault:     PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ACTIVITY_SEED, vault.toBuffer()],
    programId,
  );
}

/**
 * Derives the GuardianAccount PDA for a specific (vault, guardian) pair.
 * Seeds: ["guardian", vault_pubkey_bytes, guardian_pubkey_bytes]
 *
 * Each (vault, guardian) pair has a unique PDA. The guardian's status
 * (active, removal pending) lives in this account rather than in the vault
 * so it can be read without loading the vault.
 */
export function deriveGuardianPda(
  programId: PublicKey,
  vault:     PublicKey,
  guardian:  PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GUARDIAN_SEED, vault.toBuffer(), guardian.toBuffer()],
    programId,
  );
}

/**
 * Derives the CovenantAccount PDA for a specific (vault, covenantIndex) pair.
 * Seeds: ["covenant", vault_pubkey_bytes, covenant_index_le_u64_bytes]
 *
 * The covenant_index is taken from vault.covenant_counter BEFORE increment,
 * so the first covenant for a vault has index 0, the second has index 1, etc.
 */
export function deriveCovenantPda(
  programId:     PublicKey,
  vault:         PublicKey,
  covenantIndex: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [COVENANT_SEED, vault.toBuffer(), u64ToLeBytes(covenantIndex)],
    programId,
  );
}
