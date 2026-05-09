// math/threshold_calc.rs
//
// Given the owner's last check-in slot and the configured threshold, this
// module pre-computes the absolute slot numbers at which each progressive
// warning should fire.

use crate::constants::{WARNING_SLOT_PCT_75, WARNING_SLOT_PCT_90};
use crate::errors::LegacyError;
use anchor_lang::prelude::*;

/// Pre-computed milestone slots for a single vault's inactivity window.
pub struct ThresholdMilestones {
    /// Slot at which the inactivity score crosses 75%.
    pub warning_75_slot: u64,
    /// Slot at which the inactivity score crosses 90%.
    pub warning_90_slot: u64,
    /// Slot at which `trigger_inheritance` becomes callable.
    pub trigger_slot: u64,
}

/// Computes the three milestone slot numbers for a vault.
/// All values are absolute slot numbers, not relative offsets.
pub fn compute_milestones(
    last_check_in_slot: u64,
    inactivity_threshold_slots: u64,
) -> Result<ThresholdMilestones> {
    let offset_75 = inactivity_threshold_slots
        .checked_mul(WARNING_SLOT_PCT_75)
        .ok_or(LegacyError::MathOverflow)?
        .checked_div(100)
        .ok_or(LegacyError::MathOverflow)?;

    let offset_90 = inactivity_threshold_slots
        .checked_mul(WARNING_SLOT_PCT_90)
        .ok_or(LegacyError::MathOverflow)?
        .checked_div(100)
        .ok_or(LegacyError::MathOverflow)?;

    let warning_75_slot = last_check_in_slot
        .checked_add(offset_75)
        .ok_or(LegacyError::MathOverflow)?;

    let warning_90_slot = last_check_in_slot
        .checked_add(offset_90)
        .ok_or(LegacyError::MathOverflow)?;

    let trigger_slot = last_check_in_slot
        .checked_add(inactivity_threshold_slots)
        .ok_or(LegacyError::MathOverflow)?;

    Ok(ThresholdMilestones { warning_75_slot, warning_90_slot, trigger_slot })
}

/// Returns true if the vault's inactivity threshold has been crossed.
/// This is the exact check performed by `trigger_inheritance` on-chain.
pub fn threshold_crossed(
    current_slot: u64,
    last_check_in_slot: u64,
    inactivity_threshold_slots: u64,
) -> Result<bool> {
    let trigger_slot = last_check_in_slot
        .checked_add(inactivity_threshold_slots)
        .ok_or(LegacyError::MathOverflow)?;

    Ok(current_slot >= trigger_slot)
}
