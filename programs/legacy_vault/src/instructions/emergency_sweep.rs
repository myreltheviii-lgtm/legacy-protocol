// instructions/emergency_sweep.rs
//
// Executes a fully-approved EmergencySweep covenant. This is the
// "Hacker's Kill-Switch": when M-of-N guardians agree that the owner's
// wallet is under active attack, they open an EmergencySweep covenant, sign
// it, and then any party calls this instruction to drain the vault immediately
// to the beneficiary — bypassing the inactivity threshold entirely.
//
// Speed is the design requirement. Emergency sweeps carry zero timelock.
//
// Account closure strategy:
//   vault    → close = beneficiary  (deposited funds + vault rent → beneficiary)
//   activity → close = caller       (activity rent → caller, incentivises submission)
//   covenant → close = caller       (covenant rent → caller, incentivises submission)

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

    /// CHECK: Identity is verified against vault.beneficiary in the handler.
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

    require!(
        covenant.covenant_type == CovenantType::EmergencySweep,
        LegacyError::CovenantTypeMismatch
    );

    require_keys_eq!(
        covenant.vault,
        vault.key(),
        LegacyError::CovenantVaultMismatch
    );

    // Prevents a caller from redirecting the sweep to an arbitrary wallet
    // by supplying a different account in the beneficiary position.
    require_keys_eq!(
        ctx.accounts.beneficiary.key(),
        vault.beneficiary,
        LegacyError::UnauthorisedBeneficiary
    );

    require!(
        covenant.signers.len() as u8 >= covenant.required_signatures,
        LegacyError::InsufficientSignatures
    );

    // A zero signatures_complete_slot means M-of-N was never actually reached.
    // Without this guard, EMERGENCY_SWEEP_TIMELOCK_SLOTS being zero would make
    // the timelock check trivially pass even for a covenant with no signatures.
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
        beneficiary: vault.beneficiary,
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
    /// Vault lamports transferred to beneficiary (deposited funds + vault rent).
    pub lamports:    u64,
    pub swept_slot:  u64,
    pub covenant:    Pubkey,
}
