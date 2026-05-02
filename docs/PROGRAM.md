# On-Chain Program Reference

Program ID: `7h9BH7d9aHGuPubFc6s9GCYDwtWrFNGB8kKKKV8YaSAe` (replace with deployed address after `anchor deploy`)

Framework: Anchor 0.30.1. Build flags: `overflow-checks = true`, `lto = "fat"`, `codegen-units = 1`.

## Account Layouts

### VaultAccount

Size: 128 bytes. PDA seeds: `["vault", owner_pubkey_bytes, vault_index_le_u64_bytes]`.

| Offset | Size | Field | Type | Description |
|--------|------|-------|------|-------------|
| 0 | 8 | discriminator | [u8; 8] | `sha256("account:VaultAccount")[0..8]` |
| 8 | 32 | owner | Pubkey | Wallet that created this vault and may check in, configure, add guardians, close |
| 40 | 32 | beneficiary | Pubkey | Receives all lamports when vault is triggered and claimed |
| 72 | 1 | guardian_count | u8 | Active registered guardian count |
| 73 | 1 | m_of_n_threshold | u8 | Minimum signatures required for any covenant |
| 74 | 8 | inactivity_threshold_slots | u64 | Slots before trigger becomes callable. Min: 432,000. Max: 157,680,000 |
| 82 | 8 | last_check_in_slot | u64 | Slot of most recent owner check-in; anchor for all inactivity math |
| 90 | 8 | created_slot | u64 | Slot at vault initialisation |
| 98 | 8 | deposited_lamports | u64 | Lamports currently held by the vault PDA |
| 106 | 8 | covenant_counter | u64 | Monotonically increasing; used as covenant PDA seed before increment |
| 114 | 8 | vault_index | u64 | Index used to derive this vault's PDA; allows one owner to hold multiple vaults |
| 122 | 1 | is_triggered | bool | Set by trigger_inheritance; enables claim_inheritance |
| 123 | 1 | is_claimed | bool | Set by claim_inheritance |
| 124 | 1 | is_emergency_swept | bool | Set by emergency_sweep |
| 125 | 1 | warning_75_sent | bool | True when watcher 75% warning has been acknowledged; reset by check_in and configure_threshold |
| 126 | 1 | warning_90_sent | bool | True when watcher 90% warning has been acknowledged; reset by check_in and configure_threshold |
| 127 | 1 | bump | u8 | Canonical PDA bump seed saved at initialisation |

### ActivityAccount

Size: 74 bytes. PDA seeds: `["activity", vault_pubkey_bytes]`.

| Offset | Size | Field | Type | Description |
|--------|------|-------|------|-------------|
| 0 | 8 | discriminator | [u8; 8] | `sha256("account:ActivityAccount")[0..8]` |
| 8 | 32 | vault | Pubkey | The vault this activity record belongs to |
| 40 | 8 | checkin_count | u64 | Total successful check-ins recorded |
| 48 | 8 | sum_of_intervals | u64 | Cumulative sum of all check-in intervals in slots. Dividing by checkin_count gives rolling average |
| 56 | 8 | last_interval | u64 | Interval between the two most recent check-ins |
| 64 | 1 | anomaly_flagged | bool | Set by anomaly_flag; cleared by check_in |
| 65 | 8 | anomaly_flagged_slot | u64 | Slot when most recent anomaly was flagged; 0 if no active flag |
| 73 | 1 | bump | u8 | Canonical PDA bump seed |

### GuardianAccount

Size: 90 bytes. PDA seeds: `["guardian", vault_pubkey_bytes, guardian_pubkey_bytes]`.

| Offset | Size | Field | Type | Description |
|--------|------|-------|------|-------------|
| 0 | 8 | discriminator | [u8; 8] | `sha256("account:GuardianAccount")[0..8]` |
| 8 | 32 | vault | Pubkey | Vault this guardian is registered to |
| 40 | 32 | guardian | Pubkey | Guardian wallet pubkey |
| 72 | 1 | is_active | bool | False once guardian is removed |
| 73 | 8 | added_slot | u64 | Slot when guardian was registered |
| 81 | 8 | removal_requested_slot | u64 | Non-zero when Phase 1 removal is pending; 0 otherwise |
| 89 | 1 | bump | u8 | Canonical PDA bump seed |

### CovenantAccount

Size: 432 bytes. PDA seeds: `["covenant", vault_pubkey_bytes, covenant_index_le_u64_bytes]`.

| Offset | Size | Field | Type | Description |
|--------|------|-------|------|-------------|
| 0 | 8 | discriminator | [u8; 8] | `sha256("account:CovenantAccount")[0..8]` |
| 8 | 32 | vault | Pubkey | Vault this covenant acts upon |
| 40 | 1 | covenant_type | u8 | 0 = EmergencySweep, 1 = BeneficiaryChange, 2 = GuardianRemoval |
| 41 | 32 | target | Pubkey | EmergencySweep: Pubkey::default. BeneficiaryChange: new beneficiary. GuardianRemoval: guardian to remove |
| 73 | 4 | signers length | u32 (LE) | Number of signers in vec |
| 77 | 0–320 | signers | Vec<Pubkey> | Guardians who have signed (max 10) |
| 77+len | 1 | required_signatures | u8 | Snapshot of vault.m_of_n_threshold at creation time |
| +1 | 8 | created_slot | u64 | Slot of covenant creation |
| +8 | 8 | timelock_slots | u64 | Slots to wait after M-of-N before execution is allowed |
| +8 | 8 | signatures_complete_slot | u64 | Slot when M-of-N was reached; 0 until then |
| +8 | 8 | covenant_index | u64 | Monotonic index derived from vault.covenant_counter |
| +8 | 1 | is_executed | bool | True after execution |
| +1 | 1 | bump | u8 | Canonical PDA bump seed |

## PDA Derivations

All seeds encoded as raw bytes. u64 values are 8-byte little-endian (`to_le_bytes()` in Rust, `writeBigUInt64LE()` in TypeScript).

```

VaultAccount:    findProgramAddress(["vault",    owner_pubkey_bytes,   vault_index_le],   program_id)
ActivityAccount: findProgramAddress(["activity", vault_pubkey_bytes],                     program_id)
GuardianAccount: findProgramAddress(["guardian", vault_pubkey_bytes,   guardian_pub_bytes], program_id)
CovenantAccount: findProgramAddress(["covenant", vault_pubkey_bytes,   covenant_index_le], program_id)
```

## Instructions Reference

Anchor instruction discriminator = `sha256("global:snake_case_name")[0..8]`.

| # | Instruction | Authority | Accounts | Events Emitted |
|---|-------------|-----------|----------|---------------|
| 1 | initialize_vault | owner | owner, beneficiary, vault(init), activity(init), system_program | VaultInitialised |
| 2 | configure_threshold | owner | owner, vault | ThresholdUpdated |
| 3 | deposit | owner | owner, vault, system_program | Deposited |
| 4 | close_vault | owner | owner, vault(close→owner), activity(close→owner), system_program | VaultClosed |
| 5 | add_guardian | owner | owner, vault, guardian, guardian_account(init), system_program | GuardianAdded |
| 6 | remove_guardian | owner | owner, vault, guardian, guardian_account | GuardianRemovalInitiated OR GuardianRemoved |
| 7 | create_covenant | guardian | guardian, vault, guardian_account, covenant(init), system_program | CovenantCreated |
| 8 | guardian_sign | guardian | guardian, vault, guardian_account, covenant | CovenantSigned |
| 9 | execute_covenant | anyone | caller, vault, covenant(close→caller), target_guardian(optional) | BeneficiaryChanged OR GuardianRemovedByCovenant |
| 10 | check_in | owner | owner, vault, activity | CheckedIn |
| 11 | anomaly_flag | active guardian | guardian, vault, guardian_account, activity | AnomalyFlagged |
| 12 | trigger_inheritance | anyone | caller, vault | InheritanceTriggered |
| 13 | claim_inheritance | beneficiary | beneficiary, vault(close→beneficiary), activity(close→beneficiary), system_program | InheritanceClaimed |
| 14 | emergency_sweep | anyone | caller, vault(close→beneficiary), beneficiary, covenant(close→caller), activity(close→caller), system_program | EmergencySwept |
| 15 | close_orphaned_covenant | anyone | caller, vault, covenant(close→caller) | OrphanedCovenantClosed |

## Instruction Details

### 1. initialize_vault

Creates VaultAccount and ActivityAccount PDAs for a new vault.

**Parameters**: `vault_index: u64`, `inactivity_threshold_slots: u64` (0 → use DEFAULT_INACTIVITY_THRESHOLD_SLOTS = 5,000,000)

**Constraints**:
- beneficiary ≠ Pubkey::default (error: InvalidBeneficiary)
- threshold ≥ MIN_INACTIVITY_THRESHOLD_SLOTS (432,000) if non-zero, else error ThresholdTooLow
- threshold ≤ MAX_INACTIVITY_THRESHOLD_SLOTS (157,680,000), else error ThresholdTooHigh
- vault PDA is init (fails silently if vault_index already used by same owner)

**Happy path**: vault.last_check_in_slot = vault.created_slot = current clock slot. All boolean flags false. All u64 counters zero.

**Events**: VaultInitialised { vault, owner, beneficiary, threshold_slots, created_slot }

### 2. configure_threshold

Updates vault.inactivity_threshold_slots and resets warning flags.

**Parameters**: `new_threshold_slots: u64`

**Constraints**:
- has_one = owner
- !is_triggered (VaultAlreadyTriggered)
- !is_emergency_swept (VaultAlreadySwept)
- new_threshold_slots ≥ 432,000 (ThresholdTooLow)
- new_threshold_slots ≤ 157,680,000 (ThresholdTooHigh)

**Side effects**: warning_75_sent = false, warning_90_sent = false.

**Events**: ThresholdUpdated { vault, old_threshold, new_threshold }

### 3. deposit

Transfers lamports from owner to vault PDA via System Program CPI.

**Parameters**: `lamports: u64`

**Constraints**:
- has_one = owner
- !is_triggered (VaultAlreadyTriggered)
- !is_emergency_swept (VaultAlreadySwept)
- lamports > 0 (ZeroAmount)

**Side effects**: vault.deposited_lamports += lamports (checked_add, MathOverflow on overflow).

**Events**: Deposited { vault, lamports, total }

### 4. close_vault

Returns all lamports to owner and closes both vault and activity accounts.

**Constraints**:
- has_one = owner
- !is_triggered (VaultAlreadyTriggered)
- !is_emergency_swept (VaultAlreadySwept)
- !is_claimed (VaultAlreadyClaimed)
- deposited_lamports == 0 (VaultNotEmpty)
- guardian_count == 0 (GuardiansStillRegistered)

The guardian_count == 0 requirement is a rent safety guarantee: GuardianAccount PDAs are derived from the vault pubkey. Once the vault account is closed, no instruction can load it to finalise pending guardian removals, permanently stranding their rent.

**Events**: VaultClosed { vault, owner }

### 5. add_guardian

Registers a new guardian and updates M-of-N threshold.

**Parameters**: `m_of_n_threshold: u8`

**Constraints**:
- has_one = owner
- !is_triggered (VaultAlreadyTriggered)
- guardian.key() ≠ owner.key() (UnauthorisedGuardian — self-guardian would unilaterally satisfy M-of-N)
- guardian.key() ≠ Pubkey::default (UnauthorisedGuardian — zero address has no keypair)
- guardian_count < MAX_GUARDIANS (10) (TooManyGuardians)
- m_of_n_threshold ≥ 1 (ThresholdTooSmall)
- m_of_n_threshold ≤ new_guardian_count (ThresholdExceedsGuardianCount)

**Side effects**: guardian_count += 1, m_of_n_threshold = parameter, guardian_account.is_active = true, guardian_account.added_slot = current slot.

**Events**: GuardianAdded { vault, guardian, guardian_count, m_of_n }

### 6. remove_guardian

Two-phase removal with timelock. Phase is determined by guardian_account.removal_requested_slot.

**Phase 1 (removal_requested_slot == 0 — initiate)**:
- requires guardian_count > 1 (ThresholdTooSmall — blocks a dead-end where Phase 2 would always fail)
- sets guardian_account.removal_requested_slot = current slot
- guardian remains active during the timelock window
- events: GuardianRemovalInitiated { vault, guardian, removal_requested_slot, finalise_after_slot }

**Phase 2 (removal_requested_slot > 0 — finalise)**:
- elapsed = current_slot - removal_requested_slot must be ≥ 216,000 (RemovalTimelockActive)
- guardian_count > 1 (ThresholdTooSmall — must have at least one remaining guardian)
- guardian_account.is_active = false, vault.guardian_count -= 1
- if m_of_n_threshold > new guardian_count, threshold is auto-lowered to match
- guardian_account PDA closed via AccountsClose::close → rent returned to owner
- events: GuardianRemoved { vault, guardian, guardian_count, m_of_n, threshold_lowered }

### 7. create_covenant

Opens a multi-guardian approval request. Calling guardian auto-signs as the first signer.

**Parameters**: `covenant_type: CovenantType`, `target: Pubkey`

**Constraints**:
- guardian_account.is_active (UnauthorisedGuardian)
- guardian_account.vault == vault.key() (GuardianVaultMismatch)
- guardian_count > 0 && m_of_n_threshold > 0 (ThresholdTooSmall)
- EmergencySweep: !is_triggered, !is_emergency_swept
- BeneficiaryChange: !is_triggered, target ≠ Pubkey::default (InvalidBeneficiary)
- GuardianRemoval: target ≠ Pubkey::default, !is_triggered

**Timelock assignment**:
- EmergencySweep → 0 slots
- BeneficiaryChange → 432,000 slots
- GuardianRemoval → 0 slots

**Side effects**: vault.covenant_counter += 1 (checked_add). If signers.len() ≥ required_signatures after auto-sign, signatures_complete_slot = current slot.

**Events**: CovenantCreated { vault, covenant, covenant_type, covenant_index, required_sigs, first_signer }

### 8. guardian_sign

Adds a guardian signature to an open covenant.

**Constraints**:
- guardian_account.is_active (UnauthorisedGuardian)
- guardian_account.vault == vault.key() (GuardianVaultMismatch)
- covenant.vault == vault.key() (CovenantVaultMismatch)
- !covenant.is_executed (CovenantAlreadyExecuted)
- !vault.is_triggered (VaultAlreadyTriggered)
- guardian not already in covenant.signers (AlreadySigned)
- covenant.signers.len() < MAX_COVENANT_SIGNERS (10) (TooManyGuardians)

**Side effects**: covenant.signers.push(guardian.key()). If new length ≥ required_signatures and signatures_complete_slot == 0, set signatures_complete_slot = current slot.

**Events**: CovenantSigned { vault, covenant, guardian, total_signers, required_signers, threshold_reached }

### 9. execute_covenant

Executes a BeneficiaryChange or GuardianRemoval covenant after M-of-N and timelock.

**Constraints**:
- !covenant.is_executed (CovenantAlreadyExecuted)
- covenant.vault == vault.key() (CovenantVaultMismatch)
- !vault.is_triggered (VaultAlreadyTriggered — prevents redirecting pending inheritance to attacker wallet)
- !vault.is_emergency_swept (VaultAlreadySwept)
- covenant_type ≠ EmergencySweep (CovenantTypeMismatch)
- signers.len() ≥ required_signatures (InsufficientSignatures)
- signatures_complete_slot > 0 (InsufficientSignatures — guard against zero-signature bypass)
- elapsed (= current_slot - signatures_complete_slot) ≥ timelock_slots (CovenantTimelockActive)

**BeneficiaryChange side effects**: vault.beneficiary = covenant.target. Events: BeneficiaryChanged { vault, old_beneficiary, new_beneficiary, covenant, executed_slot }

**GuardianRemoval side effects**: requires vault.guardian_count > 1. target_guardian.is_active = false, vault.guardian_count -= 1. If m_of_n_threshold > new count, auto-lower threshold. target_guardian account closed → rent to caller. Events: GuardianRemovedByCovenant { vault, guardian, covenant, guardian_count, m_of_n, threshold_lowered, executed_slot }

### 10. check_in

Owner proves they are alive. Resets inactivity clock and clears anomaly state.

**Constraints**:
- has_one = owner
- !is_triggered (VaultAlreadyTriggered)
- interval = current_slot - last_check_in_slot must be > 0 (SameSlotCheckIn — prevents zero-interval check-ins from pulling the anomaly average toward zero)

**Side effects**: activity.sum_of_intervals += interval (checked_add), activity.checkin_count += 1, activity.last_interval = interval, activity.anomaly_flagged = false, activity.anomaly_flagged_slot = 0, vault.last_check_in_slot = current_slot, vault.warning_75_sent = false, vault.warning_90_sent = false.

**Events**: CheckedIn { vault, owner, slot, interval, checkin_count }

### 11. anomaly_flag

Any active guardian may flag unusual owner silence before the hard threshold.

**Constraints**:
- guardian_account.is_active (UnauthorisedGuardian)
- guardian_account.vault == vault.key() (GuardianVaultMismatch)
- !vault.is_triggered (VaultAlreadyTriggered)
- !activity.anomaly_flagged (AnomalyAlreadyFlagged — protects anomaly_flagged_slot integrity)
- is_anomalous(current_slot, last_check_in_slot, checkin_count, sum_of_intervals) must be true (ThresholdNotReached)

`is_anomalous` condition: `elapsed > (sum_of_intervals × 150) / checkin_count / 100`

**Side effects**: activity.anomaly_flagged = true, activity.anomaly_flagged_slot = current slot.

**Events**: AnomalyFlagged { vault, guardian, flagged_slot, last_check_in_slot, checkin_count }

### 12. trigger_inheritance

Permissionless. Anyone may call this once the inactivity threshold has been crossed.

**Constraints**:
- !vault.is_triggered (VaultAlreadyTriggered)
- !vault.is_emergency_swept (VaultAlreadySwept)
- threshold_crossed(current_slot, last_check_in_slot, threshold): current_slot ≥ last_check_in_slot + threshold (ThresholdNotReached)

**Side effects**: vault.is_triggered = true.

**Events**: InheritanceTriggered { vault, owner, beneficiary, triggered_slot, last_check_in_slot, deposited_lamports }

### 13. claim_inheritance

Beneficiary claims all lamports and closes vault + activity accounts.

**Constraints**:
- has_one = beneficiary (UnauthorisedBeneficiary)
- vault.is_triggered (VaultNotTriggered)
- !vault.is_claimed (VaultAlreadyClaimed)
- !vault.is_emergency_swept (VaultAlreadySwept)

**Account closure**: vault and activity accounts are both closed to beneficiary via Anchor's `close = beneficiary` constraint. This atomically zeroes the discriminator, transfers ALL lamports (deposited funds + rent reserves), and lets the runtime garbage-collect both accounts. The beneficiary receives deposited_lamports + vault rent + activity rent.

**Side effects**: vault.is_claimed = true, vault.deposited_lamports = 0.

**Events**: InheritanceClaimed { vault, beneficiary, lamports (vault + activity balance), claimed_slot }

### 14. emergency_sweep

Executes an approved EmergencySweep covenant. Zero timelock.

**Constraints**:
- !vault.is_triggered (VaultAlreadyTriggered)
- !vault.is_emergency_swept (VaultAlreadySwept)
- !covenant.is_executed (CovenantAlreadyExecuted)
- covenant.covenant_type == EmergencySweep (CovenantTypeMismatch)
- covenant.vault == vault.key() (CovenantVaultMismatch)
- beneficiary.key() == vault.beneficiary (UnauthorisedBeneficiary — prevents caller substituting different beneficiary)
- signers.len() ≥ required_signatures (InsufficientSignatures)
- signatures_complete_slot > 0 (InsufficientSignatures — guard against zero-signature with zero timelock)
- if timelock_slots > 0: elapsed ≥ timelock_slots (CovenantTimelockActive) [EmergencySweep has timelock_slots=0 so this branch never executes]

**Account closure**: vault → close to beneficiary, activity → close to caller, covenant → close to caller. Caller receives activity + covenant rent as a submission incentive.

**Side effects**: vault.is_emergency_swept = true, vault.deposited_lamports = 0, covenant.is_executed = true.

**Events**: EmergencySwept { vault, beneficiary, lamports (vault balance), swept_slot, covenant }

### 15. close_orphaned_covenant

Recovers rent from CovenantAccount PDAs permanently frozen by vault trigger.

`execute_covenant` and `emergency_sweep` both gate on `!vault.is_triggered`. Any covenant that exists when the vault is triggered can never be executed. This instruction lets anyone recover the stranded rent.

**Constraints**:
- covenant.vault == vault.key() (CovenantVaultMismatch)
- vault.is_triggered (VaultNotTriggered — only triggered vault covenants are orphaned)
- !covenant.is_executed (CovenantAlreadyExecuted — defence-in-depth)

**Account closure**: covenant → close to caller. Caller receives covenant rent as a submission incentive.

**Events**: OrphanedCovenantClosed { vault, covenant, covenant_index, covenant_type, caller, closed_slot }

## Error Code Reference

Anchor assigns codes starting at 6000 in declaration order.

| Code | Name | Category | Condition | Retryable |
|------|------|----------|-----------|-----------|
| 6000 | UnauthorisedOwner | Authorization | Caller is not vault owner | No |
| 6001 | UnauthorisedGuardian | Authorization | Caller is not active guardian, or invalid guardian pubkey | No |
| 6002 | UnauthorisedBeneficiary | Authorization | Caller is not vault beneficiary | No |
| 6003 | VaultAlreadyTriggered | Vault state | is_triggered == true | No |
| 6004 | VaultNotTriggered | Vault state | is_triggered == false when trigger is required | No |
| 6005 | VaultAlreadyClaimed | Vault state | is_claimed == true | No |
| 6006 | VaultAlreadySwept | Vault state | is_emergency_swept == true | No |
| 6007 | VaultNotEmpty | Vault state | deposited_lamports > 0 when closing | No |
| 6008 | ThresholdTooLow | Threshold | threshold < 432,000 slots | No |
| 6009 | ThresholdTooHigh | Threshold | threshold > 157,680,000 slots | No |
| 6010 | ThresholdNotReached | Threshold | Inactivity threshold not yet crossed, or not anomalous | Retry after time passes |
| 6011 | TooManyGuardians | Guardian | guardian_count == MAX_GUARDIANS (10) | No |
| 6012 | GuardiansStillRegistered | Guardian | guardian_count > 0 when closing vault | No |
| 6013 | GuardianVaultMismatch | Guardian | guardian_account.vault ≠ vault.key() | No |
| 6014 | GuardianAlreadyInactive | Guardian | is_active == false | No |
| 6015 | NoRemovalPending | Guardian | Unused in current remove_guardian implementation | No |
| 6016 | RemovalTimelockActive | Guardian | Phase 2 called before 216,000-slot timelock has elapsed | Retry after slots pass |
| 6017 | ThresholdExceedsGuardianCount | Guardian | m_of_n_threshold > guardian_count | No |
| 6018 | ThresholdTooSmall | Guardian | m_of_n_threshold < 1, or removal would leave vault with zero guardians | No |
| 6019 | AlreadySigned | Covenant | Guardian already in covenant.signers | No |
| 6020 | CovenantAlreadyExecuted | Covenant | is_executed == true | No |
| 6021 | InsufficientSignatures | Covenant | signers.len() < required_signatures, or signatures_complete_slot == 0 | Retry after more sign |
| 6022 | CovenantTimelockActive | Covenant | elapsed < timelock_slots | Retry after slots pass |
| 6023 | CovenantTypeMismatch | Covenant | Wrong instruction for this covenant type | No |
| 6024 | CovenantVaultMismatch | Covenant | covenant.vault ≠ vault.key() | No |
| 6025 | AnomalyAlreadyFlagged | Anomaly | activity.anomaly_flagged == true | No |
| 6026 | InvalidBeneficiary | Input | Beneficiary is Pubkey::default | No |
| 6027 | ZeroAmount | Input | lamports == 0 | No |
| 6028 | SameSlotCheckIn | Input | interval == 0 (same-slot check-in) | Retry in next slot |
| 6029 | MathOverflow | Arithmetic | checked_add / checked_sub / checked_mul overflowed | No |

## Event Reference

Anchor event discriminator = `sha256("event:EventName")[0..8]`. Events appear in transaction logs as `Program data: <base64>`.

| # | Event | Emitted by | Primary fields |
|---|-------|-----------|----------------|
| 1 | VaultInitialised | initialize_vault | vault, owner, beneficiary, threshold_slots, created_slot |
| 2 | CheckedIn | check_in | vault, owner, slot, interval, checkin_count |
| 3 | InheritanceTriggered | trigger_inheritance | vault, owner, beneficiary, triggered_slot, last_check_in_slot, deposited_lamports |
| 4 | InheritanceClaimed | claim_inheritance | vault, beneficiary, lamports, claimed_slot |
| 5 | EmergencySwept | emergency_sweep | vault, beneficiary, lamports, swept_slot, covenant |
| 6 | AnomalyFlagged | anomaly_flag | vault, guardian, flagged_slot, last_check_in_slot, checkin_count |
| 7 | ThresholdUpdated | configure_threshold | vault, old_threshold, new_threshold |
| 8 | Deposited | deposit | vault, lamports, total |
| 9 | VaultClosed | close_vault | vault, owner |
| 10 | GuardianAdded | add_guardian | vault, guardian, guardian_count, m_of_n |
| 11 | GuardianRemovalInitiated | remove_guardian Phase 1 | vault, guardian, removal_requested_slot, finalise_after_slot |
| 12 | GuardianRemoved | remove_guardian Phase 2 | vault, guardian, guardian_count, m_of_n, threshold_lowered |
| 13 | CovenantCreated | create_covenant | vault, covenant, covenant_type, covenant_index, required_sigs, first_signer |
| 14 | CovenantSigned | guardian_sign | vault, covenant, guardian, total_signers, required_signers, threshold_reached |
| 15 | BeneficiaryChanged | execute_covenant | vault, old_beneficiary, new_beneficiary, covenant, executed_slot |
| 16 | GuardianRemovedByCovenant | execute_covenant | vault, guardian, covenant, guardian_count, m_of_n, threshold_lowered, executed_slot |
| 17 | OrphanedCovenantClosed | close_orphaned_covenant | vault, covenant, covenant_index, covenant_type, caller, closed_slot |

## Math Reference

All arithmetic is integer-only. Every operation uses `checked_add`/`checked_sub`/`checked_mul` returning `LegacyError::MathOverflow` on overflow. Multiply before divide throughout to minimise rounding loss.

### compute_inactivity_score

```

score = (elapsed_slots × 100) / threshold_slots
```

- `elapsed_slots = current_slot - last_check_in_slot`
- Returns 0 if `current_slot ≤ last_check_in_slot` (clock regression) or `threshold_slots == 0`
- Multiply by 100 before dividing to preserve integer precision

Worked examples (threshold = 5,000,000):

| elapsed | score |
|---------|-------|
| 0 | 0 |
| 2,500,000 | 50 |
| 3,750,000 | 75 |
| 4,500,000 | 90 |
| 5,000,000 | 100 |
| 7,500,000 | 150 |

### classify_zone

```
score < 75        → Green
75 ≤ score < 90   → Yellow
90 ≤ score < 100  → Orange
score ≥ 100       → Red
```

### compute_milestones

```
warning_75_slot = last_check_in_slot + (threshold × 75) / 100
warning_90_slot = last_check_in_slot + (threshold × 90) / 100
trigger_slot    = last_check_in_slot + threshold
```

All values are absolute slot numbers.

### is_anomalous

```

anomaly_threshold = (sum_of_intervals × 150) / checkin_count / 100
is_anomalous = elapsed > anomaly_threshold
```

Returns false if `checkin_count == 0` or `sum_of_intervals == 0` (no history). Multiply `sum × 150` first, then divide by `checkin_count`, then divide by 100. Dividing by `checkin_count` first (computing the average before applying the multiplier) introduces negative bias.

Worked example: checkin_count=3, sum_of_intervals=3,000 (average interval = 1,000 slots). anomaly_threshold = (3,000 × 150) / 3 / 100 = 1,500. elapsed > 1,500 → anomalous.

### threshold_crossed

```
trigger_slot = last_check_in_slot + inactivity_threshold_slots
crossed = current_slot >= trigger_slot
```

## Security Invariants

The program guarantees:

1. Only the declared `owner` can check_in, configure_threshold, deposit, add_guardian, initiate remove_guardian, or close_vault.
2. Only the declared `beneficiary` can claim_inheritance.
3. Only active guardians of the vault can create_covenant, guardian_sign, or anomaly_flag.
4. trigger_inheritance is callable by anyone once `current_slot >= last_check_in_slot + threshold`.
5. emergency_sweep, execute_covenant, trigger_inheritance, close_orphaned_covenant are callable by anyone with the correct preconditions.
6. The vault's lamports can only move in three ways: deposit (in, from owner), claim_inheritance (out, to beneficiary), emergency_sweep (out, to beneficiary).
7. is_triggered, is_claimed, and is_emergency_swept are monotonically true — they are never reset to false.
8. covenant.required_signatures is snapshotted at creation from vault.m_of_n_threshold. A later threshold change does not retroactively weaken an in-flight covenant.
9. A zero signatures_complete_slot combined with zero timelock cannot bypass execution checks (explicit guard in both execute_covenant and emergency_sweep).
10. All arithmetic is checked; no overflow panic path exists.

The program does NOT guarantee: protection against guardian key compromise, protection against owner+all guardians collusion, protection against validator censorship of transactions.

## Slot-to-Time Conversions

Solana mainnet produces approximately 2 slots per second. All values are approximate.

| Constant | Slots | Human Time |
|----------|-------|-----------|
| MIN_INACTIVITY_THRESHOLD_SLOTS | 432,000 | ~2 days |
| DEFAULT_INACTIVITY_THRESHOLD_SLOTS | 5,000,000 | ~29 days |
| MAX_INACTIVITY_THRESHOLD_SLOTS | 157,680,000 | ~2.5 years |
| GUARDIAN_REMOVAL_TIMELOCK_SLOTS (owner path) | 216,000 | ~30 hours |
| BENEFICIARY_CHANGE_TIMELOCK_SLOTS | 432,000 | ~2 days |
| EMERGENCY_SWEEP_TIMELOCK_SLOTS | 0 | immediate |
| GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS | 0 | immediate |
```

