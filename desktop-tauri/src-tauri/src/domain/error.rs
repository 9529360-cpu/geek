use serde::Serialize;
use std::fmt;

pub type Result<T> = std::result::Result<T, AppError>;

/// Stable IPC codes only: never serialize native errors, URLs or user data.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppError {
    AccountLimit,
    AccountUnknown,
    AccountArchived,
    AccountNotOpen,
    CatalogInvalid,
    DpapiFailed,
    Forbidden,
    NameInvalid,
    PlatformUnavailable,
    ProfileInUse,
    StateUnavailable,
    StoreIo,
    StoreInvalid,
    StoreVersion,
    TrayUnavailable,
    WebviewFailed,
    WebsiteUrlInvalid,
    WebsiteUrlUnexpected,
}

impl AppError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::AccountLimit => "ACCOUNT_LIMIT",
            Self::AccountUnknown => "ACCOUNT_UNKNOWN",
            Self::AccountArchived => "ACCOUNT_ARCHIVED",
            Self::AccountNotOpen => "ACCOUNT_NOT_OPEN",
            Self::CatalogInvalid => "CATALOG_INVALID",
            Self::DpapiFailed => "DPAPI_FAILED",
            Self::Forbidden => "FORBIDDEN",
            Self::NameInvalid => "NAME_INVALID",
            Self::PlatformUnavailable => "PLATFORM_UNAVAILABLE",
            Self::ProfileInUse => "PROFILE_IN_USE",
            Self::StateUnavailable => "STATE_UNAVAILABLE",
            Self::StoreIo => "STORE_IO",
            Self::StoreInvalid => "STORE_INVALID",
            Self::StoreVersion => "STORE_VERSION",
            Self::TrayUnavailable => "TRAY_UNAVAILABLE",
            Self::WebviewFailed => "WEBVIEW_FAILED",
            Self::WebsiteUrlInvalid => "WEBSITE_URL_INVALID",
            Self::WebsiteUrlUnexpected => "WEBSITE_URL_UNEXPECTED",
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for AppError {}
