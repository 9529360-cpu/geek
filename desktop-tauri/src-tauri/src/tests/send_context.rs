use super::{
    send_intent_support::{self, fixture, next},
    translation_support::{self, token, translated, Operation},
};
use crate::{
    application::{
        send_intent::{Admission, SendIntents, SendTicket},
        send_ports::SendTransform,
        send_translation::SendTranslation,
        translation_ports::TranslationIntent,
    },
    domain::{
        error::AppError,
        send_intent::{OutgoingSend, SendContext, SendOutcome, SendState},
    },
};
use serde_json::json;
use std::sync::Arc;

fn reply(chat: &str, id: &str) -> SendContext {
    SendContext::Reply {
        message_id: format!("false_{chat}_{id}"),
        chat_id: chat.into(),
    }
}

fn start_reply(owner: &mut SendIntents) -> Box<SendTicket> {
    let (account, binding, session, mut request) = fixture(true);
    request.context = reply(&request.chat_id, "3EB001");
    let Admission::Start(ticket) = owner.admit(account, binding, session, request).unwrap() else {
        panic!("a new frozen reply must start");
    };
    ticket
}

#[test]
fn context_is_mandatory_and_both_wire_variants_reject_unknown_fields() {
    let (_, _, _, request) = fixture(false);
    let raw = serde_json::to_value(&request).unwrap();
    assert_eq!(raw["context"], json!({ "kind": "plain" }));
    let decoded: OutgoingSend = serde_json::from_value(raw.clone()).unwrap();
    assert!(decoded == request);
    let mut missing = raw.clone();
    missing.as_object_mut().unwrap().remove("context");
    assert!(serde_json::from_value::<OutgoingSend>(missing).is_err());
    for invalid in [
        json!(null),
        json!("plain"),
        json!({}),
        json!({ "kind": "unknown" }),
        json!({ "kind": "plain", "messageId": "must-not-be-dropped" }),
        json!({ "kind": "plain", "mentions": [] }),
        json!({ "kind": "reply", "messageId": "false_12025550123@c.us_3EB001" }),
        json!({ "kind": "reply", "chatId": request.chat_id }),
        json!({ "kind": "reply", "messageId": null, "chatId": request.chat_id }),
        json!({ "kind": "reply", "messageId": "false_12025550123@c.us_3EB001",
            "chatId": request.chat_id, "quotedMsgPayload": "not-admitted" }),
    ] {
        let mut candidate = raw.clone();
        candidate["context"] = invalid;
        assert!(serde_json::from_value::<OutgoingSend>(candidate).is_err());
    }
    let mut with_reply = request;
    with_reply.context = reply(&with_reply.chat_id, "3EB001");
    let raw = serde_json::to_value(&with_reply).unwrap();
    assert_eq!(
        raw["context"],
        json!({ "kind": "reply",
        "messageId": "false_12025550123@c.us_3EB001", "chatId": with_reply.chat_id })
    );
    let decoded: OutgoingSend = serde_json::from_value(raw).unwrap();
    decoded.validate().unwrap();
    assert!(decoded == with_reply);
}

#[test]
fn canonical_same_chat_reply_keys_and_optional_group_participants_are_admitted() {
    let (_, _, _, original) = fixture(false);
    for (chat, key) in [
        ("12025550123@c.us", "true_12025550123@c.us_3EB001"),
        ("12025550123@lid", "false_12025550123@lid_3EB002"),
        ("12025550123-99@g.us", "false_12025550123-99@g.us_3EB003"),
        (
            "12025550123-99@g.us",
            "false_12025550123-99@g.us_3EB003_12025550124@c.us",
        ),
        (
            "12025550123-99@g.us",
            "true_12025550123-99@g.us_3EB004_12025550124@lid",
        ),
    ] {
        let mut request = original.clone();
        request.chat_id = chat.into();
        request.context = SendContext::Reply {
            message_id: key.into(),
            chat_id: chat.into(),
        };
        request.validate().unwrap();
    }
    let prefix = format!("false_{}_", original.chat_id);
    let at_limit = format!("{prefix}{}", "A".repeat(500 - prefix.len()));
    let mut request = original;
    request.context = SendContext::Reply {
        message_id: at_limit.clone(),
        chat_id: request.chat_id.clone(),
    };
    request.validate().unwrap();
    request.context = SendContext::Reply {
        message_id: format!("{at_limit}A"),
        chat_id: request.chat_id.clone(),
    };
    assert_eq!(request.validate(), Err(AppError::SendIntentInvalid));
}

#[test]
fn forged_cross_chat_and_malformed_reply_keys_fail_before_owner_admission() {
    let (account, binding, session, original) = fixture(true);
    let expected = original.chat_id.as_str();
    for (chat, key) in [
        ("12025550124@c.us", "false_12025550124@c.us_3EB001"),
        (expected, "false_12025550124@c.us_3EB001"),
        (expected, "false_status@broadcast_3EB001"),
        (expected, "FALSE_12025550123@c.us_3EB001"),
        (expected, "maybe_12025550123@c.us_3EB001"),
        (expected, "false_12025550123@c.us_"),
        (expected, "false_12025550123@c.us_3EB001_"),
        (expected, "false_12025550123@c.us_3EB001_12025550124@c.us"),
        (expected, "false_12025550123@c.us_3EB001_extra_field"),
        (expected, "false_12025550123@c.us_3EB 001"),
        (expected, "false_12025550123@c.us_3EB001\n"),
        (expected, "false_12025550123@c.us_3EB001\0"),
        (expected, "false_12025550123@c.us_3EB\u{00a0}001"),
        (expected, "false_12025550123@c.us_3EB/001"),
        (expected, "3EB001"),
    ] {
        let mut owner = SendIntents::new();
        let mut request = original.clone();
        request.context = SendContext::Reply {
            message_id: key.into(),
            chat_id: chat.into(),
        };
        assert!(matches!(
            owner.admit(account.clone(), binding.clone(), session.clone(), request),
            Err(AppError::SendIntentInvalid)
        ));
        assert!(owner.status(&original.id).is_none());
    }
    for participant in ["status@broadcast", "123@g.us", "abc@lid", "123:4@c.us", ""] {
        let mut request = original.clone();
        request.chat_id = "12025550123-99@g.us".into();
        request.context = SendContext::Reply {
            message_id: format!("false_{}_3EB001_{participant}", request.chat_id),
            chat_id: request.chat_id.clone(),
        };
        assert_eq!(request.validate(), Err(AppError::SendIntentInvalid));
    }
}

#[test]
fn the_same_body_cannot_rebind_a_logical_id_to_another_quote_or_plain_send() {
    let mut owner = SendIntents::new();
    let ticket = start_reply(&mut owner);
    for context in [
        SendContext::Plain {},
        reply(&ticket.request.chat_id, "3EB002"),
    ] {
        for attempt in [1, 2] {
            let mut request = ticket.request.clone();
            request.context = context.clone();
            request.attempt = attempt;
            assert!(matches!(
                owner.admit(
                    ticket.account.clone(),
                    ticket.binding.clone(),
                    ticket.session_generation.clone(),
                    request
                ),
                Err(AppError::SendIntentConflict)
            ));
            assert_eq!(
                owner.status(&ticket.request.id).unwrap().state,
                SendState::Transforming
            );
        }
    }
    owner.fail(&ticket, AppError::WebviewFailed).unwrap();
    let mut request = ticket.request.clone();
    request.context = reply(&request.chat_id, "3EB002");
    request.attempt += 1;
    assert!(matches!(
        owner.admit(
            ticket.account.clone(),
            ticket.binding.clone(),
            ticket.session_generation.clone(),
            request
        ),
        Err(AppError::SendIntentConflict)
    ));
}

#[test]
fn a_ticket_with_modified_context_has_no_output_commit_failure_or_settlement_authority() {
    let mut owner = SendIntents::new();
    let original = start_reply(&mut owner);
    let mut altered = original.clone();
    altered.request.context = reply(&altered.request.chat_id, "3EB002");
    assert!(matches!(
        owner.remember_output(&altered, "Unauthorized replacement".into()),
        Err(AppError::SendIntentConflict)
    ));
    assert_eq!(
        owner.begin_commit(&altered),
        Err(AppError::SendIntentConflict)
    );
    assert!(matches!(
        owner.fail(&altered, AppError::NetworkUnavailable),
        Err(AppError::SendIntentConflict)
    ));
    assert!(matches!(
        owner.settle(&altered, send_intent_support::confirmed()),
        Err(AppError::SendIntentConflict)
    ));
    assert_eq!(
        owner.status(&original.request.id).unwrap().state,
        SendState::Transforming
    );
    owner
        .remember_output(&original, "Owned output".into())
        .unwrap();
    assert!(owner.begin_commit(&original).unwrap());
}

#[test]
fn an_unchanged_reply_recovers_its_paid_output_and_confirmation_never_claims_draft_cleanup() {
    let mut owner = SendIntents::new();
    let first = start_reply(&mut owner);
    owner.remember_output(&first, "Paid once".into()).unwrap();
    owner.fail(&first, AppError::WebviewFailed).unwrap();
    let current = next(&mut owner, &first);
    assert!(current.request.context == first.request.context);
    assert_eq!(current.output.as_deref(), Some("Paid once"));
    assert_eq!(
        owner.begin_commit(&first),
        Err(AppError::SendIntentConflict)
    );
    assert!(owner.begin_commit(&current).unwrap());
    let confirmed = owner
        .settle(
            &current,
            SendOutcome::Confirmed {
                receipt: "true_synthetic_receipt".into(),
                draft_cleared: true,
            },
        )
        .unwrap();
    assert_eq!(confirmed.state, SendState::Confirmed);
    assert_eq!(confirmed.draft_cleared, Some(false));
    assert!(!confirmed.retryable);
    let mut replay = current.request.clone();
    replay.attempt += 1;
    assert!(
        matches!(owner.admit(current.account.clone(), current.binding.clone(),
        current.session_generation.clone(), replay), Ok(Admission::Status(status)) if status == confirmed)
    );
    assert_eq!(
        owner.fail(&current, AppError::NetworkUnavailable).unwrap(),
        confirmed
    );
    assert!(!owner.begin_commit(&current).unwrap());
}

#[test]
fn a_reply_translates_only_the_original_body_with_the_existing_id_and_policy() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let (mut account, binding, _, mut request) = fixture(true);
    account.translation.global.source = "en".into();
    account.translation.global.target = "it".into();
    account.translation.global.include_zh = false;
    request.text = "Please send 100 units tomorrow.".into();
    request.context = reply(&request.chat_id, "3EB001");
    let mut owner = SendIntents::new();
    let Admission::Start(mut ticket) = owner
        .admit(account, binding, transform.generation(), request)
        .unwrap()
    else {
        panic!("reply translation must be admitted");
    };
    transform.bind(&mut ticket).unwrap();
    h.gateway.token_reply(Ok(token("reply")), None);
    h.gateway
        .translation_reply(Ok(translated("Invia 100 unità domani.", Some(90))), None);
    assert_eq!(
        transform.execute(&ticket).unwrap(),
        "Invia 100 unità domani."
    );
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 1);
    let sent = calls[0].request.as_ref().unwrap();
    assert_eq!(sent.text, ticket.request.text);
    assert_eq!(sent.id, ticket.request.id);
    assert_eq!(sent.intent, TranslationIntent::OutgoingSend);
    assert_eq!((sent.source.as_str(), sent.target.as_str()), ("en", "it"));
    assert!(!sent.text.contains("3EB001"));
}

#[test]
fn a_reply_with_han_exclusion_remains_an_identity_without_paid_or_session_work() {
    let h = translation_support::setup();
    h.session.logout().unwrap();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let (mut account, binding, _, mut request) = fixture(true);
    account.translation.global.include_zh = false;
    request.text = "请发送 100 件。".into();
    request.context = reply(&request.chat_id, "3EB001");
    let mut owner = SendIntents::new();
    let Admission::Start(mut ticket) = owner.admit(account, binding, None, request).unwrap() else {
        panic!("an excluded reply must remain identity");
    };
    transform.bind(&mut ticket).unwrap();
    assert!(!ticket.translate);
    assert_eq!(transform.execute(&ticket).unwrap(), ticket.request.text);
    assert!(owner.begin_commit(&ticket).unwrap());
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}
