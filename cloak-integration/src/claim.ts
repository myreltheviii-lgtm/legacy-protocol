// cloak-integration/src/claim.ts
//
// Beneficiary-side operations: withdraw shielded inheritance to a real wallet
// and generate a compliance proof of receipt.

import {
  CLOAK_PROGRAM_ID,
  getNkFromUtxoPrivateKey,
  scanTransactions,
  toComplianceReport,
  fullWithdraw,
} from "@cloak.dev/sdk";
import type { Connection, PublicKey } from "@solana/web3.js";
import { PublicKey as SolanaPublicKey } from "@solana/web3.js";
import type { ComplianceProof } from "./types";

// ── Wallet adapter type ───────────────────────────────────────────────────────

/**
 * Minimal wallet adapter interface for the beneficiary's connected browser wallet.
 *
 * @cloak.dev/sdk's fullWithdraw() wallet adapter path uses `signMessage` (not
 * `signTransaction`) per the documented wallet-integration API. The wallet
 * adapter pays the Solana transaction via the relay, and `signMessage` is used
 * to authorize the withdrawal intent.
 *
 * Compatible with @solana/wallet-adapter-react's useWallet() return type.
 * The frontend must extract `signMessage` from useWallet() — not signTransaction.
 */
export interface ClaimWalletAdapter {
  publicKey:   PublicKey;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

// ── Claim to wallet ───────────────────────────────────────────────────────────

/**
 * Scans for UTXOs owned by the beneficiary's UTXO keypair, then withdraws
 * all found UTXOs to the specified recipient wallet (defaults to the connected
 * wallet if `recipientWallet` is not supplied).
 *
 * Flow:
 *   1. Derive viewing key from private key
 *   2. Scan Cloak transactions for UTXOs belonging to this viewing key
 *   3. Call fullWithdraw() on found UTXOs → SOL enters real wallet
 *
 * The `recipientWallet` parameter allows the beneficiary to direct the
 * withdrawn SOL to any Solana address — not only the connected wallet.
 * If omitted, the connected wallet's public key is used as the recipient.
 *
 * The beneficiary's real wallet address never touches the Cloak shielded pool
 * and is never visible to block explorers until fullWithdraw is called.
 * Only the nullifiers of spent UTXOs appear on-chain.
 *
 * Per @cloak.dev/sdk wallet adapter documentation, fullWithdraw() in browser
 * mode takes:
 *   signMessage     — wallet adapter message signing (NOT signTransaction)
 *   walletPublicKey — wallet's public key for relay identity
 *
 * Security invariants:
 *   - beneficiaryUtxoPrivateKey is zeroed in a finally block that wraps the
 *     entire function body — zeroing is guaranteed in every code path including
 *     validation failures, viewingKey derivation failures, and scan failures.
 *   - The private key is never logged, serialised, or transmitted over any
 *     network channel.
 *
 * @param beneficiaryUtxoPrivateKey  32-byte private key from UtxoIdentity
 * @param beneficiaryWallet          Connected wallet adapter (signMessage + publicKey).
 *                                   publicKey is used as the relay identity.
 * @param recipientWallet            Optional base58 Solana address to receive
 *                                   withdrawn SOL. Defaults to beneficiaryWallet.publicKey.
 * @param connection                 Solana RPC connection
 */
export async function claimInheritanceToWallet(params: {
  beneficiaryUtxoPrivateKey: Uint8Array;
  beneficiaryWallet:         ClaimWalletAdapter;
  connection:                Connection;
  /** Optional: override the recipient Solana address for the withdrawal. */
  recipientWallet?:          string;
}): Promise<{ signature: string; receivedLamports: bigint }> {
  const {
    beneficiaryUtxoPrivateKey,
    beneficiaryWallet,
    connection,
    recipientWallet,
  } = params;

  // Outer try/finally guarantees that beneficiaryUtxoPrivateKey is zeroed in
  // every code path — including validation failures (invalid recipientWallet
  // address) and getNkFromUtxoPrivateKey errors — not only when the async
  // Cloak operations succeed or fail. Without this outer wrapper, an exception
  // thrown before the inner try/finally is established would skip zeroing.
  let signature:     string;
  let receivedTotal: bigint;

  try {
    // Resolve the recipient PublicKey. If a custom address was supplied, parse
    // it; otherwise fall back to the connected wallet's public key.
    let recipientPublicKey: PublicKey;
    if (recipientWallet && recipientWallet.trim()) {
      try {
        recipientPublicKey = new SolanaPublicKey(recipientWallet.trim());
      } catch {
        throw new Error(
          `Invalid recipient wallet address: "${recipientWallet}". Must be a valid base58 Solana public key.`,
        );
      }
    } else {
      recipientPublicKey = beneficiaryWallet.publicKey;
    }

    // Derive the viewing key before the inner scan block so we can scan
    // without holding the spending key any longer than necessary.
    // getNkFromUtxoPrivateKey(privateKey: Uint8Array) → Uint8Array per documented API.
    // The Uint8Array private key is passed directly without bigint conversion.
    // This call is now inside the outer try/finally so any exception it throws
    // still results in the private key being zeroed.
    const viewingKeyNk = getNkFromUtxoPrivateKey(beneficiaryUtxoPrivateKey) as unknown as Uint8Array;

    // Scan the Cloak program's transaction history for UTXOs decryptable by
    // this viewing key. limit:250 covers most vaults; increase if needed.
    const scan = await scanTransactions({
      connection,
      programId:    CLOAK_PROGRAM_ID,
      viewingKeyNk,
      limit:        250,
    });

    // Filter to only unspent UTXOs with a positive balance.
    const inheritanceUtxos = (scan as any).utxos?.filter(
      (u: any) => !u.spent && u.amount > 0n
    ) ?? [];

    if (inheritanceUtxos.length === 0) {
      throw new Error(
        "No unspent UTXOs found for this beneficiary identity. " +
        "Make sure the guardian inheritance transfer has completed."
      );
    }

    // fullWithdraw() wallet adapter path per @cloak.dev/sdk wallet-integration docs:
    //   recipientWallet — the resolved recipient PublicKey (receives the withdrawn SOL)
    //   signMessage     — wallet adapter's message signer (NOT signTransaction)
    //   walletPublicKey — connected wallet's public key for relay identity
    //
    // The UTXOs returned by scanTransactions carry the cryptographic material
    // needed for proof generation internally. The ZK circuit uses the UTXO
    // data from the scan (commitment, leaf index, chain note) to build the
    // Groth16 proof; no explicit depositorKeypair is required in this path.
    const result = await fullWithdraw(
      inheritanceUtxos,
      recipientPublicKey,
      {
        connection,
        programId:       CLOAK_PROGRAM_ID,
        signMessage:     beneficiaryWallet.signMessage,
        walletPublicKey: beneficiaryWallet.publicKey,
      } as any,
    );

    signature    = (result as any).signature ?? (result as any).txHash ?? "";
    receivedTotal = inheritanceUtxos.reduce(
      (sum: bigint, u: any) => sum + BigInt(u.amount ?? 0n),
      0n
    );
  } finally {
    // CRITICAL: zero the private key from memory regardless of success or
    // failure in ANY code path — including validation failures and errors
    // thrown before the inner scan operations begin. Using fill() overwrites
    // every byte with 0 so GC cannot preserve the plaintext key in freed memory.
    beneficiaryUtxoPrivateKey.fill(0);
  }

  return { signature, receivedLamports: receivedTotal };
}

// ── Compliance proof ──────────────────────────────────────────────────────────

/**
 * Generates a cryptographically verifiable proof that the beneficiary received
 * the inheritance. The proof is exportable as JSON and verifiable by any
 * auditor who knows the viewing key — without revealing the identity to others.
 *
 * Use this for estate planning, tax reporting, or legal verification.
 *
 * Security invariant: `beneficiaryUtxoPrivateKey` is zeroed from memory in a
 * `finally` block that wraps the entire function body — zeroing is guaranteed
 * in every code path including getNkFromUtxoPrivateKey failures, which would
 * otherwise skip zeroing if viewingKey derivation occurred before a try/finally.
 *
 * @param beneficiaryUtxoPrivateKey  32-byte private key from UtxoIdentity
 * @param connection                 Solana RPC connection
 */
export async function generateComplianceProof(params: {
  beneficiaryUtxoPrivateKey: Uint8Array;
  connection:                Connection;
}): Promise<ComplianceProof> {
  const { beneficiaryUtxoPrivateKey, connection } = params;

  // Outer try/finally guarantees zeroing in all code paths, including a throw
  // from getNkFromUtxoPrivateKey before the inner scan operations start.
  let summary:      unknown;
  let transactions: unknown[];
  let generatedAt:  string;

  try {
    // Derive the viewing key — the read-only capability needed for scanning.
    // This is now inside the outer try/finally so any failure still zeroes the key.
    // getNkFromUtxoPrivateKey(privateKey: Uint8Array) → Uint8Array per documented API.
    // The Uint8Array private key is passed directly without bigint conversion.
    const viewingKeyNk = getNkFromUtxoPrivateKey(beneficiaryUtxoPrivateKey) as unknown as Uint8Array;

    const scan = await scanTransactions({
      connection,
      programId:    CLOAK_PROGRAM_ID,
      viewingKeyNk,
      limit:        250,
    });

    const report = toComplianceReport(scan);

    summary      = report.summary;
    transactions = report.transactions;
    generatedAt  = new Date().toISOString();
  } finally {
    // CRITICAL: zero the private key from memory regardless of success or
    // failure in ANY code path. The viewing key (viewingKeyNk) is derived and
    // does not need to be zeroed — it carries no spending authority.
    beneficiaryUtxoPrivateKey.fill(0);
  }

  return { summary, transactions, generatedAt };
}
