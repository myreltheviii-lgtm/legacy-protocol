# Legacy Protocol × Cloak SDK Integration

**Program IDs**
- Legacy Vault: `4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd`
- Cloak: `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Legacy Protocol Vault                  │
│  (Anchor PDA — stores metadata, not funds)               │
│                                                           │
│  owner: Pubkey                                            │
│  beneficiary_utxo_pubkey: [u8;32]  ← Cloak UTXO pubkey  │
│  utxo_commitment: [u8;32]          ← Poseidon hash       │
│  utxo_leaf_index: u64              ← Merkle tree leaf    │
│  deposited_lamports: u64           ← declared (private)  │
└─────────────────────────────────────────────────────────┘
                        │                    │
                   record_cloak_deposit  record_cloak_claim
                        │                    │
┌───────────────────────▼────────────────────▼─────────────┐
│                   Cloak Shielded Pool                     │
│   (Groth16 proofs — Poseidon commitments — Merkle tree)  │
│                                                           │
│  UTXOs: {amount, owner_utxo_pubkey, nullifier}           │
│  All values hidden from block explorers                   │
└──────────────────────────────────────────────────────────┘

```

The Anchor vault is a **metadata store** — it records the existence and location of shielded assets but never holds them. All SOL flows through Cloak directly.

---

## The Five Layers

### Layer 1 — The Vault (Shielded Deposit)

The vault owner calls Cloak's `transact()` off-chain, depositing SOL into the shielded pool. This produces a UTXO owned by the owner's UTXO keypair. The owner then calls `record_cloak_deposit` on the Anchor program to store the UTXO commitment and leaf index on-chain, so guardians can find the correct UTXO during inheritance execution.

**What is public:** The Anchor `record_cloak_deposit` transaction, the UTXO commitment (a 32-byte Poseidon hash), and the Merkle tree leaf index.

**What is hidden:** The balance, the depositor's identity, the UTXO owner.

### Layer 2 — The Beneficiary (Shielded Identity)

The beneficiary generates a Cloak UTXO keypair in the browser using `generateUtxoKeypair()`. They store only their **public key** on-chain as `vault.beneficiary_utxo_pubkey`. The private key never touches any network or server.

```typescript
const keypair      = await generateUtxoKeypair();
const viewingKeyNk = getNkFromUtxoPrivateKey(keypair.privateKey);
// Store keypair.publicKey on-chain — keep keypair.privateKey offline.
```

### Layer 3 — The Guardian Council (Shamir Shares)

Guardians hold shares of the vault **owner's** UTXO private key — the 32-byte secret that authorises spending from the shielded pool. The vault owner runs:

```typescript
const shares = splitOwnerKey(
  ownerUtxoPrivateKey,  // 32 bytes — Shamir-split immediately
  mOfNThreshold,        // M
  guardians.length,     // N
  guardianWallets,
);
// Distribute one share per guardian. Zero the private key.
ownerUtxoPrivateKey.fill(0);
```

The underlying Shamir implementation (`sdk/src/shamir.ts`) uses GF(256) with the AES-standard polynomial `0x11b`, Horner evaluation for splitting, and Lagrange interpolation for reconstruction — matching the Rust `crates/shamir` implementation byte-for-byte.

### Layer 4 — The Inheritance Trigger (Shielded Transfer)

When M-of-N guardians combine their shares, they reconstruct the owner UTXO keypair client-side and call Cloak's `transfer()` with `externalAmount: 0n`:

```typescript
await transfer(
  vaultUtxos,
  beneficiaryUtxoPubkey,
  amount,
  {
    connection,
    programId:        CLOAK_PROGRAM_ID,
    depositorKeypair: reconstructedKeypair,
    externalAmount:   0n,   // ← ZERO public trace
  }
);
// Immediately zero the reconstructed key.
reconstructedKeypair.privateKey.fill(0);
```

`externalAmount: 0n` means the transaction contains **only** a Groth16 proof and spent nullifiers. No amounts, no sender, no receiver appear on any block explorer.

After the Cloak transfer completes, anyone can call `record_cloak_claim` on the Anchor program to close the vault and activity accounts (returning their rent to the caller as a submission incentive).

### Layer 5 — The Proof (Compliance)

The beneficiary derives their viewing key and scans the shielded pool:

```typescript
const nk     = getNkFromUtxoPrivateKey(beneficiaryPrivateKey);
const scan   = await scanTransactions({ connection, programId: CLOAK_PROGRAM_ID, viewingKeyNk: nk, limit: 250 });
const report = toComplianceReport(scan);
// Export report as JSON — proves receipt without revealing amounts to others.
```

---

## UTXO Keypair Lifecycle

```
[Vault Creation]
  1. generateUtxoKeypair() → ownerUtxo
  2. splitOwnerKey(ownerUtxo.privateKey, M, N) → N guardian shares
  3. ownerUtxo.privateKey.fill(0)              ← zeroed immediately
  4. initialize_vault(beneficiary_utxo_pubkey = beneficiaryUtxo.publicKey)

[Deposit]
  5. transact({ externalAmount: amount, ... }) → { commitment, leafIndex }
  6. record_cloak_deposit(commitment, leafIndex, amount)

[Inheritance Execution]
  7. Guardians combine M shares → reconstruct ownerPrivateKey
  8. scanTransactions(viewingKey from ownerPrivateKey) → UTXOs
  9. transfer(UTXOs, beneficiaryUtxoPubkey, totalAmount, { externalAmount: 0n })
  10. ownerPrivateKey.fill(0)                  ← zeroed immediately
  11. record_cloak_claim(cloakTransferSignature)

[Beneficiary Claim]
  12. scanTransactions(beneficiaryViewingKey) → UTXOs
  13. fullWithdraw(UTXOs, beneficiaryRealWallet)
  14. generateComplianceProof() → downloadable JSON
```

---

## On-Chain vs Off-Chain Visibility

| Data | On-chain | Visible to public |
|------|----------|-------------------|
| Vault exists | ✓ | ✓ |
| Owner wallet | ✓ | ✓ |
| Beneficiary wallet | ✗ | ✗ |
| Beneficiary UTXO pubkey | ✓ (32 bytes) | ✓ (opaque) |
| Balance | ✗ | ✗ |
| UTXO commitment | ✓ | ✓ (opaque hash) |
| Transfer amounts | ✗ | ✗ |
| Guardian identities | ✓ | ✓ |
| Guardian shares | ✗ | ✗ |
| Inheritance execution tx | ✓ (Cloak proof only) | ✓ (no amounts) |

---

## Fee Model

Cloak charges per operation:

- **Fixed:** 5,000,000 lamports (0.005 SOL)
- **Variable:** `floor(gross * 3 / 1000)` (0.3% of gross)
- **Total:** `fixed + variable`
- **Net:** `gross - total`

Minimum deposit: 10,000,000 lamports (0.01 SOL).

```typescript
import { computeCloakFee } from "@legacy-protocol/sdk";

const { fixed, variable, total, net } = computeCloakFee(1_000_000_000n);
// fixed = 5_000_000n, variable = 3_000_000n, total = 8_000_000n, net = 992_000_000n
```

---

## Security Properties

**Key zeroing:** Every UTXO private key (both owner's reconstructed key and beneficiary's key during operations) is zeroed from browser memory via `.fill(0)` immediately after use.

**No network transmission:** Shamir shares are generated and distributed entirely client-side. No share ever leaves the browser unencrypted.

**Permissionless closing:** `record_cloak_claim` is callable by anyone after the Cloak transfer completes. The caller receives vault + activity rent as an incentive. No SOL moves through this instruction.

**Shielded-only enforcement:** `claim_inheritance` (for non-shielded vaults) returns `CovenantTypeMismatch` if called on a shielded vault, preventing accidental Anchor account closure before the Cloak transfer executes.

**Emergency sweep blocked for shielded vaults:** `emergency_sweep` returns `CovenantTypeMismatch` if the vault is shielded, because the SOL is not in the Anchor PDA — forcing guardians to use the off-chain Cloak path.

---

## Installation

```bash
npm i @cloak.dev/sdk @legacy-protocol/sdk @legacy-protocol/cloak-integration
```

The `@legacy-protocol/sdk` package re-exports all Cloak SDK functions with Legacy-specific helpers (see `sdk/src/cloak.ts`). The `@legacy-protocol/cloak-integration` package provides the higher-level deposit, transfer, and claim flows.
