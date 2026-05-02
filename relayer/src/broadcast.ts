// relayer/src/broadcast.ts
//
// Constructs and submits the trigger_inheritance transaction.
//
// Level 4: signature verification. When a TriggerReadyEvent carries
// a `signature` and `signerPublicKey`, the relayer verifies the Ed25519
// signature against the canonical payload before submitting. If verification
// fails, the job is marked SIGNATURE_REJECTED and escalated immediately —
// this indicates either a compromised watcher or a corrupted event payload.
//
// Ed25519 verification uses Node.js native crypto.verify(null, data, key, sig).
// The first argument (algorithm) must be null for Ed25519: the algorithm is
// embedded in the key object's OID and does not require a separate specifier.
// Using createVerify("SHA512") applies SHA-512 ECDSA/RSA verification logic
// to an Ed25519 key, which either throws or always returns false.
//
// Public key SPKI DER construction:
//   Ed25519 SubjectPublicKeyInfo DER = 302a300506032b6570032100 (12-byte prefix)
//                                       + 32-byte public key
//   The prefix encodes:
//     SEQUENCE (30 2a)
//       SEQUENCE (30 05)
//         OID 1.3.101.112 (06 03 2b 65 70)
//       BIT STRING (03 21 00)
//         <32 bytes>
//
// Signature verification is skipped when:
//   (a) The event has no signature field (development / single-process mode).
//   (b) TRUSTED_TRIGGER_SIGNER_PUBKEY is not configured (relayer opt-out).
// In both cases a warning is logged so operators know verification is inactive.

import {
  Connection,
  PublicKey,
  Keypair,
  TransactionSignature,
} from "@solana/web3.js";
import { Program }          from "@coral-xyz/anchor";
import { LegacyVault }      from "./types/legacy_vault";
import { TriggerReadyEvent } from "./types/relayer";
import { withRetry, TRIGGER_RETRY_OPTIONS, isSolanaTransientError } from "./retry";
import { verifyTriggerPreflight, PreflightStatus }  from "./verify_threshold";
import { logger }           from "./logger";
import { verify as cryptoVerify, createPublicKey } from "crypto";
import bs58                 from "bs58";

// ── Types ─────────────────────────────────────────────────────────────────────

export enum BroadcastStatus {
  Confirmed          = "CONFIRMED",
  SkippedPreflight   = "SKIPPED_PREFLIGHT",
  Failed             = "FAILED",
  SignatureRejected   = "SIGNATURE_REJECTED",
}

export interface BroadcastResult {
  status:             BroadcastStatus;
  signature?:         TransactionSignature;
  attempts:           number;
  error?:             unknown;
  preflightStatus?:   PreflightStatus;
  signatureVerified?: boolean;
}

// ── Vault PDA seed ────────────────────────────────────────────────────────────

const VAULT_SEED = Buffer.from("vault");

// ── Trusted signer public key ─────────────────────────────────────────────────

// Loaded once at module initialisation. When present, every signed event must
// be verified against this key before broadcast. When absent, signed events
// are accepted with a warning and unsigned events pass through silently.
const TRUSTED_PUBKEY_B58 = process.env["TRUSTED_TRIGGER_SIGNER_PUBKEY"];

if (TRUSTED_PUBKEY_B58) {
  logger.info(
    { pubkey: TRUSTED_PUBKEY_B58 },
    "Trigger signal signature verification enabled",
  );
} else {
  logger.warn(
    "TRUSTED_TRIGGER_SIGNER_PUBKEY not set — trigger signal signature verification disabled",
  );
}

// Ed25519 SubjectPublicKeyInfo DER prefix. This 12-byte prefix, combined with
// the 32-byte public key, produces a 44-byte DER structure that Node.js
// createPublicKey can parse as an Ed25519 SubjectPublicKeyInfo.
// Structure: SEQUENCE (30 2a) > SEQUENCE (30 05) OID id-EdDSA (06 03 2b 65 70)
//            BIT STRING (03 21 00) <32 bytes>
const ED25519_SPKI_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ── Payload canonicalisation (must match watcher/src/alerts/trigger_signal.ts) ──

function canonicalisePayload(event: TriggerReadyEvent): string {
  return JSON.stringify({
    beneficiaryAddress: event.beneficiaryAddress,
    depositedLamports:  event.depositedLamports,
    inactivityScore:    event.inactivityScore,
    maxRetries:         event.maxRetries,
    ownerAddress:       event.ownerAddress,
    signalSlot:         event.signalSlot,
    vaultAddress:       event.vaultAddress,
    vaultIndex:         event.vaultIndex,
  });
}

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Returns true if the event's Ed25519 signature is valid.
 *
 * Uses crypto.verify(null, data, publicKey, signature) — the null algorithm
 * argument instructs Node.js to use the algorithm embedded in the key object
 * (Ed25519 in this case). This is the correct API; createVerify("SHA512")
 * applies RSA/ECDSA-with-SHA512 semantics which will always fail for Ed25519.
 *
 * Returns null (skip verification) when:
 *   - The event carries no signature (unsigned development mode).
 *   - TRUSTED_TRIGGER_SIGNER_PUBKEY is not configured.
 * Returns true / false otherwise.
 */
function verifyEventSignature(event: TriggerReadyEvent): boolean | null {
  if (!event.signature || !event.signerPublicKey) {
    if (TRUSTED_PUBKEY_B58) {
      logger.warn(
        { vault: event.vaultAddress },
        "Trigger event is unsigned but TRUSTED_TRIGGER_SIGNER_PUBKEY is configured — accepting with warning",
      );
    }
    return null; // skip
  }

  if (!TRUSTED_PUBKEY_B58) {
    logger.debug(
      { vault: event.vaultAddress },
      "Event is signed but no trusted pubkey configured — skipping verification",
    );
    return null; // skip
  }

  if (event.signerPublicKey !== TRUSTED_PUBKEY_B58) {
    logger.error(
      {
        vault:           event.vaultAddress,
        eventSigner:     event.signerPublicKey,
        trustedSigner:   TRUSTED_PUBKEY_B58,
      },
      "Trigger event signer does not match TRUSTED_TRIGGER_SIGNER_PUBKEY",
    );
    return false;
  }

  try {
    const sigBytes    = bs58.decode(event.signature);
    const pubKeyBytes = new PublicKey(event.signerPublicKey).toBytes();

    // Construct the SubjectPublicKeyInfo DER so createPublicKey can parse
    // the Ed25519 public key. The 12-byte prefix encodes the algorithm OID;
    // the 32 bytes that follow are the raw public key material.
    const spkiDer       = Buffer.concat([ED25519_SPKI_DER_PREFIX, Buffer.from(pubKeyBytes)]);
    const nodePublicKey = createPublicKey({ key: spkiDer, format: "der", type: "spki" });

    // crypto.verify with null algorithm uses Ed25519 as indicated by the key
    // object's OID. The signature bytes are the raw 64-byte Ed25519 signature
    // produced by crypto.sign(null, ...) on the watcher side.
    const valid = cryptoVerify(
      null,
      Buffer.from(canonicalisePayload(event)),
      nodePublicKey,
      sigBytes,
    );

    if (!valid) {
      logger.error(
        { vault: event.vaultAddress },
        "Trigger event Ed25519 signature is invalid — rejecting",
      );
    }

    return valid;
  } catch (err) {
    logger.error(
      { vault: event.vaultAddress, err },
      "Trigger event signature verification threw — treating as invalid",
    );
    return false;
  }
}

// ── Main broadcast function ───────────────────────────────────────────────────

export async function broadcastTrigger(
  connection:     Connection,
  program:        Program<LegacyVault>,
  relayerKeypair: Keypair,
  event:          TriggerReadyEvent,
): Promise<BroadcastResult> {
  logger.info(
    {
      vault:       event.vaultAddress,
      beneficiary: event.beneficiaryAddress,
      lamports:    event.depositedLamports,
      signed:      Boolean(event.signature),
    },
    "Preparing trigger_inheritance broadcast",
  );

  // ── Step 0: Signature verification (Level 4) ──────────────────────────────
  const sigVerified = verifyEventSignature(event);
  if (sigVerified === false) {
    logger.error(
      { vault: event.vaultAddress },
      "Trigger signal rejected: Ed25519 signature verification failed",
    );
    return {
      status:             BroadcastStatus.SignatureRejected,
      attempts:           0,
      signatureVerified:  false,
      error:              new Error("Ed25519 signature verification failed"),
    };
  }

  // ── Step 1: Pre-flight ────────────────────────────────────────────────────
  const preflight = await verifyTriggerPreflight(
    connection,
    program,
    event.vaultAddress,
    event.ownerAddress,
    event.vaultIndex,
  );

  if (preflight.status !== PreflightStatus.ReadyToTrigger) {
    logger.info(
      { vault: event.vaultAddress, preflightStatus: preflight.status },
      "Pre-flight check failed — skipping broadcast",
    );
    return {
      status:             BroadcastStatus.SkippedPreflight,
      attempts:           0,
      preflightStatus:    preflight.status,
      signatureVerified:  sigVerified ?? undefined,
    };
  }

  // ── Step 2: Validate the vault PDA ───────────────────────────────────────
  const ownerPubkey = new PublicKey(event.ownerAddress);
  const vaultIndex  = BigInt(event.vaultIndex);
  const indexBytes  = Buffer.alloc(8);
  indexBytes.writeBigUInt64LE(vaultIndex);

  const [derivedVaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, ownerPubkey.toBuffer(), indexBytes],
    program.programId,
  );

  if (derivedVaultPda.toBase58() !== event.vaultAddress) {
    logger.error(
      {
        expectedVault: event.vaultAddress,
        derivedVault:  derivedVaultPda.toBase58(),
      },
      "CRITICAL: vault PDA mismatch — event data may be corrupted",
    );
    return {
      status:   BroadcastStatus.Failed,
      attempts: 0,
      error:    new Error("Vault PDA mismatch"),
    };
  }

  const vaultPubkey = new PublicKey(event.vaultAddress);

  // ── Step 3: Submit with retry ─────────────────────────────────────────────
  const result = await withRetry(
    () => submitTriggerTransaction(connection, program, relayerKeypair, vaultPubkey),
    {
      ...TRIGGER_RETRY_OPTIONS,
      maxAttempts: event.maxRetries,
      isRetryable: isSolanaTransientError,
    },
  );

  if (result.success) {
    logger.info(
      {
        vault:        event.vaultAddress,
        signature:    result.value,
        attempts:     result.attempts,
        totalDelayMs: result.totalDelayMs,
      },
      "trigger_inheritance confirmed on-chain",
    );
    return {
      status:            BroadcastStatus.Confirmed,
      signature:         result.value as TransactionSignature,
      attempts:          result.attempts,
      signatureVerified: sigVerified ?? undefined,
    };
  }

  logger.error(
    {
      vault:        event.vaultAddress,
      attempts:     result.attempts,
      totalDelayMs: result.totalDelayMs,
      error:        result.error,
    },
    "trigger_inheritance failed after all retries",
  );

  return {
    status:   BroadcastStatus.Failed,
    attempts: result.attempts,
    error:    result.error,
  };
}

// ── Transaction builder ───────────────────────────────────────────────────────

async function submitTriggerTransaction(
  connection:     Connection,
  program:        Program<LegacyVault>,
  relayerKeypair: Keypair,
  vaultPubkey:    PublicKey,
): Promise<TransactionSignature> {
  const signature = await program.methods
    .triggerInheritance()
    .accounts({
      caller: relayerKeypair.publicKey,
      vault:  vaultPubkey,
    })
    .signers([relayerKeypair])
    .rpc({ commitment: "confirmed" });

  return signature;
}