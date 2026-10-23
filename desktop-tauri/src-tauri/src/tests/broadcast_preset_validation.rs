use super::broadcast_preset_support::{id, Repository};
use crate::{
    application::broadcast_presets::BroadcastPresets,
    domain::{
        broadcast_presets::{
            normalize_preset_name, valid_preset_recipient, validate_preset_message,
            validate_preset_recipients, BroadcastAudiencePreset, BroadcastMessagePreset,
            BroadcastPresetDocument, BroadcastPresetKind, BroadcastPresetSnapshot,
            MAX_PRESET_REVISION, MAX_PRESET_STORE_BYTES,
        },
        error::AppError,
    },
};
use serde_json::json;

fn document() -> BroadcastPresetDocument {
    BroadcastPresetDocument {
        schema_version: 1,
        accounts: vec![BroadcastPresetSnapshot {
            account_id: id(1),
            revision: 1,
            messages: vec![BroadcastMessagePreset {
                id: id(100),
                name: "Original".into(),
                message: "exact body".into(),
            }],
            audiences: vec![BroadcastAudiencePreset {
                id: id(101),
                name: "Frozen selection".into(),
                recipient_ids: vec!["100@c.us".into(), "200-300@g.us".into()],
            }],
        }],
    }
}

#[test]
fn names_use_utf16_bounds_and_bodies_keep_broadcast_text_rules_without_trimming() {
    assert_eq!(normalize_preset_name("  Original  ").unwrap(), "Original");
    assert_eq!(
        normalize_preset_name(&"😀".repeat(40)).unwrap(),
        "😀".repeat(40)
    );
    for invalid in [
        "".into(),
        "  ".into(),
        "a\tb".into(),
        "a\u{85}b".into(),
        "a".repeat(81),
        format!("{}a", "😀".repeat(40)),
    ] {
        assert!(matches!(
            normalize_preset_name(&invalid),
            Err(AppError::BroadcastPresetInvalid)
        ));
    }
    for valid in ["hello", " \nbody\t\r\n ", "%nc {one|two}"] {
        assert!(validate_preset_message(valid).is_ok());
    }
    assert!(validate_preset_message(&"😀".repeat(5000)).is_ok());
    for invalid in [
        "".into(),
        " \t\r\n ".into(),
        "nul\0".into(),
        "delete\u{7f}".into(),
        "a".repeat(10_001),
        "😀".repeat(5001),
    ] {
        assert!(matches!(
            validate_preset_message(&invalid),
            Err(AppError::BroadcastPresetInvalid)
        ));
    }
}

#[test]
fn audiences_accept_only_complete_unique_canonical_contact_and_group_ids() {
    for valid in [
        "1@c.us".into(),
        "2@lid".into(),
        "3@g.us".into(),
        "123-456@g.us".into(),
        format!("{}@lid", "1".repeat(30)),
        format!("{}-{}@g.us", "1".repeat(30), "2".repeat(20)),
    ] {
        assert!(valid_preset_recipient(&valid));
    }
    for invalid in [
        "".into(),
        "123456".into(),
        "1-2@c.us".into(),
        "1-2@lid".into(),
        "-1@g.us".into(),
        "1-@g.us".into(),
        "1-2-3@g.us".into(),
        "1@s.whatsapp.net".into(),
        "status@broadcast".into(),
        "1@newsletter".into(),
        "1@c.us ".into(),
        "1@c.us@lid".into(),
        "１２３@c.us".into(),
        format!("{}@c.us", "1".repeat(31)),
        format!("1-{}@g.us", "1".repeat(21)),
    ] {
        assert!(!valid_preset_recipient(&invalid));
    }
    assert!(validate_preset_recipients(&[]).is_err());
    assert!(validate_preset_recipients(&["1@c.us".into(), "1@c.us".into()]).is_err());
    let mut exact: Vec<_> = (1..=2000).map(|value| format!("{value}@c.us")).collect();
    assert!(validate_preset_recipients(&exact).is_ok());
    exact.push("2001@c.us".into());
    assert!(matches!(
        validate_preset_recipients(&exact),
        Err(AppError::BroadcastPresetLimit)
    ));
}

#[test]
fn every_persisted_level_rejects_unknown_or_missing_fields_and_kinds_are_closed() {
    let value = serde_json::to_value(document()).unwrap();
    assert!(serde_json::from_value::<BroadcastPresetDocument>(value.clone()).is_ok());
    for pointer in [
        "",
        "/accounts/0",
        "/accounts/0/messages/0",
        "/accounts/0/audiences/0",
    ] {
        let mut unknown = value.clone();
        unknown
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), json!(true));
        assert!(serde_json::from_value::<BroadcastPresetDocument>(unknown).is_err());
    }
    for (pointer, key) in [
        ("", "schemaVersion"),
        ("", "accounts"),
        ("/accounts/0", "revision"),
        ("/accounts/0", "audiences"),
        ("/accounts/0/messages/0", "message"),
        ("/accounts/0/audiences/0", "recipientIds"),
    ] {
        let mut missing = value.clone();
        missing
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(serde_json::from_value::<BroadcastPresetDocument>(missing).is_err());
    }
    assert!(serde_json::from_value::<BroadcastPresetKind>(json!("message")).is_ok());
    assert!(serde_json::from_value::<BroadcastPresetKind>(json!("audience")).is_ok());
    for invalid in [
        json!("all"),
        json!("Message"),
        json!({"kind":"message"}),
        json!(null),
    ] {
        assert!(serde_json::from_value::<BroadcastPresetKind>(invalid).is_err());
    }
}

#[test]
fn corrupt_semantics_never_become_an_open_owner_or_trigger_an_eager_rewrite() {
    let mut invalid = Vec::new();
    for schema in [0, 2, u32::MAX] {
        let mut candidate = document();
        candidate.schema_version = schema;
        invalid.push(candidate);
    }
    for revision in [0, MAX_PRESET_REVISION + 1] {
        let mut candidate = document();
        candidate.accounts[0].revision = revision;
        invalid.push(candidate);
    }
    let mut duplicate = document();
    duplicate.accounts.push(duplicate.accounts[0].clone());
    invalid.push(duplicate);
    let mut duplicate = document();
    duplicate.accounts[0].audiences[0].id = duplicate.accounts[0].messages[0].id.clone();
    invalid.push(duplicate);
    let mut duplicate_name = document();
    let mut other = duplicate_name.accounts[0].messages[0].clone();
    other.id = id(102);
    duplicate_name.accounts[0].messages.push(other);
    invalid.push(duplicate_name);
    let mut untrimmed = document();
    untrimmed.accounts[0].messages[0].name = " Original ".into();
    invalid.push(untrimmed);
    let mut bad_id = document();
    bad_id.accounts[0].messages[0].id = "not-a-native-id".into();
    invalid.push(bad_id);
    let mut bad_recipient = document();
    bad_recipient.accounts[0].audiences[0].recipient_ids = vec!["tg:0123".into()];
    invalid.push(bad_recipient);
    for candidate in invalid {
        let repository = Repository::default();
        repository.0.lock().unwrap().document = Some(candidate.clone());
        assert!(matches!(
            BroadcastPresets::open(repository.clone()),
            Err(AppError::BroadcastPresetInvalid)
        ));
        assert_eq!(repository.0.lock().unwrap().saves, 0);
        assert!(repository.0.lock().unwrap().document.as_ref().unwrap() == &candidate);
    }
}

#[test]
fn canonical_telegram_saved_peers_round_trip_as_hints_without_eager_writes() {
    let repository = Repository::default();
    let mut saved = document();
    saved.accounts[0].audiences[0].recipient_ids = vec!["tg:123".into(), "tg:-456".into()];
    repository.0.lock().unwrap().document = Some(saved.clone());
    let owner = BroadcastPresets::open(repository.clone()).unwrap();
    let snapshot = owner.snapshot(&saved.accounts[0].account_id).unwrap();
    assert_eq!(
        snapshot.audiences[0].recipient_ids,
        saved.accounts[0].audiences[0].recipient_ids
    );
    assert_eq!(repository.0.lock().unwrap().saves, 0);
}

#[test]
fn collection_and_account_bounds_apply_to_loaded_documents_without_partial_salvage() {
    let mut invalid = Vec::new();
    let mut too_many_accounts = BroadcastPresetDocument::default();
    for index in 1..=21 {
        let mut account = BroadcastPresetSnapshot::empty(&id(index));
        account.revision = 1;
        too_many_accounts.accounts.push(account);
    }
    invalid.push(too_many_accounts);
    let mut messages = document();
    messages.accounts[0].messages = (1000..1101)
        .map(|index| BroadcastMessagePreset {
            id: id(index),
            name: index.to_string(),
            message: "body".into(),
        })
        .collect();
    invalid.push(messages);
    let mut audiences = document();
    audiences.accounts[0].audiences = (1000..1101)
        .map(|index| BroadcastAudiencePreset {
            id: id(index),
            name: "same name is allowed".into(),
            recipient_ids: vec!["100@c.us".into()],
        })
        .collect();
    invalid.push(audiences);
    for candidate in invalid {
        let repository = Repository::default();
        repository.0.lock().unwrap().document = Some(candidate);
        assert!(matches!(
            BroadcastPresets::open(repository.clone()),
            Err(AppError::BroadcastPresetLimit)
        ));
        assert_eq!(repository.0.lock().unwrap().saves, 0);
    }
}

#[test]
fn the_complete_plaintext_limit_is_exact_and_a_larger_candidate_does_not_replace_authority() {
    let mut document = BroadcastPresetDocument::default();
    for account_index in 0..3 {
        let mut account = BroadcastPresetSnapshot::empty(&id(account_index + 1));
        account.revision = 1;
        let count = if account_index < 2 { 100 } else { 8 };
        account.messages = (0..count)
            .map(|index| BroadcastMessagePreset {
                id: id(1000 + account_index * 100 + index),
                name: format!("message {index}"),
                message: "x".repeat(10_000),
            })
            .collect();
        document.accounts.push(account);
    }
    let excess = serde_json::to_vec(&document).unwrap().len() - MAX_PRESET_STORE_BYTES;
    assert!((1..10_000).contains(&excess));
    let last = document.accounts[2].messages.last_mut().unwrap();
    last.message.truncate(10_000 - excess);
    let name = last.name.clone();
    let over_limit_body = format!("{}x", last.message);
    assert_eq!(
        serde_json::to_vec(&document).unwrap().len(),
        MAX_PRESET_STORE_BYTES
    );
    assert!(document.validate().is_ok());
    let repository = Repository::default();
    repository.0.lock().unwrap().document = Some(document.clone());
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    assert!(matches!(
        owner.save_message(&id(3), 1, &name, &over_limit_body),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert!(owner.snapshot(&id(3)).unwrap() == document.accounts[2]);
    assert!(repository.0.lock().unwrap().document.as_ref().unwrap() == &document);
    assert_eq!(repository.0.lock().unwrap().saves, 0);
}
