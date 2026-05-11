// sdk/src/instructions.ts
//
// Instruction builders for the Legacy Vault program. Each function returns a
// TransactionInstruction ready to include in a transaction.
//
// Discriminators are the first 8 bytes of sha256("global:instruction_name").

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { CovenantType } from "./types";

// ── Discriminator ─────────────────────────────────────────────────────────────

function disc(name: string): Buffer {
  return Buffer.from(createHash("sha256").update(`global:${name}`).digest()).slice(0, 8);
}

const DISC_INITIALIZE_VAULT        = disc("initialize_vault");
const DISC_CONFIGURE_THRESHOLD     = disc("configure_threshold");
const DISC_DEPOSIT                 = disc("deposit");
const DISC_CLOSE_VAULT             = disc("close_vault");
const DISC_ADD_GUARDIAN            = disc("add_guardian");
const DISC_REMOVE_GUARDIAN         = disc("remove_guardian");
const DISC_CREATE_COVENANT         = disc("create_covenant");
const DISC_GUARDIAN_SIGN           = disc("guardian_sign");
const DISC_EXECUTE_COVENANT        = disc("execute_covenant");
const DISC_CHECK_IN                = disc("check_in");
const DISC_ANOMALY_FLAG            = disc("anomaly_flag");
const DISC_TRIGGER_INHERITANCE     = disc("trigger_inheritance");
const DISC_CLAIM_INHERITANCE       = disc("claim_inheritance");
const DISC_EMERGENCY_SWEEP         = disc("emergency_sweep");
const DISC_CLOSE_ORPHANED_COVENANT = disc("close_orphaned_covenant");
const DISC_RECORD_CLOAK_DEPOSIT    = disc("record_cloak_deposit");
const DISC_RECORD_CLOAK_CLAIM      = disc("record_cloak_claim");

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeU64LE(value: bigint, buf: Buffer, offset: number): void {
  let v = value;
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function writeU8(value: number, buf: Buffer, offset: number): void {
  buf.writeUInt8(value, offset);
}

function signerRw(pubkey: PublicKey) { return { pubkey, isSigner: true,  isWritable: true  }; }
function signerRo(pubkey: PublicKey) { return { pubkey, isSigner: true,  isWritable: false }; }
function rw(pubkey: PublicKey)       { return { pubkey, isSigner: false, isWritable: true  }; }
function ro(pubkey: PublicKey)       { return { pubkey, isSigner: false, isWritable: false }; }

// ── initialize_vault ─────────────────────────────────────────────────────────

/**
 * Builds an initialize_vault instruction.
 *
 * @param beneficiaryUtxoPubkey  32-byte Cloak UTXO pubkey of the beneficiary.
 *                               For non-shielded vaults, pass the raw bytes of
 *                               the Solana beneficiary pubkey.
 */
export function buildInitializeVaultIx(params: {
  programId:              PublicKey;
  owner:                  PublicKey;
  vaultPda:               PublicKey;
  activityPda:            PublicKey;
  vaultIndex:             bigint;
  inactivityThresholdSlots: bigint;
  beneficiaryUtxoPubkey:  Uint8Array;
}): TransactionInstruction {
  const { programId, owner, vaultPda, activityPda, vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey } = params;

  if (beneficiaryUtxoPubkey.length !== 32) {
    throw new Error("beneficiaryUtxoPubkey must be exactly 32 bytes");
  }

  // Layout: disc(8) + vault_index(8) + inactivity_threshold_slots(8) + beneficiary_utxo_pubkey(32)
  const data = Buffer.alloc(8 + 8 + 8 + 32);
  DISC_INITIALIZE_VAULT.copy(data, 0);
  writeU64LE(vaultIndex, data, 8);
  writeU64LE(inactivityThresholdSlots, data, 16);
  Buffer.from(beneficiaryUtxoPubkey).copy(data, 24);

  return new TransactionInstruction({
    programId,
    keys: [
      signerRw(owner),
      rw(vaultPda),
      rw(activityPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// ── configure_threshold ───────────────────────────────────────────────────────

export function buildConfigureThresholdIx(params: {
  programId:       PublicKey;
  owner:           PublicKey;
  vaultPda:        PublicKey;
  newThresholdSlots: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(8 + 8);
  DISC_CONFIGURE_THRESHOLD.copy(data, 0);
  writeU64LE(params.newThresholdSlots, data, 8);
  return new TransactionInstruction({
    programId: params.programId,
    keys: [signerRw(params.owner), rw(params.vaultPda)],
    data,
  });
}

// ── deposit ───────────────────────────────────────────────────────────────────

export function buildDepositIx(params: {
  programId: PublicKey;
  owner:     PublicKey;
  vaultPda:  PublicKey;
  lamports:  bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(8 + 8);
  DISC_DEPOSIT.copy(data, 0);
  writeU64LE(params.lamports, data, 8);
  return new TransactionInstruction({
    programId: params.programId,
    keys: [signerRw(params.owner), rw(params.vaultPda), ro(SystemProgram.programId)],
    data,
  });
}

// ── close_vault ───────────────────────────────────────────────────────────────

export function buildCloseVaultIx(params: {
  programId:   PublicKey;
  owner:       PublicKey;
  vaultPda:    PublicKey;
  activityPda: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.owner),
      rw(params.vaultPda),
      rw(params.activityPda),
      ro(SystemProgram.programId),
    ],
    data: DISC_CLOSE_VAULT,
  });
}

// ── add_guardian ──────────────────────────────────────────────────────────────

export function buildAddGuardianIx(params: {
  programId:          PublicKey;
  owner:              PublicKey;
  vaultPda:           PublicKey;
  guardian:           PublicKey;
  guardianAccountPda: PublicKey;
  mOfNThreshold:      number;
}): TransactionInstruction {
  const data = Buffer.alloc(8 + 1);
  DISC_ADD_GUARDIAN.copy(data, 0);
  writeU8(params.mOfNThreshold, data, 8);
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.owner),
      rw(params.vaultPda),
      ro(params.guardian),
      rw(params.guardianAccountPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// ── remove_guardian ───────────────────────────────────────────────────────────

export function buildRemoveGuardianIx(params: {
  programId:          PublicKey;
  owner:              PublicKey;
  vaultPda:           PublicKey;
  guardian:           PublicKey;
  guardianAccountPda: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.owner),
      rw(params.vaultPda),
      ro(params.guardian),
      rw(params.guardianAccountPda),
    ],
    data: DISC_REMOVE_GUARDIAN,
  });
}

// ── create_covenant ───────────────────────────────────────────────────────────

export function buildCreateCovenantIx(params: {
  programId:          PublicKey;
  guardian:           PublicKey;
  vaultPda:           PublicKey;
  guardianAccountPda: PublicKey;
  covenantPda:        PublicKey;
  covenantType:       CovenantType | number;  // 0=EmergencySweep,1=BeneficiaryChange,2=GuardianRemoval
  target:             PublicKey;
}): TransactionInstruction {
  const data = Buffer.alloc(8 + 1 + 32);
  DISC_CREATE_COVENANT.copy(data, 0);
  const ctDisc = typeof params.covenantType === 'number'
    ? params.covenantType
    : { [CovenantType.EmergencySweep]: 0, [CovenantType.BeneficiaryChange]: 1, [CovenantType.GuardianRemoval]: 2 }[params.covenantType as CovenantType] ?? 0;
  writeU8(ctDisc, data, 8);
  params.target.toBuffer().copy(data, 9);
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.guardian),
      rw(params.vaultPda),
      ro(params.guardianAccountPda),
      rw(params.covenantPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}

// ── guardian_sign ─────────────────────────────────────────────────────────────

export function buildGuardianSignIx(params: {
  programId:          PublicKey;
  guardian:           PublicKey;
  vaultPda:           PublicKey;
  guardianAccountPda: PublicKey;
  covenantPda:        PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.guardian),
      ro(params.vaultPda),
      ro(params.guardianAccountPda),
      rw(params.covenantPda),
    ],
    data: DISC_GUARDIAN_SIGN,
  });
}

// ── execute_covenant ──────────────────────────────────────────────────────────

export function buildExecuteCovenantIx(params: {
  programId:          PublicKey;
  caller:             PublicKey;
  vaultPda:           PublicKey;
  covenantPda:        PublicKey;
  targetGuardianPda?: PublicKey;
}): TransactionInstruction {
  const keys = [
    signerRw(params.caller),
    rw(params.vaultPda),
    rw(params.covenantPda),
  ];
  if (params.targetGuardianPda) {
    keys.push(rw(params.targetGuardianPda));
  }
  return new TransactionInstruction({
    programId: params.programId,
    keys,
    data: DISC_EXECUTE_COVENANT,
  });
}

// ── check_in ──────────────────────────────────────────────────────────────────

export function buildCheckInIx(params: {
  programId:   PublicKey;
  owner:       PublicKey;
  vaultPda:    PublicKey;
  activityPda: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRo(params.owner),
      rw(params.vaultPda),
      rw(params.activityPda),
    ],
    data: DISC_CHECK_IN,
  });
}

// ── anomaly_flag ──────────────────────────────────────────────────────────────

export function buildAnomalyFlagIx(params: {
  programId:          PublicKey;
  guardian:           PublicKey;
  vaultPda:           PublicKey;
  guardianAccountPda: PublicKey;
  activityPda:        PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRo(params.guardian),
      ro(params.vaultPda),
      ro(params.guardianAccountPda),
      rw(params.activityPda),
    ],
    data: DISC_ANOMALY_FLAG,
  });
}

// ── trigger_inheritance ───────────────────────────────────────────────────────

export function buildTriggerInheritanceIx(params: {
  programId: PublicKey;
  caller:    PublicKey;
  vaultPda:  PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [signerRw(params.caller), rw(params.vaultPda)],
    data: DISC_TRIGGER_INHERITANCE,
  });
}

// ── claim_inheritance ─────────────────────────────────────────────────────────

export function buildClaimInheritanceIx(params: {
  programId:   PublicKey;
  beneficiary: PublicKey;
  vaultPda:    PublicKey;
  activityPda: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.beneficiary),
      rw(params.vaultPda),
      rw(params.activityPda),
      ro(SystemProgram.programId),
    ],
    data: DISC_CLAIM_INHERITANCE,
  });
}

// ── emergency_sweep ───────────────────────────────────────────────────────────

export function buildEmergencySweepIx(params: {
  programId:   PublicKey;
  caller:      PublicKey;
  vaultPda:    PublicKey;
  beneficiary: PublicKey;
  covenantPda: PublicKey;
  activityPda: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.caller),
      rw(params.vaultPda),
      rw(params.beneficiary),
      rw(params.covenantPda),
      rw(params.activityPda),
      ro(SystemProgram.programId),
    ],
    data: DISC_EMERGENCY_SWEEP,
  });
}

// ── close_orphaned_covenant ───────────────────────────────────────────────────

export function buildCloseOrphanedCovenantIx(params: {
  programId:   PublicKey;
  caller:      PublicKey;
  vaultPda:    PublicKey;
  covenantPda: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.caller),
      ro(params.vaultPda),
      rw(params.covenantPda),
    ],
    data: DISC_CLOSE_ORPHANED_COVENANT,
  });
}

// ── record_cloak_deposit ──────────────────────────────────────────────────────

/**
 * Builds a record_cloak_deposit instruction.
 * Call this after successfully calling Cloak's transact() off-chain.
 */
export function buildRecordCloakDepositIx(params: {
  programId:        PublicKey;
  owner:            PublicKey;
  vaultPda:         PublicKey;
  utxoCommitment:   Uint8Array;
  utxoLeafIndex:    bigint;
  shieldedLamports: bigint;
}): TransactionInstruction {
  if (params.utxoCommitment.length !== 32) {
    throw new Error("utxoCommitment must be exactly 32 bytes");
  }

  // Layout: disc(8) + utxo_commitment(32) + utxo_leaf_index(8) + shielded_lamports(8)
  const data = Buffer.alloc(8 + 32 + 8 + 8);
  DISC_RECORD_CLOAK_DEPOSIT.copy(data, 0);
  Buffer.from(params.utxoCommitment).copy(data, 8);
  writeU64LE(params.utxoLeafIndex, data, 40);
  writeU64LE(params.shieldedLamports, data, 48);

  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.owner),
      rw(params.vaultPda),
    ],
    data,
  });
}

// ── record_cloak_claim ────────────────────────────────────────────────────────

/**
 * Builds a record_cloak_claim instruction (permissionless).
 * Call this after guardians have completed the Cloak shield-to-shield transfer.
 * The caller receives vault + activity rent.
 */
export function buildRecordCloakClaimIx(params: {
  programId:               PublicKey;
  caller:                  PublicKey;
  vaultPda:                PublicKey;
  activityPda:             PublicKey;
  cloakTransferSignature:  Uint8Array;
}): TransactionInstruction {
  if (params.cloakTransferSignature.length !== 64) {
    throw new Error("cloakTransferSignature must be exactly 64 bytes");
  }

  // Layout: disc(8) + cloak_transfer_signature(64)
  const data = Buffer.alloc(8 + 64);
  DISC_RECORD_CLOAK_CLAIM.copy(data, 0);
  Buffer.from(params.cloakTransferSignature).copy(data, 8);

  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      signerRw(params.caller),
      rw(params.vaultPda),
      rw(params.activityPda),
      ro(SystemProgram.programId),
    ],
    data,
  });
}
