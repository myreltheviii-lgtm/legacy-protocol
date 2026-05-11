// instructions/record_cloak_deposit.rs
//
// Records that the vault owner has successfully deposited into the Cloak
// shielded pool. This instruction does NOT move any SOL — that transfer
// happened off-chain directly between the owner's wallet and the Cloak program.
//
// Why a separate on-chain record?
//   The Anchor vault PDA needs to know WHICH Cloak UTXO represents the vault's
//   shielded balance. Guardians use utxo_commitment and utxo_leaf_index to
//   retrieve the correct UTXO object from the Cloak Merkle tree when executing
//   the shielded inheritance transfer. Without this record, guardians would
//   have no on-chain reference to the shielded assets.
//
// Security properties:
//   - Only the vault owner can call this (owner signer constraint).
//   - The vault must not be triggered, swept, or claimed.
//   - deposited_lamports accumulates across multiple shielded deposits —
//     the owner can top up the shielded pool over time.
//   - utxo_commitment is the last recorded commitment (most recent deposit).
//     Multiple deposits produce multiple UTXOs in Cloak; the owner must
//     consolidate them off-chain before triggering inheritance.

use anchor_lang::prelude::*;
use crate::constants::VAULT_SEED;
use crate::errors::LegacyError;
use crate::state::VaultAccount;

#[derive(Accounts)]
pub struct RecordCloakDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds  = [VAULT_SEED, owner.key().as_ref(), &vault.vault_index.to_le_bytes()],
        bump   = vault.bump,
        has_one = owner @ LegacyError::UnauthorisedOwner,
    )]
    pub vault: Account<'info, VaultAccount>,
}

pub fn handler(
    ctx: Context<RecordCloakDeposit>,
    utxo_commitment:  [u8; 32],
    utxo_leaf_index:  u64,
    shielded_lamports: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(!vault.is_triggered,      LegacyError::VaultAlreadyTriggered);
    require!(!vault.is_emergency_swept, LegacyError::VaultAlreadySwept);
    require!(!vault.is_claimed,         LegacyError::VaultAlreadyClaimed);
    require!(shielded_lamports > 0,     LegacyError::ZeroAmount);

    // The commitment must not be all-zeros — that is the sentinel meaning
    // "no Cloak deposit recorded". An all-zero commitment is not a valid
    // Poseidon hash output from the Cloak circuit; it would make the vault
    // appear unshielded (is_shielded() = false) even after this call,
    // blocking record_cloak_claim and orphaning the real off-chain UTXO.
    // InvalidBeneficiary is the most semantically appropriate available error:
    // the all-zero commitment is an invalid Cloak identity input, analogous
    // to the all-zero beneficiary_utxo_pubkey rejected in initialize_vault.
    require!(
        utxo_commitment != [0u8; 32],
        LegacyError::InvalidBeneficiary
    );

    vault.utxo_commitment  = utxo_commitment;
    vault.utxo_leaf_index  = utxo_leaf_index;
    vault.deposited_lamports = vault
        .deposited_lamports
        .checked_add(shielded_lamports)
        .ok_or(LegacyError::MathOverflow)?;

    emit!(CloakDepositRecorded {
        vault:         vault.key(),
        owner:         vault.owner,
        utxo_commitment,
        utxo_leaf_index,
        lamports:      shielded_lamports,
        total_lamports: vault.deposited_lamports,
    });

    Ok(())
}

#[event]
pub struct CloakDepositRecorded {
    pub vault:          Pubkey,
    pub owner:          Pubkey,
    /// Poseidon commitment of the new UTXO in the Cloak shielded pool.
    pub utxo_commitment: [u8; 32],
    /// Leaf position of this UTXO in Cloak's Merkle tree.
    pub utxo_leaf_index: u64,
    /// Lamports shielded in this deposit.
    pub lamports:        u64,
    /// Cumulative shielded lamports across all deposits.
    pub total_lamports:  u64,
}