// instructions/initialize_vault.rs
//
// Creates a new VaultAccount and its companion ActivityAccount for a given
// owner. The owner can maintain multiple vaults simultaneously — each is
// distinguished by a monotonically increasing `vault_index` they supply.
//
// Cloak integration change:
//   The `beneficiary` account parameter is replaced by `beneficiary_utxo_pubkey: [u8;32]`
//   instruction argument. The beneficiary no longer registers their Solana
//   wallet on-chain — instead, they generate a UTXO keypair client-side and
//   only share the 32-byte public key. This public key is stored verbatim in
//   vault.beneficiary_utxo_pubkey with no on-chain address check possible
//   (it is not an Ed25519 public key in the Solana sense).
//
//   For non-shielded (legacy) use, callers may pass the raw bytes of a
//   standard Solana Pubkey. The claim_inheritance instruction will reconstruct
//   the Pubkey via Pubkey::from(bytes) for identity verification.

use anchor_lang::prelude::*;
use crate::constants::{
    ACTIVITY_SEED, VAULT_SEED,
    DEFAULT_INACTIVITY_THRESHOLD_SLOTS,
    MIN_INACTIVITY_THRESHOLD_SLOTS,
    MAX_INACTIVITY_THRESHOLD_SLOTS,
};
use crate::errors::LegacyError;
use crate::state::{ActivityAccount, VaultAccount};

#[derive(Accounts)]
#[instruction(vault_index: u64, inactivity_threshold_slots: u64, beneficiary_utxo_pubkey: [u8; 32])]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = VaultAccount::LEN,
        seeds = [VAULT_SEED, owner.key().as_ref(), &vault_index.to_le_bytes()],
        bump,
    )]
    pub vault: Account<'info, VaultAccount>,

    #[account(
        init,
        payer = owner,
        space = ActivityAccount::LEN,
        seeds = [ACTIVITY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub activity: Account<'info, ActivityAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeVault>,
    vault_index: u64,
    inactivity_threshold_slots: u64,
    beneficiary_utxo_pubkey: [u8; 32],
) -> Result<()> {
    let threshold = if inactivity_threshold_slots == 0 {
        DEFAULT_INACTIVITY_THRESHOLD_SLOTS
    } else {
        inactivity_threshold_slots
    };

    require!(
        threshold >= MIN_INACTIVITY_THRESHOLD_SLOTS,
        LegacyError::ThresholdTooLow
    );
    require!(
        threshold <= MAX_INACTIVITY_THRESHOLD_SLOTS,
        LegacyError::ThresholdTooHigh
    );

    // Reject an all-zeros beneficiary — this has no corresponding key and
    // would make the vault permanently unclaimable.
    require!(
        beneficiary_utxo_pubkey != [0u8; 32],
        LegacyError::InvalidBeneficiary
    );

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;

    vault.owner                      = ctx.accounts.owner.key();
    vault.beneficiary_utxo_pubkey    = beneficiary_utxo_pubkey;
    vault.guardian_count             = 0;
    vault.m_of_n_threshold           = 0;
    vault.inactivity_threshold_slots = threshold;
    vault.last_check_in_slot         = clock.slot;
    vault.created_slot               = clock.slot;
    vault.deposited_lamports         = 0;
    vault.covenant_counter           = 0;
    vault.vault_index                = vault_index;
    vault.utxo_commitment            = [0u8; 32];
    vault.utxo_leaf_index            = 0;
    vault.is_triggered               = false;
    vault.is_claimed                 = false;
    vault.is_emergency_swept         = false;
    vault.warning_75_sent            = false;
    vault.warning_90_sent            = false;
    vault.bump                       = ctx.bumps.vault;

    let activity = &mut ctx.accounts.activity;
    activity.vault                = vault.key();
    activity.checkin_count        = 0;
    activity.sum_of_intervals     = 0;
    activity.last_interval        = 0;
    activity.anomaly_flagged      = false;
    activity.anomaly_flagged_slot = 0;
    activity.bump                 = ctx.bumps.activity;

    emit!(VaultInitialised {
        vault:                   vault.key(),
        owner:                   vault.owner,
        beneficiary_utxo_pubkey: vault.beneficiary_utxo_pubkey,
        threshold_slots:         vault.inactivity_threshold_slots,
        created_slot:            clock.slot,
    });

    Ok(())
}

#[event]
pub struct VaultInitialised {
    pub vault:                   Pubkey,
    pub owner:                   Pubkey,
    /// Raw bytes of the beneficiary's Cloak UTXO public key.
    /// Not a Solana address — do not attempt to load this as an account.
    pub beneficiary_utxo_pubkey: [u8; 32],
    pub threshold_slots:         u64,
    pub created_slot:            u64,
}
