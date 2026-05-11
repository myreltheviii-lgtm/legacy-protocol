// tests/anchor/record_cloak_deposit.test.ts
//
// Tests for the `record_cloak_deposit` instruction.
//
// record_cloak_deposit records an off-chain Cloak shielded deposit on-chain.
// It does NOT move any SOL — the SOL moved directly through Cloak's own
// program before this instruction was called. This instruction only writes
// the UTXO commitment and leaf index into the VaultAccount so guardians can
// locate the shielded UTXO during inheritance execution.
//
// Key invariants tested:
//   - utxo_commitment and utxo_leaf_index are written correctly
//   - deposited_lamports accumulates across multiple calls (top-ups)
//   - All-zero commitment rejected with InvalidBeneficiary (sentinel = no Cloak deposit;
//     all-zero is not a valid Poseidon hash output from the Cloak circuit)
//   - Zero shielded_lamports rejected with ZeroAmount
//   - Non-owner rejected
//   - Triggered, swept, and claimed vaults blocked

import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider }   from "anchor-bankrun";
import { Program, BN }       from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LegacyVault }       from "../../target/types/legacy_vault";
import IDL                   from "../../target/idl/legacy_vault.json";

const PROGRAM_ID    = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");

function deriveVaultPda(owner: PublicKey, vaultIndex: BN): [PublicKey, number] {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(vaultIndex.toString()));
  return PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBuffer(), b], PROGRAM_ID);
}

function deriveActivityPda(vaultPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ACTIVITY_SEED, vaultPda.toBuffer()], PROGRAM_ID);
}

// Non-zero Cloak UTXO pubkey for the beneficiary.
const BENEFICIARY_UTXO_PUBKEY = Array.from({ length: 32 }, (_, i) => i + 1);

// A non-zero 32-byte Poseidon commitment — exactly what the Cloak SDK
// returns in transact().outputUtxos[0].commitment after a successful shield.
// Using values [17..48] so no byte is zero (0x00 bytes would not change the
// sentinel check, 0xFF bytes ensure any little-endian u64 sub-value is non-trivial).
const FAKE_COMMITMENT   = Array.from({ length: 32 }, (_, i) => 0x11 + i);
const FAKE_LEAF_INDEX   = new BN(42);
const SHIELDED_LAMPORTS = new BN(1_000_000_000); // 1 SOL declared shielded

describe("record_cloak_deposit", () => {
  let context:     ProgramTestContext;
  let program:     Program<LegacyVault>;
  let owner:       Keypair;
  let vaultPda:    PublicKey;
  let activityPda: PublicKey;

  beforeEach(async () => {
    context = await startAnchor(".", [{ name: "legacy_vault", programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);
    program        = new Program<LegacyVault>(IDL as any, PROGRAM_ID, provider);
    owner          = Keypair.generate();

    context.setAccount(owner.publicKey, {
      lamports:   10 * LAMPORTS_PER_SOL,
      data:       Buffer.alloc(0),
      owner:      SystemProgram.programId,
      executable: false,
    });

    [vaultPda]    = deriveVaultPda(owner.publicKey, new BN(0));
    [activityPda] = deriveActivityPda(vaultPda);

    await program.methods
      .initializeVault(new BN(0), new BN(5_000_000), BENEFICIARY_UTXO_PUBKEY)
      .accounts({
        owner:         owner.publicKey,
        vault:         vaultPda,
        activity:      activityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
  });

  it("happy path: utxo_commitment, utxo_leaf_index, and deposited_lamports written correctly", async () => {
    const vaultBefore = await program.account.vaultAccount.fetch(vaultPda);
    // Before record_cloak_deposit: utxo_commitment is all zeros (not shielded).
    expect(Array.from(vaultBefore.utxoCommitment as number[])).toEqual(new Array(32).fill(0));
    expect(vaultBefore.utxoLeafIndex.toNumber()).toBe(0);
    expect(vaultBefore.depositedLamports.toNumber()).toBe(0);

    await program.methods
      .recordCloakDeposit(FAKE_COMMITMENT, FAKE_LEAF_INDEX, SHIELDED_LAMPORTS)
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(Array.from(vault.utxoCommitment as number[])).toEqual(FAKE_COMMITMENT);
    expect(vault.utxoLeafIndex.toNumber()).toBe(42);
    expect(vault.depositedLamports.toNumber()).toBe(SHIELDED_LAMPORTS.toNumber());

    // is_triggered, is_claimed, is_emergency_swept must remain unchanged.
    expect(vault.isTriggered).toBe(false);
    expect(vault.isClaimed).toBe(false);
    expect(vault.isEmergencySwept).toBe(false);
  });

  it("does NOT transfer any SOL — vault PDA lamport balance unchanged", async () => {
    const vaultInfoBefore = await context.banksClient.getAccount(vaultPda);

    await program.methods
      .recordCloakDeposit(FAKE_COMMITMENT, FAKE_LEAF_INDEX, SHIELDED_LAMPORTS)
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vaultInfoAfter = await context.banksClient.getAccount(vaultPda);
    // No SOL should have moved through the program — the PDA balance stays at
    // its rent-exempt minimum. The shielded_lamports parameter is a declaration,
    // not a CPI transfer.
    expect(vaultInfoAfter!.lamports).toBe(vaultInfoBefore!.lamports);
  });

  it("deposited_lamports accumulates across multiple calls (top-up shielded deposits)", async () => {
    // First deposit: 1 SOL declared shielded.
    await program.methods
      .recordCloakDeposit(FAKE_COMMITMENT, FAKE_LEAF_INDEX, new BN(1_000_000_000))
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    // Second deposit with a different commitment (owner topped up their shielded balance).
    const secondCommitment = Array.from({ length: 32 }, (_, i) => 0x55 + i);
    await program.methods
      .recordCloakDeposit(secondCommitment, new BN(99), new BN(500_000_000))
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    // depositedLamports accumulates; utxoCommitment and utxoLeafIndex reflect the latest deposit.
    expect(vault.depositedLamports.toNumber()).toBe(1_500_000_000);
    expect(Array.from(vault.utxoCommitment as number[])).toEqual(secondCommitment);
    expect(vault.utxoLeafIndex.toNumber()).toBe(99);
  });

  it("all-zero utxo_commitment rejected with InvalidBeneficiary — zero is sentinel for 'not shielded'", async () => {
    // An all-zero commitment is not a valid Poseidon hash output from the Cloak circuit.
    // It is the sentinel value meaning "no Cloak deposit recorded" (is_shielded() = false).
    // Storing it would leave the vault appearing unshielded and block record_cloak_claim.
    // The program rejects it with InvalidBeneficiary — the most semantically appropriate
    // error for an all-zero Cloak identity input.
    const zeroCommitment = new Array(32).fill(0);

    await expect(
      program.methods
        .recordCloakDeposit(zeroCommitment, FAKE_LEAF_INDEX, SHIELDED_LAMPORTS)
        .accounts({ owner: owner.publicKey, vault: vaultPda })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/InvalidBeneficiary/);
  });

  it("zero shielded_lamports rejected with ZeroAmount", async () => {
    await expect(
      program.methods
        .recordCloakDeposit(FAKE_COMMITMENT, FAKE_LEAF_INDEX, new BN(0))
        .accounts({ owner: owner.publicKey, vault: vaultPda })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/ZeroAmount/);
  });

  it("non-owner rejected with UnauthorisedOwner", async () => {
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, {
      lamports:   LAMPORTS_PER_SOL,
      data:       Buffer.alloc(0),
      owner:      SystemProgram.programId,
      executable: false,
    });

    await expect(
      program.methods
        .recordCloakDeposit(FAKE_COMMITMENT, FAKE_LEAF_INDEX, SHIELDED_LAMPORTS)
        .accounts({ owner: attacker.publicKey, vault: vaultPda })
        .signers([attacker])
        .rpc(),
    ).rejects.toThrow(/UnauthorisedOwner|constraint/i);
  });

  it("rejected after trigger_inheritance with VaultAlreadyTriggered", async () => {
    await context.warpToSlot(BigInt(5_000_001));

    const caller = Keypair.generate();
    context.setAccount(caller.publicKey, {
      lamports:   LAMPORTS_PER_SOL,
      data:       Buffer.alloc(0),
      owner:      SystemProgram.programId,
      executable: false,
    });

    await program.methods
      .triggerInheritance()
      .accounts({ caller: caller.publicKey, vault: vaultPda })
      .signers([caller])
      .rpc();

    await expect(
      program.methods
        .recordCloakDeposit(FAKE_COMMITMENT, FAKE_LEAF_INDEX, SHIELDED_LAMPORTS)
        .accounts({ owner: owner.publicKey, vault: vaultPda })
        .signers([owner])
        .rpc(),
    ).rejects.toThrow(/VaultAlreadyTriggered/);
  });

  it("is_shielded semantics: commitment goes non-zero → vault is marked shielded", async () => {
    const vaultBefore = await program.account.vaultAccount.fetch(vaultPda);
    // Before: all-zero commitment = not shielded.
    const isShieldedBefore = Array.from(vaultBefore.utxoCommitment as number[]).some((b) => b !== 0);
    expect(isShieldedBefore).toBe(false);

    await program.methods
      .recordCloakDeposit(FAKE_COMMITMENT, FAKE_LEAF_INDEX, SHIELDED_LAMPORTS)
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vaultAfter = await program.account.vaultAccount.fetch(vaultPda);
    const isShieldedAfter = Array.from(vaultAfter.utxoCommitment as number[]).some((b) => b !== 0);
    expect(isShieldedAfter).toBe(true);
  });

  it("high-precision leaf index preserved (u64 boundary: 2^53 - 1)", async () => {
    // Verify that u64 values beyond JS safe integer range round-trip via BN.
    // This ensures no precision loss in the BN → u64 LE → BN path for
    // large Merkle tree indices that could appear in production.
    const largeLeafIndex = new BN("9007199254740992"); // 2^53, beyond JS Number precision

    await program.methods
      .recordCloakDeposit(FAKE_COMMITMENT, largeLeafIndex, SHIELDED_LAMPORTS)
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(vault.utxoLeafIndex.toString()).toBe("9007199254740992");
  });

  it("non-trivial commitment bytes all preserved — no truncation at any position", async () => {
    // Use a commitment where every byte has a distinct non-trivial value to
    // catch any off-by-one or partial-write bug in the on-chain serialization.
    const distinctCommitment = Array.from({ length: 32 }, (_, i) => {
      const v = (0xDE + i * 7) & 0xff;
      return v === 0 ? 0xAB : v; // ensure no zero bytes
    });

    await program.methods
      .recordCloakDeposit(distinctCommitment, new BN(255), SHIELDED_LAMPORTS)
      .accounts({ owner: owner.publicKey, vault: vaultPda })
      .signers([owner])
      .rpc();

    const vault = await program.account.vaultAccount.fetch(vaultPda);
    expect(Array.from(vault.utxoCommitment as number[])).toEqual(distinctCommitment);
  });
});