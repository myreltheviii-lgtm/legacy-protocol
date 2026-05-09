// instructions/record_cloak_claim.rs
//
// Finalises a shielded inheritance after guardians have already executed the
// Cloak shield-to-shield transfer off-chain. This instruction:
//   1. Verifies the vault is triggered and not yet claimed.
//   2. Sets is_claimed = true.
//   3. Closes the vault PDA and activity PDA, returning rent to the caller.
//   4. Emits an on-chain audit record including the Cloak transfer signature.
//
// Why permissionless?
//   The actual SOL has already moved through Cloak — it is in the beneficiary's
//   shielded UTXO. This instruction is purely administrative closure. Anyone
//   with the cloak_transfer_signature (which guardians compute and publish) can
//   call it. Making it permissionless removes the guardian coordination burden
//   of also submitting an Anchor transaction. The caller receives both account
//   rent reserves as a submission incentive.
//
// Security: even if a malicious caller supplies a fake signature, no SOL is
// moved by this instruction — the Cloak transfer already completed. The
// signature is stored purely for audit trail purposes.

use anchor_lang::prelude::*;
use crate::constants::{ACTIVITY_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{ActivityAccount, VaultAccount};

#[derive(Accounts)]
pub struct RecordCloakClaim<'info> {
    /// Receives rent from vault + activity account closure.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump  = vault.bump,
        close = caller,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [ACTIVITY_SEED, vault.key().as_ref()],
        bump  = activity.bump,
        close = caller,
    )]
    pub activity: Account<'info, ActivityAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RecordCloakClaim>,
    cloak_transfer_signature: [u8; 64],
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    require!(vault.is_triggered,        LegacyError::VaultNotTriggered);
    require!(!vault.is_claimed,          LegacyError::VaultAlreadyClaimed);
    require!(!vault.is_emergency_swept,  LegacyError::VaultAlreadySwept);

    // Vault must have a shielded deposit recorded — otherwise use
    // claim_inheritance instead. CovenantTypeMismatch is the correct error
    // here: the caller has invoked the wrong instruction type for this vault's
    // mode. Using ZeroAmount was semantically incorrect and confusing.
    require!(vault.is_shielded(), LegacyError::CovenantTypeMismatch);

    // Capture values before the `close` constraint zeroes the account.
    let vault_pubkey            = vault.key();
    let beneficiary_utxo_pubkey = vault.beneficiary_utxo_pubkey;
    let deposited_lamports      = vault.deposited_lamports;

    vault.is_claimed         = true;
    vault.deposited_lamports = 0;

    emit!(InheritanceCloakClaimed {
        vault:                   vault_pubkey,
        beneficiary_utxo_pubkey,
        lamports:                deposited_lamports,
        cloak_transfer_signature,
        claimed_slot:            clock.slot,
    });

    Ok(())
}

#[event]
pub struct InheritanceCloakClaimed {
    pub vault: Pubkey,
    /// Raw 32-byte Cloak UTXO public key of the beneficiary.
    /// This is not a Solana address — it identifies the beneficiary's
    /// shielded identity within Cloak's circuit.
    pub beneficiary_utxo_pubkey: [u8; 32],
    /// Declared lamports transferred (not verifiable on-chain — SOL moved
    /// through Cloak's shielded pool, not through this program).
    pub lamports:                u64,
    /// Solana transaction signature of the Cloak shield-to-shield transfer.
    /// Allows any auditor to verify the shielded transfer occurred without
    /// revealing amounts or counterparty identities.
    pub cloak_transfer_signature: [u8; 64],
    pub claimed_slot:             u64,
}
