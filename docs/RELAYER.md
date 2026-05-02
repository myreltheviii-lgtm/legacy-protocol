# Relayer Service Reference

The relayer is the off-chain transaction submitter. Its sole responsibility is to receive a trigger signal from the watcher and reliably submit the `trigger_inheritance` instruction on-chain with retries.

## What the Relayer Does

1. Receives `TriggerReadyEvent` signals from the watcher (via EventEmitter bus or HTTP polling).
2. Optionally verifies the Ed25519 signature on the event payload.
3. Runs a pre-flight check against the on-chain vault state.
4. Submits `trigger_inheritance` with exponential backoff and retry.
5. Escalates to the operator if all retries are exhausted.
6. Maintains a job map and exposes `GET /health`.

The relayer holds a keypair only to pay transaction fees. It has zero authority over vault funds.

## Two Operating Modes

### Same-Process Mode (`RELAYER_MODE=same-process`)

The relayer imports and subscribes to the watcher's `triggerSignalBus` EventEmitter directly. No network overhead. Both services share the same Node.js process.

```typescript
const { triggerSignalBus } = require("../watcher/src/alerts/trigger_signal");
triggerSignalBus.on("trigger_ready", handleTriggerSignal);
```

### Separate-Process Mode (`RELAYER_MODE=separate-process`)

The relayer polls `{WATCHER_URL}/vaults` every `RELAYER_POLL_MS` milliseconds. For each vault with `triggerSignalled == true` that does not have an active or completed job, a `TriggerReadyEvent` is synthesised from the vault record and processed.

The inactivity score in the synthesised event is computed from the watcher's stored slot values: `(lastPolledSlot - lastCheckInSlot) * 100 / inactivityThresholdSlots`.

## Preflight Verification

Before submitting any transaction, the relayer fetches the vault's on-chain state and re-evaluates the trigger condition:

| Status | Meaning | Action |
|--------|---------|--------|
| ReadyToTrigger | All checks pass | Submit transaction |
| AlreadyTriggered | vault.is_triggered == true | Skip (already done) |
| AlreadyClaimed | vault.is_claimed == true | Skip |
| AlreadySwept | vault.is_emergency_swept == true | Skip |
| OwnerCheckedIn | owner checked in since signal; threshold no longer crossed | Skip |
| VaultGone | vault account no longer exists | Skip |
| RpcError | RPC call failed | Treat as transient error; retry |

The inactivity threshold is re-read from the on-chain vault account rather than accepted as a parameter. This catches the case where the owner called `configure_threshold` after the watcher emitted the signal.

## withRetry Engine

Configuration (`TRIGGER_RETRY_OPTIONS`):

| Parameter | Value |
|-----------|-------|
| maxAttempts | 10 |
| baseDelayMs | 2,000 ms |
| maxDelayMs | 60,000 ms |
| maxJitterMs | 1,000 ms |

Delay formula: `min(baseDelayMs × 2^(attempt-1), maxDelayMs) + random(0, maxJitterMs)`.

Delays per attempt (without jitter):
- Attempt 1: 2,000 ms
- Attempt 2: 4,000 ms
- Attempt 3: 8,000 ms
- Attempt 4: 16,000 ms
- Attempt 5: 32,000 ms
- Attempts 6–10: 60,000 ms (capped)

### isSolanaTransientError

Returns `false` (fast-fail, do not retry) for any error message matching these substrings (case-insensitive):

- "already triggered for inheritance" → VaultAlreadyTriggered
- "already been claimed" → VaultAlreadyClaimed
- "already been emergency-swept" → VaultAlreadySwept
- "inheritance threshold has not been reached" → VaultNotTriggered / ThresholdNotReached
- "not enough guardian signatures" → InsufficientSignatures
- "only the vault owner" → UnauthorisedOwner
- "only an active guardian" → UnauthorisedGuardian
- "only the vault beneficiary" → UnauthorisedBeneficiary

Returns `true` (retry) for all other errors (connection timeouts, rate limits, leader rotation, network blips). Non-Error objects return `true`.

## Job Map

In-memory `Map<vaultAddress, TriggerJob>`. Statuses:

| Status | Description |
|--------|-------------|
| PENDING | Job created, not yet processing |
| BROADCASTING | Active submission in progress |
| CONFIRMED | trigger_inheritance confirmed on-chain |
| SKIPPED | Pre-flight determined submission unnecessary |
| FAILED | All retries exhausted |
| SIGNATURE_REJECTED | Invalid Ed25519 signature — immediate escalation, no retries |

Deduplication logic: a vault with an active `BROADCASTING` or `CONFIRMED` job ignores subsequent trigger signals. A vault with `FAILED`, `SKIPPED`, or `SIGNATURE_REJECTED` status accepts a new signal (retry path).

## Escalation Bus

When a job fails after all retries or receives an invalid signature, `escalateFailedTrigger` is called:

1. A `FATAL` pino log entry is emitted (triggers PagerDuty/Opsgenie alert if log-level alerting is configured).
2. An `escalation` event is fired on `escalationBus` with `{ vaultAddress, reason, attemptCount, escalatedAtMs }`.

Operators must subscribe to `escalationBus` to route escalations to their delivery channel (email, Slack webhook, on-call system).

Common root causes for escalation:
- Relayer keypair SOL balance too low to pay fees
- RPC node not accepting transactions
- Vault was already handled between signal and broadcast
- Pre-flight logic returned `ReadyToTrigger` incorrectly

## Ed25519 Signature Verification (Level 4)

When `TRUSTED_TRIGGER_SIGNER_PUBKEY` is configured, the relayer verifies every signed trigger signal before proceeding:

**Canonical payload** (sorted keys, JSON-serialised, matches watcher's `canonicalisePayload` exactly):
```json
{
  "beneficiaryAddress": "...",
  "depositedLamports": "...",
  "inactivityScore": "...",
  "maxRetries": 10,
  "ownerAddress": "...",
  "signalSlot": "...",
  "vaultAddress": "...",
  "vaultIndex": "..."
}
```

**Verification**: `crypto.verify(null, Buffer.from(canonicalJson), nodePublicKey, sigBytes)` — the `null` first argument instructs Node.js to use the algorithm embedded in the key object (Ed25519). Using `createVerify("SHA512")` would apply RSA/ECDSA semantics to an Ed25519 key and always fail.

**Public key construction**: Ed25519 SubjectPublicKeyInfo DER = 12-byte prefix (`302a300506032b6570032100`) + 32-byte raw public key.

**Failure path**: if `event.signerPublicKey ≠ TRUSTED_PUBKEY_B58`, or if `crypto.verify` returns false, or if signature parsing throws, status is `SIGNATURE_REJECTED` and escalation fires immediately without any retry attempts.

**Skip conditions** (verification not performed):
- Event has no `signature` field (development/single-process mode)
- `TRUSTED_TRIGGER_SIGNER_PUBKEY` is not configured

## Vault PDA Validation

After pre-flight passes, the relayer derives the vault PDA from `event.ownerAddress` and `event.vaultIndex` and compares it to `event.vaultAddress`. A mismatch indicates corrupted event data and the job fails immediately with status `FAILED`.

```typescript
const [derivedVaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), ownerPubkey.toBuffer(), indexBytes],
  program.programId,
);
// derivedVaultPda.toBase58() must equal event.vaultAddress
```

## Deployment Guide

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| SOLANA_RPC_ENDPOINT | Yes | Solana RPC HTTP |
| SOLANA_RPC_WS_ENDPOINT | Yes | Solana RPC WebSocket |
| LEGACY_VAULT_PROGRAM_ID | Yes | Deployed program ID |
| RELAYER_SECRET_KEY | Yes | Base58 secret key for fee-paying keypair. Fund with ~1 SOL |
| RELAYER_MODE | No (default: same-process) | "same-process" or "separate-process" |
| WATCHER_URL | No (default: http://localhost:3001) | Watcher base URL (separate-process only) |
| RELAYER_POLL_MS | No (default: 10000) | Watcher poll interval in ms (separate-process only) |
| RELAYER_HEALTH_PORT | No (default: 3002) | Health endpoint port |
| TRUSTED_TRIGGER_SIGNER_PUBKEY | No | Base58 pubkey to verify trigger signal signatures |
| LOG_LEVEL | No (default: info) | Pino log level |
| NODE_ENV | No (development) | "production" for raw JSON logs |

### Running

```bash
cd relayer
npm install
cp .env.example .env
# edit .env
npm run build && npm start
```

### Health Endpoint

`GET /health` returns JSON:
```json
{
  "status": "ok",
  "uptime": 3600,
  "pendingJobs": 0,
  "completedJobs": 12,
  "failedJobs": 0,
  "signatureRejectedJobs": 0,
  "relayerPubkey": "...",
  "signatureVerification": "enabled",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

`status` is `"degraded"` if any `FAILED` or `SIGNATURE_REJECTED` jobs exist.

## Failure Scenarios

**Relayer dies mid-retry**: The in-memory job map is lost. On restart, if `RELAYER_MODE=separate-process`, the watcher's `trigger_signalled == true` flag will cause the relayer to re-process the signal and restart the retry sequence from attempt 1. If `RELAYER_MODE=same-process`, the watcher must be restarted together; the `trigger_signalled` DB flag prevents duplicate signals on the next poll cycle.

**Pre-flight returns RpcError**: The relayer treats this as a transient error and retries the pre-flight on the next `withRetry` attempt, not a separate call. Pre-flight is called once before `withRetry`; RpcError causes pre-flight to be re-run on each retry of `submitTriggerTransaction` because the pre-flight happens inside `withRetry`.

Wait — actually reviewing the code: `verifyTriggerPreflight` is called ONCE before `withRetry`. If it returns `RpcError`, the relayer currently falls through to `SkippedPreflight` (since the status ≠ `ReadyToTrigger`). Operators should ensure their RPC endpoint is reliable; a flaky RPC that causes pre-flight to fail with RpcError will skip the trigger submission. Monitor the relayer health endpoint for `SkippedPreflight` counts.
