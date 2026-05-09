import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import * as anchor           from "@coral-xyz/anchor";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID    = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");

function deriveVaultPda(owner: PublicKey, vaultIndex: BN): [PublicKey, number] {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(vaultIndex.toString()));
  return PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBuffer(), b], PROGRAM_ID);
}
function deriveActivityPda(vaultPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ACTIVITY_SEED, vaultPda.toBuffer()], PROGRAM_ID);
}

// A non-zero 32-byte Cloak UTXO pubkey for the beneficiary identity (v2 arg, not account).
const BENEFICIARY_UTXO_PUBKEY = Array.from({ length: 32 }, (_, i) => i + 1);

describe("configure_threshold", () => {
  let context:    ProgramTestContext;
  let provider:   BankrunProvider;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    provider = new BankrunProvider(context);
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

  it("happy path: threshold updated", async () => {
    await program.methods
      .configureThreshold(new BN(1_000_000))
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(1_000_000);
  });

  it("warning_75_sent and warning_90_sent start false and are not corrupted by configure", async () => {
    await program.methods
      .configureThreshold(new BN(2_000_000))
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.warning75Sent).toBe(false);
    expect(vault.warning90Sent).toBe(false);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(2_000_000);
  });

  it("below MIN (432_000) rejected with ThresholdTooLow", async () => {
    await expect(
      program.methods
        .configureThreshold(new BN(431_999))
        .accounts({ owner: owner.publicKey, vault: vaultPda })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/ThresholdTooLow/);
  });

  it("above MAX (157_680_000) rejected with ThresholdTooHigh", async () => {
    await expect(
      program.methods
        .configureThreshold(new BN(157_680_001))
        .accounts({ owner: owner.publicKey, vault: vaultPda })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/ThresholdTooHigh/);
  });

  it("exactly MIN accepted", async () => {
    await program.methods
      .configureThreshold(new BN(432_000))
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(432_000);
  });

  it("exactly MAX accepted", async () => {
    await program.methods
      .configureThreshold(new BN(157_680_000))
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(157_680_000);
  });

  it("non-owner rejected with UnauthorisedOwner", async () => {
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, { lamports: 2 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods
        .configureThreshold(new BN(1_000_000))
        .accounts({ owner: attacker.publicKey, vault: vaultPda })
        .signers([attacker])
        .rpc(),
    ).rejects.toThrow(/UnauthorisedOwner|constraint/i);
  });

  it("threshold can be updated multiple times — last valid update wins", async () => {
    await program.methods.configureThreshold(new BN(1_000_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc();
    await program.methods.configureThreshold(new BN(2_000_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(2_000_000);
  });

  it("threshold below MIN on third update rejected with ThresholdTooLow", async () => {
    await program.methods.configureThreshold(new BN(1_000_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc();
    await program.methods.configureThreshold(new BN(2_000_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc();

    await expect(
      program.methods.configureThreshold(new BN(431_999)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc(),
    ).rejects.toThrow(/ThresholdTooLow/);
  });
});
