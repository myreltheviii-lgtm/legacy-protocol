// instructions/check_in.rs
//
// The owner submits a check-in to prove they are alive. This resets the
// inactivity clock, updates the activity statistical model, and clears any
// active anomaly flag.

use anchor_lang::prelude::*;
use crate::constants::{ACTIVITY_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{ActivityAccount, VaultAccount};

#[derive(Accounts)]
pub struct CheckIn<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds  = [VAULT_SEED, owner.key().as_ref(), &vault.vault_index.to_le_bytes()],
        bump   = vault.bump,
        has_one = owner @ LegacyError::UnauthorisedOwner,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds = [ACTIVITY_SEED, vault.key().as_ref()],
        bump  = activity.bump,
    )]
    pub activity: Account<'info, ActivityAccount>,
}

pub fn handler(ctx: Context<CheckIn>) -> Result<()> {
    let vault    = &mut ctx.accounts.vault;
    let activity = &mut ctx.accounts.activity;
    let clock    = Clock::get()?;

    require!(!vault.is_triggered, LegacyError::VaultAlreadyTriggered);

    let current_slot = clock.slot;

    let interval = current_slot
        .checked_sub(vault.last_check_in_slot)
        .ok_or(LegacyError::MathOverflow)?;

    // A zero-interval check-in increments checkin_count without adding to
    // sum_of_intervals, pulling the computed average toward zero and
    // tightening the anomaly threshold — making the detector flag the owner
    // prematurely.
    require!(interval > 0, LegacyError::SameSlotCheckIn);

    activity.sum_of_intervals = activity
        .sum_of_intervals
        .checked_add(interval)
        .ok_or(LegacyError::MathOverflow)?;

    activity.checkin_count = activity
        .checkin_count
        .checked_add(1)
        .ok_or(LegacyError::MathOverflow)?;

    activity.last_interval = interval;

    activity.anomaly_flagged      = false;
    activity.anomaly_flagged_slot = 0;

    vault.last_check_in_slot = current_slot;
    vault.warning_75_sent    = false;
    vault.warning_90_sent    = false;

    emit!(CheckedIn {
        vault:         vault.key(),
        owner:         vault.owner,
        slot:          current_slot,
        interval,
        checkin_count: activity.checkin_count,
    });

    Ok(())
}

#[event]
pub struct CheckedIn {
    pub vault:         Pubkey,
    pub owner:         Pubkey,
    pub slot:          u64,
    pub interval:      u64,
    pub checkin_count: u64,
}
