// cloak-integration/src/shield.ts
//
// Shielded vault operations: deposit SOL into the Cloak pool and split the
// owner's UTXO private key into guardian shares for M-of-N recovery.

import {
  CLOAK_PROGRAM_ID,
  NATIVE_SOL_MINT,
  MIN_DEPOSIT_LAMPORTS,
  generateUtxoKeypair,
  createUtxo,
  createZeroUtxo,
  transact,
  getNkFromUtxoPrivateKey,
  getDistributableAmount,
} from "@cloak.dev/sdk";
import {
  splitSecret,
  encodeShareBase64,
} from "@legacy-protocol/sdk";
import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type {
  UtxoIdentity,
  GuardianShare,
  ShieldedDepositResult,
} from "./types";

// ── Conversion helpers ────────────────────────────────────────────────────────
function bytesToBigint(arr: Uint8Array): bigint {
  let result = 0n;
  for (const byte of arr) { result = (result << 8n) | BigInt(byte); }
  return result;
}


// ── Wallet adapter type ───────────────────────────────────────────────────────

/**
 * Minimal wallet adapter interface for the vault owner's connected browser wallet.
 * Used to sign and pay for the Cloak deposit Solana transaction.
 *
 * Matches the wallet adapter fields required by @cloak.dev/sdk's transact()
 * wallet adapter path: signTransaction + publicKey (passed as depositorPublicKey
 * and walletPublicKey in TransactOptions).
 *
 * Compatible with @solana/wallet-adapter-react's useWallet() return type.
 */
export interface ShieldWalletAdapter {
  publicKey:       PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
}

// ── Vault owner identity ──────────────────────────────────────────────────────

/**
 * Generates the owner's UTXO keypair — the master key that controls spending
 * from the shielded pool. This is called once per vault setup.
 *
 * THE PRIVATE KEY IS NEVER TRANSMITTED OR STORED BY THIS FUNCTION.
 * The caller must immediately Shamir-split it via splitOwnerKey() and
 * distribute the shares to guardians before the private key leaves memory.
 *
 * generateUtxoKeypair() returns { privateKey: Uint8Array(32), publicKey: Uint8Array(32) }
 * per the documented @cloak.dev/sdk API. Values are stored directly without
 * any intermediate bigint conversion.
 *
 * @returns UtxoIdentity with privateKey, publicKey, and viewingKeyNk.
 */
export async function createOwnerUtxoIdentity(): Promise<UtxoIdentity> {
  const keypair      = await generateUtxoKeypair();
  // generateUtxoKeypair() returns Uint8Array values directly — assign without conversion.
  const privateKey   = keypair.privateKey as Uint8Array;
  const publicKey    = keypair.publicKey  as Uint8Array;
  // getNkFromUtxoPrivateKey(privateKey: Uint8Array) → Uint8Array per documented API.
  const viewingKeyNk = getNkFromUtxoPrivateKey(keypair.privateKey) as unknown as Uint8Array;
  return { privateKey, publicKey, viewingKeyNk };
}

// ── Shielded deposit ──────────────────────────────────────────────────────────

/**
 * Deposits SOL from the owner's wallet into the Cloak shielded pool,
 * creating a new UTXO owned by the owner's UTXO keypair.
 *
 * The Cloak Solana transaction is signed by the owner's connected wallet
 * adapter — the wallet's signTransaction function is passed directly to
 * transact() as required by @cloak.dev/sdk's wallet adapter path:
 *   options.signTransaction     — signs the Solana transaction
 *   options.depositorPublicKey  — wallet's public key (payer identity)
 *   options.walletPublicKey     — wallet's public key (relay identity)
 *   options.chainNoteViewingKeyNk — viewing key for chain note encryption
 *
 * After this call, the caller must submit a record_cloak_deposit instruction
 * to the Legacy Vault program to store the UTXO commitment on-chain.
 *
 * @param ownerUtxo      The owner's UTXO keypair (controls the shielded output)
 * @param ownerWallet    The owner's connected wallet adapter (pays transaction fee)
 * @param amountLamports Gross lamports to shield (fee deducted by Cloak)
 * @param connection     Solana RPC connection
 */
export async function depositToShieldedVault(params: {
  ownerUtxo:       UtxoIdentity;
  ownerWallet:     ShieldWalletAdapter;
  amountLamports:  bigint;
  connection:      Connection;
}): Promise<ShieldedDepositResult> {
  const { ownerUtxo, ownerWallet, amountLamports, connection } = params;

  if (amountLamports < MIN_DEPOSIT_LAMPORTS) {
    throw new Error(
      `Minimum deposit is ${MIN_DEPOSIT_LAMPORTS} lamports (${Number(MIN_DEPOSIT_LAMPORTS) / 1e9} SOL). ` +
      `Got ${amountLamports} lamports.`
    );
  }

  const viewingKeyNk = ownerUtxo.viewingKeyNk;

  // Build the output UTXO representing the shielded balance. The UTXO keypair
  // is passed as { privateKey: Uint8Array, publicKey: Uint8Array } per the
  // documented @cloak.dev/sdk createUtxo API — the same format returned by
  // generateUtxoKeypair().
  const output    = await createUtxo(
    amountLamports,
    { privateKey: ownerUtxo.privateKey, publicKey: ownerUtxo.publicKey },
    NATIVE_SOL_MINT,
  );

  // Zero-value input UTXO is required by Cloak's circuit for fresh deposits.
  const zeroInput = await createZeroUtxo(NATIVE_SOL_MINT);

  // Wallet adapter mode for the Solana transaction:
  //   signTransaction     — the owner's browser wallet signs + pays the fee
  //   depositorPublicKey  — wallet public key identifying the depositor
  //   walletPublicKey     — wallet public key for relay identity binding
  //   chainNoteViewingKeyNk — owner's viewing key (bigint) for encrypting the chain note
  //
  // These are the exact field names required by @cloak.dev/sdk's TransactOptions
  // in wallet adapter mode (see sdk/wallet-integration docs). There is no
  // combined `walletAdapter` object in the actual SDK API.
  const deposited = await transact(
    {
      inputUtxos:     [zeroInput],
      outputUtxos:    [output],
      externalAmount: amountLamports,
      depositor:      ownerWallet.publicKey,
    },
    {
      connection,
      programId:             CLOAK_PROGRAM_ID,
      signTransaction:       ownerWallet.signTransaction,
      depositorPublicKey:    ownerWallet.publicKey,
      walletPublicKey:       ownerWallet.publicKey,
      chainNoteViewingKeyNk: bytesToBigint(viewingKeyNk),
    } as any,
  );

  // Extract the UTXO commitment from the output.
  const outputUtxo = deposited.outputUtxos[0];
  if (!outputUtxo) {
    throw new Error("Cloak transact() returned no output UTXOs");
  }

  const commitmentField = (outputUtxo as any).commitment;
  let utxoCommitment: Uint8Array;
  if (commitmentField instanceof Uint8Array) {
    utxoCommitment = commitmentField;
  } else if (typeof commitmentField === "bigint") {
    utxoCommitment = bigintToBytes32(commitmentField);
  } else {
    throw new Error("Unexpected commitment type from Cloak SDK");
  }

  // Leaf index comes from commitmentIndices (array parallel to outputUtxos).
  const leafIndex     = (deposited as any).commitmentIndices?.[0] ?? 0n;
  const utxoLeafIndex = typeof leafIndex === "bigint" ? leafIndex : BigInt(leafIndex);

  const netLamports = BigInt(Math.round(getDistributableAmount(Number(amountLamports))));

  return {
    cloakSignature: deposited.signature,
    utxoCommitment,
    utxoLeafIndex,
    netLamports,
  };
}

// ── Key splitting ─────────────────────────────────────────────────────────────

/**
 * Splits the vault owner's UTXO private key into N Shamir shares.
 * Returns an array of GuardianShare objects ready for distribution.
 *
 * The raw private key bytes are never returned — only the encoded shares.
 *
 * Security invariant: `ownerUtxoPrivateKey` is zeroed from memory in a
 * `finally` block that wraps the entire function body — zeroing is guaranteed
 * in every code path including validation failures that throw before the inner
 * splitSecret() call. Without this outer wrapper, a length or threshold check
 * failure would skip the fill(0) call and leave the key in memory.
 *
 * Callers should still zero the key themselves as a defense-in-depth
 * measure (e.g. GuardianShareDistribution.tsx does so in its own finally
 * block), but this function guarantees zeroing even if the caller forgets.
 *
 * @param ownerUtxoPrivateKey  32-byte private key from the owner's UtxoIdentity
 * @param threshold            Minimum shares needed to reconstruct (M)
 * @param numShares            Total shares to produce (N)
 * @param guardianWallets      Solana wallet addresses of each guardian (for labelling)
 */
export function splitOwnerKey(
  ownerUtxoPrivateKey: Uint8Array,
  threshold:           number,
  numShares:           number,
  guardianWallets:     string[] = [],
): GuardianShare[] {
  // Outer try/finally ensures ownerUtxoPrivateKey is zeroed in ALL code paths —
  // including the validation checks below that throw before splitSecret() is called.
  // Previously these validations were outside the try block, meaning a failed check
  // would skip the finally and leave the private key in memory.
  try {
    if (ownerUtxoPrivateKey.length !== 32) {
      throw new Error("UTXO private key must be 32 bytes");
    }
    if (threshold < 1 || threshold > numShares) {
      throw new Error(`Invalid threshold: M=${threshold}, N=${numShares}. Need 1 ≤ M ≤ N.`);
    }
    if (numShares > 10) {
      throw new Error("Maximum 10 guardian shares supported");
    }

    const rawShares = splitSecret(ownerUtxoPrivateKey, threshold, numShares);

    return rawShares.map((share, i) => ({
      shareIndex:     share.index,
      shareBase64:    encodeShareBase64(share),
      guardianWallet: guardianWallets[i] ?? `guardian-${i + 1}`,
    }));
  } finally {
    // CRITICAL: zero the private key from memory regardless of success or
    // failure. Using fill() overwrites every byte with 0 so GC cannot
    // preserve the plaintext key in freed memory. This matches the zeroing
    // pattern enforced in reconstructAndTransfer and scanOwnerUtxos.
    ownerUtxoPrivateKey.fill(0);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}
