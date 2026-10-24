//! Exact v2 workbench backup, not the older unversioned app.js export.
use super::{
    present, validate_metadata, BackupAccount, BackupAudience, BackupData, BackupImport,
    BackupMessage, PresetBackup, TranslationBackup, EXCLUDED_KEYS,
};
use crate::domain::{
    broadcast_presets::normalize_preset_name,
    error::{AppError, Result},
    translation::{ChatTranslationPolicy, TranslationPolicy},
};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

const UNSUPPORTED_KEYS: &[&str] = &[
    "broadcastGroups",
    "savedGroups",
    "groupLinks",
    "gtAutoCfg",
    "gtCmdCfg",
    "gtCmdNames",
];
const MAX_LEGACY_COMPONENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyRecord {
    schema: String,
    version: u32,
    exported_at: String,
    account: BackupAccount,
    data: Map<String, Value>,
    #[serde(default)]
    excludes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyMessage {
    name: String,
    msg: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyAudience {
    name: String,
    ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum LegacyFontSize {
    Text(String),
    Number(u8),
}

impl Default for LegacyFontSize {
    fn default() -> Self {
        Self::Text("13".into())
    }
}

// Only fields read by translation-core.normalizeConfig are recognized. Current
// translation-settings emits the defaults below; older documented booleans keep
// their exact precedence instead of being coerced or guessed.
#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct LegacyGlobal {
    source: String,
    server: String,
    send: bool,
    send_from: String,
    send_to: String,
    include_zh: bool,
    display_translation: bool,
    manual: bool,
    #[serde(deserialize_with = "present")]
    translation_mode: Option<String>,
    message: bool,
    message_from: String,
    message_to: String,
    group: bool,
    translate_history: bool,
    trans_old_history: bool,
    font_size: LegacyFontSize,
    font_color: String,
}

impl Default for LegacyGlobal {
    fn default() -> Self {
        Self {
            source: "auto".into(),
            server: "default".into(),
            send: false,
            send_from: "auto".into(),
            send_to: "en".into(),
            include_zh: true,
            display_translation: true,
            manual: true,
            translation_mode: None,
            message: false,
            message_from: "auto".into(),
            message_to: "zh".into(),
            group: false,
            translate_history: false,
            trans_old_history: false,
            font_size: LegacyFontSize::default(),
            font_color: "#667eea".into(),
        }
    }
}

impl LegacyGlobal {
    fn convert(self) -> Result<TranslationPolicy> {
        // The original core deliberately routes all three stored source values
        // through provider=auto; do not reinterpret the legacy word "local".
        if !["auto", "local", "remote"].contains(&self.source.as_str()) {
            return Err(AppError::TranslationInvalid);
        }
        let font_size = match self.font_size {
            LegacyFontSize::Text(value) => match value.as_str() {
                "11" => 11,
                "13" => 13,
                "15" => 15,
                _ => return Err(AppError::TranslationInvalid),
            },
            LegacyFontSize::Number(value) => value,
        };
        let policy = TranslationPolicy {
            provider: "auto".into(),
            route: self.server,
            enabled: self.send,
            auto_send: self.send,
            source: self.send_from,
            target: self.send_to,
            message_action: self.manual,
            display_translation: self.display_translation,
            translation_mode: self.translation_mode.unwrap_or_else(|| {
                if self.message {
                    "auto".into()
                } else {
                    "click".into()
                }
            }),
            message_target: self.message_to,
            message_from: self.message_from,
            group_auto: self.group,
            translate_history: self.translate_history || self.trans_old_history,
            include_zh: self.include_zh,
            font_size,
            font_color: self.font_color,
        };
        policy.validate()?;
        Ok(policy)
    }
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| AppError::BackupInvalid)
}

pub(super) fn parse(value: Value) -> Result<BackupImport> {
    let record: LegacyRecord = decode(value)?;
    if record.schema != super::BACKUP_SCHEMA || record.version != 2 {
        return Err(AppError::BackupVersion);
    }
    validate_metadata(&record.account, &record.exported_at, &record.excludes)?;
    let mut presets = PresetBackup::default();
    let mut shared_exclusions = None;
    let mut translation = TranslationBackup::default();
    let mut reported_unsupported = Vec::new();
    let mut ignored_keys = Vec::new();
    for (key, value) in record.data {
        if serde_json::to_vec(&value)
            .map_err(|_| AppError::BackupInvalid)?
            .len()
            > MAX_LEGACY_COMPONENT_BYTES
        {
            return Err(AppError::BackupLimit);
        }
        match key.as_str() {
            "savedMessages" => {
                presets.messages = Some(
                    decode::<Vec<LegacyMessage>>(value)?
                        .into_iter()
                        .map(|entry| {
                            Ok(BackupMessage {
                                name: normalize_preset_name(&entry.name)?,
                                message: entry.msg,
                            })
                        })
                        .collect::<Result<_>>()?,
                );
            }
            "savedLists" => {
                presets.audiences = Some(
                    decode::<Vec<LegacyAudience>>(value)?
                        .into_iter()
                        .map(|entry| {
                            Ok(BackupAudience {
                                name: normalize_preset_name(&entry.name)?,
                                recipient_ids: entry.ids,
                            })
                        })
                        .collect::<Result<_>>()?,
                );
            }
            "broadcastExcludeContacts" => presets.excluded_contact_ids = Some(decode(value)?),
            "broadcastExcludeGroups" => presets.excluded_group_ids = Some(decode(value)?),
            "broadcastExclude" => shared_exclusions = Some(decode::<Vec<String>>(value)?),
            "translationGlobal" => {
                translation.global = Some(decode::<LegacyGlobal>(value)?.convert()?)
            }
            "translationChats" => {
                translation.chats = Some(decode::<BTreeMap<String, ChatTranslationPolicy>>(value)?);
            }
            key if UNSUPPORTED_KEYS.contains(&key) => reported_unsupported.push(key.into()),
            key if EXCLUDED_KEYS.contains(&key) => ignored_keys.push(key.into()),
            _ => return Err(AppError::BackupInvalid),
        }
    }
    merge_exclusions(&mut presets, shared_exclusions)?;
    let has_presets = presets.is_present();
    let has_translation = translation.global.is_some() || translation.chats.is_some();
    if !has_presets
        && !has_translation
        && reported_unsupported.is_empty()
        && ignored_keys.is_empty()
    {
        return Err(AppError::BackupInvalid);
    }
    Ok(BackupImport {
        version: 2,
        account: record.account,
        data: BackupData {
            presets: has_presets.then_some(presets),
            translation: has_translation.then_some(translation),
        },
        reported_unsupported,
        ignored_keys,
    })
}

fn merge_exclusions(presets: &mut PresetBackup, shared: Option<Vec<String>>) -> Result<()> {
    use crate::domain::broadcast_presets::{exclusion_kind, validate_exclusions, ExclusionKind};
    use std::collections::HashSet;

    validate_exclusions(
        presets.excluded_contact_ids.as_deref().unwrap_or_default(),
        presets.excluded_group_ids.as_deref().unwrap_or_default(),
    )?;
    let Some(shared) = shared else {
        return Ok(());
    };
    let mut contacts = Vec::new();
    let mut groups = Vec::new();
    let mut seen = HashSet::new();
    for id in shared {
        if !seen.insert(id.clone()) {
            return Err(AppError::BroadcastPresetInvalid);
        }
        match exclusion_kind(&id) {
            Some(ExclusionKind::Contact) => contacts.push(id),
            Some(ExclusionKind::Group) => groups.push(id),
            None => return Err(AppError::BroadcastPresetInvalid),
        }
    }
    validate_exclusions(&contacts, &groups)?;
    // A present combined list describes both kinds, including an explicit empty
    // list. Union overlapping legacy keys without dropping a deny-only hint.
    for (specific, combined) in [
        (&mut presets.excluded_contact_ids, contacts),
        (&mut presets.excluded_group_ids, groups),
    ] {
        let ids = specific.get_or_insert_with(Vec::new);
        let mut present: HashSet<String> = ids.iter().cloned().collect();
        ids.extend(combined.into_iter().filter(|id| present.insert(id.clone())));
    }
    validate_exclusions(
        presets.excluded_contact_ids.as_deref().unwrap_or_default(),
        presets.excluded_group_ids.as_deref().unwrap_or_default(),
    )
}
