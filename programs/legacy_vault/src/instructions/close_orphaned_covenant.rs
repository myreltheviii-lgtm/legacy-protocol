// instructions/close_orphaned_covenant.rs
//
// Recovers rent from CovenantAccount PDAs that have become permanently
// unexecutable because the vault was triggered while they were open.
//
// execute_covenant and emergency_sweep both gate on !is_triggered. Any
// covenant alive at trigger time is therefore frozen: it can never gain new
// signatures, never be executed, and never be closed by its normal path.
// This instruction unblocks that rent — anyone may call it, the caller
// receives the covenant PDA's rent reserve as a submission incentive.

use anchor_lang::prelude::*;
use crate::constants::{COVENANT_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{CovenantAccount, VaultAccount};

#[derive(Accounts)]
pub struct CloseOrphanedCovenant<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [COVENANT_SEED, vault.key().as_ref(), &covenant.covenant_index.to_le_bytes()],
        bump  = covenant.bump,
        close = caller,
    )]
    pub covenant: Account<'info, CovenantAccount>,
}

pub fn handler(ctx: Context<CloseOrphanedCovenant>) -> Result<()> {
    let vault    = &ctx.accounts.vault;
    let covenant = &ctx.accounts.covenant;

    require_keys_eq!(
        covenant.vault,
        vault.key(),
        LegacyError::CovenantVaultMismatch
    );

    // Only covenants on triggered vaults are eligible. Requiring is_triggered
    // also prevents this instruction from being used as a back-door to close
    // a valid covenant still in the signing phase.
    require!(vault.is_triggered, LegacyError::VaultNotTriggered);

    // Defence-in-depth: an executed covenant should already be closed.
    require!(!covenant.is_executed, LegacyError::CovenantAlreadyExecuted);

    emit!(OrphanedCovenantClosed {
        vault:          vault.key(),
        covenant:       covenant.key(),
        covenant_index: covenant.covenant_index,
        covenant_type:  covenant.covenant_type.clone(),
        caller:         ctx.accounts.caller.key(),
        closed_slot:    Clock::get()?.slot,
    });

    Ok(())
}

#[event]
pub struct OrphanedCovenantClosed {
    pub vault:          Pubkey,
    pub covenant:       Pubkey,
    pub covenant_index: u64,
    pub covenant_type:  crate::state::CovenantType,
    pub caller:         Pubkey,
    pub closed_slot:    u64,
}
