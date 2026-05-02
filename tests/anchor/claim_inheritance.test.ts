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

describe("claim_inheritance", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();

    for (const kp of [owner]) {
      context.setAccount(kp.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }
    // Give beneficiary some lamports so it exists
    context.setAccount(beneficiary.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);

    await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Deposit 1 SOL
    await program.methods.deposit(new BN(LAMPORTS_PER_SOL)).accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Trigger
    const vault0 = await program.account.vaultAccount.fetch(vaultPda);
    const triggerSlot = BigInt(vault0.lastCheckInSlot.toString()) + BigInt(vault0.inactivityThresholdSlots.toString());
    context.warpToSlot(triggerSlot);

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    await program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc();
  });

  it("happy path: vault + activity closed, ALL lamports sent to beneficiary", async () => {
    const vaultInfo    = await context.banksClient.getAccount(vaultPda);
    const activityInfo = await context.banksClient.getAccount(activityPda);
    const totalFromPdas = BigInt(vaultInfo!.lamports) + BigInt(activityInfo!.lamports);

    const beneficiaryBefore = (await context.banksClient.getAccount(beneficiary.publicKey))!.lamports;

    await program.methods.claimInheritance().accounts({ beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([beneficiary]).rpc();

    const vaultAfter    = await context.banksClient.getAccount(vaultPda);
    const activityAfter = await context.banksClient.getAccount(activityPda);
    expect(vaultAfter).toBeNull();
    expect(activityAfter).toBeNull();

    const beneficiaryAfter = (await context.banksClient.getAccount(beneficiary.publicKey))!.lamports;
    // beneficiary received vault+activity lamports (minus tx fee from their account)
    expect(BigInt(beneficiaryAfter)).toBeGreaterThan(BigInt(beneficiaryBefore));
    // Check they received at least the deposited 1 SOL
    expect(BigInt(beneficiaryAfter) - BigInt(beneficiaryBefore)).toBeGreaterThanOrEqual(BigInt(LAMPORTS_PER_SOL) - 10000n);
  });

  it("lamports = deposited + vault rent + activity rent — beneficiary gets all", async () => {
    const vaultInfo    = await context.banksClient.getAccount(vaultPda);
    const activityInfo = await context.banksClient.getAccount(activityPda);
    const expectedTotal = BigInt(vaultInfo!.lamports) + BigInt(activityInfo!.lamports);
    const benBefore = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);

    await program.methods.claimInheritance().accounts({ beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([beneficiary]).rpc();

    const benAfter = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);
    // The beneficiary's net gain should be close to expectedTotal (small tx fee deducted by runtime)
    const gain = benAfter - benBefore;
    expect(gain).toBeGreaterThan(expectedTotal - 10000n);
  });

  it("non-beneficiary rejected with UnauthorisedBeneficiary", async () => {
    const impostor = Keypair.generate();
    context.setAccount(impostor.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.claimInheritance().accounts({ beneficiary: impostor.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([impostor]).rpc(),
    ).rejects.toThrow(/UnauthorisedBeneficiary|constraint/i);
  });

  it("untriggered vault rejected with VaultNotTriggered", async () => {
    // Create a fresh vault that has not been triggered
    const owner2 = Keypair.generate();
    const ben2   = Keypair.generate();
    context.setAccount(owner2.publicKey, { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    context.setAccount(ben2.publicKey,   { lamports: LAMPORTS_PER_SOL,     data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    const [vaultPda2]    = deriveVaultPda(owner2.publicKey, new BN(0));
    const [activityPda2] = deriveActivityPda(vaultPda2);

    await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner2.publicKey, beneficiary: ben2.publicKey, vault: vaultPda2, activity: activityPda2, systemProgram: SystemProgram.programId }).signers([owner2]).rpc();

    await expect(
      program.methods.claimInheritance().accounts({ beneficiary: ben2.publicKey, vault: vaultPda2, activity: activityPda2, systemProgram: SystemProgram.programId }).signers([ben2]).rpc(),
    ).rejects.toThrow(/VaultNotTriggered/);
  });
});
```

