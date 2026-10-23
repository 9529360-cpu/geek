use super::{
    session_support::{self, server_login, server_refresh},
    translation_cache_support::{restart, setup, WALL_NOW},
    translation_support::{account, incoming, token, translated, Operation},
};
use crate::{
    application::{request_control::RequestControl, translation_ports::OutgoingTranslation},
    domain::{
        error::AppError,
        proxy::ProxyConfig,
        translation_cache::{
            TranslationCacheDocument, MAX_TRANSLATION_CACHE_ENTRY_BYTES,
            MAX_TRANSLATION_CACHE_PLAIN_BYTES, TRANSLATION_CACHE_TTL_SECONDS,
        },
    },
};
use std::time::Duration;
use uuid::Uuid;

#[test]
fn stable_cache_is_separated_by_subscription_account_platform_message_and_transform_semantics() {
    let h = setup();
    let original_account = account(ProxyConfig::System);
    let original_event = incoming("isolation");
    h.gateway.token_reply(Ok(token("seed")), None);
    h.gateway
        .translation_reply(Ok(translated("original private result", Some(90))), None);
    h.engine
        .execute(
            &h.engine
                .prepare(original_account.clone(), original_event.clone())
                .unwrap(),
        )
        .unwrap();
    for dimension in [
        "user",
        "account-no",
        "account",
        "platform",
        "chat",
        "message",
        "text",
        "source",
        "target",
        "provider",
        "route",
    ] {
        let r = restart(&h);
        let mut account = original_account.clone();
        let mut event = original_event.clone();
        event.id = Uuid::new_v4().to_string();
        match dimension {
            "user" => {
                session_support::login(&r.session, &r.auth, 2, 90);
            }
            "account-no" => {
                let mut login = server_login(1);
                login.user.account_no = server_login(2).user.account_no;
                let mut refresh = server_refresh(1, 90);
                refresh.user = login.user.clone();
                let email = login.user.email.clone();
                r.auth.login_reply(Ok(login), None);
                r.auth.refresh_reply(Ok(refresh), None);
                r.session
                    .login(&email, "synthetic-password".into())
                    .unwrap();
            }
            "account" => account.id = Uuid::new_v4().to_string(),
            "platform" => account.platform_id = "whatsapp-pure".into(),
            "chat" => event.chat_id = "12025550999@c.us".into(),
            "message" => event.message_id = "other-message-id".into(),
            "text" => event.text.push_str(" with an edit"),
            "source" => account.translation.global.message_from = "fr".into(),
            "target" => account.translation.global.message_target = "it".into(),
            "provider" => account.translation.global.provider = "local".into(),
            "route" => account.translation.global.route = "backup".into(),
            _ => unreachable!(),
        }
        r.gateway.quota_reply(Ok(90), None);
        r.gateway.token_reply(Ok(token(dimension)), None);
        r.gateway
            .translation_reply(Ok(translated(dimension, Some(80))), None);
        let work = r.engine.prepare(account, event).unwrap();
        assert_eq!(r.engine.execute(&work).unwrap(), dimension);
        assert_eq!(r.gateway.calls(Operation::Translate).len(), 1);
    }
}

#[test]
fn appearance_revision_and_egress_do_not_rebill_identical_receive_semantics() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    let mut event = incoming("appearance");
    h.gateway.token_reply(Ok(token("seed")), None);
    h.gateway
        .translation_reply(Ok(translated("unchanged semantic result", Some(90))), None);
    h.engine
        .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
        .unwrap();
    let r = restart(&h);
    account.name = "Changed display name".into();
    account.font_size = 18;
    account.translation.global.font_size = 15;
    account.translation.global.font_color = "#123456".into();
    account.translation.revision = 17;
    account.proxy = ProxyConfig::Http {
        host: "new-egress.example.test".into(),
        port: 8080,
    };
    event.policy_revision = 17;
    event.id = Uuid::new_v4().to_string();
    r.gateway.quota_reply(Ok(80), None);
    let work = r.engine.prepare(account.clone(), event).unwrap();
    assert_eq!(
        r.engine.execute(&work).unwrap(),
        "unchanged semantic result"
    );
    assert_eq!(r.gateway.calls(Operation::Quota)[0].proxy, account.proxy);
    assert!(r.gateway.calls(Operation::Token).is_empty());
    assert!(r.gateway.calls(Operation::Translate).is_empty());
    assert_eq!(r.cache.0.lock().unwrap().writes, 1);
}

#[test]
fn outgoing_keeps_same_send_only_memory_recovery_and_never_reads_or_writes_durable_cache() {
    let h = setup();
    let mut account = account(ProxyConfig::System);
    account.translation.global.enabled = true;
    account.translation.global.auto_send = true;
    let event = incoming("separate-intent");
    h.gateway.token_reply(Ok(token("seed")), None);
    h.gateway
        .translation_reply(Ok(translated("incoming result", Some(90))), None);
    h.engine
        .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
        .unwrap();
    let before = h.cache.0.lock().unwrap().document.clone();
    let outgoing = OutgoingTranslation {
        id: event.id,
        chat_id: event.chat_id,
        text: event.text,
        policy_revision: 0,
    };
    h.gateway
        .translation_reply(Ok(translated("first outgoing", Some(80))), None);
    let work = h
        .engine
        .prepare_outgoing(
            account.clone(),
            outgoing.clone(),
            RequestControl::new(Duration::from_secs(50)),
        )
        .unwrap();
    assert_eq!(h.engine.execute_outgoing(&work).unwrap(), "first outgoing");
    assert_eq!(h.engine.execute_outgoing(&work).unwrap(), "first outgoing");
    let mut independent = outgoing.clone();
    independent.id = Uuid::new_v4().to_string();
    h.gateway
        .translation_reply(Ok(translated("independent outgoing", Some(70))), None);
    let separate = h
        .engine
        .prepare_outgoing(
            account.clone(),
            independent,
            RequestControl::new(Duration::from_secs(50)),
        )
        .unwrap();
    assert_eq!(
        h.engine.execute_outgoing(&separate).unwrap(),
        "independent outgoing"
    );
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 3);
    assert!(h.cache.0.lock().unwrap().document == before);
    let r = restart(&h);
    r.gateway.quota_reply(Ok(60), None);
    r.gateway.token_reply(Ok(token("restart")), None);
    r.gateway
        .translation_reply(Ok(translated("outgoing after restart", Some(50))), None);
    let same_id = r
        .engine
        .prepare_outgoing(
            account,
            outgoing,
            RequestControl::new(Duration::from_secs(50)),
        )
        .unwrap();
    assert_eq!(
        r.engine.execute_outgoing(&same_id).unwrap(),
        "outgoing after restart"
    );
    assert_eq!(r.gateway.calls(Operation::Translate).len(), 1);
    assert!(r.cache.0.lock().unwrap().document == before);
    assert_eq!(r.cache.0.lock().unwrap().writes, 1);
}

#[test]
fn durable_read_does_not_extend_ttl_and_observed_expiry_cannot_revive_on_clock_rollback() {
    let h = setup();
    let account = account(ProxyConfig::System);
    let event = incoming("ttl");
    h.gateway.token_reply(Ok(token("seed")), None);
    h.gateway
        .translation_reply(Ok(translated("old cached result", Some(90))), None);
    h.engine
        .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
        .unwrap();
    let r = restart(&h);
    let work = r.engine.prepare(account, event).unwrap();
    r.wall.set(WALL_NOW + TRANSLATION_CACHE_TTL_SECONDS - 1);
    r.gateway.quota_reply(Ok(90), None);
    assert_eq!(r.engine.execute(&work).unwrap(), "old cached result");
    r.wall.set(WALL_NOW + TRANSLATION_CACHE_TTL_SECONDS);
    r.gateway
        .token_reply(Err(AppError::NetworkUnavailable), None);
    assert_eq!(r.engine.execute(&work), Err(AppError::NetworkUnavailable));
    r.wall.set(WALL_NOW + 1);
    r.gateway
        .token_reply(Err(AppError::NetworkUnavailable), None);
    assert_eq!(r.engine.execute(&work), Err(AppError::NetworkUnavailable));
    assert_eq!(r.gateway.calls(Operation::Token).len(), 2);
    assert!(r.gateway.calls(Operation::Translate).is_empty());
    let state = r.cache.0.lock().unwrap();
    assert_eq!(state.writes, 1);
    assert_eq!(
        state.document.as_ref().unwrap().entries[0].saved_at,
        WALL_NOW
    );
}

#[test]
fn rollback_before_expiry_and_future_saved_time_are_misses_without_rewriting_source_file() {
    let h = setup();
    let account = account(ProxyConfig::System);
    let event = incoming("clock");
    h.gateway.token_reply(Ok(token("seed")), None);
    h.gateway
        .translation_reply(Ok(translated("clock-bound result", Some(90))), None);
    h.engine
        .execute(&h.engine.prepare(account.clone(), event.clone()).unwrap())
        .unwrap();
    let r = restart(&h);
    r.gateway.quota_reply(Ok(90), None);
    let work = r.engine.prepare(account.clone(), event.clone()).unwrap();
    r.wall.set(WALL_NOW + 10);
    assert_eq!(r.engine.execute(&work).unwrap(), "clock-bound result");
    r.wall.set(WALL_NOW + 9);
    r.gateway
        .token_reply(Err(AppError::NetworkUnavailable), None);
    assert_eq!(r.engine.execute(&work), Err(AppError::NetworkUnavailable));
    r.wall.set(WALL_NOW - 1);
    let future = restart(&h);
    future.gateway.quota_reply(Ok(90), None);
    future
        .gateway
        .token_reply(Err(AppError::NetworkUnavailable), None);
    let work = future.engine.prepare(account, event).unwrap();
    assert_eq!(
        future.engine.execute(&work),
        Err(AppError::NetworkUnavailable)
    );
    assert_eq!(future.cache.0.lock().unwrap().writes, 1);
}

#[test]
fn unavailable_or_future_document_disables_only_optional_persistence_for_this_instance() {
    for load_error in [None, Some(AppError::StoreIo)] {
        let h = setup();
        let document = TranslationCacheDocument {
            schema_version: 2,
            entries: vec![],
        };
        {
            let mut state = h.cache.0.lock().unwrap();
            state.document = Some(document.clone());
            state.load_error = load_error;
        }
        let r = restart(&h);
        r.gateway.quota_reply(Ok(90), None);
        r.gateway.token_reply(Ok(token("optional")), None);
        r.gateway
            .translation_reply(Ok(translated("authorized first result", Some(80))), None);
        let account = account(ProxyConfig::System);
        let work = r
            .engine
            .prepare(account.clone(), incoming("first"))
            .unwrap();
        assert_eq!(r.engine.execute(&work).unwrap(), "authorized first result");
        assert_eq!(r.engine.execute(&work).unwrap(), "authorized first result");
        r.cache.0.lock().unwrap().load_error = None;
        r.gateway
            .translation_reply(Ok(translated("authorized second result", Some(70))), None);
        let work = r.engine.prepare(account, incoming("second")).unwrap();
        assert_eq!(r.engine.execute(&work).unwrap(), "authorized second result");
        let state = r.cache.0.lock().unwrap();
        assert!(state.document.as_ref() == Some(&document));
        assert_eq!(state.attempts, 0);
        assert_eq!(state.writes, 0);
    }
}

#[test]
fn absent_clock_disables_persistence_but_not_authorized_translation() {
    let h = setup();
    h.wall.set(0);
    h.gateway.token_reply(Ok(token("zero-clock")), None);
    h.gateway
        .translation_reply(Ok(translated("paid result", Some(90))), None);
    let work = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("zero-clock"))
        .unwrap();
    assert_eq!(h.engine.execute(&work).unwrap(), "paid result");
    assert_eq!(h.engine.execute(&work).unwrap(), "paid result");
    assert_eq!(h.cache.0.lock().unwrap().attempts, 0);
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}

#[test]
fn encoded_size_eviction_keeps_new_paid_results_and_never_writes_an_oversize_document() {
    let h = setup();
    let account = account(ProxyConfig::System);
    h.gateway.token_reply(Ok(token("encoded")), None);
    for index in 1..=3 {
        // Actual U+0001 bytes expand to six JSON bytes; this is not a literal backslash string.
        let text = format!(
            "{index}{}",
            "\u{1}".repeat(MAX_TRANSLATION_CACHE_ENTRY_BYTES - 1)
        );
        h.gateway
            .translation_reply(Ok(translated(&text, Some(90))), None);
        let work = h
            .engine
            .prepare(account.clone(), incoming(&format!("encoded-{index}")))
            .unwrap();
        assert_eq!(h.engine.execute(&work).unwrap(), text);
        let state = h.cache.0.lock().unwrap();
        let document = state.document.as_ref().unwrap();
        document.validate().unwrap();
        assert!(serde_json::to_vec(document).unwrap().len() <= MAX_TRANSLATION_CACHE_PLAIN_BYTES);
    }
    let state = h.cache.0.lock().unwrap();
    let entries = &state.document.as_ref().unwrap().entries;
    assert_eq!(entries.len(), 2);
    assert!(entries[0].text.starts_with('2'));
    assert!(entries[1].text.starts_with('3'));
}

#[test]
fn a_forged_lease_principal_cannot_read_a_cached_result() {
    let h = setup();
    let mut work = h
        .engine
        .prepare(account(ProxyConfig::System), incoming("lease"))
        .unwrap();
    work.lease.user.account_no = server_login(2).user.account_no;
    assert_eq!(h.engine.execute(&work), Err(AppError::SessionChanged));
    assert!(h.gateway.calls(Operation::Quota).is_empty());
    assert!(h.gateway.calls(Operation::Token).is_empty());
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}
