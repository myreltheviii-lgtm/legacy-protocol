import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID    = new PublicKey("LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");
const GUARDIAN_SEED = Buffer.from("guardian");
const COVENANT_SEED = Buffer.from("covenant");

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

describe("close_orphaned_covenant", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  let guardian:   Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;
  let gPda:       PublicKey;
  let covenantPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();
    guardian    = Keypair.generate();

    for (const kp of [owner, guardian]) {
      context.setAccount(kp.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }
    context.setAccount(beneficiary.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);
    [gPda]        = deriveGuardianPda(vaultPda, guardian.publicKey);
    [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Create a BeneficiaryChange covenant (not an EmergencySweep so it can be orphaned)
    const newBen = Keypair.generate();
    await program.methods.createCovenant({ beneficiaryChange: {} }, newBen.publicKey).accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([guardian]).rpc();

    // Trigger the vault — covenant becomes orphaned
    const vault0 = await program.account.vaultAccount.fetch(vaultPda);
    const triggerSlot = BigInt(vault0.lastCheckInSlot.toString()) + BigInt(vault0.inactivityThresholdSlots.toString());
    context.warpToSlot(triggerSlot);

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    await program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc();
  });

  it("happy path: orphaned covenant closed, rent to caller", async () => {
    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    const callerBefore = BigInt((await context.banksClient.getAccount(caller.publicKey))!.lamports);

    await program.methods.closeOrphanedCovenant().accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda }).signers([caller]).rpc();

    const covenantAfter = await context.banksClient.getAccount(covenantPda);
    expect(covenantAfter).toBeNull();

    const callerAfter = BigInt((await context.banksClient.getAccount(caller.publicKey))!.lamports);
    expect(callerAfter).toBeGreaterThan(callerBefore);
  });

  it("requires is_triggered=true — rejects on live vault", async () => {
    // Create fresh vault with covenant
    const owner2    = Keypair.generate();
    const ben2      = Keypair.generate();
    const guardian2 = Keypair.generate();
    context.setAccount(owner2.publicKey,    { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    context.setAccount(guardian2.publicKey, { lamports: 5 * LAMPORTS_PER_SOL,  data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    const [vaultPda2]    = deriveVaultPda(owner2.publicKey, new BN(0));
    const [activityPda2] = deriveActivityPda(vaultPda2);
    const [gPda2]        = deriveGuardianPda(vaultPda2, guardian2.publicKey);
    const [covenantPda2] = deriveCovenantPda(vaultPda2, new BN(0));

    await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner2.publicKey, beneficiary: ben2.publicKey, vault: vaultPda2, activity: activityPda2, systemProgram: SystemProgram.programId }).signers([owner2]).rpc();
    await program.methods.addGuardian(1).accounts({ owner: owner2.publicKey, vault: vaultPda2, guardian: guardian2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner2]).rpc();
    await program.methods.createCovenant({ emergencySweep: {} }, PublicKey.default).accounts({ guardian: guardian2.publicKey, vault: vaultPda2, guardianAccount: gPda2, covenant: covenantPda2, systemProgram: SystemProgram.programId }).signers([guardian2]).rpc();

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.closeOrphanedCovenant().accounts({ caller: caller.publicKey, vault: vaultPda2, covenant: covenantPda2 }).signers([caller]).rpc(),
    ).rejects.toThrow(/VaultNotTriggered/);
  });

  it("permissionless — any signer can close", async () => {
    const anyCaller = Keypair.generate();
    context.setAccount(anyCaller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.closeOrphanedCovenant().accounts({ caller: anyCaller.publicKey, vault: vaultPda, covenant: covenantPda }).signers([anyCaller]).rpc(),
    ).resolves.toBeTruthy();
  });
});
```

