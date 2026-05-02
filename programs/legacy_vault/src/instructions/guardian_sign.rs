// instructions/guardian_sign.rs
//
// Adds a guardian's signature to an open covenant. Once the covenant
// accumulates M-of-N signatures, `signatures_complete_slot` is recorded.

use anchor_lang::prelude::*;
use crate::constants::{COVENANT_SEED, GUARDIAN_SEED, MAX_COVENANT_SIGNERS, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{CovenantAccount, GuardianAccount, VaultAccount};

#[derive(Accounts)]
pub struct GuardianSign<'info> {
    #[account(mut)]
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
        seeds = [COVENANT_SEED, vault.key().as_ref(), &covenant.covenant_index.to_le_bytes()],
        bump  = covenant.bump,
    )]
    pub covenant: Account<'info, CovenantAccount>,
}

pub fn handler(ctx: Context<GuardianSign>) -> Result<()> {
    let guardian_account = &ctx.accounts.guardian_account;
    let covenant = &mut ctx.accounts.covenant;
    let clock = Clock::get()?;

    require!(guardian_account.is_active, LegacyError::UnauthorisedGuardian);
    require_keys_eq!(
        guardian_account.vault,
        ctx.accounts.vault.key(),
        LegacyError::GuardianVaultMismatch
    );
    require_keys_eq!(
        covenant.vault,
        ctx.accounts.vault.key(),
        LegacyError::CovenantVaultMismatch
    );
    require!(!covenant.is_executed, LegacyError::CovenantAlreadyExecuted);
    require!(!ctx.accounts.vault.is_triggered, LegacyError::VaultAlreadyTriggered);

    let already_signed = covenant
        .signers
        .contains(&ctx.accounts.guardian.key());
    require!(!already_signed, LegacyError::AlreadySigned);

    require!(
        covenant.signers.len() < MAX_COVENANT_SIGNERS,
        LegacyError::TooManyGuardians
    );

    covenant.signers.push(ctx.accounts.guardian.key());

    let reached_threshold = covenant.signers.len() as u8 >= covenant.required_signatures;
    if reached_threshold && covenant.signatures_complete_slot == 0 {
        covenant.signatures_complete_slot = clock.slot;
    }

    emit!(CovenantSigned {
        vault:             ctx.accounts.vault.key(),
        covenant:          covenant.key(),
        guardian:          ctx.accounts.guardian.key(),
        total_signers:     covenant.signers.len() as u8,
        required_signers:  covenant.required_signatures,
        threshold_reached: reached_threshold,
    });

    Ok(())
}

#[event]
pub struct CovenantSigned {
    pub vault:             Pubkey,
    pub covenant:          Pubkey,
    pub guardian:          Pubkey,
    pub total_signers:     u8,
    pub required_signers:  u8,
    pub threshold_reached: bool,
}
