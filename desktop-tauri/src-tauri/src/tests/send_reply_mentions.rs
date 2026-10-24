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
        send_intent::{OutgoingSend, SendContext, SendState},
        send_mentions::{SendMention, MENTION_PREFIX},
    },
};
use serde_json::json;
use std::sync::Arc;

fn context(chat: &str, quote: &str, entity: &str) -> SendContext {
    SendContext::ReplyMentions {
        message_id: format!("false_{chat}_{quote}"),
        chat_id: chat.into(),
        mentions: vec![SendMention {
            id: entity.into(),
            offset: 6,
            length: 4,
        }],
    }
}

fn request() -> OutgoingSend {
    let (_, _, _, mut request) = fixture(true);
    request.chat_id = "12025550123-99@g.us".into();
    request.text = "Hello @123".into();
    request.context = context(&request.chat_id, "QUOTE1", "123@c.us");
    request
}

fn admit(owner: &mut SendIntents, transform: &impl SendTransform) -> Box<SendTicket> {
    let (mut account, binding, _, _) = fixture(true);
    account.translation.global.source = "en".into();
    account.translation.global.target = "it".into();
    let Admission::Start(mut ticket) = owner
        .admit(account, binding, transform.generation(), request())
        .unwrap()
    else {
        panic!("a new combined intent must start");
    };
    transform.bind(&mut ticket).unwrap();
    ticket
}

#[test]
fn combined_context_is_strict_and_serializes_both_frozen_components_without_page_data() {
    let original = request();
    original.validate().unwrap();
    let raw = serde_json::to_value(&original).unwrap();
    assert_eq!(
        raw["context"],
        json!({ "kind": "replyMentions", "chatId": original.chat_id,
            "messageId": "false_12025550123-99@g.us_QUOTE1",
            "mentions": [{ "id": "123@c.us", "offset": 6, "length": 4 }] })
    );
    assert!(serde_json::from_value::<OutgoingSend>(raw.clone()).unwrap() == original);
    for field in ["chatId", "messageId", "mentions"] {
        let mut absent = raw.clone();
        absent["context"].as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<OutgoingSend>(absent).is_err());
        let mut null = raw.clone();
        null["context"][field] = json!(null);
        assert!(serde_json::from_value::<OutgoingSend>(null).is_err());
    }
    for extra in ["quotedMsg", "quotedMsgPayload", "body", "mentionedList"] {
        let mut candidate = raw.clone();
        candidate["context"][extra] = json!("private page data");
        assert!(serde_json::from_value::<OutgoingSend>(candidate).is_err());
    }
    let mut extra_entity = raw;
    extra_entity["context"]["mentions"][0]["name"] = json!("Untrusted nickname");
    assert!(serde_json::from_value::<OutgoingSend>(extra_entity).is_err());
}

#[test]
fn combined_context_requires_same_whatsapp_group_reply_key_and_exact_canonical_entity_ranges() {
    let original = request();
    for platform in ["whatsapp", "whatsapp-pure"] {
        original.validate_for_platform(platform).unwrap();
    }
    for (chat, platform) in [
        ("12025550123@c.us", "whatsapp"),
        ("12025550123@lid", "whatsapp-pure"),
        ("tg:-123", "telegram-k"),
        ("12025550123-99@g.us", "telegram-k"),
    ] {
        let mut candidate = original.clone();
        candidate.chat_id = chat.into();
        candidate.context = context(chat, "QUOTE1", "123@c.us");
        assert_eq!(
            candidate.validate_for_platform(platform),
            Err(AppError::SendIntentInvalid)
        );
    }
    for invalid in [
        context("12025550123-98@g.us", "QUOTE1", "123@c.us"),
        context(&original.chat_id, "QUOTE/1", "123@c.us"),
        context(&original.chat_id, "QUOTE1", "124@c.us"),
        context(&original.chat_id, "QUOTE1", "123@g.us"),
    ] {
        let mut candidate = original.clone();
        candidate.context = invalid;
        assert_eq!(candidate.validate(), Err(AppError::SendIntentInvalid));
    }
    let raw = serde_json::to_value(&original).unwrap();
    for mentions in [
        json!([]),
        json!([{ "id": "123@c.us", "offset": 7, "length": 4 }]),
        json!([{ "id": "123@c.us", "offset": 6, "length": 3 }]),
        json!([{ "id": "123@c.us", "offset": 6, "length": 4 },
            { "id": "123@c.us", "offset": 6, "length": 4 }]),
    ] {
        let mut candidate = raw.clone();
        candidate["context"]["mentions"] = mentions;
        let candidate: OutgoingSend = serde_json::from_value(candidate).unwrap();
        assert_eq!(candidate.validate(), Err(AppError::SendIntentInvalid));
    }
    let mut wrong_key = raw;
    wrong_key["context"]["messageId"] = json!("false_12025550123-98@g.us_QUOTE1");
    assert_eq!(
        serde_json::from_value::<OutgoingSend>(wrong_key)
            .unwrap()
            .validate(),
        Err(AppError::SendIntentInvalid)
    );
}

#[test]
fn changing_quote_or_entity_cannot_rebind_one_paid_identity() {
    let original = request();
    for context in [
        context(&original.chat_id, "QUOTE2", "123@c.us"),
        context(&original.chat_id, "QUOTE1", "123@lid"),
        SendContext::Reply {
            message_id: format!("false_{}_QUOTE1", original.chat_id),
            chat_id: original.chat_id.clone(),
        },
    ] {
        let (account, binding, session, _) = fixture(true);
        let mut owner = SendIntents::new();
        let Admission::Start(first) = owner
            .admit(account, binding, session, original.clone())
            .unwrap()
        else {
            panic!("a new combined intent must start");
        };
        owner.remember_output(&first, "Ciao @123".into()).unwrap();
        owner.fail(&first, AppError::WebviewFailed).unwrap();
        let mut changed = first.request.clone();
        changed.attempt += 1;
        changed.context = context;
        assert!(matches!(
            owner.admit(
                first.account.clone(),
                first.binding.clone(),
                first.session_generation.clone(),
                changed
            ),
            Err(AppError::SendIntentConflict)
        ));
    }
}

#[test]
fn actual_combined_transform_protects_entities_and_reuses_paid_output_without_quote_content() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let first = admit(&mut owner, &transform);
    let marker = format!("{MENTION_PREFIX}{}/0", first.request.id);
    h.gateway.token_reply(Ok(token("combined")), None);
    h.gateway
        .translation_reply(Ok(translated(&format!("Ciao {marker}"), Some(90))), None);
    let output = transform.execute(&first).unwrap();
    assert_eq!(output, "Ciao @123");
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 1);
    let sent = calls[0].request.as_ref().unwrap();
    assert_eq!(sent.id, first.request.id);
    assert_eq!(sent.text, format!("Hello {marker}"));
    assert_eq!(sent.intent, TranslationIntent::OutgoingSend);
    assert!(!sent.text.contains("QUOTE1"));
    owner.remember_output(&first, output).unwrap();
    owner.fail(&first, AppError::WebviewFailed).unwrap();
    let mut retry = next(&mut owner, &first);
    transform.bind(&mut retry).unwrap();
    transform.validate(&retry).unwrap();
    assert_eq!(retry.output.as_deref(), Some("Ciao @123"));
    assert!(retry.request.context == first.request.context);
    assert!(owner.begin_commit(&retry).unwrap());
    let settled = owner
        .settle(&retry, send_intent_support::confirmed())
        .unwrap();
    assert_eq!(settled.state, SendState::Confirmed);
    assert_eq!(settled.draft_cleared, Some(false));
    assert!(!owner.begin_commit(&retry).unwrap());
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}

#[test]
fn combined_transform_rejects_lost_or_duplicated_entity_tokens_without_a_retryable_send() {
    for duplicate in [false, true] {
        let h = translation_support::setup();
        let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
        let mut owner = SendIntents::new();
        let first = admit(&mut owner, &transform);
        let marker = format!("{MENTION_PREFIX}{}/0", first.request.id);
        let output = if duplicate {
            format!("{marker} {marker}")
        } else {
            "Ciao".into()
        };
        h.gateway.token_reply(Ok(token("combined-invalid")), None);
        h.gateway
            .translation_reply(Ok(translated(&output, Some(90))), None);
        assert_eq!(
            transform.execute(&first),
            Err(AppError::TranslationOutputInvalid)
        );
        let failed = owner
            .fail(&first, AppError::TranslationOutputInvalid)
            .unwrap();
        assert_eq!(failed.state, SendState::Failed);
        assert!(!failed.retryable);
        assert!(owner.begin_commit(&first).is_err());
    }
}

#[test]
fn combined_identity_exclusion_preserves_entities_and_quote_without_subscription_or_paid_work() {
    let h = translation_support::setup();
    h.session.logout().unwrap();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let (mut account, binding, _, _) = fixture(true);
    account.translation.global.include_zh = false;
    let mut original = request();
    original.text.push_str(" 你好");
    let source = original.text.clone();
    let mut owner = SendIntents::new();
    let Admission::Start(mut ticket) = owner.admit(account, binding, None, original).unwrap()
    else {
        panic!("excluded combined source must remain an identity path");
    };
    transform.bind(&mut ticket).unwrap();
    assert!(!ticket.translate);
    assert_eq!(transform.execute(&ticket).unwrap(), source);
    assert!(owner.begin_commit(&ticket).unwrap());
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}
