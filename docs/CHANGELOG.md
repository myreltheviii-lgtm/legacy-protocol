# Changelog

## Current Version: 0.1.0

Status: Active development. Targeting Colosseum Frontier — May 11, 2026.

### Features Implemented

**On-chain program** (Anchor 0.31.1):
- 15 instructions covering the complete vault lifecycle: initialize, configure, deposit, close, guardian management (add/remove with two-phase timelock), covenant system (create, sign, execute, emergency sweep), check-in, anomaly flag, trigger, claim, orphan recovery
- 4 account types with precise fixed-size layouts: VaultAccount (128b), ActivityAccount (74b), GuardianAccount (90b), CovenantAccount (432b)
- 30 error codes across 8 categories
- 17 events across 6 primary lifecycle events and 11 secondary state-change events
- Integer-only arithmetic throughout with checked operations and MathOverflow on all overflow paths
- Level 4 panic-freedom: no unwrap(), no expect(), no panic!(), no unreachable!() in any instruction handler

**Shamir crate** (`crates/shamir`):
- GF(256) Shamir Secret Sharing with AES-standard polynomial (0x11b)
- Horner evaluation seeded from 0 (eliminates the last unwrap path)
- Lagrange interpolation with Fermat inversion (a^254)
- Result-returning gf_inv (ShamirError::ZeroInverse instead of panic)

**Watcher** (Node.js/TypeScript):
- Yellowstone Geyser gRPC primary stream with snapshot-first reconnect protocol
- Adaptive heartbeat: shortens to HEARTBEAT_SLOTS/3 (Orange) and /10 (Red) for urgent vaults
- Full poll pipeline: reconcile → score → anomaly → guardian ping → beneficiary warn → trigger signal
- SQLite WAL with typed VaultRecord schema; u64 stored as TEXT to avoid Number precision loss
- SigningPool for guardian keypairs with per-vault mapping and fallback
- Ed25519 trigger signal signing (TRIGGER_SIGNER_SECRET_KEY) for production security
- Three EventEmitter alert buses with setMaxListeners(0)
- DB-before-emit ordering on all alert paths to prevent duplicate alerts on restart
- HTTP: /health, /vaults, /metrics (Prometheus text format)
- Maintenance job: WAL checkpoint + poll_history pruning

**Relayer** (Node.js/TypeScript):
- Same-process and separate-process operating modes
- Ed25519 signature verification with SPKI DER construction and crypto.verify(null, ...) for Ed25519
- Preflight verification re-reads on-chain state to handle owner check-ins between signal and broadcast
- withRetry engine: exponential backoff with jitter, isSolanaTransientError fast-fail predicate
- In-memory job deduplication map with five statuses including SIGNATURE_REJECTED
- Escalation bus and FATAL log on retry exhaustion or signature rejection
- Vault PDA re-derivation and comparison before broadcast to detect corrupted event data

**SDK** (TypeScript):
- All 4 PDA helpers with exact seed matching
- Binary deserialisers for all 4 account types (no Anchor dependency at runtime)
- getProgramAccounts fetchers for bulk vault/guardian/covenant queries with server-side memcmp filters
- All 15 instruction builders with correct discriminators and account meta ordering
- sendAndConfirmLegacyTx, buildUnsignedTransaction, deserializeAndSubmitTx (offline signing)
- All 17 event parsers
- All 30 error codes in decodeLegacyError (three error shape variants)
- Complete BigInt math parity with Rust
- GF(256) Shamir in TypeScript matching the Rust crate exactly
- Blink URL helpers
- React hooks: useVault, useVaultRealtime, useGuardians, useCovenants, useVaultInactivity

**Frontend** (Next.js 16.2.4):
- Owner dashboard: InactivityRing SVG with animated arc, VaultDashboard, GuardianManager, ShamirDistributor
- Guardian dashboard: scans for guardian PDAs by memcmp, sorts by urgency, CovenantFlow, EmergencySweepWizard
- Beneficiary page: vault lookup, claim flow
- Recovery page: offline Shamir reconstruction, secret cleared after 8 seconds
- Three Blink Actions endpoints: /api/actions/checkin, /trigger, /claim
- PWA manifest with shortcuts
- WCAG 2.1 AA: aria-labels, role attributes, no information conveyed by colour alone
- Optimistic UI updates (Level 2) on check-in, deposit, threshold configure, guardian add/remove, covenant create/sign/execute
- InactivityRing angle convention: angleDeg=0 at 12 o'clock, clockwise; polarToCartesian uses `rad = (angleDeg - 90) × π / 180`

### Architecture Decisions

**u64 as string in SQLite**: JavaScript `Number` loses precision above 2^53. Solana slot numbers exceed this in production. All u64 database columns use TEXT type and all arithmetic uses BigInt.

**DB-before-emit alert ordering**: Writing the warning flag to SQLite before emitting the EventEmitter event ensures that a crash between the two operations leaves the system in a state where the flag is set and the event will not re-fire on restart. The inverse ordering risks duplicate notifications.

**guardian as fee payer for anomaly_flag**: The `anomaly_flag` Accounts struct declares guardian as `Signer<'info>` without `#[account(mut)]`. Solana's runtime requires the fee payer to be writable. Using a shared read-only provider wallet causes InsufficientFunds. The fix is a per-submission AnchorProvider with the guardian keypair as the wallet.

**triggerInheritance has only 2 accounts**: The `TriggerInheritance` Rust struct declares only `caller` and `vault`. The activity account is NOT listed. Earlier IDL versions incorrectly included a third account, causing Anchor's TypeScript client to fail client-side validation before any transaction was sent.

**Ed25519 signing uses crypto.sign(null, ...)**: The null first argument uses the algorithm embedded in the key object. `createSign("SHA512")` applies RSA/ECDSA semantics to an Ed25519 key and always fails.

**Horner seeded from 0**: The Rust `split_secret` and TypeScript `splitSecret` both seed Horner's method from 0, iterating all coefficients in reverse. This eliminates the `coeffs.last().unwrap()` call, ensuring the crate has zero panic paths.

**InactivityRing angle arithmetic**: The `polarToCartesian` function subtracts 90° from the input angle to convert from clock-face convention (0=12 o'clock, clockwise) to SVG standard (0=3 o'clock, counter-clockwise). Callers pass `angleDeg = fraction × 360`. The 90° subtraction must NOT be applied again at the call site — it is baked into the function.

**beneficiary_warn Blink URL path**: The watcher's `BeneficiaryWarnEvent.claimBlinkUrl` uses `/api/actions/claim` (the Solana Actions endpoint) rather than `/claim` (the UI page). Blink-compatible wallets call GET on this URL to discover the action schema, then POST to build the transaction. The UI page at `/claim` does not implement the Blink protocol.

**ON CONFLICT updates is_active = 1**: The `stmtUpsertVault` ON CONFLICT clause includes `is_active = 1`. Without this, a vault deactivated by a false-positive gap-recovery during a transient RPC issue would remain permanently inactive even after Geyser resumed delivering updates.

### Known Issues and Planned Improvements

- **Shamir WASM**: The `crates/shamir` Rust crate is not yet compiled to WASM. The TypeScript SDK re-implements the same GF(256) math natively. Cross-language share interoperability is verified via test vectors.
- **Anchor tests**: The test suite uses Anchor Bankrun (`solana-bankrun`) for deterministic slot manipulation. Full devnet integration tests are planned.
- **Withdrawal instruction**: There is currently no mechanism to partially withdraw deposited lamports while the vault is active. The only way to recover deposited funds is via close_vault (requires zero balance) or inheritance/sweep.
- **Multiple vault indexes**: The frontend currently shows vaults discovered by owner memcmp scan. An on-chain index (e.g., a program-owned counter PDA) would enable more efficient discovery.
- **Audit**: Formal security audit is in progress. Do not deploy to mainnet with significant funds before a clean audit report is published.
- **Upgrade authority**: The upgrade authority on the deployed program should be burned after final audit for maximum trustlessness.

### Breaking Changes

This is version 0.1.0. No migration from a previous version is required.
```


## Build Fixes Applied (Pre-Deploy)

**Program:**
- Upgraded Anchor from 0.30.1 to 0.31.1 (fixes proc-macro2/source_file incompatibility with Rust 1.85+)
- Added `idl-build = ["anchor-lang/idl-build"]` feature to `programs/legacy_vault/Cargo.toml`
- Replaced placeholder `declare_id!` and `Anchor.toml` program ID with real deployed address: `4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd`
- Build command: `cargo update -p proc-macro2 --precise 1.0.95 && RUSTFLAGS="--cfg=procmacro2_semver_exempt" anchor build`
- Deployed to devnet: `4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd`

**Watcher:**
- Replaced `Program<LegacyVault>` with `Program<any>` for Anchor 0.31.1 IDL type compatibility
- Fixed Program constructor to use `{ ...IDL, address, metadata }` pattern required by Anchor 0.31.1
- Fixed `geyser_client.ts` — `client.close()` cast to `(client as any).close()`
- Removed stray markdown backticks from `anomaly.ts` end-of-file
- Upgraded `better-sqlite3` to latest for Node v24 compatibility

**Relayer:**
- Same Anchor 0.31.1 Program constructor fix as watcher
- Fixed `broadcast.ts` deep type instantiation with `(program as any).methods` cast

**SDK:**
- Published to npm: `@legacy-protocol/sdk@0.3.0` under `@legacy-protocol` org
- Fixed `simulateTransaction` API for newer `@solana/web3.js`
- Added `@types/react` dev dependency
- Fixed implicit `any` in `hooks.ts` filter
- Removed stray markdown backticks from end of `shamir.ts`

**Frontend (Next.js 16.2.4):**
- Upgraded Next.js from 14.2.5 to 16.2.4
- Upgraded React from 18 to 19 (required by `@solana/wallet-adapter-react` dependencies)
- Added missing `tsconfig.json` with `@/*` path alias pointing to `src/`
- Set `tsconfig.json` target to `ES2020` for BigInt literal support
- Added `turbopack: {}` to `next.config.ts` to silence webpack config conflict warning
- Fixed `WalletModalProvider` in `WalletProvider.tsx` — dynamic import with `ssr: false`
- Fixed `WalletMultiButton` in all pages — dynamic import with `ssr: false`
- Added `"use client"` directive as first line in all pages using wallet hooks
- Fixed `@import url()` position in `globals.css` — must precede `@tailwind` directives
- Removed stray markdown backticks from `VaultDashboard.tsx`, `route.ts`
- Updated all hardcoded placeholder program IDs to deployed devnet address
- Fixed `app/package.json` SDK reference from `file:../sdk` to published npm `0.3.0`

**Post-Mainnet TODO:**
- Regenerate IDL TypeScript types: copy `target/types/legacy_vault.ts` into SDK and watcher/relayer
- Replace all `Program<any>` and `(program as any).methods` casts with `Program<LegacyVault>`
- Run `anchor build` first to get fresh types after mainnet deploy
