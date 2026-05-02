// instructions/trigger_inheritance.rs
//
// Permissionless instruction that flips the vault from "active" to "claimable"
// once the inactivity threshold has been crossed.
//
// Permissionless: ANYONE can call this — not just the beneficiary, not just a
// guardian. Even if the beneficiary has no Solana knowledge, a third party
// (a relayer, a family member, a protocol bot) can trigger on their behalf.
// The on-chain slot count is the sole authority.

use anchor_lang::prelude::*;
use crate::constants::VAULT_SEED;
use crate::errors::LegacyError;
use crate::math::threshold_crossed;
use crate::state::VaultAccount;

#[derive(Accounts)]
pub struct TriggerInheritance<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Account<'info, VaultAccount>,
}

pub fn handler(ctx: Context<TriggerInheritance>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    require!(!vault.is_triggered,      LegacyError::VaultAlreadyTriggered);
    require!(!vault.is_emergency_swept, LegacyError::VaultAlreadySwept);

    let crossed = threshold_crossed(
        clock.slot,
        vault.last_check_in_slot,
        vault.inactivity_threshold_slots,
    )?;

    require!(crossed, LegacyError::ThresholdNotReached);

    vault.is_triggered = true;

    emit!(InheritanceTriggered {
        vault:              vault.key(),
        owner:              vault.owner,
        beneficiary:        vault.beneficiary,
        triggered_slot:     clock.slot,
        last_check_in_slot: vault.last_check_in_slot,
        deposited_lamports: vault.deposited_lamports,
    });

    Ok(())
}

#[event]
pub struct InheritanceTriggered {
    pub vault:              Pubkey,
    pub owner:              Pubkey,
    pub beneficiary:        Pubkey,
    pub triggered_slot:     u64,
    pub last_check_in_slot: u64,
    pub deposited_lamports: u64,
}
