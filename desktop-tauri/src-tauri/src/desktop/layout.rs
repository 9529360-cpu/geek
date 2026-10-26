use crate::domain::{
    error::{AppError, Result},
    presentation::Viewport,
};
use tauri::{LogicalPosition, LogicalSize, Webview, Window};

pub fn bounds(
    window: &Window,
    viewport: Viewport,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let scale = window.scale_factor().map_err(|_| AppError::WebviewFailed)?;
    let size = window
        .inner_size()
        .map_err(|_| AppError::WebviewFailed)?
        .to_logical::<f64>(scale);
    let rect = viewport.clipped(size.width, size.height)?;
    Ok((
        LogicalPosition::new(rect.x, rect.y),
        LogicalSize::new(rect.width, rect.height),
    ))
}

pub fn fit(webview: &Webview, window: &Window, viewport: Viewport) -> Result<()> {
    let (position, size) = bounds(window, viewport)?;
    webview
        .set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|_| AppError::WebviewFailed)
}
