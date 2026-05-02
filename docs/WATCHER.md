# Watcher Service Reference

The watcher is the off-chain monitoring service. It observes all vault states on-chain, computes inactivity scores, and drives the progressive alert pipeline (guardian ping → beneficiary warning → trigger signal to relayer). Without the watcher, no automatic notifications fire — but vaults can still be triggered manually by anyone.

## What the Watcher Does

1. Subscribes to the Yellowstone Geyser gRPC stream for real-time vault account updates and slot notifications.
2. Maintains a SQLite database of all monitored vaults and their current states.
3. On every heartbeat, computes inactivity scores for all active vaults and runs the alert pipeline.
4. Emits internal events on three buses that delivery integrations (email, SMS, push) subscribe to.
5. Exposes HTTP endpoints at `GET /health`, `GET /vaults`, and `GET /metrics`.

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`.

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| SOLANA_RPC_ENDPOINT | string | — | Yes | Solana RPC HTTP endpoint |
| SOLANA_RPC_WS_ENDPOINT | string | — | No | Solana RPC WebSocket endpoint (derived from RPC if absent) |
| LEGACY_VAULT_PROGRAM_ID | string | — | Yes | Deployed program ID |
| GEYSER_GRPC_ENDPOINT | string | — | Yes | Yellowstone Geyser gRPC endpoint (e.g., `https://mainnet.helius-rpc.com:443`) |
| GEYSER_X_TOKEN | string | "" | No | Geyser authentication token |
| HEARTBEAT_SLOTS | integer | 300 | No | Base heartbeat interval in slots (~2 min at 2/s). Adaptive: Orange → /3, Red → /10 |
| POLL_INTERVAL_MS | integer | 30000 | No | Fallback polling interval before Geyser connects |
| POLL_CONCURRENCY | integer | 20 | No | Max parallel vault reconciliations per cycle |
| DB_PATH | string | ./watcher.db | No | SQLite database file path |
| DB_RETENTION_DAYS | integer | 30 | No | Days of poll_history to retain |
| GUARDIAN_SECRET_KEYS | string | "" | No | Comma-separated base58 secret keys for anomaly_flag signing pool |
| APP_BASE_URL | string | http://localhost:3000 | No | Base URL for Blink claim URLs in beneficiary warnings |
| MAINTENANCE_INTERVAL_MS | integer | 3600000 | No | Maintenance job interval (WAL checkpoint, history prune) |
| INTERNAL_PORT | integer | 3001 | No | HTTP server port |
| LOG_LEVEL | string | info | No | trace \| debug \| info \| warn \| error \| fatal |
| NODE_ENV | string | development | No | production = raw JSON logs, development = pino-pretty |
| TRIGGER_SIGNER_SECRET_KEY | string | — | No | Ed25519 keypair for signing trigger signals (Level 4). When present, all TriggerReadyEvents are signed |

## Geyser gRPC Mode

The watcher uses Yellowstone Geyser (`@triton-one/yellowstone-grpc`) as its primary data source. Geyser delivers real-time account updates as accounts change on-chain and slot notifications approximately every 400 ms.

### Snapshot-First Protocol

Every (re)connect begins with a snapshot via `getProgramAccounts` (RPC):

1. Fetch all program-owned accounts at the current confirmed slot.
2. For each account, call `handlers.onAccountUpdate(pubkey, data, slot, lamports)`.
3. Call `handlers.onSnapshotComplete(seenPubkeys)`.

The snapshot closes the gap window between stream termination and resumption. Any vault closed during the disconnect is detected via `handleSnapshotComplete` — vaults in the DB but absent from the snapshot are deactivated.

### Reconnect Loop

If the stream encounters an error, end, or close event, the watcher reconnects automatically:

```

Attempt 1: wait 1,000 ms
Attempt 2: wait 2,000 ms
Attempt 3: wait 4,000 ms
...
Attempt N: wait min(1000 × 2^(N-1), 30,000) ms
```

After a successful session of any length, backoff resets to 1,000 ms.

### Account Dispatch

`onAccountUpdate` dispatches based on the 8-byte Anchor discriminator:

- **VaultAccount** (`sha256("account:VaultAccount")[0..8]`): parsed and upserted to DB. If `isClaimed` or `isEmergencySwept`, vault is deactivated. The `anomalyFlagged`, `checkinCount`, and `sumOfIntervals` fields are preserved from the existing DB record to avoid clobbering activity-account-owned data with stale vault-account values.
- **ActivityAccount** (`sha256("account:ActivityAccount")[0..8]`): `checkinCount`, `sumOfIntervals`, `anomalyFlagged` are updated on the vault's DB record.
- **GuardianAccount**, **CovenantAccount**, and other accounts: silently ignored.
- Lamports == 0 or null data: vault deactivated.

## RPC Fallback Mode

When Geyser is unavailable or not yet connected, the watcher falls back to a poll-based approach using RPC. The initial pre-Geyser poll cycle on startup seeds the DB from any existing vaults. After that, slot-driven heartbeats keep the poll cycle running.

## Poll Cycle

A poll cycle fires when enough slots have elapsed since the last heartbeat. The cycle is mutex-guarded — no two cycles run concurrently.

The adaptive heartbeat window:
- Most urgent zone = Green or Yellow: fire every `HEARTBEAT_SLOTS` slots
- Most urgent zone = Orange: fire every `HEARTBEAT_SLOTS / 3` slots
- Most urgent zone = Red: fire every `HEARTBEAT_SLOTS / 10` slots

Within each cycle:

**reconcileAllVaults**: For each active vault in the DB, fetch `VaultAccount` and `ActivityAccount` from RPC. Update the DB record with on-chain truth. Deactivate vaults that have been triggered, claimed, swept, or closed. Errors during individual vault reconciliation keep the stale record in the active set (retry next cycle). Processed in batches of `POLL_CONCURRENCY`.

**computeAllInactivityStates**: For each active vault, compute score = `(elapsed × 100) / threshold`, classify zone, and compute milestone slots. All arithmetic uses `BigInt`.

**evaluateAllAnomalies**: For each vault not yet anomaly-flagged, in Green or Yellow zone, check `is_anomalous()`. If true, select a guardian from the signing pool and submit `anomaly_flag` on-chain.

**sendGuardianPingsForEligibleVaults**: For each vault in Yellow or higher zone with `warning_75_sent == false`, write `warning_75_sent = true` to DB (before emitting), then emit `guardian_ping` on `guardianAlertBus`.

**sendBeneficiaryWarningsForEligibleVaults**: For each vault in Orange or higher zone with `warning_90_sent == false`, write `warning_90_sent = true` to DB, then emit `beneficiary_warn` on `beneficiaryAlertBus`. The `claimBlinkUrl` in the event points to `/api/actions/claim?vault=<address>` (the Blink-compliant endpoint, not the UI page at `/claim`).

**signalEligibleTriggers**: For each vault in Red zone (score ≥ 100) with `trigger_signalled == false`, write `trigger_signalled = true` to DB, optionally sign the payload with `TRIGGER_SIGNER_SECRET_KEY`, then emit `trigger_ready` on `triggerSignalBus`.

**recordPollCycle**: Write a `poll_history` row with summary counts.

## SQLite Schema

WAL mode enabled (`journal_mode = WAL`) with `foreign_keys = ON`. The maintenance job runs `PRAGMA wal_checkpoint(TRUNCATE)` hourly.

**vaults table** — see [ARCHITECTURE.md](ARCHITECTURE.md) for full column list.

Indexes: `idx_vaults_owner` on `owner_address`, `idx_vaults_active` on `is_active`.

**poll_history table**:

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| cycle_slot | TEXT | Slot number as string |
| cycle_start_ms | INTEGER | Unix milliseconds |
| cycle_duration_ms | INTEGER | How long the cycle took |
| total_vaults | INTEGER | Active vaults this cycle |
| deactivated | INTEGER | Vaults removed this cycle |
| guardian_pings | INTEGER | Guardian pings sent |
| beneficiary_warnings | INTEGER | Beneficiary warnings sent |
| trigger_signals | INTEGER | Trigger signals emitted |
| anomaly_flags | INTEGER | On-chain anomaly_flag txs submitted |
| errors | INTEGER | Alert errors encountered |
| created_at | TEXT | `datetime('now')` UTC |

Timestamp format for all `created_at` / `updated_at` fields: `"YYYY-MM-DD HH:MM:SS"` (SQLite's `datetime('now')` format with space separator, NOT ISO-8601 T-format).

## SigningPool

`SigningPool` is initialised from `GUARDIAN_SECRET_KEYS`. Each key is decoded from base58 and stored as a `Keypair`.

`getGuardianForVault(vaultAddress)`: returns the explicitly mapped keypair for the vault, or the first available keypair as a fallback. Returns `null` if the pool is empty.

`setGuardianForVault(vaultAddress, guardianPubkey)`: explicitly maps a vault to a specific guardian keypair.

The signing pool keypairs are transaction fee payers for `anomaly_flag` submissions. Each keypair must be both the instruction signer and the fee payer — the watcher builds a per-submission `AnchorProvider` with the guardian keypair as the wallet. This is required because the Solana runtime requires the fee payer to be writable in the compiled transaction message, and `@solana/web3.js` automatically marks the fee payer writable. Using a separate shared read-only wallet as the provider causes `InsufficientFunds` errors.

## Alert Buses

### guardianAlertBus

Event: `"guardian_ping"` with payload `GuardianPingEvent`:

| Field | Type | Description |
|-------|------|-------------|
| vaultAddress | string | base58 |
| ownerAddress | string | base58 |
| beneficiaryAddress | string | base58 |
| guardianAddresses | string[] | base58 array of active guardian pubkeys |
| inactivityScorePct | string | e.g. "78" |
| elapsedSlots | string | u64 as string |
| triggerSlot | string | absolute slot as string |
| estimatedSecondsToTrigger | number | approximate wall-clock seconds |
| pingSlot | string | slot when this alert was computed |

### beneficiaryAlertBus

Event: `"beneficiary_warn"` with payload `BeneficiaryWarnEvent`:

| Field | Type | Description |
|-------|------|-------------|
| vaultAddress | string | base58 |
| ownerAddress | string | base58 |
| beneficiaryAddress | string | base58 |
| inactivityScorePct | string | e.g. "93" |
| elapsedSlots | string | u64 as string |
| triggerSlot | string | absolute slot as string |
| estimatedSecondsToTrigger | number | |
| depositedLamports | string | u64 as string |
| warnSlot | string | slot when computed |
| claimBlinkUrl | string | `{APP_BASE_URL}/api/actions/claim?vault={address}` |

### triggerSignalBus

Event: `"trigger_ready"` with payload `TriggerReadyEvent`:

| Field | Type | Description |
|-------|------|-------------|
| vaultAddress | string | base58 |
| ownerAddress | string | base58 |
| vaultIndex | string | u64 as string |
| beneficiaryAddress | string | base58 |
| depositedLamports | string | u64 as string |
| signalSlot | string | slot when computed |
| inactivityScore | string | e.g. "103" |
| maxRetries | number | 10 |
| signature | string? | base58 Ed25519 signature (when TRIGGER_SIGNER_SECRET_KEY configured) |
| signerPublicKey | string? | base58 signer pubkey |

## HTTP Endpoints

**GET /health** — returns JSON:
```json
{ "status": "ok", "uptime": 3600.5, "currentSlot": "287654321", "timestamp": "2026-01-01T00:00:00.000Z" }
```

**GET /vaults** — returns JSON array of all active `VaultRecord` objects. Used by the relayer in separate-process mode.

**GET /metrics** — returns Prometheus text format exposition. Includes counters for geyser reconnects, geyser updates, poll cycles, guardian pings, beneficiary warnings, trigger signals, anomaly flags, reconcile errors, alert errors; and gauges for vaults monitored and zone distribution.

## Deployment Guide

### Environment Setup

```bash
cd watcher
npm install
cp .env.example .env
# edit .env with your values
```

### Keypair Provisioning

For the signing pool, generate guardian keypairs and fund each with ~0.1 SOL for fees:

```bash
solana-keygen new --outfile guardian1.json
solana airdrop 0.1 $(solana-keygen pubkey guardian1.json)
# Export the base58 secret key:
node -e "const k = require('./guardian1.json'); const bs58 = require('bs58'); console.log(bs58.encode(Buffer.from(k)));"
```

Add the base58 key to `GUARDIAN_SECRET_KEYS` in `.env`.

The guardian pubkey must be registered with the vault using `add_guardian` before `anomaly_flag` calls will succeed.

### Running

```bash
npm run build && npm start
# or for development:
npm run dev
```

### Monitoring

- Watch `LOG_LEVEL=warn` for guardian pings and beneficiary warnings (logged at WARN).
- Watch `LOG_LEVEL=error` for trigger signals (logged at ERROR), reconcile failures, and signing pool errors.
- Watch `LOG_LEVEL=fatal` for trigger escalations and startup failures.
- Scrape `GET /metrics` with Prometheus for operational dashboards.

## Operational Runbook

**Watcher falls behind (currentSlot stalls)**: Check Geyser connection. The `geyser_reconnects` metric will increment. If reconnects are frequent, check network connectivity to the Geyser endpoint and your API key/token. The watcher will continue to reconnect with exponential backoff.

**Watcher crashes and restarts**: The DB preserves all warning flags and trigger_signalled state. On restart, the watcher re-runs the poll cycle from the Geyser snapshot. No duplicate alerts will fire for vaults that already have `warning_75_sent = true` etc. in the DB.

**Watcher loses Geyser connection for extended period**: The `onSnapshotComplete` handler deactivates vaults absent from the new snapshot. If a vault was closed legitimately during the gap, it will be deactivated correctly. If a vault appears to have disappeared due to a partial snapshot, the `seenPubkeys.size > 0` guard prevents false deactivations from empty snapshots.

**Anomaly flag transactions failing**: Check the signing pool keypair balances. Each keypair needs ~0.0005 SOL per transaction. Also verify the guardian pubkey is registered with the vault and still active.

**Trigger signal emitted but relayer not submitting**: Check the relayer logs for pre-flight failures or signature rejection. In same-process mode, ensure the relayer is subscribed to the `triggerSignalBus` before the signal fires.
