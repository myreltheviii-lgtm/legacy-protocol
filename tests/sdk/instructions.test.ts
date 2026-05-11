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
  buildRecordCloakDepositIx,
  buildRecordCloakClaimIx,
} from "../../sdk/src/instructions";
import { CovenantType } from "../../sdk/src/types";
import {
  deriveVaultPda,
  deriveActivityPda,
  deriveGuardianPda,
  deriveCovenantPda,
} from "../../sdk/src/pda";

const PROGRAM_ID = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");

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

// A non-zero 32-byte beneficiary UTXO pubkey for v2 initialize_vault.
// Uses BENEFICIARY's raw bytes so round-trip tests remain straightforward.
const BENEFICIARY_UTXO_PUBKEY: Uint8Array = new Uint8Array(BENEFICIARY.toBuffer());

// A non-zero 32-byte UTXO commitment for cloak deposit tests.
const FAKE_COMMITMENT = new Uint8Array(32).fill(0x42);

// A 64-byte fake Cloak transfer signature for cloak claim tests.
const FAKE_CLOAK_SIG = new Uint8Array(64).fill(0xab);

describe("all 17 instruction builders: correct discriminators", () => {
  it("buildInitializeVaultIx uses global:initialize_vault discriminator", () => {
    const ix = buildInitializeVaultIx({
      programId:              PROGRAM_ID,
      owner:                  OWNER,
      vaultPda:               VAULT_PDA,
      activityPda:            ACTIVITY_PDA,
      vaultIndex:             0n,
      inactivityThresholdSlots: 5_000_000n,
      beneficiaryUtxoPubkey:  BENEFICIARY_UTXO_PUBKEY,
    });
    const disc = instructionDisc("initialize_vault");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildConfigureThresholdIx uses global:configure_threshold discriminator", () => {
    const ix = buildConfigureThresholdIx({
      programId:        PROGRAM_ID,
      owner:            OWNER,
      vaultPda:         VAULT_PDA,
      newThresholdSlots: 1_000_000n,
    });
    const disc = instructionDisc("configure_threshold");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildDepositIx uses global:deposit discriminator", () => {
    const ix = buildDepositIx({
      programId: PROGRAM_ID,
      owner:     OWNER,
      vaultPda:  VAULT_PDA,
      lamports:  1_000_000_000n,
    });
    const disc = instructionDisc("deposit");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCloseVaultIx uses global:close_vault discriminator", () => {
    const ix = buildCloseVaultIx({
      programId:   PROGRAM_ID,
      owner:       OWNER,
      vaultPda:    VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("close_vault");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildAddGuardianIx uses global:add_guardian discriminator", () => {
    const ix = buildAddGuardianIx({
      programId:          PROGRAM_ID,
      owner:              OWNER,
      vaultPda:           VAULT_PDA,
      guardian:           GUARDIAN,
      guardianAccountPda: GUARDIAN_PDA,
      mOfNThreshold:      1,
    });
    const disc = instructionDisc("add_guardian");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildRemoveGuardianIx uses global:remove_guardian discriminator", () => {
    const ix = buildRemoveGuardianIx({
      programId:          PROGRAM_ID,
      owner:              OWNER,
      vaultPda:           VAULT_PDA,
      guardian:           GUARDIAN,
      guardianAccountPda: GUARDIAN_PDA,
    });
    const disc = instructionDisc("remove_guardian");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCreateCovenantIx uses global:create_covenant discriminator", () => {
    const ix = buildCreateCovenantIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda:        COVENANT_PDA,
      covenantType:       0, // EmergencySweep
      target:             PublicKey.default,
    });
    const disc = instructionDisc("create_covenant");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildGuardianSignIx uses global:guardian_sign discriminator", () => {
    const ix = buildGuardianSignIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda:        COVENANT_PDA,
    });
    const disc = instructionDisc("guardian_sign");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildExecuteCovenantIx uses global:execute_covenant discriminator", () => {
    const ix = buildExecuteCovenantIx({
      programId:   PROGRAM_ID,
      caller:      CALLER,
      vaultPda:    VAULT_PDA,
      covenantPda: COVENANT_PDA,
    });
    const disc = instructionDisc("execute_covenant");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCheckInIx uses global:check_in discriminator", () => {
    const ix = buildCheckInIx({
      programId:   PROGRAM_ID,
      owner:       OWNER,
      vaultPda:    VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("check_in");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildAnomalyFlagIx uses global:anomaly_flag discriminator", () => {
    const ix = buildAnomalyFlagIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      activityPda:        ACTIVITY_PDA,
    });
    const disc = instructionDisc("anomaly_flag");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildTriggerInheritanceIx uses global:trigger_inheritance discriminator", () => {
    const ix = buildTriggerInheritanceIx({
      programId: PROGRAM_ID,
      caller:    CALLER,
      vaultPda:  VAULT_PDA,
    });
    const disc = instructionDisc("trigger_inheritance");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildClaimInheritanceIx uses global:claim_inheritance discriminator", () => {
    const ix = buildClaimInheritanceIx({
      programId:   PROGRAM_ID,
      beneficiary: BENEFICIARY,
      vaultPda:    VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("claim_inheritance");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildEmergencySweepIx uses global:emergency_sweep discriminator", () => {
    const ix = buildEmergencySweepIx({
      programId:   PROGRAM_ID,
      caller:      CALLER,
      vaultPda:    VAULT_PDA,
      beneficiary: BENEFICIARY,
      covenantPda: COVENANT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    const disc = instructionDisc("emergency_sweep");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildCloseOrphanedCovenantIx uses global:close_orphaned_covenant discriminator", () => {
    const ix = buildCloseOrphanedCovenantIx({
      programId:   PROGRAM_ID,
      caller:      CALLER,
      vaultPda:    VAULT_PDA,
      covenantPda: COVENANT_PDA,
    });
    const disc = instructionDisc("close_orphaned_covenant");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildRecordCloakDepositIx uses global:record_cloak_deposit discriminator", () => {
    const ix = buildRecordCloakDepositIx({
      programId:        PROGRAM_ID,
      owner:            OWNER,
      vaultPda:         VAULT_PDA,
      utxoCommitment:   FAKE_COMMITMENT,
      utxoLeafIndex:    42n,
      shieldedLamports: 1_000_000_000n,
    });
    const disc = instructionDisc("record_cloak_deposit");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });

  it("buildRecordCloakClaimIx uses global:record_cloak_claim discriminator", () => {
    const ix = buildRecordCloakClaimIx({
      programId:               PROGRAM_ID,
      caller:                  CALLER,
      vaultPda:                VAULT_PDA,
      activityPda:             ACTIVITY_PDA,
      cloakTransferSignature:  FAKE_CLOAK_SIG,
    });
    const disc = instructionDisc("record_cloak_claim");
    expect(Buffer.from(ix.data).slice(0, 8).equals(disc)).toBe(true);
  });
});

describe("instruction builders: correct AccountMeta ordering", () => {
  // ── initialize_vault (v2) ─────────────────────────────────────────────────
  // v2 removes the beneficiary account entirely — beneficiary_utxo_pubkey is
  // now an instruction argument (32 raw bytes), not an account.
  // Correct ordering: owner(signerRw), vault(rw), activity(rw), systemProgram(ro)
  it("buildInitializeVaultIx v2: 4 keys — owner(signerRw), vault(rw), activity(rw), systemProgram(ro); NO beneficiary account", () => {
    const ix = buildInitializeVaultIx({
      programId:              PROGRAM_ID,
      owner:                  OWNER,
      vaultPda:               VAULT_PDA,
      activityPda:            ACTIVITY_PDA,
      vaultIndex:             0n,
      inactivityThresholdSlots: 5_000_000n,
      beneficiaryUtxoPubkey:  BENEFICIARY_UTXO_PUBKEY,
    });
    // v2 has exactly 4 accounts — no beneficiary account key.
    expect(ix.keys.length).toBe(4);
    // owner: signer + writable
    expect(ix.keys[0].pubkey.toBase58()).toBe(OWNER.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    // vault: writable PDA
    expect(ix.keys[1].pubkey.toBase58()).toBe(VAULT_PDA.toBase58());
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(true);
    // activity: writable PDA
    expect(ix.keys[2].pubkey.toBase58()).toBe(ACTIVITY_PDA.toBase58());
    expect(ix.keys[2].isSigner).toBe(false);
    expect(ix.keys[2].isWritable).toBe(true);
    // systemProgram: readonly
    expect(ix.keys[3].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
    expect(ix.keys[3].isSigner).toBe(false);
    expect(ix.keys[3].isWritable).toBe(false);
  });

  it("buildConfigureThresholdIx: owner(signerRw), vault(rw)", () => {
    const ix = buildConfigureThresholdIx({
      programId:        PROGRAM_ID,
      owner:            OWNER,
      vaultPda:         VAULT_PDA,
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
      owner:     OWNER,
      vaultPda:  VAULT_PDA,
      lamports:  1_000_000_000n,
    });
    expect(ix.keys.length).toBe(3);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[2].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it("buildCheckInIx: owner is signer but NOT writable (read-only signer)", () => {
    const ix = buildCheckInIx({
      programId:   PROGRAM_ID,
      owner:       OWNER,
      vaultPda:    VAULT_PDA,
      activityPda: ACTIVITY_PDA,
    });
    expect(ix.keys[0].isSigner).toBe(true);
    // check_in: owner signs to prove identity but the program does not debit
    // the owner account — it only updates vault + activity PDAs.
    expect(ix.keys[0].isWritable).toBe(false);
  });

  it("buildTriggerInheritanceIx: only caller and vault (no activity account)", () => {
    const ix = buildTriggerInheritanceIx({
      programId: PROGRAM_ID,
      caller:    CALLER,
      vaultPda:  VAULT_PDA,
    });
    // TriggerInheritance Rust struct: caller + vault only. No activity account.
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.toBase58()).toBe(CALLER.toBase58());
    expect(ix.keys[1].pubkey.toBase58()).toBe(VAULT_PDA.toBase58());
  });

  it("buildExecuteCovenantIx without targetGuardianPda has 3 keys", () => {
    const ix = buildExecuteCovenantIx({
      programId:   PROGRAM_ID,
      caller:      CALLER,
      vaultPda:    VAULT_PDA,
      covenantPda: COVENANT_PDA,
    });
    expect(ix.keys.length).toBe(3);
  });

  it("buildExecuteCovenantIx with targetGuardianPda has 4 keys", () => {
    const [targetGPda] = deriveGuardianPda(PROGRAM_ID, VAULT_PDA, GUARDIAN);
    const ix = buildExecuteCovenantIx({
      programId:         PROGRAM_ID,
      caller:            CALLER,
      vaultPda:          VAULT_PDA,
      covenantPda:       COVENANT_PDA,
      targetGuardianPda: targetGPda,
    });
    expect(ix.keys.length).toBe(4);
  });

  it("buildRecordCloakDepositIx: owner(signerRw), vault(rw) — exactly 2 accounts", () => {
    const ix = buildRecordCloakDepositIx({
      programId:        PROGRAM_ID,
      owner:            OWNER,
      vaultPda:         VAULT_PDA,
      utxoCommitment:   FAKE_COMMITMENT,
      utxoLeafIndex:    0n,
      shieldedLamports: 1_000_000_000n,
    });
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0].pubkey.toBase58()).toBe(OWNER.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.toBase58()).toBe(VAULT_PDA.toBase58());
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(true);
  });

  it("buildRecordCloakClaimIx: caller(signerRw), vault(rw), activity(rw), systemProgram(ro) — 4 accounts", () => {
    const ix = buildRecordCloakClaimIx({
      programId:               PROGRAM_ID,
      caller:                  CALLER,
      vaultPda:                VAULT_PDA,
      activityPda:             ACTIVITY_PDA,
      cloakTransferSignature:  FAKE_CLOAK_SIG,
    });
    expect(ix.keys.length).toBe(4);
    expect(ix.keys[0].pubkey.toBase58()).toBe(CALLER.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.toBase58()).toBe(VAULT_PDA.toBase58());
    expect(ix.keys[1].isWritable).toBe(true);
    expect(ix.keys[2].pubkey.toBase58()).toBe(ACTIVITY_PDA.toBase58());
    expect(ix.keys[2].isWritable).toBe(true);
    expect(ix.keys[3].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
    expect(ix.keys[3].isWritable).toBe(false);
  });

  it("all 17 instructions have the correct programId", () => {
    const instructions = [
      buildInitializeVaultIx({
        programId:              PROGRAM_ID,
        owner:                  OWNER,
        vaultPda:               VAULT_PDA,
        activityPda:            ACTIVITY_PDA,
        vaultIndex:             0n,
        inactivityThresholdSlots: 5_000_000n,
        beneficiaryUtxoPubkey:  BENEFICIARY_UTXO_PUBKEY,
      }),
      buildConfigureThresholdIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, newThresholdSlots: 1_000_000n }),
      buildDepositIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, lamports: 1n }),
      buildCloseVaultIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, activityPda: ACTIVITY_PDA }),
      buildAddGuardianIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, guardian: GUARDIAN, guardianAccountPda: GUARDIAN_PDA, mOfNThreshold: 1 }),
      buildRemoveGuardianIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, guardian: GUARDIAN, guardianAccountPda: GUARDIAN_PDA }),
      buildCreateCovenantIx({ programId: PROGRAM_ID, guardian: GUARDIAN, vaultPda: VAULT_PDA, guardianAccountPda: GUARDIAN_PDA, covenantPda: COVENANT_PDA, covenantType: 0, target: PublicKey.default }),
      buildGuardianSignIx({ programId: PROGRAM_ID, guardian: GUARDIAN, vaultPda: VAULT_PDA, guardianAccountPda: GUARDIAN_PDA, covenantPda: COVENANT_PDA }),
      buildExecuteCovenantIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA, covenantPda: COVENANT_PDA }),
      buildCheckInIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, activityPda: ACTIVITY_PDA }),
      buildAnomalyFlagIx({ programId: PROGRAM_ID, guardian: GUARDIAN, vaultPda: VAULT_PDA, guardianAccountPda: GUARDIAN_PDA, activityPda: ACTIVITY_PDA }),
      buildTriggerInheritanceIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA }),
      buildClaimInheritanceIx({ programId: PROGRAM_ID, beneficiary: BENEFICIARY, vaultPda: VAULT_PDA, activityPda: ACTIVITY_PDA }),
      buildEmergencySweepIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA, beneficiary: BENEFICIARY, covenantPda: COVENANT_PDA, activityPda: ACTIVITY_PDA }),
      buildCloseOrphanedCovenantIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA, covenantPda: COVENANT_PDA }),
      buildRecordCloakDepositIx({ programId: PROGRAM_ID, owner: OWNER, vaultPda: VAULT_PDA, utxoCommitment: FAKE_COMMITMENT, utxoLeafIndex: 0n, shieldedLamports: 1_000_000_000n }),
      buildRecordCloakClaimIx({ programId: PROGRAM_ID, caller: CALLER, vaultPda: VAULT_PDA, activityPda: ACTIVITY_PDA, cloakTransferSignature: FAKE_CLOAK_SIG }),
    ];
    expect(instructions.length).toBe(17);
    for (const ix of instructions) {
      expect(ix.programId.toBase58()).toBe(PROGRAM_ID.toBase58());
    }
  });
});

describe("instruction data encoding", () => {
  it("buildInitializeVaultIx v2: encodes vaultIndex=5 at offset 8 as little-endian u64", () => {
    const ix = buildInitializeVaultIx({
      programId:              PROGRAM_ID,
      owner:                  OWNER,
      vaultPda:               VAULT_PDA,
      activityPda:            ACTIVITY_PDA,
      vaultIndex:             5n,
      inactivityThresholdSlots: 0n,
      beneficiaryUtxoPubkey:  BENEFICIARY_UTXO_PUBKEY,
    });
    const data = Buffer.from(ix.data);
    // Layout: disc(8) + vault_index(8) + inactivity_threshold_slots(8) + beneficiary_utxo_pubkey(32)
    expect(data.length).toBe(8 + 8 + 8 + 32);
    expect(data.readBigUInt64LE(8)).toBe(5n);
  });

  it("buildInitializeVaultIx v2: encodes beneficiaryUtxoPubkey at offset 24 (32 bytes)", () => {
    const uniqueKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) uniqueKey[i] = (0x10 + i) & 0xff;
    const ix = buildInitializeVaultIx({
      programId:              PROGRAM_ID,
      owner:                  OWNER,
      vaultPda:               VAULT_PDA,
      activityPda:            ACTIVITY_PDA,
      vaultIndex:             0n,
      inactivityThresholdSlots: 5_000_000n,
      beneficiaryUtxoPubkey:  uniqueKey,
    });
    const data = Buffer.from(ix.data);
    const encoded = data.slice(24, 56);
    expect(encoded.toString("hex")).toBe(Buffer.from(uniqueKey).toString("hex"));
  });

  it("buildInitializeVaultIx v2: throws on beneficiaryUtxoPubkey of wrong length", () => {
    expect(() =>
      buildInitializeVaultIx({
        programId:              PROGRAM_ID,
        owner:                  OWNER,
        vaultPda:               VAULT_PDA,
        activityPda:            ACTIVITY_PDA,
        vaultIndex:             0n,
        inactivityThresholdSlots: 5_000_000n,
        beneficiaryUtxoPubkey:  new Uint8Array(16), // wrong: must be 32
      }),
    ).toThrow();
  });

  it("buildConfigureThresholdIx encodes newThresholdSlots as little-endian u64", () => {
    const ix = buildConfigureThresholdIx({
      programId:        PROGRAM_ID,
      owner:            OWNER,
      vaultPda:         VAULT_PDA,
      newThresholdSlots: 1_000_000n,
    });
    const data = Buffer.from(ix.data);
    expect(data.readBigUInt64LE(8)).toBe(1_000_000n);
  });

  it("buildDepositIx encodes lamports as little-endian u64", () => {
    const ix = buildDepositIx({
      programId: PROGRAM_ID,
      owner:     OWNER,
      vaultPda:  VAULT_PDA,
      lamports:  999_999_999n,
    });
    const data = Buffer.from(ix.data);
    expect(data.readBigUInt64LE(8)).toBe(999_999_999n);
  });

  it("buildAddGuardianIx encodes mOfNThreshold as u8", () => {
    const ix = buildAddGuardianIx({
      programId:          PROGRAM_ID,
      owner:              OWNER,
      vaultPda:           VAULT_PDA,
      guardian:           GUARDIAN,
      guardianAccountPda: GUARDIAN_PDA,
      mOfNThreshold:      3,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(3);
  });

  it("buildCreateCovenantIx encodes EmergencySweep as enum u8 = 0", () => {
    const ix = buildCreateCovenantIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda:        COVENANT_PDA,
      covenantType:       0, // EmergencySweep
      target:             PublicKey.default,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(0);
  });

  it("buildCreateCovenantIx encodes BeneficiaryChange as enum u8 = 1", () => {
    const ix = buildCreateCovenantIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda:        COVENANT_PDA,
      covenantType:       1, // BeneficiaryChange
      target:             BENEFICIARY,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(1);
  });

  it("buildCreateCovenantIx encodes GuardianRemoval as enum u8 = 2", () => {
    const ix = buildCreateCovenantIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda:        COVENANT_PDA,
      covenantType:       2, // GuardianRemoval
      target:             GUARDIAN,
    });
    const data = Buffer.from(ix.data);
    expect(data[8]).toBe(2);
  });

  it("buildCreateCovenantIx encodes target pubkey at offset 9 (32 bytes)", () => {
    const ix = buildCreateCovenantIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda:        COVENANT_PDA,
      covenantType:       1, // BeneficiaryChange
      target:             BENEFICIARY,
    });
    const data = Buffer.from(ix.data);
    // Layout: disc(8) + covenant_type(1) + target(32) = 41 bytes total
    expect(data.length).toBe(8 + 1 + 32);
    const encodedTarget = data.slice(9, 41);
    expect(encodedTarget.toString("hex")).toBe(BENEFICIARY.toBuffer().toString("hex"));
  });

  it("buildRecordCloakDepositIx encodes commitment at offset 8 (32 bytes) and leafIndex at offset 40 (u64 LE)", () => {
    const commitment  = new Uint8Array(32);
    for (let i = 0; i < 32; i++) commitment[i] = (0x11 + i) & 0xff;
    const leafIndex   = 42n;
    const lamports    = 1_000_000_000n;

    const ix = buildRecordCloakDepositIx({
      programId:        PROGRAM_ID,
      owner:            OWNER,
      vaultPda:         VAULT_PDA,
      utxoCommitment:   commitment,
      utxoLeafIndex:    leafIndex,
      shieldedLamports: lamports,
    });
    const data = Buffer.from(ix.data);
    // Layout: disc(8) + utxo_commitment(32) + utxo_leaf_index(8) + shielded_lamports(8) = 56
    expect(data.length).toBe(56);
    expect(data.slice(8, 40).toString("hex")).toBe(Buffer.from(commitment).toString("hex"));
    expect(data.readBigUInt64LE(40)).toBe(leafIndex);
    expect(data.readBigUInt64LE(48)).toBe(lamports);
  });

  it("buildRecordCloakClaimIx encodes signature at offset 8 (64 bytes)", () => {
    const sig = new Uint8Array(64);
    for (let i = 0; i < 64; i++) sig[i] = (0xab + i) & 0xff;

    const ix = buildRecordCloakClaimIx({
      programId:               PROGRAM_ID,
      caller:                  CALLER,
      vaultPda:                VAULT_PDA,
      activityPda:             ACTIVITY_PDA,
      cloakTransferSignature:  sig,
    });
    const data = Buffer.from(ix.data);
    // Layout: disc(8) + cloak_transfer_signature(64) = 72
    expect(data.length).toBe(72);
    expect(data.slice(8, 72).toString("hex")).toBe(Buffer.from(sig).toString("hex"));
  });

  it("buildRecordCloakDepositIx throws on commitment of wrong length", () => {
    expect(() =>
      buildRecordCloakDepositIx({
        programId:        PROGRAM_ID,
        owner:            OWNER,
        vaultPda:         VAULT_PDA,
        utxoCommitment:   new Uint8Array(16),
        utxoLeafIndex:    0n,
        shieldedLamports: 1_000_000_000n,
      }),
    ).toThrow();
  });

  it("buildRecordCloakClaimIx throws on signature of wrong length", () => {
    expect(() =>
      buildRecordCloakClaimIx({
        programId:               PROGRAM_ID,
        caller:                  CALLER,
        vaultPda:                VAULT_PDA,
        activityPda:             ACTIVITY_PDA,
        cloakTransferSignature:  new Uint8Array(32), // wrong: must be 64
      }),
    ).toThrow();
  });

  it("buildCreateCovenantIx has correct account ordering: guardian(signerRw), vault(rw), guardianAccount(ro), covenant(rw), systemProgram(ro)", () => {
    const ix = buildCreateCovenantIx({
      programId:          PROGRAM_ID,
      guardian:           GUARDIAN,
      vaultPda:           VAULT_PDA,
      guardianAccountPda: GUARDIAN_PDA,
      covenantPda:        COVENANT_PDA,
      covenantType:       0,
      target:             PublicKey.default,
    });
    expect(ix.keys.length).toBe(5);
    expect(ix.keys[0].pubkey.toBase58()).toBe(GUARDIAN.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.toBase58()).toBe(VAULT_PDA.toBase58());
    expect(ix.keys[1].isWritable).toBe(true);
    expect(ix.keys[2].pubkey.toBase58()).toBe(GUARDIAN_PDA.toBase58());
    expect(ix.keys[2].isSigner).toBe(false);
    expect(ix.keys[2].isWritable).toBe(false);
    expect(ix.keys[3].pubkey.toBase58()).toBe(COVENANT_PDA.toBase58());
    expect(ix.keys[3].isWritable).toBe(true);
    expect(ix.keys[4].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });
});
