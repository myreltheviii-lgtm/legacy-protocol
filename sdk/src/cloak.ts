// sdk/src/cloak.ts
//
// Legacy Protocol re-exports and wrappers for Cloak SDK functions.
// This file provides Legacy-specific helpers on top of @cloak.dev/sdk so
// that app code only needs to import from @legacy-protocol/sdk for both
// Cloak and Legacy functionality.
//
// Only functions present in the documented @cloak.dev/sdk API are re-exported.
// Do not add exports for functions that are not in the documented API.

export {
  CLOAK_PROGRAM_ID,
  NATIVE_SOL_MINT,
  generateUtxoKeypair,
  createUtxo,
  createZeroUtxo,
  transact,
  transfer,
  fullWithdraw,
  getNkFromUtxoPrivateKey,
  scanTransactions,
  toComplianceReport,
  calculateFee,
  getDistributableAmount,
  MIN_DEPOSIT_LAMPORTS,
  FIXED_FEE_LAMPORTS,
} from "@cloak.dev/sdk-devnet";

import {
  calculateFee,
  getDistributableAmount,
  MIN_DEPOSIT_LAMPORTS,
} from "@cloak.dev/sdk-devnet";

// ── Legacy-specific helpers ───────────────────────────────────────────────────

/**
 * Computes a detailed fee breakdown for a Cloak operation.
 * Matches the documented Cloak fee model exactly:
 *   fixed:    5_000_000 lamports
 *   variable: floor(gross * 3 / 1000)
 *   total:    fixed + variable
 *   net:      gross - total
 */
export function computeCloakFee(grossLamports: bigint): {
  gross:    bigint;
  fixed:    bigint;
  variable: bigint;
  total:    bigint;
  net:      bigint;
} {
  const gross    = Number(grossLamports);
  const total    = BigInt(Math.round(calculateFee(gross)));
  const net      = BigInt(Math.round(getDistributableAmount(gross)));
  const fixed    = 5_000_000n;
  const variable = total > fixed ? total - fixed : 0n;
  return { gross: grossLamports, fixed, variable, total, net };
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Returns a human-readable fee summary string.
 * Example: "1.0000 SOL shielded (0.0080 SOL fee, 0.9920 SOL net)"
 */
export function formatCloakFee(grossLamports: bigint): string {
  const { total, net } = computeCloakFee(grossLamports);
  const fmtSol = (l: bigint) => `${(Number(l) / Number(LAMPORTS_PER_SOL)).toFixed(4)} SOL`;
  return `${fmtSol(grossLamports)} shielded (${fmtSol(total)} fee, ${fmtSol(net)} net)`;
}

/**
 * Returns true if the lamport amount meets Cloak's minimum deposit threshold.
 */
export function isAboveMinDeposit(lamports: bigint): boolean {
  return lamports >= MIN_DEPOSIT_LAMPORTS;
}

/**
 * Converts a 32-byte Uint8Array UTXO public key to lowercase hex for on-chain storage.
 */
export function utxoPubkeyToHex(pubkey: Uint8Array): string {
  if (pubkey.length !== 32) throw new Error("UTXO pubkey must be 32 bytes");
  return Array.from(pubkey).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Converts a 64-char hex string back to a 32-byte Uint8Array.
 * Throws if the input is not exactly 64 characters or contains non-hex characters.
 * Using parseInt() on invalid hex silently produces 0 rather than throwing,
 * so explicit character-set validation is required before conversion.
 */
export function hexToUtxoPubkey(hex: string): Uint8Array {
  if (hex.length !== 64) throw new Error("hex must be 64 chars (32 bytes)");
  // Validate that every character is a valid hex digit before converting.
  // parseInt(str, 16) converts non-hex characters to NaN which TypedArray
  // stores as 0 — silently producing a zero byte rather than a parse error.
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("hex must contain only hexadecimal characters (0-9, a-f, A-F)");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
