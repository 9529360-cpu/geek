use uuid::Uuid;
use crate::domain::{
    account::{self, Account, Settings},
    document::{Document, SCHEMA_VERSION},
    error::{AppError, Result},
    navigation::NavigationPolicy,
    platform::{self, Platform},
};
use super::ports::AccountRepository;

/// Sole authority for durable account state; callers receive read-only views.
pub struct Accounts<R: AccountRepository> {
    repository: R,
    document: Document,
    platforms: Vec<Platform>,
}

impl<R: AccountRepository> Accounts<R> {
    pub fn open(repository: R, platforms: Vec<Platform>) -> Result<Self> {
        let document = repository.load()?.unwrap_or_default();
        document.validate(&platforms)?;
        Ok(Self { repository, document, platforms })
    }

    pub fn accounts(&self) -> &[Account] {
        &self.document.accounts
    }

    pub fn settings(&self) -> &Settings {
        &self.document.settings
    }

    pub fn platforms(&self) -> &[Platform] {
        &self.platforms
    }

    fn commit(&mut self, mut next: Document) -> Result<()> {
        next.schema_version = SCHEMA_VERSION;
        next.validate(&self.platforms)?;
        self.repository.save(&next)?;
        // Never publish memory, UI or tray preferences before durable commit.
        self.document = next;
        Ok(())
    }

    pub fn create(&mut self, name: &str, platform_id: &str, website_url: Option<&str>) -> Result<()> {
        let name = name.trim();
        if !account::valid_name(name) {
            return Err(AppError::NameInvalid);
        }
        let platform = platform::platform(&self.platforms, platform_id)?;
        let navigation = NavigationPolicy::new(platform, website_url)?;
        let website_url = if platform_id == "website" {
            Some(navigation.start().to_string())
        } else {
            None
        };
        let mut next = self.document.clone();
        next.accounts.push(Account {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            platform_id: platform_id.into(),
            archived: false,
            website_url,
        });
        self.commit(next)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<()> {
        self.account(id)?;
        let name = name.trim();
        if !account::valid_name(name) {
            return Err(AppError::NameInvalid);
        }
        let mut next = self.document.clone();
        next.accounts.iter_mut().find(|a| a.id == id).ok_or(AppError::AccountUnknown)?.name = name.into();
        self.commit(next)
    }

    /// Desktop is responsible for closing this account before committing archive.
    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<()> {
        self.account(id)?;
        let mut next = self.document.clone();
        next.accounts.iter_mut().find(|a| a.id == id).ok_or(AppError::AccountUnknown)?.archived = archived;
        self.commit(next)
    }

    pub fn set_settings(&mut self, settings: Settings) -> Result<()> {
        let mut next = self.document.clone();
        next.settings = settings;
        self.commit(next)
    }

    pub fn account(&self, id: &str) -> Result<Account> {
        if !account::valid_id(id) {
            return Err(AppError::AccountUnknown);
        }
        self.document.accounts.iter().find(|a| a.id == id).cloned().ok_or(AppError::AccountUnknown)
    }

    pub fn openable_account(&self, id: &str) -> Result<Account> {
        let account = self.account(id)?;
        if account.archived {
            return Err(AppError::AccountArchived);
        }
        Ok(account)
    }

    pub fn navigation(&self, account: &Account) -> Result<NavigationPolicy> {
        let platform = platform::platform(&self.platforms, &account.platform_id)?;
        NavigationPolicy::new(platform, account.website_url.as_deref())
    }
}
