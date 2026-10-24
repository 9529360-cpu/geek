use super::broadcast_preset_support::{id, Repository};
use crate::{
    application::broadcast_presets::BroadcastPresets,
    domain::{
        account::{valid_id, MAX_ACCOUNTS},
        broadcast_presets::{
            BroadcastMessagePreset, BroadcastPresetDocument, BroadcastPresetKind,
            BroadcastPresetSnapshot, MAX_PRESET_REVISION,
        },
        error::AppError,
    },
};

#[test]
fn opening_and_reading_empty_accounts_never_persist_or_allocate_account_slots() {
    let repository = Repository::default();
    let owner = BroadcastPresets::open(repository.clone()).unwrap();
    for index in 1..=MAX_ACCOUNTS + 1 {
        let snapshot = owner.snapshot(&id(index as u64)).unwrap();
        assert_eq!(snapshot.account_id, id(index as u64));
        assert_eq!(snapshot.revision, 0);
        assert!(snapshot.messages.is_empty() && snapshot.audiences.is_empty());
    }
    for invalid in [
        "",
        "account-a",
        "../account",
        "00000000-0000-1000-8000-000000000001",
    ] {
        assert!(matches!(
            owner.snapshot(invalid),
            Err(AppError::BroadcastPresetInvalid)
        ));
    }
    assert_eq!(repository.0.lock().unwrap().saves, 0);
    assert!(repository.0.lock().unwrap().document.is_none());
}

#[test]
fn same_name_message_overwrite_keeps_identity_position_and_exact_body_with_noop_saves() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let first = owner
        .save_message(&id(1), 0, "  Greeting  ", "first")
        .unwrap();
    let second = owner.save_message(&id(1), 1, "Other", "neighbor").unwrap();
    let body = " \nHello %nc\t{one|two}\r\n ";
    let replaced = owner.save_message(&id(1), 2, " Greeting ", body).unwrap();
    assert_eq!(replaced.revision, 3);
    assert_eq!(replaced.messages.len(), 2);
    assert!(valid_id(&first.messages[0].id));
    assert_eq!(replaced.messages[0].id, first.messages[0].id);
    assert_eq!(replaced.messages[0].name, "Greeting");
    assert_eq!(replaced.messages[0].message, body);
    assert!(replaced.messages[1] == second.messages[1]);
    let noop = owner.save_message(&id(1), 3, "  Greeting  ", body).unwrap();
    assert!(noop == replaced);
    assert_eq!(repository.0.lock().unwrap().saves, 3);
}

#[test]
fn audience_names_can_repeat_and_each_entry_keeps_an_independent_frozen_ordered_list() {
    let mut owner = BroadcastPresets::open(Repository::default()).unwrap();
    let ids = vec!["100@c.us".into(), "200-300@g.us".into(), "400@lid".into()];
    let first = owner
        .save_audience(&id(1), 0, "  Customers ", ids.clone())
        .unwrap();
    let second = owner
        .save_audience(&id(1), 1, "Customers", ids.clone())
        .unwrap();
    assert_eq!(second.audiences.len(), 2);
    assert_ne!(second.audiences[0].id, second.audiences[1].id);
    assert!(second.audiences[0] == first.audiences[0]);
    assert_eq!(second.audiences[0].name, "Customers");
    let mut restored = owner.audience(&id(1), 2, &first.audiences[0].id).unwrap();
    assert_eq!(restored.recipient_ids, ids);
    restored.recipient_ids.reverse();
    restored.name = "only the caller's copy".into();
    assert!(owner.audience(&id(1), 2, &first.audiences[0].id).unwrap() == first.audiences[0]);
}

#[test]
fn revisions_and_id_lookups_are_account_owned_and_stale_actions_do_not_write() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let a = owner
        .save_audience(&id(1), 0, "A", vec!["100@c.us".into()])
        .unwrap();
    let b = owner
        .save_audience(&id(2), 0, "B", vec!["200@g.us".into()])
        .unwrap();
    assert_eq!(a.revision, b.revision);
    assert!(owner.snapshot(&id(1)).unwrap() == a);
    assert!(matches!(
        owner.audience(&id(2), 1, &a.audiences[0].id),
        Err(AppError::BroadcastPresetUnknown)
    ));
    assert!(matches!(
        owner.delete(&id(2), 1, BroadcastPresetKind::Audience, &a.audiences[0].id),
        Err(AppError::BroadcastPresetUnknown)
    ));
    assert!(matches!(
        owner.audience(&id(1), 0, &a.audiences[0].id),
        Err(AppError::BroadcastPresetConflict)
    ));
    assert!(matches!(
        owner.save_message(&id(1), 0, "stale", "body"),
        Err(AppError::BroadcastPresetConflict)
    ));
    assert!(matches!(
        owner.save_audience(&id(1), 2, "future", vec!["100@c.us".into()]),
        Err(AppError::BroadcastPresetConflict)
    ));
    assert!(matches!(
        owner.delete(&id(1), 0, BroadcastPresetKind::Audience, &a.audiences[0].id),
        Err(AppError::BroadcastPresetConflict)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == a);
    assert!(owner.snapshot(&id(2)).unwrap() == b);
    assert_eq!(repository.0.lock().unwrap().saves, 2);
}

#[test]
fn every_failed_mutation_preserves_memory_revision_and_durable_document() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    owner
        .save_message(&id(1), 0, "Original", "original body")
        .unwrap();
    let before = owner
        .save_audience(&id(1), 1, "Original", vec!["100@c.us".into()])
        .unwrap();
    let durable = repository.0.lock().unwrap().document.clone();
    repository.0.lock().unwrap().fail = true;
    for result in [
        owner.save_message(&id(1), 2, "Original", "replacement"),
        owner.save_message(&id(1), 2, "New", "new body"),
        owner.save_audience(&id(1), 2, "New", vec!["200@lid".into()]),
        owner.delete(
            &id(1),
            2,
            BroadcastPresetKind::Message,
            &before.messages[0].id,
        ),
        owner.delete(
            &id(1),
            2,
            BroadcastPresetKind::Audience,
            &before.audiences[0].id,
        ),
    ] {
        assert!(matches!(result, Err(AppError::BroadcastPresetPersistence)));
        assert!(owner.snapshot(&id(1)).unwrap() == before);
        assert!(repository.0.lock().unwrap().document == durable);
    }
    repository.0.lock().unwrap().fail = false;
    let saved = owner
        .save_message(&id(1), 2, "Original", "replacement")
        .unwrap();
    assert_eq!(saved.revision, 3);
    assert_eq!(saved.messages[0].id, before.messages[0].id);
    assert!(saved.audiences == before.audiences);
}

#[test]
fn deleting_the_last_entry_retains_revision_across_restart_and_requires_the_exact_kind() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let saved = owner.save_message(&id(1), 0, "one", "body").unwrap();
    let preset_id = &saved.messages[0].id;
    assert!(matches!(
        owner.delete(&id(1), 1, BroadcastPresetKind::Audience, preset_id),
        Err(AppError::BroadcastPresetUnknown)
    ));
    let empty = owner
        .delete(&id(1), 1, BroadcastPresetKind::Message, preset_id)
        .unwrap();
    assert_eq!(empty.revision, 2);
    assert!(empty.messages.is_empty() && empty.audiences.is_empty());
    drop(owner);
    let mut reopened = BroadcastPresets::open(repository).unwrap();
    assert!(reopened.snapshot(&id(1)).unwrap() == empty);
    assert!(matches!(
        reopened.save_message(&id(1), 0, "stale draft", "body"),
        Err(AppError::BroadcastPresetConflict)
    ));
}

#[test]
fn collection_limits_are_independent_and_existing_message_overwrite_remains_available() {
    let mut owner = BroadcastPresets::open(Repository::default()).unwrap();
    for index in 0..100 {
        owner
            .save_message(&id(1), index, &format!("m{index}"), "body")
            .unwrap();
    }
    let full = owner.snapshot(&id(1)).unwrap();
    assert!(matches!(
        owner.save_message(&id(1), 100, "overflow", "body"),
        Err(AppError::BroadcastPresetLimit)
    ));
    let replaced = owner.save_message(&id(1), 100, "m0", "changed").unwrap();
    assert_eq!(replaced.messages[0].id, full.messages[0].id);
    for index in 0..100 {
        owner
            .save_audience(&id(1), 101 + index, "same name", vec!["100@c.us".into()])
            .unwrap();
    }
    let both_full = owner.snapshot(&id(1)).unwrap();
    assert_eq!(both_full.messages.len(), 100);
    assert_eq!(both_full.audiences.len(), 100);
    assert!(matches!(
        owner.save_audience(&id(1), 201, "same name", vec!["100@c.us".into()]),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == both_full);
}

#[test]
fn the_account_limit_is_durable_and_cannot_be_freed_by_resetting_an_empty_revision() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    for index in 1..=MAX_ACCOUNTS {
        owner
            .save_message(&id(index as u64), 0, "one", "body")
            .unwrap();
    }
    let first = owner.snapshot(&id(1)).unwrap();
    owner
        .delete(
            &id(1),
            1,
            BroadcastPresetKind::Message,
            &first.messages[0].id,
        )
        .unwrap();
    assert!(matches!(
        owner.save_message(&id(21), 0, "overflow", "body"),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert_eq!(
        repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .accounts
            .len(),
        20
    );
}

#[test]
fn revision_exhaustion_rejects_mutations_without_disabling_safe_reads_or_exact_noops() {
    let repository = Repository::default();
    let mut account = BroadcastPresetSnapshot::empty(&id(1));
    account.revision = MAX_PRESET_REVISION;
    account.messages.push(BroadcastMessagePreset {
        id: id(100),
        name: "one".into(),
        message: "body".into(),
    });
    repository.0.lock().unwrap().document = Some(BroadcastPresetDocument {
        accounts: vec![account.clone()],
        ..Default::default()
    });
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    assert!(
        owner
            .save_message(&id(1), MAX_PRESET_REVISION, "one", "body")
            .unwrap()
            == account
    );
    assert!(matches!(
        owner.save_message(&id(1), MAX_PRESET_REVISION, "one", "changed"),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert!(matches!(
        owner.delete(
            &id(1),
            MAX_PRESET_REVISION,
            BroadcastPresetKind::Message,
            &id(100)
        ),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert!(matches!(
        owner.save_message(&id(1), MAX_PRESET_REVISION + 1, "one", "body"),
        Err(AppError::BroadcastPresetInvalid)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == account);
    assert_eq!(repository.0.lock().unwrap().saves, 0);
}
