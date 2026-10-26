use super::{
    session_support::{self, Gate, NOW},
    translation_support::*,
};
use crate::{
    application::request_control::RequestControl,
    domain::{
        error::AppError,
        proxy::ProxyConfig,
        session::{SessionIssue, SessionState, QUOTA_AUTHORITY_TTL_MS},
    },
};
use std::{sync::Arc, time::Duration};

#[test]
fn expired_authority_refreshes_quota_and_sends_only_through_the_frozen_account_proxy() {
    let h = setup();
    let proxy = ProxyConfig::Http {
        host: "proxy.example.test".into(),
        port: 8080,
    };
    let mut original = account(proxy.clone());
    original.translation.global.message_target = "it".into();
    original.translation.global.route = "backup".into();
    let work = h
        .engine
        .prepare(original.clone(), incoming("route"))
        .unwrap();
    original.proxy = ProxyConfig::System;
    h.clock.set(NOW + QUOTA_AUTHORITY_TTL_MS);
    h.gateway.quota_reply(Ok(90), None);
    h.gateway.token_reply(Ok(token("route")), None);
    h.gateway
        .translation_reply(Ok(translated("Traduzione", Some(70))), None);
    assert_eq!(h.engine.execute(&work).unwrap(), "Traduzione");
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        let calls = h.gateway.calls(operation);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].proxy, proxy);
    }
    let calls = h.gateway.calls(Operation::Translate);
    let request = calls[0].request.as_ref().unwrap();
    assert_eq!(request.id, work.incoming.id);
    assert_eq!(request.target, "it");
    assert_eq!(request.route, "backup");
    assert_eq!(h.session.snapshot().unwrap().remaining_chars, Some(70));
}

#[test]
fn token_acquisition_is_serial_per_account_but_does_not_block_another_account() {
    let h = setup();
    let account_a = account(ProxyConfig::System);
    let account_b = account(ProxyConfig::Socks5 {
        host: "proxy-b.example.test".into(),
        port: 1080,
    });
    let a = h.engine.prepare(account_a.clone(), incoming("a")).unwrap();
    let mut waiting = h
        .engine
        .prepare(account_a.clone(), incoming("waiting"))
        .unwrap();
    let b = h.engine.prepare(account_b.clone(), incoming("b")).unwrap();
    let gate = Arc::new(Gate::default());
    h.gateway
        .token_reply(Ok(token("a")), Some(Arc::clone(&gate)));
    h.gateway.token_reply(Ok(token("b")), None);
    h.gateway
        .translation_reply(Ok(translated("B", Some(99))), None);
    h.gateway
        .translation_reply(Ok(translated("A", Some(98))), None);
    let engine = Arc::clone(&h.engine);
    let first = std::thread::spawn(move || engine.execute(&a));
    gate.entered();
    let engine = Arc::clone(&h.engine);
    let blocked = std::thread::spawn(move || {
        waiting.control = RequestControl::new(Duration::from_millis(40))
            .with_cancel(Arc::clone(&waiting.lease.cancel));
        engine.execute(&waiting)
    });
    let engine = Arc::clone(&h.engine);
    let independent = std::thread::spawn(move || engine.execute(&b));
    assert_eq!(independent.join().unwrap().unwrap(), "B");
    assert!(matches!(
        blocked.join().unwrap(),
        Err(AppError::TranslationTimeout)
    ));
    assert_eq!(h.gateway.calls(Operation::Token).len(), 2);
    assert_eq!(
        h.gateway.calls(Operation::Translate)[0].proxy,
        account_b.proxy
    );
    gate.release();
    assert_eq!(first.join().unwrap().unwrap(), "A");
    let again = h.engine.prepare(account_a, incoming("a-again")).unwrap();
    h.gateway
        .translation_reply(Ok(translated("A again", Some(97))), None);
    h.engine.execute(&again).unwrap();
    assert_eq!(h.gateway.calls(Operation::Token).len(), 2);
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls[0].credential, "synthetic-short-b");
    assert_eq!(calls[1].credential, "synthetic-short-a");
    assert_eq!(calls[2].credential, "synthetic-short-a");
}

#[test]
fn a_new_proxy_for_the_same_account_cannot_reuse_a_token_acquired_on_the_old_proxy() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    let first = h
        .engine
        .prepare(account.clone(), incoming("first"))
        .unwrap();
    h.gateway.token_reply(Ok(token("system")), None);
    h.gateway
        .translation_reply(Ok(translated("first", Some(90))), None);
    h.engine.execute(&first).unwrap();
    account.proxy = ProxyConfig::Http {
        host: "new-proxy.example.test".into(),
        port: 8181,
    };
    let second = h
        .engine
        .prepare(account.clone(), incoming("second"))
        .unwrap();
    h.gateway.token_reply(Ok(token("proxy")), None);
    h.gateway
        .translation_reply(Ok(translated("second", Some(80))), None);
    h.engine.execute(&second).unwrap();
    assert_eq!(h.gateway.calls(Operation::Token).len(), 2);
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls[1].credential, "synthetic-short-proxy");
    assert_eq!(calls[1].proxy, account.proxy);
}

#[test]
fn a_new_subscription_cannot_read_the_old_cache_or_reuse_its_short_token() {
    let h = setup();
    let account = account(ProxyConfig::System);
    let message = incoming("same-message");
    let old = h.engine.prepare(account.clone(), message.clone()).unwrap();
    h.gateway.token_reply(Ok(token("old-session")), None);
    h.gateway
        .translation_reply(Ok(translated("old result", Some(90))), None);
    h.engine.execute(&old).unwrap();
    session_support::login(&h.session, &h.auth, 2, 200);
    assert!(matches!(
        h.engine.execute(&old),
        Err(AppError::TranslationCancelled)
    ));
    let current = h.engine.prepare(account, message).unwrap();
    h.gateway.token_reply(Ok(token("new-session")), None);
    h.gateway
        .translation_reply(Ok(translated("new result", Some(190))), None);
    assert_eq!(h.engine.execute(&current).unwrap(), "new result");
    let tokens = h.gateway.calls(Operation::Token);
    assert_eq!(tokens.len(), 2);
    assert_eq!(tokens[1].credential, "synthetic-session-token-2");
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 2);
}

#[test]
fn known_auth_denial_blocks_cached_and_in_flight_short_tokens_even_if_logout_cannot_save() {
    let h = setup();
    let account_a = account(ProxyConfig::System);
    let warmed = h
        .engine
        .prepare(account_a.clone(), incoming("warm"))
        .unwrap();
    h.gateway.token_reply(Ok(token("cached")), None);
    h.gateway
        .translation_reply(Ok(translated("warm", Some(90))), None);
    h.engine.execute(&warmed).unwrap();
    let cached = h
        .engine
        .prepare(account_a, incoming("cached-pending"))
        .unwrap();
    let waiting = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("token-pending"))
        .unwrap();
    let gate = Arc::new(Gate::default());
    h.gateway
        .token_reply(Ok(token("late-but-valid")), Some(Arc::clone(&gate)));
    let engine = Arc::clone(&h.engine);
    let worker = std::thread::spawn(move || engine.execute(&waiting));
    gate.entered();
    h.repository.0.lock().unwrap().fail_next = true;
    let lease = h.session.capture_lease().unwrap();
    assert!(matches!(
        h.session.reject_auth(&lease, AppError::SessionRequired),
        Err(AppError::SessionPersistence)
    ));
    gate.release();
    assert!(matches!(
        worker.join().unwrap(),
        Err(AppError::TranslationCancelled)
    ));
    assert!(matches!(
        h.engine.execute(&cached),
        Err(AppError::TranslationCancelled)
    ));
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
    let snapshot = h.session.snapshot().unwrap();
    assert_eq!(snapshot.state, SessionState::SignedIn);
    assert_eq!(snapshot.issue, Some(SessionIssue::PersistenceFailed));
    assert!(!snapshot.quota_fresh);
}

#[test]
fn a_late_paid_response_after_logout_cannot_restore_quota_or_publish_a_translation() {
    let h = setup();
    let work = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("late"))
        .unwrap();
    h.gateway.token_reply(Ok(token("late")), None);
    let gate = Arc::new(Gate::default());
    h.gateway.translation_reply(
        Ok(translated("already paid", Some(20))),
        Some(Arc::clone(&gate)),
    );
    let engine = Arc::clone(&h.engine);
    let worker = std::thread::spawn(move || engine.execute(&work));
    gate.entered();
    let signed_out = h.session.logout().unwrap();
    gate.release();
    assert!(matches!(
        worker.join().unwrap(),
        Err(AppError::TranslationCancelled)
    ));
    assert_eq!(h.session.snapshot().unwrap(), signed_out);
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}

#[test]
fn null_balance_success_is_returned_once_and_the_cache_requires_new_quota_authority() {
    let h = setup();
    let work = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("null"))
        .unwrap();
    h.gateway.token_reply(Ok(token("null")), None);
    h.gateway
        .translation_reply(Ok(translated("translated", None)), None);
    assert_eq!(h.engine.execute(&work).unwrap(), "translated");
    assert!(!h.session.snapshot().unwrap().quota_fresh);
    h.gateway.quota_reply(Ok(80), None);
    assert_eq!(h.engine.execute(&work).unwrap(), "translated");
    assert_eq!(h.gateway.calls(Operation::Quota).len(), 1);
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
    assert_eq!(h.gateway.calls(Operation::Token).len(), 1);
    assert_eq!(h.session.snapshot().unwrap().remaining_chars, Some(80));
}

#[test]
fn a_paid_success_survives_failed_mirror_persistence_without_another_translation_call() {
    let h = setup();
    let work = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("mirror"))
        .unwrap();
    h.gateway.token_reply(Ok(token("mirror")), None);
    h.gateway
        .translation_reply(Ok(translated("paid result", Some(60))), None);
    h.repository.0.lock().unwrap().fail_next = true;
    assert_eq!(h.engine.execute(&work).unwrap(), "paid result");
    assert_eq!(
        h.session.snapshot().unwrap().issue,
        Some(SessionIssue::PersistenceFailed)
    );
    assert_eq!(h.engine.execute(&work).unwrap(), "paid result");
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}

#[test]
fn cached_text_is_not_returned_when_new_authoritative_balance_is_zero() {
    let h = setup();
    let work = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("cache"))
        .unwrap();
    h.gateway.token_reply(Ok(token("cache")), None);
    h.gateway
        .translation_reply(Ok(translated("cached result", Some(90))), None);
    h.engine.execute(&work).unwrap();
    h.clock.set(NOW + QUOTA_AUTHORITY_TTL_MS);
    h.gateway.quota_reply(Ok(0), None);
    assert!(matches!(
        h.engine.execute(&work),
        Err(AppError::TranslationQuotaExhausted)
    ));
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
    assert_eq!(h.session.snapshot().unwrap().remaining_chars, Some(0));
}

#[test]
fn in_progress_and_one_short_token_refresh_keep_the_same_request_id_and_route() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    account.translation.global.route = "primary".into();
    let work = h.engine.prepare(account, incoming("stable-id")).unwrap();
    h.gateway.token_reply(Ok(token("expired")), None);
    h.gateway.token_reply(Ok(token("renewed")), None);
    h.gateway
        .translation_reply(Err(AppError::TranslationInProgress), None);
    h.gateway
        .translation_reply(Err(AppError::TranslationUnauthorized), None);
    h.gateway
        .translation_reply(Ok(translated("done", Some(90))), None);
    assert_eq!(h.engine.execute(&work).unwrap(), "done");
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 3);
    for call in &calls {
        let request = call.request.as_ref().unwrap();
        assert_eq!(request.id, work.incoming.id);
        assert_eq!(request.route, "primary");
        assert_eq!(request.text, work.incoming.text);
    }
    assert_eq!(calls[0].credential, "synthetic-short-expired");
    assert_eq!(calls[2].credential, "synthetic-short-renewed");
    assert_eq!(h.gateway.calls(Operation::Token).len(), 2);
}

#[test]
fn a_second_short_token_denial_and_uncertain_network_failures_are_not_auto_retried() {
    for error in [
        AppError::TranslationUnauthorized,
        AppError::NetworkUnavailable,
    ] {
        let h = setup();
        let work = h
            .engine
            .prepare(account(ProxyConfig::System), incoming("failure"))
            .unwrap();
        h.gateway.token_reply(Ok(token("one")), None);
        if error == AppError::TranslationUnauthorized {
            h.gateway.token_reply(Ok(token("two")), None);
            h.gateway.translation_reply(Err(error), None);
        }
        h.gateway.translation_reply(Err(error), None);
        assert!(matches!(h.engine.execute(&work), Err(actual) if actual == error));
        let expected = if error == AppError::TranslationUnauthorized {
            2
        } else {
            1
        };
        assert_eq!(h.gateway.calls(Operation::Translate).len(), expected);
        assert_eq!(h.gateway.calls(Operation::Token).len(), expected);
    }
}

#[test]
fn cancellation_during_in_progress_wait_stops_retries_without_a_new_id() {
    let h = setup();
    let work = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("cancel-wait"))
        .unwrap();
    let cancel = work.control.clone();
    h.gateway.token_reply(Ok(token("cancel")), None);
    h.gateway
        .translation_reply(Err(AppError::TranslationInProgress), None);
    let engine = Arc::clone(&h.engine);
    let worker = std::thread::spawn(move || engine.execute(&work));
    h.gateway.wait_for(Operation::Translate, 1);
    cancel.cancel();
    assert!(matches!(
        worker.join().unwrap(),
        Err(AppError::TranslationCancelled)
    ));
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}
