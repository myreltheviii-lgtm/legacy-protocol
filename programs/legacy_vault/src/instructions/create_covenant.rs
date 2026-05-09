// instructions/create_covenant.rs
//
// Opens a new multi-guardian approval request (covenant). The calling guardian
// is automatically added as the first signer.

use anchor_lang::prelude::*;
use crate::constants::{
    BENEFICIARY_CHANGE_TIMELOCK_SLOTS, COVENANT_SEED, EMERGENCY_SWEEP_TIMELOCK_SLOTS,
    GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS, GUARDIAN_SEED, VAULT_SEED,
};
use crate::errors::LegacyError;
use crate::state::{CovenantAccount, CovenantType, GuardianAccount, VaultAccount};

#[derive(Accounts)]
#[instruction(covenant_type: CovenantType, target: Pubkey)]
pub struct CreateCovenant<'info> {
    #[account(mut)]
    pub guardian: Signer<'info>,

    #[account(
        mut,
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
        init,
        payer = guardian,
        space = CovenantAccount::LEN,
        seeds = [COVENANT_SEED, vault.key().as_ref(), &vault.covenant_counter.to_le_bytes()],
        bump,
    )]
    pub covenant: Account<'info, CovenantAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateCovenant>,
    covenant_type: CovenantType,
    target: Pubkey,
) -> Result<()> {
    let guardian_account = &ctx.accounts.guardian_account;
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    require!(guardian_account.is_active, LegacyError::UnauthorisedGuardian);
    require_keys_eq!(
        guardian_account.vault,
        vault.key(),
        LegacyError::GuardianVaultMismatch
    );

    require!(
        vault.guardian_count > 0 && vault.m_of_n_threshold > 0,
        LegacyError::ThresholdTooSmall
    );

    if covenant_type == CovenantType::EmergencySweep {
        require!(!vault.is_triggered,       LegacyError::VaultAlreadyTriggered);
        require!(!vault.is_emergency_swept,  LegacyError::VaultAlreadySwept);
    }

    if covenant_type == CovenantType::BeneficiaryChange {
        require!(!vault.is_triggered, LegacyError::VaultAlreadyTriggered);
        require!(
            target != Pubkey::default(),
            LegacyError::InvalidBeneficiary
        );
    }

    if covenant_type == CovenantType::GuardianRemoval {
        require!(
            target != Pubkey::default(),
            LegacyError::UnauthorisedGuardian
        );
        require!(!vault.is_triggered, LegacyError::VaultAlreadyTriggered);
    }

    let timelock_slots = match covenant_type {
        CovenantType::EmergencySweep    => EMERGENCY_SWEEP_TIMELOCK_SLOTS,
        CovenantType::BeneficiaryChange => BENEFICIARY_CHANGE_TIMELOCK_SLOTS,
        CovenantType::GuardianRemoval   => GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS,
    };

    let covenant_index = vault.covenant_counter;
    vault.covenant_counter = vault
        .covenant_counter
        .checked_add(1)
        .ok_or(LegacyError::MathOverflow)?;

    let covenant = &mut ctx.accounts.covenant;
    covenant.vault                    = vault.key();
    covenant.covenant_type            = covenant_type;
    covenant.target                   = target;
    covenant.signers                  = vec![ctx.accounts.guardian.key()];
    covenant.required_signatures      = vault.m_of_n_threshold;
    covenant.created_slot             = clock.slot;
    covenant.timelock_slots           = timelock_slots;
    covenant.signatures_complete_slot = 0;
    covenant.covenant_index           = covenant_index;
    covenant.is_executed              = false;
    covenant.bump                     = ctx.bumps.covenant;

    if covenant.signers.len() as u8 >= covenant.required_signatures {
        covenant.signatures_complete_slot = clock.slot;
    }

    emit!(CovenantCreated {
        vault:          vault.key(),
        covenant:       covenant.key(),
        covenant_type:  covenant.covenant_type.clone(),
        covenant_index,
        required_sigs:  covenant.required_signatures,
        first_signer:   ctx.accounts.guardian.key(),
    });

    Ok(())
}

#[event]
pub struct CovenantCreated {
    pub vault:          Pubkey,
    pub covenant:       Pubkey,
    pub covenant_type:  CovenantType,
    pub covenant_index: u64,
    pub required_sigs:  u8,
    pub first_signer:   Pubkey,
}
