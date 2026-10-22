use crate::domain::error::{AppError, Result};
use tauri::{LogicalPosition, LogicalSize, Webview, Window};

pub const SIDEBAR: f64 = 280.0;
pub const HEADER: f64 = 88.0;
pub const FOOTER: f64 = 28.0;

pub fn bounds(window: &Window) -> Result<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let scale = window.scale_factor().map_err(|_| AppError::WebviewFailed)?;
    let size = window
        .inner_size()
        .map_err(|_| AppError::WebviewFailed)?
        .to_logical::<f64>(scale);
    Ok((
        LogicalPosition::new(SIDEBAR, HEADER),
        LogicalSize::new(
            (size.width - SIDEBAR).max(1.0),
            (size.height - HEADER - FOOTER).max(1.0),
        ),
    ))
}

pub fn fit(webview: &Webview, window: &Window) -> Result<()> {
    let (position, size) = bounds(window)?;
    webview
        .set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|_| AppError::WebviewFailed)
}
