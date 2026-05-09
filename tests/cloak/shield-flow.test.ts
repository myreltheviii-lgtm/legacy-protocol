// tests/cloak/shield-flow.test.ts
//
// Unit tests for the Cloak integration layer helper functions.
// These run without any network calls — they test pure cryptographic
// and encoding logic only.

import { describe, it, expect } from "vitest";
import {
  generateBeneficiaryIdentity,
} from "../../cloak-integration/src/beneficiary-setup";
import { splitOwnerKey } from "../../cloak-integration/src/shield";
import {
  reconstructSecret,
  decodeShareBase64,
  encodeShareBase64,
  splitSecret,
} from "../../sdk/src/shamir";
import {
  computeCloakFee,
  utxoPubkeyToHex,
  hexToUtxoPubkey,
} from "../../sdk/src/cloak";

// ── generateBeneficiaryIdentity ───────────────────────────────────────────────

describe("generateBeneficiaryIdentity", () => {
  it("returns correct structure with 32-byte keys and viewingKeyNk of correct length", async () => {
    const id = await generateBeneficiaryIdentity();
    expect(id.privateKey).toBeInstanceOf(Uint8Array);
    expect(id.publicKey).toBeInstanceOf(Uint8Array);
    expect(id.viewingKeyNk).toBeInstanceOf(Uint8Array);
    expect(id.privateKey.length).toBe(32);
    expect(id.publicKey.length).toBe(32);
    // Authoritative Layer H: viewingKeyNk must be 32 bytes.
    // The nullifier key in Cloak's Poseidon-based identity scheme is 32 bytes,
    // matching the 32-byte field size used throughout the protocol.
    expect(id.viewingKeyNk.length).toBe(32);
  });

  it("generates unique keypairs on each call", async () => {
    const a = await generateBeneficiaryIdentity();
    const b = await generateBeneficiaryIdentity();
    const aHex = Buffer.from(a.privateKey).toString("hex");
    const bHex = Buffer.from(b.privateKey).toString("hex");
    expect(aHex).not.toBe(bHex);
  });

  it("generates unique viewingKeyNk on each call", async () => {
    const a = await generateBeneficiaryIdentity();
    const b = await generateBeneficiaryIdentity();
    const aHex = Buffer.from(a.viewingKeyNk).toString("hex");
    const bHex = Buffer.from(b.viewingKeyNk).toString("hex");
    expect(aHex).not.toBe(bHex);
  });

  it("all three fields are non-zero (no degenerate identity)", async () => {
    const id = await generateBeneficiaryIdentity();
    const privKeyIsAllZero = Array.from(id.privateKey).every(b => b === 0);
    const pubKeyIsAllZero  = Array.from(id.publicKey).every(b => b === 0);
    const nkIsAllZero      = Array.from(id.viewingKeyNk).every(b => b === 0);
    expect(privKeyIsAllZero).toBe(false);
    expect(pubKeyIsAllZero).toBe(false);
    expect(nkIsAllZero).toBe(false);
  });
});

// ── splitOwnerKey / Shamir roundtrip ──────────────────────────────────────────

describe("splitOwnerKey and reconstructSecret", () => {
  const SECRET = new Uint8Array(32).fill(0xab);

  it("produces N shares with correct structure", () => {
    const shares = splitOwnerKey(SECRET, 2, 3, ["g1", "g2", "g3"]);
    expect(shares).toHaveLength(3);
    shares.forEach((s, i) => {
      expect(s.shareIndex).toBe(i + 1);
      expect(typeof s.shareBase64).toBe("string");
      expect(s.shareBase64.length).toBeGreaterThan(0);
      expect(s.guardianWallet).toBe(["g1", "g2", "g3"][i]);
    });
  });

  it("M shares reconstruct original secret exactly", () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const shares   = splitOwnerKey(original, 3, 5);

    // Reconstruct with exactly M=3 shares
    const subset  = [shares[0], shares[2], shares[4]];
    const decoded = subset.map((s) => decodeShareBase64(s.shareBase64));
    const recovered = reconstructSecret(decoded);

    expect(Buffer.from(recovered).toString("hex")).toBe(
      Buffer.from(original).toString("hex"),
    );
  });

  it("any subset of M reconstructs correctly", () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const shares   = splitOwnerKey(original, 2, 4);
    const expected = Buffer.from(original).toString("hex");

    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const decoded = [shares[i], shares[j]].map((s) =>
          decodeShareBase64(s.shareBase64),
        );
        const recovered = reconstructSecret(decoded);
        expect(Buffer.from(recovered).toString("hex")).toBe(expected);
      }
    }
  });

  it("throws on key of wrong length", () => {
    const bad = new Uint8Array(16);
    expect(() => splitOwnerKey(bad, 2, 3)).toThrow();
  });

  it("splitOwnerKey zeroes the input key after splitting — sensitive material cleared", async () => {
    // Authoritative Layer H: splitOwnerKey must zero the original key buffer
    // after splitting to prevent sensitive key material from remaining in memory.
    // This is a security requirement: the caller's buffer is wiped to all zeros
    // once the shares have been generated.
    const key = crypto.getRandomValues(new Uint8Array(32));
    // Verify the key is non-zero before the split
    expect(Array.from(key).some(b => b !== 0)).toBe(true);

    splitOwnerKey(key, 2, 3);

    // After the split, the input key buffer must be all zeros
    const isZeroed = Array.from(key).every(b => b === 0);
    expect(isZeroed).toBe(true);
  });
});

// ── computeCloakFee ───────────────────────────────────────────────────────────

describe("computeCloakFee", () => {
  it("matches documented formula: 5_000_000 + floor(amount * 3 / 1000)", () => {
    const testCases: Array<[bigint, bigint]> = [
      [10_000_000n, 5_000_000n + 30_000n],
      [100_000_000n, 5_000_000n + 300_000n],
      [1_000_000_000n, 5_000_000n + 3_000_000n],
      [5_000_000_000n, 5_000_000n + 15_000_000n],
    ];

    for (const [gross, expectedTotal] of testCases) {
      const { total } = computeCloakFee(gross);
      expect(total).toBe(expectedTotal);
    }
  });

  it("net = gross - total", () => {
    const gross = 1_000_000_000n;
    const { total, net } = computeCloakFee(gross);
    expect(net).toBe(gross - total);
  });

  it("fixed component is always 5_000_000n", () => {
    const { fixed } = computeCloakFee(1_000_000_000n);
    expect(fixed).toBe(5_000_000n);
  });
});

// ── utxoPubkeyToHex / hexToUtxoPubkey ────────────────────────────────────────

describe("utxoPubkeyToHex and hexToUtxoPubkey round-trip", () => {
  it("round-trips 32 random bytes", () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const hex      = utxoPubkeyToHex(original);
    expect(hex.length).toBe(64);
    const recovered = hexToUtxoPubkey(hex);
    expect(Buffer.from(recovered).toString("hex")).toBe(
      Buffer.from(original).toString("hex"),
    );
  });

  it("throws on wrong input length", () => {
    expect(() => utxoPubkeyToHex(new Uint8Array(16))).toThrow();
    expect(() => hexToUtxoPubkey("aabbcc")).toThrow();
  });

  it("produces lowercase hex", () => {
    const bytes = new Uint8Array(32).fill(0xff);
    const hex   = utxoPubkeyToHex(bytes);
    expect(hex).toBe("f".repeat(64));
  });
});

// ── encodeShareBase64 / decodeShareBase64 round-trip ─────────────────────────

describe("encodeShareBase64 / decodeShareBase64", () => {
  it("round-trips a ShamirShare", () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const shares   = splitSecret(original, 2, 3);
    for (const share of shares) {
      const encoded = encodeShareBase64(share);
      const decoded = decodeShareBase64(encoded);
      expect(decoded.index).toBe(share.index);
      expect(Buffer.from(decoded.data).toString("hex")).toBe(
        Buffer.from(share.data).toString("hex"),
      );
    }
  });
});
