// sdk/src/shamir.ts
//
// Shamir's Secret Sharing in TypeScript — a direct mirror of crates/shamir/.
//
// The implementation uses GF(256) arithmetic with the AES-standard irreducible
// polynomial x^8 + x^4 + x^3 + x + 1 (0x11b), Russian-peasant multiplication,
// Fermat's little theorem inversion (a^{-1} = a^254), Horner evaluation for
// share splitting, and Lagrange interpolation at x=0 for reconstruction.
//
// Every operation is a pure byte manipulation — no floats, no BigInt, no
// external dependencies. The math is identical to the Rust crate so shares
// produced in the browser can be reconstructed by the Rust crate and vice versa.
//
// Level 4 SDK feature. The Rust crate CANNOT be imported or WASM-compiled
// into the browser; this file re-implements the exact same field arithmetic
// natively in TypeScript.
//
// API mirrors the Rust public API:
//   splitSecret(secret, threshold, numShares) → Share[]
//   reconstructSecret(shares) → Uint8Array
//   verifyShare(share) → void (throws on invalid)

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single share produced by splitSecret. */
export interface ShamirShare {
  /** x-coordinate (1-indexed, never 0). Identifies which share this is. */
  index: number;
  /** The share's data bytes — one byte per secret byte. */
  data:  Uint8Array;
}

export class ShamirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShamirError";
  }
}

// ── GF(256) arithmetic ────────────────────────────────────────────────────────
//
// AES-standard field GF(2^8) / (x^8 + x^4 + x^3 + x + 1)  (0x11b).
// All operations take and return single bytes (0–255).

/** Addition in GF(256) is XOR — no carry term. */
function gfAdd(a: number, b: number): number {
  return (a ^ b) & 0xff;
}

/**
 * Multiplication in GF(256) via Russian-peasant algorithm with the AES
 * irreducible polynomial 0x11b (x^8 + x^4 + x^3 + x + 1).
 *
 * The modulus is 0x11b but we work in 8-bit bytes so carry detection is
 * done on bit 7 of the current `a` before the shift. When the carry fires
 * after the shift, we XOR with 0x1b (the low 8 bits of 0x11b) because the
 * high bit has already been shifted out of the byte.
 */
function gfMul(a: number, b: number): number {
  let result = 0;
  let aa = a & 0xff;
  let bb = b & 0xff;
  while (bb > 0) {
    if (bb & 1) {
      result ^= aa;
    }
    const carry = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (carry) {
      // XOR with the low 8 bits of 0x11b after the high bit is shifted out.
      aa ^= 0x1b;
    }
    bb >>= 1;
  }
  return result & 0xff;
}

/**
 * Multiplicative inverse of `a` in GF(256) via Fermat's little theorem:
 *   a^{-1} = a^{254}  (since every non-zero element has order dividing 255)
 *
 * Uses fast exponentiation (square-and-multiply). Returns 0 for a=0, which
 * has no inverse — callers must guard against this.
 */
function gfInv(a: number): number {
  if (a === 0) throw new ShamirError("Multiplicative inverse of zero (duplicate share indices)");
  // a^254 using square-and-multiply for 8-bit exponent 254 = 0b11111110.
  let result = 1;
  let base   = a & 0xff;
  let exp    = 254;
  while (exp > 0) {
    if (exp & 1) {
      result = gfMul(result, base);
    }
    base = gfMul(base, base);
    exp >>= 1;
  }
  return result;
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Splits a secret byte array into `numShares` shares such that any `threshold`
 * of them can reconstruct the original. Mirrors `split_secret` in split.rs
 * exactly, including the Horner accumulation order and the 0-seed start.
 *
 * @param secret     The bytes to split. Must be non-empty.
 * @param threshold  Minimum shares needed to reconstruct (M). 1 ≤ M ≤ N.
 * @param numShares  Total number of shares to produce (N). 1 ≤ N ≤ 255.
 */
export function splitSecret(
  secret:    Uint8Array,
  threshold: number,
  numShares: number,
): ShamirShare[] {
  if (numShares < 1 || numShares > 255) {
    throw new ShamirError("numShares must be between 1 and 255");
  }
  if (threshold < 1 || threshold > numShares) {
    throw new ShamirError("threshold must be at least 1 and at most numShares");
  }
  if (secret.length === 0) {
    throw new ShamirError("secret must not be empty");
  }

  const coeffCount = threshold - 1;

  // Generate all random coefficients at once. crypto.getRandomValues is the
  // browser-native CSPRNG — same entropy source as getrandom::getrandom in Rust.
  const rngBuf = new Uint8Array(secret.length * coeffCount);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(rngBuf);
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomFillSync } = require("crypto");
    randomFillSync(rngBuf);
  }

  // One share per x-coordinate (1..=numShares).
  const shares: ShamirShare[] = Array.from({ length: numShares }, (_, i) => ({
    index: i + 1,
    data:  new Uint8Array(secret.length),
  }));

  // For each byte of the secret, build an independent polynomial of degree
  // (threshold - 1) and evaluate it at x = 1, 2, ..., numShares.
  const coeffs = new Uint8Array(threshold);

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // Polynomial: P(x) = secret[byteIdx] + c1*x + c2*x^2 + ... + c_{M-1}*x^{M-1}
    // The constant term is the secret byte; the remaining M-1 coefficients are random.
    coeffs[0] = secret[byteIdx];
    for (let j = 0; j < coeffCount; j++) {
      coeffs[j + 1] = rngBuf[byteIdx * coeffCount + j];
    }

    for (const share of shares) {
      const x = share.index;
      // Horner's method starting from 0 — accumulate y = 0, then for each
      // coefficient c in reverse (highest degree first): y = y*x + c.
      // Identical accumulation order to split.rs (which eliminated the
      // coeffs.last().unwrap() seed by starting from 0).
      let y = 0;
      for (let k = coeffs.length - 1; k >= 0; k--) {
        y = gfAdd(gfMul(y, x), coeffs[k]);
      }
      share.data[byteIdx] = y;
    }
  }

  return shares;
}

/**
 * Reconstructs the original secret from `threshold` or more shares using
 * Lagrange interpolation over GF(256) at x=0.
 *
 * Mirrors `reconstruct_secret` in reconstruct.rs exactly, including the
 * deduplication guard using a fixed-size boolean array (O(1), no heap).
 *
 * @param shares  At least `threshold` shares from splitSecret.
 */
export function reconstructSecret(shares: ShamirShare[]): Uint8Array {
  if (shares.length === 0) {
    throw new ShamirError("Not enough shares to reconstruct the secret");
  }

  const secretLen = shares[0].data.length;

  for (const s of shares) {
    if (s.data.length !== secretLen) {
      throw new ShamirError("All shares must have the same data length");
    }
    if (s.index === 0 || s.index > 255) {
      throw new ShamirError("Share index must be between 1 and 255");
    }
  }

  // Deduplication guard: O(1) lookup, no allocation, no timing variation.
  const seen = new Uint8Array(256); // 0 = not seen
  for (const s of shares) {
    if (seen[s.index]) {
      throw new ShamirError("Duplicate share indices detected");
    }
    seen[s.index] = 1;
  }

  const secret = new Uint8Array(secretLen);

  for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
    // Lagrange interpolation at x = 0:
    //   secret = sum_i ( y_i * product_{j != i} (0 - x_j) / (x_i - x_j) )
    // In GF(256): subtraction is XOR (same as addition), so 0 - x_j = x_j.
    let result = 0;

    for (let i = 0; i < shares.length; i++) {
      const xi = shares[i].index;
      const yi = shares[i].data[byteIdx];

      let numerator   = 1;
      let denominator = 1;

      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        const xj = shares[j].index;
        // numerator   *= (0 - x_j) = x_j  in GF(256)
        numerator   = gfMul(numerator, xj);
        // denominator *= (x_i - x_j) = x_i XOR x_j  in GF(256)
        denominator = gfMul(denominator, xi ^ xj);
      }

      // gfInv(0) would mean xi == xj for some j — blocked by dedup above.
      const inv          = gfInv(denominator);
      const lagrangeCoef = gfMul(numerator, inv);
      result             = gfAdd(result, gfMul(yi, lagrangeCoef));
    }

    secret[byteIdx] = result;
  }

  return secret;
}

/**
 * Verifies that a share is structurally valid without requiring other shares
 * or the original secret. Structural validity does not prove the share was
 * produced by a legitimate splitSecret call — full cryptographic verification
 * requires a commitment scheme such as Feldman VSS.
 *
 * Mirrors `verify_share` in verify.rs.
 */
export function verifyShare(share: ShamirShare): void {
  if (share.index === 0 || share.index > 255) {
    throw new ShamirError("Share index must be between 1 and 255");
  }
  if (share.data.length === 0) {
    throw new ShamirError("Share data must not be empty");
  }
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/**
 * Encodes a ShamirShare as a compact base64 string for QR code embedding,
 * NFC tag writing, or guardian distribution. The first byte is the share
 * index; the remaining bytes are the share data.
 *
 * Uses a manual byte-to-charcode loop rather than spread-into-fromCharCode
 * because the spread operator (`String.fromCharCode(...buf)`) pushes every
 * byte as a separate argument onto the call stack. For secrets larger than
 * ~10 000 bytes (engine-dependent), this throws "Maximum call stack size
 * exceeded". A loop has O(1) stack depth regardless of input length.
 */
export function encodeShareBase64(share: ShamirShare): string {
  const buf = new Uint8Array(1 + share.data.length);
  buf[0] = share.index;
  buf.set(share.data, 1);

  // Build the binary string character-by-character to avoid exceeding the
  // JavaScript engine's maximum argument count for Function.prototype.apply.
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64-encoded share produced by encodeShareBase64.
 * Throws ShamirError on malformed input.
 */
export function decodeShareBase64(encoded: string): ShamirShare {
  let decoded: Uint8Array;
  try {
    const binary = atob(encoded);
    decoded = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      decoded[i] = binary.charCodeAt(i);
    }
  } catch {
    throw new ShamirError("Invalid base64 share encoding");
  }
  if (decoded.length < 2) {
    throw new ShamirError("Encoded share too short — must contain at least index + 1 data byte");
  }
  return {
    index: decoded[0],
    data:  decoded.slice(1),
  };
}
```

