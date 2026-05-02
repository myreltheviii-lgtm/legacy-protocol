// crates/shamir/src/reconstruct.rs
//
// Reconstructs the secret from M or more shares using Lagrange interpolation
// over GF(256).
//
// Level 4: gf_inv is Result-returning — the final panic path in
// the crate has been eliminated. A zero input (which would indicate duplicate
// share indices slipping past the deduplication guard) now returns
// ShamirError::ZeroInverse instead of panicking.

use crate::{Share, ShamirError};
use crate::split::gf256::{gf_add, gf_mul};

pub fn reconstruct_secret(shares: &[Share]) -> Result<Vec<u8>, ShamirError> {
    if shares.is_empty() {
        return Err(ShamirError::InsufficientShares);
    }

    let secret_len = shares[0].data.len();

    if shares.iter().any(|s| s.data.len() != secret_len) {
        return Err(ShamirError::ShareLengthMismatch);
    }

    // A [bool; 256] array indexed by share index: O(1) lookup, no heap
    // allocation, no hash timing variation.
    let mut seen = [false; 256];
    for share in shares {
        if share.index == 0 {
            return Err(ShamirError::ZeroIndex);
        }
        if seen[share.index as usize] {
            return Err(ShamirError::DuplicateIndices);
        }
        seen[share.index as usize] = true;
    }

    let mut secret = vec![0u8; secret_len];

    for byte_idx in 0..secret_len {
        // Lagrange interpolation at x = 0.
        let mut result = 0u8;
        for (i, share_i) in shares.iter().enumerate() {
            let x_i = share_i.index;
            let y_i = share_i.data[byte_idx];
            let mut numerator   = 1u8;
            let mut denominator = 1u8;

            for (j, share_j) in shares.iter().enumerate() {
                if i == j { continue; }
                let x_j = share_j.index;
                // numerator   *= (0 - x_j) = x_j in GF(256)
                numerator   = gf_mul(numerator, x_j);
                // denominator *= (x_i - x_j) = x_i XOR x_j in GF(256)
                denominator = gf_mul(denominator, x_i ^ x_j);
            }

            // gf_inv(0) would mean two share indices are equal — caught above
            // by the deduplication guard. This is defence-in-depth.
            let inv = gf_inv(denominator)?;
            let lagrange_coeff = gf_mul(numerator, inv);
            result = gf_add(result, gf_mul(y_i, lagrange_coeff));
        }
        secret[byte_idx] = result;
    }

    Ok(secret)
}

/// Multiplicative inverse of `a` in GF(256) via Fermat's little theorem:
/// a^{-1} = a^{254} (since every non-zero element has order dividing 255).
///
/// Returns ShamirError::ZeroInverse for a == 0 rather than panicking —
/// this eliminates the last panic path in the crate.
fn gf_inv(a: u8) -> Result<u8, ShamirError> {
    if a == 0 {
        return Err(ShamirError::ZeroInverse);
    }
    let mut result = 1u8;
    let mut base   = a;
    let mut exp    = 254u8;
    while exp > 0 {
        if exp & 1 != 0 {
            result = gf_mul(result, base);
        }
        base = gf_mul(base, base);
        exp >>= 1;
    }
    Ok(result)
}
