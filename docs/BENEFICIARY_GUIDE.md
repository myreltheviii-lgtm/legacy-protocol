# Beneficiary Guide

## What Legacy Protocol Does for You

You have been designated as the beneficiary of a Legacy Protocol vault. This means when the vault owner has been inactive for longer than their configured threshold, all SOL in the vault automatically becomes claimable by you — and only you.

No lawyer is required. No probate. No lost keys. Once the vault triggers, you can claim the funds yourself in a single transaction.

## How to Check if a Vault Has Been Triggered

You need the vault's PDA address. Ask the vault owner for this address in advance, or check any notification you received from the Legacy Protocol watcher.

**In the app**:
1. Navigate to the "Claim" page.
2. Connect your wallet (must be the beneficiary wallet).
3. Paste the vault address in the lookup field and click "Look up".
4. The vault status will show either "Triggered — claimable" or "Not yet triggered".

**Programmatically**:
```typescript
const vault = await fetchVault(connection, PROGRAM_ID, vaultPda);
if (vault?.isTriggered) {
  console.log("Ready to claim:", vault.depositedLamports, "lamports");
}
```

## How to Claim Inheritance

Claiming is only possible after someone has called `trigger_inheritance`. The vault must be in the "triggered" state.

**Step by step in the app**:
1. Navigate to the "Claim" page.
2. Connect the **beneficiary wallet** (the wallet the owner designated — not just any wallet).
3. Paste the vault address.
4. Click "Look up". If the vault is triggered, a "Claim" button appears.
5. Click "Claim". Confirm the transaction in your wallet.
6. The vault and activity accounts are closed. All SOL (deposited funds + rent reserves from both accounts) transfers to your wallet in a single transaction.

**Via Blink** (if you received a claim URL): Open the URL in any Blink-compatible wallet (Phantom, Backpack, etc.). The wallet will prompt you to sign a transaction. Sign it to claim.

## What You Receive

When you claim, you receive:
- All SOL the owner deposited into the vault (`deposited_lamports`)
- The rent reserve from the VaultAccount (128 bytes at the rent-exempt minimum)
- The rent reserve from the ActivityAccount (74 bytes at the rent-exempt minimum)

The total is slightly more than the deposited amount because the rent reserves are also transferred to you.

## Emergency Sweep

An emergency sweep is a different path to receiving vault funds. If the owner's wallet was actively compromised, their guardian council can execute an EmergencySweep covenant immediately — before the inactivity threshold is crossed.

After an emergency sweep:
- The vault, activity, and covenant accounts are all closed.
- Vault funds (deposited SOL + vault rent) go to you (the beneficiary).
- Activity and covenant rent go to whoever submitted the transaction.
- `vault.is_emergency_swept == true` — `claim_inheritance` is no longer callable.

If you see `vault.isEmergencySwept == true`, the funds have already been sent to your wallet via the sweep transaction. Check your wallet balance.

## What to Do if the Vault Is Triggered but Not Claimable

**Already claimed** (`vault.isClaimed == true`): Someone else claiming the same vault is impossible because `claim_inheritance` requires the signer to be the beneficiary (`has_one = beneficiary`). If the vault is claimed and you did not do it, verify you are using the correct wallet.

**Already swept** (`vault.isEmergencySwept == true`): The guardian council executed an emergency sweep. Check your wallet balance — the funds should already be there.

**Vault address wrong**: Verify the vault address with the owner or through the notification you received.

## How to Trigger the Vault Yourself

If the threshold has been crossed but `trigger_inheritance` has not been called yet, you can call it yourself:

```typescript
const ix = buildTriggerInheritanceIx({
  programId: PROGRAM_ID,
  caller: yourPublicKey,
  vaultPda: vaultPda,
});
await sendAndConfirmLegacyTx(connection, walletAdapter, [ix]);
```

Or click "Trigger Inheritance" on the vault detail page. After triggering, you can immediately claim.

## Contacting the Vault Owner Before Claiming

If you have received an alert that the vault is approaching its threshold, consider trying to contact the owner through personal channels before the threshold is reached. The vault owner may simply be traveling or offline. A check-in from them resets the clock completely.

Legacy Protocol is designed for genuine inheritance situations — not as a way to claim funds from a living owner who is temporarily unreachable.

## FAQ

**Can I claim before the vault is triggered?** No. The on-chain program enforces `vault.is_triggered == true` before allowing any claim.

**Can someone else claim instead of me?** No. `claim_inheritance` uses Anchor's `has_one = beneficiary` constraint, which rejects any signer other than the vault's designated beneficiary address.

**What if I lose access to my beneficiary wallet?** Unfortunately, without the beneficiary private key, the funds cannot be claimed. Consider keeping your beneficiary wallet's seed phrase in secure offline storage. The vault owner can also change the beneficiary address via a guardian BeneficiaryChange covenant.

**Are there any fees?** You pay only the Solana transaction fee (a few thousand lamports) to submit the `claim_inheritance` transaction. No percentage is taken by Legacy Protocol.

**How long does it take?** The `claim_inheritance` transaction confirms in the usual Solana time (~1–5 seconds for confirmed commitment). Once it confirms, the SOL is in your wallet.

**What if the vault was claimed while I was unaware?** If you believe you are the legitimate beneficiary and the vault was claimed by someone else, this would indicate the vault was assigned a different beneficiary address. Contact the vault owner or their estate administrator to verify the vault's beneficiary address.
