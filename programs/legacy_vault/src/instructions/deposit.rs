// instructions/deposit.rs
//
// Transfers lamports from the owner's wallet into the vault PDA.
//
// This instruction is for NON-SHIELDED vaults only. For shielded vaults,
// all SOL flows through the Cloak protocol off-chain and the on-chain record
// is updated via record_cloak_deposit. Calling deposit on a shielded vault
// would move real SOL into the PDA but there is no way to retrieve it:
//   - claim_inheritance refuses shielded vaults (is_shielded() check)
//   - emergency_sweep refuses shielded vaults (is_shielded() check)
//   - record_cloak_claim closes the account with `close = caller`, draining
//     ALL lamports in the PDA (including the accidentally deposited SOL) to
//     whoever calls it — not to the owner.
// The is_shielded() guard here makes this failure mode impossible.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::constants::VAULT_SEED;
use crate::errors::LegacyError;
use crate::state::VaultAccount;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_index.to_le_bytes()],
        bump = vault.bump,
        has_one = owner @ LegacyError::UnauthorisedOwner,
    )]
    pub vault: Account<'info, VaultAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
    require!(!ctx.accounts.vault.is_triggered,       LegacyError::VaultAlreadyTriggered);
    require!(!ctx.accounts.vault.is_emergency_swept,  LegacyError::VaultAlreadySwept);
    require!(lamports > 0, LegacyError::ZeroAmount);

    // Shielded vaults must use record_cloak_deposit instead. Allowing deposit
    // on a shielded vault creates an irrecoverable mixed-accounting state where
    // on-chain SOL in the PDA cannot be routed back to the owner through any
    // existing instruction path.
    require!(!ctx.accounts.vault.is_shielded(), LegacyError::CovenantTypeMismatch);

    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to:   ctx.accounts.vault.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, lamports)?;

    let vault = &mut ctx.accounts.vault;
    vault.deposited_lamports = vault
        .deposited_lamports
        .checked_add(lamports)
        .ok_or(LegacyError::MathOverflow)?;

    emit!(Deposited {
        vault:    vault.key(),
        lamports,
        total:    vault.deposited_lamports,
    });

    Ok(())
}

#[event]
pub struct Deposited {
    pub vault:    Pubkey,
    pub lamports: u64,
    pub total:    u64,
}
