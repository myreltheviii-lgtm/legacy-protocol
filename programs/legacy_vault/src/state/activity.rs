// state/activity.rs
//
// ActivityAccount stores the rolling statistical model of the owner's
// check-in behaviour. By accumulating historical intervals, the protocol can
// detect anomalies — unusually long silences — even before the hard inactivity
// threshold is crossed.

use anchor_lang::prelude::*;
use crate::constants::ACTIVITY_ACCOUNT_SIZE;

#[account]
pub struct ActivityAccount {
    /// The vault this activity record belongs to.
    pub vault: Pubkey,

    /// Total number of successful check-ins recorded.
    pub checkin_count: u64,

    /// Cumulative sum of all check-in intervals in slots. Dividing by
    /// `checkin_count` gives the rolling average interval. Using a sum rather
    /// than a running average avoids precision loss from repeated integer
    /// division.
    pub sum_of_intervals: u64,

    /// The interval (in slots) between the two most recent check-ins. Kept
    /// separate so the anomaly detector can compare the current silence against
    /// the historical average without waiting for the next check-in to update
    /// sum_of_intervals.
    pub last_interval: u64,

    /// Set to true by `anomaly_flag`. Cleared back to false on every successful
    /// `check_in`. Protected against double-set by AnomalyAlreadyFlagged.
    pub anomaly_flagged: bool,

    /// The slot at which the most recent anomaly flag was raised. Zero if no
    /// flag is currently active. The watcher correlates notification timing
    /// from this timestamp — overwriting it silently loses the original
    /// detection moment.
    pub anomaly_flagged_slot: u64,

    /// The canonical bump seed for this PDA.
    pub bump: u8,
}

impl ActivityAccount {
    pub const LEN: usize = ACTIVITY_ACCOUNT_SIZE;
}
