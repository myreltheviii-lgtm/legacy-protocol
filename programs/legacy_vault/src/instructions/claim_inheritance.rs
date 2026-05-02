// instructions/claim_inheritance.rs
//
// The beneficiary calls this instruction after `trigger_inheritance` has
// flipped `vault.is_triggered`. It transfers all lamports from the vault
// PDA to the beneficiary's wallet, then closes both the vault and activity
// accounts.
//
// Why close via Anchor's constraint rather than manual lamport manipulation:
// Anchor's `close = X` constraint atomically zeroes the discriminator,
// transfers ALL lamports to X, and lets the runtime garbage-collect the
// account — the rent reserve is returned to the beneficiary along with
// deposited funds. Manual subtraction of rent_exempt_min would permanently
// lock the rent reserve with no recovery path.

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
        has_one = beneficiary @ LegacyError::UnauthorisedBeneficiary,
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

    // Capture the combined lamport balance from both accounts before Anchor's
    // close constraint drains them. Both accounts are closed to the
    // beneficiary, so the total received is the sum of both balances.
    let vault_lamports    = vault.to_account_info().lamports();
    let activity_lamports = ctx.accounts.activity.to_account_info().lamports();
    let total_lamports    = vault_lamports
        .checked_add(activity_lamports)
        .ok_or(LegacyError::MathOverflow)?;

    vault.is_claimed         = true;
    vault.deposited_lamports = 0;

    emit!(InheritanceClaimed {
        vault:        vault.key(),
        beneficiary:  vault.beneficiary,
        lamports:     total_lamports,
        claimed_slot: Clock::get()?.slot,
    });

    Ok(())
}

#[event]
pub struct InheritanceClaimed {
    pub vault:        Pubkey,
    pub beneficiary:  Pubkey,
    /// Total lamports transferred: vault PDA balance + activity PDA balance.
    pub lamports:     u64,
    pub claimed_slot: u64,
}
