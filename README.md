# Legacy Protocol

A **Solana on-chain inheritance protocol** with complete privacy via [Cloak SDK](https://cloak.dev/) integration. Set an inactivity threshold — if you stop checking in, your designated beneficiary can claim your vault through a multi-guardian approval process with zero public trace.

**Live Program IDs (Mainnet)**
- Legacy Vault: `4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd`
- Cloak Shielded Pool: `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Cloak Integration — Private Inheritance](#cloak-integration--private-inheritance)
- [Core Features](#core-features)
- [Protocol Instructions](#protocol-instructions)
- [Getting Started](#getting-started)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [License](#license)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Legacy Protocol — Multi-Layer Inheritance Vault                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  programs/legacy_vault/    — Anchor program (Rust)             │
│  sdk/                      — TypeScript SDK (@legacy-protocol/sdk)
│  cloak-integration/        — Cloak integration layer           │
│  app/                      — Next.js + Tauri desktop frontend  │
│  guardian-app/             — Guardian approval interface       │
│  watcher/                  — Geyser-based inactivity monitor   │
│  relayer/                  — Inheritance trigger relayer       │
│  signing-service/          — Secure key reconstruction service │
│  crates/shamir/            — GF(256) Shamir secret sharing     │
│  tests/                    — Vitest + Jest unit & integration  │
│  docs/                     — Technical documentation           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Language Composition:**
- **TypeScript**: 89.6% (SDK, frontend, integration layers)
- **Rust**: 7.9% (Anchor program, Shamir implementation)
- **JavaScript**: 1.2% (Configuration)
- **Kotlin**: 0.7% (Mobile tooling)
- **CSS**: 0.6% (Styling)

### Repository Structure

| Directory | Purpose | Language |
|-----------|---------|----------|
| `programs/legacy_vault/` | Core Anchor program with instruction handlers | Rust |
| `sdk/src/` | Client SDK with PDA helpers, transactions, Shamir utilities | TypeScript |
| `cloak-integration/src/` | Higher-level Cloak workflow helpers (shield, inherit, claim) | TypeScript |
| `app/` | Vault owner UI (Next.js + Tauri desktop app) | TypeScript/React |
| `guardian-app/` | Guardian approval & signature interface | TypeScript/React |
| `watcher/` | Off-chain Geyser listener for inactivity tracking | TypeScript |
| `relayer/` | Permissionless `trigger_inheritance` submission | TypeScript |
| `signing-service/` | Key reconstruction and signing operations | TypeScript |
| `crates/shamir/` | GF(256) Shamir secret sharing (used in reconstruction) | Rust |
| `tests/` | Unit & integration tests (Vitest, Jest, Anchor Bankrun) | TypeScript/Rust |
| `idl/` | Generated IDL files from Anchor program | JSON |
| `docs/` | Protocol specification and integration guides | Markdown |

---

## Cloak Integration — Private Inheritance

Legacy Protocol embeds Cloak SDK to eliminate every public trace from the inheritance lifecycle. Without Cloak, vault balance, beneficiary wallet, and inheritance transfers are visible on-chain. With Cloak, they are completely hidden.

### Comparison: Without vs. With Cloak

| Layer | Without Cloak | With Cloak |
|-------|--------------|------------|
| **Vault balance** | Public on-chain | Hidden (Merkle tree only) |
| **Beneficiary wallet** | Visible as `beneficiary: Pubkey` | Off-chain UTXO public key only |
| **Transfer amount** | Public in transaction logs | Zero public trace (Groth16 proof) |
| **Beneficiary identity** | Block-explorer visible | Known only to key holder |
| **Compliance proof** | None | Cryptographic, selective disclosure |

### The Five-Layer Shielded Inheritance Workflow

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

const mOfNThreshold = 3;
const guardians = [
  { address: "guardian1.sol", wallet: guardianWallet1 },
  { address: "guardian2.sol", wallet: guardianWallet2 },
  { address: "guardian4.sol", wallet: guardianWallet4 },
  { address: "guardian5.sol", wallet: guardianWallet5 },
];

const shares = splitOwnerKey(
  ownerUtxoPrivateKey,        // 32-byte secret
  mOfNThreshold,              // M = 3 guardians needed
  guardians.length,           // N = 4 total guardians
  guardians.map(g => g.wallet)
);

// Distribute shares securely (encrypted QR codes, email, hardware wallet, etc.)
// Then zero the private key immediately
ownerUtxoPrivateKey.fill(0);
```

**4. Guardians Execute Shielded Transfer (No Public Trace)**

```typescript
import { reconstructAndTransfer } from "@legacy-protocol/cloak-integration";

// M-of-N guardians (e.g., 3 of 4) reconstruct the owner's UTXO private key
const reconstructedKeypair = reconstructShares(
  guardianShares.slice(0, 3) // Only need M shares
);

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

// Anyone can now call record_cloak_claim to close the vault
await submitTx(buildRecordCloakClaimIx({
  cloakTransferSignature: cloakTransferSig,
  // ... other params
}));
```

**5. Beneficiary Claims to Real Wallet**

```typescript
import { claimInheritanceToWallet } from "@legacy-protocol/cloak-integration";

// Beneficiary uses their private key (kept offline) to claim
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
// Proof can be exported as JSON — proves receipt without exposing details
```

---

## Core Features

### Vault Lifecycle

| Phase | Actor | Action |
|-------|-------|--------|
| **Create** | Owner | Sets beneficiary UTXO pubkey, inactivity threshold, initial guardians |
| **Shield** | Owner | Deposits SOL into Cloak (`transact()`), records commitment on-chain |
| **Check-in** | Owner | Periodically resets inactivity clock, updates statistical model |
| **Trigger** | Anyone | Calls `trigger_inheritance` after threshold crossed (permissionless) |
| **Approve** | Guardians | Create covenant, sign approvals (M-of-N threshold) |
| **Execute** | Guardians | Reconstruct owner key, execute shielded Cloak transfer |
| **Claim** | Beneficiary | Uses offline private key to withdraw to real wallet |

### Guardian Multi-Signature Model

**Covenant Types:**
- `BeneficiaryChange` — Replace beneficiary (vote-based, timelocked)
- `GuardianRemoval` — Remove a guardian (two-phase, voting required)
- `EmergencySweep` — Sweep non-shielded vault in emergency (vote-based)

**Approval Workflow:**
```
Guardian 1 → create_covenant(BeneficiaryChange, newBeneficiary)
Guardian 2 → guardian_sign(covenantId)
Guardian 3 → guardian_sign(covenantId)
[M-of-N signatures collected]
Anyone    → execute_covenant(covenantId) [after timelock]
```

### Inactivity Detection

The watcher monitors owner activity via:
- **Slots since last check-in** (primary)
- **Statistical anomaly detection** (secondary) — flags unusual silence patterns before threshold
- **Progressive warning** — notifies beneficiary and guardians at 75%, 90%, 99% thresholds

### Shamir Secret Sharing (GF(256))

- **Implementation**: `crates/shamir/` (Rust)
- **Finite Field**: GF(256) with AES-standard polynomial `0x11b`
- **Split**: Horner evaluation over randomized coefficients
- **Reconstruct**: Lagrange interpolation (no private key ever reconstructed on-chain)
- **Zero Memory**: All intermediate values zerod immediately after use

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

- **Node.js**: 18.x or later
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
  parseVaultAccount,
} from "@legacy-protocol/sdk";
import { generateUtxoKeypair } from "@legacy-protocol/cloak-integration";

const connection = new Connection(clusterApiUrl("mainnet-beta"));

// 1. Generate beneficiary identity (keep private key offline)
const beneficiary = await generateUtxoKeypair();

// 2. Create vault
const vaultIndex = 0n;
const inactivityThresholdSlots = 5_000_000n; // ~30 days
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

console.log("Vault created:", vaultPda.toString());
```

### Quick Start: Cloak Shield Integration

```typescript
import { depositToShieldedVault } from "@legacy-protocol/cloak-integration";

// Deposit SOL into shielded pool
const { commitment, leafIndex } = await depositToShieldedVault({
  ownerUtxo: ownerKeypair,
  ownerSigner: ownerKeypair,
  amountLamports: 1_000_000_000n,
  connection,
});

console.log("Commitment:", commitment.toString("hex"));
console.log("Leaf Index:", leafIndex);
```

---

## Development

### Project Structure

**TypeScript Packages** (89.6%):
- `sdk/src/` — Core SDK (accounts, instructions, PDAs, math, transactions)
- `cloak-integration/src/` — Cloak workflows (shield, inherit, claim, beneficiary setup)
- `app/` — Owner dashboard (Next.js)
- `guardian-app/` — Guardian interface
- `watcher/` — Activity monitor
- `relayer/` — Trigger submission
- `signing-service/` — Key reconstruction
- `tests/` — Test suites

**Rust Crates** (7.9%):
- `programs/legacy_vault/` — Anchor program
- `crates/shamir/` — Shamir secret sharing (GF(256))

### Build Commands

```bash
# Anchor program (Rust)
anchor build
anchor test

# TypeScript SDK
cd sdk && npm run build && npm run dev

# Cloak integration layer
cd cloak-integration && npm run build && npm run dev

# Frontend (Next.js + Tauri)
cd app && npm run dev

# All tests
npm run test

# Individual test suites
npm run test:anchor
npm run test:sdk
npm run test:shamir
npm run test:watcher
npm run test:relayer
npm run test:integration
npm run test:cloak
```

### Configuration

**Anchor.toml** — Program deployment settings:
```toml
[provider]
cluster = "mainnet"
wallet = "~/.config/solana/id.json"

[programs.mainnet]
legacy_vault = "4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd"
```

**Cargo.toml** — Rust workspace:
- Fat LTO enabled for maximum code optimization
- Overflow checks enabled in release builds
- Single codegen unit for cross-module inlining

---

## Testing

### Test Coverage

| Module | Framework | Coverage |
|--------|-----------|----------|
| Anchor program | `anchor test` + Bankrun | All instructions, PDAs, state transitions |
| Shamir | Jest | Split, reconstruct, edge cases (GF(256)) |
| SDK transactions | Vitest | Instruction builders, serialization |
| Cloak integration | Vitest | Shield, inherit, claim workflows |
| Watcher | Jest | Inactivity detection, anomaly flagging |
| Relayer | Jest | Trigger submission, retry logic |

### Running Tests

```bash
# All tests
npm run test

# Anchor program tests
npm run test:anchor

# Math (Shamir)
npm run test:math

# SDK tests
npm run test:sdk

# Cloak integration tests
npm run test:cloak

# Integration tests (full workflow)
npm run test:integration

# Watch mode
cd sdk && npm run dev
cd cloak-integration && npm run dev
```

### Test Files

```
tests/
  anchor/               — Anchor program tests
  math/                 — Shamir GF(256) tests
  sdk/                  — SDK instruction builders
  shamir/               — GF(256) implementation
  watcher/              — Inactivity monitoring
  relayer/              — Trigger submission
  integration/          — Full vault lifecycle
  cloak/                — Cloak integration workflows
```

---

## Deployment

### Build for Production

```bash
# Build Anchor program (fat LTO)
anchor build --release

# Generate IDL
anchor idl build

# TypeScript bundles
npm run build

# Frontend (Next.js static export)
cd app && npm run build
```

### Program Deployment

```bash
# Set network
solana config set --url mainnet-beta
solana config set --keypair ~/.config/solana/mainnet-key.json

# Deploy
anchor deploy

# Verify on-chain
solana program show 4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd
```

### Frontend Deployment

**Owner Dashboard (Next.js to Vercel):**
```bash
cd app
npm run build
vercel --prod
```

**Guardian App (React to AWS S3 + CloudFront):**
```bash
cd guardian-app
npm run build
aws s3 sync dist/ s3://guardian-app-bucket/
```

### Monitoring

**Watcher (Geyser-based):**
```bash
cd watcher
npm run start -- --cluster mainnet-beta
```

**Relayer (Trigger Submission):**
```bash
cd relayer
npm run start -- --rpc https://api.mainnet-beta.solana.com
```

---

## Security

### Panic-Freedom Invariant

Every instruction handler in the Anchor program is statically panic-free:
- All fallible operations use **checked arithmetic**
- No `unwrap()`, `expect()`, or `panic!()` calls
- All errors propagate via `LegacyError` enum
- Verified via code review and fuzz testing

### Key Zeroing

All sensitive cryptographic material is zeroed immediately after use:

```typescript
// Owner UTXO private key (zeroed after split)
ownerUtxoPrivateKey.fill(0);

// Reconstructed key (zeroed after inheritance transfer)
reconstructedKeypair.privateKey.fill(0);

// Beneficiary private key (zeroed after claim)
beneficiaryUtxoPrivateKey.fill(0);
```

### Privacy Guarantees

**On-Chain Visibility:**
- ✓ Vault exists
- ✓ Owner wallet
- ✓ Guardian identities
- ✗ Beneficiary wallet
- ✗ Vault balance
- ✗ Transfer amounts
- ✗ Guardian shares

**Blockchain Privacy:**
- Shielded amounts via Groth16 proofs (Cloak)
- Merkle tree commitments (non-revealing)
- Zero-knowledge compliance proofs
- No nullifier linkability across UTXOs

### Timelocks & Covenants

All critical operations use voter-based covenants with timelocks:
- **Beneficiary change**: 432,000 slots (~30 days)
- **Guardian removal**: 216,000 slots (~15 days)
- **Emergency sweep**: 0 slots (immediate, vote-gated only)

### Auditing & Compliance

- **IDL Generation**: Full instruction spec via Anchor IDL
- **Event Logging**: All state changes emit discriminated events
- **Transaction Proofs**: Compliance proof export (JSON format)
- **Off-Chain Verification**: Guardians can verify inheritance before execution

---

## Documentation

- **Protocol Spec**: [docs/CLOAK_INTEGRATION.md](docs/CLOAK_INTEGRATION.md)
- **API Reference**: [sdk/README.md](sdk/README.md)
- **Guardian Setup**: [guardian-app/README.md](guardian-app/README.md)
- **Watcher Architecture**: [watcher/README.md](watcher/README.md)
- **Deployment Guide**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Support & Contributions

For issues, feature requests, or contributions:

1. **Issues**: [GitHub Issues](https://github.com/myreltheviii-lgtm/legacy-protocol/issues)
2. **Discussions**: [GitHub Discussions](https://github.com/myreltheviii-lgtm/legacy-protocol/discussions)
3. **Pull Requests**: Submit PRs against `main` branch with comprehensive tests

## Acknowledgments

Built with:
- [Anchor](https://github.com/coral-xyz/anchor) — Solana program framework
- [Cloak SDK](https://cloak.dev/) — Zero-knowledge shielded transactions
- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js) — JavaScript client
- [Next.js](https://nextjs.org/) — React framework
- [Tauri](https://tauri.app/) — Desktop app framework
