use super::doubles::MemoryRepository;
use crate::{
    application::accounts::Accounts,
    domain::{
        document::Document,
        error::AppError,
        translation::{TranslationPolicy, TranslationSettings},
    },
    infrastructure::catalog,
};
use serde_json::{json, Value};
use uuid::Uuid;

fn legacy_document(version: u32, id: &str) -> Value {
    let mut document = json!({ "schemaVersion": version, "accounts": [
        { "id": id, "name": "Legacy synthetic", "platformId": "whatsapp" }
    ]});
    if version >= 2 {
        document["settings"] = json!({ "closeToTray": true });
    }
    if version >= 3 {
        document["accounts"][0]["proxy"] =
            json!({ "mode": "http", "host": "127.0.0.1", "port": 8080 });
    }
    if version >= 4 {
        document["accounts"][0]["fontSize"] = json!(24);
        document["accounts"][0]["fontColor"] = json!("#AABBCC");
    }
    document
}

fn changed_policy() -> TranslationPolicy {
    TranslationPolicy {
        message_target: "it".into(),
        translation_mode: "auto".into(),
        ..TranslationPolicy::default()
    }
}

#[test]
fn schemas_one_through_four_load_translation_defaults_and_only_migrate_after_successful_change() {
    for version in 1..=4 {
        let id = Uuid::new_v4().to_string();
        let document: Document = serde_json::from_value(legacy_document(version, &id)).unwrap();
        let repository = MemoryRepository::default();
        repository.0.lock().unwrap().document = Some(document);
        let mut accounts = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
        let before = accounts.account(&id).unwrap();
        assert_eq!(before.translation, TranslationSettings::default());
        assert_eq!(accounts.settings().close_to_tray, version >= 2);
        assert_eq!(repository.0.lock().unwrap().saves, 0);
        assert_eq!(
            repository
                .0
                .lock()
                .unwrap()
                .document
                .as_ref()
                .unwrap()
                .schema_version,
            version
        );
        accounts
            .update_translation(&id, None, Some(TranslationPolicy::default()), 0)
            .unwrap();
        assert_eq!(repository.0.lock().unwrap().saves, 0);
        repository.0.lock().unwrap().fail_save = true;
        assert!(matches!(
            accounts.update_translation(&id, None, Some(changed_policy()), 0),
            Err(AppError::StoreIo)
        ));
        assert_eq!(accounts.account(&id).unwrap(), before);
        assert_eq!(
            repository
                .0
                .lock()
                .unwrap()
                .document
                .as_ref()
                .unwrap()
                .schema_version,
            version
        );
        repository.0.lock().unwrap().fail_save = false;
        accounts
            .update_translation(&id, None, Some(changed_policy()), 0)
            .unwrap();
        let mut expected = before;
        expected.translation.global = changed_policy();
        expected.translation.revision = 1;
        assert_eq!(accounts.account(&id).unwrap(), expected);
        assert_eq!(
            repository
                .0
                .lock()
                .unwrap()
                .document
                .as_ref()
                .unwrap()
                .schema_version,
            5
        );
        assert_eq!(repository.0.lock().unwrap().saves, 1);
        let reopened = Accounts::open(repository, catalog::load().unwrap()).unwrap();
        assert_eq!(reopened.account(&id).unwrap(), expected);
    }
}

#[cfg(windows)]
#[test]
fn encrypted_legacy_translation_reads_preserve_original_bytes_until_a_real_edit() {
    use crate::infrastructure::{dpapi, repository::EncryptedRepository};
    use std::fs;

    for version in 1..=4 {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("accounts.dpapi");
        let id = Uuid::new_v4().to_string();
        let original =
            dpapi::encrypt(&serde_json::to_vec(&legacy_document(version, &id)).unwrap()).unwrap();
        fs::write(&path, &original[..]).unwrap();
        let open = || {
            Accounts::open(
                EncryptedRepository::open(root.path().into()).unwrap(),
                catalog::load().unwrap(),
            )
            .unwrap()
        };
        let mut accounts = open();
        assert_eq!(
            accounts.account(&id).unwrap().translation,
            TranslationSettings::default()
        );
        accounts
            .update_translation(&id, None, Some(TranslationPolicy::default()), 0)
            .unwrap();
        assert_eq!(fs::read(&path).unwrap(), original[..]);
        accounts
            .update_translation(&id, Some("12025550123@c.us"), Some(changed_policy()), 0)
            .unwrap();
        let expected = accounts.account(&id).unwrap();
        drop(accounts);
        let saved: Value =
            serde_json::from_slice(&dpapi::decrypt(&fs::read(&path).unwrap()).unwrap()).unwrap();
        assert_eq!(saved["schemaVersion"], 5);
        assert_eq!(saved["accounts"][0]["translation"]["revision"], 1);
        assert_eq!(open().account(&id).unwrap(), expected);
    }
}
