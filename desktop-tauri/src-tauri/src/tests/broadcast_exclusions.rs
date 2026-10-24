use super::broadcast_preset_support::{id, Repository};
use crate::{
    application::broadcast_presets::BroadcastPresets,
    domain::{
        broadcast_presets::{
            exclusion_kind, validate_exclusion_ids, validate_exclusions_for_platform,
            BroadcastMessagePreset, BroadcastPresetDocument, BroadcastPresetSnapshot,
            ExclusionKind, MAX_PRESET_REVISION, MAX_PRESET_STORE_BYTES,
        },
        error::AppError,
    },
};
use serde_json::json;
use std::sync::{Arc, Barrier, Mutex};

fn ids(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn deny_lists_are_strict_bounded_kind_and_platform_scoped_but_need_no_catalog() {
    for (platform, contacts, groups) in [
        (
            "whatsapp",
            ids(&["12@c.us", "34@lid"]),
            ids(&["56@g.us", "78-90@g.us"]),
        ),
        ("whatsapp-pure", ids(&["12@c.us"]), ids(&["56@g.us"])),
        (
            "telegram-k",
            ids(&["tg:12", "tg:9007199254740991"]),
            ids(&["tg:-56"]),
        ),
    ] {
        assert!(validate_exclusions_for_platform(platform, &contacts, &groups).is_ok());
        assert!(validate_exclusions_for_platform(platform, &groups, &contacts).is_err());
    }
    assert!(validate_exclusions_for_platform("whatsapp", &ids(&["tg:12"]), &[]).is_err());
    assert!(validate_exclusions_for_platform("telegram-k", &[], &ids(&["12@g.us"])).is_err());
    for invalid in [
        "12",
        "tg:0",
        "tg:01",
        "tg:-0",
        "tg:+1",
        "tg:9007199254740992",
        "tg:-9007199254740992",
        "12@s.whatsapp.net",
        "12-34@c.us",
        "12-34-56@g.us",
        " 12@c.us",
        "12@c.us\n",
        "１２@c.us",
        "12@newsletter",
        "status@broadcast",
    ] {
        assert_eq!(exclusion_kind(invalid), None, "{invalid:?}");
    }
    assert!(validate_exclusion_ids(&[], ExclusionKind::Contact).is_ok());
    assert_eq!(
        validate_exclusion_ids(&ids(&["12@c.us", "12@c.us"]), ExclusionKind::Contact),
        Err(AppError::BroadcastPresetInvalid)
    );
    let maximum: Vec<String> = (1..=2000).map(|index| format!("{index}@c.us")).collect();
    assert!(validate_exclusion_ids(&maximum, ExclusionKind::Contact).is_ok());
    let mut excessive = maximum;
    excessive.push("2001@c.us".into());
    assert_eq!(
        validate_exclusion_ids(&excessive, ExclusionKind::Contact),
        Err(AppError::BroadcastPresetLimit)
    );
}

#[test]
fn save_restart_clear_and_noop_preserve_other_presets_accounts_and_revision() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    owner.save_message(&id(1), 0, "Greeting", "Hello").unwrap();
    owner
        .save_audience(&id(1), 1, "Audience", ids(&["12@c.us"]))
        .unwrap();
    let neighbor = owner
        .save_exclusions(&id(2), 0, ids(&["tg:42"]), ids(&["tg:-56"]))
        .unwrap();
    let before = owner.snapshot(&id(1)).unwrap();
    let saved = owner
        .save_exclusions(&id(1), 2, ids(&["98@c.us", "76@lid"]), ids(&["54@g.us"]))
        .unwrap();
    assert_eq!(saved.revision, 3);
    assert!(saved.messages == before.messages && saved.audiences == before.audiences);
    assert!(owner.snapshot(&id(2)).unwrap() == neighbor);
    let disk = repository.0.lock().unwrap();
    assert_eq!(disk.document.as_ref().unwrap().schema_version, 2);
    let saves = disk.saves;
    drop(disk);
    assert!(
        owner
            .save_exclusions(
                &id(1),
                3,
                saved.excluded_contact_ids.clone(),
                saved.excluded_group_ids.clone()
            )
            .unwrap()
            == saved
    );
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    let mut reopened = BroadcastPresets::open(repository.clone()).unwrap();
    assert!(reopened.snapshot(&id(1)).unwrap() == saved);
    let cleared = reopened
        .save_exclusions(&id(1), 3, Vec::new(), Vec::new())
        .unwrap();
    assert_eq!(cleared.revision, 4);
    assert!(cleared.excluded_contact_ids.is_empty() && cleared.excluded_group_ids.is_empty());
    assert!(cleared.messages == before.messages && cleared.audiences == before.audiences);
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
    assert!(matches!(
        reopened.save_exclusions(&id(1), 3, Vec::new(), Vec::new()),
        Err(AppError::BroadcastPresetConflict)
    ));
}

#[test]
fn failed_persistence_and_invalid_replacements_never_publish_new_denials() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let before = owner
        .save_exclusions(&id(1), 0, ids(&["12@c.us"]), ids(&["34@g.us"]))
        .unwrap();
    let saved = repository.0.lock().unwrap().saves;
    repository.0.lock().unwrap().fail = true;
    assert!(matches!(
        owner.save_exclusions(&id(1), 1, ids(&["56@c.us"]), Vec::new()),
        Err(AppError::BroadcastPresetPersistence)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == before);
    assert!(
        BroadcastPresets::open(repository.clone())
            .unwrap()
            .snapshot(&id(1))
            .unwrap()
            == before
    );
    assert_eq!(
        owner.ensure_not_excluded(&id(1), &ids(&["12@c.us"])),
        Err(AppError::BroadcastExclusionConflict)
    );
    assert!(owner
        .ensure_not_excluded(&id(1), &ids(&["56@c.us"]))
        .is_ok());
    assert!(owner
        .ensure_not_excluded(&id(2), &ids(&["12@c.us"]))
        .is_ok());
    assert!(owner
        .save_exclusions(
            &id(1),
            1,
            before.excluded_contact_ids.clone(),
            before.excluded_group_ids.clone()
        )
        .is_ok());
    for (contacts, groups) in [
        (ids(&["12@g.us"]), Vec::new()),
        (ids(&["12@c.us", "12@c.us"]), Vec::new()),
        (ids(&["12@c.us"]), ids(&["tg:-34"])),
    ] {
        assert!(matches!(
            owner.save_exclusions(&id(1), 1, contacts, groups),
            Err(AppError::BroadcastPresetInvalid)
        ));
    }
    assert_eq!(repository.0.lock().unwrap().saves, saved);
    assert!(owner.snapshot(&id(1)).unwrap() == before);
}

#[test]
fn schema_one_load_is_read_only_and_only_a_committed_change_writes_schema_two() {
    let legacy = json!({"schemaVersion":1,"accounts":[{
        "accountId":id(1),"revision":7,"messages":[],"audiences":[]
    }]});
    let document: BroadcastPresetDocument = serde_json::from_value(legacy).unwrap();
    assert!(document.validate().is_ok());
    let repository = Repository::default();
    repository.0.lock().unwrap().document = Some(document.clone());
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    assert_eq!(owner.snapshot(&id(1)).unwrap().revision, 7);
    assert!(owner
        .snapshot(&id(1))
        .unwrap()
        .excluded_contact_ids
        .is_empty());
    owner
        .save_exclusions(&id(1), 7, Vec::new(), Vec::new())
        .unwrap();
    assert_eq!(repository.0.lock().unwrap().saves, 0);
    assert!(repository.0.lock().unwrap().document.as_ref().unwrap() == &document);
    repository.0.lock().unwrap().fail = true;
    assert!(matches!(
        owner.save_exclusions(&id(1), 7, ids(&["12@c.us"]), Vec::new()),
        Err(AppError::BroadcastPresetPersistence)
    ));
    assert!(repository.0.lock().unwrap().document.as_ref().unwrap() == &document);
    repository.0.lock().unwrap().fail = false;
    let saved = owner
        .save_exclusions(&id(1), 7, ids(&["12@c.us"]), Vec::new())
        .unwrap();
    assert_eq!(saved.revision, 8);
    assert_eq!(
        repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .schema_version,
        2
    );
}

#[test]
fn a_valid_schema_one_at_the_plaintext_ceiling_remains_readable_without_new_empty_fields() {
    let mut document = BroadcastPresetDocument {
        schema_version: 1,
        accounts: Vec::new(),
    };
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
    document.accounts[2]
        .messages
        .last_mut()
        .unwrap()
        .message
        .truncate(10_000 - excess);
    let bytes = serde_json::to_vec(&document).unwrap();
    assert_eq!(bytes.len(), MAX_PRESET_STORE_BYTES);
    assert!(!String::from_utf8_lossy(&bytes).contains("excludedContactIds"));
    let decoded: BroadcastPresetDocument = serde_json::from_slice(&bytes).unwrap();
    assert!(decoded.validate().is_ok());
    let repository = Repository::default();
    repository.0.lock().unwrap().document = Some(decoded);
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let before = owner.snapshot(&id(1)).unwrap();
    assert!(
        owner
            .save_exclusions(&id(1), 1, Vec::new(), Vec::new())
            .unwrap()
            == before
    );
    assert_eq!(repository.0.lock().unwrap().saves, 0);
    assert!(matches!(
        owner.save_exclusions(&id(1), 1, ids(&["12@c.us"]), Vec::new()),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == before);
    assert_eq!(repository.0.lock().unwrap().saves, 0);
}

#[test]
fn current_schema_cannot_silently_drop_an_exclusion_component_or_accept_null() {
    let value = json!({"schemaVersion":2,"accounts":[{
        "accountId":id(1),"revision":1,"messages":[],"audiences":[],
        "excludedContactIds":["12@c.us"],"excludedGroupIds":[]
    }]});
    assert!(
        serde_json::from_value::<BroadcastPresetDocument>(value.clone())
            .unwrap()
            .validate()
            .is_ok()
    );
    for field in ["excludedContactIds", "excludedGroupIds"] {
        let mut missing = value.clone();
        missing["accounts"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(serde_json::from_value::<BroadcastPresetDocument>(missing).is_err());
        for schema in [1, 2] {
            let mut null = value.clone();
            null["schemaVersion"] = json!(schema);
            null["accounts"][0][field] = json!(null);
            assert!(serde_json::from_value::<BroadcastPresetDocument>(null).is_err());
        }
    }
    let mut mislabelled = value;
    mislabelled["schemaVersion"] = json!(1);
    assert!(
        serde_json::from_value::<BroadcastPresetDocument>(mislabelled)
            .unwrap()
            .validate()
            .is_err()
    );
}

#[test]
fn concurrent_panels_have_one_revision_winner_and_a_stale_loser_cannot_erase_it() {
    let repository = Repository::default();
    let owner = Arc::new(Mutex::new(
        BroadcastPresets::open(repository.clone()).unwrap(),
    ));
    let start = Arc::new(Barrier::new(3));
    let threads: Vec<_> = ["12@c.us", "34@c.us"]
        .into_iter()
        .map(|target| {
            let owner = Arc::clone(&owner);
            let start = Arc::clone(&start);
            std::thread::spawn(move || {
                start.wait();
                owner
                    .lock()
                    .unwrap()
                    .save_exclusions(&id(1), 0, ids(&[target]), Vec::new())
                    .map(|snapshot| snapshot.excluded_contact_ids)
            })
        })
        .collect();
    start.wait();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(AppError::BroadcastPresetConflict)))
            .count(),
        1
    );
    let persisted = owner.lock().unwrap().snapshot(&id(1)).unwrap();
    assert_eq!(persisted.revision, 1);
    assert_eq!(
        persisted.excluded_contact_ids,
        *results
            .iter()
            .find_map(|result| result.as_ref().ok())
            .unwrap()
    );
    assert_eq!(repository.0.lock().unwrap().saves, 1);
}

#[test]
fn revision_exhaustion_does_not_drop_the_existing_deny_list() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    owner
        .save_exclusions(&id(1), 0, ids(&["12@c.us"]), Vec::new())
        .unwrap();
    repository
        .0
        .lock()
        .unwrap()
        .document
        .as_mut()
        .unwrap()
        .accounts[0]
        .revision = MAX_PRESET_REVISION;
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    assert!(matches!(
        owner.save_exclusions(&id(1), MAX_PRESET_REVISION, Vec::new(), Vec::new()),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert_eq!(
        owner.snapshot(&id(1)).unwrap().excluded_contact_ids,
        ids(&["12@c.us"])
    );
    assert_eq!(repository.0.lock().unwrap().saves, saves);
}
