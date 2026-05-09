// sdk/src/pda.ts
//
// PDA derivation helpers. Must produce identical addresses to the on-chain
// seeds in constants.rs — any mismatch causes silent account-not-found errors.
//
// IMPORTANT — browser compatibility:
//   Buffer.writeBigUInt64LE is a Node.js-specific method absent from the
//   `buffer` npm package that browsers receive. All bigint→LE serialisation
//   is done with pure Uint8Array + BigInt arithmetic so this module works
//   identically in Node.js, browser webpack bundles, and Turbopack dev builds.

import { PublicKey } from "@solana/web3.js";

const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");
const GUARDIAN_SEED = Buffer.from("guardian");
const COVENANT_SEED = Buffer.from("covenant");

/**
 * Serialises an unsigned 64-bit integer as 8 little-endian bytes.
 * Uses pure BigInt arithmetic — no Buffer.writeBigUInt64LE — so it works
 * in browsers, Node.js, and every JS bundler without a native-Buffer polyfill.
 */
function bigUInt64LEBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let v = BigInt.asUintN(64, value);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

export function deriveVaultPda(
  programId:  PublicKey,
  owner:      PublicKey,
  vaultIndex: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), bigUInt64LEBytes(vaultIndex)],
    programId,
  );
}

export function deriveActivityPda(
  programId: PublicKey,
  vaultPda:  PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ACTIVITY_SEED, vaultPda.toBuffer()],
    programId,
  );
}

export function deriveGuardianPda(
  programId: PublicKey,
  vaultPda:  PublicKey,
  guardian:  PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GUARDIAN_SEED, vaultPda.toBuffer(), guardian.toBuffer()],
    programId,
  );
}

export function deriveCovenantPda(
  programId:     PublicKey,
  vaultPda:      PublicKey,
  covenantIndex: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [COVENANT_SEED, vaultPda.toBuffer(), bigUInt64LEBytes(covenantIndex)],
    programId,
  );
}
