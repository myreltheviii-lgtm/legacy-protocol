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

// Initialises a vault and performs one check-in to build activity history so
// is_anomalous() has a non-zero sum_of_intervals to compare against.
async function setupVaultWithHistory(program: Program<LegacyVault>, context: ProgramTestContext, owner: Keypair) {
  const [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
  const [activityPda] = deriveActivityPda(vaultPda);

  // v2 API: initializeVault(vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey).
  // No beneficiary account — removed in v2.
  await program.methods
    .initializeVault(new BN(0), new BN(5_000_000), BENEFICIARY_UTXO_PUBKEY)
    .accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda, systemProgram: SystemProgram.programId })
    .signers([owner])
    .rpc();

  const v0 = await program.account.vaultAccount.fetch(vaultPda);
  const s0 = BigInt(v0.lastCheckInSlot.toString());

  // First check-in establishes history: sum_of_intervals = 1000, checkin_count = 1
  context.warpToSlot(s0 + 1000n);
  await program.methods.checkIn().accounts({ owner: owner.publicKey, vault: vaultPda, activity: activityPda }).signers([owner]).rpc();

  return { vaultPda, activityPda };
}

describe("anomaly_flag", () => {
  let context:    ProgramTestContext;
  let program:    Program<LegacyVault>;
  let owner:      Keypair;
  let guardian:   Keypair;
  let vaultPda:   PublicKey;
  let activityPda: PublicKey;
  let gPda:       PublicKey;

  beforeEach(async () => {
    context  = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner    = Keypair.generate();
    guardian = Keypair.generate();

    for (const kp of [owner, guardian]) {
      context.setAccount(kp.publicKey, { lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    }

    ({ vaultPda, activityPda } = await setupVaultWithHistory(program, context, owner));
    [gPda] = deriveGuardianPda(vaultPda, guardian.publicKey);
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian.publicKey, guardianAccount: gPda, systemProgram: SystemProgram.programId }).signers([owner]).rpc();
  });

  it("happy path: anomaly_flagged=true, anomaly_flagged_slot set", async () => {
    const vault = await program.account.vaultAccount.fetch(vaultPda);
    const lastSlot = BigInt(vault.lastCheckInSlot.toString());

    // Warp way past 1.5× average (average = 1000, anomaly threshold = 1500)
    const anomalousSlot = lastSlot + 2000n;
    context.warpToSlot(anomalousSlot);

    await program.methods.anomalyFlag().accounts({ guardian: guardian.publicKey, vault: vaultPda, guardianAccount: gPda, activity: activityPda }).signers([guardian]).rpc();

    const activity = await program.account.activityAccount.fetch(activityPda);
    expect(activity.anomalyFlagged).toBe(true);
    expect(BigInt(activity.anomalyFlaggedSlot.toString())).toBeGreaterThanOrEqual(anomalousSlot);
  });

  it("requires is_anomalous()=true — rejects when not anomalous with ThresholdNotReached", async () => {
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
    const guardian2 = Keypair.generate();
    context.setAccount(guardian2.publicKey, { lamports: LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });
    const [gPda2] = deriveGuardianPda(vaultPda, guardian2.publicKey);
    await program.methods.addGuardian(1).accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian2.publicKey, guardianAccount: gPda2, systemProgram: SystemProgram.programId }).signers([owner]).rpc();

    // Phase 1 removal
    await program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian2.publicKey, guardianAccount: gPda2 }).signers([owner]).rpc();
    const ga = await program.account.guardianAccount.fetch(gPda2);
    context.warpToSlot(BigInt(ga.removalRequestedSlot.toString()) + 216_001n);
    // Phase 2 removal — closes guardian PDA
    await program.methods.removeGuardian().accounts({ owner: owner.publicKey, vault: vaultPda, guardian: guardian2.publicKey, guardianAccount: gPda2 }).signers([owner]).rpc();

    // Try to flag with removed (closed) guardian PDA
    await expect(
      program.methods.anomalyFlag().accounts({ guardian: guardian2.publicKey, vault: vaultPda, guardianAccount: gPda2, activity: activityPda }).signers([guardian2]).rpc(),
    ).rejects.toThrow();
  });
});
