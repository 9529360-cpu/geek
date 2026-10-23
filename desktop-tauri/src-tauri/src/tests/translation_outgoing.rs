use super::{
    session_support::{self, Gate},
    translation_support::*,
};
use crate::{
    application::{
        request_control::RequestControl,
        translation_ports::{OutgoingTranslation, TranslationIntent},
    },
    domain::{
        account::Account, error::AppError, proxy::ProxyConfig, translation::ChatTranslationPolicy,
    },
};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

fn sending_account() -> Account {
    let mut account = account(ProxyConfig::System);
    account.translation.global.enabled = true;
    account.translation.global.auto_send = true;
    account
}

fn outgoing() -> OutgoingTranslation {
    OutgoingTranslation {
        id: Uuid::new_v4().to_string(),
        chat_id: "12025550123@c.us".into(),
        text: "Synthetic outgoing source".into(),
        policy_revision: 0,
    }
}

fn budget() -> RequestControl {
    RequestControl::new(Duration::from_secs(50))
}

#[test]
fn identity_policies_are_rejected_before_subscription_admission_or_network() {
    let h = setup();
    h.session.logout().unwrap();
    for (enabled, auto_send, include_zh, source) in [
        (false, false, true, "Synthetic source"),
        (true, false, true, "Synthetic source"),
        (false, true, true, "Synthetic source"),
        (true, true, false, "Synthetic 你好 source"),
    ] {
        let mut account = sending_account();
        account.translation.global.enabled = enabled;
        account.translation.global.auto_send = auto_send;
        account.translation.global.include_zh = include_zh;
        let mut event = outgoing();
        event.text = source.into();
        assert!(matches!(
            h.engine.prepare_outgoing(account, event, budget()),
            Err(AppError::TranslationUnavailable)
        ));
    }
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}

#[test]
fn outgoing_validation_requires_the_current_policy_a_supported_account_and_valid_request() {
    let h = setup();
    let account = sending_account();
    let mut pure = account.clone();
    pure.platform_id = "whatsapp-pure".into();
    assert!(h
        .engine
        .prepare_outgoing(pure, outgoing(), budget())
        .is_ok());
    let mut stale = outgoing();
    stale.policy_revision = 1;
    assert!(matches!(
        h.engine.prepare_outgoing(account.clone(), stale, budget()),
        Err(AppError::TranslationUnavailable)
    ));
    for platform in ["telegram", "line", "website"] {
        let mut unsupported = account.clone();
        unsupported.platform_id = platform.into();
        assert!(matches!(
            h.engine.prepare_outgoing(unsupported, outgoing(), budget()),
            Err(AppError::TranslationUnavailable)
        ));
    }
    let mut archived = account.clone();
    archived.archived = true;
    assert!(matches!(
        h.engine.prepare_outgoing(archived, outgoing(), budget()),
        Err(AppError::TranslationUnavailable)
    ));
    for field in ["id", "chat", "text"] {
        let mut invalid = outgoing();
        match field {
            "id" => invalid.id = "not-a-native-uuid".into(),
            "chat" => invalid.chat_id = "123@newsletter".into(),
            _ => invalid.text = " ".into(),
        }
        assert!(matches!(
            h.engine
                .prepare_outgoing(account.clone(), invalid, budget()),
            Err(AppError::TranslationInvalid)
        ));
    }
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn outgoing_uses_frozen_effective_send_languages_and_proxy_independently_of_receive_settings() {
    let h = setup();
    let mut account = sending_account();
    account.proxy = ProxyConfig::Socks5 {
        host: "synthetic-proxy.example.test".into(),
        port: 1080,
    };
    let original_proxy = account.proxy.clone();
    let event = outgoing();
    account.translation.global.source = "fr".into();
    account.translation.global.provider = "local".into();
    account.translation.global.route = "backup".into();
    let mut policy = account.translation.global.clone();
    policy.target = "it".into();
    policy.message_from = "auto".into();
    policy.message_target = "zh".into();
    policy.message_action = false;
    policy.display_translation = false;
    account.translation.chats.insert(
        event.chat_id.clone(),
        ChatTranslationPolicy::from_policy(&policy),
    );
    let work = h
        .engine
        .prepare_outgoing(account.clone(), event.clone(), budget())
        .unwrap();
    account.proxy = ProxyConfig::System;
    account.translation.chats.clear();
    account.translation.global.source = "en".into();
    account.translation.global.route = "primary".into();
    h.gateway.token_reply(Ok(token("outgoing")), None);
    h.gateway
        .translation_reply(Ok(translated("Testo tradotto", Some(80))), None);
    assert_eq!(h.engine.execute_outgoing(&work).unwrap(), "Testo tradotto");
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].proxy, original_proxy);
    let request = calls[0].request.as_ref().unwrap();
    assert_eq!(request.id, event.id);
    assert_eq!(request.text, event.text);
    assert_eq!(request.intent, TranslationIntent::OutgoingSend);
    assert_eq!(request.source, "fr");
    assert_eq!(request.target, "it");
    assert_eq!(request.provider, "local");
    assert_eq!(request.route, "backup");
}

#[test]
fn outgoing_cache_recovers_only_the_same_send_id_and_never_aliases_incoming_messages() {
    let h = setup();
    let mut account = sending_account();
    account.translation.global.message_target = "en".into();
    let first = outgoing();
    h.gateway.token_reply(Ok(token("cache")), None);
    h.gateway
        .translation_reply(Ok(translated("First send", Some(99))), None);
    let prepared = h
        .engine
        .prepare_outgoing(account.clone(), first.clone(), budget())
        .unwrap();
    assert_eq!(h.engine.execute_outgoing(&prepared).unwrap(), "First send");
    let recovered = h
        .engine
        .prepare_outgoing(account.clone(), first.clone(), budget())
        .unwrap();
    assert_eq!(h.engine.execute_outgoing(&recovered).unwrap(), "First send");
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);

    let mut second = first.clone();
    second.id = Uuid::new_v4().to_string();
    h.gateway
        .translation_reply(Ok(translated("Second send", Some(98))), None);
    let prepared = h
        .engine
        .prepare_outgoing(account.clone(), second, budget())
        .unwrap();
    assert_eq!(h.engine.execute_outgoing(&prepared).unwrap(), "Second send");

    let mut received = incoming(&first.id);
    received.id = first.id;
    received.text = first.text;
    h.gateway
        .translation_reply(Ok(translated("Received message", Some(97))), None);
    let prepared = h.engine.prepare(account, received).unwrap();
    assert_eq!(h.engine.execute(&prepared).unwrap(), "Received message");
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 3);
    assert_eq!(
        calls[2].request.as_ref().unwrap().intent,
        TranslationIntent::MessageDisplay
    );
}

#[test]
fn outgoing_cache_and_short_tokens_remain_account_and_subscription_bound() {
    let h = setup();
    let first = sending_account();
    let second = sending_account();
    let event = outgoing();
    for (account, name) in [(&first, "first-account"), (&second, "second-account")] {
        h.gateway.token_reply(Ok(token(name)), None);
        h.gateway
            .translation_reply(Ok(translated(name, Some(90))), None);
        let work = h
            .engine
            .prepare_outgoing(account.clone(), event.clone(), budget())
            .unwrap();
        assert_eq!(h.engine.execute_outgoing(&work).unwrap(), name);
    }
    session_support::login(&h.session, &h.auth, 2, 100);
    h.gateway.token_reply(Ok(token("new-session")), None);
    h.gateway
        .translation_reply(Ok(translated("new-session", Some(90))), None);
    let work = h.engine.prepare_outgoing(first, event, budget()).unwrap();
    assert_eq!(h.engine.execute_outgoing(&work).unwrap(), "new-session");
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 3);
    let tokens = h.gateway.calls(Operation::Token);
    assert_eq!(tokens.len(), 3);
    assert_eq!(tokens[2].credential, "synthetic-session-token-2");
}

#[test]
fn ambiguous_network_failure_does_not_retry_or_replace_the_id_and_explicit_recovery_reuses_it() {
    let h = setup();
    let account = sending_account();
    let event = outgoing();
    let work = h
        .engine
        .prepare_outgoing(account.clone(), event.clone(), budget())
        .unwrap();
    h.gateway.token_reply(Ok(token("recovery")), None);
    h.gateway
        .translation_reply(Err(AppError::NetworkUnavailable), None);
    assert_eq!(
        h.engine.execute_outgoing(&work),
        Err(AppError::NetworkUnavailable)
    );
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
    h.gateway
        .translation_reply(Ok(translated("Recovered once", Some(90))), None);
    let recovered = h
        .engine
        .prepare_outgoing(account, event.clone(), budget())
        .unwrap();
    assert_eq!(
        h.engine.execute_outgoing(&recovered).unwrap(),
        "Recovered once"
    );
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 2);
    for call in calls {
        let request = call.request.unwrap();
        assert_eq!(request.id, event.id);
        assert_eq!(request.text, event.text);
        assert_eq!(request.intent, TranslationIntent::OutgoingSend);
    }
}

#[test]
fn in_progress_and_short_token_refresh_preserve_the_outgoing_id_payload_and_intent() {
    let h = setup();
    let event = outgoing();
    let work = h
        .engine
        .prepare_outgoing(sending_account(), event.clone(), budget())
        .unwrap();
    h.gateway.token_reply(Ok(token("initial")), None);
    h.gateway.token_reply(Ok(token("renewed")), None);
    h.gateway
        .translation_reply(Err(AppError::TranslationInProgress), None);
    h.gateway
        .translation_reply(Err(AppError::TranslationUnauthorized), None);
    h.gateway
        .translation_reply(Ok(translated("Translated once", Some(90))), None);
    assert_eq!(h.engine.execute_outgoing(&work).unwrap(), "Translated once");
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 3);
    for call in calls {
        let request = call.request.unwrap();
        assert_eq!(request.id, event.id);
        assert_eq!(request.text, event.text);
        assert_eq!(request.intent, TranslationIntent::OutgoingSend);
    }
    assert_eq!(h.gateway.calls(Operation::Token).len(), 2);
}

#[test]
fn outgoing_preparation_caps_the_existing_budget_and_parent_cancellation_blocks_all_io() {
    let h = setup();
    let parent = budget();
    let work = h
        .engine
        .prepare_outgoing(sending_account(), outgoing(), parent.clone())
        .unwrap();
    assert!(work.control.remaining().unwrap() <= Duration::from_secs(35));
    let short = RequestControl::new(Duration::from_secs(5));
    let shorter = h
        .engine
        .prepare_outgoing(sending_account(), outgoing(), short)
        .unwrap();
    assert!(shorter.control.remaining().unwrap() <= Duration::from_secs(5));
    parent.cancel();
    assert_eq!(
        h.engine.execute_outgoing(&work),
        Err(AppError::TranslationCancelled)
    );
    assert!(matches!(
        h.engine.prepare_outgoing(
            sending_account(),
            outgoing(),
            RequestControl::new(Duration::ZERO)
        ),
        Err(AppError::TranslationTimeout)
    ));
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}

#[test]
fn cancellation_during_token_resolution_cannot_start_a_late_paid_request() {
    let h = setup();
    let parent = budget();
    let work = h
        .engine
        .prepare_outgoing(sending_account(), outgoing(), parent.clone())
        .unwrap();
    let gate = Arc::new(Gate::default());
    h.gateway
        .token_reply(Ok(token("late")), Some(Arc::clone(&gate)));
    let engine = Arc::clone(&h.engine);
    let worker = std::thread::spawn(move || engine.execute_outgoing(&work));
    gate.entered();
    parent.cancel();
    gate.release();
    assert_eq!(worker.join().unwrap(), Err(AppError::TranslationCancelled));
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn a_paid_response_after_logout_cannot_reauthorize_or_return_an_outgoing_translation() {
    let h = setup();
    let work = h
        .engine
        .prepare_outgoing(sending_account(), outgoing(), budget())
        .unwrap();
    let gate = Arc::new(Gate::default());
    h.gateway.token_reply(Ok(token("late")), None);
    h.gateway.translation_reply(
        Ok(translated("Paid but stale", Some(10))),
        Some(Arc::clone(&gate)),
    );
    let engine = Arc::clone(&h.engine);
    let worker = std::thread::spawn(move || engine.execute_outgoing(&work));
    gate.entered();
    let signed_out = h.session.logout().unwrap();
    gate.release();
    assert_eq!(worker.join().unwrap(), Err(AppError::TranslationCancelled));
    assert_eq!(h.session.snapshot().unwrap(), signed_out);
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}
