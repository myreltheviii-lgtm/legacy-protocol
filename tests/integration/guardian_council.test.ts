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

describe("integration: guardian council M-of-N", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  let caller:     Keypair;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();
    caller      = Keypair.generate();

    for (const kp of [owner, caller]) {
      context.setAccount(kp.publicKey, { lamports: 20 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }
    context.setAccount(beneficiary.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
  });

  async function setupVaultWithGuardians(vaultIndex: number, numGuardians: number, mOfN: number): Promise<{
    vaultPda: PublicKey;
    activityPda: PublicKey;
    guardians: Keypair[];
    gPdas: PublicKey[];
  }> {
    const [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(vaultIndex));
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(new BN(vaultIndex), new BN(5_000_000))
      .accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    const guardians: Keypair[] = [];
    const gPdas: PublicKey[] = [];
    for (let i = 0; i < numGuardians; i++) {
      const g = Keypair.generate();
      context.setAccount(g.publicKey, { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
      guardians.push(g);
      const [gPda] = deriveGuardianPda(vaultPda, g.publicKey);
      gPdas.push(gPda);
      await program.methods
        .addGuardian(i === numGuardians - 1 ? mOfN : Math.min(i + 1, mOfN))
        .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc();
    }
    return { vaultPda, activityPda, guardians, gPdas };
  }

  it("2-of-3 M-of-N: create covenant → 2 signs → execute BeneficiaryChange", async () => {
    const { vaultPda, guardians, gPdas } = await setupVaultWithGuardians(0, 3, 2);
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));
    const newBen = Keypair.generate();

    // g[0] creates → auto-signed (1 of 2)
    await program.methods
      .createCovenant({ beneficiaryChange: {} }, newBen.publicKey)
      .accounts({ guardian: guardians[0].publicKey, vault: vaultPda, guardianAccount: gPdas[0], covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardians[0]])
      .rpc();

    // g[1] signs → reaches M=2, signaturesCompleteSlot set
    await program.methods
      .guardianSign()
      .accounts({ guardian: guardians[1].publicKey, vault: vaultPda, guardianAccount: gPdas[1], covenant: covenantPda })
      .signers([guardians[1]])
      .rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    expect(covenant.signers.length).toBe(2);
    expect(BigInt(covenant.signaturesCompleteSlot.toString())).toBeGreaterThan(0n);

    // Warp past 432_000 slot timelock
    const completedSlot = BigInt(covenant.signaturesCompleteSlot.toString());
    context.warpToSlot(completedSlot + BENEFICIARY_CHANGE_TIMELOCK + 1n);

    // Execute
    await program.methods
      .executeCovenant()
      .accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null })
      .signers([caller])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.beneficiary.toBase58()).toBe(newBen.publicKey.toBase58());
    expect(await context.banksClient.getAccount(covenantPda)).toBeNull();
  });

  it("3-of-5 M-of-N: create covenant → 3 signs → execute BeneficiaryChange", async () => {
    const { vaultPda, guardians, gPdas } = await setupVaultWithGuardians(1, 5, 3);
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));
    const newBen = Keypair.generate();

    // g[0] creates and auto-signs (1 of 3)
    await program.methods
      .createCovenant({ beneficiaryChange: {} }, newBen.publicKey)
      .accounts({ guardian: guardians[0].publicKey, vault: vaultPda, guardianAccount: gPdas[0], covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardians[0]])
      .rpc();

    // g[1] signs (2 of 3)
    await program.methods
      .guardianSign()
      .accounts({ guardian: guardians[1].publicKey, vault: vaultPda, guardianAccount: gPdas[1], covenant: covenantPda })
      .signers([guardians[1]])
      .rpc();

    let cov = await program.account.covenantAccount.fetch(covenantPda);
    expect(cov.signaturesCompleteSlot.toNumber()).toBe(0); // not yet reached 3

    // g[2] signs (3 of 3) — threshold reached
    await program.methods
      .guardianSign()
      .accounts({ guardian: guardians[2].publicKey, vault: vaultPda, guardianAccount: gPdas[2], covenant: covenantPda })
      .signers([guardians[2]])
      .rpc();

    cov = await program.account.covenantAccount.fetch(covenantPda);
    expect(cov.signers.length).toBe(3);
    expect(BigInt(cov.signaturesCompleteSlot.toString())).toBeGreaterThan(0n);

    const completedSlot = BigInt(cov.signaturesCompleteSlot.toString());
    context.warpToSlot(completedSlot + BENEFICIARY_CHANGE_TIMELOCK + 1n);

    await program.methods
      .executeCovenant()
      .accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null })
      .signers([caller])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.beneficiary.toBase58()).toBe(newBen.publicKey.toBase58());
  });

  it("insufficient signatures (M-1 signs) → execute fails with InsufficientSignatures", async () => {
    const { vaultPda, guardians, gPdas } = await setupVaultWithGuardians(2, 3, 2);
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));
    const newBen = Keypair.generate();

    // g[0] creates (1 of 2) — only 1 signed, insufficient
    await program.methods
      .createCovenant({ beneficiaryChange: {} }, newBen.publicKey)
      .accounts({ guardian: guardians[0].publicKey, vault: vaultPda, guardianAccount: gPdas[0], covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardians[0]])
      .rpc();

    // signaturesCompleteSlot should be 0 (not reached M=2)
    const cov = await program.account.covenantAccount.fetch(covenantPda);
    expect(cov.signaturesCompleteSlot.toNumber()).toBe(0);

    // Execute should fail — signatures_complete_slot = 0 → InsufficientSignatures
    await expect(
      program.methods.executeCovenant()
        .accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null })
        .signers([caller])
        .rpc()
    ).rejects.toThrow(/InsufficientSignatures|CovenantTimelockActive/);
  });

  it("guardian removal via covenant: immediate (0 timelock)", async () => {
    const { vaultPda, guardians, gPdas } = await setupVaultWithGuardians(3, 3, 1);
    const targetGuardian  = guardians[2];
    const [targetGPda]    = gPdas[2];
    const vaultBefore     = await program.account.vaultAccount.fetch(vaultPda);
    const [covenantPda]   = deriveCovenantPda(vaultPda, vaultBefore.covenantCounter);

    await program.methods
      .createCovenant({ guardianRemoval: {} }, targetGuardian.publicKey)
      .accounts({ guardian: guardians[0].publicKey, vault: vaultPda, guardianAccount: gPdas[0], covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardians[0]])
      .rpc();

    // Threshold is 1-of-3 → auto-signed → can execute immediately
    await program.methods
      .executeCovenant()
      .accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: targetGPda })
      .signers([caller])
      .rpc();

    const vaultAfter = await program.account.vaultAccount.fetch(vaultPda);
    expect(vaultAfter.guardianCount).toBe(vaultBefore.guardianCount - 1);
  });

  it("beneficiary change via covenant: 432_000 slot timelock enforced", async () => {
    const { vaultPda, guardians, gPdas } = await setupVaultWithGuardians(4, 2, 1);
    const [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));
    const newBen = Keypair.generate();

    await program.methods
      .createCovenant({ beneficiaryChange: {} }, newBen.publicKey)
      .accounts({ guardian: guardians[0].publicKey, vault: vaultPda, guardianAccount: gPdas[0], covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([guardians[0]])
      .rpc();

    // Try to execute immediately — must fail with CovenantTimelockActive
    await expect(
      program.methods.executeCovenant()
        .accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null })
        .signers([caller])
        .rpc()
    ).rejects.toThrow(/CovenantTimelockActive/);

    // Wait past timelock
    const cov = await program.account.covenantAccount.fetch(covenantPda);
    context.warpToSlot(BigInt(cov.signaturesCompleteSlot.toString()) + BENEFICIARY_CHANGE_TIMELOCK + 1n);

    await program.methods
      .executeCovenant()
      .accounts({ caller: caller.publicKey, vault: vaultPda, covenant: covenantPda, targetGuardian: null })
      .signers([caller])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.beneficiary.toBase58()).toBe(newBen.publicKey.toBase58());
  });
});
