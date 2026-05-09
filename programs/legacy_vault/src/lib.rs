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
// Cloak integration (v2):
//   Two new instructions: record_cloak_deposit, record_cloak_claim.
//   initialize_vault now takes beneficiary_utxo_pubkey: [u8;32] instead of
//   a beneficiary account. See instructions/initialize_vault.rs for details.
//
// Panic-freedom invariant:
//   Every instruction handler in this program is statically panic-free. All
//   fallible operations use checked arithmetic and propagate LegacyError on
//   overflow. No unwrap(), no expect(), no panic!(), no unreachable!().

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::CovenantType;

declare_id!("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");

#[program]
pub mod legacy_vault {
    use super::*;

    // ── Vault lifecycle ───────────────────────────────────────────────────────

    /// Creates a new VaultAccount and ActivityAccount for the caller.
    /// `vault_index` allows one owner to maintain multiple vaults.
    /// `inactivity_threshold_slots` defaults to the protocol minimum if 0.
    /// `beneficiary_utxo_pubkey` is the 32-byte Cloak UTXO public key of the
    /// intended beneficiary (generated client-side via generateUtxoKeypair()).
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_index: u64,
        inactivity_threshold_slots: u64,
        beneficiary_utxo_pubkey: [u8; 32],
    ) -> Result<()> {
        initialize_vault::handler(ctx, vault_index, inactivity_threshold_slots, beneficiary_utxo_pubkey)
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
    /// For Cloak-shielded vaults, use record_cloak_deposit instead.
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
    /// statistically expected interval.
    pub fn anomaly_flag(ctx: Context<AnomalyFlag>) -> Result<()> {
        anomaly_flag::handler(ctx)
    }

    // ── Inheritance ───────────────────────────────────────────────────────────

    /// Permissionless. Anyone may call this once the inactivity threshold is
    /// crossed. Flips `vault.is_triggered` to true.
    pub fn trigger_inheritance(ctx: Context<TriggerInheritance>) -> Result<()> {
        trigger_inheritance::handler(ctx)
    }

    /// Non-shielded vaults: the beneficiary calls this to receive all lamports.
    /// For shielded vaults, use guardians + record_cloak_claim instead.
    pub fn claim_inheritance(ctx: Context<ClaimInheritance>) -> Result<()> {
        claim_inheritance::handler(ctx)
    }

    /// Executes an approved EmergencySweep covenant. Non-shielded vaults only.
    /// For shielded vaults, guardians must use the off-chain Cloak transfer.
    pub fn emergency_sweep(ctx: Context<EmergencySweep>) -> Result<()> {
        emergency_sweep::handler(ctx)
    }

    // ── Orphaned account cleanup ──────────────────────────────────────────────

    /// Recovers rent from a CovenantAccount PDA that became permanently
    /// unexecutable when the vault was triggered.
    pub fn close_orphaned_covenant(ctx: Context<CloseOrphanedCovenant>) -> Result<()> {
        close_orphaned_covenant::handler(ctx)
    }

    // ── Cloak integration ─────────────────────────────────────────────────────

    /// Records an off-chain Cloak shielded deposit. The owner calls this after
    /// successfully calling `transact()` in the Cloak SDK. No SOL moves through
    /// this instruction — it only records the UTXO commitment for guardian use.
    pub fn record_cloak_deposit(
        ctx: Context<RecordCloakDeposit>,
        utxo_commitment:   [u8; 32],
        utxo_leaf_index:   u64,
        shielded_lamports: u64,
    ) -> Result<()> {
        record_cloak_deposit::handler(ctx, utxo_commitment, utxo_leaf_index, shielded_lamports)
    }

    /// Permissionless. Closes Anchor accounts after guardians have completed
    /// the off-chain Cloak shield-to-shield inheritance transfer.
    /// The caller receives vault + activity rent as a submission incentive.
    pub fn record_cloak_claim(
        ctx: Context<RecordCloakClaim>,
        cloak_transfer_signature: [u8; 64],
    ) -> Result<()> {
        record_cloak_claim::handler(ctx, cloak_transfer_signature)
    }
}
