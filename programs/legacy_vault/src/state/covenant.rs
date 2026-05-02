// state/covenant.rs
//
// A Covenant is a multi-guardian approval request. Any guardian can open a
// covenant; other guardians then add their signatures. Once the covenant
// accumulates M-of-N signatures and the timelock elapses (if any), it becomes
// executable by the corresponding instruction.

use anchor_lang::prelude::*;
use crate::constants::COVENANT_ACCOUNT_SIZE;

/// Identifies the action that a covenant authorises once it reaches M-of-N
/// signatures.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum CovenantType {
    /// All vault lamports are transferred to the beneficiary immediately.
    /// Used when an active hack is in progress.
    EmergencySweep,

    /// Replaces `vault.beneficiary` with `covenant.target`. Subject to
    /// BENEFICIARY_CHANGE_TIMELOCK_SLOTS after the last required signature.
    BeneficiaryChange,

    /// Deactivates the guardian at `covenant.target` without requiring the
    /// owner to sign. Allows guardians to self-police a compromised peer.
    GuardianRemoval,
}

#[account]
pub struct CovenantAccount {
    /// The vault this covenant acts upon.
    pub vault: Pubkey,

    /// What this covenant will do when executed.
    pub covenant_type: CovenantType,

    /// Auxiliary pubkey: unused for EmergencySweep (Pubkey::default()), new
    /// beneficiary for BeneficiaryChange, guardian to remove for
    /// GuardianRemoval.
    pub target: Pubkey,

    /// Pubkeys of guardians who have already signed this covenant.
    pub signers: Vec<Pubkey>,

    /// Minimum signatures required before the covenant is executable. Copied
    /// from `vault.m_of_n_threshold` at creation time so a later threshold
    /// change does not retroactively lower the bar.
    pub required_signatures: u8,

    /// The slot at which this covenant was created.
    pub created_slot: u64,

    /// Additional slots that must elapse after `required_signatures` is
    /// reached before the covenant can be executed.
    pub timelock_slots: u64,

    /// The slot at which the final required signature was collected. Zero until
    /// the covenant reaches M-of-N. The execution instruction checks that
    /// `Clock::slot >= signatures_complete_slot + timelock_slots`.
    pub signatures_complete_slot: u64,

    /// Monotonic index derived from `vault.covenant_counter`.
    pub covenant_index: u64,

    /// Set to true when the covenant is successfully executed.
    pub is_executed: bool,

    /// The canonical bump seed for this PDA.
    pub bump: u8,
}

impl CovenantAccount {
    pub const LEN: usize = COVENANT_ACCOUNT_SIZE;
}
