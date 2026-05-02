// state/vault.rs
//
// The VaultAccount is the central on-chain record for a single inheritance
// vault. It is a PDA owned by the Legacy Vault program, meaning only the
// program's instructions can mutate it — no external wallet can sign on its
// behalf. All lamports deposited by the owner accumulate in this account.

use anchor_lang::prelude::*;
use crate::constants::VAULT_ACCOUNT_SIZE;

#[account]
pub struct VaultAccount {
    /// Wallet that created this vault and is allowed to check in, configure
    /// thresholds, add guardians, and close the vault.
    pub owner: Pubkey,

    /// Wallet that will receive all lamports once the inactivity threshold is
    /// crossed and the vault is triggered. Can only be changed by a successful
    /// BeneficiaryChange covenant.
    pub beneficiary: Pubkey,

    /// Number of guardian accounts currently registered and active.
    pub guardian_count: u8,

    /// Minimum number of guardian signatures required to execute any covenant.
    /// Invariant: 1 ≤ m_of_n_threshold ≤ guardian_count (when guardian_count > 0).
    pub m_of_n_threshold: u8,

    /// How long the owner must be silent before the vault becomes claimable,
    /// measured in Solana slots (~2 slots/second).
    pub inactivity_threshold_slots: u64,

    /// The slot number of the owner's most recent check-in. This is the anchor
    /// point for all inactivity calculations.
    pub last_check_in_slot: u64,

    /// The slot at which this vault was initialised. Used for auditing and to
    /// seed the first activity interval.
    pub created_slot: u64,

    /// Total lamports currently held by this vault PDA. Kept in sync with
    /// every deposit so instructions can read the balance without a full
    /// lamport inspection.
    pub deposited_lamports: u64,

    /// Monotonically increasing counter used to derive unique covenant PDAs.
    pub covenant_counter: u64,

    /// The index used when deriving this vault's PDA. Allows one owner to
    /// maintain multiple vaults simultaneously.
    pub vault_index: u64,

    /// Set to true once `trigger_inheritance` succeeds. After this point the
    /// owner can no longer check in or modify vault parameters.
    pub is_triggered: bool,

    /// Set to true once the beneficiary has successfully claimed.
    pub is_claimed: bool,

    /// Set to true once an emergency sweep has drained the vault.
    pub is_emergency_swept: bool,

    /// Tracks whether the 75% warning event has been emitted.
    pub warning_75_sent: bool,

    /// Tracks whether the 90% warning event has been emitted.
    pub warning_90_sent: bool,

    /// The canonical bump seed for this PDA, saved at initialisation.
    pub bump: u8,
}

impl VaultAccount {
    pub const LEN: usize = VAULT_ACCOUNT_SIZE;
}
