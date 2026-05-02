// crates/shamir/src/lib.rs
//
// Shamir's Secret Sharing (SSS) splits a secret into N shares such that any
// M of them can reconstruct the original, but M-1 shares reveal nothing.
//
// The implementation uses GF(256) arithmetic (the same finite field used by
// AES) so all operations are constant-time byte manipulations with no
// divisions by zero and no modular inverse edge cases.
//
// Level 4 panic-freedom: all public functions and all internal helpers are
// fully panic-free. The last remaining unwrap path in split.rs was eliminated
// by restructuring Horner's method to accumulate from 0u8 rather than seeding
// from coeffs.last(). No unwrap(), no expect(), no panic!(), no index out
// of bounds that cannot be statically proven safe.

pub mod split;
pub mod reconstruct;
pub mod verify;

pub use split::split_secret;
pub use reconstruct::reconstruct_secret;
pub use verify::verify_share;

/// A single share produced by `split_secret`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Share {
    pub index: u8,
    pub data:  Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum ShamirError {
    #[error("threshold M must be at least 1 and at most N")]
    InvalidThreshold,
    #[error("share count N must be at least 1 and at most 255")]
    InvalidShareCount,
    #[error("not enough shares to reconstruct the secret")]
    InsufficientShares,
    #[error("all shares must have the same data length")]
    ShareLengthMismatch,
    #[error("share index must be non-zero")]
    ZeroIndex,
    #[error("duplicate share indices detected")]
    DuplicateIndices,
    #[error("OS random number generator unavailable")]
    RngError,
    #[error("share data must not be empty")]
    EmptyShare,
    #[error("secret must not be empty")]
    EmptySecret,
    /// Triggered only when gf_inv receives 0, which means duplicate share
    /// indices slipped through the deduplication guard. Defence-in-depth.
    #[error("multiplicative inverse of zero is undefined (duplicate share indices)")]
    ZeroInverse,
}
