# Legacy Protocol

A **Solana on-chain inheritance protocol** with complete privacy via [Cloak SDK](https://cloak.dev/) integration and AI-powered risk analysis via [QVAC](https://qvac.sh/). Set an inactivity threshold — if you stop checking in, your designated beneficiary can claim your vault through a multi-guardian approval process with zero public trace.

**Live Program IDs (Mainnet)**
- Legacy Vault: `4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd`
- Cloak Shielded Pool: `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`

---

## Table of Contents

- [Quick Overview](#quick-overview)
- [Architecture Overview](#architecture-overview)
- [System Components](#system-components)
  - [1. Cloak Integration — Private Inheritance](#1-cloak-integration--private-inheritance)
  - [2. Watcher Service — Inactivity Monitoring](#2-watcher-service--inactivity-monitoring)
  - [3. QVAC Service — AI Risk Analysis](#3-qvac-service--ai-risk-analysis)
  - [4. Relayer Service — Permissionless Trigger](#4-relayer-service--permissionless-trigger)
- [Core Features](#core-features)
- [Protocol Instructions](#protocol-instructions)
- [Getting Started](#getting-started)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [License](#license)

---

## Quick Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Legacy Protocol — Complete Inheritance Workflow                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ STEP 1: Vault Owner Creates Vault                                          │
│   └─ Sets beneficiary UTXO pubkey, threshold, and guardians on-chain       │
│                                                                             │
│ STEP 2: Owner Shields Assets via Cloak                                     │
│   └─ Deposits SOL into Cloak shielded pool (zero public trace)            │
│   └─ Records commitment on-chain (proof only, no funds move)              │
│                                                                             │
│ STEP 3: Owner Distributes Guardian Shares via Shamir                       │
│   └─ Splits owner's UTXO private key into M-of-N shares                   │
│   └─ Guardians store shares securely (distributed custody model)           │
│                                                                             │
│ STEP 4: Watcher Monitors Inactivity (Geyser + SQLite)                     │
│   └─ Subscribes to on-chain vault updates via Yellowstone Geyser          │
│   └─ Tracks slots since last check-in, computes inactivity score         │
│   └─ Fires progressive alerts: 75% → 90% → 100% (trigger signal)        │
│                                                                             │
│ STEP 5: QVAC Analyzes Risk (LLM + Embeddings)                             │
│   └─ Guardian app queries QVAC sidecar for risk assessment                │
│   └─ LLM analyzes behavioral context (silence, historical patterns)       │
│   └─ Returns risk level: LOW / MEDIUM / HIGH / CRITICAL                  │
│   └─ Guardians make informed decision before signing                      │
│                                                                             │
│ STEP 6: Guardians Sign Covenant (Multi-Sig Approval)                      │
│   └─ M-of-N guardians review risk brief and sign approval covenant       │
│   └─ Covenant subject to timelock (beneficiary change: 30 days)           │
│   └─ Covenant signature state persisted on-chain                           │
│                                                                             │
│ STEP 7: Relayer Submits trigger_inheritance (Permissionless)               │
│   └─ Receives trigger_ready signal from watcher                           │
│   └─ Runs pre-flight check: vault still past threshold?                   │
│   └─ Verifies Ed25519 signature (if configured)                           │
│   └─ Submits with exponential backoff + retry (10 attempts)              │
│   └─ Escalates to operator if all retries exhausted                       │
│                                                                             │
│ STEP 8: Guardians Execute Shielded Transfer (Cloak)                        │
│   └─ M-of-N guardians reconstruct owner's UTXO private key client-side   │
│   └─ Execute shielded Cloak transfer with externalAmount: 0n             │
│   └─ Zero trace on blockchain (Groth16 proof only)                       │
│                                                                             │
│ STEP 9: Beneficiary Claims to Real Wallet                                 │
│   └─ Uses offline private key to unlock shielded UTXOs                    │
│   └─ Withdraws to any real Solana wallet                                  │
│   └─ Optionally exports compliance proof (JSON, no amounts revealed)      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Legacy Protocol — Multi-Layer System Architecture              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  programs/legacy_vault/    — Anchor program (Rust)             │
│  sdk/                      — TypeScript SDK                    │
│  cloak-integration/        — Cloak SDK wrapper (TypeScript)   │
│  watcher/                  — Inactivity monitor (Geyser)      │
│  relayer/                  — Trigger submission (Solana RPC)  │
│  qvac-sidecar/             — LLM risk analyzer (Node.js)      │
│  app/                      — Owner dashboard (Next.js)         │
│  guardian-app/             — Guardian approval (Tauri + QVAC) │
│  signing-service/          — Key reconstruction               │
│  crates/shamir/            — GF(256) Shamir sharing (Rust)    │
│  tests/                    — Comprehensive test suite          │
│  docs/                     — Architecture & deployment guides  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Language Composition:**
- **TypeScript**: 89.6% (SDK, frontend, integration layers, watcher, relayer)
- **Rust**: 7.9% (Anchor program, Shamir implementation)
- **JavaScript**: 1.2% (Configuration)
- **Kotlin**: 0.7% (Mobile tooling)
- **CSS**: 0.6% (Styling)

---

## System Components

### 1. Cloak Integration — Private Inheritance

Legacy Protocol embeds Cloak SDK to eliminate every public trace from the inheritance lifecycle. Without Cloak, vault balance, beneficiary wallet, and inheritance transfers are visible on-chain. With Cloak, they are completely hidden.

#### Comparison: Without vs. With Cloak

| Layer | Without Cloak | With Cloak |
|-------|--------------|------------|
| **Vault balance** | Public on-chain | Hidden (Merkle tree only) |
| **Beneficiary wallet** | Visible as `beneficiary: Pubkey` | Off-chain UTXO public key only |
| **Transfer amount** | Public in transaction logs | Zero public trace (Groth16 proof) |
| **Beneficiary identity** | Block-explorer visible | Known only to key holder |
| **Compliance proof** | None | Cryptographic, selective disclosure |

#### The Five-Layer Shielded Inheritance Workflow

**1. Vault Owner Shields Assets**

```typescript
import { depositToShieldedVault } from "@legacy-protocol/cloak-integration";
import { buildRecordCloakDepositIx } from "@legacy-protocol/sdk";

// Generate a UTXO keypair for the vault
const ownerUtxo = await generateUtxoKeypair();
const connection = new Connection(clusterApiUrl("mainnet-beta"));

// Deposit SOL into Cloak off-chain
const { commitment, leafIndex } = await depositToShieldedVault({
  ownerUtxo,
  ownerSigner,
  amountLamports: 1_000_000_000n, // 1 SOL
  connection,
});

// Record the commitment on-chain (only proof, no funds move)
await submitTx(buildRecordCloakDepositIx({
  commitment,
  leafIndex,
  shieldedLamports: 1_000_000_000n,
  // ... other params
}));

// Immediately zero the owner private key
ownerUtxo.privateKey.fill(0);
```

**2. Beneficiary Generates Private Identity**

```typescript
import { generateBeneficiaryIdentity } from "@legacy-protocol/cloak-integration";

const beneficiary = await generateBeneficiaryIdentity();
// beneficiary.publicKey      → stored on-chain as vault.beneficiary_utxo_pubkey
// beneficiary.privateKey     → kept offline by beneficiary
// beneficiary.viewingKeyNk   → used to scan for incoming shielded transfers
```

**3. Owner Splits Key into Guardian Shares**

```typescript
import { splitOwnerKey } from "@legacy-protocol/cloak-integration";

const shares = splitOwnerKey(
  ownerUtxoPrivateKey,        // 32-byte secret
  3,                          // M = 3 guardians needed
  4,                          // N = 4 total guardians
  guardianWallets
);

// Distribute shares securely (encrypted QR codes, email, etc.)
// Then zero the private key immediately
ownerUtxoPrivateKey.fill(0);
```

**4. Guardians Execute Shielded Transfer (No Public Trace)**

```typescript
import { reconstructAndTransfer } from "@legacy-protocol/cloak-integration";

// M-of-N guardians reconstruct owner's UTXO private key
const reconstructedKeypair = reconstructShares([share1, share2, share3]);

// Execute the shielded transfer
const cloakTransferSig = await reconstructAndTransfer({
  guardianShares: [share1, share2, share3],
  beneficiaryUtxoPubkey,
  vaultUtxos,
  totalAmount: 1_000_000_000n,
  connection,
});
// externalAmount: 0n — zero public trace, fully shielded

// Immediately zero the reconstructed key
reconstructedKeypair.privateKey.fill(0);
```

**5. Beneficiary Claims to Real Wallet**

```typescript
import { claimInheritanceToWallet } from "@legacy-protocol/cloak-integration";

// Beneficiary uses offline private key to claim
await claimInheritanceToWallet({
  beneficiaryUtxoPrivateKey: beneficiary.privateKey,
  beneficiaryRealWallet: Keypair.generate(),
  connection,
});

// Generate compliance proof without revealing amounts
const proof = await generateComplianceProof({
  beneficiaryUtxoPrivateKey: beneficiary.privateKey,
  connection,
});
```

---

### 2. Watcher Service — Inactivity Monitoring

The watcher is the **off-chain monitoring service** that observes all vault states on-chain, computes inactivity scores, and drives the progressive alert pipeline. Without the watcher, no automatic notifications fire — but vaults can still be triggered manually by anyone.

#### What the Watcher Does

1. **Subscribes to Geyser gRPC stream** for real-time vault account updates
2. **Maintains SQLite database** of all monitored vaults and their current states
3. **Computes inactivity scores** on every heartbeat (adaptive: 2-10 seconds)
4. **Runs alert pipeline**: reconcile → score → anomaly → ping → warn → trigger
5. **Emits internal events** on three buses (guardian, beneficiary, relayer)
6. **Exposes HTTP endpoints** for health, vault list, and Prometheus metrics

#### Inactivity Score & Activity Zones

The watcher computes a vault's inactivity progress as a percentage (0-100+):

```
Score = (elapsed_slots / inactivity_threshold_slots) × 100
```

**Activity Zones:**
- **Green (0-74%)** — Owner is active, no alerts
- **Yellow (75-89%)** — Owner approaching threshold, guardians pinged (off-chain)
- **Orange (90-99%)** — Owner critically silent, beneficiary warned
- **Red (100%+)** — Threshold crossed, trigger signal sent to relayer

#### Alert Pipeline

```typescript
Guardian Alert (75%)
  ├─ Event: guardianAlertBus.emit("guardian_ping", GuardianPingEvent)
  ├─ Payload: vault, owner, elapsedSlots, estimatedSecondsToTrigger
  └─ Delivery: SMS, email, push notifications (integration layer)

Beneficiary Warning (90%)
  ├─ Event: beneficiaryAlertBus.emit("beneficiary_warn", BeneficiaryWarnEvent)
  ├─ Payload: vault, beneficiary, inactivityScorePct, claimBlinkUrl
  └─ Delivery: Blink notification, in-app alert

Trigger Signal (100%+)
  ├─ Event: relayerAlertBus.emit("trigger_ready", TriggerReadyEvent)
  ├─ Payload: vault, owner, inactivityScore, signature (if Ed25519 enabled)
  └─ Delivery: Relayer picks up and submits trigger_inheritance
```

#### Geyser gRPC Stream Architecture

The watcher uses **Yellowstone Geyser** for real-time block-chain updates:

```
Geyser gRPC Server (Triton infrastructure)
  │
  ├─ onAccountUpdate(vault_address)
  │   └─ Fired when vault account data changes (check-in, covenant signature)
  │
  ├─ onSlot(slot_number)
  │   └─ Fired every ~400ms, triggers adaptive heartbeat
  │
  └─ onSnapshotComplete(pubkeys_in_snapshot)
      └─ Fired once on connect, idempotent snapshot consistency

Watcher processes updates:
  1. Parse account data (vault_parser.ts)
  2. Store in SQLite (store.ts)
  3. Compute inactivity state (block_counter.ts)
  4. Run alert pipeline (alerts/*.ts)
  5. Emit events on buses (EventEmitter)
```

#### Configuration

```bash
# .env for watcher
GEYSER_ENDPOINT=http://yellowstone-grpc.triton-one.com:8090
GEYSER_TOKEN=your-api-token

SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
CLUSTER=mainnet-beta

WATCHER_HTTP_PORT=3001
WATCHER_HTTP_HOST=0.0.0.0

# Database
DB_PATH=./watcher.db
DB_RETENTION_DAYS=30

# QVAC integration
QVAC_ENABLED=true
QVAC_MODEL_CACHE_DIR=./.qvac/models
```

#### HTTP Endpoints

**GET /health**
```json
{
  "status": "ok",
  "uptime": 3600.5,
  "currentSlot": "287654321",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

**GET /vaults**
```json
[
  {
    "vaultAddress": "...",
    "owner": "...",
    "lastCheckInSlot": "287600000",
    "inactivityThresholdSlots": "5000000",
    "depositedLamports": "1000000000",
    "isTriggered": false,
    "triggerSignalled": false,
    "warning75Sent": false,
    "warning90Sent": false
  }
]
```

**GET /metrics** — Prometheus text format
```
# HELP watcher_geyser_reconnects_total Total Geyser reconnects
# TYPE watcher_geyser_reconnects_total counter
watcher_geyser_reconnects_total 5

# HELP watcher_vaults_monitored Current vaults being monitored
# TYPE watcher_vaults_monitored gauge
watcher_vaults_monitored 1234

# HELP watcher_zone_distribution Distribution of vaults by activity zone
# TYPE watcher_zone_distribution gauge
watcher_zone_distribution{zone="green"} 980
watcher_zone_distribution{zone="yellow"} 180
watcher_zone_distribution{zone="orange"} 60
watcher_zone_distribution{zone="red"} 14
```

---

### 3. QVAC Service — AI Risk Analysis

**QVAC** (Quantum-Safe Vector Analysis Center) is an AI risk analysis engine that generates human-readable risk briefs for guardians. It integrates **LLMs** and **vector embeddings** to analyze vault behavior and flag unusual patterns.

#### What QVAC Does

1. **Analyzes behavioral context** — owner silence duration, historical patterns, guardian status
2. **Runs vector similarity search** — matches current vault behavior against previously-triggered vaults
3. **Generates LLM risk brief** — produces structured, actionable risk assessment
4. **Runs entirely on CPU** — no GPU required, works on edge infrastructure
5. **Protects cryptographic data** — behavioral metadata only, never touches private keys or UTXO commitments

#### QVAC Deployment Modes

**Mode 1: Watcher-Native (Recommended for Server Deployment)**

```typescript
// watcher/src/index.ts
import { initQVACAnomalyEngine, closeQVACAnomalyEngine } from "./monitor/qvac_anomaly";
import { initQVACRagStore, closeQVACRagStore } from "./monitor/qvac_rag";

// Main watcher startup
await initQVACAnomalyEngine(); // Load Llama 3.2 1B (Q4_0 quantized)
await initQVACRagStore();      // Load GTE-Large embedder + SQLite

// Alert pipeline
async function runAlertPipeline(vault: VaultRecord, state: VaultInactivityState) {
  const vaultBehavior = constructVaultBehavior(vault, state);
  
  // Ingest vault behavior into RAG store
  await ingestVaultBehavior(vaultBehavior);
  
  // Query similar previously-triggered vaults
  const similarCount = await querySimilarTriggered(vaultBehavior);
  
  // Run LLM anomaly analysis
  const anomalyDecision = await runLLMAnomalyDetection(vaultBehavior);
  
  if (anomalyDecision.flagged) {
    guardianAlertBus.emit("anomaly_flagged", {
      vault: vault.vaultAddress,
      reason: anomalyDecision.reason,
    });
  }
}

// Shutdown
await closeQVACAnomalyEngine();
await closeQVACRagStore();
```

**Mode 2: HTTP Sidecar (Recommended for Desktop/Guardian App)**

```typescript
// guardian-app/src/lib/qvac_guardian.ts
import { generateRiskBrief } from "@legacy-protocol/guardian-sdk";

// Guardian app queries the sidecar at 127.0.0.1:7648
const riskBrief = await generateRiskBrief({
  ownerAlias: "Alice",
  silenceDays: 45,
  historicalAvgDays: 30,
  guardiansRequired: 3,
  guardiansSignedSoFar: 1,
  vaultShielded: true,
  anomalyFlagged: false,
  covenantExpiresInDays: 20,
  similarTriggeredCount: 3,
});

// Returns
{
  summary: "Alice has been silent for 45 days, 50% above her typical 30-day average...",
  riskLevel: "HIGH",
  recommendation: "Verify you have contacted Alice through all channels...",
  irreversibleWarning: "Signing this covenant is irreversible..."
}
```

**Sidecar Service** (`qvac-sidecar/index.js`)
```javascript
// HTTP server on 127.0.0.1:7648
import { loadModel, completion } from "@qvac/sdk";
import { LLAMA_3_2_1B_INST_Q4_0, GTE_LARGE_FP16 } from "@qvac/sdk";

// GET /health
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// POST /analyze
app.post("/analyze", async (req, res) => {
  const context = req.body; // GuardianVaultContext
  
  // Load LLM model (once per request, minimal overhead)
  const modelId = await loadModel({
    modelSrc: LLAMA_3_2_1B_INST_Q4_0,
    modelConfig: { ctx_size: 2048, device: "cpu", gpuLayers: 0 },
  });
  
  // Build prompt from behavioral context
  const prompt = buildPrompt(context);
  
  // Run inference
  const result = await completion({
    modelId,
    history: [{ role: "user", content: prompt }],
    generationParams: { temp: 0.15, predict: 300 },
  });
  
  // Parse structured response
  const brief = parseRiskBrief(result.raw.fullText);
  
  res.json(brief);
});
```

#### QVAC Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ Guardian Opens Risk Brief Screen                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Guardian App (guardian-app)                           │
│   │                                                    │
│   └─ Constructs GuardianVaultContext:                 │
│       {                                                │
│         ownerAlias: "Alice",                           │
│         silenceDays: 45,                               │
│         historicalAvgDays: 30,                         │
│         similarTriggeredCount: 3,                      │
│         vaultShielded: true,                           │
│         anomalyFlagged: false,                         │
│         ...                                            │
│       }                                                │
│                                                         │
│   └─ POST http://127.0.0.1:7648/analyze               │
│        │                                               │
│        ▼                                               │
│   QVAC Sidecar (qvac-sidecar)                          │
│   │                                                    │
│   ├─ Load LLM model: Llama 3.2 1B Q4_0                │
│   │   (quantized, CPU-only, ~700MB)                   │
│   │                                                    │
│   ├─ Build prompt:                                    │
│   │   "Alice has been silent for 45 days, 50% above   │
│   │    her historical 30-day average. 3 similar       │
│   │    vaults have previously triggered..."           │
│   │                                                    │
│   ├─ Run LLM inference:                               │
│   │   temp: 0.15 (deterministic),                     │
│   │   max_tokens: 300                                 │
│   │                                                    │
│   └─ Parse JSON response:                             │
│       {                                                │
│         summary: "Alice...",                           │
│         riskLevel: "HIGH",                             │
│         recommendation: "Verify contact...",           │
│         irreversibleWarning: "Signing is..."           │
│       }                                                │
│        │                                               │
│        ▼                                               │
│   Return to Guardian App                              │
│        │                                               │
│        ▼                                               │
│   Display Risk Brief + Recommendation                 │
│        │                                               │
│        ▼                                               │
│   Guardian Decision (Sign / Reject)                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### QVAC Configuration

```json
// watcher/qvac.config.json
{
  "cacheDir": "/path/to/.qvac/models"
}
```

```bash
# qvac-sidecar/.env
QVAC_PORT=7648
QVAC_HOST=127.0.0.1
QVAC_MODEL_CACHE=/path/to/.qvac/models
```

#### Security: Data Boundaries

QVAC **never touches**:
- ❌ Private keys (owner's UTXO key, beneficiary's UTXO key)
- ❌ Viewing keys (used to scan shielded pool)
- ❌ UTXO commitments (Merkle tree proofs)
- ❌ Any Cloak-specific cryptographic material

QVAC **only sees**:
- ✓ Owner alias (user-provided label, not a public key)
- ✓ Silence duration in days
- ✓ Historical average check-in interval
- ✓ Guardian count and signature progress
- ✓ Vault shielding status (boolean)
- ✓ Anomaly flag status (boolean)
- ✓ Covenant expiry countdown
- ✓ Similar vault count from embeddings

---

### 4. Relayer Service — Permissionless Trigger

The relayer is the **off-chain transaction submitter** that receives trigger signals from the watcher and reliably submits the `trigger_inheritance` instruction on-chain with retries and validation.

#### What the Relayer Does

1. **Receives trigger signals** from watcher (HTTP polling or EventEmitter bus)
2. **Verifies Ed25519 signature** (optional, if `TRUSTED_TRIGGER_SIGNER_PUBKEY` configured)
3. **Runs pre-flight checks** — vault still past threshold? Already triggered?
4. **Submits `trigger_inheritance`** with exponential backoff + retry (10 attempts max)
5. **Escalates to operator** if all retries exhausted (via webhook or email)
6. **Maintains job map** — tracks status of each trigger attempt
7. **Exposes HTTP endpoints** for health and job status

#### Two Operating Modes

**Mode 1: Watcher Integrated (In-Process)**

```typescript
// watcher/src/index.ts — relayer runs as embedded event handler
import { BroadcastResult, broadcastTrigger } from "../relayer/broadcast";

relayerAlertBus.on("trigger_ready", async (event: TriggerReadyEvent) => {
  const result = await broadcastTrigger(connection, program, relayerKeypair, event);
  
  if (result.status === "CONFIRMED") {
    logger.info({ vault: event.vaultAddress, sig: result.signature }, "✓ Triggered");
  } else if (result.status === "FAILED") {
    logger.error({ vault: event.vaultAddress, error: result.error }, "✗ Failed");
    await escalateFailedTrigger(event, result.error);
  }
});
```

**Mode 2: Separate Service (Recommended for Production)**

```typescript
// relayer/src/index.ts — standalone HTTP server
import http from "http";
import { broadcastTrigger } from "./broadcast";

// Poll watcher every 2 seconds
async function pollWatcher() {
  const res = await fetch(`${WATCHER_URL}/vaults`);
  const vaults = await res.json();
  
  for (const vault of vaults) {
    if (!vault.triggerSignalled) continue;
    
    const event: TriggerReadyEvent = {
      vaultAddress: vault.vaultAddress,
      ownerAddress: vault.owner,
      beneficiaryAddress: vault.beneficiary,
      guardianAddresses: vault.guardians,
      inactivityScore: vault.inactivityScore,
      depositedLamports: vault.deposited_lamports,
      maxRetries: 10,
      signature: undefined,
      signerPublicKey: undefined,
    };
    
    const job = await broadcastTrigger(connection, program, relayerKeypair, event);
    jobMap.set(vault.vaultAddress, job);
  }
}

setInterval(pollWatcher, 2_000);

// GET /health
http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
  }
});
```

#### Pre-Flight Verification

Before submitting `trigger_inheritance`, the relayer re-reads the vault on-chain and re-runs the threshold calculation:

```typescript
import { verifyTriggerPreflight, PreflightStatus } from "./verify_threshold";

async function broadcastTrigger(
  connection: Connection,
  program: Program<any>,
  relayerKeypair: Keypair,
  event: TriggerReadyEvent,
): Promise<BroadcastResult> {
  // Step 1: Signature verification (optional)
  const sigVerified = verifyEventSignature(event);
  if (sigVerified === false) {
    return { status: "SIGNATURE_REJECTED", error: new Error("Invalid signature") };
  }

  // Step 2: Pre-flight check
  const preflight = await verifyTriggerPreflight(
    connection,
    program,
    event.vaultAddress,
    event.ownerAddress,
    event.vaultIndex,
  );

  switch (preflight.status) {
    case PreflightStatus.ReadyToTrigger:
      // Continue to submission
      break;
    case PreflightStatus.OwnerCheckedIn:
      return { status: "SKIPPED", reason: "Owner checked in since signal" };
    case PreflightStatus.AlreadyTriggered:
      return { status: "SKIPPED", reason: "Already triggered" };
    case PreflightStatus.VaultGone:
      return { status: "SKIPPED", reason: "Vault closed by owner" };
    default:
      return { status: "SKIPPED", reason: preflight.status };
  }

  // Step 3: Vault PDA validation
  const [expectedVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_seed"), ...Buffer.from(event.ownerAddress, "base58")...],
    LEGACY_VAULT_PROGRAM_ID,
  );
  if (expectedVault.toString() !== event.vaultAddress) {
    return { status: "FAILED", error: new Error("Vault PDA mismatch") };
  }

  // Step 4: Submit with retry
  const result = await withRetry(
    () => submitTriggerTransaction(connection, program, relayerKeypair, vaultAddress),
    { maxAttempts: 10, baseDelayMs: 2_000, maxDelayMs: 60_000 },
  );

  return {
    status: result.success ? "CONFIRMED" : "FAILED",
    signature: result.value,
    attempts: result.attempts,
    error: result.error,
  };
}
```

#### withRetry Engine

Exponential backoff with jitter:

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<RetryResult<T>> {
  let attempt = 1;
  let totalDelayMs = 0;

  while (attempt <= options.maxAttempts) {
    try {
      const value = await fn();
      return { success: true, value, attempts: attempt, totalDelayMs };
    } catch (error) {
      if (attempt === options.maxAttempts) {
        return { success: false, error, attempts: attempt, totalDelayMs };
      }

      const backoff = options.baseDelayMs * (2 ** (attempt - 1));
      const jitter = Math.random() * options.maxJitterMs;
      const delayMs = Math.min(backoff + jitter, options.maxDelayMs);

      totalDelayMs += delayMs;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}
```

#### Ed25519 Signature Verification (Level 4)

The relayer can optionally verify that the trigger signal came from a trusted signer:

```typescript
import crypto from "crypto";

export function verifyEventSignature(event: TriggerReadyEvent): boolean | null {
  if (!event.signature || !event.signerPublicKey) {
    return null; // No signature provided — skip verification
  }

  const TRUSTED_SIGNER = Buffer.from(
    process.env.TRUSTED_TRIGGER_SIGNER_PUBKEY || "",
    "base58",
  );

  // Construct Ed25519 SubjectPublicKeyInfo DER
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const spkiDer = Buffer.concat([prefix, TRUSTED_SIGNER]);

  // Create KeyObject from SPKI DER
  const keyObj = crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });

  // Serialize the payload (vault + inactivity_score + timestamp)
  const payload = Buffer.concat([
    Buffer.from(event.vaultAddress, "base58"),
    Buffer.from(event.inactivityScore.toString()),
    Buffer.from(event.timestamp || Date.now().toString()),
  ]);

  // Verify signature (algorithm: null for Ed25519)
  try {
    return crypto.verify(null, payload, keyObj, event.signature);
  } catch (err) {
    logger.error({ err }, "Signature verification error");
    return false;
  }
}
```

#### Configuration

```bash
# .env for relayer
RELAYER_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
RELAYER_KEYPAIR=~/.config/solana/relayer-key.json

WATCHER_URL=http://localhost:3001
WATCHER_POLL_INTERVAL_MS=2000

RELAYER_HTTP_PORT=3002

# Optional: Ed25519 signature verification
TRUSTED_TRIGGER_SIGNER_PUBKEY=GeyserH...base58...
```

#### Failure Scenarios & Escalation

| Scenario | Relayer Response | Escalation |
|----------|------------------|------------|
| Network timeout (transient) | Retry with backoff | N/A |
| Insufficient SOL for fees | Retry indefinitely | Alert operator after 30 min |
| Owner checked in during signal → relayer transmission | Skip (pre-flight) | N/A |
| Vault already triggered | Skip (pre-flight) | N/A |
| Ed25519 signature invalid | Reject immediately | Alert operator (security) |
| All retries exhausted | Fail (10 attempts) | Webhook + email to operator |

---

## Core Features

### Vault Lifecycle

| Phase | Actor | Action |
|-------|-------|--------|
| **Create** | Owner | Sets beneficiary UTXO pubkey, inactivity threshold, initial guardians |
| **Shield** | Owner | Deposits SOL into Cloak (`transact()`), records commitment on-chain |
| **Check-in** | Owner | Periodically resets inactivity clock, updates statistical model |
| **Monitor** | Watcher | Observes inactivity, fires progressive alerts (75%, 90%, 100%) |
| **Analyze** | QVAC | Generates risk briefs for guardian decision-making |
| **Trigger** | Anyone | Calls `trigger_inheritance` after threshold crossed (permissionless) |
| **Approve** | Guardians | Create covenant, sign approvals (M-of-N threshold) |
| **Execute** | Relayer | Submits trigger on-chain with retries |
| **Transfer** | Guardians | Reconstruct owner key, execute shielded Cloak transfer |
| **Claim** | Beneficiary | Uses offline private key to withdraw to real wallet |

### Guardian Multi-Signature Model

**Covenant Types:**
- `BeneficiaryChange` — Replace beneficiary (vote-based, 30-day timelock)
- `GuardianRemoval` — Remove a guardian (two-phase, voting required)
- `EmergencySweep` — Sweep non-shielded vault in emergency (vote-based)

### Inactivity Detection

The watcher monitors owner activity via:
- **Slots since last check-in** (primary metric)
- **Statistical anomaly detection** (secondary) — flags unusual silence patterns
- **Progressive warning** — notifies guardians at 75%, 90%, 99% thresholds

### Shamir Secret Sharing (GF(256))

- **Implementation**: `crates/shamir/` (Rust)
- **Finite Field**: GF(256) with AES-standard polynomial `0x11b`
- **Split**: Horner evaluation over randomized coefficients
- **Reconstruct**: Lagrange interpolation (never on-chain)

---

## Protocol Instructions

### Vault Lifecycle

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `initialize_vault` | Owner | Creates VaultAccount + ActivityAccount, sets threshold |
| `configure_threshold` | Owner | Updates inactivity threshold, resets warning flags |
| `deposit` | Owner | Deposits SOL (non-shielded vaults only) |
| `close_vault` | Owner | Closes empty vault, returns rent |

### Guardian Management

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `add_guardian` | Owner | Registers new guardian, updates M-of-N |
| `remove_guardian` | Owner | Two-phase timelock guardian removal |

### Covenant (Multi-Signature)

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `create_covenant` | Guardian | Opens M-of-N approval request |
| `guardian_sign` | Guardian | Adds signature to covenant |
| `execute_covenant` | Anyone | Executes approved covenant after timelock |

### Check-in & Monitoring

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `check_in` | Owner | Resets inactivity clock, updates statistical model |
| `anomaly_flag` | Guardian | Flags unusual silence (statistical detection) |

### Inheritance Execution

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `trigger_inheritance` | Anyone | Flips `is_triggered` after threshold crossed |
| `claim_inheritance` | Beneficiary | Non-shielded vault claim (permissionless) |
| `emergency_sweep` | Executor | Executes approved EmergencySweep covenant |

### Cloak Integration

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `record_cloak_deposit` | Owner | Records UTXO commitment after shielded deposit |
| `record_cloak_claim` | Anyone | Closes vault after shielded transfer (incentivized) |

### Cleanup

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `close_orphaned_covenant` | Anyone | Recovers rent from frozen covenants |

---

## Getting Started

### Prerequisites

- **Node.js**: 22.17.0 or later (for QVAC & watcher)
- **Rust**: 1.77.2 or later
- **Anchor**: 0.31.1 (`anchor --version`)
- **Solana CLI**: latest (`solana --version`)

### Installation

```bash
# Clone the repository
git clone https://github.com/myreltheviii-lgtm/legacy-protocol.git
cd legacy-protocol

# Install root dependencies
npm install

# Build Anchor program
anchor build

# Build SDKs
cd sdk && npm run build && cd ..
cd cloak-integration && npm run build && cd ..
cd app && npm run build && cd ..
```

### Quick Start: TypeScript SDK

```typescript
import { Connection, clusterApiUrl } from "@solana/web3.js";
import {
  buildInitializeVaultIx,
  deriveVaultPDA,
} from "@legacy-protocol/sdk";
import { generateUtxoKeypair } from "@legacy-protocol/cloak-integration";

const connection = new Connection(clusterApiUrl("mainnet-beta"));

// 1. Generate beneficiary identity (keep private key offline)
const beneficiary = await generateUtxoKeypair();

// 2. Create vault
const vaultIndex = 0n;
const inactivityThresholdSlots = 5_000_000n;
const [vaultPda] = deriveVaultPDA(owner.publicKey, vaultIndex);

const ix = buildInitializeVaultIx({
  owner: owner.publicKey,
  vaultPda,
  beneficiaryUtxoPubkey: beneficiary.publicKey,
  vaultIndex,
  inactivityThresholdSlots,
  programId: LEGACY_VAULT_PROGRAM_ID,
});

// 3. Submit transaction
const tx = new Transaction().add(ix);
const sig = await connection.sendTransaction(tx, [owner]);
await connection.confirmTransaction(sig);
```

---

## Development

### Build Commands

```bash
# Anchor program (Rust)
anchor build
anchor test

# TypeScript SDK
cd sdk && npm run build && npm run dev

# Cloak integration layer
cd cloak-integration && npm run build && npm run dev

# Watcher service
cd watcher && npm run build && npm run start

# Relayer service
cd relayer && npm run build && npm run start

# QVAC sidecar
cd qvac-sidecar && npm run start

# Frontend (Next.js + Tauri)
cd app && npm run dev

# All tests
npm run test
```

### Testing

```bash
# All tests
npm run test

# Individual suites
npm run test:anchor
npm run test:sdk
npm run test:shamir
npm run test:watcher
npm run test:relayer
npm run test:cloak
npm run test:integration
```

---

## Deployment

### Build for Production

```bash
# Anchor program (fat LTO)
anchor build --release

# TypeScript bundles
npm run build

# Watcher
cd watcher && npm run build
cd relayer && npm run build

# Frontend (Next.js static export)
cd app && npm run build
```

### Program Deployment

```bash
solana config set --url mainnet-beta
anchor deploy
```

### Watcher Deployment

```bash
cd watcher
npm install
node dist/index.js
```

### Relayer Deployment

```bash
cd relayer
npm install
node dist/index.js
```

### QVAC Sidecar Deployment

```bash
cd qvac-sidecar
npm install
npm run start
```

---

## Security

### Panic-Freedom Invariant

Every instruction handler in the Anchor program is statically panic-free:
- All fallible operations use **checked arithmetic**
- No `unwrap()`, `expect()`, or `panic!()` calls
- All errors propagate via `LegacyError` enum

### Key Zeroing

All sensitive cryptographic material is zeroed immediately after use:
```typescript
ownerUtxoPrivateKey.fill(0);
reconstructedKeypair.privateKey.fill(0);
beneficiaryUtxoPrivateKey.fill(0);
```

### Privacy Guarantees

**On-Chain Visibility:**
- ✓ Vault exists, owner wallet, guardian identities
- ✗ Beneficiary wallet, vault balance, transfer amounts, guardian shares

---

## Documentation

- **Watcher Architecture**: [docs/WATCHER.md](docs/WATCHER.md)
- **Relayer Architecture**: [docs/RELAYER.md](docs/RELAYER.md)
- **Cloak Integration**: [docs/CLOAK_INTEGRATION.md](docs/CLOAK_INTEGRATION.md)
- **Protocol Specification**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Support & Contributions

For issues, feature requests, or contributions:

1. **Issues**: [GitHub Issues](https://github.com/myreltheviii-lgtm/legacy-protocol/issues)
2. **Discussions**: [GitHub Discussions](https://github.com/myreltheviii-lgtm/legacy-protocol/discussions)
3. **Pull Requests**: Submit PRs against `main` branch with comprehensive tests

---

## Acknowledgments

Built with:
- [Anchor](https://github.com/coral-xyz/anchor) — Solana program framework
- [Cloak SDK](https://cloak.dev/) — Zero-knowledge shielded transactions
- [QVAC SDK](https://qvac.sh/) — AI inference on edge infrastructure
- [Yellowstone Geyser](https://www.triton-one.com/) — Real-time RPC streaming
- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js) — JavaScript client
- [Next.js](https://nextjs.org/) — React framework
- [Tauri](https://tauri.app/) — Desktop app framework
