use super::proxy::ProxyConfig;
use super::translation::TranslationSettings;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_ACCOUNTS: usize = 20;
pub const DEFAULT_FONT_SIZE: u8 = 16;
pub const DEFAULT_FONT_COLOR: &str = "#18A058";

fn default_font_size() -> u8 {
    DEFAULT_FONT_SIZE
}

fn default_font_color() -> String {
    DEFAULT_FONT_COLOR.into()
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub name: String,
    #[serde(default = "default_font_size")]
    pub font_size: u8,
    #[serde(default = "default_font_color")]
    pub font_color: String,
    pub platform_id: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website_url: Option<String>,
    #[serde(default)]
    pub proxy: ProxyConfig,
    #[serde(default)]
    pub translation: TranslationSettings,
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
    !name.is_empty()
        && name == name.trim()
        && name.chars().count() <= 64
        && !name.chars().any(char::is_control)
}

pub fn valid_appearance(font_size: u8, font_color: &str) -> bool {
    (10..=28).contains(&font_size)
        && font_color.len() == 7
        && font_color.starts_with('#')
        && font_color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}
