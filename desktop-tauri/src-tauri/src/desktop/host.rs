use std::path::PathBuf;
use tauri::{AppHandle, LogicalPosition, Manager, Webview, WebviewUrl,
    webview::{NewWindowResponse, PermissionResponse, WebviewBuilder}};
use crate::{
    application::ports::DesktopHost,
    domain::{account::Account, error::{AppError, Result}, navigation::NavigationPolicy},
    infrastructure::profiles::account_profile,
};
use super::{layout, tray::TrayState};

pub struct TauriHost {
    app: AppHandle,
    root: PathBuf,
}

fn label(id: &str) -> String {
    format!("account-{id}")
}

impl TauriHost {
    pub fn new(app: AppHandle, root: PathBuf) -> Self {
        Self { app, root }
    }

    fn guest(&self, id: &str) -> Result<Webview> {
        self.app.get_webview(&label(id)).ok_or(AppError::AccountNotOpen)
    }
}

impl DesktopHost for TauriHost {
    fn is_open(&self, id: &str) -> bool {
        self.app.get_webview(&label(id)).is_some()
    }

    fn open(&mut self, account: &Account, navigation: NavigationPolicy) -> Result<()> {
        // Existing guest ownership is immutable; never retarget its profile.
        if self.is_open(&account.id) {
            return Ok(());
        }
        let window = self.app.get_window("main").ok_or(AppError::WebviewFailed)?;
        let profile = account_profile(&self.root, &account.id)?;
        std::fs::create_dir_all(&profile).map_err(|_| AppError::StoreIo)?;
        let builder = WebviewBuilder::new(label(&account.id), WebviewUrl::External(navigation.start().clone()))
            .data_directory(profile)
            .browser_extensions_enabled(false)
            .devtools(false)
            .focused(false)
            .on_navigation(move |url| navigation.allows(url))
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_permission_request(|_, _| PermissionResponse::Deny)
            .on_download(|_, _| false);
        let (_, size) = layout::bounds(&window)?;
        let guest = window.add_child(builder, LogicalPosition::new(100_000.0, 0.0), size)
            .map_err(|_| AppError::WebviewFailed)?;
        if guest.hide().is_err() {
            let _ = guest.close();
            return Err(AppError::WebviewFailed);
        }
        Ok(())
    }

    fn fit(&mut self, id: &str) -> Result<()> {
        let window = self.app.get_window("main").ok_or(AppError::WebviewFailed)?;
        layout::fit(&self.guest(id)?, &window)
    }

    fn show(&mut self, id: &str) -> Result<()> {
        self.guest(id)?.show().map_err(|_| AppError::WebviewFailed)
    }

    fn hide(&mut self, id: &str) -> Result<()> {
        self.guest(id)?.hide().map_err(|_| AppError::WebviewFailed)
    }

    fn focus(&mut self, id: &str) -> Result<()> {
        self.guest(id)?.set_focus().map_err(|_| AppError::WebviewFailed)
    }

    fn close(&mut self, id: &str) -> Result<()> {
        self.guest(id)?.close().map_err(|_| AppError::WebviewFailed)
    }

    fn reload(&mut self, id: &str) -> Result<()> {
        self.guest(id)?.reload().map_err(|_| AppError::WebviewFailed)
    }

    fn tray_available(&self) -> bool {
        self.app.state::<TrayState>().available()
    }

    fn publish_close_to_tray(&self, enabled: bool) {
        self.app.state::<TrayState>().set_close_to_tray(enabled);
    }
}
