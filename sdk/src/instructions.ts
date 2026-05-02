// sdk/src/instructions.ts
//
// All 15 instruction builders. Each returns a TransactionInstruction that the
// caller can add to any Transaction and sign with any wallet adapter. The SDK
// does not hold state — these are pure functions that construct account metas
// and encode instruction data from the supplied parameters.
//
// Instruction data layout: 8-byte Anchor discriminator + borsh-encoded args.
// Anchor discriminator = sha256("global:snake_case_instruction_name")[0..8].
//
// Account ordering matches the Rust Accounts struct field order exactly.
// A wrong account position causes Anchor's constraint validation to reject the
// transaction with an opaque "constraint violation" error.

import {
  PublicKey,
  TransactionInstruction,
  AccountMeta,
  SystemProgram,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { CovenantType } from "./types";
import { deriveVaultPda, deriveActivityPda, deriveGuardianPda, deriveCovenantPda } from "./pda";

// ── Discriminator helpers ─────────────────────────────────────────────────────

function instructionDiscriminator(snakeName: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`global:${snakeName}`).digest(),
  ).slice(0, 8);
}

// Pre-compute all 15 discriminators at module load time.
const DISC: Record<string, Buffer> = {
  initializeVault:       instructionDiscriminator("initialize_vault"),
  configureThreshold:    instructionDiscriminator("configure_threshold"),
  deposit:               instructionDiscriminator("deposit"),
  closeVault:            instructionDiscriminator("close_vault"),
  addGuardian:           instructionDiscriminator("add_guardian"),
  removeGuardian:        instructionDiscriminator("remove_guardian"),
  createCovenant:        instructionDiscriminator("create_covenant"),
  guardianSign:          instructionDiscriminator("guardian_sign"),
  executeCovenant:       instructionDiscriminator("execute_covenant"),
  checkIn:               instructionDiscriminator("check_in"),
  anomalyFlag:           instructionDiscriminator("anomaly_flag"),
  triggerInheritance:    instructionDiscriminator("trigger_inheritance"),
  claimInheritance:      instructionDiscriminator("claim_inheritance"),
  emergencySweep:        instructionDiscriminator("emergency_sweep"),
  closeOrphanedCovenant: instructionDiscriminator("close_orphaned_covenant"),
};

// ── Encoding helpers ──────────────────────────────────────────────────────────

function encodeU64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

function encodeU8(n: number): Buffer {
  return Buffer.from([n & 0xff]);
}

function encodePubkey(pk: PublicKey): Buffer {
  return Buffer.from(pk.toBytes());
}

// ── Account meta constructors ─────────────────────────────────────────────────

function rw(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: true };
}

function ro(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false };
}

function signer(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: true, isWritable: false };
}

function signerRw(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: true, isWritable: true };
}

// ── 1. initializeVault ────────────────────────────────────────────────────────

export interface InitializeVaultParams {
  programId:               PublicKey;
  owner:                   PublicKey;
  beneficiary:             PublicKey;
  vaultIndex:              bigint;
  inactivityThresholdSlots: bigint;
}

/**
 * Creates a new VaultAccount and ActivityAccount for the owner.
 * The vault_index differentiates multiple vaults owned by the same wallet.
 * Pass inactivityThresholdSlots = 0n to use the protocol default (~29 days).
 */
export function buildInitializeVaultIx(p: InitializeVaultParams): TransactionInstruction {
  const [vaultPda]    = deriveVaultPda(p.programId, p.owner, p.vaultIndex);
  const [activityPda] = deriveActivityPda(p.programId, vaultPda);

  const data = Buffer.concat([
    DISC["initializeVault"],
    encodeU64(p.vaultIndex),
    encodeU64(p.inactivityThresholdSlots),
  ]);

  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.owner),
      ro(p.beneficiary),
      rw(vaultPda),
      rw(activityPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// ── 2. configureThreshold ─────────────────────────────────────────────────────

export interface ConfigureThresholdParams {
  programId:        PublicKey;
  owner:            PublicKey;
  vaultPda:         PublicKey;
  newThresholdSlots: bigint;
}

/** Updates the vault's inactivity threshold. Resets progressive warning flags. */
export function buildConfigureThresholdIx(p: ConfigureThresholdParams): TransactionInstruction {
  const data = Buffer.concat([
    DISC["configureThreshold"],
    encodeU64(p.newThresholdSlots),
  ]);

  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.owner),
      rw(p.vaultPda),
    ],
    data,
  });
}

// ── 3. deposit ────────────────────────────────────────────────────────────────

export interface DepositParams {
  programId: PublicKey;
  owner:     PublicKey;
  vaultPda:  PublicKey;
  lamports:  bigint;
}

/** Transfers lamports from the owner into the vault PDA. */
export function buildDepositIx(p: DepositParams): TransactionInstruction {
  const data = Buffer.concat([
    DISC["deposit"],
    encodeU64(p.lamports),
  ]);

  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.owner),
      rw(p.vaultPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// ── 4. closeVault ─────────────────────────────────────────────────────────────

export interface CloseVaultParams {
  programId:   PublicKey;
  owner:       PublicKey;
  vaultPda:    PublicKey;
  activityPda: PublicKey;
}

/**
 * Closes the vault and activity accounts, returning all lamports to the owner.
 * Requires deposited_lamports == 0 and guardian_count == 0.
 */
export function buildCloseVaultIx(p: CloseVaultParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.owner),
      rw(p.vaultPda),
      rw(p.activityPda),
      ro(SystemProgram.programId),
    ],
    data: DISC["closeVault"],
  });
}

// ── 5. addGuardian ────────────────────────────────────────────────────────────

export interface AddGuardianParams {
  programId:      PublicKey;
  owner:          PublicKey;
  vaultPda:       PublicKey;
  guardian:       PublicKey;
  mOfNThreshold:  number;
}

/** Registers a new guardian for the vault and sets the M-of-N threshold. */
export function buildAddGuardianIx(p: AddGuardianParams): TransactionInstruction {
  const [guardianAccountPda] = deriveGuardianPda(p.programId, p.vaultPda, p.guardian);

  const data = Buffer.concat([
    DISC["addGuardian"],
    encodeU8(p.mOfNThreshold),
  ]);

  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.owner),
      rw(p.vaultPda),
      ro(p.guardian),
      rw(guardianAccountPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// ── 6. removeGuardian ─────────────────────────────────────────────────────────

export interface RemoveGuardianParams {
  programId:        PublicKey;
  owner:            PublicKey;
  vaultPda:         PublicKey;
  guardian:         PublicKey;
  guardianAccountPda: PublicKey;
}

/**
 * Phase 1: Initiates the guardian removal timelock.
 * Phase 2: Finalises removal after GUARDIAN_REMOVAL_TIMELOCK_SLOTS have elapsed.
 * The same instruction handles both phases — the program detects the phase
 * from removal_requested_slot being zero (Phase 1) or non-zero (Phase 2).
 */
export function buildRemoveGuardianIx(p: RemoveGuardianParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.owner),
      rw(p.vaultPda),
      ro(p.guardian),
      rw(p.guardianAccountPda),
    ],
    data: DISC["removeGuardian"],
  });
}

// ── 7. createCovenant ────────────────────────────────────────────────────────

export interface CreateCovenantParams {
  programId:        PublicKey;
  guardian:         PublicKey;
  vaultPda:         PublicKey;
  guardianAccountPda: PublicKey;
  covenantIndex:    bigint;    // vault.covenant_counter BEFORE increment
  covenantType:     CovenantType;
  target:           PublicKey; // new beneficiary or guardian to remove
}

/**
 * Opens a new covenant. The calling guardian is automatically the first signer.
 * covenantIndex must equal vault.covenant_counter at the time of submission.
 */
export function buildCreateCovenantIx(p: CreateCovenantParams): TransactionInstruction {
  const [covenantPda] = deriveCovenantPda(p.programId, p.vaultPda, p.covenantIndex);

  const data = Buffer.concat([
    DISC["createCovenant"],
    encodeU8(p.covenantType), // borsh enum discriminant as u8
    encodePubkey(p.target),
  ]);

  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.guardian),
      rw(p.vaultPda),
      ro(p.guardianAccountPda),
      rw(covenantPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// ── 8. guardianSign ───────────────────────────────────────────────────────────

export interface GuardianSignParams {
  programId:        PublicKey;
  guardian:         PublicKey;
  vaultPda:         PublicKey;
  guardianAccountPda: PublicKey;
  covenantPda:      PublicKey;
}

/** Adds the calling guardian's signature to an open covenant. */
export function buildGuardianSignIx(p: GuardianSignParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.guardian),
      ro(p.vaultPda),            // vault is read-only for guardianSign
      ro(p.guardianAccountPda),
      rw(p.covenantPda),
    ],
    data: DISC["guardianSign"],
  });
}

// ── 9. executeCovenant ────────────────────────────────────────────────────────

export interface ExecuteCovenantParams {
  programId:         PublicKey;
  caller:            PublicKey;
  vaultPda:          PublicKey;
  covenantPda:       PublicKey;
  /** Required for GuardianRemoval covenants. Omit (pass undefined) for BeneficiaryChange. */
  targetGuardianPda?: PublicKey;
}

/**
 * Executes a BeneficiaryChange or GuardianRemoval covenant after M-of-N
 * signatures and the timelock have been satisfied.
 * EmergencySweep covenants must use buildEmergencySweepIx instead.
 */
export function buildExecuteCovenantIx(p: ExecuteCovenantParams): TransactionInstruction {
  const keys: AccountMeta[] = [
    signerRw(p.caller),
    rw(p.vaultPda),
    rw(p.covenantPda),
  ];

  // For GuardianRemoval, the target_guardian account is required.
  // For BeneficiaryChange, it is not passed — Anchor treats its absence as None.
  if (p.targetGuardianPda) {
    keys.push(rw(p.targetGuardianPda));
  }

  return new TransactionInstruction({
    programId: p.programId,
    keys,
    data: DISC["executeCovenant"],
  });
}

// ── 10. checkIn ──────────────────────────────────────────────────────────────

export interface CheckInParams {
  programId:   PublicKey;
  owner:       PublicKey;
  vaultPda:    PublicKey;
  activityPda: PublicKey;
}

/**
 * Owner proves they are alive. Resets the inactivity clock, updates the
 * statistical model, and clears any active anomaly flag.
 */
export function buildCheckInIx(p: CheckInParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signer(p.owner),     // owner is NOT isWritable for checkIn
      rw(p.vaultPda),
      rw(p.activityPda),
    ],
    data: DISC["checkIn"],
  });
}

// ── 11. anomalyFlag ───────────────────────────────────────────────────────────

export interface AnomalyFlagParams {
  programId:        PublicKey;
  guardian:         PublicKey;
  vaultPda:         PublicKey;
  guardianAccountPda: PublicKey;
  activityPda:      PublicKey;
}

/**
 * Any active guardian calls this when the owner's silence exceeds the
 * statistically expected interval. Does not trigger inheritance — only emits
 * an on-chain anomaly flag on the ActivityAccount.
 */
export function buildAnomalyFlagIx(p: AnomalyFlagParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signer(p.guardian),          // guardian is NOT isWritable for anomalyFlag
      ro(p.vaultPda),              // vault is read-only
      ro(p.guardianAccountPda),
      rw(p.activityPda),
    ],
    data: DISC["anomalyFlag"],
  });
}

// ── 12. triggerInheritance ────────────────────────────────────────────────────

export interface TriggerInheritanceParams {
  programId: PublicKey;
  caller:    PublicKey;
  vaultPda:  PublicKey;
}

/**
 * Permissionless. Anyone may call this once the inactivity threshold is crossed.
 * Flips vault.is_triggered = true so the beneficiary can call claimInheritance.
 *
 * NOTE: The instruction only requires caller and vault — the activity account is
 * NOT an account in the Rust Accounts struct for this instruction, contrary to
 * what the watcher IDL lists.
 */
export function buildTriggerInheritanceIx(p: TriggerInheritanceParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.caller),
      rw(p.vaultPda),
    ],
    data: DISC["triggerInheritance"],
  });
}

// ── 13. claimInheritance ──────────────────────────────────────────────────────

export interface ClaimInheritanceParams {
  programId:   PublicKey;
  beneficiary: PublicKey;
  vaultPda:    PublicKey;
  activityPda: PublicKey;
}

/**
 * The beneficiary calls this after trigger_inheritance to receive all lamports.
 * Closes both vault and activity accounts — no rent is permanently stranded.
 */
export function buildClaimInheritanceIx(p: ClaimInheritanceParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.beneficiary),
      rw(p.vaultPda),
      rw(p.activityPda),
      ro(SystemProgram.programId),
    ],
    data: DISC["claimInheritance"],
  });
}

// ── 14. emergencySweep ────────────────────────────────────────────────────────

export interface EmergencySweepParams {
  programId:   PublicKey;
  caller:      PublicKey;
  vaultPda:    PublicKey;
  beneficiary: PublicKey;
  covenantPda: PublicKey;
  activityPda: PublicKey;
}

/**
 * Permissionless. Executes an approved EmergencySweep covenant, immediately
 * draining all vault lamports to the beneficiary. Caller receives activity
 * and covenant rent reserves as a submission incentive.
 */
export function buildEmergencySweepIx(p: EmergencySweepParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.caller),
      rw(p.vaultPda),
      rw(p.beneficiary),
      rw(p.covenantPda),
      rw(p.activityPda),
      ro(SystemProgram.programId),
    ],
    data: DISC["emergencySweep"],
  });
}

// ── 15. closeOrphanedCovenant ─────────────────────────────────────────────────

export interface CloseOrphanedCovenantParams {
  programId:   PublicKey;
  caller:      PublicKey;
  vaultPda:    PublicKey;    // must be in triggered state
  covenantPda: PublicKey;
}

/**
 * Permissionless. Recovers rent from a CovenantAccount PDA that became
 * permanently unexecutable because the vault was triggered while it was open.
 * Caller receives the covenant rent reserve as a submission incentive.
 */
export function buildCloseOrphanedCovenantIx(p: CloseOrphanedCovenantParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      signerRw(p.caller),
      ro(p.vaultPda),    // vault is read-only — only checked for is_triggered
      rw(p.covenantPda),
    ],
    data: DISC["closeOrphanedCovenant"],
  });
}