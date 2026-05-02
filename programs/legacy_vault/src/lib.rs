// lib.rs
//
// Program entry point for Legacy Vault. The `#[program]` macro generates the
// BPF entrypoint and the IDL that the TypeScript SDK consumes. Every public
// function here is a top-level instruction that a client can call.
//
// Architecture: handlers live in their own instruction modules. This file only
// routes — it contains no business logic, making each instruction independently
// auditable.
//
// Panic-freedom invariant (Level 4):
//   Every instruction handler in this program is statically panic-free. All
//   fallible operations use checked arithmetic (checked_add, checked_sub,
//   checked_mul, checked_div) and propagate LegacyError::MathOverflow on
//   overflow — they never panic. The only unwrap/expect calls are on
//   Clock::get() and bump lookups in account constraint contexts, both of
//   which are infallible in the BPF runtime. This invariant must be maintained
//   on every future change: no unwrap(), no expect(), no panic!(), no
//   unreachable!() (the existing match arms in execute_covenant use
//   return err!() instead of unreachable!() for exactly this reason).

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::CovenantType;

// Replace this with the output of `anchor build` on first compile.
declare_id!("7h9BH7d9aHGuPubFc6s9GCYDwtWrFNGB8kKKKV8YaSAe");

#[program]
pub mod legacy_vault {
    use super::*;

    // ── Vault lifecycle ───────────────────────────────────────────────────────

    /// Creates a new VaultAccount and ActivityAccount for the caller.
    /// `vault_index` allows one owner to maintain multiple vaults.
    /// `inactivity_threshold_slots` defaults to the protocol minimum if 0.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_index: u64,
        inactivity_threshold_slots: u64,
    ) -> Result<()> {
        initialize_vault::handler(ctx, vault_index, inactivity_threshold_slots)
    }

    /// Updates the inactivity threshold on an existing vault.
    /// Resets progressive warning flags so the watcher recalculates milestones.
    pub fn configure_threshold(
        ctx: Context<ConfigureThreshold>,
        new_threshold_slots: u64,
    ) -> Result<()> {
        configure_threshold::handler(ctx, new_threshold_slots)
    }

    /// Transfers lamports from the owner into the vault PDA.
    pub fn deposit(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
        deposit::handler(ctx, lamports)
    }

    /// Closes the vault and returns all lamports to the owner.
    /// Requires `deposited_lamports == 0` and `is_triggered == false`.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        close_vault::handler(ctx)
    }

    // ── Guardian management ───────────────────────────────────────────────────

    /// Registers a new guardian and updates the M-of-N threshold.
    pub fn add_guardian(
        ctx: Context<AddGuardian>,
        m_of_n_threshold: u8,
    ) -> Result<()> {
        add_guardian::handler(ctx, m_of_n_threshold)
    }

    /// Phase 1: initiates the removal timelock for a guardian.
    /// Phase 2: finalises the removal after the timelock has elapsed.
    /// Calling this instruction twice (once per phase) is intentional.
    pub fn remove_guardian(ctx: Context<RemoveGuardian>) -> Result<()> {
        remove_guardian::handler(ctx)
    }

    // ── Covenant (multi-guardian approval) ───────────────────────────────────

    /// Opens a new covenant. The calling guardian is automatically the first
    /// signer. Other guardians call `guardian_sign` to add their signatures.
    pub fn create_covenant(
        ctx: Context<CreateCovenant>,
        covenant_type: CovenantType,
        target: Pubkey,
    ) -> Result<()> {
        create_covenant::handler(ctx, covenant_type, target)
    }

    /// Adds a guardian's signature to an open covenant.
    pub fn guardian_sign(ctx: Context<GuardianSign>) -> Result<()> {
        guardian_sign::handler(ctx)
    }

    /// Executes a BeneficiaryChange or GuardianRemoval covenant after the
    /// required signatures and timelock have been satisfied.
    pub fn execute_covenant(ctx: Context<ExecuteCovenant>) -> Result<()> {
        execute_covenant::handler(ctx)
    }

    // ── Check-in ──────────────────────────────────────────────────────────────

    /// Owner proves they are alive. Resets the inactivity clock, updates the
    /// statistical model, and clears any active anomaly flag.
    pub fn check_in(ctx: Context<CheckIn>) -> Result<()> {
        check_in::handler(ctx)
    }

    /// Any active guardian may call this when the owner's silence exceeds the
    /// statistically expected interval. Emits an on-chain signal without
    /// triggering inheritance.
    pub fn anomaly_flag(ctx: Context<AnomalyFlag>) -> Result<()> {
        anomaly_flag::handler(ctx)
    }

    // ── Inheritance ───────────────────────────────────────────────────────────

    /// Permissionless. Anyone may call this once the inactivity threshold is
    /// crossed. Flips `vault.is_triggered` to true.
    pub fn trigger_inheritance(ctx: Context<TriggerInheritance>) -> Result<()> {
        trigger_inheritance::handler(ctx)
    }

    /// The beneficiary calls this after the vault is triggered to receive all
    /// lamports. Closes the activity account simultaneously.
    pub fn claim_inheritance(ctx: Context<ClaimInheritance>) -> Result<()> {
        claim_inheritance::handler(ctx)
    }

    // ── Emergency ─────────────────────────────────────────────────────────────

    /// Executes an approved EmergencySweep covenant. Transfers all vault
    /// lamports to the beneficiary immediately.
    pub fn emergency_sweep(ctx: Context<EmergencySweep>) -> Result<()> {
        emergency_sweep::handler(ctx)
    }

    // ── Orphaned account cleanup ──────────────────────────────────────────────

    /// Recovers rent from a CovenantAccount PDA that became permanently
    /// unexecutable when the vault was triggered.
    pub fn close_orphaned_covenant(ctx: Context<CloseOrphanedCovenant>) -> Result<()> {
        close_orphaned_covenant::handler(ctx)
    }
}
