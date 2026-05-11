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

describe("integration: full vault lifecycle", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  // In v2 the beneficiary is identified by raw pubkey bytes stored in vault.beneficiaryUtxoPubkey.
  // Using the beneficiary's Solana pubkey bytes lets claim_inheritance verify the signer.
  let beneficiaryUtxoPubkey: number[];
  let caller:     Keypair;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();
    caller      = Keypair.generate();
    beneficiaryUtxoPubkey = Array.from(beneficiary.publicKey.toBytes());

    for (const kp of [owner, caller]) {
      context.setAccount(kp.publicKey, { lamports: 20 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }
    context.setAccount(beneficiary.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
  });

  it("initialize → deposit → add 3 guardians → check-in cycle → trigger → claim", async () => {
    const [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    const [activityPda] = deriveActivityPda(vaultPda);

    // 1. Initialize — v2 API: no beneficiary account, UTXO pubkey as arg
    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000), beneficiaryUtxoPubkey)
      .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    let vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.isTriggered).toBe(false);
    expect(vault.depositedLamports.toNumber()).toBe(0);

    // 2. Deposit 2 SOL
    await program.methods
      .deposit(new BN(2 * LAMPORTS_PER_SOL))
      .accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.depositedLamports.toNumber()).toBe(2 * LAMPORTS_PER_SOL);

    // 3. Add 3 guardians
    const guardians = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    const gPdas: PublicKey[] = [];
    for (let i = 0; i < 3; i++) {
      context.setAccount(guardians[i].publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
      const [gPda] = deriveGuardianPda(vaultPda, guardians[i].publicKey);
      gPdas.push(gPda);
      await program.methods
        .addGuardian(i === 2 ? 2 : 1)
        .accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardians[i].publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc();
    }

    vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.guardianCount).toBe(3);
    expect(vault.mOfNThreshold).toBe(2);

    // 4. Check-in cycle — 3 check-ins building activity history
    for (let i = 0; i < 3; i++) {
      const v = await program.account.vaultAccount.fetch(vaultPda);
      const nextSlot = BigInt(v.lastCheckInSlot.toString()) + BigInt(1000 + i * 200);
      context.warpToSlot(nextSlot);
      await program.methods
        .checkIn()
        .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda })
        .signers([owner])
        .rpc();
    }

    const activity = await program.account.activityAccount.fetch(activityPda);
    expect(activity.checkinCount.toNumber()).toBe(3);
    expect(BigInt(activity.sumOfIntervals.toString())).toBeGreaterThan(0n);

    // 5. Warp past threshold and trigger — only caller + vault accounts
    const v2 = await program.account.vaultAccount.fetch(vaultPda);
    const triggerSlot = BigInt(v2.lastCheckInSlot.toString()) + BigInt(v2.inactivityThresholdSlots.toString());
    context.warpToSlot(triggerSlot);

    await program.methods
      .triggerInheritance()
      .accounts({ caller: caller.publicKey, vault: vaultPda })
      .signers([caller])
      .rpc();

    vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.isTriggered).toBe(true);

    // 6. Claim — verify all lamports reach beneficiary and PDAs are closed
    const vaultInfo    = await context.banksClient.getAccount(vaultPda);
    const activityInfo = await context.banksClient.getAccount(activityPda);
    const expectedTotal = BigInt(vaultInfo!.lamports) + BigInt(activityInfo!.lamports);
    const benBefore = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);

    await program.methods
      .claimInheritance()
      .accounts({ beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([beneficiary])
      .rpc();

    expect(await context.banksClient.getAccount(vaultPda)).toBeNull();
    expect(await context.banksClient.getAccount(activityPda)).toBeNull();

    const benAfter = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);
    const received = benAfter - benBefore;
    expect(received).toBeGreaterThan(expectedTotal - 10_000n);
    expect(received).toBeGreaterThanOrEqual(BigInt(2 * LAMPORTS_PER_SOL) - 10_000n);
  });

  it("verify all lamports (deposit + rent) reach beneficiary in full", async () => {
    const [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(1));
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(new BN(1), new BN(5_000_000), beneficiaryUtxoPubkey)
      .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    const depositAmount = 3 * LAMPORTS_PER_SOL;
    await program.methods.deposit(new BN(depositAmount)).accounts({ owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    const vaultInfo     = await context.banksClient.getAccount(vaultPda);
    const activityInfo  = await context.banksClient.getAccount(activityPda);
    const totalOnChain  = BigInt(vaultInfo!.lamports) + BigInt(activityInfo!.lamports);

    const v0 = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(v0.lastCheckInSlot.toString()) + BigInt(v0.inactivityThresholdSlots.toString()));

    // trigger_inheritance: only caller + vault accounts
    await program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc();

    const benBefore = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);
    await program.methods.claimInheritance().accounts({ beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([beneficiary]).rpc();
    const benAfter = BigInt((await context.banksClient.getAccount(beneficiary.publicKey))!.lamports);

    const received = benAfter - benBefore;
    expect(received).toBeGreaterThan(totalOnChain - 10_000n);
    expect(received).toBeGreaterThanOrEqual(BigInt(depositAmount) - 10_000n);
  });

  it("verify all PDAs closed after claim", async () => {
    const [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(2));
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods.initializeVault(new BN(2), new BN(5_000_000), beneficiaryUtxoPubkey).accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    const v0 = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(v0.lastCheckInSlot.toString()) + BigInt(v0.inactivityThresholdSlots.toString()));
    // trigger_inheritance: only caller + vault accounts
    await program.methods.triggerInheritance().accounts({ caller: caller.publicKey, vault: vaultPda }).signers([caller]).rpc();
    await program.methods.claimInheritance().accounts({ beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([beneficiary]).rpc();

    expect(await context.banksClient.getAccount(vaultPda)).toBeNull();
    expect(await context.banksClient.getAccount(activityPda)).toBeNull();
  });
});
