// instructions/claim_inheritance.rs
//
// The beneficiary calls this instruction after `trigger_inheritance` has
// flipped `vault.is_triggered`. It transfers all lamports from the vault
// PDA to the beneficiary's wallet, then closes both the vault and activity
// accounts.
//
// This instruction is for NON-SHIELDED vaults (legacy mode) where the
// beneficiary is a standard Solana wallet. For Cloak-shielded vaults,
// guardians call `record_cloak_claim` after completing the Cloak
// shield-to-shield transfer off-chain.
//
// Identity verification:
//   vault.beneficiary_utxo_pubkey stores 32 raw bytes. For non-shielded
//   vaults these bytes ARE the beneficiary's Solana pubkey. We reconstruct
//   the Pubkey via Pubkey::from() and compare explicitly rather than using
//   Anchor's `has_one` macro (which requires a Pubkey-typed field).

use anchor_lang::prelude::*;
use crate::constants::{ACTIVITY_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{ActivityAccount, VaultAccount};

#[derive(Accounts)]
pub struct ClaimInheritance<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds  = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump   = vault.bump,
        close  = beneficiary,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [ACTIVITY_SEED, vault.key().as_ref()],
        bump  = activity.bump,
        close = beneficiary,
    )]
    pub activity: Account<'info, ActivityAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimInheritance>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(vault.is_triggered,        LegacyError::VaultNotTriggered);
    require!(!vault.is_claimed,          LegacyError::VaultAlreadyClaimed);
    require!(!vault.is_emergency_swept,  LegacyError::VaultAlreadySwept);

    // For shielded vaults, use record_cloak_claim instead. Calling
    // claim_inheritance on a shielded vault would close the Anchor accounts
    // without having executed the Cloak transfer, permanently losing the
    // utxo_commitment reference needed by guardians.
    require!(!vault.is_shielded(), LegacyError::CovenantTypeMismatch);

    // Identity check: reconstruct the Pubkey from raw bytes and compare.
    // For non-shielded vaults, beneficiary_utxo_pubkey holds the Solana
    // wallet pubkey bytes stored by initialize_vault.
    let expected_beneficiary = Pubkey::from(vault.beneficiary_utxo_pubkey);
    require_keys_eq!(
        ctx.accounts.beneficiary.key(),
        expected_beneficiary,
        LegacyError::UnauthorisedBeneficiary
    );

    let vault_lamports    = vault.to_account_info().lamports();
    let activity_lamports = ctx.accounts.activity.to_account_info().lamports();
    let total_lamports    = vault_lamports
        .checked_add(activity_lamports)
        .ok_or(LegacyError::MathOverflow)?;

    vault.is_claimed         = true;
    vault.deposited_lamports = 0;

    emit!(InheritanceClaimed {
        vault:       vault.key(),
        beneficiary: ctx.accounts.beneficiary.key(),
        lamports:    total_lamports,
        claimed_slot: Clock::get()?.slot,
    });

    Ok(())
}

#[event]
pub struct InheritanceClaimed {
    pub vault:        Pubkey,
    pub beneficiary:  Pubkey,
    pub lamports:     u64,
    pub claimed_slot: u64,
}
