import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID     = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
const VAULT_SEED     = Buffer.from("vault");
const ACTIVITY_SEED  = Buffer.from("activity");
const GUARDIAN_SEED  = Buffer.from("guardian");
const COVENANT_SEED  = Buffer.from("covenant");

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

// A non-zero 32-byte Cloak UTXO pubkey for the beneficiary identity (v2 arg, not account).
const BENEFICIARY_UTXO_PUBKEY = Array.from({ length: 32 }, (_, i) => i + 1);

describe("create_covenant", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let guardian:   Keypair;
  let vaultPda:   PublicKey;
  let gPda:       PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner    = Keypair.generate();
    guardian = Keypair.generate();
    context.setAccount(owner.publicKey,    { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    context.setAccount(guardian.publicKey, { lamports: 5 * LAMPORTS_PER_SOL,  data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]        = deriveVaultPda(owner.publicKey, new BN(0));
    const [activityPda] = deriveActivityPda(vaultPda);
    [gPda]            = deriveGuardianPda(vaultPda, guardian.publicKey);

    // v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
    // No beneficiary account — removed in v2.
    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000), BENEFICIARY_UTXO_PUBKEY)
      .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    await program.methods
      .addGuardian(1)
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();
  });

  it("happy path EmergencySweep: covenant created, guardian auto-signed", async () => {
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await program.methods
      .createCovenant({ emergencySweep: {} }, PublicKey.default)
      .accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardian])
      .rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    expect(covenant.vault.toBase58()).toBe(vaultPda.toBase58());
    expect(covenant.signers.map((s: PublicKey) => s.toBase58())).toContain(guardian.publicKey.toBase58());
    expect(covenant.requiredSignatures).toBe(1);
    expect(covenant.timelockSlots.toNumber()).toBe(0); // EmergencySweep has 0 timelock
    expect(covenant.isExecuted).toBe(false);

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.covenantCounter.toNumber()).toBe(1);
  });

  it("happy path BeneficiaryChange: correct 432_000 slot timelock assigned", async () => {
    const newBeneficiary = Keypair.generate();
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await program.methods
      .createCovenant({ beneficiaryChange: {} }, newBeneficiary.publicKey)
      .accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardian])
      .rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    expect(covenant.timelockSlots.toNumber()).toBe(432_000);
  });

  it("happy path GuardianRemoval: 0 timelock", async () => {
    const targetGuardian = Keypair.generate();
    const [targetGPda] = deriveGuardianPda(vaultPda, targetGuardian.publicKey);
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: targetGuardian.publicKey, guardianAccount: targetGPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    const [covenantPda] = deriveCovenantPda(vaultPda, vault.covenantCounter);

    await program.methods
      .createCovenant({ guardianRemoval: {} }, targetGuardian.publicKey)
      .accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardian])
      .rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    expect(covenant.timelockSlots.toNumber()).toBe(0);
  });

  it("non-guardian rejected with UnauthorisedGuardian", async () => {
    const nonGuardian = Keypair.generate();
    context.setAccount(nonGuardian.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    const [fakePda] = deriveGuardianPda(vaultPda, nonGuardian.publicKey);
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await expect(
      program.methods
        .createCovenant({ emergencySweep: {} }, PublicKey.default)
        .accounts({ guardian: nonGuardian.publicKey, vault: vaultPda, guardianAccount: fakePda, covenant: covenantPda, systemProgram: SystemProgram.programId })
        .signers([nonGuardian])
        .rpc(),
    ).rejects.toThrow();
  });

  it("covenant_index incremented correctly after each creation", async () => {
    const newBeneficiary = Keypair.generate();
    const [cov0] = deriveCovenantPda(vaultPda, new BN(0));
    const [cov1] = deriveCovenantPda(vaultPda, new BN(1));

    await program.methods.createCovenant({ emergencySweep: {} }, PublicKey.default).accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: cov0, systemProgram: SystemProgram.programId }).signers([guardian]).rpc();
    await program.methods.createCovenant({ beneficiaryChange: {} }, newBeneficiary.publicKey).accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: cov1, systemProgram: SystemProgram.programId }).signers([guardian]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.covenantCounter.toNumber()).toBe(2);

    const covenant0 = await program.account.covenantAccount.fetch(cov0);
    const covenant1 = await program.account.covenantAccount.fetch(cov1);
    expect(covenant0.covenantIndex.toNumber()).toBe(0);
    expect(covenant1.covenantIndex.toNumber()).toBe(1);
  });

  it("signatures_complete_slot set when m_of_n = 1 and creator auto-signs", async () => {
    const currentSlot = await context.banksClient.getSlot();
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));

    await program.methods
      .createCovenant({ emergencySweep: {} }, PublicKey.default)
      .accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardian])
      .rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    // With M=1 and creator auto-signing, signaturesCompleteSlot is set immediately
    expect(BigInt(covenant.signaturesCompleteSlot.toString())).toBeGreaterThanOrEqual(BigInt(currentSlot.toString()));
  });
});
