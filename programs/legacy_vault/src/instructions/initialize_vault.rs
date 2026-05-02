// instructions/initialize_vault.rs
//
// Creates a new VaultAccount and its companion ActivityAccount for a given
// owner. The owner can maintain multiple vaults simultaneously — each is
// distinguished by a monotonically increasing `vault_index` they supply.

use anchor_lang::prelude::*;
use crate::constants::{
    ACTIVITY_SEED, VAULT_SEED,
    DEFAULT_INACTIVITY_THRESHOLD_SLOTS,
    MIN_INACTIVITY_THRESHOLD_SLOTS,
    MAX_INACTIVITY_THRESHOLD_SLOTS,
};
use crate::errors::LegacyError;
use crate::state::{ActivityAccount, VaultAccount};

#[derive(Accounts)]
#[instruction(vault_index: u64, inactivity_threshold_slots: u64)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: We do not read or write this account. We only store its pubkey.
    pub beneficiary: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = VaultAccount::LEN,
        seeds = [VAULT_SEED, owner.key().as_ref(), &vault_index.to_le_bytes()],
        bump,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        init,
        payer = owner,
        space = ActivityAccount::LEN,
        seeds = [ACTIVITY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub activity: Account<'info, ActivityAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeVault>,
    vault_index: u64,
    inactivity_threshold_slots: u64,
) -> Result<()> {
    let threshold = if inactivity_threshold_slots == 0 {
        DEFAULT_INACTIVITY_THRESHOLD_SLOTS
    } else {
        inactivity_threshold_slots
    };

    require!(
        threshold >= MIN_INACTIVITY_THRESHOLD_SLOTS,
        LegacyError::ThresholdTooLow
    );
    require!(
        threshold <= MAX_INACTIVITY_THRESHOLD_SLOTS,
        LegacyError::ThresholdTooHigh
    );

    require!(
        ctx.accounts.beneficiary.key() != Pubkey::default(),
        LegacyError::InvalidBeneficiary
    );

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;

    vault.owner                      = ctx.accounts.owner.key();
    vault.beneficiary                = ctx.accounts.beneficiary.key();
    vault.guardian_count             = 0;
    vault.m_of_n_threshold           = 0;
    vault.inactivity_threshold_slots = threshold;
    vault.last_check_in_slot         = clock.slot;
    vault.created_slot               = clock.slot;
    vault.deposited_lamports         = 0;
    vault.covenant_counter           = 0;
    vault.vault_index                = vault_index;
    vault.is_triggered               = false;
    vault.is_claimed                 = false;
    vault.is_emergency_swept         = false;
    vault.warning_75_sent            = false;
    vault.warning_90_sent            = false;
    vault.bump                       = ctx.bumps.vault;

    let activity = &mut ctx.accounts.activity;
    activity.vault                = vault.key();
    activity.checkin_count        = 0;
    activity.sum_of_intervals     = 0;
    activity.last_interval        = 0;
    activity.anomaly_flagged      = false;
    activity.anomaly_flagged_slot = 0;
    activity.bump                 = ctx.bumps.activity;

    emit!(VaultInitialised {
        vault:           vault.key(),
        owner:           vault.owner,
        beneficiary:     vault.beneficiary,
        threshold_slots: vault.inactivity_threshold_slots,
        created_slot:    clock.slot,
    });

    Ok(())
}

#[event]
pub struct VaultInitialised {
    pub vault:           Pubkey,
    pub owner:           Pubkey,
    pub beneficiary:     Pubkey,
    pub threshold_slots: u64,
    pub created_slot:    u64,
}
