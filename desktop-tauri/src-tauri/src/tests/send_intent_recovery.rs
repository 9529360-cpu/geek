use super::send_intent_support::*;
use crate::{
    application::send_intent::{Admission, SendIntents},
    domain::{
        error::AppError,
        proxy::ProxyConfig,
        send_intent::{SendOutcome, SendState},
    },
};
use std::time::Duration;
use uuid::Uuid;

#[test]
fn a_first_observed_guest_retry_is_admitted_once_and_retains_all_existing_replay_guards() {
    let mut owner = SendIntents::new();
    let (account, binding, session, mut request) = fixture(true);
    // The guest cancelled attempt 1 before a native poll, then received a new
    // trusted gesture for the unchanged source after hide/show or A -> B -> A.
    request.attempt = 2;
    request.composer_revision += 2;
    assert!(owner.status(&request.id).is_none());
    let Admission::Start(ticket) = owner
        .admit(
            account.clone(),
            binding.clone(),
            session.clone(),
            request.clone(),
        )
        .expect("a never-admitted intent must not depend on observing its cancelled guest attempt")
    else {
        panic!("the first native observation must start exactly one execution");
    };
    assert_eq!(ticket.request.attempt, 2);
    assert!(ticket.output.is_none());
    assert!(matches!(
        owner.admit(account.clone(), binding.clone(), session.clone(), request.clone()),
        Ok(Admission::Status(status)) if status.attempt == 2 && status.state == SendState::Transforming
    ));
    let mut stale = request.clone();
    stale.attempt = 1;
    assert!(matches!(
        owner.admit(account.clone(), binding.clone(), session.clone(), stale),
        Err(AppError::SendIntentConflict)
    ));
    owner
        .remember_output(&ticket, "Paid once for this logical intent".into())
        .unwrap();
    owner.fail(&ticket, AppError::SendIntentChanged).unwrap();
    let retry = next(&mut owner, &ticket);
    assert_eq!(retry.request.attempt, 3);
    assert_eq!(
        retry.output.as_deref(),
        Some("Paid once for this logical intent")
    );
    assert!(matches!(
        owner.begin_commit(&ticket),
        Err(AppError::SendIntentConflict)
    ));
    assert!(owner.begin_commit(&retry).unwrap());
    assert!(!owner.begin_commit(&retry).unwrap());
    let sent = owner.settle(&retry, confirmed()).unwrap();
    let mut replay = retry.request.clone();
    replay.attempt += 1;
    assert!(matches!(
        owner.admit(account, binding, session, replay),
        Ok(Admission::Status(status)) if status == sent && !status.retryable
    ));
}

#[test]
fn a_retry_can_skip_guest_only_attempts_without_repeating_paid_work_or_reviving_old_tickets() {
    let mut owner = SendIntents::new();
    let first = start(&mut owner, true);
    let mut request = first.request.clone();
    request.attempt = 3;
    request.composer_revision += 4;
    let admit = |owner: &mut SendIntents, request| {
        owner.admit(
            first.account.clone(),
            first.binding.clone(),
            first.session_generation.clone(),
            request,
        )
    };
    assert!(!matches!(
        admit(&mut owner, request.clone()),
        Ok(Admission::Start(_))
    ));
    assert_eq!(
        owner.status(&first.request.id).unwrap().state,
        SendState::Transforming
    );
    owner
        .remember_output(&first, "Already paid before the local cancellation".into())
        .unwrap();
    owner.fail(&first, AppError::TranslationCancelled).unwrap();
    // Attempt 2 existed only in the guest and was cancelled before a native poll.
    let Admission::Start(current) = admit(&mut owner, request.clone()).unwrap() else {
        panic!("a newer trusted retry must not require observing every local attempt");
    };
    assert_eq!(
        current.output.as_deref(),
        Some("Already paid before the local cancellation")
    );
    assert_eq!(current.request.attempt, 3);
    assert!(matches!(admit(&mut owner, request.clone()),
        Ok(Admission::Status(status)) if status.attempt == 3 && status.state == SendState::Ready));
    let mut stale = request.clone();
    stale.attempt = 2;
    assert!(matches!(
        admit(&mut owner, stale),
        Err(AppError::SendIntentConflict)
    ));
    assert!(matches!(
        owner.remember_output(&first, "Late old output".into()),
        Err(AppError::SendIntentConflict)
    ));
    assert!(matches!(
        owner.begin_commit(&first),
        Err(AppError::SendIntentConflict)
    ));
    assert!(owner.begin_commit(&current).unwrap());
    let terminal = owner.settle(&current, confirmed()).unwrap();
    request.attempt = 9;
    assert!(matches!(admit(&mut owner, request),
        Ok(Admission::Status(status)) if status == terminal && !status.retryable));
}

#[test]
fn explicit_retry_rebinds_only_its_composer_and_keeps_the_logical_paid_result() {
    let mut owner = SendIntents::new();
    let old = start(&mut owner, true);
    owner.remember_output(&old, "Paid output".into()).unwrap();
    let mut changed = old.request.clone();
    changed.composer_revision += 2;
    assert!(matches!(
        owner.admit(
            old.account.clone(),
            old.binding.clone(),
            old.session_generation.clone(),
            changed.clone()
        ),
        Err(AppError::SendIntentConflict)
    ));
    owner.fail(&old, AppError::SendIntentChanged).unwrap();
    changed.attempt += 1;
    let Admission::Start(current) = owner
        .admit(
            old.account.clone(),
            old.binding.clone(),
            old.session_generation.clone(),
            changed,
        )
        .unwrap()
    else {
        panic!("retry must start")
    };
    assert_eq!(current.output.as_deref(), Some("Paid output"));
    assert_eq!(current.request.id, old.request.id);
    assert_eq!(
        current.request.composer_revision,
        old.request.composer_revision + 2
    );
    assert!(matches!(
        owner.remember_output(&old, "Late old output".into()),
        Err(AppError::SendIntentConflict)
    ));
    assert!(matches!(
        owner.begin_commit(&old),
        Err(AppError::SendIntentConflict)
    ));
    assert!(matches!(
        owner.fail(&old, AppError::NetworkUnavailable),
        Err(AppError::SendIntentConflict)
    ));
    assert!(matches!(
        owner.settle(&old, confirmed()),
        Err(AppError::SendIntentConflict)
    ));
    assert!(owner.begin_commit(&current).unwrap());
    owner.settle(&current, confirmed()).unwrap();
}

#[test]
fn cancellation_before_a_paid_response_retains_output_without_reopening_submission() {
    let mut owner = SendIntents::new();
    let ticket = start(&mut owner, true);
    owner.cancel_all(AppError::TranslationCancelled);
    let late = owner
        .remember_output(&ticket, "Paid before cancellation reached server".into())
        .unwrap();
    assert_eq!(late.state, SendState::Cancelled);
    assert!(late.retryable);
    assert!(matches!(
        owner.begin_commit(&ticket),
        Err(AppError::TranslationCancelled)
    ));
    let retry = next(&mut owner, &ticket);
    assert_eq!(
        retry.output.as_deref(),
        Some("Paid before cancellation reached server")
    );
    assert!(owner.begin_commit(&retry).unwrap());
}

#[test]
fn appearance_revisions_keep_the_intent_but_route_language_owner_and_generation_do_not() {
    let mut owner = SendIntents::new();
    let ticket = start(&mut owner, true);
    owner
        .remember_output(&ticket, "Saved translation".into())
        .unwrap();
    owner.fail(&ticket, AppError::NetworkUnavailable).unwrap();
    let mut account = ticket.account.clone();
    account.translation.revision += 1;
    account.translation.global.font_color = "#FFFFFF".into();
    account.translation.global.font_size = 15;
    account.translation.global.message_target = "it".into();
    account.translation.global.group_auto = true;
    let mut request = ticket.request.clone();
    request.policy_revision = account.translation.revision;
    request.attempt += 1;
    let Admission::Start(retried) = owner
        .admit(
            account,
            ticket.binding.clone(),
            ticket.session_generation.clone(),
            request,
        )
        .unwrap()
    else {
        panic!("appearance retry")
    };
    assert_eq!(retried.output.as_deref(), Some("Saved translation"));
    owner.fail(&retried, AppError::NetworkUnavailable).unwrap();

    for change in 0..8 {
        let mut account = retried.account.clone();
        let mut binding = retried.binding.clone();
        let mut session = retried.session_generation.clone();
        let mut request = retried.request.clone();
        request.attempt += 1;
        match change {
            0 => {
                account.id = Uuid::new_v4().to_string();
                binding.account_id = account.id.clone();
            }
            1 => binding.generation = Uuid::new_v4().to_string(),
            2 => request.chat_id = "12025550124@c.us".into(),
            3 => request.text.push_str(" changed"),
            4 => session = Some(Uuid::new_v4().to_string()),
            5 => {
                account.proxy = ProxyConfig::Http {
                    host: "proxy.example.invalid".into(),
                    port: 8080,
                }
            }
            6 => account.translation.global.target = "it".into(),
            7 => account.translation.global.route = "backup".into(),
            _ => unreachable!(),
        }
        assert!(
            matches!(
                owner.admit(account, binding, session, request),
                Err(AppError::SendIntentConflict)
            ),
            "changed semantic field {change} must not inherit a paid intent"
        );
    }
}

#[test]
fn record_capacity_retains_terminal_tombstones_instead_of_forgetting_sent_intents() {
    let mut owner = SendIntents::with_limits(2, 65_536, Duration::from_secs(50));
    let first = start(&mut owner, false);
    owner.begin_commit(&first).unwrap();
    owner.settle(&first, confirmed()).unwrap();
    let second = start(&mut owner, false);
    owner.begin_commit(&second).unwrap();
    owner
        .settle(
            &second,
            SendOutcome::Uncertain {
                issue: AppError::NetworkUnavailable,
            },
        )
        .unwrap();
    let (account, binding, session, request) = fixture(false);
    assert!(matches!(
        owner.admit(account, binding, session, request),
        Err(AppError::SendIntentLimit)
    ));
    assert!(
        matches!(owner.admit(first.account.clone(), first.binding.clone(), None, first.request.clone()),
        Ok(Admission::Status(status)) if status.state == SendState::Confirmed)
    );
    assert!(
        matches!(owner.admit(second.account.clone(), second.binding.clone(), None, second.request.clone()),
        Ok(Admission::Status(status)) if status.state == SendState::Uncertain)
    );
}

#[test]
fn output_capacity_is_reserved_before_translation_and_retained_for_explicit_recovery() {
    let mut owner = SendIntents::with_limits(8, 32_768, Duration::from_secs(50));
    let first = start(&mut owner, true);
    let (account, binding, session, request) = fixture(true);
    assert!(matches!(
        owner.admit(
            account.clone(),
            binding.clone(),
            session.clone(),
            request.clone()
        ),
        Err(AppError::SendIntentLimit)
    ));
    owner
        .remember_output(&first, "Already paid".into())
        .unwrap();
    owner.fail(&first, AppError::SendIntentChanged).unwrap();
    assert!(matches!(
        owner.admit(
            account.clone(),
            binding.clone(),
            session.clone(),
            request.clone()
        ),
        Err(AppError::SendIntentLimit)
    ));
    let retry = next(&mut owner, &first);
    assert_eq!(retry.output.as_deref(), Some("Already paid"));
    owner.begin_commit(&retry).unwrap();
    owner.settle(&retry, confirmed()).unwrap();
    assert!(matches!(
        owner.admit(account, binding, session, request),
        Ok(Admission::Start(_))
    ));
}
