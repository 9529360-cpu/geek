//! Optional receive-result persistence inside TranslationService; no request queue or authority.
use super::{
    request_control::RequestControl,
    session::SessionLease,
    translation_ports::{TranslationCacheClock, TranslationCacheRepository, TranslationRequest},
};
use crate::domain::{
    account::Account,
    error::Result,
    translation_cache::{TranslationCacheDocument, TranslationCacheEntry},
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, TryLockError},
    time::Duration,
};

const CONTRACT_VERSION: &str = "tauri-message-display-source-2-v1";

#[derive(Clone)]
pub(super) struct DisplayCacheKey {
    principal: String,
    account_id: String,
    key: String,
    sequence: u64,
}

struct StoredCache {
    document: TranslationCacheDocument,
    /// Only resident completed keys are retained, bounded by the document itself.
    completed: HashMap<String, u64>,
    last_now: u64,
}

pub(super) struct DisplayTranslationCache {
    stored: Mutex<StoredCache>,
    repository: Mutex<Option<Box<dyn TranslationCacheRepository>>>,
    clock: Arc<dyn TranslationCacheClock>,
}

impl DisplayTranslationCache {
    pub fn open(
        repository: Box<dyn TranslationCacheRepository>,
        clock: Arc<dyn TranslationCacheClock>,
    ) -> Self {
        let loaded = repository.load().and_then(|document| {
            let document = document.unwrap_or_default();
            document.validate()?;
            Ok(document)
        });
        let (repository, mut document) = match loaded {
            Ok(document) => (Some(repository), document),
            // A damaged/future document must not be reset or overwritten this process.
            Err(_) => (None, TranslationCacheDocument::default()),
        };
        let last_now = clock.now_secs();
        document.entries.retain(|entry| entry.fresh(last_now));
        Self {
            stored: Mutex::new(StoredCache {
                document,
                completed: HashMap::new(),
                last_now,
            }),
            repository: Mutex::new(repository),
            clock,
        }
    }

    pub fn key(
        &self,
        account: &Account,
        lease: &SessionLease,
        chat_id: &str,
        message_id: &str,
        request: &TranslationRequest,
        sequence: u64,
    ) -> DisplayCacheKey {
        let principal = digest(&[&lease.user.id.to_string(), &lease.user.account_no]);
        let key = digest(&[
            CONTRACT_VERSION,
            &principal,
            &account.id,
            &account.platform_id,
            chat_id,
            message_id,
            &request.text,
            &request.source,
            &request.target,
            &request.provider,
            &request.route,
        ]);
        DisplayCacheKey {
            principal,
            account_id: account.id.clone(),
            key,
            sequence,
        }
    }

    fn lock(&self, control: &RequestControl) -> Result<Option<MutexGuard<'_, StoredCache>>> {
        loop {
            control.check()?;
            match self.stored.try_lock() {
                Ok(stored) => return Ok(Some(stored)),
                Err(TryLockError::Poisoned(_)) => return Ok(None),
                Err(TryLockError::WouldBlock) => control.wait(Duration::from_millis(25))?,
            }
        }
    }

    fn observe_time(&self, stored: &mut StoredCache) -> Option<u64> {
        let now = self.clock.now_secs();
        if now == 0 || now < stored.last_now {
            return None;
        }
        stored.last_now = now;
        stored.document.entries.retain(|entry| entry.fresh(now));
        let entries = &stored.document.entries;
        stored
            .completed
            .retain(|key, _| entries.iter().any(|entry| &entry.key == key));
        Some(now)
    }

    pub fn lookup(
        &self,
        key: &DisplayCacheKey,
        control: &RequestControl,
    ) -> Result<Option<String>> {
        let Some(mut stored) = self.lock(control)? else {
            return Ok(None);
        };
        let Some(now) = self.observe_time(&mut stored) else {
            return Ok(None);
        };
        Ok(stored
            .document
            .entries
            .iter()
            .find(|entry| {
                entry.key == key.key
                    && entry.principal == key.principal
                    && entry.account_id == key.account_id
                    && entry.fresh(now)
            })
            .map(|entry| entry.text.clone()))
    }

    /// Best effort only. The caller already retained the paid success in its memory cache.
    pub fn remember(&self, key: &DisplayCacheKey, text: &str, control: &RequestControl) {
        // Optional persistence never waits for another disk write or spends its caller's budget.
        let Ok(mut repository) = self.repository.try_lock() else {
            return;
        };
        let Some(repository) = repository.as_mut() else {
            return;
        };
        let Ok(mut stored) = self.stored.try_lock() else {
            return;
        };
        if stored
            .completed
            .get(&key.key)
            .is_some_and(|sequence| *sequence > key.sequence)
        {
            return;
        }
        let Some(saved_at) = self.observe_time(&mut stored) else {
            return;
        };
        let mut candidate = stored.document.clone();
        drop(stored);
        let entry = TranslationCacheEntry {
            principal: key.principal.clone(),
            account_id: key.account_id.clone(),
            key: key.key.clone(),
            saved_at,
            text: text.to_owned(),
        };
        // An invalid entry may not evict valid cached results.
        if (TranslationCacheDocument {
            entries: vec![entry.clone()],
            ..TranslationCacheDocument::default()
        })
        .validate()
        .is_err()
        {
            return;
        }
        candidate
            .entries
            .retain(|entry| entry.fresh(saved_at) && entry.key != key.key);
        candidate.entries.push(entry);
        while candidate.validate().is_err() {
            if candidate.entries.is_empty() {
                return;
            }
            candidate.entries.remove(0);
        }
        if control.check().is_err() {
            return;
        }
        if repository.save(&candidate).is_err() {
            return;
        }
        // Reads only hold this lock for bounded in-memory work, never repository I/O.
        let Ok(mut stored) = self.stored.lock() else {
            return;
        };
        candidate
            .entries
            .retain(|entry| entry.fresh(stored.last_now));
        stored
            .completed
            .retain(|existing, _| candidate.entries.iter().any(|entry| &entry.key == existing));
        if candidate.entries.iter().any(|entry| entry.key == key.key) {
            stored.completed.insert(key.key.clone(), key.sequence);
        }
        stored.document = candidate;
    }
}

fn digest(components: &[&str]) -> String {
    let mut digest = Sha256::new();
    for component in components {
        digest.update((component.len() as u64).to_le_bytes());
        digest.update(component.as_bytes());
    }
    format!("{:x}", digest.finalize())
}
