// instructions/anomaly_flag.rs
//
// Any active guardian can call this instruction when they believe the owner's
// silence is statistically unusual, even before the hard threshold is crossed.

use anchor_lang::prelude::*;
use crate::constants::{ACTIVITY_SEED, GUARDIAN_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::math::is_anomalous;
use crate::state::{ActivityAccount, GuardianAccount, VaultAccount};

#[derive(Accounts)]
pub struct AnomalyFlag<'info> {
    pub guardian: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        seeds = [GUARDIAN_SEED, vault.key().as_ref(), guardian.key().as_ref()],
        bump  = guardian_account.bump,
    )]
    pub guardian_account: Account<'info, GuardianAccount>,

    #[account(
        mut,
        seeds = [ACTIVITY_SEED, vault.key().as_ref()],
        bump  = activity.bump,
    )]
    pub activity: Account<'info, ActivityAccount>,
}

pub fn handler(ctx: Context<AnomalyFlag>) -> Result<()> {
    let guardian_account = &ctx.accounts.guardian_account;
    let vault            = &ctx.accounts.vault;
    let activity         = &mut ctx.accounts.activity;
    let clock            = Clock::get()?;

    require!(guardian_account.is_active, LegacyError::UnauthorisedGuardian);
    require_keys_eq!(
        guardian_account.vault,
        vault.key(),
        LegacyError::GuardianVaultMismatch
    );

    require!(!vault.is_triggered, LegacyError::VaultAlreadyTriggered);

    // Protecting anomaly_flagged_slot integrity — the watcher correlates
    // notification timing from this timestamp. A second flag would overwrite
    // the original detection moment and lose that information.
    require!(!activity.anomaly_flagged, LegacyError::AnomalyAlreadyFlagged);

    let anomalous = is_anomalous(
        clock.slot,
        vault.last_check_in_slot,
        activity.checkin_count,
        activity.sum_of_intervals,
    )?;

    require!(anomalous, LegacyError::ThresholdNotReached);

    activity.anomaly_flagged      = true;
    activity.anomaly_flagged_slot = clock.slot;

    emit!(AnomalyFlagged {
        vault:              vault.key(),
        guardian:           ctx.accounts.guardian.key(),
        flagged_slot:       clock.slot,
        last_check_in_slot: vault.last_check_in_slot,
        checkin_count:      activity.checkin_count,
    });

    Ok(())
}

#[event]
pub struct AnomalyFlagged {
    pub vault:              Pubkey,
    pub guardian:           Pubkey,
    pub flagged_slot:       u64,
    pub last_check_in_slot: u64,
    pub checkin_count:      u64,
}
