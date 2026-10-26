use crate::{desktop::platform_sessions::PlatformSessions, domain::broadcast::BroadcastIssue};

#[test]
fn a_new_guest_requires_its_own_load_and_the_exact_account_platform() {
    let sessions = PlatformSessions::default();
    let incarnation = sessions.created("account-a", "whatsapp");
    assert!(sessions
        .current_for_incarnation("account-a", &incarnation)
        .is_some());
    assert!(sessions
        .current_for_incarnation("account-a", "old-incarnation")
        .is_none());
    assert_eq!(
        sessions.binding("account-a", "whatsapp"),
        Err(BroadcastIssue::AccountUnavailable)
    );
    sessions.page("account-a", "unrelated-incarnation", false);
    assert!(sessions.binding("account-a", "whatsapp").is_err());
    sessions.page("account-a", &incarnation, false);
    let binding = sessions.binding("account-a", "whatsapp").unwrap();
    assert!(sessions.valid(&binding));
    assert_eq!(binding.account_id, "account-a");
    assert_eq!(binding.platform_id, "whatsapp");
    assert!(sessions.binding("account-a", "whatsapp-pure").is_err());
    assert!(sessions.binding("account-b", "whatsapp").is_err());
    let mut forged = binding.clone();
    forged.account_id = "account-b".into();
    assert!(!sessions.valid(&forged));
}

#[test]
fn old_incarnation_callbacks_cannot_ready_or_invalidate_a_reopened_guest() {
    let sessions = PlatformSessions::default();
    let first = sessions.created("account-a", "whatsapp");
    sessions.page("account-a", &first, false);
    let old = sessions.binding("account-a", "whatsapp").unwrap();
    sessions.invalidate("account-a");
    let (id, token) = sessions.pending_invalidations().pop().unwrap();
    sessions.removed("account-a");
    assert!(!sessions.valid(&old));
    let second = sessions.created("account-a", "whatsapp");
    assert_ne!(first, second);
    assert!(sessions
        .current_for_incarnation("account-a", &first)
        .is_none());
    sessions.page("account-a", &first, false);
    assert!(sessions.binding("account-a", "whatsapp").is_err());
    sessions.acknowledge_invalidated(&id, &token);
    assert!(sessions.binding("account-a", "whatsapp").is_err());
    sessions.page("account-a", &second, false);
    let new = sessions.binding("account-a", "whatsapp").unwrap();
    assert_ne!(old.generation, new.generation);
    sessions.page("account-a", &first, true);
    sessions.page("account-a", &first, false);
    assert!(sessions.valid(&new));
    assert!(!sessions.valid(&old));
    assert_eq!(
        sessions.current_for_incarnation("account-a", &second),
        Some(new)
    );
    assert!(sessions
        .current_for_incarnation("account-a", &first)
        .is_none());
    assert!(sessions.pending_invalidations().is_empty());
}

#[test]
fn navigation_and_reload_revoke_only_that_accounts_frozen_generation() {
    let sessions = PlatformSessions::default();
    let a = sessions.created("account-a", "whatsapp");
    let b = sessions.created("account-b", "whatsapp-pure");
    sessions.page("account-a", &a, false);
    sessions.page("account-b", &b, false);
    let original = sessions.binding("account-a", "whatsapp").unwrap();
    let other = sessions.binding("account-b", "whatsapp-pure").unwrap();
    sessions.page("account-a", &a, true);
    assert!(!sessions.valid(&original));
    assert!(sessions.binding("account-a", "whatsapp").is_err());
    assert!(sessions.valid(&other));
    sessions.page("account-a", &a, false);
    let navigated = sessions.binding("account-a", "whatsapp").unwrap();
    assert_ne!(navigated.generation, original.generation);
    sessions.invalidate("account-a");
    assert!(!sessions.valid(&navigated));
    assert!(sessions.valid(&other));
    sessions.page("account-a", &a, false);
    assert_eq!(
        sessions.binding("account-a", "whatsapp"),
        Err(BroadcastIssue::AccountUnavailable)
    );
    let (id, token) = sessions.pending_invalidations().pop().unwrap();
    sessions.acknowledge_invalidated(&id, &token);
    let reloaded = sessions.binding("account-a", "whatsapp").unwrap();
    assert_ne!(reloaded.generation, navigated.generation);
    assert!(!sessions.valid(&original));
}

#[test]
fn invalidation_queue_retains_events_until_ack_even_when_no_guest_is_open() {
    let sessions = PlatformSessions::default();
    sessions.invalidate("closed-account");
    sessions.invalidate("closed-account");
    sessions.invalidate("another-account");
    let mut pending = sessions.pending_invalidations();
    pending.sort();
    assert_eq!(
        pending
            .iter()
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>(),
        vec!["another-account", "closed-account"]
    );
    let mut again = sessions.pending_invalidations();
    again.sort();
    assert_eq!(pending, again);
    sessions.acknowledge_invalidated(&pending[0].0, &pending[0].1);
    assert_eq!(sessions.pending_invalidations(), vec![pending[1].clone()]);
    sessions.acknowledge_invalidated(&pending[1].0, &pending[1].1);
    assert!(sessions.pending_invalidations().is_empty());
}

#[test]
fn an_old_ack_cannot_clear_a_new_close_or_allow_a_new_binding() {
    let sessions = PlatformSessions::default();
    let incarnation = sessions.created("account-a", "whatsapp");
    sessions.page("account-a", &incarnation, false);
    let original = sessions.binding("account-a", "whatsapp").unwrap();
    sessions.invalidate("account-a");
    let (_, old_token) = sessions.pending_invalidations().pop().unwrap();
    sessions.invalidate("account-a");
    let (_, new_token) = sessions.pending_invalidations().pop().unwrap();
    assert_ne!(old_token, new_token);
    sessions.page("account-a", &incarnation, false);
    sessions.acknowledge_invalidated("account-a", &old_token);
    assert_eq!(
        sessions.pending_invalidations(),
        vec![("account-a".into(), new_token.clone())]
    );
    assert_eq!(
        sessions.binding("account-a", "whatsapp"),
        Err(BroadcastIssue::AccountUnavailable)
    );
    assert!(!sessions.valid(&original));
    sessions.acknowledge_invalidated("account-a", &new_token);
    let replacement = sessions.binding("account-a", "whatsapp").unwrap();
    assert_ne!(original.generation, replacement.generation);
    assert!(sessions.valid(&replacement));
    assert!(sessions.pending_invalidations().is_empty());
}
