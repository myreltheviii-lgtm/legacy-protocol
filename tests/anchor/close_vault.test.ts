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

describe("close_vault", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner    = Keypair.generate();
    context.setAccount(owner.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);

    // v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
    // No beneficiary account — removed in v2.
    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000), BENEFICIARY_UTXO_PUBKEY)
      .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();
  });

  it("happy path: vault + activity closed, rent returned to owner", async () => {
    const ownerBalanceBefore = (await context.banksClient.getAccount(owner.publicKey))!.lamports;

    await program.methods
      .closeVault()
      .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    const vaultAccount    = await context.banksClient.getAccount(vaultPda);
    const activityAccount = await context.banksClient.getAccount(activityPda);

    expect(vaultAccount).toBeNull();
    expect(activityAccount).toBeNull();

    const ownerBalanceAfter = (await context.banksClient.getAccount(owner.publicKey))!.lamports;
    expect(ownerBalanceAfter).toBeGreaterThan(ownerBalanceBefore);
  });

  it("fails if deposited_lamports > 0 with VaultNotEmpty", async () => {
    await program.methods
      .deposit(new BN(LAMPORTS_PER_SOL))
      .accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    await expect(
      program.methods
        .closeVault()
        .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/VaultNotEmpty/);
  });

  it("fails if guardian_count > 0 with GuardiansStillRegistered", async () => {
    const guardian = Keypair.generate();
    const [guardianPda] = deriveGuardianPda(vaultPda, guardian.publicKey);

    await program.methods
      .addGuardian(1)
      .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: guardianPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    await expect(
      program.methods
        .closeVault()
        .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/GuardiansStillRegistered/);
  });

  it("fails if is_triggered with VaultAlreadyTriggered", async () => {
    context.warpToSlot(BigInt(5_000_001));

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    // trigger_inheritance: only caller + vault accounts
    await program.methods
      .triggerInheritance()
      .accounts({ caller: caller.publicKey, vault: vaultPda })
      .signers([caller])
      .rpc();

    await expect(
      program.methods
        .closeVault()
        .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/VaultAlreadyTriggered/);
  });

  it("non-owner rejected", async () => {
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods
        .closeVault()
        .accounts({ owner: attacker.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
        .signers([attacker])
        .rpc(),
    ).rejects.toThrow(/UnauthorisedOwner|constraint/i);
  });
});
