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
const GUARDIAN_REMOVAL_TIMELOCK = 216_000n;

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

describe("remove_guardian", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let vaultPda:   PublicKey;
  let g1:         Keypair;
  let g2:         Keypair;
  let gPda1:      PublicKey;
  let gPda2:      PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner    = Keypair.generate();
    context.setAccount(owner.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]          = deriveVaultPda(owner.publicKey, new BN(0));
    const [activityPda] = deriveActivityPda(vaultPda);

    // v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
    // No beneficiary account — removed in v2.
    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000), BENEFICIARY_UTXO_PUBKEY)
      .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    g1 = Keypair.generate();
    g2 = Keypair.generate();
    [gPda1] = deriveGuardianPda(vaultPda, g1.publicKey);
    [gPda2] = deriveGuardianPda(vaultPda, g2.publicKey);

    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
  });

  it("Phase 1: removal_requested_slot set, guardian still active", async () => {
    const slotBefore = await context.banksClient.getSlot();

    await program.methods
      .removeGuardian()
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 })
      .signers([owner])
      .rpc();

    const ga = await program.account.guardianAccount.fetch(gPda1);
    expect(ga.isActive).toBe(true);
    expect(BigInt(ga.removalRequestedSlot.toString())).toBeGreaterThanOrEqual(BigInt(slotBefore.toString()));

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.guardianCount).toBe(2); // still 2, removal not finalised
  });

  it("Phase 2 before timelock: RemovalTimelockActive", async () => {
    await program.methods
      .removeGuardian()
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 })
      .signers([owner])
      .rpc();

    await expect(
      program.methods
        .removeGuardian()
        .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/RemovalTimelockActive/);
  });

  it("Phase 2 after 216_000 slots: guardian PDA closed, guardian_count decremented", async () => {
    // Phase 1
    await program.methods
      .removeGuardian()
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 })
      .signers([owner])
      .rpc();

    const ga1 = await program.account.guardianAccount.fetch(gPda1);
    const requestedSlot = BigInt(ga1.removalRequestedSlot.toString());

    // Warp past the 216_000 slot timelock
    context.warpToSlot(requestedSlot + GUARDIAN_REMOVAL_TIMELOCK + 1n);

    // Phase 2
    await program.methods
      .removeGuardian()
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.guardianCount).toBe(1);

    const guardianPdaInfo = await context.banksClient.getAccount(gPda1);
    expect(guardianPdaInfo).toBeNull();
  });

  it("No pending removal: calling Phase 2 on guardian with no Phase 1 routes to Phase 1, then RemovalTimelockActive on immediate retry", async () => {
    // First call with no pending removal routes to Phase 1 (sets removal_requested_slot)
    await program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 }).signers([owner]).rpc();

    // Immediate second call hits RemovalTimelockActive (timelock not elapsed)
    await expect(
      program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 }).signers([owner]).rpc(),
    ).rejects.toThrow(/RemovalTimelockActive/);
  });

  it("non-owner rejected", async () => {
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods
        .removeGuardian()
        .accounts({ owner: attacker.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 })
        .signers([attacker])
        .rpc(),
    ).rejects.toThrow(/UnauthorisedOwner|constraint/i);
  });

  it("removing guardian that would break M-of-N: ThresholdTooSmall (only guardian, M=1)", async () => {
    // Remove g2 first so only g1 remains with M=1
    await program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2 }).signers([owner]).rpc();
    const ga2 = await program.account.guardianAccount.fetch(gPda2);
    context.warpToSlot(BigInt(ga2.removalRequestedSlot.toString()) + GUARDIAN_REMOVAL_TIMELOCK + 1n);
    await program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g2.publicKey, guardianAccount: gPda2 }).signers([owner]).rpc();

    // Now only g1 remains with guardian_count=1. Trying to remove g1 should fail
    await expect(
      program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: g1.publicKey, guardianAccount: gPda1 }).signers([owner]).rpc(),
    ).rejects.toThrow(/ThresholdTooSmall/);
  });
});
