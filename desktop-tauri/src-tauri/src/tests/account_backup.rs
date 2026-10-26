use crate::domain::{
    account_backup::{
        parse_account_backup, AccountBackup, BackupAudience, BackupData, BackupMessage,
        PresetBackup, TranslationBackup, MAX_BACKUP_BYTES,
    },
    broadcast_presets::BroadcastPresetSnapshot,
    error::AppError,
    translation::{ChatTranslationPolicy, TranslationPolicy, TranslationSettings},
};
use serde_json::{json, Value};

fn legacy(data: Value) -> Value {
    json!({
        "schema": "geek-account-settings", "version": 2,
        "exportedAt": "2026-10-24T00:00:00.000Z",
        "account": {"name": "Source", "type": "whatsapp"},
        "data": data, "excludes": ["sendHistory", "scheduleTasks", "broadcastJobSchedules"]
    })
}

fn modern(data: BackupData) -> Value {
    let mut record = legacy(serde_json::to_value(data).unwrap());
    record["version"] = json!(3);
    record
}

fn parse(
    value: &Value,
) -> crate::domain::error::Result<crate::domain::account_backup::BackupImport> {
    parse_account_backup(&serde_json::to_vec(value).unwrap(), "whatsapp")
}

fn text_backup() -> BackupData {
    BackupData {
        presets: Some(PresetBackup {
            messages: Some(vec![BackupMessage {
                name: "Greeting".into(),
                message: "Hello %nc".into(),
            }]),
            audiences: None,
            ..Default::default()
        }),
        translation: None,
    }
}

#[test]
fn export_is_portable_and_contains_no_identity_revision_or_execution_state() {
    let (workspace, _, _, a, _) = super::doubles::fixture();
    let account = workspace
        .snapshot()
        .accounts
        .into_iter()
        .find(|entry| entry.id == a)
        .unwrap();
    let backup = AccountBackup::export(
        &account,
        &BroadcastPresetSnapshot::empty(&a),
        "2026-10-24T00:00:00Z".into(),
    )
    .unwrap();
    let encoded = serde_json::to_string(&backup).unwrap();
    assert!(!encoded.contains(&a));
    for forbidden in [
        "revision",
        "password",
        "proxy",
        "cookie",
        "token",
        "profile",
        "websiteUrl",
    ] {
        assert!(!encoded.contains(forbidden));
    }
    let imported = parse_account_backup(encoded.as_bytes(), "whatsapp").unwrap();
    assert_eq!(imported.version, 3);
    assert_eq!(imported.account.name, account.name);
    assert_eq!(
        imported.data.translation.unwrap().global.unwrap(),
        account.translation.global
    );
    let presets = imported.data.presets.unwrap();
    assert!(presets.messages.unwrap().is_empty());
    assert!(presets.audiences.unwrap().is_empty());
    assert!(AccountBackup::export(
        &account,
        &BroadcastPresetSnapshot::empty(&super::broadcast_preset_support::id(99)),
        "2026-10-24T00:00:00Z".into()
    )
    .is_err());
}

#[test]
fn current_workbench_v2_maps_exact_messages_audiences_and_translation_choices() {
    let chat_policy = ChatTranslationPolicy::from_policy(&TranslationPolicy {
        enabled: true,
        auto_send: true,
        target: "it".into(),
        ..Default::default()
    });
    let record = legacy(json!({
        "savedMessages": [{"name": " Greeting ", "msg": " Hello {a|b}\n%nc "}],
        "savedLists": [{"name": " Customers ", "ids": ["12025550123@c.us", "123-456@g.us"]}],
        "translationGlobal": {
            "source": "local", "server": "backup", "send": true, "sendFrom": "zh", "sendTo": "it",
            "includeZh": false, "displayTranslation": true, "manual": false, "translationMode": "auto",
            "messageFrom": "en", "messageTo": "zh", "group": true, "fontSize": "15", "fontColor": "#123abc"
        },
        "translationChats": {"12025550123@c.us": chat_policy}
    }));
    let imported = parse(&record).unwrap();
    let presets = imported.data.presets.unwrap();
    assert_eq!(
        presets.messages.unwrap(),
        vec![BackupMessage {
            name: "Greeting".into(),
            message: " Hello {a|b}\n%nc ".into(),
        }]
    );
    assert_eq!(presets.audiences.unwrap()[0].name, "Customers");
    let translation = imported.data.translation.unwrap();
    let global = translation.global.unwrap();
    assert_eq!(global.provider, "auto");
    assert_eq!(global.route, "backup");
    assert_eq!(global.source, "zh");
    assert_eq!(global.target, "it");
    assert!(global.enabled && global.auto_send && global.group_auto);
    assert!(!global.include_zh && !global.message_action);
    assert_eq!(global.font_size, 15);
    assert_eq!(global.font_color, "#123abc");
    assert_eq!(translation.chats.unwrap()["12025550123@c.us"], chat_policy);
}

#[test]
fn v2_missing_components_stay_absent_and_known_unsupported_or_execution_keys_are_reported() {
    let record = legacy(json!({
        "savedMessages": [], "translationChats": {},
        "broadcastExclude": ["12025550123@c.us"], "broadcastExcludeContacts": [],
        "broadcastExcludeGroups": [], "broadcastGroups": [], "savedGroups": [],
        "groupLinks": [], "gtAutoCfg": {}, "gtCmdCfg": {}, "gtCmdNames": {},
        "sendHistory": [{"private": "never restored"}],
        "scheduleTasks": [{"enabled": true}], "broadcastJobSchedules": [{"status": "running"}]
    }));
    let imported = parse(&record).unwrap();
    assert_eq!(imported.reported_unsupported.len(), 6);
    assert_eq!(imported.ignored_keys.len(), 3);
    let presets = imported.data.presets.unwrap();
    assert_eq!(presets.messages, Some(Vec::new()));
    assert!(presets.audiences.is_none());
    assert_eq!(
        presets.excluded_contact_ids,
        Some(vec!["12025550123@c.us".into()])
    );
    assert_eq!(presets.excluded_group_ids, Some(Vec::new()));
    let translation = imported.data.translation.unwrap();
    assert!(translation.global.is_none());
    assert!(translation.chats.unwrap().is_empty());
    let unsupported_only = parse(&legacy(json!({"groupLinks": []}))).unwrap();
    assert_eq!(unsupported_only.reported_unsupported, vec!["groupLinks"]);
    assert!(unsupported_only.data.presets.is_none() && unsupported_only.data.translation.is_none());
}

#[test]
fn unknown_versions_shapes_secrets_and_duplicate_members_never_acquire_restore_authority() {
    for version in [0, 1, 4, 99] {
        let mut value = modern(text_backup());
        value["version"] = json!(version);
        assert_eq!(parse(&value).unwrap_err(), AppError::BackupVersion);
    }
    for value in [
        json!({"savedMessages": []}),
        legacy(json!({"cookies": []})),
        legacy(json!({"translationGlobal": {"token": "secret"}})),
        legacy(json!({"savedMessages": [{"name": "A", "msg": "B", "id": "foreign"}]})),
        legacy(json!({"savedLists": "[]"})),
    ] {
        assert!(parse(&value).is_err());
    }
    let value = serde_json::to_string(&modern(text_backup())).unwrap();
    for duplicate in [
        value.replace("\"version\":3", "\"version\":3,\"version\":3"),
        value.replace(
            "\"name\":\"Greeting\"",
            "\"name\":\"Greeting\",\"name\":\"Greeting\"",
        ),
    ] {
        assert_eq!(
            parse_account_backup(duplicate.as_bytes(), "whatsapp").unwrap_err(),
            AppError::BackupInvalid
        );
    }
    let mut wrong_schema = modern(text_backup());
    wrong_schema["schema"] = json!("other-settings");
    assert_eq!(parse(&wrong_schema).unwrap_err(), AppError::BackupInvalid);
}

#[test]
fn explicit_null_and_empty_sections_do_not_mean_keep_everything() {
    for data in [
        json!({}),
        json!({"presets": null}),
        json!({"presets": {}}),
        json!({"presets": {"messages": null}}),
        json!({"translation": {}}),
        json!({"translation": {"global": null}}),
        json!({"translation": {"chats": null}}),
    ] {
        let mut record = legacy(data);
        record["version"] = json!(3);
        assert!(parse(&record).is_err());
    }
    assert!(parse(&legacy(
        json!({"translationGlobal": {"translationMode": null}})
    ))
    .is_err());
}

#[test]
fn platform_namespaces_are_checked_from_target_account_and_chat_shapes_stay_strict() {
    let chat = ChatTranslationPolicy::from_policy(&TranslationPolicy::default());
    for record in [
        legacy(json!({"savedLists": [{"name": "Wrong", "ids": ["tg:42"]}]})),
        legacy(json!({"translationChats": {"tg:42": chat}})),
    ] {
        assert!(parse(&record).is_err());
        assert!(parse_account_backup(&serde_json::to_vec(&record).unwrap(), "telegram-k").is_ok());
    }
    let record = legacy(json!({"savedLists": [{"name": "Mixed", "ids": ["tg:42", "12@c.us"]}]}));
    for target in ["whatsapp", "telegram-k"] {
        assert!(parse_account_backup(&serde_json::to_vec(&record).unwrap(), target).is_err());
    }
    let full = TranslationPolicy::default();
    assert!(parse(&legacy(json!({"translationChats": {"12@c.us": full}}))).is_err());
    let sending = legacy(json!({"translationGlobal": {"send": true}}));
    let imported =
        parse_account_backup(&serde_json::to_vec(&sending).unwrap(), "telegram-z").unwrap();
    let global = imported.data.translation.unwrap().global.unwrap();
    assert!(global.enabled && global.auto_send);
}

#[test]
fn legacy_translation_enum_mapping_and_history_limits_do_not_guess_or_downgrade() {
    for global in [
        json!({"source": "unknown"}),
        json!({"server": "fast"}),
        json!({"sendTo": "unknown"}),
        json!({"fontSize": "013"}),
        json!({"fontSize": 14}),
        json!({"send": "true"}),
        json!({"translationMode": "maybe"}),
        json!({"translateHistory": true}),
        json!({"transOldHistory": true}),
    ] {
        assert!(parse(&legacy(json!({"translationGlobal": global}))).is_err());
    }
    let compatible = parse(&legacy(
        json!({"translationGlobal": {"message": true, "fontSize": 11}}),
    ))
    .unwrap();
    let global = compatible.data.translation.unwrap().global.unwrap();
    assert_eq!(global.translation_mode, "auto");
    assert_eq!(global.font_size, 11);
    let explicit = parse(&legacy(
        json!({"translationGlobal": {"message": true, "translationMode": "click"}}),
    ))
    .unwrap();
    assert_eq!(
        explicit
            .data
            .translation
            .unwrap()
            .global
            .unwrap()
            .translation_mode,
        "click"
    );
}

#[test]
fn file_collection_and_policy_limits_are_checked_before_any_owner_can_write() {
    assert_eq!(
        parse_account_backup(&vec![b' '; MAX_BACKUP_BYTES + 1], "whatsapp").unwrap_err(),
        AppError::BackupLimit
    );
    let messages = (0..101)
        .map(|index| json!({"name": format!("M{index}"), "msg": "hello"}))
        .collect::<Vec<_>>();
    assert_eq!(
        parse(&legacy(json!({"savedMessages": messages}))).unwrap_err(),
        AppError::BroadcastPresetLimit
    );
    let chat = ChatTranslationPolicy::from_policy(&TranslationPolicy::default());
    let chats = (0..101)
        .map(|index| (format!("{index}@c.us"), chat.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(
        parse(&legacy(json!({"translationChats": chats}))).unwrap_err(),
        AppError::TranslationLimit
    );
    for rows in [
        json!([{"name": "A", "msg": "hello"}, {"name": " A ", "msg": "world"}]),
        json!([{"name": "A", "msg": ""}]),
        json!([{"name": "A\nB", "msg": "hello"}]),
    ] {
        assert!(parse(&legacy(json!({"savedMessages": rows}))).is_err());
    }
    let too_large = "x".repeat(2 * 1024 * 1024);
    assert_eq!(
        parse(&legacy(json!({"gtAutoCfg": too_large}))).unwrap_err(),
        AppError::BackupLimit
    );
}

#[test]
fn typed_partial_translation_preserves_inheritance_and_portable_audiences_have_no_ids() {
    let current = TranslationSettings {
        revision: 12,
        global: TranslationPolicy {
            target: "it".into(),
            provider: "local".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    let backup = TranslationBackup {
        global: None,
        chats: Some(Default::default()),
    };
    assert_eq!(backup.apply_to(&current, "whatsapp").unwrap(), current);
    let data = BackupData {
        presets: Some(PresetBackup {
            messages: None,
            audiences: Some(vec![BackupAudience {
                name: "A".into(),
                recipient_ids: vec!["12@c.us".into()],
            }]),
            ..Default::default()
        }),
        translation: Some(TranslationBackup::from_settings(&current)),
    };
    let imported = parse(&modern(data.clone())).unwrap();
    assert_eq!(imported.data, data);
    let mut hidden_revision = modern(data);
    hidden_revision["data"]["translation"]["revision"] = json!(12);
    assert!(parse(&hidden_revision).is_err());
}
