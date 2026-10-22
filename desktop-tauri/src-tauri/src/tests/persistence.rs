use std::{fs, path::{Path, PathBuf}};
use uuid::Uuid;
use crate::{
    application::accounts::Accounts,
    domain::{account::{Account, Settings, MAX_ACCOUNTS}, document::validate_accounts as validate, error::{AppError, Result}},
    infrastructure::{catalog::load as catalog, dpapi, profiles::account_profile, repository::EncryptedRepository},
};

type Store = Accounts<EncryptedRepository>;

fn open_store(root: PathBuf) -> Result<Store> {
    Store::open(EncryptedRepository::open(root)?, catalog()?)
}

fn profile_for(root: &Path, store: &Store, id: &str) -> Result<PathBuf> {
    store.account(id)?;
    account_profile(root, id)
}

#[test]
fn restart_roundtrip_encryption_and_distinct_profiles() {
    let root = tempfile::tempdir().unwrap();
    let mut store = open_store(root.path().to_path_buf()).unwrap();
    store.create("Synthetic A", "whatsapp", None).unwrap();
    store.create("Synthetic B", "whatsapp", None).unwrap();
    let accounts = store.accounts().to_vec();
    assert_ne!(profile_for(root.path(), &store, &accounts[0].id).unwrap(), profile_for(root.path(), &store, &accounts[1].id).unwrap());
    assert!(profile_for(root.path(), &store, "../shell").is_err());
    let ciphertext = fs::read(root.path().join("accounts.dpapi")).unwrap();
    assert!(!ciphertext.windows(11).any(|w| w == b"Synthetic A"));
    drop(store);
    assert_eq!(open_store(root.path().to_path_buf()).unwrap().accounts(), accounts);
}

#[test]
fn rename_archive_restore_preserve_identity_and_profile() {
    let root = tempfile::tempdir().unwrap();
    let mut store = open_store(root.path().to_path_buf()).unwrap();
    store.create("Synthetic A", "telegram-k", None).unwrap();
    store.create("Synthetic B", "telegram-k", None).unwrap();
    let id = store.accounts()[0].id.clone();
    let other = store.accounts()[1].clone();
    let profile = profile_for(root.path(), &store, &id).unwrap();
    fs::create_dir_all(&profile).unwrap();
    fs::write(profile.join("synthetic-marker"), b"keep").unwrap();
    store.rename(&id, " Renamed ").unwrap();
    store.set_archived(&id, true).unwrap();
    assert!(matches!(store.openable_account(&id), Err(AppError::AccountArchived)));
    store.set_settings(Settings { close_to_tray: true }).unwrap();
    drop(store);
    let mut reopened = open_store(root.path().to_path_buf()).unwrap();
    assert!(reopened.settings().close_to_tray);
    assert!(reopened.account(&id).unwrap().archived);
    reopened.set_archived(&id, false).unwrap();
    assert_eq!(reopened.openable_account(&id).unwrap().name, "Renamed");
    assert_eq!(profile_for(root.path(), &reopened, &id).unwrap(), profile);
    assert_eq!(fs::read(profile.join("synthetic-marker")).unwrap(), b"keep");
    assert_eq!(reopened.accounts()[1], other);
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
    let mut store = open_store(root.path().to_path_buf()).unwrap();
    assert_eq!(fs::read(&file).unwrap(), encrypted[..]);
    assert_eq!(store.accounts()[0].id, id);
    assert!(!store.accounts()[0].archived);
    assert!(!store.settings().close_to_tray);
    store.rename(&id, "Updated").unwrap();
    let doc: serde_json::Value = serde_json::from_slice(&dpapi::decrypt(&fs::read(file).unwrap()).unwrap()).unwrap();
    assert_eq!(doc["schemaVersion"], 2);
}

#[test]
fn website_entry_is_persisted_and_account_owned() {
    let root = tempfile::tempdir().unwrap();
    let mut store = open_store(root.path().to_path_buf()).unwrap();
    assert!(store.create("Bad", "website", Some("https://example.com/?token=synthetic")).is_err());
    assert!(store.accounts().is_empty());
    store.create("Site A", "website", Some("https://EXAMPLE.com/inbox")).unwrap();
    store.create("Site B", "website", Some("https://other.example.com/")).unwrap();
    let accounts = store.accounts().to_vec();
    assert_eq!(accounts[0].website_url.as_deref(), Some("https://example.com/inbox"));
    drop(store);
    assert_eq!(open_store(root.path().to_path_buf()).unwrap().accounts(), accounts);
}

#[test]
fn duplicate_process_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let first = open_store(root.path().to_path_buf()).unwrap();
    assert!(matches!(open_store(root.path().to_path_buf()), Err(AppError::ProfileInUse)));
    drop(first);
    assert!(open_store(root.path().to_path_buf()).is_ok());
}

#[test]
fn damaged_and_future_stores_are_never_reset() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("accounts.dpapi");
    fs::write(&path, b"corrupt").unwrap();
    assert!(open_store(root.path().to_path_buf()).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"corrupt");
    let future = dpapi::encrypt(br#"{"schemaVersion":99,"accounts":[]}"#).unwrap();
    fs::write(&path, &future[..]).unwrap();
    assert!(matches!(open_store(root.path().to_path_buf()), Err(AppError::StoreVersion)));
    assert_eq!(fs::read(path).unwrap(), future[..]);
}

#[test]
fn persistence_failure_never_publishes_any_mutation() {
    let root = tempfile::tempdir().unwrap();
    let mut store = open_store(root.path().to_path_buf()).unwrap();
    store.create("Original", "whatsapp", None).unwrap();
    let before = store.accounts().to_vec();
    let id = before[0].id.clone();
    let file = root.path().join("accounts.dpapi");
    let backup = root.path().join("synthetic-backup");
    fs::rename(&file, &backup).unwrap();
    fs::create_dir(&file).unwrap();
    assert!(store.create("Second", "whatsapp", None).is_err());
    assert!(store.rename(&id, "Changed").is_err());
    assert!(store.set_archived(&id, true).is_err());
    assert!(store.set_settings(Settings { close_to_tray: true }).is_err());
    assert_eq!(store.accounts(), before);
    assert_eq!(store.settings(), &Settings::default());
    fs::remove_dir(&file).unwrap();
    fs::rename(backup, &file).unwrap();
    drop(store);
    assert_eq!(open_store(root.path().to_path_buf()).unwrap().accounts(), before);
}

#[test]
fn malformed_duplicate_and_unknown_records_fail_closed() {
    let root = tempfile::tempdir().unwrap();
    let mut store = open_store(root.path().to_path_buf()).unwrap();
    store.create("A", "whatsapp", None).unwrap();
    let a = store.accounts()[0].clone();
    assert!(validate(&[a.clone(), a.clone()], store.platforms()).is_err());
    let mut bad = a;
    bad.id = "../other-account".into();
    assert!(validate(&[bad], store.platforms()).is_err());
    assert!(store.rename(&Uuid::new_v4().to_string(), "Unknown").is_err());
    assert!(store.set_archived("../shell", true).is_err());
    let before = store.accounts().to_vec();
    for name in ["", "\n", "bad\nname"] { assert!(store.rename(&before[0].id, name).is_err()); }
    assert_eq!(store.accounts(), before);
}

#[test]
fn archived_accounts_cannot_bypass_the_limit() {
    let all = catalog().unwrap();
    let records: Vec<_> = (0..MAX_ACCOUNTS).map(|_| Account {
        id: Uuid::new_v4().to_string(), name: "Synthetic".into(), platform_id: "whatsapp".into(),
        archived: true, website_url: None,
    }).collect();
    assert!(validate(&records, &all).is_ok());
    let mut excessive = records;
    excessive.push(Account { id: Uuid::new_v4().to_string(), name: "Extra".into(),
        platform_id: "whatsapp".into(), archived: false, website_url: None });
    assert!(matches!(validate(&excessive, &all), Err(AppError::AccountLimit)));
}
