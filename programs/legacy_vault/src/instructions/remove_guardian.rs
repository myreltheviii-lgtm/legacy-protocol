// instructions/remove_guardian.rs
//
// Guardian removal is a two-phase process gated by a timelock:
//
//   Phase 1 (Initiate): The owner calls this instruction. The guardian's
//   `removal_requested_slot` is set to the current slot. The guardian remains
//   active during this window.
//
//   Phase 2 (Finalise): The owner calls this instruction again after
//   GUARDIAN_REMOVAL_TIMELOCK_SLOTS have elapsed. The guardian is deactivated,
//   the vault's guardian_count decremented, and the GuardianAccount PDA is
//   closed — returning its rent-exempt reserve to the owner.
//
// Phase 2 deactivation uses `AccountsClose::close` on the guardian account
// rather than a struct-level `close = owner` constraint because the same
// accounts struct serves both phases, and a struct-level `close` fires
// unconditionally on every `Ok(())` return — including Phase 1.

use anchor_lang::prelude::*;
use crate::constants::{GUARDIAN_REMOVAL_TIMELOCK_SLOTS, GUARDIAN_SEED, VAULT_SEED};
use crate::errors::LegacyError;
use crate::state::{GuardianAccount, VaultAccount};

#[derive(Accounts)]
pub struct RemoveGuardian<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds  = [VAULT_SEED, owner.key().as_ref(), &vault.vault_index.to_le_bytes()],
        bump   = vault.bump,
        has_one = owner @ LegacyError::UnauthorisedOwner,
    )]
    pub vault: Account<'info, VaultAccount>,

    /// CHECK: pubkey is verified via PDA seeds.
    pub guardian: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds  = [GUARDIAN_SEED, vault.key().as_ref(), guardian.key().as_ref()],
        bump   = guardian_account.bump,
    )]
    pub guardian_account: Account<'info, GuardianAccount>,
}

pub fn handler(ctx: Context<RemoveGuardian>) -> Result<()> {
    let clock = Clock::get()?;

    require!(!ctx.accounts.vault.is_triggered, LegacyError::VaultAlreadyTriggered);
    require!(ctx.accounts.guardian_account.is_active, LegacyError::GuardianAlreadyInactive);

    require_keys_eq!(
        ctx.accounts.guardian_account.vault,
        ctx.accounts.vault.key(),
        LegacyError::GuardianVaultMismatch
    );

    if ctx.accounts.guardian_account.removal_requested_slot == 0 {
        // ── Phase 1: Initiate the timelock ────────────────────────────────────
        //
        // Guard against initiating a removal that can never be finalised.
        // Phase 2 enforces guardian_count > 1. If this is the only guardian
        // and removal is initiated, removal_requested_slot becomes non-zero,
        // routing every future call into Phase 2 — which will always fail
        // with ThresholdTooSmall. Block the dead-end here at Phase 1 instead.
        require!(
            ctx.accounts.vault.guardian_count > 1,
            LegacyError::ThresholdTooSmall
        );

        ctx.accounts.guardian_account.removal_requested_slot = clock.slot;

        emit!(GuardianRemovalInitiated {
            vault:                  ctx.accounts.vault.key(),
            guardian:               ctx.accounts.guardian.key(),
            removal_requested_slot: clock.slot,
            finalise_after_slot:    clock.slot
                .checked_add(GUARDIAN_REMOVAL_TIMELOCK_SLOTS)
                .ok_or(LegacyError::MathOverflow)?,
        });
    } else {
        // ── Phase 2: Verify timelock, finalise, close PDA ─────────────────────

        let elapsed = clock
            .slot
            .checked_sub(ctx.accounts.guardian_account.removal_requested_slot)
            .ok_or(LegacyError::MathOverflow)?;

        require!(
            elapsed >= GUARDIAN_REMOVAL_TIMELOCK_SLOTS,
            LegacyError::RemovalTimelockActive
        );

        require!(
            ctx.accounts.vault.guardian_count > 1,
            LegacyError::ThresholdTooSmall
        );

        ctx.accounts.guardian_account.is_active = false;

        ctx.accounts.vault.guardian_count = ctx.accounts.vault.guardian_count
            .checked_sub(1)
            .ok_or(LegacyError::MathOverflow)?;

        let threshold_lowered =
            ctx.accounts.vault.m_of_n_threshold > ctx.accounts.vault.guardian_count;
        if threshold_lowered {
            ctx.accounts.vault.m_of_n_threshold = ctx.accounts.vault.guardian_count;
        }

        emit!(GuardianRemoved {
            vault:             ctx.accounts.vault.key(),
            guardian:          ctx.accounts.guardian.key(),
            guardian_count:    ctx.accounts.vault.guardian_count,
            m_of_n:            ctx.accounts.vault.m_of_n_threshold,
            threshold_lowered,
        });

        // Close the GuardianAccount PDA and return its rent-exempt reserve to
        // the vault owner. AccountsClose::close writes CLOSED_ACCOUNT_DISCRIMINATOR
        // (preventing resurrection attacks) and transfers all lamports.
        ctx.accounts
            .guardian_account
            .close(ctx.accounts.owner.to_account_info())?;
    }

    Ok(())
}

#[event]
pub struct GuardianRemovalInitiated {
    pub vault:                  Pubkey,
    pub guardian:               Pubkey,
    pub removal_requested_slot: u64,
    pub finalise_after_slot:    u64,
}

#[event]
pub struct GuardianRemoved {
    pub vault:             Pubkey,
    pub guardian:          Pubkey,
    pub guardian_count:    u8,
    pub m_of_n:            u8,
    /// True when the M-of-N threshold was automatically lowered to match the
    /// new guardian count. Off-chain monitors should alert the vault owner.
    pub threshold_lowered: bool,
}
