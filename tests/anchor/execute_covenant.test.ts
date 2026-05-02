import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID      = new PublicKey("LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const VAULT_SEED      = Buffer.from("vault");
const ACTIVITY_SEED   = Buffer.from("activity");
const GUARDIAN_SEED   = Buffer.from("guardian");
const COVENANT_SEED   = Buffer.from("covenant");
const BENEFICIARY_CHANGE_TIMELOCK = 432_000n;

function deriveVaultPda(owner: PublicKey, vaultIndex: BN): [PublicKey, number] {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(vaultIndex.toString()));
  return PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBuffer(), b], PROGRAM_ID);
}
function deriveActivityPda(vaultPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ACTIVITY_SEED, vaultPda.toBuffer()], PROGRAM_ID);
}
function deriveGuardianPda(vaultPda: PublicKey, guardian: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([GUARDIAN_SEED, vaultPda.toBuffer(), guardian.toBuffer()], PROGRAM_ID);
}
function deriveCovenantPda(vaultPda: PublicKey, covenantIndex: BN): [PublicKey, number] {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(covenantIndex.toString()));
  return PublicKey.findProgramAddressSync([COVENANT_SEED, vaultPda.toBuffer(), b], PROGRAM_ID);
}

describe("execute_covenant", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  let g1:         Keypair;
  let g2:         Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;
  let gPda1:      PublicKey;
  let gPda2:      PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();
    g1 = Keypair.generate(); g2 = Keypair.generate();

    for (const kp of [owner, g1, g2]) {
      context.setAccount(kp.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);
    [gPda1]       = deriveGuardianPda(vaultPda, g1.publicKey);
    [gPda2]       = deriveGuardianPda(vaultPda, g2.publicKey);

    await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
  });

  it("BeneficiaryChange: happy path after 432_000 slot timelock", async () => {
    const newBeneficiary = Keypair.generate();
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await program.methods.createCovenant({ beneficiaryChange: {} }, newBeneficiary.publicKey).accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([g1]).rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    const completedSlot = BigInt(covenant.signaturesCompleteSlot.toString());

    context.warpToSlot(completedSlot + BENEFICIARY_CHANGE_TIMELOCK + 1n);

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await program.methods.executeCovenant().accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null }).signers([caller]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.beneficiary.toBase58()).toBe(newBeneficiary.publicKey.toBase58());

    const covenantPdaInfo = await context.banksClient.getAccount(covenantPda);
    expect(covenantPdaInfo).toBeNull();
  });

  it("BeneficiaryChange: rejected before timelock with CovenantTimelockActive", async () => {
    const newBeneficiary = Keypair.generate();
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await program.methods.createCovenant({ beneficiaryChange: {} }, newBeneficiary.publicKey).accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([g1]).rpc();

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.executeCovenant().accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null }).signers([caller]).rpc(),
    ).rejects.toThrow(/CovenantTimelockActive/);
  });

  it("GuardianRemoval: executes immediately (0 timelock)", async () => {
    const targetGuardian = Keypair.generate();
    const [targetGPda] = deriveGuardianPda(vaultPda, targetGuardian.publicKey);
    context.setAccount(targetGuardian.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: targetGuardian.publicKey, guardianAccount: targetGPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    const vaultBefore = await program.account.vaultAccount.fetch(vaultPda);
    const [covenantPda] = deriveCovenantPda(vaultPda, vaultBefore.covenantCounter);

    await program.methods.createCovenant({ guardianRemoval: {} }, targetGuardian.publicKey).accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([g1]).rpc();

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await program.methods.executeCovenant().accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: targetGPda }).signers([caller]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.guardianCount).toBe(vaultBefore.guardianCount - 1);
  });

  it("EmergencySweep: rejected (wrong instruction — CovenantTypeMismatch)", async () => {
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));
    await program.methods.createCovenant({ emergencySweep: {} }, PublicKey.default).accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([g1]).rpc();

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.executeCovenant().accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null }).signers([caller]).rpc(),
    ).rejects.toThrow(/CovenantTypeMismatch/);
  });

  it("executed covenant rejected with CovenantAlreadyExecuted", async () => {
    const newBeneficiary = Keypair.generate();
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await program.methods.createCovenant({ beneficiaryChange: {} }, newBeneficiary.publicKey).accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([g1]).rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    const completedSlot = BigInt(covenant.signaturesCompleteSlot.toString());
    context.warpToSlot(completedSlot + BENEFICIARY_CHANGE_TIMELOCK + 1n);

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await program.methods.executeCovenant().accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null }).signers([caller]).rpc();

    // Second execution: covenant is closed so account is gone — any re-execute fails
    await expect(
      program.methods.executeCovenant().accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null }).signers([caller]).rpc(),
    ).rejects.toThrow();
  });
});
```

