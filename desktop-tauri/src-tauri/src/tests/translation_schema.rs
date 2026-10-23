use super::doubles::MemoryRepository;
use crate::{
    application::accounts::Accounts,
    domain::{
        document::Document,
        error::AppError,
        translation::{ChatTranslationPolicy, TranslationPolicy, TranslationSettings},
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

const CHAT: &str = "12025550123@c.us";

fn full_chat_document(version: u32, id: &str) -> Value {
    let mut document = legacy_document(version, id);
    let global = TranslationPolicy {
        include_zh: false,
        route: "backup".into(),
        font_size: 15,
        ..TranslationPolicy::default()
    };
    let chat = TranslationPolicy {
        enabled: true,
        auto_send: true,
        target: "it".into(),
        message_action: false,
        message_target: "es".into(),
        translation_mode: "auto".into(),
        source: "fr".into(),
        provider: "local".into(),
        route: "primary".into(),
        include_zh: true,
        font_size: 11,
        ..TranslationPolicy::default()
    };
    document["accounts"][0]["translation"] = json!({
        "revision": 8, "global": global, "chats": { CHAT: chat }
    });
    document
}

#[test]
fn compatible_full_chat_rows_validate_then_project_without_writing_until_any_mutation_commits() {
    for version in 1..=6 {
        let id = Uuid::new_v4().to_string();
        let value = full_chat_document(version, &id);
        let old: TranslationPolicy =
            serde_json::from_value(value["accounts"][0]["translation"]["chats"][CHAT].clone())
                .unwrap();
        let selected = ChatTranslationPolicy::from_policy(&old);
        let document: Document = serde_json::from_value(value).unwrap();
        let repository = MemoryRepository::default();
        repository.0.lock().unwrap().document = Some(document);
        let mut accounts = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
        let before = accounts.account(&id).unwrap();
        assert_eq!(before.translation.chats[CHAT], selected);
        assert_eq!(before.translation.revision, 8);
        assert!(!before.translation.policy(CHAT).include_zh);
        assert_eq!(before.translation.policy(CHAT).route, "backup");
        assert_eq!(before.translation.policy(CHAT).source, "auto");
        assert_eq!(before.translation.policy(CHAT).target, "it");
        accounts
            .update_translation(&id, Some(CHAT), Some(selected.clone().into()), 8)
            .unwrap();
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

        repository.0.lock().unwrap().fail_save = true;
        assert_eq!(
            accounts.rename(&id, "After migration"),
            Err(AppError::StoreIo)
        );
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
        accounts.rename(&id, "After migration").unwrap();
        let committed =
            serde_json::to_value(repository.0.lock().unwrap().document.as_ref().unwrap()).unwrap();
        assert_eq!(committed["schemaVersion"], 6);
        assert_eq!(committed["accounts"][0]["translation"]["revision"], 8);
        assert_eq!(
            committed["accounts"][0]["translation"]["chats"][CHAT],
            serde_json::to_value(&selected).unwrap()
        );
        assert_eq!(
            committed["accounts"][0]["translation"]["chats"][CHAT]
                .as_object()
                .unwrap()
                .len(),
            7
        );
        assert_eq!(repository.0.lock().unwrap().saves, 1);
        let restored = Accounts::open(repository, catalog::load().unwrap()).unwrap();
        assert_eq!(
            restored.account(&id).unwrap(),
            accounts.account(&id).unwrap()
        );
    }
}

#[test]
fn malformed_legacy_advanced_fields_are_rejected_before_they_can_be_discarded() {
    let id = Uuid::new_v4().to_string();
    let valid = full_chat_document(5, &id);
    for (field, value) in [
        ("provider", json!("custom")),
        ("route", json!("https://unexpected.invalid")),
        ("source", json!("invalid")),
        ("messageFrom", json!("invalid")),
        ("groupAuto", json!("true")),
        ("translateHistory", json!(true)),
        ("includeZh", Value::Null),
        ("fontSize", json!(12)),
        ("fontColor", json!("red")),
        ("unknown", json!(true)),
    ] {
        let mut broken = valid.clone();
        broken["accounts"][0]["translation"]["chats"][CHAT][field] = value;
        assert!(
            serde_json::from_value::<Document>(broken).is_err(),
            "{field}"
        );
    }
    let mut partial = valid;
    partial["accounts"][0]["translation"]["chats"][CHAT]
        .as_object_mut()
        .unwrap()
        .remove("route");
    assert!(serde_json::from_value::<Document>(partial).is_err());
    for version in 1..=6 {
        let mut current = full_chat_document(version, &id);
        let selected = ChatTranslationPolicy::from_policy(&changed_policy());
        current["accounts"][0]["translation"]["chats"][CHAT] =
            serde_json::to_value(selected).unwrap();
        let parsed: Document = serde_json::from_value(current.clone()).unwrap();
        parsed.validate(&catalog::load().unwrap()).unwrap();
        current["accounts"][0]["translation"]["chats"][CHAT]["route"] = json!("backup");
        assert!(serde_json::from_value::<Document>(current).is_err());
    }
}

#[test]
fn schemas_one_through_five_load_translation_defaults_and_only_migrate_after_successful_change() {
    for version in 1..=5 {
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
            .update_translation(&id, None, Some(TranslationPolicy::default().into()), 0)
            .unwrap();
        assert_eq!(repository.0.lock().unwrap().saves, 0);
        repository.0.lock().unwrap().fail_save = true;
        assert!(matches!(
            accounts.update_translation(&id, None, Some(changed_policy().into()), 0),
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
            .update_translation(&id, None, Some(changed_policy().into()), 0)
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
            6
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

    for version in 1..=5 {
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
            .update_translation(&id, None, Some(TranslationPolicy::default().into()), 0)
            .unwrap();
        assert_eq!(fs::read(&path).unwrap(), original[..]);
        accounts
            .update_translation(
                &id,
                Some("12025550123@c.us"),
                Some(ChatTranslationPolicy::from_policy(&changed_policy()).into()),
                0,
            )
            .unwrap();
        let expected = accounts.account(&id).unwrap();
        drop(accounts);
        let saved: Value =
            serde_json::from_slice(&dpapi::decrypt(&fs::read(&path).unwrap()).unwrap()).unwrap();
        assert_eq!(saved["schemaVersion"], 6);
        assert_eq!(saved["accounts"][0]["translation"]["revision"], 1);
        assert_eq!(open().account(&id).unwrap(), expected);
    }
}

#[cfg(windows)]
#[test]
fn encrypted_full_chat_rows_stay_byte_identical_until_an_unrelated_successful_write() {
    use crate::infrastructure::{dpapi, repository::EncryptedRepository};
    use std::fs;

    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("accounts.dpapi");
    let id = Uuid::new_v4().to_string();
    let original =
        dpapi::encrypt(&serde_json::to_vec(&full_chat_document(5, &id)).unwrap()).unwrap();
    fs::write(&path, &original[..]).unwrap();
    let mut accounts = Accounts::open(
        EncryptedRepository::open(root.path().into()).unwrap(),
        catalog::load().unwrap(),
    )
    .unwrap();
    let current = accounts.account(&id).unwrap().translation.chats[CHAT].clone();
    accounts
        .update_translation(&id, Some(CHAT), Some(current.clone().into()), 8)
        .unwrap();
    assert_eq!(fs::read(&path).unwrap(), original[..]);
    accounts.rename(&id, "Unrelated account edit").unwrap();
    let saved: Value =
        serde_json::from_slice(&dpapi::decrypt(&fs::read(&path).unwrap()).unwrap()).unwrap();
    assert_eq!(saved["schemaVersion"], 6);
    assert_eq!(
        saved["accounts"][0]["translation"]["chats"][CHAT],
        serde_json::to_value(current).unwrap()
    );
}
