# Deployment Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Rust | stable | Compile Anchor program |
| Anchor CLI | 0.30.1 | Build, deploy, verify IDL |
| Solana CLI | ≥ 1.18 | Deploy program, manage keypairs |
| Node.js | ≥ 20.0 | Watcher, relayer, SDK, frontend |
| npm | ≥ 10 | Package management |

Install Anchor 0.30.1:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1
avm use 0.30.1
```

## Program Deployment

### Build

```bash
cd legacy-protocol
anchor build
```

Build flags (from `Cargo.toml`): `overflow-checks = true`, `lto = "fat"`, `codegen-units = 1`.

The compiled program BPF binary is at `target/deploy/legacy_vault.so`. The IDL is at `target/idl/legacy_vault.json`.

### Deploy

```bash
# Devnet
solana config set --url devnet
anchor deploy --provider.cluster devnet

# Mainnet
solana config set --url mainnet-beta
anchor deploy --provider.cluster mainnet-beta
```

After deployment, the program ID is printed. Update `declare_id!(...)` in `programs/legacy_vault/src/lib.rs` and rebuild, then redeploy.

Update `LEGACY_VAULT_PROGRAM_ID` in all `.env` files and in `app/src/lib/sdk.ts`.

### Verify IDL

```bash
anchor verify <program-id>
```

## Watcher Deployment

### Environment Setup

```bash
cd watcher
npm install
cp .env.example .env
```

Edit `.env`:
- Set `SOLANA_RPC_ENDPOINT` to a private RPC endpoint (public endpoints rate-limit getProgramAccounts)
- Set `GEYSER_GRPC_ENDPOINT` to your Geyser provider endpoint (Helius, Triton, Shyft)
- Set `LEGACY_VAULT_PROGRAM_ID` to the deployed program ID
- Set `GUARDIAN_SECRET_KEYS` to base58 keypairs for anomaly flag signing
- Set `APP_BASE_URL` to the deployed frontend URL
- Optionally set `TRIGGER_SIGNER_SECRET_KEY` for signed trigger signals (recommended for production)

### SQLite Setup

The database file is created automatically at `DB_PATH` (default: `./watcher.db`) on first run.

WAL mode is enabled automatically. The `PRAGMA wal_checkpoint(TRUNCATE)` runs every `MAINTENANCE_INTERVAL_MS` (default: 1 hour).

### Running

```bash
npm run build
npm start
```

For process management in production:
```bash
# Using pm2
pm2 start dist/index.js --name legacy-watcher
pm2 save
pm2 startup
```

## Relayer Deployment

### Same-Process Mode (recommended for simplicity)

Run the relayer in the same Node.js process as the watcher. No additional deployment needed — import the watcher's EventEmitter bus directly.

### Separate-Process Mode

```bash
cd relayer
npm install
cp .env.example .env
```

Edit `.env`:
- `RELAYER_MODE=separate-process`
- `WATCHER_URL=http://localhost:3001` (or the watcher's IP/hostname)
- `RELAYER_SECRET_KEY` — base58 secret key for the fee-paying keypair (fund with ~1 SOL)
- `TRUSTED_TRIGGER_SIGNER_PUBKEY` — the public key corresponding to the watcher's `TRIGGER_SIGNER_SECRET_KEY`

```bash
npm run build
npm start
```

## Frontend Deployment

### Environment Variables

Create `app/.env.local`:

```bash
NEXT_PUBLIC_LEGACY_VAULT_PROGRAM_ID=LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta  # omit for mainnet (no ?cluster= suffix on explorer URLs)
```

### Build

```bash
cd app
npm install
npm run build
```

### Vercel Deployment

```bash
npx vercel --prod
```

Set the environment variables in the Vercel project settings.

### Self-Hosted

```bash
npm start  # serves on port 3000
```

## SDK Publishing

```bash
cd sdk
npm run build
npm publish --access public
```

Ensure `package.json` version is incremented before publishing.

## Devnet vs Mainnet

| Item | Devnet | Mainnet |
|------|--------|---------|
| Program ID | New ID from devnet deploy | New ID from mainnet deploy |
| RPC endpoint | https://api.devnet.solana.com | Private endpoint (Helius, Triton, etc.) |
| Geyser endpoint | Devnet Geyser provider | Mainnet Geyser provider |
| SOL source | Airdrop via `solana airdrop` | Real SOL |
| NEXT_PUBLIC_SOLANA_CLUSTER | `devnet` | unset (defaults to mainnet) |
| Explorer links | explorer.solana.com?cluster=devnet | explorer.solana.com (no query param) |

Before mainnet: verify that `declare_id!(...)` matches the deployed program ID, run the full test suite, confirm all IDL types match the deployed program, verify the relayer keypair has sufficient SOL.

## Monitoring

### What to Watch

| Metric | Alert threshold | Meaning |
|--------|----------------|---------|
| `watcher_geyser_reconnects_total` | Rate > 5/hour | Geyser connectivity issue |
| `watcher_trigger_signals_total` | Any increment | A vault crossed threshold — verify relayer submitted |
| `watcher_alert_errors_total` | Any increment | Alert pipeline error — check logs |
| `watcher_reconcile_errors_total` | Any increment | RPC or deserialization error |
| Relayer `/health` status | `"degraded"` | Failed or signature-rejected jobs present |
| Watcher keypair SOL balance | < 0.05 SOL | Fee payer running low |

### Log Levels

The watcher uses structured JSON logs (via pino). Key log events:

- `WARN`: Guardian ping emitted, beneficiary warning emitted
- `ERROR`: Anomaly flag transaction failed, trigger signal emitted, reconcile error
- `FATAL`: Trigger escalation (all retries exhausted), startup failure

## Upgrade Path

The Legacy Vault program stores state in PDAs. Program upgrades must not change account layouts (field types, sizes, or offsets) without a migration strategy.

Safe upgrades: adding new instructions, changing validation logic, fixing bugs that don't alter account structure.

Unsafe upgrades: changing VaultAccount/ActivityAccount/GuardianAccount/CovenantAccount field types or sizes (existing accounts will deserialize incorrectly), removing instructions that existing clients call, changing error code numbers.

For layout-changing upgrades, deploy a new program ID and provide a migration script that reads old accounts and writes new ones.
