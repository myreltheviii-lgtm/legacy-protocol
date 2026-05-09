import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }      from "anchor-bankrun";
import * as anchor              from "@coral-xyz/anchor";
import { Program, BN }          from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { LegacyVault }          from "../../target/types/legacy_vault";
import IDL                      from "../../target/idl/legacy_vault.json";

// The program ID must match declare_id! in lib.rs.
const PROGRAM_ID = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");

const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");

const DEFAULT_THRESHOLD = new BN(5_000_000);
const MIN_THRESHOLD     = new BN(432_000);
const MAX_THRESHOLD     = new BN(157_680_000);

// VaultAccount v2 size = 168 bytes.
const VAULT_ACCOUNT_SIZE    = 168;
const ACTIVITY_ACCOUNT_SIZE = 74;

function deriveVaultPda(owner: PublicKey, vaultIndex: BN): [PublicKey, number] {
  const indexBytes = Buffer.alloc(8);
  indexBytes.writeBigUInt64LE(BigInt(vaultIndex.toString()));
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), indexBytes],
    PROGRAM_ID,
  );
}

function deriveActivityPda(vaultPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ACTIVITY_SEED, vaultPda.toBuffer()],
    PROGRAM_ID,
  );
}

// Generates a random 32-byte Cloak UTXO public key for use as
// beneficiary_utxo_pubkey. Must be non-zero to pass InvalidBeneficiary check.
function randomUtxoPubkey(): number[] {
  const bytes = new Array(32).fill(0);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256) || 1;
  return bytes;
}

async function setupProgram() {
  const context = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
  const provider = new BankrunProvider(context);
  const program  = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
  return { context, provider, program };
}

async function airdrop(context: ProgramTestContext, pubkey: PublicKey, lamports: number) {
  context.setAccount(pubkey, {
    lamports,
    data:       Buffer.alloc(0),
    owner:      SystemProgram.programId,
    executable: false,
  });
}

describe("initialize_vault (v2 — beneficiary_utxo_pubkey arg)", () => {
  let context:  ProgramTestContext;
  let provider: BankrunProvider;
  let program:  Program<LegacyVault>;
  let owner:    Keypair;

  // A valid 32-byte non-zero UTXO pubkey representing the beneficiary's
  // Cloak identity. NOT a Solana wallet — do not use beneficiary.publicKey here.
  const beneficiaryUtxoPubkey = Array.from({ length: 32 }, (_, i) => i + 1);

  beforeEach(async () => {
    ({ context, provider, program } = await setupProgram());
    owner = Keypair.generate();
    await airdrop(context, owner.publicKey, 10 * LAMPORTS_PER_SOL);
  });

  it("happy path: vault + activity PDAs created with all v2 fields correct", async () => {
    const vaultIndex = new BN(0);
    const threshold  = new BN(1_000_000);

    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    const currentSlot = await context.banksClient.getSlot();

    // v2: initializeVault takes (vaultIndex, inactivityThresholdSlots, beneficiaryUtxoPubkey)
    // beneficiary_utxo_pubkey is an instruction arg, NOT an account.
    await program.methods
      .initializeVault(vaultIndex, threshold, beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault    = await program.account.vaultAccount.fetch(vaultPda);
    const activity = await program.account.activityAccount.fetch(activityPda);

    expect(vault.owner.toBase58()).toBe(owner.publicKey.toBase58());
    // v2: beneficiaryUtxoPubkey is a [u8;32] array, not a Pubkey
    expect(Array.from(vault.beneficiaryUtxoPubkey as number[])).toEqual(beneficiaryUtxoPubkey);
    expect(vault.guardianCount).toBe(0);
    expect(vault.mOfNThreshold).toBe(0);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(1_000_000);
    expect(vault.depositedLamports.toNumber()).toBe(0);
    expect(vault.covenantCounter.toNumber()).toBe(0);
    expect(vault.vaultIndex.toNumber()).toBe(0);
    // v2 new fields: utxo_commitment all zeros, utxo_leaf_index zero
    expect(Array.from(vault.utxoCommitment as number[])).toEqual(new Array(32).fill(0));
    expect(vault.utxoLeafIndex.toNumber()).toBe(0);
    expect(vault.isTriggered).toBe(false);
    expect(vault.isClaimed).toBe(false);
    expect(vault.isEmergencySwept).toBe(false);
    expect(vault.warning75Sent).toBe(false);
    expect(vault.warning90Sent).toBe(false);
    expect(BigInt(vault.createdSlot.toString())).toBeGreaterThanOrEqual(BigInt(currentSlot.toString()));
    expect(BigInt(vault.lastCheckInSlot.toString())).toBeGreaterThanOrEqual(BigInt(currentSlot.toString()));

    expect(activity.vault.toBase58()).toBe(vaultPda.toBase58());
    expect(activity.checkinCount.toNumber()).toBe(0);
    expect(activity.sumOfIntervals.toNumber()).toBe(0);
    expect(activity.lastInterval.toNumber()).toBe(0);
    expect(activity.anomalyFlagged).toBe(false);
    expect(activity.anomalyFlaggedSlot.toNumber()).toBe(0);
  });

  it("vault_index stored as little-endian correctly — index 1 derives different PDA from index 0", async () => {
    const [pda0] = deriveVaultPda(owner.publicKey, new BN(0));
    const [pda1] = deriveVaultPda(owner.publicKey, new BN(1));
    expect(pda0.toBase58()).not.toBe(pda1.toBase58());
  });

  it("duplicate vault_index rejected — second init at same index fails", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(vaultIndex, DEFAULT_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    await expect(
      program.methods
        .initializeVault(vaultIndex, DEFAULT_THRESHOLD, beneficiaryUtxoPubkey)
        .accounts({
          owner:         owner.publicKey,
          vault:         vaultPda,
          activity:      activityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow();
  });

  it("all-zero beneficiary_utxo_pubkey rejected with InvalidBeneficiary", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    // All-zero bytes = sentinel meaning "no beneficiary set" — must be rejected.
    const zeroPubkey = new Array(32).fill(0);

    await expect(
      program.methods
        .initializeVault(vaultIndex, DEFAULT_THRESHOLD, zeroPubkey)
        .accounts({
          owner:         owner.publicKey,
          vault:         vaultPda,
          activity:      activityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/InvalidBeneficiary|invalid/i);
  });

  it("threshold 0 uses DEFAULT_INACTIVITY_THRESHOLD_SLOTS (5_000_000)", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(vaultIndex, new BN(0), beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(5_000_000);
  });

  it("threshold below MIN rejected with ThresholdTooLow", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await expect(
      program.methods
        .initializeVault(vaultIndex, new BN(431_999), beneficiaryUtxoPubkey)
        .accounts({
          owner:         owner.publicKey,
          vault:         vaultPda,
          activity:      activityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/ThresholdTooLow/);
  });

  it("threshold exactly MIN accepted", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(vaultIndex, MIN_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(432_000);
  });

  it("threshold exactly MAX accepted", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(vaultIndex, MAX_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.inactivityThresholdSlots.toNumber()).toBe(157_680_000);
  });

  it("threshold above MAX rejected with ThresholdTooHigh", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await expect(
      program.methods
        .initializeVault(vaultIndex, new BN(157_680_001), beneficiaryUtxoPubkey)
        .accounts({
          owner:         owner.publicKey,
          vault:         vaultPda,
          activity:      activityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/ThresholdTooHigh/);
  });

  it("account sizes are correct: vault=168 bytes, activity=74 bytes", async () => {
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(vaultIndex, DEFAULT_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vaultInfo    = await context.banksClient.getAccount(vaultPda);
    const activityInfo = await context.banksClient.getAccount(activityPda);

    expect(vaultInfo).not.toBeNull();
    expect(activityInfo).not.toBeNull();
    expect(vaultInfo!.lamports).toBeGreaterThan(0);
    expect(activityInfo!.lamports).toBeGreaterThan(0);
    // v2 VaultAccount is 168 bytes; v1 was 128. If this asserts 128 the IDL
    // was not regenerated after the Cloak integration fields were added.
    expect(vaultInfo!.data.length).toBe(VAULT_ACCOUNT_SIZE);
    expect(activityInfo!.data.length).toBe(ACTIVITY_ACCOUNT_SIZE);
  });

  it("owner can create vault at index 5 — vaultIndex stored correctly", async () => {
    const vaultIndex = new BN(5);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(vaultIndex, DEFAULT_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.vaultIndex.toNumber()).toBe(5);
  });

  it("two owners can create vaults at the same index — different PDAs", async () => {
    const owner2     = Keypair.generate();
    await airdrop(context, owner2.publicKey, 5 * LAMPORTS_PER_SOL);

    const vaultIndex = new BN(0);
    const [vaultPda1]    = deriveVaultPda(owner.publicKey,  vaultIndex);
    const [activityPda1] = deriveActivityPda(vaultPda1);
    const [vaultPda2]    = deriveVaultPda(owner2.publicKey, vaultIndex);
    const [activityPda2] = deriveActivityPda(vaultPda2);

    await program.methods
      .initializeVault(vaultIndex, DEFAULT_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({ owner: owner.publicKey,  vault: vaultPda1, activity: activityPda1, systemProgram: SystemProgram.programId })
      .signers([owner])
      .rpc();

    await program.methods
      .initializeVault(vaultIndex, DEFAULT_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({ owner: owner2.publicKey, vault: vaultPda2, activity: activityPda2, systemProgram: SystemProgram.programId })
      .signers([owner2])
      .rpc();

    expect(vaultPda1.toBase58()).not.toBe(vaultPda2.toBase58());
    const vault1 = await program.account.vaultAccount.fetch(vaultPda1);
    const vault2 = await program.account.vaultAccount.fetch(vaultPda2);
    expect(vault1.owner.toBase58()).toBe(owner.publicKey.toBase58());
    expect(vault2.owner.toBase58()).toBe(owner2.publicKey.toBase58());
  });

  it("non-zero utxo_commitment and utxo_leaf_index after record_cloak_deposit", async () => {
    // Verify the new v2 fields are writable by record_cloak_deposit and that
    // is_shielded() semantics hold (all-zero commitment = not shielded).
    const vaultIndex = new BN(0);
    const [vaultPda]    = deriveVaultPda(owner.publicKey, vaultIndex);
    const [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(vaultIndex, DEFAULT_THRESHOLD, beneficiaryUtxoPubkey)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const beforeDeposit = await program.account.vaultAccount.fetch(vaultPda);
    // Before record_cloak_deposit: utxo_commitment should be all zeros.
    expect(Array.from(beforeDeposit.utxoCommitment as number[])).toEqual(new Array(32).fill(0));
    expect(beforeDeposit.utxoLeafIndex.toNumber()).toBe(0);

    // Call record_cloak_deposit to write a non-zero commitment.
    const fakeCommitment = Array.from({ length: 32 }, (_, i) => i + 1);
    const fakeLeafIndex  = new BN(42);
    const shieldedAmount = new BN(1_000_000_000);

    await program.methods
      .recordCloakDeposit(fakeCommitment, fakeLeafIndex, shieldedAmount)
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
      })
      .signers([owner])
      .rpc();

    const afterDeposit = await program.account.vaultAccount.fetch(vaultPda);
    expect(Array.from(afterDeposit.utxoCommitment as number[])).toEqual(fakeCommitment);
    expect(afterDeposit.utxoLeafIndex.toNumber()).toBe(42);
    expect(afterDeposit.depositedLamports.toNumber()).toBe(1_000_000_000);
  });
});
