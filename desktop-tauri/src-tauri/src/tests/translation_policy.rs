use super::translation_support::*;
use crate::domain::{
    error::AppError,
    proxy::ProxyConfig,
    translation::{IncomingTranslation, TranslationPolicy, TranslationSettings, MAX_CHAT_POLICIES},
};

#[test]
fn manual_history_requires_the_message_action_and_current_policy_revision() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    let mut old = incoming("history");
    old.sent_at = 1;
    assert!(h.engine.prepare(account.clone(), old.clone()).is_ok());
    account.translation.global.message_action = false;
    assert!(matches!(
        h.engine.prepare(account.clone(), old.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    account.translation.global.message_action = true;
    account.translation.revision = 4;
    assert!(matches!(
        h.engine.prepare(account.clone(), old.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    old.policy_revision = 4;
    assert!(h.engine.prepare(account, old).is_ok());
    assert!(h.gateway.calls(Operation::Token).is_empty());
}

#[test]
fn automatic_translation_rejects_history_future_messages_and_disallowed_groups() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    account.translation.global.translation_mode = "auto".into();
    let mut event = incoming("auto");
    event.manual = false;
    event.sent_at = h.engine.auto_after();
    assert!(h.engine.prepare(account.clone(), event.clone()).is_ok());
    event.sent_at = h.engine.auto_after() - 1;
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    event.sent_at = now() + 600;
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    event.sent_at = h.engine.auto_after();
    event.chat_id = "12025550123-12345@g.us".into();
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    account.translation.global.group_auto = true;
    assert!(h.engine.prepare(account.clone(), event.clone()).is_ok());
    event.refresh = true;
    assert!(matches!(
        h.engine.prepare(account, event),
        Err(AppError::TranslationUnavailable)
    ));
}

#[test]
fn auto_to_chinese_skips_existing_han_text_but_explicit_manual_remains_available() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    account.translation.global.translation_mode = "auto".into();
    let mut event = incoming("already-han");
    event.manual = false;
    event.sent_at = h.engine.auto_after();
    event.text = "请明天发送100件。".into();
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    event.manual = true;
    assert!(h.engine.prepare(account.clone(), event.clone()).is_ok());
    event.manual = false;
    account.translation.global.message_target = "en".into();
    assert!(h.engine.prepare(account, event).is_ok());
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn chat_policy_overrides_global_and_disabled_display_never_calls_the_gateway() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    account.translation.global.display_translation = false;
    let event = incoming("chat-override");
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    let policy = TranslationPolicy {
        message_target: "it".into(),
        ..TranslationPolicy::default()
    };
    account
        .translation
        .chats
        .insert(event.chat_id.clone(), policy);
    let work = h.engine.prepare(account, event).unwrap();
    h.gateway.token_reply(Ok(token("override")), None);
    h.gateway
        .translation_reply(Ok(translated("translated", Some(90))), None);
    h.engine.execute(&work).unwrap();
    assert_eq!(
        h.gateway.calls(Operation::Translate)[0]
            .request
            .as_ref()
            .unwrap()
            .target,
        "it"
    );
}

#[test]
fn unsupported_outgoing_and_history_flags_fail_before_any_network_operation() {
    let h = setup();
    for (enabled, auto_send, history) in [
        (true, false, false),
        (false, true, false),
        (false, false, true),
    ] {
        let mut account = account(ProxyConfig::System);
        account.translation.global.enabled = enabled;
        account.translation.global.auto_send = auto_send;
        account.translation.global.translate_history = history;
        assert!(matches!(
            h.engine.prepare(account, incoming("unsupported")),
            Err(AppError::TranslationUnavailable)
        ));
    }
    for platform in ["telegram", "line", "website"] {
        let mut account = account(ProxyConfig::System);
        account.platform_id = platform.into();
        assert!(matches!(
            h.engine.prepare(account, incoming("platform")),
            Err(AppError::TranslationUnavailable)
        ));
    }
    let mut archived = account(ProxyConfig::System);
    archived.archived = true;
    assert!(matches!(
        h.engine.prepare(archived, incoming("archived")),
        Err(AppError::TranslationUnavailable)
    ));
    assert!(h.gateway.calls(Operation::Quota).is_empty());
    assert!(h.gateway.calls(Operation::Token).is_empty());
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn text_and_request_metadata_are_bounded_before_network_admission() {
    let h = setup();
    let account = account(ProxyConfig::System);
    let mut event = incoming("bounds");
    event.text = "😀".repeat(5_000);
    assert!(h.engine.prepare(account.clone(), event.clone()).is_ok());
    event.text.push('😀');
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationInvalid)
    ));
    for text in [" \n\t".to_owned(), "a\0b".into(), "x".repeat(32_769)] {
        event.text = text;
        assert!(matches!(
            h.engine.prepare(account.clone(), event.clone()),
            Err(AppError::TranslationInvalid)
        ));
    }
    event = incoming("metadata");
    event.attempt = 0;
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationInvalid)
    ));
    event.attempt = 1;
    event.chat_id = "status@broadcast".into();
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationInvalid)
    ));
    event.chat_id = "12025550123@c.us".into();
    event.message_id = "x".repeat(257);
    assert!(matches!(
        h.engine.prepare(account, event),
        Err(AppError::TranslationInvalid)
    ));
    assert!(h.gateway.calls(Operation::Token).is_empty());
}

#[test]
fn persisted_chat_settings_are_bounded_and_cannot_inject_unknown_input_fields() {
    let mut settings = TranslationSettings::default();
    for id in 0..MAX_CHAT_POLICIES {
        settings
            .chats
            .insert(format!("{id}@c.us"), TranslationPolicy::default());
    }
    settings.validate().unwrap();
    settings
        .chats
        .insert("100000@c.us".into(), TranslationPolicy::default());
    assert!(matches!(
        settings.validate(),
        Err(AppError::TranslationLimit)
    ));
    let input = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(), "chatId": "123@c.us", "messageId": "synthetic",
        "text": "incoming", "manual": true, "policyRevision": 0, "attempt": 1, "sentAt": now(),
        "token": "renderer-must-not-supply-this"
    });
    assert!(serde_json::from_value::<IncomingTranslation>(input).is_err());
    let invalid = TranslationPolicy {
        provider: "https://attacker.invalid".into(),
        ..TranslationPolicy::default()
    };
    assert!(matches!(
        invalid.validate(),
        Err(AppError::TranslationInvalid)
    ));
}
