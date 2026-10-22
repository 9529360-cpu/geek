use crate::domain::{
    error::{AppError, Result},
    url_policy::safe_https,
};
use tauri::Webview;
use url::Url;

pub fn shell_url(url: &Url) -> bool {
    safe_https(url)
        && url.host_str() == Some("tauri.localhost")
        && matches!(url.path(), "/" | "/index.html")
        && url.query().is_none()
        && url.fragment().is_none()
}

pub fn authorize(webview: &Webview) -> Result<()> {
    if webview.label() != "shell"
        || webview.window().label() != "main"
        || !shell_url(&webview.url().map_err(|_| AppError::Forbidden)?)
    {
        return Err(AppError::Forbidden);
    }
    Ok(())
}
