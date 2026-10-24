use super::broadcast_preset_support::{id, Repository};
use crate::{
    application::broadcast_presets::BroadcastPresets,
    domain::{
        account_backup::{parse_account_backup, PresetBackup},
        error::AppError,
    },
};
use serde_json::{json, Value};

fn backup(version: u32, data: Value) -> Value {
    json!({
        "schema":"geek-account-settings","version":version,
        "exportedAt":"2026-10-24T00:00:00Z",
        "account":{"name":"Source","type":"whatsapp"},"data":data
    })
}

fn parse(value: &Value, platform: &str) -> crate::domain::error::Result<PresetBackup> {
    let imported = parse_account_backup(&serde_json::to_vec(value).unwrap(), platform)?;
    imported.data.presets.ok_or(AppError::BackupInvalid)
}

#[test]
fn v3_preserves_absent_lists_but_explicit_empty_clears_only_its_component() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let initial = owner
        .save_exclusions(&id(1), 0, vec!["12@c.us".into()], vec!["34@g.us".into()])
        .unwrap();
    let source = backup(3, json!({"presets":{"messages":[]}}));
    let absent = parse(&source, "whatsapp").unwrap();
    assert!(absent.excluded_contact_ids.is_none() && absent.excluded_group_ids.is_none());
    assert!(owner.restore(&id(1), 1, &absent).unwrap() == initial);
    let clear_contact = parse(
        &backup(3, json!({"presets":{"excludedContactIds":[]}})),
        "whatsapp",
    )
    .unwrap();
    assert_eq!(clear_contact.excluded_contact_ids, Some(Vec::new()));
    assert!(clear_contact.excluded_group_ids.is_none());
    let cleared = owner.restore(&id(1), 1, &clear_contact).unwrap();
    assert_eq!(cleared.revision, 2);
    assert!(cleared.excluded_contact_ids.is_empty());
    assert_eq!(cleared.excluded_group_ids, vec!["34@g.us"]);
    let portable = PresetBackup::from_snapshot(&cleared);
    let imported = parse(&backup(3, json!({"presets":portable})), "whatsapp").unwrap();
    assert_eq!(imported, portable);
    assert!(owner.restore(&id(1), 2, &imported).unwrap() == cleared);
    assert_eq!(repository.0.lock().unwrap().saves, 2);
}

#[test]
fn v3_null_wrong_kinds_duplicates_platforms_and_unbounded_lists_are_rejected() {
    for section in [
        json!({"excludedContactIds":null}),
        json!({"excludedGroupIds":null}),
        json!({"excludedContactIds":["12@g.us"]}),
        json!({"excludedGroupIds":["12@c.us"]}),
        json!({"excludedContactIds":["12@c.us","12@c.us"]}),
        json!({"excludedContactIds":"[]"}),
        json!({"excludedContactIds":[12]}),
        json!({"excludedContactIds":["tg:12"]}),
        json!({"excludedGroupIds":["tg:-12"]}),
    ] {
        assert!(parse(&backup(3, json!({"presets":section})), "whatsapp").is_err());
    }
    let too_many: Vec<_> = (1..=2001).map(|index| format!("{index}@c.us")).collect();
    assert_eq!(
        parse(
            &backup(3, json!({"presets":{"excludedContactIds":too_many}})),
            "whatsapp"
        ),
        Err(AppError::BroadcastPresetLimit)
    );
    let telegram = backup(
        3,
        json!({"presets":{"excludedContactIds":["tg:12"],"excludedGroupIds":["tg:-34"]}}),
    );
    assert!(parse(&telegram, "telegram-k").is_ok());
    assert!(parse(&telegram, "whatsapp").is_err());
    let whatsapp = backup(3, json!({"presets":{"excludedContactIds":["12@c.us"]}}));
    assert!(parse(&whatsapp, "telegram-k").is_err());
}

#[test]
fn v2_union_preserves_every_legacy_denial_and_does_not_grant_group_tool_support() {
    let value = backup(
        2,
        json!({
            "broadcastExclude":["12@c.us","34@g.us","56@lid"],
            "broadcastExcludeContacts":["12@c.us","78@c.us"],
            "broadcastExcludeGroups":["90@g.us","34@g.us"],
            "broadcastGroups":[],"savedGroups":[],"groupLinks":[],
            "gtAutoCfg":{},"gtCmdCfg":{},"gtCmdNames":{},
            "sendHistory":[],"scheduleTasks":[],"broadcastJobSchedules":[]
        }),
    );
    let imported = parse_account_backup(&serde_json::to_vec(&value).unwrap(), "whatsapp").unwrap();
    assert_eq!(imported.reported_unsupported.len(), 6);
    assert_eq!(imported.ignored_keys.len(), 3);
    let presets = imported.data.presets.unwrap();
    assert_eq!(
        presets.excluded_contact_ids,
        Some(vec!["12@c.us".into(), "78@c.us".into(), "56@lid".into()])
    );
    assert_eq!(
        presets.excluded_group_ids,
        Some(vec!["90@g.us".into(), "34@g.us".into()])
    );
    assert!(presets.messages.is_none() && presets.audiences.is_none());
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository).unwrap();
    let restored = owner.restore(&id(1), 0, &presets).unwrap();
    assert_eq!(restored.revision, 1);
    for target in ["12@c.us", "78@c.us", "56@lid", "90@g.us", "34@g.us"] {
        assert_eq!(
            owner.ensure_not_excluded(&id(1), &[target.into()]),
            Err(AppError::BroadcastExclusionConflict)
        );
    }
}

#[test]
fn v2_specific_absence_stays_absent_and_combined_empty_explicitly_clears_both_kinds() {
    let specific = parse(
        &backup(2, json!({"broadcastExcludeContacts":[]})),
        "whatsapp",
    )
    .unwrap();
    assert_eq!(specific.excluded_contact_ids, Some(Vec::new()));
    assert!(specific.excluded_group_ids.is_none());
    let combined = parse(&backup(2, json!({"broadcastExclude":[]})), "whatsapp").unwrap();
    assert_eq!(combined.excluded_contact_ids, Some(Vec::new()));
    assert_eq!(combined.excluded_group_ids, Some(Vec::new()));
    for data in [
        json!({"broadcastExclude":null}),
        json!({"broadcastExcludeContacts":null}),
        json!({"broadcastExcludeGroups":null}),
        json!({"broadcastExclude":["12"]}),
        json!({"broadcastExclude":["12@c.us","12@c.us"]}),
        json!({"broadcastExcludeContacts":["34@g.us"]}),
        json!({"broadcastExcludeGroups":["12@c.us"]}),
        json!({"broadcastExclude":["tg:12"]}),
        json!({"broadcastExcludeContacts":["12@c.us"],"broadcastExclude":["tg:-34"]}),
    ] {
        assert!(parse(&backup(2, data), "whatsapp").is_err());
    }
    let telegram = backup(
        2,
        json!({"broadcastExclude":["tg:12","tg:-34"],"broadcastExcludeContacts":["tg:56"]}),
    );
    let parsed = parse(&telegram, "telegram-k").unwrap();
    assert_eq!(
        parsed.excluded_contact_ids,
        Some(vec!["tg:56".into(), "tg:12".into()])
    );
    assert_eq!(parsed.excluded_group_ids, Some(vec!["tg:-34".into()]));
}

#[test]
fn v2_union_limits_apply_after_merge_and_do_not_silently_truncate_denials() {
    let maximum: Vec<_> = (1..=2000).map(|index| format!("{index}@c.us")).collect();
    let duplicate_overlap = backup(
        2,
        json!({
            "broadcastExcludeContacts":maximum,"broadcastExclude":["1@c.us"]
        }),
    );
    assert_eq!(
        parse(&duplicate_overlap, "whatsapp")
            .unwrap()
            .excluded_contact_ids
            .unwrap()
            .len(),
        2000
    );
    let overflow = backup(
        2,
        json!({
            "broadcastExcludeContacts":maximum,"broadcastExclude":["2001@c.us"]
        }),
    );
    assert_eq!(
        parse(&overflow, "whatsapp"),
        Err(AppError::BroadcastPresetLimit)
    );
}

#[test]
fn restore_failure_and_stale_preview_keep_existing_exclusions_and_independent_account() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let original = owner
        .save_exclusions(&id(1), 0, vec!["12@c.us".into()], Vec::new())
        .unwrap();
    let neighbor = owner
        .save_exclusions(&id(2), 0, vec!["34@c.us".into()], Vec::new())
        .unwrap();
    let imported = parse(
        &backup(3, json!({"presets":{"excludedContactIds":["56@c.us"]}})),
        "whatsapp",
    )
    .unwrap();
    owner.validate_restore(&id(1), 1, &imported).unwrap();
    assert!(owner.snapshot(&id(1)).unwrap() == original);
    repository.0.lock().unwrap().fail = true;
    assert!(matches!(
        owner.restore(&id(1), 1, &imported),
        Err(AppError::BroadcastPresetPersistence)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == original);
    assert!(owner.snapshot(&id(2)).unwrap() == neighbor);
    repository.0.lock().unwrap().fail = false;
    owner
        .save_exclusions(&id(1), 1, vec!["78@c.us".into()], Vec::new())
        .unwrap();
    assert!(matches!(
        owner.restore(&id(1), 1, &imported),
        Err(AppError::BroadcastPresetConflict)
    ));
    assert_eq!(
        owner.snapshot(&id(1)).unwrap().excluded_contact_ids,
        vec!["78@c.us"]
    );
    let reopened = BroadcastPresets::open(repository).unwrap();
    assert!(reopened.snapshot(&id(2)).unwrap() == neighbor);
    assert_eq!(
        reopened.snapshot(&id(1)).unwrap().excluded_contact_ids,
        vec!["78@c.us"]
    );
}
