use super::{
    accounts::Accounts,
    ports::{AccountRepository, DesktopHost},
    snapshot::{CreatedAccounts, Snapshot},
};
use crate::domain::{
    account::Settings,
    error::{AppError, Result},
    presentation::{Viewport, WindowAction},
    proxy::ProxyConfig,
};

/// Serial use-case owner. Native callbacks must never lock this coordinator.
/// Network/translation/broadcast work must not be added under this desktop lock.
pub struct Workspace<R: AccountRepository, H: DesktopHost> {
    accounts: Accounts<R>,
    host: H,
    active_id: Option<String>,
    content_visible: bool,
}

impl<R: AccountRepository, H: DesktopHost> Workspace<R, H> {
    pub fn new(accounts: Accounts<R>, host: H) -> Self {
        Self {
            accounts,
            host,
            active_id: None,
            content_visible: false,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            accounts: self.accounts.accounts().to_vec(),
            platforms: self.accounts.platforms().iter().map(|p| p.info()).collect(),
            active_id: self.active_id.clone(),
            opened_ids: self
                .accounts
                .accounts()
                .iter()
                .filter(|a| self.host.is_open(&a.id))
                .map(|a| a.id.clone())
                .collect(),
            settings: self.accounts.settings().clone(),
            tray_available: self.host.tray_available(),
        }
    }

    pub fn create(
        &mut self,
        name: &str,
        platform_id: &str,
        website_url: Option<&str>,
        proxy: ProxyConfig,
    ) -> Result<Snapshot> {
        self.accounts
            .create(name, platform_id, website_url, proxy)?;
        Ok(self.snapshot())
    }

    pub fn create_batch(
        &mut self,
        name: &str,
        platform_id: &str,
        website_url: Option<&str>,
        proxy: ProxyConfig,
        count: u8,
    ) -> Result<CreatedAccounts> {
        let created_ids =
            self.accounts
                .create_batch(name, platform_id, website_url, proxy, count)?;
        Ok(CreatedAccounts {
            snapshot: self.snapshot(),
            created_ids,
        })
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<Snapshot> {
        self.accounts.rename(id, name)?;
        Ok(self.snapshot())
    }

    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<Snapshot> {
        self.accounts.account(id)?;
        // One Rust-owned operation, not a frontend close-then-archive transaction.
        // Failure to close prevents persistence. Failure to persist leaves a closed,
        // non-archived account that can be reopened without losing its identity.
        if archived {
            self.close(id)?;
        }
        self.accounts.set_archived(id, archived)?;
        Ok(self.snapshot())
    }

    /// Validate before closing. Never silently reconnect after a routing change.
    pub fn set_proxy(&mut self, id: &str, proxy: ProxyConfig) -> Result<Snapshot> {
        let account = self.accounts.account(id)?;
        proxy.validate()?;
        if account.proxy == proxy {
            return Ok(self.snapshot());
        }
        self.close(id)?;
        self.accounts.set_proxy(id, proxy)?;
        Ok(self.snapshot())
    }

    pub fn set_settings(&mut self, settings: Settings) -> Result<Snapshot> {
        if settings.close_to_tray && !self.host.tray_available() {
            return Err(AppError::TrayUnavailable);
        }
        self.accounts.set_settings(settings)?;
        self.host
            .publish_close_to_tray(self.accounts.settings().close_to_tray);
        Ok(self.snapshot())
    }

    pub fn activate(&mut self, id: &str) -> Result<Snapshot> {
        let account = self.accounts.openable_account(id)?;
        if !self.host.is_open(id) {
            self.host
                .open(&account, self.accounts.navigation(&account)?)?;
        }
        let previous = self.active_id.clone();
        let transition = (|| -> Result<()> {
            self.host.fit(id)?;
            for other in self.accounts.accounts() {
                if other.id != id && self.host.is_open(&other.id) {
                    self.host.hide(&other.id)?;
                }
            }
            if self.content_visible {
                self.host.show(id)?;
                self.host.focus(id)?;
            } else {
                self.host.hide(id)?;
            }
            Ok(())
        })();
        if transition.is_err() {
            // A failed hide must not silently retain a view under the wrong title.
            let hidden = self.host.hide(id).is_ok() || self.host.close(id).is_ok();
            let restored = hidden
                && self.content_visible
                && previous
                    .as_ref()
                    .is_some_and(|old| self.host.is_open(old) && self.host.show(old).is_ok());
            self.active_id = if restored { previous } else { None };
            return Err(AppError::WebviewFailed);
        }
        self.active_id = Some(id.to_owned());
        Ok(self.snapshot())
    }

    pub fn close(&mut self, id: &str) -> Result<Snapshot> {
        self.accounts.account(id)?;
        if self.host.is_open(id) {
            self.host.close(id)?;
            if self.host.is_open(id) {
                return Err(AppError::AccountStillOpen);
            }
        }
        if self.active_id.as_deref() == Some(id) {
            self.active_id = None;
        }
        Ok(self.snapshot())
    }

    pub fn reload(&mut self, id: &str) -> Result<Snapshot> {
        self.accounts.openable_account(id)?;
        if !self.host.is_open(id) {
            return Err(AppError::AccountNotOpen);
        }
        self.host.reload(id)?;
        Ok(self.snapshot())
    }

    pub fn window_action(&mut self, action: WindowAction) -> Result<()> {
        self.host.window_action(action)
    }

    /// Suspend before changing geometry. A failed modal hide never reports success.
    /// Selection/profile ownership is independent from whether a guest is visible.
    pub fn layout(&mut self, viewport: Viewport) -> Result<()> {
        viewport.validate()?;
        self.content_visible = false;
        for account in self.accounts.accounts() {
            if self.host.is_open(&account.id) {
                self.host.hide(&account.id)?;
            }
        }
        self.host.set_viewport(viewport);
        for account in self.accounts.accounts() {
            if self.host.is_open(&account.id) {
                self.host.fit(&account.id)?;
            }
        }
        let active = self.active_id.as_deref().filter(|id| self.host.is_open(id));
        match (viewport.visible, active) {
            (true, Some(id)) => {
                if self
                    .host
                    .show(id)
                    .and_then(|_| self.host.focus(id))
                    .is_err()
                {
                    let _ = self.host.hide(id);
                    return Err(AppError::WebviewFailed);
                }
            }
            _ => self.host.focus_shell()?,
        }
        self.content_visible = viewport.visible;
        Ok(())
    }
}
