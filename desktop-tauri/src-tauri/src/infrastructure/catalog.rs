use crate::domain::{
    error::{AppError, Result},
    platform::Platform,
};

/// The sole build-time adapter to the repository's canonical platform catalog.
pub fn load() -> Result<Vec<Platform>> {
    serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/platforms.json")))
        .map_err(|_| AppError::CatalogInvalid)
}
