# SDK Integration Guide

Package: `@legacy-protocol/sdk`

```bash
npm install @legacy-protocol/sdk
npm install --save-dev @types/react
```

## Installation and Setup

The SDK has no mandatory peer dependencies for Node.js usage. For React hooks (`useVault`, `useGuardians`, etc.), peer dependencies `react >= 18` and `@solana/wallet-adapter-react >= 0.15` are required.

```typescript
import { PublicKey } from "@solana/web3.js";
// All exports are available from the root entry point
import {
  deriveVaultPda,
  fetchVault,
  buildInitializeVaultIx,
  computeInactivityScore,
  parseLegacyEventsFromLogs,
  decodeLegacyError,
  splitSecret,
} from "@legacy-protocol/sdk";

const PROGRAM_ID = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
```

## PDA Helpers

All four functions use `PublicKey.findProgramAddressSync` (synchronous, no I/O) and return `[PublicKey, number]` where the second element is the canonical bump.

### deriveVaultPda

```typescript
function deriveVaultPda(
  programId: PublicKey,
  owner: PublicKey,
  vaultIndex: bigint,
): [PublicKey, number]
```

Seeds: `["vault", owner.toBuffer(), u64ToLeBytes(vaultIndex)]`

```typescript
const [vaultPda, bump] = deriveVaultPda(PROGRAM_ID, ownerPublicKey, 0n);
const [vault2Pda]      = deriveVaultPda(PROGRAM_ID, ownerPublicKey, 1n);
// Different vault_index → different PDA
```

### deriveActivityPda

```typescript
function deriveActivityPda(
  programId: PublicKey,
  vault: PublicKey,
): [PublicKey, number]
```

Seeds: `["activity", vault.toBuffer()]`

```typescript
const [vaultPda]    = deriveVaultPda(PROGRAM_ID, owner, 0n);
const [activityPda] = deriveActivityPda(PROGRAM_ID, vaultPda);
```

### deriveGuardianPda

```typescript
function deriveGuardianPda(
  programId: PublicKey,
  vault: PublicKey,
  guardian: PublicKey,
): [PublicKey, number]
```

Seeds: `["guardian", vault.toBuffer(), guardian.toBuffer()]`

```typescript
const [guardianPda] = deriveGuardianPda(PROGRAM_ID, vaultPda, guardianPublicKey);
```

### deriveCovenantPda

```typescript
function deriveCovenantPda(
  programId: PublicKey,
  vault: PublicKey,
  covenantIndex: bigint,
): [PublicKey, number]
```

Seeds: `["covenant", vault.toBuffer(), u64ToLeBytes(covenantIndex)]`

`covenantIndex` must equal `vault.covenantCounter` at the time of the `create_covenant` call.

```typescript
const vault = await fetchVault(connection, PROGRAM_ID, vaultPda);
const [covenantPda] = deriveCovenantPda(PROGRAM_ID, vaultPda, vault!.covenantCounter);
```

## Account Fetchers

All fetchers call `connection.getAccountInfo(pubkey, "confirmed")`. They validate the Anchor discriminator (`sha256("account:StructName")[0..8]`). Returns `null` if the account does not exist or has the wrong discriminator. Throws on RPC transport errors — callers must distinguish "not found" from "network failure".

All `u64` fields return as `bigint`. All `Pubkey` fields return as base58 strings.

### fetchVault

```typescript
async function fetchVault(
  connection: Connection,
  programId: PublicKey,
  vaultPda: PublicKey,
): Promise<VaultAccount | null>
```

```typescript
const vault = await fetchVault(connection, PROGRAM_ID, vaultPda);
if (!vault) {
  console.log("Vault not found");
  return;
}
console.log(vault.owner);                       // base58 string
console.log(vault.depositedLamports);           // bigint
console.log(vault.isTriggered);                 // boolean
console.log(vault.inactivityThresholdSlots);    // bigint
```

### fetchActivity

```typescript
async function fetchActivity(
  connection: Connection,
  programId: PublicKey,
  activityPda: PublicKey,
): Promise<ActivityAccount | null>
```

```typescript
const [actPda] = deriveActivityPda(PROGRAM_ID, vaultPda);
const activity = await fetchActivity(connection, PROGRAM_ID, actPda);
if (activity) {
  console.log(activity.checkinCount);     // bigint
  console.log(activity.sumOfIntervals);   // bigint
  console.log(activity.anomalyFlagged);   // boolean
}
```

### fetchGuardian

```typescript
async function fetchGuardian(
  connection: Connection,
  programId: PublicKey,
  guardianPda: PublicKey,
): Promise<GuardianAccount | null>
```

### fetchCovenant

```typescript
async function fetchCovenant(
  connection: Connection,
  programId: PublicKey,
  covenantPda: PublicKey,
): Promise<CovenantAccount | null>
```

### fetchAllVaultsForOwner

Scans program accounts with a `memcmp` filter at offset 8 (owner field) and `dataSize: 128`. Returns vaults sorted by `vaultIndex` ascending.

```typescript
async function fetchAllVaultsForOwner(
  connection: Connection,
  programId: PublicKey,
  owner: PublicKey,
): Promise<VaultWithAddress[]>
```

```typescript
const vaults = await fetchAllVaultsForOwner(connection, PROGRAM_ID, ownerPublicKey);
for (const { publicKey, account } of vaults) {
  console.log(publicKey, account.vaultIndex);
}
```

### fetchAllGuardiansForVault

Scans program accounts with memcmp filters: vault field at offset 8 and `is_active == true` at offset 72. Returns only active guardians.

```typescript
async function fetchAllGuardiansForVault(
  connection: Connection,
  programId: PublicKey,
  vault: PublicKey,
): Promise<Array<{ publicKey: string; account: GuardianAccount }>>
```

### fetchAllCovenantsForVault

Scans program accounts with memcmp at offset 8 and `dataSize: 432`. Returns all covenants (including executed), sorted by `covenantIndex` ascending.

```typescript
async function fetchAllCovenantsForVault(
  connection: Connection,
  programId: PublicKey,
  vault: PublicKey,
): Promise<Array<{ publicKey: string; account: CovenantAccount }>>
```

## Instruction Builders

All 15 builders return `TransactionInstruction`. They do not sign or submit — callers add the instruction to a `Transaction` and sign with `sendAndConfirmLegacyTx` or their own transaction pipeline.

Instruction discriminators: `sha256("global:snake_case_name")[0..8]`. Account metas must match the Anchor `Accounts` struct field order exactly.

### buildInitializeVaultIx

```typescript
buildInitializeVaultIx({
  programId: PublicKey,
  owner: PublicKey,
  beneficiary: PublicKey,
  vaultIndex: bigint,
  inactivityThresholdSlots: bigint,  // pass 0n for DEFAULT_INACTIVITY_THRESHOLD_SLOTS
}): TransactionInstruction
```

Derives `vaultPda` and `activityPda` internally.

### buildConfigureThresholdIx

```typescript
buildConfigureThresholdIx({
  programId: PublicKey,
  owner: PublicKey,
  vaultPda: PublicKey,
  newThresholdSlots: bigint,
}): TransactionInstruction
```

### buildDepositIx

```typescript
buildDepositIx({
  programId: PublicKey,
  owner: PublicKey,
  vaultPda: PublicKey,
  lamports: bigint,
}): TransactionInstruction
```

### buildCloseVaultIx

```typescript
buildCloseVaultIx({
  programId: PublicKey,
  owner: PublicKey,
  vaultPda: PublicKey,
  activityPda: PublicKey,
}): TransactionInstruction
```

### buildAddGuardianIx

```typescript
buildAddGuardianIx({
  programId: PublicKey,
  owner: PublicKey,
  vaultPda: PublicKey,
  guardian: PublicKey,
  mOfNThreshold: number,
}): TransactionInstruction
```

Derives `guardianAccountPda` internally from `(programId, vaultPda, guardian)`.

### buildRemoveGuardianIx

Handles both Phase 1 (initiate) and Phase 2 (finalise). The program detects the phase from `removal_requested_slot`.

```typescript
buildRemoveGuardianIx({
  programId: PublicKey,
  owner: PublicKey,
  vaultPda: PublicKey,
  guardian: PublicKey,
  guardianAccountPda: PublicKey,
}): TransactionInstruction
```

### buildCreateCovenantIx

```typescript
buildCreateCovenantIx({
  programId: PublicKey,
  guardian: PublicKey,
  vaultPda: PublicKey,
  guardianAccountPda: PublicKey,
  covenantIndex: bigint,        // vault.covenantCounter BEFORE increment
  covenantType: CovenantType,   // CovenantType.EmergencySweep | BeneficiaryChange | GuardianRemoval
  target: PublicKey,            // new beneficiary or guardian to remove; Pubkey.default for EmergencySweep
}): TransactionInstruction
```

Derives `covenantPda` internally.

### buildGuardianSignIx

```typescript
buildGuardianSignIx({
  programId: PublicKey,
  guardian: PublicKey,
  vaultPda: PublicKey,
  guardianAccountPda: PublicKey,
  covenantPda: PublicKey,
}): TransactionInstruction
```

Note: `vault` is read-only for `guardianSign` (not writable in account metas).

### buildExecuteCovenantIx

```typescript
buildExecuteCovenantIx({
  programId: PublicKey,
  caller: PublicKey,
  vaultPda: PublicKey,
  covenantPda: PublicKey,
  targetGuardianPda?: PublicKey,  // required for GuardianRemoval, omit for BeneficiaryChange
}): TransactionInstruction
```

When `targetGuardianPda` is supplied, 4 account metas are included. When omitted, 3 metas. Anchor treats the absence of the optional account as `None`.

### buildCheckInIx

```typescript
buildCheckInIx({
  programId: PublicKey,
  owner: PublicKey,
  vaultPda: PublicKey,
  activityPda: PublicKey,
}): TransactionInstruction
```

`owner` is a read-only signer (isSigner=true, isWritable=false) per the Rust `CheckIn` struct.

### buildAnomalyFlagIx

```typescript
buildAnomalyFlagIx({
  programId: PublicKey,
  guardian: PublicKey,
  vaultPda: PublicKey,
  guardianAccountPda: PublicKey,
  activityPda: PublicKey,
}): TransactionInstruction
```

`guardian` is a read-only signer; `vault` and `guardianAccountPda` are read-only.

### buildTriggerInheritanceIx

```typescript
buildTriggerInheritanceIx({
  programId: PublicKey,
  caller: PublicKey,
  vaultPda: PublicKey,
}): TransactionInstruction
```

**Critical**: only 2 accounts — `caller` and `vault`. The `TriggerInheritance` Rust struct does NOT include an activity account. Supplying a third account causes Anchor client-side validation to fail.

### buildClaimInheritanceIx

```typescript
buildClaimInheritanceIx({
  programId: PublicKey,
  beneficiary: PublicKey,
  vaultPda: PublicKey,
  activityPda: PublicKey,
}): TransactionInstruction
```

### buildEmergencySweepIx

```typescript
buildEmergencySweepIx({
  programId: PublicKey,
  caller: PublicKey,
  vaultPda: PublicKey,
  beneficiary: PublicKey,
  covenantPda: PublicKey,
  activityPda: PublicKey,
}): TransactionInstruction
```

### buildCloseOrphanedCovenantIx

```typescript
buildCloseOrphanedCovenantIx({
  programId: PublicKey,
  caller: PublicKey,
  vaultPda: PublicKey,
  covenantPda: PublicKey,
}): TransactionInstruction
```

`vault` is read-only (only checked for `is_triggered`).

## Transaction Helpers

### sendAndConfirmLegacyTx

```typescript
async function sendAndConfirmLegacyTx(
  connection: Connection,
  wallet: WalletAdapter,
  instructions: TransactionInstruction[],
  options?: SendTxOptions,
): Promise<SendTxResult>
```

`SendTxOptions`:
- `commitment?: "processed" | "confirmed" | "finalized"` (default: "confirmed")
- `timeoutMs?: number` (default: 60,000)
- `skipPreflight?: boolean` (default: false)
- `retry?: Partial<RetryOptions>`

`SendTxResult`: `{ signature: string; slot: number }`

Uses `withRetry` with `isTransientError` predicate. Fetches a fresh blockhash and uses `{ signature, blockhash, lastValidBlockHeight }` confirmation strategy.

### simulateTx

```typescript
async function simulateTx(
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<{ success: boolean; logs: string[] }>
```

Useful for dry-running instructions before submission.

### buildUnsignedTransaction (offline signing, Level 4)

```typescript
async function buildUnsignedTransaction(
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
  commitment?: "processed" | "confirmed" | "finalized",
): Promise<UnsignedTxPayload>
```

Returns `{ txBase64: string; blockhash: string; lastValidBlockHeight: number; feePayer: string }`. The base64 transaction can be exported to an air-gapped hardware wallet via QR code or file.

### deserializeAndSubmitTx (offline signing, Level 4)

```typescript
async function deserializeAndSubmitTx(
  connection: Connection,
  signedBase64: string,
  options?: {
    commitment?: "processed" | "confirmed" | "finalized";
    timeoutMs?: number;
    skipPreflight?: boolean;
    unsignedPayload?: Pick<UnsignedTxPayload, "blockhash" | "lastValidBlockHeight">;
  },
): Promise<SendTxResult>
```

Pass `unsignedPayload` from `buildUnsignedTransaction` to enable blockhash-expiry detection. Without it, the call falls back to the deprecated signature-only confirmation.

## Event Parsers

All 17 event parsers accept a `Buffer` of raw account data (8-byte discriminator + borsh-encoded fields). Each returns a typed `LegacyEvent` object or `null` for discriminator mismatch.

Discriminators: `sha256("event:EventName")[0..8]`.

Field encoding order matches the Rust `#[event]` struct declaration exactly: Pubkeys are 32 bytes, u64 is 8 bytes LE, u8/bool is 1 byte, CovenantType enum is 1 byte (variant index).

### parseLegacyEventFromLog

```typescript
function parseLegacyEventFromLog(log: string): LegacyEvent | null
```

Parses one `"Program data: <base64>"` log line. Returns `null` for non-program-data lines or unknown discriminators.

### parseLegacyEventsFromLogs

```typescript
function parseLegacyEventsFromLogs(logs: string[]): LegacyEvent[]
```

Filters and parses all program data logs from a transaction's log array.

```typescript
const tx = await connection.getTransaction(signature, {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
});
const events = parseLegacyEventsFromLogs(tx?.meta?.logMessages ?? []);
for (const event of events) {
  if (event.name === "InheritanceTriggered") {
    console.log(event.triggeredSlot, event.depositedLamports);
  }
}
```

### Individual Parsers

Each returns `null` for wrong discriminator or insufficient data. None throws.

```typescript
parseVaultInitialisedEvent(data: Buffer): LegacyEvent | null
parseCheckedInEvent(data: Buffer): LegacyEvent | null
parseInheritanceTriggeredEvent(data: Buffer): LegacyEvent | null
parseInheritanceClaimedEvent(data: Buffer): LegacyEvent | null
parseEmergencySweptEvent(data: Buffer): LegacyEvent | null
parseAnomalyFlaggedEvent(data: Buffer): LegacyEvent | null
parseThresholdUpdatedEvent(data: Buffer): LegacyEvent | null
parseDepositedEvent(data: Buffer): LegacyEvent | null
parseVaultClosedEvent(data: Buffer): LegacyEvent | null
parseGuardianAddedEvent(data: Buffer): LegacyEvent | null
parseGuardianRemovalInitiatedEvent(data: Buffer): LegacyEvent | null
parseGuardianRemovedEvent(data: Buffer): LegacyEvent | null
parseCovenantCreatedEvent(data: Buffer): LegacyEvent | null
parseCovenantSignedEvent(data: Buffer): LegacyEvent | null
parseBeneficiaryChangedEvent(data: Buffer): LegacyEvent | null
parseGuardianRemovedByCovenantEvent(data: Buffer): LegacyEvent | null
parseOrphanedCovenantClosedEvent(data: Buffer): LegacyEvent | null
```

## Error Decoder

```typescript
function decodeLegacyError(error: unknown): LegacyErrorInfo | null
```

`LegacyErrorInfo`: `{ code: number; name: string; message: string }`

Handles three error shapes:
1. Anchor 0.30 `AnchorError` with `error.errorCode.number`
2. `SendTransactionError` with `logs` array containing `"custom program error: 0xHHHH"`
3. Error with message containing hex code `0xHHHH` or decimal `custom program error: NNNN`

Returns `null` for non-Legacy-Protocol errors.

```typescript
try {
  await sendAndConfirmLegacyTx(connection, wallet, [ix]);
} catch (err) {
  const decoded = decodeLegacyError(err);
  if (decoded) {
    console.log(decoded.name, decoded.message);  // e.g. "VaultAlreadyTriggered", "The vault has already been triggered..."
  }
}
```

## Math Helpers

All functions use `bigint` exclusively. BigInt is required because Solana slot numbers exceed `Number.MAX_SAFE_INTEGER` (2^53) in production.

The functions mirror `math/activity_score.rs` and `math/threshold_calc.rs` exactly. If they diverge, the watcher fires alerts at the wrong time.

```typescript
// Score = (elapsed × 100) / threshold
computeInactivityScore(
  currentSlot: bigint,
  lastCheckInSlot: bigint,
  inactivityThresholdSlots: bigint,
): bigint

// Returns ActivityZone.Green | Yellow | Orange | Red
classifyZone(score: bigint): ActivityZone

// Returns { warning75Slot, warning90Slot, triggerSlot } — absolute slot numbers
computeMilestones(
  lastCheckInSlot: bigint,
  inactivityThresholdSlots: bigint,
): ThresholdMilestones

// true if current_slot >= last_check_in_slot + threshold
thresholdCrossed(
  currentSlot: bigint,
  lastCheckInSlot: bigint,
  inactivityThresholdSlots: bigint,
): boolean

// true if elapsed > (sum_of_intervals × 150) / checkin_count / 100
isAnomalous(
  currentSlot: bigint,
  lastCheckInSlot: bigint,
  checkinCount: bigint,
  sumOfIntervals: bigint,
): boolean

// Bundles all math for a vault record at a point in time
computeVaultInactivityState(
  vault: Pick<VaultAccount, "lastCheckInSlot" | "inactivityThresholdSlots">,
  currentSlot: bigint,
): VaultInactivityState
```

**Exported constants** (all matching `constants.rs` exactly):

```typescript
DEFAULT_INACTIVITY_THRESHOLD_SLOTS = 5_000_000n
MIN_INACTIVITY_THRESHOLD_SLOTS     = 432_000n
MAX_INACTIVITY_THRESHOLD_SLOTS     = 157_680_000n
GUARDIAN_REMOVAL_TIMELOCK_SLOTS    = 216_000n
BENEFICIARY_CHANGE_TIMELOCK_SLOTS  = 432_000n
EMERGENCY_SWEEP_TIMELOCK_SLOTS     = 0n
GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS = 0n
ANOMALY_MULTIPLIER_PCT             = 150n
WARNING_SLOT_PCT_75                = 75n
WARNING_SLOT_PCT_90                = 90n
MAX_GUARDIANS                      = 10    (number)
MAX_COVENANT_SIGNERS               = 10    (number)
```

## Shamir Integration

The SDK ships a complete GF(256) Shamir Secret Sharing implementation in TypeScript that produces shares interchangeable with the `crates/shamir` Rust crate.

```typescript
import { splitSecret, reconstructSecret, encodeShareBase64, decodeShareBase64, ShamirError } from "@legacy-protocol/sdk";

// Split a secret into 3 shares requiring any 2 to reconstruct
const secret = new TextEncoder().encode("my seed phrase here");
const shares = splitSecret(secret, 2, 3);  // threshold=2, numShares=3

// Encode each share as base64 for distribution
const encoded = shares.map(encodeShareBase64);
// → base64 strings safe for QR codes, NFC tags, text files

// Later: reconstruct from any 2 shares
const decodedShares = [encoded[0], encoded[2]].map(decodeShareBase64);
const reconstructed = reconstructSecret(decodedShares);
const text = new TextDecoder().decode(reconstructed);
```

`splitSecret` uses `globalThis.crypto.getRandomValues` in browser; falls back to Node.js `crypto.randomFillSync`.

`ShamirError` is thrown on: invalid threshold, invalid share count, empty secret, duplicate indices, length mismatch, malformed base64, zero index.

`encodeShareBase64`: first byte is the share index; remaining bytes are the share data. Encoded as standard base64.

`decodeShareBase64`: inverse of encodeShareBase64. Throws `ShamirError` on malformed input or decoded buffer shorter than 2 bytes.

## Complete End-to-End Example

```typescript
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  deriveVaultPda, deriveActivityPda, deriveGuardianPda,
  buildInitializeVaultIx, buildDepositIx, buildAddGuardianIx,
  buildCheckInIx, fetchVault, fetchActivity,
  computeVaultInactivityState, sendAndConfirmLegacyTx,
  ActivityZone,
} from "@legacy-protocol/sdk";

const PROGRAM_ID = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

async function lifecycle(
  walletAdapter: any,  // WalletAdapter from @solana/wallet-adapter-react
  beneficiary: PublicKey,
  guardian: PublicKey,
) {
  const owner = walletAdapter.publicKey!;

  // 1. Derive PDAs
  const [vaultPda]    = deriveVaultPda(PROGRAM_ID, owner, 0n);
  const [activityPda] = deriveActivityPda(PROGRAM_ID, vaultPda);
  const [guardianPda] = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian);

  // 2. Initialize vault with 30-day threshold (≈5,184,000 slots at 2/s)
  const initIx = buildInitializeVaultIx({
    programId: PROGRAM_ID,
    owner,
    beneficiary,
    vaultIndex: 0n,
    inactivityThresholdSlots: 5_184_000n,
  });
  await sendAndConfirmLegacyTx(connection, walletAdapter, [initIx]);

  // 3. Deposit 1 SOL
  const depositIx = buildDepositIx({
    programId: PROGRAM_ID,
    owner,
    vaultPda,
    lamports: 1_000_000_000n,
  });
  await sendAndConfirmLegacyTx(connection, walletAdapter, [depositIx]);

  // 4. Add guardian
  const addGuardianIx = buildAddGuardianIx({
    programId: PROGRAM_ID,
    owner,
    vaultPda,
    guardian,
    mOfNThreshold: 1,
  });
  await sendAndConfirmLegacyTx(connection, walletAdapter, [addGuardianIx]);

  // 5. Check in (resets clock)
  const checkInIx = buildCheckInIx({
    programId: PROGRAM_ID,
    owner,
    vaultPda,
    activityPda,
  });
  await sendAndConfirmLegacyTx(connection, walletAdapter, [checkInIx]);

  // 6. Read state
  const vault       = await fetchVault(connection, PROGRAM_ID, vaultPda);
  const activity    = await fetchActivity(connection, PROGRAM_ID, activityPda);
  const currentSlot = BigInt(await connection.getSlot("confirmed"));
  const state       = computeVaultInactivityState(vault!, currentSlot);

  console.log("Score:", state.score.toString() + "%");
  console.log("Zone:", state.zone);                         // ActivityZone.Green
  console.log("Trigger slot:", state.milestones.triggerSlot.toString());
  console.log("Check-in count:", activity!.checkinCount.toString());
}
```

