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

// A non-zero 32-byte Cloak UTXO pubkey for the beneficiary identity (v2 arg, not account).
const BENEFICIARY_UTXO_PUBKEY = Array.from({ length: 32 }, (_, i) => i + 1);

// v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
// No beneficiary account — it was removed in v2; the UTXO pubkey is an argument.
async function initVault(program: Program<LegacyVault>, owner: Keypair) {
  const [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
  const [activityPda] = deriveActivityPda(vaultPda);
  await program.methods
    .initializeVault(new BN(0), new BN(5_000_000), BENEFICIARY_UTXO_PUBKEY)
    .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
    .signers([owner])
    .rpc();
  return { vaultPda, activityPda };
}

describe("add_guardian", () => {
  let context:  ProgramTestContext;
  let program:  Program<LegacyVault>;
  let owner:    Keypair;
  let vaultPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner    = Keypair.generate();
    context.setAccount(owner.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    ({ vaultPda } = await initVault(program, owner));
  });

  it("happy path: guardian PDA created, guardian_count incremented, is_active=true", async () => {
    const guardian = Keypair.generate();
    const [guardianPda] = deriveGuardianPda(vaultPda, guardian.publicKey);

    const currentSlot = await context.banksClient.getSlot();

    await program.methods
      .addGuardian(1)
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: guardianPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    const vault           = await program.account.vaultAccount.fetch(vaultPda);
    const guardianAccount = await program.account.guardianAccount.fetch(guardianPda);

    expect(vault.guardianCount).toBe(1);
    expect(vault.mOfNThreshold).toBe(1);
    expect(guardianAccount.vault.toBase58()).toBe(vaultPda.toBase58());
    expect(guardianAccount.guardian.toBase58()).toBe(guardian.publicKey.toBase58());
    expect(guardianAccount.isActive).toBe(true);
    expect(BigInt(guardianAccount.addedSlot.toString())).toBeGreaterThanOrEqual(BigInt(currentSlot.toString()));
    expect(guardianAccount.removalRequestedSlot.toNumber()).toBe(0);
  });

  it("guardian cannot be owner — UnauthorisedGuardian", async () => {
    const [guardianPda] = deriveGuardianPda(vaultPda, owner.publicKey);

    await expect(
      program.methods
        .addGuardian(1)
        .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: owner.publicKey, guardianAccount: guardianPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/UnauthorisedGuardian/);
  });

  it("guardian cannot be default pubkey", async () => {
    const [guardianPda] = deriveGuardianPda(vaultPda, PublicKey.default);

    await expect(
      program.methods
        .addGuardian(1)
        .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: PublicKey.default, guardianAccount: guardianPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/UnauthorisedGuardian|InvalidBeneficiary/);
  });

  it("exceeding MAX_GUARDIANS=10 rejected with TooManyGuardians", async () => {
    for (let i = 0; i < 10; i++) {
      const g = Keypair.generate();
      const [gPda] = deriveGuardianPda(vaultPda, g.publicKey);
      await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    }

    const extra = Keypair.generate();
    const [extraPda] = deriveGuardianPda(vaultPda, extra.publicKey);
    await expect(
      program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: extra.publicKey, guardianAccount: extraPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc(),
    ).rejects.toThrow(/TooManyGuardians/);
  });

  it("duplicate guardian rejected — init of same PDA fails", async () => {
    const guardian = Keypair.generate();
    const [guardianPda] = deriveGuardianPda(vaultPda, guardian.publicKey);

    await program.methods
      .addGuardian(1)
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: guardianPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    await expect(
      program.methods
        .addGuardian(1)
        .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: guardianPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow();
  });

  it("m_of_n_threshold=2 with 2 guardians accepted", async () => {
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    const [gPda1] = deriveGuardianPda(vaultPda, g1.publicKey);
    const [gPda2] = deriveGuardianPda(vaultPda, g2.publicKey);

    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(2).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.guardianCount).toBe(2);
    expect(vault.mOfNThreshold).toBe(2);
  });

  it("threshold exceeding guardian_count rejected with ThresholdExceedsGuardianCount", async () => {
    const g = Keypair.generate();
    const [gPda] = deriveGuardianPda(vaultPda, g.publicKey);

    await expect(
      program.methods.addGuardian(3).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc(),
    ).rejects.toThrow(/ThresholdExceedsGuardianCount/);
  });
});
