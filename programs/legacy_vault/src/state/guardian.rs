// state/guardian.rs
//
// Each guardian is represented by its own PDA. This design means a guardian's
// status can be read by anyone without scanning all vaults — just derive the
// PDA and check `is_active`. It also lets us apply per-guardian timelocks
// (removal delay) without polluting the main VaultAccount.

use anchor_lang::prelude::*;
use crate::constants::GUARDIAN_ACCOUNT_SIZE;

#[account]
pub struct GuardianAccount {
    /// The vault this guardian is registered to.
    pub vault: Pubkey,

    /// The guardian's own wallet pubkey.
    pub guardian: Pubkey,

    /// True while the guardian is in good standing.
    pub is_active: bool,

    /// The slot at which this guardian was first registered.
    pub added_slot: u64,

    /// When the owner initiates a removal, this is set to the current slot.
    /// Zero means no removal is pending. The removal can only be finalised
    /// after GUARDIAN_REMOVAL_TIMELOCK_SLOTS have elapsed from this slot.
    pub removal_requested_slot: u64,

    /// The canonical bump seed for this PDA.
    pub bump: u8,
}

impl GuardianAccount {
    pub const LEN: usize = GUARDIAN_ACCOUNT_SIZE;
}
