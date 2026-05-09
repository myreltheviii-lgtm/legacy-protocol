// instructions/add_guardian.rs
//
// Registers a new guardian for a vault and sets or updates the M-of-N
// threshold. Guardians are the cryptographic council of the vault: they
// collectively authorise emergency sweeps, beneficiary changes, and peer
// removals.

use anchor_lang::prelude::*;
use crate::constants::{GUARDIAN_SEED, MAX_GUARDIANS, MIN_M_OF_N, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{GuardianAccount, VaultAccount};

#[derive(Accounts)]
#[instruction(m_of_n_threshold: u8)]
pub struct AddGuardian<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds  = [VAULT_SEED, owner.key().as_ref(), &vault.vault_index.to_le_bytes()],
        bump   = vault.bump,
        has_one = owner @ LegacyError::UnauthorisedOwner,
    )]
    pub vault: Account<'info, VaultAccount>,

    /// CHECK: We only store the guardian's pubkey. No data is read from it.
    pub guardian: UncheckedAccount<'info>,

    #[account(
        init,
        payer  = owner,
        space  = GuardianAccount::LEN,
        seeds  = [GUARDIAN_SEED, vault.key().as_ref(), guardian.key().as_ref()],
        bump,
    )]
    pub guardian_account: Account<'info, GuardianAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddGuardian>, m_of_n_threshold: u8) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(!vault.is_triggered, LegacyError::VaultAlreadyTriggered);

    // A self-guardian can unilaterally satisfy M-of-N: the owner signs both
    // the covenant creation (as guardian) and standard owner operations,
    // meaning a single compromised key controls both sides of the security
    // model.
    require!(
        ctx.accounts.guardian.key() != ctx.accounts.owner.key(),
        LegacyError::UnauthorisedGuardian
    );

    // The zero address has no corresponding private key. Registering it
    // permanently consumes one guardian slot and inflates guardian_count
    // without adding any real signing capacity.
    require!(
        ctx.accounts.guardian.key() != Pubkey::default(),
        LegacyError::UnauthorisedGuardian
    );

    require!(
        vault.guardian_count < MAX_GUARDIANS,
        LegacyError::TooManyGuardians
    );

    let new_guardian_count = vault
        .guardian_count
        .checked_add(1)
        .ok_or(LegacyError::MathOverflow)?;

    require!(m_of_n_threshold >= MIN_M_OF_N, LegacyError::ThresholdTooSmall);
    require!(
        m_of_n_threshold <= new_guardian_count,
        LegacyError::ThresholdExceedsGuardianCount
    );

    let clock = Clock::get()?;

    let guardian_account = &mut ctx.accounts.guardian_account;
    guardian_account.vault                  = vault.key();
    guardian_account.guardian               = ctx.accounts.guardian.key();
    guardian_account.is_active              = true;
    guardian_account.added_slot             = clock.slot;
    guardian_account.removal_requested_slot = 0;
    guardian_account.bump                   = ctx.bumps.guardian_account;

    vault.guardian_count   = new_guardian_count;
    vault.m_of_n_threshold = m_of_n_threshold;

    emit!(GuardianAdded {
        vault:          vault.key(),
        guardian:       ctx.accounts.guardian.key(),
        guardian_count: vault.guardian_count,
        m_of_n:         vault.m_of_n_threshold,
    });

    Ok(())
}

#[event]
pub struct GuardianAdded {
    pub vault:          Pubkey,
    pub guardian:       Pubkey,
    pub guardian_count: u8,
    pub m_of_n:         u8,
}
