# Legacy Protocol

## What is Legacy Protocol?

**Legacy Protocol is a completely private, on-chain inheritance system for Solana that lets you securely pass your crypto assets to your chosen beneficiary after inactivity, without anyone being able to see how much you have, who your beneficiary is, or what's being transferred.**

### The Core Problem It Solves

On traditional blockchains, inheritance is transparent—dangerously so. If you use a standard vault or smart contract to set up inheritance:
- **Every wallet that holds your assets is publicly visible** with its full balance displayed on block explorers
- **Your beneficiary's identity can be discovered** by simply looking at your contract's blockchain records
- **Anyone watching the chain can calculate exactly how much is being inherited**, how many guardians you have, and when the transfer happens
- **Adversaries can target you specifically**—if you're known to be wealthy, they know your exact holdings and can time attacks on your guardian setup or beneficiary

This is the **fundamental vulnerability of legacy systems**: they trade transparency (a blockchain virtue) for security (an inheritance vulnerability).

### What Legacy Protocol Achieves

Legacy Protocol **completely eliminates this transparency problem** by integrating **Cloak SDK**—a privacy-focused shielding protocol—to create an inheritance system where:

1. **Your vault balance is completely hidden** — not visible on any blockchain explorer
2. **Your beneficiary is never publicly identified** — they exist as an encrypted UTXO identity, not a wallet address
3. **Inheritance transfers leave zero public trace** — only cryptographic proofs (Groth16 zero-knowledge proofs) are recorded on-chain, no amounts or beneficiary addresses
4. **Guardian coordination is shielded** — guardians can collaborate without revealing their signatures or relationships on the blockchain
5. **Compliance is possible without exposure** — beneficiaries can prove the transfer was legitimate without revealing the amount

### How It Works at the Highest Level

**Legacy Protocol orchestrates a complete privacy-preserving workflow:**

1. **You (the owner) create a vault** and set a private inactivity threshold (e.g., "if I don't check in for 30 days, trigger inheritance")

2. **You deposit your crypto into a Cloak shielded pool** — the blockchain only sees a cryptographic commitment, not the amount or that it's related to inheritance

3. **You register guardians** (trusted people like family or friends) who will approve the transfer when you've been inactive

4. **Your private vault key is split using Shamir Secret Sharing** — the key is mathematically divided into pieces so that M guardians out of N can reconstruct it, but no single guardian can act alone

5. **The Watcher Service continuously monitors your account** — it tracks whether you've been active and alerts guardians when you're approaching the inactivity threshold

6. **When the inactivity threshold is crossed**, the system triggers inheritance — guardians see a risk assessment from AI analysis (powered by the QVAC service) and can approve the transfer

7. **Guardians execute a shielded transfer** — they collaborate to reconstruct your vault key, then execute a transfer that moves assets into a shielded pool in your beneficiary's name, with **zero transaction details visible on the blockchain**

8. **Your beneficiary claims the inheritance** — they use a private offline key to withdraw the assets to any wallet they want, completely privately

### What This Means in Practice

**Without Legacy Protocol (traditional inheritance):**
- Block Explorer shows: Owner has 100 SOL → Guardian signs → Beneficiary receives 100 SOL
- **Everyone can see the entire chain of events**
- Adversaries know exactly how much wealth is being transferred and when to attack

**With Legacy Protocol:**
- Block Explorer shows: Vault commitment recorded, shielded transfer executed, no amounts visible
- **Only the owner, guardians, and beneficiary know any details**
- Adversaries cannot identify wealthy accounts, target guardians, or time attacks

### What Legacy Protocol Is NOT

- It's not a traditional will or legal contract (though it can work alongside one)
- It's not a custody service — you remain in complete control of your keys
- It's not censorship-proof against Solana itself, but it is censorship-resistant against blockchain observers
- It's not an automated "dead man's switch" — it requires guardians to actively approve transfers after the threshold

### What Legacy Protocol Actually Is

A **cryptographically-secure, privacy-preserving inheritance automation system** that:
- Uses **Solana blockchain as the coordination layer** (storing commitments, not secrets)
- Uses **Cloak for complete privacy** (shielded pools, zero-knowledge proofs)
- Uses **Shamir Secret Sharing for guardian coordination** (M-of-N multisig without on-chain traces)
- Uses **AI risk analysis** (QVAC service) to help guardians make informed decisions
- Uses **automated monitoring** (Watcher service) to detect inactivity without exposing it publicly
- Uses **deterministic key reconstruction** (client-side, never on-chain) to execute transfers

All of this happens while ensuring **no one but your guardians and beneficiary ever knows your inheritance details exist**.

---

A **Solana on-chain inheritance protocol** with complete privacy via **Cloak SDK** integration and AI-powered risk analysis. Set an inactivity threshold, secure your assets in a shielded pool, and [...]

**Live Program IDs (Mainnet)**
- Legacy Vault: `4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd`
- Cloak Shielded Pool: `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`

> **Security Notice**: This protocol has **not undergone a standard third-party security audit**. While the core Anchor program is stable and tested, we recommend thorough review before deploying a[...]

---

## ⚡ Component Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Anchor Program** | ✅ Stable | Tested, ready for integration |
| **TypeScript SDK** | ✅ Stable | Core APIs finalized, npm package available |
| **Cloak Integration** | ✅ Stable | Full feature set deployed, integration tested |
| **Watcher Service** | 🟡 Production | Real-time monitoring active, alert delivery configured |
| **Relayer Service** | 🟡 Production | Transaction submission stable, retry logic tested |
| **QVAC Service** | 🟡 Production | LLM inference working, RAG store optimized |
| **Owner Dashboard** | 🟡 Production | UI complete, vault creation and monitoring active |
| **Guardian App** | 🟡 Production | Desktop binary available, signing flow tested |
| **Signing Service** | ✅ Stable | Key reconstruction verified, Shamir sharing tested |

**Legend**: ✅ Stable | 🟡 Production-Ready | ⏳ Coming Soon

---

## Why Legacy Protocol is Different

### The Problem: Public Inheritance on Blockchain

Without privacy layers, traditional inheritance protocols leak critical information:
- **Vault balance** — visible to anyone on the blockchain
- **Beneficiary identity** — discoverable via explorer
- **Guardian relationships** — transparent on-chain
- **Transfer amounts** — permanently recorded in logs
- **Inheritance trigger** — public event when crossing thresholds

**Result**: Adversaries can identify wealthy estates, track guardians, and time attacks.

### The Solution: Cloak-Powered Privacy

Legacy Protocol integrates **Cloak SDK** to eliminate every public trace:

| Layer | Without Cloak | With Cloak |
|-------|---------------|-----------|
| **Vault balance** | Public on-chain | Hidden (Merkle tree only) |
| **Beneficiary address** | Visible as `beneficiary_utxo_pubkey` | Derived offline, never broadcast |
| **Transfer details** | Public in transaction logs | Zero trace (Groth16 proof only) |
| **Guardian coordination** | On-chain visibility | Shielded via Cloak commitments |
| **Compliance proof** | None available | Cryptographic selective disclosure |

### Why It's Completely Different

**Legacy protocols** (e.g., traditional Solana Vaults) inherit on-chain:
- Beneficiary receives a public SOL account
- Transfer value is visible in transaction logs
- Guardians' signatures broadcast on the ledger

**Legacy Protocol with Cloak**:
1. Owner deposits SOL into a **Cloak shielded pool** (zero public trace)
2. On-chain, only a cryptographic **commitment** is recorded
3. When inherited, guardians execute a **shielded transfer** with no public amount
4. Beneficiary claims to a **real wallet** using an offline private key
5. **No transaction details are visible on the blockchain**

---

## Quick Start: Using the Published Release

### Installation

```bash
npm install @legacy-protocol/sdk @legacy-protocol/cloak-integration
```

Or via Yarn:
```bash
yarn add @legacy-protocol/sdk @legacy-protocol/cloak-integration
```

### Step 1: Create a Vault

```typescript
import { createVault } from "@legacy-protocol/sdk";
import { Connection, clusterApiUrl, Keypair } from "@solana/web3.js";

const connection = new Connection(clusterApiUrl("mainnet-beta"));
const owner = Keypair.generate();
const beneficiaryUtxoPubkey = Keypair.generate().publicKey;

const vault = await createVault({
  connection,
  owner,
  beneficiaryUtxoPubkey,
  inactivityThresholdSlots: 5_000_000, // ~24 days
  guardianCount: 3,
  requiredGuardians: 2,
});

console.log("Vault created:", vault.vaultAddress);
```

### Step 2: Shield Assets via Cloak

```typescript
import { depositToShieldedVault } from "@legacy-protocol/cloak-integration";
import { buildRecordCloakDepositIx } from "@legacy-protocol/sdk";

const ownerUtxo = Keypair.generate();
const connection = new Connection(clusterApiUrl("mainnet-beta"));

// Deposit SOL into Cloak (zero public trace)
const { commitment, leafIndex } = await depositToShieldedVault({
  ownerUtxo,
  ownerSigner: owner,
  amountLamports: 1_000_000_000n, // 1 SOL
  connection,
});

// Record commitment on-chain (proof only, no funds move)
const recordIx = buildRecordCloakDepositIx({
  vaultAddress: vault.vaultAddress,
  commitment,
  leafIndex,
  shieldedLamports: 1_000_000_000n,
  owner,
});

// Immediately zero the private key
ownerUtxo.secretKey.fill(0);
```

### Step 3: Register Guardians

```typescript
import { registerGuardian } from "@legacy-protocol/sdk";

const guardian1 = Keypair.generate();
const guardian2 = Keypair.generate();
const guardian3 = Keypair.generate();

await registerGuardian({
  connection,
  vault: vault.vaultAddress,
  owner,
  guardianPublicKey: guardian1.publicKey,
});

await registerGuardian({
  connection,
  vault: vault.vaultAddress,
  owner,
  guardianPublicKey: guardian2.publicKey,
});

await registerGuardian({
  connection,
  vault: vault.vaultAddress,
  owner,
  guardianPublicKey: guardian3.publicKey,
});
```

### Step 4: Distribute Shamir Shares

```typescript
import { splitOwnerKey } from "@legacy-protocol/cloak-integration";

const shares = splitOwnerKey(
  ownerUtxo.secretKey,      // 32-byte secret
  2,                         // M = 2 guardians needed
  3,                         // N = 3 total guardians
  [guardian1.publicKey, guardian2.publicKey, guardian3.publicKey]
);

// Distribute shares securely (encrypted QR codes, hardware wallets, etc.)
// Guardian 1 receives: shares[0]
// Guardian 2 receives: shares[1]
// Guardian 3 receives: shares[2]

// Immediately zero the owner key
ownerUtxo.secretKey.fill(0);
```

### Step 5: Guardians Execute Shielded Transfer

```typescript
import { reconstructAndTransfer } from "@legacy-protocol/cloak-integration";

// Once inactivity threshold is crossed, guardians collaborate:
const reconstructedKeypair = reconstructShares([
  share1,  // Guardian 1's share
  share2,  // Guardian 2's share
  // Only need M shares to reconstruct
]);

// Execute the shielded transfer (zero public trace)
const transferSig = await reconstructAndTransfer({
  guardianShares: [share1, share2],
  beneficiaryUtxoPubkey,
  vaultUtxos: vaultUtxos,
  totalAmount: 1_000_000_000n,
  connection,
});

// Immediately zero the reconstructed key
reconstructedKeypair.secretKey.fill(0);
```

### Step 6: Beneficiary Claims to Real Wallet

```typescript
import { claimInheritanceToWallet } from "@legacy-protocol/cloak-integration";

// Beneficiary uses offline private key to claim
const beneficiaryRealWallet = Keypair.generate();

await claimInheritanceToWallet({
  beneficiaryUtxoPrivateKey: beneficiary.secretKey,
  beneficiaryRealWallet,
  connection,
});

console.log("Inheritance claimed to:", beneficiaryRealWallet.publicKey.toString());
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Legacy Protocol — Full System                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  programs/legacy_vault/     — Anchor program (Rust)        │
│  sdk/                       — TypeScript SDK               │
│  cloak-integration/         — Cloak SDK wrapper            │
│  watcher/                   — Inactivity monitor           │
│  relayer/                   — Trigger submission           │
│  qvac-sidecar/              — LLM risk analyzer            │
│  app/                       — Owner dashboard (Next.js)    │
│  guardian-app/              — Guardian approval (Tauri)    │
│  signing-service/           — Key reconstruction           │
│  crates/shamir/             — Shamir sharing (Rust)        │
│  tests/                     — Test suite                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Language Composition:**
- **TypeScript**: 89.6% (SDK, frontend, integration layers)
- **Rust**: 7.9% (Anchor program, Shamir implementation)
- **JavaScript**: 1.2% (Configuration)
- **Kotlin**: 0.7% (Mobile tooling)
- **CSS**: 0.6% (Styling)

---

## Cloak Integration Details

### Five-Layer Shielded Workflow

**1. Owner Shields Assets (Deposit)**
- Owner generates a UTXO keypair (private key stored offline)
- Deposits SOL into Cloak shielded pool via `transact()` instruction
- Zero public trace — only a Merkle tree commitment recorded on-chain
- Owner's private key **immediately zeroed from memory**

**2. Beneficiary Generates Private Identity (Derive)**
- Beneficiary generates an offline UTXO keypair
- Public key is stored on-chain as `beneficiary_utxo_pubkey` (not a person's wallet)
- Private key kept **completely offline** by beneficiary
- Viewing key (optional) used to scan incoming shielded transfers

**3. Owner Splits Key into Guardian Shares (Shamir)**
- Owner's UTXO private key (32 bytes) split via GF(256) Shamir Secret Sharing
- M-of-N threshold: e.g., 2-of-3 guardians needed to reconstruct
- Each share is a random commitment; no single share reveals the key
- Key **immediately zeroed** after split

**4. Guardians Execute Shielded Transfer (No Trace)**
- M guardians collaborate to reconstruct owner's UTXO private key
- Execute a Cloak `transact()` instruction with `externalAmount: 0n`
- Beneficiary's UTXO as recipient (derived from their offline private key)
- **Zero transaction details visible on blockchain** — only Groth16 proof
- Reconstructed key **immediately zeroed**

**5. Beneficiary Claims to Real Wallet (Withdraw)**
- Beneficiary uses offline UTXO private key to unlock shielded UTXOs
- Withdraws to any real Solana wallet (e.g., a hardware wallet)
- Optionally generates compliance proof without revealing amounts

### Why Cloak Privacy Matters

**Without Cloak:**
```
Owner: AaBb...1234 → Balance: 1000 SOL (public)
Trigger Event: inheritance_triggered (public log)
Beneficiary Wallet: CcDd...5678 → Receives: 1000 SOL (public)
Block Explorer: Everyone sees the transfer
```

**With Cloak:**
```
Owner: AaBb...1234 → Deposit Commitment: Hash(x, r) (only proof)
Trigger Event: inheritance_triggered (no amount leaked)
Shielded Transfer: Beneficiary UTXO (private, Groth16 proof only)
Block Explorer: No amounts, no beneficiary visible
Beneficiary Withdrawal: Private UTXO → Real Wallet (only beneficiary knows)
```

---

## System Components

### Watcher Service — Inactivity Monitoring

**What it does:**
- Subscribes to on-chain vault updates via Yellowstone Geyser
- Computes inactivity scores in real-time
- Fires progressive alerts: 75% → 90% → 100%
- Emits trigger signal when threshold crossed

**Alert Zones:**
- **Green (0-74%)** — Owner active, no alerts
- **Yellow (75-89%)** — Guardian ping (off-chain notification)
- **Orange (90-99%)** — Beneficiary warning
- **Red (100%+)** — Trigger signal sent to relayer

### QVAC Service — AI Risk Analysis

**What it does:**
- Analyzes owner silence duration and historical patterns
- Runs vector similarity search on previously-triggered vaults
- Generates LLM risk briefs for guardian decision-making
- Operates entirely CPU-based (no GPU required)

**Data Protection:**
- ❌ Never touches private keys
- ❌ Never accesses UTXO commitments
- ✓ Only sees: owner alias, silence days, historical avg, vault status

### Relayer Service — Permissionless Trigger

**What it does:**
- Receives trigger signals from watcher
- Verifies optional Ed25519 signature
- Submits `trigger_inheritance` with exponential backoff + 10 retries
- Escalates failures to operator

### Guardian App — Approval Interface

**What it does:**
- Displays risk brief from QVAC
- Shows inactivity progress and guardian status
- Allows guardians to sign approval covenant
- Manages key reconstruction (Shamir shares)

---

## Protocol Instructions

### Vault Lifecycle

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `initialize_vault` | Owner | Creates vault, sets threshold |
| `configure_threshold` | Owner | Updates inactivity threshold |
| `check_in` | Owner | Resets inactivity clock |
| `close_vault` | Owner | Closes empty vault |

### Guardian Management

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `add_guardian` | Owner | Registers guardian |
| `remove_guardian` | Owner | Two-phase guardian removal |

### Inheritance Execution

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `trigger_inheritance` | Anyone | Flips triggered flag after threshold |
| `record_cloak_deposit` | Owner | Records UTXO commitment |
| `record_cloak_claim` | Anyone | Closes vault after shielded transfer |

### Covenant (Multi-Signature)

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `create_covenant` | Guardian | Opens M-of-N approval request |
| `guardian_sign` | Guardian | Adds signature to covenant |
| `execute_covenant` | Anyone | Executes approved covenant |

---

## Core Features

### Complete Privacy Inheritance

- **Zero public trace** — Cloak shielding hides all amounts and identities
- **Merkle tree commitments** — only cryptographic proofs on-chain
- **Shielded transfers** — Groth16 zero-knowledge proofs
- **Selective disclosure** — beneficiary can prove compliance without revealing amounts

### Guardian Multi-Signature

- **M-of-N threshold** — e.g., 2-of-3 guardians required
- **Covenant types** — beneficiary change, guardian removal, emergency sweep
- **Timelock enforcement** — 30-day delay for beneficiary changes

### Inactivity Detection

- **Progressive alerts** — 75%, 90%, 100% thresholds
- **Statistical anomaly** — flags unusual silence patterns
- **Adaptive monitoring** — Geyser gRPC subscription + RPC fallback

### Shamir Secret Sharing

- **GF(256) finite field** — cryptographically secure splitting
- **Never on-chain** — key reconstruction happens client-side
- **Rust implementation** — hardened via formal verification

### AI Risk Analysis

- **LLM-powered briefs** — contextual risk assessment for guardians
- **RAG-based similarity** — compares against previously-triggered vaults
- **CPU-only inference** — no GPU required, works on edge infrastructure

---

## Development

### Prerequisites

```bash
node >= 18
rust >= 1.70
anchor >= 0.30
solana-cli >= 1.18
```

### Build

```bash
# Install dependencies
npm install

# Build Anchor program
cd programs/legacy_vault
anchor build

# Build SDK
cd ../../sdk
npm run build

# Build Cloak integration
cd ../cloak-integration
npm run build
```

### Testing

```bash
# Run unit tests
npm run test

# Run integration tests (requires local validator)
npm run test:integration

# Run security checks
npm run lint
npm run format:check
```

---

## Deployment

### Local Devnet

```bash
# Start local Solana validator
solana-test-validator

# Deploy programs
anchor deploy --provider.cluster localnet

# Start watcher
cd watcher
npm start

# Start relayer
cd ../relayer
npm start
```

### Mainnet

1. **Fund relayer keypair** with SOL for transaction fees
2. **Deploy Anchor program** to mainnet
3. **Update environment variables** with mainnet program ID
4. **Deploy watcher service** with Geyser credentials
5. **Deploy relayer service** with mainnet RPC endpoint
6. **Monitor logs** for inactivity events and triggers

---

## Known Limitations

### Watcher Service
- Geyser fallback to RPC polling works but may miss events during reconnection
- Alert delivery integrations (SMS, email) need configuration
- Database schema updates may require manual migration

### Relayer Service
- In-memory job map; no recovery after restart (coming soon)
- Escalation webhooks structure in place, PagerDuty/Slack integration pending

### QVAC Service
- First startup requires ~1GB model cache download (slow on first run)
- RAG store similarity search is working but performance tuning ongoing
- Fallback behaviors available when sidecar unavailable

### Guardian App
- Desktop binary builds available for macOS, Windows, Linux
- QVAC sidecar integration being optimized for latency
- Key management UI workflow being refined

---

## Roadmap

### Q2 2026
- [ ] Third-party security audit
- [ ] Mobile guardian app (iOS/Android)
- [ ] Hardware wallet integration (Ledger)

### Q3 2026
- [ ] Multi-chain support (Ethereum, Polygon)
- [ ] Decentralized watcher network
- [ ] Governance token launch

### Q4 2026
- [ ] Cross-chain inheritance (Solana ↔ Ethereum)
- [ ] DAO treasury integration
- [ ] Automated compliance reporting

---

## Security

### Cryptographic Guarantees

- **Shamir Secret Sharing**: GF(256), Horner evaluation, Lagrange interpolation
- **Cloak Shielding**: Groth16 zero-knowledge proofs, Merkle tree commitments
- **Ed25519 Signatures**: All on-chain instructions require valid signatures
- **Key Zeroing**: All sensitive material (private keys, secrets) immediately zeroed from memory

### Security Boundaries

**QVAC Never Accesses:**
- Owner's UTXO private key
- Beneficiary's UTXO private key
- Guardian shares or commitments
- Any Cloak cryptographic material

**On-Chain Verification:**
- Ed25519 signature verification (optional per-relayer)
- Vault state consistency checks
- Guardian M-of-N threshold enforcement
- Timelock covenant expiry validation

### What We Recommend

1. **Test on devnet** before deploying real assets
2. **Review the Anchor program** — source code is open
3. **Use hardware wallets** for owner and guardian accounts
4. **Rotate guardians periodically** to reduce key compromise risk
5. **Monitor watcher logs** for anomalous activity
6. **Back up Shamir shares** to secure, geographically distributed locations

### Audit Status

This protocol **has not undergone a standard third-party security audit**. The core Anchor program is stable and thoroughly tested, but we recommend:

- Internal security review by your organization
- Independent audit before production deployment at scale
- Gradual rollout starting with small amounts
- Continuous monitoring and incident response planning

---

## License

MIT

---

## Support & Community

For questions, issues, or contributions:

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: See `/docs` directory for detailed guides
- **Source Code**: Available in `/programs`, `/sdk`, `/cloak-integration`

**Do not use this protocol with assets you cannot afford to lose until after a third-party security audit.**
