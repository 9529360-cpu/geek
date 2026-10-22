use crate::{dpapi, policy::{self, NavigationPolicy, Platform, Result, MAX_ACCOUNTS}};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}};
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_STORE_BYTES: u64 = 2 * 1024 * 1024;
const SCHEMA_VERSION: u32 = 2;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub platform_id: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website_url: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    // Opt-in: adding a tray must not silently change the existing close behavior.
    #[serde(default)]
    pub close_to_tray: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    schema_version: u32,
    accounts: Vec<Account>,
    #[serde(default)]
    settings: Settings,
}

pub struct Store {
    pub root: PathBuf,
    pub accounts: Vec<Account>,
    pub platforms: Vec<Platform>,
    pub settings: Settings,
    _lock: File,
}

fn validate(accounts: &[Account], platforms: &[Platform]) -> Result<()> {
    // Archived accounts still own profiles and count toward the storage limit.
    if accounts.len() > MAX_ACCOUNTS { return Err("ACCOUNT_LIMIT"); }
    let mut ids = HashSet::new();
    for a in accounts {
        if !policy::valid_id(&a.id) || !policy::valid_name(&a.name) || !ids.insert(&a.id) {
            return Err("STORE_INVALID");
        }
        let platform = policy::platform(platforms, &a.platform_id)?;
        NavigationPolicy::new(platform, a.website_url.as_deref())?;
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
        let document = match File::open(file) {
            Ok(file) => {
                let mut encrypted = Vec::new();
                file.take(MAX_STORE_BYTES + 1).read_to_end(&mut encrypted).map_err(|_| "STORE_IO")?;
                if encrypted.len() as u64 > MAX_STORE_BYTES { return Err("STORE_INVALID"); }
                let plain = dpapi::decrypt(&encrypted)?;
                let doc: Document = serde_json::from_slice(&plain).map_err(|_| "STORE_INVALID")?;
                if !matches!(doc.schema_version, 1 | SCHEMA_VERSION) { return Err("STORE_VERSION"); }
                validate(&doc.accounts, &platforms)?;
                doc
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Document {
                schema_version: SCHEMA_VERSION, accounts: Vec::new(), settings: Settings::default(),
            },
            Err(_) => return Err("STORE_IO"),
        };
        Ok(Self { root, accounts: document.accounts, settings: document.settings, platforms, _lock: lock })
    }

    fn commit(&mut self, accounts: Vec<Account>, settings: Settings) -> Result<()> {
        validate(&accounts, &self.platforms)?;
        let document = Document { schema_version: SCHEMA_VERSION, accounts, settings };
        let plain = Zeroizing::new(serde_json::to_vec(&document).map_err(|_| "STORE_INVALID")?);
        let encrypted = dpapi::encrypt(&plain)?;
        if encrypted.len() as u64 > MAX_STORE_BYTES { return Err("STORE_INVALID"); }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root).map_err(|_| "STORE_IO")?;
        temporary.write_all(&encrypted).map_err(|_| "STORE_IO")?;
        temporary.as_file().sync_all().map_err(|_| "STORE_IO")?;
        // Same-directory atomic replace; never remove the authoritative file first.
        temporary.persist(self.root.join("accounts.dpapi")).map_err(|_| "STORE_IO")?;
        self.accounts = document.accounts;
        self.settings = document.settings;
        Ok(())
    }

    pub fn create(&mut self, name: &str, platform_id: &str, website_url: Option<&str>) -> Result<()> {
        let name = name.trim();
        if !policy::valid_name(name) { return Err("NAME_INVALID"); }
        let platform = policy::platform(&self.platforms, platform_id)?;
        let navigation = NavigationPolicy::new(platform, website_url)?;
        let website_url = if platform_id == "website" { Some(navigation.start().to_string()) } else { None };
        let mut next = self.accounts.clone();
        next.push(Account { id: Uuid::new_v4().to_string(), name: name.into(), platform_id: platform_id.into(),
            archived: false, website_url });
        self.commit(next, self.settings.clone())
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<()> {
        self.account(id)?;
        let name = name.trim();
        if !policy::valid_name(name) { return Err("NAME_INVALID"); }
        let mut next = self.accounts.clone();
        next.iter_mut().find(|a| a.id == id).ok_or("ACCOUNT_UNKNOWN")?.name = name.into();
        self.commit(next, self.settings.clone())
    }

    // Lifecycle owner must close the view before archiving. No profile is removed.
    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<()> {
        self.account(id)?;
        let mut next = self.accounts.clone();
        next.iter_mut().find(|a| a.id == id).ok_or("ACCOUNT_UNKNOWN")?.archived = archived;
        self.commit(next, self.settings.clone())
    }

    pub fn set_settings(&mut self, settings: Settings) -> Result<()> {
        self.commit(self.accounts.clone(), settings)
    }

    pub fn account(&self, id: &str) -> Result<Account> {
        if !policy::valid_id(id) { return Err("ACCOUNT_UNKNOWN"); }
        self.accounts.iter().find(|a| a.id == id).cloned().ok_or("ACCOUNT_UNKNOWN")
    }

    pub fn openable_account(&self, id: &str) -> Result<Account> {
        let account = self.account(id)?;
        if account.archived { return Err("ACCOUNT_ARCHIVED"); }
        Ok(account)
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
        store.create("Synthetic A", "whatsapp", None).unwrap();
        store.create("Synthetic B", "whatsapp", None).unwrap();
        let accounts = store.accounts.clone();
        assert_ne!(store.profile(&accounts[0].id).unwrap(), store.profile(&accounts[1].id).unwrap());
        assert!(store.profile("../shell").is_err());
        let ciphertext = fs::read(root.path().join("accounts.dpapi")).unwrap();
        assert!(!ciphertext.windows(11).any(|w| w == b"Synthetic A"));
        drop(store);
        assert_eq!(Store::open(root.path().to_path_buf()).unwrap().accounts, accounts);
    }

    #[test]
    fn rename_archive_restore_preserve_identity_and_profile() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path().to_path_buf()).unwrap();
        store.create("Synthetic A", "telegram-k", None).unwrap();
        store.create("Synthetic B", "telegram-k", None).unwrap();
        let id = store.accounts[0].id.clone();
        let other = store.accounts[1].clone();
        let profile = store.profile(&id).unwrap();
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("synthetic-marker"), b"keep").unwrap();
        store.rename(&id, " Renamed ").unwrap();
        store.set_archived(&id, true).unwrap();
        assert!(matches!(store.openable_account(&id), Err("ACCOUNT_ARCHIVED")));
        store.set_settings(Settings { close_to_tray: true }).unwrap();
        drop(store);
        let mut reopened = Store::open(root.path().to_path_buf()).unwrap();
        assert!(reopened.settings.close_to_tray);
        assert!(reopened.account(&id).unwrap().archived);
        reopened.set_archived(&id, false).unwrap();
        assert_eq!(reopened.openable_account(&id).unwrap().name, "Renamed");
        assert_eq!(reopened.profile(&id).unwrap(), profile);
        assert_eq!(fs::read(profile.join("synthetic-marker")).unwrap(), b"keep");
        assert_eq!(reopened.accounts[1], other);
    }

    #[test]
    fn old_schema_loads_without_rebinding_or_eager_rewrite() {
        let root = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4().to_string();
        let old = serde_json::json!({"schemaVersion": 1, "accounts": [
            {"id": id, "name": "Legacy synthetic", "platformId": "whatsapp"}
        ]});
        let encrypted = dpapi::encrypt(&serde_json::to_vec(&old).unwrap()).unwrap();
        let file = root.path().join("accounts.dpapi");
        fs::write(&file, &encrypted[..]).unwrap();
        let mut store = Store::open(root.path().to_path_buf()).unwrap();
        assert_eq!(fs::read(&file).unwrap(), encrypted[..]);
        assert_eq!(store.accounts[0].id, id);
        assert!(!store.accounts[0].archived);
        assert!(!store.settings.close_to_tray);
        store.rename(&id, "Updated").unwrap();
        let doc: serde_json::Value = serde_json::from_slice(&dpapi::decrypt(&fs::read(file).unwrap()).unwrap()).unwrap();
        assert_eq!(doc["schemaVersion"], 2);
    }

    #[test]
    fn website_entry_is_persisted_and_account_owned() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path().to_path_buf()).unwrap();
        assert!(store.create("Bad", "website", Some("https://example.com/?token=synthetic")).is_err());
        assert!(store.accounts.is_empty());
        store.create("Site A", "website", Some("https://EXAMPLE.com/inbox")).unwrap();
        store.create("Site B", "website", Some("https://other.example.com/")).unwrap();
        let accounts = store.accounts.clone();
        assert_eq!(accounts[0].website_url.as_deref(), Some("https://example.com/inbox"));
        drop(store);
        assert_eq!(Store::open(root.path().to_path_buf()).unwrap().accounts, accounts);
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
    fn damaged_and_future_stores_are_never_reset() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("accounts.dpapi");
        fs::write(&path, b"corrupt").unwrap();
        assert!(Store::open(root.path().to_path_buf()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"corrupt");
        let future = dpapi::encrypt(br#"{"schemaVersion":99,"accounts":[]}"#).unwrap();
        fs::write(&path, &future[..]).unwrap();
        assert!(matches!(Store::open(root.path().to_path_buf()), Err("STORE_VERSION")));
        assert_eq!(fs::read(path).unwrap(), future[..]);
    }

    #[test]
    fn persistence_failure_never_publishes_any_mutation() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path().to_path_buf()).unwrap();
        store.create("Original", "whatsapp", None).unwrap();
        let before = store.accounts.clone();
        let id = before[0].id.clone();
        let file = root.path().join("accounts.dpapi");
        let backup = root.path().join("synthetic-backup");
        fs::rename(&file, &backup).unwrap();
        fs::create_dir(&file).unwrap();
        assert!(store.create("Second", "whatsapp", None).is_err());
        assert!(store.rename(&id, "Changed").is_err());
        assert!(store.set_archived(&id, true).is_err());
        assert!(store.set_settings(Settings { close_to_tray: true }).is_err());
        assert_eq!(store.accounts, before);
        assert_eq!(store.settings, Settings::default());
        fs::remove_dir(&file).unwrap();
        fs::rename(backup, &file).unwrap();
        drop(store);
        assert_eq!(Store::open(root.path().to_path_buf()).unwrap().accounts, before);
    }

    #[test]
    fn malformed_duplicate_and_unknown_records_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path().to_path_buf()).unwrap();
        store.create("A", "whatsapp", None).unwrap();
        let a = store.accounts[0].clone();
        assert!(validate(&[a.clone(), a.clone()], &store.platforms).is_err());
        let mut bad = a;
        bad.id = "../other-account".into();
        assert!(validate(&[bad], &store.platforms).is_err());
        assert!(store.rename(&Uuid::new_v4().to_string(), "Unknown").is_err());
        assert!(store.set_archived("../shell", true).is_err());
        let before = store.accounts.clone();
        for name in ["", "\n", "bad\nname"] { assert!(store.rename(&before[0].id, name).is_err()); }
        assert_eq!(store.accounts, before);
    }

    #[test]
    fn archived_accounts_cannot_bypass_the_limit() {
        let all = policy::catalog().unwrap();
        let records: Vec<_> = (0..MAX_ACCOUNTS).map(|_| Account {
            id: Uuid::new_v4().to_string(), name: "Synthetic".into(), platform_id: "whatsapp".into(),
            archived: true, website_url: None,
        }).collect();
        assert!(validate(&records, &all).is_ok());
        let mut excessive = records;
        excessive.push(Account { id: Uuid::new_v4().to_string(), name: "Extra".into(),
            platform_id: "whatsapp".into(), archived: false, website_url: None });
        assert!(matches!(validate(&excessive, &all), Err("ACCOUNT_LIMIT")));
    }
}
