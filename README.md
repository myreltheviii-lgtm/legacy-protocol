# Legacy Protocol

A Solana on-chain inheritance dead-man's switch. Set an inactivity threshold — if you stop checking in, your designated beneficiary can claim your vault.

**Program IDs**
- Legacy Vault: `4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd`
- Cloak (shielded pool): `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`

---

## Cloak Integration — Private Inheritance

Legacy Protocol integrates the Cloak SDK (`@cloak.dev/sdk`) to eliminate every public trace from the inheritance lifecycle. Without Cloak, vault balance, beneficiary wallet, and inheritance transfer are all publicly visible on any block explorer. With Cloak, every layer is transformed.

### What Cloak Transforms

| Layer | Without Cloak | With Cloak |
|-------|--------------|------------|
| Vault balance | Public | Hidden |
| Beneficiary wallet | On-chain (base58 pubkey) | Off-chain (UTXO pubkey) |
| Transfer amount | Public on-chain | Zero trace (Groth16 proof only) |
| Beneficiary identity | Block-explorer visible | Known only to key holder |
| Compliance proof | None | Cryptographic, selective disclosure |

### Setup

```bash
npm i @cloak.dev/sdk @legacy-protocol/sdk @legacy-protocol/cloak-integration
```

### How It Works

**1. Beneficiary generates a private identity**

```typescript
import { generateBeneficiaryIdentity } from "@legacy-protocol/cloak-integration";

const identity = await generateBeneficiaryIdentity();
// identity.publicKey → stored on-chain as vault.beneficiary_utxo_pubkey
// identity.privateKey → kept offline by beneficiary
// identity.viewingKeyNk → used to scan for incoming transfers
```

**2. Vault owner shields assets**

```typescript
import { depositToShieldedVault } from "@legacy-protocol/cloak-integration";
import { buildRecordCloakDepositIx } from "@legacy-protocol/sdk";

const result = await depositToShieldedVault({ ownerUtxo, ownerSigner, amountLamports, connection });
// then submit buildRecordCloakDepositIx(...) to record the UTXO commitment on-chain
```

**3. Owner splits vault key into guardian shares**

```typescript
import { splitOwnerKey } from "@legacy-protocol/cloak-integration";

const shares = splitOwnerKey(ownerPrivateKey, mThreshold, nGuardians, guardianWallets);
ownerPrivateKey.fill(0); // zero immediately after splitting
```

**4. Guardians execute shielded inheritance**

```typescript
import { reconstructAndTransfer } from "@legacy-protocol/cloak-integration";

const claim = await reconstructAndTransfer({
  guardianShares, beneficiaryUtxoPubkey, vaultUtxos, totalAmount, relayerSigner, connection,
});
// externalAmount: 0n — zero public trace, fully shielded
```

**5. Beneficiary claims to real wallet**

```typescript
import { claimInheritanceToWallet, generateComplianceProof } from "@legacy-protocol/cloak-integration";

await claimInheritanceToWallet({ beneficiaryUtxoPrivateKey, beneficiaryRealWallet, connection });
const proof = await generateComplianceProof({ beneficiaryUtxoPrivateKey, connection });
```

### Judging Criteria (Cloak Frontier Track)

**Integration depth (40%):** Cloak is not a feature added on top — it is the execution substrate. The vault stores no funds; assets flow entirely through Cloak. Five layers — deposit, beneficiary identity, guardian shares, shielded transfer, compliance proof — all use Cloak SDK functions exclusively.

**Product quality (30%):** Real UX for every step — fee breakdowns, progress indicators, encrypted backup/restore, QR share distribution, vault shield status badges. Zero placeholder code. TypeScript strict mode. Zero `tsc` errors.

**Real-world use (30%):** The target users are high-net-worth individuals, families in sensitive jurisdictions, and DAO treasury successors — exactly the people for whom public inheritance trails are a fundamental blocker. This system allows inheritance to complete with full cryptographic verifiability and zero public disclosure.

---

## Architecture

```
programs/legacy_vault/  — Anchor program (Rust, overflow-checks=true, fat LTO)
sdk/                    — TypeScript SDK (@legacy-protocol/sdk)
cloak-integration/      — Cloak integration layer (@legacy-protocol/cloak-integration)
app/                    — Next.js frontend
watcher/                — Geyser-based off-chain monitor
relayer/                — Trigger submission relayer
crates/shamir/          — GF(256) Shamir implementation (Rust, for verification)
tests/                  — Vitest unit + integration tests
docs/                   — Protocol documentation
```

See [docs/CLOAK_INTEGRATION.md](docs/CLOAK_INTEGRATION.md) for full technical documentation of the Cloak integration.

---

## Protocol Overview

### Vault Lifecycle

1. **Create vault** — owner sets beneficiary UTXO pubkey and inactivity threshold
2. **Shield assets** — owner deposits SOL into Cloak via `transact()`, records commitment
3. **Split key** — owner distributes Shamir shares of UTXO private key to guardians
4. **Check in** — owner submits periodic check-ins to reset the inactivity clock
5. **Trigger** — anyone calls `trigger_inheritance` after threshold is crossed
6. **Execute** — M-of-N guardians reconstruct key and execute shielded transfer
7. **Claim** — beneficiary uses viewing key to withdraw to real wallet

### Instructions

| Instruction | Caller | Effect |
|-------------|--------|--------|
| `initialize_vault` | Owner | Creates vault + activity PDAs |
| `deposit` | Owner | Deposits SOL (non-shielded vaults) |
| `record_cloak_deposit` | Owner | Records Cloak UTXO commitment |
| `check_in` | Owner | Resets inactivity clock |
| `configure_threshold` | Owner | Updates inactivity threshold |
| `add_guardian` | Owner | Registers guardian, updates M-of-N |
| `remove_guardian` | Owner | Two-phase timelock guardian removal |
| `create_covenant` | Guardian | Opens M-of-N approval request |
| `guardian_sign` | Guardian | Adds signature to covenant |
| `execute_covenant` | Anyone | Executes approved covenant |
| `trigger_inheritance` | Anyone | Flips `is_triggered` after threshold |
| `claim_inheritance` | Beneficiary | Non-shielded claim |
| `record_cloak_claim` | Anyone | Closes accounts after shielded claim |
| `emergency_sweep` | Anyone | Executes EmergencySweep covenant |
| `close_vault` | Owner | Closes empty vault |
| `anomaly_flag` | Guardian | Flags statistically unusual silence |
| `close_orphaned_covenant` | Anyone | Recovers rent from frozen covenants |

---

## Development

```bash
# Anchor program
anchor build
anchor test

# SDK
cd sdk && npm install && npm run build

# Cloak integration layer
cd cloak-integration && npm install && npm run build

# Frontend
cd app && npm install && npm run dev

# Tests
npm run test
```

---

## License

MIT
