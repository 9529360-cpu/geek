use super::dpapi;
use crate::{
    application::ports::BroadcastRepository,
    domain::{
        broadcast::{BroadcastDocument, MAX_STORE_BYTES},
        error::{AppError, Result},
    },
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
};
use zeroize::Zeroizing;

/// Open only after the account repository acquired the process instance lock.
/// This independent file deliberately never acquires another instance.lock.
pub struct EncryptedBroadcastRepository {
    root: PathBuf,
}

impl EncryptedBroadcastRepository {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|_| AppError::StoreIo)?;
        Ok(Self { root })
    }
}

impl BroadcastRepository for EncryptedBroadcastRepository {
    fn load(&self) -> Result<Option<BroadcastDocument>> {
        let file = match File::open(self.root.join("broadcast.dpapi")) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AppError::StoreIo),
        };
        let mut encrypted = Vec::new();
        file.take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut encrypted)
            .map_err(|_| AppError::StoreIo)?;
        if encrypted.len() > 2 * 1024 * 1024 {
            return Err(AppError::StoreInvalid);
        }
        let plain = dpapi::decrypt(&encrypted)?;
        if plain.len() > MAX_STORE_BYTES {
            return Err(AppError::StoreInvalid);
        }
        serde_json::from_slice(&plain)
            .map(Some)
            .map_err(|_| AppError::StoreInvalid)
    }

    fn save(&mut self, document: &BroadcastDocument) -> Result<()> {
        let plain =
            Zeroizing::new(serde_json::to_vec(document).map_err(|_| AppError::StoreInvalid)?);
        if plain.len() > MAX_STORE_BYTES {
            return Err(AppError::BroadcastLimit);
        }
        let encrypted = dpapi::encrypt(&plain)?;
        if encrypted.len() > 2 * 1024 * 1024 {
            return Err(AppError::StoreInvalid);
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(&self.root).map_err(|_| AppError::StoreIo)?;
        temporary
            .write_all(&encrypted)
            .map_err(|_| AppError::StoreIo)?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| AppError::StoreIo)?;
        temporary
            .persist(self.root.join("broadcast.dpapi"))
            .map_err(|_| AppError::StoreIo)?;
        Ok(())
    }
}
