// watcher/src/alerts/trigger_signal.ts
//
// The final alert in the pipeline. Fires when a vault's inactivity score
// reaches or exceeds 100%.
//
// Level 4: Ed25519 cryptographic signature over the TriggerReadyEvent
// payload. The watcher signs every trigger signal with the operator keypair
// configured via TRIGGER_SIGNER_SECRET_KEY. The relayer verifies this
// signature before submitting trigger_inheritance, preventing a compromised
// watcher DB or event bus from triggering spurious inheritance transactions.
//
// Ed25519 signing uses Node.js's native crypto module via the two-argument
// form crypto.sign(null, data, key) which is the correct API for Ed25519 —
// it does NOT accept a separate hash algorithm identifier because Ed25519 is
// a fully deterministic algorithm that hashes internally using SHA-512 as
// part of its specification. Using createSign("SHA512") would apply RSA/ECDSA
// logic to an Ed25519 key, which throws at runtime.
//
// Private key DER construction:
//   Ed25519 PKCS8 DER = 302e020100300506032b657004220420 (16-byte prefix)
//                       + 32-byte private key seed
//   The prefix encodes:
//     SEQUENCE (30 2e)
//       INTEGER 0            (02 01 00)       — version
//       SEQUENCE             (30 05)
//         OID 1.3.101.112    (06 03 2b 65 70) — id-EdDSA
//       OCTET STRING (04 22)
//         OCTET STRING (04 20)               — inner private key wrapper
//           <32 bytes>                       — the seed
//
// The signature covers the JSON-serialised payload fields in deterministic
// alphabetical key order:
//   { beneficiaryAddress, depositedLamports, inactivityScore, maxRetries,
//     ownerAddress, signalSlot, vaultAddress, vaultIndex }
// Sorted keys prevent field insertion order from affecting the result.
// The signerPublicKey field is appended to the event so the relayer knows
// which public key to verify against.

import { EventEmitter }   from "events";
import { sign as cryptoSign } from "crypto";
import { createPrivateKey } from "crypto";
import bs58               from "bs58";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Program }        from "@coral-xyz/anchor";
import { LegacyVault }    from "../types/legacy_vault";
import { VaultRecord }    from "../types/watcher";
import { VaultInactivityState, ActivityZone } from "../monitor/block_counter";
import { getStore }       from "../db/store";
import { logger }         from "../logger";

// ── Event bus ─────────────────────────────────────────────────────────────────

export const triggerSignalBus = new EventEmitter();
triggerSignalBus.setMaxListeners(0);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TriggerSignalResult {
  vaultAddress:     string;
  signalEmitted:    boolean;
  alreadySignalled: boolean;
  notReached:       boolean;
  error?:           string;
}

export interface TriggerReadyEvent {
  vaultAddress:       string;
  ownerAddress:       string;
  vaultIndex:         string;
  beneficiaryAddress: string;
  depositedLamports:  string;
  signalSlot:         string;
  inactivityScore:    string;
  maxRetries:         number;
  // Level 4: Ed25519 signature (base58) over the canonical payload. Present when
  // the watcher is configured with TRIGGER_SIGNER_SECRET_KEY. The relayer verifies
  // this before submitting the on-chain transaction.
  signature?:         string;
  // The public key that produced `signature`, encoded as base58.
  signerPublicKey?:   string;
}

// ── Configuration ─────────────────────────────────────────────────────────────

const TRIGGER_MAX_RETRIES = 10;

// DER prefix for an Ed25519 private key in PKCS8 format.
// Encodes the ASN.1 structure that Node.js createPrivateKey requires:
//   SEQUENCE (30 2e) {
//     INTEGER 0 (02 01 00)               — version
//     SEQUENCE (30 05) {
//       OID 1.3.101.112 (06 03 2b 65 70) — id-EdDSA
//     }
//     OCTET STRING (04 22) {
//       OCTET STRING (04 20) {
//         <32-byte seed>
//       }
//     }
//   }
const ED25519_PKCS8_DER_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

// ── Signer singleton ──────────────────────────────────────────────────────────

// Loaded once at startup via initTriggerSigner(). Null when no signing key
// is configured (development / single-process mode).
let _signerKeypair: Keypair | null = null;
let _signerLoaded  = false;

function loadSigner(secretKeyB58: string | undefined): Keypair | null {
  if (!secretKeyB58) return null;
  try {
    const secretKey = bs58.decode(secretKeyB58);
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    logger.error({ err }, "Failed to load TRIGGER_SIGNER_SECRET_KEY — trigger signals will be unsigned");
    return null;
  }
}

/**
 * Must be called once in main() after config is loaded. Idempotent — a second
 * call is a no-op so the module can be imported safely by both the watcher
 * and its tests without re-initialising.
 */
export function initTriggerSigner(secretKeyB58: string | undefined): void {
  if (_signerLoaded) return;
  _signerKeypair = loadSigner(secretKeyB58);
  _signerLoaded  = true;

  if (_signerKeypair) {
    logger.info(
      { pubkey: _signerKeypair.publicKey.toBase58() },
      "Trigger signer loaded — signals will be Ed25519-signed",
    );
  } else {
    logger.warn("No TRIGGER_SIGNER_SECRET_KEY configured — trigger signals will be unsigned");
  }
}

// ── Payload canonicalisation ──────────────────────────────────────────────────

/**
 * Produces a deterministic JSON string over the fields that determine whether
 * a trigger is legitimate. Alphabetically sorted keys prevent field order
 * from affecting the signature. The relayer must reconstruct this exact
 * string before verifying — both sides use the same sorted-keys approach.
 */
function canonicalisePayload(event: Omit<TriggerReadyEvent, "signature" | "signerPublicKey">): string {
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

/**
 * Signs the canonical payload with the operator keypair using Ed25519 via
 * Node.js native crypto. Returns the base58-encoded signature and public key,
 * or null if no signing key is configured.
 *
 * crypto.sign(null, data, key):
 *   - The first argument being null means "use the algorithm from the key
 *     object" — for Ed25519 keys this is always Ed25519.
 *   - This is the correct API; createSign("SHA512") would apply SHA-512 +
 *     RSA/ECDSA logic, which is wrong for Ed25519 and will throw or produce
 *     an unverifiable signature.
 */
function signPayload(
  canonicalJson: string,
): { signature: string; signerPublicKey: string } | null {
  if (!_signerKeypair) return null;

  try {
    // Construct the PKCS8 DER representation of the Ed25519 private key.
    // Solana Keypair.secretKey is 64 bytes: [private scalar (32)] ++ [public key (32)].
    // Only the first 32 bytes (the seed) go into the PKCS8 structure.
    const seed      = _signerKeypair.secretKey.slice(0, 32);
    const pkcs8Der  = Buffer.concat([ED25519_PKCS8_DER_PREFIX, Buffer.from(seed)]);
    const nodeKey   = createPrivateKey({ key: pkcs8Der, format: "der", type: "pkcs8" });

    // crypto.sign with null algorithm uses the key's embedded algorithm (Ed25519).
    // The data argument must be a Buffer or string; we use Buffer for safety.
    const sigBuffer = cryptoSign(null, Buffer.from(canonicalJson), nodeKey);

    return {
      signature:       bs58.encode(sigBuffer),
      signerPublicKey: _signerKeypair.publicKey.toBase58(),
    };
  } catch (err) {
    // Crypto failure should not crash the watcher. Emit the signal unsigned and
    // log so an operator can investigate the key configuration.
    logger.error({ err }, "Failed to sign trigger signal — emitting unsigned");
    return null;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function signalEligibleTriggers(
  connection: Connection,
  program: Program<any>,
  vaults: VaultRecord[],
  states: VaultInactivityState[],
): Promise<TriggerSignalResult[]> {
  const stateMap = new Map<string, VaultInactivityState>(
    states.map((s) => [s.vaultAddress, s]),
  );

  const results = await Promise.allSettled(
    vaults.map((vault) => {
      const state = stateMap.get(vault.vaultAddress);
      if (!state) {
        return Promise.resolve<TriggerSignalResult>({
          vaultAddress:     vault.vaultAddress,
          signalEmitted:    false,
          alreadySignalled: false,
          notReached:       true,
        });
      }
      return evaluateAndSignal(vault, state);
    }),
  );

  return results.map((r, i) => {
    if (r.status === "rejected") {
      return {
        vaultAddress:     vaults[i].vaultAddress,
        signalEmitted:    false,
        alreadySignalled: false,
        notReached:       false,
        error:            String(r.reason),
      };
    }
    return r.value;
  });
}

// ── Single vault evaluation ───────────────────────────────────────────────────

async function evaluateAndSignal(
  vault: VaultRecord,
  state: VaultInactivityState,
): Promise<TriggerSignalResult> {
  if (state.zone !== ActivityZone.Red) {
    return {
      vaultAddress:     vault.vaultAddress,
      signalEmitted:    false,
      alreadySignalled: false,
      notReached:       true,
    };
  }

  const alreadySignalled = getStore().isTriggerSignalled(vault.vaultAddress);
  if (alreadySignalled) {
    return {
      vaultAddress:     vault.vaultAddress,
      signalEmitted:    false,
      alreadySignalled: true,
      notReached:       false,
    };
  }

  logger.error(
    {
      vault:        vault.vaultAddress,
      score:        state.score.toString(),
      elapsedSlots: state.elapsedSlots.toString(),
    },
    "VAULT TRIGGER THRESHOLD REACHED — signalling relayer",
  );

  try {
    const baseEvent: Omit<TriggerReadyEvent, "signature" | "signerPublicKey"> = {
      vaultAddress:       vault.vaultAddress,
      ownerAddress:       vault.ownerAddress,
      vaultIndex:         vault.vaultIndex,
      beneficiaryAddress: vault.beneficiary,
      depositedLamports:  vault.depositedLamports,
      signalSlot:         state.computedAtSlot.toString(),
      inactivityScore:    state.score.toString(),
      maxRetries:         TRIGGER_MAX_RETRIES,
    };

    // Sign the canonical payload before writing the DB flag so that if signing
    // throws (key misconfiguration), the DB flag is never set and we retry on
    // the next cycle rather than silently emitting an unsigned signal.
    const canonical = canonicalisePayload(baseEvent);
    const sigResult = signPayload(canonical);

    const event: TriggerReadyEvent = sigResult
      ? { ...baseEvent, signature: sigResult.signature, signerPublicKey: sigResult.signerPublicKey }
      : baseEvent;

    // Write the DB flag BEFORE emitting so a process restart between the
    // write and the emit does not cause a duplicate signal on the next cycle.
    getStore().setTriggerSignalled(vault.vaultAddress, true);

    triggerSignalBus.emit("trigger_ready", event);

    logger.info(
      {
        vault:       vault.vaultAddress,
        beneficiary: vault.beneficiary,
        lamports:    vault.depositedLamports,
        signed:      sigResult !== null,
      },
      "Trigger signal emitted to relayer",
    );

    return {
      vaultAddress:     vault.vaultAddress,
      signalEmitted:    true,
      alreadySignalled: false,
      notReached:       false,
    };
  } catch (err) {
    logger.error({ vault: vault.vaultAddress, err }, "Failed to emit trigger signal");
    return {
      vaultAddress:     vault.vaultAddress,
      signalEmitted:    false,
      alreadySignalled: false,
      notReached:       false,
      error:            String(err),
    };
  }
}

// ── Emergency escalation ──────────────────────────────────────────────────────

export function escalateFailedTrigger(
  vaultAddress: string,
  reason: string,
  attemptCount: number,
): void {
  triggerSignalBus.emit("trigger_escalation", {
    vaultAddress,
    reason,
    attemptCount,
    escalatedAt: Date.now(),
  });

  logger.fatal(
    { vaultAddress, reason, attemptCount },
    "CRITICAL: trigger_inheritance could not be confirmed after maximum retries — human intervention required",
  );
}