import { PublicKey } from "@solana/web3.js";
import {
  deriveVaultPda,
  deriveActivityPda,
  deriveGuardianPda,
  deriveCovenantPda,
} from "../../sdk/src/pda";

const PROGRAM_ID = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");

const VAULT_SEED    = Buffer.from("vault");
const ACTIVITY_SEED = Buffer.from("activity");
const GUARDIAN_SEED = Buffer.from("guardian");
const COVENANT_SEED = Buffer.from("covenant");

function u64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

describe("deriveVaultPda", () => {
  it("produces the same address as findProgramAddressSync with correct seeds", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const vaultIndex = 0n;
    const [derived] = deriveVaultPda(PROGRAM_ID, owner, vaultIndex);
    const [expected] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, owner.toBuffer(), u64LE(vaultIndex)],
      PROGRAM_ID,
    );
    expect(derived.toBase58()).toBe(expected.toBase58());
  });

  it("different vault_index produces different PDA", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [pda0] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [pda1] = deriveVaultPda(PROGRAM_ID, owner, 1n);
    expect(pda0.toBase58()).not.toBe(pda1.toBase58());
  });

  it("different owners produce different PDAs at same index", () => {
    const owner1 = new PublicKey("So11111111111111111111111111111111111111112");
    const owner2 = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const [pda1] = deriveVaultPda(PROGRAM_ID, owner1, 0n);
    const [pda2] = deriveVaultPda(PROGRAM_ID, owner2, 0n);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  it("vault_index little-endian encoding is correct — index 256 differs from index 1", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [pda256] = deriveVaultPda(PROGRAM_ID, owner, 256n);
    const [pda1]   = deriveVaultPda(PROGRAM_ID, owner, 1n);
    expect(pda256.toBase58()).not.toBe(pda1.toBase58());
  });

  it("returns a valid PublicKey (not default/zero)", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [pda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    expect(pda.toBase58()).not.toBe(PublicKey.default.toBase58());
  });

  it("returns the canonical bump seed as the second element", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [, bump] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    expect(typeof bump).toBe("number");
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("large vault_index u64::MAX-like values are handled without overflow", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const maxU64 = 18446744073709551615n;
    const [pda] = deriveVaultPda(PROGRAM_ID, owner, maxU64);
    expect(pda.toBase58()).not.toBe(PublicKey.default.toBase58());
  });

  it("index 5 produces correct address — consistent across calls", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [pda1] = deriveVaultPda(PROGRAM_ID, owner, 5n);
    const [pda2] = deriveVaultPda(PROGRAM_ID, owner, 5n);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });
});

describe("deriveActivityPda", () => {
  it("produces the same address as findProgramAddressSync with correct seeds", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [derived]  = deriveActivityPda(PROGRAM_ID, vaultPda);
    const [expected] = PublicKey.findProgramAddressSync(
      [ACTIVITY_SEED, vaultPda.toBuffer()],
      PROGRAM_ID,
    );
    expect(derived.toBase58()).toBe(expected.toBase58());
  });

  it("different vault PDAs produce different activity PDAs", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda0] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [vaultPda1] = deriveVaultPda(PROGRAM_ID, owner, 1n);
    const [actPda0]   = deriveActivityPda(PROGRAM_ID, vaultPda0);
    const [actPda1]   = deriveActivityPda(PROGRAM_ID, vaultPda1);
    expect(actPda0.toBase58()).not.toBe(actPda1.toBase58());
  });

  it("is deterministic — same vault produces same activity PDA across calls", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [act1]     = deriveActivityPda(PROGRAM_ID, vaultPda);
    const [act2]     = deriveActivityPda(PROGRAM_ID, vaultPda);
    expect(act1.toBase58()).toBe(act2.toBase58());
  });

  it("returns a valid non-default PublicKey", () => {
    const owner = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [actPda]   = deriveActivityPda(PROGRAM_ID, vaultPda);
    expect(actPda.toBase58()).not.toBe(PublicKey.default.toBase58());
  });
});

describe("deriveGuardianPda", () => {
  it("produces the same address as findProgramAddressSync with correct seeds", () => {
    const owner    = new PublicKey("So11111111111111111111111111111111111111112");
    const guardian = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const [vaultPda]   = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [derived]    = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian);
    const [expected]   = PublicKey.findProgramAddressSync(
      [GUARDIAN_SEED, vaultPda.toBuffer(), guardian.toBuffer()],
      PROGRAM_ID,
    );
    expect(derived.toBase58()).toBe(expected.toBase58());
  });

  it("different guardians produce different PDAs for the same vault", () => {
    const owner    = new PublicKey("So11111111111111111111111111111111111111112");
    const guardian1 = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const guardian2 = new PublicKey("11111111111111111111111111111111");
    const [vaultPda]  = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [gPda1]     = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian1);
    const [gPda2]     = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian2);
    expect(gPda1.toBase58()).not.toBe(gPda2.toBase58());
  });

  it("same guardian on different vaults produces different PDAs", () => {
    const owner    = new PublicKey("So11111111111111111111111111111111111111112");
    const guardian = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const [vaultPda0]  = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [vaultPda1]  = deriveVaultPda(PROGRAM_ID, owner, 1n);
    const [gPda0]      = deriveGuardianPda(PROGRAM_ID, vaultPda0, guardian);
    const [gPda1]      = deriveGuardianPda(PROGRAM_ID, vaultPda1, guardian);
    expect(gPda0.toBase58()).not.toBe(gPda1.toBase58());
  });

  it("is deterministic — same vault+guardian produces same PDA", () => {
    const owner    = new PublicKey("So11111111111111111111111111111111111111112");
    const guardian = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [gPda1]    = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian);
    const [gPda2]    = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian);
    expect(gPda1.toBase58()).toBe(gPda2.toBase58());
  });

  it("returns a valid non-default PublicKey", () => {
    const owner    = new PublicKey("So11111111111111111111111111111111111111112");
    const guardian = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [gPda]     = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian);
    expect(gPda.toBase58()).not.toBe(PublicKey.default.toBase58());
  });
});

describe("deriveCovenantPda", () => {
  it("produces the same address as findProgramAddressSync with correct seeds", () => {
    const owner       = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda]  = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [derived]   = deriveCovenantPda(PROGRAM_ID, vaultPda, 0n);
    const [expected]  = PublicKey.findProgramAddressSync(
      [COVENANT_SEED, vaultPda.toBuffer(), u64LE(0n)],
      PROGRAM_ID,
    );
    expect(derived.toBase58()).toBe(expected.toBase58());
  });

  it("different covenant indices produce different PDAs", () => {
    const owner      = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [cov0]     = deriveCovenantPda(PROGRAM_ID, vaultPda, 0n);
    const [cov1]     = deriveCovenantPda(PROGRAM_ID, vaultPda, 1n);
    expect(cov0.toBase58()).not.toBe(cov1.toBase58());
  });

  it("same vault+index produces same PDA across calls", () => {
    const owner      = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [cov1]     = deriveCovenantPda(PROGRAM_ID, vaultPda, 3n);
    const [cov2]     = deriveCovenantPda(PROGRAM_ID, vaultPda, 3n);
    expect(cov1.toBase58()).toBe(cov2.toBase58());
  });

  it("covenant index little-endian encoding correct — index 0 differs from index 256", () => {
    const owner      = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [cov0]     = deriveCovenantPda(PROGRAM_ID, vaultPda, 0n);
    const [cov256]   = deriveCovenantPda(PROGRAM_ID, vaultPda, 256n);
    expect(cov0.toBase58()).not.toBe(cov256.toBase58());
  });

  it("returns a valid non-default PublicKey", () => {
    const owner      = new PublicKey("So11111111111111111111111111111111111111112");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [cov]      = deriveCovenantPda(PROGRAM_ID, vaultPda, 0n);
    expect(cov.toBase58()).not.toBe(PublicKey.default.toBase58());
  });

  it("all 4 PDAs are distinct from each other for the same vault", () => {
    const owner      = new PublicKey("So11111111111111111111111111111111111111112");
    const guardian   = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const [vaultPda] = deriveVaultPda(PROGRAM_ID, owner, 0n);
    const [actPda]   = deriveActivityPda(PROGRAM_ID, vaultPda);
    const [gPda]     = deriveGuardianPda(PROGRAM_ID, vaultPda, guardian);
    const [covPda]   = deriveCovenantPda(PROGRAM_ID, vaultPda, 0n);

    const addresses = new Set([
      vaultPda.toBase58(),
      actPda.toBase58(),
      gPda.toBase58(),
      covPda.toBase58(),
    ]);
    expect(addresses.size).toBe(4);
  });
});
