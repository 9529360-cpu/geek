use crate::domain::{
    account::{Account, Settings},
    platform::PlatformInfo,
};
use serde::Serialize;

/// Shell-facing DTO. No profile paths, native handles or authentication material.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub accounts: Vec<Account>,
    pub platforms: Vec<PlatformInfo>,
    pub active_id: Option<String>,
    pub opened_ids: Vec<String>,
    pub settings: Settings,
    pub tray_available: bool,
}
