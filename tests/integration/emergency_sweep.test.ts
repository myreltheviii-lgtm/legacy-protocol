import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID    = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
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

describe("integration: emergency sweep", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  // In v2 beneficiary identity is stored as raw bytes in vault.beneficiaryUtxoPubkey.
  let beneficiaryUtxoPubkey: number[];
  let guardian:   Keypair;
  let caller:     Keypair;
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
    caller      = Keypair.generate();
    beneficiaryUtxoPubkey = Array.from(beneficiary.publicKey.toBytes());

    for (const kp of [owner, guardian, caller]) {
      context.setAccount(kp.publicKey, { lamports: 20 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }
    context.setAccount(beneficiary.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);
    [gPda]        = deriveGuardianPda(vaultPda, guardian.publicKey);
    [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    // v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
    // No beneficiary account — removed in v2.
    await program.methods.initializeVault(new BN(0), new BN(5_000_000), beneficiaryUtxoPubkey).accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.deposit(new BN(5 * LAMPORTS_PER_SOL)).accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.createCovenant({ emergencySweep: {} }, PublicKey.default).accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([guardian]).rpc();
  });

  it("full sweep: create EmergencySweep covenant → M signs → sweep executes", async () => {
    const benBefore = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);

    await program.methods
      .emergencySweep()
      .accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([caller])
      .rpc();

    const benAfter = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);
    expect(benAfter).toBeGreaterThan(benBefore);
    expect(benAfter - benBefore).toBeGreaterThanOrEqual(BigInt(5 * LAMPORTS_PER_SOL) - 10_000n);
  });

  it("vault + activity + covenant all closed after sweep", async () => {
    await program.methods
      .emergencySweep()
      .accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([caller])
      .rpc();

    expect(await context.banksClient.getAccount(vaultPda)).toBeNull();
    expect(await context.banksClient.getAccount(activityPda)).toBeNull();
    expect(await context.banksClient.getAccount(covenantPda)).toBeNull();
  });

  it("beneficiary receives all vault lamports (deposited funds + vault rent)", async () => {
    const vaultInfo = await context.banksClient.getAccount(vaultPda);
    const expectedFromVault = BigInt(vaultInfo!.lamports);
    const benBefore = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);

    await program.methods
      .emergencySweep()
      .accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([caller])
      .rpc();

    const benAfter = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);
    const received = benAfter - benBefore;
    expect(received).toBeGreaterThan(expectedFromVault - 10_000n);
  });

  it("caller receives activity + covenant rent reserves as submission incentive", async () => {
    const activityInfo = await context.banksClient.getAccount(activityPda);
    const covenantInfo = await context.banksClient.getAccount(covenantPda);
    const callerBefore = BigInt((await context.banksClient.getAccount(caller.publicKey))!.lamports);

    await program.methods
      .emergencySweep()
      .accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([caller])
      .rpc();

    const callerAfter = BigInt((await context.banksClient.getAccount(caller.publicKey))!.lamports);
    const rentReceived = BigInt(activityInfo!.lamports) + BigInt(covenantInfo!.lamports);
    expect(callerAfter - callerBefore).toBeGreaterThan(rentReceived - 10_000n);
  });

  it("second sweep attempt fails (accounts are gone after first sweep)", async () => {
    await program.methods
      .emergencySweep()
      .accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([caller])
      .rpc();

    await expect(
      program.methods.emergencySweep()
        .accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId })
        .signers([caller])
        .rpc()
    ).rejects.toThrow();
  });

  it("2-of-2 sweep: both guardians sign before sweep executes", async () => {
    const g2 = Keypair.generate();
    context.setAccount(g2.publicKey, { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    const [gPda2] = deriveGuardianPda(vaultPda, g2.publicKey);
    await program.methods.addGuardian(2).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Create a 2-of-2 sweep covenant (g2 creates — 1 of 2 signed)
    const [cov2] = deriveCovenantPda(vaultPda, new BN(1));
    await program.methods.createCovenant({ emergencySweep: {} }, PublicKey.default).accounts({ guardian: g2.publicKey, vault: vaultPda, guardianAccount: gPda2, covenant: cov2, systemProgram: SystemProgram.programId }).signers([g2]).rpc();

    // Only 1 of 2 signed — sweep must fail
    await expect(
      program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: cov2, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc()
    ).rejects.toThrow(/InsufficientSignatures/);

    // guardian (original) signs the new covenant — now 2 of 2
    await program.methods.guardianSign().accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: cov2 }).signers([guardian]).rpc();

    // Now sweep succeeds
    await program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: cov2, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc();

    expect(await context.banksClient.getAccount(vaultPda)).toBeNull();
  });
});
