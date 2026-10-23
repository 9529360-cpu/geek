use super::send_intent_support::*;
use crate::{
    application::send_intent::{Admission, SendIntents},
    domain::{
        error::AppError,
        send_intent::{OutgoingSend, SendOutcome},
        translation::TranslationPolicy,
    },
};

#[test]
fn outgoing_flags_and_han_exclusion_choose_identity_without_subscription_authority() {
    for (enabled, auto_send, include_zh, text, translated) in [
        (false, false, true, "hello", false),
        (true, false, true, "hello", false),
        (false, true, true, "hello", false),
        (true, true, true, "hello", true),
        (true, true, false, "含中文", false),
        (true, true, false, "hello", true),
    ] {
        let policy = TranslationPolicy {
            enabled,
            auto_send,
            include_zh,
            ..TranslationPolicy::default()
        };
        policy.validate().unwrap();
        assert_eq!(policy.should_translate_outgoing(text), translated);
        let (mut account, binding, _, mut request) = fixture(false);
        account.translation.global = policy;
        request.text = text.into();
        let mut owner = SendIntents::new();
        let result = owner.admit(account, binding, None, request);
        if translated {
            assert!(matches!(result, Err(AppError::SessionRequired)));
        } else {
            assert!(
                matches!(result, Ok(Admission::Start(ticket)) if !ticket.translate && ticket.output.is_some())
            );
        }
    }
}

#[test]
fn send_input_and_guest_outcome_decode_strict_closed_contracts() {
    let (_, _, _, mut request) = fixture(false);
    request.text = "😀".repeat(5_000);
    request.validate().unwrap();
    request.text.push('😀');
    assert!(matches!(
        request.validate(),
        Err(AppError::SendIntentInvalid)
    ));
    let (_, _, _, original) = fixture(false);
    for mutate in 0..7 {
        let mut request = original.clone();
        match mutate {
            0 => request.id = "not-a-uuid".into(),
            1 => request.chat_id = "status@broadcast".into(),
            2 => request.composer_revision = 0,
            3 => request.policy_revision = 0,
            4 => request.attempt = 0,
            5 => request.attempt = 10_001,
            6 => request.text = "text\0control".into(),
            _ => unreachable!(),
        }
        assert!(matches!(
            request.validate(),
            Err(AppError::SendIntentInvalid)
        ));
    }
    let mut raw = serde_json::to_value(original).unwrap();
    raw["accountId"] = serde_json::json!("guest-must-not-select-account");
    assert!(serde_json::from_value::<OutgoingSend>(raw).is_err());
    let outcome: SendOutcome = serde_json::from_value(serde_json::json!({
        "status": "notSubmitted", "code": "SEND_INTENT_CHANGED"
    }))
    .unwrap();
    assert!(matches!(
        outcome,
        SendOutcome::NotSubmitted {
            issue: AppError::SendIntentChanged
        }
    ));
    assert!(serde_json::from_value::<SendOutcome>(serde_json::json!({
        "status": "notSubmitted", "code": "a raw vendor exception"
    }))
    .is_err());
}

#[test]
fn unsafe_or_oversized_paid_output_never_becomes_ready_or_gets_an_implicit_refresh() {
    for text in ["".to_owned(), "x\0y".into(), "😀".repeat(5_001)] {
        let mut owner = SendIntents::new();
        let ticket = start(&mut owner, true);
        assert!(matches!(
            owner.remember_output(&ticket, text),
            Err(AppError::TranslationOutputInvalid)
        ));
        assert!(!owner.status(&ticket.request.id).unwrap().retryable);
        assert!(owner.begin_commit(&ticket).is_err());
        let mut retry = ticket.request.clone();
        retry.attempt += 1;
        assert!(
            matches!(owner.admit(ticket.account.clone(), ticket.binding.clone(),
            ticket.session_generation.clone(), retry), Ok(Admission::Status(status)) if !status.retryable)
        );
    }
}
