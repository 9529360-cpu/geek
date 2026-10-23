use super::dpapi;
use crate::{
    application::ports::TranslationCacheRepository,
    domain::{
        error::{AppError, Result},
        translation_cache::{TranslationCacheDocument, MAX_TRANSLATION_CACHE_PLAIN_BYTES},
    },
};
use std::{
    fs::File,
    io::{Read, Write},
    path::PathBuf,
};
use zeroize::Zeroizing;

const MAX_ENCRYPTED_BYTES: usize = 2 * 1024 * 1024;
const STORE_NAME: &str = "translation-cache.dpapi";

/// Optional completed results share the existing instance lock. Construction has
/// no I/O: an unavailable cache must not prevent the authenticated app from opening.
pub struct EncryptedTranslationCacheRepository {
    root: PathBuf,
}

impl EncryptedTranslationCacheRepository {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl TranslationCacheRepository for EncryptedTranslationCacheRepository {
    fn load(&self) -> Result<Option<TranslationCacheDocument>> {
        let file = match File::open(self.root.join(STORE_NAME)) {
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
        if plain.len() > MAX_TRANSLATION_CACHE_PLAIN_BYTES {
            return Err(AppError::StoreInvalid);
        }
        let document: TranslationCacheDocument =
            serde_json::from_slice(&plain).map_err(|_| AppError::StoreInvalid)?;
        document.validate()?;
        Ok(Some(document))
    }

    fn save(&mut self, document: &TranslationCacheDocument) -> Result<()> {
        document.validate()?;
        let plain =
            Zeroizing::new(serde_json::to_vec(document).map_err(|_| AppError::StoreInvalid)?);
        if plain.len() > MAX_TRANSLATION_CACHE_PLAIN_BYTES {
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
            .persist(self.root.join(STORE_NAME))
            .map_err(|_| AppError::StoreIo)?;
        Ok(())
    }
}
