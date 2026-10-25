//! Original normalized contact profiles (联系人备注), owned per account and chat.
//! Storage keys and limits mirror ui/contact-notes.js so both builds agree.
use super::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const NOTE_SCHEMA_VERSION: u32 = 1;
pub const MAX_NOTE_LENGTH: usize = 2000;
pub const MAX_ENTRIES: usize = 2000;
pub const FOLLOW_STATUSES: &[&str] = &["", "new", "following", "quoting", "won", "paused", "lost"];
pub const NOTE_FAMILIES: &[&str] = &["whatsapp", "telegram", "line"];

/// Bounded server-side profile as sent over IPC. Empty everything means "delete".
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContactNote {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub follow_status: String,
    #[serde(default)]
    pub next_follow_up: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ContactNoteEntry {
    #[serde(flatten)]
    note: ContactNote,
    #[serde(rename = "updatedAt")]
    updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContactNotesDocument {
    pub version: u32,
    #[serde(rename = "items")]
    pub items: BTreeMap<String, ContactNoteEntry>,
}

impl Default for ContactNotesDocument {
    fn default() -> Self {
        Self {
            version: NOTE_SCHEMA_VERSION,
            items: BTreeMap::new(),
        }
    }
}

/// Original normalizeIdentity: platform family plus a chat id, never mixing platforms.
pub fn identity(family: &str, chat_id: &str) -> Option<(String, String)> {
    let family = family.trim().to_ascii_lowercase();
    if !NOTE_FAMILIES.contains(&family.as_str()) {
        return None;
    }
    let mut id = chat_id.trim().to_string();
    if family == "telegram" {
        id = id.strip_prefix('#').unwrap_or(&id).to_string();
        id = id
            .split('?')
            .next()
            .unwrap_or("")
            .trim_start_matches('/')
            .to_string();
    }
    if id.is_empty() || id.len() > 512 || id.chars().any(char::is_control) {
        return None;
    }
    Some((family, id))
}

pub fn store_key(family: &str, chat_id: &str) -> String {
    format!("{family}:{}", chat_id)
}

fn bounded(value: &str, max: usize) -> Result<String> {
    let text = value.trim();
    if text.chars().count() > max {
        return Err(AppError::ContactNotesInvalid);
    }
    if text
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err(AppError::ContactNotesInvalid);
    }
    Ok(text.to_string())
}

impl ContactNote {
    /// Original cleanText/normalizeProfile semantics in one authority.
    pub fn validated(mut self) -> Result<Self> {
        self.name = bounded(&self.name, 100)?;
        self.country = bounded(&self.country, 80)?;
        self.source = bounded(&self.source, 100)?;
        self.notes = bounded(&self.notes, MAX_NOTE_LENGTH)?;
        if !FOLLOW_STATUSES.contains(&self.follow_status.as_str()) {
            self.follow_status.clear();
        }
        if self.next_follow_up.is_empty() {
            return Ok(self);
        }
        // datetime-local rendering: exactly YYYY-MM-DDTHH:MM with valid ranges.
        let bytes = self.next_follow_up.as_bytes();
        let digits = |range: std::ops::Range<usize>| {
            range
                .clone()
                .all(|index| bytes.get(index).is_some_and(u8::is_ascii_digit))
        };
        let shape = self.next_follow_up.len() == 16
            && bytes.get(4) == Some(&b'-')
            && bytes.get(7) == Some(&b'-')
            && bytes.get(10) == Some(&b'T')
            && bytes.get(13) == Some(&b':')
            && digits(0..4)
            && digits(5..7)
            && digits(8..10)
            && digits(11..13)
            && digits(14..16);
        if !shape {
            return Err(AppError::ContactNotesInvalid);
        }
        let month: u32 = self.next_follow_up[5..7]
            .parse()
            .map_err(|_| AppError::ContactNotesInvalid)?;
        let day: u32 = self.next_follow_up[8..10]
            .parse()
            .map_err(|_| AppError::ContactNotesInvalid)?;
        let hour: u32 = self.next_follow_up[11..13]
            .parse()
            .map_err(|_| AppError::ContactNotesInvalid)?;
        let minute: u32 = self.next_follow_up[14..16]
            .parse()
            .map_err(|_| AppError::ContactNotesInvalid)?;
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
            return Err(AppError::ContactNotesInvalid);
        }
        Ok(self)
    }

    pub fn is_empty(&self) -> bool {
        self.name.is_empty()
            && self.country.is_empty()
            && self.source.is_empty()
            && self.follow_status.is_empty()
            && self.next_follow_up.is_empty()
            && self.notes.is_empty()
    }
}

impl ContactNotesDocument {
    pub fn validate(&self) -> Result<()> {
        if self.version != NOTE_SCHEMA_VERSION || self.items.len() > MAX_ENTRIES {
            return Err(AppError::ContactNotesInvalid);
        }
        for (key, entry) in &self.items {
            let (family, chat_id) = key.split_once(':').ok_or(AppError::ContactNotesInvalid)?;
            if store_key(family, chat_id) != *key
                || identity(family, chat_id).is_none()
                || entry.note.clone().validated()? != entry.note
            {
                return Err(AppError::ContactNotesInvalid);
            }
        }
        Ok(())
    }

    /// Original updateStore: one normalized write, empty profiles delete, entries bounded.
    pub fn update(
        &mut self,
        family: &str,
        chat_id: &str,
        note: ContactNote,
        now: u64,
    ) -> Result<ContactNote> {
        let (family, chat_id) = identity(family, chat_id).ok_or(AppError::ContactNotesInvalid)?;
        let note = note.validated()?;
        let key = store_key(&family, &chat_id);
        if note.is_empty() {
            self.items.remove(&key);
            return Ok(note);
        }
        if !self.items.contains_key(&key) && self.items.len() >= MAX_ENTRIES {
            return Err(AppError::ContactNotesLimit);
        }
        self.items.insert(
            key,
            ContactNoteEntry {
                updated_at: now,
                note: note.clone(),
            },
        );
        Ok(note)
    }

    pub fn profile(&self, family: &str, chat_id: &str) -> Option<ContactNote> {
        let (family, chat_id) = identity(family, chat_id)?;
        self.items
            .get(&store_key(&family, &chat_id))
            .map(|entry| entry.note.clone())
    }

    /// First-version notes carried only `text`; read them as the note body.
    pub fn migrate_legacy(raw: &[u8]) -> Result<Self> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct LegacyFile {
            version: u32,
            items: BTreeMap<String, serde_json::Value>,
        }
        let file: LegacyFile =
            serde_json::from_slice(raw).map_err(|_| AppError::ContactNotesInvalid)?;
        if file.version != 1 {
            return Err(AppError::ContactNotesInvalid);
        }
        let mut document = Self::default();
        for (key, value) in file.items {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct LegacyNote {
                #[serde(default)]
                text: Option<String>,
            }
            let legacy: LegacyNote =
                serde_json::from_value(value).map_err(|_| AppError::ContactNotesInvalid)?;
            let note = ContactNote {
                notes: legacy.text.unwrap_or_default(),
                ..ContactNote::default()
            };
            let entry = ContactNoteEntry {
                updated_at: 0,
                note,
            };
            document.items.insert(key, entry);
        }
        document.validate()?;
        Ok(document)
    }
}
