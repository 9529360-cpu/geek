use super::{layout, platform_sessions::PlatformSessions, tray::TrayState};
use crate::{
    application::ports::DesktopHost,
    domain::{
        account::Account,
        error::{AppError, Result},
        navigation::NavigationPolicy,
        presentation::Viewport,
    },
    infrastructure::profiles::account_profile,
};
use std::{path::PathBuf, sync::Arc};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder},
    AppHandle, LogicalPosition, Manager, Webview, WebviewUrl,
};

pub struct TauriHost {
    app: AppHandle,
    root: PathBuf,
    viewport: Viewport,
    sessions: Arc<PlatformSessions>,
}

fn label(id: &str) -> String {
    format!("account-{id}")
}

fn revoke_document(guest: &Webview, generation: &str) {
    if let Ok(value) = serde_json::to_string(generation) {
        let _ = guest.eval(format!(
            "window.__geekTauriSend?.revoke({value}); window.__geekTauriTranslation?.revoke({value}); window.__geekTauriPlatform?.revoke({value})"
        ));
    }
}

impl TauriHost {
    pub fn new(app: AppHandle, root: PathBuf, sessions: Arc<PlatformSessions>) -> Self {
        Self {
            app,
            root,
            viewport: Viewport::default(),
            sessions,
        }
    }

    fn guest(&self, id: &str) -> Result<Webview> {
        self.app
            .get_webview(&label(id))
            .ok_or(AppError::AccountNotOpen)
    }

    fn revoke(&self, id: &str, guest: &Webview) {
        if let Some(binding) = self.sessions.current(id) {
            revoke_document(guest, &binding.generation);
        }
        self.sessions.invalidate(id);
    }
}

impl DesktopHost for TauriHost {
    fn set_viewport(&mut self, viewport: Viewport) {
        self.viewport = viewport;
    }

    fn is_open(&self, id: &str) -> bool {
        self.app.get_webview(&label(id)).is_some()
    }

    fn open(&mut self, account: &Account, navigation: NavigationPolicy) -> Result<()> {
        // Existing guest ownership is immutable; never retarget its profile.
        if self.is_open(&account.id) {
            return Ok(());
        }
        let proxy = account.proxy.endpoint()?;
        let window = self.app.get_window("main").ok_or(AppError::WebviewFailed)?;
        let profile = account_profile(&self.root, &account.id)?;
        std::fs::create_dir_all(&profile).map_err(|_| AppError::StoreIo)?;
        let incarnation = self.sessions.created(&account.id, &account.platform_id);
        let sessions = Arc::clone(&self.sessions);
        let account_id = account.id.clone();
        let builder = WebviewBuilder::new(
            label(&account.id),
            WebviewUrl::External(navigation.start().clone()),
        )
        .data_directory(profile)
        .browser_extensions_enabled(false)
        .devtools(false)
        .focused(false)
        .on_navigation(move |url| navigation.allows(url))
        .on_page_load(move |guest, payload| {
            if payload.event() == PageLoadEvent::Started {
                if let Some(binding) = sessions.current_for_incarnation(&account_id, &incarnation) {
                    revoke_document(&guest, &binding.generation);
                }
            }
            sessions.page(
                &account_id,
                &incarnation,
                payload.event() == PageLoadEvent::Started,
            );
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_download(|_, _| false);
        // Apply only to this owner-bound profile, before its first navigation.
        // Creation errors propagate; never retry with the proxy removed.
        let builder = match proxy {
            Some(endpoint) => builder.proxy_url(endpoint),
            None => builder,
        };
        let (_, size) = layout::bounds(&window, self.viewport)?;
        let guest = match window.add_child(builder, LogicalPosition::new(100_000.0, 0.0), size) {
            Ok(guest) => guest,
            Err(_) => {
                self.sessions.removed(&account.id);
                return Err(AppError::WebviewFailed);
            }
        };
        if guest.hide().is_err() {
            let _ = guest.close();
            self.sessions.removed(&account.id);
            return Err(AppError::WebviewFailed);
        }
        Ok(())
    }

    fn fit(&mut self, id: &str) -> Result<()> {
        let window = self.app.get_window("main").ok_or(AppError::WebviewFailed)?;
        layout::fit(&self.guest(id)?, &window, self.viewport)
    }

    fn show(&mut self, id: &str) -> Result<()> {
        self.guest(id)?
            .show()
            .map_err(|_| AppError::WebviewFailed)?;
        self.sessions.set_visible(id, true);
        Ok(())
    }

    fn hide(&mut self, id: &str) -> Result<()> {
        let guest = self.guest(id)?;
        // Order revocation and script enqueue against commit, without awaiting a callback.
        self.sessions.hide_and_enqueue(id, |binding| {
            let generation =
                serde_json::to_string(&binding.generation).map_err(|_| AppError::WebviewFailed)?;
            guest
                .eval(format!("window.__geekTauriSend?.deactivate({generation})"))
                .map_err(|_| AppError::WebviewFailed)
        })?;
        guest.hide().map_err(|_| AppError::WebviewFailed)
    }

    fn focus(&mut self, id: &str) -> Result<()> {
        self.guest(id)?
            .set_focus()
            .map_err(|_| AppError::WebviewFailed)
    }

    fn focus_shell(&mut self) -> Result<()> {
        self.app
            .get_webview("shell")
            .ok_or(AppError::WebviewFailed)?
            .set_focus()
            .map_err(|_| AppError::WebviewFailed)
    }

    fn close(&mut self, id: &str) -> Result<()> {
        let guest = self.guest(id)?;
        self.revoke(id, &guest);
        guest.close().map_err(|_| AppError::WebviewFailed)?;
        self.sessions.removed(id);
        Ok(())
    }

    fn reload(&mut self, id: &str) -> Result<()> {
        let guest = self.guest(id)?;
        self.revoke(id, &guest);
        guest.reload().map_err(|_| AppError::WebviewFailed)
    }

    fn tray_available(&self) -> bool {
        self.app.state::<TrayState>().available()
    }

    fn publish_close_to_tray(&self, enabled: bool) {
        self.app.state::<TrayState>().set_close_to_tray(enabled);
    }
}
