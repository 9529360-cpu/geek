use super::{
    account::{self, Account, Settings, MAX_ACCOUNTS},
    error::{AppError, Result},
    navigation::NavigationPolicy,
    platform::{self, Platform},
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const SCHEMA_VERSION: u32 = 4;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub schema_version: u32,
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub settings: Settings,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            accounts: Vec::new(),
            settings: Settings::default(),
        }
    }
}

impl Document {
    pub fn validate(&self, platforms: &[Platform]) -> Result<()> {
        if !matches!(self.schema_version, 1 | 2 | 3 | SCHEMA_VERSION) {
            return Err(AppError::StoreVersion);
        }
        validate_accounts(&self.accounts, platforms)
    }
}

pub fn validate_accounts(accounts: &[Account], platforms: &[Platform]) -> Result<()> {
    // Archived accounts still own profiles and count toward the storage limit.
    if accounts.len() > MAX_ACCOUNTS {
        return Err(AppError::AccountLimit);
    }
    let mut ids = HashSet::new();
    for a in accounts {
        if !account::valid_id(&a.id) || !account::valid_name(&a.name) || !ids.insert(&a.id) {
            return Err(AppError::StoreInvalid);
        }
        if !account::valid_appearance(a.font_size, &a.font_color) {
            return Err(AppError::AppearanceInvalid);
        }
        a.proxy.validate()?;
        let platform = platform::platform(platforms, &a.platform_id)?;
        NavigationPolicy::new(platform, a.website_url.as_deref())?;
    }
    Ok(())
}
