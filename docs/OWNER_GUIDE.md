# Owner Guide

## Creating Your Vault

A vault is a Program Derived Address (PDA) controlled entirely by the Legacy Vault program. You cannot lose access to it — there is no password to forget. You maintain control via your Solana wallet's private key.

**Steps**:
1. Connect your wallet to the Legacy Protocol app.
2. Navigate to "My Vaults" and your vault creation interface will be available.
3. Enter your beneficiary's Solana wallet address.
4. Set your inactivity threshold (see table below for guidance).
5. Confirm the transaction. The vault and activity accounts are created.

You can create multiple vaults by incrementing the vault index. Each vault has an independent beneficiary, threshold, guardian council, and balance.

## Configuring Your Threshold

The threshold is the number of slots of silence before your vault becomes triggerable. The protocol uses ~2 slots/second.

| Threshold (slots) | Human Time | Notes |
|-------------------|-----------|-------|
| 432,000 | ~2 days | Protocol minimum. Only appropriate if you check in daily |
| 864,000 | ~5 days | Very frequent check-in required |
| 2,592,000 | ~15 days | Moderate vigilance required |
| 5,000,000 | ~29 days | Protocol default. Good for monthly check-ins |
| 10,000,000 | ~58 days | ~2 months. Low check-in frequency |
| 30,240,000 | ~6 months | Low check-in frequency |
| 60,480,000 | ~1 year | Annual check-in sufficient |
| 157,680,000 | ~2.5 years | Protocol maximum |

Choose a threshold that is **longer than your longest expected period of inactivity**. If you travel for months at a time, 29 days is too short.

You can change the threshold at any time via `configure_threshold`. Changing it resets the 75% and 90% warning flags.

## Depositing

Any amount of SOL can be deposited. The vault tracks `deposited_lamports` separately from rent reserves. When the beneficiary claims, they receive deposited lamports + vault rent + activity account rent.

You can deposit multiple times. The balance accumulates.

You cannot deposit to a triggered or swept vault.

## Check-In

Check-in (`check_in`) resets the inactivity clock to the current slot. It also clears any active anomaly flag and resets the 75%/90% warning flags.

**Why regularity matters**: The watcher computes your average check-in interval from the `ActivityAccount`. If you normally check in every 30 days but go silent for 46 days (1.5× average), the anomaly detector flags it early. Consistent check-in intervals make the anomaly detector accurate.

A check-in in the same slot as the previous check-in is rejected (`SameSlotCheckIn`). Each check-in must occur in a different slot.

## Understanding Your Inactivity Score

The score is `(elapsed_slots × 100) / threshold_slots`. It represents how far you are through your configured threshold window.

| Score | Zone | What happens |
|-------|------|-------------|
| 0–74% | 🟢 Green | Silent monitoring |
| 75–89% | 🟡 Yellow | Your guardians are pinged |
| 90–99% | 🟠 Orange | Your beneficiary is warned and given a claim link |
| ≥ 100% | 🔴 Red | Anyone can call trigger_inheritance |

After trigger_inheritance is called, your beneficiary can call claim_inheritance to receive all vault funds.

## Managing Guardians

**Adding a guardian**: Call `add_guardian` with the guardian's wallet address and the new M-of-N threshold. You cannot add yourself as a guardian (a self-guardian unilaterally satisfies M-of-N). You cannot add the zero address.

Maximum 10 guardians per vault.

**Removing a guardian** (owner path, 2 phases):
1. **Phase 1**: Call `remove_guardian`. The guardian's `removal_requested_slot` is set. The guardian remains active during the 30-hour (~216,000 slot) timelock.
2. **Phase 2**: After 216,000 slots, call `remove_guardian` again. The guardian is deactivated and their account is closed, returning rent to you.

**Removing via covenant** (M-of-N guardian path): If you do not have access to your wallet or prefer the guardian council to handle it, guardians can open a GuardianRemoval covenant. This executes immediately after M-of-N signatures.

**M-of-N recommendation**: Use at least 2-of-3. A 1-of-1 means a single compromised guardian key can execute any covenant unilaterally. A 3-of-5 provides strong fault tolerance.

## Covenant Types

| Covenant | When to create | Timelock after M-of-N |
|----------|---------------|----------------------|
| EmergencySweep | Wallet actively compromised; need to drain vault immediately | 0 — immediate |
| BeneficiaryChange | Need to update the beneficiary address | 432,000 slots (~2 days) |
| GuardianRemoval | Need to remove a compromised guardian without owner signature | 0 — immediate |

You cannot create covenants (only guardians can). You can observe active covenants and their signing status in the vault dashboard's covenant queue section.

## Closing Your Vault

You can close a vault and recover all lamports if:
1. `deposited_lamports == 0` — withdraw any deposits first (not currently possible via a withdrawal instruction; deposits are one-way). For the current protocol, closing requires the vault balance to be zero.
2. `guardian_count == 0` — remove all guardians first (2 phases per guardian).
3. `is_triggered == false` — the vault must not have been triggered.

The vault and activity accounts are closed and all rent reserves return to you.

## What Happens After You Die

1. You stop checking in.
2. At 75%: your guardians are automatically pinged.
3. At 90%: your beneficiary receives a warning and a direct claim link.
4. At 100%: anyone — the watcher's relayer, a family member, a stranger — can call `trigger_inheritance`. No permission required.
5. Once `is_triggered == true`, your beneficiary calls `claim_inheritance` from any Blink-compatible wallet using the claim URL, or directly via the app.
6. All deposited SOL plus account rent reserves transfer to your beneficiary in a single transaction.

## Security Recommendations

**Threshold**: Choose a threshold longer than your longest expected period of inactivity with a comfortable margin. If you ever plan to be offline for 6 months, use at least a 6-month threshold.

**Guardian count**: Use at least 3 guardians with a 2-of-3 threshold. This tolerates one unresponsive or compromised guardian.

**M-of-N ratio**: Never use 1-of-N for large vaults. A single compromised guardian key can execute an EmergencySweep at any time.

**Guardian selection**: Choose guardians who are: (a) technically capable of signing a Solana transaction, (b) unlikely to collude, (c) reachable when needed, (d) geographically distributed.

**Regular check-ins**: Check in on a consistent schedule. Irregular intervals make the anomaly detector less accurate and may cause false positives.

**Monitor your score**: Periodically view your vault's inactivity score. If you are approaching Yellow zone unexpectedly, check in immediately.

**Share vault address**: Give your beneficiary your vault PDA address and the Legacy Protocol app URL. Without this, they may not know where to look after your threshold is crossed.
```

