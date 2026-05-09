// tests/cloak/integration.test.ts
//
// Integration tests for the Cloak SDK instruction builders and account
// deserialization at the updated 168-byte layout.

import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import {
  buildRecordCloakDepositIx,
  buildRecordCloakClaimIx,
  deserialiseVault,
  VAULT_SIZE,
  utxoPubkeyToHex,
} from "../../sdk/src";

// ── Helpers ───────────────────────────────────────────────────────────────────

function disc(name: string): Buffer {
  return Buffer.from(createHash("sha256").update(`global:${name}`).digest()).slice(0, 8);
}

const DISC_RECORD_CLOAK_DEPOSIT = disc("record_cloak_deposit");
const DISC_RECORD_CLOAK_CLAIM   = disc("record_cloak_claim");

const DUMMY_PROGRAM  = new PublicKey("4xQxjp8gZJm4ztGfegBXCxkYZKCRLbeMz2Pr3wvtkgSd");
const DUMMY_OWNER    = new PublicKey("BhL5BAbK4u1YWs7H1SjrSWSWvtxLYr8Sq2NxztKRf18R");
const DUMMY_VAULT    = new PublicKey("AbCdEfGhIjKlMnOpQrStUvWxYz12345678901234567");
const DUMMY_ACTIVITY = new PublicKey("ZyXwVuTsRqPoNmLkJiHgFeDcBa12345678901234567");

// ── VAULT_SIZE ────────────────────────────────────────────────────────────────

describe("VaultAccount byte layout", () => {
  it("VAULT_SIZE is 168", () => {
    expect(VAULT_SIZE).toBe(168);
  });
});

// ── buildRecordCloakDepositIx ─────────────────────────────────────────────────

describe("buildRecordCloakDepositIx", () => {
  const utxoCommitment   = crypto.getRandomValues(new Uint8Array(32));
  const utxoLeafIndex    = 42n;
  const shieldedLamports = 1_000_000_000n;

  const ix = buildRecordCloakDepositIx({
    programId:        DUMMY_PROGRAM,
    owner:            DUMMY_OWNER,
    vaultPda:         DUMMY_VAULT,
    utxoCommitment,
    utxoLeafIndex,
    shieldedLamports,
  });

  it("has correct program ID", () => {
    expect(ix.programId.toBase58()).toBe(DUMMY_PROGRAM.toBase58());
  });

  it("has correct discriminator", () => {
    const ixDisc = ix.data.slice(0, 8);
    expect(Buffer.from(ixDisc).toString("hex")).toBe(
      DISC_RECORD_CLOAK_DEPOSIT.toString("hex"),
    );
  });

  it("data length is 8 + 32 + 8 + 8 = 56 bytes", () => {
    expect(ix.data.length).toBe(56);
  });

  it("encodes utxo_commitment at offset 8 (32 bytes)", () => {
    const encoded = ix.data.slice(8, 40);
    expect(Buffer.from(encoded).toString("hex")).toBe(
      Buffer.from(utxoCommitment).toString("hex"),
    );
  });

  it("encodes utxo_leaf_index at offset 40 as u64 LE", () => {
    const encoded = Buffer.from(ix.data.slice(40, 48)).readBigUInt64LE(0);
    expect(encoded).toBe(utxoLeafIndex);
  });

  it("encodes shielded_lamports at offset 48 as u64 LE", () => {
    const encoded = Buffer.from(ix.data.slice(48, 56)).readBigUInt64LE(0);
    expect(encoded).toBe(shieldedLamports);
  });

  it("accounts: owner is signer+writable, vault is writable", () => {
    const [ownerKey, vaultKey] = ix.keys;
    expect(ownerKey.isSigner).toBe(true);
    expect(ownerKey.isWritable).toBe(true);
    expect(vaultKey.isSigner).toBe(false);
    expect(vaultKey.isWritable).toBe(true);
  });

  it("throws on commitment of wrong length", () => {
    expect(() =>
      buildRecordCloakDepositIx({
        programId:        DUMMY_PROGRAM,
        owner:            DUMMY_OWNER,
        vaultPda:         DUMMY_VAULT,
        utxoCommitment:   new Uint8Array(16),
        utxoLeafIndex,
        shieldedLamports,
      }),
    ).toThrow();
  });
});

// ── buildRecordCloakClaimIx ───────────────────────────────────────────────────

describe("buildRecordCloakClaimIx", () => {
  const cloakTransferSignature = crypto.getRandomValues(new Uint8Array(64));

  const ix = buildRecordCloakClaimIx({
    programId:               DUMMY_PROGRAM,
    caller:                  DUMMY_OWNER,
    vaultPda:                DUMMY_VAULT,
    activityPda:             DUMMY_ACTIVITY,
    cloakTransferSignature,
  });

  it("has correct discriminator", () => {
    const ixDisc = ix.data.slice(0, 8);
    expect(Buffer.from(ixDisc).toString("hex")).toBe(
      DISC_RECORD_CLOAK_CLAIM.toString("hex"),
    );
  });

  it("data length is 8 + 64 = 72 bytes", () => {
    expect(ix.data.length).toBe(72);
  });

  it("encodes cloak_transfer_signature at offset 8 (64 bytes)", () => {
    const encoded = ix.data.slice(8, 72);
    expect(Buffer.from(encoded).toString("hex")).toBe(
      Buffer.from(cloakTransferSignature).toString("hex"),
    );
  });

  it("caller is signer+writable", () => {
    const callerKey = ix.keys[0];
    expect(callerKey.isSigner).toBe(true);
    expect(callerKey.isWritable).toBe(true);
  });

  it("throws on signature of wrong length", () => {
    expect(() =>
      buildRecordCloakClaimIx({
        programId:               DUMMY_PROGRAM,
        caller:                  DUMMY_OWNER,
        vaultPda:                DUMMY_VAULT,
        activityPda:             DUMMY_ACTIVITY,
        cloakTransferSignature:  new Uint8Array(32),
      }),
    ).toThrow();
  });
});

// ── VaultAccount deserialisation at 168 bytes ─────────────────────────────────

describe("deserialiseVault at 168 bytes", () => {
  function buildFakeVault(opts: {
    utxoCommitment?: Uint8Array;
    utxoLeafIndex?:  bigint;
    beneficiaryUtxoPubkey?: Uint8Array;
  } = {}): Buffer {
    const buf = Buffer.alloc(VAULT_SIZE, 0);

    const accountDisc = Buffer.from(
      createHash("sha256").update("account:VaultAccount").digest(),
    ).slice(0, 8);
    accountDisc.copy(buf, 0);

    DUMMY_OWNER.toBuffer().copy(buf, 8);

    if (opts.beneficiaryUtxoPubkey) {
      Buffer.from(opts.beneficiaryUtxoPubkey).copy(buf, 40);
    } else {
      DUMMY_OWNER.toBuffer().copy(buf, 40);
    }

    buf[72] = 3;
    buf[73] = 2;

    buf.writeBigUInt64LE(5_000_000n, 74);
    buf.writeBigUInt64LE(999_999n, 82);
    buf.writeBigUInt64LE(1000n, 90);
    buf.writeBigUInt64LE(500_000_000n, 98);
    buf.writeBigUInt64LE(7n, 106);
    buf.writeBigUInt64LE(0n, 114);

    if (opts.utxoCommitment) {
      Buffer.from(opts.utxoCommitment).copy(buf, 122);
    }

    buf.writeBigUInt64LE(opts.utxoLeafIndex ?? 0n, 154);

    buf[162] = 0;
    buf[163] = 0;
    buf[164] = 0;
    buf[165] = 0;
    buf[166] = 0;
    buf[167] = 255;

    return buf;
  }

  it("parses a 168-byte vault correctly", () => {
    const buf    = buildFakeVault();
    const parsed = deserialiseVault(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.owner).toBe(DUMMY_OWNER.toBase58());
    expect(parsed!.guardianCount).toBe(3);
    expect(parsed!.mOfNThreshold).toBe(2);
    expect(parsed!.depositedLamports).toBe(500_000_000n);
    expect(parsed!.bump).toBe(255);
  });

  it("returns null for buffer shorter than 168 bytes", () => {
    const short = Buffer.alloc(127);
    expect(deserialiseVault(short)).toBeNull();
  });

  it("parses utxoCommitment and utxoLeafIndex", () => {
    const commitment   = crypto.getRandomValues(new Uint8Array(32));
    const leafIndex    = 12345n;
    const buf    = buildFakeVault({ utxoCommitment: commitment, utxoLeafIndex: leafIndex });
    const parsed = deserialiseVault(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.utxoCommitment).toBe(Buffer.from(commitment).toString("hex"));
    expect(parsed!.utxoLeafIndex).toBe(leafIndex);
  });

  it("detects shielded vs unshielded via utxoCommitment", () => {
    const unshielded = buildFakeVault({ utxoCommitment: new Uint8Array(32) });
    const shielded   = buildFakeVault({ utxoCommitment: crypto.getRandomValues(new Uint8Array(32)) });

    const pU = deserialiseVault(unshielded);
    const pS = deserialiseVault(shielded);

    expect(pU!.utxoCommitment).toBe("0".repeat(64));
    expect(pS!.utxoCommitment).not.toBe("0".repeat(64));
  });

  it("beneficiaryUtxoPubkey round-trips via utxoPubkeyToHex", () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const buf      = buildFakeVault({ beneficiaryUtxoPubkey: original });
    const parsed   = deserialiseVault(buf);
    expect(parsed!.beneficiaryUtxoPubkey).toBe(
      Buffer.from(original).toString("hex"),
    );
  });

  it("SDK cloak exports are present", () => {
    expect(typeof utxoPubkeyToHex).toBe("function");
  });
});
