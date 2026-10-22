use crate::domain::{
    account::valid_id,
    error::{AppError, Result},
};
use std::path::{Path, PathBuf};

pub fn account_profile(root: &Path, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(AppError::AccountUnknown);
    }
    Ok(root.join("profiles").join(id))
}

pub fn runtime_root(base: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        use sha2::{Digest, Sha256};
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(env!("CARGO_MANIFEST_DIR").as_bytes())
        );
        base.join("development").join(fingerprint)
    } else {
        base.join("prototype")
    }
}
