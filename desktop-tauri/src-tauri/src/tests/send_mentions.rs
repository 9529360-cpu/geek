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
        send_mentions::{MentionTranslation, SendMention, MENTION_PREFIX},
    },
};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

fn mention(id: &str, offset: u32, length: u32) -> SendMention {
    SendMention {
        id: id.into(),
        offset,
        length,
    }
}

fn request(text: &str, mentions: Vec<SendMention>) -> OutgoingSend {
    let (_, _, _, mut request) = fixture(true);
    request.chat_id = "12025550123-99@g.us".into();
    request.text = text.into();
    request.context = SendContext::Mentions { mentions };
    request
}

fn admit(
    owner: &mut SendIntents,
    transform: &impl SendTransform,
    request: OutgoingSend,
) -> Box<SendTicket> {
    let (mut account, binding, _, _) = fixture(true);
    account.translation.global.source = "en".into();
    account.translation.global.target = "it".into();
    let Admission::Start(mut ticket) = owner
        .admit(account, binding, transform.generation(), request)
        .unwrap()
    else {
        panic!("a fresh synthetic mention intent must start");
    };
    transform.bind(&mut ticket).unwrap();
    ticket
}

#[test]
fn mention_context_is_strict_and_round_trips_the_frozen_entity_ranges() {
    let original = request("Hello @123", vec![mention("123@c.us", 6, 4)]);
    original.validate().unwrap();
    let value = serde_json::to_value(&original).unwrap();
    assert_eq!(
        value["context"],
        json!({ "kind": "mentions", "mentions": [
        { "id": "123@c.us", "offset": 6, "length": 4 }
    ] })
    );
    assert!(serde_json::from_value::<OutgoingSend>(value.clone()).unwrap() == original);
    for bad in [
        json!({ "kind": "mentions" }),
        json!({ "kind": "mentions", "mentions": null }),
        json!({ "kind": "mentions", "mentions": [], "quotedMsg": "forged" }),
        json!({ "kind": "mentions", "mentions": [{ "id": "123@c.us", "offset": 6 }] }),
        json!({ "kind": "mentions", "mentions": [{ "id": "123@c.us", "offset": -1, "length": 4 }] }),
        json!({ "kind": "mentions", "mentions": [{ "id": "123@c.us", "offset": 6.5, "length": 4 }] }),
        json!({ "kind": "mentions", "mentions": [{ "id": "123@c.us", "offset": 6, "length": 4, "name": "Alice" }] }),
    ] {
        let mut candidate = value.clone();
        candidate["context"] = bad;
        assert!(serde_json::from_value::<OutgoingSend>(candidate).is_err());
    }
}

#[test]
fn utf16_positions_bind_canonical_tokens_and_reject_surrogate_byte_and_display_name_offsets() {
    let good = request(
        "😀 @123，@456",
        vec![mention("123@c.us", 3, 4), mention("456@lid", 8, 4)],
    );
    good.validate().unwrap();
    for (text, mentions) in [
        ("😀 @123", vec![mention("123@c.us", 1, 4)]),
        ("😀 @123", vec![mention("123@c.us", 5, 4)]),
        ("😀 @123", vec![mention("123@c.us", 3, 3)]),
        ("Hi @Alice", vec![mention("123@c.us", 3, 6)]),
        ("@123", vec![mention("124@c.us", 0, 4)]),
        ("@123", vec![mention("123@c.us", u32::MAX, 4)]),
        ("@123", vec![mention("123@c.us", 0, 0)]),
        (
            "@123 @456",
            vec![mention("456@lid", 5, 4), mention("123@c.us", 0, 4)],
        ),
        (
            "@123",
            vec![mention("123@c.us", 0, 4), mention("123@c.us", 0, 4)],
        ),
    ] {
        assert_eq!(
            request(text, mentions).validate(),
            Err(AppError::SendIntentInvalid)
        );
    }
}

#[test]
fn only_bounded_numeric_entities_and_unambiguous_namespaces_are_admitted() {
    for id in [
        "123@g.us",
        "123@s.whatsapp.net",
        "123:4@c.us",
        "+123@c.us",
        "abc@lid",
        "@lid",
        "123@LID",
    ] {
        assert_eq!(
            request("@123", vec![mention(id, 0, 4)]).validate(),
            Err(AppError::SendIntentInvalid)
        );
    }
    for user in ["0", "0123"] {
        assert_eq!(
            request(
                &format!("@{user}"),
                vec![mention(&format!("{user}@c.us"), 0, user.len() as u32 + 1)]
            )
            .validate(),
            Err(AppError::SendIntentInvalid)
        );
    }
    let longest = "1".repeat(30);
    request(
        &format!("@{longest}"),
        vec![mention(&format!("{longest}@lid"), 0, 31)],
    )
    .validate()
    .unwrap();
    let oversized = "1".repeat(31);
    assert_eq!(
        request(
            &format!("@{oversized}"),
            vec![mention(&format!("{oversized}@lid"), 0, 32)]
        )
        .validate(),
        Err(AppError::SendIntentInvalid)
    );
    request(
        "@123 @123",
        vec![mention("123@lid", 0, 4), mention("123@lid", 5, 4)],
    )
    .validate()
    .unwrap();
    assert_eq!(
        request(
            "@123 @123",
            vec![mention("123@lid", 0, 4), mention("123@c.us", 5, 4)]
        )
        .validate(),
        Err(AppError::SendIntentInvalid)
    );
    assert_eq!(
        request("@123", vec![]).validate(),
        Err(AppError::SendIntentInvalid)
    );
    for count in [32_u32, 33] {
        let text = vec!["@1"; count as usize].join(" ");
        let mentions = (0..count).map(|i| mention("1@c.us", i * 3, 2)).collect();
        assert_eq!(request(&text, mentions).validate().is_ok(), count == 32);
    }
}

#[test]
fn mentions_are_whatsapp_group_only_and_context_cannot_rebind_a_paid_id() {
    let good = request("@123", vec![mention("123@c.us", 0, 4)]);
    for platform in ["whatsapp", "whatsapp-pure"] {
        good.validate_for_platform(platform).unwrap();
    }
    for (chat, platform) in [
        ("12025550123@c.us", "whatsapp"),
        ("12025550123@lid", "whatsapp-pure"),
        ("tg:-123", "telegram-k"),
        ("tg:-123", "telegram-z"),
        ("12025550123-99@g.us", "telegram-k"),
    ] {
        let mut other = good.clone();
        other.chat_id = chat.into();
        assert_eq!(
            other.validate_for_platform(platform),
            Err(AppError::SendIntentInvalid)
        );
    }
    let (account, binding, session, _) = fixture(true);
    let mut owner = SendIntents::new();
    let Admission::Start(first) = owner.admit(account, binding, session, good).unwrap() else {
        panic!("first intent must start");
    };
    owner.remember_output(&first, "@123".into()).unwrap();
    owner.fail(&first, AppError::WebviewFailed).unwrap();
    for context in [
        SendContext::Plain {},
        SendContext::Mentions {
            mentions: vec![mention("123@lid", 0, 4)],
        },
    ] {
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
fn stable_tokens_allow_reordering_but_restore_only_the_frozen_entities() {
    let id = Uuid::new_v4().to_string();
    let mentions = [mention("123@c.us", 6, 4), mention("456@lid", 15, 4)];
    let encoded = MentionTranslation::encode(&id, "Hello @123 and @456.", &mentions).unwrap();
    let first = format!("{MENTION_PREFIX}{id}/0");
    let second = format!("{MENTION_PREFIX}{id}/1");
    assert_eq!(encoded.text(), format!("Hello {first} and {second} ."));
    let again = MentionTranslation::encode(&id, "Hello @123 and @456.", &mentions).unwrap();
    assert_eq!(encoded.text(), again.text());
    assert_eq!(
        encoded.decode(&format!("Prima {second}, poi {first}. 50 unità.")),
        Ok("Prima @456, poi @123. 50 unità.".into())
    );
}

#[test]
fn adjoining_unicode_and_punctuation_do_not_become_part_of_a_protected_url() {
    let id = Uuid::new_v4().to_string();
    let entity = [mention("123@c.us", 2, 4)];
    for (source, expected) in [
        ("😀@123你好", format!("😀 {MENTION_PREFIX}{id}/0 你好")),
        ("你好@123!", format!("你好 {MENTION_PREFIX}{id}/0 !")),
    ] {
        let encoded = MentionTranslation::encode(&id, source, &entity).unwrap();
        assert_eq!(encoded.text(), expected);
        assert!(encoded.decode(encoded.text()).unwrap().contains("@123"));
    }
    let adjacent = MentionTranslation::encode(
        &id,
        "@123@456",
        &[mention("123@c.us", 0, 4), mention("456@lid", 4, 4)],
    )
    .unwrap();
    assert_eq!(
        adjacent.text(),
        format!("{MENTION_PREFIX}{id}/0 {MENTION_PREFIX}{id}/1")
    );
    assert_eq!(adjacent.decode(adjacent.text()), Ok("@123 @456".into()));
}

#[test]
fn missing_duplicate_unknown_and_mutated_tokens_are_never_delivered() {
    let id = Uuid::new_v4().to_string();
    let encoded =
        MentionTranslation::encode(&id, "Hello @123", &[mention("123@lid", 6, 4)]).unwrap();
    let token = format!("{MENTION_PREFIX}{id}/0");
    for output in [
        "Ciao @123".to_string(),
        format!("{token} {token}"),
        format!("{MENTION_PREFIX}{id}/1"),
        format!("{MENTION_PREFIX}{id}/00"),
        format!("{MENTION_PREFIX}{}/0", Uuid::new_v4()),
        format!("{token}x"),
        format!("{token}/extra"),
        format!("{token}?query=1"),
        format!("{token}#fragment"),
        token.replace("https:", "http:"),
        token.to_uppercase(),
        format!("{token} {MENTION_PREFIX}{id}/2"),
        format!("{token} HTTP://GEEK-MENTION.INVALID/unknown/0"),
        format!("{token} https://geek-mention.invalid.evil/0"),
    ] {
        assert_eq!(
            encoded.decode(&output),
            Err(AppError::TranslationOutputInvalid)
        );
    }
    assert_eq!(
        encoded.decode(&format!("{token} {}", "x".repeat(10_001))),
        Err(AppError::TranslationOutputInvalid)
    );
}

#[test]
fn reserved_source_and_token_expansion_fail_before_any_paid_request() {
    for prefix in [
        MENTION_PREFIX,
        "HTTPS://GEEK-MENTION.INVALID/",
        "http://geek-mention.invalid/",
    ] {
        let source = format!("@123 {prefix}reserved/0");
        assert_eq!(
            request(&source, vec![mention("123@lid", 0, 4)]).validate(),
            Err(AppError::SendIntentInvalid)
        );
    }
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let source = format!("@1 {}", "x".repeat(9_997));
    let original = request(&source, vec![mention("1@c.us", 0, 2)]);
    original.validate().unwrap();
    let ticket = admit(&mut owner, &transform, original);
    assert_eq!(transform.execute(&ticket), Err(AppError::SendIntentInvalid));
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}

#[test]
fn actual_send_transform_uses_one_billing_id_and_retains_the_restored_output() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let first = admit(
        &mut owner,
        &transform,
        request("Hello @123", vec![mention("123@c.us", 6, 4)]),
    );
    let marker = format!("{MENTION_PREFIX}{}/0", first.request.id);
    h.gateway.token_reply(Ok(token("mention")), None);
    h.gateway
        .translation_reply(Ok(translated(&format!("Ciao {marker}"), Some(90))), None);
    let output = transform.execute(&first).unwrap();
    assert_eq!(output, "Ciao @123");
    let calls = h.gateway.calls(Operation::Translate);
    assert_eq!(calls.len(), 1);
    let sent = calls[0].request.as_ref().unwrap();
    assert_eq!(sent.id, first.request.id);
    assert_eq!(sent.text, format!("Hello {marker}"));
    assert_eq!((sent.source.as_str(), sent.target.as_str()), ("en", "it"));
    assert_eq!(sent.intent, TranslationIntent::OutgoingSend);
    owner.remember_output(&first, output).unwrap();
    owner.fail(&first, AppError::WebviewFailed).unwrap();
    let mut retry = next(&mut owner, &first);
    transform.bind(&mut retry).unwrap();
    transform.validate(&retry).unwrap();
    assert_eq!(retry.output.as_deref(), Some("Ciao @123"));
    assert_eq!(retry.request.id, first.request.id);
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
fn a_lost_transformed_result_recovers_through_the_existing_same_uuid_memory_cache() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let first = admit(
        &mut owner,
        &transform,
        request("Hello @123", vec![mention("123@lid", 6, 4)]),
    );
    let marker = format!("{MENTION_PREFIX}{}/0", first.request.id);
    h.gateway.token_reply(Ok(token("mention-cache")), None);
    h.gateway
        .translation_reply(Ok(translated(&format!("Ciao {marker}"), Some(90))), None);
    assert_eq!(transform.execute(&first).unwrap(), "Ciao @123");
    // No owner.remember_output: exercise paid completion retained by TranslationService.
    owner.fail(&first, AppError::NetworkUnavailable).unwrap();
    let mut retry = next(&mut owner, &first);
    assert!(retry.output.is_none());
    transform.bind(&mut retry).unwrap();
    assert_eq!(transform.execute(&retry).unwrap(), "Ciao @123");
    assert_eq!(retry.request.id, first.request.id);
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
    assert_eq!(h.gateway.calls(Operation::Token).len(), 1);
}

#[test]
fn paid_but_invalid_entity_output_is_terminal_and_cannot_automatically_rebill() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let first = admit(
        &mut owner,
        &transform,
        request("Hello @123", vec![mention("123@lid", 6, 4)]),
    );
    h.gateway.token_reply(Ok(token("mention-invalid")), None);
    h.gateway
        .translation_reply(Ok(translated("Ciao senza destinatario", Some(90))), None);
    assert_eq!(
        transform.execute(&first),
        Err(AppError::TranslationOutputInvalid)
    );
    let status = owner
        .fail(&first, AppError::TranslationOutputInvalid)
        .unwrap();
    assert_eq!(status.state, SendState::Failed);
    assert!(!status.retryable);
    let mut retry = first.request.clone();
    retry.attempt += 1;
    assert!(
        matches!(owner.admit(first.account.clone(), first.binding.clone(),
        first.session_generation.clone(), retry), Ok(Admission::Status(current)) if current == status)
    );
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}

#[test]
fn excluded_identity_mentions_keep_exact_source_without_login_or_paid_work() {
    let h = translation_support::setup();
    h.session.logout().unwrap();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let (mut account, binding, _, _) = fixture(true);
    account.translation.global.include_zh = false;
    let original = request("你好@123😀", vec![mention("123@c.us", 2, 4)]);
    let source = original.text.clone();
    let mut owner = SendIntents::new();
    let Admission::Start(mut ticket) = owner.admit(account, binding, None, original).unwrap()
    else {
        panic!("Han exclusion must keep the identity path");
    };
    transform.bind(&mut ticket).unwrap();
    assert!(!ticket.translate);
    assert_eq!(transform.execute(&ticket).unwrap(), source);
    assert!(owner.begin_commit(&ticket).unwrap());
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}
