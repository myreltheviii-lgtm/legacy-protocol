# Error Code Reference

All 30 error codes from `errors.rs`. Anchor assigns codes starting at 6000 in declaration order (variant 0 = code 6000, variant 29 = code 6029).

## Reference by Category

### Authorization (6000–6002)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6000 | UnauthorisedOwner | Signer is not the vault's declared owner | Verify the signing wallet matches `vault.owner` | No |
| 6001 | UnauthorisedGuardian | Signer is not an active guardian for this vault; or a guardian-related input (pubkey, PDA) is invalid; or a target pubkey is the zero address where a real pubkey is required | Verify guardian is registered and `is_active = true`; verify PDA seeds; verify target is not `Pubkey::default()` | No |
| 6002 | UnauthorisedBeneficiary | Signer is not the vault's declared beneficiary; or the `beneficiary` account passed to `emergency_sweep` does not match `vault.beneficiary` | Connect the beneficiary wallet; ensure the account passed as `beneficiary` matches the vault record | No |

### Vault State (6003–6007)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6003 | VaultAlreadyTriggered | `vault.is_triggered == true` when an instruction requires the vault to be active (e.g., `check_in`, `configure_threshold`, `emergency_sweep`, `create_covenant` for EmergencySweep/BeneficiaryChange) | Vault is past threshold — proceed to `trigger_inheritance` then `claim_inheritance`, or submit an approved `emergency_sweep` | No |
| 6004 | VaultNotTriggered | `vault.is_triggered == false` when `is_triggered = true` is required (e.g., `claim_inheritance`, `close_orphaned_covenant`) | Wait for the inactivity threshold to cross, then call `trigger_inheritance` first | Yes — after sufficient slots elapse |
| 6005 | VaultAlreadyClaimed | `vault.is_claimed == true` | Vault has been fully claimed; check beneficiary wallet balance | No |
| 6006 | VaultAlreadySwept | `vault.is_emergency_swept == true` | Vault was emergency swept; check beneficiary wallet balance | No |
| 6007 | VaultNotEmpty | `vault.deposited_lamports > 0` when `close_vault` is called | There is no withdrawal instruction — deposited lamports are permanently committed to the vault's inheritance flow. Funds are released only via `claim_inheritance` (after `trigger_inheritance`) or an approved `emergency_sweep` covenant. An owner who wishes to cancel a funded vault must either wait for the inactivity threshold to trigger naturally (then have the beneficiary claim), or coordinate with guardians to open and approve an `EmergencySweep` covenant. | No |

### Threshold / Timing (6008–6010)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6008 | ThresholdTooLow | New threshold < 432,000 slots (~2.5 days) | Increase threshold to ≥ 432,000 slots | No |
| 6009 | ThresholdTooHigh | New threshold > 157,680,000 slots (~2.5 years) | Decrease threshold to ≤ 157,680,000 slots | No |
| 6010 | ThresholdNotReached | (a) `trigger_inheritance`: inactivity threshold not yet crossed — `current_slot < last_check_in_slot + inactivity_threshold_slots`. (b) `anomaly_flag`: current silence does not satisfy `elapsed > (sum_of_intervals × 150) / checkin_count / 100` | (a) Wait for more slots to elapse. (b) The statistical anomaly condition is not yet met — the silence is not unusual relative to the owner's history | Yes — after sufficient slots elapse |

### Guardian Management (6011–6018)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6011 | TooManyGuardians | `vault.guardian_count == 10` (MAX_GUARDIANS) when `add_guardian` is called; also thrown by `guardian_sign` if the signer list would exceed MAX_COVENANT_SIGNERS | Remove an existing guardian before adding a new one | No |
| 6012 | GuardiansStillRegistered | `vault.guardian_count > 0` when `close_vault` is called | Remove all guardians first. Each removal is a two-phase process with a 30-hour timelock (~216,000 slots). The vault cannot be closed until `guardian_count == 0` | No |
| 6013 | GuardianVaultMismatch | `guardian_account.vault ≠ vault.key()` — the guardian PDA supplied does not belong to the vault in the transaction | Supply the correct guardian PDA derived for this vault and guardian pair: `findProgramAddressSync(["guardian", vault, guardian], programId)` | No |
| 6014 | GuardianAlreadyInactive | `guardian.is_active == false` when an instruction requires an active guardian (e.g., `remove_guardian` Phase 2 after the guardian was already deactivated by a concurrent `execute_covenant`) | Guardian has already been removed | No |
| 6015 | NoRemovalPending | Reserved error code — not thrown in the current implementation. The `remove_guardian` instruction routes on `removal_requested_slot == 0` to determine Phase 1 vs Phase 2: if zero, Phase 1 is executed (initiates the timelock); if non-zero, Phase 2 is executed (finalises removal). There is therefore no code path that emits `NoRemovalPending`. Reserved for potential future restructuring. | N/A | N/A |
| 6016 | RemovalTimelockActive | Phase 2 `remove_guardian` called before 216,000 slots have elapsed since Phase 1 | Wait approximately 30 hours (~216,000 slots) after Phase 1, then call Phase 2 | Yes — after 216,000 slots |
| 6017 | ThresholdExceedsGuardianCount | `m_of_n_threshold > new_guardian_count` — the supplied M-of-N value exceeds the number of guardians that will exist after the operation | Lower the threshold parameter to ≤ new guardian count | No |
| 6018 | ThresholdTooSmall | `m_of_n_threshold < 1`; or a guardian removal would leave the vault with zero guardians (checked in both `remove_guardian` phases and `execute_covenant` GuardianRemoval) | Ensure at least one guardian remains; use M-of-N ≥ 1 | No |

### Covenant (6019–6024)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6019 | AlreadySigned | The calling guardian is already in `covenant.signers` | Each guardian may sign a covenant exactly once | No |
| 6020 | CovenantAlreadyExecuted | `covenant.is_executed == true` | Covenant was already applied; check the resulting on-chain state change | No |
| 6021 | InsufficientSignatures | (a) `covenant.signers.len() < covenant.required_signatures`; (b) `covenant.signatures_complete_slot == 0` (M-of-N was never actually reached, which would make the timelock check trivially pass for zero-timelock covenants) | Collect more guardian signatures via `guardian_sign` | Yes — after more sign |
| 6022 | CovenantTimelockActive | Elapsed slots since `signatures_complete_slot` < `covenant.timelock_slots` | Wait for the BeneficiaryChange timelock (~2 days, 432,000 slots) to elapse after M-of-N is reached | Yes — after 432,000 slots |
| 6023 | CovenantTypeMismatch | Wrong instruction for covenant type — `execute_covenant` was called with an EmergencySweep covenant (must use `emergency_sweep`), or `emergency_sweep` was called with a non-EmergencySweep covenant | Use `emergency_sweep` for EmergencySweep covenants; use `execute_covenant` for BeneficiaryChange and GuardianRemoval | No |
| 6024 | CovenantVaultMismatch | `covenant.vault ≠ vault.key()` — the covenant PDA does not belong to the vault in the transaction | Supply the correct covenant PDA: `findProgramAddressSync(["covenant", vault, covenant_index_le_bytes], programId)` | No |

### Anomaly (6025)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6025 | AnomalyAlreadyFlagged | `activity.anomaly_flagged == true` — an anomaly flag is already active | Anomaly already recorded on-chain. The flag clears automatically when the owner successfully calls `check_in`. Do not re-submit. | No |

### Input Validation (6026–6028)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6026 | InvalidBeneficiary | Beneficiary address is `Pubkey::default()` (all zeros) — thrown by `initialize_vault`, `execute_covenant` BeneficiaryChange, and `create_covenant` BeneficiaryChange | Provide a real, non-zero wallet address | No |
| 6027 | ZeroAmount | `lamports == 0` in `deposit` | Deposit a positive lamport amount | No |
| 6028 | SameSlotCheckIn | `current_slot == vault.last_check_in_slot` — the check-in interval is zero, which would corrupt the activity statistical model by adding a zero-length interval to `sum_of_intervals` and incrementing `checkin_count`, pulling the computed average toward zero and tightening the anomaly threshold prematurely | Wait at least one slot and retry | Yes — in next slot |

### Arithmetic (6029)

| Code | Name | Condition | How to Handle | Retryable |
|------|------|-----------|---------------|-----------|
| 6029 | MathOverflow | A `checked_add`, `checked_sub`, or `checked_mul` operation overflowed `u64`. Under normal operating conditions (slot numbers ≤ ~600,000,000, lamports ≤ ~500,000,000 SOL) this cannot occur — `u64::MAX` is approximately 18.4 × 10¹⁸. If encountered, it indicates values near the `u64` boundary, which is pathological input. | Should not occur under normal operation. Indicates values approaching the `u64` boundary. | No |

## SDK Usage

```typescript
import { decodeLegacyError } from "@legacy-protocol/sdk";

try {
  await sendAndConfirmLegacyTx(connection, wallet, [ix]);
} catch (err) {
  const legacyErr = decodeLegacyError(err);
  if (legacyErr) {
    console.error(`Program error ${legacyErr.code}: ${legacyErr.name} — ${legacyErr.message}`);
  }
}
```

`decodeLegacyError` handles three error shapes emitted by Anchor and `@solana/web3.js`:
- `AnchorError` with `error.errorCode.number`
- `SendTransactionError` with logs containing `custom program error: 0xHHHH`
- Raw `Error` with a hex code in the message

All 30 codes (6000–6029) are mapped. Returns `null` for non-program errors.
