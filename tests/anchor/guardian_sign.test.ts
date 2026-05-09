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

// A non-zero 32-byte Cloak UTXO pubkey for the beneficiary identity (v2 arg, not account).
const BENEFICIARY_UTXO_PUBKEY = Array.from({ length: 32 }, (_, i) => i + 1);

describe("guardian_sign", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let g1:         Keypair;
  let g2:         Keypair;
  let g3:         Keypair;
  let vaultPda:   PublicKey;
  let gPda1:      PublicKey;
  let gPda2:      PublicKey;
  let gPda3:      PublicKey;
  let covenantPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner    = Keypair.generate();
    g1 = Keypair.generate(); g2 = Keypair.generate(); g3 = Keypair.generate();

    context.setAccount(owner.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    context.setAccount(g1.publicKey, { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    context.setAccount(g2.publicKey, { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    context.setAccount(g3.publicKey, { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]          = deriveVaultPda(owner.publicKey, new BN(0));
    const [activityPda] = deriveActivityPda(vaultPda);
    [gPda1]             = deriveGuardianPda(vaultPda, g1.publicKey);
    [gPda2]             = deriveGuardianPda(vaultPda, g2.publicKey);
    [gPda3]             = deriveGuardianPda(vaultPda, g3.publicKey);

    // v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
    // No beneficiary account — removed in v2.
    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000), BENEFICIARY_UTXO_PUBKEY)
      .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    await program.methods.addGuardian(2).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(2).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(2).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g3.publicKey, guardianAccount: gPda3, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Create a covenant (g1 auto-signs as creator)
    [covenantPda] = deriveCovenantPda(vaultPda, new BN(0));
    await program.methods
      .createCovenant({ emergencySweep: {} }, PublicKey.default)
      .accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: covenantPda, systemProgram: SystemProgram.programId })
      .signers([g1])
      .rpc();
  });

  it("happy path: signature recorded, signers vec updated", async () => {
    await program.methods
      .guardianSign()
      .accounts({ guardian: g2.publicKey, vault: vaultPda, guardianAccount: gPda2, covenant: covenantPda })
      .signers([g2])
      .rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    expect(covenant.signers.map((s: PublicKey) => s.toBase58())).toContain(g2.publicKey.toBase58());
  });

  it("duplicate sign rejected with AlreadySigned", async () => {
    await expect(
      program.methods
        .guardianSign()
        .accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: covenantPda })
        .signers([g1])
        .rpc(),
    ).rejects.toThrow(/AlreadySigned/);
  });

  it("non-guardian rejected", async () => {
    const notGuardian = Keypair.generate();
    context.setAccount(notGuardian.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    const [fakePda] = deriveGuardianPda(vaultPda, notGuardian.publicKey);

    await expect(
      program.methods
        .guardianSign()
        .accounts({ guardian: notGuardian.publicKey, vault: vaultPda, guardianAccount: fakePda, covenant: covenantPda })
        .signers([notGuardian])
        .rpc(),
    ).rejects.toThrow();
  });

  it("signatures_complete_slot set exactly at M-of-N threshold (2nd of 2)", async () => {
    // g1 already signed, g2 signing reaches M=2
    const beforeSlot = await context.banksClient.getSlot();

    await program.methods
      .guardianSign()
      .accounts({ guardian: g2.publicKey, vault: vaultPda, guardianAccount: gPda2, covenant: covenantPda })
      .signers([g2])
      .rpc();

    const covenant = await program.account.covenantAccount.fetch(covenantPda);
    expect(BigInt(covenant.signaturesCompleteSlot.toString())).toBeGreaterThanOrEqual(BigInt(beforeSlot.toString()));
    expect(covenant.signers.length).toBe(2);
  });

  it("signatures_complete_slot not set before M-of-N — still 0 after 1 of 3", async () => {
    // Create a fresh covenant where required_signatures = 3
    const [cov2] = deriveCovenantPda(vaultPda, new BN(1));

    // Increase threshold to 3 by adding a 4th guardian with m=3
    const g4 = Keypair.generate();
    const [gPda4] = deriveGuardianPda(vaultPda, g4.publicKey);
    context.setAccount(g4.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    await program.methods.addGuardian(3).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g4.publicKey, guardianAccount: gPda4, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Create a 3-of-4 covenant — required_signatures = 3 at creation time
    await program.methods
      .createCovenant({ emergencySweep: {} }, PublicKey.default)
      .accounts({ guardian: g1.publicKey, vault: vaultPda, guardianAccount: gPda1, covenant: cov2, systemProgram: SystemProgram.programId })
      .signers([g1])
      .rpc();

    // After 1 signature, complete_slot should still be 0
    const cov = await program.account.covenantAccount.fetch(cov2);
    expect(cov.signaturesCompleteSlot.toNumber()).toBe(0);
  });
});
