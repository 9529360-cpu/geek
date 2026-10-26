use super::{send_intent_support, translation_support};
use crate::{
    application::{
        send_intent::{Admission, SendIntents},
        send_ports::SendTransform,
        send_translation::SendTranslation,
        translation_ports::TranslationIntent,
    },
    domain::{
        account::Account,
        broadcast::GuestBinding,
        error::AppError,
        send_intent::{OutgoingSend, SendContext, SendOutcome, SendState},
    },
};
use std::sync::Arc;

fn fixture(translate: bool) -> (Account, GuestBinding, Option<String>, OutgoingSend) {
    let (mut account, mut binding, session, mut request) = send_intent_support::fixture(translate);
    account.platform_id = "telegram-k".into();
    account.translation.global.target = "it".into();
    binding.platform_id = account.platform_id.clone();
    request.chat_id = "tg:123".into();
    request.context = SendContext::Reply {
        message_id: "tg:123:42".into(),
        chat_id: request.chat_id.clone(),
    };
    (account, binding, session, request)
}

#[test]
fn k_reply_admits_only_canonical_same_chat_server_message_keys() {
    for (chat, key, accepted) in [
        ("tg:123", "tg:123:1", true),
        ("tg:123", "tg:123:2147483647", true),
        ("tg:-123", "tg:-123:42", true),
        ("tg:123", "tg:124:42", false),
        ("tg:123", "tg:1234:42", false),
        ("tg:123", "tg:-123:42", false),
        ("tg:123", "42", false),
        ("tg:123", "tg:123:0", false),
        ("tg:123", "tg:123:-1", false),
        ("tg:123", "tg:123:+42", false),
        ("tg:123", "tg:123:042", false),
        ("tg:123", "tg:123:42.5", false),
        ("tg:123", "tg:123:4e2", false),
        ("tg:123", "tg:123:2147483648", false),
        ("tg:123", "tg:123:42:7", false),
        ("tg:123", "tg:123:42\n", false),
        ("tg:123", "tg:123:４２", false),
        ("tg:0123", "tg:0123:42", false),
        ("tg:+123", "tg:+123:42", false),
        ("tg:123", "false_123@c.us_42", false),
    ] {
        let (account, binding, session, mut request) = fixture(false);
        request.chat_id = chat.into();
        request.context = SendContext::Reply {
            message_id: key.into(),
            chat_id: chat.into(),
        };
        let mut owner = SendIntents::new();
        let result = owner.admit(account, binding, session, request.clone());
        if accepted {
            assert!(matches!(result, Ok(Admission::Start(_))), "{key}");
            assert_eq!(owner.status(&request.id).unwrap().state, SendState::Ready);
        } else {
            assert!(matches!(result, Err(AppError::SendIntentInvalid)), "{key}");
            assert!(owner.status(&request.id).is_none());
        }
    }
}

#[test]
fn k_reply_keeps_chat_and_platform_context_guards() {
    let (account, binding, session, original) = fixture(false);
    for context in [
        SendContext::Reply {
            message_id: "tg:124:42".into(),
            chat_id: "tg:124".into(),
        },
        SendContext::Reply {
            message_id: "false_123@c.us_42".into(),
            chat_id: "123@c.us".into(),
        },
        SendContext::Attachment {
            attachment_id: uuid::Uuid::new_v4().to_string(),
        },
        SendContext::Mentions { mentions: vec![] },
    ] {
        let mut owner = SendIntents::new();
        let mut request = original.clone();
        request.context = context;
        assert!(matches!(
            owner.admit(account.clone(), binding.clone(), session.clone(), request),
            Err(AppError::SendIntentInvalid)
        ));
        assert!(owner.status(&original.id).is_none());
    }
    for platform in ["whatsapp", "whatsapp-pure", "telegram-z"] {
        assert_eq!(
            original.validate_for_platform(platform),
            Err(AppError::SendIntentInvalid)
        );
    }
    let (_, _, _, mut whatsapp) = send_intent_support::fixture(false);
    whatsapp.context = SendContext::Reply {
        message_id: format!("false_{}_3EB001", whatsapp.chat_id),
        chat_id: whatsapp.chat_id.clone(),
    };
    whatsapp.validate_for_platform("whatsapp").unwrap();
}

#[test]
fn k_reply_identity_cannot_be_retargeted_or_downgraded_on_retry() {
    let (account, binding, session, request) = fixture(false);
    let mut owner = SendIntents::new();
    let Admission::Start(first) = owner.admit(account, binding, session, request).unwrap() else {
        panic!("new K reply must start");
    };
    owner.fail(&first, AppError::SendIntentChanged).unwrap();
    for context in [
        SendContext::Reply {
            message_id: "tg:123:43".into(),
            chat_id: "tg:123".into(),
        },
        SendContext::Plain {},
    ] {
        let mut changed = first.request.clone();
        changed.context = context;
        changed.attempt += 1;
        assert!(matches!(
            owner.admit(first.account.clone(), first.binding.clone(), None, changed),
            Err(AppError::SendIntentConflict)
        ));
    }
    let retry = send_intent_support::next(&mut owner, &first);
    assert!(retry.request.context == first.request.context);
    assert_eq!(retry.request.id, first.request.id);
    assert!(matches!(
        owner.begin_commit(&first),
        Err(AppError::SendIntentConflict)
    ));
    assert!(owner.begin_commit(&retry).unwrap());
}

#[test]
fn k_reply_reuses_paid_body_translation_and_never_clears_a_reply_draft() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let (account, binding, _, request) = fixture(true);
    let mut owner = SendIntents::new();
    let Admission::Start(mut first) = owner
        .admit(account, binding, transform.generation(), request.clone())
        .unwrap()
    else {
        panic!("new K reply transform must start");
    };
    transform.bind(&mut first).unwrap();
    h.gateway
        .token_reply(Ok(translation_support::token("k-reply")), None);
    h.gateway.translation_reply(
        Ok(translation_support::translated("Una risposta", Some(0))),
        None,
    );
    owner
        .remember_output(&first, transform.execute(&first).unwrap())
        .unwrap();
    assert!(owner.begin_commit(&first).unwrap());
    owner
        .settle(
            &first,
            SendOutcome::NotSubmitted {
                issue: AppError::SendIntentChanged,
            },
        )
        .unwrap();
    let mut retry = send_intent_support::next(&mut owner, &first);
    transform.bind(&mut retry).unwrap();
    transform.validate(&retry).unwrap();
    assert_eq!(retry.output.as_deref(), Some("Una risposta"));
    assert!(owner.begin_commit(&retry).unwrap());
    let status = owner
        .settle(
            &retry,
            SendOutcome::Confirmed {
                receipt: "tg:123:99".into(),
                draft_cleared: true,
            },
        )
        .unwrap();
    assert_eq!(status.state, SendState::Confirmed);
    assert_eq!(status.draft_cleared, Some(false));
    assert!(!status.retryable);
    assert!(!owner.begin_commit(&retry).unwrap());
    let calls = h.gateway.calls(translation_support::Operation::Translate);
    assert_eq!(calls.len(), 1);
    let sent = calls[0].request.as_ref().unwrap();
    assert_eq!(sent.id, request.id);
    assert_eq!(sent.text, request.text);
    assert_eq!(sent.intent, TranslationIntent::OutgoingSend);
    assert_eq!(sent.target, "it");
}

#[test]
fn k_reply_retains_the_existing_utf16_source_and_output_ceiling() {
    let (_, _, _, mut request) = fixture(false);
    request.text = "😀".repeat(2048);
    request.validate_for_platform("telegram-k").unwrap();
    request
        .validate_output("telegram-k", &request.text)
        .unwrap();
    request.text.push('a');
    assert_eq!(
        request.validate_for_platform("telegram-k"),
        Err(AppError::SendIntentInvalid)
    );
    assert_eq!(
        request.validate_output("telegram-k", &request.text),
        Err(AppError::TranslationOutputInvalid)
    );
}
