use super::dpapi;
use crate::{
    application::ports::SessionRepository,
    domain::{
        error::{AppError, Result},
        session::{SessionDocument, MAX_SESSION_PLAIN_BYTES},
    },
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
};
use zeroize::Zeroizing;

const MAX_ENCRYPTED_BYTES: usize = 64 * 1024;

/// Uses the existing application instance owner; never acquires a second lock.
pub struct EncryptedSessionRepository {
    root: PathBuf,
}

impl EncryptedSessionRepository {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|_| AppError::StoreIo)?;
        Ok(Self { root })
    }
}

impl SessionRepository for EncryptedSessionRepository {
    fn load(&self) -> Result<Option<SessionDocument>> {
        let file = match File::open(self.root.join("session.dpapi")) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AppError::StoreIo),
        };
        let mut encrypted = Vec::new();
        file.take(MAX_ENCRYPTED_BYTES as u64 + 1)
            .read_to_end(&mut encrypted)
            .map_err(|_| AppError::StoreIo)?;
        if encrypted.len() > MAX_ENCRYPTED_BYTES {
            return Err(AppError::StoreInvalid);
        }
        let plain = dpapi::decrypt(&encrypted)?;
        if plain.len() > MAX_SESSION_PLAIN_BYTES {
            return Err(AppError::StoreInvalid);
        }
        let document: SessionDocument =
            serde_json::from_slice(&plain).map_err(|_| AppError::StoreInvalid)?;
        document.validate()?;
        Ok(Some(document))
    }

    fn save(&mut self, document: &SessionDocument) -> Result<()> {
        document.validate()?;
        let plain =
            Zeroizing::new(serde_json::to_vec(document).map_err(|_| AppError::StoreInvalid)?);
        if plain.len() > MAX_SESSION_PLAIN_BYTES {
            return Err(AppError::StoreInvalid);
        }
        let encrypted = dpapi::encrypt(&plain)?;
        if encrypted.len() > MAX_ENCRYPTED_BYTES {
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
            .persist(self.root.join("session.dpapi"))
            .map_err(|_| AppError::StoreIo)?;
        Ok(())
    }
}
