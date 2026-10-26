use super::{
    session_support::Gate,
    translation_cache_support::{restart, setup},
    translation_support::{account, incoming, token, translated, Operation},
};
use crate::domain::{error::AppError, proxy::ProxyConfig};
use std::{
    sync::{mpsc, Arc},
    time::Duration,
};
use uuid::Uuid;

#[test]
fn restart_with_new_request_and_generation_hits_only_after_fresh_positive_quota() {
    let h = setup();
    let account = account(ProxyConfig::Socks5 {
        host: "synthetic.example.test".into(),
        port: 1080,
    });
    let event = incoming("durable");
    h.gateway.token_reply(Ok(token("first")), None);
    h.gateway
        .translation_reply(Ok(translated("persisted result", Some(90))), None);
    let first = h.engine.prepare(account.clone(), event.clone()).unwrap();
    assert_eq!(h.engine.execute(&first).unwrap(), "persisted result");
    let r = restart(&h);
    assert_ne!(
        first.lease.generation,
        r.session.capture_lease().unwrap().generation
    );
    assert!(!r.session.snapshot().unwrap().quota_fresh);
    let mut event = event;
    event.id = Uuid::new_v4().to_string();
    let next = r.engine.prepare(account.clone(), event).unwrap();
    assert_ne!(next.incoming.id, first.incoming.id);
    r.gateway.quota_reply(Ok(70), None);
    assert_eq!(r.engine.execute(&next).unwrap(), "persisted result");
    assert_eq!(r.gateway.calls(Operation::Quota).len(), 1);
    assert_eq!(r.gateway.calls(Operation::Quota)[0].proxy, account.proxy);
    assert!(r.gateway.calls(Operation::Token).is_empty());
    assert!(r.gateway.calls(Operation::Translate).is_empty());
    assert_eq!(r.session.snapshot().unwrap().remaining_chars, Some(70));
    assert_eq!(r.cache.0.lock().unwrap().loads, 2);
    assert_eq!(r.cache.0.lock().unwrap().writes, 1);
}

#[test]
fn cached_text_cannot_bypass_zero_network_failure_or_rejected_subscription() {
    for (reply, expected) in [
        (Ok(0), AppError::TranslationQuotaExhausted),
        (
            Err(AppError::NetworkUnavailable),
            AppError::NetworkUnavailable,
        ),
        (Err(AppError::SessionRequired), AppError::SessionRequired),
    ] {
        let h = setup();
        let account = account(ProxyConfig::System);
        let event = incoming("protected-result");
        h.gateway.token_reply(Ok(token("first")), None);
        h.gateway
            .translation_reply(Ok(translated("private display", Some(90))), None);
        h.engine
            .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
            .unwrap();
        let r = restart(&h);
        r.gateway.quota_reply(reply, None);
        let work = r.engine.prepare(account, event).unwrap();
        assert_eq!(r.engine.execute(&work), Err(expected));
        assert!(r.gateway.calls(Operation::Token).is_empty());
        assert!(r.gateway.calls(Operation::Translate).is_empty());
        assert_eq!(r.cache.0.lock().unwrap().writes, 1);
        if expected == AppError::SessionRequired {
            assert!(r.session.capture_lease().is_err());
        }
    }
}

#[test]
fn failed_optional_save_preserves_previous_document_and_paid_memory_result() {
    let h = setup();
    let account = account(ProxyConfig::System);
    h.gateway.token_reply(Ok(token("first")), None);
    h.gateway
        .translation_reply(Ok(translated("previous result", Some(90))), None);
    h.engine
        .execute(
            &h.engine
                .prepare(account.clone(), incoming("previous"))
                .unwrap(),
        )
        .unwrap();
    let before = h.cache.0.lock().unwrap().document.clone();
    h.cache.0.lock().unwrap().fail_next = true;
    h.gateway
        .translation_reply(Ok(translated("paid result", Some(80))), None);
    let work = h.engine.prepare(account, incoming("new")).unwrap();
    assert_eq!(h.engine.execute(&work).unwrap(), "paid result");
    assert_eq!(h.engine.execute(&work).unwrap(), "paid result");
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 2);
    assert_eq!(h.session.snapshot().unwrap().remaining_chars, Some(80));
    let state = h.cache.0.lock().unwrap();
    assert!(state.document == before);
    assert_eq!(state.writes, 1);
    assert_eq!(state.attempts, 2);
}

#[test]
fn later_refresh_completion_wins_over_older_network_response_in_memory_and_on_restart() {
    let h = setup();
    let account = account(ProxyConfig::System);
    let event = incoming("same-message");
    let old = h.engine.prepare(account.clone(), event.clone()).unwrap();
    let mut refresh_event = event.clone();
    refresh_event.id = Uuid::new_v4().to_string();
    refresh_event.refresh = true;
    let refresh = h.engine.prepare(account.clone(), refresh_event).unwrap();
    let gate = Arc::new(Gate::default());
    h.gateway.token_reply(Ok(token("first")), None);
    h.gateway.translation_reply(
        Ok(translated("old delayed result", Some(90))),
        Some(Arc::clone(&gate)),
    );
    let engine = Arc::clone(&h.engine);
    let old_worker = std::thread::spawn(move || engine.execute(&old));
    gate.entered();
    h.gateway
        .translation_reply(Ok(translated("new refresh result", Some(80))), None);
    let refreshed = h.engine.execute(&refresh);
    gate.release();
    assert_eq!(old_worker.join().unwrap().unwrap(), "old delayed result");
    assert_eq!(refreshed.unwrap(), "new refresh result");
    let current = h.engine.prepare(account.clone(), event.clone()).unwrap();
    assert_eq!(h.engine.execute(&current).unwrap(), "new refresh result");
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 2);
    assert_eq!(h.cache.0.lock().unwrap().writes, 1);
    let r = restart(&h);
    r.gateway.quota_reply(Ok(70), None);
    let current = r.engine.prepare(account, event).unwrap();
    assert_eq!(r.engine.execute(&current).unwrap(), "new refresh result");
    assert!(r.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn explicit_refresh_bypasses_both_caches_and_failure_is_not_disguised_as_cached_success() {
    let h = setup();
    let account = account(ProxyConfig::System);
    let event = incoming("refresh");
    h.gateway.token_reply(Ok(token("first")), None);
    h.gateway
        .translation_reply(Ok(translated("first result", Some(90))), None);
    h.engine
        .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
        .unwrap();
    let r = restart(&h);
    r.gateway.quota_reply(Ok(90), None);
    let mut refresh = event.clone();
    refresh.refresh = true;
    refresh.id = Uuid::new_v4().to_string();
    r.gateway.token_reply(Ok(token("refresh")), None);
    r.gateway
        .translation_reply(Ok(translated("refreshed result", Some(80))), None);
    let work = r.engine.prepare(account.clone(), refresh).unwrap();
    assert_eq!(r.engine.execute(&work).unwrap(), "refreshed result");
    let durable = r.cache.0.lock().unwrap().document.clone();
    // The same explicit refresh bypasses even the newly populated memory value.
    r.gateway
        .translation_reply(Err(AppError::TranslationResultUnavailable), None);
    assert_eq!(
        r.engine.execute(&work),
        Err(AppError::TranslationResultUnavailable)
    );
    assert!(r.cache.0.lock().unwrap().document == durable);
    let ordinary = r.engine.prepare(account, event).unwrap();
    assert_eq!(r.engine.execute(&ordinary).unwrap(), "refreshed result");
    assert_eq!(r.gateway.calls(Operation::Translate).len(), 2);
}

#[test]
fn slow_optional_write_does_not_block_durable_hits_or_another_paid_completion() {
    let h = setup();
    let account = account(ProxyConfig::System);
    let event = incoming("existing");
    h.gateway.token_reply(Ok(token("first")), None);
    h.gateway
        .translation_reply(Ok(translated("existing result", Some(90))), None);
    h.engine
        .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
        .unwrap();
    let r = restart(&h);
    r.gateway.quota_reply(Ok(90), None);
    r.gateway.token_reply(Ok(token("restart")), None);
    r.gateway
        .translation_reply(Ok(translated("slow saved result", Some(80))), None);
    let gate = Arc::new(Gate::default());
    r.cache.0.lock().unwrap().save_gate = Some(Arc::clone(&gate));
    let slow = r
        .engine
        .prepare(account.clone(), incoming("slow-save"))
        .unwrap();
    let engine = Arc::clone(&r.engine);
    let writer = std::thread::spawn(move || engine.execute(&slow));
    gate.entered();
    let old = r.engine.prepare(account.clone(), event).unwrap();
    let other = r
        .engine
        .prepare(account, incoming("other-completion"))
        .unwrap();
    r.gateway
        .translation_reply(Ok(translated("other paid result", Some(70))), None);
    let (send, receive) = mpsc::channel();
    let engine = Arc::clone(&r.engine);
    let reader = std::thread::spawn(move || {
        let cached = engine.execute(&old);
        let paid = engine.execute(&other);
        send.send((cached, paid)).unwrap();
    });
    let completed_without_disk = receive.recv_timeout(Duration::from_secs(2));
    gate.release();
    reader.join().unwrap();
    assert_eq!(writer.join().unwrap().unwrap(), "slow saved result");
    let (cached, paid) =
        completed_without_disk.expect("optional disk write blocked unrelated work");
    assert_eq!(cached.unwrap(), "existing result");
    assert_eq!(paid.unwrap(), "other paid result");
    assert_eq!(r.gateway.calls(Operation::Translate).len(), 2);
    assert_eq!(r.cache.0.lock().unwrap().writes, 2);
}

#[test]
fn logout_during_optional_save_prevents_late_delivery_without_holding_session_lock() {
    let h = setup();
    let account = account(ProxyConfig::System);
    h.gateway.token_reply(Ok(token("first")), None);
    h.gateway
        .translation_reply(Ok(translated("late paid result", Some(90))), None);
    let gate = Arc::new(Gate::default());
    h.cache.0.lock().unwrap().save_gate = Some(Arc::clone(&gate));
    let work = h.engine.prepare(account, incoming("late-save")).unwrap();
    let engine = Arc::clone(&h.engine);
    let worker = std::thread::spawn(move || engine.execute(&work));
    gate.entered();
    // This operation must complete before native I/O is released.
    h.session.logout().unwrap();
    gate.release();
    assert_eq!(worker.join().unwrap(), Err(AppError::TranslationCancelled));
}

#[test]
fn cancellation_or_logout_while_reading_cached_text_cannot_publish_it() {
    for logout in [false, true] {
        let h = setup();
        let account = account(ProxyConfig::System);
        let event = incoming("cancel-durable-hit");
        h.gateway.token_reply(Ok(token("first")), None);
        h.gateway
            .translation_reply(Ok(translated("private result", Some(90))), None);
        h.engine
            .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
            .unwrap();
        let r = restart(&h);
        r.gateway.quota_reply(Ok(90), None);
        let work = r.engine.prepare(account, event).unwrap();
        let cancel = work.control.clone();
        let gate = Arc::new(Gate::default());
        *r.wall.next_gate.lock().unwrap() = Some(Arc::clone(&gate));
        let engine = Arc::clone(&r.engine);
        let worker = std::thread::spawn(move || engine.execute(&work));
        gate.entered();
        if logout {
            r.session.logout().unwrap();
        } else {
            cancel.cancel();
        }
        gate.release();
        assert_eq!(worker.join().unwrap(), Err(AppError::TranslationCancelled));
        assert!(r.gateway.calls(Operation::Token).is_empty());
        assert!(r.gateway.calls(Operation::Translate).is_empty());
    }
}
