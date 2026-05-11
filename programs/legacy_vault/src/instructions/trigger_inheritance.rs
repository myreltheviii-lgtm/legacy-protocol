// instructions/trigger_inheritance.rs
//
// Permissionless instruction that flips the vault from "active" to "claimable"
// once the inactivity threshold has been crossed.
//
// Permissionless: ANYONE can call this — not just the beneficiary, not just a
// guardian. Even if the beneficiary has no Solana knowledge, a third party
// (a relayer, a family member, a protocol bot) can trigger on their behalf.
// The on-chain slot count is the sole authority.
//
// Cloak note: The emitted InheritanceTriggered event carries beneficiary as a
// Pubkey field for wire-format compatibility with the SDK event parser, which
// reads 32 bytes at that position. For shielded vaults, the 32 bytes are the
// raw Cloak UTXO public key rather than a Solana wallet — they round-trip
// identically over the wire. The value is derived via Pubkey::from() from the
// 32-byte beneficiary_utxo_pubkey field.

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

    // Emit using Pubkey::from() so the 32-byte beneficiary_utxo_pubkey bytes
    // occupy the beneficiary field at the correct wire offset. The SDK's
    // parseInheritanceTriggeredEvent reads these 32 bytes as a pubkey — the
    // encoding is identical whether it is a Solana wallet address or a Cloak
    // UTXO public key.
    emit!(InheritanceTriggered {
        vault:              vault.key(),
        owner:              vault.owner,
        beneficiary:        Pubkey::from(vault.beneficiary_utxo_pubkey),
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
    /// For shielded vaults this is the 32-byte Cloak UTXO public key of the
    /// beneficiary, transmitted as a Pubkey for wire-format compatibility with
    /// existing SDK event parsers. For non-shielded vaults it is the
    /// beneficiary's Solana wallet address.
    pub beneficiary:        Pubkey,
    pub triggered_slot:     u64,
    pub last_check_in_slot: u64,
    pub deposited_lamports: u64,
}
