// instructions/emergency_sweep.rs
//
// Executes a fully-approved EmergencySweep covenant. This is the
// "Hacker's Kill-Switch": when M-of-N guardians agree that the owner's
// wallet is under active attack, they open an EmergencySweep covenant, sign
// it, and then any party calls this instruction to drain the vault immediately
// to the beneficiary — bypassing the inactivity threshold entirely.
//
// For Cloak-shielded vaults: emergency sweep is NOT available because the SOL
// is not in this PDA — it is in Cloak's shielded pool. The is_shielded() check
// blocks this path and forces the guardian council to use the off-chain
// reconstructAndTransfer path instead.
//
// For non-shielded vaults: behavior is identical to pre-Cloak.

use anchor_lang::prelude::*;
use crate::constants::{ACTIVITY_SEED, COVENANT_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{ActivityAccount, CovenantAccount, CovenantType, VaultAccount};

#[derive(Accounts)]
pub struct EmergencySweep<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump  = vault.bump,
        close = beneficiary,
    )]
    pub vault: Account<'info, VaultAccount>,

    /// CHECK: Identity verified against vault.beneficiary_utxo_pubkey in handler.
    #[account(mut)]
    pub beneficiary: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [COVENANT_SEED, vault.key().as_ref(), &covenant.covenant_index.to_le_bytes()],
        bump  = covenant.bump,
        close = caller,
    )]
    pub covenant: Account<'info, CovenantAccount>,

    #[account(
        mut,
        seeds = [ACTIVITY_SEED, vault.key().as_ref()],
        bump  = activity.bump,
        close = caller,
    )]
    pub activity: Account<'info, ActivityAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<EmergencySweep>) -> Result<()> {
    let vault    = &mut ctx.accounts.vault;
    let covenant = &mut ctx.accounts.covenant;
    let clock    = Clock::get()?;

    require!(!vault.is_triggered,       LegacyError::VaultAlreadyTriggered);
    require!(!vault.is_emergency_swept,  LegacyError::VaultAlreadySwept);
    require!(!covenant.is_executed,      LegacyError::CovenantAlreadyExecuted);

    // Emergency sweep on a shielded vault would close accounts without moving
    // the shielded SOL, permanently orphaning the UTXO. Block this path.
    require!(!vault.is_shielded(), LegacyError::CovenantTypeMismatch);

    require!(
        covenant.covenant_type == CovenantType::EmergencySweep,
        LegacyError::CovenantTypeMismatch
    );

    require_keys_eq!(
        covenant.vault,
        vault.key(),
        LegacyError::CovenantVaultMismatch
    );

    // Reconstruct expected beneficiary from stored UTXO pubkey bytes.
    let expected_beneficiary = Pubkey::from(vault.beneficiary_utxo_pubkey);
    require_keys_eq!(
        ctx.accounts.beneficiary.key(),
        expected_beneficiary,
        LegacyError::UnauthorisedBeneficiary
    );

    require!(
        covenant.signers.len() as u8 >= covenant.required_signatures,
        LegacyError::InsufficientSignatures
    );

    require!(
        covenant.signatures_complete_slot > 0,
        LegacyError::InsufficientSignatures
    );

    if covenant.timelock_slots > 0 {
        let elapsed = clock
            .slot
            .checked_sub(covenant.signatures_complete_slot)
            .ok_or(LegacyError::MathOverflow)?;
        require!(elapsed >= covenant.timelock_slots, LegacyError::CovenantTimelockActive);
    }

    let vault_lamports = vault.to_account_info().lamports();

    vault.is_emergency_swept = true;
    vault.deposited_lamports = 0;
    covenant.is_executed     = true;

    emit!(EmergencySwept {
        vault:       vault.key(),
        beneficiary: ctx.accounts.beneficiary.key(),
        lamports:    vault_lamports,
        swept_slot:  clock.slot,
        covenant:    covenant.key(),
    });

    Ok(())
}

#[event]
pub struct EmergencySwept {
    pub vault:       Pubkey,
    pub beneficiary: Pubkey,
    pub lamports:    u64,
    pub swept_slot:  u64,
    pub covenant:    Pubkey,
}
