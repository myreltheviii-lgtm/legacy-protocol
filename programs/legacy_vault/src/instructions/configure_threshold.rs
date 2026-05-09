// instructions/configure_threshold.rs
//
// Allows the vault owner to update the inactivity threshold after creation.
// Changing the threshold also resets the progressive warning flags so the
// watcher emits correct notifications based on the new window.

use anchor_lang::prelude::*;
use crate::constants::{
    MAX_INACTIVITY_THRESHOLD_SLOTS, MIN_INACTIVITY_THRESHOLD_SLOTS, VAULT_SEED,
};
use crate::errors::LegacyError;
use crate::state::VaultAccount;

#[derive(Accounts)]
pub struct ConfigureThreshold<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref(), &vault.vault_index.to_le_bytes()],
        bump = vault.bump,
        has_one = owner @ LegacyError::UnauthorisedOwner,
    )]
    pub vault: Account<'info, VaultAccount>,
}

pub fn handler(ctx: Context<ConfigureThreshold>, new_threshold_slots: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(!vault.is_triggered,      LegacyError::VaultAlreadyTriggered);
    require!(!vault.is_emergency_swept, LegacyError::VaultAlreadySwept);

    require!(
        new_threshold_slots >= MIN_INACTIVITY_THRESHOLD_SLOTS,
        LegacyError::ThresholdTooLow
    );
    require!(
        new_threshold_slots <= MAX_INACTIVITY_THRESHOLD_SLOTS,
        LegacyError::ThresholdTooHigh
    );

    let old_threshold = vault.inactivity_threshold_slots;
    vault.inactivity_threshold_slots = new_threshold_slots;

    // Reset warning flags so the watcher re-evaluates milestones against the
    // new threshold rather than the old one.
    vault.warning_75_sent = false;
    vault.warning_90_sent = false;

    emit!(ThresholdUpdated {
        vault:         vault.key(),
        old_threshold,
        new_threshold: new_threshold_slots,
    });

    Ok(())
}

#[event]
pub struct ThresholdUpdated {
    pub vault:         Pubkey,
    pub old_threshold: u64,
    pub new_threshold: u64,
}
