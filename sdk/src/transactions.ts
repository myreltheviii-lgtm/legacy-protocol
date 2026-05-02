// sdk/src/transactions.ts
//
// Higher-level transaction helpers that wrap the raw instruction builders with
// simulation, retry, submission, and confirmation.
//
// Level 2 (existing): withRetry, sendAndConfirmLegacyTx, sendAndConfirmVersionedTx,
//   simulateTx, isTransientError.
//
// Level 4 (new): offline signing support for hardware wallets and air-gapped
//   machines. Flow:
//     1. buildUnsignedTransaction  — assembles a Transaction without signing,
//                                    returning an UnsignedTxPayload with the
//                                    blockhash and lastValidBlockHeight.
//     2. deserializeAndSubmitTx    — accepts a base64 fully-signed tx plus the
//                                    original UnsignedTxPayload (for proper
//                                    blockhash-expiry confirmation) and submits.
//
// Callers that need the offline path:
//   const payload = await buildUnsignedTransaction(connection, wallet.publicKey, [ix]);
//   // ... export payload.txBase64 to air-gapped signer (QR, file, etc.) ...
//   const result = await deserializeAndSubmitTx(connection, signedBase64, payload);
//
// Passing the UnsignedTxPayload to deserializeAndSubmitTx is required to use
// the preferred { signature, blockhash, lastValidBlockHeight } confirmation
// overload. Without it the call falls back to the deprecated signature-only
// overload which cannot verify blockhash expiry client-side.

import {
  Connection,
  Transaction,
  TransactionInstruction,
  PublicKey,
  SendOptions,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
} from "@solana/web3.js";

// ── Wallet adapter interface ──────────────────────────────────────────────────

export interface WalletAdapter {
  publicKey: PublicKey | null;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions?<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

// ── Retry engine ──────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs:  number;
  maxJitterMs: number;
  isRetryable?: (err: unknown) => boolean;
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1_500,
  maxDelayMs:  15_000,
  maxJitterMs: 300,
};

export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  const permanent = [
    "already triggered for inheritance",
    "already been claimed",
    "already been emergency-swept",
    "inheritance threshold has not been reached",
    "only the vault owner",
    "only an active guardian",
    "only the vault beneficiary",
    "wallet not connected",
    "user rejected",
  ];
  return !permanent.some((p) => msg.includes(p));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const o = { ...DEFAULT_RETRY, ...opts };
  let lastErr: unknown;

  for (let attempt = 1; attempt <= o.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = o.isRetryable ? o.isRetryable(err) : isTransientError(err);
      if (!retryable || attempt === o.maxAttempts) throw err;

      const exponential = Math.min(o.baseDelayMs * Math.pow(2, attempt - 1), o.maxDelayMs);
      const jitter      = Math.random() * o.maxJitterMs;
      await sleep(Math.floor(exponential + jitter));
    }
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core send-and-confirm ─────────────────────────────────────────────────────

export interface SendTxOptions {
  commitment?:    "processed" | "confirmed" | "finalized";
  timeoutMs?:     number;
  skipPreflight?: boolean;
  lookupTables?:  AddressLookupTableAccount[];
  retry?:         Partial<RetryOptions>;
}

export interface SendTxResult {
  signature: string;
  slot:      number;
}

export async function sendAndConfirmLegacyTx(
  connection:   Connection,
  wallet:       WalletAdapter,
  instructions: TransactionInstruction[],
  options:      SendTxOptions = {},
): Promise<SendTxResult> {
  const {
    commitment    = "confirmed",
    timeoutMs     = 60_000,
    skipPreflight = false,
    retry         = {},
  } = options;

  if (!wallet.publicKey) throw new Error("Wallet not connected");

  return withRetry(async () => {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash(commitment);

    const tx = new Transaction();
    tx.recentBlockhash    = blockhash;
    tx.feePayer           = wallet.publicKey!;
    tx.add(...instructions);

    const signed = await wallet.signTransaction(tx);
    const sig    = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight,
      preflightCommitment: commitment,
    } as SendOptions);

    const confirmed = await Promise.race([
      connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        commitment,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Transaction ${sig} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);

    if (confirmed.value.err) {
      throw new Error(`Transaction ${sig} failed: ${JSON.stringify(confirmed.value.err)}`);
    }

    const slotInfo = await connection.getSignatureStatus(sig);
    return { signature: sig, slot: slotInfo.value?.slot ?? 0 };
  }, { ...retry, isRetryable: isTransientError });
}

export async function sendAndConfirmVersionedTx(
  connection:   Connection,
  wallet:       WalletAdapter,
  instructions: TransactionInstruction[],
  options:      SendTxOptions = {},
): Promise<SendTxResult> {
  const {
    commitment    = "confirmed",
    timeoutMs     = 60_000,
    skipPreflight = false,
    lookupTables  = [],
    retry         = {},
  } = options;

  if (!wallet.publicKey) throw new Error("Wallet not connected");

  return withRetry(async () => {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash(commitment);

    const message = new TransactionMessage({
      payerKey:        wallet.publicKey!,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);

    const versionedTx = new VersionedTransaction(message);
    const signed      = await wallet.signTransaction(versionedTx);
    const sig         = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight,
      preflightCommitment: commitment,
    });

    const confirmed = await Promise.race([
      connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        commitment,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Transaction ${sig} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);

    if (confirmed.value.err) {
      throw new Error(`Transaction ${sig} failed: ${JSON.stringify(confirmed.value.err)}`);
    }

    const slotInfo = await connection.getSignatureStatus(sig);
    return { signature: sig, slot: slotInfo.value?.slot ?? 0 };
  }, { ...retry, isRetryable: isTransientError });
}

export async function simulateTx(
  connection:   Connection,
  feePayer:     PublicKey,
  instructions: TransactionInstruction[],
): Promise<{ success: boolean; logs: string[] }> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer        = feePayer;
  tx.add(...instructions);

  const result = await connection.simulateTransaction(tx);
  return { success: result.value.err === null, logs: result.value.logs ?? [] };
}

// ── Offline signing support — Level 4 ────────────────────────────────────────

/**
 * The result of buildUnsignedTransaction. `txBase64` is the unsigned tx
 * serialised as base64 — suitable for export via QR code, file, or NFC to
 * an air-gapped hardware wallet. The `blockhash` and `lastValidBlockHeight`
 * must be passed to deserializeAndSubmitTx to enable proper blockhash-expiry
 * confirmation tracking.
 */
export interface UnsignedTxPayload {
  /** Base64-encoded unsigned transaction, ready to import into a signing device. */
  txBase64:             string;
  /** The blockhash embedded in this transaction. Used for expiry tracking. */
  blockhash:            string;
  /** The slot after which this transaction's blockhash is no longer valid. */
  lastValidBlockHeight: number;
  /** The feePayer expected to sign this transaction. */
  feePayer:             string;
}

/**
 * Assembles a legacy Transaction from the given instructions, fetches a fresh
 * blockhash, and returns the serialised unsigned transaction as base64.
 *
 * The returned payload can be exported to an air-gapped signer (hardware
 * wallet, paper wallet, HSM) via any side-channel. The signer imports the
 * base64, signs it, and returns the signed base64 for submission via
 * deserializeAndSubmitTx().
 *
 * Pass the entire UnsignedTxPayload to deserializeAndSubmitTx so it can use
 * the blockhash + lastValidBlockHeight confirmation strategy, which correctly
 * detects blockhash expiry without relying on the deprecated signature-only
 * overload.
 *
 * A fresh blockhash is fetched on each call. Blockhashes are valid for ~90
 * seconds (~150 slots). Callers must submit the signed transaction before
 * lastValidBlockHeight is reached or the transaction will be rejected.
 */
export async function buildUnsignedTransaction(
  connection:   Connection,
  feePayer:     PublicKey,
  instructions: TransactionInstruction[],
  commitment:   "processed" | "confirmed" | "finalized" = "confirmed",
): Promise<UnsignedTxPayload> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);

  const tx = new Transaction();
  tx.recentBlockhash    = blockhash;
  tx.feePayer           = feePayer;
  tx.add(...instructions);

  // Serialise without requiring signatures. The resulting bytes represent an
  // unsigned transaction that any compatible signing device can accept.
  const serialized = tx.serialize({ requireAllSignatures: false });
  const txBase64   = serialized.toString("base64");

  return {
    txBase64,
    blockhash,
    lastValidBlockHeight,
    feePayer: feePayer.toBase58(),
  };
}

/**
 * Accepts a base64-encoded, fully-signed transaction (as returned by an
 * air-gapped signing device or hardware wallet), submits it to the network,
 * and waits for confirmation.
 *
 * Pass the `payload` returned by buildUnsignedTransaction to enable the
 * { signature, blockhash, lastValidBlockHeight } confirmation strategy.
 * Without it the call cannot verify blockhash expiry client-side and must
 * fall back to waiting for the server to reject an expired transaction.
 *
 * The commitment level and timeout are configurable. On blockhash expiry or
 * network rejection, a descriptive error is thrown.
 */
export async function deserializeAndSubmitTx(
  connection:   Connection,
  signedBase64: string,
  options: {
    commitment?:          "processed" | "confirmed" | "finalized";
    timeoutMs?:           number;
    skipPreflight?:       boolean;
    /** Pass the UnsignedTxPayload from buildUnsignedTransaction for proper expiry tracking. */
    unsignedPayload?:     Pick<UnsignedTxPayload, "blockhash" | "lastValidBlockHeight">;
  } = {},
): Promise<SendTxResult> {
  const {
    commitment    = "confirmed",
    timeoutMs     = 60_000,
    skipPreflight = false,
    unsignedPayload,
  } = options;

  let rawBytes: Buffer;
  try {
    rawBytes = Buffer.from(signedBase64, "base64");
  } catch {
    throw new Error("deserializeAndSubmitTx: signedBase64 is not valid base64");
  }

  // Deserialise to verify the signature is structurally present before sending.
  // Transaction.from throws if the buffer is malformed.
  let tx: Transaction;
  try {
    tx = Transaction.from(rawBytes);
  } catch {
    throw new Error("deserializeAndSubmitTx: failed to deserialise transaction bytes");
  }

  if (!tx.signature) {
    throw new Error("deserializeAndSubmitTx: transaction has no signature — it was not signed");
  }

  const sig = await connection.sendRawTransaction(rawBytes, {
    skipPreflight,
    preflightCommitment: commitment,
  } as SendOptions);

  // Use the blockhash + lastValidBlockHeight confirmation strategy when the
  // caller has supplied the original payload. This allows the RPC client to
  // detect expiry before the blockhash window closes, producing a fast failure
  // rather than silently hanging until the timeout fires.
  //
  // Without the payload the best available fallback is the signature-only
  // overload. This is safe (the server still enforces expiry) but means the
  // client cannot distinguish "expired" from "not yet confirmed" without
  // waiting for the full timeoutMs.
  let confirmPromise: Promise<unknown>;
  if (unsignedPayload) {
    confirmPromise = connection.confirmTransaction(
      {
        signature:           sig,
        blockhash:           unsignedPayload.blockhash,
        lastValidBlockHeight: unsignedPayload.lastValidBlockHeight,
      },
      commitment,
    );
  } else {
    // Deprecated overload — acceptable only when the payload is unavailable.
    // Logs a warning so operators know expiry tracking is degraded.
    console.warn(
      "deserializeAndSubmitTx: unsignedPayload not provided — using deprecated " +
      "signature-only confirmation; blockhash expiry cannot be tracked client-side.",
    );
    confirmPromise = connection.confirmTransaction(sig, commitment);
  }

  const confirmed = await Promise.race([
    confirmPromise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Transaction ${sig} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]) as { value?: { err?: unknown } };

  if (confirmed?.value?.err) {
    throw new Error(`Transaction ${sig} failed: ${JSON.stringify(confirmed.value.err)}`);
  }

  const slotInfo = await connection.getSignatureStatus(sig);
  return { signature: sig, slot: slotInfo.value?.slot ?? 0 };
}

/**
 * Convenience wrapper: combines buildUnsignedTransaction and
 * deserializeAndSubmitTx for callers that have a synchronous signing function
 * (e.g., a local Keypair.sign call) rather than an async wallet adapter.
 * Suitable for Node.js scripts and tests.
 *
 * The UnsignedTxPayload is automatically threaded to deserializeAndSubmitTx
 * so the blockhash + lastValidBlockHeight confirmation strategy is always used.
 */
export async function signOfflineAndSubmit(
  connection:   Connection,
  feePayer:     PublicKey,
  instructions: TransactionInstruction[],
  signerFn:     (txBase64: string) => string | Promise<string>,
  options:      { commitment?: "processed" | "confirmed" | "finalized"; timeoutMs?: number } = {},
): Promise<SendTxResult> {
  const payload   = await buildUnsignedTransaction(connection, feePayer, instructions, options.commitment);
  const signed    = await signerFn(payload.txBase64);
  return deserializeAndSubmitTx(connection, signed, {
    commitment:      options.commitment,
    timeoutMs:       options.timeoutMs,
    unsignedPayload: payload,
  });
}