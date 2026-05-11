// instructions/execute_covenant.rs
//
// Executes a BeneficiaryChange or GuardianRemoval covenant once M-of-N
// signatures have been collected and the timelock has elapsed.
// EmergencySweep covenants use the dedicated `emergency_sweep` instruction.
//
// Cloak change: BeneficiaryChange now stores covenant.target.to_bytes() into
// vault.beneficiary_utxo_pubkey rather than a plain Pubkey field. The target
// Pubkey in the covenant is the 32-byte UTXO public key of the new beneficiary,
// passed as a Solana Pubkey for IDL compatibility (same wire encoding).

use anchor_lang::prelude::*;
use crate::constants::{COVENANT_SEED, GUARDIAN_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{CovenantAccount, CovenantType, GuardianAccount, VaultAccount};

#[derive(Accounts)]
pub struct ExecuteCovenant<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds  = [COVENANT_SEED, vault.key().as_ref(), &covenant.covenant_index.to_le_bytes()],
        bump   = covenant.bump,
        close  = caller,
    )]
    pub covenant: Account<'info, CovenantAccount>,

    #[account(
        mut,
        seeds = [GUARDIAN_SEED, vault.key().as_ref(), covenant.target.as_ref()],
        bump  = target_guardian.bump,
    )]
    pub target_guardian: Option<Account<'info, GuardianAccount>>,
}

pub fn handler(ctx: Context<ExecuteCovenant>) -> Result<()> {
    let vault    = &mut ctx.accounts.vault;
    let covenant = &mut ctx.accounts.covenant;
    let clock    = Clock::get()?;

    require!(!covenant.is_executed, LegacyError::CovenantAlreadyExecuted);
    require_keys_eq!(
        covenant.vault,
        vault.key(),
        LegacyError::CovenantVaultMismatch
    );

    require!(!vault.is_triggered,       LegacyError::VaultAlreadyTriggered);
    require!(!vault.is_emergency_swept,  LegacyError::VaultAlreadySwept);

    require!(
        covenant.covenant_type != CovenantType::EmergencySweep,
        LegacyError::CovenantTypeMismatch
    );

    require!(
        covenant.signers.len() as u8 >= covenant.required_signatures,
        LegacyError::InsufficientSignatures
    );

    require!(
        covenant.signatures_complete_slot > 0,
        LegacyError::InsufficientSignatures
    );

    let elapsed = clock
        .slot
        .checked_sub(covenant.signatures_complete_slot)
        .ok_or(LegacyError::MathOverflow)?;

    require!(
        elapsed >= covenant.timelock_slots,
        LegacyError::CovenantTimelockActive
    );

    match covenant.covenant_type {
        CovenantType::BeneficiaryChange => {
            require!(
                covenant.target != Pubkey::default(),
                LegacyError::InvalidBeneficiary
            );

            let old_beneficiary_utxo_pubkey = vault.beneficiary_utxo_pubkey;
            // Store the new beneficiary's UTXO pubkey bytes.
            // The covenant target encodes the 32-byte UTXO pubkey as a Pubkey
            // for IDL compatibility — the bytes are identical.
            vault.beneficiary_utxo_pubkey = covenant.target.to_bytes();

            emit!(BeneficiaryChanged {
                vault:                       vault.key(),
                old_beneficiary_utxo_pubkey,
                new_beneficiary_utxo_pubkey: vault.beneficiary_utxo_pubkey,
                covenant:                    covenant.key(),
                executed_slot:               clock.slot,
            });
        }

        CovenantType::GuardianRemoval => {
            require!(
                vault.guardian_count > 1,
                LegacyError::ThresholdTooSmall
            );

            let target_guardian = ctx
                .accounts
                .target_guardian
                .as_mut()
                .ok_or(LegacyError::UnauthorisedGuardian)?;

            require_keys_eq!(
                target_guardian.guardian,
                covenant.target,
                LegacyError::GuardianVaultMismatch
            );
            require_keys_eq!(
                target_guardian.vault,
                vault.key(),
                LegacyError::GuardianVaultMismatch
            );
            require!(target_guardian.is_active, LegacyError::GuardianAlreadyInactive);

            target_guardian.is_active = false;

            vault.guardian_count = vault
                .guardian_count
                .checked_sub(1)
                .ok_or(LegacyError::MathOverflow)?;

            let threshold_lowered = vault.m_of_n_threshold > vault.guardian_count;
            if threshold_lowered {
                vault.m_of_n_threshold = vault.guardian_count;
            }

            emit!(GuardianRemovedByCovenant {
                vault:             vault.key(),
                guardian:          covenant.target,
                covenant:          covenant.key(),
                guardian_count:    vault.guardian_count,
                m_of_n:            vault.m_of_n_threshold,
                threshold_lowered,
                executed_slot:     clock.slot,
            });

            target_guardian.close(ctx.accounts.caller.to_account_info())?;
        }

        CovenantType::EmergencySweep => {
            return err!(LegacyError::CovenantTypeMismatch);
        }
    }

    covenant.is_executed = true;

    Ok(())
}

#[event]
pub struct BeneficiaryChanged {
    pub vault:                       Pubkey,
    pub old_beneficiary_utxo_pubkey: [u8; 32],
    pub new_beneficiary_utxo_pubkey: [u8; 32],
    pub covenant:                    Pubkey,
    pub executed_slot:               u64,
}

#[event]
pub struct GuardianRemovedByCovenant {
    pub vault:             Pubkey,
    pub guardian:          Pubkey,
    pub covenant:          Pubkey,
    pub guardian_count:    u8,
    pub m_of_n:            u8,
    pub threshold_lowered: bool,
    pub executed_slot:     u64,
}
