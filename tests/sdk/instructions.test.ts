import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  buildInitializeVaultIx,
  buildConfigureThresholdIx,
  buildDepositIx,
  buildCloseVaultIx,
  buildAddGuardianIx,
  buildRemoveGuardianIx,
  buildCreateCovenantIx,
  buildGuardianSignIx,
  buildExecuteCovenantIx,
  buildCheckInIx,
  buildAnomalyFlagIx,
  buildTriggerInheritanceIx,
  buildClaimInheritanceIx,
  buildEmergencySweepIx,
  buildCloseOrphanedCovenantIx,
} from "../../sdk/src/instructions";
import { CovenantType } from "../../sdk/src/types";
import {
  deriveVaultPda,
  deriveActivityPda,
  deriveGuardianPda,
  deriveCovenantPda,
} from "../../sdk/src/pda";

const PROGRAM_ID = new PublicKey("LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

function instructionDisc(snakeName: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`global:${snakeName}`).digest(),
  ).slice(0, 8);
}

const OWNER       = new PublicKey("So11111111111111111111111111111111111111112");
const BENEFICIARY = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const GUARDIAN    = new PublicKey("11111111111111111111111111111113");
const CALLER      = new PublicKey("11111111111111111111111111111114");

const [VAULT_PDA]    = deriveVaultPda(PROGRAM_ID, OWNER, 0n);
const [ACTIVITY_PDA] = deriveActivityPda(PROGRAM_ID, VAULT_PDA);
const [GUARDIAN_PDA] = deriveGuardianPda(PROGRAM_ID, VAULT_PDA, GUARDIAN);
const [COVENANT_PDA] = deriveCovenantPda(PROGRAM_ID, VAULT_PDA, 0n);

describe("all 15 instruction builders: correct discriminators", () => {
  it("buildInitializeVaultIx uses global:initialize_vault discriminator", () => {
    const ix = buildInitializeVaultIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      beneficiary: BENEFICIARY,
      vaultIndex: 0n,
      inactivityThresholdSlots: 5_000_000n,
    });
    const disc = instructionDisc("initialize_vault");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildConfigureThresholdIx uses global:configure_threshold discriminator", () => {
    const ix = buildConfigureThresholdIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      newThresholdSlots: 1_000_000n,
    });
    const disc = instructionDisc("configure_threshold");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildDepositIx uses global:deposit discriminator", () => {
    const ix = buildDepositIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      lamports: 1_000_000_000n,
    });
    const disc = instructionDisc("deposit");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCloseVaultIx uses global:close_vault discriminator", () => {
    const ix = buildCloseVaultIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("close_vault");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildAddGuardianIx uses global:add_guardian discriminator", () => {
    const ix = buildAddGuardianIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      guardian: GUARDIAN,
      mOfNThreshold: 1,
    });
    const disc = instructionDisc("add_guardian");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildRemoveGuardianIx uses global:remove_guardian discriminator", () => {
    const ix = buildRemoveGuardianIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      guardian: GUARDIAN,
      guardianAccountPda: GUARDIAN_PDA,
    });
    const disc = instructionDisc("remove_guardian");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCreateCovenantIx uses global:create_covenant discriminator", () => {
    const ix = buildCreateCovenantIx({
      programId: PROGRAM_ID,
      guardian: GUARDIAN,
      vaultPda: VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantIndex: 0n,
      covenantType: CovenantType.EmergencySweep,
      target: PublicKey.default,
    });
    const disc = instructionDisc("create_covenant");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildGuardianSignIx uses global:guardian_sign discriminator", () => {
    const ix = buildGuardianSignIx({
      programId: PROGRAM_ID,
      guardian: GUARDIAN,
      vaultPda: VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda: COVENANT_PDA,
    });
    const disc = instructionDisc("guardian_sign");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildExecuteCovenantIx uses global:execute_covenant discriminator", () => {
    const ix = buildExecuteCovenantIx({
      programId: PROGRAM_ID,
      caller: CALLER,
      vaultPda: VAULT_PDA,
      covenantPda: COVENANT_PDA,
    });
    const disc = instructionDisc("execute_covenant");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCheckInIx uses global:check_in discriminator", () => {
    const ix = buildCheckInIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("check_in");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildAnomalyFlagIx uses global:anomaly_flag discriminator", () => {
    const ix = buildAnomalyFlagIx({
      programId: PROGRAM_ID,
      guardian: GUARDIAN,
      vaultPda: VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("anomaly_flag");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildTriggerInheritanceIx uses global:trigger_inheritance discriminator", () => {
    const ix = buildTriggerInheritanceIx({
      programId: PROGRAM_ID,
      caller: CALLER,
      vaultPda: VAULT_PDA,
    });
    const disc = instructionDisc("trigger_inheritance");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildClaimInheritanceIx uses global:claim_inheritance discriminator", () => {
    const ix = buildClaimInheritanceIx({
      programId: PROGRAM_ID,
      beneficiary: BENEFICIARY,
      vaultPda: VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("claim_inheritance");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildEmergencySweepIx uses global:emergency_sweep discriminator", () => {
    const ix = buildEmergencySweepIx({
      programId: PROGRAM_ID,
      caller: CALLER,
      vaultPda: VAULT_PDA,
      beneficiary: BENEFICIARY,
      covenantPda: COVENANT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("emergency_sweep");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCloseOrphanedCovenantIx uses global:close_orphaned_covenant discriminator", () => {
    const ix = buildCloseOrphanedCovenantIx({
      programId: PROGRAM_ID,
      caller: CALLER,
      vaultPda: VAULT_PDA,
      covenantPda: COVENANT_PDA,
    });
    const disc = instructionDisc("close_orphaned_covenant");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });
});

describe("instruction builders: correct AccountMeta ordering", () => {
  it("buildInitializeVaultIx: owner(signerRw), beneficiary(ro), vault(rw), activity(rw), systemProgram(ro)", () => {
    const ix = buildInitializeVaultIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      beneficiary: BENEFICIARY,
      vaultIndex: 0n,
      inactivityThresholdSlots: 5_000_000n,
    });
    expect(ix.keys.length).toBe(5);
    expect(ix.keys[0].pubkey.toBase58()).toBe(OWNER.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.toBase58()).toBe(BENEFICIARY.toBase58());
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(false);
    expect(ix.keys[4].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it("buildConfigureThresholdIx: owner(signerRw), vault(rw)", () => {
    const ix = buildConfigureThresholdIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      newThresholdSlots: 1_000_000n,
    });
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
  });

  it("buildDepositIx: owner(signerRw), vault(rw), systemProgram(ro)", () => {
    const ix = buildDepositIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      lamports: 1_000_000_000n,
    });
    expect(ix.keys.length).toBe(3);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[2].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it("buildCheckInIx: owner is NOT isWritable (read-only signer)", () => {
    const ix = buildCheckInIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(false); // owner is signer but NOT writable for checkIn
  });

  it("buildTriggerInheritanceIx: only caller and vault (no activity account)", () => {
    const ix = buildTriggerInheritanceIx({
      programId: PROGRAM_ID,
      caller: CALLER,
      vaultPda: VAULT_PDA,
    });
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.toBase58()).toBe(CALLER.toBase58());
    expect(ix.keys[1].pubkey.toBase58()).toBe(VAULT_PDA.toBase58());
  });

  it("buildExecuteCovenantIx without targetGuardianPda has 3 keys", () => {
    const ix = buildExecuteCovenantIx({
      programId: PROGRAM_ID,
      caller: CALLER,
      vaultPda: VAULT_PDA,
      covenantPda: COVENANT_PDA,
    });
    expect(ix.keys.length).toBe(3);
  });

  it("buildExecuteCovenantIx with targetGuardianPda has 4 keys", () => {
    const [targetGPda] = deriveGuardianPda(PROGRAM_ID, VAULT_PDA, GUARDIAN);
    const ix = buildExecuteCovenantIx({
      programId: PROGRAM_ID,
      caller: CALLER,
      vaultPda: VAULT_PDA,
      covenantPda: COVENANT_PDA,
      targetGuardianPda: targetGPda,
    });
    expect(ix.keys.length).toBe(4);
  });

  it("all 15 instructions have the correct programId", () => {
    const instructions = [
      buildInitializeVaultIx({ programId: PROGRAM_ID, owner: OWNER, beneficiary: BENEFICIARY, vaultIndex: 0n, inactivityThresholdSlots: 5_000_000n }),
      buildConfigureThresholdIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, newThresholdSlots: 1_000_000n }),
      buildDepositIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, lamports: 1n }),
      buildCloseVaultIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, activityPda: ACTIVITY_PDA }),
      buildAddGuardianIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, guardian: GUARDIAN, mOfNThreshold: 1 }),
      buildRemoveGuardianIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, guardian: GUARDIAN, guardianAccountPda: GUARDIAN_PDA }),
      buildCreateCovenantIx({ programId: PROGRAM_ID, guardian: GUARDIAN, vaultPda: VAULT_PDA, guardianAccountPda: GUARDIAN_PDA, covenantIndex: 0n, covenantType: CovenantType.EmergencySweep, target: PublicKey.default }),
      buildGuardianSignIx({ programId: PROGRAM_ID, guardian: GUARDIAN, vaultPda: VAULT_PDA, guardianAccountPda: GUARDIAN_PDA, covenantPda: COVENANT_PDA }),
      buildExecuteCovenantIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA, covenantPda: COVENANT_PDA }),
      buildCheckInIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, activityPda: ACTIVITY_PDA }),
      buildAnomalyFlagIx({ programId: PROGRAM_ID, guardian: GUARDIAN, vaultPda: VAULT_PDA, guardianAccountPda: GUARDIAN_PDA, activityPda: ACTIVITY_PDA }),
      buildTriggerInheritanceIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA }),
      buildClaimInheritanceIx({ programId: PROGRAM_ID, beneficiary: BENEFICIARY, vaultPda: VAULT_PDA, activityPda: ACTIVITY_PDA }),
      buildEmergencySweepIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA, beneficiary: BENEFICIARY, covenantPda: COVENANT_PDA, activityPda: ACTIVITY_PDA }),
      buildCloseOrphanedCovenantIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA, covenantPda: COVENANT_PDA }),
    ];
    for (const ix of instructions) {
      expect(ix.programId.toBase58()).toBe(PROGRAM_ID.toBase58());
    }
  });
});

describe("instruction data encoding", () => {
  it("buildInitializeVaultIx encodes vaultIndex=5 as little-endian u64", () => {
    const ix = buildInitializeVaultIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      beneficiary: BENEFICIARY,
      vaultIndex: 5n,
      inactivityThresholdSlots: 0n,
    });
    const data = Buffer.from(ix.data);
    // After 8-byte discriminator: 8 bytes LE u64 for vaultIndex
    expect(data.readBigUInt64LE(8)).toBe(5n);
  });

  it("buildConfigureThresholdIx encodes newThresholdSlots as little-endian u64", () => {
    const ix = buildConfigureThresholdIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      newThresholdSlots: 1_000_000n,
    });
    const data = Buffer.from(ix.data);
    expect(data.readBigUInt64LE(8)).toBe(1_000_000n);
  });

  it("buildDepositIx encodes lamports as little-endian u64", () => {
    const ix = buildDepositIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      lamports: 999_999_999n,
    });
    const data = Buffer.from(ix.data);
    expect(data.readBigUInt64LE(8)).toBe(999_999_999n);
  });

  it("buildAddGuardianIx encodes mOfNThreshold as u8", () => {
    const ix = buildAddGuardianIx({
      programId: PROGRAM_ID,
      owner: OWNER,
      vaultPda: VAULT_PDA,
      guardian: GUARDIAN,
      mOfNThreshold: 3,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(3);
  });

  it("buildCreateCovenantIx encodes EmergencySweep as enum u8 = 0", () => {
    const ix = buildCreateCovenantIx({
      programId: PROGRAM_ID,
      guardian: GUARDIAN,
      vaultPda: VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantIndex: 0n,
      covenantType: CovenantType.EmergencySweep,
      target: PublicKey.default,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(0); // EmergencySweep = 0
  });

  it("buildCreateCovenantIx encodes BeneficiaryChange as enum u8 = 1", () => {
    const ix = buildCreateCovenantIx({
      programId: PROGRAM_ID,
      guardian: GUARDIAN,
      vaultPda: VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantIndex: 0n,
      covenantType: CovenantType.BeneficiaryChange,
      target: BENEFICIARY,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(1); // BeneficiaryChange = 1
  });

  it("buildCreateCovenantIx encodes GuardianRemoval as enum u8 = 2", () => {
    const ix = buildCreateCovenantIx({
      programId: PROGRAM_ID,
      guardian: GUARDIAN,
      vaultPda: VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantIndex: 0n,
      covenantType: CovenantType.GuardianRemoval,
      target: GUARDIAN,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(2); // GuardianRemoval = 2
  });
});
