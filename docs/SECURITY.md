# Security Model

## Threat Model

Legacy Protocol is designed to protect against the following threats:

| Threat | Mitigated by |
|--------|-------------|
| Owner private key loss (death/incapacitation) | Inactivity threshold → permissionless trigger |
| Premature claim by beneficiary | Threshold must be crossed; is_triggered = false prevents claim |
| Single guardian key compromise | M-of-N requirement; one key cannot execute covenant unilaterally |
| Guardian collusion (fewer than M) | M-of-N threshold prevents sub-threshold coalitions |
| Owner key theft → redirect funds | BeneficiaryChange requires M-of-N + 2-day timelock; owner has time to cancel |
| Owner key theft → remove all guardians | Guardian removal requires 30-hour timelock per guardian; owner notices |
| Active wallet hack | EmergencySweep (zero timelock) can drain vault to beneficiary before attacker acts |
| Frontrunning trigger_inheritance | Trigger is permissionless; any party can submit; on-chain slot count is sole authority |
| Double-claim | is_claimed bool is monotonically true; second claim_inheritance rejected |
| Orphaned covenant rent | close_orphaned_covenant allows anyone to recover stranded rent |
| Watcher or relayer failure | trigger_inheritance is permissionless; no server required for vault to trigger |

## Layer 1 — Program Law

The on-chain Anchor 0.31.1 program is the sole authority over vault funds. All constraints are enforced at the BPF instruction execution level — no network, team, or external key can bypass them.

**What program law enforces**:
- Only declared `owner` can check in, configure threshold, deposit, add/remove guardians, or close vault
- Only declared `beneficiary` can call claim_inheritance
- Only active guardians of the vault can create/sign covenants or flag anomalies
- Funds can only leave the vault via claim_inheritance (to beneficiary) or emergency_sweep (to beneficiary)
- is_triggered, is_claimed, is_emergency_swept are one-way state transitions
- covenant.required_signatures is snapshotted at creation — later threshold changes don't retroactively weaken in-flight covenants
- All arithmetic is checked — overflow panics are impossible
- Zero-signature + zero-timelock covenant bypass is guarded: `signatures_complete_slot > 0` is required

**What program law does NOT protect**:
- Owner colluding with all guardians simultaneously
- Guardian collusion where M or more keys are controlled by one party
- Validator censorship (refusing to include valid transactions)
- Bugs in the program itself (audit status: in progress)

## Layer 2 — Guardian Council

M-of-N guardian signatures are required before any sensitive action executes. The council provides:

**Single-key compromise resistance**: A stolen owner key cannot silently redirect funds — beneficiary change requires M-of-N guardian approval plus a 2-day timelock. A stolen guardian key cannot act alone — M-of-N is required.

**M selection matters**: With M=1, any single guardian key can execute covenants unilaterally. Use M ≥ 2 for any vault with significant value. A 2-of-3 threshold tolerates one compromised or unresponsive guardian.

**Collusion resistance**: The system cannot prevent M or more guardians from colluding to execute an EmergencySweep. Guardian selection is the owner's responsibility. Choose guardians who are geographically distributed, unlikely to know each other personally in a way that enables coordination, and who have independent incentives.

## Layer 3 — Timelocks

Timelocks provide a window during which an operator can observe and cancel suspicious actions.

| Action | Timelock | Cancellable by |
|--------|----------|---------------|
| BeneficiaryChange (covenant) | 432,000 slots (~2 days) | Vault owner can create a new BeneficiaryChange covenant pointing back to the original beneficiary |
| GuardianRemoval (owner path) | 216,000 slots (~30 hours) | Owner can choose not to call Phase 2 |
| GuardianRemoval (covenant path) | 0 | Not cancellable; requires new add_guardian |
| EmergencySweep | 0 | Not cancellable; funds transfer immediately |

The BeneficiaryChange timelock protects against: attacker steals owner key, opens covenant to change beneficiary to attacker's address, gains M-of-N signatures through compromised guardians. The 2-day window allows the owner to detect the attack and call configure_threshold or take other action.

## The Anomaly System

**What it detects**: Statistical deviation from the owner's historical check-in frequency. If the owner normally checks in every 30 days but has been silent for 46 days (1.5× the historical average), a guardian can raise an on-chain flag.

**What it does NOT detect**: Guardian key compromise. If a guardian key is stolen, the attacker can neither trigger inheritance nor access funds — they can only call `anomaly_flag` (which just sets a boolean) or sign covenants (if M-of-N is satisfied with compromised keys). Guardian key compromise requires the guardian council to self-police via a GuardianRemoval covenant.

**Formula**: `elapsed > (sum_of_intervals × 150) / checkin_count / 100`. Requires at least one prior check-in for history to exist.

## Permissionless Instructions

Three instructions can be called by any Solana account:

**trigger_inheritance**: Callable by anyone once `current_slot >= last_check_in_slot + threshold`. The on-chain slot count is the sole authority. No relayer key, guardian signature, or beneficiary permission is required. The watcher's relayer is a convenience — even if it goes offline permanently, a family member with any Solana wallet can trigger manually.

**emergency_sweep**: Callable by anyone once an EmergencySweep covenant has M-of-N signatures. The caller receives the activity and covenant account rent reserves as an incentive.

**close_orphaned_covenant**: Callable by anyone once the vault is triggered. Caller receives the covenant's rent reserve.

These instructions are permissionless intentionally. The invariants that make them safe are enforced by on-chain constraints, not by access control on the calling account.

## Known Limitations

1. **M or more guardian key compromise**: If an attacker compromises M or more guardian keys, they can execute an EmergencySweep and drain the vault to the beneficiary. The owner cannot prevent this.

2. **Beneficiary key loss**: If the beneficiary loses their private key before claiming, the funds are permanently stranded in the claimed-but-unclaimable state. The vault owner can change the beneficiary via a guardian covenant before the vault triggers.

3. **Watcher non-neutrality**: If the watcher operator is malicious and `TRIGGER_SIGNER_SECRET_KEY` is configured, a compromised watcher could send invalid trigger signals. The relayer's Ed25519 verification guards against this when `TRUSTED_TRIGGER_SIGNER_PUBKEY` is configured on the relayer.

4. **Clock manipulation**: The protocol relies on Solana's `Clock::get()?.slot`. Slot timing is controlled by the Solana network; no individual actor controls it.

5. **Program upgradability**: The `upgrade_authority` of the deployed program determines whether it can be upgraded. A malicious upgrade could change program logic. For maximum security, the upgrade authority should be burned after final audit.

## Audit Status

The program has been designed with security as a primary concern. Formal audit is in progress. No audit findings have been resolved publicly yet. Do not deploy to mainnet with significant funds until a clean audit report is available.

## Recommendations for Integrators

**Key custody**: The relayer keypair pays transaction fees but has no authority over funds. Store it in a hot wallet with just enough SOL for fees (~0.1 SOL per 200 trigger transactions). The guardian signing pool keypairs have the same property.

**Threshold selection**: Err on the side of longer thresholds. A 29-day default is appropriate for someone who checks in monthly. Someone with less reliable internet access should use 90+ days.

**Guardian selection**: Prefer 2-of-3 or 3-of-5 configurations. At least one guardian should be an institutional or professional party (lawyer, accountant, notary) who is unlikely to disappear simultaneously with personal guardians.

**Monitoring**: Deploy the watcher with Prometheus scraping and alerting on `watcher_trigger_signals_total`. Any escalation event (`logger.fatal`) should page an on-call operator.
```

