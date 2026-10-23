use super::{
    accounts::Accounts,
    ports::{AccountRepository, DesktopHost},
    snapshot::{CreatedAccounts, Snapshot},
};
use crate::domain::{
    account::Settings,
    error::{AppError, Result},
    presentation::Viewport,
    proxy::ProxyConfig,
    translation::TranslationPolicy,
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
            active_id: self.active_id.clone().filter(|id| self.host.is_open(id)),
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

    /// Read-only admission; no network or native callback runs under this lock.
    pub fn visible_account(&self) -> Option<crate::domain::account::Account> {
        if !self.content_visible {
            return None;
        }
        self.active_id
            .as_deref()
            .filter(|id| self.host.is_open(id))
            .and_then(|id| self.accounts.openable_account(id).ok())
    }

    pub fn update_translation(
        &mut self,
        id: &str,
        chat_id: Option<&str>,
        policy: Option<TranslationPolicy>,
        expected_revision: u64,
    ) -> Result<Snapshot> {
        self.accounts
            .update_translation(id, chat_id, policy, expected_revision)?;
        Ok(self.snapshot())
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

    pub fn update_display(
        &mut self,
        id: &str,
        name: &str,
        font_size: u8,
        font_color: &str,
    ) -> Result<Snapshot> {
        self.accounts
            .update_display(id, name, font_size, font_color)?;
        Ok(self.snapshot())
    }

    pub fn move_account(&mut self, id: &str, target_id: &str) -> Result<Snapshot> {
        self.accounts.move_account(id, target_id)?;
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
            self.rollback_activation(id, previous);
            return Err(AppError::WebviewFailed);
        }
        self.active_id = Some(id.to_owned());
        Ok(self.snapshot())
    }

    /// A queued close is not proof that a failed-to-hide guest is gone.
    fn hide_or_close(&mut self, id: &str) -> bool {
        if !self.host.is_open(id) || self.host.hide(id).is_ok() {
            return true;
        }
        self.host.close(id).is_ok() && !self.host.is_open(id)
    }

    fn rollback_activation(&mut self, id: &str, previous: Option<String>) {
        let hidden = self.hide_or_close(id);
        self.active_id = None;
        if !hidden {
            // Do not reveal a neighbor while the failed target may still be visible.
            self.content_visible = false;
            return;
        }
        let Some(previous) = previous.filter(|old| self.host.is_open(old)) else {
            return;
        };
        if self.content_visible
            && self
                .host
                .show(&previous)
                .and_then(|_| self.host.focus(&previous))
                .is_err()
        {
            self.hide_or_close(&previous);
            self.content_visible = false;
            return;
        }
        // Suspended content retains selection without showing/focusing any guest.
        self.active_id = Some(previous);
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
        let active = self.active_id.clone().filter(|id| self.host.is_open(id));
        match (viewport.visible, active.as_deref()) {
            (true, Some(id)) => {
                if self
                    .host
                    .show(id)
                    .and_then(|_| self.host.focus(id))
                    .is_err()
                {
                    if !self.hide_or_close(id) || !self.host.is_open(id) {
                        self.active_id = None;
                    }
                    return Err(AppError::WebviewFailed);
                }
            }
            _ => self.host.focus_shell()?,
        }
        self.content_visible = viewport.visible;
        Ok(())
    }
}
