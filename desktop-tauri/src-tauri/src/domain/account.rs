use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_ACCOUNTS: usize = 20;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub platform_id: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website_url: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    // Opt-in: adding a tray must not silently change the existing close behavior.
    #[serde(default)]
    pub close_to_tray: bool,
}

pub fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|uuid| uuid.get_version_num() == 4 && uuid.to_string() == id)
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name == name.trim() && name.chars().count() <= 64
        && !name.chars().any(char::is_control)
}
