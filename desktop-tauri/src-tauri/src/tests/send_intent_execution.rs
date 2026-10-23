use super::send_intent_support::*;
use crate::{
    application::send_intent::{Admission, SendIntents},
    domain::{
        error::AppError,
        send_intent::{SendOutcome, SendState},
    },
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

#[test]
fn identity_needs_no_subscription_and_ack_survives_cleanup_failure_and_cancellation() {
    let mut owner = SendIntents::new();
    let ticket = start(&mut owner, false);
    assert!(!ticket.translate);
    assert!(ticket.session_generation.is_none());
    assert_eq!(ticket.output.as_deref(), Some(ticket.request.text.as_str()));
    assert_eq!(
        owner.status(&ticket.request.id).unwrap().state,
        SendState::Ready
    );
    assert!(ticket.control.remaining().unwrap() <= Duration::from_secs(50));
    assert!(owner.begin_commit(&ticket).unwrap());
    assert!(!owner.begin_commit(&ticket).unwrap());
    let sent = owner
        .settle(
            &ticket,
            SendOutcome::Confirmed {
                receipt: "true_synthetic_ack".into(),
                draft_cleared: false,
            },
        )
        .unwrap();
    assert_eq!(sent.state, SendState::Confirmed);
    assert_eq!(sent.draft_cleared, Some(false));
    assert!(!sent.retryable);
    owner.cancel_all(AppError::TranslationCancelled);
    assert_eq!(
        owner.fail(&ticket, AppError::NetworkUnavailable).unwrap(),
        sent
    );
    assert_eq!(
        owner
            .settle(
                &ticket,
                SendOutcome::Uncertain {
                    issue: AppError::SendIntentUncertain,
                }
            )
            .unwrap(),
        sent
    );
    let mut retry = ticket.request.clone();
    retry.attempt += 1;
    assert!(
        matches!(owner.admit(ticket.account.clone(), ticket.binding.clone(), None, retry),
        Ok(Admission::Status(status)) if status == sent)
    );
    assert!(!owner.begin_commit(&ticket).unwrap());
}

#[test]
fn duplicate_polling_and_busy_account_never_create_a_second_execution() {
    let mut owner = SendIntents::new();
    let ticket = start(&mut owner, true);
    for _ in 0..3 {
        assert!(
            matches!(owner.admit(ticket.account.clone(), ticket.binding.clone(),
            ticket.session_generation.clone(), ticket.request.clone()),
            Ok(Admission::Status(status)) if status.state == SendState::Transforming)
        );
    }
    let mut another = ticket.request.clone();
    another.id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        owner.admit(
            ticket.account.clone(),
            ticket.binding.clone(),
            ticket.session_generation.clone(),
            another
        ),
        Err(AppError::SendIntentBusy)
    ));
    assert!(matches!(
        owner.begin_commit(&ticket),
        Err(AppError::SendIntentState)
    ));
    let other_account = start(&mut owner, false);
    assert!(owner.begin_commit(&other_account).unwrap());
    owner.settle(&other_account, confirmed()).unwrap();
    owner
        .remember_output(&ticket, "Un risultato sintetico".into())
        .unwrap();
    assert!(owner.begin_commit(&ticket).unwrap());
    assert!(!owner.begin_commit(&ticket).unwrap());
}

#[test]
fn cancellation_parents_and_absolute_deadline_are_checked_at_the_commit_gate() {
    let mut owner = SendIntents::new();
    let mut ticket = start(&mut owner, false);
    let presentation = Arc::new(AtomicBool::new(false));
    ticket.control = ticket
        .control
        .clone()
        .with_cancel(Arc::clone(&presentation));
    presentation.store(true, Ordering::Release);
    assert!(matches!(
        owner.begin_commit(&ticket),
        Err(AppError::TranslationCancelled)
    ));
    assert_eq!(
        owner.status(&ticket.request.id).unwrap().state,
        SendState::Cancelled
    );

    let mut expired = SendIntents::with_limits(4, 65_536, Duration::ZERO);
    let ticket = start(&mut expired, false);
    assert!(matches!(
        expired.begin_commit(&ticket),
        Err(AppError::TranslationTimeout)
    ));
    let status = expired.status(&ticket.request.id).unwrap();
    assert_eq!(status.state, SendState::Failed);
    assert!(status.retryable);
}

#[test]
fn any_ambiguous_failure_after_commit_is_terminal_and_never_retried() {
    for issue in [
        AppError::TranslationCancelled,
        AppError::TranslationTimeout,
        AppError::NetworkUnavailable,
        AppError::SendIntentChanged,
    ] {
        let mut owner = SendIntents::new();
        let ticket = start(&mut owner, false);
        assert!(owner.begin_commit(&ticket).unwrap());
        let status = owner.fail(&ticket, issue).unwrap();
        assert_eq!(status.state, SendState::Uncertain);
        assert!(!status.retryable);
        assert!(!owner.begin_commit(&ticket).unwrap());
        let mut retry = ticket.request.clone();
        retry.attempt += 1;
        assert!(
            matches!(owner.admit(ticket.account.clone(), ticket.binding.clone(), None, retry),
            Ok(Admission::Status(existing)) if existing == status)
        );
        assert_eq!(owner.settle(&ticket, confirmed()).unwrap(), status);
    }
}

#[test]
fn explicit_not_submitted_keeps_the_paid_output_for_a_new_single_use_attempt() {
    let mut owner = SendIntents::new();
    let first = start(&mut owner, true);
    owner
        .remember_output(&first, "Already translated once".into())
        .unwrap();
    assert!(owner.begin_commit(&first).unwrap());
    let failed = owner
        .settle(
            &first,
            SendOutcome::NotSubmitted {
                issue: AppError::SendIntentChanged,
            },
        )
        .unwrap();
    assert!(failed.retryable);
    let second = next(&mut owner, &first);
    assert_eq!(second.output.as_deref(), Some("Already translated once"));
    assert!(matches!(
        owner.begin_commit(&first),
        Err(AppError::SendIntentConflict)
    ));
    assert!(owner.begin_commit(&second).unwrap());
    assert_eq!(
        owner.settle(&second, confirmed()).unwrap().state,
        SendState::Confirmed
    );
}

#[test]
fn fabricated_or_missing_receipts_cannot_confirm_a_message() {
    for receipt in ["", "  ", "submitted", "bad\nreceipt"] {
        let mut owner = SendIntents::new();
        let ticket = start(&mut owner, false);
        assert!(owner.begin_commit(&ticket).unwrap());
        let status = owner
            .settle(
                &ticket,
                SendOutcome::Confirmed {
                    receipt: receipt.into(),
                    draft_cleared: true,
                },
            )
            .unwrap();
        assert_eq!(status.state, SendState::Uncertain);
        assert_eq!(status.issue, Some(AppError::SendIntentReceiptMissing));
        assert!(!status.retryable);
    }
}
