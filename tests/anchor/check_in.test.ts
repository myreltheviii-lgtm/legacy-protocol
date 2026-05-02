import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID    = new PublicKey("LGCYvau1tXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
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

describe("check_in", () => {
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

    await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
  });

  it("happy path: last_check_in_slot updated, checkin_count incremented", async () => {
    const initVault = await program.account.vaultAccount.fetch(vaultPda);
    const initSlot  = BigInt(initVault.lastCheckInSlot.toString());

    // Warp forward
    context.warpToSlot(initSlot + 1000n);

    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    const vault    = await program.account.vaultAccount.fetch(vaultPda);
    const activity = await program.account.activityAccount.fetch(activityPda);

    expect(BigInt(vault.lastCheckInSlot.toString())).toBeGreaterThan(initSlot);
    expect(activity.checkinCount.toNumber()).toBe(1);
  });

  it("sum_of_intervals accumulates correctly", async () => {
    const initVault = await program.account.vaultAccount.fetch(vaultPda);
    const initSlot  = BigInt(initVault.lastCheckInSlot.toString());

    context.warpToSlot(initSlot + 500n);
    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    const activity1 = await program.account.activityAccount.fetch(activityPda);
    const interval1 = BigInt(activity1.sumOfIntervals.toString());
    expect(interval1).toBe(500n);

    const vault1 = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(vault1.lastCheckInSlot.toString()) + 300n);
    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    const activity2 = await program.account.activityAccount.fetch(activityPda);
    expect(BigInt(activity2.sumOfIntervals.toString())).toBe(800n);
    expect(activity2.checkinCount.toNumber()).toBe(2);
  });

  it("last_interval updated correctly", async () => {
    const initVault = await program.account.vaultAccount.fetch(vaultPda);
    const initSlot  = BigInt(initVault.lastCheckInSlot.toString());

    context.warpToSlot(initSlot + 700n);
    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    const activity = await program.account.activityAccount.fetch(activityPda);
    expect(BigInt(activity.lastInterval.toString())).toBe(700n);
  });

  it("anomaly_flagged cleared on check-in", async () => {
    const initVault = await program.account.vaultAccount.fetch(vaultPda);
    const initSlot  = BigInt(initVault.lastCheckInSlot.toString());

    // Add guardian and flag anomaly
    const guardian = Keypair.generate();
    context.setAccount(guardian.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    const [gPda] = deriveGuardianPda(vaultPda, guardian.publicKey);
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Warp past anomaly threshold: elapsed > (0 * 150) / 0 / 100 → not anomalous yet (no history)
    // Need at least one check-in first to build history
    context.warpToSlot(initSlot + 1000n);
    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    const vault1 = await program.account.vaultAccount.fetch(vaultPda);
    // Warp way past 1.5× the average
    context.warpToSlot(BigInt(vault1.lastCheckInSlot.toString()) + 2000n);
    await program.methods.anomalyFlag().accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, activity: activityPda }).signers([guardian]).rpc();

    const activityFlagged = await program.account.activityAccount.fetch(activityPda);
    expect(activityFlagged.anomalyFlagged).toBe(true);

    // Check in clears the flag
    const vault2 = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(vault2.lastCheckInSlot.toString()) + 1n);
    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    const activityCleared = await program.account.activityAccount.fetch(activityPda);
    expect(activityCleared.anomalyFlagged).toBe(false);
    expect(activityCleared.anomalyFlaggedSlot.toNumber()).toBe(0);
  });

  it("warning_75_sent and warning_90_sent reset on check-in — they start false", async () => {
    const initVault = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(initVault.lastCheckInSlot.toString()) + 100n);

    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.warning75Sent).toBe(false);
    expect(vault.warning90Sent).toBe(false);
  });

  it("same-slot check-in rejected with SameSlotCheckIn", async () => {
    // Impossible to get same slot in bankrun easily since slot advances;
    // we test by doing two rapid calls — the second may be same slot
    // The actual same-slot test: warp to a slot, check in, try same slot again.
    const initVault = await program.account.vaultAccount.fetch(vaultPda);
    const slot = BigInt(initVault.lastCheckInSlot.toString()) + 500n;
    context.warpToSlot(slot);

    await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

    // Stay at same slot — warp to same slot again (bankrun allows this)
    context.warpToSlot(slot);

    await expect(
      program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc(),
    ).rejects.toThrow(/SameSlotCheckIn/);
  });

  it("non-owner rejected", async () => {
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

    await expect(
      program.methods.checkIn().accounts({ owner: attacker.publicKey, vault: vaultPda, activity: activityPda }).signers([attacker]).rpc(),
    ).rejects.toThrow(/UnauthorisedOwner|constraint/i);
  });
});
```

