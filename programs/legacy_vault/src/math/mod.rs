// math/mod.rs
pub mod activity_score;
pub mod threshold_calc;

pub use activity_score::{classify_zone, compute_inactivity_score, is_anomalous, ActivityZone};
pub use threshold_calc::{compute_milestones, threshold_crossed, ThresholdMilestones};
