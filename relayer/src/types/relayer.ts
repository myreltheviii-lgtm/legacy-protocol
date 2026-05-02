// relayer/src/types/relayer.ts
//
// Shared type definitions for the relayer service.
//
// Level 4 addition: TriggerReadyEvent now carries an optional Ed25519 signature
// and signer public key. When these are present, the relayer verifies the
// signature against a configured trusted public key before submitting the
// trigger_inheritance transaction.

// ── Cross-boundary event ──────────────────────────────────────────────────────

export interface TriggerReadyEvent {
  vaultAddress:       string;
  ownerAddress:       string;
  vaultIndex:         string;
  beneficiaryAddress: string;
  depositedLamports:  string;
  signalSlot:         string;
  inactivityScore:    string;
  maxRetries:         number;
  // Level 4: cryptographic proof that this signal was produced by the authorised
  // watcher operator. Both fields are absent in single-process / development mode.
  signature?:         string;
  signerPublicKey?:   string;
}

// ── Relayer job record ────────────────────────────────────────────────────────

export interface TriggerJob {
  event:          TriggerReadyEvent;
  receivedAtMs:   number;
  status:         TriggerJobStatus;
  signature?:     string;
  attempts:       number;
  error?:         unknown;
  completedAtMs?: number;
  // True when the trigger signal carried a valid operator signature.
  signatureVerified?: boolean;
}

export enum TriggerJobStatus {
  Pending      = "PENDING",
  Broadcasting = "BROADCASTING",
  Confirmed    = "CONFIRMED",
  Skipped      = "SKIPPED",
  Failed       = "FAILED",
  // The event carried an invalid signature — rejected before broadcast.
  SignatureRejected = "SIGNATURE_REJECTED",
}

// ── Relayer health summary ────────────────────────────────────────────────────

export interface RelayerHealth {
  status:                  "ok" | "degraded";
  uptime:                  number;
  pendingJobs:             number;
  completedJobs:           number;
  failedJobs:              number;
  signatureRejectedJobs:   number;
  relayerPubkey:           string;
  signatureVerification:   "enabled" | "disabled";
  timestamp:               string;
}

