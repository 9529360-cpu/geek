use super::dpapi;
use crate::{
    application::ports::BroadcastPresetRepository,
    domain::{
        broadcast_presets::{
            BroadcastPresetDocument, MAX_PRESET_STORE_BYTES, PRESET_SCHEMA_VERSION,
        },
        error::{AppError, Result},
    },
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
};
use zeroize::Zeroizing;

const MAX_ENCRYPTED_BYTES: usize = 2 * 1024 * 1024;
const STORE_NAME: &str = "broadcast-presets.dpapi";

/// Construct only after the account repository acquires the sole instance.lock.
/// Presets never acquire another process lock or modify the live job document.
pub struct EncryptedBroadcastPresetRepository {
    root: PathBuf,
}

impl EncryptedBroadcastPresetRepository {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|_| AppError::BroadcastPresetPersistence)?;
        Ok(Self { root })
    }
}

impl BroadcastPresetRepository for EncryptedBroadcastPresetRepository {
    fn load(&self) -> Result<Option<BroadcastPresetDocument>> {
        let file = match File::open(self.root.join(STORE_NAME)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AppError::BroadcastPresetPersistence),
        };
        let mut encrypted = Vec::new();
        file.take(MAX_ENCRYPTED_BYTES as u64 + 1)
            .read_to_end(&mut encrypted)
            .map_err(|_| AppError::BroadcastPresetPersistence)?;
        if encrypted.len() > MAX_ENCRYPTED_BYTES {
            return Err(AppError::BroadcastPresetLimit);
        }
        let plain = dpapi::decrypt(&encrypted).map_err(|_| AppError::BroadcastPresetInvalid)?;
        if plain.len() > MAX_PRESET_STORE_BYTES {
            return Err(AppError::BroadcastPresetLimit);
        }
        let document: BroadcastPresetDocument =
            serde_json::from_slice(&plain).map_err(|_| AppError::BroadcastPresetInvalid)?;
        document.validate()?;
        Ok(Some(document))
    }

    fn save(&mut self, document: &BroadcastPresetDocument) -> Result<()> {
        document.validate()?;
        let mut current = document.clone();
        current.schema_version = PRESET_SCHEMA_VERSION;
        current.validate()?;
        let plain = Zeroizing::new(
            serde_json::to_vec(&current).map_err(|_| AppError::BroadcastPresetInvalid)?,
        );
        let encrypted = dpapi::encrypt(&plain).map_err(|_| AppError::BroadcastPresetPersistence)?;
        if encrypted.len() > MAX_ENCRYPTED_BYTES {
            return Err(AppError::BroadcastPresetLimit);
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|_| AppError::BroadcastPresetPersistence)?;
        temporary
            .write_all(&encrypted)
            .map_err(|_| AppError::BroadcastPresetPersistence)?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| AppError::BroadcastPresetPersistence)?;
        temporary
            .persist(self.root.join(STORE_NAME))
            .map_err(|_| AppError::BroadcastPresetPersistence)?;
        Ok(())
    }
}
