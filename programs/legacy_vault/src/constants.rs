// constants.rs
//
// Every magic number in the protocol lives here. On-chain programs should
// never have bare literals scattered across instruction handlers — a single
// source of truth makes auditing and parameter tuning straightforward.

/// PDA seed for the VaultAccount.
pub const VAULT_SEED: &[u8] = b"vault";

/// PDA seed for the ActivityAccount.
pub const ACTIVITY_SEED: &[u8] = b"activity";

/// PDA seed for a GuardianAccount.
pub const GUARDIAN_SEED: &[u8] = b"guardian";

/// PDA seed for a CovenantAccount.
pub const COVENANT_SEED: &[u8] = b"covenant";

// ─── Inactivity / check-in ───────────────────────────────────────────────────

/// Default inactivity threshold in slots if the owner does not supply one.
/// ~2 slots/second × 5_000_000 ≈ 29 days.
pub const DEFAULT_INACTIVITY_THRESHOLD_SLOTS: u64 = 5_000_000;

/// Minimum inactivity threshold. 432_000 slots ≈ 2 days.
pub const MIN_INACTIVITY_THRESHOLD_SLOTS: u64 = 432_000;

/// Maximum inactivity threshold. 157_680_000 slots ≈ ~2.5 years.
pub const MAX_INACTIVITY_THRESHOLD_SLOTS: u64 = 157_680_000;

// ─── Progressive warning percentages ─────────────────────────────────────────

/// First warning checkpoint as a percentage of the threshold (75%).
pub const WARNING_SLOT_PCT_75: u64 = 75;

/// Second warning checkpoint (90%).
pub const WARNING_SLOT_PCT_90: u64 = 90;

// ─── Anomaly detection ────────────────────────────────────────────────────────

/// Multiplier (×100 for integer math) above the historical average check-in
/// interval that constitutes a suspicious silence. 150 = 1.5×.
pub const ANOMALY_MULTIPLIER_PCT: u64 = 150;

// ─── Guardian limits ─────────────────────────────────────────────────────────

/// Maximum number of guardians a single vault can register.
pub const MAX_GUARDIANS: u8 = 10;

/// Minimum required M-of-N threshold.
pub const MIN_M_OF_N: u8 = 1;

// ─── Timelocks ────────────────────────────────────────────────────────────────

/// Slots a guardian removal request must sit before it can be finalised.
/// 216_000 slots ≈ 30 hours.
pub const GUARDIAN_REMOVAL_TIMELOCK_SLOTS: u64 = 216_000;

/// Slots a beneficiary-change covenant must wait after reaching M-of-N.
/// 432_000 slots ≈ 2 days.
pub const BENEFICIARY_CHANGE_TIMELOCK_SLOTS: u64 = 432_000;

/// Emergency sweep covenants carry no timelock — speed is the design requirement.
pub const EMERGENCY_SWEEP_TIMELOCK_SLOTS: u64 = 0;

/// Guardian removal via covenant is immediate — delay only benefits the
/// compromised key. The owner-gated path carries its own separate timelock.
pub const GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS: u64 = 0;

// ─── Covenant limits ─────────────────────────────────────────────────────────

/// Maximum guardians that can sign a single covenant.
pub const MAX_COVENANT_SIGNERS: usize = 10;

// ─── Account space calculations ──────────────────────────────────────────────
// Anchor prepends an 8-byte discriminator to every account.

pub const DISCRIMINATOR: usize = 8;

/// Space required by VaultAccount on-chain.
pub const VAULT_ACCOUNT_SIZE: usize =
    DISCRIMINATOR
    + 32  // owner: Pubkey
    + 32  // beneficiary: Pubkey
    + 1   // guardian_count: u8
    + 1   // m_of_n_threshold: u8
    + 8   // inactivity_threshold_slots: u64
    + 8   // last_check_in_slot: u64
    + 8   // created_slot: u64
    + 8   // deposited_lamports: u64
    + 8   // covenant_counter: u64
    + 8   // vault_index: u64
    + 1   // is_triggered: bool
    + 1   // is_claimed: bool
    + 1   // is_emergency_swept: bool
    + 1   // warning_75_sent: bool
    + 1   // warning_90_sent: bool
    + 1;  // bump: u8
// = 128 bytes

/// Space required by ActivityAccount on-chain.
pub const ACTIVITY_ACCOUNT_SIZE: usize =
    DISCRIMINATOR
    + 32  // vault: Pubkey
    + 8   // checkin_count: u64
    + 8   // sum_of_intervals: u64
    + 8   // last_interval: u64
    + 1   // anomaly_flagged: bool
    + 8   // anomaly_flagged_slot: u64
    + 1;  // bump: u8
// = 74 bytes

/// Space required by GuardianAccount on-chain.
pub const GUARDIAN_ACCOUNT_SIZE: usize =
    DISCRIMINATOR
    + 32  // vault: Pubkey
    + 32  // guardian: Pubkey
    + 1   // is_active: bool
    + 8   // added_slot: u64
    + 8   // removal_requested_slot: u64 (0 = no request pending)
    + 1;  // bump: u8
// = 90 bytes

/// Space required by CovenantAccount on-chain.
/// Vec<Pubkey> = 4-byte length prefix + 32 bytes × MAX_COVENANT_SIGNERS.
pub const COVENANT_ACCOUNT_SIZE: usize =
    DISCRIMINATOR
    + 32                              // vault: Pubkey
    + 1                               // covenant_type: CovenantType discriminant
    + 32                              // target: Pubkey
    + 4 + (32 * MAX_COVENANT_SIGNERS) // signers: Vec<Pubkey>
    + 1                               // required_signatures: u8
    + 8                               // created_slot: u64
    + 8                               // timelock_slots: u64
    + 8                               // signatures_complete_slot: u64
    + 8                               // covenant_index: u64
    + 1                               // is_executed: bool
    + 1;                              // bump: u8
// = 432 bytes
