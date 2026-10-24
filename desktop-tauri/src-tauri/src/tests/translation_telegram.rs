use super::{doubles::MemoryRepository, translation_support::*};
use crate::{
    application::{
        accounts::Accounts,
        request_control::RequestControl,
        translation_ports::{OutgoingTranslation, TranslationIntent},
    },
    domain::{
        document::Document,
        error::AppError,
        proxy::ProxyConfig,
        translation::{
            valid_chat_id, valid_receive_chat_id, ChatTranslationPolicy, TranslationPolicy,
        },
    },
    infrastructure::catalog,
};
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

fn event() -> crate::domain::translation::IncomingTranslation {
    let mut incoming = incoming("42");
    incoming.chat_id = "tg:-100123".into();
    incoming.sent_at = 0;
    incoming
}

#[test]
fn telegram_receive_identity_is_separate_from_every_whatsapp_send_identity() {
    for id in [
        "tg:123",
        "tg:-100123",
        "tg:9223372036854775807",
        "tg:-9223372036854775808",
    ] {
        for platform in ["telegram-z", "telegram-k"] {
            assert!(valid_receive_chat_id(platform, id));
        }
        assert!(!valid_chat_id(id));
        assert!(!valid_receive_chat_id("whatsapp", id));
    }
    for id in [
        "123",
        "tg:0",
        "tg:-0",
        "tg:01",
        "tg:+1",
        "tg:123_4",
        "tg:@name",
        "tg:9223372036854775808",
    ] {
        assert!(!valid_receive_chat_id("telegram-z", id));
    }
    assert!(valid_chat_id("123@c.us"));
    assert!(!valid_receive_chat_id("telegram-k", "123@c.us"));
    for mid in ["0", "01", "+1", "1.5", "temp-1", "9223372036854775808"] {
        let mut incoming = event();
        incoming.message_id = mid.into();
        assert_eq!(
            incoming.validate_for_platform("telegram-z"),
            Err(AppError::TranslationInvalid)
        );
    }
}

#[test]
fn telegram_manual_transform_uses_the_existing_owner_quota_cache_and_frozen_proxy() {
    for platform in ["telegram-z", "telegram-k"] {
        let h = setup();
        let proxy = ProxyConfig::Http {
            host: "synthetic.invalid".into(),
            port: 8080,
        };
        let mut account = account(proxy.clone());
        account.platform_id = platform.into();
        account.translation.global.message_target = "it".into();
        let mut incoming = event();
        let work = h.engine.prepare(account.clone(), incoming.clone()).unwrap();
        account.proxy = ProxyConfig::System;
        h.gateway.token_reply(Ok(token(platform)), None);
        h.gateway
            .translation_reply(Ok(translated("Traduzione", Some(80))), None);
        assert_eq!(h.engine.execute(&work).unwrap(), "Traduzione");
        assert_eq!(h.engine.execute(&work).unwrap(), "Traduzione");
        assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
        let calls = h.gateway.calls(Operation::Translate);
        let sent = calls[0].request.as_ref().unwrap();
        assert_eq!(sent.intent, TranslationIntent::MessageDisplay);
        assert_eq!(sent.id, incoming.id);
        assert_eq!(sent.text, incoming.text);
        assert_eq!(sent.target, "it");
        assert_eq!(calls[0].proxy, proxy);
        assert_eq!(h.session.snapshot().unwrap().remaining_chars, Some(80));
        // Same message number in another peer is a separate display request.
        account.proxy = proxy;
        incoming.chat_id = "tg:456".into();
        incoming.id = Uuid::new_v4().to_string();
        let other = h.engine.prepare(account, incoming).unwrap();
        h.gateway
            .translation_reply(Ok(translated("Other peer", Some(70))), None);
        assert_eq!(h.engine.execute(&other).unwrap(), "Other peer");
        assert_eq!(h.gateway.calls(Operation::Translate).len(), 2);
    }
}

#[test]
fn telegram_automatic_and_outgoing_cannot_bypass_policy_or_request_admission() {
    let h = setup();
    for platform in ["telegram-z", "telegram-k"] {
        let mut account = account(ProxyConfig::System);
        account.platform_id = platform.into();
        let mut automatic = event();
        automatic.manual = false;
        automatic.sent_at = h.engine.auto_after();
        assert!(matches!(
            h.engine.prepare(account.clone(), automatic),
            Err(AppError::TranslationUnavailable)
        ));
        let unsupported = if platform == "telegram-z" {
            vec!["enabled", "autoSend"]
        } else {
            vec![]
        };
        for field in unsupported {
            let mut candidate = account.clone();
            match field {
                "enabled" => candidate.translation.global.enabled = true,
                "autoSend" => candidate.translation.global.auto_send = true,
                "groupAuto" => candidate.translation.global.group_auto = true,
                _ => candidate.translation.global.translation_mode = "auto".into(),
            }
            assert!(matches!(
                h.engine.prepare(candidate, event()),
                Err(AppError::TranslationUnavailable)
            ));
        }
        let mut wrong = event();
        wrong.chat_id = "123@c.us".into();
        assert!(matches!(
            h.engine.prepare(account.clone(), wrong),
            Err(AppError::TranslationInvalid)
        ));
        account.translation.global.enabled = true;
        account.translation.global.auto_send = true;
        let outgoing = OutgoingTranslation {
            id: Uuid::new_v4().to_string(),
            chat_id: "123@c.us".into(),
            text: "Synthetic outgoing".into(),
            policy_revision: 0,
        };
        assert!(matches!(
            h.engine.prepare_outgoing(
                account,
                outgoing,
                RequestControl::new(Duration::from_secs(50))
            ),
            Err(AppError::TranslationUnavailable)
        ));
    }
    assert!(h.gateway.calls(Operation::Quota).is_empty());
    assert!(h.gateway.calls(Operation::Token).is_empty());
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn telegram_settings_save_atomically_reject_unsupported_switches_and_keep_other_platforms_isolated()
{
    let repository = MemoryRepository::default();
    let mut accounts = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
    for platform in ["telegram-z", "telegram-k", "whatsapp"] {
        accounts
            .create(platform, platform, None, ProxyConfig::System)
            .unwrap();
    }
    let id = accounts.accounts()[0].id.clone();
    let wa = accounts.accounts()[2].id.clone();
    let before = accounts.accounts().to_vec();
    let saves = repository.0.lock().unwrap().saves;
    for field in ["enabled", "autoSend"] {
        let mut policy = TranslationPolicy::default();
        match field {
            "enabled" => policy.enabled = true,
            "autoSend" => policy.auto_send = true,
            "groupAuto" => policy.group_auto = true,
            _ => policy.translation_mode = "auto".into(),
        }
        assert_eq!(
            accounts.update_translation(&id, None, Some(policy.into()), 0),
            Err(AppError::TranslationUnavailable)
        );
    }
    let mut chat = ChatTranslationPolicy::from_policy(&TranslationPolicy::default());
    chat.message_target = "it".into();
    let mut bad = chat.clone();
    bad.enabled = true;
    assert_eq!(
        accounts.update_translation(&id, Some("tg:123"), Some(bad.into()), 0),
        Err(AppError::TranslationUnavailable)
    );
    assert_eq!(
        accounts.update_translation(&id, Some("123@c.us"), Some(chat.clone().into()), 0),
        Err(AppError::TranslationInvalid)
    );
    assert_eq!(
        accounts.update_translation(&wa, Some("tg:123"), Some(chat.clone().into()), 0),
        Err(AppError::TranslationInvalid)
    );
    assert_eq!(accounts.accounts(), before);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    repository.0.lock().unwrap().fail_save = true;
    assert_eq!(
        accounts.update_translation(&id, Some("tg:123"), Some(chat.clone().into()), 0),
        Err(AppError::StoreIo)
    );
    assert_eq!(accounts.accounts(), before);
    repository.0.lock().unwrap().fail_save = false;
    accounts
        .update_translation(&id, Some("tg:123"), Some(chat.clone().into()), 0)
        .unwrap();
    assert_eq!(
        accounts.account(&id).unwrap().translation.chats["tg:123"],
        chat
    );
    assert_eq!(&accounts.accounts()[1..], &before[1..]);
    assert_eq!(
        accounts.update_translation(&id, Some("tg:123"), None, 0),
        Err(AppError::TranslationSettingsConflict)
    );
    let restored = Accounts::open(repository, catalog::load().unwrap()).unwrap();
    assert_eq!(restored.accounts(), accounts.accounts());
}

#[test]
fn schemas_one_through_six_load_telegram_defaults_and_strict_chat_rows_without_eager_writes() {
    for platform in ["telegram-z", "telegram-k"] {
        for version in 1..=6 {
            for legacy_row in [None, Some(false), Some(true)] {
                let id = Uuid::new_v4().to_string();
                let mut value = json!({"schemaVersion": version, "accounts": [{"id": id,
                "name": "Synthetic Telegram", "platformId": platform}]});
                if let Some(full) = legacy_row {
                    let policy = TranslationPolicy::default();
                    value["accounts"][0]["translation"] = json!({"revision": 0, "global": policy,
                    "chats": {"tg:123": if full { serde_json::to_value(&policy).unwrap() }
                        else { serde_json::to_value(ChatTranslationPolicy::from_policy(&policy)).unwrap() }}});
                }
                let repository = MemoryRepository::default();
                repository.0.lock().unwrap().document =
                    Some(serde_json::from_value::<Document>(value).unwrap());
                let mut accounts =
                    Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
                assert_eq!(repository.0.lock().unwrap().saves, 0);
                accounts
                    .update_translation(&id, None, Some(TranslationPolicy::default().into()), 0)
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
                let policy = TranslationPolicy {
                    message_target: "it".into(),
                    ..TranslationPolicy::default()
                };
                accounts
                    .update_translation(&id, None, Some(policy.into()), 0)
                    .unwrap();
                let saved =
                    serde_json::to_value(repository.0.lock().unwrap().document.as_ref().unwrap())
                        .unwrap();
                assert_eq!(saved["schemaVersion"], 6);
                if legacy_row.is_some() {
                    assert_eq!(
                        saved["accounts"][0]["translation"]["chats"]["tg:123"]
                            .as_object()
                            .unwrap()
                            .len(),
                        7
                    );
                }
                assert_eq!(repository.0.lock().unwrap().saves, 1);
            }
        }
    }
}

#[test]
fn stored_telegram_policies_keep_cross_platform_chat_ids_separate() {
    let platforms = catalog::load().unwrap();
    for (platform, chat) in [
        ("telegram-z", "123@c.us"),
        ("telegram-k", "123@c.us"),
        ("whatsapp", "tg:123"),
    ] {
        let mut account = account(ProxyConfig::System);
        account.platform_id = platform.into();
        account.translation.chats.insert(
            chat.into(),
            ChatTranslationPolicy::from_policy(&TranslationPolicy::default()),
        );
        let document = Document {
            accounts: vec![account],
            ..Document::default()
        };
        assert!(document.validate(&platforms).is_err());
    }
}

#[test]
fn telegram_auto_uses_shared_billing_cache_and_requires_cutoff_group_and_current_policy() {
    for platform in ["telegram-k", "telegram-z"] {
        let h = setup();
        let mut account = account(ProxyConfig::System);
        account.platform_id = platform.into();
        account.translation.global.translation_mode = "auto".into();
        let mut automatic = event();
        automatic.manual = false;
        automatic.chat_id = "tg:123".into();
        automatic.sent_at = h.engine.auto_after();
        let work = h
            .engine
            .prepare(account.clone(), automatic.clone())
            .unwrap();
        h.gateway.token_reply(Ok(token("telegram-auto")), None);
        h.gateway
            .translation_reply(Ok(translated("Traduzione", Some(80))), None);
        assert_eq!(h.engine.execute(&work).unwrap(), "Traduzione");
        assert_eq!(h.engine.execute(&work).unwrap(), "Traduzione");
        assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
        assert_eq!(
            h.gateway.calls(Operation::Translate)[0]
                .request
                .as_ref()
                .unwrap()
                .id,
            automatic.id
        );
        for date in [0, h.engine.auto_after() - 1, now() + 600] {
            let mut old = automatic.clone();
            old.sent_at = date;
            assert!(matches!(
                h.engine.prepare(account.clone(), old),
                Err(AppError::TranslationUnavailable)
            ));
        }
        automatic.chat_id = "tg:-123".into();
        assert!(matches!(
            h.engine.prepare(account.clone(), automatic.clone()),
            Err(AppError::TranslationUnavailable)
        ));
        account.translation.global.group_auto = true;
        assert!(h.engine.prepare(account.clone(), automatic.clone()).is_ok());
        let mut chat = ChatTranslationPolicy::from_policy(&account.translation.global);
        chat.translation_mode = "click".into();
        account
            .translation
            .chats
            .insert(automatic.chat_id.clone(), chat);
        assert!(matches!(
            h.engine.prepare(account.clone(), automatic.clone()),
            Err(AppError::TranslationUnavailable)
        ));
        automatic.manual = true;
        assert!(h.engine.prepare(account.clone(), automatic.clone()).is_ok());
        automatic.manual = false;
        assert!(matches!(
            h.engine.prepare(account, automatic),
            Err(AppError::TranslationUnavailable)
        ));
        assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
    }
}

#[test]
fn telegram_auto_settings_rollback_conflict_and_restart_keep_other_accounts_unchanged() {
    for platform in ["telegram-k", "telegram-z"] {
        let repository = MemoryRepository::default();
        let mut accounts = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
        accounts
            .create("Active Telegram", platform, None, ProxyConfig::System)
            .unwrap();
        accounts
            .create("Other account", "whatsapp", None, ProxyConfig::System)
            .unwrap();
        let id = accounts.accounts()[0].id.clone();
        let before = accounts.accounts().to_vec();
        let policy = TranslationPolicy {
            translation_mode: "auto".into(),
            group_auto: true,
            ..TranslationPolicy::default()
        };
        repository.0.lock().unwrap().fail_save = true;
        assert_eq!(
            accounts.update_translation(&id, None, Some(policy.clone().into()), 0),
            Err(AppError::StoreIo)
        );
        assert_eq!(accounts.accounts(), before);
        repository.0.lock().unwrap().fail_save = false;
        accounts
            .update_translation(&id, None, Some(policy.clone().into()), 0)
            .unwrap();
        assert_eq!(
            accounts.update_translation(&id, None, Some(TranslationPolicy::default().into()), 0),
            Err(AppError::TranslationSettingsConflict)
        );
        let reopened = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
        assert_eq!(reopened.account(&id).unwrap().translation.global, policy);
        assert_eq!(reopened.accounts()[1], before[1]);
        let saves = repository.0.lock().unwrap().saves;
        let _ = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
        assert_eq!(repository.0.lock().unwrap().saves, saves);
    }
}
