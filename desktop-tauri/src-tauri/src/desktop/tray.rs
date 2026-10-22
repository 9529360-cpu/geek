use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Window, WindowEvent,
};

pub struct TrayState {
    available: AtomicBool,
    close_to_tray: AtomicBool,
}

impl TrayState {
    pub fn new(close_to_tray: bool) -> Self {
        Self {
            available: AtomicBool::new(false),
            close_to_tray: AtomicBool::new(close_to_tray),
        }
    }
    pub fn available(&self) -> bool {
        self.available.load(Ordering::Acquire)
    }
    pub fn set_available(&self, value: bool) {
        self.available.store(value, Ordering::Release);
    }
    pub fn set_close_to_tray(&self, value: bool) {
        self.close_to_tray.store(value, Ordering::Release);
    }
    fn should_hide(&self) -> bool {
        self.available() && self.close_to_tray.load(Ordering::Acquire)
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn install(app: &App) -> tauri::Result<bool> {
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(false);
    };
    let show = MenuItem::with_id(app, "geek-show", "打开极客", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "geek-quit",
        "退出极客（关闭全部账号）",
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::with_id("geek-desktop")
        .icon(icon)
        .tooltip("极客 · Tauri Windows 开发版")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "geek-show" => show_main(app),
            "geek-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(true)
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        let Some(state) = window.app_handle().try_state::<TrayState>() else {
            return;
        };
        // No Desktop mutex here: never block the UI thread behind WebView creation.
        // If the tray or hide operation fails, let the window close normally.
        if state.should_hide() && window.hide().is_ok() {
            api.prevent_close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_to_tray_requires_both_consent_and_a_working_tray() {
        let state = TrayState::new(false);
        assert!(!state.should_hide());
        state.set_available(true);
        assert!(!state.should_hide());
        state.set_close_to_tray(true);
        assert!(state.should_hide());
        state.set_available(false);
        assert!(!state.should_hide());
        state.set_close_to_tray(false);
        state.set_available(true);
        assert!(!state.should_hide());
    }
}
