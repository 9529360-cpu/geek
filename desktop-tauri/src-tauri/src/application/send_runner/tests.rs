use super::*;
use crate::domain::{
    send_intent::{SendContext, SendOutcome, SendState},
    translation::ChatTranslationPolicy,
};

mod support;
use support::*;

#[test]
fn one_blocked_worker_keeps_its_slot_while_only_the_latest_intent_waits() {
    let mut h = Harness::new();
    let (a, first) = fixture(true);
    let blocked = Block::new();
    h.transform.steps.lock().unwrap().push_back(Step::Block(
        Arc::clone(&blocked.0),
        Ok("Late paid A".into()),
    ));
    h.platform.select(a, first.clone());
    h.poll();
    h.start();
    blocked.0.entered();

    let (b, second) = fixture(true);
    h.platform.select(b, second.clone());
    h.poll();
    h.start();
    let (c, third) = fixture(true);
    h.platform.select(c, third.clone());
    h.poll();
    h.start();
    assert_eq!(h.transform.executions.load(Ordering::Acquire), 1);
    assert_eq!(h.runner.queued.as_ref().unwrap().request.id, third.id);
    assert!(h.runner.flight.is_some());
    assert_eq!(h.status(&first.id).state, SendState::Cancelled);
    assert_eq!(h.status(&second.id).state, SendState::Cancelled);
    assert!(h.platform.state.lock().unwrap().commits.is_empty());

    h.transform
        .steps
        .lock()
        .unwrap()
        .push_back(Step::Return(Ok("Paid C".into())));
    blocked.0.release();
    h.finish();
    h.start();
    h.finish();
    assert_eq!(h.transform.executions.load(Ordering::Acquire), 2);
    let state = h.platform.state.lock().unwrap();
    assert_eq!(state.commits.len(), 1);
    assert_eq!(state.commits[0].0, third.id);
}

#[test]
fn editing_the_composer_while_translation_is_blocked_prevents_prepare_and_commit() {
    let mut h = Harness::new();
    let (view, request) = fixture(true);
    let blocked = Block::new();
    h.transform.steps.lock().unwrap().push_back(Step::Block(
        Arc::clone(&blocked.0),
        Ok("Late paid output".into()),
    ));
    h.platform.select(view, request.clone());
    h.poll();
    h.start();
    blocked.0.entered();
    h.platform.state.lock().unwrap().request = None;
    h.poll();
    blocked.0.release();
    h.finish();
    assert_eq!(h.status(&request.id).state, SendState::Cancelled);
    let state = h.platform.state.lock().unwrap();
    assert!(state.prepared.is_empty());
    assert!(state.commits.is_empty());
}

#[test]
fn changed_inherited_send_semantics_cancel_a_blocked_chat_worker_before_prepare() {
    for change_route in [false, true] {
        let mut h = Harness::new();
        let (mut view, mut request) = fixture(true);
        request.text = "请确认 synthetic order".into();
        view.account.translation.chats.insert(
            request.chat_id.clone(),
            ChatTranslationPolicy::from_policy(&view.account.translation.global),
        );
        let blocked = Block::new();
        h.transform.steps.lock().unwrap().push_back(Step::Block(
            Arc::clone(&blocked.0),
            Ok("Late paid output".into()),
        ));
        h.platform.select(view.clone(), request.clone());
        h.poll();
        h.start();
        blocked.0.entered();

        view.account.translation.revision += 1;
        if change_route {
            view.account.translation.global.route = "backup".into();
            assert_eq!(
                view.account.translation.policy(&request.chat_id).route,
                "backup"
            );
        } else {
            view.account.translation.global.include_zh = false;
            assert!(!view
                .account
                .translation
                .policy(&request.chat_id)
                .should_translate_outgoing(&request.text));
        }
        h.platform.select(view, request.clone());
        h.poll();
        assert_eq!(h.status(&request.id).state, SendState::Cancelled);
        assert!(h.runner.flight.as_ref().unwrap().cancelled);
        assert!(h.runner.queued.is_none());
        blocked.0.release();
        h.finish();
        assert_eq!(h.status(&request.id).state, SendState::Cancelled);
        assert_eq!(h.transform.executions.load(Ordering::Acquire), 1);
        let state = h.platform.state.lock().unwrap();
        assert!(state.prepared.is_empty());
        assert!(state.commits.is_empty());
    }
}

#[test]
fn changing_reply_context_without_a_new_attempt_revokes_the_frozen_worker_before_commit() {
    let mut h = Harness::new();
    let (view, mut request) = fixture(true);
    request.context = SendContext::Reply {
        message_id: format!("false_{}_3EB001", request.chat_id),
        chat_id: request.chat_id.clone(),
    };
    let blocked = Block::new();
    h.transform.steps.lock().unwrap().push_back(Step::Block(
        Arc::clone(&blocked.0),
        Ok("Late paid output".into()),
    ));
    h.platform.select(view, request.clone());
    h.poll();
    h.start();
    blocked.0.entered();
    h.platform
        .state
        .lock()
        .unwrap()
        .request
        .as_mut()
        .unwrap()
        .context = SendContext::Reply {
        message_id: format!("false_{}_3EB002", request.chat_id),
        chat_id: request.chat_id.clone(),
    };
    assert_eq!(
        h.service.poll(&mut h.runner),
        Err(AppError::SendIntentConflict)
    );
    // The production start loop suspends after poll errors. It must not replace
    // the conflict with a retryable cancellation or free a still-running worker.
    h.service.suspend(&mut h.runner);
    assert!(h.runner.flight.is_some());
    assert!(h.runner.queued.is_none());
    assert!(!h.status(&request.id).retryable);
    assert_eq!(
        h.status(&request.id).issue,
        Some(AppError::SendIntentConflict)
    );
    blocked.0.release();
    h.finish();
    let status = h.status(&request.id);
    assert_eq!(status.state, SendState::Failed);
    assert_eq!(status.issue, Some(AppError::SendIntentConflict));
    assert!(!status.retryable);
    assert!(h.runner.flight.is_none());
    let state = h.platform.state.lock().unwrap();
    assert!(state.prepared.is_empty());
    assert!(state.commits.is_empty());
    assert_eq!(h.transform.executions.load(Ordering::Acquire), 1);
}

#[test]
fn cancellation_after_prepare_cannot_cross_the_commit_gate() {
    let mut h = Harness::new();
    let (view, request) = fixture(true);
    h.transform
        .steps
        .lock()
        .unwrap()
        .push_back(Step::Return(Ok("Paid output".into())));
    h.platform
        .cancel_after_prepare
        .store(true, Ordering::Release);
    assert_eq!(h.run(view, request), SendState::Cancelled);
    let state = h.platform.state.lock().unwrap();
    assert_eq!(state.prepared.len(), 1);
    assert!(state.commits.is_empty());
}

#[test]
fn explicit_reply_prepare_failure_recovers_the_same_paid_output_without_another_transform() {
    let mut h = Harness::new();
    let (view, mut request) = fixture(true);
    request.context = SendContext::Reply {
        message_id: format!("false_{}_3EB001", request.chat_id),
        chat_id: request.chat_id.clone(),
    };
    h.transform
        .steps
        .lock()
        .unwrap()
        .push_back(Step::Return(Ok("Already paid".into())));
    h.platform
        .state
        .lock()
        .unwrap()
        .prepare_steps
        .push_back(Step::Return(Err(AppError::WebviewFailed)));
    assert_eq!(h.run(view.clone(), request.clone()), SendState::Failed);
    assert!(h.status(&request.id).retryable);
    request.attempt += 1;
    request.composer_revision += 1;
    assert_eq!(h.run(view, request.clone()), SendState::Confirmed);
    assert_eq!(h.status(&request.id).draft_cleared, Some(false));
    assert_eq!(h.transform.executions.load(Ordering::Acquire), 1);
    let state = h.platform.state.lock().unwrap();
    assert_eq!(state.prepared.len(), 2);
    assert!(state.prepared.iter().all(|entry| entry.2 == "Already paid"));
    assert_eq!(state.commits.len(), 1);
    assert_eq!(
        (state.commits[0].0.as_str(), state.commits[0].1),
        (request.id.as_str(), 2)
    );
}

#[test]
fn a_retry_with_saved_output_still_validates_its_subscription_before_sending() {
    let mut h = Harness::new();
    let (view, mut request) = fixture(true);
    h.transform
        .steps
        .lock()
        .unwrap()
        .push_back(Step::Return(Ok("Already paid".into())));
    h.platform
        .state
        .lock()
        .unwrap()
        .prepare_steps
        .push_back(Step::Return(Err(AppError::WebviewFailed)));
    assert_eq!(h.run(view.clone(), request.clone()), SendState::Failed);
    request.attempt += 1;
    h.platform.select(view, request.clone());
    h.poll();
    assert_eq!(
        h.runner.queued.as_ref().unwrap().output.as_deref(),
        Some("Already paid")
    );
    h.transform.deny_validation.store(true, Ordering::Release);
    h.start();
    assert!(h.runner.flight.is_none());
    assert_eq!(h.status(&request.id).issue, Some(AppError::SessionRequired));
    assert_eq!(h.transform.executions.load(Ordering::Acquire), 1);
    assert!(h.platform.state.lock().unwrap().commits.is_empty());
}

#[test]
fn commit_timeout_or_panic_is_uncertain_and_polling_or_another_attempt_never_replays_it() {
    for panic in [false, true] {
        let mut h = Harness::new();
        let (view, mut request) = fixture(false);
        h.platform
            .state
            .lock()
            .unwrap()
            .commit_steps
            .push_back(if panic {
                Step::Panic
            } else {
                Step::Return(SendOutcome::Uncertain {
                    issue: AppError::TranslationTimeout,
                })
            });
        assert_eq!(h.run(view.clone(), request.clone()), SendState::Uncertain);
        assert!(!h.status(&request.id).retryable);
        h.poll();
        h.start();
        request.attempt += 1;
        h.platform.select(view, request);
        h.poll();
        h.start();
        assert!(h.runner.flight.is_none() && h.runner.queued.is_none());
        assert_eq!(h.platform.state.lock().unwrap().commits.len(), 1);
    }
}

#[test]
fn identity_sends_skip_the_paid_transform_even_when_the_service_is_signed_out() {
    for skip_han in [false, true] {
        let mut h = Harness::new();
        *h.transform.session.lock().unwrap() = None;
        let (mut view, mut request) = fixture(skip_han);
        if skip_han {
            view.account.translation.global.include_zh = false;
            request.text = "Synthetic 中文 draft".into();
        }
        let original = request.text.clone();
        assert_eq!(h.run(view, request), SendState::Confirmed);
        assert_eq!(h.transform.executions.load(Ordering::Acquire), 0);
        assert_eq!(h.platform.state.lock().unwrap().prepared[0].2, original);
    }
}

#[test]
fn a_transform_panic_releases_the_worker_for_the_next_intent() {
    let mut h = Harness::new();
    let (view, request) = fixture(true);
    h.transform.steps.lock().unwrap().push_back(Step::Panic);
    assert_eq!(h.run(view, request), SendState::Failed);
    assert!(h.platform.state.lock().unwrap().commits.is_empty());
    let (view, request) = fixture(false);
    assert_eq!(h.run(view, request), SendState::Confirmed);
    assert_eq!(h.platform.state.lock().unwrap().commits.len(), 1);
}

#[test]
fn a_status_delivery_panic_still_releases_the_worker_slot() {
    let mut h = Harness::new();
    let (view, request) = fixture(false);
    h.platform.panic_delivery.store(true, Ordering::Release);
    assert_eq!(h.run(view, request), SendState::Confirmed);
    let (view, request) = fixture(false);
    assert_eq!(h.run(view, request), SendState::Confirmed);
    assert_eq!(h.platform.state.lock().unwrap().commits.len(), 2);
}

#[test]
fn returning_to_the_same_account_cannot_let_an_old_flight_cancel_or_overwrite_its_new_attempt() {
    let mut h = Harness::new();
    let (a, first) = fixture(true);
    let blocked = Block::new();
    h.transform.steps.lock().unwrap().push_back(Step::Block(
        Arc::clone(&blocked.0),
        Ok("Old output must not overwrite".into()),
    ));
    h.platform.select(a.clone(), first.clone());
    h.poll();
    h.start();
    blocked.0.entered();
    let (b, other) = fixture(false);
    h.platform.select(b, other);
    h.poll();
    let mut retry = first.clone();
    retry.attempt += 1;
    retry.composer_revision += 1;
    h.platform.select(a, retry.clone());
    h.poll();
    h.poll(); // The cancelled old worker still exists during another native poll.
    assert!(h.runner.queued.as_ref().unwrap().control.check().is_ok());
    assert!(h.status(&retry.id).state.active());
    blocked.0.release();
    h.finish();
    assert!(h.status(&retry.id).state.active());
    h.transform
        .steps
        .lock()
        .unwrap()
        .push_back(Step::Return(Ok("Current output".into())));
    h.start();
    h.finish();
    assert_eq!(h.status(&retry.id).state, SendState::Confirmed);
    assert_eq!(h.status(&retry.id).attempt, 2);
    let state = h.platform.state.lock().unwrap();
    assert_eq!(state.commits.len(), 1);
    assert_eq!(state.commits[0].1, 2);
    assert_eq!(state.prepared[0].2, "Current output");
}
