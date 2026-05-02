// crates/shamir/src/verify.rs
//
// Verifies that a single share is structurally valid — non-zero index,
// non-empty data — without requiring other shares or the secret.
//
// Note: structural validity does not prove the share was produced by a
// legitimate split. Full cryptographic verification requires a commitment
// scheme (e.g., Feldman VSS) which is the upgrade path.

use crate::{Share, ShamirError};

pub fn verify_share(share: &Share) -> Result<(), ShamirError> {
    if share.index == 0 {
        return Err(ShamirError::ZeroIndex);
    }
    if share.data.is_empty() {
        return Err(ShamirError::EmptyShare);
    }
    Ok(())
}
