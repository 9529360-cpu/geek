//! Per-account contact notes storage: one DPAPI-encrypted file per account profile.
use super::dpapi;
use crate::{
    domain::{
        contact_notes::{ContactNotesDocument, NOTE_SCHEMA_VERSION},
        error::{AppError, Result},
    },
    infrastructure::profiles,
};
use std::{fs, fs::File, io::Read, io::Write, path::PathBuf};
use zeroize::Zeroizing;

const MAX_ENCRYPTED_BYTES: usize = 2 * 1024 * 1024;

/// Construct only after the account repository acquires the sole instance.lock.
/// Never touches the account document or any other store.
pub struct EncryptedContactNotesRepository {
    file: PathBuf,
}

impl EncryptedContactNotesRepository {
    pub fn open(root: &std::path::Path, account_id: &str) -> Result<Self> {
        let profile = profiles::account_profile(root, account_id)?;
        fs::create_dir_all(&profile).map_err(|_| AppError::ContactNotesPersistence)?;
        Ok(Self {
            file: profile.join("contact-notes.dpapi"),
        })
    }

    fn read_encrypted(&self) -> Result<Option<Vec<u8>>> {
        if !self.file.exists() {
            return Ok(None);
        }
        let file = File::open(&self.file).map_err(|_| AppError::ContactNotesPersistence)?;
        let mut encrypted = Vec::new();
        file.take(MAX_ENCRYPTED_BYTES as u64 + 1)
            .read_to_end(&mut encrypted)
            .map_err(|_| AppError::ContactNotesPersistence)?;
        if encrypted.len() > MAX_ENCRYPTED_BYTES {
            return Err(AppError::ContactNotesLimit);
        }
        Ok(Some(encrypted))
    }

    pub fn load(&self) -> Result<ContactNotesDocument> {
        let Some(encrypted) = self.read_encrypted()? else {
            return Ok(ContactNotesDocument::default());
        };
        let plain = dpapi::decrypt(&encrypted).map_err(|_| AppError::ContactNotesInvalid)?;
        if let Ok(document) = serde_json::from_slice::<ContactNotesDocument>(&plain) {
            document.validate()?;
            return Ok(document);
        }
        // First-version stores carried { text } entries; one quiet migration.
        let migrated = ContactNotesDocument::migrate_legacy(&plain)?;
        self.save(&migrated)?;
        Ok(migrated)
    }

    pub fn save(&self, document: &ContactNotesDocument) -> Result<()> {
        let mut current = document.clone();
        current.version = NOTE_SCHEMA_VERSION;
        current.validate()?;
        let plain = Zeroizing::new(
            serde_json::to_vec(&current).map_err(|_| AppError::ContactNotesInvalid)?,
        );
        let encrypted = dpapi::encrypt(&plain).map_err(|_| AppError::ContactNotesPersistence)?;
        if encrypted.len() > MAX_ENCRYPTED_BYTES {
            return Err(AppError::ContactNotesLimit);
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(self.file.parent().expect("profile directory"))
                .map_err(|_| AppError::ContactNotesPersistence)?;
        temporary
            .write_all(&encrypted)
            .map_err(|_| AppError::ContactNotesPersistence)?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| AppError::ContactNotesPersistence)?;
        temporary
            .persist(&self.file)
            .map_err(|_| AppError::ContactNotesPersistence)?;
        Ok(())
    }
}
