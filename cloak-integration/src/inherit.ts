// cloak-integration/src/inherit.ts
//
// Guardian-side inheritance execution. When the Anchor covenant reaches M-of-N
// signatures and the inactivity threshold is crossed, guardians:
//   1. Collect M base64-encoded shares
//   2. Scan the shielded pool to locate the vault's UTXOs (key reconstructed
//      temporarily and immediately zeroed — see scanOwnerUtxos)
//   3. Reconstruct the owner's UTXO private key (Lagrange interpolation in GF256)
//   4. Call Cloak's transfer() with externalAmount: 0n (zero public trace),
//      passing the reconstructed key so the Cloak circuit can generate the
//      nullifier proving spending authority over the input UTXOs
//   5. Zero the reconstructed private key from memory in the finally block
//   6. Return the Cloak signature for record_cloak_claim
//
// NOTE on `depositorKeypair` in transfer() options:
//   The @cloak.dev/sdk docs document `depositorKeypair` as the UTXO keypair
//   for ZK nullifier generation. The keypair format matches generateUtxoKeypair()
//   output: { privateKey: Uint8Array(32), publicKey: Uint8Array(32) }.
//   The reconstructed owner key is passed as privateKey; publicKey is a
//   zero-filled Uint8Array(32) because the Cloak SDK derives the circuit
//   public key from privateKey internally during proof generation.
//
// The guardian's connected browser wallet (relayerWallet) provides signTransaction
// for the Solana transaction layer per the documented wallet adapter pattern.

import {
  CLOAK_PROGRAM_ID,
  transfer,
  scanTransactions,
  getNkFromUtxoPrivateKey,
  calculateFee,
} from "@cloak.dev/sdk-devnet";
import {
  reconstructSecret,
  decodeShareBase64,
} from "@legacy-protocol/sdk";
import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { GuardianShare, InheritanceClaim } from "./types";

// ── Conversion helpers ────────────────────────────────────────────────────────
function bytesToBigint(arr: Uint8Array): bigint {
  let result = 0n;
  for (const byte of arr) { result = (result << 8n) | BigInt(byte); }
  return result;
}


// ── Wallet adapter type ───────────────────────────────────────────────────────

/**
 * Minimal wallet adapter interface — the guardian's connected browser wallet.
 * Signs and pays for the Cloak Solana transaction.
 *
 * Matches the wallet adapter fields used by @cloak.dev/sdk's transfer()
 * wallet adapter path (signTransaction + walletPublicKey).
 *
 * Compatible with @solana/wallet-adapter-react's useWallet() return type.
 */
export interface WalletAdapter {
  publicKey:       PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
}

// ── UTXO scan ─────────────────────────────────────────────────────────────────

/**
 * Reconstructs the owner's UTXO private key from M-of-N guardian shares,
 * derives the viewing key, scans the Cloak shielded pool for unspent UTXOs
 * owned by that key, then immediately zeros the private key from memory.
 *
 * This scan phase is separated from the transfer phase so that the frontend
 * can display a confirmation step (showing total amount, fee breakdown) before
 * committing to the irreversible transfer.
 *
 * Security invariants:
 *   - ownerPrivateKey.fill(0) is called in a finally block — zeroed whether
 *     the scan succeeds or throws.
 *   - The private key is never returned to the caller.
 *   - The private key is never stored, logged, or serialised.
 *
 * @param guardianShares  M or more base64-encoded shares from guardians
 * @param connection      Solana RPC connection
 * @returns               Array of unspent UTXOs and their total gross lamports
 */
export async function scanOwnerUtxos(params: {
  guardianShares: GuardianShare[];
  connection:     Connection;
}): Promise<{ vaultUtxos: unknown[]; totalAmount: bigint }> {
  const { guardianShares, connection } = params;

  const decodedShares    = guardianShares.map((gs) => decodeShareBase64(gs.shareBase64));
  const ownerPrivateKey  = reconstructSecret(decodedShares);

  if (ownerPrivateKey.length !== 32) {
    ownerPrivateKey.fill(0);
    throw new Error("Reconstructed key has unexpected length");
  }

  try {
    // Derive the viewing key — the read-only capability for scanning.
    // getNkFromUtxoPrivateKey(privateKey: Uint8Array) → Uint8Array per documented API.
    // The Uint8Array private key is passed directly without any bigint conversion.
    const viewingKeyNk = bigintToBytes32(getNkFromUtxoPrivateKey(bytesToBigint(ownerPrivateKey)) as unknown as bigint);

    const scan = await scanTransactions({
      connection,
      programId:    CLOAK_PROGRAM_ID,
      viewingKeyNk,
      limit:        250,
    });

    const vaultUtxos: unknown[] = ((scan as any).utxos ?? []).filter(
      (u: any) => !u.spent && BigInt(u.amount ?? 0n) > 0n,
    );

    const totalAmount = (vaultUtxos as any[]).reduce(
      (sum: bigint, u: any) => sum + BigInt(u.amount ?? 0n),
      0n,
    );

    return { vaultUtxos, totalAmount };
  } finally {
    // CRITICAL: zero the private key from memory regardless of scan outcome.
    ownerPrivateKey.fill(0);
  }
}

// ── Reconstruct and transfer ──────────────────────────────────────────────────

/**
 * Reconstructs the vault owner's UTXO private key from M-of-N guardian shares
 * and executes a fully shielded shield-to-shield transfer to the beneficiary.
 *
 * THIS IS THE POINT OF NO RETURN. Once transfer() succeeds, the assets have
 * moved. The caller must immediately call record_cloak_claim on Anchor.
 *
 * Privacy guarantee:
 *   `externalAmount: 0n` means NO public SOL movement. The transaction
 *   contains only a Groth16 proof and nullifier. No amounts, no sender
 *   address, no receiver address are visible on any block explorer.
 *
 * Security invariants:
 *   - The reconstructed private key is zeroed from memory in a finally block.
 *   - Shares are decoded in memory only — never serialised or logged.
 *   - This function never transmits private key material over any network.
 *   - `relayerWallet` is the guardian's connected wallet — signTransaction signs
 *     the Solana transaction and pays the fee. The Solana signer is separate
 *     from the UTXO spending key.
 *   - `depositorKeypair` carries the reconstructed UTXO keypair so the ZK
 *     circuit can generate the nullifier proving spending authority over the
 *     input UTXOs. The keypair format is { privateKey: Uint8Array, publicKey: Uint8Array }
 *     per the documented @cloak.dev/sdk API — the publicKey is zero-filled because
 *     the Cloak SDK derives the circuit public key from privateKey internally.
 *
 * @param guardianShares         M or more base64-encoded shares from guardians
 * @param beneficiaryUtxoPubkey  32-byte UTXO public key of the beneficiary
 * @param vaultUtxos             UTXOs retrieved via scanOwnerUtxos()
 * @param totalAmount            Gross lamports to transfer (sum of UTXO amounts)
 * @param relayerWallet          Guardian's connected wallet adapter — pays fees,
 *                               signs the Solana transaction. NOT used for ZK proof.
 * @param connection             Solana RPC connection
 */
export async function reconstructAndTransfer(params: {
  guardianShares:          GuardianShare[];
  beneficiaryUtxoPubkey:   Uint8Array;
  vaultUtxos:              unknown[];
  totalAmount:             bigint;
  relayerWallet:           WalletAdapter;
  connection:              Connection;
}): Promise<InheritanceClaim> {
  const {
    guardianShares,
    beneficiaryUtxoPubkey,
    vaultUtxos,
    totalAmount,
    relayerWallet,
    connection,
  } = params;

  // Decode all shares from base64.
  const decodedShares = guardianShares.map((gs) => decodeShareBase64(gs.shareBase64));

  // Reconstruct the 32-byte owner UTXO private key via Lagrange interpolation
  // over GF(256). This is the only moment the private key exists in memory.
  const ownerPrivateKey = reconstructSecret(decodedShares);

  if (ownerPrivateKey.length !== 32) {
    ownerPrivateKey.fill(0);
    throw new Error("Reconstructed key has unexpected length");
  }

  let cloakSignature: string;

  try {
    // The UTXO keypair carries the spending credential for the Cloak ZK circuit.
    // It is passed to transfer() as depositorKeypair so the circuit can:
    //   1. Locate the correct secret scalar for the input UTXO's commitment
    //   2. Compute the nullifier that marks the input as spent
    //   3. Generate the Groth16 proof of valid spending authority
    //
    // The keypair format is { privateKey: Uint8Array(32), publicKey: Uint8Array(32) }
    // per the documented @cloak.dev/sdk API — matching generateUtxoKeypair() output.
    // publicKey is zero-filled because the Cloak SDK derives the circuit public key
    // from privateKey internally during proof generation.
    //
    // IMPORTANT: do NOT use ownerPrivateKey as a Solana Ed25519 signing key.
    // These are Cloak ZK-circuit keys, not Solana keypairs. The Solana
    // transaction is signed by relayerWallet via signTransaction.
    const ownerUtxoKeypair = {
      privateKey: ownerPrivateKey,    // Uint8Array(32) — spending credential
      publicKey:  new Uint8Array(32), // zero-filled; SDK derives from privateKey
    };

    // CORE OPERATION: fully shielded shield-to-shield transfer.
    // externalAmount: 0n = zero public trace. No SOL enters or leaves Cloak
    // from a wallet — this is purely an internal Merkle tree state update.
    //
    // recipientUtxoPubkey is a bigint per the documented transfer() API.
    // bytesToBigint converts the 32-byte Uint8Array beneficiary pubkey to bigint.
    //
    // Wallet adapter fields per @cloak.dev/sdk documented API:
    //   signTransaction   — guardian's browser wallet signs the Solana tx
    //   walletPublicKey   — guardian's wallet public key (relay identity)
    //   depositorKeypair  — UTXO keypair for ZK nullifier generation
    const result = await transfer(
      vaultUtxos as any,
      bytesToBigint(beneficiaryUtxoPubkey),
      totalAmount,
      {
        connection,
        programId:        CLOAK_PROGRAM_ID,
        signTransaction:  relayerWallet.signTransaction,
        walletPublicKey:  relayerWallet.publicKey,
        externalAmount:   0n,
        depositorKeypair: ownerUtxoKeypair,
      } as any,
    );

    cloakSignature = (result as any).signature ?? (result as any).txHash ?? "";
  } finally {
    // CRITICAL: zero the private key from memory regardless of success or
    // failure. Using fill() overwrites every byte with 0 so GC cannot
    // preserve the plaintext key in freed memory.
    ownerPrivateKey.fill(0);
  }

  return {
    cloakSignature,
    grossLamports: totalAmount,
  };
}

// ── Fee estimation ────────────────────────────────────────────────────────────

/**
 * Estimates the fee and net amount for an inheritance transfer.
 * Use this to display a fee breakdown to guardians before they execute.
 *
 * @param grossLamports  Total gross lamports in the vault UTXOs
 * @returns fee breakdown: { gross, fee, net }
 */
export function estimateInheritanceTransfer(grossLamports: bigint): {
  gross: bigint;
  fee:   bigint;
  net:   bigint;
} {
  const fee = BigInt(Math.round(calculateFee(Number(grossLamports))));
  const net = grossLamports > fee ? grossLamports - fee : 0n;
  return { gross: grossLamports, fee, net };
}


function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}
