// sdk/src/shamir.ts
//
// Shamir's Secret Sharing in TypeScript — GF(256) arithmetic matching the
// Rust crates/shamir implementation exactly. Used by the frontend to split
// and reconstruct the vault owner's UTXO private key in-browser.
//
// GF(256) uses the AES-standard irreducible polynomial x^8+x^4+x^3+x+1
// (0x11b), Horner's method for polynomial evaluation, and Lagrange
// interpolation for reconstruction — matching the Rust crate byte-for-byte.

// ── GF(256) arithmetic ────────────────────────────────────────────────────────

function gfAdd(a: number, b: number): number {
  return (a ^ b) & 0xff;
}

function gfMul(a: number, b: number): number {
  const modulus = 0x11b;
  let a16 = a & 0xff;
  let b16 = b & 0xff;
  let res = 0;
  for (let i = 0; i < 8; i++) {
    if (b16 & 1) res ^= a16;
    const carry = a16 & 0x80;
    a16 = (a16 << 1) & 0xff;
    if (carry) a16 ^= (modulus & 0xff);
    b16 >>= 1;
  }
  return res & 0xff;
}

function gfInv(a: number): number {
  if (a === 0) throw new ShamirError("multiplicative inverse of zero is undefined");
  let result = 1;
  let base   = a & 0xff;
  let exp    = 254;
  while (exp > 0) {
    if (exp & 1) result = gfMul(result, base);
    base = gfMul(base, base);
    exp >>= 1;
  }
  return result;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class ShamirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShamirError";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShamirShare {
  /** 1-indexed share number. */
  index: number;
  /** Share data bytes (same length as the original secret). */
  data:  Uint8Array;
}

// ── Split ─────────────────────────────────────────────────────────────────────

/**
 * Splits `secret` into `numShares` shares such that any `threshold` of them
 * reconstruct the original. Uses Horner's method for polynomial evaluation
 * over GF(256), matching the Rust implementation exactly.
 */
export function splitSecret(
  secret:    Uint8Array,
  threshold: number,
  numShares: number,
): ShamirShare[] {
  if (numShares < 1 || numShares > 255) throw new ShamirError("numShares must be 1–255");
  if (threshold < 1 || threshold > numShares) throw new ShamirError("threshold must be 1–numShares");
  if (secret.length === 0) throw new ShamirError("secret must not be empty");

  const coeffCount = threshold - 1;
  const shares: ShamirShare[] = Array.from({ length: numShares }, (_, i) => ({
    index: i + 1,
    data:  new Uint8Array(secret.length),
  }));

  const rng = new Uint8Array(secret.length * coeffCount);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(rng);
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomFillSync } = require("crypto");
    randomFillSync(rng);
  }

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs: number[] = [secret[byteIdx]];
    for (let c = 0; c < coeffCount; c++) {
      coeffs.push(rng[byteIdx * coeffCount + c]);
    }

    for (const share of shares) {
      const x = share.index;
      // Horner's method: accumulate from 0, iterate coefficients in reverse.
      let y = 0;
      for (let i = coeffs.length - 1; i >= 0; i--) {
        y = gfAdd(gfMul(y, x), coeffs[i]);
      }
      share.data[byteIdx] = y;
    }
  }

  return shares;
}

// ── Reconstruct ───────────────────────────────────────────────────────────────

/**
 * Reconstructs the secret from M or more shares using Lagrange interpolation
 * over GF(256). The result is guaranteed to match `splitSecret` output for
 * any M shares from the same split.
 */
export function reconstructSecret(shares: ShamirShare[]): Uint8Array {
  if (shares.length === 0) throw new ShamirError("need at least one share");

  const secretLen = shares[0].data.length;
  if (shares.some((s) => s.data.length !== secretLen)) {
    throw new ShamirError("all shares must have the same data length");
  }

  const seen = new Set<number>();
  for (const s of shares) {
    if (s.index === 0) throw new ShamirError("share index must be non-zero");
    if (seen.has(s.index)) throw new ShamirError("duplicate share indices detected");
    seen.add(s.index);
  }

  const secret = new Uint8Array(secretLen);

  for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
    let result = 0;

    for (let i = 0; i < shares.length; i++) {
      const xi = shares[i].index;
      const yi = shares[i].data[byteIdx];
      let num = 1;
      let den = 1;

      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        const xj = shares[j].index;
        num = gfMul(num, xj);
        den = gfMul(den, xi ^ xj);
      }

      const lagrange = gfMul(num, gfInv(den));
      result = gfAdd(result, gfMul(yi, lagrange));
    }

    secret[byteIdx] = result;
  }

  return secret;
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verifies that a ShamirShare has a valid structure:
 *   - index must be ≥ 1
 *   - data must be non-empty
 *
 * Throws ShamirError if validation fails. This does NOT verify that the share
 * came from a specific split — it only validates structural integrity.
 */
export function verifyShare(share: ShamirShare): void {
  if (share.index < 1) {
    throw new ShamirError(`share index must be ≥ 1, got ${share.index}`);
  }
  if (!share.data || share.data.length === 0) {
    throw new ShamirError("share data must not be empty");
  }
}

// ── Encode / decode ───────────────────────────────────────────────────────────

/**
 * Encodes a ShamirShare as a compact base64 string for guardian storage.
 * Format: first byte = share index, remaining bytes = share data.
 */
export function encodeShareBase64(share: ShamirShare): string {
  const buf = new Uint8Array(1 + share.data.length);
  buf[0] = share.index;
  buf.set(share.data, 1);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buf).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

/**
 * Decodes a base64-encoded guardian share string back to a ShamirShare.
 */
export function decodeShareBase64(encoded: string): ShamirShare {
  let buf: Uint8Array;
  if (typeof Buffer !== "undefined") {
    buf = new Uint8Array(Buffer.from(encoded, "base64"));
  } else {
    const binary = atob(encoded);
    buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  }
  if (buf.length < 2) throw new ShamirError("share data must not be empty");
  return {
    index: buf[0],
    data:  buf.slice(1),
  };
}
