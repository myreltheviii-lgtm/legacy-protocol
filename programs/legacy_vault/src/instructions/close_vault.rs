// instructions/close_vault.rs
//
// Allows the owner to permanently close a vault and recover all lamports.
//
// Requiring guardian_count == 0 before closing is a rent safety guarantee:
// GuardianAccount PDAs are derived from the vault pubkey. Once the vault
// account is zeroed by the close constraint, no instruction can load the vault
// to finalise the removal of those guardians. Their rent-exempt reserves would
// be permanently stranded. Forcing the owner to remove all guardians first
// ensures the guardian rent is returned before the vault disappears.

use anchor_lang::prelude::*;
use crate::constants::{ACTIVITY_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{ActivityAccount, VaultAccount};

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds  = [VAULT_SEED, owner.key().as_ref(), &vault.vault_index.to_le_bytes()],
        bump   = vault.bump,
        has_one = owner @ LegacyError::UnauthorisedOwner,
        close  = owner,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        mut,
        seeds  = [ACTIVITY_SEED, vault.key().as_ref()],
        bump   = activity.bump,
        close  = owner,
    )]
    pub activity: Account<'info, ActivityAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CloseVault>) -> Result<()> {
    let vault = &ctx.accounts.vault;

    require!(!vault.is_triggered,      LegacyError::VaultAlreadyTriggered);
    require!(!vault.is_emergency_swept, LegacyError::VaultAlreadySwept);
    require!(!vault.is_claimed,         LegacyError::VaultAlreadyClaimed);
    require!(vault.deposited_lamports == 0, LegacyError::VaultNotEmpty);
    require!(vault.guardian_count == 0, LegacyError::GuardiansStillRegistered);

    emit!(VaultClosed {
        vault: vault.key(),
        owner: vault.owner,
    });

    Ok(())
}

#[event]
pub struct VaultClosed {
    pub vault: Pubkey,
    pub owner: Pubkey,
}
