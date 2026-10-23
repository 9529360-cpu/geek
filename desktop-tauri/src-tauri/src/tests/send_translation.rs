use super::{
    send_intent_support,
    session_support::{self, Gate},
    translation_support::{self, token, translated, Operation},
};
use crate::{
    application::{
        send_intent::{Admission, SendIntents, SendTicket},
        send_ports::SendTransform,
        send_translation::SendTranslation,
    },
    domain::error::AppError,
};
use std::sync::Arc;

fn admit(
    owner: &mut SendIntents,
    transform: &impl SendTransform,
    translate: bool,
) -> Box<SendTicket> {
    let (account, binding, _, request) = send_intent_support::fixture(translate);
    let Admission::Start(ticket) = owner
        .admit(account, binding, transform.generation(), request)
        .unwrap()
    else {
        panic!("synthetic first intent must start");
    };
    ticket
}

#[test]
fn binding_a_translation_attaches_subscription_cancellation_to_the_entire_send_budget() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let mut ticket = admit(&mut owner, &transform, true);
    transform.bind(&mut ticket).unwrap();
    assert!(ticket.control.check().is_ok());
    h.session.logout().unwrap();
    assert_eq!(ticket.control.check(), Err(AppError::TranslationCancelled));
    assert_eq!(
        transform.validate(&ticket),
        Err(AppError::TranslationCancelled)
    );
    assert_eq!(
        transform.execute(&ticket),
        Err(AppError::TranslationCancelled)
    );
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}

#[test]
fn a_login_replacement_between_admission_and_binding_cannot_rebind_an_old_intent() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let mut ticket = admit(&mut owner, &transform, true);
    session_support::login(&h.session, &h.auth, 2, 100);
    assert_eq!(transform.bind(&mut ticket), Err(AppError::SessionChanged));
    assert_eq!(transform.validate(&ticket), Err(AppError::SessionChanged));
    assert!(h.gateway.calls(Operation::Token).is_empty());
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn a_retained_paid_output_requires_a_live_login_but_no_second_quota_or_translation_request() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let mut ticket = admit(&mut owner, &transform, true);
    transform.bind(&mut ticket).unwrap();
    h.gateway.token_reply(Ok(token("paid")), None);
    h.gateway
        .translation_reply(Ok(translated("Already paid", Some(0))), None);
    let output = transform.execute(&ticket).unwrap();
    owner.remember_output(&ticket, output).unwrap();
    owner.fail(&ticket, AppError::WebviewFailed).unwrap();
    let mut retry = send_intent_support::next(&mut owner, &ticket);
    assert_eq!(retry.output.as_deref(), Some("Already paid"));
    assert_eq!(retry.request.id, ticket.request.id);
    transform.bind(&mut retry).unwrap();
    // The paid result may proceed even when that completed request exhausted quota.
    // SendRunner skips execute when output is already owned, but still validates.
    transform.validate(&retry).unwrap();
    h.session.logout().unwrap();
    assert_eq!(
        transform.validate(&retry),
        Err(AppError::TranslationCancelled)
    );
    assert!(matches!(
        owner.begin_commit(&retry),
        Err(AppError::TranslationCancelled)
    ));
    assert!(h.gateway.calls(Operation::Quota).is_empty());
    assert_eq!(h.gateway.calls(Operation::Token).len(), 1);
    assert_eq!(h.gateway.calls(Operation::Translate).len(), 1);
}

#[test]
fn logout_during_short_token_resolution_cancels_the_bound_send_and_prevents_paid_dispatch() {
    let h = translation_support::setup();
    let transform = Arc::new(SendTranslation::new(
        Arc::clone(&h.session),
        Arc::clone(&h.engine),
    ));
    let mut owner = SendIntents::new();
    let mut ticket = admit(&mut owner, transform.as_ref(), true);
    transform.bind(&mut ticket).unwrap();
    let cancellation = ticket.control.clone();
    let gate = Arc::new(Gate::default());
    h.gateway
        .token_reply(Ok(token("late")), Some(Arc::clone(&gate)));
    let worker = std::thread::spawn(move || transform.execute(&ticket));
    gate.entered();
    h.session.logout().unwrap();
    assert_eq!(cancellation.check(), Err(AppError::TranslationCancelled));
    gate.release();
    assert_eq!(worker.join().unwrap(), Err(AppError::TranslationCancelled));
    assert!(h.gateway.calls(Operation::Translate).is_empty());
}

#[test]
fn a_signed_out_identity_send_has_no_subscription_or_paid_translation_dependency() {
    let h = translation_support::setup();
    h.session.logout().unwrap();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let mut ticket = admit(&mut owner, &transform, false);
    transform.bind(&mut ticket).unwrap();
    transform.validate(&ticket).unwrap();
    assert_eq!(transform.execute(&ticket).unwrap(), ticket.request.text);
    assert!(owner.begin_commit(&ticket).unwrap());
    assert!(ticket.session_generation.is_none());
    for operation in [Operation::Quota, Operation::Token, Operation::Translate] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}
