use super::doubles::fixture;
use crate::domain::{
    error::AppError,
    presentation::{Viewport, WindowAction},
};

fn viewport(visible: bool) -> Viewport {
    Viewport {
        x: 176.0,
        y: 35.0,
        width: 784.0,
        height: 605.0,
        visible,
    }
}

#[test]
fn modal_suspension_keeps_identity_and_never_reveals_newly_selected_guests() {
    let (mut workspace, _, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    workspace.layout(viewport(false)).unwrap();
    assert!(host.0.lock().unwrap().visible.is_empty());
    assert_eq!(
        host.0.lock().unwrap().calls.last(),
        Some(&("focus_shell".into(), "shell".into()))
    );
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    workspace.activate(&b).unwrap();
    assert!(host.0.lock().unwrap().visible.is_empty());
    assert_eq!(workspace.snapshot().opened_ids.len(), 2);
    workspace.layout(viewport(true)).unwrap();
    let state = host.0.lock().unwrap();
    assert_eq!(state.visible.len(), 1);
    assert!(state.visible.contains(&b));
    assert_eq!(state.viewport.width, 784.0);
}

#[test]
fn failed_hide_blocks_overlay_acknowledgement_without_closing_other_accounts() {
    let (mut workspace, _, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    host.fail("hide", &a);
    assert!(matches!(
        workspace.layout(viewport(false)),
        Err(AppError::WebviewFailed)
    ));
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    assert!(host.0.lock().unwrap().opened.contains(&a));
}

#[test]
fn layout_validation_precedes_all_native_effects_and_clips_to_current_window() {
    let (mut workspace, _, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    let before = host.0.lock().unwrap().calls.len();
    for number in [f64::NAN, f64::INFINITY, -1.0, 40000.0] {
        assert!(workspace
            .layout(Viewport {
                x: number,
                ..viewport(true)
            })
            .is_err());
    }
    assert_eq!(host.0.lock().unwrap().calls.len(), before);
    let rect = viewport(true).clipped(800.0, 500.0).unwrap();
    assert_eq!(rect.width, 624.0);
    assert_eq!(rect.height, 465.0);
    assert!(viewport(true).clipped(f64::NAN, 500.0).is_err());
}

#[test]
fn window_controls_keep_a_closed_typed_allowlist_without_account_arguments() {
    for (wire, expected) in [
        ("minimize", WindowAction::Minimize),
        ("toggleMaximize", WindowAction::ToggleMaximize),
        ("close", WindowAction::Close),
        ("drag", WindowAction::Drag),
    ] {
        let json = serde_json::to_string(wire).unwrap();
        assert_eq!(serde_json::from_str::<WindowAction>(&json).unwrap(), expected);
    }
    for wire in [
        r#""execute""#,
        r#""destroy""#,
        r#"{"action":"close","id":"neighbor"}"#,
    ] {
        assert!(serde_json::from_str::<WindowAction>(wire).is_err());
    }
    assert!(serde_json::from_str::<Viewport>(
        r#"{"x":0,"y":0,"width":1,"height":1,"visible":true,"script":"bad"}"#
    )
    .is_err());
}

#[test]
fn failed_shell_focus_keeps_guests_hidden_and_does_not_acknowledge_a_modal() {
    let (mut workspace, _, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    host.fail("focus_shell", "shell");
    assert!(workspace.layout(viewport(false)).is_err());
    assert!(host.0.lock().unwrap().visible.is_empty());
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    host.recover();
    workspace.layout(viewport(true)).unwrap();
    assert!(host.0.lock().unwrap().visible.contains(&a));
}
