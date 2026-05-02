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

describe("deposit", () => {
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
    context.setAccount(owner.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000))
      .accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();
  });

  it("happy path: lamports transferred, deposited_lamports updated", async () => {
    const depositLamports = new BN(LAMPORTS_PER_SOL);

    const vaultBefore = await program.account.vaultAccount.fetch(vaultPda);
    const vaultAccountBefore = await context.banksClient.getAccount(vaultPda);

    await program.methods
      .deposit(depositLamports)
      .accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.depositedLamports.toString()).toBe(depositLamports.toString());

    const vaultAccountAfter = await context.banksClient.getAccount(vaultPda);
    expect(vaultAccountAfter!.lamports).toBeGreaterThan(vaultAccountBefore!.lamports);
  });

  it("zero amount rejected with ZeroAmount", async () => {
    await expect(
      program.methods
        .deposit(new BN(0))
        .accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/ZeroAmount/);
  });

  it("non-owner rejected with UnauthorisedOwner", async () => {
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods
        .deposit(new BN(LAMPORTS_PER_SOL))
        .accounts({ owner: attacker.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId })
        .signers([attacker])
        .rpc(),
    ).rejects.toThrow(/UnauthorisedOwner|constraint/i);
  });

  it("deposited_lamports accumulates across multiple deposits", async () => {
    await program.methods.deposit(new BN(100_000)).accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.deposit(new BN(200_000)).accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
    await program.methods.deposit(new BN(50_000)).accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.depositedLamports.toNumber()).toBe(350_000);
  });

  it("System Program CPI executes correctly — vault account lamport balance increases", async () => {
    const vaultInfoBefore = await context.banksClient.getAccount(vaultPda);
    const deposit = 500_000;

    await program.methods
      .deposit(new BN(deposit))
      .accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    const vaultInfoAfter = await context.banksClient.getAccount(vaultPda);
    expect(vaultInfoAfter!.lamports - vaultInfoBefore!.lamports).toBe(deposit);
  });

  it("single lamport deposit accepted", async () => {
    await program.methods
      .deposit(new BN(1))
      .accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.depositedLamports.toNumber()).toBe(1);
  });
});
```

