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

async function setupVaultWithHistory(program: Program<LegacyVault>, context: ProgramTestContext, owner: Keypair, beneficiary: Keypair) {
  const [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
  const [activityPda] = deriveActivityPda(vaultPda);

  await program.methods.initializeVault(new BN(0), new BN(5_000_000)).accounts({ owner: owner.publicKey, beneficiary: beneficiary.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

  const v0 = await program.account.vaultAccount.fetch(vaultPda);
  const s0 = BigInt(v0.lastCheckInSlot.toString());

  // First check-in establishes history
  context.warpToSlot(s0 + 1000n);
  await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

  return { vaultPda, activityPda };
}

describe("anomaly_flag", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let beneficiary: Keypair;
  let guardian:   Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;
  let gPda:       PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner       = Keypair.generate();
    beneficiary = Keypair.generate();
    guardian    = Keypair.generate();

    for (const kp of [owner, guardian]) {
      context.setAccount(kp.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }

    ({ vaultPda, activityPda } = await setupVaultWithHistory(program, context, owner, beneficiary));
    [gPda] = deriveGuardianPda(vaultPda, guardian.publicKey);
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
  });

  it("happy path: anomaly_flagged=true, anomaly_flagged_slot set", async () => {
    const vault = await program.account.vaultAccount.fetch(vaultPda);
    const lastSlot = BigInt(vault.lastCheckInSlot.toString());

    // Warp way past 1.5× average (average = 1000, threshold = 1500)
    const anomalousSlot = lastSlot + 2000n;
    context.warpToSlot(anomalousSlot);

    await program.methods.anomalyFlag().accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, activity: activityPda }).signers([guardian]).rpc();

    const activity = await program.account.activityAccount.fetch(activityPda);
    expect(activity.anomalyFlagged).toBe(true);
    expect(BigInt(activity.anomalyFlaggedSlot.toString())).toBeGreaterThanOrEqual(anomalousSlot);
  });

  it("requires is_anomalous()=true — rejects when not anomalous", async () => {
    const vault = await program.account.vaultAccount.fetch(vaultPda);
    const lastSlot = BigInt(vault.lastCheckInSlot.toString());

    // Only 10 slots elapsed — not anomalous vs average of 1000
    context.warpToSlot(lastSlot + 10n);

    await expect(
      program.methods.anomalyFlag().accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, activity: activityPda }).signers([guardian]).rpc(),
    ).rejects.toThrow(/ThresholdNotReached/);
  });

  it("double-flag rejected with AnomalyAlreadyFlagged", async () => {
    const vault = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(vault.lastCheckInSlot.toString()) + 2000n);

    await program.methods.anomalyFlag().accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, activity: activityPda }).signers([guardian]).rpc();

    await expect(
      program.methods.anomalyFlag().accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, activity: activityPda }).signers([guardian]).rpc(),
    ).rejects.toThrow(/AnomalyAlreadyFlagged/);
  });

  it("non-guardian rejected", async () => {
    const stranger = Keypair.generate();
    context.setAccount(stranger.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    const [strangerGPda] = deriveGuardianPda(vaultPda, stranger.publicKey);

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    context.warpToSlot(BigInt(vault.lastCheckInSlot.toString()) + 2000n);

    await expect(
      program.methods.anomalyFlag().accounts({ guardian: stranger.publicKey, vault: vaultPda, guardianAccount: strangerGPda, activity: activityPda }).signers([stranger]).rpc(),
    ).rejects.toThrow();
  });

  it("inactive guardian rejected", async () => {
    // Remove guardian to make them inactive
    const guardian2 = Keypair.generate();
    context.setAccount(guardian2.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    const [gPda2] = deriveGuardianPda(vaultPda, guardian2.publicKey);
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Initiate removal
    await program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian2.publicKey, guardianAccount: gPda2 }).signers([owner]).rpc();
    const ga = await program.account.guardianAccount.fetch(gPda2);
    context.warpToSlot(BigInt(ga.removalRequestedSlot.toString()) + 216_001n);
    await program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian2.publicKey, guardianAccount: gPda2 }).signers([owner]).rpc();

    // Try to flag with removed (closed) guardian PDA
    await expect(
      program.methods.anomalyFlag().accounts({ guardian: guardian2.publicKey, vault: vaultPda, guardianAccount: gPda2, activity: activityPda }).signers([guardian2]).rpc(),
    ).rejects.toThrow();
  });
});
```

