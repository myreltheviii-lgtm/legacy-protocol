// crates/shamir/src/split.rs
//
// Splits a secret byte slice into N shares using Shamir's Secret Sharing over
// GF(256). Each byte of the secret becomes the constant term of an independent
// degree-(M-1) polynomial over GF(256).
//
// Level 4 fix: Horner's method now accumulates from y = 0u8 and iterates
// ALL coefficients in reverse order, so the call to coeffs.last() is gone
// entirely. The result is mathematically identical — for P(x) = a0 + a1*x +
// a2*x^2 + ..., starting the accumulation from 0 and applying the full
// reverse sequence produces the same value as starting from a[n-1] and
// skipping it — while eliminating the last unwrap() path in the crate.

use crate::{Share, ShamirError};

pub fn split_secret(
    secret: &[u8],
    threshold: u8,
    num_shares: u8,
) -> Result<Vec<Share>, ShamirError> {
    if num_shares == 0 {
        return Err(ShamirError::InvalidShareCount);
    }
    if threshold == 0 || threshold > num_shares {
        return Err(ShamirError::InvalidThreshold);
    }
    if secret.is_empty() {
        return Err(ShamirError::EmptySecret);
    }

    let coeff_count = threshold as usize - 1;
    let mut rng_buf = vec![0u8; secret.len() * coeff_count];
    getrandom::getrandom(&mut rng_buf).map_err(|_| ShamirError::RngError)?;

    let mut shares: Vec<Share> = (1..=num_shares)
        .map(|i| Share { index: i, data: vec![0u8; secret.len()] })
        .collect();

    let mut coeffs: Vec<u8> = Vec::with_capacity(threshold as usize);

    for (byte_idx, &secret_byte) in secret.iter().enumerate() {
        coeffs.clear();
        coeffs.push(secret_byte);
        for coeff_idx in 0..coeff_count {
            coeffs.push(rng_buf[byte_idx * coeff_count + coeff_idx]);
        }

        for share in shares.iter_mut() {
            let x = share.index;
            // Horner's method accumulating from 0:
            //   y = 0
            //   for each coeff c in [a[n-1], ..., a[1], a[0]]:
            //     y = y * x + c
            // This is equivalent to the seed-from-last() form but avoids
            // any indexing into the Vec and therefore has no panic path.
            let mut y = 0u8;
            for &coeff in coeffs.iter().rev() {
                y = gf256::gf_add(gf256::gf_mul(y, x), coeff);
            }
            share.data[byte_idx] = y;
        }
    }

    Ok(shares)
}

pub(crate) mod gf256 {
    /// Addition in GF(256) is XOR — no carry.
    #[inline(always)]
    pub fn gf_add(a: u8, b: u8) -> u8 {
        a ^ b
    }

    /// Multiplication in GF(256) using the AES-standard irreducible polynomial
    /// x^8 + x^4 + x^3 + x + 1 (0x11b). Russian-peasant multiplication.
    pub fn gf_mul(a: u8, b: u8) -> u8 {
        let modulus: u16 = 0x11b;
        let mut a16 = a as u16;
        let mut b16 = b as u16;
        let mut res16 = 0u16;

        for _ in 0..8 {
            if b16 & 1 != 0 {
                res16 ^= a16;
            }
            let carry = a16 & 0x80;
            a16 <<= 1;
            if carry != 0 {
                a16 ^= modulus;
            }
            b16 >>= 1;
        }
        res16 as u8
    }
}
