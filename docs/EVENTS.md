# Event Reference

All 17 on-chain events emitted by the Legacy Vault program.

**Discriminator format**: `sha256("event:EventName")[0..8]` — 8 bytes.

**Wire format**: `[0..8] discriminator | [8..] borsh-encoded fields` — fields in declaration order, matching the Rust `#[event]` struct. Pubkeys are 32 bytes, u64 is 8-byte LE, u8/bool is 1 byte, CovenantType enum is 1 byte (variant index 0/1/2).

**In logs**: `"Program data: <base64>"` log lines. Parse with `parseLegacyEventsFromLogs(tx.meta.logMessages)`.

**Subscription**: subscribe via `connection.onLogs(programId, callback)` or via Geyser stream and parse all `"Program data:"` lines.

## Primary Lifecycle Events (6)

### VaultInitialised

Emitted by: `initialize_vault`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey (32b) | VaultAccount PDA address |
| owner | Pubkey (32b) | Owner wallet |
| beneficiary | Pubkey (32b) | Beneficiary wallet |
| threshold_slots | u64 (8b) | Configured inactivity threshold in slots |
| created_slot | u64 (8b) | Slot of vault creation |

TypeScript type:
```typescript
interface VaultInitialisedEvent {
  name: "VaultInitialised";
  vault: string;          // base58
  owner: string;          // base58
  beneficiary: string;    // base58
  thresholdSlots: bigint;
  createdSlot: bigint;
}
```

Example:
```typescript
{
  name: "VaultInitialised",
  vault: "7Xk...",
  owner: "9Jm...",
  beneficiary: "4Dn...",
  thresholdSlots: 5000000n,
  createdSlot: 287000000n
}
```

### CheckedIn

Emitted by: `check_in`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey (32b) | VaultAccount PDA |
| owner | Pubkey (32b) | Owner wallet |
| slot | u64 (8b) | Slot of this check-in |
| interval | u64 (8b) | Slots since previous check-in |
| checkin_count | u64 (8b) | Total check-ins after this one |

TypeScript type:
```typescript
interface CheckedInEvent {
  name: "CheckedIn";
  vault: string;
  owner: string;
  slot: bigint;
  interval: bigint;
  checkinCount: bigint;
}
```

### InheritanceTriggered

Emitted by: `trigger_inheritance`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| owner | Pubkey | Owner wallet |
| beneficiary | Pubkey | Beneficiary wallet |
| triggered_slot | u64 | Slot when trigger was called |
| last_check_in_slot | u64 | Owner's last check-in slot |
| deposited_lamports | u64 | Lamports in vault at trigger time |

TypeScript type:
```typescript
interface InheritanceTriggeredEvent {
  name: "InheritanceTriggered";
  vault: string;
  owner: string;
  beneficiary: string;
  triggeredSlot: bigint;
  lastCheckInSlot: bigint;
  depositedLamports: bigint;
}
```

### InheritanceClaimed

Emitted by: `claim_inheritance`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| beneficiary | Pubkey | Beneficiary wallet |
| lamports | u64 | Total lamports transferred (vault balance + activity balance) |
| claimed_slot | u64 | Slot of claim |

TypeScript type:
```typescript
interface InheritanceClaimedEvent {
  name: "InheritanceClaimed";
  vault: string;
  beneficiary: string;
  lamports: bigint;
  claimedSlot: bigint;
}
```

`lamports` = vault PDA lamports + activity PDA lamports at the time of claim, captured before Anchor's close constraints drain them.

### EmergencySwept

Emitted by: `emergency_sweep`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| beneficiary | Pubkey | Beneficiary wallet |
| lamports | u64 | Vault lamports transferred to beneficiary (deposited + vault rent) |
| swept_slot | u64 | Slot of sweep |
| covenant | Pubkey | CovenantAccount PDA that authorised the sweep |

TypeScript type:
```typescript
interface EmergencySweptEvent {
  name: "EmergencySwept";
  vault: string;
  beneficiary: string;
  lamports: bigint;
  sweptSlot: bigint;
  covenant: string;
}
```

Note: `lamports` is the vault PDA balance (deposited lamports + vault rent). Activity and covenant rent go to the caller, not the beneficiary.

### AnomalyFlagged

Emitted by: `anomaly_flag`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| guardian | Pubkey | Guardian who raised the flag |
| flagged_slot | u64 | Slot when flag was raised |
| last_check_in_slot | u64 | Owner's last check-in slot at flag time |
| checkin_count | u64 | Owner's total check-in count at flag time |

TypeScript type:
```typescript
interface AnomalyFlaggedEvent {
  name: "AnomalyFlagged";
  vault: string;
  guardian: string;
  flaggedSlot: bigint;
  lastCheckInSlot: bigint;
  checkinCount: bigint;
}
```

## Secondary State-Change Events (11)

### ThresholdUpdated

Emitted by: `configure_threshold`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| old_threshold | u64 | Previous threshold in slots |
| new_threshold | u64 | New threshold in slots |

### Deposited

Emitted by: `deposit`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| lamports | u64 | Amount deposited this call |
| total | u64 | New deposited_lamports after this call |

### VaultClosed

Emitted by: `close_vault`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| owner | Pubkey | Owner wallet |

### GuardianAdded

Emitted by: `add_guardian`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| guardian | Pubkey | New guardian wallet |
| guardian_count | u8 | New guardian count after addition |
| m_of_n | u8 | New M-of-N threshold |

### GuardianRemovalInitiated

Emitted by: `remove_guardian` Phase 1

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| guardian | Pubkey | Guardian being removed |
| removal_requested_slot | u64 | Slot of Phase 1 call |
| finalise_after_slot | u64 | Earliest slot for Phase 2 (= removal_requested_slot + 216,000) |

### GuardianRemoved

Emitted by: `remove_guardian` Phase 2

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| guardian | Pubkey | Removed guardian wallet |
| guardian_count | u8 | New guardian count after removal |
| m_of_n | u8 | Current M-of-N threshold |
| threshold_lowered | bool | True if threshold was auto-lowered to match new count |

### CovenantCreated

Emitted by: `create_covenant`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| covenant | Pubkey | New CovenantAccount PDA |
| covenant_type | u8 | 0=EmergencySweep, 1=BeneficiaryChange, 2=GuardianRemoval |
| covenant_index | u64 | Index used to derive covenant PDA |
| required_sigs | u8 | Signature threshold (snapshotted from vault.m_of_n_threshold) |
| first_signer | Pubkey | Guardian who created and auto-signed |

### CovenantSigned

Emitted by: `guardian_sign`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| covenant | Pubkey | CovenantAccount PDA |
| guardian | Pubkey | Guardian who signed |
| total_signers | u8 | Total signers after this call |
| required_signers | u8 | Required signatures |
| threshold_reached | bool | True if this signature reached M-of-N |

### BeneficiaryChanged

Emitted by: `execute_covenant` (BeneficiaryChange type)

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| old_beneficiary | Pubkey | Previous beneficiary |
| new_beneficiary | Pubkey | New beneficiary (= covenant.target) |
| covenant | Pubkey | CovenantAccount PDA |
| executed_slot | u64 | Slot of execution |

### GuardianRemovedByCovenant

Emitted by: `execute_covenant` (GuardianRemoval type)

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| guardian | Pubkey | Removed guardian wallet |
| covenant | Pubkey | CovenantAccount PDA |
| guardian_count | u8 | New guardian count after removal |
| m_of_n | u8 | Current M-of-N threshold |
| threshold_lowered | bool | True if threshold was auto-lowered |
| executed_slot | u64 | Slot of execution |

### OrphanedCovenantClosed

Emitted by: `close_orphaned_covenant`

| Field | Type | Description |
|-------|------|-------------|
| vault | Pubkey | VaultAccount PDA |
| covenant | Pubkey | CovenantAccount PDA |
| covenant_index | u64 | Covenant's index |
| covenant_type | u8 | 0=EmergencySweep, 1=BeneficiaryChange, 2=GuardianRemoval |
| caller | Pubkey | Who submitted the close transaction (receives rent) |
| closed_slot | u64 | Slot of close |

## Subscribing to Events

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { parseLegacyEventsFromLogs } from "@legacy-protocol/sdk";

const connection = new Connection("...", "confirmed");
const PROGRAM_ID = new PublicKey("...");

// Subscribe to all program logs
connection.onLogs(PROGRAM_ID, ({ logs, signature }) => {
  const events = parseLegacyEventsFromLogs(logs);
  for (const event of events) {
    switch (event.name) {
      case "InheritanceTriggered":
        console.log("Vault triggered!", event.vault, event.depositedLamports);
        break;
      case "CheckedIn":
        console.log("Owner checked in", event.vault, "at slot", event.slot);
        break;
      case "AnomalyFlagged":
        console.log("Anomaly flagged on", event.vault, "by", event.guardian);
        break;
    }
  }
});
```

Parse from a specific transaction:
```typescript
const tx = await connection.getTransaction(signature, {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
});
const events = parseLegacyEventsFromLogs(tx?.meta?.logMessages ?? []);
```
