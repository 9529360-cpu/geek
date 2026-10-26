//! A prepared platform attachment stays guest-local; SendIntent owns its typed identity.
use super::send_intent_support::{fixture, next};
use crate::{
    application::send_intent::{Admission, SendIntents},
    domain::{
        error::AppError,
        send_intent::{OutgoingSend, SendContext, SendOutcome, SendState},
    },
};
use serde_json::json;

const ATTACHMENT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

fn context(id: &str) -> SendContext {
    SendContext::Attachment {
        attachment_id: id.into(),
    }
}

#[test]
fn only_an_opaque_canonical_attachment_identity_crosses_the_strict_wire_context() {
    let (_, _, _, mut request) = fixture(true);
    request.context = context(ATTACHMENT);
    let value = serde_json::to_value(&request).unwrap();
    assert_eq!(
        value["context"],
        json!({ "kind": "attachment", "attachmentId": ATTACHMENT })
    );
    assert!(serde_json::from_value::<OutgoingSend>(value.clone()).unwrap() == request);
    for bad in [
        json!({ "kind": "attachment" }),
        json!({ "kind": "attachment", "attachmentId": 1 }),
        json!({ "kind": "attachment", "attachmentId": ATTACHMENT, "path": "C:\\private.png" }),
        json!({ "kind": "attachment", "attachmentId": ATTACHMENT, "quotedMsg": "forged" }),
    ] {
        let mut candidate = value.clone();
        candidate["context"] = bad;
        assert!(serde_json::from_value::<OutgoingSend>(candidate).is_err());
    }
    request.context = context("blob:https://web.whatsapp.com/not-an-id");
    assert_eq!(request.validate(), Err(AppError::SendIntentInvalid));
}

#[test]
fn attachment_caption_limits_count_unicode_scalars_and_reject_other_platforms() {
    let (_, _, _, mut request) = fixture(true);
    request.context = context(ATTACHMENT);
    for source in [
        "a".repeat(1024),
        "😀".repeat(1024),
        "a".repeat(1025),
        "😀".repeat(1025),
    ] {
        request.text = source.clone();
        let bounded = source.chars().count() <= 1024;
        for platform in ["whatsapp", "whatsapp-pure"] {
            assert_eq!(request.validate_for_platform(platform).is_ok(), bounded);
            assert_eq!(request.validate_output(platform, &source).is_ok(), bounded);
        }
    }
    request.text = "Caption".into();
    for platform in ["telegram-k", "telegram-z", "instagram"] {
        assert_eq!(
            request.validate_for_platform(platform),
            Err(AppError::SendIntentInvalid)
        );
    }
    request.chat_id = "tg:123".into();
    assert_eq!(
        request.validate_for_platform("telegram-k"),
        Err(AppError::SendIntentInvalid)
    );
}

#[test]
fn a_changed_physical_attachment_cannot_rebind_a_paid_caption_intent() {
    let (account, binding, session, mut request) = fixture(true);
    request.context = context(ATTACHMENT);
    let mut owner = SendIntents::new();
    let Admission::Start(ticket) = owner.admit(account, binding, session, request).unwrap() else {
        panic!("a fresh prepared attachment must enter the existing owner");
    };
    owner
        .remember_output(&ticket, "Una didascalia".into())
        .unwrap();
    assert!(owner.begin_commit(&ticket).unwrap());
    owner
        .settle(
            &ticket,
            SendOutcome::NotSubmitted {
                issue: AppError::SendIntentChanged,
            },
        )
        .unwrap();
    let mut changed = ticket.request.clone();
    changed.attempt += 1;
    changed.context = context(OTHER);
    assert!(matches!(
        owner.admit(
            ticket.account.clone(),
            ticket.binding.clone(),
            ticket.session_generation.clone(),
            changed
        ),
        Err(AppError::SendIntentConflict)
    ));
    let retry = next(&mut owner, &ticket);
    assert_eq!(retry.output.as_deref(), Some("Una didascalia"));
    assert_eq!(retry.request.id, ticket.request.id);
    assert!(owner.begin_commit(&retry).unwrap());
    let status = owner
        .settle(
            &retry,
            SendOutcome::Confirmed {
                receipt: "true_12025550123@c.us_TEST".into(),
                draft_cleared: true,
            },
        )
        .unwrap();
    assert_eq!(status.state, SendState::Confirmed);
    assert_eq!(
        status.draft_cleared,
        Some(false),
        "a media ACK cannot authorize partial preview cleanup"
    );
    assert!(!owner.begin_commit(&retry).unwrap());
}

#[test]
fn an_oversized_translated_caption_never_receives_commit_permission() {
    let (account, binding, session, mut request) = fixture(true);
    request.context = context(ATTACHMENT);
    let mut owner = SendIntents::new();
    let Admission::Start(ticket) = owner.admit(account, binding, session, request).unwrap() else {
        panic!("a fresh caption must start");
    };
    assert_eq!(
        owner.remember_output(&ticket, "a".repeat(1025)),
        Err(AppError::TranslationOutputInvalid)
    );
    let status = owner.status(&ticket.request.id).unwrap();
    assert_eq!(status.state, SendState::Failed);
    assert!(!status.retryable);
    assert!(owner.begin_commit(&ticket).is_err());
}
