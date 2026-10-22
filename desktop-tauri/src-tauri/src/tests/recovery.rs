use super::doubles::fixture;
use crate::domain::{error::AppError, presentation::Viewport};

fn viewport(visible: bool) -> Viewport {
    Viewport {
        visible,
        ..Viewport::default()
    }
}

#[test]
fn failed_suspended_activation_preserves_selection_without_revealing_a_guest() {
    let (mut workspace, disk, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    workspace.layout(viewport(false)).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    let before = host.0.lock().unwrap().calls.len();
    host.fail("fit", &b);
    assert!(matches!(
        workspace.activate(&b),
        Err(AppError::WebviewFailed)
    ));
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    {
        let state = host.0.lock().unwrap();
        assert!(state.visible.is_empty());
        assert!(state.calls[before..]
            .iter()
            .all(|(op, _)| op != "show" && op != "focus"));
    }
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    host.recover();
    workspace.layout(viewport(true)).unwrap();
    assert!(host.0.lock().unwrap().visible.contains(&a));
}

#[test]
fn activation_rollback_restores_focus_to_the_previous_owner() {
    let (mut workspace, _, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    host.fail("focus", &b);
    assert!(workspace.activate(&b).is_err());
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    let state = host.0.lock().unwrap();
    assert_eq!(state.calls.last(), Some(&("focus".into(), a.clone())));
    assert_eq!(state.visible.len(), 1);
    assert!(state.visible.contains(&a));
}

#[test]
fn pending_or_failed_cleanup_never_reveals_the_previous_owner() {
    for pending in [false, true] {
        let (mut workspace, disk, host, a, b) = fixture();
        workspace.activate(&a).unwrap();
        let before = host.0.lock().unwrap().calls.len();
        let writes = disk.0.lock().unwrap().saves;
        host.fail("focus", &b);
        host.fail("hide", &b);
        if pending {
            host.0.lock().unwrap().close_pending = true;
        } else {
            host.fail("close", &b);
        }
        assert!(workspace.activate(&b).is_err());
        assert!(workspace.snapshot().active_id.is_none());
        assert_eq!(disk.0.lock().unwrap().saves, writes);
        {
            let state = host.0.lock().unwrap();
            assert!(state.opened.contains(&b));
            assert!(!state.visible.contains(&a));
            assert!(state.calls[before..]
                .iter()
                .all(|(op, id)| op != "show" || id != &a));
        }
        host.recover();
        host.0.lock().unwrap().close_pending = false;
        workspace.layout(viewport(true)).unwrap();
        workspace.activate(&a).unwrap();
        let snapshot = workspace.snapshot();
        assert_eq!(snapshot.active_id.as_deref(), Some(a.as_str()));
        assert_eq!(snapshot.accounts.len(), 2);
        assert_eq!(host.0.lock().unwrap().visible.len(), 1);
    }
}

#[test]
fn confirmed_fallback_close_allows_the_previous_owner_to_resume() {
    let (mut workspace, _, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    host.fail("focus", &b);
    host.fail("hide", &b);
    assert!(workspace.activate(&b).is_err());
    let snapshot = workspace.snapshot();
    assert_eq!(snapshot.active_id.as_deref(), Some(a.as_str()));
    assert!(!snapshot.opened_ids.contains(&b));
    assert!(snapshot.accounts.iter().any(|account| account.id == b));
    assert!(host.0.lock().unwrap().visible.contains(&a));
}

#[test]
fn failed_restore_focus_hides_the_previous_owner_instead_of_claiming_success() {
    let (mut workspace, _, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    host.fail("focus", &b);
    host.fail("focus", &a);
    assert!(workspace.activate(&b).is_err());
    assert!(workspace.snapshot().active_id.is_none());
    assert!(host.0.lock().unwrap().visible.is_empty());
    assert_eq!(workspace.snapshot().opened_ids.len(), 2);
}

#[test]
fn missing_native_guest_is_not_reported_as_active_and_reopens_with_the_same_id() {
    let (mut workspace, disk, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    {
        let mut state = host.0.lock().unwrap();
        state.opened.remove(&a);
        state.visible.remove(&a);
    }
    assert!(workspace.snapshot().active_id.is_none());
    assert!(workspace.snapshot().opened_ids.is_empty());
    let snapshot = workspace.activate(&a).unwrap();
    assert_eq!(snapshot.active_id.as_deref(), Some(a.as_str()));
    assert_eq!(snapshot.accounts[0].id, a);
    assert_eq!(disk.0.lock().unwrap().saves, writes);
}

#[test]
fn failed_layout_resume_uses_confirmed_cleanup_and_retains_recoverable_metadata() {
    let (mut workspace, disk, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    workspace.layout(viewport(false)).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    host.fail("focus", &a);
    // The initial hide succeeds; focus failure leaves the guest shown until cleanup.
    assert!(workspace.layout(viewport(true)).is_err());
    assert!(host.0.lock().unwrap().visible.is_empty());
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    host.recover();
    workspace.layout(viewport(true)).unwrap();
    assert!(host.0.lock().unwrap().visible.contains(&a));
}
