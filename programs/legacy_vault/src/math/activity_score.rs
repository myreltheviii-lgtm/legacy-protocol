// math/activity_score.rs
//
// Computes two related metrics:
//
//   1. The "inactivity score" — a percentage from 0 to 100+ representing how
//      far the vault has progressed toward its trigger threshold.
//
//   2. The "anomaly check" — whether the current silence is statistically
//      unusual given the owner's historical check-in behaviour.
//
// All arithmetic is integer-only. Multiply before dividing everywhere to
// preserve precision without floating point.

use crate::constants::{ANOMALY_MULTIPLIER_PCT, WARNING_SLOT_PCT_75, WARNING_SLOT_PCT_90};
use crate::errors::LegacyError;
use anchor_lang::prelude::*;

/// Represents the zone the vault's inactivity score currently occupies.
#[derive(PartialEq, Eq, Debug)]
pub enum ActivityZone {
    /// 0–74%: Everything is fine. Silent monitoring.
    Green,
    /// 75–89%: Unusual silence. Guardian ping warranted.
    Yellow,
    /// 90–99%: Critical silence. Beneficiary warning warranted.
    Orange,
    /// 100%+: Threshold crossed. Vault is claimable.
    Red,
}

/// Computes the inactivity score as an integer percentage.
///
/// Score = (elapsed_slots × 100) / threshold_slots. Multiply first to
/// preserve precision without floating point. Returns 0 for clock regression
/// or a zero threshold (configuration error caught at write time).
pub fn compute_inactivity_score(
    current_slot: u64,
    last_check_in_slot: u64,
    inactivity_threshold_slots: u64,
) -> Result<u64> {
    if inactivity_threshold_slots == 0 {
        return Ok(0);
    }

    if current_slot <= last_check_in_slot {
        return Ok(0);
    }

    let elapsed = current_slot
        .checked_sub(last_check_in_slot)
        .ok_or(LegacyError::MathOverflow)?;

    let score = elapsed
        .checked_mul(100)
        .ok_or(LegacyError::MathOverflow)?
        .checked_div(inactivity_threshold_slots)
        .ok_or(LegacyError::MathOverflow)?;

    Ok(score)
}

/// Maps an inactivity score (0–∞) to a named zone.
pub fn classify_zone(score: u64) -> ActivityZone {
    if score < WARNING_SLOT_PCT_75 {
        ActivityZone::Green
    } else if score < WARNING_SLOT_PCT_90 {
        ActivityZone::Yellow
    } else if score < 100 {
        ActivityZone::Orange
    } else {
        ActivityZone::Red
    }
}

/// Returns true if the current silence is anomalous relative to the owner's
/// historical average check-in interval.
///
/// Condition: elapsed > (sum_of_intervals × ANOMALY_MULTIPLIER_PCT) / checkin_count / 100
///
/// Multiplying sum by the percentage multiplier FIRST ensures subsequent
/// integer divisions operate on the largest possible numerator, minimising
/// rounding loss. Dividing checkin_count first (computing the average before
/// applying the multiplier) introduces a systematic negative bias — the
/// truncated average is smaller than the true value, so the threshold is lower
/// than intended and anomaly_flag fires prematurely.
pub fn is_anomalous(
    current_slot: u64,
    last_check_in_slot: u64,
    checkin_count: u64,
    sum_of_intervals: u64,
) -> Result<bool> {
    if checkin_count == 0 || sum_of_intervals == 0 {
        return Ok(false);
    }

    if current_slot <= last_check_in_slot {
        return Ok(false);
    }

    let elapsed = current_slot
        .checked_sub(last_check_in_slot)
        .ok_or(LegacyError::MathOverflow)?;

    let anomaly_threshold = sum_of_intervals
        .checked_mul(ANOMALY_MULTIPLIER_PCT)
        .ok_or(LegacyError::MathOverflow)?
        .checked_div(checkin_count)
        .ok_or(LegacyError::MathOverflow)?
        .checked_div(100)
        .ok_or(LegacyError::MathOverflow)?;

    Ok(elapsed > anomaly_threshold)
}
