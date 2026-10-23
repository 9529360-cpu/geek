use crate::{
    application::accounts::Accounts,
    domain::{error::AppError, proxy::ProxyConfig},
    infrastructure::{catalog, dpapi, profiles::account_profile, repository::EncryptedRepository},
};
use std::fs;
use uuid::Uuid;

#[test]
fn legacy_schemas_default_display_without_eager_or_failed_rewrites() {
    for version in [1, 2, 3] {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("accounts.dpapi");
        let id = Uuid::new_v4().to_string();
        let proxy = ProxyConfig::Http {
            host: "127.0.0.1".into(),
            port: 8080,
        };
        let mut legacy = serde_json::json!({"schemaVersion":version, "accounts":[
            {"id":id, "name":"Legacy", "platformId":"whatsapp"}
        ]});
        if version == 3 {
            legacy["accounts"][0]["proxy"] = serde_json::to_value(&proxy).unwrap();
        }
        let ciphertext = dpapi::encrypt(&serde_json::to_vec(&legacy).unwrap()).unwrap();
        fs::write(&file, &ciphertext[..]).unwrap();
        let open = || {
            Accounts::open(
                EncryptedRepository::open(root.path().into()).unwrap(),
                catalog::load().unwrap(),
            )
            .unwrap()
        };
        let mut store = open();
        assert_eq!(store.accounts()[0].id, id);
        assert_eq!(store.accounts()[0].font_size, 16);
        assert_eq!(store.accounts()[0].font_color, "#18A058");
        let route = if version == 3 {
            proxy
        } else {
            ProxyConfig::System
        };
        assert_eq!(store.accounts()[0].proxy, route);
        assert_eq!(fs::read(&file).unwrap(), ciphertext[..]);
        store.update_display(&id, "Legacy", 16, "#18a058").unwrap();
        store.move_account(&id, &id).unwrap();
        assert_eq!(fs::read(&file).unwrap(), ciphertext[..]);
        assert!(matches!(
            store.update_display(&id, "Do not save", 29, "#FFFFFF"),
            Err(AppError::AppearanceInvalid)
        ));
        assert_eq!(fs::read(&file).unwrap(), ciphertext[..]);
        store
            .update_display(&id, "Migrated", 22, "#123abc")
            .unwrap();
        drop(store);
        let decoded: serde_json::Value =
            serde_json::from_slice(&dpapi::decrypt(&fs::read(&file).unwrap()).unwrap()).unwrap();
        assert_eq!(decoded["schemaVersion"], 4);
        assert_eq!(decoded["accounts"][0]["fontSize"], 22);
        assert_eq!(decoded["accounts"][0]["fontColor"], "#123ABC");
        let reopened = open();
        assert_eq!(reopened.accounts()[0].id, id);
        assert_eq!(reopened.accounts()[0].proxy, route);
        assert_eq!(reopened.accounts()[0].name, "Migrated");
        assert_eq!(reopened.accounts()[0].font_size, 22);
        assert_eq!(reopened.accounts()[0].font_color, "#123ABC");
    }
}

#[test]
fn display_and_order_survive_encrypted_restart_without_profile_changes() {
    let root = tempfile::tempdir().unwrap();
    let open = || {
        Accounts::open(
            EncryptedRepository::open(root.path().into()).unwrap(),
            catalog::load().unwrap(),
        )
        .unwrap()
    };
    let mut store = open();
    let ids = store
        .create_batch("Synthetic", "whatsapp", None, ProxyConfig::System, 2)
        .unwrap();
    let paths: Vec<_> = ids
        .iter()
        .map(|id| account_profile(root.path(), id).unwrap())
        .collect();
    for path in &paths {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("synthetic-marker"), b"keep").unwrap();
    }
    store
        .update_display(&ids[1], "Private synthetic label", 24, "#abcdef")
        .unwrap();
    store.move_account(&ids[0], &ids[1]).unwrap();
    let expected = store.accounts().to_vec();
    drop(store);
    let ciphertext = fs::read(root.path().join("accounts.dpapi")).unwrap();
    let label = b"Private synthetic label";
    assert!(!ciphertext.windows(label.len()).any(|bytes| bytes == label));
    let reopened = open();
    assert_eq!(reopened.accounts(), expected);
    assert_eq!(reopened.accounts()[0].id, ids[1]);
    assert_eq!(reopened.accounts()[0].font_color, "#ABCDEF");
    for (id, path) in ids.iter().zip(&paths) {
        assert_eq!(&account_profile(root.path(), id).unwrap(), path);
        assert_eq!(fs::read(path.join("synthetic-marker")).unwrap(), b"keep");
    }
    assert_ne!(paths[0], paths[1]);
}

#[test]
fn failed_legacy_migration_does_not_publish_new_fields_or_destroy_original_bytes() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("accounts.dpapi");
    let backup = root.path().join("synthetic-backup");
    let id = Uuid::new_v4().to_string();
    let legacy = serde_json::json!({"schemaVersion":3, "accounts":[
        {"id":id, "name":"Legacy", "platformId":"whatsapp"}
    ]});
    let ciphertext = dpapi::encrypt(&serde_json::to_vec(&legacy).unwrap()).unwrap();
    fs::write(&file, &ciphertext[..]).unwrap();
    let mut store = Accounts::open(
        EncryptedRepository::open(root.path().into()).unwrap(),
        catalog::load().unwrap(),
    )
    .unwrap();
    let before = store.accounts().to_vec();
    fs::rename(&file, &backup).unwrap();
    fs::create_dir(&file).unwrap();
    assert!(matches!(
        store.update_display(&id, "Must not publish", 24, "#ABCDEF"),
        Err(AppError::StoreIo)
    ));
    assert_eq!(store.accounts(), before);
    assert_eq!(fs::read(&backup).unwrap(), ciphertext[..]);
    fs::remove_dir(&file).unwrap();
    fs::rename(&backup, &file).unwrap();
    drop(store);
    let decoded: serde_json::Value =
        serde_json::from_slice(&dpapi::decrypt(&fs::read(&file).unwrap()).unwrap()).unwrap();
    assert_eq!(decoded["schemaVersion"], 3);
    assert!(decoded["accounts"][0].get("fontSize").is_none());
    let reopened = Accounts::open(
        EncryptedRepository::open(root.path().into()).unwrap(),
        catalog::load().unwrap(),
    )
    .unwrap();
    assert_eq!(reopened.accounts(), before);
}
