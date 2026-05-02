import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
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

describe("trigger_inheritance", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  let caller:     Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();
    caller      = Keypair.generate();

    for (const kp of [owner, caller]) {
      context.setAccount(kp.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);

    await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
  });

  it("happy path: is_triggered=true at threshold_crossed()", async () => {
    const vault0 = await program.account.vaultAccount.fetch(vaultPda);
    const lastSlot = BigInt(vault0.lastCheckInSlot.toString());
    const threshold = BigInt(vault0.inactivityThresholdSlots.toString());

    context.warpToSlot(lastSlot + threshold);

    await program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.isTriggered).toBe(true);
  });

  it("permissionless — any signer can trigger", async () => {
    const anyoneKeypair = Keypair.generate();
    context.setAccount(anyoneKeypair.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    const vault0 = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(vault0.lastCheckInSlot.toString()) + BigInt(vault0.inactivityThresholdSlots.toString()));

    await program.methods.triggerInheritance().accounts({ caller: anyoneKeypair.publicKey, vault: vaultPda }).signers([anyoneKeypair]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.isTriggered).toBe(true);
  });

  it("rejected before threshold with ThresholdNotReached", async () => {
    const vault0 = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(vault0.lastCheckInSlot.toString()) + BigInt(vault0.inactivityThresholdSlots.toString()) - 1n);

    await expect(
      program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc(),
    ).rejects.toThrow(/ThresholdNotReached/);
  });

  it("already triggered rejected with VaultAlreadyTriggered", async () => {
    const vault0 = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(vault0.lastCheckInSlot.toString()) + BigInt(vault0.inactivityThresholdSlots.toString()));

    await program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc();

    await expect(
      program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc(),
    ).rejects.toThrow(/VaultAlreadyTriggered/);
  });

  it("trigger at exact threshold slot succeeds", async () => {
    const vault0 = await program.account.vaultAccount.fetch(vaultPda);
    const triggerSlot = BigInt(vault0.lastCheckInSlot.toString()) + BigInt(vault0.inactivityThresholdSlots.toString());
    context.warpToSlot(triggerSlot);

    await program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.isTriggered).toBe(true);
  });
});
```

