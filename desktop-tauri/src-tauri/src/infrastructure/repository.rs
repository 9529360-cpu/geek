use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::PathBuf};
use zeroize::Zeroizing;
use crate::{application::ports::AccountRepository, domain::{document::Document, error::{AppError, Result}}};
use super::dpapi;

const MAX_STORE_BYTES: u64 = 2 * 1024 * 1024;

/// Holds the instance lock for as long as the application owns its repository.
pub struct EncryptedRepository {
    root: PathBuf,
    _lock: File,
}

impl EncryptedRepository {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|_| AppError::StoreIo)?;
        let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true)
            .open(root.join("instance.lock")).map_err(|_| AppError::StoreIo)?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| AppError::ProfileInUse)?;
        Ok(Self { root, _lock: lock })
    }
}

impl AccountRepository for EncryptedRepository {
    fn load(&self) -> Result<Option<Document>> {
        let file = match File::open(self.root.join("accounts.dpapi")) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AppError::StoreIo),
        };
        let mut encrypted = Vec::new();
        file.take(MAX_STORE_BYTES + 1).read_to_end(&mut encrypted).map_err(|_| AppError::StoreIo)?;
        if encrypted.len() as u64 > MAX_STORE_BYTES {
            return Err(AppError::StoreInvalid);
        }
        let plain = dpapi::decrypt(&encrypted)?;
        serde_json::from_slice(&plain).map(Some).map_err(|_| AppError::StoreInvalid)
    }

    fn save(&mut self, document: &Document) -> Result<()> {
        let plain = Zeroizing::new(serde_json::to_vec(document).map_err(|_| AppError::StoreInvalid)?);
        let encrypted = dpapi::encrypt(&plain)?;
        if encrypted.len() as u64 > MAX_STORE_BYTES {
            return Err(AppError::StoreInvalid);
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root).map_err(|_| AppError::StoreIo)?;
        temporary.write_all(&encrypted).map_err(|_| AppError::StoreIo)?;
        temporary.as_file().sync_all().map_err(|_| AppError::StoreIo)?;
        // Same-directory atomic replace; never delete the old authoritative file.
        temporary.persist(self.root.join("accounts.dpapi")).map_err(|_| AppError::StoreIo)?;
        Ok(())
    }
}
