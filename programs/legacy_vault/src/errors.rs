// errors.rs
//
// Anchor surfaces these as on-chain error codes. Every failure path must map
// to one of these — generic panics are never acceptable in a protocol handling
// real user funds.
//
// Error codes are assigned by Anchor in declaration order starting at 6000:
//   variant 0  = code 6000 (UnauthorisedOwner)
//   variant 29 = code 6029 (MathOverflow)
// All 30 codes must be present in the SDK's decodeLegacyError map.

use anchor_lang::prelude::*;

#[error_code]
pub enum LegacyError {
    // ── Authorisation ────────────────────────────────────────────────────────

    #[msg("Only the vault owner can perform this action.")]
    UnauthorisedOwner,           // 6000

    #[msg("Only an active guardian of this vault can perform this action.")]
    UnauthorisedGuardian,        // 6001

    #[msg("Only the vault beneficiary can claim.")]
    UnauthorisedBeneficiary,     // 6002

    // ── Vault state ──────────────────────────────────────────────────────────

    #[msg("The vault has already been triggered for inheritance.")]
    VaultAlreadyTriggered,       // 6003

    #[msg("The inheritance threshold has not been reached yet.")]
    VaultNotTriggered,           // 6004

    #[msg("The vault has already been claimed.")]
    VaultAlreadyClaimed,         // 6005

    #[msg("The vault has already been emergency-swept.")]
    VaultAlreadySwept,           // 6006

    #[msg("Drain the vault before closing it.")]
    VaultNotEmpty,               // 6007

    // ── Threshold / timing ───────────────────────────────────────────────────

    #[msg("Inactivity threshold is below the protocol minimum.")]
    ThresholdTooLow,             // 6008

    #[msg("Inactivity threshold exceeds the protocol maximum.")]
    ThresholdTooHigh,            // 6009

    #[msg("The inactivity threshold has not been reached yet.")]
    ThresholdNotReached,         // 6010

    // ── Guardian management ──────────────────────────────────────────────────

    #[msg("This vault has reached the maximum number of guardians.")]
    TooManyGuardians,            // 6011

    #[msg("All guardians must be removed before the vault can be closed.")]
    GuardiansStillRegistered,    // 6012

    #[msg("Guardian does not belong to this vault.")]
    GuardianVaultMismatch,       // 6013

    #[msg("This guardian has already been removed.")]
    GuardianAlreadyInactive,     // 6014

    #[msg("No removal request is pending for this guardian.")]
    NoRemovalPending,            // 6015

    #[msg("The guardian removal timelock has not elapsed yet.")]
    RemovalTimelockActive,       // 6016

    #[msg("M-of-N threshold cannot exceed the number of active guardians.")]
    ThresholdExceedsGuardianCount, // 6017

    #[msg("M-of-N threshold must be at least 1.")]
    ThresholdTooSmall,           // 6018

    // ── Covenant ─────────────────────────────────────────────────────────────

    #[msg("This guardian has already signed this covenant.")]
    AlreadySigned,               // 6019

    #[msg("This covenant has already been executed.")]
    CovenantAlreadyExecuted,     // 6020

    #[msg("Not enough guardian signatures on this covenant.")]
    InsufficientSignatures,      // 6021

    #[msg("The covenant timelock has not elapsed yet.")]
    CovenantTimelockActive,      // 6022

    #[msg("Covenant type mismatch for this instruction.")]
    CovenantTypeMismatch,        // 6023

    #[msg("Covenant does not belong to this vault.")]
    CovenantVaultMismatch,       // 6024

    // ── Anomaly detection ────────────────────────────────────────────────────

    /// Protecting anomaly_flagged_slot integrity: a second flag would overwrite
    /// the original detection timestamp relied on by the off-chain watcher.
    #[msg("An anomaly flag is already active on this vault.")]
    AnomalyAlreadyFlagged,       // 6025

    // ── Input validation ─────────────────────────────────────────────────────

    #[msg("Beneficiary cannot be the zero address.")]
    InvalidBeneficiary,          // 6026

    #[msg("Lamport amount must be greater than zero.")]
    ZeroAmount,                  // 6027

    /// Prevents zero-interval check-ins from poisoning the statistical model.
    #[msg("A check-in was already submitted in this slot.")]
    SameSlotCheckIn,             // 6028

    // ── Arithmetic ──────────────────────────────────────────────────────────

    #[msg("Arithmetic overflow.")]
    MathOverflow,                // 6029
}
