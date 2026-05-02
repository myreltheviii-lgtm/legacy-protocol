# Guardian Guide

## What Is a Guardian?

A guardian is a trusted party — a family member, lawyer, close friend, or institution — that the vault owner has registered on-chain to participate in the vault's multi-signature council. You cannot access the vault's funds on your own. Your role is to act collectively with other guardians when something unusual is happening.

Guardians provide three protections:
1. **Early warning**: You receive an alert when the owner has been silent for 75% of their configured threshold. This gives you time to try to reach them before the vault triggers.
2. **Emergency protection**: If the owner's wallet is actively being hacked, M-of-N guardians can drain the vault to the beneficiary immediately, leaving the attacker with nothing.
3. **Governance**: If a guardian key is compromised, the other guardians can remove it. If the beneficiary address needs to change, guardians collectively approve the change.

## Your Responsibilities

**Monitor your vault alerts**: When you receive a guardian ping, attempt to contact the vault owner through personal channels (phone, email, in-person). The vault has not yet triggered — there may still be time for the owner to check in.

**Flag anomalies promptly**: If the owner's silence is unusual given their historical check-in frequency, you can raise an on-chain anomaly flag before the hard threshold is crossed. This creates an on-chain record and may trigger earlier outreach.

**Participate in covenants**: When an EmergencySweep, BeneficiaryChange, or GuardianRemoval covenant is created, you will need to sign it if your signature is part of the required M-of-N.

**Protect your private key**: Your guardian keypair is as important as the vault owner's key. If it is compromised, the attacker could sign covenants. Keep it in cold storage or a hardware wallet.

## Connecting Your Wallet

1. Navigate to the Legacy Protocol app at the URL provided by the vault owner.
2. Click "Connect Wallet" and select your wallet (Phantom, Solflare, or any Solana wallet adapter-compatible wallet).
3. Navigate to the "Guardian" page from the top navigation.
4. The dashboard will scan for all vault PDAs where your wallet is registered as an active guardian.
5. Vaults are sorted by inactivity score (most urgent first).

## How to Flag an Anomaly

An anomaly flag signals unusual owner silence relative to their historical check-in patterns. It does not trigger the vault — it creates an on-chain record and alerts the system before the hard threshold is reached.

You can flag an anomaly only when the on-chain program's `is_anomalous()` condition is true: the current silence exceeds 1.5× the owner's historical average check-in interval.

**Steps**:
1. Open the vault in the guardian dashboard.
2. In the "Anomaly Flag" section, click "Flag Anomaly".
3. Confirm the transaction in your wallet.
4. The flag is set on-chain. It clears automatically when the owner checks in.

If the button says "Flag Anomaly" but the transaction fails with `ThresholdNotReached`, the current silence is not yet statistically anomalous. Try again later or wait for the 75% guardian ping alert.

## How to Create a Covenant

A covenant is a multi-signature proposal. Any guardian can open one; the others sign it.

**Steps**:
1. Open the vault. In the "Create Covenant" section, select the covenant type:
   - **Emergency Sweep**: Use this when the owner's wallet is actively compromised. Requires M-of-N signatures. Zero timelock — executes immediately.
   - **Change Beneficiary**: Requires M-of-N signatures plus a 2-day timelock after the last required signature.
   - **Remove Guardian**: Requires M-of-N signatures. Zero timelock — executes immediately.
2. For BeneficiaryChange and GuardianRemoval, enter the target address.
3. Confirm the transaction. You are automatically the first signer.
4. Share the vault address with other guardians and ask them to sign.

## How to Sign a Covenant

When another guardian creates a covenant, it appears in the "Signing Queue" on the vault page.

1. Open the vault.
2. In the Signing Queue, find the open covenant.
3. Verify the covenant type and target.
4. Click "Sign" and confirm the transaction.

Once the required number of signatures is collected, the `threshold_reached` badge appears. For EmergencySweep covenants, the sweep becomes executable immediately. For BeneficiaryChange, wait for the 2-day timelock to elapse.

## The Guardian Removal Process

There are two ways a guardian can be removed:

**Via the vault owner** (2-phase, 30-hour timelock): The owner initiates removal (Phase 1). After 216,000 slots (~30 hours), the owner finalises it (Phase 2). This timelock gives the owner time to notice if their key was stolen and is being used to strip guardians.

**Via covenant** (M-of-N, immediate): The guardian council creates a GuardianRemoval covenant, collects M-of-N signatures, and executes it immediately. Used to remove a compromised guardian without the owner's key.

## Emergency Sweep: When to Use It

Use emergency_sweep only when you have direct evidence that the owner's wallet has been compromised and an attacker is in the process of moving assets. This is an irreversible action that:
- Drains all vault funds to the beneficiary immediately
- Bypasses the inactivity threshold entirely
- Cannot be undone once executed

**Do not use emergency_sweep** because the owner has been unresponsive — that is handled by the normal inactivity threshold and trigger_inheritance flow.

**What happens after the sweep**: The vault and activity accounts are closed. The beneficiary receives the deposited lamports plus vault and activity rent reserves. The vault is permanently ended.

## What Happens When the Vault Owner Returns

If the owner checks in after an anomaly flag was raised, the flag clears automatically. If the owner checks in before the vault triggers, all warning flags reset and the inactivity clock starts over. The guardian council remains in place and active.

## FAQ

**Can I see how much is in the vault?** Yes. The vault's current balance is visible on the vault detail page in the guardian dashboard.

**Can I withdraw funds from the vault?** No. Only the owner can deposit; only the beneficiary can claim; only an EmergencySweep covenant can move funds early.

**What if I lose my guardian private key?** Contact the vault owner. They can initiate a guardian removal and add a new guardian with your new key. If the removal timelock is a concern (because the owner's key may be compromised), you and other guardians can open a GuardianRemoval covenant.

**Does the guardian ping mean the vault has triggered?** No. At 75%, the vault has not triggered. At 90%, the beneficiary is warned. At 100%, anyone can call trigger_inheritance. Guardian ping at 75% is an early warning to try to reach the owner.

**How many guardians can a vault have?** Maximum 10. The owner sets the M-of-N threshold when adding guardians.

**What happens if fewer than M guardians are reachable?** The guardian council is unable to execute any covenant requiring M signatures. This is why threshold and guardian selection are critical security decisions. Owners should maintain redundancy.
```

