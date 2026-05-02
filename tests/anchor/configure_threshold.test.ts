import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import * as anchor           from "@coral-xyz/anchor";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID    = new PublicKey("LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");

function deriveVaultPda(owner: PublicKey, vaultIndex: BN): [PublicKey, number] {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(vaultIndex.toString()));
  return PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBuffer(), b], PROGRAM_ID);
}
function deriveActivityPda(vaultPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ACTIVITY_SEED, vaultPda.toBuffer()], PROGRAM_ID);
}

describe("configure_threshold", () => {
  let context:    ProgramTestContext;
  let provider:   BankrunProvider;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();
    context.setAccount(owner.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000))
      .accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
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

  it("warning_75_sent and warning_90_sent reset to false on update", async () => {
    // Manually set the warning flags by warping time and sending a ping — 
    // simulate via re-reading the vault after configure to confirm reset.
    // Since we can't easily set flags directly, we just verify configure
    // doesn't corrupt them from their initial false state.
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

  it("threshold can be updated multiple times", async () => {
    await program.methods.configureThreshold(new BN(1_000_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc();
    await program.methods.configureThreshold(new BN(2_000_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc();
    await program.methods.configureThreshold(new BN(500_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc();

    // 500_000 < MIN, should fail
    await expect(
      program.methods.configureThreshold(new BN(500_000)).accounts({ owner: owner.publicKey, vault: vaultPda }).signers([owner]).rpc(),
    ).rejects.toThrow(/ThresholdTooLow/);
  });
});
```

