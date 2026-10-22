use crate::domain::{
    error::{AppError, Result},
    presentation::WindowAction,
};
use tauri::{AppHandle, Manager};

pub fn apply(app: &AppHandle, action: WindowAction) -> Result<()> {
    let window = app.get_window("main").ok_or(AppError::WebviewFailed)?;
    let result = match action {
        WindowAction::Minimize => window.minimize(),
        WindowAction::ToggleMaximize => {
            if window.is_maximized().map_err(|_| AppError::WebviewFailed)? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        // close(), not exit(): preserve the user's persisted tray preference.
        WindowAction::Close => window.close(),
        WindowAction::Drag => window.start_dragging(),
    };
    result.map_err(|_| AppError::WebviewFailed)
}
