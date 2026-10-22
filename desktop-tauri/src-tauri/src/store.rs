use crate::{dpapi, policy::{self, Platform, Result, MAX_ACCOUNTS}};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}};
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_STORE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub platform_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document { schema_version: u32, accounts: Vec<Account> }

pub struct Store {
    pub root: PathBuf,
    pub accounts: Vec<Account>,
    pub platforms: Vec<Platform>,
    _lock: File,
}

fn validate(accounts: &[Account], platforms: &[Platform]) -> Result<()> {
    if accounts.len() > MAX_ACCOUNTS { return Err("ACCOUNT_LIMIT"); }
    let mut ids = HashSet::new();
    for a in accounts {
        if !policy::valid_id(&a.id) || !policy::valid_name(&a.name) || !ids.insert(&a.id) {
            return Err("STORE_INVALID");
        }
        policy::platform(platforms, &a.platform_id)?;
    }
    Ok(())
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|_| "STORE_IO")?;
        let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true)
            .open(root.join("instance.lock")).map_err(|_| "STORE_IO")?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| "PROFILE_IN_USE")?;
        let platforms = policy::catalog()?;
        let file = root.join("accounts.dpapi");
        let accounts = match File::open(file) {
            Ok(file) => {
                let mut encrypted = Vec::new();
                file.take(MAX_STORE_BYTES + 1).read_to_end(&mut encrypted).map_err(|_| "STORE_IO")?;
                if encrypted.len() as u64 > MAX_STORE_BYTES { return Err("STORE_INVALID"); }
                let plain = dpapi::decrypt(&encrypted)?;
                let doc: Document = serde_json::from_slice(&plain).map_err(|_| "STORE_INVALID")?;
                if doc.schema_version != 1 { return Err("STORE_VERSION"); }
                validate(&doc.accounts, &platforms)?;
                doc.accounts
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(_) => return Err("STORE_IO"),
        };
        Ok(Self { root, accounts, platforms, _lock: lock })
    }

    pub fn create(&mut self, name: &str, platform_id: &str) -> Result<()> {
        let name = name.trim();
        if !policy::valid_name(name) { return Err("NAME_INVALID"); }
        policy::platform(&self.platforms, platform_id)?;
        let mut next = self.accounts.clone();
        next.push(Account { id: Uuid::new_v4().to_string(), name: name.into(), platform_id: platform_id.into() });
        validate(&next, &self.platforms)?;
        let document = Document { schema_version: 1, accounts: next };
        let plain = Zeroizing::new(serde_json::to_vec(&document).map_err(|_| "STORE_INVALID")?);
        let encrypted = dpapi::encrypt(&plain)?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root).map_err(|_| "STORE_IO")?;
        temporary.write_all(&encrypted).map_err(|_| "STORE_IO")?;
        temporary.as_file().sync_all().map_err(|_| "STORE_IO")?;
        // Same-directory atomic replace. Never remove the old file before persist.
        temporary.persist(self.root.join("accounts.dpapi")).map_err(|_| "STORE_IO")?;
        self.accounts = document.accounts;
        Ok(())
    }

    pub fn account(&self, id: &str) -> Result<Account> {
        if !policy::valid_id(id) { return Err("ACCOUNT_UNKNOWN"); }
        self.accounts.iter().find(|a| a.id == id).cloned().ok_or("ACCOUNT_UNKNOWN")
    }

    pub fn profile(&self, id: &str) -> Result<PathBuf> {
        self.account(id)?;
        Ok(self.root.join("profiles").join(id))
    }
}

pub fn runtime_root(base: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        use sha2::{Digest, Sha256};
        let fingerprint = format!("{:x}", Sha256::digest(env!("CARGO_MANIFEST_DIR").as_bytes()));
        base.join("development").join(fingerprint)
    } else {
        base.join("prototype")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_roundtrip_encryption_and_distinct_profiles() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path().to_path_buf()).unwrap();
        store.create("Synthetic A", "whatsapp").unwrap();
        store.create("Synthetic B", "whatsapp").unwrap();
        let accounts = store.accounts.clone();
        assert_ne!(store.profile(&accounts[0].id).unwrap(), store.profile(&accounts[1].id).unwrap());
        assert!(store.profile("../shell").is_err());
        let ciphertext = fs::read(root.path().join("accounts.dpapi")).unwrap();
        assert!(!ciphertext.windows(11).any(|w| w == b"Synthetic A"));
        drop(store);
        let reopened = Store::open(root.path().to_path_buf()).unwrap();
        assert_eq!(reopened.accounts, accounts);
    }

    #[test]
    fn duplicate_process_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let first = Store::open(root.path().to_path_buf()).unwrap();
        assert!(matches!(Store::open(root.path().to_path_buf()), Err("PROFILE_IN_USE")));
        drop(first);
        assert!(Store::open(root.path().to_path_buf()).is_ok());
    }

    #[test]
    fn damaged_store_is_never_reset() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("accounts.dpapi");
        fs::write(&path, b"corrupt").unwrap();
        assert!(Store::open(root.path().to_path_buf()).is_err());
        assert_eq!(fs::read(path).unwrap(), b"corrupt");
    }

    #[test]
    fn persistence_failure_does_not_publish_memory() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path().to_path_buf()).unwrap();
        fs::create_dir(root.path().join("accounts.dpapi")).unwrap();
        assert!(store.create("Synthetic", "whatsapp").is_err());
        assert!(store.accounts.is_empty());
    }

    #[test]
    fn malformed_and_duplicate_records_fail_validation() {
        let platforms = policy::catalog().unwrap();
        let a = Account { id: Uuid::new_v4().to_string(), name: "A".into(), platform_id: "whatsapp".into() };
        assert!(validate(&[a.clone(), a.clone()], &platforms).is_err());
        let mut bad = a;
        bad.id = "../other-account".into();
        assert!(validate(&[bad], &platforms).is_err());
    }
}
