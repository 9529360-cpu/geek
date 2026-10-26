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

/// Move the development-only root before any repository or WebView opens it.
/// Rename preserves every account/profile and fails closed rather than resetting data.
pub fn prepare_runtime_root(base: &Path) -> Result<PathBuf> {
    let root = runtime_root(base);
    if cfg!(debug_assertions) {
        use sha2::{Digest, Sha256};
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(env!("CARGO_MANIFEST_DIR").as_bytes())
        );
        let legacy = base.join("development").join(fingerprint);
        if legacy.exists() && !root.exists() {
            std::fs::create_dir_all(root.parent().ok_or(AppError::StoreIo)?)
                .map_err(|_| AppError::StoreIo)?;
            std::fs::rename(legacy, &root).map_err(|_| AppError::StoreIo)?;
        }
    }
    Ok(root)
}

pub fn runtime_root(base: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        use sha2::{Digest, Sha256};
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(env!("CARGO_MANIFEST_DIR").as_bytes())
        );
        base.join("dev").join(&fingerprint[..32])
    } else {
        base.join("prototype")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_root_migration_preserves_existing_files() {
        use sha2::{Digest, Sha256};
        let base = tempfile::tempdir().unwrap();
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(env!("CARGO_MANIFEST_DIR").as_bytes())
        );
        let legacy = base.path().join("development").join(fingerprint);
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("fixture.dpapi"), b"preserved").unwrap();
        let root = prepare_runtime_root(base.path()).unwrap();
        assert_eq!(
            std::fs::read(root.join("fixture.dpapi")).unwrap(),
            b"preserved"
        );
        assert!(!legacy.exists());
        assert_eq!(prepare_runtime_root(base.path()).unwrap(), root);
    }

    #[test]
    fn development_database_path_leaves_room_for_webview_files() {
        let base = Path::new("C:/Users/bz977/AppData/Local/com.geek.desktop.tauri.prototype");
        let root = runtime_root(base);
        let profile = account_profile(&root, "fa883e2a-5b7a-47c8-a8ea-1ebedd46b909").unwrap();
        let database = profile.join("EBWebView/Default/IndexedDB/https_web.whatsapp.com_0.indexeddb.leveldb/MANIFEST-000001");
        assert!(
            database.to_string_lossy().len() < 240,
            "{}",
            database.display()
        );
    }
}
