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

describe("emergency_sweep", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  // In v2 beneficiary identity is stored as raw bytes; the emergency_sweep instruction
  // uses vault.beneficiaryUtxoPubkey to route funds to the correct account.
  let beneficiaryUtxoPubkey: number[];
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
    // Store beneficiary's pubkey bytes so emergency_sweep can verify and route to them
    beneficiaryUtxoPubkey = Array.from(beneficiary.publicKey.toBytes());

    for (const kp of [owner, guardian]) {
      context.setAccount(kp.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }
    context.setAccount(beneficiary.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);
    [gPda]        = deriveGuardianPda(vaultPda, guardian.publicKey);
    [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    // v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
    // No beneficiary account — removed in v2.
    await program.methods.initializeVault(new BN(0), new BN(5_000_000), beneficiaryUtxoPubkey).accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.deposit(new BN(LAMPORTS_PER_SOL)).accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.createCovenant({ emergencySweep: {} }, PublicKey.default).accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: covenantPda, systemProgram: SystemProgram.programId }).signers([guardian]).rpc();
  });

  it("happy path: M-of-N EmergencySweep covenant executes, all accounts closed, lamports to beneficiary", async () => {
    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    const benBefore = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);

    await program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc();

    const vaultAfter    = await context.banksClient.getAccount(vaultPda);
    const activityAfter = await context.banksClient.getAccount(activityPda);
    const covenantAfter = await context.banksClient.getAccount(covenantPda);

    expect(vaultAfter).toBeNull();
    expect(activityAfter).toBeNull();
    expect(covenantAfter).toBeNull();

    const benAfter = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);
    expect(benAfter).toBeGreaterThan(benBefore);
  });

  it("zero timelock — executes immediately after M-of-N", async () => {
    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    expect(covenant.timelockSlots.toNumber()).toBe(0);
    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc(),
    ).resolves.toBeTruthy();
  });

  it("insufficient signatures rejected — InsufficientSignatures (2-of-2 but only 1 signed)", async () => {
    // Create a 2-of-2 setup
    const g2 = Keypair.generate();
    context.setAccount(g2.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    const [gPda2] = deriveGuardianPda(vaultPda, g2.publicKey);
    await program.methods.addGuardian(2).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    const [cov2] = deriveCovenantPda(vaultPda, new BN(1));
    // g2 creates — only 1 of 2 signed
    await program.methods.createCovenant({ emergencySweep: {} }, PublicKey.default).accounts({ guardian: g2.publicKey, vault: vaultPda, guardianAccount: gPda2, covenant: cov2, systemProgram: SystemProgram.programId }).signers([g2]).rpc();

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: cov2, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc(),
    ).rejects.toThrow(/InsufficientSignatures/);
  });

  it("wrong covenant type (BeneficiaryChange) rejected with CovenantTypeMismatch", async () => {
    const newBen = Keypair.generate();
    const [cov2] = deriveCovenantPda(vaultPda, new BN(1));
    await program.methods.createCovenant({ beneficiaryChange: {} }, newBen.publicKey).accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: cov2, systemProgram: SystemProgram.programId }).signers([guardian]).rpc();

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: cov2, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc(),
    ).rejects.toThrow(/CovenantTypeMismatch/);
  });

  it("already swept rejected with VaultAlreadySwept (accounts are gone after first sweep)", async () => {
    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: 2 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc();

    // Accounts are gone — second call fails
    await expect(
      program.methods.emergencySweep().accounts({ caller: caller.publicKey, vault: vaultPda, beneficiary: beneficiary.publicKey, covenant: covenantPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([caller]).rpc(),
    ).rejects.toThrow();
  });
});
