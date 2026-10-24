use crate::{
    application::request_control::RequestControl,
    desktop::platform_sessions::PlatformSessions,
    domain::{
        broadcast::{BroadcastIssue, GuestBinding},
        error::AppError,
    },
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

fn ready(sessions: &PlatformSessions, id: &str) -> (String, GuestBinding, Arc<AtomicBool>) {
    let incarnation = sessions.created(id, "whatsapp");
    sessions.page(id, &incarnation, false);
    let binding = sessions.binding(id, "whatsapp").unwrap();
    let cancel = sessions.cancellation(&binding).unwrap();
    (incarnation, binding, cancel)
}

fn control(cancel: &Arc<AtomicBool>) -> RequestControl {
    RequestControl::new(Duration::from_secs(60)).with_cancel(Arc::clone(cancel))
}

#[test]
fn replacing_a_guest_cancels_its_work_without_leaking_the_old_flag_into_the_new_incarnation() {
    let sessions = PlatformSessions::default();
    let (old_incarnation, old_binding, old_cancel) = ready(&sessions, "a");
    let (_, other_binding, other_cancel) = ready(&sessions, "b");
    let old_work = control(&old_cancel);
    let new_incarnation = sessions.created("a", "whatsapp");
    assert!(matches!(
        old_work.check(),
        Err(AppError::TranslationCancelled)
    ));
    assert!(sessions.cancellation(&old_binding).is_err());
    sessions.page("a", &old_incarnation, false);
    assert!(sessions.binding("a", "whatsapp").is_err());
    sessions.page("a", &new_incarnation, false);
    let current = sessions.binding("a", "whatsapp").unwrap();
    let cancel = sessions.cancellation(&current).unwrap();
    assert!(!Arc::ptr_eq(&old_cancel, &cancel));
    sessions.page("a", &old_incarnation, true);
    assert!(!cancel.load(Ordering::Acquire));
    control(&cancel).check().unwrap();
    assert!(sessions.valid(&current));
    assert!(sessions.valid(&other_binding));
    assert!(!other_cancel.load(Ordering::Acquire));
}

#[test]
fn page_started_cancels_the_previous_document_and_finished_preserves_the_new_work_flag() {
    let sessions = PlatformSessions::default();
    let (incarnation, previous, previous_cancel) = ready(&sessions, "a");
    let (_, other, other_cancel) = ready(&sessions, "b");
    let previous_work = control(&previous_cancel);
    sessions.page("a", &incarnation, true);
    assert!(matches!(
        previous_work.check(),
        Err(AppError::TranslationCancelled)
    ));
    assert_eq!(
        sessions.cancellation(&previous).err(),
        Some(BroadcastIssue::GuestChanged)
    );
    assert!(sessions.binding("a", "whatsapp").is_err());
    sessions.page("a", &incarnation, false);
    let current = sessions.binding("a", "whatsapp").unwrap();
    let current_cancel = sessions.cancellation(&current).unwrap();
    assert_ne!(current.generation, previous.generation);
    assert!(!Arc::ptr_eq(&current_cancel, &previous_cancel));
    sessions.page("a", &incarnation, false);
    assert!(Arc::ptr_eq(
        &current_cancel,
        &sessions.cancellation(&current).unwrap()
    ));
    control(&current_cancel).check().unwrap();
    assert!(sessions.valid(&other));
    assert!(!other_cancel.load(Ordering::Acquire));
}

#[test]
fn invalidation_cancels_in_flight_work_and_new_cancellation_requires_the_durable_ack() {
    let sessions = PlatformSessions::default();
    let (incarnation, previous, previous_cancel) = ready(&sessions, "a");
    let (_, other, other_cancel) = ready(&sessions, "b");
    let previous_work = control(&previous_cancel);
    sessions.invalidate("a");
    assert!(matches!(
        previous_work.check(),
        Err(AppError::TranslationCancelled)
    ));
    assert!(sessions.cancellation(&previous).is_err());
    let current = sessions.current("a").unwrap();
    sessions.page("a", &incarnation, false);
    assert!(sessions.cancellation(&current).is_err());
    let (id, token) = sessions.pending_invalidations().pop().unwrap();
    sessions.acknowledge_invalidated(&id, &token);
    let current_cancel = sessions.cancellation(&current).unwrap();
    assert!(!Arc::ptr_eq(&previous_cancel, &current_cancel));
    control(&current_cancel).check().unwrap();
    assert!(sessions.valid(&other));
    assert!(!other_cancel.load(Ordering::Acquire));
}

#[test]
fn removal_cancels_owned_work_and_a_reopened_account_gets_an_independent_live_flag() {
    let sessions = PlatformSessions::default();
    let (old_incarnation, previous, previous_cancel) = ready(&sessions, "a");
    let old_work = control(&previous_cancel);
    sessions.removed("a");
    assert!(matches!(
        old_work.check(),
        Err(AppError::TranslationCancelled)
    ));
    assert!(sessions.current("a").is_none());
    assert!(sessions.cancellation(&previous).is_err());
    let (_, current, current_cancel) = ready(&sessions, "a");
    assert!(!Arc::ptr_eq(&previous_cancel, &current_cancel));
    sessions.page("a", &old_incarnation, true);
    sessions.page("a", &old_incarnation, false);
    assert!(sessions.valid(&current));
    assert!(previous_cancel.load(Ordering::Acquire));
    control(&current_cancel).check().unwrap();
}

#[test]
fn hide_show_revokes_only_the_old_presentation_without_changing_document_identity() {
    let sessions = PlatformSessions::default();
    let (_, binding, background) = ready(&sessions, "a");
    assert!(sessions.presentation_cancellation(&binding).is_err());
    sessions.set_visible("a", true);
    let previous = sessions.presentation_cancellation(&binding).unwrap();
    sessions.set_visible("a", true);
    assert!(Arc::ptr_eq(
        &previous,
        &sessions.presentation_cancellation(&binding).unwrap()
    ));
    sessions.set_visible("a", false);
    assert!(matches!(
        control(&previous).check(),
        Err(AppError::TranslationCancelled)
    ));
    assert!(sessions.presentation_cancellation(&binding).is_err());
    assert!(sessions.valid(&binding));
    control(&background).check().unwrap();
    sessions.set_visible("a", true);
    let current = sessions.presentation_cancellation(&binding).unwrap();
    assert!(!Arc::ptr_eq(&previous, &current));
    control(&current).check().unwrap();
    assert!(previous.load(Ordering::Acquire));
    assert_eq!(sessions.binding("a", "whatsapp").unwrap(), binding);
}

#[test]
fn switching_accounts_cannot_revive_a_previous_presentation_lease() {
    let sessions = PlatformSessions::default();
    let (_, first, first_background) = ready(&sessions, "a");
    let (_, second, second_background) = ready(&sessions, "b");
    sessions.set_visible("a", true);
    let old_first = sessions.presentation_cancellation(&first).unwrap();
    sessions.set_visible("a", false);
    sessions.set_visible("b", true);
    let second_lease = sessions.presentation_cancellation(&second).unwrap();
    sessions.set_visible("b", false);
    sessions.set_visible("a", true);
    assert!(old_first.load(Ordering::Acquire));
    assert!(second_lease.load(Ordering::Acquire));
    control(&sessions.presentation_cancellation(&first).unwrap())
        .check()
        .unwrap();
    control(&first_background).check().unwrap();
    control(&second_background).check().unwrap();
}

#[test]
fn navigation_invalidation_and_reopen_each_revoke_the_presentation_lease() {
    let sessions = PlatformSessions::default();
    let (incarnation, original, _) = ready(&sessions, "a");
    sessions.set_visible("a", true);
    let original_lease = sessions.presentation_cancellation(&original).unwrap();
    sessions.page("a", &incarnation, true);
    assert!(original_lease.load(Ordering::Acquire));
    assert!(sessions.presentation_cancellation(&original).is_err());
    sessions.page("a", &incarnation, false);
    let loaded = sessions.binding("a", "whatsapp").unwrap();
    let loaded_lease = sessions.presentation_cancellation(&loaded).unwrap();
    control(&loaded_lease).check().unwrap();
    sessions.invalidate("a");
    assert!(loaded_lease.load(Ordering::Acquire));
    let invalidated = sessions.current("a").unwrap();
    sessions.page("a", &incarnation, false);
    assert!(sessions.presentation_cancellation(&invalidated).is_err());
    let (id, token) = sessions.pending_invalidations().pop().unwrap();
    sessions.acknowledge_invalidated(&id, &token);
    let invalidated_lease = sessions.presentation_cancellation(&invalidated).unwrap();
    sessions.removed("a");
    assert!(invalidated_lease.load(Ordering::Acquire));
    let (_, reopened, _) = ready(&sessions, "a");
    assert!(sessions.presentation_cancellation(&reopened).is_err());
    sessions.set_visible("a", true);
    control(&sessions.presentation_cancellation(&reopened).unwrap())
        .check()
        .unwrap();
    assert!(sessions.presentation_cancellation(&invalidated).is_err());
}

#[test]
fn hide_revokes_before_deactivation_enqueue_and_rejects_a_late_commit() {
    let sessions = PlatformSessions::default();
    let (_, binding, background) = ready(&sessions, "a");
    sessions.set_visible("a", true);
    let lease = sessions.presentation_cancellation(&binding).unwrap();
    let pending = control(&lease);
    let mut events = Vec::new();
    sessions
        .enqueue_presented(&binding, || {
            pending.check()?;
            events.push("commit");
            Ok(())
        })
        .unwrap();
    sessions
        .hide_and_enqueue("a", |current| {
            assert_eq!(current, &binding);
            assert!(lease.load(Ordering::Acquire));
            events.push("deactivate");
            Ok(())
        })
        .unwrap();
    assert_eq!(
        sessions.enqueue_presented(&binding, || {
            events.push("late commit");
            Ok(())
        }),
        Err(AppError::SendIntentChanged)
    );
    assert_eq!(events, ["commit", "deactivate"]);
    sessions.set_visible("a", true);
    assert_eq!(
        sessions.enqueue_presented(&binding, || {
            pending.check()?;
            events.push("revived commit");
            Ok(())
        }),
        Err(AppError::TranslationCancelled)
    );
    assert_eq!(events, ["commit", "deactivate"]);
    control(&background).check().unwrap();
}

#[test]
fn failed_deactivation_enqueue_never_restores_the_old_commit_lease() {
    let sessions = PlatformSessions::default();
    let (_, binding, _) = ready(&sessions, "a");
    sessions.set_visible("a", true);
    let previous = sessions.presentation_cancellation(&binding).unwrap();
    assert_eq!(
        sessions.hide_and_enqueue("a", |_| Err(AppError::WebviewFailed)),
        Err(AppError::WebviewFailed)
    );
    assert!(previous.load(Ordering::Acquire));
    assert!(sessions.presentation_cancellation(&binding).is_err());
    assert_eq!(
        sessions.enqueue_presented(&binding, || Ok(())),
        Err(AppError::SendIntentChanged)
    );
    sessions.set_visible("a", true);
    control(&sessions.presentation_cancellation(&binding).unwrap())
        .check()
        .unwrap();
    assert!(previous.load(Ordering::Acquire));
}
